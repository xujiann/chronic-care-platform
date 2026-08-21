"use strict";

const {
  createHash,
  createHmac,
  timingSafeEqual
} = require("node:crypto");
const { promises: dns } = require("node:dns");
const { isIP } = require("node:net");

const FOLLOWUP_EVENT_TYPE = "citizen-chronic.followup-updated.v1";
const FOLLOWUP_EVENT_VERSION = 1;
const PUBLISHER_SCHEMA = "citizen-chronic.followup-event-publisher.v1";
const ACTIVATION_SCHEMA = "citizen-chronic.followup-event-publisher-activation.v1";
const RECEIPT_EVIDENCE_SCHEMA = "citizen-chronic.followup-event-receipt-evidence.v1";
const RECEIPT_MAX_BYTES = 16_384;
const APPROVED_PAYLOAD_FIELDS = Object.freeze([
  "followupId",
  "status",
  "updatedAt",
  "version"
]);
const VERIFIED_RECEIPTS = new WeakMap();

class FollowupEventPublisherError extends Error {
  constructor(code, message, statusCode = 503) {
    super(message);
    this.name = "FollowupEventPublisherError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function sha256(value) {
  return createHash("sha256")
    .update(typeof value === "string" ? value : stableStringify(value))
    .digest("hex");
}

function hmac(secret, value) {
  return createHmac("sha256", secret)
    .update(typeof value === "string" ? value : stableStringify(value))
    .digest("hex");
}

function secureEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""), "utf8");
  const rightBuffer = Buffer.from(String(right || ""), "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function requiredText(value, label, maximum = 300) {
  const result = String(value || "").trim();
  if (!result || result.length > maximum || /[\r\n\t]/.test(result)) {
    throw new FollowupEventPublisherError(
      "FOLLOWUP_EVENT_PUBLISHER_BINDING_INVALID",
      `${label} is missing or invalid`,
      409
    );
  }
  return result;
}

function requiredReceiptText(value, label, maximum = 300) {
  try {
    return requiredText(value, label, maximum);
  } catch (error) {
    if (!(error instanceof FollowupEventPublisherError)) throw error;
    throw new FollowupEventPublisherError(
      "FOLLOWUP_EVENT_PUBLISHER_RECEIPT_INVALID",
      "followup event publisher receipt is incomplete",
      502
    );
  }
}

function isProduction(env = {}) {
  return String(env.NODE_ENV || "").trim().toLowerCase() === "production";
}

function remoteConfigurationPresent(env = {}) {
  return [
    "CITIZEN_CHRONIC_FOLLOWUP_PUBLISHER_URL",
    "CITIZEN_CHRONIC_FOLLOWUP_PUBLISHER_HMAC_SECRET"
  ].some((name) => String(env[name] || "").trim());
}

function forbiddenIpv4(address) {
  const octets = String(address || "").split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    return true;
  }
  const [a, b] = octets;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || a >= 224;
}

