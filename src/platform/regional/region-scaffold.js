"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createRegionalExtensionRegistry } = require("./extension-registry");
const {
  REGION_FILE_EXTENSIONS,
  collectRegionFiles,
  loadRegionalConfigs,
  readJsonFile,
  resolveWithin,
  sha256,
  stableJson,
  validateManifest,
  validateRegistry
} = require("./region-manifest");
const { validateRegionalConfigs } = require("./regional-config-contract");
const { loadExtensionInstaller } = require("./regional-runtime");

const REGION_LEVELS = Object.freeze(["province", "prefecture-city", "county", "city"]);
const NEW_REGION_PATTERN = /^\d{6}$/;

function writeJson(absolutePath, value) {
  fs.writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function listTemplateFiles(templateRoot, directory = templateRoot) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new TypeError(`regional template cannot contain symbolic links: ${entry.name}`);
    if (entry.isDirectory()) return listTemplateFiles(templateRoot, absolutePath);
    if (!entry.isFile()) throw new TypeError(`regional template contains unsupported entry: ${entry.name}`);
    if (!REGION_FILE_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) {
      throw new TypeError(`regional template contains unsupported file: ${entry.name}`);
    }
    return [path.relative(templateRoot, absolutePath).replaceAll("\\", "/")];
  });
}

function copyTemplateDirectory(source, target) {
  fs.mkdirSync(target);
  fs.readdirSync(source, { withFileTypes: true }).forEach((entry) => {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isSymbolicLink()) throw new TypeError(`regional template cannot contain symbolic links: ${entry.name}`);
    if (entry.isDirectory()) {
      copyTemplateDirectory(sourcePath, targetPath);
      return;
    }
    if (!entry.isFile()) throw new TypeError(`regional template contains unsupported entry: ${entry.name}`);
    if (!REGION_FILE_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) {
      throw new TypeError(`regional template contains unsupported file: ${entry.name}`);
    }
    fs.copyFileSync(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
  });
}

function normalizeScaffoldInput(options = {}) {
  const regionCode = String(options.regionCode || "").trim();
  const name = typeof options.name === "string" ? options.name.trim() : "";
  const level = String(options.level || "prefecture-city").trim();
  const parentCode = options.parentCode === undefined || options.parentCode === null || options.parentCode === ""
    ? null
    : String(options.parentCode).trim();
  if (!NEW_REGION_PATTERN.test(regionCode)) {
    throw new TypeError("regional scaffold regionCode must be a six-digit code");
  }
  if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new TypeError("regional scaffold name must be 1-80 printable characters");
  }
  if (!REGION_LEVELS.includes(level)) throw new TypeError(`regional scaffold level is invalid: ${level}`);
  if (parentCode !== null && !NEW_REGION_PATTERN.test(parentCode)) {
    throw new TypeError("regional scaffold parentCode must be a six-digit code or empty");
  }
  if (parentCode === regionCode) throw new TypeError("regional scaffold parentCode cannot equal regionCode");
  return Object.freeze({ regionCode, name, level, parentCode });
}

function scaffoldRegistryEntry(input) {
  return Object.freeze({
    code: input.regionCode,
    name: input.name,
    enabled: false,
    deploymentClass: "test",
    purpose: "新地区配置建设中；完成配置、评审和地区矩阵验证后方可启用"
  });
}

function buildRegionScaffoldPlan(options = {}) {
  const root = path.resolve(options.root || path.resolve(__dirname, "../../.."));
  const input = normalizeScaffoldInput(options);
  const registryPath = resolveWithin(root, "config/regions.json", "regional registry");
  const regionsRoot = resolveWithin(root, "regions", "regions directory");
  const templateRoot = resolveWithin(regionsRoot, "template", "regional template");
  const targetRoot = resolveWithin(regionsRoot, input.regionCode, `region ${input.regionCode}`);
  const registry = validateRegistry(readJsonFile(registryPath, "regional registry"));
  if (registry.regions.some((item) => item.code === input.regionCode)) {
    throw new TypeError(`region ${input.regionCode} is already registered`);
  }
  if (fs.existsSync(targetRoot)) throw new TypeError(`region directory already exists: ${input.regionCode}`);
  if (!fs.statSync(templateRoot).isDirectory()) throw new TypeError("regional template must be a directory");
  const templateFiles = listTemplateFiles(templateRoot).sort();
  return Object.freeze({
    schemaVersion: "regional-scaffold-plan-v1",
    root,
    input,
    registryEntry: scaffoldRegistryEntry(input),
    target: path.relative(root, targetRoot).replaceAll("\\", "/"),
    files: templateFiles.map((file) => `${path.relative(root, targetRoot).replaceAll("\\", "/")}/${file}`),
    mode: "preview",
    writes: false
  });
}

function customizeStage(stageRoot, input) {
  const manifestPath = path.join(stageRoot, "manifest.json");
  const manifest = readJsonFile(manifestPath, "regional scaffold manifest");
  manifest.regionCode = input.regionCode;
  manifest.name = input.name;
  manifest.administrativeDivision = {
    code: input.regionCode,
    level: input.level,
    parentCode: input.parentCode
  };
  writeJson(manifestPath, manifest);

  const organizationPath = path.join(stageRoot, "config", "organization.json");
  const organization = readJsonFile(organizationPath, "regional scaffold organization");
  organization.authorityName = `${input.name}卫生健康主管部门`;
  organization.platformDisplayName = `${input.name}卫生健康信息平台`;
  organization.serviceArea = input.name;
  organization.administrativeCode = input.regionCode;
  writeJson(organizationPath, organization);

  const localizationPath = path.join(stageRoot, "config", "localization.json");
  const localization = readJsonFile(localizationPath, "regional scaffold localization");
  localization.terms.platformName = `${input.name}卫生健康信息平台`;
  localization.terms.platformShortName = `${input.name}卫健平台`;
  localization.terms.citizenPortalName = `${input.name}居民健康服务`;
  localization.terms.regionLabel = input.name;
  localization.legacyReplacements["区域卫生健康信息平台"] = `${input.name}卫生健康信息平台`;
  localization.legacyReplacements["区域居民健康服务"] = `${input.name}居民健康服务`;
  writeJson(localizationPath, localization);
  return manifest;
}

