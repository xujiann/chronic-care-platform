"use strict";

const path = require("node:path");
const defaultProgram = require("../../../config/product-regional-enhancement-program.json");
const { loadRegionManifest, loadRegionalConfigs } = require("./region-manifest");
const { buildRegionalConfigurationPortfolio } = require("./regional-configuration-readiness");

const ACCEPTANCE_STATES = new Set(["pending", "reviewing", "accepted", "rejected", "expired"]);
const DEPLOYMENT_STAGES = new Set(["development", "validation", "staging", "production"]);
const DEPLOYMENT_CLASSES = new Set(["production", "test", "template"]);
const MONITORING_STATES = new Set(["blocked", "adapter-foundation-ready", "adapter-foundation-ready-site-acceptance-pending"]);

function integer(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function identifier(value, maximum = 96) {
  const text = String(value || "").trim();
  return /^[A-Za-z0-9._:-]+$/.test(text) ? text.slice(0, maximum) : "redacted";
}

function regionCode(value) {
  const text = String(value || "").trim();
  return /^\d{6}$/.test(text) ? text : "redacted";
}

function validateProgram(program = defaultProgram) {
  if (program?.schemaVersion !== "product-regional-enhancement-program-v1") throw new TypeError("product regional enhancement program is invalid");
  const requiredSections = ["capabilities", "configuration", "deployment", "replication", "acceptance", "nonfunctional", "alerts"];
  if (!Array.isArray(program.regional?.requiredSections) || program.regional.requiredSections.length !== 7 || requiredSections.some((section) => !program.regional.requiredSections.includes(section)) || new Set(program.regional.requiredSections).size !== 7) throw new TypeError("regional operations view requires seven unique sections");
  if (!Array.isArray(program.regional.allowedAcceptanceStates) || ACCEPTANCE_STATES.size !== program.regional.allowedAcceptanceStates.length || program.regional.allowedAcceptanceStates.some((state) => !ACCEPTANCE_STATES.has(state))) throw new TypeError("regional acceptance states are invalid");
  if (!Number.isInteger(program.regional.minimumRegions) || program.regional.minimumRegions < 1) throw new TypeError("regional minimumRegions must be positive");
  if (!Number.isInteger(program.regional.maximumVisibleRegions) || program.regional.maximumVisibleRegions < 1 || program.regional.maximumVisibleRegions > 50) throw new TypeError("regional maximumVisibleRegions is invalid");
  return true;
}

function loadRegionDescriptors(options = {}) {
  if (Array.isArray(options.regionDescriptors)) return options.regionDescriptors;
  const root = path.resolve(options.root || path.join(__dirname, "..", "..", ".."));
  const registry = loadRegionManifest({ root }).registry;
  return registry.regions
    .filter((entry) => entry.enabled && entry.code !== registry.defaultRegion)
    .map((entry) => {
      const loaded = loadRegionManifest({ root, regionCode: entry.code, expectedDeploymentClass: entry.deploymentClass });
      const configs = loadRegionalConfigs(loaded);
      return Object.freeze({
        regionCode: entry.code,
        deploymentClass: entry.deploymentClass,
        features: Object.entries(loaded.manifest.features).map(([id, enabled]) => ({ id, enabled })),
        configKeys: Object.keys(configs),
        extensions: loaded.manifest.extensions.map((extension) => ({ id: extension.id, kind: extension.kind, enabled: extension.enabled }))
      });
    });
}

function descriptorProjection(descriptor) {
  const features = (Array.isArray(descriptor?.features) ? descriptor.features : [])
    .map((feature) => ({ id: identifier(feature?.id), enabled: feature?.enabled === true }))
    .filter((feature) => feature.id !== "redacted")
    .sort((left, right) => left.id.localeCompare(right.id));
  const configKeys = [...new Set((Array.isArray(descriptor?.configKeys) ? descriptor.configKeys : [])
    .map((key) => identifier(key))
    .filter((key) => key !== "redacted"))].sort();
  const extensions = (Array.isArray(descriptor?.extensions) ? descriptor.extensions : [])
    .map((extension) => ({ id: identifier(extension?.id), kind: identifier(extension?.kind), enabled: extension?.enabled === true }))
    .filter((extension) => extension.id !== "redacted" && extension.kind !== "redacted")
    .sort((left, right) => left.id.localeCompare(right.id));
  return Object.freeze({
    regionCode: regionCode(descriptor?.regionCode),
    deploymentClass: DEPLOYMENT_CLASSES.has(descriptor?.deploymentClass) ? descriptor.deploymentClass : "test",
    features: Object.freeze(features.map(Object.freeze)),
    configKeys: Object.freeze(configKeys),
    extensions: Object.freeze(extensions.map(Object.freeze))
  });
}

function symmetricDifferences(left, right, valueOf) {
  const leftMap = new Map(left.map((item) => [typeof item === "string" ? item : item.id, valueOf(item)]));
  const rightMap = new Map(right.map((item) => [typeof item === "string" ? item : item.id, valueOf(item)]));
  return [...new Set([...leftMap.keys(), ...rightMap.keys()])]
    .filter((key) => leftMap.get(key) !== rightMap.get(key))
    .sort();
}

function buildConfigurationDiffs(descriptors) {
  if (descriptors.length < 2) return Object.freeze([]);
  const baseline = descriptors.find((item) => item.deploymentClass === "production") || descriptors[0];
  return Object.freeze(descriptors.filter((item) => item.regionCode !== baseline.regionCode).map((target) => Object.freeze({
    baselineRegionCode: baseline.regionCode,
    targetRegionCode: target.regionCode,
    featureKeys: Object.freeze(symmetricDifferences(baseline.features, target.features, (item) => item.enabled)),
    configKeys: Object.freeze(symmetricDifferences(baseline.configKeys, target.configKeys, () => true)),
    extensionIds: Object.freeze(symmetricDifferences(baseline.extensions, target.extensions, (item) => `${item.kind}:${item.enabled}`)),
    containsConfigurationValues: false
  })));
}

function safeChecks(items) {
  return Object.freeze((Array.isArray(items) ? items : []).map((item) => Object.freeze({ id: identifier(item?.id), passed: item?.passed === true })));
}

function buildProductRegionalOperationsView(options = {}) {
  const program = options.program || defaultProgram;
  validateProgram(program);
  const descriptors = [...new Map(loadRegionDescriptors(options).map(descriptorProjection)
    .filter((descriptor) => descriptor.regionCode !== "redacted")
    .map((descriptor) => [descriptor.regionCode, descriptor])).values()]
    .slice(0, program.regional.maximumVisibleRegions);
  const configuration = options.configuration || buildRegionalConfigurationPortfolio({ root: options.root, generatedAt: options.now });
  const replication = options.replication || { ok: false, technicalReady: false, sites: [] };
  const monitoring = options.monitoring || { ok: false, checks: [], summary: {} };
  const nonfunctional = options.nonfunctional || { ok: false, checks: [], summary: {} };
  const configurationByRegion = new Map((Array.isArray(configuration.regions) ? configuration.regions : []).map((report) => [String(report.regionCode), report]));
  const replicationByRegion = new Map((Array.isArray(replication.sites) ? replication.sites : []).map((site) => [String(site.regionCode), site]));
  const acceptance = options.acceptance || {};
  const regions = descriptors.map((descriptor) => {
    const configurationReport = configurationByRegion.get(descriptor.regionCode) || {};
    const replicationSite = replicationByRegion.get(descriptor.regionCode) || {};
    const rawAcceptance = acceptance[descriptor.regionCode] || {};
    const acceptanceState = ACCEPTANCE_STATES.has(rawAcceptance.state) ? rawAcceptance.state : "pending";
    const accepted = acceptanceState === "accepted" && rawAcceptance.verified === true;
    const stage = DEPLOYMENT_STAGES.has(replicationSite.stage) ? replicationSite.stage : "development";
    const capabilities = descriptor.features.map((feature) => Object.freeze({
      id: feature.id,
      enabled: feature.enabled,
      state: feature.enabled ? "enabled" : "disabled"
    }));
    return Object.freeze({
      regionCode: descriptor.regionCode,
      deploymentClass: descriptor.deploymentClass,
      capabilities: Object.freeze(capabilities),
      configuration: Object.freeze({
        technicalReady: configurationReport.technicalReady === true,
        configFiles: integer(configurationReport.summary?.configFiles),
        enabledFeatures: integer(configurationReport.summary?.enabledFeatures),
        enabledExtensions: integer(configurationReport.summary?.enabledExtensions),
        containsConfigurationValues: false
      }),
      deployment: Object.freeze({
        stage,
        status: replicationSite.siteId ? "registered" : "not-registered"
      }),
      replication: Object.freeze({
        technicalReady: replication.technicalReady === true && Boolean(replicationSite.siteId),
        status: replication.technicalReady === true && replicationSite.siteId ? "validated" : "blocked"
      }),
      acceptance: Object.freeze({ state: acceptanceState, verified: accepted, productionReady: false }),
      productionReady: false
    });
  });
  const configurationDiffs = buildConfigurationDiffs(descriptors);
  const checks = Object.freeze([
    Object.freeze({ id: "productRegional:regionInventory", passed: regions.length >= program.regional.minimumRegions }),
    Object.freeze({ id: "productRegional:capabilityInventory", passed: regions.every((item) => item.capabilities.length > 0) }),
    Object.freeze({ id: "productRegional:configuration", passed: configuration.ok === true && regions.every((item) => item.configuration.technicalReady) }),
    Object.freeze({ id: "productRegional:configurationDiff", passed: configurationDiffs.length >= Math.max(0, regions.length - 1) }),
    Object.freeze({ id: "productRegional:replication", passed: replication.technicalReady === true && regions.every((item) => item.replication.technicalReady) }),
    Object.freeze({ id: "productRegional:nonfunctional", passed: nonfunctional.ok === true }),
    Object.freeze({ id: "productRegional:alerts", passed: monitoring.ok === true }),
    Object.freeze({ id: "productRegional:productionFailClosed", passed: regions.every((item) => item.productionReady === false && item.acceptance.productionReady === false) })
  ]);
  return Object.freeze({
    schemaVersion: "product-regional-operations-view-v1",
    generatedAt: String(options.now || new Date().toISOString()).slice(0, 40),
    ok: checks.every((check) => check.passed),
    localControlReady: checks.every((check) => check.passed),
    siteReady: false,
    productionReady: false,
    containsBusinessPayload: false,
    containsCredentials: false,
    summary: Object.freeze({
      regions: regions.length,
      configurationReady: regions.filter((item) => item.configuration.technicalReady).length,
      replicationReady: regions.filter((item) => item.replication.technicalReady).length,
      accepted: regions.filter((item) => item.acceptance.verified).length,
      capabilities: regions.reduce((total, item) => total + item.capabilities.filter((capability) => capability.enabled).length, 0),
      configurationDiffs: configurationDiffs.length,
      nonfunctionalAssetsWithinBudget: integer(nonfunctional.summary?.assetsWithinBudget),
      alertControls: integer(monitoring.summary?.controls),
      alertBlockers: integer(monitoring.summary?.blockers)
    }),
    regions: Object.freeze(regions),
    configurationDiffs,
    nonfunctional: Object.freeze({ ok: nonfunctional.ok === true, productionReady: false, summary: Object.freeze({ assets: integer(nonfunctional.summary?.assets), assetsWithinBudget: integer(nonfunctional.summary?.assetsWithinBudget), testFiles: integer(nonfunctional.summary?.testFiles), routeFiles: integer(nonfunctional.summary?.routeFiles) }), checks: safeChecks(nonfunctional.checks) }),
    alerts: Object.freeze({ ok: monitoring.ok === true, productionReady: false, status: MONITORING_STATES.has(monitoring.status) ? monitoring.status : "blocked", summary: Object.freeze({ routes: integer(monitoring.summary?.routes), controls: integer(monitoring.summary?.controls), blockers: integer(monitoring.summary?.blockers) }), checks: safeChecks(monitoring.checks) }),
    checks,
    blockers: Object.freeze(program.externalBlockers.map((item) => identifier(item, 120))),
    boundary: "地区运行视图只公开能力、差异键和门禁摘要；配置值、探测目标、基础设施及生产授权均不公开。"
  });
}

module.exports = {
  buildConfigurationDiffs,
  buildProductRegionalOperationsView,
  descriptorProjection,
  loadRegionDescriptors,
  validateProgram
};
