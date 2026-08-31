"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const delivery = require("../src/http/routes/t06-emergency-signal-delivery");
const {
  OUTBOX_COLLECTION,
  updateEmergencySignal
} = require("../src/http/routes/t06-emergency-signal-write");
const emergencySignalRoute = require("../src/http/routes/clinical-specialties/emergency-signals");

async function seededState() {
  let state = {
    emergencySignals: [{
      id: "signal-1",
      residentId: "resident-1",
      location: "private-location",
      clinicalDetail: "private-clinical-detail",
      region: "中山区",
      level: "high",
      status: "pending"
    }],
    authOrganizations: [
      { orgCode: "ORG-DIST-ZS", name: "中山区健康城市平台", orgType: "district", parentCode: "ORG-CITY-DL", dataScope: "本区市县" },
      { orgCode: "ORG-CONSORTIUM-ZS", name: "中山区县域医共体", orgType: "county_consortium", parentCode: "ORG-DIST-ZS", dataScope: "医共体成员机构" }
    ],
    emergencyAuditEvents: [],
    emergencySignalCommandInbox: [],
    securityEvents: [],
    storageMeta: { collectionVersions: { emergencySignals: 1 } }
  };
  const accepted = await updateEmergencySignal({
    id: "signal-1",
    payload: { expectedVersion: 1, status: "acknowledged" },
    user: {
      username: "county-duty",
      name: "County Duty",
      role: "county",
      orgCode: "ORG-CONSORTIUM-ZS",
      orgName: "中山区县域医共体",
      dataScope: "医共体成员机构"
    },
    correlationId: "emergency-delivery-correlation",
    causationId: "emergency-delivery-command",
    readDatabase: () => structuredClone(state),
    prependAuditTrailEntry: (rows, entry) => [entry, ...(rows || [])],
    writeDatabase(next) {
      state = structuredClone(next);
    }
  });
  return { state, accepted };
}

function receiptFor(claim, receivedAt, overrides = {}) {
  return {
    status: "delivered",
    providerMessageId: `provider-${claim.eventId}`,
    eventId: claim.eventId,
    payloadDigest: claim.payloadDigest,
    receivedAt,
    transportVerified: true,
    signatureVerified: true,
    ...overrides
  };
}

test("emergency signal aggregate, inbox, audit and delivery outbox share one persisted commit", async () => {
  const { state, accepted } = await seededState();
  const row = state[OUTBOX_COLLECTION][0];
  assert.equal(row.id, accepted.event.id);
  assert.equal(row.delivery.schema, delivery.DELIVERY_SCHEMA);
  assert.equal(row.delivery.status, "pending");
  assert.equal(row.delivery.productionReady, false);
  assert.equal(state.emergencySignalCommandInbox[0].eventId, row.id);
  assert.equal(state.securityEvents[0].domainEvent.id, row.id);
  assert.equal(state.securityEvents[0].ownershipContract.unitOfWork, true);
});

test("repository transaction grants one lease and rejects a stale worker", async () => {
  const seeded = await seededState();
  let state = structuredClone(seeded.state);
  let writes = 0;
  const repository = {
    readDatabase: () => structuredClone(state),
    writeDatabase(next) {
      writes += 1;
      state = structuredClone(next);
    }
  };
  const now = "2030-08-03T09:00:00.000Z";
  const [left, right] = await Promise.all([
    delivery.transactEmergencySignalDelivery(repository, (data) =>
      delivery.claimEmergencySignalDeliveries(data, {
        workerId: "worker-left",
        now,
        leaseMs: 1_000,
        limit: 1
      })),
    delivery.transactEmergencySignalDelivery(repository, (data) =>
      delivery.claimEmergencySignalDeliveries(data, {
        workerId: "worker-right",
        now,
        leaseMs: 1_000,
        limit: 1
      }))
  ]);
  assert.equal(left.length + right.length, 1);
  assert.equal(writes, 1);
  const stale = left[0] || right[0];
  assert.equal(state[OUTBOX_COLLECTION][0].outboxStatus, "processing");

  const [active] = await delivery.transactEmergencySignalDelivery(repository, (data) =>
    delivery.claimEmergencySignalDeliveries(data, {
      workerId: "worker-active",
      now: "2030-08-03T09:00:02.000Z",
      leaseMs: 10_000,
      limit: 1
    }));
  assert.equal(active.attempt, 2);
  await assert.rejects(
    delivery.transactEmergencySignalDelivery(repository, (data) =>
      delivery.acknowledgeEmergencySignalDelivery(
        data,
        stale,
        receiptFor(stale, "2030-08-03T09:00:03.000Z")
      )),
    (error) => error.code === "EMERGENCY_SIGNAL_DELIVERY_LEASE_CONFLICT"
  );
  const ack = await delivery.transactEmergencySignalDelivery(repository, (data) =>
    delivery.acknowledgeEmergencySignalDelivery(
      data,
      active,
      receiptFor(active, "2030-08-03T09:00:03.000Z")
  ));
  assert.equal(ack.status, "published");
  assert.equal(ack.receipt.productionEvidence, false);
  assert.equal(state[OUTBOX_COLLECTION][0].outboxStatus, "published");
});

