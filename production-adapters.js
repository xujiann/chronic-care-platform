const { createHash, createHmac, randomInt, timingSafeEqual } = require("node:crypto");

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_SMS_CALLBACK_MAX_SKEW_SECONDS = 300;
const SMS_DELIVERY_STATUSES = new Set(["accepted", "queued", "sent", "delivered", "failed", "expired", "undeliverable", "rejected"]);
const SMS_DELIVERY_TERMINAL_STATUSES = new Set(["delivered", "failed", "expired", "undeliverable", "rejected"]);
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
  return Math.min(30000, Math.max(1000, Number(value || DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS));
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
    boundary: "The adapter verifies UserInfo, refreshes and revokes upstream tokens, and previews directory deactivations. Provisioning, privilege changes and reactivation remain controlled workflows."
  };
}

function smsAdapterStatus(env = process.env) {
  const gatewayUrl = String(env.SMS_GATEWAY_URL || "").trim();
  const callbackMaxSkewSeconds = Math.min(900, Math.max(60, Number(env.SMS_DELIVERY_CALLBACK_MAX_SKEW_SECONDS || DEFAULT_SMS_CALLBACK_MAX_SKEW_SECONDS) || DEFAULT_SMS_CALLBACK_MAX_SKEW_SECONDS));
  return {
    type: "http-json",
    configured: Boolean(gatewayUrl && env.SMS_TEMPLATE_ID),
    gatewayConfigured: Boolean(gatewayUrl),
    templateConfigured: Boolean(env.SMS_TEMPLATE_ID),
    senderConfigured: Boolean(env.SMS_SENDER),
    credentialConfigured: Boolean(env.SMS_GATEWAY_TOKEN),
    callbackConfigured: Boolean(String(env.SMS_DELIVERY_CALLBACK_SECRET || "").trim()),
    callbackMaxSkewSeconds,
    productionHttps: !isProduction(env) || !gatewayUrl || /^https:\/\//i.test(gatewayUrl),
    timeoutMs: boundedTimeout(env.SMS_GATEWAY_TIMEOUT_MS),
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
    status: SMS_DELIVERY_STATUSES.has(String(input.status || "").toLowerCase()) ? String(input.status).toLowerCase() : "accepted",
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

async function fetchJson(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") throw new Error("fetch runtime is unavailable");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), boundedTimeout(timeoutMs));
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let body = {};
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        throw new Error(`adapter returned non-JSON response (${response.status})`);
      }
    }
    if (!response.ok) {
      const detail = body.error_description || body.message || body.error || `HTTP ${response.status}`;
      throw new Error(`adapter request failed: ${detail}`);
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
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
  return fetchJson(discoveryUrl, { headers: { Accept: "application/json" } }, env.IDENTITY_ADAPTER_TIMEOUT_MS, fetchImpl);
}

async function resolveOidcLifecycleEndpoint(envName, discoveryField, label, env = process.env, fetchImpl = globalThis.fetch) {
  if (env[envName]) return validatedHttpUrl(env[envName], envName, env).toString();
  const discovery = await fetchOidcDiscovery(env, fetchImpl);
  if (!discovery[discoveryField]) throw new Error(`OIDC discovery does not expose ${discoveryField}`);
  return validatedHttpUrl(discovery[discoveryField], label, env).toString();
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
  return {
    claims,
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
  return {
    accessToken,
    refreshToken: String(body.refresh_token || token).trim(),
    refreshRotated: Boolean(body.refresh_token && body.refresh_token !== token),
    tokenType: String(body.token_type || "Bearer").trim(),
    expiresIn: Math.max(0, Number(body.expires_in || 0) || 0),
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
  const endpoint = validatedHttpUrl(env.SMS_GATEWAY_URL, "SMS_GATEWAY_URL", env).toString();
  const headers = { Accept: "application/json", "Content-Type": "application/json" };
  if (env.SMS_GATEWAY_TOKEN) headers.Authorization = `Bearer ${env.SMS_GATEWAY_TOKEN}`;
  const body = await fetchJson(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      mobile: String(message.phone || "").trim(),
      templateId: env.SMS_TEMPLATE_ID,
      sender: env.SMS_SENDER || "",
      parameters: {
        code: String(message.code || ""),
        expiresInMinutes: Number(message.expiresInMinutes || 5)
      },
      clientRequestId: message.clientRequestId
    })
  }, status.timeoutMs, options.fetchImpl);
  const providerMessageId = String(body.providerMessageId || body.messageId || body.requestId || "").trim();
  if (!providerMessageId) throw new Error("SMS gateway response is missing provider message id");
  const providerStatus = String(body.status || "accepted").trim().toLowerCase();
  if (body.success === false || ["rejected", "failed", "error", "denied"].includes(providerStatus)) {
    throw new Error(`SMS gateway rejected the request (${providerStatus})`);
  }
  return {
    providerMessageId,
    status: providerStatus,
    acceptedAt: String(body.acceptedAt || new Date().toISOString()),
    providerCode: String(body.code || ""),
    adapter: "http-json"
  };
}

function productionAdapterCenter(env = process.env) {
  const identity = identityAdapterStatus(env);
  const sms = smsAdapterStatus(env);
  const identityLifecycleReady = identity.configured && identity.productionHttps && identity.refreshConfigured && identity.revocationConfigured && identity.directoryConfigured;
  const smsDeliveryCallbackReady = sms.configured && sms.productionHttps && sms.callbackConfigured;
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
      ...(!sms.productionHttps ? ["SMS gateway HTTPS endpoint"] : []),
      ...(!sms.callbackConfigured ? ["SMS delivery callback signing secret"] : []),
      "real provider joint-test receipts and site signoff"
    ]
  };
}

module.exports = {
  SMS_DELIVERY_STATUSES,
  SMS_DELIVERY_TERMINAL_STATUSES,
  SmsDeliveryCallbackError,
  applySmsDeliveryCallback,
  buildSmsDeliveryCenter,
  digestPhoneVerificationCode,
  fetchIdentityDirectory,
  fetchOidcDiscovery,
  fetchOidcUserInfo,
  generatePhoneVerificationCode,
  identityAdapterStatus,
  normalizeIdentityDirectoryRecord,
  normalizePersistedSmsDeliveryReceipt,
  normalizeSmsDeliveryCallback,
  productionAdapterCenter,
  recordSmsDeliveryAcceptance,
  refreshOidcAccessToken,
  resolveOidcLifecycleEndpoint,
  resolveOidcUserInfoEndpoint,
  revokeOidcToken,
  sendSmsVerificationCode,
  signSmsDeliveryCallback,
  smsAdapterStatus,
  stableSmsCallbackStringify,
  verifySmsDeliveryCallback
};
