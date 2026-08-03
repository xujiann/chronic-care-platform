"use strict";

const { createHash } = require("node:crypto");
const { ContractRegistry } = require("./src/platform/contracts/contract-registry");
const { DomainRepository } = require("./src/platform/data/domain-repository");
const {
  IdempotentEventConsumer,
  createDomainEvent,
  publishPendingOutbox
} = require("./src/platform/events/domain-event-runtime");

const DOMAIN = "public-health";
const CONTRACT_ID = "public-health-signal.v1";
const CONTRACT_CONSUMER = "platform-governance";
const EVENT_TYPE = "public-health.signal-ingested.v1";
const OUTBOX_COLLECTION = "publicHealthDomainOutbox";
const INBOX_COLLECTION = "publicHealthDomainInbox";
const PROJECTION_COLLECTION = "publicHealthSignalEventProjections";
const RECEIPT_COLLECTION = "publicHealthDomainEventReceipts";
const CONSUMER_NAME = "public-health-signal-audit-projection.v1";
const PHYSICAL_EVENT_STORE = "publicHealthSurveillanceAudit";
const LOGICAL_KINDS = Object.freeze({
  [OUTBOX_COLLECTION]: "domain-outbox-v1",
  [INBOX_COLLECTION]: "domain-inbox-v1",
  [PROJECTION_COLLECTION]: "domain-projection-v1",
  [RECEIPT_COLLECTION]: "domain-receipt-v1"
});

