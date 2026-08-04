"use strict";

const {
  DUTY_SEATS
} = require("./pilot-cutover-command-plan");
const {
  REQUIRED_REHEARSAL_CHECKPOINTS
} = require("./pilot-cutover-rehearsal");
const {
  readBoundedJsonFile
} = require("./pilot-cutover-package");
const {
  SHA256,
  assertMetadataOnly,
  createTechnicalEvidenceFingerprint
} = require("../governance/technical-evidence");

const SESSION_SCHEMA = "pilot-cutover-rehearsal-session-v1";
const MAX_SESSION_BYTES = 512 * 1024;
const REQUIRED_OBSERVATIONS = Object.freeze([
  "business-success-and-error-rate",
  "outbox-lag-and-reconciliation",
  "data-consistency-and-late-arrivals",
  "security-alerts-and-access-anomalies",
  "institution-feedback-and-support-cases",
  "evidence-ledger-expiry-revocation-and-chain"
]);
const CONTROLLED_REFERENCE = /^(?:vault|evidence|artifact|cmdb|ticket):\/\/[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]+$/;

function sessionError(code, message) {
  return Object.assign(new Error(message), { code, statusCode: 400 });
}

function clean(value, maximum = 240) {
  return String(value || "").trim().replace(/[\r\n\t]+/g, " ").slice(0, maximum);
}

function instant(value) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? timestamp : NaN;
}

function receiptValid(row, timeField) {
  return row?.passed === true
    && CONTROLLED_REFERENCE.test(clean(row.evidenceRef, 240))
    && SHA256.test(clean(row.evidenceDigest, 80))
    && Number.isFinite(instant(row[timeField]));
}

