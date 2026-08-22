"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash, createPublicKey, verify } = require("node:crypto");
const {
  SHA256,
  assertMetadataOnly,
  sha256,
  stableStringify
} = require("./technical-evidence");

const MAX_TRUST_FILE_BYTES = 1024 * 1024;
const SIGNED_ENVELOPE_SCHEMA = "platform-governance.signed-evidence-envelope.v1";
const TRUST_ANCHORS_SCHEMA = "platform-governance.evidence-trust-anchors.v1";
const PRODUCTION_DECISION_SCHEMA = "platform-governance.production-evidence-trust-decision.v1";
const PRODUCTION_EVIDENCE_PURPOSE = "production-release-evidence-verification";
const REQUIRED_PRODUCTION_ROLES = Object.freeze(["release-verifier", "security-verifier"]);
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,119}$/;
const SIGNATURE = /^[A-Za-z0-9_-]{80,120}$/;
const SOURCE_COMMIT = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const EVIDENCE_FINGERPRINT = /^[a-f0-9]{64}$/;
const CONTROLLED_REFERENCE = /^(?:controlled|evidence|archive|artifact|ticket|vault):\/\/[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]+$/;

function trustError(code) {
  return Object.assign(new Error("production evidence trust verification failed closed"), {
    code,
    statusCode: 400
  });
}

