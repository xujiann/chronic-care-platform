const crypto = require("node:crypto");

const EXTERNAL_ADAPTER_PROFILES = [
  ["infectious-reporting", "infectious-reporting-v1"],
  ["immunization", "immunization-registry-v1"],
  ["maternal-child", "maternal-child-continuity-v1"],
  ["senior-health", "senior-health-service-v1"],
  ["chronic-management", "chronic-management-v1"],
  ["public-health-followup", "public-health-followup-v1"],
  ["health-education", "health-education-delivery-v1"],
  ["family-doctor", "family-doctor-fulfillment-v1"]
].map(([laneId, contract]) => {
  const envStem = laneId.replace(/-/g, "_").toUpperCase();
  return Object.freeze({
    laneId,
    adapterId: `ph-adapter-${laneId}`,
    contract,
    endpointEnv: `PUBLIC_HEALTH_${envStem}_ENDPOINT`,
    requestSecretEnv: `PUBLIC_HEALTH_${envStem}_REQUEST_SECRET`,
    receiptSecretEnv: `PUBLIC_HEALTH_${envStem}_RECEIPT_SECRET`,
    maxAttempts: 3
  });
});

const REQUEST_SCHEMA_VERSION = "public-health-external-dispatch/v1";
const RECEIPT_SCHEMA_VERSION = "public-health-external-receipt/v1";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function clean(value) {
  return String(value ?? "").trim();
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = stableValue(value[key]);
      return result;
    }, {});
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function signPayload(payload, secret) {
  if (clean(secret).length < 32) throw new Error("adapter signing secret must contain at least 32 characters");
  return crypto.createHmac("sha256", secret).update(stableStringify(payload)).digest("hex");
}

function timingSafeHexEqual(left, right) {
  if (!/^[a-f0-9]{64}$/i.test(clean(left)) || !/^[a-f0-9]{64}$/i.test(clean(right))) return false;
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function profileForLane(laneId) {
  const profile = EXTERNAL_ADAPTER_PROFILES.find((item) => item.laneId === clean(laneId));
  if (!profile) throw new Error(`unsupported public health adapter lane: ${clean(laneId) || "missing"}`);
  return profile;
}

function validHttpsEndpoint(value) {
  try {
    const endpoint = new URL(clean(value));
    return endpoint.protocol === "https:" && Boolean(endpoint.hostname) && !endpoint.username && !endpoint.password;
  } catch {
    return false;
  }
}

function buildPublicHealthExternalAdapterRegistry(env = process.env) {
  const adapters = EXTERNAL_ADAPTER_PROFILES.map((profile) => {
    const endpointConfigured = validHttpsEndpoint(env[profile.endpointEnv]);
    const requestSigningConfigured = clean(env[profile.requestSecretEnv]).length >= 32;
    const receiptVerificationConfigured = clean(env[profile.receiptSecretEnv]).length >= 32;
    return {
      ...profile,
      endpointConfigured,
      requestSigningConfigured,
      receiptVerificationConfigured,
      configured: endpointConfigured && requestSigningConfigured && receiptVerificationConfigured,
      productionReady: false
    };
  });
  return {
    ok: adapters.length === 8,
    adapters,
    summary: {
      adapters: adapters.length,
      configured: adapters.filter((item) => item.configured).length,
      unconfigured: adapters.filter((item) => !item.configured).length
    },
    productionReady: false,
    blockers: [
      "Configuration alone is not production evidence.",
      "Each adapter requires a verified signed receipt and trusted site evidence."
    ]
  };
}

function normalizedRequestPayload(handoff, input = {}, profile) {
  const idempotencyKey = clean(input.idempotencyKey);
  const operation = clean(input.operation || "coordinate");
  if (!idempotencyKey) throw new Error("idempotencyKey is required for external dispatch");
  if (!operation) throw new Error("operation is required for external dispatch");
  const evidenceRefs = Array.isArray(input.evidenceRefs)
    ? [...new Set(input.evidenceRefs.map(clean).filter(Boolean))].sort()
    : [];
  return {
    schemaVersion: REQUEST_SCHEMA_VERSION,
    adapterId: profile.adapterId,
    contract: profile.contract,
    laneId: handoff.laneId,
    handoffId: handoff.id,
    handoffVersion: Number(handoff.version),
    businessKeyHash: sha256(handoff.businessKey),
    operation,
    evidenceRefs,
    idempotencyKeyHash: sha256(idempotencyKey)
  };
}

function createPublicHealthExternalDispatch(handoff = {}, input = {}, credentials = {}) {
  const profile = profileForLane(handoff.laneId);
  if (handoff.state !== "in-progress") throw new Error("external dispatch requires an in-progress coordination handoff");
  if (!validHttpsEndpoint(credentials.endpoint)) throw new Error("external adapter endpoint must use HTTPS");
  if (clean(credentials.receiptSecret).length < 32) throw new Error("receipt verification secret must contain at least 32 characters");
  const maxAttempts = Number(credentials.maxAttempts || profile.maxAttempts);
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) throw new Error("external adapter maxAttempts must be an integer from 1 to 10");
  const request = normalizedRequestPayload(handoff, input, profile);
  const dispatchId = `ph-dispatch-${sha256(`${request.laneId}:${request.handoffId}:${request.idempotencyKeyHash}`).slice(0, 24)}`;
  const signedPayload = { ...request, dispatchId };
  const requestDigest = sha256(stableStringify(signedPayload));
  return {
    id: dispatchId,
    laneId: request.laneId,
    handoffId: request.handoffId,
    adapterId: profile.adapterId,
    contract: profile.contract,
    request: signedPayload,
    requestDigest,
    requestSignature: signPayload(signedPayload, credentials.requestSecret),
    signatureAlgorithm: "HMAC-SHA256",
    deliveryState: "pending",
    attempts: [],
    maxAttempts,
    nextRetryAt: null,
    receipt: null,
    blocker: "Verified external receipt and trusted site evidence are still required.",
    productionReady: false
  };
}

