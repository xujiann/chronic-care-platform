const { createHash, createHmac, randomUUID, timingSafeEqual } = require("node:crypto");
const OnlinePaymentRefunds = require("./online-payment-refunds");

const DEFAULT_FINANCIAL_CALLBACK_MAX_SKEW_SECONDS = 300;
const FINANCIAL_CALLBACK_STATUSES = new Set(["accepted", "processing", "succeeded", "failed", "cancelled", "reversed"]);
const FINANCIAL_CALLBACK_TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled", "reversed"]);
const FINANCIAL_CALLBACK_STATUS_RANK = new Map([
  ["accepted", 0],
  ["processing", 1],
  ["succeeded", 2],
  ["failed", 2],
  ["cancelled", 2],
  ["reversed", 3]
]);
const RECONCILIABLE_OPERATIONS = new Map([
  ["PAYMENT", new Set(["create-payment", "refund"])],
  ["INSURANCE", new Set(["settlement", "settlement-cancel"])],
  ["CERTIFICATE", new Set(["issue", "revoke"])]
]);

class FinancialCallbackError extends Error {
  constructor(message, code, statusCode = 400) {
    super(message);
    this.name = "FinancialCallbackError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

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
  const callbackSecretEnv = `${normalizedType}_CALLBACK_SECRET`;
  const callbackSecret = String(env[callbackSecretEnv] || env.FINANCIAL_CALLBACK_SECRET || "").trim();
  const token = String(env[`${normalizedType}_GATEWAY_TOKEN`] || env.FINANCIAL_GATEWAY_TOKEN || "").trim();
  return {
    type: normalizedType,
    endpointEnv: definition.endpointEnv,
    secretEnv: definition.secretEnv,
    callbackSecretEnv,
    operations: definition.operations,
    configured: Boolean(endpoint && secret),
    endpointConfigured: Boolean(endpoint),
    signingSecretConfigured: Boolean(secret),
    callbackConfigured: Boolean(callbackSecret),
    bearerTokenConfigured: Boolean(token),
    productionHttps: !isProduction(env) || !endpoint || /^https:\/\//i.test(endpoint),
    timeoutMs: boundedInteger(env.FINANCIAL_GATEWAY_TIMEOUT_MS, 8000, 1000, 30000),
    maxAttempts: boundedInteger(env.FINANCIAL_GATEWAY_MAX_ATTEMPTS, 3, 1, 5),
    callbackMaxSkewSeconds: boundedInteger(env.FINANCIAL_CALLBACK_MAX_SKEW_SECONDS, DEFAULT_FINANCIAL_CALLBACK_MAX_SKEW_SECONDS, 60, 900),
    endpoint,
    secret,
    callbackSecret,
    token
  };
}

function publicGatewayStatus(configuration) {
  const { endpoint, secret, callbackSecret, token, ...status } = configuration;
  return {
    ...status,
    boundary: "The generic signed gateway and callback verifier are available after configuration. Provider field dictionaries, network allowlists and signed joint-test receipts remain external work."
  };
}

function financialGatewayCenter(env = process.env) {
  const gateways = Object.keys(GATEWAY_DEFINITIONS).map((type) => publicGatewayStatus(gatewayConfiguration(type, env)));
  const adapterReady = gateways.every((item) => item.configured && item.productionHttps);
  const callbackReady = gateways.every((item) => item.callbackConfigured);
  return {
    generatedAt: new Date().toISOString(),
    production: isProduction(env),
    adapterReady,
    callbackReady,
    productionReady: false,
    summary: {
      total: gateways.length,
      configured: gateways.filter((item) => item.configured).length,
      callbacksConfigured: gateways.filter((item) => item.callbackConfigured).length,
      operations: gateways.reduce((sum, item) => sum + item.operations.length, 0)
    },
    gateways,
    blockers: [
      ...gateways.filter((item) => !item.configured).map((item) => `${item.type} endpoint and signing secret`),
      ...gateways.filter((item) => !item.productionHttps).map((item) => `${item.type} HTTPS endpoint`),
      ...gateways.filter((item) => !item.callbackConfigured).map((item) => `${item.type} callback signing secret`),
      "merchant and agency credentials, provider-specific callbacks, reconciliation acceptance, security review and signed joint-test receipts"
    ]
  };
}

function sha256(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function safeFinancialText(value, maxLength = 200) {
  return String(value || "").trim().replace(/[\r\n]/g, " ").slice(0, maxLength);
}

function normalizeFinancialCallbackStatus(value) {
  const normalized = safeFinancialText(value, 40).toLowerCase().replace(/[\s_]+/g, "-");
  const aliases = {
    pending: "processing",
    queued: "processing",
    success: "succeeded",
    successful: "succeeded",
    paid: "succeeded",
    settled: "succeeded",
    issued: "succeeded",
    completed: "succeeded",
    rejected: "failed",
    denied: "failed",
    error: "failed",
    refunded: "reversed",
    revoked: "reversed"
  };
  const status = aliases[normalized] || normalized;
  if (!FINANCIAL_CALLBACK_STATUSES.has(status)) {
    throw new FinancialCallbackError("financial callback status is unsupported", "FINANCIAL_CALLBACK_STATUS_INVALID");
  }
  return status;
}

function normalizeFinancialCallback(payload = {}, expectedType) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new FinancialCallbackError("financial callback body must be an object", "FINANCIAL_CALLBACK_BODY_INVALID");
  }
  const gatewayType = normalizeGatewayType(expectedType || payload.gatewayType || payload.type);
  if (payload.gatewayType && normalizeGatewayType(payload.gatewayType) !== gatewayType) {
    throw new FinancialCallbackError("financial callback gateway type conflicts with the route", "FINANCIAL_CALLBACK_GATEWAY_CONFLICT", 409);
  }
  const eventId = safeFinancialText(payload.eventId || payload.event_id, 160);
  const receiptId = safeFinancialText(payload.receiptId || payload.tradeNo || payload.settlementNo || payload.certificateNo, 200);
  const occurredAt = safeFinancialText(payload.occurredAt || payload.occurred_at || payload.timestamp, 80);
  if (!eventId || !receiptId) {
    throw new FinancialCallbackError("financial callback requires eventId and receiptId", "FINANCIAL_CALLBACK_IDENTITY_REQUIRED");
  }
  if (!occurredAt || !Number.isFinite(Date.parse(occurredAt))) {
    throw new FinancialCallbackError("financial callback occurredAt is invalid", "FINANCIAL_CALLBACK_TIME_INVALID");
  }
  const amountValue = payload.amountFen ?? payload.amount_fen;
  const amountFen = amountValue === undefined || amountValue === null || amountValue === "" ? null : Number(amountValue);
  if (amountFen !== null && (!Number.isSafeInteger(amountFen) || amountFen < 0)) {
    throw new FinancialCallbackError("financial callback amountFen must be a non-negative integer", "FINANCIAL_CALLBACK_AMOUNT_INVALID");
  }
  const businessDate = safeFinancialText(payload.businessDate || payload.business_date, 10) || new Date(occurredAt).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate) || new Date(`${businessDate}T00:00:00.000Z`).toISOString().slice(0, 10) !== businessDate) {
    throw new FinancialCallbackError("financial callback businessDate is invalid", "FINANCIAL_CALLBACK_BUSINESS_DATE_INVALID");
  }
  const settlementReference = safeFinancialText(payload.settlementReference || payload.settlement_reference, 200);
  return {
    gatewayType,
    eventId,
    receiptId,
    status: normalizeFinancialCallbackStatus(payload.status || payload.resultStatus || payload.result_status),
    occurredAt: new Date(occurredAt).toISOString(),
    businessDate,
    amountFen,
    providerCode: safeFinancialText(payload.providerCode || payload.code, 80),
    failureReason: safeFinancialText(payload.failureReason || payload.reason, 240),
    settlementReferenceDigest: settlementReference ? sha256(settlementReference) : ""
  };
}

