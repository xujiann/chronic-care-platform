"use strict";

const NursingService = require("./internet-nursing-service");
const EscortService = require("./escort-service");
const Runtime = require("./care-service-runtime");

const DOMAIN_SERVICE = Object.freeze({
  nursing: Object.freeze({
    orders: "internetNursingOrders",
    outbox: "internetNursingOutbox",
    create: NursingService.createInternetNursingOrder,
    transition: NursingService.transitionInternetNursingOrder,
    receipt: NursingService.recordInternetNursingNotificationReceipt
  }),
  escort: Object.freeze({
    orders: "escortServiceOrders",
    outbox: "escortServiceOutbox",
    create: EscortService.createEscortOrder,
    transition: EscortService.transitionEscortOrder,
    receipt: EscortService.recordEscortNotificationReceipt
  })
});

class CareServicePlatformError extends Error {
  constructor(code, message, details = {}, statusCode = 400) {
    super(message);
    this.name = "CareServicePlatformError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function text(value, max = 200) {
  return String(value || "").trim().slice(0, max);
}

function domainService(value) {
  const domain = text(value, 20).toLowerCase();
  const service = DOMAIN_SERVICE[domain];
  if (!service) {
    throw new CareServicePlatformError(
      "CARE_PLATFORM_DOMAIN_INVALID",
      "care-service domain must be nursing or escort",
      { domain },
      400
    );
  }
  return { domain, service };
}

function actorIdentity(actor = {}) {
  const id = text(actor.id || actor.username || actor.accountId || actor.residentId, 120);
  const role = text(actor.role, 40).toLowerCase();
  if (!id || !role) {
    throw new CareServicePlatformError(
      "CARE_PLATFORM_ACTOR_REQUIRED",
      "authenticated actor identity and role are required",
      {},
      401
    );
  }
  return { ...actor, id, role };
}

function commandId(input = {}) {
  const value = text(input.commandId || input.idempotencyKey, 160);
  if (!value) {
    throw new CareServicePlatformError(
      "CARE_PLATFORM_COMMAND_ID_REQUIRED",
      "request command id is required",
      {},
      400
    );
  }
  return value;
}

function createCareServicePlatformAdapter(dependencies = {}) {
  const repository = dependencies.repository;
  if (!repository || typeof repository.transaction !== "function") {
    throw new CareServicePlatformError(
      "CARE_PLATFORM_REPOSITORY_REQUIRED",
      "platform adapter requires a transactional repository",
      {},
      503
    );
  }
  const access = dependencies.access || {};
  const clock = typeof dependencies.now === "function" ? dependencies.now : () => new Date().toISOString();

  function accessResident(residentId, actor) {
    return typeof access.canAccessResident === "function"
      && access.canAccessResident(residentId, actor) === true;
  }

  function accessOrder(domain, order, actor) {
    return typeof access.canAccessOrder === "function"
      && access.canAccessOrder(domain, order, actor) === true;
  }

  function createOptions(actor, input) {
    const allowedResidentIds = typeof access.allowedResidentIdsFor === "function"
      ? access.allowedResidentIdsFor(actor)
      : [];
    return {
      at: input.at || clock(),
      idFactory: dependencies.idFactory,
      maxAdvanceDays: input.maxAdvanceDays,
      allowedResidentIds: Array.isArray(allowedResidentIds) ? allowedResidentIds : [],
      authorizationReceiptFor: typeof access.authorizationReceiptFor === "function"
        ? (residentId) => access.authorizationReceiptFor(residentId, actor)
        : undefined,
      canAccessResident: accessResident
    };
  }

  async function createOrder(domainValue, payload = {}, actorValue = {}, input = {}) {
    const { domain, service } = domainService(domainValue);
    const actor = actorIdentity(actorValue);
    const requestCommandId = commandId(input);
    return Runtime.executeTransactionalCommand(
      repository,
      (state) => service.create(state, payload, actor, createOptions(actor, input)),
      {
        commandId: `${domain}:create:${requestCommandId}`,
        collections: [service.orders, service.outbox]
      }
    );
  }

  async function transitionOrder(domainValue, orderIdValue, nextStatus, actorValue = {}, input = {}) {
    const { domain, service } = domainService(domainValue);
    const actor = actorIdentity(actorValue);
    const orderId = text(orderIdValue, 200);
    if (!orderId) throw new CareServicePlatformError("CARE_PLATFORM_ORDER_ID_REQUIRED", "order id is required");
    if (Object.hasOwn(input, "enforceEvidence") || Object.hasOwn(input.updates || {}, "enforceEvidence")) {
      throw new CareServicePlatformError(
        "CARE_PLATFORM_EVIDENCE_BYPASS_FORBIDDEN",
        "public platform calls cannot configure evidence enforcement",
        {},
        400
      );
    }
    const requestCommandId = commandId(input);
    return Runtime.executeTransactionalCommand(
      repository,
      (state) => service.transition(state, orderId, nextStatus, actor, {
        at: input.at || clock(),
        commandId: requestCommandId,
        updates: input.updates || {},
        canAccessOrder: (order) => accessOrder(domain, order, actor)
      }),
      {
        commandId: `${domain}:transition:${orderId}:${requestCommandId}`,
        collections: [service.orders, service.outbox]
      }
    );
  }

  async function recordNotificationReceipt(domainValue, orderIdValue, messageIdValue, details = {}, actorValue = {}, input = {}) {
    const { domain, service } = domainService(domainValue);
    const actor = actorIdentity(actorValue);
    const orderId = text(orderIdValue, 200);
    const messageId = text(messageIdValue, 300);
    if (!orderId || !messageId) {
      throw new CareServicePlatformError(
        "CARE_PLATFORM_NOTIFICATION_BINDING_REQUIRED",
        "order and notification message ids are required"
      );
    }
    const requestCommandId = commandId(input);
    return Runtime.executeTransactionalCommand(
      repository,
      (state) => service.receipt(state, orderId, messageId, details, actor, {
        at: input.at || clock(),
        canAccessOrder: (order) => accessOrder(domain, order, actor)
      }),
      {
        commandId: `${domain}:notification:${orderId}:${requestCommandId}`,
        collections: [service.orders, service.outbox]
      }
    );
  }

  async function requeueDeadLetter(domainValue, eventId, actorValue = {}, input = {}) {
    const { domain } = domainService(domainValue);
    const actor = actorIdentity(actorValue);
    const requestCommandId = commandId(input);
    return Runtime.executeTransactionalCommand(
      repository,
      (state) => Runtime.requeueDeadLetter(state, domain, eventId, actor, {
        at: input.at || clock(),
        confirmation: input.confirmation,
        evidenceRef: input.evidenceRef
      }),
      {
        commandId: `care-outbox:requeue:${domain}:${text(eventId, 240)}:${requestCommandId}`,
        collections: [
          DOMAIN_SERVICE[domain].outbox,
          "careServiceOutboxDeadLetters"
        ]
      }
    );
  }

  async function readOutboxHealth(input = {}) {
    return repository.transaction(async (transaction) => {
      if (!transaction || typeof transaction.readState !== "function") {
        throw new CareServicePlatformError(
          "CARE_PLATFORM_READ_CONTRACT_INVALID",
          "repository transaction must provide readState",
          {},
          503
        );
      }
      const snapshot = await transaction.readState();
      const state = snapshot?.state && typeof snapshot.state === "object" ? snapshot.state : snapshot;
      return Runtime.buildOutboxHealth(state, {
        at: input.at || clock(),
        maxPendingAgeSeconds: input.maxPendingAgeSeconds,
        domains: input.domains
      });
    });
  }

  async function runOutboxWorker(input = {}) {
    const workerId = text(input.workerId || process.env.CARE_OUTBOX_WORKER_ID, 120);
    const runId = text(input.runId, 160);
    return Runtime.runTransactionalOutboxWorker(repository, dependencies.deliveryAdapters || {}, {
      at: input.at || clock(),
      workerId,
      runId,
      batchSize: input.batchSize,
      leaseSeconds: input.leaseSeconds,
      maxAttempts: input.maxAttempts,
      retryBaseSeconds: input.retryBaseSeconds,
      maxRetrySeconds: input.maxRetrySeconds,
      domains: input.domains
    });
  }

  return {
    createOrder,
    transitionOrder,
    recordNotificationReceipt,
    requeueDeadLetter,
    readOutboxHealth,
    runOutboxWorker
  };
}

function errorResponse(error) {
  const status = Number(error?.statusCode || error?.status || 500);
  const safeStatus = Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
  return {
    status: safeStatus,
    body: {
      ok: false,
      error: safeStatus >= 500 ? "Service Unavailable" : "Request Rejected",
      code: text(error?.code || "CARE_PLATFORM_ERROR", 100),
      message: text(error?.message || "care-service operation failed", 300),
      details: safeErrorDetails(error?.details)
    }
  };
}

function safeErrorDetails(details) {
  if (!details || typeof details !== "object" || Array.isArray(details)) return {};
  const allowed = new Set([
    "reasons", "missing", "allowed", "current", "next", "status",
    "confirmationRequired", "domains"
  ]);
  return Object.fromEntries(Object.entries(details)
    .filter(([key]) => allowed.has(key))
    .map(([key, value]) => {
      if (Array.isArray(value)) return [key, value.slice(0, 20).map((item) => text(item, 120))];
      if (typeof value === "boolean" || typeof value === "number") return [key, value];
      return [key, text(value, 160)];
    }));
}

module.exports = {
  CareServicePlatformError,
  createCareServicePlatformAdapter,
  safeErrorDetails,
  errorResponse
};
