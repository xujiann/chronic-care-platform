const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { buildPhase2CatalogReadiness, parseArgs, renderMarkdown, writeOutput } = require("../scripts/phase2-catalog-readiness");

const ROOT = path.resolve(__dirname, "..");

test("phase 2 catalog readiness covers table mapping services lineage and rules", () => {
  const report = buildPhase2CatalogReadiness();
  assert.equal(report.ok, true);
  assert.equal(report.summary.tablesMapped >= 216, true);
  assert.equal(report.summary.dataCatalogs >= 6, true);
  assert.equal(report.summary.serviceCatalogs >= 12, true);
  assert.equal(report.summary.fieldLineage >= 10, true);
  assert.equal(report.summary.qualityRules >= 12, true);
  assert.equal(report.summary.onsiteBlockers >= 6, true);
  assert.equal(report.dataCatalogs.every((item) => item.owner && item.serviceIds.length), true);
  assert.equal(report.serviceCatalogs.some((item) => item.id === "p2svc-family-doctor-contract"), true);
});

test("phase 2 catalog readiness fails when the 216 table catalog is incomplete", () => {
  const report = buildPhase2CatalogReadiness({ dataCatalogs: [] });
  assert.equal(report.ok, false);
  assert.equal(report.checks.some((item) => item.id === "phase2Catalog:216-table-map" && !item.passed), true);
});

test("phase 2 catalog readiness keeps release wiring honest", () => {
  const report = buildPhase2CatalogReadiness({
    pkg: { scripts: {} },
    manifestSource: "",
    deployCheckSource: "",
    releaseReportSource: ""
  });
  assert.equal(report.ok, false);
  assert.equal(report.checks.some((item) => item.id === "phase2Catalog:release-wiring" && !item.passed), true);
});

test("phase 2 catalog readiness renders writes and parses output flags", (t) => {
  const outputDir = path.join(ROOT, "tmp", "phase2-catalog-readiness-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const report = buildPhase2CatalogReadiness();
  const markdown = renderMarkdown(report);
  assert.match(markdown, /Phase 2 catalog readiness report/);
  assert.match(markdown, /p2dc-lab-imaging-recognition/);
  assert.match(markdown, /p2svc-family-doctor-contract/);

  writeOutput(report, {
    output: path.join("tmp", "phase2-catalog-readiness-test", "phase2-catalog-readiness-report.json"),
    markdown: path.join("tmp", "phase2-catalog-readiness-test", "phase2-catalog-readiness-report.md")
  });

  const writtenJson = JSON.parse(fs.readFileSync(path.join(outputDir, "phase2-catalog-readiness-report.json"), "utf8"));
  const writtenMarkdown = fs.readFileSync(path.join(outputDir, "phase2-catalog-readiness-report.md"), "utf8");
  assert.equal(writtenJson.ok, true);
  assert.match(writtenMarkdown, /216-table mapping/);

  const parsed = parseArgs(["--output=release/phase2-catalog-readiness-report.json", "--markdown=release/phase2-catalog-readiness-report.md"]);
  assert.equal(parsed.output, "release/phase2-catalog-readiness-report.json");
  assert.equal(parsed.markdown, "release/phase2-catalog-readiness-report.md");
});
