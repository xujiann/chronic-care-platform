"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { generateKeyPairSync, sign } = require("node:crypto");
const test = require("node:test");
const {
  createPilotCutoverProviderSnapshotSubject,
  createPilotCutoverTrustProviderAdapter,
  evaluatePilotCutoverTrustProvider,
  readBoundedMetadataFile
} = require("../src/identity-security/pilot-cutover-trust-provider");
const {
  createPilotCutoverTrustSubject,
  createPilotCutoverTrustVerifier
} = require("../src/platform/cutover/pilot-cutover-trust-verifier");
const { sha256, stableStringify } = require("../src/platform/governance/technical-evidence");

const NOW = "2030-08-04T12:00:00.000Z";

function fixture() {
  const root = generateKeyPairSync("ed25519");
  const oldKey = generateKeyPairSync("ed25519");
  const activeKey = generateKeyPairSync("ed25519");
  const revokedKey = generateKeyPairSync("ed25519");
  const trustAnchors = {
    schemaVersion: "pilot-cutover-provider-trust-anchors-v1",
    generatedAt: "2030-08-04T10:00:00.000Z",
    providers: [{
      providerId: "regional-vault-1",
      keyId: "provider-root-1",
      algorithm: "Ed25519",
      status: "active",
      validFrom: "2030-08-01T00:00:00.000Z",
      validUntil: "2031-08-01T00:00:00.000Z",
      publicKeyPem: root.publicKey.export({ type: "spki", format: "pem" })
    }]
  };
  const snapshot = {
    schemaVersion: "pilot-cutover-trust-provider-snapshot-v1",
    generatedAt: "2030-08-04T11:45:00.000Z",
    expiresAt: "2030-08-04T12:45:00.000Z",
    provider: {
      providerId: "regional-vault-1",
      type: "hashicorp-vault",
      instanceRef: "vault://regional/platform-signing",
      directoryRevision: "revision-2048"
    },
    identities: [
      {
        account: "security-verifier",
        directorySubject: "identity://regional/security-verifier",
        status: "active",
        roles: ["security-compliance"],
        authorizedScopes: ["security-assessment"],
        requiredForCutover: true
      },
      {
        account: "former-operator",
        directorySubject: "identity://regional/former-operator",
        status: "disabled",
        roles: ["platform-operations"],
        authorizedScopes: ["platform-operations"],
        requiredForCutover: false
      }
    ],
    keys: [
      {
        keyId: "security-key-old",
        account: "security-verifier",
        role: "security-compliance",
        algorithm: "Ed25519",
        status: "retired",
        scopes: ["security-assessment"],
        validFrom: "2030-01-01T00:00:00.000Z",
        validUntil: "2030-08-03T00:00:00.000Z",
        providerKeyRef: "vault://regional/keys/security-key-old",
        publicKeyPem: oldKey.publicKey.export({ type: "spki", format: "pem" })
      },
      {
        keyId: "security-key-current",
        account: "security-verifier",
        role: "security-compliance",
        algorithm: "Ed25519",
        status: "active",
        scopes: ["security-assessment"],
        validFrom: "2030-08-01T00:00:00.000Z",
        validUntil: "2030-08-09T00:00:00.000Z",
        providerKeyRef: "vault://regional/keys/security-key-current",
        rotation: { previousKeyId: "security-key-old" },
        publicKeyPem: activeKey.publicKey.export({ type: "spki", format: "pem" })
      },
      {
        keyId: "former-operator-key",
        account: "former-operator",
        role: "platform-operations",
        algorithm: "Ed25519",
        status: "revoked",
        scopes: ["platform-operations"],
        validFrom: "2030-01-01T00:00:00.000Z",
        validUntil: "2030-12-31T00:00:00.000Z",
        revokedAt: "2030-08-02T00:00:00.000Z",
        providerKeyRef: "vault://regional/keys/former-operator-key",
        publicKeyPem: revokedKey.publicKey.export({ type: "spki", format: "pem" })
      }
    ]
  };
  function resign() {
    delete snapshot.attestation;
    const subject = createPilotCutoverProviderSnapshotSubject(snapshot);
    snapshot.attestation = {
      schemaVersion: "pilot-cutover-provider-attestation-v1",
      keyId: "provider-root-1",
      algorithm: "Ed25519",
      issuedAt: "2030-08-04T11:46:00.000Z",
      nonce: "provider-snapshot-2048",
      subjectDigest: sha256(subject),
      signature: sign(
        null,
        Buffer.from(stableStringify(subject)),
        root.privateKey
      ).toString("base64url")
    };
  }
  resign();
  return { activeKey, resign, snapshot, trustAnchors };
}

