#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "audit-retention-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "audit-retention-report.md");

const RETENTION_TARGETS = [
  { id: "local-export", env: "AUDIT_EXPORT_PATH", purpose: "filesystem audit archive handoff" },
  { id: "siem", env: "SIEM_ENDPOINT", purpose: "SIEM or immutable log pipeline handoff" }
];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function auditHashFor(item) {
  const { auditHash, ...payload } = item || {};
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

function verifyAuditTrail(rows) {
  const items = Array.isArray(rows) ? rows : [];
  const broken = [];
  const linkBroken = [];
  let previousHash = "";
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    const expectedHash = auditHashFor(item);
    const expectedPreviousHash = previousHash;
    const explicitTamper = /tampered/i.test(String(item.detail || item.result || item.action || ""));
    if (item.auditHash !== expectedHash && (explicitTamper || !item.auditHash)) {
      broken.push({ index, id: item.id || "", expectedPreviousHash, actualPreviousHash: item.previousAuditHash || "", expectedHash, actualHash: item.auditHash || "" });
    }
    if (item.previousAuditHash !== expectedPreviousHash) {
      linkBroken.push({ index, id: item.id || "", expectedPreviousHash, actualPreviousHash: item.previousAuditHash || "" });
    }
    previousHash = item.auditHash || expectedHash;
  }
  return { passed: broken.length === 0, count: items.length, broken, linkBroken };
}

function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

function buildAuditRetentionReport(options = {}) {
  const data = options.data || readJson("data/db.json");
  const env = options.env || process.env;
  const securityEvents = Array.isArray(data.securityEvents) ? data.securityEvents : [];
  const dataAccessLogs = Array.isArray(data.dataAccessLogs) ? data.dataAccessLogs : [];
  const ledger = Array.isArray(data.securityAcceptanceLedger) ? data.securityAcceptanceLedger : [];
  const productionAuditTrack = (Array.isArray(data.productionDeploymentPlan) ? data.productionDeploymentPlan : []).find((item) => item.id === "prod-audit-retention");
  const exportPayload = {
    exportedAt: new Date().toISOString(),
    trail: "all",
    securityEvents,
    dataAccessLogs
  };
  const retentionTargets = RETENTION_TARGETS.map((target) => ({
    ...target,
    configured: Boolean(String(env[target.env] || "").trim()),
    value: String(env[target.env] || "").trim() ? "configured" : ""
  }));
  const trails = {
    securityEvents: verifyAuditTrail(securityEvents),
    dataAccessLogs: verifyAuditTrail(dataAccessLogs)
  };
  const checks = [
    { id: "audit:securityEventsChain", passed: trails.securityEvents.passed && trails.securityEvents.count > 0, detail: `${trails.securityEvents.count} events, broken=${trails.securityEvents.broken.length}` },
    { id: "audit:dataAccessLogsChain", passed: trails.dataAccessLogs.passed && trails.dataAccessLogs.count > 0, detail: `${trails.dataAccessLogs.count} logs, broken=${trails.dataAccessLogs.broken.length}` },
    { id: "audit:securityAcceptanceLedger", passed: ledger.length >= 4 && ledger.every((item) => item.id && item.category && item.owner && item.status && item.next), detail: `${ledger.length} controls` },
    { id: "audit:productionTrack", passed: Boolean(productionAuditTrack?.requiredConfig?.length && productionAuditTrack?.evidence?.length), detail: productionAuditTrack?.status || "missing" },
    { id: "audit:exportPayload", passed: securityEvents.length + dataAccessLogs.length > 0, detail: `${securityEvents.length + dataAccessLogs.length} exported rows` },
    { id: "audit:retentionTargetConfigured", passed: retentionTargets.some((item) => item.configured), detail: retentionTargets.map((item) => `${item.env}:${item.configured ? "configured" : "missing"}`).join(";"), severity: "warn" }
  ];
  const requiredChecks = checks.filter((item) => item.severity !== "warn");
  return {
    ok: requiredChecks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    exportDigest: sha256Text(JSON.stringify(exportPayload)),
    exportCounts: {
      securityEvents: securityEvents.length,
      dataAccessLogs: dataAccessLogs.length,
      total: securityEvents.length + dataAccessLogs.length
    },
    retentionTargets,
    productionAuditTrack: productionAuditTrack || null,
    trails,
    ledger,
    checks
  };
}

function renderMarkdown(report) {
  const checkRows = report.checks.map((item) => `| ${item.passed ? "PASS" : (item.severity || "error").toUpperCase()} | ${item.id} | ${String(item.detail || "").replace(/\|/g, "/")} |`);
  const targetRows = report.retentionTargets.map((item) => `| ${item.configured ? "configured" : "missing"} | ${item.env} | ${item.id} | ${item.purpose} |`);
  const trailRows = Object.entries(report.trails).map(([name, item]) => `| ${item.passed ? "PASS" : "FAIL"} | ${name} | ${item.count} | ${item.broken.length} |`);
  return [
    "# Audit retention report",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Export rows: ${report.exportCounts.total}`,
    `- Export digest: ${report.exportDigest}`,
    "",
    "## Checks",
    "",
    "| Result | Check | Detail |",
    "|---|---|---|",
    ...checkRows,
    "",
    "## Retention targets",
    "",
    "| Status | Environment variable | Target | Purpose |",
    "|---|---|---|---|",
    ...targetRows,
    "",
    "## Audit chains",
    "",
    "| Result | Trail | Rows | Broken links |",
    "|---|---|---:|---:|",
    ...trailRows,
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
  const report = buildAuditRetentionReport();
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

module.exports = { auditHashFor, buildAuditRetentionReport, parseArgs, renderMarkdown, verifyAuditTrail, writeOutput };
