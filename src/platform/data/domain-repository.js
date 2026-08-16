"use strict";

const ownershipManifest = require("../../../config/domain-data-ownership.json");

function assertIdentifier(label, value) {
  if (typeof value !== "string" || !/^[a-z][a-z0-9-]*$/.test(value)) {
    throw new TypeError(`${label} must be a kebab-case identifier`);
  }
  return value;
}

function validateOwnershipManifest(manifest = ownershipManifest) {
  if (!manifest || typeof manifest !== "object") throw new TypeError("data ownership manifest is required");
  const nonOwners = new Set(manifest.nonOwningDomains || []);
  const entries = Object.entries(manifest.collections || {});
  if (entries.length === 0) throw new TypeError("data ownership manifest requires collections");
  for (const [collection, policy] of entries) {
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(collection)) {
      throw new TypeError(`invalid collection name: ${collection}`);
    }
    assertIdentifier(`owner for ${collection}`, policy?.owner);
    if (nonOwners.has(policy.owner)) {
      throw new TypeError(`${policy.owner} cannot own business collection ${collection}`);
    }
    const readers = policy.readers || [];
    if (!Array.isArray(readers) || new Set(readers).size !== readers.length) {
      throw new TypeError(`readers for ${collection} must be unique`);
    }
  }
  const production = manifest.storagePolicy?.production;
  if (production?.authoritative !== "postgresql" || production?.fallbackWrite !== false) {
    throw new TypeError("production storage must be PostgreSQL with fallback writes disabled");
  }
  const unregistered = manifest.unregisteredCollectionPolicy;
  if (unregistered?.classification !== "legacy-non-authoritative"
    || unregistered?.productionWriteAllowed !== false
    || !Array.isArray(unregistered?.promotionRequires)
    || unregistered.promotionRequires.length < 4) {
    throw new TypeError("unregistered collections must be non-authoritative and blocked from production writes");
  }
  return true;
}

function policyFor(collection, manifest = ownershipManifest) {
  const policy = manifest.collections?.[collection];
  if (!policy) throw new TypeError(`unregistered business collection: ${collection}`);
  return policy;
}

function assertReadAccess(domain, collection, manifest = ownershipManifest) {
  const policy = policyFor(collection, manifest);
  if (policy.owner !== domain && !(policy.readers || []).includes(domain)) {
    throw new Error(`${domain} cannot read ${collection}; use an owned versioned contract`);
  }
  return policy;
}

function assertWriteAccess(domain, collection, manifest = ownershipManifest) {
  const policy = policyFor(collection, manifest);
  if (policy.owner !== domain) {
    throw new Error(`${domain} cannot write ${collection}; owner is ${policy.owner}`);
  }
  return policy;
}

class DomainUnitOfWork {
  constructor({ domain, adapter, manifest = ownershipManifest, correlationId = "" }) {
    assertIdentifier("domain", domain);
    if (!adapter || typeof adapter.transact !== "function") {
      throw new TypeError("unit of work adapter requires transact(callback)");
    }
    this.domain = domain;
    this.adapter = adapter;
    this.manifest = manifest;
    this.correlationId = String(correlationId || "").trim();
    this.operations = [];
    this.events = [];
    this.committed = false;
  }

  put(collection, id, value, expectedVersion) {
    assertWriteAccess(this.domain, collection, this.manifest);
    if (!String(id || "").trim()) throw new TypeError("repository id is required");
    this.operations.push(Object.freeze({
      type: "put",
      collection,
      id: String(id),
      value: structuredClone(value),
      expectedVersion
    }));
    return this;
  }

  delete(collection, id, expectedVersion) {
    assertWriteAccess(this.domain, collection, this.manifest);
    this.operations.push(Object.freeze({
      type: "delete",
      collection,
      id: String(id),
      expectedVersion
    }));
    return this;
  }

  publish(event) {
    if (!event || event.domain !== this.domain || !event.id || !event.type) {
      throw new TypeError("unit of work event must be an owned domain event");
    }
    this.events.push(Object.freeze({ ...event, correlationId: event.correlationId || this.correlationId }));
    return this;
  }

  async commit() {
    if (this.committed) throw new Error("unit of work already committed");
    this.committed = true;
    const operations = Object.freeze([...this.operations]);
    const events = Object.freeze([...this.events]);
    return this.adapter.transact(async (transaction) => {
      if (typeof transaction.apply !== "function" || typeof transaction.appendOutbox !== "function") {
        throw new TypeError("transaction requires apply(operation) and appendOutbox(event)");
      }
      for (const operation of operations) await transaction.apply(operation);
      for (const event of events) await transaction.appendOutbox(event);
      return Object.freeze({ operationCount: operations.length, eventCount: events.length });
    });
  }
}

class DomainRepository {
  constructor({ domain, adapter, manifest = ownershipManifest }) {
    validateOwnershipManifest(manifest);
    assertIdentifier("domain", domain);
    if (!adapter || typeof adapter.read !== "function" || typeof adapter.transact !== "function") {
      throw new TypeError("repository adapter requires read and transact");
    }
    this.domain = domain;
    this.adapter = adapter;
    this.manifest = manifest;
  }

  async get(collection, id) {
    assertReadAccess(this.domain, collection, this.manifest);
    return this.adapter.read(collection, String(id));
  }

  unitOfWork(options = {}) {
    return new DomainUnitOfWork({
      domain: this.domain,
      adapter: this.adapter,
      manifest: this.manifest,
      correlationId: options.correlationId
    });
  }
}

module.exports = {
  DomainRepository,
  DomainUnitOfWork,
  assertReadAccess,
  assertWriteAccess,
  validateOwnershipManifest
};
