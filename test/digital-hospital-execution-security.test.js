const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildDigitalHospitalSecurityCenter,
  signExecutionCallback,
  verifySignedExecutionCallback
} = require("../digital-hospital-execution-security");

const SECRET = "managed-callback-secret-with-at-least-32-characters";
const FINGERPRINT = "A1:B2:C3:D4:E5:F6:07:18:29:3A:4B:5C:6D:7E:8F:90";

function productionEnv() {
  return {
    NODE_ENV: "production",
    DIGITAL_HOSPITAL_CALLBACK_KEY_REF: "vault://digital-hospital/prod/callback-signing",
    DIGITAL_HOSPITAL_CALLBACK_MTLS_FINGERPRINTS: FINGERPRINT,
    DIGITAL_HOSPITAL_CALLBACK_MAX_SKEW_SECONDS: "300"
  };
}

function callbackPayload() {
  return {
    jobId: "JOB-CALLBACK-001",
    connectorId: "CONN-HIS-001",
    source: "CONN-HIS-001",
    environmentId: "ENV-PROD",
    eventType: "integration-job.completed",
    payloadDigest: "a".repeat(64)
  };
}

test("managed callback verification validates signature timestamp and mTLS without exposing the key", async () => {
  const payload = callbackPayload();
  const timestamp = "1785286800000";
  const nonce = "callback-nonce-001";
  const signature = signExecutionCallback(payload, { secret: SECRET, timestamp, nonce });
  const verified = await verifySignedExecutionCallback(payload, {
    env: productionEnv(),
    loader: async ({ reference, connectorId }) => {
      assert.equal(reference, "vault://digital-hospital/prod/callback-signing");
      assert.equal(connectorId, "CONN-HIS-001");
      return { secret: SECRET, keyVersion: "v4" };
    },
    timestamp,
    nonce,
    signature,
    nowMs: Number(timestamp) + 1000,
    clientCertificateFingerprint: FINGERPRINT,
    clientCertificateAuthorized: true
  });
  assert.equal(verified.signatureValid, true);
  assert.equal(verified.verification.mtls, "verified");
  assert.equal(verified.verification.keyVersion, "v4");
  assert.equal(verified.verification.keySource, "managed-secret-service");
  assert.equal(JSON.stringify(verified).includes(SECRET), false);
  assert.equal(JSON.stringify(verified).includes(signature), false);
});

test("callback verification fails closed for mismatched signatures stale timestamps and untrusted certificates", async () => {
  const payload = callbackPayload();
  const timestamp = "1785286800000";
  const nonce = "callback-nonce-002";
  const signature = signExecutionCallback(payload, { secret: SECRET, timestamp, nonce });
  const common = {
    env: productionEnv(),
    loader: async () => ({ secret: SECRET, keyVersion: "v4" }),
    timestamp,
    nonce,
    nowMs: Number(timestamp),
    clientCertificateFingerprint: FINGERPRINT,
    clientCertificateAuthorized: true
  };
  await assert.rejects(
    verifySignedExecutionCallback(payload, { ...common, signature: "0".repeat(64) }),
    (error) => error.code === "EXECUTION_CALLBACK_SIGNATURE_MISMATCH" && error.status === 401
  );
  await assert.rejects(
    verifySignedExecutionCallback(payload, {
      ...common,
      signature,
      nowMs: Number(timestamp) + 301_000
    }),
    (error) => error.code === "EXECUTION_CALLBACK_TIMESTAMP_EXPIRED"
  );
  await assert.rejects(
    verifySignedExecutionCallback(payload, {
      ...common,
      signature,
      clientCertificateFingerprint: "11:22:33:44"
    }),
    (error) => error.code === "EXECUTION_CALLBACK_MTLS_UNTRUSTED"
  );
});

test("security center distinguishes implemented adapters from configured production dependencies", () => {
  const blocked = buildDigitalHospitalSecurityCenter({
    env: { NODE_ENV: "production" },
    loaderConfigured: false
  });
  assert.equal(blocked.productionReady, false);
  assert.equal(blocked.blockers.length >= 3, true);

  const ready = buildDigitalHospitalSecurityCenter({
    env: productionEnv(),
    loaderConfigured: true
  });
  assert.equal(ready.productionReady, true);
  assert.equal(ready.managedKey.referenceConfigured, true);
  assert.equal(ready.mtls.trustedFingerprintCount, 1);
  assert.deepEqual(ready.persistenceBoundary, {
    rawSecret: false,
    rawSignature: false,
    rawNonce: false,
    rawClientCertificate: false
  });
});
