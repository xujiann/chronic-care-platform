"use strict";

const NursingService = require("./internet-nursing-service");
const EscortService = require("./escort-service");

const RUNTIME_POLICY_VERSION = "care-service-runtime-v1";
const DEAD_LETTER_CONFIRMATION = "REQUEUE CARE SERVICE DEAD LETTER";
const DOMAIN_CONFIG = Object.freeze({
  nursing: Object.freeze({
    collection: "internetNursingOutbox",
    validate: NursingService.validateOutboxEvent
  }),
  escort: Object.freeze({
    collection: "escortServiceOutbox",
    validate: EscortService.validateOutboxEvent
  })
});

class CareServiceRuntimeError extends Error {
  constructor(code, message, details = {}, statusCode = 409) {
    super(message);
    this.name = "CareServiceRuntimeError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function text(value, max = 240) {
  return String(value || "").trim().replace(/[\r\n\t]+/g, " ").slice(0, max);
}

function isoAt(value) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) {
    throw new CareServiceRuntimeError("CARE_RUNTIME_TIME_INVALID", "runtime timestamp is invalid", { value }, 400);
  }
  return new Date(parsed).toISOString();
}

function positiveInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function runtimeOptions(options = {}) {
  return {
    maxAttempts: positiveInteger(options.maxAttempts, 5, 1, 20),
    leaseSeconds: positiveInteger(options.leaseSeconds, 60, 5, 900),
    retryBaseSeconds: positiveInteger(options.retryBaseSeconds, 30, 1, 3600),
    maxRetrySeconds: positiveInteger(options.maxRetrySeconds, 1800, 30, 86400),
    batchSize: positiveInteger(options.batchSize, 20, 1, 100),
    maxPendingAgeSeconds: positiveInteger(options.maxPendingAgeSeconds, 300, 30, 86400)
  };
}

function normalizeDomains(domains) {
  const values = Array.isArray(domains) && domains.length ? domains : Object.keys(DOMAIN_CONFIG);
  const normalized = [...new Set(values.map((item) => text(item, 20).toLowerCase()))];
  const invalid = normalized.filter((item) => !DOMAIN_CONFIG[item]);
  if (invalid.length) {
    throw new CareServiceRuntimeError(
      "CARE_RUNTIME_DOMAIN_INVALID",
      `unsupported care-service domain: ${invalid.join(", ")}`,
      { domains: invalid },
      400
    );
  }
  return normalized;
}

function assertEventIntegrity(domain, event) {
  const integrity = DOMAIN_CONFIG[domain].validate(event);
  if (!integrity.ok) {
    throw new CareServiceRuntimeError(
      "CARE_OUTBOX_INTEGRITY_INVALID",
      `care-service outbox event is invalid: ${integrity.reasons.join(", ")}`,
      { domain, eventId: text(event?.id, 200), reasons: integrity.reasons }
    );
  }
  return integrity;
}

function eventRows(data, domain) {
  const collection = DOMAIN_CONFIG[domain].collection;
  if (!Array.isArray(data[collection])) data[collection] = [];
  return data[collection];
}

function eligibleForClaim(event, atMs) {
  if (event.status === "pending") return true;
  if (event.status === "retry") {
    const nextAttemptAt = Date.parse(String(event.nextAttemptAt || ""));
    return Number.isFinite(nextAttemptAt) && nextAttemptAt <= atMs;
  }
  if (event.status === "processing") {
    const leaseExpiresAt = Date.parse(String(event.leaseExpiresAt || ""));
    return Number.isFinite(leaseExpiresAt) && leaseExpiresAt <= atMs;
  }
  return false;
}

function appendDeliveryHistory(event, entry) {
  event.deliveryHistory = [entry, ...(Array.isArray(event.deliveryHistory) ? event.deliveryHistory : [])].slice(0, 20);
}

