"use strict";

const { createHash, randomUUID } = require("node:crypto");
const { ContractRegistry } = require("../../platform/contracts/contract-registry");
const {
  IdempotentEventConsumer,
  createDomainEvent
} = require("../../platform/events/domain-event-runtime");

const CONSUMER = "integration";
const PLATFORM_CONTRACT_ID = "clinical-result.v1";
const EVENT_TYPE = "integration.clinical-result-received.v1";
const DELIVERY_EVENT_TYPE = "integration.clinical-result-delivery-state.v1";
const DELIVERY_SCHEMA = "clinical-result-delivery.v1";
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_RETRY_BASE_MS = 1_000;
const DEFAULT_RETRY_MAX_MS = 15 * 60_000;
const SUPPORTED_EXTERNAL_CONTRACTS = new Set(["lis-report-v1", "pacs-report-v1"]);
let deliveryWriteTail = Promise.resolve();

class ClinicalResultExchangeError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = "ClinicalResultExchangeError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function externalBody(payload) {
  const nested = payload?.payload && typeof payload.payload === "object" && !Array.isArray(payload.payload)
    ? payload.payload
    : {};
  return { ...nested, ...payload };
}

function createClinicalResultRegistry() {
  return new ContractRegistry().registerAntiCorruptionAdapter({
    contractId: PLATFORM_CONTRACT_ID,
    consumer: CONSUMER,
    fromExternal(payload) {
      const body = externalBody(payload);
      const pacs = body.contractId === "pacs-report-v1";
      return {
        resultId: body.externalId === undefined ? undefined : String(body.externalId).trim(),
        residentId: body.residentId === undefined ? undefined : String(body.residentId).trim(),
        resultType: pacs ? "imaging" : "laboratory",
        status: String(body.status || "received").trim(),
        sourceSystem: pacs ? "PACS" : "LIS",
        item: String(body.item || body.modality || "").trim(),
        result: String(body.result || body.conclusion || "").trim(),
        reportedAt: String(body.reportedAt || "").trim()
      };
    },
    toExternal(value) {
      return {
        externalId: value.resultId,
        residentId: value.residentId,
        resultType: value.resultType,
        status: value.status,
        sourceSystem: value.sourceSystem,
        item: value.item,
        result: value.result,
        reportedAt: value.reportedAt
      };
    }
  });
}

const registry = createClinicalResultRegistry();

function supportsExternalContract(contractId) {
  return SUPPORTED_EXTERNAL_CONTRACTS.has(String(contractId || ""));
}

function deterministicId(prefix, externalContractId, idempotencyKey) {
  const digest = createHash("sha256")
    .update(`${externalContractId}:${idempotencyKey}`)
    .digest("hex");
  return `${prefix}-${digest.slice(0, 32)}`;
}

function canonicalDigest(canonical) {
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function clone(value) {
  return structuredClone(value);
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function isoAt(value, label = "time") {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) {
    throw new ClinicalResultExchangeError(
      "CLINICAL_RESULT_DELIVERY_TIME_INVALID",
      `${label} must be a valid timestamp`
    );
  }
  return new Date(parsed).toISOString();
}

function requiredText(value, label, maxLength = 160) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > maxLength) {
    throw new ClinicalResultExchangeError(
      "CLINICAL_RESULT_DELIVERY_FIELD_INVALID",
      `${label} is required and must not exceed ${maxLength} characters`
    );
  }
  return normalized;
}

function deliveryDigest(outbox = {}) {
  const { digest: _digest, ...payload } = outbox;
  return `sha256:${sha256(stableStringify(payload))}`;
}

function sealDelivery(outbox) {
  outbox.digest = deliveryDigest(outbox);
  return outbox;
}

function appendDeliveryHistory(outbox, action, from, to, at, detail = {}) {
  outbox.history = Array.isArray(outbox.history) ? outbox.history : [];
  outbox.history.push({
    action,
    from,
    to,
    at,
    attempt: outbox.attempts,
    generation: outbox.generation,
    ...detail
  });
  outbox.history = outbox.history.slice(-100);
}

