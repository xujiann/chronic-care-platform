"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const test = require("node:test");
const Intake = require("../disease-payment-intake");
const Service = require("../disease-payment-service");

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
  const parameter = await json(baseUrl, "/api/disease-payment/parameters", { method: "POST", headers, body: JSON.stringify({ id: "param-drg-api-2027", mode: "DRG", schemeId: "drg-demo-2026", name: "API测试DRG参数", rate: 11000, effectiveFrom: "2027-01-01" }) });
  assert.equal(parameter.response.status, 201);
  assert.equal(parameter.body.status, "草案");
  const impact = await json(baseUrl, "/api/disease-payment/parameters/param-drg-api-2027/simulate", { method: "POST", headers, body: "{}" });
  assert.equal(impact.response.status, 200);
  assert.equal(impact.body.impactReport.caseCount, 3);
  await json(baseUrl, "/api/disease-payment/parameters/param-drg-api-2027/submit", { method: "POST", headers, body: "{}" });
  const firstReview = await json(baseUrl, "/api/disease-payment/parameters/param-drg-api-2027/review", { method: "POST", headers, body: JSON.stringify({ approved: true, role: "医保业务复核" }) });
  assert.equal(firstReview.body.parameter.status, "复核中");
  const secondLogin = await json(baseUrl, "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "mi", password: "123456" }) });
  assert.equal(secondLogin.response.status, 200);
  const secondHeaders = { Authorization: `Bearer ${secondLogin.body.token}`, "Content-Type": "application/json" };
  const secondReview = await json(baseUrl, "/api/disease-payment/parameters/param-drg-api-2027/review", { method: "POST", headers: secondHeaders, body: JSON.stringify({ approved: true, role: "基金财务复核" }) });
  assert.equal(secondReview.body.parameter.status, "已批准");
  const publishedParameter = await json(baseUrl, "/api/disease-payment/parameters/param-drg-api-2027/publish", { method: "POST", headers: secondHeaders, body: "{}" });
  assert.equal(publishedParameter.body.parameter.status, "已发布");
  const parameterView = await json(baseUrl, "/api/disease-payment/parameters", { headers });
  assert.ok(parameterView.body.versions.some((item) => item.id === "param-drg-2026" && item.status === "已冻结"));
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
  const formalJob = await json(baseUrl, "/api/disease-payment/formal-grouping/jobs", { method: "POST", headers, body: JSON.stringify({ id: "api-formal-job-success", idempotencyKey: "api-formal-idem-success", mode: "DRG", schemeVersion: "DRG-2.0-DL", caseIds: ["dp-case-003"] }) });
  assert.equal(formalJob.response.status, 201);
  assert.equal(formalJob.body.job.status, "queued");
  const formalDispatch = await json(baseUrl, "/api/disease-payment/formal-grouping/jobs/api-formal-job-success/dispatch", { method: "POST", headers, body: JSON.stringify({ accepted: true, transportId: "api-transport-success" }) });
  assert.equal(formalDispatch.body.job.status, "awaiting-receipt");
  const formalCase = Service.seedDiseasePaymentState().cases.find((item) => item.id === "dp-case-003");
  const formalReceipt = await json(baseUrl, "/api/disease-payment/formal-grouping/jobs/api-formal-job-success/receipts", { method: "POST", headers, body: JSON.stringify({ correlationId: formalDispatch.body.job.correlationId, officialResults: [{ caseId: formalCase.id, receiptId: "API-OFFICIAL-003", groupCode: "FZ15", groupName: "循环系统疾病不伴并发症", schemeVersion: "DRG-2.0-DL", inputDigest: Intake.officialCaseDigest(formalCase, "DRG"), signedAt: "2026-07-20T08:00:00.000Z", signatureValid: true, verification: { verifiedBy: "official-adapter-v1", algorithm: "SM2/SM3", keyId: "api-joint-test-key", verifiedAt: "2026-07-20T08:00:01.000Z" } }] }) });
  assert.equal(formalReceipt.response.status, 200);
  assert.equal(formalReceipt.body.job.status, "completed");
  assert.equal(formalReceipt.body.groupingRun.environment, "formal");
  const failedJob = await json(baseUrl, "/api/disease-payment/formal-grouping/jobs", { method: "POST", headers, body: JSON.stringify({ id: "api-formal-job-failure", mode: "DRG", schemeVersion: "DRG-2.0-DL", caseIds: ["dp-case-002"], maxAttempts: 1 }) });
  await json(baseUrl, "/api/disease-payment/formal-grouping/jobs/api-formal-job-failure/dispatch", { method: "POST", headers, body: JSON.stringify({ accepted: true }) });
  const formalFailure = await json(baseUrl, "/api/disease-payment/formal-grouping/jobs/api-formal-job-failure/fail", { method: "POST", headers, body: JSON.stringify({ errorCode: "RECEIPT_TIMEOUT", errorMessage: "回执超时" }) });
  assert.equal(formalFailure.body.job.status, "dead-letter");
  const formalReconciled = await json(baseUrl, "/api/disease-payment/formal-grouping/jobs/api-formal-job-failure/reconcile", { method: "POST", headers, body: JSON.stringify({ resolution: "链路恢复，完成手工对账" }) });
  assert.equal(formalReconciled.body.job.status, "queued");
  const formalOperations = await json(baseUrl, "/api/disease-payment/formal-grouping/operations", { headers });
  assert.equal(formalOperations.response.status, 200);
  assert.equal(formalOperations.body.summary.completed, 1);
  assert.equal(formalOperations.body.deadLetters[0].status, "resolved");
  const errors = await json(baseUrl, "/api/disease-payment/intake/errors", { headers });
  assert.equal(errors.response.status, 200);
  assert.equal(errors.body.summary.ledgerValid, true);
});
