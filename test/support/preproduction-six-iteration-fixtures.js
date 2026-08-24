"use strict";

const { generateKeyPairSync, sign } = require("node:crypto");
const campaignRegistry = require("../../config/external-joint-test-campaign.json");
const {
  SCENARIOS,
  createExternalJointTestReceiptSubject,
  normalizeCampaign
} = require("../../src/platform/integration/external-joint-test-campaign");
const {
  sha256,
  stableStringify
} = require("../../src/platform/governance/technical-evidence");

const DIGEST = `sha256:${"a".repeat(64)}`;
const PACKAGE = `sha256:${"b".repeat(64)}`;

function evidenceRow(id) {
  return {
    id,
    status: "verified",
    evidenceRef: `evidence://preproduction/${id}`,
    evidenceDigest: DIGEST,
    operatorAccount: `operator-${id}`,
    verifierAccount: `verifier-${id}`,
    verifiedAt: "2026-08-24T08:00:00.000Z",
    expiresAt: "2099-08-05T08:00:00.000Z"
  };
}

function createPreproductionEvidence() {
  return {
    schemaVersion: "preproduction-environment-evidence-v1",
    environment: "pre-production",
    environmentId: "preproduction-a",
    releaseId: "release-20260804",
    packageFingerprint: PACKAGE,
    components: [
      "postgres",
      "object-storage",
      "central-session",
      "durable-messaging",
      "audit-retention"
    ].map(evidenceRow),
    recoveryScenarios: [
      "application-restart",
      "worker-interruption",
      "duplicate-delivery",
      "database-restore"
    ].map((id) => ({
      id,
      passed: true,
      evidenceRef: `evidence://recovery/${id}`,
      evidenceDigest: DIGEST,
      operatorAccount: `operator-${id}`,
      verifierAccount: `verifier-${id}`,
      startedAt: "2026-08-24T08:00:00.000Z",
      completedAt: "2026-08-24T08:10:00.000Z",
      rpoTargetMinutes: 15,
      rpoActualMinutes: 5,
      rtoTargetMinutes: 20,
      rtoActualMinutes: 10
    }))
  };
}

function createRehearsalSession() {
  const seatIds = [
    "release-commander",
    "business-owner",
    "platform-operations",
    "security-compliance",
    "data-platform",
    "institution-coordinator",
    "independent-observer"
  ];
  return {
    schemaVersion: "pilot-cutover-rehearsal-session-v1",
    sessionId: "rehearsal-20260804",
    environment: "pre-production",
    releaseId: "release-20260804",
    packageFingerprint: PACKAGE,
    coordinatorAccount: "release-commander-account",
    openedAt: "2026-08-24T08:00:00.000Z",
    closedAt: "2026-08-24T09:00:00.000Z",
    maximumRollbackMinutes: 30,
    seats: seatIds.map((id) => ({
      id,
      account: `${id}-account`,
      evidenceRef: `evidence://seat/${id}`,
      evidenceDigest: DIGEST,
      confirmedAt: "2026-08-24T08:05:00.000Z"
    })),
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
      evidenceRef: `evidence://checkpoint/${id}`,
      evidenceDigest: DIGEST,
      completedAt: "2026-08-24T08:30:00.000Z"
    })),
    observations: [
      "business-success-and-error-rate",
      "outbox-lag-and-reconciliation",
      "data-consistency-and-late-arrivals",
      "security-alerts-and-access-anomalies",
      "institution-feedback-and-support-cases",
      "evidence-ledger-expiry-revocation-and-chain"
    ].map((id) => ({
      id,
      passed: true,
      evidenceRef: `evidence://observation/${id}`,
      evidenceDigest: DIGEST,
      observedAt: "2026-08-24T09:30:00.000Z"
    })),
    rollbackCommand: {
      phrase: "ROLLBACK PILOT release-20260804",
      issuedBy: "release-commander-account",
      acknowledgedBy: "platform-operations-account",
      witnessedBy: "independent-observer-account",
      issuedAt: "2026-08-24T08:35:00.000Z",
      acknowledgedAt: "2026-08-24T08:36:00.000Z",
      actualRollbackMinutes: 12
    }
  };
}

