"use strict";

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
    verifiedAt: "2026-08-04T08:00:00.000Z",
    expiresAt: "2026-08-05T08:00:00.000Z"
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
      startedAt: "2026-08-04T08:00:00.000Z",
      completedAt: "2026-08-04T08:10:00.000Z",
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
    openedAt: "2026-08-04T08:00:00.000Z",
    closedAt: "2026-08-04T09:00:00.000Z",
    maximumRollbackMinutes: 30,
    seats: seatIds.map((id) => ({
      id,
      account: `${id}-account`,
      evidenceRef: `evidence://seat/${id}`,
      evidenceDigest: DIGEST,
      confirmedAt: "2026-08-04T08:05:00.000Z"
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
      completedAt: "2026-08-04T08:30:00.000Z"
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
      observedAt: "2026-08-04T09:30:00.000Z"
    })),
    rollbackCommand: {
      phrase: "ROLLBACK PILOT release-20260804",
      issuedBy: "release-commander-account",
      acknowledgedBy: "platform-operations-account",
      witnessedBy: "independent-observer-account",
      issuedAt: "2026-08-04T08:35:00.000Z",
      acknowledgedAt: "2026-08-04T08:36:00.000Z",
      actualRollbackMinutes: 12
    }
  };
}

module.exports = {
  DIGEST,
  PACKAGE,
  createPreproductionEvidence,
  createRehearsalSession
};
