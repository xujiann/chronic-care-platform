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
  return {
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
    productionReady: false
  };
}

function signRuntimeState(dispatch, requestSecret) {
  if (clean(requestSecret).length < 32) throw new Error("external runtime signing secret must contain at least 32 characters");
  return crypto.createHmac("sha256", requestSecret)
    .update(JSON.stringify(stableValue(runtimeStatePayload(dispatch))))
    .digest("hex");
}

function withRuntimeStateSignature(dispatch, requestSecret) {
  return {
    ...dispatch,
    runtimeStateSignatureAlgorithm: "HMAC-SHA256",
    runtimeStateSignature: signRuntimeState(dispatch, requestSecret)
  };
}

function verifyRuntimeStateSignature(dispatch, requestSecret) {
  let expected;
  try {
    expected = signRuntimeState(dispatch, requestSecret);
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
      auditEntries: audit.length
    },
    productionReady: false,
    blockers: [
      "T00 must persist the returned immutable state through the shared writer.",
      "Production endpoints, secrets, signed receipts and trusted site evidence remain required."
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

function leaseTokenFor(dispatchId, lease, requestSecret) {
  return crypto.createHmac("sha256", requestSecret)
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
  const requestVerification = verifyPublicHealthExternalDispatch(current, credentials.requestSecret);
  if (!requestVerification.ok || !verifyRuntimeStateSignature(current, credentials.requestSecret)) {
    throw new Error(`persisted public health external dispatch rejected: ${requestVerification.ok ? "runtime-state-signature-invalid" : requestVerification.reason}`);
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
      ? leaseTokenFor(current.id, current.lease, credentials.requestSecret)
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
  if (input.expectedVersion === undefined || Number(input.expectedVersion) !== Number(current.outboxVersion)) {
    throw new Error(`external dispatch version conflict: expected ${input.expectedVersion ?? "missing"}, current ${current.outboxVersion}`);
  }
  if (isLeaseActive(current, now)) throw new Error("external dispatch is already claimed by an active worker lease");
  if (!isDispatchDue(current, now)) throw new Error("external dispatch is not due for delivery");
  const expiresAt = new Date(nowValue + leaseSeconds * 1000).toISOString();
  const lease = { workerIdHash, idempotencyKeyHash, claimedAt: new Date(nowValue).toISOString(), expiresAt };
  const leaseToken = leaseTokenFor(current.id, lease, credentials.requestSecret);
  lease.tokenHash = sha256(leaseToken);
  const updated = withRuntimeStateSignature({
    ...current,
    lease,
    outboxVersion: Number(current.outboxVersion) + 1
  }, credentials.requestSecret);
  dispatches[index] = updated;
  const audit = {
    id: `${current.id}:audit:lease:${idempotencyKeyHash.slice(0, 16)}`,
    dispatchId: current.id,
    handoffId: current.handoffId,
    laneId: current.laneId,
    action: "claim-external-dispatch",
    from: current.deliveryState,
    to: current.deliveryState,
    fromVersion: current.outboxVersion,
    toVersion: updated.outboxVersion,
    at: lease.claimedAt,
    leaseExpiresAt: expiresAt,
    workerIdHash,
    idempotencyKeyHash,
    reclaimedExpiredLease: Boolean(current.lease)
  };
  const nextData = {
    ...data,
    publicHealthExternalDispatches: dispatches,
    publicHealthExternalDispatchAudit: [...auditRows, audit]
  };
  return {
    ok: true,
    idempotent: false,
    leaseToken,
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
    const requestVerification = verifyPublicHealthExternalDispatch(existing, credentials.requestSecret);
    if (!requestVerification.ok || !verifyRuntimeStateSignature(existing, credentials.requestSecret)) {
      throw new Error(`persisted public health external dispatch rejected: ${requestVerification.ok ? "runtime-state-signature-invalid" : requestVerification.reason}`);
    }
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
  const compensation = requireCompensation(input);
  const dispatch = withRuntimeStateSignature({
    ...createPublicHealthExternalDispatch(handoff, input, credentials),
    compensation,
    outboxVersion: 1
  }, credentials.requestSecret);
  const audit = [
    ...clone(rows(data, "publicHealthExternalDispatchAudit")),
    {
      id: `${dispatch.id}:audit:enqueued`,
      dispatchId: dispatch.id,
      handoffId: dispatch.handoffId,
      laneId: dispatch.laneId,
      action: "enqueue-external-dispatch",
      from: "not-enqueued",
      to: "pending",
      fromVersion: 0,
      toVersion: dispatch.outboxVersion,
      at: clean(input.at || new Date().toISOString()),
      idempotencyKeyHash: dispatch.request.idempotencyKeyHash
    }
  ];
  const nextData = {
    ...data,
    publicHealthExternalDispatches: [...existingDispatches, dispatch],
    publicHealthExternalDispatchAudit: audit
  };
  return {
    ok: true,
    idempotent: false,
    dispatch: clone(dispatch),
    nextData,
    externalRuntime: buildPublicHealthExternalAdapterRuntime(nextData),
    productionReady: false
  };
}

function externalAttemptAudit(dispatch, updated, result, options) {
  const attempt = updated.attempts[updated.attempts.length - 1];
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
    idempotencyKeyHash: sha256(options.attemptIdempotencyKey)
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
  const verification = verifyPublicHealthExternalDispatch(current, options.requestSecret);
  if (!verification.ok) throw new Error(`persisted public health external dispatch rejected: ${verification.reason}`);
  if (!verifyRuntimeStateSignature(current, options.requestSecret)) {
    throw new Error("persisted public health external dispatch rejected: runtime-state-signature-invalid");
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
  if (options.expectedVersion === undefined || Number(options.expectedVersion) !== Number(current.outboxVersion)) {
    throw new Error(`external dispatch version conflict: expected ${options.expectedVersion ?? "missing"}, current ${current.outboxVersion}`);
  }
  if (options.requireLease) {
    verifyClaimedLease(current, options);
  } else {
    const callbackVerification = result.receipt
      ? verifyPublicHealthExternalReceipt(current, result.receipt, options.receiptSecret)
      : { ok: false, reason: "receipt-missing" };
    if (!callbackVerification.ok) {
      throw new Error(`unclaimed external callback rejected: ${callbackVerification.reason}`);
    }
  }
  const attempted = recordPublicHealthExternalDeliveryAttempt(current, result, options);
  if (options.requireLease || ["delivered", "dead-letter"].includes(attempted.deliveryState)) attempted.lease = null;
  attempted.outboxVersion = Number(current.outboxVersion) + 1;
  const updated = withRuntimeStateSignature(
    attempted,
    options.requestSecret
  );
  dispatches[index] = updated;
  const nextData = {
    ...data,
    publicHealthExternalDispatches: dispatches,
    publicHealthExternalDispatchAudit: [...auditRows, externalAttemptAudit(current, updated, result, options)]
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
  return {
    ok: true,
    idempotent: false,
    dispatch: clone(updated),
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
  const requestVerification = verifyPublicHealthExternalDispatch(current, credentials.requestSecret);
  if (!requestVerification.ok || !verifyRuntimeStateSignature(current, credentials.requestSecret)) {
    throw new Error(`persisted public health external dispatch rejected: ${requestVerification.ok ? "runtime-state-signature-invalid" : requestVerification.reason}`);
  }
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
    const successorVerification = verifyPublicHealthExternalDispatch(successor, credentials.requestSecret);
    if (!successorVerification.ok || !verifyRuntimeStateSignature(successor, credentials.requestSecret)) {
      throw new Error("external dead letter recovery successor signature is invalid");
    }
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
  const original = withRuntimeStateSignature({
    ...nextDispatches[originalIndex],
    recovery,
    outboxVersion: Number(current.outboxVersion) + 1
  }, credentials.requestSecret);
  const successor = withRuntimeStateSignature({
    ...nextDispatches[successorIndex],
    predecessorDispatchId: current.id,
    remediationEvidenceRefs: evidenceRefs
  }, credentials.requestSecret);
  nextDispatches[originalIndex] = original;
  nextDispatches[successorIndex] = successor;
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
    toVersion: original.outboxVersion,
    at: recovery.requeuedAt,
    approvedByRole: recovery.approvedByRole,
    approvedByHash: recovery.approvedByHash,
    remediationEvidenceRefs: evidenceRefs,
    idempotencyKeyHash
  };
  const nextData = {
    ...successorEnqueue.nextData,
    publicHealthExternalDispatches: nextDispatches,
    publicHealthExternalDispatchAudit: [
      ...clone(rows(successorEnqueue.nextData, "publicHealthExternalDispatchAudit")),
      recoveryAudit
    ]
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
  verifyRuntimeStateSignature
};
