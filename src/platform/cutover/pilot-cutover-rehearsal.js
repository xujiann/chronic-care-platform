"use strict";

const {
  SHA256,
  assertMetadataOnly
} = require("../governance/technical-evidence");

const REHEARSAL_SCHEMA = "pilot-cutover-rehearsal-v1";
const REQUIRED_REHEARSAL_CHECKPOINTS = Object.freeze([
  "freeze-writes",
  "snapshot",
  "switch-read",
  "verify-business-loop",
  "rollback",
  "post-rollback-verify"
]);
const CONTROLLED_REFERENCE = /^(?:vault|evidence|artifact|cmdb|ticket):\/\/[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]+$/;

function rehearsalError(code, message) {
  return Object.assign(new Error(message), { code, statusCode: 400 });
}

function clean(value, maximum = 240) {
  return String(value || "").trim().replace(/[\r\n\t]+/g, " ").slice(0, maximum);
}

function instant(value, label) {
  const timestamp = Date.parse(value || "");
  if (!Number.isFinite(timestamp)) {
    throw rehearsalError("PILOT_CUTOVER_REHEARSAL_TIME_INVALID", `${label} must be an ISO timestamp`);
  }
  return timestamp;
}

function validatePilotCutoverRehearsal(payload = {}) {
  assertMetadataOnly(payload, "pilotCutoverRehearsal");
  const startedAt = instant(payload.startedAt, "startedAt");
  const completedAt = instant(payload.completedAt, "completedAt");
  const maximumRollbackMinutes = Number(payload.maximumRollbackMinutes);
  const actualRollbackMinutes = Number(payload.actualRollbackMinutes);
  const checkpoints = Array.isArray(payload.checkpoints) ? payload.checkpoints : [];
  const checkpointIds = new Set(checkpoints.map((row) => clean(row?.id, 120)));
  const validCheckpoints = checkpoints.length === REQUIRED_REHEARSAL_CHECKPOINTS.length
    && REQUIRED_REHEARSAL_CHECKPOINTS.every((id) => checkpointIds.has(id))
    && checkpoints.every((row) =>
      row?.passed === true
      && CONTROLLED_REFERENCE.test(clean(row.evidenceRef, 240))
      && SHA256.test(clean(row.evidenceDigest, 80)));
  if (payload.schemaVersion !== REHEARSAL_SCHEMA
    || !clean(payload.rehearsalId, 160)
    || payload.environment !== "pre-production"
    || !clean(payload.releaseId, 160)
    || !SHA256.test(clean(payload.packageFingerprint, 80))
    || !clean(payload.coordinatorAccount, 160)
    || !clean(payload.rollbackOwner, 160)
    || payload.result !== "passed"
    || completedAt <= startedAt
    || !Number.isFinite(maximumRollbackMinutes)
    || maximumRollbackMinutes <= 0
    || maximumRollbackMinutes > 240
    || !Number.isFinite(actualRollbackMinutes)
    || actualRollbackMinutes < 0
    || actualRollbackMinutes > maximumRollbackMinutes
    || !validCheckpoints) {
    throw rehearsalError(
      "PILOT_CUTOVER_REHEARSAL_INVALID",
      "pre-production rehearsal requires package binding, six passed checkpoints and rollback within the approved time"
    );
  }
  return true;
}

function evaluatePilotCutoverRehearsal(options = {}) {
  const now = instant(options.now || new Date().toISOString(), "evaluationTime");
  const maximumAgeHours = Number(options.maximumAgeHours ?? 24);
  const event = options.event;
  const revoked = options.revokedEventIds?.has(event?.eventId) === true;
  const trust = event && typeof options.trustVerifier?.verifyEvent === "function"
    ? options.trustVerifier.verifyEvent(event, new Date(now).toISOString())
    : { trusted: false };
  const completedAt = Date.parse(event?.payload?.completedAt || "");
  const checks = Object.freeze({
    recorded: Boolean(event),
    packageBound: Boolean(event)
      && event.payload.releaseId === options.releaseId
      && event.payload.packageFingerprint === options.packageFingerprint,
    active: Boolean(event) && !revoked,
    passed: Boolean(event) && event.payload.result === "passed",
    rollbackWithinTarget: Boolean(event)
      && Number(event.payload.actualRollbackMinutes) <= Number(event.payload.maximumRollbackMinutes),
    checkpoints: Boolean(event)
      && REQUIRED_REHEARSAL_CHECKPOINTS.every((id) =>
        event.payload.checkpoints.some((row) => row.id === id && row.passed === true)),
    fresh: Boolean(event)
      && Number.isFinite(maximumAgeHours)
      && maximumAgeHours > 0
      && completedAt <= now
      && now - completedAt <= maximumAgeHours * 60 * 60 * 1000,
    trusted: trust.trusted === true
  });
  return Object.freeze({
    schema: "pilot-cutover-rehearsal-readiness-v1",
    rehearsalId: clean(event?.payload?.rehearsalId, 160),
    completedAt: clean(event?.payload?.completedAt, 40),
    maximumAgeHours,
    rollback: Object.freeze({
      owner: clean(event?.payload?.rollbackOwner, 160),
      targetMinutes: Number(event?.payload?.maximumRollbackMinutes) || 0,
      actualMinutes: Number(event?.payload?.actualRollbackMinutes) || 0
    }),
    checkpoints: Object.freeze(event?.payload?.checkpoints?.map((row) => Object.freeze({
      id: clean(row.id, 120),
      passed: row.passed === true,
      evidenceRef: clean(row.evidenceRef, 240),
      evidenceDigest: clean(row.evidenceDigest, 80)
    })) || []),
    checks,
    trust,
    ready: Object.values(checks).every(Boolean),
    productionReady: false
  });
}

module.exports = {
  REHEARSAL_SCHEMA,
  REQUIRED_REHEARSAL_CHECKPOINTS,
  evaluatePilotCutoverRehearsal,
  validatePilotCutoverRehearsal
};
