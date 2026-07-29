"use strict";

const { createHmac, timingSafeEqual } = require("node:crypto");
const {
  resolveVerificationKey,
  selectSigningKey,
  summarizeKeyring
} = require("./public-health-external-keyring-service");
const {
  RESPIRATORY_PANEL,
  buildPublicHealthRespiratoryPathogenSurveillance
} = require("./public-health-respiratory-pathogen-surveillance-service");

const RESPIRATORY_NETWORK_EVIDENCE_PURPOSE = "public-health-respiratory-network-evidence";
const RESPIRATORY_NETWORK_RECEIPT_VERSION = "ph-respiratory-network-evidence-v1";
const TRUSTED_ATTESTATION_ORIGIN = "server-generated";
const TRUSTED_VERIFICATION_SOURCE = "server-evidence-store";
const REQUIRED_RESPIRATORY_NETWORK_EVIDENCE = Object.freeze([
  { type: "panel-standard-mapping", owner: "cdc-surveillance", label: "Respiratory panel standard mapping review" },
  { type: "sentinel-network-authorization", owner: "health-commission", label: "Sentinel laboratory network authorization" },
  { type: "laboratory-quality-qualification", owner: "laboratory-quality", label: "Laboratory quality and proficiency qualification" },
  { type: "data-sharing-authorization", owner: "data-governance", label: "Laboratory data sharing authorization" },
  { type: "privacy-security-review", owner: "security-compliance", label: "Privacy and security review" },
  { type: "continuity-observation-acceptance", owner: "cdc-surveillance", label: "Sustained observation acceptance" }
]);
const REQUIRED_EVIDENCE_TYPES = new Set(REQUIRED_RESPIRATORY_NETWORK_EVIDENCE.map((item) => item.type));
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MINIMUM_CONSECUTIVE_QUALITY_DAYS = 3;

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
  if (clean(keyring?.purpose) !== RESPIRATORY_NETWORK_EVIDENCE_PURPOSE) {
    throw new Error(`respiratory network evidence keyring purpose must be ${RESPIRATORY_NETWORK_EVIDENCE_PURPOSE}`);
  }
}

