"use strict";

const DUTY_SEATS = Object.freeze([
  Object.freeze({ id: "release-commander", authority: "announce-checkpoints-and-hold" }),
  Object.freeze({ id: "business-owner", authority: "confirm-business-loop" }),
  Object.freeze({ id: "platform-operations", authority: "operate-platform-and-rollback" }),
  Object.freeze({ id: "security-compliance", authority: "stop-on-security-signal" }),
  Object.freeze({ id: "data-platform", authority: "confirm-data-consistency" }),
  Object.freeze({ id: "institution-coordinator", authority: "coordinate-pilot-site" }),
  Object.freeze({ id: "independent-observer", authority: "record-evidence-and-timing" })
]);

const TIMELINE = Object.freeze([
  Object.freeze({ offset: "T-60m", action: "open-command-room-and-verify-duty-seats" }),
  Object.freeze({ offset: "T-30m", action: "verify-ledger-signatures-evidence-and-rehearsal" }),
  Object.freeze({ offset: "T-10m", action: "announce-freeze-and-final-no-go-window" }),
  Object.freeze({ offset: "T0", action: "human-controlled-cutover-checkpoint" }),
  Object.freeze({ offset: "T+15m", action: "business-data-security-observation" }),
  Object.freeze({ offset: "T+60m", action: "close-heightened-observation-or-rollback" }),
  Object.freeze({ offset: "T+1d", action: "complete-t-plus-one-review" })
]);

const ROLLBACK_TRIGGERS = Object.freeze([
  "data-consistency-check-failed",
  "business-loop-check-failed",
  "security-signal-critical",
  "monitoring-route-unavailable",
  "rollback-time-budget-at-risk",
  "release-commander-or-stop-authority-calls-hold"
]);

function clean(value, maximum = 240) {
  return String(value || "").trim().replace(/[\r\n\t]+/g, " ").slice(0, maximum);
}

function buildPilotCutoverCommandPlan(options = {}) {
  const releaseId = clean(options.releaseId, 160);
  const packageFingerprint = clean(options.packageFingerprint, 80);
  return Object.freeze({
    schema: "pilot-cutover-command-plan-v1",
    releaseId,
    packageFingerprint,
    executionMode: "human-controlled",
    dutySeats: DUTY_SEATS,
    timeline: TIMELINE,
    rollback: Object.freeze({
      phraseTemplate: `ROLLBACK PILOT ${releaseId || "<release-id>"}`,
      issuedBy: "release-commander",
      acknowledgedBy: "platform-operations",
      secondWitness: "independent-observer",
      triggers: ROLLBACK_TRIGGERS,
      rule: "Any stop authority may request HOLD; the release commander must issue rollback before the approved rollback budget is exhausted."
    }),
    tPlusOneObservation: Object.freeze([
      "business-success-and-error-rate",
      "outbox-lag-and-reconciliation",
      "data-consistency-and-late-arrivals",
      "security-alerts-and-access-anomalies",
      "institution-feedback-and-support-cases",
      "evidence-ledger-expiry-revocation-and-chain"
    ]),
    commandReady: Boolean(releaseId && packageFingerprint),
    cutoverExecutionAuthorized: false,
    productionReady: false,
    boundary: "This plan defines human roles and commands. It cannot invoke deployment, traffic switching, database writes or rollback."
  });
}

module.exports = {
  DUTY_SEATS,
  ROLLBACK_TRIGGERS,
  TIMELINE,
  buildPilotCutoverCommandPlan
};
