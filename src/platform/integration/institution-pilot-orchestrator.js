"use strict";

const { createHash } = require("node:crypto");
const program = require("../../../config/institution-pilot-program.json");
const institutionCatalog = require("../../../config/institution-integration-catalog.json");
const {
  assertSafeProfile,
  registerInstitutionIntegrationProfile,
  runInstitutionSyntheticJointTest
} = require("../productization/institution-integration-center");
const {
  applyRegionalBusinessEvent,
  createRegionalBusinessLoop,
  evaluateRegionalBusinessLoop
} = require("../orchestration/regional-business-loop");

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const SESSION_ID = /^ip-[a-f0-9]{20}$/;
const OUTCOMES = new Set(["accepted", "retryable-failure", "permanent-failure"]);

function pilotError(code, message, statusCode = 409) {
  return Object.assign(new Error(message), { code, statusCode });
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return `sha256:${createHash("sha256").update(stableStringify(value)).digest("hex")}`;
}

function clean(value, maximum = 200) {
  return String(value || "").trim().replace(/[\r\n\t]+/g, " ").slice(0, maximum);
}

function required(value, label, maximum = 200) {
  const result = clean(value, maximum);
  if (!result) throw pilotError("INSTITUTION_PILOT_INPUT_INVALID", `${label} is required`, 400);
  return result;
}

function timestamp(value, label) {
  const date = new Date(value || new Date().toISOString());
  if (!Number.isFinite(date.getTime())) {
    throw pilotError("INSTITUTION_PILOT_TIME_INVALID", `${label} is invalid`, 400);
  }
  return date.toISOString();
}

function validateProgram(value = program, catalog = institutionCatalog) {
  if (value?.schemaVersion !== "institution-pilot-program-v1"
    || !Array.isArray(value.adapterProfiles)
    || value.adapterProfiles.length === 0) {
    throw new TypeError("institution pilot program is invalid");
  }
  const adapterIds = new Set((catalog.adapters || []).map((item) => item.id));
  const profileIds = new Set();
  for (const profile of value.adapterProfiles) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(profile.id || "") || profileIds.has(profile.id)) {
      throw new TypeError("institution pilot adapter profile ids must be unique kebab-case values");
    }
    if (!Array.isArray(profile.adapters)
      || profile.adapters.length === 0
      || profile.adapters.some((item) => !adapterIds.has(item))) {
      throw new TypeError("institution pilot adapter profiles must use catalog adapters");
    }
    if (!Array.isArray(profile.requiredClosureEvents)
      || profile.requiredClosureEvents.length !== 5) {
      throw new TypeError("institution pilot adapter profiles require the chronic referral closure event chain");
    }
    profileIds.add(profile.id);
  }
  const retry = value.retryPolicy || {};
  if (!Number.isInteger(retry.maxAttempts) || retry.maxAttempts < 1
    || !Number.isInteger(retry.baseDelaySeconds) || retry.baseDelaySeconds < 1
    || !Number.isInteger(retry.maximumDelaySeconds)
    || retry.maximumDelaySeconds < retry.baseDelaySeconds) {
    throw new TypeError("institution pilot retry policy is invalid");
  }
  return true;
}

function assertDigest(value, label) {
  const result = clean(value, 80);
  if (!SHA256.test(result)) {
    throw pilotError("INSTITUTION_PILOT_DIGEST_INVALID", `${label} must be a SHA-256 digest`, 400);
  }
  return result;
}

function assertCommandId(value) {
  const result = clean(value, 80);
  if (!/^[A-Za-z0-9._:-]{8,72}$/.test(result)) {
    throw pilotError("INSTITUTION_PILOT_COMMAND_INVALID", "commandId must be a bounded opaque identifier", 400);
  }
  return result;
}

function normalizeState(data) {
  const next = structuredClone(data || {});
  next.institutionPilotSessions = Array.isArray(next.institutionPilotSessions)
    ? next.institutionPilotSessions
    : [];
  next.institutionPilotCommands = Array.isArray(next.institutionPilotCommands)
    ? next.institutionPilotCommands
    : [];
  return next;
}

function publicSession(session) {
  return Object.freeze({
    sessionId: session.sessionId,
    profileId: session.profileId,
    adapterProfileId: session.adapterProfileId,
    regionCode: session.regionCode,
    institutionSlot: session.institutionSlot,
    correlationId: session.correlationId,
    adapterIds: Object.freeze([...session.adapterIds]),
    jointTestRunId: session.jointTestRunId,
    status: session.status,
    version: session.version,
    attemptCount: session.attempts.length,
    nextRetryAt: session.nextRetryAt || null,
    reconciliation: session.reconciliation ? Object.freeze(structuredClone(session.reconciliation)) : null,
    referralClosure: session.referralClosure ? Object.freeze(structuredClone(session.referralClosure)) : null,
    updatedAt: session.updatedAt,
    synthetic: true,
    externalEvidenceVerified: false,
    productionReady: false
  });
}

