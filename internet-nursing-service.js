"use strict";

const { createHash, randomUUID } = require("node:crypto");
const Domain = require("./nursing-escort-domain");

const WRITE_PATH_POLICY_VERSION = "internet-nursing-write-path-v1";
const EVENT_OUTBOX_POLICY_VERSION = "internet-nursing-event-outbox-v1";
const ALLOWED_CREATE_ROLES = new Set(["citizen", "institution", "commission"]);
const ALLOWED_RISK_LEVELS = new Set(["low", "medium", "high"]);
const SERVICE_OBJECT_ALIASES = Object.freeze({
  "rehabilitation patient": "rehabilitation patients",
  "terminal-stage patient": "terminal-stage patients",
  "mobility-limited chronic disease patient": "mobility-limited chronic disease patients"
});

class InternetNursingServiceError extends Error {
  constructor(code, message, details = {}, statusCode = 409) {
    super(message);
    this.name = "InternetNursingServiceError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function canonicalServiceObject(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return SERVICE_OBJECT_ALIASES[normalized] || normalized;
}

function normalizedSet(values = []) {
  return new Set((Array.isArray(values) ? values : []).map((item) => String(item || "").trim().toLowerCase()).filter(Boolean));
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

function canonicalIntakePayload(order = {}) {
  return {
    residentId: String(order.residentId || "").trim(),
    institutionId: String(order.institutionId || "").trim(),
    serviceItem: String(order.serviceItem || "").trim(),
    serviceObject: canonicalServiceObject(order.serviceObject),
    preferredAt: new Date(order.preferredAt).toISOString(),
    durationMinutes: Number(order.durationMinutes),
    district: String(order.district || "").trim(),
    address: String(order.address || "").trim(),
    location: {
      lat: Number(order.location?.lat),
      lng: Number(order.location?.lng),
      source: String(order.location?.source || "resident-map")
    },
    riskLevel: String(order.riskLevel || "medium").trim().toLowerCase(),
    note: String(order.note || "").trim()
  };
}

function intakeFingerprint(order = {}) {
  const canonical = canonicalIntakePayload(order);
  return sha256Digest(canonical);
}

function buildOutboxEvent({ aggregateId, eventType, occurredAt, idempotencyKey, payload }) {
  const payloadDigest = sha256Digest(payload);
  const digest = sha256Digest({ aggregateId, eventType, idempotencyKey, payloadDigest });
  return {
    id: `nursing-outbox:${digest.slice("sha256:".length)}`,
    aggregateType: "internet-nursing-order",
    aggregateId: String(aggregateId || ""),
    eventType: String(eventType || ""),
    status: "pending",
    occurredAt: String(occurredAt || ""),
    idempotencyKey: String(idempotencyKey || ""),
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
  if (!event.id || event.id !== `nursing-outbox:${expectedDigest.slice("sha256:".length)}`) reasons.push("outbox-id-invalid");
  if (event.aggregateType !== "internet-nursing-order") reasons.push("outbox-aggregate-type-invalid");
  if (!event.aggregateId) reasons.push("outbox-aggregate-id-missing");
  if (!event.eventType) reasons.push("outbox-event-type-missing");
  if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) reasons.push("outbox-payload-invalid");
  if (!["pending", "processing", "delivered", "failed"].includes(event.status)) reasons.push("outbox-status-invalid");
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
    throw new InternetNursingServiceError(
      "NURSING_OUTBOX_INTEGRITY_INVALID",
      `internet nursing outbox event is invalid: ${integrity.reasons.join(", ")}`,
      integrity
    );
  }
}

function appendOutboxEvent(data, event) {
  assertOutboxEvent(event);
  const outbox = Array.isArray(data.internetNursingOutbox) ? data.internetNursingOutbox : [];
  const existing = outbox.find((item) => item.idempotencyKey === event.idempotencyKey);
  if (existing) {
    if (existing.payloadDigest !== event.payloadDigest) {
      throw new InternetNursingServiceError(
        "NURSING_OUTBOX_IDEMPOTENCY_CONFLICT",
        "outbox idempotency key was already used with a different payload",
        { idempotencyKey: event.idempotencyKey, existingEventId: existing.id }
      );
    }
    return { event: existing, replayed: true };
  }
  data.internetNursingOutbox = [event, ...outbox].slice(0, 1000);
  return { event, replayed: false };
}

function authorizationReceiptFor(options = {}, residentId) {
  if (typeof options.authorizationReceiptFor === "function") {
    return String(options.authorizationReceiptFor(residentId) || "").trim();
  }
  if (options.authorizationReceipts && typeof options.authorizationReceipts === "object") {
    return String(options.authorizationReceipts[residentId] || "").trim();
  }
  return String(options.authorizationReceiptId || "").trim();
}

function authorizeCreate(actor = {}, residentId, options = {}, at) {
  const role = String(actor.role || "").trim().toLowerCase();
  if (!ALLOWED_CREATE_ROLES.has(role)) {
    throw new InternetNursingServiceError(
      "NURSING_CREATE_ROLE_DENIED",
      "actor role cannot create an internet nursing order",
      { role },
      403
    );
  }
  const actorId = String(actor.residentId || actor.accountId || actor.id || actor.username || "").trim();
  if (!actorId) {
    throw new InternetNursingServiceError(
      "NURSING_CREATE_ACTOR_MISSING",
      "authenticated actor identity is required",
      {},
      401
    );
  }
  if (role === "citizen") {
    const selfResidentId = String(actor.residentId || "").trim();
    const allowedResidentIds = new Set([
      selfResidentId,
      ...(Array.isArray(options.allowedResidentIds) ? options.allowedResidentIds : []),
      ...(Array.isArray(actor.allowedResidentIds) ? actor.allowedResidentIds : [])
    ].map((item) => String(item || "").trim()).filter(Boolean));
    if (!allowedResidentIds.has(residentId)) {
      throw new InternetNursingServiceError(
        "NURSING_RESIDENT_SCOPE_DENIED",
        "resident is outside the authenticated account scope",
        { residentId },
        403
      );
    }
    const requesterRole = selfResidentId === residentId ? "resident" : "family";
    const registryReceiptId = requesterRole === "family" ? authorizationReceiptFor(options, residentId) : "";
    if (requesterRole === "family" && !registryReceiptId) {
      throw new InternetNursingServiceError(
        "NURSING_DELEGATION_EVIDENCE_REQUIRED",
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
      accountId: String(actor.accountId || actor.id || "").trim(),
      source: requesterRole === "family" ? "resident-authorization-registry" : "authenticated-session",
      registryReceiptId,
      verifiedAt: at,
      policyVersion: WRITE_PATH_POLICY_VERSION
    };
  }
  if (typeof options.canAccessResident !== "function" || options.canAccessResident(residentId, actor) !== true) {
    throw new InternetNursingServiceError(
      "NURSING_RESIDENT_SCOPE_DENIED",
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
    accountId: String(actor.accountId || actor.id || "").trim(),
    source: "server-access-control",
    registryReceiptId: authorizationReceiptFor(options, residentId),
    verifiedAt: at,
    policyVersion: WRITE_PATH_POLICY_VERSION
  };
}

function validateCatalogAndInstitution(payload, institution = {}, policy = {}) {
  const reasons = [];
  const serviceItem = String(payload.serviceItem || "").trim().toLowerCase();
  const serviceObject = canonicalServiceObject(payload.serviceObject);
  const policyCatalog = normalizedSet(policy.serviceCatalog);
  const policyObjects = normalizedSet(policy.serviceObjects);
  const institutionCatalog = normalizedSet(institution.serviceItems);
  if (!institution.id || String(institution.id) !== String(payload.institutionId || "")) reasons.push("intake-institution-registry-mismatch");
  if (institution.published !== true) reasons.push("intake-institution-not-published");
  if (institution.admissionReview?.status !== "approved") reasons.push("intake-institution-admission-not-approved");
  if (!policyCatalog.size || !policyCatalog.has(serviceItem)) reasons.push("intake-service-outside-policy-catalog");
  if (!institutionCatalog.size || !institutionCatalog.has(serviceItem)) reasons.push("intake-service-outside-institution-catalog");
  if (!policyObjects.size || !policyObjects.has(serviceObject)) reasons.push("intake-service-object-outside-policy");
  if (!Number.isFinite(Number(institution.dailyCapacity)) || Number(institution.dailyCapacity) <= 0) reasons.push("intake-institution-capacity-unavailable");
  const latitude = Number(payload.location?.lat);
  const longitude = Number(payload.location?.lng);
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) reasons.push("intake-location-out-of-range");
  if (!ALLOWED_RISK_LEVELS.has(String(payload.riskLevel || "").trim().toLowerCase())) reasons.push("intake-risk-level-invalid");
  return { ok: reasons.length === 0, reasons };
}

function createInternetNursingOrder(state = {}, payload = {}, actor = {}, options = {}) {
  const at = new Date(options.at || Date.now()).toISOString();
  const data = clone(state);
  const institutions = Array.isArray(data.internetNursingInstitutions) ? data.internetNursingInstitutions : [];
  const orders = Array.isArray(data.internetNursingOrders) ? data.internetNursingOrders : [];
  const policy = data.internetNursingPolicy || {};
  const institutionId = String(payload.institutionId || "").trim();
  const institution = institutions.find((item) => item.id === institutionId) || {};
  const residentId = String(payload.residentId || "").trim();
  const requesterAuthorization = authorizeCreate(actor, residentId, options, at);
  let intake;
  try {
    intake = Domain.buildNursingOrderIntakeEvidence({
      residentId,
      institutionId,
      serviceItem: String(payload.serviceItem || "").trim(),
      serviceObject: canonicalServiceObject(payload.serviceObject),
      riskLevel: String(payload.riskLevel || "medium").trim().toLowerCase(),
      note: String(payload.note || "").trim()
    }, {
      preferredAt: payload.preferredAt,
      durationMinutes: Number(payload.durationMinutes),
      district: payload.district,
      address: payload.address,
      lat: Number(payload.location?.lat ?? payload.lat),
      lng: Number(payload.location?.lng ?? payload.lng),
      locationSource: payload.location?.source || "resident-map"
    });
  } catch (error) {
    throw new InternetNursingServiceError(
      "NURSING_INTAKE_INVALID",
      "internet nursing intake contains an invalid date or field value",
      { cause: error.message },
      400
    );
  }
  const catalogResult = validateCatalogAndInstitution(intake, institution, policy);
  if (!catalogResult.ok) {
    throw new InternetNursingServiceError(
      "NURSING_INTAKE_CATALOG_INVALID",
      `internet nursing catalog validation failed: ${catalogResult.reasons.join(", ")}`,
      catalogResult
    );
  }
  const fingerprint = intakeFingerprint(intake);
  const existing = orders.find((item) => item.idempotencyKey === intake.idempotencyKey);
  if (existing) {
    if (existing.intakeFingerprint !== fingerprint) {
      throw new InternetNursingServiceError(
        "NURSING_IDEMPOTENCY_CONFLICT",
        "idempotency key was already used with a different intake payload",
        { idempotencyKey: intake.idempotencyKey, existingOrderId: existing.id }
      );
    }
    const createEventKey = `nursing:${existing.id}:create:${existing.idempotencyKey}`;
    const outboxEvent = (Array.isArray(data.internetNursingOutbox) ? data.internetNursingOutbox : [])
      .find((item) => item.idempotencyKey === createEventKey);
    if (!outboxEvent) {
      throw new InternetNursingServiceError(
        "NURSING_OUTBOX_EVENT_MISSING",
        "idempotent order replay is missing its atomic outbox event",
        { idempotencyKey: intake.idempotencyKey, existingOrderId: existing.id }
      );
    }
    assertOutboxEvent(outboxEvent);
    return { created: false, replayed: true, state: data, order: clone(existing), outboxEvent: clone(outboxEvent) };
  }
  const validation = Domain.validateNursingOrderIntake(intake, {
    now: at,
    institution,
    orders,
    maxAdvanceDays: options.maxAdvanceDays
  });
  if (!validation.ok) {
    throw new InternetNursingServiceError(
      "NURSING_INTAKE_INVALID",
      `internet nursing intake validation failed: ${validation.reasons.join(", ")}`,
      validation,
      400
    );
  }
  const order = {
    ...intake,
    id: String(options.idFactory?.() || `ino-${randomUUID()}`),
    requestedAt: at,
    status: "requested",
    sourceChannel: "internet-nursing-mobile",
    requesterAuthorization,
    intakeFingerprint: fingerprint,
    identityVerified: false,
    firstVisitAssessment: "pending",
    informedConsent: "pending",
    consentAttachment: { status: "pending", required: true, version: "internet-nursing-consent-v1" },
    locationTrace: "pending",
    locationTracePoints: [],
    serviceRecordStatus: "pending",
    serviceRecord: { status: "pending", attachments: [], attachmentCount: 0 },
    serviceAttachments: [],
    notificationReceiptSummary: { status: "pending", sent: 0, queued: 0, read: 0, failed: 0 },
    qualityCallback: "pending",
    complaintStatus: "none",
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
  data.internetNursingOrders = [order, ...orders];
  const outbox = appendOutboxEvent(data, buildOutboxEvent({
    aggregateId: order.id,
    eventType: "internet-nursing-order-created",
    occurredAt: at,
    idempotencyKey: `nursing:${order.id}:create:${order.idempotencyKey}`,
    payload: {
      orderId: order.id,
      residentId: order.residentId,
      institutionId: order.institutionId,
      serviceItem: order.serviceItem,
      status: order.status,
      requesterRole: order.requesterAuthorization.requesterRole,
      intakeFingerprint: order.intakeFingerprint,
      task: {
        targetRole: "institution",
        templateKey: "internet-nursing-appointment-submitted",
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

function transitionInternetNursingOrder(state = {}, orderId, nextStatus, actor = {}, options = {}) {
  if (Object.hasOwn(options, "enforceEvidence")) {
    throw new InternetNursingServiceError(
      "NURSING_EVIDENCE_BYPASS_FORBIDDEN",
      "evidence enforcement cannot be configured by the write-path caller",
      {},
      400
    );
  }
  const data = clone(state);
  const orders = Array.isArray(data.internetNursingOrders) ? data.internetNursingOrders : [];
  const index = orders.findIndex((item) => item.id === orderId);
  if (index < 0) {
    throw new InternetNursingServiceError("NURSING_ORDER_NOT_FOUND", "internet nursing order not found", { orderId }, 404);
  }
  if (typeof options.canAccessOrder !== "function" || options.canAccessOrder(orders[index], actor) !== true) {
    throw new InternetNursingServiceError("NURSING_ORDER_SCOPE_DENIED", "order access decision is missing or denied", { orderId }, 403);
  }
  const commandId = String(options.commandId || "").trim();
  if (!commandId) {
    throw new InternetNursingServiceError(
      "NURSING_TRANSITION_IDEMPOTENCY_REQUIRED",
      "transition command id is required",
      { orderId },
      400
    );
  }
  const actorId = String(actor.id || actor.username || actor.accountId || actor.residentId || "").trim();
  const normalizedNext = Domain.canonicalStatus(nextStatus, "nursing");
  const commandFingerprint = sha256Digest({
    orderId,
    nextStatus: normalizedNext,
    actorId,
    actorRole: String(actor.role || "").trim(),
    updates: options.updates || {}
  });
  const outboxIdempotencyKey = `nursing:${orderId}:transition:${normalizedNext}:${commandId}`;
  const existingEvent = (Array.isArray(data.internetNursingOutbox) ? data.internetNursingOutbox : [])
    .find((item) => item.idempotencyKey === outboxIdempotencyKey);
  if (existingEvent) {
    assertOutboxEvent(existingEvent);
    if (existingEvent.payload?.commandFingerprint !== commandFingerprint) {
      throw new InternetNursingServiceError(
        "NURSING_TRANSITION_IDEMPOTENCY_CONFLICT",
        "transition command id was already used with different content",
        { commandId, existingEventId: existingEvent.id }
      );
    }
    return { state: data, order: clone(orders[index]), outboxEvent: clone(existingEvent), replayed: true };
  }
  const fromStatus = orders[index].status;
  const transitioned = Domain.transitionOrder("nursing", orders[index], nextStatus, {
    at: options.at,
    actorId,
    actorRole: String(actor.role || "").trim(),
    updates: clone(options.updates || {})
  });
  orders[index] = transitioned;
  data.internetNursingOrders = orders;
  const timelineEvent = transitioned.timelineEvents?.[0] || {};
  const notificationPlan = transitioned.notificationPlans?.[0] || {};
  const outbox = appendOutboxEvent(data, buildOutboxEvent({
    aggregateId: orderId,
    eventType: "internet-nursing-order-transitioned",
    occurredAt: transitioned.updatedAt,
    idempotencyKey: outboxIdempotencyKey,
    payload: {
      orderId,
      residentId: transitioned.residentId,
      fromStatus,
      toStatus: transitioned.status,
      commandId,
      commandFingerprint,
      timelineEvent,
      notificationPlan,
      audit: {
        action: `transition:${fromStatus}->${transitioned.status}`,
        actorId,
        actorRole: String(actor.role || "").trim()
      }
    }
  }));
  return { state: data, order: clone(transitioned), outboxEvent: clone(outbox.event), replayed: false };
}

function recordInternetNursingNotificationReceipt(state = {}, orderId, messageId, details = {}, actor = {}, options = {}) {
  const data = clone(state);
  const orders = Array.isArray(data.internetNursingOrders) ? data.internetNursingOrders : [];
  const index = orders.findIndex((item) => item.id === orderId);
  if (index < 0) {
    throw new InternetNursingServiceError("NURSING_ORDER_NOT_FOUND", "internet nursing order not found", { orderId }, 404);
  }
  if (typeof options.canAccessOrder !== "function" || options.canAccessOrder(orders[index], actor) !== true) {
    throw new InternetNursingServiceError("NURSING_ORDER_SCOPE_DENIED", "order access decision is missing or denied", { orderId }, 403);
  }
  const message = (Array.isArray(orders[index].notificationPlans) ? orders[index].notificationPlans : [])
    .flatMap((plan) => Array.isArray(plan.messages) ? plan.messages : [])
    .find((item) => item.id === messageId);
  if (!message) {
    throw new InternetNursingServiceError(
      "NURSING_NOTIFICATION_MESSAGE_NOT_FOUND",
      "notification message is not bound to the order",
      { orderId, messageId },
      404
    );
  }
  const receipt = Domain.buildNotificationReceiptEvidence("nursing", orders[index], message, details, { at: options.at });
  const recorded = Domain.recordNotificationReceipt("nursing", orders[index], receipt, { at: options.at });
  orders[index] = recorded.order;
  data.internetNursingOrders = orders;
  const outboxKey = `nursing:${orderId}:notification-receipt:${receipt.idempotencyKey}`;
  const existingEvent = (Array.isArray(data.internetNursingOutbox) ? data.internetNursingOutbox : [])
    .find((item) => item.idempotencyKey === outboxKey);
  if (recorded.duplicate) {
    if (!existingEvent) {
      throw new InternetNursingServiceError(
        "NURSING_OUTBOX_EVENT_MISSING",
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
  const actorId = String(actor.id || actor.username || actor.accountId || "").trim();
  const outbox = appendOutboxEvent(data, buildOutboxEvent({
    aggregateId: orderId,
    eventType: "internet-nursing-notification-receipt-recorded",
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
        actorRole: String(actor.role || "gateway").trim()
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
  InternetNursingServiceError,
  canonicalServiceObject,
  intakeFingerprint,
  buildOutboxEvent,
  validateOutboxEvent,
  validateCatalogAndInstitution,
  createInternetNursingOrder,
  transitionInternetNursingOrder,
  recordInternetNursingNotificationReceipt
};
