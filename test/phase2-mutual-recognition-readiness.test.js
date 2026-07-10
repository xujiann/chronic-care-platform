const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { buildPhase2MutualRecognitionReadiness, parseArgs, renderMarkdown, writeOutput } = require("../scripts/phase2-mutual-recognition-readiness");

const ROOT = path.resolve(__dirname, "..");

test("phase 2 mutual recognition readiness covers mapping browser decisions citations and stats", () => {
  const report = buildPhase2MutualRecognitionReadiness();
  assert.equal(report.ok, true);
  assert.equal(report.summary.catalogItems >= 78, true);
  assert.equal(report.summary.reports >= 3, true);
  assert.equal(report.summary.recognitionRecords >= 3, true);
  assert.equal(report.summary.recognized >= 1, true);
  assert.equal(report.summary.citations >= 3, true);
  assert.equal(report.checks.some((item) => item.id === "phase2MutualRecognition:citation-chain" && item.passed), true);
});

test("phase 2 mutual recognition readiness fails when the 78 item mapping is incomplete", () => {
  const report = buildPhase2MutualRecognitionReadiness({ catalog: [] });
  assert.equal(report.ok, false);
  assert.equal(report.checks.some((item) => item.id === "phase2MutualRecognition:78-item-map" && !item.passed), true);
});

test("phase 2 mutual recognition readiness fails when citations are not linked", () => {
  const report = buildPhase2MutualRecognitionReadiness({
    citations: [{ id: "broken", reportId: "missing", recognitionRecordId: "missing", catalogCode: "missing", evidenceHash: "", chainNode: "" }]
  });
  assert.equal(report.ok, false);
  assert.equal(report.checks.some((item) => item.id === "phase2MutualRecognition:citation-chain" && !item.passed), true);
});

test("phase 2 mutual recognition readiness keeps release wiring honest", () => {
  const report = buildPhase2MutualRecognitionReadiness({
    pkg: { scripts: {} },
    manifestSource: "",
    deployCheckSource: "",
    releaseReportSource: ""
  });
  assert.equal(report.ok, false);
  assert.equal(report.checks.some((item) => item.id === "phase2MutualRecognition:release-wiring" && !item.passed), true);
});

test("phase 2 mutual recognition readiness renders writes and parses output flags", (t) => {
  const outputDir = path.join(ROOT, "tmp", "phase2-mutual-recognition-readiness-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const report = buildPhase2MutualRecognitionReadiness();
  const markdown = renderMarkdown(report);
  assert.match(markdown, /Phase 2 mutual recognition readiness report/);
  assert.match(markdown, /78-item mapping/);
  assert.match(markdown, /P2-MR-001/);

  writeOutput(report, {
    output: path.join("tmp", "phase2-mutual-recognition-readiness-test", "phase2-mutual-recognition-readiness-report.json"),
    markdown: path.join("tmp", "phase2-mutual-recognition-readiness-test", "phase2-mutual-recognition-readiness-report.md")
  });

  const writtenJson = JSON.parse(fs.readFileSync(path.join(outputDir, "phase2-mutual-recognition-readiness-report.json"), "utf8"));
  const writtenMarkdown = fs.readFileSync(path.join(outputDir, "phase2-mutual-recognition-readiness-report.md"), "utf8");
  assert.equal(writtenJson.ok, true);
  assert.match(writtenMarkdown, /Citation chain/);

  const parsed = parseArgs(["--output=release/phase2-mutual-recognition-readiness-report.json", "--markdown=release/phase2-mutual-recognition-readiness-report.md"]);
  assert.equal(parsed.output, "release/phase2-mutual-recognition-readiness-report.json");
  assert.equal(parsed.markdown, "release/phase2-mutual-recognition-readiness-report.md");
});
