const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const {
  assertUniquePublicHealthContractAttestations,
  publicHealthContractRuntimeReleaseDigest,
  signTrustedPublicHealthContractAttestation
} = require("../public-health-external-contract-integration");

const AT = "2026-07-23T08:00:00.000Z";
const SECRET = "contract-integration-secret-1234567890-123";
const hex = (value) => crypto.createHash("sha256").update(value).digest("hex");

function trustedEvidence() {
  const t08ReleaseDigest = hex("T08-904e2e0");
  const t00ReleaseDigest = hex("T00-contract-integration");
  return [{
    id: "release-immunization-v2",
    status: "deployed-and-verified",
    laneId: "immunization",
    fromContract: "immunization-registry-v1",
    toContract: "immunization-registry-v2",
    requestSchemaVersion: "public-health-external-dispatch/v2",
    receiptSchemaVersion: "public-health-external-receipt/v2",
    changeType: "additive",
    fieldDictionaryDigest: hex("field-dictionary"),
    sampleRequestDigest: hex("sample-request"),
    sampleReceiptDigest: hex("sample-receipt"),
    t08ReleaseDigest,
    t00ReleaseDigest,
    runtimeReleaseDigest: publicHealthContractRuntimeReleaseDigest(t08ReleaseDigest, t00ReleaseDigest),
    producerApproval: {
      organizationId: "producer-org",
      role: "producer-contract-owner",
      approverIdHash: hex("producer-approver"),
      approvedAt: "2026-07-23T06:00:00.000Z"
    },
    consumerApproval: {
      organizationId: "consumer-org",
      role: "consumer-contract-owner",
      approverIdHash: hex("consumer-approver"),
      approvedAt: "2026-07-23T07:00:00.000Z"
    },
    evidenceRefs: ["field-dictionary:immunization-v2"],
    jointTestEvidenceRef: "joint-test:immunization-v2",
    rollbackEvidenceRef: "rollback:immunization-v2",
    deployedAt: "2026-07-23T05:00:00.000Z",
    verifiedAt: "2026-07-23T07:30:00.000Z"
  }];
}

test("server governance signs only trusted deployed release evidence and ignores client approval fields", () => {
  const result = signTrustedPublicHealthContractAttestation({
    payload: {
      evidenceId: "release-immunization-v2",
      expectedVersion: 0,
      effectiveAt: "2026-07-24T00:00:00.000Z",
      sunsetAt: "2026-08-24T00:00:00.000Z",
      status: "rejected",
      runtimeReleaseDigest: hex("forged-client-release"),
      producerApproval: { organizationId: "forged" }
    },
    evidenceConfig: JSON.stringify(trustedEvidence()),
    signingMaterial: SECRET,
    user: {
      id: "u-health",
      username: "health",
      role: "commission",
      orgType: "health_admin",
      orgCode: "ORG-HEALTH-DL"
    },
    at: AT
  });
  assert.equal(result.attestation.status, "approved");
  assert.equal(result.attestation.runtimeReleaseDigest, trustedEvidence()[0].runtimeReleaseDigest);
  assert.equal(result.attestation.producerApproval.organizationId, "producer-org");
  assert.equal(result.attestation.issuedAt, AT);
  assert.match(result.attestation.signature, /^[a-f0-9]{64}$/);
  assert.equal(result.actor.role, "public-health-contract-governance");
  assert.doesNotMatch(JSON.stringify(result), new RegExp(SECRET));
});

test("missing deployment evidence, forged artifact binding and non-governance actors fail closed", () => {
  const input = {
    payload: {
      evidenceId: "release-immunization-v2",
      effectiveAt: "2026-07-24T00:00:00.000Z",
      sunsetAt: "2026-08-24T00:00:00.000Z"
    },
    signingMaterial: SECRET,
    user: {
      id: "u-health",
      role: "commission",
      orgType: "health_admin",
      orgCode: "ORG-HEALTH-DL"
    },
    at: AT
  };
  assert.throws(() => signTrustedPublicHealthContractAttestation({
    ...input,
    evidenceConfig: "[]"
  }), /trusted .* release evidence is unavailable/);
  const forged = trustedEvidence();
  forged[0].runtimeReleaseDigest = hex("unbound-runtime");
  assert.throws(() => signTrustedPublicHealthContractAttestation({
    ...input,
    evidenceConfig: JSON.stringify(forged)
  }), /does not bind the deployed T08 and T00/);
  assert.throws(() => signTrustedPublicHealthContractAttestation({
    ...input,
    evidenceConfig: JSON.stringify(trustedEvidence()),
    user: { id: "u-city", role: "commission", orgType: "city", orgCode: "ORG-CITY-DL" }
  }), /governance role not allowed/);
});

test("lane and from-contract uniqueness prevents last-write-wins", () => {
  const first = { laneId: "immunization", fromContract: "immunization-registry-v1" };
  assert.doesNotThrow(() => assertUniquePublicHealthContractAttestations([first]));
  assert.throws(() => assertUniquePublicHealthContractAttestations([
    first,
    { ...first, toContract: "immunization-registry-v2-forged" }
  ]), /unique conflict/);
});
