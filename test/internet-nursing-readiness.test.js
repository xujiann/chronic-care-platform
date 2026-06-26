const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildInternetNursingReadinessReport,
  renderMarkdown,
  writeReport
} = require("../scripts/internet-nursing-readiness");

test("internet nursing readiness validates three-role workflow and policy evidence", () => {
  const report = buildInternetNursingReadinessReport();
  assert.equal(report.ok, true);
  assert.equal(report.boundaries.includes("online application"), true);
  assert.equal(report.boundaries.includes("nurse qualification"), true);
  assert.equal(report.summary.institutions >= 2, true);
  assert.equal(report.summary.qualifiedNurses >= 2, true);
  assert.equal(report.summary.orders >= 3, true);
  assert.equal(report.checks.some((item) => item.id === "nursing:api" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "nursing:frontend" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "nursing:authNavigation" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "nursing:moduleDoc" && item.passed), true);
  assert.match(renderMarkdown(report), /Internet nursing readiness report/);
  assert.match(renderMarkdown(report), /docs\/互联网护理服务模块说明\.md/);
});

test("internet nursing readiness writes release artifacts", (t) => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "internet-nursing-readiness-"));
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const report = buildInternetNursingReadinessReport();
  const output = path.join(outputDir, "internet-nursing-readiness-report.json");
  const markdown = path.join(outputDir, "internet-nursing-readiness-report.md");
  writeReport(report, output, markdown);
  const json = JSON.parse(fs.readFileSync(output, "utf8"));
  const md = fs.readFileSync(markdown, "utf8");
  assert.equal(json.ok, true);
  assert.equal(json.internetNursingReadiness.ok, true);
  assert.match(md, /Qualified nurses/);
});
