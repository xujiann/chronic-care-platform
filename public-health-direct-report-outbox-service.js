"use strict";

const { createHash, randomUUID } = require("node:crypto");
const {
  DIRECT_REPORT_CONTRACT_ID,
  createKeyedReference,
  stableStringify,
  validateDirectReportPayload
} = require("./public-health-connectors");

const DELIVERY_STATES = Object.freeze([
  "queued",
  "leased",
  "retry-scheduled",
  "awaiting-callback",
  "callback-accepted",
  "callback-rejected",
  "dead-letter"
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function clean(value, maximum = 240) {
  return String(value ?? "").trim().replace(/[\r\n\t]+/g, " ").slice(0, maximum);
}

function sha256(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

function deliveryError(code, message, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}

function isoTime(value, label = "time") {
  const parsed = Date.parse(clean(value, 80));
  if (!Number.isFinite(parsed)) {
    throw deliveryError("PUBLIC_HEALTH_DIRECT_REPORT_DELIVERY_TIME_INVALID", `${label} must be a valid date-time`);
  }
  return new Date(parsed).toISOString();
}

function stateFor(data = {}) {
  const nextData = clone(data);
  nextData.publicHealthInfectiousReportingDeliveries = Array.isArray(
    nextData.publicHealthInfectiousReportingDeliveries
  )
    ? nextData.publicHealthInfectiousReportingDeliveries
    : [];
  return nextData;
}

function workflowBinding(workflow = {}) {
  return {
    caseId: clean(workflow.id, 160),
    externalEventId: clean(workflow.externalEventId, 160),
    reportId: clean(workflow.reportId, 160),
    reportCardNo: clean(workflow.reportCard?.reportCardNo, 160),
    diagnosisCode: clean(workflow.reportCard?.diagnosisCode || workflow.event?.diagnosisCode, 80),
    sourceInstitutionCode: clean(workflow.reportCard?.sourceInstitutionCode, 120),
    testCode: clean(workflow.reportCard?.testCode, 120),
    resultFlag: clean(workflow.reportCard?.resultFlag, 40).toLowerCase(),
    occurredAt: clean(workflow.reportCard?.occurredAt || workflow.event?.observedAt, 80),
    reportedAt: clean(workflow.reportCard?.reportedAt, 80)
  };
}

function assertSubmittableWorkflow(workflow = {}) {
  if (clean(workflow.state) !== "submitted") {
    throw deliveryError(
      "PUBLIC_HEALTH_DIRECT_REPORT_DELIVERY_STATE_INVALID",
      "direct-report delivery requires a submitted reporting case",
      409
    );
  }
  const binding = workflowBinding(workflow);
  if (!binding.caseId || !binding.externalEventId || !binding.reportId || !binding.reportCardNo) {
    throw deliveryError(
      "PUBLIC_HEALTH_DIRECT_REPORT_DELIVERY_BINDING_INVALID",
      "direct-report delivery requires a bound case, event, report and report card",
      422
    );
  }
  const submissionKey = clean(workflow.reportCard?.submissionIdempotencyKey, 200);
  if (!submissionKey) {
    throw deliveryError(
      "PUBLIC_HEALTH_DIRECT_REPORT_DELIVERY_IDEMPOTENCY_REQUIRED",
      "submitted report is missing its delivery idempotency binding",
      422
    );
  }
  return { binding, submissionKey };
}

function enqueueDirectReportDeliveryToState(data = {}, workflow = {}, input = {}) {
  const nextData = stateFor(data);
  const { binding, submissionKey } = assertSubmittableWorkflow(workflow);
  const at = isoTime(input.at || workflow.reportCard?.submittedAt || new Date().toISOString(), "delivery queuedAt");
  const maxAttempts = Number(input.maxAttempts || 3);
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
    throw deliveryError(
      "PUBLIC_HEALTH_DIRECT_REPORT_DELIVERY_ATTEMPTS_INVALID",
      "direct-report delivery maxAttempts must be an integer from 1 to 10"
    );
  }
  const submissionKeyDigest = sha256(submissionKey);
  const bindingDigest = sha256(stableStringify(binding));
  const id = `phdr-delivery-${sha256(`${binding.caseId}:${submissionKeyDigest}`).slice(0, 24)}`;
  const existing = nextData.publicHealthInfectiousReportingDeliveries.find((item) => item.id === id);
  if (existing) {
    if (
      existing.bindingDigest !== bindingDigest
      || existing.submissionKeyDigest !== submissionKeyDigest
      || existing.caseId !== binding.caseId
    ) {
      throw deliveryError(
        "PUBLIC_HEALTH_DIRECT_REPORT_DELIVERY_IDEMPOTENCY_CONFLICT",
        "direct-report delivery idempotency binding has drifted",
        409
      );
    }
    return {
      nextData,
      delivery: clone(existing),
      idempotent: true
    };
  }
  const delivery = {
    id,
    contractId: DIRECT_REPORT_CONTRACT_ID,
    caseId: binding.caseId,
    externalEventId: binding.externalEventId,
    reportId: binding.reportId,
    caseVersion: Number(workflow.version || 0),
    submissionKeyDigest,
    bindingDigest,
    state: "queued",
    version: 1,
    attemptCount: 0,
    lifetimeAttemptCount: 0,
    maxAttempts,
    nextAttemptAt: at,
    lease: null,
    providerReceipt: null,
    trustedCallback: null,
    lastFailure: null,
    replayCount: 0,
    lastReplayKeyDigest: null,
    createdAt: at,
    updatedAt: at,
    payloadPersisted: false,
    subjectDataPersisted: false,
    credentialsPersisted: false,
    productionReady: false
  };
  nextData.publicHealthInfectiousReportingDeliveries.push(delivery);
  return {
    nextData,
    delivery: clone(delivery),
    idempotent: false
  };
}

function findDelivery(data, deliveryId) {
  const deliveries = Array.isArray(data?.publicHealthInfectiousReportingDeliveries)
    ? data.publicHealthInfectiousReportingDeliveries
    : [];
  const index = deliveries.findIndex((item) => item.id === clean(deliveryId, 160));
  if (index < 0) {
    throw deliveryError(
      "PUBLIC_HEALTH_DIRECT_REPORT_DELIVERY_NOT_FOUND",
      "direct-report delivery was not found",
      404
    );
  }
  return { deliveries, index, delivery: deliveries[index] };
}

function leaseActive(delivery, now) {
  return delivery?.lease
    && Number.isFinite(Date.parse(delivery.lease.expiresAt))
    && Date.parse(delivery.lease.expiresAt) > Date.parse(now);
}

function claimDirectReportDeliveryToState(data = {}, deliveryId, input = {}, options = {}) {
  const nextData = stateFor(data);
  const { index, delivery } = findDelivery(nextData, deliveryId);
  const now = isoTime(input.now || new Date().toISOString(), "delivery claim time");
  const expectedVersion = Number(input.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion !== Number(delivery.version)) {
    throw deliveryError(
      "PUBLIC_HEALTH_DIRECT_REPORT_DELIVERY_VERSION_CONFLICT",
      `direct-report delivery version conflict: expected ${expectedVersion}, current ${delivery.version}`,
      409
    );
  }
  if (leaseActive(delivery, now)) {
    throw deliveryError(
      "PUBLIC_HEALTH_DIRECT_REPORT_DELIVERY_ALREADY_LEASED",
      "direct-report delivery already has an active worker lease",
      409
    );
  }
  if (!["queued", "retry-scheduled", "leased"].includes(delivery.state)) {
    throw deliveryError(
      "PUBLIC_HEALTH_DIRECT_REPORT_DELIVERY_NOT_CLAIMABLE",
      `direct-report delivery cannot be claimed from ${delivery.state}`,
      409
    );
  }
  if (
    delivery.state === "retry-scheduled"
    && Number.isFinite(Date.parse(delivery.nextAttemptAt))
    && Date.parse(delivery.nextAttemptAt) > Date.parse(now)
  ) {
    throw deliveryError(
      "PUBLIC_HEALTH_DIRECT_REPORT_DELIVERY_NOT_DUE",
      "direct-report delivery retry is not due",
      409
    );
  }
  const workerId = clean(input.workerId, 120);
  if (!workerId) {
    throw deliveryError(
      "PUBLIC_HEALTH_DIRECT_REPORT_DELIVERY_WORKER_REQUIRED",
      "direct-report delivery workerId is required"
    );
  }
  const leaseSeconds = Number(input.leaseSeconds || 60);
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 15 || leaseSeconds > 600) {
    throw deliveryError(
      "PUBLIC_HEALTH_DIRECT_REPORT_DELIVERY_LEASE_INVALID",
      "direct-report delivery leaseSeconds must be an integer from 15 to 600"
    );
  }
  const tokenFactory = options.randomUUID || randomUUID;
  const leaseToken = clean(tokenFactory(), 200);
  if (!leaseToken) throw deliveryError(
    "PUBLIC_HEALTH_DIRECT_REPORT_DELIVERY_LEASE_INVALID",
    "direct-report delivery lease token is unavailable",
    503
  );
  const claimed = {
    ...delivery,
    state: "leased",
    version: Number(delivery.version) + 1,
    lease: {
      tokenDigest: sha256(leaseToken),
      workerIdDigest: sha256(workerId),
      claimedAt: now,
      expiresAt: new Date(Date.parse(now) + leaseSeconds * 1000).toISOString()
    },
    updatedAt: now
  };
  nextData.publicHealthInfectiousReportingDeliveries[index] = claimed;
  return {
    nextData,
    delivery: clone(claimed),
    leaseToken
  };
}

function normalizedFailureCode(value) {
  const result = clean(value || "DIRECT_REPORT_DELIVERY_FAILED", 120).toUpperCase();
  return /^[A-Z0-9_:-]+$/.test(result) ? result : "DIRECT_REPORT_DELIVERY_FAILED";
}

function assertClaim(delivery, input, now) {
  if (delivery.state !== "leased" || !delivery.lease) {
    throw deliveryError(
      "PUBLIC_HEALTH_DIRECT_REPORT_DELIVERY_LEASE_REQUIRED",
      "direct-report delivery outcome requires an active lease",
      409
    );
  }
  if (delivery.lease.tokenDigest !== sha256(clean(input.leaseToken, 200))) {
    throw deliveryError(
      "PUBLIC_HEALTH_DIRECT_REPORT_DELIVERY_LEASE_MISMATCH",
      "direct-report delivery lease token does not match",
      409
    );
  }
  if (!leaseActive(delivery, now)) {
    throw deliveryError(
      "PUBLIC_HEALTH_DIRECT_REPORT_DELIVERY_LEASE_EXPIRED",
      "direct-report delivery lease has expired",
      409
    );
  }
}

function recordDirectReportDeliveryOutcomeToState(data = {}, deliveryId, outcome = {}, input = {}) {
  const nextData = stateFor(data);
  const { index, delivery } = findDelivery(nextData, deliveryId);
  const now = isoTime(input.now || new Date().toISOString(), "delivery outcome time");
  const expectedVersion = Number(input.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion !== Number(delivery.version)) {
    throw deliveryError(
      "PUBLIC_HEALTH_DIRECT_REPORT_DELIVERY_VERSION_CONFLICT",
      `direct-report delivery version conflict: expected ${expectedVersion}, current ${delivery.version}`,
      409
    );
  }
  assertClaim(delivery, input, now);
  const attemptCount = Number(delivery.attemptCount || 0) + 1;
  let updated;
  if (outcome.accepted === true) {
    const receiptId = clean(outcome.receiptId, 200);
    const requestId = clean(outcome.requestId, 160);
    if (!receiptId || !requestId) {
      throw deliveryError(
        "PUBLIC_HEALTH_DIRECT_REPORT_DELIVERY_RECEIPT_INVALID",
        "accepted direct-report delivery requires receiptId and requestId",
        422
      );
    }
    updated = {
      ...delivery,
      state: "awaiting-callback",
      version: Number(delivery.version) + 1,
      attemptCount,
      lifetimeAttemptCount: Number(delivery.lifetimeAttemptCount || 0),
      nextAttemptAt: null,
      lease: null,
      providerReceipt: {
        receiptId,
        requestId,
        providerStatus: clean(outcome.providerStatus || "accepted", 40).toLowerCase(),
        acceptedAt: isoTime(outcome.acceptedAt || now, "provider acceptedAt"),
        transportAttempts: Number(outcome.transportAttempts || 1)
      },
      lastFailure: null,
      updatedAt: now
    };
  } else {
    const retryable = outcome.retryable === true;
    const retryScheduled = retryable && attemptCount < Number(delivery.maxAttempts);
    const retryDelaySeconds = Math.min(3600, 30 * (2 ** Math.max(0, attemptCount - 1)));
    updated = {
      ...delivery,
      state: retryScheduled ? "retry-scheduled" : "dead-letter",
      version: Number(delivery.version) + 1,
      attemptCount,
      lifetimeAttemptCount: Number(delivery.lifetimeAttemptCount || 0),
      nextAttemptAt: retryScheduled
        ? new Date(Date.parse(now) + retryDelaySeconds * 1000).toISOString()
        : null,
      lease: null,
      lastFailure: {
        code: normalizedFailureCode(outcome.code),
        at: now,
        retryable
      },
      updatedAt: now
    };
  }
  nextData.publicHealthInfectiousReportingDeliveries[index] = updated;
  return { nextData, delivery: clone(updated) };
}

function recordTrustedDirectReportCallbackToState(data = {}, input = {}) {
  const nextData = stateFor(data);
  const caseId = clean(input.caseId, 160);
  const receiptId = clean(input.receiptId, 200);
  const status = clean(input.status, 40).toLowerCase();
  if (!caseId || !receiptId || !["accepted", "rejected"].includes(status)) {
    throw deliveryError(
      "PUBLIC_HEALTH_DIRECT_REPORT_DELIVERY_CALLBACK_INVALID",
      "trusted delivery callback requires caseId, receiptId and accepted or rejected status",
      422
    );
  }
  const candidates = nextData.publicHealthInfectiousReportingDeliveries
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.caseId === caseId && item.providerReceipt?.receiptId === receiptId)
    .sort((left, right) => Number(right.item.version) - Number(left.item.version));
  if (!candidates.length) return { nextData, delivery: null, matched: false, idempotent: false };
  const { item: delivery, index } = candidates[0];
  const nextState = status === "accepted" ? "callback-accepted" : "callback-rejected";
  if (["callback-accepted", "callback-rejected"].includes(delivery.state)) {
    if (delivery.state !== nextState || delivery.trustedCallback?.receiptId !== receiptId) {
      throw deliveryError(
        "PUBLIC_HEALTH_DIRECT_REPORT_DELIVERY_CALLBACK_CONFLICT",
        "trusted direct-report callback conflicts with the recorded delivery result",
        409
      );
    }
    return { nextData, delivery: clone(delivery), matched: true, idempotent: true };
  }
  if (delivery.state !== "awaiting-callback") {
    throw deliveryError(
      "PUBLIC_HEALTH_DIRECT_REPORT_DELIVERY_CALLBACK_STATE_INVALID",
      `trusted direct-report callback cannot bind to delivery state ${delivery.state}`,
      409
    );
  }
  const at = isoTime(input.at || new Date().toISOString(), "trusted callback time");
  const updated = {
    ...delivery,
    state: nextState,
    version: Number(delivery.version) + 1,
    trustedCallback: {
      receiptId,
      status,
      signatureVerified: true,
      at
    },
    updatedAt: at
  };
  nextData.publicHealthInfectiousReportingDeliveries[index] = updated;
  return { nextData, delivery: clone(updated), matched: true, idempotent: false };
}

