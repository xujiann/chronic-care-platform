const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  buildPolicyCoverageReport,
  parseArgs,
  renderMarkdown,
  writeOutput
} = require("../scripts/policy-coverage");

const ROOT = path.resolve(__dirname, "..");

test("policy coverage report validates policy documents and release gates", () => {
  const report = buildPolicyCoverageReport();
  const markdown = renderMarkdown(report);

  assert.equal(report.ok, true);
  assert.equal(report.summary.policyIdsPresent, report.summary.policies);
  assert.equal(report.summary.documentsPassed, report.summary.documents);
  assert.equal(report.checks.every((item) => item.passed), true);
  assert.equal(report.documents.some((item) => item.file === "docs/maternal-child-policy.md"), true);
  assert.equal(report.documents.some((item) => item.file === "docs/医师多点执业政策说明.md"), true);
  assert.match(markdown, /Policy coverage report/);
  assert.match(markdown, /policyCoverage:documents/);
  assert.match(markdown, /docs\/maternal-child-policy\.md/);
});

test("policy coverage CLI parser and writer keep artifact paths", (t) => {
  const outputDir = path.join(ROOT, "tmp", "policy-coverage-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const parsed = parseArgs(["--output=tmp/policy-coverage-test/report.json", "--markdown=tmp/policy-coverage-test/report.md"]);

  assert.equal(parsed.output, "tmp/policy-coverage-test/report.json");
  assert.equal(parsed.markdown, "tmp/policy-coverage-test/report.md");

  const report = buildPolicyCoverageReport();
  writeOutput(report, parsed);

  const writtenJson = JSON.parse(fs.readFileSync(path.join(outputDir, "report.json"), "utf8"));
  const writtenMarkdown = fs.readFileSync(path.join(outputDir, "report.md"), "utf8");
  assert.equal(writtenJson.ok, true);
  assert.match(writtenMarkdown, /Policy documents/);
});
