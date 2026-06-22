#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "monitoring-readiness-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "monitoring-readiness-report.md");

const REQUIRED_ROUTES = [
  "/api/health",
  "/api/metrics",
  "/api/system/readiness"
];

const REQUIRED_METRIC_SIGNALS = [
  "requests",
  "responses",
  "slowRequests",
  "workload",
  "deadLetters",
  "dataQualityIssues"
];

const REQUIRED_ALERT_SIGNALS = [
  "slowRequests",
  "deadLetters",
  "dataQualityIssues",
  "externalDependencySummary",
  "CUTOVER_MONITORING_SIGNOFF"
];

const SLO_TARGETS = [
  { id: "availability", target: ">=99.5%", evidence: ["responses", "/api/health"] },
  { id: "latency", target: "p95 <= 2000ms", evidence: ["slowRequests", "/api/metrics"] },
  { id: "integration-backlog", target: "dead letters triaged same day", evidence: ["deadLetters", "integrationGatewayEvents"] },
  { id: "data-quality", target: "critical issues routed before release", evidence: ["dataQualityIssues", "data-quality:report"] }
];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function buildEvidenceMap(serverSource, readme, deployment, pkg) {
  return {
    routes: REQUIRED_ROUTES.map((route) => ({
      route,
      present: serverSource.includes(route),
      documented: readme.includes(route) || deployment.includes(route)
    })),
    metricSignals: REQUIRED_METRIC_SIGNALS.map((signal) => ({
      signal,
      present: serverSource.includes(signal)
    })),
    alertSignals: REQUIRED_ALERT_SIGNALS.map((signal) => ({
      signal,
      present: serverSource.includes(signal) || readme.includes(signal) || deployment.includes(signal)
    })),
    releaseScripts: [
      "operations:readiness",
      "monitoring:readiness",
      "release:report",
      "deploy:check",
      "data-quality:report",
      "integration:readiness"
    ].map((script) => ({
      script,
      present: Boolean(pkg.scripts?.[script])
    })),
    sloTargets: SLO_TARGETS.map((target) => ({
      ...target,
      covered: target.evidence.every((marker) => serverSource.includes(marker) || readme.includes(marker) || deployment.includes(marker) || Boolean(pkg.scripts?.[marker]))
    }))
  };
}

function buildMonitoringReadinessReport(options = {}) {
  const pkg = options.pkg ?? readJson("package.json");
  const serverSource = options.serverSource ?? readText("server.js");
  const readme = options.readme ?? readText("README.md");
  const deployment = options.deployment ?? readText("DEPLOYMENT.md");
  const evidence = buildEvidenceMap(serverSource, readme, deployment, pkg);
  const docsMentionOnCall = /on-call|值守|告警|监控|escalation/i.test(readme) && /on-call|值守|告警|监控|escalation/i.test(deployment);
  const checks = [
    { id: "monitoring:routes", passed: evidence.routes.every((item) => item.present && item.documented), detail: evidence.routes.map((item) => `${item.route}:${item.present ? "code" : "missing"}/${item.documented ? "docs" : "undoc"}`).join(";") },
    { id: "monitoring:metricSignals", passed: evidence.metricSignals.every((item) => item.present), detail: evidence.metricSignals.map((item) => `${item.signal}:${item.present ? "yes" : "no"}`).join(";") },
    { id: "monitoring:alertSignals", passed: evidence.alertSignals.every((item) => item.present), detail: evidence.alertSignals.map((item) => `${item.signal}:${item.present ? "yes" : "no"}`).join(";") },
    { id: "monitoring:sloTargets", passed: evidence.sloTargets.every((item) => item.covered), detail: evidence.sloTargets.map((item) => `${item.id}:${item.target}`).join(";") },
    { id: "monitoring:onCallDocs", passed: docsMentionOnCall, detail: docsMentionOnCall ? "monitoring, alerting, and on-call escalation documented" : "missing monitoring/on-call documentation" },
    { id: "monitoring:releaseScripts", passed: evidence.releaseScripts.every((item) => item.present), detail: evidence.releaseScripts.filter((item) => !item.present).map((item) => item.script).join(",") || "all monitoring release scripts present" }
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    routes: evidence.routes,
    metricSignals: evidence.metricSignals,
    alertSignals: evidence.alertSignals,
    sloTargets: evidence.sloTargets,
    releaseScripts: evidence.releaseScripts,
    checks
  };
}

function renderMarkdown(report) {
  const checkRows = report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${String(item.detail || "").replace(/\|/g, "/")} |`);
  const routeRows = report.routes.map((item) => `| ${item.present && item.documented ? "PASS" : "FAIL"} | ${item.route} | ${item.present ? "yes" : "no"} | ${item.documented ? "yes" : "no"} |`);
  const metricRows = report.metricSignals.map((item) => `| ${item.present ? "PASS" : "FAIL"} | ${item.signal} |`);
  const alertRows = report.alertSignals.map((item) => `| ${item.present ? "PASS" : "FAIL"} | ${item.signal} |`);
  const sloRows = report.sloTargets.map((item) => `| ${item.covered ? "PASS" : "FAIL"} | ${item.id} | ${item.target} | ${item.evidence.join(", ")} |`);
  return [
    "# Monitoring readiness report",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    "",
    "## Checks",
    "",
    "| Result | Check | Detail |",
    "|---|---|---|",
    ...checkRows,
    "",
    "## Routes",
    "",
    "| Result | Route | Code | Docs |",
    "|---|---|---|---|",
    ...routeRows,
    "",
    "## Metric signals",
    "",
    "| Result | Signal |",
    "|---|---|",
    ...metricRows,
    "",
    "## Alert signals",
    "",
    "| Result | Signal |",
    "|---|---|",
    ...alertRows,
    "",
    "## SLO targets",
    "",
    "| Result | SLO | Target | Evidence |",
    "|---|---|---|---|",
    ...sloRows,
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
  const report = buildMonitoringReadinessReport();
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

module.exports = { buildMonitoringReadinessReport, parseArgs, renderMarkdown, writeOutput };
