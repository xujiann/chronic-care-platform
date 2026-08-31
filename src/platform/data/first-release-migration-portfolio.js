"use strict";

const fs = require("node:fs");
const path = require("node:path");

const defaultPortfolio = require("../../../config/first-release-data-migration-portfolio.json");
const defaultOwnership = require("../../../config/domain-data-ownership.json");
const defaultPromotions = require("../../../config/p0-data-promotions.json");
const defaultMigrationProgram = require("../../../config/data-migration-program.json");
const defaultReleaseScope = require("../../../config/production-release-scope.json");
const defaultResearchContract = require("../../../config/research-dataset-migration-contract.json");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const OWNER_PROCESS = Object.freeze({
  "identity-security": "T01",
  "platform-governance": "T02",
  "public-health": "T03",
  "citizen-chronic": "T04",
  "care-coordination": "T05",
  "clinical-specialties": "T06",
  "insurance-payment": "T07",
  integration: "T08",
  research: "T09"
});

function sorted(values) {
  return [...(values || [])].sort();
}

function sameMembers(left, right) {
  return JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));
}

function validateFirstReleaseMigrationPortfolio(portfolio = defaultPortfolio, options = {}) {
  const ownership = options.ownership || defaultOwnership;
  const promotions = options.promotions || defaultPromotions;
  const migrationProgram = options.migrationProgram || defaultMigrationProgram;
  const releaseScope = options.releaseScope || defaultReleaseScope;
  const researchContract = options.researchContract || defaultResearchContract;
  const root = options.root || ROOT;

  if (portfolio?.schemaVersion !== "first-release-data-migration-portfolio.v1"
    || portfolio.scopeId !== releaseScope.scopeId
    || portfolio.ownerReviewContract !== "first-release-legacy-owner-review.v1"
    || portfolio.integrationOwner !== "T00"
    || !Array.isArray(portfolio.entries)) {
    throw new TypeError("first-release migration portfolio identity is invalid");
  }

  const ownerBatch = (ownership.ownerReviewBatches || []).find((item) => item.contract === portfolio.ownerReviewContract);
  const expectedLegacy = sorted(ownerBatch?.collections);
  if (expectedLegacy.length !== 19) throw new TypeError("first-release owner-reviewed legacy authority is incomplete");
  const expectedEntries = [...expectedLegacy, "operationsReadiness", "referrals"];
  if (!sameMembers(portfolio.entries.map((item) => item.collection), expectedEntries)) {
    throw new TypeError("first-release migration portfolio must classify every blocked release reference exactly once");
  }
  if (new Set(portfolio.entries.map((item) => item.collection)).size !== portfolio.entries.length
    || new Set(portfolio.entries.map((item) => item.contractId)).size !== portfolio.entries.length) {
    throw new TypeError("first-release migration portfolio entries and contracts must be unique");
  }

  const promotionByCollection = new Map((promotions.collections || []).map((item) => [item.collection, item]));
  const waveByCollection = new Map();
  for (const wave of migrationProgram.waves || []) {
    for (const collection of wave.collections || []) {
      if (waveByCollection.has(collection)) throw new TypeError(`migration collection is assigned to multiple waves: ${collection}`);
      waveByCollection.set(collection, wave.id);
    }
  }

  for (const entry of portfolio.entries) {
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(entry.collection || "") || !/^[a-z][a-z0-9.-]+\.v1$/.test(entry.contractId || "")) {
      throw new TypeError(`first-release migration entry identity is invalid: ${entry.collection || "missing"}`);
    }
    if (entry.sourceKind === "owner-reviewed-legacy") {
      const policy = ownership.collections?.[entry.collection];
      if (!expectedLegacy.includes(entry.collection)
        || policy?.owner !== entry.owner
        || policy.classification !== entry.classification
        || OWNER_PROCESS[entry.owner] !== entry.process
        || policy.ownerReview?.contract !== portfolio.ownerReviewContract
        || !Array.isArray(policy.ownerReview.sourceEvidence)
        || policy.ownerReview.sourceEvidence.length === 0
        || !policy.ownerReview.sourceEvidence.every((source) => fs.existsSync(path.join(root, source.path)))
        || policy.writePolicy?.productionWriteAllowed !== false
        || policy.writePolicy?.productionPromotionAllowed !== false
        || policy.writePolicy?.migrationRequired !== true) {
        throw new TypeError(`owner-reviewed migration source is invalid or permissive: ${entry.collection}`);
      }
      const promotion = promotionByCollection.get(entry.collection);
      if (promotion?.owner !== entry.owner
        || promotion.classification !== entry.classification
        || promotion.contract !== entry.contractId
        || promotion.phase !== "repository-plan-ready") {
        throw new TypeError(`owner-reviewed migration promotion plan is missing: ${entry.collection}`);
      }
    } else if (entry.sourceKind === "owned-source-binding") {
      const binding = releaseScope.collectionSourceBindings?.[entry.collection];
      const policy = ownership.collections?.[entry.collection];
      if (entry.collection !== "referrals"
        || binding?.kind !== "owned-contract"
        || binding.source !== "config/domain-data-ownership.json"
        || JSON.stringify(binding.jsonPath) !== JSON.stringify(["collections", entry.collection])
        || binding.owner !== entry.owner
        || binding.ownerProcess !== entry.process
        || policy?.owner !== entry.owner
        || policy.classification !== entry.classification
        || promotionByCollection.has(entry.collection)) {
        throw new TypeError("referrals source binding must remain owner-bound and non-promoted");
      }
    } else if (entry.sourceKind === "derived-read-model") {
      const binding = releaseScope.collectionSourceBindings?.[entry.collection];
      if (entry.collection !== "operationsReadiness"
        || binding?.kind !== "derived-read-model"
        || binding.ownerProcess !== entry.process
        || entry.waveId !== null
        || entry.repositoryPlanReady !== false
        || promotionByCollection.has(entry.collection)) {
        throw new TypeError("derived operations readiness model must remain non-persistent and non-promoted");
      }
      continue;
    } else {
      throw new TypeError(`first-release migration source kind is invalid: ${entry.collection}`);
    }

    if (entry.repositoryPlanReady !== true || !entry.waveId || waveByCollection.get(entry.collection) !== entry.waveId) {
      throw new TypeError(`persistent first-release reference lacks one migration wave: ${entry.collection}`);
    }
  }

  const persistentEntries = portfolio.entries.filter((item) => item.sourceKind !== "derived-read-model");
  const planReadyPromotions = (promotions.collections || []).filter((item) => item.phase === "repository-plan-ready");
  if (!sameMembers(planReadyPromotions.map((item) => item.collection), expectedLegacy)) {
    throw new TypeError("repository-plan-ready promotion phase must cover the frozen owner-review batch exactly");
  }
  if (researchContract.collection !== "researchDatasets"
    || researchContract.contractId !== portfolio.entries.find((item) => item.collection === "researchDatasets")?.contractId
    || researchContract.migration?.waveId !== waveByCollection.get("researchDatasets")) {
    throw new TypeError("research dataset detailed migration contract drifted from the portfolio");
  }

  const target = portfolio.target || {};
  if (target.engine !== "postgresql"
    || target.schemaSource !== "deploy/postgres-primary-storage-schema.sql"
    || target.table !== "health_platform.primary_collection_state"
    || target.physicalSchemaChange !== false
    || target.newSqlMigrationRequired !== false
    || !fs.readFileSync(path.join(root, target.schemaSource), "utf8").includes("CREATE TABLE IF NOT EXISTS health_platform.primary_collection_state")) {
    throw new TypeError("first-release PostgreSQL migration target is invalid");
  }
  const controls = portfolio.controls || {};
  if (controls.mode !== migrationProgram.mode
    || controls.requestPathDualWrite !== false
    || migrationProgram.requestPathDualWrite !== false
    || controls.requireExactCounts !== true
    || controls.allowedMismatchCount !== 0
    || controls.allowedDuplicateCount !== 0
    || controls.requireMatchingDigest !== true
    || controls.requireOutboxCheckpoint !== true
    || controls.minimumIndependentApprovals < 2
    || !sameMembers(controls.requiredApprovalRoles, ["data-owner", "release-manager"])
    || controls.localExecutionAuthorized !== false
    || controls.productionCutoverAuthorized !== false
    || migrationProgram.productionCutoverAuthorized !== false
    || portfolio.writePolicy?.productionWriteAllowed !== false
    || portfolio.writePolicy?.productionPromotionAllowed !== false
    || portfolio.writePolicy?.externalEvidenceRequired !== true
    || portfolio.productionReady !== false
    || !Array.isArray(portfolio.remainingGates)
    || portfolio.remainingGates.length === 0) {
    throw new TypeError("first-release migration portfolio controls must remain fail closed");
  }
  return Object.freeze({
    entries: portfolio.entries.length,
    persistentReferences: persistentEntries.length,
    repositoryPlanReady: persistentEntries.filter((item) => item.repositoryPlanReady).length,
    ownerReviewedPlans: expectedLegacy.length,
    ownedSourceBindingPlans: persistentEntries.filter((item) => item.sourceKind === "owned-source-binding").length,
    derivedReadModels: portfolio.entries.filter((item) => item.sourceKind === "derived-read-model").length
  });
}

function buildFirstReleaseMigrationPortfolioReadiness(options = {}) {
  const portfolio = options.portfolio || defaultPortfolio;
  const summary = validateFirstReleaseMigrationPortfolio(portfolio, options);
  return Object.freeze({
    schemaVersion: "first-release-data-migration-portfolio-readiness.v1",
    scopeId: portfolio.scopeId,
    ok: summary.persistentReferences === summary.repositoryPlanReady && summary.derivedReadModels === 1,
    repositoryCriticalGaps: summary.persistentReferences - summary.repositoryPlanReady,
    summary,
    localExecutionAuthorized: false,
    productionWriteAllowed: false,
    productionPromotionAllowed: false,
    productionReady: false,
    remainingGates: Object.freeze([...portfolio.remainingGates]),
    boundary: portfolio.boundary
  });
}

module.exports = {
  OWNER_PROCESS,
  buildFirstReleaseMigrationPortfolioReadiness,
  validateFirstReleaseMigrationPortfolio
};
