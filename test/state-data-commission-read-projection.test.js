"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  AUTH_USER_READ_SECRET_FIELDS,
  SERVER_MANAGED_PROCUREMENT_COLLECTIONS,
  createRouteSegments,
  firstServerManagedProcurementConflict,
  projectAuthUsersForStateRead,
  projectProcurementForStateRead,
  serverManagedProcurementState
} = require("../src/http/routes/state-data");

function responseDouble() {
  return {
    statusCode: 0,
    body: null,
    headers: {},
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = String(value);
    }
  };
}

test("commission state read removes authentication secrets without mutating the source snapshot", async () => {
  const source = {
    authUsers: [{
      id: "u-health",
      username: "health",
      password: "plaintext-must-not-leave-server",
      passwordHash: "hash-must-not-leave-server",
      externalSubject: "provider-health-subject",
      role: "commission",
      orgCode: "ORG-HEALTH-DL",
      status: "enabled"
    }],
    applicationCatalog: [{ id: "app-1" }]
  };

  const projected = projectAuthUsersForStateRead(source);

  assert.notEqual(projected, source);
  assert.notEqual(projected.authUsers, source.authUsers);
  assert.deepEqual(projected.authUsers, [{
    id: "u-health",
    username: "health",
    externalSubject: "provider-health-subject",
    role: "commission",
    orgCode: "ORG-HEALTH-DL",
    status: "enabled"
  }]);
  assert.equal(projected.applicationCatalog, source.applicationCatalog);
  assert.equal(source.authUsers[0].password, "plaintext-must-not-leave-server");
  assert.equal(source.authUsers[0].passwordHash, "hash-must-not-leave-server");
  assert.deepEqual([...AUTH_USER_READ_SECRET_FIELDS].sort(), [
    "accessToken", "apiKey", "clientSecret", "csrfToken", "password", "passwordHash",
    "privateKey", "refreshToken", "secret", "sessionId", "token"
  ]);
});

test("auth-user projection recursively removes governed credential keys without deleting business fields", () => {
  const source = {
    authUsers: [{
      id: "u-extra-secrets",
      accessToken: "access-marker",
      refreshToken: "refresh-marker",
      token: "token-marker",
      secret: "secret-marker",
      clientSecret: "client-marker",
      privateKey: "private-marker",
      apiKey: "api-marker",
      sessionId: "session-marker",
      csrfToken: "csrf-marker",
      backupPassword: "password-marker",
      providerCredentialSecret: "credential-marker",
      webhookSigningSecret: "signing-marker",
      fieldEncryptionSecret: "encryption-marker",
      credentialStatus: "verified",
      publicKey: "public-key-is-not-a-secret-field",
      accessTokenExpiresAt: "2026-09-06T00:00:00.000Z",
      nested: {
        token: "nested-token-marker",
        profile: { apiKey: "nested-api-marker", displayName: "保留业务名称" },
        sessions: [{ sessionId: "nested-session-marker", status: "active" }]
      }
    }]
  };
  const original = structuredClone(source);

  const projected = projectAuthUsersForStateRead(source);
  const serialized = JSON.stringify(projected);

  for (const marker of ["access-marker", "refresh-marker", "token-marker", "secret-marker", "client-marker",
    "private-marker", "api-marker", "session-marker", "csrf-marker", "password-marker", "credential-marker",
    "signing-marker", "encryption-marker", "nested-token-marker", "nested-api-marker", "nested-session-marker"]) {
    assert.equal(serialized.includes(marker), false, marker);
  }
  assert.equal(projected.authUsers[0].credentialStatus, "verified");
  assert.equal(projected.authUsers[0].publicKey, "public-key-is-not-a-secret-field");
  assert.equal(projected.authUsers[0].accessTokenExpiresAt, "2026-09-06T00:00:00.000Z");
  assert.equal(projected.authUsers[0].nested.profile.displayName, "保留业务名称");
  assert.equal(projected.authUsers[0].nested.sessions[0].status, "active");
  assert.deepEqual(source, original);
});

