const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildPublicHealthHighlights,
  normalizePublicHealthAiReviewAction,
  normalizePublicHealthCommandTaskAction,
  normalizePublicHealthEvidenceAction,
  normalizePublicHealthHighlightAlertAction,
  normalizePublicHealthSignal,
  seedPublicHealthAiReviews,
  seedPublicHealthAlerts,
  seedPublicHealthCommandTasks,
  seedPublicHealthEvidenceRecords,
  seedPublicHealthResources,
  seedPublicHealthSignals,
  seedPublicHealthTriggerRules
} = require("../public-health-highlights-service");

test("public health five-suite board exposes all five runnable capabilities", () => {
  const board = buildPublicHealthHighlights({ data: {} });
  assert.equal(board.ok, true);
  assert.equal(board.capabilities.length, 5);
  assert.equal(board.summary.rules, 5);
  assert.ok(board.summary.signals >= 6);
  assert.ok(board.summary.activeAlerts >= 4);
  assert.ok(board.summary.openTasks >= 4);
  assert.ok(board.mapBoard.nodes.some((item) => item.type === "alert"));
  assert.equal(board.aiCenter.modelCard.humanApprovalRequired, true);
  assert.ok(board.evidenceCenter.summary.total >= 8);
  assert.equal(board.formalGoLiveState, "blocked-until-site-evidence-signed");
});

test("public health five-suite seeds are structurally linked", () => {
  const rules = seedPublicHealthTriggerRules();
  const signals = seedPublicHealthSignals();
  const alerts = seedPublicHealthAlerts();
  const tasks = seedPublicHealthCommandTasks();
  const resources = seedPublicHealthResources();
  const reviews = seedPublicHealthAiReviews();
  const evidence = seedPublicHealthEvidenceRecords();
  const ruleIds = new Set(rules.map((item) => item.id));
  const alertIds = new Set(alerts.map((item) => item.id));
  const resourceIds = new Set(resources.map((item) => item.id));
  assert.ok(signals.every((item) => ruleIds.has(item.ruleId) && item.sourceSystem && item.evidenceRefs.length));
  assert.ok(alerts.every((item) => item.signalIds.length && item.recommendedAction));
  assert.ok(tasks.every((item) => alertIds.has(item.alertId) && item.resourceIds.every((id) => resourceIds.has(id))));
  assert.ok(reviews.every((item) => item.alertId && item.humanApprovalRequired && item.evidenceRefs.length));
  assert.ok(evidence.every((item) => item.sourceCollection && item.evidenceRefs.length));
});

test("alert, task, AI and evidence actions are normalized with history", () => {
  const user = { name: "演示疾控员", role: "commission" };
  const alert = normalizePublicHealthHighlightAlertAction(seedPublicHealthAlerts()[0], { action: "dispatch", note: "派发流调" }, user);
  assert.equal(alert.item.status, "dispatched");
  assert.equal(alert.item.actionHistory[0].actor, "演示疾控员");

  const task = normalizePublicHealthCommandTaskAction(seedPublicHealthCommandTasks()[0], { action: "accept" }, user);
  assert.equal(task.item.status, "in-progress");
  const review = normalizePublicHealthAiReviewAction(seedPublicHealthAiReviews()[0], { action: "approve", note: "证据充分" }, user);
  assert.equal(review.item.status, "approved");
  const evidence = normalizePublicHealthEvidenceAction(seedPublicHealthEvidenceRecords()[0], { action: "verify", artifactName: "source-check.json" }, user);
  assert.equal(evidence.item.status, "verified");
  assert.equal(evidence.item.artifactName, "source-check.json");
});

test("signal intake validates source type and creates auditable manual-review signal", () => {
  const signal = normalizePublicHealthSignal({ sourceType: "公众上报", value: 2, region: "中山区", institution: "居民上报队列", evidenceRefs: ["citizen-report-1"] }, { name: "演示疾控员", role: "commission" });
  assert.equal(signal.qualityStatus, "manual-review");
  assert.equal(signal.status, "received");
  assert.equal(signal.region, "中山区");
  assert.throws(() => normalizePublicHealthSignal({ sourceType: "未知来源", value: 1 }));
  assert.throws(() => normalizePublicHealthSignal({ sourceType: "实验室", value: -1 }));
});
