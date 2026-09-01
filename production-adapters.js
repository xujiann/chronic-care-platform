const {
  constants: cryptoConstants,
  createHash,
  createHmac,
  createPublicKey,
  randomInt,
  timingSafeEqual,
  verify: verifySignature
} = require("node:crypto");

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_OIDC_CLOCK_SKEW_SECONDS = 60;
const DEFAULT_SMS_CALLBACK_MAX_SKEW_SECONDS = 300;
const SMS_DELIVERY_STATUSES = new Set(["accepted", "queued", "sent", "delivered", "failed", "expired", "undeliverable", "rejected"]);
const SMS_DELIVERY_TERMINAL_STATUSES = new Set(["delivered", "failed", "expired", "undeliverable", "rejected"]);
const SMS_ACCEPTANCE_STATUSES = new Set(["accepted", "queued", "sent", "delivered"]);
const SMS_REJECTION_STATUSES = new Set(["failed", "expired", "undeliverable", "rejected", "error", "denied"]);
const SMS_DELIVERY_STATUS_RANK = new Map([
  ["accepted", 0],
  ["queued", 1],
  ["sent", 2],
  ["delivered", 3],
  ["failed", 3],
  ["expired", 3],
  ["undeliverable", 3],
  ["rejected", 3]
]);

class SmsDeliveryCallbackError extends Error {
  constructor(message, code, statusCode = 400) {
    super(message);
    this.name = "SmsDeliveryCallbackError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

class ProductionAdapterError extends Error {
  constructor(message, code, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "ProductionAdapterError";
    this.code = code;
    this.statusCode = options.statusCode || 502;
    this.retryable = options.retryable === true;
  }
}

function isProduction(env = process.env) {
  return String(env.NODE_ENV || "").toLowerCase() === "production";
}

function validatedHttpUrl(value, label, env = process.env) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
  if (!new Set(["http:", "https:"]).has(url.protocol)) throw new Error(`${label} must use HTTP or HTTPS`);
  if (isProduction(env) && url.protocol !== "https:") throw new Error(`${label} must use HTTPS in production`);
  return url;
}

function boundedTimeout(value) {
  return Math.min(30000, Math.max(100, Number(value || DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS));
}

function boundedAttempts(value) {
  return Math.min(5, Math.max(1, Number(value || DEFAULT_MAX_ATTEMPTS) || DEFAULT_MAX_ATTEMPTS));
}

function safeAdapterLog(logger, level, event, fields = {}) {
  if (!logger || typeof logger[level] !== "function") return;
  const safeFields = Object.fromEntries(Object.entries(fields).filter(([key, value]) => (
    !/token|secret|authorization|phone|mobile|code|credential|payload|body|idempotency/i.test(key)
    && ["string", "number", "boolean"].includes(typeof value)
  )));
  try {
    logger[level](event, safeFields);
  } catch {}
}

function identityAdapterStatus(env = process.env) {
  const issuer = String(env.OIDC_ISSUER_URL || "").trim();
  const userInfo = String(env.OIDC_USERINFO_URL || "").trim();
  const tokenEndpoint = String(env.OIDC_TOKEN_URL || "").trim();
  const revocationEndpoint = String(env.OIDC_REVOCATION_URL || "").trim();
  const directoryEndpoint = String(env.IDENTITY_DIRECTORY_URL || "").trim();
  const configured = Boolean(issuer && env.OIDC_CLIENT_ID && env.OIDC_CLIENT_SECRET);
  const directoryConfigured = Boolean(directoryEndpoint && env.IDENTITY_DIRECTORY_TOKEN);
  return {
    type: "oidc-userinfo",
    configured,
    issuerConfigured: Boolean(issuer),
    userInfoConfigured: Boolean(userInfo),
    clientConfigured: Boolean(env.OIDC_CLIENT_ID && env.OIDC_CLIENT_SECRET),
    refreshConfigured: configured && Boolean(tokenEndpoint || issuer),
    revocationConfigured: configured && Boolean(revocationEndpoint || issuer),
    directoryConfigured,
    directoryEndpointConfigured: Boolean(directoryEndpoint),
    directoryCredentialConfigured: Boolean(env.IDENTITY_DIRECTORY_TOKEN),
    productionHttps: !isProduction(env) || [issuer, userInfo, tokenEndpoint, revocationEndpoint, directoryEndpoint].filter(Boolean).every((item) => /^https:\/\//i.test(item)),
    timeoutMs: boundedTimeout(env.IDENTITY_ADAPTER_TIMEOUT_MS),
    clockSkewSeconds: Math.min(300, Math.max(0, Number(env.OIDC_CLOCK_SKEW_SECONDS || DEFAULT_OIDC_CLOCK_SKEW_SECONDS) || DEFAULT_OIDC_CLOCK_SKEW_SECONDS)),
    boundary: "The adapter verifies UserInfo, refreshes and revokes upstream tokens, and previews directory deactivations. Provisioning, privilege changes and reactivation remain controlled workflows."
  };
}

function smsAdapterStatus(env = process.env) {
  const gatewayUrl = String(env.SMS_GATEWAY_URL || "").trim();
  const healthUrl = String(env.SMS_GATEWAY_HEALTH_URL || "").trim();
  const authMode = String(env.SMS_GATEWAY_AUTH_MODE || "bearer").trim().toLowerCase();
  const authModeSupported = ["bearer", "mtls", "none"].includes(authMode);
  const credentialConfigured = authMode === "bearer" && Boolean(String(env.SMS_GATEWAY_TOKEN || "").trim());
  const productionAuthSupported = authMode === "bearer";
  const callbackMaxSkewSeconds = Math.min(900, Math.max(60, Number(env.SMS_DELIVERY_CALLBACK_MAX_SKEW_SECONDS || DEFAULT_SMS_CALLBACK_MAX_SKEW_SECONDS) || DEFAULT_SMS_CALLBACK_MAX_SKEW_SECONDS));
  return {
    type: "http-json",
    configured: Boolean(gatewayUrl && env.SMS_TEMPLATE_ID),
    productionConfigured: Boolean(gatewayUrl && env.SMS_TEMPLATE_ID && credentialConfigured && productionAuthSupported),
    gatewayConfigured: Boolean(gatewayUrl),
    healthEndpointConfigured: Boolean(healthUrl),
    templateConfigured: Boolean(env.SMS_TEMPLATE_ID),
    senderConfigured: Boolean(env.SMS_SENDER),
    authMode,
    authModeSupported,
    productionAuthSupported,
    credentialConfigured,
    callbackConfigured: Boolean(String(env.SMS_DELIVERY_CALLBACK_SECRET || "").trim()),
    callbackMaxSkewSeconds,
    productionHttps: !isProduction(env) || !gatewayUrl || /^https:\/\//i.test(gatewayUrl),
    timeoutMs: boundedTimeout(env.SMS_GATEWAY_TIMEOUT_MS),
    maxAttempts: boundedAttempts(env.SMS_GATEWAY_MAX_ATTEMPTS),
    boundary: "Provider acceptance and signed final-delivery callbacks are persisted. Provider-specific field mapping, production keys and joint-test receipts remain site integration work."
  };
}

function stableSmsCallbackStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableSmsCallbackStringify(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSmsCallbackStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function safeCallbackText(value, maxLength = 160) {
  return String(value || "").trim().replace(/[\r\n]/g, " ").slice(0, maxLength);
}

function normalizeSmsAcceptanceStatus(value) {
  if (value === undefined || value === null || (typeof value === "string" && !value.trim())) return "accepted";
  return String(value).trim().toLowerCase();
}

function normalizeSmsDeliveryStatus(value) {
  const normalized = safeCallbackText(value, 40).toLowerCase().replace(/[\s_]+/g, "-");
  const aliases = {
    success: "delivered",
    "delivered-successfully": "delivered",
    "delivery-failed": "failed",
    "send-failed": "failed",
    "invalid-number": "undeliverable"
  };
  const status = aliases[normalized] || normalized;
  if (!SMS_DELIVERY_STATUSES.has(status)) {
    throw new SmsDeliveryCallbackError("SMS delivery callback status is unsupported", "SMS_CALLBACK_STATUS_INVALID");
  }
  return status;
}

function normalizeSmsDeliveryCallback(payload = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new SmsDeliveryCallbackError("SMS delivery callback body must be an object", "SMS_CALLBACK_BODY_INVALID");
  }
  const eventId = safeCallbackText(payload.eventId || payload.event_id, 160);
  const providerMessageId = safeCallbackText(payload.providerMessageId || payload.messageId || payload.message_id, 200);
  const occurredAt = safeCallbackText(payload.occurredAt || payload.occurred_at || payload.timestamp, 80);
  if (!eventId || !providerMessageId) {
    throw new SmsDeliveryCallbackError("SMS delivery callback requires eventId and providerMessageId", "SMS_CALLBACK_IDENTITY_REQUIRED");
  }
  if (!occurredAt || !Number.isFinite(Date.parse(occurredAt))) {
    throw new SmsDeliveryCallbackError("SMS delivery callback occurredAt is invalid", "SMS_CALLBACK_TIME_INVALID");
  }
  return {
    eventId,
    providerMessageId,
    status: normalizeSmsDeliveryStatus(payload.status || payload.deliveryStatus || payload.delivery_status),
    occurredAt: new Date(occurredAt).toISOString(),
    providerCode: safeCallbackText(payload.providerCode || payload.code, 80),
    failureReason: safeCallbackText(payload.failureReason || payload.reason, 240)
  };
}

function smsCallbackSigningInput(payload, timestamp, nonce) {
  return `${timestamp}.${nonce}.${stableSmsCallbackStringify(payload)}`;
}

function signSmsDeliveryCallback(payload, options = {}) {
  const secret = String(options.secret || "").trim();
  const timestamp = String(options.timestamp || "").trim();
  const nonce = String(options.nonce || "").trim();
  if (!secret || !timestamp || !nonce) throw new SmsDeliveryCallbackError("SMS callback signing requires secret, timestamp and nonce", "SMS_CALLBACK_SIGNING_INPUT_REQUIRED");
  return createHmac("sha256", secret).update(smsCallbackSigningInput(payload, timestamp, nonce)).digest("hex");
}

function verifySmsDeliveryCallback(payload, options = {}) {
  const env = options.env || process.env;
  const secret = String(options.secret || env.SMS_DELIVERY_CALLBACK_SECRET || "").trim();
  if (!secret) throw new SmsDeliveryCallbackError("SMS delivery callback secret is not configured", "SMS_CALLBACK_NOT_CONFIGURED", 503);
  if (isProduction(env) && secret.length < 32) {
    throw new SmsDeliveryCallbackError("SMS delivery callback secret does not meet production quality", "SMS_CALLBACK_SECRET_WEAK", 503);
  }
  const timestamp = String(options.timestamp || "").trim();
  const timestampSeconds = Number(timestamp);
  if (!/^\d{10,13}$/.test(timestamp) || !Number.isFinite(timestampSeconds)) {
    throw new SmsDeliveryCallbackError("SMS delivery callback timestamp is invalid", "SMS_CALLBACK_TIMESTAMP_INVALID");
  }
  const callbackTimeMs = timestamp.length === 13 ? timestampSeconds : timestampSeconds * 1000;
  const nowMs = Number(options.nowMs ?? Date.now());
  const maxSkewSeconds = Math.min(900, Math.max(60, Number(options.maxSkewSeconds || env.SMS_DELIVERY_CALLBACK_MAX_SKEW_SECONDS || DEFAULT_SMS_CALLBACK_MAX_SKEW_SECONDS) || DEFAULT_SMS_CALLBACK_MAX_SKEW_SECONDS));
  if (Math.abs(nowMs - callbackTimeMs) > maxSkewSeconds * 1000) {
    throw new SmsDeliveryCallbackError("SMS delivery callback timestamp is outside the allowed window", "SMS_CALLBACK_TIMESTAMP_EXPIRED", 401);
  }
  const nonce = safeCallbackText(options.nonce, 160);
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(nonce)) {
    throw new SmsDeliveryCallbackError("SMS delivery callback nonce is invalid", "SMS_CALLBACK_NONCE_INVALID");
  }
  const signature = safeCallbackText(options.signature, 96).replace(/^sha256=/i, "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(signature)) {
    throw new SmsDeliveryCallbackError("SMS delivery callback signature is invalid", "SMS_CALLBACK_SIGNATURE_INVALID", 401);
  }
  const expected = signSmsDeliveryCallback(payload, { secret, timestamp, nonce });
  const signatureBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  if (signatureBuffer.length !== expectedBuffer.length || !timingSafeEqual(signatureBuffer, expectedBuffer)) {
    throw new SmsDeliveryCallbackError("SMS delivery callback signature verification failed", "SMS_CALLBACK_SIGNATURE_MISMATCH", 401);
  }
  const normalizedCallback = normalizeSmsDeliveryCallback(payload);
  if (Date.parse(normalizedCallback.occurredAt) > nowMs + maxSkewSeconds * 1000) {
    throw new SmsDeliveryCallbackError("SMS delivery callback occurredAt is outside the allowed future window", "SMS_CALLBACK_TIME_IN_FUTURE");
  }
  return {
    ...normalizedCallback,
    receivedAt: new Date(nowMs).toISOString(),
    nonceDigest: sha256(nonce),
    signatureVerified: true,
    payloadsExposed: false,
    credentialsPersisted: false
  };
}

function recordSmsDeliveryAcceptance(data, input = {}) {
  if (!data || typeof data !== "object") throw new SmsDeliveryCallbackError("SMS delivery ledger is unavailable", "SMS_DELIVERY_LEDGER_UNAVAILABLE", 503);
  const providerMessageId = safeCallbackText(input.providerMessageId, 200);
  const clientRequestId = safeCallbackText(input.clientRequestId, 160);
  if (!providerMessageId || !clientRequestId) {
    throw new SmsDeliveryCallbackError("SMS acceptance receipt requires provider and client message ids", "SMS_ACCEPTANCE_IDENTITY_REQUIRED");
  }
  const acceptanceStatus = normalizeSmsAcceptanceStatus(input.status);
  if (!SMS_ACCEPTANCE_STATUSES.has(acceptanceStatus)) {
    throw new SmsDeliveryCallbackError("SMS acceptance receipt status is invalid", "SMS_ACCEPTANCE_STATUS_INVALID");
  }
  const receipts = Array.isArray(data.smsDeliveryReceipts) ? data.smsDeliveryReceipts : [];
  const existing = receipts.find((item) => item.providerMessageId === providerMessageId);
  if (existing) {
    if (existing.clientRequestId !== clientRequestId) {
      throw new SmsDeliveryCallbackError("SMS provider message id conflicts with an existing client request", "SMS_ACCEPTANCE_IDENTITY_CONFLICT", 409);
    }
    return existing;
  }
  const acceptedAt = Number.isFinite(Date.parse(input.acceptedAt)) ? new Date(input.acceptedAt).toISOString() : new Date().toISOString();
  const receipt = {
    id: `sms-delivery-${sha256(providerMessageId).slice(0, 20)}`,
    providerMessageId,
    clientRequestId,
    purpose: safeCallbackText(input.purpose || "resident-phone-code", 80),
    maskedPhone: safeCallbackText(input.maskedPhone, 32),
    status: acceptanceStatus,
    acceptedAt,
    latestEventAt: acceptedAt,
    providerCode: safeCallbackText(input.providerCode, 80),
    failureReason: "",
    events: [],
    createdAt: acceptedAt,
    updatedAt: acceptedAt,
    productionEvidence: false
  };
  data.smsDeliveryReceipts = [receipt, ...receipts].slice(0, 500);
  return receipt;
}

function normalizePersistedSmsDeliveryReceipt(item = {}) {
  const providerMessageId = safeCallbackText(item.providerMessageId, 200);
  const clientRequestId = safeCallbackText(item.clientRequestId, 160);
  if (!providerMessageId || !clientRequestId) return null;
  let status = "accepted";
  try { status = normalizeSmsDeliveryStatus(item.status || "accepted"); } catch {}
  const acceptedAt = Number.isFinite(Date.parse(item.acceptedAt)) ? new Date(item.acceptedAt).toISOString() : new Date(0).toISOString();
  const latestEventAt = Number.isFinite(Date.parse(item.latestEventAt)) ? new Date(item.latestEventAt).toISOString() : acceptedAt;
  const updatedAt = Number.isFinite(Date.parse(item.updatedAt)) ? new Date(item.updatedAt).toISOString() : latestEventAt;
  const events = (Array.isArray(item.events) ? item.events : []).slice(0, 20).map((event) => {
    let eventStatus = status;
    try { eventStatus = normalizeSmsDeliveryStatus(event.status || status); } catch {}
    return {
      eventId: safeCallbackText(event.eventId, 160),
      status: eventStatus,
      occurredAt: Number.isFinite(Date.parse(event.occurredAt)) ? new Date(event.occurredAt).toISOString() : latestEventAt,
      receivedAt: Number.isFinite(Date.parse(event.receivedAt)) ? new Date(event.receivedAt).toISOString() : updatedAt,
      providerCode: safeCallbackText(event.providerCode, 80),
      failureReason: safeCallbackText(event.failureReason, 240),
      nonceDigest: /^[a-f0-9]{64}$/.test(String(event.nonceDigest || "")) ? String(event.nonceDigest) : "",
      signatureVerified: event.signatureVerified === true,
      stateApplied: event.stateApplied === true,
      ignoredReason: safeCallbackText(event.ignoredReason, 80)
    };
  }).filter((event) => event.eventId);
  return {
    id: safeCallbackText(item.id || `sms-delivery-${sha256(providerMessageId).slice(0, 20)}`, 200),
    providerMessageId,
    clientRequestId,
    purpose: safeCallbackText(item.purpose || "resident-phone-code", 80),
    maskedPhone: safeCallbackText(item.maskedPhone, 32),
    status,
    acceptedAt,
    latestEventAt,
    providerCode: safeCallbackText(item.providerCode, 80),
    failureReason: safeCallbackText(item.failureReason, 240),
    events,
    createdAt: Number.isFinite(Date.parse(item.createdAt)) ? new Date(item.createdAt).toISOString() : acceptedAt,
    updatedAt,
    productionEvidence: false
  };
}

function applySmsDeliveryCallback(data, verifiedCallback) {
  if (!data || typeof data !== "object") throw new SmsDeliveryCallbackError("SMS delivery ledger is unavailable", "SMS_DELIVERY_LEDGER_UNAVAILABLE", 503);
  const callback = verifiedCallback || {};
  if (!callback.signatureVerified || !callback.nonceDigest) {
    throw new SmsDeliveryCallbackError("SMS delivery callback must be verified before persistence", "SMS_CALLBACK_VERIFICATION_REQUIRED", 401);
  }
  const receipts = Array.isArray(data.smsDeliveryReceipts) ? data.smsDeliveryReceipts : [];
  for (const receipt of receipts) {
    const duplicateEvent = (receipt.events || []).find((item) => item.eventId === callback.eventId);
    if (duplicateEvent) {
      const sameEvent = receipt.providerMessageId === callback.providerMessageId
        && duplicateEvent.status === callback.status
        && duplicateEvent.occurredAt === callback.occurredAt
        && String(duplicateEvent.providerCode || "") === String(callback.providerCode || "")
        && String(duplicateEvent.failureReason || "") === String(callback.failureReason || "");
      if (!sameEvent) {
        throw new SmsDeliveryCallbackError("SMS delivery callback event id conflicts with persisted evidence", "SMS_CALLBACK_EVENT_CONFLICT", 409);
      }
      return { receipt, event: duplicateEvent, idempotentReplay: true };
    }
    if ((receipt.events || []).some((item) => item.nonceDigest === callback.nonceDigest)) {
      throw new SmsDeliveryCallbackError("SMS delivery callback nonce was already used", "SMS_CALLBACK_REPLAY_DETECTED", 409);
    }
  }
  const receipt = receipts.find((item) => item.providerMessageId === callback.providerMessageId);
  if (!receipt) throw new SmsDeliveryCallbackError("SMS delivery callback message was not found", "SMS_DELIVERY_MESSAGE_NOT_FOUND", 404);
  const currentStatus = normalizeSmsDeliveryStatus(receipt.status || "accepted");
  const currentTimeMs = Date.parse(receipt.latestEventAt || receipt.acceptedAt || 0);
  const callbackTimeMs = Date.parse(callback.occurredAt);
  let stateApplied = true;
  let ignoredReason = "";
  if (Number.isFinite(currentTimeMs) && callbackTimeMs < currentTimeMs) {
    stateApplied = false;
    ignoredReason = "out-of-order";
  } else if (SMS_DELIVERY_TERMINAL_STATUSES.has(currentStatus) && callback.status !== currentStatus) {
    stateApplied = false;
    ignoredReason = "terminal-conflict";
  } else if ((SMS_DELIVERY_STATUS_RANK.get(callback.status) || 0) < (SMS_DELIVERY_STATUS_RANK.get(currentStatus) || 0)) {
    stateApplied = false;
    ignoredReason = "status-regression";
  }
  const event = {
    eventId: callback.eventId,
    status: callback.status,
    occurredAt: callback.occurredAt,
    receivedAt: callback.receivedAt,
    providerCode: callback.providerCode,
    failureReason: callback.failureReason,
    nonceDigest: callback.nonceDigest,
    signatureVerified: true,
    stateApplied,
    ignoredReason
  };
  receipt.events = [event, ...(Array.isArray(receipt.events) ? receipt.events : [])].slice(0, 20);
  receipt.updatedAt = callback.receivedAt;
  if (stateApplied) {
    receipt.status = callback.status;
    receipt.latestEventAt = callback.occurredAt;
    receipt.providerCode = callback.providerCode;
    receipt.failureReason = callback.failureReason;
  }
  data.smsDeliveryReceipts = receipts;
  return { receipt, event, idempotentReplay: false };
}

function buildSmsDeliveryCenter(data = {}, env = process.env) {
  const receipts = (Array.isArray(data.smsDeliveryReceipts) ? data.smsDeliveryReceipts : [])
    .map(normalizePersistedSmsDeliveryReceipt)
    .filter(Boolean)
    .sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")));
  const sms = smsAdapterStatus(env);
  const failedStatuses = new Set(["failed", "expired", "undeliverable", "rejected"]);
  return {
    ok: true,
    configured: sms.configured,
    callbackConfigured: sms.callbackConfigured,
    productionReady: false,
    summary: {
      receipts: receipts.length,
      pending: receipts.filter((item) => !SMS_DELIVERY_TERMINAL_STATUSES.has(item.status)).length,
      delivered: receipts.filter((item) => item.status === "delivered").length,
      failed: receipts.filter((item) => failedStatuses.has(item.status)).length,
      callbackEvents: receipts.reduce((sum, item) => sum + (item.events || []).length, 0),
      ignoredEvents: receipts.reduce((sum, item) => sum + (item.events || []).filter((event) => !event.stateApplied).length, 0)
    },
    receipts: receipts.slice(0, 100).map((item) => ({
      ...item,
      events: (item.events || []).map(({ nonceDigest, ...event }) => event)
    })),
    boundary: "Signed callback processing proves the generic delivery ledger. Production readiness still requires provider field mapping, managed callback secrets, network allowlisting, real receipts and site signoff."
  };
}

function createHttpJsonTransport(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const sleepImpl = options.sleepImpl || ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  const logger = options.logger;
  if (typeof fetchImpl !== "function") {
    throw new ProductionAdapterError("HTTP transport is unavailable", "ADAPTER_TRANSPORT_UNAVAILABLE", { statusCode: 503 });
  }
  return Object.freeze({
    async request(url, requestOptions = {}) {
      const timeoutMs = boundedTimeout(requestOptions.timeoutMs);
      const maxAttempts = boundedAttempts(requestOptions.maxAttempts || 1);
      const retryStatuses = new Set(requestOptions.retryStatuses || [408, 425, 429, 500, 502, 503, 504]);
      const fetchOptions = { ...requestOptions };
      delete fetchOptions.maxAttempts;
      delete fetchOptions.retryStatuses;
      delete fetchOptions.timeoutMs;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const controller = new AbortController();
        let timer;
        try {
          const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => {
              controller.abort();
              reject(new ProductionAdapterError("Provider request timed out", "ADAPTER_TIMEOUT", { retryable: true, statusCode: 504 }));
            }, timeoutMs);
          });
          const response = await Promise.race([
            fetchImpl(url, { ...fetchOptions, signal: controller.signal }),
            timeout
          ]);
          clearTimeout(timer);
          const text = await response.text();
          let body = {};
          if (text) {
            try {
              body = JSON.parse(text);
            } catch {
              throw new ProductionAdapterError("Provider returned an invalid JSON response", "ADAPTER_RESPONSE_INVALID");
            }
          }
          if (!response.ok) {
            const retryable = retryStatuses.has(response.status);
            if (retryable && attempt < maxAttempts) {
              safeAdapterLog(logger, "warn", "provider-request-retry", { attempt, status: response.status });
              await sleepImpl(Math.min(1000, 100 * (2 ** (attempt - 1))));
              continue;
            }
            throw new ProductionAdapterError("Provider request was not accepted", "ADAPTER_HTTP_ERROR", {
              retryable,
              statusCode: response.status || 502
            });
          }
          safeAdapterLog(logger, "info", "provider-request-accepted", { attempt, status: response.status });
          return body;
        } catch (error) {
          clearTimeout(timer);
          const normalized = error instanceof ProductionAdapterError
            ? error
            : new ProductionAdapterError("Provider request failed", "ADAPTER_NETWORK_ERROR", { cause: error, retryable: true });
          if (!normalized.retryable || attempt >= maxAttempts) throw normalized;
          safeAdapterLog(logger, "warn", "provider-request-retry", { attempt, reason: normalized.code });
          await sleepImpl(Math.min(1000, 100 * (2 ** (attempt - 1))));
        }
      }
      throw new ProductionAdapterError("Provider request failed", "ADAPTER_RETRY_EXHAUSTED");
    }
  });
}

