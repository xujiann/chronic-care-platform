"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { requireE2EPort } = require("./playwright-port-policy");

const root = path.resolve(__dirname, "..", "..");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "resident-mini-program-e2e-"));
fs.copyFileSync(path.join(root, "data", "db.json"), path.join(dataDir, "db.json"));

const port = requireE2EPort();
process.env.PORT = String(port);
process.env.DATA_DIR = dataDir;
process.env.STORAGE_ENGINE = "json";

const { startServer, stopServer } = require(path.join(root, "server.js"));

let shuttingDown = false;

async function shutdown(reason = "requested") {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await stopServer();
    fs.rmSync(dataDir, { recursive: true, force: true });
    if (process.send) process.send({ type: "stopped", reason });
    process.exit(0);
  } catch (error) {
    process.stderr.write(`居民端测试服务清理失败：${error.message}\n`);
    process.exit(1);
  }
}

process.on("message", (message) => {
  if (message?.type === "shutdown") void shutdown("ipc");
});
process.on("SIGINT", () => void shutdown("signal"));
process.on("SIGTERM", () => void shutdown("signal"));
process.on("uncaughtException", (error) => {
  process.stderr.write(`居民端测试服务异常：${error.message}\n`);
  void shutdown("exception");
});

startServer(port);
