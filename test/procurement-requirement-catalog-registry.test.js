"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const defaultCatalog = require("../config/procurement-requirement-governance.json");
const { applyProcurementImportRegistration, buildEffectiveProcurementCatalog } = require("../src/platform/productization/procurement-requirement-catalog-registry");
const { buildProcurementRequirementGovernance } = require("../src/platform/productization/procurement-requirement-governance");

const USER = Object.freeze({ name: "catalog-reviewer", role: "commission" });
const NOW = "2026-09-02T10:00:00.000Z";

function artifact() {
  const document = structuredClone(defaultCatalog.documents[1]);
  document.id = "DOC-NEUTRAL-0003";
  document.seriesId = "SRC-000000000003";
  document.sourceAlias = "需求来源 000000000003";
  document.sha256 = `sha256:${"9".repeat(64)}`;
  document.candidates = [{ ...document.candidates[0], id: "PR-NEUTRAL-003-R001", logicalRequirementId: "REQ-000000000006", semanticDigest: `sha256:${"8".repeat(64)}` }];
  return {
    schemaVersion: "procurement-controlled-import-batch-v2",
    generatedAt: NOW,
    documents: [document],
    revisionComparisons: [],
    summary: { documents: 1, byteSize: document.byteSize, candidates: 1, reviewedPages: document.reviewedPageCount },
    productionReady: false,
    boundary: "sanitized"
  };
}

test("sanitized import artifacts register atomically and appear in the effective catalog", () => {
  const command = { commandId: "import-command-0001", expectedVersion: 0, artifact: artifact() };
  const execution = applyProcurementImportRegistration({}, command, USER, { now: NOW });
  assert.equal(execution.result.registeredDocuments, 1);
  assert.equal(execution.result.registeredCandidates, 1);
  assert.equal(execution.data.procurementRequirementCatalog.documents.length, 1);
  assert.equal(buildEffectiveProcurementCatalog(execution.data).documents.length, defaultCatalog.documents.length + 1);
  assert.equal(buildProcurementRequirementGovernance(execution.data, { now: NOW }).items.some((item) => item.logicalRequirementId === "REQ-000000000006"), true);
  assert.equal(JSON.stringify(execution.data).includes("path"), false);
  assert.equal(execution.result.productionReady, false);

  const importedRequirementId = artifact().documents[0].candidates[0].id;
  const reviewed = require("../src/platform/productization/procurement-requirement-governance").applyProcurementRequirementReviewAction(
    execution.data,
    { commandId: "review-imported-command-0001", requirementId: importedRequirementId, action: "accept", expectedVersion: 0, note: "人工确认已登记候选与当前证据绑定一致" },
    USER,
    { now: NOW }
  );
  assert.equal(reviewed.result.reviewStatus, "accepted");
});

test("registration exact replay is stable and changed intent fails", () => {
  const command = { commandId: "import-command-0002", expectedVersion: 0, artifact: artifact() };
  const first = applyProcurementImportRegistration({}, command, USER, { now: NOW });
  const replay = applyProcurementImportRegistration(first.data, command, USER, { now: NOW });
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.result, first.result);
  assert.equal(replay.data.procurementRequirementCatalog.events.length, 1);
  assert.throws(() => applyProcurementImportRegistration(first.data, { ...command, expectedVersion: 1 }, USER, { now: NOW }), (error) => error.code === "PROCUREMENT_IMPORT_REGISTRATION_COMMAND_CONFLICT");
});

test("registration rejects unsafe fields, duplicate documents and stale versions", () => {
  assert.throws(() => applyProcurementImportRegistration({}, { commandId: "import-command-0003", expectedVersion: 0, artifact: { ...artifact(), sourcePath: "C:/source.pdf" } }, USER), (error) => error.code === "PROCUREMENT_IMPORT_REGISTRATION_INPUT_INVALID");
  const first = applyProcurementImportRegistration({}, { commandId: "import-command-0004", expectedVersion: 0, artifact: artifact() }, USER);
  assert.throws(() => applyProcurementImportRegistration(first.data, { commandId: "import-command-0005", expectedVersion: 0, artifact: artifact() }, USER), (error) => error.code === "PROCUREMENT_IMPORT_REGISTRATION_VERSION_CONFLICT");
  assert.throws(() => applyProcurementImportRegistration(first.data, { commandId: "import-command-0006", expectedVersion: 1, artifact: artifact() }, USER), (error) => error.code === "PROCUREMENT_IMPORT_REGISTRATION_INPUT_INVALID");
});

test("registration never trusts a scanner-clean claim supplied by the client artifact", () => {
  const forged = artifact();
  forged.documents[0].securityStatus = "scanner-attested-clean";
  forged.documents[0].scanEvidenceDigest = `sha256:${"a".repeat(64)}`;
  assert.throws(
    () => applyProcurementImportRegistration({}, { commandId: "import-command-forged-scan", expectedVersion: 0, artifact: forged }, USER),
    (error) => error.code === "PROCUREMENT_IMPORT_REGISTRATION_INPUT_INVALID"
  );
});

test("catalog state rejects orphaned documents and altered receipts", () => {
  const command = { commandId: "import-command-state-integrity", expectedVersion: 0, artifact: artifact() };
  const first = applyProcurementImportRegistration({}, command, USER, { now: NOW });

  const orphaned = structuredClone(first.data);
  orphaned.procurementRequirementCatalog.commands = [];
  assert.throws(() => buildEffectiveProcurementCatalog(orphaned), /catalog state is invalid/);

  const altered = structuredClone(first.data);
  altered.procurementRequirementCatalog.events[0].artifactDigest = `sha256:${"b".repeat(64)}`;
  assert.throws(() => buildEffectiveProcurementCatalog(altered), /catalog state is invalid/);
});