function sha256Bytes(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function assertOnlyKeys(value, allowed, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw trustError(code);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw trustError(code);
}

function requiredAbsolutePath(value) {
  const candidate = String(value || "").trim();
  if (!candidate || !path.isAbsolute(candidate)) {
    throw trustError("PRODUCTION_EVIDENCE_TRUST_ABSOLUTE_PATH_REQUIRED");
  }
  return path.resolve(candidate);
}

function readBoundedJsonFile(file, options = {}) {
  const target = requiredAbsolutePath(file);
  let pathStat;
  try {
    pathStat = fs.lstatSync(target);
  } catch {
    throw trustError("PRODUCTION_EVIDENCE_TRUST_FILE_UNAVAILABLE");
  }
  const maximumBytes = Number(options.maximumBytes || MAX_TRUST_FILE_BYTES);
  if (!pathStat.isFile() || pathStat.isSymbolicLink()) {
    throw trustError("PRODUCTION_EVIDENCE_TRUST_FILE_INVALID");
  }
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || pathStat.size > maximumBytes) {
    throw trustError("PRODUCTION_EVIDENCE_TRUST_FILE_TOO_LARGE");
  }
  let descriptor;
  let bytes;
  let document;
  try {
    const noFollow = Number(fs.constants.O_NOFOLLOW || 0);
    descriptor = fs.openSync(target, fs.constants.O_RDONLY | noFollow);
    const openedStat = fs.fstatSync(descriptor);
    if (!openedStat.isFile()
      || openedStat.dev !== pathStat.dev
      || openedStat.ino !== pathStat.ino
      || openedStat.size > maximumBytes) {
      throw trustError("PRODUCTION_EVIDENCE_TRUST_FILE_INVALID");
    }
    bytes = fs.readFileSync(descriptor);
    if (bytes.length > maximumBytes) {
      throw trustError("PRODUCTION_EVIDENCE_TRUST_FILE_TOO_LARGE");
    }
    document = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    if (String(error?.code || "").startsWith("PRODUCTION_EVIDENCE_TRUST_")) throw error;
    throw trustError("PRODUCTION_EVIDENCE_TRUST_FILE_INVALID_JSON");
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  try {
    assertMetadataOnly(document, "productionEvidenceTrust");
  } catch {
    throw trustError("PRODUCTION_EVIDENCE_TRUST_SENSITIVE_FIELD");
  }
  return Object.freeze({ document, digest: sha256Bytes(bytes), size: bytes.length });
}

function productionEvidenceTrustConfig(env = process.env) {
  const anchorsFile = requiredAbsolutePath(env.PRODUCTION_EVIDENCE_TRUST_ANCHORS_FILE);
  const envelopeFile = requiredAbsolutePath(env.PRODUCTION_EVIDENCE_TRUST_ENVELOPE_FILE);
  const expectedAnchorsDigest = String(env.PRODUCTION_EVIDENCE_TRUST_ANCHORS_SHA256 || "").trim().toLowerCase();
  if (!SHA256.test(expectedAnchorsDigest)) {
    throw trustError("PRODUCTION_EVIDENCE_TRUST_ANCHOR_DIGEST_REQUIRED");
  }
  return Object.freeze({ anchorsFile, envelopeFile, expectedAnchorsDigest });
}

function parseInstant(value, code) {
  const instant = Date.parse(String(value || ""));
  if (!Number.isFinite(instant)) throw trustError(code);
  return instant;
}

function validateTrustAnchors(document) {
  assertOnlyKeys(document, new Set(["schema", "generatedAt", "keys"]), "PRODUCTION_EVIDENCE_TRUST_ANCHORS_INVALID");
  if (document.schema !== TRUST_ANCHORS_SCHEMA
    || !Array.isArray(document.keys)
    || document.keys.length < REQUIRED_PRODUCTION_ROLES.length
    || document.keys.length > 100) {
    throw trustError("PRODUCTION_EVIDENCE_TRUST_ANCHORS_INVALID");
  }
  parseInstant(document.generatedAt, "PRODUCTION_EVIDENCE_TRUST_ANCHORS_INVALID");
  const keyIds = new Set();
  const anchors = document.keys.map((anchor) => {
    assertOnlyKeys(
      anchor,
      new Set(["keyId", "signerId", "roles", "algorithm", "status", "validFrom", "validUntil", "publicKeyPem", "publicKeyDigest"]),
      "PRODUCTION_EVIDENCE_TRUST_ANCHOR_INVALID"
    );
    const keyId = String(anchor.keyId || "");
    const signerId = String(anchor.signerId || "");
    const roles = Array.isArray(anchor.roles) ? anchor.roles.map((role) => String(role || "")) : [];
    const validFrom = parseInstant(anchor.validFrom, "PRODUCTION_EVIDENCE_TRUST_ANCHOR_INVALID");
    const validUntil = parseInstant(anchor.validUntil, "PRODUCTION_EVIDENCE_TRUST_ANCHOR_INVALID");
    if (!IDENTIFIER.test(keyId)
      || !IDENTIFIER.test(signerId)
      || keyIds.has(keyId)
      || roles.length < 1
      || new Set(roles).size !== roles.length
      || roles.some((role) => !IDENTIFIER.test(role))
      || anchor.algorithm !== "Ed25519"
      || !new Set(["active", "revoked", "retired"]).has(anchor.status)
      || validUntil <= validFrom
      || !SHA256.test(String(anchor.publicKeyDigest || "").toLowerCase())
      || !String(anchor.publicKeyPem || "").includes("BEGIN PUBLIC KEY")) {
      throw trustError("PRODUCTION_EVIDENCE_TRUST_ANCHOR_INVALID");
    }
    let publicKey;
    try {
      publicKey = createPublicKey(anchor.publicKeyPem);
    } catch {
      throw trustError("PRODUCTION_EVIDENCE_TRUST_PUBLIC_KEY_INVALID");
    }
    if (publicKey.asymmetricKeyType !== "ed25519") {
      throw trustError("PRODUCTION_EVIDENCE_TRUST_PUBLIC_KEY_INVALID");
    }
    const keyDigest = sha256Bytes(publicKey.export({ type: "spki", format: "der" }));
    if (keyDigest !== String(anchor.publicKeyDigest).toLowerCase()) {
      throw trustError("PRODUCTION_EVIDENCE_TRUST_PUBLIC_KEY_DIGEST_MISMATCH");
    }
    keyIds.add(keyId);
    return Object.freeze({
      keyId,
      signerId,
      roles: Object.freeze(roles),
      status: anchor.status,
      validFrom,
      validUntil,
      publicKey,
      publicKeyDigest: keyDigest
    });
  });
  return Object.freeze(anchors);
}

function signedEnvelopeSubject(envelope = {}) {
  return Object.freeze({
    schema: String(envelope.schema || ""),
    purpose: String(envelope.purpose || ""),
    record: envelope.record
  });
}

function signedEnvelopeSignaturePayload(envelope, signature = {}) {
  return Object.freeze({
    envelope: signedEnvelopeSubject(envelope),
    signer: Object.freeze({
      keyId: String(signature.keyId || ""),
      signerId: String(signature.signerId || ""),
      role: String(signature.role || "")
    })
  });
}

function validateProductionDecisionRecord(record) {
  assertOnlyKeys(
    record,
    new Set([
      "schema", "decisionId", "releaseId", "sourceCommit", "artifactDigest", "evidenceFingerprint",
      "evidenceRecordsDigest", "registryEntryDigest", "registryAttestationRef", "registryAttestationDigest",
      "registryAttestationVerified", "productionEvidenceVerified", "issuedAt", "validUntil"
    ]),
    "PRODUCTION_EVIDENCE_TRUST_DECISION_INVALID"
  );
  if (record.schema !== PRODUCTION_DECISION_SCHEMA
    || !IDENTIFIER.test(String(record.decisionId || ""))
    || !IDENTIFIER.test(String(record.releaseId || ""))
    || !SOURCE_COMMIT.test(String(record.sourceCommit || "").toLowerCase())
    || !SHA256.test(String(record.artifactDigest || "").toLowerCase())
    || !EVIDENCE_FINGERPRINT.test(String(record.evidenceFingerprint || "").toLowerCase())
    || !SHA256.test(String(record.evidenceRecordsDigest || "").toLowerCase())
    || !SHA256.test(String(record.registryEntryDigest || "").toLowerCase())
    || !CONTROLLED_REFERENCE.test(String(record.registryAttestationRef || ""))
    || !SHA256.test(String(record.registryAttestationDigest || "").toLowerCase())
    || record.registryAttestationVerified !== true
    || record.productionEvidenceVerified !== true) {
    throw trustError("PRODUCTION_EVIDENCE_TRUST_DECISION_INVALID");
  }
  parseInstant(record.issuedAt, "PRODUCTION_EVIDENCE_TRUST_DECISION_TIME_INVALID");
  parseInstant(record.validUntil, "PRODUCTION_EVIDENCE_TRUST_DECISION_TIME_INVALID");
  return record;
}

function verifySignedEnvelope(options = {}) {
  const envelope = options.envelope;
  const anchors = Array.isArray(options.anchors) ? options.anchors : [];
  const requiredRoles = Array.isArray(options.requiredRoles) ? options.requiredRoles : [];
  assertOnlyKeys(envelope, new Set(["schema", "purpose", "record", "signatures"]), "PRODUCTION_EVIDENCE_TRUST_ENVELOPE_INVALID");
  if (envelope.schema !== SIGNED_ENVELOPE_SCHEMA
    || envelope.purpose !== options.expectedPurpose
    || !envelope.record
    || !Array.isArray(envelope.signatures)
    || requiredRoles.length < 1
    || envelope.signatures.length !== requiredRoles.length) {
    throw trustError("PRODUCTION_EVIDENCE_TRUST_ENVELOPE_INVALID");
  }
  if (typeof options.validateRecord === "function") options.validateRecord(envelope.record);
  const issuedAt = parseInstant(envelope.record.issuedAt, "PRODUCTION_EVIDENCE_TRUST_DECISION_TIME_INVALID");
  const validUntil = parseInstant(envelope.record.validUntil, "PRODUCTION_EVIDENCE_TRUST_DECISION_TIME_INVALID");
  const evaluatedAt = parseInstant(options.now || new Date().toISOString(), "PRODUCTION_EVIDENCE_TRUST_EVALUATION_TIME_INVALID");
  const maximumValidityMs = Number(options.maximumValidityMs || 24 * 60 * 60 * 1000);
  const futureSkewMs = Number(options.futureSkewMs || 5 * 60 * 1000);
  if (!Number.isSafeInteger(maximumValidityMs)
    || maximumValidityMs < 1
    || validUntil <= issuedAt
    || validUntil - issuedAt > maximumValidityMs
    || evaluatedAt + futureSkewMs < issuedAt
    || evaluatedAt > validUntil) {
    throw trustError("PRODUCTION_EVIDENCE_TRUST_DECISION_EXPIRED");
  }
  const expectedRecord = options.expectedRecord || {};
  for (const [key, value] of Object.entries(expectedRecord)) {
    if (stableStringify(envelope.record[key]) !== stableStringify(value)) {
      throw trustError("PRODUCTION_EVIDENCE_TRUST_CONTEXT_MISMATCH");
    }
  }
  const anchorByKeyId = new Map(anchors.map((anchor) => [anchor.keyId, anchor]));
  const roles = new Set();
  const signerIds = new Set();
  const keyIds = new Set();
  for (const signature of envelope.signatures) {
    assertOnlyKeys(signature, new Set(["keyId", "signerId", "role", "signature"]), "PRODUCTION_EVIDENCE_TRUST_SIGNATURE_INVALID");
    const keyId = String(signature.keyId || "");
    const signerId = String(signature.signerId || "");
    const role = String(signature.role || "");
    const encoded = String(signature.signature || "");
    const anchor = anchorByKeyId.get(keyId);
    if (!anchor
      || anchor.signerId !== signerId
      || !requiredRoles.includes(role)
      || !anchor.roles.includes(role)
      || anchor.status !== "active"
      || roles.has(role)
      || signerIds.has(signerId)
      || keyIds.has(keyId)
      || issuedAt < anchor.validFrom
      || issuedAt >= anchor.validUntil
      || evaluatedAt >= anchor.validUntil
      || !SIGNATURE.test(encoded)) {
      throw trustError(anchor?.status === "revoked"
        ? "PRODUCTION_EVIDENCE_TRUST_KEY_REVOKED"
        : "PRODUCTION_EVIDENCE_TRUST_SIGNATURE_INVALID");
    }
    const bytes = Buffer.from(encoded, "base64url");
    const subject = Buffer.from(stableStringify(signedEnvelopeSignaturePayload(envelope, signature)));
    if (bytes.length !== 64 || !verify(null, subject, anchor.publicKey, bytes)) {
      throw trustError("PRODUCTION_EVIDENCE_TRUST_SIGNATURE_INVALID");
    }
    roles.add(role);
    signerIds.add(signerId);
    keyIds.add(keyId);
  }
  if (requiredRoles.some((role) => !roles.has(role))) {
    throw trustError("PRODUCTION_EVIDENCE_TRUST_ROLE_INDEPENDENCE_REQUIRED");
  }
  return Object.freeze({
    record: Object.freeze({ ...envelope.record }),
    roles: Object.freeze([...roles].sort()),
    signerIds: Object.freeze([...signerIds].sort()),
    keyIds: Object.freeze([...keyIds].sort()),
    envelopeDigest: sha256(signedEnvelopeSubject(envelope))
  });
}

function createProductionTrustContextBinding(context = {}) {
  const manifest = context.manifest || {};
  const registryEntry = context.registryEntry || {};
  const productionEvidence = context.productionEvidence || {};
  const evidenceRecords = context.evidenceRecords || {};
  const externalAttestation = registryEntry.externalAttestation || {};
  return Object.freeze({
    schema: PRODUCTION_DECISION_SCHEMA,
    releaseId: String(manifest.releaseId || ""),
    sourceCommit: String(manifest.source?.commit || "").toLowerCase(),
    artifactDigest: String(manifest.artifact?.digest || "").toLowerCase(),
    evidenceFingerprint: String(productionEvidence.evidenceFingerprint || "").toLowerCase(),
    evidenceRecordsDigest: sha256(evidenceRecords),
    registryEntryDigest: sha256({
      releaseId: registryEntry.releaseId,
      sourceSha: registryEntry.sourceSha,
      sourceDirty: registryEntry.sourceDirty,
      source: registryEntry.source,
      artifactDigest: registryEntry.artifactDigest,
      externalAttestation
    }),
    registryAttestationRef: String(externalAttestation.evidenceRef || ""),
    registryAttestationDigest: String(externalAttestation.evidenceDigest || "").toLowerCase(),
    registryAttestationVerified: true,
    productionEvidenceVerified: true
  });
}

function loadTrustMaterial(config) {
  const anchorsFile = readBoundedJsonFile(config.anchorsFile);
  if (anchorsFile.digest !== config.expectedAnchorsDigest) {
    throw trustError("PRODUCTION_EVIDENCE_TRUST_ANCHORS_DIGEST_MISMATCH");
  }
  const envelopeFile = readBoundedJsonFile(config.envelopeFile);
  const anchors = validateTrustAnchors(anchorsFile.document);
  return Object.freeze({
    anchors,
    anchorsDigest: anchorsFile.digest,
    envelope: envelopeFile.document,
    envelopeFileDigest: envelopeFile.digest
  });
}

function createFileBackedProductionEvidenceTrustVerifier(options = {}) {
  const config = productionEvidenceTrustConfig(options.env || process.env);
  return async function verifyProductionEvidenceTrust(context = {}) {
    const material = loadTrustMaterial(config);
    const result = verifySignedEnvelope({
      envelope: material.envelope,
      anchors: material.anchors,
      expectedPurpose: PRODUCTION_EVIDENCE_PURPOSE,
      requiredRoles: REQUIRED_PRODUCTION_ROLES,
      validateRecord: validateProductionDecisionRecord,
      expectedRecord: createProductionTrustContextBinding(context),
      now: typeof options.now === "function" ? options.now() : options.now
    });
    return Object.freeze({
      registryAttestationVerified: true,
      productionEvidenceVerified: true,
      detail: "signed production evidence trust decision verified",
      verification: Object.freeze({
        decisionId: result.record.decisionId,
        envelopeDigest: result.envelopeDigest,
        roles: result.roles,
        signerCount: result.signerIds.length
      })
    });
  };
}

function providerFailureReason(error) {
  const code = String(error?.code || "");
  return /^PRODUCTION_EVIDENCE_TRUST_[A-Z0-9_]+$/.test(code)
    ? code
    : "PRODUCTION_EVIDENCE_TRUST_MATERIAL_UNAVAILABLE";
}

function inspectProductionEvidenceTrustProvider(env = process.env, options = {}) {
  try {
    const config = productionEvidenceTrustConfig(env);
    const material = loadTrustMaterial(config);
    const verification = verifySignedEnvelope({
      envelope: material.envelope,
      anchors: material.anchors,
      expectedPurpose: PRODUCTION_EVIDENCE_PURPOSE,
      requiredRoles: REQUIRED_PRODUCTION_ROLES,
      validateRecord: validateProductionDecisionRecord,
      now: typeof options.now === "function" ? options.now() : options.now
    });
    return Object.freeze({
      contract: PRODUCTION_DECISION_SCHEMA,
      configured: true,
      anchorsDigest: material.anchorsDigest,
      envelopeFileDigest: material.envelopeFileDigest,
      envelopeDigest: verification.envelopeDigest,
      signerCount: verification.signerIds.length,
      roles: verification.roles,
      externalEvidenceRequired: true,
      productionReady: false
    });
  } catch (error) {
    return Object.freeze({
      contract: PRODUCTION_DECISION_SCHEMA,
      configured: false,
      errorCode: "PRODUCTION_EVIDENCE_TRUST_PROVIDER_UNAVAILABLE",
      reasonCode: providerFailureReason(error),
      detail: "production evidence trust provider failed closed",
      externalEvidenceRequired: true,
      productionReady: false
    });
  }
}

module.exports = {
  MAX_TRUST_FILE_BYTES,
  PRODUCTION_DECISION_SCHEMA,
  PRODUCTION_EVIDENCE_PURPOSE,
  REQUIRED_PRODUCTION_ROLES,
  SIGNED_ENVELOPE_SCHEMA,
  TRUST_ANCHORS_SCHEMA,
  createFileBackedProductionEvidenceTrustVerifier,
  createProductionTrustContextBinding,
  inspectProductionEvidenceTrustProvider,
  loadTrustMaterial,
  productionEvidenceTrustConfig,
  providerFailureReason,
  readBoundedJsonFile,
  sha256Bytes,
  signedEnvelopeSignaturePayload,
  signedEnvelopeSubject,
  trustError,
  validateProductionDecisionRecord,
  validateTrustAnchors,
  verifySignedEnvelope
};
