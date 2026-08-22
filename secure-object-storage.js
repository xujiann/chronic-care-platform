const { createHash, createHmac, randomUUID, timingSafeEqual } = require("node:crypto");

const DEFAULT_MAX_BYTES = 100 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_UPLOAD_TTL_SECONDS = 900;
const DEFAULT_RESPONSE_MAX_SKEW_SECONDS = 300;
const MAX_GATEWAY_RESPONSE_BYTES = 1024 * 1024;
const GATEWAY_TRUST_VERSION = "object-storage-gateway-trust-v1";
const GATEWAY_RESPONSE_SCHEMA = "object-storage-gateway-response-v1";
const RFC3339_INSTANT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const ALLOWED_CONTENT_TYPES = new Set([
  "application/dicom",
  "application/json",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "image/jpeg",
  "image/png",
  "text/csv",
  "text/plain"
]);
const CLASSIFICATIONS = new Set(["internal", "clinical", "sensitive", "evidence"]);
const RETENTION_POLICIES = Object.freeze({
  temporary: { years: 1, immutable: false },
  "clinical-record": { years: 15, immutable: true },
  "medical-consent": { years: 15, immutable: true },
  "audit-evidence": { years: 10, immutable: true }
});

function isProduction(env = process.env) {
  return String(env.NODE_ENV || "").toLowerCase() === "production";
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(parsed)));
}

function objectStorageError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function secretReady(value) {
  const candidate = String(value || "").trim();
  return candidate.length >= 32
    && !/replace-with|change-me|changeme|placeholder|example|demo[-_]/i.test(candidate);
}

function parseAllowedOrigins(value, production) {
  const entries = String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
  const origins = [];
  let valid = entries.length > 0;
  for (const entry of entries) {
    try {
      if (entry.includes("*")) throw new Error("wildcard origin is not allowed");
      const url = new URL(entry);
      if (!new Set(["http:", "https:"]).has(url.protocol)) throw new Error("invalid origin protocol");
      if (production && url.protocol !== "https:") throw new Error("production origin must use HTTPS");
      if (url.username || url.password || (url.pathname && url.pathname !== "/") || url.search || url.hash) {
        throw new Error("origin must not contain credentials, path, query or fragment");
      }
      if (!origins.includes(url.origin)) origins.push(url.origin);
    } catch {
      valid = false;
    }
  }
  return { configured: entries.length > 0, valid: valid && origins.length > 0, origins };
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function validatedGatewayUrl(value, env = process.env, options = {}) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    throw new Error("OBJECT_STORAGE_GATEWAY_URL must be a valid URL");
  }
  if (!new Set(["http:", "https:"]).has(url.protocol)) throw new Error("OBJECT_STORAGE_GATEWAY_URL must use HTTP or HTTPS");
  if (isProduction(env) && url.protocol !== "https:") throw new Error("OBJECT_STORAGE_GATEWAY_URL must use HTTPS in production");
  if (options.base && (url.username || url.password || url.search || url.hash)) {
    throw new Error("OBJECT_STORAGE_GATEWAY_URL must not contain credentials, query or fragment");
  }
  return url;
}

