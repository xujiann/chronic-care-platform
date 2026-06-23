#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "quality-safety-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "quality-safety-report.md");

const REQUIRED_COLLECTIONS = [
  "qualitySafetyEvents",
  "criticalValueAlerts",
  "clinicalPathwayCases",
  "medicalRecordQualityReviews",
  "mutualRecognitionQualityReviews",
  "qualityRectificationOrders"
];

const REUSED_COLLECTIONS = [
  "diagnosticReports",
  "countyMutualRecognitionRecords",
  "dataQualityIssues",
  "institutionCreditEvaluations",
  "securityEvents",
  "hospitalInteroperabilityFunctions"
];

const REQUIRED_ROUTES = [
  "/api/quality-safety/dashboard",
  "/api/quality-safety/issues/:id/dispatch",
  "/api/quality-safety/rectifications/:id/feedback",
  "/api/quality-safety/rectifications/:id/review",
  "/api/quality-safety/rectifications/:id/escalate"
];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function arrayOf(data, key) {
  return Array.isArray(data[key]) ? data[key] : [];
}

function statusClosed(status) {
  return /closed|approved|resolved|completed|review_passed/i.test(String(status || ""));
}

function slaState(item, now = new Date()) {
  const dueAt = String(item.dueAt || "").trim();
  const dueTime = dueAt ? new Date(dueAt).getTime() : NaN;
  const closed = statusClosed(item.status);
  const daysRemaining = Number.isFinite(dueTime) ? Math.ceil((dueTime - now.getTime()) / 86400000) : null;
  const feedbackComplete = Array.isArray(item.feedback) && item.feedback.length > 0;
  const auditReady = Array.isArray(item.auditTrail) && item.auditTrail.length > 0;
  let status = "unscheduled";
  if (closed) status = "closed";
  else if (Number.isFinite(dueTime) && dueTime < now.getTime()) status = "overdue";
  else if (Number.isFinite(dueTime) && daysRemaining <= 7) status = "due_soon";
  else if (Number.isFinite(dueTime)) status = "on_track";
  return {
    status,
    daysRemaining,
    feedbackComplete,
    evidenceComplete: feedbackComplete && auditReady
  };
}

