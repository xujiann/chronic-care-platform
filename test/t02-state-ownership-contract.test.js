"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  LEGACY_FULL_STATE_CONTRACT,
  changedCollections,
  createOwnershipEnforcedRuntime,
  ownerForCollection,
  setLegacyWriteHeaders,
  setOwnedWriteHeaders,
  validatePlatformWriteContracts
} = require("../src/http/routes/t02-state-ownership-contract");
const stateDataRoutes = require("../src/http/routes/state-data");

function responseDouble() {
  return {
    headers: {},
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = String(value);
    }
  };
}

test("T02 ownership contracts agree with the platform ownership manifest", () => {
  assert.equal(validatePlatformWriteContracts(), true);
  assert.deepEqual(ownerForCollection("personalRecords"), {
    owner: "citizen-chronic",
    registered: true
  });
  assert.throws(
    () => ownerForCollection("futureCatchAll"),
    (error) => error.code === "T02_DATA_OWNER_UNDECLARED"
  );
  assert.deepEqual(ownerForCollection("legacyKnownState", { allowLegacy: true }), {
    owner: "platform-governance",
    registered: false,
    migrationRequired: true
  });
});

test("platform-governance writer fails closed on undeclared collection changes", () => {
  const current = {
    productionGoNoGoDecision: { status: "no-go" },
    securityEvents: []
  };
  let persisted = null;
  let persistedOptions = null;
  const runtime = {
    readDatabase: () => structuredClone(current),
    writeDatabase(data, options) {
      persisted = structuredClone(data);
      persistedOptions = structuredClone(options);
    }
  };
  const owned = createOwnershipEnforcedRuntime(runtime, "production-operations");
  owned.writeDatabase({
    productionGoNoGoDecision: { status: "go" },
    securityEvents: [{ id: "audit-1" }]
  });
  assert.equal(persisted.productionGoNoGoDecision.status, "go");
  assert.equal(
    persistedOptions.ownershipContract.id,
    "platform-governance.production-operations-write.v1"
  );
  assert.deepEqual(persistedOptions.ownershipContract.collections, [
    { collection: "productionGoNoGoDecision", owner: "platform-governance" },
    { collection: "securityEvents", owner: "platform-governance" }
  ]);
  assert.throws(
    () => owned.writeDatabase({ ...current, residents: [] }),
    (error) =>
      error.code === "T02_DATA_OWNERSHIP_CONTRACT_VIOLATION" &&
      error.collections.includes("residents")
  );
});

test("legacy and delegated state writes expose machine-readable ownership headers", () => {
  const legacy = responseDouble();
  setLegacyWriteHeaders(legacy);
  assert.equal(legacy.headers.deprecation, "true");
  assert.equal(legacy.headers.sunset, LEGACY_FULL_STATE_CONTRACT.sunset);
  assert.equal(legacy.headers["x-write-contract"], LEGACY_FULL_STATE_CONTRACT.id);
  assert.match(legacy.headers.link, /state-collections/);

  const delegated = responseDouble();
  setOwnedWriteHeaders(delegated, "personalRecords");
  assert.equal(delegated.headers["x-data-owner"], "citizen-chronic");
  assert.equal(
    delegated.headers["x-write-contract"],
    "state-data.personalRecords.delegated-write.v1"
  );
});

