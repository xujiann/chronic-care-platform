const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

async function request(baseUrl, pathname, token, options = {}) {
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

async function requestText(baseUrl, pathname, token) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  return { response, body: await response.text() };
}

test("commission API closes only cleared PostgreSQL reconciliation cases and preserves audit history", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "postgres-reconciliation-api-"));
  fs.copyFileSync(path.join(ROOT, "data", "db.json"), path.join(dataDir, "db.json"));
  process.env.DATA_DIR = dataDir;
  process.env.STORAGE_ENGINE = "sqlite";
  process.env.POSTGRES_SYNC_MODE = "disabled";
  const sqliteFile = path.join(dataDir, "health-city.sqlite");
  const { recordPostgresReconciliation } = require("../postgres-runtime-sync");
  const { server, startServer, stopServer } = require("../server");
  startServer(0);
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await stopServer();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const login = await request(baseUrl, "/api/auth/login", "", {
    method: "POST",
    body: JSON.stringify({ username: "health", password: "123456" })
  });
  assert.equal(login.response.status, 200);
  const token = login.body.token;
  const summary = {
    localCollections: 1,
    remoteCollections: 0,
    matched: 0,
    mismatched: 1,
    missingRemote: 1,
    unexpectedRemote: 0,
    versionMismatches: 0,
    digestMismatches: 0
  };
  recordPostgresReconciliation(sqliteFile, {
    runId: "pgrecon-api-1",
    checkedAt: "2026-07-13T04:00:00.000Z",
    status: "mismatched",
    durationMs: 5,
    summary,
    differences: [{ collection: "residents", types: ["missing-remote"], localVersion: 4, remoteVersion: null, localDigest: "a".repeat(64), remoteDigest: "" }]
  });

  const history = await request(baseUrl, "/api/production-database/shadow-reconciliations", token);
  assert.equal(history.response.status, 200);
  assert.equal(history.body.summary.mismatched, 1);
  assert.equal(history.body.runs[0].runId, "pgrecon-api-1");
  const cases = await request(baseUrl, "/api/production-database/reconciliation-cases", token);
  assert.equal(cases.response.status, 200);
  assert.equal(cases.body.summary.open, 1);
  const caseId = cases.body.cases[0].caseId;

  const prometheus = await requestText(baseUrl, "/api/metrics/prometheus", token);
  assert.equal(prometheus.response.status, 200);
  assert.match(prometheus.response.headers.get("content-type"), /text\/plain/);
  assert.match(prometheus.body, /health_platform_postgres_reconciliation_unresolved_cases 1/);
  assert.match(prometheus.body, /health_platform_postgres_sync_slo_breaches 0/);
  assert.doesNotMatch(prometheus.body, /residents|123456|DATABASE_URL|postgres:\/\//);
  const jsonMetrics = await request(baseUrl, "/api/metrics", token);
  assert.equal(jsonMetrics.response.status, 200);
  assert.equal(jsonMetrics.body.storage.postgresSync.slo.enabled, false);
  assert.equal(jsonMetrics.body.storage.postgresSync.slo.healthy, true);
  assert.equal(jsonMetrics.body.storage.postgresSync.slo.targets.reconciliationAgeSecondsMax, 600);
  assert.equal(jsonMetrics.body.storage.postgresSync.slo.indicators.unresolvedCases, 1);

  const acknowledge = await request(baseUrl, `/api/production-database/reconciliation-cases/${caseId}/actions`, token, {
    method: "POST",
    body: JSON.stringify({ action: "acknowledge", owner: "database-platform-team", note: "Database team accepted the investigation." })
  });
  assert.equal(acknowledge.response.status, 200);
  assert.equal(acknowledge.body.case.status, "acknowledged");
  const prematureResolve = await request(baseUrl, `/api/production-database/reconciliation-cases/${caseId}/actions`, token, {
    method: "POST",
    body: JSON.stringify({ action: "resolve", note: "Replay completed and checked.", evidenceRefs: ["ticket:DB-API-1"] })
  });
  assert.equal(prematureResolve.response.status, 409);
  assert.equal(prematureResolve.body.code, "RECONCILIATION_CLEARANCE_REQUIRED");

  recordPostgresReconciliation(sqliteFile, {
    runId: "pgrecon-api-2",
    checkedAt: "2026-07-13T04:05:00.000Z",
    status: "matched",
    durationMs: 4,
    summary: { ...summary, remoteCollections: 1, matched: 1, mismatched: 0, missingRemote: 0 },
    differences: []
  });
  const resolve = await request(baseUrl, `/api/production-database/reconciliation-cases/${caseId}/actions`, token, {
    method: "POST",
    body: JSON.stringify({ action: "resolve", note: "Matched reconciliation verified after replay.", evidenceRefs: ["reconciliation:pgrecon-api-2", "ticket:DB-API-1"] })
  });
  assert.equal(resolve.response.status, 200);
  assert.equal(resolve.body.case.status, "resolved");
  assert.equal(resolve.body.case.actions.some((item) => item.action === "verified-clear"), true);

  recordPostgresReconciliation(sqliteFile, {
    runId: "pgrecon-api-3",
    checkedAt: "2026-07-13T04:10:00.000Z",
    status: "mismatched",
    durationMs: 5,
    summary,
    differences: [{ collection: "residents", types: ["missing-remote"], localVersion: 5, remoteVersion: null, localDigest: "b".repeat(64), remoteDigest: "" }]
  });
  const detail = await request(baseUrl, `/api/production-database/reconciliation-cases/${caseId}`, token);
  assert.equal(detail.response.status, 200);
  assert.equal(detail.body.case.status, "reopened");
  assert.equal(detail.body.case.actions.some((item) => item.action === "auto-reopen"), true);
  assert.doesNotMatch(JSON.stringify(detail.body), /123456|DATABASE_URL|postgres:\/\//);

  const state = await request(baseUrl, "/api/state", token);
  assert.equal(state.body.securityEvents.some((item) => item.action === "postgres-reconciliation-case-action"), true);
});
