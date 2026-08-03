"use strict";

const { createHash, randomUUID } = require("node:crypto");
const { createDomainEvent } = require("../../platform/events/domain-event-runtime");

const DOMAIN = "clinical-specialties";
const OUTBOX_COLLECTION = "emergencyAuditEvents";
const DELIVERY_SCHEMA = "emergency-signal-delivery.v1";
const DELIVERY_EVENT_TYPE = "clinical-specialties.emergency-signal-delivery-state.v1";
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_RETRY_BASE_MS = 1_000;
const DEFAULT_RETRY_MAX_MS = 15 * 60_000;
let deliveryWriteTail = Promise.resolve();

class EmergencySignalDeliveryError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = "EmergencySignalDeliveryError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function isoAt(value, label = "time") {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) {
    throw new EmergencySignalDeliveryError(
      "EMERGENCY_SIGNAL_DELIVERY_TIME_INVALID",
      `${label} must be a valid timestamp`
    );
  }
  return new Date(parsed).toISOString();
}

function requiredText(value, label, maxLength = 200) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > maxLength) {
    throw new EmergencySignalDeliveryError(
      "EMERGENCY_SIGNAL_DELIVERY_FIELD_INVALID",
      `${label} is required and must not exceed ${maxLength} characters`
    );
  }
  return normalized;
}

function payloadDigest(row) {
  return `sha256:${sha256(stableStringify({
    id: row.id,
    domain: row.domain,
    type: row.type,
    aggregateId: row.aggregateId,
    aggregateVersion: row.aggregateVersion,
    correlationId: row.correlationId,
    causationId: row.causationId,
    occurredAt: row.occurredAt,
    payload: row.payload
  }))}`;
}

function domainEventFromOutboxRow(row) {
  return createDomainEvent({
    id: row.id,
    domain: row.domain,
    type: row.type,
    aggregateId: row.aggregateId,
    aggregateVersion: row.aggregateVersion,
    correlationId: row.correlationId,
    causationId: row.causationId,
    occurredAt: row.occurredAt,
    payload: row.payload
  });
}

function deliveryDigest(delivery = {}) {
  const { digest: _digest, ...payload } = delivery;
  return `sha256:${sha256(stableStringify(payload))}`;
}

function seal(delivery) {
  delivery.digest = deliveryDigest(delivery);
  return delivery;
}

function appendHistory(delivery, action, from, to, at, detail = {}) {
  delivery.history = Array.isArray(delivery.history) ? delivery.history : [];
  delivery.history.push({
    action,
    from,
    to,
    at,
    attempt: delivery.attempts,
    generation: delivery.generation,
    ...detail
  });
}

function createEmergencySignalDelivery(row, options = {}) {
  const createdAt = isoAt(options.now || row.occurredAt || new Date().toISOString(), "createdAt");
  const maxAttempts = Math.min(100, Math.max(1, Number(options.maxAttempts) || DEFAULT_MAX_ATTEMPTS));
  return seal({
    schema: DELIVERY_SCHEMA,
    eventId: requiredText(row.id, "eventId"),
    payloadDigest: payloadDigest(row),
    status: "pending",
    attempts: 0,
    maxAttempts,
    generation: 1,
    nextAttemptAt: createdAt,
    leaseOwner: "",
    leaseToken: "",
    leaseExpiresAt: "",
    publishedAt: "",
    deadLetteredAt: "",
    lastErrorCode: "",
    lastErrorDigest: "",
    receipt: null,
    replayHistory: [],
    history: [{
      action: "enqueue",
      from: "none",
      to: "pending",
      at: createdAt,
      attempt: 0,
      generation: 1
    }],
    productionReady: false
  });
}

function ensureDelivery(row, options = {}) {
  if (row.delivery?.schema === DELIVERY_SCHEMA) {
    if (
      row.delivery.digest !== deliveryDigest(row.delivery)
      || row.delivery.eventId !== row.id
      || row.delivery.payloadDigest !== payloadDigest(row)
    ) {
      throw new EmergencySignalDeliveryError(
        "EMERGENCY_SIGNAL_DELIVERY_INTEGRITY_INVALID",
        "emergency signal delivery state or its bound event failed integrity validation",
        409
      );
    }
    return row.delivery;
  }
  row.delivery = createEmergencySignalDelivery(row, options);
  return row.delivery;
}

function deliveryRows(data = {}) {
  return (Array.isArray(data[OUTBOX_COLLECTION]) ? data[OUTBOX_COLLECTION] : [])
    .filter((row) =>
      row?.action === "domain-event-outbox"
      && row?.owner === DOMAIN
      && row?.id
    );
}

