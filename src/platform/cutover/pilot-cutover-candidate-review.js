"use strict";

const {
  assertMetadataOnly,
  createTechnicalEvidenceFingerprint
} = require("../governance/technical-evidence");

const CONTROL_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: "signed-cutover-authorization",
    owner: "release-committee",
    nextAction: "Complete current external evidence, signed rehearsal and four-party approval.",
    ready: (reports) => reports.authorization?.decision === "GO-CANDIDATE"
      && reports.authorization?.cutoverExecutionAuthorized === false
  }),
  Object.freeze({
    id: "preproduction-environment",
    owner: "platform-operations",
    nextAction: "Verify all pre-production components and recovery scenarios.",
    ready: (reports) => reports.preproduction?.ready === true
  }),
  Object.freeze({
    id: "signed-joint-tests",
    owner: "external-integration",
    nextAction: "Archive fresh dual-signed joint-test receipts for every required lane.",
    ready: (reports) => reports.jointTests?.ready === true
      || reports.jointTests?.jointTestReady === true
  }),
  Object.freeze({
    id: "monitoring-security-acceptance",
    owner: "security-compliance",
    nextAction: "Verify alert delivery, acknowledgement, escalation, recovery and security acceptance.",
    ready: (reports) => reports.monitoring?.ready === true
      || reports.monitoring?.deliveryReady === true
  }),
  Object.freeze({
    id: "human-controlled-rehearsal",
    owner: "release-commander",
    nextAction: "Complete the seven-seat rehearsal, rollback command and T+1 observations.",
    ready: (reports) => reports.rehearsal?.ready === true
      && reports.rehearsal?.cutoverExecutionAuthorized === false
  })
]);

function clean(value, maximum = 240) {
  return String(value || "").trim().replace(/[\r\n\t]+/g, " ").slice(0, maximum);
}

function buildPilotCutoverCandidateReview(reports = {}, options = {}) {
  assertMetadataOnly(reports, "pilotCutoverCandidateReports");
  const evaluatedAt = new Date(options.now || new Date().toISOString());
  if (!Number.isFinite(evaluatedAt.getTime())) {
    throw Object.assign(new Error("candidate review time is invalid"), {
      code: "PILOT_CUTOVER_CANDIDATE_TIME_INVALID"
    });
  }
  const controls = Object.freeze(CONTROL_DEFINITIONS.map((definition) => Object.freeze({
    id: definition.id,
    owner: definition.owner,
    ready: definition.ready(reports),
    nextAction: definition.nextAction
  })));
  const blockers = Object.freeze(controls
    .filter((control) => !control.ready)
    .map((control) => Object.freeze({
      id: control.id,
      owner: control.owner,
      severity: "blocking",
      nextAction: control.nextAction
    })));
  const packageFingerprints = [
    reports.authorization?.evidenceFingerprint,
    reports.authorization?.ledger?.packageFingerprint,
    reports.preproduction?.packageFingerprint,
    reports.jointTests?.packageFingerprint,
    reports.rehearsal?.packageFingerprint
  ].map((value) => clean(value, 80)).filter(Boolean);
  const releaseIds = [
    reports.authorization?.releaseId,
    reports.authorization?.ledger?.releaseId,
    reports.preproduction?.releaseId,
    reports.jointTests?.releaseId,
    reports.rehearsal?.releaseId
  ].map((value) => clean(value, 160)).filter(Boolean);
  const bindings = Object.freeze({
    packageFingerprint: packageFingerprints.length >= 4
      && new Set(packageFingerprints).size === 1,
    releaseId: releaseIds.length >= 4 && new Set(releaseIds).size === 1
  });
  const ready = blockers.length === 0 && Object.values(bindings).every(Boolean);
  const projection = {
    schema: "pilot-cutover-candidate-review-v1",
    evaluatedAt: evaluatedAt.toISOString(),
    releaseId: releaseIds[0] || "",
    packageFingerprint: packageFingerprints[0] || "",
    controls,
    bindings,
    blockers,
    decision: ready ? "GO-CANDIDATE" : "NO-GO",
    cutoverExecutionAuthorized: false,
    productionPrimary: false,
    productionReady: false,
    boundary: "GO-CANDIDATE is a review result only. Production cutover remains an externally approved human command."
  };
  return Object.freeze({
    ...projection,
    technicalEvidenceFingerprint: createTechnicalEvidenceFingerprint(
      "pilot-cutover-candidate-review-v1",
      projection
    )
  });
}

module.exports = {
  CONTROL_DEFINITIONS,
  buildPilotCutoverCandidateReview
};
