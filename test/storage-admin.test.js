const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const test = require("node:test");

const { assessRecoveryReadiness, createBackup, createSanitizedSnapshot, inspectStorageModel, rehearseRestore, restoreBackup, verifyBackup } = require("../scripts/storage-admin");

test("storage backup verifies checksums, rehearses restore, and restores with a safety copy", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "health-platform-backup-"));
  const dataDir = path.join(root, "data");
  const backupRoot = path.join(root, "backups");
  fs.mkdirSync(dataDir, { recursive: true });
  const original = { residents: [{ id: "r1", name: "backup-test-resident" }] };
  fs.writeFileSync(path.join(dataDir, "db.json"), JSON.stringify(original), "utf8");
  const sqlite = new DatabaseSync(path.join(dataDir, "health-city.sqlite"));
  try { sqlite.exec("CREATE TABLE backup_probe(value TEXT NOT NULL)"); }
  finally { sqlite.close(); }

  try {
    const backup = createBackup({ dataDir, backupRoot, label: "test" });
    const manifest = verifyBackup(backup.destination);
    assert.deepEqual(manifest.files.map((item) => item.name).sort(), ["db.json", "health-city.sqlite"]);
    assert.equal(manifest.dataQuality.passed, true);
    assert.deepEqual(manifest.dataQuality.checks.map((item) => item.name), [
      "jsonSnapshotReadable",
      "uniqueCollectionIds",
      "residentReferencesExist"
    ]);

    const rehearsal = rehearseRestore(backup.destination, { rehearsalRoot: path.join(root, "restore-rehearsals"), maxDurationMs: 60_000 });
    assert.equal(rehearsal.ok, true);
    assert.deepEqual(rehearsal.files.sort(), ["db.json", "health-city.sqlite"]);
    assert.equal(rehearsal.metrics.fileCount, 2);
    assert.equal(rehearsal.metrics.totalBytes > 0, true);
    assert.equal(rehearsal.metrics.durationMs >= 0, true);
    assert.equal(rehearsal.objectives.passed, true);
    assert.equal(rehearsal.objectives.checks[0].name, "maxDurationMs");
    assert.ok(fs.existsSync(path.join(rehearsal.rehearsalDataDir, "db.json")));
    assert.ok(fs.existsSync(path.join(rehearsal.rehearsalBackup, "manifest.json")));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataDir, "db.json"), "utf8")), original);

    const failedObjective = rehearseRestore(backup.destination, { rehearsalRoot: path.join(root, "restore-rehearsals"), maxDurationMs: -1 });
    assert.equal(failedObjective.objectives.passed, true, "negative objectives are ignored");
    const impossibleObjective = rehearseRestore(backup.destination, { rehearsalRoot: path.join(root, "restore-rehearsals"), maxDurationMs: 0 });
    assert.equal(typeof impossibleObjective.objectives.passed, "boolean");

    const assessment = assessRecoveryReadiness(backup.destination, {
      rehearsalRoot: path.join(root, "restore-assessments"),
      maxBackupAgeMs: 60_000,
      maxDurationMs: 60_000,
      minFileCount: 2,
      minTotalBytes: 1,
      requiredFiles: ["db.json", "health-city.sqlite"]
    });
    assert.equal(assessment.passed, true);
    assert.equal(assessment.metrics.fileCount, 2);
    assert.equal(assessment.metrics.backupAgeMs >= 0, true);
    assert.equal(assessment.metrics.rehearsalDurationMs >= 0, true);
    assert.deepEqual(assessment.checks.map((item) => item.name), [
      "maxBackupAgeMs",
      "requiredFiles",
      "minFileCount",
      "minTotalBytes",
      "dataQuality",
      "restoreRehearsal"
    ]);

    const failedAssessment = assessRecoveryReadiness(backup.destination, {
      rehearsalRoot: path.join(root, "restore-assessments"),
      maxBackupAgeMs: -1,
      maxDurationMs: 60_000,
      minFileCount: 3,
      minTotalBytes: 1,
      requiredFiles: ["db.json", "health-city.sqlite", "missing.sqlite"]
    });
    assert.equal(failedAssessment.passed, false);
    assert.equal(failedAssessment.checks.find((item) => item.name === "requiredFiles").missing[0], "missing.sqlite");
    assert.equal(failedAssessment.checks.find((item) => item.name === "minFileCount").passed, false);

    fs.writeFileSync(path.join(dataDir, "db.json"), JSON.stringify({ residents: [] }), "utf8");
    assert.throws(() => restoreBackup(backup.destination, { dataDir, backupRoot }), /confirm=true/);
    const restored = restoreBackup(backup.destination, { dataDir, backupRoot, confirm: true });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataDir, "db.json"), "utf8")), original);
    assert.ok(fs.existsSync(path.join(restored.safetyBackup, "manifest.json")));
    assert.equal(restored.metrics.fileCount, 2);
    assert.equal(restored.metrics.totalBytes > 0, true);
    assert.equal(restored.metrics.durationMs >= 0, true);

    const invalidDataDir = path.join(root, "invalid-data");
    fs.mkdirSync(invalidDataDir, { recursive: true });
    fs.writeFileSync(path.join(invalidDataDir, "db.json"), JSON.stringify({
      residents: [{ id: "r1" }, { id: "r1" }],
      chronicManagementPlans: [{ id: "cmp-1", residentId: "missing-resident" }]
    }), "utf8");
    const invalidBackup = createBackup({ dataDir: invalidDataDir, backupRoot: path.join(root, "invalid-backups"), label: "invalid" });
    assert.throws(() => verifyBackup(invalidBackup.destination), /Backup data quality failed: uniqueCollectionIds, residentReferencesExist/);

    fs.appendFileSync(path.join(backup.destination, "db.json"), "tampered");
    assert.throws(() => verifyBackup(backup.destination), /size mismatch|checksum failed/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("storage backup includes committed SQLite WAL data before checkpoint", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "health-platform-backup-wal-"));
  const dataDir = path.join(root, "data");
  const backupRoot = path.join(root, "backups");
  fs.mkdirSync(dataDir);
  fs.writeFileSync(path.join(dataDir, "db.json"), JSON.stringify({ residents: [] }), "utf8");
  const sourceFile = path.join(dataDir, "health-city.sqlite");
  const source = new DatabaseSync(sourceFile);
  try {
    source.exec("PRAGMA journal_mode=WAL; CREATE TABLE backup_probe(value TEXT NOT NULL); PRAGMA wal_checkpoint(TRUNCATE)");
    source.prepare("INSERT INTO backup_probe(value) VALUES(?)").run("committed-synthetic-row");
    assert.equal(source.prepare("SELECT count(*) AS count FROM backup_probe").get().count, 1);
    assert.equal(fs.statSync(`${sourceFile}-wal`).size > 0, true);
    const sourceMainBefore = fs.readFileSync(sourceFile);
    const sourceWalBefore = fs.readFileSync(`${sourceFile}-wal`);

    const backup = createBackup({ dataDir, backupRoot, label: "wal" });
    assert.equal(verifyBackup(backup.destination).dataQuality.passed, true);
    assert.deepEqual(fs.readFileSync(sourceFile), sourceMainBefore);
    assert.deepEqual(fs.readFileSync(`${sourceFile}-wal`), sourceWalBefore);
    for (const suffix of ["-wal", "-shm"]) {
      assert.equal(fs.existsSync(path.join(backup.destination, `health-city.sqlite${suffix}`)), false);
    }
    const snapshot = new DatabaseSync(path.join(backup.destination, "health-city.sqlite"), { readOnly: true });
    try { assert.equal(snapshot.prepare("SELECT count(*) AS count FROM backup_probe").get().count, 1); }
    finally { snapshot.close(); }
    assert.equal(rehearseRestore(backup.destination, { rehearsalRoot: path.join(root, "rehearsal") }).ok, true);
  } finally {
    source.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("storage backup and verification reject corrupt SQLite even with matching file digest", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "health-platform-backup-corrupt-"));
  const dataDir = path.join(root, "data");
  const backupRoot = path.join(root, "backups");
  fs.mkdirSync(dataDir);
  fs.writeFileSync(path.join(dataDir, "db.json"), JSON.stringify({ residents: [] }), "utf8");
  const sqliteFile = path.join(dataDir, "health-city.sqlite");
  try {
    fs.writeFileSync(sqliteFile, "");
    assert.throws(() => createBackup({ dataDir, backupRoot, label: "empty" }), /SQLite integrity check failed/);
    fs.writeFileSync(sqliteFile, "not-a-sqlite-database");
    assert.throws(() => createBackup({ dataDir, backupRoot, label: "invalid" }), /SQLite|database|file|malformed|not/i);
    fs.rmSync(sqliteFile);
    const sqlite = new DatabaseSync(sqliteFile);
    sqlite.exec("CREATE TABLE backup_probe(value TEXT NOT NULL)");
    sqlite.close();
    const backup = createBackup({ dataDir, backupRoot, label: "valid" });
    const copied = path.join(backup.destination, "health-city.sqlite");
    for (const suffix of ["-wal", "-shm"]) {
      const sidecar = `${copied}${suffix}`;
      fs.writeFileSync(sidecar, "synthetic-sidecar");
      assert.throws(() => verifyBackup(backup.destination), /Backup verification requires SQLite WAL and SHM sidecars/);
      assert.equal(fs.readFileSync(sidecar, "utf8"), "synthetic-sidecar");
      fs.rmSync(sidecar);
    }
    fs.writeFileSync(copied, "not-a-sqlite-database");
    const manifestFile = path.join(backup.destination, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    const entry = manifest.files.find((file) => file.name === "health-city.sqlite");
    entry.bytes = fs.statSync(copied).size;
    entry.sha256 = createHash("sha256").update(fs.readFileSync(copied)).digest("hex");
    fs.writeFileSync(manifestFile, JSON.stringify(manifest), "utf8");
    assert.throws(() => verifyBackup(backup.destination), /SQLite|database|file|malformed|not/i);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("restore refuses existing SQLite WAL or SHM without changing target files", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "health-platform-restore-sidecar-"));
  const dataDir = path.join(root, "data");
  const backupRoot = path.join(root, "backups");
  fs.mkdirSync(dataDir);
  const jsonFile = path.join(dataDir, "db.json");
  const sqliteFile = path.join(dataDir, "health-city.sqlite");
  fs.writeFileSync(jsonFile, JSON.stringify({ residents: [{ id: "r1" }] }), "utf8");
  const sqlite = new DatabaseSync(sqliteFile);
  sqlite.exec("CREATE TABLE backup_probe(value TEXT NOT NULL)");
  sqlite.close();
  try {
    const backup = createBackup({ dataDir, backupRoot, label: "before" });
    fs.writeFileSync(jsonFile, JSON.stringify({ residents: [{ id: "r2" }] }), "utf8");
    const expectedJson = fs.readFileSync(jsonFile);
    const expectedSqlite = fs.readFileSync(sqliteFile);
    const backupCount = fs.readdirSync(backupRoot).length;
    for (const suffix of ["-wal", "-shm"]) {
      const sidecar = `${sqliteFile}${suffix}`;
      fs.writeFileSync(sidecar, "synthetic-sidecar");
      assert.throws(() => restoreBackup(backup.destination, { dataDir, backupRoot, confirm: true }), /WAL and SHM sidecars/);
      assert.deepEqual(fs.readFileSync(jsonFile), expectedJson);
      assert.deepEqual(fs.readFileSync(sqliteFile), expectedSqlite);
      assert.equal(fs.readFileSync(sidecar, "utf8"), "synthetic-sidecar");
      assert.equal(fs.readdirSync(backupRoot).length, backupCount, "no safety backup after refusal");
      fs.rmSync(sidecar);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("restore quarantines corrupt current SQLite bytes before using a verified backup", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "health-platform-restore-corrupt-"));
  const dataDir = path.join(root, "data");
  const backupRoot = path.join(root, "backups");
  fs.mkdirSync(dataDir);
  const jsonFile = path.join(dataDir, "db.json");
  const sqliteFile = path.join(dataDir, "health-city.sqlite");
  const original = { residents: [{ id: "before-recovery" }] };
  fs.writeFileSync(jsonFile, JSON.stringify(original), "utf8");
  const sqlite = new DatabaseSync(sqliteFile);
  sqlite.exec("CREATE TABLE backup_probe(value TEXT NOT NULL)");
  sqlite.prepare("INSERT INTO backup_probe(value) VALUES(?)").run("verified-backup-row");
  sqlite.close();
  try {
    const backup = createBackup({ dataDir, backupRoot, label: "verified" });
    fs.writeFileSync(jsonFile, JSON.stringify({ residents: [{ id: "damaged-current" }] }), "utf8");
    fs.writeFileSync(sqliteFile, "not-a-sqlite-database");
    const damagedJson = fs.readFileSync(jsonFile);
    const damagedSqlite = fs.readFileSync(sqliteFile);

    const blockedRoot = path.join(root, "blocked-root");
    fs.writeFileSync(blockedRoot, "not-a-directory");
    assert.throws(() => restoreBackup(backup.destination, { dataDir, backupRoot: blockedRoot, confirm: true }));
    assert.deepEqual(fs.readFileSync(jsonFile), damagedJson);
    assert.deepEqual(fs.readFileSync(sqliteFile), damagedSqlite);

    const restored = restoreBackup(backup.destination, { dataDir, backupRoot, confirm: true });
    assert.equal(restored.safetyBackup, null);
    assert.equal(restored.quarantine.validBackup, false);
    assert.equal(fs.existsSync(path.join(restored.quarantine.directory, "manifest.json")), false);
    assert.deepEqual(fs.readFileSync(path.join(restored.quarantine.directory, "db.json")), damagedJson);
    assert.deepEqual(fs.readFileSync(path.join(restored.quarantine.directory, "health-city.sqlite")), damagedSqlite);
    const quarantineRecord = JSON.parse(fs.readFileSync(path.join(restored.quarantine.directory, "quarantine.json"), "utf8"));
    assert.equal(quarantineRecord.kind, "storage-restore-quarantine-v1");
    assert.equal(quarantineRecord.validBackup, false);
    assert.deepEqual(quarantineRecord.files.map((file) => file.sha256), restored.quarantine.files.map((file) => file.sha256));
    assert.throws(() => verifyBackup(restored.quarantine.directory), /missing manifest.json/);
    assert.deepEqual(JSON.parse(fs.readFileSync(jsonFile, "utf8")), original);
    const recovered = new DatabaseSync(sqliteFile, { readOnly: true });
    try { assert.equal(recovered.prepare("SELECT value FROM backup_probe").get().value, "verified-backup-row"); }
    finally { recovered.close(); }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("restore preserves damaged JSON bytes in the safety copy without blocking a valid restore", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "health-platform-restore-json-"));
  const dataDir = path.join(root, "data");
  const backupRoot = path.join(root, "backups");
  fs.mkdirSync(dataDir);
  const jsonFile = path.join(dataDir, "db.json");
  const original = { residents: [{ id: "verified-resident" }] };
  fs.writeFileSync(jsonFile, JSON.stringify(original), "utf8");
  try {
    const backup = createBackup({ dataDir, backupRoot, label: "verified" });
    for (const damaged of ["{not-json", JSON.stringify({ residents: [{ id: "duplicate" }, { id: "duplicate" }] })]) {
      fs.writeFileSync(jsonFile, damaged, "utf8");
      const restored = restoreBackup(backup.destination, { dataDir, backupRoot, confirm: true });
      assert.equal(restored.quarantine, null);
      assert.equal(fs.readFileSync(path.join(restored.safetyBackup, "db.json"), "utf8"), damaged);
      assert.throws(() => verifyBackup(restored.safetyBackup));
      assert.deepEqual(JSON.parse(fs.readFileSync(jsonFile, "utf8")), original);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("storage admin creates a sanitized JSON snapshot and report", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "health-platform-sanitize-"));
  const dataDir = path.join(root, "data");
  const outputDir = path.join(root, "sanitized");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, "db.json"), JSON.stringify({
    accounts: [{
      id: "a1",
      name: "账户一",
      phone: "13900001111"
    }],
    residents: [{
      id: "r1",
      name: "居民一",
      idCard: "210200199001010011",
      phone: "13900001111",
      address: "大连市演示区真实地址",
      personIndex: "210200199001010011#13900001111"
    }],
    birthCertificates: [{
      id: "bc1",
      residentId: "r1",
      certificateNo: "BC-001",
      documentNo: "DOC-001",
      motherDocumentNo: "MOM-001"
    }],
    digitalCredentials: [{
      id: "dc1",
      residentId: "r1",
      credentialNo: "MI-13900001111"
    }],
    seniorServices: [{
      id: "ss1",
      residentId: "r1",
      contact: "家属姓名"
    }]
  }), "utf8");

  try {
    const sanitized = createSanitizedSnapshot({ dataDir, outputDir, fileName: "db.sanitized.json" });
    assert.ok(fs.existsSync(sanitized.outputFile));
    assert.ok(fs.existsSync(sanitized.reportFile));
    const snapshot = JSON.parse(fs.readFileSync(sanitized.outputFile, "utf8"));
    const report = JSON.parse(fs.readFileSync(sanitized.reportFile, "utf8"));

    assert.equal(snapshot.residents[0].id, "r1");
    assert.match(snapshot.residents[0].name, /^演示姓名-/);
    assert.match(snapshot.accounts[0].name, /^演示姓名-/);
    assert.match(snapshot.residents[0].idCard, /^DEMO-ID-/);
    assert.match(snapshot.residents[0].phone, /^DEMO-MOBILE-/);
    assert.equal(snapshot.accounts[0].phone, snapshot.residents[0].phone);
    assert.match(snapshot.residents[0].address, /^演示地址-/);
    assert.match(snapshot.residents[0].personIndex, /^DEMO-ID-/);
    assert.match(snapshot.birthCertificates[0].documentNo, /^DEMO-ID-/);
    assert.match(snapshot.birthCertificates[0].motherDocumentNo, /^DEMO-ID-/);
    assert.match(snapshot.birthCertificates[0].certificateNo, /^DEMO-ID-/);
    assert.match(snapshot.digitalCredentials[0].credentialNo, /^DEMO-ID-/);
    assert.match(snapshot.seniorServices[0].contact, /^演示联系人-/);
    assert.equal(JSON.stringify(snapshot).includes("210200199001010011"), false);
    assert.equal(JSON.stringify(snapshot).includes("13900001111"), false);
    assert.equal(JSON.stringify(snapshot).includes("大连市演示区真实地址"), false);
    assert.equal(report.totalMasked, 12);
    assert.equal(report.fieldsMasked["residents.idCard"], 1);
    assert.equal(snapshot.storageMeta.sanitizedSnapshot.totalMasked, 12);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("storage admin inspects JSON and SQLite model inventory", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "health-platform-inspect-"));
  const dataDir = path.join(root, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, "db.json"), JSON.stringify({
    residents: [{ id: "r1" }, { id: "r2" }],
    personalRecords: [{ id: "pr1", residentId: "r1" }],
    storageMeta: { schemaVersion: 7 }
  }), "utf8");
  fs.writeFileSync(path.join(dataDir, "health-city.sqlite"), Buffer.from("not-a-real-sqlite-file"));

  try {
    const report = inspectStorageModel({ dataDir });
    assert.equal(report.jsonSnapshot.present, true);
    assert.equal(report.jsonSnapshot.collections, 3);
    assert.equal(report.jsonSnapshot.arrayCollections, 2);
    assert.equal(report.jsonSnapshot.totalRecords, 3);
    assert.equal(report.jsonSnapshot.largestCollections[0].name, "residents");
    assert.equal(report.sqlite.present, true);
    assert.equal(report.sqlite.available, false);
    assert.match(report.sqlite.error, /SQLite|database|file|malformed|not/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
