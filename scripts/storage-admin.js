const { createHash, randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const STORAGE_FILES = ["db.json", "health-city.sqlite"];
const SENSITIVE_FIELD_RULES = [
  { pattern: /^(idCard|documentNo|motherDocumentNo|fatherDocumentNo|certificateNo|credentialNo|personIndex|identityIndex)$/i, replacement: "DEMO-ID" },
  { pattern: /(phone|mobile|tel)$/i, replacement: "DEMO-MOBILE" },
  { pattern: /address$/i, replacement: "演示地址" },
  { pattern: /contact$/i, replacement: "演示联系人" }
];

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

function createSanitizedSnapshot(options = {}) {
  const dataDir = resolveDataDir(options.dataDir);
  const source = path.join(dataDir, "db.json");
  if (!fs.existsSync(source)) throw new Error(`Source snapshot is missing: ${source}`);

  const outputDir = path.resolve(options.outputDir || path.join(dataDir, "sanitized"));
  const outputFile = path.join(outputDir, options.fileName || `db.sanitized.${timestamp()}.json`);
  const snapshot = JSON.parse(fs.readFileSync(source, "utf8"));
  const report = {
    createdAt: new Date().toISOString(),
    source,
    outputFile,
    sourceSha256: sha256(source),
    fieldsMasked: {},
    totalMasked: 0
  };
  const sanitized = sanitizeValue(snapshot, [], report);
  sanitized.storageMeta = {
    ...(sanitized.storageMeta || {}),
    sanitizedSnapshot: {
      generatedAt: report.createdAt,
      sourceSha256: report.sourceSha256,
      totalMasked: report.totalMasked
    }
  };

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputFile, JSON.stringify(sanitized, null, 2), "utf8");
  const reportFile = `${outputFile}.report.json`;
  report.outputSha256 = sha256(outputFile);
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), "utf8");
  return { outputFile, reportFile, report };
}

function sanitizeValue(value, pathSegments, report) {
  if (Array.isArray(value)) return value.map((item, index) => sanitizeValue(item, [...pathSegments, String(index)], report));
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(Object.entries(value).map(([key, entryValue]) => {
    const rule = SENSITIVE_FIELD_RULES.find((item) => item.pattern.test(key));
    if (rule && entryValue !== undefined && entryValue !== null && String(entryValue).trim() !== "") {
      const masked = `${rule.replacement}-${stableToken(String(entryValue))}`;
      const reportKey = [...pathSegments.filter((segment) => !/^\d+$/.test(segment)), key].join(".");
      report.fieldsMasked[reportKey] = (report.fieldsMasked[reportKey] || 0) + 1;
      report.totalMasked += 1;
      return [key, masked];
    }
    return [key, sanitizeValue(entryValue, [...pathSegments, key], report)];
  }));
}

function stableToken(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 8).toUpperCase();
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
  const dataQuality = verifyBackupDataQuality(manifest, directory);
  if (!dataQuality.passed) {
    throw new Error(`Backup data quality failed: ${dataQuality.checks.filter((item) => !item.passed).map((item) => item.name).join(", ")}`);
  }
  return { ...manifest, dataQuality };
}

function verifyBackupDataQuality(manifest, directory) {
  const checks = [];
  const dbEntry = manifest.files.find((entry) => entry.name === "db.json");
  if (!dbEntry) {
    checks.push({ name: "jsonSnapshotPresent", passed: false, detail: "db.json is required for data quality checks" });
    return { passed: false, checks };
  }

  const snapshot = JSON.parse(fs.readFileSync(path.join(directory, dbEntry.name), "utf8"));
  checks.push({ name: "jsonSnapshotReadable", passed: true });

  const duplicateCollections = findDuplicateIds(snapshot);
  checks.push({
    name: "uniqueCollectionIds",
    passed: duplicateCollections.length === 0,
    detail: duplicateCollections
  });

  const danglingResidentRefs = findDanglingResidentRefs(snapshot);
  checks.push({
    name: "residentReferencesExist",
    passed: danglingResidentRefs.length === 0,
    detail: danglingResidentRefs
  });

  return {
    passed: checks.every((item) => item.passed),
    checks
  };
}

function findDuplicateIds(snapshot) {
  return Object.entries(snapshot)
    .filter(([, value]) => Array.isArray(value))
    .flatMap(([collection, items]) => {
      const seen = new Set();
      const duplicates = new Set();
      items.forEach((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item) || item.id === undefined) return;
        const id = String(item.id);
        if (seen.has(id)) duplicates.add(id);
        seen.add(id);
      });
      return [...duplicates].map((id) => ({ collection, id }));
    });
}

