const { createHash, createHmac, timingSafeEqual } = require("node:crypto");

const DEFAULT_MAX_SKEW_SECONDS = 300;
let managedSecretLoader = null;

class DigitalHospitalSecurityError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.name = "DigitalHospitalSecurityError";
    this.code = code;
    this.status = status;
  }
}

function clean(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function sha256(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizedFingerprint(value) {
  return clean(value, 160).replace(/[^a-f0-9]/gi, "").toLowerCase();
}

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

function callbackSigningInput(payload, timestamp, nonce) {
  return `${timestamp}\n${nonce}\n${sha256(stableStringify(payload))}`;
}

function signExecutionCallback(payload, options = {}) {
  const secret = clean(options.secret, 4096);
  const timestamp = clean(options.timestamp, 80);
  const nonce = clean(options.nonce, 160);
  if (secret.length < 32 || !timestamp || !nonce) {
    throw new DigitalHospitalSecurityError(
      "callback signing requires a 32-character secret, timestamp and nonce",
      "EXECUTION_CALLBACK_SIGNING_INPUT_INVALID"
    );
  }
  return createHmac("sha256", secret).update(callbackSigningInput(payload, timestamp, nonce)).digest("hex");
}

function configureDigitalHospitalManagedSecretLoader(loader) {
  if (loader !== null && typeof loader !== "function") {
    throw new TypeError("managed secret loader must be a function or null");
  }
  managedSecretLoader = loader;
}

function securityConfiguration(env = process.env) {
  const production = clean(env.NODE_ENV, 40).toLowerCase() === "production";
  const keyReference = clean(env.DIGITAL_HOSPITAL_CALLBACK_KEY_REF, 500);
  const localSecret = clean(env.DIGITAL_HOSPITAL_CALLBACK_SECRET, 4096);
  const trustedFingerprints = clean(env.DIGITAL_HOSPITAL_CALLBACK_MTLS_FINGERPRINTS, 4096)
    .split(/[,;\n]/)
    .map(normalizedFingerprint)
    .filter(Boolean);
  return {
    production,
    keyReference,
    localSecret,
    trustedFingerprints,
    maxSkewSeconds: boundedInteger(
      env.DIGITAL_HOSPITAL_CALLBACK_MAX_SKEW_SECONDS,
      DEFAULT_MAX_SKEW_SECONDS,
      30,
      900
    ),
    trustProxyMtls: clean(env.DIGITAL_HOSPITAL_TRUST_PROXY_MTLS, 20).toLowerCase() === "true"
  };
}

async function loadManagedCallbackSecret(input = {}, options = {}) {
  const env = options.env || process.env;
  const configuration = securityConfiguration(env);
  const loader = options.loader === undefined ? managedSecretLoader : options.loader;
  let material;
  let source;
  if (loader && configuration.keyReference) {
    material = await loader({
      purpose: "digital-hospital-execution-callback",
      reference: configuration.keyReference,
      connectorId: clean(input.connectorId || input.source, 160),
      environmentId: clean(input.environmentId, 160)
    });
    source = "managed-secret-service";
  } else {
    if (configuration.production) {
      if (!configuration.keyReference) {
        throw new DigitalHospitalSecurityError(
          "DIGITAL_HOSPITAL_CALLBACK_KEY_REF is required in production",
          "EXECUTION_CALLBACK_KEY_REFERENCE_REQUIRED",
          503
        );
      }
      throw new DigitalHospitalSecurityError(
        "managed callback secret service is unavailable",
        "EXECUTION_CALLBACK_KEY_SERVICE_UNAVAILABLE",
        503
      );
    }
    material = configuration.localSecret;
    source = "local-compatibility";
  }
  const secret = clean(typeof material === "string" ? material : material?.secret, 4096);
  const keyVersion = clean(typeof material === "object" ? material?.keyVersion : "", 80) || "local";
  if (secret.length < 32) {
    throw new DigitalHospitalSecurityError(
      "callback verification key does not meet minimum quality",
      "EXECUTION_CALLBACK_KEY_WEAK",
      503
    );
  }
  return {
    secret,
    keyVersion,
    source,
    keyReferenceFingerprint: configuration.keyReference ? sha256(configuration.keyReference) : "",
    configuration
  };
}

function callbackTime(timestamp) {
  const value = clean(timestamp, 80);
  if (/^\d{10}$/.test(value)) return Number(value) * 1000;
  if (/^\d{13}$/.test(value)) return Number(value);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new DigitalHospitalSecurityError(
      "callback timestamp is invalid",
      "EXECUTION_CALLBACK_TIMESTAMP_INVALID",
      401
    );
  }
  return parsed;
}

function assertMtls(options, configuration) {
  const fingerprint = normalizedFingerprint(options.clientCertificateFingerprint);
  const trusted = configuration.trustedFingerprints;
  if (!configuration.production && trusted.length === 0) {
    return { verified: false, status: "development-not-enforced", fingerprintDigest: "" };
  }
  if (!fingerprint) {
    throw new DigitalHospitalSecurityError(
      "a verified client certificate is required",
      "EXECUTION_CALLBACK_MTLS_REQUIRED",
      401
    );
  }
  if (!trusted.includes(fingerprint)) {
    throw new DigitalHospitalSecurityError(
      "client certificate fingerprint is not trusted",
      "EXECUTION_CALLBACK_MTLS_UNTRUSTED",
      401
    );
  }
  if (options.clientCertificateAuthorized !== true && !configuration.trustProxyMtls) {
    throw new DigitalHospitalSecurityError(
      "client certificate was not authorized by the TLS transport",
      "EXECUTION_CALLBACK_MTLS_NOT_AUTHORIZED",
      401
    );
  }
  return { verified: true, status: "verified", fingerprintDigest: sha256(fingerprint) };
}

async function verifySignedExecutionCallback(payload, options = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new DigitalHospitalSecurityError(
      "callback body must be an object",
      "EXECUTION_CALLBACK_BODY_INVALID"
    );
  }
  const timestamp = clean(options.timestamp, 80);
  const nonce = clean(options.nonce, 160);
  const signature = clean(options.signature, 120).replace(/^sha256=/i, "").toLowerCase();
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(nonce)) {
    throw new DigitalHospitalSecurityError(
      "callback nonce is invalid",
      "EXECUTION_CALLBACK_NONCE_INVALID",
      401
    );
  }
  if (!/^[a-f0-9]{64}$/.test(signature)) {
    throw new DigitalHospitalSecurityError(
      "callback signature is invalid",
      "EXECUTION_CALLBACK_SIGNATURE_INVALID",
      401
    );
  }
  const nowMs = Number(options.nowMs ?? Date.now());
  const timestampMs = callbackTime(timestamp);
  const key = await loadManagedCallbackSecret(payload, options);
  if (Math.abs(nowMs - timestampMs) > key.configuration.maxSkewSeconds * 1000) {
    throw new DigitalHospitalSecurityError(
      "callback timestamp is outside the allowed window",
      "EXECUTION_CALLBACK_TIMESTAMP_EXPIRED",
      401
    );
  }
  const expected = signExecutionCallback(payload, { secret: key.secret, timestamp, nonce });
  const actualBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw new DigitalHospitalSecurityError(
      "callback signature verification failed",
      "EXECUTION_CALLBACK_SIGNATURE_MISMATCH",
      401
    );
  }
  const mtls = assertMtls(options, key.configuration);
  const payloadDigest = clean(payload.payloadDigest, 80).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(payloadDigest)) {
    throw new DigitalHospitalSecurityError(
      "callback payloadDigest must be SHA-256",
      "EXECUTION_CALLBACK_PAYLOAD_DIGEST_INVALID"
    );
  }
  return {
    jobId: clean(payload.jobId, 160),
    source: clean(payload.source || payload.connectorId, 160),
    environmentId: clean(payload.environmentId, 160),
    eventType: clean(payload.eventType || "integration-job.completed", 160),
    payloadDigest,
    timestamp: new Date(timestampMs).toISOString(),
    now: new Date(nowMs).toISOString(),
    nonce,
    signatureValid: true,
    verification: {
      signature: "valid",
      timestamp: "valid",
      mtls: mtls.status,
      nonceDigest: sha256(`${clean(payload.source || payload.connectorId, 160)}:${nonce}`),
      clientCertificateFingerprintDigest: mtls.fingerprintDigest,
      keyReferenceFingerprint: key.keyReferenceFingerprint,
      keyVersion: key.keyVersion,
      keySource: key.source,
      credentialsPersisted: false,
      rawSignaturePersisted: false,
      rawNoncePersisted: false
    }
  };
}

