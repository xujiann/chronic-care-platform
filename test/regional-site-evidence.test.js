"use strict";

const assert = require("node:assert/strict");
const { generateKeyPairSync, sign } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  EVIDENCE_SCOPES,
  assessRegionalSiteEvidenceManifest,
  buildRegionalSiteEvidencePortfolio,
  buildRegionalSiteEvidenceStatus,
  environmentKeys,
  readRegionalSiteEvidenceFile,
  validateManifestStructure
} = require("../src/platform/regional/regional-site-evidence");
const {
  createAttestationSubject,
  readTrustRegistryFile,
  trustEnvironmentKeys,
  validateTrustRegistry
} = require("../src/platform/regional/regional-site-evidence-trust");
const { sha256, stableJson } = require("../src/platform/regional/region-manifest");
const {
  buildReport,
  parseArgs,
  renderMarkdown,
  writeReport
} = require("../scripts/regional-site-evidence-readiness");

const SHA_A = `sha256:${"a".repeat(64)}`;
const SHA_B = `sha256:${"b".repeat(64)}`;
const SHA_C = `sha256:${"c".repeat(64)}`;
const REGION = "123456";
const NOW = "2026-08-14T08:00:00.000Z";
const KEY_PAIRS = Object.freeze({
  custodian: generateKeyPairSync("ed25519"),
  reviewer: generateKeyPairSync("ed25519")
});

function expected(overrides = {}) {
  return {
    regionCode: REGION,
    releaseId: "regional-release-1",
    compositeDigest: SHA_A,
    regionalContentDigest: SHA_B,
    ...overrides
  };
}

function manifest(overrides = {}) {
  return {
    schemaVersion: "regional-site-evidence-v1",
    regionCode: REGION,
    releaseId: "regional-release-1",
    compositeDigest: SHA_A,
    regionalContentDigest: SHA_B,
    issuedAt: "2026-08-13T08:00:00.000Z",
    expiresAt: "2026-09-13T08:00:00.000Z",
    evidence: EVIDENCE_SCOPES.map((scope, index) => ({
      scope,
      ref: `controlled://regional/site-evidence/package-${index + 1}`,
      digest: SHA_C,
      subjectDigest: SHA_A,
      verifiedAt: "2026-08-13T09:00:00.000Z",
      expiresAt: "2026-09-13T08:00:00.000Z",
      custodianRole: `custodian-${index + 1}`,
      reviewerRole: `reviewer-${index + 1}`
    })),
    ...overrides
  };
}

function trustRegistry(overrides = {}) {
  const key = (role, principalId, state = "active") => ({
    keyId: `${role}-key-2026`,
    principalId,
    role,
    algorithm: "Ed25519",
    state,
    regionCodes: [REGION],
    scopes: [...EVIDENCE_SCOPES],
    validFrom: "2026-08-01T00:00:00.000Z",
    validUntil: "2026-10-01T00:00:00.000Z",
    publicKeyPem: KEY_PAIRS[role].publicKey.export({ type: "spki", format: "pem" })
  });
  return {
    schemaVersion: "regional-site-evidence-trust-registry-v1",
    generatedAt: "2026-08-14T07:00:00.000Z",
    purpose: "regional-site-evidence",
    keys: [
      key("custodian", "principal:site-custodian"),
      key("reviewer", "principal:independent-reviewer")
    ],
    ...overrides
  };
}

function signedManifest(overrides = {}) {
  const result = {
    schemaVersion: "regional-site-evidence-v2",
    regionCode: REGION,
    releaseId: "regional-release-1",
    compositeDigest: SHA_A,
    regionalContentDigest: SHA_B,
    issuedAt: "2026-08-13T08:00:00.000Z",
    expiresAt: "2026-09-13T08:00:00.000Z",
    evidence: EVIDENCE_SCOPES.map((scope, index) => ({
      scope,
      ref: `controlled://regional/site-evidence/package-${index + 1}`,
      digest: SHA_C,
      subjectDigest: SHA_A,
      verifiedAt: "2026-08-13T09:00:00.000Z",
      expiresAt: "2026-09-13T08:00:00.000Z",
      attestations: []
    })),
    ...overrides
  };
  for (const item of result.evidence) {
    item.attestations = ["custodian", "reviewer"].map((role) => {
      const subject = createAttestationSubject(result, item, role);
      const subjectDigest = `sha256:${sha256(stableJson(subject))}`;
      return {
        schemaVersion: "regional-site-evidence-attestation-v1",
        purpose: "regional-site-evidence",
        role,
        keyId: `${role}-key-2026`,
        issuedAt: "2026-08-13T10:00:00.000Z",
        subjectDigest,
        signature: sign(null, Buffer.from(stableJson(subject)), KEY_PAIRS[role].privateKey).toString("base64url")
      };
    });
  }
  return result;
}

