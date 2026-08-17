"use strict";

const { createHash } = require("node:crypto");
const sandboxProgram = require("../../../config/institution-sandbox-program.json");
const pilotProgram = require("../../../config/institution-pilot-program.json");
const {
  closeChronicReferralPilot,
  createInstitutionPilotSession,
  digest,
  reconcileInstitutionPilot,
  recordInstitutionPilotAttempt
} = require("./institution-pilot-orchestrator");

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const SESSION_ID = /^isj-[a-f0-9]{20}$/;
const CONTROLLED_REFERENCE = /^(?:artifact|cmdb|evidence|ticket|vault):\/\/[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]+$/;
const FORBIDDEN_TRANSPORT_FIELDS = /^(?:body|credential|credentials|endpoint|message|patient|payload|privateKey|raw|rawMessage|secret|signature|token)$/i;
const OUTCOMES = new Set(["accepted", "retryable-failure", "permanent-failure"]);

function sandboxError(code, message, statusCode = 409) {
  return Object.assign(new Error(message), { code, statusCode });
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(typeof value === "string" ? value : stableStringify(value)).digest("hex")}`;
}

function clean(value, maximum = 240) {
  return String(value || "").trim().replace(/[\r\n\t]+/g, " ").slice(0, maximum);
}

function required(value, label, maximum = 240) {
  const result = clean(value, maximum);
  if (!result) throw sandboxError("INSTITUTION_SANDBOX_INPUT_INVALID", `${label} is required`, 400);
  return result;
}

function assertDigest(value, label) {
  const result = clean(value, 80);
  if (!SHA256.test(result)) {
    throw sandboxError("INSTITUTION_SANDBOX_DIGEST_INVALID", `${label} must be a SHA-256 digest`, 400);
  }
  return result;
}

function assertEvidenceRef(value, label) {
  const result = clean(value, 240);
  if (!CONTROLLED_REFERENCE.test(result)) {
    throw sandboxError("INSTITUTION_SANDBOX_EVIDENCE_INVALID", `${label} must be a controlled evidence reference`, 400);
  }
  return result;
}

function assertCommandId(value) {
  const result = clean(value, 72);
  if (!/^[A-Za-z0-9._:-]{8,72}$/.test(result)) {
    throw sandboxError("INSTITUTION_SANDBOX_COMMAND_INVALID", "commandId must be a bounded opaque identifier", 400);
  }
  return result;
}

function parseTime(value, label) {
  const time = Date.parse(value || "");
  if (!Number.isFinite(time)) {
    throw sandboxError("INSTITUTION_SANDBOX_TIME_INVALID", `${label} is invalid`, 400);
  }
  return time;
}

function currentTime(value) {
  const time = value ? parseTime(value, "current time") : Date.now();
  return new Date(time).toISOString();
}

function validateProgram(value = sandboxProgram) {
  const transport = value?.transportPolicy || {};
  const retry = value?.retryPolicy || {};
  if (value?.schemaVersion !== "institution-sandbox-program-v1"
    || value.environment !== "preproduction-sandbox"
    || !Array.isArray(value.allowedAdapterIds)
    || value.allowedAdapterIds.length === 0
    || value.allowedAdapterIds.some((item) => !pilotProgram.adapterProfiles
      .some((profile) => profile.adapters.includes(item)))
    || transport.httpsRequired !== true
    || !Number.isInteger(transport.maximumRequestSkewSeconds)
    || transport.maximumRequestSkewSeconds < 1
    || !Number.isInteger(transport.maximumReceiptSkewSeconds)
    || transport.maximumReceiptSkewSeconds < 1
    || !Number.isInteger(transport.nonceRetentionSeconds)
    || transport.nonceRetentionSeconds < transport.maximumRequestSkewSeconds
    || retry.maxAttempts !== pilotProgram.retryPolicy.maxAttempts
    || retry.baseDelaySeconds !== pilotProgram.retryPolicy.baseDelaySeconds
    || retry.maximumDelaySeconds !== pilotProgram.retryPolicy.maximumDelaySeconds
    || value?.evidencePolicy?.storeRawMessages !== false
    || value.evidencePolicy.storeCredentials !== false
    || value.evidencePolicy.storeEndpoints !== false
    || value.evidencePolicy.storeSignatures !== false
    || !Array.isArray(value.productionBlockers)
    || value.productionBlockers.length === 0) {
    throw new TypeError("institution sandbox program is invalid");
  }
  return true;
}

function assertHttpsEndpoint(value) {
  try {
    const endpoint = new URL(String(value || ""));
    const hostname = endpoint.hostname.toLowerCase();
    if (endpoint.protocol !== "https:"
      || new Set(["localhost", "127.0.0.1", "::1"]).has(hostname)
      || endpoint.username
      || endpoint.password) {
      throw new Error("unsafe");
    }
    return endpoint.toString();
  } catch {
    throw sandboxError("INSTITUTION_SANDBOX_HTTPS_REQUIRED", "sandbox transport requires a credential-free HTTPS endpoint", 400);
  }
}

function assertNoRawTransportMaterial(value, path = "transport response") {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_TRANSPORT_FIELDS.test(key)) {
      throw sandboxError("INSTITUTION_SANDBOX_RAW_MATERIAL_REJECTED", `${path} contains forbidden raw transport material`, 400);
    }
    assertNoRawTransportMaterial(child, `${path}.${key}`);
  }
}

function normalizeState(data) {
  const next = structuredClone(data || {});
  next.institutionSandboxSessions = Array.isArray(next.institutionSandboxSessions)
    ? next.institutionSandboxSessions
    : [];
  next.institutionSandboxCommands = Array.isArray(next.institutionSandboxCommands)
    ? next.institutionSandboxCommands
    : [];
  next.institutionSandboxNonceDigests = Array.isArray(next.institutionSandboxNonceDigests)
    ? next.institutionSandboxNonceDigests
    : [];
  return next;
}

function publicSession(session) {
  return Object.freeze({
    sessionId: session.sessionId,
    pilotSessionId: session.pilotSessionId,
    adapterId: session.adapterId,
    regionCode: session.regionCode,
    institutionSlot: session.institutionSlot,
    correlationId: session.correlationId,
    endpointDigest: session.endpointDigest,
    requestDigest: session.requestDigest,
    requestEvidenceRef: session.requestEvidenceRef,
    status: session.status,
    version: session.version,
    attemptCount: session.attempts.length,
    nextRetryAt: session.nextRetryAt || null,
    latestReceipt: session.latestReceipt ? Object.freeze(structuredClone(session.latestReceipt)) : null,
    referralClosure: session.referralClosure ? Object.freeze(structuredClone(session.referralClosure)) : null,
    updatedAt: session.updatedAt,
    environment: "preproduction-sandbox",
    externalEvidenceVerified: false,
    productionReady: false
  });
}

function findSession(data, sessionId) {
  if (!SESSION_ID.test(sessionId || "")) {
    throw sandboxError("INSTITUTION_SANDBOX_SESSION_INVALID", "sessionId is invalid", 400);
  }
  const session = data.institutionSandboxSessions.find((item) => item.sessionId === sessionId);
  if (!session) throw sandboxError("INSTITUTION_SANDBOX_SESSION_NOT_FOUND", "sandbox session was not found", 404);
  return session;
}

function commandReplay(data, commandId, requestDigest) {
  const existing = data.institutionSandboxCommands.find((item) => item.commandId === commandId);
  if (!existing) return null;
  if (existing.requestDigest !== requestDigest) {
    throw sandboxError("INSTITUTION_SANDBOX_COMMAND_CONFLICT", "commandId was reused with different metadata");
  }
  return existing;
}

function assertVersion(session, value) {
  if (!Number.isInteger(Number(value)) || Number(value) !== session.version) {
    throw sandboxError("INSTITUTION_SANDBOX_VERSION_CONFLICT", "expectedVersion does not match sandbox state");
  }
}

function findPilotSession(data, sessionId) {
  const session = (data.institutionPilotSessions || []).find((item) => item.sessionId === sessionId);
  if (!session) throw sandboxError("INSTITUTION_SANDBOX_PILOT_STATE_MISSING", "linked pilot session is missing", 500);
  return session;
}

function startInstitutionSandboxJointTest(data, command = {}, options = {}) {
  const activeProgram = options.program || sandboxProgram;
  validateProgram(activeProgram);
  const commandId = assertCommandId(command.commandId);
  const regionCode = required(command.regionCode, "regionCode", 6);
  const institutionSlot = required(command.institutionSlot, "institutionSlot", 80);
  const correlationId = required(command.correlationId, "correlationId", 120);
  const adapterId = required(command.adapterId, "adapterId", 80);
  const requestDigest = assertDigest(command.requestDigest, "requestDigest");
  const requestEvidenceRef = assertEvidenceRef(command.requestEvidenceRef, "requestEvidenceRef");
  const endpoint = assertHttpsEndpoint(options.endpoint);
  if (!activeProgram.allowedAdapterIds.includes(adapterId)) {
    throw sandboxError("INSTITUTION_SANDBOX_ADAPTER_NOT_ALLOWED", "adapter is not enabled for the institution sandbox", 400);
  }
  let next = normalizeState(data);
  const requestFingerprint = sha256({ adapterId, correlationId, institutionSlot, regionCode, requestDigest, requestEvidenceRef });
  const replay = commandReplay(next, commandId, requestFingerprint);
  if (replay) {
    return Object.freeze({ data: next, result: publicSession(findSession(next, replay.sessionId)), replayed: true });
  }
  const now = currentTime(options.now);
  const pilot = createInstitutionPilotSession(next, {
    commandId: `${commandId}:pilot`,
    regionCode,
    institutionSlot,
    correlationId,
    adapterProfileId: activeProgram.pilotAdapterProfileId
  }, { now });
  next = normalizeState(pilot.data);
  const sessionId = `isj-${sha256({ correlationId, pilotSessionId: pilot.result.sessionId }).slice(7, 27)}`;
  const session = {
    sessionId,
    pilotSessionId: pilot.result.sessionId,
    adapterId,
    regionCode,
    institutionSlot,
    correlationId,
    endpointDigest: sha256(endpoint),
    requestDigest,
    requestEvidenceRef,
    status: "prepared",
    version: 0,
    attempts: [],
    nextRetryAt: null,
    latestReceipt: null,
    referralClosure: null,
    createdAt: now,
    updatedAt: now
  };
  next.institutionSandboxSessions.push(session);
  next.institutionSandboxCommands.push({ commandId, requestDigest: requestFingerprint, sessionId, recordedAt: now });
  return Object.freeze({ data: next, result: publicSession(session), replayed: false });
}

function signedReceiptProjection(input = {}) {
  return Object.freeze({
    acknowledgedRequestDigest: assertDigest(input.acknowledgedRequestDigest, "acknowledgedRequestDigest"),
    responseDigest: assertDigest(input.responseDigest, "responseDigest"),
    signatureDigest: assertDigest(input.signatureDigest, "signatureDigest"),
    receiptEvidenceRef: assertEvidenceRef(input.receiptEvidenceRef, "receiptEvidenceRef"),
    signatureVerificationEvidenceRef: assertEvidenceRef(
      input.signatureVerificationEvidenceRef,
      "signatureVerificationEvidenceRef"
    ),
    signatureVerified: input.signatureVerified === true,
    receivedAt: new Date(parseTime(input.receivedAt, "receipt receivedAt")).toISOString()
  });
}

function createSignedReceiptDigest(input = {}) {
  return sha256(signedReceiptProjection(input));
}

function pruneNonceDigests(data, now, retentionSeconds) {
  const cutoff = Date.parse(now) - retentionSeconds * 1000;
  data.institutionSandboxNonceDigests = data.institutionSandboxNonceDigests
    .filter((item) => Date.parse(item.recordedAt || "") >= cutoff);
}

function validateRuntimeEnvelope(data, session, options, activeProgram) {
  const endpoint = assertHttpsEndpoint(options.endpoint);
  if (sha256(endpoint) !== session.endpointDigest) {
    throw sandboxError("INSTITUTION_SANDBOX_ENDPOINT_CHANGED", "runtime endpoint does not match the prepared endpoint digest", 400);
  }
  const now = currentTime(options.now);
  const requestTime = parseTime(options.requestTimestamp, "request timestamp");
  if (Math.abs(Date.parse(now) - requestTime) > activeProgram.transportPolicy.maximumRequestSkewSeconds * 1000) {
    throw sandboxError("INSTITUTION_SANDBOX_REQUEST_EXPIRED", "request timestamp is outside the accepted time window", 400);
  }
  const nonce = required(options.nonce, "nonce", 160);
  const nonceDigest = sha256(nonce);
  pruneNonceDigests(data, now, activeProgram.transportPolicy.nonceRetentionSeconds);
  if (data.institutionSandboxNonceDigests.some((item) => item.nonceDigest === nonceDigest)) {
    throw sandboxError("INSTITUTION_SANDBOX_REPLAY_BLOCKED", "sandbox transport nonce was already used", 409);
  }
  return { endpoint, nonceDigest, now, requestTimestamp: new Date(requestTime).toISOString() };
}

async function executeInstitutionSandboxAttempt(data, command = {}, options = {}) {
  const activeProgram = options.program || sandboxProgram;
  validateProgram(activeProgram);
  let next = normalizeState(data);
  const commandId = assertCommandId(command.commandId);
  const sessionId = required(command.sessionId, "sessionId", 32);
  const session = findSession(next, sessionId);
  const requestFingerprint = sha256({ sessionId, expectedVersion: Number(command.expectedVersion) });
  const replay = commandReplay(next, commandId, requestFingerprint);
  if (replay) return Object.freeze({ data: next, result: publicSession(session), replayed: true });
  assertVersion(session, command.expectedVersion);
  if (!new Set(["prepared", "retry-wait"]).has(session.status)) {
    throw sandboxError("INSTITUTION_SANDBOX_ATTEMPT_NOT_ALLOWED", "sandbox session does not accept another attempt");
  }
  const runtime = validateRuntimeEnvelope(next, session, options, activeProgram);
  if (session.status === "retry-wait" && Date.parse(session.nextRetryAt || "") > Date.parse(runtime.now)) {
    throw sandboxError("INSTITUTION_SANDBOX_RETRY_NOT_DUE", "sandbox retry backoff has not elapsed");
  }
  const transport = options.transport;
  if (!transport || typeof transport.send !== "function") {
    throw sandboxError("INSTITUTION_SANDBOX_TRANSPORT_REQUIRED", "a sandbox transport adapter must be injected", 500);
  }
  let transportResult;
  try {
    transportResult = await transport.send(Object.freeze({
      endpoint: runtime.endpoint,
      adapterId: session.adapterId,
      correlationId: session.correlationId,
      requestDigest: session.requestDigest,
      requestEvidenceRef: session.requestEvidenceRef,
      requestTimestamp: runtime.requestTimestamp,
      nonceDigest: runtime.nonceDigest
    }));
  } catch {
    transportResult = { outcome: "retryable-failure", errorCode: "SANDBOX_TRANSPORT_ERROR" };
  }
  assertNoRawTransportMaterial(transportResult);
  const outcome = clean(transportResult?.outcome, 40);
  if (!OUTCOMES.has(outcome)) {
    throw sandboxError("INSTITUTION_SANDBOX_OUTCOME_INVALID", "transport adapter returned an invalid outcome", 400);
  }
  next.institutionSandboxNonceDigests.push({
    nonceDigest: runtime.nonceDigest,
    sessionId,
    recordedAt: runtime.now
  });
  let receipt = null;
  let errorCode = null;
  if (outcome === "accepted") {
    receipt = signedReceiptProjection(transportResult.receipt);
    if (!receipt.signatureVerified) {
      throw sandboxError("INSTITUTION_SANDBOX_SIGNATURE_UNVERIFIED", "transport adapter did not verify the detached signature digest", 400);
    }
    const receiptDigest = assertDigest(transportResult.receipt?.receiptDigest, "receiptDigest");
    if (receiptDigest !== sha256(receipt)) {
      throw sandboxError("INSTITUTION_SANDBOX_RECEIPT_INTEGRITY", "signed receipt digest does not match receipt metadata", 400);
    }
    if (receipt.acknowledgedRequestDigest !== session.requestDigest) {
      throw sandboxError("INSTITUTION_SANDBOX_RECEIPT_MISMATCH", "receipt does not acknowledge the prepared request digest", 409);
    }
    const receiptTime = parseTime(receipt.receivedAt, "receipt receivedAt");
    if (Math.abs(Date.parse(runtime.now) - receiptTime) > activeProgram.transportPolicy.maximumReceiptSkewSeconds * 1000
      || receiptTime < Date.parse(runtime.requestTimestamp)) {
      throw sandboxError("INSTITUTION_SANDBOX_RECEIPT_EXPIRED", "receipt is outside the accepted time window", 400);
    }
    receipt = Object.freeze({
      ...receipt,
      receiptDigest,
      nonceDigest: runtime.nonceDigest,
      signatureVerifiedByTransport: true,
      externalEvidenceVerified: false
    });
  } else {
    errorCode = required(transportResult.errorCode, "errorCode", 120);
    if (!/^[A-Z0-9][A-Z0-9._:-]{2,119}$/.test(errorCode)) {
      throw sandboxError("INSTITUTION_SANDBOX_ERROR_CODE_INVALID", "transport errorCode must be a bounded machine code", 400);
    }
  }
  const pilotSession = findPilotSession(next, session.pilotSessionId);
  const attempt = recordInstitutionPilotAttempt(next, {
    commandId: `${commandId}:attempt`,
    sessionId: session.pilotSessionId,
    expectedVersion: pilotSession.version,
    adapterId: session.adapterId,
    outcome,
    outboundEnvelopeDigest: session.requestDigest,
    ...(errorCode ? { errorCode } : {})
  }, { now: runtime.now });
  next = normalizeState(attempt.data);
  let updated = findSession(next, sessionId);
  updated.attempts.push({
    attemptDigest: sha256({ commandId, nonceDigest: runtime.nonceDigest, outcome, receiptDigest: receipt?.receiptDigest || null }),
    outcome,
    errorCode,
    nonceDigest: runtime.nonceDigest,
    receiptDigest: receipt?.receiptDigest || null,
    attemptedAt: runtime.now,
    rawMessageStored: false,
    endpointStored: false,
    credentialsStored: false,
    signatureStored: false
  });
  updated.latestReceipt = receipt;
  updated.status = attempt.result.status === "retry-wait" ? "retry-wait"
    : attempt.result.status === "dead-letter" ? "dead-letter"
      : "receipt-verified";
  updated.nextRetryAt = attempt.result.nextRetryAt;
  updated.version += 1;
  updated.updatedAt = runtime.now;
  if (receipt) {
    const reconciliation = reconcileInstitutionPilot(next, {
      commandId: `${commandId}:reconcile`,
      sessionId: updated.pilotSessionId,
      expectedVersion: attempt.result.version,
      acknowledgedEnvelopeDigest: receipt.acknowledgedRequestDigest
    }, { now: receipt.receivedAt });
    next = normalizeState(reconciliation.data);
    updated = findSession(next, sessionId);
  }
  next.institutionSandboxCommands.push({ commandId, requestDigest: requestFingerprint, sessionId, recordedAt: runtime.now });
  return Object.freeze({
    data: next,
    result: publicSession(updated),
    transportOutcome: outcome,
    replayed: false
  });
}

function closeInstitutionSandboxReferral(data, command = {}, options = {}) {
  const activeProgram = options.program || sandboxProgram;
  validateProgram(activeProgram);
  let next = normalizeState(data);
  const commandId = assertCommandId(command.commandId);
  const sessionId = required(command.sessionId, "sessionId", 32);
  const subjectRefDigest = assertDigest(command.subjectRefDigest, "subjectRefDigest");
  const requestFingerprint = sha256({ sessionId, subjectRefDigest });
  const replay = commandReplay(next, commandId, requestFingerprint);
  if (replay) return Object.freeze({ data: next, result: publicSession(findSession(next, sessionId)), replayed: true });
  const session = findSession(next, sessionId);
  assertVersion(session, command.expectedVersion);
  if (session.status !== "receipt-verified" || !session.latestReceipt?.signatureVerifiedByTransport) {
    throw sandboxError("INSTITUTION_SANDBOX_CLOSURE_NOT_ALLOWED", "a verified signed-digest receipt is required before referral closure");
  }
  const pilotSession = findPilotSession(next, session.pilotSessionId);
  const now = currentTime(options.now);
  const closure = closeChronicReferralPilot(next, {
    commandId: `${commandId}:closure`,
    sessionId: session.pilotSessionId,
    expectedVersion: pilotSession.version,
    subjectRefDigest
  }, { now });
  next = normalizeState(closure.data);
  const updated = findSession(next, sessionId);
  updated.referralClosure = {
    loopIdDigest: sha256(closure.result.referralClosure.loopId),
    eventChainDigest: closure.result.referralClosure.eventChainDigest,
    technicalEvidenceFingerprint: closure.result.referralClosure.technicalEvidenceFingerprint,
    receiptDigest: updated.latestReceipt.receiptDigest,
    closedAt: closure.result.referralClosure.closedAt,
    externalEvidenceVerified: false
  };
  updated.status = "sandbox-referral-closed";
  updated.version += 1;
  updated.updatedAt = updated.referralClosure.closedAt;
  next.institutionSandboxCommands.push({ commandId, requestDigest: requestFingerprint, sessionId, recordedAt: now });
  return Object.freeze({ data: next, result: publicSession(updated), loop: closure.loop, replayed: false });
}

function buildInstitutionSandboxReadiness(data, options = {}) {
  const activeProgram = options.program || sandboxProgram;
  validateProgram(activeProgram);
  const state = normalizeState(data);
  const sessions = state.institutionSandboxSessions.map(publicSession);
  const closedLoops = sessions.filter((item) => item.status === "sandbox-referral-closed").length;
  const deadLetters = sessions.filter((item) => item.status === "dead-letter").length;
  const receiptVerified = sessions.filter((item) => item.latestReceipt?.signatureVerifiedByTransport === true).length;
  return Object.freeze({
    schema: "institution-sandbox-readiness-v1",
    generatedAt: currentTime(options.now),
    ok: closedLoops > 0 && deadLetters === 0,
    localTechnicalReady: closedLoops > 0 && deadLetters === 0,
    productionGate: "NO-GO",
    productionReady: false,
    externalEvidenceVerified: false,
    summary: Object.freeze({ sessions: sessions.length, receiptVerified, closedLoops, deadLetters }),
    sessions: Object.freeze(sessions),
    blockers: Object.freeze([...activeProgram.productionBlockers]),
    boundary: "Preproduction sandbox transport and signed-digest receipts are technical evidence only; endpoint/key custody, independent acceptance and production approval remain external blockers."
  });
}

module.exports = {
  CONTROLLED_REFERENCE,
  buildInstitutionSandboxReadiness,
  closeInstitutionSandboxReferral,
  createSignedReceiptDigest,
  executeInstitutionSandboxAttempt,
  sha256,
  startInstitutionSandboxJointTest,
  validateProgram
};
