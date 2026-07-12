#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT_DIR = path.join(ROOT, "release", "postgres-migration-package");
const FORMAT_VERSION = 1;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  const entries = Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`);
  return `{${entries.join(",")}}`;
}

function check(id, passed, detail) {
  return { id, passed: Boolean(passed), detail };
}

function collectionInventory(data = {}) {
  return Object.keys(data).sort().map((name) => {
    const value = data[name];
    const kind = Array.isArray(value) ? "records" : "snapshot";
    const count = Array.isArray(value) ? value.length : 1;
    return {
      name,
      kind,
      count,
      digest: sha256(canonicalStringify(value))
    };
  });
}

function recordKey(row, index) {
  const fields = ["id", "personIndex", "externalId", "reportNo", "indicatorCode", "code", "key"];
  const field = fields.find((name) => row && typeof row === "object" && row[name] != null && String(row[name]).trim());
  if (field) return `${field}:${String(row[field]).trim()}:${index}`;
  return `sha256:${sha256(canonicalStringify(row)).slice(0, 32)}:${index}`;
}

function copyEscape(value) {
  return String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll("\t", "\\t")
    .replaceAll("\r", "\\r")
    .replaceAll("\n", "\\n");
}

function buildRecordCopy(data, migrationRunId) {
  const lines = [];
  Object.keys(data).sort().forEach((collection) => {
    const rows = data[collection];
    if (!Array.isArray(rows)) return;
    rows.forEach((row, index) => {
      const payload = canonicalStringify(row);
      lines.push([
        migrationRunId,
        collection,
        recordKey(row, index),
        index,
        payload,
        sha256(payload)
      ].map(copyEscape).join("\t"));
    });
  });
  return lines.length ? `${lines.join("\n")}\n` : "";
}

function buildSnapshotCopy(data, migrationRunId) {
  const lines = [];
  Object.keys(data).sort().forEach((collection) => {
    const value = data[collection];
    if (Array.isArray(value)) return;
    const payload = canonicalStringify(value);
    lines.push([migrationRunId, collection, payload, sha256(payload)].map(copyEscape).join("\t"));
  });
  return lines.length ? `${lines.join("\n")}\n` : "";
}

function schemaSql() {
  return [
    "BEGIN;",
    "CREATE SCHEMA IF NOT EXISTS health_platform;",
    "CREATE TABLE IF NOT EXISTS health_platform.migration_runs (",
    "  migration_run_id text PRIMARY KEY,",
    "  source_digest char(64) NOT NULL,",
    "  format_version integer NOT NULL,",
    "  imported_at timestamptz NOT NULL DEFAULT now(),",
    "  status text NOT NULL DEFAULT 'loading' CHECK (status IN ('loading', 'validated', 'rolled-back'))",
    ");",
    "CREATE TABLE IF NOT EXISTS health_platform.collection_records (",
    "  migration_run_id text NOT NULL REFERENCES health_platform.migration_runs(migration_run_id) ON DELETE CASCADE,",
    "  collection_name text NOT NULL,",
    "  record_key text NOT NULL,",
    "  source_index integer NOT NULL CHECK (source_index >= 0),",
    "  payload jsonb NOT NULL,",
    "  payload_sha256 char(64) NOT NULL,",
    "  PRIMARY KEY (migration_run_id, collection_name, record_key)",
    ");",
    "CREATE INDEX IF NOT EXISTS collection_records_lookup_idx ON health_platform.collection_records (collection_name, record_key);",
    "CREATE INDEX IF NOT EXISTS collection_records_payload_gin_idx ON health_platform.collection_records USING gin (payload);",
    "CREATE TABLE IF NOT EXISTS health_platform.snapshot_documents (",
    "  migration_run_id text NOT NULL REFERENCES health_platform.migration_runs(migration_run_id) ON DELETE CASCADE,",
    "  collection_name text NOT NULL,",
    "  payload jsonb NOT NULL,",
    "  payload_sha256 char(64) NOT NULL,",
    "  PRIMARY KEY (migration_run_id, collection_name)",
    ");",
    "CREATE TABLE IF NOT EXISTS health_platform.runtime_sync_batches (",
    "  batch_id text PRIMARY KEY,",
    "  created_at timestamptz NOT NULL,",
    "  payload_sha256 char(64) NOT NULL,",
    "  previous_chain_hash text NOT NULL DEFAULT '',",
    "  chain_hash char(64) NOT NULL,",
    "  status text NOT NULL CHECK (status IN ('applying', 'applied')),",
    "  applied_at timestamptz",
    ");",
    "CREATE TABLE IF NOT EXISTS health_platform.runtime_collection_state (",
    "  collection_name text PRIMARY KEY,",
    "  payload jsonb NOT NULL,",
    "  payload_sha256 char(64) NOT NULL,",
    "  source_version bigint NOT NULL CHECK (source_version >= 0),",
    "  batch_id text NOT NULL REFERENCES health_platform.runtime_sync_batches(batch_id),",
    "  updated_at timestamptz NOT NULL",
    ");",
    "CREATE INDEX IF NOT EXISTS runtime_collection_state_updated_idx ON health_platform.runtime_collection_state (updated_at);",
    "COMMIT;",
    ""
  ].join("\n");
}

function loadSql() {
  return [
    "\\set ON_ERROR_STOP on",
    "\\if :{?migration_run_id}",
    "\\else",
    "  \\echo 'migration_run_id is required'",
    "  \\quit 2",
    "\\endif",
    "\\if :{?source_digest}",
    "\\else",
    "  \\echo 'source_digest is required'",
    "  \\quit 2",
    "\\endif",
    "BEGIN;",
    "INSERT INTO health_platform.migration_runs (migration_run_id, source_digest, format_version)",
    "VALUES (:'migration_run_id', :'source_digest', 1);",
    "-- Run the documented psql \\copy commands for records.copy.tsv and snapshots.copy.tsv after registering this run.",
    "-- Mark the run validated only after verify.sql returns the manifest counts.",
    "COMMIT;",
    ""
  ].join("\n");
}

function verifySql() {
  return [
    "\\set ON_ERROR_STOP on",
    "SELECT migration_run_id, source_digest, status FROM health_platform.migration_runs WHERE migration_run_id = :'migration_run_id';",
    "SELECT collection_name, count(*) AS imported_records, count(DISTINCT record_key) AS distinct_keys",
    "FROM health_platform.collection_records WHERE migration_run_id = :'migration_run_id' GROUP BY collection_name ORDER BY collection_name;",
    "SELECT collection_name, count(*) AS imported_snapshots",
    "FROM health_platform.snapshot_documents WHERE migration_run_id = :'migration_run_id' GROUP BY collection_name ORDER BY collection_name;",
    "SELECT count(*) AS invalid_record_digests FROM health_platform.collection_records",
    "WHERE migration_run_id = :'migration_run_id' AND payload_sha256 !~ '^[a-f0-9]{64}$';",
    "SELECT count(*) AS invalid_snapshot_digests FROM health_platform.snapshot_documents",
    "WHERE migration_run_id = :'migration_run_id' AND payload_sha256 !~ '^[a-f0-9]{64}$';",
    ""
  ].join("\n");
}

function rollbackSql() {
  return [
    "\\set ON_ERROR_STOP on",
    "\\if :{?migration_run_id}",
    "\\else",
    "  \\echo 'migration_run_id is required'",
    "  \\quit 2",
    "\\endif",
    "BEGIN;",
    "DELETE FROM health_platform.migration_runs WHERE migration_run_id = :'migration_run_id';",
    "COMMIT;",
    ""
  ].join("\n");
}

function packageReadme(manifest) {
  return [
    "# PostgreSQL migration package",
    "",
    `- Mode: ${manifest.mode}`,
    `- Migration run: ${manifest.migrationRunId}`,
    `- Source digest: ${manifest.source.digest}`,
    `- Collections: ${manifest.summary.collections}`,
    `- Records: ${manifest.summary.records}`,
    `- Snapshot documents: ${manifest.summary.snapshots}`,
    "- Production ready: no",
    "",
    "Manifest mode contains schemas, counts and digests only. It never contains source record payloads or database credentials.",
    "Full mode contains sensitive business data and must be generated into an access-controlled directory outside the repository with explicit acknowledgement.",
    "Apply `schema.sql`, create the migration run with `load.sql`, use psql `\\copy` for the two TSV files, compare imported counts with `manifest.json`, then run `verify.sql`.",
    "Use `rollback.sql` only with an approved migration run id and a verified pre-cutover backup.",
    "This package does not enable the PostgreSQL runtime adapter and does not represent production acceptance.",
    ""
  ].join("\n");
}

function buildPostgresMigrationPackage(options = {}) {
  const data = options.data || JSON.parse(fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8"));
  const mode = options.mode || "manifest";
  if (!['manifest', 'full'].includes(mode)) throw new Error(`unsupported PostgreSQL migration package mode: ${mode}`);
  if (mode === "full" && options.allowSensitiveData !== true) {
    throw new Error("full PostgreSQL migration export requires --acknowledge-sensitive-data");
  }
  const sourceCanonical = canonicalStringify(data);
  const sourceDigest = sha256(sourceCanonical);
  const inventory = collectionInventory(data);
  const migrationRunId = options.migrationRunId || `pdb-${sourceDigest.slice(0, 16)}`;
  const summary = {
    collections: inventory.length,
    recordCollections: inventory.filter((item) => item.kind === "records").length,
    records: inventory.filter((item) => item.kind === "records").reduce((sum, item) => sum + item.count, 0),
    snapshots: inventory.filter((item) => item.kind === "snapshot").length
  };
  const manifest = {
    formatVersion: FORMAT_VERSION,
    generatedAt: new Date().toISOString(),
    mode,
    migrationRunId,
    source: { type: "json-snapshot", digest: sourceDigest, canonicalBytes: Buffer.byteLength(sourceCanonical) },
    target: { engine: "postgresql", schema: "health_platform", runtimeAdapterEnabled: false },
    summary,
    collections: inventory,
    secretBoundary: { databaseUrlPersisted: false, credentialsPersisted: false },
    productionReady: false,
    blockers: [
      "PostgreSQL runtime adapter is not enabled",
      "masked full-volume rehearsal is not signed",
      "capacity and failover evidence is not archived",
      "database owner and release manager approval is missing"
    ]
  };
  const files = {
    "schema.sql": schemaSql(),
    "load.sql": loadSql(),
    "verify.sql": verifySql(),
    "rollback.sql": rollbackSql(),
    "README.md": packageReadme(manifest)
  };
  if (mode === "full") {
    files["records.copy.tsv"] = buildRecordCopy(data, migrationRunId);
    files["snapshots.copy.tsv"] = buildSnapshotCopy(data, migrationRunId);
  }
  const checks = [
    check("postgresPackage:inventory", summary.collections > 0 && summary.records > 0, `${summary.collections} collections / ${summary.records} records`),
    check("postgresPackage:sourceDigest", /^[a-f0-9]{64}$/.test(sourceDigest), sourceDigest),
    check("postgresPackage:secretBoundary", manifest.secretBoundary.databaseUrlPersisted === false && manifest.secretBoundary.credentialsPersisted === false, "database credentials are not persisted"),
    check("postgresPackage:runtimeBoundary", manifest.target.runtimeAdapterEnabled === false && manifest.productionReady === false, "migration tooling cannot enable production runtime"),
    check("postgresPackage:fullExport", mode === "manifest" || (files["records.copy.tsv"].split("\n").filter(Boolean).length === summary.records && files["snapshots.copy.tsv"].split("\n").filter(Boolean).length === summary.snapshots), mode)
  ];
  return { ok: checks.every((item) => item.passed), manifest, files, checks };
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function writePostgresMigrationPackage(pkg, outputDir = DEFAULT_OUTPUT_DIR) {
  const target = path.resolve(outputDir);
  if (pkg.manifest.mode === "full" && isWithin(ROOT, target)) {
    throw new Error("full PostgreSQL migration exports must be written outside the repository");
  }
  fs.mkdirSync(target, { recursive: true });
  const artifacts = {};
  Object.entries(pkg.files).forEach(([name, content]) => {
    fs.writeFileSync(path.join(target, name), content, "utf8");
    artifacts[name] = { bytes: Buffer.byteLength(content), sha256: sha256(content) };
  });
  const artifactDigest = sha256(Object.keys(artifacts).sort().map((name) => `${name}:${artifacts[name].sha256}`).join("\n"));
  const manifest = { ...pkg.manifest, artifacts, artifactDigest };
  fs.writeFileSync(path.join(target, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  return { outputDir: target, manifest };
}

function verifyPostgresMigrationPackage(outputDir = DEFAULT_OUTPUT_DIR) {
  const target = path.resolve(outputDir);
  const manifestPath = path.join(target, "manifest.json");
  if (!fs.existsSync(manifestPath)) throw new Error(`PostgreSQL migration manifest not found: ${manifestPath}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const artifactChecks = Object.entries(manifest.artifacts || {}).map(([name, expected]) => {
    const file = path.join(target, name);
    const content = fs.existsSync(file) ? fs.readFileSync(file) : null;
    return check(`postgresPackage:file:${name}`, Boolean(content && content.length === expected.bytes && sha256(content) === expected.sha256), content ? `${content.length} bytes` : "missing");
  });
  const digest = sha256(Object.keys(manifest.artifacts || {}).sort().map((name) => `${name}:${manifest.artifacts[name].sha256}`).join("\n"));
  const recordLines = manifest.mode === "full" && fs.existsSync(path.join(target, "records.copy.tsv"))
    ? fs.readFileSync(path.join(target, "records.copy.tsv"), "utf8").split("\n").filter(Boolean).length
    : 0;
  const snapshotLines = manifest.mode === "full" && fs.existsSync(path.join(target, "snapshots.copy.tsv"))
    ? fs.readFileSync(path.join(target, "snapshots.copy.tsv"), "utf8").split("\n").filter(Boolean).length
    : 0;
  const checks = [
    ...artifactChecks,
    check("postgresPackage:artifactDigest", digest === manifest.artifactDigest, digest),
    check("postgresPackage:secretBoundary", manifest.secretBoundary?.databaseUrlPersisted === false && manifest.secretBoundary?.credentialsPersisted === false, "no database credentials persisted"),
    check("postgresPackage:recordCounts", manifest.mode !== "full" || (recordLines === manifest.summary?.records && snapshotLines === manifest.summary?.snapshots), `${recordLines} records / ${snapshotLines} snapshots`),
    check("postgresPackage:productionBoundary", manifest.productionReady === false && manifest.target?.runtimeAdapterEnabled === false, "runtime remains blocked")
  ];
  return { ok: checks.every((item) => item.passed), manifest, checks };
}

