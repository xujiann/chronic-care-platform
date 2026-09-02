"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { applyProcurementRequirementReviewAction, buildProcurementRequirementGovernance } = require("../src/platform/productization/procurement-requirement-governance");
const { applyProcurementRequirementDeliveryAction, buildProcurementRequirementDelivery } = require("../src/platform/productization/procurement-requirement-delivery");

const NOW = "2026-09-02T11:00:00.000Z";
const AUTHOR = Object.freeze({ name: "delivery-author", role: "commission" });
const VERIFIER = Object.freeze({ name: "independent-verifier", role: "commission" });
const REQUIREMENT_ID = "PR-SAMPLE-001-R001";

function accepted() {
  return applyProcurementRequirementReviewAction({}, { commandId: "review-for-delivery-0001", requirementId: REQUIREMENT_ID, action: "accept", expectedVersion: 0, note: "经人工复核确认来源定位与能力映射一致" }, AUTHOR, { now: NOW }).data;
}

function action(data, command, user = AUTHOR) {
  return applyProcurementRequirementDeliveryAction(data, { requirementId: REQUIREMENT_ID, ...command }, user, { now: NOW });
}

test("accepted requirement completes planning, delivery and independent repository evidence verification", () => {
  let data = accepted();
  let execution = action(data, { commandId: "delivery-plan-0001", action: "plan", expectedVersion: 0, releaseWindow: "current-release" });
  data = execution.data;
  assert.equal(execution.result.status, "planned");
  assert.equal(execution.result.recommendation.strategyCode, "ENHANCE_EXISTING_CAPABILITY");
  execution = action(data, { commandId: "delivery-start-0001", action: "start-delivery", expectedVersion: 1 });
  data = execution.data;
  for (const [index, evidenceType] of ["implementation", "test", "review"].entries()) {
    execution = action(data, { commandId: `delivery-submit-${evidenceType}-0001`, action: "submit-evidence", expectedVersion: 2 + index * 2, evidenceType, evidenceDigest: `sha256:${String(index + 1).repeat(64)}` });
    data = execution.data;
    assert.throws(() => action(data, { commandId: `delivery-self-verify-${evidenceType}`, action: "verify-evidence", expectedVersion: 3 + index * 2, evidenceType }), (error) => error.code === "PROCUREMENT_DELIVERY_INDEPENDENCE_REQUIRED");
    execution = action(data, { commandId: `delivery-verify-${evidenceType}-0001`, action: "verify-evidence", expectedVersion: 3 + index * 2, evidenceType }, VERIFIER);
    data = execution.data;
  }
  assert.equal(execution.result.status, "repository-verified");
  assert.equal(execution.result.verifiedEvidence, 3);
  const view = buildProcurementRequirementDelivery(data, { now: NOW });
  assert.equal(view.summary.repositoryVerified, 1);
  assert.equal(view.exportBundle.requirements[0].logicalRequirementId, "REQ-000000000001");
  assert.equal(JSON.stringify(view.exportBundle).includes("PR-SAMPLE"), false);
  assert.equal(view.productionReady, false);
});

test("delivery requires an accepted current evidence binding and exact replay", () => {
  assert.throws(() => action({}, { commandId: "delivery-plan-denied-0001", action: "plan", expectedVersion: 0, releaseWindow: "backlog" }), (error) => error.code === "PROCUREMENT_DELIVERY_NOT_FOUND");
  const data = accepted();
  const command = { commandId: "delivery-plan-replay-0001", action: "plan", expectedVersion: 0, releaseWindow: "next-release" };
  const first = action(data, command);
  const replay = action(first.data, command);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.result, first.result);
  assert.equal(replay.data.procurementRequirementDelivery.events.length, 1);

  const changedCatalog = require("../config/procurement-requirement-governance.json");
  const catalog = structuredClone(changedCatalog);
  catalog.documents[0].candidates[0].semanticDigest = `sha256:${"f".repeat(64)}`;
  const invalidated = buildProcurementRequirementGovernance(data, { catalog, now: NOW });
  assert.equal(invalidated.items.find((item) => item.id === REQUIREMENT_ID).reviewStatus, "revision-required");
  assert.equal(invalidated.items.find((item) => item.id === REQUIREMENT_ID).evidenceBindingStatus, "invalidated");

  const replayAfterInvalidation = action(first.data, command, AUTHOR);
  const replayAgainstChangedCatalog = applyProcurementRequirementDeliveryAction(
    first.data,
    { requirementId: REQUIREMENT_ID, ...command },
    AUTHOR,
    { catalog, now: NOW }
  );
  assert.deepEqual(replayAfterInvalidation.result, first.result);
  assert.deepEqual(replayAgainstChangedCatalog.result, first.result);
  assert.equal(replayAgainstChangedCatalog.replayed, true);
});

test("delivery commands reject source content and stale transitions", () => {
  const data = accepted();
  assert.throws(() => action(data, { commandId: "delivery-unsafe-0001", action: "plan", expectedVersion: 0, releaseWindow: "backlog", sourcePath: "C:/source.pdf" }), (error) => error.code === "PROCUREMENT_DELIVERY_INPUT_INVALID");
  const first = action(data, { commandId: "delivery-plan-stale-0001", action: "plan", expectedVersion: 0, releaseWindow: "backlog" });
  assert.throws(() => action(first.data, { commandId: "delivery-start-stale-0001", action: "start-delivery", expectedVersion: 0 }), (error) => error.code === "PROCUREMENT_DELIVERY_VERSION_CONFLICT");
});

