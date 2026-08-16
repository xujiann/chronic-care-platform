"use strict";

const fs = require("node:fs");
const path = require("node:path");
const defaultBudgets = require("../../../config/platform-nonfunctional-budgets.json");

function fileMetrics(root, relative) {
  const target = path.resolve(root, relative);
  if (!target.startsWith(`${path.resolve(root)}${path.sep}`)) throw new TypeError(`file escapes project root: ${relative}`);
  if (!fs.existsSync(target) || !fs.lstatSync(target).isFile()) return { file: relative, present: false, bytes: 0, lines: 0 };
  const bytes = fs.readFileSync(target);
  return { file: relative, present: true, bytes: bytes.length, lines: bytes.toString("utf8").split(/\r?\n/).length };
}

function listFiles(directory, predicate) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  const visit = (current) => fs.readdirSync(current, { withFileTypes: true }).forEach((entry) => {
    const target = path.join(current, entry.name);
    if (entry.isDirectory()) visit(target);
    else if (entry.isFile() && predicate(target)) files.push(target);
  });
  visit(directory);
  return files;
}

function buildPlatformNonfunctionalReadiness(options = {}) {
  const root = path.resolve(options.root || path.join(__dirname, "..", "..", ".."));
  const budgets = options.budgets || defaultBudgets;
  if (budgets?.schemaVersion !== "platform-nonfunctional-budgets-v1") throw new TypeError("nonfunctional budget schema is invalid");
  const assets = budgets.frontendAssets.map((budget) => {
    const metrics = fileMetrics(root, budget.file);
    return Object.freeze({
      ...metrics,
      maximumBytes: budget.maximumBytes,
      maximumLines: budget.maximumLines,
      withinBudget: metrics.present && metrics.bytes <= budget.maximumBytes && metrics.lines <= budget.maximumLines
    });
  });
  const server = fileMetrics(root, budgets.runtime.serverFile);
  const serverSource = server.present ? fs.readFileSync(path.join(root, budgets.runtime.serverFile), "utf8") : "";
  const requires = (serverSource.match(/\brequire\(/g) || []).length;
  const compositionModules = budgets.runtime.requiredCompositionModules.map((file) => fileMetrics(root, file));
  const testFiles = listFiles(path.join(root, "test"), (file) => file.endsWith(".test.js")).length;
  const routeFiles = listFiles(path.join(root, "src", "http", "routes"), (file) => file.endsWith(".js")).length;
  const platformHtml = fs.readFileSync(path.join(root, "platform.html"), "utf8");
  const checks = Object.freeze([
    { id: "nonfunctional:frontendBudgets", passed: assets.every((item) => item.withinBudget), detail: `${assets.filter((item) => item.withinBudget).length}/${assets.length}` },
    { id: "nonfunctional:compositionBoundary", passed: compositionModules.every((item) => item.present) && server.lines <= budgets.runtime.maximumServerLines && requires <= budgets.runtime.maximumServerRequires, detail: `${server.lines} lines / ${requires} requires` },
    { id: "nonfunctional:testInventory", passed: testFiles >= budgets.quality.minimumTestFiles, detail: `${testFiles} test files` },
    { id: "nonfunctional:routeInventory", passed: routeFiles >= budgets.quality.minimumRouteFiles, detail: `${routeFiles} route files` },
    { id: "nonfunctional:platformAccessibility", passed: budgets.quality.requiredPlatformMarkers.every((marker) => platformHtml.includes(marker)), detail: `${budgets.quality.requiredPlatformMarkers.length} structural markers` }
  ]);
  return Object.freeze({
    schemaVersion: "platform-nonfunctional-readiness-v1",
    generatedAt: options.now || new Date().toISOString(),
    ok: checks.every((item) => item.passed),
    productionReady: false,
    summary: Object.freeze({ assets: assets.length, assetsWithinBudget: assets.filter((item) => item.withinBudget).length, serverLines: server.lines, serverRequires: requires, testFiles, routeFiles }),
    assets: Object.freeze(assets),
    compositionModules: Object.freeze(compositionModules),
    checks,
    externalGates: Object.freeze(["load-and-capacity-test", "accessibility-user-test", "weak-network-field-test", "backup-restore-rehearsal", "independent-security-test"]),
    boundary: "Static budgets prevent regression but do not prove production performance, accessibility or resilience."
  });
}

module.exports = { buildPlatformNonfunctionalReadiness, fileMetrics };
