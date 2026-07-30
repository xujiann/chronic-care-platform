"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  PUBLIC_HEALTH_OFFICIAL_EXCHANGE_RECEIPT_PURPOSE,
  buildPublicHealthOfficialExchangeReceiptRegistry,
  issueTrustedPublicHealthOfficialExchangeReceipt,
  verifyTrustedPublicHealthOfficialExchangeReceipt
} = require("../public-health-official-exchange-receipt-service");

const NOW = "2026-07-30T10:00:00.000Z";
const KEYRING = {
  purpose: PUBLIC_HEALTH_OFFICIAL_EXCHANGE_RECEIPT_PURPOSE,
  activeKeyId: "official-exchange-2026-07",
  keys: [{
    keyId: "official-exchange-2026-07",
    secret: "public-health-official-exchange-receipt-secret-2026-07",
    status: "active",
    notBefore: "2026-07-01T00:00:00.000Z",
    expiresAt: "2027-01-01T00:00:00.000Z",
    revokedAt: ""
  }]
};

function officialReport(index = 1, overrides = {}) {
  return issueTrustedPublicHealthOfficialExchangeReceipt({
    id: `official-report-receipt-${index}`,
    stage: "official-report",
    alertId: `ph-alert-${index}`,
    reportId: `REPORT-${index}`,
    externalReceiptCode: `REPORT-ACCEPTED-${index}`,
    status: "accepted",
    evidenceRefs: [`official-report-evidence-${index}`],
    issuedAt: "2026-07-30T09:00:00.000Z",
    ...overrides
  }, {
    signedBy: "provincial-reporting-platform",
    verifiedBy: "server-official-report-adapter",
    verifiedAt: "2026-07-30T09:00:30.000Z",
    signatureVerified: true,
    receiptId: `server-official-report-receipt-${index}`
  }, KEYRING);
}

function feedback(predecessor, index = 1, overrides = {}) {
  return issueTrustedPublicHealthOfficialExchangeReceipt({
    id: `official-feedback-receipt-${index}`,
    stage: "feedback",
    alertId: predecessor.alertId,
    reportId: predecessor.reportId,
    externalReceiptCode: `FEEDBACK-ACCEPTED-${index}`,
    conclusion: "provincial platform accepted the report for continued monitoring",
    status: "accepted",
    evidenceRefs: [`official-feedback-evidence-${index}`],
    issuedAt: "2026-07-30T09:30:00.000Z",
    ...overrides
  }, {
    signedBy: "provincial-reporting-platform",
    verifiedBy: "server-official-feedback-adapter",
    verifiedAt: "2026-07-30T09:30:30.000Z",
    signatureVerified: true,
    receiptId: `server-official-feedback-receipt-${index}`
  }, KEYRING, predecessor);
}

test("trusted official report and feedback form one verified predecessor chain", () => {
  const report = officialReport();
  const response = feedback(report);
  const registry = buildPublicHealthOfficialExchangeReceiptRegistry({
    receipts: [report, response],
    keyring: KEYRING,
    at: NOW
  });
  assert.equal(registry.ok, true);
  assert.equal(registry.summary.trustedReceipts, 2);
  assert.equal(registry.summary.officialReports, 1);
  assert.equal(registry.summary.feedbacks, 1);
  assert.equal(registry.summary.findings, 0);
  assert.equal(registry.blockers.length, 2);
  assert.match(registry.blockers.join(" "), /formal launch approval/);
  assert.equal(registry.productionReady, false);
});

test("client self-reported trust metadata cannot create a trusted official receipt", () => {
  const forged = {
    id: "forged-report",
    stage: "official-report",
    alertId: "ph-alert-forged",
    reportId: "REPORT-FORGED",
    externalReceiptCode: "ACCEPTED-FORGED",
    status: "accepted",
    evidenceRefs: ["forged-evidence"],
    issuedAt: "2026-07-30T09:00:00.000Z",
    trustedVerification: {
      attestationOrigin: "server-generated",
      verificationSource: "server-official-receipt-adapter",
      signatureVerified: true,
      signedBy: "client-claimed-platform",
      verifiedBy: "client-claimed-verifier",
      verifiedAt: "2026-07-30T09:00:30.000Z",
      algorithm: "HMAC-SHA256",
      keyId: KEYRING.activeKeyId,
      receiptId: "client-claimed-receipt",
      receiptSignature: "a".repeat(64)
    }
  };
  const registry = buildPublicHealthOfficialExchangeReceiptRegistry({
    receipts: [forged],
    keyring: KEYRING,
    at: NOW
  });
  assert.equal(registry.ok, false);
  assert.equal(registry.summary.trustedReceipts, 0);
  assert.match(registry.findings[0].reasons.join(" "), /signature mismatch/);
  assert.equal(registry.productionReady, false);
});

