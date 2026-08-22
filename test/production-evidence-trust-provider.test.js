"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { generateKeyPairSync, sign } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { stableStringify } = require("../src/platform/governance/technical-evidence");
const { GATE_DEFINITIONS } = require("../scripts/production-release-evidence-readiness");
const {
  MAX_TRUST_FILE_BYTES,
  PRODUCTION_DECISION_SCHEMA,
  PRODUCTION_EVIDENCE_PURPOSE,
  SIGNED_ENVELOPE_SCHEMA,
  TRUST_ANCHORS_SCHEMA,
  createFileBackedProductionEvidenceTrustVerifier,
  createProductionTrustContextBinding,
  inspectProductionEvidenceTrustProvider,
  loadTrustMaterial,
  productionEvidenceTrustConfig,
  sha256Bytes,
  signedEnvelopeSignaturePayload,
  verifySignedEnvelope
} = require("../src/platform/governance/production-evidence-trust-provider");
const {
  buildProductionPreflight,
  resolveProductionEvidenceTrustProvider
} = require("../scripts/production-preflight");

const NOW = "2026-08-23T08:00:00.000Z";

function createFixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "production-evidence-trust-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const releaseKey = generateKeyPairSync("ed25519");
  const securityKey = generateKeyPairSync("ed25519");
  const keyRows = [
    {
      keyId: "release-key-001",
      signerId: "release-verifier-001",
      role: "release-verifier",
      pair: releaseKey
    },
    {
      keyId: "security-key-001",
      signerId: "security-verifier-001",
      role: "security-verifier",
      pair: securityKey
    }
  ];
  const manifest = {
    ok: true,
    releaseId: "release-20260823-001",
    source: { commit: "a".repeat(40), dirty: false },
    artifact: { digest: `sha256:${"b".repeat(64)}` },
    rollbackContract: { requirePreviousArtifactDigest: true, requireStorageBackup: true }
  };
  const registryEntry = {
    releaseId: manifest.releaseId,
    sourceSha: manifest.source.commit,
    sourceDirty: false,
    source: manifest.source,
    artifactDigest: manifest.artifact.digest,
    backup: {
      directory: "controlled-backup-001",
      manifestSha256: "e".repeat(64),
      dataQualityPassed: true,
      files: []
    },
    externalAttestation: {
      required: true,
      recorded: true,
      evidenceRef: "controlled://registry/release-20260823-001",
      evidenceDigest: `sha256:${"c".repeat(64)}`,
      recordedAt: "2026-08-23T07:00:00.000Z",
      recordedBy: "external-release-verifier"
    }
  };
  const context = {
    manifest,
    registryEntry,
    productionEvidence: {
      ok: true,
      status: "go-decision-evidence-validated",
      evidenceFingerprint: "d".repeat(64)
    },
    evidenceRecords: Object.fromEntries(GATE_DEFINITIONS.map((definition) => [definition.file, {
        releaseId: manifest.releaseId,
        artifactDigest: manifest.artifact.digest,
        evidenceId: `${definition.id}-001`
      }]))
  };
  const anchorsFile = path.join(directory, "anchors.json");
  const envelopeFile = path.join(directory, "envelope.json");

  function anchorsDocument(overrides = {}) {
    return {
      schema: TRUST_ANCHORS_SCHEMA,
      generatedAt: "2026-08-23T06:00:00.000Z",
      keys: keyRows.map((row, index) => ({
        keyId: row.keyId,
        signerId: row.signerId,
        roles: [row.role],
        algorithm: "Ed25519",
        status: overrides.statuses?.[index] || "active",
        validFrom: "2026-08-22T00:00:00.000Z",
        validUntil: "2026-09-23T00:00:00.000Z",
        publicKeyPem: row.pair.publicKey.export({ type: "spki", format: "pem" }),
        publicKeyDigest: sha256Bytes(row.pair.publicKey.export({ type: "spki", format: "der" }))
      }))
    };
  }

  function decisionRecord(overrides = {}) {
    return {
      ...createProductionTrustContextBinding(context),
      decisionId: "production-decision-001",
      issuedAt: "2026-08-23T07:30:00.000Z",
      validUntil: "2026-08-23T09:00:00.000Z",
      ...overrides
    };
  }

  function signedEnvelope(record = decisionRecord(), signatureOverrides = {}) {
    const envelope = {
      schema: SIGNED_ENVELOPE_SCHEMA,
      purpose: PRODUCTION_EVIDENCE_PURPOSE,
      record,
      signatures: []
    };
    envelope.signatures = keyRows.map((row, index) => {
      const descriptor = {
        keyId: signatureOverrides.keyIds?.[index] || row.keyId,
        signerId: signatureOverrides.signerIds?.[index] || row.signerId,
        role: signatureOverrides.roles?.[index] || row.role
      };
      return {
        ...descriptor,
        signature: sign(
          null,
          Buffer.from(stableStringify(signedEnvelopeSignaturePayload(envelope, descriptor))),
          row.pair.privateKey
        ).toString("base64url")
      };
    });
    return envelope;
  }

  function writeMaterial(options = {}) {
    const anchors = options.anchors || anchorsDocument();
    const envelope = options.envelope || signedEnvelope();
    const anchorsBytes = Buffer.from(`${JSON.stringify(anchors, null, 2)}\n`);
    fs.writeFileSync(anchorsFile, anchorsBytes);
    fs.writeFileSync(envelopeFile, `${JSON.stringify(envelope, null, 2)}\n`);
    return {
      PRODUCTION_EVIDENCE_TRUST_ANCHORS_FILE: anchorsFile,
      PRODUCTION_EVIDENCE_TRUST_ANCHORS_SHA256: sha256Bytes(anchorsBytes),
      PRODUCTION_EVIDENCE_TRUST_ENVELOPE_FILE: envelopeFile
    };
  }

  return {
    anchorsDocument,
    anchorsFile,
    context,
    decisionRecord,
    envelopeFile,
    signedEnvelope,
    writeMaterial
  };
}

