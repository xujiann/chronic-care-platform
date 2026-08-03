"use strict";

const { createHmac, timingSafeEqual } = require("node:crypto");
const { CONTRACT_ID, sha256, stableStringify } = require("./referral-delivery-postgres-repository");

class ReferralDeliveryTransportError extends Error {
  constructor(code, message, statusCode = 503) {
    super(message);
    this.name = "ReferralDeliveryTransportError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function text(value, max = 300) {
  return String(value || "").trim().replace(/[\r\n\t]+/g, " ").slice(0, max);
}

function requiredText(value, label, max = 300) {
  const result = text(value, max);
  if (!result) throw new ReferralDeliveryTransportError("REFERRAL_TRANSPORT_BINDING_INVALID", `${label} is required`, 409);
  return result;
}

function secureEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

function hmac(secret, value) {
  return createHmac("sha256", secret).update(typeof value === "string" ? value : stableStringify(value)).digest("hex");
}

function evidenceReference(value) {
  const result = text(value, 160);
  return result.length >= 4 ? result : "";
}

function buildReferralTransportConfig(env = process.env) {
  const endpoint = text(env.REFERRAL_DELIVERY_URL, 2000);
  let parsed;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new ReferralDeliveryTransportError("REFERRAL_TRANSPORT_ENDPOINT_INVALID", "referral delivery endpoint is invalid");
  }
  if (parsed.protocol !== "https:") {
    throw new ReferralDeliveryTransportError("REFERRAL_TRANSPORT_HTTPS_REQUIRED", "referral delivery endpoint must use HTTPS");
  }
  if (parsed.username || parsed.password) {
    throw new ReferralDeliveryTransportError("REFERRAL_TRANSPORT_ENDPOINT_CREDENTIALS_FORBIDDEN", "endpoint URL must not contain credentials");
  }
  const secret = String(env.REFERRAL_DELIVERY_HMAC_SECRET || "").trim();
  if (secret.length < 32 || /replace-with|change-me|placeholder|example|demo[-_]/i.test(secret)) {
    throw new ReferralDeliveryTransportError("REFERRAL_TRANSPORT_SECRET_UNAVAILABLE", "referral delivery HMAC secret is unavailable");
  }
  const evidence = {
    transport: evidenceReference(env.REFERRAL_DELIVERY_TRANSPORT_EVIDENCE_ID),
    signing: evidenceReference(env.REFERRAL_DELIVERY_SIGNING_EVIDENCE_ID)
  };
  if (!evidence.transport || !evidence.signing) {
    throw new ReferralDeliveryTransportError("REFERRAL_TRANSPORT_EVIDENCE_REQUIRED", "referral delivery transport and signing evidence are required");
  }
  const config = {
    endpoint: parsed.toString(),
    evidence: Object.freeze(evidence),
    timeoutMs: Math.min(30000, Math.max(1000, Number(env.REFERRAL_DELIVERY_TIMEOUT_MS) || 8000)),
    credentialsPersisted: false,
    productionReady: false
  };
  Object.defineProperty(config, "secret", { value: secret, enumerable: false });
  return Object.freeze(config);
}

function deliveryEnvelope(claim, sentAt) {
  const envelope = {
    schema: "referral-order-delivery.v1",
    eventId: requiredText(claim?.id, "eventId", 240),
    eventType: requiredText(claim?.type, "eventType", 160),
    contractId: requiredText(claim?.contractId, "contractId", 80),
    aggregateVersion: Number(claim?.aggregateVersion),
    correlationId: requiredText(claim?.correlationId, "correlationId", 240),
    payloadDigest: requiredText(claim?.payloadDigest, "payloadDigest", 80),
    attempt: Number(claim?.attempt),
    leaseVersion: Number(claim?.leaseVersion),
    sentAt: new Date(sentAt).toISOString(),
    payload: claim?.payload && typeof claim.payload === "object" ? structuredClone(claim.payload) : {}
  };
  if (envelope.contractId !== CONTRACT_ID
    || !Number.isSafeInteger(envelope.aggregateVersion)
    || envelope.aggregateVersion < 1
    || !Number.isSafeInteger(envelope.attempt)
    || envelope.attempt < 1
    || !Number.isSafeInteger(envelope.leaseVersion)
    || envelope.leaseVersion < 1) {
    throw new ReferralDeliveryTransportError("REFERRAL_TRANSPORT_BINDING_INVALID", "referral delivery event binding is incomplete", 409);
  }
  return Object.freeze(envelope);
}