test("legacy full-state route audits delegated owners and blocks new catch-all keys", async () => {
  let state = {
    residents: [{ id: "r1", name: "before" }],
    securityEvents: [],
    dataAccessLogs: [],
    storageMeta: {}
  };
  let payload = { ...structuredClone(state), residents: [{ id: "r1", name: "after" }] };
  let responseBody = null;
  let responseStatus = null;
  const runtime = {
    COLLECTION_WRITE_KEYS: new Set(["residents"]),
    auditTrailRowsMatch: (left, right) => JSON.stringify(left) === JSON.stringify(right),
    auditTrailRowsMatchById: () => true,
    collectJson: async () => structuredClone(payload),
    normalizeState: (value) => structuredClone(value),
    prependAuditEventPreservingTrail: (entry, rows) => [entry, ...rows],
    prependAuditTrailEntry: (rows, entry) => [entry, ...rows],
    randomUUID: () => "audit-id",
    readDatabase: () => structuredClone(state),
    redactSensitiveResponse: (value) => value,
    requireApiRole: () => ({ name: "commissioner", role: "commission" }),
    resealAuditTrail: (rows) => rows,
    scopeStateForUser: (value) => value,
    sealAuditTrail: (rows) => rows,
    seedState: () => structuredClone(state),
    sendJson: (_res, status, body) => {
      responseStatus = status;
      responseBody = body;
    },
    storageMeta: () => ({ collectionVersions: { residents: 2 } }),
    verifyAuditTrail: () => ({ passed: true }),
    writeDatabase: (data) => {
      state = structuredClone(data);
    }
  };
  const segment = stateDataRoutes.createRouteSegments(runtime)[1];
  const res = responseDouble();
  await segment.handle({ method: "PUT", headers: {} }, res, new URL("http://local/api/state"));
  assert.equal(responseStatus, 200);
  assert.equal(res.headers.deprecation, "true");
  assert.equal(
    responseBody.securityEvents[0].ownershipContract.collections[0].owner,
    "identity-security"
  );

  const preservedState = structuredClone(state);
  payload = structuredClone(state);
  payload.securityEvents[0].action = "client-side audit mutation";
  await segment.handle({ method: "PUT", headers: {} }, responseDouble(), new URL("http://local/api/state"));
  assert.equal(responseStatus, 400);
  assert.equal(responseBody.code, "AUDIT_TRAIL_WRITE_REJECTED");
  assert.deepEqual(state, preservedState);

  payload = { ...structuredClone(state), futureCatchAll: [] };
  const blockedRes = responseDouble();
  await segment.handle({ method: "PUT", headers: {} }, blockedRes, new URL("http://local/api/state"));
  assert.equal(responseStatus, 400);
  assert.equal(responseBody.code, "UNREGISTERED_STATE_COLLECTION");
  assert.deepEqual(responseBody.collections, ["futureCatchAll"]);
});

test("collection diff ignores storage metadata and remains deterministic", () => {
  assert.deepEqual(
    changedCollections(
      { residents: [{ id: "r1" }], storageMeta: { version: 1 } },
      { residents: [{ id: "r2" }], storageMeta: { version: 2 }, securityEvents: [] }
    ),
    ["residents", "securityEvents"]
  );
});

test("collection diff ignores object property insertion order", () => {
  assert.deepEqual(
    changedCollections(
      {
        regionalDataSharingScope: {
          id: "regional-data-sharing",
          statusNorms: { ready: "可共享", blocked: "暂缓共享" }
        }
      },
      {
        regionalDataSharingScope: {
          statusNorms: { blocked: "暂缓共享", ready: "可共享" },
          id: "regional-data-sharing"
        }
      }
    ),
    []
  );
});

test("legacy full-state conflicts prioritize registered collection owners", async () => {
  const current = {
    residents: [{ id: "r1", name: "current" }],
    regionalDataSharingScope: { status: "current" },
    securityEvents: [],
    dataAccessLogs: [],
    storageMeta: {
      collectionVersions: {
        residents: 2,
        regionalDataSharingScope: 2
      }
    }
  };
  const payload = {
    ...structuredClone(current),
    residents: [{ id: "r1", name: "stale" }],
    regionalDataSharingScope: { status: "stale" },
    storageMeta: {
      collectionVersions: {
        residents: 1,
        regionalDataSharingScope: 1
      }
    }
  };
  let responseStatus = null;
  let responseBody = null;
  const runtime = {
    collectJson: async () => structuredClone(payload),
    readDatabase: () => structuredClone(current),
    requireApiRole: () => ({ name: "commissioner", role: "commission" }),
    sendJson: (_res, status, body) => {
      responseStatus = status;
      responseBody = body;
    }
  };
  const segment = stateDataRoutes.createRouteSegments(runtime)[1];

  await segment.handle(
    { method: "PUT", headers: {} },
    responseDouble(),
    new URL("http://local/api/state")
  );

  assert.equal(responseStatus, 409);
  assert.equal(responseBody.code, "STORAGE_CONFLICT");
  assert.equal(responseBody.collection, "residents");
});
