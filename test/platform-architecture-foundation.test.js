"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ownershipManifest = require("../config/domain-data-ownership.json");
const { ContractRegistry } = require("../src/platform/contracts/contract-registry");
const {
  DomainRepository,
  assertWriteAccess,
  validateOwnershipManifest
} = require("../src/platform/data/domain-repository");
const {
  PLATFORM_WRITE_CONTRACTS,
  ownerForCollection
} = require("../src/http/routes/t02-state-ownership-contract");
const {
  IdempotentEventConsumer,
  createDomainEvent,
  publishPendingOutbox
} = require("../src/platform/events/domain-event-runtime");
const { PlatformObservability } = require("../src/platform/observability/request-context");

const SYSTEM_COLLECTION_POLICIES = Object.freeze({
  dataAccessLogs: "platform-governance",
  platformProcessAudit: "platform-governance",
  securityEvents: "platform-governance"
});

test("pilot cutover alert runtime never imports the composition root", () => {
  const source = fs.readFileSync(path.join(
    __dirname,
    "..",
    "src",
    "platform",
    "cutover",
    "pilot-cutover-alert-runtime.js"
  ), "utf8");
  assert.doesNotMatch(source, /require\s*\(\s*["'][^"']*server(?:\.js)?["']\s*\)/);
});

