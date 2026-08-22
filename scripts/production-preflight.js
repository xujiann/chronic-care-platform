#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { assessAuditDeliveryConfig } = require("../src/platform/operations/audit-delivery");
const { inspectFollowupDispatchWorkerReadiness } = require("../src/citizen-chronic/followup-dispatch-worker");
const { inspectFollowupActivationProvider } = require("../src/citizen-chronic/followup-dispatch-activation-provider");
const {
  createFileBackedProductionEvidenceTrustVerifier,
  inspectProductionEvidenceTrustProvider
} = require("../src/platform/governance/production-evidence-trust-provider");

const { buildLaunchSmokeReport } = require("./launch-smoke");
const {
  buildEffectiveActionReport,
  loadRegister: loadCutoverActionRegister,
  resolveCutoverActionEvidenceProvider
} = require("./production-cutover-action-register");
const { verifyProductionDeploymentPackage } = require("./production-deployment-package");
const {
  GATE_DEFINITIONS,
  buildProductionReleaseEvidenceReadiness,
  readEvidenceDirectory
} = require("./production-release-evidence-readiness");
const { readEnvFile, validateProductionConfig } = require("./release-report");
const {
  readRegistry,
  validExternalAttestation,
  verifyRegistry
} = require("./release-registry");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_PACKAGE = path.join(ROOT, "release", "production-deployment-package.json");
const DEFAULT_REGISTRY = path.join(ROOT, "release", "local-artifact-registry.json");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "production-preflight-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "production-preflight-report.md");

function check(id, passed, detail, phase = "software") {
  return { id, phase, passed: Boolean(passed), detail: String(detail || "") };
}

function configuredPath(value) {
  const text = String(value || "").trim();
  return Boolean(text) && (path.isAbsolute(text) || /^\/[A-Za-z0-9._/-]+$/.test(text));
}

function deploymentBindingChecks(env, manifest) {
  const provider = String(env.DEPLOYMENT_SECRET_PROVIDER || "").toLowerCase();
  const baseUrl = String(env.DEPLOYMENT_BASE_URL || "");
  return [
    check("preflight:secret-provider", ["vault", "kms", "orchestrator"].includes(provider), provider || "missing DEPLOYMENT_SECRET_PROVIDER", "runtime-config"),
    check("preflight:release-id-binding", env.DEPLOYMENT_RELEASE_ID === manifest.releaseId, env.DEPLOYMENT_RELEASE_ID || "missing DEPLOYMENT_RELEASE_ID", "runtime-config"),
    check("preflight:artifact-digest-binding", env.DEPLOYMENT_ARTIFACT_DIGEST === manifest.artifact.digest, env.DEPLOYMENT_ARTIFACT_DIGEST || "missing DEPLOYMENT_ARTIFACT_DIGEST", "runtime-config"),
    check("preflight:base-url", /^https:\/\/[^/]+/i.test(baseUrl), baseUrl || "missing DEPLOYMENT_BASE_URL", "runtime-config"),
    check("preflight:app-dir", configuredPath(env.DEPLOYMENT_APP_DIR), env.DEPLOYMENT_APP_DIR || "missing DEPLOYMENT_APP_DIR", "runtime-config"),
    check("preflight:secret-env-file", configuredPath(env.DEPLOYMENT_SECRET_ENV_FILE), env.DEPLOYMENT_SECRET_ENV_FILE || "missing DEPLOYMENT_SECRET_ENV_FILE", "runtime-config"),
    check("preflight:data-dir", configuredPath(env.DEPLOYMENT_DATA_DIR), env.DEPLOYMENT_DATA_DIR || "missing DEPLOYMENT_DATA_DIR", "runtime-config"),
    check("preflight:log-dir", configuredPath(env.DEPLOYMENT_LOG_DIR), env.DEPLOYMENT_LOG_DIR || "missing DEPLOYMENT_LOG_DIR", "runtime-config")
  ];
}

function loadProductionEvidence(options = {}) {
  if (options.productionEvidence && options.evidenceRecords) {
    return { report: options.productionEvidence, records: options.evidenceRecords };
  }
  if (options.productionEvidence) {
    return { report: options.productionEvidence, records: {} };
  }
  const loaded = readEvidenceDirectory(options.evidenceDir);
  return {
    report: buildProductionReleaseEvidenceReadiness({
      directory: loaded.directory,
      records: loaded.records
    }),
    records: loaded.records
  };
}

function evidenceBoundToRelease(records, manifest) {
  return GATE_DEFINITIONS.length > 0 && GATE_DEFINITIONS.every((definition) => {
    const record = records?.[definition.file];
    return record
      && record.releaseId === manifest.releaseId
      && String(record.artifactDigest || "").toLowerCase() === String(manifest.artifact?.digest || "").toLowerCase();
  });
}

