const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createBackup, rehearseRestore, restoreBackup, verifyBackup } = require("../scripts/storage-admin");

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

    const rehearsal = rehearseRestore(backup.destination, { rehearsalRoot: path.join(root, "restore-rehearsals") });
    assert.equal(rehearsal.ok, true);
    assert.deepEqual(rehearsal.files.sort(), ["db.json", "health-city.sqlite"]);
    assert.ok(fs.existsSync(path.join(rehearsal.rehearsalDataDir, "db.json")));
    assert.ok(fs.existsSync(path.join(rehearsal.rehearsalBackup, "manifest.json")));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataDir, "db.json"), "utf8")), original);

    fs.writeFileSync(path.join(dataDir, "db.json"), JSON.stringify({ residents: [] }), "utf8");
    assert.throws(() => restoreBackup(backup.destination, { dataDir, backupRoot }), /confirm=true/);
    const restored = restoreBackup(backup.destination, { dataDir, backupRoot, confirm: true });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataDir, "db.json"), "utf8")), original);
    assert.ok(fs.existsSync(path.join(restored.safetyBackup, "manifest.json")));

    fs.appendFileSync(path.join(backup.destination, "db.json"), "tampered");
    assert.throws(() => verifyBackup(backup.destination), /size mismatch|checksum failed/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