function findSession(data, sessionId) {
  if (!SESSION_ID.test(sessionId)) {
    throw pilotError("INSTITUTION_PILOT_SESSION_INVALID", "sessionId is invalid", 400);
  }
  const session = data.institutionPilotSessions.find((item) => item.sessionId === sessionId);
  if (!session) throw pilotError("INSTITUTION_PILOT_SESSION_NOT_FOUND", "institution pilot session was not found", 404);
  return session;
}

function commandReplay(data, commandId, requestDigest) {
  const existing = data.institutionPilotCommands.find((item) => item.commandId === commandId);
  if (!existing) return null;
  if (existing.requestDigest !== requestDigest) {
    throw pilotError("INSTITUTION_PILOT_COMMAND_CONFLICT", "institution pilot command id was reused with different metadata");
  }
  return existing;
}

function assertVersion(session, expectedVersion) {
  if (!Number.isInteger(Number(expectedVersion)) || Number(expectedVersion) !== session.version) {
    throw pilotError("INSTITUTION_PILOT_VERSION_CONFLICT", "institution pilot expectedVersion does not match");
  }
}

function createInstitutionPilotSession(data, command = {}, options = {}) {
  const activeProgram = options.program || program;
  const catalog = options.catalog || institutionCatalog;
  validateProgram(activeProgram, catalog);
  assertSafeProfile(command, catalog);
  const commandId = assertCommandId(command.commandId);
  const regionCode = required(command.regionCode, "regionCode", 6);
  const institutionSlot = required(command.institutionSlot, "institutionSlot", 80);
  const correlationId = required(command.correlationId, "correlationId", 120);
  const adapterProfileId = required(command.adapterProfileId || "chronic-referral-core", "adapterProfileId", 80);
  const adapterProfile = activeProgram.adapterProfiles.find((item) => item.id === adapterProfileId);
  if (!adapterProfile) throw pilotError("INSTITUTION_PILOT_ADAPTER_PROFILE_NOT_FOUND", "adapter profile was not found", 404);
  let next = normalizeState(data);
  const requestDigest = digest({ adapterProfileId, correlationId, institutionSlot, regionCode });
  const replay = commandReplay(next, commandId, requestDigest);
  if (replay) {
    return Object.freeze({ data: next, result: publicSession(findSession(next, replay.sessionId)), replayed: true });
  }
  const now = timestamp(options.now, "session time");
  const registered = registerInstitutionIntegrationProfile(next, {
    commandId: `${commandId}:profile`,
    regionCode,
    institutionSlot,
    adapters: adapterProfile.adapters
  }, { catalog, now });
  const jointTest = runInstitutionSyntheticJointTest(registered.data, {
    commandId: `${commandId}:joint-test`,
    profileId: registered.result.profileId,
    expectedVersion: 0
  }, { catalog, now });
  next = normalizeState(jointTest.data);
  const sessionId = `ip-${digest({ correlationId, profileId: registered.result.profileId }).slice(7, 27)}`;
  if (next.institutionPilotSessions.some((item) => item.sessionId === sessionId)) {
    throw pilotError("INSTITUTION_PILOT_SESSION_CONFLICT", "institution pilot session already exists");
  }
  const session = {
    sessionId,
    profileId: registered.result.profileId,
    adapterProfileId,
    regionCode,
    institutionSlot,
    correlationId,
    adapterIds: [...adapterProfile.adapters],
    jointTestRunId: jointTest.result.runId,
    status: "synthetic-joint-test-complete",
    version: 0,
    attempts: [],
    nextRetryAt: null,
    reconciliation: null,
    referralClosure: null,
    createdAt: now,
    updatedAt: now
  };
  next.institutionPilotSessions.push(session);
  next.institutionPilotCommands.push({ commandId, requestDigest, sessionId, recordedAt: now });
  return Object.freeze({ data: next, result: publicSession(session), replayed: false });
}

