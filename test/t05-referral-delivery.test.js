"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  DEAD_LETTER_COLLECTION,
  INBOX_COLLECTION,
  OUTBOX_COLLECTION,
  REPLAY_COLLECTION,
  buildReferralDeliveryOperations,
  createReferralCommandService,
  createReferralDeliveryService
} = require("../src/care-coordination/referral-command-service");
const { createRouteSegments } = require("../src/http/routes/care-coordination");

function fixture() {
  return {
    residents: [{ id: "r1" }],
    referralSystem: {
      referrals: [{
        id: "rf1",
        residentId: "r1",
        type: "upward",
        from: "primary",
        to: "hospital",
        status: "pending",
        priority: "high",
        version: 1,
        lastUpdated: "2026-08-03T08:00:00.000Z"
      }],
      referralOutbox: [],
      referralCommandInbox: [],
      referralDeliveryReplays: [],
      referralDeliveryDeadLetters: []
    }
  };
}

async function stateWithEvent() {
  let state = fixture();
  await createReferralCommandService({
    readState: () => state,
    writeState: (next) => { state = next; },
    now: () => "2026-08-03T09:00:00.000Z"
  }).update({
    referralId: "rf1",
    commandId: "delivery-command-001",
    expectedVersion: 1,
    correlationId: "trace-delivery-001",
    input: { status: "accepted" }
  });
  return {
    get: () => state,
    set: (next) => { state = next; },
    eventId: state.referralSystem[OUTBOX_COLLECTION][0].id
  };
}

test("claim is atomic across workers and the operations projection exposes no payload or lease token", async () => {
  const holder = await stateWithEvent();
  const dependencies = {
    readState: holder.get,
    writeState: async (next) => {
      await new Promise((resolve) => setImmediate(resolve));
      holder.set(next);
    },
    now: () => "2026-08-03T09:01:00.000Z"
  };
  const [left, right] = await Promise.all([
    createReferralDeliveryService(dependencies).claim({ workerId: "worker-a", leaseSeconds: 60 }),
    createReferralDeliveryService(dependencies).claim({ workerId: "worker-b", leaseSeconds: 60 })
  ]);
  assert.deepEqual([left.length, right.length].sort(), [0, 1]);
  const claim = left[0] || right[0];
  assert.equal(claim.payload.contract.residentId, "r1");
  assert.match(claim.leaseToken, /^[0-9a-f-]{36}$/i);

  const operations = buildReferralDeliveryOperations(holder.get(), { now: "2026-08-03T09:01:01.000Z" });
  assert.equal(operations.summary.leased, 1);
  assert.equal(operations.productionReady, false);
  assert.equal(operations.transportConfigured, false);
  assert.equal(operations.signingConfigured, false);
  assert.equal(operations.events[0].id, holder.eventId);
  assert.equal("payload" in operations.events[0], false);
  assert.equal("lease" in operations.events[0], false);
  assert.equal("leaseToken" in operations.events[0], false);
  assert.doesNotMatch(JSON.stringify(operations), /residentId|r1|delivery-command-001|leaseToken/);
});

test("expired workers cannot overwrite a newer lease and acknowledge is idempotent for its active lease", async () => {
  const holder = await stateWithEvent();
  let clock = "2026-08-03T09:01:00.000Z";
  const service = createReferralDeliveryService({
    readState: holder.get,
    writeState: holder.set,
    now: () => clock,
    maxAttempts: 3
  });
  const first = (await service.claim({ workerId: "worker-old", leaseSeconds: 1 }))[0];
  clock = "2026-08-03T09:01:02.000Z";
  const second = (await service.claim({ workerId: "worker-new", leaseSeconds: 60 }))[0];
  assert.notEqual(second.leaseToken, first.leaseToken);
  assert.equal(second.deliveryVersion, first.deliveryVersion + 1);

  await assert.rejects(
    () => service.acknowledge({
      eventId: holder.eventId,
      leaseToken: first.leaseToken,
      workerId: "worker-old"
    }),
    (error) => error.code === "REFERRAL_DELIVERY_LEASE_STALE"
  );
  const acknowledged = await service.acknowledge({
    eventId: holder.eventId,
    leaseToken: second.leaseToken,
    workerId: "worker-new",
    receipt: { transportMessageId: "transport-001", statusCode: 202 }
  });
  assert.equal(acknowledged.replayed, false);
  assert.equal(acknowledged.event.status, "delivered");
  const replayedAck = await service.acknowledge({
    eventId: holder.eventId,
    leaseToken: second.leaseToken,
    workerId: "worker-new",
    receipt: { transportMessageId: "ignored-retry" }
  });
  assert.equal(replayedAck.replayed, true);
  assert.equal(holder.get().referralSystem[OUTBOX_COLLECTION][0].deliveryReceipt.transportMessageId, "transport-001");
  await assert.rejects(
    () => service.fail({
      eventId: holder.eventId,
      leaseToken: second.leaseToken,
      workerId: "worker-new",
      error: { code: "LATE_FAILURE" }
    }),
    (error) => error.code === "REFERRAL_DELIVERY_LEASE_STALE"
  );
  assert.equal(holder.get().referralSystem[OUTBOX_COLLECTION][0].status, "delivered");
});

