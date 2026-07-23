const crypto = require("node:crypto");
const {
  LEGACY_KEY_ID,
  resolveVerificationKey,
  selectSigningKey
} = require("./public-health-external-keyring-service");

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
const DEFAULT_REQUEST_TTL_SECONDS = 600;
const DEFAULT_RECEIPT_TTL_SECONDS = 300;
const DEFAULT_CALLBACK_CLOCK_SKEW_SECONDS = 30;

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

function isoAfter(value, seconds, label) {
  const parsed = new Date(value).getTime();
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a valid date-time`);
  return new Date(parsed + seconds * 1000).toISOString();
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

function normalizedRequestPayload(handoff, input = {}, profile, signingKey) {
  const idempotencyKey = clean(input.idempotencyKey);
  const operation = clean(input.operation || "coordinate");
  if (!idempotencyKey) throw new Error("idempotencyKey is required for external dispatch");
  if (!operation) throw new Error("operation is required for external dispatch");
  const issuedAt = clean(input.at || input.issuedAt);
  const expiresAt = issuedAt
    ? clean(input.expiresAt || isoAfter(issuedAt, DEFAULT_REQUEST_TTL_SECONDS, "external request issuedAt"))
    : "";
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
    idempotencyKeyHash: sha256(idempotencyKey),
    signingKeyId: signingKey.keyId,
    issuedAt,
    expiresAt
  };
}

function createPublicHealthExternalDispatch(handoff = {}, input = {}, credentials = {}) {
  const profile = profileForLane(handoff.laneId);
  if (handoff.state !== "in-progress") throw new Error("external dispatch requires an in-progress coordination handoff");
  if (!validHttpsEndpoint(credentials.endpoint)) throw new Error("external adapter endpoint must use HTTPS");
  const maxAttempts = Number(credentials.maxAttempts || profile.maxAttempts);
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) throw new Error("external adapter maxAttempts must be an integer from 1 to 10");
  const requestSigningMaterial = credentials.requestKeyring || credentials.requestSecret;
  const receiptVerificationMaterial = credentials.receiptKeyring || credentials.receiptSecret;
  selectSigningKey(receiptVerificationMaterial, clean(input.at || new Date().toISOString()));
  const requestSigningKey = selectSigningKey(requestSigningMaterial, clean(input.at || new Date().toISOString()));
  if (!requestSigningKey.legacy && !clean(input.at || input.issuedAt)) {
    throw new Error("issuedAt is required when a managed request keyring is used");
  }
  const request = normalizedRequestPayload(handoff, input, profile, requestSigningKey);
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
    requestSignatureKeyId: requestSigningKey.keyId,
    requestSignature: signPayload(signedPayload, requestSigningKey.secret),
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

function verifyPublicHealthExternalDispatch(dispatch, requestSigningMaterial, options = {}) {
  let profile;
  try {
    profile = profileForLane(dispatch?.laneId);
  } catch {
    return { ok: false, reason: "dispatch-lane-invalid" };
  }
  const request = dispatch?.request || {};
  const expectedId = `ph-dispatch-${sha256(`${request.laneId}:${request.handoffId}:${request.idempotencyKeyHash}`).slice(0, 24)}`;
  const expectedDigest = sha256(stableStringify(request));
  const keyId = clean(dispatch?.requestSignatureKeyId || request.signingKeyId || LEGACY_KEY_ID);
  const keyResolution = resolveVerificationKey(
    requestSigningMaterial,
    keyId,
    clean(options.at || request.issuedAt || new Date().toISOString())
  );
  if (!keyResolution.ok) return { ok: false, reason: `dispatch-${keyResolution.reason}` };
  let expectedSignature = "";
  try {
    expectedSignature = signPayload(request, keyResolution.key.secret);
  } catch {
    return { ok: false, reason: "dispatch-verification-secret-invalid" };
  }
  const bindingsValid = request.schemaVersion === REQUEST_SCHEMA_VERSION
    && request.dispatchId === dispatch.id
    && request.laneId === dispatch.laneId
    && request.handoffId === dispatch.handoffId
    && request.adapterId === dispatch.adapterId
    && request.contract === dispatch.contract
    && dispatch.adapterId === profile.adapterId
    && dispatch.contract === profile.contract
    && dispatch.id === expectedId
    && dispatch.requestDigest === expectedDigest
    && clean(request.signingKeyId || LEGACY_KEY_ID) === keyId
    && clean(dispatch.requestSignatureKeyId || LEGACY_KEY_ID) === keyId
    && (
      (keyId === LEGACY_KEY_ID && !request.issuedAt && !request.expiresAt)
      || (
        Number.isFinite(new Date(request.issuedAt).getTime())
        && Number.isFinite(new Date(request.expiresAt).getTime())
        && new Date(request.expiresAt).getTime() > new Date(request.issuedAt).getTime()
      )
    );
  if (!bindingsValid) return { ok: false, reason: "dispatch-binding-mismatch" };
  if (clean(dispatch.signatureAlgorithm) !== "HMAC-SHA256" || !timingSafeHexEqual(dispatch.requestSignature, expectedSignature)) {
    return { ok: false, reason: "dispatch-signature-invalid" };
  }
  return { ok: true, reason: "verified" };
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
    signingKeyId: clean(receipt.signingKeyId || LEGACY_KEY_ID),
    issuedAt: clean(receipt.issuedAt),
    expiresAt: clean(receipt.expiresAt),
    nonce: clean(receipt.nonce),
    reason: clean(receipt.reason),
    exceptionOwner: clean(receipt.exceptionOwner),
    dueAt: clean(receipt.dueAt)
  };
}

function signPublicHealthExternalReceipt(receipt, receiptSigningMaterial) {
  const issuedAt = clean(receipt.issuedAt || receipt.receivedAt || new Date().toISOString());
  const signingKey = selectSigningKey(receiptSigningMaterial, issuedAt);
  const expiresAt = clean(receipt.expiresAt || isoAfter(issuedAt, DEFAULT_RECEIPT_TTL_SECONDS, "external receipt issuedAt"));
  const nonce = clean(receipt.nonce || sha256([
    receipt.dispatchId,
    receipt.receiptCode,
    issuedAt,
    signingKey.keyId
  ].join(":")).slice(0, 32));
  const payload = normalizedReceiptPayload({
    ...receipt,
    signingKeyId: signingKey.keyId,
    issuedAt,
    expiresAt,
    nonce
  });
  return {
    ...payload,
    signatureAlgorithm: "HMAC-SHA256",
    signature: signPayload(payload, signingKey.secret)
  };
}

function verifyPublicHealthExternalReceipt(dispatch, receipt, receiptSigningMaterial, options = {}) {
  const payload = normalizedReceiptPayload(receipt);
  const statusValid = ["accepted", "rejected"].includes(payload.status);
  const rejectionValid = payload.status !== "rejected"
    || (payload.reason && payload.exceptionOwner && /^\d{4}-\d{2}-\d{2}/.test(payload.dueAt));
  const bindingsValid = payload.dispatchId === dispatch.id
    && payload.requestDigest === dispatch.requestDigest
    && payload.laneId === dispatch.laneId
    && payload.handoffId === dispatch.handoffId;
  const issuedAtValue = new Date(payload.issuedAt).getTime();
  const expiresAtValue = new Date(payload.expiresAt).getTime();
  const receivedAtValue = new Date(payload.receivedAt).getTime();
  const temporalEvidenceValid = Number.isFinite(issuedAtValue)
    && Number.isFinite(expiresAtValue)
    && Number.isFinite(receivedAtValue)
    && expiresAtValue > issuedAtValue
    && Boolean(payload.nonce);
  const evidenceValid = Boolean(payload.receiptCode && payload.evidenceRefs.length && payload.receivedAt && temporalEvidenceValid);
  const verificationAt = clean(options.at || new Date().toISOString());
  const keyResolution = resolveVerificationKey(receiptSigningMaterial, payload.signingKeyId, verificationAt);
  if (!keyResolution.ok) return { ok: false, reason: `receipt-${keyResolution.reason}`, payload };
  let expectedSignature = "";
  try {
    expectedSignature = signPayload(payload, keyResolution.key.secret);
  } catch {
    return { ok: false, reason: "receipt-verification-secret-invalid", payload };
  }
  const signatureValid = clean(receipt.signatureAlgorithm) === "HMAC-SHA256"
    && timingSafeHexEqual(receipt.signature, expectedSignature);
  if (!statusValid) return { ok: false, reason: "receipt-status-invalid", payload };
  if (!bindingsValid) return { ok: false, reason: "receipt-binding-mismatch", payload };
  if (!evidenceValid || !rejectionValid) return { ok: false, reason: "receipt-evidence-invalid", payload };
  if (!signatureValid) return { ok: false, reason: "receipt-signature-invalid", payload };
  if (options.enforceFreshness) {
    const atValue = new Date(verificationAt).getTime();
    const clockSkewSeconds = Number(options.clockSkewSeconds ?? DEFAULT_CALLBACK_CLOCK_SKEW_SECONDS);
    const maxAgeSeconds = Number(options.maxAgeSeconds ?? DEFAULT_RECEIPT_TTL_SECONDS);
    if (!Number.isFinite(atValue)
      || !Number.isInteger(clockSkewSeconds) || clockSkewSeconds < 0 || clockSkewSeconds > 300
      || !Number.isInteger(maxAgeSeconds) || maxAgeSeconds < 30 || maxAgeSeconds > 3600) {
      return { ok: false, reason: "receipt-freshness-policy-invalid", payload };
    }
    const skewMs = clockSkewSeconds * 1000;
    if (issuedAtValue > atValue + skewMs) return { ok: false, reason: "receipt-issued-in-future", payload };
    if (expiresAtValue < atValue - skewMs || atValue - issuedAtValue > (maxAgeSeconds * 1000) + skewMs) {
      return { ok: false, reason: "receipt-expired", payload };
    }
  }
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
    ? verifyPublicHealthExternalReceipt(
      next,
      result.receipt,
      options.receiptKeyring || options.receiptSecret,
      {
        at,
        enforceFreshness: true,
        clockSkewSeconds: options.callbackClockSkewSeconds,
        maxAgeSeconds: options.callbackMaxAgeSeconds
      }
    )
    : { ok: false, reason: "receipt-missing", payload: null };
  const attempt = {
    attempt: attemptNumber,
    at,
    transportStatus,
    outcome: "failed",
    reason: clean(result.networkError) ? "network-error" : verification.reason,
    receiptDigest: result.receipt ? sha256(stableStringify(result.receipt)) : ""
  };

  if (transportStatus >= 200 && transportStatus < 300 && verification.ok) {
    next.receipt = {
      ...verification.payload,
      signatureAlgorithm: clean(result.receipt.signatureAlgorithm),
      signature: clean(result.receipt.signature)
    };
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
  DEFAULT_CALLBACK_CLOCK_SKEW_SECONDS,
  DEFAULT_RECEIPT_TTL_SECONDS,
  DEFAULT_REQUEST_TTL_SECONDS,
  RECEIPT_SCHEMA_VERSION,
  REQUEST_SCHEMA_VERSION,
  buildPublicHealthExternalAdapterRegistry,
  createPublicHealthExternalDispatch,
  normalizedReceiptPayload,
  recordPublicHealthExternalDeliveryAttempt,
  signPublicHealthExternalReceipt,
  verifyPublicHealthExternalDispatch,
  verifyPublicHealthExternalReceipt
};
