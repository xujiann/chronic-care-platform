const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  applyProductionDatabaseCutoverAction,
  buildProductionDatabaseCutoverCenter,
  buildProductionDbReadinessReport,
  createProductionDatabaseCutoverRun,
  parseArgs,
  renderMarkdown,
  writeOutput
} = require("../scripts/production-db-readiness");

const ROOT = path.resolve(__dirname, "..");

test("production database readiness validates migration and rehearsal evidence", () => {
  const report = buildProductionDbReadinessReport();
  assert.equal(report.ok, true);
  assert.equal(report.productionTrack.id, "prod-storage-adapter");
  assert.equal(report.migrationEvidence.runtimePostgresBlocked, true);
  assert.equal(report.checks.some((item) => item.id === "production-db:runtimeBlock" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "production-db:sqliteSchema" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "production-db:sqliteRuntimeProfile" && item.passed), true);
  assert.equal(Object.values(report.sqliteRuntimeProfile).every(Boolean), true);
  assert.equal(report.checks.some((item) => item.id === "production-db:rehearsalDocs" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "production-db:cutoverCenter" && item.passed), true);
  assert.equal(report.cutoverCenter.summary.migrationBatches, 4);
  assert.equal(report.cutoverCenter.summary.productionReadyRuns, 0);
  assert.equal(report.postgresMigrationPackage.ok, true);
  assert.equal(report.postgresMigrationPackage.manifest.mode, "manifest");
  assert.equal(report.postgresMigrationPackage.files["records.copy.tsv"], undefined);
  assert.equal(report.checks.some((item) => item.id === "production-db:migrationPackage" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "production-db:secureFullExportBoundary" && item.passed), true);
  assert.equal(Object.values(report.postgresRuntimeSync).every(Boolean), true);
  assert.equal(report.checks.some((item) => item.id === "production-db:transactionalOutbox" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "production-db:idempotentWorker" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "production-db:workerDeployment" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "production-db:baselineBootstrap" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "production-db:shadowReconciliation" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "production-db:reconciliationCaseWorkflow" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "production-db:reconciliationOperationsUi" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "production-db:prometheusSlo" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "production-db:reconciliationScheduler" && item.passed), true);

  const markdown = renderMarkdown(report);
  assert.match(markdown, /Production database readiness report/);
  assert.match(markdown, /postgresql/);
  assert.match(markdown, /DATABASE_URL/);
  assert.match(markdown, /Production database cutover center/);
  assert.match(markdown, /SQLite production profile: configured/);
  assert.match(markdown, /PostgreSQL manifest package: verified/);
  assert.match(markdown, /Transactional PostgreSQL outbox: configured/);
  assert.match(markdown, /Baseline bootstrap: configured/);
  assert.match(markdown, /Read-only shadow reconciliation: configured/);
  assert.match(markdown, /Reconciliation case workflow: configured/);
  assert.match(markdown, /Reconciliation operations UI: configured/);
  assert.match(markdown, /Prometheus SLO metrics: configured/);
});

test("production database readiness fails when secure export boundaries are removed", () => {
  const report = buildProductionDbReadinessReport({ migrationPackageSource: "function build() {}" });
  assert.equal(report.ok, false);
  assert.equal(report.checks.some((item) => item.id === "production-db:secureFullExportBoundary" && !item.passed), true);
});

test("production database cutover rehearsal validates four samples and preserves the production gate", () => {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8"));
  const run = createProductionDatabaseCutoverRun(data, { id: "pdbcr-test", createdAt: "2026-07-10T10:00:00.000Z", createdBy: "test reviewer" });
  assert.equal(run.status, "validated-demo");
  assert.equal(run.sampleValidations.length, 4);
  assert.equal(run.sampleValidations.every((item) => item.passed && item.checksum.length === 64), true);
  assert.equal(run.productionReady, false);
  assert.equal(run.rollbackCheckpoint.status, "created-demo");

  const reviewed = applyProductionDatabaseCutoverAction(run, { action: "review", note: "sample checks reviewed" }, { name: "reviewer", role: "commission" });
  assert.equal(reviewed.run.reviewStatus, "reviewed-demo");
  assert.equal(reviewed.run.productionReady, false);
  const rollback = applyProductionDatabaseCutoverAction(reviewed.run, { action: "record-rollback", note: "rollback rehearsed", evidence: "rollback-manifest.json" }, { name: "reviewer", role: "commission" });
  assert.equal(rollback.run.rollbackCheckpoint.status, "evidence-recorded-demo");
  assert.equal(rollback.run.productionReady, false);

  const center = buildProductionDatabaseCutoverCenter({ ...data, productionDatabaseCutoverRuns: [rollback.run] });
  assert.equal(center.ok, true);
  assert.equal(center.summary.passedSamples, 4);
  assert.equal(center.summary.productionReadyRuns, 0);
});

test("production database rollback action requires evidence", () => {
  assert.throws(() => applyProductionDatabaseCutoverAction(
    { id: "pdbcr-test", rollbackCheckpoint: { id: "pdbcp-test" } },
    { action: "record-rollback", note: "missing evidence" },
    { name: "reviewer", role: "commission" }
  ), /requires evidence/);
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
