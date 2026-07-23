"use strict";

const { createHash, randomUUID } = require("node:crypto");
const Domain = require("./nursing-escort-domain");

const WRITE_PATH_POLICY_VERSION = "escort-write-path-v1";
const EVENT_OUTBOX_POLICY_VERSION = "escort-event-outbox-v1";
const PROVIDER_ADMISSION_POLICY_VERSION = "escort-provider-admission-v1";
const ELIGIBILITY_POLICY_VERSION = "escort-eligibility-v1";
const ALLOWED_CREATE_ROLES = new Set(["citizen", "institution", "county", "commission"]);
const ALLOWED_RISK_LEVELS = new Set(["low", "medium", "high"]);
const ALLOWED_PRIORITIES = new Set(["low", "medium", "high", "urgent"]);
const ALLOWED_PROVIDER_STATUSES = new Set(["published", "active"]);
const ELIGIBLE_STATUSES = new Set(["eligible", "passed", "approved"]);

class EscortServiceError extends Error {
  constructor(code, message, details = {}, statusCode = 409) {
    super(message);
    this.name = "EscortServiceError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stableValue(value[key]);
    return result;
  }, {});
}

function sha256Digest(value) {
  const serialized = JSON.stringify(stableValue(value));
  return `sha256:${createHash("sha256").update(serialized === undefined ? "null" : serialized).digest("hex")}`;
}

function normalizedText(value) {
  return String(value || "").trim();
}

function normalizedLower(value) {
  return normalizedText(value).toLowerCase();
}

function normalizedList(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(normalizedLower)
    .filter(Boolean))]
    .sort();
}

function isoTime(value) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) return "";
  return new Date(parsed).toISOString();
}

function canonicalIntakePayload(payload = {}) {
  const appointmentAt = isoTime(payload.appointmentAt);
  return {
    residentId: normalizedText(payload.residentId),
    providerId: normalizedText(payload.providerId),
    district: normalizedText(payload.district),
    hospital: normalizedText(payload.hospital),
    hospitalCode: normalizedText(payload.hospitalCode),
    department: normalizedText(payload.department),
    departmentCode: normalizedText(payload.departmentCode),
    appointmentAt,
    due: isoTime(payload.due || payload.appointmentAt),
    serviceItems: normalizedList(payload.serviceItems),
    riskLevel: normalizedLower(payload.riskLevel || "medium"),
    priority: normalizedLower(payload.priority || payload.riskLevel || "medium"),
    subsidyType: normalizedLower(payload.subsidyType || "self-pay"),
    transportLink: normalizedLower(payload.transportLink || "not-required"),
    registrationOrderId: normalizedText(payload.registrationOrderId),
    familyContactId: normalizedText(payload.familyContactId),
    note: normalizedText(payload.note)
  };
}

function intakeIdempotencyKey(order = {}) {
  return [
    "escort",
    normalizedText(order.residentId),
    normalizedText(order.providerId),
    normalizedText(order.hospitalCode || order.hospital).toLowerCase(),
    normalizedText(order.departmentCode || order.department).toLowerCase(),
    normalizedText(order.appointmentAt)
  ].join(":");
}

function intakeFingerprint(order = {}) {
  return sha256Digest(canonicalIntakePayload(order));
}

function buildOutboxEvent({ aggregateId, eventType, occurredAt, idempotencyKey, payload }) {
  const payloadDigest = sha256Digest(payload);
  const digest = sha256Digest({ aggregateId, eventType, idempotencyKey, payloadDigest });
  return {
    id: `escort-outbox:${digest.slice("sha256:".length)}`,
    aggregateType: "escort-service-order",
    aggregateId: normalizedText(aggregateId),
    eventType: normalizedText(eventType),
    status: "pending",
    occurredAt: normalizedText(occurredAt),
    idempotencyKey: normalizedText(idempotencyKey),
    payloadDigest,
    payload: clone(payload),
    attempts: 0,
    policyVersion: EVENT_OUTBOX_POLICY_VERSION
  };
}

