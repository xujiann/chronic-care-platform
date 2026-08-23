"use strict";

const BROWSER_POLICY_VERSION = "playwright-browser-policy.v1";
const PWA_BROWSER_POLICY_VERSION = "playwright-pwa-browser-policy.v1";

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

function createPwaBrowserUse(baseURL) {
  return {
    ...createBrowserUse(baseURL),
    serviceWorkers: "allow"
  };
}

module.exports = {
  BROWSER_POLICY_VERSION,
  PWA_BROWSER_POLICY_VERSION,
  createBrowserUse,
  createPwaBrowserUse
};
