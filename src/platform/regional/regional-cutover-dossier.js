"use strict";

const path = require("node:path");
const { buildCompositeRegionalRelease } = require("./composite-release");
const {
  buildExpectedSites,
  buildFleetStatus
} = require("./multi-region-operations");
const {
  buildRegionConfigurationReadiness
} = require("./regional-configuration-readiness");
const {
  buildRegionalSiteEvidenceStatus
} = require("./regional-site-evidence");
const {
  getRelease,
  getReleaseState,
  readRegistry,
  summarizeRegistry
} = require("./regional-release-governance");
const {
  buildPostgresPrimaryStorageConfig,
  safeConfigStatus
} = require("../storage/postgres-primary-storage-contract");
const {
  deepFreeze,
  sha256,
  stableJson
} = require("./region-manifest");

const DEFAULT_ROOT = path.resolve(__dirname, "..", "..", "..");
const CANDIDATE_STATES = Object.freeze(["approved-candidate", "deployed", "verified"]);

function check(id, passed, detail) {
  return Object.freeze({ id, passed: Boolean(passed), detail: String(detail || "") });
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function operationsProjection(site) {
  return {
    status: site.status,
    endpointConfigured: site.endpointConfigured,
    live: site.live,
    ready: site.ready,
    digestMatch: site.digestMatch,
    lastCheckedAt: site.lastCheckedAt,
    backupCheckedAt: site.backupCheckedAt || "",
    certificateNotAfter: site.certificateNotAfter || "",
    blockers: [...site.blockers]
  };
}

function buildRegionalCutoverDossier(options = {}) {
  const root = options.root || DEFAULT_ROOT;
  const generatedAt = options.generatedAt || options.now || new Date().toISOString();
  const configuration = options.configuration || buildRegionConfigurationReadiness({
    root,
    regionCode: options.regionCode,
    generatedAt
  });
  const regionCode = configuration.regionCode;
  const composite = options.composite || buildCompositeRegionalRelease({
    root,
    regionCode,
    generatedAt
  });
  const expected = buildExpectedSites({ root, generatedAt })
    .find((site) => site.regionCode === regionCode);
  if (!expected) throw new TypeError(`region ${regionCode} is not eligible for a cutover dossier`);
  const fleet = options.fleet || buildFleetStatus({
    root,
    env: options.env || {},
    receipts: options.receipts || [],
    now: generatedAt
  });
  const fleetSite = fleet.sites.find((site) => site.regionCode === regionCode);
  if (!fleetSite) throw new TypeError(`region ${regionCode} is missing from the operations inventory`);
  const registryPath = path.resolve(options.registryPath || path.join(root, "config", "regional-release-registry.json"));
  const registry = options.registry || readRegistry(registryPath);
  const governance = summarizeRegistry(registry);
  const releaseState = getReleaseState(registry, regionCode, composite.releaseId);
  const registeredRelease = getRelease(registry, regionCode, composite.releaseId);
  const storage = safeConfigStatus(buildPostgresPrimaryStorageConfig(options.env || {}));
  const siteEvidence = options.siteEvidence || buildRegionalSiteEvidenceStatus({
    env: options.env || {},
    generatedAt,
    regionCode,
    expected: {
      regionCode,
      releaseId: composite.releaseId,
      compositeDigest: composite.artifact.digest,
      regionalContentDigest: `sha256:${composite.region.contentDigest}`
    }
  });
  const releaseBindingMatches = !registeredRelease || (
    registeredRelease.compositeDigest === composite.artifact.digest
    && registeredRelease.regionalContentDigest === `sha256:${composite.region.contentDigest}`
  );
  const backupFresh = Boolean(fleetSite.backupCheckedAt)
    && !fleetSite.blockers.includes("backup-evidence-missing")
    && !fleetSite.blockers.includes("backup-evidence-stale");
  const certificateCurrent = Boolean(fleetSite.certificateNotAfter)
    && !fleetSite.blockers.includes("certificate-expiry-unknown")
    && !fleetSite.blockers.includes("certificate-expiring");
  const checks = [
    check(
      "regionalDossier:configurationControl",
      configuration.technicalReady && configuration.productionReady === false,
      `${configuration.checks.filter((item) => item.passed).length}/${configuration.checks.length} configuration checks`
    ),
    check(
      "regionalDossier:compositeBinding",
      composite.technicalReady
        && composite.productionReady === false
        && expected.regionalReleaseId === composite.releaseId
        && expected.expectedArtifactDigest === composite.artifact.digest,
      composite.releaseId
    ),
    check(
      "regionalDossier:governanceIntegrity",
      governance.ok && governance.productionReady === false && releaseBindingMatches,
      `${governance.eventCount} append-only release events; binding=${releaseBindingMatches ? "matched-or-unregistered" : "drift"}`
    ),
    check(
      "regionalDossier:operationsBoundary",
      fleet.containsBusinessData === false
        && fleet.probeTargetsExposed === false
        && fleet.productionReady === false,
      `${fleet.summary.sites} sites; endpoints and business data excluded`
    ),
    check(
      "regionalDossier:storageBoundary",
      storage.modeReady
        && storage.capabilities.requestPathWrite === false
        && storage.productionPrimary === false
        && storage.runtimeCutoverEnabled === false,
      `mode=${storage.mode}; request-path writes blocked; production primary false`
    ),
    check(
      "regionalDossier:siteEvidenceBoundary",
      siteEvidence.ok
        && siteEvidence.productionReady === false
        && siteEvidence.containsEvidenceBodies === false
        && siteEvidence.containsReviewerIdentities === false,
      `${siteEvidence.summary.ready}/${siteEvidence.summary.requiredScopes} evidence scopes ready; evidence bodies excluded`
    )
  ];
  const gates = [
    check(
      "regionalDossierGate:productionClass",
      configuration.deploymentClass === "production",
      configuration.deploymentClass
    ),
    check(
      "regionalDossierGate:configuration",
      configuration.candidateEligible,
      configuration.candidateEligible ? "configuration is a technical candidate" : "configuration is not candidate eligible"
    ),
    check(
      "regionalDossierGate:releaseRegistered",
      Boolean(registeredRelease),
      registeredRelease ? composite.releaseId : "current composite release is not registered"
    ),
    check(
      "regionalDossierGate:releaseState",
      CANDIDATE_STATES.includes(releaseState),
      releaseState || "unregistered"
    ),
    check(
      "regionalDossierGate:operationsHealthy",
      fleetSite.status === "healthy",
      fleetSite.status
    ),
    check(
      "regionalDossierGate:contentDigest",
      fleetSite.digestMatch === true,
      fleetSite.digestMatch ? "matched" : "not matched or not checked"
    ),
    check(
      "regionalDossierGate:backupFresh",
      backupFresh,
      fleetSite.backupCheckedAt || "missing"
    ),
    check(
      "regionalDossierGate:certificateCurrent",
      certificateCurrent,
      fleetSite.certificateNotAfter || "missing"
    ),
    check(
      "regionalDossierGate:storageContract",
      storage.modeReady,
      `mode=${storage.mode}`
    ),
    check(
      "regionalDossierGate:siteEvidence",
      siteEvidence.evidenceReady,
      `${siteEvidence.summary.ready}/${siteEvidence.summary.requiredScopes} evidence scopes ready`
    )
  ];
  const blockers = unique([
    configuration.deploymentClass !== "production" && "region-not-production-class",
    !configuration.candidateEligible && "regional-configuration-not-candidate",
    !registeredRelease && "regional-release-not-registered",
    registeredRelease && !releaseBindingMatches && "regional-release-binding-drift",
    !CANDIDATE_STATES.includes(releaseState) && "regional-release-state-not-candidate",
    !fleetSite.endpointConfigured && "regional-operations-endpoint-unconfigured",
    fleetSite.status !== "healthy" && `regional-operations-${fleetSite.status}`,
    ...fleetSite.blockers,
    !backupFresh && "backup-evidence-not-fresh",
    !certificateCurrent && "certificate-evidence-not-current",
    !storage.modeReady && "postgres-storage-contract-not-ready",
    ...siteEvidence.blockers
  ]);
  const base = {
    schemaVersion: "regional-cutover-dossier-v1",
    generatedAt,
    regionCode,
    regionName: configuration.regionName,
    deploymentClass: configuration.deploymentClass,
    ok: checks.every((item) => item.passed),
    candidateReady: gates.every((item) => item.passed),
    productionReady: false,
    containsBusinessData: false,
    containsEndpoints: false,
    containsEvidenceBodies: false,
    release: {
      releaseId: composite.releaseId,
      platformVersion: composite.platform.version,
      regionVersion: composite.region.version,
      compositeDigest: composite.artifact.digest,
      regionalContentDigest: composite.region.contentDigest,
      governanceState: releaseState || "unregistered",
      registered: Boolean(registeredRelease),
      bindingMatches: releaseBindingMatches
    },
    configuration: {
      technicalReady: configuration.technicalReady,
      candidateEligible: configuration.candidateEligible,
      configurationSurfaceDigest: configuration.digests.configurationSurface,
      checks: configuration.checks.length,
      passed: configuration.checks.filter((item) => item.passed).length
    },
    governance: {
      registryDigest: governance.registryDigest,
      eventCount: governance.eventCount,
      integrityVerified: governance.ok
    },
    operations: operationsProjection(fleetSite),
    storage,
    siteEvidence,
    checks,
    gates,
    blockers,
    externalBlockers: siteEvidence.evidenceReady
      ? ["explicit external production authorization remains required"]
      : [
        "real identity and hospital-system joint-test evidence",
        "security, commercial-cryptography and compliance assessment",
        "staffed monitoring, disaster-recovery rehearsal and incident response",
        "independent site acceptance and explicit external production authorization"
      ]
  };
  return deepFreeze({
    ...base,
    dossierDigest: `sha256:${sha256(stableJson(base))}`
  });
}

function buildRegionalCutoverPortfolio(options = {}) {
  const root = options.root || DEFAULT_ROOT;
  const generatedAt = options.generatedAt || options.now || new Date().toISOString();
  const regions = buildExpectedSites({ root, generatedAt }).map((site) =>
    buildRegionalCutoverDossier({
      ...options,
      root,
      generatedAt,
      regionCode: site.regionCode
    })
  );
  return deepFreeze({
    schemaVersion: "regional-cutover-dossier-portfolio-v1",
    generatedAt,
    ok: regions.every((item) => item.ok),
    candidateReady: regions.filter((item) => item.candidateReady).length,
    productionReady: false,
    summary: {
      regions: regions.length,
      localControlReady: regions.filter((item) => item.ok).length,
      candidateReady: regions.filter((item) => item.candidateReady).length,
      blocked: regions.filter((item) => !item.candidateReady).length
    },
    regions
  });
}

module.exports = {
  CANDIDATE_STATES,
  buildRegionalCutoverDossier,
  buildRegionalCutoverPortfolio,
  operationsProjection
};
