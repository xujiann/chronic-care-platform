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
  assert.equal(report.summary.documents, 11);
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
  assert.deepEqual(report.summary.sqliteSchema, {
    head: state.sqliteSchemaFacts.head,
    tables: state.sqliteSchemaFacts.tableCount
  });
  assert.deepEqual(report.summary.e2e, state.e2eFacts);
  assert.deepEqual(report.summary.firstReleaseScope, {
    status: "FROZEN-NO-GO",
    apiReviewRequired: 0,
    collectionReviewRequired: 0,
    repositoryPlanMissing: 0,
    productionReady: false
  });
  assert.deepEqual(report.summary.techDebt, {
    tableIds: governance.techDebtTableIds(state.documents.techDebt).length,
    duplicateIds: [],
    lifecycleTaskIdConflicts: [],
    governedDocumentIdConflicts: []
  });
});

test("TECH_DEBT table ids remain unique and separate from lifecycle task ids", () => {
  const duplicate = cloneRepositoryState();
  duplicate.documents.techDebt = duplicate.documents.techDebt.replace("| ARC-003 |", "| ARC-001 |");
  let report = governance.buildReport(duplicate);
  assert.equal(report.ok, false);
  assert.equal(failed(report, "techDebt:uniqueTableIds"), true);

  const conflict = cloneRepositoryState();
  conflict.documents.techDebt = conflict.documents.techDebt.replace("| ARC-001 |", "| GOV-002 |");
  report = governance.buildReport(conflict);
  assert.equal(report.ok, false);
  assert.equal(failed(report, "techDebt:lifecycleTaskIdNamespace"), true);

  const governedDocumentConflict = cloneRepositoryState();
  governedDocumentConflict.governedMarkdownDefinitions.push({
    id: "TEST-COVERAGE-001",
    path: "docs/another-governance-plan.md"
  });
  report = governance.buildReport(governedDocumentConflict);
  assert.equal(report.ok, false);
  assert.equal(failed(report, "techDebt:governedDocumentIdNamespace"), true);
});