test("complete site evidence is release-bound, independently reviewed and still non-authorizing", () => {
  const status = assessRegionalSiteEvidenceManifest(signedManifest(), expected(), {
    now: NOW,
    trustRegistry: trustRegistry()
  });
  assert.equal(status.ok, true);
  assert.equal(status.evidenceReady, true);
  assert.equal(status.productionReady, false);
  assert.equal(status.binding.matches, true);
  assert.equal(status.summary.ready, EVIDENCE_SCOPES.length);
  assert.equal(status.summary.cryptographicallyTrusted, EVIDENCE_SCOPES.length);
  assert.equal(status.trust.activeSignatures, EVIDENCE_SCOPES.length * 2);
  assert.equal(status.trust.cryptographicTrustReady, true);
  assert.deepEqual(status.blockers, []);
  const serialized = JSON.stringify(status);
  assert.doesNotMatch(serialized, /controlled:\/\//);
  assert.doesNotMatch(serialized, /custodian-|reviewer-/);
  assert.doesNotMatch(serialized, /BEGIN PUBLIC KEY|key-2026|principal:/i);
  assert.equal(status.containsEvidenceBodies, false);
  assert.equal(status.containsReviewerIdentities, false);
  assert.equal(status.containsSignatures, false);
  assert.equal(status.containsKeyMaterial, false);
});

test("scope, currency, subject binding and independent review fail closed with stable blockers", () => {
  const input = manifest();
  input.evidence = input.evidence.slice(1);
  input.evidence[0] = {
    ...input.evidence[0],
    verifiedAt: "2026-08-12T08:00:00.000Z",
    expiresAt: "2026-08-14T07:59:59.000Z",
    custodianRole: "same-role",
    reviewerRole: "same-role",
    subjectDigest: SHA_B
  };
  const status = assessRegionalSiteEvidenceManifest(input, expected({ releaseId: "different-release" }), { now: NOW });
  assert.equal(status.evidenceReady, false);
  assert.ok(status.blockers.includes("regional-site-evidence-binding-mismatch"));
  assert.ok(status.blockers.includes("regional-site-evidence-identity-and-institution-missing-or-duplicate"));
  assert.ok(status.blockers.includes("regional-site-evidence-hospital-joint-test-not-current"));
  assert.ok(status.blockers.includes("regional-site-evidence-hospital-joint-test-review-not-independent"));
  assert.ok(status.blockers.includes("regional-site-evidence-hospital-joint-test-subject-mismatch"));
  assert.ok(status.blockers.includes("regional-site-evidence-hospital-joint-test-timeline-invalid"));
  assert.equal(status.productionReady, false);
});

test("legacy v1 evidence remains readable but cannot open the cryptographic trust gate", () => {
  const status = assessRegionalSiteEvidenceManifest(manifest(), expected(), { now: NOW });
  assert.equal(status.ok, true);
  assert.equal(status.evidenceReady, false);
  assert.equal(status.trust.cryptographicTrustReady, false);
  assert.ok(status.blockers.includes("regional-site-evidence-legacy-unsigned"));
});

test("tampering, revoked keys and a shared signing principal fail closed", () => {
  const tampered = signedManifest();
  tampered.evidence[0].digest = SHA_B;
  const tamperedStatus = assessRegionalSiteEvidenceManifest(tampered, expected(), {
    now: NOW,
    trustRegistry: trustRegistry()
  });
  assert.equal(tamperedStatus.evidenceReady, false);
  assert.ok(tamperedStatus.blockers.includes("regional-site-evidence-identity-and-institution-signature-untrusted"));

  const revoked = trustRegistry();
  revoked.keys[1].state = "revoked";
  const revokedStatus = assessRegionalSiteEvidenceManifest(signedManifest(), expected(), {
    now: NOW,
    trustRegistry: revoked
  });
  assert.equal(revokedStatus.evidenceReady, false);
  assert.equal(revokedStatus.trust.revokedSignatures, EVIDENCE_SCOPES.length);

  const sharedPrincipal = trustRegistry();
  sharedPrincipal.keys[1].principalId = sharedPrincipal.keys[0].principalId;
  const sharedStatus = assessRegionalSiteEvidenceManifest(signedManifest(), expected(), {
    now: NOW,
    trustRegistry: sharedPrincipal
  });
  assert.equal(sharedStatus.evidenceReady, false);
  assert.ok(sharedStatus.blockers.includes("regional-site-evidence-identity-and-institution-review-not-independent"));
});

test("grace keys are accepted and surfaced only as minimized counts", () => {
  const registry = trustRegistry();
  registry.keys[1].state = "grace";
  const status = assessRegionalSiteEvidenceManifest(signedManifest(), expected(), {
    now: NOW,
    trustRegistry: registry
  });
  assert.equal(status.evidenceReady, true);
  assert.equal(status.trust.graceSignatures, EVIDENCE_SCOPES.length);
  assert.equal(status.trust.activeSignatures, EVIDENCE_SCOPES.length);
});

test("wrong purpose, scope, region, release and expired keys cannot reuse a valid signature", () => {
  const wrongPurpose = signedManifest();
  wrongPurpose.evidence[0].attestations[0].purpose = "different-purpose";
  assert.equal(assessRegionalSiteEvidenceManifest(wrongPurpose, expected(), {
    now: NOW,
    trustRegistry: trustRegistry()
  }).evidenceReady, false);

  const scopeRestricted = trustRegistry();
  scopeRestricted.keys[1].scopes = scopeRestricted.keys[1].scopes.slice(1);
  assert.equal(assessRegionalSiteEvidenceManifest(signedManifest(), expected(), {
    now: NOW,
    trustRegistry: scopeRestricted
  }).evidenceReady, false);

  const wrongRegion = signedManifest();
  wrongRegion.regionCode = "654321";
  assert.equal(assessRegionalSiteEvidenceManifest(wrongRegion, expected({ regionCode: "654321" }), {
    now: NOW,
    trustRegistry: trustRegistry()
  }).evidenceReady, false);

  const wrongRelease = signedManifest();
  wrongRelease.releaseId = "regional-release-2";
  assert.equal(assessRegionalSiteEvidenceManifest(wrongRelease, expected({ releaseId: "regional-release-2" }), {
    now: NOW,
    trustRegistry: trustRegistry()
  }).evidenceReady, false);

  const expired = trustRegistry();
  expired.keys.forEach((row) => { row.validUntil = "2026-08-14T07:00:00.000Z"; });
  assert.equal(assessRegionalSiteEvidenceManifest(signedManifest(), expected(), {
    now: NOW,
    trustRegistry: expired
  }).evidenceReady, false);
});

test("manifest contract rejects extra evidence bodies and unsupported scopes", () => {
  const extra = manifest();
  extra.evidence[0] = { ...extra.evidence[0], rawPayload: { patient: "must-not-enter" } };
  assert.throws(
    () => validateManifestStructure(extra),
    (error) => error.code === "REGIONAL_SITE_EVIDENCE_ITEM_INVALID"
  );
  const unsupported = manifest();
  unsupported.evidence[0] = { ...unsupported.evidence[0], scope: "unreviewed-custom-scope" };
  const status = buildRegionalSiteEvidenceStatus({
    manifest: unsupported,
    expected: expected(),
    regionCode: REGION,
    now: NOW
  });
  assert.equal(status.ok, false);
  assert.equal(status.evidenceReady, false);
  assert.deepEqual(status.blockers, ["REGIONAL_SITE_EVIDENCE_ITEM_INVALID"]);
});

test("evidence file requires an absolute bounded regular file and an exact SHA-256 pin", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "regional-site-evidence-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "site-evidence.json");
  const bytes = Buffer.from(`${JSON.stringify(signedManifest(), null, 2)}\n`, "utf8");
  fs.writeFileSync(file, bytes);
  const digest = `sha256:${sha256(bytes)}`;
  const loaded = readRegionalSiteEvidenceFile(file, digest);
  assert.equal(loaded.sourceDigest, digest);
  assert.equal(loaded.manifest.regionCode, REGION);
  assert.throws(
    () => readRegionalSiteEvidenceFile("relative/site-evidence.json", digest),
    (error) => error.code === "REGIONAL_SITE_EVIDENCE_PATH_INVALID"
  );
  assert.throws(
    () => readRegionalSiteEvidenceFile(file, SHA_A),
    (error) => error.code === "REGIONAL_SITE_EVIDENCE_DIGEST_MISMATCH"
  );
  const keys = environmentKeys(REGION);
  const status = buildRegionalSiteEvidenceStatus({
    env: { [keys.file]: file, [keys.digest]: digest },
    expected: expected(),
    regionCode: REGION,
    trustRegistry: trustRegistry(),
    now: NOW
  });
  assert.equal(status.evidenceReady, true);
  assert.equal(status.sourceDigest, digest);
});

