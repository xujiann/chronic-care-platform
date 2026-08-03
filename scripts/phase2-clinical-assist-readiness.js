#!/usr/bin/env node
const { readRuntimeSource } = require("../src/http/runtime-source");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "phase2-clinical-assist-readiness-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "phase2-clinical-assist-readiness-report.md");

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
    { id: "p2ca-rule-duplicate-diagnosis", category: "duplicate-diagnosis", name: "Duplicate diagnosis", sourceSystem: "EMR", triggerCondition: "same ICD in 30 days", requiredFields: ["residentId", "doctorId", "icdCode"], configStatus: "active", defaultAction: "cite existing diagnosis" },
    { id: "p2ca-rule-duplicate-check", category: "duplicate-check", name: "Duplicate check", sourceSystem: "HIS/PACS", triggerCondition: "same check in 14 days", requiredFields: ["residentId", "doctorId", "checkItem"], configStatus: "active", defaultAction: "review prior image" },
    { id: "p2ca-rule-duplicate-lab", category: "duplicate-lab", name: "Duplicate lab", sourceSystem: "HIS/LIS", triggerCondition: "valid mutual-recognition lab", requiredFields: ["residentId", "doctorId", "labItem"], configStatus: "active", defaultAction: "cite mutual-recognition report" },
    { id: "p2ca-rule-duplicate-medication", category: "duplicate-medication", name: "Duplicate medication", sourceSystem: "HIS/pharmacy", triggerCondition: "same medication class", requiredFields: ["residentId", "doctorId", "medication"], configStatus: "active", defaultAction: "adjust prescription" }
  ];
}

function defaultAlerts() {
  return [
    { id: "p2caa-lab-r1", residentId: "r1", doctorId: "doc-liu", ruleId: "p2ca-rule-duplicate-lab", category: "duplicate-lab", alertTitle: "Duplicate HbA1c lab", severity: "high", recommendation: "cite mutual-recognition report", status: "pending-doctor-receipt", messageReceiptStatus: "pending", pluginSurface: "doctor-workstation-banner", serviceIntegrationStatus: "embedded-demo" },
    { id: "p2caa-med-r1", residentId: "r1", doctorId: "doc-liu", ruleId: "p2ca-rule-duplicate-medication", category: "duplicate-medication", alertTitle: "Duplicate medication", severity: "high", recommendation: "adjust prescription", status: "acknowledged", messageReceiptStatus: "received", pluginSurface: "prescription-inline-card", serviceIntegrationStatus: "embedded-demo" },
    { id: "p2caa-dx-r2", residentId: "r2", doctorId: "doc-wang", ruleId: "p2ca-rule-duplicate-diagnosis", category: "duplicate-diagnosis", alertTitle: "Duplicate diagnosis", severity: "medium", recommendation: "cite existing diagnosis", status: "acknowledged", messageReceiptStatus: "received", pluginSurface: "emr-diagnosis-sidebar", serviceIntegrationStatus: "embedded-demo" },
    { id: "p2caa-check-r4", residentId: "r4", doctorId: "doc-wang", ruleId: "p2ca-rule-duplicate-check", category: "duplicate-check", alertTitle: "Duplicate check", severity: "medium", recommendation: "review prior image", status: "pending-doctor-receipt", messageReceiptStatus: "pending", pluginSurface: "order-entry-inline-card", serviceIntegrationStatus: "embedded-demo" }
  ];
}

function defaultReceipts() {
  return [
    { id: "p2car-med-r1", alertId: "p2caa-med-r1", doctorId: "doc-liu", receiptStatus: "received", doctorAction: "adjusted-prescription", messageChannel: "doctor-workstation", auditHash: "sha256:med-r1" },
    { id: "p2car-dx-r2", alertId: "p2caa-dx-r2", doctorId: "doc-wang", receiptStatus: "received", doctorAction: "cited-existing-diagnosis", messageChannel: "emr-plugin", auditHash: "sha256:dx-r2" },
    { id: "p2car-lab-supervision", alertId: "p2caa-lab-r1", doctorId: "doc-liu", receiptStatus: "sent", doctorAction: "pending", messageChannel: "message-center", auditHash: "sha256:lab" }
  ];
}