test("regional sharing read model remains independent from the composition root and HTTP routes", () => {
  const source = fs.readFileSync(path.join(
    __dirname,
    "..",
    "src",
    "platform",
    "governance",
    "regional-sharing-read-model.js"
  ), "utf8");
  assert.doesNotMatch(source, /require\s*\(\s*["'][^"']*server(?:\.js)?["']\s*\)/);
  assert.doesNotMatch(source, /require\s*\(\s*["'][^"']*src[\\/]http[\\/]routes/);
  assert.match(source, /function createRegionalSharingReadModel/);
  assert.match(source, /regional-sharing-read-model\.v1/);
});

test("business collections have one domain owner and production has no fallback writes", () => {
  assert.equal(validateOwnershipManifest(), true);
  assert.equal(ownershipManifest.storagePolicy.production.authoritative, "postgresql");
  assert.equal(ownershipManifest.storagePolicy.production.fallbackWrite, false);
  [
    "residents", "personalRecords", "careOrders", "medicationPickups", "insuranceClaims",
    "followups", "deathCertificates", "birthCertificates", "chronicScreeningTasks",
    "chronicEducationPushes", "chronicManagementPlans", "chronicFollowupStatusPolicy",
    "emergencySignalCommandInbox"
  ].forEach((collection) => assert.ok(ownershipManifest.collections[collection]?.owner, collection));
  assert.deepEqual(ownershipManifest.collections.emergencySignalCommandInbox, {
    owner: "clinical-specialties",
    classification: "restricted",
    readers: []
  });
  assert.throws(() => assertWriteAccess("shared", "residents"), /cannot write/);
  assert.throws(() => assertWriteAccess("state-data", "followups"), /cannot write/);
});

test("platform write contracts are closed by the central business manifest or system policy", () => {
  const contractedOwners = new Map();
  for (const [subdomain, contract] of Object.entries(PLATFORM_WRITE_CONTRACTS)) {
    for (const [collection, contractOwner] of Object.entries(contract.collections)) {
      const earlierOwner = contractedOwners.get(collection);
      assert.ok(!earlierOwner || earlierOwner === contractOwner, `${collection} has conflicting contract owners`);
      contractedOwners.set(collection, contractOwner);

      const policy = ownershipManifest.collections[collection];
      if (policy) {
        assert.equal(policy.owner, contractOwner, `${subdomain}:${collection}`);
        assert.equal(Object.hasOwn(policy, "readers"), true, `${collection} must declare readers`);
        assert.equal(Array.isArray(policy.readers), true, `${collection} readers must be an array`);
        assert.ok(["restricted", "internal", "de-identified"].includes(policy.classification), collection);
        continue;
      }

      assert.equal(
        SYSTEM_COLLECTION_POLICIES[collection],
        contractOwner,
        `${subdomain}:${collection} is neither business-owned nor explicitly system-owned`
      );
      assert.deepEqual(ownerForCollection(collection), {
        owner: contractOwner,
        registered: true
      });
    }
  }

  for (const [collection, owner] of Object.entries(SYSTEM_COLLECTION_POLICIES)) {
    assert.equal(ownershipManifest.collections[collection], undefined, `${collection} must not duplicate business ownership`);
    assert.deepEqual(ownerForCollection(collection), { owner, registered: true });
  }
});

test("repository commits owned writes and outbox events in one transaction", async () => {
  const applied = [];
  const outbox = [];
  let transactions = 0;
  const adapter = {
    read: async () => null,
    transact: async (work) => {
      transactions += 1;
      return work({
        apply: async (operation) => applied.push(operation),
        appendOutbox: async (event) => outbox.push(event)
      });
    }
  };
  const repository = new DomainRepository({ domain: "citizen-chronic", adapter });
  const event = createDomainEvent({
    id: "event-0001",
    domain: "citizen-chronic",
    type: "citizen-chronic.followup-scheduled.v1",
    aggregateId: "followup-1",
    aggregateVersion: 1,
    correlationId: "correlation-0001",
    payload: { residentId: "resident-1" }
  });
  const result = await repository.unitOfWork({ correlationId: "correlation-0001" })
    .put("followups", "followup-1", { status: "scheduled" }, 0)
    .publish(event)
    .commit();
  assert.deepEqual(result, { operationCount: 1, eventCount: 1 });
  assert.equal(transactions, 1);
  assert.equal(applied.length, 1);
  assert.equal(outbox[0].correlationId, "correlation-0001");
  assert.throws(() => repository.unitOfWork().put("insuranceClaims", "claim-1", {}), /owner is insurance-payment/);
});

test("versioned contract requires an explicit consumer anti-corruption adapter", () => {
  const registry = new ContractRegistry();
  assert.throws(
    () => registry.decode("resident-summary.v1", "care-coordination", {}),
    /adapter missing/
  );
  registry.registerAntiCorruptionAdapter({
    contractId: "resident-summary.v1",
    consumer: "care-coordination",
    fromExternal: (payload) => ({
      residentId: payload.id,
      identityIndex: payload.identity_index,
      status: payload.active ? "active" : "inactive"
    }),
    toExternal: (value) => ({
      id: value.residentId,
      identity_index: value.identityIndex,
      active: value.status === "active"
    })
  });
  assert.deepEqual(
    registry.decode("resident-summary.v1", "care-coordination", {
      id: "resident-1",
      identity_index: "mpi-1",
      active: true
    }),
    { residentId: "resident-1", identityIndex: "mpi-1", status: "active" }
  );
});

test("outbox publication and inbox claim make event delivery retry-safe", async () => {
  const event = createDomainEvent({
    id: "event-0002",
    domain: "public-health",
    type: "public-health.signal-detected.v1",
    aggregateId: "signal-1",
    aggregateVersion: 1
  });
  const published = [];
  const marked = [];
  assert.deepEqual(await publishPendingOutbox({
    outbox: {
      pending: async () => [event],
      markPublished: async (id) => marked.push(id)
    },
    publisher: { publish: async (item) => published.push(item.id) }
  }), ["event-0002"]);
  assert.deepEqual(published, ["event-0002"]);
  assert.deepEqual(marked, ["event-0002"]);

  const claims = new Set();
  let handled = 0;
  const consumer = new IdempotentEventConsumer({
    name: "governance-signal-projection",
    inbox: {
      claim: async (key) => claims.has(key) ? false : (claims.add(key), true)
    },
    handler: async () => { handled += 1; }
  });
  assert.equal((await consumer.consume(event)).processed, true);
  assert.equal((await consumer.consume(event)).duplicate, true);
  assert.equal(handled, 1);
});

test("correlation context is propagated and metrics are grouped by domain", async () => {
  const observability = new PlatformObservability({ now: (() => {
    let value = 100;
    return () => (value += 5);
  })() });
  const headers = {};
  const req = {
    method: "GET",
    url: "/api/health?verbose=1",
    headers: { "x-correlation-id": "trace-12345678" },
    routeDomain: "runtime"
  };
  const res = {
    statusCode: 200,
    setHeader: (name, value) => { headers[name] = value; }
  };
  await observability.run(req, res, async () => {
    assert.equal(observability.current().correlationId, "trace-12345678");
  });
  assert.equal(headers["x-correlation-id"], "trace-12345678");
  assert.equal(observability.snapshot().http[0].key, "runtime:_:GET");
});