function requeueDirectReportDeadLetterToState(data = {}, deliveryId, input = {}) {
  const nextData = stateFor(data);
  const { index, delivery } = findDelivery(nextData, deliveryId);
  const idempotencyKey = clean(input.idempotencyKey, 200);
  if (!idempotencyKey) throw deliveryError(
    "PUBLIC_HEALTH_DIRECT_REPORT_DELIVERY_IDEMPOTENCY_REQUIRED",
    "dead-letter replay requires idempotencyKey"
  );
  const replayKeyDigest = sha256(idempotencyKey);
  if (delivery.lastReplayKeyDigest === replayKeyDigest) {
    return { nextData, delivery: clone(delivery), idempotent: true };
  }
  const expectedVersion = Number(input.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion !== Number(delivery.version)) {
    throw deliveryError(
      "PUBLIC_HEALTH_DIRECT_REPORT_DELIVERY_VERSION_CONFLICT",
      `direct-report delivery version conflict: expected ${expectedVersion}, current ${delivery.version}`,
      409
    );
  }
  if (delivery.state !== "dead-letter") {
    throw deliveryError(
      "PUBLIC_HEALTH_DIRECT_REPORT_DELIVERY_NOT_DEAD_LETTER",
      "only a dead-letter direct-report delivery can be replayed",
      409
    );
  }
  const workflow = (Array.isArray(nextData.publicHealthInfectiousReportingCases)
    ? nextData.publicHealthInfectiousReportingCases
    : []).find((item) => item.id === delivery.caseId);
  if (!workflow || workflow.state !== "submitted") {
    throw deliveryError(
      "PUBLIC_HEALTH_DIRECT_REPORT_DELIVERY_CASE_STATE_INVALID",
      "dead-letter replay requires the bound reporting case to remain submitted",
      409
    );
  }
  const at = isoTime(input.at || new Date().toISOString(), "dead-letter replay time");
  const updated = {
    ...delivery,
    state: "queued",
    version: Number(delivery.version) + 1,
    nextAttemptAt: at,
    lease: null,
    lastFailure: null,
    lifetimeAttemptCount: Number(delivery.lifetimeAttemptCount || 0) + Number(delivery.attemptCount || 0),
    attemptCount: 0,
    replayCount: Number(delivery.replayCount || 0) + 1,
    lastReplayKeyDigest: replayKeyDigest,
    updatedAt: at
  };
  nextData.publicHealthInfectiousReportingDeliveries[index] = updated;
  return { nextData, delivery: clone(updated), idempotent: false };
}

