#!/usr/bin/env node
"use strict";

const { spawn } = require("node:child_process");
const path = require("node:path");
const { findAvailablePort } = require("./playwright-e2e-runtime");

const root = path.resolve(__dirname, "..");
const playwrightEntry = path.join(root, "node_modules", "@playwright", "test", "cli.js");
const playwrightConfig = path.join(root, "playwright.config.js");

function runPlaywright(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      playwrightEntry,
      "test",
      "--config",
      playwrightConfig,
      ...process.argv.slice(2)
    ], {
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

async function main() {
  const port = await findAvailablePort();
  const result = await runPlaywright(port);
  if (result.code !== 0) throw new Error(`平台浏览器测试失败：${result.code ?? result.signal}`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
