"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createPublicKey, verify } = require("node:crypto");
const { deepFreeze, sha256, stableJson } = require("./region-manifest");

const TRUST_REGISTRY_SCHEMA = "regional-site-evidence-trust-registry-v1";
const ATTESTATION_SCHEMA = "regional-site-evidence-attestation-v1";
const SUBJECT_SCHEMA = "regional-site-evidence-attestation-subject-v1";
const TRUST_PURPOSE = "regional-site-evidence";
const MAX_TRUST_REGISTRY_BYTES = 512 * 1024;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,119}$/;
const PRINCIPAL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{2,159}$/;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{80,160}$/;
const REGION_CODE_PATTERN = /^\d{6}$/;
const KEY_STATES = Object.freeze(["active", "grace", "revoked"]);
const SIGNER_ROLES = Object.freeze(["custodian", "reviewer"]);
const REGISTRY_KEYS = Object.freeze(["schemaVersion", "generatedAt", "purpose", "keys"]);
const KEY_KEYS = Object.freeze([
  "keyId",
  "principalId",
  "role",
  "algorithm",
  "state",
  "regionCodes",
  "scopes",
  "validFrom",
  "validUntil",
  "publicKeyPem"
]);
const ATTESTATION_KEYS = Object.freeze([
  "schemaVersion",
  "purpose",
  "role",
  "keyId",
  "issuedAt",
  "subjectDigest",
  "signature"
]);

function trustError(code, message) {
  return Object.assign(new Error(message), { code, statusCode: 400 });
}

function exactKeys(value, expected) {
  return value && typeof value === "object" && !Array.isArray(value)
    && stableJson(Object.keys(value).sort()) === stableJson([...expected].sort());
}

function validTimestamp(value) {
  return typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));
}

function normalizeDigest(value) {
  const clean = String(value || "").trim().toLowerCase();
  if (/^[a-f0-9]{64}$/.test(clean)) return `sha256:${clean}`;
  return clean;
}

function trustEnvironmentKeys() {
  return Object.freeze({
    file: "REGIONAL_SITE_EVIDENCE_TRUST_REGISTRY_FILE",
    digest: "REGIONAL_SITE_EVIDENCE_TRUST_REGISTRY_SHA256"
  });
}

function resolveTrustRegistryFile(value) {
  const file = String(value || "").trim();
  if (!file || !path.isAbsolute(file)) {
    throw trustError(
      "REGIONAL_SITE_EVIDENCE_TRUST_PATH_INVALID",
      "regional site evidence trust registry must use an absolute path"
    );
  }
  return path.resolve(file);
}

function readTrustRegistryFile(file, expectedDigest, options = {}) {
  const resolved = resolveTrustRegistryFile(file);
  let stat;
  try {
    stat = fs.lstatSync(resolved);
  } catch {
    throw trustError(
      "REGIONAL_SITE_EVIDENCE_TRUST_FILE_UNAVAILABLE",
      "regional site evidence trust registry is unavailable"
    );
  }
  const maximumBytes = Number(options.maximumBytes) || MAX_TRUST_REGISTRY_BYTES;
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size <= 0 || stat.size > maximumBytes) {
    throw trustError(
      "REGIONAL_SITE_EVIDENCE_TRUST_FILE_BOUNDARY_INVALID",
      "regional site evidence trust registry must be a bounded non-empty regular file"
    );
  }
  const pinnedDigest = normalizeDigest(expectedDigest);
  if (!SHA256_PATTERN.test(pinnedDigest)) {
    throw trustError(
      "REGIONAL_SITE_EVIDENCE_TRUST_DIGEST_INVALID",
      "regional site evidence trust registry requires a SHA-256 pin"
    );
  }
  const bytes = fs.readFileSync(resolved);
  const actualDigest = `sha256:${sha256(bytes)}`;
  if (actualDigest !== pinnedDigest) {
    throw trustError(
      "REGIONAL_SITE_EVIDENCE_TRUST_DIGEST_MISMATCH",
      "regional site evidence trust registry does not match its SHA-256 pin"
    );
  }
  try {
    return Object.freeze({ registry: JSON.parse(bytes.toString("utf8")), sourceDigest: actualDigest });
  } catch {
    throw trustError(
      "REGIONAL_SITE_EVIDENCE_TRUST_JSON_INVALID",
      "regional site evidence trust registry is not valid JSON"
    );
  }
}

function publicEd25519Key(pem, keyId) {
  if (!String(pem || "").includes("BEGIN PUBLIC KEY")) {
    throw trustError(
      "REGIONAL_SITE_EVIDENCE_TRUST_PUBLIC_KEY_INVALID",
      `regional site evidence trust key ${keyId} is not a public key`
    );
  }
  let key;
  try {
    key = createPublicKey(pem);
  } catch {
    throw trustError(
      "REGIONAL_SITE_EVIDENCE_TRUST_PUBLIC_KEY_INVALID",
      `regional site evidence trust key ${keyId} is invalid`
    );
  }
  if (key.asymmetricKeyType !== "ed25519") {
    throw trustError(
      "REGIONAL_SITE_EVIDENCE_TRUST_ALGORITHM_INVALID",
      `regional site evidence trust key ${keyId} must use Ed25519`
    );
  }
  return key;
}

