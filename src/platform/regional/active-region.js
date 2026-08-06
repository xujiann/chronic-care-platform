"use strict";

const path = require("node:path");
const { loadRegionalRuntime } = require("./regional-runtime");

const PROJECT_ROOT = path.resolve(__dirname, "../../..");
let cachedRuntime = null;
let cachedSelection = null;

function activeRegionCode(env = process.env) {
  return String(env.REGION_CODE || "");
}

function getActiveRegionalRuntime(options = {}) {
  const env = options.env || process.env;
  const regionCode = options.regionCode || activeRegionCode(env);
  const root = path.resolve(options.root || PROJECT_ROOT);
  const expectedDeploymentClass = options.expectedDeploymentClass || env.REGION_DEPLOYMENT_CLASS || "";
  const expectedContentDigest = options.expectedContentDigest || env.REGION_CONTENT_DIGEST || "";
  const selection = JSON.stringify({
    root,
    regionCode: regionCode || "<registry-default>",
    nodeEnv: env.NODE_ENV || "",
    expectedDeploymentClass,
    expectedContentDigest
  });
  if (!cachedRuntime || cachedSelection !== selection || options.reload) {
    cachedRuntime = loadRegionalRuntime({
      root,
      env,
      ...(expectedDeploymentClass ? { expectedDeploymentClass } : {}),
      ...(expectedContentDigest ? { expectedContentDigest } : {}),
      ...(regionCode ? { regionCode } : {})
    });
    cachedSelection = selection;
  }
  return cachedRuntime;
}

function getActiveRegionalValues(options = {}) {
  return getActiveRegionalRuntime(options).values;
}

function regionalOrganization(id, options = {}) {
  return getActiveRegionalValues(options).organization(id);
}

function localizeRegionalData(value, options = {}) {
  return getActiveRegionalValues(options).localize(value);
}

function resetActiveRegionalRuntime() {
  cachedRuntime = null;
  cachedSelection = null;
}

module.exports = {
  getActiveRegionalRuntime,
  getActiveRegionalValues,
  localizeRegionalData,
  regionalOrganization,
  resetActiveRegionalRuntime
};
