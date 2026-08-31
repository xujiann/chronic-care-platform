"use strict";

const ownershipManifest = require("../../../config/domain-data-ownership.json");
const promotionProgram = require("../../../config/p0-data-promotions.json");
const { buildCollectionGovernanceInventory } = require("../data/collection-governance");
const { promotionPhaseCounts, validatePromotionProgram } = require("../data/promotion-contract");

function buildDataPromotionCenter(data, options = {}) {
  const program = options.program || promotionProgram;
  const manifest = options.manifest || ownershipManifest;
  validatePromotionProgram(program, manifest);
  const inventory = buildCollectionGovernanceInventory(data, manifest);
  const collections = program.collections.map((item) => Object.freeze({
    collection: item.collection,
    owner: item.owner,
    classification: item.classification,
    contract: item.contract,
    phase: item.phase,
    records: Array.isArray(data[item.collection]) ? data[item.collection].length : 0,
    registered: Boolean(manifest.collections?.[item.collection]),
    migrationMode: program.migrationContract.mode,
    productionCutoverAuthorized: false
  }));
  const phases = promotionPhaseCounts(program);
  const checks = Object.freeze([
    { id: "dataPromotion:registered", passed: collections.every((item) => item.registered), detail: `${collections.filter((item) => item.registered).length}/${collections.length}` },
    { id: "dataPromotion:contracts", passed: collections.every((item) => item.contract.endsWith(".v1")), detail: `${collections.length} versioned contracts` },
    { id: "dataPromotion:phases", passed: phases.promotedP0 + phases.repositoryPlanReady === phases.registeredContracts, detail: `${phases.promotedP0} promoted / ${phases.repositoryPlanReady} repository plan-ready` },
    { id: "dataPromotion:noRequestDualWrite", passed: program.migrationContract.requestPathDualWrite === false, detail: program.migrationContract.mode },
    { id: "dataPromotion:inventory", passed: inventory.ok, detail: `${inventory.summary.authoritative} authoritative / ${inventory.summary.blockedLegacy} legacy blocked` }
  ]);
  return Object.freeze({
    schemaVersion: "data-promotion-center-v1",
    generatedAt: options.now || new Date().toISOString(),
    ok: checks.every((item) => item.passed),
    localGateReady: checks.every((item) => item.passed),
    productionReady: false,
    summary: Object.freeze({
      promotedP0: phases.promotedP0,
      repositoryPlanReady: phases.repositoryPlanReady,
      registeredContracts: phases.registeredContracts,
      authoritative: inventory.summary.authoritative,
      legacyBlocked: inventory.summary.blockedLegacy,
      totalCollections: inventory.summary.collections
    }),
    collections: Object.freeze(collections),
    migrationRequirements: Object.freeze([...program.migrationContract.requires]),
    checks,
    boundary: "Promoted and repository-plan-ready are distinct repository phases. Neither authorizes production migration, which still requires controlled rehearsal and independent review."
  });
}

module.exports = { buildDataPromotionCenter, validatePromotionProgram };
