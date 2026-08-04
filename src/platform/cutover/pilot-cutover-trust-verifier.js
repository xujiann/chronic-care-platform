"use strict";

const { createPublicKey, verify } = require("node:crypto");
const {
  readBoundedJsonFile
} = require("./pilot-cutover-package");
const {
  SHA256,
  assertMetadataOnly,
  sha256,
  stableStringify
} = require("../governance/technical-evidence");

const TRUST_REGISTRY_SCHEMA = "pilot-cutover-trust-registry-v1";
const TRUST_SUBJECT_SCHEMA = "pilot-cutover-trust-subject-v1";
const MAX_TRUST_REGISTRY_BYTES = 1024 * 1024;
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,119}$/;
const NONCE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$/;
const SIGNATURE = /^[A-Za-z0-9_-]{80,160}$/;

function trustError(code, message) {
  return Object.assign(new Error(message), { code, statusCode: 400 });
}

function clean(value, maximum = 240) {
  return String(value || "").trim().replace(/[\r\n\t]+/g, " ").slice(0, maximum);
}

function instant(value, label) {
  const timestamp = Date.parse(value || "");
  if (!Number.isFinite(timestamp)) {
    throw trustError("PILOT_CUTOVER_TRUST_TIME_INVALID", `${label} must be an ISO timestamp`);
  }
  return timestamp;
}

function eventBody(event = {}) {
  const body = structuredClone(event.payload || {});
  delete body.attestation;
  return body;
}

function createPilotCutoverTrustSubject(event = {}) {
  return Object.freeze({
    schemaVersion: TRUST_SUBJECT_SCHEMA,
    type: clean(event.type, 80),
    actorAccount: clean(event.actorAccount, 160),
    body: eventBody(event)
  });
}

function requiredScope(event = {}) {
  if (event.type === "evidence-registered") return clean(event.payload?.gateId, 120);
  if (event.type === "approval-recorded") return clean(event.payload?.role, 120);
  if (event.type === "rehearsal-recorded") return "rehearsal-coordinator";
  return "";
}

function validateRegistry(registry = {}) {
  assertMetadataOnly(registry, "pilotCutoverTrustRegistry");
  if (registry.schemaVersion !== TRUST_REGISTRY_SCHEMA
    || !Array.isArray(registry.keys)
    || registry.keys.length < 1
    || registry.keys.length > 1000) {
    throw trustError(
      "PILOT_CUTOVER_TRUST_REGISTRY_INVALID",
      "trust registry must contain one or more public identity keys"
    );
  }
  const ids = new Set();
  const keys = registry.keys.map((row) => {
    const keyId = clean(row?.keyId, 120);
    const account = clean(row?.account, 160);
    const scopes = Array.isArray(row?.scopes)
      ? [...new Set(row.scopes.map((item) => clean(item, 120)).filter(Boolean))]
      : [];
    const validFrom = instant(row?.validFrom, "validFrom");
    const validUntil = instant(row?.validUntil, "validUntil");
    if (!KEY_ID.test(keyId)
      || ids.has(keyId)
      || !account
      || row?.algorithm !== "Ed25519"
      || row?.status !== "active"
      || scopes.length < 1
      || validUntil <= validFrom
      || !String(row?.publicKeyPem || "").includes("BEGIN PUBLIC KEY")) {
      throw trustError(
        "PILOT_CUTOVER_TRUST_KEY_INVALID",
        `trust key ${keyId || "(missing)"} is invalid`
      );
    }
    let publicKey;
    try {
      publicKey = createPublicKey(row.publicKeyPem);
    } catch {
      throw trustError(
        "PILOT_CUTOVER_TRUST_PUBLIC_KEY_INVALID",
        `trust key ${keyId} is not a valid public key`
      );
    }
    if (publicKey.asymmetricKeyType !== "ed25519") {
      throw trustError(
        "PILOT_CUTOVER_TRUST_ALGORITHM_INVALID",
        `trust key ${keyId} must be Ed25519`
      );
    }
    ids.add(keyId);
    return Object.freeze({
      keyId,
      account,
      scopes: Object.freeze(scopes),
      validFrom,
      validUntil,
      publicKey
    });
  });
  return Object.freeze(keys);
}