async function verifyExternalTrust(options, context) {
  if (typeof options.externalTrustVerifier !== "function") {
    return {
      registryAttestationVerified: false,
      productionEvidenceVerified: false,
      detail: "external trust verifier is not configured"
    };
  }
  try {
    const result = await options.externalTrustVerifier(context);
    return {
      registryAttestationVerified: result?.registryAttestationVerified === true,
      productionEvidenceVerified: result?.productionEvidenceVerified === true,
      detail: String(result?.detail || "external trust verifier returned a decision").slice(0, 240)
    };
  } catch {
    return {
      registryAttestationVerified: false,
      productionEvidenceVerified: false,
      detail: "external trust verifier failed closed"
    };
  }
}

function resolveProductionEvidenceTrustProvider(env, options = {}) {
  const inspection = options.productionEvidenceTrustProvider
    || inspectProductionEvidenceTrustProvider(env, { now: options.now });
  if (typeof options.externalTrustVerifier === "function") {
    return Object.freeze({ inspection, verifier: options.externalTrustVerifier, source: "injected" });
  }
  if (inspection.configured !== true) {
    return Object.freeze({ inspection, verifier: undefined, source: "unavailable" });
  }
  try {
    return Object.freeze({
      inspection,
      verifier: createFileBackedProductionEvidenceTrustVerifier({ env, now: options.now }),
      source: "controlled-files"
    });
  } catch {
    return Object.freeze({
      inspection: Object.freeze({
        contract: inspection.contract,
        configured: false,
        errorCode: "PRODUCTION_EVIDENCE_TRUST_PROVIDER_UNAVAILABLE",
        reasonCode: "PRODUCTION_EVIDENCE_TRUST_MATERIAL_UNAVAILABLE",
        detail: "production evidence trust provider failed closed",
        externalEvidenceRequired: true,
        productionReady: false
      }),
      verifier: undefined,
      source: "unavailable"
    });
  }
}