function objectStorageConfiguration(env = process.env) {
  const production = isProduction(env);
  const gatewayUrl = String(env.OBJECT_STORAGE_GATEWAY_URL || "").trim();
  const bucket = String(env.OBJECT_STORAGE_BUCKET || "").trim();
  const signingSecret = String(env.OBJECT_STORAGE_SIGNING_SECRET || "").trim();
  const receiptSigningSecret = String(env.OBJECT_STORAGE_RECEIPT_SIGNING_SECRET || "").trim();
  const token = String(env.OBJECT_STORAGE_TOKEN || "").trim();
  const contractVersion = String(env.OBJECT_STORAGE_GATEWAY_CONTRACT_VERSION || "").trim().toLowerCase();
  const uploadOrigins = parseAllowedOrigins(env.OBJECT_STORAGE_UPLOAD_URL_ALLOWED_ORIGINS, production);
  const downloadOrigins = parseAllowedOrigins(env.OBJECT_STORAGE_DOWNLOAD_URL_ALLOWED_ORIGINS, production);
  let gatewayUrlValid = false;
  if (gatewayUrl) {
    try {
      validatedGatewayUrl(gatewayUrl, env, { base: true });
      gatewayUrlValid = true;
    } catch {
      gatewayUrlValid = false;
    }
  }
  const trustRequired = production || contractVersion === GATEWAY_TRUST_VERSION;
  const requestSecretReady = secretReady(signingSecret);
  const receiptSecretReady = secretReady(receiptSigningSecret);
  const distinctDirectionKeys = requestSecretReady && receiptSecretReady && signingSecret !== receiptSigningSecret;
  const trustContractReady = contractVersion === GATEWAY_TRUST_VERSION
    && uploadOrigins.valid
    && downloadOrigins.valid
    && distinctDirectionKeys;
  return {
    configured: Boolean(gatewayUrl && bucket && signingSecret),
    gatewayConfigured: Boolean(gatewayUrl),
    gatewayUrlValid,
    bucketConfigured: Boolean(bucket),
    signingSecretConfigured: Boolean(signingSecret),
    receiptSigningSecretConfigured: Boolean(receiptSigningSecret),
    bearerTokenConfigured: Boolean(token),
    productionHttps: !production || !gatewayUrl || /^https:\/\//i.test(gatewayUrl),
    contractVersion,
    trustRequired,
    trustContractReady,
    requestSecretReady,
    receiptSecretReady,
    distinctDirectionKeys,
    uploadOriginsConfigured: uploadOrigins.configured,
    uploadOriginsValid: uploadOrigins.valid,
    uploadOriginCount: uploadOrigins.origins.length,
    downloadOriginsConfigured: downloadOrigins.configured,
    downloadOriginsValid: downloadOrigins.valid,
    downloadOriginCount: downloadOrigins.origins.length,
    timeoutMs: boundedInteger(env.OBJECT_STORAGE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 1000, 30000),
    maximumBytes: boundedInteger(env.OBJECT_STORAGE_MAX_BYTES, DEFAULT_MAX_BYTES, 1024, 2 * 1024 * 1024 * 1024),
    uploadTtlSeconds: boundedInteger(env.OBJECT_STORAGE_UPLOAD_TTL_SECONDS, DEFAULT_UPLOAD_TTL_SECONDS, 60, 3600),
    downloadTtlSeconds: boundedInteger(env.OBJECT_STORAGE_DOWNLOAD_TTL_SECONDS, 300, 30, 900),
    responseMaxSkewSeconds: boundedInteger(env.OBJECT_STORAGE_RESPONSE_MAX_SKEW_SECONDS, DEFAULT_RESPONSE_MAX_SKEW_SECONDS, 30, 900),
    gatewayUrl,
    bucket,
    signingSecret,
    receiptSigningSecret,
    uploadAllowedOrigins: uploadOrigins.origins,
    downloadAllowedOrigins: downloadOrigins.origins,
    token
  };
}

