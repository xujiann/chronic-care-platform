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

const SERVER_MANAGED_IDENTITY_FIELDS = Object.freeze([
  "authUsers",
  "authOrganizations",
  "accountLifecycleRequests",
  "accountTemporaryGrants",
  "accountLifecycleCommandReceipts",
  "accountLifecycleVersion"
]);

const IDENTITY_LIFECYCLE_FIELDS = Object.freeze([
  "accountLifecycleRequests",
  "accountTemporaryGrants",
  "accountLifecycleCommandReceipts",
  "accountLifecycleVersion"
]);

function collectionMutationCases(value) {
  const removedField = structuredClone(value);
  delete removedField[0][Object.keys(removedField[0])[0]];
  return [
    { label: "null", value: null },
    { label: "object", value: {} },
    { label: "empty", value: [] },
    { label: "append", value: [...structuredClone(value), { id: "forged-item" }] },
    { label: "reorder", value: [...structuredClone(value)].reverse() },
    { label: "delete internal field", value: removedField }
  ];
}

function lifecycleMutationCases(original, collection) {
  if (collection !== "accountLifecycleVersion") return collectionMutationCases(original[collection]);
  return [
    { label: "null", value: null },
    { label: "numeric string", value: String(original[collection]) },
    { label: "negative", value: -1 },
    { label: "fraction", value: 7.5 },
    { label: "array", value: [] },
    { label: "object", value: {} },
    { label: "unsafe integer", value: Number.MAX_SAFE_INTEGER + 1 }
  ];
}

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
    requireApiRole: () => ({ name: "commissioner", role: "commission", accountType: "manager" }),
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

test("legacy full-state write rejects identity mutations and preserves omitted identity collections", async () => {
  const original = {
    authUsers: [{ id: "u-manager", username: "manager", password: "plaintext-marker", passwordHash: "hash-marker" }],
    authOrganizations: [{ orgCode: "ORG-HEALTH", status: "enabled" }],
    accountLifecycleRequests: [
      { id: "request-1", action: "deactivate" },
      { id: "request-2", action: "temporary-grant" }
    ],
    accountTemporaryGrants: [
      { id: "grant-1", status: "active" },
      { id: "grant-2", status: "expired" }
    ],
    accountLifecycleCommandReceipts: [
      { id: "receipt-1", requestId: "request-1" },
      { id: "receipt-2", requestId: "request-2" }
    ],
    accountLifecycleVersion: 7,
    residents: [{ id: "r1", name: "before" }],
    securityEvents: [],
    dataAccessLogs: [],
    storageMeta: {}
  };
  let state = structuredClone(original);
  let payload = structuredClone(original);
  let writes = 0;
  let responseStatus = null;
  let responseBody = null;
  const runtime = {
    auditTrailRowsMatch: (left, right) => JSON.stringify(left) === JSON.stringify(right),
    collectJson: async () => structuredClone(payload),
    normalizeState: (value) => structuredClone(value),
    prependAuditTrailEntry: (rows, entry) => [entry, ...rows],
    randomUUID: () => "identity-boundary-audit-id",
    readDatabase: () => structuredClone(state),
    requireApiRole: () => ({ name: "manager", role: "commission", accountType: "manager" }),
    sendJson: (_res, status, body) => {
      responseStatus = status;
      responseBody = body;
    },
    verifyAuditTrail: () => ({ passed: true }),
    writeDatabase(data) {
      writes += 1;
      state = structuredClone(data);
    }
  };
  const segment = stateDataRoutes.createRouteSegments(runtime)[1];

  assert.deepEqual(stateDataRoutes.SERVER_MANAGED_IDENTITY_COLLECTIONS, SERVER_MANAGED_IDENTITY_FIELDS);

  for (const collection of ["authUsers", "authOrganizations"]) {
    state = structuredClone(original);
    payload = structuredClone(original);
    payload[collection] = [];
    await segment.handle({ method: "PUT", headers: {} }, responseDouble(), new URL("http://local/api/state"));
    assert.equal(responseStatus, 409);
    assert.equal(responseBody.code, "IDENTITY_SERVER_MANAGED_COLLECTION_CONFLICT");
    assert.equal(responseBody.collection, collection);
    assert.deepEqual(state, original);
    assert.equal(writes, 0);
  }

  for (const collection of IDENTITY_LIFECYCLE_FIELDS) {
    for (const mutation of lifecycleMutationCases(original, collection)) {
      state = structuredClone(original);
      payload = structuredClone(original);
      payload[collection] = structuredClone(mutation.value);
      await segment.handle({ method: "PUT", headers: {} }, responseDouble(), new URL("http://local/api/state"));
      assert.equal(responseStatus, 409, `${collection}: ${mutation.label}`);
      assert.equal(responseBody.code, "IDENTITY_SERVER_MANAGED_COLLECTION_CONFLICT");
      assert.equal(responseBody.collection, collection);
      assert.deepEqual(state, original, `${collection}: ${mutation.label} must preserve authoritative state`);
      assert.equal(writes, 0, `${collection}: ${mutation.label} must perform zero writes`);
    }
  }

  payload = {
    residents: [{ id: "r1", name: "after" }],
    securityEvents: [],
    dataAccessLogs: [],
    storageMeta: {}
  };
  await segment.handle({ method: "PUT", headers: {} }, responseDouble(), new URL("http://local/api/state"));
  assert.equal(responseStatus, 200);
  assert.equal(writes, 1);
  assert.deepEqual(state.authUsers, original.authUsers);
  assert.deepEqual(state.authOrganizations, original.authOrganizations);
  for (const field of IDENTITY_LIFECYCLE_FIELDS) {
    assert.deepEqual(state[field], original[field], `omission must preserve ${field}`);
  }
  assert.equal(responseBody.authUsers[0].password, undefined);
  assert.equal(responseBody.authUsers[0].passwordHash, undefined);
  assert.equal(state.authUsers[0].password, "plaintext-marker");
  assert.equal(state.authUsers[0].passwordHash, "hash-marker");

  payload = {
    ...structuredClone(state),
    authUsers: stateDataRoutes.projectAuthUsersForStateRead({ authUsers: state.authUsers }).authUsers
  };
  await segment.handle({ method: "PUT", headers: {} }, responseDouble(), new URL("http://local/api/state"));
  assert.equal(responseStatus, 200);
  assert.equal(writes, 2);
  assert.equal(state.authUsers[0].password, "plaintext-marker");
  assert.equal(state.authUsers[0].passwordHash, "hash-marker");
  for (const field of IDENTITY_LIFECYCLE_FIELDS) {
    assert.deepEqual(state[field], original[field], `deep-equal input must preserve ${field}`);
  }
});

