"use strict";

const crypto = require("node:crypto");
const defaultRegistry = require("../../../config/platform-capability-registry.json");
const defaultTraceCatalog = require("../../../config/procurement-requirement-trace-catalog.json");
const { buildEffectiveProcurementCatalog, baseState: catalogState } = require("./procurement-requirement-catalog-registry");
const { buildProcurementRequirementGovernance } = require("./procurement-requirement-governance");
const { buildProcurementRequirementDelivery } = require("./procurement-requirement-delivery");
const { candidateSemanticDigest } = require("./procurement-requirement-versioning");
const { validateCapabilityRegistry, validateGovernanceCatalog } = require("./procurement-requirement-contracts");

const SAFE_ID = /^[A-Za-z0-9]+(?:[._:-][A-Za-z0-9]+)*$/;
const SAFE_PAGE = /^[A-Za-z0-9][A-Za-z0-9._/-]*\.html$/;
const SAFE_TEST = /^test\/[A-Za-z0-9][A-Za-z0-9._/-]*\.test\.js$/;
const SAFE_INTERFACE = /^(?:GET|POST|PUT|PATCH|DELETE) \/api\/[A-Za-z0-9._:/-]+$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const SAFE_CAPABILITY_ID = /^[A-Z]-[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
const SAFE_REQUIREMENT_ID = /^REQ-[A-F0-9]{12}$/;
const SAFE_SOURCE_ID = /^SRC-[A-F0-9]{12}$/;
const CONFLICT_LIMIT = 5000;
const TRACE_KEYS = new Set(["capabilityId", "pages", "interfaces", "tests"]);
const DELIVERY_STATUSES = new Set(["not-planned", "awaiting-plan", "planned", "in-delivery", "evidence-review", "repository-verified", "acceptance-review", "acceptance-returned", "delivery-accepted", "source-stale"]);
const DEVIATION_CODES = new Set(["REVIEW_NOT_ACCEPTED", "REPOSITORY_COVERAGE_GAP", "CROSS_SOURCE_CONFLICT", "TRACE_OR_EVIDENCE_INCOMPLETE"]);
const DECISION_CODES = new Set(["REUSE", "ENHANCE", "BUILD", "CONFIGURE", "DEPLOY"]);

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex")}`;
}

function currentDocuments(catalog) {
  const latest = new Map();
  for (const document of catalog.documents) {
    const previous = latest.get(document.seriesId);
    if (!previous || document.revision > previous.revision) latest.set(document.seriesId, document);
  }
  return [...latest.values()].sort((left, right) => left.seriesId.localeCompare(right.seriesId));
}

function validateTraceCatalog(traceCatalog, registry = defaultRegistry) {
  if (!traceCatalog || typeof traceCatalog !== "object" || Array.isArray(traceCatalog)
    || Object.keys(traceCatalog).sort().join(",") !== "capabilities,schemaVersion"
    || traceCatalog.schemaVersion !== "procurement-requirement-trace-catalog-v1"
    || !Array.isArray(traceCatalog.capabilities) || traceCatalog.capabilities.length > 1000) throw new TypeError("procurement requirement trace catalog is invalid");
  validateCapabilityRegistry(registry);
  const registered = new Set(registry.capabilities.map((item) => item.id));
  const seen = new Set();
  for (const entry of traceCatalog.capabilities) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).some((key) => !TRACE_KEYS.has(key))) throw new TypeError("trace catalog entry contains unknown fields");
    if (!SAFE_ID.test(String(entry.capabilityId || "")) || !registered.has(entry.capabilityId) || seen.has(entry.capabilityId)) throw new TypeError("trace catalog capability is invalid");
    seen.add(entry.capabilityId);
    for (const [field, pattern, maximum] of [["pages", SAFE_PAGE, 20], ["interfaces", SAFE_INTERFACE, 50], ["tests", SAFE_TEST, 30]]) {
      if (!Array.isArray(entry[field]) || entry[field].length > maximum || new Set(entry[field]).size !== entry[field].length || entry[field].some((value) => !pattern.test(String(value)))) throw new TypeError(`trace catalog ${field} are invalid`);
    }
  }
  return true;
}