async function fetchJson(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = globalThis.fetch) {
  return createHttpJsonTransport({ fetchImpl }).request(url, { ...options, timeoutMs, maxAttempts: 1 });
}

function adapterRequestJson(url, requestOptions, options = {}) {
  const transport = options.transport || createHttpJsonTransport({
    fetchImpl: options.fetchImpl,
    sleepImpl: options.sleepImpl,
    logger: options.logger
  });
  return transport.request(url, requestOptions);
}

function transportAsFetch(transport) {
  if (!transport || typeof transport.request !== "function") return null;
  return async (url, options = {}) => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(await transport.request(url, options) ?? {})
  });
}

async function resolveOidcUserInfoEndpoint(env = process.env, fetchImpl = globalThis.fetch) {
  if (env.OIDC_USERINFO_URL) return validatedHttpUrl(env.OIDC_USERINFO_URL, "OIDC_USERINFO_URL", env).toString();
  const discovery = await fetchOidcDiscovery(env, fetchImpl);
  if (!discovery.userinfo_endpoint) throw new Error("OIDC discovery does not expose userinfo_endpoint");
  return validatedHttpUrl(discovery.userinfo_endpoint, "OIDC userinfo_endpoint", env).toString();
}

async function fetchOidcDiscovery(env = process.env, fetchImpl = globalThis.fetch) {
  const issuer = validatedHttpUrl(env.OIDC_ISSUER_URL, "OIDC_ISSUER_URL", env);
  const discoveryUrl = new URL(".well-known/openid-configuration", issuer.toString().endsWith("/") ? issuer : `${issuer}/`);
  const discovery = await fetchJson(discoveryUrl, { headers: { Accept: "application/json" } }, env.IDENTITY_ADAPTER_TIMEOUT_MS, fetchImpl);
  const expectedIssuer = issuer.toString().replace(/\/$/, "");
  const discoveredIssuer = String(discovery.issuer || "").trim().replace(/\/$/, "");
  if (discoveredIssuer && discoveredIssuer !== expectedIssuer) throw new ProductionAdapterError("OIDC discovery issuer mismatch", "OIDC_DISCOVERY_ISSUER_MISMATCH", { statusCode: 401 });
  if (isProduction(env) && !discoveredIssuer) throw new ProductionAdapterError("OIDC discovery issuer is missing", "OIDC_DISCOVERY_ISSUER_MISSING");
  return discovery;
}

