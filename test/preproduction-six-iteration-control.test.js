"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  REQUIRED_COMPONENTS,
  REQUIRED_RECOVERY_SCENARIOS,
  evaluatePreproductionEnvironment
} = require("../src/platform/cutover/preproduction-environment-readiness");
const {
  DUTY_SEATS
} = require("../src/platform/cutover/pilot-cutover-command-plan");
const {
  REQUIRED_REHEARSAL_CHECKPOINTS
} = require("../src/platform/cutover/pilot-cutover-rehearsal");
const {
  REQUIRED_OBSERVATIONS,
  buildRehearsalLedgerPayload,
  evaluatePilotCutoverRehearsalSession
} = require("../src/platform/cutover/pilot-cutover-rehearsal-session");
const {
  buildPilotCutoverCandidateReview
} = require("../src/platform/cutover/pilot-cutover-candidate-review");

const NOW = "2030-08-04T12:00:00.000Z";
const RELEASE_ID = "release-20300804";
const FINGERPRINT = `sha256:${"a".repeat(64)}`;

function preproductionEvidence() {
  return {
    schemaVersion: "preproduction-environment-evidence-v1",
    environment: "pre-production",
    environmentId: "preprod-east-1",
    releaseId: RELEASE_ID,
    packageFingerprint: FINGERPRINT,
    components: REQUIRED_COMPONENTS.map((id, index) => ({
      id,
      status: "verified",
      evidenceRef: `evidence://preprod/component/${id}`,
      evidenceDigest: `sha256:${String(index + 1).repeat(64)}`,
      verifiedAt: "2030-08-04T09:00:00.000Z",
      expiresAt: "2030-08-05T09:00:00.000Z",
      operatorAccount: `operator-${index}`,
      verifierAccount: `verifier-${index}`
    })),
    recoveryScenarios: REQUIRED_RECOVERY_SCENARIOS.map((id, index) => ({
      id,
      passed: true,
      evidenceRef: `evidence://preprod/recovery/${id}`,
      evidenceDigest: `sha256:${String(index + 6).repeat(64)}`,
      startedAt: "2030-08-04T09:00:00.000Z",
      completedAt: "2030-08-04T10:00:00.000Z",
      rpoTargetMinutes: 15,
      rpoActualMinutes: 4,
      rtoTargetMinutes: 60,
      rtoActualMinutes: 18,
      operatorAccount: `recovery-operator-${index}`,
      verifierAccount: `recovery-verifier-${index}`
    }))
  };
}

function rehearsalSession() {
  return {
    schemaVersion: "pilot-cutover-rehearsal-session-v1",
    sessionId: "session-20300804",
    environment: "pre-production",
    releaseId: RELEASE_ID,
    packageFingerprint: FINGERPRINT,
    coordinatorAccount: "institution-coordinator-account",
    openedAt: "2030-08-04T08:00:00.000Z",
    closedAt: "2030-08-04T11:30:00.000Z",
    maximumRollbackMinutes: 60,
    seats: DUTY_SEATS.map((seat, index) => ({
      id: seat.id,
      account: `${seat.id}-account`,
      confirmedAt: "2030-08-04T08:10:00.000Z",
      evidenceRef: `evidence://rehearsal/seat/${seat.id}`,
      evidenceDigest: `sha256:${String(index + 1).repeat(64)}`
    })),
    checkpoints: REQUIRED_REHEARSAL_CHECKPOINTS.map((id, index) => ({
      id,
      passed: true,
      completedAt: `2030-08-04T10:${String(index).padStart(2, "0")}:00.000Z`,
      evidenceRef: `evidence://rehearsal/checkpoint/${id}`,
      evidenceDigest: `sha256:${String(index + 2).repeat(64)}`
    })),
    rollbackCommand: {
      phrase: `ROLLBACK PILOT ${RELEASE_ID}`,
      issuedBy: "release-commander-account",
      issuedAt: "2030-08-04T10:30:00.000Z",
      acknowledgedBy: "platform-operations-account",
      acknowledgedAt: "2030-08-04T10:31:00.000Z",
      witnessedBy: "independent-observer-account",
      actualRollbackMinutes: 18
    },
    observations: REQUIRED_OBSERVATIONS.map((id, index) => ({
      id,
      passed: true,
      observedAt: `2030-08-04T11:${String(index).padStart(2, "0")}:00.000Z`,
      evidenceRef: `evidence://rehearsal/observation/${id}`,
      evidenceDigest: `sha256:${String(index + 3).repeat(64)}`
    }))
  };
}

