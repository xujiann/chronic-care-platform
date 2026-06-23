#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "evaluation-evidence-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "evaluation-evidence-report.md");

const REQUIRED_EVIDENCE = [
  { id: "contracts", label: "接口清单", source: "integrationContracts" },
  { id: "standards", label: "标准映射", source: "interfaceRequirements" },
  { id: "transactions", label: "交易样例", source: "integrationContracts" },
  { id: "rectification", label: "整改记录", source: "platformEvidence" }
];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function buildEvaluationEvidenceReport(options = {}) {
  const data = options.data || readJson("data/db.json");
  const evidenceRows = Array.isArray(data.platformEvidence) ? data.platformEvidence : [];
  const interoperabilityEvidence = evidenceRows.find((item) => item.id === "ev-interoperability") || {};
  const records = Array.isArray(interoperabilityEvidence.records) ? interoperabilityEvidence.records : [];
  const interfaceRequirements = Array.isArray(data.interfaceRequirements) ? data.interfaceRequirements : [];
  const p1Requirements = interfaceRequirements.filter((item) => item.priority === "P1");
  const contracts = Array.isArray(data.integrationContracts) ? data.integrationContracts : [];
  const processAudit = Array.isArray(data.platformProcessAudit) ? data.platformProcessAudit : [];
  const artifactCoverage = REQUIRED_EVIDENCE.map((item) => ({
    ...item,
    present: Array.isArray(interoperabilityEvidence.artifacts) && interoperabilityEvidence.artifacts.includes(item.label),
    recordLinked: records.some((record) => `${record.testRecord || ""}${record.fileName || ""}${record.link || ""}`.includes(item.label) || record.status)
  }));
  const checks = [
    { id: "evaluation:interoperabilityEvidence", passed: Boolean(interoperabilityEvidence.id && interoperabilityEvidence.owner && interoperabilityEvidence.status), detail: interoperabilityEvidence.status || "missing" },
    { id: "evaluation:records", passed: records.length >= 2 && records.every((item) => item.owner && item.testRecord && item.status), detail: `${records.length} records` },
    { id: "evaluation:artifactCoverage", passed: artifactCoverage.every((item) => item.present), detail: artifactCoverage.map((item) => `${item.label}:${item.present ? "yes" : "no"}`).join(";") },
    { id: "evaluation:p1Requirements", passed: p1Requirements.length >= 5 && p1Requirements.every((item) => item.keepExisting && item.need && item.owner && item.status), detail: `${p1Requirements.length} P1 requirements` },
    { id: "evaluation:integrationContracts", passed: contracts.length >= 7 && contracts.every((item) => item.status === "ready" && item.requiredFields?.length), detail: `${contracts.length} ready contracts` },
    { id: "evaluation:processAudit", passed: processAudit.length >= 10 && processAudit.every((item) => item.process && item.auditPoint && item.evidence), detail: `${processAudit.length} audit rows` }
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    interoperabilityEvidence,
    artifactCoverage,
    p1Requirements,
    integrationContracts: contracts,
    processAudit,
    checks
  };
}

function renderMarkdown(report) {
  const checkRows = report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${String(item.detail || "").replace(/\|/g, "/")} |`);
  const artifactRows = report.artifactCoverage.map((item) => `| ${item.present ? "PASS" : "FAIL"} | ${item.label} | ${item.source} | ${item.recordLinked ? "yes" : "no"} |`);
  const requirementRows = report.p1Requirements.map((item) => `| ${item.id} | ${item.domain} | ${item.owner} | ${item.status} |`);
  const contractRows = report.integrationContracts.map((item) => `| ${item.id} | ${item.domain} | ${item.status} | ${item.requiredFields.join(", ")} |`);
  return [
    "# Interoperability evaluation evidence report",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Evidence records: ${report.interoperabilityEvidence.records?.length || 0}`,
    "",
    "## Checks",
    "",
    "| Result | Check | Detail |",
    "|---|---|---|",
    ...checkRows,
    "",
    "## Artifact coverage",
    "",
    "| Result | Artifact | Source | Linked record |",
    "|---|---|---|---|",
    ...artifactRows,
    "",
    "## P1 interface requirements",
    "",
    "| ID | Domain | Owner | Status |",
    "|---|---|---|---|",
    ...requirementRows,
    "",
    "## Integration contracts",
    "",
    "| Contract | Domain | Status | Required fields |",
    "|---|---|---|---|",
    ...contractRows,
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
  const report = buildEvaluationEvidenceReport();
  if (flags.write !== false) writeOutput(report, flags);
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

module.exports = { buildEvaluationEvidenceReport, parseArgs, renderMarkdown, writeOutput };
