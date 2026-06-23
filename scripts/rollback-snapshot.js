#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, "data");
const BACKUP_ROOT = path.join(DATA_DIR, "backups");
const ROLLBACK_FILES = ["db.json", "health-city.sqlite"];

function copyIfExists(fromDir, toDir, fileName) {
  const source = path.join(fromDir, fileName);
  if (!fs.existsSync(source)) return null;
  const target = path.join(toDir, fileName);
  fs.copyFileSync(source, target);
  return { fileName, source, target };
}

function latestBackupDir() {
  if (!fs.existsSync(BACKUP_ROOT)) return "";
  return fs.readdirSync(BACKUP_ROOT)
    .map((name) => path.join(BACKUP_ROOT, name))
    .filter((candidate) => fs.statSync(candidate).isDirectory())
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || "";
}

function main() {
  const explicitBackup = process.argv[2] ? path.resolve(process.argv[2]) : "";
  const backupDir = explicitBackup || latestBackupDir();
  if (!backupDir || !fs.existsSync(backupDir)) {
    console.error("No backup directory found. Pass a backup path or create one with `npm.cmd run storage:backup`.");
    process.exit(1);
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const safetyDir = path.join(BACKUP_ROOT, `pre-rollback-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  fs.mkdirSync(safetyDir, { recursive: true });
  const safetyCopies = ROLLBACK_FILES.map((fileName) => copyIfExists(DATA_DIR, safetyDir, fileName)).filter(Boolean);
  const restored = ROLLBACK_FILES.map((fileName) => copyIfExists(backupDir, DATA_DIR, fileName)).filter(Boolean);
  const report = {
    ok: restored.some((item) => item.fileName === "db.json"),
    rolledBackAt: new Date().toISOString(),
    backupDir,
    safetyDir,
    restored: restored.map((item) => item.fileName),
    safetyCopies: safetyCopies.map((item) => item.fileName)
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}

if (require.main === module) main();