function validateStage(root, stageRoot, input) {
  const manifest = validateManifest(
    readJsonFile(path.join(stageRoot, "manifest.json"), "regional scaffold manifest"),
    input.regionCode
  );
  const loaded = {
    projectRoot: root,
    regionRoot: stageRoot,
    manifest
  };
  const configs = loadRegionalConfigs(loaded);
  validateRegionalConfigs(configs, manifest);
  const files = collectRegionFiles(loaded);
  const extensionRegistry = createRegionalExtensionRegistry();
  loadExtensionInstaller(loaded)(extensionRegistry);
  const extensions = extensionRegistry.activate(manifest.extensions, {
    regionCode: input.regionCode,
    features: manifest.features,
    configs
  });
  return { manifest, configs, extensions, files };
}

function validateRegisteredRegionPackage(options = {}) {
  const root = path.resolve(options.root || path.resolve(__dirname, "../../.."));
  const regionCode = String(options.regionCode || "").trim();
  if (!NEW_REGION_PATTERN.test(regionCode)) {
    throw new TypeError("regional package validation requires a six-digit regionCode");
  }
  const registryPath = resolveWithin(root, "config/regions.json", "regional registry");
  const registry = validateRegistry(readJsonFile(registryPath, "regional registry"));
  const registration = registry.regions.find((item) => item.code === regionCode);
  if (!registration) throw new TypeError(`region ${regionCode} is not registered`);
  const regionRoot = resolveWithin(root, `regions/${regionCode}`, `region ${regionCode}`);
  if (!fs.existsSync(regionRoot)) throw new TypeError(`region directory is missing: ${regionCode}`);
  const validated = validateStage(root, regionRoot, { regionCode });
  if (validated.manifest.name !== registration.name) {
    throw new TypeError(`region ${regionCode} manifest name does not match registry`);
  }
  const contentDigest = sha256(stableJson({
    registration,
    files: validated.files
  }));
  return Object.freeze({
    schemaVersion: "regional-package-validation-v1",
    regionCode,
    name: registration.name,
    enabled: registration.enabled,
    deploymentClass: registration.deploymentClass,
    contentDigest,
    ok: true,
    files: validated.files.length,
    extensions: validated.extensions.length
  });
}

function applyRegionScaffold(plan) {
  if (!plan || plan.schemaVersion !== "regional-scaffold-plan-v1") {
    throw new TypeError("regional scaffold requires a valid preview plan");
  }
  const input = normalizeScaffoldInput(plan.input);
  const root = path.resolve(plan.root);
  const regionsRoot = resolveWithin(root, "regions", "regions directory");
  const lockPath = resolveWithin(regionsRoot, ".region-scaffold.lock", "regional scaffold lock");
  let lockHandle;
  try {
    lockHandle = fs.openSync(lockPath, "wx");
  } catch (error) {
    if (error?.code === "EEXIST") throw new TypeError("another regional scaffold operation is in progress");
    throw error;
  }

  const stageRoot = resolveWithin(
    regionsRoot,
    `.scaffold-${input.regionCode}-${process.pid}`,
    "regional scaffold staging directory"
  );
  const targetRoot = resolveWithin(regionsRoot, input.regionCode, `region ${input.regionCode}`);
  const registryPath = resolveWithin(root, "config/regions.json", "regional registry");
  const registryTempPath = resolveWithin(
    path.dirname(registryPath),
    `regions.json.${process.pid}.tmp`,
    "regional registry temporary file"
  );
  let targetCreated = false;
  try {
    const currentPlan = buildRegionScaffoldPlan({ root, ...input });
    copyTemplateDirectory(path.join(regionsRoot, "template"), stageRoot);
    customizeStage(stageRoot, currentPlan.input);
    validateStage(root, stageRoot, currentPlan.input);

    const registry = validateRegistry(readJsonFile(registryPath, "regional registry"));
    const nextRegistry = validateRegistry({
      ...registry,
      regions: [...registry.regions, currentPlan.registryEntry]
    });
    fs.renameSync(stageRoot, targetRoot);
    targetCreated = true;
    writeJson(registryTempPath, nextRegistry);
    fs.renameSync(registryTempPath, registryPath);
    return Object.freeze({
      ...currentPlan,
      mode: "write",
      writes: true,
      validation: Object.freeze({
        manifest: true,
        configs: true,
        packageInventory: true,
        registry: true
      })
    });
  } catch (error) {
    if (fs.existsSync(registryTempPath)) fs.rmSync(registryTempPath, { force: true });
    if (fs.existsSync(stageRoot)) fs.rmSync(stageRoot, { recursive: true, force: true });
    if (targetCreated && fs.existsSync(targetRoot)) fs.rmSync(targetRoot, { recursive: true, force: true });
    throw error;
  } finally {
    fs.closeSync(lockHandle);
    if (fs.existsSync(lockPath)) fs.rmSync(lockPath, { force: true });
  }
}

module.exports = {
  NEW_REGION_PATTERN,
  REGION_LEVELS,
  applyRegionScaffold,
  buildRegionScaffoldPlan,
  copyTemplateDirectory,
  listTemplateFiles,
  normalizeScaffoldInput,
  scaffoldRegistryEntry,
  validateRegisteredRegionPackage,
  validateStage
};
