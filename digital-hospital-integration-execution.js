const { createHash, randomUUID } = require("node:crypto");

const JOB_TRANSITIONS = {
  queued: "running",
  running: "awaiting-receipt"
};

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

function createExecutionState(seed = {}) {
  return {
    environments: clone(seed.environments || []),
    vaultEntries: clone(seed.vaultEntries || []),
    jobs: clone(seed.jobs || []),
    receipts: clone(seed.receipts || []),
    replayEvents: clone(seed.replayEvents || []),
    quarantines: clone(seed.quarantines || []),
    cutoverWindows: clone(seed.cutoverWindows || [])
  };
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
    progress: 0,
    queuedAt: now,
    startedAt: "",
    completedAt: "",
    receiptId: "",
    errorCode: ""
  };
  state.jobs.unshift(job);
  return { duplicate: false, job: clone(job) };
}

function advanceExecutionJob(state, jobId, now = new Date().toISOString()) {
  const job = state?.jobs?.find((item) => item.id === jobId);
  if (!job) throw executionError("execution job was not found", "JOB_NOT_FOUND", 404);
  const nextStatus = JOB_TRANSITIONS[job.status];
  if (!nextStatus) throw executionError("execution job cannot be advanced", "JOB_TRANSITION_INVALID", 409);
  job.status = nextStatus;
  if (nextStatus === "running") {
    job.attempts += 1;
    job.progress = 45;
    job.startedAt = String(now);
  }
  if (nextStatus === "awaiting-receipt") job.progress = 85;
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
  createExecutionState,
  enqueueExecutionJob,
  evaluateCutoverWindow,
  registerVaultReference,
  releaseQuarantine,
  sha256,
  verifyExecutionCallback
};
