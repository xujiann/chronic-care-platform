const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildReferralTeleconsultationReadinessReport,
  renderMarkdown,
  writeReport
} = require("../scripts/referral-teleconsultation-readiness");

test("referral teleconsultation readiness validates closed-loop evidence", () => {
  const report = buildReferralTeleconsultationReadinessReport();
  assert.equal(report.ok, true);
  assert.equal(report.boundaries.includes("teleconsultation"), true);
  assert.equal(report.boundaries.includes("report return"), true);
  assert.equal(report.statusCatalog.includes("report-returned"), true);
  assert.equal(report.summary.total >= 2, true);
  assert.equal(report.summary.reportReturned >= 1, true);
  assert.equal(report.summary.archivedReports >= 1, true);
  assert.equal(report.summary.notifications >= 1, true);
  assert.equal(report.summary.feedbackNotifications >= 1, true);
  assert.equal(report.summary.slaEscalations >= 1, true);
  assert.equal(report.summary.highRiskEscalations >= 1, true);
  assert.equal(report.summary.slaMessages >= 1, true);
  assert.equal(report.summary.acknowledgedEscalations >= 1, true);
  assert.equal(report.summary.signoffDemoReady, report.summary.signoffRoles);
  assert.equal(report.summary.signoffSiteSigned >= 0, true);
  assert.equal(report.summary.signoffSitePending >= 5, true);
  assert.equal(report.summary.jointLedgerRows, 5);
  assert.equal(report.summary.jointLedgerLocalReady, 5);
  assert.equal(report.summary.jointLedgerMatchedContracts >= 0, true);
  assert.equal(report.summary.countySupervisionRows >= 2, true);
  assert.equal(report.summary.insurancePerformanceRows >= 2, true);
  assert.equal(report.escalations.some((item) => item.teleconsultationId === "rtc-001" && item.severity === "high"), true);
  assert.equal(Number.isFinite(report.summary.avgResponseHours), true);
  assert.equal(Number.isFinite(report.summary.avgReportReturnHours), true);
  assert.equal(report.checks.some((item) => item.id === "referral:residentAuthorization" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "referral:api" && item.passed), true);
  assert.match(report.checks.find((item) => item.id === "referral:api").detail, /feedback\/schedule\/report callbacks/);
  assert.equal(report.checks.some((item) => item.id === "referral:reportArchive" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "referral:notifications" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "referral:feedbackCallback" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "referral:performance" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "referral:slaEscalation" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "referral:slaReminder" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "referral:slaAcknowledgement" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "referral:countySupervision" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "referral:jointTestPack" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "referral:jointTestLedger" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "referral:jointTestTaskDispatch" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "referral:jointTestTaskCompletion" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "referral:signoffSummary" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "referral:signoffArchive" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "referral:insurancePerformancePolicy" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "referral:frontend" && item.passed), true);
  assert.match(renderMarkdown(report), /Referral teleconsultation readiness report/);
});

test("referral teleconsultation readiness writes release artifacts", (t) => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "referral-readiness-"));
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const report = buildReferralTeleconsultationReadinessReport();
  const output = path.join(outputDir, "referral-teleconsultation-readiness-report.json");
  const markdown = path.join(outputDir, "referral-teleconsultation-readiness-report.md");
  writeReport(report, output, markdown);
  const json = JSON.parse(fs.readFileSync(output, "utf8"));
  const md = fs.readFileSync(markdown, "utf8");
  assert.equal(json.ok, true);
  assert.equal(json.referralTeleconsultationReadiness.ok, true);
  assert.match(md, /Linked collaboration orders/);
  assert.match(md, /Archived reports/);
  assert.match(md, /Referral notifications/);
  assert.match(md, /Feedback notifications/);
  assert.match(md, /SLA escalations/);
  assert.match(md, /High risk escalations/);
  assert.match(md, /Acknowledged escalations/);
  assert.match(md, /Signoff demo-ready roles/);
  assert.match(md, /Site signoffs archived/);
  assert.match(md, /Site signoffs pending/);
  assert.match(md, /Joint-test ledger rows/);
  assert.match(md, /Joint-test matched contracts/);
  assert.match(md, /County supervision rows/);
  assert.match(md, /Insurance performance rows/);
  assert.match(md, /Avg response hours/);
});