function claimOutboxEvents(state = {}, options = {}) {
  const workerId = text(options.workerId, 120);
  if (!workerId) {
    throw new CareServiceRuntimeError("CARE_OUTBOX_WORKER_REQUIRED", "outbox worker identity is required", {}, 400);
  }
  const at = isoAt(options.at || new Date().toISOString());
  const atMs = Date.parse(at);
  const config = runtimeOptions(options);
  const domains = normalizeDomains(options.domains);
  const data = clone(state);
  const candidates = [];
  for (const domain of domains) {
    for (const event of eventRows(data, domain)) {
      assertEventIntegrity(domain, event);
      if (eligibleForClaim(event, atMs)) {
        candidates.push({
          domain,
          event,
          occurredAt: Date.parse(String(event.occurredAt || "")) || 0
        });
      }
    }
  }
  candidates.sort((left, right) => left.occurredAt - right.occurredAt || left.event.id.localeCompare(right.event.id));
  const claimed = candidates.slice(0, config.batchSize).map(({ domain, event }) => {
    const previousStatus = event.status;
    const previousWorkerId = text(event.claimedBy, 120);
    event.status = "processing";
    event.attempts = Number(event.attempts || 0) + 1;
    event.claimedBy = workerId;
    event.claimedAt = at;
    event.leaseExpiresAt = new Date(atMs + config.leaseSeconds * 1000).toISOString();
    event.nextAttemptAt = "";
    event.updatedAt = at;
    event.runtimePolicyVersion = RUNTIME_POLICY_VERSION;
    appendDeliveryHistory(event, {
      at,
      action: previousStatus === "processing" ? "lease-reclaimed" : "claimed",
      workerId,
      attempt: event.attempts,
      previousStatus,
      previousWorkerId
    });
    return {
      domain,
      eventId: event.id,
      aggregateId: event.aggregateId,
      eventType: event.eventType,
      payloadDigest: event.payloadDigest,
      attempt: event.attempts,
      leaseExpiresAt: event.leaseExpiresAt,
      workerId
    };
  });
  return { state: data, claimed, config, at };
}

function findClaimedEvent(data, domain, eventId, workerId) {
  const event = eventRows(data, domain).find((item) => item.id === eventId);
  if (!event) {
    throw new CareServiceRuntimeError("CARE_OUTBOX_EVENT_NOT_FOUND", "outbox event was not found", { domain, eventId }, 404);
  }
  assertEventIntegrity(domain, event);
  if (event.status !== "processing") {
    throw new CareServiceRuntimeError(
      "CARE_OUTBOX_EVENT_NOT_PROCESSING",
      "outbox event is not processing",
      { domain, eventId, status: event.status }
    );
  }
  if (!workerId || event.claimedBy !== workerId) {
    throw new CareServiceRuntimeError(
      "CARE_OUTBOX_LEASE_OWNER_MISMATCH",
      "outbox event lease belongs to another worker",
      { domain, eventId },
      403
    );
  }
  return event;
}

function recordOutboxDelivery(state = {}, claim = {}, receipt = {}, options = {}) {
  const domain = normalizeDomains([claim.domain])[0];
  const eventId = text(claim.eventId, 240);
  const workerId = text(options.workerId || claim.workerId, 120);
  const at = isoAt(options.at || receipt.occurredAt || new Date().toISOString());
  const data = clone(state);
  const event = findClaimedEvent(data, domain, eventId, workerId);
  if (claim.payloadDigest !== event.payloadDigest || Number(claim.attempt) !== Number(event.attempts)) {
    throw new CareServiceRuntimeError(
      "CARE_OUTBOX_CLAIM_BINDING_INVALID",
      "delivery claim no longer matches the event attempt or payload",
      { domain, eventId }
    );
  }
  const status = text(receipt.status, 40).toLowerCase();
  const providerMessageId = text(receipt.providerMessageId, 200);
  if (!["accepted", "sent", "delivered"].includes(status) || !providerMessageId) {
    throw new CareServiceRuntimeError(
      "CARE_OUTBOX_DELIVERY_RECEIPT_INVALID",
      "delivery receipt requires an accepted status and provider message id",
      { domain, eventId, status },
      400
    );
  }
  event.status = "delivered";
  event.deliveredAt = at;
  event.updatedAt = at;
  event.leaseExpiresAt = "";
  event.nextAttemptAt = "";
  event.lastError = null;
  event.deliveryReceipt = {
    status,
    providerMessageId,
    providerCode: text(receipt.providerCode, 80),
    occurredAt: at,
    payloadDigest: event.payloadDigest,
    workerId,
    policyVersion: RUNTIME_POLICY_VERSION
  };
  appendDeliveryHistory(event, {
    at,
    action: "delivered",
    workerId,
    attempt: event.attempts,
    providerMessageId
  });
  return { state: data, event: clone(event), delivered: true };
}

