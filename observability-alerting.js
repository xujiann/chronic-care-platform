const { createHash, createHmac, randomUUID } = require("node:crypto");

const ROUTE_DEFINITIONS = Object.freeze({
  SIEM: {
    endpointEnv: "SIEM_ENDPOINT",
    secretEnv: "SIEM_SIGNING_SECRET",
    tokenEnv: "SIEM_TOKEN"
  },
  WEBHOOK: {
    endpointEnv: "ALERT_WEBHOOK_URL",
    secretEnv: "ALERT_WEBHOOK_SECRET",
    tokenEnv: "ALERT_WEBHOOK_TOKEN"
  }
});

const SEVERITIES = new Set(["info", "warning", "critical"]);
const FORBIDDEN_ALERT_KEYS = new Set([
  "residentId", "patientId", "idCard", "phone", "medicalRecord", "diagnosis", "documentBase64", "accessToken", "token", "privateKey", "secret"
]);
const FAILED_STATUSES = new Set(["rejected", "failed", "error", "denied", "invalid"]);

function isProduction(env = process.env) {
  return String(env.NODE_ENV || "").toLowerCase() === "production";
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(parsed)));
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizeRoute(value) {
  const route = String(value || "").trim().toUpperCase();
  if (!ROUTE_DEFINITIONS[route]) throw new Error(`unsupported alert route: ${value || "missing"}`);
  return route;
}

function routeConfiguration(route, env = process.env) {
  const normalizedRoute = normalizeRoute(route);
  const definition = ROUTE_DEFINITIONS[normalizedRoute];
  const endpoint = String(env[definition.endpointEnv] || "").trim();
  const secret = String(env[definition.secretEnv] || env.ALERTING_SIGNING_SECRET || "").trim();
  const token = String(env[definition.tokenEnv] || env.ALERTING_TOKEN || "").trim();
  return {
    route: normalizedRoute,
    endpointEnv: definition.endpointEnv,
    secretEnv: definition.secretEnv,
    configured: Boolean(endpoint && secret),
    endpointConfigured: Boolean(endpoint),
    signingSecretConfigured: Boolean(secret),
    bearerTokenConfigured: Boolean(token),
    productionHttps: !isProduction(env) || !endpoint || /^https:\/\//i.test(endpoint),
    timeoutMs: boundedInteger(env.ALERTING_TIMEOUT_MS, 8000, 1000, 30000),
    maxAttempts: boundedInteger(env.ALERTING_MAX_ATTEMPTS, 3, 1, 5),
    endpoint,
    secret,
    token
  };
}

function publicRouteStatus(configuration) {
  const { endpoint, secret, token, ...status } = configuration;
  return status;
}

function alertRoutingCenter(env = process.env) {
  const routes = Object.keys(ROUTE_DEFINITIONS).map((route) => publicRouteStatus(routeConfiguration(route, env)));
  const configured = routes.filter((item) => item.configured && item.productionHttps);
  return {
    generatedAt: new Date().toISOString(),
    production: isProduction(env),
    adapterReady: configured.length > 0,
    productionReady: false,
    summary: {
      total: routes.length,
      configured: configured.length
    },
    routes,
    blockers: [
      ...(configured.length ? [] : ["at least one SIEM or webhook route with a signing secret"]),
      ...routes.filter((item) => !item.productionHttps).map((item) => `${item.route} HTTPS endpoint`),
      "production receiver ownership, paging policy, escalation rehearsal and signed monitoring acceptance"
    ]
  };
}

function validateKeys(value, path = "alert") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateKeys(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  Object.entries(value).forEach(([key, item]) => {
    if (FORBIDDEN_ALERT_KEYS.has(key)) throw new Error(`sensitive field is not allowed in alert payload: ${path}.${key}`);
    validateKeys(item, `${path}.${key}`);
  });
}

function normalizeStringMap(value, label) {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return Object.fromEntries(Object.entries(value).slice(0, 20).map(([key, item]) => {
    const normalizedKey = String(key || "").trim().slice(0, 80);
    const normalizedValue = String(item ?? "").trim().slice(0, 240);
    if (!normalizedKey) throw new Error(`${label} keys must not be empty`);
    return [normalizedKey, normalizedValue];
  }));
}

function normalizeIdempotencyKey(value, fallback) {
  const key = String(value || fallback || "").trim();
  if (!key) throw new Error("alert idempotencyKey is required");
  if (key.length > 200) throw new Error("alert idempotencyKey must not exceed 200 characters");
  if (/[\u0000-\u001f\u007f]/.test(key)) throw new Error("alert idempotencyKey must not contain control characters");
  return key;
}

