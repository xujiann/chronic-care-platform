"use strict";

const RECEIPT_CONTRACT = "production-preflight-decision-receipt.v1";
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/;
const EVIDENCE_FINGERPRINT = /^[a-f0-9]{64}$/;
const STABLE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/;
const RECEIPT_FIELDS = Object.freeze([
  "artifactDigest",
  "contract",
  "decision",
  "evidenceFingerprint",
  "expiresAt",
  "issuedAt",
  "receiptId",
  "releaseId"
]);
const MAX_VALIDITY_MS = 24 * 60 * 60 * 1000;
const VERIFIED_PROJECTIONS = new WeakSet();

function isStableIdentifier(value) {
  return typeof value === "string" && value === value.trim() && STABLE_IDENTIFIER.test(value);
}

function safeIdentifier(value) {
  return isStableIdentifier(value) ? value : "";
}

function safeDigest(value, pattern) {
  const candidate = typeof value === "string" ? value.trim().toLowerCase() : "";
  return pattern.test(candidate) ? candidate : "";
}

function inspectDataObject(candidate, exactFields) {
  try {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return { ok: false, code: "not-object" };
    }
    const prototype = Object.getPrototypeOf(candidate);
    if (prototype !== Object.prototype && prototype !== null) {
      return { ok: false, code: "invalid-object" };
    }
    const fields = Reflect.ownKeys(candidate);
    if (fields.some((field) => typeof field !== "string")) {
      return { ok: false, code: "invalid-object" };
    }
    const sortedFields = [...fields].sort();
    if (exactFields && (sortedFields.length !== exactFields.length || sortedFields.some((field, index) => field !== exactFields[index]))) {
      return { ok: false, code: "invalid-object" };
    }
    const snapshot = {};
    for (const field of fields) {
      const descriptor = Object.getOwnPropertyDescriptor(candidate, field);
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, "value") || descriptor.enumerable !== true) {
        return { ok: false, code: "invalid-object" };
      }
      snapshot[field] = descriptor.value;
    }
    return { ok: true, value: Object.freeze(snapshot) };
  } catch {
    return { ok: false, code: "inspection-failed" };
  }
}

function blocked(code, expected = {}, receiptId = "") {
  const projection = {
    contract: RECEIPT_CONTRACT,
    verified: false,
    code,
    receiptId: safeIdentifier(receiptId),
    releaseId: safeIdentifier(expected.releaseId),
    artifactDigest: safeDigest(expected.artifactDigest, SHA256_DIGEST),
    evidenceFingerprint: safeDigest(expected.evidenceFingerprint, EVIDENCE_FINGERPRINT)
  };
  return Object.freeze(projection);
}