function objectStorageCenter(env = process.env) {
  const configuration = objectStorageConfiguration(env);
  const {
    gatewayUrl,
    bucket,
    signingSecret,
    receiptSigningSecret,
    uploadAllowedOrigins,
    downloadAllowedOrigins,
    token,
    ...publicConfiguration
  } = configuration;
  const adapterReady = configuration.configured
    && configuration.gatewayUrlValid
    && configuration.productionHttps
    && (!configuration.trustRequired || configuration.trustContractReady);
  return {
    generatedAt: new Date().toISOString(),
    production: isProduction(env),
    adapterReady,
    productionReady: false,
    configuration: publicConfiguration,
    controls: {
      directBinaryThroughPlatform: false,
      checksumRequired: true,
      serverSideMalwareScanRequired: true,
      shortLivedDownloadIntent: true,
      immutableRetentionPolicies: Object.entries(RETENTION_POLICIES).filter(([, value]) => value.immutable).map(([key]) => key)
    },
    blockers: [
      ...(!configuration.gatewayConfigured ? ["object storage gateway URL"] : []),
      ...(configuration.gatewayConfigured && !configuration.gatewayUrlValid ? ["valid object storage gateway URL without credentials, query or fragment"] : []),
      ...(!configuration.bucketConfigured ? ["object storage bucket"] : []),
      ...(!configuration.signingSecretConfigured ? ["object storage signing secret"] : []),
      ...(!configuration.productionHttps ? ["object storage HTTPS endpoint"] : []),
      ...(configuration.trustRequired && configuration.contractVersion !== GATEWAY_TRUST_VERSION ? ["object storage gateway trust v1 contract"] : []),
      ...(configuration.trustRequired && !configuration.receiptSecretReady ? ["independent object storage receipt signing secret"] : []),
      ...(configuration.trustRequired && !configuration.distinctDirectionKeys ? ["separate object storage request and receipt keys"] : []),
      ...(configuration.trustRequired && !configuration.uploadOriginsValid ? ["upload signed URL exact-origin allowlist"] : []),
      ...(configuration.trustRequired && !configuration.downloadOriginsValid ? ["download signed URL exact-origin allowlist"] : []),
      "real bucket policy, malware engine, retention lock, backup and site acceptance evidence"
    ]
  };
}

function sanitizeFilename(value) {
  const filename = String(value || "").trim();
  if (!filename || filename.length > 180) throw new Error("attachment filename is required and must be at most 180 characters");
  if (/[\\/\0]/.test(filename) || filename === "." || filename === "..") throw new Error("attachment filename contains an invalid path segment");
  return filename.replace(/[\r\n\t]/g, "_");
}

function validateAttachmentMetadata(input, env = process.env) {
  const configuration = objectStorageConfiguration(env);
  const filename = sanitizeFilename(input.filename);
  const contentType = String(input.contentType || "").trim().toLowerCase();
  const sizeBytes = Number(input.sizeBytes);
  const checksumSha256 = String(input.checksumSha256 || "").trim().toLowerCase().replace(/^sha256:/, "");
  const classification = String(input.classification || "sensitive").trim().toLowerCase();
  const retentionPolicy = String(input.retentionPolicy || "clinical-record").trim().toLowerCase();
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) throw new Error(`attachment content type is not allowed: ${contentType || "missing"}`);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > configuration.maximumBytes) throw new Error(`attachment size must be between 1 and ${configuration.maximumBytes} bytes`);
  if (!/^[a-f0-9]{64}$/.test(checksumSha256)) throw new Error("attachment SHA-256 checksum must be 64 lowercase hexadecimal characters");
  if (!CLASSIFICATIONS.has(classification)) throw new Error("attachment classification is invalid");
  if (!RETENTION_POLICIES[retentionPolicy]) throw new Error("attachment retention policy is invalid");
  return {
    filename,
    contentType,
    sizeBytes,
    checksumSha256,
    classification,
    retentionPolicy,
    retentionYears: RETENTION_POLICIES[retentionPolicy].years,
    immutable: RETENTION_POLICIES[retentionPolicy].immutable
  };
}

function buildObjectKey(input) {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "/");
  const extension = input.filename.includes(".") ? input.filename.slice(input.filename.lastIndexOf(".")).toLowerCase().replace(/[^a-z0-9.]/g, "") : "";
  const namespace = String(input.namespace || "attachments").toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").slice(0, 48) || "attachments";
  return `${namespace}/${date}/${input.attachmentId}${extension}`;
}

function signGatewayRequest(bodyText, secret, timestamp, requestId) {
  const digest = createHash("sha256").update(bodyText).digest("hex");
  return createHmac("sha256", secret).update(`${timestamp}\n${requestId}\n${digest}`).digest("hex");
}

