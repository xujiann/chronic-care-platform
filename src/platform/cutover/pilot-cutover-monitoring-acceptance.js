"use strict";

const {
  readBoundedJsonFile
} = require("./pilot-cutover-package");
const {
  SHA256,
  assertMetadataOnly,
  createTechnicalEvidenceFingerprint
} = require("../governance/technical-evidence");

const ACCEPTANCE_SCHEMA = "pilot-cutover-monitoring-acceptance-v1";
const REQUIRED_CHECKS = Object.freeze([
  "metadata-minimization",
  "siem-or-webhook-delivery",
  "duty-acknowledgement",
  "p0-escalation",
  "receiver-outage-dead-letter-redrive",
  "verified-recovery"
]);
const CONTROLLED_REFERENCE = /^(?:vault|evidence|artifact|cmdb|ticket|monitoring):\/\/[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]+$/;

function clean(value, maximum = 240) {
  return String(value || "").trim().replace(/[\r\n\t]+/g, " ").slice(0, maximum);
}

function instant(value) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? timestamp : NaN;
}

function evaluatePilotCutoverMonitoringAcceptance(input = {}, options = {}) {
  assertMetadataOnly(input, "pilotCutoverMonitoringAcceptance");
  const journal = options.journal || {};
  assertMetadataOnly(journal, "pilotCutoverAlertJournal");
  const now = instant(options.now || new Date().toISOString());
  const startedAt = instant(input.observedWindow?.startedAt);
  const completedAt = instant(input.observedWindow?.completedAt);
  const checksById = new Map((Array.isArray(input.checks) ? input.checks : [])
    .map((row) => [clean(row?.id, 120), row]));
  const evidenceChecks = Object.freeze(Object.fromEntries(REQUIRED_CHECKS.map((id) => {
    const row = checksById.get(id);
    return [id, row?.status === "verified"
      && CONTROLLED_REFERENCE.test(clean(row.evidenceRef, 240))
      && SHA256.test(clean(row.evidenceDigest, 80))];
  })));
  const checks = Object.freeze({
    schema: input.schemaVersion === ACCEPTANCE_SCHEMA,
    acceptedStatus: input.status === "verified",
    releaseBinding: clean(input.releaseId, 160)
      === clean(options.releaseId || input.releaseId, 160)
      && SHA256.test(clean(input.packageFingerprint, 80))
      && clean(input.packageFingerprint, 80)
        === clean(options.packageFingerprint || input.packageFingerprint, 80),
    independentReview: Boolean(clean(input.monitoringOwnerAccount, 160))
      && Boolean(clean(input.securityReviewerAccount, 160))
      && clean(input.monitoringOwnerAccount, 160)
        !== clean(input.securityReviewerAccount, 160),
    observedWindow: Number.isFinite(now)
      && Number.isFinite(startedAt)
      && Number.isFinite(completedAt)
      && startedAt < completedAt
      && completedAt <= now,
    acceptanceEvidence: CONTROLLED_REFERENCE.test(clean(input.acceptanceEvidenceRef, 240))
      && SHA256.test(clean(input.acceptanceEvidenceDigest, 80)),
    requiredChecks: Object.values(evidenceChecks).every(Boolean),
    journalChain: journal.chainValid === true
      && SHA256.test(clean(input.journalHeadDigest, 80))
      && clean(input.journalHeadDigest, 80) === clean(journal.headDigest, 80),
    lifecycleClosed: Number(journal.summary?.open) === 0
      && Number(journal.summary?.critical) === 0
      && Number(journal.summary?.deadLetter) === 0
  });
  const ready = Object.values(checks).every(Boolean);
  const projection = {
    schema: "pilot-cutover-monitoring-acceptance-report-v1",
    evaluatedAt: Number.isFinite(now) ? new Date(now).toISOString() : "",
    releaseId: clean(input.releaseId, 160),
    packageFingerprint: clean(input.packageFingerprint, 80),
    journalHeadDigest: clean(input.journalHeadDigest, 80),
    checks,
    evidenceChecks,
    ready,
    deliveryReady: ready,
    decision: ready ? "MONITORING-ACCEPTED" : "NO-GO",
    monitoringAcceptanceProven: ready,
    cutoverExecutionAuthorized: false,
    productionReady: false,
    boundary: "Acceptance verifies controlled metadata and a closed alert journal only. It cannot deliver alerts or authorize production cutover."
  };
  return Object.freeze({
    ...projection,
    technicalEvidenceFingerprint: createTechnicalEvidenceFingerprint(
      projection.schema,
      projection
    )
  });
}

function evaluatePilotCutoverMonitoringAcceptanceFile(options = {}) {
  return evaluatePilotCutoverMonitoringAcceptance(readBoundedJsonFile(options.file, {
    label: "pilot cutover monitoring acceptance",
    maximumBytes: 512 * 1024
  }), options);
}

module.exports = {
  ACCEPTANCE_SCHEMA,
  REQUIRED_CHECKS,
  evaluatePilotCutoverMonitoringAcceptance,
  evaluatePilotCutoverMonitoringAcceptanceFile
};