function validateTrustRegistry(registry, evidenceScopes) {
  if (!exactKeys(registry, REGISTRY_KEYS)
    || registry.schemaVersion !== TRUST_REGISTRY_SCHEMA
    || registry.purpose !== TRUST_PURPOSE
    || !validTimestamp(registry.generatedAt)
    || !Array.isArray(registry.keys)
    || registry.keys.length < 1
    || registry.keys.length > 1000) {
    throw trustError(
      "REGIONAL_SITE_EVIDENCE_TRUST_REGISTRY_INVALID",
      "regional site evidence trust registry contract is invalid"
    );
  }
  const ids = new Set();
  const keys = registry.keys.map((row) => {
    const regionCodes = Array.isArray(row?.regionCodes) ? [...new Set(row.regionCodes)] : [];
    const scopes = Array.isArray(row?.scopes) ? [...new Set(row.scopes)] : [];
    if (!exactKeys(row, KEY_KEYS)
      || !KEY_ID_PATTERN.test(String(row.keyId || ""))
      || ids.has(row.keyId)
      || !PRINCIPAL_PATTERN.test(String(row.principalId || ""))
      || !SIGNER_ROLES.includes(row.role)
      || row.algorithm !== "Ed25519"
      || !KEY_STATES.includes(row.state)
      || regionCodes.length < 1
      || regionCodes.some((code) => !REGION_CODE_PATTERN.test(String(code)))
      || scopes.length < 1
      || scopes.some((scope) => !evidenceScopes.includes(scope))
      || !validTimestamp(row.validFrom)
      || !validTimestamp(row.validUntil)
      || Date.parse(row.validUntil) <= Date.parse(row.validFrom)) {
      throw trustError(
        "REGIONAL_SITE_EVIDENCE_TRUST_KEY_INVALID",
        `regional site evidence trust key ${String(row?.keyId || "(missing)")} is invalid`
      );
    }
    ids.add(row.keyId);
    return Object.freeze({
      keyId: row.keyId,
      principalId: row.principalId,
      role: row.role,
      state: row.state,
      regionCodes: Object.freeze(regionCodes.map(String)),
      scopes: Object.freeze(scopes),
      validFrom: Date.parse(row.validFrom),
      validUntil: Date.parse(row.validUntil),
      publicKey: publicEd25519Key(row.publicKeyPem, row.keyId)
    });
  });
  return Object.freeze({
    generatedAt: registry.generatedAt,
    keys: Object.freeze(keys),
    sourceDigest: `sha256:${sha256(stableJson(registry))}`
  });
}

function createAttestationSubject(manifest, evidence, role) {
  return deepFreeze({
    schemaVersion: SUBJECT_SCHEMA,
    purpose: TRUST_PURPOSE,
    role,
    regionCode: String(manifest.regionCode),
    releaseId: String(manifest.releaseId),
    compositeDigest: normalizeDigest(manifest.compositeDigest),
    regionalContentDigest: normalizeDigest(manifest.regionalContentDigest),
    manifestIssuedAt: manifest.issuedAt,
    manifestExpiresAt: manifest.expiresAt,
    scope: evidence.scope,
    controlledRefDigest: `sha256:${sha256(String(evidence.ref))}`,
    evidenceDigest: normalizeDigest(evidence.digest),
    evidenceSubjectDigest: normalizeDigest(evidence.subjectDigest),
    verifiedAt: evidence.verifiedAt,
    expiresAt: evidence.expiresAt
  });
}

function validateAttestationStructure(attestation) {
  return exactKeys(attestation, ATTESTATION_KEYS)
    && attestation.schemaVersion === ATTESTATION_SCHEMA
    && attestation.purpose === TRUST_PURPOSE
    && SIGNER_ROLES.includes(attestation.role)
    && KEY_ID_PATTERN.test(String(attestation.keyId || ""))
    && validTimestamp(attestation.issuedAt)
    && SHA256_PATTERN.test(normalizeDigest(attestation.subjectDigest))
    && SIGNATURE_PATTERN.test(String(attestation.signature || ""));
}

