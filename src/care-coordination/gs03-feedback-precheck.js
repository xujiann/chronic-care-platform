"use strict";

// Synthetic, unwired feedback contract probe. This is not an authorization,
// signature, idempotency, or production callback decision.
const { sha256 } = require("../platform/governance/technical-evidence");

const OPTIONS_FIELDS = Object.freeze(["environment", "request", "target"]);
const REQUEST_FIELDS = Object.freeze([
  "protocol", "idempotencyKey", "caseId", "residentId", "authorizationId",
  "externalSystemId", "feedbackStatus", "occurredAt", "summary"
]);
const TARGET_FIELDS = Object.freeze([
  "caseId", "residentId", "authorizationId", "externalSystemId"
]);
const IDENTIFIER_FIELDS = Object.freeze([
  "idempotencyKey", "caseId", "residentId", "authorizationId", "externalSystemId"
]);
const IDENTIFIER_CHARACTERS = /[^A-Za-z0-9._:-]/;
const IDENTIFIER_START = /^[A-Za-z0-9]/;
const FEEDBACK_STATUSES = new Set(["accepted", "declined", "completed"]);
const PROTOCOL = "gs03-feedback-synthetic.v1";

const REJECTED_ENVIRONMENT = Object.freeze({
  status: "rejected", code: "GS03_SYNTHETIC_PRECHECK_ENVIRONMENT",
  productionReady: false, productionPrimary: false
});
const REJECTED_INPUT = Object.freeze({
  status: "rejected", code: "GS03_SYNTHETIC_PRECHECK_INPUT",
  productionReady: false, productionPrimary: false
});
const REJECTED_TARGET = Object.freeze({
  status: "rejected", code: "GS03_SYNTHETIC_PRECHECK_TARGET",
  productionReady: false, productionPrimary: false
});

function exactOwnData(value, fields) {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length !== fields.length || keys.some((key) =>
      typeof key !== "string" || !fields.includes(key))) return null;
    const data = Object.create(null);
    for (const field of fields) {
      const descriptor = descriptors[field];
      if (!descriptor || !Object.hasOwn(descriptor, "value") || descriptor.enumerable !== true) return null;
      data[field] = descriptor.value;
    }
    return data;
  } catch {
    // Revoked proxies and throwing reflection traps have one public outcome.
    return null;
  }
}

function validIdentifier(value) {
  return typeof value === "string" && value.length >= 1 && value.length <= 128 &&
    IDENTIFIER_START.test(value) && !IDENTIFIER_CHARACTERS.test(value);
}

function validSummary(value) {
  if (typeof value !== "string" || value.length > 1024) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return false;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return Buffer.byteLength(value, "utf8") <= 1024;
}

function validRequest(request) {
  return request.protocol === PROTOCOL &&
    IDENTIFIER_FIELDS.every((field) => validIdentifier(request[field])) &&
    FEEDBACK_STATUSES.has(request.feedbackStatus) &&
    Number.isSafeInteger(request.occurredAt) &&
    !Object.is(request.occurredAt, -0) &&
    request.occurredAt >= 0 && request.occurredAt <= 8640000000000000 &&
    validSummary(request.summary);
}

function precheckSyntheticFeedback(options) {
  const input = exactOwnData(options, OPTIONS_FIELDS);
  if (!input) return REJECTED_INPUT;
  if (input.environment !== "development" && input.environment !== "test") {
    return REJECTED_ENVIRONMENT;
  }
  const request = exactOwnData(input.request, REQUEST_FIELDS);
  const target = exactOwnData(input.target, TARGET_FIELDS);
  if (!request || !target || !validRequest(request) ||
      TARGET_FIELDS.some((field) => !validIdentifier(target[field]))) return REJECTED_INPUT;
  if (TARGET_FIELDS.some((field) => request[field] !== target[field])) return REJECTED_TARGET;

  const projection = REQUEST_FIELDS.map((field) => request[field]);
  return Object.freeze({
    status: "accepted",
    code: "GS03_SYNTHETIC_PRECHECK_ACCEPTED",
    syntheticIntentDigest: `synthetic:${sha256(JSON.stringify(projection))}`,
    productionReady: false,
    productionPrimary: false
  });
}

module.exports = { precheckSyntheticFeedback };
