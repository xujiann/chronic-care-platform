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
  assert.equal(report.capabilities.some((item) => item.id === "site-joint-patrol" && item.status === "ready"), true);
  assert.equal(report.capabilities.some((item) => item.id === "production-hardening" && item.status === "ready"), true);
  assert.equal(report.capabilities.some((item) => item.id === "cutover-command" && item.status === "ready"), true);
  assert.equal(report.capabilities.some((item) => item.id === "post-cutover-observation" && item.status === "ready"), true);
  assert.equal(report.capabilities.some((item) => item.id === "post-cutover-observation" && item.detail.includes("T+0 2小时")), true);
  assert.equal(report.capabilities.some((item) => item.id === "post-cutover-observation" && item.detail.includes("现场证据清单")), true);
  assert.equal(report.capabilities.some((item) => item.id === "post-cutover-observation" && item.detail.includes("证据完成率")), true);
  assert.equal(report.capabilities.some((item) => item.id === "post-cutover-observation" && item.detail.includes("逐窗口状态")), true);
  assert.equal(report.capabilities.some((item) => item.id === "post-cutover-observation" && item.detail.includes("待补证据")), true);
  assert.equal(report.capabilities.some((item) => item.id === "post-cutover-observation" && item.detail.includes("验收规则")), true);
  assert.equal(report.capabilities.some((item) => item.id === "post-cutover-observation" && item.detail.includes("签收状态")), true);
  assert.equal(report.capabilities.some((item) => item.id === "post-cutover-observation" && item.detail.includes("下一步补证动作")), true);
  assert.equal(report.capabilities.some((item) => item.id === "ops-intelligence" && item.status === "ready"), true);
  assert.equal(report.capabilities.some((item) => item.id === "cross-hospital-resource-pool" && item.status === "ready"), true);
  assert.equal(report.capabilities.some((item) => item.id === "mobile-duty-command" && item.status === "ready"), true);
  assert.equal(report.capabilities.some((item) => item.id === "governance-reporting" && item.status === "ready"), true);
  assert.equal(report.capabilities.some((item) => item.id === "governance-export-package" && item.status === "ready"), true);
  assert.equal(report.capabilities.some((item) => item.id === "next-development-research" && item.status === "ready"), true);
  assert.equal(report.capabilities.some((item) => item.evidence.includes("/api/operations/dashboard")), true);
  assert.equal(report.nextPlan.some((item) => item.id === "site-joint-test" && item.deliverable.includes("/api/operations/site-joint-patrol")), true);
  assert.equal(report.nextPlan.some((item) => item.id === "production-hardening" && item.deliverable.includes("/api/operations/cutover-command")), true);
  assert.equal(report.nextPlan.some((item) => item.id === "production-hardening" && item.deliverable.includes("/api/operations/post-cutover-observation")), true);
  assert.equal(report.nextPlan.some((item) => item.id === "production-hardening" && item.exitCriteria.includes("release:report:full")), true);
  assert.equal(report.nextPlan.some((item) => item.id === "cross-hospital-resource-market"), true);
  assert.equal(report.nextPlan.some((item) => item.id === "mobile-command" && item.deliverable.includes("/api/operations/mobile-duty")), true);
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
  assert.match(markdown, /跨院资源池/);
  assert.match(markdown, /治理报表/);
  assert.match(markdown, /治理导出包/);
  assert.match(markdown, /下一步功能研究/);

  writeOutput(report, {
    output: path.join("tmp", "hospital-operations-module-report-test", "hospital-operations-module-report.json"),
    markdown: path.join("tmp", "hospital-operations-module-report-test", "hospital-operations-module-report.md")
  });

  const writtenJson = JSON.parse(fs.readFileSync(path.join(outputDir, "hospital-operations-module-report.json"), "utf8"));
  const writtenMarkdown = fs.readFileSync(path.join(outputDir, "hospital-operations-module-report.md"), "utf8");
  assert.equal(writtenJson.ok, true);
  assert.match(writtenMarkdown, /P0 现场联调/);
  assert.match(writtenMarkdown, /P2 移动值守/);
});

test("hospital operations module report CLI parser keeps output flags", () => {
  const parsed = parseArgs(["--output=release/hospital-operations-module-report.json", "--markdown=release/hospital-operations-module-report.md"]);
  assert.equal(parsed.output, "release/hospital-operations-module-report.json");
  assert.equal(parsed.markdown, "release/hospital-operations-module-report.md");
});
