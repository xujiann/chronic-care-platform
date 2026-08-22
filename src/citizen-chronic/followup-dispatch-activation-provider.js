"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash, createPublicKey, verify } = require("node:crypto");
const { ACTIVATION_SCHEMA, PUBLISHER_SCHEMA } = require("./followup-event-publisher");
const { stableStringify } = require("./followup-dispatch-outbox");

const REGISTRY_SCHEMA = "citizen-chronic.followup-dispatch-activation-registry.v1";

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function requiredAbsolutePath(value, label) {
  const result = String(value || "").trim();
  if (!result || !path.isAbsolute(result)) throw new Error(`${label} must be an absolute external path`);
  return path.resolve(result);
}

function providerConfig(env = process.env) {
  const registryFile = requiredAbsolutePath(env.CITIZEN_CHRONIC_FOLLOWUP_ACTIVATION_REGISTRY_FILE, "activation registry");
  const publicKeyFile = requiredAbsolutePath(env.CITIZEN_CHRONIC_FOLLOWUP_ACTIVATION_PUBLIC_KEY_FILE, "activation public key");
  const expectedPublicKeyDigest = String(env.CITIZEN_CHRONIC_FOLLOWUP_ACTIVATION_PUBLIC_KEY_SHA256 || "").trim().toLowerCase();
  if (!/^sha256:[a-f0-9]{64}$/.test(expectedPublicKeyDigest)) throw new Error("activation public key digest is required");
  return Object.freeze({ registryFile, publicKeyFile, expectedPublicKeyDigest });
}

function activationBinding(record = {}) {
  return Object.freeze({
    schema: String(record.schema || ""),
    contractId: String(record.contractId || ""),
    endpointDigest: String(record.endpointDigest || ""),
    eventId: String(record.eventId || ""),
    payloadDigest: String(record.payloadDigest || ""),
    authorized: record.authorized === true,
    activationId: String(record.activationId || ""),
    evidenceDigest: String(record.evidenceDigest || ""),
    verifiedAt: String(record.verifiedAt || ""),
    validUntil: String(record.validUntil || "")
  });
}

function loadTrustMaterial(config) {
  const publicKeyPem = fs.readFileSync(config.publicKeyFile);
  const publicKey = createPublicKey(publicKeyPem);
  if (publicKey.asymmetricKeyType !== "ed25519") throw new Error("activation public key must be Ed25519");
  const publicKeyDigest = sha256(publicKey.export({ type: "spki", format: "der" }));
  if (publicKeyDigest !== config.expectedPublicKeyDigest) throw new Error("activation public key digest mismatch");
  const registry = JSON.parse(fs.readFileSync(config.registryFile, "utf8"));
  if (registry?.schema !== REGISTRY_SCHEMA || !Array.isArray(registry.activations)) throw new Error("activation registry schema is invalid");
  return { publicKey, registry };
}

function providerFailureReason(error) {
  const message = String(error?.message || "");
  if (message.includes("digest mismatch")) return "ACTIVATION_PUBLIC_KEY_DIGEST_MISMATCH";
  if (message.includes("must be Ed25519")) return "ACTIVATION_PUBLIC_KEY_TYPE_INVALID";
  if (message.includes("registry schema")) return "ACTIVATION_REGISTRY_SCHEMA_INVALID";
  if (message.includes("absolute external path")) return "ACTIVATION_EXTERNAL_PATH_REQUIRED";
  if (message.includes("digest is required")) return "ACTIVATION_PUBLIC_KEY_DIGEST_REQUIRED";
  return "ACTIVATION_TRUST_MATERIAL_UNAVAILABLE";
}

function createFileBackedFollowupActivationVerifier(options = {}) {
  const config = providerConfig(options.env || process.env);
  return Object.freeze({
    async verify(request = {}) {
      const { publicKey, registry } = loadTrustMaterial(config);
      const candidates = registry.activations.filter((record) => {
        const binding = activationBinding(record);
        return binding.schema === ACTIVATION_SCHEMA
          && binding.contractId === PUBLISHER_SCHEMA
          && binding.endpointDigest === request.endpointDigest
          && binding.eventId === request.eventId
          && binding.payloadDigest === request.payloadDigest;
      });
      if (candidates.length !== 1) throw new Error("exactly one signed activation decision is required");
      const record = candidates[0];
      const binding = activationBinding(record);
      const signature = Buffer.from(String(record.signature || ""), "base64");
      if (!signature.length || !verify(null, Buffer.from(stableStringify(binding)), publicKey, signature)) {
        throw new Error("activation decision signature is invalid");
      }
      const requestedAt = Date.parse(String(request.requestedAt || ""));
      const verifiedAt = Date.parse(binding.verifiedAt);
      const validUntil = Date.parse(binding.validUntil);
      if (!Number.isFinite(requestedAt)
        || !Number.isFinite(verifiedAt)
        || !Number.isFinite(validUntil)
        || verifiedAt > validUntil
        || requestedAt < verifiedAt
        || requestedAt > validUntil) {
        throw new Error("activation decision is outside its signed validity window");
      }
      return Object.freeze(binding);
    }
  });
}

function inspectFollowupActivationProvider(env = process.env, options = {}) {
  try {
    const config = providerConfig(env);
    if (options.checkFilesystem !== false) loadTrustMaterial(config);
    return Object.freeze({
      contract: REGISTRY_SCHEMA,
      configured: true,
      registryFileDigest: sha256(config.registryFile),
      publicKeyFileDigest: sha256(config.publicKeyFile),
      publicKeyDigest: config.expectedPublicKeyDigest,
      externalDecisionRequired: true,
      productionReady: false
    });
  } catch (error) {
    return Object.freeze({
      contract: REGISTRY_SCHEMA,
      configured: false,
      errorCode: "FOLLOWUP_DISPATCH_ACTIVATION_PROVIDER_UNAVAILABLE",
      reasonCode: providerFailureReason(error),
      detail: "external activation provider failed closed",
      externalDecisionRequired: true,
      productionReady: false
    });
  }
}

module.exports = {
  REGISTRY_SCHEMA,
  activationBinding,
  createFileBackedFollowupActivationVerifier,
  inspectFollowupActivationProvider,
  providerFailureReason,
  providerConfig,
  sha256
};
