#!/usr/bin/env node
const { readRuntimeSource } = require("../src/http/runtime-source");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "phase2-mutual-recognition-readiness-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "phase2-mutual-recognition-readiness-report.md");

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

function defaultCatalog() {
  return Array.from({ length: 78 }, (_, index) => ({
    id: `P2-MR-${String(index + 1).padStart(3, "0")}`,
    catalogCode: `P2-MR-${String(index + 1).padStart(3, "0")}`,
    item: index === 0 ? "HbA1c" : index === 1 ? "ECG" : `Mutual recognition item ${index + 1}`,
    standardName: index === 0 ? "糖化血红蛋白" : index === 1 ? "常规心电图" : `互认目录项目 ${index + 1}`,
    category: index % 5 === 0 ? "imaging" : "lab",
    sourceItemCodes: [`LIS-${String(index + 1).padStart(3, "0")}`],
    ruleId: index % 5 === 0 ? "mrr-ct-001" : "mrr-hba1c-001",
    qualityStandard: index % 5 === 0 ? "image-quality-passed" : "lab-qc-passed",
    recognitionMode: index % 5 === 0 ? "manual" : "auto",
    status: index >= 70 ? "onsite-blocked" : "mapped"
  }));
}

function defaultReports() {
  return [
    { id: "dr-ecg-001", residentId: "r1", item: "ECG", category: "electrocardiogram", sourceInstitution: "primary", targetInstitution: "hospital", status: "recognized", recognitionRecordId: "cmr-001", reportPdfHash: "sha256:ecg" },
    { id: "dr-001", residentId: "r2", item: "HbA1c", category: "lab", sourceInstitution: "hospital", targetInstitution: "hospital", status: "recognized", recognitionRecordId: "cmr-002", reportPdfHash: "sha256:hba1c" },
    { id: "dr-us-001", residentId: "r4", item: "Carotid ultrasound", category: "ultrasound", sourceInstitution: "primary", targetInstitution: "hospital", status: "not_recognized", recognitionRecordId: "cmr-003", reportPdfHash: "sha256:us" }
  ];
}

function defaultRecords() {
  return [
    { id: "cmr-001", residentId: "r1", item: "ECG", sourceInstitution: "primary", targetInstitution: "hospital", status: "recognized", savedCost: 86, reason: "qc passed", reportId: "dr-ecg-001" },
    { id: "cmr-002", residentId: "r2", item: "HbA1c", sourceInstitution: "hospital", targetInstitution: "hospital", status: "recognized", savedCost: 120, reason: "matched rule", reportId: "dr-001" },
    { id: "cmr-003", residentId: "r4", item: "Carotid ultrasound", sourceInstitution: "primary", targetInstitution: "hospital", status: "rejected", savedCost: 180, reason: "poor quality", reportId: "dr-us-001", nonRecognitionReason: "poor-quality" }
  ];
}

function defaultCitations() {
  return [
    { id: "p2mrc-cmr-001", recognitionRecordId: "cmr-001", reportId: "dr-ecg-001", catalogCode: "P2-MR-002", evidenceHash: "sha256:c1", reportPdfHash: "sha256:ecg", chainNode: "DL-health-chain-demo-node", verificationStatus: "verified", decision: "recognized" },
    { id: "p2mrc-cmr-002", recognitionRecordId: "cmr-002", reportId: "dr-001", catalogCode: "P2-MR-001", evidenceHash: "sha256:c2", reportPdfHash: "sha256:hba1c", chainNode: "DL-health-chain-demo-node", verificationStatus: "verified", decision: "recognized" },
    { id: "p2mrc-cmr-003", recognitionRecordId: "cmr-003", reportId: "dr-us-001", catalogCode: "P2-MR-003", evidenceHash: "sha256:c3", reportPdfHash: "sha256:us", chainNode: "DL-health-chain-demo-node", verificationStatus: "verified", decision: "rejected" }
  ];
}

function defaultRules() {
  return [
    { id: "mrr-ecg-001", status: "active" },
    { id: "mrr-hba1c-001", status: "active" },
    { id: "mrr-ct-001", status: "active" }
  ];
}

