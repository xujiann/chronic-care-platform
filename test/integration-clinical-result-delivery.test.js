"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const delivery = require("../src/http/routes/t08-clinical-result-exchange");
const integrationRoutes = require("../src/http/routes/integration");

const CONTRACT = Object.freeze({
  id: "lis-report-v1",
  domain: "LIS",
  version: "1.0.0",
  requiredFields: ["externalId", "residentId", "item", "result", "reportedAt"]
});

function payload(overrides = {}) {
  return {
    contractId: CONTRACT.id,
    idempotencyKey: "delivery-result-001",
    externalId: "DELIVERY-RESULT-001",
    residentId: "resident-1",
    item: "HbA1c",
    result: "6.8%",
    reportedAt: "2026-08-03T08:00:00.000Z",
    ...overrides
  };
}

function gatewayEvent(input, contract) {
  return {
    id: `gateway-${input.externalId}`,
    contractId: contract.id,
    domain: contract.domain,
    idempotencyKey: input.idempotencyKey,
    externalId: input.externalId,
    residentId: input.residentId,
    status: "received",
    reconciliationStatus: "pending"
  };
}

async function acceptedState(input = payload()) {
  const data = { integrationGatewayEvents: [], securityEvents: [] };
  const accepted = await delivery.receiveClinicalResult({
    data,
    payload: input,
    contract: CONTRACT,
    user: { username: "hospital", name: "Hospital Operator", role: "institution" },
    correlationId: `correlation-${input.idempotencyKey}`,
    normalizeIntegrationEvent: gatewayEvent,
    prependAuditTrailEntry: (rows, entry) => [entry, ...(rows || [])],
    writeDatabase() {}
  });
  return { data: structuredClone(data), accepted };
}

