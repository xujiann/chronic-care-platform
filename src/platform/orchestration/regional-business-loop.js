"use strict";

const { createHash } = require("node:crypto");

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const TRANSITIONS = Object.freeze({
  "awaiting-consent": Object.freeze({
    "resident-consent-recorded": "consented"
  }),
  consented: Object.freeze({
    "referral-created": "referral-created"
  }),
  "referral-created": Object.freeze({
    "referral-accepted": "referral-accepted",
    "compensation-requested": "compensating"
  }),
  "referral-accepted": Object.freeze({
    "clinical-delivery-acknowledged": "clinical-delivered",
    "compensation-requested": "compensating"
  }),
  "clinical-delivered": Object.freeze({
    "loop-closed": "closed",
    "compensation-requested": "compensating"
  }),
  compensating: Object.freeze({
    "compensation-completed": "compensated"
  }),
  closed: Object.freeze({}),
  compensated: Object.freeze({})
});

function loopError(code, message, statusCode = 409) {
  return Object.assign(new Error(message), { code, statusCode });
}

function clean(value, maximum = 200) {
  return String(value || "").trim().replace(/[\r\n\t]+/g, " ").slice(0, maximum);
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(stableStringify(value)).digest("hex")}`;
}

function required(value, label, maximum = 200) {
  const result = clean(value, maximum);
  if (!result) throw loopError("REGIONAL_BUSINESS_LOOP_INPUT_INVALID", `${label} is required`, 400);
  return result;
}

function createRegionalBusinessLoop(input = {}) {
  const residentRefDigest = required(input.residentRefDigest, "residentRefDigest", 80);
  if (!SHA256.test(residentRefDigest)) {
    throw loopError("REGIONAL_BUSINESS_LOOP_RESIDENT_REF_INVALID", "residentRefDigest must be a SHA-256 digest", 400);
  }
  const createdAt = new Date(input.createdAt || new Date().toISOString());
  if (!Number.isFinite(createdAt.getTime())) {
    throw loopError("REGIONAL_BUSINESS_LOOP_TIME_INVALID", "createdAt is invalid", 400);
  }
  return Object.freeze({
    schema: "regional-business-loop-v1",
    loopId: required(input.loopId, "loopId"),
    correlationId: required(input.correlationId, "correlationId"),
    residentRefDigest,
    phase: "awaiting-consent",
    version: 0,
    createdAt: createdAt.toISOString(),
    updatedAt: createdAt.toISOString(),
    eventIds: Object.freeze([]),
    events: Object.freeze([]),
    residentDataExposed: false,
    clinicalDataExposed: false,
    productionReady: false
  });
}

function normalizeEvent(state, input = {}) {
  const eventId = required(input.eventId, "eventId");
  const type = required(input.type, "type", 100);
  const payloadDigest = required(input.payloadDigest, "payloadDigest", 80);
  const evidenceRef = required(input.evidenceRef, "evidenceRef", 240);
  const occurredAt = new Date(input.occurredAt || new Date().toISOString());
  if (!SHA256.test(payloadDigest)
    || !/^(?:evidence|artifact|vault|ticket):\/\//.test(evidenceRef)
    || !Number.isFinite(occurredAt.getTime())) {
    throw loopError("REGIONAL_BUSINESS_LOOP_EVENT_INVALID", "regional business event digest, evidence reference, or time is invalid", 400);
  }
  if (required(input.correlationId, "correlationId") !== state.correlationId) {
    throw loopError("REGIONAL_BUSINESS_LOOP_CORRELATION_CONFLICT", "regional business event correlation does not match");
  }
  return Object.freeze({
    eventId,
    type,
    correlationId: state.correlationId,
    causationId: required(input.causationId, "causationId"),
    payloadDigest,
    evidenceRef,
    occurredAt: occurredAt.toISOString()
  });
}

function applyRegionalBusinessEvent(current, input = {}) {
  if (!current || current.schema !== "regional-business-loop-v1") {
    throw loopError("REGIONAL_BUSINESS_LOOP_STATE_INVALID", "regional business loop state is invalid", 400);
  }
  const state = structuredClone(current);
  const event = normalizeEvent(state, input);
  const existing = state.events.find((item) => item.eventId === event.eventId);
  if (existing) {
    if (sha256(existing) !== sha256(event)) {
      throw loopError("REGIONAL_BUSINESS_LOOP_EVENT_CONFLICT", "regional business event id was reused with different metadata");
    }
    return Object.freeze({ state: current, duplicate: true });
  }
  if (Number(input.expectedVersion) !== state.version) {
    throw loopError("REGIONAL_BUSINESS_LOOP_VERSION_CONFLICT", "regional business loop expectedVersion does not match");
  }
  const nextPhase = TRANSITIONS[state.phase]?.[event.type];
  if (!nextPhase) {
    throw loopError(
      "REGIONAL_BUSINESS_LOOP_TRANSITION_INVALID",
      `event ${event.type} is not allowed from phase ${state.phase}`
    );
  }
  state.phase = nextPhase;
  state.version += 1;
  state.updatedAt = event.occurredAt;
  state.eventIds = Object.freeze([...state.eventIds, event.eventId]);
  state.events = Object.freeze([...state.events, event]);
  state.residentDataExposed = false;
  state.clinicalDataExposed = false;
  state.productionReady = false;
  return Object.freeze({ state: Object.freeze(state), duplicate: false });
}

function evaluateRegionalBusinessLoop(state = {}) {
  const eventTypes = new Set((state.events || []).map((event) => event.type));
  const checks = Object.freeze({
    residentConsent: eventTypes.has("resident-consent-recorded"),
    referralCreated: eventTypes.has("referral-created"),
    referralAccepted: eventTypes.has("referral-accepted"),
    clinicalDeliveryAcknowledged: eventTypes.has("clinical-delivery-acknowledged"),
    closed: state.phase === "closed" && eventTypes.has("loop-closed"),
    uncompensated: state.phase !== "compensating"
  });
  return Object.freeze({
    ok: Object.values(checks).every(Boolean),
    loopId: clean(state.loopId, 200),
    phase: clean(state.phase, 80),
    version: Number(state.version) || 0,
    checks,
    eventChainDigest: sha256(state.events || []),
    residentDataExposed: false,
    clinicalDataExposed: false,
    productionReady: false
  });
}

module.exports = {
  TRANSITIONS,
  applyRegionalBusinessEvent,
  createRegionalBusinessLoop,
  evaluateRegionalBusinessLoop,
  sha256
};
