const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildMpiConflictCase,
  buildMpiResidentRows,
  createDeterministicMpiId,
  identityHash,
  resolveMpiMatch
} = require("../postgres-mpi-foundation");
const {
  buildMpiFoundationPackage,
  parseArgs,
  parseHashKeysEnvironment,
  verifyMpiFoundationPackage,
  writeMpiFoundationPackage
} = require("../scripts/postgres-mpi-foundation");

const HASH_KEY = "mpi-test-key-with-at-least-thirty-two-bytes";
const ROTATED_HASH_KEY = "mpi-rotated-key-with-at-least-thirty-two-bytes";
const NAMESPACE_KEY = "mpi-stable-namespace-key-at-least-thirty-two-bytes";
const SINGLE_KEY_OPTIONS = {
  hashKeys: [{ version: "identity-v1", key: HASH_KEY }],
  namespaceKey: NAMESPACE_KEY,
  namespaceKeyVersion: "namespace-v1"
};
const SAMPLE = {
  residents: [
    { id: "resident-1", name: "测试居民甲", idCard: "210200199001010011", documentVerified: true, phone: "13800000001", gender: "男", birthDate: "1990-01-01" },
    { id: "resident-2", name: "测试居民乙", healthCode: "HC-0002", healthCodeVerified: true, phone: "13800000002", gender: "女", birthDate: "1992-02-02" }
  ]
};

test("MPI identifiers use keyed hashes and never use the legacy document-plus-mobile value", () => {
  const rows = buildMpiResidentRows(SAMPLE.residents, { ...SINGLE_KEY_OPTIONS, sourceSystem: "masked-his", defaultAuthority: "authority-a" });
  assert.equal(rows.residentRows.length, 2);
  assert.equal(rows.conflicts.length, 0);
  assert.match(rows.residentRows[0].mpiId, /^mpi_[a-f0-9]{32}$/);
  assert.equal(rows.identifierRows.length, 4);
  assert.equal(rows.identifierRows.every((item) => item.hashKeyVersion === "identity-v1"), true);
  assert.equal(rows.identifierRows.every((item) => /^[a-f0-9]{64}$/.test(item.identifierHash)), true);
  assert.doesNotMatch(JSON.stringify(rows), /210200199001010011|13800000001/);
  assert.notEqual(identityHash("national-id", "authority-a", "210200199001010011", HASH_KEY), identityHash("national-id", "authority-b", "210200199001010011", HASH_KEY));
});

test("MPI identity hash rotation is versioned while the namespace-derived MPI id stays stable", () => {
  const resident = SAMPLE.residents[0];
  const v1 = createDeterministicMpiId(resident, { ...SINGLE_KEY_OPTIONS, sourceSystem: "masked-his" });
  const v2 = createDeterministicMpiId(resident, {
    hashKeys: [{ version: "identity-v2", key: ROTATED_HASH_KEY }],
    namespaceKey: NAMESPACE_KEY,
    namespaceKeyVersion: "namespace-v1",
    sourceSystem: "masked-his"
  });
  assert.equal(v1, v2);

  const rows = buildMpiResidentRows([resident], {
    hashKeys: [
      { version: "identity-v1", key: HASH_KEY },
      { version: "identity-v2", key: ROTATED_HASH_KEY }
    ],
    namespaceKey: NAMESPACE_KEY,
    namespaceKeyVersion: "namespace-v1",
    sourceSystem: "masked-his",
    defaultAuthority: "authority-a"
  });
  assert.equal(rows.identifierRows.length, 4);
  assert.deepEqual([...new Set(rows.identifierRows.map((item) => item.hashKeyVersion))].sort(), ["identity-v1", "identity-v2"]);
  assert.equal(new Set(rows.identifierRows.map((item) => item.identifierHash)).size, 4);
});

test("MPI matching auto-links one verified identity but never auto-links by mobile", () => {
  const candidate = { ...SAMPLE.residents[0], mpiId: "mpi_existing_1" };
  const exact = resolveMpiMatch({ ...SAMPLE.residents[0], name: "更名居民" }, [candidate], { ...SINGLE_KEY_OPTIONS, defaultAuthority: "authority-a" });
  assert.equal(exact.decision, "auto-link");
  assert.equal(exact.mpiId, "mpi_existing_1");

  const mobileOnly = resolveMpiMatch(
    { id: "incoming", name: "完全不同", phone: "13800000001", birthDate: "2000-01-01", gender: "女" },
    [{ id: "candidate", mpiId: "mpi_existing_2", name: "另一居民", phone: "13800000001", birthDate: "1990-01-01", gender: "男" }],
    { ...SINGLE_KEY_OPTIONS, defaultAuthority: "authority-a" }
  );
  assert.equal(mobileOnly.decision, "create-new");
  assert.equal(mobileOnly.candidates[0].score, 20);

  const unverifiedDocument = resolveMpiMatch(
    { id: "incoming", name: "完全不同", idCard: "210200199001010011" },
    [{ id: "candidate", mpiId: "mpi_existing_3", name: "另一居民", idCard: "210200199001010011" }],
    { ...SINGLE_KEY_OPTIONS, defaultAuthority: "authority-a" }
  );
  assert.equal(unverifiedDocument.decision, "create-new");
});

