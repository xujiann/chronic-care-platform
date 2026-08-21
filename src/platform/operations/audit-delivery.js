"use strict";

const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");
const { createHash, createHmac } = require("node:crypto");
const { appendPilotCutoverAlertEvent } = require("../cutover/pilot-cutover-alert-lifecycle");

const MAX_RECEIPT_BYTES = 64 * 1024;
const MAX_TLS_FILE_BYTES = 2 * 1024 * 1024;
const SAFE_BATCH_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function deliveryError(code, message, retryable = false) {
  return Object.assign(new Error(message), { code, retryable });
}

function buildAuditBatch(records = [], options = {}) {
  const normalized = records.map((item) => ({ trail: String(item.trail || ""), record: item.record }));
  const payload = stableStringify({ schemaVersion: "audit-delivery-v1", records: normalized });
  const digest = sha256(payload);
  const batchId = options.batchId || `audit-${digest.slice(0, 32)}`;
  if (!SAFE_BATCH_ID.test(batchId)) throw deliveryError("AUDIT_BATCH_ID_INVALID", "audit batch id is invalid");
  return Object.freeze({ schemaVersion: "audit-delivery-v1", batchId, createdAt: options.createdAt || new Date().toISOString(), recordCount: normalized.length, payload, digest });
}

function assertTlsVerification(env = {}) {
  if (String(env.NODE_TLS_REJECT_UNAUTHORIZED || "").trim() === "0"
    || /^(?:0|false|off|no)$/i.test(String(env.SIEM_AUDIT_TLS_REJECT_UNAUTHORIZED || "").trim())) {
    throw deliveryError("AUDIT_TLS_VERIFICATION_DISABLED", "SIEM audit TLS verification cannot be disabled");
  }
}

function readTlsMaterial(file, label, production) {
  const configured = String(file || "").trim();
  if (!configured) return undefined;
  if (production && !path.isAbsolute(configured)) throw deliveryError("AUDIT_TLS_FILE_INVALID", `${label} must be absolute in production`);
  const resolved = path.resolve(configured);
  let stat;
  try { stat = fs.lstatSync(resolved); } catch { throw deliveryError("AUDIT_TLS_FILE_UNAVAILABLE", `${label} is unavailable`); }
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size < 1 || stat.size > MAX_TLS_FILE_BYTES) {
    throw deliveryError("AUDIT_TLS_FILE_INVALID", `${label} must be a bounded regular file`);
  }
  return fs.readFileSync(resolved);
}

function createSecureAuditTransport(options = {}) {
  const env = options.env || process.env;
  const production = String(env.NODE_ENV || "").toLowerCase() === "production";
  assertTlsVerification(env);
  const ca = readTlsMaterial(options.caFile || env.SIEM_AUDIT_CA_FILE, "SIEM audit CA", production);
  const cert = readTlsMaterial(options.clientCertFile || env.SIEM_AUDIT_CLIENT_CERT_FILE, "SIEM audit client certificate", production);
  const key = readTlsMaterial(options.clientKeyFile || env.SIEM_AUDIT_CLIENT_KEY_FILE, "SIEM audit client key", production);
  if (Boolean(cert) !== Boolean(key)) throw deliveryError("AUDIT_MTLS_CONFIG_INVALID", "SIEM audit mTLS requires certificate and key");
  const timeoutMs = Math.min(60000, Math.max(1000, Number(options.timeoutMs || env.SIEM_AUDIT_TIMEOUT_MS || 10000) || 10000));
  return async (endpoint, request = {}) => {
    const target = new URL(endpoint);
    if (target.protocol !== "https:") throw deliveryError("AUDIT_TLS_REQUIRED", "SIEM audit transport requires HTTPS");
    return new Promise((resolve, reject) => {
      const req = https.request(target, {
        method: request.method || "POST",
        headers: request.headers || {},
        ca,
        cert,
        key,
        rejectUnauthorized: true,
        minVersion: "TLSv1.2",
        servername: options.servername || env.SIEM_AUDIT_TLS_SERVERNAME || target.hostname,
        timeout: timeoutMs
      }, (response) => {
        const chunks = [];
        let size = 0;
        response.on("data", (chunk) => {
          size += chunk.length;
          if (size > MAX_RECEIPT_BYTES) response.destroy(deliveryError("AUDIT_RECEIPT_TOO_LARGE", "SIEM audit receipt exceeds its size limit"));
          else chunks.push(chunk);
        });
        response.on("end", () => resolve({ status: Number(response.statusCode || 0), headers: response.headers, body: Buffer.concat(chunks).toString("utf8") }));
        response.on("error", reject);
      });
      req.on("timeout", () => req.destroy(deliveryError("AUDIT_DELIVERY_TIMEOUT", "SIEM audit delivery timed out", true)));
      req.on("error", reject);
      req.end(request.body || "");
    });
  };
}

