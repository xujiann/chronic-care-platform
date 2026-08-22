"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  buildProductionDeploymentPackage,
  verifyProductionDeploymentPackage
} = require("../scripts/production-deployment-package");
const { GATE_DEFINITIONS } = require("../scripts/production-release-evidence-readiness");
const {
  EVIDENCE_SCHEMA,
  loadRegister: loadCutoverActionRegister
} = require("../scripts/production-cutover-action-register");
const { emptyRegistry } = require("../scripts/release-registry");
const {
  buildProductionPreflight,
  deploymentBindingChecks,
  evidenceBoundToRelease,
  parseArgs,
  renderMarkdown
} = require("../scripts/production-preflight");

const ROOT = path.resolve(__dirname, "..");

function manifestFixture() {
  return buildProductionDeploymentPackage({
    root: ROOT,
    source: { commit: "c".repeat(40), dirty: false },
    releaseId: "preflight-001"
  });
}

function registryFixture(manifest, overrides = {}) {
  const registry = emptyRegistry();
  registry.entries = [{
    sequence: 1,
    releaseId: manifest.releaseId,
    sourceSha: manifest.source.commit,
    sourceDirty: false,
    source: {
      commit: manifest.source.commit,
      dirty: false
    },
    artifactDigest: manifest.artifact.digest,
    backup: {
      directory: "data/backups/test",
      manifestSha256: "a".repeat(64),
      dataQualityPassed: true,
      files: []
    },
    externalAttestation: {
      required: true,
      recorded: false,
      evidenceRef: "",
      evidenceDigest: "",
      recordedAt: "",
      recordedBy: ""
    },
    ...overrides
  }];
  return registry;
}

function envFixture(manifest) {
  return {
    DEPLOYMENT_SECRET_PROVIDER: "vault",
    DEPLOYMENT_RELEASE_ID: manifest.releaseId,
    DEPLOYMENT_ARTIFACT_DIGEST: manifest.artifact.digest,
    DEPLOYMENT_BASE_URL: "https://health.example.gov.cn",
    DEPLOYMENT_APP_DIR: "/opt/chronic-care-platform/releases/preflight-001",
    DEPLOYMENT_SECRET_ENV_FILE: "/run/secrets/chronic-care-platform.env",
    DEPLOYMENT_DATA_DIR: "/var/lib/chronic-care-platform",
    DEPLOYMENT_LOG_DIR: "/var/log/chronic-care-platform"
  };
}

function passingSoftwareOptions(manifest, registry) {
  return {
    root: ROOT,
    manifest,
    registry,
    env: envFixture(manifest),
    packageVerification: verifyProductionDeploymentPackage(manifest, { root: ROOT }),
    registryVerification: {
      ok: true,
      entries: 1,
      checks: [
        { id: "registry:unique-baseline", passed: true },
        { id: "registry:deployment-package-binding", passed: true }
      ]
    },
    productionConfig: {
      passed: true,
      checks: [{ name: "env:fixture", passed: true, severity: "error", category: "environment" }]
    },
    auditDeliveryAssessment: {
      ready: true,
      productionReady: true,
      checks: [{ id: "audit-delivery:test-fixture", passed: true }],
      boundary: "test fixture only"
    },
    followupDispatchAssessment: {
      configured: true,
      productionReady: true,
      checks: [{ id: "followup-dispatch:test-fixture", passed: true }]
    },
    launchSmoke: {
      ok: true,
      baseUrl: "https://health.example.gov.cn",
      summary: { total: 2, passed: 2, failed: 0, liveChecks: 2 },
      checks: [
        { id: "live:liveness", category: "live", passed: true, detail: "HTTP 200" },
        { id: "live:health", category: "live", passed: true, detail: "HTTP 200" }
      ]
    }
  };
}

