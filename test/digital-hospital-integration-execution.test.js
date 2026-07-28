const assert = require("node:assert/strict");
const test = require("node:test");

const {
  advanceExecutionJob,
  claimExecutionJob,
  completeExecutionAttempt,
  createExecutionState,
  enqueueExecutionJob,
  evaluateCutoverWindow,
  failExecutionAttempt,
  getExecutionRuntimeSummary,
  heartbeatExecutionJob,
  recoverExpiredLeases,
  redriveDeadLetter,
  registerExecutionWorker,
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

function moveToAwaitingReceipt(state, jobId, base = "2026-07-28T10:00:00.000Z") {
  const started = new Date(Date.parse(base) + 1000).toISOString();
  const finished = new Date(Date.parse(base) + 2000).toISOString();
  advanceExecutionJob(state, jobId, started);
  advanceExecutionJob(state, jobId, finished);
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
  moveToAwaitingReceipt(state, firstJob.id);
  moveToAwaitingReceipt(state, secondJob.id);
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
  moveToAwaitingReceipt(state, job.id);
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

test("callbacks cannot complete jobs before worker execution reaches receipt state", () => {
  const state = createExecutionState();
  const job = enqueueExecutionJob(state, {
    id: "JOB-001",
    connectorId: "CONN-001",
    environmentId: "ENV-UAT",
    jobType: "probe",
    idempotencyKey: "callback-state-001",
    payload: {}
  }).job;
  assert.throws(() => verifyExecutionCallback(state, {
    jobId: job.id,
    source: "CONN-001",
    signatureValid: true,
    timestamp: "2026-07-28T10:00:00.000Z",
    now: "2026-07-28T10:00:01.000Z",
    nonce: "nonce-001",
    payloadDigest: state.jobs[0].payloadDigest
  }), /not awaiting a receipt/);
  assert.equal(state.receipts.length, 0);
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

test("workers claim eligible jobs with a hashed lease and heartbeat extension", () => {
  const state = createExecutionState({
    environments: [{ id: "ENV-UAT", status: "healthy" }]
  });
  registerExecutionWorker(state, {
    id: "WORKER-001",
    pool: "certification",
    capabilities: ["contract-certification"],
    now: "2026-07-28T10:00:00.000Z"
  });
  enqueueExecutionJob(state, {
    id: "JOB-001",
    connectorId: "CONN-001",
    environmentId: "ENV-UAT",
    jobType: "contract-certification",
    idempotencyKey: "worker-claim-001",
    payload: { batch: 1 },
    now: "2026-07-28T10:00:01.000Z"
  });
  const claimed = claimExecutionJob(state, {
    workerId: "WORKER-001",
    now: "2026-07-28T10:00:02.000Z",
    leaseSeconds: 30
  });
  assert.equal(claimed.job.status, "running");
  assert.equal(claimed.job.leaseOwner, "WORKER-001");
  assert.equal(claimed.leaseToken.startsWith("lease-"), true);
  assert.equal(JSON.stringify(state).includes(claimed.leaseToken), false);
  const heartbeat = heartbeatExecutionJob(state, "JOB-001", {
    workerId: "WORKER-001",
    leaseToken: claimed.leaseToken,
    progress: 60,
    now: "2026-07-28T10:00:20.000Z",
    leaseSeconds: 45
  });
  assert.equal(heartbeat.progress, 60);
  assert.equal(heartbeat.leaseExpiresAt, "2026-07-28T10:01:05.000Z");
  const awaitingReceipt = completeExecutionAttempt(state, "JOB-001", {
    workerId: "WORKER-001",
    leaseToken: claimed.leaseToken,
    now: "2026-07-28T10:00:25.000Z"
  });
  assert.equal(awaitingReceipt.status, "awaiting-receipt");
  assert.equal(state.workers[0].status, "ready");
  assert.equal(state.jobs[0].leaseTokenHash, "");
});

test("claiming fails closed for unhealthy environments quarantines and worker capabilities", () => {
  const state = createExecutionState({
    environments: [{ id: "ENV-UAT", status: "degraded" }],
    quarantines: [{ id: "QUAR-001", connectorId: "CONN-002", status: "active" }]
  });
  registerExecutionWorker(state, {
    id: "WORKER-001",
    capabilities: ["contract-certification"],
    now: "2026-07-28T10:00:00.000Z"
  });
  enqueueExecutionJob(state, {
    id: "JOB-UNHEALTHY",
    connectorId: "CONN-001",
    environmentId: "ENV-UAT",
    jobType: "contract-certification",
    idempotencyKey: "unhealthy"
  });
  assert.equal(claimExecutionJob(state, { workerId: "WORKER-001", now: "2026-07-28T10:00:01.000Z" }), null);
  state.environments[0].status = "healthy";
  state.jobs[0].connectorId = "CONN-002";
  assert.equal(claimExecutionJob(state, { workerId: "WORKER-001", now: "2026-07-28T10:00:02.000Z" }), null);
  state.jobs[0].connectorId = "CONN-001";
  state.jobs[0].jobType = "full-chain";
  assert.equal(claimExecutionJob(state, { workerId: "WORKER-001", now: "2026-07-28T10:00:03.000Z" }), null);
});

test("transient failures use exponential backoff before dead-lettering", () => {
  const state = createExecutionState({
    environments: [{ id: "ENV-UAT", status: "healthy" }]
  });
  registerExecutionWorker(state, { id: "WORKER-001", now: "2026-07-28T10:00:00.000Z" });
  enqueueExecutionJob(state, {
    id: "JOB-RETRY",
    connectorId: "CONN-001",
    environmentId: "ENV-UAT",
    jobType: "probe",
    idempotencyKey: "retry-001",
    maxAttempts: 2,
    retryBaseSeconds: 30,
    retryMaxSeconds: 120,
    now: "2026-07-28T10:00:00.000Z"
  });
  const firstClaim = claimExecutionJob(state, { workerId: "WORKER-001", now: "2026-07-28T10:00:01.000Z" });
  const retry = failExecutionAttempt(state, "JOB-RETRY", {
    workerId: "WORKER-001",
    leaseToken: firstClaim.leaseToken,
    errorCode: "GATEWAY_TIMEOUT",
    failureClass: "transient",
    now: "2026-07-28T10:00:10.000Z"
  });
  assert.equal(retry.retryScheduled, true);
  assert.equal(retry.job.nextAttemptAt, "2026-07-28T10:00:40.000Z");
  assert.equal(claimExecutionJob(state, { workerId: "WORKER-001", now: "2026-07-28T10:00:39.000Z" }), null);
  const secondClaim = claimExecutionJob(state, { workerId: "WORKER-001", now: "2026-07-28T10:00:40.000Z" });
  const exhausted = failExecutionAttempt(state, "JOB-RETRY", {
    workerId: "WORKER-001",
    leaseToken: secondClaim.leaseToken,
    errorCode: "GATEWAY_TIMEOUT",
    failureClass: "transient",
    now: "2026-07-28T10:00:50.000Z"
  });
  assert.equal(exhausted.retryScheduled, false);
  assert.equal(exhausted.job.status, "dead-lettered");
  assert.equal(exhausted.deadLetter.errorCode, "GATEWAY_TIMEOUT");
  assert.equal(state.deadLetters.length, 1);
});

test("expired worker leases are recovered and worker state becomes stale", () => {
  const state = createExecutionState({
    environments: [{ id: "ENV-UAT", status: "healthy" }]
  });
  registerExecutionWorker(state, { id: "WORKER-001", now: "2026-07-28T10:00:00.000Z" });
  enqueueExecutionJob(state, {
    id: "JOB-LEASE",
    connectorId: "CONN-001",
    environmentId: "ENV-UAT",
    jobType: "probe",
    idempotencyKey: "lease-expiry",
    retryBaseSeconds: 15,
    now: "2026-07-28T10:00:00.000Z"
  });
  claimExecutionJob(state, {
    workerId: "WORKER-001",
    now: "2026-07-28T10:00:01.000Z",
    leaseSeconds: 10
  });
  const recovered = recoverExpiredLeases(state, { now: "2026-07-28T10:00:12.000Z" });
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].retryScheduled, true);
  assert.equal(state.jobs[0].errorCode, "WORKER_LEASE_EXPIRED");
  assert.equal(state.workers[0].status, "stale");
});

test("dead-letter redrive requires review evidence and starts a new generation", () => {
  const state = createExecutionState({
    environments: [{ id: "ENV-UAT", status: "healthy" }]
  });
  registerExecutionWorker(state, { id: "WORKER-001", now: "2026-07-28T10:00:00.000Z" });
  enqueueExecutionJob(state, {
    id: "JOB-DLQ",
    connectorId: "CONN-001",
    environmentId: "ENV-UAT",
    jobType: "probe",
    idempotencyKey: "dlq-001",
    now: "2026-07-28T10:00:00.000Z"
  });
  const claim = claimExecutionJob(state, { workerId: "WORKER-001", now: "2026-07-28T10:00:01.000Z" });
  const failed = failExecutionAttempt(state, "JOB-DLQ", {
    workerId: "WORKER-001",
    leaseToken: claim.leaseToken,
    errorCode: "CONTRACT_REJECTED",
    failureClass: "permanent",
    now: "2026-07-28T10:00:02.000Z"
  });
  assert.throws(
    () => redriveDeadLetter(state, failed.deadLetter.id, { reviewedBy: "security-reviewer", reviewNote: "short" }),
    /requires an approver/
  );
  const redriven = redriveDeadLetter(state, failed.deadLetter.id, {
    reviewedBy: "security-reviewer",
    reviewNote: "Contract mapping was corrected and independently reviewed.",
    now: "2026-07-28T10:05:00.000Z"
  });
  assert.equal(redriven.job.status, "queued");
  assert.equal(redriven.job.generation, 2);
  assert.equal(redriven.deadLetter.status, "redriven");
  assert.equal(getExecutionRuntimeSummary(state, "2026-07-28T10:05:00.000Z").claimableJobs, 1);
});