function findDelivery(data, eventId) {
  const normalized = requiredText(eventId, "eventId");
  const row = deliveryRows(data).find((item) => item.id === normalized);
  if (!row) {
    throw new EmergencySignalDeliveryError(
      "EMERGENCY_SIGNAL_DELIVERY_NOT_FOUND",
      "emergency signal delivery was not found",
      404
    );
  }
  return { row, delivery: ensureDelivery(row) };
}

function clearLease(delivery) {
  delivery.leaseOwner = "";
  delivery.leaseToken = "";
  delivery.leaseExpiresAt = "";
}

function expireLease(delivery, now) {
  if (delivery.status !== "processing" || Date.parse(delivery.leaseExpiresAt) > Date.parse(now)) return;
  const from = delivery.status;
  clearLease(delivery);
  if (delivery.attempts >= delivery.maxAttempts) {
    delivery.status = "dead-letter";
    delivery.deadLetteredAt = now;
  } else {
    delivery.status = "pending";
    delivery.nextAttemptAt = now;
  }
  appendHistory(delivery, "lease-expired", from, delivery.status, now);
  seal(delivery);
}

function claimEmergencySignalDeliveries(data, options = {}) {
  const workerId = requiredText(options.workerId, "workerId");
  const now = isoAt(options.now || new Date().toISOString(), "now");
  const limit = Math.min(100, Math.max(1, Number(options.limit) || 10));
  const leaseMs = Math.min(15 * 60_000, Math.max(1_000, Number(options.leaseMs) || DEFAULT_LEASE_MS));
  const candidates = [];
  for (const row of deliveryRows(data)) {
    const delivery = ensureDelivery(row, { now });
    expireLease(delivery, now);
    row.outboxStatus = delivery.status;
    if (
      delivery.status === "pending"
      && delivery.attempts < delivery.maxAttempts
      && Date.parse(delivery.nextAttemptAt) <= Date.parse(now)
    ) {
      candidates.push({ row, delivery });
    }
  }
  candidates.sort((left, right) =>
    Date.parse(left.delivery.nextAttemptAt) - Date.parse(right.delivery.nextAttemptAt)
    || left.delivery.eventId.localeCompare(right.delivery.eventId));
  return candidates.slice(0, limit).map(({ row, delivery }) => {
    const from = delivery.status;
    delivery.status = "processing";
    delivery.attempts += 1;
    delivery.leaseOwner = workerId;
    delivery.leaseToken = `lease-${randomUUID()}`;
    delivery.leaseExpiresAt = new Date(Date.parse(now) + leaseMs).toISOString();
    row.outboxStatus = "processing";
    appendHistory(delivery, "claim", from, "processing", now, { workerId });
    seal(delivery);
    return Object.freeze({
      eventId: delivery.eventId,
      attempt: delivery.attempts,
      generation: delivery.generation,
      workerId,
      leaseToken: delivery.leaseToken,
      leaseExpiresAt: delivery.leaseExpiresAt,
      payloadDigest: delivery.payloadDigest,
      event: domainEventFromOutboxRow(row)
    });
  });
}

function requireLease(delivery, claim, now) {
  const at = isoAt(now || new Date().toISOString(), "now");
  if (delivery.status !== "processing") {
    throw new EmergencySignalDeliveryError(
      "EMERGENCY_SIGNAL_DELIVERY_NOT_CLAIMED",
      "emergency signal delivery is not processing",
      409
    );
  }
  if (
    delivery.leaseOwner !== requiredText(claim.workerId, "workerId")
    || delivery.leaseToken !== requiredText(claim.leaseToken, "leaseToken")
    || delivery.attempts !== Number(claim.attempt)
    || delivery.generation !== Number(claim.generation)
  ) {
    throw new EmergencySignalDeliveryError(
      "EMERGENCY_SIGNAL_DELIVERY_LEASE_CONFLICT",
      "emergency signal delivery lease no longer belongs to this worker",
      409
    );
  }
  if (Date.parse(delivery.leaseExpiresAt) <= Date.parse(at)) {
    throw new EmergencySignalDeliveryError(
      "EMERGENCY_SIGNAL_DELIVERY_LEASE_EXPIRED",
      "emergency signal delivery lease has expired",
      409
    );
  }
  return at;
}