function verifiedCutoverActionOptions(manifest) {
  const register = loadCutoverActionRegister();
  const actions = [...register.cutoverActions, ...register.evidenceActions];
  return {
    now: "2026-08-23T08:00:00.000Z",
    cutoverActionRegister: register,
    cutoverActionEvidenceRecords: Object.fromEntries(actions.map((action) => [action.id, { opaque: action.id }])),
    externalActionEvidenceVerifier: async ({ action }) => ({
      schemaVersion: EVIDENCE_SCHEMA,
      verified: true,
      decisionId: `decision-${action.id}`,
      actionId: action.id,
      releaseId: manifest.releaseId,
      artifactDigest: manifest.artifact.digest,
      previousState: "evidence-submitted",
      effectiveState: "verified",
      previousTransitionDigest: `sha256:${"b".repeat(64)}`,
      evidenceRef: `controlled://cutover/${action.id}`,
      evidenceDigest: `sha256:${"c".repeat(64)}`,
      evidenceFingerprint: `sha256:${"d".repeat(64)}`,
      commandReceiptDigest: `sha256:${"e".repeat(64)}`,
      envelopeDigest: `sha256:${"f".repeat(64)}`,
      verifiedAt: "2026-08-23T07:00:00.000Z",
      validUntil: "2026-08-23T09:00:00.000Z",
      evidenceProducerRole: "site-evidence-custodian",
      verifierRole: "independent-release-verifier",
      signerIds: [`custodian:${action.id}`, `verifier:${action.id}`]
    })
  };
}

test("production preflight is fail-closed when controlled production evidence is absent", async () => {
  const manifest = manifestFixture();
  const registry = registryFixture(manifest);
  const report = await buildProductionPreflight({
    ...passingSoftwareOptions(manifest, registry),
    formalApproval: true,
    productionEvidence: {
      ok: false,
      status: "no-go-evidence-incomplete",
      evidenceFingerprint: ""
    },
    evidenceRecords: {}
  });

  assert.equal(report.softwareReady, true);
  assert.equal(report.runtimeConfigured, true);
  assert.equal(report.liveReady, true);
  assert.equal(report.externalEvidenceReady, false);
  assert.equal(report.productionReady, false);
  assert.equal(report.ok, false);
  assert.equal(report.status, "production-blocked");
  assert.equal(report.decision, "NO-GO");
  assert.equal(report.blockers.some((item) => item.id === "preflight:external-registry-attestation"), true);
  assert.equal(report.blockers.some((item) => item.id === "preflight:production-evidence-validation"), true);
  assert.match(renderMarkdown(report), /Production decision: NO-GO/);
});

test("legacy audit retention variables cannot substitute for continuous audit deployment readiness", async () => {
  const manifest = manifestFixture();
  const registry = registryFixture(manifest);
  const options = passingSoftwareOptions(manifest, registry);
  delete options.auditDeliveryAssessment;
  options.env = {
    ...options.env,
    AUDIT_EXPORT_PATH: "/var/log/chronic-care-platform/audit",
    SIEM_ENDPOINT: "https://siem.example.gov.cn/ingest",
    SIEM_SIGNING_SECRET: "a".repeat(32)
  };
  const report = await buildProductionPreflight({
    ...options,
    productionEvidence: { ok: false, status: "no-go-evidence-incomplete" },
    evidenceRecords: {}
  });

  assert.equal(report.runtimeConfigured, false);
  assert.equal(report.productionReady, false);
  assert.equal(report.checks.some((item) => item.id === "preflight:audit-delivery" && !item.passed), true);
});

test("durable followup worker remains NO-GO without real activation and receipt trust", async () => {
  const manifest = manifestFixture();
  const registry = registryFixture(manifest);
  const options = passingSoftwareOptions(manifest, registry);
  delete options.followupDispatchAssessment;
  options.env = {
    ...options.env,
    NODE_ENV: "production",
    CITIZEN_CHRONIC_FOLLOWUP_DISPATCH_SQLITE_FILE: "/var/lib/chronic-care-platform/health-city.sqlite",
    CITIZEN_CHRONIC_FOLLOWUP_DISPATCH_WORKER_ID: "chronic-followup-worker",
    CITIZEN_CHRONIC_FOLLOWUP_PUBLISHER_URL: "https://followup.example.gov.cn/events",
    CITIZEN_CHRONIC_FOLLOWUP_PUBLISHER_HMAC_SECRET: "a".repeat(32)
  };
  const report = await buildProductionPreflight({
    ...options,
    productionEvidence: { ok: false, status: "no-go-evidence-incomplete" },
    evidenceRecords: {}
  });
  assert.equal(report.followupDispatchAssessment.configured, false);
  assert.equal(report.followupDispatchAssessment.productionReady, false);
  assert.equal(report.checks.some((item) => item.id === "preflight:chronic-followup-dispatch" && !item.passed), true);
  assert.equal(report.decision, "NO-GO");
});