function signGatewayResponse(bodyText, secret, input = {}) {
  const digest = createHash("sha256").update(bodyText).digest("hex");
  const canonical = [
    "object-storage-response-v1",
    String(input.operation || ""),
    String(input.status || ""),
    String(input.timestamp || ""),
    String(input.requestId || ""),
    digest
  ].join("\n");
  return createHmac("sha256", secret).update(canonical).digest("hex");
}

function safeSignatureEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""), "utf8");
  const rightBuffer = Buffer.from(String(right || ""), "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function trustedNow(value) {
  const now = value instanceof Date ? new Date(value.getTime()) : new Date(value === undefined ? Date.now() : value);
  if (!Number.isFinite(now.getTime())) throw objectStorageError("OBJECT_STORAGE_TIME_INVALID", "object storage trusted time is invalid");
  return now;
}

function parseRfc3339Instant(value) {
  if (typeof value !== "string") return null;
  const match = RFC3339_INSTANT_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const daysInMonth = month >= 1 && month <= 12 ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 0;
  if (day < 1 || day > daysInMonth || hour > 23 || minute > 59 || second > 59) return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds) : null;
}

function responseHeader(response, name) {
  if (!response?.headers || typeof response.headers.get !== "function") return "";
  return String(response.headers.get(name) || "").trim();
}

function verifyGatewayResponse(response, bodyText, input) {
  const contractVersion = responseHeader(response, "x-object-storage-contract");
  const responseRequestId = responseHeader(response, "x-request-id");
  const timestamp = responseHeader(response, "x-timestamp");
  const algorithm = responseHeader(response, "x-signature-algorithm");
  const signature = responseHeader(response, "x-signature").toLowerCase();
  if (contractVersion !== GATEWAY_TRUST_VERSION || algorithm !== "HMAC-SHA256") {
    throw objectStorageError("OBJECT_STORAGE_RESPONSE_CONTRACT_INVALID", "object storage gateway response contract is invalid");
  }
  if (responseRequestId !== input.requestId) {
    throw objectStorageError("OBJECT_STORAGE_RESPONSE_REQUEST_MISMATCH", "object storage gateway response request binding is invalid");
  }
  const responseTime = parseRfc3339Instant(timestamp);
  const maximumSkewMs = input.maximumSkewSeconds * 1000;
  if (!responseTime || Math.abs(input.now.getTime() - responseTime.getTime()) > maximumSkewMs) {
    throw objectStorageError("OBJECT_STORAGE_RESPONSE_STALE", "object storage gateway response timestamp is outside the allowed window");
  }
  if (!/^[a-f0-9]{64}$/.test(signature)) {
    throw objectStorageError("OBJECT_STORAGE_RESPONSE_SIGNATURE_INVALID", "object storage gateway response signature is invalid");
  }
  const expected = signGatewayResponse(bodyText, input.secret, {
    operation: input.operation,
    status: response.status,
    timestamp,
    requestId: input.requestId
  });
  if (!safeSignatureEqual(signature, expected)) {
    throw objectStorageError("OBJECT_STORAGE_RESPONSE_SIGNATURE_INVALID", "object storage gateway response signature is invalid");
  }
  return Object.freeze({
    contractVersion,
    requestId: responseRequestId,
    timestamp,
    payloadSha256: createHash("sha256").update(bodyText).digest("hex")
  });
}

function assertGatewayBodyBindings(body, operation, envelope) {
  const bindings = [
    ["schemaVersion", GATEWAY_RESPONSE_SCHEMA],
    ["requestId", envelope.requestId],
    ["operation", operation],
    ["bucket", envelope.bucket],
    ["attachmentId", envelope.attachmentId],
    ["objectKey", envelope.objectKey]
  ];
  if (Object.prototype.hasOwnProperty.call(envelope, "objectVersion")) bindings.push(["objectVersion", envelope.objectVersion]);
  const mismatch = bindings.find(([field, expected]) => typeof body?.[field] !== "string" || body[field] !== String(expected || ""));
  if (mismatch) {
    throw objectStorageError(
      "OBJECT_STORAGE_RESPONSE_BINDING_INVALID",
      `object storage gateway response ${mismatch[0]} binding is invalid`
    );
  }
}