function documentBatchMap(data, catalog) {
  const result = new Map(catalog.documents.map((document) => [document.id, "BATCH-BASELINE"]));
  const state = catalogState(data.procurementRequirementCatalog);
  state.commands.forEach((command, index) => {
    for (const documentId of command.resultSnapshot.documentIds) result.set(documentId, `BATCH-${String(index + 1).padStart(6, "0")}`);
  });
  return result;
}

function currentRows(catalog, batchMap) {
  return currentDocuments(catalog).flatMap((document) => document.candidates.map((candidate) => ({
    documentId: document.id,
    batchId: batchMap.get(document.id) || "BATCH-BASELINE",
    seriesId: document.seriesId,
    sourceRevision: document.revision,
    candidate
  })));
}

function groupDuplicates(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.candidate.semanticDigest)) groups.set(row.candidate.semanticDigest, []);
    groups.get(row.candidate.semanticDigest).push(row);
  }
  return [...groups.entries()].filter(([, members]) => new Set(members.map((item) => item.seriesId)).size > 1).map(([semanticDigest, members], index) => {
    const ordered = [...members].sort((left, right) => left.candidate.logicalRequirementId.localeCompare(right.candidate.logicalRequirementId));
    return Object.freeze({
      groupId: `DUP-${String(index + 1).padStart(6, "0")}`,
      comparisonDigest: digest(semanticDigest),
      canonicalLogicalRequirementId: ordered[0].candidate.logicalRequirementId,
      memberLogicalRequirementIds: Object.freeze(ordered.map((item) => item.candidate.logicalRequirementId)),
      sourceSeries: Object.freeze([...new Set(ordered.map((item) => item.seriesId))]),
      disposition: "manual-merge-review-required",
      productionReady: false
    });
  });
}

function compareSources(rows, duplicates, conflicts) {
  const series = [...new Set(rows.map((row) => row.seriesId))].sort();
  const duplicatePairs = new Set(duplicates.flatMap((group) => {
    const values = [...group.sourceSeries].sort();
    const pairs = [];
    for (let left = 0; left < values.length; left += 1) for (let right = left + 1; right < values.length; right += 1) pairs.push(`${values[left]}:${values[right]}`);
    return pairs;
  }));
  return Object.freeze(series.flatMap((leftSeries, leftIndex) => series.slice(leftIndex + 1).map((rightSeries) => {
    const leftRows = rows.filter((row) => row.seriesId === leftSeries);
    const rightRows = rows.filter((row) => row.seriesId === rightSeries);
    const leftCapabilities = new Set(leftRows.flatMap((row) => row.candidate.targetCapabilityIds));
    const rightCapabilities = new Set(rightRows.flatMap((row) => row.candidate.targetCapabilityIds));
    const sharedCapabilityIds = [...leftCapabilities].filter((id) => rightCapabilities.has(id)).sort();
    const pair = `${leftSeries}:${rightSeries}`;
    return Object.freeze({
      comparisonId: `SOURCE-COMPARE-${digest(pair).slice(7, 19).toUpperCase()}`,
      sourceSeries: Object.freeze([leftSeries, rightSeries]),
      sharedCapabilityIds: Object.freeze(sharedCapabilityIds),
      leftOnlyCapabilityIds: Object.freeze([...leftCapabilities].filter((id) => !rightCapabilities.has(id)).sort()),
      rightOnlyCapabilityIds: Object.freeze([...rightCapabilities].filter((id) => !leftCapabilities.has(id)).sort()),
      duplicateCandidatePresent: duplicatePairs.has(pair),
      conflictCount: conflicts.items.filter((item) => item.sourceSeries[0] === leftSeries && item.sourceSeries[1] === rightSeries).length,
      disposition: "comparison-only",
      productionReady: false
    });
  })));
}

