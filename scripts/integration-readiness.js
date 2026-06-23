#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "integration-readiness-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "integration-readiness-report.md");

const P0_COVERAGE_RULES = [
  { interfaceId: "if-auth", evidence: ["identity-contract"], requiredDomains: [] },
  { interfaceId: "if-person-index", evidence: ["identity-contract", "personal-records-api"], requiredDomains: [] },
  { interfaceId: "if-medical", evidence: ["integration-contracts"], requiredDomains: ["HIS", "EMR", "LIS", "PACS"] },
  { interfaceId: "if-referral", evidence: ["integration-contracts", "workflow-actions"], requiredDomains: ["HIS", "EMR", "LIS", "PACS"] },
  { interfaceId: "if-security", evidence: ["audit-retention-report", "security-acceptance-ledger"], requiredDomains: [] }
];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function buildIntegrationReadinessReport(options = {}) {
  const data = options.data || readJson("data/db.json");
  const interfaces = Array.isArray(data.platformInterfaces) ? data.platformInterfaces : [];
  const contracts = Array.isArray(data.integrationContracts) ? data.integrationContracts : [];
  const p0Interfaces = interfaces.filter((item) => item.priority === "P0");
  const contractsByDomain = new Map();
  contracts.forEach((contract) => {
    const list = contractsByDomain.get(contract.domain) || [];
    list.push(contract);
    contractsByDomain.set(contract.domain, list);
  });
  const p0Coverage = P0_COVERAGE_RULES.map((rule) => {
    const row = p0Interfaces.find((item) => item.id === rule.interfaceId);
    const domainCoverage = rule.requiredDomains.map((domain) => ({
      domain,
      contracts: contractsByDomain.get(domain) || [],
      ready: (contractsByDomain.get(domain) || []).some((item) => item.status === "ready" && item.idempotencyKey && item.signature && item.retryPolicy && item.requiredFields?.length)
    }));
    return {
      ...rule,
      interface: row || null,
      ready: Boolean(row) && domainCoverage.every((item) => item.ready),
      domainCoverage
    };
  });
  const checks = [
    { id: "integration:p0Interfaces", passed: p0Interfaces.length >= 5 && p0Interfaces.every((item) => item.id && item.owner && item.status && item.next), detail: `${p0Interfaces.length} P0 interfaces` },
    { id: "integration:contractsReady", passed: contracts.length >= 7 && contracts.every((item) => item.id && item.version && item.status === "ready" && item.idempotencyKey && item.signature && item.retryPolicy), detail: `${contracts.length} contracts` },
    { id: "integration:medicalCoverage", passed: ["HIS", "EMR", "LIS", "PACS"].every((domain) => contractsByDomain.has(domain)), detail: [...contractsByDomain.keys()].join(",") },
    { id: "integration:p0Coverage", passed: p0Coverage.every((item) => item.ready), detail: p0Coverage.map((item) => `${item.interfaceId}:${item.ready ? "ready" : "blocked"}`).join(";") }
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    contractCount: contracts.length,
    p0InterfaceCount: p0Interfaces.length,
    p0Interfaces,
    contracts,
    p0Coverage,
    checks
  };
}

function renderMarkdown(report) {
  const checkRows = report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${String(item.detail || "").replace(/\|/g, "/")} |`);
  const coverageRows = report.p0Coverage.map((item) => `| ${item.ready ? "PASS" : "FAIL"} | ${item.interfaceId} | ${item.interface?.domain || "missing"} | ${item.interface?.owner || ""} | ${item.evidence.join(", ")} | ${item.requiredDomains.join(", ") || "n/a"} |`);
  const contractRows = report.contracts.map((item) => `| ${item.status === "ready" ? "PASS" : "FAIL"} | ${item.id} | ${item.domain} | ${item.direction} | ${item.resource} | ${item.requiredFields.join(", ")} |`);
  return [
    "# Integration readiness report",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- P0 interfaces: ${report.p0InterfaceCount}`,
    `- Contracts: ${report.contractCount}`,
    "",
    "## Checks",
    "",
    "| Result | Check | Detail |",
    "|---|---|---|",
    ...checkRows,
    "",
    "## P0 coverage",
    "",
    "| Result | Interface | Domain | Owner | Evidence | Required contract domains |",
    "|---|---|---|---|---|---|",
    ...coverageRows,
    "",
    "## Contracts",
    "",
    "| Result | Contract | Domain | Direction | Resource | Required fields |",
    "|---|---|---|---|---|---|",
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
  const report = buildIntegrationReadinessReport();
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

module.exports = { buildIntegrationReadinessReport, parseArgs, renderMarkdown, writeOutput };