function buildQualitySafetyReport(options = {}) {
  const data = options.data || readJson("data/db.json");
  const server = options.serverSource || read("server.js");
  const qualityEvents = arrayOf(data, "qualitySafetyEvents");
  const rectifications = arrayOf(data, "qualityRectificationOrders");
  const boundaryRows = [
    { id: "medical-quality", collection: "qualitySafetyEvents", modeled: qualityEvents.some((item) => item.domain === "medical_quality") },
    { id: "safety-events", collection: "qualitySafetyEvents", modeled: qualityEvents.some((item) => item.type === "safety_event") },
    { id: "critical-values", collection: "criticalValueAlerts", modeled: arrayOf(data, "criticalValueAlerts").length > 0 },
    { id: "clinical-pathways", collection: "clinicalPathwayCases", modeled: arrayOf(data, "clinicalPathwayCases").length > 0 },
    { id: "medical-record-qc", collection: "medicalRecordQualityReviews", modeled: arrayOf(data, "medicalRecordQualityReviews").length > 0 },
    { id: "mutual-recognition-qc", collection: "mutualRecognitionQualityReviews", modeled: arrayOf(data, "mutualRecognitionQualityReviews").length > 0 },
    { id: "rectification-loop", collection: "qualityRectificationOrders", modeled: rectifications.some((item) => item.status && Array.isArray(item.auditTrail)) }
  ];
  const collectionRows = REQUIRED_COLLECTIONS.map((collection) => ({
    collection,
    rows: arrayOf(data, collection).length,
    present: Array.isArray(data[collection])
  }));
  const reusedRows = REUSED_COLLECTIONS.map((collection) => ({
    collection,
    rows: arrayOf(data, collection).length,
    present: Array.isArray(data[collection])
  }));
  const routeRows = REQUIRED_ROUTES.map((route) => ({
    route,
    present: server.includes(route)
  }));
  const stateRows = rectifications.map((item) => {
    const sla = slaState(item);
    return {
      id: item.id,
      issueId: item.issueId,
      status: item.status || "open",
      slaStatus: sla.status,
      daysRemaining: sla.daysRemaining,
      feedbackCount: Array.isArray(item.feedback) ? item.feedback.length : 0,
      reviewCount: Array.isArray(item.review) ? item.review.length : 0,
      auditCount: Array.isArray(item.auditTrail) ? item.auditTrail.length : 0,
      evidenceComplete: sla.evidenceComplete,
      closed: statusClosed(item.status)
    };
  });
  const slaSummary = {
    overdue: stateRows.filter((item) => item.slaStatus === "overdue").length,
    dueSoon: stateRows.filter((item) => item.slaStatus === "due_soon").length,
    onTrack: stateRows.filter((item) => item.slaStatus === "on_track").length,
    evidenceComplete: stateRows.filter((item) => item.evidenceComplete).length
  };
  const checks = [
    { id: "quality-safety:boundaries", passed: boundaryRows.every((item) => item.modeled), detail: `${boundaryRows.filter((item) => item.modeled).length}/${boundaryRows.length} boundaries modeled` },
    { id: "quality-safety:collections", passed: collectionRows.every((item) => item.present && item.rows > 0), detail: collectionRows.map((item) => `${item.collection}:${item.rows}`).join(";") },
    { id: "quality-safety:reuse", passed: reusedRows.every((item) => item.present), detail: reusedRows.map((item) => `${item.collection}:${item.rows}`).join(";") },
    { id: "quality-safety:routes", passed: routeRows.every((item) => item.present), detail: routeRows.map((item) => `${item.route}:${item.present}`).join(";") },
    { id: "quality-safety:closed-loop", passed: stateRows.some((item) => item.feedbackCount > 0 && item.auditCount > 0), detail: `${stateRows.length} rectification orders` },
    { id: "quality-safety:sla", passed: stateRows.every((item) => item.slaStatus !== "unscheduled"), detail: `overdue=${slaSummary.overdue}, dueSoon=${slaSummary.dueSoon}, onTrack=${slaSummary.onTrack}` },
    { id: "quality-safety:evidence", passed: stateRows.some((item) => item.evidenceComplete), detail: `${slaSummary.evidenceComplete}/${stateRows.length} rectifications have feedback and audit evidence` }
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    summary: {
      boundaries: boundaryRows.length,
      modeledBoundaries: boundaryRows.filter((item) => item.modeled).length,
      collections: collectionRows.length,
      reusedCollections: reusedRows.length,
      openRectifications: stateRows.filter((item) => !item.closed).length,
      sla: slaSummary
    },
    boundaries: boundaryRows,
    collections: collectionRows,
    reusedCollections: reusedRows,
    routes: routeRows,
    rectifications: stateRows,
    checks
  };
}

function renderMarkdown(report) {
  return [
    "# Medical quality and safety supervision report",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Modeled boundaries: ${report.summary.modeledBoundaries}/${report.summary.boundaries}`,
    `- Open rectifications: ${report.summary.openRectifications}`,
    `- SLA: overdue ${report.summary.sla.overdue}, due soon ${report.summary.sla.dueSoon}, on track ${report.summary.sla.onTrack}`,
    "",
    "## Checks",
    "",
    "| Result | Check | Detail |",
    "|---|---|---|",
    ...report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${String(item.detail || "").replace(/\|/g, "/")} |`),
    "",
    "## Boundary coverage",
    "",
    "| Boundary | Collection | Modeled |",
    "|---|---|---|",
    ...report.boundaries.map((item) => `| ${item.id} | ${item.collection} | ${item.modeled ? "yes" : "no"} |`),
    "",
    "## Reused platform collections",
    "",
    "| Collection | Rows |",
    "|---|---:|",
    ...report.reusedCollections.map((item) => `| ${item.collection} | ${item.rows} |`),
    "",
    "## Rectification SLA",
    "",
    "| Order | Status | SLA | Days remaining | Feedback | Evidence |",
    "|---|---|---|---:|---:|---|",
    ...report.rectifications.map((item) => `| ${item.id} | ${item.status} | ${item.slaStatus} | ${item.daysRemaining === null ? "" : item.daysRemaining} | ${item.feedbackCount} | ${item.evidenceComplete ? "complete" : "pending"} |`),
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
  const report = buildQualitySafetyReport();
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

module.exports = { REQUIRED_COLLECTIONS, REUSED_COLLECTIONS, REQUIRED_ROUTES, buildQualitySafetyReport, parseArgs, renderMarkdown, writeOutput };