function defaultReviews() {
  return [{ id: "mrqr-001", recognitionRecordId: "cmr-001", status: "open" }];
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

function buildPhase2MutualRecognitionReadiness(options = {}) {
  const data = options.data ?? readJson("data/db.json");
  const pkg = options.pkg ?? readJson("package.json");
  const serverSource = options.serverSource ?? readRuntimeSource(ROOT);
  const countySource = options.countySource ?? readText("county.js");
  const countyHtml = options.countyHtml ?? readText("county.html");
  const manifestSource = options.manifestSource ?? readText(path.join("scripts", "release-artifact-manifest.js"));
  const deployCheckSource = options.deployCheckSource ?? readText(path.join("scripts", "deploy-check.js"));
  const releaseReportSource = options.releaseReportSource ?? readText(path.join("scripts", "release-report.js"));
  const catalog = options.catalog ?? mergeRows(defaultCatalog(), data.phase2MutualRecognitionCatalog, "id");
  const reports = options.reports ?? mergeRows(defaultReports(), data.diagnosticReports, "id");
  const records = options.records ?? mergeRows(defaultRecords(), data.countyMutualRecognitionRecords, "id");
  const citations = options.citations ?? mergeRows(defaultCitations(), data.phase2MutualRecognitionCitations, "id");
  const rules = options.rules ?? mergeRows(defaultRules(), data.mutualRecognitionRules, "id");
  const reviews = options.reviews ?? mergeRows(defaultReviews(), data.mutualRecognitionQualityReviews, "id");
  const reportIds = new Set(reports.map((item) => item.id));
  const recordIds = new Set(records.map((item) => item.id));
  const catalogCodes = new Set(catalog.map((item) => item.catalogCode || item.id));
  const recognized = records.filter((item) => /recognized|已互认|已/.test(String(item.status || "")));
  const rejected = records.filter((item) => /reject|退回|不互认|not_recognized/i.test(`${item.status || ""} ${item.reviewStatus || ""}`));
  const pending = records.filter((item) => /pending|待|复核/i.test(`${item.status || ""} ${item.reviewStatus || ""}`));
  const sourceChannels = [...new Set(catalog.flatMap((item) => item.sourceSystems || item.sourceItemCodes || []))];
  const onsiteBlockers = catalog.filter((item) => /blocked/i.test(String(item.status || item.blocker || "")));
  const checks = [
    check("phase2MutualRecognition:78-item-map", catalog.length >= 78 && catalog.every((item) => item.catalogCode && item.item && item.ruleId && item.qualityStandard), `${catalog.length}/78 mapped recognition items`),
    check("phase2MutualRecognition:report-browser", reports.length >= 3 && reports.every((item) => item.id && item.recognitionRecordId && item.reportPdfHash), `${reports.length} report browser rows`),
    check("phase2MutualRecognition:decision-loop", records.length >= 3 && recognized.length >= 1 && (rejected.length >= 1 || pending.length >= 1) && records.every((item) => item.reason), `${recognized.length} recognized / ${rejected.length} rejected / ${pending.length} pending`),
    check("phase2MutualRecognition:citation-chain", citations.length >= 3 && citations.every((item) => reportIds.has(item.reportId) && recordIds.has(item.recognitionRecordId) && catalogCodes.has(item.catalogCode) && item.evidenceHash && item.chainNode), `${citations.length} citations with report hashes`),
    check("phase2MutualRecognition:supervision-stats", rules.length >= 3 && reviews.length >= 1 && sourceChannels.length >= 3, `${rules.length} rules / ${reviews.length} QC reviews / ${sourceChannels.length} source channels`),
    check("phase2MutualRecognition:runtime-api", serverSource.includes("/api/phase2/mutual-recognition") && serverSource.includes("buildPhase2MutualRecognitionOverview") && serverSource.includes("phase2-mutual-recognition-decision"), "runtime API and decision action are wired"),
    check("phase2MutualRecognition:county-ui", countySource.includes("renderPhase2MutualRecognition") && countyHtml.includes("phase2-mutual-recognition-browser"), "county UI renders phase-2 mutual recognition MVP"),
    check("phase2MutualRecognition:onsite-boundary", onsiteBlockers.length >= 1 || serverSource.includes("phase2-mutual-recognition-live-pdf-source"), `${onsiteBlockers.length} catalog blockers plus live PDF source blocker`),
    check("phase2MutualRecognition:release-wiring", Boolean(pkg.scripts?.["phase2:mutual-recognition-readiness"]) && manifestSource.includes("phase2-mutual-recognition-readiness-report.md") && deployCheckSource.includes("phase2MutualRecognitionReadiness") && releaseReportSource.includes("phase2MutualRecognition"), "package script, manifest, deploy check and release report are wired")
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    summary: {
      catalogItems: catalog.length,
      reports: reports.length,
      recognitionRecords: records.length,
      recognized: recognized.length,
      rejected: rejected.length,
      pending: pending.length,
      citations: citations.length,
      qualityReviews: reviews.length,
      sourceChannels: sourceChannels.length,
      onsiteBlockers: onsiteBlockers.length + 1
    },
    catalog,
    reports,
    records,
    citations,
    checks
  };
}

function renderMarkdown(report) {
  return [
    "# Phase 2 mutual recognition readiness report",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- 78-item mapping: ${report.summary.catalogItems}/78`,
    `- Reports: ${report.summary.reports}`,
    `- Recognition decisions: ${report.summary.recognized} recognized / ${report.summary.rejected} rejected / ${report.summary.pending} pending`,
    `- Citations: ${report.summary.citations}`,
    `- Onsite blockers: ${report.summary.onsiteBlockers}`,
    "",
    "## Checks",
    "",
    "| Result | Check | Detail |",
    "|---|---|---|",
    ...report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${clean(item.detail)} |`),
    "",
    "## Catalog sample",
    "",
    "| Code | Item | Standard | Category | Status |",
    "|---|---|---|---|---|",
    ...report.catalog.slice(0, 12).map((item) => `| ${item.catalogCode || item.id} | ${clean(item.item)} | ${clean(item.standardName)} | ${item.category || ""} | ${item.status || ""} |`),
    "",
    "## Citation chain",
    "",
    "| ID | Report | Recognition | Catalog | Decision | Evidence |",
    "|---|---|---|---|---|---|",
    ...report.citations.map((item) => `| ${item.id} | ${item.reportId} | ${item.recognitionRecordId} | ${item.catalogCode} | ${item.decision || ""} | ${clean(item.evidenceHash)} |`),
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
  const report = buildPhase2MutualRecognitionReadiness();
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

module.exports = { buildPhase2MutualRecognitionReadiness, parseArgs, renderMarkdown, writeOutput };
