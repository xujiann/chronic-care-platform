"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  appendSessionSecurityAudit,
  querySessionSecurityAudits,
  summarizeSessionSecurityAudits
} = require("../src/identity-security/session-security-audit");
const { createRouteSegments: createIdentitySegments } = require("../src/http/routes/identity-security");
const { createRouteSegments: createRuntimeSegments } = require("../src/http/routes/runtime");

function prependAuditTrailEntry(rows, entry) {
  return [{ ...entry, previousAuditHash: "", auditHash: `hash-${entry.id}` }, ...(rows || [])];
}

function responseCapture() {
  return {
    statusCode: 0,
    body: null,
    send(status, body) {
      this.statusCode = status;
      this.body = body;
    }
  };
}

test("session security audit correlates requests without retaining raw session or client secrets", () => {
  let data = { securityEvents: [] };
  let sequence = 0;
  const req = {
    method: "POST",
    url: "/api/auth/login?token=must-not-persist",
    correlationId: "trace-login-12345678",
    headers: {
      authorization: "Bearer raw-token",
      "user-agent": "Sensitive Browser 1.0"
    },
    socket: { remoteAddress: "192.0.2.8" }
  };
  const entry = appendSessionSecurityAudit({
    req,
    session: { sessionId: "raw-session-id", token: "raw-token" },
    event: {
      actor: "operator",
      role: "commission",
      action: "local-password-login",
      result: "allowed",
      detail: "signed session issued"
    },
    readDatabase: () => data,
    writeDatabase: (next) => { data = next; },
    prependAuditTrailEntry,
    randomUUID: () => `audit-${++sequence}`,
    now: () => new Date("2026-08-03T12:00:00.000Z")
  });

  assert.equal(entry.correlationId, "trace-login-12345678");
  assert.equal(entry.request.path, "/api/auth/login");
  assert.equal(entry.category, "session-security");
  assert.equal(entry.sessionRef.length, 24);
  assert.equal(entry.clientFingerprint.length, 24);
  const persisted = JSON.stringify(data.securityEvents);
  ["raw-session-id", "raw-token", "192.0.2.8", "Sensitive Browser", "must-not-persist"].forEach((secret) => {
    assert.equal(persisted.includes(secret), false, `${secret} must not be persisted`);
  });
});

test("session security audit query is exact, bounded and summarized", () => {
  const rows = [
    { category: "session-security", correlationId: "trace-a", action: "logout", result: "allowed" },
    { category: "session-security", correlationId: "trace-b", action: "logout", result: "partial" },
    { category: "session-security", correlationId: "trace-a", action: "login", result: "denied" },
    { category: "other", correlationId: "trace-a", action: "logout", result: "allowed" }
  ];
  const filtered = querySessionSecurityAudits(rows, { correlationId: "trace-a", limit: 200 });
  assert.equal(filtered.length, 2);
  assert.deepEqual(summarizeSessionSecurityAudits(filtered), {
    total: 2,
    allowed: 1,
    denied: 1,
    partial: 0,
    correlations: 1
  });
});

test("identity login persists a structured audit linked to the server correlation id", async () => {
  let data = { securityEvents: [] };
  let sequence = 0;
  const response = responseCapture();
  const runtime = {
    appendSecurityEvent: () => {},
    collectJson: async () => ({ username: "city", password: "correct" }),
    createSession: async (user) => ({
      sessionId: "session-raw-001",
      token: "signed-token-raw",
      expiresAt: "2026-08-04T12:00:00.000Z",
      user
    }),
    findAuthUser: () => ({ id: "u1", username: "city", name: "City Operator", role: "commission", home: "/platform" }),
    isProductionRuntime: () => false,
    prependAuditTrailEntry,
    randomUUID: () => `route-audit-${++sequence}`,
    readDatabase: () => data,
    sendJson: (res, status, body) => res.send(status, body),
    verifyPassword: () => true,
    writeDatabase: (next) => { data = next; }
  };
  const segment = createIdentitySegments(runtime).find((item) => item.id === "identity-security-02");
  const req = {
    method: "POST",
    url: "/api/auth/login",
    correlationId: "trace-route-login-1234",
    headers: { authorization: "Bearer ignored", "user-agent": "test-agent" },
    socket: { remoteAddress: "127.0.0.1" }
  };

  assert.equal(await segment.handle(req, response, new URL("http://localhost/api/auth/login")), true);
  assert.equal(response.statusCode, 200);
  assert.equal(data.securityEvents[0].correlationId, "trace-route-login-1234");
  assert.equal(data.securityEvents[0].action, "local-password-login");
  assert.equal(data.securityEvents[0].result, "allowed");
  assert.equal(JSON.stringify(data.securityEvents).includes("session-raw-001"), false);
  assert.equal(JSON.stringify(data.securityEvents).includes("signed-token-raw"), false);
});

test("commission can query session audits by correlation id", async () => {
  const rows = [
    { category: "session-security", correlationId: "trace-query-1234", action: "logout", result: "allowed" },
    { category: "session-security", correlationId: "trace-other-1234", action: "login", result: "denied" }
  ];
  const response = responseCapture();
  const runtime = {
    appendSecurityEvent: () => {},
    randomUUID: () => "unused",
    readDatabase: () => ({ securityEvents: rows }),
    requireApiRole: () => ({ name: "Auditor", role: "commission" }),
    sendJson: (res, status, body) => res.send(status, body)
  };
  const segment = createIdentitySegments(runtime).find((item) => item.id === "identity-security-01");
  const req = {
    method: "GET",
    url: "/api/security/session-audit?correlationId=trace-query-1234",
    correlationId: "trace-query-request-1234"
  };

  assert.equal(await segment.handle(req, response, new URL(`http://localhost${req.url}`)), true);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.correlationId, "trace-query-request-1234");
  assert.equal(response.body.events.length, 1);
  assert.equal(response.body.events[0].correlationId, "trace-query-1234");
});

test("runtime dependency health reports degraded dependencies with correlation", async () => {
  const response = responseCapture();
  const securityEvents = [];
  const runtime = {
    appendSecurityEvent: (event) => securityEvents.push(event),
    buildRuntimeMetrics: () => ({
      dependencies: {
        "session-store": { ok: true, latencyMs: 2, checkedAt: "2026-08-03T12:00:00.000Z" },
        database: { ok: false, latencyMs: 15, detail: "probe timeout", checkedAt: "2026-08-03T12:00:01.000Z" }
      }
    }),
    readDatabase: () => ({}),
    requireApiRole: () => ({ name: "Runtime Operator", role: "commission" }),
    sendJson: (res, status, body) => res.send(status, body)
  };
  const segment = createRuntimeSegments(runtime).find((item) => item.id === "runtime-01");
  const req = {
    method: "GET",
    url: "/api/runtime/dependencies",
    correlationId: "trace-health-12345678"
  };

  assert.equal(await segment.handle(req, response, new URL("http://localhost/api/runtime/dependencies")), true);
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.correlationId, "trace-health-12345678");
  assert.deepEqual(response.body.summary, { total: 2, available: 1, unavailable: 1 });
  assert.match(securityEvents[0].detail, /trace-health-12345678/);
});
