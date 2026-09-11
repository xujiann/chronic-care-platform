"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { createApiRegressionRuntime } = require("./helpers/api-regression-runtime");

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

function apiLifecycleMutationCases(state, collection) {
  if (collection === "accountLifecycleVersion") {
    return [
      Number(state[collection]) + 1,
      null,
      String(state[collection]),
      -1,
      0.5,
      [],
      {},
      Number.MAX_SAFE_INTEGER + 1
    ];
  }
  return [null, {}, [...state[collection], { id: `forged-${collection}` }]];
}

async function request(baseUrl, pathname, token = "", options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  return { response, body: await response.json() };
}

async function login(baseUrl, username) {
  const result = await request(baseUrl, "/api/auth/login", "", {
    method: "POST",
    body: JSON.stringify({ username, password: "123456" })
  });
  assert.equal(result.response.status, 200, `${username}: ${JSON.stringify(result.body)}`);
  return result.body.token;
}

function assertAuthSecretsRedacted(body) {
  assert.equal(Array.isArray(body.authUsers), true);
  for (const user of body.authUsers) {
    assert.equal(Object.hasOwn(user, "password"), false);
    assert.equal(Object.hasOwn(user, "passwordHash"), false);
  }
}

test("legacy state identity boundary is enforced through real authenticated HTTP requests", async (t) => {
  const runtime = createApiRegressionRuntime();
  const baseUrl = await runtime.start();
  t.after(() => runtime.stop());

  const managerToken = await login(baseUrl, "city");
  const specialistToken = await login(baseUrl, "blood_quality");
  const citizenToken = await login(baseUrl, "citizen");

  const managerState = await request(baseUrl, "/api/state", managerToken);
  assert.equal(managerState.response.status, 200);
  assertAuthSecretsRedacted(managerState.body);

  const specialistRead = await request(baseUrl, "/api/state", specialistToken);
  assert.equal(specialistRead.response.status, 403);
  assert.equal(specialistRead.body.code, "STATE_DATA_MANAGER_REQUIRED");

  const citizenState = await request(baseUrl, "/api/state", citizenToken);
  assert.equal(citizenState.response.status, 200);
  assert.equal(Object.hasOwn(citizenState.body, "procurementRequirementCatalog"), false);
  assert.equal(Object.hasOwn(citizenState.body, "procurementRequirementGovernance"), false);
  assert.equal(Object.hasOwn(citizenState.body, "procurementRequirementDelivery"), false);

  const specialistWrite = await request(baseUrl, "/api/state", specialistToken, {
    method: "PUT",
    body: "{malformed-json"
  });
  assert.equal(specialistWrite.response.status, 403);
  assert.equal(specialistWrite.body.code, "STATE_DATA_MANAGER_REQUIRED");

  const specialistReset = await request(baseUrl, "/api/reset", specialistToken, { method: "POST" });
  assert.equal(specialistReset.response.status, 403);
  assert.equal(specialistReset.body.code, "STATE_DATA_MANAGER_REQUIRED");

  const specialistCollectionWrite = await request(baseUrl, "/api/state-collections/residents", specialistToken, {
    method: "PUT",
    body: "{malformed-json"
  });
  assert.equal(specialistCollectionWrite.response.status, 403);
  assert.equal(specialistCollectionWrite.body.code, "STATE_DATA_MANAGER_REQUIRED");

  for (const collection of SERVER_MANAGED_IDENTITY_FIELDS) {
    const collectionWrite = await request(baseUrl, `/api/state-collections/${collection}`, managerToken, {
      method: "PUT",
      body: "{malformed-json"
    });
    assert.equal(collectionWrite.response.status, 403);
    assert.equal(collectionWrite.body.code, "IDENTITY_SERVER_MANAGED_COLLECTION_WRITE_DENIED");
    assert.equal(collectionWrite.body.collection, collection);
  }

  const forgedIdentity = {
    ...managerState.body,
    authUsers: []
  };
  const conflict = await request(baseUrl, "/api/state", managerToken, {
    method: "PUT",
    body: JSON.stringify(forgedIdentity)
  });
  assert.equal(conflict.response.status, 409);
  assert.equal(conflict.body.code, "IDENTITY_SERVER_MANAGED_COLLECTION_CONFLICT");
  assert.equal(conflict.body.collection, "authUsers");

  for (const collection of IDENTITY_LIFECYCLE_FIELDS) {
    for (const [caseIndex, forgedValue] of apiLifecycleMutationCases(managerState.body, collection).entries()) {
      const lifecycleConflict = await request(baseUrl, "/api/state", managerToken, {
        method: "PUT",
        body: JSON.stringify({
          ...managerState.body,
          [collection]: forgedValue
        })
      });
      assert.equal(lifecycleConflict.response.status, 409, `${collection} mutation ${caseIndex}`);
      assert.equal(lifecycleConflict.body.code, "IDENTITY_SERVER_MANAGED_COLLECTION_CONFLICT");
      assert.equal(lifecycleConflict.body.collection, collection);

      const unchangedState = await request(baseUrl, "/api/state", managerToken);
      assert.equal(unchangedState.response.status, 200);
      assert.deepEqual(unchangedState.body, managerState.body, `${collection} mutation ${caseIndex} must perform zero writes`);
    }
  }

  const compatiblePayload = structuredClone(managerState.body);
  for (const collection of SERVER_MANAGED_IDENTITY_FIELDS) delete compatiblePayload[collection];
  const compatibleWrite = await request(baseUrl, "/api/state", managerToken, {
    method: "PUT",
    body: JSON.stringify(compatiblePayload)
  });
  assert.equal(compatibleWrite.response.status, 200, JSON.stringify(compatibleWrite.body));
  assertAuthSecretsRedacted(compatibleWrite.body);
  assert.equal(compatibleWrite.body.authOrganizations.length, managerState.body.authOrganizations.length);
  for (const field of IDENTITY_LIFECYCLE_FIELDS) {
    assert.deepEqual(compatibleWrite.body[field], managerState.body[field], `omission must preserve ${field}`);
  }

  const deepEqualWrite = await request(baseUrl, "/api/state", managerToken, {
    method: "PUT",
    body: JSON.stringify(structuredClone(compatibleWrite.body))
  });
  assert.equal(deepEqualWrite.response.status, 200, JSON.stringify(deepEqualWrite.body));
  assertAuthSecretsRedacted(deepEqualWrite.body);
  for (const field of IDENTITY_LIFECYCLE_FIELDS) {
    assert.deepEqual(deepEqualWrite.body[field], managerState.body[field], `deep-equal input must preserve ${field}`);
  }

  const reset = await request(baseUrl, "/api/reset", managerToken, { method: "POST" });
  assert.equal(reset.response.status, 200);
  assertAuthSecretsRedacted(reset.body);
});
