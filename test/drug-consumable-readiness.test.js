const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { buildDrugConsumableReadinessReport, normalizeStatus, renderMarkdown, writeOutput } = require("../scripts/drug-consumable-readiness");

const ROOT = path.resolve(__dirname, "..");

test("drug consumable readiness covers required supervision boundaries", () => {
  const report = buildDrugConsumableReadinessReport();

  assert.equal(report.ok, true);
  assert.equal(report.requiredBoundaries.includes("rational-medication"), true);
  assert.equal(report.requiredBoundaries.includes("fixed-pharmacy"), true);
  assert.equal(report.requiredBoundaries.includes("consumable-clue"), true);
  assert.equal(report.requiredBoundaries.includes("insurance-settlement"), true);
  assert.equal(report.requiredBoundaries.includes("remediation-loop"), true);
  assert.equal(report.summary.supervisionRows >= 3, true);
  assert.equal(report.summary.traceabilityPolicySources >= 5, true);
  assert.equal(report.summary.traceabilityEvidenceRequirements >= 5, true);
  assert.equal(report.summary.traceabilityEvidenceReady >= 5, true);
  assert.equal(report.summary.traceabilitySubmissionReady, true);
  assert.equal(report.summary.traceabilityCoverageReady, true);
  assert.equal(report.summary.workflowReuseReady, true);
  assert.equal(report.summary.institutionRemediationReady, true);
  assert.equal(report.linkedRows.every((item) => item.auditTrailPresent), true);
  assert.equal(report.checks.some((item) => item.id === "drug-consumable:workflow-reuse" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "drug-consumable:traceability-policy" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "drug-consumable:traceability-evidence" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "drug-consumable:traceability-submission" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "drug-consumable:traceability-coverage" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "drug-consumable:frontend" && item.passed), true);
  assert.equal(report.traceabilityEvidenceChecklist.some((item) => item.id === "trace-consumable-catalog" && item.ready), true);
  assert.equal(report.traceabilityEvidenceChecklist.every((item) => item.rowCount > 0), true);
  assert.equal(report.policySources.some((item) => item.documentNo === "医保发〔2025〕7号"), true);
  assert.equal(report.policySources.some((item) => item.documentNo === "NMPAB/T 1011-2022"), true);
  assert.equal(normalizeStatus("pending-review"), "pending");
  assert.equal(normalizeStatus("completed"), "closed");

  const markdown = renderMarkdown(report);
  assert.match(markdown, /Drug consumable readiness report/);
  assert.match(markdown, /Supervision links/);
  assert.match(markdown, /Traceability policy sources/);
  assert.match(markdown, /Traceability evidence requirements/);
  assert.match(markdown, /trace-code-mapping/);
  assert.match(markdown, /医保发〔2025〕7号/);
  assert.match(markdown, /dcs-consumable-mr1/);
});

test("drug consumable readiness writes release artifacts", (t) => {
  const outputDir = path.join(ROOT, "tmp", "drug-consumable-readiness-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const report = buildDrugConsumableReadinessReport();

  writeOutput(report, {
    output: path.join("tmp", "drug-consumable-readiness-test", "drug-consumable-readiness-report.json"),
    markdown: path.join("tmp", "drug-consumable-readiness-test", "drug-consumable-readiness-report.md")
  });

  const json = JSON.parse(fs.readFileSync(path.join(outputDir, "drug-consumable-readiness-report.json"), "utf8"));
  const markdown = fs.readFileSync(path.join(outputDir, "drug-consumable-readiness-report.md"), "utf8");
  assert.equal(json.ok, true);
  assert.equal(json.traceabilityEvidenceChecklist.some((item) => item.id === "trace-remediation-audit" && item.ready), true);
  assert.match(markdown, /rational-medication/);
  assert.match(markdown, /trace-remediation-audit/);
  assert.match(markdown, /NMPAB\/T 1011-2022/);
});
