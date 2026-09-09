#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { buildProductionApiCatalog, validateProductionApiCatalog } = require("./production-api-catalog");
const objectStorageGovernance = require("./object-storage-architecture-governance");
const { buildRepositoryGovernanceReport } = require("./repository-governance");
const { buildFirstReleaseMigrationPortfolioReadiness } = require("../src/platform/data/first-release-migration-portfolio");
const {
  applySqliteMigrations,
  SQLITE_SCHEMA_HEAD
} = require("../src/platform/storage/sqlite-migrations");
const {
  buildProductionReleaseScopeReport,
  loadDefaultAuthorities
} = require("../src/platform/governance/production-release-scope");

const ROOT = path.resolve(__dirname, "..");
const DOCUMENT_PATHS = Object.freeze({
  roadmap: "ROADMAP.md",
  engineeringGovernance: "ENGINEERING_GOVERNANCE.md",
  architecture: "ARCHITECTURE.md",
  currentArchitecture: "CURRENT_ARCHITECTURE.md",
  moduleMap: "MODULE_MAP.md",
  dataModel: "DATA_MODEL.md",
  apiMap: "API_MAP.md",
  dependencyMap: "DEPENDENCY_MAP.md",
  techDebt: "TECH_DEBT.md",
  adrIndex: "docs/adr/README.md",
  e2eAdr: "docs/adr/2026-08-23-playwright-e2e-isolation-and-browser-policy.md"
});
const ALLOWED_TECH_DEBT_GOVERNANCE_REFERENCES = new Set([
  "DATA-003:DATABASE_SCHEMA.md",
  "TEST-006:DEPENDENCY_MAP.md",
  "ARC-002:DEPENDENCY_MAP.md",
  "TEST-007:docs/adr/2026-08-18-clinical-five-governed-subdomains.md",
  "TEST-007:docs/operations-command-behavior-matrix.md",
  "TEST-001:docs/internal-boundary-coverage-governance.md"
]);

function check(id, passed, detail) {
  return { id, passed: Boolean(passed), detail: String(detail || "") };
}

function uniqueLineContaining(source, marker) {
  const lines = String(source || "").split(/\r?\n/).filter((line) => line.includes(marker));
  return Object.freeze({ count: lines.length, text: lines.length === 1 ? lines[0] : "" });
}

function uniqueSection(source, startHeading, nextHeading) {
  const lines = String(source || "").split(/\r?\n/);
  const starts = lines.map((line, index) => line.trim() === startHeading ? index : -1).filter((index) => index >= 0);
  if (starts.length !== 1) return Object.freeze({ count: starts.length, text: "" });
  const start = starts[0];
  const end = nextHeading
    ? lines.findIndex((line, index) => index > start && line.trim() === nextHeading)
    : -1;
  return Object.freeze({ count: 1, text: lines.slice(start, end < 0 ? lines.length : end).join("\n") });
}

function hasOneNumericFact(source, expression, expected) {
  const matches = [...String(source || "").matchAll(expression)];
  return matches.length === 1 && Number(matches[0][1]) === expected;
}

function hasAcceptedWithoutProposed(source) {
  const statuses = [...String(source || "").matchAll(/\b(Accepted|Proposed)\b/g)].map((match) => match[1]);
  return statuses.length === 1 && statuses[0] === "Accepted";
}

function techDebtTableIds(source) {
  return [...String(source || "").matchAll(/^\|\s*([A-Z][A-Z0-9-]*-\d{3})\s*\|/gm)].map((match) => match[1]);
}

function governedMarkdownIdDefinitions(source, documentPath) {
  const definitions = [];
  for (const line of String(source || "").split(/\r?\n/)) {
    const match = line.match(/^(?:\|\s*|[-*]\s+|#{1,6}\s+)([A-Z][A-Z0-9-]*-\d{3})(?:\s*\||\s*[：:]|\s+)/);
    if (match) definitions.push({ id: match[1], path: documentPath });
  }
  return definitions;
}

function buildSqliteSchemaFacts() {
  const database = new DatabaseSync(":memory:");
  try {
    applySqliteMigrations(database);
    const tables = database.prepare(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).all().map((row) => row.name);
    return Object.freeze({ head: SQLITE_SCHEMA_HEAD, tables: Object.freeze(tables), tableCount: tables.length });
  } finally {
    database.close();
  }
}

function listPlaywrightTests(configPath) {
  const cli = path.join(ROOT, "node_modules", "@playwright", "test", "cli.js");
  const result = spawnSync(process.execPath, [cli, "test", "--list", "--config", path.join(ROOT, configPath)], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", PLAYWRIGHT_E2E_PORT: "42101" },
    windowsHide: true
  });
  if (result.status !== 0) throw new Error(`Playwright inventory failed for ${configPath}: ${result.stderr || result.stdout}`);
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => /\.spec\.js:\d+:\d+ › /.test(line));
}

