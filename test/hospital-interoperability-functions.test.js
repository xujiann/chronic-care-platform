const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  REQUIRED_FUNCTIONS,
  buildHospitalInteroperabilityFunctionsReport,
  parseArgs,
  renderMarkdown,
  writeOutput
} = require("../scripts/hospital-interoperability-functions");

const ROOT = path.resolve(__dirname, "..");

test("hospital interoperability report maps hospital systems to management functions", () => {
  const report = buildHospitalInteroperabilityFunctionsReport();
  assert.equal(report.ok, true);
  assert.equal(report.functionCount >= REQUIRED_FUNCTIONS.length, true);
  assert.equal(report.actionCount >= 18, true);
  assert.equal(report.sourceSystemCount >= 8, true);
  assert.equal(report.functions.every((item) => item.ready), true);
  assert.equal(report.functions.some((item) => item.functionName === "医疗质量与安全监管" && item.sourceSystems.includes("PACS")), true);
  assert.equal(report.functions.some((item) => item.functionName === "公共卫生与慢病管理" && item.platformCollections.includes("chronicManagementPlans")), true);
});

test("hospital interoperability report fails when a platform collection is absent", () => {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8"));
  delete data.researchDatasets;
  const report = buildHospitalInteroperabilityFunctionsReport({ data });
  assert.equal(report.ok, false);
  assert.equal(report.checks.some((item) => item.id === "hospital-functions:collections" && !item.passed), true);
});

test("hospital interoperability report renders and writes release artifacts", (t) => {
  const outputDir = path.join(ROOT, "tmp", "hospital-interoperability-functions-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const report = buildHospitalInteroperabilityFunctionsReport();
  const markdown = renderMarkdown(report);
  assert.match(markdown, /Hospital interoperability management functions report/);
  assert.match(markdown, /Function mapping/);

  writeOutput(report, {
    output: path.join("tmp", "hospital-interoperability-functions-test", "hospital-interoperability-functions-report.json"),
    markdown: path.join("tmp", "hospital-interoperability-functions-test", "hospital-interoperability-functions-report.md")
  });

  const writtenJson = JSON.parse(fs.readFileSync(path.join(outputDir, "hospital-interoperability-functions-report.json"), "utf8"));
  const writtenMarkdown = fs.readFileSync(path.join(outputDir, "hospital-interoperability-functions-report.md"), "utf8");
  assert.equal(writtenJson.ok, true);
  assert.match(writtenMarkdown, /医疗质量与安全监管/);
});

test("hospital interoperability CLI parser keeps output flags", () => {
  const parsed = parseArgs(["--output=release/hospital-interoperability-functions-report.json", "--markdown=release/hospital-interoperability-functions-report.md"]);
  assert.equal(parsed.output, "release/hospital-interoperability-functions-report.json");
  assert.equal(parsed.markdown, "release/hospital-interoperability-functions-report.md");
});
