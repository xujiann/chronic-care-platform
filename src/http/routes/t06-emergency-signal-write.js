"use strict";

const { DomainRepository } = require("../../platform/data/domain-repository");
const { createDomainEvent } = require("../../platform/events/domain-event-runtime");

const DOMAIN = "clinical-specialties";
const COLLECTION = "emergencySignals";
const EVENT_TYPE = "clinical-specialties.emergency-signal-updated.v1";
const OUTBOX_COLLECTION = "emergencyAuditEvents";
const PROTECTED_FIELDS = new Set([
  "aggregateVersion", "certificateNo", "createdAt", "createdBy", "createdByName",
  "credentialNo", "documentNo", "fatherDocumentNo", "id", "lastUpdated",
  "maternalResidentId", "motherDocumentNo", "personIndex", "residentId",
  "updatedAt", "updatedBy", "updatedByName", "version"
]);

function safePatch(payload) {
  return Object.entries(payload && typeof payload === "object" ? payload : {})
    .reduce((result, [key, value]) => {
      if (key === "expectedVersion" || PROTECTED_FIELDS.has(key)) return result;
      if (
        ["string", "number", "boolean"].includes(typeof value)
        || value === null
        || Array.isArray(value)
        || (value && typeof value === "object")
      ) {
        result[key] = structuredClone(value);
      }
      return result;
    }, {});
}

function aggregateVersionFor(current) {
  if (Number.isInteger(current?.aggregateVersion) && current.aggregateVersion >= 1) {
    return current.aggregateVersion + 1;
  }
  return 1;
}

function createRuntimeAdapter({
  readDatabase,
  writeDatabase,
  prependAuditTrailEntry,
  actor,
  action
}) {
  return {
    async read(collection, id) {
      const data = readDatabase();
      return structuredClone(
        (Array.isArray(data[collection]) ? data[collection] : [])
          .find((item) => String(item.id) === String(id)) || null
      );
    },
    async transact(work) {
      const data = readDatabase();
      const stagedEvents = [];
      const result = await work({
        async apply(operation) {
          if (operation.type !== "put" || operation.collection !== COLLECTION) {
            throw new Error(`unsupported clinical repository operation: ${operation.type}/${operation.collection}`);
          }
          const rows = Array.isArray(data[COLLECTION]) ? data[COLLECTION] : [];
          const index = rows.findIndex((item) => String(item.id) === operation.id);
          if (index < 0) throw new Error(`emergency signal disappeared before commit: ${operation.id}`);
          rows[index] = structuredClone(operation.value);
          data[COLLECTION] = rows;
          if (operation.expectedVersion !== undefined) {
            data.storageMeta = {
              ...(data.storageMeta || {}),
              collectionVersions: { [COLLECTION]: Number(operation.expectedVersion) }
            };
          }
        },
        async appendOutbox(event) {
          stagedEvents.push(structuredClone(event));
        }
      });
      data[OUTBOX_COLLECTION] = [
        ...stagedEvents.map((event) => ({
          ...event,
          action: "domain-event-outbox",
          owner: DOMAIN,
          outboxStatus: "pending"
        })),
        ...(Array.isArray(data[OUTBOX_COLLECTION]) ? data[OUTBOX_COLLECTION] : [])
      ].slice(0, 1000);
      data.securityEvents = prependAuditTrailEntry(data.securityEvents, {
        id: stagedEvents[0]?.id,
        at: new Date().toISOString(),
        actor: actor.name,
        role: actor.role,
        action,
        target: `${COLLECTION}/${stagedEvents[0]?.aggregateId || ""}`,
        result: "允许",
        detail: `${EVENT_TYPE}; owner=${DOMAIN}`,
        ownershipContract: {
          collection: COLLECTION,
          owner: DOMAIN,
          repository: "DomainRepository",
          unitOfWork: true
        },
        domainEvent: {
          id: stagedEvents[0]?.id,
          type: EVENT_TYPE,
          outbox: OUTBOX_COLLECTION
        }
      });
      writeDatabase(data, {
        event: EVENT_TYPE,
        ownershipContract: {
          collection: COLLECTION,
          owner: DOMAIN,
          repository: "DomainRepository",
          unitOfWork: true
        }
      });
      return result;
    }
  };
}

async function updateEmergencySignal({
  id,
  payload,
  user,
  correlationId,
  causationId,
  readDatabase,
  writeDatabase,
  prependAuditTrailEntry
}) {
  const adapter = createRuntimeAdapter({
    readDatabase,
    writeDatabase,
    prependAuditTrailEntry,
    actor: user,
    action: "更新公卫预警"
  });
  const repository = new DomainRepository({ domain: DOMAIN, adapter });
  const current = await repository.get(COLLECTION, id);
  if (!current) {
    return Object.freeze({
      status: 404,
      body: Object.freeze({ error: "Not Found", message: "未找到业务记录" }),
      event: null
    });
  }
  const expectedVersion = Object.hasOwn(payload || {}, "expectedVersion")
    ? Number(payload.expectedVersion)
    : undefined;
  const aggregateVersion = aggregateVersionFor(current);
  const updatedAt = new Date().toISOString();
  const updated = {
    ...current,
    ...safePatch(payload),
    aggregateVersion,
    updatedBy: user.username || user.role,
    updatedByName: user.name,
    lastUpdated: updatedAt
  };
  const event = createDomainEvent({
    domain: DOMAIN,
    type: EVENT_TYPE,
    aggregateId: id,
    aggregateVersion,
    correlationId,
    causationId,
    occurredAt: updatedAt,
    payload: {
      signalId: id,
      previousStatus: String(current.status || ""),
      status: String(updated.status || ""),
      action: String(updated.action || ""),
      level: String(updated.level || ""),
      ownerRole: String(user.role || "")
    }
  });
  await repository.unitOfWork({ correlationId })
    .put(COLLECTION, id, updated, expectedVersion)
    .publish(event)
    .commit();
  return Object.freeze({ status: 200, body: Object.freeze(updated), event });
}

module.exports = {
  COLLECTION,
  DOMAIN,
  EVENT_TYPE,
  OUTBOX_COLLECTION,
  createRuntimeAdapter,
  safePatch,
  updateEmergencySignal
};
