"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  CONTRACT_ID,
  EVENT_TYPE,
  appendSignalIngestedEventToState,
  buildPublicHealthDomainEventHealth,
  dispatchPendingSignalEventsToState
} = require("../public-health-domain-event-service");

function signal(overrides = {}) {
  return {
    id: "ph-signal-domain-event-001",
    version: 1,
    signalType: "clinical-syndrome",
    workflowState: "received",
    observedAt: "2026-08-03T08:00:00.000Z",
    receivedAt: "2026-08-03T08:01:00.000Z",
    idempotencyKeyHash: "a".repeat(64),
    ...overrides
  };
}

test("signal and versioned event can be staged in one owned state snapshot", async () => {
  const source = {
    publicHealthSurveillanceSignals: [signal()]
  };
  const first = await appendSignalIngestedEventToState(source, signal(), {
    correlationId: "public-health-correlation-001",
    causationId: "public-health-command-001",
    occurredAt: "2026-08-03T08:01:00.000Z"
  });

  assert.equal(first.idempotent, false);
  assert.equal(first.event.type, EVENT_TYPE);
  assert.equal(first.event.correlationId, "public-health-correlation-001");
  assert.equal(first.event.aggregateVersion, 1);
  assert.deepEqual(first.event.payload, {
    signalId: signal().id,
    occurredAt: signal().receivedAt,
    signalType: signal().signalType,
    status: "received"
  });
  assert.equal(first.nextData.publicHealthDomainOutbox.length, 1);
  assert.equal(first.nextData.publicHealthDomainOutbox[0].contractId, CONTRACT_ID);
  assert.equal(first.nextData.publicHealthDomainOutbox[0].deliveryState, "pending");
  assert.equal(source.publicHealthDomainOutbox, undefined);
  assert.equal(JSON.stringify(first.nextData).includes("public-health-command-raw-secret"), false);

  const replay = await appendSignalIngestedEventToState(first.nextData, signal(), {
    correlationId: "different-correlation"
  });
  assert.equal(replay.idempotent, true);
  assert.equal(replay.nextData.publicHealthDomainOutbox.length, 1);
  assert.equal(replay.event.id, first.event.id);
});

test("outbox dispatch validates the v1 contract and completes an idempotent consumer inbox", async () => {
  const staged = await appendSignalIngestedEventToState({}, signal(), {
    correlationId: "public-health-correlation-002",
    occurredAt: "2026-08-03T08:01:00.000Z"
  });
  const published = [];
  const dispatched = await dispatchPendingSignalEventsToState(staged.nextData, {
    at: "2026-08-03T08:02:00.000Z",
    publisher: {
      async publish(envelope) {
        published.push(envelope);
        return { accepted: true, receiptId: `governance-receipt:${envelope.eventId}` };
      }
    }
  });

  assert.equal(published.length, 1);
  assert.equal(published[0].contractId, CONTRACT_ID);
  assert.equal(published[0].contractVersion, "1.0.0");
  assert.equal(dispatched.processed[0].processed, true);
  assert.equal(dispatched.nextData.publicHealthDomainOutbox[0].deliveryState, "published");
  assert.equal(dispatched.nextData.publicHealthDomainInbox[0].state, "completed");
  assert.equal(dispatched.nextData.publicHealthSignalEventProjections.length, 1);
  assert.equal(dispatched.nextData.publicHealthDomainEventReceipts.length, 1);
  assert.match(dispatched.nextData.publicHealthDomainEventReceipts[0].receiptDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual(dispatched.health.summary, {
    outbox: 1,
    pending: 0,
    published: 1,
    completedInbox: 1,
    projections: 1,
    receipts: 1
  });
  assert.equal(dispatched.productionReady, false);

  const forcedAtLeastOnceReplay = structuredClone(dispatched.nextData);
  forcedAtLeastOnceReplay.publicHealthDomainOutbox[0].deliveryState = "pending";
  const replay = await dispatchPendingSignalEventsToState(forcedAtLeastOnceReplay, {
    at: "2026-08-03T08:03:00.000Z",
    publisher: {
      async publish() {
        throw new Error("idempotent inbox should suppress downstream replay");
      }
    }
  });
  assert.equal(replay.processed[0].duplicate, true);
  assert.equal(replay.nextData.publicHealthSignalEventProjections.length, 1);
  assert.equal(replay.nextData.publicHealthDomainEventReceipts.length, 1);
  assert.equal(replay.health.summary.pending, 0);
});

test("publisher failure leaves the durable input pending for a safe retry", async () => {
  const staged = await appendSignalIngestedEventToState({}, signal(), {
    occurredAt: "2026-08-03T08:01:00.000Z"
  });
  const before = structuredClone(staged.nextData);

  await assert.rejects(
    dispatchPendingSignalEventsToState(staged.nextData, {
      at: "2026-08-03T08:02:00.000Z",
      publisher: {
        async publish() {
          throw new Error("temporary downstream failure");
        }
      }
    }),
    /temporary downstream failure/
  );
  assert.deepEqual(staged.nextData, before);
  assert.equal(buildPublicHealthDomainEventHealth(staged.nextData).summary.pending, 1);
  assert.equal(staged.nextData.publicHealthDomainInbox, undefined);
});

test("contract boundary rejects malformed persisted event payloads without acknowledgement", async () => {
  const staged = await appendSignalIngestedEventToState({}, signal(), {
    occurredAt: "2026-08-03T08:01:00.000Z"
  });
  const malformed = structuredClone(staged.nextData);
  delete malformed.publicHealthDomainOutbox[0].payload.status;

  await assert.rejects(
    dispatchPendingSignalEventsToState(malformed, { at: "2026-08-03T08:02:00.000Z" }),
    /requires signalId, signalType and status/
  );
  assert.equal(malformed.publicHealthDomainOutbox[0].deliveryState, "pending");
});
