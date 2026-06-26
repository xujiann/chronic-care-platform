const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  FUNCTION_DOMAINS,
  buildMaternalChildReadinessReport,
  parseArgs,
  renderMarkdown,
  writeOutput
} = require("../scripts/maternal-child-readiness");

const ROOT = path.resolve(__dirname, "..");

function baseSources() {
  return {
    about: fs.readFileSync(path.join(ROOT, "maternal-child-about.html"), "utf8"),
    moduleDoc: fs.readFileSync(path.join(ROOT, "docs", "妇幼健康全模块说明.md"), "utf8"),
    policyDoc: fs.readFileSync(path.join(ROOT, "docs", "maternal-child-policy.md"), "utf8"),
    functionReport: fs.readFileSync(path.join(ROOT, "docs", "妇幼健康主要功能报告.md"), "utf8"),
    institution: `${fs.readFileSync(path.join(ROOT, "institution.html"), "utf8")}\n${fs.readFileSync(path.join(ROOT, "institution.js"), "utf8")}`,
    citizen: `${fs.readFileSync(path.join(ROOT, "citizen.html"), "utf8")}\n${fs.readFileSync(path.join(ROOT, "citizen.js"), "utf8")}`,
    commission: `${fs.readFileSync(path.join(ROOT, "index.html"), "utf8")}\n${fs.readFileSync(path.join(ROOT, "app.js"), "utf8")}`,
    server: fs.readFileSync(path.join(ROOT, "server.js"), "utf8"),
    packageSource: fs.readFileSync(path.join(ROOT, "package.json"), "utf8")
  };
}

test("maternal child main function report validates policy, roles, API and release evidence", () => {
  const report = buildMaternalChildReadinessReport();
  const markdown = renderMarkdown(report);
  const functionIds = report.functionDomains.map((item) => item.id);

  assert.equal(report.ok, true);
  assert.equal(report.checks.every((item) => item.passed), true);
  assert.equal(report.functionDomains.length, FUNCTION_DOMAINS.length);
  assert.deepEqual(functionIds, ["commission-statistics", "institution-certificate", "citizen-lifecycle", "sharing-license", "policy-release"]);
  assert.equal(report.artifacts.about, "maternal-child-about.html");
  assert.equal(report.artifacts.policyDoc, "docs/maternal-child-policy.md");
  assert.equal(report.artifacts.functionReport, "docs/妇幼健康主要功能报告.md");
  assert.equal(report.artifacts.api.includes("/api/birth-certificates"), true);
  assert.equal(report.checks.some((item) => item.id === "docs:function-report"), true);
  assert.equal(report.checks.some((item) => item.id === "role:citizen"), true);
  assert.match(markdown, /Maternal-child main function report/);
  assert.match(markdown, /Main Functions/);
  assert.match(markdown, /maternal-child-about\.html/);
  assert.match(markdown, /docs\/maternal-child-policy\.md/);
  assert.match(markdown, /\/api\/birth-certificates/);
});

test("maternal child report fails when the main function report is missing", () => {
  const sources = baseSources();
  sources.functionReport = "";
  const report = buildMaternalChildReadinessReport({ sources });
  assert.equal(report.ok, false);
  assert.equal(report.checks.find((item) => item.id === "docs:function-report").passed, false);
});

test("maternal child readiness CLI parser and writer keep artifact paths", (t) => {
  const outputDir = path.join(ROOT, "tmp", "maternal-child-readiness-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const parsed = parseArgs(["--output=tmp/maternal-child-readiness-test/report.json", "--markdown=tmp/maternal-child-readiness-test/report.md"]);
  assert.equal(parsed.output, "tmp/maternal-child-readiness-test/report.json");
  assert.equal(parsed.markdown, "tmp/maternal-child-readiness-test/report.md");

  const report = buildMaternalChildReadinessReport();
  writeOutput(report, parsed);

  const writtenJson = JSON.parse(fs.readFileSync(path.join(outputDir, "report.json"), "utf8"));
  const writtenMarkdown = fs.readFileSync(path.join(outputDir, "report.md"), "utf8");
  assert.equal(writtenJson.ok, true);
  assert.deepEqual(writtenJson.functionDomains.map((item) => item.id), ["commission-statistics", "institution-certificate", "citizen-lifecycle", "sharing-license", "policy-release"]);
  assert.match(writtenMarkdown, /Maternal-child main function report/);
});
