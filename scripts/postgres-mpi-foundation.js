#!/usr/bin/env node
const { createHash, randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  buildMpiResidentRows,
  DEFAULT_HASH_KEY_VERSION,
  DEFAULT_NAMESPACE_KEY_VERSION,
  MPI_RULE_VERSION,
  normalizeHashKeys,
  normalizeKeyVersion
} = require("../postgres-mpi-foundation");
const { canonicalStringify } = require("./postgres-migration-package");

const ROOT = path.resolve(__dirname, "..");
const FORMAT_VERSION = 1;
const DEFAULT_OUTPUT_DIR = path.join(ROOT, "release", "postgres-mpi-foundation");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function check(id, passed, detail) {
  return { id, passed: Boolean(passed), detail };
}

function sqlSchema() {
  return [
    "BEGIN;",
    "CREATE SCHEMA IF NOT EXISTS health_master;",
    "CREATE TABLE IF NOT EXISTS health_master.mpi_migration_runs (",
    "  migration_run_id text PRIMARY KEY,",
    "  source_digest char(64) NOT NULL CHECK (source_digest ~ '^[a-f0-9]{64}$'),",
    "  rule_version text NOT NULL,",
    "  identity_hash_key_versions jsonb NOT NULL CHECK (jsonb_typeof(identity_hash_key_versions) = 'array'),",
    "  namespace_key_version text NOT NULL,",
    "  status text NOT NULL DEFAULT 'loading' CHECK (status IN ('loading', 'validated', 'rolled-back')),",
    "  created_at timestamptz NOT NULL DEFAULT now(),",
    "  validated_at timestamptz",
    ");",
    "CREATE TABLE IF NOT EXISTS health_master.resident_master (",
    "  mpi_id varchar(40) PRIMARY KEY,",
    "  source_system varchar(120) NOT NULL,",
    "  source_record_id varchar(160) NOT NULL,",
    "  mpi_namespace_key_version varchar(80) NOT NULL,",
    "  canonical_name varchar(160) NOT NULL,",
    "  birth_date date,",
    "  gender_code char(1) NOT NULL DEFAULT 'U' CHECK (gender_code IN ('M', 'F', 'U')),",
    "  status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'merged', 'inactive')),",
    "  merged_into_mpi_id varchar(40) REFERENCES health_master.resident_master(mpi_id) ON DELETE RESTRICT,",
    "  created_by_run_id text NOT NULL REFERENCES health_master.mpi_migration_runs(migration_run_id) ON DELETE RESTRICT,",
    "  created_at timestamptz NOT NULL DEFAULT now(),",
    "  updated_at timestamptz NOT NULL DEFAULT now(),",
    "  UNIQUE (source_system, source_record_id),",
    "  CHECK (merged_into_mpi_id IS NULL OR merged_into_mpi_id <> mpi_id),",
    "  CHECK ((status = 'merged') = (merged_into_mpi_id IS NOT NULL))",
    ");",
    "CREATE INDEX IF NOT EXISTS resident_master_status_idx ON health_master.resident_master (status, updated_at DESC);",
    "CREATE TABLE IF NOT EXISTS health_master.resident_identifier (",
    "  identifier_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,",
    "  mpi_id varchar(40) NOT NULL REFERENCES health_master.resident_master(mpi_id) ON DELETE RESTRICT,",
    "  identifier_type varchar(40) NOT NULL CHECK (identifier_type IN ('national-id', 'health-code', 'mobile', 'source-record')),",
    "  issuing_authority varchar(120) NOT NULL,",
    "  hash_key_version varchar(80) NOT NULL,",
    "  identifier_hash char(64) NOT NULL CHECK (identifier_hash ~ '^[a-f0-9]{64}$'),",
    "  verification_status varchar(20) NOT NULL CHECK (verification_status IN ('verified', 'declared', 'revoked')),",
    "  created_by_run_id text NOT NULL REFERENCES health_master.mpi_migration_runs(migration_run_id) ON DELETE RESTRICT,",
    "  first_seen_at timestamptz NOT NULL DEFAULT now(),",
    "  last_seen_at timestamptz NOT NULL DEFAULT now()",
    ");",
    "CREATE INDEX IF NOT EXISTS resident_identifier_mpi_idx ON health_master.resident_identifier (mpi_id, identifier_type);",
    "CREATE INDEX IF NOT EXISTS resident_identifier_lookup_idx ON health_master.resident_identifier (identifier_type, issuing_authority, hash_key_version, identifier_hash);",
    "CREATE UNIQUE INDEX IF NOT EXISTS resident_identifier_verified_strong_unique_idx ON health_master.resident_identifier (identifier_type, issuing_authority, hash_key_version, identifier_hash) WHERE identifier_type IN ('national-id', 'health-code') AND verification_status = 'verified';",
    "CREATE TABLE IF NOT EXISTS health_master.mpi_conflict_case (",
    "  case_id text PRIMARY KEY,",
    "  incoming_record_hash char(64) NOT NULL CHECK (incoming_record_hash ~ '^[a-f0-9]{64}$'),",
    "  source_system varchar(120) NOT NULL,",
    "  rule_version text NOT NULL,",
    "  identity_hash_key_versions jsonb NOT NULL CHECK (jsonb_typeof(identity_hash_key_versions) = 'array'),",
    "  status varchar(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved', 'reopened')),",
    "  reason varchar(80) NOT NULL,",
    "  assigned_to text,",
    "  evidence_reference text,",
    "  created_by_run_id text NOT NULL REFERENCES health_master.mpi_migration_runs(migration_run_id) ON DELETE RESTRICT,",
    "  created_at timestamptz NOT NULL DEFAULT now(),",
    "  resolved_at timestamptz",
    ");",
    "CREATE TABLE IF NOT EXISTS health_master.mpi_match_candidate (",
    "  candidate_id text PRIMARY KEY,",
    "  case_id text NOT NULL REFERENCES health_master.mpi_conflict_case(case_id) ON DELETE RESTRICT,",
    "  candidate_mpi_id varchar(40) REFERENCES health_master.resident_master(mpi_id) ON DELETE RESTRICT,",
    "  score smallint NOT NULL CHECK (score BETWEEN 0 AND 200),",
    "  decision varchar(30) NOT NULL CHECK (decision IN ('manual-review', 'accepted-link', 'rejected-link', 'create-new')),",
    "  reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb,",
    "  reviewed_by text,",
    "  reviewed_at timestamptz,",
    "  created_at timestamptz NOT NULL DEFAULT now()",
    ");",
    "CREATE TABLE IF NOT EXISTS health_master.mpi_conflict_case_action (",
    "  action_id text PRIMARY KEY,",
    "  case_id text NOT NULL REFERENCES health_master.mpi_conflict_case(case_id) ON DELETE RESTRICT,",
    "  action varchar(20) NOT NULL CHECK (action IN ('assign', 'acknowledge', 'resolve', 'reopen', 'comment')),",
    "  actor text NOT NULL,",
    "  note text NOT NULL,",
    "  evidence_reference text,",
    "  occurred_at timestamptz NOT NULL DEFAULT now()",
    ");",
    "CREATE INDEX IF NOT EXISTS mpi_conflict_case_action_history_idx ON health_master.mpi_conflict_case_action (case_id, occurred_at, action_id);",
    "CREATE TABLE IF NOT EXISTS health_master.mpi_merge_event (",
    "  merge_event_id text PRIMARY KEY,",
    "  source_mpi_id varchar(40) NOT NULL REFERENCES health_master.resident_master(mpi_id) ON DELETE RESTRICT,",
    "  target_mpi_id varchar(40) NOT NULL REFERENCES health_master.resident_master(mpi_id) ON DELETE RESTRICT,",
    "  action varchar(20) NOT NULL CHECK (action IN ('merge', 'unmerge')),",
    "  actor text NOT NULL,",
    "  reason text NOT NULL,",
    "  evidence_reference text NOT NULL,",
    "  occurred_at timestamptz NOT NULL DEFAULT now(),",
    "  CHECK (source_mpi_id <> target_mpi_id)",
    ");",
    "CREATE TABLE IF NOT EXISTS health_master.mpi_attribute_provenance (",
    "  provenance_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,",
    "  mpi_id varchar(40) NOT NULL REFERENCES health_master.resident_master(mpi_id) ON DELETE RESTRICT,",
    "  attribute_name varchar(80) NOT NULL,",
    "  source_system varchar(120) NOT NULL,",
    "  source_record_id varchar(160) NOT NULL,",
    "  value_hash char(64) NOT NULL CHECK (value_hash ~ '^[a-f0-9]{64}$'),",
    "  value_hash_key_version varchar(80) NOT NULL,",
    "  created_by_run_id text NOT NULL REFERENCES health_master.mpi_migration_runs(migration_run_id) ON DELETE RESTRICT,",
    "  observed_at timestamptz NOT NULL DEFAULT now(),",
    "  UNIQUE (mpi_id, attribute_name, source_system, source_record_id, value_hash_key_version, value_hash)",
    ");",
    "CREATE TABLE IF NOT EXISTS health_master.mpi_rule_version (",
    "  rule_version text PRIMARY KEY,",
    "  strong_identifier_types jsonb NOT NULL,",
    "  mobile_auto_merge_allowed boolean NOT NULL DEFAULT false CHECK (mobile_auto_merge_allowed = false),",
    "  hash_rotation_mode varchar(40) NOT NULL DEFAULT 'dual-read-dual-write' CHECK (hash_rotation_mode = 'dual-read-dual-write'),",
    "  effective_at timestamptz NOT NULL DEFAULT now(),",
    "  retired_at timestamptz",
    ");",
    `INSERT INTO health_master.mpi_rule_version (rule_version, strong_identifier_types, mobile_auto_merge_allowed, hash_rotation_mode) VALUES ('${MPI_RULE_VERSION}', '["national-id", "health-code"]'::jsonb, false, 'dual-read-dual-write') ON CONFLICT (rule_version) DO NOTHING;`,
    "COMMIT;",
    ""
  ].join("\n");
}

