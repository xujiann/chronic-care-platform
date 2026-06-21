const { createHash, randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const STORAGE_FILES = ["db.json", "health-city.sqlite"];

function sha256(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function resolveDataDir(value) {
  return path.resolve(value || process.env.DATA_DIR || path.join(ROOT, "data"));
}

function createBackup(options = {}) {
  const dataDir = resolveDataDir(options.dataDir);
  const backupRoot = path.resolve(options.backupRoot || path.join(dataDir, "backups"));
  const label = String(options.label || "manual").replace(/[^a-zA-Z0-9_-]/g, "-");
  const destination = path.join(backupRoot, `${timestamp()}-${label}-${randomUUID().slice(0, 8)}`);
  const available = STORAGE_FILES.filter((name) => fs.existsSync(path.join(dataDir, name)));
  if (!available.length) throw new Error(`No storage files are available for backup: ${dataDir}`);

  fs.mkdirSync(destination, { recursive: true });
  const files = available.map((name) => {
    const source = path.join(dataDir, name);
    const target = path.join(destination, name);
    fs.copyFileSync(source, target);
    return { name, bytes: fs.statSync(target).size, sha256: sha256(target) };
  });
  const manifest = { formatVersion: 1, createdAt: new Date().toISOString(), label, sourceDataDir: dataDir, files };
  fs.writeFileSync(path.join(destination, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  return { destination, manifest };
}

function verifyBackup(backupDir) {
  const directory = path.resolve(backupDir);
  const manifestFile = path.join(directory, "manifest.json");
  if (!fs.existsSync(manifestFile)) throw new Error("Backup is missing manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  if (manifest.formatVersion !== 1 || !Array.isArray(manifest.files) || !manifest.files.length) throw new Error("Backup manifest is invalid");
  manifest.files.forEach((entry) => {
    if (!STORAGE_FILES.includes(entry.name)) throw new Error(`Backup contains disallowed file: ${entry.name}`);
    const file = path.join(directory, entry.name);
    if (!fs.existsSync(file)) throw new Error(`Backup file is missing: ${entry.name}`);
    if (fs.statSync(file).size !== entry.bytes) throw new Error(`Backup file size mismatch: ${entry.name}`);
    if (sha256(file) !== entry.sha256) throw new Error(`Backup checksum failed: ${entry.name}`);
    if (entry.name === "db.json") JSON.parse(fs.readFileSync(file, "utf8"));
  });
  return manifest;
}

function restoreBackup(backupDir, options = {}) {
  const startedAt = Date.now();
  if (!options.confirm) throw new Error("Restore requires confirm=true and the service must be stopped");
  const dataDir = resolveDataDir(options.dataDir);
  const backupRoot = path.resolve(options.backupRoot || path.join(dataDir, "backups"));
  const manifest = verifyBackup(backupDir);
  const safety = createBackup({ dataDir, backupRoot, label: "pre-restore" });
  manifest.files.forEach((entry) => {
    const source = path.join(path.resolve(backupDir), entry.name);
    const target = path.join(dataDir, entry.name);
    const temporary = `${target}.restore-${process.pid}`;
    fs.copyFileSync(source, temporary);
    if (fs.existsSync(target)) fs.rmSync(target);
    fs.renameSync(temporary, target);
  });
  return {
    restoredFrom: path.resolve(backupDir),
    safetyBackup: safety.destination,
    files: manifest.files.map((item) => item.name),
    metrics: recoveryMetrics(manifest, startedAt)
  };
}

function rehearseRestore(backupDir, options = {}) {
  const startedAt = Date.now();
  const rehearsalRoot = path.resolve(options.rehearsalRoot || path.join(path.resolve(backupDir), "..", "restore-rehearsals"));
  const rehearsalDataDir = path.join(rehearsalRoot, `${timestamp()}-rehearsal-${randomUUID().slice(0, 8)}`);
  fs.mkdirSync(rehearsalDataDir, { recursive: true });
  const manifest = verifyBackup(backupDir);
  manifest.files.forEach((entry) => {
    fs.copyFileSync(path.join(path.resolve(backupDir), entry.name), path.join(rehearsalDataDir, entry.name));
  });
  const rehearsalBackup = createBackup({ dataDir: rehearsalDataDir, backupRoot: path.join(rehearsalDataDir, "backups"), label: "rehearsal-check" });
  const restored = verifyBackup(rehearsalBackup.destination);
  const metrics = recoveryMetrics(restored, startedAt);
  return {
    ok: true,
    sourceBackup: path.resolve(backupDir),
    rehearsalDataDir,
    rehearsalBackup: rehearsalBackup.destination,
    files: restored.files.map((item) => item.name),
    metrics,
    objectives: recoveryObjectives(metrics, options)
  };
}

function recoveryMetrics(manifest, startedAt) {
  return {
    durationMs: Date.now() - startedAt,
    fileCount: manifest.files.length,
    totalBytes: manifest.files.reduce((sum, item) => sum + Number(item.bytes || 0), 0)
  };
}

function recoveryObjectives(metrics, options = {}) {
  const maxDurationMs = Number(options.maxDurationMs);
  const checks = [];
  if (Number.isFinite(maxDurationMs) && maxDurationMs >= 0) {
    checks.push({
      name: "maxDurationMs",
      expected: maxDurationMs,
      actual: metrics.durationMs,
      passed: metrics.durationMs <= maxDurationMs
    });
  }
  return {
    passed: checks.every((item) => item.passed),
    checks
  };
}

function numberFlag(flags, name) {
  const prefix = `${name}=`;
  const value = flags.find((flag) => flag.startsWith(prefix))?.slice(prefix.length);
  return value === undefined ? undefined : Number(value);
}

function runCli() {
  const [command, target, ...flags] = process.argv.slice(2);
  if (command === "backup") return console.log(JSON.stringify(createBackup(), null, 2));
  if (command === "verify" && target) return console.log(JSON.stringify(verifyBackup(target), null, 2));
  if (command === "rehearse" && target) return console.log(JSON.stringify(rehearseRestore(target, { maxDurationMs: numberFlag(flags, "--max-duration-ms") }), null, 2));
  if (command === "restore" && target) return console.log(JSON.stringify(restoreBackup(target, { confirm: flags.includes("--confirm") }), null, 2));
  throw new Error("Usage: storage-admin.js backup | verify <backup-dir> | rehearse <backup-dir> [--max-duration-ms=N] | restore <backup-dir> --confirm");
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { createBackup, rehearseRestore, restoreBackup, verifyBackup };
