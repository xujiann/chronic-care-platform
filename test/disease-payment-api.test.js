"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

async function waitForServer(baseUrl) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { const response = await fetch(`${baseUrl}/api/health`); if (response.ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  throw new Error("server start timeout");
}

async function json(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  return { response, body: await response.json() };
}

test("disease payment API runs an authenticated end-to-end workflow", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "disease-payment-api-"));
  fs.copyFileSync(path.join(ROOT, "data", "db.json"), path.join(dataDir, "db.json"));
  const port = 19500 + Math.floor(Math.random() * 1000);
  const server = spawn(process.execPath, ["server.js"], { cwd: ROOT, env: { ...process.env, PORT: String(port), DATA_DIR: dataDir }, stdio: "ignore" });
  t.after(() => { server.kill(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForServer(baseUrl);
  const login = await json(baseUrl, "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "insurance", password: "123456" }) });
  assert.equal(login.response.status, 200);
  const headers = { Authorization: `Bearer ${login.body.token}`, "Content-Type": "application/json" };
  const overview = await json(baseUrl, "/api/disease-payment", { headers });
  assert.equal(overview.response.status, 200);
  assert.equal(overview.body.state.policy.id, "nhsa-2025-18");
  const catalog = await json(baseUrl, "/api/disease-payment/drg/catalog", { headers });
  assert.equal(catalog.response.status, 200);
  assert.equal(catalog.body.profile.mdcCount, 26);
  assert.ok(catalog.body.hierarchy.some((item) => item.code === "MDCB"));
  const preview = await json(baseUrl, "/api/disease-payment/drg/simulate", { method: "POST", headers, body: JSON.stringify({ caseId: "dp-case-001" }) });
  assert.equal(preview.response.status, 200);
  assert.equal(preview.body.binding, false);
  assert.equal(preview.body.calculation.grouping.adrgCode, "BR2");
  const calculation = await json(baseUrl, "/api/disease-payment/calculate", { method: "POST", headers, body: JSON.stringify({ mode: "DRG" }) });
  assert.equal(calculation.response.status, 200);
  assert.equal(calculation.body.summary.calculatedCount, 3);
  const analytics = await json(baseUrl, "/api/disease-payment/drg/analytics", { headers });
  assert.equal(analytics.response.status, 200);
  assert.equal(analytics.body.groupedCount, 3);
  assert.ok(analytics.body.cmi > 0);
  const special = await json(baseUrl, "/api/disease-payment/special-cases", { method: "POST", headers, body: JSON.stringify({ caseId: "dp-case-001", reason: "复杂危重症" }) });
  assert.equal(special.response.status, 201);
  const review = await json(baseUrl, `/api/disease-payment/special-cases/${special.body.id}/review`, { method: "POST", headers, body: JSON.stringify({ approved: true }) });
  assert.equal(review.body.status, "评审通过");
  const batch = await json(baseUrl, "/api/disease-payment/settlements", { method: "POST", headers, body: JSON.stringify({ period: "2026-06" }) });
  assert.equal(batch.response.status, 201);
  assert.equal(batch.body.caseCount, 3);
  const governance = await json(baseUrl, "/api/disease-payment/governance/prepayments/prepay-2026-001", { method: "POST", headers, body: JSON.stringify({ status: "已审批" }) });
  assert.equal(governance.response.status, 200);
  assert.equal(governance.body.status, "已审批");
  const imported = await json(baseUrl, "/api/disease-payment/intake/imports", { method: "POST", headers, body: JSON.stringify({ sourceSystem: "HIS", rows: [{ settlementListNo: "API-LIST-001", institutionCode: "HOSP-API", institution: "接口测试医院", admissionDate: "2026-07-01", dischargeDate: "2026-07-03", principalDiagnosis: "I10", totalAmount: 1000, declaredFundAmount: 800, costItems: [{ itemCode: "P001", itemName: "项目", amount: 1000 }] }] }) });
  assert.equal(imported.response.status, 201);
  assert.equal(imported.body.accepted, 1);
  const grouping = await json(baseUrl, "/api/disease-payment/grouping-runs", { method: "POST", headers, body: JSON.stringify({ environment: "simulation", mode: "DRG" }) });
  assert.equal(grouping.response.status, 201);
  assert.equal(grouping.body.environment, "simulation");
  assert.ok(grouping.body.recordHash);
  const errors = await json(baseUrl, "/api/disease-payment/intake/errors", { headers });
  assert.equal(errors.response.status, 200);
  assert.equal(errors.body.summary.ledgerValid, true);
});
