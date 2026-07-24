"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  EVIDENCE_SCHEMA_VERSION,
  REQUIRED_SCOPES,
  loadCutoverEvidence,
  sha256,
  validateCutoverEvidence
} = require("../care-service-cutover-evidence");
const Runtime = require("../care-service-runtime");

const AT = "2026-07-24T02:00:00.000Z";

function digest(character) {
  return `sha256:${character.repeat(64)}`;
}

function validManifest(overrides = {}) {
  return {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    policyVersion: Runtime.RUNTIME_POLICY_VERSION,
    environment: "production",
    releaseId: "CARE-CHANGE-20260724-001",
    approvals: REQUIRED_SCOPES.map((scope, index) => ({
      scope,
      decision: "approved",
      signerId: `${scope}-approver-001`,
      signedAt: "2026-07-24T01:00:00.000Z",
      expiresAt: "2026-08-24T01:00:00.000Z",
      evidenceRef: `urn:care-cutover:${scope}:20260724`,
      evidenceDigest: digest(String(index + 1))
    })),
    ...overrides
  };
}

function validate(manifest, options = {}) {
  return validateCutoverEvidence(manifest, {
    at: AT,
    policyVersion: Runtime.RUNTIME_POLICY_VERSION,
    expectedDigest: digest("a"),
    actualDigest: digest("a"),
    ...options
  });
}

test("cutover evidence accepts five current independent approvals bound to a pinned manifest", () => {
  const result = validate(validManifest());
  assert.equal(result.ok, true);
  assert.deepEqual(result.approvedScopes, REQUIRED_SCOPES);
  assert.equal(result.errors.length, 0);
});

test("cutover evidence fails closed on missing stale expired and unapproved scopes", () => {
  const manifest = validManifest();
  manifest.approvals = manifest.approvals.filter((item) => item.scope !== "dr");
  manifest.approvals.find((item) => item.scope === "business").decision = "denied";
  manifest.approvals.find((item) => item.scope === "interface").signedAt = "2026-05-01T00:00:00.000Z";
  manifest.approvals.find((item) => item.scope === "security").expiresAt = "2026-07-23T00:00:00.000Z";
  const result = validate(manifest);
  assert.equal(result.ok, false);
  assert.equal(result.errors.some((item) => item.code === "CUTOVER_EVIDENCE_SCOPE_MISSING" && item.scope === "dr"), true);
  assert.equal(result.errors.some((item) => item.code === "CUTOVER_EVIDENCE_DECISION_INVALID" && item.scope === "business"), true);
  assert.equal(result.errors.some((item) => item.code === "CUTOVER_EVIDENCE_STALE" && item.scope === "interface"), true);
  assert.equal(result.errors.some((item) => item.code === "CUTOVER_EVIDENCE_EXPIRED" && item.scope === "security"), true);
});

test("cutover evidence rejects signer reuse placeholder references duplicate packets and digest mismatch", () => {
  const manifest = validManifest();
  manifest.approvals[1].signerId = manifest.approvals[0].signerId;
  manifest.approvals[2].evidenceRef = "replace-with-security-packet";
  manifest.approvals[3].evidenceDigest = manifest.approvals[0].evidenceDigest;
  const result = validate(manifest, { actualDigest: digest("b") });
  assert.equal(result.ok, false);
  assert.equal(result.errors.some((item) => item.code === "CUTOVER_EVIDENCE_DIGEST_MISMATCH"), true);
  assert.equal(result.errors.some((item) => item.code === "CUTOVER_EVIDENCE_SIGNER_REUSED"), true);
  assert.equal(result.errors.some((item) => item.code === "CUTOVER_EVIDENCE_REFERENCE_INVALID"), true);
  assert.equal(result.errors.some((item) => item.code === "CUTOVER_EVIDENCE_ARCHIVE_DIGEST_REUSED"), true);
});

test("cutover evidence loader verifies the exact archived file bytes", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "care-cutover-evidence-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const raw = Buffer.from(JSON.stringify(validManifest(), null, 2), "utf8");
  const file = path.join(directory, "evidence.json");
  fs.writeFileSync(file, raw);
  const result = loadCutoverEvidence({
    CARE_CUTOVER_EVIDENCE_FILE: file,
    CARE_CUTOVER_EVIDENCE_SHA256: sha256(raw)
  }, {
    at: AT,
    policyVersion: Runtime.RUNTIME_POLICY_VERSION
  });
  assert.equal(result.ok, true);

  fs.appendFileSync(file, "\n");
  const tampered = loadCutoverEvidence({
    CARE_CUTOVER_EVIDENCE_FILE: file,
    CARE_CUTOVER_EVIDENCE_SHA256: sha256(raw)
  }, {
    at: AT,
    policyVersion: Runtime.RUNTIME_POLICY_VERSION
  });
  assert.equal(tampered.ok, false);
  assert.equal(tampered.errors.some((item) => item.code === "CUTOVER_EVIDENCE_DIGEST_MISMATCH"), true);
});
