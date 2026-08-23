#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { runPlaywrightSuite } = require("./playwright-e2e-runtime");

const root = path.resolve(__dirname, "..");
const playwrightConfig = path.join(root, "test", "e2e", "pwa-service-worker.playwright.config.js");

async function main() {
  const result = await runPlaywrightSuite({ root, configPath: playwrightConfig, args: process.argv.slice(2) });
  if (result.code !== 0) throw new Error(`PWA Service Worker 浏览器测试失败：${result.code ?? result.signal}`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