test("GET /api/state applies the auth-user projection after authorization and scoping", async () => {
  const calls = [];
  const source = {
    authUsers: [{
      id: "u-health",
      username: "health",
      password: "plaintext-marker",
      passwordHash: "hash-marker",
      externalSubject: "provider-health-subject",
      status: "enabled"
    }]
  };
  const runtime = {
    requireApiRole(_req, _res, roles, target) {
      calls.push(["authorize", roles, target]);
      return { role: "commission", accountType: "manager", orgCode: "ORG-HEALTH-DL" };
    },
    readDatabase() {
      calls.push(["read"]);
      return source;
    },
    scopeStateForUser(data) {
      calls.push(["scope"]);
      return structuredClone(data);
    },
    redactSensitiveResponse(data) {
      calls.push(["redact"]);
      return data;
    },
    sendJson(res, statusCode, body) {
      calls.push(["respond"]);
      res.statusCode = statusCode;
      res.body = body;
    }
  };
  const segment = createRouteSegments(runtime)[0];
  const response = responseDouble();

  const handled = await segment.handle(
    { method: "GET", headers: {} },
    response,
    new URL("http://local/api/state")
  );

  assert.equal(handled, true);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.authUsers[0].password, undefined);
  assert.equal(response.body.authUsers[0].passwordHash, undefined);
  assert.equal(response.body.authUsers[0].externalSubject, "provider-health-subject");
  assert.deepEqual(calls.map(([name]) => name), ["authorize", "read", "scope", "redact", "respond"]);
  assert.equal(source.authUsers[0].password, "plaintext-marker");
});

test("non-manager commission state read is denied before database access", async () => {
  for (const accountType of ["blood_quality", "auditor"]) {
    const calls = [];
    const runtime = {
      requireApiRole() {
        calls.push("authorize");
        return { role: "commission", accountType };
      },
      readDatabase() {
        calls.push("read");
        assert.fail("non-manager state read must not access database");
      },
      sendJson(res, statusCode, body) {
        calls.push("respond");
        res.statusCode = statusCode;
        res.body = body;
      }
    };
    const response = responseDouble();

    const handled = await createRouteSegments(runtime)[0].handle(
      { method: "GET", headers: {} },
      response,
      new URL("http://local/api/state")
    );

    assert.equal(handled, true);
    assert.equal(response.statusCode, 403);
    assert.equal(response.body.code, "STATE_DATA_MANAGER_REQUIRED");
    assert.deepEqual(calls, ["authorize", "respond"]);
  }
});

test("non-commission state read preserves scoped compatibility", async () => {
  for (const role of ["institution", "insurance", "citizen", "county"]) {
    const calls = [];
    const source = { residents: [{ id: "r1" }] };
    const runtime = {
      requireApiRole() {
        calls.push("authorize");
        return { role, accountType: "manager", orgCode: `ORG-${role}` };
      },
      readDatabase() {
        calls.push("read");
        return source;
      },
      scopeStateForUser(data, user) {
        calls.push("scope");
        assert.equal(user.role, role);
        return { scopedFor: role, residents: data.residents };
      },
      redactSensitiveResponse(data) {
        calls.push("redact");
        return data;
      },
      sendJson(res, statusCode, body) {
        calls.push("respond");
        res.statusCode = statusCode;
        res.body = body;
      }
    };
    const response = responseDouble();

    const handled = await createRouteSegments(runtime)[0].handle(
      { method: "GET", headers: {} },
      response,
      new URL("http://local/api/state")
    );

    assert.equal(handled, true);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.scopedFor, role);
    assert.deepEqual(calls, ["authorize", "read", "scope", "redact", "respond"]);
  }
});

test("non-manager commission state write is denied before body parsing or database access", async () => {
  const calls = [];
  const runtime = {
    requireApiRole() {
      calls.push("authorize");
      return { role: "commission", accountType: "blood_quality" };
    },
    collectJson() {
      calls.push("body");
      assert.fail("non-manager state write must not parse request body");
    },
    readDatabase() {
      calls.push("read");
      assert.fail("non-manager state write must not access database");
    },
    writeDatabase() {
      calls.push("write");
      assert.fail("non-manager state write must not persist data");
    },
    sendJson(res, statusCode, body) {
      calls.push("respond");
      res.statusCode = statusCode;
      res.body = body;
    }
  };
  const response = responseDouble();

  const handled = await createRouteSegments(runtime)[1].handle(
    { method: "PUT", headers: {} },
    response,
    new URL("http://local/api/state")
  );

  assert.equal(handled, true);
  assert.equal(response.statusCode, 403);
  assert.equal(response.body.code, "STATE_DATA_MANAGER_REQUIRED");
  assert.deepEqual(calls, ["authorize", "respond"]);
});

test("non-manager commission collection write is denied before collection parsing, body, or database access", async () => {
  const calls = [];
  const runtime = {
    requireApiRole() {
      calls.push("authorize");
      return { role: "commission", accountType: "blood_quality" };
    },
    collectJson() {
      calls.push("body");
      assert.fail("non-manager collection write must not parse request body");
    },
    readDatabase() {
      calls.push("read");
      assert.fail("non-manager collection write must not access database");
    },
    writeDatabase() {
      calls.push("write");
      assert.fail("non-manager collection write must not persist data");
    },
    sendJson(res, statusCode, body) {
      calls.push("respond");
      res.statusCode = statusCode;
      res.body = body;
    }
  };
  const response = responseDouble();

  const handled = await createRouteSegments(runtime)[1].handle(
    { method: "PUT", headers: {} },
    response,
    new URL("http://local/api/state-collections/%E0%A4%A")
  );

  assert.equal(handled, true);
  assert.equal(response.statusCode, 403);
  assert.equal(response.body.code, "STATE_DATA_MANAGER_REQUIRED");
  assert.deepEqual(calls, ["authorize", "respond"]);
});