function financialCallbackSigningInput(payload, timestamp, nonce) {
  const payloadDigest = sha256(stableStringify(payload));
  return `${timestamp}\n${nonce}\n${payloadDigest}`;
}

function signFinancialCallback(payload, options = {}) {
  const secret = String(options.secret || "").trim();
  const timestamp = String(options.timestamp || "").trim();
  const nonce = String(options.nonce || "").trim();
  if (!secret || !timestamp || !nonce) {
    throw new FinancialCallbackError("financial callback signing requires secret, timestamp and nonce", "FINANCIAL_CALLBACK_SIGNING_INPUT_REQUIRED");
  }
  return createHmac("sha256", secret).update(financialCallbackSigningInput(payload, timestamp, nonce)).digest("hex");
}

function verifyFinancialCallback(payload, options = {}) {
  const env = options.env || process.env;
  const gatewayType = normalizeGatewayType(options.type || payload?.gatewayType || payload?.type);
  const configuration = gatewayConfiguration(gatewayType, env);
  if (!configuration.callbackSecret) {
    throw new FinancialCallbackError(`${gatewayType} financial callback secret is not configured`, "FINANCIAL_CALLBACK_NOT_CONFIGURED", 503);
  }
  if (isProduction(env) && configuration.callbackSecret.length < 32) {
    throw new FinancialCallbackError(`${gatewayType} financial callback secret does not meet production quality`, "FINANCIAL_CALLBACK_SECRET_WEAK", 503);
  }
  const timestamp = String(options.timestamp || "").trim();
  const timestampNumber = Number(timestamp);
  if (!/^\d{10,13}$/.test(timestamp) || !Number.isFinite(timestampNumber)) {
    throw new FinancialCallbackError("financial callback timestamp is invalid", "FINANCIAL_CALLBACK_TIMESTAMP_INVALID");
  }
  const callbackTimeMs = timestamp.length === 13 ? timestampNumber : timestampNumber * 1000;
  const nowMs = Number(options.nowMs ?? Date.now());
  if (Math.abs(nowMs - callbackTimeMs) > configuration.callbackMaxSkewSeconds * 1000) {
    throw new FinancialCallbackError("financial callback timestamp is outside the allowed window", "FINANCIAL_CALLBACK_TIMESTAMP_EXPIRED", 401);
  }
  const nonce = safeFinancialText(options.nonce, 160);
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(nonce)) {
    throw new FinancialCallbackError("financial callback nonce is invalid", "FINANCIAL_CALLBACK_NONCE_INVALID");
  }
  const signature = safeFinancialText(options.signature, 96).replace(/^sha256=/i, "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(signature)) {
    throw new FinancialCallbackError("financial callback signature is invalid", "FINANCIAL_CALLBACK_SIGNATURE_INVALID", 401);
  }
  const expected = signFinancialCallback(payload, { secret: configuration.callbackSecret, timestamp, nonce });
  const signatureBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  if (signatureBuffer.length !== expectedBuffer.length || !timingSafeEqual(signatureBuffer, expectedBuffer)) {
    throw new FinancialCallbackError("financial callback signature verification failed", "FINANCIAL_CALLBACK_SIGNATURE_MISMATCH", 401);
  }
  const normalized = normalizeFinancialCallback(payload, gatewayType);
  if (Date.parse(normalized.occurredAt) > nowMs + configuration.callbackMaxSkewSeconds * 1000) {
    throw new FinancialCallbackError("financial callback occurredAt is outside the allowed future window", "FINANCIAL_CALLBACK_TIME_IN_FUTURE");
  }
  return {
    ...normalized,
    receivedAt: new Date(nowMs).toISOString(),
    nonceDigest: sha256(nonce),
    signatureVerified: true,
    payloadsExposed: false,
    credentialsPersisted: false
  };
}