function validateOutboxEvent(event = {}) {
  const reasons = [];
  const expectedPayloadDigest = sha256Digest(event.payload);
  const expectedDigest = sha256Digest({
    aggregateId: event.aggregateId,
    eventType: event.eventType,
    idempotencyKey: event.idempotencyKey,
    payloadDigest: expectedPayloadDigest
  });
  if (!event.id || event.id !== `escort-outbox:${expectedDigest.slice("sha256:".length)}`) reasons.push("outbox-id-invalid");
  if (event.aggregateType !== "escort-service-order") reasons.push("outbox-aggregate-type-invalid");
  if (!event.aggregateId) reasons.push("outbox-aggregate-id-missing");
  if (!event.eventType) reasons.push("outbox-event-type-missing");
  if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) reasons.push("outbox-payload-invalid");
  if (!["pending", "processing", "retry", "delivered", "failed", "dead-letter"].includes(event.status)) reasons.push("outbox-status-invalid");
  if (!Number.isFinite(Date.parse(String(event.occurredAt || "")))) reasons.push("outbox-time-invalid");
  if (!event.idempotencyKey) reasons.push("outbox-idempotency-key-missing");
  if (event.payloadDigest !== expectedPayloadDigest) reasons.push("outbox-payload-digest-invalid");
  if (!Number.isInteger(event.attempts) || event.attempts < 0) reasons.push("outbox-attempts-invalid");
  if (event.policyVersion !== EVENT_OUTBOX_POLICY_VERSION) reasons.push("outbox-policy-version-invalid");
  return { ok: reasons.length === 0, reasons, expectedPayloadDigest };
}

function assertOutboxEvent(event) {
  const integrity = validateOutboxEvent(event);
  if (!integrity.ok) {
    throw new EscortServiceError(
      "ESCORT_OUTBOX_INTEGRITY_INVALID",
      `escort outbox event is invalid: ${integrity.reasons.join(", ")}`,
      integrity
    );
  }
}

function appendOutboxEvent(data, event) {
  assertOutboxEvent(event);
  const outbox = Array.isArray(data.escortServiceOutbox) ? data.escortServiceOutbox : [];
  const existing = outbox.find((item) => item.idempotencyKey === event.idempotencyKey);
  if (existing) {
    if (existing.payloadDigest !== event.payloadDigest) {
      throw new EscortServiceError(
        "ESCORT_OUTBOX_IDEMPOTENCY_CONFLICT",
        "outbox idempotency key was already used with a different payload",
        { idempotencyKey: event.idempotencyKey, existingEventId: existing.id }
      );
    }
    assertOutboxEvent(existing);
    return { event: existing, replayed: true };
  }
  data.escortServiceOutbox = [event, ...outbox].slice(0, 1000);
  return { event, replayed: false };
}

function authorizationReceiptFor(options = {}, residentId) {
  if (typeof options.authorizationReceiptFor === "function") {
    return normalizedText(options.authorizationReceiptFor(residentId));
  }
  if (options.authorizationReceipts && typeof options.authorizationReceipts === "object") {
    return normalizedText(options.authorizationReceipts[residentId]);
  }
  return normalizedText(options.authorizationReceiptId);
}