function validateAlert(input) {
  const route = normalizeRoute(input.route);
  const alert = input.alert;
  if (!alert || typeof alert !== "object" || Array.isArray(alert)) throw new Error("alert payload must be an object");
  validateKeys(alert);
  const fingerprint = String(alert.fingerprint || "").trim();
  const source = String(alert.source || "").trim();
  const title = String(alert.title || "").trim();
  const summary = String(alert.summary || "").trim();
  const severity = String(alert.severity || "warning").trim().toLowerCase();
  if (!fingerprint) throw new Error("alert fingerprint is required");
  if (!source) throw new Error("alert source is required");
  if (!title) throw new Error("alert title is required");
  if (!summary) throw new Error("alert summary is required");
  if (!SEVERITIES.has(severity)) throw new Error("alert severity must be info, warning or critical");
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey, fingerprint);
  const occurredAt = String(alert.occurredAt || new Date().toISOString());
  if (Number.isNaN(Date.parse(occurredAt))) throw new Error("alert occurredAt must be an ISO date-time");
  const evidenceRefs = Array.isArray(alert.evidenceRefs)
    ? alert.evidenceRefs.slice(0, 20).map((item) => String(item || "").trim().slice(0, 240)).filter(Boolean)
    : [];
  return {
    route,
    idempotencyKey,
    alert: {
      fingerprint: fingerprint.slice(0, 160),
      source: source.slice(0, 120),
      severity,
      title: title.slice(0, 200),
      summary: summary.slice(0, 1000),
      occurredAt: new Date(occurredAt).toISOString(),
      labels: normalizeStringMap(alert.labels, "alert labels"),
      metrics: normalizeStringMap(alert.metrics, "alert metrics"),
      evidenceRefs
    }
  };
}

function validatedEndpoint(value, label, env = process.env) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
  if (!new Set(["http:", "https:"]).has(url.protocol)) throw new Error(`${label} must use HTTP or HTTPS`);
  if (isProduction(env) && url.protocol !== "https:") throw new Error(`${label} must use HTTPS in production`);
  return url.toString();
}

function signAlertRequest(bodyText, secret, timestamp, requestId) {
  const digest = createHash("sha256").update(bodyText).digest("hex");
  return createHmac("sha256", secret).update(`${timestamp}\n${requestId}\n${digest}`).digest("hex");
}

async function dispatchAttempt(endpoint, request, configuration, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), configuration.timeoutMs);
  try {
    const response = await fetchImpl(endpoint, { ...request, signal: controller.signal });
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > 1024 * 1024) throw new Error("alert receiver response exceeds size limit");
    let body = {};
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        throw new Error(`alert receiver returned non-JSON response (${response.status})`);
      }
    }
    if (!response.ok) {
      const error = new Error(`alert delivery failed: ${body.message || body.error || `HTTP ${response.status}`}`);
      error.retryable = response.status === 429 || response.status >= 500;
      throw error;
    }
    return body;
  } catch (error) {
    if (error.name === "AbortError") {
      const timeout = new Error(`alert delivery timed out after ${configuration.timeoutMs}ms`);
      timeout.retryable = true;
      throw timeout;
    }
    if (error.retryable === undefined && error instanceof TypeError) error.retryable = true;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function dispatchAlert(input, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("fetch runtime is unavailable");
  const validated = validateAlert(input);
  const configuration = routeConfiguration(validated.route, env);
  if (!configuration.configured) throw new Error(`${validated.route} alert route is not configured`);
  if (!configuration.productionHttps) throw new Error(`${configuration.endpointEnv} must use HTTPS in production`);
  const idempotencyKey = validated.idempotencyKey;
  const requestId = String(input.requestId || randomUUID());
  const timestamp = new Date().toISOString();
  const envelope = {
    route: validated.route,
    idempotencyKey,
    requestId,
    sentAt: timestamp,
    sourceSystem: "chronic-care-platform",
    alert: validated.alert
  };
  const bodyText = stableStringify(envelope);
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-Alert-Route": validated.route,
    "X-Idempotency-Key": idempotencyKey,
    "X-Request-Id": requestId,
    "X-Timestamp": timestamp,
    "X-Signature-Algorithm": "HMAC-SHA256",
    "X-Signature": signAlertRequest(bodyText, configuration.secret, timestamp, requestId)
  };
  if (configuration.token) headers.Authorization = `Bearer ${configuration.token}`;
  let body;
  let lastError;
  let attempts = 0;
  for (let attempt = 1; attempt <= configuration.maxAttempts; attempt += 1) {
    attempts = attempt;
    try {
      body = await dispatchAttempt(validatedEndpoint(configuration.endpoint, configuration.endpointEnv, env), { method: "POST", headers, body: bodyText }, configuration, fetchImpl);
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      if (!error.retryable || attempt >= configuration.maxAttempts) break;
      const delayMs = options.retryDelayMs === undefined ? Math.min(2000, 200 * (2 ** (attempt - 1))) : Number(options.retryDelayMs || 0);
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  if (lastError) throw lastError;
  const receiptId = String(body.receiptId || body.eventId || body.alertId || body.requestId || "").trim();
  const status = String(body.status || "accepted").trim().toLowerCase();
  if (!receiptId) throw new Error("alert receiver response is missing receipt id");
  if (body.success === false || FAILED_STATUSES.has(status)) throw new Error(`alert receiver rejected the request (${status})`);
  return {
    route: validated.route,
    idempotencyKey,
    requestId,
    receiptId,
    status,
    acceptedAt: String(body.acceptedAt || body.processedAt || new Date().toISOString()),
    attempts,
    adapter: "observability-alert-http-json-hmac"
  };
}

module.exports = {
  FORBIDDEN_ALERT_KEYS,
  ROUTE_DEFINITIONS,
  alertRoutingCenter,
  dispatchAlert,
  normalizeIdempotencyKey,
  routeConfiguration,
  signAlertRequest,
  stableStringify,
  validateAlert
};
