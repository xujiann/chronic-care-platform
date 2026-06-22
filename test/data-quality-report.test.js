const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { buildDataQualityReport, parseArgs, renderMarkdown, writeOutput } = require("../scripts/data-quality-report");

const ROOT = path.resolve(__dirname, "..");

test("data quality report validates resident master index evidence", () => {
  const report = buildDataQualityReport();
  assert.equal(report.ok, true);
  assert.equal(report.scorecard.residentIndexCompleteness, 100);
  assert.equal(report.scorecard.referencedCollections.length >= 10, true);
  assert.equal(report.scorecard.blockingIssueCount, 0);
  assert.equal(report.scorecard.closedLoopReady, true);
  assert.equal(report.checks.every((item) => item.passed), true);
});

test("data quality report fails duplicate person indexes and broken references", () => {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8"));
  data.residents[1].personIndex = data.residents[0].personIndex;
  data.personalRecords[0].residentId = "missing-resident";
  const report = buildDataQualityReport({ data });
  assert.equal(report.ok, false);
  assert.equal(report.checks.some((item) => item.id === "quality:duplicatePersonIndexes" && !item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "quality:residentReferences" && !item.passed), true);
});

test("data quality report catches personIndex mismatches", () => {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8"));
  data.personalRecords[0].personIndex = "wrong-index";
  const report = buildDataQualityReport({ data });
  assert.equal(report.ok, false);
  assert.equal(report.issues.personIndexMismatches.length >= 1, true);
});

test("data quality report renders and writes release artifacts", (t) => {
  const outputDir = path.join(ROOT, "tmp", "data-quality-report-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const report = buildDataQualityReport();
  const markdown = renderMarkdown(report);
  assert.match(markdown, /Data quality and master index report/);
  assert.match(markdown, /Resident-linked collections/);

  writeOutput(report, {
    output: path.join("tmp", "data-quality-report-test", "data-quality-report.json"),
    markdown: path.join("tmp", "data-quality-report-test", "data-quality-report.md")
  });

  const writtenJson = JSON.parse(fs.readFileSync(path.join(outputDir, "data-quality-report.json"), "utf8"));
  const writtenMarkdown = fs.readFileSync(path.join(outputDir, "data-quality-report.md"), "utf8");
  assert.equal(writtenJson.ok, true);
  assert.match(writtenMarkdown, /Issue summary/);
});

test("data quality CLI parser keeps output flags", () => {
  const parsed = parseArgs(["--output=release/data-quality-report.json", "--markdown=release/data-quality-report.md"]);
  assert.equal(parsed.output, "release/data-quality-report.json");
  assert.equal(parsed.markdown, "release/data-quality-report.md");
});
