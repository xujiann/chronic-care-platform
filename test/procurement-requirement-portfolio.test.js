"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const defaultCatalog = require("../config/procurement-requirement-governance.json");
const defaultTraceCatalog = require("../config/procurement-requirement-trace-catalog.json");
const {
  buildProcurementRequirementPortfolio,
  safeExportBundle,
  validateTraceCatalog
} = require("../src/platform/productization/procurement-requirement-portfolio");

const ROOT = path.resolve(__dirname, "..");
const NOW = "2026-09-03T09:00:00.000Z";

function comparisonCatalog() {
  const catalog = structuredClone(defaultCatalog);
  const first = catalog.documents[0];
  const second = catalog.documents[1];
  second.candidates[0] = {
    ...second.candidates[0],
    semanticDigest: first.candidates[0].semanticDigest,
    targetCapabilityIds: [...first.candidates[0].targetCapabilityIds],
    productClass: first.candidates[0].productClass,
    decision: first.candidates[0].decision,
    priority: first.candidates[0].priority,
    ownerProcess: first.candidates[0].ownerProcess
  };
  second.candidates[1] = {
    ...second.candidates[1],
    targetCapabilityIds: ["H-SUP-SUBJECT", "L-GOV-DEPLOY"]
  };
  catalog.documents.push({
    ...structuredClone(first),
    id: "DOC-SAMPLE-2023-001-V2",
    revision: 2,
    supersedesDocumentId: first.id,
    sha256: `sha256:${"f".repeat(64)}`,
    candidates: first.candidates.map((candidate, index) => ({ ...structuredClone(candidate), id: `PR-SAMPLE-001-V2-R00${index + 1}` }))
  });
  return catalog;
}

test("portfolio compares neutral batches and produces review-only merge, split, conflict and inheritance proposals", () => {
  const report = buildProcurementRequirementPortfolio({}, { catalog: comparisonCatalog(), now: NOW, rootDir: ROOT });
  assert.equal(report.schemaVersion, "procurement-requirement-portfolio-view-v1");
  assert.equal(report.productionReady, false);
  assert.equal(report.containsRawDocument, false);
  assert.equal(report.containsLocalPath, false);
  assert.equal(report.containsRegionIdentity, false);
  assert.equal(report.summary.sourceSeries, 2);
  assert.equal(report.summary.sourceComparisons, 1);
  assert.equal(report.summary.currentRequirements, 5);
  assert.equal(report.summary.duplicateGroups, 1);
  assert.ok(report.summary.conflicts >= 1);
  assert.equal(report.summary.splitProposals, 1);
  assert.equal(report.summary.mergeProposals, 1);
  assert.equal(report.summary.inheritanceCandidates, 3);
  assert.equal(report.duplicateGroups[0].disposition, "manual-merge-review-required");
  assert.equal(report.sourceComparisons[0].duplicateCandidatePresent, true);
  assert.ok(report.sourceComparisons[0].sharedCapabilityIds.includes("H-SUP-SUBJECT"));
  assert.ok(report.sourceComparisons[0].conflictCount >= 1);
  assert.equal(report.splitProposals[0].disposition, "manual-split-review-required");
  assert.equal(report.conflicts.items.every((item) => item.disposition === "manual-resolution-required"), true);
  assert.equal(report.versionInheritance.every((item) => item.automaticInheritance === false), true);
  assert.equal(report.versionInheritance.every((item) => item.eligibility === "eligible-for-manual-confirmation"), true);
});

test("portfolio traces requirements through capability, page, interface, tests and acceptance evidence", () => {
  const report = buildProcurementRequirementPortfolio({}, { now: NOW, rootDir: ROOT });
  const subject = report.traceChains.find((item) => item.logicalRequirementId === "REQ-000000000001");
  assert.deepEqual(subject.capabilities[0].pages, ["public-health-supervision.html"]);
  assert.deepEqual(subject.capabilities[0].interfaces, [
    "GET /api/public-health/supervision/workbench",
    "POST /api/public-health/supervision/subjects"
  ]);
  assert.ok(subject.capabilities[0].tests.includes("test/public-health-supervision-api.test.js"));
  assert.deepEqual(subject.acceptanceEvidence.map((item) => item.status), ["missing", "missing", "missing"]);
  assert.equal(subject.traceComplete, false);
  assert.equal(subject.siteAcceptanceStatus, "not-evaluated");
  const impact = report.impactAnalysis.find((item) => item.logicalRequirementId === "REQ-000000000001");
  assert.deepEqual(impact.affectedPages, ["public-health-supervision.html"]);
  assert.ok(impact.affectedInterfaces.length >= 2);
  assert.ok(impact.affectedTests.length >= 2);
  const cases = report.traceChains.find((item) => item.logicalRequirementId === "REQ-000000000003");
  assert.equal(cases.capabilities[0].coverage, "repository-verified");
  assert.deepEqual(cases.capabilities[0].pages, ["public-health-supervision-cases.html"]);
  assert.ok(cases.capabilities[0].interfaces.includes("POST /api/public-health/supervision/cases/:id/actions"));
  assert.deepEqual(cases.capabilities[0].tests, ["test/domain-workbenches.test.js"]);
});