function receiptBinding(receipt = {}) {
  const status = requiredText(receipt.status, "receipt.status", 40).toLowerCase();
  const occurredAt = requiredText(receipt.occurredAt, "receipt.occurredAt", 80);
  if (!Number.isFinite(Date.parse(occurredAt)) || !new Set(["accepted", "delivered"]).has(status)) {
    throw new ReferralDeliveryTransportError("REFERRAL_TRANSPORT_RECEIPT_INVALID", "receipt status or occurredAt is invalid", 502);
  }
  return Object.freeze({
    eventId: requiredText(receipt.eventId, "receipt.eventId", 240),
    payloadDigest: requiredText(receipt.payloadDigest, "receipt.payloadDigest", 80),
    providerMessageId: requiredText(receipt.providerMessageId, "receipt.providerMessageId", 240),
    status,
    occurredAt: new Date(occurredAt).toISOString()
  });
}

function verifySignedReceipt(receipt, envelope, secret) {
  const binding = receiptBinding(receipt);
  if (binding.eventId !== envelope.eventId || binding.payloadDigest !== envelope.payloadDigest) {
    throw new ReferralDeliveryTransportError("REFERRAL_TRANSPORT_RECEIPT_BINDING_INVALID", "receipt event or payload binding is invalid", 502);
  }
  if (!text(receipt?.signature, 256)) {
    throw new ReferralDeliveryTransportError("REFERRAL_TRANSPORT_RECEIPT_SIGNATURE_REQUIRED", "receipt HMAC signature is required", 502);
  }
  const signature = text(receipt.signature, 256).toLowerCase();
  const expected = hmac(secret, binding);
  if (!/^[a-f0-9]{64}$/.test(signature) || !secureEqual(signature, expected)) {
    throw new ReferralDeliveryTransportError("REFERRAL_TRANSPORT_RECEIPT_SIGNATURE_INVALID", "receipt HMAC signature is invalid", 502);
  }
  return Object.freeze({ ...binding, signatureDigest: sha256(signature), signatureVerified: true });
}

function createReferralDeliveryTransport(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const now = typeof options.now === "function" ? options.now : () => new Date().toISOString();
  return async function deliver(claim) {
    if (typeof fetchImpl !== "function") {
      throw new ReferralDeliveryTransportError("REFERRAL_TRANSPORT_UNAVAILABLE", "HTTPS referral delivery transport is unavailable");
    }
    const config = buildReferralTransportConfig(env);
    const envelope = deliveryEnvelope(claim, now());
    const body = stableStringify(envelope);
    const signature = hmac(config.secret, body);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    let response;
    try {
      response = await fetchImpl(config.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": envelope.eventId,
          "x-referral-event-id": envelope.eventId,
          "x-referral-payload-digest": envelope.payloadDigest,
          "x-referral-sent-at": envelope.sentAt,
          "x-referral-signature": signature,
          "x-referral-signature-algorithm": "hmac-sha256"
        },
        body,
        signal: controller.signal
      });
    } catch (error) {
      throw new ReferralDeliveryTransportError(
        error?.name === "AbortError" ? "REFERRAL_TRANSPORT_TIMEOUT" : "REFERRAL_TRANSPORT_FAILED",
        "signed referral delivery did not complete"
      );
    } finally {
      clearTimeout(timeout);
    }
    if (!response?.ok) {
      throw new ReferralDeliveryTransportError("REFERRAL_TRANSPORT_PROVIDER_REJECTED", "signed referral delivery was rejected", 502);
    }
    const raw = await response.text();
    if (raw.length > 16384) {
      throw new ReferralDeliveryTransportError("REFERRAL_TRANSPORT_RECEIPT_TOO_LARGE", "referral receipt exceeded the allowed size", 502);
    }
    let receipt;
    try {
      receipt = JSON.parse(raw);
    } catch {
      throw new ReferralDeliveryTransportError("REFERRAL_TRANSPORT_RECEIPT_INVALID", "referral receipt is not valid JSON", 502);
    }
    return verifySignedReceipt(receipt, envelope, config.secret);
  };
}

function inspectReferralTransportReadiness(env = process.env) {
  try {
    const config = buildReferralTransportConfig(env);
    return Object.freeze({
      configured: true,
      https: true,
      secretReady: true,
      evidenceReady: true,
      credentialsPersisted: config.credentialsPersisted,
      productionReady: false
    });
  } catch (error) {
    return Object.freeze({
      configured: false,
      https: false,
      secretReady: false,
      evidenceReady: false,
      errorCode: error.code || "REFERRAL_TRANSPORT_NOT_READY",
      credentialsPersisted: false,
      productionReady: false
    });
  }
}

module.exports = {
  ReferralDeliveryTransportError,
  buildReferralTransportConfig,
  createReferralDeliveryTransport,
  deliveryEnvelope,
  hmac,
  inspectReferralTransportReadiness,
  receiptBinding,
  verifySignedReceipt
};