test("current E2E partition facts fail closed against the declared Playwright inventory", () => {
  const root = repositoryState.e2eFacts.root;
  for (const [documentId, checkId, marker] of [
    ["roadmap", "roadmap:e2eFacts", `在线根 ${root} + 居民`],
    ["engineeringGovernance", "engineeringGovernance:e2eFacts", `在线根 ${root} 项`],
    ["currentArchitecture", "currentArchitecture:e2eFacts", `当前根 ${root} + 居民`],
    ["moduleMap", "moduleMap:e2eFacts", `在线根 ${root} 项`],
    ["dataModel", "dataModel:e2eFacts", `根 ${root} 项和居民`],
    ["apiMap", "apiMap:e2eFacts", `根 ${root} 项与居民`],
    ["dependencyMap", "dependencyMap:e2eFacts", `root runner(${root})`],
    ["adrIndex", "adrIndex:e2eFacts", `当前根 ${root} +`],
    ["e2eAdr", "e2eAdr:currentFacts", `当前机器清单为根 ${root} 项`]
  ]) {
    const state = cloneRepositoryState();
    state.documents[documentId] = state.documents[documentId].replace(marker, marker.replace(String(root), String(root - 1)));
    const report = governance.buildReport(state);
    assert.equal(report.ok, false, documentId);
    assert.equal(failed(report, checkId), true, documentId);
  }
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
    markdownCurrent: state.repositoryGovernanceReport.markdown.byClassification.current.count,
    markdownSnapshot: state.repositoryGovernanceReport.markdown.byClassification.snapshot.count,
    markdownSuperseded: state.repositoryGovernanceReport.markdown.byClassification.superseded.count,
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

test("SQLite head and table facts cannot drift in the current data model", () => {
  const state = cloneRepositoryState();
  const head = state.sqliteSchemaFacts.head;
  const tableCount = state.sqliteSchemaFacts.tableCount;
  state.documents.dataModel = state.documents.dataModel
    .replace(`当前实际与公开 head 均为 v${head}`, `当前实际与公开 head 均为 v${head - 1}`)
    .replace(`创建 ${tableCount} 张表`, `创建 ${tableCount - 1} 张表`);
  const report = governance.buildReport(state);
  assert.equal(report.ok, false);
  assert.equal(failed(report, "dataModel:sqliteSchemaFacts"), true);
});

test("SQLite migration progress cannot retain the previous schema head", () => {
  const state = cloneRepositoryState();
  const head = state.sqliteSchemaFacts.head;
  state.documents.dataModel = state.documents.dataModel
    .replace(`当前为 ${head}`, `当前为 ${head - 1}`)
    .replace(`空库 0→${head}`, `空库 0→${head - 1}`);
  const report = governance.buildReport(state);
  assert.equal(report.ok, false);
  assert.equal(failed(report, "dataModel:migrationFacts"), true);
});

test("API map current review totals and first-release review state fail closed on drift", () => {
  const state = cloneRepositoryState();
  state.documents.apiMap = state.documents.apiMap
    .replaceAll(`总 \`review-required\` 为 ${state.catalogSummary.reviewRequired}`, `总 \`review-required\` 为 ${state.catalogSummary.reviewRequired - 1}`)
    .replaceAll("当前 `apiReviewRequired=0`", "当前 `apiReviewRequired=17`");
  const report = governance.buildReport(state);
  assert.equal(report.ok, false);
  assert.equal(failed(report, "apiMap:currentMachineFacts"), true);
  assert.equal(failed(report, "apiMap:firstReleaseScopeFacts"), true);
});

test("current Markdown classification facts fail closed in all governed maps", () => {
  const markdownTotal = repositoryState.repositoryGovernanceReport.markdown.total;
  for (const [documentId, checkId, prefix] of [
    ["currentArchitecture", "currentArchitecture:repositoryGovernanceFacts", "当前闭集为"],
    ["moduleMap", "moduleMap:repositoryGovernanceFacts", "锁定当前"],
    ["techDebt", "techDebt:repositoryGovernanceFacts", "当前"]
  ]) {
    const state = cloneRepositoryState();
    const currentText = `${prefix} ${markdownTotal} 份 Markdown`;
    state.documents[documentId] = state.documents[documentId].replace(
      currentText,
      `${prefix} ${markdownTotal - 1} 份 Markdown`
    );
    const report = governance.buildReport(state);
    assert.equal(report.ok, false, documentId);
    assert.equal(failed(report, checkId), true, documentId);
  }
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

test("TEST033 SQLite document facts reject four independent numeric drifts", () => {
  const head = repositoryState.sqliteSchemaFacts.head;
  const tables = repositoryState.sqliteSchemaFacts.tableCount;
  const scenarios = [
    ["schema head", "## 2. SQLite Schema", "### 关系主链", `当前实际与公开 head 均为 v${head}`, `当前实际与公开 head 均为 v${head - 1}`, "dataModel:sqliteSchemaFacts"],
    ["table count", "## 2. SQLite Schema", "### 关系主链", `创建 ${tables} 张表`, `创建 ${tables - 1} 张表`, "dataModel:sqliteSchemaFacts"],
    ["migration version", "## 3. Migration 现状", "## 4. JSON 集合与实际使用", `当前为 ${head}`, `当前为 ${head - 1}`, "dataModel:migrationFacts"],
    ["empty migration target", "## 3. Migration 现状", "## 4. JSON 集合与实际使用", `空库 0→${head}`, `空库 0→${head - 1}`, "dataModel:migrationFacts"]
  ];
  assert.equal(scenarios.length, 4);
  for (const [label, heading, nextHeading, original, changed, checkId] of scenarios) {
    const state = cloneRepositoryState();
    const baseline = governance.buildReport(state);
    assert.equal(baseline.ok, true, label);
    assert.deepEqual(baseline.checks.filter((item) => item.id === checkId).map((item) => item.passed), [true], label);
    const source = state.documents.dataModel;
    const lines = [...source.matchAll(/^.*$/gm)];
    const starts = lines.filter((line) => line[0].trim() === heading);
    const ends = lines.filter((line) => line[0].trim() === nextHeading);
    assert.equal(starts.length, 1, label);
    assert.equal(ends.length, 1, label);
    const start = starts[0].index;
    const end = ends[0].index;
    assert.ok(end > start, label);
    const section = source.slice(start, end);
    assert.notEqual(original, changed, label);
    assert.equal(section.split(original).length - 1, 1, label);
    const mutated = section.replace(original, changed);
    assert.notEqual(mutated, section, label);
    state.documents.dataModel = source.slice(0, start) + mutated + source.slice(end);
    const report = governance.buildReport(state);
    assert.equal(report.ok, false, label);
    assert.deepEqual(report.checks.filter((item) => item.id === checkId).map((item) => item.passed), [false], label);
    const restored = structuredClone(state);
    const actual = restored.documents.dataModel;
    assert.equal(actual.slice(0, start), source.slice(0, start), label);
    assert.equal(actual.slice(start + mutated.length), source.slice(end), label);
    const actualSection = actual.slice(start, start + mutated.length);
    assert.equal(actualSection.split(changed).length - 1, 1, label);
    restored.documents.dataModel = actual.slice(0, start) + actualSection.replace(changed, original) + actual.slice(start + mutated.length);
    assert.deepEqual(restored, repositoryState, label);
  }
});

test("TEST033 governed API rows reject six independent numeric drifts", () => {
  const writes = repositoryState.catalogSummary.writeRoutes;
  const proof = repositoryState.catalogSummary.writeIdempotencyBehaviorProofRequired;
  const review = repositoryState.catalogSummary.reviewRequired;
  const scenarios = [
    ["roadmap", "| 7C | 生产 API 机器目录 |", `${writes} 个写接口`, `${writes - 1} 个写接口`, "roadmap:apiCatalogFacts"],
    ["roadmap", "| 7C | 生产 API 机器目录 |", `${proof} 个仍缺 endpoint 级证明`, `${proof - 1} 个仍缺 endpoint 级证明`, "roadmap:apiCatalogFacts"],
    ["roadmap", "| 7C | 生产 API 机器目录 |", `总复核为 ${review}`, `总复核为 ${review - 1}`, "roadmap:apiCatalogFacts"],
    ["moduleMap", "| API 生产目录 |", `${writes} 个写接口`, `${writes - 1} 个写接口`, "moduleMap:apiCatalogFacts"],
    ["moduleMap", "| API 生产目录 |", `${proof} 个仍缺 endpoint 级行为证明`, `${proof - 1} 个仍缺 endpoint 级行为证明`, "moduleMap:apiCatalogFacts"],
    ["moduleMap", "| API 生产目录 |", `使 ${review} 项保持复核`, `使 ${review - 1} 项保持复核`, "moduleMap:apiCatalogFacts"]
  ];
  assert.equal(scenarios.length, 6);
  for (const [documentId, marker, original, changed, checkId] of scenarios) {
    const label = documentId + ":" + original;
    const state = cloneRepositoryState();
    const baseline = governance.buildReport(state);
    assert.equal(baseline.ok, true, label);
    assert.deepEqual(baseline.checks.filter((item) => item.id === checkId).map((item) => item.passed), [true], label);
    const source = state.documents[documentId];
    const matches = [...source.matchAll(/^.*$/gm)].filter((line) => line[0].includes(marker));
    assert.equal(matches.length, 1, label);
    const start = matches[0].index;
    const row = matches[0][0];
    assert.notEqual(original, changed, label);
    assert.equal(row.split(original).length - 1, 1, label);
    const mutated = row.replace(original, changed);
    assert.notEqual(mutated, row, label);
    state.documents[documentId] = source.slice(0, start) + mutated + source.slice(start + row.length);
    const report = governance.buildReport(state);
    assert.equal(report.ok, false, label);
    assert.deepEqual(report.checks.filter((item) => item.id === checkId).map((item) => item.passed), [false], label);
    const restored = structuredClone(state);
    const actual = restored.documents[documentId];
    assert.equal(actual.slice(0, start), source.slice(0, start), label);
    assert.equal(actual.slice(start + mutated.length), source.slice(start + row.length), label);
    const actualRow = actual.slice(start, start + mutated.length);
    assert.equal(actualRow.split(changed).length - 1, 1, label);
    restored.documents[documentId] = actual.slice(0, start) + actualRow.replace(changed, original) + actual.slice(start + mutated.length);
    assert.deepEqual(restored, repositoryState, label);
  }
});

test("TEST033 object storage authority rejects three independent field changes", () => {
  const scenarios = [
    [["ok"], true, false],
    [["summary", "decisionStatus"], "accepted", "proposed"],
    [["implementationAuthorized"], true, false]
  ];
  assert.equal(scenarios.length, 3);
  for (const [fields, expected, changed] of scenarios) {
    const label = fields.join(".");
    const state = cloneRepositoryState();
    const baseline = governance.buildReport(state);
    assert.equal(baseline.ok, true, label);
    assert.deepEqual(baseline.checks.filter((item) => item.id === "authority:objectStorageDecision").map((item) => item.passed), [true], label);
    const parent = fields.slice(0, -1).reduce((value, field) => value[field], state.objectStorageReport);
    const field = fields.at(-1);
    assert.equal(parent[field], expected, label);
    assert.notEqual(expected, changed, label);
    parent[field] = changed;
    const report = governance.buildReport(state);
    assert.equal(report.ok, false, label);
    assert.deepEqual(report.checks.filter((item) => item.id === "authority:objectStorageDecision").map((item) => item.passed), [false], label);
    const restored = structuredClone(state);
    const restoreParent = fields.slice(0, -1).reduce((value, key) => value[key], restored.objectStorageReport);
    assert.equal(restoreParent[field], changed, label);
    restoreParent[field] = expected;
    assert.deepEqual(restored, repositoryState, label);
  }
});

test("TEST033 first release authority rejects six independent field changes", () => {
  const scenarios = [
    [["ok"], true, false],
    [["status"], "FROZEN-NO-GO", "DRAFT"],
    [["productionReady"], false, true],
    [["repositoryReview", "apiReviewRequired"], [], ["synthetic-api-review"]],
    [["repositoryReview", "collectionReviewRequired"], [], ["synthetic-collection-review"]],
    [["repositoryReview", "collectionRepositoryPlanMissing"], [], ["synthetic-plan-gap"]]
  ];
  assert.equal(scenarios.length, 6);
  for (const [fields, expected, changed] of scenarios) {
    const label = fields.join(".");
    const state = cloneRepositoryState();
    const baseline = governance.buildReport(state);
    assert.equal(baseline.ok, true, label);
    assert.deepEqual(baseline.checks.filter((item) => item.id === "authority:firstReleaseScope").map((item) => item.passed), [true], label);
    const parent = fields.slice(0, -1).reduce((value, field) => value[field], state.productionReleaseScopeReport);
    const field = fields.at(-1);
    assert.deepEqual(parent[field], expected, label);
    assert.notDeepEqual(expected, changed, label);
    parent[field] = structuredClone(changed);
    const report = governance.buildReport(state);
    assert.equal(report.ok, false, label);
    assert.deepEqual(report.checks.filter((item) => item.id === "authority:firstReleaseScope").map((item) => item.passed), [false], label);
    const restored = structuredClone(state);
    const restoreParent = fields.slice(0, -1).reduce((value, key) => value[key], restored.productionReleaseScopeReport);
    assert.deepEqual(restoreParent[field], changed, label);
    restoreParent[field] = structuredClone(expected);
    assert.deepEqual(restored, repositoryState, label);
  }
});

test("TEST034 API authority rejects seven independent field changes", () => {
  const scenarios = [
    [["catalogSummary","entries"], repositoryState.catalogSummary.entries + 0.5],
    [["catalogSummary","writeRoutes"], String(repositoryState.catalogSummary.writeRoutes)],
    [["catalogSummary","writeRoutes"], 0],
    [["catalogSummary","writeIdempotencyBehaviorProofRequired"], -1],
    [["catalogSummary","reviewRequired"], repositoryState.catalogSummary.writeIdempotencyBehaviorProofRequired - 1],
    [["catalogSummary","productionNoGo"], repositoryState.catalogSummary.entries - 1],
    [["catalogErrors"], ["synthetic-catalog-error"]]
  ];
  assert.equal(scenarios.length, 7);
  for (const [fields, changed] of scenarios) {
    const label = fields.join(".") + ":" + JSON.stringify(changed);
    const state = cloneRepositoryState();
    const baseline = governance.buildReport(state);
    assert.equal(baseline.ok, true, label);
    assert.deepEqual(baseline.checks.filter((item) => item.id === "authority:apiCatalog").map((item) => item.passed), [true], label);
    const parent = fields.slice(0, -1).reduce((value, field) => value[field], state);
    const field = fields.at(-1);
    const expected = structuredClone(parent[field]);
    assert.notDeepEqual(expected, changed, label);
    parent[field] = structuredClone(changed);
    const report = governance.buildReport(state);
    assert.equal(report.ok, false, label);
    assert.deepEqual(report.checks.filter((item) => item.id === "authority:apiCatalog").map((item) => item.passed), [false], label);
    const restored = structuredClone(state);
    const restoreParent = fields.slice(0, -1).reduce((value, key) => value[key], restored);
    assert.deepEqual(restoreParent[field], changed, label);
    restoreParent[field] = structuredClone(expected);
    assert.deepEqual(restored, repositoryState, label);
  }
});

test("TEST034 repository authority rejects two independent field changes", () => {
  const scenarios = [
    [["repositoryGovernanceReport","ok"], false],
    [["repositoryGovernanceReport","markdown","total"], String(repositoryState.repositoryGovernanceReport.markdown.total)]
  ];
  assert.equal(scenarios.length, 2);
  for (const [fields, changed] of scenarios) {
    const label = fields.join(".") + ":" + JSON.stringify(changed);
    const state = cloneRepositoryState();
    const baseline = governance.buildReport(state);
    assert.equal(baseline.ok, true, label);
    assert.deepEqual(baseline.checks.filter((item) => item.id === "authority:repositoryGovernance").map((item) => item.passed), [true], label);
    const parent = fields.slice(0, -1).reduce((value, field) => value[field], state);
    const field = fields.at(-1);
    const expected = structuredClone(parent[field]);
    assert.notDeepEqual(expected, changed, label);
    parent[field] = structuredClone(changed);
    const report = governance.buildReport(state);
    assert.equal(report.ok, false, label);
    assert.deepEqual(report.checks.filter((item) => item.id === "authority:repositoryGovernance").map((item) => item.passed), [false], label);
    const restored = structuredClone(state);
    const restoreParent = fields.slice(0, -1).reduce((value, key) => value[key], restored);
    assert.deepEqual(restoreParent[field], changed, label);
    restoreParent[field] = structuredClone(expected);
    assert.deepEqual(restored, repositoryState, label);
  }
});

test("TEST034 SQLite authority rejects four independent field changes", () => {
  const scenarios = [
    [["sqliteSchemaFacts","head"], repositoryState.sqliteSchemaFacts.head - 1],
    [["sqliteSchemaFacts","tableCount"], String(repositoryState.sqliteSchemaFacts.tableCount)],
    [["sqliteSchemaFacts","tables"], null],
    [["sqliteSchemaFacts","tables"], repositoryState.sqliteSchemaFacts.tables.slice(0, -1)]
  ];
  assert.equal(scenarios.length, 4);
  for (const [fields, changed] of scenarios) {
    const label = fields.join(".") + ":" + JSON.stringify(changed);
    const state = cloneRepositoryState();
    const baseline = governance.buildReport(state);
    assert.equal(baseline.ok, true, label);
    assert.deepEqual(baseline.checks.filter((item) => item.id === "authority:sqliteSchema").map((item) => item.passed), [true], label);
    const parent = fields.slice(0, -1).reduce((value, field) => value[field], state);
    const field = fields.at(-1);
    const expected = structuredClone(parent[field]);
    assert.notDeepEqual(expected, changed, label);
    parent[field] = structuredClone(changed);
    const report = governance.buildReport(state);
    assert.equal(report.ok, false, label);
    assert.deepEqual(report.checks.filter((item) => item.id === "authority:sqliteSchema").map((item) => item.passed), [false], label);
    const restored = structuredClone(state);
    const restoreParent = fields.slice(0, -1).reduce((value, key) => value[key], restored);
    assert.deepEqual(restoreParent[field], changed, label);
    restoreParent[field] = structuredClone(expected);
    assert.deepEqual(restored, repositoryState, label);
  }
});

test("TEST034 E2E authority rejects five independent field changes", () => {
  const scenarios = [
    [["e2eFacts","root"], 0],
    [["e2eFacts","resident"], 0],
    [["e2eFacts","pwa"], 0],
    [["e2eFacts","total"], repositoryState.e2eFacts.total + 1],
    [["e2eFacts","specFiles"], String(repositoryState.e2eFacts.specFiles)]
  ];
  assert.equal(scenarios.length, 5);
  for (const [fields, changed] of scenarios) {
    const label = fields.join(".") + ":" + JSON.stringify(changed);
    const state = cloneRepositoryState();
    const baseline = governance.buildReport(state);
    assert.equal(baseline.ok, true, label);
    assert.deepEqual(baseline.checks.filter((item) => item.id === "authority:e2eInventory").map((item) => item.passed), [true], label);
    const parent = fields.slice(0, -1).reduce((value, field) => value[field], state);
    const field = fields.at(-1);
    const expected = structuredClone(parent[field]);
    assert.notDeepEqual(expected, changed, label);
    parent[field] = structuredClone(changed);
    const report = governance.buildReport(state);
    assert.equal(report.ok, false, label);
    assert.deepEqual(report.checks.filter((item) => item.id === "authority:e2eInventory").map((item) => item.passed), [false], label);
    const restored = structuredClone(state);
    const restoreParent = fields.slice(0, -1).reduce((value, key) => value[key], restored);
    assert.deepEqual(restoreParent[field], changed, label);
    restoreParent[field] = structuredClone(expected);
    assert.deepEqual(restored, repositoryState, label);
  }
});

test("TEST035 roadmap E2E facts reject three bounded numeric drifts", () => {
  const scenarios = [["resident","居民 "," 项"],["pwa","PWA "," 项"],["total","E2E 共 "," 项"]];
  assert.equal(scenarios.length, 3);
  for (const [field, prefix, suffix] of scenarios) {
    const expected = repositoryState.e2eFacts[field];
    assert.ok(Number.isSafeInteger(expected) && expected > 1, field);
    const originalNumber = String(expected);
    const changedNumber = String(expected - 1);
    const original = prefix + originalNumber + suffix;
    const changed = prefix + changedNumber + suffix;
    const label = "roadmap:" + field;
    const state = cloneRepositoryState();
    const baseline = governance.buildReport(state);
    const checkId = "roadmap:e2eFacts";
    assert.equal(baseline.ok, true, label);
    assert.deepEqual(baseline.checks.filter((item) => item.id === checkId).map((item) => item.passed), [true], label);
    const source = state.documents.roadmap;
    const matches = [...source.matchAll(/^.*$/gm)].filter((line) => line[0].includes("| 10 | CI/worker/部署依赖治理 |"));
    assert.equal(matches.length, 1, label);
    const start = matches[0].index;
    const end = start + matches[0][0].length;
    const region = source.slice(start, end);
    assert.equal(region.split(original).length - 1, 1, label);
    assert.notEqual(originalNumber, changedNumber, label);
    const offset = start + region.indexOf(original) + prefix.length;
    assert.equal(source.slice(offset, offset + originalNumber.length), originalNumber, label);
    state.documents.roadmap = source.slice(0, offset) + changedNumber + source.slice(offset + originalNumber.length);
    assert.notEqual(state.documents.roadmap, source, label);
    const mutatedRegion = state.documents.roadmap.slice(start, end - originalNumber.length + changedNumber.length);
    assert.equal(mutatedRegion.split(changed).length - 1, 1, label);
    const report = governance.buildReport(state);
    assert.equal(report.ok, false, label);
    assert.deepEqual(report.checks.filter((item) => item.id === checkId).map((item) => item.passed), [false], label);
    const restored = structuredClone(state);
    const actual = restored.documents.roadmap;
    assert.equal(actual.slice(0, offset), source.slice(0, offset), label);
    assert.equal(actual.slice(offset, offset + changedNumber.length), changedNumber, label);
    assert.equal(actual.slice(offset + changedNumber.length), source.slice(offset + originalNumber.length), label);
    restored.documents.roadmap = actual.slice(0, offset) + originalNumber + actual.slice(offset + changedNumber.length);
    assert.deepEqual(restored, repositoryState, label);
  }
});

test("TEST035 module map E2E facts reject three bounded numeric drifts", () => {
  const scenarios = [["resident","居民 "," 项"],["pwa","PWA "," 项"],["total","三套共 "," 项"]];
  assert.equal(scenarios.length, 3);
  for (const [field, prefix, suffix] of scenarios) {
    const expected = repositoryState.e2eFacts[field];
    assert.ok(Number.isSafeInteger(expected) && expected > 1, field);
    const originalNumber = String(expected);
    const changedNumber = String(expected - 1);
    const original = prefix + originalNumber + suffix;
    const changed = prefix + changedNumber + suffix;
    const label = "moduleMap:" + field;
    const state = cloneRepositoryState();
    const baseline = governance.buildReport(state);
    const checkId = "moduleMap:e2eFacts";
    assert.equal(baseline.ok, true, label);
    assert.deepEqual(baseline.checks.filter((item) => item.id === checkId).map((item) => item.passed), [true], label);
    const source = state.documents.moduleMap;
    const matches = [...source.matchAll(/^.*$/gm)].filter((line) => line[0].includes("| Playwright E2E 基础设施 |"));
    assert.equal(matches.length, 1, label);
    const start = matches[0].index;
    const end = start + matches[0][0].length;
    const region = source.slice(start, end);
    assert.equal(region.split(original).length - 1, 1, label);
    assert.notEqual(originalNumber, changedNumber, label);
    const offset = start + region.indexOf(original) + prefix.length;
    assert.equal(source.slice(offset, offset + originalNumber.length), originalNumber, label);
    state.documents.moduleMap = source.slice(0, offset) + changedNumber + source.slice(offset + originalNumber.length);
    assert.notEqual(state.documents.moduleMap, source, label);
    const mutatedRegion = state.documents.moduleMap.slice(start, end - originalNumber.length + changedNumber.length);
    assert.equal(mutatedRegion.split(changed).length - 1, 1, label);
    const report = governance.buildReport(state);
    assert.equal(report.ok, false, label);
    assert.deepEqual(report.checks.filter((item) => item.id === checkId).map((item) => item.passed), [false], label);
    const restored = structuredClone(state);
    const actual = restored.documents.moduleMap;
    assert.equal(actual.slice(0, offset), source.slice(0, offset), label);
    assert.equal(actual.slice(offset, offset + changedNumber.length), changedNumber, label);
    assert.equal(actual.slice(offset + changedNumber.length), source.slice(offset + originalNumber.length), label);
    restored.documents.moduleMap = actual.slice(0, offset) + originalNumber + actual.slice(offset + changedNumber.length);
    assert.deepEqual(restored, repositoryState, label);
  }
});

test("TEST035 API map E2E facts reject three bounded numeric drifts", () => {
  const scenarios = [["resident","居民 "," 项"],["pwa","PWA 专项 "," 项"],["total","三套共 "," 项"]];
  assert.equal(scenarios.length, 3);
  for (const [field, prefix, suffix] of scenarios) {
    const expected = repositoryState.e2eFacts[field];
    assert.ok(Number.isSafeInteger(expected) && expected > 1, field);
    const originalNumber = String(expected);
    const changedNumber = String(expected - 1);
    const original = prefix + originalNumber + suffix;
    const changed = prefix + changedNumber + suffix;
    const label = "apiMap:" + field;
    const state = cloneRepositoryState();
    const baseline = governance.buildReport(state);
    const checkId = "apiMap:e2eFacts";
    assert.equal(baseline.ok, true, label);
    assert.deepEqual(baseline.checks.filter((item) => item.id === checkId).map((item) => item.passed), [true], label);
    const source = state.documents.apiMap;
    const lines = [...source.matchAll(/^.*$/gm)];
    const starts = lines.filter((line) => line[0].trim() === "## 20. Playwright E2E 隔离（无 HTTP 变化）");
    const ends = lines.filter((line) => line[0].trim() === "## 21. 仓库文档与制品治理（无 HTTP 变化）");
    assert.equal(starts.length, 1, label);
    assert.equal(ends.length, 1, label);
    const start = starts[0].index;
    const end = ends[0].index;
    assert.ok(end > start, label);
    const region = source.slice(start, end);
    assert.equal(region.split(original).length - 1, 1, label);
    assert.notEqual(originalNumber, changedNumber, label);
    const offset = start + region.indexOf(original) + prefix.length;
    assert.equal(source.slice(offset, offset + originalNumber.length), originalNumber, label);
    state.documents.apiMap = source.slice(0, offset) + changedNumber + source.slice(offset + originalNumber.length);
    assert.notEqual(state.documents.apiMap, source, label);
    const mutatedRegion = state.documents.apiMap.slice(start, end - originalNumber.length + changedNumber.length);
    assert.equal(mutatedRegion.split(changed).length - 1, 1, label);
    const report = governance.buildReport(state);
    assert.equal(report.ok, false, label);
    assert.deepEqual(report.checks.filter((item) => item.id === checkId).map((item) => item.passed), [false], label);
    const restored = structuredClone(state);
    const actual = restored.documents.apiMap;
    assert.equal(actual.slice(0, offset), source.slice(0, offset), label);
    assert.equal(actual.slice(offset, offset + changedNumber.length), changedNumber, label);
    assert.equal(actual.slice(offset + changedNumber.length), source.slice(offset + originalNumber.length), label);
    restored.documents.apiMap = actual.slice(0, offset) + originalNumber + actual.slice(offset + changedNumber.length);
    assert.deepEqual(restored, repositoryState, label);
  }
});

test("TEST035 ADR index E2E facts reject three bounded numeric drifts", () => {
  const scenarios = [["resident","居民 "," +"],["pwa","PWA "," ="],["total","= "," 项套件"]];
  assert.equal(scenarios.length, 3);
  for (const [field, prefix, suffix] of scenarios) {
    const expected = repositoryState.e2eFacts[field];
    assert.ok(Number.isSafeInteger(expected) && expected > 1, field);
    const originalNumber = String(expected);
    const changedNumber = String(expected - 1);
    const original = prefix + originalNumber + suffix;
    const changed = prefix + changedNumber + suffix;
    const label = "adrIndex:" + field;
    const state = cloneRepositoryState();
    const baseline = governance.buildReport(state);
    const checkId = "adrIndex:e2eFacts";
    assert.equal(baseline.ok, true, label);
    assert.deepEqual(baseline.checks.filter((item) => item.id === checkId).map((item) => item.passed), [true], label);
    const source = state.documents.adrIndex;
    const matches = [...source.matchAll(/^.*$/gm)].filter((line) => line[0].includes("[Playwright E2E 采用统一浏览器策略与独占测试服务]"));
    assert.equal(matches.length, 1, label);
    const start = matches[0].index;
    const end = start + matches[0][0].length;
    const region = source.slice(start, end);
    assert.equal(region.split(original).length - 1, 1, label);
    assert.notEqual(originalNumber, changedNumber, label);
    const offset = start + region.indexOf(original) + prefix.length;
    assert.equal(source.slice(offset, offset + originalNumber.length), originalNumber, label);
    state.documents.adrIndex = source.slice(0, offset) + changedNumber + source.slice(offset + originalNumber.length);
    assert.notEqual(state.documents.adrIndex, source, label);
    const mutatedRegion = state.documents.adrIndex.slice(start, end - originalNumber.length + changedNumber.length);
    assert.equal(mutatedRegion.split(changed).length - 1, 1, label);
    const report = governance.buildReport(state);
    assert.equal(report.ok, false, label);
    assert.deepEqual(report.checks.filter((item) => item.id === checkId).map((item) => item.passed), [false], label);
    const restored = structuredClone(state);
    const actual = restored.documents.adrIndex;
    assert.equal(actual.slice(0, offset), source.slice(0, offset), label);
    assert.equal(actual.slice(offset, offset + changedNumber.length), changedNumber, label);
    assert.equal(actual.slice(offset + changedNumber.length), source.slice(offset + originalNumber.length), label);
    restored.documents.adrIndex = actual.slice(0, offset) + originalNumber + actual.slice(offset + changedNumber.length);
    assert.deepEqual(restored, repositoryState, label);
  }
});

test("TEST036 engineering governance E2E facts reject three bounded numeric drifts", () => {
  const scenarios = [["resident", "居民 ", " 项"], ["pwa", "PWA ", " 项"], ["total", "三套必须形成 ", " 项"]];
  assert.equal(scenarios.length, 3);
  for (const [field, prefix, suffix] of scenarios) {
    const expected = repositoryState.e2eFacts[field];
    assert.ok(Number.isSafeInteger(expected) && expected > 1, field);
    const originalNumber = String(expected);
    const changedNumber = String(expected - 1);
    const original = prefix + originalNumber + suffix;
    const changed = prefix + changedNumber + suffix;
    const label = "engineeringGovernance:" + field;
    const state = cloneRepositoryState();
    const baseline = governance.buildReport(state);
    const checkId = "engineeringGovernance:e2eFacts";
    assert.equal(baseline.ok, true, label);
    assert.deepEqual(baseline.checks.filter((item) => item.id === checkId).map((item) => item.passed), [true], label);
    const source = state.documents.engineeringGovernance;
    const startMarker = "TEST-005 规定标准 E2E 只能使用 Playwright Chromium";
    const endMarker = "该门禁不证明真实 HTTPS、OS 安装策略、外部 Origin 或现场浏览器验收。";
    assert.equal(source.split(startMarker).length - 1, 1, label);
    assert.equal(source.split(endMarker).length - 1, 1, label);
    const start = source.indexOf(startMarker);
    const endStart = source.indexOf(endMarker);
    assert.ok(endStart > start, label);
    const end = endStart + endMarker.length;
    const region = source.slice(start, end);
    assert.equal(region.split(original).length - 1, 1, label);
    assert.notEqual(originalNumber, changedNumber, label);
    const offset = start + region.indexOf(original) + prefix.length;
    assert.equal(source.slice(offset, offset + originalNumber.length), originalNumber, label);
    state.documents.engineeringGovernance = source.slice(0, offset) + changedNumber + source.slice(offset + originalNumber.length);
    assert.notEqual(state.documents.engineeringGovernance, source, label);
    const mutatedRegion = state.documents.engineeringGovernance.slice(start, end - originalNumber.length + changedNumber.length);
    assert.equal(mutatedRegion.split(changed).length - 1, 1, label);
    const report = governance.buildReport(state);
    assert.equal(report.ok, false, label);
    assert.deepEqual(report.checks.filter((item) => item.id === checkId).map((item) => item.passed), [false], label);
    const restored = structuredClone(state);
    const actual = restored.documents.engineeringGovernance;
    assert.equal(actual.slice(0, offset), source.slice(0, offset), label);
    assert.equal(actual.slice(offset, offset + changedNumber.length), changedNumber, label);
    assert.equal(actual.slice(offset + changedNumber.length), source.slice(offset + originalNumber.length), label);
    restored.documents.engineeringGovernance = actual.slice(0, offset) + originalNumber + actual.slice(offset + changedNumber.length);
    assert.deepEqual(restored, repositoryState, label);
  }
});

test("TEST037 current architecture online E2E fact rejects two bounded numeric drifts", (t) => {
  const { root, resident, pwa } = repositoryState.e2eFacts;
  assert.ok(Number.isSafeInteger(root) && root > 0);
  assert.ok(Number.isSafeInteger(resident) && resident > 0);
  assert.ok(Number.isSafeInteger(pwa) && pwa > 0);
  const online = root + resident;
  assert.ok(Number.isSafeInteger(online) && online > 1);
  assert.ok(Number.isSafeInteger(online + pwa));
  const scenarios = [["online-minus-one", online - 1], ["online-includes-pwa", online + pwa]];
  assert.equal(scenarios.length, 2);
  const outcomes = [];
  for (const [scenario, changedCount] of scenarios) {
    const label = "currentArchitecture:" + scenario;
    const state = cloneRepositoryState();
    const baseline = governance.buildReport(state);
    const checkId = "currentArchitecture:e2eFacts";
    assert.equal(baseline.ok, true, label);
    assert.deepEqual(baseline.checks.filter((item) => item.id === checkId).map((item) => item.passed), [true], label);
    const source = state.documents.currentArchitecture;
    const startMarker = "TEST-005 将浏览器 E2E 精确分为根";
    const endMarker = "标准在线 context 仍保持阻止 Service Worker。";
    assert.equal(source.split(startMarker).length - 1, 1, label);
    assert.equal(source.split(endMarker).length - 1, 1, label);
    const start = source.indexOf(startMarker);
    const endStart = source.indexOf(endMarker);
    assert.ok(endStart > start, label);
    const end = endStart + endMarker.length;
    const region = source.slice(start, end);
    const prefix = "在线 ";
    const suffix = " 项并集/唯一性、浏览器策略和 runner 生命周期由专项测试锁定。";
    const originalNumber = String(online);
    const changedNumber = String(changedCount);
    const declaration = prefix + originalNumber + suffix;
    assert.equal(region.split(declaration).length - 1, 1, label);
    assert.equal(region.split("PWA 专项另以").length - 1, 1, label);
    const declarationOffset = start + region.indexOf(declaration);
    const pwaOffset = start + region.indexOf("PWA 专项另以");
    assert.ok(declarationOffset + declaration.length <= pwaOffset, label);
    assert.notEqual(changedNumber, originalNumber, label);
    const offset = declarationOffset + prefix.length;
    assert.equal(source.slice(offset, offset + originalNumber.length), originalNumber, label);
    state.documents.currentArchitecture = source.slice(0, offset) + changedNumber + source.slice(offset + originalNumber.length);
    assert.notEqual(state.documents.currentArchitecture, source, label);
    const mutatedRegion = state.documents.currentArchitecture.slice(start, end - originalNumber.length + changedNumber.length);
    assert.equal(mutatedRegion.split(prefix + changedNumber + suffix).length - 1, 1, label);
    const report = governance.buildReport(state);
    outcomes.push({
      scenario,
      reportOK: report.ok,
      targetPassed: report.checks.filter((item) => item.id === checkId).map((item) => item.passed)
    });
    const restored = structuredClone(state);
    const actual = restored.documents.currentArchitecture;
    assert.equal(actual.slice(0, offset), source.slice(0, offset), label);
    assert.equal(actual.slice(offset, offset + changedNumber.length), changedNumber, label);
    assert.equal(actual.slice(offset + changedNumber.length), source.slice(offset + originalNumber.length), label);
    restored.documents.currentArchitecture = actual.slice(0, offset) + originalNumber + actual.slice(offset + changedNumber.length);
    assert.deepEqual(restored, repositoryState, label);
    t.diagnostic("TEST037_RESULT " + JSON.stringify(outcomes.at(-1)));
  }
  assert.deepEqual(outcomes, scenarios.map(([scenario]) => ({ scenario, reportOK: false, targetPassed: [false] })));
});

test("TEST037 current architecture online E2E fact requires one declaration", (t) => {
  const { root, resident, pwa } = repositoryState.e2eFacts;
  assert.ok(Number.isSafeInteger(root) && root > 0);
  assert.ok(Number.isSafeInteger(resident) && resident > 0);
  assert.ok(Number.isSafeInteger(pwa) && pwa > 0);
  const online = root + resident;
  assert.ok(Number.isSafeInteger(online) && online > 0);
  assert.ok(Number.isSafeInteger(online + pwa));
  const scenarios = [["declaration-deleted", 0], ["declaration-duplicated", 2]];
  assert.equal(scenarios.length, 2);
  const outcomes = [];
  for (const [scenario, expectedCount] of scenarios) {
    const label = "currentArchitecture:" + scenario;
    const state = cloneRepositoryState();
    const baseline = governance.buildReport(state);
    const checkId = "currentArchitecture:e2eFacts";
    assert.equal(baseline.ok, true, label);
    assert.deepEqual(baseline.checks.filter((item) => item.id === checkId).map((item) => item.passed), [true], label);
    const source = state.documents.currentArchitecture;
    const startMarker = "TEST-005 将浏览器 E2E 精确分为根";
    const endMarker = "标准在线 context 仍保持阻止 Service Worker。";
    assert.equal(source.split(startMarker).length - 1, 1, label);
    assert.equal(source.split(endMarker).length - 1, 1, label);
    const start = source.indexOf(startMarker);
    const endStart = source.indexOf(endMarker);
    assert.ok(endStart > start, label);
    const end = endStart + endMarker.length;
    const region = source.slice(start, end);
    const declaration = "在线 " + String(online) + " 项并集/唯一性、浏览器策略和 runner 生命周期由专项测试锁定。";
    assert.equal(region.split(declaration).length - 1, 1, label);
    assert.equal(region.split("PWA 专项另以").length - 1, 1, label);
    const declarationOffset = start + region.indexOf(declaration);
    const pwaOffset = start + region.indexOf("PWA 专项另以");
    assert.ok(declarationOffset + declaration.length <= pwaOffset, label);
    const offset = expectedCount === 0 ? declarationOffset : declarationOffset + declaration.length;
    const removed = expectedCount === 0 ? declaration : "";
    const inserted = expectedCount === 2 ? declaration : "";
    assert.notEqual(removed, inserted, label);
    assert.equal(source.slice(offset, offset + removed.length), removed, label);
    state.documents.currentArchitecture = source.slice(0, offset) + inserted + source.slice(offset + removed.length);
    assert.notEqual(state.documents.currentArchitecture, source, label);
    const mutatedRegion = state.documents.currentArchitecture.slice(start, end - removed.length + inserted.length);
    assert.equal(mutatedRegion.split(declaration).length - 1, expectedCount, label);
    const report = governance.buildReport(state);
    outcomes.push({
      scenario,
      reportOK: report.ok,
      targetPassed: report.checks.filter((item) => item.id === checkId).map((item) => item.passed)
    });
    const restored = structuredClone(state);
    const actual = restored.documents.currentArchitecture;
    assert.equal(actual.slice(0, offset), source.slice(0, offset), label);
    assert.equal(actual.slice(offset, offset + inserted.length), inserted, label);
    assert.equal(actual.slice(offset + inserted.length), source.slice(offset + removed.length), label);
    restored.documents.currentArchitecture = actual.slice(0, offset) + removed + actual.slice(offset + inserted.length);
    assert.deepEqual(restored, repositoryState, label);
    t.diagnostic("TEST037_RESULT " + JSON.stringify(outcomes.at(-1)));
  }
  assert.deepEqual(outcomes, scenarios.map(([scenario]) => ({ scenario, reportOK: false, targetPassed: [false] })));
});