test("externally verified release-bound evidence can open the durable followup runtime gate without a code change", async () => {
  const manifest = manifestFixture();
  const registry = registryFixture(manifest, {
    externalAttestation: {
      required: true,
      recorded: true,
      evidenceRef: "controlled://registry/preflight-001",
      evidenceDigest: `sha256:${"e".repeat(64)}`,
      recordedAt: "2026-08-22T08:00:00.000Z",
      recordedBy: "external-release-verifier"
    }
  });
  const options = passingSoftwareOptions(manifest, registry);
  delete options.followupDispatchAssessment;
  options.env = {
    ...options.env,
    NODE_ENV: "production",
    CITIZEN_CHRONIC_FOLLOWUP_DISPATCH_SQLITE_FILE: "/var/lib/chronic-care-platform/health-city.sqlite",
    CITIZEN_CHRONIC_FOLLOWUP_DISPATCH_WORKER_ID: "chronic-followup-worker",
    CITIZEN_CHRONIC_FOLLOWUP_PUBLISHER_URL: "https://followup.example.gov.cn/events",
    CITIZEN_CHRONIC_FOLLOWUP_PUBLISHER_HMAC_SECRET: "a".repeat(32)
  };
  const records = Object.fromEntries(GATE_DEFINITIONS.map((definition) => [
    definition.file,
    { releaseId: manifest.releaseId, artifactDigest: manifest.artifact.digest }
  ]));
  const evidence = {
    ok: true,
    status: "go-decision-evidence-validated",
    evidenceFingerprint: "externally-verified-test-fixture"
  };
  const externalTrustVerifier = async () => ({
    registryAttestationVerified: true,
    productionEvidenceVerified: true,
    detail: "verified outside repository"
  });
  const report = await buildProductionPreflight({
    ...options,
    ...verifiedCutoverActionOptions(manifest),
    followupActivationProvider: { configured: true, productionReady: false },
    productionEvidence: evidence,
    evidenceRecords: records,
    externalTrustVerifier
  });
  assert.equal(report.followupDispatchAssessment.configured, true);
  assert.equal(report.followupDispatchAssessment.externalEvidenceVerified, true);
  assert.equal(report.followupDispatchAssessment.productionReady, true);
  assert.equal(report.checks.find((item) => item.id === "preflight:chronic-followup-dispatch").passed, true);
  assert.equal(report.productionReady, true);

  records[GATE_DEFINITIONS[0].file] = {
    releaseId: "different-release",
    artifactDigest: manifest.artifact.digest
  };
  const drifted = await buildProductionPreflight({
    ...options,
    ...verifiedCutoverActionOptions(manifest),
    followupActivationProvider: { configured: true, productionReady: false },
    productionEvidence: evidence,
    evidenceRecords: records,
    externalTrustVerifier
  });
  assert.equal(drifted.followupDispatchAssessment.configured, true);
  assert.equal(drifted.followupDispatchAssessment.externalEvidenceVerified, false);
  assert.equal(drifted.followupDispatchAssessment.productionReady, false);
  assert.equal(drifted.productionReady, false);
});

test("production preflight recognizes the exact append-only source contract without lifting external gates", async () => {
  const manifest = manifestFixture();
  const registry = registryFixture(manifest);
  const options = passingSoftwareOptions(manifest, registry);
  delete options.auditDeliveryAssessment;
  options.checkFilesystem = false;
  options.env = {
    ...options.env,
    NODE_ENV: "staging",
    AUDIT_WORM_DIRECTORY: path.resolve("C:/health-data/audit-worm"),
    AUDIT_DELIVERY_CHECKPOINT_PATH: path.resolve("C:/health-data/audit-state/checkpoint.json"),
    AUDIT_DELIVERY_SOURCE_CONTRACT: "append-only-audit-source-v2",
    AUDIT_DELIVERY_SERVICE_USER: "health-audit",
    AUDIT_DELIVERY_SERVICE_GROUP: "health-audit"
  };
  const report = await buildProductionPreflight({
    ...options,
    productionEvidence: { ok: false, status: "no-go-evidence-incomplete" },
    evidenceRecords: {}
  });

  assert.equal(report.auditDeliveryAssessment.checks.some((item) => item.id === "audit-delivery:source-continuity" && item.passed), true);
  assert.equal(report.auditDeliveryAssessment.productionReady, false);
  assert.equal(report.productionReady, false);
});