function normalizedReceiptPayload(receipt = {}) {
  const evidenceRefs = Array.isArray(receipt.evidenceRefs)
    ? [...new Set(receipt.evidenceRefs.map(clean).filter(Boolean))].sort()
    : [];
  return {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    dispatchId: clean(receipt.dispatchId),
    requestDigest: clean(receipt.requestDigest),
    laneId: clean(receipt.laneId),
    handoffId: clean(receipt.handoffId),
    status: clean(receipt.status).toLowerCase(),
    receiptCode: clean(receipt.receiptCode),
    evidenceRefs,
    receivedAt: clean(receipt.receivedAt),
    reason: clean(receipt.reason),
    exceptionOwner: clean(receipt.exceptionOwner),
    dueAt: clean(receipt.dueAt)
  };
}

function signPublicHealthExternalReceipt(receipt, receiptSecret) {
  const payload = normalizedReceiptPayload(receipt);
  return {
    ...payload,
    signatureAlgorithm: "HMAC-SHA256",
    signature: signPayload(payload, receiptSecret)
  };
}

function verifyPublicHealthExternalReceipt(dispatch, receipt, receiptSecret) {
  const payload = normalizedReceiptPayload(receipt);
  const statusValid = ["accepted", "rejected"].includes(payload.status);
  const rejectionValid = payload.status !== "rejected"
    || (payload.reason && payload.exceptionOwner && /^\d{4}-\d{2}-\d{2}/.test(payload.dueAt));
  const bindingsValid = payload.dispatchId === dispatch.id
    && payload.requestDigest === dispatch.requestDigest
    && payload.laneId === dispatch.laneId
    && payload.handoffId === dispatch.handoffId;
  const evidenceValid = Boolean(payload.receiptCode && payload.evidenceRefs.length && payload.receivedAt);
  let expectedSignature = "";
  try {
    expectedSignature = signPayload(payload, receiptSecret);
  } catch {
    return { ok: false, reason: "receipt-verification-secret-invalid", payload };
  }
  const signatureValid = clean(receipt.signatureAlgorithm) === "HMAC-SHA256"
    && timingSafeHexEqual(receipt.signature, expectedSignature);
  if (!statusValid) return { ok: false, reason: "receipt-status-invalid", payload };
  if (!bindingsValid) return { ok: false, reason: "receipt-binding-mismatch", payload };
  if (!evidenceValid || !rejectionValid) return { ok: false, reason: "receipt-evidence-invalid", payload };
  if (!signatureValid) return { ok: false, reason: "receipt-signature-invalid", payload };
  return { ok: true, reason: "verified", payload };
}

function retryTime(at, attemptNumber) {
  const value = new Date(at);
  if (Number.isNaN(value.getTime())) return "";
  value.setUTCMinutes(value.getUTCMinutes() + Math.min(60, 2 ** attemptNumber));
  return value.toISOString();
}

function recordPublicHealthExternalDeliveryAttempt(dispatch, result = {}, options = {}) {
  if (!["pending", "retry-scheduled"].includes(dispatch.deliveryState)) {
    throw new Error(`delivery attempt is not allowed from state ${dispatch.deliveryState}`);
  }
  const next = clone(dispatch);
  const attemptNumber = next.attempts.length + 1;
  const at = clean(options.at || new Date().toISOString());
  const transportStatus = Number(result.transportStatus || 0);
  const transient = Boolean(result.networkError) || transportStatus === 429 || transportStatus >= 500;
  const verification = result.receipt
    ? verifyPublicHealthExternalReceipt(next, result.receipt, options.receiptSecret)
    : { ok: false, reason: "receipt-missing", payload: null };
  const attempt = {
    attempt: attemptNumber,
    at,
    transportStatus,
    outcome: "failed",
    reason: clean(result.networkError) ? "network-error" : verification.reason
  };

  if (transportStatus >= 200 && transportStatus < 300 && verification.ok) {
    next.receipt = verification.payload;
    attempt.outcome = verification.payload.status;
    attempt.reason = "verified-signed-receipt";
    if (verification.payload.status === "accepted") {
      next.deliveryState = "delivered";
      next.blocker = "Trusted site evidence is still required before production readiness.";
    } else {
      next.deliveryState = "dead-letter";
      next.blocker = `External rejection requires compensation by ${verification.payload.exceptionOwner} before ${verification.payload.dueAt}.`;
    }
  } else if (transient && attemptNumber < Number(next.maxAttempts || 3)) {
    next.deliveryState = "retry-scheduled";
    next.nextRetryAt = retryTime(at, attemptNumber);
    next.blocker = `Transient delivery failure; retry ${attemptNumber + 1}/${next.maxAttempts} is scheduled.`;
  } else {
    next.deliveryState = "dead-letter";
    next.nextRetryAt = null;
    next.blocker = transient
      ? `Delivery exhausted ${next.maxAttempts} attempts and requires manual compensation.`
      : `Permanent delivery failure (${verification.reason}) requires security review and compensation.`;
  }
  next.attempts = [...next.attempts, attempt];
  next.productionReady = false;
  return next;
}

module.exports = {
  EXTERNAL_ADAPTER_PROFILES,
  RECEIPT_SCHEMA_VERSION,
  REQUEST_SCHEMA_VERSION,
  buildPublicHealthExternalAdapterRegistry,
  createPublicHealthExternalDispatch,
  normalizedReceiptPayload,
  recordPublicHealthExternalDeliveryAttempt,
  signPublicHealthExternalReceipt,
  verifyPublicHealthExternalReceipt
};
