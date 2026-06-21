const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "health-platform-e2e-"));
fs.copyFileSync(path.join(root, "data", "db.json"), path.join(dataDir, "db.json"));

process.env.PORT = "5210";
process.env.DATA_DIR = dataDir;
process.env.STORAGE_ENGINE = "json";

let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  fs.rmSync(dataDir, { recursive: true, force: true });
}

process.on("exit", cleanup);
process.on("SIGINT", () => {
  cleanup();
  process.exit(0);
});
process.on("SIGTERM", () => {
  cleanup();
  process.exit(0);
});

const { startServer } = require(path.join(root, "server.js"));
startServer(5210);