function authorizeCreate(actor = {}, residentId, options = {}, at) {
  const role = normalizedLower(actor.role);
  if (!ALLOWED_CREATE_ROLES.has(role)) {
    throw new EscortServiceError(
      "ESCORT_CREATE_ROLE_DENIED",
      "actor role cannot create an escort order",
      { role },
      403
    );
  }
  const actorId = normalizedText(actor.residentId || actor.accountId || actor.id || actor.username);
  if (!actorId) {
    throw new EscortServiceError(
      "ESCORT_CREATE_ACTOR_MISSING",
      "authenticated actor identity is required",
      {},
      401
    );
  }
  if (role === "citizen") {
    const selfResidentId = normalizedText(actor.residentId);
    const allowedResidentIds = new Set([
      selfResidentId,
      ...(Array.isArray(options.allowedResidentIds) ? options.allowedResidentIds : []),
      ...(Array.isArray(actor.allowedResidentIds) ? actor.allowedResidentIds : [])
    ].map(normalizedText).filter(Boolean));
    if (!allowedResidentIds.has(residentId)) {
      throw new EscortServiceError(
        "ESCORT_RESIDENT_SCOPE_DENIED",
        "resident is outside the authenticated account scope",
        { residentId },
        403
      );
    }
    const requesterRole = selfResidentId === residentId ? "resident" : "family";
    const registryReceiptId = requesterRole === "family" ? authorizationReceiptFor(options, residentId) : "";
    if (requesterRole === "family" && !registryReceiptId) {
      throw new EscortServiceError(
        "ESCORT_DELEGATION_EVIDENCE_REQUIRED",
        "family booking requires an authorization registry receipt",
        { residentId },
        403
      );
    }
    return {
      status: "verified",
      requesterId: selfResidentId,
      requesterRole,
      residentId,
      accountId: normalizedText(actor.accountId || actor.id),
      source: requesterRole === "family" ? "resident-authorization-registry" : "authenticated-session",
      registryReceiptId,
      verifiedAt: at,
      policyVersion: WRITE_PATH_POLICY_VERSION
    };
  }
  if (typeof options.canAccessResident !== "function" || options.canAccessResident(residentId, actor) !== true) {
    throw new EscortServiceError(
      "ESCORT_RESIDENT_SCOPE_DENIED",
      "resident access decision is missing or denied",
      { residentId, role },
      403
    );
  }
  return {
    status: "verified",
    requesterId: actorId,
    requesterRole: role,
    residentId,
    accountId: normalizedText(actor.accountId || actor.id),
    source: "server-access-control",
    registryReceiptId: authorizationReceiptFor(options, residentId),
    verifiedAt: at,
    policyVersion: WRITE_PATH_POLICY_VERSION
  };
}

function validateProviderAndCatalog(intake = {}, provider = {}, policy = {}) {
  const reasons = [];
  const requestedItems = new Set(normalizedList(intake.serviceItems));
  const policyItems = new Set(normalizedList(policy.serviceItems));
  const providerItems = new Set(normalizedList(provider.serviceItems));
  if (!provider.id || normalizedText(provider.id) !== normalizedText(intake.providerId)) reasons.push("intake-provider-registry-mismatch");
  if (provider.published !== true) reasons.push("intake-provider-not-published");
  if (!ALLOWED_PROVIDER_STATUSES.has(normalizedLower(provider.status))) reasons.push("intake-provider-status-unavailable");
  if (provider.admissionReview?.status !== "approved") reasons.push("intake-provider-admission-not-approved");
  if (provider.admissionReview?.policyVersion !== PROVIDER_ADMISSION_POLICY_VERSION) reasons.push("intake-provider-admission-policy-invalid");
  if (!Number.isFinite(Date.parse(String(provider.admissionReview?.validUntil || "")))) {
    reasons.push("intake-provider-admission-expiry-missing");
  } else if (Date.parse(provider.admissionReview.validUntil) <= Date.parse(intake.appointmentAt)) {
    reasons.push("intake-provider-admission-expired");
  }
  if (!requestedItems.size) reasons.push("intake-service-items-missing");
  for (const item of requestedItems) {
    if (!policyItems.size || !policyItems.has(item)) reasons.push(`intake-service-outside-policy-catalog:${item}`);
    if (!providerItems.size || !providerItems.has(item)) reasons.push(`intake-service-outside-provider-catalog:${item}`);
  }
  if (!provider.insurance) reasons.push("intake-provider-insurance-missing");
  if (!provider.emergencyPlan) reasons.push("intake-provider-emergency-plan-missing");
  if (!Number.isFinite(Number(provider.trainedWorkers)) || Number(provider.trainedWorkers) <= 0) reasons.push("intake-provider-workforce-unavailable");
  if (!["regular", "pilot"].includes(normalizedLower(provider.serviceCapacity))) reasons.push("intake-provider-capacity-unavailable");
  if (intake.district && provider.district && normalizedLower(intake.district) !== normalizedLower(provider.district)) {
    reasons.push("intake-outside-provider-district");
  }
  if (!ALLOWED_RISK_LEVELS.has(normalizedLower(intake.riskLevel))) reasons.push("intake-risk-level-invalid");
  if (!ALLOWED_PRIORITIES.has(normalizedLower(intake.priority))) reasons.push("intake-priority-invalid");
  return { ok: reasons.length === 0, reasons };
}

