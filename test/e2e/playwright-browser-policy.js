"use strict";

const BROWSER_POLICY_VERSION = "playwright-browser-policy.v1";

function createBrowserUse(baseURL) {
  return {
    baseURL,
    browserName: "chromium",
    headless: true,
    serviceWorkers: "block",
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  };
}

module.exports = {
  BROWSER_POLICY_VERSION,
  createBrowserUse
};
