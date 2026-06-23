#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "health-dashboard-summary.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "health-dashboard-summary.md");

const APPLICATIONS = require("../health-dashboard-applications");

const CLOSED_STATUS_PATTERN = /closed|resolved|approved|recognized|completed|passed|ready|signed|done|宸插畬鎴|宸查€氳繃|宸插彇鑽|宸插洖浼|宸蹭簰璁|宸叉牳楠|宸查棴鐜|已完成|已通过|已闭环/;
const HIGH_RISK_PATTERN = /high|urgent|critical|overdue|dead_letter|楂|绱|閫炬湡|critical|高|逾期|危急/;

const APPLICATION_BY_COLLECTION = Object.fromEntries(
  APPLICATIONS.flatMap((app) => app.collections.map((collection) => [collection, app]))
);

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function rows(data, collection) {
  if (collection === "authorizations") {
    return Array.isArray(data.personalRecords)
      ? data.personalRecords.filter((item) => item.category === "authorizations" || item.type === "authorization")
      : [];
  }
  const value = data[collection];
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    return Object.values(value).flatMap((item) => Array.isArray(item) ? item : []);
  }
  return [];
}

function statusOf(item) {
  return String(item.status || item.reviewStatus || item.authorizationStatus || item.state || "").trim();
}

function isOpen(item) {
  const status = statusOf(item);
  return !status || !CLOSED_STATUS_PATTERN.test(status);
}

function riskLevel(item) {
  const text = [item.priority, item.level, item.risk, item.riskLevel, item.status, item.deadLetter ? "dead_letter" : ""].filter(Boolean).join(" ");
  if (HIGH_RISK_PATTERN.test(text)) return "high";
  if (/medium|warning|涓|寰|待|warn/i.test(text)) return "medium";
  return "normal";
}

function summarizeApplication(data, app) {
  const collectionRows = app.collections.map((collection) => ({ collection, rows: rows(data, collection) }));
  const allRows = collectionRows.flatMap((item) => item.rows.map((row) => ({ ...row, collection: item.collection })));
  const openRows = allRows.filter(isOpen);
  const highRiskRows = allRows.filter((item) => riskLevel(item) === "high");
  const evidenceRows = rows(data, "platformEvidence").flatMap((item) => item.records || []);
  const relatedEvidence = evidenceRows.filter((item) => {
    const text = JSON.stringify(item);
    return app.collections.some((collection) => text.includes(collection)) || text.includes(app.entry) || text.includes(app.id);
  });
  return {
    id: app.id,
    name: app.name,
    entry: app.entry,
    owner: app.owner,
    collections: collectionRows.map((item) => ({ collection: item.collection, records: item.rows.length })),
    records: allRows.length,
    openActions: openRows.length,
    highRisks: highRiskRows.length,
    evidenceRecords: relatedEvidence.length,
    status: allRows.length ? "modeled" : "empty-ready",
    boundary: "Aggregated in the dashboard; detailed workflow remains in the source application."
  };
}

function collectOpenActions(data, limit = 12) {
  const taskCollections = [
    "followups",
    "careOrders",
    "medicationPickups",
    "insuranceClaims",
    "emergencySignals",
    "chronicScreeningTasks",
    "chronicEducationPushes",
    "chronicManagementPlans",
    "countyCollaborationOrders",
    "countyMutualRecognitionRecords",
    "countyAiDiagnosisCases",
    "multiPracticeApplications",
    "dataQualityIssues",
    "integrationGatewayEvents"
  ];
  return taskCollections.flatMap((collection) => rows(data, collection).filter(isOpen).map((item) => {
    const app = APPLICATION_BY_COLLECTION[collection] || APPLICATIONS[0];
    return {
      id: item.id || `${collection}-${item.residentId || item.status || "open"}`,
      collection,
      applicationId: app.id,
      application: app.name,
      entry: app.entry,
      title: item.title || item.taskName || item.topic || item.orderType || item.item || item.claimType || item.medication || item.name || collection,
      owner: item.owner || item.assignee || item.institution || item.center || item.sourceInstitution || item.targetInstitution || "owner-pending",
      status: statusOf(item) || "open",
      priority: riskLevel(item),
      dueAt: item.dueAt || item.due || item.nextReview || item.plannedAt || item.requestedAt || item.lastUpdated || ""
    };
  })).sort((left, right) =>
    ({ high: 3, medium: 2, normal: 1 }[right.priority] || 0) - ({ high: 3, medium: 2, normal: 1 }[left.priority] || 0) ||
    String(left.dueAt || "").localeCompare(String(right.dueAt || ""))
  ).slice(0, limit);
}

