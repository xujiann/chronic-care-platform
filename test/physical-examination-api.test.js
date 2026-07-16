const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function signIntegrationPayload(payload, secret) {
  return createHmac("sha256", secret).update(stableStringify(payload)).digest("hex");
}

async function request(baseUrl, pathname, token = "", options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  return { status: response.status, body: await response.json() };
}

test("体检 API 完成机构接入、幂等归档和居民历史报告授权查询", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "physical-exam-api-"));
  fs.copyFileSync(path.join(ROOT, "data", "db.json"), path.join(dataDir, "db.json"));
  const seededData = JSON.parse(fs.readFileSync(path.join(dataDir, "db.json"), "utf8"));
  seededData.secureAttachments = [{ id: "att-physical-exam-api", residentId: "r1", filename: "体检原报告.pdf", status: "active", scanStatus: "clean", createdByOrgCode: "MR1", classification: "clinical-record", retentionPolicy: "clinical-record", retentionYears: 15 }];
  fs.writeFileSync(path.join(dataDir, "db.json"), JSON.stringify(seededData), "utf8");
  const previousEnv = Object.fromEntries(["NODE_ENV", "DATA_DIR", "STORAGE_ENGINE", "SESSION_SECRETS", "SESSION_STORE", "INTEGRATION_GATEWAY_SECRET"].map((key) => [key, process.env[key]]));
  const gatewaySecret = "physical-examination-integration-test-secret";
  Object.assign(process.env, {
    NODE_ENV: "test",
    DATA_DIR: dataDir,
    STORAGE_ENGINE: "json",
    SESSION_SECRETS: "physical-examination-api-test-session-secret-2026",
    SESSION_STORE: "memory",
    INTEGRATION_GATEWAY_SECRET: gatewaySecret
  });
  const { server, startServer, stopServer } = require("../server");
  startServer(0);
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await stopServer();
    fs.rmSync(dataDir, { recursive: true, force: true });
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  });

  const institutionLogin = await request(baseUrl, "/api/auth/login", "", { method: "POST", body: JSON.stringify({ username: "hospital", password: "123456" }) });
  const citizenLogin = await request(baseUrl, "/api/auth/login", "", { method: "POST", body: JSON.stringify({ username: "citizen", password: "123456" }) });
  const commissionLogin = await request(baseUrl, "/api/auth/login", "", { method: "POST", body: JSON.stringify({ username: "health", password: "123456" }) });
  assert.equal(institutionLogin.status, 200);
  assert.equal(citizenLogin.status, 200);
  assert.equal(commissionLogin.status, 200);

  const before = await request(baseUrl, "/api/physical-exams?residentId=r1", citizenLogin.body.token);
  assert.equal(before.status, 200);
  assert.equal(before.body.reports.length >= 2, true);
  assert.deepEqual(before.body.years, ["2026", "2025"]);
  assert.equal(before.body.readiness.codeReady, true);
  assert.equal(typeof before.body.readiness.blockers, "number");
  assert.equal(before.body.highlights.version, "physical-exam-highlights-v1");
  assert.equal(before.body.highlights.trajectories.some((item) => item.code === "SBP"), true);
  assert.equal(before.body.highlights.translations.some((item) => item.code === "BP"), true);

  const payload = {
    sourceType: "hospital",
    residentId: "r1",
    externalId: "HIS-PE-API-20260715-001",
    institutionId: "ORG-HOSPITAL-DL",
    institutionName: "大连市中心医院",
    reportNo: "TJ-API-20260715-001",
    examDate: "2026-07-15",
    summary: "医院体检报告已完成并同步健康档案。",
    findings: [{ code: "BP", name: "血压", value: "151/91", unit: "mmHg", status: "偏高" }],
    recommendations: ["一周内复测血压"]
  };
  const imported = await request(baseUrl, "/api/physical-exams/import", institutionLogin.body.token, { method: "POST", body: JSON.stringify(payload) });
  assert.equal(imported.status, 201);
  assert.equal(imported.body.imported, 1);
  assert.equal(imported.body.records[0].category, "physical-exam");
  assert.equal(imported.body.records[0].meta.abnormalCount, 1);
  assert.equal(imported.body.records[0].meta.careLinkage.riskLevel, "中危");
  assert.equal(imported.body.records[0].meta.careLinkage.familyDoctorSuggestion.suggestedPackageId, "p2fdp-hypertension");

  const riskStratification = await request(baseUrl, "/api/chronic/risk-stratification", commissionLogin.body.token);
  assert.equal(riskStratification.status, 200);
  const residentRisk = riskStratification.body.queue.find((item) => item.residentId === "r1");
  assert.equal(residentRisk.signals.some((item) => item.startsWith("physical-exam-abnormal:")), true);
  assert.equal(residentRisk.openCounts.physicalExamAbnormal >= 1, true);

  const familyDoctor = await request(baseUrl, "/api/phase2/family-doctor-contracts", citizenLogin.body.token);
  assert.equal(familyDoctor.status, 200);
  assert.equal(familyDoctor.body.suggestions.some((item) => item.reportId === imported.body.records[0].id && item.suggestedPackageId === "p2fdp-hypertension"), true);

  const citizenState = await request(baseUrl, "/api/state", citizenLogin.body.token);
  assert.equal(citizenState.status, 200);
  assert.equal(citizenState.body.chronicScreeningTasks.some((item) => item.sourceReportId === imported.body.records[0].id && item.sourceType === "physical-exam"), true);

  const cases = await request(baseUrl, "/api/physical-exams?residentId=r1", institutionLogin.body.token);
  const importedCase = cases.body.abnormalCases.find((item) => item.reportId === imported.body.records[0].id);
  assert.equal(importedCase.status, "pending-contact");
  const notified = await request(baseUrl, `/api/physical-exams/abnormal-cases/${importedCase.id}/actions`, institutionLogin.body.token, { method: "POST", body: JSON.stringify({ action: "notify", note: "已通知居民复测血压" }) });
  assert.equal(notified.status, 200);
  assert.equal(notified.body.abnormalCase.notificationStatus, "delivered");

  const linked = await request(baseUrl, `/api/physical-exams/${imported.body.records[0].id}/link-attachment`, institutionLogin.body.token, { method: "POST", body: JSON.stringify({ attachmentId: "att-physical-exam-api" }) });
  assert.equal(linked.status, 200);
  assert.equal(linked.body.report.meta.secureAttachmentId, "att-physical-exam-api");

  const duplicate = await request(baseUrl, "/api/physical-exams/import", institutionLogin.body.token, { method: "POST", body: JSON.stringify(payload) });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.imported, 0);
  assert.equal(duplicate.body.duplicates, 1);

  const after = await request(baseUrl, "/api/physical-exams?residentId=r1", citizenLogin.body.token);
  assert.equal(after.status, 200);
  assert.equal(after.body.reports.some((item) => item.meta.externalId === payload.externalId), true);
  const archive = await request(baseUrl, "/api/personal-records?residentId=r1&category=physical-exam", citizenLogin.body.token);
  assert.equal(archive.status, 200);
  assert.equal(archive.body.some((item) => item.meta.externalId === payload.externalId), true);

  const passport = await request(baseUrl, "/api/physical-exams/highlights/actions", citizenLogin.body.token, { method: "POST", body: JSON.stringify({ action: "create-passport", residentId: "r1", scopes: ["reports", "trends", "abnormal-findings"], expiresInDays: 7 }) });
  assert.equal(passport.status, 200);
  assert.equal(passport.body.result.item.status, "active");
  assert.equal(passport.body.highlights.healthPassports.some((item) => item.status === "active"), true);
  const reviewRequest = await request(baseUrl, "/api/physical-exams/highlights/actions", citizenLogin.body.token, { method: "POST", body: JSON.stringify({ action: "request-review", residentId: "r1", reportId: imported.body.records[0].id, department: "心内科", preferredDate: "2026-07-22" }) });
  assert.equal(reviewRequest.status, 200);
  assert.equal(reviewRequest.body.result.item.status, "pending-slot");
  const forbiddenHighlight = await request(baseUrl, "/api/physical-exams/highlights/actions", citizenLogin.body.token, { method: "POST", body: JSON.stringify({ action: "create-passport", residentId: "r2", scopes: ["reports"] }) });
  assert.equal(forbiddenHighlight.status, 403);

  const forbiddenImport = await request(baseUrl, "/api/physical-exams/import", citizenLogin.body.token, { method: "POST", body: JSON.stringify(payload) });
  assert.equal(forbiddenImport.status, 403);
  const forbiddenResident = await request(baseUrl, "/api/physical-exams?residentId=r2", citizenLogin.body.token);
  assert.equal(forbiddenResident.status, 403);

  const integrationPayload = {
    contractId: "physical-exam-report-v1",
    idempotencyKey: "physical-exam-api-signed-001",
    externalId: "PE-SIGNED-001",
    residentId: "r1",
    payload: {
      sourceType: "hospital",
      residentId: "r1",
      externalId: "PE-SIGNED-001",
      institutionId: "hospital-dl-central",
      institutionName: "大连市中心医院",
      examDate: "2026-07-15",
      summary: "签名接入体检报告",
      findings: [{ code: "BP", name: "血压", value: "128/78", unit: "mmHg", abnormal: false }],
      signature: { status: "verified", algorithm: "RSA-SHA256", signatureNo: "SIGN-001", signer: "总检医师", certificateSerial: "CERT-001", signedAt: "2026-07-15T08:00:00.000Z", verifiedAt: "2026-07-15T08:01:00.000Z" }
    }
  };
  Object.assign(integrationPayload, {
    sourceType: integrationPayload.payload.sourceType,
    institutionId: integrationPayload.payload.institutionId,
    institutionName: integrationPayload.payload.institutionName,
    examDate: integrationPayload.payload.examDate,
    summary: integrationPayload.payload.summary
  });
  const integrated = await request(baseUrl, "/api/integration/events", institutionLogin.body.token, { method: "POST", headers: { "x-integration-signature": signIntegrationPayload(integrationPayload, gatewaySecret) }, body: JSON.stringify(integrationPayload) });
  assert.equal(integrated.status, 202);
  assert.equal(integrated.body.status, "landed");
  assert.equal(integrated.body.signatureVerified, true);
  const replay = await request(baseUrl, "/api/integration/events", institutionLogin.body.token, { method: "POST", headers: { "x-integration-signature": signIntegrationPayload(integrationPayload, gatewaySecret) }, body: JSON.stringify(integrationPayload) });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.idempotentReplay, true);

  const invalidJointEvidence = await request(baseUrl, "/api/physical-exams/joint-tests/physical-exam-joint-test-hospital/actions", commissionLogin.body.token, { method: "POST", body: JSON.stringify({ action: "update-check", checkId: "network", status: "site-passed", note: "现场通过" }) });
  assert.equal(invalidJointEvidence.status, 400);
  const jointEvidence = await request(baseUrl, "/api/physical-exams/joint-tests/physical-exam-joint-test-hospital/actions", commissionLogin.body.token, { method: "POST", body: JSON.stringify({ action: "update-check", checkId: "network", status: "site-passed", note: "现场通过", evidenceRef: "UAT-HOSPITAL-001" }) });
  assert.equal(jointEvidence.status, 200);
  assert.equal(jointEvidence.body.jointTest.evidenceRefs.includes("UAT-HOSPITAL-001"), true);
  const prematureSignoff = await request(baseUrl, "/api/physical-exams/joint-tests/physical-exam-joint-test-hospital/actions", commissionLogin.body.token, { method: "POST", body: JSON.stringify({ action: "signoff", note: "现场验收签署", evidenceRef: "SIGN-HOSPITAL-001" }) });
  assert.equal(prematureSignoff.status, 409);
});