test("acceptance return and resubmission complete an independent human acceptance loop", () => {
  let data = accepted();
  let execution = action(data, { commandId: "acceptance-plan-0001", action: "plan", expectedVersion: 0, releaseWindow: "current-release" });
  data = execution.data;
  execution = action(data, { commandId: "acceptance-start-0001", action: "start-delivery", expectedVersion: 1 });
  data = execution.data;
  for (const [index, evidenceType] of ["implementation", "test", "review"].entries()) {
    execution = action(data, { commandId: `acceptance-submit-${evidenceType}`, action: "submit-evidence", expectedVersion: 2 + index * 2, evidenceType, evidenceDigest: `sha256:${String(index + 4).repeat(64)}` });
    data = execution.data;
    execution = action(data, { commandId: `acceptance-verify-${evidenceType}`, action: "verify-evidence", expectedVersion: 3 + index * 2, evidenceType }, VERIFIER);
    data = execution.data;
  }
  execution = action(data, { commandId: "acceptance-request-0001", action: "request-acceptance", expectedVersion: 8 });
  data = execution.data;
  assert.equal(execution.result.status, "acceptance-review");
  assert.equal(execution.result.acceptanceStatus, "pending");
  assert.throws(() => action(data, { commandId: "acceptance-self-approve-0001", action: "accept-delivery", expectedVersion: 9 }), (error) => error.code === "PROCUREMENT_DELIVERY_ACCEPTANCE_INDEPENDENCE_REQUIRED");

  execution = action(data, { commandId: "acceptance-return-0001", action: "return-delivery", expectedVersion: 9 }, VERIFIER);
  data = execution.data;
  assert.equal(execution.result.status, "acceptance-returned");
  assert.equal(execution.result.acceptanceStatus, "returned");
  assert.throws(() => action(data, { commandId: "acceptance-unchanged-resubmit", action: "resubmit-delivery", expectedVersion: 10 }), (error) => error.code === "PROCUREMENT_DELIVERY_TRANSITION_CONFLICT");
  execution = action(data, { commandId: "acceptance-amended-evidence", action: "submit-evidence", expectedVersion: 10, evidenceType: "review", evidenceDigest: `sha256:${"9".repeat(64)}` });
  data = execution.data;
  execution = action(data, { commandId: "acceptance-amended-verify", action: "verify-evidence", expectedVersion: 11, evidenceType: "review" }, VERIFIER);
  data = execution.data;
  assert.equal(execution.result.status, "acceptance-returned");
  execution = action(data, { commandId: "acceptance-resubmit-0001", action: "resubmit-delivery", expectedVersion: 12 });
  data = execution.data;
  assert.equal(execution.result.acceptanceRevision, 2);
  execution = action(data, { commandId: "acceptance-approve-0001", action: "accept-delivery", expectedVersion: 13 }, VERIFIER);
  assert.equal(execution.result.status, "delivery-accepted");
  assert.equal(execution.result.acceptanceStatus, "accepted");
  assert.equal(execution.result.productionReady, false);
  assert.equal(buildProcurementRequirementDelivery(execution.data, { now: NOW }).summary.deliveryAccepted, 1);
});

test("exact replay survives a later review invalidation", () => {
  const data = accepted();
  const command = { commandId: "delivery-replay-after-review-change", action: "plan", expectedVersion: 0, releaseWindow: "backlog" };
  const first = action(data, command);
  const invalidated = applyProcurementRequirementReviewAction(first.data, {
    commandId: "review-invalidates-delivery-replay",
    requirementId: REQUIREMENT_ID,
    action: "request-revision",
    expectedVersion: 1,
    note: "人工复核要求重新确认来源证据和能力映射"
  }, AUTHOR, { now: NOW }).data;
  const replay = action(invalidated, command);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.result, first.result);
  assert.equal(replay.data.procurementRequirementDelivery.events.length, 1);
});

test("stale plans remain visible but cannot operate after evidence binding changes", () => {
  const data = accepted();
  const planned = action(data, { commandId: "delivery-stale-plan-0001", action: "plan", expectedVersion: 0, releaseWindow: "next-release" });
  const catalog = structuredClone(require("../config/procurement-requirement-governance.json"));
  catalog.documents[0].candidates[0].semanticDigest = `sha256:${"e".repeat(64)}`;
  const rebound = applyProcurementRequirementReviewAction(planned.data, {
    commandId: "review-rebind-changed-evidence",
    requirementId: REQUIREMENT_ID,
    action: "accept",
    expectedVersion: 1,
    note: "人工确认变更后的来源证据并重新采纳需求"
  }, AUTHOR, { catalog, now: NOW });
  const view = buildProcurementRequirementDelivery(rebound.data, { catalog, now: NOW });
  const stale = view.items.find((item) => item.requirementId === REQUIREMENT_ID);
  assert.equal(stale.status, "source-stale");
  assert.equal(stale.actionAllowed, false);
  assert.equal(view.summary.stalePlans, 1);
  assert.throws(() => applyProcurementRequirementDeliveryAction(rebound.data, {
    commandId: "delivery-stale-start-denied",
    requirementId: REQUIREMENT_ID,
    action: "start-delivery",
    expectedVersion: 1
  }, AUTHOR, { catalog, now: NOW }), (error) => error.code === "PROCUREMENT_DELIVERY_SOURCE_STALE");
});