function loadSql() {
  return [
    "\\set ON_ERROR_STOP on",
    "BEGIN;",
    "INSERT INTO health_master.mpi_migration_runs (migration_run_id, source_digest, rule_version, identity_hash_key_versions, namespace_key_version)",
    "VALUES (:'migration_run_id', :'source_digest', :'rule_version', :'identity_hash_key_versions'::jsonb, :'namespace_key_version');",
    "-- Full-mode package only:",
    "-- \\copy health_master.resident_master (mpi_id, source_system, source_record_id, mpi_namespace_key_version, canonical_name, birth_date, gender_code, status, created_by_run_id) FROM 'resident_master.copy.tsv' WITH (FORMAT text, DELIMITER E'\\t', NULL '\\N');",
    "-- \\copy health_master.resident_identifier (mpi_id, identifier_type, issuing_authority, hash_key_version, identifier_hash, verification_status, created_by_run_id) FROM 'resident_identifier.copy.tsv' WITH (FORMAT text, DELIMITER E'\\t', NULL '\\N');",
    "-- \\copy health_master.mpi_attribute_provenance (mpi_id, attribute_name, source_system, source_record_id, value_hash_key_version, value_hash, created_by_run_id) FROM 'mpi_attribute_provenance.copy.tsv' WITH (FORMAT text, DELIMITER E'\\t', NULL '\\N');",
    "-- \\copy health_master.mpi_conflict_case (case_id, incoming_record_hash, source_system, rule_version, identity_hash_key_versions, status, reason, created_by_run_id) FROM 'mpi_conflict_case.copy.tsv' WITH (FORMAT text, DELIMITER E'\\t', NULL '\\N');",
    "-- \\copy health_master.mpi_match_candidate (candidate_id, case_id, candidate_mpi_id, score, decision, reason_codes) FROM 'mpi_match_candidate.copy.tsv' WITH (FORMAT text, DELIMITER E'\\t', NULL '\\N');",
    "-- Keep the transaction open only in a controlled psql session; validate counts before COMMIT.",
    "COMMIT;",
    ""
  ].join("\n");
}

