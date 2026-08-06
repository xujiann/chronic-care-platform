"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  collectRegionFiles,
  readJsonFile,
  resolveWithin,
  sha256,
  stableJson,
  validateRegistry
} = require("./region-manifest");
const { loadRegionalRuntime } = require("./regional-runtime");
const { validateRegisteredRegionPackage } = require("./region-scaffold");

const SIX_DIGIT_REGION_PATTERN = /^\d{6}$/;

function lifecycleState(registration) {
  if (registration.deploymentClass === "template") return "template";
  if (registration.deploymentClass === "production") return "production";
  if (registration.deploymentClass === "test" && registration.enabled) return "validation";
  if (registration.deploymentClass === "test") return "draft";
  throw new TypeError(`unsupported regional lifecycle registration: ${registration.code}`);
}

function loadRegistry(root) {
  const registryPath = resolveWithin(root, "config/regions.json", "regional registry");
  const bytes = fs.readFileSync(registryPath);
  return {
    registryPath,
    bytes,
    digest: sha256(bytes),
    registry: validateRegistry(readJsonFile(registryPath, "regional registry"))
  };
}

function inspectRegistration(root, registration) {
  try {
    if (registration.enabled) {
      const runtime = loadRegionalRuntime({ root, regionCode: registration.code });
      return Object.freeze({
        code: registration.code,
        name: registration.name,
        enabled: true,
        deploymentClass: registration.deploymentClass,
        lifecycleState: lifecycleState(registration),
        valid: true,
        contentDigest: runtime.context.contentDigest,
        extensions: runtime.extensions.length,
        productionReady: false
      });
    }
    const validation = validateRegisteredRegionPackage({ root, regionCode: registration.code });
    return Object.freeze({
      code: registration.code,
      name: registration.name,
      enabled: false,
      deploymentClass: registration.deploymentClass,
      lifecycleState: lifecycleState(registration),
      valid: validation.ok,
      contentDigest: validation.contentDigest,
      extensions: validation.extensions,
      productionReady: false
    });
  } catch (error) {
    return Object.freeze({
      code: registration.code,
      name: registration.name,
      enabled: registration.enabled,
      deploymentClass: registration.deploymentClass,
      lifecycleState: lifecycleState(registration),
      valid: false,
      error: String(error?.message || "regional package validation failed"),
      productionReady: false
    });
  }
}

function regionalPortfolio(options = {}) {
  const root = path.resolve(options.root || path.resolve(__dirname, "../../.."));
  const loaded = loadRegistry(root);
  const entries = loaded.registry.regions.map((registration) => inspectRegistration(root, registration));
  return Object.freeze({
    schemaVersion: "regional-portfolio-v1",
    registryDigest: `sha256:${loaded.digest}`,
    ok: entries.every((entry) => entry.valid),
    productionReady: false,
    counts: Object.freeze({
      total: entries.length,
      template: entries.filter((entry) => entry.lifecycleState === "template").length,
      draft: entries.filter((entry) => entry.lifecycleState === "draft").length,
      validation: entries.filter((entry) => entry.lifecycleState === "validation").length,
      production: entries.filter((entry) => entry.lifecycleState === "production").length,
      invalid: entries.filter((entry) => !entry.valid).length
    }),
    entries: Object.freeze(entries)
  });
}

function planTestActivation(options = {}) {
  const root = path.resolve(options.root || path.resolve(__dirname, "../../.."));
  const regionCode = String(options.regionCode || "").trim();
  if (!SIX_DIGIT_REGION_PATTERN.test(regionCode)) {
    throw new TypeError("regional test activation requires a six-digit regionCode");
  }
  const loaded = loadRegistry(root);
  const registration = loaded.registry.regions.find((entry) => entry.code === regionCode);
  if (!registration) throw new TypeError(`region ${regionCode} is not registered`);
  if (registration.deploymentClass !== "test") {
    throw new TypeError(`region ${regionCode} is not a test deployment`);
  }
  if (registration.enabled) throw new TypeError(`test region ${regionCode} is already enabled`);
  const validation = validateRegisteredRegionPackage({ root, regionCode });
  const nextRegistration = Object.freeze({ ...registration, enabled: true });
  const regionRoot = resolveWithin(root, `regions/${regionCode}`, `region ${regionCode}`);
  const files = collectRegionFiles({ projectRoot: root, regionRoot });
  const nextContentDigest = sha256(stableJson({
    registration: nextRegistration,
    files
  }));
  return Object.freeze({
    schemaVersion: "regional-test-activation-plan-v1",
    root,
    regionCode,
    name: registration.name,
    from: "draft",
    to: "validation",
    registryDigest: `sha256:${loaded.digest}`,
    currentContentDigest: validation.contentDigest,
    nextContentDigest,
    validation: Object.freeze({
      package: validation.ok,
      files: validation.files,
      extensions: validation.extensions
    }),
    writes: false,
    productionReady: false
  });
}

