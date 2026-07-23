const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const sourceData = require("../data/db.json");
const { buildPublicHealthCoordinationRuntime } = require("../public-health-coordination-runtime");
const {
  claimPublicHealthExternalDispatchToState,
  recordClaimedPublicHealthExternalAttemptToState
} = require("../public-health-external-adapter-runtime");
const {
  buildPublicHealthExternalOperationsBoard
} = require("../public-health-external-operations-service");
const {
  recordPublicHealthExternalLaneOutcomeToState,
  reservePublicHealthExternalLaneCapacityToState
} = require("../public-health-external-resilience-service");
const {
  buildPublicHealthExternalContractGovernance,
  signPublicHealthExternalContractAttestation
} = require("../public-health-external-contract-governance-service");
const { buildPublicHealthSystem } = require("../scripts/public-health-readiness");
const {
  runDeadLetterRecoveryAcceptance,
  runExternalOutboxAcceptance
} = require("../scripts/public-health-final-readiness");

const REQUEST_SECRET = "t08-acceptance-request-secret-1234567890";
const RECEIPT_SECRET = "t08-acceptance-receipt-secret-1234567890";

function buildScenario() {
  const data = JSON.parse(JSON.stringify(sourceData));
  const system = buildPublicHealthSystem({ data });
  const dependencies = {
    eventReporting: system.infectiousEventReporting,
    standardReview: system.priorityStandardReview,
    center: system.coordinationCenter
  };
  return { data, system, dependencies };
}

function coordination(data, dependencies) {
  return buildPublicHealthCoordinationRuntime({ data, ...dependencies });
}

function board(data, dependencies, options = {}) {
  return buildPublicHealthExternalOperationsBoard({
    data,
    coordinationCenter: coordination(data, dependencies),
    secretResolver: () => REQUEST_SECRET,
    now: "2026-07-23T09:31:00.000Z",
    ...options
  });
}