function forbiddenNetworkAddress(address) {
  const normalized = String(address || "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  const family = isIP(normalized);
  if (family === 4) return forbiddenIpv4(normalized);
  if (family !== 6) return true;
  if (normalized === "::" || normalized === "::1") return true;
  if (/^f[cd][0-9a-f]{2}:/.test(normalized) || /^fe[89ab][0-9a-f]:/.test(normalized) || /^ff/.test(normalized)) {
    return true;
  }
  const mappedIpv4 = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  return mappedIpv4 ? forbiddenIpv4(mappedIpv4) : false;
}

function assertSafePublisherHostname(endpoint) {
  const hostname = String(endpoint?.hostname || "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!hostname
    || hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname.endsWith(".local")
    || (isIP(hostname) && forbiddenNetworkAddress(hostname))) {
    throw new FollowupEventPublisherError(
      "FOLLOWUP_EVENT_PUBLISHER_TARGET_FORBIDDEN",
      "followup event publisher target is not allowed"
    );
  }
}

async function assertSafePublisherResolution(endpoint, resolver = dns.lookup) {
  const hostname = String(endpoint.hostname || "").replace(/^\[|\]$/g, "");
  if (isIP(hostname)) return Object.freeze([hostname]);
  let results;
  try {
    results = await resolver(hostname, { all: true, verbatim: true });
  } catch {
    throw new FollowupEventPublisherError(
      "FOLLOWUP_EVENT_PUBLISHER_TARGET_RESOLUTION_FAILED",
      "followup event publisher target could not be resolved"
    );
  }
  const addresses = (Array.isArray(results) ? results : [results])
    .map((item) => String(item?.address || item || "").trim())
    .filter(Boolean);
  if (!addresses.length || addresses.some(forbiddenNetworkAddress)) {
    throw new FollowupEventPublisherError(
      "FOLLOWUP_EVENT_PUBLISHER_TARGET_FORBIDDEN",
      "followup event publisher target resolved to a forbidden network"
    );
  }
  return Object.freeze(addresses);
}

function buildFollowupEventPublisherConfig(env = process.env) {
  const endpointValue = String(env.CITIZEN_CHRONIC_FOLLOWUP_PUBLISHER_URL || "").trim();
  if (!endpointValue || endpointValue.length > 2_000) {
    throw new FollowupEventPublisherError(
      "FOLLOWUP_EVENT_PUBLISHER_ENDPOINT_INVALID",
      "followup event publisher endpoint is invalid"
    );
  }
  let endpoint;
  try {
    endpoint = new URL(endpointValue);
  } catch {
    throw new FollowupEventPublisherError(
      "FOLLOWUP_EVENT_PUBLISHER_ENDPOINT_INVALID",
      "followup event publisher endpoint is invalid"
    );
  }
  if (endpoint.protocol !== "https:") {
    throw new FollowupEventPublisherError(
      "FOLLOWUP_EVENT_PUBLISHER_HTTPS_REQUIRED",
      "followup event publisher endpoint must use HTTPS"
    );
  }
  if (endpoint.port && endpoint.port !== "443") {
    throw new FollowupEventPublisherError(
      "FOLLOWUP_EVENT_PUBLISHER_PORT_FORBIDDEN",
      "followup event publisher endpoint must use the controlled HTTPS port"
    );
  }
  if (endpoint.username || endpoint.password) {
    throw new FollowupEventPublisherError(
      "FOLLOWUP_EVENT_PUBLISHER_ENDPOINT_CREDENTIALS_FORBIDDEN",
      "followup event publisher endpoint must not contain credentials"
    );
  }
  if (endpoint.search || endpoint.hash) {
    throw new FollowupEventPublisherError(
      "FOLLOWUP_EVENT_PUBLISHER_ENDPOINT_COMPONENTS_FORBIDDEN",
      "followup event publisher endpoint must not contain query parameters or fragments"
    );
  }
  assertSafePublisherHostname(endpoint);

  const secret = String(env.CITIZEN_CHRONIC_FOLLOWUP_PUBLISHER_HMAC_SECRET || "").trim();
  if (secret.length < 32 || /replace-with|change-me|placeholder|example|demo[-_]/i.test(secret)) {
    throw new FollowupEventPublisherError(
      "FOLLOWUP_EVENT_PUBLISHER_SECRET_UNAVAILABLE",
      "followup event publisher HMAC secret is unavailable"
    );
  }
  const config = {
    endpoint: endpoint.toString(),
    endpointDigest: `sha256:${sha256(endpoint.toString())}`,
    timeoutMs: Math.min(
      30_000,
      Math.max(1_000, Number(env.CITIZEN_CHRONIC_FOLLOWUP_PUBLISHER_TIMEOUT_MS) || 8_000)
    ),
    receiptMaxSkewMs: Math.min(
      15 * 60_000,
      Math.max(
        1_000,
        (Number(env.CITIZEN_CHRONIC_FOLLOWUP_PUBLISHER_RECEIPT_MAX_SKEW_SECONDS) || 300) * 1_000
      )
    ),
    credentialsPersisted: false,
    productionReady: false
  };
  Object.defineProperty(config, "secret", {
    value: secret,
    enumerable: false,
    writable: false,
    configurable: false
  });
  return Object.freeze(config);
}

function approvedPayload(payload = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new FollowupEventPublisherError(
      "FOLLOWUP_EVENT_PUBLISHER_PAYLOAD_INVALID",
      "followup event payload is invalid",
      409
    );
  }
  const keys = Object.keys(payload).sort();
  if (keys.length !== APPROVED_PAYLOAD_FIELDS.length
    || keys.some((key, index) => key !== [...APPROVED_PAYLOAD_FIELDS].sort()[index])) {
    throw new FollowupEventPublisherError(
      "FOLLOWUP_EVENT_PUBLISHER_PAYLOAD_INVALID",
      "followup event payload is outside the approved contract",
      409
    );
  }
  const followupId = requiredText(payload.followupId, "payload.followupId", 240);
  const status = requiredText(payload.status, "payload.status", 80);
  const updatedAt = requiredText(payload.updatedAt, "payload.updatedAt", 80);
  const updatedAtMs = Date.parse(updatedAt);
  const version = Number(payload.version);
  if (!Number.isFinite(updatedAtMs) || !Number.isSafeInteger(version) || version < 1) {
    throw new FollowupEventPublisherError(
      "FOLLOWUP_EVENT_PUBLISHER_PAYLOAD_INVALID",
      "followup event payload version or time is invalid",
      409
    );
  }
  return Object.freeze({
    followupId,
    status,
    updatedAt: new Date(updatedAtMs).toISOString(),
    version
  });
}