function recordInstitutionPilotAttempt(data, command = {}, options = {}) {
  const activeProgram = options.program || program;
  const catalog = options.catalog || institutionCatalog;
  validateProgram(activeProgram, catalog);
  assertSafeProfile(command, catalog);
  const next = normalizeState(data);
  const commandId = assertCommandId(command.commandId);
  const sessionId = required(command.sessionId, "sessionId", 32);
  const adapterId = required(command.adapterId, "adapterId", 80);
  const outcome = required(command.outcome, "outcome", 40);
  const outboundEnvelopeDigest = assertDigest(command.outboundEnvelopeDigest, "outboundEnvelopeDigest");
  const errorCode = outcome === "accepted" ? null : required(command.errorCode, "errorCode", 120);
  if (!OUTCOMES.has(outcome)) throw pilotError("INSTITUTION_PILOT_OUTCOME_INVALID", "adapter attempt outcome is invalid", 400);
  const requestDigest = digest({ adapterId, errorCode, outcome, outboundEnvelopeDigest, sessionId });
  const replay = commandReplay(next, commandId, requestDigest);
  if (replay) return Object.freeze({ data: next, result: publicSession(findSession(next, sessionId)), replayed: true });
  const session = findSession(next, sessionId);
  assertVersion(session, command.expectedVersion);
  if (!session.adapterIds.includes(adapterId)) throw pilotError("INSTITUTION_PILOT_ADAPTER_NOT_ALLOWED", "adapter is not enabled for this pilot", 400);
  if (!new Set(["synthetic-joint-test-complete", "retry-wait"]).has(session.status)) {
    throw pilotError("INSTITUTION_PILOT_ATTEMPT_NOT_ALLOWED", "institution pilot session does not accept another delivery attempt");
  }
  const now = new Date(timestamp(options.now, "attempt time"));
  if (session.status === "retry-wait" && Date.parse(session.nextRetryAt || "") > now.getTime()) {
    throw pilotError("INSTITUTION_PILOT_RETRY_NOT_DUE", "institution pilot retry backoff has not elapsed");
  }
  const attemptNumber = session.attempts.length + 1;
  const maxAttempts = activeProgram.retryPolicy.maxAttempts;
  const attempt = Object.freeze({
    attemptId: `ipa-${digest({ commandId, sessionId }).slice(7, 27)}`,
    adapterId,
    attemptNumber,
    outcome,
    outboundEnvelopeDigest,
    errorCode,
    attemptedAt: now.toISOString(),
    synthetic: true,
    patientDataStored: false,
    credentialsStored: false
  });
  session.attempts.push(attempt);
  session.nextRetryAt = null;
  if (outcome === "accepted") {
    session.status = "delivery-accepted";
  } else if (outcome === "permanent-failure" || attemptNumber >= maxAttempts) {
    session.status = "dead-letter";
  } else {
    const delaySeconds = Math.min(
      activeProgram.retryPolicy.maximumDelaySeconds,
      activeProgram.retryPolicy.baseDelaySeconds * (2 ** (attemptNumber - 1))
    );
    session.status = "retry-wait";
    session.nextRetryAt = new Date(now.getTime() + delaySeconds * 1000).toISOString();
  }
  session.version += 1;
  session.updatedAt = now.toISOString();
  next.institutionPilotCommands.push({ commandId, requestDigest, sessionId, recordedAt: session.updatedAt });
  return Object.freeze({ data: next, result: publicSession(session), attempt, replayed: false });
}

function reconcileInstitutionPilot(data, command = {}, options = {}) {
  const catalog = options.catalog || institutionCatalog;
  assertSafeProfile(command, catalog);
  const next = normalizeState(data);
  const commandId = assertCommandId(command.commandId);
  const sessionId = required(command.sessionId, "sessionId", 32);
  const acknowledgedEnvelopeDigest = assertDigest(command.acknowledgedEnvelopeDigest, "acknowledgedEnvelopeDigest");
  const requestDigest = digest({ acknowledgedEnvelopeDigest, sessionId });
  const replay = commandReplay(next, commandId, requestDigest);
  if (replay) return Object.freeze({ data: next, result: publicSession(findSession(next, sessionId)), replayed: true });
  const session = findSession(next, sessionId);
  assertVersion(session, command.expectedVersion);
  if (session.status !== "delivery-accepted") {
    throw pilotError("INSTITUTION_PILOT_RECONCILIATION_NOT_ALLOWED", "an accepted delivery is required before reconciliation");
  }
  const acceptedAttempt = [...session.attempts].reverse().find((item) => item.outcome === "accepted");
  if (!acceptedAttempt) throw pilotError("INSTITUTION_PILOT_RECONCILIATION_INTEGRITY", "accepted attempt evidence is missing", 500);
  const now = timestamp(options.now, "reconciliation time");
  const matched = acceptedAttempt.outboundEnvelopeDigest === acknowledgedEnvelopeDigest;
  session.reconciliation = {
    reconciliationId: `ipr-${digest({ commandId, sessionId }).slice(7, 27)}`,
    outboundEnvelopeDigest: acceptedAttempt.outboundEnvelopeDigest,
    acknowledgedEnvelopeDigest,
    matched,
    disposition: matched ? "matched" : "reconciliation-required",
    reconciledAt: now,
    synthetic: true,
    externalReceiptVerified: false
  };
  session.status = matched ? "reconciled" : "delivery-accepted";
  session.version += 1;
  session.updatedAt = now;
  next.institutionPilotCommands.push({ commandId, requestDigest, sessionId, recordedAt: now });
  return Object.freeze({ data: next, result: publicSession(session), replayed: false });
}

