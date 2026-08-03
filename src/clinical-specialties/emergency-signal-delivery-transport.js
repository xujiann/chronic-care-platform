"use strict";

const { createHmac, timingSafeEqual } = require("node:crypto");
const { stableStringify } = require("../http/routes/t06-emergency-signal-delivery");
const { projectEmergencySignalEvent } = require("./emergency-signal-delivery-contract");

class EmergencySignalTransportError extends Error {
  constructor(code, message, statusCode = 503) {
    super(message);
    this.name = "EmergencySignalTransportError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function text(value, maximum = 300) {
  return String(value || "").trim().replace(/[\r\n\t]+/g, " ").slice(0, maximum);
}

function evidenceReference(value) {
  const normalized = text(value, 160);
  return normalized.length >= 4 ? normalized : "";
}

function secureEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""), "utf8");
  const rightBuffer = Buffer.from(String(right || ""), "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function emergencySignalTransportConfig(env = process.env) {
  const endpoint = text(env.EMERGENCY_SIGNAL_DELIVERY_URL, 1000);
  const secret = String(env.EMERGENCY_SIGNAL_DELIVERY_SECRET || "").trim();
  const timeoutMs = Math.min(
    30_000,
    Math.max(1_000, Number(env.EMERGENCY_SIGNAL_DELIVERY_TIMEOUT_MS) || 8_000)
  );
  let parsed;
  try {
    parsed = new URL(endpoint);
  } catch {
    parsed = null;
  }
  const allowHttp = env.NODE_ENV !== "production"
    && /^(1|true|yes)$/i.test(String(env.EMERGENCY_SIGNAL_DELIVERY_ALLOW_HTTP || ""));
  const minimumSecretLength = env.NODE_ENV === "production" ? 32 : 16;
  const endpointHasNoEmbeddedSecrets = Boolean(
    parsed
    && !parsed.username
    && !parsed.password
    && !parsed.search
    && !parsed.hash
  );
  const requirements = {
    endpoint: endpointHasNoEmbeddedSecrets,
    https: Boolean(parsed && (parsed.protocol === "https:" || allowHttp)),
    signingSecret: secret.length >= minimumSecretLength
      && !/replace-with|change-me|placeholder|example|demo[-_]/i.test(secret),
    transportEvidence: Boolean(evidenceReference(env.EMERGENCY_SIGNAL_TRANSPORT_EVIDENCE_ID)),
    signingKeyEvidence: Boolean(evidenceReference(env.EMERGENCY_SIGNAL_SIGNING_KEY_EVIDENCE_ID)),
    receiptVerifierEvidence: Boolean(evidenceReference(env.EMERGENCY_SIGNAL_RECEIPT_VERIFIER_EVIDENCE_ID))
  };
  const config = {
    endpoint: endpointHasNoEmbeddedSecrets ? parsed.toString() : "",
    timeoutMs,
    configured: Object.values(requirements).every(Boolean),
    requirements: Object.freeze(requirements),
    credentialsPersisted: false,
    productionReady: false,
    boundary: "Transport configuration does not prove endpoint ownership, live key custody, external receipt verification, or signed site acceptance."
  };
  Object.defineProperty(config, "secret", {
    value: secret,
    enumerable: false,
    writable: false,
    configurable: false
  });
  return Object.freeze(config);
}

function requireTransportConfig(config) {
  if (!config.requirements.endpoint) {
    throw new EmergencySignalTransportError(
      "EMERGENCY_SIGNAL_TRANSPORT_ENDPOINT_INVALID",
      "emergency signal delivery endpoint is missing, invalid, or contains embedded credentials"
    );
  }
  if (!config.requirements.https) {
    throw new EmergencySignalTransportError(
      "EMERGENCY_SIGNAL_TRANSPORT_HTTPS_REQUIRED",
      "emergency signal delivery requires HTTPS"
    );
  }
  if (!config.requirements.signingSecret) {
    throw new EmergencySignalTransportError(
      "EMERGENCY_SIGNAL_TRANSPORT_SECRET_UNAVAILABLE",
      "emergency signal delivery signing secret is unavailable"
    );
  }
  if (
    !config.requirements.transportEvidence
    || !config.requirements.signingKeyEvidence
    || !config.requirements.receiptVerifierEvidence
  ) {
    throw new EmergencySignalTransportError(
      "EMERGENCY_SIGNAL_TRANSPORT_EVIDENCE_REQUIRED",
      "emergency signal delivery transport evidence is incomplete",
      409
    );
  }
}