function listDueDirectReportDeliveries(data = {}, options = {}) {
  const now = isoTime(options.now || new Date().toISOString(), "delivery listing time");
  const limit = Math.min(100, Math.max(1, Number(options.limit || 20)));
  return (Array.isArray(data.publicHealthInfectiousReportingDeliveries)
    ? data.publicHealthInfectiousReportingDeliveries
    : [])
    .filter((item) => (
      item.state === "queued"
      || (
        item.state === "retry-scheduled"
        && Number.isFinite(Date.parse(item.nextAttemptAt))
        && Date.parse(item.nextAttemptAt) <= Date.parse(now)
      )
      || (item.state === "leased" && !leaseActive(item, now))
    ))
    .sort((left, right) => clean(left.nextAttemptAt || left.createdAt, 80)
      .localeCompare(clean(right.nextAttemptAt || right.createdAt, 80)))
    .slice(0, limit)
    .map(clone);
}

function projectDirectReportDelivery(delivery, options = {}) {
  if (!delivery) return null;
  const now = clean(options.now || new Date().toISOString(), 80);
  return {
    id: clean(delivery.id, 160),
    contractId: clean(delivery.contractId, 120),
    caseId: clean(delivery.caseId, 160),
    externalEventId: clean(delivery.externalEventId, 160),
    reportId: clean(delivery.reportId, 160),
    state: DELIVERY_STATES.includes(delivery.state) ? delivery.state : "unknown",
    version: Number(delivery.version || 0),
    attemptCount: Number(delivery.attemptCount || 0),
    lifetimeAttemptCount: Number(delivery.lifetimeAttemptCount || 0),
    maxAttempts: Number(delivery.maxAttempts || 0),
    nextAttemptAt: clean(delivery.nextAttemptAt, 80) || null,
    leaseActive: Boolean(leaseActive(delivery, now)),
    providerReceipt: delivery.providerReceipt ? {
      receiptId: clean(delivery.providerReceipt.receiptId, 200),
      providerStatus: clean(delivery.providerReceipt.providerStatus, 40),
      acceptedAt: clean(delivery.providerReceipt.acceptedAt, 80),
      transportAttempts: Number(delivery.providerReceipt.transportAttempts || 0)
    } : null,
    trustedCallback: delivery.trustedCallback ? {
      receiptId: clean(delivery.trustedCallback.receiptId, 200),
      status: clean(delivery.trustedCallback.status, 40),
      signatureVerified: delivery.trustedCallback.signatureVerified === true,
      at: clean(delivery.trustedCallback.at, 80)
    } : null,
    lastFailure: delivery.lastFailure ? {
      code: normalizedFailureCode(delivery.lastFailure.code),
      at: clean(delivery.lastFailure.at, 80),
      retryable: delivery.lastFailure.retryable === true
    } : null,
    replayCount: Number(delivery.replayCount || 0),
    createdAt: clean(delivery.createdAt, 80),
    updatedAt: clean(delivery.updatedAt, 80),
    payloadPersisted: false,
    subjectDataPersisted: false,
    credentialsPersisted: false,
    productionReady: false
  };
}

