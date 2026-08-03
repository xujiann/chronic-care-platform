"use strict";

const { createHash, randomUUID } = require("node:crypto");
const { DomainRepository } = require("./src/platform/data/domain-repository");
const {
  IdempotentEventConsumer,
  createDomainEvent,
  publishPendingOutbox
} = require("./src/platform/events/domain-event-runtime");

const DOMAIN = "citizen-chronic";
const COLLECTION = "followups";
const EVENT_TYPE = "citizen-chronic.followup-updated.v1";
const CONSUMER_NAME = "citizen-chronic.followup-summary-projection.v1";
const RUNTIME_FIELD = "domainRuntime";

function clone(value) {
  return structuredClone(value);
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function digest(value) {
  return sha256(JSON.stringify(stableValue(value)));
}

function iso(value) {
  const date = value ? new Date(value) : new Date();
  if (!Number.isFinite(date.getTime())) throw new TypeError("followup event time is invalid");
  return date.toISOString();
}

function runtimeOf(followup) {
  const runtime = followup?.[RUNTIME_FIELD] || {};
  return {
    commands: Array.isArray(runtime.commands) ? clone(runtime.commands) : [],
    outbox: Array.isArray(runtime.outbox) ? clone(runtime.outbox) : [],
    inbox: Array.isArray(runtime.inbox) ? clone(runtime.inbox) : [],
    projections: Array.isArray(runtime.projections) ? clone(runtime.projections) : [],
    receipts: Array.isArray(runtime.receipts) ? clone(runtime.receipts) : []
  };
}

function publicFollowup(followup = {}) {
  const result = clone(followup);
  delete result[RUNTIME_FIELD];
  return result;
}

function publicPatch(patch = {}) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new TypeError("followup patch must be an object");
  }
  const denied = new Set([
    "id",
    "residentId",
    "domainVersion",
    RUNTIME_FIELD,
    "expectedVersion",
    "expectedDomainVersion",
    "idempotencyKey"
  ]);
  const result = {};
  for (const [key, value] of Object.entries(patch)) {
    if (denied.has(key) || key === "__proto__" || key === "constructor" || key === "prototype") continue;
    result[key] = clone(value);
  }
  if (Object.keys(result).length === 0) throw new TypeError("followup patch has no mutable fields");
  return result;
}

function findFollowup(data, id) {
  return (Array.isArray(data?.followups) ? data.followups : [])
    .find((item) => String(item.id) === String(id)) || null;
}

