const assert = require("node:assert/strict");
const test = require("node:test");

const {
  applyFinancialCallbackAndSync,
  financialDomainStatus,
  retryFinancialProjection
} = require("../financial-domain-integration");

function callback(overrides = {}) {
  return {
    gatewayType: "INSURANCE",
    eventId: "callback-001",
    receiptId: "SETTLEMENT-001",
    status: "succeeded",
    occurredAt: "2026-07-22T03:00:00.000Z",
    receivedAt: "2026-07-22T03:00:01.000Z",
    businessDate: "2026-07-22",
    amountFen: 12345,
    providerCode: "SUCCESS",
    failureReason: "",
    settlementReferenceDigest: "a".repeat(64),
    nonceDigest: "b".repeat(64),
    signatureVerified: true,
    ...overrides
  };
}

function financialEvent(overrides = {}) {
  return {
    id: "igw-financial-001",
    adapterType: "financial",
    gatewayType: "INSURANCE",
    operation: "settlement",
    contractId: "insurance-settlement-v1",
    externalId: "CLAIM-001",
    adapterReceipt: { receiptId: "SETTLEMENT-001", status: "accepted" },
    adapterReceiptHistory: [],
    requestPayload: { payload: { claimNo: "CLAIM-001", residentId: "R-001", amountFen: 12345, institutionCode: "HOSP-001" } },
    providerStatus: "accepted",
    reconciliationStatus: "provider-accepted",
    callbackEvents: [],
    ...overrides
  };
}

function state(event = financialEvent()) {
  return { integrationGatewayEvents: [event], insuranceClaims: [], digitalCredentials: [], interfaceReconciliationCases: [] };
}

test("successful insurance callback projects a claim exactly once", () => {
  const data = state();
  const first = applyFinancialCallbackAndSync(data, callback(), { user: { username: "insurance-interface" } });
  const replay = applyFinancialCallbackAndSync(data, callback(), { user: { username: "insurance-interface" } });
  assert.equal(first.record.totalAmount, 123.45);
  assert.equal(first.record.status, "succeeded");
  assert.equal(first.projection.residentIdentityExposed, false);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(data.insuranceClaims.length, 1);
  assert.equal(data.integrationGatewayEvents[0].domainProjectionEvents.length, 1);
});

test("ignored financial callback does not regress the business record", () => {
  const data = state(financialEvent({
    adapterReceiptHistory: [{ receiptId: "SETTLEMENT-OLD", status: "accepted" }]
  }));
  const result = applyFinancialCallbackAndSync(data, callback({
    eventId: "callback-old", receiptId: "SETTLEMENT-OLD", nonceDigest: "c".repeat(64)
  }));
  assert.equal(result.projection.status, "ignored");
  assert.equal(result.projection.reason, "superseded-receipt");
  assert.equal(data.insuranceClaims.length, 0);
});

test("certificate issue without resident mapping opens P0 case and retry projects it", () => {
  const event = financialEvent({
    id: "igw-certificate-001",
    gatewayType: "CERTIFICATE",
    operation: "issue",
    contractId: "certificate-sync-v1",
    externalId: "CERT-EXT-001",
    adapterReceipt: { receiptId: "CERT-001", status: "accepted" },
    requestPayload: { payload: { externalId: "CERT-EXT-001", certificateType: "birth", subjectReference: "subject-ref-001", documentDigest: `sha256:${"d".repeat(64)}` } }
  });
  const data = state(event);
  const result = applyFinancialCallbackAndSync(data, callback({
    gatewayType: "CERTIFICATE", eventId: "cert-callback-001", receiptId: "CERT-001", amountFen: null, nonceDigest: "e".repeat(64)
  }));
  assert.equal(result.projection.status, "pending-reconciliation");
  assert.equal(result.reconciliationCase.priority, "P0");
  assert.equal(data.digitalCredentials.length, 0);

  const retried = retryFinancialProjection(data, result.reconciliationCase.id, {
    resolveResidentId: ({ subjectReference }) => subjectReference === "subject-ref-001" ? "R-CERT-001" : "",
    user: { username: "government-operator" },
    now: "2026-07-22T03:10:00.000Z"
  });
  assert.equal(retried.record.status, "active");
  assert.equal(retried.record.residentId, "R-CERT-001");
  assert.equal(retried.reconciliationCase.status, "resolved");
  assert.match(retried.record.source.subjectReferenceDigest, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(result.gatewayEvent), /subject-ref-001|nonceDigest|R-CERT/);
});

test("failed certificate revoke preserves the active business credential", () => {
  const event = financialEvent({
    id: "igw-certificate-revoke",
    gatewayType: "CERTIFICATE",
    operation: "revoke",
    contractId: "certificate-sync-v1",
    adapterReceipt: { receiptId: "CERT-REVOKE-RECEIPT", status: "accepted" },
    requestPayload: { payload: { certificateNo: "CERT-ACTIVE-001", reasonCode: "JT-REASON" } }
  });
  const data = state(event);
  data.digitalCredentials = [{ id: "dc-active", residentId: "R-001", credentialNo: "CERT-ACTIVE-001", status: "active" }];
  const result = applyFinancialCallbackAndSync(data, callback({
    gatewayType: "CERTIFICATE",
    eventId: "cert-revoke-failed",
    receiptId: "CERT-REVOKE-RECEIPT",
    status: "failed",
    amountFen: null,
    nonceDigest: "f".repeat(64)
  }));
  assert.equal(result.projection.status, "no-business-change");
  assert.equal(data.digitalCredentials[0].status, "active");
  assert.equal(data.interfaceReconciliationCases.length, 0);
});

test("unresolved financial projection becomes manual after three bounded retries", () => {
  const event = financialEvent({
    id: "igw-certificate-unresolved",
    gatewayType: "CERTIFICATE",
    operation: "issue",
    contractId: "certificate-sync-v1",
    adapterReceipt: { receiptId: "CERT-UNRESOLVED", status: "accepted" },
    requestPayload: { payload: { externalId: "CERT-UNRESOLVED-EXT", certificateType: "birth", subjectReference: "unmapped-subject", documentDigest: `sha256:${"9".repeat(64)}` } }
  });
  const data = state(event);
  const pending = applyFinancialCallbackAndSync(data, callback({
    gatewayType: "CERTIFICATE", eventId: "cert-unresolved-callback", receiptId: "CERT-UNRESOLVED", amountFen: null, nonceDigest: "8".repeat(64)
  }));
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const retried = retryFinancialProjection(data, pending.reconciliationCase.id, { resolveResidentId: () => "", now: `2026-07-22T03:1${attempt}:00.000Z` });
    assert.equal(retried.reconciliationCase.retryCount, attempt);
  }
  assert.equal(pending.reconciliationCase.status, "manual-reconciliation-required");
  assert.throws(() => retryFinancialProjection(data, pending.reconciliationCase.id, { resolveResidentId: () => "" }), (error) => error.code === "FINANCIAL_PROJECTION_RETRY_LIMIT");
  assert.equal(data.digitalCredentials.length, 0);
});

test("financial domain status reports projected and open cases", () => {
  const data = state();
  applyFinancialCallbackAndSync(data, callback());
  const status = financialDomainStatus(data);
  assert.equal(status.productionReady, false);
  assert.equal(status.summary.projected, 1);
  assert.equal(status.supported.includes("CERTIFICATE:issue"), true);
});
