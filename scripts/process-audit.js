#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "process-audit-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "process-audit-report.md");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function parseArgs(argv = process.argv.slice(2)) {
  const flags = {};
  argv.forEach((flag) => {
    if (!flag.startsWith("--")) return;
    const [key, ...rest] = flag.slice(2).split("=");
    flags[key] = rest.length ? rest.join("=") : true;
  });
  return {
    output: flags.output || DEFAULT_OUTPUT,
    markdown: flags.markdown || DEFAULT_MARKDOWN
  };
}

function check(id, passed, detail, severity = "error") {
  return { id, passed: Boolean(passed), detail, severity };
}

function summarizeLedger(rows, expected) {
  const items = Array.isArray(rows) ? rows : [];
  const ready = items.filter((item) => /ready|建档|归档|闭环|完成|通过|已/i.test(String(item.acceptanceStatus || item.status || ""))).length;
  return {
    total: items.length,
    ready,
    expected,
    passed: items.length >= expected && ready >= Math.min(items.length, expected)
  };
}

function summarizeStructuredRows(rows, expected, predicate) {
  const items = Array.isArray(rows) ? rows : [];
  const ready = items.filter(predicate).length;
  return {
    total: items.length,
    ready,
    expected,
    passed: items.length >= expected && ready >= expected
  };
}

function buildProcessAuditReport(options = {}) {
  const data = options.data || readJson("data/db.json");
  const processRows = Array.isArray(data.platformProcessAudit) ? data.platformProcessAudit : [];
  const chronic = summarizeLedger(data.chronicAcceptanceLedger, 5);
  const county = summarizeLedger(data.countyAcceptanceLedger, 4);
  const security = summarizeLedger(data.securityAcceptanceLedger, 4);
  const production = summarizeStructuredRows(data.productionDeploymentPlan, 4, (item) => item.id && item.owner && item.nextAction);
  const evidenceDomains = [
    {
      id: "resident-master-index",
      owner: "city-platform",
      evidence: ["residents", "personalRecords", "dataAccessLogs"],
      passed: Array.isArray(data.residents) && data.residents.length > 0 && Array.isArray(data.personalRecords) && data.personalRecords.length > 0
    },
    {
      id: "chronic-care",
      owner: "primary-care-and-cdc",
      evidence: ["chronicAcceptanceLedger", "chronicScreeningTasks", "chronicManagementPlans", "chronicQualityMetrics"],
      passed: chronic.passed
    },
    {
      id: "county-consortium",
      owner: "county-consortium-office",
      evidence: ["countyAcceptanceLedger", "countyCollaborationOrders", "countyMutualRecognitionRecords", "diagnosticReports"],
      passed: county.passed
    },
    {
      id: "insurance-and-pharmacy",
      owner: "insurance-and-primary-care",
      evidence: ["insuranceClaims", "medicationPickups", "careOrders"],
      passed: Array.isArray(data.insuranceClaims) && data.insuranceClaims.length > 0 && Array.isArray(data.medicationPickups) && data.medicationPickups.length > 0
    },
    {
      id: "statistics-and-certificates",
      owner: "statistics-and-institutions",
      evidence: ["healthStatisticsIngestion", "birthCertificates", "deathCertificates"],
      passed: Boolean(data.healthStatisticsIngestion) && Array.isArray(data.birthCertificates) && Array.isArray(data.deathCertificates)
    },
    {
      id: "security-and-cutover",
      owner: "security-and-operations",
      evidence: ["securityAcceptanceLedger", "productionDeploymentPlan", "dataAccessLogs", "securityEvents"],
      passed: security.passed && production.passed
    }
  ];
  const checks = [
    check("process:rows", processRows.length >= 10 && processRows.every((item) => item.process && item.auditPoint && item.evidence), `${processRows.length} process audit rows`),
    check("process:chronicAcceptance", chronic.passed, `${chronic.ready}/${chronic.total} chronic acceptance rows ready`),
    check("process:countyAcceptance", county.passed, `${county.ready}/${county.total} county acceptance rows ready`),
    check("process:securityAcceptance", security.passed, `${security.ready}/${security.total} security acceptance rows ready`),
    check("process:productionCutover", production.passed, `${production.ready}/${production.total} production deployment tracks ready`),
    check("process:evidenceDomains", evidenceDomains.every((item) => item.passed), evidenceDomains.map((item) => `${item.id}:${item.passed ? "pass" : "blocked"}`).join("; "))
  ];
  return {
    ok: checks.every((item) => item.severity !== "error" || item.passed),
    generatedAt: new Date().toISOString(),
    summary: {
      processRows: processRows.length,
      evidenceDomains: evidenceDomains.length,
      passedDomains: evidenceDomains.filter((item) => item.passed).length
    },
    checks,
    evidenceDomains,
    ledgers: { chronic, county, security, production },
    processRows
  };
}

function renderMarkdown(report) {
  const checkRows = report.checks.map((item) => `| ${item.passed ? "PASS" : item.severity.toUpperCase()} | ${item.id} | ${String(item.detail || "").replace(/\|/g, "/")} |`);
  const domainRows = report.evidenceDomains.map((item) => `| ${item.passed ? "PASS" : "BLOCKED"} | ${item.id} | ${item.owner} | ${item.evidence.join(", ")} |`);
  const processRows = report.processRows.map((item) => `| ${item.status || ""} | ${item.process || ""} | ${item.owner || ""} | ${String(item.evidence || "").replace(/\|/g, "/")} | ${String(item.nextAction || "").replace(/\|/g, "/")} |`);
  return [
    "# Full process audit report",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Evidence domains: ${report.summary.passedDomains}/${report.summary.evidenceDomains}`,
    "",
    "| Result | Check | Detail |",
    "|---|---|---|",
    ...checkRows,
    "",
    "## Evidence domains",
    "",
    "| Result | Domain | Owner | Evidence |",
    "|---|---|---|---|",
    ...domainRows,
    "",
    "## Process matrix",
    "",
    "| Status | Process | Owner | Evidence | Next action |",
    "|---|---|---|---|---|",
    ...processRows,
    ""
  ].join("\n");
}

function writeOutput(report, flags = {}) {
  const output = path.resolve(ROOT, String(flags.output || DEFAULT_OUTPUT));
  const markdown = path.resolve(ROOT, String(flags.markdown || DEFAULT_MARKDOWN));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2), "utf8");
  fs.mkdirSync(path.dirname(markdown), { recursive: true });
  fs.writeFileSync(markdown, renderMarkdown(report), "utf8");
}

function main() {
  const flags = parseArgs();
  const report = buildProcessAuditReport();
  writeOutput(report, flags);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = {
  buildProcessAuditReport,
  parseArgs,
  renderMarkdown,
  writeOutput
};
