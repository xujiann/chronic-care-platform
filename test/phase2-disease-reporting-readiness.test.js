const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { buildPhase2DiseaseReportingReadiness, parseArgs, renderMarkdown, writeOutput } = require("../scripts/phase2-disease-reporting-readiness");

const ROOT = path.resolve(__dirname, "..");

test("phase 2 disease reporting readiness covers rules queue receipts patient center and stats", () => {
  const report = buildPhase2DiseaseReportingReadiness();
  assert.equal(report.ok, true);
  assert.equal(report.summary.rules >= 4, true);
  assert.equal(report.summary.reportCards >= 4, true);
  assert.equal(report.summary.receipts >= 3, true);
  assert.equal(report.summary.patientCenterRows >= 4, true);
  assert.equal(report.summary.openExceptions >= 1, true);
  assert.equal(report.checks.some((item) => item.id === "phase2DiseaseReporting:runtime-api" && item.passed), true);
});

test("phase 2 disease reporting readiness fails when trigger rules miss required categories", () => {
  const report = buildPhase2DiseaseReportingReadiness({ rules: [] });
  assert.equal(report.ok, false);
  assert.equal(report.checks.some((item) => item.id === "phase2DiseaseReporting:rule-engine" && !item.passed), true);
});

test("phase 2 disease reporting readiness fails when county receipts are not linked", () => {
  const report = buildPhase2DiseaseReportingReadiness({
    receipts: [{ id: "broken", reportId: "missing", receiptStatus: "", auditHash: "" }]
  });
  assert.equal(report.ok, false);
  assert.equal(report.checks.some((item) => item.id === "phase2DiseaseReporting:county-receipts" && !item.passed), true);
});

test("phase 2 disease reporting readiness keeps release wiring honest", () => {
  const report = buildPhase2DiseaseReportingReadiness({
    pkg: { scripts: {} },
    manifestSource: "",
    deployCheckSource: "",
    releaseReportSource: ""
  });
  assert.equal(report.ok, false);
  assert.equal(report.checks.some((item) => item.id === "phase2DiseaseReporting:release-wiring" && !item.passed), true);
});

test("phase 2 disease reporting readiness renders writes and parses output flags", (t) => {
  const outputDir = path.join(ROOT, "tmp", "phase2-disease-reporting-readiness-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const report = buildPhase2DiseaseReportingReadiness();
  const markdown = renderMarkdown(report);
  assert.match(markdown, /Phase 2 disease reporting readiness report/);
  assert.match(markdown, /Reporting queue/);
  assert.match(markdown, /County receipts/);

  writeOutput(report, {
    output: path.join("tmp", "phase2-disease-reporting-readiness-test", "phase2-disease-reporting-readiness-report.json"),
    markdown: path.join("tmp", "phase2-disease-reporting-readiness-test", "phase2-disease-reporting-readiness-report.md")
  });

  const writtenJson = JSON.parse(fs.readFileSync(path.join(outputDir, "phase2-disease-reporting-readiness-report.json"), "utf8"));
  const writtenMarkdown = fs.readFileSync(path.join(outputDir, "phase2-disease-reporting-readiness-report.md"), "utf8");
  assert.equal(writtenJson.ok, true);
  assert.match(writtenMarkdown, /Patient-center rows/);

  const parsed = parseArgs(["--output=release/phase2-disease-reporting-readiness-report.json", "--markdown=release/phase2-disease-reporting-readiness-report.md"]);
  assert.equal(parsed.output, "release/phase2-disease-reporting-readiness-report.json");
  assert.equal(parsed.markdown, "release/phase2-disease-reporting-readiness-report.md");
});