test("trust registry requires an absolute bounded SHA-pinned file", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "regional-site-trust-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "trust-registry.json");
  const bytes = Buffer.from(`${JSON.stringify(trustRegistry(), null, 2)}\n`, "utf8");
  fs.writeFileSync(file, bytes);
  const digest = `sha256:${sha256(bytes)}`;
  const loaded = readTrustRegistryFile(file, digest);
  assert.equal(loaded.sourceDigest, digest);
  assert.equal(validateTrustRegistry(loaded.registry, EVIDENCE_SCOPES).keys.length, 2);
  assert.throws(
    () => readTrustRegistryFile("relative/trust.json", digest),
    (error) => error.code === "REGIONAL_SITE_EVIDENCE_TRUST_PATH_INVALID"
  );
  assert.throws(
    () => readTrustRegistryFile(file, SHA_A),
    (error) => error.code === "REGIONAL_SITE_EVIDENCE_TRUST_DIGEST_MISMATCH"
  );
  assert.deepEqual(trustEnvironmentKeys(), {
    file: "REGIONAL_SITE_EVIDENCE_TRUST_REGISTRY_FILE",
    digest: "REGIONAL_SITE_EVIDENCE_TRUST_REGISTRY_SHA256"
  });
});

test("unconfigured evidence remains an explicit external blocker while partial configuration is invalid", () => {
  const unconfigured = buildRegionalSiteEvidenceStatus({
    env: {},
    expected: expected(),
    regionCode: REGION,
    now: NOW
  });
  assert.equal(unconfigured.ok, true);
  assert.equal(unconfigured.configured, false);
  assert.deepEqual(unconfigured.blockers, ["regional-site-evidence-unconfigured"]);
  const keys = environmentKeys(REGION);
  const partial = buildRegionalSiteEvidenceStatus({
    env: { [keys.file]: "C:\\controlled\\site-evidence.json" },
    expected: expected(),
    regionCode: REGION,
    now: NOW
  });
  assert.equal(partial.ok, false);
  assert.equal(partial.configured, true);
  assert.deepEqual(partial.blockers, ["REGIONAL_SITE_EVIDENCE_CONFIGURATION_INCOMPLETE"]);
});