async function resolveOidcLifecycleEndpoint(envName, discoveryField, label, env = process.env, fetchImpl = globalThis.fetch) {
  if (env[envName]) return validatedHttpUrl(env[envName], envName, env).toString();
  const discovery = await fetchOidcDiscovery(env, fetchImpl);
  if (!discovery[discoveryField]) throw new Error(`OIDC discovery does not expose ${discoveryField}`);
  return validatedHttpUrl(discovery[discoveryField], label, env).toString();
}

function decodeJwtPart(value, label) {
  try {
    const decoded = Buffer.from(String(value || ""), "base64url").toString("utf8");
    if (!decoded || decoded.length > 16384) throw new Error("invalid size");
    const parsed = JSON.parse(decoded);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid shape");
    return parsed;
  } catch {
    throw new ProductionAdapterError(`OIDC ID token ${label} is invalid`, `OIDC_ID_TOKEN_${label.toUpperCase()}_INVALID`, { statusCode: 401 });
  }
}

function safeStringEqual(left, right) {
  const leftDigest = createHash("sha256").update(String(left || "")).digest();
  const rightDigest = createHash("sha256").update(String(right || "")).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

async function fetchOidcJwks(options = {}) {
  const env = options.env || process.env;
  const discovery = options.discovery || await fetchOidcDiscovery(env, options.fetchImpl);
  if (!discovery.jwks_uri) throw new ProductionAdapterError("OIDC discovery does not expose jwks_uri", "OIDC_JWKS_URI_MISSING");
  const endpoint = validatedHttpUrl(discovery.jwks_uri, "OIDC jwks_uri", env).toString();
  const document = await adapterRequestJson(endpoint, {
    headers: { Accept: "application/json" },
    timeoutMs: identityAdapterStatus(env).timeoutMs,
    maxAttempts: 2
  }, options);
  if (!Array.isArray(document.keys) || document.keys.length === 0 || document.keys.length > 100) {
    throw new ProductionAdapterError("OIDC JWKS document is invalid", "OIDC_JWKS_INVALID");
  }
  return { endpoint, keys: document.keys };
}

async function verifyOidcIdToken(idToken, options = {}) {
  const env = options.env || process.env;
  const parts = String(idToken || "").trim().split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) {
    throw new ProductionAdapterError("OIDC ID token format is invalid", "OIDC_ID_TOKEN_FORMAT_INVALID", { statusCode: 401 });
  }
  const header = decodeJwtPart(parts[0], "header");
  const claims = decodeJwtPart(parts[1], "claims");
  const algorithms = new Set(["RS256", "PS256", "ES256"]);
  if (!algorithms.has(String(header.alg || ""))) {
    throw new ProductionAdapterError("OIDC ID token algorithm is not allowed", "OIDC_ID_TOKEN_ALGORITHM_REJECTED", { statusCode: 401 });
  }
  const kid = String(header.kid || "").trim();
  if (!kid || kid.length > 240) throw new ProductionAdapterError("OIDC ID token key id is missing", "OIDC_ID_TOKEN_KID_MISSING", { statusCode: 401 });
  const jwks = await fetchOidcJwks(options);
  const matchingKeys = jwks.keys.filter((key) => String(key.kid || "") === kid && (!key.alg || key.alg === header.alg) && (!key.use || key.use === "sig"));
  if (matchingKeys.length !== 1) throw new ProductionAdapterError("OIDC signing key is not uniquely available", "OIDC_SIGNING_KEY_UNAVAILABLE", { statusCode: 401 });
  let publicKey;
  try {
    publicKey = createPublicKey({ key: matchingKeys[0], format: "jwk" });
  } catch {
    throw new ProductionAdapterError("OIDC signing key is invalid", "OIDC_SIGNING_KEY_INVALID");
  }
  const keyOptions = header.alg === "PS256"
    ? { key: publicKey, padding: cryptoConstants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }
    : header.alg === "ES256"
      ? { key: publicKey, dsaEncoding: "ieee-p1363" }
      : publicKey;
  let signatureValid = false;
  try {
    signatureValid = verifySignature("sha256", Buffer.from(`${parts[0]}.${parts[1]}`), keyOptions, Buffer.from(parts[2], "base64url"));
  } catch {}
  if (!signatureValid) throw new ProductionAdapterError("OIDC ID token signature is invalid", "OIDC_ID_TOKEN_SIGNATURE_INVALID", { statusCode: 401 });

  const issuer = validatedHttpUrl(env.OIDC_ISSUER_URL, "OIDC_ISSUER_URL", env).toString().replace(/\/$/, "");
  if (!safeStringEqual(String(claims.iss || "").replace(/\/$/, ""), issuer)) {
    throw new ProductionAdapterError("OIDC ID token issuer mismatch", "OIDC_ID_TOKEN_ISSUER_MISMATCH", { statusCode: 401 });
  }
  const clientId = String(env.OIDC_CLIENT_ID || "").trim();
  const audience = Array.isArray(claims.aud) ? claims.aud.map(String) : claims.aud ? [String(claims.aud)] : [];
  if (!clientId || !audience.some((item) => safeStringEqual(item, clientId))) {
    throw new ProductionAdapterError("OIDC ID token audience mismatch", "OIDC_ID_TOKEN_AUDIENCE_MISMATCH", { statusCode: 401 });
  }
  if (audience.length > 1 && !safeStringEqual(claims.azp, clientId)) {
    throw new ProductionAdapterError("OIDC ID token authorized party mismatch", "OIDC_ID_TOKEN_AZP_MISMATCH", { statusCode: 401 });
  }
  if (!String(claims.sub || "").trim()) throw new ProductionAdapterError("OIDC ID token subject is missing", "OIDC_ID_TOKEN_SUBJECT_MISSING", { statusCode: 401 });
  const nowSeconds = Math.floor(Number(options.nowMs ?? Date.now()) / 1000);
  const skew = identityAdapterStatus(env).clockSkewSeconds;
  if (!Number.isFinite(claims.exp) || claims.exp <= nowSeconds - skew) throw new ProductionAdapterError("OIDC ID token has expired", "OIDC_ID_TOKEN_EXPIRED", { statusCode: 401 });
  if (Number.isFinite(claims.nbf) && claims.nbf > nowSeconds + skew) throw new ProductionAdapterError("OIDC ID token is not active", "OIDC_ID_TOKEN_NOT_ACTIVE", { statusCode: 401 });
  if (Number.isFinite(claims.iat) && claims.iat > nowSeconds + skew) throw new ProductionAdapterError("OIDC ID token issued-at time is invalid", "OIDC_ID_TOKEN_IAT_INVALID", { statusCode: 401 });
  if (options.nonce !== undefined && !safeStringEqual(claims.nonce, options.nonce)) {
    throw new ProductionAdapterError("OIDC ID token nonce mismatch", "OIDC_ID_TOKEN_NONCE_MISMATCH", { statusCode: 401 });
  }
  return Object.freeze({
    claims: Object.freeze({ ...claims, iss: issuer }),
    algorithm: header.alg,
    keyId: kid,
    verifiedAt: new Date(nowSeconds * 1000).toISOString(),
    signatureVerified: true,
    credentialsPersisted: false
  });
}

