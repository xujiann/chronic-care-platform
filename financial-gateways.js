const { createHash, createHmac, randomUUID } = require("node:crypto");

const GATEWAY_DEFINITIONS = Object.freeze({
  PAYMENT: {
    endpointEnv: "PAYMENT_GATEWAY_URL",
    secretEnv: "PAYMENT_GATEWAY_SECRET",
    operations: ["create-payment", "query-payment", "refund", "query-refund", "reconcile"]
  },
  INSURANCE: {
    endpointEnv: "INSURANCE_GATEWAY_URL",
    secretEnv: "INSURANCE_GATEWAY_SECRET",
    operations: ["credential-verify", "eligibility-precheck", "settlement", "settlement-cancel", "reconcile"]
  },
  CERTIFICATE: {
    endpointEnv: "CERTIFICATE_GATEWAY_URL",
    secretEnv: "CERTIFICATE_GATEWAY_SECRET",
    operations: ["issue", "revoke", "status-query", "authorization-verify"]
  }
});

const REQUIRED_FIELDS = Object.freeze({
  "PAYMENT:create-payment": ["orderNo", "amountFen", "currency"],
  "PAYMENT:query-payment": ["paymentTradeNo"],
  "PAYMENT:refund": ["paymentTradeNo", "refundAmountFen", "refundReason"],
  "PAYMENT:query-refund": ["refundNo"],
  "PAYMENT:reconcile": ["batchNo", "businessDate"],
  "INSURANCE:credential-verify": ["credentialReference", "institutionCode"],
  "INSURANCE:eligibility-precheck": ["residentId", "serviceCode", "institutionCode"],
  "INSURANCE:settlement": ["claimNo", "residentId", "amountFen", "institutionCode"],
  "INSURANCE:settlement-cancel": ["settlementNo", "reasonCode"],
  "INSURANCE:reconcile": ["batchNo", "businessDate"],
  "CERTIFICATE:issue": ["externalId", "certificateType", "subjectReference", "documentDigest"],
  "CERTIFICATE:revoke": ["certificateNo", "reasonCode"],
  "CERTIFICATE:status-query": ["certificateNo"],
  "CERTIFICATE:authorization-verify": ["authorizationReference", "certificateType"]
});