function conflictFields(left, right) {
  return ["productClass", "decision", "priority", "ownerProcess"].filter((field) => left.candidate[field] !== right.candidate[field]);
}

function identifyConflicts(rows) {
  const byCapability = new Map();
  for (const row of rows) for (const capabilityId of row.candidate.targetCapabilityIds) {
    if (!byCapability.has(capabilityId)) byCapability.set(capabilityId, []);
    byCapability.get(capabilityId).push(row);
  }
  const conflicts = [];
  const seen = new Set();
  let truncated = false;
  for (const [capabilityId, candidates] of [...byCapability.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
      const left = candidates[leftIndex];
      const right = candidates[rightIndex];
      if (left.seriesId === right.seriesId) continue;
      const ids = [left.candidate.logicalRequirementId, right.candidate.logicalRequirementId].sort();
      const fields = conflictFields(left, right);
      const key = `${capabilityId}:${ids.join(":")}`;
      if (!fields.length || seen.has(key)) continue;
      seen.add(key);
      if (conflicts.length >= CONFLICT_LIMIT) { truncated = true; continue; }
      conflicts.push(Object.freeze({
        conflictId: `CONFLICT-${digest(key).slice(7, 23).toUpperCase()}`,
        capabilityId,
        logicalRequirementIds: Object.freeze(ids),
        sourceSeries: Object.freeze([left.seriesId, right.seriesId].sort()),
        conflictingFields: Object.freeze(fields),
        disposition: "manual-resolution-required",
        productionReady: false
      }));
    }
  }
  return Object.freeze({ items: Object.freeze(conflicts), truncated });
}

function splitProposals(rows) {
  return Object.freeze(rows.filter((row) => row.candidate.targetCapabilityIds.length > 1).map((row) => Object.freeze({
    proposalId: `SPLIT-${row.candidate.logicalRequirementId.slice(4)}`,
    sourceLogicalRequirementId: row.candidate.logicalRequirementId,
    componentRequirementIds: Object.freeze([...row.candidate.targetCapabilityIds].sort().map((capabilityId, index) => `REQPART-${row.candidate.logicalRequirementId.slice(4)}-${String(index + 1).padStart(2, "0")}`)),
    targetCapabilityIds: Object.freeze([...row.candidate.targetCapabilityIds].sort()),
    disposition: "manual-split-review-required",
    productionReady: false
  })));
}

function versionInheritance(catalog) {
  const bySeries = new Map();
  for (const document of catalog.documents) {
    if (!bySeries.has(document.seriesId)) bySeries.set(document.seriesId, []);
    bySeries.get(document.seriesId).push(document);
  }
  const items = [];
  for (const [seriesId, documents] of bySeries) {
    const ordered = [...documents].sort((left, right) => left.revision - right.revision);
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = new Map(ordered[index - 1].candidates.map((candidate) => [candidate.logicalRequirementId, candidate]));
      const current = new Map(ordered[index].candidates.map((candidate) => [candidate.logicalRequirementId, candidate]));
      for (const [logicalRequirementId, candidate] of current) {
        const earlier = previous.get(logicalRequirementId);
        const unchanged = earlier && candidateSemanticDigest(earlier) === candidateSemanticDigest(candidate);
        items.push(Object.freeze({
          seriesId,
          logicalRequirementId,
          fromRevision: ordered[index - 1].revision,
          toRevision: ordered[index].revision,
          eligibility: !earlier ? "new-review-required" : unchanged ? "eligible-for-manual-confirmation" : "blocked-source-changed",
          automaticInheritance: false,
          productionReady: false
        }));
      }
      for (const logicalRequirementId of previous.keys()) if (!current.has(logicalRequirementId)) items.push(Object.freeze({
        seriesId,
        logicalRequirementId,
        fromRevision: ordered[index - 1].revision,
        toRevision: ordered[index].revision,
        eligibility: "blocked-source-withdrawn",
        automaticInheritance: false,
        productionReady: false
      }));
    }
  }
  return Object.freeze(items);
}