function requestNonceBinding(envelope = {}) {
  return Object.freeze({
    requestId: envelope.requestId,
    eventId: envelope.eventId,
    payloadDigest: envelope.payloadDigest
  });
}

function createDeliveryEnvelope(eventEnvelope, options = {}) {
  const secret = String(options.secret || "");
  const sentAtMs = Date.parse(String(options.sentAt || ""));
  if (!Number.isFinite(sentAtMs)) {
    throw new FollowupEventPublisherError(
      "FOLLOWUP_EVENT_PUBLISHER_BINDING_INVALID",
      "followup event publisher time is invalid",
      409
    );
  }
  const payload = approvedPayload(eventEnvelope?.payload);
  const eventId = requiredText(eventEnvelope?.eventId, "eventId", 240);
  const eventType = requiredText(eventEnvelope?.eventType, "eventType", 160);
  const eventVersion = Number(eventEnvelope?.eventVersion);
  const correlationId = requiredText(eventEnvelope?.correlationId, "correlationId", 240);
  if (eventType !== FOLLOWUP_EVENT_TYPE
    || eventVersion !== FOLLOWUP_EVENT_VERSION
    || payload.version < 1) {
    throw new FollowupEventPublisherError(
      "FOLLOWUP_EVENT_PUBLISHER_EVENT_CONTRACT_INVALID",
      "followup event is outside the approved publisher contract",
      409
    );
  }
  const payloadDigest = sha256(payload);
  const requestId = `followup-publisher:${sha256({ eventId, payloadDigest })}`;
  const envelope = {
    schema: PUBLISHER_SCHEMA,
    requestId,
    eventId,
    eventType,
    eventVersion,
    correlationId,
    payloadDigest,
    sentAt: new Date(sentAtMs).toISOString(),
    payload
  };
  envelope.requestNonce = hmac(secret, requestNonceBinding(envelope));
  return Object.freeze(envelope);
}

function activationRequest(envelope, config, requestedAt) {
  return Object.freeze({
    schema: ACTIVATION_SCHEMA,
    contractId: PUBLISHER_SCHEMA,
    endpointDigest: config.endpointDigest,
    eventId: envelope.eventId,
    payloadDigest: envelope.payloadDigest,
    requestedAt
  });
}