test("receipt validation is payload-bound and duplicate acknowledgement is exact", async () => {
  const { state } = await seededState();
  const [claim] = delivery.claimEmergencySignalDeliveries(state, {
    workerId: "worker-ack",
    now: "2030-08-03T10:00:00.000Z"
  });
  assert.throws(
    () => delivery.acknowledgeEmergencySignalDelivery(
      state,
      claim,
      receiptFor(claim, "2030-08-03T10:00:01.000Z", { signatureVerified: false })
    ),
    (error) => error.code === "EMERGENCY_SIGNAL_DELIVERY_RECEIPT_INVALID"
  );
  const receipt = receiptFor(claim, "2030-08-03T10:00:01.000Z");
  assert.equal(delivery.acknowledgeEmergencySignalDelivery(state, claim, receipt).duplicate, false);
  assert.equal(delivery.acknowledgeEmergencySignalDelivery(state, claim, receipt).duplicate, true);
  assert.throws(
    () => delivery.acknowledgeEmergencySignalDelivery(state, claim, {
      ...receipt,
      providerMessageId: "provider-conflict"
    }),
    (error) => error.code === "EMERGENCY_SIGNAL_DELIVERY_ACK_CONFLICT"
  );
});

test("delivery integrity binds the stored state to the immutable outbox event", async () => {
  const { state } = await seededState();
  state[OUTBOX_COLLECTION][0].payload.status = "tampered";
  assert.throws(
    () => delivery.claimEmergencySignalDeliveries(state, {
      workerId: "worker-integrity",
      now: "2030-08-03T10:30:00.000Z"
    }),
    (error) => error.code === "EMERGENCY_SIGNAL_DELIVERY_INTEGRITY_INVALID"
  );
});

test("retry exhausts into dead letter and commission replay is durable and idempotent", async () => {
  const { state } = await seededState();
  const row = state[OUTBOX_COLLECTION][0];
  row.delivery = delivery.createEmergencySignalDelivery(row, {
    now: "2030-08-03T11:00:00.000Z",
    maxAttempts: 1
  });
  const [claim] = delivery.claimEmergencySignalDeliveries(state, {
    workerId: "worker-retry",
    now: "2030-08-03T11:00:00.000Z"
  });
  const failed = delivery.failEmergencySignalDelivery(
    state,
    claim,
    { errorCode: "TRANSPORT_DOWN", message: "private endpoint diagnostic" },
    { now: "2030-08-03T11:00:01.000Z" }
  );
  assert.equal(failed.status, "dead-letter");
  assert.equal(row.outboxStatus, "dead-letter");
  assert.equal(JSON.stringify(row.delivery).includes("private endpoint diagnostic"), false);
  const actor = { role: "commission", username: "operator" };
  const replay = delivery.replayEmergencySignalDelivery(
    state,
    row.id,
    { idempotencyKey: "replay-1", reason: "approved recovery" },
    actor,
    { now: "2030-08-03T11:01:00.000Z" }
  );
  const duplicate = delivery.replayEmergencySignalDelivery(
    state,
    row.id,
    { idempotencyKey: "replay-1", reason: "approved recovery" },
    actor
  );
  assert.deepEqual(replay, { duplicate: false, status: "pending", generation: 2 });
  assert.deepEqual(duplicate, { duplicate: true, status: "pending", generation: 2 });
  assert.equal(row.outboxStatus, "pending");
  assert.equal(Object.hasOwn(row.delivery.replayHistory[0], "idempotencyKey"), false);
  assert.match(row.delivery.replayHistory[0].idempotencyKeyDigest, /^sha256:[a-f0-9]{64}$/);
  assert.throws(
    () => delivery.replayEmergencySignalDelivery(
      state,
      row.id,
      { idempotencyKey: "replay-1", reason: "changed reason" },
      actor
    ),
    (error) => error.code === "EMERGENCY_SIGNAL_DELIVERY_REPLAY_CONFLICT"
  );
});

