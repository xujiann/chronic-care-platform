"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const {
  assessRegionConfiguration,
  buildRegionConfigurationReadiness,
  buildRegionalConfigurationPortfolio
} = require("../src/platform/regional/regional-configuration-readiness");
const {
  loadRegionManifest,
  loadRegionalConfigs
} = require("../src/platform/regional/region-manifest");
const {
  buildReport,
  parseArgs,
  renderMarkdown
} = require("../scripts/regional-configuration-readiness");

const ROOT = path.resolve(__dirname, "..");
const GENERATED_AT = "2026-08-07T00:00:00.000Z";

test("production region configuration is structurally complete but never self-authorizes", () => {
  const report = buildRegionConfigurationReadiness({
    root: ROOT,
    regionCode: "210200",
    expectedDeploymentClass: "production",
    generatedAt: GENERATED_AT
  });
  assert.equal(report.technicalReady, true);
  assert.equal(report.candidateEligible, true);
  assert.equal(report.productionReady, false);
  assert.equal(report.containsConfigurationValues, false);
  assert.equal(report.summary.configFiles, 10);
  assert.equal(report.summary.enabledFeatures, 5);
  assert.equal(report.summary.enabledExtensions, 5);
  assert.equal(report.capabilityCoverage.every((item) => item.passed), true);
  assert.equal(report.checks.every((item) => item.passed), true);
  assert.match(report.digests.configurationSurface, /^sha256:[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(report).includes("authorityName"), false);
});

test("test region remains structurally usable and categorically ineligible for production", () => {
  const report = buildRegionConfigurationReadiness({
    root: ROOT,
    regionCode: "990001",
    expectedDeploymentClass: "test",
    generatedAt: GENERATED_AT
  });
  assert.equal(report.technicalReady, true);
  assert.equal(report.candidateEligible, false);
  assert.equal(report.productionReady, false);
  assert.equal(report.summary.configFiles, 4);
  assert.equal(report.summary.enabledFeatures, 0);
  assert.equal(report.summary.enabledExtensions, 0);
  assert.ok(report.externalBlockers.some((item) => /never production eligible/.test(item)));
});

test("capability configuration or extension drift fails closed with stable checks", () => {
  const loaded = loadRegionManifest({ root: ROOT, regionCode: "210200" });
  const configs = structuredClone(loadRegionalConfigs(loaded));
  delete configs["ui-theme"];
  const missingConfig = assessRegionConfiguration(loaded, configs, { generatedAt: GENERATED_AT });
  assert.equal(missingConfig.technicalReady, false);
  assert.equal(
    missingConfig.checks.find((item) => item.id === "regionalConfig:declaredFiles").passed,
    false
  );
  assert.equal(
    missingConfig.checks.find((item) => item.id === "regionalConfig:capabilityCoverage").passed,
    false
  );

  const driftedLoaded = structuredClone(loaded);
  driftedLoaded.manifest.extensions = driftedLoaded.manifest.extensions.filter((item) => item.kind !== "adapter");
  const missingExtension = assessRegionConfiguration(driftedLoaded, loadRegionalConfigs(loaded), {
    generatedAt: GENERATED_AT
  });
  assert.equal(missingExtension.technicalReady, false);
  assert.equal(
    missingExtension.capabilityCoverage.find((item) => item.feature === "regional.integration").passed,
    false
  );
});

test("portfolio and CLI projection cover every enabled non-template region without values", () => {
  const portfolio = buildRegionalConfigurationPortfolio({
    root: ROOT,
    generatedAt: GENERATED_AT
  });
  assert.equal(portfolio.ok, true);
  assert.equal(portfolio.productionReady, false);
  assert.deepEqual(portfolio.summary, {
    regions: 2,
    technicalReady: 2,
    productionCandidates: 1,
    testFixtures: 1
  });
  const single = buildReport({
    root: ROOT,
    regionCode: "210200",
    generatedAt: GENERATED_AT
  });
  assert.equal(single.ok, true);
  assert.equal(single.summary.regions, 1);
  assert.match(renderMarkdown(portfolio), /地区配置准入审计报告/);
  assert.deepEqual(parseArgs(["--region=210200", "--output=release/custom.json"]), {
    region: "210200",
    output: "release/custom.json"
  });
});
