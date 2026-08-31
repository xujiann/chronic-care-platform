"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const governance = require("../scripts/documentation-fact-drift");

const repositoryState = governance.readRepositoryState();

function cloneRepositoryState() {
  return structuredClone(repositoryState);
}

function failed(report, id) {
  return report.checks.find((item) => item.id === id)?.passed === false;
}

test("current documentation facts are derived from machine authorities", () => {
  const state = cloneRepositoryState();
  const report = governance.buildReport(state);
  assert.equal(report.ok, true);
  assert.deepEqual(report.summary.apiCatalog, {
    entries: state.catalogSummary.entries,
    writeRoutes: state.catalogSummary.writeRoutes,
    behaviorProofRequired: state.catalogSummary.writeIdempotencyBehaviorProofRequired,
    reviewRequired: state.catalogSummary.reviewRequired
  });
  assert.deepEqual(report.summary.objectStorage, {
    decisionStatus: state.objectStorageReport.summary.decisionStatus,
    implementationAuthorized: state.objectStorageReport.implementationAuthorized,
    productionReady: state.objectStorageReport.productionReady
  });
  assert.deepEqual(report.summary.firstReleaseMigration, {
    persistentReferences: 20,
    derivedReadModels: 1,
    repositoryCriticalGaps: 0,
    productionReady: false
  });
});

test("API catalog count drift fails closed in every governed progress statement", () => {
  for (const [documentId, checkId] of [
    ["roadmap", "roadmap:apiCatalogFacts"],
    ["moduleMap", "moduleMap:apiCatalogFacts"]
  ]) {
    const state = cloneRepositoryState();
    const currentEntries = state.catalogSummary.entries;
    state.documents[documentId] = state.documents[documentId].replace(
      documentId === "roadmap" ? `v3 当前 ${currentEntries}` : `当前目录 ${currentEntries}`,
      documentId === "roadmap" ? `v3 当前 ${currentEntries - 1}` : `当前目录 ${currentEntries - 1}`
    );
    const report = governance.buildReport(state);
    assert.equal(report.ok, false, documentId);
    assert.equal(failed(report, checkId), true, documentId);
  }
});

test("API behavior-proof and review totals cannot be replaced with historical values", () => {
  const state = cloneRepositoryState();
  const proofRequired = state.catalogSummary.writeIdempotencyBehaviorProofRequired;
  const reviewRequired = state.catalogSummary.reviewRequired;
  state.documents.roadmap = state.documents.roadmap
    .replace(`${proofRequired} 个仍缺`, `${proofRequired - 1} 个仍缺`)
    .replace(`总复核为 ${reviewRequired}`, `总复核为 ${reviewRequired - 1}`);
  const report = governance.buildReport(state);
  assert.equal(report.ok, false);
  assert.equal(failed(report, "roadmap:apiCatalogFacts"), true);
});

test("current and historical API totals cannot coexist in one governed row", () => {
  const state = cloneRepositoryState();
  const currentEntries = state.catalogSummary.entries;
  const staleEntries = currentEntries - 1;
  state.documents.roadmap = state.documents.roadmap.replace(
    `v3 当前 ${currentEntries} 项`,
    `v3 当前 ${currentEntries} 项；v3 当前 ${staleEntries} 项（旧值）`
  );
  const report = governance.buildReport(state);
  assert.equal(report.ok, false);
  assert.equal(failed(report, "roadmap:apiCatalogFacts"), true);
});

test("repository Markdown and PDF totals are derived and cannot keep a historical count", () => {
  const state = cloneRepositoryState();
  const report = governance.buildReport(state);
  assert.deepEqual(report.summary.repositoryGovernance, {
    markdownTotal: state.repositoryGovernanceReport.markdown.total,
    pdfArtifacts: state.repositoryGovernanceReport.pdf.entries.length
  });

  state.documents.roadmap = state.documents.roadmap.replace(
    `${state.repositoryGovernanceReport.markdown.total} 份 Markdown 唯一分类`,
    `${state.repositoryGovernanceReport.markdown.total - 1} 份 Markdown 唯一分类`
  );
  const drifted = governance.buildReport(state);
  assert.equal(drifted.ok, false);
  assert.equal(failed(drifted, "roadmap:repositoryGovernanceFacts"), true);
});

