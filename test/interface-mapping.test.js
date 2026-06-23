const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { buildInterfaceMappingReport, parseArgs, renderMarkdown, writeOutput } = require("../scripts/interface-mapping");

const ROOT = path.resolve(__dirname, "..");

test("interface mapping validates every contract required field", () => {
  const report = buildInterfaceMappingReport();
  assert.equal(report.ok, true);
  assert.equal(report.mappings.length >= 7, true);
  assert.equal(report.mappings.every((item) => item.ready), true);
  assert.equal(report.mappings.every((item) => item.idempotencyMapped), true);
});

test("interface mapping fails when a required target collection is absent", () => {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8"));
  delete data.diagnosticReports;
  const report = buildInterfaceMappingReport({ data });
  assert.equal(report.ok, false);
  assert.equal(report.checks.some((item) => item.id === "interface-mapping:targetCollections" && !item.passed), true);
});

test("interface mapping fails when documentation artifact references are absent", () => {
  const report = buildInterfaceMappingReport({ readme: "", deployment: "" });
  assert.equal(report.ok, false);
  assert.equal(report.checks.some((item) => item.id === "interface-mapping:releaseArtifacts" && !item.passed), true);
});

test("interface mapping renders and writes release artifacts", (t) => {
  const outputDir = path.join(ROOT, "tmp", "interface-mapping-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const report = buildInterfaceMappingReport();
  const markdown = renderMarkdown(report);
  assert.match(markdown, /Interface mapping report/);
  assert.match(markdown, /Contract field mappings/);

  writeOutput(report, {
    output: path.join("tmp", "interface-mapping-test", "interface-mapping-report.json"),
    markdown: path.join("tmp", "interface-mapping-test", "interface-mapping-report.md")
  });

  const writtenJson = JSON.parse(fs.readFileSync(path.join(outputDir, "interface-mapping-report.json"), "utf8"));
  const writtenMarkdown = fs.readFileSync(path.join(outputDir, "interface-mapping-report.md"), "utf8");
  assert.equal(writtenJson.ok, true);
  assert.match(writtenMarkdown, /his-patient-v1/);
});

test("interface mapping CLI parser keeps output flags", () => {
  const parsed = parseArgs(["--output=release/interface-mapping-report.json", "--markdown=release/interface-mapping-report.md"]);
  assert.equal(parsed.output, "release/interface-mapping-report.json");
  assert.equal(parsed.markdown, "release/interface-mapping-report.md");
});