async function readGatewayResponseText(response, options = {}) {
  const maximumBytes = options.maximumBytes || MAX_GATEWAY_RESPONSE_BYTES;
  const body = response && response.body;
  if (!body || typeof body.getReader !== "function") {
    if (options.requireStream) {
      throw objectStorageError("OBJECT_STORAGE_GATEWAY_RESPONSE_STREAM_REQUIRED", "object storage gateway response stream is unavailable");
    }
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maximumBytes) {
      throw objectStorageError("OBJECT_STORAGE_GATEWAY_RESPONSE_TOO_LARGE", "object storage gateway response exceeds size limit");
    }
    return text;
  }

  const reader = body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        throw objectStorageError("OBJECT_STORAGE_GATEWAY_RESPONSE_INVALID", "object storage gateway response stream is invalid");
      }
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        try {
          await reader.cancel("object storage gateway response exceeds size limit");
        } catch {
          // The size-limit failure remains authoritative if cancellation also fails.
        }
        throw objectStorageError("OBJECT_STORAGE_GATEWAY_RESPONSE_TOO_LARGE", "object storage gateway response exceeds size limit");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, totalBytes).toString("utf8");
}

function validateSignedIntentUrl(input, options = {}) {
  const url = validatedGatewayUrl(input.url, { NODE_ENV: options.production ? "production" : "test" });
  if (url.username || url.password || url.hash) {
    throw objectStorageError("OBJECT_STORAGE_SIGNED_URL_INVALID", "object storage signed URL contains credentials or a fragment");
  }
  if (!options.allowedOrigins.includes(url.origin)) {
    throw objectStorageError("OBJECT_STORAGE_SIGNED_URL_ORIGIN_DENIED", "object storage signed URL origin is not allowed");
  }
  const expiresAt = parseRfc3339Instant(input.expiresAt);
  const maximumExpiry = options.requestedAt.getTime() + (options.maximumTtlSeconds * 1000) + (options.maximumSkewSeconds * 1000);
  if (!expiresAt || expiresAt.getTime() <= options.now.getTime() || expiresAt.getTime() > maximumExpiry) {
    throw objectStorageError("OBJECT_STORAGE_INTENT_EXPIRY_INVALID", "object storage signed URL intent expiry is invalid");
  }
  return { url: url.toString(), expiresAt: expiresAt.toISOString() };
}

