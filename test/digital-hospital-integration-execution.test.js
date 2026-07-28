const assert = require("node:assert/strict");
const test = require("node:test");

const {
  advanceExecutionJob,
  createExecutionState,
  enqueueExecutionJob,
  evaluateCutoverWindow,
  registerVaultReference,
  releaseQuarantine,
  verifyExecutionCallback
} = require("../digital-hospital-integration-execution");

function readyState() {
  return createExecutionState({
    environments: [{ id: "ENV-UAT", status: "healthy" }],
    cutoverWindows: [{
      id: "CUT-001",
      environmentId: "ENV-UAT",
      connectorIds: ["CONN-001"],
      integrationApproved: true,
      rollbackPlan: "Restore the previous routing configuration",
      status: "pending"
    }]
  });
}

test("vault registration stores only a reference fingerprint and rejects secret material", () => {
  const state = createExecutionState();
  const entry = registerVaultReference(state, {
    id: "VAULT-001",
    connectorId: "CONN-001",
    environmentId: "ENV-UAT",
    vaultRef: "vault://digital-hospital/uat/connector-001",
    keyVersion: 2
  });
  assert.equal(entry.vaultRefFingerprint.length, 64);
  assert.equal(JSON.stringify(state).includes("vault://digital-hospital"), false);
  assert.equal(JSON.stringify(state).includes("secretValue"), false);
  assert.throws(() => registerVaultReference(state, {
    connectorId: "CONN-001",
    environmentId: "ENV-UAT",
    vaultRef: "vault://digital-hospital/uat/connector-001",
    secret: "must-not-be-stored"
  }), /must not be stored/);
});

test("execution jobs enforce idempotency without retaining the raw key", () => {
  const state = createExecutionState();
  const input = {
    id: "JOB-001",
    connectorId: "CONN-001",
    environmentId: "ENV-UAT",
    jobType: "contract-certification",
    idempotencyKey: "hospital-001-contract-v1",
    payload: { contractVersion: "v1" },
    now: "2026-07-28T10:00:00.000Z"
  };
  const first = enqueueExecutionJob(state, input);
  const duplicate = enqueueExecutionJob(state, input);
  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(state.jobs.length, 1);
  assert.equal(state.jobs[0].idempotencyHits, 1);
  assert.equal(JSON.stringify(state).includes(input.idempotencyKey), false);
});

test("verified callbacks complete jobs without retaining nonce or signature material", () => {
  const state = createExecutionState();
  const queued = enqueueExecutionJob(state, {
    id: "JOB-001",
    connectorId: "CONN-001",
    environmentId: "ENV-UAT",
    jobType: "full-chain",
    idempotencyKey: "full-chain-001",
    payload: { batch: "pilot-001" },
    now: "2026-07-28T10:00:00.000Z"
  }).job;
  advanceExecutionJob(state, queued.id, "2026-07-28T10:00:01.000Z");
  advanceExecutionJob(state, queued.id, "2026-07-28T10:00:02.000Z");
  assert.throws(
    () => advanceExecutionJob(state, queued.id, "2026-07-28T10:00:03.000Z"),
    /cannot be advanced/
  );
  const result = verifyExecutionCallback(state, {
    id: "RECEIPT-001",
    jobId: queued.id,
    source: "CONN-001",
    eventType: "integration-job.completed",
    signatureValid: true,
    timestamp: "2026-07-28T10:00:03.000Z",
    now: "2026-07-28T10:00:04.000Z",
    nonce: "nonce-001",
    payloadDigest: state.jobs[0].payloadDigest
  });
  assert.equal(result.accepted, true);
  assert.equal(state.jobs[0].status, "succeeded");
  assert.equal(state.jobs[0].receiptId, "RECEIPT-001");
  assert.equal(JSON.stringify(state).includes("nonce-001"), false);
  assert.equal(JSON.stringify(state).includes("signatureValid"), false);
});

test("replayed callbacks are blocked and quarantine the connector", () => {
  const state = createExecutionState();
  const firstJob = enqueueExecutionJob(state, {
    id: "JOB-001",
    connectorId: "CONN-001",
    environmentId: "ENV-UAT",
    jobType: "probe",
    idempotencyKey: "probe-001",
    payload: { sequence: 1 }
  }).job;
  const secondJob = enqueueExecutionJob(state, {
    id: "JOB-002",
    connectorId: "CONN-001",
    environmentId: "ENV-UAT",
    jobType: "probe",
    idempotencyKey: "probe-002",
    payload: { sequence: 1 }
  }).job;
  const callback = {
    source: "CONN-001",
    signatureValid: true,
    timestamp: "2026-07-28T10:00:00.000Z",
    now: "2026-07-28T10:00:01.000Z",
    nonce: "same-nonce",
    payloadDigest: state.jobs.find((item) => item.id === firstJob.id).payloadDigest
  };
  verifyExecutionCallback(state, { ...callback, jobId: firstJob.id });
  const replay = verifyExecutionCallback(state, {
    ...callback,
    jobId: secondJob.id,
    payloadDigest: state.jobs.find((item) => item.id === secondJob.id).payloadDigest
  });
  assert.equal(replay.accepted, false);
  assert.equal(replay.receipt.decision, "replay-blocked");
  assert.equal(state.quarantines[0].status, "active");
  assert.equal(state.replayEvents[0].hits, 2);
});

test("invalid callback signatures and expired timestamps fail closed", () => {
  const state = createExecutionState();
  const job = enqueueExecutionJob(state, {
    id: "JOB-001",
    connectorId: "CONN-001",
    environmentId: "ENV-UAT",
    jobType: "probe",
    idempotencyKey: "probe-001",
    payload: {}
  }).job;
  const result = verifyExecutionCallback(state, {
    jobId: job.id,
    source: "CONN-001",
    signatureValid: false,
    timestamp: "2026-07-28T09:00:00.000Z",
    now: "2026-07-28T10:00:00.000Z",
    nonce: "nonce-001",
    payloadDigest: state.jobs[0].payloadDigest
  });
  assert.equal(result.accepted, false);
  assert.equal(result.receipt.signatureStatus, "invalid");
  assert.equal(result.receipt.timestampStatus, "expired");
  assert.equal(state.jobs[0].status, "blocked");
  assert.equal(state.quarantines.length, 1);
});

test("cutover readiness requires environment vault receipt approval and no quarantine", () => {
  const state = readyState();
  assert.equal(evaluateCutoverWindow(state, "CUT-001").status, "blocked");
  registerVaultReference(state, {
    connectorId: "CONN-001",
    environmentId: "ENV-UAT",
    vaultRef: "vault://digital-hospital/uat/connector-001"
  });
  const job = enqueueExecutionJob(state, {
    connectorId: "CONN-001",
    environmentId: "ENV-UAT",
    jobType: "full-chain",
    idempotencyKey: "cutover-001",
    payload: {}
  }).job;
  state.jobs.find((item) => item.id === job.id).status = "succeeded";
  assert.equal(evaluateCutoverWindow(state, "CUT-001").status, "ready");
  state.quarantines.push({ id: "QUAR-001", connectorId: "CONN-001", status: "active" });
  assert.equal(evaluateCutoverWindow(state, "CUT-001").status, "blocked");
  releaseQuarantine(state, "QUAR-001", { reviewNote: "Verified new credential and callback nonce", releasedBy: "security-reviewer" });
  assert.equal(evaluateCutoverWindow(state, "CUT-001").status, "ready");
});
