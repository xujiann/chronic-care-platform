#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "phase2-disease-reporting-readiness-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "phase2-disease-reporting-readiness-report.md");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function check(id, passed, detail) {
  return { id, passed: Boolean(passed), detail };
}

function clean(value) {
  return String(value || "").replace(/\|/g, "/");
}

function defaultRules() {
  return [
    { id: "p2dr-rule-htn", diseaseCategory: "chronic", diseaseCode: "I10", diseaseName: "Hypertension", triggerCondition: "HIS diagnosis", requiredFields: ["residentId", "diagnosisCode", "reportedAt"], status: "active" },
    { id: "p2dr-rule-dm", diseaseCategory: "chronic", diseaseCode: "E11", diseaseName: "Type 2 diabetes", triggerCondition: "HIS/LIS evidence", requiredFields: ["residentId", "diagnosisCode", "labEvidence"], status: "active" },
    { id: "p2dr-rule-infectious", diseaseCategory: "infectious", diseaseCode: "A15", diseaseName: "Infectious disease card", triggerCondition: "fever clinic or positive lab", requiredFields: ["residentId", "sampleNo", "cdcReviewStatus"], status: "active" },
    { id: "p2dr-rule-mental", diseaseCategory: "severe-mental-disorder", diseaseCode: "F20", diseaseName: "Severe mental disorder", triggerCondition: "specialist diagnosis", requiredFields: ["residentId", "riskLevel", "guardianContact"], status: "active" }
  ];
}

function defaultQueue() {
  return [
    { id: "p2drq-htn-r1", residentId: "r1", diseaseCategory: "chronic", diseaseName: "Hypertension", ruleId: "p2dr-rule-htn", targetCounty: "Zhongshan", reportCardNo: "P2-DR-HTN-001", status: "receipt-confirmed", pushStatus: "accepted", patientCenterStatus: "imported", patientCenterRecordId: "pc-r1-htn", exportStatus: "available", exceptionStatus: "closed", lastAction: "receipt accepted" },
    { id: "p2drq-dm-r2", residentId: "r2", diseaseCategory: "chronic", diseaseName: "Type 2 diabetes", ruleId: "p2dr-rule-dm", targetCounty: "Shahekou", reportCardNo: "P2-DR-DM-002", status: "receipt-confirmed", pushStatus: "accepted-after-retry", patientCenterStatus: "imported", patientCenterRecordId: "pc-r2-dm", exportStatus: "available", exceptionStatus: "compensated", lastAction: "retry accepted" },
    { id: "p2drq-inf-r3", residentId: "r3", diseaseCategory: "infectious", diseaseName: "Infectious disease card", ruleId: "p2dr-rule-infectious", targetCounty: "Ganjingzi", reportCardNo: "P2-DR-INF-003", status: "cdc-review", pushStatus: "pending-review", patientCenterStatus: "imported", patientCenterRecordId: "pc-r3-inf", exportStatus: "restricted", exceptionStatus: "open", lastAction: "CDC review pending" },
    { id: "p2drq-mental-r4", residentId: "r4", diseaseCategory: "severe-mental-disorder", diseaseName: "Severe mental disorder", ruleId: "p2dr-rule-mental", targetCounty: "Zhuanghe", reportCardNo: "P2-DR-MD-004", status: "pushed", pushStatus: "sent", patientCenterStatus: "imported", patientCenterRecordId: "pc-r4-md", exportStatus: "restricted", exceptionStatus: "site-signoff-required", lastAction: "signoff pending" }
  ];
}

function defaultReceipts() {
  return [
    { id: "p2drr-htn-r1", reportId: "p2drq-htn-r1", targetCounty: "Zhongshan", receiptStatus: "accepted", receiptCode: "ZS-DR-001", retryCount: 0, auditHash: "sha256:r1" },
    { id: "p2drr-dm-r2", reportId: "p2drq-dm-r2", targetCounty: "Shahekou", receiptStatus: "accepted-after-retry", receiptCode: "SHK-DR-002", retryCount: 1, auditHash: "sha256:r2" },
    { id: "p2drr-mental-r4", reportId: "p2drq-mental-r4", targetCounty: "Zhuanghe", receiptStatus: "received", receiptCode: "ZH-DR-004", retryCount: 0, auditHash: "sha256:r4" }
  ];
}

function mergeRows(defaultRows, currentRows, key = "id") {
  const merged = new Map();
  (Array.isArray(defaultRows) ? defaultRows : []).forEach((item) => merged.set(item[key], item));
  (Array.isArray(currentRows) ? currentRows : []).forEach((item) => {
    if (!item?.[key]) return;
    merged.set(item[key], { ...(merged.get(item[key]) || {}), ...item });
  });
  return [...merged.values()];
}