function createExternalJointTestFixture() {
  const campaign = normalizeCampaign(campaignRegistry);
  const platform = generateKeyPairSync("ed25519");
  const external = generateKeyPairSync("ed25519");
  const allowedInterfaceIds = campaign.interfaces.map((item) => item.id);
  const trustRegistry = {
    schemaVersion: "external-joint-test-trust-registry-v1",
    generatedAt: "2026-08-24T08:00:00.000Z",
    keys: [{
      keyId: "platform-joint-test-key-v1",
      account: "platform-joint-test-owner",
      party: "platform",
      algorithm: "Ed25519",
      status: "active",
      allowedInterfaceIds,
      validFrom: "2026-08-01T00:00:00.000Z",
      validUntil: "2099-09-01T00:00:00.000Z",
      publicKeyPem: platform.publicKey.export({ type: "spki", format: "pem" })
    }, {
      keyId: "external-joint-test-key-v1",
      account: "external-joint-test-owner",
      party: "external",
      algorithm: "Ed25519",
      status: "active",
      allowedInterfaceIds,
      validFrom: "2026-08-01T00:00:00.000Z",
      validUntil: "2099-09-01T00:00:00.000Z",
      publicKeyPem: external.publicKey.export({ type: "spki", format: "pem" })
    }]
  };
  let sequence = 0;
  const receipts = campaign.interfaces.flatMap((item) => SCENARIOS.map((scenario) => {
    sequence += 1;
    const receipt = {
      schemaVersion: "external-joint-test-scenario-receipt-v1",
      campaignId: campaign.campaignId,
      campaignDigest: campaign.campaignDigest,
      releaseId: "release-20260804",
      packageFingerprint: PACKAGE,
      interfaceId: item.id,
      scenarioId: scenario.id,
      runId: `joint-test-run-${String(sequence).padStart(3, "0")}`,
      executedAt: "2026-08-24T10:00:00.000Z",
      expiresAt: "2026-08-30T10:00:00.000Z",
      result: "passed",
      traceRef: `evidence://external-joint-test/${item.id}/${scenario.id}/trace`,
      receiptRef: `artifact://external-joint-test/${item.id}/${scenario.id}/receipt`,
      requestDigest: sha256(`request-${item.id}-${scenario.id}`),
      responseDigest: sha256(`response-${item.id}-${scenario.id}`),
      assertions: {
        ...structuredClone(scenario.assertions),
        ...(scenario.id === "timeout-retry" ? { attemptCount: 2 } : {})
      }
    };
    const subject = createExternalJointTestReceiptSubject(receipt);
    const subjectDigest = sha256(subject);
    receipt.attestations = [
      {
        schemaVersion: "external-joint-test-attestation-v1",
        party: "platform",
        keyId: "platform-joint-test-key-v1",
        account: "platform-joint-test-owner",
        algorithm: "Ed25519",
        issuedAt: "2026-08-24T10:30:00.000Z",
        nonce: `platform-nonce-${String(sequence).padStart(5, "0")}`,
        subjectDigest,
        signature: sign(null, Buffer.from(stableStringify(subject)), platform.privateKey)
          .toString("base64url")
      },
      {
        schemaVersion: "external-joint-test-attestation-v1",
        party: "external",
        keyId: "external-joint-test-key-v1",
        account: "external-joint-test-owner",
        algorithm: "Ed25519",
        issuedAt: "2026-08-24T10:30:00.000Z",
        nonce: `external-nonce-${String(sequence).padStart(5, "0")}`,
        subjectDigest,
        signature: sign(null, Buffer.from(stableStringify(subject)), external.privateKey)
          .toString("base64url")
      }
    ];
    return receipt;
  }));
  return {
    campaign: structuredClone(campaignRegistry),
    trustRegistry,
    evidenceBundle: {
      schemaVersion: "external-joint-test-evidence-bundle-v1",
      campaignId: campaign.campaignId,
      campaignDigest: campaign.campaignDigest,
      releaseId: "release-20260804",
      packageFingerprint: PACKAGE,
      receipts,
      revocations: []
    }
  };
}

function createMonitoringAcceptance(journalHeadDigest) {
  const requiredChecks = [
    "metadata-minimization",
    "siem-or-webhook-delivery",
    "duty-acknowledgement",
    "p0-escalation",
    "receiver-outage-dead-letter-redrive",
    "verified-recovery"
  ];
  return {
    schemaVersion: "pilot-cutover-monitoring-acceptance-v1",
    status: "verified",
    releaseId: "release-20260804",
    packageFingerprint: PACKAGE,
    monitoringOwnerAccount: "monitoring-owner",
    securityReviewerAccount: "security-reviewer",
    observedWindow: {
      startedAt: "2026-08-24T08:00:00.000Z",
      completedAt: "2026-08-24T09:00:00.000Z"
    },
    checks: requiredChecks.map((id) => ({
      id,
      status: "verified",
      evidenceRef: `evidence://monitoring/${id}`,
      evidenceDigest: DIGEST
    })),
    journalHeadDigest,
    acceptanceEvidenceRef: "evidence://monitoring/acceptance",
    acceptanceEvidenceDigest: DIGEST
  };
}

module.exports = {
  DIGEST,
  PACKAGE,
  createExternalJointTestFixture,
  createMonitoringAcceptance,
  createPreproductionEvidence,
  createRehearsalSession
};
