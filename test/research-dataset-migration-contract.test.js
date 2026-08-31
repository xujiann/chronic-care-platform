"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const contract = require("../config/research-dataset-migration-contract.json");
const {
  buildResearchDatasetMigrationReadiness,
  validateResearchDatasetMigrationContract
} = require("../src/platform/data/research-dataset-migration-contract");
const {
  buildProductionReleaseScopeReport,
  loadDefaultAuthorities
} = require("../src/platform/governance/production-release-scope");
const {
  STATES,
  createMigrationRun
} = require("../src/platform/data/migration-control-center");

test("researchDatasets has one versioned, fail-closed first-release migration plan", () => {
  assert.equal(validateResearchDatasetMigrationContract(), true);
  const readiness = buildResearchDatasetMigrationReadiness();
  assert.deepEqual(readiness, {
    schemaVersion: "research-dataset-migration-readiness-v1",
    collection: "researchDatasets",
    contractId: "research.dataset-aggregate.v1",
    waveId: "wave-first-release-research",
    repositoryPlanReady: true,
    localExecutionAuthorized: false,
    localMigrationCandidate: false,
    productionWriteAllowed: false,
    productionPromotionAllowed: false,
    productionReady: false,
    remainingGates: contract.remainingGates,
    boundary: contract.boundary
  });

  const run = createMigrationRun({ runId: "research-datasets-rehearsal", waveId: readiness.waveId });
  assert.deepEqual(run.collections, ["compliantDataExports", "diseaseRegistryModels", "researchDatasets"]);
  assert.equal(run.state, STATES.PLANNED);
  assert.equal(run.productionReady, false);
  assert.equal(run.productionPrimary, false);
  assert.equal(run.cutoverAuthorized, false);
});

test("researchDatasets migration plan does not reduce the first-release production write blocker count", () => {
  const report = buildProductionReleaseScopeReport(loadDefaultAuthorities());
  assert.equal(report.ok, true);
  assert.equal(report.repositoryReview.collectionReviewRequired.length, 0);
  assert.equal(report.repositoryReview.collectionProductionWriteBlocked.length, 21);
  assert.equal(report.repositoryReview.collectionProductionWriteBlocked.includes("researchDatasets"), true);
  assert.equal(report.productionReady, false);
});

test("researchDatasets migration contract rejects promotion, dual writes and incomplete behavior evidence", () => {
  const promoted = structuredClone(contract);
  promoted.writePolicy.productionWriteAllowed = true;
  assert.throws(
    () => validateResearchDatasetMigrationContract(promoted),
    /migration controls must remain fail closed/
  );

  const dualWrite = structuredClone(contract);
  dualWrite.migration.requestPathDualWrite = true;
  assert.throws(
    () => validateResearchDatasetMigrationContract(dualWrite),
    /migration controls must remain fail closed/
  );

  const incompleteEvidence = structuredClone(contract);
  incompleteEvidence.endpointBehaviorEvidence.pop();
  assert.throws(
    () => validateResearchDatasetMigrationContract(incompleteEvidence),
    /endpoint evidence set is incomplete/
  );

  const forgedApiEvidence = structuredClone(require("../config/api-idempotency-evidence.json"));
  forgedApiEvidence.contracts.find((item) => item.key === "POST /api/research/datasets/:id/approval").productionReady = true;
  assert.throws(
    () => validateResearchDatasetMigrationContract(contract, { apiEvidence: forgedApiEvidence }),
    /endpoint behavior evidence is incomplete/
  );
});
