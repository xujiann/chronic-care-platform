const test = require("node:test");
const assert = require("node:assert/strict");
const sourceData = require("../data/db.json");
const { buildPublicHealthCoordinationRuntime } = require("../public-health-coordination-runtime");
const {
  claimPublicHealthExternalDispatchToState,
  recordClaimedPublicHealthExternalAttemptToState
} = require("../public-health-external-adapter-runtime");
const {
  buildPublicHealthExternalOperationsBoard
} = require("../public-health-external-operations-service");
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