test("MPI matching sends verified identity conflicts and demographic candidates to review", () => {
  const conflict = resolveMpiMatch(
    { id: "incoming", name: "测试居民甲", idCard: "210200199001010011", documentVerified: true, healthCode: "HC-NEW", healthCodeVerified: true, birthDate: "1990-01-01", gender: "男" },
    [{ ...SAMPLE.residents[0], mpiId: "mpi_existing_1", healthCode: "HC-OLD", healthCodeVerified: true }],
    { ...SINGLE_KEY_OPTIONS, defaultAuthority: "authority-a" }
  );
  assert.equal(conflict.decision, "manual-review");
  assert.equal(conflict.reason, "verified-identity-conflict");

  const demographic = resolveMpiMatch(
    { id: "incoming", name: "测试居民甲", phone: "13900000000", birthDate: "1990-01-01", gender: "男", address: "同一地址" },
    [{ id: "candidate", mpiId: "mpi_existing_2", name: "测试居民甲", phone: "13700000000", birthDate: "1990-01-01", gender: "男", address: "同一地址" }],
    { ...SINGLE_KEY_OPTIONS, defaultAuthority: "authority-a" }
  );
  assert.equal(demographic.decision, "manual-review");
  assert.equal(demographic.reason, "demographic-candidate-only");

  const conflictCase = buildMpiConflictCase(
    { id: "incoming-sensitive-record", sourceSystem: "masked-his", name: "不应进入工单", idCard: "210200199001010011" },
    conflict,
    { ...SINGLE_KEY_OPTIONS, sourceSystem: "masked-his" }
  );
  assert.equal(conflictCase.status, "open");
  assert.match(conflictCase.caseId, /^mpicase_[a-f0-9]{32}$/);
  assert.deepEqual(conflictCase.hashKeyVersions, ["identity-v1"]);
  assert.doesNotMatch(JSON.stringify(conflictCase), /incoming-sensitive-record|不应进入工单|210200199001010011/);
});

test("MPI migration turns duplicate verified identifiers into payload-free conflict work orders", () => {
  const rows = buildMpiResidentRows([
    SAMPLE.residents[0],
    { ...SAMPLE.residents[0], id: "resident-collision", name: "冲突居民", phone: "13900000009" }
  ], { ...SINGLE_KEY_OPTIONS, sourceSystem: "masked-his", defaultAuthority: "authority-a" });
  assert.equal(rows.conflicts.length, 1);
  assert.equal(rows.conflictCaseRows.length, 1);
  assert.equal(rows.conflictCandidateRows.length, 1);
  assert.equal(rows.conflictCaseRows[0].status, "open");
  assert.equal(rows.conflictCandidateRows[0].decision, "manual-review");
  assert.doesNotMatch(JSON.stringify({ conflicts: rows.conflicts, cases: rows.conflictCaseRows, candidates: rows.conflictCandidateRows }), /resident-collision|冲突居民|210200199001010011|13900000009/);

  const rotatingRows = buildMpiResidentRows([
    SAMPLE.residents[0],
    { ...SAMPLE.residents[0], id: "resident-collision", name: "冲突居民", phone: "13900000009" }
  ], {
    hashKeys: [
      { version: "identity-v1", key: HASH_KEY },
      { version: "identity-v2", key: ROTATED_HASH_KEY }
    ],
    namespaceKey: NAMESPACE_KEY,
    namespaceKeyVersion: "namespace-v1",
    sourceSystem: "masked-his",
    defaultAuthority: "authority-a"
  });
  assert.equal(rotatingRows.conflicts.length, 1);
  assert.equal(rotatingRows.conflictCaseRows.length, 1);
  assert.deepEqual(rotatingRows.conflicts[0].hashKeyVersions, ["identity-v1", "identity-v2"]);

  const sharedMobile = buildMpiResidentRows([
    SAMPLE.residents[0],
    { ...SAMPLE.residents[1], phone: SAMPLE.residents[0].phone }
  ], { ...SINGLE_KEY_OPTIONS, sourceSystem: "masked-his", defaultAuthority: "authority-a" });
  assert.equal(sharedMobile.conflicts.length, 0);
  assert.equal(sharedMobile.identifierRows.filter((item) => item.identifierType === "mobile").length, 2);
});

