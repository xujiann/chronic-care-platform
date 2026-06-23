#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { inspectStorageModel } = require("./storage-admin");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "production-db-readiness-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "production-db-readiness-report.md");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function arrayOf(data, key) {
  return Array.isArray(data[key]) ? data[key] : [];
}

function hasText(text, pattern) {
  return pattern.test(String(text || ""));
}

function buildProductionDbReadinessReport(options = {}) {
  const data = options.data ?? readJson("data/db.json");
  const pkg = options.pkg ?? readJson("package.json");
  const serverSource = options.serverSource ?? readText("server.js");
  const deployment = options.deployment ?? readText("DEPLOYMENT.md");
  const readme = options.readme ?? readText("README.md");
  const storageModel = options.storageModel ?? inspectStorageModel({ dataDir: path.join(ROOT, "data") });
  const productionTrack = arrayOf(data, "productionDeploymentPlan").find((item) => item.id === "prod-storage-adapter") || null;
  const json = storageModel.jsonSnapshot || {};
  const sqlite = storageModel.sqlite || {};
  const requiredScripts = ["storage:backup", "storage:inspect", "storage:assess", "rollback:snapshot", "release:report"];
  const migrationEvidence = {
    currentAdapter: "sqlite-json-mirror",
    targetAdapter: "postgresql",
    runtimePostgresEnabled: !/PostgreSQL is tracked in productionDeploymentPlan but the runtime adapter is not enabled yet/.test(serverSource),
    runtimePostgresBlocked: /PostgreSQL is tracked in productionDeploymentPlan but the runtime adapter is not enabled yet/.test(serverSource),
    requiredConfig: productionTrack?.requiredConfig || [],
    evidence: productionTrack?.evidence || [],
    nextAction: productionTrack?.nextAction || ""
  };
  const rehearsalEvidence = {
    backupDocumented: hasText(deployment, /storage:backup/) && hasText(deployment, /manifest\.json|SHA-256/),
    restoreDocumented: hasText(deployment, /rehearse/) && hasText(deployment, /restore/),
    rtoRpoDocumented: hasText(deployment, /RTO/) && hasText(deployment, /RPO/),
    releaseArtifactDocumented: hasText(readme, /storage-model-inspection\.md/) && hasText(readme, /release:report/)
  };
  const checks = [
    { id: "production-db:track", passed: Boolean(productionTrack?.owner && productionTrack?.nextAction), detail: productionTrack?.status || "missing production deployment track" },
    { id: "production-db:requiredConfig", passed: ["DATABASE_URL", "STORAGE_ENGINE=postgres"].every((item) => migrationEvidence.requiredConfig.includes(item)), detail: migrationEvidence.requiredConfig.join(",") || "missing" },
    { id: "production-db:runtimeBlock", passed: migrationEvidence.runtimePostgresBlocked, detail: migrationEvidence.runtimePostgresBlocked ? "postgres runtime intentionally blocked until adapter is implemented" : "postgres runtime appears enabled" },
    { id: "production-db:jsonSnapshot", passed: Boolean(json.present && Number(json.collections || 0) >= 40 && Number(json.totalRecords || 0) > 0), detail: `${json.collections || 0} collections / ${json.totalRecords || 0} records` },
    { id: "production-db:sqliteSchema", passed: !sqlite.present || Boolean(sqlite.available && Number(sqlite.schemaVersion || 0) >= 7 && Number(sqlite.tableCount || 0) >= 10), detail: sqlite.present ? `schema v${sqlite.schemaVersion || 0}, ${sqlite.tableCount || 0} tables` : "sqlite file not present in this checkout" },
    { id: "production-db:backupScripts", passed: requiredScripts.every((name) => pkg.scripts?.[name]), detail: requiredScripts.filter((name) => !pkg.scripts?.[name]).join(",") || "all required scripts present" },
    { id: "production-db:rehearsalDocs", passed: Object.values(rehearsalEvidence).every(Boolean), detail: Object.entries(rehearsalEvidence).map(([key, value]) => `${key}:${value ? "yes" : "no"}`).join(";") }
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    storageModel,
    productionTrack,
    migrationEvidence,
    rehearsalEvidence,
    checks
  };
}

function renderMarkdown(report) {
  const checkRows = report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${String(item.detail || "").replace(/\|/g, "/")} |`);
  const configRows = (report.migrationEvidence.requiredConfig || []).map((item) => `| ${item} |`);
  const evidenceRows = (report.migrationEvidence.evidence || []).map((item) => `| ${item} |`);
  const sqlite = report.storageModel?.sqlite || {};
  const json = report.storageModel?.jsonSnapshot || {};
  return [
    "# Production database readiness report",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Current adapter: ${report.migrationEvidence.currentAdapter}`,
    `- Target adapter: ${report.migrationEvidence.targetAdapter}`,
    `- PostgreSQL runtime enabled: ${report.migrationEvidence.runtimePostgresEnabled ? "yes" : "no"}`,
    "",
    "## Checks",
    "",
    "| Result | Check | Detail |",
    "|---|---|---|",
    ...checkRows,
    "",
    "## Current storage evidence",
    "",
    `- JSON snapshot: ${json.present ? "present" : "missing"}, ${json.collections || 0} collections, ${json.totalRecords || 0} records`,
    `- SQLite: ${sqlite.present ? "present" : "not present"}, schema v${sqlite.schemaVersion || 0}, ${sqlite.tableCount || 0} tables`,
    "",
    "## Required production database configuration",
    "",
    "| Item |",
    "|---|",
    ...configRows,
    "",
    "## Migration and rehearsal evidence",
    "",
    "| Evidence |",
    "|---|",
    ...evidenceRows,
    "",
    `Next action: ${report.migrationEvidence.nextAction || "n/a"}`,
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
  fs.writeFileSync(output, JSON.stringify({ generatedAt: report.generatedAt, ok: report.ok, productionDbReadiness: report }, null, 2), "utf8");
  fs.mkdirSync(path.dirname(markdown), { recursive: true });
  fs.writeFileSync(markdown, renderMarkdown(report), "utf8");
}

function runCli() {
  const flags = parseArgs();
  const report = buildProductionDbReadinessReport();
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

module.exports = { buildProductionDbReadinessReport, parseArgs, renderMarkdown, writeOutput };
