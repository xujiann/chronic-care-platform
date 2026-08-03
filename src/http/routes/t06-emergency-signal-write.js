"use strict";

const { createHash } = require("node:crypto");
const { DomainRepository } = require("../../platform/data/domain-repository");
const { createDomainEvent } = require("../../platform/events/domain-event-runtime");

const DOMAIN = "clinical-specialties";
const COLLECTION = "emergencySignals";
const EVENT_TYPE = "clinical-specialties.emergency-signal-updated.v1";
const INBOX_COLLECTION = "emergencySignalCommandInbox";
const OUTBOX_COLLECTION = "emergencyAuditEvents";
const aggregateWriteTails = new Map();
const PROTECTED_FIELDS = new Set([
  "aggregateVersion", "certificateNo", "createdAt", "createdBy", "createdByName",
  "credentialNo", "documentNo", "fatherDocumentNo", "id", "lastUpdated",
  "maternalResidentId", "motherDocumentNo", "personIndex", "residentId",
  "updatedAt", "updatedBy", "updatedByName", "version"
]);

class EmergencySignalCommandError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = "EmergencySignalCommandError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stableValue(value[key])])
    );
  }
  return value;
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

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

function withAggregateWriteLock(id, work) {
  const key = String(id || "");
  const previous = aggregateWriteTails.get(key) || Promise.resolve();
  const execution = previous.then(work, work);
  const tail = execution.then(() => undefined, () => undefined);
  aggregateWriteTails.set(key, tail);
  tail.finally(() => {
    if (aggregateWriteTails.get(key) === tail) aggregateWriteTails.delete(key);
  });
  return execution;
}

function createRuntimeAdapter({
  readDatabase,
  writeDatabase,
  prependAuditTrailEntry,
  actor,
  action,
  command
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
      let committedAggregate = null;
      const result = await work({
        async apply(operation) {
          if (operation.type !== "put" || operation.collection !== COLLECTION) {
            throw new Error(`unsupported clinical repository operation: ${operation.type}/${operation.collection}`);
          }
          const rows = Array.isArray(data[COLLECTION]) ? data[COLLECTION] : [];
          const index = rows.findIndex((item) => String(item.id) === operation.id);
          if (index < 0) throw new Error(`emergency signal disappeared before commit: ${operation.id}`);
          rows[index] = structuredClone(operation.value);
          committedAggregate = structuredClone(operation.value);
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
      if (command?.id) {
        data[INBOX_COLLECTION] = [
          {
            commandId: command.id,
            intentDigest: command.intentDigest,
            aggregateId: stagedEvents[0]?.aggregateId || "",
            aggregateVersion: stagedEvents[0]?.aggregateVersion || 0,
            eventId: stagedEvents[0]?.id || "",
            result: committedAggregate,
            status: "completed",
            completedAt: stagedEvents[0]?.occurredAt || new Date().toISOString(),
            productionEvidence: false
          },
          ...(Array.isArray(data[INBOX_COLLECTION]) ? data[INBOX_COLLECTION] : [])
        ];
      }
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

async function executeEmergencySignalUpdate({
  id,
  payload,
  user,
  correlationId,
  causationId,
  readDatabase,
  writeDatabase,
  prependAuditTrailEntry
}) {
  const commandId = String(causationId || "").trim();
  const expectedVersion = Object.hasOwn(payload || {}, "expectedVersion")
    ? Number(payload.expectedVersion)
    : undefined;
  const patch = safePatch(payload);
  const intentDigest = digest({
    aggregateId: String(id || ""),
    expectedVersion,
    patch,
    actor: String(user?.username || user?.id || user?.role || "")
  });
  if (commandId) {
    const state = readDatabase();
    const receipt = (Array.isArray(state[INBOX_COLLECTION]) ? state[INBOX_COLLECTION] : [])
      .find((item) => item.commandId === commandId);
    if (receipt) {
      if (receipt.aggregateId !== String(id) || receipt.intentDigest !== intentDigest) {
        throw new EmergencySignalCommandError(
          "EMERGENCY_SIGNAL_IDEMPOTENCY_CONFLICT",
          "Idempotency-Key was already used for a different emergency signal command",
          409
        );
      }
      const event = (Array.isArray(state[OUTBOX_COLLECTION]) ? state[OUTBOX_COLLECTION] : [])
        .find((item) => item.id === receipt.eventId);
      if (!event || !receipt.result || receipt.status !== "completed") {
        throw new EmergencySignalCommandError(
          "EMERGENCY_SIGNAL_REPLAY_INTEGRITY_FAILED",
          "idempotent emergency signal receipt is incomplete",
          500
        );
      }
      return Object.freeze({
        status: 200,
        body: Object.freeze(structuredClone(receipt.result)),
        event: Object.freeze(structuredClone(event)),
        replayed: true
      });
    }
  }
  const adapter = createRuntimeAdapter({
    readDatabase,
    writeDatabase,
    prependAuditTrailEntry,
    actor: user,
    action: "更新公卫预警",
    command: commandId ? { id: commandId, intentDigest } : null
  });
  const repository = new DomainRepository({ domain: DOMAIN, adapter });
  const current = await repository.get(COLLECTION, id);
  if (!current) {
    return Object.freeze({
      status: 404,
      body: Object.freeze({ error: "Not Found", message: "未找到业务记录" }),
      event: null,
      replayed: false
    });
  }
  const aggregateVersion = aggregateVersionFor(current);
  const updatedAt = new Date().toISOString();
  const updated = {
    ...current,
    ...patch,
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
  return Object.freeze({ status: 200, body: Object.freeze(updated), event, replayed: false });
}

function updateEmergencySignal(input) {
  return withAggregateWriteLock(input?.id, () => executeEmergencySignalUpdate(input));
}

module.exports = {
  COLLECTION,
  DOMAIN,
  EVENT_TYPE,
  INBOX_COLLECTION,
  OUTBOX_COLLECTION,
  EmergencySignalCommandError,
  createRuntimeAdapter,
  digest,
  safePatch,
  updateEmergencySignal
};
