"use strict";

const { randomUUID } = require("node:crypto");

function createDomainEvent({
  id = randomUUID(),
  domain,
  type,
  aggregateId,
  aggregateVersion,
  correlationId,
  causationId = "",
  occurredAt = new Date().toISOString(),
  payload = {}
}) {
  if (!domain || !/^[a-z][a-z0-9-]*$/.test(domain)) throw new TypeError("event domain is required");
  if (!/^[a-z][a-z0-9-]+\.[a-z][a-z0-9-]+\.v\d+$/.test(String(type || ""))) {
    throw new TypeError("event type must be domain.event.vN");
  }
  if (!String(aggregateId || "").trim() || !Number.isInteger(aggregateVersion) || aggregateVersion < 1) {
    throw new TypeError("event aggregate id and positive version are required");
  }
  return Object.freeze({
    id: String(id),
    domain,
    type,
    aggregateId: String(aggregateId),
    aggregateVersion,
    correlationId: String(correlationId || id),
    causationId: String(causationId || ""),
    occurredAt,
    payload: Object.freeze(structuredClone(payload))
  });
}

class IdempotentEventConsumer {
  constructor({ name, inbox, handler }) {
    if (!name || !inbox || typeof inbox.claim !== "function" || typeof handler !== "function") {
      throw new TypeError("consumer requires name, inbox.claim and handler");
    }
    this.name = name;
    this.inbox = inbox;
    this.handler = handler;
  }

  async consume(event) {
    const key = `${this.name}:${event.id}`;
    const claimed = await this.inbox.claim(key);
    if (!claimed) return Object.freeze({ processed: false, duplicate: true });
    try {
      await this.handler(event);
      if (typeof this.inbox.complete === "function") await this.inbox.complete(key);
      return Object.freeze({ processed: true, duplicate: false });
    } catch (error) {
      if (typeof this.inbox.release === "function") await this.inbox.release(key);
      throw error;
    }
  }
}

async function publishPendingOutbox({ outbox, publisher, limit = 100 }) {
  if (!outbox || typeof outbox.pending !== "function" || typeof outbox.markPublished !== "function") {
    throw new TypeError("outbox requires pending and markPublished");
  }
  if (!publisher || typeof publisher.publish !== "function") {
    throw new TypeError("publisher requires publish");
  }
  const pending = await outbox.pending(limit);
  const results = [];
  for (const event of pending) {
    await publisher.publish(event);
    await outbox.markPublished(event.id);
    results.push(event.id);
  }
  return Object.freeze(results);
}

module.exports = { IdempotentEventConsumer, createDomainEvent, publishPendingOutbox };
