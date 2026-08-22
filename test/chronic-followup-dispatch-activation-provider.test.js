"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createHash, generateKeyPairSync, sign } = require("node:crypto");
const { ACTIVATION_SCHEMA, PUBLISHER_SCHEMA } = require("../src/citizen-chronic/followup-event-publisher");
const { stableStringify } = require("../src/citizen-chronic/followup-dispatch-outbox");
const {
  REGISTRY_SCHEMA,
  activationBinding,
  createFileBackedFollowupActivationVerifier,
  inspectFollowupActivationProvider
} = require("../src/citizen-chronic/followup-dispatch-activation-provider");

function digest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

test("pre-signed activation decision matches stable event binding within its validity window", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "followup-activation-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyFile = path.join(directory, "activation-public.pem");
  const registryFile = path.join(directory, "activation-registry.json");
  fs.writeFileSync(publicKeyFile, publicKey.export({ type: "spki", format: "pem" }));
  const request = {
    schema: ACTIVATION_SCHEMA,
    contractId: PUBLISHER_SCHEMA,
    endpointDigest: `sha256:${"a".repeat(64)}`,
    eventId: "event-001",
    payloadDigest: `sha256:${"b".repeat(64)}`,
    requestedAt: "2026-08-22T01:00:00.000Z"
  };
  const baseRecord = {
    schema: request.schema,
    contractId: request.contractId,
    endpointDigest: request.endpointDigest,
    eventId: request.eventId,
    payloadDigest: request.payloadDigest,
    authorized: true,
    activationId: "activation-001",
    evidenceDigest: `sha256:${"c".repeat(64)}`,
    verifiedAt: "2026-08-22T00:59:59.000Z",
    validUntil: "2026-08-22T01:05:00.000Z"
  };
  const signRecord = (value) => ({
    ...value,
    signature: sign(null, Buffer.from(stableStringify(activationBinding(value))), privateKey).toString("base64")
  });
  const writeRegistry = (activations) => fs.writeFileSync(registryFile, JSON.stringify({
    schema: REGISTRY_SCHEMA,
    activations
  }));
  const record = signRecord(baseRecord);
  writeRegistry([record]);
  const env = {
    CITIZEN_CHRONIC_FOLLOWUP_ACTIVATION_REGISTRY_FILE: registryFile,
    CITIZEN_CHRONIC_FOLLOWUP_ACTIVATION_PUBLIC_KEY_FILE: publicKeyFile,
    CITIZEN_CHRONIC_FOLLOWUP_ACTIVATION_PUBLIC_KEY_SHA256: digest(publicKey.export({ type: "spki", format: "der" }))
  };
  const readiness = inspectFollowupActivationProvider(env);
  assert.equal(readiness.configured, true);
  assert.equal(readiness.productionReady, false);
  const result = await createFileBackedFollowupActivationVerifier({ env }).verify(request);
  assert.equal(result.authorized, true);
  assert.equal(result.activationId, "activation-001");
  assert.equal(Object.hasOwn(result, "requestedAt"), false);

  writeRegistry([signRecord({ ...baseRecord, validUntil: "2026-08-22T00:59:59.999Z" })]);
  await assert.rejects(
    () => createFileBackedFollowupActivationVerifier({ env }).verify(request),
    /outside its signed validity window/
  );

  writeRegistry([signRecord({ ...baseRecord, verifiedAt: "2026-08-22T01:00:00.001Z" })]);
  await assert.rejects(
    () => createFileBackedFollowupActivationVerifier({ env }).verify(request),
    /outside its signed validity window/
  );

  writeRegistry([record, { ...record }]);
  await assert.rejects(
    () => createFileBackedFollowupActivationVerifier({ env }).verify(request),
    /exactly one signed activation decision/
  );

  writeRegistry([record]);
  await assert.rejects(
    () => createFileBackedFollowupActivationVerifier({ env }).verify({
      ...request,
      payloadDigest: `sha256:${"d".repeat(64)}`
    }),
    /exactly one signed activation decision/
  );
  await assert.rejects(
    () => createFileBackedFollowupActivationVerifier({ env }).verify({
      ...request,
      endpointDigest: `sha256:${"e".repeat(64)}`
    }),
    /exactly one signed activation decision/
  );

  const registry = { schema: REGISTRY_SCHEMA, activations: [{ ...record }] };
  registry.activations[0].eventId = "event-tampered";
  fs.writeFileSync(registryFile, JSON.stringify(registry));
  await assert.rejects(
    () => createFileBackedFollowupActivationVerifier({ env }).verify({ ...request, eventId: "event-tampered" }),
    /signature is invalid/
  );
});

test("activation provider fails closed for a substituted public key digest", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "followup-activation-key-"));
  try {
    const { publicKey } = generateKeyPairSync("ed25519");
    const publicKeyFile = path.join(directory, "activation-public.pem");
    const registryFile = path.join(directory, "activation-registry.json");
    fs.writeFileSync(publicKeyFile, publicKey.export({ type: "spki", format: "pem" }));
    fs.writeFileSync(registryFile, JSON.stringify({ schema: REGISTRY_SCHEMA, activations: [] }));
    const readiness = inspectFollowupActivationProvider({
      CITIZEN_CHRONIC_FOLLOWUP_ACTIVATION_REGISTRY_FILE: registryFile,
      CITIZEN_CHRONIC_FOLLOWUP_ACTIVATION_PUBLIC_KEY_FILE: publicKeyFile,
      CITIZEN_CHRONIC_FOLLOWUP_ACTIVATION_PUBLIC_KEY_SHA256: `sha256:${"0".repeat(64)}`
    });
    assert.equal(readiness.configured, false);
    assert.equal(readiness.reasonCode, "ACTIVATION_PUBLIC_KEY_DIGEST_MISMATCH");
    assert.equal(readiness.detail, "external activation provider failed closed");
    assert.equal(JSON.stringify(readiness).includes(directory), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("activation readiness never exposes missing trust file paths or filesystem messages", () => {
  const privateDirectory = path.resolve(os.tmpdir(), "private-followup-provider-location");
  const readiness = inspectFollowupActivationProvider({
    CITIZEN_CHRONIC_FOLLOWUP_ACTIVATION_REGISTRY_FILE: path.join(privateDirectory, "registry.json"),
    CITIZEN_CHRONIC_FOLLOWUP_ACTIVATION_PUBLIC_KEY_FILE: path.join(privateDirectory, "public.pem"),
    CITIZEN_CHRONIC_FOLLOWUP_ACTIVATION_PUBLIC_KEY_SHA256: `sha256:${"a".repeat(64)}`
  });
  assert.equal(readiness.configured, false);
  assert.equal(readiness.reasonCode, "ACTIVATION_TRUST_MATERIAL_UNAVAILABLE");
  assert.equal(JSON.stringify(readiness).includes(privateDirectory), false);
  assert.doesNotMatch(JSON.stringify(readiness), /ENOENT|no such file|registry\.json|public\.pem/i);
});
