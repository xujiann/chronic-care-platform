const { createHash, createHmac, randomUUID } = require("node:crypto");

const DEFAULT_MAX_BYTES = 100 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 8000;
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

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function validatedGatewayUrl(value, env = process.env) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    throw new Error("OBJECT_STORAGE_GATEWAY_URL must be a valid URL");
  }
  if (!new Set(["http:", "https:"]).has(url.protocol)) throw new Error("OBJECT_STORAGE_GATEWAY_URL must use HTTP or HTTPS");
  if (isProduction(env) && url.protocol !== "https:") throw new Error("OBJECT_STORAGE_GATEWAY_URL must use HTTPS in production");
  return url;
}

function objectStorageConfiguration(env = process.env) {
  const gatewayUrl = String(env.OBJECT_STORAGE_GATEWAY_URL || "").trim();
  const bucket = String(env.OBJECT_STORAGE_BUCKET || "").trim();
  const signingSecret = String(env.OBJECT_STORAGE_SIGNING_SECRET || "").trim();
  const token = String(env.OBJECT_STORAGE_TOKEN || "").trim();
  return {
    configured: Boolean(gatewayUrl && bucket && signingSecret),
    gatewayConfigured: Boolean(gatewayUrl),
    bucketConfigured: Boolean(bucket),
    signingSecretConfigured: Boolean(signingSecret),
    bearerTokenConfigured: Boolean(token),
    productionHttps: !isProduction(env) || !gatewayUrl || /^https:\/\//i.test(gatewayUrl),
    timeoutMs: boundedInteger(env.OBJECT_STORAGE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 1000, 30000),
    maximumBytes: boundedInteger(env.OBJECT_STORAGE_MAX_BYTES, DEFAULT_MAX_BYTES, 1024, 2 * 1024 * 1024 * 1024),
    downloadTtlSeconds: boundedInteger(env.OBJECT_STORAGE_DOWNLOAD_TTL_SECONDS, 300, 30, 900),
    gatewayUrl,
    bucket,
    signingSecret,
    token
  };
}

