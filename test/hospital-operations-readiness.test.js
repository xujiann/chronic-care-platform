const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { buildHospitalOperationsReadinessReport, parseArgs, renderMarkdown, writeOutput } = require("../scripts/hospital-operations-readiness");

const ROOT = path.resolve(__dirname, "..");

test("hospital operations readiness validates monitor dispatch and reconciliation evidence", () => {
  const report = buildHospitalOperationsReadinessReport();
  assert.equal(report.ok, true);
  assert.equal(report.checks.some((item) => item.id === "hospitalOps:collections" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "hospitalOps:apiRoutes" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "hospitalOps:interfaceMapping" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "hospitalOps:sla" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "hospitalOps:playbooks" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "hospitalOps:handover" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "hospitalOps:handoverOwners" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "hospitalOps:handoverSignoff" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "hospitalOps:performanceDetail" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "hospitalOps:integrationIngest" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "hospitalOps:siteJointTests" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "hospitalOps:productionHardening" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "hospitalOps:intelligence" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "hospitalOps:governanceReport" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "hospitalOps:nextDevelopmentResearch" && item.passed), true);
  assert.equal(report.summary.highPressure >= 1, true);
  assert.equal(report.reusedCollections.includes("healthStatisticsIngestion"), true);
});

test("hospital operations readiness detects missing dispatch evidence", () => {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8"));
  data.resourceDispatchRequests = [];
  const report = buildHospitalOperationsReadinessReport({ data });
  assert.equal(report.ok, false);
  assert.equal(report.checks.find((item) => item.id === "hospitalOps:dispatch").passed, false);
});

test("hospital operations readiness renders and writes release artifacts", (t) => {
  const outputDir = path.join(ROOT, "tmp", "hospital-operations-readiness-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const report = buildHospitalOperationsReadinessReport();
  const markdown = renderMarkdown(report);
  assert.match(markdown, /Hospital operations readiness report/);
  writeOutput(report, {
    output: path.join("tmp", "hospital-operations-readiness-test", "hospital-operations-readiness-report.json"),
    markdown: path.join("tmp", "hospital-operations-readiness-test", "hospital-operations-readiness-report.md")
  });
  const writtenJson = JSON.parse(fs.readFileSync(path.join(outputDir, "hospital-operations-readiness-report.json"), "utf8"));
  const writtenMarkdown = fs.readFileSync(path.join(outputDir, "hospital-operations-readiness-report.md"), "utf8");
  assert.equal(writtenJson.ok, true);
  assert.match(writtenMarkdown, /hospitalOps:frontend/);
});

test("hospital operations readiness CLI parser keeps output flags", () => {
  const parsed = parseArgs(["--output=release/hospital-operations-readiness-report.json", "--markdown=release/hospital-operations-readiness-report.md"]);
  assert.equal(parsed.output, "release/hospital-operations-readiness-report.json");
  assert.equal(parsed.markdown, "release/hospital-operations-readiness-report.md");
});
