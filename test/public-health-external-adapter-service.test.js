const test = require("node:test");
const assert = require("node:assert/strict");
const {
  EXTERNAL_ADAPTER_PROFILES,
  buildPublicHealthExternalAdapterRegistry,
  createPublicHealthExternalDispatch,
  receiptSchemaForRequest,
  recordPublicHealthExternalDeliveryAttempt,
  signPublicHealthExternalReceipt,
  verifyPublicHealthExternalDispatch,
  verifyPublicHealthExternalReceipt
} = require("../public-health-external-adapter-service");

const REQUEST_SECRET = "request-secret-1234567890-1234567890";
const RECEIPT_SECRET = "receipt-secret-1234567890-1234567890";

function inProgressHandoff(laneId = "immunization") {
  return {
    id: `phc-${laneId}-001`,
    laneId,
    state: "in-progress",
    version: 3,
    businessKey: `business-${laneId}`,
    residentId: "resident-must-not-leak"
  };
}

function credentials(overrides = {}) {
  return {
    endpoint: "https://public-health.example.test/dispatch",
    requestSecret: REQUEST_SECRET,
    receiptSecret: RECEIPT_SECRET,
    ...overrides
  };
}

function acceptedReceipt(dispatch, overrides = {}) {
  return signPublicHealthExternalReceipt({
    schemaVersion: receiptSchemaForRequest(dispatch.request.schemaVersion),
    dispatchId: dispatch.id,
    requestDigest: dispatch.requestDigest,
    laneId: dispatch.laneId,
    handoffId: dispatch.handoffId,
    status: "accepted",
    receiptCode: "EXT-ACCEPT-001",
    evidenceRefs: ["external-registry-receipt"],
    receivedAt: "2026-07-22T08:00:00.000Z",
    ...overrides
  }, RECEIPT_SECRET);
}

test("external adapter registry covers all eight lanes without exposing configuration values", () => {
  const env = {};
  EXTERNAL_ADAPTER_PROFILES.forEach((profile) => {
    env[profile.endpointEnv] = `https://${profile.laneId}.example.test/dispatch`;
    env[profile.requestSecretEnv] = REQUEST_SECRET;
    env[profile.receiptSecretEnv] = RECEIPT_SECRET;
  });
  const registry = buildPublicHealthExternalAdapterRegistry(env);
  assert.equal(registry.ok, true);
  assert.equal(registry.summary.adapters, 8);
  assert.equal(registry.summary.configured, 8);
  assert.equal(registry.productionReady, false);
  assert.equal(JSON.stringify(registry).includes(REQUEST_SECRET), false);
  assert.equal(JSON.stringify(registry).includes("example.test/dispatch"), false);
});

test("external dispatch is deterministic, signed and excludes resident identifiers", () => {
  const handoff = inProgressHandoff("chronic-management");
  const input = { idempotencyKey: "chronic:dispatch:001", operation: "upsert-plan", evidenceRefs: ["risk-assessment"] };
  const first = createPublicHealthExternalDispatch(handoff, input, credentials());
  const replay = createPublicHealthExternalDispatch(handoff, input, credentials());
  assert.equal(first.id, replay.id);
  assert.equal(first.requestDigest, replay.requestDigest);
  assert.equal(first.requestSignature, replay.requestSignature);
  assert.equal(JSON.stringify(first).includes(handoff.residentId), false);
  assert.equal(JSON.stringify(first).includes(input.idempotencyKey), false);
  assert.equal(JSON.stringify(first).includes(REQUEST_SECRET), false);
  assert.deepEqual(verifyPublicHealthExternalDispatch(first, REQUEST_SECRET), { ok: true, reason: "verified" });
  assert.equal(first.productionReady, false);
});

