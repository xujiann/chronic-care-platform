"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const data = require("../data/db.json");
const ownership = require("../config/domain-data-ownership.json");
const promotionProgram = require("../config/p0-data-promotions.json");
const { buildDataPromotionCenter, validatePromotionProgram } = require("../src/platform/productization/data-promotion-center");
const { promotionPhaseCounts } = require("../src/platform/data/promotion-contract");

test("P0 data promotion and T02 regional ownership reduce legacy authority debt", () => {
  const report = buildDataPromotionCenter(data, { now: "2026-08-17T01:00:00.000Z" });
  const phases = promotionPhaseCounts(promotionProgram);
  assert.equal(report.ok, true);
  assert.equal(report.summary.promotedP0, phases.promotedP0);
  assert.equal(report.summary.repositoryPlanReady, phases.repositoryPlanReady);
  assert.equal(report.summary.registeredContracts, phases.registeredContracts);
  assert.deepEqual(phases, { promotedP0: 12, repositoryPlanReady: 1, registeredContracts: 13 });
  assert.equal(report.checks.find((item) => item.id === "dataPromotion:phases").detail, "12 promoted / 1 repository plan-ready");
  assert.equal(report.summary.authoritative, 61);
  assert.equal(report.summary.legacyBlocked, 188);
  for (const collection of [
    "regionalDataSharingScope",
    "regionalSharingPackages",
    "regionalSharingSnapshots",
    "regionalSharingAccessReviews"
  ]) {
    assert.equal(ownership.collections[collection]?.owner, "platform-governance", collection);
  }
  assert.equal(report.collections.every((item) => item.registered && item.contract.endsWith(".v1")), true);
  assert.deepEqual(
    report.collections.find((item) => item.collection === "researchDatasets"),
    {
      collection: "researchDatasets",
      owner: "research",
      classification: "de-identified",
      contract: "research.dataset-aggregate.v1",
      phase: "repository-plan-ready",
      records: data.researchDatasets.length,
      registered: true,
      migrationMode: "outbox-shadow-then-cutover",
      productionCutoverAuthorized: false
    }
  );
  assert.equal(report.productionReady, false);
});

test("P0 data promotion rejects request-path dual writes", () => {
  const program = structuredClone(require("../config/p0-data-promotions.json"));
  program.migrationContract.requestPathDualWrite = true;
  assert.throws(() => validatePromotionProgram(program), /outbox-based/);
});

test("P0 data promotion rejects invalid phases and owner-reviewed legacy promotion forgery", () => {
  const invalidPhase = structuredClone(promotionProgram);
  invalidPhase.collections.find((item) => item.collection === "researchDatasets").phase = "ready";
  assert.throws(() => validatePromotionProgram(invalidPhase), /phase is invalid: researchDatasets/);

  const forgedPromotion = structuredClone(promotionProgram);
  forgedPromotion.collections.find((item) => item.collection === "researchDatasets").phase = "promoted";
  assert.throws(() => validatePromotionProgram(forgedPromotion), /cannot be reported as promoted: researchDatasets/);

  const forgedPlanReady = structuredClone(promotionProgram);
  forgedPlanReady.collections.find((item) => item.collection === "accounts").phase = "repository-plan-ready";
  assert.throws(() => validatePromotionProgram(forgedPlanReady), /requires a fail-closed owner-reviewed legacy policy: accounts/);
});
