"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  EVENT_TYPE,
  RUNTIME_FIELD,
  buildFollowupEventHealth,
  dispatchPendingFollowupEventsToState,
  updateFollowupToState
} = require("../citizen-chronic-followup-event-service");

function state() {
  return {
    followups: [{
      id: "followup-event-001",
      residentId: "resident-001",
      status: "pending",
      plannedAt: "2026-08-03T08:00:00.000Z"
    }],
    securityEvents: []
  };
}

const user = {
  username: "hospital-operator",
  name: "Institution Operator",
  role: "institution"
};

test("owned followup repository commits aggregate and v1 event in one unit of work", async () => {
  const source = state();
  const result = await updateFollowupToState(source, {
    id: "followup-event-001",
    patch: { status: "completed", note: "resident followup completed", expectedVersion: 0 },
    expectedVersion: 0,
    idempotencyKey: "followup-command-secret-001",
    correlationId: "followup-correlation-001",
    at: "2026-08-03T09:00:00.000Z",
    user
  });

  assert.equal(result.idempotent, false);
  assert.equal(result.followup.status, "completed");
  assert.equal(result.followup.domainVersion, 1);
  assert.equal(result.followup[RUNTIME_FIELD], undefined);
  assert.equal(result.event.type, EVENT_TYPE);
  assert.equal(result.event.aggregateId, "followup-event-001");
  assert.equal(result.event.aggregateVersion, 1);
  assert.equal(result.event.correlationId, "followup-correlation-001");
  assert.deepEqual(result.event.payload, {
    followupId: "followup-event-001",
    status: "completed",
    updatedAt: "2026-08-03T09:00:00.000Z",
    version: 1
  });
  const persisted = result.nextData.followups[0];
  assert.equal(persisted[RUNTIME_FIELD].commands.length, 1);
  assert.equal(persisted[RUNTIME_FIELD].outbox.length, 1);
  assert.equal(persisted[RUNTIME_FIELD].outbox[0].deliveryState, "pending");
  assert.match(persisted[RUNTIME_FIELD].commands[0].commandHash, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(result.nextData).includes("followup-command-secret-001"), false);
  assert.equal(source.followups[0].domainVersion, undefined);
  assert.equal(source.followups[0][RUNTIME_FIELD], undefined);
  assert.equal(result.productionReady, false);
});

test("command replay is idempotent while key reuse with another patch fails closed", async () => {
  const first = await updateFollowupToState(state(), {
    id: "followup-event-001",
    patch: { status: "completed" },
    idempotencyKey: "followup-idempotency-001",
    correlationId: "followup-correlation-002",
    at: "2026-08-03T09:00:00.000Z",
    user
  });
  const replay = await updateFollowupToState(first.nextData, {
    id: "followup-event-001",
    patch: { status: "completed" },
    idempotencyKey: "followup-idempotency-001",
    correlationId: "another-correlation",
    at: "2026-08-03T10:00:00.000Z",
    user
  });
  assert.equal(replay.idempotent, true);
  assert.equal(replay.followup.domainVersion, 1);
  assert.equal(replay.nextData.followups[0][RUNTIME_FIELD].outbox.length, 1);
  assert.equal(replay.event.id, first.event.id);

  await assert.rejects(
    updateFollowupToState(first.nextData, {
      id: "followup-event-001",
      patch: { status: "cancelled" },
      idempotencyKey: "followup-idempotency-001",
      user
    }),
    (error) => error.code === "FOLLOWUP_IDEMPOTENCY_CONFLICT"
  );
  await assert.rejects(
    updateFollowupToState(first.nextData, {
      id: "followup-event-001",
      patch: { status: "reviewed" },
      expectedVersion: 0,
      idempotencyKey: "followup-idempotency-002",
      user
    }),
    (error) => error.code === "FOLLOWUP_VERSION_CONFLICT"
  );
});

test("embedded outbox dispatch completes inbox projection and stable receipt once", async () => {
  const staged = await updateFollowupToState(state(), {
    id: "followup-event-001",
    patch: { status: "completed" },
    idempotencyKey: "followup-dispatch-001",
    correlationId: "followup-correlation-003",
    at: "2026-08-03T09:00:00.000Z",
    user
  });
  const published = [];
  const dispatched = await dispatchPendingFollowupEventsToState(staged.nextData, {
    at: "2026-08-03T09:01:00.000Z",
    publisher: {
      async publish(envelope) {
        published.push(envelope);
        return { accepted: true, receiptId: `care-coordination:${envelope.eventId}` };
      }
    }
  });
  const runtime = dispatched.nextData.followups[0][RUNTIME_FIELD];
  assert.equal(published.length, 1);
  assert.equal(published[0].eventType, EVENT_TYPE);
  assert.equal(published[0].eventVersion, 1);
  assert.equal(dispatched.processed[0].processed, true);
  assert.equal(runtime.outbox[0].deliveryState, "published");
  assert.equal(runtime.inbox[0].state, "completed");
  assert.equal(runtime.projections.length, 1);
  assert.equal(runtime.receipts.length, 1);
  assert.match(runtime.receipts[0].receiptDigest, /^[a-f0-9]{64}$/);
  assert.equal(runtime.receipts[0].deliveryStatus, "accepted");
  assert.match(runtime.receipts[0].providerReceiptDigest, /^[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(runtime.receipts[0], "receiptId"), false);
  assert.deepEqual(dispatched.health.summary, {
    outbox: 1,
    pending: 0,
    published: 1,
    completedInbox: 1,
    projections: 1,
    receipts: 1,
    acceptedReceipts: 1,
    deliveredReceipts: 0
  });

  const replayState = structuredClone(dispatched.nextData);
  replayState.followups[0][RUNTIME_FIELD].outbox[0].deliveryState = "pending";
  const replay = await dispatchPendingFollowupEventsToState(replayState, {
    at: "2026-08-03T09:02:00.000Z",
    publisher: {
      async publish() {
        throw new Error("completed inbox must suppress delivery replay");
      }
    }
  });
  assert.equal(replay.processed[0].duplicate, true);
  assert.equal(replay.nextData.followups[0][RUNTIME_FIELD].projections.length, 1);
  assert.equal(replay.nextData.followups[0][RUNTIME_FIELD].receipts.length, 1);
});

test("publisher failure preserves the durable pending aggregate for retry", async () => {
  const staged = await updateFollowupToState(state(), {
    id: "followup-event-001",
    patch: { status: "completed" },
    idempotencyKey: "followup-failure-001",
    at: "2026-08-03T09:00:00.000Z",
    user
  });
  const before = structuredClone(staged.nextData);
  await assert.rejects(
    dispatchPendingFollowupEventsToState(staged.nextData, {
      at: "2026-08-03T09:01:00.000Z",
      publisher: {
        async publish() {
          throw new Error("temporary followup consumer failure");
        }
      }
    }),
    /temporary followup consumer failure/
  );
  assert.deepEqual(staged.nextData, before);
  assert.equal(buildFollowupEventHealth(staged.nextData).summary.pending, 1);
  assert.equal(staged.nextData.followups[0][RUNTIME_FIELD].inbox.length, 0);
});
