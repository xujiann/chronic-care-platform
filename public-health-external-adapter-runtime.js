const crypto = require("node:crypto");
const {
  applyPublicHealthCoordinationActionToState,
  buildPublicHealthCoordinationRuntime
} = require("./public-health-coordination-runtime");
const {
  createPublicHealthExternalDispatch,
  recordPublicHealthExternalDeliveryAttempt,
  verifyPublicHealthExternalDispatch,
  verifyPublicHealthExternalReceipt
} = require("./public-health-external-adapter-service");
const {
  LEGACY_KEY_ID,
  resolveVerificationKey,
  selectSigningKey
} = require("./public-health-external-keyring-service");
const {
  assertPublicHealthExternalBackpressure,
  buildPublicHealthExternalResilienceRuntime,
  recordPublicHealthExternalLaneOutcomeToState,
  reservePublicHealthExternalLaneCapacityToState,
  verifyPublicHealthExternalLaneControlAuditChain
} = require("./public-health-external-resilience-service");
const {
  authorizePublicHealthExternalContract
} = require("./public-health-external-contract-governance-service");

const EXTERNAL_AUDIT_SCHEMA_VERSION = "public-health-external-audit/v1";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function clean(value) {
  return String(value ?? "").trim();
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function timingSafeHexEqual(left, right) {
  if (!/^[a-f0-9]{64}$/i.test(clean(left)) || !/^[a-f0-9]{64}$/i.test(clean(right))) return false;
  return crypto.timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = stableValue(value[key]);
      return result;
    }, {});
  }
  return value;
}

function runtimeStatePayload(dispatch) {
  const payload = {
    id: dispatch.id,
    requestDigest: dispatch.requestDigest,
    outboxVersion: dispatch.outboxVersion,
    deliveryState: dispatch.deliveryState,
    attempts: dispatch.attempts,
    maxAttempts: dispatch.maxAttempts,
    nextRetryAt: dispatch.nextRetryAt,
    receipt: dispatch.receipt,
    blocker: dispatch.blocker,
    compensation: dispatch.compensation,
    lease: dispatch.lease || null,
    recovery: dispatch.recovery || null,
    predecessorDispatchId: dispatch.predecessorDispatchId || "",
    remediationEvidenceRefs: dispatch.remediationEvidenceRefs || [],
    auditHead: dispatch.auditHead || "",
    productionReady: false
  };
  if (Object.hasOwn(dispatch, "runtimeStateKeyId") || Object.hasOwn(dispatch, "runtimeStateSignedAt")) {
    payload.runtimeStateKeyId = clean(dispatch.runtimeStateKeyId || LEGACY_KEY_ID);
    payload.runtimeStateSignedAt = clean(dispatch.runtimeStateSignedAt);
  }
  return payload;
}

function requestSigningMaterial(credentials = {}) {
  return credentials.requestKeyring || credentials.requestSecret;
}

function receiptSigningMaterial(credentials = {}) {
  return credentials.receiptKeyring || credentials.receiptSecret;
}

function resiliencePolicyFor(credentials = {}, laneId) {
  if (typeof credentials.resiliencePolicy === "function") {
    return credentials.resiliencePolicy(laneId) || null;
  }
  if (credentials.resiliencePolicies && typeof credentials.resiliencePolicies === "object") {
    return credentials.resiliencePolicies[laneId] || null;
  }
  return credentials.resiliencePolicy || null;
}

function assertDispatchContractGovernance(dispatch, governance) {
  if (!governance) return { ok: true, reason: "governance-not-configured" };
  const lane = governance.entries?.find((item) => item.laneId === dispatch.laneId);
  const contract = lane?.contracts?.find((item) => item.contract === dispatch.contract);
  const authorization = authorizePublicHealthExternalContract(
    governance,
    dispatch.laneId,
    dispatch.contract,
    dispatch.request?.schemaVersion,
    dispatch.receipt?.schemaVersion || contract?.receiptSchemaVersion || ""
  );
  if (!authorization.ok) {
    throw new Error(`public health external contract rejected: ${authorization.reason}`);
  }
  return authorization;
}

function signRuntimeState(dispatch, key) {
  return crypto.createHmac("sha256", key.secret)
    .update(JSON.stringify(stableValue(runtimeStatePayload(dispatch))))
    .digest("hex");
}

function withRuntimeStateSignature(dispatch, signingMaterial, at = new Date().toISOString()) {
  const signingKey = selectSigningKey(signingMaterial, at);
  const signed = {
    ...dispatch,
    runtimeStateSignatureAlgorithm: "HMAC-SHA256",
    runtimeStateKeyId: signingKey.keyId,
    runtimeStateSignedAt: clean(at)
  };
  return { ...signed, runtimeStateSignature: signRuntimeState(signed, signingKey) };
}

function verifyRuntimeStateSignature(dispatch, signingMaterial) {
  const keyId = clean(dispatch?.runtimeStateKeyId || LEGACY_KEY_ID);
  const keyResolution = resolveVerificationKey(
    signingMaterial,
    keyId,
    clean(dispatch?.runtimeStateSignedAt || dispatch?.request?.issuedAt || new Date().toISOString())
  );
  if (!keyResolution.ok) return false;
  let expected;
  try {
    expected = signRuntimeState(dispatch, keyResolution.key);
  } catch {
    return false;
  }
  if (clean(dispatch.runtimeStateSignatureAlgorithm) !== "HMAC-SHA256"
    || !/^[a-f0-9]{64}$/i.test(clean(dispatch.runtimeStateSignature))
    || !/^[a-f0-9]{64}$/i.test(expected)) return false;
  return crypto.timingSafeEqual(Buffer.from(dispatch.runtimeStateSignature, "hex"), Buffer.from(expected, "hex"));
}