function respiratoryNetworkEvidencePayload(record = {}) {
  const trust = record.trustedVerification || {};
  return [
    RESPIRATORY_NETWORK_RECEIPT_VERSION,
    clean(record.id),
    clean(record.institutionId),
    clean(record.evidenceType).toLowerCase(),
    clean(record.panelId),
    String(Number(record.panelVersion)),
    clean(record.status).toLowerCase(),
    clean(record.artifactName),
    normalizeDigest(record.artifactDigest),
    clean(record.validFrom),
    clean(record.expiresAt),
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

function validateEvidenceInput(record = {}) {
  const evidenceType = clean(record.evidenceType).toLowerCase();
  const artifactDigest = normalizeDigest(record.artifactDigest);
  if (!clean(record.id) || !clean(record.institutionId)) throw new Error("evidence id and institutionId are required");
  if (!REQUIRED_EVIDENCE_TYPES.has(evidenceType)) throw new Error("known respiratory network evidenceType is required");
  if (clean(record.panelId) !== RESPIRATORY_PANEL.id || Number(record.panelVersion) !== RESPIRATORY_PANEL.version) {
    throw new Error("current respiratory panelId and panelVersion are required");
  }
  if (clean(record.status).toLowerCase() !== "verified") throw new Error("verified evidence status is required");
  if (!clean(record.artifactName) || !SHA256_PATTERN.test(artifactDigest)) {
    throw new Error("artifactName and SHA-256 artifactDigest are required");
  }
  const validFrom = timeValue(record.validFrom, "evidence validFrom");
  const expiresAt = timeValue(record.expiresAt, "evidence expiresAt");
  if (expiresAt <= validFrom) throw new Error("evidence expiresAt must be after validFrom");
  return { evidenceType, artifactDigest };
}

function issueTrustedRespiratoryNetworkEvidenceReceipt(record, verification, keyring) {
  assertPurpose(keyring);
  const normalized = validateEvidenceInput(record);
  const verifiedAt = clean(verification?.verifiedAt);
  timeValue(verifiedAt, "trusted verification verifiedAt");
  if (!clean(verification?.signedBy) || !clean(verification?.verifiedBy) || verification?.signatureVerified !== true) {
    throw new Error("external signer, server verifier and successful signature verification are required");
  }
  const key = selectSigningKey(keyring, verifiedAt);
  const receiptId = clean(verification.receiptId);
  if (!receiptId) throw new Error("server receiptId is required");
  const trustedRecord = {
    ...clone(record),
    evidenceType: normalized.evidenceType,
    artifactDigest: normalized.artifactDigest,
    status: "verified",
    productionReady: false,
    trustedVerification: {
      attestationOrigin: TRUSTED_ATTESTATION_ORIGIN,
      verificationSource: TRUSTED_VERIFICATION_SOURCE,
      signatureVerified: true,
      signedBy: clean(verification.signedBy),
      verifiedBy: clean(verification.verifiedBy),
      verifiedAt,
      algorithm: "HMAC-SHA256",
      keyId: key.keyId,
      receiptId
    }
  };
  trustedRecord.trustedVerification.receiptSignature = createHmac("sha256", key.secret)
    .update(respiratoryNetworkEvidencePayload(trustedRecord))
    .digest("hex");
  return trustedRecord;
}

function verifyTrustedRespiratoryNetworkEvidence(record, keyring, at = new Date().toISOString()) {
  const reasons = [];
  let normalized;
  try {
    assertPurpose(keyring);
    normalized = validateEvidenceInput(record);
  } catch (error) {
    reasons.push(error.message);
  }
  const trust = record?.trustedVerification || {};
  if (clean(trust.attestationOrigin).toLowerCase() !== TRUSTED_ATTESTATION_ORIGIN) reasons.push("attestation origin is not trusted");
  if (clean(trust.verificationSource).toLowerCase() !== TRUSTED_VERIFICATION_SOURCE) reasons.push("verification source is not trusted");
  if (trust.signatureVerified !== true) reasons.push("external signature was not server verified");
  if (clean(trust.algorithm).toUpperCase() !== "HMAC-SHA256") reasons.push("receipt algorithm is not approved");
  if (!clean(trust.signedBy) || !clean(trust.verifiedBy) || !clean(trust.verifiedAt) || !clean(trust.receiptId)) {
    reasons.push("complete trusted verifier metadata is required");
  }
  const signature = clean(trust.receiptSignature).toLowerCase();
  if (!SHA256_PATTERN.test(signature)) reasons.push("valid server receipt signature is required");
  let resolved = { ok: false, reason: "keyring-invalid" };
  try {
    assertPurpose(keyring);
    resolved = resolveVerificationKey(keyring, clean(trust.keyId), at);
  } catch {
    resolved = { ok: false, reason: "keyring-invalid" };
  }
  if (!resolved.ok) reasons.push(`receipt ${resolved.reason}`);
  if (resolved.ok && SHA256_PATTERN.test(signature)) {
    const expected = createHmac("sha256", resolved.key.secret)
      .update(respiratoryNetworkEvidencePayload(record))
      .digest("hex");
    if (!timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"))) reasons.push("receipt signature mismatch");
  }
  try {
    const now = timeValue(at, "readiness at");
    if (now < timeValue(record.validFrom, "evidence validFrom")) reasons.push("evidence is not yet valid");
    if (now >= timeValue(record.expiresAt, "evidence expiresAt")) reasons.push("evidence has expired");
    if (clean(trust.verifiedAt) && timeValue(trust.verifiedAt, "trusted verification verifiedAt") > now) reasons.push("verification timestamp is in the future");
  } catch (error) {
    if (!reasons.includes(error.message)) reasons.push(error.message);
  }
  return {
    ok: reasons.length === 0,
    reason: reasons[0] || "trusted-verified",
    reasons,
    record: reasons.length ? null : {
      id: clean(record.id),
      institutionId: clean(record.institutionId),
      evidenceType: normalized?.evidenceType || clean(record.evidenceType).toLowerCase(),
      artifactName: clean(record.artifactName),
      artifactDigest: normalized?.artifactDigest || normalizeDigest(record.artifactDigest),
      validFrom: clean(record.validFrom),
      expiresAt: clean(record.expiresAt),
      verifiedBy: clean(trust.verifiedBy),
      verifiedAt: clean(trust.verifiedAt),
      keyId: clean(trust.keyId),
      receiptId: clean(trust.receiptId),
      productionReady: false
    }
  };
}

function longestConsecutiveDayRun(values) {
  const days = [...new Set(values.map((value) => clean(value).slice(0, 10)).filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)))]
    .map((value) => Date.parse(`${value}T00:00:00.000Z`))
    .sort((a, b) => a - b);
  let longest = days.length ? 1 : 0;
  let current = longest;
  for (let index = 1; index < days.length; index += 1) {
    current = days[index] - days[index - 1] === 86400000 ? current + 1 : 1;
    longest = Math.max(longest, current);
  }
  return longest;
}

function buildPublicHealthRespiratoryNetworkReadiness({ data = {}, evidenceRecords = [], keyring = {}, at = new Date().toISOString() } = {}) {
  const surveillance = buildPublicHealthRespiratoryPathogenSurveillance({ data, at });
  const keyringSummary = (() => {
    try {
      assertPurpose(keyring);
      return summarizeKeyring(keyring, at);
    } catch (error) {
      return { ok: false, productionReady: false, blockers: [error.message], keys: [] };
    }
  })();
  const accepted = [];
  const rejected = [];
  (Array.isArray(evidenceRecords) ? evidenceRecords : []).forEach((record) => {
    const result = verifyTrustedRespiratoryNetworkEvidence(record, keyring, at);
    if (result.ok) accepted.push(result.record);
    else rejected.push({ id: clean(record?.id) || "missing-evidence-id", institutionId: clean(record?.institutionId), reasons: result.reasons });
  });
  const duplicateValues = (field) => {
    const counts = accepted.reduce((map, item) => map.set(item[field], (map.get(item[field]) || 0) + 1), new Map());
    return [...counts.entries()].filter(([, count]) => count > 1).map(([value]) => value);
  };
  const duplicateEvidenceIds = duplicateValues("id");
  const duplicateReceiptIds = duplicateValues("receiptId");
  const integrityFindings = [
    ...duplicateEvidenceIds.map((id) => ({ code: "respiratory-network-evidence-id-replay", id })),
    ...duplicateReceiptIds.map((receiptId) => ({ code: "respiratory-network-receipt-replay", receiptId }))
  ];
  const institutionIds = [...new Set([
    ...surveillance.batches.map((item) => item.institutionId),
    ...accepted.map((item) => item.institutionId),
    ...rejected.map((item) => item.institutionId)
  ].filter(Boolean))].sort();
  const institutions = institutionIds.map((institutionId) => {
    const evidence = accepted.filter((item) => item.institutionId === institutionId);
    const evidenceTypeCounts = evidence.reduce((map, item) => map.set(item.evidenceType, (map.get(item.evidenceType) || 0) + 1), new Map());
    const duplicateEvidenceTypes = [...evidenceTypeCounts.entries()].filter(([, count]) => count > 1).map(([type]) => type);
    const missingEvidenceTypes = REQUIRED_RESPIRATORY_NETWORK_EVIDENCE.map((item) => item.type).filter((type) => !evidenceTypeCounts.has(type));
    const observedDates = surveillance.batches
      .filter((item) => item.institutionId === institutionId && ["human-verified", "published", "published-no-positive"].includes(item.status))
      .map((item) => item.observedAt);
    const consecutiveQualityDays = longestConsecutiveDayRun(observedDates);
    const continuityReady = consecutiveQualityDays >= MINIMUM_CONSECUTIVE_QUALITY_DAYS;
    const evidenceReady = missingEvidenceTypes.length === 0 && duplicateEvidenceTypes.length === 0;
    const replayDetected = evidence.some((item) => duplicateEvidenceIds.includes(item.id) || duplicateReceiptIds.includes(item.receiptId));
    const technicalLaunchReady = surveillance.ok && evidenceReady && continuityReady && keyringSummary.productionReady === true && !replayDetected;
    return {
      institutionId,
      evidenceReady,
      continuityReady,
      technicalLaunchReady,
      productionReady: false,
      trustedEvidence: evidence.length,
      missingEvidenceTypes,
      duplicateEvidenceTypes,
      replayDetected,
      observedQualityDays: new Set(observedDates.map((item) => clean(item).slice(0, 10))).size,
      consecutiveQualityDays,
      blockers: [
        ...missingEvidenceTypes.map((type) => `trusted evidence missing: ${type}`),
        ...duplicateEvidenceTypes.map((type) => `duplicate trusted evidence must be reconciled: ${type}`),
        ...(replayDetected ? ["evidence id or server receipt replay must be reconciled"] : []),
        ...(continuityReady ? [] : [`at least ${MINIMUM_CONSECUTIVE_QUALITY_DAYS} consecutive human-verified quality days are required`]),
        ...(keyringSummary.productionReady ? [] : ["managed respiratory evidence signing key is not ready"]),
        ...(surveillance.ok ? [] : ["respiratory surveillance integrity findings must be resolved"])
      ]
    };
  });
  const technicalLaunchReady = institutions.length > 0 && institutions.every((item) => item.technicalLaunchReady) && rejected.length === 0 && integrityFindings.length === 0;
  const externalProductionBlockers = [
    "Trusted site cutover evidence must be linked to the central public-health launch gate.",
    "P0/P1 cutover blockers, production handoff and formal launch approval must be closed by authorized owners."
  ];
  return {
    generatedAt: at,
    ok: surveillance.ok && rejected.length === 0 && integrityFindings.length === 0,
    functionalState: technicalLaunchReady ? "software-release-ready" : "respiratory-network-readiness-evidence-incomplete",
    formalGoLiveState: technicalLaunchReady ? "blocked-until-central-site-evidence-and-formal-launch-approval" : "blocked-until-respiratory-network-evidence-complete",
    technicalLaunchReady,
    productionReady: false,
    summary: {
      requiredEvidenceTypes: REQUIRED_RESPIRATORY_NETWORK_EVIDENCE.length,
      institutions: institutions.length,
      technicalLaunchReadyInstitutions: institutions.filter((item) => item.technicalLaunchReady).length,
      trustedEvidence: accepted.length,
      rejectedEvidence: rejected.length,
      integrityFindings: integrityFindings.length,
      minimumConsecutiveQualityDays: MINIMUM_CONSECUTIVE_QUALITY_DAYS,
      keyringReady: keyringSummary.productionReady === true
    },
    evidenceRequirements: clone(REQUIRED_RESPIRATORY_NETWORK_EVIDENCE),
    institutions,
    rejectedEvidence: rejected,
    integrityFindings,
    keyring: keyringSummary,
    externalProductionBlockers,
    blockers: technicalLaunchReady
      ? externalProductionBlockers
      : [...new Set(institutions.flatMap((item) => item.blockers)
        .concat(rejected.length ? ["untrusted respiratory network evidence must be rejected or replaced"] : [])
        .concat(integrityFindings.length ? ["evidence and receipt replay findings must be resolved"] : []))]
  };
}

module.exports = {
  MINIMUM_CONSECUTIVE_QUALITY_DAYS,
  REQUIRED_RESPIRATORY_NETWORK_EVIDENCE,
  RESPIRATORY_NETWORK_EVIDENCE_PURPOSE,
  buildPublicHealthRespiratoryNetworkReadiness,
  issueTrustedRespiratoryNetworkEvidenceReceipt,
  respiratoryNetworkEvidencePayload,
  verifyTrustedRespiratoryNetworkEvidence
};