async function verifyPublisherActivation(activationVerifier, request) {
  if (!activationVerifier || typeof activationVerifier.verify !== "function") {
    throw new FollowupEventPublisherError(
      "FOLLOWUP_EVENT_PUBLISHER_ACTIVATION_VERIFIER_REQUIRED",
      "followup event publisher activation verifier is required"
    );
  }
  let result;
  try {
    result = await activationVerifier.verify(request);
  } catch {
    throw new FollowupEventPublisherError(
      "FOLLOWUP_EVENT_PUBLISHER_ACTIVATION_VERIFICATION_FAILED",
      "followup event publisher activation could not be verified"
    );
  }
  const verifiedAt = Date.parse(String(result?.verifiedAt || ""));
  const validUntil = Date.parse(String(result?.validUntil || ""));
  const requestedAt = Date.parse(request.requestedAt);
  const evidenceDigest = String(result?.evidenceDigest || "").trim().toLowerCase();
  const activationId = String(result?.activationId || "").trim();
  if (result?.authorized !== true
    || result?.schema !== ACTIVATION_SCHEMA
    || result?.contractId !== request.contractId
    || result?.endpointDigest !== request.endpointDigest
    || result?.eventId !== request.eventId
    || result?.payloadDigest !== request.payloadDigest
    || !activationId
    || activationId.length > 240
    || !/^sha256:[a-f0-9]{64}$/.test(evidenceDigest)
    || !Number.isFinite(verifiedAt)
    || !Number.isFinite(validUntil)
    || !Number.isFinite(requestedAt)
    || verifiedAt > requestedAt + 5 * 60_000
    || validUntil < requestedAt) {
    throw new FollowupEventPublisherError(
      "FOLLOWUP_EVENT_PUBLISHER_ACTIVATION_DENIED",
      "followup event publisher activation is not authorized",
      409
    );
  }
  const binding = Object.freeze({
    schema: result.schema,
    contractId: result.contractId,
    endpointDigest: result.endpointDigest,
    eventId: result.eventId,
    payloadDigest: result.payloadDigest,
    activationId,
    evidenceDigest,
    verifiedAt: new Date(verifiedAt).toISOString(),
    validUntil: new Date(validUntil).toISOString()
  });
  return Object.freeze({
    activationDigest: `sha256:${sha256(binding)}`,
    binding
  });
}

function receiptBinding(receipt = {}) {
  const status = requiredReceiptText(receipt.status, "receipt.status", 40).toLowerCase();
  const occurredAtValue = requiredReceiptText(receipt.occurredAt, "receipt.occurredAt", 80);
  const sentAtValue = requiredReceiptText(receipt.sentAt, "receipt.sentAt", 80);
  const occurredAtMs = Date.parse(occurredAtValue);
  const sentAtMs = Date.parse(sentAtValue);
  if (!new Set(["accepted", "delivered"]).has(status)
    || !Number.isFinite(occurredAtMs)
    || !Number.isFinite(sentAtMs)) {
    throw new FollowupEventPublisherError(
      "FOLLOWUP_EVENT_PUBLISHER_RECEIPT_INVALID",
      "followup event publisher receipt is invalid",
      502
    );
  }
  return Object.freeze({
    requestId: requiredReceiptText(receipt.requestId, "receipt.requestId", 400),
    requestNonce: requiredReceiptText(receipt.requestNonce, "receipt.requestNonce", 128),
    eventId: requiredReceiptText(receipt.eventId, "receipt.eventId", 240),
    eventType: requiredReceiptText(receipt.eventType, "receipt.eventType", 160),
    eventVersion: Number(receipt.eventVersion),
    correlationId: requiredReceiptText(receipt.correlationId, "receipt.correlationId", 240),
    payloadDigest: requiredReceiptText(receipt.payloadDigest, "receipt.payloadDigest", 80),
    sentAt: new Date(sentAtMs).toISOString(),
    receiptId: requiredReceiptText(receipt.receiptId, "receipt.receiptId", 240),
    status,
    occurredAt: new Date(occurredAtMs).toISOString()
  });
}