function validateIntake(intake = {}, orders = [], options = {}) {
  const reasons = [];
  const now = Date.parse(String(options.at || ""));
  const appointmentAt = Date.parse(String(intake.appointmentAt || ""));
  if (!intake.residentId) reasons.push("intake-resident-missing");
  if (!intake.providerId) reasons.push("intake-provider-missing");
  if (!intake.hospital) reasons.push("intake-hospital-missing");
  if (!intake.department) reasons.push("intake-department-missing");
  if (!intake.appointmentAt || !Number.isFinite(appointmentAt)) reasons.push("intake-appointment-time-invalid");
  if (Number.isFinite(now) && Number.isFinite(appointmentAt) && appointmentAt <= now) reasons.push("intake-appointment-time-not-future");
  if (Number.isFinite(now) && Number.isFinite(appointmentAt)
    && appointmentAt > now + Number(options.maxAdvanceDays ?? 90) * 86400000) {
    reasons.push("intake-appointment-time-too-far");
  }
  const expectedKey = intakeIdempotencyKey(intake);
  if (intake.idempotencyKey !== expectedKey) reasons.push("intake-idempotency-key-invalid");
  const activeStatuses = new Set([
    "requested", "eligibility-checked", "provider-matched", "worker-dispatched", "accepted",
    "hospital-returned", "evidence-pending", "hospital-confirmed", "risk-hold", "reschedule-requested",
    "no-show-review", "in-service", "completed", "settlement-pending", "settled", "quality-review",
    "complaint-open", "cancel-requested", "refund-pending"
  ]);
  const duplicate = orders.find((item) => item.idempotencyKey === expectedKey
    && activeStatuses.has(Domain.canonicalStatus(item.status, "escort")));
  if (duplicate) reasons.push("intake-active-appointment-duplicate");
  return { ok: reasons.length === 0, reasons, duplicateOrderId: duplicate?.id || "" };
}

