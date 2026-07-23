const assert = require("node:assert/strict");
const test = require("node:test");

const {
  ROTATION_SEQUENCE,
  buildPublicHealthKeySafetyBoard,
  evaluateRotationEvidence,
  loadPublicHealthLaneCredentials
} = require("../public-health-external-key-provider");

const AT = "2026-07-23T08:00:00.000Z";
const REQUEST_SECRET = "provider-request-secret-1234567890-123456";
const RECEIPT_SECRET = "provider-receipt-secret-1234567890-123456";

function managedKeyring(purpose, activeKeyId, keys) {
  return { purpose, activeKeyId, keys };
}

test("local compatibility credentials stay non-enumerable and production blocked", async () => {
  const credentials = await loadPublicHealthLaneCredentials("immunization", {
    at: AT,
    env: {
      NODE_ENV: "test",
      PUBLIC_HEALTH_IMMUNIZATION_ENDPOINT: "https://immunization.example.test/dispatch",
      PUBLIC_HEALTH_IMMUNIZATION_REQUEST_SECRET: REQUEST_SECRET,
      PUBLIC_HEALTH_IMMUNIZATION_RECEIPT_SECRET: RECEIPT_SECRET
    }
  });
  assert.equal(credentials.endpoint, "https://immunization.example.test/dispatch");
  assert.equal(credentials.requestKeyring, REQUEST_SECRET);
  assert.equal(credentials.receiptKeyring, RECEIPT_SECRET);
  assert.equal(credentials.summary.source, "legacy-static");
  assert.equal(credentials.summary.productionReady, false);
  const serialized = JSON.stringify(credentials);
  assert.doesNotMatch(serialized, new RegExp(REQUEST_SECRET));
  assert.doesNotMatch(serialized, new RegExp(RECEIPT_SECRET));
  assert.doesNotMatch(serialized, /example\.test\/dispatch/);
});

test("production loads request and receipt keyrings by lane reference", async () => {
  const calls = [];
  const requestKeyring = managedKeyring("public-health-request", "request-2026-08", [{
    keyId: "request-2026-08",
    secret: REQUEST_SECRET,
    status: "active",
    notBefore: "2026-07-01T00:00:00.000Z",
    expiresAt: "2026-09-01T00:00:00.000Z",
    revokedAt: ""
  }]);
  const receiptKeyring = managedKeyring("public-health-receipt", "receipt-2026-08", [{
    keyId: "receipt-2026-08",
    secret: RECEIPT_SECRET,
    status: "active",
    notBefore: "2026-07-01T00:00:00.000Z",
    expiresAt: "2026-09-01T00:00:00.000Z",
    revokedAt: ""
  }]);
  const credentials = await loadPublicHealthLaneCredentials("immunization", {
    at: AT,
    env: {
      NODE_ENV: "production",
      PUBLIC_HEALTH_IMMUNIZATION_ENDPOINT: "https://immunization.example.test/dispatch",
      PUBLIC_HEALTH_IMMUNIZATION_REQUEST_KEYRING_REF: "kms://public-health/immunization/request",
      PUBLIC_HEALTH_IMMUNIZATION_RECEIPT_KEYRING_REF: "kms://public-health/immunization/receipt"
    },
    loader: async (request) => {
      calls.push(request);
      return request.purpose.endsWith("request") ? requestKeyring : receiptKeyring;
    }
  });
  assert.deepEqual(calls.map((item) => [item.laneId, item.purpose, item.reference]), [
    ["immunization", "public-health-request", "kms://public-health/immunization/request"],
    ["immunization", "public-health-receipt", "kms://public-health/immunization/receipt"]
  ]);
  assert.equal(credentials.requestKeyring, requestKeyring);
  assert.equal(credentials.receiptKeyring, receiptKeyring);
  assert.equal(credentials.summary.source, "managed-key-service");
  assert.equal(credentials.summary.productionReady, false);
  assert.doesNotMatch(JSON.stringify(credentials), /provider-(request|receipt)-secret/);
});

test("production fails closed without references or a managed key service", async () => {
  await assert.rejects(() => loadPublicHealthLaneCredentials("immunization", {
    at: AT,
    env: { NODE_ENV: "production" }
  }), /REQUEST_KEYRING_REF is required/);
  await assert.rejects(() => loadPublicHealthLaneCredentials("immunization", {
    at: AT,
    env: {
      NODE_ENV: "production",
      PUBLIC_HEALTH_IMMUNIZATION_REQUEST_KEYRING_REF: "kms://request",
      PUBLIC_HEALTH_IMMUNIZATION_RECEIPT_KEYRING_REF: "kms://receipt"
    }
  }), /managed public health key service is unavailable/);
});

test("rotation evidence must follow active grace smoke and retirement order", () => {
  const outOfOrder = evaluateRotationEvidence([
    { step: "new-active", status: "verified" },
    { step: "cross-key-callback-smoke", status: "verified" }
  ]);
  assert.equal(outOfOrder.ok, false);
  assert.equal(outOfOrder.steps.find((item) => item.step === "cross-key-callback-smoke").status, "blocked-by-sequence");

  const complete = evaluateRotationEvidence(ROTATION_SEQUENCE.map((step) => ({ step, status: "verified" })));
  assert.equal(complete.ok, true);
  assert.equal(complete.complete, true);
  assert.equal(complete.productionReady, false);
});

test("revoked historical references enter security quarantine without automatic recovery", () => {
  const requestKeyring = managedKeyring("public-health-request", "request-active", [
    {
      keyId: "request-revoked",
      secret: REQUEST_SECRET,
      status: "revoked",
      notBefore: "2026-07-01T00:00:00.000Z",
      expiresAt: "2026-09-01T00:00:00.000Z",
      revokedAt: "2026-07-23T07:00:00.000Z"
    },
    {
      keyId: "request-active",
      secret: "provider-next-request-secret-1234567890",
      status: "active",
      notBefore: "2026-07-23T07:00:00.000Z",
      expiresAt: "2026-09-01T00:00:00.000Z",
      revokedAt: ""
    }
  ]);
  const receiptKeyring = managedKeyring("public-health-receipt", "receipt-active", [{
    keyId: "receipt-active",
    secret: RECEIPT_SECRET,
    status: "active",
    notBefore: "2026-07-01T00:00:00.000Z",
    expiresAt: "2026-09-01T00:00:00.000Z",
    revokedAt: ""
  }]);
  const credentials = { requestKeyring, receiptKeyring };
  const board = buildPublicHealthKeySafetyBoard({
    publicHealthExternalDispatches: [{
      id: "dispatch-1",
      laneId: "immunization",
      requestSignatureKeyId: "request-revoked",
      request: { issuedAt: AT }
    }],
    publicHealthExternalDispatchAudit: []
  }, { immunization: credentials });
  assert.equal(board.ok, false);
  assert.equal(board.emergencyDisposition, "security-quarantine");
  assert.equal(board.automaticResignAllowed, false);
  assert.equal(board.automaticRecoveryAllowed, false);
  assert.equal(board.revocationIssues[0].code, "emergency-key-revocation-reference");
});
