"use strict";

const { createHash } = require("node:crypto");

const defaultManifest = require("../../../config/domain-data-ownership.json");
const defaultDisposition = require("../../../config/state-collection-governance.json");

const SYSTEM_COLLECTIONS = Object.freeze({
  dataAccessLogs: "platform-governance",
  platformProcessAudit: "platform-governance",
  securityEvents: "platform-governance"
});

const GOVERNANCE_STATUSES = Object.freeze([
  "owned-contract",
  "owner-reviewed-legacy",
  "governed-system",
  "review-required",
  "legacy-quarantined"
]);

const LEGACY_OWNER_REVIEW_WRITE_CONTRACT = "legacy-owner-review-write-policy.v1";

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function ownerReviewDecision(policy) {
  return {
    owner: policy.owner,
    classification: policy.classification,
    readers: [...policy.readers].sort(),
    writePolicy: policy.writePolicy,
    ownerReview: policy.ownerReview
  };
}

function ownerReviewDigest(manifest, collections) {
  const decisions = collections.map((name) => ({
    collection: name,
    ...ownerReviewDecision(manifest.collections[name])
  }));
  return createHash("sha256").update(canonicalJson(decisions)).digest("hex");
}

function isOwnerReviewedLegacy(policy) {
  return policy?.ownerReview?.contract === "first-release-legacy-owner-review.v1";
}

