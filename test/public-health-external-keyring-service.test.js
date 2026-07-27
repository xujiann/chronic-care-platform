const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeKeyring,
  resolveVerificationKey,
  selectSigningKey,
  summarizeKeyring
} = require("../public-health-external-keyring-service");
const {
  createPublicHealthExternalDispatch,
  signPublicHealthExternalReceipt,
  verifyPublicHealthExternalDispatch,
  verifyPublicHealthExternalReceipt
} = require("../public-health-external-adapter-service");

const OLD_SECRET = "public-health-old-key-1234567890-1234567890";
const NEW_SECRET = "public-health-new-key-1234567890-1234567890";
const RECEIPT_SECRET = "public-health-receipt-key-1234567890-1234";

function keyring(activeKeyId = "request-2026-07", oldStatus = "active") {
  const keys = [{
    keyId: "request-2026-07",
    secret: OLD_SECRET,
    status: oldStatus,
    notBefore: "2026-07-01T00:00:00.000Z",
    expiresAt: "2026-08-01T00:00:00.000Z",
    revokedAt: oldStatus === "revoked" ? "2026-07-23T08:02:00.000Z" : ""
  }];
  if (activeKeyId === "request-2026-08") {
    keys.push({
      keyId: "request-2026-08",
      secret: NEW_SECRET,
      status: "active",
      notBefore: "2026-07-23T08:01:00.000Z",
      expiresAt: "2026-09-01T00:00:00.000Z",
      revokedAt: ""
    });
  }
  return {
    purpose: "public-health-request",
    activeKeyId,
    keys
  };
}

function receiptKeyring(overrides = {}) {
  return {
    purpose: "public-health-receipt",
    activeKeyId: "receipt-2026-07",
    keys: [{
      keyId: "receipt-2026-07",
      secret: RECEIPT_SECRET,
      status: "active",
      notBefore: "2026-07-01T00:00:00.000Z",
      expiresAt: "2026-08-01T00:00:00.000Z",
      revokedAt: "",
      ...overrides
    }]
  };
}

function handoff() {
  return {
    id: "phc-immunization-001",
    laneId: "immunization",
    state: "in-progress",
    version: 3,
    businessKey: "immunization-case-001"
  };
}

function dispatchWith(material = keyring()) {
  return createPublicHealthExternalDispatch(
    handoff(),
    {
      idempotencyKey: "immunization:keyring:001",
      operation: "submit-immunization",
      evidenceRefs: ["immunization-register"],
      at: "2026-07-23T08:00:00.000Z"
    },
    {
      endpoint: "https://immunization.example.test/dispatch",
      requestKeyring: material,
      receiptKeyring: receiptKeyring()
    }
  );
}

function receiptFor(dispatch, overrides = {}) {
  return signPublicHealthExternalReceipt({
    dispatchId: dispatch.id,
    requestDigest: dispatch.requestDigest,
    laneId: dispatch.laneId,
    handoffId: dispatch.handoffId,
    status: "accepted",
    receiptCode: "IMMUNIZATION-ACCEPT-001",
    evidenceRefs: ["registry-receipt"],
    receivedAt: "2026-07-23T08:02:00.000Z",
    issuedAt: "2026-07-23T08:02:00.000Z",
    expiresAt: "2026-07-23T08:07:00.000Z",
    nonce: "receipt-nonce-immunization-001",
    ...overrides
  }, receiptKeyring());
}

test("managed keyring requires one active key and never exposes secrets in its summary", () => {
  assert.throws(() => normalizeKeyring({
    purpose: "invalid",
    activeKeyId: "key-one",
    keys: [
      {
        keyId: "key-one",
        secret: OLD_SECRET,
        status: "active",
        notBefore: "2026-07-01T00:00:00.000Z",
        expiresAt: "2026-08-01T00:00:00.000Z"
      },
      {
        keyId: "key-two",
        secret: NEW_SECRET,
        status: "active",
        notBefore: "2026-07-01T00:00:00.000Z",
        expiresAt: "2026-08-01T00:00:00.000Z"
      }
    ]
  }), /exactly one active key/);

  const summary = summarizeKeyring(keyring(), "2026-07-23T08:00:00.000Z");
  assert.equal(summary.productionReady, true);
  assert.equal(JSON.stringify(summary).includes(OLD_SECRET), false);
  assert.equal(summarizeKeyring(OLD_SECRET).productionReady, false);
});

