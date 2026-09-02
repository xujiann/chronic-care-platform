"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const manifest = require("../config/domain-data-ownership.json");
const {
  buildCollectionGovernanceInventory,
  coreConceptMatches,
  dispositionIndex,
  normalizeSourceEntries,
  ownerReviewDigest,
  validateManifest
} = require("../src/platform/data/collection-governance");
const { assertProductionWriteAccess } = require("../src/platform/data/domain-repository");
const {
  readRuntimeSourceEntries,
  renderMarkdown,
  run,
  trackedRuntimeSourceFiles
} = require("../scripts/data-collection-governance");

const ROOT = path.resolve(__dirname, "..");

function disposition(reviewRequired = [], legacyQuarantined = []) {
  return {
    schemaVersion: "state-collection-governance-v1",
    unknownCollectionPolicy: "fail-closed",
    productionPromotionAllowed: false,
    reviewRequired,
    legacyQuarantined
  };
}

test("collection inventory separates authoritative owner truth from source ownership evidence", () => {
  const report = buildCollectionGovernanceInventory({
    residents: [{ id: "resident-1" }],
    securityEvents: [],
    legacyOrders: [{ id: "legacy-1" }],
    dormantLegacy: []
  }, manifest, {
    disposition: disposition(["legacyOrders"], ["dormantLegacy"]),
    sourceEntries: [{
      file: "src/http/routes/care-coordination.js",
      source: "const value = state.legacyOrders;",
      processOwner: "T05"
    }],
    coreConcepts: ["Resident", "Account"],
    now: "2026-08-22T00:00:00.000Z"
  });

  assert.equal(report.ok, true);
  assert.deepEqual(report.summary, {
    collections: 4,
    ownerAssigned: 1,
    authoritative: 1,
    ownerReviewedLegacy: 0,
    governedSystem: 1,
    reviewRequired: 1,
    legacyQuarantined: 1,
    blockedLegacy: 2,
    unassignedLegacy: 2,
    classified: 4,
    sourceReferenced: 1,
    seedOnly: 3
  });
  assert.deepEqual(report.collections.find((item) => item.name === "residents").coreConceptMatches, ["Resident"]);
  assert.deepEqual(report.collections.find((item) => item.name === "securityEvents"), {
    name: "securityEvents",
    records: 0,
    kind: "governed-system",
    governanceStatus: "governed-system",
    owner: "platform-governance",
    ownerSource: "system-collection-contract",
    classification: "internal",
    readers: [],
    productionWriteAllowed: true,
    productionPromotionAllowed: false,
    promotionRequired: false,
    actualUsage: {
      state: "seed-only",
      sourceFiles: [],
      sourceProcessOwners: [],
      ownerInferenceAllowed: false
    },
    coreConceptMatches: []
  });
  const legacy = report.collections.find((item) => item.name === "legacyOrders");
  assert.equal(legacy.owner, "");
  assert.equal(legacy.ownerSource, "unassigned");
  assert.equal(legacy.governanceStatus, "review-required");
  assert.deepEqual(legacy.actualUsage.sourceProcessOwners, ["T05"]);
  assert.equal(legacy.actualUsage.ownerInferenceAllowed, false);
  assert.equal(legacy.productionWriteAllowed, false);
  assert.equal(legacy.productionPromotionAllowed, false);
  assert.equal(report.productionReady, false);
  assert.equal(report.productionPromotionAllowed, false);

  const markdown = renderMarkdown(report);
  assert.match(markdown, /Collections: 4/);
  assert.match(markdown, /legacyOrders: review-required; owner unassigned/);
  assert.match(markdown, /Production promotion: blocked/);
  assert.doesNotMatch(markdown, /undefined/);
});

