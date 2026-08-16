"use strict";

const { buildFleetStatus } = require("./multi-region-operations");
const { buildRegionalCutoverDossier } = require("./regional-cutover-dossier");

function buildRegionalCutoverWorkbench(options = {}) {
  const fleet = buildFleetStatus({ env: options.env || process.env, receipts: options.receipts || [], now: options.now });
  const regions = fleet.sites.map((site) => {
    const dossier = buildRegionalCutoverDossier({
      env: options.env || process.env,
      receipts: options.receipts || [],
      regionCode: site.regionCode,
      now: options.now
    });
    return Object.freeze({
      regionCode: dossier.regionCode,
      regionName: dossier.regionName,
      deploymentClass: dossier.deploymentClass,
      release: Object.freeze({
        releaseId: dossier.release.releaseId,
        state: dossier.release.governanceState,
        registered: dossier.release.registered,
        bindingMatches: dossier.release.bindingMatches
      }),
      configuration: Object.freeze({ technicalReady: dossier.configuration.technicalReady, candidateEligible: dossier.configuration.candidateEligible }),
      operations: Object.freeze({ status: dossier.operations.status, ready: dossier.operations.ready, digestMatch: dossier.operations.digestMatch }),
      storage: Object.freeze({ mode: dossier.storage.mode, modeReady: dossier.storage.modeReady, productionPrimary: false }),
      evidence: Object.freeze({
        configured: dossier.siteEvidence.configured,
        trusted: dossier.siteEvidence.trust?.cryptographicTrustReady === true,
        lifecycleState: dossier.siteEvidence.lifecycle?.state || "unconfigured",
        lifecycleAccepted: dossier.siteEvidence.lifecycle?.accepted === true,
        readyScopes: dossier.siteEvidence.summary?.ready || 0,
        requiredScopes: dossier.siteEvidence.summary?.requiredScopes || 0,
        evidenceReady: dossier.siteEvidence.evidenceReady === true
      }),
      candidateReady: dossier.candidateReady,
      productionReady: false,
      blockers: Object.freeze([...dossier.blockers])
    });
  });
  const checks = Object.freeze([
    { id: "regionalWorkbench:portfolio", passed: regions.length === fleet.summary.sites, detail: `${regions.length} regions` },
    { id: "regionalWorkbench:minimized", passed: true, detail: "business data, endpoints, evidence bodies, signatures and actor identities excluded" },
    { id: "regionalWorkbench:productionBoundary", passed: regions.every((item) => item.productionReady === false), detail: "workbench cannot authorize production" }
  ]);
  return Object.freeze({
    schemaVersion: "regional-cutover-workbench-v1",
    generatedAt: fleet.generatedAt,
    ok: checks.every((item) => item.passed),
    candidateReady: regions.some((item) => item.deploymentClass === "production" && item.candidateReady),
    productionReady: false,
    containsBusinessData: false,
    containsEndpoints: false,
    containsEvidenceBodies: false,
    containsActorIdentities: false,
    summary: Object.freeze({
      regions: regions.length,
      technicalReady: regions.filter((item) => item.configuration.technicalReady).length,
      operationsReady: regions.filter((item) => item.operations.ready).length,
      evidenceReady: regions.filter((item) => item.evidence.evidenceReady).length,
      candidateReady: regions.filter((item) => item.candidateReady).length,
      blocked: regions.filter((item) => !item.candidateReady).length
    }),
    regions: Object.freeze(regions),
    checks,
    boundary: "This read-only workbench aggregates minimized control metadata and never records a production GO decision."
  });
}

module.exports = { buildRegionalCutoverWorkbench };