function comparablePath(value) {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertSecureDirectory(directory) {
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory() || comparablePath(path.resolve(directory)) !== comparablePath(fs.realpathSync(directory))) {
    throw deliveryError("AUDIT_WORM_DIRECTORY_INVALID", "WORM audit directory must be a real directory without symbolic links");
  }
  if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) throw deliveryError("AUDIT_WORM_PERMISSIONS_INVALID", "WORM audit directory permissions are too broad");
}

function fsyncDirectory(directory) {
  if (process.platform === "win32") return;
  const descriptor = fs.openSync(directory, "r");
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}

function immutableWormProjection(value) {
  return { schemaVersion: value.schemaVersion, batchId: value.batchId, recordCount: value.recordCount, digest: value.digest, records: value.records };
}

function createWormAuditAdapter(options = {}) {
  if (!options.directory) throw deliveryError("AUDIT_WORM_DIRECTORY_REQUIRED", "WORM audit directory is required");
  const directory = path.resolve(options.directory);
  return Object.freeze({
    profile: "platform-adapter-v1",
    status: () => ({ type: "worm-filesystem", configured: true, createOnly: true, productionReady: false }),
    async deliver(batch) {
      if (!SAFE_BATCH_ID.test(String(batch?.batchId || ""))) throw deliveryError("AUDIT_BATCH_ID_INVALID", "audit batch id is invalid");
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      assertSecureDirectory(directory);
      const target = path.join(directory, `${batch.batchId}.json`);
      const bodyValue = { schemaVersion: batch.schemaVersion, batchId: batch.batchId, createdAt: batch.createdAt, recordCount: batch.recordCount, digest: batch.digest, records: JSON.parse(batch.payload).records };
      try {
        const descriptor = fs.openSync(target, "wx", 0o400);
        try { fs.writeFileSync(descriptor, `${JSON.stringify(bodyValue)}\n`, "utf8"); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
        fsyncDirectory(directory);
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        const stat = fs.lstatSync(target);
        if (stat.isSymbolicLink() || !stat.isFile() || (process.platform !== "win32" && (stat.mode & 0o177) !== 0)) {
          throw deliveryError("AUDIT_WORM_EXISTING_INVALID", "existing WORM audit batch is not immutable");
        }
        const existing = JSON.parse(fs.readFileSync(target, "utf8"));
        if (sha256(stableStringify(immutableWormProjection(existing))) !== sha256(stableStringify(immutableWormProjection(bodyValue)))) {
          throw deliveryError("AUDIT_WORM_CONFLICT", "existing WORM audit batch conflicts with requested content");
        }
      }
      return { acknowledged: true, receiptId: `worm-${batch.digest.slice(0, 24)}`, batchId: batch.batchId, recordCount: batch.recordCount, digest: batch.digest, acknowledgedAt: new Date().toISOString(), payloadExposed: false };
    }
  });
}

function responseHeader(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return String(headers.get(name) || "");
  const key = Object.keys(headers).find((item) => item.toLowerCase() === name.toLowerCase());
  return key ? String(headers[key] || "") : "";
}

function retryDelayMs(response, attempt, options = {}) {
  const baseMs = Math.min(5000, Math.max(10, Number(options.baseDelayMs || 250) || 250));
  const maximumMs = Math.min(60000, Math.max(baseMs, Number(options.maxDelayMs || 30000) || 30000));
  const value = responseHeader(response?.headers, "retry-after").trim();
  let requested = 0;
  if (/^\d+(?:\.\d+)?$/.test(value)) requested = Number(value) * 1000;
  else if (value) requested = Math.max(0, Date.parse(value) - Number(options.now?.() || Date.now()));
  return Math.min(maximumMs, Math.max(Number.isFinite(requested) ? requested : 0, baseMs * (2 ** Math.max(0, attempt - 1))));
}

function validateReceiptBinding(receipt, batch) {
  const receiptId = String(receipt?.receiptId || receipt?.ackId || "").trim();
  if (!receiptId) throw deliveryError("AUDIT_RECEIPT_MISSING", "SIEM audit receipt is missing");
  if (String(receipt.batchId || "") !== batch.batchId || String(receipt.digest || "") !== batch.digest || Number(receipt.recordCount) !== batch.recordCount) {
    throw deliveryError("AUDIT_RECEIPT_BINDING_INVALID", "SIEM audit receipt does not match batch identity");
  }
  return receiptId;
}

function assessAuditDeliveryConfig(env = {}, options = {}) {
  const root = path.resolve(options.root || path.join(__dirname, "..", "..", ".."));
  const endpoint = String(env.SIEM_AUDIT_ENDPOINT || "").trim();
  const worm = String(env.AUDIT_WORM_DIRECTORY || "").trim();
  const checkpoint = String(env.AUDIT_DELIVERY_CHECKPOINT_PATH || "").trim();
  const tlsMode = String(env.SIEM_AUDIT_TLS_MODE || "").trim().toLowerCase();
  const serviceUser = String(env.AUDIT_DELIVERY_SERVICE_USER || "").trim();
  const serviceGroup = String(env.AUDIT_DELIVERY_SERVICE_GROUP || "").trim();
  const outsideRoot = (value) => Boolean(value) && path.isAbsolute(value) && !isWithin(root, path.resolve(value));
  let tlsVerified = true;
  try { assertTlsVerification(env); } catch { tlsVerified = false; }
  const checks = [
    { id: "audit-delivery:target", passed: Number(Boolean(endpoint)) + Number(Boolean(worm)) === 1 },
    { id: "audit-delivery:checkpoint", passed: outsideRoot(checkpoint) },
    { id: "audit-delivery:service-account", passed: Boolean(serviceUser && serviceGroup) && !/^(?:root|administrator)$/i.test(serviceUser) },
    { id: "audit-delivery:tls-verification", passed: tlsVerified }
  ];
  if (endpoint) checks.push(
    { id: "audit-delivery:siem-https", passed: /^https:\/\//i.test(endpoint) },
    { id: "audit-delivery:signing-secret", passed: String(env.SIEM_AUDIT_SIGNING_SECRET || "").length >= 32 },
    { id: "audit-delivery:tls-mode", passed: ["system", "custom-ca", "mtls"].includes(tlsMode) },
    { id: "audit-delivery:custom-ca", passed: tlsMode !== "custom-ca" || outsideRoot(String(env.SIEM_AUDIT_CA_FILE || "")) },
    { id: "audit-delivery:mtls", passed: tlsMode !== "mtls" || (outsideRoot(String(env.SIEM_AUDIT_CLIENT_CERT_FILE || "")) && outsideRoot(String(env.SIEM_AUDIT_CLIENT_KEY_FILE || ""))) }
  );
  if (worm) checks.push({ id: "audit-delivery:worm-directory", passed: outsideRoot(worm) && path.dirname(path.resolve(checkpoint || root)) !== path.resolve(worm) });
  return Object.freeze({ configured: checks[0].passed, ready: checks.every((item) => item.passed), checks: Object.freeze(checks.map(Object.freeze)), productionReady: false, boundary: "Local preflight does not prove SIEM/WORM acceptance, certificate issuance, retention approval or site signoff." });
}

function createSiemAuditAdapter(options = {}) {
  const env = options.env || process.env;
  assertTlsVerification(env);
  const endpoint = new URL(options.endpoint || env.SIEM_AUDIT_ENDPOINT);
  if (endpoint.protocol !== "https:") throw deliveryError("AUDIT_TLS_REQUIRED", "SIEM audit endpoint requires HTTPS");
  const secret = String(options.signingSecret || env.SIEM_AUDIT_SIGNING_SECRET || "");
  if (secret.length < 32 || /replace|inject|example|changeme|placeholder|<|>/i.test(secret)) throw deliveryError("AUDIT_SIGNING_SECRET_INVALID", "SIEM audit signing secret is invalid");
  const fetchImpl = options.fetchImpl;
  const transport = options.transport || (!fetchImpl ? createSecureAuditTransport({ ...options, env }) : null);
  const maximumAttempts = Math.min(5, Math.max(1, Number(options.maxAttempts || env.AUDIT_DELIVERY_MAX_ATTEMPTS || 3) || 3));
  const sleep = options.sleep || ((delay) => new Promise((resolve) => setTimeout(resolve, delay)));
  return Object.freeze({
    profile: "platform-adapter-v1",
    status: () => ({ type: "siem-https", configured: true, tlsVerified: true, maximumAttempts, productionReady: false }),
    async deliver(batch) {
      let lastError;
      for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
        const timestamp = String(Date.now());
        const signature = createHmac("sha256", secret).update(`${timestamp}.${batch.digest}.${batch.payload}`).digest("hex");
        try {
          const request = { method: "POST", headers: { "Content-Type": "application/json", "X-Audit-Batch-Id": batch.batchId, "X-Audit-Digest": batch.digest, "X-Audit-Timestamp": timestamp, "X-Audit-Signature": `sha256=${signature}`, "Idempotency-Key": batch.batchId }, body: batch.payload };
          const response = fetchImpl ? await fetchImpl(endpoint.toString(), request) : await transport(endpoint.toString(), request);
          const responseBody = typeof response.text === "function" ? await response.text() : String(response.body || "");
          if (Buffer.byteLength(responseBody) > MAX_RECEIPT_BYTES) throw deliveryError("AUDIT_RECEIPT_TOO_LARGE", "SIEM audit receipt exceeds its size limit");
          let receipt = {};
          try { receipt = responseBody ? JSON.parse(responseBody) : {}; } catch {}
          const status = Number(response.status || 0);
          const ok = typeof response.ok === "boolean" ? response.ok : status >= 200 && status < 300;
          if (!ok) { const error = deliveryError("AUDIT_DELIVERY_HTTP_FAILED", "SIEM audit delivery was not accepted", status === 429 || status >= 500 || status === 0); error.response = response; throw error; }
          const receiptId = validateReceiptBinding(receipt, batch);
          return { acknowledged: true, receiptId: receiptId.slice(0, 200), batchId: batch.batchId, recordCount: batch.recordCount, digest: batch.digest, acknowledgedAt: new Date().toISOString(), attempts: attempt, payloadExposed: false };
        } catch (error) {
          lastError = error;
          if (error.retryable === false || attempt === maximumAttempts) break;
          await sleep(retryDelayMs(error.response, attempt, options));
        }
      }
      throw deliveryError("AUDIT_DELIVERY_FAILED", "SIEM audit delivery exhausted bounded retries", false, { cause: lastError });
    }
  });
}

function createPilotCutoverAuditLifecycleBridge(options = {}) {
  if (options.adapterKind !== "siem-https") return null;
  const file = options.file;
  const actorAccount = options.actorAccount || "audit-delivery-worker";
  return async (type, context) => {
    const batch = context.batch;
    const fingerprint = `audit-delivery:${batch.batchId}`;
    const common = { file, alertFingerprint: fingerprint, actorAccount, recordedAt: context.recordedAt };
    if (type === "opened") {
      appendPilotCutoverAlertEvent({ ...common, type: "alert-opened", details: { signalCode: "AUDIT_DELIVERY_FAILED", severity: "critical", title: "Continuous audit delivery failed", summary: "Audit delivery did not receive a batch-bound durable acknowledgement.", evidenceRefs: [] } });
      appendPilotCutoverAlertEvent({ ...common, type: "delivery-failed", details: { route: "SIEM", attempt: context.attempt || 1, errorCode: context.errorCode, errorDigest: `sha256:${sha256(context.errorCode)}`, retryable: false } });
    } else if (type === "acknowledged") {
      appendPilotCutoverAlertEvent({ ...common, type: "delivery-acknowledged", details: { route: "SIEM", attempt: context.receipt.attempts || 1, receiptRef: `monitoring://siem/${sha256(context.receipt.receiptId)}`, receiptDigest: `sha256:${sha256(stableStringify(context.receipt))}` } });
    } else if (type === "recovered") {
      appendPilotCutoverAlertEvent({ ...common, type: "alert-recovered", details: { evidenceRef: `artifact://audit-delivery/${batch.digest}`, evidenceDigest: `sha256:${batch.digest}` } });
    }
  };
}

function auditWriteFailureSignal(error) {
  const errorCode = String(error?.code || "AUDIT_CHECKPOINT_WRITE_FAILED").slice(0, 120);
  return Object.freeze({ id: "audit-write-failure", healthy: false, severity: "critical", errorCode, errorDigest: `sha256:${sha256(errorCode)}`, metadataOnly: true });
}

async function runAuditDeliveryCycle(options = {}) {
  if (!options.adapter || typeof options.adapter.deliver !== "function") throw deliveryError("AUDIT_ADAPTER_REQUIRED", "audit delivery adapter is required");
  const records = Array.isArray(options.records) ? options.records : [];
  if (!records.length) return { ok: true, delivered: 0, incidentTransition: "none", receipt: null };
  const batch = buildAuditBatch(records, options);
  try {
    const receipt = await options.adapter.deliver(batch);
    if (options.previousIncidentOpen && options.lifecycle) {
      await options.lifecycle("acknowledged", { batch, receipt, recordedAt: options.recordedAt });
      await options.lifecycle("recovered", { batch, receipt, recordedAt: options.recordedAt });
    }
    return { ok: true, delivered: batch.recordCount, incidentTransition: options.previousIncidentOpen ? "recovered" : "none", receipt };
  } catch (error) {
    const errorCode = String(error?.code || "AUDIT_DELIVERY_FAILED").slice(0, 120);
    if (!options.previousIncidentOpen && options.lifecycle) await options.lifecycle("opened", { batch, errorCode, attempt: 1, recordedAt: options.recordedAt });
    return { ok: false, delivered: 0, incidentTransition: options.previousIncidentOpen ? "still-open" : "opened", errorCode, batch: { batchId: batch.batchId, digest: batch.digest, recordCount: batch.recordCount } };
  }
}

module.exports = { assessAuditDeliveryConfig, auditWriteFailureSignal, buildAuditBatch, createPilotCutoverAuditLifecycleBridge, createSecureAuditTransport, createSiemAuditAdapter, createWormAuditAdapter, retryDelayMs, runAuditDeliveryCycle, stableStringify, validateReceiptBinding };