function rows(data, key) {
  return Array.isArray(data?.[key]) ? data[key] : [];
}

function auditPayload(entry) {
  const { auditHash, auditSignature, ...payload } = entry;
  return payload;
}

function signExternalAuditEntry(entry, previousAuditHash, signingMaterial) {
  const signingKey = selectSigningKey(signingMaterial, clean(entry.at || new Date().toISOString()));
  const payload = {
    ...entry,
    auditSchemaVersion: EXTERNAL_AUDIT_SCHEMA_VERSION,
    previousAuditHash: clean(previousAuditHash),
    auditKeyId: signingKey.keyId
  };
  const auditHash = sha256(JSON.stringify(stableValue(payload)));
  const auditSignature = crypto.createHmac("sha256", signingKey.secret).update(auditHash).digest("hex");
  return { ...payload, auditHash, auditSignature };
}

function verifyPublicHealthExternalAuditChain(data = {}, dispatchId, signingMaterial) {
  const dispatch = rows(data, "publicHealthExternalDispatches").find((item) => item.id === clean(dispatchId));
  if (!dispatch) return { ok: false, reason: "dispatch-missing", entries: 0, auditHead: "" };
  const audit = rows(data, "publicHealthExternalDispatchAudit").filter((item) => item.dispatchId === dispatch.id);
  let previousAuditHash = "";
  for (const entry of audit) {
    if (entry.auditSchemaVersion !== EXTERNAL_AUDIT_SCHEMA_VERSION || clean(entry.previousAuditHash) !== previousAuditHash) {
      return { ok: false, reason: "audit-chain-link-invalid", entries: audit.length, auditHead: previousAuditHash };
    }
    const expectedHash = sha256(JSON.stringify(stableValue(auditPayload(entry))));
    const keyResolution = resolveVerificationKey(
      signingMaterial,
      clean(entry.auditKeyId || LEGACY_KEY_ID),
      clean(entry.at)
    );
    if (!keyResolution.ok) {
      return { ok: false, reason: `audit-${keyResolution.reason}`, entries: audit.length, auditHead: previousAuditHash };
    }
    const expectedSignature = crypto.createHmac("sha256", keyResolution.key.secret).update(expectedHash).digest("hex");
    if (!timingSafeHexEqual(entry.auditHash, expectedHash) || !timingSafeHexEqual(entry.auditSignature, expectedSignature)) {
      return { ok: false, reason: "audit-entry-signature-invalid", entries: audit.length, auditHead: previousAuditHash };
    }
    previousAuditHash = entry.auditHash;
  }
  if (clean(dispatch.auditHead) !== previousAuditHash) {
    return { ok: false, reason: "audit-head-mismatch", entries: audit.length, auditHead: previousAuditHash };
  }
  return { ok: true, reason: "verified", entries: audit.length, auditHead: previousAuditHash };
}

function assertExternalAuditChain(data, dispatch, signingMaterial) {
  const verification = verifyPublicHealthExternalAuditChain(data, dispatch.id, signingMaterial);
  if (!verification.ok) throw new Error(`persisted public health external audit rejected: ${verification.reason}`);
  return verification;
}

function appendExternalAudit(auditRows, dispatch, audit, signingMaterial) {
  const signedAudit = signExternalAuditEntry(audit, dispatch.auditHead, signingMaterial);
  const updatedDispatch = withRuntimeStateSignature({
    ...dispatch,
    auditHead: signedAudit.auditHash
  }, signingMaterial, signedAudit.at);
  return {
    auditRows: [...auditRows, signedAudit],
    dispatch: updatedDispatch,
    audit: signedAudit
  };
}