function contractDigest(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function familyDoctorContractAttestation() {
  return signPublicHealthExternalContractAttestation({
    laneId: "family-doctor",
    fromContract: "family-doctor-fulfillment-v1",
    toContract: "family-doctor-fulfillment-v2",
    requestSchemaVersion: "public-health-external-dispatch/v2",
    receiptSchemaVersion: "public-health-external-receipt/v2",
    changeType: "additive",
    fieldDictionaryDigest: contractDigest("family-doctor-fields-v2"),
    sampleRequestDigest: contractDigest("family-doctor-request-v2"),
    sampleReceiptDigest: contractDigest("family-doctor-receipt-v2"),
    runtimeReleaseDigest: contractDigest("family-doctor-runtime-v2"),
    producerApproval: {
      organizationId: "family-doctor-platform",
      role: "producer-contract-owner",
      approverIdHash: contractDigest("family-doctor-producer"),
      approvedAt: "2026-07-22T08:00:00.000Z"
    },
    consumerApproval: {
      organizationId: "district-health-platform",
      role: "consumer-contract-owner",
      approverIdHash: contractDigest("district-consumer"),
      approvedAt: "2026-07-22T09:00:00.000Z"
    },
    evidenceRefs: ["field-dictionary-v2", "producer-approval", "consumer-approval"],
    effectiveAt: "2026-07-25T00:00:00.000Z",
    sunsetAt: "2026-08-15T00:00:00.000Z",
    status: "approved",
    issuedAt: "2026-07-23T08:00:00.000Z",
    expiresAt: "2026-09-01T00:00:00.000Z",
    nonce: "family-doctor-contract-operations-v2"
  }, REQUEST_SECRET);
}

test("external operations board verifies delivered and recovered outbox chains", () => {
  const acceptedScenario = buildScenario();
  const accepted = runExternalOutboxAcceptance(acceptedScenario.data, acceptedScenario.system);
  const acceptedBoard = board(accepted.delivered.nextData, acceptedScenario.dependencies, {
    now: "2026-07-23T08:02:00.000Z"
  });
  assert.equal(acceptedBoard.ok, true);
  assert.equal(acceptedBoard.operationallyHealthy, true);
  assert.equal(acceptedBoard.summary.dispatches, 1);
  assert.equal(acceptedBoard.summary.signatureVerified, 1);
  assert.equal(acceptedBoard.summary.issues, 0);
  assert.equal(acceptedBoard.productionReady, false);

  const recoveryScenario = buildScenario();
  const recovery = runDeadLetterRecoveryAcceptance(recoveryScenario.data, recoveryScenario.system);
  const recoveryBoard = board(recovery.recovered.nextData, recoveryScenario.dependencies);
  assert.equal(recoveryBoard.ok, true);
  assert.equal(recoveryBoard.operationallyHealthy, true);
  assert.equal(recoveryBoard.summary.dispatches, 2);
  assert.equal(recoveryBoard.summary.signatureVerified, 2);
  assert.equal(recoveryBoard.summary.issues, 0);
  assert.equal(JSON.stringify(recoveryBoard).includes(REQUEST_SECRET), false);
  assert.equal(JSON.stringify(recoveryBoard).includes("residentId"), false);
});

test("external operations board blocks audit tampering, orphan tasks and state mismatch", () => {
  const scenario = buildScenario();
  const accepted = runExternalOutboxAcceptance(scenario.data, scenario.system);
  const tampered = JSON.parse(JSON.stringify(accepted.delivered.nextData));
  tampered.publicHealthExternalDispatchAudit[0].action = "forged-audit-action";
  const auditBoard = board(tampered, scenario.dependencies, {
    now: "2026-07-23T08:02:00.000Z"
  });
  assert.equal(auditBoard.ok, false);
  assert.equal(auditBoard.summary.p0 >= 1, true);
  assert.equal(auditBoard.issues.some((item) => item.code === "audit-chain-invalid"), true);

  const orphanAuditData = JSON.parse(JSON.stringify(accepted.delivered.nextData));
  orphanAuditData.publicHealthExternalDispatchAudit.push({
    id: "orphan-audit-entry",
    dispatchId: "missing-dispatch",
    laneId: "family-doctor",
    action: "forged-orphan-audit"
  });
  const orphanAuditBoard = board(orphanAuditData, scenario.dependencies, {
    now: "2026-07-23T08:02:00.000Z"
  });
  assert.equal(orphanAuditBoard.ok, false);
  assert.equal(orphanAuditBoard.summary.orphanAuditEntries, 1);

  const healthyCoordination = coordination(accepted.delivered.nextData, scenario.dependencies);
  const orphanBoard = buildPublicHealthExternalOperationsBoard({
    data: accepted.delivered.nextData,
    coordinationCenter: {
      ...healthyCoordination,
      handoffs: healthyCoordination.handoffs.filter((item) => item.id !== accepted.delivered.dispatch.handoffId)
    },
    secretResolver: () => REQUEST_SECRET,
    now: "2026-07-23T08:02:00.000Z"
  });
  assert.equal(orphanBoard.ok, false);
  assert.equal(orphanBoard.summary.orphanDispatches, 1);

  const mismatchedCoordination = JSON.parse(JSON.stringify(healthyCoordination));
  mismatchedCoordination.handoffs.find((item) => item.id === accepted.delivered.dispatch.handoffId).state = "in-progress";
  const mismatchBoard = buildPublicHealthExternalOperationsBoard({
    data: accepted.delivered.nextData,
    coordinationCenter: mismatchedCoordination,
    secretResolver: () => REQUEST_SECRET,
    now: "2026-07-23T08:02:00.000Z"
  });
  assert.equal(mismatchBoard.ok, false);
  assert.equal(mismatchBoard.summary.stateMismatches, 1);
});

test("external operations board queues expired leases, overdue pending and due retries", () => {
  const leaseScenario = buildScenario();
  const outbox = runExternalOutboxAcceptance(leaseScenario.data, leaseScenario.system);
  const claimed = claimPublicHealthExternalDispatchToState(
    outbox.enqueued.nextData,
    outbox.enqueued.dispatch.id,
    {
      workerId: "operations-expiry-worker",
      idempotencyKey: "operations:expired-claim",
      expectedVersion: 1,
      now: "2026-07-23T08:00:30.000Z",
      leaseSeconds: 15
    },
    { requestSecret: REQUEST_SECRET }
  );
  const expiredBoard = board(claimed.nextData, leaseScenario.dependencies, {
    now: "2026-07-23T08:01:00.000Z"
  });
  assert.equal(expiredBoard.ok, true);
  assert.equal(expiredBoard.operationallyHealthy, false);
  assert.equal(expiredBoard.summary.expiredLeases, 1);

  const pendingBoard = board(outbox.enqueued.nextData, leaseScenario.dependencies, {
    now: "2026-07-23T08:20:00.000Z",
    pendingSlaMinutes: 15
  });
  assert.equal(pendingBoard.summary.overduePending, 1);

  const retry = recordClaimedPublicHealthExternalAttemptToState(
    claimed.nextData,
    claimed.dispatch.id,
    { transportStatus: 503 },
    {
      requestSecret: REQUEST_SECRET,
      receiptSecret: RECEIPT_SECRET,
      attemptIdempotencyKey: "operations:retry-attempt",
      expectedVersion: 2,
      workerId: "operations-expiry-worker",
      leaseToken: claimed.leaseToken,
      at: "2026-07-23T08:00:40.000Z"
    },
    leaseScenario.dependencies
  );
  const dueRetryBoard = board(retry.nextData, leaseScenario.dependencies, {
    now: "2026-07-23T08:03:00.000Z"
  });
  assert.equal(dueRetryBoard.summary.dueRetries, 1);
});

test("external operations board exposes unrecovered dead letters and missing secrets", () => {
  const scenario = buildScenario();
  const recovery = runDeadLetterRecoveryAcceptance(scenario.data, scenario.system);
  const unrecoveredBoard = board(recovery.rejected.nextData, scenario.dependencies, {
    now: "2026-07-23T09:02:00.000Z"
  });
  assert.equal(unrecoveredBoard.ok, true);
  assert.equal(unrecoveredBoard.operationallyHealthy, false);
  assert.equal(unrecoveredBoard.summary.unrecoveredDeadLetters, 1);
  assert.equal(unrecoveredBoard.issues.some((item) => item.code === "dead-letter-unrecovered"), true);

  const missingSecretBoard = buildPublicHealthExternalOperationsBoard({
    data: recovery.rejected.nextData,
    coordinationCenter: coordination(recovery.rejected.nextData, scenario.dependencies),
    secretResolver: {},
    now: "2026-07-23T09:02:00.000Z"
  });
  assert.equal(missingSecretBoard.ok, false);
  assert.equal(missingSecretBoard.issues.some((item) => item.code === "signature-secret-unavailable"), true);
  assert.equal(missingSecretBoard.productionReady, false);
});

test("external operations board verifies historical records through a managed grace key", () => {
  const scenario = buildScenario();
  const accepted = runExternalOutboxAcceptance(scenario.data, scenario.system);
  const managedKeyring = {
    purpose: "public-health-request",
    activeKeyId: "request-2026-08",
    keys: [
      {
        keyId: "legacy-static",
        secret: REQUEST_SECRET,
        status: "grace",
        notBefore: "2026-07-01T00:00:00.000Z",
        expiresAt: "2026-08-01T00:00:00.000Z",
        revokedAt: ""
      },
      {
        keyId: "request-2026-08",
        secret: "operations-next-request-secret-1234567890",
        status: "active",
        notBefore: "2026-07-23T08:01:00.000Z",
        expiresAt: "2026-09-01T00:00:00.000Z",
        revokedAt: ""
      }
    ]
  };
  const managedBoard = board(accepted.delivered.nextData, scenario.dependencies, {
    secretResolver: () => managedKeyring,
    now: "2026-07-23T08:02:00.000Z"
  });
  assert.equal(managedBoard.ok, true);
  assert.equal(managedBoard.summary.signatureVerified, 1);
  assert.equal(JSON.stringify(managedBoard).includes(REQUEST_SECRET), false);
});

test("external operations board exposes open circuits and blocks resilience tampering", () => {
  const scenario = buildScenario();
  const accepted = runExternalOutboxAcceptance(scenario.data, scenario.system);
  const policy = {
    failureThreshold: 1,
    openSeconds: 30,
    halfOpenMaxProbes: 1,
    rateLimitPerMinute: 10,
    maxPending: 10
  };
  const reserved = reservePublicHealthExternalLaneCapacityToState(
    accepted.delivered.nextData,
    "family-doctor",
    { at: "2026-07-23T08:02:00.000Z", expectedVersion: 0 },
    REQUEST_SECRET,
    policy
  );
  const failed = recordPublicHealthExternalLaneOutcomeToState(
    reserved.nextData,
    "family-doctor",
    { type: "failure", reason: "network-error" },
    { at: "2026-07-23T08:02:10.000Z", expectedVersion: 1 },
    REQUEST_SECRET,
    policy
  );
  const openBoard = board(failed.nextData, scenario.dependencies, {
    now: "2026-07-23T08:02:20.000Z"
  });
  assert.equal(openBoard.ok, true);
  assert.equal(openBoard.operationallyHealthy, false);
  assert.equal(openBoard.summary.resilienceLanes, 1);
  assert.equal(openBoard.summary.openCircuits, 1);
  assert.equal(openBoard.issues.some((item) => item.code === "lane-circuit-open"), true);

  const tampered = structuredClone(failed.nextData);
  tampered.publicHealthExternalLaneControls[0].circuitState = "closed";
  const tamperedBoard = board(tampered, scenario.dependencies, {
    now: "2026-07-23T08:02:20.000Z"
  });
  assert.equal(tamperedBoard.ok, false);
  assert.equal(tamperedBoard.issues.some((item) => item.code === "lane-control-integrity-invalid"), true);

  const orphanAudit = structuredClone(failed.nextData);
  orphanAudit.publicHealthExternalLaneControls = [];
  const orphanBoard = board(orphanAudit, scenario.dependencies, {
    now: "2026-07-23T08:02:20.000Z"
  });
  assert.equal(orphanBoard.ok, false);
  assert.equal(orphanBoard.summary.orphanLaneControlAuditEntries, 2);
  assert.equal(orphanBoard.issues.some((item) => item.code === "lane-control-audit-orphan"), true);
});

test("external operations board warns during contract deprecation and blocks retired versions", () => {
  const scenario = buildScenario();
  const accepted = runExternalOutboxAcceptance(scenario.data, scenario.system);
  const attestation = familyDoctorContractAttestation();
  const scheduledGovernance = buildPublicHealthExternalContractGovernance({
    attestations: [attestation],
    signingMaterial: REQUEST_SECRET,
    at: "2026-07-24T00:00:00.000Z"
  });
  const scheduledBoard = board(accepted.delivered.nextData, scenario.dependencies, {
    now: "2026-07-24T00:00:00.000Z",
    contractGovernance: scheduledGovernance
  });
  assert.equal(scheduledBoard.ok, true);
  assert.equal(scheduledBoard.summary.deprecatedContracts, 0);

  const activeGovernance = buildPublicHealthExternalContractGovernance({
    attestations: [attestation],
    signingMaterial: REQUEST_SECRET,
    at: "2026-07-25T00:00:00.000Z"
  });
  const deprecatedBoard = board(accepted.delivered.nextData, scenario.dependencies, {
    now: "2026-07-25T00:00:00.000Z",
    contractGovernance: activeGovernance
  });
  assert.equal(deprecatedBoard.ok, true);
  assert.equal(deprecatedBoard.operationallyHealthy, false);
  assert.equal(deprecatedBoard.summary.deprecatedContracts, 1);
  assert.equal(deprecatedBoard.issues.some((item) => item.code === "contract-version-deprecated"), true);

  const retiredGovernance = buildPublicHealthExternalContractGovernance({
    attestations: [attestation],
    signingMaterial: REQUEST_SECRET,
    at: "2026-08-15T00:00:00.000Z"
  });
  const retiredBoard = board(accepted.delivered.nextData, scenario.dependencies, {
    now: "2026-08-15T00:00:00.000Z",
    contractGovernance: retiredGovernance
  });
  assert.equal(retiredBoard.ok, false);
  assert.equal(retiredBoard.summary.contractMismatches, 1);
  assert.equal(retiredBoard.issues.some((item) => item.code === "contract-governance-mismatch"), true);
});
