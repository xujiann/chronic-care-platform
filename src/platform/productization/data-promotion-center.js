"use strict";

const ownershipManifest = require("../../../config/domain-data-ownership.json");
const promotionProgram = require("../../../config/p0-data-promotions.json");
const { buildCollectionGovernanceInventory } = require("../data/collection-governance");

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
  }
  if (program.migrationContract?.requestPathDualWrite !== false || program.migrationContract?.productionCutoverAuthorized !== false) {
    throw new TypeError("P0 migration must remain outbox-based and non-authorizing");
  }
  return true;
}

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
    records: Array.isArray(data[item.collection]) ? data[item.collection].length : 0,
    registered: Boolean(manifest.collections?.[item.collection]),
    migrationMode: program.migrationContract.mode,
    productionCutoverAuthorized: false
  }));
  const checks = Object.freeze([
    { id: "dataPromotion:registered", passed: collections.every((item) => item.registered), detail: `${collections.filter((item) => item.registered).length}/${collections.length}` },
    { id: "dataPromotion:contracts", passed: collections.every((item) => item.contract.endsWith(".v1")), detail: `${collections.length} versioned contracts` },
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
      promotedP0: collections.length,
      authoritative: inventory.summary.authoritative,
      legacyBlocked: inventory.summary.blockedLegacy,
      totalCollections: inventory.summary.collections
    }),
    collections: Object.freeze(collections),
    migrationRequirements: Object.freeze([...program.migrationContract.requires]),
    checks,
    boundary: "Registration establishes authority contracts only; production migration still requires controlled rehearsal and independent review."
  });
}

module.exports = { buildDataPromotionCenter, validatePromotionProgram };