function buildDirectReportDeliveryInput(workflow = {}, options = {}) {
  const { binding } = assertSubmittableWorkflow(workflow);
  const reportCard = workflow.reportCard || {};
  const event = workflow.event || {};
  const payload = {
    externalId: binding.externalEventId,
    subjectReference: createKeyedReference(event.residentId, "subject", options),
    institutionCode: binding.sourceInstitutionCode,
    reportType: clean(reportCard.reportType || "infectious-disease-case", 120),
    diseaseCode: binding.diagnosisCode,
    testCode: binding.testCode,
    resultFlag: binding.resultFlag,
    occurredAt: binding.occurredAt,
    reportedAt: binding.reportedAt,
    sourceSystem: clean(event.sourceSystem, 80),
    reportCardNo: binding.reportCardNo,
    specimenReference: event.sampleNo
      ? createKeyedReference(`${binding.sourceInstitutionCode}|${event.sampleNo}`, "specimen", options)
      : ""
  };
  return {
    contractId: DIRECT_REPORT_CONTRACT_ID,
    idempotencyKey: options.deliveryId || `phdr-case-${sha256(binding.caseId).slice(0, 24)}`,
    requestId: options.deliveryId || `phdr-request-${sha256(binding.caseId).slice(0, 24)}`,
    payload: validateDirectReportPayload(payload, options)
  };
}

module.exports = {
  DELIVERY_STATES,
  buildDirectReportDeliveryInput,
  claimDirectReportDeliveryToState,
  enqueueDirectReportDeliveryToState,
  listDueDirectReportDeliveries,
  projectDirectReportDelivery,
  recordDirectReportDeliveryOutcomeToState,
  recordTrustedDirectReportCallbackToState,
  requeueDirectReportDeadLetterToState,
  sha256
};