function normalizeReceipt(receipt, delivery) {
  const normalized = {
    status: String(receipt?.status || "").trim().toLowerCase(),
    providerMessageId: requiredText(receipt?.providerMessageId, "providerMessageId"),
    eventId: requiredText(receipt?.eventId, "receipt.eventId"),
    payloadDigest: requiredText(receipt?.payloadDigest, "receipt.payloadDigest"),
    receivedAt: isoAt(receipt?.receivedAt, "receipt.receivedAt"),
    transportVerified: receipt?.transportVerified === true,
    signatureVerified: receipt?.signatureVerified === true,
    productionEvidence: false
  };
  if (
    !["accepted", "delivered"].includes(normalized.status)
    || normalized.eventId !== delivery.eventId
    || normalized.payloadDigest !== delivery.payloadDigest
    || !normalized.transportVerified
    || !normalized.signatureVerified
  ) {
    throw new EmergencySignalDeliveryError(
      "EMERGENCY_SIGNAL_DELIVERY_RECEIPT_INVALID",
      "delivery receipt must be verified and bound to the emergency signal event",
      409
    );
  }
  return {
    ...normalized,
    receiptDigest: `sha256:${sha256(stableStringify(normalized))}`
  };
}

function acknowledgeEmergencySignalDelivery(data, claim, receipt, options = {}) {
  const { row, delivery } = findDelivery(data, claim.eventId);
  const normalized = normalizeReceipt(receipt, delivery);
  if (delivery.status === "published") {
    if (delivery.receipt?.receiptDigest !== normalized.receiptDigest) {
      throw new EmergencySignalDeliveryError(
        "EMERGENCY_SIGNAL_DELIVERY_ACK_CONFLICT",
        "published emergency signal delivery has a different receipt",
        409
      );
    }
    return Object.freeze({ duplicate: true, status: "published", receipt: structuredClone(delivery.receipt) });
  }
  const at = requireLease(delivery, claim, options.now || normalized.receivedAt);
  const from = delivery.status;
  delivery.status = "published";
  row.outboxStatus = "published";
  delivery.publishedAt = at;
  delivery.receipt = normalized;
  clearLease(delivery);
  appendHistory(delivery, "ack", from, "published", at, {
    receiptDigest: normalized.receiptDigest
  });
  seal(delivery);
  return Object.freeze({ duplicate: false, status: "published", receipt: structuredClone(normalized) });
}

function failEmergencySignalDelivery(data, claim, failure = {}, options = {}) {
  const { row, delivery } = findDelivery(data, claim.eventId);
  const at = requireLease(delivery, claim, options.now);
  const errorCode = requiredText(failure.errorCode || "DELIVERY_FAILED", "errorCode", 80);
  const retryBaseMs = Math.max(100, Number(options.retryBaseMs) || DEFAULT_RETRY_BASE_MS);
  const retryMaxMs = Math.max(retryBaseMs, Number(options.retryMaxMs) || DEFAULT_RETRY_MAX_MS);
  const from = delivery.status;
  delivery.lastErrorCode = errorCode;
  delivery.lastErrorDigest = `sha256:${sha256(String(failure.message || errorCode))}`;
  clearLease(delivery);
  if (delivery.attempts >= delivery.maxAttempts) {
    delivery.status = "dead-letter";
    delivery.deadLetteredAt = at;
  } else {
    delivery.status = "pending";
    const delay = Math.min(retryMaxMs, retryBaseMs * (2 ** Math.max(0, delivery.attempts - 1)));
    delivery.nextAttemptAt = new Date(Date.parse(at) + delay).toISOString();
  }
  appendHistory(delivery, "fail", from, delivery.status, at, { errorCode });
  row.outboxStatus = delivery.status;
  seal(delivery);
  return Object.freeze({
    status: delivery.status,
    attempts: delivery.attempts,
    nextAttemptAt: delivery.nextAttemptAt,
    deadLetteredAt: delivery.deadLetteredAt
  });
}