function createDeliveryOutbox(domainEvent, payloadDigest, at = new Date().toISOString(), options = {}) {
  const createdAt = isoAt(at, "createdAt");
  const maxAttempts = Math.min(100, Math.max(1, Number(options.maxAttempts) || DEFAULT_MAX_ATTEMPTS));
  return sealDelivery({
    schema: DELIVERY_SCHEMA,
    eventId: domainEvent.id,
    type: domainEvent.type,
    payloadDigest,
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
    deliveryReceipt: null,
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

function ensureDeliveryOutbox(event, options = {}) {
  if (!event?.domainEvent?.id || event.platformContractId !== PLATFORM_CONTRACT_ID) return null;
  if (event.outbox?.schema === DELIVERY_SCHEMA) {
    if (event.outbox.digest !== deliveryDigest(event.outbox)) {
      throw new ClinicalResultExchangeError(
        "CLINICAL_RESULT_DELIVERY_INTEGRITY_INVALID",
        `delivery state integrity check failed for ${event.domainEvent.id}`,
        409
      );
    }
    return event.outbox;
  }
  const at = event.contractReceipt?.receivedAt || event.domainEvent.occurredAt || options.now || new Date().toISOString();
  event.outbox = createDeliveryOutbox(
    event.domainEvent,
    event.contractReceipt?.canonicalDigest || canonicalDigest(event.canonicalPayload || event.domainEvent.payload),
    at,
    options
  );
  return event.outbox;
}

function deliveryEvents(data = {}) {
  return (Array.isArray(data.integrationGatewayEvents) ? data.integrationGatewayEvents : [])
    .filter((event) => event?.platformContractId === PLATFORM_CONTRACT_ID && event?.domainEvent?.id);
}

function clearLease(outbox) {
  outbox.leaseOwner = "";
  outbox.leaseToken = "";
  outbox.leaseExpiresAt = "";
}

function transitionExpiredLease(outbox, now) {
  if (outbox.status !== "processing" || Date.parse(outbox.leaseExpiresAt) > Date.parse(now)) return;
  const from = outbox.status;
  clearLease(outbox);
  if (outbox.attempts >= outbox.maxAttempts) {
    outbox.status = "dead-letter";
    outbox.deadLetteredAt = now;
    appendDeliveryHistory(outbox, "lease-expired", from, "dead-letter", now);
  } else {
    outbox.status = "pending";
    outbox.nextAttemptAt = now;
    appendDeliveryHistory(outbox, "lease-expired", from, "pending", now);
  }
  sealDelivery(outbox);
}

function claimClinicalResultDeliveries(data, options = {}) {
  const workerId = requiredText(options.workerId, "workerId");
  const now = isoAt(options.now || new Date().toISOString(), "now");
  const limit = Math.min(100, Math.max(1, Number(options.limit) || 10));
  const leaseMs = Math.min(15 * 60_000, Math.max(1_000, Number(options.leaseMs) || DEFAULT_LEASE_MS));
  const candidates = [];
  for (const event of deliveryEvents(data)) {
    const outbox = ensureDeliveryOutbox(event, { now });
    transitionExpiredLease(outbox, now);
    if (outbox.status === "pending" && outbox.attempts >= outbox.maxAttempts) {
      const from = outbox.status;
      outbox.status = "dead-letter";
      outbox.deadLetteredAt = now;
      appendDeliveryHistory(outbox, "attempts-exhausted", from, "dead-letter", now);
      sealDelivery(outbox);
    }
    if (outbox.status === "pending" && Date.parse(outbox.nextAttemptAt) <= Date.parse(now)) {
      candidates.push({ event, outbox });
    }
  }
  candidates.sort((left, right) =>
    Date.parse(left.outbox.nextAttemptAt) - Date.parse(right.outbox.nextAttemptAt)
    || left.outbox.eventId.localeCompare(right.outbox.eventId));
  return candidates.slice(0, limit).map(({ event, outbox }) => {
    const from = outbox.status;
    outbox.status = "processing";
    outbox.attempts += 1;
    outbox.leaseOwner = workerId;
    outbox.leaseToken = `lease-${randomUUID()}`;
    outbox.leaseExpiresAt = new Date(Date.parse(now) + leaseMs).toISOString();
    appendDeliveryHistory(outbox, "claim", from, "processing", now, { workerId });
    sealDelivery(outbox);
    return Object.freeze({
      eventId: outbox.eventId,
      attempt: outbox.attempts,
      generation: outbox.generation,
      workerId,
      leaseToken: outbox.leaseToken,
      leaseExpiresAt: outbox.leaseExpiresAt,
      payloadDigest: outbox.payloadDigest,
      event: clone(event.domainEvent)
    });
  });
}

function findDelivery(data, eventId) {
  const normalizedId = requiredText(eventId, "eventId", 200);
  const event = deliveryEvents(data).find((item) => item.domainEvent.id === normalizedId);
  if (!event) {
    throw new ClinicalResultExchangeError(
      "CLINICAL_RESULT_DELIVERY_NOT_FOUND",
      "clinical result delivery was not found",
      404
    );
  }
  return { event, outbox: ensureDeliveryOutbox(event) };
}

function requireActiveLease(outbox, claim = {}, now = new Date().toISOString()) {
  const evaluatedAt = isoAt(now, "now");
  if (outbox.status !== "processing") {
    throw new ClinicalResultExchangeError(
      "CLINICAL_RESULT_DELIVERY_NOT_CLAIMED",
      "clinical result delivery is not processing",
      409
    );
  }
  if (
    outbox.leaseOwner !== requiredText(claim.workerId, "workerId")
    || outbox.leaseToken !== requiredText(claim.leaseToken, "leaseToken", 200)
    || outbox.attempts !== Number(claim.attempt)
    || outbox.generation !== Number(claim.generation)
  ) {
    throw new ClinicalResultExchangeError(
      "CLINICAL_RESULT_DELIVERY_LEASE_CONFLICT",
      "clinical result delivery lease no longer belongs to this worker",
      409
    );
  }
  if (Date.parse(outbox.leaseExpiresAt) <= Date.parse(evaluatedAt)) {
    throw new ClinicalResultExchangeError(
      "CLINICAL_RESULT_DELIVERY_LEASE_EXPIRED",
      "clinical result delivery lease has expired",
      409
    );
  }
  return evaluatedAt;
}

function normalizedDeliveryReceipt(receipt = {}, outbox) {
  const status = String(receipt.status || "").trim().toLowerCase();
  const providerMessageId = requiredText(receipt.providerMessageId, "providerMessageId", 200);
  const eventId = requiredText(receipt.eventId, "receipt.eventId", 200);
  const payloadDigest = requiredText(receipt.payloadDigest, "receipt.payloadDigest", 100);
  const receivedAt = isoAt(receipt.receivedAt, "receipt.receivedAt");
  if (!["accepted", "delivered"].includes(status)
    || eventId !== outbox.eventId
    || payloadDigest !== outbox.payloadDigest
    || receipt.transportVerified !== true
    || receipt.signatureVerified !== true) {
    throw new ClinicalResultExchangeError(
      "CLINICAL_RESULT_DELIVERY_RECEIPT_INVALID",
      "delivery receipt must be accepted, transport and signature verified, and bound to the event payload",
      409
    );
  }
  const normalized = {
    status,
    providerMessageId,
    eventId,
    payloadDigest,
    receivedAt,
    transportVerified: true,
    signatureVerified: true,
    productionEvidence: false
  };
  return {
    ...normalized,
    receiptDigest: `sha256:${sha256(stableStringify(normalized))}`
  };
}

function acknowledgeClinicalResultDelivery(data, claim, receipt, options = {}) {
  const { outbox } = findDelivery(data, claim.eventId);
  const normalizedReceipt = normalizedDeliveryReceipt(receipt, outbox);
  if (outbox.status === "published") {
    if (outbox.deliveryReceipt?.receiptDigest !== normalizedReceipt.receiptDigest) {
      throw new ClinicalResultExchangeError(
        "CLINICAL_RESULT_DELIVERY_ACK_CONFLICT",
        "published delivery was acknowledged with a different receipt",
        409
      );
    }
    return Object.freeze({ duplicate: true, status: outbox.status, receipt: clone(outbox.deliveryReceipt) });
  }
  const at = requireActiveLease(outbox, claim, options.now || receipt.receivedAt);
  const from = outbox.status;
  outbox.status = "published";
  outbox.publishedAt = at;
  outbox.deliveryReceipt = normalizedReceipt;
  clearLease(outbox);
  appendDeliveryHistory(outbox, "ack", from, "published", at, {
    providerReceiptDigest: normalizedReceipt.receiptDigest
  });
  sealDelivery(outbox);
  return Object.freeze({ duplicate: false, status: outbox.status, receipt: clone(normalizedReceipt) });
}

function failClinicalResultDelivery(data, claim, failure = {}, options = {}) {
  const { outbox } = findDelivery(data, claim.eventId);
  const at = requireActiveLease(outbox, claim, options.now || new Date().toISOString());
  const errorCode = requiredText(failure.errorCode || "DELIVERY_FAILED", "errorCode", 80);
  const retryBaseMs = Math.max(100, Number(options.retryBaseMs) || DEFAULT_RETRY_BASE_MS);
  const retryMaxMs = Math.max(retryBaseMs, Number(options.retryMaxMs) || DEFAULT_RETRY_MAX_MS);
  const from = outbox.status;
  outbox.lastErrorCode = errorCode;
  outbox.lastErrorDigest = `sha256:${sha256(String(failure.message || errorCode))}`;
  clearLease(outbox);
  if (outbox.attempts >= outbox.maxAttempts) {
    outbox.status = "dead-letter";
    outbox.deadLetteredAt = at;
  } else {
    outbox.status = "pending";
    const delay = Math.min(retryMaxMs, retryBaseMs * (2 ** Math.max(0, outbox.attempts - 1)));
    outbox.nextAttemptAt = new Date(Date.parse(at) + delay).toISOString();
  }
  appendDeliveryHistory(outbox, "fail", from, outbox.status, at, { errorCode });
  sealDelivery(outbox);
  return Object.freeze({
    status: outbox.status,
    attempts: outbox.attempts,
    nextAttemptAt: outbox.nextAttemptAt,
    deadLetteredAt: outbox.deadLetteredAt,
    errorCode
  });
}

function replayClinicalResultDelivery(data, eventId, input = {}, actor = {}, options = {}) {
  if (actor.role !== "commission") {
    throw new ClinicalResultExchangeError(
      "CLINICAL_RESULT_DELIVERY_REPLAY_FORBIDDEN",
      "dead-letter replay requires a commission operator",
      403
    );
  }
  const { outbox } = findDelivery(data, eventId);
  const idempotencyKey = requiredText(input.idempotencyKey, "idempotencyKey", 200);
  const reason = requiredText(input.reason, "reason", 240);
  const at = isoAt(options.now || new Date().toISOString(), "now");
  const replayDigest = `sha256:${sha256(stableStringify({ idempotencyKey, reason }))}`;
  const existing = (outbox.replayHistory || []).find((item) => item.idempotencyKey === idempotencyKey);
  if (existing) {
    if (existing.replayDigest !== replayDigest) {
      throw new ClinicalResultExchangeError(
        "CLINICAL_RESULT_DELIVERY_REPLAY_CONFLICT",
        "replay idempotency key was used with a different reason",
        409
      );
    }
    return Object.freeze({ duplicate: true, status: outbox.status, generation: outbox.generation });
  }
  if (outbox.status !== "dead-letter") {
    throw new ClinicalResultExchangeError(
      "CLINICAL_RESULT_DELIVERY_REPLAY_STATE_INVALID",
      "only dead-letter clinical result deliveries can be replayed",
      409
    );
  }
  const from = outbox.status;
  outbox.replayHistory = [...(outbox.replayHistory || []), {
    idempotencyKey,
    replayDigest,
    reasonDigest: `sha256:${sha256(reason)}`,
    actor: String(actor.username || actor.name || actor.role).slice(0, 160),
    at,
    fromGeneration: outbox.generation
  }].slice(-20);
  outbox.status = "pending";
  outbox.attempts = 0;
  outbox.generation += 1;
  outbox.nextAttemptAt = at;
  outbox.deadLetteredAt = "";
  outbox.lastErrorCode = "";
  outbox.lastErrorDigest = "";
  outbox.deliveryReceipt = null;
  clearLease(outbox);
  appendDeliveryHistory(outbox, "replay", from, "pending", at, {
    operator: String(actor.username || actor.name || actor.role).slice(0, 160)
  });
  sealDelivery(outbox);
  return Object.freeze({ duplicate: false, status: outbox.status, generation: outbox.generation });
}

function listClinicalResultDeliveries(data, options = {}) {
  const status = String(options.status || "").trim();
  const limit = Math.min(200, Math.max(1, Number(options.limit) || 100));
  const rows = deliveryEvents(data).map((event) => {
    const outbox = ensureDeliveryOutbox(event);
    return {
      eventId: outbox.eventId,
      status: outbox.status,
      attempts: outbox.attempts,
      maxAttempts: outbox.maxAttempts,
      generation: outbox.generation,
      nextAttemptAt: outbox.nextAttemptAt,
      leaseOwner: outbox.status === "processing" ? outbox.leaseOwner : "",
      leaseExpiresAt: outbox.status === "processing" ? outbox.leaseExpiresAt : "",
      publishedAt: outbox.publishedAt,
      deadLetteredAt: outbox.deadLetteredAt,
      lastErrorCode: outbox.lastErrorCode,
      replayCount: outbox.replayHistory.length,
      receiptDigest: outbox.deliveryReceipt?.receiptDigest || "",
      productionReady: false
    };
  }).filter((item) => !status || item.status === status)
    .sort((left, right) => left.eventId.localeCompare(right.eventId))
    .slice(0, limit);
  const statuses = { pending: 0, processing: 0, published: 0, "dead-letter": 0 };
  for (const event of deliveryEvents(data)) statuses[ensureDeliveryOutbox(event).status] += 1;
  return Object.freeze({
    summary: Object.freeze({
      total: Object.values(statuses).reduce((sum, value) => sum + value, 0),
      ...statuses,
      healthy: statuses["dead-letter"] === 0
    }),
    deliveries: Object.freeze(rows.map(Object.freeze)),
    productionReady: false,
    boundary: "Delivery state is local operational evidence only; external transport, signature and credential acceptance remain required."
  });
}

function withDeliveryWriteLock(work) {
  const pending = deliveryWriteTail.then(work, work);
  deliveryWriteTail = pending.then(() => undefined, () => undefined);
  return pending;
}

function transactClinicalResultDelivery({ readDatabase, writeDatabase, event = DELIVERY_EVENT_TYPE }, mutator) {
  if (typeof readDatabase !== "function" || typeof writeDatabase !== "function" || typeof mutator !== "function") {
    throw new ClinicalResultExchangeError(
      "CLINICAL_RESULT_DELIVERY_REPOSITORY_REQUIRED",
      "delivery transaction requires readDatabase, writeDatabase and a mutator",
      503
    );
  }
  return withDeliveryWriteLock(async () => {
    const data = clone(readDatabase());
    const before = stableStringify(data);
    const result = await mutator(data);
    if (stableStringify(data) !== before) {
      writeDatabase(data, {
        event,
        productionReady: false
      });
    }
    return result;
  });
}

async function receiveClinicalResult({
  data,
  payload,
  contract,
  user,
  correlationId,
  normalizeIntegrationEvent,
  prependAuditTrailEntry,
  writeDatabase
}) {
  if (!supportsExternalContract(contract?.id)) {
    throw new TypeError(`unsupported clinical result exchange contract: ${contract?.id || ""}`);
  }
  const canonical = registry.decode(PLATFORM_CONTRACT_ID, CONSUMER, payload);
  const blankRequired = ["resultId", "residentId", "resultType", "status"]
    .filter((field) => !String(canonical[field] || "").trim());
  if (blankRequired.length) {
    throw new TypeError(`${PLATFORM_CONTRACT_ID} has blank fields: ${blankRequired.join(", ")}`);
  }
  const intentDigest = canonicalDigest(canonical);
  const eventId = deterministicId("evt", contract.id, payload.idempotencyKey);
  const receiptId = deterministicId("rcpt", contract.id, payload.idempotencyKey);
  const domainEvent = createDomainEvent({
    id: eventId,
    domain: "integration",
    type: EVENT_TYPE,
    aggregateId: canonical.resultId,
    aggregateVersion: 1,
    correlationId,
    causationId: payload.idempotencyKey,
    payload: {
      contractId: PLATFORM_CONTRACT_ID,
      externalContractId: contract.id,
      resultId: canonical.resultId,
      residentId: canonical.residentId,
      resultType: canonical.resultType,
      status: canonical.status
    }
  });
  let acceptedEvent = null;
  const consumer = new IdempotentEventConsumer({
    name: "clinical-result-exchange-inbox",
    inbox: {
      async claim(key) {
        return !(data.integrationGatewayEvents || []).some((item) =>
          item.inbox?.key === key
          || item.domainEvent?.id === domainEvent.id
          || (
            item.contractId === contract.id
            && item.idempotencyKey === payload.idempotencyKey
          )
        );
      },
      async complete(key) {
        if (acceptedEvent) {
          acceptedEvent.inbox = {
            ...acceptedEvent.inbox,
            key,
            status: "completed",
            completedAt: new Date().toISOString()
          };
        }
      }
    },
    async handler() {
      const receivedAt = new Date().toISOString();
      acceptedEvent = {
        ...normalizeIntegrationEvent(payload, user, contract),
        platformContractId: PLATFORM_CONTRACT_ID,
        platformContractVersion: registry.get(PLATFORM_CONTRACT_ID).version,
        canonicalPayload: canonical,
        domainEvent,
        inbox: {
          key: `clinical-result-exchange-inbox:${domainEvent.id}`,
          status: "processing",
          claimedAt: receivedAt
        },
        outbox: createDeliveryOutbox(domainEvent, intentDigest, receivedAt),
        contractReceipt: {
          id: receiptId,
          status: "accepted",
          contractId: PLATFORM_CONTRACT_ID,
          externalContractId: contract.id,
          canonicalDigest: intentDigest,
          receivedAt,
          productionEvidence: false
        }
      };
      data.integrationGatewayEvents = [
        acceptedEvent,
        ...(Array.isArray(data.integrationGatewayEvents) ? data.integrationGatewayEvents : [])
      ];
    }
  });
  const consumed = await consumer.consume(domainEvent);
  if (!consumed.processed) {
    const existing = (data.integrationGatewayEvents || []).find((item) =>
      item.domainEvent?.id === domainEvent.id
      || (item.contractId === contract.id && item.idempotencyKey === payload.idempotencyKey)
    );
    if (!existing || existing.contractReceipt?.canonicalDigest !== intentDigest) {
      throw new ClinicalResultExchangeError(
        "CLINICAL_RESULT_IDEMPOTENCY_CONFLICT",
        "Idempotency-Key was already used with a different clinical result payload",
        409
      );
    }
    return Object.freeze({
      duplicate: true,
      event: Object.freeze({ ...existing, idempotentReplay: true }),
      receipt: existing?.contractReceipt || null
    });
  }
  data.securityEvents = prependAuditTrailEntry(data.securityEvents, {
    id: domainEvent.id,
    at: domainEvent.occurredAt,
    actor: user.name,
    role: user.role,
    action: "接收临床结果契约",
    target: `${contract.domain}/${canonical.resultId}`,
    result: "允许",
    detail: `${PLATFORM_CONTRACT_ID} · ${contract.id} · ${receiptId}`,
    antiCorruptionAdapter: {
      contractId: PLATFORM_CONTRACT_ID,
      consumer: CONSUMER,
      externalContractId: contract.id
    },
    inbox: acceptedEvent.inbox,
    outbox: acceptedEvent.outbox,
    receiptId
  });
  writeDatabase(data, {
    event: EVENT_TYPE,
    integrationContract: {
      contractId: PLATFORM_CONTRACT_ID,
      externalContractId: contract.id,
      receiptId,
      idempotent: true
    }
  });
  return Object.freeze({
    duplicate: false,
    event: Object.freeze(acceptedEvent),
    receipt: Object.freeze(acceptedEvent.contractReceipt)
  });
}

module.exports = {
  ClinicalResultExchangeError,
  CONSUMER,
  DELIVERY_EVENT_TYPE,
  DELIVERY_SCHEMA,
  EVENT_TYPE,
  PLATFORM_CONTRACT_ID,
  acknowledgeClinicalResultDelivery,
  canonicalDigest,
  claimClinicalResultDeliveries,
  createClinicalResultRegistry,
  createDeliveryOutbox,
  deterministicId,
  ensureDeliveryOutbox,
  failClinicalResultDelivery,
  listClinicalResultDeliveries,
  receiveClinicalResult,
  replayClinicalResultDelivery,
  stableStringify,
  transactClinicalResultDelivery,
  supportsExternalContract
};
