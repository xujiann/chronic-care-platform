"use strict";

const defaultManifest = require("../../../config/domain-data-ownership.json");

const SYSTEM_COLLECTIONS = Object.freeze({
  dataAccessLogs: "platform-governance",
  platformProcessAudit: "platform-governance",
  securityEvents: "platform-governance"
});

function collectionSize(value) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object") return Object.keys(value).length;
  return value == null ? 0 : 1;
}

function buildCollectionGovernanceInventory(data, manifest = defaultManifest) {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new TypeError("data snapshot must be an object");
  const fallback = manifest.unregisteredCollectionPolicy;
  if (fallback?.productionWriteAllowed !== false) throw new TypeError("unregistered collection policy must fail closed");
  const collections = Object.keys(data).sort().map((name) => {
    const policy = manifest.collections?.[name];
    const systemOwner = SYSTEM_COLLECTIONS[name];
    if (policy) {
      return Object.freeze({
        name,
        records: collectionSize(data[name]),
        kind: "authoritative-business",
        owner: policy.owner,
        classification: policy.classification,
        readers: Object.freeze([...(policy.readers || [])]),
        productionWriteAllowed: true,
        promotionRequired: false
      });
    }
    if (systemOwner) {
      return Object.freeze({
        name,
        records: collectionSize(data[name]),
        kind: "governed-system",
        owner: systemOwner,
        classification: "internal",
        readers: Object.freeze([]),
        productionWriteAllowed: true,
        promotionRequired: false
      });
    }
    return Object.freeze({
      name,
      records: collectionSize(data[name]),
      kind: fallback.classification,
      owner: "",
      classification: fallback.classification,
      readers: Object.freeze([]),
      productionWriteAllowed: false,
      promotionRequired: true
    });
  });
  const authoritative = collections.filter((item) => item.kind === "authoritative-business").length;
  const governedSystem = collections.filter((item) => item.kind === "governed-system").length;
  const blockedLegacy = collections.filter((item) => item.promotionRequired).length;
  const checks = Object.freeze([
    { id: "collectionGovernance:completeInventory", passed: collections.length === Object.keys(data).length, detail: `${collections.length}/${Object.keys(data).length}` },
    { id: "collectionGovernance:authoritativeOwners", passed: collections.filter((item) => item.productionWriteAllowed && !item.owner).length === 0, detail: `${authoritative + governedSystem} writable collections have owners` },
    { id: "collectionGovernance:legacyFailClosed", passed: collections.filter((item) => item.promotionRequired && item.productionWriteAllowed).length === 0, detail: `${blockedLegacy} legacy collections blocked from production writes` },
    { id: "collectionGovernance:noFallbackWrite", passed: manifest.storagePolicy?.production?.fallbackWrite === false, detail: "production fallback writes disabled" }
  ]);
  return Object.freeze({
    schemaVersion: "data-collection-governance-v1",
    generatedAt: new Date().toISOString(),
    ok: checks.every((item) => item.passed),
    productionReady: false,
    summary: Object.freeze({ collections: collections.length, authoritative, governedSystem, blockedLegacy, classified: collections.length }),
    collections: Object.freeze(collections),
    promotionRequirements: Object.freeze([...(fallback.promotionRequires || [])]),
    checks,
    boundary: "Legacy collections remain readable for compatibility but cannot become production authorities without explicit promotion."
  });
}

module.exports = { SYSTEM_COLLECTIONS, buildCollectionGovernanceInventory, collectionSize };
