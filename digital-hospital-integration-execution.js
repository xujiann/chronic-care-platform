const { createHash, randomUUID } = require("node:crypto");

const JOB_TRANSITIONS = {
  queued: "running",
  running: "awaiting-receipt"
};

const CLAIMABLE_JOB_STATUSES = new Set(["queued", "retry-scheduled"]);

function executionError(message, code, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function parseTime(value, field) {
  const timestamp = Date.parse(String(value || ""));
  if (!Number.isFinite(timestamp)) throw executionError(`${field} must be an ISO timestamp`, "TIMESTAMP_INVALID");
  return timestamp;
}

function createExecutionState(seed = {}) {
  return {
    environments: clone(seed.environments || []),
    vaultEntries: clone(seed.vaultEntries || []),
    jobs: clone(seed.jobs || []),
    workers: clone(seed.workers || []),
    deadLetters: clone(seed.deadLetters || []),
    executionEvents: clone(seed.executionEvents || []),
    receipts: clone(seed.receipts || []),
    replayEvents: clone(seed.replayEvents || []),
    quarantines: clone(seed.quarantines || []),
    cutoverWindows: clone(seed.cutoverWindows || [])
  };
}

function recordExecutionEvent(state, input) {
  const event = {
    id: String(input.id || `EVENT-${randomUUID()}`),
    jobId: String(input.jobId || ""),
    workerId: String(input.workerId || ""),
    type: String(input.type || "execution-event"),
    status: String(input.status || ""),
    detail: String(input.detail || ""),
    occurredAt: String(input.occurredAt || new Date().toISOString())
  };
  state.executionEvents.unshift(event);
  return event;
}

function registerExecutionWorker(state, input = {}) {
  if (!state || !Array.isArray(state.workers)) throw executionError("execution state is required", "STATE_REQUIRED");
  const forbidden = ["secret", "token", "apiKey", "credential", "privateKey"];
  if (forbidden.some((field) => Object.prototype.hasOwnProperty.call(input, field))) {
    throw executionError("worker credentials must not be stored in the execution state", "WORKER_CREDENTIAL_FORBIDDEN");
  }
  const id = String(input.id || "").trim();
  if (!id) throw executionError("worker id is required", "WORKER_ID_REQUIRED");
  const now = String(input.now || new Date().toISOString());
  parseTime(now, "now");
  const existing = state.workers.find((item) => item.id === id);
  const worker = existing || { id };
  worker.node = String(input.node || worker.node || "execution-worker");
  worker.pool = String(input.pool || worker.pool || "default");
  worker.capabilities = Array.from(new Set((input.capabilities || worker.capabilities || []).map((item) => String(item).trim()).filter(Boolean)));
  worker.status = worker.activeJobId ? "busy" : "ready";
  worker.activeJobId = String(worker.activeJobId || "");
  worker.lastHeartbeatAt = now;
  worker.registeredAt = String(worker.registeredAt || now);
  if (!existing) state.workers.unshift(worker);
  recordExecutionEvent(state, {
    workerId: worker.id,
    type: existing ? "worker-heartbeat" : "worker-registered",
    status: worker.status,
    detail: `${worker.pool}:${worker.capabilities.join(",") || "all"}`,
    occurredAt: now
  });
  return clone(worker);
}

function registerVaultReference(state, input) {
  if (!state || !Array.isArray(state.vaultEntries)) throw executionError("execution state is required", "STATE_REQUIRED");
  const forbidden = ["secret", "secretValue", "token", "tokenValue", "privateKey", "credential"];
  if (forbidden.some((field) => Object.prototype.hasOwnProperty.call(input || {}, field))) {
    throw executionError("secret material must not be stored in the execution state", "SECRET_MATERIAL_FORBIDDEN");
  }
  const vaultRef = String(input?.vaultRef || "").trim();
  if (!/^vault:\/\/[a-z0-9][a-z0-9/_-]{5,}$/i.test(vaultRef)) {
    throw executionError("vaultRef must use a vault:// reference", "VAULT_REFERENCE_INVALID");
  }
  const connectorId = String(input.connectorId || "").trim();
  const environmentId = String(input.environmentId || "").trim();
  if (!connectorId || !environmentId) throw executionError("connectorId and environmentId are required", "VAULT_SCOPE_REQUIRED");
  const entry = {
    id: String(input.id || `VAULT-${randomUUID()}`),
    connectorId,
    environmentId,
    provider: String(input.provider || "external-vault"),
    vaultRefFingerprint: sha256(vaultRef),
    keyVersion: Math.max(1, Number(input.keyVersion || 1)),
    status: String(input.status || "active"),
    rotationDueAt: String(input.rotationDueAt || ""),
    owner: String(input.owner || ""),
    updatedAt: String(input.updatedAt || new Date().toISOString())
  };
  state.vaultEntries.unshift(entry);
  return clone(entry);
}

function enqueueExecutionJob(state, input) {
  if (!state || !Array.isArray(state.jobs)) throw executionError("execution state is required", "STATE_REQUIRED");
  const connectorId = String(input?.connectorId || "").trim();
  const environmentId = String(input?.environmentId || "").trim();
  const jobType = String(input?.jobType || "").trim();
  const idempotencyKey = String(input?.idempotencyKey || "").trim();
  if (!connectorId || !environmentId || !jobType || !idempotencyKey) {
    throw executionError("connectorId, environmentId, jobType and idempotencyKey are required", "JOB_INPUT_REQUIRED");
  }
  const idempotencyKeyHash = sha256(`${connectorId}:${environmentId}:${jobType}:${idempotencyKey}`);
  const existing = state.jobs.find((item) => item.idempotencyKeyHash === idempotencyKeyHash);
  if (existing) {
    existing.idempotencyHits = Number(existing.idempotencyHits || 0) + 1;
    return { duplicate: true, job: clone(existing) };
  }
  const now = String(input.now || new Date().toISOString());
  const job = {
    id: String(input.id || `JOB-${randomUUID()}`),
    connectorId,
    environmentId,
    jobType,
    idempotencyKeyHash,
    idempotencyHits: 0,
    payloadDigest: sha256(JSON.stringify(input.payload || {})),
    status: "queued",
    attempts: 0,
    maxAttempts: Math.max(1, Number(input.maxAttempts || 3)),
    retryBaseSeconds: Math.max(1, Number(input.retryBaseSeconds || 15)),
    retryMaxSeconds: Math.max(1, Number(input.retryMaxSeconds || 900)),
    nextAttemptAt: now,
    progress: 0,
    queuedAt: now,
    startedAt: "",
    completedAt: "",
    receiptId: "",
    errorCode: "",
    leaseOwner: "",
    leaseTokenHash: "",
    leaseExpiresAt: "",
    lastHeartbeatAt: "",
    deadLetterId: "",
    generation: 1
  };
  state.jobs.unshift(job);
  recordExecutionEvent(state, {
    jobId: job.id,
    type: "job-enqueued",
    status: job.status,
    detail: `${job.connectorId}:${job.jobType}`,
    occurredAt: now
  });
  return { duplicate: false, job: clone(job) };
}

function jobById(state, jobId) {
  const job = state?.jobs?.find((item) => item.id === jobId);
  if (!job) throw executionError("execution job was not found", "JOB_NOT_FOUND", 404);
  return job;
}

function workerById(state, workerId) {
  const worker = state?.workers?.find((item) => item.id === workerId);
  if (!worker) throw executionError("execution worker was not found", "WORKER_NOT_FOUND", 404);
  return worker;
}

function assertLease(job, input = {}) {
  const workerId = String(input.workerId || "").trim();
  const leaseToken = String(input.leaseToken || "").trim();
  if (!workerId || !leaseToken || job.leaseOwner !== workerId || job.leaseTokenHash !== sha256(leaseToken)) {
    throw executionError("execution lease is invalid", "LEASE_INVALID", 403);
  }
}

function releaseWorker(state, job, now, status = "ready") {
  const worker = state.workers.find((item) => item.id === job.leaseOwner);
  if (worker) {
    worker.status = status;
    worker.activeJobId = "";
    if (status !== "stale") worker.lastHeartbeatAt = now;
  }
  job.leaseOwner = "";
  job.leaseTokenHash = "";
  job.leaseExpiresAt = "";
  job.lastHeartbeatAt = "";
}

function claimExecutionJob(state, input = {}) {
  if (!state || !Array.isArray(state.jobs) || !Array.isArray(state.workers)) {
    throw executionError("execution state is required", "STATE_REQUIRED");
  }
  const workerId = String(input.workerId || "").trim();
  const worker = workerById(state, workerId);
  if (worker.activeJobId) throw executionError("worker already owns an active job", "WORKER_BUSY", 409);
  const now = String(input.now || new Date().toISOString());
  const nowMs = parseTime(now, "now");
  const leaseSeconds = Math.max(10, Number(input.leaseSeconds || 60));
  const requestedJobId = String(input.jobId || "").trim();
  const activeQuarantines = new Set(
    state.quarantines.filter((item) => item.status === "active").map((item) => item.connectorId)
  );
  const healthyEnvironments = new Set(
    state.environments.filter((item) => item.status === "healthy").map((item) => item.id)
  );
  const candidates = state.jobs
    .filter((job) => !requestedJobId || job.id === requestedJobId)
    .filter((job) => CLAIMABLE_JOB_STATUSES.has(job.status))
    .filter((job) => !job.nextAttemptAt || Date.parse(job.nextAttemptAt) <= nowMs)
    .filter((job) => !activeQuarantines.has(job.connectorId))
    .filter((job) => healthyEnvironments.has(job.environmentId))
    .filter((job) => !worker.capabilities.length || worker.capabilities.includes(job.jobType))
    .sort((left, right) => String(left.nextAttemptAt || left.queuedAt).localeCompare(String(right.nextAttemptAt || right.queuedAt)));
  const job = candidates[0];
  if (!job) return null;
  const leaseToken = `lease-${randomUUID()}`;
  job.status = "running";
  job.attempts = Number(job.attempts || 0) + 1;
  job.progress = Math.max(10, Number(job.progress || 0));
  job.startedAt = job.startedAt || now;
  job.leaseOwner = worker.id;
  job.leaseTokenHash = sha256(leaseToken);
  job.leaseExpiresAt = new Date(nowMs + leaseSeconds * 1000).toISOString();
  job.lastHeartbeatAt = now;
  job.errorCode = "";
  worker.status = "busy";
  worker.activeJobId = job.id;
  worker.lastHeartbeatAt = now;
  recordExecutionEvent(state, {
    jobId: job.id,
    workerId: worker.id,
    type: "job-claimed",
    status: job.status,
    detail: `attempt:${job.attempts}`,
    occurredAt: now
  });
  return { job: clone(job), leaseToken };
}

function heartbeatExecutionJob(state, jobId, input = {}) {
  const job = jobById(state, jobId);
  if (job.status !== "running") throw executionError("only running jobs accept heartbeats", "JOB_NOT_RUNNING", 409);
  assertLease(job, input);
  const now = String(input.now || new Date().toISOString());
  const nowMs = parseTime(now, "now");
  const leaseSeconds = Math.max(10, Number(input.leaseSeconds || 60));
  if (Date.parse(job.leaseExpiresAt) < nowMs) throw executionError("execution lease has expired", "LEASE_EXPIRED", 409);
  job.lastHeartbeatAt = now;
  job.leaseExpiresAt = new Date(nowMs + leaseSeconds * 1000).toISOString();
  job.progress = Math.max(Number(job.progress || 0), Math.min(80, Number(input.progress || job.progress || 10)));
  const worker = workerById(state, job.leaseOwner);
  worker.lastHeartbeatAt = now;
  recordExecutionEvent(state, {
    jobId: job.id,
    workerId: worker.id,
    type: "job-heartbeat",
    status: job.status,
    detail: `progress:${job.progress}`,
    occurredAt: now
  });
  return clone(job);
}

function completeExecutionAttempt(state, jobId, input = {}) {
  const job = jobById(state, jobId);
  if (job.status !== "running") throw executionError("only running jobs can await a receipt", "JOB_NOT_RUNNING", 409);
  assertLease(job, input);
  const now = String(input.now || new Date().toISOString());
  parseTime(now, "now");
  const workerId = job.leaseOwner;
  releaseWorker(state, job, now);
  job.status = "awaiting-receipt";
  job.progress = 85;
  recordExecutionEvent(state, {
    jobId: job.id,
    workerId,
    type: "attempt-completed",
    status: job.status,
    detail: "callback-receipt-required",
    occurredAt: now
  });
  return clone(job);
}

function deadLetterJob(state, job, errorCode, now) {
  const deadLetter = {
    id: `DLQ-${randomUUID()}`,
    jobId: job.id,
    connectorId: job.connectorId,
    environmentId: job.environmentId,
    jobType: job.jobType,
    payloadDigest: job.payloadDigest,
    errorCode,
    attempts: Number(job.attempts || 0),
    generation: Number(job.generation || 1),
    status: "open",
    createdAt: now,
    reviewedBy: "",
    reviewNote: "",
    redrivenAt: ""
  };
  state.deadLetters.unshift(deadLetter);
  job.status = "dead-lettered";
  job.deadLetterId = deadLetter.id;
  job.nextAttemptAt = "";
  return deadLetter;
}

function scheduleExecutionFailure(state, job, input = {}) {
  const now = String(input.now || new Date().toISOString());
  const nowMs = parseTime(now, "now");
  const errorCode = String(input.errorCode || "EXECUTION_FAILED").trim().slice(0, 80);
  const failureClass = String(input.failureClass || "transient");
  const retryable = ["transient", "worker-lost"].includes(failureClass)
    && Number(job.attempts || 0) < Number(job.maxAttempts || 3);
  const workerId = job.leaseOwner;
  releaseWorker(state, job, now, failureClass === "worker-lost" ? "stale" : "ready");
  job.errorCode = errorCode;
  if (retryable) {
    const delaySeconds = Math.min(
      Number(job.retryMaxSeconds || 900),
      Number(job.retryBaseSeconds || 15) * (2 ** Math.max(0, Number(job.attempts || 1) - 1))
    );
    job.status = "retry-scheduled";
    job.nextAttemptAt = new Date(nowMs + delaySeconds * 1000).toISOString();
    job.progress = 0;
    recordExecutionEvent(state, {
      jobId: job.id,
      workerId,
      type: "retry-scheduled",
      status: job.status,
      detail: `${errorCode}:retry-in-${delaySeconds}s`,
      occurredAt: now
    });
    return { retryScheduled: true, job: clone(job), deadLetter: null };
  }
  const deadLetter = deadLetterJob(state, job, errorCode, now);
  recordExecutionEvent(state, {
    jobId: job.id,
    workerId,
    type: "job-dead-lettered",
    status: job.status,
    detail: `${deadLetter.id}:${errorCode}`,
    occurredAt: now
  });
  return { retryScheduled: false, job: clone(job), deadLetter: clone(deadLetter) };
}

function failExecutionAttempt(state, jobId, input = {}) {
  const job = jobById(state, jobId);
  if (job.status !== "running") throw executionError("only running jobs can fail an attempt", "JOB_NOT_RUNNING", 409);
  assertLease(job, input);
  return scheduleExecutionFailure(state, job, input);
}

function recoverExpiredLeases(state, input = {}) {
  const now = String(input.now || new Date().toISOString());
  const nowMs = parseTime(now, "now");
  const recovered = state.jobs
    .filter((job) => job.status === "running" && job.leaseExpiresAt && Date.parse(job.leaseExpiresAt) <= nowMs)
    .map((job) => scheduleExecutionFailure(state, job, {
      now,
      errorCode: "WORKER_LEASE_EXPIRED",
      failureClass: "worker-lost"
    }));
  return clone(recovered);
}

function redriveDeadLetter(state, deadLetterId, input = {}) {
  const deadLetter = state?.deadLetters?.find((item) => item.id === deadLetterId);
  if (!deadLetter) throw executionError("dead letter was not found", "DEAD_LETTER_NOT_FOUND", 404);
  if (deadLetter.status !== "open") throw executionError("dead letter cannot be redriven", "DEAD_LETTER_STATE_INVALID", 409);
  const reviewedBy = String(input.reviewedBy || "").trim();
  const reviewNote = String(input.reviewNote || "").trim();
  if (!reviewedBy || reviewNote.length < 8) {
    throw executionError("dead letter redrive requires an approver and review note", "DEAD_LETTER_REVIEW_REQUIRED");
  }
  const job = jobById(state, deadLetter.jobId);
  const now = String(input.now || new Date().toISOString());
  parseTime(now, "now");
  deadLetter.status = "redriven";
  deadLetter.reviewedBy = reviewedBy;
  deadLetter.reviewNote = reviewNote;
  deadLetter.redrivenAt = now;
  job.status = "queued";
  job.attempts = 0;
  job.progress = 0;
  job.nextAttemptAt = now;
  job.errorCode = "";
  job.deadLetterId = "";
  job.generation = Number(job.generation || 1) + 1;
  recordExecutionEvent(state, {
    jobId: job.id,
    type: "dead-letter-redriven",
    status: job.status,
    detail: `${deadLetter.id}:${reviewedBy}`,
    occurredAt: now
  });
  return { job: clone(job), deadLetter: clone(deadLetter) };
}

function getExecutionRuntimeSummary(state, now = new Date().toISOString()) {
  const nowMs = parseTime(now, "now");
  const activeQuarantines = new Set(
    state.quarantines.filter((item) => item.status === "active").map((item) => item.connectorId)
  );
  const healthyEnvironments = new Set(
    state.environments.filter((item) => item.status === "healthy").map((item) => item.id)
  );
  return {
    readyWorkers: state.workers.filter((item) => item.status === "ready").length,
    busyWorkers: state.workers.filter((item) => item.status === "busy").length,
    staleWorkers: state.workers.filter((item) => item.status === "stale").length,
    claimableJobs: state.jobs.filter((item) => CLAIMABLE_JOB_STATUSES.has(item.status)
      && (!item.nextAttemptAt || Date.parse(item.nextAttemptAt) <= nowMs)
      && healthyEnvironments.has(item.environmentId)
      && !activeQuarantines.has(item.connectorId)).length,
    runningJobs: state.jobs.filter((item) => item.status === "running").length,
    retryScheduledJobs: state.jobs.filter((item) => item.status === "retry-scheduled").length,
    awaitingReceiptJobs: state.jobs.filter((item) => item.status === "awaiting-receipt").length,
    openDeadLetters: state.deadLetters.filter((item) => item.status === "open").length
  };
}

function advanceExecutionJob(state, jobId, now = new Date().toISOString()) {
  const job = jobById(state, jobId);
  const nextStatus = JOB_TRANSITIONS[job.status];
  if (!nextStatus) throw executionError("execution job cannot be advanced", "JOB_TRANSITION_INVALID", 409);
  job.status = nextStatus;
  if (nextStatus === "running") {
    job.attempts += 1;
    job.progress = 45;
    job.startedAt = String(now);
  }
  if (nextStatus === "awaiting-receipt") job.progress = 85;
  recordExecutionEvent(state, {
    jobId: job.id,
    type: "job-advanced",
    status: job.status,
    detail: `progress:${job.progress}`,
    occurredAt: String(now)
  });
  return clone(job);
}

function upsertQuarantine(state, connectorId, reason, now) {
  const existing = state.quarantines.find((item) => item.connectorId === connectorId && item.status === "active");
  if (existing) {
    existing.hits += 1;
    existing.reason = reason;
    existing.updatedAt = now;
    return existing;
  }
  const quarantine = {
    id: `QUAR-${randomUUID()}`,
    connectorId,
    reason,
    hits: 1,
    status: "active",
    openedAt: now,
    updatedAt: now,
    releasedAt: ""
  };
  state.quarantines.unshift(quarantine);
  return quarantine;
}

function recordReplayEvent(state, source, nonceHash, now) {
  const existing = state.replayEvents.find((item) => item.source === source && item.nonceHash === nonceHash);
  if (existing) {
    existing.hits += 1;
    existing.lastSeenAt = now;
    existing.status = "blocked";
    return existing;
  }
  const event = {
    id: `REPLAY-${randomUUID()}`,
    source,
    nonceHash,
    hits: 2,
    firstSeenAt: now,
    lastSeenAt: now,
    action: "block-and-quarantine",
    status: "blocked"
  };
  state.replayEvents.unshift(event);
  return event;
}

function verifyExecutionCallback(state, input, policy = {}) {
  if (!state || !Array.isArray(state.receipts)) throw executionError("execution state is required", "STATE_REQUIRED");
  const job = state.jobs.find((item) => item.id === input?.jobId);
  if (!job) throw executionError("callback job was not found", "JOB_NOT_FOUND", 404);
  if (job.status !== "awaiting-receipt") {
    throw executionError("callback job is not awaiting a receipt", "CALLBACK_STATE_INVALID", 409);
  }
  const source = String(input.source || job.connectorId).trim();
  const nonce = String(input.nonce || "").trim();
  const payloadDigest = String(input.payloadDigest || "").trim().toLowerCase();
  if (!nonce || !/^[a-f0-9]{64}$/.test(payloadDigest)) {
    throw executionError("callback nonce and SHA-256 payloadDigest are required", "CALLBACK_INPUT_INVALID");
  }
  const now = String(input.now || new Date().toISOString());
  const nowMs = Date.parse(now);
  const timestampMs = Date.parse(String(input.timestamp || ""));
  const maxSkewSeconds = Math.max(1, Number(policy.maxSkewSeconds || 300));
  const nonceHash = sha256(`${source}:${nonce}`);
  const replayed = state.receipts.some((item) => item.source === source && item.nonceHash === nonceHash);
  const signatureStatus = input.signatureValid === true ? "valid" : "invalid";
  const timestampStatus = Number.isFinite(timestampMs) && Math.abs(nowMs - timestampMs) <= maxSkewSeconds * 1000 ? "valid" : "expired";
  const nonceStatus = replayed ? "replayed" : "fresh";
  const digestStatus = payloadDigest === job.payloadDigest ? "matched" : "mismatched";
  const accepted = signatureStatus === "valid" && timestampStatus === "valid" && nonceStatus === "fresh" && digestStatus === "matched";
  const receipt = {
    id: String(input.id || `RECEIPT-${randomUUID()}`),
    jobId: job.id,
    connectorId: job.connectorId,
    source,
    eventType: String(input.eventType || "integration-job.completed"),
    signatureStatus,
    timestampStatus,
    nonceStatus,
    nonceHash,
    payloadDigest,
    digestStatus,
    status: accepted ? "accepted" : "blocked",
    decision: accepted ? "verified" : replayed ? "replay-blocked" : "verification-failed",
    receivedAt: now
  };
  state.receipts.unshift(receipt);
  if (accepted) {
    if (job.leaseOwner) releaseWorker(state, job, now);
    job.status = "succeeded";
    job.progress = 100;
    job.completedAt = now;
    job.receiptId = receipt.id;
    job.errorCode = "";
  } else {
    job.status = "blocked";
    job.errorCode = receipt.decision;
    upsertQuarantine(state, job.connectorId, receipt.decision, now);
    if (replayed) recordReplayEvent(state, source, nonceHash, now);
  }
  return { accepted, receipt: clone(receipt) };
}

function evaluateCutoverWindow(state, windowId, now = new Date().toISOString()) {
  const window = state?.cutoverWindows?.find((item) => item.id === windowId);
  if (!window) throw executionError("cutover window was not found", "CUTOVER_NOT_FOUND", 404);
  const environment = state.environments.find((item) => item.id === window.environmentId);
  const connectors = Array.isArray(window.connectorIds) ? window.connectorIds : [];
  const activeVaultConnectors = new Set(
    state.vaultEntries
      .filter((item) => item.environmentId === window.environmentId && item.status === "active")
      .map((item) => item.connectorId)
  );
  const successfulJobConnectors = new Set(
    state.jobs
      .filter((item) => item.environmentId === window.environmentId && item.status === "succeeded")
      .map((item) => item.connectorId)
  );
  const quarantinedConnectors = new Set(
    state.quarantines.filter((item) => item.status === "active").map((item) => item.connectorId)
  );
  const checks = {
    integrationApproved: window.integrationApproved === true,
    environmentHealthy: environment?.status === "healthy",
    vaultReady: connectors.length > 0 && connectors.every((id) => activeVaultConnectors.has(id)),
    receiptsVerified: connectors.length > 0 && connectors.every((id) => successfulJobConnectors.has(id)),
    noActiveQuarantine: connectors.every((id) => !quarantinedConnectors.has(id)),
    rollbackPlanReady: String(window.rollbackPlan || "").trim().length >= 8
  };
  window.checks = checks;
  window.evaluatedAt = String(now);
  window.status = Object.values(checks).every(Boolean) ? "ready" : "blocked";
  return clone(window);
}

function releaseQuarantine(state, quarantineId, input = {}) {
  const quarantine = state?.quarantines?.find((item) => item.id === quarantineId);
  if (!quarantine) throw executionError("quarantine was not found", "QUARANTINE_NOT_FOUND", 404);
  if (String(input.reviewNote || "").trim().length < 8) {
    throw executionError("quarantine release requires a review note", "REVIEW_NOTE_REQUIRED");
  }
  quarantine.status = "released";
  quarantine.reviewNote = String(input.reviewNote).trim();
  quarantine.releasedAt = String(input.now || new Date().toISOString());
  quarantine.releasedBy = String(input.releasedBy || "");
  return clone(quarantine);
}

module.exports = {
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
  registerVaultReference,
  registerExecutionWorker,
  releaseQuarantine,
  sha256,
  verifyExecutionCallback
};