function clone(value) {
  return structuredClone(value || {});
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function nowIso(value) {
  const date = value ? new Date(value) : new Date();
  if (!Number.isFinite(date.getTime())) throw new TypeError("domain event time is invalid");
  return date.toISOString();
}

function rows(data, collection) {
  if (Array.isArray(data[collection])) return data[collection];
  const recordKind = LOGICAL_KINDS[collection];
  if (!recordKind) return [];
  return (Array.isArray(data[PHYSICAL_EVENT_STORE]) ? data[PHYSICAL_EVENT_STORE] : [])
    .filter((item) => item.recordKind === recordKind)
    .map(({ recordKind: ignored, ...item }) => item);
}

function assignRows(data, collection, values) {
  data[collection] = values;
  const recordKind = LOGICAL_KINDS[collection];
  if (!recordKind) return;
  const retained = (Array.isArray(data[PHYSICAL_EVENT_STORE]) ? data[PHYSICAL_EVENT_STORE] : [])
    .filter((item) => item.recordKind !== recordKind);
  data[PHYSICAL_EVENT_STORE] = [
    ...retained,
    ...values.map((item) => ({ ...clone(item), recordKind }))
  ];
}

function signalContractRegistry() {
  return new ContractRegistry().registerAntiCorruptionAdapter({
    contractId: CONTRACT_ID,
    consumer: CONTRACT_CONSUMER,
    fromExternal(payload) {
      return normalizeSignalContract(payload);
    },
    toExternal(value) {
      return normalizeSignalContract(value);
    }
  });
}

function normalizeSignalContract(value = {}) {
  const signalId = String(value.signalId || "").trim();
  const signalType = String(value.signalType || "").trim();
  const status = String(value.status || "").trim();
  const occurredAt = nowIso(value.occurredAt);
  if (!signalId || !signalType || !status) {
    throw new TypeError(`${CONTRACT_ID} requires signalId, signalType and status`);
  }
  return Object.freeze({ signalId, occurredAt, signalType, status });
}

function eventFromSignal(signal, options = {}) {
  if (!signal || !String(signal.id || "").trim()) {
    throw new TypeError("persisted public health signal is required");
  }
  const aggregateVersion = Number(signal.version || 1);
  const registry = signalContractRegistry();
  const payload = registry.encode(CONTRACT_ID, CONTRACT_CONSUMER, {
    signalId: signal.id,
    occurredAt: signal.receivedAt || signal.observedAt || options.occurredAt,
    signalType: signal.signalType,
    status: signal.workflowState || "received"
  });
  return createDomainEvent({
    domain: DOMAIN,
    type: EVENT_TYPE,
    aggregateId: signal.id,
    aggregateVersion,
    correlationId: options.correlationId,
    causationId: options.causationId,
    occurredAt: options.occurredAt,
    payload
  });
}

function createSnapshotRepositoryAdapter(source) {
  let state = clone(source);
  return {
    async read(collection, id) {
      return clone(rows(state, collection).find((item) => String(item.id) === String(id)) || null);
    },
    async transact(callback) {
      const working = clone(state);
      const transaction = {
        async apply(operation) {
          const current = rows(working, operation.collection);
          const index = current.findIndex((item) => String(item.id) === String(operation.id));
          const actualVersion = index < 0 ? 0 : Number(current[index].version || 0);
          if (operation.expectedVersion !== undefined && Number(operation.expectedVersion) !== actualVersion) {
            throw new Error(`public health aggregate version conflict: expected ${operation.expectedVersion}, actual ${actualVersion}`);
          }
          if (operation.type === "delete") {
            if (index >= 0) current.splice(index, 1);
          } else if (index >= 0) {
            current[index] = clone(operation.value);
          } else {
            current.push(clone(operation.value));
          }
          working[operation.collection] = current;
        },
        async appendOutbox(event) {
          const outbox = rows(working, OUTBOX_COLLECTION);
          const duplicate = outbox.find((item) => (
            item.type === event.type
            && item.aggregateId === event.aggregateId
            && Number(item.aggregateVersion) === Number(event.aggregateVersion)
          ));
          if (duplicate) return;
          outbox.push({
            ...clone(event),
            contractId: CONTRACT_ID,
            consumer: CONTRACT_CONSUMER,
            deliveryState: "pending",
            attempts: 0,
            publishedAt: "",
            receiptDigest: ""
          });
          assignRows(working, OUTBOX_COLLECTION, outbox);
        }
      };
      const result = await callback(transaction);
      state = working;
      return result;
    },
    snapshot() {
      return clone(state);
    }
  };
}

async function appendSignalIngestedEventToState(data, signal, options = {}) {
  const existing = rows(data, OUTBOX_COLLECTION).find((item) => (
    item.type === EVENT_TYPE
    && item.aggregateId === signal?.id
    && Number(item.aggregateVersion) === Number(signal?.version || 1)
  ));
  if (existing) {
    return Object.freeze({ nextData: clone(data), event: clone(existing), idempotent: true });
  }

  const event = eventFromSignal(signal, options);
  const adapter = createSnapshotRepositoryAdapter(data);
  const repository = new DomainRepository({ domain: DOMAIN, adapter });
  await repository
    .unitOfWork({ correlationId: event.correlationId })
    .publish(event)
    .commit();
  return Object.freeze({ nextData: adapter.snapshot(), event, idempotent: false });
}

function createStateOutbox(state, at) {
  return {
    async pending(limit) {
      return rows(state, OUTBOX_COLLECTION)
        .filter((event) => event.deliveryState === "pending")
        .slice(0, limit)
        .map(clone);
    },
    async markPublished(eventId) {
      const outbox = rows(state, OUTBOX_COLLECTION);
      const event = outbox.find((item) => item.id === eventId);
      if (!event) throw new Error(`public health outbox event not found: ${eventId}`);
      event.deliveryState = "published";
      event.publishedAt = at;
      event.attempts = Number(event.attempts || 0) + 1;
      assignRows(state, OUTBOX_COLLECTION, outbox);
    }
  };
}

function createStateInbox(state, at) {
  return {
    async claim(key) {
      const inbox = rows(state, INBOX_COLLECTION);
      if (inbox.some((item) => item.key === key && item.state === "completed")) return false;
      const existing = inbox.find((item) => item.key === key);
      if (existing) {
        existing.state = "processing";
        existing.claimedAt = at;
      } else {
        inbox.push({
          id: `public-health-domain-inbox:${sha256(key)}`,
          key,
          state: "processing",
          claimedAt: at,
          completedAt: ""
        });
      }
      assignRows(state, INBOX_COLLECTION, inbox);
      return true;
    },
    async complete(key) {
      const inbox = rows(state, INBOX_COLLECTION);
      const item = inbox.find((entry) => entry.key === key);
      if (!item) throw new Error(`public health inbox claim not found: ${key}`);
      item.state = "completed";
      item.completedAt = at;
      assignRows(state, INBOX_COLLECTION, inbox);
    },
    async release(key) {
      assignRows(state, INBOX_COLLECTION, rows(state, INBOX_COLLECTION).filter((entry) => entry.key !== key));
    }
  };
}

function projectSignalEvent(state, event, contract) {
  const projections = rows(state, PROJECTION_COLLECTION);
  if (!projections.some((item) => item.eventId === event.id)) {
    projections.push({
      id: `public-health-signal-projection:${contract.signalId}`,
      eventId: event.id,
      contractId: CONTRACT_ID,
      contractVersion: "1.0.0",
      signalId: contract.signalId,
      signalType: contract.signalType,
      status: contract.status,
      occurredAt: contract.occurredAt,
      projectedAt: event.occurredAt
    });
  }
  assignRows(state, PROJECTION_COLLECTION, projections);
}

async function dispatchPendingSignalEventsToState(data, options = {}) {
  const state = clone(data);
  const at = nowIso(options.at);
  const registry = signalContractRegistry();
  const deliveries = [];
  const publisher = options.publisher || {
    async publish(event) {
      return { accepted: true, receiptId: `local-contract-receipt:${event.id}` };
    }
  };
  const consumer = new IdempotentEventConsumer({
    name: CONSUMER_NAME,
    inbox: createStateInbox(state, at),
    async handler(event) {
      if (event.type !== EVENT_TYPE) throw new TypeError(`unsupported public health domain event: ${event.type}`);
      const contract = registry.decode(CONTRACT_ID, CONTRACT_CONSUMER, event.payload);
      const receipt = await publisher.publish(Object.freeze({
        contractId: CONTRACT_ID,
        contractVersion: "1.0.0",
        eventId: event.id,
        correlationId: event.correlationId,
        payload: contract
      }));
      if (!receipt || receipt.accepted !== true || !String(receipt.receiptId || "").trim()) {
        throw new Error("public health contract publisher did not return an accepted stable receipt");
      }
      projectSignalEvent(state, event, contract);
      const receiptDigest = sha256(`${event.id}:${receipt.receiptId}`);
      const receipts = rows(state, RECEIPT_COLLECTION);
      receipts.push({
        id: `public-health-domain-receipt:${event.id}`,
        eventId: event.id,
        receiptDigest,
        deliveredAt: at
      });
      assignRows(state, RECEIPT_COLLECTION, receipts);
      const outbox = rows(state, OUTBOX_COLLECTION);
      const outboxEvent = outbox.find((item) => item.id === event.id);
      if (outboxEvent) outboxEvent.receiptDigest = receiptDigest;
      assignRows(state, OUTBOX_COLLECTION, outbox);
      deliveries.push({ eventId: event.id, duplicate: false, receiptDigest });
    }
  });

  const processed = [];
  await publishPendingOutbox({
    outbox: createStateOutbox(state, at),
    limit: options.limit || 100,
    publisher: {
      async publish(event) {
        const result = await consumer.consume(event);
        processed.push({ eventId: event.id, ...result });
        if (result.duplicate) deliveries.push({ eventId: event.id, duplicate: true, receiptDigest: "" });
      }
    }
  });

  return Object.freeze({
    nextData: state,
    processed: Object.freeze(processed),
    deliveries: Object.freeze(deliveries),
    health: buildPublicHealthDomainEventHealth(state),
    productionReady: false
  });
}

function buildPublicHealthDomainEventHealth(data = {}) {
  const outbox = rows(data, OUTBOX_COLLECTION);
  const inbox = rows(data, INBOX_COLLECTION);
  const pending = outbox.filter((item) => item.deliveryState === "pending").length;
  const published = outbox.filter((item) => item.deliveryState === "published").length;
  return Object.freeze({
    ok: pending === 0,
    contractId: CONTRACT_ID,
    eventType: EVENT_TYPE,
    summary: Object.freeze({
      outbox: outbox.length,
      pending,
      published,
      completedInbox: inbox.filter((item) => item.state === "completed").length,
      projections: rows(data, PROJECTION_COLLECTION).length,
      receipts: rows(data, RECEIPT_COLLECTION).length
    }),
    productionReady: false
  });
}

module.exports = {
  CONTRACT_ID,
  EVENT_TYPE,
  appendSignalIngestedEventToState,
  buildPublicHealthDomainEventHealth,
  dispatchPendingSignalEventsToState,
  eventFromSignal
};