function buildE2eFacts() {
  const directory = path.join(ROOT, "test", "e2e");
  const files = fs.readdirSync(directory).filter((name) => name.endsWith(".spec.js")).sort();
  const root = listPlaywrightTests("playwright.config.js").length;
  const resident = listPlaywrightTests("test/e2e/resident-mini-program.playwright.config.js").length;
  const pwa = listPlaywrightTests("test/e2e/pwa-service-worker.playwright.config.js").length;
  const total = root + resident + pwa;
  return Object.freeze({
    root,
    resident,
    pwa,
    total,
    specFiles: files.length
  });
}

function readRepositoryState(options = {}) {
  const documents = options.documents || Object.fromEntries(Object.entries(DOCUMENT_PATHS)
    .map(([id, relative]) => [id, fs.readFileSync(path.join(ROOT, relative), "utf8")]));
  const catalog = options.catalog || buildProductionApiCatalog();
  const catalogSummary = options.catalogSummary || catalog.summary;
  const catalogErrors = options.catalogErrors || validateProductionApiCatalog(catalog);
  const objectStorageReport = options.objectStorageReport || objectStorageGovernance.verifyRepository();
  const repositoryGovernanceReport = options.repositoryGovernanceReport || buildRepositoryGovernanceReport();
  const firstReleaseMigrationReport = options.firstReleaseMigrationReport || buildFirstReleaseMigrationPortfolioReadiness();
  const sqliteSchemaFacts = options.sqliteSchemaFacts || buildSqliteSchemaFacts();
  const e2eFacts = options.e2eFacts || buildE2eFacts();
  const productionReleaseScopeReport = options.productionReleaseScopeReport
    || buildProductionReleaseScopeReport(loadDefaultAuthorities());
  const lifecycleTaskIds = options.lifecycleTaskIds || JSON.parse(fs.readFileSync(
    path.join(ROOT, "config", "lifecycle-governance.json"), "utf8"
  )).tasks.map((task) => task.id);
  const governedMarkdownDefinitions = options.governedMarkdownDefinitions || repositoryGovernanceReport.markdown.entries
    .filter((entry) => entry.classification === "current" && entry.path !== DOCUMENT_PATHS.techDebt)
    .flatMap((entry) => governedMarkdownIdDefinitions(fs.readFileSync(path.join(ROOT, entry.path), "utf8"), entry.path));
  return {
    documents,
    catalogSummary,
    catalogErrors,
    objectStorageReport,
    repositoryGovernanceReport,
    firstReleaseMigrationReport,
    sqliteSchemaFacts,
    e2eFacts,
    productionReleaseScopeReport,
    lifecycleTaskIds,
    governedMarkdownDefinitions
  };
}

