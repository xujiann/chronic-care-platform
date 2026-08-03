"use strict";

const EVENT_TYPE = "clinical-specialties.emergency-signal-updated.v1";
const DOMAIN = "clinical-specialties";
const MAX_EVENT_BYTES = 16_384;
const PAYLOAD_FIELDS = Object.freeze({
  signalId: 240,
  previousStatus: 120,
  status: 120,
  action: 500,
  level: 120,
  ownerRole: 120
});
const SENSITIVE_FIELD = /(?:authorization|cookie|credential|password|secret|session|token|api[-_]?key|private[-_]?key|signature)/i;

function contractError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 400;
  return error;
}

function requiredText(value, field, maximum) {
  const normalized = String(value || "").trim().replace(/[\r\n\t]+/g, " ");
  if (!normalized || normalized.length > maximum) {
    throw contractError(
      "EMERGENCY_SIGNAL_DELIVERY_CONTRACT_INVALID",
      `${field} is required and must not exceed ${maximum} characters`
    );
  }
  return normalized;
}

function projectPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw contractError(
      "EMERGENCY_SIGNAL_DELIVERY_PAYLOAD_INVALID",
      "emergency signal payload must be an object"
    );
  }
  const unknown = Object.keys(payload).filter((key) => !Object.hasOwn(PAYLOAD_FIELDS, key));
  if (unknown.length || Object.keys(payload).some((key) => SENSITIVE_FIELD.test(key))) {
    throw contractError(
      "EMERGENCY_SIGNAL_DELIVERY_PAYLOAD_FIELD_FORBIDDEN",
      "emergency signal payload contains a field outside the approved contract"
    );
  }
  const projected = {};
  for (const [field, maximum] of Object.entries(PAYLOAD_FIELDS)) {
    projected[field] = requiredText(payload[field], `payload.${field}`, maximum);
  }
  return Object.freeze(projected);
}

function projectEmergencySignalEvent(input = {}) {
  const aggregateVersion = Number(input.aggregateVersion);
  if (!Number.isInteger(aggregateVersion) || aggregateVersion < 1) {
    throw contractError(
      "EMERGENCY_SIGNAL_DELIVERY_CONTRACT_INVALID",
      "aggregateVersion must be a positive integer"
    );
  }
  const occurredAt = new Date(input.occurredAt);
  if (!Number.isFinite(occurredAt.getTime())) {
    throw contractError(
      "EMERGENCY_SIGNAL_DELIVERY_CONTRACT_INVALID",
      "occurredAt must be a valid timestamp"
    );
  }
  const event = Object.freeze({
    id: requiredText(input.id, "eventId", 240),
    action: requiredText(input.action, "action", 80),
    owner: requiredText(input.owner, "owner", 120),
    domain: requiredText(input.domain, "domain", 120),
    type: requiredText(input.type, "eventType", 160),
    aggregateId: requiredText(input.aggregateId, "aggregateId", 240),
    aggregateVersion,
    correlationId: requiredText(input.correlationId, "correlationId", 240),
    causationId: requiredText(input.causationId, "causationId", 240),
    occurredAt: occurredAt.toISOString(),
    payload: projectPayload(input.payload)
  });
  if (
    event.action !== "domain-event-outbox"
    || event.owner !== DOMAIN
    || event.domain !== DOMAIN
    || event.type !== EVENT_TYPE
  ) {
    throw contractError(
      "EMERGENCY_SIGNAL_DELIVERY_CONTRACT_INVALID",
      "event is outside the emergency signal delivery contract"
    );
  }
  if (Buffer.byteLength(JSON.stringify(event), "utf8") > MAX_EVENT_BYTES) {
    throw contractError(
      "EMERGENCY_SIGNAL_DELIVERY_PAYLOAD_TOO_LARGE",
      "emergency signal event exceeds the approved payload size"
    );
  }
  return event;
}

module.exports = {
  DOMAIN,
  EVENT_TYPE,
  MAX_EVENT_BYTES,
  PAYLOAD_FIELDS,
  projectEmergencySignalEvent,
  projectPayload
};
