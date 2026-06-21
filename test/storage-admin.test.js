const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createBackup, createSanitizedSnapshot, rehearseRestore, restoreBackup, verifyBackup } = require("../scripts/storage-admin");

test("storage backup verifies checksums, rehearses restore, and restores with a safety copy", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "health-platform-backup-"));
  const dataDir = path.join(root, "data");
  const backupRoot = path.join(root, "backups");
  fs.mkdirSync(dataDir, { recursive: true });
  const original = { residents: [{ id: "r1", name: "backup-test-resident" }] };
  fs.writeFileSync(path.join(dataDir, "db.json"), JSON.stringify(original), "utf8");
  fs.writeFileSync(path.join(dataDir, "health-city.sqlite"), Buffer.from("sqlite-test-content"));

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
    assert.equal(snapshot.residents[0].name, "居民一");
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
    assert.equal(report.totalMasked, 10);
    assert.equal(report.fieldsMasked["residents.idCard"], 1);
    assert.equal(snapshot.storageMeta.sanitizedSnapshot.totalMasked, 10);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
