const { createHash, createHmac, randomUUID } = require("node:crypto");

const CONNECTOR_DEFINITIONS = Object.freeze({
  HIS: { endpointEnv: "HIS_ADAPTER_URL", secretEnv: "HIS_ADAPTER_SECRET" },
  EMR: { endpointEnv: "EMR_ADAPTER_URL", secretEnv: "EMR_ADAPTER_SECRET" },
  LIS: { endpointEnv: "LIS_ADAPTER_URL", secretEnv: "LIS_ADAPTER_SECRET" },
  PACS: { endpointEnv: "PACS_ADAPTER_URL", secretEnv: "PACS_ADAPTER_SECRET" },
  APPOINTMENT: { endpointEnv: "APPOINTMENT_ADAPTER_URL", secretEnv: "APPOINTMENT_ADAPTER_SECRET" }
});

const FAILED_RECEIPT_STATUSES = new Set(["rejected", "failed", "error", "denied", "invalid"]);
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_ATTEMPTS = 3;

function isProduction(env = process.env) {
  return String(env.NODE_ENV || "").toLowerCase() === "production";
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(parsed)));
}

function normalizeDomain(domain) {
  const normalized = String(domain || "").trim().toUpperCase();
  if (normalized === "APPOINTMENT" || normalized === "号源") return "APPOINTMENT";
  if (!CONNECTOR_DEFINITIONS[normalized]) throw new Error(`unsupported hospital connector domain: ${domain || "missing"}`);
  return normalized;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function validatedEndpoint(value, label, env = process.env) {
  let endpoint;
  try {
    endpoint = new URL(String(value || ""));
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
  if (!new Set(["http:", "https:"]).has(endpoint.protocol)) throw new Error(`${label} must use HTTP or HTTPS`);
  if (isProduction(env) && endpoint.protocol !== "https:") throw new Error(`${label} must use HTTPS in production`);
  return endpoint.toString();
}

function connectorConfiguration(domain, env = process.env) {
  const normalizedDomain = normalizeDomain(domain);
  const definition = CONNECTOR_DEFINITIONS[normalizedDomain];
  const endpointValue = String(env[definition.endpointEnv] || "").trim();
  const secretValue = String(env[definition.secretEnv] || env.HOSPITAL_ADAPTER_SECRET || "").trim();
  const tokenValue = String(env[`${normalizedDomain}_ADAPTER_TOKEN`] || env.HOSPITAL_ADAPTER_TOKEN || "").trim();
  const endpointHttps = !endpointValue || /^https:\/\//i.test(endpointValue);
  return {
    domain: normalizedDomain,
    endpointEnv: definition.endpointEnv,
    secretEnv: definition.secretEnv,
    configured: Boolean(endpointValue && secretValue),
    endpointConfigured: Boolean(endpointValue),
    signingSecretConfigured: Boolean(secretValue),
    bearerTokenConfigured: Boolean(tokenValue),
    productionHttps: !isProduction(env) || endpointHttps,
    timeoutMs: boundedInteger(env.HOSPITAL_ADAPTER_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 1000, 30000),
    maxAttempts: boundedInteger(env.HOSPITAL_ADAPTER_MAX_ATTEMPTS, DEFAULT_MAX_ATTEMPTS, 1, 5),
    endpointValue,
    secretValue,
    tokenValue
  };
}

function publicConnectorStatus(configuration) {
  const { endpointValue, secretValue, tokenValue, ...status } = configuration;
  return {
    ...status,
    boundary: "Runtime dispatch is available after endpoint and signing-secret configuration. Vendor mappings, network allowlists and signed joint-test receipts remain site work."
  };
}

function hospitalConnectorCenter(env = process.env) {
  const connectors = Object.keys(CONNECTOR_DEFINITIONS).map((domain) => publicConnectorStatus(connectorConfiguration(domain, env)));
  const adapterReady = connectors.every((item) => item.configured && item.productionHttps);
  return {
    generatedAt: new Date().toISOString(),
    production: isProduction(env),
    adapterReady,
    productionReady: false,
    summary: {
      total: connectors.length,
      configured: connectors.filter((item) => item.configured).length,
      httpsReady: connectors.filter((item) => item.productionHttps).length
    },
    connectors,
    blockers: [
      ...connectors.filter((item) => !item.configured).map((item) => `${item.domain} endpoint and signing secret`),
      ...connectors.filter((item) => !item.productionHttps).map((item) => `${item.domain} HTTPS endpoint`),
      "vendor field mappings, network allowlists, callback verification and signed site joint-test receipts"
    ]
  };
}

function signHospitalRequest(bodyText, secret, timestamp, requestId) {
  const digest = createHash("sha256").update(bodyText).digest("hex");
  return createHmac("sha256", secret).update(`${timestamp}\n${requestId}\n${digest}`).digest("hex");
}

async function readJsonResponse(response, maximumBytes = 1024 * 1024) {
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > maximumBytes) throw new Error("hospital connector response exceeds size limit");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`hospital connector returned non-JSON response (${response.status})`);
  }
}

