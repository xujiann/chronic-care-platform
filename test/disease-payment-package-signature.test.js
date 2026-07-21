"use strict";

const assert = require("node:assert/strict");
const { generateKeyPairSync } = require("node:crypto");
const test = require("node:test");
const Signature = require("../disease-payment-package-signature");

function packagePayload() {
  return {
    id: "signed-package-001",
    regionCode: "210200",
    packageVersion: "DRG-2027-V1",
    documentNo: "医保测试〔2027〕1号",
    sourceOrganization: "测试医疗保障局",
    effectiveFrom: "2027-01-01",
    effectiveTo: "2027-12-31",
    catalog: [{ code: "BR23", weight: 2.5 }]
  };
}

test("package signature binds canonical content to a trusted public key", () => {
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const payload = packagePayload();
  payload.signatureEvidence = Signature.createPackageSignature(payload, keys.privateKey.export({ type: "pkcs8", format: "pem" }), {
    signerId: "insurance-signer-01",
    signerOrganization: payload.sourceOrganization,
    signedAt: "2026-07-21T00:00:00.000Z",
    validUntil: "2028-07-21T00:00:00.000Z"
  });
  const result = Signature.verifyPackageSignature(payload, { now: "2027-01-01T00:00:00.000Z", trustedSignerFingerprints: [payload.signatureEvidence.keyFingerprint] });
  assert.equal(result.ok, true);
  assert.equal(result.cryptographicallyValid, true);
  assert.equal(result.trusted, true);
  assert.equal(JSON.stringify(payload.signatureEvidence).includes("PRIVATE KEY"), false);
});

test("package signature rejects content drift unknown keys and expired evidence", () => {
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const payload = packagePayload();
  payload.signatureEvidence = Signature.createPackageSignature(payload, keys.privateKey.export({ type: "pkcs8", format: "pem" }), {
    signerId: "insurance-signer-02",
    signerOrganization: payload.sourceOrganization,
    signedAt: "2026-01-01T00:00:00.000Z",
    validUntil: "2026-12-31T23:59:59.000Z"
  });
  const unknown = Signature.verifyPackageSignature(payload, { now: "2026-06-01T00:00:00.000Z", trustedSignerFingerprints: ["f".repeat(64)] });
  assert.equal(unknown.ok, false);
  assert.ok(unknown.errors.some((item) => item.includes("可信清单")));
  const expired = Signature.verifyPackageSignature(payload, { now: "2027-01-01T00:00:00.000Z", trustedSignerFingerprints: [payload.signatureEvidence.keyFingerprint] });
  assert.equal(expired.ok, false);
  assert.ok(expired.errors.some((item) => item.includes("已过期")));
  payload.catalog[0].weight = 3;
  const tampered = Signature.verifyPackageSignature(payload, { now: "2026-06-01T00:00:00.000Z", trustedSignerFingerprints: [payload.signatureEvidence.keyFingerprint] });
  assert.equal(tampered.ok, false);
  assert.ok(tampered.errors.some((item) => item.includes("内容摘要")));
  assert.equal(tampered.cryptographicallyValid, false);
});
