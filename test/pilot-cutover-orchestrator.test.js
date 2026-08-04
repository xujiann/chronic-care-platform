"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  APPROVAL_ROLES,
  EVIDENCE_DIGEST_IDS,
  createPilotCutoverEvidenceFingerprint,
  evaluatePilotCutover
} = require("../src/platform/cutover/pilot-cutover-orchestrator");
const {
  buildIterationProgramReport
} = require("../scripts/platform-iteration-control");

const NOW = "2030-08-04T12:00:00.000Z";

function candidate() {
  const input = {
    release: {
      releaseId: "release-20300804",
      sourceCommit: "a".repeat(40),
      artifactDigest: `sha256:${"b".repeat(64)}`
    },
    evidenceDigests: Object.fromEntries(EVIDENCE_DIGEST_IDS.map((id, index) => [
      id,
      `sha256:${((index % 6) + 1).toString().repeat(64)}`
    ])),
    reports: {
      adapterRuntime: {
        localChecks: {
          schemaVerified: true,
          adaptersConfigured: true,
          adapterWritesEvidenceGated: true
        }
      },
      reconciliation: {
        ok: true,
        domains: { referral: { ok: true }, emergency: { ok: true } },
        durableCheckpointVerified: true,
        faultRecoveryVerified: true,
        payloadsExposed: false
      },
      jointTests: { externalEvidenceVerified: true },
      businessLoop: { ok: true },
      operations: { localReady: true, externalReady: true },
      externalReleaseEvidence: {
        ok: true,
        evidenceFingerprint: `sha256:${"c".repeat(64)}`
      }
    },
    rollback: {
      owner: "rollback-owner",
      maximumMinutes: 60,
      snapshotRef: "artifact://backup/snapshot-1",
      snapshotDigest: `sha256:${"d".repeat(64)}`,
      steps: ["freeze-writes", "restore-database", "restore-runtime", "verify-recovery"].map((id) => ({
        id,
        tested: true,
        procedureRef: `evidence://rollback/${id}`,
        testDigest: `sha256:${"e".repeat(64)}`
      }))
    },
    disasterRecovery: {
      rpoTargetMinutes: 15,
      rtoTargetMinutes: 60,
      rpoActualMinutes: 5,
      rtoActualMinutes: 30,
      passed: true,
      receiptRef: "evidence://dr/rehearsal-1",
      receiptDigest: `sha256:${"f".repeat(64)}`,
      executionAccount: "dr-operator",
      verifierAccount: "dr-verifier"
    }
  };
  const fingerprint = createPilotCutoverEvidenceFingerprint(input);
  input.authorization = {
    decision: "GO",
    confirmation: "APPROVE PILOT CUTOVER",
    evidenceFingerprint: fingerprint,
    approvedAt: "2030-08-04T11:00:00.000Z",
    expiresAt: "2030-08-04T14:00:00.000Z",
    rollbackOwner: "rollback-owner",
    approvals: APPROVAL_ROLES.map((role, index) => ({
      role,
      account: `approver-${index}`,
      status: "approved",
      evidenceRef: `evidence://cutover/${role}`,
      evidenceDigest: `sha256:${((index % 4) + 1).toString().repeat(64)}`
    }))
  };
  return input;
}

test("all six iterations expose their local artifacts while external gates stay explicit", () => {
  const report = buildIterationProgramReport();
  assert.equal(report.localFoundationReady, true);
  assert.equal(report.iterations.length, 6);
  assert.equal(report.iterations.every((item) => item.localFoundationReady), true);
  assert.equal(report.defaultDecision, "NO-GO");
  assert.equal(report.productionReady, false);
  assert.equal(report.iterations[2].externalGates[0].status, "pending-external");
});

test("complete bound evidence yields a non-executing GO candidate", () => {
  const report = evaluatePilotCutover(candidate(), NOW);
  assert.equal(report.decision, "GO-CANDIDATE");
  assert.equal(report.cutoverExecutionAuthorized, false);
  assert.equal(report.productionPrimary, false);
  assert.equal(report.productionReady, false);
  assert.equal(report.secretsExposed, false);
  assert.equal(report.patientDataExposed, false);
});

test("evidence drift or missing external evidence forces NO-GO", () => {
  const drifted = candidate();
  drifted.evidenceDigests.reconciliation = `sha256:${"9".repeat(64)}`;
  assert.equal(evaluatePilotCutover(drifted, NOW).decision, "NO-GO");
  const missing = candidate();
  missing.reports.jointTests.externalEvidenceVerified = false;
  assert.equal(evaluatePilotCutover(missing, NOW).decision, "NO-GO");
});