function readPilotCutoverTrustRegistry(file) {
  return readBoundedJsonFile(file, {
    label: "pilot cutover trust registry",
    maximumBytes: MAX_TRUST_REGISTRY_BYTES
  });
}

function createPilotCutoverTrustVerifier(options = {}) {
  const registry = options.registry || readPilotCutoverTrustRegistry(options.file);
  const keys = validateRegistry(registry);
  const keyMap = new Map(keys.map((row) => [row.keyId, row]));

  function verifyEvent(event = {}, evaluationTime) {
    const attestation = event.payload?.attestation;
    const now = instant(evaluationTime || event.recordedAt || new Date().toISOString(), "evaluationTime");
    const issuedAt = Date.parse(attestation?.issuedAt || "");
    const key = keyMap.get(clean(attestation?.keyId, 120));
    const scope = requiredScope(event);
    const subject = createPilotCutoverTrustSubject(event);
    const subjectDigest = sha256(subject);
    const signature = clean(attestation?.signature, 200);
    const accountMatchesPayload = event.type !== "approval-recorded"
      || clean(event.payload?.account, 160) === clean(event.actorAccount, 160);
    const verifierMatchesPayload = event.type !== "evidence-registered"
      || clean(event.payload?.verifierAccount, 160) === clean(event.actorAccount, 160);
    const coordinatorMatchesPayload = event.type !== "rehearsal-recorded"
      || clean(event.payload?.coordinatorAccount, 160) === clean(event.actorAccount, 160);
    const checks = Object.freeze({
      attestationSchema: attestation?.schemaVersion === "pilot-cutover-attestation-v1",
      algorithm: attestation?.algorithm === "Ed25519",
      keyKnown: Boolean(key),
      keyActiveAtIssuance: Boolean(key)
        && Number.isFinite(issuedAt)
        && issuedAt >= key.validFrom
        && issuedAt < key.validUntil,
      keyCurrent: Boolean(key) && now >= key.validFrom && now < key.validUntil,
      account: Boolean(key) && key.account === clean(event.actorAccount, 160)
        && accountMatchesPayload
        && verifierMatchesPayload
        && coordinatorMatchesPayload,
      scope: Boolean(key) && Boolean(scope) && key.scopes.includes(scope),
      nonce: NONCE.test(clean(attestation?.nonce, 120)),
      subjectDigest: SHA256.test(clean(attestation?.subjectDigest, 80))
        && attestation.subjectDigest === subjectDigest,
      signatureFormat: SIGNATURE.test(signature)
    });
    let signatureValid = false;
    if (Object.values(checks).every(Boolean)) {
      try {
        signatureValid = verify(
          null,
          Buffer.from(stableStringify(subject)),
          key.publicKey,
          Buffer.from(signature, "base64url")
        );
      } catch {
        signatureValid = false;
      }
    }
    return Object.freeze({
      trusted: Object.values(checks).every(Boolean) && signatureValid,
      keyId: clean(attestation?.keyId, 120),
      account: clean(event.actorAccount, 160),
      scope,
      subjectDigest,
      checks: Object.freeze({ ...checks, signature: signatureValid })
    });
  }

  return Object.freeze({
    schema: "pilot-cutover-trust-verifier-v1",
    registryGeneratedAt: clean(registry.generatedAt, 40),
    keyCount: keys.length,
    verifyEvent
  });
}

module.exports = {
  MAX_TRUST_REGISTRY_BYTES,
  TRUST_REGISTRY_SCHEMA,
  TRUST_SUBJECT_SCHEMA,
  createPilotCutoverTrustSubject,
  createPilotCutoverTrustVerifier,
  readPilotCutoverTrustRegistry
};
