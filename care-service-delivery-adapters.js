"use strict";

const { createHmac, timingSafeEqual } = require("node:crypto");

class CareServiceDeliveryError extends Error {
  constructor(code, message, statusCode = 503) {
    super(message);
    this.name = "CareServiceDeliveryError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function text(value, max = 300) {
  return String(value || "").trim().replace(/[\r\n\t]+/g, " ").slice(0, max);
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function secureEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function deliveryConfiguration(domain, env = process.env) {
  const prefix = domain === "nursing" ? "CARE_NURSING" : "CARE_ESCORT";
  const endpoint = text(env[`${prefix}_DELIVERY_URL`], 1000);
  const secret = String(env[`${prefix}_DELIVERY_SECRET`] || env.CARE_OUTBOX_DELIVERY_SECRET || "").trim();
  const timeoutMs = Math.min(30000, Math.max(1000, Number(env.CARE_OUTBOX_DELIVERY_TIMEOUT_MS || 8000)));
  if (!endpoint) {
    throw new CareServiceDeliveryError(
      "CARE_DELIVERY_ENDPOINT_MISSING",
      `signed ${domain} delivery endpoint is not configured`
    );
  }
  let parsed;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new CareServiceDeliveryError("CARE_DELIVERY_ENDPOINT_INVALID", `signed ${domain} delivery endpoint is invalid`);
  }
  const allowHttp = env.NODE_ENV !== "production" && /^(1|true|yes)$/i.test(String(env.CARE_DELIVERY_ALLOW_HTTP || ""));
  if (parsed.protocol !== "https:" && !allowHttp) {
    throw new CareServiceDeliveryError("CARE_DELIVERY_HTTPS_REQUIRED", `signed ${domain} delivery endpoint must use HTTPS`);
  }
  const minimumSecretLength = env.NODE_ENV === "production" ? 32 : 16;
  if (secret.length < minimumSecretLength || /replace-with|change-me|placeholder|example|demo[-_]/i.test(secret)) {
    throw new CareServiceDeliveryError("CARE_DELIVERY_SECRET_UNAVAILABLE", `signed ${domain} delivery secret is unavailable`);
  }
  return { endpoint: parsed.toString(), secret, timeoutMs };
}

function deliveryEnvelope(domain, event, context, at) {
  return {
    schema: "care-service-delivery.v1",
    eventId: text(event?.id, 240),
    domain,
    eventType: text(event?.eventType, 120),
    aggregateId: text(event?.aggregateId, 240),
    idempotencyKey: text(context?.idempotencyKey || event?.idempotencyKey, 300),
    payloadDigest: text(context?.payloadDigest || event?.payloadDigest, 128),
    attempt: Number(context?.attempt || event?.attempts || 0),
    workerId: text(context?.workerId, 120),
    runId: text(context?.runId, 160),
    sentAt: at,
    payload: event?.payload && typeof event.payload === "object" ? event.payload : {}
  };
}

function validateReceipt(receipt, envelope, secret) {
  const status = text(receipt?.status, 40).toLowerCase();
  const providerMessageId = text(receipt?.providerMessageId, 200);
  if (!["accepted", "sent", "delivered"].includes(status) || !providerMessageId) {
    throw new CareServiceDeliveryError("CARE_DELIVERY_RECEIPT_INVALID", "delivery receipt is missing its accepted status or provider message id", 502);
  }
  if (receipt.eventId && text(receipt.eventId, 240) !== envelope.eventId) {
    throw new CareServiceDeliveryError("CARE_DELIVERY_RECEIPT_BINDING_INVALID", "delivery receipt event binding is invalid", 502);
  }
  if (receipt.payloadDigest && text(receipt.payloadDigest, 128) !== envelope.payloadDigest) {
    throw new CareServiceDeliveryError("CARE_DELIVERY_RECEIPT_BINDING_INVALID", "delivery receipt payload binding is invalid", 502);
  }
  if (receipt.signature) {
    const signedReceipt = {
      eventId: envelope.eventId,
      payloadDigest: envelope.payloadDigest,
      providerMessageId,
      status,
      occurredAt: text(receipt.occurredAt, 80)
    };
    const expected = createHmac("sha256", secret).update(stableStringify(signedReceipt)).digest("hex");
    if (!secureEqual(expected, receipt.signature)) {
      throw new CareServiceDeliveryError("CARE_DELIVERY_RECEIPT_SIGNATURE_INVALID", "delivery receipt signature is invalid", 502);
    }
  }
  return {
    status,
    providerMessageId,
    providerCode: text(receipt.providerCode, 80),
    occurredAt: new Date().toISOString()
  };
}

function createSignedDeliveryAdapter(domain, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const now = typeof options.now === "function" ? options.now : () => new Date().toISOString();
  return async (event, context = {}) => {
    if (typeof fetchImpl !== "function") {
      throw new CareServiceDeliveryError("CARE_DELIVERY_TRANSPORT_UNAVAILABLE", "HTTPS delivery transport is unavailable");
    }
    const config = deliveryConfiguration(domain, env);
    const at = now();
    const envelope = deliveryEnvelope(domain, event, context, at);
    if (!envelope.eventId || !envelope.aggregateId || !envelope.idempotencyKey || !envelope.payloadDigest) {
      throw new CareServiceDeliveryError("CARE_DELIVERY_EVENT_BINDING_INVALID", "delivery event binding is incomplete", 409);
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
          "idempotency-key": envelope.idempotencyKey,
          "x-care-event-id": envelope.eventId,
          "x-care-payload-digest": envelope.payloadDigest,
          "x-care-sent-at": at,
          "x-care-signature": signature
        },
        body,
        signal: controller.signal
      });
    } catch (error) {
      const code = error?.name === "AbortError" ? "CARE_DELIVERY_TIMEOUT" : "CARE_DELIVERY_TRANSPORT_FAILED";
      throw new CareServiceDeliveryError(code, `signed ${domain} delivery did not complete`);
    } finally {
      clearTimeout(timeout);
    }
    if (!response?.ok) {
      throw new CareServiceDeliveryError("CARE_DELIVERY_PROVIDER_REJECTED", `signed ${domain} delivery was rejected with HTTP ${Number(response?.status || 502)}`, 502);
    }
    const raw = await response.text();
    if (raw.length > 16384) {
      throw new CareServiceDeliveryError("CARE_DELIVERY_RECEIPT_TOO_LARGE", "delivery receipt exceeded the allowed size", 502);
    }
    let receipt;
    try {
      receipt = JSON.parse(raw);
    } catch {
      throw new CareServiceDeliveryError("CARE_DELIVERY_RECEIPT_INVALID", "delivery receipt is not valid JSON", 502);
    }
    return validateReceipt(receipt, envelope, config.secret);
  };
}

function createCareServiceDeliveryAdapters(options = {}) {
  return {
    nursing: createSignedDeliveryAdapter("nursing", options),
    escort: createSignedDeliveryAdapter("escort", options)
  };
}

module.exports = {
  CareServiceDeliveryError,
  createCareServiceDeliveryAdapters,
  createSignedDeliveryAdapter,
  deliveryConfiguration,
  deliveryEnvelope,
  stableStringify,
  validateReceipt
};