function traceMap(traceCatalog) {
  return new Map(traceCatalog.capabilities.map((entry) => [entry.capabilityId, entry]));
}

function buildTraceChains(governance, delivery, registry, traceCatalog) {
  const registryMap = new Map(registry.capabilities.map((item) => [item.id, item]));
  const traces = traceMap(traceCatalog);
  const deliveryMap = new Map(delivery.items.map((item) => [item.requirementId, item]));
  return Object.freeze(governance.items.map((requirement) => {
    const capabilities = requirement.targetCapabilityIds.map((capabilityId) => {
      const capability = registryMap.get(capabilityId);
      const trace = traces.get(capabilityId) || { pages: [], interfaces: [], tests: [] };
      return Object.freeze({
        capabilityId,
        coverage: capability?.coverage || "missing",
        pages: Object.freeze([...trace.pages]),
        interfaces: Object.freeze([...trace.interfaces]),
        tests: Object.freeze([...trace.tests]),
        stageStatus: Object.freeze({ page: trace.pages.length ? "linked" : "missing", interface: trace.interfaces.length ? "linked" : "missing", test: trace.tests.length ? "linked" : "missing" })
      });
    });
    const plan = deliveryMap.get(requirement.id);
    const acceptanceEvidence = ["implementation", "test", "review"].map((type) => {
      const evidence = plan?.evidence?.find((item) => item.type === type);
      return Object.freeze({ type, status: evidence?.status || "missing", digest: SHA256.test(String(evidence?.digest || "")) ? evidence.digest : null });
    });
    return Object.freeze({
      logicalRequirementId: requirement.logicalRequirementId,
      requirementId: requirement.id,
      reviewStatus: requirement.reviewStatus,
      capabilities: Object.freeze(capabilities),
      acceptanceEvidence: Object.freeze(acceptanceEvidence),
      traceComplete: capabilities.every((item) => item.pages.length && item.interfaces.length && item.tests.length) && acceptanceEvidence.every((item) => item.status === "verified"),
      siteAcceptanceStatus: "not-evaluated",
      productionReady: false
    });
  }));
}

function buildDifferenceMatrix(rows, registry) {
  const sources = [...new Set(rows.map((row) => row.seriesId))].sort();
  const sourceColumns = sources.map((seriesId, index) => Object.freeze({ sourceKey: seriesId, label: `配置单元 ${String(index + 1).padStart(3, "0")}` }));
  const registryMap = new Map(registry.capabilities.map((item) => [item.id, item]));
  const capabilities = [...new Set(rows.flatMap((row) => row.candidate.targetCapabilityIds))].sort();
  const matrixRows = capabilities.map((capabilityId) => Object.freeze({
    capabilityId,
    ownerProcess: registryMap.get(capabilityId)?.ownerProcess || "T00",
    cells: Object.freeze(sources.map((seriesId) => {
      const matched = rows.filter((row) => row.seriesId === seriesId && row.candidate.targetCapabilityIds.includes(capabilityId));
      return Object.freeze({ sourceKey: seriesId, required: matched.length > 0, decisions: Object.freeze([...new Set(matched.map((row) => row.candidate.decision))].sort()), priorities: Object.freeze([...new Set(matched.map((row) => row.candidate.priority))].sort()) });
    }))
  }));
  return Object.freeze({ sourceColumns: Object.freeze(sourceColumns), rows: Object.freeze(matrixRows) });
}

function buildImpactAnalysis(rows, conflicts, traceCatalog) {
  const traces = traceMap(traceCatalog);
  const conflictIds = new Set(conflicts.items.flatMap((item) => item.logicalRequirementIds));
  return Object.freeze(rows.map((row) => {
    const targets = row.candidate.targetCapabilityIds;
    return Object.freeze({
      logicalRequirementId: row.candidate.logicalRequirementId,
      sourceSeries: row.seriesId,
      sourceRevision: row.sourceRevision,
      priority: row.candidate.priority,
      ownerProcess: row.candidate.ownerProcess,
      affectedCapabilityIds: Object.freeze([...targets]),
      affectedPages: Object.freeze([...new Set(targets.flatMap((id) => traces.get(id)?.pages || []))].sort()),
      affectedInterfaces: Object.freeze([...new Set(targets.flatMap((id) => traces.get(id)?.interfaces || []))].sort()),
      affectedTests: Object.freeze([...new Set(targets.flatMap((id) => traces.get(id)?.tests || []))].sort()),
      conflictReviewRequired: conflictIds.has(row.candidate.logicalRequirementId),
      productionReady: false
    });
  }));
}