test("repository-verified capability registry rows cite existing implementation, route and executable test files", () => {
  const registry = require("../config/platform-capability-registry.json");
  const capability = registry.capabilities.find((item) => item.id === "H-SUP-CASE");
  assert.equal(capability.coverage, "repository-verified");
  assert.deepEqual(capability.evidence, [
    "src/public-health/health-supervision/case-service.js",
    "src/http/routes/public-health/health-supervision-cases.js",
    "test/domain-workbenches.test.js"
  ]);
  assert.equal(capability.evidence.every((relative) => fs.existsSync(path.join(ROOT, relative))), true);
});

test("difference matrix and exports use only neutral source keys and cannot authorize activation", () => {
  const report = buildProcurementRequirementPortfolio({}, { now: NOW, rootDir: ROOT });
  assert.deepEqual(report.differenceMatrix.sourceColumns.map((item) => item.label), ["配置单元 001", "配置单元 002"]);
  assert.equal(report.configurationPackage.packageId, "PKG-GENERIC-HEALTH-PLATFORM");
  assert.equal(report.configurationPackage.activationAuthorized, false);
  assert.equal(report.exportBundle.productionReady, false);
  assert.equal(report.exportBundle.configurationPackage.activationAuthorized, false);
  assert.equal(report.exportBundle.acceptanceChecklist.every((item) => item.siteAcceptanceStatus === "not-evaluated" && item.productionAuthorized === false), true);
  const serialized = JSON.stringify(report.exportBundle);
  assert.doesNotMatch(serialized, /sourceAlias|regionName|projectName|tenderNo|documentRef|pageStart|sectionCode/);
});

