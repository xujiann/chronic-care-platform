"use strict";

const {
  evaluatePilotCutoverAuthorizationLedger
} = require("./pilot-cutover-authorization-ledger");

function clean(value, maximum = 240) {
  return String(value || "").trim().replace(/[\r\n\t]+/g, " ").slice(0, maximum);
}

function numeric(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}

function blockedPilotCutoverControlHealth(error, now = new Date().toISOString()) {
  const code = clean(error?.code || "PILOT_CUTOVER_CONTROL_HEALTH_UNAVAILABLE", 120);
  return Object.freeze({
    schema: "pilot-cutover-control-health-v1",
    evaluatedAt: now,
    status: "blocked",
    decision: "NO-GO",
    signals: Object.freeze({
      ledgerChain: false,
      trustRegistry: false,
      externalEvidence: false,
      approvals: false,
      rehearsal: false
    }),
    lifecycle: Object.freeze({
      total: 0,
      current: 0,
      expiringSoon: 0,
      expired: 0,
      revoked: 0,
      untrusted: 0
    }),
    alerts: Object.freeze([Object.freeze({
      severity: "critical",
      code,
      message: "pilot cutover control evidence is unavailable or the ledger integrity check failed"
    })]),
    cutoverExecutionAuthorized: false,
    productionReady: false
  });
}

function buildPilotCutoverControlHealth(control, options = {}) {
  const nowIso = options.now || control.evaluatedAt || new Date().toISOString();
  const now = Date.parse(nowIso);
  const warningHours = numeric(options.warningHours, 24, 1, 720);
  const warningWindow = warningHours * 60 * 60 * 1000;
  const rows = control.ledger?.lifecycle || [];
  const classified = rows.map((row) => {
    const expiresAt = Date.parse(row.expiresAt || "");
    const expired = Number.isFinite(expiresAt) && expiresAt <= now;
    const expiringSoon = Number.isFinite(expiresAt)
      && expiresAt > now
      && expiresAt - now <= warningWindow;
    return { ...row, expired, expiringSoon };
  });
  const lifecycle = Object.freeze({
    total: classified.length,
    current: classified.filter((row) => !row.revoked && !row.expired).length,
    expiringSoon: classified.filter((row) => !row.revoked && row.expiringSoon).length,
    expired: classified.filter((row) => row.expired).length,
    revoked: classified.filter((row) => row.revoked).length,
    untrusted: classified.filter((row) => !row.trusted).length
  });
  const signals = Object.freeze({
    ledgerChain: control.ledger?.chainValid === true,
    trustRegistry: control.ledger?.trustReady === true,
    externalEvidence: control.ledger?.evidenceReady === true,
    approvals: control.ledger?.approvalsReady === true,
    rehearsal: control.ledger?.rehearsalReady === true
  });
  const alerts = [];
  if (!signals.ledgerChain) alerts.push(["critical", "LEDGER_CHAIN_INVALID", "authorization ledger chain is invalid"]);
  if (!signals.trustRegistry) alerts.push(["critical", "TRUST_VERIFICATION_BLOCKED", "one or more required signatures are untrusted"]);
  if (!signals.externalEvidence) alerts.push(["critical", "EXTERNAL_EVIDENCE_BLOCKED", "external evidence is missing, expired or revoked"]);
  if (!signals.approvals) alerts.push(["critical", "APPROVALS_BLOCKED", "independent approvals are incomplete or invalid"]);
  if (!signals.rehearsal) alerts.push(["critical", "REHEARSAL_STALE_OR_BLOCKED", "pre-production rehearsal is missing, stale or failed"]);
  if (lifecycle.expiringSoon > 0) alerts.push(["warning", "EVIDENCE_EXPIRING_SOON", `${lifecycle.expiringSoon} ledger events expire within ${warningHours} hours`]);
  if (lifecycle.expired > 0) alerts.push(["warning", "LEDGER_EVENTS_EXPIRED", `${lifecycle.expired} ledger events are expired`]);
  if (lifecycle.revoked > 0) alerts.push(["warning", "LEDGER_EVENTS_REVOKED", `${lifecycle.revoked} ledger events are revoked`]);
  if (lifecycle.untrusted > 0) alerts.push(["warning", "LEDGER_EVENTS_UNTRUSTED", `${lifecycle.untrusted} ledger events are not trusted by the current public-key registry`]);
  const ready = Object.values(signals).every(Boolean);
  const status = ready
    ? (alerts.some((row) => row[0] === "warning") ? "warning" : "healthy")
    : "blocked";
  return Object.freeze({
    schema: "pilot-cutover-control-health-v1",
    evaluatedAt: new Date(now).toISOString(),
    status,
    decision: ready && control.decision === "GO-CANDIDATE" ? "GO-CANDIDATE" : "NO-GO",
    warningHours,
    signals,
    lifecycle,
    rehearsal: control.ledger?.rehearsal || null,
    ledgerHeadDigest: clean(control.ledger?.headDigest, 80),
    alerts: Object.freeze(alerts.map(([severity, code, message]) =>
      Object.freeze({ severity, code, message }))),
    cutoverExecutionAuthorized: false,
    productionReady: false,
    boundary: "Health signals observe signed metadata and freshness only; they neither execute cutover nor replace on-site command."
  });
}

function evaluatePilotCutoverControlHealth(options = {}) {
  const now = options.now || new Date().toISOString();
  try {
    const control = options.control || evaluatePilotCutoverAuthorizationLedger(options);
    return buildPilotCutoverControlHealth(control, {
      now,
      warningHours: options.warningHours
        ?? options.env?.PLATFORM_PILOT_CUTOVER_EVIDENCE_WARNING_HOURS
        ?? process.env.PLATFORM_PILOT_CUTOVER_EVIDENCE_WARNING_HOURS
    });
  } catch (error) {
    return blockedPilotCutoverControlHealth(error, now);
  }
}

module.exports = {
  blockedPilotCutoverControlHealth,
  buildPilotCutoverControlHealth,
  evaluatePilotCutoverControlHealth
};
