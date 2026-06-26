const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildChronicFollowupReadinessReport,
  renderMarkdown,
  writeOutput
} = require("../scripts/chronic-followup-readiness");

const ROOT = path.resolve(__dirname, "..");

test("chronic follow-up readiness covers all priority application boundaries", () => {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8"));
  const report = buildChronicFollowupReadinessReport({ data });

  assert.equal(report.ok, true);
  assert.equal(report.boundaries.length, 11);
  assert.equal(report.boundaries.every((item) => item.passed), true);
  assert.equal(report.summary.feedbackRecords >= 1, true);
  assert.equal(report.summary.notificationMessages >= 1, true);
  assert.equal(report.summary.alerts >= 1, true);
  assert.equal(report.summary.highPriorityAlerts >= 1, true);
  assert.equal(report.summary.policyAligned, report.summary.policyItems);
  assert.equal(report.alertQueue.some((item) => item.id === "followups:f1" && item.dueBucket === "overdue"), true);
  assert.equal(report.policyAlignment.some((item) => item.id === "policy-feedback-dispatch" && item.covered), true);
  assert.equal(report.reusePoints.includes("chronicScreeningTasks"), true);
  assert.equal(report.reusePoints.includes("citizen.html"), true);
  assert.equal(report.apiSurface.includes("POST /api/chronic/followup-feedback"), true);
});

test("chronic follow-up readiness fails without resident feedback evidence", () => {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8"));
  data.personalRecords = data.personalRecords.filter((item) => item.category !== "chronic-feedback" && !item.meta?.followupFeedback);
  const report = buildChronicFollowupReadinessReport({ data });

  assert.equal(report.ok, false);
  assert.equal(report.boundaries.find((item) => item.id === "resident-feedback").passed, false);
});

test("chronic follow-up readiness fails without feedback notification messages", () => {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8"));
  data.taskMessages = [];
  const report = buildChronicFollowupReadinessReport({ data });

  assert.equal(report.ok, false);
  assert.equal(report.boundaries.find((item) => item.id === "feedback-notification").passed, false);
});

test("chronic follow-up readiness fails without policy-aligned follow-up evidence", () => {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8"));
  data.medicationPickups = [];
  const report = buildChronicFollowupReadinessReport({ data });

  assert.equal(report.ok, false);
  assert.equal(report.boundaries.find((item) => item.id === "policy-alignment").passed, false);
  assert.equal(report.policyAlignment.find((item) => item.id === "policy-medication-support").covered, false);
});

test("chronic follow-up readiness fails without risk reminder queue evidence", () => {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8"));
  data.followups = data.followups.map((item) => ({ ...item, status: "已完成" }));
  data.medicationPickups = data.medicationPickups.map((item) => ({ ...item, status: "已完成", pharmacyStatus: "已取药" }));
  data.chronicManagementPlans = data.chronicManagementPlans.map((item) => ({ ...item, status: "已完成" }));
  data.chronicScreeningTasks = data.chronicScreeningTasks.map((item) => ({ ...item, status: "已评估" }));
  data.taskMessages = data.taskMessages.map((item) => ({ ...item, status: "handled" }));
  const report = buildChronicFollowupReadinessReport({ data });

  assert.equal(report.ok, false);
  assert.equal(report.boundaries.find((item) => item.id === "risk-reminder-queue").passed, false);
  assert.equal(report.summary.alerts, 0);
});

test("chronic follow-up readiness renders and writes release artifacts", (t) => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "chronic-followup-readiness-"));
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const report = buildChronicFollowupReadinessReport();
  const markdown = renderMarkdown(report);
  const written = writeOutput(report, {
    output: path.join(outputDir, "chronic-followup-readiness-report.json"),
    markdown: path.join(outputDir, "chronic-followup-readiness-report.md")
  });

  assert.match(markdown, /Chronic follow-up readiness report/);
  assert.match(markdown, /Policy alignment/);
  assert.match(markdown, /Alert queue/);
  assert.equal(JSON.parse(fs.readFileSync(written.output, "utf8")).ok, true);
  assert.match(fs.readFileSync(written.markdown, "utf8"), /resident-feedback/);
  assert.match(fs.readFileSync(written.markdown, "utf8"), /policy-alignment/);
});
