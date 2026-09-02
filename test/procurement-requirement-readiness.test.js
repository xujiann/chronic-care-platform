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
  assert.equal(report.ok, true);
  assert.equal(report.localGovernanceReady, true);
  assert.equal(report.productionReady, false);
  assert.equal(report.summary.failed, 0);
  assert.equal(report.checks.every((item) => item.passed), true);
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
