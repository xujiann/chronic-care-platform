"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createPublicKey, verify } = require("node:crypto");
const {
  SHA256,
  assertMetadataOnly,
  sha256,
  stableStringify
} = require("../platform/governance/technical-evidence");

const TRUST_ANCHORS_SCHEMA = "pilot-cutover-provider-trust-anchors-v1";
const PROVIDER_SNAPSHOT_SCHEMA = "pilot-cutover-trust-provider-snapshot-v1";
const PROVIDER_SNAPSHOT_SUBJECT_SCHEMA = "pilot-cutover-trust-provider-snapshot-subject-v1";
const PROVIDER_ATTESTATION_SCHEMA = "pilot-cutover-provider-attestation-v1";
const PILOT_CUTOVER_TRUST_REGISTRY_SCHEMA = "pilot-cutover-trust-registry-v1";
const MAX_METADATA_FILE_BYTES = 1024 * 1024;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,119}$/;
const NONCE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$/;
const SIGNATURE = /^[A-Za-z0-9_-]{80,160}$/;
const CONTROLLED_REFERENCE = /^(?:vault|evidence|artifact|cmdb|ticket|identity):\/\/[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]+$/;
const PROVIDER_TYPES = Object.freeze([
  "aws-kms",
  "azure-key-vault",
  "hashicorp-vault",
  "remote-signing-service"
]);
const KEY_STATUSES = Object.freeze(["active", "frozen", "revoked", "retired"]);

function providerError(code, message) {
  return Object.assign(new Error(message), { code, statusCode: 400 });
}

function clean(value, maximum = 240) {
  return String(value || "").trim().replace(/[\r\n\t]+/g, " ").slice(0, maximum);
}

function instant(value, label) {
  const timestamp = Date.parse(value || "");
  if (!Number.isFinite(timestamp)) {
    throw providerError("PILOT_CUTOVER_PROVIDER_TIME_INVALID", `${label} must be an ISO timestamp`);
  }
  return timestamp;
}

function integer(value, fallback, minimum, maximum) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw providerError(
      "PILOT_CUTOVER_PROVIDER_POLICY_INVALID",
      `policy value must be an integer between ${minimum} and ${maximum}`
    );
  }
  return parsed;
}

function readBoundedMetadataFile(file, label) {
  if (!file || !path.isAbsolute(file)) {
    throw providerError(
      "PILOT_CUTOVER_PROVIDER_FILE_INVALID",
      `${label} file must be an absolute path`
    );
  }
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_METADATA_FILE_BYTES) {
    throw providerError(
      "PILOT_CUTOVER_PROVIDER_FILE_INVALID",
      `${label} file must be a regular non-symlink file no larger than ${MAX_METADATA_FILE_BYTES} bytes`
    );
  }
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw providerError(
      "PILOT_CUTOVER_PROVIDER_FILE_INVALID",
      `${label} file must contain valid JSON`
    );
  }
}

function publicEd25519Key(pem, label) {
  if (!String(pem || "").includes("BEGIN PUBLIC KEY")) {
    throw providerError(
      "PILOT_CUTOVER_PROVIDER_PUBLIC_KEY_INVALID",
      `${label} must contain an Ed25519 public key`
    );
  }
  let key;
  try {
    key = createPublicKey(pem);
  } catch {
    throw providerError(
      "PILOT_CUTOVER_PROVIDER_PUBLIC_KEY_INVALID",
      `${label} must contain a valid public key`
    );
  }
  if (key.asymmetricKeyType !== "ed25519") {
    throw providerError(
      "PILOT_CUTOVER_PROVIDER_ALGORITHM_INVALID",
      `${label} must use Ed25519`
    );
  }
  return key;
}

function createPilotCutoverProviderSnapshotSubject(snapshot = {}) {
  const body = structuredClone(snapshot);
  delete body.attestation;
  return Object.freeze({
    schemaVersion: PROVIDER_SNAPSHOT_SUBJECT_SCHEMA,
    body
  });
}