function evaluatePilotCutoverRehearsalSession(input = {}, options = {}) {
  assertMetadataOnly(input, "pilotCutoverRehearsalSession");
  const now = instant(options.now || new Date().toISOString());
  const openedAt = instant(input.openedAt);
  const closedAt = instant(input.closedAt);
  if (!Number.isFinite(now)
    || input.schemaVersion !== SESSION_SCHEMA
    || input.environment !== "pre-production"
    || !clean(input.sessionId, 160)
    || !clean(input.releaseId, 160)
    || !SHA256.test(clean(input.packageFingerprint, 80))
    || !Array.isArray(input.seats)
    || !Array.isArray(input.checkpoints)
    || !Array.isArray(input.observations)
    || !Number.isFinite(openedAt)
    || !Number.isFinite(closedAt)) {
    throw sessionError(
      "PILOT_CUTOVER_REHEARSAL_SESSION_INVALID",
      "rehearsal session must bind a pre-production environment, release and package"
    );
  }
  const seats = new Map(input.seats.map((row) => [clean(row?.id, 120), row]));
  const requiredSeatIds = DUTY_SEATS.map((row) => row.id);
  const selectedSeats = requiredSeatIds.map((id) => seats.get(id)).filter(Boolean);
  const seatAccounts = selectedSeats.map((row) => clean(row.account, 160));
  const seatsReady = selectedSeats.length === requiredSeatIds.length
    && new Set(seatAccounts).size === requiredSeatIds.length
    && selectedSeats.every((row) =>
      clean(row.account, 160)
      && CONTROLLED_REFERENCE.test(clean(row.evidenceRef, 240))
      && SHA256.test(clean(row.evidenceDigest, 80))
      && instant(row.confirmedAt) >= openedAt
      && instant(row.confirmedAt) <= closedAt);
  const checkpoints = new Map(input.checkpoints.map((row) => [clean(row?.id, 120), row]));
  const selectedCheckpoints = REQUIRED_REHEARSAL_CHECKPOINTS
    .map((id) => checkpoints.get(id))
    .filter(Boolean);
  const checkpointsReady = selectedCheckpoints.length === REQUIRED_REHEARSAL_CHECKPOINTS.length
    && selectedCheckpoints.every((row) =>
      receiptValid(row, "completedAt")
      && instant(row.completedAt) >= openedAt
      && instant(row.completedAt) <= closedAt);
  const observations = new Map(input.observations.map((row) => [clean(row?.id, 120), row]));
  const selectedObservations = REQUIRED_OBSERVATIONS
    .map((id) => observations.get(id))
    .filter(Boolean);
  const observationsReady = selectedObservations.length === REQUIRED_OBSERVATIONS.length
    && selectedObservations.every((row) =>
      receiptValid(row, "observedAt")
      && instant(row.observedAt) >= openedAt
      && instant(row.observedAt) <= now);
  const rollback = input.rollbackCommand || {};
  const releaseCommander = clean(seats.get("release-commander")?.account, 160);
  const platformOperations = clean(seats.get("platform-operations")?.account, 160);
  const observer = clean(seats.get("independent-observer")?.account, 160);
  const issuedAt = instant(rollback.issuedAt);
  const acknowledgedAt = instant(rollback.acknowledgedAt);
  const actualRollbackMinutes = Number(rollback.actualRollbackMinutes);
  const maximumRollbackMinutes = Number(input.maximumRollbackMinutes);
  const rollbackReady = rollback.phrase === `ROLLBACK PILOT ${input.releaseId}`
    && clean(rollback.issuedBy, 160) === releaseCommander
    && clean(rollback.acknowledgedBy, 160) === platformOperations
    && clean(rollback.witnessedBy, 160) === observer
    && issuedAt >= openedAt
    && acknowledgedAt >= issuedAt
    && acknowledgedAt <= closedAt
    && Number.isFinite(actualRollbackMinutes)
    && Number.isFinite(maximumRollbackMinutes)
    && actualRollbackMinutes >= 0
    && actualRollbackMinutes <= maximumRollbackMinutes;
  const checks = Object.freeze({
    packageBound: input.releaseId === clean(options.releaseId || input.releaseId, 160)
      && input.packageFingerprint === clean(
        options.packageFingerprint || input.packageFingerprint,
        80
      ),
    sessionWindow: openedAt < closedAt && closedAt <= now,
    dutySeats: seatsReady,
    checkpoints: checkpointsReady,
    rollbackCommand: rollbackReady,
    observations: observationsReady
  });
  const ready = Object.values(checks).every(Boolean);
  const projection = {
    schema: "pilot-cutover-rehearsal-session-report-v1",
    evaluatedAt: new Date(now).toISOString(),
    sessionId: clean(input.sessionId, 160),
    releaseId: clean(input.releaseId, 160),
    packageFingerprint: clean(input.packageFingerprint, 80),
    openedAt: new Date(openedAt).toISOString(),
    closedAt: new Date(closedAt).toISOString(),
    checks,
    rollback: Object.freeze({
      owner: platformOperations,
      maximumMinutes: Number.isFinite(maximumRollbackMinutes) ? maximumRollbackMinutes : 0,
      actualMinutes: Number.isFinite(actualRollbackMinutes) ? actualRollbackMinutes : 0,
      phraseVerified: rollbackReady
    }),
    seats: Object.freeze(selectedSeats.map((row) => Object.freeze({
      id: clean(row.id, 120),
      account: clean(row.account, 160),
      confirmedAt: clean(row.confirmedAt, 40)
    }))),
    checkpoints: Object.freeze(selectedCheckpoints.map((row) => Object.freeze({
      id: clean(row.id, 120),
      passed: row.passed === true,
      evidenceRef: clean(row.evidenceRef, 240),
      evidenceDigest: clean(row.evidenceDigest, 80)
    }))),
    ready,
    decision: ready ? "REHEARSAL-PASSED" : "NO-GO",
    cutoverExecutionAuthorized: false,
    productionReady: false,
    boundary: "This session verifies human-controlled rehearsal metadata and never invokes cutover or rollback."
  };
  return Object.freeze({
    ...projection,
    technicalEvidenceFingerprint: createTechnicalEvidenceFingerprint(
      "pilot-cutover-rehearsal-session-report-v1",
      projection
    )
  });
}

function buildRehearsalLedgerPayload(input = {}, report = evaluatePilotCutoverRehearsalSession(input)) {
  if (!report.ready) {
    throw sessionError(
      "PILOT_CUTOVER_REHEARSAL_SESSION_NOT_READY",
      "only a passed rehearsal session can produce ledger metadata"
    );
  }
  return Object.freeze({
    schemaVersion: "pilot-cutover-rehearsal-v1",
    rehearsalId: report.sessionId,
    environment: "pre-production",
    releaseId: report.releaseId,
    packageFingerprint: report.packageFingerprint,
    coordinatorAccount: clean(input.coordinatorAccount, 160),
    rollbackOwner: report.rollback.owner,
    startedAt: report.openedAt,
    completedAt: report.closedAt,
    maximumRollbackMinutes: report.rollback.maximumMinutes,
    actualRollbackMinutes: report.rollback.actualMinutes,
    result: "passed",
    checkpoints: report.checkpoints,
    sessionEvidenceFingerprint: report.technicalEvidenceFingerprint
  });
}

function evaluatePilotCutoverRehearsalSessionFile(options = {}) {
  const input = readBoundedJsonFile(options.file, {
    label: "pilot cutover rehearsal session",
    maximumBytes: MAX_SESSION_BYTES
  });
  return evaluatePilotCutoverRehearsalSession(input, options);
}

module.exports = {
  MAX_SESSION_BYTES,
  REQUIRED_OBSERVATIONS,
  SESSION_SCHEMA,
  buildRehearsalLedgerPayload,
  evaluatePilotCutoverRehearsalSession,
  evaluatePilotCutoverRehearsalSessionFile
};