test("a claimed evidence result remains blocked when release id or artifact digest drifts", async () => {
  const manifest = manifestFixture();
  const registry = registryFixture(manifest, {
    externalAttestation: {
      required: true,
      recorded: true,
      evidenceRef: "controlled://registry/preflight-001",
      evidenceDigest: `sha256:${"e".repeat(64)}`,
      recordedAt: "2026-08-03T08:00:00.000Z",
      recordedBy: "release-operator"
    }
  });
  const records = Object.fromEntries(GATE_DEFINITIONS.map((definition) => [
    definition.file,
    { releaseId: "different-release", artifactDigest: manifest.artifact.digest }
  ]));
  const report = await buildProductionPreflight({
    ...passingSoftwareOptions(manifest, registry),
    productionEvidence: {
      ok: true,
      status: "go-decision-evidence-validated",
      evidenceFingerprint: "synthetic-test-only"
    },
    evidenceRecords: records
  });

  assert.equal(report.productionEvidence.ok, true);
  assert.equal(report.productionEvidence.releaseBound, false);
  assert.equal(report.externalEvidenceReady, false);
  assert.equal(report.productionReady, false);
  assert.equal(report.checks.find((item) => item.id === "preflight:production-evidence-release-binding").passed, false);
});

test("well-shaped local evidence cannot replace an external trust verifier", async () => {
  const manifest = manifestFixture();
  const registry = registryFixture(manifest, {
    externalAttestation: {
      required: true,
      recorded: true,
      evidenceRef: "controlled://registry/preflight-001",
      evidenceDigest: `sha256:${"e".repeat(64)}`,
      recordedAt: "2026-08-03T08:00:00.000Z",
      recordedBy: "release-operator"
    }
  });
  const records = Object.fromEntries(GATE_DEFINITIONS.map((definition) => [
    definition.file,
    { releaseId: manifest.releaseId, artifactDigest: manifest.artifact.digest }
  ]));
  const report = await buildProductionPreflight({
    ...passingSoftwareOptions(manifest, registry),
    productionEvidence: {
      ok: true,
      status: "go-decision-evidence-validated",
      evidenceFingerprint: "locally-shaped-evidence"
    },
    evidenceRecords: records
  });

  assert.equal(report.productionEvidence.releaseBound, true);
  assert.equal(report.productionEvidence.externallyVerified, false);
  assert.equal(report.externalEvidenceReady, false);
  assert.equal(report.productionReady, false);
  assert.equal(
    report.checks.find((item) => item.id === "preflight:external-registry-attestation").detail,
    "external trust verifier is not configured"
  );
});

test("production preflight rejects a registry entry detached from the deployment package source", async () => {
  const manifest = manifestFixture();
  const registry = registryFixture(manifest, { sourceSha: "d".repeat(40) });
  const options = passingSoftwareOptions(manifest, registry);
  options.registryVerification = {
    ok: false,
    entries: 1,
    checks: [
      { id: "registry:unique-baseline", passed: true },
      { id: "registry:deployment-package-binding", passed: false }
    ]
  };
  const report = await buildProductionPreflight({
    ...options,
    productionEvidence: { ok: false, status: "no-go-evidence-incomplete" },
    evidenceRecords: {}
  });
  assert.equal(report.softwareReady, false);
  assert.equal(report.productionReady, false);
  assert.equal(report.checks.find((item) => item.id === "preflight:release-package-binding").passed, false);
});

test("deployment bindings require exact release digest and HTTPS target", () => {
  const manifest = manifestFixture();
  const good = deploymentBindingChecks(envFixture(manifest), manifest);
  assert.equal(good.every((item) => item.passed), true);
  const bad = deploymentBindingChecks({
    ...envFixture(manifest),
    DEPLOYMENT_ARTIFACT_DIGEST: `sha256:${"0".repeat(64)}`,
    DEPLOYMENT_BASE_URL: "http://health.example.gov.cn"
  }, manifest);
  assert.equal(bad.some((item) => item.id === "preflight:artifact-digest-binding" && !item.passed), true);
  assert.equal(bad.some((item) => item.id === "preflight:base-url" && !item.passed), true);
  assert.deepEqual(parseArgs(["--strict", "--base-url=https://health.example.gov.cn"]), {
    strict: true,
    "base-url": "https://health.example.gov.cn"
  });
});

test("release evidence binding requires every governed gate to match the current package", () => {
  const manifest = manifestFixture();
  const records = Object.fromEntries(GATE_DEFINITIONS.map((definition) => [
    definition.file,
    { releaseId: manifest.releaseId, artifactDigest: manifest.artifact.digest }
  ]));
  assert.equal(evidenceBoundToRelease(records, manifest), true);
  records[GATE_DEFINITIONS[0].file].artifactDigest = `sha256:${"f".repeat(64)}`;
  assert.equal(evidenceBoundToRelease(records, manifest), false);
});
