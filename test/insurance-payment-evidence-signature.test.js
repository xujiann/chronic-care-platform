"use strict";

const assert = require("node:assert/strict");
const { generateKeyPairSync } = require("node:crypto");
const test = require("node:test");
const Evidence = require("../scripts/insurance-payment-evidence-packet");
const Signature = require("../insurance-payment-evidence-signature");

function signedPacket(keyType = "ec") {
  const keys = keyType === "ec"
    ? generateKeyPairSync("ec", { namedCurve: "prime256v1" })
    : generateKeyPairSync("rsa", { modulusLength: 2048 });
  const packet = Evidence.buildInsurancePaymentEvidencePacket({ generatedAt: "2026-07-29T08:00:00.000Z" });
  packet.signatureEnvelope = Signature.createEvidencePacketSignature(packet, keys.privateKey.export({ type: "pkcs8", format: "pem" }), {
    signerId: "t07-release-signer",
    signerOrganization: "医保支付发布管理",
    signedAt: "2026-07-29T08:01:00.000Z",
    validUntil: "2026-08-28T08:01:00.000Z"
  });
  return { keys, packet };
}

test("insurance payment evidence packet accepts a trusted short-lived signature", () => {
  const { packet } = signedPacket();
  const result = Signature.verifyEvidencePacketSignature(packet, {
    now: "2026-07-30T00:00:00.000Z",
    trustedSignerFingerprints: [packet.signatureEnvelope.keyFingerprint]
  });
  assert.equal(result.ok, true);
  assert.equal(result.cryptographicallyValid, true);
  assert.equal(result.trusted, true);
  assert.equal(Evidence.verifyInsurancePaymentEvidencePacket(packet, {
    requireSignature: true,
    now: "2026-07-30T00:00:00.000Z",
    trustedSignerFingerprints: [packet.signatureEnvelope.keyFingerprint]
  }), true);
  assert.doesNotMatch(JSON.stringify(packet.signatureEnvelope), /PRIVATE KEY/);
});

test("insurance payment evidence signature rejects drift unknown trust and expiry", () => {
  const { packet } = signedPacket("rsa");
  assert.equal(Signature.verifyEvidencePacketSignature(packet, { now: "2026-07-30T00:00:00.000Z", trustedSignerFingerprints: ["f".repeat(64)] }).ok, false);
  assert.equal(Signature.verifyEvidencePacketSignature(packet, { now: "2026-09-01T00:00:00.000Z", trustedSignerFingerprints: [packet.signatureEnvelope.keyFingerprint] }).ok, false);
  packet.workflows[0].ready = false;
  packet.packetDigest = `sha256:${Evidence.sha256(Evidence.stableStringify(Evidence.packetPayload(packet)))}`;
  const tampered = Signature.verifyEvidencePacketSignature(packet, { now: "2026-07-30T00:00:00.000Z", trustedSignerFingerprints: [packet.signatureEnvelope.keyFingerprint] });
  assert.equal(tampered.ok, false);
  assert.equal(tampered.cryptographicallyValid, false);
});

test("insurance payment evidence signature limits validity to 31 days", () => {
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const packet = Evidence.buildInsurancePaymentEvidencePacket({ generatedAt: "2026-07-29T08:00:00.000Z" });
  assert.throws(
    () => Signature.createEvidencePacketSignature(packet, keys.privateKey.export({ type: "pkcs8", format: "pem" }), {
      signerId: "t07-release-signer",
      signerOrganization: "医保支付发布管理",
      signedAt: "2026-07-29T08:01:00.000Z",
      validUntil: "2026-09-30T08:01:00.000Z"
    }),
    /31天/
  );
});