async function buildProductionPreflight(options = {}) {
  const root = options.root || ROOT;
  const manifest = options.manifest || JSON.parse(fs.readFileSync(options.packagePath || DEFAULT_PACKAGE, "utf8"));
  const registry = options.registry || readRegistry(options.registryPath || DEFAULT_REGISTRY, undefined, { root });
  const env = { ...readEnvFile(options.envFile || ""), ...(options.env || {}) };
  const packageVerification = options.packageVerification || verifyProductionDeploymentPackage(manifest, { root });
  const registryVerification = options.registryVerification || verifyRegistry(registry, {
    root,
    verifyBackups: options.verifyBackups !== false,
    manifest
  });
  const registryEntry = registry.entries?.find((item) => item.releaseId === manifest.releaseId);
  const productionConfig = options.productionConfig || validateProductionConfig({
    profile: "production",
    envFile: options.envFile || "",
    env
  });
  const productionEvidence = loadProductionEvidence(options);
  const productionEvidenceTrustProvider = resolveProductionEvidenceTrustProvider(env, options);
  const externalTrust = await verifyExternalTrust({
    externalTrustVerifier: productionEvidenceTrustProvider.verifier
  }, {
    manifest,
    registryEntry: registry.entries?.find((item) => item.releaseId === manifest.releaseId) || null,
    registryVerification,
    productionEvidence: productionEvidence.report,
    evidenceRecords: productionEvidence.records
  });
  const evidenceReleaseBound = evidenceBoundToRelease(productionEvidence.records, manifest);
  const cutoverActionRegister = options.cutoverActionRegister || loadCutoverActionRegister();
  const cutoverActions = [
    ...(cutoverActionRegister.cutoverActions || []),
    ...(cutoverActionRegister.evidenceActions || [])
  ];
  const cutoverActionProvider = resolveCutoverActionEvidenceProvider(env, cutoverActions, options);
  const cutoverActionEvidence = await buildEffectiveActionReport(cutoverActionRegister, {
    manifest,
    evidenceRecords: cutoverActionProvider.records,
    evidenceErrors: cutoverActionProvider.errors,
    externalEvidenceVerifier: cutoverActionProvider.verifier,
    now: options.now
  });
  const followupExternalEvidenceVerified = productionEvidence.report?.ok === true
    && productionEvidence.report?.status === "go-decision-evidence-validated"
    && evidenceReleaseBound
    && validExternalAttestation(registryEntry?.externalAttestation)
    && externalTrust.registryAttestationVerified
    && externalTrust.productionEvidenceVerified;
  const auditDeliveryAssessment = options.auditDeliveryAssessment || assessAuditDeliveryConfig(env, {
    root,
    checkFilesystem: options.checkFilesystem !== false,
    sourceContinuityImplemented: env.AUDIT_DELIVERY_SOURCE_CONTRACT === "append-only-audit-source-v2"
  });
  const followupActivationProvider = options.followupActivationProvider || inspectFollowupActivationProvider(env, {
    checkFilesystem: options.checkFilesystem !== false
  });
  const followupDispatchAssessment = options.followupDispatchAssessment || inspectFollowupDispatchWorkerReadiness(env, {
    activationVerifierConfigured: options.followupDispatchActivationVerifierConfigured === true || followupActivationProvider.configured === true,
    externalEvidenceVerified: followupExternalEvidenceVerified
  });
  const bindings = deploymentBindingChecks(env, manifest);
  const launchSmoke = options.launchSmoke || await buildLaunchSmokeReport({
    baseUrl: options.baseUrl || env.DEPLOYMENT_BASE_URL || "",
    fetcher: options.fetcher,
    artifactExists: options.artifactExists,
    releaseReport: options.releaseReport,
    cutover: options.cutover
  });

  const exactRegistryBinding = Boolean(registryEntry)
    && registryEntry.sourceSha === String(manifest.source?.commit || "").toLowerCase()
    && registryEntry.sourceDirty === false
    && registryEntry.source?.commit === String(manifest.source?.commit || "").toLowerCase()
    && registryEntry.source?.dirty === false
    && manifest.source?.dirty === false
    && registryEntry.artifactDigest === String(manifest.artifact?.digest || "").toLowerCase()
    && registryVerification.checks?.some((item) => item.id === "registry:deployment-package-binding" && item.passed);
  const softwareChecks = [
    check("preflight:package", manifest.ok === true && packageVerification.ok, `${packageVerification.checks.filter((item) => item.passed).length}/${packageVerification.checks.length} package checks`),
    check("preflight:clean-source", /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(String(manifest.source?.commit || "").toLowerCase()) && manifest.source?.dirty === false, `${manifest.source?.commit || "missing"} / dirty=${manifest.source?.dirty}`),
    check("preflight:registry-chain", registryVerification.ok, `${registryVerification.entries} registered releases`),
    check("preflight:unique-baseline", registryVerification.checks?.some((item) => item.id === "registry:unique-baseline" && item.passed), registry.integrationBaseline ? `${registry.integrationBaseline.tag}@${registry.integrationBaseline.commit}` : "baseline missing"),
    check("preflight:release-package-binding", exactRegistryBinding, registryEntry ? `${registryEntry.releaseId}@${registryEntry.sourceSha}/${registryEntry.artifactDigest}` : "current release is not registered"),
    check("preflight:backup-bound", Boolean(registryEntry?.backup?.manifestSha256 && registryEntry?.backup?.dataQualityPassed), registryEntry?.backup?.directory || "verified backup missing"),
    check("preflight:rollback-contract", manifest.rollbackContract?.requirePreviousArtifactDigest === true && manifest.rollbackContract?.requireStorageBackup === true, "previous digest and verified backup are mandatory")
  ];
  const runtimeChecks = [
    ...bindings,
    check("preflight:production-config", productionConfig.passed, `${productionConfig.checks.filter((item) => item.passed).length}/${productionConfig.checks.length} production configuration checks`, "runtime-config"),
    check("preflight:audit-delivery", auditDeliveryAssessment.ready === true && auditDeliveryAssessment.productionReady === true, `${auditDeliveryAssessment.checks?.filter((item) => item.passed).length || 0}/${auditDeliveryAssessment.checks?.length || 0} continuous audit deployment checks; productionReady=${auditDeliveryAssessment.productionReady === true}`, "runtime-config"),
    check("preflight:chronic-followup-dispatch", followupDispatchAssessment.configured === true && followupDispatchAssessment.productionReady === true, `${followupDispatchAssessment.checks?.filter((item) => item.passed).length || 0}/${followupDispatchAssessment.checks?.length || 0} durable followup dispatch checks; productionReady=${followupDispatchAssessment.productionReady === true}`, "runtime-config")
  ];
  const liveChecks = launchSmoke.checks
    .filter((item) => item.category === "live")
    .map((item) => check(`preflight:${item.id}`, item.passed, item.detail, "live"));
  const externalChecks = [
    check("preflight:external-registry-attestation", validExternalAttestation(registryEntry?.externalAttestation) && externalTrust.registryAttestationVerified, externalTrust.registryAttestationVerified ? registryEntry?.externalAttestation?.evidenceRef : externalTrust.detail, "external-evidence"),
    check("preflight:production-evidence-validation", productionEvidence.report?.ok === true && productionEvidence.report?.status === "go-decision-evidence-validated" && externalTrust.productionEvidenceVerified, externalTrust.productionEvidenceVerified ? productionEvidence.report?.status : externalTrust.detail, "external-evidence"),
    check("preflight:production-evidence-release-binding", evidenceReleaseBound, evidenceReleaseBound ? `${manifest.releaseId}/${manifest.artifact.digest}` : "every required evidence document must match the current release id and artifact digest", "external-evidence"),
    check("preflight:cutover-action-evidence", cutoverActionEvidence.productionReady === true, cutoverActionEvidence.productionReady ? `${cutoverActionEvidence.summary.verified}/${cutoverActionEvidence.summary.actions} actions / ${cutoverActionEvidence.reportDigest}` : `${cutoverActionEvidence.summary.blocked}/${cutoverActionEvidence.summary.actions} actions blocked`, "external-evidence")
  ];
  const checks = [...softwareChecks, ...runtimeChecks, ...liveChecks, ...externalChecks];
  const softwareReady = softwareChecks.every((item) => item.passed);
  const runtimeConfigured = runtimeChecks.every((item) => item.passed);
  const liveReady = liveChecks.length >= 2 && liveChecks.every((item) => item.passed);
  const externalEvidenceReady = externalChecks.every((item) => item.passed);
  const productionReady = softwareReady && runtimeConfigured && liveReady && externalEvidenceReady;

  return {
    schemaVersion: "production-preflight-v2",
    generatedAt: new Date().toISOString(),
    releaseId: manifest.releaseId,
    sourceSha: manifest.source?.commit || "",
    artifactDigest: manifest.artifact.digest,
    status: productionReady ? "production-ready" : "production-blocked",
    decision: productionReady ? "GO" : "NO-GO",
    ok: productionReady,
    softwareReady,
    runtimeConfigured,
    liveReady,
    externalEvidenceReady,
    productionReady,
    summary: {
      total: checks.length,
      passed: checks.filter((item) => item.passed).length,
      blocked: checks.filter((item) => !item.passed).length,
      softwareChecks: softwareChecks.length,
      runtimeChecks: runtimeChecks.length,
      liveChecks: liveChecks.length,
      externalChecks: externalChecks.length
    },
    packageVerification,
    registryVerification,
    productionConfig: {
      passed: productionConfig.passed,
      checks: productionConfig.checks.map((item) => ({
        id: item.id || item.name,
        passed: item.passed,
        severity: item.severity,
        category: item.category
      }))
    },
    auditDeliveryAssessment: {
      schemaVersion: auditDeliveryAssessment.schemaVersion || "audit-delivery-activation-v1",
      ready: auditDeliveryAssessment.ready === true,
      productionReady: auditDeliveryAssessment.productionReady === true,
      checks: (auditDeliveryAssessment.checks || []).map((item) => ({ id: item.id, passed: item.passed })),
      boundary: auditDeliveryAssessment.boundary || "continuous audit production evidence is incomplete"
    },
    followupDispatchAssessment: {
      contract: followupDispatchAssessment.contract || "citizen-chronic.followup-dispatch-worker.v1",
      configured: followupDispatchAssessment.configured === true,
      externalEvidenceVerified: followupDispatchAssessment.externalEvidenceVerified === true,
      productionReady: followupDispatchAssessment.productionReady === true,
      checks: (followupDispatchAssessment.checks || []).map((item) => ({ id: item.id, passed: item.passed })),
      boundary: followupDispatchAssessment.boundary || "Release-bound external evidence is required."
    },
    followupActivationProvider: {
      contract: followupActivationProvider.contract || "citizen-chronic.followup-dispatch-activation-registry.v1",
      configured: followupActivationProvider.configured === true,
      externalDecisionRequired: true,
      productionReady: followupActivationProvider.configured === true && followupExternalEvidenceVerified
    },
    launchSmoke: {
      ok: launchSmoke.ok,
      baseUrl: launchSmoke.baseUrl,
      summary: launchSmoke.summary
    },
    productionEvidence: {
      ok: productionEvidence.report?.ok === true,
      status: productionEvidence.report?.status || "missing",
      evidenceFingerprint: productionEvidence.report?.evidenceFingerprint || "",
      releaseBound: evidenceReleaseBound,
      externallyVerified: externalTrust.productionEvidenceVerified
    },
    productionEvidenceTrustProvider: {
      contract: productionEvidenceTrustProvider.inspection.contract,
      configured: productionEvidenceTrustProvider.inspection.configured === true,
      source: productionEvidenceTrustProvider.source,
      reasonCode: productionEvidenceTrustProvider.inspection.reasonCode || "",
      signerCount: Number(productionEvidenceTrustProvider.inspection.signerCount || 0),
      roles: productionEvidenceTrustProvider.inspection.roles || [],
      envelopeDigest: productionEvidenceTrustProvider.inspection.envelopeDigest || "",
      verified: externalTrust.registryAttestationVerified === true
        && externalTrust.productionEvidenceVerified === true,
      productionReady: externalTrust.registryAttestationVerified === true
        && externalTrust.productionEvidenceVerified === true,
      boundary: "Provider verification is necessary but cannot authorize production without every preflight gate."
    },
    cutoverActionEvidence: {
      contract: cutoverActionEvidence.schemaVersion,
      configured: cutoverActionProvider.configured === true,
      source: cutoverActionProvider.source,
      releaseId: cutoverActionEvidence.releaseId,
      artifactDigest: cutoverActionEvidence.artifactDigest,
      reportDigest: cutoverActionEvidence.reportDigest,
      summary: cutoverActionEvidence.summary,
      productionReady: cutoverActionEvidence.productionReady === true,
      boundary: cutoverActionEvidence.boundary
    },
    checks,
    blockers: checks.filter((item) => !item.passed).map((item) => ({
      id: item.id,
      phase: item.phase,
      detail: item.detail
    })),
    boundary: "Production readiness is fail-closed. Repository software checks cannot record external registry attestation, create target-environment evidence, sign site acceptance, or authorize production cutover."
  };
}