function verifySql() {
  return [
    "\\set ON_ERROR_STOP on",
    "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;",
    "SELECT migration_run_id, source_digest, rule_version, identity_hash_key_versions, namespace_key_version, status FROM health_master.mpi_migration_runs WHERE migration_run_id = :'migration_run_id';",
    "SELECT count(*) AS resident_count FROM health_master.resident_master WHERE created_by_run_id = :'migration_run_id';",
    "SELECT count(*) AS identifier_count FROM health_master.resident_identifier WHERE created_by_run_id = :'migration_run_id';",
    "SELECT count(*) AS provenance_count FROM health_master.mpi_attribute_provenance WHERE created_by_run_id = :'migration_run_id';",
    "SELECT identifier_type, issuing_authority, hash_key_version, identifier_hash, count(*) FROM health_master.resident_identifier GROUP BY identifier_type, issuing_authority, hash_key_version, identifier_hash HAVING count(*) > 1;",
    "SELECT count(*) AS invalid_merge_rows FROM health_master.resident_master WHERE (status = 'merged') <> (merged_into_mpi_id IS NOT NULL);",
    "SELECT count(*) AS unresolved_conflict_cases FROM health_master.mpi_conflict_case WHERE status IN ('open', 'acknowledged', 'reopened');",
    "ROLLBACK;",
    ""
  ].join("\n");
}

