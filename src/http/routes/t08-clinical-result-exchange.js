"use strict";

const { createHash } = require("node:crypto");
const { ContractRegistry } = require("../../platform/contracts/contract-registry");
const {
  IdempotentEventConsumer,
  createDomainEvent
} = require("../../platform/events/domain-event-runtime");

const CONSUMER = "integration";
const PLATFORM_CONTRACT_ID = "clinical-result.v1";
const EVENT_TYPE = "integration.clinical-result-received.v1";
const SUPPORTED_EXTERNAL_CONTRACTS = new Set(["lis-report-v1", "pacs-report-v1"]);

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
        outbox: {
          eventId: domainEvent.id,
          type: domainEvent.type,
          status: "pending"
        },
        contractReceipt: {
          id: receiptId,
          status: "accepted",
          contractId: PLATFORM_CONTRACT_ID,
          externalContractId: contract.id,
          canonicalDigest: canonicalDigest(canonical),
          receivedAt,
          productionEvidence: false
        }
      };
      data.integrationGatewayEvents = [
        acceptedEvent,
        ...(Array.isArray(data.integrationGatewayEvents) ? data.integrationGatewayEvents : [])
      ].slice(0, 200);
    }
  });
  const consumed = await consumer.consume(domainEvent);
  if (!consumed.processed) {
    const existing = (data.integrationGatewayEvents || []).find((item) =>
      item.domainEvent?.id === domainEvent.id
      || (item.contractId === contract.id && item.idempotencyKey === payload.idempotencyKey)
    );
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
  CONSUMER,
  EVENT_TYPE,
  PLATFORM_CONTRACT_ID,
  canonicalDigest,
  createClinicalResultRegistry,
  deterministicId,
  receiveClinicalResult,
  supportsExternalContract
};