function createFollowupSnapshotAdapter(source) {
  let state = clone(source);
  return {
    async read(collection, id) {
      if (collection !== COLLECTION) throw new TypeError(`unsupported citizen-chronic collection: ${collection}`);
      return clone(findFollowup(state, id));
    },
    async transact(callback) {
      const working = clone(state);
      const transaction = {
        async apply(operation) {
          if (operation.collection !== COLLECTION || operation.type !== "put") {
            throw new TypeError("followup repository accepts only owned followup puts");
          }
          const rows = Array.isArray(working.followups) ? working.followups : [];
          const index = rows.findIndex((item) => String(item.id) === String(operation.id));
          if (index < 0) throw new Error(`followup aggregate not found: ${operation.id}`);
          const actualVersion = Number(rows[index].domainVersion || 0);
          if (operation.expectedVersion !== undefined && Number(operation.expectedVersion) !== actualVersion) {
            const error = new Error(`followup version conflict: expected ${operation.expectedVersion}, actual ${actualVersion}`);
            error.code = "FOLLOWUP_VERSION_CONFLICT";
            throw error;
          }
          rows[index] = clone(operation.value);
          working.followups = rows;
        },
        async appendOutbox(event) {
          const followup = findFollowup(working, event.aggregateId);
          if (!followup) throw new Error(`followup aggregate not found for event: ${event.aggregateId}`);
          const runtime = runtimeOf(followup);
          if (!runtime.outbox.some((item) => item.id === event.id)) {
            runtime.outbox.push({
              ...clone(event),
              deliveryState: "pending",
              attempts: 0,
              publishedAt: "",
              receiptDigest: ""
            });
          }
          followup[RUNTIME_FIELD] = runtime;
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

function commandIdentity({ id, patch, idempotencyKey, correlationId }) {
  const patchDigest = digest(patch);
  const rawKey = String(idempotencyKey || "").trim();
  const commandHash = sha256(rawKey || `${correlationId || randomUUID()}:${id}:${patchDigest}`);
  return { commandHash, patchDigest };
}

async function updateFollowupToState(data, input = {}) {
  const id = String(input.id || "").trim();
  if (!id) throw new TypeError("followup id is required");
  const current = findFollowup(data, id);
  if (!current) {
    const error = new Error("followup not found");
    error.code = "FOLLOWUP_NOT_FOUND";
    throw error;
  }
  const patch = publicPatch(input.patch);
  const identity = commandIdentity({
    id,
    patch,
    idempotencyKey: input.idempotencyKey,
    correlationId: input.correlationId
  });
  const currentRuntime = runtimeOf(current);
  const replay = currentRuntime.commands.find((item) => item.commandHash === identity.commandHash);
  if (replay) {
    if (replay.patchDigest !== identity.patchDigest) {
      const error = new Error("followup idempotency key was used for a different patch");
      error.code = "FOLLOWUP_IDEMPOTENCY_CONFLICT";
      throw error;
    }
    return Object.freeze({
      nextData: clone(data),
      followup: publicFollowup(current),
      event: clone(currentRuntime.outbox.find((item) => item.id === replay.eventId) || null),
      idempotent: true,
      productionReady: false
    });
  }

  const actualVersion = Number(current.domainVersion || 0);
  if (input.expectedVersion !== undefined && Number(input.expectedVersion) !== actualVersion) {
    const error = new Error(`followup version conflict: expected ${input.expectedVersion}, actual ${actualVersion}`);
    error.code = "FOLLOWUP_VERSION_CONFLICT";
    throw error;
  }
  const at = iso(input.at);
  const nextVersion = actualVersion + 1;
  const nextFollowup = {
    ...clone(current),
    ...patch,
    domainVersion: nextVersion,
    updatedBy: String(input.user?.username || input.user?.role || "").trim(),
    updatedByName: String(input.user?.name || "").trim(),
    lastUpdated: at,
    [RUNTIME_FIELD]: currentRuntime
  };
  const event = createDomainEvent({
    domain: DOMAIN,
    type: EVENT_TYPE,
    aggregateId: id,
    aggregateVersion: nextVersion,
    correlationId: input.correlationId,
    causationId: identity.commandHash,
    occurredAt: at,
    payload: {
      followupId: id,
      status: String(nextFollowup.status || "updated"),
      updatedAt: at,
      version: nextVersion
    }
  });
  nextFollowup[RUNTIME_FIELD].commands.push({
    commandHash: identity.commandHash,
    patchDigest: identity.patchDigest,
    eventId: event.id,
    completedAt: at
  });

  const adapter = createFollowupSnapshotAdapter(data);
  const repository = new DomainRepository({ domain: DOMAIN, adapter });
  await repository
    .unitOfWork({ correlationId: event.correlationId })
    .put(COLLECTION, id, nextFollowup, actualVersion)
    .publish(event)
    .commit();
  const nextData = adapter.snapshot();
  nextData.securityEvents = [{
    id: randomUUID(),
    at,
    actor: String(input.user?.name || "").trim(),
    role: String(input.user?.role || "").trim(),
    action: "update chronic followup with domain event",
    target: `${COLLECTION}/${id}`,
    result: "allowed",
    detail: `${EVENT_TYPE}@${nextVersion}`
  }, ...(Array.isArray(nextData.securityEvents) ? nextData.securityEvents : [])].slice(0, 120);

  return Object.freeze({
    nextData,
    followup: publicFollowup(findFollowup(nextData, id)),
    event,
    idempotent: false,
    productionReady: false
  });
}

function pendingEvents(state, limit) {
  const events = [];
  for (const followup of Array.isArray(state.followups) ? state.followups : []) {
    for (const event of runtimeOf(followup).outbox) {
      if (event.deliveryState === "pending") events.push(event);
      if (events.length >= limit) return events;
    }
  }
  return events;
}

function mutateRuntime(state, aggregateId, callback) {
  const followup = findFollowup(state, aggregateId);
  if (!followup) throw new Error(`followup aggregate not found: ${aggregateId}`);
  const runtime = runtimeOf(followup);
  callback(runtime);
  followup[RUNTIME_FIELD] = runtime;
}

function createEmbeddedOutbox(state, at) {
  return {
    async pending(limit) {
      return clone(pendingEvents(state, limit));
    },
    async markPublished(eventId) {
      const followup = (state.followups || []).find((item) =>
        runtimeOf(item).outbox.some((event) => event.id === eventId));
      if (!followup) throw new Error(`followup outbox event not found: ${eventId}`);
      mutateRuntime(state, followup.id, (runtime) => {
        const event = runtime.outbox.find((item) => item.id === eventId);
        event.deliveryState = "published";
        event.publishedAt = at;
        event.attempts = Number(event.attempts || 0) + 1;
      });
    }
  };
}

function createEmbeddedInbox(state, aggregateId, at) {
  return {
    async claim(key) {
      let claimed = false;
      mutateRuntime(state, aggregateId, (runtime) => {
        const existing = runtime.inbox.find((item) => item.key === key);
        if (existing?.state === "completed") return;
        if (existing) {
          existing.state = "processing";
          existing.claimedAt = at;
        } else {
          runtime.inbox.push({
            id: `followup-inbox:${sha256(key)}`,
            key,
            state: "processing",
            claimedAt: at,
            completedAt: ""
          });
        }
        claimed = true;
      });
      return claimed;
    },
    async complete(key) {
      mutateRuntime(state, aggregateId, (runtime) => {
        const item = runtime.inbox.find((entry) => entry.key === key);
        if (!item) throw new Error(`followup inbox claim not found: ${key}`);
        item.state = "completed";
        item.completedAt = at;
      });
    },
    async release(key) {
      mutateRuntime(state, aggregateId, (runtime) => {
        runtime.inbox = runtime.inbox.filter((entry) => entry.key !== key);
      });
    }
  };
}

function assertFollowupEvent(event) {
  if (event.type !== EVENT_TYPE) throw new TypeError(`unsupported citizen-chronic event: ${event.type}`);
  const payload = event.payload || {};
  if (payload.followupId !== event.aggregateId
    || !String(payload.status || "").trim()
    || !Number.isInteger(payload.version)
    || payload.version !== event.aggregateVersion) {
    throw new TypeError("followup-updated.v1 payload is invalid");
  }
  iso(payload.updatedAt);
}

async function dispatchPendingFollowupEventsToState(data, options = {}) {
  const state = clone(data);
  const at = iso(options.at);
  const deliveries = [];
  const processed = [];
  const publisher = options.publisher || {
    async publish(envelope) {
      return { accepted: true, receiptId: `local-followup-receipt:${envelope.eventId}` };
    }
  };
  await publishPendingOutbox({
    outbox: createEmbeddedOutbox(state, at),
    limit: options.limit || 100,
    publisher: {
      async publish(event) {
        const consumer = new IdempotentEventConsumer({
          name: CONSUMER_NAME,
          inbox: createEmbeddedInbox(state, event.aggregateId, at),
          async handler(candidate) {
            assertFollowupEvent(candidate);
            const receipt = await publisher.publish(Object.freeze({
              eventId: candidate.id,
              eventType: candidate.type,
              eventVersion: 1,
              correlationId: candidate.correlationId,
              payload: clone(candidate.payload)
            }));
            if (!receipt || receipt.accepted !== true || !String(receipt.receiptId || "").trim()) {
              throw new Error("followup event publisher did not return an accepted stable receipt");
            }
            const receiptDigest = sha256(`${candidate.id}:${receipt.receiptId}`);
            mutateRuntime(state, candidate.aggregateId, (runtime) => {
              if (!runtime.projections.some((item) => item.eventId === candidate.id)) {
                runtime.projections.push({
                  id: `followup-projection:${candidate.aggregateId}`,
                  eventId: candidate.id,
                  eventType: candidate.type,
                  status: candidate.payload.status,
                  version: candidate.aggregateVersion,
                  projectedAt: at
                });
              }
              if (!runtime.receipts.some((item) => item.eventId === candidate.id)) {
                runtime.receipts.push({
                  id: `followup-receipt:${candidate.id}`,
                  eventId: candidate.id,
                  receiptDigest,
                  deliveredAt: at
                });
              }
              const outboxEvent = runtime.outbox.find((item) => item.id === candidate.id);
              if (outboxEvent) outboxEvent.receiptDigest = receiptDigest;
            });
            deliveries.push({ eventId: candidate.id, duplicate: false, receiptDigest });
          }
        });
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
    health: buildFollowupEventHealth(state),
    productionReady: false
  });
}

function buildFollowupEventHealth(data = {}) {
  const summary = {
    outbox: 0,
    pending: 0,
    published: 0,
    completedInbox: 0,
    projections: 0,
    receipts: 0
  };
  for (const followup of Array.isArray(data.followups) ? data.followups : []) {
    const runtime = runtimeOf(followup);
    summary.outbox += runtime.outbox.length;
    summary.pending += runtime.outbox.filter((item) => item.deliveryState === "pending").length;
    summary.published += runtime.outbox.filter((item) => item.deliveryState === "published").length;
    summary.completedInbox += runtime.inbox.filter((item) => item.state === "completed").length;
    summary.projections += runtime.projections.length;
    summary.receipts += runtime.receipts.length;
  }
  return Object.freeze({
    ok: summary.pending === 0,
    eventType: EVENT_TYPE,
    summary: Object.freeze(summary),
    productionReady: false
  });
}

module.exports = {
  EVENT_TYPE,
  RUNTIME_FIELD,
  buildFollowupEventHealth,
  dispatchPendingFollowupEventsToState,
  publicFollowup,
  updateFollowupToState
};
