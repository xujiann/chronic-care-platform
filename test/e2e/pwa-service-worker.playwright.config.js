"use strict";

const { defineConfig } = require("@playwright/test");
const { createPwaBrowserUse } = require("./playwright-browser-policy");
const { createE2EBaseURL, requireE2EPort } = require("./playwright-port-policy");

const baseURL = createE2EBaseURL(requireE2EPort());

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: "pwa-service-worker.spec.js",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  reporter: "line",
  use: createPwaBrowserUse(baseURL),
  expect: {
    timeout: 20_000
  },
  webServer: {
    command: "node test-server.js",
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 20_000
  }
});
