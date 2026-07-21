"use strict";

const crypto = require("crypto");

const SCHEMA_VERSION = "disease-payment-local-package-signature/v1";
const ALGORITHMS = new Set(["RSA-SHA256", "ECDSA-SHA256"]);

function canonicalStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalStringify(item)).join(",")}]`;
  const fields = Object.keys(value).filter((key) => value[key] !== undefined).sort();
  return `{${fields.map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`).join(",")}}`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeFingerprint(value) {
  return String(value || "").replace(/[^a-f\d]/gi, "").toLowerCase();
}

function publicKeyFingerprint(publicKeyPem) {
  const key = crypto.createPublicKey(publicKeyPem);
  const der = key.export({ type: "spki", format: "der" });
  return sha256(der);
}

function unsignedPackageContent(input) {
  const { signatureEvidence, signatureVerification, ...content } = input || {};
  return content;
}

function signatureClaims(content, evidence) {
  return {
    schemaVersion: SCHEMA_VERSION,
    packageId: String(content.id || ""),
    regionCode: String(content.regionCode || ""),
    packageVersion: String(content.packageVersion || ""),
    documentNo: String(content.documentNo || ""),
    effectiveFrom: String(content.effectiveFrom || ""),
    effectiveTo: String(content.effectiveTo || ""),
    contentDigest: sha256(canonicalStringify(content)),
    signerId: String(evidence.signerId || ""),
    signerOrganization: String(evidence.signerOrganization || ""),
    signedAt: String(evidence.signedAt || ""),
    validUntil: String(evidence.validUntil || "")
  };
}

function algorithmForKey(key) {
  const type = key.asymmetricKeyType;
  if (type === "rsa" || type === "rsa-pss") return "RSA-SHA256";
  if (type === "ec") return "ECDSA-SHA256";
  throw new Error(`不支持的规则包签名密钥类型：${type || "unknown"}`);
}

function createPackageSignature(input, privateKeyPem, options = {}) {
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  const publicKey = crypto.createPublicKey(privateKey);
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const signedAt = new Date(options.signedAt || new Date()).toISOString();
  const validUntil = new Date(options.validUntil || new Date(new Date(signedAt).getTime() + 366 * 24 * 60 * 60 * 1000)).toISOString();
  if (new Date(validUntil) <= new Date(signedAt)) throw new Error("规则包签名失效时间必须晚于签发时间");
  const evidence = {
    schemaVersion: SCHEMA_VERSION,
    algorithm: algorithmForKey(publicKey),
    signerId: String(options.signerId || "").trim(),
    signerOrganization: String(options.signerOrganization || input.sourceOrganization || "").trim(),
    keyFingerprint: publicKeyFingerprint(publicKeyPem),
    publicKeyPem,
    signedAt,
    validUntil
  };
  if (!evidence.signerId) throw new Error("规则包签名必须提供signerId");
  if (!evidence.signerOrganization) throw new Error("规则包签名必须提供signerOrganization");
  const content = unsignedPackageContent(input);
  const claims = signatureClaims(content, evidence);
  evidence.contentDigest = claims.contentDigest;
  evidence.signature = crypto.sign("sha256", Buffer.from(canonicalStringify(claims), "utf8"), privateKey).toString("base64");
  return evidence;
}

function verifyPackageSignature(input, options = {}) {
  const evidence = input?.signatureEvidence || {};
  const errors = [];
  const now = new Date(options.now || new Date());
  const trusted = new Set((options.trustedSignerFingerprints || []).map(normalizeFingerprint).filter(Boolean));
  if (evidence.schemaVersion !== SCHEMA_VERSION) errors.push("签名信封版本无效");
  if (!ALGORITHMS.has(evidence.algorithm)) errors.push("签名算法必须为RSA-SHA256或ECDSA-SHA256");
  if (!String(evidence.signerId || "").trim()) errors.push("签名人标识不能为空");
  if (!String(evidence.signerOrganization || "").trim()) errors.push("签名机构不能为空");
  const signedAt = new Date(evidence.signedAt);
  const validUntil = new Date(evidence.validUntil);
  if (Number.isNaN(signedAt.getTime())) errors.push("签名时间无效");
  if (Number.isNaN(validUntil.getTime())) errors.push("签名失效时间无效");
  if (!Number.isNaN(signedAt.getTime()) && signedAt.getTime() > now.getTime() + 5 * 60 * 1000) errors.push("签名时间晚于当前时间");
  if (!Number.isNaN(validUntil.getTime()) && validUntil < now) errors.push("规则包签名已过期");
  if (!Number.isNaN(signedAt.getTime()) && !Number.isNaN(validUntil.getTime()) && validUntil <= signedAt) errors.push("签名有效期无效");

  const content = unsignedPackageContent(input);
  const claims = signatureClaims(content, evidence);
  if (evidence.contentDigest !== claims.contentDigest) errors.push("签名绑定的规则包内容摘要不一致");
  let fingerprint = "";
  let cryptographicallyValid = false;
  try {
    fingerprint = publicKeyFingerprint(evidence.publicKeyPem);
    if (normalizeFingerprint(evidence.keyFingerprint) !== fingerprint) errors.push("签名公钥指纹不一致");
    if (!trusted.size) errors.push("未配置可信规则包签名公钥指纹");
    else if (!trusted.has(fingerprint)) errors.push("规则包签名公钥不在可信清单中");
    if (!String(evidence.signature || "").match(/^[A-Za-z\d+/]+={0,2}$/)) errors.push("签名值格式无效");
    else cryptographicallyValid = crypto.verify("sha256", Buffer.from(canonicalStringify(claims), "utf8"), evidence.publicKeyPem, Buffer.from(evidence.signature, "base64"));
    if (!cryptographicallyValid) errors.push("规则包数字签名验证失败");
  } catch (error) {
    errors.push(`签名公钥无效：${error.message}`);
  }
  const isTrusted = Boolean(fingerprint && trusted.has(fingerprint));
  return {
    ok: errors.length === 0,
    cryptographicallyValid,
    trusted: isTrusted,
    keyFingerprint: fingerprint || normalizeFingerprint(evidence.keyFingerprint),
    signerId: String(evidence.signerId || ""),
    signerOrganization: String(evidence.signerOrganization || ""),
    signedAt: evidence.signedAt || null,
    validUntil: evidence.validUntil || null,
    contentDigest: claims.contentDigest,
    errors,
    checkedAt: now.toISOString()
  };
}

module.exports = { SCHEMA_VERSION, canonicalStringify, createPackageSignature, normalizeFingerprint, publicKeyFingerprint, sha256, unsignedPackageContent, verifyPackageSignature };
