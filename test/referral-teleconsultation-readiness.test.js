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
  assert.equal(Number.isFinite(report.summary.avgResponseHours), true);
  assert.equal(Number.isFinite(report.summary.avgReportReturnHours), true);
  assert.equal(report.checks.some((item) => item.id === "referral:residentAuthorization" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "referral:api" && item.passed), true);
  assert.match(report.checks.find((item) => item.id === "referral:api").detail, /schedule\/report callbacks/);
  assert.equal(report.checks.some((item) => item.id === "referral:reportArchive" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "referral:performance" && item.passed), true);
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
  assert.match(md, /Avg response hours/);
});
