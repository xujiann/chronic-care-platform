const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {
  buildPublicHealthExternalContractGovernance,
  signPublicHealthExternalContractAttestation
} = require("../public-health-external-contract-governance-service");
const {
  buildPublicHealthExternalContractCutoverBoard
} = require("../public-health-external-contract-cutover-service");

const SECRET = "public-health-contract-cutover-secret-1234567890";

function digest(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function governance(at) {
  const attestation = signPublicHealthExternalContractAttestation({
    laneId: "family-doctor",
    fromContract: "family-doctor-fulfillment-v1",
    toContract: "family-doctor-fulfillment-v2",
    requestSchemaVersion: "public-health-external-dispatch/v2",
    receiptSchemaVersion: "public-health-external-receipt/v2",
    changeType: "additive",
    fieldDictionaryDigest: digest("dictionary"),
    sampleRequestDigest: digest("request"),
    sampleReceiptDigest: digest("receipt"),
    runtimeReleaseDigest: digest("release"),
    producerApproval: {
      organizationId: "producer-platform",
      role: "producer-contract-owner",
      approverIdHash: digest("producer"),
      approvedAt: "2026-07-22T08:00:00.000Z"
    },
    consumerApproval: {
      organizationId: "consumer-platform",
      role: "consumer-contract-owner",
      approverIdHash: digest("consumer"),
      approvedAt: "2026-07-22T09:00:00.000Z"
    },
    evidenceRefs: ["dictionary", "producer-approval", "consumer-approval"],
    effectiveAt: "2026-07-25T00:00:00.000Z",
    sunsetAt: "2026-08-15T00:00:00.000Z",
    status: "approved",
    issuedAt: "2026-07-23T08:00:00.000Z",
    expiresAt: "2026-09-01T00:00:00.000Z",
    nonce: "family-doctor-cutover-v2"
  }, SECRET);
  return buildPublicHealthExternalContractGovernance({
    attestations: [attestation],
    signingMaterial: SECRET,
    at
  });
}

function dispatch(id, deliveryState, overrides = {}) {
  return {
    id,
    laneId: "family-doctor",
    contract: "family-doctor-fulfillment-v1",
    deliveryState,
    lease: null,
    recovery: null,
    ...overrides
  };
}

test("scheduled cutover does not treat the current old contract as backlog", () => {
  const board = buildPublicHealthExternalContractCutoverBoard({
    data: { publicHealthExternalDispatches: [dispatch("old-pending", "pending")] },
    contractGovernance: governance("2026-07-24T00:00:00.000Z"),
    now: "2026-07-24T00:00:00.000Z"
  });
  assert.equal(board.ok, true);
  assert.equal(board.summary.scheduled, 1);
  assert.equal(board.summary.outstanding, 1);
  assert.equal(board.issues.length, 0);
  assert.equal(board.productionReady, false);
});

test("compatibility window reports only executable old-version backlog", () => {
  const board = buildPublicHealthExternalContractCutoverBoard({
    data: {
      publicHealthExternalDispatches: [
        dispatch("old-pending", "pending"),
        dispatch("old-retry", "retry-scheduled"),
        dispatch("old-delivered", "delivered")
      ]
    },
    contractGovernance: governance("2026-07-25T00:00:00.000Z"),
    now: "2026-07-25T00:00:00.000Z"
  });
  assert.equal(board.ok, true);
  assert.equal(board.summary.draining, 1);
  assert.equal(board.summary.outstanding, 2);
  assert.equal(board.lanes[0].historicalCompleted, 1);
  assert.equal(board.issues.length, 2);
  assert.equal(board.issues.every((item) => item.severity === "P1"), true);
});

test("sunset blocks old backlog but preserves completed history", () => {
  const board = buildPublicHealthExternalContractCutoverBoard({
    data: {
      publicHealthExternalDispatches: [
        dispatch("old-pending", "pending"),
        dispatch("old-delivered", "delivered")
      ]
    },
    contractGovernance: governance("2026-08-15T00:00:00.000Z"),
    now: "2026-08-15T00:00:00.000Z"
  });
  assert.equal(board.ok, false);
  assert.equal(board.lanes[0].status, "blocked-after-sunset");
  assert.equal(board.issues.length, 1);
  assert.equal(board.issues[0].code, "contract-cutover-backlog-after-sunset");
  assert.equal(board.issues[0].dispatchId, "old-pending");
});

test("recovered old dead letter requires exactly the active-version successor relationship", () => {
  const valid = {
    publicHealthExternalDispatches: [
      dispatch("old-dead", "dead-letter", {
        recovery: { state: "requeued", successorDispatchId: "new-successor" }
      }),
      {
        id: "new-successor",
        laneId: "family-doctor",
        contract: "family-doctor-fulfillment-v2",
        deliveryState: "pending",
        predecessorDispatchId: "old-dead"
      }
    ]
  };
  const accepted = buildPublicHealthExternalContractCutoverBoard({
    data: valid,
    contractGovernance: governance("2026-08-15T00:00:00.000Z"),
    now: "2026-08-15T00:00:00.000Z"
  });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.summary.completed, 1);
  assert.equal(accepted.summary.outstanding, 0);
  const stale = buildPublicHealthExternalContractCutoverBoard({
    data: {
      publicHealthExternalDispatches: [
        valid.publicHealthExternalDispatches[0],
        { ...valid.publicHealthExternalDispatches[1], contract: "family-doctor-fulfillment-v1" }
      ]
    },
    contractGovernance: governance("2026-08-15T00:00:00.000Z"),
    now: "2026-08-15T00:00:00.000Z"
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.issues.some((item) => item.code === "contract-cutover-successor-stale"), true);
});
