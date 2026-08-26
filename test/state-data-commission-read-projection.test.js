"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  AUTH_USER_READ_SECRET_FIELDS,
  createRouteSegments,
  projectAuthUsersForStateRead
} = require("../src/http/routes/state-data");

function responseDouble() {
  return {
    statusCode: 0,
    body: null
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
  assert.deepEqual([...AUTH_USER_READ_SECRET_FIELDS].sort(), ["password", "passwordHash"]);
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
      return { role: "commission", orgCode: "ORG-HEALTH-DL" };
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
