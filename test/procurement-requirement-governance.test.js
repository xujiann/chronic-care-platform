"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const defaultCatalog = require("../config/procurement-requirement-governance.json");
const defaultRegistry = require("../config/platform-capability-registry.json");
const { StateCommandError } = require("../src/platform/storage/state-command-consistency");
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
  assert.equal(report.schemaVersion, "procurement-requirement-governance-view-v2");
  assert.deepEqual(report.summary, {
    documents: 2,
    sourceSeries: 2,
    documentRevisions: 2,
    historicalRevisions: 0,
    revisionComparisons: 0,
    added: 0,
    changed: 0,
    withdrawn: 0,
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
  assert.match(report.items[0].title, /^需求候选 [A-F0-9]{12}$/);
  assert.equal(Object.hasOwn(report.documents[0], "path"), false);
  assert.equal(Object.hasOwn(report.items[0], "excerpt"), false);
  assert.equal(Object.hasOwn(report.items[0].sourceAnchor, "section"), false);
  assert.equal(report.items.every((item) => item.change === "baseline"), true);
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

test("repository-verified supervision case capability closes the procurement repository gap", () => {
  const execution = applyProcurementRequirementReviewAction({}, command({
    commandId: "review-command-0002",
    requirementId: "PR-SAMPLE-001-R003"
  }), REVIEWER, { now: NOW });
  assert.equal(execution.result.gap.overall, "covered-in-repository");
  assert.equal(execution.result.gap.mappings[0].capabilityId, "H-SUP-CASE");
  assert.equal(execution.result.gap.mappings[0].coverage, "repository-verified");
  const report = buildProcurementRequirementGovernance(execution.data, { now: NOW });
  assert.equal(report.summary.accepted, 1);
  assert.equal(report.summary.coveredInRepository, 1);
  assert.equal(report.summary.gaps, 0);
  assert.equal(report.approvedRequirements.length, 1);
});

test("an explicitly unverified capability remains a gap and cannot borrow repository evidence", () => {
  const registry = structuredClone(defaultRegistry);
  const capability = registry.capabilities.find((item) => item.id === "H-SUP-CASE");
  capability.coverage = "missing";
  capability.evidence = [];
  const execution = applyProcurementRequirementReviewAction({}, command({
    commandId: "review-command-gap-regression",
    requirementId: "PR-SAMPLE-001-R003"
  }), REVIEWER, { now: NOW, registry });
  assert.equal(execution.result.gap.overall, "missing");
  assert.equal(execution.result.gap.mappings[0].evidenceCount, 0);
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
    (error) => error instanceof StateCommandError && error.code === "PROCUREMENT_REQUIREMENT_SCOPE_FORBIDDEN" && error.statusCode === 403
  );
  assert.throws(
    () => applyProcurementRequirementReviewAction({}, command({ rawExcerpt: "untrusted document content" }), REVIEWER, { now: NOW }),
    (error) => error instanceof StateCommandError && error.code === "PROCUREMENT_REQUIREMENT_INPUT_INVALID" && error.statusCode === 400 && !error.message.includes("rawExcerpt")
  );
});

test("governance exposes only the current source revision and derived differences", () => {
  const catalog = structuredClone(defaultCatalog);
  const prior = catalog.documents[0];
  catalog.documents.push({
    ...structuredClone(prior),
    id: "DOC-SAMPLE-2023-001-V2",
    revision: 2,
    supersedesDocumentId: prior.id,
    sha256: `sha256:${"f".repeat(64)}`,
    candidates: [
      { ...structuredClone(prior.candidates[0]), id: "PR-SAMPLE-001-V2-R001", priority: "P1" },
      { ...structuredClone(prior.candidates[2]), id: "PR-SAMPLE-001-V2-R004", logicalRequirementId: "REQ-000000000006", semanticDigest: `sha256:${"a".repeat(64)}` }
    ]
  });
  const report = buildProcurementRequirementGovernance({}, { catalog, now: NOW });
  assert.equal(report.summary.sourceSeries, 2);
  assert.equal(report.summary.documentRevisions, 3);
  assert.equal(report.summary.historicalRevisions, 1);
  assert.equal(report.summary.added, 1);
  assert.equal(report.summary.changed, 1);
  assert.equal(report.summary.withdrawn, 2);
  assert.equal(report.documents.find((item) => item.id === prior.id).isCurrent, false);
  assert.equal(report.items.some((item) => item.id === prior.candidates[1].id), false);
  assert.equal(report.items.find((item) => item.logicalRequirementId === "REQ-000000000001").change, "changed");
  assert.equal(report.productionReady, false);
});

test("a historical review permits exact replay but rejects a new command", () => {
  const first = applyProcurementRequirementReviewAction({}, command(), REVIEWER, { now: NOW });
  const catalog = structuredClone(defaultCatalog);
  const prior = catalog.documents[0];
  catalog.documents.push({
    ...structuredClone(prior),
    id: "DOC-SAMPLE-2023-REPLACEMENT",
    revision: 2,
    supersedesDocumentId: prior.id,
    sha256: `sha256:${"e".repeat(64)}`,
    candidates: [{ ...structuredClone(prior.candidates[1]), id: "PR-SAMPLE-001-V2-R002" }]
  });
  const replay = applyProcurementRequirementReviewAction(first.data, command(), REVIEWER, { catalog, now: NOW });
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.result, first.result);
  assert.deepEqual(replay.data.procurementRequirementGovernance.commands[0].resultSnapshot, first.result);
  assert.throws(
    () => applyProcurementRequirementReviewAction(first.data, command({ commandId: "review-command-historical-new" }), REVIEWER, { catalog, now: NOW }),
    (error) => error.code === "PROCUREMENT_REQUIREMENT_NOT_FOUND" && error.statusCode === 404
  );
});