function financialEventReceiptIds(event = {}) {
  return [event.adapterReceipt, ...(Array.isArray(event.adapterReceiptHistory) ? event.adapterReceiptHistory : [])]
    .map((receipt) => safeFinancialText(receipt?.receiptId, 200))
    .filter(Boolean);
}

function eventExpectedAmountFen(event = {}) {
  const payload = event.requestPayload?.payload || event.payload || {};
  const value = payload.refundAmountFen ?? payload.amountFen;
  return Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
}

function financialEventProviderStatus(event = {}) {
  try {
    return normalizeFinancialCallbackStatus(event.providerStatus || event.adapterReceipt?.status || event.status || "accepted");
  } catch {
    return "accepted";
  }
}

function applyFinancialCallback(data, verifiedCallback) {
  if (!data || typeof data !== "object") throw new FinancialCallbackError("financial callback ledger is unavailable", "FINANCIAL_CALLBACK_LEDGER_UNAVAILABLE", 503);
  const callback = verifiedCallback || {};
  if (!callback.signatureVerified || !callback.nonceDigest) {
    throw new FinancialCallbackError("financial callback must be verified before persistence", "FINANCIAL_CALLBACK_VERIFICATION_REQUIRED", 401);
  }
  const events = Array.isArray(data.integrationGatewayEvents) ? data.integrationGatewayEvents : [];
  const financialEvents = events.filter((item) => item.adapterType === "financial");
  for (const item of financialEvents) {
    const duplicate = (item.callbackEvents || []).find((entry) => entry.eventId === callback.eventId);
    if (duplicate) {
      const sameEvent = duplicate.gatewayType === callback.gatewayType
        && duplicate.receiptId === callback.receiptId
        && duplicate.status === callback.status
        && duplicate.occurredAt === callback.occurredAt
        && duplicate.businessDate === callback.businessDate
        && duplicate.amountFen === callback.amountFen
        && String(duplicate.providerCode || "") === String(callback.providerCode || "")
        && String(duplicate.failureReason || "") === String(callback.failureReason || "")
        && String(duplicate.settlementReferenceDigest || "") === String(callback.settlementReferenceDigest || "");
      if (!sameEvent) throw new FinancialCallbackError("financial callback event id conflicts with persisted evidence", "FINANCIAL_CALLBACK_EVENT_CONFLICT", 409);
      return { gatewayEvent: item, callbackEvent: duplicate, idempotentReplay: true };
    }
    if ((item.callbackEvents || []).some((entry) => entry.nonceDigest === callback.nonceDigest)) {
      throw new FinancialCallbackError("financial callback nonce was already used", "FINANCIAL_CALLBACK_REPLAY_DETECTED", 409);
    }
  }
  const gatewayEvent = financialEvents.find((item) => item.gatewayType === callback.gatewayType && financialEventReceiptIds(item).includes(callback.receiptId));
  if (!gatewayEvent) throw new FinancialCallbackError("financial callback receipt was not found", "FINANCIAL_CALLBACK_RECEIPT_NOT_FOUND", 404);
  const currentStatus = financialEventProviderStatus(gatewayEvent);
  const currentReceiptId = safeFinancialText(gatewayEvent.adapterReceipt?.receiptId, 200);
  const currentTimeMs = Date.parse(gatewayEvent.latestCallbackAt || "");
  const callbackTimeMs = Date.parse(callback.occurredAt);
  const expectedAmountFen = eventExpectedAmountFen(gatewayEvent);
  let stateApplied = true;
  let ignoredReason = "";
  if (callback.receiptId !== currentReceiptId) {
    stateApplied = false;
    ignoredReason = "superseded-receipt";
  } else if (callback.amountFen !== null && expectedAmountFen !== null && callback.amountFen !== expectedAmountFen) {
    stateApplied = false;
    ignoredReason = "amount-mismatch";
  } else if (Number.isFinite(currentTimeMs) && callbackTimeMs < currentTimeMs) {
    stateApplied = false;
    ignoredReason = "out-of-order";
  } else if (FINANCIAL_CALLBACK_TERMINAL_STATUSES.has(currentStatus)
    && callback.status !== currentStatus
    && !(currentStatus === "succeeded" && callback.status === "reversed")) {
    stateApplied = false;
    ignoredReason = "terminal-conflict";
  } else if ((FINANCIAL_CALLBACK_STATUS_RANK.get(callback.status) || 0) < (FINANCIAL_CALLBACK_STATUS_RANK.get(currentStatus) || 0)) {
    stateApplied = false;
    ignoredReason = "status-regression";
  }
  const callbackEvent = {
    eventId: callback.eventId,
    gatewayType: callback.gatewayType,
    receiptId: callback.receiptId,
    status: callback.status,
    occurredAt: callback.occurredAt,
    receivedAt: callback.receivedAt,
    businessDate: callback.businessDate,
    amountFen: callback.amountFen,
    providerCode: callback.providerCode,
    failureReason: callback.failureReason,
    settlementReferenceDigest: callback.settlementReferenceDigest,
    nonceDigest: callback.nonceDigest,
    signatureVerified: true,
    stateApplied,
    ignoredReason
  };
  gatewayEvent.callbackEvents = [callbackEvent, ...(Array.isArray(gatewayEvent.callbackEvents) ? gatewayEvent.callbackEvents : [])].slice(0, 30);
  gatewayEvent.updatedAt = callback.receivedAt;
  if (stateApplied) {
    gatewayEvent.providerStatus = callback.status;
    gatewayEvent.latestCallbackAt = callback.occurredAt;
    gatewayEvent.businessDate = callback.businessDate;
    gatewayEvent.providerCode = callback.providerCode;
    gatewayEvent.reconciliationStatus = callback.status === "succeeded"
      ? "provider-final"
      : FINANCIAL_CALLBACK_TERMINAL_STATUSES.has(callback.status) ? "provider-exception" : "provider-processing";
  } else if (["superseded-receipt", "amount-mismatch"].includes(ignoredReason)) {
    gatewayEvent.reconciliationStatus = "provider-exception";
  }
  data.integrationGatewayEvents = events;
  return { gatewayEvent, callbackEvent, idempotentReplay: false };
}

function normalizedReconciliationInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new FinancialCallbackError(`${label} must be a non-negative integer`, "FINANCIAL_RECONCILIATION_SUMMARY_INVALID");
  return number;
}

function createFinancialReconciliationRun(data, input = {}, actor = {}) {
  if (!data || typeof data !== "object") throw new FinancialCallbackError("financial reconciliation ledger is unavailable", "FINANCIAL_RECONCILIATION_LEDGER_UNAVAILABLE", 503);
  const gatewayType = normalizeGatewayType(input.gatewayType || input.type);
  const businessDate = safeFinancialText(input.businessDate, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate) || new Date(`${businessDate}T00:00:00.000Z`).toISOString().slice(0, 10) !== businessDate) {
    throw new FinancialCallbackError("financial reconciliation businessDate is invalid", "FINANCIAL_RECONCILIATION_DATE_INVALID");
  }
  const providerInput = input.providerSummary || {};
  const statementDigestRaw = safeFinancialText(providerInput.statementDigest || providerInput.digest, 80).toLowerCase();
  if (!/^(sha256:)?[a-f0-9]{64}$/.test(statementDigestRaw)) {
    throw new FinancialCallbackError("financial reconciliation statementDigest must be a SHA-256 digest", "FINANCIAL_RECONCILIATION_DIGEST_INVALID");
  }
  const providerSummary = {
    total: normalizedReconciliationInteger(providerInput.total, "providerSummary.total"),
    succeeded: normalizedReconciliationInteger(providerInput.succeeded, "providerSummary.succeeded"),
    exceptions: normalizedReconciliationInteger(providerInput.exceptions, "providerSummary.exceptions"),
    grossAmountFen: normalizedReconciliationInteger(providerInput.grossAmountFen, "providerSummary.grossAmountFen"),
    statementDigest: statementDigestRaw.startsWith("sha256:") ? statementDigestRaw : `sha256:${statementDigestRaw}`
  };
  if (providerSummary.succeeded + providerSummary.exceptions > providerSummary.total) {
    throw new FinancialCallbackError("financial reconciliation outcome counts exceed total", "FINANCIAL_RECONCILIATION_COUNTS_INVALID");
  }
  const runs = Array.isArray(data.financialReconciliationRuns) ? data.financialReconciliationRuns : [];
  const existing = runs.find((item) => item.gatewayType === gatewayType && item.businessDate === businessDate && item.providerSummary?.statementDigest === providerSummary.statementDigest);
  if (existing) {
    const normalizedExisting = normalizeFinancialReconciliationRun(existing);
    const sameSummary = normalizedExisting && ["total", "succeeded", "exceptions", "grossAmountFen"]
      .every((field) => normalizedExisting.providerSummary[field] === providerSummary[field]);
    if (!sameSummary) {
      throw new FinancialCallbackError("financial reconciliation digest conflicts with persisted summary", "FINANCIAL_RECONCILIATION_DIGEST_CONFLICT", 409);
    }
    return { run: normalizedExisting, idempotentReplay: true };
  }
  const gatewayEvents = (Array.isArray(data.integrationGatewayEvents) ? data.integrationGatewayEvents : []).filter((item) => {
    if (item.adapterType !== "financial" || item.gatewayType !== gatewayType) return false;
    if (!RECONCILIABLE_OPERATIONS.get(gatewayType)?.has(item.operation)) return false;
    const eventDate = String(item.businessDate || item.dispatchedAt || item.receivedAt || "").slice(0, 10);
    return eventDate === businessDate;
  });
  const localSummary = {
    total: gatewayEvents.length,
    succeeded: gatewayEvents.filter((item) => financialEventProviderStatus(item) === "succeeded" && item.reconciliationStatus !== "provider-exception").length,
    exceptions: gatewayEvents.filter((item) => item.reconciliationStatus === "provider-exception").length,
    grossAmountFen: gatewayEvents.reduce((sum, item) => sum + (eventExpectedAmountFen(item) || 0), 0)
  };
  const differences = {
    total: providerSummary.total - localSummary.total,
    succeeded: providerSummary.succeeded - localSummary.succeeded,
    exceptions: providerSummary.exceptions - localSummary.exceptions,
    grossAmountFen: providerSummary.grossAmountFen - localSummary.grossAmountFen
  };
  const matched = Object.values(differences).every((value) => value === 0);
  const createdAt = new Date().toISOString();
  const run = {
    id: `financial-reconciliation-${randomUUID()}`,
    gatewayType,
    businessDate,
    providerSummary,
    localSummary,
    differences,
    status: matched ? "matched" : "difference",
    createdAt,
    createdBy: safeFinancialText(actor.username || actor.name || actor.role || "operations", 120),
    source: "provider-summary-digest",
    productionEvidence: false
  };
  data.financialReconciliationRuns = [run, ...runs].slice(0, 100);
  return { run, idempotentReplay: false };
}