function deliveryEnvelope(event, context = {}, sentAt, secret = "") {
  let projected;
  try {
    projected = projectEmergencySignalEvent(event);
  } catch {
    throw new EmergencySignalTransportError(
      "EMERGENCY_SIGNAL_TRANSPORT_EVENT_CONTRACT_INVALID",
      "emergency signal event is outside the approved transport contract",
      409
    );
  }
  const generation = Number(context.generation || 0);
  const attempt = Number(context.attempt || 0);
  const requestId = `${projected.id}:${generation}`;
  const requestNonce = createHmac("sha256", secret)
    .update(stableStringify({
      requestId,
      eventId: projected.id,
      payloadDigest: text(context.payloadDigest, 80),
      generation,
      attempt,
      sentAt
    }))
    .digest("hex");
  return Object.freeze({
    schema: "emergency-signal-transport.v2",
    requestId,
    requestNonce,
    eventId: projected.id,
    domain: projected.domain,
    eventType: projected.type,
    aggregateId: projected.aggregateId,
    aggregateVersion: projected.aggregateVersion,
    correlationId: projected.correlationId,
    causationId: projected.causationId,
    payloadDigest: text(context.payloadDigest, 80),
    attempt,
    generation,
    workerId: text(context.workerId, 160),
    sentAt,
    payload: projected.payload
  });
}

function signedReceiptPayload(receipt = {}) {
  return {
    requestId: text(receipt.requestId, 500),
    requestNonce: text(receipt.requestNonce, 128),
    eventId: text(receipt.eventId, 240),
    payloadDigest: text(receipt.payloadDigest, 80),
    generation: Number(receipt.generation || 0),
    attempt: Number(receipt.attempt || 0),
    sentAt: text(receipt.sentAt, 80),
    providerMessageId: text(receipt.providerMessageId, 240),
    status: text(receipt.status, 40).toLowerCase(),
    occurredAt: text(receipt.occurredAt, 80)
  };
}

function verifyReceipt(receipt, envelope, secret, receivedAt) {
  const normalized = signedReceiptPayload(receipt);
  const occurredAtMs = Date.parse(normalized.occurredAt);
  const sentAtMs = Date.parse(normalized.sentAt);
  const receivedAtMs = Date.parse(String(receivedAt || ""));
  if (
    !normalized.requestId
    || normalized.requestId !== envelope.requestId
    || !normalized.requestNonce
    || normalized.requestNonce !== envelope.requestNonce
    || !normalized.eventId
    || normalized.eventId !== envelope.eventId
    || !normalized.payloadDigest
    || normalized.payloadDigest !== envelope.payloadDigest
    || normalized.generation !== envelope.generation
    || normalized.attempt !== envelope.attempt
    || normalized.sentAt !== envelope.sentAt
    || !normalized.providerMessageId
    || !["accepted", "delivered"].includes(normalized.status)
    || !Number.isFinite(occurredAtMs)
    || !Number.isFinite(sentAtMs)
    || !Number.isFinite(receivedAtMs)
    || occurredAtMs < sentAtMs - 5 * 60_000
    || occurredAtMs > receivedAtMs + 5 * 60_000
  ) {
    throw new EmergencySignalTransportError(
      "EMERGENCY_SIGNAL_TRANSPORT_RECEIPT_BINDING_INVALID",
      "emergency signal receipt is incomplete or not bound to the delivered event",
      502
    );
  }
  const signature = text(receipt?.signature, 256);
  if (!signature) {
    throw new EmergencySignalTransportError(
      "EMERGENCY_SIGNAL_TRANSPORT_RECEIPT_SIGNATURE_REQUIRED",
      "emergency signal receipt signature is required",
      502
    );
  }
  const expected = createHmac("sha256", secret)
    .update(stableStringify(normalized))
    .digest("hex");
  if (!secureEqual(expected, signature)) {
    throw new EmergencySignalTransportError(
      "EMERGENCY_SIGNAL_TRANSPORT_RECEIPT_SIGNATURE_INVALID",
      "emergency signal receipt signature is invalid",
      502
    );
  }
  return Object.freeze({
    ...normalized,
    receivedAt,
    transportVerified: true,
    signatureVerified: true
  });
}

