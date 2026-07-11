const { createHmac, randomInt } = require("node:crypto");

const DEFAULT_TIMEOUT_MS = 8000;

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
  const configured = Boolean(issuer && env.OIDC_CLIENT_ID && env.OIDC_CLIENT_SECRET);
  return {
    type: "oidc-userinfo",
    configured,
    issuerConfigured: Boolean(issuer),
    userInfoConfigured: Boolean(userInfo),
    clientConfigured: Boolean(env.OIDC_CLIENT_ID && env.OIDC_CLIENT_SECRET),
    productionHttps: !isProduction(env) || [issuer, userInfo].filter(Boolean).every((item) => /^https:\/\//i.test(item)),
    timeoutMs: boundedTimeout(env.IDENTITY_ADAPTER_TIMEOUT_MS),
    boundary: "The adapter exchanges an upstream access token for verified UserInfo claims. Account provisioning and organization binding remain controlled workflows."
  };
}

function smsAdapterStatus(env = process.env) {
  const gatewayUrl = String(env.SMS_GATEWAY_URL || "").trim();
  return {
    type: "http-json",
    configured: Boolean(gatewayUrl && env.SMS_TEMPLATE_ID),
    gatewayConfigured: Boolean(gatewayUrl),
    templateConfigured: Boolean(env.SMS_TEMPLATE_ID),
    senderConfigured: Boolean(env.SMS_SENDER),
    credentialConfigured: Boolean(env.SMS_GATEWAY_TOKEN),
    productionHttps: !isProduction(env) || !gatewayUrl || /^https:\/\//i.test(gatewayUrl),
    timeoutMs: boundedTimeout(env.SMS_GATEWAY_TIMEOUT_MS),
    boundary: "A synchronous provider acceptance receipt is recorded. Final delivery callbacks and provider-specific signatures remain site integration work."
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
  const issuer = validatedHttpUrl(env.OIDC_ISSUER_URL, "OIDC_ISSUER_URL", env);
  const discoveryUrl = new URL(".well-known/openid-configuration", issuer.toString().endsWith("/") ? issuer : `${issuer}/`);
  const discovery = await fetchJson(discoveryUrl, { headers: { Accept: "application/json" } }, env.IDENTITY_ADAPTER_TIMEOUT_MS, fetchImpl);
  if (!discovery.userinfo_endpoint) throw new Error("OIDC discovery does not expose userinfo_endpoint");
  return validatedHttpUrl(discovery.userinfo_endpoint, "OIDC userinfo_endpoint", env).toString();
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
  const adapterReady = identity.configured && identity.productionHttps && sms.configured && sms.productionHttps;
  return {
    generatedAt: new Date().toISOString(),
    production: isProduction(env),
    ready: adapterReady,
    adapterReady,
    productionReady: false,
    identity,
    sms,
    blockers: [
      ...(!identity.configured ? ["OIDC issuer/client configuration"] : []),
      ...(!identity.productionHttps ? ["OIDC HTTPS endpoints"] : []),
      ...(!sms.configured ? ["SMS gateway URL and template"] : []),
      ...(!sms.productionHttps ? ["SMS gateway HTTPS endpoint"] : []),
      "real provider joint-test receipts and site signoff"
    ]
  };
}

module.exports = {
  digestPhoneVerificationCode,
  fetchOidcUserInfo,
  generatePhoneVerificationCode,
  identityAdapterStatus,
  productionAdapterCenter,
  resolveOidcUserInfoEndpoint,
  sendSmsVerificationCode,
  smsAdapterStatus
};