function verifyEvidenceAttestations(manifest, evidence, trustRegistry, options = {}) {
  const evaluatedAt = Date.parse(options.evaluatedAt || options.now || new Date().toISOString());
  const registry = validateTrustRegistry(trustRegistry, options.evidenceScopes || []);
  const attestations = Array.isArray(evidence.attestations) ? evidence.attestations : [];
  const results = SIGNER_ROLES.map((role) => {
    const rows = attestations.filter((row) => row?.role === role);
    const attestation = rows[0];
    const key = attestation ? registry.keys.find((row) => row.keyId === attestation.keyId) : null;
    const subject = createAttestationSubject(manifest, evidence, role);
    const subjectDigest = `sha256:${sha256(stableJson(subject))}`;
    const issuedAt = Date.parse(attestation?.issuedAt || "");
    const checks = {
      presentOnce: rows.length === 1,
      structure: rows.length === 1 && validateAttestationStructure(attestation),
      registryGenerated: Date.parse(trustRegistry.generatedAt) <= evaluatedAt,
      purpose: attestation?.purpose === TRUST_PURPOSE,
      role: attestation?.role === role && key?.role === role,
      keyKnown: Boolean(key),
      keyAllowed: Boolean(key)
        && key.regionCodes.includes(String(manifest.regionCode))
        && key.scopes.includes(evidence.scope),
      keyState: Boolean(key) && ["active", "grace"].includes(key.state),
      keyCurrent: Boolean(key) && evaluatedAt >= key.validFrom && evaluatedAt < key.validUntil,
      issuedDuringValidity: Boolean(key)
        && Number.isFinite(issuedAt)
        && issuedAt >= key.validFrom
        && issuedAt < key.validUntil
        && issuedAt <= evaluatedAt
        && issuedAt >= Date.parse(manifest.issuedAt)
        && issuedAt < Date.parse(manifest.expiresAt),
      subjectDigest: normalizeDigest(attestation?.subjectDigest) === subjectDigest
    };
    let signatureValid = false;
    if (Object.values(checks).every(Boolean)) {
      try {
        signatureValid = verify(
          null,
          Buffer.from(stableJson(subject)),
          key.publicKey,
          Buffer.from(attestation.signature, "base64url")
        );
      } catch {
        signatureValid = false;
      }
    }
    return Object.freeze({
      role,
      trusted: Object.values(checks).every(Boolean) && signatureValid,
      principalId: key?.principalId || "",
      keyState: key?.state || "unknown",
      checks: Object.freeze({ ...checks, signature: signatureValid })
    });
  });
  const custodian = results.find((row) => row.role === "custodian");
  const reviewer = results.find((row) => row.role === "reviewer");
  const independentPrincipals = Boolean(custodian?.principalId)
    && Boolean(reviewer?.principalId)
    && custodian.principalId !== reviewer.principalId;
  return deepFreeze({
    trusted: results.every((row) => row.trusted) && independentPrincipals,
    independentPrincipals,
    activeSignatures: results.filter((row) => row.trusted && row.keyState === "active").length,
    graceSignatures: results.filter((row) => row.trusted && row.keyState === "grace").length,
    revokedSignatures: results.filter((row) => row.keyState === "revoked").length,
    invalidSignatures: results.filter((row) => !row.trusted).length,
    results
  });
}

function loadTrustRegistry(options = {}) {
  if (options.trustRegistry) {
    const validated = validateTrustRegistry(options.trustRegistry, options.evidenceScopes || []);
    return Object.freeze({ configured: true, ok: true, registry: options.trustRegistry, sourceDigest: validated.sourceDigest });
  }
  const env = options.env || {};
  const keys = trustEnvironmentKeys();
  const file = options.trustRegistryFile || env[keys.file];
  const digest = options.trustRegistryDigest || env[keys.digest];
  if (!file && !digest) {
    return Object.freeze({ configured: false, ok: true, code: "regional-site-evidence-trust-unconfigured" });
  }
  if (!file || !digest) {
    return Object.freeze({ configured: true, ok: false, code: "REGIONAL_SITE_EVIDENCE_TRUST_CONFIGURATION_INCOMPLETE" });
  }
  try {
    const loaded = readTrustRegistryFile(file, digest, options);
    validateTrustRegistry(loaded.registry, options.evidenceScopes || []);
    return Object.freeze({ configured: true, ok: true, registry: loaded.registry, sourceDigest: loaded.sourceDigest });
  } catch (error) {
    return Object.freeze({ configured: true, ok: false, code: error.code || "REGIONAL_SITE_EVIDENCE_TRUST_INVALID" });
  }
}

module.exports = {
  ATTESTATION_SCHEMA,
  ATTESTATION_KEYS,
  KEY_STATES,
  MAX_TRUST_REGISTRY_BYTES,
  SIGNER_ROLES,
  SUBJECT_SCHEMA,
  TRUST_PURPOSE,
  TRUST_REGISTRY_SCHEMA,
  createAttestationSubject,
  loadTrustRegistry,
  readTrustRegistryFile,
  resolveTrustRegistryFile,
  trustEnvironmentKeys,
  validateAttestationStructure,
  validateTrustRegistry,
  verifyEvidenceAttestations
};