function timeValue(value, label) {
  const parsed = new Date(value).getTime();
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a valid date-time`);
  return parsed;
}

function isLeaseActive(dispatch, now) {
  return Boolean(dispatch.lease?.expiresAt && timeValue(dispatch.lease.expiresAt, "lease expiresAt") > timeValue(now, "now"));
}

function isDispatchDue(dispatch, now) {
  if (!["pending", "retry-scheduled"].includes(dispatch.deliveryState)) return false;
  if (isLeaseActive(dispatch, now)) return false;
  if (dispatch.deliveryState === "pending") return true;
  return Boolean(dispatch.nextRetryAt && timeValue(dispatch.nextRetryAt, "nextRetryAt") <= timeValue(now, "now"));
}

function buildPublicHealthExternalAdapterRuntime(data = {}) {
  const dispatches = clone(rows(data, "publicHealthExternalDispatches"));
  const audit = clone(rows(data, "publicHealthExternalDispatchAudit"));
  const resilience = buildPublicHealthExternalResilienceRuntime(data);
  return {
    ok: true,
    functionalState: "eight-domain-external-outbox-persistence-ready",
    dispatches,
    audit,
    summary: {
      dispatches: dispatches.length,
      pending: dispatches.filter((item) => item.deliveryState === "pending").length,
      retryScheduled: dispatches.filter((item) => item.deliveryState === "retry-scheduled").length,
      leased: dispatches.filter((item) => item.lease).length,
      delivered: dispatches.filter((item) => item.deliveryState === "delivered").length,
      deadLetter: dispatches.filter((item) => item.deliveryState === "dead-letter").length,
      recoveredDeadLetters: dispatches.filter((item) => item.recovery?.state === "requeued").length,
      recoverySuccessors: dispatches.filter((item) => item.predecessorDispatchId).length,
      auditEntries: audit.length,
      resilienceLanes: resilience.summary.lanes,
      openCircuits: resilience.summary.open,
      halfOpenCircuits: resilience.summary.halfOpen
    },
    resilience,
    productionReady: false,
    blockers: [
      "T00 must persist the returned immutable state through the shared writer.",
      "Production endpoints, secrets, resilience policies, signed receipts and trusted site evidence remain required."
    ]
  };
}

function listDuePublicHealthExternalDispatches(data = {}, options = {}) {
  const now = clean(options.now || new Date().toISOString());
  timeValue(now, "now");
  const limit = Number(options.limit || 20);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("outbox due limit must be an integer from 1 to 100");
  return rows(data, "publicHealthExternalDispatches")
    .filter((item) => isDispatchDue(item, now))
    .sort((left, right) => {
      const leftDue = left.nextRetryAt ? timeValue(left.nextRetryAt, "nextRetryAt") : 0;
      const rightDue = right.nextRetryAt ? timeValue(right.nextRetryAt, "nextRetryAt") : 0;
      return leftDue - rightDue || clean(left.id).localeCompare(clean(right.id));
    })
    .slice(0, limit)
    .map((item) => ({
      id: item.id,
      laneId: item.laneId,
      handoffId: item.handoffId,
      deliveryState: item.deliveryState,
      attempts: Array.isArray(item.attempts) ? item.attempts.length : 0,
      nextRetryAt: item.nextRetryAt,
      outboxVersion: item.outboxVersion,
      expiredLeaseReclaimable: Boolean(item.lease)
    }));
}

function leaseTokenFor(dispatchId, lease, signingMaterial) {
  const keyResolution = resolveVerificationKey(
    signingMaterial,
    clean(lease.signingKeyId || LEGACY_KEY_ID),
    clean(lease.claimedAt)
  );
  if (!keyResolution.ok) throw new Error(`external dispatch lease ${keyResolution.reason}`);
  return crypto.createHmac("sha256", keyResolution.key.secret)
    .update(JSON.stringify(stableValue({
      dispatchId,
      workerIdHash: lease.workerIdHash,
      idempotencyKeyHash: lease.idempotencyKeyHash,
      claimedAt: lease.claimedAt,
      expiresAt: lease.expiresAt
    })))
    .digest("hex");
}

function claimPublicHealthExternalDispatchToState(data = {}, dispatchId, input = {}, credentials = {}) {
  const workerId = clean(input.workerId);
  const idempotencyKey = clean(input.idempotencyKey);
  const now = clean(input.now || new Date().toISOString());
  const leaseSeconds = Number(input.leaseSeconds || 60);
  if (!workerId || !idempotencyKey) throw new Error("workerId and idempotencyKey are required to claim external dispatch");
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 15 || leaseSeconds > 900) {
    throw new Error("leaseSeconds must be an integer from 15 to 900");
  }
  const nowValue = timeValue(now, "now");
  const dispatches = clone(rows(data, "publicHealthExternalDispatches"));
  const index = dispatches.findIndex((item) => item.id === clean(dispatchId));
  if (index < 0) throw new Error(`unknown public health external dispatch: ${clean(dispatchId) || "missing"}`);
  const current = dispatches[index];
  const signingMaterial = requestSigningMaterial(credentials);
  const requestVerification = verifyPublicHealthExternalDispatch(current, signingMaterial);
  if (!requestVerification.ok || !verifyRuntimeStateSignature(current, signingMaterial)) {
    throw new Error(`persisted public health external dispatch rejected: ${requestVerification.ok ? "runtime-state-signature-invalid" : requestVerification.reason}`);
  }
  assertExternalAuditChain(data, current, signingMaterial);
  const resiliencePolicy = resiliencePolicyFor(credentials, current.laneId);
  if (resiliencePolicy && rows(data, "publicHealthExternalLaneControls").some((item) => item.laneId === current.laneId)) {
    const laneControlVerification = verifyPublicHealthExternalLaneControlAuditChain(data, current.laneId, signingMaterial);
    if (!laneControlVerification.ok) {
      throw new Error(`public health external lane control rejected: ${laneControlVerification.reason}`);
    }
  }
  const workerIdHash = sha256(workerId);
  const idempotencyKeyHash = sha256(idempotencyKey);
  const auditRows = clone(rows(data, "publicHealthExternalDispatchAudit"));
  const duplicate = auditRows.find((item) => (
    item.dispatchId === current.id
    && item.action === "claim-external-dispatch"
    && item.idempotencyKeyHash === idempotencyKeyHash
  ));
  if (duplicate) {
    if (duplicate.workerIdHash !== workerIdHash) throw new Error("claim idempotency key was reused by a different worker");
    const leaseToken = current.lease?.idempotencyKeyHash === idempotencyKeyHash
      ? leaseTokenFor(current.id, current.lease, signingMaterial)
      : "";
    return {
      ok: true,
      idempotent: true,
      leaseToken,
      dispatch: current,
      nextData: {
        ...data,
        publicHealthExternalDispatches: dispatches,
        publicHealthExternalDispatchAudit: auditRows
      },
      productionReady: false
    };
  }
  const contractAuthorization = assertDispatchContractGovernance(current, credentials.contractGovernance);
  if (input.expectedVersion === undefined || Number(input.expectedVersion) !== Number(current.outboxVersion)) {
    throw new Error(`external dispatch version conflict: expected ${input.expectedVersion ?? "missing"}, current ${current.outboxVersion}`);
  }
  if (isLeaseActive(current, now)) throw new Error("external dispatch is already claimed by an active worker lease");
  if (!isDispatchDue(current, now)) throw new Error("external dispatch is not due for delivery");
  const laneReservation = resiliencePolicy
    ? reservePublicHealthExternalLaneCapacityToState(
      data,
      current.laneId,
      { at: now, expectedVersion: input.expectedLaneControlVersion },
      signingMaterial,
      resiliencePolicy
    )
    : null;
  const expiresAt = new Date(nowValue + leaseSeconds * 1000).toISOString();
  const leaseSigningKey = selectSigningKey(signingMaterial, now);
  const lease = {
    workerIdHash,
    idempotencyKeyHash,
    claimedAt: new Date(nowValue).toISOString(),
    expiresAt,
    signingKeyId: leaseSigningKey.keyId
  };
  const leaseToken = leaseTokenFor(current.id, lease, signingMaterial);
  lease.tokenHash = sha256(leaseToken);
  const updatedBase = {
    ...current,
    lease,
    outboxVersion: Number(current.outboxVersion) + 1
  };
  const audit = {
    id: `${current.id}:audit:lease:${idempotencyKeyHash.slice(0, 16)}`,
    dispatchId: current.id,
    handoffId: current.handoffId,
    laneId: current.laneId,
    action: "claim-external-dispatch",
    from: current.deliveryState,
    to: current.deliveryState,
    fromVersion: current.outboxVersion,
    toVersion: updatedBase.outboxVersion,
    at: lease.claimedAt,
    leaseExpiresAt: expiresAt,
    workerIdHash,
    idempotencyKeyHash,
    reclaimedExpiredLease: Boolean(current.lease)
  };
  const appended = appendExternalAudit(auditRows, updatedBase, audit, signingMaterial);
  const updated = appended.dispatch;
  dispatches[index] = updated;
  const nextData = {
    ...(laneReservation?.nextData || data),
    publicHealthExternalDispatches: dispatches,
    publicHealthExternalDispatchAudit: appended.auditRows
  };
  return {
    ok: true,
    idempotent: false,
    leaseToken,
    laneControl: laneReservation?.control || null,
    contractAuthorization,
    dispatch: clone(updated),
    nextData,
    externalRuntime: buildPublicHealthExternalAdapterRuntime(nextData),
    productionReady: false
  };
}

function requireCompensation(input = {}) {
  const owner = clean(input.exceptionOwner);
  const dueAt = clean(input.exceptionDueAt || input.dueAt);
  if (!owner || !/^\d{4}-\d{2}-\d{2}/.test(dueAt)) {
    throw new Error("exceptionOwner and exceptionDueAt are required for external dispatch compensation");
  }
  return { owner, dueAt };
}

function enqueuePublicHealthExternalDispatchToState(
  data = {},
  handoffId,
  input = {},
  credentials = {},
  dependencies = {}
) {
  const idempotencyKey = clean(input.idempotencyKey);
  if (!idempotencyKey) throw new Error("idempotencyKey is required for external dispatch");
  const existingDispatches = clone(rows(data, "publicHealthExternalDispatches"));
  const existing = existingDispatches.find((item) => (
    item.handoffId === clean(handoffId)
    && item.request?.idempotencyKeyHash === sha256(idempotencyKey)
  ));
  if (existing) {
    const requestedEvidence = Array.isArray(input.evidenceRefs)
      ? [...new Set(input.evidenceRefs.map(clean).filter(Boolean))].sort()
      : null;
    const requestConflict = (clean(input.operation) && clean(input.operation) !== existing.request.operation)
      || (requestedEvidence && JSON.stringify(requestedEvidence) !== JSON.stringify(existing.request.evidenceRefs))
      || (clean(input.exceptionOwner) && clean(input.exceptionOwner) !== existing.compensation?.owner)
      || (clean(input.exceptionDueAt || input.dueAt) && clean(input.exceptionDueAt || input.dueAt) !== existing.compensation?.dueAt);
    if (requestConflict) throw new Error("external dispatch idempotency key was reused with a different payload");
    const signingMaterial = requestSigningMaterial(credentials);
    const requestVerification = verifyPublicHealthExternalDispatch(existing, signingMaterial);
    if (!requestVerification.ok || !verifyRuntimeStateSignature(existing, signingMaterial)) {
      throw new Error(`persisted public health external dispatch rejected: ${requestVerification.ok ? "runtime-state-signature-invalid" : requestVerification.reason}`);
    }
    assertExternalAuditChain(data, existing, signingMaterial);
    return {
      ok: true,
      idempotent: true,
      dispatch: existing,
      nextData: {
        ...data,
        publicHealthExternalDispatches: existingDispatches,
        publicHealthExternalDispatchAudit: clone(rows(data, "publicHealthExternalDispatchAudit"))
      },
      externalRuntime: buildPublicHealthExternalAdapterRuntime(data),
      productionReady: false
    };
  }
  const coordination = buildPublicHealthCoordinationRuntime({ data, ...dependencies });
  const handoff = coordination.handoffs.find((item) => item.id === clean(handoffId));
  if (!handoff) throw new Error(`unknown public health coordination handoff: ${clean(handoffId) || "missing"}`);
  const resiliencePolicy = resiliencePolicyFor(credentials, handoff.laneId);
  if (resiliencePolicy) assertPublicHealthExternalBackpressure(data, handoff.laneId, resiliencePolicy);
  const compensation = requireCompensation(input);
  const signingMaterial = requestSigningMaterial(credentials);
  const dispatchAt = clean(input.at || new Date().toISOString());
  const createdDispatch = createPublicHealthExternalDispatch(handoff, input, credentials);
  const contractAuthorization = assertDispatchContractGovernance(
    createdDispatch,
    credentials.contractGovernance
  );
  const initialDispatch = withRuntimeStateSignature({
    ...createdDispatch,
    compensation,
    outboxVersion: 1,
    auditHead: ""
  }, signingMaterial, dispatchAt);
  const existingAudit = clone(rows(data, "publicHealthExternalDispatchAudit"));
  const appended = appendExternalAudit(existingAudit, initialDispatch, {
      id: `${initialDispatch.id}:audit:enqueued`,
      dispatchId: initialDispatch.id,
      handoffId: initialDispatch.handoffId,
      laneId: initialDispatch.laneId,
      action: "enqueue-external-dispatch",
      from: "not-enqueued",
      to: "pending",
      fromVersion: 0,
      toVersion: initialDispatch.outboxVersion,
      at: dispatchAt,
      idempotencyKeyHash: initialDispatch.request.idempotencyKeyHash
  }, signingMaterial);
  const dispatch = appended.dispatch;
  const nextData = {
    ...data,
    publicHealthExternalDispatches: [...existingDispatches, dispatch],
    publicHealthExternalDispatchAudit: appended.auditRows
  };
  return {
    ok: true,
    idempotent: false,
    contractAuthorization,
    dispatch: clone(dispatch),
    nextData,
    externalRuntime: buildPublicHealthExternalAdapterRuntime(nextData),
    productionReady: false
  };
}

function externalAttemptAudit(dispatch, updated, result, options) {
  const attempt = updated.attempts[updated.attempts.length - 1];
  const receiptReplayKeyHash = result.receipt?.nonce
    ? sha256(`${clean(result.receipt.signingKeyId || LEGACY_KEY_ID)}:${clean(result.receipt.nonce)}`)
    : "";
  return {
    id: `${dispatch.id}:audit:attempt:${attempt.attempt}`,
    dispatchId: dispatch.id,
    handoffId: dispatch.handoffId,
    laneId: dispatch.laneId,
    action: "record-external-delivery-attempt",
    from: dispatch.deliveryState,
    to: updated.deliveryState,
    fromVersion: dispatch.outboxVersion,
    toVersion: updated.outboxVersion,
    at: attempt.at,
    attempt: attempt.attempt,
    transportStatus: Number(result.transportStatus || 0),
    outcome: attempt.outcome,
    reason: attempt.reason,
    resultDigest: sha256(JSON.stringify(stableValue(result))),
    receiptReplayKeyHash,
    idempotencyKeyHash: sha256(options.attemptIdempotencyKey)
  };
}

function resilienceOutcomeForAttempt(updated, result) {
  const attempt = updated.attempts[updated.attempts.length - 1];
  const transportStatus = Number(result.transportStatus || 0);
  const infrastructureFailure = Boolean(clean(result.networkError))
    || transportStatus === 429
    || transportStatus >= 500
    || (transportStatus >= 200 && transportStatus < 300 && attempt.reason !== "verified-signed-receipt");
  return {
    type: infrastructureFailure ? "failure" : "success",
    reason: attempt.reason
  };
}

function verifyClaimedLease(dispatch, options) {
  const workerIdHash = sha256(clean(options.workerId));
  const leaseTokenHash = sha256(clean(options.leaseToken));
  const at = clean(options.at || new Date().toISOString());
  if (!clean(options.workerId) || !clean(options.leaseToken) || !dispatch.lease) {
    throw new Error("an active worker lease is required for claimed external delivery attempt");
  }
  if (!timingSafeHexEqual(dispatch.lease.workerIdHash, workerIdHash)
    || !timingSafeHexEqual(dispatch.lease.tokenHash, leaseTokenHash)) {
    throw new Error("external dispatch worker lease token is invalid");
  }
  if (timeValue(dispatch.lease.expiresAt, "lease expiresAt") <= timeValue(at, "attempt at")) {
    throw new Error("external dispatch worker lease has expired");
  }
}

function coordinationPayloadForTerminalDispatch(dispatch, handoff) {
  const base = {
    idempotencyKey: `external:${dispatch.id}:${dispatch.deliveryState}`,
    expectedVersion: handoff.version,
    at: dispatch.attempts[dispatch.attempts.length - 1].at
  };
  if (dispatch.receipt?.status === "accepted") {
    return {
      ...base,
      action: "record-coordination-receipt",
      receiptStatus: "accepted",
      receiptCode: dispatch.receipt.receiptCode,
      evidenceRefs: dispatch.receipt.evidenceRefs
    };
  }
  if (dispatch.receipt?.status === "rejected") {
    return {
      ...base,
      action: "record-coordination-receipt",
      receiptStatus: "rejected",
      receiptCode: dispatch.receipt.receiptCode,
      evidenceRefs: dispatch.receipt.evidenceRefs,
      reason: dispatch.receipt.reason,
      exceptionOwner: dispatch.receipt.exceptionOwner,
      dueAt: dispatch.receipt.dueAt
    };
  }
  return {
    ...base,
    action: "open-coordination-exception",
    reason: dispatch.blocker,
    exceptionOwner: dispatch.compensation.owner,
    dueAt: dispatch.compensation.dueAt,
    evidenceRefs: [dispatch.id]
  };
}

function recordPublicHealthExternalAttemptToState(
  data = {},
  dispatchId,
  result = {},
  options = {},
  dependencies = {}
) {
  const attemptIdempotencyKey = clean(options.attemptIdempotencyKey);
  if (!attemptIdempotencyKey) throw new Error("attemptIdempotencyKey is required for external delivery attempt");
  const dispatches = clone(rows(data, "publicHealthExternalDispatches"));
  const index = dispatches.findIndex((item) => item.id === clean(dispatchId));
  if (index < 0) throw new Error(`unknown public health external dispatch: ${clean(dispatchId) || "missing"}`);
  const current = dispatches[index];
  const signingMaterial = requestSigningMaterial(options);
  const verification = verifyPublicHealthExternalDispatch(current, signingMaterial);
  if (!verification.ok) throw new Error(`persisted public health external dispatch rejected: ${verification.reason}`);
  if (!verifyRuntimeStateSignature(current, signingMaterial)) {
    throw new Error("persisted public health external dispatch rejected: runtime-state-signature-invalid");
  }
  assertExternalAuditChain(data, current, signingMaterial);
  const resiliencePolicy = options.requireLease ? resiliencePolicyFor(options, current.laneId) : null;
  if (resiliencePolicy) {
    const laneControlVerification = verifyPublicHealthExternalLaneControlAuditChain(data, current.laneId, signingMaterial);
    if (!laneControlVerification.ok) {
      throw new Error(`public health external lane control rejected: ${laneControlVerification.reason}`);
    }
  }
  const idempotencyKeyHash = sha256(attemptIdempotencyKey);
  const auditRows = clone(rows(data, "publicHealthExternalDispatchAudit"));
  const duplicate = auditRows.find((item) => (
    item.dispatchId === current.id
    && item.action === "record-external-delivery-attempt"
    && item.idempotencyKeyHash === idempotencyKeyHash
  ));
  if (duplicate) {
    const resultDigest = sha256(JSON.stringify(stableValue(result)));
    if (duplicate.resultDigest && duplicate.resultDigest !== resultDigest) {
      throw new Error("external attempt idempotency key was reused with a different result");
    }
    return {
      ok: true,
      idempotent: true,
      dispatch: current,
      coordinationAction: null,
      nextData: {
        ...data,
        publicHealthExternalDispatches: dispatches,
        publicHealthExternalDispatchAudit: auditRows
      },
      externalRuntime: buildPublicHealthExternalAdapterRuntime(data),
      productionReady: false
    };
  }
  const receiptReplayKeyHash = result.receipt?.nonce
    ? sha256(`${clean(result.receipt.signingKeyId || LEGACY_KEY_ID)}:${clean(result.receipt.nonce)}`)
    : "";
  if (receiptReplayKeyHash && auditRows.some((item) => item.receiptReplayKeyHash === receiptReplayKeyHash)) {
    throw new Error("external callback receipt replay detected");
  }
  if (options.expectedVersion === undefined || Number(options.expectedVersion) !== Number(current.outboxVersion)) {
    throw new Error(`external dispatch version conflict: expected ${options.expectedVersion ?? "missing"}, current ${current.outboxVersion}`);
  }
  if (options.requireLease) {
    verifyClaimedLease(current, options);
  } else {
    const callbackVerification = result.receipt
      ? verifyPublicHealthExternalReceipt(
        current,
        result.receipt,
        receiptSigningMaterial(options),
        {
          at: clean(options.at || new Date().toISOString()),
          enforceFreshness: true,
          clockSkewSeconds: options.callbackClockSkewSeconds,
          maxAgeSeconds: options.callbackMaxAgeSeconds
        }
      )
      : { ok: false, reason: "receipt-missing" };
    if (!callbackVerification.ok) {
      throw new Error(`unclaimed external callback rejected: ${callbackVerification.reason}`);
    }
  }
  const attempted = recordPublicHealthExternalDeliveryAttempt(current, result, options);
  if (options.requireLease || ["delivered", "dead-letter"].includes(attempted.deliveryState)) attempted.lease = null;
  attempted.outboxVersion = Number(current.outboxVersion) + 1;
  const audit = externalAttemptAudit(current, attempted, result, options);
  const appended = appendExternalAudit(auditRows, attempted, audit, signingMaterial);
  const updated = appended.dispatch;
  dispatches[index] = updated;
  const nextData = {
    ...data,
    publicHealthExternalDispatches: dispatches,
    publicHealthExternalDispatchAudit: appended.auditRows
  };
  let finalData = nextData;
  let coordinationAction = null;
  if (["delivered", "dead-letter"].includes(updated.deliveryState)) {
    const coordination = buildPublicHealthCoordinationRuntime({ data: nextData, ...dependencies });
    const handoff = coordination.handoffs.find((item) => item.id === updated.handoffId);
    if (!handoff) throw new Error(`external dispatch handoff no longer exists: ${updated.handoffId}`);
    const coordinated = applyPublicHealthCoordinationActionToState(
      nextData,
      updated.handoffId,
      coordinationPayloadForTerminalDispatch(updated, handoff),
      { name: `${updated.adapterId} runtime`, role: "system" },
      dependencies
    );
    finalData = coordinated.nextData;
    coordinationAction = coordinated.action;
  }
  let laneControl = null;
  if (resiliencePolicy) {
    const laneOutcome = recordPublicHealthExternalLaneOutcomeToState(
      finalData,
      updated.laneId,
      resilienceOutcomeForAttempt(updated, result),
      {
        at: updated.attempts[updated.attempts.length - 1].at,
        expectedVersion: options.expectedLaneControlVersion
      },
      signingMaterial,
      resiliencePolicy
    );
    finalData = laneOutcome.nextData;
    laneControl = laneOutcome.control;
  }
  return {
    ok: true,
    idempotent: false,
    dispatch: clone(updated),
    laneControl,
    coordinationAction,
    nextData: finalData,
    externalRuntime: buildPublicHealthExternalAdapterRuntime(finalData),
    productionReady: false
  };
}

function recordClaimedPublicHealthExternalAttemptToState(
  data = {},
  dispatchId,
  result = {},
  options = {},
  dependencies = {}
) {
  return recordPublicHealthExternalAttemptToState(
    data,
    dispatchId,
    result,
    { ...options, requireLease: true },
    dependencies
  );
}

function remediationEvidence(input) {
  const evidenceRefs = Array.isArray(input.remediationEvidenceRefs)
    ? [...new Set(input.remediationEvidenceRefs.map(clean).filter(Boolean))].sort()
    : [];
  if (!evidenceRefs.length) throw new Error("remediationEvidenceRefs are required to requeue external dead letter");
  return evidenceRefs;
}

function deadLetterRetryPayload(dispatch, input) {
  return {
    action: "retry-coordination",
    idempotencyKey: `external:${dispatch.id}:requeue:${sha256(input.idempotencyKey)}`,
    expectedVersion: input.coordinationExpectedVersion,
    note: clean(input.note),
    at: clean(input.at || new Date().toISOString())
  };
}

function requeuePublicHealthExternalDeadLetterToState(
  data = {},
  dispatchId,
  input = {},
  credentials = {},
  user = {},
  dependencies = {}
) {
  const idempotencyKey = clean(input.idempotencyKey);
  const note = clean(input.note);
  if (!idempotencyKey || !note) throw new Error("idempotencyKey and note are required to requeue external dead letter");
  const evidenceRefs = remediationEvidence(input);
  const compensation = requireCompensation(input);
  const dispatches = clone(rows(data, "publicHealthExternalDispatches"));
  const index = dispatches.findIndex((item) => item.id === clean(dispatchId));
  if (index < 0) throw new Error(`unknown public health external dispatch: ${clean(dispatchId) || "missing"}`);
  const current = dispatches[index];
  const signingMaterial = requestSigningMaterial(credentials);
  const requestVerification = verifyPublicHealthExternalDispatch(current, signingMaterial);
  if (!requestVerification.ok || !verifyRuntimeStateSignature(current, signingMaterial)) {
    throw new Error(`persisted public health external dispatch rejected: ${requestVerification.ok ? "runtime-state-signature-invalid" : requestVerification.reason}`);
  }
  assertExternalAuditChain(data, current, signingMaterial);
  const idempotencyKeyHash = sha256(idempotencyKey);
  const noteDigest = sha256(note);
  if (current.recovery) {
    const conflict = current.recovery.idempotencyKeyHash !== idempotencyKeyHash
      || current.recovery.noteDigest !== noteDigest
      || JSON.stringify(current.recovery.remediationEvidenceRefs) !== JSON.stringify(evidenceRefs)
      || current.recovery.exceptionOwner !== compensation.owner
      || current.recovery.exceptionDueAt !== compensation.dueAt;
    if (conflict) throw new Error("external dead letter has already been requeued with a different recovery payload");
    const authorizedReplay = applyPublicHealthCoordinationActionToState(
      data,
      current.handoffId,
      deadLetterRetryPayload(current, input),
      user,
      dependencies
    );
    const successor = rows(authorizedReplay.nextData, "publicHealthExternalDispatches")
      .find((item) => item.id === current.recovery.successorDispatchId);
    if (!successor) throw new Error("external dead letter recovery successor is missing");
    const successorVerification = verifyPublicHealthExternalDispatch(successor, signingMaterial);
    if (!successorVerification.ok || !verifyRuntimeStateSignature(successor, signingMaterial)) {
      throw new Error("external dead letter recovery successor signature is invalid");
    }
    assertExternalAuditChain(authorizedReplay.nextData, successor, signingMaterial);
    if (successor.predecessorDispatchId !== current.id
      || JSON.stringify(successor.remediationEvidenceRefs) !== JSON.stringify(evidenceRefs)) {
      throw new Error("external dead letter recovery successor relationship is invalid");
    }
    return {
      ok: true,
      idempotent: true,
      originalDispatch: current,
      successorDispatch: successor,
      coordinationAction: authorizedReplay.action,
      nextData: authorizedReplay.nextData,
      externalRuntime: buildPublicHealthExternalAdapterRuntime(authorizedReplay.nextData),
      productionReady: false
    };
  }
  if (current.deliveryState !== "dead-letter") throw new Error("only a dead-letter external dispatch can be requeued");
  if (current.lease) throw new Error("dead-letter external dispatch cannot be requeued while leased");
  const coordinated = applyPublicHealthCoordinationActionToState(
    data,
    current.handoffId,
    deadLetterRetryPayload(current, input),
    user,
    dependencies
  );
  if (input.expectedVersion === undefined || Number(input.expectedVersion) !== Number(current.outboxVersion)) {
    throw new Error(`external dispatch version conflict: expected ${input.expectedVersion ?? "missing"}, current ${current.outboxVersion}`);
  }
  const successorEnqueue = enqueuePublicHealthExternalDispatchToState(
    coordinated.nextData,
    current.handoffId,
    {
      idempotencyKey: `dead-letter-requeue:${current.id}:${idempotencyKey}`,
      operation: current.request.operation,
      evidenceRefs,
      exceptionOwner: compensation.owner,
      exceptionDueAt: compensation.dueAt,
      at: clean(input.at || new Date().toISOString())
    },
    credentials,
    dependencies
  );
  const nextDispatches = clone(rows(successorEnqueue.nextData, "publicHealthExternalDispatches"));
  const originalIndex = nextDispatches.findIndex((item) => item.id === current.id);
  const successorIndex = nextDispatches.findIndex((item) => item.id === successorEnqueue.dispatch.id);
  if (originalIndex < 0 || successorIndex < 0) throw new Error("external dead letter recovery persistence relationship is incomplete");
  const recovery = {
    state: "requeued",
    idempotencyKeyHash,
    noteDigest,
    remediationEvidenceRefs: evidenceRefs,
    exceptionOwner: compensation.owner,
    exceptionDueAt: compensation.dueAt,
    successorDispatchId: successorEnqueue.dispatch.id,
    approvedByRole: coordinated.action.role,
    approvedByHash: sha256(coordinated.action.actor),
    requeuedAt: coordinated.action.at
  };
  const originalBase = {
    ...nextDispatches[originalIndex],
    recovery,
    outboxVersion: Number(current.outboxVersion) + 1
  };
  const successor = withRuntimeStateSignature({
    ...nextDispatches[successorIndex],
    predecessorDispatchId: current.id,
    remediationEvidenceRefs: evidenceRefs
  }, signingMaterial, recovery.requeuedAt);
  const recoveryAudit = {
    id: `${current.id}:audit:requeue:${idempotencyKeyHash.slice(0, 16)}`,
    dispatchId: current.id,
    successorDispatchId: successor.id,
    handoffId: current.handoffId,
    laneId: current.laneId,
    action: "requeue-external-dead-letter",
    from: "dead-letter",
    to: "dead-letter-requeued",
    fromVersion: current.outboxVersion,
    toVersion: originalBase.outboxVersion,
    at: recovery.requeuedAt,
    approvedByRole: recovery.approvedByRole,
    approvedByHash: recovery.approvedByHash,
    remediationEvidenceRefs: evidenceRefs,
    idempotencyKeyHash
  };
  const recoveryAppend = appendExternalAudit(
    clone(rows(successorEnqueue.nextData, "publicHealthExternalDispatchAudit")),
    originalBase,
    recoveryAudit,
    signingMaterial
  );
  const original = recoveryAppend.dispatch;
  nextDispatches[originalIndex] = original;
  nextDispatches[successorIndex] = successor;
  const nextData = {
    ...successorEnqueue.nextData,
    publicHealthExternalDispatches: nextDispatches,
    publicHealthExternalDispatchAudit: recoveryAppend.auditRows
  };
  return {
    ok: true,
    idempotent: false,
    originalDispatch: clone(original),
    successorDispatch: clone(successor),
    coordinationAction: coordinated.action,
    nextData,
    externalRuntime: buildPublicHealthExternalAdapterRuntime(nextData),
    productionReady: false
  };
}

module.exports = {
  buildPublicHealthExternalAdapterRuntime,
  claimPublicHealthExternalDispatchToState,
  enqueuePublicHealthExternalDispatchToState,
  listDuePublicHealthExternalDispatches,
  recordClaimedPublicHealthExternalAttemptToState,
  recordPublicHealthExternalAttemptToState,
  requeuePublicHealthExternalDeadLetterToState,
  runtimeStatePayload,
  verifyPublicHealthExternalAuditChain,
  verifyRuntimeStateSignature
};