function parseArgs(argv = process.argv.slice(2)) {
  const [command = "build", ...rawFlags] = argv;
  const flags = {};
  rawFlags.forEach((flag) => {
    if (!flag.startsWith("--")) return;
    const [key, ...rest] = flag.slice(2).split("=");
    flags[key] = rest.length ? rest.join("=") : true;
  });
  return { command, flags };
}

function runCli() {
  const { command, flags } = parseArgs();
  const outputDir = flags["output-dir"] || DEFAULT_OUTPUT_DIR;
  if (command === "build") {
    const pkg = buildPostgresMigrationPackage({
      mode: flags.mode || "manifest",
      allowSensitiveData: flags["acknowledge-sensitive-data"] === true,
      migrationRunId: flags["migration-run-id"]
    });
    const written = writePostgresMigrationPackage(pkg, outputDir);
    const verification = verifyPostgresMigrationPackage(written.outputDir);
    console.log(JSON.stringify({ ...written.manifest, verification }, null, 2));
    if (!pkg.ok || !verification.ok) process.exitCode = 1;
    return;
  }
  if (command === "verify") {
    const verification = verifyPostgresMigrationPackage(outputDir);
    console.log(JSON.stringify(verification, null, 2));
    if (!verification.ok) process.exitCode = 1;
    return;
  }
  throw new Error(`unsupported PostgreSQL migration package command: ${command}`);
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  DEFAULT_OUTPUT_DIR,
  buildPostgresMigrationPackage,
  canonicalStringify,
  collectionInventory,
  parseArgs,
  verifyPostgresMigrationPackage,
  writePostgresMigrationPackage
};
