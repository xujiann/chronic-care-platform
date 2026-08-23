const { defineConfig } = require("@playwright/test");
const { createBrowserUse } = require("./test/e2e/playwright-browser-policy");
const { createE2EBaseURL, requireE2EPort } = require("./test/e2e/playwright-port-policy");

const port = requireE2EPort();
const baseURL = createE2EBaseURL(port);

module.exports = defineConfig({
  testDir: "./test/e2e",
  testMatch: "*.spec.js",
  testIgnore: ["resident-mini-program.spec.js", "pwa-service-worker.spec.js"],
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  reporter: "line",
  use: createBrowserUse(baseURL),
  expect: {
    timeout: 15_000
  },
  webServer: {
    command: "node test/e2e/test-server.js",
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 20_000
  }
});