function assessProductionPreflightDecisionReceipt(receipt, expected = {}, options = {}) {
  const releaseId = safeIdentifier(expected.releaseId);
  const artifactDigest = safeDigest(expected.artifactDigest, SHA256_DIGEST);
  const evidenceFingerprint = safeDigest(expected.evidenceFingerprint, EVIDENCE_FINGERPRINT);
  const binding = { releaseId, artifactDigest, evidenceFingerprint };
  if (!releaseId || !artifactDigest || !evidenceFingerprint) {
    return blocked("trusted-receipt-expected-binding-invalid", binding);
  }
  const receiptInspection = inspectDataObject(receipt, RECEIPT_FIELDS);
  if (receiptInspection.code === "not-object") {
    return blocked("trusted-receipt-missing", binding);
  }
  if (receiptInspection.code === "inspection-failed") {
    return blocked("trusted-receipt-inspection-failed", binding);
  }
  if (!receiptInspection.ok) return blocked("trusted-receipt-fields-invalid", binding);
  const receiptSnapshot = receiptInspection.value;
  if (receiptSnapshot.contract !== RECEIPT_CONTRACT || !isStableIdentifier(receiptSnapshot.receiptId) || receiptSnapshot.decision !== "GO") {
    return blocked("trusted-receipt-contract-invalid", binding, receiptSnapshot.receiptId);
  }
  if (!isStableIdentifier(receiptSnapshot.releaseId) || receiptSnapshot.releaseId !== releaseId) return blocked("trusted-receipt-release-mismatch", binding, receiptSnapshot.receiptId);
  if (safeDigest(receiptSnapshot.artifactDigest, SHA256_DIGEST) !== artifactDigest) return blocked("trusted-receipt-artifact-mismatch", binding, receiptSnapshot.receiptId);
  if (safeDigest(receiptSnapshot.evidenceFingerprint, EVIDENCE_FINGERPRINT) !== evidenceFingerprint) return blocked("trusted-receipt-evidence-mismatch", binding, receiptSnapshot.receiptId);

  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const issuedAt = new Date(receiptSnapshot.issuedAt);
  const expiresAt = new Date(receiptSnapshot.expiresAt);
  if (!Number.isFinite(now.getTime()) || !Number.isFinite(issuedAt.getTime()) || !Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= issuedAt.getTime()) {
    return blocked("trusted-receipt-time-invalid", binding, receiptSnapshot.receiptId);
  }
  if (expiresAt.getTime() - issuedAt.getTime() > MAX_VALIDITY_MS) {
    return blocked("trusted-receipt-validity-window-too-long", binding, receiptSnapshot.receiptId);
  }
  if (issuedAt.getTime() > now.getTime()) return blocked("trusted-receipt-issued-in-future", binding, receiptSnapshot.receiptId);
  if (expiresAt.getTime() <= now.getTime()) return blocked("trusted-receipt-expired", binding, receiptSnapshot.receiptId);
  if (typeof options.verifier !== "function") return blocked("trusted-receipt-verifier-missing", binding, receiptSnapshot.receiptId);

  let verdict;
  try {
    verdict = options.verifier(receiptSnapshot, Object.freeze({ ...binding, now: now.toISOString() }));
  } catch {
    return blocked("trusted-receipt-verification-failed", binding, receiptSnapshot.receiptId);
  }
  const verdictInspection = inspectDataObject(verdict);
  if (verdictInspection.code === "inspection-failed") {
    return blocked("trusted-receipt-verdict-inspection-failed", binding, receiptSnapshot.receiptId);
  }
  if (!verdictInspection.ok || typeof verdictInspection.value.then === "function") {
    return blocked("trusted-receipt-verdict-invalid", binding, receiptSnapshot.receiptId);
  }
  const verdictSnapshot = verdictInspection.value;
  const verifiedAt = new Date(verdictSnapshot.verifiedAt);
  const exactVerdict = verdictSnapshot.verified === true
    && isStableIdentifier(verdictSnapshot.verifierId)
    && verdictSnapshot.receiptId === receiptSnapshot.receiptId
    && verdictSnapshot.releaseId === releaseId
    && String(verdictSnapshot.artifactDigest || "").toLowerCase() === artifactDigest
    && String(verdictSnapshot.evidenceFingerprint || "").toLowerCase() === evidenceFingerprint
    && verdictSnapshot.replayDetected === false
    && verdictSnapshot.singleUseEnforced === true
    && Number.isFinite(verifiedAt.getTime())
    && verifiedAt.getTime() <= now.getTime()
    && verifiedAt.getTime() >= issuedAt.getTime();
  if (!exactVerdict) return blocked("trusted-receipt-verdict-invalid", binding, receiptSnapshot.receiptId);

  const projection = {
    contract: RECEIPT_CONTRACT,
    verified: true,
    code: "trusted-receipt-verified",
    receiptId: receiptSnapshot.receiptId,
    verifierId: verdictSnapshot.verifierId,
    releaseId,
    artifactDigest,
    evidenceFingerprint,
    expiresAt: expiresAt.toISOString(),
    verifiedAt: verifiedAt.toISOString()
  };
  VERIFIED_PROJECTIONS.add(projection);
  return Object.freeze(projection);
}

function isVerifiedProductionPreflightDecision(projection) {
  return Boolean(projection && typeof projection === "object" && VERIFIED_PROJECTIONS.has(projection));
}

module.exports = {
  RECEIPT_CONTRACT,
  assessProductionPreflightDecisionReceipt,
  isVerifiedProductionPreflightDecision
};
