"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildInstitutionPilotReadiness,
  closeChronicReferralPilot,
  createInstitutionPilotSession,
  digest,
  reconcileInstitutionPilot,
  recordInstitutionPilotAttempt
} = require("../src/platform/integration/institution-pilot-orchestrator");

function start(commandId = "pilot-create-001", correlationId = "corr-pilot-001") {
  return createInstitutionPilotSession({}, {
    commandId,
    regionCode: "999999",
    institutionSlot: "synthetic-general-hospital",
    correlationId,
    adapterProfileId: "chronic-referral-core"
  }, { now: "2026-08-17T06:00:00.000Z" });
}

test("institution pilot orchestrates retry, reconciliation and a synthetic referral closed loop", () => {
  let result = start();
  assert.equal(result.result.status, "synthetic-joint-test-complete");
  assert.equal(result.result.adapterIds.includes("hospital-his"), true);
  assert.equal(result.result.synthetic, true);
  assert.equal(result.result.productionReady, false);
  const sessionId = result.result.sessionId;
  const envelopeDigest = digest({ syntheticReferral: "referral-a", version: 1 });

  result = recordInstitutionPilotAttempt(result.data, {
    commandId: "pilot-attempt-001",
    sessionId,
    expectedVersion: 0,
    adapterId: "hospital-his",
    outcome: "retryable-failure",
    outboundEnvelopeDigest: envelopeDigest,
    errorCode: "SYNTHETIC_TIMEOUT"
  }, { now: "2026-08-17T06:01:00.000Z" });
  assert.equal(result.result.status, "retry-wait");
  assert.equal(result.result.nextRetryAt, "2026-08-17T06:01:30.000Z");
  assert.throws(() => recordInstitutionPilotAttempt(result.data, {
    commandId: "pilot-attempt-early",
    sessionId,
    expectedVersion: 1,
    adapterId: "hospital-his",
    outcome: "accepted",
    outboundEnvelopeDigest: envelopeDigest
  }, { now: "2026-08-17T06:01:15.000Z" }), (error) => error.code === "INSTITUTION_PILOT_RETRY_NOT_DUE");

  result = recordInstitutionPilotAttempt(result.data, {
    commandId: "pilot-attempt-002",
    sessionId,
    expectedVersion: 1,
    adapterId: "hospital-his",
    outcome: "accepted",
    outboundEnvelopeDigest: envelopeDigest
  }, { now: "2026-08-17T06:02:00.000Z" });
  assert.equal(result.result.status, "delivery-accepted");

  result = reconcileInstitutionPilot(result.data, {
    commandId: "pilot-reconcile-001",
    sessionId,
    expectedVersion: 2,
    acknowledgedEnvelopeDigest: digest("different-envelope")
  }, { now: "2026-08-17T06:03:00.000Z" });
  assert.equal(result.result.reconciliation.matched, false);
  assert.equal(result.result.status, "delivery-accepted");

  result = reconcileInstitutionPilot(result.data, {
    commandId: "pilot-reconcile-002",
    sessionId,
    expectedVersion: 3,
    acknowledgedEnvelopeDigest: envelopeDigest
  }, { now: "2026-08-17T06:04:00.000Z" });
  assert.equal(result.result.status, "reconciled");
  assert.equal(result.result.reconciliation.externalReceiptVerified, false);

  result = closeChronicReferralPilot(result.data, {
    commandId: "pilot-closure-001",
    sessionId,
    expectedVersion: 4,
    subjectRefDigest: digest("synthetic-subject-reference")
  }, { now: "2026-08-17T06:05:00.000Z" });
  assert.equal(result.result.status, "synthetic-closed-loop");
  assert.equal(result.loop.ok, true);
  assert.equal(result.loop.phase, "closed");
  assert.equal(result.result.referralClosure.externalEvidenceVerified, false);

  const readiness = buildInstitutionPilotReadiness(result.data, { now: "2026-08-17T06:10:00.000Z" });
  assert.equal(readiness.ok, true);
  assert.equal(readiness.summary.localClosedLoops, 1);
  assert.equal(readiness.productionGate, "NO-GO");
  assert.equal(readiness.productionReady, false);
  assert.equal(readiness.blockers.length, 4);
});

test("institution pilot commands are idempotent and reject conflicting reuse", () => {
  let result = start("pilot-create-002", "corr-pilot-002");
  const sessionId = result.result.sessionId;
  const command = {
    commandId: "pilot-attempt-010",
    sessionId,
    expectedVersion: 0,
    adapterId: "hospital-his",
    outcome: "accepted",
    outboundEnvelopeDigest: digest("envelope-010")
  };
  result = recordInstitutionPilotAttempt(result.data, command, { now: "2026-08-17T07:00:00.000Z" });
  const replay = recordInstitutionPilotAttempt(result.data, command, { now: "2026-08-17T07:01:00.000Z" });
  assert.equal(replay.replayed, true);
  assert.equal(replay.result.attemptCount, 1);
  assert.throws(() => recordInstitutionPilotAttempt(result.data, {
    ...command,
    outboundEnvelopeDigest: digest("changed-envelope")
  }), (error) => error.code === "INSTITUTION_PILOT_COMMAND_CONFLICT");
});

test("institution pilot dead-letters retry exhaustion without storing provider payloads", () => {
  let result = start("pilot-create-003", "corr-pilot-003");
  const sessionId = result.result.sessionId;
  for (let index = 0; index < 3; index += 1) {
    result = recordInstitutionPilotAttempt(result.data, {
      commandId: `pilot-attempt-02${index}`,
      sessionId,
      expectedVersion: index,
      adapterId: "hospital-emr",
      outcome: "retryable-failure",
      outboundEnvelopeDigest: digest("envelope-retry"),
      errorCode: "SYNTHETIC_UNAVAILABLE"
    }, { now: `2026-08-17T08:0${index}:00.000Z` });
  }
  assert.equal(result.result.status, "dead-letter");
  assert.equal(result.result.attemptCount, 3);
  const stored = result.data.institutionPilotSessions[0].attempts[0];
  assert.equal(stored.patientDataStored, false);
  assert.equal(stored.credentialsStored, false);
  assert.equal(Object.hasOwn(stored, "payload"), false);
  const readiness = buildInstitutionPilotReadiness(result.data);
  assert.equal(readiness.ok, false);
  assert.equal(readiness.summary.deadLetters, 1);
  assert.equal(readiness.productionReady, false);
});

test("institution pilot fails closed for unsafe fields and premature closure", () => {
  assert.throws(() => createInstitutionPilotSession({}, {
    commandId: "pilot-create-unsafe",
    regionCode: "999999",
    institutionSlot: "unsafe-hospital",
    correlationId: "corr-pilot-unsafe",
    endpoint: "https://provider.example"
  }), /cannot contain endpoint/);

  const result = start("pilot-create-004", "corr-pilot-004");
  assert.throws(() => recordInstitutionPilotAttempt(result.data, {
    commandId: "pilot-attempt-stale",
    sessionId: result.result.sessionId,
    expectedVersion: 2,
    adapterId: "hospital-his",
    outcome: "accepted",
    outboundEnvelopeDigest: digest("stale-envelope")
  }), (error) => error.code === "INSTITUTION_PILOT_VERSION_CONFLICT");
  assert.throws(() => closeChronicReferralPilot(result.data, {
    commandId: "pilot-closure-004",
    sessionId: result.result.sessionId,
    expectedVersion: 0,
    subjectRefDigest: digest("synthetic-subject")
  }), (error) => error.code === "INSTITUTION_PILOT_CLOSURE_NOT_ALLOWED");
});
