"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const portfolio = require("../config/first-release-data-migration-portfolio.json");
const migrationProgram = require("../config/data-migration-program.json");
const promotions = require("../config/p0-data-promotions.json");
const {
  buildFirstReleaseMigrationPortfolioReadiness,
  validateFirstReleaseMigrationPortfolio
} = require("../src/platform/data/first-release-migration-portfolio");

test("every blocked first-release reference has one migration plan or one non-persistent classification", () => {
  assert.deepEqual(validateFirstReleaseMigrationPortfolio(), {
    entries: 21,
    persistentReferences: 20,
    repositoryPlanReady: 20,
    ownerReviewedPlans: 19,
    ownedSourceBindingPlans: 1,
    derivedReadModels: 1
  });
  const readiness = buildFirstReleaseMigrationPortfolioReadiness();
  assert.equal(readiness.ok, true);
  assert.equal(readiness.repositoryCriticalGaps, 0);
  assert.equal(readiness.localExecutionAuthorized, false);
  assert.equal(readiness.productionWriteAllowed, false);
  assert.equal(readiness.productionPromotionAllowed, false);
  assert.equal(readiness.productionReady, false);
  assert.equal(readiness.remainingGates.length, 6);
});

test("the migration program assigns every persistent first-release reference to exactly one wave", () => {
  const assignments = migrationProgram.waves.flatMap((wave) => wave.collections.map((collection) => ({ collection, waveId: wave.id })));
  for (const entry of portfolio.entries.filter((item) => item.sourceKind !== "derived-read-model")) {
    assert.deepEqual(assignments.filter((item) => item.collection === entry.collection), [
      { collection: entry.collection, waveId: entry.waveId }
    ]);
  }
  assert.equal(assignments.some((item) => item.collection === "operationsReadiness"), false);
});

test("the frozen owner-review batch is repository-plan-ready without becoming promoted", () => {
  const planReady = promotions.collections.filter((item) => item.phase === "repository-plan-ready");
  assert.equal(planReady.length, 19);
  assert.equal(planReady.every((item) => portfolio.entries.some((entry) => (
    entry.collection === item.collection
      && entry.contractId === item.contract
      && entry.repositoryPlanReady === true
  ))), true);
  assert.equal(planReady.some((item) => item.phase === "promoted"), false);
  assert.equal(promotions.migrationContract.productionCutoverAuthorized, false);
});

test("portfolio validation fails closed on missing plans, duplicate waves and forged production state", () => {
  const missing = structuredClone(portfolio);
  missing.entries.pop();
  assert.throws(
    () => validateFirstReleaseMigrationPortfolio(missing),
    /classify every blocked release reference exactly once/
  );

  const duplicateWave = structuredClone(migrationProgram);
  duplicateWave.waves.find((item) => item.id === "wave-first-release-platform").collections.push("researchDatasets");
  assert.throws(
    () => validateFirstReleaseMigrationPortfolio(portfolio, { migrationProgram: duplicateWave }),
    /assigned to multiple waves: researchDatasets/
  );

  const promoted = structuredClone(portfolio);
  promoted.writePolicy.productionWriteAllowed = true;
  assert.throws(
    () => validateFirstReleaseMigrationPortfolio(promoted),
    /controls must remain fail closed/
  );

  const activated = structuredClone(portfolio);
  activated.controls.productionCutoverAuthorized = true;
  assert.throws(
    () => validateFirstReleaseMigrationPortfolio(activated),
    /controls must remain fail closed/
  );
});

test("owner, classification, source evidence and derived-read-model semantics cannot drift", () => {
  const wrongOwner = structuredClone(portfolio);
  wrongOwner.entries.find((item) => item.collection === "institutionSupervisions").owner = "platform-governance";
  assert.throws(
    () => validateFirstReleaseMigrationPortfolio(wrongOwner),
    /owner-reviewed migration source is invalid or permissive: institutionSupervisions/
  );

  const promotedReferral = structuredClone(promotions);
  promotedReferral.collections.push({
    collection: "referrals",
    owner: "care-coordination",
    classification: "restricted",
    contract: "care.referral.v1",
    phase: "repository-plan-ready"
  });
  assert.throws(
    () => validateFirstReleaseMigrationPortfolio(portfolio, { promotions: promotedReferral }),
    /referrals source binding must remain owner-bound and non-promoted/
  );

  const persistentDerivedModel = structuredClone(portfolio);
  const derived = persistentDerivedModel.entries.find((item) => item.collection === "operationsReadiness");
  derived.waveId = "wave-first-release-platform";
  derived.repositoryPlanReady = true;
  assert.throws(
    () => validateFirstReleaseMigrationPortfolio(persistentDerivedModel),
    /derived operations readiness model must remain non-persistent and non-promoted/
  );
});
