#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  normalizeChronicFollowupCase,
  normalizeFamilyDoctorCase,
  normalizeFamilyDoctorServiceDisputeCase,
  normalizePrimaryCareCase,
  normalizeReferralCase,
  normalizeRegistrationCase,
  planClosureReferenceRepairs,
  validateClosureReferences
} = require("../registration-referral-domain");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "registration-referral-closure-readiness-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "registration-referral-closure-readiness-report.md");

function rows(value) {
  return Array.isArray(value) ? value : [];
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function check(id, passed, detail, blocking = false) {
  return { id, passed: Boolean(passed), detail, blocking: Boolean(blocking) };
}

function parseDueAt(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T23:59:59` : raw;
  const time = Date.parse(normalized);
  return Number.isFinite(time) ? time : null;
}

function dueState(caseRow, asOf) {
  const dueAt = parseDueAt(caseRow.dueAt);
  if (!dueAt) return "not-set";
  if (dueAt < asOf) return "overdue";
  if (dueAt - asOf <= 24 * 60 * 60 * 1000) return "due-within-24h";
  return "scheduled";
}

function buildNormalizedCases(data, options = {}) {
  const messages = options.messages || data.taskMessages || [];
  const fulfillments = data.phase2FamilyDoctorFulfillments || [];
  return [
    ...rows(data.registrationOrders).map((item) => normalizeRegistrationCase(item, { messages })),
    ...rows(data.primaryCareAssessments).map((item) => normalizePrimaryCareCase(item, { messages })),
    ...rows(data.referralTeleconsultations).map((item) => normalizeReferralCase(item, { messages })),
    ...rows(data.phase2FamilyDoctorApplications).map((item) => normalizeFamilyDoctorCase(item, { messages, fulfillments })),
    ...rows(data.phase2FamilyDoctorContracts).map((item) => normalizeFamilyDoctorCase(item, { messages, fulfillments })),
    ...rows(data.phase2FamilyDoctorServiceDisputes).map((item) => normalizeFamilyDoctorServiceDisputeCase(item, { messages })),
    ...rows(data.followups).map((item) => normalizeChronicFollowupCase(item, { messages }))
  ];
}

function countBy(items, field) {
  return rows(items).reduce((result, item) => {
    const key = String(item[field] || "unknown");
    result[key] = (result[key] || 0) + 1;
    return result;
  }, {});
}

function buildRegistrationReferralClosureReadiness(options = {}) {
  const data = options.data || readJson(path.join("data", "db.json"));
  const asOf = Number.isFinite(options.asOf) ? options.asOf : Date.parse(options.asOf || new Date().toISOString());
  const cases = buildNormalizedCases(data, options);
  const consistency = validateClosureReferences(data);
  const remediation = planClosureReferenceRepairs(data);
  const terminalPhases = new Set(["closed", "cancelled"]);
  const openCases = cases.filter((item) => !terminalPhases.has(item.unifiedPhase));
  const responsibilityQueue = openCases.map((item) => ({
    caseType: item.caseType,
    caseId: item.caseId,
    residentId: item.residentId,
    unifiedPhase: item.unifiedPhase,
    responsibleOrg: item.responsibleOrg,
    responsibleRole: item.responsibleRole,
    dueAt: item.dueAt,
    dueState: dueState(item, asOf),
    nextAction: item.nextAction,
    notificationState: item.notificationState,
    receiptState: item.receiptState,
    exceptionState: item.exceptionState
  }));
  const exceptionQueue = responsibilityQueue.filter((item) => item.unifiedPhase === "exception" || item.exceptionState !== "none");
  const unowned = responsibilityQueue.filter((item) => !item.responsibleRole || !item.nextAction);
  const unconfirmedNotifications = cases.filter((item) => ["sent-unconfirmed", "delivered-unacknowledged", "partially-acknowledged"].includes(item.notificationState));
  const checks = [
    check("registrationReferralClosure:domainCoverage", ["registration", "referral-teleconsultation", "family-doctor", "chronic-followup"].every((caseType) => cases.some((item) => item.caseType === caseType)), `${new Set(cases.map((item) => item.caseType)).size} domains represented; primary-care activates when assessments exist`),
    check("registrationReferralClosure:responsibility", openCases.length > 0 && unowned.length === 0, `${openCases.length - unowned.length}/${openCases.length} open cases have one owner and next action`),
    check("registrationReferralClosure:notificationModel", cases.every((item) => item.notificationState && item.receiptState), `${cases.length}/${cases.length} cases expose notification and receipt states`),
    check("registrationReferralClosure:referenceValidation", consistency.functionalOk, `${consistency.summary.total} issues evaluated`),
    check("registrationReferralClosure:repairRehearsal", remediation.functionalOk && remediation.summary.rehearsedRepairs === remediation.summary.safeRepairs && remediation.summary.p0AfterRehearsal <= consistency.summary.P0, `${remediation.summary.safeRepairs} safe repairs / ${remediation.summary.manualReviews} manual reviews / ${remediation.summary.p0AfterRehearsal} residual P0`),
    check("registrationReferralClosure:dataConsistency", consistency.dataReady, `${consistency.summary.P0} P0 / ${consistency.summary.P1} P1 consistency issues`, true),
    check("registrationReferralClosure:productionBoundary", cases.every((item) => item.productionEvidence === false) && consistency.productionReady === false, "local records never become production evidence")
  ];
  const functionalChecks = checks.filter((item) => item.id !== "registrationReferralClosure:dataConsistency");
  const functionalOk = functionalChecks.every((item) => item.passed);
  const dataReady = consistency.dataReady;
  return {
    ok: functionalOk && dataReady,
    functionalOk,
    dataReady,
    productionReady: false,
    status: !functionalOk ? "functional-validation-failed" : !dataReady ? "blocked-by-data-consistency" : "local-readiness-passed-production-blocked",
    generatedAt: new Date().toISOString(),
    asOf: new Date(asOf).toISOString(),
    summary: {
      cases: cases.length,
      openCases: openCases.length,
      closedCases: cases.filter((item) => item.unifiedPhase === "closed").length,
      cancelledCases: cases.filter((item) => item.unifiedPhase === "cancelled").length,
      exceptionCases: exceptionQueue.length,
      overdueResponsibilities: responsibilityQueue.filter((item) => item.dueState === "overdue").length,
      unownedCases: unowned.length,
      unconfirmedNotifications: unconfirmedNotifications.length,
      p0ConsistencyIssues: consistency.summary.P0,
      p1ConsistencyIssues: consistency.summary.P1,
      safeRepairs: remediation.summary.safeRepairs,
      manualRepairReviews: remediation.summary.manualReviews,
      p0AfterRepairRehearsal: remediation.summary.p0AfterRehearsal,
      caseTypes: countBy(cases, "caseType"),
      phases: countBy(cases, "unifiedPhase"),
      responsibleRoles: countBy(responsibilityQueue, "responsibleRole"),
      notificationStates: countBy(cases, "notificationState"),
      receiptStates: countBy(cases, "receiptState")
    },
    cases,
    responsibilityQueue,
    exceptionQueue,
    consistency,
    remediation,
    checks,
    blockers: [
      ...consistency.issues.filter((item) => item.severity === "P0").map((item) => `${item.code}:${item.entityId}`),
      "live HIS, payment, insurance and referral callback evidence",
      "message-provider delivery and business acknowledgement receipts",
      "onsite cross-institution responsibility and SLA signoff",
      "production cutover approval and rollback rehearsal"
    ],
    integrationBoundary: {
      publicApiWiring: "pending T00 integration",
      packageAndReleaseWiring: "pending T00 integration",
      persistenceMutation: false,
      productionEvidence: false
    }
  };
}

function clean(value) {
  return String(value ?? "").replace(/\|/g, "/").replace(/\r?\n/g, " ");
}

function renderMarkdown(report) {
  return [
    "# Registration, Referral and Family Doctor Closure Readiness",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Status: ${report.status}`,
    `- Functional validation: ${report.functionalOk ? "PASS" : "FAIL"}`,
    `- Data readiness: ${report.dataReady ? "PASS" : "BLOCKED"}`,
    `- Production readiness: ${report.productionReady ? "PASS" : "BLOCKED"}`,
    `- Cases / open / exceptions: ${report.summary.cases} / ${report.summary.openCases} / ${report.summary.exceptionCases}`,
    `- P0 / P1 consistency issues: ${report.summary.p0ConsistencyIssues} / ${report.summary.p1ConsistencyIssues}`,
    "",
    "## Checks",
    "",
    "| Result | Check | Blocking | Detail |",
    "|---|---|---|---|",
    ...report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${clean(item.id)} | ${item.blocking ? "yes" : "no"} | ${clean(item.detail)} |`),
    "",
    "## Responsibility Queue",
    "",
    "| Type | Case | Phase | Owner role | Due | Due state | Receipt | Next action |",
    "|---|---|---|---|---|---|---|---|",
    ...report.responsibilityQueue.map((item) => `| ${clean(item.caseType)} | ${clean(item.caseId)} | ${clean(item.unifiedPhase)} | ${clean(item.responsibleRole)} | ${clean(item.dueAt)} | ${clean(item.dueState)} | ${clean(item.receiptState)} | ${clean(item.nextAction)} |`),
    "",
    "## Consistency Blockers",
    "",
    "| Severity | Code | Entity | Detail |",
    "|---|---|---|---|",
    ...report.consistency.issues.map((item) => `| ${item.severity} | ${clean(item.code)} | ${clean(item.entityId)} | ${clean(item.detail)} |`),
    "",
    "## Repair Rehearsal",
    "",
    `- Safe repairs: ${report.remediation.summary.safeRepairs}`,
    `- Manual reviews: ${report.remediation.summary.manualReviews}`,
    `- P0 before / after rehearsal: ${report.remediation.summary.p0Before} / ${report.remediation.summary.p0AfterRehearsal}`,
    `- Persistence mutation: ${report.remediation.persistenceMutation}`,
    "",
    "| Repair | Entity | Field | From | To | Sources |",
    "|---|---|---|---|---|---|",
    ...report.remediation.repairs.map((item) => `| ${clean(item.id)} | ${clean(item.entityId)} | ${clean(item.field)} | ${clean(item.from)} | ${clean(item.to)} | ${clean(item.impactedSources.join(", "))} |`),
    "",
    "## Integration Boundary",
    "",
    `- Public API wiring: ${report.integrationBoundary.publicApiWiring}`,
    `- Package and release wiring: ${report.integrationBoundary.packageAndReleaseWiring}`,
    `- Persistence mutation: ${report.integrationBoundary.persistenceMutation}`,
    `- Production evidence: ${report.integrationBoundary.productionEvidence}`,
    ""
  ].join("\n");
}

function parseArgs(argv = process.argv.slice(2)) {
  const flags = { output: DEFAULT_OUTPUT, markdown: DEFAULT_MARKDOWN, allowFailure: false };
  argv.forEach((arg) => {
    if (arg === "--allow-failure") flags.allowFailure = true;
    if (arg.startsWith("--output=")) flags.output = path.resolve(ROOT, arg.slice("--output=".length));
    if (arg.startsWith("--markdown=")) flags.markdown = path.resolve(ROOT, arg.slice("--markdown=".length));
    if (arg.startsWith("--as-of=")) flags.asOf = arg.slice("--as-of=".length);
  });
  return flags;
}

function writeOutput(report, flags = {}) {
  const output = path.resolve(flags.output || DEFAULT_OUTPUT);
  const markdown = path.resolve(flags.markdown || DEFAULT_MARKDOWN);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.mkdirSync(path.dirname(markdown), { recursive: true });
  fs.writeFileSync(markdown, `${renderMarkdown(report)}\n`, "utf8");
  return { output, markdown };
}

if (require.main === module) {
  const flags = parseArgs();
  const report = buildRegistrationReferralClosureReadiness({ asOf: flags.asOf });
  writeOutput(report, flags);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok && !flags.allowFailure) process.exitCode = 1;
}

module.exports = {
  buildNormalizedCases,
  buildRegistrationReferralClosureReadiness,
  parseArgs,
  renderMarkdown,
  writeOutput
};