function rollbackSql() {
  return [
    "\\set ON_ERROR_STOP on",
    "BEGIN;",
    "-- Requires an approved migration_run_id and a verified PostgreSQL-native pre-migration backup.",
    "-- MPI rollback blocked when migration residents have merge or lifecycle history.",
    "SELECT 1 / CASE WHEN EXISTS (SELECT 1 FROM health_master.resident_master WHERE created_by_run_id = :'migration_run_id' AND (status <> 'active' OR merged_into_mpi_id IS NOT NULL)) THEN 0 ELSE 1 END AS rollback_history_guard;",
    "-- MPI rollback blocked when a conflict work order has immutable action history.",
    "SELECT 1 / CASE WHEN EXISTS (SELECT 1 FROM health_master.mpi_conflict_case_action WHERE case_id IN (SELECT case_id FROM health_master.mpi_conflict_case WHERE created_by_run_id = :'migration_run_id')) THEN 0 ELSE 1 END AS rollback_action_history_guard;",
    "DELETE FROM health_master.mpi_match_candidate WHERE case_id IN (SELECT case_id FROM health_master.mpi_conflict_case WHERE created_by_run_id = :'migration_run_id');",
    "DELETE FROM health_master.mpi_conflict_case WHERE created_by_run_id = :'migration_run_id';",
    "DELETE FROM health_master.mpi_attribute_provenance WHERE created_by_run_id = :'migration_run_id';",
    "DELETE FROM health_master.resident_identifier WHERE created_by_run_id = :'migration_run_id';",
    "DELETE FROM health_master.resident_master WHERE created_by_run_id = :'migration_run_id';",
    "UPDATE health_master.mpi_migration_runs SET status = 'rolled-back' WHERE migration_run_id = :'migration_run_id';",
    "COMMIT;",
    ""
  ].join("\n");
}

function tsvValue(value) {
  if (value === null || value === undefined || value === "") return "\\N";
  return String(value).replace(/\\/g, "\\\\").replace(/\t/g, " ").replace(/[\r\n]+/g, " ");
}

function toTsv(rows, fields) {
  return `${rows.map((row) => fields.map((field) => tsvValue(row[field])).join("\t")).join("\n")}${rows.length ? "\n" : ""}`;
}

function packageReadme(manifest) {
  return [
    "# PostgreSQL MPI foundation package",
    "",
    `- Mode: ${manifest.mode}`,
    `- Migration run: ${manifest.migrationRunId}`,
    `- Residents: ${manifest.summary.residents}`,
    `- Rule version: ${manifest.ruleVersion}`,
    `- Identity hash key versions: ${(manifest.cryptography.identityHashKeyVersions || []).join(", ") || "not configured in manifest mode"}`,
    `- MPI namespace key version: ${manifest.cryptography.namespaceKeyVersion || "not configured in manifest mode"}`,
    "- Production ready: no",
    "",
    "Manifest mode contains schema, counts, digests and execution templates only.",
    "Full mode contains sensitive demographic data. Generate it only outside the repository with explicit acknowledgement, versioned identity hash keys and a separate stable MPI_NAMESPACE_KEY; every key must be at least 32 bytes.",
    "Raw document numbers and mobile numbers are never written to package artifacts; identifiers are represented by versioned keyed HMAC-SHA-256 values.",
    "Identity-hash rotation uses dual-read/dual-write versions. The separate MPI namespace key remains stable so rotating identity lookup hashes cannot change an existing MPI id.",
    "An exact verified national identifier or health code may auto-link one resident. Mobile and demographic similarity only create review candidates.",
    "This package does not enable STORAGE_ENGINE=postgres or represent production acceptance.",
    ""
  ].join("\n");
}