function retryDelaySeconds(attempts, config) {
  return Math.min(config.maxRetrySeconds, config.retryBaseSeconds * (2 ** Math.max(0, attempts - 1)));
}

function recordOutboxFailure(state = {}, claim = {}, failure = {}, options = {}) {
  const domain = normalizeDomains([claim.domain])[0];
  const eventId = text(claim.eventId, 240);
  const workerId = text(options.workerId || claim.workerId, 120);
  const at = isoAt(options.at || new Date().toISOString());
  const atMs = Date.parse(at);
  const config = runtimeOptions(options);
  const data = clone(state);
  const event = findClaimedEvent(data, domain, eventId, workerId);
  if (claim.payloadDigest !== event.payloadDigest || Number(claim.attempt) !== Number(event.attempts)) {
    throw new CareServiceRuntimeError(
      "CARE_OUTBOX_CLAIM_BINDING_INVALID",
      "failure claim no longer matches the event attempt or payload",
      { domain, eventId }
    );
  }
  const errorCode = text(failure.code || "DELIVERY_FAILED", 80);
  const errorMessage = "care-service event delivery failed; inspect restricted provider logs using the error code";
  const deadLetter = event.attempts >= config.maxAttempts;
  const nextAttemptAt = deadLetter
    ? ""
    : new Date(atMs + retryDelaySeconds(event.attempts, config) * 1000).toISOString();
  event.status = deadLetter ? "dead-letter" : "retry";
  event.updatedAt = at;
  event.leaseExpiresAt = "";
  event.nextAttemptAt = nextAttemptAt;
  event.lastError = { code: errorCode, message: errorMessage, at };
  appendDeliveryHistory(event, {
    at,
    action: deadLetter ? "dead-lettered" : "retry-scheduled",
    workerId,
    attempt: event.attempts,
    errorCode,
    nextAttemptAt
  });
  if (deadLetter) {
    const ledger = Array.isArray(data.careServiceOutboxDeadLetters) ? data.careServiceOutboxDeadLetters : [];
    const ledgerId = `${domain}:${event.id}:dead-letter:${event.attempts}`;
    if (!ledger.some((item) => item.id === ledgerId)) {
      data.careServiceOutboxDeadLetters = [{
        id: ledgerId,
        domain,
        eventId: event.id,
        aggregateId: event.aggregateId,
        eventType: event.eventType,
        payloadDigest: event.payloadDigest,
        attempts: event.attempts,
        errorCode,
        status: "open",
        openedAt: at,
        resolvedAt: "",
        resolutionEvidenceRef: "",
        policyVersion: RUNTIME_POLICY_VERSION
      }, ...ledger].slice(0, 1000);
    }
  }
  return {
    state: data,
    event: clone(event),
    deadLetter,
    nextAttemptAt
  };
}