function renderMarkdown(report) {
  const rows = report.checks.map((item) => `| ${item.passed ? "PASS" : "BLOCKED"} | ${item.phase} | ${item.id} | ${String(item.detail).replaceAll("|", "/")} |`);
  return [
    "# Production preflight report",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Release ID: ${report.releaseId}`,
    `- Source SHA: ${report.sourceSha}`,
    `- Artifact digest: ${report.artifactDigest}`,
    `- Software ready: ${report.softwareReady ? "yes" : "no"}`,
    `- Runtime configured: ${report.runtimeConfigured ? "yes" : "no"}`,
    `- Live probes ready: ${report.liveReady ? "yes" : "no"}`,
    `- External evidence ready: ${report.externalEvidenceReady ? "yes" : "no"}`,
    `- Production decision: ${report.decision}`,
    `- Production ready: ${report.productionReady ? "yes" : "no"}`,
    "",
    "## Checks",
    "",
    "| Result | Phase | Check | Detail |",
    "|---|---|---|---|",
    ...rows,
    "",
    "## Boundary",
    "",
    report.boundary,
    ""
  ].join("\n");
}

function writeOutput(report, options = {}) {
  const output = path.resolve(options.output || DEFAULT_OUTPUT);
  const markdown = path.resolve(options.markdown || DEFAULT_MARKDOWN);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2), "utf8");
  fs.mkdirSync(path.dirname(markdown), { recursive: true });
  fs.writeFileSync(markdown, renderMarkdown(report), "utf8");
}

function parseArgs(argv = process.argv.slice(2)) {
  const flags = {};
  argv.forEach((arg) => {
    if (!arg.startsWith("--")) return;
    const [key, ...rest] = arg.slice(2).split("=");
    flags[key] = rest.length ? rest.join("=") : true;
  });
  return flags;
}

async function runCli() {
  const flags = parseArgs();
  const report = await buildProductionPreflight({
    packagePath: flags.package,
    registryPath: flags.registry,
    envFile: flags["config-env"] || flags["env-file"] || ".env.example",
    baseUrl: flags["base-url"],
    evidenceDir: flags["evidence-dir"]
  });
  writeOutput(report, { output: flags.output, markdown: flags.markdown });
  console.log(JSON.stringify(report, null, 2));
  if (!report.softwareReady || (flags.strict === true && !report.productionReady)) process.exitCode = 1;
}

if (require.main === module) {
  runCli().catch(() => {
    console.error(JSON.stringify({
      code: "PRODUCTION_PREFLIGHT_FAILED_CLOSED",
      message: "production preflight failed closed"
    }));
    process.exitCode = 1;
  });
}

module.exports = {
  buildProductionPreflight,
  deploymentBindingChecks,
  evidenceBoundToRelease,
  loadProductionEvidence,
  parseArgs,
  renderMarkdown,
  resolveProductionEvidenceTrustProvider,
  verifyExternalTrust,
  writeOutput
};
