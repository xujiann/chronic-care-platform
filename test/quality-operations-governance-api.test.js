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
  assert.equal(result.response.status, 200, `${username} login failed`);
  return result.body.token;
}

function command(domain, action, expectedVersion, payload = {}) {
  return JSON.stringify({ domain, action, expectedVersion, payload });
}

test("quality operations governance API persists scoped idempotent commands and denied audits", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "quality-operations-governance-api-"));
  fs.copyFileSync(path.join(ROOT, "data", "db.json"), path.join(dataDir, "db.json"));
  const previousEnv = Object.fromEntries([
    "NODE_ENV",
    "DATA_DIR",
    "STORAGE_ENGINE",
    "SESSION_SECRETS",
    "SESSION_STORE"
  ].map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    NODE_ENV: "test",
    DATA_DIR: dataDir,
    STORAGE_ENGINE: "json",
    SESSION_SECRETS: "quality-operations-governance-api-session-secret-2026",
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

  const health = await login(baseUrl, "health");
  const hospital = await login(baseUrl, "hospital");
  const community = await login(baseUrl, "community");
  const insurance = await login(baseUrl, "insurance");

  const catalog = await request(baseUrl, "/api/quality-operations-governance/catalog", health);
  assert.equal(catalog.response.status, 200);
  assert.equal(catalog.body.productionReady, false);
  assert.equal(catalog.body.sourceCollections.length, 3);
  assert.equal(catalog.body.summary.unmapped, 0);

  const hospitalItems = await request(baseUrl, "/api/quality-operations-governance/items", hospital);
  const communityItems = await request(baseUrl, "/api/quality-operations-governance/items", community);
  const insuranceItems = await request(baseUrl, "/api/quality-operations-governance/items", insurance);
  assert.equal(hospitalItems.body.records.some((item) => item.id === "dispatch-bed-mr3-001"), true);
  assert.equal(communityItems.body.records.some((item) => item.id === "qro-001"), true);
  assert.equal(insuranceItems.body.records.every((item) => item.domain === "drug-consumable"), true);
  assert.doesNotMatch(JSON.stringify(hospitalItems.body), /personIndex|residentId/);

  const first = await request(baseUrl, "/api/quality-operations-governance/items/qro-001/actions", health, {
    method: "POST",
    headers: { "Idempotency-Key": "quality-review-001" },
    body: command("quality-rectification", "review", 0, { note: "commission review started" })
  });
  assert.equal(first.response.status, 200);
  assert.equal(first.body.record.status, "under_review");
  assert.equal(first.body.record.version, 1);
  assert.equal(first.body.auditEvent.outcome, "allowed");

  const replay = await request(baseUrl, "/api/quality-operations-governance/items/qro-001/actions", health, {
    method: "POST",
    headers: { "Idempotency-Key": "quality-review-001" },
    body: command("quality-rectification", "review", 0, { note: "commission review started" })
  });
  assert.equal(replay.response.status, 200, JSON.stringify(replay.body));
  assert.equal(replay.body.replayed, true);

  const idempotencyConflict = await request(baseUrl, "/api/quality-operations-governance/items/qro-001/actions", health, {
    method: "POST",
    headers: { "Idempotency-Key": "quality-review-001" },
    body: command("quality-rectification", "review", 0, { note: "changed payload" })
  });
  assert.equal(idempotencyConflict.response.status, 409);
  assert.equal(idempotencyConflict.body.error.code, "IDEMPOTENCY_CONFLICT");

  const missingKey = await request(baseUrl, "/api/quality-operations-governance/items/qro-001/actions", health, {
    method: "POST",
    body: command("quality-rectification", "approve", 1)
  });
  assert.equal(missingKey.response.status, 400);
  assert.equal(missingKey.body.error.code, "INVALID_COMMAND");

  const stale = await request(baseUrl, "/api/quality-operations-governance/items/qro-001/actions", health, {
    method: "POST",
    headers: { "Idempotency-Key": "quality-approve-stale" },
    body: command("quality-rectification", "approve", 0)
  });
  assert.equal(stale.response.status, 409);
  assert.equal(stale.body.error.code, "VERSION_CONFLICT");

  const crossInstitution = await request(baseUrl, "/api/quality-operations-governance/items/dispatch-bed-mr3-001/actions", community, {
    method: "POST",
    headers: { "Idempotency-Key": "dispatch-cross-institution" },
    body: command("resource-dispatch", "accept", 0)
  });
  assert.equal(crossInstitution.response.status, 403);
  assert.equal(crossInstitution.body.error.code, "INSTITUTION_SCOPE_DENIED");

  const acceptedDispatch = await request(baseUrl, "/api/quality-operations-governance/items/dispatch-bed-mr3-001/actions", hospital, {
    method: "POST",
    headers: { "Idempotency-Key": "dispatch-hospital-accept" },
    body: command("resource-dispatch", "accept", 0)
  });
  assert.equal(acceptedDispatch.response.status, 200);
  assert.equal(acceptedDispatch.body.record.status, "in_progress");

  const sourceInstitutionAudit = await request(baseUrl, "/api/quality-operations-governance/items/dispatch-bed-mr3-001/audit", community);
  assert.equal(sourceInstitutionAudit.response.status, 200);
  assert.equal(sourceInstitutionAudit.body.auditEvents.some((item) => item.outcome === "denied"), true);
  const auditRead = await request(baseUrl, "/api/quality-operations-governance/items/dispatch-bed-mr3-001/audit", hospital);
  assert.equal(auditRead.response.status, 200);
  assert.equal(auditRead.body.auditEvents.some((item) => item.outcome === "denied"), true);
  assert.equal(auditRead.body.auditEvents.some((item) => item.outcome === "allowed"), true);

  const persisted = readDatabase();
  assert.equal(persisted.qualityRectificationOrders.find((item) => item.id === "qro-001").governanceVersion, 1);
  assert.equal(persisted.resourceDispatchRequests.find((item) => item.id === "dispatch-bed-mr3-001").governanceVersion, 1);
  assert.equal(persisted.qualityOperationsGovernanceAuditEvents.length >= 6, true);
  assert.equal(Object.keys(persisted.qualityOperationsGovernanceCommandReceipts).length >= 4, true);
  assert.equal(persisted.platformProcessAudit.some((item) => String(item.process).startsWith("quality-operations-governance:")), true);
  assert.equal(persisted.securityEvents.some((item) => item.action === "quality-operations-governance-command"), true);
});