async function fetchOidcUserInfo(accessToken, options = {}) {
  const env = options.env || process.env;
  const token = String(accessToken || "").trim();
  if (!token) throw new Error("OIDC access token is required");
  const status = identityAdapterStatus(env);
  if (!status.configured) throw new Error("OIDC adapter is not configured");
  if (!status.productionHttps) throw new Error("OIDC adapter endpoints must use HTTPS in production");
  const endpoint = await resolveOidcUserInfoEndpoint(env, options.fetchImpl);
  const claims = await fetchJson(endpoint, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`
    }
  }, status.timeoutMs, options.fetchImpl);
  if (!claims.sub && !claims.openid && !claims.uid) throw new Error("OIDC UserInfo response is missing subject claim");
  const expectedIssuer = validatedHttpUrl(env.OIDC_ISSUER_URL, "OIDC_ISSUER_URL", env).toString().replace(/\/$/, "");
  const claimedIssuer = String(claims.iss || "").trim().replace(/\/$/, "");
  if (claimedIssuer && claimedIssuer !== expectedIssuer) throw new ProductionAdapterError("OIDC UserInfo issuer mismatch", "OIDC_USERINFO_ISSUER_MISMATCH", { statusCode: 401 });
  const claimedAudience = Array.isArray(claims.aud) ? claims.aud.map(String) : claims.aud ? [String(claims.aud)] : [];
  if (claimedAudience.length && !claimedAudience.includes(String(env.OIDC_CLIENT_ID))) {
    throw new ProductionAdapterError("OIDC UserInfo audience mismatch", "OIDC_USERINFO_AUDIENCE_MISMATCH", { statusCode: 401 });
  }
  return {
    claims: { ...claims, iss: claimedIssuer || expectedIssuer },
    endpoint,
    fetchedAt: new Date().toISOString(),
    adapter: "oidc-userinfo"
  };
}

function oidcClientAuthorization(env) {
  const clientId = String(env.OIDC_CLIENT_ID || "").trim();
  const clientSecret = String(env.OIDC_CLIENT_SECRET || "").trim();
  if (!clientId || !clientSecret) throw new Error("OIDC client credentials are required");
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64")}`;
}

async function refreshOidcAccessToken(refreshToken, options = {}) {
  const env = options.env || process.env;
  const token = String(refreshToken || "").trim();
  if (!token) throw new Error("OIDC refresh token is required");
  const status = identityAdapterStatus(env);
  if (!status.refreshConfigured) throw new Error("OIDC refresh adapter is not configured");
  if (!status.productionHttps) throw new Error("OIDC adapter endpoints must use HTTPS in production");
  const endpoint = await resolveOidcLifecycleEndpoint("OIDC_TOKEN_URL", "token_endpoint", "OIDC token_endpoint", env, options.fetchImpl);
  const body = await fetchJson(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: oidcClientAuthorization(env),
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: token }).toString()
  }, status.timeoutMs, options.fetchImpl);
  const accessToken = String(body.access_token || "").trim();
  if (!accessToken) throw new Error("OIDC token response is missing access_token");
  const idTokenVerification = body.id_token
    ? await verifyOidcIdToken(body.id_token, {
      env,
      fetchImpl: options.fetchImpl,
      transport: options.transport,
      nonce: options.nonce,
      nowMs: options.nowMs
    })
    : null;
  return {
    accessToken,
    refreshToken: String(body.refresh_token || token).trim(),
    refreshRotated: Boolean(body.refresh_token && body.refresh_token !== token),
    tokenType: String(body.token_type || "Bearer").trim(),
    expiresIn: Math.max(0, Number(body.expires_in || 0) || 0),
    idTokenClaims: idTokenVerification?.claims || null,
    idTokenSignatureVerified: idTokenVerification?.signatureVerified === true,
    refreshedAt: new Date().toISOString(),
    adapter: "oidc-refresh"
  };
}

