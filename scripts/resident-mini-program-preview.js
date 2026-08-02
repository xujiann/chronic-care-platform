"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "resident-mini-program-preview-"));
fs.copyFileSync(path.join(root, "data", "db.json"), path.join(dataDir, "db.json"));

process.env.PORT = "5173";
process.env.DATA_DIR = dataDir;
process.env.STORAGE_ENGINE = "json";

const { startServer, stopServer } = require(path.join(root, "server.js"));

let shuttingDown = false;

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await stopServer();
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
process.on("exit", () => {
  if (fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
});

startServer(5173);