test("provider adapter verifies the signed directory and exports only usable public keys", () => {
  const { snapshot, trustAnchors } = fixture();
  const adapter = createPilotCutoverTrustProviderAdapter({
    snapshot,
    trustAnchors,
    now: NOW,
    expiryWarningHours: 24 * 7
  });
  assert.equal(adapter.attestation.trusted, true);
  assert.equal(adapter.registry.keys.length, 1);
  assert.equal(adapter.registry.keys[0].keyId, "security-key-current");
  assert.equal(adapter.registry.keys[0].account, "security-verifier");
  assert.equal(adapter.health.status, "warning");
  assert.equal(adapter.health.counts.revoked, 1);
  assert.equal(adapter.health.counts.retired, 1);
  assert.equal(adapter.health.productionReady, false);
  assert.equal(adapter.health.cutoverExecutionAuthorized, false);
  assert.equal(JSON.stringify(adapter.registry).includes("PRIVATE KEY"), false);
});

test("exported registry is directly consumable by the T00 event verifier", () => {
  const { activeKey, snapshot, trustAnchors } = fixture();
  const adapter = createPilotCutoverTrustProviderAdapter({
    snapshot,
    trustAnchors,
    now: NOW
  });
  const event = {
    type: "evidence-registered",
    actorAccount: "security-verifier",
    recordedAt: NOW,
    payload: {
      gateId: "security-assessment",
      verifierAccount: "security-verifier"
    }
  };
  const subject = createPilotCutoverTrustSubject(event);
  event.payload.attestation = {
    schemaVersion: "pilot-cutover-attestation-v1",
    keyId: "security-key-current",
    algorithm: "Ed25519",
    issuedAt: NOW,
    nonce: "security-event-2048",
    subjectDigest: sha256(subject),
    signature: sign(
      null,
      Buffer.from(stableStringify(subject)),
      activeKey.privateKey
    ).toString("base64url")
  };
  const verifier = createPilotCutoverTrustVerifier({ registry: adapter.registry });
  assert.equal(verifier.verifyEvent(event, NOW).trusted, true);
});

test("snapshot signature tampering and stale snapshots fail closed", () => {
  const tampered = fixture();
  tampered.snapshot.keys[1].scopes = ["site-acceptance"];
  const tamperedResult = evaluatePilotCutoverTrustProvider({
    snapshot: tampered.snapshot,
    trustAnchors: tampered.trustAnchors,
    now: NOW
  });
  assert.equal(tamperedResult.registry, null);
  assert.equal(tamperedResult.health.status, "blocked");
  assert.equal(tamperedResult.health.code, "PILOT_CUTOVER_PROVIDER_ATTESTATION_INVALID");

  const stale = fixture();
  const staleResult = evaluatePilotCutoverTrustProvider({
    snapshot: stale.snapshot,
    trustAnchors: stale.trustAnchors,
    now: "2030-08-04T13:00:00.000Z"
  });
  assert.equal(staleResult.health.status, "blocked");
  assert.equal(staleResult.health.code, "PILOT_CUTOVER_PROVIDER_SNAPSHOT_STALE");
});

test("role drift, disabled required identities and missing usable scopes block export", () => {
  const drift = fixture();
  drift.snapshot.keys[1].role = "platform-operations";
  drift.resign();
  const driftResult = evaluatePilotCutoverTrustProvider({
    snapshot: drift.snapshot,
    trustAnchors: drift.trustAnchors,
    now: NOW
  });
  assert.equal(driftResult.health.status, "blocked");
  assert.equal(driftResult.health.code, "PILOT_CUTOVER_PROVIDER_KEY_INVALID");

  const disabled = fixture();
  disabled.snapshot.identities[0].status = "disabled";
  disabled.resign();
  const disabledResult = evaluatePilotCutoverTrustProvider({
    snapshot: disabled.snapshot,
    trustAnchors: disabled.trustAnchors,
    now: NOW
  });
  assert.equal(disabledResult.health.status, "blocked");
  assert.equal(
    disabledResult.health.code,
    "PILOT_CUTOVER_PROVIDER_REQUIRED_SCOPE_UNAVAILABLE"
  );
});

test("freeze and revoke lifecycle metadata must be internally consistent", () => {
  const frozen = fixture();
  frozen.snapshot.keys[1].status = "frozen";
  frozen.resign();
  const result = evaluatePilotCutoverTrustProvider({
    snapshot: frozen.snapshot,
    trustAnchors: frozen.trustAnchors,
    now: NOW
  });
  assert.equal(result.health.status, "blocked");
  assert.equal(result.health.code, "PILOT_CUTOVER_PROVIDER_KEY_LIFECYCLE_INVALID");
});

test("metadata reader requires an absolute bounded regular JSON file", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "trust-provider-"));
  const file = path.join(directory, "snapshot.json");
  fs.writeFileSync(file, JSON.stringify({ ok: true }), "utf8");
  assert.deepEqual(readBoundedMetadataFile(file, "test"), { ok: true });
  assert.throws(
    () => readBoundedMetadataFile("relative.json", "test"),
    (error) => error.code === "PILOT_CUTOVER_PROVIDER_FILE_INVALID"
  );
  fs.rmSync(directory, { recursive: true, force: true });
});