function buildDigitalHospitalSecurityCenter(options = {}) {
  const env = options.env || process.env;
  const configuration = securityConfiguration(env);
  const loaderConfigured = options.loaderConfigured === undefined
    ? typeof managedSecretLoader === "function"
    : Boolean(options.loaderConfigured);
  const managedKeyReady = Boolean(configuration.keyReference && loaderConfigured);
  const mtlsReady = configuration.trustedFingerprints.length > 0;
  const productionReady = managedKeyReady && mtlsReady;
  return {
    production: configuration.production,
    productionReady,
    callbackSigning: "HMAC-SHA256",
    canonicalPayloadDigest: "SHA-256",
    replayProtection: "timestamp + nonce digest + persisted receipt ledger",
    maxSkewSeconds: configuration.maxSkewSeconds,
    managedKey: {
      referenceConfigured: Boolean(configuration.keyReference),
      loaderConfigured,
      referenceFingerprint: configuration.keyReference ? sha256(configuration.keyReference) : "",
      localCompatibilityConfigured: !configuration.production && configuration.localSecret.length >= 32
    },
    mtls: {
      trustedFingerprintCount: configuration.trustedFingerprints.length,
      trustProxyAssertion: configuration.trustProxyMtls
    },
    persistenceBoundary: {
      rawSecret: false,
      rawSignature: false,
      rawNonce: false,
      rawClientCertificate: false
    },
    blockers: [
      ...(managedKeyReady ? [] : ["managed callback key reference and loader"]),
      ...(mtlsReady ? [] : ["trusted mTLS client certificate fingerprints"]),
      "deployed gateway network allowlist and signed hospital joint-test evidence"
    ]
  };
}

module.exports = {
  DigitalHospitalSecurityError,
  buildDigitalHospitalSecurityCenter,
  callbackSigningInput,
  configureDigitalHospitalManagedSecretLoader,
  loadManagedCallbackSecret,
  securityConfiguration,
  signExecutionCallback,
  stableStringify,
  verifySignedExecutionCallback
};
