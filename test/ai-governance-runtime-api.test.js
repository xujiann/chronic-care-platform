"use strict";

const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
async function request(base, pathname, token = "", options = {}) {
  const response = await fetch(`${base}${pathname}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers }
  });
  return { status: response.status, body: await response.json() };
}

test("real governance HTTP commands persist, replay, isolate roles and require independent approval", async (t) => {
  const temporaryRoot = path.join(ROOT, "tmp");
  fs.mkdirSync(temporaryRoot, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(temporaryRoot, "ai-governance-api-"));
  fs.copyFileSync(path.join(ROOT, "data", "db.json"), path.join(dataDir, "db.json"));
  const envKeys = ["NODE_ENV", "DATA_DIR", "STORAGE_ENGINE", "SESSION_SECRETS", "SESSION_STORE"];
  const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, { NODE_ENV: "test", DATA_DIR: dataDir, STORAGE_ENGINE: "sqlite", SESSION_STORE: "memory", SESSION_SECRETS: "ai-governance-http-test-session-secret-20260905" });
  const { server, startServer, stopServer } = require("../server");
  t.after(async () => {
    await stopServer();
    fs.rmSync(dataDir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  startServer(0);
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  async function login(username) {
    const result = await request(base, "/api/auth/login", "", { method: "POST", body: JSON.stringify({ username, password: "123456" }) });
    assert.equal(result.status, 200);
    return result.body.token;
  }
  const author = await login("health");
  const reviewer = await login("city");
  const institution = await login("hospital");
  assert.equal((await request(base, "/api/ai-governance/center")).status, 401);
  assert.equal((await request(base, "/api/ai-governance/center", institution)).status, 403);
  const initial = await request(base, "/api/ai-governance/center", author);
  assert.equal(initial.status, 200);
  assert.equal(initial.body.productionReady, false);
  assert.equal(initial.body.contractVersion, "ai-governance.v1");
  const rule = initial.body.rules[0];
  assert.ok(rule);
  assert.equal(rule.governance.status, "unregistered");
  const endpoint = `/api/ai-governance/rules/${encodeURIComponent(rule.id)}/actions`;
  async function command(actor, action, version, key, card) {
    return request(base, endpoint, actor, { method: "POST", headers: { "Idempotency-Key": key }, body: JSON.stringify({ action, expectedVersion: version, idempotencyKey: key, ...(card ? { card } : {}) }) });
  }
  const card = { sourceRef: "RULE-SOURCE-001", sourceDigest: rule.governance.sourceDigest, ruleVersion: "v1", evidenceRef: "REPOSITORY-TEST-001", evidenceDigest: "a".repeat(64), riskLevel: "high" };
  assert.equal((await command(institution, "register", 0, "forbidden-register", card)).status, 403);
  const registered = await command(author, "register", 0, "register-001", card);
  assert.equal(registered.status, 200, JSON.stringify(registered.body));
  const clinicalCollections = ["phase2ClinicalAssistRules", "phase2ClinicalAssistAlerts", "phase2ClinicalAssistReceipts", "phase2ClinicalAssistPluginContracts"];
  for (const actor of [author, institution]) {
    const state = await request(base, "/api/state", actor);
    assert.equal(state.status, 200);
    for (const collection of clinicalCollections) assert.equal(Object.hasOwn(state.body, collection), false, `${collection} must not expose internal clinical or governance metadata`);
  }
  const forgedRules = [{ id: rule.id, governance: { version: 999, status: "approved", card } }];
  const rawWrite = await request(base, "/api/state", author, { method: "PUT", body: JSON.stringify({ phase2ClinicalAssistRules: forgedRules }) });
  assert.equal(rawWrite.status, 409, JSON.stringify(rawWrite.body));
  assert.equal(rawWrite.body.code, "CDSS_SERVER_MANAGED_COLLECTION_CONFLICT");
  const collectionWrite = await request(base, "/api/state-collections/phase2ClinicalAssistRules", author, { method: "PUT", body: JSON.stringify({ items: forgedRules }) });
  assert.equal(collectionWrite.status, 403, JSON.stringify(collectionWrite.body));
  assert.equal(collectionWrite.body.code, "CDSS_SERVER_MANAGED_COLLECTION_WRITE_DENIED");
  const legacyConfigPath = `/api/phase2/clinical-assist/rules/${encodeURIComponent(rule.id)}/config`;
  const legacyConfig = { method: "POST", body: JSON.stringify({ configStatus: "active", severity: "high" }) };
  const governedConfigWrite = await request(base, legacyConfigPath, author, legacyConfig);
  assert.equal(governedConfigWrite.status, 409, JSON.stringify(governedConfigWrite.body));
  assert.equal(governedConfigWrite.body.code, "CDSS_GOVERNED_RULE_REQUIRES_WORKFLOW");
  assert.equal((await request(base, legacyConfigPath, institution, legacyConfig)).status, 403);
  const afterDeniedWrites = await request(base, "/api/ai-governance/center", author);
  const retainedRule = afterDeniedWrites.body.rules.find((item) => item.id === rule.id);
  assert.equal(retainedRule.governance.version, 1);
  assert.equal(retainedRule.governance.status, "draft");
  assert.equal(retainedRule.governance.sourceDigest, rule.governance.sourceDigest);
  const replay = await command(author, "register", 0, "register-001", card);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.idempotentReplay, true);
  assert.equal((await command(author, "submit", 0, "stale-submit")).status, 409);
  assert.equal((await command(author, "submit", 1, "submit-001")).status, 200);
  const selfApproval = await command(author, "approve", 2, "self-approve-001");
  assert.equal(selfApproval.status, 403);
  assert.equal(selfApproval.body.code, "AI_GOVERNANCE_SELF_REVIEW");
  assert.equal((await command(reviewer, "approve", 2, "approve-001")).status, 200);
  const approved = await request(base, "/api/ai-governance/center", author);
  const approvedRule = approved.body.rules.find((item) => item.id === rule.id);
  assert.equal(approvedRule.governance.status, "approved");
  assert.equal(approvedRule.governance.version, 3);
  assert.equal(approvedRule.productionReady, false);
  assert.equal("receipts" in approvedRule.governance, false);
  assert.equal("history" in approvedRule.governance, false);
  assert.equal((await command(author, "suspend", 3, "suspend-001")).status, 200);
  assert.equal((await command(author, "rollback", 4, "rollback-001")).status, 200);
  const final = await request(base, "/api/ai-governance/center", author);
  const finalRule = final.body.rules.find((item) => item.id === rule.id);
  assert.equal(finalRule.governance.status, "draft");
  assert.equal(finalRule.governance.version, 5);
  assert.equal(final.body.productionReady, false);
});
