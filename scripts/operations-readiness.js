#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "operations-readiness-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "operations-readiness-report.md");

const REQUIRED_EXTERNAL_RISKS = [
  "identity-source",
  "institution-systems",
  "insurance-core",
  "certificate-sharing",
  "security-assessment",
  "disaster-recovery"
];

const REQUIRED_OPERATION_ROUTES = [
  "/api/health",
  "/api/metrics",
  "/api/system/readiness"
];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function arrayOf(data, key) {
  return Array.isArray(data[key]) ? data[key] : [];
}

function buildOperationsReadinessReport(options = {}) {
  const data = options.data ?? readJson("data/db.json");
  const pkg = options.pkg ?? readJson("package.json");
  const serverSource = options.serverSource ?? readText("server.js");
  const readme = options.readme ?? readText("README.md");
  const deployment = options.deployment ?? readText("DEPLOYMENT.md");
  const productionDeploymentPlan = arrayOf(data, "productionDeploymentPlan");
  const securityAcceptanceLedger = arrayOf(data, "securityAcceptanceLedger");
  const interfaceRows = arrayOf(data, "platformInterfaces");
  const operationRoutes = REQUIRED_OPERATION_ROUTES.map((route) => ({
    route,
    present: serverSource.includes(route),
    documented: readme.includes(route) || deployment.includes(route)
  }));
  const externalDependencies = REQUIRED_EXTERNAL_RISKS.map((id) => ({
    id,
    present: serverSource.includes(id),
    documented: readme.includes(id) || deployment.includes(id) || serverSource.includes(id)
  }));
  const productionTracks = productionDeploymentPlan.map((item) => ({
    id: item.id,
    track: item.track,
    owner: item.owner,
    status: item.status,
    ready: Boolean(item.id && item.track && item.owner && item.status && item.nextAction && Array.isArray(item.requiredConfig) && item.requiredConfig.length)
  }));
  const requiredScripts = [
    "env:check:production",
    "release:report",
    "deploy:check",
    "storage:assess",
    "rollback:snapshot",
    "audit:retention",
    "data-quality:report",
    "integration:readiness",
    "evaluation:evidence"
  ];
  const checks = [
    { id: "operations:routes", passed: operationRoutes.every((item) => item.present && item.documented), detail: operationRoutes.map((item) => `${item.route}:${item.present ? "code" : "missing"}/${item.documented ? "docs" : "undoc"}`).join(";") },
    { id: "operations:runtimeMetrics", passed: /buildRuntimeMetrics/.test(serverSource) && /workload/.test(serverSource) && /dataQualityIssues/.test(serverSource), detail: "runtime metrics include workload and data quality counters" },
    { id: "operations:systemReadiness", passed: /buildSystemReadinessReport/.test(serverSource) && /externalDependencySummary/.test(serverSource), detail: "system readiness includes external dependency summary" },
    { id: "operations:productionTracks", passed: productionTracks.length >= 4 && productionTracks.every((item) => item.ready), detail: `${productionTracks.length} production deployment tracks` },
    { id: "operations:externalDependencies", passed: externalDependencies.every((item) => item.present), detail: externalDependencies.map((item) => `${item.id}:${item.present ? "yes" : "no"}`).join(";") },
    { id: "operations:securityAcceptance", passed: securityAcceptanceLedger.length >= 4 && securityAcceptanceLedger.every((item) => item.id && item.category && item.owner && item.status && item.next), detail: `${securityAcceptanceLedger.length} security acceptance rows` },
    { id: "operations:p0InterfaceOwners", passed: interfaceRows.filter((item) => item.priority === "P0").every((item) => item.owner && item.status && item.next), detail: `${interfaceRows.filter((item) => item.priority === "P0").length} P0 interface rows` },
    { id: "operations:releaseScripts", passed: requiredScripts.every((name) => pkg.scripts?.[name]), detail: requiredScripts.filter((name) => !pkg.scripts?.[name]).join(",") || "all required operation scripts present" },
    { id: "operations:deploymentDocs", passed: /productionDeploymentPlan/.test(deployment) && /release:report/.test(deployment) && /data-quality:report/.test(deployment), detail: "deployment document includes release, data quality, and production plan evidence" }
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    operationRoutes,
    externalDependencies,
    productionTracks,
    securityAcceptanceLedger,
    requiredScripts,
    checks
  };
}

function renderMarkdown(report) {
  const checkRows = report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${String(item.detail || "").replace(/\|/g, "/")} |`);
  const routeRows = report.operationRoutes.map((item) => `| ${item.present && item.documented ? "PASS" : "FAIL"} | ${item.route} | ${item.present ? "yes" : "no"} | ${item.documented ? "yes" : "no"} |`);
  const dependencyRows = report.externalDependencies.map((item) => `| ${item.present ? "TRACKED" : "MISSING"} | ${item.id} | ${item.documented ? "yes" : "no"} |`);
  const trackRows = report.productionTracks.map((item) => `| ${item.ready ? "PASS" : "FAIL"} | ${item.id} | ${item.track || ""} | ${item.owner || ""} | ${item.status || ""} |`);
  return [
    "# Operations readiness report",
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
    "## Operation routes",
    "",
    "| Result | Route | Code | Docs |",
    "|---|---|---|---|",
    ...routeRows,
    "",
    "## External dependency risks",
    "",
    "| Status | Risk | Documented |",
    "|---|---|---|",
    ...dependencyRows,
    "",
    "## Production deployment tracks",
    "",
    "| Result | ID | Track | Owner | Status |",
    "|---|---|---|---|---|",
    ...trackRows,
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
  const report = buildOperationsReadinessReport();
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

module.exports = { buildOperationsReadinessReport, parseArgs, renderMarkdown, writeOutput };