function requeueDeadLetter(state = {}, domainValue, eventIdValue, actor = {}, options = {}) {
  const domain = normalizeDomains([domainValue])[0];
  const eventId = text(eventIdValue, 240);
  const actorRole = text(actor.role, 40).toLowerCase();
  const actorId = text(actor.id || actor.username || actor.accountId, 120);
  if (!new Set(["commission", "institution"]).has(actorRole) || !actorId) {
    throw new CareServiceRuntimeError(
      "CARE_DEAD_LETTER_REQUEUE_DENIED",
      "dead-letter requeue requires an authenticated operations role",
      { actorRole },
      403
    );
  }
  const confirmation = text(options.confirmation, 120);
  const evidenceRef = text(options.evidenceRef, 300);
  if (confirmation !== DEAD_LETTER_CONFIRMATION || !evidenceRef) {
    throw new CareServiceRuntimeError(
      "CARE_DEAD_LETTER_CONFIRMATION_REQUIRED",
      "dead-letter requeue requires exact confirmation and resolution evidence",
      { confirmationRequired: DEAD_LETTER_CONFIRMATION },
      400
    );
  }
  const at = isoAt(options.at || new Date().toISOString());
  const data = clone(state);
  const event = eventRows(data, domain).find((item) => item.id === eventId);
  if (!event) {
    throw new CareServiceRuntimeError("CARE_OUTBOX_EVENT_NOT_FOUND", "outbox event was not found", { domain, eventId }, 404);
  }
  assertEventIntegrity(domain, event);
  if (event.status !== "dead-letter") {
    throw new CareServiceRuntimeError(
      "CARE_OUTBOX_EVENT_NOT_DEAD_LETTER",
      "only dead-letter events can be requeued",
      { domain, eventId, status: event.status }
    );
  }
  event.totalAttempts = Number(event.totalAttempts || 0) + Number(event.attempts || 0);
  event.attempts = 0;
  event.status = "pending";
  event.nextAttemptAt = "";
  event.claimedBy = "";
  event.claimedAt = "";
  event.leaseExpiresAt = "";
  event.lastError = null;
  event.updatedAt = at;
  event.requeueGeneration = Number(event.requeueGeneration || 0) + 1;
  appendDeliveryHistory(event, {
    at,
    action: "dead-letter-requeued",
    actorId,
    actorRole,
    evidenceRef,
    generation: event.requeueGeneration
  });
  const ledger = Array.isArray(data.careServiceOutboxDeadLetters) ? data.careServiceOutboxDeadLetters : [];
  const openRows = ledger.filter((item) => item.domain === domain && item.eventId === eventId && item.status === "open");
  for (const item of openRows) {
    item.status = "resolved";
    item.resolvedAt = at;
    item.resolvedBy = actorId;
    item.resolutionEvidenceRef = evidenceRef;
  }
  data.careServiceOutboxDeadLetters = ledger;
  return { state: data, event: clone(event), resolvedDeadLetters: openRows.length };
}

function buildOutboxHealth(state = {}, options = {}) {
  const at = isoAt(options.at || new Date().toISOString());
  const atMs = Date.parse(at);
  const config = runtimeOptions(options);
  const domains = normalizeDomains(options.domains);
  const rows = [];
  const integrityFailures = [];
  for (const domain of domains) {
    for (const event of Array.isArray(state[DOMAIN_CONFIG[domain].collection]) ? state[DOMAIN_CONFIG[domain].collection] : []) {
      const integrity = DOMAIN_CONFIG[domain].validate(event);
      if (!integrity.ok) integrityFailures.push({ domain, eventId: text(event.id, 200), reasons: integrity.reasons });
      rows.push({ domain, event });
    }
  }
  const pending = rows.filter(({ event }) => ["pending", "retry", "processing"].includes(event.status));
  const deadLetters = rows.filter(({ event }) => event.status === "dead-letter");
  const staleLeases = rows.filter(({ event }) => event.status === "processing"
    && Number.isFinite(Date.parse(String(event.leaseExpiresAt || "")))
    && Date.parse(event.leaseExpiresAt) <= atMs);
  const overdue = pending.filter(({ event }) => {
    const occurredAt = Date.parse(String(event.occurredAt || ""));
    return Number.isFinite(occurredAt) && atMs - occurredAt > config.maxPendingAgeSeconds * 1000;
  });
  const byDomain = Object.fromEntries(domains.map((domain) => {
    const domainRows = rows.filter((row) => row.domain === domain);
    return [domain, {
      total: domainRows.length,
      pending: domainRows.filter(({ event }) => ["pending", "retry", "processing"].includes(event.status)).length,
      delivered: domainRows.filter(({ event }) => event.status === "delivered").length,
      deadLetters: domainRows.filter(({ event }) => event.status === "dead-letter").length
    }];
  }));
  return {
    ok: integrityFailures.length === 0 && deadLetters.length === 0 && staleLeases.length === 0 && overdue.length === 0,
    generatedAt: at,
    policyVersion: RUNTIME_POLICY_VERSION,
    summary: {
      total: rows.length,
      pending: pending.length,
      delivered: rows.filter(({ event }) => event.status === "delivered").length,
      deadLetters: deadLetters.length,
      staleLeases: staleLeases.length,
      overdue: overdue.length,
      integrityFailures: integrityFailures.length
    },
    byDomain,
    integrityFailures,
    blockerEventIds: [...new Set([
      ...deadLetters.map(({ event }) => event.id),
      ...staleLeases.map(({ event }) => event.id),
      ...overdue.map(({ event }) => event.id),
      ...integrityFailures.map((item) => item.eventId)
    ])]
  };
}

