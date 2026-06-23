#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "hospital-interoperability-functions-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "hospital-interoperability-functions-report.md");

const REQUIRED_FUNCTIONS = [
  "医疗质量与安全监管",
  "分级诊疗与医联体协同",
  "资源运行与运营监管",
  "药品耗材与医保协同监管",
  "公共卫生与慢病管理",
  "科研数据资产与合规共享"
];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function buildHospitalInteroperabilityFunctionsReport(options = {}) {
  const data = options.data || readJson("data/db.json");
  const rows = Array.isArray(data.hospitalInteroperabilityFunctions) ? data.hospitalInteroperabilityFunctions : [];
  const contracts = Array.isArray(data.integrationContracts) ? data.integrationContracts : [];
  const contractIds = new Set(contracts.map((item) => item.id));
  const collectionNames = new Set(Object.keys(data));
  const enriched = rows.map((item) => {
    const collectionCoverage = (item.platformCollections || []).map((collection) => ({
      collection,
      present: collectionNames.has(collection)
    }));
    const contractEvidence = (item.evidence || []).filter((entry) => /-v\d+$/.test(entry));
    const evidenceCoverage = contractEvidence.map((entry) => ({
      evidence: entry,
      present: contractIds.has(entry)
    }));
    return {
      ...item,
      collectionCoverage,
      evidenceCoverage,
      ready: collectionCoverage.every((entry) => entry.present) && evidenceCoverage.every((entry) => entry.present)
    };
  });
  const functionNames = new Set(rows.map((item) => item.functionName));
  const checks = [
    { id: "hospital-functions:coverage", passed: REQUIRED_FUNCTIONS.every((name) => functionNames.has(name)), detail: `${rows.length} management functions` },
    { id: "hospital-functions:source-systems", passed: rows.every((item) => (item.sourceSystems || []).length >= 3), detail: rows.map((item) => `${item.id}:${(item.sourceSystems || []).length}`).join(";") },
    { id: "hospital-functions:management-actions", passed: rows.every((item) => (item.managementActions || []).length >= 3), detail: rows.map((item) => `${item.id}:${(item.managementActions || []).length}`).join(";") },
    { id: "hospital-functions:collections", passed: enriched.every((item) => item.collectionCoverage.every((entry) => entry.present)), detail: enriched.map((item) => `${item.id}:${item.collectionCoverage.filter((entry) => entry.present).length}/${item.collectionCoverage.length}`).join(";") },
    { id: "hospital-functions:contract-evidence", passed: enriched.every((item) => item.evidenceCoverage.every((entry) => entry.present)), detail: enriched.map((item) => `${item.id}:${item.evidenceCoverage.filter((entry) => entry.present).length}/${item.evidenceCoverage.length}`).join(";") }
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    functionCount: rows.length,
    actionCount: rows.reduce((total, item) => total + (item.managementActions || []).length, 0),
    sourceSystemCount: new Set(rows.flatMap((item) => item.sourceSystems || [])).size,
    functions: enriched,
    checks
  };
}

function renderMarkdown(report) {
  const checkRows = report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${String(item.detail || "").replace(/\|/g, "/")} |`);
  const functionRows = report.functions.map((item) => `| ${item.ready ? "PASS" : "FAIL"} | ${item.functionName} | ${(item.sourceSystems || []).join(", ")} | ${(item.managementActions || []).join(", ")} | ${(item.platformCollections || []).join(", ")} | ${item.owner || ""} |`);
  return [
    "# Hospital interoperability management functions report",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Management functions: ${report.functionCount}`,
    `- Management actions: ${report.actionCount}`,
    `- Source systems: ${report.sourceSystemCount}`,
    "",
    "## Checks",
    "",
    "| Result | Check | Detail |",
    "|---|---|---|",
    ...checkRows,
    "",
    "## Function mapping",
    "",
    "| Result | Function | Source systems | Management actions | Platform collections | Owner |",
    "|---|---|---|---|---|---|",
    ...functionRows,
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
  const report = buildHospitalInteroperabilityFunctionsReport();
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

module.exports = { REQUIRED_FUNCTIONS, buildHospitalInteroperabilityFunctionsReport, parseArgs, renderMarkdown, writeOutput };
