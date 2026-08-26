"use strict";

const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

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
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  return result.body.token;
}

function signalPayload(overrides = {}) {
  return {
    id: "phsig-real-api-1",
    sourceType: "临床症候群",
    sourceSystem: "real-api-contract-source",
    metric: "fever-respiratory-cases",
    value: 7,
    baseline: 2,
    observedAt: "2026-08-24T09:00:00.000Z",
    evidenceRefs: ["PH-SIGNAL-REAL-API-001"],
    ...overrides
  };
}

test("public health highlight signal real API enforces scope and durable replay semantics", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "public-health-highlight-signal-api-"));
  fs.copyFileSync(path.join(ROOT, "data", "db.json"), path.join(dataDir, "db.json"));
  const envKeys = ["NODE_ENV", "DATA_DIR", "STORAGE_ENGINE", "SESSION_SECRETS", "SESSION_STORE"];
  const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    NODE_ENV: "test",
    DATA_DIR: dataDir,
    STORAGE_ENGINE: "sqlite",
    SESSION_SECRETS: "public-health-highlight-signal-api-session-secret-2026",
    SESSION_STORE: "memory"
  });

  const { readDatabase, server, startServer, stopServer } = require("../server");
  startServer(0);
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await stopServer();
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const pathname = "/api/public-health/highlights/signals";
  const anonymous = await request(baseUrl, pathname, "", {
    method: "POST",
    body: JSON.stringify(signalPayload())
  });
  assert.equal(anonymous.response.status, 401);

  const hospitalToken = await login(baseUrl, "hospital");
  const forbiddenRole = await request(baseUrl, pathname, hospitalToken, {
    method: "POST",
    body: JSON.stringify(signalPayload())
  });
  assert.equal(forbiddenRole.response.status, 403);

  const districtToken = await login(baseUrl, "district");
  const deniedScope = await request(baseUrl, pathname, districtToken, {
    method: "POST",
    headers: { "Idempotency-Key": "district-denied-signal" },
    body: JSON.stringify(signalPayload({ id: "phsig-district-denied", sourceOrgCode: "H000001" }))
  });
  assert.equal(deniedScope.response.status, 403);
  assert.equal(deniedScope.body.code, "PUBLIC_HEALTH_SIGNAL_SCOPE_FORBIDDEN");

  const districtAllowed = await request(baseUrl, pathname, districtToken, {
    method: "POST",
    headers: { "Idempotency-Key": "district-allowed-signal" },
    body: JSON.stringify(signalPayload({ id: "phsig-district-allowed", institutionCode: "h000003" }))
  });
  assert.equal(districtAllowed.response.status, 201, JSON.stringify(districtAllowed.body));
  assert.equal(districtAllowed.body.signal.sourceOrgCode, "H000003");

  const cityToken = await login(baseUrl, "city");
  const headers = { "Idempotency-Key": "city-real-api-command" };
  const cityPayload = signalPayload({ id: "phsig-city-legacy" });
  const first = await request(baseUrl, pathname, cityToken, {
    method: "POST",
    headers,
    body: JSON.stringify(cityPayload)
  });
  assert.equal(first.response.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.idempotent, false);

  const replay = await request(baseUrl, pathname, cityToken, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...cityPayload, idempotencyKey: "ignored-lower-priority-body-key" })
  });
  assert.equal(replay.response.status, 200, JSON.stringify(replay.body));
  assert.equal(replay.body.idempotent, true);
  assert.equal(replay.body.signal.id, first.body.signal.id);

  const conflict = await request(baseUrl, pathname, cityToken, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...cityPayload, value: 99 })
  });
  assert.equal(conflict.response.status, 409);
  assert.equal(conflict.body.code, "PUBLIC_HEALTH_SIGNAL_IDEMPOTENCY_CONFLICT");

  const malformed = await request(baseUrl, pathname, cityToken, {
    method: "POST",
    headers: { "Idempotency-Key": "malformed-real-api" },
    body: "{not-json"
  });
  assert.equal(malformed.response.status, 400);
  assert.equal(malformed.body.code, "PUBLIC_HEALTH_SIGNAL_BODY_INVALID");

  const state = readDatabase();
  const created = state.publicHealthSignals.filter((item) => item.id === "phsig-city-legacy");
  assert.equal(created.length, 1);
  assert.match(created[0].commandKeyHash, /^[a-f0-9]{64}$/);
  assert.equal(state.securityEvents.filter((item) => item.action === "public-health-highlight-signal" && item.target === "phsig-city-legacy").length, 1);
  assert.doesNotMatch(JSON.stringify(state.publicHealthSignals), /city-real-api-command|ignored-lower-priority-body-key/);

  const districtSystem = await request(baseUrl, "/api/public-health/system", districtToken);
  assert.equal(districtSystem.response.status, 200, JSON.stringify(districtSystem.body));
  assert.equal(districtSystem.body.highlights.triggerCenter.signals.some((item) => item.id === "phsig-district-allowed"), true);
  assert.equal(districtSystem.body.highlights.triggerCenter.signals.some((item) => item.id === "phsig-city-legacy"), false);
  assert.equal(districtSystem.body.summary.highlightActiveAlerts, districtSystem.body.highlights.summary.activeAlerts);
  assert.equal(districtSystem.body.summary.highlightOpenTasks, 0);
  assert.equal(districtSystem.body.summary.highlightEvidenceScore, 0);
  assert.doesNotMatch(JSON.stringify(districtSystem.body), /commandKeyHash|requestDigest|phsig-city-legacy/);
});
