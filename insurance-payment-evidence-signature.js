"use strict";

const crypto = require("node:crypto");

const SIGNATURE_SCHEMA = "insurance-payment-evidence-signature/v1";
const SIGNATURE_ALGORITHMS = new Set(["RSA-SHA256", "ECDSA-SHA256"]);
const MAX_SIGNATURE_VALIDITY_MS = 31 * 86400000;

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeFingerprint(value) {
  return String(value || "").trim().replace(/^sha-?256:/i, "").replace(/[^a-f\d]/gi, "").toLowerCase();
}

function publicKeyFingerprint(publicKeyPem) {
  const key = crypto.createPublicKey(publicKeyPem);
  return sha256(key.export({ type: "spki", format: "der" }));
}

function unsignedEvidencePacket(packet = {}) {
  const { signatureEnvelope: _signatureEnvelope, signatureVerification: _signatureVerification, ...content } = packet;
  return content;
}

function algorithmForKey(key) {
  if (key.asymmetricKeyType === "rsa" || key.asymmetricKeyType === "rsa-pss") return "RSA-SHA256";
  if (key.asymmetricKeyType === "ec") return "ECDSA-SHA256";
  throw new Error(`不支持的证据包签名密钥类型：${key.asymmetricKeyType || "unknown"}`);
}

function signatureClaims(packet, envelope = {}) {
  const content = unsignedEvidencePacket(packet);
  return {
    schemaVersion: SIGNATURE_SCHEMA,
    packetSchema: String(content.schema || ""),
    packetDigest: String(content.packetDigest || ""),
    generatedAt: String(content.generatedAt || ""),
    domainOwner: String(content.domainOwner || ""),
    integrationOwner: String(content.integrationOwner || ""),
    productionReady: content.productionReady === true,
    contentDigest: sha256(stableStringify(content)),
    signerId: String(envelope.signerId || ""),
    signerOrganization: String(envelope.signerOrganization || ""),
    signedAt: String(envelope.signedAt || ""),
    validUntil: String(envelope.validUntil || "")
  };
}

function createEvidencePacketSignature(packet, privateKeyPem, options = {}) {
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  const publicKey = crypto.createPublicKey(privateKey);
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const signedAt = new Date(options.signedAt || new Date()).toISOString();
  const validUntil = new Date(options.validUntil || Date.parse(signedAt) + 30 * 86400000).toISOString();
  if (Date.parse(validUntil) <= Date.parse(signedAt)) throw new Error("证据包签名有效期必须晚于签发时间");
  if (Date.parse(validUntil) - Date.parse(signedAt) > MAX_SIGNATURE_VALIDITY_MS) throw new Error("证据包签名有效期不得超过31天");
  const envelope = {
    schemaVersion: SIGNATURE_SCHEMA,
    algorithm: algorithmForKey(publicKey),
    signerId: String(options.signerId || "").trim(),
    signerOrganization: String(options.signerOrganization || "").trim(),
    keyFingerprint: publicKeyFingerprint(publicKeyPem),
    publicKeyPem,
    signedAt,
    validUntil
  };
  if (!envelope.signerId) throw new Error("证据包签名必须提供 signerId");
  if (!envelope.signerOrganization) throw new Error("证据包签名必须提供 signerOrganization");
  const claims = signatureClaims(packet, envelope);
  envelope.contentDigest = claims.contentDigest;
  envelope.signature = crypto.sign("sha256", Buffer.from(stableStringify(claims), "utf8"), privateKey).toString("base64");
  return envelope;
}

function verifyEvidencePacketSignature(packet = {}, options = {}) {
  const envelope = packet.signatureEnvelope || {};
  const errors = [];
  const now = new Date(options.now || new Date());
  const trusted = new Set((options.trustedSignerFingerprints || []).map(normalizeFingerprint).filter(Boolean));
  if (envelope.schemaVersion !== SIGNATURE_SCHEMA) errors.push("证据包签名信封版本无效");
  if (!SIGNATURE_ALGORITHMS.has(envelope.algorithm)) errors.push("证据包签名算法必须为RSA-SHA256或ECDSA-SHA256");
  if (!String(envelope.signerId || "").trim()) errors.push("证据包签名人标识不能为空");
  if (!String(envelope.signerOrganization || "").trim()) errors.push("证据包签名机构不能为空");
  const signedAt = new Date(envelope.signedAt);
  const validUntil = new Date(envelope.validUntil);
  if (Number.isNaN(signedAt.getTime())) errors.push("证据包签发时间无效");
  if (Number.isNaN(validUntil.getTime())) errors.push("证据包签名失效时间无效");
  if (!Number.isNaN(signedAt.getTime()) && signedAt.getTime() > now.getTime() + 300000) errors.push("证据包签发时间晚于当前时间");
  if (!Number.isNaN(validUntil.getTime()) && validUntil <= now) errors.push("证据包签名已过期");
  if (!Number.isNaN(signedAt.getTime()) && !Number.isNaN(validUntil.getTime())) {
    if (validUntil <= signedAt) errors.push("证据包签名有效期无效");
    if (validUntil - signedAt > MAX_SIGNATURE_VALIDITY_MS) errors.push("证据包签名有效期超过31天");
  }
  const claims = signatureClaims(packet, envelope);
  if (envelope.contentDigest !== claims.contentDigest) errors.push("证据包签名绑定的内容摘要不一致");
  let fingerprint = "";
  let cryptographicallyValid = false;
  try {
    fingerprint = publicKeyFingerprint(envelope.publicKeyPem);
    if (normalizeFingerprint(envelope.keyFingerprint) !== fingerprint) errors.push("证据包签名公钥指纹不一致");
    if (!trusted.size) errors.push("未配置可信证据包签名公钥指纹");
    else if (!trusted.has(fingerprint)) errors.push("证据包签名公钥不在可信清单中");
    if (!/^[A-Za-z\d+/]+={0,2}$/.test(String(envelope.signature || ""))) errors.push("证据包签名值格式无效");
    else cryptographicallyValid = crypto.verify("sha256", Buffer.from(stableStringify(claims), "utf8"), envelope.publicKeyPem, Buffer.from(envelope.signature, "base64"));
    if (!cryptographicallyValid) errors.push("证据包数字签名验证失败");
  } catch (error) {
    errors.push(`证据包签名公钥无效：${error.message}`);
  }
  return {
    ok: errors.length === 0,
    cryptographicallyValid,
    trusted: Boolean(fingerprint && trusted.has(fingerprint)),
    keyFingerprint: fingerprint || normalizeFingerprint(envelope.keyFingerprint),
    signerId: String(envelope.signerId || ""),
    signerOrganization: String(envelope.signerOrganization || ""),
    signedAt: envelope.signedAt || null,
    validUntil: envelope.validUntil || null,
    contentDigest: claims.contentDigest,
    checkedAt: now.toISOString(),
    errors
  };
}

module.exports = {
  MAX_SIGNATURE_VALIDITY_MS,
  SIGNATURE_ALGORITHMS,
  SIGNATURE_SCHEMA,
  createEvidencePacketSignature,
  normalizeFingerprint,
  publicKeyFingerprint,
  sha256,
  signatureClaims,
  stableStringify,
  unsignedEvidencePacket,
  verifyEvidencePacketSignature
};
