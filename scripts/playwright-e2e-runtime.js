"use strict";

const { spawn } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");

const HOST = "127.0.0.1";

function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, HOST, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

async function runPlaywrightSuite({ root, configPath, args = [] }) {
  const port = await findAvailablePort();
  const playwrightEntry = path.join(root, "node_modules", "@playwright", "test", "cli.js");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [playwrightEntry, "test", "--config", configPath, ...args], {
      cwd: root,
      env: { ...process.env, PLAYWRIGHT_E2E_PORT: String(port) },
      shell: false,
      stdio: "inherit",
      windowsHide: true
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

module.exports = {
  HOST,
  findAvailablePort,
  runPlaywrightSuite
};