const FORBIDDEN_PAYLOAD_KEYS = new Set([
  "password", "token", "accessToken", "credentialToken", "idCard", "phone", "certificateContent", "documentBase64", "privateKey", "secret"
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

function normalizeGatewayType(value) {
  const type = String(value || "").trim().toUpperCase();
  if (!GATEWAY_DEFINITIONS[type]) throw new Error(`unsupported financial gateway type: ${value || "missing"}`);
  return type;
}

function gatewayConfiguration(type, env = process.env) {
  const normalizedType = normalizeGatewayType(type);
  const definition = GATEWAY_DEFINITIONS[normalizedType];
  const endpoint = String(env[definition.endpointEnv] || "").trim();
  const secret = String(env[definition.secretEnv] || env.FINANCIAL_GATEWAY_SECRET || "").trim();
  const token = String(env[`${normalizedType}_GATEWAY_TOKEN`] || env.FINANCIAL_GATEWAY_TOKEN || "").trim();
  return {
    type: normalizedType,
    endpointEnv: definition.endpointEnv,
    secretEnv: definition.secretEnv,
    operations: definition.operations,
    configured: Boolean(endpoint && secret),
    endpointConfigured: Boolean(endpoint),
    signingSecretConfigured: Boolean(secret),
    bearerTokenConfigured: Boolean(token),
    productionHttps: !isProduction(env) || !endpoint || /^https:\/\//i.test(endpoint),
    timeoutMs: boundedInteger(env.FINANCIAL_GATEWAY_TIMEOUT_MS, 8000, 1000, 30000),
    maxAttempts: boundedInteger(env.FINANCIAL_GATEWAY_MAX_ATTEMPTS, 3, 1, 5),
    endpoint,
    secret,
    token
  };
}

function publicGatewayStatus(configuration) {
  const { endpoint, secret, token, ...status } = configuration;
  return {
    ...status,
    boundary: "The generic signed gateway is available after configuration. Real institution credentials, field dictionaries, reconciliation and signed acceptance remain external work."
  };
}

function financialGatewayCenter(env = process.env) {
  const gateways = Object.keys(GATEWAY_DEFINITIONS).map((type) => publicGatewayStatus(gatewayConfiguration(type, env)));
  const adapterReady = gateways.every((item) => item.configured && item.productionHttps);
  return {
    generatedAt: new Date().toISOString(),
    production: isProduction(env),
    adapterReady,
    productionReady: false,
    summary: {
      total: gateways.length,
      configured: gateways.filter((item) => item.configured).length,
      operations: gateways.reduce((sum, item) => sum + item.operations.length, 0)
    },
    gateways,
    blockers: [
      ...gateways.filter((item) => !item.configured).map((item) => `${item.type} endpoint and signing secret`),
      ...gateways.filter((item) => !item.productionHttps).map((item) => `${item.type} HTTPS endpoint`),
      "merchant and agency credentials, callback verification, reconciliation, security review and signed joint-test receipts"
    ]
  };
}

function validatePayloadKeys(value, path = "payload") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => validatePayloadKeys(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  Object.entries(value).forEach(([key, item]) => {
    if (FORBIDDEN_PAYLOAD_KEYS.has(key)) throw new Error(`sensitive field is not allowed in financial gateway payload: ${path}.${key}`);
    validatePayloadKeys(item, `${path}.${key}`);
  });
}

function validateFinancialRequest(input) {
  const type = normalizeGatewayType(input.type);
  const operation = String(input.operation || "").trim().toLowerCase();
  const payload = input.payload;
  if (!GATEWAY_DEFINITIONS[type].operations.includes(operation)) throw new Error(`unsupported ${type} gateway operation: ${operation || "missing"}`);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("financial gateway payload must be an object");
  validatePayloadKeys(payload);
  const requiredFields = REQUIRED_FIELDS[`${type}:${operation}`] || [];
  const missingFields = requiredFields.filter((field) => payload[field] === undefined || payload[field] === "");
  if (missingFields.length) {
    const error = new Error(`financial gateway payload is missing required fields: ${missingFields.join(",")}`);
    error.missingFields = missingFields;
    throw error;
  }
  ["amountFen", "refundAmountFen"].forEach((field) => {
    if (payload[field] !== undefined && (!Number.isSafeInteger(Number(payload[field])) || Number(payload[field]) <= 0)) throw new Error(`${field} must be a positive integer in cents`);
  });
  if (payload.documentDigest !== undefined && !/^(sha256:)?[a-f0-9]{64}$/i.test(String(payload.documentDigest))) throw new Error("documentDigest must be a SHA-256 digest");
  return { type, operation, payload, requiredFields };
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

function signFinancialRequest(bodyText, secret, timestamp, requestId) {
  const digest = createHash("sha256").update(bodyText).digest("hex");
  return createHmac("sha256", secret).update(`${timestamp}\n${requestId}\n${digest}`).digest("hex");
}

async function dispatchAttempt(endpoint, request, configuration, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), configuration.timeoutMs);
  try {
    const response = await fetchImpl(endpoint, { ...request, signal: controller.signal });
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > 1024 * 1024) throw new Error("financial gateway response exceeds size limit");
    let body = {};
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        throw new Error(`financial gateway returned non-JSON response (${response.status})`);
      }
    }
    if (!response.ok) {
      const error = new Error(`financial gateway request failed: ${body.message || body.error || `HTTP ${response.status}`}`);
      error.retryable = response.status === 429 || response.status >= 500;
      throw error;
    }
    return body;
  } catch (error) {
    if (error.name === "AbortError") {
      const timeout = new Error(`financial gateway request timed out after ${configuration.timeoutMs}ms`);
      timeout.retryable = true;
      throw timeout;
    }
    if (error.retryable === undefined && error instanceof TypeError) error.retryable = true;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function dispatchFinancialRequest(input, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("fetch runtime is unavailable");
  const validated = validateFinancialRequest(input);
  const configuration = gatewayConfiguration(validated.type, env);
  if (!configuration.configured) throw new Error(`${validated.type} financial gateway is not configured`);
  if (!configuration.productionHttps) throw new Error(`${configuration.endpointEnv} must use HTTPS in production`);
  const idempotencyKey = String(input.idempotencyKey || "").trim();
  if (!idempotencyKey) throw new Error("financial gateway idempotencyKey is required");
  const requestId = String(input.requestId || randomUUID());
  const timestamp = new Date().toISOString();
  const envelope = {
    type: validated.type,
    operation: validated.operation,
    contractId: String(input.contractId || ""),
    idempotencyKey,
    requestId,
    requestedAt: timestamp,
    source: "chronic-care-platform",
    payload: validated.payload
  };
  const bodyText = stableStringify(envelope);
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-Gateway-Type": validated.type,
    "X-Gateway-Operation": validated.operation,
    "X-Idempotency-Key": idempotencyKey,
    "X-Request-Id": requestId,
    "X-Timestamp": timestamp,
    "X-Signature-Algorithm": "HMAC-SHA256",
    "X-Signature": signFinancialRequest(bodyText, configuration.secret, timestamp, requestId)
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
  const receiptId = String(body.receiptId || body.tradeNo || body.settlementNo || body.certificateNo || body.requestId || "").trim();
  const status = String(body.status || "accepted").trim().toLowerCase();
  if (!receiptId) throw new Error("financial gateway response is missing receipt id");
  if (body.success === false || FAILED_STATUSES.has(status)) throw new Error(`financial gateway rejected the request (${status})`);
  return {
    type: validated.type,
    operation: validated.operation,
    contractId: String(input.contractId || ""),
    idempotencyKey,
    requestId,
    receiptId,
    status,
    acceptedAt: String(body.acceptedAt || body.processedAt || new Date().toISOString()),
    providerCode: String(body.code || ""),
    attempts,
    adapter: "financial-http-json-hmac"
  };
}

module.exports = {
  FORBIDDEN_PAYLOAD_KEYS,
  GATEWAY_DEFINITIONS,
  REQUIRED_FIELDS,
  dispatchFinancialRequest,
  financialGatewayCenter,
  gatewayConfiguration,
  signFinancialRequest,
  stableStringify,
  validateFinancialRequest
};