function validateAnchors(document = {}, now) {
  assertMetadataOnly(document, "pilotCutoverProviderTrustAnchors");
  if (document.schemaVersion !== TRUST_ANCHORS_SCHEMA
    || !Array.isArray(document.providers)
    || document.providers.length < 1
    || document.providers.length > 100) {
    throw providerError(
      "PILOT_CUTOVER_PROVIDER_ANCHORS_INVALID",
      "provider trust anchors must contain one or more public roots"
    );
  }
  const ids = new Set();
  return document.providers.map((row) => {
    const providerId = clean(row?.providerId, 120);
    const keyId = clean(row?.keyId, 120);
    const identity = `${providerId}:${keyId}`;
    const validFrom = instant(row?.validFrom, "anchor validFrom");
    const validUntil = instant(row?.validUntil, "anchor validUntil");
    if (!IDENTIFIER.test(providerId)
      || !IDENTIFIER.test(keyId)
      || ids.has(identity)
      || row?.algorithm !== "Ed25519"
      || row?.status !== "active"
      || validUntil <= validFrom) {
      throw providerError(
        "PILOT_CUTOVER_PROVIDER_ANCHOR_INVALID",
        `provider trust anchor ${identity} is invalid`
      );
    }
    ids.add(identity);
    return Object.freeze({
      providerId,
      keyId,
      validFrom,
      validUntil,
      current: now >= validFrom && now < validUntil,
      publicKey: publicEd25519Key(row.publicKeyPem, `anchor ${identity}`)
    });
  });
}

function validateIdentityBindings(snapshot = {}) {
  if (!Array.isArray(snapshot.identities)
    || snapshot.identities.length < 1
    || snapshot.identities.length > 500) {
    throw providerError(
      "PILOT_CUTOVER_PROVIDER_IDENTITIES_INVALID",
      "provider snapshot must contain one or more identity bindings"
    );
  }
  const bindings = new Map();
  for (const row of snapshot.identities) {
    const account = clean(row?.account, 160);
    const roles = Array.isArray(row?.roles)
      ? [...new Set(row.roles.map((item) => clean(item, 120)).filter(Boolean))]
      : [];
    const authorizedScopes = Array.isArray(row?.authorizedScopes)
      ? [...new Set(row.authorizedScopes.map((item) => clean(item, 120)).filter(Boolean))]
      : [];
    if (!account
      || bindings.has(account)
      || !CONTROLLED_REFERENCE.test(clean(row?.directorySubject, 300))
      || !["active", "suspended", "disabled"].includes(row?.status)
      || roles.length < 1
      || authorizedScopes.length < 1) {
      throw providerError(
        "PILOT_CUTOVER_PROVIDER_IDENTITY_INVALID",
        `identity binding ${account || "(missing)"} is invalid`
      );
    }
    bindings.set(account, Object.freeze({
      account,
      directorySubject: clean(row.directorySubject, 300),
      status: row.status,
      roles: Object.freeze(roles),
      authorizedScopes: Object.freeze(authorizedScopes),
      requiredForCutover: row.requiredForCutover === true
    }));
  }
  return bindings;
}

