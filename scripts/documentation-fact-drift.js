#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { buildProductionApiCatalog, validateProductionApiCatalog } = require("./production-api-catalog");
const objectStorageGovernance = require("./object-storage-architecture-governance");
const { buildRepositoryGovernanceReport } = require("./repository-governance");

const ROOT = path.resolve(__dirname, "..");
const DOCUMENT_PATHS = Object.freeze({
  roadmap: "ROADMAP.md",
  architecture: "ARCHITECTURE.md",
  moduleMap: "MODULE_MAP.md",
  dependencyMap: "DEPENDENCY_MAP.md"
});

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

function readRepositoryState(options = {}) {
  const documents = options.documents || Object.fromEntries(Object.entries(DOCUMENT_PATHS)
    .map(([id, relative]) => [id, fs.readFileSync(path.join(ROOT, relative), "utf8")]));
  const catalog = options.catalog || buildProductionApiCatalog();
  const catalogSummary = options.catalogSummary || catalog.summary;
  const catalogErrors = options.catalogErrors || validateProductionApiCatalog(catalog);
  const objectStorageReport = options.objectStorageReport || objectStorageGovernance.verifyRepository();
  const repositoryGovernanceReport = options.repositoryGovernanceReport || buildRepositoryGovernanceReport();
  return { documents, catalogSummary, catalogErrors, objectStorageReport, repositoryGovernanceReport };
}

function buildReport(input) {
  const { documents = {}, catalogSummary = {}, catalogErrors = ["catalog validation not supplied"], objectStorageReport = {}, repositoryGovernanceReport = {} } = input || {};
  const entries = catalogSummary.entries;
  const writeRoutes = catalogSummary.writeRoutes;
  const behaviorProofRequired = catalogSummary.writeIdempotencyBehaviorProofRequired;
  const reviewRequired = catalogSummary.reviewRequired;
  const markdownTotal = repositoryGovernanceReport.markdown?.total;
  const roadmapApi = uniqueLineContaining(documents.roadmap, "| 7C | 生产 API 机器目录 |");
  const roadmapRepository = uniqueLineContaining(documents.roadmap, "| 15 | 当前工作流、Markdown 与跟踪 PDF 闭集治理 |");
  const roadmapObjectStorage = uniqueLineContaining(documents.roadmap, "| 12 | 对象存储结构化元数据与耐久命令轨道 |");
  const moduleApi = uniqueLineContaining(documents.moduleMap, "| API 生产目录 |");
  const moduleObjectStoragePort = uniqueLineContaining(documents.moduleMap, "| 安全对象存储端口 |");
  const moduleObjectStorage = uniqueSection(documents.moduleMap, "## 17. 对象存储耐久 v2 模块", "## 18. Production evidence trust provider");
  const moduleObjectStorageDecision = uniqueLineContaining(moduleObjectStorage.text, "| `config/object-storage-architecture-decision.json` |");
  const architectureObjectStorage = uniqueSection(documents.architecture, "## 已接受的对象存储 v2 方向", "## 首批生产范围合同");
  const dependencyObjectStorage = uniqueSection(documents.dependencyMap, "## 对象存储耐久 v2 依赖方向", "## Production evidence trust 依赖方向");
  const dependencyWorker = uniqueSection(documents.dependencyMap, "## Worker 共同观测依赖方向", "## 仓库文档与 PDF 治理依赖方向");

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

  const checks = [
    check("authority:apiCatalog", catalogFactsValid, catalogErrors.length
      ? catalogErrors.join("; ")
      : `${entries} entries; ${writeRoutes} writes; ${behaviorProofRequired} behavior proofs; ${reviewRequired} reviews`),
    check("authority:objectStorageDecision", objectStorageFactsValid, `${objectStorageReport.summary?.decisionStatus || "missing"}; implementation=${objectStorageReport.implementationAuthorized}; production=${objectStorageReport.productionReady}`),
    check("authority:repositoryGovernance", repositoryGovernanceReport.ok === true && Number.isSafeInteger(markdownTotal), `${markdownTotal} tracked Markdown files`),
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
        pdfArtifacts: repositoryGovernanceReport.pdf?.entries?.length
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
  buildReport,
  readRepositoryState,
  verifyRepository
};