function createEscortOrder(state = {}, payload = {}, actor = {}, options = {}) {
  const at = new Date(options.at || Date.now()).toISOString();
  const data = clone(state);
  const providers = Array.isArray(data.escortServiceProviders) ? data.escortServiceProviders : [];
  const orders = Array.isArray(data.escortServiceOrders) ? data.escortServiceOrders : [];
  const policy = data.escortServicePolicy || {};
  const intake = canonicalIntakePayload(payload);
  intake.idempotencyKey = intakeIdempotencyKey(intake);
  const requesterAuthorization = authorizeCreate(actor, intake.residentId, options, at);
  const provider = providers.find((item) => item.id === intake.providerId) || {};
  const providerResult = validateProviderAndCatalog(intake, provider, policy);
  if (!providerResult.ok) {
    throw new EscortServiceError(
      "ESCORT_INTAKE_PROVIDER_INVALID",
      `escort provider or catalog validation failed: ${providerResult.reasons.join(", ")}`,
      providerResult
    );
  }
  const fingerprint = intakeFingerprint(intake);
  const existing = orders.find((item) => item.idempotencyKey === intake.idempotencyKey);
  if (existing) {
    if (existing.intakeFingerprint !== fingerprint) {
      throw new EscortServiceError(
        "ESCORT_IDEMPOTENCY_CONFLICT",
        "idempotency key was already used with a different escort intake",
        { idempotencyKey: intake.idempotencyKey, existingOrderId: existing.id }
      );
    }
    const createEventKey = `escort:${existing.id}:create:${existing.idempotencyKey}`;
    const outboxEvent = (Array.isArray(data.escortServiceOutbox) ? data.escortServiceOutbox : [])
      .find((item) => item.idempotencyKey === createEventKey);
    if (!outboxEvent) {
      throw new EscortServiceError(
        "ESCORT_OUTBOX_EVENT_MISSING",
        "idempotent escort order replay is missing its atomic outbox event",
        { idempotencyKey: intake.idempotencyKey, existingOrderId: existing.id }
      );
    }
    assertOutboxEvent(outboxEvent);
    return { created: false, replayed: true, state: data, order: clone(existing), outboxEvent: clone(outboxEvent) };
  }
  const intakeResult = validateIntake(intake, orders, { at, maxAdvanceDays: options.maxAdvanceDays });
  if (!intakeResult.ok) {
    throw new EscortServiceError(
      "ESCORT_INTAKE_INVALID",
      `escort intake validation failed: ${intakeResult.reasons.join(", ")}`,
      intakeResult,
      400
    );
  }
  const order = {
    ...intake,
    id: normalizedText(options.idFactory?.() || `eso-${randomUUID()}`),
    requestedAt: at,
    status: "requested",
    sourceChannel: "escort-mobile",
    requesterAuthorization,
    intakeFingerprint: fingerprint,
    workerId: "",
    identityVerified: false,
    eligibilityResult: { status: "pending" },
    providerAdmissionSnapshot: null,
    contractStatus: "pending",
    insuranceStatus: "pending",
    hospitalInterfaceStatus: "pending",
    hospitalCheckInStatus: "pending",
    hospitalCheckInNo: "",
    hisVisitId: "",
    familyContactStatus: "pending",
    qualityReview: "pending",
    complaintStatus: "none",
    satisfaction: "pending",
    locationTrace: "pending",
    locationTracePoints: [],
    serviceRecordStatus: "pending",
    serviceRecord: { status: "pending", attachments: [], attachmentCount: 0 },
    serviceAttachments: [],
    notificationReceiptSummary: { status: "pending", sent: 0, queued: 0, delivered: 0, read: 0, failed: 0 },
    adverseEvent: { status: "none" },
    auditTrail: [{
      at,
      action: "order-created",
      by: requesterAuthorization.requesterId,
      role: requesterAuthorization.requesterRole,
      policyVersion: WRITE_PATH_POLICY_VERSION
    }],
    writePathPolicyVersion: WRITE_PATH_POLICY_VERSION
  };
  data.escortServiceOrders = [order, ...orders];
  const outbox = appendOutboxEvent(data, buildOutboxEvent({
    aggregateId: order.id,
    eventType: "escort-service-order-created",
    occurredAt: at,
    idempotencyKey: `escort:${order.id}:create:${order.idempotencyKey}`,
    payload: {
      orderId: order.id,
      residentId: order.residentId,
      providerId: order.providerId,
      hospitalCode: order.hospitalCode,
      departmentCode: order.departmentCode,
      appointmentAt: order.appointmentAt,
      serviceItems: order.serviceItems,
      status: order.status,
      requesterRole: order.requesterAuthorization.requesterRole,
      intakeFingerprint: order.intakeFingerprint,
      task: {
        targetRole: "provider",
        templateKey: "escort-appointment-submitted",
        requiredChannels: ["in_app"]
      },
      audit: {
        action: "order-created",
        actorId: order.requesterAuthorization.requesterId,
        actorRole: order.requesterAuthorization.requesterRole
      }
    }
  }));
  return { created: true, replayed: false, state: data, order: clone(order), outboxEvent: clone(outbox.event) };
}

function validateEarlyTransitionEvidence(order = {}, nextStatus, at) {
  const reasons = [];
  if (nextStatus === "eligibility-checked") {
    const evidence = order.eligibilityResult || {};
    if (order.identityVerified !== true) reasons.push("eligibility-identity-not-verified");
    if (!ELIGIBLE_STATUSES.has(normalizedLower(evidence.status))) reasons.push("eligibility-status-not-approved");
    if (evidence.orderId !== order.id) reasons.push("eligibility-order-mismatch");
    if (evidence.residentId !== order.residentId) reasons.push("eligibility-resident-mismatch");
    if (evidence.policyVersion !== ELIGIBILITY_POLICY_VERSION) reasons.push("eligibility-policy-version-invalid");
    if (!Number.isFinite(Date.parse(String(evidence.checkedAt || "")))) reasons.push("eligibility-time-invalid");
    if (!Number.isFinite(Date.parse(String(evidence.validUntil || "")))
      || Date.parse(evidence.validUntil) <= Date.parse(at)) reasons.push("eligibility-expired");
  }
  if (nextStatus === "provider-matched") {
    const evidence = order.providerAdmissionSnapshot || {};
    if (evidence.status !== "approved" || evidence.published !== true) reasons.push("provider-admission-not-approved");
    if (evidence.orderId !== order.id) reasons.push("provider-admission-order-mismatch");
    if (evidence.providerId !== order.providerId) reasons.push("provider-admission-subject-mismatch");
    if (evidence.policyVersion !== PROVIDER_ADMISSION_POLICY_VERSION) reasons.push("provider-admission-policy-version-invalid");
    if (!Number.isFinite(Date.parse(String(evidence.verifiedAt || "")))) reasons.push("provider-admission-time-invalid");
    if (!Number.isFinite(Date.parse(String(evidence.validUntil || "")))
      || Date.parse(evidence.validUntil) <= Date.parse(at)) reasons.push("provider-admission-expired");
  }
  return { ok: reasons.length === 0, reasons };
}

