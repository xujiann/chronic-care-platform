const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { buildHospitalOperationsModuleReport, parseArgs, renderMarkdown, writeOutput } = require("../scripts/hospital-operations-module-report");

const ROOT = path.resolve(__dirname, "..");

test("hospital operations module report audits capabilities and next plan", () => {
  const report = buildHospitalOperationsModuleReport();
  assert.equal(report.ok, true);
  assert.equal(report.module.id, "hospital-operations-dispatch");
  assert.equal(report.summary.readyCapabilities, report.summary.capabilities);
  assert.equal(report.capabilities.some((item) => item.id === "signed-hospital-ingest" && item.status === "ready"), true);
  assert.equal(report.capabilities.some((item) => item.id === "site-joint-test" && item.status === "ready"), true);
  assert.equal(report.capabilities.some((item) => item.id === "production-hardening" && item.status === "ready"), true);
  assert.equal(report.capabilities.some((item) => item.id === "ops-intelligence" && item.status === "ready"), true);
  assert.equal(report.capabilities.some((item) => item.id === "governance-reporting" && item.status === "ready"), true);
  assert.equal(report.capabilities.some((item) => item.evidence.includes("/api/operations/dashboard")), true);
  assert.equal(report.nextPlan.some((item) => item.id === "production-hardening" && item.exitCriteria.includes("release:report:full")), true);
  assert.equal(report.checks.every((item) => item.passed), true);
});

test("hospital operations module report renders and writes release artifacts", (t) => {
  const outputDir = path.join(ROOT, "tmp", "hospital-operations-module-report-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const report = buildHospitalOperationsModuleReport();
  const markdown = renderMarkdown(report);
  assert.match(markdown, /医院运行监测模块功能报告/);
  assert.match(markdown, /下一步开发规划/);
  assert.match(markdown, /医院系统签名接入/);
  assert.match(markdown, /智能调度建议/);
  assert.match(markdown, /治理报表/);

  writeOutput(report, {
    output: path.join("tmp", "hospital-operations-module-report-test", "hospital-operations-module-report.json"),
    markdown: path.join("tmp", "hospital-operations-module-report-test", "hospital-operations-module-report.md")
  });

  const writtenJson = JSON.parse(fs.readFileSync(path.join(outputDir, "hospital-operations-module-report.json"), "utf8"));
  const writtenMarkdown = fs.readFileSync(path.join(outputDir, "hospital-operations-module-report.md"), "utf8");
  assert.equal(writtenJson.ok, true);
  assert.match(writtenMarkdown, /P0 现场联调/);
});

test("hospital operations module report CLI parser keeps output flags", () => {
  const parsed = parseArgs(["--output=release/hospital-operations-module-report.json", "--markdown=release/hospital-operations-module-report.md"]);
  assert.equal(parsed.output, "release/hospital-operations-module-report.json");
  assert.equal(parsed.markdown, "release/hospital-operations-module-report.md");
});
