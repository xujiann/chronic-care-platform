const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createBackup, restoreBackup, verifyBackup } = require("../scripts/storage-admin");

test("storage backup verifies checksums and restores with a safety copy", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "health-platform-backup-"));
  const dataDir = path.join(root, "data");
  const backupRoot = path.join(root, "backups");
  fs.mkdirSync(dataDir, { recursive: true });
  const original = { residents: [{ id: "r1", name: "备份测试居民" }] };
  fs.writeFileSync(path.join(dataDir, "db.json"), JSON.stringify(original), "utf8");
  fs.writeFileSync(path.join(dataDir, "health-city.sqlite"), Buffer.from("sqlite-test-content"));

  try {
    const backup = createBackup({ dataDir, backupRoot, label: "test" });
    const manifest = verifyBackup(backup.destination);
    assert.deepEqual(manifest.files.map((item) => item.name).sort(), ["db.json", "health-city.sqlite"]);
    fs.writeFileSync(path.join(dataDir, "db.json"), JSON.stringify({ residents: [] }), "utf8");
    assert.throws(() => restoreBackup(backup.destination, { dataDir, backupRoot }), /confirm=true/);
    const restored = restoreBackup(backup.destination, { dataDir, backupRoot, confirm: true });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataDir, "db.json"), "utf8")), original);
    assert.ok(fs.existsSync(path.join(restored.safetyBackup, "manifest.json")));
    fs.appendFileSync(path.join(backup.destination, "db.json"), "tampered");
    assert.throws(() => verifyBackup(backup.destination), /大小不匹配|校验失败/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
