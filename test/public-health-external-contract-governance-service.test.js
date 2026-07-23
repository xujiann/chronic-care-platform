const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {
  authorizePublicHealthExternalContract,
  buildPublicHealthExternalContractGovernance,
  signPublicHealthExternalContractAttestation,
  verifyPublicHealthExternalContractAttestation
} = require("../public-health-external-contract-governance-service");

const OLD_SECRET = "public-health-contract-old-1234567890-123456";
const NEW_SECRET = "public-health-contract-new-1234567890-123456";

function digest(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function oldKeyring() {
  return {
    purpose: "public-health-contract-governance",
    activeKeyId: "contract-2026-07",
    keys: [{
      keyId: "contract-2026-07",
      secret: OLD_SECRET,
      status: "active",
      notBefore: "2026-07-01T00:00:00.000Z",
      expiresAt: "2026-10-01T00:00:00.000Z",
      revokedAt: ""
    }]
  };
}

function rotatedKeyring(oldStatus = "grace") {
  return {
    purpose: "public-health-contract-governance",
    activeKeyId: "contract-2026-08",
    keys: [
      {
        ...oldKeyring().keys[0],
        status: oldStatus,
        revokedAt: oldStatus === "revoked" ? "2026-07-24T00:00:00.000Z" : ""
      },
      {
        keyId: "contract-2026-08",
        secret: NEW_SECRET,
        status: "active",
        notBefore: "2026-07-24T00:00:00.000Z",
        expiresAt: "2026-11-01T00:00:00.000Z",
        revokedAt: ""
      }
    ]
  };
}

function attestationInput(overrides = {}) {
  return {
    laneId: "family-doctor",
    fromContract: "family-doctor-fulfillment-v1",
    toContract: "family-doctor-fulfillment-v2",
    requestSchemaVersion: "public-health-external-dispatch/v2",
    receiptSchemaVersion: "public-health-external-receipt/v2",
    changeType: "additive",
    fieldDictionaryDigest: digest("family-doctor-field-dictionary-v2"),
    sampleRequestDigest: digest("family-doctor-request-sample-v2"),
    sampleReceiptDigest: digest("family-doctor-receipt-sample-v2"),
    runtimeReleaseDigest: digest("family-doctor-runtime-release-v2"),
    producerApproval: {
      organizationId: "family-doctor-platform",
      role: "producer-contract-owner",
      approverIdHash: digest("producer-approver-001"),
      approvedAt: "2026-07-22T08:00:00.000Z"
    },
    consumerApproval: {
      organizationId: "district-health-platform",
      role: "consumer-contract-owner",
      approverIdHash: digest("consumer-approver-001"),
      approvedAt: "2026-07-22T09:00:00.000Z"
    },
    evidenceRefs: [
      "field-dictionary-v2",
      "producer-contract-approval",
      "consumer-contract-approval",
      "joint-test-samples"
    ],
    effectiveAt: "2026-07-25T00:00:00.000Z",
    sunsetAt: "2026-08-15T00:00:00.000Z",
    status: "approved",
    issuedAt: "2026-07-23T08:00:00.000Z",
    expiresAt: "2026-09-01T00:00:00.000Z",
    nonce: "family-doctor-contract-v2-approval",
    ...overrides
  };
}

function signedAttestation(overrides = {}, signingMaterial = oldKeyring()) {
  return signPublicHealthExternalContractAttestation(
    attestationInput(overrides),
    signingMaterial
  );
}

test("base contract governance covers all eight registered adapter contracts", () => {
  const governance = buildPublicHealthExternalContractGovernance({
    attestations: [],
    signingMaterial: oldKeyring(),
    at: "2026-07-23T10:00:00.000Z"
  });
  assert.equal(governance.ok, true);
  assert.equal(governance.summary.lanes, 8);
  assert.equal(governance.summary.active, 8);
  assert.equal(governance.summary.verifiedAttestations, 0);
  assert.equal(governance.entries.every((item) => item.acceptedContracts.length === 1), true);
  assert.equal(governance.productionReady, false);
});

test("signed dual approval schedules activates deprecates and retires one next version", () => {
  const attestation = signedAttestation();
  assert.equal(verifyPublicHealthExternalContractAttestation(
    attestation,
    rotatedKeyring(),
    { at: "2026-07-24T10:00:00.000Z" }
  ).ok, true);

  const scheduled = buildPublicHealthExternalContractGovernance({
    attestations: [attestation],
    signingMaterial: rotatedKeyring(),
    at: "2026-07-24T10:00:00.000Z"
  });
  const scheduledLane = scheduled.entries.find((item) => item.laneId === "family-doctor");
  assert.equal(scheduled.summary.scheduled, 1);
  assert.equal(scheduledLane.currentContract, "family-doctor-fulfillment-v1");
  assert.equal(authorizePublicHealthExternalContract(
    scheduled,
    "family-doctor",
    "family-doctor-fulfillment-v2",
    "public-health-external-dispatch/v2",
    "public-health-external-receipt/v2"
  ).reason, "contract-version-scheduled");

  const active = buildPublicHealthExternalContractGovernance({
    attestations: [attestation],
    signingMaterial: rotatedKeyring(),
    at: "2026-07-25T00:00:00.000Z"
  });
  const activeLane = active.entries.find((item) => item.laneId === "family-doctor");
  assert.equal(activeLane.currentContract, "family-doctor-fulfillment-v2");
  assert.deepEqual(activeLane.acceptedContracts, [
    "family-doctor-fulfillment-v2",
    "family-doctor-fulfillment-v1"
  ]);
  assert.equal(authorizePublicHealthExternalContract(
    active,
    "family-doctor",
    "family-doctor-fulfillment-v1",
    "public-health-external-dispatch/v1",
    "public-health-external-receipt/v1"
  ).reason, "contract-version-deprecated");
  assert.equal(authorizePublicHealthExternalContract(
    active,
    "family-doctor",
    "family-doctor-fulfillment-v2",
    "public-health-external-dispatch/v2",
    "public-health-external-receipt/v2"
  ).ok, true);

  const retired = buildPublicHealthExternalContractGovernance({
    attestations: [attestation],
    signingMaterial: rotatedKeyring(),
    at: "2026-08-15T00:00:00.000Z"
  });
  assert.equal(authorizePublicHealthExternalContract(
    retired,
    "family-doctor",
    "family-doctor-fulfillment-v1",
    "public-health-external-dispatch/v1",
    "public-health-external-receipt/v1"
  ).reason, "contract-version-retired");
  assert.equal(retired.summary.retired, 1);
});

test("contract attestation binds every trust field and rejects post-signing tampering", () => {
  const signed = signedAttestation({
    producerApproval: {
      ...attestationInput().producerApproval,
      fullName: "must-not-be-persisted"
    }
  });
  assert.equal(Object.hasOwn(signed.producerApproval, "fullName"), false);
  assert.equal(JSON.stringify(signed).includes("must-not-be-persisted"), false);
  for (const mutation of [
    { toContract: "family-doctor-fulfillment-v3" },
    { requestSchemaVersion: "public-health-external-dispatch/v3" },
    { changeType: "breaking" },
    { fieldDictionaryDigest: digest("forged-dictionary") },
    { runtimeReleaseDigest: digest("forged-runtime-release") },
    { effectiveAt: "2026-07-26T00:00:00.000Z" },
    { sunsetAt: "2026-08-20T00:00:00.000Z" },
    { status: "draft" },
    { signingKeyId: "contract-forged" }
  ]) {
    assert.equal(verifyPublicHealthExternalContractAttestation(
      { ...signed, ...mutation },
      rotatedKeyring(),
      { at: "2026-07-24T10:00:00.000Z" }
    ).ok, false);
  }
  assert.equal(verifyPublicHealthExternalContractAttestation(
    {
      ...signed,
      producerApproval: {
        ...signed.producerApproval,
        approverIdHash: digest("forged-producer")
      }
    },
    rotatedKeyring(),
    { at: "2026-07-24T10:00:00.000Z" }
  ).reason, "contract-attestation-signature-invalid");
});

test("missing independent approval version skips and stale or revoked receipts fail closed", () => {
  assert.throws(() => signedAttestation({
    consumerApproval: {
      ...attestationInput().producerApproval,
      role: "consumer-contract-owner"
    }
  }), /approvals must be independent/);
  assert.throws(() => signedAttestation({
    toContract: "family-doctor-fulfillment-v3",
    requestSchemaVersion: "public-health-external-dispatch/v3",
    receiptSchemaVersion: "public-health-external-receipt/v3"
  }), /advance exactly one version/);
  const signed = signedAttestation();
  assert.equal(verifyPublicHealthExternalContractAttestation(
    signed,
    oldKeyring(),
    { at: "2026-07-22T10:00:00.000Z" }
  ).reason, "contract attestation is not yet issued");
  assert.equal(verifyPublicHealthExternalContractAttestation(
    signed,
    rotatedKeyring(),
    { at: "2026-09-02T00:00:00.000Z" }
  ).reason, "contract attestation has expired");
  assert.equal(verifyPublicHealthExternalContractAttestation(
    signed,
    rotatedKeyring("revoked"),
    { at: "2026-07-24T10:00:00.000Z" }
  ).reason, "contract-attestation-key-revoked");
});

test("conflicting approved transitions are visible and never choose a winner", () => {
  const first = signedAttestation();
  const second = signedAttestation({
    nonce: "family-doctor-contract-v2-second-approval",
    fieldDictionaryDigest: digest("family-doctor-field-dictionary-v2-second")
  });
  const governance = buildPublicHealthExternalContractGovernance({
    attestations: [first, second],
    signingMaterial: rotatedKeyring(),
    at: "2026-07-24T10:00:00.000Z"
  });
  const lane = governance.entries.find((item) => item.laneId === "family-doctor");
  assert.equal(governance.ok, false);
  assert.equal(governance.summary.conflicts, 1);
  assert.equal(lane.currentContract, "family-doctor-fulfillment-v1");
  assert.equal(lane.transition, null);
  assert.equal(governance.productionReady, false);
  assert.equal(JSON.stringify(governance).includes(OLD_SECRET), false);
  assert.equal(JSON.stringify(governance).includes(NEW_SECRET), false);
});

test("schema mismatch and unknown contracts are rejected even inside a valid registry", () => {
  const governance = buildPublicHealthExternalContractGovernance({
    attestations: [signedAttestation()],
    signingMaterial: rotatedKeyring(),
    at: "2026-07-25T00:00:00.000Z"
  });
  assert.equal(authorizePublicHealthExternalContract(
    governance,
    "family-doctor",
    "family-doctor-fulfillment-v2",
    "public-health-external-dispatch/v1",
    "public-health-external-receipt/v2"
  ).reason, "contract-schema-version-mismatch");
  assert.equal(authorizePublicHealthExternalContract(
    governance,
    "family-doctor",
    "family-doctor-fulfillment-v99",
    "public-health-external-dispatch/v99",
    "public-health-external-receipt/v99"
  ).reason, "contract-version-unknown");
  assert.equal(authorizePublicHealthExternalContract(
    governance,
    "unknown-lane",
    "unknown-v1",
    "public-health-external-dispatch/v1",
    "public-health-external-receipt/v1"
  ).reason, "contract-governance-unavailable");
});