function verifySignedReceipt(receipt, envelope, secret, options = {}) {
  const binding = receiptBinding(receipt);
  if (binding.requestId !== envelope.requestId
    || binding.requestNonce !== envelope.requestNonce
    || binding.eventId !== envelope.eventId
    || binding.eventType !== envelope.eventType
    || binding.eventVersion !== envelope.eventVersion
    || binding.correlationId !== envelope.correlationId
    || binding.payloadDigest !== envelope.payloadDigest
    || !secureEqual(envelope.requestNonce, hmac(secret, requestNonceBinding(envelope)))) {
    throw new FollowupEventPublisherError(
      "FOLLOWUP_EVENT_PUBLISHER_RECEIPT_BINDING_INVALID",
      "followup event publisher receipt is not bound to the request",
      502
    );
  }
  const verifiedAtMs = Date.parse(String(options.verifiedAt || ""));
  const occurredAtMs = Date.parse(binding.occurredAt);
  const sentAtMs = Date.parse(binding.sentAt);
  const maximumSkewMs = Math.min(
    15 * 60_000,
    Math.max(1_000, Number(options.maximumSkewMs) || 5 * 60_000)
  );
  if (!Number.isFinite(verifiedAtMs)
    || Math.abs(occurredAtMs - sentAtMs) > maximumSkewMs
    || sentAtMs > verifiedAtMs + maximumSkewMs
    || occurredAtMs > verifiedAtMs + maximumSkewMs) {
    throw new FollowupEventPublisherError(
      "FOLLOWUP_EVENT_PUBLISHER_RECEIPT_TIME_WINDOW_INVALID",
      "followup event publisher receipt is outside the accepted time window",
      502
    );
  }
  const signature = String(receipt?.signature || "").trim().toLowerCase();
  if (!signature) {
    throw new FollowupEventPublisherError(
      "FOLLOWUP_EVENT_PUBLISHER_RECEIPT_SIGNATURE_REQUIRED",
      "followup event publisher receipt signature is required",
      502
    );
  }
  const expected = hmac(secret, binding);
  if (!/^[a-f0-9]{64}$/.test(signature) || !secureEqual(signature, expected)) {
    throw new FollowupEventPublisherError(
      "FOLLOWUP_EVENT_PUBLISHER_RECEIPT_SIGNATURE_INVALID",
      "followup event publisher receipt signature is invalid",
      502
    );
  }
  const capability = Object.freeze({
    schema: RECEIPT_EVIDENCE_SCHEMA,
    eventId: binding.eventId,
    eventType: binding.eventType,
    eventVersion: binding.eventVersion,
    correlationId: binding.correlationId,
    payloadDigest: binding.payloadDigest,
    deliveryStatus: binding.status,
    occurredAt: binding.occurredAt,
    requestBindingDigest: `sha256:${sha256({
      requestId: binding.requestId,
      requestNonce: binding.requestNonce,
      eventId: binding.eventId,
      payloadDigest: binding.payloadDigest
    })}`,
    receiptBindingDigest: `sha256:${sha256(binding)}`,
    providerReceiptDigest: `sha256:${sha256(binding.receiptId)}`,
    signatureDigest: `sha256:${sha256(signature)}`,
    activationDigest: String(options.activationDigest || "")
  });
  const verifiedReceipt = Object.freeze({
    accepted: true,
    receiptId: binding.receiptId,
    status: binding.status,
    eventId: binding.eventId,
    payloadDigest: binding.payloadDigest,
    occurredAt: binding.occurredAt,
    requestBindingDigest: capability.requestBindingDigest,
    receiptBindingDigest: capability.receiptBindingDigest,
    providerReceiptDigest: capability.providerReceiptDigest,
    signatureDigest: capability.signatureDigest,
    activationDigest: capability.activationDigest,
    signatureVerified: true,
    transportVerified: true,
    productionReady: false
  });
  VERIFIED_RECEIPTS.set(verifiedReceipt, capability);
  return verifiedReceipt;
}

function assertVerifiedFollowupEventPublisherReceipt(receipt, eventEnvelope) {
  const capability = receipt && typeof receipt === "object" ? VERIFIED_RECEIPTS.get(receipt) : null;
  const payload = approvedPayload(eventEnvelope?.payload);
  const payloadDigest = sha256(payload);
  if (!capability
    || capability.schema !== RECEIPT_EVIDENCE_SCHEMA
    || capability.eventId !== eventEnvelope?.eventId
    || capability.eventType !== eventEnvelope?.eventType
    || capability.eventVersion !== Number(eventEnvelope?.eventVersion)
    || capability.correlationId !== eventEnvelope?.correlationId
    || capability.payloadDigest !== payloadDigest
    || !/^sha256:[a-f0-9]{64}$/.test(capability.activationDigest)) {
    throw new FollowupEventPublisherError(
      "FOLLOWUP_EVENT_PUBLISHER_RECEIPT_UNVERIFIED",
      "production followup event publisher requires a verified receipt capability",
      502
    );
  }
  return capability;
}

