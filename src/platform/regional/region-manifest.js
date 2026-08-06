"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

const REGION_SCHEMA_VERSION = "regional-manifest-v1";
const REGISTRY_SCHEMA_VERSION = "regional-registry-v1";
const REGION_CODE_PATTERN = /^(?:template|\d{6})$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const CONFIG_REF_PATTERN = /^config\/[a-z0-9][a-z0-9-]*\.json$/;
const EXTENSION_KINDS = Object.freeze(["adapter", "policy", "dictionary", "ui", "workflow"]);
const SENSITIVE_KEY_PATTERN = /(?:password|passwd|token|secret|credential|private.?key|access.?key|signature)/i;
const MAX_JSON_BYTES = 256 * 1024;
const DEPLOYMENT_CLASSES = Object.freeze(["template", "production", "test"]);
const REGION_FILE_EXTENSIONS = Object.freeze([".json", ".js"]);
const CONTENT_DIGEST_PATTERN = /^sha256:([a-f0-9]{64})$/;

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function assertNoSensitiveKeys(value, location = "config") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSensitiveKeys(item, `${location}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      throw new TypeError(`${location}.${key} is a prohibited sensitive field`);
    }
    assertNoSensitiveKeys(nested, `${location}.${key}`);
  }
}

function readJsonFile(absolutePath, label) {
  const stat = fs.statSync(absolutePath);
  if (!stat.isFile()) throw new TypeError(`${label} must be a file`);
  if (stat.size > MAX_JSON_BYTES) throw new TypeError(`${label} exceeds ${MAX_JSON_BYTES} bytes`);
  const parsed = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  assertNoSensitiveKeys(parsed, label);
  return parsed;
}

function resolveWithin(root, relativePath, label) {
  const absoluteRoot = path.resolve(root);
  const absolutePath = path.resolve(absoluteRoot, relativePath);
  if (absolutePath !== absoluteRoot && !absolutePath.startsWith(`${absoluteRoot}${path.sep}`)) {
    throw new TypeError(`${label} escapes its allowed root`);
  }
  if (fs.existsSync(absolutePath)) {
    const realRoot = fs.realpathSync(absoluteRoot);
    const realPath = fs.realpathSync(absolutePath);
    if (realPath !== realRoot && !realPath.startsWith(`${realRoot}${path.sep}`)) {
      throw new TypeError(`${label} resolves outside its allowed root`);
    }
  }
  return absolutePath;
}

function collectRegionFiles(loadedManifest) {
  const visit = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new TypeError(`regional package cannot contain symbolic links: ${entry.name}`);
    }
    if (entry.isDirectory()) return visit(absolutePath);
    if (!entry.isFile()) throw new TypeError(`regional package contains unsupported entry: ${entry.name}`);
    if (!REGION_FILE_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) {
      throw new TypeError(`regional package contains unsupported file: ${entry.name}`);
    }
    const relativePath = path.relative(loadedManifest.projectRoot, absolutePath).replaceAll("\\", "/");
    const bytes = fs.readFileSync(absolutePath);
    return [{ path: relativePath, size: bytes.length, sha256: sha256(bytes) }];
  });
  return visit(loadedManifest.regionRoot).sort((left, right) => left.path.localeCompare(right.path));
}

function normalizeExpectedContentDigest(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const normalized = String(value).trim();
  const match = normalized.match(CONTENT_DIGEST_PATTERN);
  if (!match) throw new TypeError("REGION_CONTENT_DIGEST must be sha256:<64 lowercase hex>");
  return match[1];
}

function validateRegistry(registry) {
  assertPlainObject(registry, "regional registry");
  if (registry.schemaVersion !== REGISTRY_SCHEMA_VERSION) {
    throw new TypeError(`regional registry schemaVersion must be ${REGISTRY_SCHEMA_VERSION}`);
  }
  if (!REGION_CODE_PATTERN.test(String(registry.defaultRegion || ""))) {
    throw new TypeError("regional registry defaultRegion is invalid");
  }
  if (!Array.isArray(registry.regions) || registry.regions.length === 0) {
    throw new TypeError("regional registry regions must be a non-empty array");
  }
  const codes = registry.regions.map((entry, index) => {
    assertPlainObject(entry, `regional registry regions[${index}]`);
    const code = String(entry.code || "");
    if (!REGION_CODE_PATTERN.test(code)) throw new TypeError(`invalid regional registry code: ${code}`);
    if (typeof entry.enabled !== "boolean") throw new TypeError(`regional registry ${code} enabled must be boolean`);
    if (!DEPLOYMENT_CLASSES.includes(entry.deploymentClass)) {
      throw new TypeError(`regional registry ${code} deploymentClass is invalid`);
    }
    if (entry.deploymentClass === "template" && code !== registry.defaultRegion) {
      throw new TypeError("regional registry template deploymentClass is reserved for defaultRegion");
    }
    return code;
  });
  if (new Set(codes).size !== codes.length) throw new TypeError("regional registry contains duplicate region codes");
  if (!codes.includes(registry.defaultRegion)) throw new TypeError("regional registry defaultRegion is not registered");
  const defaultRegistration = registry.regions.find((entry) => entry.code === registry.defaultRegion);
  if (!defaultRegistration.enabled || defaultRegistration.deploymentClass !== "template") {
    throw new TypeError("regional registry defaultRegion must be an enabled template");
  }
  return registry;
}

function validateManifest(manifest, expectedRegionCode) {
  assertPlainObject(manifest, "regional manifest");
  if (manifest.schemaVersion !== REGION_SCHEMA_VERSION) {
    throw new TypeError(`regional manifest schemaVersion must be ${REGION_SCHEMA_VERSION}`);
  }
  if (!REGION_CODE_PATTERN.test(String(manifest.regionCode || ""))) {
    throw new TypeError("regional manifest regionCode is invalid");
  }
  if (expectedRegionCode && manifest.regionCode !== expectedRegionCode) {
    throw new TypeError(`regional manifest regionCode ${manifest.regionCode} does not match ${expectedRegionCode}`);
  }
  if (!manifest.name || !manifest.locale || !manifest.timezone) {
    throw new TypeError("regional manifest name, locale and timezone are required");
  }
  assertPlainObject(manifest.administrativeDivision, "regional manifest administrativeDivision");
  if (manifest.administrativeDivision.code !== manifest.regionCode) {
    throw new TypeError("administrativeDivision.code must match regionCode");
  }
  if (!VERSION_PATTERN.test(String(manifest.release?.version || ""))) {
    throw new TypeError("regional manifest release.version must be semantic version");
  }
  const compatibility = manifest.release?.platformCompatibility;
  if (!compatibility || !VERSION_PATTERN.test(String(compatibility.minimum || "")) || !VERSION_PATTERN.test(String(compatibility.maximumExclusive || ""))) {
    throw new TypeError("regional manifest platform compatibility range is invalid");
  }
  assertPlainObject(manifest.features, "regional manifest features");
  for (const [feature, enabled] of Object.entries(manifest.features)) {
    if (!/^[a-z][a-z0-9.-]*$/.test(feature) || typeof enabled !== "boolean") {
      throw new TypeError(`regional feature ${feature} must be a boolean feature key`);
    }
  }
  if (!Array.isArray(manifest.configRefs)) throw new TypeError("regional manifest configRefs must be an array");
  if (new Set(manifest.configRefs).size !== manifest.configRefs.length) {
    throw new TypeError("regional manifest configRefs contains duplicates");
  }
  manifest.configRefs.forEach((ref) => {
    if (!CONFIG_REF_PATTERN.test(String(ref))) throw new TypeError(`invalid regional config reference: ${ref}`);
  });
  if (!Array.isArray(manifest.extensions)) throw new TypeError("regional manifest extensions must be an array");
  const extensionIds = new Set();
  manifest.extensions.forEach((extension, index) => {
    assertPlainObject(extension, `regional manifest extensions[${index}]`);
    if (!EXTENSION_KINDS.includes(extension.kind)) throw new TypeError(`unsupported regional extension kind: ${extension.kind}`);
    if (!/^[a-z][a-z0-9-]*$/.test(String(extension.id || ""))) throw new TypeError(`invalid regional extension id: ${extension.id}`);
    if (extensionIds.has(extension.id)) throw new TypeError(`duplicate regional extension id: ${extension.id}`);
    extensionIds.add(extension.id);
    if (!VERSION_PATTERN.test(String(extension.version || ""))) throw new TypeError(`invalid extension version: ${extension.id}`);
    if (!extension.ownedDomain || typeof extension.enabled !== "boolean") {
      throw new TypeError(`regional extension ${extension.id} must declare ownedDomain and enabled`);
    }
    if (!Array.isArray(extension.permissions)
      || new Set(extension.permissions).size !== extension.permissions.length
      || extension.permissions.some((item) => !/^[a-z][a-z0-9:.-]*$/.test(item))) {
      throw new TypeError(`regional extension ${extension.id} permissions must be unique explicit identifiers`);
    }
    if (!Array.isArray(extension.dataCollections)
      || new Set(extension.dataCollections).size !== extension.dataCollections.length
      || extension.dataCollections.some((item) => !/^[a-z][a-z0-9-]*$/.test(item))) {
      throw new TypeError(`regional extension ${extension.id} dataCollections must be unique explicit identifiers`);
    }
  });
  assertNoSensitiveKeys(manifest, "regional manifest");
  return manifest;
}

function loadRegionManifest(options = {}) {
  const projectRoot = path.resolve(options.root || path.resolve(__dirname, "../../.."));
  const registryPath = resolveWithin(projectRoot, options.registryPath || "config/regions.json", "regional registry");
  const registry = validateRegistry(readJsonFile(registryPath, "regional registry"));
  const regionCode = String(options.regionCode || options.env?.REGION_CODE || registry.defaultRegion);
  if (!REGION_CODE_PATTERN.test(regionCode)) throw new TypeError(`invalid REGION_CODE: ${regionCode}`);
  const registration = registry.regions.find((item) => item.code === regionCode);
  if (!registration || !registration.enabled) throw new TypeError(`region ${regionCode} is not enabled in regional registry`);
  const expectedDeploymentClass = options.expectedDeploymentClass || options.env?.REGION_DEPLOYMENT_CLASS;
  if (expectedDeploymentClass && !DEPLOYMENT_CLASSES.includes(expectedDeploymentClass)) {
    throw new TypeError("REGION_DEPLOYMENT_CLASS is invalid");
  }
  if (expectedDeploymentClass && registration.deploymentClass !== expectedDeploymentClass) {
    throw new TypeError(`regional deployment class mismatch for ${regionCode}`);
  }
  if (registration.deploymentClass === "test" && options.env?.NODE_ENV === "production") {
    throw new TypeError(`test region ${regionCode} cannot run in production`);
  }
  const regionsRoot = resolveWithin(projectRoot, "regions", "regions directory");
  const regionRoot = resolveWithin(regionsRoot, regionCode, `region ${regionCode}`);
  const manifestPath = resolveWithin(regionRoot, "manifest.json", `region ${regionCode} manifest`);
  const manifest = validateManifest(readJsonFile(manifestPath, `region ${regionCode} manifest`), regionCode);
  const base = {
    projectRoot,
    regionsRoot,
    regionRoot,
    registry,
    registration,
    manifest,
    digest: sha256(stableJson(manifest))
  };
  const files = collectRegionFiles(base);
  const contentDigest = sha256(stableJson({
    registration,
    files
  }));
  const expectedContentDigest = normalizeExpectedContentDigest(
    options.expectedContentDigest || options.env?.REGION_CONTENT_DIGEST
  );
  if (expectedContentDigest && contentDigest !== expectedContentDigest) {
    throw new TypeError(`regional content digest mismatch for ${regionCode}`);
  }
  return deepFreeze({
    ...base,
    contentDigest,
    files
  });
}

function loadRegionalConfigs(loadedManifest) {
  const entries = loadedManifest.manifest.configRefs.map((relativePath) => {
    const absolutePath = resolveWithin(loadedManifest.regionRoot, relativePath, `regional config ${relativePath}`);
    const key = path.basename(relativePath, ".json");
    return [key, readJsonFile(absolutePath, `regional config ${relativePath}`)];
  });
  return deepFreeze(Object.fromEntries(entries));
}

module.exports = {
  CONTENT_DIGEST_PATTERN,
  CONFIG_REF_PATTERN,
  DEPLOYMENT_CLASSES,
  EXTENSION_KINDS,
  REGION_SCHEMA_VERSION,
  REGION_FILE_EXTENSIONS,
  REGISTRY_SCHEMA_VERSION,
  VERSION_PATTERN,
  assertNoSensitiveKeys,
  collectRegionFiles,
  deepFreeze,
  loadRegionManifest,
  loadRegionalConfigs,
  normalizeExpectedContentDigest,
  resolveWithin,
  sha256,
  stableJson,
  validateManifest,
  validateRegistry
};
