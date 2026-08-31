"use strict";

const fs = require("node:fs");
const path = require("node:path");

const defaultContract = require("../../../config/research-dataset-migration-contract.json");
const defaultOwnership = require("../../../config/domain-data-ownership.json");
const defaultPromotions = require("../../../config/p0-data-promotions.json");
const defaultMigrationProgram = require("../../../config/data-migration-program.json");
const defaultApiEvidence = require("../../../config/api-idempotency-evidence.json");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const EXPECTED_ENDPOINTS = Object.freeze([
  "POST /api/research/datasets/:id/approval",
  "POST /api/research/datasets/:id/compliant-exports",
  "POST /api/research/datasets/:id/evidence",
  "POST /api/research/datasets/:id/outcomes",
  "POST /api/research/datasets/:id/sandbox-access"
]);

function sameMembers(left, right) {
  return JSON.stringify([...(left || [])].sort()) === JSON.stringify([...(right || [])].sort());
}

function validateResearchDatasetMigrationContract(contract = defaultContract, options = {}) {
  const ownership = options.ownership || defaultOwnership;
  const promotions = options.promotions || defaultPromotions;
  const migrationProgram = options.migrationProgram || defaultMigrationProgram;
  const apiEvidence = options.apiEvidence || defaultApiEvidence;
  const root = options.root || ROOT;

  if (contract?.schemaVersion !== "research-dataset-migration-contract-v1"
    || contract.contractId !== "research.dataset-aggregate.v1"
    || contract.scopeId !== "priority-eight-applications-v1"
    || contract.collection !== "researchDatasets"
    || contract.owner !== "research"
    || contract.process !== "T09"
    || contract.integrationOwner !== "T00"
    || contract.classification !== "de-identified") {
    throw new TypeError("research dataset migration identity is invalid");
  }

  const ownerPolicy = ownership.collections?.researchDatasets;
  if (ownerPolicy?.owner !== contract.owner
    || ownerPolicy.classification !== contract.classification
    || ownerPolicy.ownerReview?.contract !== contract.source?.ownerReviewContract
    || ownerPolicy.writePolicy?.productionWriteAllowed !== false
    || ownerPolicy.writePolicy?.productionPromotionAllowed !== false
    || ownerPolicy.writePolicy?.migrationRequired !== true) {
    throw new TypeError("research dataset owner review must remain fail closed");
  }

  const promotion = (promotions.collections || []).find((item) => item.collection === contract.collection);
  if (promotion?.owner !== contract.owner
    || promotion.classification !== contract.classification
    || promotion.contract !== contract.contractId
    || promotion.phase !== "repository-plan-ready"
    || promotions.migrationContract?.requestPathDualWrite !== false
    || promotions.migrationContract?.productionCutoverAuthorized !== false) {
    throw new TypeError("research dataset versioned promotion contract is missing or unsafe");
  }

  const wave = (migrationProgram.waves || []).find((item) => item.id === contract.migration?.waveId);
  if (!wave
    || !sameMembers(wave.collections, [contract.collection])
    || migrationProgram.mode !== contract.migration.mode
    || migrationProgram.requestPathDualWrite !== false
    || migrationProgram.productionCutoverAuthorized !== false) {
    throw new TypeError("research dataset migration wave is missing or unsafe");
  }

  const write = contract.writeContract || {};
  if (write.commandContract !== "research-dataset-write-command.v1"
    || write.aggregateIdField !== "id"
    || write.aggregateVersionField !== "domainVersion"
    || write.commandReceiptField !== "commandReceipts"
    || write.maximumCommandReceipts !== 100
    || write.compareAndSwapRequired !== true
    || write.actorScopedIdempotencyRequired !== true
    || write.exactReplayMustBeZeroWrite !== true
    || !sameMembers(write.atomicAuditCollections, ["dataAccessLogs"])
    || !sameMembers(write.conditionalSideEffects, ["compliantDataExports"])) {
    throw new TypeError("research dataset write contract is incomplete");
  }

  const evidenceByKey = new Map((apiEvidence.contracts || []).map((item) => [item.key, item]));
  if (!sameMembers(contract.endpointBehaviorEvidence, EXPECTED_ENDPOINTS)) {
    throw new TypeError("research dataset endpoint evidence set is incomplete");
  }
  for (const key of EXPECTED_ENDPOINTS) {
    const evidence = evidenceByKey.get(key);
    if (!evidence
      || evidence.owner !== "T09"
      || evidence.domain !== "research"
      || evidence.coverage?.level !== "endpoint"
      || evidence.concurrency?.cas?.required !== true
      || evidence.idempotency?.distributedExactlyOnceClaimed !== false
      || evidence.productionReady !== false
      || evidence.externalEvidenceRequired !== true) {
      throw new TypeError(`research dataset endpoint behavior evidence is incomplete: ${key}`);
    }
  }

  const target = contract.target || {};
  if (target.engine !== "postgresql"
    || target.schemaSource !== "deploy/postgres-primary-storage-schema.sql"
    || target.table !== "health_platform.primary_collection_state"
    || target.selector !== "collection_name=researchDatasets"
    || target.physicalSchemaChange !== false
    || target.newSqlMigrationRequired !== false) {
    throw new TypeError("research dataset PostgreSQL target is invalid");
  }
  const targetSource = fs.readFileSync(path.join(root, target.schemaSource), "utf8");
  if (!targetSource.includes("CREATE TABLE IF NOT EXISTS health_platform.primary_collection_state")) {
    throw new TypeError("research dataset PostgreSQL target schema is unavailable");
  }
  const sqliteSource = fs.readFileSync(path.join(root, "src/platform/storage/sqlite-migrations.js"), "utf8");
  if (contract.source?.logicalStore !== "state_collections"
    || contract.source.collectionName !== contract.collection
    || contract.source.sqliteProjection !== "research_dataset_records"
    || !sqliteSource.includes("CREATE TABLE IF NOT EXISTS research_dataset_records")) {
    throw new TypeError("research dataset source projection is unavailable");
  }

  const reconciliation = contract.migration?.reconciliation || {};
  const rollback = contract.migration?.rollback || {};
  if (contract.migration?.requestPathDualWrite !== false
    || reconciliation.requireExactCounts !== true
    || reconciliation.allowedMismatchCount !== 0
    || reconciliation.allowedDuplicateCount !== 0
    || reconciliation.requireMatchingDigest !== true
    || reconciliation.requireOutboxCheckpoint !== true
    || rollback.minimumIndependentApprovals < 2
    || !sameMembers(rollback.requiredApprovalRoles, ["data-owner", "release-manager"])
    || contract.migration.repositoryPlanReady !== true
    || contract.migration.localExecutionAuthorized !== false
    || contract.migration.productionCutoverAuthorized !== false
    || contract.writePolicy?.productionWriteAllowed !== false
    || contract.writePolicy?.productionPromotionAllowed !== false
    || contract.writePolicy?.externalEvidenceRequired !== true
    || contract.productionReady !== false
    || !Array.isArray(contract.remainingGates)
    || contract.remainingGates.length === 0) {
    throw new TypeError("research dataset migration controls must remain fail closed");
  }
  return true;
}

function buildResearchDatasetMigrationReadiness(options = {}) {
  const contract = options.contract || defaultContract;
  validateResearchDatasetMigrationContract(contract, options);
  return Object.freeze({
    schemaVersion: "research-dataset-migration-readiness-v1",
    collection: contract.collection,
    contractId: contract.contractId,
    waveId: contract.migration.waveId,
    repositoryPlanReady: true,
    localExecutionAuthorized: false,
    localMigrationCandidate: false,
    productionWriteAllowed: false,
    productionPromotionAllowed: false,
    productionReady: false,
    remainingGates: Object.freeze([...contract.remainingGates]),
    boundary: contract.boundary
  });
}

module.exports = {
  EXPECTED_ENDPOINTS,
  buildResearchDatasetMigrationReadiness,
  validateResearchDatasetMigrationContract
};
