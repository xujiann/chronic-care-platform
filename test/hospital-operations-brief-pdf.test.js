const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  buildHospitalOperationsBriefPdfReport,
  countPdfPages,
  parseArgs,
  renderMarkdown,
  writeOutput
} = require("../scripts/hospital-operations-brief-pdf");

const ROOT = path.resolve(__dirname, "..");

test("hospital operations brief PDF is indexed as a two-page release artifact", () => {
  const pdf = fs.readFileSync(path.join(ROOT, "output", "pdf", "hospital-operations-module-brief-report.pdf"));
  assert.equal(countPdfPages(pdf), 2);

  const report = buildHospitalOperationsBriefPdfReport();
  assert.equal(report.ok, true);
  assert.equal(report.artifact.pdf, "output/pdf/hospital-operations-module-brief-report.pdf");
  assert.equal(report.artifact.pages, 2);
  assert.equal(report.artifact.bytes > 50000, true);
  assert.equal(report.artifact.sourceEvidence.includes("release/hospital-operations-module-report.md"), true);
  assert.equal(report.checks.every((item) => item.passed), true);
});

test("hospital operations brief PDF report renders and writes metadata", (t) => {
  const outputDir = path.join(ROOT, "tmp", "hospital-operations-brief-pdf-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));

  const report = buildHospitalOperationsBriefPdfReport();
  const markdown = renderMarkdown(report);
  assert.match(markdown, /医院运行监测平台简要 PDF 报告验收/);
  assert.match(markdown, /hospital-operations-module-brief-report\.pdf/);
  assert.match(markdown, /release\/hospital-operations-release-report\.md/);

  writeOutput(report, {
    output: path.join("tmp", "hospital-operations-brief-pdf-test", "hospital-operations-brief-pdf-report.json"),
    markdown: path.join("tmp", "hospital-operations-brief-pdf-test", "hospital-operations-brief-pdf-report.md")
  });

  const writtenJson = JSON.parse(fs.readFileSync(path.join(outputDir, "hospital-operations-brief-pdf-report.json"), "utf8"));
  const writtenMarkdown = fs.readFileSync(path.join(outputDir, "hospital-operations-brief-pdf-report.md"), "utf8");
  assert.equal(writtenJson.ok, true);
  assert.match(writtenMarkdown, /页面入口：operations\.html/);
});

test("hospital operations brief PDF CLI parser keeps artifact flags", () => {
  const parsed = parseArgs([
    "--pdf=output/pdf/hospital-operations-module-brief-report.pdf",
    "--output=release/hospital-operations-brief-pdf-report.json",
    "--markdown=release/hospital-operations-brief-pdf-report.md"
  ]);
  assert.equal(parsed.pdf, "output/pdf/hospital-operations-module-brief-report.pdf");
  assert.equal(parsed.output, "release/hospital-operations-brief-pdf-report.json");
  assert.equal(parsed.markdown, "release/hospital-operations-brief-pdf-report.md");
});