function validateKeyRows(snapshot = {}, bindings, now, expiryWarningHours) {
  if (!Array.isArray(snapshot.keys) || snapshot.keys.length < 1 || snapshot.keys.length > 1000) {
    throw providerError(
      "PILOT_CUTOVER_PROVIDER_KEYS_INVALID",
      "provider snapshot must contain one or more public keys"
    );
  }
  const ids = new Set();
  const rows = snapshot.keys.map((row) => {
    const keyId = clean(row?.keyId, 120);
    const account = clean(row?.account, 160);
    const role = clean(row?.role, 120);
    const status = clean(row?.status, 40);
    const binding = bindings.get(account);
    const scopes = Array.isArray(row?.scopes)
      ? [...new Set(row.scopes.map((item) => clean(item, 120)).filter(Boolean))]
      : [];
    const validFrom = instant(row?.validFrom, "key validFrom");
    const validUntil = instant(row?.validUntil, "key validUntil");
    if (!IDENTIFIER.test(keyId)
      || ids.has(keyId)
      || !binding
      || !KEY_STATUSES.includes(status)
      || row?.algorithm !== "Ed25519"
      || !binding.roles.includes(role)
      || scopes.length < 1
      || scopes.some((scope) => !binding.authorizedScopes.includes(scope))
      || validUntil <= validFrom
      || !CONTROLLED_REFERENCE.test(clean(row?.providerKeyRef, 300))) {
      throw providerError(
        "PILOT_CUTOVER_PROVIDER_KEY_INVALID",
        `provider key ${keyId || "(missing)"} is invalid or violates its account-role binding`
      );
    }
    const frozenAt = row?.frozenAt ? instant(row.frozenAt, "key frozenAt") : null;
    const revokedAt = row?.revokedAt ? instant(row.revokedAt, "key revokedAt") : null;
    if ((status === "frozen" && frozenAt === null)
      || (status === "revoked" && revokedAt === null)
      || (status !== "frozen" && frozenAt !== null)
      || (status !== "revoked" && revokedAt !== null)
      || (frozenAt !== null && frozenAt < validFrom)
      || (revokedAt !== null && revokedAt < validFrom)) {
      throw providerError(
        "PILOT_CUTOVER_PROVIDER_KEY_LIFECYCLE_INVALID",
        `provider key ${keyId} has inconsistent freeze or revocation metadata`
      );
    }
    ids.add(keyId);
    const current = now >= validFrom && now < validUntil;
    const usable = status === "active" && binding.status === "active" && current;
    return Object.freeze({
      keyId,
      account,
      role,
      scopes: Object.freeze(scopes),
      status,
      validFrom,
      validUntil,
      current,
      usable,
      expiresSoon: usable && validUntil - now <= expiryWarningHours * 60 * 60 * 1000,
      previousKeyId: clean(row?.rotation?.previousKeyId, 120),
      providerKeyRef: clean(row.providerKeyRef, 300),
      publicKeyPem: String(row.publicKeyPem || ""),
      publicKey: publicEd25519Key(row.publicKeyPem, `provider key ${keyId}`)
    });
  });

  const byId = new Map(rows.map((row) => [row.keyId, row]));
  for (const row of rows) {
    if (!row.previousKeyId) continue;
    const previous = byId.get(row.previousKeyId);
    if (!previous
      || previous.keyId === row.keyId
      || previous.account !== row.account
      || previous.role !== row.role
      || previous.validFrom >= row.validFrom) {
      throw providerError(
        "PILOT_CUTOVER_PROVIDER_ROTATION_INVALID",
        `provider key ${row.keyId} has an invalid rotation predecessor`
      );
    }
    const visited = new Set([row.keyId]);
    let cursor = previous;
    while (cursor) {
      if (visited.has(cursor.keyId)) {
        throw providerError(
          "PILOT_CUTOVER_PROVIDER_ROTATION_INVALID",
          `provider key ${row.keyId} has a cyclic rotation chain`
        );
      }
      visited.add(cursor.keyId);
      cursor = cursor.previousKeyId ? byId.get(cursor.previousKeyId) : null;
    }
  }
  return rows;
}

function assertRequiredCoverage(bindings, keys) {
  const usable = keys.filter((row) => row.usable);
  for (const binding of bindings.values()) {
    if (!binding.requiredForCutover) continue;
    for (const scope of binding.authorizedScopes) {
      if (!usable.some((row) => row.account === binding.account && row.scopes.includes(scope))) {
        throw providerError(
          "PILOT_CUTOVER_PROVIDER_REQUIRED_SCOPE_UNAVAILABLE",
          `required identity ${binding.account} has no usable key for scope ${scope}`
        );
      }
    }
  }
  if (usable.length < 1) {
    throw providerError(
      "PILOT_CUTOVER_PROVIDER_NO_USABLE_KEYS",
      "provider snapshot has no current active keys"
    );
  }
}