async function revokeOidcToken(upstreamToken, options = {}) {
  const env = options.env || process.env;
  const token = String(upstreamToken || "").trim();
  if (!token) throw new Error("OIDC token is required for revocation");
  const status = identityAdapterStatus(env);
  if (!status.revocationConfigured) throw new Error("OIDC revocation adapter is not configured");
  if (!status.productionHttps) throw new Error("OIDC adapter endpoints must use HTTPS in production");
  const endpoint = await resolveOidcLifecycleEndpoint("OIDC_REVOCATION_URL", "revocation_endpoint", "OIDC revocation_endpoint", env, options.fetchImpl);
  await fetchJson(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: oidcClientAuthorization(env),
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      token,
      token_type_hint: String(options.tokenTypeHint || "access_token").trim()
    }).toString()
  }, status.timeoutMs, options.fetchImpl);
  return {
    ok: true,
    status: "revoked",
    revokedAt: new Date().toISOString(),
    adapter: "oidc-revocation",
    credentialsPersisted: false
  };
}

function normalizeIdentityDirectoryRecord(record = {}) {
  const enterprise = record["urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"] || {};
  const status = String(record.status || "").trim().toLowerCase();
  return {
    externalSubject: String(record.id || record.externalId || record.sub || "").trim().slice(0, 240),
    username: String(record.userName || record.username || record.preferred_username || "").trim().slice(0, 160),
    displayName: String(record.displayName || record.name?.formatted || "").trim().slice(0, 160),
    orgCode: String(record.orgCode || record.org_code || enterprise.organization || enterprise.department || "").trim().slice(0, 120),
    active: record.active !== false && !["disabled", "inactive", "deleted", "revoked"].includes(status),
    sourceUpdatedAt: String(record.meta?.lastModified || record.updatedAt || "").trim().slice(0, 80)
  };
}