test("governed next-version dispatch and receipt bind the contract schema version", () => {
  const dispatch = createPublicHealthExternalDispatch(
    inProgressHandoff("family-doctor"),
    {
      idempotencyKey: "family:dispatch:v2",
      operation: "coordinate-v2",
      at: "2026-07-25T00:00:00.000Z"
    },
    credentials({
      contractBinding: {
        contract: "family-doctor-fulfillment-v2",
        requestSchemaVersion: "public-health-external-dispatch/v2",
        receiptSchemaVersion: "public-health-external-receipt/v2"
      }
    })
  );
  assert.equal(dispatch.contract, "family-doctor-fulfillment-v2");
  assert.equal(dispatch.request.contract, "family-doctor-fulfillment-v2");
  assert.equal(dispatch.request.schemaVersion, "public-health-external-dispatch/v2");
  assert.equal(verifyPublicHealthExternalDispatch(dispatch, REQUEST_SECRET).ok, true);
  const receipt = acceptedReceipt(dispatch, {
    receivedAt: "2026-07-25T00:00:10.000Z"
  });
  assert.equal(receipt.schemaVersion, "public-health-external-receipt/v2");
  assert.equal(verifyPublicHealthExternalReceipt(
    dispatch,
    receipt,
    RECEIPT_SECRET,
    { at: "2026-07-25T00:00:20.000Z", enforceFreshness: true }
  ).ok, true);
  assert.equal(verifyPublicHealthExternalReceipt(
    dispatch,
    { ...receipt, schemaVersion: "public-health-external-receipt/v1" },
    RECEIPT_SECRET
  ).reason, "receipt-binding-mismatch");
  assert.throws(() => createPublicHealthExternalDispatch(
    inProgressHandoff("family-doctor"),
    { idempotencyKey: "family:dispatch:v2-mismatch" },
    credentials({
      contractBinding: {
        contract: "family-doctor-fulfillment-v2",
        requestSchemaVersion: "public-health-external-dispatch/v1",
        receiptSchemaVersion: "public-health-external-receipt/v2"
      }
    })
  ), /schema versions must match/);
});

test("persisted dispatch tampering invalidates its request signature and bindings", () => {
  const dispatch = createPublicHealthExternalDispatch(
    inProgressHandoff("public-health-followup"),
    { idempotencyKey: "followup:dispatch:tamper" },
    credentials()
  );
  assert.equal(verifyPublicHealthExternalDispatch({
    ...dispatch,
    request: { ...dispatch.request, operation: "forged-operation" }
  }, REQUEST_SECRET).ok, false);
  assert.equal(verifyPublicHealthExternalDispatch({
    ...dispatch,
    handoffId: "phc-forged-001"
  }, REQUEST_SECRET).ok, false);
  assert.equal(verifyPublicHealthExternalDispatch({
    ...dispatch,
    requestSignature: "0".repeat(64)
  }, REQUEST_SECRET).ok, false);
});

test("verified accepted receipt completes delivery but not production readiness", () => {
  const dispatch = createPublicHealthExternalDispatch(
    inProgressHandoff("maternal-child"),
    { idempotencyKey: "mch:dispatch:001", evidenceRefs: ["maternal-enrollment-receipt"] },
    credentials()
  );
  const delivered = recordPublicHealthExternalDeliveryAttempt(dispatch, {
    transportStatus: 200,
    receipt: acceptedReceipt(dispatch)
  }, { receiptSecret: RECEIPT_SECRET, at: "2026-07-22T08:01:00.000Z" });
  assert.equal(delivered.deliveryState, "delivered");
  assert.equal(delivered.receipt.status, "accepted");
  assert.equal(verifyPublicHealthExternalReceipt(delivered, delivered.receipt, RECEIPT_SECRET).ok, true);
  assert.equal(delivered.attempts[0].outcome, "accepted");
  assert.match(delivered.attempts[0].receiptDigest, /^[a-f0-9]{64}$/);
  assert.equal(delivered.productionReady, false);
  assert.match(delivered.blocker, /Trusted site evidence/);
});