function publicFinancialCallbackEvent(item = {}) {
  let status = "accepted";
  try { status = normalizeFinancialCallbackStatus(item.status || "accepted"); } catch {}
  const amountNumber = Number(item.amountFen);
  return {
    eventId: safeFinancialText(item.eventId, 160),
    gatewayType: safeFinancialText(item.gatewayType, 20),
    receiptId: safeFinancialText(item.receiptId, 200),
    status,
    occurredAt: Number.isFinite(Date.parse(item.occurredAt)) ? new Date(item.occurredAt).toISOString() : "",
    receivedAt: Number.isFinite(Date.parse(item.receivedAt)) ? new Date(item.receivedAt).toISOString() : "",
    businessDate: /^\d{4}-\d{2}-\d{2}$/.test(String(item.businessDate || "")) ? String(item.businessDate) : "",
    amountFen: item.amountFen === null || item.amountFen === undefined || !Number.isSafeInteger(amountNumber) || amountNumber < 0 ? null : amountNumber,
    providerCode: safeFinancialText(item.providerCode, 80),
    failureReason: safeFinancialText(item.failureReason, 240),
    signatureVerified: item.signatureVerified === true,
    stateApplied: item.stateApplied === true,
    ignoredReason: safeFinancialText(item.ignoredReason, 80)
  };
}