test("pre-production evidence requires all components, independent verification and recovery targets", () => {
  const report = evaluatePreproductionEnvironment(preproductionEvidence(), { now: NOW });
  assert.equal(report.ready, true);
  assert.equal(report.decision, "LOCAL-READY");
  assert.equal(report.productionReady, false);
  assert.match(report.technicalEvidenceFingerprint, /^sha256:[a-f0-9]{64}$/);

  const overrun = preproductionEvidence();
  overrun.recoveryScenarios[0].rtoActualMinutes = 61;
  assert.equal(evaluatePreproductionEnvironment(overrun, { now: NOW }).ready, false);

  const expired = preproductionEvidence();
  expired.components[0].expiresAt = "2030-08-04T11:00:00.000Z";
  assert.equal(evaluatePreproductionEnvironment(expired, { now: NOW }).ready, false);
});

test("seven-seat rehearsal verifies checkpoints, rollback phrase, timing and T+1 observation lanes", () => {
  const input = rehearsalSession();
  const report = evaluatePilotCutoverRehearsalSession(input, { now: NOW });
  assert.equal(report.ready, true);
  assert.equal(report.seats.length, 7);
  assert.equal(report.checkpoints.length, 6);
  assert.equal(report.rollback.actualMinutes, 18);
  assert.equal(report.cutoverExecutionAuthorized, false);

  const ledgerPayload = buildRehearsalLedgerPayload(input, report);
  assert.equal(ledgerPayload.schemaVersion, "pilot-cutover-rehearsal-v1");
  assert.equal(ledgerPayload.sessionEvidenceFingerprint, report.technicalEvidenceFingerprint);

  const wrongPhrase = rehearsalSession();
  wrongPhrase.rollbackCommand.phrase = "ROLLBACK SOMETHING ELSE";
  assert.equal(
    evaluatePilotCutoverRehearsalSession(wrongPhrase, { now: NOW }).ready,
    false
  );

  const duplicateSeat = rehearsalSession();
  duplicateSeat.seats[1].account = duplicateSeat.seats[0].account;
  assert.equal(
    evaluatePilotCutoverRehearsalSession(duplicateSeat, { now: NOW }).ready,
    false
  );
});

test("candidate review remains NO-GO until all reports share one package and every control is ready", () => {
  const preproduction = evaluatePreproductionEnvironment(preproductionEvidence(), { now: NOW });
  const rehearsal = evaluatePilotCutoverRehearsalSession(rehearsalSession(), { now: NOW });
  const authorization = {
    schema: "pilot-cutover-authorization-control-v1",
    decision: "GO-CANDIDATE",
    releaseId: RELEASE_ID,
    evidenceFingerprint: FINGERPRINT,
    ledger: {
      releaseId: RELEASE_ID,
      packageFingerprint: FINGERPRINT
    },
    cutoverExecutionAuthorized: false,
    productionReady: false
  };
  const ready = buildPilotCutoverCandidateReview({
    authorization,
    preproduction,
    jointTests: {
      ready: true,
      releaseId: RELEASE_ID,
      packageFingerprint: FINGERPRINT,
      productionReady: false
    },
    monitoring: {
      ready: true,
      releaseId: RELEASE_ID,
      packageFingerprint: FINGERPRINT,
      productionReady: false
    },
    rehearsal
  }, { now: NOW });
  assert.equal(ready.decision, "GO-CANDIDATE");
  assert.equal(ready.blockers.length, 0);
  assert.equal(ready.cutoverExecutionAuthorized, false);
  assert.equal(ready.productionReady, false);

  const blocked = buildPilotCutoverCandidateReview({
    authorization,
    preproduction,
    jointTests: {
      ready: false,
      releaseId: RELEASE_ID,
      packageFingerprint: FINGERPRINT
    },
    monitoring: {
      ready: false,
      releaseId: RELEASE_ID,
      packageFingerprint: FINGERPRINT
    },
    rehearsal
  }, { now: NOW });
  assert.equal(blocked.decision, "NO-GO");
  assert.deepEqual(
    blocked.blockers.map((row) => row.id),
    ["signed-joint-tests", "monitoring-security-acceptance"]
  );

  const drifted = buildPilotCutoverCandidateReview({
    authorization,
    preproduction,
    jointTests: {
      ready: true,
      releaseId: RELEASE_ID,
      packageFingerprint: `sha256:${"b".repeat(64)}`
    },
    monitoring: {
      ready: true,
      releaseId: RELEASE_ID,
      packageFingerprint: FINGERPRINT
    },
    rehearsal
  }, { now: NOW });
  assert.equal(drifted.decision, "NO-GO");
  assert.equal(drifted.bindings.packageFingerprint, false);
});
