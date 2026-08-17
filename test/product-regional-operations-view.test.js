"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { buildProductRegionalOperationsView } = require("../src/platform/regional/product-regional-operations-view");

function fixtures() {
  const regionDescriptors = [
    { regionCode: "210200", deploymentClass: "production", features: [{ id: "regional.integration", enabled: true }, { id: "regional.policy", enabled: true }], configKeys: ["organization", "policies"], extensions: [{ id: "hospital-adapter", kind: "adapter", enabled: true }], host: "must-not-project" },
    { regionCode: "990001", deploymentClass: "test", features: [{ id: "regional.integration", enabled: false }, { id: "regional.policy", enabled: true }], configKeys: ["organization", "dictionaries"], extensions: [{ id: "fixture-policy", kind: "policy", enabled: true }], path: "C:/must-not-project" }
  ];
  const configuration = { ok: true, regions: regionDescriptors.map((item) => ({ regionCode: item.regionCode, technicalReady: true, summary: { configFiles: 8, enabledFeatures: 5, enabledExtensions: 4 }, rawConfiguration: "must-not-project" })) };
  const replication = { ok: true, technicalReady: true, sites: regionDescriptors.map((item) => ({ regionCode: item.regionCode, siteId: `site-${item.regionCode}`, stage: item.deploymentClass === "production" ? "production" : "validation", hostId: "must-not-project" })) };
  const monitoring = { ok: true, status: "adapter-foundation-ready", summary: { routes: 5, controls: 6, blockers: 2 }, checks: [{ id: "monitoring:routes", passed: true, detail: "must-not-project" }], rawAlertPayload: "must-not-project" };
  const nonfunctional = { ok: true, summary: { assets: 6, assetsWithinBudget: 6, testFiles: 500, routeFiles: 63 }, checks: [{ id: "nonfunctional:frontend", passed: true, path: "must-not-project" }] };
  return { regionDescriptors, configuration, replication, monitoring, nonfunctional };
}

test("regional operations view unifies capabilities configuration deployment replication and acceptance", () => {
  const report = buildProductRegionalOperationsView({ ...fixtures(), now: "2026-08-17T08:00:00.000Z", acceptance: { "210200": { state: "accepted", verified: true, receipt: "must-not-project" } } });
  assert.equal(report.ok, true);
  assert.equal(report.regions.length, 2);
  assert.equal(report.regions[0].capabilities.length, 2);
  assert.equal(report.regions[0].acceptance.state, "accepted");
  assert.equal(report.regions[0].acceptance.productionReady, false);
  assert.equal(report.regions[1].acceptance.state, "pending");
  assert.equal(report.configurationDiffs.length, 1);
  assert.deepEqual(report.configurationDiffs[0].featureKeys, ["regional.integration"]);
  assert.deepEqual(report.configurationDiffs[0].configKeys, ["dictionaries", "policies"]);
  assert.equal(report.productionReady, false);
  assert.equal(report.containsBusinessPayload, false);
  assert.equal(report.containsCredentials, false);
  assert.doesNotMatch(JSON.stringify(report), /must-not-project|rawAlertPayload|hostId|rawConfiguration|C:\//);
});

test("regional operations view fails closed when monitoring replication or configuration is absent", () => {
  const base = fixtures();
  const report = buildProductRegionalOperationsView({ regionDescriptors: base.regionDescriptors, configuration: { ok: false, regions: [] }, now: "2026-08-17T08:00:00.000Z" });
  assert.equal(report.ok, false);
  assert.equal(report.localControlReady, false);
  assert.equal(report.siteReady, false);
  assert.equal(report.productionReady, false);
  assert.equal(report.summary.replicationReady, 0);
  assert.equal(report.alerts.ok, false);
});

test("regional operations view rejects unsafe identifiers and never infers production readiness", () => {
  const base = fixtures();
  base.regionDescriptors.push({ regionCode: "C:/host", deploymentClass: "production", features: [{ id: "patient payload", enabled: true }] });
  const report = buildProductRegionalOperationsView({ ...base, acceptance: { "990001": { state: "accepted", verified: true } } });
  assert.equal(report.regions.length, 2);
  assert.equal(report.regions.every((region) => region.productionReady === false), true);
  assert.equal(report.productionReady, false);
});
