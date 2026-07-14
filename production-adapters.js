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
  const adapterReady = identityLifecycleReady && sms.configured && sms.productionHttps;
  return {
    generatedAt: new Date().toISOString(),
    production: isProduction(env),
    ready: adapterReady,
    adapterReady,
    productionReady: false,
    identityLifecycleReady,
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
      "real provider joint-test receipts and site signoff"
    ]
  };
}

module.exports = {
  digestPhoneVerificationCode,
  fetchIdentityDirectory,
  fetchOidcDiscovery,
  fetchOidcUserInfo,
  generatePhoneVerificationCode,
  identityAdapterStatus,
  normalizeIdentityDirectoryRecord,
  productionAdapterCenter,
  refreshOidcAccessToken,
  resolveOidcLifecycleEndpoint,
  resolveOidcUserInfoEndpoint,
  revokeOidcToken,
  sendSmsVerificationCode,
  smsAdapterStatus
};
