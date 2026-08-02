"use strict";

const { defineConfig } = require("@playwright/test");
const fs = require("node:fs");

const localChrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const launchOptions = !process.env.CI && fs.existsSync(localChrome) ? { executablePath: localChrome } : {};

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: "resident-mini-program.spec.js",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:5210",
    browserName: "chromium",
    headless: true,
    launchOptions,
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  },
  expect: {
    timeout: 15_000
  }
});
