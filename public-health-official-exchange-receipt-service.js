"use strict";

const { createHash, createHmac, timingSafeEqual } = require("node:crypto");
const {
  resolveVerificationKey,
  selectSigningKey,
  summarizeKeyring
} = require("./public-health-external-keyring-service");

const PUBLIC_HEALTH_OFFICIAL_EXCHANGE_RECEIPT_PURPOSE = "public-health-official-exchange-receipt";
const PUBLIC_HEALTH_OFFICIAL_EXCHANGE_RECEIPT_VERSION = "ph-official-exchange-receipt-v1";
const PUBLIC_HEALTH_OFFICIAL_EXCHANGE_STAGES = Object.freeze(["official-report", "feedback"]);
const TRUSTED_ATTESTATION_ORIGIN = "server-generated";
const TRUSTED_VERIFICATION_SOURCE = "server-official-receipt-adapter";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function clean(value) {
  return String(value ?? "").trim();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeDigest(value) {
  return clean(value).toLowerCase().replace(/^sha256:/, "");
}

function timeValue(value, label) {
  const parsed = new Date(value).getTime();
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a valid date-time`);
  return parsed;
}

function assertPurpose(keyring) {
  if (clean(keyring?.purpose) !== PUBLIC_HEALTH_OFFICIAL_EXCHANGE_RECEIPT_PURPOSE) {
    throw new Error(`official exchange receipt keyring purpose must be ${PUBLIC_HEALTH_OFFICIAL_EXCHANGE_RECEIPT_PURPOSE}`);
  }
}

function normalizedEvidenceRefs(value) {
  return Array.isArray(value)
    ? [...new Set(value.map(clean).filter(Boolean))].sort()
    : [];
}

function publicHealthOfficialExchangeReceiptPayload(record = {}) {
  const trust = record.trustedVerification || {};
  return [
    PUBLIC_HEALTH_OFFICIAL_EXCHANGE_RECEIPT_VERSION,
    clean(record.id),
    clean(record.stage).toLowerCase(),
    clean(record.alertId),
    clean(record.reportId),
    clean(record.externalReceiptCode),
    clean(record.conclusion),
    clean(record.status).toLowerCase(),
    createHash("sha256").update(JSON.stringify(normalizedEvidenceRefs(record.evidenceRefs))).digest("hex"),
    clean(record.predecessorRecordId),
    clean(record.predecessorReceiptId),
    normalizeDigest(record.predecessorBindingDigest),
    clean(record.issuedAt),
    clean(trust.attestationOrigin).toLowerCase(),
    clean(trust.verificationSource).toLowerCase(),
    trust.signatureVerified === true ? "true" : "false",
    clean(trust.signedBy),
    clean(trust.verifiedBy),
    clean(trust.verifiedAt),
    clean(trust.algorithm).toUpperCase(),
    clean(trust.keyId),
    clean(trust.receiptId)
  ].join("\n");
}

function publicHealthOfficialExchangeReceiptBindingDigest(record = {}) {
  return createHash("sha256").update(publicHealthOfficialExchangeReceiptPayload(record)).digest("hex");
}

function validateReceiptInput(record = {}) {
  const stage = clean(record.stage).toLowerCase();
  const evidenceRefs = normalizedEvidenceRefs(record.evidenceRefs);
  if (!clean(record.id) || !PUBLIC_HEALTH_OFFICIAL_EXCHANGE_STAGES.includes(stage)) {
    throw new Error("official exchange receipt id and supported stage are required");
  }
  if (!clean(record.alertId) || !clean(record.reportId) || !clean(record.externalReceiptCode)) {
    throw new Error("alertId, reportId and externalReceiptCode are required");
  }
  if ((stage === "feedback") !== Boolean(clean(record.conclusion))) {
    throw new Error("feedback conclusion is required only for the feedback stage");
  }
  if (clean(record.status).toLowerCase() !== "accepted") {
    throw new Error("accepted official exchange receipt status is required");
  }
  if (!evidenceRefs.length) throw new Error("official exchange receipt evidenceRefs are required");
  timeValue(record.issuedAt, "official exchange receipt issuedAt");
  const predecessorFields = [
    clean(record.predecessorRecordId),
    clean(record.predecessorReceiptId),
    normalizeDigest(record.predecessorBindingDigest)
  ];
  if (stage === "feedback") {
    if (!predecessorFields[0] || !predecessorFields[1] || !SHA256_PATTERN.test(predecessorFields[2])) {
      throw new Error("feedback receipt requires a complete official-report predecessor binding");
    }
  } else if (predecessorFields.some(Boolean)) {
    throw new Error("official-report receipt cannot contain a predecessor binding");
  }
  return { stage, evidenceRefs };
}

function issueTrustedPublicHealthOfficialExchangeReceipt(
  record,
  verification,
  keyring,
  predecessor = null
) {
  assertPurpose(keyring);
  const issuedAt = clean(record?.issuedAt);
  const stage = clean(record?.stage).toLowerCase();
  let predecessorRecord = null;
  if (stage === "feedback") {
    const predecessorVerification = verifyTrustedPublicHealthOfficialExchangeReceipt(predecessor, keyring, issuedAt);
    if (!predecessorVerification.ok || clean(predecessor?.stage) !== "official-report") {
      throw new Error(`trusted official-report predecessor is required: ${predecessorVerification.reason}`);
    }
    if (clean(predecessor.alertId) !== clean(record.alertId)
      || clean(predecessor.reportId) !== clean(record.reportId)) {
      throw new Error("feedback receipt must bind the same alert and report as its predecessor");
    }
    predecessorRecord = predecessor;
  } else if (predecessor) {
    throw new Error("predecessor receipt is allowed only for feedback");
  }
  const prepared = {
    ...clone(record),
    stage,
    status: "accepted",
    evidenceRefs: normalizedEvidenceRefs(record?.evidenceRefs),
    predecessorRecordId: predecessorRecord ? clean(predecessorRecord.id) : "",
    predecessorReceiptId: predecessorRecord ? clean(predecessorRecord.trustedVerification?.receiptId) : "",
    predecessorBindingDigest: predecessorRecord
      ? publicHealthOfficialExchangeReceiptBindingDigest(predecessorRecord)
      : "",
    productionReady: false
  };
  validateReceiptInput(prepared);
  const verifiedAt = clean(verification?.verifiedAt);
  timeValue(verifiedAt, "official exchange trusted verification verifiedAt");
  if (!clean(verification?.signedBy)
    || !clean(verification?.verifiedBy)
    || verification?.signatureVerified !== true) {
    throw new Error("external signer, server verifier and successful signature verification are required");
  }
  if (timeValue(verifiedAt, "official exchange trusted verification verifiedAt")
    < timeValue(issuedAt, "official exchange receipt issuedAt")) {
    throw new Error("official exchange verification cannot precede receipt issuance");
  }
  const key = selectSigningKey(keyring, verifiedAt);
  const receiptId = clean(verification?.receiptId);
  if (!receiptId) throw new Error("official exchange server receiptId is required");
  prepared.trustedVerification = {
    attestationOrigin: TRUSTED_ATTESTATION_ORIGIN,
    verificationSource: TRUSTED_VERIFICATION_SOURCE,
    signatureVerified: true,
    signedBy: clean(verification.signedBy),
    verifiedBy: clean(verification.verifiedBy),
    verifiedAt,
    algorithm: "HMAC-SHA256",
    keyId: key.keyId,
    receiptId
  };
  prepared.trustedVerification.receiptSignature = createHmac("sha256", key.secret)
    .update(publicHealthOfficialExchangeReceiptPayload(prepared))
    .digest("hex");
  return prepared;
}

function verifyTrustedPublicHealthOfficialExchangeReceipt(
  record,
  keyring,
  at = new Date().toISOString()
) {
  const reasons = [];
  try {
    assertPurpose(keyring);
    validateReceiptInput(record);
  } catch (error) {
    reasons.push(error.message);
  }
  const trust = record?.trustedVerification || {};
  if (clean(trust.attestationOrigin).toLowerCase() !== TRUSTED_ATTESTATION_ORIGIN) reasons.push("official exchange attestation origin is not trusted");
  if (clean(trust.verificationSource).toLowerCase() !== TRUSTED_VERIFICATION_SOURCE) reasons.push("official exchange verification source is not trusted");
  if (trust.signatureVerified !== true) reasons.push("official exchange signature was not server verified");
  if (clean(trust.algorithm).toUpperCase() !== "HMAC-SHA256") reasons.push("official exchange receipt algorithm is not approved");
  if (!clean(trust.signedBy) || !clean(trust.verifiedBy) || !clean(trust.verifiedAt) || !clean(trust.receiptId)) {
    reasons.push("complete official exchange trusted verifier metadata is required");
  }
  const signature = clean(trust.receiptSignature).toLowerCase();
  if (!SHA256_PATTERN.test(signature)) reasons.push("valid official exchange server receipt signature is required");
  let resolved = { ok: false, reason: "keyring-invalid" };
  try {
    assertPurpose(keyring);
    resolved = resolveVerificationKey(keyring, clean(trust.keyId), at);
  } catch {
    resolved = { ok: false, reason: "keyring-invalid" };
  }
  if (!resolved.ok) reasons.push(`official exchange receipt ${resolved.reason}`);
  if (resolved.ok && SHA256_PATTERN.test(signature)) {
    const expected = createHmac("sha256", resolved.key.secret)
      .update(publicHealthOfficialExchangeReceiptPayload(record))
      .digest("hex");
    if (!timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"))) {
      reasons.push("official exchange receipt signature mismatch");
    }
  }
  try {
    const now = timeValue(at, "official exchange registry at");
    const issuedAt = timeValue(record?.issuedAt, "official exchange receipt issuedAt");
    const verifiedAt = timeValue(trust.verifiedAt, "official exchange trusted verification verifiedAt");
    if (issuedAt > now || verifiedAt > now) reasons.push("official exchange receipt timestamp is in the future");
    if (verifiedAt < issuedAt) reasons.push("official exchange verification precedes receipt issuance");
  } catch (error) {
    if (!reasons.includes(error.message)) reasons.push(error.message);
  }
  return {
    ok: reasons.length === 0,
    reason: reasons[0] || "trusted-verified",
    reasons
  };
}

function buildPublicHealthOfficialExchangeReceiptRegistry({
  receipts = [],
  keyring = {},
  at = new Date().toISOString()
} = {}) {
  const records = Array.isArray(receipts) ? clone(receipts) : [];
  const findings = [];
  const recordById = new Map();
  const serverReceiptIds = new Set();
  const externalReceiptCodes = new Set();
  records.forEach((record) => {
    const id = clean(record?.id);
    const serverReceiptId = clean(record?.trustedVerification?.receiptId);
    const externalReceiptCode = clean(record?.externalReceiptCode);
    const verification = verifyTrustedPublicHealthOfficialExchangeReceipt(record, keyring, at);
    const reasons = [...verification.reasons];
    if (!id || recordById.has(id)) reasons.push("official exchange receipt id replay detected");
    if (!serverReceiptId || serverReceiptIds.has(serverReceiptId)) reasons.push("official exchange server receipt replay detected");
    if (!externalReceiptCode || externalReceiptCodes.has(externalReceiptCode)) reasons.push("official exchange external receipt replay detected");
    if (!reasons.length) {
      recordById.set(id, record);
      serverReceiptIds.add(serverReceiptId);
      externalReceiptCodes.add(externalReceiptCode);
    } else {
      findings.push({
        code: "public-health-official-exchange-receipt-invalid",
        receiptId: id || "missing-receipt-id",
        reasons
      });
    }
  });
  const invalidPredecessorIds = new Set(findings.map((item) => item.receiptId));
  [...recordById.values()].filter((record) => record.stage === "feedback").forEach((record) => {
    const predecessor = recordById.get(clean(record.predecessorRecordId));
    const reasons = [];
    if (!predecessor
      || invalidPredecessorIds.has(clean(record.predecessorRecordId))
      || clean(predecessor.stage) !== "official-report"
      || clean(predecessor.alertId) !== clean(record.alertId)
      || clean(predecessor.reportId) !== clean(record.reportId)
      || clean(predecessor.trustedVerification?.receiptId) !== clean(record.predecessorReceiptId)
      || publicHealthOfficialExchangeReceiptBindingDigest(predecessor)
        !== normalizeDigest(record.predecessorBindingDigest)) {
      reasons.push("feedback predecessor binding mismatch");
    }
    if (predecessor
      && timeValue(record.issuedAt, "feedback receipt issuedAt")
        < timeValue(predecessor.issuedAt, "official-report receipt issuedAt")) {
      reasons.push("feedback receipt precedes official-report receipt");
    }
    if (reasons.length) {
      findings.push({
        code: "public-health-official-exchange-chain-invalid",
        receiptId: clean(record.id),
        reasons
      });
    }
  });
  const invalidIds = new Set(findings.map((item) => item.receiptId));
  const trustedReceipts = [...recordById.values()].filter((record) => !invalidIds.has(clean(record.id)));
  let keyringSummary;
  try {
    assertPurpose(keyring);
    keyringSummary = summarizeKeyring(keyring, at);
  } catch (error) {
    keyringSummary = {
      ok: false,
      productionReady: false,
      activeKeyId: "",
      keys: [],
      blockers: [error.message]
    };
  }
  return {
    ok: findings.length === 0,
    generatedAt: at,
    summary: {
      receipts: records.length,
      trustedReceipts: trustedReceipts.length,
      officialReports: trustedReceipts.filter((item) => item.stage === "official-report").length,
      feedbacks: trustedReceipts.filter((item) => item.stage === "feedback").length,
      findings: findings.length,
      keyringReady: keyringSummary.productionReady === true
    },
    trustedReceipts,
    findings,
    keyring: keyringSummary,
    blockers: [
      "Trusted official exchange receipts prove business delivery only.",
      "Production endpoint acceptance, continuous receipt delivery evidence and formal launch approval are still required."
    ],
    productionReady: false
  };
}

module.exports = {
  PUBLIC_HEALTH_OFFICIAL_EXCHANGE_RECEIPT_PURPOSE,
  PUBLIC_HEALTH_OFFICIAL_EXCHANGE_RECEIPT_VERSION,
  PUBLIC_HEALTH_OFFICIAL_EXCHANGE_STAGES,
  buildPublicHealthOfficialExchangeReceiptRegistry,
  issueTrustedPublicHealthOfficialExchangeReceipt,
  publicHealthOfficialExchangeReceiptBindingDigest,
  publicHealthOfficialExchangeReceiptPayload,
  verifyTrustedPublicHealthOfficialExchangeReceipt
};
