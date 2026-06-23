const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { buildOperationsReadinessReport, parseArgs, renderMarkdown, writeOutput } = require("../scripts/operations-readiness");

const ROOT = path.resolve(__dirname, "..");

test("operations readiness validates production operation evidence", () => {
  const report = buildOperationsReadinessReport();
  assert.equal(report.ok, true);
  assert.equal(report.operationRoutes.every((item) => item.present && item.documented), true);
  assert.equal(report.externalDependencies.length, 6);
  assert.equal(report.productionTracks.length >= 4, true);
});

test("operations readiness fails when an operation route is not documented", () => {
  const report = buildOperationsReadinessReport({
    readme: "",
    deployment: "",
    serverSource: fs.readFileSync(path.join(ROOT, "server.js"), "utf8")
  });
  assert.equal(report.ok, false);
  assert.equal(report.checks.some((item) => item.id === "operations:routes" && !item.passed), true);
});

test("operations readiness fails when external dependency risk markers are missing", () => {
  const serverSource = fs.readFileSync(path.join(ROOT, "server.js"), "utf8").replace(/identity-source/g, "identity_source_missing");
  const report = buildOperationsReadinessReport({ serverSource });
  assert.equal(report.ok, false);
  assert.equal(report.checks.some((item) => item.id === "operations:externalDependencies" && !item.passed), true);
});

test("operations readiness renders and writes release artifacts", (t) => {
  const outputDir = path.join(ROOT, "tmp", "operations-readiness-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const report = buildOperationsReadinessReport();
  const markdown = renderMarkdown(report);
  assert.match(markdown, /Operations readiness report/);
  assert.match(markdown, /External dependency risks/);

  writeOutput(report, {
    output: path.join("tmp", "operations-readiness-test", "operations-readiness-report.json"),
    markdown: path.join("tmp", "operations-readiness-test", "operations-readiness-report.md")
  });

  const writtenJson = JSON.parse(fs.readFileSync(path.join(outputDir, "operations-readiness-report.json"), "utf8"));
  const writtenMarkdown = fs.readFileSync(path.join(outputDir, "operations-readiness-report.md"), "utf8");
  assert.equal(writtenJson.ok, true);
  assert.match(writtenMarkdown, /Production deployment tracks/);
});

test("operations readiness CLI parser keeps output flags", () => {
  const parsed = parseArgs(["--output=release/operations-readiness-report.json", "--markdown=release/operations-readiness-report.md"]);
  assert.equal(parsed.output, "release/operations-readiness-report.json");
  assert.equal(parsed.markdown, "release/operations-readiness-report.md");
});