test("a legacy receipt without an exact result snapshot fails closed", () => {
  const first = applyProcurementRequirementReviewAction({}, command(), REVIEWER, { now: NOW });
  const legacy = structuredClone(first.data);
  delete legacy.procurementRequirementGovernance.commands[0].resultSnapshot;
  assert.throws(
    () => applyProcurementRequirementReviewAction(legacy, command(), REVIEWER, { now: NOW }),
    (error) => error.code === "PROCUREMENT_REQUIREMENT_REPLAY_UNAVAILABLE" && error.statusCode === 409
  );
});

test("changed semantic evidence invalidates approval and requires a versioned re-review", () => {
  const first = applyProcurementRequirementReviewAction({}, command(), REVIEWER, { now: NOW });
  const catalog = structuredClone(defaultCatalog);
  catalog.documents[0].candidates[0].semanticDigest = `sha256:${"d".repeat(64)}`;
  const invalidated = buildProcurementRequirementGovernance(first.data, { catalog, now: NOW });
  const item = invalidated.items.find((candidate) => candidate.id === "PR-SAMPLE-001-R001");
  assert.equal(item.reviewStatus, "revision-required");
  assert.equal(item.evidenceBindingStatus, "invalidated");
  const rereviewed = applyProcurementRequirementReviewAction(first.data, command({ commandId: "review-command-evidence-refresh", expectedVersion: 1 }), REVIEWER, { catalog, now: NOW });
  assert.equal(rereviewed.result.reviewStatus, "accepted");
  assert.equal(rereviewed.result.evidenceBindingStatus, "current");
  assert.equal(rereviewed.result.version, 2);
});

test("changed mapping proposal invalidates approval even when source semantics are unchanged", () => {
  const first = applyProcurementRequirementReviewAction({}, command(), REVIEWER, { now: NOW });
  const catalog = structuredClone(defaultCatalog);
  catalog.documents[0].candidates[0].priority = catalog.documents[0].candidates[0].priority === "P0" ? "P1" : "P0";
  const invalidated = buildProcurementRequirementGovernance(first.data, { catalog, now: NOW });
  const item = invalidated.items.find((candidate) => candidate.id === "PR-SAMPLE-001-R001");
  assert.equal(item.reviewStatus, "revision-required");
  assert.equal(item.evidenceBindingStatus, "invalidated");
});

test("review state rejects orphaned decisions and altered audit history", () => {
  const first = applyProcurementRequirementReviewAction({}, command(), REVIEWER, { now: NOW });

  const orphaned = structuredClone(first.data);
  orphaned.procurementRequirementGovernance.events = [];
  orphaned.procurementRequirementGovernance.commands = [];
  assert.throws(() => buildProcurementRequirementGovernance(orphaned, { now: NOW }), /review state is invalid/);

  const altered = structuredClone(first.data);
  altered.procurementRequirementGovernance.reviews[0].version = 999;
  assert.throws(() => buildProcurementRequirementGovernance(altered, { now: NOW }), /review state is invalid/);
});
