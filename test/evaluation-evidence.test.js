const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { buildEvaluationEvidenceReport, parseArgs, renderMarkdown, writeOutput } = require("../scripts/evaluation-evidence");

const ROOT = path.resolve(__dirname, "..");

test("evaluation evidence report validates interoperability artifacts", () => {
  const report = buildEvaluationEvidenceReport();
  assert.equal(report.ok, true);
  assert.equal(report.interoperabilityEvidence.records.length >= 2, true);
  assert.equal(report.artifactCoverage.every((item) => item.present), true);
  assert.equal(report.p1Requirements.length >= 5, true);
  assert.equal(report.integrationContracts.length >= 7, true);
});

test("evaluation evidence report fails when interoperability records are missing", () => {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8"));
  data.platformEvidence = data.platformEvidence.map((item) => item.id === "ev-interoperability" ? { ...item, records: [] } : item);
  const report = buildEvaluationEvidenceReport({ data });
  assert.equal(report.ok, false);
  assert.equal(report.checks.some((item) => item.id === "evaluation:records" && !item.passed), true);
});

test("evaluation evidence report renders and writes release artifacts", (t) => {
  const outputDir = path.join(ROOT, "tmp", "evaluation-evidence-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const report = buildEvaluationEvidenceReport();
  const markdown = renderMarkdown(report);
  assert.match(markdown, /Interoperability evaluation evidence report/);
  assert.match(markdown, /Artifact coverage/);

  writeOutput(report, {
    output: path.join("tmp", "evaluation-evidence-test", "evaluation-evidence-report.json"),
    markdown: path.join("tmp", "evaluation-evidence-test", "evaluation-evidence-report.md")
  });

  const writtenJson = JSON.parse(fs.readFileSync(path.join(outputDir, "evaluation-evidence-report.json"), "utf8"));
  const writtenMarkdown = fs.readFileSync(path.join(outputDir, "evaluation-evidence-report.md"), "utf8");
  assert.equal(writtenJson.ok, true);
  assert.match(writtenMarkdown, /P1 interface requirements/);
});

test("evaluation evidence CLI parser keeps output flags", () => {
  const parsed = parseArgs(["--output=release/evaluation-evidence-report.json", "--markdown=release/evaluation-evidence-report.md"]);
  assert.equal(parsed.output, "release/evaluation-evidence-report.json");
  assert.equal(parsed.markdown, "release/evaluation-evidence-report.md");
});
