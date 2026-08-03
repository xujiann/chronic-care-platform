#!/usr/bin/env node
const { readRuntimeSource } = require("../src/http/runtime-source");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "monitoring-readiness-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "monitoring-readiness-report.md");

const REQUIRED_ROUTES = [
  "/api/live",
  "/api/health",
  "/api/metrics",
  "/api/system/readiness",
  "/api/observability/alerts"
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
  "observabilityAlertDeliveries",
  "alert-delivery-recovered",
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

function hasAll(source, markers) {
  return markers.every((marker) => source.includes(marker));
}

function buildEvidenceMap(sources) {
  const { serverSource, readme, deployment, pkg, adapterSource, operationsHtml, operationsJs, alertingDocument, envExample, releaseSource, deploySource } = sources;
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
    })),
    alertAdapter: {
      hmacSigned: hasAll(adapterSource, ["HMAC-SHA256", "signAlertRequest", "X-Signature"]),
      httpsEnforced: hasAll(adapterSource, ["must use HTTPS in production", "productionHttps"]),
      idempotent: hasAll(adapterSource, ["X-Idempotency-Key", "idempotencyKey"]),
      boundedRetry: hasAll(adapterSource, ["ALERTING_MAX_ATTEMPTS", "maxAttempts"]),
      piiRejected: hasAll(adapterSource, ["FORBIDDEN_ALERT_KEYS", "sensitive field is not allowed in alert payload"]),
      publicStatusSafe: hasAll(adapterSource, ["publicRouteStatus", "productionReady: false"])
    },
    alertRuntime: {
      centerRoute: serverSource.includes('url.pathname === "/api/observability/alerts"'),
      dispatchRoute: serverSource.includes('url.pathname === "/api/observability/alerts/dispatch"'),
      retryRoute: serverSource.includes("/api/observability/alert-deliveries/"),
      persistedReceipts: hasAll(serverSource, ["observabilityAlertDeliveries", "adapterReceipt"]),
      incidentClosure: hasAll(serverSource, ["ops-alert-delivery-", "alert-delivery-failed", "alert-delivery-recovered"]),
      commissionOnly: hasAll(serverSource, ['["commission"]', "/api/observability/alerts"])
    },
    alertUi: {
      statusPanel: hasAll(operationsHtml, ["observability-alert-status", "observability-alert-deliveries"]),
      signalActions: hasAll(operationsJs, ["renderObservabilityAlertCenter", "data-observability-alert-action"]),
      retryAction: hasAll(operationsJs, ["retryObservabilityAlert", "/observability/alert-deliveries/"])
    },
    alertEnvironment: {
      siemEndpoint: envExample.includes("SIEM_ENDPOINT="),
      siemSecret: envExample.includes("SIEM_SIGNING_SECRET="),
      webhookEndpoint: envExample.includes("ALERT_WEBHOOK_URL="),
      retryLimit: envExample.includes("ALERTING_MAX_ATTEMPTS=")
    },
    productionBoundary: {
      adapterNotAcceptance: alertingDocument.includes("告警适配器基础通过不等于生产监控已经正式验收"),
      minimized: alertingDocument.includes("去标识化"),
      failureIncident: alertingDocument.includes("失败进入运维事件"),
      signoffRequired: alertingDocument.includes("CUTOVER_MONITORING_SIGNOFF"),
      productionReady: false
    },
    releaseWiring: {
      releaseReport: hasAll(releaseSource, ["monitoring:alertRouting", "env:ALERTING.routes"]),
      deployCheck: hasAll(deploySource, ["observability-alerting.js", "monitoring:alertRouting"])
    }
  };
}