test("portfolio and CLI report every deployable region without converting missing evidence into approval", (t) => {
  const root = path.resolve(__dirname, "..");
  const portfolio = buildRegionalSiteEvidencePortfolio({ root, env: {}, now: NOW });
  assert.equal(portfolio.ok, true);
  assert.equal(portfolio.summary.regions, 2);
  assert.equal(portfolio.summary.verifierHealthy, 2);
  assert.equal(portfolio.summary.evidenceReady, 0);
  assert.equal(portfolio.productionReady, false);
  const report = buildReport({ root, env: {}, now: NOW });
  assert.equal(report.summary.regions, 2);
  const markdown = renderMarkdown(report);
  assert.match(markdown, /地区现场证据准入报告/);
  assert.match(markdown, /包含证据正文或复核人身份：否/);
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "regional-site-evidence-report-"));
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const written = writeReport(report, {
    output: path.join(outputDir, "report.json"),
    markdown: path.join(outputDir, "report.md")
  });
  assert.equal(JSON.parse(fs.readFileSync(written.output, "utf8")).productionReady, false);
  assert.match(fs.readFileSync(written.markdown, "utf8"), /regional-site-evidence-unconfigured/);
  assert.deepEqual(parseArgs(["--region=123456", "--output=release/custom.json"]), {
    region: "123456",
    output: "release/custom.json"
  });
});