test("failure applies exponential retry, reaches dead letter, and commission replay evidence is durable and idempotent", async () => {
  const holder = await stateWithEvent();
  let clock = "2026-08-03T09:01:00.000Z";
  const service = createReferralDeliveryService({
    readState: holder.get,
    writeState: holder.set,
    now: () => clock,
    maxAttempts: 2,
    retryBaseMs: 1000,
    retryMaxMs: 8000
  });
  const first = (await service.claim({ workerId: "worker-a" }))[0];
  const firstFailure = await service.fail({
    eventId: holder.eventId,
    leaseToken: first.leaseToken,
    workerId: "worker-a",
    error: { code: "TRANSPORT_TIMEOUT", message: "external transport timed out" }
  });
  assert.equal(firstFailure.event.status, "retry_wait");
  assert.equal(firstFailure.event.nextAttemptAt, "2026-08-03T09:01:01.000Z");
  assert.equal((await service.claim({ workerId: "worker-early" })).length, 0);

  clock = "2026-08-03T09:01:01.000Z";
  const second = (await service.claim({ workerId: "worker-b" }))[0];
  const secondFailure = await service.fail({
    eventId: holder.eventId,
    leaseToken: second.leaseToken,
    workerId: "worker-b",
    error: { code: "TRANSPORT_REJECTED", message: "downstream rejected event" }
  });
  assert.equal(secondFailure.event.status, "dead_letter");
  assert.equal(holder.get().referralSystem[DEAD_LETTER_COLLECTION].length, 1);

  const replay = await service.replayDeadLetter({
    eventId: holder.eventId,
    replayId: "commission-replay-001",
    actor: { username: "commission", role: "commission" },
    reason: "approved after downstream transport recovery"
  });
  assert.equal(replay.replayed, false);
  assert.equal(replay.event.status, "retry_wait");
  assert.equal(replay.event.attempts, 0);
  assert.equal(holder.get().referralSystem[REPLAY_COLLECTION].length, 1);

  const replayClaim = (await service.claim({ workerId: "worker-after-replay" }))[0];
  assert.equal(replayClaim.id, holder.eventId);
  assert.equal(holder.get().referralSystem[OUTBOX_COLLECTION][0].status, "leased");
  const idempotentReplay = await service.replayDeadLetter({
    eventId: holder.eventId,
    replayId: "commission-replay-001",
    actor: { username: "commission", role: "commission" },
    reason: "approved after downstream transport recovery"
  });
  assert.equal(idempotentReplay.replayed, true);
  assert.equal(idempotentReplay.event.status, "retry_wait");
  assert.equal(idempotentReplay.event.attempts, 0);
  assert.equal(holder.get().referralSystem[REPLAY_COLLECTION].length, 1);
  await assert.rejects(
    () => service.replayDeadLetter({
      eventId: holder.eventId,
      replayId: "commission-replay-001",
      actor: { username: "commission", role: "commission" },
      reason: "different replay reason is rejected"
    }),
    (error) => error.code === "REFERRAL_DELIVERY_REPLAY_CONFLICT"
  );
});

