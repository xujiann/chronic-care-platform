"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { buildRegionalProductAssembly } = require("../src/platform/regional/regional-product-assembly");

const ROOT = path.resolve(__dirname, "..");

test("regional product assembly selects reviewed bundles without modifying core source", () => {
  const report = buildRegionalProductAssembly({ root: ROOT, regionCode: "210200", data: {}, now: "2026-08-17T04:00:00.000Z" });
  assert.equal(report.ok, true);
  assert.equal(report.coreBundle.id, "health-platform-core-v1");
  assert.equal(report.regionalBundles.length, 1);
  assert.equal(report.institutionBundles.length, 0);
  assert.equal(report.productionReady, false);
});

test("regional product assembly includes institution bundle only for a region-bound profile", () => {
  const report = buildRegionalProductAssembly({
    root: ROOT,
    regionCode: "210200",
    data: { institutionIntegrationProfiles: [{ profileId: "iip-210200-pilot", regionCode: "210200", institutionSlot: "pilot", status: "synthetic-complete" }] }
  });
  assert.equal(report.institutionBundles.length, 1);
  assert.equal(report.institutionProfiles.length, 1);
  assert.equal(report.institutionProfiles[0].productionReady, false);
});