function safeExportBundle(portfolio) {
  const matrix = portfolio?.differenceMatrix || { sourceColumns: [], rows: [] };
  const sourceColumns = (Array.isArray(matrix.sourceColumns) ? matrix.sourceColumns : []).filter((item) => SAFE_SOURCE_ID.test(String(item.sourceKey || ""))).map((item, index) => ({ sourceKey: item.sourceKey, label: `配置单元 ${String(index + 1).padStart(3, "0")}` }));
  const allowedSources = new Set(sourceColumns.map((item) => item.sourceKey));
  const safeCapabilities = (values) => [...new Set((Array.isArray(values) ? values : []).filter((value) => SAFE_CAPABILITY_ID.test(String(value))))].sort();
  const bundle = {
    schemaVersion: "procurement-requirement-portfolio-export-v1",
    generatedAt: Number.isFinite(Date.parse(portfolio?.generatedAt)) ? portfolio.generatedAt : new Date(0).toISOString(),
    productionReady: false,
    differenceMatrix: {
      sourceColumns,
      rows: (Array.isArray(matrix.rows) ? matrix.rows : []).map((row) => ({
        capabilityId: SAFE_CAPABILITY_ID.test(String(row.capabilityId || "")) ? row.capabilityId : "UNMAPPED",
        ownerProcess: /^T0\d$/.test(String(row.ownerProcess || "")) ? row.ownerProcess : "T00",
        cells: (Array.isArray(row.cells) ? row.cells : []).filter((cell) => allowedSources.has(cell.sourceKey)).map((cell) => ({ sourceKey: cell.sourceKey, required: cell.required === true, decisions: [...new Set((Array.isArray(cell.decisions) ? cell.decisions : []).filter((value) => DECISION_CODES.has(value)))].sort(), priorities: (Array.isArray(cell.priorities) ? cell.priorities : []).filter((value) => ["P0", "P1", "P2"].includes(value)) }))
      }))
    },
    configurationPackage: {
      packageId: portfolio?.configurationPackage?.packageId === "PKG-GENERIC-HEALTH-PLATFORM" ? portfolio.configurationPackage.packageId : "PKG-GENERIC-HEALTH-PLATFORM",
      commonCapabilityIds: safeCapabilities(portfolio?.configurationPackage?.commonCapabilityIds),
      deploymentUnits: (Array.isArray(portfolio?.configurationPackage?.deploymentUnits) ? portfolio.configurationPackage.deploymentUnits : []).filter((item) => allowedSources.has(item.sourceKey)).map((item) => ({ sourceKey: item.sourceKey, enabledCapabilityIds: safeCapabilities(item.enabledCapabilityIds), manualReviewRequired: item.manualReviewRequired === true })),
      activationAuthorized: false
    },
    responseTable: (Array.isArray(portfolio?.responseTable) ? portfolio.responseTable : []).filter((item) => SAFE_REQUIREMENT_ID.test(String(item.logicalRequirementId || ""))).map((item) => ({ logicalRequirementId: item.logicalRequirementId, responseStatus: ["pending-human-review", "human-accepted", "revision-required", "rejected"].includes(item.responseStatus) ? item.responseStatus : "pending-human-review", deliveryStatus: DELIVERY_STATUSES.has(item.deliveryStatus) ? item.deliveryStatus : "not-planned", targetCapabilityIds: safeCapabilities(item.targetCapabilityIds) })),
    deviationTable: (Array.isArray(portfolio?.deviationTable) ? portfolio.deviationTable : []).filter((item) => SAFE_REQUIREMENT_ID.test(String(item.logicalRequirementId || ""))).map((item) => ({ logicalRequirementId: item.logicalRequirementId, deviationCodes: [...new Set((Array.isArray(item.deviationCodes) ? item.deviationCodes : []).filter((code) => DEVIATION_CODES.has(code)))].sort(), disposition: "manual-review-required" })),
    acceptanceChecklist: (Array.isArray(portfolio?.acceptanceChecklist) ? portfolio.acceptanceChecklist : []).filter((item) => SAFE_REQUIREMENT_ID.test(String(item.logicalRequirementId || ""))).map((item) => ({ logicalRequirementId: item.logicalRequirementId, repositoryTraceComplete: item.repositoryTraceComplete === true, evidenceVerified: item.evidenceVerified === true, siteAcceptanceStatus: "not-evaluated", productionAuthorized: false })),
    boundary: "导出仅包含中性标识、配置差异、人工治理状态和仓库证据状态；不包含原文、地域机构名称、文件路径或现场结论，不构成自动接受或生产授权。"
  };
  return Object.freeze(bundle);
}