async function runOutboxWorker(state = {}, adapters = {}, options = {}) {
  const workerId = text(options.workerId, 120);
  const claimedResult = claimOutboxEvents(state, { ...options, workerId });
  let data = claimedResult.state;
  const results = [];
  for (const claim of claimedResult.claimed) {
    const adapter = adapters[claim.domain] || adapters.deliver;
    if (typeof adapter !== "function") {
      const failed = recordOutboxFailure(data, claim, {
        code: "DELIVERY_ADAPTER_MISSING",
        message: `delivery adapter is not configured for ${claim.domain}`
      }, { ...options, workerId });
      data = failed.state;
      results.push({
        ...claim,
        status: failed.deadLetter ? "dead-letter" : "retry",
        errorCode: "DELIVERY_ADAPTER_MISSING"
      });
      continue;
    }
    const event = eventRows(data, claim.domain).find((item) => item.id === claim.eventId);
    try {
      const receipt = await adapter(clone(event), {
        domain: claim.domain,
        workerId,
        attempt: claim.attempt,
        idempotencyKey: event.idempotencyKey,
        payloadDigest: event.payloadDigest
      });
      const delivered = recordOutboxDelivery(data, claim, receipt, { ...options, workerId });
      data = delivered.state;
      results.push({ ...claim, status: "delivered", providerMessageId: delivered.event.deliveryReceipt.providerMessageId });
    } catch (error) {
      const failed = recordOutboxFailure(data, claim, {
        code: text(error?.code || "DELIVERY_FAILED", 80),
        message: text(error?.message || "delivery failed", 240)
      }, { ...options, workerId });
      data = failed.state;
      results.push({ ...claim, status: failed.deadLetter ? "dead-letter" : "retry", errorCode: failed.event.lastError.code });
    }
  }
  return {
    state: data,
    claimed: claimedResult.claimed.length,
    delivered: results.filter((item) => item.status === "delivered").length,
    retried: results.filter((item) => item.status === "retry").length,
    deadLetters: results.filter((item) => item.status === "dead-letter").length,
    results,
    health: buildOutboxHealth(data, options)
  };
}

async function executeTransactionalCommand(repository, command, options = {}) {
  if (!repository || typeof repository.transaction !== "function") {
    throw new CareServiceRuntimeError(
      "CARE_TRANSACTION_REPOSITORY_REQUIRED",
      "repository must provide a transaction callback",
      {},
      503
    );
  }
  if (typeof command !== "function") {
    throw new CareServiceRuntimeError("CARE_TRANSACTION_COMMAND_REQUIRED", "transaction command is required", {}, 400);
  }
  const commandId = text(options.commandId, 160);
  if (!commandId) {
    throw new CareServiceRuntimeError(
      "CARE_TRANSACTION_COMMAND_ID_REQUIRED",
      "transaction command id is required",
      {},
      400
    );
  }
  return repository.transaction(async (transaction) => {
    if (!transaction || typeof transaction.readState !== "function" || typeof transaction.writeState !== "function") {
      throw new CareServiceRuntimeError(
        "CARE_TRANSACTION_CONTRACT_INVALID",
        "transaction must provide readState and writeState",
        {},
        503
      );
    }
    const snapshot = await transaction.readState();
    const sourceState = snapshot?.state && typeof snapshot.state === "object" ? snapshot.state : snapshot;
    const expectedVersion = snapshot?.version;
    const result = await command(clone(sourceState), { commandId, expectedVersion });
    if (!result || !result.state || typeof result.state !== "object") {
      throw new CareServiceRuntimeError(
        "CARE_TRANSACTION_RESULT_INVALID",
        "transaction command must return a state object",
        { commandId }
      );
    }
    const writeResult = await transaction.writeState(result.state, {
      expectedVersion,
      commandId,
      collections: options.collections || []
    });
    return {
      ...result,
      ...(options.includeState === true ? {} : { state: undefined }),
      committed: true,
      commandId,
      version: writeResult?.version ?? expectedVersion
    };
  });
}

