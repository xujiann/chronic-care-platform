#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "drug-consumable-readiness-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "drug-consumable-readiness-report.md");

const REQUIRED_BOUNDARIES = [
  "rational-medication",
  "fixed-pharmacy",
  "consumable-clue",
  "insurance-settlement",
  "remediation-loop"
];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function normalizeStatus(value) {
  const text = String(value || "").toLowerCase();
  if (/closed|passed|complete|done|resolved|通过|完成/.test(text)) return "closed";
  if (/reject|return|补正|整改|退回/.test(text)) return "remediation";
  if (/pending|wait|待|初审|review/.test(text)) return "pending";
  return text || "tracking";
}

function buildDrugConsumableReadinessReport(options = {}) {
  const data = options.data ?? readJson("data/db.json");
  const pkg = options.pkg ?? readJson("package.json");
  const readme = options.readme ?? readText("README.md");
  const deployment = options.deployment ?? readText("DEPLOYMENT.md");
  const server = options.server ?? readText("server.js");
  const insurancePage = options.insurancePage ?? readText("insurance.html");
  const insuranceJs = options.insuranceJs ?? readText("insurance.js");
  const rows = Array.isArray(data.drugConsumableSupervisions) ? data.drugConsumableSupervisions : [];
  const pickups = Array.isArray(data.medicationPickups) ? data.medicationPickups : [];
  const claims = Array.isArray(data.insuranceClaims) ? data.insuranceClaims : [];
  const institutionSupervisions = Array.isArray(data.institutionSupervisions) ? data.institutionSupervisions : [];
  const contracts = Array.isArray(data.integrationContracts) ? data.integrationContracts : [];
  const insuranceContract = contracts.find((item) => item.id === "insurance-settlement-v1");
  const boundaries = new Set(rows.map((item) => item.boundary));
  if (pickups.length) boundaries.add("fixed-pharmacy");
  if (claims.length && insuranceContract) boundaries.add("insurance-settlement");
  if (rows.some((item) => item.remediationStatus && normalizeStatus(item.remediationStatus) !== "closed")) boundaries.add("remediation-loop");
  const linkedRows = rows.map((item) => ({
    id: item.id,
    boundary: item.boundary,
    status: item.status,
    normalizedStatus: normalizeStatus(item.status || item.reviewStatus || item.insuranceStatus),
    pickupLinked: !item.relatedPickupId || pickups.some((row) => row.id === item.relatedPickupId),
    claimLinked: !item.relatedClaimId || claims.some((row) => row.id === item.relatedClaimId),
    supervisionLinked: item.sourceCollection !== "institutionSupervisions" || institutionSupervisions.some((row) => row.id === item.sourceId),
    auditTrailPresent: Array.isArray(item.auditTrail) && item.auditTrail.length > 0
  }));
  const docsMentionArtifacts = /drug-consumable-readiness-report\.md/.test(readme) && /drug-consumable-readiness-report\.md/.test(deployment);
  const checks = [
    { id: "drug-consumable:data", passed: rows.length >= 3 && pickups.length > 0 && claims.length > 0 && institutionSupervisions.length > 0, detail: `${rows.length} supervision rows; ${pickups.length} pickups; ${claims.length} claims` },
    { id: "drug-consumable:boundaries", passed: REQUIRED_BOUNDARIES.every((item) => boundaries.has(item)), detail: REQUIRED_BOUNDARIES.map((item) => `${item}:${boundaries.has(item) ? "present" : "missing"}`).join(";") },
    { id: "drug-consumable:links", passed: linkedRows.every((item) => item.pickupLinked && item.claimLinked && item.supervisionLinked), detail: linkedRows.map((item) => `${item.id}:${item.pickupLinked && item.claimLinked && item.supervisionLinked ? "linked" : "missing-link"}`).join(";") },
    { id: "drug-consumable:audit", passed: linkedRows.every((item) => item.auditTrailPresent) && /drug-consumable-review/.test(server) && /drug-consumable-remediation/.test(server), detail: "business auditTrail and securityEvents actions are wired" },
    { id: "drug-consumable:insurance-contract", passed: Boolean(insuranceContract?.status === "ready" && insuranceContract.signature && insuranceContract.retryPolicy), detail: insuranceContract ? `${insuranceContract.id}:${insuranceContract.status}` : "missing insurance-settlement-v1" },
    { id: "drug-consumable:frontend", passed: /drug-consumable-panel/.test(insurancePage) && /renderDrugConsumableSupervision/.test(insuranceJs), detail: "insurance portal renders actionable drug consumable supervision entry" },
    { id: "drug-consumable:release", passed: Boolean(pkg.scripts?.["drug-consumable:readiness"] && docsMentionArtifacts), detail: docsMentionArtifacts ? "script and docs present" : "missing script or docs" }
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    requiredBoundaries: REQUIRED_BOUNDARIES,
    summary: {
      supervisionRows: rows.length,
      openRows: linkedRows.filter((item) => item.normalizedStatus !== "closed").length,
      medicationPickups: pickups.length,
      insuranceClaims: claims.length,
      institutionSupervisions: institutionSupervisions.length,
      insuranceContractReady: Boolean(insuranceContract?.status === "ready")
    },
    linkedRows,
    checks
  };
}

function renderMarkdown(report) {
  const checkRows = report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${String(item.detail || "").replace(/\|/g, "/")} |`);
  const rowLines = report.linkedRows.map((item) => `| ${item.id} | ${item.boundary} | ${item.normalizedStatus} | ${item.pickupLinked ? "yes" : "no"} | ${item.claimLinked ? "yes" : "no"} | ${item.auditTrailPresent ? "yes" : "no"} |`);
  return [
    "# Drug consumable readiness report",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Supervision rows: ${report.summary.supervisionRows}`,
    `- Open rows: ${report.summary.openRows}`,
    "",
    "## Checks",
    "",
    "| Result | Check | Detail |",
    "|---|---|---|",
    ...checkRows,
    "",
    "## Supervision links",
    "",
    "| Row | Boundary | Status | Pickup | Claim | Audit |",
    "|---|---|---|---|---|---|",
    ...rowLines,
    ""
  ].join("\n");
}

function parseArgs(argv = process.argv.slice(2)) {
  return Object.fromEntries(argv
    .filter((flag) => flag.startsWith("--"))
    .map((flag) => {
      const [key, ...rest] = flag.slice(2).split("=");
      return [key, rest.length ? rest.join("=") : true];
    }));
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
  const report = buildDrugConsumableReadinessReport();
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

module.exports = { REQUIRED_BOUNDARIES, buildDrugConsumableReadinessReport, normalizeStatus, parseArgs, renderMarkdown, writeOutput };