test("non-manager commission reset is denied before seed or storage access", async () => {
  const calls = [];
  const runtime = {
    requireApiRole() {
      calls.push("authorize");
      return { role: "commission", accountType: "auditor" };
    },
    seedState() {
      calls.push("seed");
      assert.fail("non-manager reset must not read demo seed");
    },
    writeDatabase() {
      calls.push("write");
      assert.fail("non-manager reset must not persist data");
    },
    sendJson(res, statusCode, body) {
      calls.push("respond");
      res.statusCode = statusCode;
      res.body = body;
    }
  };
  const response = responseDouble();

  const handled = await createRouteSegments(runtime)[2].handle(
    { method: "POST", headers: {} },
    response,
    new URL("http://local/api/reset")
  );

  assert.equal(handled, true);
  assert.equal(response.statusCode, 403);
  assert.equal(response.body.code, "STATE_DATA_MANAGER_REQUIRED");
  assert.deepEqual(calls, ["authorize", "respond"]);
});

test("manager reset response removes authentication secrets without mutating persisted state", async () => {
  const seeded = {
    authUsers: [{ id: "u-manager", password: "plaintext-marker", passwordHash: "hash-marker" }],
    securityEvents: []
  };
  let persisted = null;
  const runtime = {
    requireApiRole: () => ({ name: "manager", role: "commission", accountType: "manager" }),
    seedState: () => structuredClone(seeded),
    prependAuditTrailEntry: (rows, entry) => [entry, ...rows],
    randomUUID: () => "reset-audit-id",
    writeDatabase(data) {
      persisted = structuredClone(data);
    },
    sendJson(res, statusCode, body) {
      res.statusCode = statusCode;
      res.body = body;
    }
  };
  const response = responseDouble();

  const handled = await createRouteSegments(runtime, { environment: { NODE_ENV: "test" } })[2].handle(
    { method: "POST", headers: {} },
    response,
    new URL("http://local/api/reset")
  );

  assert.equal(handled, true);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.authUsers[0].password, undefined);
  assert.equal(response.body.authUsers[0].passwordHash, undefined);
  assert.equal(persisted.authUsers[0].password, "plaintext-marker");
  assert.equal(persisted.authUsers[0].passwordHash, "hash-marker");
});

test("GET /api/state stops before reading state when authorization is denied", async () => {
  let readCount = 0;
  const runtime = {
    requireApiRole() {
      return null;
    },
    readDatabase() {
      readCount += 1;
      return {};
    }
  };
  const segment = createRouteSegments(runtime)[0];

  const handled = await segment.handle(
    { method: "GET", headers: {} },
    responseDouble(),
    new URL("http://local/api/state")
  );

  assert.equal(handled, true);
  assert.equal(readCount, 0);
});

test("procurement governance aggregates are server-managed against legacy state writes", () => {
  assert.deepEqual([...SERVER_MANAGED_PROCUREMENT_COLLECTIONS], ["procurementRequirementCatalog", "procurementRequirementGovernance", "procurementRequirementDelivery"]);
  const current = { procurementRequirementCatalog: { version: 1 }, procurementRequirementGovernance: { reviews: [] }, procurementRequirementDelivery: { plans: [] }, residents: [] };
  assert.deepEqual(serverManagedProcurementState(current), { procurementRequirementCatalog: { version: 1 }, procurementRequirementGovernance: { reviews: [] }, procurementRequirementDelivery: { plans: [] } });
  assert.equal(firstServerManagedProcurementConflict(current, { procurementRequirementDelivery: { plans: [{ forged: true }] } }), "procurementRequirementDelivery");
  assert.equal(firstServerManagedProcurementConflict(current, { procurementRequirementDelivery: { plans: [] } }), null);
});

test("non-commission state reads never expose procurement governance internals", () => {
  const source = {
    procurementRequirementCatalog: { documents: [{ sha256: "private-document-digest" }] },
    procurementRequirementGovernance: { commands: [{ actorDigest: "private-actor-digest" }] },
    procurementRequirementDelivery: { plans: [{ evidence: [{ digest: "private-evidence-digest" }] }] },
    residents: []
  };
  for (const role of ["citizen", "institution", "insurance", "county"]) {
    const projected = projectProcurementForStateRead(source, { role });
    SERVER_MANAGED_PROCUREMENT_COLLECTIONS.forEach((collection) => assert.equal(Object.hasOwn(projected, collection), false));
  }
  assert.equal(projectProcurementForStateRead(source, { role: "commission" }), source);
});