test("MPI manifest package contains domain DDL and no resident payload", () => {
  const pkg = buildMpiFoundationPackage({ data: SAMPLE, migrationRunId: "MPI-TEST-001" });
  const serialized = JSON.stringify(pkg.manifest);
  assert.equal(pkg.ok, true);
  assert.equal(pkg.manifest.summary.residents, 2);
  assert.equal(pkg.manifest.recoveryObjectives.rpoMinutes, 120);
  assert.equal(pkg.manifest.recoveryObjectives.rtoMinutes, 720);
  assert.equal(pkg.manifest.recoveryObjectives.status, "proposed-unmeasured");
  assert.equal(pkg.manifest.recoveryObjectives.productionAccepted, false);
  assert.deepEqual(pkg.manifest.cryptography.identityHashKeyVersions, []);
  assert.equal(pkg.manifest.productionReady, false);
  assert.doesNotMatch(serialized, /测试居民甲|210200199001010011|13800000001/);
  assert.match(pkg.files["schema.sql"], /health_master\.resident_master/);
  assert.match(pkg.files["schema.sql"], /health_master\.resident_identifier/);
  assert.match(pkg.files["schema.sql"], /health_master\.mpi_match_candidate/);
  assert.match(pkg.files["schema.sql"], /health_master\.mpi_conflict_case/);
  assert.match(pkg.files["schema.sql"], /health_master\.mpi_conflict_case_action/);
  assert.match(pkg.files["schema.sql"], /hash_key_version varchar\(80\)/);
  assert.match(pkg.files["schema.sql"], /resident_identifier_verified_strong_unique_idx/);
  assert.doesNotMatch(pkg.files["schema.sql"], /UNIQUE \(identifier_type, issuing_authority, hash_key_version, identifier_hash\)/);
  assert.match(pkg.files["schema.sql"], /dual-read-dual-write/);
  assert.match(pkg.files["schema.sql"], /health_master\.mpi_merge_event/);
  assert.match(pkg.files["schema.sql"], /mobile_auto_merge_allowed boolean NOT NULL DEFAULT false/);
  assert.match(pkg.files["load.sql"], /FORMAT text/);
  assert.match(pkg.files["rollback.sql"], /verified PostgreSQL-native pre-migration backup/);
  assert.match(pkg.files["rollback.sql"], /MPI rollback blocked when migration residents have merge or lifecycle history/);
  assert.match(pkg.files["rollback.sql"], /rollback blocked when a conflict work order has immutable action history/);
  assert.doesNotMatch(pkg.files["rollback.sql"], /DELETE FROM health_master\.mpi_conflict_case_action/);
  assert.equal(pkg.files["rollback.sql"].indexOf("DELETE FROM health_master.mpi_match_candidate") < pkg.files["rollback.sql"].indexOf("DELETE FROM health_master.mpi_conflict_case"), true);
  assert.equal(pkg.files["rollback.sql"].indexOf("DELETE FROM health_master.mpi_conflict_case") < pkg.files["rollback.sql"].indexOf("DELETE FROM health_master.resident_master"), true);
});

test("MPI full package requires acknowledgement, a hashing key and an external directory", (t) => {
  assert.throws(() => buildMpiFoundationPackage({ data: SAMPLE, mode: "full", hashKeys: SINGLE_KEY_OPTIONS.hashKeys, namespaceKey: NAMESPACE_KEY }), /acknowledge-sensitive-data/);
  assert.throws(() => buildMpiFoundationPackage({ data: SAMPLE, mode: "full", allowSensitiveData: true, hashKeys: SINGLE_KEY_OPTIONS.hashKeys }), /MPI_NAMESPACE_KEY/);
  assert.throws(() => buildMpiFoundationPackage({ data: SAMPLE, mode: "full", allowSensitiveData: true, namespaceKey: NAMESPACE_KEY }), /key of at least 32 bytes/);

  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "postgres-mpi-full-test-"));
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const pkg = buildMpiFoundationPackage({ data: SAMPLE, mode: "full", allowSensitiveData: true, ...SINGLE_KEY_OPTIONS, sourceSystem: "masked-his", defaultAuthority: "authority-a" });
  writeMpiFoundationPackage(pkg, outputDir);
  const verification = verifyMpiFoundationPackage(outputDir);
  assert.equal(pkg.ok, true);
  assert.equal(verification.ok, true);
  assert.deepEqual(verification.manifest.cryptography.identityHashKeyVersions, ["identity-v1"]);
  assert.equal(verification.manifest.cryptography.namespaceKeyVersion, "namespace-v1");
  assert.doesNotMatch(fs.readFileSync(path.join(outputDir, "resident_identifier.copy.tsv"), "utf8"), /210200199001010011|13800000001/);
  assert.throws(() => writeMpiFoundationPackage(pkg, path.join(__dirname, "..", "tmp", "unsafe-mpi-export")), /outside the repository/);
});

test("MPI CLI parser keeps secure full-export flags", () => {
  const parsed = parseArgs(["build", "--mode=full", "--output-dir=D:/secure/mpi", "--migration-run-id=MPI-001", "--acknowledge-sensitive-data"]);
  assert.equal(parsed.command, "build");
  assert.equal(parsed.flags.mode, "full");
  assert.equal(parsed.flags["migration-run-id"], "MPI-001");
  assert.equal(parsed.flags["acknowledge-sensitive-data"], true);

  const keyring = parseHashKeysEnvironment({ MPI_IDENTITY_HASH_KEYS_JSON: JSON.stringify([
    { version: "identity-v1", key: HASH_KEY },
    { version: "identity-v2", key: ROTATED_HASH_KEY }
  ]) });
  assert.deepEqual(keyring.map((item) => item.version), ["identity-v1", "identity-v2"]);
});
