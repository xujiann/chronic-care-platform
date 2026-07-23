const { createHash, createHmac, randomUUID, timingSafeEqual } = require("node:crypto");

const DIRECT_REPORT_CONTRACT_ID = "public-health-direct-report-v1";
const DIRECT_REPORT_REFERENCE_SCHEME = "hmac-sha256:v1";
const MINIMUM_PRODUCTION_SECRET_BYTES = 32;
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_CALLBACK_MAX_SKEW_SECONDS = 300;
const FAILED_RECEIPT_STATUSES = new Set(["rejected", "failed", "error", "denied", "invalid"]);
const CALLBACK_STATUSES = new Set(["accepted", "processing", "succeeded", "failed", "rejected", "cancelled"]);
const FORBIDDEN_PAYLOAD_KEYS = new Set([
  "idcard",
  "identitycard",
  "phone",
  "mobile",
  "name",
  "address",
  "password",
  "token",
  "accesstoken",
  "privatekey",
  "secret"
]);

class DirectReportCallbackError extends Error {
  constructor(message, code, statusCode = 400) {
    super(message);
    this.name = "DirectReportCallbackError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

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

function sha256(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function safeText(value, maximumLength = 200) {
  return String(value || "").trim().replace(/[\r\n]/g, " ").slice(0, maximumLength);
}

function connectorError(message, code, statusCode = 503) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function referenceSecretFrom(options = {}) {
  const env = options.env || process.env;
  const secret = String(options.secret || env.PUBLIC_HEALTH_REFERENCE_SECRET || "").trim();
  if (!secret) throw connectorError(
    "public-health keyed reference secret is not configured",
    "DIRECT_REPORT_REFERENCE_SECRET_NOT_CONFIGURED"
  );
  if (isProduction(env) && Buffer.byteLength(secret, "utf8") < MINIMUM_PRODUCTION_SECRET_BYTES) throw connectorError(
    "public-health keyed reference secret does not meet production quality",
    "DIRECT_REPORT_REFERENCE_SECRET_WEAK"
  );
  return secret;
}

function createKeyedReference(value, purpose, options = {}) {
  const normalizedValue = String(value || "").trim();
  const normalizedPurpose = safeText(purpose, 40).toLowerCase();
  if (!normalizedValue) throw connectorError("public-health keyed reference source is missing", "DIRECT_REPORT_REFERENCE_SOURCE_MISSING", 422);
  if (!["subject", "specimen"].includes(normalizedPurpose)) throw connectorError(
    "public-health keyed reference purpose is unsupported",
    "DIRECT_REPORT_REFERENCE_PURPOSE_INVALID",
    422
  );
  const secret = referenceSecretFrom(options);
  const digest = createHmac("sha256", secret)
    .update(`${DIRECT_REPORT_REFERENCE_SCHEME}\n${normalizedPurpose}\n${normalizedValue}`)
    .digest("hex");
  return `${DIRECT_REPORT_REFERENCE_SCHEME}:${digest}`;
}

function directReportConfiguration(env = process.env) {
  const endpoint = String(env.PUBLIC_HEALTH_DIRECT_REPORT_URL || "").trim();
  const secret = String(env.PUBLIC_HEALTH_DIRECT_REPORT_SECRET || "").trim();
  const referenceSecret = String(env.PUBLIC_HEALTH_REFERENCE_SECRET || "").trim();
  const callbackSecret = String(env.PUBLIC_HEALTH_DIRECT_REPORT_CALLBACK_SECRET || "").trim();
  const token = String(env.PUBLIC_HEALTH_DIRECT_REPORT_TOKEN || "").trim();
  return {
    endpointEnv: "PUBLIC_HEALTH_DIRECT_REPORT_URL",
    secretEnv: "PUBLIC_HEALTH_DIRECT_REPORT_SECRET",
    referenceSecretEnv: "PUBLIC_HEALTH_REFERENCE_SECRET",
    callbackSecretEnv: "PUBLIC_HEALTH_DIRECT_REPORT_CALLBACK_SECRET",
    configured: Boolean(endpoint && secret && referenceSecret),
    transportConfigured: Boolean(endpoint && secret),
    endpointConfigured: Boolean(endpoint),
    signingSecretConfigured: Boolean(secret),
    signingSecretProductionQuality: !isProduction(env) || Buffer.byteLength(secret, "utf8") >= MINIMUM_PRODUCTION_SECRET_BYTES,
    referenceSecretConfigured: Boolean(referenceSecret),
    referenceSecretProductionQuality: !isProduction(env) || Buffer.byteLength(referenceSecret, "utf8") >= MINIMUM_PRODUCTION_SECRET_BYTES,
    callbackConfigured: Boolean(callbackSecret),
    callbackSecretProductionQuality: !isProduction(env) || Buffer.byteLength(callbackSecret, "utf8") >= MINIMUM_PRODUCTION_SECRET_BYTES,
    bearerTokenConfigured: Boolean(token),
    productionHttps: !isProduction(env) || !endpoint || /^https:\/\//i.test(endpoint),
    timeoutMs: boundedInteger(env.PUBLIC_HEALTH_DIRECT_REPORT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 1000, 30000),
    maxAttempts: boundedInteger(env.PUBLIC_HEALTH_DIRECT_REPORT_MAX_ATTEMPTS, DEFAULT_MAX_ATTEMPTS, 1, 5),
    callbackMaxSkewSeconds: boundedInteger(
      env.PUBLIC_HEALTH_DIRECT_REPORT_CALLBACK_MAX_SKEW_SECONDS,
      DEFAULT_CALLBACK_MAX_SKEW_SECONDS,
      60,
      900
    ),
    endpoint,
    secret,
    referenceSecret,
    callbackSecret,
    token
  };
}

function publicDirectReportStatus(configuration) {
  const { endpoint, secret, referenceSecret, callbackSecret, token, ...status } = configuration;
  return {
    ...status,
    contractId: DIRECT_REPORT_CONTRACT_ID,
    productionReady: false,
    boundary: "The signed direct-report adapter is code-ready. The official field version, network access, agency credentials and signed joint-test receipt remain site acceptance work."
  };
}

function directReportConnectorCenter(env = process.env) {
  const configuration = directReportConfiguration(env);
  return {
    generatedAt: new Date().toISOString(),
    production: isProduction(env),
    adapterReady: configuration.configured
      && configuration.productionHttps
      && configuration.signingSecretProductionQuality
      && configuration.referenceSecretProductionQuality,
    callbackReady: configuration.callbackConfigured && configuration.callbackSecretProductionQuality,
    productionReady: false,
    connector: publicDirectReportStatus(configuration),
    blockers: [
      ...(!configuration.transportConfigured ? ["direct-report endpoint and signing secret"] : []),
      ...(!configuration.productionHttps ? ["HTTPS direct-report endpoint"] : []),
      ...(!configuration.signingSecretProductionQuality ? ["production-quality direct-report signing secret"] : []),
      ...(!configuration.referenceSecretConfigured ? ["keyed pseudonym reference secret"] : []),
      ...(!configuration.referenceSecretProductionQuality ? ["production-quality keyed pseudonym reference secret"] : []),
      ...(!configuration.callbackConfigured ? ["direct-report callback signing secret"] : []),
      ...(!configuration.callbackSecretProductionQuality ? ["production-quality callback signing secret"] : []),
      "official field dictionary, VPN or allowlist, agency credentials and signed joint-test receipt"
    ]
  };
}

function forbiddenPayloadPaths(value, prefix = "payload") {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap((item, index) => forbiddenPayloadPaths(item, `${prefix}[${index}]`));
  return Object.entries(value).flatMap(([key, item]) => {
    const normalizedKey = key.replace(/[_-]/g, "").toLowerCase();
    const currentPath = `${prefix}.${key}`;
    return [
      ...(FORBIDDEN_PAYLOAD_KEYS.has(normalizedKey) ? [currentPath] : []),
      ...forbiddenPayloadPaths(item, currentPath)
    ];
  });
}

function validateDirectReportPayload(payload, options = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    const error = new Error("direct-report payload must be an object");
    error.code = "DIRECT_REPORT_PAYLOAD_INVALID";
    throw error;
  }
  const requiredFields = [
    "externalId",
    "subjectReference",
    "institutionCode",
    "reportType",
    "diseaseCode",
    "testCode",
    "resultFlag",
    "occurredAt",
    "reportedAt"
  ];
  const missingFields = requiredFields.filter((field) => payload[field] === undefined || payload[field] === null || payload[field] === "");
  if (missingFields.length) {
    const error = new Error(`direct-report payload is missing required fields: ${missingFields.join(", ")}`);
    error.code = "DIRECT_REPORT_REQUIRED_FIELDS_MISSING";
    error.missingFields = missingFields;
    throw error;
  }
  const invalidDateFields = ["occurredAt", "reportedAt"].filter((field) => !Number.isFinite(Date.parse(payload[field])));
  if (invalidDateFields.length) {
    const error = new Error(`direct-report payload has invalid date fields: ${invalidDateFields.join(", ")}`);
    error.code = "DIRECT_REPORT_DATE_INVALID";
    throw error;
  }
  const occurredAtMs = Date.parse(payload.occurredAt);
  const reportedAtMs = Date.parse(payload.reportedAt);
  if (occurredAtMs > reportedAtMs) {
    const error = new Error("direct-report occurredAt cannot be later than reportedAt");
    error.code = "DIRECT_REPORT_TIME_ORDER_INVALID";
    throw error;
  }
  const nowMs = Number(options.nowMs ?? Date.now());
  const maximumFutureSkewMs = Number(options.maximumFutureSkewMs ?? 5 * 60 * 1000);
  if (Number.isFinite(nowMs) && reportedAtMs > nowMs + maximumFutureSkewMs) {
    const error = new Error("direct-report reportedAt is outside the allowed future window");
    error.code = "DIRECT_REPORT_TIME_IN_FUTURE";
    throw error;
  }
  if (!/^hmac-sha256:v1:[a-f0-9]{64}$/i.test(String(payload.subjectReference || ""))) {
    const error = new Error("direct-report subjectReference must use the hmac-sha256:v1 keyed reference scheme");
    error.code = "DIRECT_REPORT_SUBJECT_REFERENCE_INVALID";
    throw error;
  }
  if (payload.specimenReference && !/^hmac-sha256:v1:[a-f0-9]{64}$/i.test(String(payload.specimenReference))) {
    const error = new Error("direct-report specimenReference must use the hmac-sha256:v1 keyed reference scheme");
    error.code = "DIRECT_REPORT_SPECIMEN_REFERENCE_INVALID";
    throw error;
  }
  if (Buffer.byteLength(stableStringify(payload), "utf8") > 64 * 1024) {
    const error = new Error("direct-report payload exceeds size limit");
    error.code = "DIRECT_REPORT_PAYLOAD_TOO_LARGE";
    throw error;
  }
  const forbiddenFields = forbiddenPayloadPaths(payload);
  if (forbiddenFields.length) {
    const error = new Error(`direct-report payload contains forbidden sensitive fields: ${forbiddenFields.join(", ")}`);
    error.code = "DIRECT_REPORT_SENSITIVE_FIELD";
    error.forbiddenFields = forbiddenFields;
    throw error;
  }
  return { ...payload };
}

function signDirectReportRequest(bodyText, secret, timestamp, requestId) {
  const digest = sha256(bodyText);
  return createHmac("sha256", secret).update(`${timestamp}\n${requestId}\n${digest}`).digest("hex");
}

async function readJsonResponse(response, maximumBytes = 1024 * 1024) {
  const responseText = await response.text();
  if (Buffer.byteLength(responseText, "utf8") > maximumBytes) throw new Error("direct-report response exceeds size limit");
  if (!responseText) return {};
  try {
    return JSON.parse(responseText);
  } catch {
    throw new Error(`direct-report endpoint returned non-JSON response (${response.status})`);
  }
}

async function dispatchAttempt(endpoint, request, configuration, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), configuration.timeoutMs);
  try {
    const response = await fetchImpl(endpoint, { ...request, signal: controller.signal });
    const body = await readJsonResponse(response);
    if (!response.ok) {
      const error = new Error(`direct-report request failed: ${body.message || body.error || `HTTP ${response.status}`}`);
      error.retryable = response.status === 429 || response.status >= 500;
      throw error;
    }
    return body;
  } catch (error) {
    if (error.name === "AbortError") {
      const timeoutError = new Error(`direct-report request timed out after ${configuration.timeoutMs}ms`);
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

async function dispatchPublicHealthDirectReport(input, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("fetch runtime is unavailable");
  const configuration = directReportConfiguration(env);
  if (!configuration.transportConfigured) throw new Error("public-health direct-report connector is not configured");
  if (!configuration.productionHttps) throw new Error("PUBLIC_HEALTH_DIRECT_REPORT_URL must use HTTPS in production");
  if (!configuration.signingSecretProductionQuality) throw new Error("public-health direct-report signing secret does not meet production quality");
  if (!configuration.referenceSecretConfigured) throw connectorError(
    "public-health keyed reference secret is not configured",
    "DIRECT_REPORT_REFERENCE_SECRET_NOT_CONFIGURED"
  );
  if (!configuration.referenceSecretProductionQuality) throw connectorError(
    "public-health keyed reference secret does not meet production quality",
    "DIRECT_REPORT_REFERENCE_SECRET_WEAK"
  );

  const contractId = safeText(input.contractId || DIRECT_REPORT_CONTRACT_ID, 120);
  const idempotencyKey = safeText(input.idempotencyKey, 200);
  if (contractId !== DIRECT_REPORT_CONTRACT_ID) throw new Error(`unsupported direct-report contract: ${contractId || "missing"}`);
  if (!idempotencyKey) throw new Error("direct-report idempotencyKey is required");
  const payload = validateDirectReportPayload(input.payload, options);
  const requestId = safeText(input.requestId || randomUUID(), 160);
  const timestamp = new Date(options.nowMs ?? Date.now()).toISOString();
  const envelope = {
    contractId,
    idempotencyKey,
    requestId,
    sentAt: timestamp,
    source: "regional-health-platform",
    payload
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
    "X-Signature": signDirectReportRequest(bodyText, configuration.secret, timestamp, requestId)
  };
  if (configuration.token) headers.Authorization = `Bearer ${configuration.token}`;

  let body;
  let lastError;
  let attempts = 0;
  for (let attempt = 1; attempt <= configuration.maxAttempts; attempt += 1) {
    attempts = attempt;
    try {
      body = await dispatchAttempt(configuration.endpoint, { method: "POST", headers, body: bodyText }, configuration, fetchImpl);
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

  const receiptId = safeText(body.receiptId || body.messageId || body.requestId, 200);
  const receiptStatus = safeText(body.status || "accepted", 40).toLowerCase();
  if (!receiptId) throw new Error("direct-report response is missing receipt id");
  if (body.success === false || FAILED_RECEIPT_STATUSES.has(receiptStatus)) throw new Error(`direct-report endpoint rejected the request (${receiptStatus})`);
  return {
    contractId,
    idempotencyKey,
    requestId,
    receiptId,
    status: receiptStatus,
    acceptedAt: safeText(body.acceptedAt || timestamp, 80),
    providerCode: safeText(body.code, 80),
    attempts,
    adapter: "public-health-direct-report-http-json-hmac"
  };
}

function callbackSigningInput(payload, timestamp, nonce) {
  return `${timestamp}\n${nonce}\n${sha256(stableStringify(payload))}`;
}

function signDirectReportCallback(payload, options = {}) {
  const secret = String(options.secret || "").trim();
  const timestamp = String(options.timestamp || "").trim();
  const nonce = safeText(options.nonce, 160);
  if (!secret || !timestamp || !nonce) throw new DirectReportCallbackError("direct-report callback signing requires secret, timestamp and nonce", "DIRECT_REPORT_CALLBACK_SIGNING_INPUT_REQUIRED");
  return createHmac("sha256", secret).update(callbackSigningInput(payload, timestamp, nonce)).digest("hex");
}

function verifyDirectReportCallback(payload, options = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new DirectReportCallbackError("direct-report callback body must be an object", "DIRECT_REPORT_CALLBACK_BODY_INVALID");
  }
  const env = options.env || process.env;
  const configuration = directReportConfiguration(env);
  if (!configuration.callbackSecret) throw new DirectReportCallbackError("direct-report callback secret is not configured", "DIRECT_REPORT_CALLBACK_NOT_CONFIGURED", 503);
  if (!configuration.callbackSecretProductionQuality) throw new DirectReportCallbackError("direct-report callback secret does not meet production quality", "DIRECT_REPORT_CALLBACK_SECRET_WEAK", 503);

  const timestamp = String(options.timestamp || "").trim();
  const timestampNumber = Number(timestamp);
  if (!/^\d{10,13}$/.test(timestamp) || !Number.isFinite(timestampNumber)) throw new DirectReportCallbackError("direct-report callback timestamp is invalid", "DIRECT_REPORT_CALLBACK_TIMESTAMP_INVALID");
  const callbackTimeMs = timestamp.length === 13 ? timestampNumber : timestampNumber * 1000;
  const nowMs = Number(options.nowMs ?? Date.now());
  if (Math.abs(nowMs - callbackTimeMs) > configuration.callbackMaxSkewSeconds * 1000) throw new DirectReportCallbackError("direct-report callback timestamp is outside the allowed window", "DIRECT_REPORT_CALLBACK_TIMESTAMP_EXPIRED", 401);
  const nonce = safeText(options.nonce, 160);
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(nonce)) throw new DirectReportCallbackError("direct-report callback nonce is invalid", "DIRECT_REPORT_CALLBACK_NONCE_INVALID");
  const signature = safeText(options.signature, 96).replace(/^sha256=/i, "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(signature)) throw new DirectReportCallbackError("direct-report callback signature is invalid", "DIRECT_REPORT_CALLBACK_SIGNATURE_INVALID", 401);
  const expected = signDirectReportCallback(payload, { secret: configuration.callbackSecret, timestamp, nonce });
  const actualBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) throw new DirectReportCallbackError("direct-report callback signature verification failed", "DIRECT_REPORT_CALLBACK_SIGNATURE_MISMATCH", 401);

  const eventId = safeText(payload.eventId, 160);
  const receiptId = safeText(payload.receiptId, 200);
  const status = safeText(payload.status, 40).toLowerCase();
  const occurredAt = safeText(payload.occurredAt, 80);
  if (!eventId || !receiptId) throw new DirectReportCallbackError("direct-report callback requires eventId and receiptId", "DIRECT_REPORT_CALLBACK_IDENTITY_REQUIRED");
  if (!CALLBACK_STATUSES.has(status)) throw new DirectReportCallbackError("direct-report callback status is unsupported", "DIRECT_REPORT_CALLBACK_STATUS_INVALID");
  if (!occurredAt || !Number.isFinite(Date.parse(occurredAt))) throw new DirectReportCallbackError("direct-report callback occurredAt is invalid", "DIRECT_REPORT_CALLBACK_TIME_INVALID");
  if (Date.parse(occurredAt) > nowMs + configuration.callbackMaxSkewSeconds * 1000) throw new DirectReportCallbackError("direct-report callback occurredAt is outside the allowed future window", "DIRECT_REPORT_CALLBACK_TIME_IN_FUTURE");
  return {
    eventId,
    receiptId,
    status,
    occurredAt: new Date(occurredAt).toISOString(),
    providerCode: safeText(payload.providerCode || payload.code, 80),
    failureReason: safeText(payload.failureReason || payload.reason, 240),
    receivedAt: new Date(nowMs).toISOString(),
    nonceDigest: sha256(nonce),
    signatureVerified: true,
    payloadsExposed: false,
    credentialsPersisted: false
  };
}

module.exports = {
  DIRECT_REPORT_CONTRACT_ID,
  DIRECT_REPORT_REFERENCE_SCHEME,
  DirectReportCallbackError,
  createKeyedReference,
  directReportConfiguration,
  directReportConnectorCenter,
  dispatchPublicHealthDirectReport,
  forbiddenPayloadPaths,
  sha256,
  signDirectReportCallback,
  signDirectReportRequest,
  stableStringify,
  validateDirectReportPayload,
  verifyDirectReportCallback
};
