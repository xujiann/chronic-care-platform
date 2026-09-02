"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  applyProcurementRequirementReviewAction,
  buildProcurementRequirementGovernance
} = require("../src/platform/productization/procurement-requirement-governance");

const NOW = "2026-09-02T09:00:00.000Z";
const REVIEWER = Object.freeze({ name: "governance-reviewer", role: "commission" });

function command(overrides = {}) {
  return {
    commandId: "review-command-0001",
    requirementId: "PR-SAMPLE-001-R001",
    action: "accept",
    expectedVersion: 0,
    note: "经人工复核确认来源定位与能力映射一致",
    ...overrides
  };
}

test("requirement governance exposes only minimized candidates and starts fail closed", () => {
  const report = buildProcurementRequirementGovernance({}, { now: NOW });
  assert.equal(report.schemaVersion, "procurement-requirement-governance-view-v1");
  assert.deepEqual(report.summary, {
    documents: 2,
    candidates: 5,
    pendingReview: 5,
    accepted: 0,
    revisionRequired: 0,
    rejected: 0,
    coveredInRepository: 0,
    gaps: 0
  });
  assert.equal(report.productionReady, false);
  assert.equal(report.containsRawDocument, false);
  assert.equal(report.containsLocalPath, false);
  assert.equal(report.items.every((item) => item.productionReady === false), true);
  assert.equal(Object.hasOwn(report.documents[0], "path"), false);
  assert.equal(Object.hasOwn(report.items[0], "excerpt"), false);
});

test("commission review persists a digest-only decision and computes repository coverage", () => {
  const execution = applyProcurementRequirementReviewAction({}, command(), REVIEWER, { now: NOW });
  assert.equal(execution.replayed, false);
  assert.equal(execution.result.reviewStatus, "accepted");
  assert.equal(execution.result.version, 1);
  assert.equal(execution.result.gap.overall, "covered-in-repository");
  const review = execution.data.procurementRequirementGovernance.reviews[0];
  assert.match(review.noteDigest, /^sha256:[a-f0-9]{64}$/);
  assert.match(review.actorDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(review, "note"), false);
  assert.equal(Object.hasOwn(review, "actor"), false);

  const report = buildProcurementRequirementGovernance(execution.data, { now: NOW });
  assert.equal(report.summary.accepted, 1);
  assert.equal(report.summary.coveredInRepository, 1);
  assert.equal(report.summary.gaps, 0);
});

test("missing capabilities remain explicit gaps after human acceptance", () => {
  const execution = applyProcurementRequirementReviewAction({}, command({
    commandId: "review-command-0002",
    requirementId: "PR-SAMPLE-001-R003"
  }), REVIEWER, { now: NOW });
  assert.equal(execution.result.gap.overall, "missing");
  assert.equal(execution.result.gap.mappings[0].capabilityId, "H-SUP-CASE");
  const report = buildProcurementRequirementGovernance(execution.data, { now: NOW });
  assert.equal(report.summary.accepted, 1);
  assert.equal(report.summary.gaps, 1);
  assert.equal(report.approvedRequirements.length, 1);
});

test("review commands are idempotent and reject stale or changed intent", () => {
  const first = applyProcurementRequirementReviewAction({}, command(), REVIEWER, { now: NOW });
  const replay = applyProcurementRequirementReviewAction(first.data, command(), REVIEWER, { now: NOW });
  assert.equal(replay.replayed, true);
  assert.equal(replay.data.procurementRequirementGovernance.events.length, 1);
  assert.equal(replay.result.version, 1);

  assert.throws(
    () => applyProcurementRequirementReviewAction(first.data, command({ note: "同一命令号不可承载不同的复核结论说明" }), REVIEWER, { now: NOW }),
    (error) => error.code === "PROCUREMENT_REQUIREMENT_COMMAND_CONFLICT"
  );
  assert.throws(
    () => applyProcurementRequirementReviewAction(first.data, command({ commandId: "review-command-0003" }), REVIEWER, { now: NOW }),
    (error) => error.code === "PROCUREMENT_REQUIREMENT_VERSION_CONFLICT"
  );
});

test("review boundary rejects unauthorized actors and source-content command fields", () => {
  assert.throws(
    () => applyProcurementRequirementReviewAction({}, command(), { name: "viewer-user", role: "viewer" }, { now: NOW }),
    /requires commission role/
  );
  assert.throws(
    () => applyProcurementRequirementReviewAction({}, command({ rawExcerpt: "untrusted document content" }), REVIEWER, { now: NOW }),
    /rawExcerpt is not allowed/
  );
});