test("controlled Ed25519 envelope verifies exact release evidence and the preflight resolver assembles it", async (t) => {
  const fixture = createFixture(t);
  const env = fixture.writeMaterial();
  const inspection = inspectProductionEvidenceTrustProvider(env, { now: NOW });
  assert.equal(inspection.configured, true);
  assert.equal(inspection.productionReady, false);
  assert.deepEqual(inspection.roles, ["release-verifier", "security-verifier"]);

  const verifier = createFileBackedProductionEvidenceTrustVerifier({ env, now: NOW });
  const verified = await verifier(fixture.context);
  assert.equal(verified.registryAttestationVerified, true);
  assert.equal(verified.productionEvidenceVerified, true);
  assert.equal(verified.verification.signerCount, 2);

  const resolved = resolveProductionEvidenceTrustProvider(env, { now: NOW });
  assert.equal(resolved.inspection.configured, true);
  assert.equal(resolved.source, "controlled-files");
  assert.equal((await resolved.verifier(fixture.context)).productionEvidenceVerified, true);
});

test("production preflight uses the controlled provider without test-only verifier injection and remains blocked by other gates", async (t) => {
  const fixture = createFixture(t);
  const trustEnv = fixture.writeMaterial();
  const env = {
    ...trustEnv,
    DEPLOYMENT_SECRET_PROVIDER: "vault",
    DEPLOYMENT_RELEASE_ID: fixture.context.manifest.releaseId,
    DEPLOYMENT_ARTIFACT_DIGEST: fixture.context.manifest.artifact.digest,
    DEPLOYMENT_BASE_URL: "https://health.example.gov.cn",
    DEPLOYMENT_APP_DIR: "/opt/chronic-care-platform/releases/release-20260823-001",
    DEPLOYMENT_SECRET_ENV_FILE: "/run/secrets/chronic-care-platform.env",
    DEPLOYMENT_DATA_DIR: "/var/lib/chronic-care-platform",
    DEPLOYMENT_LOG_DIR: "/var/log/chronic-care-platform"
  };
  const report = await buildProductionPreflight({
    manifest: fixture.context.manifest,
    registry: {
      integrationBaseline: { tag: "baseline-test", commit: fixture.context.manifest.source.commit },
      entries: [fixture.context.registryEntry]
    },
    env,
    now: NOW,
    packageVerification: { ok: true, checks: [{ id: "package:test", passed: true }] },
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
      checks: [{ id: "config:test", passed: true, severity: "error", category: "environment" }]
    },
    auditDeliveryAssessment: {
      ready: true,
      productionReady: false,
      checks: [{ id: "audit:external-receipt-missing", passed: false }]
    },
    followupDispatchAssessment: {
      configured: true,
      productionReady: true,
      checks: [{ id: "followup:test", passed: true }]
    },
    launchSmoke: {
      ok: true,
      baseUrl: "https://health.example.gov.cn",
      summary: { total: 2, passed: 2, failed: 0, liveChecks: 2 },
      checks: [
        { id: "live:liveness", category: "live", passed: true, detail: "HTTP 200" },
        { id: "live:health", category: "live", passed: true, detail: "HTTP 200" }
      ]
    },
    productionEvidence: fixture.context.productionEvidence,
    evidenceRecords: fixture.context.evidenceRecords
  });
  assert.equal(report.productionEvidenceTrustProvider.source, "controlled-files");
  assert.equal(report.productionEvidenceTrustProvider.verified, true);
  assert.equal(report.productionEvidenceTrustProvider.productionReady, true);
  assert.equal(report.externalEvidenceReady, false);
  assert.equal(report.cutoverActionEvidence.productionReady, false);
  assert.equal(report.blockers.some((item) => item.id === "preflight:cutover-action-evidence"), true);
  assert.equal(report.productionReady, false);
  assert.equal(report.decision, "NO-GO");
});