function buildMonitoringReadinessReport(options = {}) {
  const pkg = options.pkg ?? readJson("package.json");
  const serverSource = options.serverSource ?? readRuntimeSource(ROOT);
  const readme = options.readme ?? readText("README.md");
  const deployment = options.deployment ?? readText("DEPLOYMENT.md");
  const sources = {
    serverSource,
    readme,
    deployment,
    pkg,
    adapterSource: options.adapterSource ?? readText("observability-alerting.js"),
    operationsHtml: options.operationsHtml ?? readText("operations.html"),
    operationsJs: options.operationsJs ?? readText("operations.js"),
    alertingDocument: options.alertingDocument ?? readText("docs/production-observability-alerting.md"),
    envExample: options.envExample ?? readText(".env.example"),
    releaseSource: options.releaseSource ?? readText("scripts/release-report.js"),
    deploySource: options.deploySource ?? readText("scripts/deploy-check.js")
  };
  const evidence = buildEvidenceMap(sources);
  const docsMentionOnCall = /on-call|值守|告警|监控|escalation/i.test(readme) && /on-call|值守|告警|监控|escalation/i.test(deployment);
  const checks = [
    { id: "monitoring:routes", passed: evidence.routes.every((item) => item.present && item.documented), detail: evidence.routes.map((item) => `${item.route}:${item.present ? "code" : "missing"}/${item.documented ? "docs" : "undoc"}`).join(";") },
    { id: "monitoring:metricSignals", passed: evidence.metricSignals.every((item) => item.present), detail: evidence.metricSignals.map((item) => `${item.signal}:${item.present ? "yes" : "no"}`).join(";") },
    { id: "monitoring:alertSignals", passed: evidence.alertSignals.every((item) => item.present), detail: evidence.alertSignals.map((item) => `${item.signal}:${item.present ? "yes" : "no"}`).join(";") },
    { id: "monitoring:sloTargets", passed: evidence.sloTargets.every((item) => item.covered), detail: evidence.sloTargets.map((item) => `${item.id}:${item.target}`).join(";") },
    { id: "monitoring:onCallDocs", passed: docsMentionOnCall, detail: docsMentionOnCall ? "monitoring, alerting, and on-call escalation documented" : "missing monitoring/on-call documentation" },
    { id: "monitoring:releaseScripts", passed: evidence.releaseScripts.every((item) => item.present), detail: evidence.releaseScripts.filter((item) => !item.present).map((item) => item.script).join(",") || "all monitoring release scripts present" },
    { id: "monitoring:alertAdapter", passed: Object.values(evidence.alertAdapter).every(Boolean), detail: Object.entries(evidence.alertAdapter).map(([key, value]) => `${key}:${value ? "yes" : "no"}`).join(";") },
    { id: "monitoring:alertRuntime", passed: Object.values(evidence.alertRuntime).every(Boolean), detail: Object.entries(evidence.alertRuntime).map(([key, value]) => `${key}:${value ? "yes" : "no"}`).join(";") },
    { id: "monitoring:alertUi", passed: Object.values(evidence.alertUi).every(Boolean), detail: Object.entries(evidence.alertUi).map(([key, value]) => `${key}:${value ? "yes" : "no"}`).join(";") },
    { id: "monitoring:alertEnvironment", passed: Object.values(evidence.alertEnvironment).every(Boolean), detail: Object.entries(evidence.alertEnvironment).map(([key, value]) => `${key}:${value ? "yes" : "no"}`).join(";") },
    { id: "monitoring:productionBoundary", passed: Object.entries(evidence.productionBoundary).filter(([key]) => key !== "productionReady").every(([, value]) => value) && evidence.productionBoundary.productionReady === false, detail: "adapter foundation ready; production receiver, on-call drill and signoff remain required" },
    { id: "monitoring:releaseWiring", passed: Object.values(evidence.releaseWiring).every(Boolean), detail: Object.entries(evidence.releaseWiring).map(([key, value]) => `${key}:${value ? "yes" : "no"}`).join(";") }
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    status: "adapter-foundation-ready-site-acceptance-pending",
    productionReady: false,
    routes: evidence.routes,
    metricSignals: evidence.metricSignals,
    alertSignals: evidence.alertSignals,
    sloTargets: evidence.sloTargets,
    releaseScripts: evidence.releaseScripts,
    alertRouting: {
      adapter: evidence.alertAdapter,
      runtime: evidence.alertRuntime,
      ui: evidence.alertUi,
      environment: evidence.alertEnvironment,
      releaseWiring: evidence.releaseWiring
    },
    productionBoundary: evidence.productionBoundary,
    summary: {
      routes: evidence.routes.length,
      controls: Object.values(evidence.alertAdapter).filter(Boolean).length,
      blockers: 6
    },
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
    "",
    "## Production alert routing",
    "",
    `- Status: ${report.status}`,
    `- Production ready: ${report.productionReady ? "yes" : "no"}`,
    `- Adapter controls: ${report.summary.controls}/6`,
    `- Site acceptance blockers: ${report.summary.blockers}`,
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
