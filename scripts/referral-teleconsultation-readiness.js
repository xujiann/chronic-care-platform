#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "referral-teleconsultation-readiness-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "referral-teleconsultation-readiness-report.md");

const REQUIRED_STATUSES = ["requested", "accepted", "scheduled", "feedback-returned", "report-returned", "closed"];
const REQUIRED_BOUNDARIES = [
  "referral",
  "teleconsultation",
  "receiving feedback",
  "report return",
  "collaboration order",
  "performance"
];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function buildReferralTeleconsultationReadinessReport(options = {}) {
  const data = options.data ?? readJson("data/db.json");
  const pkg = options.pkg ?? readJson("package.json");
  const server = options.server ?? readText("server.js");
  const institution = options.institution ?? readText("institution.html") + readText("institution.js");
  const county = options.county ?? readText("county.html") + readText("county.js");
  const teleconsultations = Array.isArray(data.referralTeleconsultations) ? data.referralTeleconsultations : [];
  const authorizations = new Set((data.personalRecords || [])
    .filter((item) => item.category === "authorizations" && item.status !== "revoked" && item.meta?.status !== "revoked")
    .map((item) => item.id));
  const collaborationOrderIds = new Set((data.countyCollaborationOrders || []).map((item) => item.id));
  const referralIds = new Set((data.referralSystem?.referrals || []).map((item) => item.id));
  const statusSet = new Set(teleconsultations.map((item) => item.status));
  const reportReturned = teleconsultations.filter((item) => item.reportStatus === "returned" || item.status === "report-returned");
  const boundaryEvidence = {
    referral: teleconsultations.every((item) => item.referralId),
    teleconsultation: teleconsultations.every((item) => item.meetingWindow || item.type),
    "receiving feedback": teleconsultations.every((item) => Object.hasOwn(item, "receivingFeedback")),
    "report return": teleconsultations.every((item) => Object.hasOwn(item, "reportStatus") && Object.hasOwn(item, "reportSummary")),
    "collaboration order": teleconsultations.every((item) => item.collaborationOrderId),
    performance: teleconsultations.every((item) => item.performance && typeof item.performance === "object")
  };
  const checks = [
    { id: "referral:boundary", passed: REQUIRED_BOUNDARIES.every((item) => boundaryEvidence[item]), detail: REQUIRED_BOUNDARIES.join(", ") },
    { id: "referral:seedData", passed: teleconsultations.length >= 2, detail: `${teleconsultations.length} teleconsultations` },
    { id: "referral:statusNormalization", passed: teleconsultations.every((item) => REQUIRED_STATUSES.includes(item.status) || item.status === "cancelled"), detail: [...statusSet].join(", ") },
    { id: "referral:residentAuthorization", passed: teleconsultations.every((item) => item.authorizationStatus === "authorized" && authorizations.has(item.residentAuthorizationId)), detail: `${teleconsultations.filter((item) => authorizations.has(item.residentAuthorizationId)).length}/${teleconsultations.length} authorized` },
    { id: "referral:reusePoints", passed: teleconsultations.every((item) => referralIds.has(item.referralId) && collaborationOrderIds.has(item.collaborationOrderId)), detail: "referralSystem and countyCollaborationOrders linked" },
    { id: "referral:reportReturn", passed: reportReturned.length >= 1 && teleconsultations.every((item) => item.reportStatus), detail: `${reportReturned.length} returned reports` },
    { id: "referral:api", passed: /\/api\/referral-teleconsultations/.test(server) && /canAccessReferralTeleconsultation/.test(server) && /appendDataAccessLog/.test(server), detail: "specialized API, role guard, and audit log present" },
    { id: "referral:frontend", passed: /teleconsultation-loop/.test(institution) && /county-teleconsultation-loop/.test(county), detail: "institution and county runnable entries present" },
    { id: "referral:releaseScript", passed: Boolean(pkg.scripts?.["referral:readiness"]), detail: pkg.scripts?.["referral:readiness"] || "missing" }
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    boundaries: REQUIRED_BOUNDARIES,
    statusCatalog: REQUIRED_STATUSES,
    summary: {
      total: teleconsultations.length,
      reportReturned: reportReturned.length,
      collaborationOrders: teleconsultations.filter((item) => collaborationOrderIds.has(item.collaborationOrderId)).length
    },
    teleconsultations: teleconsultations.map((item) => ({
      id: item.id,
      referralId: item.referralId,
      residentId: item.residentId,
      status: item.status,
      reportStatus: item.reportStatus,
      sourceInstitution: item.sourceInstitution,
      targetInstitution: item.targetInstitution,
      collaborationOrderId: item.collaborationOrderId,
      auditEvents: Array.isArray(item.auditTrail) ? item.auditTrail.length : 0
    })),
    checks
  };
}

function renderMarkdown(report) {
  return [
    "# Referral teleconsultation readiness report",
    "",
    `Generated at: ${report.generatedAt}`,
    "",
    "## Summary",
    "",
    `- Teleconsultations: ${report.summary.total}`,
    `- Returned reports: ${report.summary.reportReturned}`,
    `- Linked collaboration orders: ${report.summary.collaborationOrders}`,
    "",
    "## Boundary",
    "",
    ...report.boundaries.map((item) => `- ${item}`),
    "",
    "## Checks",
    "",
    "| Status | Check | Detail |",
    "| --- | --- | --- |",
    ...report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${String(item.detail || "").replace(/\|/g, "/")} |`)
  ].join("\n");
}

function writeReport(report, output = DEFAULT_OUTPUT, markdown = DEFAULT_MARKDOWN) {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({ ok: report.ok, referralTeleconsultationReadiness: report }, null, 2), "utf8");
  fs.writeFileSync(markdown, renderMarkdown(report), "utf8");
}

function main() {
  const report = buildReferralTeleconsultationReadinessReport();
  writeReport(report);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}

if (require.main === module) main();

module.exports = {
  buildReferralTeleconsultationReadinessReport,
  renderMarkdown,
  writeReport
};