test("rotation keeps grace signatures verifiable and signs new payloads with the active key", () => {
  const oldDispatch = dispatchWith();
  const rotated = keyring("request-2026-08", "grace");
  assert.equal(oldDispatch.requestSignatureKeyId, "request-2026-07");
  assert.deepEqual(verifyPublicHealthExternalDispatch(oldDispatch, rotated), { ok: true, reason: "verified" });
  assert.equal(selectSigningKey(rotated, "2026-07-23T08:03:00.000Z").keyId, "request-2026-08");

  const newDispatch = createPublicHealthExternalDispatch(
    handoff(),
    {
      idempotencyKey: "immunization:keyring:002",
      at: "2026-07-23T08:03:00.000Z"
    },
    {
      endpoint: "https://immunization.example.test/dispatch",
      requestKeyring: rotated,
      receiptKeyring: receiptKeyring()
    }
  );
  assert.equal(newDispatch.requestSignatureKeyId, "request-2026-08");
  assert.equal(verifyPublicHealthExternalDispatch(newDispatch, rotated).ok, true);
});

test("unknown revoked expired and tampered key identifiers fail closed", () => {
  const dispatch = dispatchWith();
  assert.equal(verifyPublicHealthExternalDispatch({
    ...dispatch,
    requestSignatureKeyId: "request-forged"
  }, keyring()).reason, "dispatch-key-unknown");
  assert.equal(verifyPublicHealthExternalDispatch({
    ...dispatch,
    request: { ...dispatch.request, signingKeyId: "request-forged" }
  }, keyring()).ok, false);
  assert.equal(verifyPublicHealthExternalDispatch(dispatch, keyring("request-2026-08", "revoked")).reason, "dispatch-key-revoked");
  assert.equal(resolveVerificationKey(
    keyring("request-2026-08", "grace"),
    "request-2026-07",
    "2026-08-02T00:00:00.000Z"
  ).reason, "key-expired-or-not-yet-valid");
});

test("signed callbacks reject expired future and key-id-tampered receipts", () => {
  const dispatch = dispatchWith();
  const receipt = receiptFor(dispatch);
  assert.equal(verifyPublicHealthExternalReceipt(
    dispatch,
    receipt,
    receiptKeyring(),
    { at: "2026-07-23T08:03:00.000Z", enforceFreshness: true }
  ).ok, true);
  assert.equal(verifyPublicHealthExternalReceipt(
    dispatch,
    receipt,
    receiptKeyring(),
    { at: "2026-07-23T08:20:00.000Z", enforceFreshness: true }
  ).reason, "receipt-expired");

  const future = receiptFor(dispatch, {
    receivedAt: "2026-07-23T08:10:00.000Z",
    issuedAt: "2026-07-23T08:10:00.000Z",
    expiresAt: "2026-07-23T08:15:00.000Z",
    nonce: "future-receipt-nonce"
  });
  assert.equal(verifyPublicHealthExternalReceipt(
    dispatch,
    future,
    receiptKeyring(),
    { at: "2026-07-23T08:00:00.000Z", enforceFreshness: true }
  ).reason, "receipt-issued-in-future");
  assert.equal(verifyPublicHealthExternalReceipt(
    dispatch,
    { ...receipt, signingKeyId: "receipt-forged" },
    receiptKeyring(),
    { at: "2026-07-23T08:03:00.000Z", enforceFreshness: true }
  ).reason, "receipt-key-unknown");
});