function responseContentLength(response) {
  const raw = response?.headers?.get?.("content-length");
  const length = Number(raw);
  return Number.isFinite(length) && length >= 0 ? length : null;
}

async function readBoundedResponseText(response, maximumBytes = RECEIPT_MAX_BYTES) {
  const contentLength = responseContentLength(response);
  if (contentLength !== null && contentLength > maximumBytes) {
    throw new FollowupEventPublisherError(
      "FOLLOWUP_EVENT_PUBLISHER_RECEIPT_TOO_LARGE",
      "followup event publisher receipt exceeded the allowed size",
      502
    );
  }
  if (response?.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      size += chunk.length;
      if (size > maximumBytes) {
        await reader.cancel().catch(() => {});
        throw new FollowupEventPublisherError(
          "FOLLOWUP_EVENT_PUBLISHER_RECEIPT_TOO_LARGE",
          "followup event publisher receipt exceeded the allowed size",
          502
        );
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString("utf8");
  }
  const raw = await response.text();
  if (Buffer.byteLength(raw, "utf8") > maximumBytes) {
    throw new FollowupEventPublisherError(
      "FOLLOWUP_EVENT_PUBLISHER_RECEIPT_TOO_LARGE",
      "followup event publisher receipt exceeded the allowed size",
      502
    );
  }
  return raw;
}

function createSignedFollowupEventPublisher(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const now = typeof options.now === "function" ? options.now : () => new Date().toISOString();
  const activationVerifier = options.activationVerifier;
  const resolver = typeof options.resolveAddresses === "function" ? options.resolveAddresses : dns.lookup;
  const inFlight = new Map();
  return Object.freeze({
    mode: "signed-https",
    productionReady: false,
    async publish(eventEnvelope) {
      const config = buildFollowupEventPublisherConfig(env);
      const sentAt = new Date(now()).toISOString();
      const envelope = createDeliveryEnvelope(eventEnvelope, {
        secret: config.secret,
        sentAt
      });
      if (inFlight.has(envelope.requestId)) return inFlight.get(envelope.requestId);
      const delivery = (async () => {
        if (typeof fetchImpl !== "function") {
          throw new FollowupEventPublisherError(
            "FOLLOWUP_EVENT_PUBLISHER_TRANSPORT_UNAVAILABLE",
            "followup event HTTPS publisher is unavailable"
          );
        }
        const activation = await verifyPublisherActivation(
          activationVerifier,
          activationRequest(envelope, config, envelope.sentAt)
        );
        await assertSafePublisherResolution(new URL(config.endpoint), resolver);
        const body = stableStringify(envelope);
        const signature = hmac(config.secret, body);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
        let raw;
        try {
          const response = await fetchImpl(config.endpoint, {
            method: "POST",
            redirect: "error",
            headers: {
              "content-type": "application/json",
              "idempotency-key": envelope.requestId,
              "x-followup-event-id": envelope.eventId,
              "x-followup-payload-digest": envelope.payloadDigest,
              "x-followup-request-id": envelope.requestId,
              "x-followup-request-nonce": envelope.requestNonce,
              "x-followup-sent-at": envelope.sentAt,
              "x-followup-signature": signature,
              "x-followup-signature-algorithm": "hmac-sha256"
            },
            body,
            signal: controller.signal
          });
          if (response?.redirected === true
            || (response?.url && new URL(response.url).toString() !== config.endpoint)) {
            throw new FollowupEventPublisherError(
              "FOLLOWUP_EVENT_PUBLISHER_REDIRECT_FORBIDDEN",
              "followup event publisher redirects are forbidden",
              502
            );
          }
          if (!response?.ok) {
            throw new FollowupEventPublisherError(
              "FOLLOWUP_EVENT_PUBLISHER_PROVIDER_REJECTED",
              "signed followup event delivery was rejected",
              502
            );
          }
          raw = await readBoundedResponseText(response);
        } catch (error) {
          if (error instanceof FollowupEventPublisherError) throw error;
          throw new FollowupEventPublisherError(
            error?.name === "AbortError"
              ? "FOLLOWUP_EVENT_PUBLISHER_TIMEOUT"
              : "FOLLOWUP_EVENT_PUBLISHER_TRANSPORT_FAILED",
            "signed followup event delivery did not complete"
          );
        } finally {
          clearTimeout(timeout);
        }
        let receipt;
        try {
          receipt = JSON.parse(raw);
        } catch {
          throw new FollowupEventPublisherError(
            "FOLLOWUP_EVENT_PUBLISHER_RECEIPT_INVALID",
            "followup event publisher receipt is not valid JSON",
            502
          );
        }
        return verifySignedReceipt(receipt, envelope, config.secret, {
          activationDigest: activation.activationDigest,
          verifiedAt: new Date(now()).toISOString(),
          maximumSkewMs: config.receiptMaxSkewMs
        });
      })();
      inFlight.set(envelope.requestId, delivery);
      try {
        return await delivery;
      } finally {
        if (inFlight.get(envelope.requestId) === delivery) inFlight.delete(envelope.requestId);
      }
    }
  });
}

function createLocalFollowupEventPublisher() {
  return Object.freeze({
    mode: "local-simulated",
    productionReady: false,
    async publish(envelope) {
      return Object.freeze({
        accepted: true,
        receiptId: `local-followup-receipt:${envelope.eventId}`,
        status: "accepted",
        simulated: true,
        productionReady: false
      });
    }
  });
}

function createFollowupEventPublisher(options = {}) {
  const env = options.env || process.env;
  if (isProduction(env) || remoteConfigurationPresent(env)) {
    return createSignedFollowupEventPublisher(options);
  }
  return createLocalFollowupEventPublisher();
}

function inspectFollowupEventPublisherReadiness(env = process.env, options = {}) {
  const activationVerifierConfigured = Boolean(
    options.activationVerifier && typeof options.activationVerifier.verify === "function"
  );
  if (!isProduction(env) && !remoteConfigurationPresent(env)) {
    return Object.freeze({
      mode: "local-simulated",
      configured: false,
      activationVerifierConfigured,
      activationAuthorized: false,
      transportVerified: false,
      signedReceiptRequired: false,
      productionReady: false
    });
  }
  try {
    buildFollowupEventPublisherConfig(env);
    return Object.freeze({
      mode: "signed-https",
      configured: activationVerifierConfigured,
      transportConfigured: true,
      activationVerifierConfigured,
      activationAuthorized: false,
      transportVerified: false,
      signedReceiptRequired: true,
      productionReady: false
    });
  } catch (error) {
    return Object.freeze({
      mode: "signed-https",
      configured: false,
      transportConfigured: false,
      activationVerifierConfigured,
      activationAuthorized: false,
      transportVerified: false,
      signedReceiptRequired: true,
      errorCode: error.code || "FOLLOWUP_EVENT_PUBLISHER_NOT_READY",
      productionReady: false
    });
  }
}

module.exports = {
  ACTIVATION_SCHEMA,
  APPROVED_PAYLOAD_FIELDS,
  FOLLOWUP_EVENT_TYPE,
  FOLLOWUP_EVENT_VERSION,
  FollowupEventPublisherError,
  PUBLISHER_SCHEMA,
  RECEIPT_EVIDENCE_SCHEMA,
  activationRequest,
  approvedPayload,
  assertSafePublisherResolution,
  assertVerifiedFollowupEventPublisherReceipt,
  buildFollowupEventPublisherConfig,
  createDeliveryEnvelope,
  createFollowupEventPublisher,
  createLocalFollowupEventPublisher,
  createSignedFollowupEventPublisher,
  hmac,
  inspectFollowupEventPublisherReadiness,
  receiptBinding,
  requestNonceBinding,
  sha256,
  stableStringify,
  verifyPublisherActivation,
  verifySignedReceipt
};
