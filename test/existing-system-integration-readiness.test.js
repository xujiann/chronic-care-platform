const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  buildExistingSystemIntegrationReadiness,
  parseArgs,
  renderMarkdown,
  writeOutput
} = require("../scripts/existing-system-integration-readiness");

const ROOT = path.resolve(__dirname, "..");

test("existing-system integration baseline is complete but keeps production blocked", () => {
  const report = buildExistingSystemIntegrationReadiness();
  assert.equal(report.ok, true);
  assert.equal(report.productionReady, false);
  assert.equal(report.summary.systems >= 9, true);
  assert.equal(report.summary.contracts >= 7, true);
  assert.equal(report.summary.firstLoopContracts, 5);
  assert.equal(report.checks.every((item) => item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "reuse:hospital-connectors" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "architecture:no-direct-write" && item.passed), true);
  assert.equal(report.productionBlockers.length >= 5, true);
});

test("integration readiness fails when the first-loop contract is missing", () => {
  const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "existing-system-integration-baseline.json"), "utf8"));
  baseline.contracts = baseline.contracts.filter((item) => item.id !== "LIS_LAB_REPORT_PUBLISH");
  const report = buildExistingSystemIntegrationReadiness({ baseline });
  assert.equal(report.ok, false);
  assert.equal(report.checks.some((item) => item.id === "baseline:first-loop" && !item.passed), true);
});

test("integration readiness fails when an interface drops security or evidence", () => {
  const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "existing-system-integration-baseline.json"), "utf8"));
  baseline.contracts[0].security.audit = "";
  baseline.contracts[0].acceptanceEvidence = [];
  const report = buildExistingSystemIntegrationReadiness({ baseline });
  assert.equal(report.ok, false);
  assert.equal(report.checks.some((item) => item.id === "contract:security" && !item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "contract:evidence" && !item.passed), true);
});

test("integration readiness renders and writes release artifacts", (t) => {
  const outputDir = path.join(ROOT, "tmp", "existing-system-integration-readiness-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const flags = parseArgs([
    "--output=tmp/existing-system-integration-readiness-test/report.json",
    "--markdown=tmp/existing-system-integration-readiness-test/report.md"
  ]);
  const report = buildExistingSystemIntegrationReadiness();
  const markdown = renderMarkdown(report);
  assert.match(markdown, /现有系统融合实施准备度报告/);
  assert.match(markdown, /LIS_LAB_REPORT_PUBLISH/);

  writeOutput(report, flags);
  const written = JSON.parse(fs.readFileSync(path.join(outputDir, "report.json"), "utf8"));
  const writtenMarkdown = fs.readFileSync(path.join(outputDir, "report.md"), "utf8");
  assert.equal(written.ok, true);
  assert.match(writtenMarkdown, /生产阻断/);
});
