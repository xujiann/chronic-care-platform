"use strict";

const { defineConfig } = require("@playwright/test");
const { createBrowserUse } = require("./playwright-browser-policy");
const { createE2EBaseURL, requireE2EPort } = require("./playwright-port-policy");

const baseURL = createE2EBaseURL(requireE2EPort());

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: "resident-mini-program.spec.js",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  reporter: "line",
  use: createBrowserUse(baseURL),
  expect: {
    timeout: 15_000
  }
});
