"use strict";

const defaultManifest = require("../../../config/domain-data-ownership.json");
const defaultDisposition = require("../../../config/state-collection-governance.json");

const SYSTEM_COLLECTIONS = Object.freeze({
  dataAccessLogs: "platform-governance",
  platformProcessAudit: "platform-governance",
  securityEvents: "platform-governance"
});

const GOVERNANCE_STATUSES = Object.freeze([
  "owned-contract",
  "governed-system",
  "review-required",
  "legacy-quarantined"
]);

function collectionSize(value) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object") return Object.keys(value).length;
  return value == null ? 0 : 1;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeSourceEntries(entries = []) {
  if (!Array.isArray(entries)) throw new TypeError("source entries must be an array");
  const files = new Set();
  return entries.map((entry) => {
    const file = String(entry?.file || "").replaceAll("\\", "/").replace(/^\.\//, "");
    if (!file || files.has(file)) throw new TypeError(`source entry file must be unique: ${file || "(missing)"}`);
    if (typeof entry.source !== "string") throw new TypeError(`source entry must contain text: ${file}`);
    files.add(file);
    return Object.freeze({ file, source: entry.source, processOwner: String(entry.processOwner || "") });
  }).sort((left, right) => left.file.localeCompare(right.file));
}

function sourceUsageForCollection(name, sourceEntries) {
  const matcher = new RegExp(`(^|[^A-Za-z0-9_$-])${escapeRegExp(name)}([^A-Za-z0-9_$-]|$)`);
  const matches = sourceEntries.filter((entry) => matcher.test(entry.source));
  return Object.freeze({
    state: matches.length ? "source-referenced" : "seed-only",
    sourceFiles: Object.freeze(matches.map((entry) => entry.file)),
    sourceProcessOwners: Object.freeze([...new Set(matches.map((entry) => entry.processOwner).filter(Boolean))].sort()),
    ownerInferenceAllowed: false
  });
}

function normalizeConcept(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function coreConceptMatches(name, concepts = []) {
  const normalizedName = normalizeConcept(name);
  return Object.freeze(concepts.filter((concept) => {
    const normalized = normalizeConcept(concept);
    if (!normalized) return false;
    const variants = new Set([normalized, `${normalized}s`, `${normalized}es`]);
    if (normalized.endsWith("y")) variants.add(`${normalized.slice(0, -1)}ies`);
    return variants.has(normalizedName);
  }).sort());
}

function dispositionIndex(disposition = defaultDisposition) {
  if (disposition?.schemaVersion !== "state-collection-governance-v1") {
    throw new TypeError("state collection governance schema is invalid");
  }
  if (disposition.productionPromotionAllowed !== false || disposition.unknownCollectionPolicy !== "fail-closed") {
    throw new TypeError("state collection governance must fail closed");
  }
  const index = new Map();
  for (const [field, status] of [
    ["reviewRequired", "review-required"],
    ["legacyQuarantined", "legacy-quarantined"]
  ]) {
    if (!Array.isArray(disposition[field])) throw new TypeError(`${field} must be an array`);
    for (const name of disposition[field]) {
      if (!/^[A-Za-z][A-Za-z0-9]*$/.test(name || "")) throw new TypeError(`invalid governed collection: ${name}`);
      if (index.has(name)) throw new TypeError(`duplicate governed collection disposition: ${name}`);
      index.set(name, status);
    }
  }
  return index;
}

function validateManifest(manifest) {
  const nonOwning = new Set(manifest.nonOwningDomains || []);
  if (manifest.unregisteredCollectionPolicy?.productionWriteAllowed !== false) {
    throw new TypeError("unregistered collection policy must fail closed");
  }
  for (const [name, policy] of Object.entries(manifest.collections || {})) {
    if (!policy?.owner || nonOwning.has(policy.owner)) throw new TypeError(`invalid data owner: ${name}`);
    if (!Array.isArray(policy.readers)) throw new TypeError(`collection readers must be explicit: ${name}`);
    if (new Set(policy.readers).size !== policy.readers.length) throw new TypeError(`duplicate collection reader: ${name}`);
    if (policy.readers.some((reader) => reader === policy.owner)) throw new TypeError(`owner must not be duplicated as reader: ${name}`);
  }
}

function buildCollectionGovernanceInventory(data, manifest = defaultManifest, options = {}) {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new TypeError("data snapshot must be an object");
  validateManifest(manifest);
  const disposition = options.disposition || defaultDisposition;
  const dispositions = dispositionIndex(disposition);
  const sourceScanEnabled = Object.hasOwn(options, "sourceEntries");
  const sourceEntries = normalizeSourceEntries(options.sourceEntries || []);
  const concepts = Array.isArray(options.coreConcepts) ? options.coreConcepts : [];
  const names = Object.keys(data).sort();
  const collections = names.map((name) => {
    const policy = manifest.collections?.[name];
    const systemOwner = SYSTEM_COLLECTIONS[name];
    const usage = sourceUsageForCollection(name, sourceEntries);
    let governanceStatus;
    if (policy) governanceStatus = "owned-contract";
    else if (systemOwner) governanceStatus = "governed-system";
    else governanceStatus = dispositions.get(name) || "unclassified";
    const owner = policy?.owner || systemOwner || "";
    return Object.freeze({
      name,
      records: collectionSize(data[name]),
      kind: policy ? "authoritative-business" : systemOwner ? "governed-system" : manifest.unregisteredCollectionPolicy.classification,
      governanceStatus,
      owner,
      ownerSource: policy ? "domain-data-ownership" : systemOwner ? "system-collection-contract" : "unassigned",
      classification: policy?.classification || (systemOwner ? "internal" : manifest.unregisteredCollectionPolicy.classification),
      readers: Object.freeze([...(policy?.readers || [])]),
      productionWriteAllowed: Boolean(policy || systemOwner),
      productionPromotionAllowed: false,
      promotionRequired: !policy && !systemOwner,
      actualUsage: usage,
      coreConceptMatches: coreConceptMatches(name, concepts)
    });
  });
  const authoritative = collections.filter((item) => item.governanceStatus === "owned-contract").length;
  const governedSystem = collections.filter((item) => item.governanceStatus === "governed-system").length;
  const reviewRequired = collections.filter((item) => item.governanceStatus === "review-required").length;
  const legacyQuarantined = collections.filter((item) => item.governanceStatus === "legacy-quarantined").length;
  const unclassified = collections.filter((item) => !GOVERNANCE_STATUSES.includes(item.governanceStatus));
  const registeredInDisposition = [...dispositions.keys()];
  const staleDispositions = registeredInDisposition.filter((name) => !Object.hasOwn(data, name));
  const dispositionConflicts = registeredInDisposition.filter((name) => manifest.collections?.[name] || SYSTEM_COLLECTIONS[name]);
  const usageDrift = sourceScanEnabled ? collections.filter((item) => (
    (item.governanceStatus === "review-required" && item.actualUsage.state !== "source-referenced")
    || (item.governanceStatus === "legacy-quarantined" && item.actualUsage.state !== "seed-only")
  )) : [];
  const blockedLegacy = reviewRequired + legacyQuarantined;
  const checks = Object.freeze([
    { id: "collectionGovernance:completeInventory", passed: collections.length === names.length, detail: `${collections.length}/${names.length}` },
    { id: "collectionGovernance:uniqueNames", passed: new Set(names).size === names.length, detail: `${new Set(names).size}/${names.length}` },
    { id: "collectionGovernance:completeDisposition", passed: unclassified.length === 0, detail: `${collections.length - unclassified.length}/${collections.length}` },
    { id: "collectionGovernance:noStaleDisposition", passed: staleDispositions.length === 0, detail: `${staleDispositions.length} stale` },
    { id: "collectionGovernance:noDispositionOwnerConflict", passed: dispositionConflicts.length === 0, detail: `${dispositionConflicts.length} conflicts` },
    { id: "collectionGovernance:actualUsageStatus", passed: usageDrift.length === 0, detail: sourceScanEnabled ? `${usageDrift.length} drifted` : "not-scanned" },
    { id: "collectionGovernance:authoritativeOwners", passed: collections.filter((item) => item.productionWriteAllowed && !item.owner).length === 0, detail: `${authoritative + governedSystem} writable collections have owners` },
    { id: "collectionGovernance:unassignedOwnerIsExplicit", passed: collections.filter((item) => item.ownerSource === "unassigned" && !["review-required", "legacy-quarantined"].includes(item.governanceStatus)).length === 0, detail: `${blockedLegacy} explicitly unassigned` },
    { id: "collectionGovernance:legacyFailClosed", passed: collections.filter((item) => item.promotionRequired && (item.productionWriteAllowed || item.productionPromotionAllowed)).length === 0, detail: `${blockedLegacy} legacy collections blocked from production writes and promotion` },
    { id: "collectionGovernance:promotionFailClosed", passed: collections.every((item) => item.productionPromotionAllowed === false), detail: "repository evidence cannot authorize production promotion" },
    { id: "collectionGovernance:noFallbackWrite", passed: manifest.storagePolicy?.production?.fallbackWrite === false, detail: "production fallback writes disabled" }
  ]);
  return Object.freeze({
    schemaVersion: "data-collection-governance-v2",
    generatedAt: options.now || new Date().toISOString(),
    ok: checks.every((item) => item.passed),
    productionReady: false,
    productionPromotionAllowed: false,
    summary: Object.freeze({
      collections: collections.length,
      authoritative,
      governedSystem,
      reviewRequired,
      legacyQuarantined,
      blockedLegacy,
      classified: collections.length - unclassified.length,
      sourceReferenced: collections.filter((item) => item.actualUsage.state === "source-referenced").length,
      seedOnly: collections.filter((item) => item.actualUsage.state === "seed-only").length
    }),
    collections: Object.freeze(collections),
    promotionRequirements: Object.freeze([...(manifest.unregisteredCollectionPolicy.promotionRequires || [])]),
    checks,
    boundary: "Source ownership is evidence only and never infers a data owner. Review-required and legacy-quarantined collections cannot be promoted by repository checks."
  });
}

module.exports = {
  GOVERNANCE_STATUSES,
  SYSTEM_COLLECTIONS,
  buildCollectionGovernanceInventory,
  collectionSize,
  coreConceptMatches,
  dispositionIndex,
  normalizeSourceEntries,
  sourceUsageForCollection,
  validateManifest
};