function replayEmergencySignalDelivery(data, eventId, input = {}, actor = {}, options = {}) {
  if (actor.role !== "commission") {
    throw new EmergencySignalDeliveryError(
      "EMERGENCY_SIGNAL_DELIVERY_REPLAY_FORBIDDEN",
      "dead-letter replay requires a commission operator",
      403
    );
  }
  const { row, delivery } = findDelivery(data, eventId);
  const idempotencyKey = requiredText(input.idempotencyKey, "idempotencyKey");
  const idempotencyKeyDigest = `sha256:${sha256(idempotencyKey)}`;
  const reason = requiredText(input.reason, "reason", 240);
  const replayDigest = `sha256:${sha256(stableStringify({ idempotencyKey, reason }))}`;
  const existing = delivery.replayHistory.find(
    (item) => item.idempotencyKeyDigest === idempotencyKeyDigest
  );
  if (existing) {
    if (existing.replayDigest !== replayDigest) {
      throw new EmergencySignalDeliveryError(
        "EMERGENCY_SIGNAL_DELIVERY_REPLAY_CONFLICT",
        "replay idempotency key was used with a different reason",
        409
      );
    }
    return Object.freeze({
      duplicate: true,
      status: existing.result.status,
      generation: existing.result.generation
    });
  }
  if (delivery.status !== "dead-letter") {
    throw new EmergencySignalDeliveryError(
      "EMERGENCY_SIGNAL_DELIVERY_REPLAY_STATE_INVALID",
      "only dead-letter emergency signal deliveries can be replayed",
      409
    );
  }
  const at = isoAt(options.now || new Date().toISOString(), "now");
  const from = delivery.status;
  const result = Object.freeze({
    duplicate: false,
    status: "pending",
    generation: delivery.generation + 1
  });
  delivery.replayHistory.push({
    idempotencyKeyDigest,
    replayDigest,
    reasonDigest: `sha256:${sha256(reason)}`,
    actor: String(actor.username || actor.name || actor.role).slice(0, 160),
    at,
    fromGeneration: delivery.generation,
    result: {
      status: result.status,
      generation: result.generation
    }
  });
  delivery.status = "pending";
  row.outboxStatus = "pending";
  delivery.attempts = 0;
  delivery.generation += 1;
  delivery.nextAttemptAt = at;
  delivery.deadLetteredAt = "";
  delivery.lastErrorCode = "";
  delivery.lastErrorDigest = "";
  delivery.receipt = null;
  clearLease(delivery);
  appendHistory(delivery, "replay", from, "pending", at);
  seal(delivery);
  return result;
}

function listEmergencySignalDeliveries(data, options = {}) {
  const status = String(options.status || "").trim();
  const limit = Math.min(200, Math.max(1, Number(options.limit) || 100));
  const all = deliveryRows(data).map((row) => {
    const delivery = ensureDelivery(row);
    return {
      eventId: delivery.eventId,
      status: delivery.status,
      attempts: delivery.attempts,
      maxAttempts: delivery.maxAttempts,
      generation: delivery.generation,
      nextAttemptAt: delivery.nextAttemptAt,
      publishedAt: delivery.publishedAt,
      deadLetteredAt: delivery.deadLetteredAt,
      lastErrorCode: delivery.lastErrorCode,
      replayCount: delivery.replayHistory.length,
      receiptDigest: delivery.receipt?.receiptDigest || "",
      productionReady: false
    };
  });
  const counts = { pending: 0, processing: 0, published: 0, "dead-letter": 0 };
  all.forEach((item) => { counts[item.status] += 1; });
  return Object.freeze({
    summary: Object.freeze({
      total: all.length,
      ...counts,
      healthy: counts["dead-letter"] === 0
    }),
    deliveries: Object.freeze(
      all.filter((item) => !status || item.status === status)
        .sort((left, right) => left.eventId.localeCompare(right.eventId))
        .slice(0, limit)
        .map(Object.freeze)
    ),
    productionReady: false,
    boundary: "Emergency signal delivery is local operational evidence; database CAS, trusted transport and external receipt verification remain required."
  });
}

function withDeliveryWriteLock(work) {
  const pending = deliveryWriteTail.then(work, work);
  deliveryWriteTail = pending.then(() => undefined, () => undefined);
  return pending;
}

function transactEmergencySignalDelivery({ readDatabase, writeDatabase, event = DELIVERY_EVENT_TYPE }, mutator) {
  if (typeof readDatabase !== "function" || typeof writeDatabase !== "function" || typeof mutator !== "function") {
    throw new EmergencySignalDeliveryError(
      "EMERGENCY_SIGNAL_DELIVERY_REPOSITORY_REQUIRED",
      "delivery transaction requires readDatabase, writeDatabase and a mutator",
      503
    );
  }
  return withDeliveryWriteLock(async () => {
    const data = structuredClone(readDatabase());
    const before = stableStringify(data);
    const result = await mutator(data);
    if (stableStringify(data) !== before) {
      writeDatabase(data, {
        event,
        owner: DOMAIN,
        unitOfWork: true,
        productionReady: false
      });
    }
    return result;
  });
}

module.exports = {
  DELIVERY_EVENT_TYPE,
  DELIVERY_SCHEMA,
  EmergencySignalDeliveryError,
  acknowledgeEmergencySignalDelivery,
  claimEmergencySignalDeliveries,
  createEmergencySignalDelivery,
  ensureDelivery,
  failEmergencySignalDelivery,
  listEmergencySignalDeliveries,
  replayEmergencySignalDelivery,
  stableStringify,
  transactEmergencySignalDelivery
};