async function gatewayRequest(operation, payload, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("fetch runtime is unavailable");
  const configuration = objectStorageConfiguration(env);
  if (!configuration.configured) throw new Error("object storage adapter is not configured");
  if (!configuration.productionHttps) throw new Error("OBJECT_STORAGE_GATEWAY_URL must use HTTPS in production");
  if (configuration.trustRequired && !configuration.trustContractReady) {
    throw objectStorageError("OBJECT_STORAGE_TRUST_CONTRACT_NOT_READY", "object storage gateway trust contract is not ready");
  }
  const gatewayUrl = validatedGatewayUrl(configuration.gatewayUrl, env, { base: true });
  const base = gatewayUrl.toString().endsWith("/") ? gatewayUrl.toString() : `${gatewayUrl}/`;
  const endpoint = new URL(String(operation).replace(/^\//, ""), base).toString();
  const requestId = String(options.requestId || randomUUID());
  const now = trustedNow(options.now);
  const timestamp = now.toISOString();
  const envelope = {
    ...payload,
    bucket: configuration.bucket,
    requestId,
    requestedAt: timestamp,
    ...(configuration.trustRequired ? { contractVersion: GATEWAY_TRUST_VERSION, operation } : {})
  };
  const bodyText = stableStringify(envelope);
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-Request-Id": requestId,
    "X-Timestamp": timestamp,
    "X-Signature-Algorithm": "HMAC-SHA256",
    "X-Signature": signGatewayRequest(bodyText, configuration.signingSecret, timestamp, requestId)
  };
  if (configuration.token) headers.Authorization = `Bearer ${configuration.token}`;
  if (configuration.trustRequired) headers["X-Object-Storage-Contract"] = GATEWAY_TRUST_VERSION;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), configuration.timeoutMs);
  try {
    const response = await fetchImpl(endpoint, { method: "POST", headers, body: bodyText, signal: controller.signal, redirect: "error" });
    const text = await readGatewayResponseText(response, { requireStream: configuration.trustRequired });
    const verifiedReceipt = configuration.trustRequired
      ? verifyGatewayResponse(response, text, {
        operation,
        requestId,
        secret: configuration.receiptSigningSecret,
        now,
        maximumSkewSeconds: configuration.responseMaxSkewSeconds
      })
      : null;
    let body = {};
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        throw new Error(`object storage gateway returned non-JSON response (${response.status})`);
      }
    }
    if (!response.ok) {
      if (configuration.trustRequired) throw objectStorageError("OBJECT_STORAGE_GATEWAY_REQUEST_FAILED", `object storage gateway request failed (HTTP ${response.status})`);
      throw new Error(`object storage gateway request failed: ${body.message || body.error || `HTTP ${response.status}`}`);
    }
    if (configuration.trustRequired) assertGatewayBodyBindings(body, operation, envelope);
    return { body, requestId, endpoint, requestedAt: timestamp, verifiedReceipt, trustVerified: Boolean(verifiedReceipt) };
  } catch (error) {
    if (error.name === "AbortError") throw new Error(`object storage gateway request timed out after ${configuration.timeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function createObjectUploadIntent(input, options = {}) {
  const env = options.env || process.env;
  const configuration = objectStorageConfiguration(env);
  const metadata = validateAttachmentMetadata(input, env);
  const attachmentId = String(input.attachmentId || randomUUID());
  const objectKey = buildObjectKey({ ...metadata, attachmentId, namespace: input.namespace });
  const { body, requestId, requestedAt } = await gatewayRequest("upload-intents", {
    attachmentId,
    objectKey,
    contentType: metadata.contentType,
    sizeBytes: metadata.sizeBytes,
    checksumSha256: metadata.checksumSha256,
    classification: metadata.classification,
    retentionPolicy: metadata.retentionPolicy,
    retentionYears: metadata.retentionYears,
    immutable: metadata.immutable,
    expiresInSeconds: configuration.uploadTtlSeconds
  }, options);
  const uploadId = configuration.trustRequired
    ? (typeof body.uploadId === "string" ? body.uploadId.trim() : "")
    : String(body.uploadId || body.intentId || "").trim();
  const uploadUrl = configuration.trustRequired
    ? (typeof body.uploadUrl === "string" ? body.uploadUrl.trim() : "")
    : String(body.uploadUrl || "").trim();
  const expiresAt = configuration.trustRequired
    ? (typeof body.expiresAt === "string" ? body.expiresAt.trim() : "")
    : String(body.expiresAt || "").trim();
  if (!uploadId || !uploadUrl || !expiresAt) throw new Error("object storage gateway upload intent is incomplete");
  const signedIntent = configuration.trustRequired
    ? validateSignedIntentUrl({ url: uploadUrl, expiresAt }, {
      allowedOrigins: configuration.uploadAllowedOrigins,
      requestedAt: new Date(requestedAt),
      now: trustedNow(options.now),
      maximumTtlSeconds: configuration.uploadTtlSeconds,
      maximumSkewSeconds: configuration.responseMaxSkewSeconds,
      production: isProduction(env)
    })
    : { url: validatedGatewayUrl(uploadUrl, env).toString(), expiresAt };
  return {
    attachmentId,
    objectKey,
    uploadId,
    uploadUrl: signedIntent.url,
    expiresAt: signedIntent.expiresAt,
    requestId,
    metadata,
    adapter: "object-storage-gateway"
  };
}

async function finalizeObjectUpload(input, options = {}) {
  const configuration = objectStorageConfiguration(options.env || process.env);
  const { body, requestId, requestedAt } = await gatewayRequest("objects/complete", {
    attachmentId: input.attachmentId,
    uploadId: input.uploadId,
    objectKey: input.objectKey,
    expectedSizeBytes: input.expectedSizeBytes,
    expectedChecksumSha256: input.expectedChecksumSha256
  }, options);
  const actualChecksumSha256 = (configuration.trustRequired && typeof body.checksumSha256 !== "string"
    ? ""
    : String(body.checksumSha256 || "")).trim().toLowerCase().replace(/^sha256:/, "");
  const actualSizeBytes = configuration.trustRequired ? body.sizeBytes : Number(body.sizeBytes);
  const scanStatus = (configuration.trustRequired && typeof body.scanStatus !== "string"
    ? ""
    : String(body.scanStatus || "")).trim().toLowerCase();
  if (actualChecksumSha256 !== String(input.expectedChecksumSha256 || "").toLowerCase()) throw new Error("object storage checksum verification failed");
  if (!Number.isSafeInteger(actualSizeBytes) || actualSizeBytes !== Number(input.expectedSizeBytes)) throw new Error("object storage size verification failed");
  if (scanStatus !== "clean") throw objectStorageError("OBJECT_STORAGE_MALWARE_SCAN_NOT_CLEAN", "object storage malware scan did not pass");
  const objectVersion = configuration.trustRequired
    ? (typeof body.objectVersion === "string" ? body.objectVersion.trim() : "")
    : String(body.objectVersion || body.versionId || "").trim();
  const scannedAt = configuration.trustRequired && typeof body.scannedAt !== "string" ? "" : String(body.scannedAt || "").trim();
  const scanReceiptId = configuration.trustRequired && typeof body.scanReceiptId !== "string" ? "" : String(body.scanReceiptId || "").trim();
  if (configuration.trustRequired) {
    const scanTime = parseRfc3339Instant(scannedAt);
    const requestTime = new Date(requestedAt);
    const now = trustedNow(options.now);
    const skewMs = configuration.responseMaxSkewSeconds * 1000;
    if (typeof body.uploadId !== "string" || body.uploadId !== String(input.uploadId || "")
      || !objectVersion
      || !scanReceiptId
      || !scanTime
      || scanTime.getTime() < requestTime.getTime() - skewMs
      || scanTime.getTime() > now.getTime() + skewMs) {
      throw objectStorageError("OBJECT_STORAGE_COMPLETION_RECEIPT_INVALID", "object storage completion receipt is incomplete or unbound");
    }
  }
  return {
    requestId,
    objectVersion,
    checksumSha256: actualChecksumSha256,
    sizeBytes: actualSizeBytes,
    scanStatus,
    scannedAt: scannedAt || new Date().toISOString(),
    status: "active",
    adapter: "object-storage-gateway"
  };
}

async function createObjectDownloadIntent(input, options = {}) {
  const configuration = objectStorageConfiguration(options.env || process.env);
  const objectVersion = configuration.trustRequired
    ? (typeof input.objectVersion === "string" ? input.objectVersion.trim() : "")
    : String(input.objectVersion || "");
  if (configuration.trustRequired && !objectVersion) {
    throw objectStorageError("OBJECT_STORAGE_OBJECT_VERSION_REQUIRED", "object storage object version is required");
  }
  const { body, requestId, requestedAt } = await gatewayRequest("download-intents", {
    attachmentId: input.attachmentId,
    objectKey: input.objectKey,
    objectVersion,
    expiresInSeconds: configuration.downloadTtlSeconds
  }, options);
  const downloadUrl = configuration.trustRequired && typeof body.downloadUrl !== "string" ? "" : String(body.downloadUrl || "").trim();
  const expiresAt = configuration.trustRequired && typeof body.expiresAt !== "string" ? "" : String(body.expiresAt || "").trim();
  if (!downloadUrl || !expiresAt) throw new Error("object storage gateway download intent is incomplete");
  const signedIntent = configuration.trustRequired
    ? validateSignedIntentUrl({ url: downloadUrl, expiresAt }, {
      allowedOrigins: configuration.downloadAllowedOrigins,
      requestedAt: new Date(requestedAt),
      now: trustedNow(options.now),
      maximumTtlSeconds: configuration.downloadTtlSeconds,
      maximumSkewSeconds: configuration.responseMaxSkewSeconds,
      production: isProduction(options.env || process.env)
    })
    : { url: validatedGatewayUrl(downloadUrl, options.env || process.env).toString(), expiresAt };
  return {
    requestId,
    downloadUrl: signedIntent.url,
    expiresAt: signedIntent.expiresAt,
    attachmentId: input.attachmentId,
    adapter: "object-storage-gateway"
  };
}

async function applyObjectLifecycle(input, options = {}) {
  const action = String(input.action || "").trim().toLowerCase();
  if (!["quarantine", "legal-hold", "release-hold", "delete"].includes(action)) throw new Error("unsupported object lifecycle action");
  const configuration = objectStorageConfiguration(options.env || process.env);
  const objectVersion = configuration.trustRequired
    ? (typeof input.objectVersion === "string" ? input.objectVersion.trim() : "")
    : String(input.objectVersion || "");
  if (configuration.trustRequired && action !== "quarantine" && !objectVersion) {
    throw objectStorageError("OBJECT_STORAGE_OBJECT_VERSION_REQUIRED", "object storage object version is required");
  }
  const { body, requestId, requestedAt } = await gatewayRequest("objects/lifecycle", {
    attachmentId: input.attachmentId,
    objectKey: input.objectKey,
    objectVersion,
    action,
    reason: String(input.reason || "").trim()
  }, options);
  const status = configuration.trustRequired && typeof body.status !== "string" ? "" : String(body.status || "").trim().toLowerCase();
  const receiptId = configuration.trustRequired && typeof body.receiptId !== "string" ? "" : String(body.receiptId || "").trim();
  const effectiveAt = configuration.trustRequired && typeof body.effectiveAt !== "string" ? "" : String(body.effectiveAt || "").trim();
  const accepted = configuration.trustRequired
    ? body.accepted === true && status === "applied"
    : body.accepted !== false && !["rejected", "failed", "denied"].includes(status);
  if (configuration.trustRequired) {
    const effectiveTime = parseRfc3339Instant(effectiveAt);
    const requestTime = new Date(requestedAt);
    const now = trustedNow(options.now);
    const skewMs = configuration.responseMaxSkewSeconds * 1000;
    if (!accepted
      || typeof body.action !== "string"
      || body.action !== action
      || !receiptId
      || !effectiveTime
      || effectiveTime.getTime() < requestTime.getTime() - skewMs
      || effectiveTime.getTime() > now.getTime() + skewMs) {
      throw objectStorageError("OBJECT_STORAGE_LIFECYCLE_RECEIPT_INVALID", "object storage lifecycle receipt is incomplete or unbound");
    }
  }
  if (!accepted) throw new Error(`object storage lifecycle action was rejected (${body.status || "rejected"})`);
  return {
    requestId,
    action,
    status: status || "accepted",
    effectiveAt: effectiveAt || new Date().toISOString(),
    adapter: "object-storage-gateway"
  };
}

module.exports = {
  ALLOWED_CONTENT_TYPES,
  RETENTION_POLICIES,
  applyObjectLifecycle,
  buildObjectKey,
  createObjectDownloadIntent,
  createObjectUploadIntent,
  finalizeObjectUpload,
  objectStorageCenter,
  objectStorageConfiguration,
  signGatewayRequest,
  signGatewayResponse,
  stableStringify,
  validateSignedIntentUrl,
  validateAttachmentMetadata
};
