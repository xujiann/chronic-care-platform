const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildMultiPracticeReadinessReport,
  renderMarkdown,
  writeReport
} = require("../scripts/multi-practice-readiness");

test("multi-practice readiness validates doctor accounts, review state, APIs and release evidence", () => {
  const report = buildMultiPracticeReadinessReport();
  assert.equal(report.ok, true);
  assert.equal(report.summary.doctors >= 2, true);
  assert.equal(report.summary.verifiedRegistrations >= 2, true);
  assert.equal(report.summary.applications >= 2, true);
  assert.equal(report.summary.signedConfirmations >= 2, true);
  assert.equal(report.summary.messageLoopReady, true);
  assert.equal(report.summary.scheduleConflictReady, true);
  assert.equal(report.summary.publicLedgerReady, true);
  assert.equal(report.summary.externalSyncReady, true);
  assert.equal(report.summary.auditEvidenceReady, true);
  assert.equal(report.requiredDocumentChecks.includes("liabilityInsurance"), true);
  assert.equal(report.checks.some((item) => item.id === "multiPractice:electronicRegistration" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "multiPractice:firstPracticeConfirmation" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "multiPractice:doctorHospitalLoop" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "multiPractice:doctorApi" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "multiPractice:doctorPortal" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "multiPractice:doctorAccountGuard" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "multiPractice:doctorReceiptMessages" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "multiPractice:registryApi" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "multiPractice:scheduleConflict" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "multiPractice:lifecycleActions" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "multiPractice:auditEvidence" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "multiPractice:publicQuery" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "multiPractice:externalSync" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "multiPractice:institutionUi" && item.passed), true);
  assert.match(renderMarkdown(report), /Doctor multi-practice readiness report/);
});

test("multi-practice readiness writes release artifacts", (t) => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "multi-practice-readiness-"));
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const report = buildMultiPracticeReadinessReport();
  const output = path.join(outputDir, "multi-practice-readiness-report.json");
  const markdown = path.join(outputDir, "multi-practice-readiness-report.md");
  writeReport(report, output, markdown);
  const json = JSON.parse(fs.readFileSync(output, "utf8"));
  const md = fs.readFileSync(markdown, "utf8");
  assert.equal(json.ok, true);
  assert.equal(json.multiPracticeReadiness.ok, true);
  assert.match(md, /Verified registrations/);
  assert.match(md, /Signed first-practice confirmations/);
  assert.match(md, /Doctor-hospital message loop/);
  assert.match(md, /Schedule conflict detection/);
  assert.match(md, /Public ledger query/);
  assert.match(md, /External sync evidence/);
  assert.match(md, /Workflow audit evidence/);
});