function buildReport(input) {
  const {
    documents = {},
    catalogSummary = {},
    catalogErrors = ["catalog validation not supplied"],
    objectStorageReport = {},
    repositoryGovernanceReport = {},
    firstReleaseMigrationReport = {},
    sqliteSchemaFacts = {},
    e2eFacts = {},
    productionReleaseScopeReport = {},
    lifecycleTaskIds = [],
    governedMarkdownDefinitions = []
  } = input || {};
  const entries = catalogSummary.entries;
  const writeRoutes = catalogSummary.writeRoutes;
  const behaviorProofRequired = catalogSummary.writeIdempotencyBehaviorProofRequired;
  const reviewRequired = catalogSummary.reviewRequired;
  const markdownTotal = repositoryGovernanceReport.markdown?.total;
  const markdownCurrent = repositoryGovernanceReport.markdown?.byClassification?.current?.count;
  const markdownSnapshot = repositoryGovernanceReport.markdown?.byClassification?.snapshot?.count;
  const markdownSuperseded = repositoryGovernanceReport.markdown?.byClassification?.superseded?.count;
  const sqliteHead = sqliteSchemaFacts.head;
  const sqliteTableCount = sqliteSchemaFacts.tableCount;
  const e2eRoot = e2eFacts.root;
  const e2eResident = e2eFacts.resident;
  const e2ePwa = e2eFacts.pwa;
  const e2eTotal = e2eFacts.total;
  const scopedApiReviewRequired = productionReleaseScopeReport.repositoryReview?.apiReviewRequired?.length;
  const scopedCollectionReviewRequired = productionReleaseScopeReport.repositoryReview?.collectionReviewRequired?.length;
  const scopedRepositoryPlanMissing = productionReleaseScopeReport.repositoryReview?.collectionRepositoryPlanMissing?.length;
  const roadmapApi = uniqueLineContaining(documents.roadmap, "| 7C | 生产 API 机器目录 |");
  const roadmapRepository = uniqueLineContaining(documents.roadmap, "| 15 | 当前工作流、Markdown 与跟踪 PDF 闭集治理 |");
  const roadmapObjectStorage = uniqueLineContaining(documents.roadmap, "| 12 | 对象存储结构化元数据与耐久命令轨道 |");
  const roadmapReleaseScope = uniqueLineContaining(documents.roadmap, "| 16 | 首批生产范围机器冻结 |");
  const roadmapE2e = uniqueLineContaining(documents.roadmap, "| 10 | CI/worker/部署依赖治理 |");
  const adrObjectStorage = uniqueLineContaining(documents.adrIndex, "[对象存储采用结构化元数据与耐久异步命令轨道 v2]");
  const moduleApi = uniqueLineContaining(documents.moduleMap, "| API 生产目录 |");
  const moduleObjectStoragePort = uniqueLineContaining(documents.moduleMap, "| 安全对象存储端口 |");
  const moduleObjectStorage = uniqueSection(documents.moduleMap, "## 17. 对象存储耐久 v2 模块", "## 18. Production evidence trust provider");
  const moduleObjectStorageDecision = uniqueLineContaining(moduleObjectStorage.text, "| `config/object-storage-architecture-decision.json` |");
  const moduleRepositoryGovernance = uniqueLineContaining(documents.moduleMap, "| `test/repository-governance.test.js` |");
  const moduleE2e = uniqueLineContaining(documents.moduleMap, "| Playwright E2E 基础设施 |");
  const architectureObjectStorage = uniqueSection(documents.architecture, "## 已接受的对象存储 v2 方向", "## 首批生产范围合同");
  const currentArchitectureRepository = uniqueSection(documents.currentArchitecture, "## 2026-08-23 仓库文档与跟踪 PDF 治理", "## 2026-08-23 金融写入证据边界");
  const dataModelSchema = uniqueSection(documents.dataModel, "## 2. SQLite Schema", "### 关系主链");
  const dataModelMigrations = uniqueSection(documents.dataModel, "## 3. Migration 现状", "## 4. JSON 集合与实际使用");
  const apiMapCurrentFacts = uniqueSection(documents.apiMap, "## 6. 错误、幂等与审计", "## 7. API 风险与缺失测试");
  const apiMapReleaseScope = uniqueSection(documents.apiMap, "## 37. 首批生产范围（无 HTTP 变化）", "## 38. 血液 HTTP 实现归域（协议不变）");
  const dependencyObjectStorage = uniqueSection(documents.dependencyMap, "## 对象存储耐久 v2 依赖方向", "## Production evidence trust 依赖方向");
  const dependencyWorker = uniqueSection(documents.dependencyMap, "## Worker 共同观测依赖方向", "## 仓库文档与 PDF 治理依赖方向");
  const apiMapE2e = uniqueSection(documents.apiMap, "## 20. Playwright E2E 隔离（无 HTTP 变化）", "## 21. 仓库文档与制品治理（无 HTTP 变化）");
  const e2eAdrCurrent = uniqueSection(documents.e2eAdr, "## 2026-09-06 当前套件状态");
  const adrIndexE2e = uniqueLineContaining(documents.adrIndex, "[Playwright E2E 采用统一浏览器策略与独占测试服务]");
  const techDebtRepositoryGovernance = uniqueLineContaining(documents.techDebt, "| DOC-001 |");
  const techDebtIds = techDebtTableIds(documents.techDebt);
  const duplicateTechDebtIds = [...new Set(techDebtIds.filter((id, index) => techDebtIds.indexOf(id) !== index))];
  const lifecycleTaskIdSet = new Set(lifecycleTaskIds);
  const lifecycleIdConflicts = [...new Set(techDebtIds.filter((id) => lifecycleTaskIdSet.has(id)))];
  const techDebtIdSet = new Set(techDebtIds);
  const governedDocumentIdConflicts = governedMarkdownDefinitions.filter(({ id, path: documentPath }) =>
    techDebtIdSet.has(id) && !ALLOWED_TECH_DEBT_GOVERNANCE_REFERENCES.has(`${id}:${documentPath}`));

  const catalogFactsValid = [entries, writeRoutes, behaviorProofRequired, reviewRequired]
    .every(Number.isSafeInteger)
    && Array.isArray(catalogErrors)
    && catalogErrors.length === 0
    && entries > 0
    && writeRoutes > 0
    && behaviorProofRequired >= 0
    && reviewRequired >= behaviorProofRequired
    && catalogSummary.productionNoGo === entries;
  const objectStorageFactsValid = objectStorageReport.ok === true
    && objectStorageReport.summary?.decisionStatus === "accepted"
    && objectStorageReport.implementationAuthorized === true
    && objectStorageReport.productionReady === false;
  const sqliteFactsValid = Number.isSafeInteger(sqliteHead)
    && sqliteHead === SQLITE_SCHEMA_HEAD
    && Number.isSafeInteger(sqliteTableCount)
    && sqliteTableCount > 0
    && Array.isArray(sqliteSchemaFacts.tables)
    && sqliteSchemaFacts.tables.length === sqliteTableCount;
  const releaseScopeFactsValid = productionReleaseScopeReport.ok === true
    && productionReleaseScopeReport.status === "FROZEN-NO-GO"
    && productionReleaseScopeReport.productionReady === false
    && scopedApiReviewRequired === 0
    && scopedCollectionReviewRequired === 0
    && scopedRepositoryPlanMissing === 0;

  const checks = [
    check("authority:apiCatalog", catalogFactsValid, catalogErrors.length
      ? catalogErrors.join("; ")
      : `${entries} entries; ${writeRoutes} writes; ${behaviorProofRequired} behavior proofs; ${reviewRequired} reviews`),
    check("authority:objectStorageDecision", objectStorageFactsValid, `${objectStorageReport.summary?.decisionStatus || "missing"}; implementation=${objectStorageReport.implementationAuthorized}; production=${objectStorageReport.productionReady}`),
    check("authority:repositoryGovernance", repositoryGovernanceReport.ok === true && Number.isSafeInteger(markdownTotal), `${markdownTotal} tracked Markdown files`),
    check("authority:sqliteSchema", sqliteFactsValid, `SQLite head v${sqliteHead}; ${sqliteTableCount} tables`),
    check("authority:e2eInventory", [e2eRoot, e2eResident, e2ePwa, e2eTotal, e2eFacts.specFiles].every(Number.isSafeInteger)
      && e2eRoot > 0 && e2eResident > 0 && e2ePwa > 0
      && e2eRoot + e2eResident + e2ePwa === e2eTotal,
    `root=${e2eRoot}; resident=${e2eResident}; PWA=${e2ePwa}; total=${e2eTotal}; spec files=${e2eFacts.specFiles}`),
    check("techDebt:uniqueTableIds", techDebtIds.length > 0 && duplicateTechDebtIds.length === 0,
      duplicateTechDebtIds.length ? `duplicate ids: ${duplicateTechDebtIds.join(", ")}` : `${techDebtIds.length} unique table ids`),
    check("techDebt:lifecycleTaskIdNamespace", lifecycleIdConflicts.length === 0,
      lifecycleIdConflicts.length ? `conflicting lifecycle task ids: ${lifecycleIdConflicts.join(", ")}` : "no lifecycle task id conflicts"),
    check("techDebt:governedDocumentIdNamespace", governedDocumentIdConflicts.length === 0,
      governedDocumentIdConflicts.length
        ? `conflicting governed document ids: ${governedDocumentIdConflicts.map(({ id, path: documentPath }) => `${id}@${documentPath}`).join(", ")}`
        : "no conflicting governed document ids"),
    check("authority:firstReleaseScope", releaseScopeFactsValid, `${productionReleaseScopeReport.status || "missing"}; API reviews=${scopedApiReviewRequired}; collection reviews=${scopedCollectionReviewRequired}; plan gaps=${scopedRepositoryPlanMissing}`),
    check("roadmap:apiCatalogFacts", roadmapApi.count === 1
      && hasOneNumericFact(roadmapApi.text, /v3 当前 (\d+) 项/g, entries)
      && hasOneNumericFact(roadmapApi.text, /(\d+) 个写接口/g, writeRoutes)
      && hasOneNumericFact(roadmapApi.text, /(\d+) 个仍缺 endpoint 级证明/g, behaviorProofRequired)
      && hasOneNumericFact(roadmapApi.text, /总复核为 (\d+)/g, reviewRequired)
      && /全部 NO-GO/.test(roadmapApi.text), roadmapApi.text || `roadmap API row count=${roadmapApi.count}`),
    check("roadmap:repositoryGovernanceFacts", roadmapRepository.count === 1
      && hasOneNumericFact(roadmapRepository.text, /(\d+) 份 Markdown 唯一分类/g, markdownTotal)
      && hasOneNumericFact(roadmapRepository.text, /(\d+) 个 PDF 绑定来源与 digest/g, repositoryGovernanceReport.pdf?.entries?.length),
    roadmapRepository.text || `roadmap repository governance row count=${roadmapRepository.count}`),
    check("roadmap:objectStorageAcceptedNoGo", roadmapObjectStorage.count === 1
      && hasAcceptedWithoutProposed(roadmapObjectStorage.text)
      && /Accepted OBJ-ADR-002/.test(roadmapObjectStorage.text)
      && /仓库实现均已完成/.test(roadmapObjectStorage.text)
      && /production promotion=false/.test(roadmapObjectStorage.text)
      && /继续 NO-GO/.test(roadmapObjectStorage.text), roadmapObjectStorage.text || `roadmap object storage row count=${roadmapObjectStorage.count}`),
    check("roadmap:firstReleaseMigrationPortfolio", firstReleaseMigrationReport.ok === true
      && firstReleaseMigrationReport.repositoryCriticalGaps === 0
      && roadmapReleaseScope.count === 1
      && hasOneNumericFact(roadmapReleaseScope.text, /(\d+) 个唯一持久化计划/g, firstReleaseMigrationReport.summary?.persistentReferences)
      && hasOneNumericFact(roadmapReleaseScope.text, /(\d+) 个派生读模型/g, firstReleaseMigrationReport.summary?.derivedReadModels)
      && hasOneNumericFact(roadmapReleaseScope.text, /collectionRepositoryPlanMissing=(\d+)/g, firstReleaseMigrationReport.repositoryCriticalGaps)
      && /21 个引用仍无生产写资格/.test(roadmapReleaseScope.text), roadmapReleaseScope.text || `roadmap release scope row count=${roadmapReleaseScope.count}`),
    check("roadmap:e2eFacts", roadmapE2e.count === 1
      && hasOneNumericFact(roadmapE2e.text, /在线根 (\d+) \+ 居民/g, e2eRoot)
      && hasOneNumericFact(roadmapE2e.text, /居民 (\d+) 项/g, e2eResident)
      && hasOneNumericFact(roadmapE2e.text, /PWA (\d+) 项/g, e2ePwa)
      && hasOneNumericFact(roadmapE2e.text, /E2E 共 (\d+) 项/g, e2eTotal), roadmapE2e.text || `roadmap E2E row count=${roadmapE2e.count}`),
    check("adrIndex:objectStorageAcceptedNoGo", adrObjectStorage.count === 1
      && hasAcceptedWithoutProposed(adrObjectStorage.text)
      && /仓库实现/.test(adrObjectStorage.text)
      && /生产仍 NO-GO/.test(adrObjectStorage.text), adrObjectStorage.text || `ADR object storage row count=${adrObjectStorage.count}`),
    check("architecture:objectStorageAcceptedNoGo", architectureObjectStorage.count === 1
      && hasAcceptedWithoutProposed(architectureObjectStorage.text)
      && /OBJ-ADR-002` 已 Accepted/.test(architectureObjectStorage.text)
      && /T08 是对象存储附件元数据 data owner/.test(architectureObjectStorage.text)
      && /T00 是共享存储\/worker technical owner/.test(architectureObjectStorage.text)
      && /仓库实现已完成/.test(architectureObjectStorage.text)
      && /productionPromotionAllowed=false/.test(architectureObjectStorage.text)
      && /生产状态保持 `NO-GO`/.test(architectureObjectStorage.text), architectureObjectStorage.text || `architecture object storage section count=${architectureObjectStorage.count}`),
    check("moduleMap:apiCatalogFacts", moduleApi.count === 1
      && hasOneNumericFact(moduleApi.text, /当前目录 (\d+) 项/g, entries)
      && hasOneNumericFact(moduleApi.text, /(\d+) 个写接口/g, writeRoutes)
      && hasOneNumericFact(moduleApi.text, /(\d+) 个仍缺 endpoint 级行为证明/g, behaviorProofRequired)
      && hasOneNumericFact(moduleApi.text, /使 (\d+) 项保持复核/g, reviewRequired)
      && /全部生产 NO-GO/.test(moduleApi.text), moduleApi.text || `module map API row count=${moduleApi.count}`),
    check("moduleMap:objectStorageAcceptedNoGo", moduleObjectStorage.count === 1
      && moduleObjectStorageDecision.count === 1
      && moduleObjectStoragePort.count === 1
      && hasAcceptedWithoutProposed(moduleObjectStorageDecision.text)
      && /记录 Accepted、v17\/runtime\/API 授权和 production promotion=false/.test(moduleObjectStorageDecision.text)
      && /外部 provider\/KMS\/WORM\/扫描和现场证据仍 NO-GO/.test(moduleObjectStoragePort.text), moduleObjectStorageDecision.text || `module map object storage section count=${moduleObjectStorage.count}; decision row count=${moduleObjectStorageDecision.count}`),
    check("currentArchitecture:repositoryGovernanceFacts", currentArchitectureRepository.count === 1
      && hasOneNumericFact(currentArchitectureRepository.text, /当前闭集为 (\d+) 份 Markdown/g, markdownTotal)
      && hasOneNumericFact(currentArchitectureRepository.text, /(\d+) 份\s*`current`/g, markdownCurrent)
      && hasOneNumericFact(currentArchitectureRepository.text, /(\d+) 份\s*`snapshot`/g, markdownSnapshot)
      && hasOneNumericFact(currentArchitectureRepository.text, /(\d+) 份\s*`superseded`/g, markdownSuperseded), currentArchitectureRepository.text || `current architecture repository section count=${currentArchitectureRepository.count}`),
    check("moduleMap:repositoryGovernanceFacts", moduleRepositoryGovernance.count === 1
      && hasOneNumericFact(moduleRepositoryGovernance.text, /锁定当前 (\d+) 份 Markdown/g, markdownTotal), moduleRepositoryGovernance.text || `module map repository row count=${moduleRepositoryGovernance.count}`),
    check("moduleMap:e2eFacts", moduleE2e.count === 1
      && hasOneNumericFact(moduleE2e.text, /在线根 (\d+) 项/g, e2eRoot)
      && hasOneNumericFact(moduleE2e.text, /居民 (\d+) 项/g, e2eResident)
      && hasOneNumericFact(moduleE2e.text, /PWA (\d+) 项/g, e2ePwa)
      && hasOneNumericFact(moduleE2e.text, /三套共 (\d+) 项/g, e2eTotal), moduleE2e.text || `module map E2E row count=${moduleE2e.count}`),
    check("engineeringGovernance:e2eFacts", hasOneNumericFact(documents.engineeringGovernance, /在线根 (\d+) 项/g, e2eRoot)
      && hasOneNumericFact(documents.engineeringGovernance, /居民 (\d+) 项/g, e2eResident)
      && hasOneNumericFact(documents.engineeringGovernance, /PWA (\d+) 项/g, e2ePwa)
      && hasOneNumericFact(documents.engineeringGovernance, /三套必须形成 (\d+) 项/g, e2eTotal), "current engineering E2E partition"),
    check("currentArchitecture:e2eFacts", hasOneNumericFact(documents.currentArchitecture, /当前根 (\d+) \+ 居民/g, e2eRoot)
      && hasOneNumericFact(documents.currentArchitecture, /当前根 \d+ \+ 居民 (\d+) \+ PWA/g, e2eResident)
      && hasOneNumericFact(documents.currentArchitecture, /当前根 \d+ \+ 居民 \d+ \+ PWA (\d+) =/g, e2ePwa)
      && hasOneNumericFact(documents.currentArchitecture, /当前根 \d+ \+ 居民 \d+ \+ PWA \d+ = (\d+) 项/g, e2eTotal), "current architecture E2E partition"),
    check("dataModel:e2eFacts", hasOneNumericFact(documents.dataModel, /Playwright E2E[^\n]*根 (\d+) 项/g, e2eRoot)
      && hasOneNumericFact(documents.dataModel, /根 \d+ 项和居民 (\d+) 项/g, e2eResident)
      && hasOneNumericFact(documents.dataModel, /PWA 专项 (\d+) 项/g, e2ePwa)
      && hasOneNumericFact(documents.dataModel, /三套共 (\d+) 项/g, e2eTotal), "current data-model E2E partition"),
    check("apiMap:e2eFacts", apiMapE2e.count === 1
      && hasOneNumericFact(apiMapE2e.text, /根 (\d+) 项与居民/g, e2eRoot)
      && hasOneNumericFact(apiMapE2e.text, /居民 (\d+) 项/g, e2eResident)
      && hasOneNumericFact(apiMapE2e.text, /PWA 专项 (\d+) 项/g, e2ePwa)
      && hasOneNumericFact(apiMapE2e.text, /三套共 (\d+) 项/g, e2eTotal), apiMapE2e.text || `API map E2E section count=${apiMapE2e.count}`),
    check("dependencyMap:e2eFacts", hasOneNumericFact(documents.dependencyMap, /root runner\((\d+)\)/g, e2eRoot)
      && hasOneNumericFact(documents.dependencyMap, /resident owned runner\((\d+)\)/g, e2eResident)
      && hasOneNumericFact(documents.dependencyMap, /PWA runner\((\d+)\)/g, e2ePwa)
      && hasOneNumericFact(documents.dependencyMap, /共 (\d+) 项；三阶段/g, e2eTotal), "current dependency E2E partition"),
    check("adrIndex:e2eFacts", adrIndexE2e.count === 1
      && hasOneNumericFact(adrIndexE2e.text, /当前根 (\d+) \+/g, e2eRoot)
      && hasOneNumericFact(adrIndexE2e.text, /居民 (\d+) \+/g, e2eResident)
      && hasOneNumericFact(adrIndexE2e.text, /PWA (\d+) =/g, e2ePwa)
      && hasOneNumericFact(adrIndexE2e.text, /= (\d+) 项套件/g, e2eTotal), adrIndexE2e.text || `ADR index E2E row count=${adrIndexE2e.count}`),
    check("e2eAdr:currentFacts", e2eAdrCurrent.count === 1
      && hasOneNumericFact(e2eAdrCurrent.text, /根 (\d+) 项/g, e2eRoot)
      && hasOneNumericFact(e2eAdrCurrent.text, /居民 (\d+) 项/g, e2eResident)
      && hasOneNumericFact(e2eAdrCurrent.text, /PWA (\d+) 项/g, e2ePwa)
      && hasOneNumericFact(e2eAdrCurrent.text, /共 (\d+) 项/g, e2eTotal), e2eAdrCurrent.text || `E2E ADR current section count=${e2eAdrCurrent.count}`),
    check("dataModel:sqliteSchemaFacts", dataModelSchema.count === 1
      && hasOneNumericFact(dataModelSchema.text, /当前实际与公开 head 均为 v(\d+)/g, sqliteHead)
      && hasOneNumericFact(dataModelSchema.text, /创建 (\d+) 张表/g, sqliteTableCount), dataModelSchema.text || `data model schema section count=${dataModelSchema.count}`),
    check("dataModel:migrationFacts", dataModelMigrations.count === 1
      && hasOneNumericFact(dataModelMigrations.text, /当前为 (\d+)/g, sqliteHead)
      && hasOneNumericFact(dataModelMigrations.text, /空库 0→(\d+)/g, sqliteHead)
      && hasOneNumericFact(dataModelMigrations.text, /v11→(\d+)/g, sqliteHead)
      && hasOneNumericFact(dataModelMigrations.text, /v15→(\d+)/g, sqliteHead), dataModelMigrations.text || `data model migration section count=${dataModelMigrations.count}`),
    check("apiMap:currentMachineFacts", apiMapCurrentFacts.count === 1
      && hasOneNumericFact(apiMapCurrentFacts.text, /当前为 (\d+)/g, sqliteHead)
      && hasOneNumericFact(apiMapCurrentFacts.text, /(\d+) 个仍缺 endpoint 级行为证明/g, behaviorProofRequired)
      && hasOneNumericFact(apiMapCurrentFacts.text, /总 `review-required` 为 (\d+)/g, reviewRequired), apiMapCurrentFacts.text || `API map current facts section count=${apiMapCurrentFacts.count}`),
    check("apiMap:firstReleaseScopeFacts", apiMapReleaseScope.count === 1
      && hasOneNumericFact(apiMapReleaseScope.text, /当前 `apiReviewRequired=(\d+)`/g, scopedApiReviewRequired)
      && /`FROZEN-NO-GO`/.test(apiMapReleaseScope.text), apiMapReleaseScope.text || `API map release scope section count=${apiMapReleaseScope.count}`),
    check("techDebt:repositoryGovernanceFacts", techDebtRepositoryGovernance.count === 1
      && hasOneNumericFact(techDebtRepositoryGovernance.text, /当前 (\d+) 份 Markdown/g, markdownTotal)
      && hasOneNumericFact(techDebtRepositoryGovernance.text, /(\d+) current/g, markdownCurrent)
      && hasOneNumericFact(techDebtRepositoryGovernance.text, /(\d+) snapshot/g, markdownSnapshot)
      && hasOneNumericFact(techDebtRepositoryGovernance.text, /(\d+) superseded/g, markdownSuperseded), techDebtRepositoryGovernance.text || `tech debt DOC-001 row count=${techDebtRepositoryGovernance.count}`),
    check("dependencyMap:objectStorageAcceptedNoGo", dependencyObjectStorage.count === 1
      && hasAcceptedWithoutProposed(dependencyObjectStorage.text)
      && /T08 已确认为 data owner/.test(dependencyObjectStorage.text)
      && /架构 verifier 绑定 Accepted ADR/.test(dependencyObjectStorage.text)
      && /promotion=false/.test(dependencyObjectStorage.text)
      && /缺失即\s*失败关闭/.test(dependencyObjectStorage.text), dependencyObjectStorage.text || `dependency object storage section count=${dependencyObjectStorage.count}`),
    check("dependencyMap:objectStorageWorkerStatus", dependencyWorker.count === 1
      && hasAcceptedWithoutProposed(dependencyWorker.text)
      && /对象存储 v2 worker 已按 Accepted `OBJ-ADR-002` 完成仓库接入/.test(dependencyWorker.text)
      && /生产 readiness 继续失败关闭/.test(dependencyWorker.text), dependencyWorker.text || `dependency worker section count=${dependencyWorker.count}`)
  ];

  return {
    ok: checks.every((item) => item.passed),
    schemaVersion: "documentation-fact-drift-report.v1",
    summary: {
      documents: Object.keys(DOCUMENT_PATHS).length,
      apiCatalog: { entries, writeRoutes, behaviorProofRequired, reviewRequired },
      objectStorage: {
        decisionStatus: objectStorageReport.summary?.decisionStatus || "missing",
        implementationAuthorized: objectStorageReport.implementationAuthorized === true,
        productionReady: objectStorageReport.productionReady === true
      },
      repositoryGovernance: {
        markdownTotal,
        markdownCurrent,
        markdownSnapshot,
        markdownSuperseded,
        pdfArtifacts: repositoryGovernanceReport.pdf?.entries?.length
      },
      techDebt: {
        tableIds: techDebtIds.length,
        duplicateIds: duplicateTechDebtIds,
        lifecycleTaskIdConflicts: lifecycleIdConflicts,
        governedDocumentIdConflicts
      },
      sqliteSchema: {
        head: sqliteHead,
        tables: sqliteTableCount
      },
      e2e: {
        root: e2eRoot,
        resident: e2eResident,
        pwa: e2ePwa,
        total: e2eTotal,
        specFiles: e2eFacts.specFiles
      },
      firstReleaseScope: {
        status: productionReleaseScopeReport.status,
        apiReviewRequired: scopedApiReviewRequired,
        collectionReviewRequired: scopedCollectionReviewRequired,
        repositoryPlanMissing: scopedRepositoryPlanMissing,
        productionReady: productionReleaseScopeReport.productionReady === true
      },
      firstReleaseMigration: {
        persistentReferences: firstReleaseMigrationReport.summary?.persistentReferences,
        derivedReadModels: firstReleaseMigrationReport.summary?.derivedReadModels,
        repositoryCriticalGaps: firstReleaseMigrationReport.repositoryCriticalGaps,
        productionReady: firstReleaseMigrationReport.productionReady === true
      }
    },
    checks
  };
}

function verifyRepository(options = {}) {
  return buildReport(readRepositoryState(options));
}

if (require.main === module) {
  try {
    const report = verifyRepository();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ok) process.exitCode = 1;
  } catch (_error) {
    process.stderr.write("documentation fact drift verification failed\n");
    process.exitCode = 1;
  }
}

module.exports = {
  DOCUMENT_PATHS,
  buildE2eFacts,
  buildSqliteSchemaFacts,
  buildReport,
  readRepositoryState,
  governedMarkdownIdDefinitions,
  techDebtTableIds,
  verifyRepository
};