test("identity collection writes fail closed before body parsing or storage access", async () => {
  for (const collection of stateDataRoutes.SERVER_MANAGED_IDENTITY_COLLECTIONS) {
    const calls = [];
    let responseStatus = null;
    let responseBody = null;
    const runtime = {
      COLLECTION_WRITE_KEYS: new Set([collection]),
      requireApiRole() {
        calls.push("authorize");
        return { name: "manager", role: "commission", accountType: "manager" };
      },
      collectJson() {
        calls.push("body");
        assert.fail("identity collection denial must precede request body parsing");
      },
      readDatabase() {
        calls.push("read");
        assert.fail("identity collection denial must precede database access");
      },
      writeDatabase() {
        calls.push("write");
        assert.fail("identity collection denial must never persist data");
      },
      sendJson(_res, status, body) {
        calls.push("respond");
        responseStatus = status;
        responseBody = body;
      }
    };
    const segment = stateDataRoutes.createRouteSegments(runtime)[1];

    const handled = await segment.handle(
      { method: "PUT", headers: {} },
      responseDouble(),
      new URL(`http://local/api/state-collections/${collection}`)
    );

    assert.equal(handled, true);
    assert.equal(responseStatus, 403);
    assert.equal(responseBody.code, "IDENTITY_SERVER_MANAGED_COLLECTION_WRITE_DENIED");
    assert.equal(responseBody.collection, collection);
    assert.deepEqual(calls, ["authorize", "respond"]);
  }
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
    storageMeta: {
      collectionVersions: {
        residents: 1,
        regionalDataSharingScope: 2
      }
    }
  };
  let responseStatus = null;
  let responseBody = null;
  const runtime = {
    collectJson: async () => structuredClone(payload),
    readDatabase: () => structuredClone(current),
    requireApiRole: () => ({ name: "commissioner", role: "commission", accountType: "manager" }),
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

test("production rejects demo reset before seed or storage access", async () => {
  let responseStatus = null;
  let responseBody = null;
  const runtime = {
    requireApiRole: () => ({ name: "commissioner", role: "commission", accountType: "manager" }),
    seedState: () => assert.fail("production reset must not read demo seed"),
    sendJson: (_res, status, body) => {
      responseStatus = status;
      responseBody = body;
    },
    writeDatabase: () => assert.fail("production reset must not write state")
  };
  const segment = stateDataRoutes.createRouteSegments(runtime, {
    environment: { NODE_ENV: "production" }
  })[2];

  await segment.handle(
    { method: "POST", headers: {} },
    responseDouble(),
    new URL("http://local/api/reset")
  );

  assert.equal(responseStatus, 403);
  assert.equal(responseBody.code, "DEMO_RESET_DISABLED_IN_PRODUCTION");
});