function normalizeFinancialReconciliationRun(item = {}) {
  let gatewayType;
  try { gatewayType = normalizeGatewayType(item.gatewayType); } catch { return null; }
  const businessDate = safeFinancialText(item.businessDate, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) return null;
  const safeSummaryInteger = (value) => Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : 0;
  const normalizeSummary = (summary = {}) => ({
    total: safeSummaryInteger(summary.total),
    succeeded: safeSummaryInteger(summary.succeeded),
    exceptions: safeSummaryInteger(summary.exceptions),
    grossAmountFen: safeSummaryInteger(summary.grossAmountFen)
  });
  const providerSummary = normalizeSummary(item.providerSummary);
  const localSummary = normalizeSummary(item.localSummary);
  const statementDigest = safeFinancialText(item.providerSummary?.statementDigest, 80).toLowerCase();
  if (!/^sha256:[a-f0-9]{64}$/.test(statementDigest)) return null;
  const differences = {
    total: providerSummary.total - localSummary.total,
    succeeded: providerSummary.succeeded - localSummary.succeeded,
    exceptions: providerSummary.exceptions - localSummary.exceptions,
    grossAmountFen: providerSummary.grossAmountFen - localSummary.grossAmountFen
  };
  return {
    id: safeFinancialText(item.id, 200),
    gatewayType,
    businessDate,
    providerSummary: { ...providerSummary, statementDigest },
    localSummary,
    differences,
    status: Object.values(differences).every((value) => value === 0) ? "matched" : "difference",
    createdAt: Number.isFinite(Date.parse(item.createdAt)) ? new Date(item.createdAt).toISOString() : new Date(0).toISOString(),
    createdBy: safeFinancialText(item.createdBy || "operations", 120),
    source: "provider-summary-digest",
    productionEvidence: false
  };
}