function createEmergencySignalSignedTransport(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const now = typeof options.now === "function" ? options.now : () => new Date().toISOString();
  const config = options.config || emergencySignalTransportConfig(env);
  return async function sendEmergencySignal(event, context = {}) {
    requireTransportConfig(config);
    if (typeof fetchImpl !== "function") {
      throw new EmergencySignalTransportError(
        "EMERGENCY_SIGNAL_TRANSPORT_UNAVAILABLE",
        "emergency signal HTTPS transport is unavailable"
      );
    }
    const sentAt = new Date(now()).toISOString();
    const envelope = deliveryEnvelope(event, context, sentAt, config.secret);
    if (
      !envelope.eventId
      || !envelope.aggregateId
      || !envelope.payloadDigest
      || envelope.attempt < 1
      || envelope.generation < 1
      || !envelope.workerId
    ) {
      throw new EmergencySignalTransportError(
        "EMERGENCY_SIGNAL_TRANSPORT_EVENT_INVALID",
        "emergency signal transport event binding is incomplete",
        409
      );
    }
    const body = stableStringify(envelope);
    const signature = createHmac("sha256", config.secret).update(body).digest("hex");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    let response;
    try {
      response = await fetchImpl(config.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": envelope.requestId,
          "x-emergency-event-id": envelope.eventId,
          "x-emergency-payload-digest": envelope.payloadDigest,
          "x-emergency-request-nonce": envelope.requestNonce,
          "x-emergency-sent-at": envelope.sentAt,
          "x-emergency-signature": signature
        },
        body,
        signal: controller.signal
      });
    } catch (error) {
      throw new EmergencySignalTransportError(
        error?.name === "AbortError"
          ? "EMERGENCY_SIGNAL_TRANSPORT_TIMEOUT"
          : "EMERGENCY_SIGNAL_TRANSPORT_FAILED",
        "signed emergency signal delivery did not complete"
      );
    } finally {
      clearTimeout(timeout);
    }
    if (!response?.ok) {
      throw new EmergencySignalTransportError(
        "EMERGENCY_SIGNAL_TRANSPORT_PROVIDER_REJECTED",
        `signed emergency signal delivery was rejected with HTTP ${Number(response?.status || 502)}`,
        502
      );
    }
    const raw = await response.text();
    if (raw.length > 16_384) {
      throw new EmergencySignalTransportError(
        "EMERGENCY_SIGNAL_TRANSPORT_RECEIPT_TOO_LARGE",
        "emergency signal receipt exceeded the allowed size",
        502
      );
    }
    let receipt;
    try {
      receipt = JSON.parse(raw);
    } catch {
      throw new EmergencySignalTransportError(
        "EMERGENCY_SIGNAL_TRANSPORT_RECEIPT_INVALID",
        "emergency signal receipt is not valid JSON",
        502
      );
    }
    return verifyReceipt(
      receipt,
      envelope,
      config.secret,
      new Date(now()).toISOString()
    );
  };
}

module.exports = {
  EmergencySignalTransportError,
  createEmergencySignalSignedTransport,
  deliveryEnvelope,
  emergencySignalTransportConfig,
  signedReceiptPayload,
  verifyReceipt
};
