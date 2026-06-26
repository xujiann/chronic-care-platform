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
  "/api/quality-safety/rectifications/:id/escalate",
  "/api/quality-safety/critical-values/:id/acknowledge",
  "/api/quality-safety/critical-values/:id/dispose",
  "/api/quality-safety/clinical-pathways/:id/review"
];

const REQUIRED_POLICY_REFERENCES = [
  { id: "medical-quality-management", title: "医疗质量管理办法", url: "https://www.nhc.gov.cn/fzs/c100048/201808/6f3f7915d59943e09768b7469679b857.shtml" },
  { id: "core-safety-systems", title: "医疗质量安全核心制度要点", url: "https://www.nhc.gov.cn/yzygj/c100068/201804/42ab2552298047679cd6ec733f233862.shtml" },
  { id: "quality-action-2023-2025", title: "全面提升医疗质量行动", url: "https://www.nhc.gov.cn/yzygj/c100068/202305/68bcfaf610d94c638f64c53aff5de994.shtml" },
  { id: "mutual-recognition", title: "检查检验结果互认管理办法", url: "https://www.nhc.gov.cn/yzygj/c100068/202202/ef4a28ddc74447eea85f93fe05107200.shtml" },
  { id: "quality-goals-2025", title: "2025年国家医疗质量安全改进目标", url: "https://www.nhc.gov.cn/yzygj/c100067/202503/e9a3bd9bfaa24b28973d86c9d329b8c2.shtml" },
  { id: "clinical-pathway", title: "临床路径管理指导原则", url: "https://www.nhc.gov.cn/zwgk/jdjd/201709/e717bffb5fc445bcb4fa99e7063755c8.shtml" }
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

function severityPoints(severity) {
  const text = String(severity || "").trim().toLowerCase();
  if (/critical|severe|重大|危急/.test(text)) return 6;
  if (/high|高/.test(text)) return 4;
  if (/medium|中/.test(text)) return 2;
  if (/low|低/.test(text)) return 1;
  return 2;
}

function buildInstitutionRisks(issues, rectifications) {
  const rows = new Map();
  function ensure(name) {
    const key = String(name || "Unknown institution").trim() || "Unknown institution";
    if (!rows.has(key)) {
      rows.set(key, {
        institutionName: key,
        score: 0,
        issueCount: 0,
        openIssues: 0,
        highSeverity: 0,
        overdue: 0,
        dueSoon: 0,
        missingFeedback: 0,
        escalated: 0,
        domains: new Set(),
        drivers: new Set()
      });
    }
    return rows.get(key);
  }
  issues.forEach((issue) => {
    const row = ensure(issue.institutionName || issue.owner || issue.sourceCollection);
    const points = severityPoints(issue.severity);
    const closed = statusClosed(issue.status);
    row.issueCount += 1;
    row.score += points;
    row.domains.add(issue.domain || issue.type || "quality");
    if (points >= 4) {
      row.highSeverity += 1;
      row.drivers.add("high-severity issue");
    }
    if (!closed) {
      row.openIssues += 1;
      row.score += 2;
    }
    if (/critical|medical_quality|safety_event/i.test(`${issue.domain || ""} ${issue.type || ""}`)) {
      row.score += 2;
      row.drivers.add("critical value or safety signal");
    }
  });
  rectifications.forEach((order) => {
    const row = ensure(order.institutionName || order.owner);
    row.score += 1;
    if (order.slaStatus === "overdue") {
      row.overdue += 1;
      row.score += 6;
      row.drivers.add("overdue rectification");
    } else if (order.slaStatus === "due_soon") {
      row.dueSoon += 1;
      row.score += 3;
      row.drivers.add("SLA due soon");
    }
    if (!order.feedbackComplete && !order.closed) {
      row.missingFeedback += 1;
      row.score += 2;
      row.drivers.add("feedback missing");
    }
    if (/escalat/i.test(String(order.status || ""))) {
      row.escalated += 1;
      row.score += 4;
      row.drivers.add("commission escalation");
    }
    if (!order.evidenceComplete && !order.closed) {
      row.score += 1;
      row.drivers.add("evidence incomplete");
    }
  });
  return Array.from(rows.values())
    .map((row) => ({
      ...row,
      domains: Array.from(row.domains).slice(0, 5),
      drivers: Array.from(row.drivers).slice(0, 4),
      riskLevel: row.score >= 12 ? "high" : row.score >= 6 ? "medium" : "watch",
      nextAction: row.overdue > 0 ? "Start overdue escalation and require leadership sign-off." : row.score >= 12 ? "Assign focused review and require a department correction plan." : row.dueSoon > 0 ? "Confirm evidence upload before SLA deadline." : "Keep routine QC tracking active."
    }))
    .sort((a, b) => b.score - a.score || b.openIssues - a.openIssues || a.institutionName.localeCompare(b.institutionName))
    .slice(0, 10);
}

function buildActionPlan({ qualityEvents, rectifications, criticalRows, clinicalPathwayRows, mutualRecognitionRows, institutionRisks }) {
  const rows = [];
  function push(item) {
    rows.push({
      id: item.id,
      priority: item.priority,
      owner: item.owner || "Site quality office",
      domain: item.domain || "quality_safety",
      action: item.action,
      reason: item.reason,
      source: item.source,
      dueAt: item.dueAt || "",
      evidence: item.evidence || ""
    });
  }
  criticalRows
    .filter((item) => !item.disposed)
    .forEach((item) => push({
      id: `action-${item.id}`,
      priority: "critical",
      owner: item.institutionName || "Critical value owner",
      domain: "critical_value",
      action: "Complete acknowledgement, physician notification, disposition note, and linked event closure.",
      reason: `${item.item || "critical item"} ${item.value || ""} meets ${item.threshold || "critical"} threshold.`,
      source: item.id,
      dueAt: item.reportedAt,
      evidence: "acknowledgement, disposition, auditTrail"
    }));
  rectifications
    .filter((item) => !item.closed)
    .filter((item) => ["overdue", "due_soon"].includes(item.slaStatus) || !item.evidenceComplete || !item.feedbackComplete)
    .forEach((item) => push({
      id: `action-${item.id}`,
      priority: item.slaStatus === "overdue" ? "high" : "medium",
      owner: item.institutionName || item.owner,
      domain: "rectification",
      action: item.slaStatus === "overdue" ? "Escalate overdue rectification and require leadership sign-off." : "Confirm feedback and evidence before the SLA deadline.",
      reason: `${item.slaStatus}; feedback=${item.feedbackComplete ? "complete" : "missing"}; evidence=${item.evidenceComplete ? "complete" : "pending"}.`,
      source: item.id,
      dueAt: item.dueAt,
      evidence: "feedback, review, auditTrail"
    }));
  clinicalPathwayRows
    .filter((item) => !item.reviewed)
    .forEach((item) => push({
      id: `action-${item.id}`,
      priority: "medium",
      owner: item.institutionName || "Clinical pathway office",
      domain: "clinical_pathway",
      action: "Review pathway variance, attach EMR evidence, and close or return the linked quality event.",
      reason: item.varianceType || item.currentNode || "Open clinical pathway variance.",
      source: item.id,
      dueAt: item.dueAt,
      evidence: "reviewTrail, EMR variance evidence, qualitySafetyEvents"
    }));
  mutualRecognitionRows
    .filter((item) => !statusClosed(item.status || item.qcStatus))
    .forEach((item) => push({
      id: `action-${item.id}`,
      priority: /manual|open|required/i.test(`${item.qcStatus || ""}${item.status || ""}`) ? "medium" : "watch",
      owner: item.owner || item.institutionName || "Regional mutual recognition QC",
      domain: "mutual_recognition_qc",
      action: "Verify recognition quality-control evidence and document whether the result can be recognized.",
      reason: item.issueType || item.qcStatus || item.nextAction || "Mutual recognition QC pending.",
      source: item.id,
      dueAt: item.dueAt,
      evidence: "countyMutualRecognitionRecords, diagnosticReports"
    }));
  institutionRisks
    .filter((item) => item.riskLevel === "high")
    .forEach((item) => push({
      id: `action-risk-${item.institutionName.replace(/\W+/g, "-").toLowerCase()}`,
      priority: "high",
      owner: item.institutionName,
      domain: "institution_risk",
      action: item.nextAction,
      reason: `${item.score} risk points; ${(item.drivers || []).join(", ")}`,
      source: "institutionRisks",
      evidence: "issues, rectifications, SLA, escalation"
    }));
  if (!rows.length && qualityEvents.some((item) => !statusClosed(item.status))) {
    push({
      id: "action-routine-qc",
      priority: "watch",
      owner: "Site quality office",
      domain: "routine_qc",
      action: "Keep routine quality tracking active and review newly opened issues.",
      reason: `${qualityEvents.filter((item) => !statusClosed(item.status)).length} non-closed issues remain visible.`,
      source: "qualitySafetyEvents",
      evidence: "dashboard refresh"
    });
  }
  const priorityRank = { critical: 0, high: 1, medium: 2, watch: 3 };
  return rows
    .sort((a, b) => (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9) || String(a.dueAt || "9999").localeCompare(String(b.dueAt || "9999")) || a.id.localeCompare(b.id))
    .slice(0, 8);
}

function buildQualitySafetyReport(options = {}) {
  const data = options.data || readJson("data/db.json");
  const server = options.serverSource || read("server.js");
  const aboutSource = options.aboutSource || read("quality-safety-about.html");
  const qualityEvents = arrayOf(data, "qualitySafetyEvents");
  const criticalRows = arrayOf(data, "criticalValueAlerts").map((item) => ({
    id: item.id,
    eventId: item.eventId,
    item: item.item,
    value: item.value,
    threshold: item.threshold,
    status: item.status || "open",
    acknowledged: Boolean(item.acknowledgedAt),
    disposed: Boolean(item.disposedAt),
    institutionName: item.targetInstitution || item.sourceInstitution,
    reportedAt: item.reportedAt || "",
    action: item.action || item.disposition?.action || ""
  }));
  const clinicalPathwayRows = arrayOf(data, "clinicalPathwayCases").map((item) => ({
    id: item.id,
    eventId: item.eventId,
    pathwayCode: item.pathwayCode,
    pathwayName: item.pathwayName,
    institutionName: item.institutionName,
    currentNode: item.currentNode,
    varianceType: item.varianceType,
    status: item.status || "open",
    dueAt: item.dueAt || "",
    reviewed: statusClosed(item.status),
    auditCount: Array.isArray(item.auditTrail) ? item.auditTrail.length : 0,
    reviewCount: Array.isArray(item.reviewTrail) ? item.reviewTrail.length : 0
  }));
  const rectifications = arrayOf(data, "qualityRectificationOrders");
  const mutualRecognitionRows = arrayOf(data, "mutualRecognitionQualityReviews");
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
  const policyRows = REQUIRED_POLICY_REFERENCES.map((item) => ({
    ...item,
    present: aboutSource.includes(item.url) && aboutSource.includes(`data-policy-ref="${item.id}"`)
  }));
  const stateRows = rectifications.map((item) => {
    const sla = slaState(item);
    return {
      id: item.id,
      issueId: item.issueId,
      institutionName: item.institutionName,
      owner: item.owner,
      status: item.status || "open",
      dueAt: item.dueAt || "",
      slaStatus: sla.status,
      daysRemaining: sla.daysRemaining,
      feedbackComplete: sla.feedbackComplete,
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
  const institutionRisks = buildInstitutionRisks(qualityEvents, stateRows);
  const actionPlan = buildActionPlan({ qualityEvents, rectifications: stateRows, criticalRows, clinicalPathwayRows, mutualRecognitionRows, institutionRisks });
  const checks = [
    { id: "quality-safety:boundaries", passed: boundaryRows.every((item) => item.modeled), detail: `${boundaryRows.filter((item) => item.modeled).length}/${boundaryRows.length} boundaries modeled` },
    { id: "quality-safety:collections", passed: collectionRows.every((item) => item.present && item.rows > 0), detail: collectionRows.map((item) => `${item.collection}:${item.rows}`).join(";") },
    { id: "quality-safety:reuse", passed: reusedRows.every((item) => item.present), detail: reusedRows.map((item) => `${item.collection}:${item.rows}`).join(";") },
    { id: "quality-safety:routes", passed: routeRows.every((item) => item.present), detail: routeRows.map((item) => `${item.route}:${item.present}`).join(";") },
    { id: "quality-safety:closed-loop", passed: stateRows.some((item) => item.feedbackCount > 0 && item.auditCount > 0), detail: `${stateRows.length} rectification orders` },
    { id: "quality-safety:sla", passed: stateRows.every((item) => item.slaStatus !== "unscheduled"), detail: `overdue=${slaSummary.overdue}, dueSoon=${slaSummary.dueSoon}, onTrack=${slaSummary.onTrack}` },
    { id: "quality-safety:evidence", passed: stateRows.some((item) => item.evidenceComplete), detail: `${slaSummary.evidenceComplete}/${stateRows.length} rectifications have feedback and audit evidence` },
    { id: "quality-safety:risk-ranking", passed: institutionRisks.length > 0 && institutionRisks[0].score > 0, detail: `${institutionRisks.length} ranked institutions` },
    { id: "quality-safety:critical-value-loop", passed: criticalRows.length > 0 && criticalRows.every((item) => item.threshold && item.action), detail: `${criticalRows.length} critical value alerts; ${criticalRows.filter((item) => item.disposed).length} disposed` },
    { id: "quality-safety:clinical-pathway-loop", passed: clinicalPathwayRows.length > 0 && clinicalPathwayRows.every((item) => item.eventId && item.dueAt) && server.includes("/api/quality-safety/clinical-pathways/:id/review"), detail: `${clinicalPathwayRows.length} pathway variances; ${clinicalPathwayRows.filter((item) => item.reviewed).length} reviewed` },
    { id: "quality-safety:policy-basis", passed: policyRows.every((item) => item.present), detail: `${policyRows.filter((item) => item.present).length}/${policyRows.length} policy references linked` },
    { id: "quality-safety:action-plan", passed: actionPlan.length > 0 && actionPlan.every((item) => item.priority && item.action && item.evidence), detail: `${actionPlan.length} prioritized action items` }
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
      sla: slaSummary,
      riskHotspots: institutionRisks.filter((item) => item.riskLevel === "high").length,
      criticalValues: {
        total: criticalRows.length,
        acknowledged: criticalRows.filter((item) => item.acknowledged).length,
        disposed: criticalRows.filter((item) => item.disposed).length,
        pending: criticalRows.filter((item) => !item.disposed).length
      },
      clinicalPathways: {
        total: clinicalPathwayRows.length,
        reviewed: clinicalPathwayRows.filter((item) => item.reviewed).length,
        pending: clinicalPathwayRows.filter((item) => !item.reviewed).length
      },
      policyReferences: policyRows.filter((item) => item.present).length,
      actionItems: actionPlan.length,
      highActionItems: actionPlan.filter((item) => ["critical", "high"].includes(item.priority)).length
    },
    boundaries: boundaryRows,
    collections: collectionRows,
    reusedCollections: reusedRows,
    routes: routeRows,
    policyReferences: policyRows,
    actionPlan,
    institutionRisks,
    criticalValues: criticalRows,
    clinicalPathways: clinicalPathwayRows,
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
    `- Risk hotspots: ${report.summary.riskHotspots}`,
    `- Critical values: ${report.summary.criticalValues.total}, pending disposition ${report.summary.criticalValues.pending}`,
    `- Clinical pathways: ${report.summary.clinicalPathways.total}, pending review ${report.summary.clinicalPathways.pending}`,
    `- Policy references: ${report.summary.policyReferences}/${report.policyReferences.length}`,
    `- Action plan: ${report.summary.actionItems} items, high priority ${report.summary.highActionItems}`,
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
    "## Policy Basis",
    "",
    "| Policy | Reference | Linked |",
    "|---|---|---|",
    ...report.policyReferences.map((item) => `| ${item.title} | ${item.url} | ${item.present ? "yes" : "no"} |`),
    "",
    "## Regulatory Action Plan",
    "",
    "| Priority | Owner | Domain | Action | Evidence |",
    "|---|---|---|---|---|",
    ...report.actionPlan.map((item) => `| ${item.priority} | ${item.owner} | ${item.domain} | ${String(item.action || "").replace(/\|/g, "/")} | ${String(item.evidence || "").replace(/\|/g, "/")} |`),
    "",
    "## Institution risk ranking",
    "",
    "| Institution | Level | Score | Open issues | Due soon | Overdue | Drivers |",
    "|---|---|---:|---:|---:|---:|---|",
    ...report.institutionRisks.map((item) => `| ${item.institutionName} | ${item.riskLevel} | ${item.score} | ${item.openIssues} | ${item.dueSoon} | ${item.overdue} | ${item.drivers.join(", ")} |`),
    "",
    "## Critical Value Loop",
    "",
    "| Alert | Item | Threshold | Status | Acknowledged | Disposed | Action |",
    "|---|---|---|---|---|---|---|",
    ...report.criticalValues.map((item) => `| ${item.id} | ${item.item} ${item.value} | ${item.threshold} | ${item.status} | ${item.acknowledged ? "yes" : "no"} | ${item.disposed ? "yes" : "no"} | ${String(item.action || "").replace(/\|/g, "/")} |`),
    "",
    "## Clinical Pathway Loop",
    "",
    "| Case | Pathway | Institution | Variance | Status | Due at | Reviewed |",
    "|---|---|---|---|---|---|---|",
    ...report.clinicalPathways.map((item) => `| ${item.id} | ${item.pathwayName} | ${item.institutionName} | ${item.varianceType} | ${item.status} | ${item.dueAt} | ${item.reviewed ? "yes" : "no"} |`),
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

module.exports = { REQUIRED_COLLECTIONS, REUSED_COLLECTIONS, REQUIRED_ROUTES, REQUIRED_POLICY_REFERENCES, buildQualitySafetyReport, parseArgs, renderMarkdown, writeOutput };
