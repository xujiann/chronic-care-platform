"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  buildProductionDeploymentPackage,
  verifyProductionDeploymentPackage
} = require("../scripts/production-deployment-package");
const { GATE_DEFINITIONS } = require("../scripts/production-release-evidence-readiness");
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
