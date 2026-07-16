const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildChronicInformatizationSourceReport,
  renderMarkdown,
  writeOutput
} = require("../scripts/chronic-informatization-sources");

const ROOT = path.resolve(__dirname, "..");

test("chronic informatization source inventory maps files to implemented capability tracks", () => {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8"));
  const report = buildChronicInformatizationSourceReport({ data });

  assert.equal(report.ok, true);
  assert.equal(report.summary.categoriesCovered, report.summary.categories);
  assert.equal(report.summary.readyCapabilityTracks, report.summary.capabilityTracks);
  assert.equal(report.summary.sources >= 12, true);
  assert.equal(report.categories.some((item) => item.id === "dalian-planning" && item.count >= 1), true);
  assert.equal(report.categories.some((item) => item.id === "repo-evidence" && item.count >= 1), true);
  const institutionIntegration = report.capabilityTracks.find((item) => item.id === "institution-integration-launch");
  assert.equal(institutionIntegration.ready, true);
  assert.equal(institutionIntegration.dataCollections.includes("personalRecords"), true);
  assert.equal(institutionIntegration.apiMarkers.includes("/api/chronic/archive-standard"), true);
  assert.equal(report.capabilityTracks.some((item) => item.id === "medication-insurance-pharmacy" && item.ready), true);
  assert.equal(report.checks.every((item) => item.passed), true);
});

test("chronic informatization source inventory fails when a capability data collection is missing", () => {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8"));
  data.chronicQualityMetrics = [];
  const report = buildChronicInformatizationSourceReport({ data });

  assert.equal(report.ok, false);
  assert.equal(report.capabilityTracks.find((item) => item.id === "monitoring-quality-public-health").ready, false);
});

test("chronic informatization source inventory renders and writes release artifacts", (t) => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "chronic-source-inventory-"));
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const report = buildChronicInformatizationSourceReport();
  const markdown = renderMarkdown(report);
  const written = writeOutput(report, {
    output: path.join(outputDir, "chronic-informatization-sources.json"),
    markdown: path.join(outputDir, "chronic-informatization-sources.md")
  });

  assert.match(markdown, /Chronic informatization source inventory/);
  assert.match(markdown, /screening-tiered-management/);
  assert.match(markdown, /institution-integration-launch/);
  assert.equal(JSON.parse(fs.readFileSync(written.output, "utf8")).ok, true);
  assert.match(fs.readFileSync(written.markdown, "utf8"), /monitoring-quality-public-health/);
});