function productionWriteAllowed(policy, systemOwner) {
  if (systemOwner) return true;
  if (!policy) return false;
  return policy.writePolicy?.productionWriteAllowed !== false;
}

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
  if (!manifest || typeof manifest !== "object") throw new TypeError("data ownership manifest is required");
  if (!/^1\.[12]\.0$/.test(String(manifest.schemaVersion || ""))) {
    throw new TypeError("data ownership manifest schema is invalid");
  }
  const nonOwning = new Set(manifest.nonOwningDomains || []);
  if (manifest.unregisteredCollectionPolicy?.productionWriteAllowed !== false) {
    throw new TypeError("unregistered collection policy must fail closed");
  }
  for (const [name, policy] of Object.entries(manifest.collections || {})) {
    if (!policy?.owner || nonOwning.has(policy.owner)) throw new TypeError(`invalid data owner: ${name}`);
    if (!/^[a-z][a-z0-9-]*$/.test(policy.owner)) throw new TypeError(`invalid data owner: ${name}`);
    if (!/^(?:restricted|internal|de-identified)$/.test(policy.classification || "")) {
      throw new TypeError(`invalid data classification: ${name}`);
    }
    if (!Array.isArray(policy.readers)) throw new TypeError(`collection readers must be explicit: ${name}`);
    if (new Set(policy.readers).size !== policy.readers.length) throw new TypeError(`duplicate collection reader: ${name}`);
    if (policy.readers.some((reader) => reader === policy.owner)) throw new TypeError(`owner must not be duplicated as reader: ${name}`);
    if (policy.readers.some((reader) => nonOwning.has(reader) || !/^[a-z][a-z0-9-]*$/.test(reader))) {
      throw new TypeError(`invalid collection reader: ${name}`);
    }
    if (isOwnerReviewedLegacy(policy)) {
      const writePolicy = policy.writePolicy;
      if (writePolicy?.contract !== LEGACY_OWNER_REVIEW_WRITE_CONTRACT
        || writePolicy.productionWriteAllowed !== false
        || writePolicy.productionPromotionAllowed !== false
        || writePolicy.migrationRequired !== true) {
        throw new TypeError(`owner-reviewed legacy collection requires an explicit fail-closed write policy: ${name}`);
      }
      const evidence = policy.ownerReview?.sourceEvidence;
      if (!Array.isArray(evidence) || evidence.length === 0) {
        throw new TypeError(`owner-reviewed legacy collection requires source evidence: ${name}`);
      }
      const paths = new Set();
      for (const item of evidence) {
        if (!item?.path || !["read", "write", "read-write", "compatibility-write"].includes(item.access)) {
          throw new TypeError(`invalid owner review source evidence: ${name}`);
        }
        if (paths.has(item.path)) throw new TypeError(`duplicate owner review source evidence: ${name}`);
        paths.add(item.path);
      }
    } else if (policy.writePolicy) {
      throw new TypeError(`write policy requires an owner review contract: ${name}`);
    }
  }
  const batches = manifest.ownerReviewBatches;
  if (manifest.schemaVersion === "1.2.0") {
    if (!Array.isArray(batches) || batches.length === 0) throw new TypeError("owner review batches are required");
    const assigned = new Set();
    for (const batch of batches) {
      if (batch?.contract !== "first-release-legacy-owner-review.v1"
        || !Array.isArray(batch.collections)
        || batch.collections.length === 0
        || !/^[a-f0-9]{64}$/.test(batch.decisionDigest || "")) {
        throw new TypeError("owner review batch is invalid");
      }
      if (new Set(batch.collections).size !== batch.collections.length) throw new TypeError("owner review batch collections must be unique");
      if ([...batch.collections].sort().join("\n") !== batch.collections.join("\n")) {
        throw new TypeError("owner review batch collections must be sorted");
      }
      for (const name of batch.collections) {
        if (assigned.has(name) || !isOwnerReviewedLegacy(manifest.collections?.[name])) {
          throw new TypeError(`owner review batch collection is invalid: ${name}`);
        }
        assigned.add(name);
      }
      if (ownerReviewDigest(manifest, batch.collections) !== batch.decisionDigest) {
        throw new TypeError(`owner review decision digest mismatch: ${batch.id || "unknown"}`);
      }
    }
    const reviewed = Object.entries(manifest.collections || {})
      .filter(([, policy]) => isOwnerReviewedLegacy(policy))
      .map(([name]) => name);
    if (reviewed.some((name) => !assigned.has(name)) || reviewed.length !== assigned.size) {
      throw new TypeError("owner-reviewed legacy collections must belong to exactly one batch");
    }
  }
  return true;
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
    if (policy && isOwnerReviewedLegacy(policy)) governanceStatus = "owner-reviewed-legacy";
    else if (policy) governanceStatus = "owned-contract";
    else if (systemOwner) governanceStatus = "governed-system";
    else governanceStatus = dispositions.get(name) || "unclassified";
    const owner = policy?.owner || systemOwner || "";
    return Object.freeze({
      name,
      records: collectionSize(data[name]),
      kind: policy ? (isOwnerReviewedLegacy(policy) ? "owner-assigned-legacy" : "authoritative-business") : systemOwner ? "governed-system" : manifest.unregisteredCollectionPolicy.classification,
      governanceStatus,
      owner,
      ownerSource: policy ? "domain-data-ownership" : systemOwner ? "system-collection-contract" : "unassigned",
      classification: policy?.classification || (systemOwner ? "internal" : manifest.unregisteredCollectionPolicy.classification),
      readers: Object.freeze([...(policy?.readers || [])]),
      productionWriteAllowed: productionWriteAllowed(policy, systemOwner),
      productionPromotionAllowed: false,
      promotionRequired: !productionWriteAllowed(policy, systemOwner),
      actualUsage: usage,
      coreConceptMatches: coreConceptMatches(name, concepts)
    });
  });
  const ownerAssigned = collections.filter((item) => ["owned-contract", "owner-reviewed-legacy"].includes(item.governanceStatus)).length;
  const authoritative = collections.filter((item) => item.governanceStatus === "owned-contract" && item.productionWriteAllowed).length;
  const ownerReviewedLegacy = collections.filter((item) => item.governanceStatus === "owner-reviewed-legacy").length;
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
  const ownerReviewEvidenceDrift = sourceScanEnabled ? collections.filter((item) => {
    const policy = manifest.collections?.[item.name];
    if (!isOwnerReviewedLegacy(policy)) return false;
    return policy.ownerReview.sourceEvidence.some((evidence) => !item.actualUsage.sourceFiles.includes(evidence.path));
  }) : [];
  const unassignedLegacy = reviewRequired + legacyQuarantined;
  const blockedLegacy = ownerReviewedLegacy + unassignedLegacy;
  const checks = Object.freeze([
    { id: "collectionGovernance:completeInventory", passed: collections.length === names.length, detail: `${collections.length}/${names.length}` },
    { id: "collectionGovernance:uniqueNames", passed: new Set(names).size === names.length, detail: `${new Set(names).size}/${names.length}` },
    { id: "collectionGovernance:completeDisposition", passed: unclassified.length === 0, detail: `${collections.length - unclassified.length}/${collections.length}` },
    { id: "collectionGovernance:noStaleDisposition", passed: staleDispositions.length === 0, detail: `${staleDispositions.length} stale` },
    { id: "collectionGovernance:noDispositionOwnerConflict", passed: dispositionConflicts.length === 0, detail: `${dispositionConflicts.length} conflicts` },
    { id: "collectionGovernance:actualUsageStatus", passed: usageDrift.length === 0, detail: sourceScanEnabled ? `${usageDrift.length} drifted` : "not-scanned" },
    { id: "collectionGovernance:ownerReviewEvidence", passed: ownerReviewEvidenceDrift.length === 0, detail: sourceScanEnabled ? `${ownerReviewEvidenceDrift.length} drifted` : "not-scanned" },
    { id: "collectionGovernance:authoritativeOwners", passed: collections.filter((item) => item.productionWriteAllowed && !item.owner).length === 0, detail: `${authoritative + governedSystem} writable collections have owners` },
    { id: "collectionGovernance:unassignedOwnerIsExplicit", passed: collections.filter((item) => item.ownerSource === "unassigned" && !["review-required", "legacy-quarantined"].includes(item.governanceStatus)).length === 0, detail: `${unassignedLegacy} explicitly unassigned` },
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
      ownerAssigned,
      authoritative,
      ownerReviewedLegacy,
      governedSystem,
      reviewRequired,
      legacyQuarantined,
      blockedLegacy,
      unassignedLegacy,
      classified: collections.length - unclassified.length,
      sourceReferenced: collections.filter((item) => item.actualUsage.state === "source-referenced").length,
      seedOnly: collections.filter((item) => item.actualUsage.state === "seed-only").length
    }),
    collections: Object.freeze(collections),
    promotionRequirements: Object.freeze([...(manifest.unregisteredCollectionPolicy.promotionRequires || [])]),
    checks,
    boundary: "Source ownership is evidence only and never infers a data owner. Owner-reviewed legacy, review-required and legacy-quarantined collections remain blocked from production writes or promotion until a versioned write contract, migration and external evidence exist."
  });
}

module.exports = {
  GOVERNANCE_STATUSES,
  SYSTEM_COLLECTIONS,
  LEGACY_OWNER_REVIEW_WRITE_CONTRACT,
  buildCollectionGovernanceInventory,
  canonicalJson,
  collectionSize,
  coreConceptMatches,
  dispositionIndex,
  isOwnerReviewedLegacy,
  normalizeSourceEntries,
  ownerReviewDigest,
  productionWriteAllowed,
  sourceUsageForCollection,
  validateManifest
};