test("receipt tampering cannot pass trusted verification", () => {
  const dispatch = createPublicHealthExternalDispatch(
    inProgressHandoff("family-doctor"),
    { idempotencyKey: "family:dispatch:001" },
    credentials()
  );
  const receipt = acceptedReceipt(dispatch);
  for (const mutation of [
    { status: "rejected" },
    { laneId: "immunization" },
    { requestDigest: "0".repeat(64) },
    { evidenceRefs: ["forged-evidence"] }
  ]) {
    const forged = { ...receipt, ...mutation };
    assert.equal(verifyPublicHealthExternalReceipt(dispatch, forged, RECEIPT_SECRET).ok, false);
  }
  const failed = recordPublicHealthExternalDeliveryAttempt(dispatch, {
    transportStatus: 200,
    receipt: { ...receipt, status: "rejected" }
  }, { receiptSecret: RECEIPT_SECRET, at: "2026-07-22T08:01:00.000Z" });
  assert.equal(failed.deliveryState, "dead-letter");
  assert.match(failed.blocker, /security review/);
});

test("transient failures retry with a stable request and then enter dead letter", () => {
  let dispatch = createPublicHealthExternalDispatch(
    inProgressHandoff("health-education"),
    { idempotencyKey: "education:dispatch:001" },
    credentials({ maxAttempts: 3 })
  );
  const requestDigest = dispatch.requestDigest;
  dispatch = recordPublicHealthExternalDeliveryAttempt(dispatch, { transportStatus: 503 }, {
    receiptSecret: RECEIPT_SECRET,
    at: "2026-07-22T08:00:00.000Z"
  });
  assert.equal(dispatch.deliveryState, "retry-scheduled");
  assert.equal(dispatch.requestDigest, requestDigest);
  assert.equal(dispatch.nextRetryAt, "2026-07-22T08:02:00.000Z");
  dispatch = recordPublicHealthExternalDeliveryAttempt(dispatch, { transportStatus: 429 }, {
    receiptSecret: RECEIPT_SECRET,
    at: "2026-07-22T08:02:00.000Z"
  });
  assert.equal(dispatch.deliveryState, "retry-scheduled");
  dispatch = recordPublicHealthExternalDeliveryAttempt(dispatch, { networkError: "connection reset" }, {
    receiptSecret: RECEIPT_SECRET,
    at: "2026-07-22T08:06:00.000Z"
  });
  assert.equal(dispatch.deliveryState, "dead-letter");
  assert.equal(dispatch.attempts.length, 3);
  assert.match(dispatch.blocker, /exhausted 3 attempts/);
});

test("signed rejection binds compensation owner and due date", () => {
  const dispatch = createPublicHealthExternalDispatch(
    inProgressHandoff("immunization"),
    { idempotencyKey: "immunization:dispatch:reject" },
    credentials()
  );
  const receipt = signPublicHealthExternalReceipt({
    dispatchId: dispatch.id,
    requestDigest: dispatch.requestDigest,
    laneId: dispatch.laneId,
    handoffId: dispatch.handoffId,
    status: "rejected",
    receiptCode: "IMM-REJECT-001",
    evidenceRefs: ["registry-reject-receipt"],
    receivedAt: "2026-07-22T08:00:00.000Z",
    reason: "字段版本不匹配",
    exceptionOwner: "免疫规划接口专班",
    dueAt: "2026-07-24"
  }, RECEIPT_SECRET);
  const rejected = recordPublicHealthExternalDeliveryAttempt(dispatch, { transportStatus: 200, receipt }, {
    receiptSecret: RECEIPT_SECRET,
    at: "2026-07-22T08:01:00.000Z"
  });
  assert.equal(rejected.deliveryState, "dead-letter");
  assert.equal(rejected.receipt.status, "rejected");
  assert.match(rejected.blocker, /免疫规划接口专班/);
  assert.equal(rejected.productionReady, false);
});

test("external adapter rejects unsafe endpoints and invalid retry bounds", () => {
  const handoff = inProgressHandoff("senior-health");
  const input = { idempotencyKey: "senior:unsafe-config" };
  assert.throws(
    () => createPublicHealthExternalDispatch(handoff, input, credentials({ endpoint: "http://example.test/dispatch" })),
    /must use HTTPS/
  );
  assert.throws(
    () => createPublicHealthExternalDispatch(handoff, input, credentials({ endpoint: "https://user:password@example.test/dispatch" })),
    /must use HTTPS/
  );
  assert.throws(
    () => createPublicHealthExternalDispatch(handoff, input, credentials({ maxAttempts: 99 })),
    /maxAttempts must be an integer from 1 to 10/
  );
});