function transitionEscortOrder(state = {}, orderId, nextStatus, actor = {}, options = {}) {
  if (Object.hasOwn(options, "enforceEvidence")) {
    throw new EscortServiceError(
      "ESCORT_EVIDENCE_BYPASS_FORBIDDEN",
      "evidence enforcement cannot be configured by the write-path caller",
      {},
      400
    );
  }
  const data = clone(state);
  const orders = Array.isArray(data.escortServiceOrders) ? data.escortServiceOrders : [];
  const index = orders.findIndex((item) => item.id === orderId);
  if (index < 0) throw new EscortServiceError("ESCORT_ORDER_NOT_FOUND", "escort order not found", { orderId }, 404);
  if (typeof options.canAccessOrder !== "function" || options.canAccessOrder(orders[index], actor) !== true) {
    throw new EscortServiceError("ESCORT_ORDER_SCOPE_DENIED", "order access decision is missing or denied", { orderId }, 403);
  }
  const commandId = normalizedText(options.commandId);
  if (!commandId) {
    throw new EscortServiceError(
      "ESCORT_TRANSITION_IDEMPOTENCY_REQUIRED",
      "transition command id is required",
      { orderId },
      400
    );
  }
  const actorId = normalizedText(actor.id || actor.username || actor.accountId || actor.residentId);
  const normalizedNext = Domain.canonicalStatus(nextStatus, "escort");
  const commandFingerprint = sha256Digest({
    orderId,
    nextStatus: normalizedNext,
    actorId,
    actorRole: normalizedLower(actor.role),
    updates: options.updates || {}
  });
  const outboxIdempotencyKey = `escort:${orderId}:transition:${normalizedNext}:${commandId}`;
  const existingEvent = (Array.isArray(data.escortServiceOutbox) ? data.escortServiceOutbox : [])
    .find((item) => item.idempotencyKey === outboxIdempotencyKey);
  if (existingEvent) {
    assertOutboxEvent(existingEvent);
    if (existingEvent.payload?.commandFingerprint !== commandFingerprint) {
      throw new EscortServiceError(
        "ESCORT_TRANSITION_IDEMPOTENCY_CONFLICT",
        "transition command id was already used with different content",
        { commandId, existingEventId: existingEvent.id }
      );
    }
    return { state: data, order: clone(orders[index]), outboxEvent: clone(existingEvent), replayed: true };
  }
  const at = new Date(options.at || Date.now()).toISOString();
  const candidate = { ...orders[index], ...clone(options.updates || {}) };
  const earlyEvidence = validateEarlyTransitionEvidence(candidate, normalizedNext, at);
  if (!earlyEvidence.ok) {
    throw new EscortServiceError(
      "ESCORT_TRANSITION_EVIDENCE_INVALID",
      `escort transition evidence is invalid: ${earlyEvidence.reasons.join(", ")}`,
      earlyEvidence
    );
  }
  const fromStatus = orders[index].status;
  const transitioned = Domain.transitionOrder("escort", orders[index], normalizedNext, {
    at,
    actorId,
    actorRole: normalizedLower(actor.role),
    updates: clone(options.updates || {})
  });
  orders[index] = transitioned;
  data.escortServiceOrders = orders;
  const timelineEvent = transitioned.timelineEvents?.[0] || {};
  const notificationPlan = transitioned.notificationPlans?.[0] || {};
  const outbox = appendOutboxEvent(data, buildOutboxEvent({
    aggregateId: orderId,
    eventType: "escort-service-order-transitioned",
    occurredAt: transitioned.updatedAt,
    idempotencyKey: outboxIdempotencyKey,
    payload: {
      orderId,
      residentId: transitioned.residentId,
      providerId: transitioned.providerId,
      workerId: transitioned.workerId || "",
      fromStatus,
      toStatus: transitioned.status,
      commandId,
      commandFingerprint,
      timelineEvent,
      notificationPlan,
      audit: {
        action: `transition:${fromStatus}->${transitioned.status}`,
        actorId,
        actorRole: normalizedLower(actor.role)
      }
    }
  }));
  return { state: data, order: clone(transitioned), outboxEvent: clone(outbox.event), replayed: false };
}