function buildHealthDashboardSummary(options = {}) {
  const data = options.data || readJson("data/db.json");
  const runtime = options.runtime || null;
  const readiness = options.readiness || null;
  const releaseReport = options.releaseReport || null;
  const applications = APPLICATIONS.map((app) => summarizeApplication(data, app));
  const openActions = collectOpenActions(data);
  const sourceOpenActions = applications.reduce((sum, item) => sum + item.openActions, 0);
  const previewOpenActions = openActions.length;
  const interfaceRows = rows(data, "platformInterfaces");
  const evidenceRecords = rows(data, "platformEvidence").flatMap((item) => item.records || []);
  const siteDependencies = rows(data, "productionDeploymentPlan").filter((item) => isOpen(item) || /missing|待|寰|blocked/i.test(JSON.stringify(item)));
  const checks = [
    { id: "dashboard:applications", passed: applications.length === 7 && applications.every((item) => item.entry && item.collections.length), detail: `${applications.length} applications` },
    { id: "dashboard:source-boundary", passed: applications.every((item) => /source application/.test(item.boundary)), detail: "dashboard is aggregate-only" },
    { id: "dashboard:metrics", passed: applications.reduce((sum, item) => sum + item.records, 0) > 0, detail: `${applications.reduce((sum, item) => sum + item.records, 0)} source records` },
    { id: "dashboard:actions", passed: previewOpenActions > 0 && sourceOpenActions >= previewOpenActions, detail: `${previewOpenActions} preview / ${sourceOpenActions} source open actions` },
    { id: "dashboard:interfaces", passed: interfaceRows.length >= 4, detail: `${interfaceRows.length} interface rows` },
    { id: "dashboard:evidence", passed: evidenceRecords.length >= 2, detail: `${evidenceRecords.length} evidence records` }
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    scope: {
      role: "summary-entry-for-seven-applications",
      rule: "Do not replace source business applications; expose metrics, risk, actions, interfaces, acceptance evidence, and site dependencies."
    },
    totals: {
      applications: applications.length,
      sourceRecords: applications.reduce((sum, item) => sum + item.records, 0),
      openActions: previewOpenActions,
      previewOpenActions,
      sourceOpenActions,
      highRisks: applications.reduce((sum, item) => sum + item.highRisks, 0),
      interfaceTracks: interfaceRows.length,
      evidenceRecords: evidenceRecords.length,
      siteDependencies: siteDependencies.length,
      runtimeRequests: runtime?.http?.apiRequests ?? null,
      readinessPassed: readiness?.passed ?? null,
      releasePassed: releaseReport?.ok ?? null
    },
    applications,
    risks: applications.filter((item) => item.highRisks > 0 || item.openActions > 0).map((item) => ({
      applicationId: item.id,
      application: item.name,
      highRisks: item.highRisks,
      openActions: item.openActions,
      nextAction: item.highRisks ? "Review high-risk source records in the owning application." : "Close source workflow actions in the owning application."
    })),
    openActions,
    interfaces: interfaceRows.map((item) => ({
      id: item.id || item.domain,
      domain: item.domain || item.name || item.id,
      priority: item.priority || "P2",
      owner: item.owner || "",
      status: item.status || "",
      nextAction: item.next || item.nextAction || ""
    })),
    evidence: rows(data, "platformEvidence").map((item) => ({
      id: item.id,
      name: item.name || item.category || item.id,
      owner: item.owner || "",
      status: item.status || "",
      records: Array.isArray(item.records) ? item.records.length : 0,
      nextAction: item.next || item.nextAction || ""
    })),
    siteDependencies: siteDependencies.map((item) => ({
      id: item.id,
      track: item.track || item.name,
      owner: item.owner || "",
      status: item.status || "",
      nextAction: item.nextAction || item.next || ""
    })),
    checks
  };
}

function renderMarkdown(report) {
  const appRows = report.applications.map((item) => `| ${item.id} | ${item.entry} | ${item.records} | ${item.openActions} | ${item.highRisks} | ${item.status} |`);
  const actionRows = report.openActions.map((item) => `| ${item.priority} | ${item.application || ""} | ${item.entry || ""} | ${item.collection} | ${item.id} | ${String(item.title || "").replace(/\|/g, "/")} | ${item.status} | ${item.owner} |`);
  const checkRows = report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${String(item.detail || "").replace(/\|/g, "/")} |`);
  return [
    "# Health dashboard summary",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Applications: ${report.totals.applications}`,
    `- Source records: ${report.totals.sourceRecords}`,
    `- Source open actions: ${report.totals.sourceOpenActions ?? report.totals.openActions}`,
    `- Preview open actions: ${report.totals.previewOpenActions ?? report.totals.openActions}`,
    `- High risks: ${report.totals.highRisks}`,
    `- Interface tracks: ${report.totals.interfaceTracks}`,
    `- Evidence records: ${report.totals.evidenceRecords}`,
    "",
    "## Boundary",
    "",
    report.scope.rule,
    "",
    "## Checks",
    "",
    "| Result | Check | Detail |",
    "|---|---|---|",
    ...checkRows,
    "",
    "## Applications",
    "",
    "| Application | Entry | Records | Open actions | High risks | Status |",
    "|---|---|---:|---:|---:|---|",
    ...appRows,
    "",
    "## Open action preview",
    "",
    "| Priority | Application | Entry | Collection | ID | Title | Status | Owner |",
    "|---|---|---|---|---|---|---|---|",
    ...actionRows,
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
  const report = buildHealthDashboardSummary();
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

module.exports = { APPLICATIONS, buildHealthDashboardSummary, parseArgs, renderMarkdown, writeOutput };