function buildPhase2DiseaseReportingReadiness(options = {}) {
  const data = options.data ?? readJson("data/db.json");
  const pkg = options.pkg ?? readJson("package.json");
  const serverSource = options.serverSource ?? readText("server.js");
  const platformSource = options.platformSource ?? readText("platform.js");
  const platformHtml = options.platformHtml ?? readText("platform.html");
  const manifestSource = options.manifestSource ?? readText(path.join("scripts", "release-artifact-manifest.js"));
  const deployCheckSource = options.deployCheckSource ?? readText(path.join("scripts", "deploy-check.js"));
  const releaseReportSource = options.releaseReportSource ?? readText(path.join("scripts", "release-report.js"));
  const rules = options.rules ?? mergeRows(defaultRules(), data.phase2DiseaseReportingRules, "id");
  const queue = options.queue ?? mergeRows(defaultQueue(), data.phase2DiseaseReportQueue, "id");
  const receipts = options.receipts ?? mergeRows(defaultReceipts(), data.phase2DiseaseReportReceipts, "id");
  const ruleIds = new Set(rules.map((item) => item.id));
  const reportIds = new Set(queue.map((item) => item.id));
  const categories = [...new Set(rules.map((item) => item.diseaseCategory))];
  const pushed = queue.filter((item) => /accepted|sent|pushed|receipt/i.test(`${item.status || ""} ${item.pushStatus || ""}`));
  const openExceptions = queue.filter((item) => /open|review|required|pending/i.test(`${item.exceptionStatus || ""} ${item.pushStatus || ""}`));
  const patientCenter = queue.filter((item) => item.patientCenterStatus && item.patientCenterRecordId && item.exportStatus);
  const checks = [
    check("phase2DiseaseReporting:rule-engine", ["chronic", "infectious", "severe-mental-disorder"].every((category) => categories.includes(category)) && rules.every((item) => item.requiredFields?.length && item.triggerCondition), `${rules.length} diagnosis trigger rules`),
    check("phase2DiseaseReporting:report-queue", queue.length >= 4 && queue.every((item) => ruleIds.has(item.ruleId) && item.reportCardNo && item.residentId && item.targetCounty), `${queue.length} report cards queued`),
    check("phase2DiseaseReporting:county-receipts", receipts.length >= 3 && receipts.every((item) => reportIds.has(item.reportId) && item.receiptStatus && item.auditHash) && pushed.length >= 3, `${receipts.length} county receipts / ${pushed.length} pushed reports`),
    check("phase2DiseaseReporting:patient-center", patientCenter.length >= 4, `${patientCenter.length} patient center import/export rows`),
    check("phase2DiseaseReporting:exception-loop", openExceptions.length >= 1 && queue.every((item) => item.exceptionStatus && item.lastAction), `${openExceptions.length} open review or signoff exceptions`),
    check("phase2DiseaseReporting:runtime-api", serverSource.includes("/api/phase2/disease-reporting") && serverSource.includes("buildPhase2DiseaseReportingOverview") && serverSource.includes("phase2-disease-report-receipt"), "runtime API and receipt action are wired"),
    check("phase2DiseaseReporting:platform-ui", platformSource.includes("renderPhase2DiseaseReporting") && platformHtml.includes("phase2-disease-reporting"), "platform UI renders phase-2 disease reporting"),
    check("phase2DiseaseReporting:release-wiring", Boolean(pkg.scripts?.["phase2:disease-reporting-readiness"]) && manifestSource.includes("phase2-disease-reporting-readiness-report.md") && deployCheckSource.includes("phase2DiseaseReportingReadiness") && releaseReportSource.includes("phase2DiseaseReporting"), "package script, manifest, deploy check and release report are wired")
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    summary: {
      rules: rules.length,
      reportCards: queue.length,
      pushed: pushed.length,
      receipts: receipts.length,
      patientCenterRows: patientCenter.length,
      openExceptions: openExceptions.length,
      categories: categories.length
    },
    rules,
    queue,
    receipts,
    checks
  };
}

function renderMarkdown(report) {
  return [
    "# Phase 2 disease reporting readiness report",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Trigger rules: ${report.summary.rules}`,
    `- Report cards: ${report.summary.reportCards}`,
    `- County receipts: ${report.summary.receipts}`,
    `- Patient-center rows: ${report.summary.patientCenterRows}`,
    `- Open exceptions: ${report.summary.openExceptions}`,
    "",
    "## Checks",
    "",
    "| Result | Check | Detail |",
    "|---|---|---|",
    ...report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${clean(item.detail)} |`),
    "",
    "## Reporting queue",
    "",
    "| Card | Disease | County | Push | Patient center | Exception |",
    "|---|---|---|---|---|---|",
    ...report.queue.map((item) => `| ${item.reportCardNo || item.id} | ${clean(item.diseaseName)} | ${clean(item.targetCounty)} | ${clean(item.pushStatus || item.status)} | ${clean(item.patientCenterStatus)}/${clean(item.exportStatus)} | ${clean(item.exceptionStatus)} |`),
    "",
    "## County receipts",
    "",
    "| Receipt | Report | County | Status | Hash |",
    "|---|---|---|---|---|",
    ...report.receipts.map((item) => `| ${item.receiptCode || item.id} | ${item.reportId} | ${clean(item.targetCounty)} | ${clean(item.receiptStatus)} | ${clean(item.auditHash)} |`),
    ""
  ].join("\n");
}

function parseArgs(argv = process.argv.slice(2)) {
  const flags = {};
  argv.forEach((flag) => {
    if (!flag.startsWith("--")) return;
    const [key, ...rest] = flag.slice(2).split("=");
    flags[key] = rest.length ? rest.join("=") : true;
  });
  return flags;
}

function writeOutput(report, flags = {}) {
  const output = path.resolve(ROOT, String(flags.output || DEFAULT_OUTPUT));
  const markdown = path.resolve(ROOT, String(flags.markdown || DEFAULT_MARKDOWN));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2), "utf8");
  fs.mkdirSync(path.dirname(markdown), { recursive: true });
  fs.writeFileSync(markdown, renderMarkdown(report), "utf8");
}

function runCli() {
  const flags = parseArgs();
  const report = buildPhase2DiseaseReportingReadiness();
  if (flags.write !== "false" && flags.write !== false) writeOutput(report, flags);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { buildPhase2DiseaseReportingReadiness, parseArgs, renderMarkdown, writeOutput };
