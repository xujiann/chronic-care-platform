"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createRegionalExtensionRegistry } = require("./extension-registry");
const { createRegionalValues } = require("./regional-values");
const {
  deepFreeze,
  loadRegionManifest,
  loadRegionalConfigs,
  resolveWithin,
  stableJson
} = require("./region-manifest");

function loadExtensionInstaller(loadedManifest) {
  const extensionsDirectory = resolveWithin(loadedManifest.regionRoot, "extensions", "regional extensions directory");
  const indexPath = resolveWithin(extensionsDirectory, "index.js", "regional extensions index");
  if (!fs.existsSync(indexPath)) throw new TypeError(`regional extensions index is missing for ${loadedManifest.manifest.regionCode}`);
  delete require.cache[require.resolve(indexPath)];
  const installer = require(indexPath);
  if (typeof installer !== "function") throw new TypeError("regional extensions index must export a registration function");
  return installer;
}

function loadRegionalRuntime(options = {}) {
  const loadedManifest = loadRegionManifest(options);
  const configs = loadRegionalConfigs(loadedManifest);
  if (configs["feature-flags"]?.defaults
    && stableJson(configs["feature-flags"].defaults) !== stableJson(loadedManifest.manifest.features)) {
    throw new TypeError(`regional feature defaults do not match manifest for ${loadedManifest.manifest.regionCode}`);
  }
  const registry = createRegionalExtensionRegistry();
  loadExtensionInstaller(loadedManifest)(registry);
  const baseContext = deepFreeze({
    schemaVersion: "regional-runtime-context-v1",
    regionCode: loadedManifest.manifest.regionCode,
    regionName: loadedManifest.manifest.name,
    deploymentClass: loadedManifest.registration.deploymentClass,
    locale: loadedManifest.manifest.locale,
    timezone: loadedManifest.manifest.timezone,
    administrativeDivision: loadedManifest.manifest.administrativeDivision,
    features: loadedManifest.manifest.features,
    configs,
    manifestDigest: loadedManifest.digest,
    productionReady: false
  });
  const extensions = registry.activate(loadedManifest.manifest.extensions, baseContext);
  const byKind = Object.freeze(Object.fromEntries(
    ["adapter", "policy", "dictionary", "ui", "workflow"].map((kind) => [
      kind,
      Object.freeze(extensions.filter((item) => item.kind === kind))
    ])
  ));
  const byDomain = Object.freeze(Object.fromEntries(
    [...new Set(extensions.map((item) => item.ownedDomain))].map((domain) => [
      domain,
      Object.freeze(extensions.filter((item) => item.ownedDomain === domain))
    ])
  ));
  const context = deepFreeze({
    ...baseContext,
    extensions: extensions.map(({ value, ...metadata }) => metadata),
    isFeatureEnabled(feature) {
      return baseContext.features[feature] === true;
    },
    extensionsForKind(kind) {
      return byKind[kind] || Object.freeze([]);
    },
    extensionsForDomain(domain) {
      return byDomain[domain] || Object.freeze([]);
    }
  });
  const values = createRegionalValues(context);
  return Object.freeze({
    kind: "regional-runtime",
    manifest: loadedManifest.manifest,
    registration: loadedManifest.registration,
    context,
    publicContext: values.publicContext,
    values,
    extensions,
    forDomain(domain) {
      return deepFreeze({
        ...context,
        extensions: extensions.filter((item) => item.ownedDomain === domain)
      });
    },
    resolveExtension(id) {
      const extension = extensions.find((item) => item.id === id);
      if (!extension) throw new TypeError(`unknown active regional extension: ${id}`);
      return extension.value;
    }
  });
}

module.exports = {
  loadExtensionInstaller,
  loadRegionalRuntime
};