async function runTransactionalOutboxWorker(repository, adapters = {}, options = {}) {
  const workerId = text(options.workerId, 120);
  const runId = text(options.runId, 160);
  if (!workerId || !runId) {
    throw new CareServiceRuntimeError(
      "CARE_TRANSACTIONAL_WORKER_IDENTITY_REQUIRED",
      "transactional outbox worker requires workerId and runId",
      {},
      400
    );
  }
  const collections = [
    "internetNursingOutbox",
    "escortServiceOutbox",
    "careServiceOutboxDeadLetters"
  ];
  const claimResult = await executeTransactionalCommand(
    repository,
    (source) => {
      const claimed = claimOutboxEvents(source, options);
      const deliveryEvents = claimed.claimed.map((claim) => {
        const event = eventRows(claimed.state, claim.domain).find((item) => item.id === claim.eventId);
        return { claim, event: clone(event) };
      });
      return {
        state: claimed.state,
        claimed: claimed.claimed,
        deliveryEvents
      };
    },
    {
      commandId: `care-outbox:${workerId}:${runId}:claim`,
      collections
    }
  );
  const results = [];
  for (const delivery of claimResult.deliveryEvents || []) {
    const { claim, event } = delivery;
    const adapter = adapters[claim.domain] || adapters.deliver;
    let receipt = null;
    let failure = null;
    if (typeof adapter !== "function") {
      failure = {
        code: "DELIVERY_ADAPTER_MISSING",
        message: `delivery adapter is not configured for ${claim.domain}`
      };
    } else {
      try {
        receipt = await adapter(clone(event), {
          domain: claim.domain,
          workerId,
          runId,
          attempt: claim.attempt,
          idempotencyKey: event.idempotencyKey,
          payloadDigest: event.payloadDigest
        });
      } catch (error) {
        failure = {
          code: text(error?.code || "DELIVERY_FAILED", 80),
          message: text(error?.message || "delivery failed", 240)
        };
      }
    }
    if (failure) {
      const failed = await executeTransactionalCommand(
        repository,
        (source) => {
          const recorded = recordOutboxFailure(source, claim, failure, options);
          return {
            state: recorded.state,
            eventId: claim.eventId,
            status: recorded.deadLetter ? "dead-letter" : "retry",
            errorCode: recorded.event.lastError.code
          };
        },
        {
          commandId: `care-outbox:${workerId}:${runId}:failure:${claim.domain}:${claim.eventId}:${claim.attempt}`,
          collections
        }
      );
      results.push({ ...claim, status: failed.status, errorCode: failed.errorCode });
      continue;
    }
    const delivered = await executeTransactionalCommand(
      repository,
      (source) => {
        const recorded = recordOutboxDelivery(source, claim, receipt, options);
        return {
          state: recorded.state,
          eventId: claim.eventId,
          status: "delivered",
          providerMessageId: recorded.event.deliveryReceipt.providerMessageId
        };
      },
      {
        commandId: `care-outbox:${workerId}:${runId}:success:${claim.domain}:${claim.eventId}:${claim.attempt}`,
        collections
      }
    );
    results.push({
      ...claim,
      status: "delivered",
      providerMessageId: delivered.providerMessageId
    });
  }
  return {
    runId,
    workerId,
    claimed: claimResult.claimed?.length || 0,
    delivered: results.filter((item) => item.status === "delivered").length,
    retried: results.filter((item) => item.status === "retry").length,
    deadLetters: results.filter((item) => item.status === "dead-letter").length,
    results
  };
}

module.exports = {
  RUNTIME_POLICY_VERSION,
  DEAD_LETTER_CONFIRMATION,
  CareServiceRuntimeError,
  runtimeOptions,
  claimOutboxEvents,
  recordOutboxDelivery,
  recordOutboxFailure,
  requeueDeadLetter,
  buildOutboxHealth,
  runOutboxWorker,
  executeTransactionalCommand,
  runTransactionalOutboxWorker
};
