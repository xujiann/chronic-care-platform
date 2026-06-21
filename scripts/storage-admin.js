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
  if (!available.length) throw new Error(`没有可备份的存储文件：${dataDir}`);

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
  if (!fs.existsSync(manifestFile)) throw new Error("备份缺少 manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  if (manifest.formatVersion !== 1 || !Array.isArray(manifest.files) || !manifest.files.length) throw new Error("备份清单格式无效");
  manifest.files.forEach((entry) => {
    if (!STORAGE_FILES.includes(entry.name)) throw new Error(`备份包含不允许的文件：${entry.name}`);
    const file = path.join(directory, entry.name);
    if (!fs.existsSync(file)) throw new Error(`备份文件缺失：${entry.name}`);
    if (fs.statSync(file).size !== entry.bytes) throw new Error(`备份文件大小不匹配：${entry.name}`);
    if (sha256(file) !== entry.sha256) throw new Error(`备份校验失败：${entry.name}`);
    if (entry.name === "db.json") JSON.parse(fs.readFileSync(file, "utf8"));
  });
  return manifest;
}

function restoreBackup(backupDir, options = {}) {
  if (!options.confirm) throw new Error("恢复操作必须显式传入 confirm=true，并确保服务已停止");
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
  return { restoredFrom: path.resolve(backupDir), safetyBackup: safety.destination, files: manifest.files.map((item) => item.name) };
}

function runCli() {
  const [command, target, ...flags] = process.argv.slice(2);
  if (command === "backup") return console.log(JSON.stringify(createBackup(), null, 2));
  if (command === "verify" && target) return console.log(JSON.stringify(verifyBackup(target), null, 2));
  if (command === "restore" && target) return console.log(JSON.stringify(restoreBackup(target, { confirm: flags.includes("--confirm") }), null, 2));
  throw new Error("用法：storage-admin.js backup | verify <备份目录> | restore <备份目录> --confirm");
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { createBackup, restoreBackup, verifyBackup };