function verifyProviderAttestation(snapshot, anchors, now) {
  const providerId = clean(snapshot.provider?.providerId, 120);
  const attestation = snapshot.attestation || {};
  const issuedAt = instant(attestation.issuedAt, "provider attestation issuedAt");
  const keyId = clean(attestation.keyId, 120);
  const anchor = anchors.find((row) => row.providerId === providerId && row.keyId === keyId);
  const subject = createPilotCutoverProviderSnapshotSubject(snapshot);
  const subjectDigest = sha256(subject);
  const signature = clean(attestation.signature, 200);
  const checks = {
    schema: attestation.schemaVersion === PROVIDER_ATTESTATION_SCHEMA,
    algorithm: attestation.algorithm === "Ed25519",
    anchorKnown: Boolean(anchor),
    anchorCurrent: Boolean(anchor) && anchor.current,
    issuedDuringAnchorValidity: Boolean(anchor)
      && issuedAt >= anchor.validFrom
      && issuedAt < anchor.validUntil
      && issuedAt <= now,
    nonce: NONCE.test(clean(attestation.nonce, 120)),
    subjectDigest: SHA256.test(clean(attestation.subjectDigest, 80))
      && attestation.subjectDigest === subjectDigest,
    signatureFormat: SIGNATURE.test(signature)
  };
  let signatureValid = false;
  if (Object.values(checks).every(Boolean)) {
    try {
      signatureValid = verify(
        null,
        Buffer.from(stableStringify(subject)),
        anchor.publicKey,
        Buffer.from(signature, "base64url")
      );
    } catch {
      signatureValid = false;
    }
  }
  if (!signatureValid) {
    throw providerError(
      "PILOT_CUTOVER_PROVIDER_ATTESTATION_INVALID",
      "provider snapshot attestation is not trusted"
    );
  }
  return Object.freeze({
    trusted: true,
    providerId,
    keyId,
    subjectDigest,
    checks: Object.freeze({ ...checks, signature: true })
  });
}

function createPilotCutoverTrustProviderAdapter(options = {}) {
  const now = instant(options.now || new Date().toISOString(), "evaluation time");
  const maximumSnapshotAgeMinutes = integer(
    options.maximumSnapshotAgeMinutes,
    60,
    1,
    1440
  );
  const expiryWarningHours = integer(options.expiryWarningHours, 168, 1, 8760);
  const snapshot = options.snapshot || readBoundedMetadataFile(
    options.snapshotFile,
    "provider snapshot"
  );
  const trustAnchors = options.trustAnchors || readBoundedMetadataFile(
    options.trustAnchorsFile,
    "provider trust anchors"
  );
  assertMetadataOnly(snapshot, "pilotCutoverTrustProviderSnapshot");
  if (snapshot.schemaVersion !== PROVIDER_SNAPSHOT_SCHEMA
    || !IDENTIFIER.test(clean(snapshot.provider?.providerId, 120))
    || !PROVIDER_TYPES.includes(snapshot.provider?.type)
    || !CONTROLLED_REFERENCE.test(clean(snapshot.provider?.instanceRef, 300))
    || !IDENTIFIER.test(clean(snapshot.provider?.directoryRevision, 120))) {
    throw providerError(
      "PILOT_CUTOVER_PROVIDER_SNAPSHOT_INVALID",
      "provider snapshot identity and source metadata are invalid"
    );
  }
  const generatedAt = instant(snapshot.generatedAt, "snapshot generatedAt");
  const expiresAt = instant(snapshot.expiresAt, "snapshot expiresAt");
  if (generatedAt > now + 5 * 60 * 1000
    || expiresAt <= now
    || expiresAt <= generatedAt
    || now - generatedAt > maximumSnapshotAgeMinutes * 60 * 1000) {
    throw providerError(
      "PILOT_CUTOVER_PROVIDER_SNAPSHOT_STALE",
      "provider snapshot is expired, from the future or older than policy permits"
    );
  }

  const anchors = validateAnchors(trustAnchors, now);
  const attestation = verifyProviderAttestation(snapshot, anchors, now);
  const bindings = validateIdentityBindings(snapshot);
  const keys = validateKeyRows(snapshot, bindings, now, expiryWarningHours);
  assertRequiredCoverage(bindings, keys);
  const usableKeys = keys.filter((row) => row.usable);
  const registry = Object.freeze({
    schemaVersion: PILOT_CUTOVER_TRUST_REGISTRY_SCHEMA,
    generatedAt: new Date(generatedAt).toISOString(),
    keys: Object.freeze(usableKeys.map((row) => Object.freeze({
      keyId: row.keyId,
      account: row.account,
      algorithm: "Ed25519",
      status: "active",
      scopes: row.scopes,
      validFrom: new Date(row.validFrom).toISOString(),
      validUntil: new Date(row.validUntil).toISOString(),
      publicKeyPem: row.publicKeyPem
    })))
  });
  const counts = Object.freeze({
    identities: bindings.size,
    keys: keys.length,
    usable: usableKeys.length,
    frozen: keys.filter((row) => row.status === "frozen").length,
    revoked: keys.filter((row) => row.status === "revoked").length,
    retired: keys.filter((row) => row.status === "retired").length,
    expiringSoon: keys.filter((row) => row.expiresSoon).length,
    inactiveIdentities: [...bindings.values()].filter((row) => row.status !== "active").length
  });
  const warnings = [];
  if (counts.expiringSoon) warnings.push("one or more active keys are nearing expiry");
  if (counts.frozen) warnings.push("frozen keys remain in provider history and are excluded");
  if (counts.revoked) warnings.push("revoked keys remain in provider history and are excluded");
  if (counts.inactiveIdentities) warnings.push("inactive identities are excluded from usable keys");

  return Object.freeze({
    schema: "pilot-cutover-trust-provider-adapter-v1",
    provider: Object.freeze({
      providerId: clean(snapshot.provider.providerId, 120),
      type: snapshot.provider.type,
      instanceRef: clean(snapshot.provider.instanceRef, 300),
      directoryRevision: clean(snapshot.provider.directoryRevision, 120)
    }),
    generatedAt: new Date(generatedAt).toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
    attestation,
    registry,
    health: Object.freeze({
      schema: "pilot-cutover-trust-provider-health-v1",
      status: warnings.length ? "warning" : "healthy",
      providerVerified: true,
      snapshotFresh: true,
      identityBindingsValid: true,
      keyLifecycleValid: true,
      requiredScopesCovered: true,
      counts,
      warnings: Object.freeze(warnings),
      productionReady: false,
      cutoverExecutionAuthorized: false
    })
  });
}

