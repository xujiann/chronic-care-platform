"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  SESSION_SECURITY_AUDIT_PERSISTENCE_CONTRACT,
  SessionSecurityAuditError,
  appendSessionSecurityAudit,
  createSessionSecurityAuditRepository,
  executeSecurityControlAction,
  querySessionSecurityAudits,
  summarizeSessionSecurityAudits
} = require("../src/identity-security/session-security-audit");
const { createRouteSegments: createIdentitySegments } = require("../src/http/routes/identity-security");
const { createRouteSegments: createRuntimeSegments } = require("../src/http/routes/runtime");
const { createAuthSecurityStateStore } = require("../auth-security-state-store");

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

function memoryAuthSecurityRuntime() {
  const store = createAuthSecurityStateStore({
    mode: "memory",
    env: { NODE_ENV: "test" },
    keySecret: "t01-runtime-identity-hardening-test-key"
  });
  return {
    authLoginLockStatus: (input) => store.getLoginLock(input),
    clearAuthLoginFailures: (input) => store.clearLoginFailures(input),
    consumeAuthRateLimit: (input) => store.consumeRateLimit(input),
    recordAuthLoginFailure: (input) => store.recordLoginFailure(input),
    requestRateLimitSubject: () => "t01-test-network"
  };
}

test("session security audit correlates requests without retaining raw session or client secrets", async () => {
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
  const entry = await appendSessionSecurityAudit({
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

test("session security audit repository serializes concurrent commands without lost writes", async () => {
  let data = { securityEvents: [] };
  let writes = 0;
  let sequence = 0;
  const repository = createSessionSecurityAuditRepository({
    readDatabase: () => data,
    writeDatabase: async (next) => {
      await new Promise((resolve) => setTimeout(resolve, writes % 3));
      writes += 1;
      data = next;
    },
    prependAuditTrailEntry,
    randomUUID: () => `concurrent-audit-${++sequence}`,
    now: () => new Date("2026-08-03T12:00:00.000Z")
  });

  await Promise.all(Array.from({ length: 24 }, (_, index) => appendSessionSecurityAudit({
    req: {
      method: "POST",
      url: `/api/auth/test?token=secret-${index}`,
      correlationId: `trace-concurrent-${String(index).padStart(4, "0")}`,
      headers: { "user-agent": `private-agent-${index}` },
      socket: { remoteAddress: `192.0.2.${index}` }
    },
    event: {
      actor: `actor-${index}`,
      role: "commission",
      action: "concurrent-session-action",
      result: "allowed"
    },
    commandId: `t01-concurrent-command-${index}`,
    randomUUID: () => `unused-${index}`,
    repository
  })));

  assert.equal(writes, 24);
  assert.equal(data.securityEvents.filter((item) => item.category === "session-security").length, 24);
  assert.equal(new Set(data.securityEvents.map((item) => item.commandRef)).size, 24);
  assert.equal(Math.max(...data.securityEvents.map((item) => item.streamVersion)), 24);
});

test("session security command replay is idempotent and payload drift is HTTP 409", async () => {
  let data = { securityEvents: [] };
  let writes = 0;
  let sequence = 0;
  const repository = createSessionSecurityAuditRepository({
    readDatabase: () => data,
    writeDatabase: (next) => {
      writes += 1;
      data = next;
    },
    prependAuditTrailEntry,
    randomUUID: () => `idempotent-audit-${++sequence}`,
    now: () => new Date("2026-08-03T12:00:00.000Z")
  });
  const base = {
    req: { method: "POST", url: "/api/auth/test", correlationId: "trace-idempotent-1234" },
    event: { actor: "operator", role: "commission", action: "logout", result: "allowed" },
    commandId: "t01-idempotent-command-001",
    randomUUID: () => "unused",
    repository
  };

  const first = await appendSessionSecurityAudit(base);
  const replay = await appendSessionSecurityAudit(base);
  assert.equal(replay.id, first.id);
  assert.equal(writes, 1);
  assert.equal(data.securityEvents.length, 1);

  await assert.rejects(
    appendSessionSecurityAudit({
      ...base,
      event: { ...base.event, result: "denied" }
    }),
    (error) => {
      assert.equal(error instanceof SessionSecurityAuditError, true);
      assert.equal(error.code, "SESSION_SECURITY_AUDIT_IDEMPOTENCY_CONFLICT");
      assert.equal(error.statusCode, 409);
      return true;
    }
  );
  assert.equal(writes, 1);
});

test("security control mutation, audit and command receipt share one commit", async () => {
  let data = {
    securityAcceptanceLedger: [{ id: "control-1", status: "pending", evidence: "", next: "archive" }],
    securityEvents: []
  };
  let writes = 0;
  let sequence = 0;
  const repository = createSessionSecurityAuditRepository({
    readDatabase: () => data,
    writeDatabase: (next) => {
      writes += 1;
      data = next;
    },
    prependAuditTrailEntry,
    randomUUID: () => `control-audit-${++sequence}`,
    now: () => new Date("2026-08-03T12:00:00.000Z")
  });
  const command = {
    repository,
    commandId: "t01-security-control-001",
    req: { method: "POST", url: "/api/security/controls/control-1/actions?token=raw" },
    user: { name: "Security Officer", username: "security", role: "commission" },
    controlId: "control-1",
    payload: { status: "archived", evidence: "evidence-1", action: "archive-evidence" }
  };

  const first = await executeSecurityControlAction(command);
  const replay = await executeSecurityControlAction(command);
  assert.equal(writes, 1);
  assert.equal(first.result.status, "archived");
  assert.equal(replay.idempotentReplay, true);
  assert.equal(data.securityAcceptanceLedger[0].evidence, "evidence-1");
  assert.equal(data.securityEvents[0].category, "session-security");
  assert.equal(data.securityEvents[0].resultSnapshot.evidence, "evidence-1");
  assert.equal(data.securityEvents[0].intentRef.length, 24);
});

test("failed persistence rolls back the security action and its audit copy", async () => {
  const data = {
    securityAcceptanceLedger: [{ id: "control-rollback", status: "pending", evidence: "" }],
    securityEvents: []
  };
  const repository = createSessionSecurityAuditRepository({
    readDatabase: () => data,
    writeDatabase: () => {
      throw new Error("simulated persistence failure");
    },
    prependAuditTrailEntry,
    randomUUID: () => "rollback-audit-1",
    now: () => new Date("2026-08-03T12:00:00.000Z")
  });

  await assert.rejects(executeSecurityControlAction({
    repository,
    commandId: "t01-security-control-rollback",
    req: { method: "POST", url: "/api/security/controls/control-rollback/actions" },
    user: { name: "Security Officer", username: "security", role: "commission" },
    controlId: "control-rollback",
    payload: { status: "archived", evidence: "must-not-commit" }
  }), /simulated persistence failure/);

  assert.equal(data.securityAcceptanceLedger[0].status, "pending");
  assert.equal(data.securityAcceptanceLedger[0].evidence, "");
  assert.equal(data.securityEvents.length, 0);
});

test("security control route replays equal commands and returns 409 for payload drift", async () => {
  let data = {
    securityAcceptanceLedger: [{ id: "control-route", status: "pending", evidence: "" }],
    securityEvents: []
  };
  let payload = { status: "archived", evidence: "route-evidence" };
  let writes = 0;
  let sequence = 0;
  const runtime = {
    collectJson: async () => payload,
    prependAuditTrailEntry,
    randomUUID: () => `route-control-audit-${++sequence}`,
    readDatabase: () => data,
    requireApiRole: () => ({ name: "Auditor", username: "auditor", role: "commission" }),
    sendJson: (res, status, body) => res.send(status, body),
    writeDatabase: (next) => {
      writes += 1;
      data = next;
    }
  };
  const segment = createIdentitySegments(runtime).find((item) => item.id === "identity-security-02");
  const req = {
    method: "POST",
    url: "/api/security/controls/control-route/actions",
    correlationId: "trace-control-route-1234",
    headers: { "idempotency-key": "t01-control-route-command-001" }
  };

  const first = responseCapture();
  const replay = responseCapture();
  assert.equal(await segment.handle(req, first, new URL(`http://localhost${req.url}`)), true);
  assert.equal(await segment.handle(req, replay, new URL(`http://localhost${req.url}`)), true);
  assert.equal(first.statusCode, 200);
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.body.idempotentReplay, true);
  assert.equal(writes, 1);

  payload = { status: "rejected", evidence: "drift" };
  const conflict = responseCapture();
  assert.equal(await segment.handle(req, conflict, new URL(`http://localhost${req.url}`)), true);
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.body.code, "SESSION_SECURITY_AUDIT_IDEMPOTENCY_CONFLICT");
  assert.equal(writes, 1);
});

test("session audit query projection is exact, bounded and never exposes request secrets", () => {
  const rows = Array.from({ length: 120 }, (_, index) => ({
    id: `audit-${index}`,
    category: "session-security",
    schemaVersion: "session-security-audit/v2",
    correlationId: "trace-secret-query",
    actor: "operator",
    role: "commission",
    action: "logout",
    result: "allowed",
    detail: "safe",
    request: { method: "POST", path: `/api/auth/logout?token=raw-query-${index}` },
    sessionRef: "raw-session-id",
    clientFingerprint: "192.0.2.8 Sensitive Browser",
    commandRef: "raw-token"
  }));
  const filtered = querySessionSecurityAudits(rows, {
    correlationId: "trace-secret-query",
    action: "logout",
    result: "allowed",
    limit: 500
  });
  const serialized = JSON.stringify(filtered);

  assert.equal(filtered.length, 100);
  assert.equal(filtered.every((item) => item.correlationId === "trace-secret-query"), true);
  ["raw-session-id", "raw-token", "192.0.2.8", "Sensitive Browser", "raw-query"].forEach((secret) => {
    assert.equal(serialized.includes(secret), false, `${secret} must not be returned`);
  });
  assert.deepEqual(Object.keys(filtered[0]).sort(), [
    "action", "actor", "at", "category", "correlationId", "detail", "id",
    "request", "result", "role", "schemaVersion", "target"
  ]);
});

test("persistence capability truthfully requires database CAS and a cross-store transaction", () => {
  assert.equal(SESSION_SECURITY_AUDIT_PERSISTENCE_CONTRACT.productionReady, false);
  assert.match(SESSION_SECURITY_AUDIT_PERSISTENCE_CONTRACT.requiredProductionAdapter.concurrency, /compare-and-swap/i);
  assert.match(SESSION_SECURITY_AUDIT_PERSISTENCE_CONTRACT.requiredProductionAdapter.transactionBoundary, /session security mutation.*audit event.*idempotency receipt/i);
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
    ...memoryAuthSecurityRuntime(),
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

test("local password failures lock the account path and audit every denial", async () => {
  let data = {
    authOrganizations: [{ orgCode: "ORG-HEALTH", orgType: "health_admin", status: "enabled" }],
    authUsers: [{ id: "u-lock", username: "locked-user", name: "Locked User", role: "commission", accountType: "manager", orgCode: "ORG-HEALTH", status: "enabled" }],
    securityEvents: []
  };
  let sequence = 0;
  let passwordValid = false;
  const runtime = {
    ...memoryAuthSecurityRuntime(),
    collectJson: async () => ({ username: "locked-user", password: "wrong" }),
    createSession: async (user) => ({ sessionId: "unused", token: "unused", expiresAt: "2026-08-18T00:00:00.000Z", user }),
    findAuthUser: () => data.authUsers[0],
    isProductionRuntime: () => false,
    prependAuditTrailEntry,
    randomUUID: () => `lock-audit-${++sequence}`,
    readDatabase: () => data,
    sendJson: (res, status, body) => res.send(status, body),
    verifyPassword: () => passwordValid,
    writeDatabase: (next) => { data = next; }
  };
  const segment = createIdentitySegments(runtime).find((item) => item.id === "identity-security-02");
  const req = {
    method: "POST",
    url: "/api/auth/login",
    correlationId: "trace-password-lock-1234",
    headers: {}
  };

  const responses = [];
  for (let index = 0; index < 5; index += 1) {
    const response = responseCapture();
    req.correlationId = `trace-password-lock-${index + 1000}`;
    await segment.handle(req, response, new URL("http://localhost/api/auth/login"));
    responses.push(response);
  }
  assert.deepEqual(responses.map((item) => item.statusCode), [401, 401, 401, 401, 423]);
  assert.equal(responses[4].body.code, "PASSWORD_LOGIN_LOCKED");
  assert.equal(responses[4].body.failedAttempts, 5);

  passwordValid = true;
  const locked = responseCapture();
  req.correlationId = "trace-password-lock-locked";
  await segment.handle(req, locked, new URL("http://localhost/api/auth/login"));
  assert.equal(locked.statusCode, 423);
  assert.equal(locked.body.code, "PASSWORD_LOGIN_LOCKED");
  assert.equal(data.securityEvents.filter((item) => item.action === "local-password-login" && item.result === "denied").length, 6);
});

test("commission can query session audits by correlation id", async () => {
  let data = { securityEvents: [
    { category: "session-security", correlationId: "trace-query-1234", action: "logout", result: "allowed" },
    { category: "session-security", correlationId: "trace-other-1234", action: "login", result: "denied" }
  ] };
  const response = responseCapture();
  const runtime = {
    appendSecurityEvent: () => {},
    prependAuditTrailEntry,
    randomUUID: () => "unused",
    readDatabase: () => data,
    requireApiRole: () => ({ name: "Auditor", role: "commission" }),
    sendJson: (res, status, body) => res.send(status, body),
    writeDatabase: (next) => { data = next; }
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
