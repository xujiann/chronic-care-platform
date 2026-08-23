"use strict";

const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

async function requestJson(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  return { response, body: await response.json() };
}

async function login(baseUrl, username) {
  return requestJson(baseUrl, "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "123456" })
  });
}

function authorized(token) {
  return { headers: { Authorization: `Bearer ${token}` } };
}

function assertLatestRecordsAreDescending(packages) {
  packages.forEach((item) => {
    const timestamps = (item.latestRecords || []).map((record) => String(record.at || ""));
    assert.deepEqual(timestamps, [...timestamps].sort((left, right) => right.localeCompare(left)), item.id);
  });
}

test("regional sharing GET builders preserve scope, projection, ordering and handoff audit behavior", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "regional-sharing-get-characterization-"));
  const originalDataDir = process.env.DATA_DIR;
  const originalStorageEngine = process.env.STORAGE_ENGINE;
  fs.copyFileSync(path.join(ROOT, "data", "db.json"), path.join(dataDir, "db.json"));
  process.env.DATA_DIR = dataDir;
  process.env.STORAGE_ENGINE = "json";
  const { server, startServer, stopServer } = require("../server");
  startServer(0);
  await once(server, "listening");
  t.after(async () => {
    await stopServer();
    fs.rmSync(dataDir, { recursive: true, force: true });
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
    if (originalStorageEngine === undefined) delete process.env.STORAGE_ENGINE;
    else process.env.STORAGE_ENGINE = originalStorageEngine;
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const commission = await login(baseUrl, "whjw");
  const hospital = await login(baseUrl, "hospital");
  const insurance = await login(baseUrl, "insurance");
  const before = await requestJson(baseUrl, "/api/state", authorized(commission.body.token));
  const auditCountBefore = before.body.securityEvents.length;

  const commissionView = await requestJson(baseUrl, "/api/regional-data-sharing", authorized(commission.body.token));
  assert.equal(commissionView.response.status, 200);
  assert.equal(commissionView.body.summary.totalPackages, commissionView.body.packages.length);
  assert.equal(commissionView.body.summary.accessReviews, commissionView.body.accessReviews.length);
  assert.equal(commissionView.body.packages.some((item) => item.id === "rsp-r3-imaging"), true);
  assertLatestRecordsAreDescending(commissionView.body.packages);
  assert.equal(commissionView.body.accessReviews.every((item) => item.actor && item.purpose && item.note), true);

  const institutionView = await requestJson(baseUrl, "/api/regional-data-sharing", authorized(hospital.body.token));
  assert.equal(institutionView.response.status, 200);
  assert.equal(institutionView.body.packages.some((item) => item.id === "rsp-r1-hypertension"), true);
  assert.equal(institutionView.body.packages.some((item) => item.id === "rsp-r2-diabetes"), true);
  assert.equal(institutionView.body.packages.some((item) => item.id === "rsp-r3-imaging"), false);
  assert.equal(institutionView.body.packages.every((item) => !String(item.resident?.idCard || "").startsWith("DEMO-ID-")), true);
  assert.equal(institutionView.body.packages.every((item) => !String(item.resident?.phone || "").startsWith("DEMO-MOBILE-")), true);
  assert.equal(institutionView.body.accessReviews.every((review) => institutionView.body.packages.some((item) => item.id === review.packageId)), true);

  const afterViews = await requestJson(baseUrl, "/api/state", authorized(commission.body.token));
  assert.equal(afterViews.body.securityEvents.length, auditCountBefore);

  const report = await requestJson(baseUrl, "/api/regional-data-sharing/handoff-report", authorized(hospital.body.token));
  assert.equal(report.response.status, 200);
  assert.match(report.body.reportId, /^rshr-/);
  assert.doesNotThrow(() => new Date(report.body.generatedAt).toISOString());
  assert.equal(report.body.actor.role, "institution");
  assert.equal(report.body.scope.packageScope, "本机构来源或接收共享包");
  assert.deepEqual(report.body.packages.map((item) => item.id), institutionView.body.packages.map((item) => item.id));
  assert.equal(report.body.summary.packages, report.body.packages.length);
  assert.equal(report.body.summary.evidenceTotal, report.body.packages.reduce((sum, item) => sum + item.total, 0));
  assert.equal(report.body.summary.evidenceReady, report.body.packages.reduce((sum, item) => sum + item.readyCount, 0));
  assert.equal(report.body.markdown.includes(`清单编号：${report.body.reportId}`), true);
  assert.equal(report.body.markdown.includes("不生成或改写转诊单"), true);

  const afterReport = await requestJson(baseUrl, "/api/state", authorized(commission.body.token));
  assert.equal(afterReport.body.securityEvents.length, auditCountBefore);
  const reportAudit = afterReport.body.securityEvents.find((item) => item.action === "生成区域共享交接清单");
  assert.ok(reportAudit);
  assert.equal(reportAudit.detail.includes(report.body.reportId), true);
  assert.equal(reportAudit.detail.includes(`${report.body.summary.packages} 个共享包`), true);

  const deniedView = await requestJson(baseUrl, "/api/regional-data-sharing", authorized(insurance.body.token));
  const deniedReport = await requestJson(baseUrl, "/api/regional-data-sharing/handoff-report", authorized(insurance.body.token));
  assert.equal(deniedView.response.status, 403);
  assert.equal(deniedReport.response.status, 403);
  const afterDenial = await requestJson(baseUrl, "/api/state", authorized(commission.body.token));
  assert.equal(afterDenial.body.securityEvents.length, auditCountBefore);
  assert.equal(afterDenial.body.securityEvents.filter((item) => item.action === "生成区域共享交接清单" && item.detail.includes(report.body.reportId)).length, 1);
});