function blockedPilotCutoverTrustProviderHealth(error, evaluatedAt = new Date().toISOString()) {
  return Object.freeze({
    schema: "pilot-cutover-trust-provider-health-v1",
    evaluatedAt,
    status: "blocked",
    providerVerified: false,
    snapshotFresh: false,
    identityBindingsValid: false,
    keyLifecycleValid: false,
    requiredScopesCovered: false,
    code: clean(error?.code || "PILOT_CUTOVER_PROVIDER_UNAVAILABLE", 120),
    message: clean(error?.message || "pilot cutover trust provider is unavailable", 300),
    counts: Object.freeze({
      identities: 0,
      keys: 0,
      usable: 0,
      frozen: 0,
      revoked: 0,
      retired: 0,
      expiringSoon: 0,
      inactiveIdentities: 0
    }),
    warnings: Object.freeze([]),
    productionReady: false,
    cutoverExecutionAuthorized: false
  });
}

function evaluatePilotCutoverTrustProvider(options = {}) {
  try {
    return createPilotCutoverTrustProviderAdapter(options);
  } catch (error) {
    return Object.freeze({
      schema: "pilot-cutover-trust-provider-adapter-v1",
      registry: null,
      health: blockedPilotCutoverTrustProviderHealth(error, options.now)
    });
  }
}

module.exports = {
  MAX_METADATA_FILE_BYTES,
  PILOT_CUTOVER_TRUST_REGISTRY_SCHEMA,
  PROVIDER_ATTESTATION_SCHEMA,
  PROVIDER_SNAPSHOT_SCHEMA,
  PROVIDER_SNAPSHOT_SUBJECT_SCHEMA,
  TRUST_ANCHORS_SCHEMA,
  blockedPilotCutoverTrustProviderHealth,
  createPilotCutoverProviderSnapshotSubject,
  createPilotCutoverTrustProviderAdapter,
  evaluatePilotCutoverTrustProvider,
  readBoundedMetadataFile
};