function financialGatewayOperationsCenter(data = {}, env = process.env, scopeType = "") {
  const scopedType = scopeType ? normalizeGatewayType(scopeType) : "";
  const events = (Array.isArray(data.integrationGatewayEvents) ? data.integrationGatewayEvents : [])
    .filter((item) => item.adapterType === "financial" && (!scopedType || item.gatewayType === scopedType));
  const runs = (Array.isArray(data.financialReconciliationRuns) ? data.financialReconciliationRuns : [])
    .filter((item) => !scopedType || item.gatewayType === scopedType)
    .map(normalizeFinancialReconciliationRun)
    .filter(Boolean)
    .slice(0, 100);
  const failedStatuses = new Set(["failed", "cancelled", "reversed"]);
  const callbackEvents = events.flatMap((item) => Array.isArray(item.callbackEvents) ? item.callbackEvents : []);
  const eventStatuses = new Map(events.map((item) => [item, financialEventProviderStatus(item)]));
  const gatewayCenter = financialGatewayCenter(env);
  const refundOperations = !scopedType || scopedType === "PAYMENT" ? OnlinePaymentRefunds.buildRefundOperations(data) : null;
  return {
    ok: true,
    productionReady: false,
    callbackReady: scopedType
      ? gatewayCenter.gateways.find((item) => item.type === scopedType)?.callbackConfigured === true
      : gatewayCenter.callbackReady,
    summary: {
      dispatched: events.length,
      pending: events.filter((item) => !FINANCIAL_CALLBACK_TERMINAL_STATUSES.has(eventStatuses.get(item))).length,
      succeeded: events.filter((item) => eventStatuses.get(item) === "succeeded").length,
      exceptions: events.filter((item) => failedStatuses.has(eventStatuses.get(item)) || item.reconciliationStatus === "provider-exception").length,
      callbackEvents: callbackEvents.length,
      ignoredEvents: callbackEvents.filter((item) => item.stateApplied === false).length,
      reconciliationRuns: runs.length,
      reconciliationDifferences: runs.filter((item) => item.status === "difference").length,
      refundRequests: refundOperations?.summary.total || 0,
      refundExceptions: refundOperations?.summary.failed || 0
    },
    gateways: gatewayCenter.gateways.filter((item) => !scopedType || item.type === scopedType),
    events: events.slice(0, 100).map((item) => ({
      id: item.id,
      gatewayType: item.gatewayType,
      operation: item.operation,
      contractId: item.contractId,
      receiptId: safeFinancialText(item.adapterReceipt?.receiptId, 200),
      status: eventStatuses.get(item),
      reconciliationStatus: item.reconciliationStatus,
      businessDate: item.businessDate || String(item.dispatchedAt || item.receivedAt || "").slice(0, 10),
      expectedAmountFen: eventExpectedAmountFen(item),
      latestCallbackAt: item.latestCallbackAt || "",
      callbackEvents: (item.callbackEvents || []).map(publicFinancialCallbackEvent).filter((entry) => entry.eventId),
      productionEvidence: false
    })),
    reconciliationRuns: runs,
    refundOperations,
    boundary: "Signed generic callbacks and digest-only daily reconciliation are runnable. Provider-specific fields, source allowlists, managed callback keys, statement transport and agency signoff remain production dependencies."
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
  FINANCIAL_CALLBACK_STATUSES,
  FINANCIAL_CALLBACK_TERMINAL_STATUSES,
  FORBIDDEN_PAYLOAD_KEYS,
  FinancialCallbackError,
  GATEWAY_DEFINITIONS,
  REQUIRED_FIELDS,
  applyFinancialCallback,
  buildRefundOperations: OnlinePaymentRefunds.buildRefundOperations,
  cancelRefund: OnlinePaymentRefunds.cancelRefund,
  closeRefund: OnlinePaymentRefunds.closeRefund,
  createRefundRequest: OnlinePaymentRefunds.createRefundRequest,
  createFinancialReconciliationRun,
  dispatchFinancialRequest,
  financialGatewayOperationsCenter,
  financialGatewayCenter,
  gatewayConfiguration,
  normalizeFinancialCallback,
  normalizeFinancialCallbackStatus,
  normalizeFinancialReconciliationRun,
  prepareRefundDispatch: OnlinePaymentRefunds.prepareRefundDispatch,
  reconcileRefund: OnlinePaymentRefunds.reconcileRefund,
  recordRefundDispatch: OnlinePaymentRefunds.recordRefundDispatch,
  resubmitRejectedRefund: OnlinePaymentRefunds.resubmitRejectedRefund,
  retryRefund: OnlinePaymentRefunds.retryRefund,
  reviewRefundRequest: OnlinePaymentRefunds.reviewRefundRequest,
  signFinancialCallback,
  signFinancialRequest,
  stableStringify,
  syncRefundFromFinancialCallback: OnlinePaymentRefunds.syncRefundFromFinancialCallback,
  validateFinancialRequest,
  verifyFinancialCallback,
  verifyRefundLedger: OnlinePaymentRefunds.verifyRefundLedger,
  verifyRefundStateProjection: OnlinePaymentRefunds.verifyRefundStateProjection
};
