const assert = require("node:assert/strict");
const test = require("node:test");

const {
  HIGHLIGHT_CAPABILITIES,
  buildPublicHealthHighlights,
  normalizePublicHealthAiReviewAction,
  normalizePublicHealthCommandTaskAction,
  normalizePublicHealthEvidenceAction,
  normalizePublicHealthHighlightAlertAction,
  normalizePublicHealthSignal
} = require("../public-health-highlights-service");

test("public health highlight center exposes five auditable capability suites", () => {
  const center = buildPublicHealthHighlights({ data: {} });

  assert.equal(center.ok, true);
  assert.equal(center.functionalState, "five-suite-runnable");
  assert.equal(center.formalGoLiveState, "blocked-until-site-evidence-signed");
  assert.equal(center.capabilities.length, 5);
  assert.deepEqual(center.capabilities.map((item) => item.id), HIGHLIGHT_CAPABILITIES.map((item) => item.id));
  assert.equal(center.summary.signals >= 6, true);
  assert.equal(center.summary.activeAlerts >= 1, true);
  assert.equal(center.summary.openTasks >= 1, true);
  assert.equal(center.summary.resources >= 1, true);
  assert.equal(center.summary.evidenceScore >= 0 && center.summary.evidenceScore <= 100, true);
  assert.equal(center.aiCenter.modelCard.humanApprovalRequired, true);
  assert.equal(center.evidenceCenter.records.length >= 1, true);
});

test("public health signal intake validates sources and constrains map coordinates", () => {
  assert.throws(() => normalizePublicHealthSignal({ sourceType: "unknown", value: 1 }), /sourceType/);
  const sourceType = buildPublicHealthHighlights({ data: {} }).triggerCenter.quality.sourceTypes[0];
  assert.throws(() => normalizePublicHealthSignal({ sourceType, value: -1 }), /non-negative/);

  const signal = normalizePublicHealthSignal({ sourceType, value: 8, x: 120, y: -10 }, { name: "Public health reviewer" });
  assert.equal(signal.location.x, 95);
  assert.equal(signal.location.y, 5);
  assert.equal(signal.qualityStatus, "manual-review");
  assert.equal(signal.createdBy, "Public health reviewer");
});

test("public health actions preserve human decisions and audit history", () => {
  const center = buildPublicHealthHighlights({ data: {} });
  const user = { name: "Commission operator", role: "commission" };
  const alert = normalizePublicHealthHighlightAlertAction(center.triggerCenter.alerts[0], { action: "investigate", note: "verify source" }, user);
  const task = normalizePublicHealthCommandTaskAction(center.commandCenter.tasks[0], { action: "accept", note: "accepted" }, user);
  const review = normalizePublicHealthAiReviewAction(center.aiCenter.reviews[0], { action: "approve", note: "human reviewed" }, user);
  const evidence = normalizePublicHealthEvidenceAction(center.evidenceCenter.records[0], { action: "verify", note: "artifact checked", artifactName: "site-proof.pdf" }, user);

  assert.equal(alert.item.status, "investigating");
  assert.equal(task.item.status, "in-progress");
  assert.equal(review.item.status, "approved");
  assert.equal(evidence.item.status, "verified");
  [alert, task, review, evidence].forEach((result) => {
    assert.equal(result.history.actor, "Commission operator");
    assert.equal(result.history.role, "commission");
    assert.equal(Boolean(result.history.at), true);
  });
});