test("safe export rebuilds a strict allowlist and removes disguised locality, paths and source text", () => {
  const bundle = safeExportBundle({
    generatedAt: NOW,
    path: "C:/OneDrive/真实地区/招标.pdf",
    raw: "招标原文",
    regionName: "真实地区",
    differenceMatrix: {
      sourceColumns: [{ sourceKey: "SRC-000000000001", label: "真实地区" }, { sourceKey: "REAL-REGION", label: "真实地区" }],
      rows: [{ capabilityId: "Dalian", ownerProcess: "T03", cells: [{ sourceKey: "SRC-000000000001", required: true, decisions: ["BUILD", "真实地区"], priorities: ["P0"] }] }]
    },
    configurationPackage: { packageId: "真实地区", commonCapabilityIds: ["H-SUP-SUBJECT", "Dalian"], deploymentUnits: [{ sourceKey: "SRC-000000000001", enabledCapabilityIds: ["H-SUP-SUBJECT", "Dalian"], manualReviewRequired: true }] },
    responseTable: [{ logicalRequirementId: "REQ-000000000001", responseStatus: "human-accepted", deliveryStatus: "delivery-accepted", targetCapabilityIds: ["H-SUP-SUBJECT", "Dalian"], title: "原文" }, { logicalRequirementId: "REAL-REGION", responseStatus: "human-accepted" }],
    deviationTable: [{ logicalRequirementId: "REQ-000000000001", deviationCodes: ["CROSS_SOURCE_CONFLICT", "REAL_REGION"] }],
    acceptanceChecklist: [{ logicalRequirementId: "REQ-000000000001", repositoryTraceComplete: true, evidenceVerified: true, siteAcceptanceStatus: "accepted", productionAuthorized: true }]
  });
  const serialized = JSON.stringify(bundle);
  assert.deepEqual(bundle.differenceMatrix.sourceColumns, [{ sourceKey: "SRC-000000000001", label: "配置单元 001" }]);
  assert.equal(bundle.differenceMatrix.rows[0].capabilityId, "UNMAPPED");
  assert.deepEqual(bundle.differenceMatrix.rows[0].cells[0].decisions, ["BUILD"]);
  assert.deepEqual(bundle.configurationPackage.commonCapabilityIds, ["H-SUP-SUBJECT"]);
  assert.deepEqual(bundle.deviationTable[0].deviationCodes, ["CROSS_SOURCE_CONFLICT"]);
  assert.equal(bundle.acceptanceChecklist[0].siteAcceptanceStatus, "not-evaluated");
  assert.equal(bundle.acceptanceChecklist[0].productionAuthorized, false);
  assert.doesNotMatch(serialized, /OneDrive|真实地区|招标原文|Dalian|REAL-REGION|REAL_REGION|C:\//);
});

test("trace catalog rejects unknown fields, unregistered capabilities and unsafe references", () => {
  assert.equal(validateTraceCatalog(defaultTraceCatalog), true);
  const unknown = structuredClone(defaultTraceCatalog);
  unknown.capabilities[0].regionName = "真实地区";
  assert.throws(() => validateTraceCatalog(unknown), /unknown fields/);
  const unsafe = structuredClone(defaultTraceCatalog);
  unsafe.capabilities[0].pages = ["../secret.html"];
  assert.throws(() => validateTraceCatalog(unsafe), /pages are invalid/);
  const unregistered = structuredClone(defaultTraceCatalog);
  unregistered.capabilities[0].capabilityId = "X-UNKNOWN";
  assert.throws(() => validateTraceCatalog(unregistered), /capability is invalid/);
});

function uiHarness() {
  const all = [];
  const document = {
    createElement(tagName) {
      const node = {
        tagName,
        className: "",
        textContent: "",
        dataset: {},
        children: [],
        disabled: false,
        listeners: {},
        append(...children) { this.children.push(...children); },
        replaceChildren(...children) { this.children = children; },
        addEventListener(type, listener) { this.listeners[type] = listener; },
        click() { this.listeners.click?.(); }
      };
      all.push(node);
      return node;
    },
    querySelector() { return null; }
  };
  const container = document.createElement("div");
  container.ownerDocument = document;
  const sandbox = { document, Date, Blob: class {}, URL: { createObjectURL: () => "blob:safe", revokeObjectURL() {} } };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, "platform-procurement-portfolio-ui.js"), "utf8"), sandbox);
  return { api: sandbox.HealthPlatformProcurementPortfolioUi, all, container };
}

test("portfolio UI renders with safe DOM primitives and rebuilds neutral browser exports", () => {
  const source = fs.readFileSync(path.join(ROOT, "platform-procurement-portfolio-ui.js"), "utf8");
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|\.style\b|window\.prompt|\beval\s*\(/);
  assert.match(source, /createElement/);
  assert.match(source, /textContent/);
  assert.match(source, /replaceChildren/);
  const fixture = uiHarness();
  const hostile = '<svg onload="globalThis.compromised=true">';
  const rendered = fixture.api.render({
    generatedAt: NOW,
    summary: { batches: 1, sourceSeries: 1, duplicateGroups: 0, conflicts: 1, completeTraceChains: 0 },
    duplicateGroups: [],
    conflicts: { items: [{ conflictId: hostile, capabilityId: hostile, conflictingFields: [hostile] }] },
    versionInheritance: [],
    impactAnalysis: [],
    traceChains: [{ logicalRequirementId: hostile, capabilities: [{ capabilityId: hostile, pages: [], interfaces: [], tests: [] }], acceptanceEvidence: [], traceComplete: false }],
    differenceMatrix: { sourceColumns: [{ sourceKey: "SRC-000000000001" }], rows: [{ capabilityId: hostile, cells: [{ sourceKey: "SRC-000000000001", required: true }] }] },
    configurationPackage: { commonCapabilityIds: [], deploymentUnits: [] },
    responseTable: [],
    deviationTable: [],
    acceptanceChecklist: []
  }, fixture.container);
  assert.equal(rendered, true);
  assert.equal(fixture.container.dataset.productionReady, "false");
  assert.equal(fixture.all.some((node) => node.textContent.includes("<svg") || node.textContent.includes("onload")), false);
  assert.equal(globalThis.compromised, undefined);
});