test("generic envelope verifier is reusable while release, artifact and evidence drift fail closed", async (t) => {
  const fixture = createFixture(t);
  const env = fixture.writeMaterial();
  const verifier = createFileBackedProductionEvidenceTrustVerifier({ env, now: NOW });
  for (const contextMutation of [
    (context) => { context.manifest.releaseId = "different-release"; },
    (context) => { context.manifest.artifact.digest = `sha256:${"e".repeat(64)}`; },
    (context) => { context.productionEvidence.evidenceFingerprint = "f".repeat(64); },
    (context) => { context.evidenceRecords["go-no-go.json"].evidenceId = "changed-go-no-go"; }
  ]) {
    const changed = structuredClone(fixture.context);
    contextMutation(changed);
    await assert.rejects(verifier(changed), (error) => error.code === "PRODUCTION_EVIDENCE_TRUST_CONTEXT_MISMATCH");
  }

  const material = loadTrustMaterial(productionEvidenceTrustConfig(env));
  const generic = verifySignedEnvelope({
    envelope: material.envelope,
    anchors: material.anchors,
    expectedPurpose: PRODUCTION_EVIDENCE_PURPOSE,
    requiredRoles: ["release-verifier", "security-verifier"],
    expectedRecord: createProductionTrustContextBinding(fixture.context),
    now: NOW,
    validateRecord(record) {
      assert.equal(record.schema, PRODUCTION_DECISION_SCHEMA);
    }
  });
  assert.equal(generic.signerIds.length, 2);
});

