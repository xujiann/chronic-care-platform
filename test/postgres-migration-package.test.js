const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildPostgresMigrationPackage,
  parseArgs,
  verifyPostgresMigrationPackage,
  writePostgresMigrationPackage
} = require("../scripts/postgres-migration-package");

const SAMPLE = {
  residents: [{ id: "resident-1", name: "Sensitive Name", phone: "13800000000" }],
  tasks: [{ id: "task-1", status: "open" }],
  settings: { enabled: true }
};

test("PostgreSQL manifest package exposes counts and digests without record payloads", () => {
  const pkg = buildPostgresMigrationPackage({ data: SAMPLE, migrationRunId: "migration-test" });
  const serialized = JSON.stringify(pkg.manifest);
  assert.equal(pkg.ok, true);
  assert.equal(pkg.manifest.summary.records, 2);
  assert.equal(pkg.manifest.summary.snapshots, 1);
  assert.equal(pkg.manifest.secretBoundary.databaseUrlPersisted, false);
  assert.equal(pkg.manifest.target.runtimeAdapterEnabled, false);
  assert.equal(pkg.manifest.productionReady, false);
  assert.doesNotMatch(serialized, /Sensitive Name|13800000000/);
  assert.match(pkg.files["schema.sql"], /CREATE TABLE IF NOT EXISTS health_platform\.collection_records/);
  assert.match(pkg.files["rollback.sql"], /DELETE FROM health_platform\.migration_runs/);
});

test("PostgreSQL full export requires explicit sensitive-data acknowledgement", () => {
  assert.throws(() => buildPostgresMigrationPackage({ data: SAMPLE, mode: "full" }), /acknowledge-sensitive-data/);
});

test("PostgreSQL manifest package writes and verifies immutable artifacts", (t) => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "postgres-manifest-test-"));
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const pkg = buildPostgresMigrationPackage({ data: SAMPLE });
  writePostgresMigrationPackage(pkg, outputDir);
  assert.equal(verifyPostgresMigrationPackage(outputDir).ok, true);
  fs.appendFileSync(path.join(outputDir, "schema.sql"), "-- tampered\n", "utf8");
  assert.equal(verifyPostgresMigrationPackage(outputDir).ok, false);
});

test("PostgreSQL full export stays outside the repository and preserves counts", (t) => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "postgres-full-test-"));
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const pkg = buildPostgresMigrationPackage({ data: SAMPLE, mode: "full", allowSensitiveData: true });
  const written = writePostgresMigrationPackage(pkg, outputDir);
  const verification = verifyPostgresMigrationPackage(outputDir);
  assert.equal(written.manifest.mode, "full");
  assert.equal(verification.ok, true);
  assert.equal(verification.checks.some((item) => item.id === "postgresPackage:recordCounts" && item.passed), true);
  assert.match(fs.readFileSync(path.join(outputDir, "records.copy.tsv"), "utf8"), /Sensitive Name/);
});

test("PostgreSQL full export rejects repository output paths", () => {
  const pkg = buildPostgresMigrationPackage({ data: SAMPLE, mode: "full", allowSensitiveData: true });
  assert.throws(() => writePostgresMigrationPackage(pkg, path.join(__dirname, "..", "tmp", "unsafe-postgres-export")), /outside the repository/);
});

test("PostgreSQL migration CLI parser keeps secure export flags", () => {
  const parsed = parseArgs(["build", "--mode=full", "--output-dir=C:/secure/export", "--acknowledge-sensitive-data"]);
  assert.equal(parsed.command, "build");
  assert.equal(parsed.flags.mode, "full");
  assert.equal(parsed.flags["output-dir"], "C:/secure/export");
  assert.equal(parsed.flags["acknowledge-sensitive-data"], true);
});