test("receipt signature binds business status evidence and every trust decision field", () => {
  const signed = officialReport();
  const recordMutations = [
    { stage: "feedback" },
    { alertId: "tampered-alert" },
    { reportId: "tampered-report" },
    { externalReceiptCode: "tampered-external-code" },
    { conclusion: "tampered conclusion" },
    { status: "rejected" },
    { evidenceRefs: ["tampered-evidence"] },
    { issuedAt: "2026-07-30T08:00:00.000Z" }
  ];
  recordMutations.forEach((mutation) => {
    assert.equal(verifyTrustedPublicHealthOfficialExchangeReceipt(
      { ...signed, ...mutation },
      KEYRING,
      NOW
    ).ok, false);
  });
  [
    { attestationOrigin: "client-generated" },
    { verificationSource: "untrusted-client" },
    { signatureVerified: false },
    { signedBy: "tampered-signer" },
    { verifiedBy: "tampered-verifier" },
    { keyId: "tampered-key" },
    { receiptId: "tampered-receipt" }
  ].forEach((mutation) => {
    assert.equal(verifyTrustedPublicHealthOfficialExchangeReceipt({
      ...signed,
      trustedVerification: { ...signed.trustedVerification, ...mutation }
    }, KEYRING, NOW).ok, false);
  });
});

test("feedback signing rejects a missing or cross-alert predecessor", () => {
  const report = officialReport();
  assert.throws(() => issueTrustedPublicHealthOfficialExchangeReceipt({
    id: "feedback-without-predecessor",
    stage: "feedback",
    alertId: report.alertId,
    reportId: report.reportId,
    externalReceiptCode: "FEEDBACK-WITHOUT-PREDECESSOR",
    conclusion: "feedback without a trusted predecessor",
    status: "accepted",
    evidenceRefs: ["feedback-evidence"],
    issuedAt: "2026-07-30T09:30:00.000Z"
  }, {
    signedBy: "provincial-reporting-platform",
    verifiedBy: "server-official-feedback-adapter",
    verifiedAt: "2026-07-30T09:30:30.000Z",
    signatureVerified: true,
    receiptId: "feedback-without-predecessor-receipt"
  }, KEYRING), /trusted official-report predecessor/);
  assert.throws(() => feedback(report, 2, {
    alertId: "different-alert"
  }), /same alert and report/);
});

test("tampering or deleting the feedback predecessor fails the chain closed", () => {
  const report = officialReport();
  const response = feedback(report);
  const withoutPredecessor = buildPublicHealthOfficialExchangeReceiptRegistry({
    receipts: [response],
    keyring: KEYRING,
    at: NOW
  });
  assert.equal(withoutPredecessor.ok, false);
  assert.equal(withoutPredecessor.summary.trustedReceipts, 0);
  assert.match(withoutPredecessor.findings[0].reasons.join(" "), /predecessor binding mismatch/);

  const tampered = JSON.parse(JSON.stringify(response));
  tampered.predecessorBindingDigest = "f".repeat(64);
  const verification = verifyTrustedPublicHealthOfficialExchangeReceipt(tampered, KEYRING, NOW);
  assert.equal(verification.ok, false);
  assert.match(verification.reasons.join(" "), /signature mismatch/);

  const replayedPredecessor = buildPublicHealthOfficialExchangeReceiptRegistry({
    receipts: [report, report, response],
    keyring: KEYRING,
    at: NOW
  });
  assert.equal(replayedPredecessor.ok, false);
  assert.equal(replayedPredecessor.trustedReceipts.some((item) => item.stage === "feedback"), false);
  assert.ok(replayedPredecessor.findings.some((item) => (
    item.receiptId === response.id
      && item.reasons.includes("feedback predecessor binding mismatch")
  )));
});

test("record, server receipt and external receipt replay are rejected", () => {
  const report = officialReport();
  const duplicateExternalCode = officialReport(2, {
    externalReceiptCode: report.externalReceiptCode
  });
  const registry = buildPublicHealthOfficialExchangeReceiptRegistry({
    receipts: [report, report, duplicateExternalCode],
    keyring: KEYRING,
    at: NOW
  });
  assert.equal(registry.ok, false);
  assert.equal(registry.summary.trustedReceipts, 0);
  assert.ok(registry.findings.some((item) => item.reasons.some((reason) => /id replay/.test(reason))));
  assert.ok(registry.findings.some((item) => item.reasons.some((reason) => /server receipt replay/.test(reason))));
  assert.ok(registry.findings.some((item) => item.reasons.some((reason) => /external receipt replay/.test(reason))));
});

test("future receipts and revoked signing keys invalidate the registry", () => {
  const report = officialReport();
  const future = {
    ...report,
    issuedAt: "2026-07-31T09:00:00.000Z"
  };
  assert.equal(verifyTrustedPublicHealthOfficialExchangeReceipt(future, KEYRING, NOW).ok, false);

  const revokedKeyring = {
    ...KEYRING,
    activeKeyId: "official-exchange-2026-08",
    keys: [
      {
        ...KEYRING.keys[0],
        status: "revoked",
        revokedAt: "2026-07-30T09:45:00.000Z"
      },
      {
        keyId: "official-exchange-2026-08",
        secret: "public-health-official-exchange-receipt-secret-2026-08",
        status: "active",
        notBefore: "2026-07-30T09:45:00.000Z",
        expiresAt: "2027-07-30T00:00:00.000Z",
        revokedAt: ""
      }
    ]
  };
  const registry = buildPublicHealthOfficialExchangeReceiptRegistry({
    receipts: [report],
    keyring: revokedKeyring,
    at: NOW
  });
  assert.equal(registry.ok, false);
  assert.match(registry.findings[0].reasons.join(" "), /key-revoked/);
});