function verifiedReceipt(claim, receivedAt, overrides = {}) {
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

test("persistent repository transaction atomically grants a clinical result lease once", async () => {
  const initial = await acceptedState();
  let state = structuredClone(initial.data);
  let writes = 0;
  const repository = {
    readDatabase: () => structuredClone(state),
    writeDatabase: (next) => {
      writes += 1;
      state = structuredClone(next);
    }
  };
  const now = "2030-08-03T09:00:00.000Z";
  const [left, right] = await Promise.all([
    delivery.transactClinicalResultDelivery(repository, (data) =>
      delivery.claimClinicalResultDeliveries(data, { workerId: "worker-left", now, limit: 1 })),
    delivery.transactClinicalResultDelivery(repository, (data) =>
      delivery.claimClinicalResultDeliveries(data, { workerId: "worker-right", now, limit: 1 }))
  ]);
  assert.equal(left.length + right.length, 1);
  assert.equal(writes, 1);
  const outbox = state.integrationGatewayEvents[0].outbox;
  assert.equal(outbox.status, "processing");
  assert.equal(outbox.attempts, 1);
  assert.match(outbox.leaseToken, /^lease-/);
  assert.equal(outbox.productionReady, false);
});

test("expired leases are reclaimed and stale workers cannot ack or fail", async () => {
  const { data } = await acceptedState();
  const [staleClaim] = delivery.claimClinicalResultDeliveries(data, {
    workerId: "worker-stale",
    now: "2030-08-03T09:00:00.000Z",
    leaseMs: 1_000
  });
  const [activeClaim] = delivery.claimClinicalResultDeliveries(data, {
    workerId: "worker-active",
    now: "2030-08-03T09:00:02.000Z",
    leaseMs: 10_000
  });
  assert.equal(activeClaim.attempt, 2);
  assert.notEqual(activeClaim.leaseToken, staleClaim.leaseToken);
  assert.throws(
    () => delivery.acknowledgeClinicalResultDelivery(
      data,
      staleClaim,
      verifiedReceipt(staleClaim, "2030-08-03T09:00:02.500Z")
    ),
    (error) => error.code === "CLINICAL_RESULT_DELIVERY_LEASE_CONFLICT"
  );
  assert.throws(
    () => delivery.failClinicalResultDelivery(
      data,
      staleClaim,
      { errorCode: "STALE", message: "stale worker" },
      { now: "2030-08-03T09:00:02.500Z" }
    ),
    (error) => error.code === "CLINICAL_RESULT_DELIVERY_LEASE_CONFLICT"
  );
  const ack = delivery.acknowledgeClinicalResultDelivery(
    data,
    activeClaim,
    verifiedReceipt(activeClaim, "2030-08-03T09:00:03.000Z")
  );
  assert.equal(ack.status, "published");
  assert.equal(ack.receipt.productionEvidence, false);
});

test("ack requires payload-bound verified receipt and exact duplicate ack is idempotent", async () => {
  const { data } = await acceptedState();
  const [claim] = delivery.claimClinicalResultDeliveries(data, {
    workerId: "worker-ack",
    now: "2030-08-03T10:00:00.000Z",
    leaseMs: 10_000
  });
  assert.throws(
    () => delivery.acknowledgeClinicalResultDelivery(data, claim, verifiedReceipt(
      claim,
      "2030-08-03T10:00:01.000Z",
      { signatureVerified: false }
    )),
    (error) => error.code === "CLINICAL_RESULT_DELIVERY_RECEIPT_INVALID"
  );
  const receipt = verifiedReceipt(claim, "2030-08-03T10:00:01.000Z");
  const first = delivery.acknowledgeClinicalResultDelivery(data, claim, receipt);
  const duplicate = delivery.acknowledgeClinicalResultDelivery(data, claim, receipt);
  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.throws(
    () => delivery.acknowledgeClinicalResultDelivery(data, claim, {
      ...receipt,
      providerMessageId: "provider-conflict"
    }),
    (error) => error.code === "CLINICAL_RESULT_DELIVERY_ACK_CONFLICT"
  );
  assert.equal(data.integrationGatewayEvents[0].outbox.status, "published");
});

test("retry backs off, exhausts into dead letter, and commission replay is idempotent", async () => {
  const { data } = await acceptedState();
  const event = data.integrationGatewayEvents[0];
  event.outbox = delivery.createDeliveryOutbox(
    event.domainEvent,
    event.contractReceipt.canonicalDigest,
    "2030-08-03T11:00:00.000Z",
    { maxAttempts: 2 }
  );
  const [first] = delivery.claimClinicalResultDeliveries(data, {
    workerId: "worker-retry",
    now: "2030-08-03T11:00:00.000Z"
  });
  const retry = delivery.failClinicalResultDelivery(
    data,
    first,
    { errorCode: "UPSTREAM_TIMEOUT", message: "timeout with private diagnostic" },
    { now: "2030-08-03T11:00:00.500Z", retryBaseMs: 1_000 }
  );
  assert.equal(retry.status, "pending");
  assert.equal(retry.nextAttemptAt, "2030-08-03T11:00:01.500Z");
  assert.equal(delivery.claimClinicalResultDeliveries(data, {
    workerId: "worker-early",
    now: "2030-08-03T11:00:01.000Z"
  }).length, 0);
  const [second] = delivery.claimClinicalResultDeliveries(data, {
    workerId: "worker-retry",
    now: "2030-08-03T11:00:02.000Z"
  });
  const exhausted = delivery.failClinicalResultDelivery(
    data,
    second,
    { errorCode: "UPSTREAM_TIMEOUT", message: "timeout again" },
    { now: "2030-08-03T11:00:02.500Z" }
  );
  assert.equal(exhausted.status, "dead-letter");
  assert.equal(event.outbox.lastErrorCode, "UPSTREAM_TIMEOUT");
  assert.match(event.outbox.lastErrorDigest, /^sha256:/);
  assert.equal(JSON.stringify(event.outbox).includes("private diagnostic"), false);

  const actor = { role: "commission", username: "operator" };
  assert.throws(
    () => delivery.replayClinicalResultDelivery(
      data,
      event.domainEvent.id,
      { idempotencyKey: "replay-1", reason: "approved recovery" },
      { role: "institution" }
    ),
    (error) => error.code === "CLINICAL_RESULT_DELIVERY_REPLAY_FORBIDDEN"
  );
  const replay = delivery.replayClinicalResultDelivery(
    data,
    event.domainEvent.id,
    { idempotencyKey: "replay-1", reason: "approved recovery" },
    actor,
    { now: "2030-08-03T11:01:00.000Z" }
  );
  const duplicate = delivery.replayClinicalResultDelivery(
    data,
    event.domainEvent.id,
    { idempotencyKey: "replay-1", reason: "approved recovery" },
    actor,
    { now: "2030-08-03T11:01:01.000Z" }
  );
  assert.deepEqual(replay, { duplicate: false, status: "pending", generation: 2 });
  assert.deepEqual(duplicate, { duplicate: true, status: "pending", generation: 2 });
  assert.throws(
    () => delivery.replayClinicalResultDelivery(
      data,
      event.domainEvent.id,
      { idempotencyKey: "replay-1", reason: "changed reason" },
      actor
    ),
    (error) => error.code === "CLINICAL_RESULT_DELIVERY_REPLAY_CONFLICT"
  );
});

test("operations query exposes delivery metadata only and replay route never claims production readiness", async () => {
  const { data } = await acceptedState();
  const event = data.integrationGatewayEvents[0];
  event.outbox = delivery.createDeliveryOutbox(
    event.domainEvent,
    event.contractReceipt.canonicalDigest,
    "2030-08-03T12:00:00.000Z",
    { maxAttempts: 1 }
  );
  const [claim] = delivery.claimClinicalResultDeliveries(data, {
    workerId: "worker-route",
    now: "2030-08-03T12:00:00.000Z"
  });
  delivery.failClinicalResultDelivery(
    data,
    claim,
    { errorCode: "NO_TRANSPORT", message: "transport unavailable" },
    { now: "2030-08-03T12:00:01.000Z" }
  );
  let state = structuredClone(data);
  let responseStatus;
  let responseBody;
  let writes = 0;
  const segments = integrationRoutes.createRouteSegments({
    collectJson: async () => ({ idempotencyKey: "route-replay-1", reason: "operator approved retry" }),
    prependAuditTrailEntry: (rows, entry) => [entry, ...(rows || [])],
    randomUUID: () => "audit-clinical-result-replay",
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
  const segment = segments[1];
  await segment.handle(
    { method: "GET", headers: {} },
    {},
    new URL("http://local/api/integration/clinical-results/deliveries?status=dead-letter")
  );
  assert.equal(responseStatus, 200);
  assert.equal(responseBody.productionReady, false);
  assert.equal(responseBody.deliveries.length, 1);
  assert.equal("leaseToken" in responseBody.deliveries[0], false);
  assert.equal("canonicalPayload" in responseBody.deliveries[0], false);
  assert.equal("residentId" in responseBody.deliveries[0], false);
  assert.equal("resultId" in responseBody.deliveries[0], false);

  await segment.handle(
    { method: "POST", headers: {} },
    {},
    new URL(`http://local/api/integration/clinical-results/deliveries/${event.domainEvent.id}/replay`)
  );
  assert.equal(responseStatus, 200);
  assert.equal(responseBody.productionReady, false);
  assert.equal(responseBody.status, "pending");
  assert.equal(writes, 1);
  assert.equal(state.integrationGatewayEvents[0].outbox.status, "pending");
  assert.equal(state.securityEvents[0].action, "重放临床结果死信交付");
});

test("clinical result idempotency evidence survives more than 200 gateway events", async () => {
  const original = payload();
  const { data, accepted } = await acceptedState(original);
  data.integrationGatewayEvents = [
    ...Array.from({ length: 205 }, (_, index) => ({
      id: `filler-${index}`,
      contractId: "other-contract",
      idempotencyKey: `filler-key-${index}`
    })),
    ...data.integrationGatewayEvents
  ];
  let writes = 0;
  const options = {
    data,
    payload: original,
    contract: CONTRACT,
    user: { username: "hospital", name: "Hospital Operator", role: "institution" },
    correlationId: "old-key-replay",
    normalizeIntegrationEvent: gatewayEvent,
    prependAuditTrailEntry: (rows, entry) => [entry, ...(rows || [])],
    writeDatabase() {
      writes += 1;
    }
  };
  const replay = await delivery.receiveClinicalResult(options);
  assert.equal(replay.duplicate, true);
  assert.equal(replay.event.domainEvent.id, accepted.event.domainEvent.id);
  assert.equal(writes, 0);
  await assert.rejects(
    delivery.receiveClinicalResult({
      ...options,
      payload: { ...original, result: "7.4%" }
    }),
    (error) => error.code === "CLINICAL_RESULT_IDEMPOTENCY_CONFLICT"
  );
  assert.equal(data.integrationGatewayEvents.length, 206);

  await delivery.receiveClinicalResult({
    ...options,
    payload: payload({
      idempotencyKey: "delivery-result-002",
      externalId: "DELIVERY-RESULT-002"
    })
  });
  assert.equal(writes, 1);
  assert.equal(data.integrationGatewayEvents.length, 207);
  assert.ok(data.integrationGatewayEvents.some((item) =>
    item.domainEvent?.id === accepted.event.domainEvent.id));
});
