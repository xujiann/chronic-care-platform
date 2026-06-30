#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "hospital-operations-readiness-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "hospital-operations-readiness-report.md");

const REQUIRED_COLLECTIONS = [
  "hospitalOperationSnapshots",
  "resourceDispatchRequests",
  "statisticsReconciliationReviews",
  "operationAlertRules",
  "healthStatistics",
  "healthStatisticsIngestion",
  "medicalResources",
  "platformProcessAudit"
];

const REQUIRED_ROUTES = [
  "/api/operations/dashboard",
  "/api/operations/performance-monitoring",
  "/api/operations/command-chains",
  "/api/operations/playbooks",
  "/api/operations/handover",
  "/api/operations/handover/owners",
  "/api/operations/handover/signoff",
  "/api/operations/interface-mapping",
  "/api/operations/site-joint-tests",
  "/api/operations/production-hardening",
  "/api/operations/intelligence",
  "/api/operations/resource-pool",
  "/api/operations/governance-report",
  "/api/operations/governance-export-package",
  "/api/operations/next-development-research",
  "/api/operations/integration/snapshots",
  "/api/operations/integration/dispatch-feedback",
  "/api/operations/integration/reconciliation",
  "/api/operations/dispatch",
  "/api/operations/dispatch/:id/status",
  "/api/operations/reconciliation/:id/review"
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

function ratio(numerator, denominator) {
  const bottom = Number(denominator || 0);
  return bottom > 0 ? Number(numerator || 0) / bottom : 0;
}

function routePresent(route, serverSource) {
  if (route === "/api/operations/reconciliation/:id/review") return serverSource.includes("/api/operations/reconciliation/");
  if (route === "/api/operations/dispatch/:id/status") return serverSource.includes("/api/operations/dispatch/:id/status") || (serverSource.includes("/api/operations/dispatch/") && serverSource.includes("/status"));
  return serverSource.includes(route);
}

function buildHospitalOperationsReadinessReport(options = {}) {
  const data = options.data ?? readJson("data/db.json");
  const pkg = options.pkg ?? readJson("package.json");
  const serverSource = options.serverSource ?? readText("server.js");
  const operationsHtml = options.operationsHtml ?? readText("operations.html");
  const operationsJs = options.operationsJs ?? readText("operations.js");
  const snapshots = arrayOf(data, "hospitalOperationSnapshots");
  const dispatchRequests = arrayOf(data, "resourceDispatchRequests");
  const reconciliationReviews = arrayOf(data, "statisticsReconciliationReviews");
  const alertRules = arrayOf(data, "operationAlertRules");
  const highPressure = snapshots.filter((item) => ["warning", "critical"].includes(item.normalizedStatus) || ratio(item.beds?.occupied, item.beds?.open) >= 0.9);
  const checks = [
    { id: "hospitalOps:collections", passed: REQUIRED_COLLECTIONS.every((key) => data[key]), detail: REQUIRED_COLLECTIONS.filter((key) => !data[key]).join(",") || "all required collections present" },
    { id: "hospitalOps:snapshots", passed: snapshots.length >= 3 && snapshots.every((item) => item.institutionId && item.beds && item.staff && item.equipment && item.outpatient && item.inpatient && item.reporting), detail: `${snapshots.length} operation snapshots` },
    { id: "hospitalOps:statusNormalization", passed: snapshots.every((item) => ["normal", "warning", "critical"].includes(item.normalizedStatus)) && highPressure.length >= 1, detail: `${highPressure.length} high pressure snapshots` },
    { id: "hospitalOps:dispatch", passed: dispatchRequests.length >= 2 && dispatchRequests.every((item) => item.id && item.resourceType && item.quantity && item.status && Array.isArray(item.auditTrail)), detail: `${dispatchRequests.length} dispatch requests` },
    { id: "hospitalOps:reconciliation", passed: reconciliationReviews.length >= 2 && reconciliationReviews.every((item) => item.id && item.sourceBatch && item.status && Array.isArray(item.evidence)), detail: `${reconciliationReviews.length} reconciliation reviews` },
    { id: "hospitalOps:alertRules", passed: alertRules.length >= 5 && alertRules.every((item) => item.id && item.domain && item.threshold && item.dispatchBoundary), detail: `${alertRules.length} alert rules` },
    { id: "hospitalOps:apiRoutes", passed: REQUIRED_ROUTES.every((route) => routePresent(route, serverSource)), detail: REQUIRED_ROUTES.join(", ") },
    { id: "hospitalOps:permissions", passed: /requireApiRole\(req, res, \["commission"\], "\/api\/operations\/dashboard"\)/.test(serverSource) && /operations-dispatch/.test(serverSource) && /statistics-reconciliation-review/.test(serverSource), detail: "commission-only API and audit events" },
    { id: "hospitalOps:frontend", passed: /operations-snapshots/.test(operationsHtml) && /dispatch-form/.test(operationsHtml) && /fetchOperationsDashboard/.test(operationsJs), detail: "operations page renders live monitor, dispatch, and reconciliation controls" },
    { id: "hospitalOps:interfaceMapping", passed: /buildOperationsInterfaceMappingEvidence/.test(serverSource) && /operations-interface-mapping/.test(operationsHtml) && /renderInterfaceMapping/.test(operationsJs), detail: "site joint-test field mapping API and panel" },
    { id: "hospitalOps:integrationIngest", passed: /normalizeOperationSnapshot/.test(serverSource) && /\/api\/operations\/integration\/snapshots/.test(serverSource) && /\/api\/operations\/integration\/dispatch-feedback/.test(serverSource) && /\/api\/operations\/integration\/reconciliation/.test(serverSource) && /verifyIntegrationSignature/.test(serverSource), detail: "signed hospital system ingest APIs for snapshots, dispatch feedback, and reconciliation batches" },
    { id: "hospitalOps:sla", passed: /buildCommandSla/.test(serverSource) && /command-chain-sla/.test(operationsJs), detail: "command-chain SLA status and escalation evidence" },
    { id: "hospitalOps:playbooks", passed: /buildOperationsPlaybooks/.test(serverSource) && /operation-playbooks/.test(operationsHtml) && /renderOperationsPlaybooks/.test(operationsJs), detail: "alert playbook API evidence and panel" },
    { id: "hospitalOps:handover", passed: /buildOperationsHandover/.test(serverSource) && /\/api\/operations\/handover/.test(serverSource) && /operation-handover/.test(operationsHtml) && /renderOperationsHandover/.test(operationsJs), detail: "shift handover list API and panel" },
    { id: "hospitalOps:handoverOwners", passed: /buildOperationsHandoverOwnerMatrix/.test(serverSource) && /\/api\/operations\/handover\/owners/.test(serverSource) && /operation-handover-owner-matrix/.test(operationsHtml) && /renderHandoverOwnerMatrix/.test(operationsJs), detail: "shift handover owner matrix API and panel" },
    { id: "hospitalOps:handoverSignoff", passed: /\/api\/operations\/handover\/signoff/.test(serverSource) && /normalizeHandoverSignoff/.test(serverSource) && /operation-handover-signoffs/.test(operationsHtml) && /signoffOperationsHandover/.test(operationsJs), detail: "shift handover signoff API, audit trace, and panel" },
    { id: "hospitalOps:performanceDetail", passed: /indicatorDetails/.test(serverSource) && /performance-indicator-detail/.test(operationsHtml) && /renderPerformanceIndicatorDetail/.test(operationsJs), detail: "performance manual indicator details and exception template" },
    { id: "hospitalOps:siteJointTests", passed: /buildOperationsSiteJointTests/.test(serverSource) && /\/api\/operations\/site-joint-tests/.test(serverSource) && /operations-site-joint-tests/.test(operationsHtml) && /renderSiteJointTests/.test(operationsJs), detail: "site joint-test closeout API and panel" },
    { id: "hospitalOps:productionHardening", passed: /buildOperationsProductionHardening/.test(serverSource) && /\/api\/operations\/production-hardening/.test(serverSource) && /operation-production-hardening/.test(operationsHtml) && /renderProductionHardening/.test(operationsJs), detail: "production hardening checklist API and panel" },
    { id: "hospitalOps:intelligence", passed: /buildOperationsIntelligence/.test(serverSource) && /\/api\/operations\/intelligence/.test(serverSource) && /operation-intelligence/.test(operationsHtml) && /renderOperationsIntelligence/.test(operationsJs), detail: "intelligent dispatch recommendations API and panel" },
    { id: "hospitalOps:resourcePool", passed: /buildOperationsResourcePool/.test(serverSource) && /\/api\/operations\/resource-pool/.test(serverSource) && /operation-resource-pool/.test(operationsHtml) && /renderResourcePool/.test(operationsJs), detail: "cross-hospital resource pool API and panel" },
    { id: "hospitalOps:governanceReport", passed: /buildOperationsGovernanceReport/.test(serverSource) && /\/api\/operations\/governance-report/.test(serverSource) && /operation-governance-report/.test(operationsHtml) && /renderGovernanceReport/.test(operationsJs), detail: "monthly governance report API and panel" },
    { id: "hospitalOps:governanceExportPackage", passed: /buildOperationsGovernanceExportPackage/.test(serverSource) && /\/api\/operations\/governance-export-package/.test(serverSource) && /downloadGovernanceExportPackage/.test(operationsJs) && /performance-action-card export/.test(operationsJs), detail: "governance export package API and download action" },
    { id: "hospitalOps:nextDevelopmentResearch", passed: /buildOperationsNextDevelopmentResearch/.test(serverSource) && /\/api\/operations\/next-development-research/.test(serverSource) && /operation-next-development/.test(operationsHtml) && /renderNextDevelopmentResearch/.test(operationsJs), detail: "next development research API and panel" },
    { id: "hospitalOps:releaseScript", passed: Boolean(pkg.scripts?.["hospital-operations:readiness"]), detail: "package script registered" }
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    boundaries: [
      "hospital operation monitoring",
      "beds, staff, equipment, outpatient and inpatient operations",
      "resource dispatch",
      "statistics direct-report reconciliation",
      "alert rule review"
    ],
    reusedCollections: REQUIRED_COLLECTIONS,
    summary: {
      snapshots: snapshots.length,
      dispatchRequests: dispatchRequests.length,
      reconciliationReviews: reconciliationReviews.length,
      alertRules: alertRules.length,
      highPressure: highPressure.length
    },
    checks
  };
}

function renderMarkdown(report) {
  return [
    "# Hospital operations readiness report",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Snapshots: ${report.summary.snapshots}`,
    `- Dispatch requests: ${report.summary.dispatchRequests}`,
    `- Reconciliation reviews: ${report.summary.reconciliationReviews}`,
    "",
    "## Checks",
    "",
    "| Result | Check | Detail |",
    "|---|---|---|",
    ...report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${String(item.detail || "").replace(/\|/g, "/")} |`),
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
  const report = buildHospitalOperationsReadinessReport();
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

module.exports = { buildHospitalOperationsReadinessReport, parseArgs, renderMarkdown, writeOutput };
