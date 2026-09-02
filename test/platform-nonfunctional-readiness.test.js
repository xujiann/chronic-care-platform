"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const budgets = require("../config/platform-nonfunctional-budgets.json");
const { buildPlatformNonfunctionalReadiness } = require("../src/platform/governance/platform-nonfunctional-readiness");

const ROOT = path.resolve(__dirname, "..");

test("platform nonfunctional gate locks current frontend and composition budgets", () => {
  const report = buildPlatformNonfunctionalReadiness({ root: ROOT, now: "2026-08-16T05:00:00.000Z" });
  assert.equal(report.ok, true);
  assert.equal(report.summary.assetsWithinBudget, report.summary.assets);
  assert.equal(report.summary.serverRequires, 130);
  assert.ok(report.summary.testFiles >= 353);
  assert.ok(report.summary.routeFiles >= 43);
  assert.equal(report.productionReady, false);
  assert.ok(report.externalGates.includes("load-and-capacity-test"));
  const procurementAsset = report.assets.find((item) => item.file === "platform-procurement-governance-ui.js");
  assert.equal(procurementAsset?.withinBudget, true);
  assert.equal(budgets.frontendAssets.find((item) => item.file === "platform-productization-ui.js")?.maximumBytes, 30000);
  assert.equal(budgets.frontendAssets.find((item) => item.file === "platform-procurement-governance-ui.js")?.maximumBytes, 30000);
});

test("platform nonfunctional gate rejects asset growth beyond its budget", () => {
  const strict = structuredClone(budgets);
  strict.frontendAssets[0].maximumBytes = 1;
  const report = buildPlatformNonfunctionalReadiness({ root: ROOT, budgets: strict });
  assert.equal(report.ok, false);
  assert.equal(report.checks.find((item) => item.id === "nonfunctional:frontendBudgets").passed, false);
});