test("expired leases at the attempt limit move to dead letter without another claim", async () => {
  const holder = await stateWithEvent();
  let clock = "2026-08-03T09:01:00.000Z";
  const service = createReferralDeliveryService({
    readState: holder.get,
    writeState: holder.set,
    now: () => clock,
    maxAttempts: 1
  });
  await service.claim({ workerId: "crashed-worker", leaseSeconds: 1 });
  clock = "2026-08-03T09:01:02.000Z";
  assert.equal((await service.claim({ workerId: "replacement-worker" })).length, 0);
  assert.equal(holder.get().referralSystem[OUTBOX_COLLECTION][0].status, "dead_letter");
  assert.equal(holder.get().referralSystem[DEAD_LETTER_COLLECTION][0].errorCode, "DELIVERY_LEASE_EXPIRED");
});

test("command and replay evidence collections are not truncated at a fixed capacity", async () => {
  let state = fixture();
  state.referralSystem[OUTBOX_COLLECTION] = Array.from({ length: 1000 }, (_, index) => ({
    id: `historic-event-${index}`,
    status: "delivered",
    payload: { contract: {} }
  }));
  state.referralSystem[INBOX_COLLECTION] = Array.from({ length: 1000 }, (_, index) => ({
    commandId: `historic-command-${index}`,
    eventId: `historic-event-${index}`
  }));
  await createReferralCommandService({
    readState: () => state,
    writeState: (next) => { state = next; },
    now: () => "2026-08-03T10:00:00.000Z"
  }).update({
    referralId: "rf1",
    commandId: "capacity-proof-command",
    expectedVersion: 1,
    input: { status: "accepted" }
  });
  assert.equal(state.referralSystem[OUTBOX_COLLECTION].length, 1001);
  assert.equal(state.referralSystem[INBOX_COLLECTION].length, 1001);
  assert.equal(state.referralSystem[OUTBOX_COLLECTION].some((item) => item.id === "historic-event-999"), true);
  assert.equal(state.referralSystem[INBOX_COLLECTION].some((item) => item.commandId === "historic-command-999"), true);
});

test("T05 routes expose minimal commission operations and idempotent dead-letter replay", async () => {
  const holder = await stateWithEvent();
  const event = holder.get().referralSystem[OUTBOX_COLLECTION][0];
  event.status = "dead_letter";
  event.attempts = 5;
  event.deadLetteredAt = "2026-08-03T09:05:00.000Z";
  event.lease = { token: "must-not-leak", expiresAt: "2026-08-03T09:04:00.000Z" };
  const responses = [];
  let payload = { reason: "approved after downstream transport recovery" };
  const runtime = {
    appendSecurityEvent: () => undefined,
    collectJson: async () => payload,
    readDatabase: holder.get,
    requireApiRole: () => ({ username: "commission", name: "Commission", role: "commission" }),
    sendJson: (res, status, body) => {
      responses.push({ status, body });
      res.statusCode = status;
      res.body = body;
    },
    writeDatabase: holder.set
  };
  const segment = createRouteSegments(runtime).find((item) => item.id === "care-coordination-10");

  const getResponse = {};
  await segment.handle(
    { method: "GET", headers: {} },
    getResponse,
    new URL("http://localhost/api/referrals/outbox/delivery")
  );
  assert.equal(getResponse.statusCode, 200);
  assert.equal(getResponse.body.productionReady, false);
  assert.doesNotMatch(JSON.stringify(getResponse.body), /must-not-leak|residentId|payload|leaseToken/);

  const replayRequest = {
    method: "POST",
    headers: { "idempotency-key": "route-replay-001" }
  };
  const replayUrl = new URL(`http://localhost/api/referrals/outbox/delivery/${encodeURIComponent(holder.eventId)}/replay`);
  await segment.handle(replayRequest, {}, replayUrl);
  assert.equal(responses.at(-1).status, 202);
  assert.equal(responses.at(-1).body.productionReady, false);
  assert.equal("payload" in responses.at(-1).body.event, false);
  await segment.handle(replayRequest, {}, replayUrl);
  assert.equal(responses.at(-1).status, 200);
  assert.equal(responses.at(-1).body.idempotentReplay, true);

  payload = { reason: "different replay intent must conflict" };
  await segment.handle(replayRequest, {}, replayUrl);
  assert.equal(responses.at(-1).status, 409);
  assert.equal(responses.at(-1).body.code, "REFERRAL_DELIVERY_REPLAY_CONFLICT");
});