async function dispatchAttempt(endpoint, request, configuration, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), configuration.timeoutMs);
  try {
    const response = await fetchImpl(endpoint, { ...request, signal: controller.signal });
    const body = await readJsonResponse(response);
    if (!response.ok) {
      const error = new Error(`hospital connector request failed: ${body.message || body.error || `HTTP ${response.status}`}`);
      error.retryable = response.status === 429 || response.status >= 500;
      throw error;
    }
    return body;
  } catch (error) {
    if (error.name === "AbortError") {
      const timeoutError = new Error(`hospital connector request timed out after ${configuration.timeoutMs}ms`);
      timeoutError.retryable = true;
      throw timeoutError;
    }
    if (error.retryable === undefined && error instanceof TypeError) error.retryable = true;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function dispatchHospitalRequest(input, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("fetch runtime is unavailable");
  const domain = normalizeDomain(input.domain);
  const configuration = connectorConfiguration(domain, env);
  if (!configuration.configured) throw new Error(`${domain} hospital connector is not configured`);
  if (!configuration.productionHttps) throw new Error(`${configuration.endpointEnv} must use HTTPS in production`);

  const contractId = String(input.contractId || "").trim();
  const idempotencyKey = String(input.idempotencyKey || "").trim();
  if (!contractId) throw new Error("hospital connector contractId is required");
  if (!idempotencyKey) throw new Error("hospital connector idempotencyKey is required");
  if (!input.payload || typeof input.payload !== "object" || Array.isArray(input.payload)) throw new Error("hospital connector payload must be an object");

  const requestId = String(input.requestId || randomUUID());
  const timestamp = new Date().toISOString();
  const envelope = {
    contractId,
    domain,
    idempotencyKey,
    requestId,
    sentAt: timestamp,
    source: "chronic-care-platform",
    payload: input.payload
  };
  const bodyText = stableStringify(envelope);
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-Platform-Contract": contractId,
    "X-Idempotency-Key": idempotencyKey,
    "X-Request-Id": requestId,
    "X-Timestamp": timestamp,
    "X-Signature-Algorithm": "HMAC-SHA256",
    "X-Signature": signHospitalRequest(bodyText, configuration.secretValue, timestamp, requestId)
  };
  if (configuration.tokenValue) headers.Authorization = `Bearer ${configuration.tokenValue}`;

  let body;
  let lastError;
  let attempts = 0;
  for (let attempt = 1; attempt <= configuration.maxAttempts; attempt += 1) {
    attempts = attempt;
    try {
      body = await dispatchAttempt(configuration.endpointValue, { method: "POST", headers, body: bodyText }, configuration, fetchImpl);
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      if (!error.retryable || attempt >= configuration.maxAttempts) break;
      const delayMs = options.retryDelayMs === undefined ? Math.min(2000, 200 * (2 ** (attempt - 1))) : Number(options.retryDelayMs || 0);
      if (delayMs > 0) await wait(delayMs);
    }
  }
  if (lastError) throw lastError;

  const receiptId = String(body.receiptId || body.messageId || body.requestId || "").trim();
  const receiptStatus = String(body.status || "accepted").trim().toLowerCase();
  if (!receiptId) throw new Error("hospital connector response is missing receipt id");
  if (body.success === false || FAILED_RECEIPT_STATUSES.has(receiptStatus)) throw new Error(`hospital connector rejected the request (${receiptStatus})`);
  return {
    domain,
    contractId,
    idempotencyKey,
    requestId,
    receiptId,
    status: receiptStatus,
    acceptedAt: String(body.acceptedAt || new Date().toISOString()),
    providerCode: String(body.code || ""),
    attempts,
    adapter: "hospital-http-json-hmac"
  };
}

module.exports = {
  CONNECTOR_DEFINITIONS,
  connectorConfiguration,
  dispatchHospitalRequest,
  hospitalConnectorCenter,
  normalizeDomain,
  signHospitalRequest,
  stableStringify
};