function objectStorageCenter(env = process.env) {
  const configuration = objectStorageConfiguration(env);
  const { gatewayUrl, bucket, signingSecret, token, ...publicConfiguration } = configuration;
  const adapterReady = configuration.configured && configuration.productionHttps;
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
      ...(!configuration.bucketConfigured ? ["object storage bucket"] : []),
      ...(!configuration.signingSecretConfigured ? ["object storage signing secret"] : []),
      ...(!configuration.productionHttps ? ["object storage HTTPS endpoint"] : []),
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

async function gatewayRequest(operation, payload, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("fetch runtime is unavailable");
  const configuration = objectStorageConfiguration(env);
  if (!configuration.configured) throw new Error("object storage adapter is not configured");
  if (!configuration.productionHttps) throw new Error("OBJECT_STORAGE_GATEWAY_URL must use HTTPS in production");
  const gatewayUrl = validatedGatewayUrl(configuration.gatewayUrl, env);
  const base = gatewayUrl.toString().endsWith("/") ? gatewayUrl.toString() : `${gatewayUrl}/`;
  const endpoint = new URL(String(operation).replace(/^\//, ""), base).toString();
  const requestId = String(options.requestId || randomUUID());
  const timestamp = new Date().toISOString();
  const envelope = { bucket: configuration.bucket, requestId, requestedAt: timestamp, ...payload };
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), configuration.timeoutMs);
  try {
    const response = await fetchImpl(endpoint, { method: "POST", headers, body: bodyText, signal: controller.signal });
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > 1024 * 1024) throw new Error("object storage gateway response exceeds size limit");
    let body = {};
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        throw new Error(`object storage gateway returned non-JSON response (${response.status})`);
      }
    }
    if (!response.ok) throw new Error(`object storage gateway request failed: ${body.message || body.error || `HTTP ${response.status}`}`);
    return { body, requestId, endpoint };
  } catch (error) {
    if (error.name === "AbortError") throw new Error(`object storage gateway request timed out after ${configuration.timeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function createObjectUploadIntent(input, options = {}) {
  const env = options.env || process.env;
  const metadata = validateAttachmentMetadata(input, env);
  const attachmentId = String(input.attachmentId || randomUUID());
  const objectKey = buildObjectKey({ ...metadata, attachmentId, namespace: input.namespace });
  const { body, requestId } = await gatewayRequest("upload-intents", {
    attachmentId,
    objectKey,
    contentType: metadata.contentType,
    sizeBytes: metadata.sizeBytes,
    checksumSha256: metadata.checksumSha256,
    classification: metadata.classification,
    retentionPolicy: metadata.retentionPolicy,
    retentionYears: metadata.retentionYears,
    immutable: metadata.immutable
  }, options);
  const uploadId = String(body.uploadId || body.intentId || "").trim();
  const uploadUrl = String(body.uploadUrl || "").trim();
  const expiresAt = String(body.expiresAt || "").trim();
  if (!uploadId || !uploadUrl || !expiresAt) throw new Error("object storage gateway upload intent is incomplete");
  const parsedUploadUrl = validatedGatewayUrl(uploadUrl, env);
  return {
    attachmentId,
    objectKey,
    uploadId,
    uploadUrl: parsedUploadUrl.toString(),
    expiresAt,
    requestId,
    metadata,
    adapter: "object-storage-gateway"
  };
}

async function finalizeObjectUpload(input, options = {}) {
  const { body, requestId } = await gatewayRequest("objects/complete", {
    attachmentId: input.attachmentId,
    uploadId: input.uploadId,
    objectKey: input.objectKey,
    expectedSizeBytes: input.expectedSizeBytes,
    expectedChecksumSha256: input.expectedChecksumSha256
  }, options);
  const actualChecksumSha256 = String(body.checksumSha256 || "").trim().toLowerCase().replace(/^sha256:/, "");
  const actualSizeBytes = Number(body.sizeBytes);
  const scanStatus = String(body.scanStatus || "").trim().toLowerCase();
  if (actualChecksumSha256 !== String(input.expectedChecksumSha256 || "").toLowerCase()) throw new Error("object storage checksum verification failed");
  if (actualSizeBytes !== Number(input.expectedSizeBytes)) throw new Error("object storage size verification failed");
  if (scanStatus !== "clean") throw new Error(`object storage malware scan did not pass (${scanStatus || "missing"})`);
  return {
    requestId,
    objectVersion: String(body.objectVersion || body.versionId || "").trim(),
    checksumSha256: actualChecksumSha256,
    sizeBytes: actualSizeBytes,
    scanStatus,
    scannedAt: String(body.scannedAt || new Date().toISOString()),
    status: "active",
    adapter: "object-storage-gateway"
  };
}

async function createObjectDownloadIntent(input, options = {}) {
  const configuration = objectStorageConfiguration(options.env || process.env);
  const { body, requestId } = await gatewayRequest("download-intents", {
    attachmentId: input.attachmentId,
    objectKey: input.objectKey,
    objectVersion: input.objectVersion || "",
    expiresInSeconds: configuration.downloadTtlSeconds
  }, options);
  const downloadUrl = String(body.downloadUrl || "").trim();
  const expiresAt = String(body.expiresAt || "").trim();
  if (!downloadUrl || !expiresAt) throw new Error("object storage gateway download intent is incomplete");
  return {
    requestId,
    downloadUrl: validatedGatewayUrl(downloadUrl, options.env || process.env).toString(),
    expiresAt,
    attachmentId: input.attachmentId,
    adapter: "object-storage-gateway"
  };
}

async function applyObjectLifecycle(input, options = {}) {
  const action = String(input.action || "").trim().toLowerCase();
  if (!["quarantine", "legal-hold", "release-hold", "delete"].includes(action)) throw new Error("unsupported object lifecycle action");
  const { body, requestId } = await gatewayRequest("objects/lifecycle", {
    attachmentId: input.attachmentId,
    objectKey: input.objectKey,
    objectVersion: input.objectVersion || "",
    action,
    reason: String(input.reason || "").trim()
  }, options);
  const accepted = body.accepted !== false && !["rejected", "failed", "denied"].includes(String(body.status || "").toLowerCase());
  if (!accepted) throw new Error(`object storage lifecycle action was rejected (${body.status || "rejected"})`);
  return {
    requestId,
    action,
    status: String(body.status || "accepted").toLowerCase(),
    effectiveAt: String(body.effectiveAt || new Date().toISOString()),
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
  stableStringify,
  validateAttachmentMetadata
};