async function fetchIdentityDirectory(options = {}) {
  const env = options.env || process.env;
  const status = identityAdapterStatus(env);
  if (!status.directoryConfigured) throw new Error("identity directory adapter is not configured");
  if (!status.productionHttps) throw new Error("identity directory endpoint must use HTTPS in production");
  const endpoint = validatedHttpUrl(env.IDENTITY_DIRECTORY_URL, "IDENTITY_DIRECTORY_URL", env);
  const startIndex = Math.max(1, Math.floor(Number(options.startIndex || 1) || 1));
  const count = Math.min(200, Math.max(1, Math.floor(Number(options.count || 100) || 100)));
  endpoint.searchParams.set("startIndex", String(startIndex));
  endpoint.searchParams.set("count", String(count));
  const body = await fetchJson(endpoint, {
    headers: {
      Accept: "application/scim+json, application/json",
      Authorization: `Bearer ${String(env.IDENTITY_DIRECTORY_TOKEN).trim()}`
    }
  }, status.timeoutMs, options.fetchImpl);
  const resources = Array.isArray(body.Resources) ? body.Resources : Array.isArray(body.users) ? body.users : [];
  const records = resources.map(normalizeIdentityDirectoryRecord).filter((item) => item.externalSubject || item.username);
  return {
    records,
    totalResults: Math.max(records.length, Number(body.totalResults || body.total || records.length) || records.length),
    startIndex,
    itemsPerPage: records.length,
    fetchedAt: new Date().toISOString(),
    adapter: "scim-directory",
    credentialsPersisted: false
  };
}