test("complete disposition and actual static usage are fail-closed", () => {
  const missing = buildCollectionGovernanceInventory({ futureCollection: [] }, manifest, {
    disposition: disposition(),
    sourceEntries: []
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.collections[0].governanceStatus, "unclassified");
  assert.equal(missing.checks.find((item) => item.id === "collectionGovernance:completeDisposition").passed, false);

  const drifted = buildCollectionGovernanceInventory({ dormantLegacy: [] }, manifest, {
    disposition: disposition([], ["dormantLegacy"]),
    sourceEntries: [{ file: "server.js", source: "state.dormantLegacy", processOwner: "T00" }]
  });
  assert.equal(drifted.ok, false);
  assert.equal(drifted.checks.find((item) => item.id === "collectionGovernance:actualUsageStatus").passed, false);
  assert.equal(drifted.collections[0].productionPromotionAllowed, false);
});

test("disposition rejects duplicates, stale entries, owner conflicts, and permissive promotion", () => {
  assert.throws(
    () => dispositionIndex(disposition(["legacyOrders"], ["legacyOrders"])),
    /duplicate governed collection disposition/
  );
  assert.throws(
    () => dispositionIndex({ ...disposition(), productionPromotionAllowed: true }),
    /fail closed/
  );

  const stale = buildCollectionGovernanceInventory({ legacyOrders: [] }, manifest, {
    disposition: disposition(["legacyOrders", "removedLegacy"]),
    sourceEntries: [{ file: "server.js", source: "legacyOrders", processOwner: "T00" }]
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.checks.find((item) => item.id === "collectionGovernance:noStaleDisposition").passed, false);

  const ownerConflict = buildCollectionGovernanceInventory({ residents: [] }, manifest, {
    disposition: disposition(["residents"]),
    sourceEntries: []
  });
  assert.equal(ownerConflict.ok, false);
  assert.equal(ownerConflict.checks.find((item) => item.id === "collectionGovernance:noDispositionOwnerConflict").passed, false);
});

test("owner and shared boundaries reject non-owning domains and ambiguous readers", () => {
  const unsafeOwner = structuredClone(manifest);
  unsafeOwner.collections.residents.owner = "shared";
  assert.throws(
    () => buildCollectionGovernanceInventory({ residents: [] }, unsafeOwner, { disposition: disposition(), sourceEntries: [] }),
    /invalid data owner/
  );

  const duplicateReader = structuredClone(manifest);
  duplicateReader.collections.residents.readers.push("citizen-chronic");
  assert.throws(
    () => buildCollectionGovernanceInventory({ residents: [] }, duplicateReader, { disposition: disposition(), sourceEntries: [] }),
    /duplicate collection reader/
  );

  const ownerAsReader = structuredClone(manifest);
  ownerAsReader.collections.residents.readers.push("identity-security");
  assert.throws(
    () => buildCollectionGovernanceInventory({ residents: [] }, ownerAsReader, { disposition: disposition(), sourceEntries: [] }),
    /owner must not be duplicated as reader/
  );
});

test("source inventory is deterministic and excludes governance, fixtures, reports, and data", () => {
  assert.throws(
    () => normalizeSourceEntries([
      { file: "server.js", source: "one" },
      { file: "server.js", source: "two" }
    ]),
    /must be unique/
  );
  const files = trackedRuntimeSourceFiles(ROOT);
  assert.equal(files.includes("server.js"), true);
  assert.equal(files.some((file) => /^(?:config|data|docs|output|release|test)\//.test(file)), false);
  assert.equal(readRuntimeSourceEntries(ROOT).length, files.length);
  assert.deepEqual(coreConceptMatches("accounts", ["Resident", "Account"]), ["Account"]);
  assert.deepEqual(coreConceptMatches("personalRecords", ["HealthRecord"]), []);
});

test("repository inventory covers every current state collection and never authorizes promotion", () => {
  const report = run({ now: "2026-08-22T00:00:00.000Z" });
  assert.equal(report.ok, true);
  assert.equal(report.summary.collections, 252);
  assert.equal(Object.keys(manifest.collections).length, 112);
  assert.equal(report.summary.ownerAssigned, 80);
  assert.equal(report.summary.authoritative, 61);
  assert.equal(report.summary.ownerReviewedLegacy, 19);
  assert.equal(report.summary.governedSystem, 3);
  assert.equal(report.summary.reviewRequired, 168);
  assert.equal(report.summary.legacyQuarantined, 1);
  assert.equal(report.summary.unassignedLegacy, 169);
  assert.equal(report.summary.blockedLegacy, 188);
  assert.equal(report.summary.classified, 252);
  assert.equal(report.summary.sourceReferenced, 251);
  assert.equal(report.summary.seedOnly, 1);
  assert.equal(report.productionReady, false);
  assert.equal(report.productionPromotionAllowed, false);
  assert.equal(report.collections.every((item) => item.productionPromotionAllowed === false), true);
  assert.equal(report.collections.filter((item) => item.governanceStatus === "owner-reviewed-legacy").every((item) => (
    item.owner
    && item.productionWriteAllowed === false
    && item.promotionRequired === true
  )), true);
  assert.equal(report.collections.find((item) => item.name === "dalianHealthStatistics2025").governanceStatus, "legacy-quarantined");
});

test("first-release owner review is a frozen 19-collection decision without production promotion", () => {
  const batch = manifest.ownerReviewBatches.find((item) => item.id === "first-release-scope-20260826");
  assert.ok(batch);
  assert.equal(batch.collections.length, 19);
  assert.equal(ownerReviewDigest(manifest, batch.collections), batch.decisionDigest);
  assert.deepEqual(batch.collections, [...batch.collections].sort());

  const report = run({ now: "2026-08-26T00:00:00.000Z" });
  for (const collection of batch.collections) {
    const policy = manifest.collections[collection];
    const item = report.collections.find((candidate) => candidate.name === collection);
    assert.equal(policy.ownerReview.contract, "first-release-legacy-owner-review.v1", collection);
    assert.equal(policy.writePolicy.contract, "legacy-owner-review-write-policy.v1", collection);
    assert.equal(item.governanceStatus, "owner-reviewed-legacy", collection);
    assert.equal(item.productionWriteAllowed, false, collection);
    assert.equal(item.productionPromotionAllowed, false, collection);
    for (const evidence of policy.ownerReview.sourceEvidence) {
      const source = require("node:fs").readFileSync(path.join(ROOT, evidence.path), "utf8");
      assert.match(source, new RegExp(`\\b${collection}\\b`), `${collection}:${evidence.path}`);
    }
  }
});

test("owner-reviewed legacy collections reject missing or permissive write policies", () => {
  const missingPolicy = structuredClone(manifest);
  delete missingPolicy.collections.researchDatasets.writePolicy;
  assert.throws(
    () => validateManifest(missingPolicy),
    /explicit fail-closed write policy: researchDatasets/
  );

  const promoted = structuredClone(manifest);
  promoted.collections.researchDatasets.writePolicy.productionWriteAllowed = true;
  assert.throws(
    () => validateManifest(promoted),
    /explicit fail-closed write policy: researchDatasets/
  );

  assert.throws(
    () => assertProductionWriteAccess("research", "researchDatasets"),
    (error) => error.code === "PRODUCTION_WRITE_CONTRACT_REQUIRED"
  );
  assert.equal(assertProductionWriteAccess("citizen-chronic", "followups").owner, "citizen-chronic");
});

test("owner review digest rejects an incorrect owner or reader allowlist", () => {
  const wrongOwner = structuredClone(manifest);
  wrongOwner.collections.platformRoadmap.owner = "research";
  assert.throws(() => validateManifest(wrongOwner), /owner review decision digest mismatch/);

  const wrongReader = structuredClone(manifest);
  wrongReader.collections.platformRoadmap.readers.push("research");
  assert.throws(() => validateManifest(wrongReader), /owner review decision digest mismatch/);
});

test("collection inventory rejects a permissive legacy write policy", () => {
  const unsafe = structuredClone(manifest);
  unsafe.unregisteredCollectionPolicy.productionWriteAllowed = true;
  assert.throws(
    () => buildCollectionGovernanceInventory({ legacy: [] }, unsafe, {
      disposition: disposition(["legacy"]),
      sourceEntries: [{ file: "server.js", source: "legacy" }]
    }),
    /fail closed/
  );
});