function buildMpiFoundationPackage(options = {}) {
  const data = options.data || JSON.parse(fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8"));
  const residents = Array.isArray(data.residents) ? data.residents : [];
  const mode = options.mode || "manifest";
  if (!new Set(["manifest", "full"]).has(mode)) throw new Error(`unsupported MPI package mode: ${mode}`);
  if (mode === "full" && options.allowSensitiveData !== true) throw new Error("full MPI export requires --acknowledge-sensitive-data");
  if (mode === "full" && !options.namespaceKey) throw new Error("full MPI export requires a separate MPI_NAMESPACE_KEY");
  const configuredHashKeys = mode === "full" ? normalizeHashKeys(options) : [];
  const namespaceKeyVersion = mode === "full" ? normalizeKeyVersion(options.namespaceKeyVersion, DEFAULT_NAMESPACE_KEY_VERSION) : null;
  const migrationRunId = String(options.migrationRunId || `MPI-${randomUUID()}`).slice(0, 120);
  const sourceDigest = sha256(canonicalStringify(residents));
  const manifest = {
    formatVersion: FORMAT_VERSION,
    generatedAt: new Date().toISOString(),
    mode,
    migrationRunId,
    ruleVersion: MPI_RULE_VERSION,
    source: { collection: "residents", digest: sourceDigest },
    target: { engine: "postgresql", schema: "health_master", runtimeEnabled: false },
    summary: { residents: residents.length, identifiers: null, provenanceRows: null, conflicts: null, conflictCases: null },
    cryptography: {
      algorithm: "HMAC-SHA-256",
      identityHashKeyVersions: configuredHashKeys.map((item) => item.version),
      namespaceKeyVersion,
      rotationMode: "dual-read-dual-write",
      namespaceStableAcrossIdentityKeyRotation: true
    },
    securityBoundary: { rawIdentifiersPersisted: false, hashKeyPersisted: false, namespaceKeyPersisted: false, databaseCredentialsPersisted: false },
    recoveryObjectives: {
      rpoMinutes: 120,
      rtoMinutes: 720,
      status: "proposed-unmeasured",
      measured: false,
      measuredRpoMinutes: null,
      measuredRtoMinutes: null,
      evidenceReference: null,
      productionAccepted: false
    },
    productionReady: false,
    blockers: [
      "production PostgreSQL topology and least-privilege roles are not accepted",
      "authoritative population or electronic-health-code source is not connected",
      "masked full-volume matching accuracy is not signed",
      "PostgreSQL native restore has not produced measured RPO/RTO evidence"
    ]
  };
  const files = {
    "schema.sql": sqlSchema(),
    "load.sql": loadSql(),
    "verify.sql": verifySql(),
    "rollback.sql": rollbackSql()
  };
  let mpiRows = null;
  if (mode === "full") {
    mpiRows = buildMpiResidentRows(residents, {
      hashKeys: configuredHashKeys,
      namespaceKey: options.namespaceKey,
      namespaceKeyVersion,
      sourceSystem: options.sourceSystem || "legacy-snapshot",
      defaultAuthority: options.defaultAuthority || "local-demo"
    });
    manifest.summary.identifiers = mpiRows.identifierRows.length;
    manifest.summary.provenanceRows = mpiRows.provenanceRows.length;
    manifest.summary.conflicts = mpiRows.conflicts.length;
    manifest.summary.conflictCases = mpiRows.conflictCaseRows.length;
    files["resident_master.copy.tsv"] = toTsv(mpiRows.residentRows.map((row) => ({ ...row, createdByRunId: migrationRunId })), ["mpiId", "sourceSystem", "sourceRecordId", "namespaceKeyVersion", "canonicalName", "birthDate", "genderCode", "status", "createdByRunId"]);
    files["resident_identifier.copy.tsv"] = toTsv(mpiRows.identifierRows.map((row) => ({ ...row, createdByRunId: migrationRunId })), ["mpiId", "identifierType", "issuingAuthority", "hashKeyVersion", "identifierHash", "verificationStatus", "createdByRunId"]);
    files["mpi_attribute_provenance.copy.tsv"] = toTsv(mpiRows.provenanceRows.map((row) => ({ ...row, createdByRunId: migrationRunId })), ["mpiId", "attributeName", "sourceSystem", "sourceRecordId", "valueHashKeyVersion", "valueHash", "createdByRunId"]);
    files["mpi_conflict_case.copy.tsv"] = toTsv(mpiRows.conflictCaseRows.map((row) => ({ ...row, createdByRunId: migrationRunId })), ["caseId", "incomingRecordHash", "sourceSystem", "ruleVersion", "hashKeyVersions", "status", "reason", "createdByRunId"]);
    files["mpi_match_candidate.copy.tsv"] = toTsv(mpiRows.conflictCandidateRows, ["candidateId", "caseId", "candidateMpiId", "score", "decision", "reasonCodes"]);
    files["conflicts.json"] = JSON.stringify(mpiRows.conflicts, null, 2);
  }
  files["README.md"] = packageReadme(manifest);
  const checks = [
    check("mpiPackage:residentInventory", residents.length > 0, `${residents.length} residents`),
    check("mpiPackage:sourceDigest", /^[a-f0-9]{64}$/.test(sourceDigest), sourceDigest),
    check("mpiPackage:identifierBoundary", Object.values(manifest.securityBoundary).every((value) => value === false), "raw identifiers, hashing keys and database credentials are not persisted"),
    check("mpiPackage:keyVersioning", mode === "manifest" || (manifest.cryptography.identityHashKeyVersions.length >= 1 && Boolean(manifest.cryptography.namespaceKeyVersion)), mode === "manifest" ? "keys not required" : `${manifest.cryptography.identityHashKeyVersions.join(",")} / ${manifest.cryptography.namespaceKeyVersion}`),
    check("mpiPackage:rules", files["schema.sql"].includes("mobile_auto_merge_allowed = false") && files["schema.sql"].includes("dual-read-dual-write") && files["schema.sql"].includes(MPI_RULE_VERSION), MPI_RULE_VERSION),
    check("mpiPackage:conflicts", mode === "manifest" || mpiRows.conflicts.length === 0, mode === "manifest" ? "not evaluated" : `${mpiRows.conflicts.length} conflicts`),
    check("mpiPackage:recoveryEvidenceBoundary", manifest.recoveryObjectives.measured === false && manifest.recoveryObjectives.productionAccepted === false && manifest.recoveryObjectives.status === "proposed-unmeasured", manifest.recoveryObjectives.status),
    check("mpiPackage:productionBoundary", manifest.productionReady === false && manifest.target.runtimeEnabled === false, "runtime cutover remains blocked")
  ];
  return { ok: checks.every((item) => item.passed), manifest, files, checks };
}

function isWithin(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function writeMpiFoundationPackage(pkg, outputDir = DEFAULT_OUTPUT_DIR) {
  const target = path.resolve(outputDir);
  if (pkg.manifest.mode === "full" && isWithin(ROOT, target)) throw new Error("full MPI exports must be written outside the repository");
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

function verifyMpiFoundationPackage(outputDir = DEFAULT_OUTPUT_DIR) {
  const target = path.resolve(outputDir);
  const manifestPath = path.join(target, "manifest.json");
  if (!fs.existsSync(manifestPath)) throw new Error(`MPI foundation manifest not found: ${manifestPath}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const artifactChecks = Object.entries(manifest.artifacts || {}).map(([name, expected]) => {
    const file = path.join(target, name);
    const content = fs.existsSync(file) ? fs.readFileSync(file) : null;
    return check(`mpiPackage:file:${name}`, Boolean(content && content.length === expected.bytes && sha256(content) === expected.sha256), content ? `${content.length} bytes` : "missing");
  });
  const artifactDigest = sha256(Object.keys(manifest.artifacts || {}).sort().map((name) => `${name}:${manifest.artifacts[name].sha256}`).join("\n"));
  const rows = (name) => fs.existsSync(path.join(target, name)) ? fs.readFileSync(path.join(target, name), "utf8").split("\n").filter(Boolean).length : 0;
  const checks = [
    ...artifactChecks,
    check("mpiPackage:artifactDigest", artifactDigest === manifest.artifactDigest, artifactDigest),
    check("mpiPackage:residentCounts", manifest.mode !== "full" || rows("resident_master.copy.tsv") === manifest.summary.residents, `${rows("resident_master.copy.tsv")} residents`),
    check("mpiPackage:identifierCounts", manifest.mode !== "full" || rows("resident_identifier.copy.tsv") === manifest.summary.identifiers, `${rows("resident_identifier.copy.tsv")} identifiers`),
    check("mpiPackage:conflictCaseCounts", manifest.mode !== "full" || rows("mpi_conflict_case.copy.tsv") === manifest.summary.conflictCases, `${rows("mpi_conflict_case.copy.tsv")} conflict cases`),
    check("mpiPackage:securityBoundary", manifest.securityBoundary?.rawIdentifiersPersisted === false && manifest.securityBoundary?.hashKeyPersisted === false && manifest.securityBoundary?.namespaceKeyPersisted === false, "no raw identifiers or hashing keys persisted"),
    check("mpiPackage:recoveryEvidenceBoundary", manifest.recoveryObjectives?.measured === false && manifest.recoveryObjectives?.productionAccepted === false, manifest.recoveryObjectives?.status || "missing"),
    check("mpiPackage:productionBoundary", manifest.productionReady === false && manifest.target?.runtimeEnabled === false, "runtime remains blocked")
  ];
  return { ok: checks.every((item) => item.passed), manifest, checks };
}

function parseArgs(argv = process.argv.slice(2)) {
  const [command = "build", ...args] = argv;
  const flags = {};
  args.forEach((arg) => {
    if (!arg.startsWith("--")) return;
    const [name, ...parts] = arg.slice(2).split("=");
    flags[name] = parts.length ? parts.join("=") : true;
  });
  return { command, flags };
}

function parseHashKeysEnvironment(env = process.env) {
  if (String(env.MPI_IDENTITY_HASH_KEYS_JSON || "").trim()) {
    let parsed;
    try {
      parsed = JSON.parse(env.MPI_IDENTITY_HASH_KEYS_JSON);
    } catch {
      throw new Error("MPI_IDENTITY_HASH_KEYS_JSON must be valid JSON");
    }
    if (!Array.isArray(parsed) || !parsed.length) throw new Error("MPI_IDENTITY_HASH_KEYS_JSON must be a non-empty array");
    return parsed.map((item) => ({ version: item.version, key: item.key }));
  }
  return [{ version: env.MPI_IDENTITY_HASH_KEY_VERSION || DEFAULT_HASH_KEY_VERSION, key: env.MPI_IDENTITY_HASH_KEY }];
}

function main() {
  const { command, flags } = parseArgs();
  const outputDir = flags["output-dir"] || DEFAULT_OUTPUT_DIR;
  if (command === "build") {
    const pkg = buildMpiFoundationPackage({
      mode: flags.mode || "manifest",
      allowSensitiveData: flags["acknowledge-sensitive-data"] === true,
      migrationRunId: flags["migration-run-id"],
      sourceSystem: flags["source-system"],
      defaultAuthority: flags["default-authority"],
      hashKeys: parseHashKeysEnvironment(process.env),
      namespaceKey: process.env.MPI_NAMESPACE_KEY,
      namespaceKeyVersion: process.env.MPI_NAMESPACE_KEY_VERSION || DEFAULT_NAMESPACE_KEY_VERSION
    });
    const written = writeMpiFoundationPackage(pkg, outputDir);
    const verification = verifyMpiFoundationPackage(outputDir);
    console.log(JSON.stringify({ ...written.manifest, checks: pkg.checks, verification }, null, 2));
    if (!pkg.ok || !verification.ok) process.exitCode = 1;
    return;
  }
  if (command === "verify") {
    const verification = verifyMpiFoundationPackage(outputDir);
    console.log(JSON.stringify(verification, null, 2));
    if (!verification.ok) process.exitCode = 1;
    return;
  }
  throw new Error("Usage: postgres-mpi-foundation.js build|verify [--mode=manifest|full] [--output-dir=PATH] [--migration-run-id=ID] [--acknowledge-sensitive-data]");
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, code: error.code || "MPI_FOUNDATION_COMMAND_FAILED", message: error.message })}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  buildMpiFoundationPackage,
  loadSql,
  parseArgs,
  parseHashKeysEnvironment,
  rollbackSql,
  sqlSchema,
  verifyMpiFoundationPackage,
  verifySql,
  writeMpiFoundationPackage
};
