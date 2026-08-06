"use strict";

const REQUIRED_CONFIGS = Object.freeze([
  "feature-flags",
  "geography",
  "localization",
  "organization"
]);

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string`);
  }
}

function assertStringMap(value, label, options = {}) {
  assertObject(value, label);
  if (options.nonEmpty !== false && Object.keys(value).length === 0) {
    throw new TypeError(`${label} must not be empty`);
  }
  for (const [key, item] of Object.entries(value)) {
    assertNonEmptyString(key, `${label} key`);
    if (typeof item !== "string" || (options.allowEmpty !== true && item.trim() === "")) {
      throw new TypeError(`${label}.${key} must be a non-empty string`);
    }
  }
}

function validateDirectory(value, label, requiredFields) {
  assertObject(value, label);
  if (Object.keys(value).length === 0) throw new TypeError(`${label} must not be empty`);
  const codes = new Set();
  for (const [id, entry] of Object.entries(value)) {
    if (!/^[a-z][A-Za-z0-9]*$/.test(id)) throw new TypeError(`${label} id is invalid: ${id}`);
    assertObject(entry, `${label}.${id}`);
    requiredFields.forEach((field) => assertNonEmptyString(entry[field], `${label}.${id}.${field}`));
    if (codes.has(entry.code)) throw new TypeError(`${label} contains duplicate code: ${entry.code}`);
    codes.add(entry.code);
  }
}

function validateFeatureFlags(config, manifest) {
  assertObject(config.defaults, "regional config feature-flags.defaults");
  const featureEntries = Object.entries(config.defaults);
  if (featureEntries.length === 0) throw new TypeError("regional config feature-flags.defaults must not be empty");
  featureEntries.forEach(([key, enabled]) => {
    if (!/^[a-z][a-z0-9.-]*$/.test(key) || typeof enabled !== "boolean") {
      throw new TypeError(`regional config feature-flags.defaults.${key} must be boolean`);
    }
  });
  if (config.productionOverrides !== undefined) {
    assertObject(config.productionOverrides, "regional config feature-flags.productionOverrides");
    Object.entries(config.productionOverrides).forEach(([key, enabled]) => {
      if (!Object.prototype.hasOwnProperty.call(config.defaults, key) || typeof enabled !== "boolean") {
        throw new TypeError(`regional config feature-flags.productionOverrides.${key} must override a declared boolean`);
      }
    });
  }
  const expected = JSON.stringify(Object.entries(manifest.features).sort());
  const actual = JSON.stringify(featureEntries.sort());
  if (actual !== expected) {
    throw new TypeError(`regional feature defaults do not match manifest for ${manifest.regionCode}`);
  }
}

function validateRegionalConfigs(configs, manifest) {
  assertObject(configs, "regional configs");
  REQUIRED_CONFIGS.forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(configs, key)) {
      throw new TypeError(`regional config ${key} is required`);
    }
  });
  for (const [key, config] of Object.entries(configs)) {
    assertObject(config, `regional config ${key}`);
    const expectedSchema = `regional-${key}-v1`;
    if (config.schemaVersion !== expectedSchema) {
      throw new TypeError(`regional config ${key} schemaVersion must be ${expectedSchema}`);
    }
  }
  validateFeatureFlags(configs["feature-flags"], manifest);
  validateDirectory(
    configs.organization.organizations,
    "regional config organization.organizations",
    ["code", "name", "shortName", "type"]
  );
  if (configs.organization.administrativeCode !== undefined
    && configs.organization.administrativeCode !== manifest.regionCode) {
    throw new TypeError("regional config organization.administrativeCode must match regionCode");
  }
  validateDirectory(
    configs.geography.areas,
    "regional config geography.areas",
    ["code", "name", "shortName"]
  );
  assertStringMap(configs.localization.terms, "regional config localization.terms");
  assertStringMap(
    configs.localization.legacyReplacements,
    "regional config localization.legacyReplacements",
    { nonEmpty: false }
  );
  return configs;
}

module.exports = {
  REQUIRED_CONFIGS,
  validateRegionalConfigs
};
