"use strict";

const path = require("node:path");
const {
  deepFreeze,
  loadRegionManifest,
  loadRegionalConfigs,
  sha256,
  stableJson
} = require("./region-manifest");
const {
  REQUIRED_CONFIGS,
  validateRegionalConfigs
} = require("./regional-config-contract");

const DEFAULT_ROOT = path.resolve(__dirname, "..", "..", "..");
const CAPABILITY_REQUIREMENTS = Object.freeze({
  "regional.branding": Object.freeze({
    configs: Object.freeze(["ui-theme"]),
    extensionKind: "ui"
  }),
  "regional.dictionary": Object.freeze({
    configs: Object.freeze(["administrative-divisions", "dictionaries"]),
    extensionKind: "dictionary"
  }),
  "regional.integration": Object.freeze({
    configs: Object.freeze(["adapter-profiles"]),
    extensionKind: "adapter"
  }),
  "regional.policy": Object.freeze({
    configs: Object.freeze(["policies"]),
    extensionKind: "policy"
  }),
  "regional.workflow": Object.freeze({
    configs: Object.freeze(["migration-inventory"]),
    extensionKind: "workflow"
  })
});

function check(id, passed, detail) {
  return Object.freeze({ id, passed: Boolean(passed), detail: String(detail || "") });
}

function countDirectory(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value).length
    : 0;
}

function requiredCapabilityConfigs(manifest) {
  return [...new Set(Object.entries(CAPABILITY_REQUIREMENTS)
    .filter(([feature]) => manifest.features?.[feature] === true)
    .flatMap(([, requirement]) => requirement.configs))]
    .sort();
}

function capabilityCoverage(manifest, configs) {
  return Object.entries(CAPABILITY_REQUIREMENTS).map(([feature, requirement]) => {
    const enabled = manifest.features?.[feature] === true;
    const configPresent = requirement.configs.every((name) =>
      Object.prototype.hasOwnProperty.call(configs, name)
    );
    const extensionPresent = manifest.extensions.some((extension) =>
      extension.enabled === true && extension.kind === requirement.extensionKind
    );
    return Object.freeze({
      feature,
      enabled,
      requiredConfigs: [...requirement.configs],
      configPresent,
      extensionPresent,
      passed: enabled ? configPresent && extensionPresent : !extensionPresent
    });
  });
}

