"use strict";

const { createHash, createHmac, createPrivateKey, createPublicKey, sign, timingSafeEqual, verify } = require("node:crypto");

const CONTRACT_ID = "disease-payment-formal-grouper-v1";
const CONTRACT_VERSION = "1.0.0";
const SIGNATURE_SCHEMA_VERSION = "disease-payment-grouper-receipt-signature-v1";
const CALLBACK_SIGNATURE_SCHEMA_VERSION = "disease-payment-grouper-callback-hmac-v1";

class GrouperCallbackError extends Error {
  constructor(message, code, statusCode = 400) {
    super(message);
    this.name = "GrouperCallbackError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function canonicalStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalStringify(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  const input = Buffer.isBuffer(value) || value instanceof Uint8Array ? value : typeof value === "string" ? value : canonicalStringify(value);
  return createHash("sha256").update(input).digest("hex");
}

function normalizeCode(value) {
  return String(typeof value === "string" ? value : value?.code || "").trim().toUpperCase();
}

function normalizeDiagnoses(items = []) {
  return items.map(normalizeCode).filter(Boolean).sort();
}

function normalizeProcedures(items = []) {
  return items.map((item, index) => ({
    code: normalizeCode(item),
    role: String(typeof item === "object" && item?.role ? item.role : index === 0 ? "main" : "other").trim().toLowerCase(),
    cost: Number(typeof item === "object" ? item?.cost || 0 : 0)
  })).filter((item) => item.code).sort((left, right) => left.code.localeCompare(right.code) || left.role.localeCompare(right.role));
}

function normalizedCaseSnapshot(item = {}, mode = "DRG") {
  return {
    caseId: String(item.id || "").trim(),
    settlementListNo: String(item.settlementListNo || "").trim(),
    institutionReference: String(item.institutionCode || item.institution || "").trim(),
    mode: mode === "DIP" ? "DIP" : "DRG",
    admissionDate: String(item.admissionDate || "").trim(),
    dischargeDate: String(item.dischargeDate || "").trim(),
    sex: String(item.sex || "").trim(),
    age: item.age === undefined || item.age === null || item.age === "" ? null : Number(item.age),
    ageDays: item.ageDays === undefined || item.ageDays === null || item.ageDays === "" ? null : Number(item.ageDays),
    newbornWeight: item.newbornWeight === undefined || item.newbornWeight === null || item.newbornWeight === "" ? null : Number(item.newbornWeight),
    dischargeDisposition: String(item.dischargeDisposition || "").trim(),
    principalDiagnosis: normalizeCode(item.principalDiagnosis),
    otherDiagnoses: normalizeDiagnoses(item.otherDiagnoses),
    procedures: normalizeProcedures(item.procedures),
    totalAmount: Number(item.totalAmount || 0)
  };
}

function caseInputDigest(item, mode = "DRG") {
  return sha256(normalizedCaseSnapshot(item, mode));
}

function buildRequestEnvelope(job = {}) {
  return {
    contractId: CONTRACT_ID,
    contractVersion: CONTRACT_VERSION,
    environment: "formal",
    correlationId: job.correlationId,
    idempotencyKey: job.idempotencyKey,
    requestedAt: job.createdAt,
    mode: job.mode,
    schemeVersion: job.schemeVersion,
    cases: (job.caseSnapshots || []).map((item) => ({
      caseId: item.caseId,
      settlementListNo: item.settlementListNo,
      inputDigest: item.inputDigest,
      normalizedCase: item.normalizedCase
    }))
  };
}

function validateRequestEnvelope(envelope = {}) {
  const errors = [];
  if (envelope.contractId !== CONTRACT_ID || envelope.contractVersion !== CONTRACT_VERSION) errors.push("正式分组契约版本不受支持");
  if (envelope.environment !== "formal") errors.push("正式分组契约环境必须为formal");
  ["correlationId", "idempotencyKey", "requestedAt", "schemeVersion"].forEach((field) => { if (!String(envelope[field] || "").trim()) errors.push(`缺少${field}`); });
  if (!new Set(["DRG", "DIP"]).has(envelope.mode)) errors.push("分组模式必须为DRG或DIP");
  if (!Array.isArray(envelope.cases) || !envelope.cases.length) errors.push("正式分组契约至少包含一个病例");
  const ids = new Set();
  (envelope.cases || []).forEach((item, index) => {
    if (!item.caseId || !item.settlementListNo || !item.normalizedCase) errors.push(`第${index + 1}个病例缺少业务标识或规范化快照`);
    if (ids.has(item.caseId)) errors.push(`病例编号重复：${item.caseId}`);
    ids.add(item.caseId);
    if (item.normalizedCase && item.inputDigest !== sha256(item.normalizedCase)) errors.push(`病例摘要不匹配：${item.caseId}`);
    if (item.normalizedCase?.caseId !== item.caseId || item.normalizedCase?.settlementListNo !== item.settlementListNo) errors.push(`病例快照业务标识不匹配：${item.caseId}`);
    if (!item.normalizedCase?.institutionReference || !item.normalizedCase?.principalDiagnosis || !item.normalizedCase?.dischargeDate) errors.push(`病例快照缺少分组必需字段：${item.caseId}`);
  });
  return { ok: errors.length === 0, errors, digest: sha256(envelope) };
}

function unsignedReceiptContent(receipt = {}) {
  const { signatureEvidence, signatureValid, verification, ...content } = receipt;
  return content;
}

function publicKeyFingerprint(publicKeyPem) {
  const key = createPublicKey(publicKeyPem);
  return sha256(key.export({ type: "spki", format: "der" }));
}

function signatureAlgorithm(key) {
  if (["rsa", "rsa-pss"].includes(key.asymmetricKeyType)) return "RSA-SHA256";
  if (key.asymmetricKeyType === "ec") return "ECDSA-SHA256";
  throw new Error(`不支持的正式分组回执签名密钥类型：${key.asymmetricKeyType}`);
}

function createReceiptSignature(receipt, privateKeyPem, options = {}) {
  const privateKey = createPrivateKey(privateKeyPem);
  const publicKey = createPublicKey(privateKey);
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const content = unsignedReceiptContent(receipt);
  if (!content.receiptId || !content.caseId || !content.inputDigest || !content.schemeVersion || !content.signedAt) throw new Error("正式分组回执签名缺少业务主键、方案版本、输入摘要或签发时间");
  const canonical = canonicalStringify(content);
  return {
    schemaVersion: SIGNATURE_SCHEMA_VERSION,
    algorithm: signatureAlgorithm(privateKey),
    keyId: String(options.keyId || "official-grouper-key"),
    signerId: String(options.signerId || "official-grouper"),
    signerOrganization: String(options.signerOrganization || "medical-insurance-grouper"),
    keyFingerprint: publicKeyFingerprint(publicKeyPem),
    publicKeyPem,
    contentDigest: sha256(canonical),
    validFrom: String(options.validFrom || ""),
    validUntil: String(options.validUntil || ""),
    signature: sign("sha256", Buffer.from(canonical), privateKey).toString("base64")
  };
}

function createSignedReceipt(receipt, privateKeyPem, options = {}) {
  const content = { ...unsignedReceiptContent(receipt), signedAt: receipt.signedAt || new Date().toISOString() };
  return { ...content, signatureEvidence: createReceiptSignature(content, privateKeyPem, options) };
}

function verifyReceiptSignature(receipt = {}, options = {}) {
  const errors = [];
  const evidence = receipt.signatureEvidence || {};
  const content = unsignedReceiptContent(receipt);
  if (evidence.schemaVersion !== SIGNATURE_SCHEMA_VERSION) errors.push("正式分组回执签名信封版本不受支持");
  if (!new Set(["RSA-SHA256", "ECDSA-SHA256"]).has(evidence.algorithm)) errors.push("正式分组回执签名算法不受支持");
  if (!evidence.publicKeyPem || !evidence.signature || !evidence.keyFingerprint) errors.push("正式分组回执缺少公钥、签名或证书指纹");
  const canonical = canonicalStringify(content);
  const contentDigest = sha256(canonical);
  if (evidence.contentDigest !== contentDigest) errors.push("正式分组回执正文摘要不匹配");
  let keyFingerprint = "";
  let cryptographicallyValid = false;
  if (evidence.publicKeyPem) {
    try {
      keyFingerprint = publicKeyFingerprint(evidence.publicKeyPem);
      if (keyFingerprint !== evidence.keyFingerprint) errors.push("正式分组回执公钥指纹不匹配");
      cryptographicallyValid = verify("sha256", Buffer.from(canonical), createPublicKey(evidence.publicKeyPem), Buffer.from(String(evidence.signature || ""), "base64"));
      if (!cryptographicallyValid) errors.push("正式分组回执数字签名验证失败");
    } catch {
      errors.push("正式分组回执公钥或签名格式无效");
    }
  }
  const trusted = new Set((options.trustedSignerFingerprints || []).map((item) => String(item).trim().toLowerCase()).filter(Boolean));
  if (!trusted.size || !trusted.has(keyFingerprint.toLowerCase())) errors.push("正式分组回执签名证书不在可信指纹清单");
  const at = Date.parse(options.at || new Date().toISOString());
  if (evidence.validFrom && at < Date.parse(evidence.validFrom)) errors.push("正式分组回执签名证书尚未生效");
  if (evidence.validUntil && at > Date.parse(evidence.validUntil)) errors.push("正式分组回执签名证书已过期");
  return {
    ok: errors.length === 0,
    errors,
    cryptographicallyValid,
    trusted: trusted.has(keyFingerprint.toLowerCase()),
    keyFingerprint,
    contentDigest,
    verification: {
      verifiedBy: "official-adapter-v1",
      algorithm: evidence.algorithm || "",
      keyId: evidence.keyId || "",
      keyFingerprint,
      verifiedAt: new Date().toISOString()
    }
  };
}

function callbackSigningInput(payload, timestamp, nonce, sourceId) {
  return `${CALLBACK_SIGNATURE_SCHEMA_VERSION}\n${sourceId}\n${timestamp}\n${nonce}\n${sha256(payload)}`;
}

function signTrustedGrouperCallback(payload, options = {}) {
  const secret = String(options.secret || "").trim();
  const timestamp = String(options.timestamp || "").trim();
  const nonce = String(options.nonce || "").trim();
  const sourceId = String(options.sourceId || "").trim();
  if (!secret || !timestamp || !nonce || !sourceId) throw new GrouperCallbackError("正式分组回调签名缺少密钥、时间戳、随机数或来源", "GROUPER_CALLBACK_SIGNING_INPUT_REQUIRED");
  return createHmac("sha256", secret).update(callbackSigningInput(payload, timestamp, nonce, sourceId)).digest("hex");
}

function valueSet(value) {
  if (value instanceof Set) return new Set([...value].map((item) => String(item).trim()).filter(Boolean));
  return new Set((Array.isArray(value) ? value : String(value || "").split(",")).map((item) => String(item).trim()).filter(Boolean));
}

function verifyTrustedGrouperCallback(payload, options = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new GrouperCallbackError("正式分组回调正文必须是对象", "GROUPER_CALLBACK_BODY_INVALID");
  const env = options.env || process.env;
  const secret = String(options.secret || env.DISEASE_PAYMENT_GROUPER_CALLBACK_SECRET || "").trim();
  if (!secret) throw new GrouperCallbackError("正式分组回调密钥未配置", "GROUPER_CALLBACK_NOT_CONFIGURED", 503);
  if (String(env.NODE_ENV || "").toLowerCase() === "production" && secret.length < 32) throw new GrouperCallbackError("正式分组回调密钥不满足生产强度", "GROUPER_CALLBACK_SECRET_WEAK", 503);
  const sourceId = String(options.sourceId || "").trim();
  const allowedSourceIds = valueSet(options.allowedSourceIds || env.DISEASE_PAYMENT_GROUPER_CALLBACK_ALLOWED_SOURCES);
  if (!sourceId || !allowedSourceIds.size || !allowedSourceIds.has(sourceId)) throw new GrouperCallbackError("正式分组回调来源不在白名单", "GROUPER_CALLBACK_SOURCE_DENIED", 403);
  const eventId = String(payload.eventId || "").trim();
  const correlationId = String(payload.correlationId || "").trim();
  if (!/^[A-Za-z0-9._:-]{3,160}$/.test(eventId) || !correlationId) throw new GrouperCallbackError("正式分组回调缺少有效事件号或关联号", "GROUPER_CALLBACK_IDENTITY_INVALID");
  const timestamp = String(options.timestamp || "").trim();
  const timestampNumber = Number(timestamp);
  if (!/^\d{10,13}$/.test(timestamp) || !Number.isFinite(timestampNumber)) throw new GrouperCallbackError("正式分组回调时间戳无效", "GROUPER_CALLBACK_TIMESTAMP_INVALID");
  const callbackTimeMs = timestamp.length === 13 ? timestampNumber : timestampNumber * 1000;
  const nowMs = Number(options.nowMs ?? Date.now());
  const maxSkewSeconds = Math.min(900, Math.max(30, Number(options.maxSkewSeconds || env.DISEASE_PAYMENT_GROUPER_CALLBACK_MAX_SKEW_SECONDS || 300)));
  if (!Number.isFinite(nowMs) || !Number.isFinite(maxSkewSeconds) || Math.abs(nowMs - callbackTimeMs) > maxSkewSeconds * 1000) throw new GrouperCallbackError("正式分组回调超出允许时间窗", "GROUPER_CALLBACK_TIMESTAMP_EXPIRED", 401);
  const nonce = String(options.nonce || "").trim();
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(nonce)) throw new GrouperCallbackError("正式分组回调随机数无效", "GROUPER_CALLBACK_NONCE_INVALID");
  const signature = String(options.signature || "").trim().replace(/^sha256=/i, "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(signature)) throw new GrouperCallbackError("正式分组回调传输签名无效", "GROUPER_CALLBACK_SIGNATURE_INVALID", 401);
  const expected = signTrustedGrouperCallback(payload, { secret, timestamp, nonce, sourceId });
  const receivedBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  if (receivedBuffer.length !== expectedBuffer.length || !timingSafeEqual(receivedBuffer, expectedBuffer)) throw new GrouperCallbackError("正式分组回调传输签名校验失败", "GROUPER_CALLBACK_SIGNATURE_MISMATCH", 401);
  const nonceDigest = sha256(nonce);
  if (valueSet(options.seenEventIds).has(eventId)) throw new GrouperCallbackError("正式分组回调事件号已处理", "GROUPER_CALLBACK_EVENT_REPLAY", 409);
  if (valueSet(options.seenNonceDigests).has(nonceDigest)) throw new GrouperCallbackError("正式分组回调随机数已使用", "GROUPER_CALLBACK_NONCE_REPLAY", 409);
  return {
    schemaVersion: CALLBACK_SIGNATURE_SCHEMA_VERSION,
    eventId,
    correlationId,
    sourceId,
    timestamp,
    receivedAt: new Date(nowMs).toISOString(),
    payloadDigest: sha256(payload),
    nonceDigest,
    signatureVerified: true
  };
}

module.exports = {
  CALLBACK_SIGNATURE_SCHEMA_VERSION,
  CONTRACT_ID,
  CONTRACT_VERSION,
  GrouperCallbackError,
  SIGNATURE_SCHEMA_VERSION,
  buildRequestEnvelope,
  canonicalStringify,
  caseInputDigest,
  createReceiptSignature,
  createSignedReceipt,
  normalizedCaseSnapshot,
  publicKeyFingerprint,
  sha256,
  signTrustedGrouperCallback,
  unsignedReceiptContent,
  validateRequestEnvelope,
  verifyReceiptSignature,
  verifyTrustedGrouperCallback
};