test("duplicate governed rows and sections fail closed", () => {
  const duplicateRow = cloneRepositoryState();
  const roadmapApiRow = duplicateRow.documents.roadmap.split(/\r?\n/)
    .find((line) => line.includes("| 7C | 生产 API 机器目录 |"));
  duplicateRow.documents.roadmap += `\n${roadmapApiRow}\n`;
  let report = governance.buildReport(duplicateRow);
  assert.equal(report.ok, false);
  assert.equal(failed(report, "roadmap:apiCatalogFacts"), true);

  const duplicateSection = cloneRepositoryState();
  const sectionMatch = duplicateSection.documents.architecture.match(
    /## 已接受的对象存储 v2 方向[\s\S]*?(?=## 首批生产范围合同)/
  );
  assert.ok(sectionMatch);
  duplicateSection.documents.architecture += `\n${sectionMatch[0]}\n`;
  report = governance.buildReport(duplicateSection);
  assert.equal(report.ok, false);
  assert.equal(failed(report, "architecture:objectStorageAcceptedNoGo"), true);
});

test("object storage cannot regress from Accepted repository implementation to Proposed", () => {
  for (const [documentId, checkId] of [
    ["roadmap", "roadmap:objectStorageAcceptedNoGo"],
    ["architecture", "architecture:objectStorageAcceptedNoGo"],
    ["dependencyMap", "dependencyMap:objectStorageWorkerStatus"]
  ]) {
    const state = cloneRepositoryState();
    state.documents[documentId] = state.documents[documentId].replace(/Accepted/g, "Proposed");
    const report = governance.buildReport(state);
    assert.equal(report.ok, false, documentId);
    assert.equal(failed(report, checkId), true, documentId);
  }
});

test("Accepted and Proposed cannot coexist in a governed object storage statement", () => {
  const state = cloneRepositoryState();
  state.documents.roadmap = state.documents.roadmap.replace(
    "Accepted OBJ-ADR-002",
    "Accepted / Proposed OBJ-ADR-002"
  );
  const report = governance.buildReport(state);
  assert.equal(report.ok, false);
  assert.equal(failed(report, "roadmap:objectStorageAcceptedNoGo"), true);
});

test("MODULE_MAP object storage evidence must come from its unique governed row and section", () => {
  const state = cloneRepositoryState();
  state.documents.moduleMap = state.documents.moduleMap.replace(
    "记录 Accepted、v17/runtime/API 授权和 production promotion=false",
    "记录 Proposed、v17/runtime/API 未授权和 production promotion=false"
  );
  state.documents.moduleMap += "\n仓库其他位置记录 Accepted、v17/runtime/API 授权和 production promotion=false；外部 provider/KMS/WORM/扫描和现场证据仍 NO-GO。\n";
  const report = governance.buildReport(state);
  assert.equal(report.ok, false);
  assert.equal(failed(report, "moduleMap:objectStorageAcceptedNoGo"), true);
});

test("repository implementation facts cannot be used to claim object storage production readiness", () => {
  const state = cloneRepositoryState();
  state.objectStorageReport.productionReady = true;
  const report = governance.buildReport(state);
  assert.equal(report.ok, false);
  assert.equal(failed(report, "authority:objectStorageDecision"), true);
});

test("first-release migration plan counts and production boundary cannot drift in the roadmap", () => {
  const state = cloneRepositoryState();
  state.documents.roadmap = state.documents.roadmap
    .replace("20 个唯一持久化计划", "19 个唯一持久化计划")
    .replace("21 个引用仍无生产写资格", "21 个引用已有生产写资格");
  const report = governance.buildReport(state);
  assert.equal(report.ok, false);
  assert.equal(failed(report, "roadmap:firstReleaseMigrationPortfolio"), true);
});

test("ADR index cannot regress the accepted object-storage decision to Proposed", () => {
  const state = cloneRepositoryState();
  state.documents.adrIndex = state.documents.adrIndex.replace(
    /\| \[对象存储采用结构化元数据与耐久异步命令轨道 v2\][^\n]+/,
    (line) => line.replace("Accepted", "Proposed")
  );
  const report = governance.buildReport(state);
  assert.equal(report.ok, false);
  assert.equal(failed(report, "adrIndex:objectStorageAcceptedNoGo"), true);
});
