const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { buildHospitalOperationsReleaseReport, parseArgs, renderMarkdown, writeOutput } = require("../scripts/hospital-operations-release");

const ROOT = path.resolve(__dirname, "..");

test("hospital operations release validates all completed directions", () => {
  const report = buildHospitalOperationsReleaseReport();
  assert.equal(report.ok, true);
  assert.equal(report.releaseItems.length >= 6, true);
  assert.equal(report.checks.some((item) => item.id === "release:interfaceMapping" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "release:sla" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "release:playbooks" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "release:handover" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "release:handoverOwners" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "release:handoverSignoff" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "release:reconciliationStatuses" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "release:performanceDetail" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "release:dispatchLifecycle" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "release:hospitalIntegrationIngest" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "release:siteJointTests" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "release:productionHardening" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "release:intelligence" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "release:governanceReport" && item.passed), true);
});

test("hospital operations release detects missing package script", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  delete pkg.scripts["hospital-operations:release"];
  const report = buildHospitalOperationsReleaseReport({ pkg });
  assert.equal(report.ok, false);
  assert.equal(report.checks.find((item) => item.id === "release:packageScript").passed, false);
});

test("hospital operations release renders and writes artifacts", (t) => {
  const outputDir = path.join(ROOT, "tmp", "hospital-operations-release-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const report = buildHospitalOperationsReleaseReport();
  const markdown = renderMarkdown(report);
  assert.equal(report.releaseItems.includes("运行交接清单"), true);
  assert.match(markdown, /医院运行监测平台发布证据/);
  assert.match(markdown, /发布范围/);
  assert.match(markdown, /现场联调字段映射/);
  assert.match(markdown, /预警处置预案/);
  assert.match(markdown, /智能调度建议/);
  assert.match(markdown, /治理报表/);

  writeOutput(report, {
    output: path.join("tmp", "hospital-operations-release-test", "hospital-operations-release-report.json"),
    markdown: path.join("tmp", "hospital-operations-release-test", "hospital-operations-release-report.md")
  });

  const writtenJson = JSON.parse(fs.readFileSync(path.join(outputDir, "hospital-operations-release-report.json"), "utf8"));
  const writtenMarkdown = fs.readFileSync(path.join(outputDir, "hospital-operations-release-report.md"), "utf8");
  assert.equal(writtenJson.ok, true);
  assert.match(writtenMarkdown, /release:hospitalIntegrationIngest/);
  assert.match(writtenMarkdown, /release:performanceDetail/);
  assert.match(writtenMarkdown, /release:governanceReport/);
});

test("hospital operations release CLI parser keeps output flags", () => {
  const parsed = parseArgs(["--output=release/hospital-operations-release-report.json", "--markdown=release/hospital-operations-release-report.md"]);
  assert.equal(parsed.output, "release/hospital-operations-release-report.json");
  assert.equal(parsed.markdown, "release/hospital-operations-release-report.md");
});
