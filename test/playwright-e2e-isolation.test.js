"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const E2E_DIR = path.join(ROOT, "test", "e2e");
const PLAYWRIGHT_CLI = path.join(ROOT, "node_modules", "@playwright", "test", "cli.js");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function listTests(configPath) {
  const result = spawnSync(process.execPath, [
    PLAYWRIGHT_CLI,
    "test",
    "--list",
    "--config",
    path.join(ROOT, configPath)
  ], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", PLAYWRIGHT_E2E_PORT: "42100" },
    windowsHide: true
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /\.spec\.js:\d+:\d+ › /.test(line));
}

test("local and CI E2E use the same isolated Playwright Chromium policy", () => {
  process.env.PLAYWRIGHT_E2E_PORT = "42100";
  const rootConfig = require(path.join(ROOT, "playwright.config.js"));
  const residentConfig = require(path.join(E2E_DIR, "resident-mini-program.playwright.config.js"));
  const pwaConfig = require(path.join(E2E_DIR, "pwa-service-worker.playwright.config.js"));
  const policy = require(path.join(E2E_DIR, "playwright-browser-policy.js"));

  assert.equal(policy.BROWSER_POLICY_VERSION, "playwright-browser-policy.v1");
  assert.equal(policy.PWA_BROWSER_POLICY_VERSION, "playwright-pwa-browser-policy.v1");
  for (const config of [rootConfig, residentConfig]) {
    assert.equal(config.use.browserName, "chromium");
    assert.equal(config.use.serviceWorkers, "block");
    assert.equal(config.use.headless, true);
    assert.equal(config.use.channel, undefined);
    assert.equal(config.use.launchOptions, undefined);
  }
  assert.equal(pwaConfig.use.browserName, "chromium");
  assert.equal(pwaConfig.use.serviceWorkers, "allow");
  assert.equal(pwaConfig.use.headless, true);
  assert.equal(pwaConfig.use.channel, undefined);
  assert.equal(pwaConfig.use.launchOptions, undefined);

  for (const source of [read("playwright.config.js"), read("test/e2e/resident-mini-program.playwright.config.js")]) {
    assert.doesNotMatch(source, /executablePath|localChrome|Program Files|existsSync/);
    assert.match(source, /createBrowserUse/);
  }
  assert.match(read("test/e2e/pwa-service-worker.playwright.config.js"), /createPwaBrowserUse/);
});

test("online, resident and PWA Playwright suites form an exact disjoint partition of all 47 tests", () => {
  const rootTests = listTests("playwright.config.js");
  const residentTests = listTests("test/e2e/resident-mini-program.playwright.config.js");
  const pwaTests = listTests("test/e2e/pwa-service-worker.playwright.config.js");
  const union = new Set([...rootTests, ...residentTests, ...pwaTests]);
  const specFiles = fs.readdirSync(E2E_DIR).filter((name) => name.endsWith(".spec.js"));
  const declared = specFiles.reduce((total, name) => {
    return total + (read(`test/e2e/${name}`).match(/^test\(/gm) || []).length;
  }, 0);

  assert.equal(rootTests.length, 31);
  assert.equal(residentTests.length, 13);
  assert.equal(pwaTests.length, 3);
  assert.equal(declared, 47);
  assert.equal(union.size, 47);
  assert.equal(rootTests.some((entry) => entry.startsWith("resident-mini-program.spec.js:")), false);
  assert.equal(rootTests.some((entry) => entry.startsWith("pwa-service-worker.spec.js:")), false);
  assert.equal(residentTests.every((entry) => entry.startsWith("resident-mini-program.spec.js:")), true);
  assert.equal(pwaTests.every((entry) => entry.startsWith("pwa-service-worker.spec.js:")), true);
  for (const name of specFiles) {
    assert.equal([...union].some((entry) => entry.startsWith(`${name}:`)), true, `${name} is not owned by an E2E suite`);
  }
});

test("the standard E2E command keeps PWA isolated and forwards repeat filters", () => {
  const pkg = JSON.parse(read("package.json"));
  const runner = read("scripts/resident-mini-program-e2e.js");
  const rootRunner = read("scripts/playwright-e2e.js");
  const pwaRunner = read("scripts/pwa-service-worker-e2e.js");
  const sharedRunner = read("scripts/playwright-e2e-runtime.js");
  const rootServer = read("test/e2e/test-server.js");
  const residentServer = read("test/e2e/resident-mini-program-test-server.js");

  assert.equal(pkg.scripts["test:e2e"], "npm run test:e2e:root && npm run test:e2e:resident && npm run test:e2e:pwa");
  assert.equal(pkg.scripts["test:e2e:root"], "node scripts/playwright-e2e.js");
  assert.equal(pkg.scripts["test:e2e:resident"], "node scripts/resident-mini-program-e2e.js");
  assert.equal(pkg.scripts["test:e2e:pwa"], "node scripts/pwa-service-worker-e2e.js");
  assert.match(runner, /\.\.\.process\.argv\.slice\(2\)/);
  assert.match(runner, /stopOwnedServer\(server, port\)/);
  assert.match(runner, /waitForHealth\(port, false, 3000\)/);
  assert.match(runner, /!healthy \|\| server\.exitCode !== null/);
  assert.match(rootRunner, /runPlaywrightSuite/);
  assert.match(rootRunner, /args: process\.argv\.slice\(2\)/);
  assert.match(pwaRunner, /runPlaywrightSuite/);
  assert.match(pwaRunner, /args: process\.argv\.slice\(2\)/);
  assert.match(sharedRunner, /findAvailablePort\(\)/);
  assert.match(sharedRunner, /PLAYWRIGHT_E2E_PORT: String\(port\)/);
  assert.match(rootServer, /mkdtempSync\([\s\S]*health-platform-e2e-/);
  assert.match(residentServer, /mkdtempSync\([\s\S]*resident-mini-program-e2e-/);
  assert.doesNotMatch(`${rootServer}\n${residentServer}`, /5210/);
  assert.match(read("test/e2e/pwa-service-worker.spec.js"), /getRegistrations\(\)/);
  assert.match(read("test/e2e/pwa-service-worker.spec.js"), /caches\.delete/);
});