function assessRegionConfiguration(loaded, configs, options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  let contractError = "";
  try {
    validateRegionalConfigs(configs, loaded.manifest);
  } catch (error) {
    contractError = String(error?.message || "regional configuration contract failed").slice(0, 500);
  }
  const coverage = capabilityCoverage(loaded.manifest, configs);
  const requiredConfigs = requiredCapabilityConfigs(loaded.manifest);
  const configNames = Object.keys(configs).sort();
  const organizationCount = countDirectory(configs.organization?.organizations);
  const geographyCount = countDirectory(configs.geography?.areas);
  const localizationTerms = countDirectory(configs.localization?.terms);
  const enabledExtensions = loaded.manifest.extensions.filter((item) => item.enabled).length;
  const productionClass = loaded.registration.deploymentClass === "production";
  const adapterProfiles = Array.isArray(configs["adapter-profiles"]?.profiles)
    ? configs["adapter-profiles"].profiles
    : [];
  const policies = Array.isArray(configs.policies?.policies) ? configs.policies.policies : [];
  const configSurfaceDigest = `sha256:${sha256(stableJson(configs))}`;
  const checks = [
    check(
      "regionalConfig:contract",
      !contractError,
      contractError || `${REQUIRED_CONFIGS.length} common configuration contracts passed`
    ),
    check(
      "regionalConfig:declaredFiles",
      configNames.length === loaded.manifest.configRefs.length
        && loaded.manifest.configRefs.every((ref) =>
          configNames.includes(path.basename(ref, ".json"))
        ),
      `${configNames.length}/${loaded.manifest.configRefs.length} declared configuration files loaded`
    ),
    check(
      "regionalConfig:capabilityCoverage",
      coverage.every((item) => item.passed),
      `${coverage.filter((item) => item.passed).length}/${coverage.length} feature/config/extension mappings passed`
    ),
    check(
      "regionalConfig:organizationDirectory",
      organizationCount >= 3,
      `${organizationCount} minimized organization directory entries`
    ),
    check(
      "regionalConfig:geographyDirectory",
      geographyCount >= 1,
      `${geographyCount} administrative area entries`
    ),
    check(
      "regionalConfig:localization",
      localizationTerms >= 2,
      `${localizationTerms} localized terms`
    ),
    check(
      "regionalConfig:contentBinding",
      /^[a-f0-9]{64}$/.test(loaded.contentDigest)
        && /^[a-f0-9]{64}$/.test(loaded.digest)
        && /^sha256:[a-f0-9]{64}$/.test(configSurfaceDigest),
      `manifest=${loaded.digest}; content=${loaded.contentDigest}; config=${configSurfaceDigest}`
    ),
    check(
      "regionalConfig:adapterFailClosed",
      !productionClass
        || adapterProfiles.every((profile) => profile.productionEnabled === false),
      productionClass
        ? `${adapterProfiles.length} production adapter profiles remain disabled pending external evidence`
        : "non-production region cannot activate production adapters"
    ),
    check(
      "regionalConfig:policyBoundary",
      !productionClass
        || (policies.length >= 1 && configs.policies?.productionDecision === "NO-GO"),
      productionClass
        ? `${policies.length} regional policies; production decision remains NO-GO`
        : "non-production region has no production policy requirement"
    )
  ];
  const technicalReady = checks.every((item) => item.passed);
  return deepFreeze({
    schemaVersion: "regional-configuration-readiness-v1",
    generatedAt,
    regionCode: loaded.manifest.regionCode,
    regionName: loaded.manifest.name,
    deploymentClass: loaded.registration.deploymentClass,
    releaseVersion: loaded.manifest.release.version,
    technicalReady,
    candidateEligible: productionClass && technicalReady,
    productionReady: false,
    containsConfigurationValues: false,
    digests: {
      manifest: `sha256:${loaded.digest}`,
      content: `sha256:${loaded.contentDigest}`,
      configurationSurface: configSurfaceDigest
    },
    summary: {
      configFiles: configNames.length,
      requiredCapabilityConfigs: requiredConfigs.length,
      enabledFeatures: Object.values(loaded.manifest.features).filter(Boolean).length,
      enabledExtensions,
      organizations: organizationCount,
      areas: geographyCount,
      localizationTerms
    },
    capabilityCoverage: coverage,
    checks,
    externalBlockers: productionClass
      ? [
        "official organization and administrative-division ownership confirmation",
        "regional policy and dictionary effective-version confirmation",
        "real adapter endpoint, identity and field-mapping joint testing",
        "signed configuration acceptance bound to the regional content digest"
      ]
      : [
        "test and template regions are never production eligible",
        "real regional organization, policy and integration data must replace fixture content"
      ]
  });
}

function buildRegionConfigurationReadiness(options = {}) {
  const root = options.root || DEFAULT_ROOT;
  const loaded = options.loaded || loadRegionManifest({
    root,
    regionCode: options.regionCode,
    expectedDeploymentClass: options.expectedDeploymentClass
  });
  const configs = options.configs || loadRegionalConfigs(loaded);
  return assessRegionConfiguration(loaded, configs, options);
}

function buildRegionalConfigurationPortfolio(options = {}) {
  const root = options.root || DEFAULT_ROOT;
  const registry = loadRegionManifest({ root }).registry;
  const reports = registry.regions
    .filter((entry) => entry.enabled && entry.code !== registry.defaultRegion)
    .map((entry) => buildRegionConfigurationReadiness({
      ...options,
      root,
      regionCode: entry.code,
      expectedDeploymentClass: entry.deploymentClass
    }));
  return deepFreeze({
    schemaVersion: "regional-configuration-portfolio-v1",
    generatedAt: options.generatedAt || new Date().toISOString(),
    ok: reports.every((report) => report.technicalReady),
    productionReady: false,
    summary: {
      regions: reports.length,
      technicalReady: reports.filter((report) => report.technicalReady).length,
      productionCandidates: reports.filter((report) => report.candidateEligible).length,
      testFixtures: reports.filter((report) => report.deploymentClass === "test").length
    },
    regions: reports
  });
}

module.exports = {
  CAPABILITY_REQUIREMENTS,
  assessRegionConfiguration,
  buildRegionConfigurationReadiness,
  buildRegionalConfigurationPortfolio,
  capabilityCoverage,
  requiredCapabilityConfigs
};
