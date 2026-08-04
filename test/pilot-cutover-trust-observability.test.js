"use strict";

const assert = require("node:assert/strict");
const { generateKeyPairSync, sign } = require("node:crypto");
const test = require("node:test");
const {
  createPilotCutoverTrustSubject,
  createPilotCutoverTrustVerifier
} = require("../src/platform/cutover/pilot-cutover-trust-verifier");
const {
  validatePilotCutoverRehearsal
} = require("../src/platform/cutover/pilot-cutover-rehearsal");
const {
  blockedPilotCutoverControlHealth,
  buildPilotCutoverControlHealth
} = require("../src/platform/cutover/pilot-cutover-observability");
const {
  buildPilotCutoverCommandPlan
} = require("../src/platform/cutover/pilot-cutover-command-plan");
const { sha256, stableStringify } = require("../src/platform/governance/technical-evidence");

const NOW = "2030-08-04T12:00:00.000Z";

function signedEvidenceFixture() {
  const pair = generateKeyPairSync("ed25519");
  const registry = {
    schemaVersion: "pilot-cutover-trust-registry-v1",
    generatedAt: NOW,
    keys: [{
      keyId: "key-security-1",
      account: "security-verifier",
      algorithm: "Ed25519",
      status: "active",
      scopes: ["security-assessment"],
      validFrom: "2030-08-01T00:00:00.000Z",
      validUntil: "2030-08-10T00:00:00.000Z",
      publicKeyPem: pair.publicKey.export({ type: "spki", format: "pem" })
    }]
  };
  const event = {
    type: "evidence-registered",
    actorAccount: "security-verifier",
    recordedAt: NOW,
    payload: {
      gateId: "security-assessment",
      releaseId: "release-1",
      packageFingerprint: `sha256:${"a".repeat(64)}`,
      evidenceRef: "evidence://security/report",
      evidenceDigest: `sha256:${"b".repeat(64)}`,
      issuedAt: "2030-08-04T10:00:00.000Z",
      expiresAt: "2030-08-05T10:00:00.000Z",
      issuerAccount: "security-auditor",
      verifierAccount: "security-verifier"
    }
  };
  const subject = createPilotCutoverTrustSubject(event);
  event.payload.attestation = {
    schemaVersion: "pilot-cutover-attestation-v1",
    keyId: "key-security-1",
    algorithm: "Ed25519",
    issuedAt: "2030-08-04T11:00:00.000Z",
    nonce: "security-nonce-1",
    subjectDigest: sha256(subject),
    signature: sign(
      null,
      Buffer.from(stableStringify(subject)),
      pair.privateKey
    ).toString("base64url")
  };
  return { event, registry };
}

test("Ed25519 verifier binds identity, scope, canonical subject and validity window", () => {
  const { event, registry } = signedEvidenceFixture();
  const verifier = createPilotCutoverTrustVerifier({ registry });
  const result = verifier.verifyEvent(event, NOW);
  assert.equal(result.trusted, true);
  assert.equal(result.scope, "security-assessment");

  const tampered = structuredClone(event);
  tampered.payload.releaseId = "release-tampered";
  assert.equal(verifier.verifyEvent(tampered, NOW).trusted, false);
  const identityDrift = structuredClone(event);
  identityDrift.payload.verifierAccount = "another-verifier";
  assert.equal(verifier.verifyEvent(identityDrift, NOW).trusted, false);
  assert.equal(
    verifier.verifyEvent(event, "2030-08-11T00:00:00.000Z").trusted,
    false
  );
});

test("rehearsal validation enforces all checkpoints and rollback budget", () => {
  const payload = {
    schemaVersion: "pilot-cutover-rehearsal-v1",
    rehearsalId: "rehearsal-1",
    environment: "pre-production",
    releaseId: "release-1",
    packageFingerprint: `sha256:${"a".repeat(64)}`,
    coordinatorAccount: "coordinator",
    rollbackOwner: "rollback-owner",
    startedAt: "2030-08-04T08:00:00.000Z",
    completedAt: "2030-08-04T09:00:00.000Z",
    maximumRollbackMinutes: 60,
    actualRollbackMinutes: 18,
    result: "passed",
    checkpoints: [
      "freeze-writes",
      "snapshot",
      "switch-read",
      "verify-business-loop",
      "rollback",
      "post-rollback-verify"
    ].map((id) => ({
      id,
      passed: true,
      evidenceRef: `evidence://rehearsal/${id}`,
      evidenceDigest: `sha256:${"c".repeat(64)}`
    }))
  };
  assert.equal(validatePilotCutoverRehearsal(payload), true);
  assert.throws(
    () => validatePilotCutoverRehearsal({ ...payload, actualRollbackMinutes: 61 }),
    (error) => error.code === "PILOT_CUTOVER_REHEARSAL_INVALID"
  );
});

test("health report alerts on expiry, revocation and rehearsal freshness without executing", () => {
  const control = {
    evaluatedAt: NOW,
    decision: "GO-CANDIDATE",
    ledger: {
      chainValid: true,
      trustReady: true,
      evidenceReady: true,
      approvalsReady: true,
      rehearsalReady: true,
      headDigest: `sha256:${"d".repeat(64)}`,
      rehearsal: { ready: true },
      lifecycle: [
        {
          eventId: "current",
          expiresAt: "2030-08-04T18:00:00.000Z",
          revoked: false,
          trusted: true
        },
        {
          eventId: "revoked",
          expiresAt: "2030-08-06T18:00:00.000Z",
          revoked: true,
          trusted: true
        }
      ]
    }
  };
  const report = buildPilotCutoverControlHealth(control, { now: NOW, warningHours: 12 });
  assert.equal(report.status, "warning");
  assert.equal(report.lifecycle.expiringSoon, 1);
  assert.equal(report.lifecycle.revoked, 1);
  assert.equal(report.decision, "GO-CANDIDATE");
  assert.equal(report.cutoverExecutionAuthorized, false);
  assert.equal(report.productionReady, false);

  const blocked = blockedPilotCutoverControlHealth({
    code: "PILOT_CUTOVER_LEDGER_DIGEST_INVALID"
  }, NOW);
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.signals.ledgerChain, false);
});

test("command plan defines seven duty seats, rollback phrase and T+1 observation only", () => {
  const plan = buildPilotCutoverCommandPlan({
    releaseId: "release-1",
    packageFingerprint: `sha256:${"a".repeat(64)}`
  });
  assert.equal(plan.dutySeats.length, 7);
  assert.equal(plan.rollback.phraseTemplate, "ROLLBACK PILOT release-1");
  assert.ok(plan.tPlusOneObservation.includes("evidence-ledger-expiry-revocation-and-chain"));
  assert.equal(plan.commandReady, true);
  assert.equal(plan.cutoverExecutionAuthorized, false);
  assert.equal(plan.productionReady, false);
});