function generatePhoneVerificationCode() {
  return String(randomInt(0, 1000000)).padStart(6, "0");
}

function digestPhoneVerificationCode(phone, code, secret) {
  const key = String(secret || "").trim();
  if (!key) throw new Error("verification code digest secret is required");
  return createHmac("sha256", key).update(`${String(phone || "").trim()}:${String(code || "").trim()}`).digest("hex");
}

async function sendSmsVerificationCode(message, options = {}) {
  const env = options.env || process.env;
  const status = smsAdapterStatus(env);
  if (!status.configured) throw new Error("SMS gateway is not configured");
  if (!status.productionHttps) throw new Error("SMS_GATEWAY_URL must use HTTPS in production");
  if (!status.authModeSupported) throw new ProductionAdapterError("SMS gateway authentication mode is unsupported", "SMS_GATEWAY_AUTH_MODE_INVALID", { statusCode: 503 });
  if (isProduction(env) && !status.productionConfigured) throw new ProductionAdapterError("SMS gateway credential is not configured", "SMS_GATEWAY_CREDENTIAL_MISSING", { statusCode: 503 });
  const endpoint = validatedHttpUrl(env.SMS_GATEWAY_URL, "SMS_GATEWAY_URL", env).toString();
  const phone = String(message.phone || "").trim();
  const code = String(message.code || "").trim();
  const clientRequestId = safeCallbackText(message.clientRequestId, 160);
  if (!/^\+?\d{7,15}$/.test(phone)) throw new ProductionAdapterError("SMS recipient is invalid", "SMS_RECIPIENT_INVALID", { statusCode: 400 });
  if (!/^\d{4,10}$/.test(code)) throw new ProductionAdapterError("SMS verification code is invalid", "SMS_CODE_INVALID", { statusCode: 400 });
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(clientRequestId)) {
    throw new ProductionAdapterError("SMS client request id is required", "SMS_IDEMPOTENCY_KEY_REQUIRED", { statusCode: 400 });
  }
  const headers = { Accept: "application/json", "Content-Type": "application/json" };
  if (status.authMode === "bearer") headers.Authorization = `Bearer ${String(env.SMS_GATEWAY_TOKEN).trim()}`;
  headers["Idempotency-Key"] = clientRequestId;
  const body = await adapterRequestJson(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      mobile: phone,
      templateId: env.SMS_TEMPLATE_ID,
      sender: env.SMS_SENDER || "",
      parameters: {
        code,
        expiresInMinutes: Number(message.expiresInMinutes || 5)
      },
      clientRequestId
    }),
    timeoutMs: status.timeoutMs,
    maxAttempts: status.maxAttempts
  }, options);
  const providerMessageId = String(body.providerMessageId || body.messageId || body.requestId || "").trim();
  if (!providerMessageId) throw new ProductionAdapterError("SMS gateway response is missing provider message id", "SMS_PROVIDER_MESSAGE_ID_MISSING");
  const providerStatus = normalizeSmsAcceptanceStatus(body.status);
  if (body.success === false || SMS_REJECTION_STATUSES.has(providerStatus)) {
    throw new ProductionAdapterError("SMS gateway rejected the request", "SMS_GATEWAY_REJECTED");
  }
  if (!SMS_ACCEPTANCE_STATUSES.has(providerStatus)) {
    throw new ProductionAdapterError("SMS gateway receipt status is invalid", "SMS_GATEWAY_RECEIPT_STATUS_INVALID");
  }
  return {
    providerMessageId,
    status: providerStatus,
    acceptedAt: String(body.acceptedAt || new Date().toISOString()),
    providerCode: String(body.code || ""),
    adapter: "http-json"
  };
}