function closeChronicReferralPilot(data, command = {}, options = {}) {
  const activeProgram = options.program || program;
  const catalog = options.catalog || institutionCatalog;
  validateProgram(activeProgram, catalog);
  assertSafeProfile(command, catalog);
  const next = normalizeState(data);
  const commandId = assertCommandId(command.commandId);
  const sessionId = required(command.sessionId, "sessionId", 32);
  const subjectRefDigest = assertDigest(command.subjectRefDigest, "subjectRefDigest");
  const requestDigest = digest({ sessionId, subjectRefDigest });
  const replay = commandReplay(next, commandId, requestDigest);
  if (replay) return Object.freeze({ data: next, result: publicSession(findSession(next, sessionId)), replayed: true });
  const session = findSession(next, sessionId);
  assertVersion(session, command.expectedVersion);
  if (session.status !== "reconciled" || session.reconciliation?.matched !== true) {
    throw pilotError("INSTITUTION_PILOT_CLOSURE_NOT_ALLOWED", "matched reconciliation is required before referral closure");
  }
  const adapterProfile = activeProgram.adapterProfiles.find((item) => item.id === session.adapterProfileId);
  const now = timestamp(options.now, "closure time");
  let loop = createRegionalBusinessLoop({
    loopId: `loop-${session.sessionId}`,
    correlationId: session.correlationId,
    residentRefDigest: subjectRefDigest,
    createdAt: now
  });
  adapterProfile.requiredClosureEvents.forEach((type, index) => {
    loop = applyRegionalBusinessEvent(loop, {
      eventId: `${session.sessionId}-event-${index + 1}`,
      type,
      correlationId: session.correlationId,
      causationId: index === 0 ? commandId : `${session.sessionId}-event-${index}`,
      payloadDigest: digest({ sessionId: session.sessionId, sequence: index + 1, type }),
      evidenceRef: `artifact://synthetic/institution-pilot/${session.sessionId}/${type}`,
      occurredAt: new Date(Date.parse(now) + index * 1000).toISOString(),
      expectedVersion: index
    }).state;
  });
  const report = evaluateRegionalBusinessLoop(loop);
  if (!report.ok) throw pilotError("INSTITUTION_PILOT_CLOSURE_INCOMPLETE", "synthetic referral loop did not close", 500);
  session.referralClosure = {
    loopId: report.loopId,
    phase: report.phase,
    eventChainDigest: report.eventChainDigest,
    technicalEvidenceFingerprint: report.technicalEvidenceFingerprint,
    synthetic: true,
    externalEvidenceVerified: false,
    closedAt: loop.updatedAt
  };
  session.status = "synthetic-closed-loop";
  session.version += 1;
  session.updatedAt = loop.updatedAt;
  next.institutionPilotCommands.push({ commandId, requestDigest, sessionId, recordedAt: session.updatedAt });
  return Object.freeze({ data: next, result: publicSession(session), loop: report, replayed: false });
}

function buildInstitutionPilotReadiness(data, options = {}) {
  const activeProgram = options.program || program;
  validateProgram(activeProgram, options.catalog || institutionCatalog);
  const state = normalizeState(data);
  const sessions = state.institutionPilotSessions.map(publicSession);
  const localClosedLoops = sessions.filter((item) => item.status === "synthetic-closed-loop").length;
  const reconciliationMismatches = sessions.filter((item) => item.reconciliation && !item.reconciliation.matched).length;
  const deadLetters = sessions.filter((item) => item.status === "dead-letter").length;
  return Object.freeze({
    schema: "institution-pilot-readiness-v1",
    generatedAt: options.now || new Date().toISOString(),
    ok: localClosedLoops > 0 && reconciliationMismatches === 0 && deadLetters === 0,
    productionGate: "NO-GO",
    productionReady: false,
    externalEvidenceVerified: false,
    summary: Object.freeze({
      sessions: sessions.length,
      localClosedLoops,
      reconciliationMismatches,
      deadLetters
    }),
    sessions: Object.freeze(sessions),
    blockers: Object.freeze([...activeProgram.productionBlockers]),
    boundary: "Local synthetic adapter, retry, reconciliation and referral closure results are technical evidence only; they do not prove institution connectivity or authorize production."
  });
}

module.exports = {
  buildInstitutionPilotReadiness,
  closeChronicReferralPilot,
  createInstitutionPilotSession,
  digest,
  reconcileInstitutionPilot,
  recordInstitutionPilotAttempt,
  validateProgram
};