function defaultContracts() {
  return [
    { id: "p2ca-plugin-workstation", endpoint: "GET /api/phase2/clinical-assist", payloadFields: ["alertId", "residentId", "doctorId"], status: "mvp-ready" },
    { id: "p2ca-plugin-receipt", endpoint: "POST /api/phase2/clinical-assist/alerts/:id/receipt", payloadFields: ["receiptStatus", "doctorAction"], status: "mvp-ready" },
    { id: "p2ca-plugin-rule-config", endpoint: "POST /api/phase2/clinical-assist/rules/:id/config", payloadFields: ["configStatus", "severity"], status: "mvp-ready" }
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

function buildPhase2ClinicalAssistReadiness(options = {}) {
  const data = options.data ?? readJson("data/db.json");
  const pkg = options.pkg ?? readJson("package.json");
  const serverSource = options.serverSource ?? readRuntimeSource(ROOT);
  const platformSource = options.platformSource ?? readText("platform.js");
  const platformHtml = options.platformHtml ?? readText("platform.html");
  const doctorSource = options.doctorSource ?? readText("doctor.js");
  const doctorHtml = options.doctorHtml ?? readText("doctor.html");
  const manifestSource = options.manifestSource ?? readText(path.join("scripts", "release-artifact-manifest.js"));
  const deployCheckSource = options.deployCheckSource ?? readText(path.join("scripts", "deploy-check.js"));
  const releaseReportSource = options.releaseReportSource ?? readText(path.join("scripts", "release-report.js"));
  const rules = options.rules ?? mergeRows(defaultRules(), data.phase2ClinicalAssistRules, "id");
  const alerts = options.alerts ?? mergeRows(defaultAlerts(), data.phase2ClinicalAssistAlerts, "id");
  const receipts = options.receipts ?? mergeRows(defaultReceipts(), data.phase2ClinicalAssistReceipts, "id");
  const contracts = options.contracts ?? mergeRows(defaultContracts(), data.phase2ClinicalAssistPluginContracts, "id");
  const ruleIds = new Set(rules.map((item) => item.id));
  const alertIds = new Set(alerts.map((item) => item.id));
  const categories = [...new Set(rules.map((item) => item.category))];
  const pending = alerts.filter((item) => /pending|待/i.test(`${item.status || ""} ${item.messageReceiptStatus || ""}`));
  const acknowledged = alerts.filter((item) => /acknowledged|received|已/i.test(`${item.status || ""} ${item.messageReceiptStatus || ""}`));
  const doctorScopes = [...new Set(alerts.map((item) => item.doctorId).filter(Boolean))];
  const checks = [
    check("phase2ClinicalAssist:rule-config", ["duplicate-diagnosis", "duplicate-check", "duplicate-lab", "duplicate-medication"].every((category) => categories.includes(category)) && rules.every((item) => item.requiredFields?.length && item.defaultAction && item.configStatus), `${rules.length} rule configs`),
    check("phase2ClinicalAssist:alert-queue", alerts.length >= 4 && alerts.every((item) => ruleIds.has(item.ruleId) && item.residentId && item.doctorId && item.pluginSurface), `${alerts.length} clinical assist alerts`),
    check("phase2ClinicalAssist:doctor-workstation", doctorScopes.length >= 2 && alerts.every((item) => item.serviceIntegrationStatus && item.recommendation), `${doctorScopes.length} doctor workstation scopes`),
    check("phase2ClinicalAssist:message-receipts", receipts.length >= 3 && receipts.every((item) => alertIds.has(item.alertId) && item.auditHash && item.messageChannel), `${receipts.length} message receipts`),
    check("phase2ClinicalAssist:plugin-contracts", contracts.length >= 3 && contracts.every((item) => item.endpoint && item.payloadFields?.length && item.status), `${contracts.length} plugin contracts`),
    check("phase2ClinicalAssist:runtime-api", serverSource.includes("/api/phase2/clinical-assist") && serverSource.includes("buildPhase2ClinicalAssistOverview") && serverSource.includes("phase2-clinical-assist-receipt") && serverSource.includes("phase2-clinical-assist-rule-config"), "runtime API, receipt, rule config and audit actions are wired"),
    check("phase2ClinicalAssist:doctor-ui", doctorHtml.includes("doctor-clinical-assist") && doctorSource.includes("renderDoctorClinicalAssist") && doctorSource.includes("data-clinical-assist-receipt"), "doctor workstation UI and receipt action are wired"),
    check("phase2ClinicalAssist:platform-ui", platformHtml.includes("phase2-clinical-assist") && platformSource.includes("renderPhase2ClinicalAssist"), "platform supervision UI is wired"),
    check("phase2ClinicalAssist:release-wiring", Boolean(pkg.scripts?.["phase2:clinical-assist-readiness"]) && manifestSource.includes("phase2-clinical-assist-readiness-report.md") && deployCheckSource.includes("phase2ClinicalAssistReadiness") && releaseReportSource.includes("phase2ClinicalAssist"), "package script, manifest, deploy check and release report are wired")
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    summary: {
      rules: rules.length,
      alerts: alerts.length,
      pendingAlerts: pending.length,
      acknowledged: acknowledged.length,
      receipts: receipts.length,
      pluginContracts: contracts.length,
      categories: categories.length,
      doctorScopes: doctorScopes.length
    },
    rules,
    alerts,
    receipts,
    pluginContracts: contracts,
    checks
  };
}

function renderMarkdown(report) {
  return [
    "# Phase 2 clinical assist readiness report",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Rule configs: ${report.summary.rules}`,
    `- Clinical alerts: ${report.summary.alerts}`,
    `- Message receipts: ${report.summary.receipts}`,
    `- Plugin contracts: ${report.summary.pluginContracts}`,
    `- Doctor scopes: ${report.summary.doctorScopes}`,
    "",
    "## Checks",
    "",
    "| Result | Check | Detail |",
    "|---|---|---|",
    ...report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${clean(item.detail)} |`),
    "",
    "## Alert queue",
    "",
    "| Alert | Category | Doctor | Status | Recommendation |",
    "|---|---|---|---|---|",
    ...report.alerts.map((item) => `| ${item.id} | ${clean(item.category)} | ${clean(item.doctorId)} | ${clean(item.messageReceiptStatus || item.status)} | ${clean(item.recommendation)} |`),
    "",
    "## Plugin contracts",
    "",
    "| Contract | Endpoint | Status |",
    "|---|---|---|",
    ...report.pluginContracts.map((item) => `| ${item.id} | ${clean(item.endpoint)} | ${clean(item.status)} |`),
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
  const report = buildPhase2ClinicalAssistReadiness();
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

module.exports = { buildPhase2ClinicalAssistReadiness, parseArgs, renderMarkdown, writeOutput };