function buildProcurementRequirementPortfolio(data = {}, options = {}) {
  const registry = options.registry || defaultRegistry;
  const traceCatalog = options.traceCatalog || defaultTraceCatalog;
  const catalog = buildEffectiveProcurementCatalog(data, { catalog: options.catalog, registry });
  validateGovernanceCatalog(catalog, { registry, rootDir: options.rootDir });
  validateTraceCatalog(traceCatalog, registry);
  const governance = options.governance || buildProcurementRequirementGovernance(data, { catalog: options.catalog, registry, now: options.now });
  const delivery = options.delivery || buildProcurementRequirementDelivery(data, { catalog: options.catalog, registry, now: options.now });
  const rows = currentRows(catalog, documentBatchMap(data, catalog));
  const duplicates = groupDuplicates(rows);
  const conflicts = identifyConflicts(rows);
  const sourceComparisons = compareSources(rows, duplicates, conflicts);
  const traces = buildTraceChains(governance, delivery, registry, traceCatalog);
  const differenceMatrix = buildDifferenceMatrix(rows, registry);
  const sourceCapabilitySets = differenceMatrix.sourceColumns.map((column) => new Set(differenceMatrix.rows.filter((row) => row.cells.find((cell) => cell.sourceKey === column.sourceKey)?.required).map((row) => row.capabilityId)));
  const commonCapabilityIds = differenceMatrix.rows.map((row) => row.capabilityId).filter((id) => sourceCapabilitySets.length && sourceCapabilitySets.every((set) => set.has(id)));
  const conflictSeries = new Set(conflicts.items.flatMap((item) => item.sourceSeries));
  const configurationPackage = Object.freeze({
    packageId: "PKG-GENERIC-HEALTH-PLATFORM",
    commonCapabilityIds: Object.freeze(commonCapabilityIds),
    deploymentUnits: Object.freeze(differenceMatrix.sourceColumns.map((column) => Object.freeze({ sourceKey: column.sourceKey, enabledCapabilityIds: Object.freeze(differenceMatrix.rows.filter((row) => row.cells.find((cell) => cell.sourceKey === column.sourceKey)?.required).map((row) => row.capabilityId)), manualReviewRequired: conflictSeries.has(column.sourceKey) }))),
    activationAuthorized: false,
    productionReady: false
  });
  const deliveryMap = new Map(delivery.items.map((item) => [item.requirementId, item]));
  const traceById = new Map(traces.map((item) => [item.requirementId, item]));
  const responseTable = governance.items.map((item) => Object.freeze({ logicalRequirementId: item.logicalRequirementId, responseStatus: item.reviewStatus === "accepted" ? "human-accepted" : item.reviewStatus === "rejected" ? "rejected" : item.reviewStatus === "revision-required" ? "revision-required" : "pending-human-review", deliveryStatus: deliveryMap.get(item.id)?.status || "not-planned", targetCapabilityIds: Object.freeze([...item.targetCapabilityIds]), productionReady: false }));
  const conflictRequirements = new Set(conflicts.items.flatMap((item) => item.logicalRequirementIds));
  const deviationTable = governance.items.map((item) => {
    const codes = [];
    if (item.reviewStatus !== "accepted") codes.push("REVIEW_NOT_ACCEPTED");
    if (item.gap?.overall !== "covered-in-repository") codes.push("REPOSITORY_COVERAGE_GAP");
    if (conflictRequirements.has(item.logicalRequirementId)) codes.push("CROSS_SOURCE_CONFLICT");
    if (!traceById.get(item.id)?.traceComplete) codes.push("TRACE_OR_EVIDENCE_INCOMPLETE");
    return codes.length ? Object.freeze({ logicalRequirementId: item.logicalRequirementId, deviationCodes: Object.freeze(codes), disposition: "manual-review-required", productionReady: false }) : null;
  }).filter(Boolean);
  const acceptanceChecklist = traces.map((trace) => Object.freeze({ logicalRequirementId: trace.logicalRequirementId, repositoryTraceComplete: trace.capabilities.every((item) => item.pages.length && item.interfaces.length && item.tests.length), evidenceVerified: trace.acceptanceEvidence.every((item) => item.status === "verified"), siteAcceptanceStatus: "not-evaluated", productionAuthorized: false }));
  const batchIds = new Set(rows.map((row) => row.batchId));
  const report = {
    schemaVersion: "procurement-requirement-portfolio-view-v1",
    generatedAt: options.now || new Date().toISOString(),
    ok: true,
    productionReady: false,
    containsRawDocument: false,
    containsLocalPath: false,
    containsRegionIdentity: false,
    summary: Object.freeze({ batches: batchIds.size, sourceSeries: differenceMatrix.sourceColumns.length, sourceComparisons: sourceComparisons.length, currentRequirements: rows.length, duplicateGroups: duplicates.length, conflicts: conflicts.items.length, conflictsTruncated: conflicts.truncated, splitProposals: splitProposals(rows).length, mergeProposals: duplicates.length, inheritanceCandidates: versionInheritance(catalog).length, completeTraceChains: traces.filter((item) => item.traceComplete).length, deviations: deviationTable.length }),
    batches: Object.freeze([...batchIds].sort().map((batchId) => Object.freeze({ batchId, documents: new Set(rows.filter((row) => row.batchId === batchId).map((row) => row.documentId)).size, sourceSeries: new Set(rows.filter((row) => row.batchId === batchId).map((row) => row.seriesId)).size, productionReady: false }))),
    duplicateGroups: Object.freeze(duplicates),
    sourceComparisons,
    conflicts,
    splitProposals: splitProposals(rows),
    mergeProposals: Object.freeze(duplicates.map((group) => Object.freeze({ proposalId: `MERGE-${group.groupId.slice(4)}`, canonicalLogicalRequirementId: group.canonicalLogicalRequirementId, memberLogicalRequirementIds: group.memberLogicalRequirementIds, disposition: "manual-merge-review-required", productionReady: false }))),
    versionInheritance: versionInheritance(catalog),
    impactAnalysis: buildImpactAnalysis(rows, conflicts, traceCatalog),
    traceChains: traces,
    differenceMatrix,
    configurationPackage,
    responseTable: Object.freeze(responseTable),
    deviationTable: Object.freeze(deviationTable),
    acceptanceChecklist: Object.freeze(acceptanceChecklist),
    boundary: "跨来源归并、拆分、合并和版本继承仅形成确定性建议，必须人工确认；现场验收与生产授权始终保持关闭。"
  };
  report.exportBundle = safeExportBundle(report);
  return Object.freeze(report);
}

module.exports = {
  buildProcurementRequirementPortfolio,
  safeExportBundle,
  validateTraceCatalog
};
