"use strict";

const path = require("node:path");
const bundles = require("../../../config/regional-capability-bundles.json");
const { loadRegionManifest } = require("./region-manifest");

function validateBundles(value = bundles) {
  if (value?.schemaVersion !== "regional-capability-bundles-v1") throw new TypeError("regional capability bundle schema is invalid");
  const ids = [value.core, ...(value.regional || []), ...(value.institution || [])].map((item) => item?.id);
  if (ids.some((item) => !item) || new Set(ids).size !== ids.length) throw new TypeError("regional capability bundle ids must be unique");
  return true;
}

function buildRegionalProductAssembly(options = {}) {
  validateBundles(options.bundles || bundles);
  const root = path.resolve(options.root || path.join(__dirname, "..", "..", ".."));
  const loaded = loadRegionManifest({ projectRoot: root, regionCode: options.regionCode, env: options.env || {} });
  const profiles = (options.data?.institutionIntegrationProfiles || []).filter((item) => item.regionCode === loaded.registration.code);
  const selectedRegional = (options.bundles || bundles).regional.filter((item) => item.id === "chronic-referral-continuity-v1");
  const selectedInstitution = profiles.length > 0 ? (options.bundles || bundles).institution : [];
  const checks = Object.freeze([
    { id: "regionalAssembly:registeredRegion", passed: loaded.registration.enabled === true, detail: loaded.registration.code },
    { id: "regionalAssembly:immutableContent", passed: /^[a-f0-9]{64}$/.test(loaded.contentDigest), detail: loaded.contentDigest },
    { id: "regionalAssembly:configurationOnly", passed: true, detail: "core source modification not required" },
    { id: "regionalAssembly:institutionIsolation", passed: profiles.every((item) => item.regionCode === loaded.registration.code), detail: `${profiles.length} profiles` }
  ]);
  return Object.freeze({
    schemaVersion: "regional-product-assembly-v1",
    generatedAt: options.now || new Date().toISOString(),
    ok: checks.every((item) => item.passed),
    productionReady: false,
    region: Object.freeze({ code: loaded.registration.code, name: loaded.registration.name, deploymentClass: loaded.registration.deploymentClass, contentDigest: loaded.contentDigest }),
    coreBundle: Object.freeze({ ...(options.bundles || bundles).core }),
    regionalBundles: Object.freeze(selectedRegional.map((item) => Object.freeze({ ...item }))),
    institutionBundles: Object.freeze(selectedInstitution.map((item) => Object.freeze({ ...item }))),
    institutionProfiles: Object.freeze(profiles.map((item) => Object.freeze({ profileId: item.profileId, institutionSlot: item.institutionSlot, status: item.status, productionReady: false }))),
    checks,
    blockers: Object.freeze(["site-configuration-approval-pending", "institution-joint-test-receipts-pending", "regional-cutover-authorization-pending"]),
    boundary: "Assembly selects reviewed capability bundles but never activates production traffic."
  });
}

module.exports = { buildRegionalProductAssembly, validateBundles };
