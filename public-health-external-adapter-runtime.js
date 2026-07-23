const crypto = require("node:crypto");
const {
  applyPublicHealthCoordinationActionToState,
  buildPublicHealthCoordinationRuntime
} = require("./public-health-coordination-runtime");
const {
  createPublicHealthExternalDispatch,
  recordPublicHealthExternalDeliveryAttempt,
  verifyPublicHealthExternalDispatch
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
    deliveryState: dispatch.deliveryState,
    attempts: dispatch.attempts,
    maxAttempts: dispatch.maxAttempts,
    nextRetryAt: dispatch.nextRetryAt,
    receipt: dispatch.receipt,
    blocker: dispatch.blocker,
    compensation: dispatch.compensation,
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
      delivered: dispatches.filter((item) => item.deliveryState === "delivered").length,
      deadLetter: dispatches.filter((item) => item.deliveryState === "dead-letter").length,
      auditEntries: audit.length
    },
    productionReady: false,
    blockers: [
      "T00 must persist the returned immutable state through the shared writer.",
      "Production endpoints, secrets, signed receipts and trusted site evidence remain required."
    ]
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
    compensation
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
    at: attempt.at,
    attempt: attempt.attempt,
    transportStatus: Number(result.transportStatus || 0),
    outcome: attempt.outcome,
    reason: attempt.reason,
    idempotencyKeyHash: sha256(options.attemptIdempotencyKey)
  };
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
  const duplicate = auditRows.find((item) => item.dispatchId === current.id && item.idempotencyKeyHash === idempotencyKeyHash);
  if (duplicate) {
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
  const updated = withRuntimeStateSignature(
    recordPublicHealthExternalDeliveryAttempt(current, result, options),
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

module.exports = {
  buildPublicHealthExternalAdapterRuntime,
  enqueuePublicHealthExternalDispatchToState,
  recordPublicHealthExternalAttemptToState,
  runtimeStatePayload,
  verifyRuntimeStateSignature
};