function writeRegistryTemp(absolutePath, registry) {
  fs.writeFileSync(absolutePath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
}

function applyTestActivation(plan) {
  if (!plan || plan.schemaVersion !== "regional-test-activation-plan-v1") {
    throw new TypeError("regional test activation requires a valid preview plan");
  }
  if (!SIX_DIGIT_REGION_PATTERN.test(String(plan.regionCode || ""))) {
    throw new TypeError("regional test activation plan regionCode is invalid");
  }
  const root = path.resolve(plan.root);
  const regionsRoot = resolveWithin(root, "regions", "regions directory");
  const lockPath = resolveWithin(regionsRoot, ".region-scaffold.lock", "regional lifecycle lock");
  let lockHandle;
  try {
    lockHandle = fs.openSync(lockPath, "wx");
  } catch (error) {
    if (error?.code === "EEXIST") throw new TypeError("another regional lifecycle operation is in progress");
    throw error;
  }

  let loaded;
  let tempPath;
  let restorePath;
  let registryUpdated = false;
  try {
    loaded = loadRegistry(root);
    tempPath = resolveWithin(
      path.dirname(loaded.registryPath),
      `regions.json.lifecycle-${process.pid}.tmp`,
      "regional lifecycle registry temporary file"
    );
    restorePath = resolveWithin(
      path.dirname(loaded.registryPath),
      `regions.json.lifecycle-${process.pid}.restore`,
      "regional lifecycle registry restore file"
    );
    if (`sha256:${loaded.digest}` !== plan.registryDigest) {
      throw new TypeError("regional registry changed after activation preview");
    }
    const currentPlan = planTestActivation({ root, regionCode: plan.regionCode });
    if (currentPlan.registryDigest !== plan.registryDigest) {
      throw new TypeError("regional registry changed during activation");
    }
    if (currentPlan.nextContentDigest !== plan.nextContentDigest) {
      throw new TypeError("regional package changed after activation preview");
    }
    const nextRegistry = {
      ...loaded.registry,
      regions: loaded.registry.regions.map((entry) => (
        entry.code === plan.regionCode ? { ...entry, enabled: true } : entry
      ))
    };
    validateRegistry(nextRegistry);
    writeRegistryTemp(tempPath, nextRegistry);
    fs.renameSync(tempPath, loaded.registryPath);
    registryUpdated = true;

    const runtime = loadRegionalRuntime({ root, regionCode: plan.regionCode });
    if (runtime.context.deploymentClass !== "test"
      || runtime.context.contentDigest !== plan.nextContentDigest) {
      throw new TypeError("regional test activation post-write verification failed");
    }
    return Object.freeze({
      ...currentPlan,
      writes: true,
      enabled: true,
      activation: Object.freeze({
        REGION_CODE: plan.regionCode,
        REGION_DEPLOYMENT_CLASS: "test",
        REGION_CONTENT_DIGEST: `sha256:${runtime.context.contentDigest}`
      }),
      productionReady: false
    });
  } catch (error) {
    if (tempPath && fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true });
    if (registryUpdated && restorePath && loaded) {
      fs.writeFileSync(restorePath, loaded.bytes);
      fs.renameSync(restorePath, loaded.registryPath);
    }
    throw error;
  } finally {
    if (restorePath && fs.existsSync(restorePath)) fs.rmSync(restorePath, { force: true });
    fs.closeSync(lockHandle);
    if (fs.existsSync(lockPath)) fs.rmSync(lockPath, { force: true });
  }
}

module.exports = {
  SIX_DIGIT_REGION_PATTERN,
  applyTestActivation,
  inspectRegistration,
  lifecycleState,
  loadRegistry,
  planTestActivation,
  regionalPortfolio
};