async function probeIdentityAdapterHealth(options = {}) {
  const env = options.env || process.env;
  const status = identityAdapterStatus(env);
  if (!status.configured || !status.productionHttps) {
    throw new ProductionAdapterError("OIDC adapter is not safely configured", "OIDC_ADAPTER_NOT_CONFIGURED", { statusCode: 503 });
  }
  const discovery = await fetchOidcDiscovery(env, options.fetchImpl);
  const required = ["issuer", "jwks_uri", "userinfo_endpoint", "token_endpoint"];
  if (required.some((key) => !String(discovery[key] || "").trim())) {
    throw new ProductionAdapterError("OIDC discovery is incomplete", "OIDC_DISCOVERY_INCOMPLETE");
  }
  return Object.freeze({ ok: true, providerReachable: true, discoveryVerified: true, checkedAt: new Date().toISOString(), credentialsExposed: false });
}

async function probeSmsAdapterHealth(options = {}) {
  const env = options.env || process.env;
  const status = smsAdapterStatus(env);
  if (!status.productionConfigured || !status.productionHttps) {
    throw new ProductionAdapterError("SMS adapter is not safely configured", "SMS_ADAPTER_NOT_CONFIGURED", { statusCode: 503 });
  }
  if (!status.healthEndpointConfigured) {
    return Object.freeze({ ok: true, configurationVerified: true, providerReachable: false, checkedAt: new Date().toISOString(), credentialsExposed: false });
  }
  const endpoint = validatedHttpUrl(env.SMS_GATEWAY_HEALTH_URL, "SMS_GATEWAY_HEALTH_URL", env).toString();
  const headers = { Accept: "application/json" };
  if (status.authMode === "bearer") headers.Authorization = `Bearer ${String(env.SMS_GATEWAY_TOKEN).trim()}`;
  await adapterRequestJson(endpoint, { method: "GET", headers, timeoutMs: status.timeoutMs, maxAttempts: 2 }, options);
  return Object.freeze({ ok: true, configurationVerified: true, providerReachable: true, checkedAt: new Date().toISOString(), credentialsExposed: false });
}

function productionAdapterCenter(env = process.env) {
  const identity = identityAdapterStatus(env);
  const sms = smsAdapterStatus(env);
  const identityLifecycleReady = identity.configured && identity.productionHttps && identity.refreshConfigured && identity.revocationConfigured && identity.directoryConfigured;
  const smsDeliveryCallbackReady = (isProduction(env) ? sms.productionConfigured : sms.configured) && sms.productionHttps && sms.callbackConfigured;
  const adapterReady = identityLifecycleReady && smsDeliveryCallbackReady;
  return {
    generatedAt: new Date().toISOString(),
    production: isProduction(env),
    ready: adapterReady,
    adapterReady,
    productionReady: false,
    identityLifecycleReady,
    smsDeliveryCallbackReady,
    identity,
    sms,
    blockers: [
      ...(!identity.configured ? ["OIDC issuer/client configuration"] : []),
      ...(!identity.productionHttps ? ["OIDC and directory HTTPS endpoints"] : []),
      ...(!identity.refreshConfigured ? ["OIDC token refresh endpoint"] : []),
      ...(!identity.revocationConfigured ? ["OIDC token revocation endpoint"] : []),
      ...(!identity.directoryConfigured ? ["identity directory endpoint and credential"] : []),
      ...(!sms.configured ? ["SMS gateway URL and template"] : []),
      ...(sms.configured && isProduction(env) && !sms.productionConfigured ? ["SMS gateway authentication mode and credential"] : []),
      ...(!sms.productionHttps ? ["SMS gateway HTTPS endpoint"] : []),
      ...(!sms.callbackConfigured ? ["SMS delivery callback signing secret"] : []),
      "real provider joint-test receipts and site signoff"
    ]
  };
}

function createIdentityAdapter(options = {}) {
  const env = options.env || process.env;
  const transport = options.transport;
  const fetchImpl = options.fetchImpl || transportAsFetch(transport) || globalThis.fetch;
  return Object.freeze({
    profile: "platform-adapter-v1",
    status: () => identityAdapterStatus(env),
    userInfo: (accessToken) => fetchOidcUserInfo(accessToken, { env, fetchImpl }),
    verifyIdToken: (idToken, verifyOptions = {}) => verifyOidcIdToken(idToken, { env, fetchImpl, transport, ...verifyOptions }),
    refresh: (refreshToken) => refreshOidcAccessToken(refreshToken, { env, fetchImpl, transport }),
    revoke: (upstreamToken, revokeOptions = {}) => revokeOidcToken(upstreamToken, { env, fetchImpl, ...revokeOptions }),
    directory: (directoryOptions = {}) => fetchIdentityDirectory({ env, fetchImpl, ...directoryOptions }),
    health: () => probeIdentityAdapterHealth({ env, fetchImpl, transport })
  });
}

function createSmsAdapter(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const transport = options.transport;
  return Object.freeze({
    profile: "platform-adapter-v1",
    status: () => smsAdapterStatus(env),
    send: (message) => sendSmsVerificationCode(message, { env, fetchImpl, transport, sleepImpl: options.sleepImpl, logger: options.logger }),
    verifyCallback: (payload, callbackOptions = {}) => verifySmsDeliveryCallback(payload, { env, ...callbackOptions }),
    health: () => probeSmsAdapterHealth({ env, fetchImpl, transport, sleepImpl: options.sleepImpl, logger: options.logger })
  });
}

module.exports = {
  SMS_DELIVERY_STATUSES,
  SMS_DELIVERY_TERMINAL_STATUSES,
  ProductionAdapterError,
  SmsDeliveryCallbackError,
  applySmsDeliveryCallback,
  buildSmsDeliveryCenter,
  createHttpJsonTransport,
  createIdentityAdapter,
  createSmsAdapter,
  digestPhoneVerificationCode,
  fetchIdentityDirectory,
  fetchOidcJwks,
  fetchOidcDiscovery,
  fetchOidcUserInfo,
  generatePhoneVerificationCode,
  identityAdapterStatus,
  normalizeIdentityDirectoryRecord,
  normalizePersistedSmsDeliveryReceipt,
  normalizeSmsDeliveryCallback,
  productionAdapterCenter,
  probeIdentityAdapterHealth,
  probeSmsAdapterHealth,
  recordSmsDeliveryAcceptance,
  refreshOidcAccessToken,
  resolveOidcLifecycleEndpoint,
  resolveOidcUserInfoEndpoint,
  revokeOidcToken,
  sendSmsVerificationCode,
  signSmsDeliveryCallback,
  smsAdapterStatus,
  stableSmsCallbackStringify,
  verifyOidcIdToken,
  verifySmsDeliveryCallback
};