function findDanglingResidentRefs(snapshot) {
  const residentIds = new Set(Array.isArray(snapshot.residents) ? snapshot.residents.map((resident) => String(resident.id)) : []);
  if (!residentIds.size) return [];
  return Object.entries(snapshot)
    .filter(([, value]) => Array.isArray(value))
    .flatMap(([collection, items]) => items
      .filter((item) => item && typeof item === "object" && !Array.isArray(item) && item.residentId !== undefined)
      .filter((item) => !residentIds.has(String(item.residentId)))
      .map((item) => ({ collection, id: String(item.id || ""), residentId: String(item.residentId) })));
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

function assessRecoveryReadiness(backupDir, options = {}) {
  const startedAt = Date.now();
  const manifest = verifyBackup(backupDir);
  const rehearsal = rehearseRestore(backupDir, {
    rehearsalRoot: options.rehearsalRoot,
    maxDurationMs: options.maxDurationMs
  });
  const checks = [
    backupAgeCheck(manifest, options, startedAt),
    requiredFilesCheck(manifest, options),
    minimumFileCountCheck(manifest, options),
    minimumTotalBytesCheck(manifest, options),
    {
      name: "dataQuality",
      passed: manifest.dataQuality?.passed === true,
      detail: manifest.dataQuality?.checks || []
    },
    {
      name: "restoreRehearsal",
      passed: rehearsal.ok === true && rehearsal.objectives.passed === true,
      detail: rehearsal.objectives.checks
    }
  ].filter(Boolean);

  return {
    passed: checks.every((item) => item.passed),
    assessedAt: new Date(startedAt).toISOString(),
    sourceBackup: path.resolve(backupDir),
    files: manifest.files.map((item) => item.name),
    metrics: {
      backupAgeMs: startedAt - Date.parse(manifest.createdAt),
      rehearsalDurationMs: rehearsal.metrics.durationMs,
      fileCount: manifest.files.length,
      totalBytes: manifest.files.reduce((sum, item) => sum + Number(item.bytes || 0), 0)
    },
    checks,
    rehearsal
  };
}

function backupAgeCheck(manifest, options, nowMs) {
  const maxBackupAgeMs = Number(options.maxBackupAgeMs);
  if (!Number.isFinite(maxBackupAgeMs) || maxBackupAgeMs < 0) return null;
  const actual = nowMs - Date.parse(manifest.createdAt);
  return {
    name: "maxBackupAgeMs",
    expected: maxBackupAgeMs,
    actual,
    passed: Number.isFinite(actual) && actual <= maxBackupAgeMs
  };
}

function requiredFilesCheck(manifest, options) {
  const requiredFiles = Array.isArray(options.requiredFiles) && options.requiredFiles.length ? options.requiredFiles : STORAGE_FILES;
  const present = new Set(manifest.files.map((item) => item.name));
  const missing = requiredFiles.filter((name) => !present.has(name));
  return {
    name: "requiredFiles",
    expected: requiredFiles,
    actual: manifest.files.map((item) => item.name),
    passed: missing.length === 0,
    missing
  };
}

function minimumFileCountCheck(manifest, options) {
  const minFileCount = Number(options.minFileCount);
  if (!Number.isFinite(minFileCount) || minFileCount < 0) return null;
  return {
    name: "minFileCount",
    expected: minFileCount,
    actual: manifest.files.length,
    passed: manifest.files.length >= minFileCount
  };
}

function minimumTotalBytesCheck(manifest, options) {
  const minTotalBytes = Number(options.minTotalBytes);
  if (!Number.isFinite(minTotalBytes) || minTotalBytes < 0) return null;
  const totalBytes = manifest.files.reduce((sum, item) => sum + Number(item.bytes || 0), 0);
  return {
    name: "minTotalBytes",
    expected: minTotalBytes,
    actual: totalBytes,
    passed: totalBytes >= minTotalBytes
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

function stringFlag(flags, name) {
  const prefix = `${name}=`;
  return flags.find((flag) => flag.startsWith(prefix))?.slice(prefix.length);
}

function listFlag(flags, name) {
  return String(stringFlag(flags, name) || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function runCli() {
  const [command, target, ...flags] = process.argv.slice(2);
  if (command === "backup") return console.log(JSON.stringify(createBackup(), null, 2));
  if (command === "sanitize") return console.log(JSON.stringify(createSanitizedSnapshot({ outputDir: target, fileName: stringFlag(flags, "--file-name") }), null, 2));
  if (command === "verify" && target) return console.log(JSON.stringify(verifyBackup(target), null, 2));
  if (command === "rehearse" && target) return console.log(JSON.stringify(rehearseRestore(target, { maxDurationMs: numberFlag(flags, "--max-duration-ms") }), null, 2));
  if (command === "assess" && target) {
    return console.log(JSON.stringify(assessRecoveryReadiness(target, {
      maxBackupAgeMs: numberFlag(flags, "--max-backup-age-ms"),
      maxDurationMs: numberFlag(flags, "--max-duration-ms"),
      minFileCount: numberFlag(flags, "--min-file-count"),
      minTotalBytes: numberFlag(flags, "--min-total-bytes"),
      requiredFiles: listFlag(flags, "--required-files")
    }), null, 2));
  }
  if (command === "restore" && target) return console.log(JSON.stringify(restoreBackup(target, { confirm: flags.includes("--confirm") }), null, 2));
  throw new Error("Usage: storage-admin.js backup | sanitize [output-dir] | verify <backup-dir> | rehearse <backup-dir> [--max-duration-ms=N] | assess <backup-dir> [--max-backup-age-ms=N] [--max-duration-ms=N] [--min-file-count=N] [--min-total-bytes=N] [--required-files=a,b] | restore <backup-dir> --confirm");
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { assessRecoveryReadiness, createBackup, createSanitizedSnapshot, rehearseRestore, restoreBackup, verifyBackup };
