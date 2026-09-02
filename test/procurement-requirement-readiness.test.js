"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  REQUIRED_ADR_SECTIONS,
  buildProcurementRequirementReadiness,
  findForbiddenKeys,
  localityFindings
} = require("../scripts/procurement-requirement-readiness");

test("procurement requirement governance passes local readiness and remains production NO-GO", () => {
  const report = buildProcurementRequirementReadiness();
  assert.equal(report.schemaVersion, "procurement-requirement-readiness-v2");
  assert.equal(report.ok, true);
  assert.equal(report.localGovernanceReady, true);
  assert.equal(report.productionReady, false);
  assert.equal(report.summary.failed, 0);
  assert.equal(report.summary.sourceSeries, 2);
  assert.equal(report.summary.documentRevisions, 2);
  assert.equal(report.summary.revisionComparisons, 0);
  assert.equal(report.checks.every((item) => item.passed), true);
  assert.deepEqual(report.checks.map((item) => item.id).filter((id) => id.startsWith("requirements:")), [
    "requirements:contracts",
    "requirements:production-boundary",
    "requirements:minimized-source-data",
    "requirements:adr",
    "requirements:generic-language",
    "requirements:state-ownership",
    "requirements:review-authorization",
    "requirements:offline-import-boundary",
    "requirements:offline-atomic-batch",
    "requirements:pdf-realpath-identity",
    "requirements:replaceable-scan-attestation",
    "requirements:linear-source-revisions"
  ]);
  assert.match(report.boundary, /不证明.*生产就绪/);
});

test("readiness requires the complete ADR decision record", () => {
  const incomplete = ["# ADR", "", "- 状态：Accepted", "", ...REQUIRED_ADR_SECTIONS
    .filter((section) => section !== "Risk")
    .flatMap((section) => [`## ${section}`, "", "内容"])
  ].join("\n");
  const report = buildProcurementRequirementReadiness({ adrText: incomplete });
  assert.equal(report.ok, false);
  assert.equal(report.checks.find((item) => item.id === "requirements:adr").passed, false);
});

test("readiness detects source-locality leakage and forbidden document fields", () => {
  assert.deepEqual(localityFindings({ workbench: "武汉需求工作台" }), ["workbench:武汉"]);
  assert.deepEqual(findForbiddenKeys({ documents: [{ filename: "source.pdf", candidates: [{ rawText: "content" }] }] }), [
    "$.documents[0].filename",
    "$.documents[0].candidates[0].rawText"
  ]);
  const report = buildProcurementRequirementReadiness({ uiTexts: { workbench: "上海平台需求治理" } });
  assert.equal(report.ok, false);
  assert.equal(report.checks.find((item) => item.id === "requirements:generic-language").passed, false);
});

test("readiness blocks a browser-facing PDF import surface", () => {
  const report = buildProcurementRequirementReadiness({ routeText: "router.post('/upload', multipart, procurementDocumentImport)" });
  assert.equal(report.ok, false);
  assert.equal(report.checks.find((item) => item.id === "requirements:offline-import-boundary").passed, false);
});

test("readiness requires bounded atomic batch and real-path file identity controls", () => {
  const report = buildProcurementRequirementReadiness({ importText: "", importCliText: "" });
  assert.equal(report.ok, false);
  assert.equal(report.checks.find((item) => item.id === "requirements:offline-atomic-batch").passed, false);
  assert.equal(report.checks.find((item) => item.id === "requirements:pdf-realpath-identity").passed, false);
});

test("readiness requires artifact-bound scanner evidence and derived linear revision changes", () => {
  const missingScanner = buildProcurementRequirementReadiness({ importText: "buildControlledImportBatch realpathSync.native lstatSync O_NOFOLLOW sameIdentity withinRoot(realFile, realRoot) PDF changed during inspection" });
  assert.equal(missingScanner.ok, false);
  assert.equal(missingScanner.checks.find((item) => item.id === "requirements:replaceable-scan-attestation").passed, false);

  const missingVersioning = buildProcurementRequirementReadiness({ versioningText: "" });
  assert.equal(missingVersioning.ok, false);
  assert.equal(missingVersioning.checks.find((item) => item.id === "requirements:linear-source-revisions").passed, false);
});

test("readiness rejects an unbounded batch governance configuration", () => {
  const catalog = structuredClone(require("../config/procurement-requirement-governance.json"));
  catalog.limits.maximumBatchBytes = 0;
  const report = buildProcurementRequirementReadiness({ catalog });
  assert.equal(report.ok, false);
  assert.equal(report.checks.find((item) => item.id === "requirements:contracts").passed, false);
  assert.equal(report.checks.find((item) => item.id === "requirements:offline-atomic-batch").passed, false);
});

test("readiness rejects a source series that does not begin with revision one", () => {
  const catalog = structuredClone(require("../config/procurement-requirement-governance.json"));
  catalog.documents[0].revision = 2;
  const report = buildProcurementRequirementReadiness({ catalog });
  assert.equal(report.ok, false);
  assert.equal(report.checks.find((item) => item.id === "requirements:contracts").passed, false);
  assert.equal(report.checks.find((item) => item.id === "requirements:linear-source-revisions").passed, false);
});