test("replay identities are retained across more than twenty recovery generations", async () => {
  const { state } = await seededState();
  const row = state[OUTBOX_COLLECTION][0];
  row.delivery = delivery.createEmergencySignalDelivery(row, {
    now: "2030-08-03T12:00:00.000Z",
    maxAttempts: 1
  });
  const actor = { role: "commission", username: "operator" };
  for (let index = 0; index < 25; index += 1) {
    const claimedAt = new Date(Date.parse("2030-08-03T12:00:00.000Z") + index * 10_000);
    const [claim] = delivery.claimEmergencySignalDeliveries(state, {
      workerId: "worker-retention",
      now: claimedAt.toISOString()
    });
    delivery.failEmergencySignalDelivery(
      state,
      claim,
      { errorCode: "TRANSPORT_DOWN", message: `failure-${index}` },
      { now: new Date(claimedAt.getTime() + 1_000).toISOString() }
    );
    delivery.replayEmergencySignalDelivery(
      state,
      row.id,
      { idempotencyKey: `replay-${index}`, reason: `approved ${index}` },
      actor,
      { now: new Date(claimedAt.getTime() + 2_000).toISOString() }
    );
  }
  assert.equal(row.delivery.replayHistory.length, 25);
  assert.deepEqual(
    delivery.replayEmergencySignalDelivery(
      state,
      row.id,
      { idempotencyKey: "replay-0", reason: "approved 0" },
      actor
    ),
    { duplicate: true, status: "pending", generation: 2 }
  );
});

test("operations route exposes minimal metadata and persists replay with its audit", async () => {
  const seeded = await seededState();
  let state = structuredClone(seeded.state);
  const row = state[OUTBOX_COLLECTION][0];
  row.delivery = delivery.createEmergencySignalDelivery(row, {
    now: "2030-08-03T13:00:00.000Z",
    maxAttempts: 1
  });
  const [claim] = delivery.claimEmergencySignalDeliveries(state, {
    workerId: "worker-route",
    now: "2030-08-03T13:00:00.000Z"
  });
  delivery.failEmergencySignalDelivery(
    state,
    claim,
    { errorCode: "NO_TRANSPORT", message: "transport unavailable" },
    { now: "2030-08-03T13:00:01.000Z" }
  );
  let responseStatus;
  let responseBody;
  let writes = 0;
  const segment = emergencySignalRoute.createRouteSegment({
    collectJson: async () => ({
      idempotencyKey: "route-replay-1",
      reason: "operator approved retry"
    }),
    prependAuditTrailEntry: (rows, entry) => [entry, ...(rows || [])],
    readDatabase: () => structuredClone(state),
    requireApiRole: () => ({ role: "commission", username: "operator", name: "Operator" }),
    sendJson: (_res, status, body) => {
      responseStatus = status;
      responseBody = body;
    },
    writeDatabase: (next) => {
      writes += 1;
      state = structuredClone(next);
    }
  });
  await segment.handle(
    { method: "GET", headers: {} },
    {},
    new URL("http://local/api/emergency-signals/deliveries?status=dead-letter")
  );
  assert.equal(responseStatus, 200);
  assert.equal(responseBody.productionReady, false);
  assert.equal(responseBody.deliveries.length, 1);
  assert.equal("leaseToken" in responseBody.deliveries[0], false);
  assert.equal("residentId" in responseBody.deliveries[0], false);
  assert.doesNotMatch(JSON.stringify(responseBody), /private-location|private-clinical-detail/);

  await segment.handle(
    { method: "POST", headers: {} },
    {},
    new URL(`/api/emergency-signals/deliveries/${row.id}/replay`, "http://local")
  );
  assert.equal(responseStatus, 200);
  assert.equal(responseBody.productionReady, false);
  assert.equal(responseBody.status, "pending");
  assert.equal(writes, 1);
  assert.equal(state[OUTBOX_COLLECTION][0].delivery.status, "pending");
  assert.equal(state.securityEvents[0].ownershipContract.unitOfWork, true);
});
