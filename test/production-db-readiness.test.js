const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { buildProductionDbReadinessReport, parseArgs, renderMarkdown, writeOutput } = require("../scripts/production-db-readiness");

const ROOT = path.resolve(__dirname, "..");

test("production database readiness validates migration and rehearsal evidence", () => {
  const report = buildProductionDbReadinessReport();
  assert.equal(report.ok, true);
  assert.equal(report.productionTrack.id, "prod-storage-adapter");
  assert.equal(report.migrationEvidence.runtimePostgresBlocked, true);
  assert.equal(report.checks.some((item) => item.id === "production-db:runtimeBlock" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "production-db:sqliteSchema" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "production-db:rehearsalDocs" && item.passed), true);

  const markdown = renderMarkdown(report);
  assert.match(markdown, /Production database readiness report/);
  assert.match(markdown, /postgresql/);
  assert.match(markdown, /DATABASE_URL/);
});

test("production database readiness fails when the production track is absent", () => {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8"));
  data.productionDeploymentPlan = data.productionDeploymentPlan.filter((item) => item.id !== "prod-storage-adapter");
  const report = buildProductionDbReadinessReport({ data });
  assert.equal(report.ok, false);
  assert.equal(report.checks.some((item) => item.id === "production-db:track" && !item.passed), true);
});

test("production database readiness writes release artifacts", (t) => {
  const outputDir = path.join(ROOT, "tmp", "production-db-readiness-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const report = buildProductionDbReadinessReport();
  writeOutput(report, {
    output: path.join("tmp", "production-db-readiness-test", "production-db-readiness-report.json"),
    markdown: path.join("tmp", "production-db-readiness-test", "production-db-readiness-report.md")
  });
  const writtenJson = JSON.parse(fs.readFileSync(path.join(outputDir, "production-db-readiness-report.json"), "utf8"));
  const writtenMarkdown = fs.readFileSync(path.join(outputDir, "production-db-readiness-report.md"), "utf8");
  assert.equal(writtenJson.productionDbReadiness.ok, true);
  assert.match(writtenMarkdown, /Current storage evidence/);
});

test("production database readiness CLI parser keeps output flags", () => {
  const parsed = parseArgs(["--output=release/production-db-readiness-report.json", "--markdown=release/production-db-readiness-report.md"]);
  assert.equal(parsed.output, "release/production-db-readiness-report.json");
  assert.equal(parsed.markdown, "release/production-db-readiness-report.md");
});