function recordEscortNotificationReceipt(state = {}, orderId, messageId, details = {}, actor = {}, options = {}) {
  const data = clone(state);
  const orders = Array.isArray(data.escortServiceOrders) ? data.escortServiceOrders : [];
  const index = orders.findIndex((item) => item.id === orderId);
  if (index < 0) throw new EscortServiceError("ESCORT_ORDER_NOT_FOUND", "escort order not found", { orderId }, 404);
  if (typeof options.canAccessOrder !== "function" || options.canAccessOrder(orders[index], actor) !== true) {
    throw new EscortServiceError("ESCORT_ORDER_SCOPE_DENIED", "order access decision is missing or denied", { orderId }, 403);
  }
  const message = (Array.isArray(orders[index].notificationPlans) ? orders[index].notificationPlans : [])
    .flatMap((plan) => Array.isArray(plan.messages) ? plan.messages : [])
    .find((item) => item.id === messageId);
  if (!message) {
    throw new EscortServiceError(
      "ESCORT_NOTIFICATION_MESSAGE_NOT_FOUND",
      "notification message is not bound to the escort order",
      { orderId, messageId },
      404
    );
  }
  const receipt = Domain.buildNotificationReceiptEvidence("escort", orders[index], message, details, { at: options.at });
  const recorded = Domain.recordNotificationReceipt("escort", orders[index], receipt, { at: options.at });
  orders[index] = recorded.order;
  data.escortServiceOrders = orders;
  const outboxKey = `escort:${orderId}:notification-receipt:${receipt.idempotencyKey}`;
  const existingEvent = (Array.isArray(data.escortServiceOutbox) ? data.escortServiceOutbox : [])
    .find((item) => item.idempotencyKey === outboxKey);
  if (recorded.duplicate) {
    if (!existingEvent) {
      throw new EscortServiceError(
        "ESCORT_OUTBOX_EVENT_MISSING",
        "idempotent notification receipt replay is missing its atomic outbox event",
        { orderId, messageId, idempotencyKey: receipt.idempotencyKey }
      );
    }
    assertOutboxEvent(existingEvent);
    return {
      state: data,
      order: clone(recorded.order),
      receipt: clone(receipt),
      outboxEvent: clone(existingEvent),
      replayed: true
    };
  }
  const actorId = normalizedText(actor.id || actor.username || actor.accountId);
  const outbox = appendOutboxEvent(data, buildOutboxEvent({
    aggregateId: orderId,
    eventType: "escort-notification-receipt-recorded",
    occurredAt: receipt.occurredAt,
    idempotencyKey: outboxKey,
    payload: {
      orderId,
      residentId: recorded.order.residentId,
      messageId: receipt.messageId,
      planId: receipt.planId,
      channel: receipt.channel,
      status: receipt.status,
      providerMessageId: receipt.providerMessageId,
      audit: {
        action: "notification-receipt-recorded",
        actorId,
        actorRole: normalizedLower(actor.role || "gateway")
      }
    }
  }));
  return {
    state: data,
    order: clone(recorded.order),
    receipt: clone(receipt),
    outboxEvent: clone(outbox.event),
    replayed: false
  };
}

module.exports = {
  WRITE_PATH_POLICY_VERSION,
  EVENT_OUTBOX_POLICY_VERSION,
  PROVIDER_ADMISSION_POLICY_VERSION,
  ELIGIBILITY_POLICY_VERSION,
  EscortServiceError,
  canonicalIntakePayload,
  intakeIdempotencyKey,
  intakeFingerprint,
  buildOutboxEvent,
  validateOutboxEvent,
  validateProviderAndCatalog,
  validateIntake,
  createEscortOrder,
  transitionEscortOrder,
  recordEscortNotificationReceipt
};
