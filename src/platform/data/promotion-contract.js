"use strict";

const ownershipManifest = require("../../../config/domain-data-ownership.json");
const promotionProgram = require("../../../config/p0-data-promotions.json");

const PROMOTION_PHASES = Object.freeze({
  PROMOTED: "promoted",
  REPOSITORY_PLAN_READY: "repository-plan-ready"
});

function promotionPhaseCounts(program = promotionProgram) {
  const collections = Array.isArray(program?.collections) ? program.collections : [];
  return Object.freeze({
    promotedP0: collections.filter((item) => item.phase === PROMOTION_PHASES.PROMOTED).length,
    repositoryPlanReady: collections.filter((item) => item.phase === PROMOTION_PHASES.REPOSITORY_PLAN_READY).length,
    registeredContracts: collections.length
  });
}

function validatePromotionProgram(program = promotionProgram, manifest = ownershipManifest) {
  if (program?.schemaVersion !== "p0-data-promotions-v1") throw new TypeError("P0 data promotion schema is invalid");
  if (!Array.isArray(program.collections) || program.collections.length === 0) throw new TypeError("P0 data promotion requires collections");
  const names = new Set();
  const contracts = new Set();
  for (const item of program.collections) {
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(item.collection || "")) throw new TypeError("P0 collection name is invalid");
    if (names.has(item.collection) || contracts.has(item.contract)) throw new TypeError("P0 promotion entries must be unique");
    names.add(item.collection);
    contracts.add(item.contract);
    const policy = manifest.collections?.[item.collection];
    if (!policy || policy.owner !== item.owner || policy.classification !== item.classification) {
      throw new TypeError(`P0 collection policy mismatch: ${item.collection}`);
    }
    if (!Object.values(PROMOTION_PHASES).includes(item.phase)) {
      throw new TypeError(`P0 collection phase is invalid: ${item.collection}`);
    }
    const ownerReviewedLegacy = policy.ownerReview?.contract === "first-release-legacy-owner-review.v1";
    const failClosedLegacy = ownerReviewedLegacy
      && policy.writePolicy?.productionWriteAllowed === false
      && policy.writePolicy?.productionPromotionAllowed === false
      && policy.writePolicy?.migrationRequired === true;
    if (item.phase === PROMOTION_PHASES.REPOSITORY_PLAN_READY && !failClosedLegacy) {
      throw new TypeError(`repository-plan-ready requires a fail-closed owner-reviewed legacy policy: ${item.collection}`);
    }
    if (item.phase === PROMOTION_PHASES.PROMOTED && ownerReviewedLegacy) {
      throw new TypeError(`owner-reviewed legacy collection cannot be reported as promoted: ${item.collection}`);
    }
  }
  const counts = promotionPhaseCounts(program);
  if (counts.promotedP0 + counts.repositoryPlanReady !== counts.registeredContracts) {
    throw new TypeError("P0 promotion phases must classify every registered contract exactly once");
  }
  if (program.migrationContract?.requestPathDualWrite !== false || program.migrationContract?.productionCutoverAuthorized !== false) {
    throw new TypeError("P0 migration must remain outbox-based and non-authorizing");
  }
  return true;
}

module.exports = {
  PROMOTION_PHASES,
  promotionPhaseCounts,
  validatePromotionProgram
};