test("stale, future, duplicate-signer and revoked-key decisions are rejected", async (t) => {
  const cases = [
    {
      expected: "PRODUCTION_EVIDENCE_TRUST_DECISION_EXPIRED",
      build(fixture) {
        return { envelope: fixture.signedEnvelope(fixture.decisionRecord({ validUntil: "2026-08-23T07:59:59.000Z" })) };
      }
    },
    {
      expected: "PRODUCTION_EVIDENCE_TRUST_DECISION_EXPIRED",
      build(fixture) {
        return { envelope: fixture.signedEnvelope(fixture.decisionRecord({ issuedAt: "2026-08-23T08:06:00.000Z", validUntil: "2026-08-23T09:00:00.000Z" })) };
      }
    },
    {
      expected: "PRODUCTION_EVIDENCE_TRUST_SIGNATURE_INVALID",
      build(fixture) {
        return { envelope: fixture.signedEnvelope(undefined, { signerIds: ["release-verifier-001", "release-verifier-001"] }) };
      }
    },
    {
      expected: "PRODUCTION_EVIDENCE_TRUST_KEY_REVOKED",
      build(fixture) {
        return { anchors: fixture.anchorsDocument({ statuses: ["active", "revoked"] }) };
      }
    }
  ];
  for (const scenario of cases) {
    const fixture = createFixture(t);
    const env = fixture.writeMaterial(scenario.build(fixture));
    const verifier = createFileBackedProductionEvidenceTrustVerifier({ env, now: NOW });
    await assert.rejects(verifier(fixture.context), (error) => error.code === scenario.expected);
  }
});

test("anchor pin drift, relative paths, oversized files and symlinks remain unavailable without path disclosure", (t) => {
  const fixture = createFixture(t);
  const env = fixture.writeMaterial();
  const pinDrift = inspectProductionEvidenceTrustProvider({
    ...env,
    PRODUCTION_EVIDENCE_TRUST_ANCHORS_SHA256: `sha256:${"0".repeat(64)}`
  }, { now: NOW });
  assert.equal(pinDrift.configured, false);
  assert.equal(pinDrift.reasonCode, "PRODUCTION_EVIDENCE_TRUST_ANCHORS_DIGEST_MISMATCH");
  assert.doesNotMatch(pinDrift.detail, /production-evidence-trust-|anchors\.json/i);

  const relative = inspectProductionEvidenceTrustProvider({
    ...env,
    PRODUCTION_EVIDENCE_TRUST_ANCHORS_FILE: "anchors.json"
  }, { now: NOW });
  assert.equal(relative.reasonCode, "PRODUCTION_EVIDENCE_TRUST_ABSOLUTE_PATH_REQUIRED");

  fs.writeFileSync(fixture.anchorsFile, Buffer.alloc(MAX_TRUST_FILE_BYTES + 1, 0x20));
  const oversized = inspectProductionEvidenceTrustProvider({
    ...env,
    PRODUCTION_EVIDENCE_TRUST_ANCHORS_SHA256: sha256Bytes(fs.readFileSync(fixture.anchorsFile))
  }, { now: NOW });
  assert.equal(oversized.reasonCode, "PRODUCTION_EVIDENCE_TRUST_FILE_TOO_LARGE");

  const restoredEnv = fixture.writeMaterial();

  const symlink = path.join(path.dirname(fixture.envelopeFile), "envelope-link.json");
  try {
    fs.symlinkSync(fixture.envelopeFile, symlink, "file");
  } catch (error) {
    if (error.code === "EPERM" || error.code === "EACCES") return;
    throw error;
  }
  const linked = inspectProductionEvidenceTrustProvider({
    ...restoredEnv,
    PRODUCTION_EVIDENCE_TRUST_ENVELOPE_FILE: symlink
  }, { now: NOW });
  assert.equal(linked.configured, false);
  assert.equal(linked.reasonCode, "PRODUCTION_EVIDENCE_TRUST_FILE_INVALID");
});

test("production preflight CLI suppresses provider and filesystem failure details", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "production-preflight-failure-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const missingPackage = path.join(directory, "sensitive-release-location.json");
  const run = spawnSync(process.execPath, [
    path.join(__dirname, "..", "scripts", "production-preflight.js"),
    "--package",
    missingPackage,
    "--strict"
  ], { encoding: "utf8" });
  assert.equal(run.status, 1);
  assert.equal(run.stdout, "");
  assert.match(run.stderr, /PRODUCTION_PREFLIGHT_FAILED_CLOSED/);
  assert.doesNotMatch(run.stderr, /sensitive-release-location|production-preflight-failure-/);
});
