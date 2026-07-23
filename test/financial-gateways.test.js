const assert = require("node:assert/strict");
const test = require("node:test");

const {
  applyFinancialCallback,
  buildRefundOperations,
  cancelRefund,
  closeRefund,
  createRefundRequest,
  createFinancialReconciliationRun,
  dispatchFinancialRequest,
  financialGatewayCenter,
  financialGatewayOperationsCenter,
  normalizeFinancialReconciliationRun,
  prepareRefundDispatch,
  reconcileRefund,
  recordRefundDispatch,
  retryRefund,
  reviewRefundRequest,
  signFinancialCallback,
  signFinancialRequest,
  stableStringify,
  syncRefundFromFinancialCallback,
  validateFinancialRequest,
  verifyFinancialCallback,
  verifyRefundLedger
} = require("../financial-gateways");

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

test("payment gateway signs integer-cent requests and normalizes receipts", async () => {
  let captured;
  const receipt = await dispatchFinancialRequest({
    type: "PAYMENT",
    operation: "create-payment",
    contractId: "payment-transaction-v1",
    idempotencyKey: "payment-order-001",
    requestId: "financial-request-001",
    payload: { orderNo: "REG-001", amountFen: 12600, currency: "CNY" }
  }, {
    env: {
      NODE_ENV: "production",
      PAYMENT_GATEWAY_URL: "https://payment.example.gov.cn/transactions",
      PAYMENT_GATEWAY_SECRET: "payment-signing-secret",
      PAYMENT_GATEWAY_TOKEN: "payment-token"
    },
    fetchImpl: async (url, options) => {
      captured = { url: String(url), options };
      return jsonResponse({ tradeNo: "PAY-001", status: "accepted" });
    }
  });
  const body = JSON.parse(captured.options.body);
  assert.equal(captured.options.headers["X-Signature"], signFinancialRequest(stableStringify(body), "payment-signing-secret", captured.options.headers["X-Timestamp"], "financial-request-001"));
  assert.equal(captured.options.headers.Authorization, "Bearer payment-token");
  assert.equal(receipt.receiptId, "PAY-001");
  assert.equal(receipt.attempts, 1);
  assert.equal(JSON.stringify(receipt).includes("payment-token"), false);
});

test("financial gateway retries transient errors with stable request identity", async () => {
  const requests = [];
  const receipt = await dispatchFinancialRequest({
    type: "INSURANCE",
    operation: "settlement",
    contractId: "insurance-settlement-v1",
    idempotencyKey: "claim-001",
    payload: { claimNo: "CLAIM-001", residentId: "r1", amountFen: 5600, institutionCode: "MR1" }
  }, {
    env: { INSURANCE_GATEWAY_URL: "http://127.0.0.1/insurance", FINANCIAL_GATEWAY_SECRET: "shared-financial-secret", FINANCIAL_GATEWAY_MAX_ATTEMPTS: "3" },
    retryDelayMs: 0,
    fetchImpl: async (_url, options) => {
      requests.push(options);
      if (requests.length === 1) return jsonResponse({ message: "temporary unavailable" }, 503);
      return jsonResponse({ settlementNo: "SETTLE-001", status: "completed" });
    }
  });
  assert.equal(receipt.attempts, 2);
  assert.equal(new Set(requests.map((item) => item.headers["X-Request-Id"])).size, 1);
  assert.equal(new Set(requests.map((item) => item.headers["X-Signature"])).size, 1);
});

test("financial requests reject sensitive fields invalid money and invalid digests", () => {
  assert.throws(() => validateFinancialRequest({ type: "INSURANCE", operation: "credential-verify", payload: { credentialReference: "ref-1", institutionCode: "MR1", credentialToken: "raw-token" } }), /sensitive field/);
  assert.throws(() => validateFinancialRequest({ type: "PAYMENT", operation: "refund", payload: { paymentTradeNo: "PAY-1", refundAmountFen: 1.25, refundReason: "test" } }), /positive integer/);
  assert.throws(() => validateFinancialRequest({ type: "CERTIFICATE", operation: "issue", payload: { externalId: "ext-1", certificateType: "birth", subjectReference: "person-ref", documentDigest: "bad" } }), /SHA-256/);
});

test("financial gateway rejects permanent errors negative receipts and non-HTTPS production endpoints", async () => {
  let attempts = 0;
  await assert.rejects(() => dispatchFinancialRequest({
    type: "CERTIFICATE", operation: "status-query", contractId: "certificate-sync-v1", idempotencyKey: "cert-query-1", payload: { certificateNo: "CERT-1" }
  }, {
    env: { CERTIFICATE_GATEWAY_URL: "http://127.0.0.1/cert", CERTIFICATE_GATEWAY_SECRET: "secret" },
    fetchImpl: async () => { attempts += 1; return jsonResponse({ message: "invalid certificate" }, 400); }
  }), /invalid certificate/);
  assert.equal(attempts, 1);

  await assert.rejects(() => dispatchFinancialRequest({
    type: "CERTIFICATE", operation: "status-query", contractId: "certificate-sync-v1", idempotencyKey: "cert-query-2", payload: { certificateNo: "CERT-2" }
  }, {
    env: { CERTIFICATE_GATEWAY_URL: "http://127.0.0.1/cert", CERTIFICATE_GATEWAY_SECRET: "secret" },
    fetchImpl: async () => jsonResponse({ receiptId: "cert-rejected", status: "rejected" })
  }), /rejected the request/);

  await assert.rejects(() => dispatchFinancialRequest({
    type: "PAYMENT", operation: "query-payment", contractId: "payment-transaction-v1", idempotencyKey: "pay-query-1", payload: { paymentTradeNo: "PAY-1" }
  }, {
    env: { NODE_ENV: "production", PAYMENT_GATEWAY_URL: "http://payment.internal", PAYMENT_GATEWAY_SECRET: "secret" },
    fetchImpl: async () => jsonResponse({ tradeNo: "PAY-1" })
  }), /HTTPS/);
});

test("financial gateway center exposes no endpoints or credentials", () => {
  const center = financialGatewayCenter({
    NODE_ENV: "production",
    PAYMENT_GATEWAY_URL: "https://payment.example.gov.cn",
    PAYMENT_GATEWAY_SECRET: "payment-secret",
    PAYMENT_CALLBACK_SECRET: "payment-callback-secret",
    INSURANCE_GATEWAY_URL: "https://insurance.example.gov.cn",
    INSURANCE_GATEWAY_SECRET: "insurance-secret",
    INSURANCE_CALLBACK_SECRET: "insurance-callback-secret",
    CERTIFICATE_GATEWAY_URL: "https://certificate.example.gov.cn",
    CERTIFICATE_GATEWAY_SECRET: "certificate-secret",
    CERTIFICATE_CALLBACK_SECRET: "certificate-callback-secret"
  });
  assert.equal(center.adapterReady, true);
  assert.equal(center.callbackReady, true);
  assert.equal(center.productionReady, false);
  assert.equal(center.summary.total, 3);
  assert.equal(center.summary.operations, 14);
  const serialized = JSON.stringify(center);
  assert.equal(serialized.includes("payment.example.gov.cn"), false);
  assert.equal(serialized.includes("payment-secret"), false);
  assert.equal(serialized.includes("payment-callback-secret"), false);
});

test("financial callbacks require a current valid domain-specific HMAC signature", () => {
  const secret = "payment-callback-secret-with-at-least-32-characters";
  const nowMs = Date.parse("2026-07-15T07:30:00.000Z");
  const timestamp = String(Math.floor(nowMs / 1000));
  const nonce = "financial-callback-nonce-001";
  const payload = {
    gatewayType: "PAYMENT",
    eventId: "payment-event-001",
    receiptId: "PAY-001",
    status: "paid",
    occurredAt: "2026-07-15T07:29:58.000Z",
    businessDate: "2026-07-15",
    amountFen: 12600,
    settlementReference: "provider-reference-must-be-digested"
  };
  const signature = signFinancialCallback(payload, { secret, timestamp, nonce });
  const verified = verifyFinancialCallback(payload, {
    type: "PAYMENT",
    env: { NODE_ENV: "production", PAYMENT_CALLBACK_SECRET: secret },
    timestamp,
    nonce,
    signature: `sha256=${signature}`,
    nowMs
  });
  assert.equal(verified.status, "succeeded");
  assert.match(verified.nonceDigest, /^[a-f0-9]{64}$/);
  assert.match(verified.settlementReferenceDigest, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(verified), /provider-reference-must-be-digested|callback-secret/);

  assert.throws(() => verifyFinancialCallback({ ...payload, amountFen: 12000 }, {
    type: "PAYMENT",
    env: { NODE_ENV: "production", PAYMENT_CALLBACK_SECRET: secret },
    timestamp,
    nonce,
    signature,
    nowMs
  }), (error) => error.code === "FINANCIAL_CALLBACK_SIGNATURE_MISMATCH");
  assert.throws(() => verifyFinancialCallback(payload, {
    type: "INSURANCE",
    env: { NODE_ENV: "production", INSURANCE_CALLBACK_SECRET: secret },
    timestamp,
    nonce,
    signature,
    nowMs
  }), (error) => error.code === "FINANCIAL_CALLBACK_GATEWAY_CONFLICT");
});

test("financial callback ledger is idempotent, amount-safe and reversal-aware", () => {
  const data = {
    integrationGatewayEvents: [{
      id: "igw-payment-001",
      adapterType: "financial",
      gatewayType: "PAYMENT",
      operation: "create-payment",
      contractId: "payment-transaction-v1",
      adapterReceipt: { receiptId: "PAY-001", status: "accepted" },
      adapterReceiptHistory: [{ receiptId: "PAY-OLD", status: "accepted" }],
      requestPayload: { payload: { orderNo: "REG-001", amountFen: 12600, currency: "CNY" } },
      providerStatus: "accepted",
      reconciliationStatus: "provider-accepted",
      dispatchedAt: "2026-07-15T07:00:00.000Z",
      callbackEvents: []
    }]
  };
  const callback = {
    gatewayType: "PAYMENT",
    eventId: "payment-event-succeeded",
    receiptId: "PAY-001",
    status: "succeeded",
    occurredAt: "2026-07-15T07:00:30.000Z",
    receivedAt: "2026-07-15T07:00:31.000Z",
    businessDate: "2026-07-15",
    amountFen: 12600,
    providerCode: "SUCCESS",
    failureReason: "",
    settlementReferenceDigest: "a".repeat(64),
    nonceDigest: "b".repeat(64),
    signatureVerified: true
  };
  const succeeded = applyFinancialCallback(data, callback);
  assert.equal(succeeded.gatewayEvent.providerStatus, "succeeded");
  assert.equal(succeeded.gatewayEvent.reconciliationStatus, "provider-final");
  assert.equal(applyFinancialCallback(data, callback).idempotentReplay, true);
  assert.throws(() => applyFinancialCallback(data, {
    ...callback,
    businessDate: "2026-07-14"
  }), (error) => error.code === "FINANCIAL_CALLBACK_EVENT_CONFLICT");

  const oldReceipt = applyFinancialCallback(data, {
    ...callback,
    eventId: "payment-event-old-receipt",
    receiptId: "PAY-OLD",
    receivedAt: "2026-07-15T07:00:32.000Z",
    nonceDigest: "c".repeat(64)
  });
  assert.equal(oldReceipt.callbackEvent.stateApplied, false);
  assert.equal(oldReceipt.callbackEvent.ignoredReason, "superseded-receipt");

  const amountMismatch = applyFinancialCallback(data, {
    ...callback,
    eventId: "payment-event-amount-mismatch",
    amountFen: 12599,
    receivedAt: "2026-07-15T07:00:33.000Z",
    nonceDigest: "d".repeat(64)
  });
  assert.equal(amountMismatch.callbackEvent.ignoredReason, "amount-mismatch");

  const reversed = applyFinancialCallback(data, {
    ...callback,
    eventId: "payment-event-reversed",
    status: "reversed",
    occurredAt: "2026-07-15T07:10:00.000Z",
    receivedAt: "2026-07-15T07:10:01.000Z",
    nonceDigest: "e".repeat(64)
  });
  assert.equal(reversed.callbackEvent.stateApplied, true);
  assert.equal(reversed.gatewayEvent.providerStatus, "reversed");
  assert.equal(reversed.gatewayEvent.reconciliationStatus, "provider-exception");
  assert.throws(() => applyFinancialCallback(data, {
    ...callback,
    eventId: "payment-event-replay-nonce",
    nonceDigest: "e".repeat(64)
  }), (error) => error.code === "FINANCIAL_CALLBACK_REPLAY_DETECTED");
});

test("financial reconciliation compares digest-only provider summaries", () => {
  const data = {
    integrationGatewayEvents: [{
      id: "igw-insurance-001",
      adapterType: "financial",
      gatewayType: "INSURANCE",
      operation: "settlement",
      adapterReceipt: { receiptId: "SETTLE-001", status: "succeeded" },
      requestPayload: { payload: { claimNo: "CLAIM-001", amountFen: 5600 } },
      reconciliationStatus: "provider-final",
      businessDate: "2026-07-15",
      callbackEvents: []
    }, {
      id: "igw-insurance-query-001",
      adapterType: "financial",
      gatewayType: "INSURANCE",
      operation: "eligibility-precheck",
      adapterReceipt: { receiptId: "ELIGIBILITY-001", status: "accepted" },
      providerStatus: "succeeded",
      reconciliationStatus: "provider-final",
      businessDate: "2026-07-15",
      callbackEvents: []
    }],
    financialReconciliationRuns: []
  };
  const input = {
    gatewayType: "INSURANCE",
    businessDate: "2026-07-15",
    providerSummary: {
      total: 1,
      succeeded: 1,
      exceptions: 0,
      grossAmountFen: 5600,
      statementDigest: "f".repeat(64)
    }
  };
  const matched = createFinancialReconciliationRun(data, input, { username: "insurance" });
  assert.equal(matched.run.status, "matched");
  assert.equal(createFinancialReconciliationRun(data, input).idempotentReplay, true);
  assert.throws(() => createFinancialReconciliationRun(data, {
    ...input,
    providerSummary: { ...input.providerSummary, total: 2 }
  }), (error) => error.code === "FINANCIAL_RECONCILIATION_DIGEST_CONFLICT");
  const different = createFinancialReconciliationRun(data, {
    ...input,
    providerSummary: { ...input.providerSummary, grossAmountFen: 5500, statementDigest: "1".repeat(64) }
  });
  assert.equal(different.run.status, "difference");
  assert.equal(different.run.differences.grossAmountFen, -100);
  assert.equal(normalizeFinancialReconciliationRun({ ...different.run, status: "matched" }).status, "difference");

  const center = financialGatewayOperationsCenter(data, { INSURANCE_CALLBACK_SECRET: "configured" }, "INSURANCE");
  assert.equal(center.summary.dispatched, 2);
  assert.equal(center.summary.reconciliationRuns, 2);
  assert.equal(center.summary.reconciliationDifferences, 1);
  assert.doesNotMatch(JSON.stringify(center), /nonceDigest|CLAIM-001/);
});

test("online refund workflow enforces dual review available balance trusted callback and reconciliation", () => {
  const data = {
    integrationGatewayEvents: [{
      id: "igw-original-payment",
      adapterType: "financial",
      gatewayType: "PAYMENT",
      operation: "create-payment",
      externalId: "ORDER-001",
      adapterReceipt: { receiptId: "PAY-ORIGINAL-001", status: "succeeded" },
      requestPayload: { payload: { orderNo: "ORDER-001", amountFen: 10000, currency: "CNY" } },
      providerStatus: "succeeded",
      reconciliationStatus: "provider-final",
      businessDate: "2026-07-22",
      callbackEvents: []
    }],
    financialReconciliationRuns: [],
    onlinePaymentRefunds: []
  };
  const requested = createRefundRequest(data, { id: "refund-001", paymentEventId: "igw-original-payment", paymentTradeNo: "PAY-ORIGINAL-001", orderReference: "ORDER-001", refundAmountFen: 4000, refundReason: "取消医疗服务", reasonCode: "SERVICE_CANCELLED", idempotencyKey: "refund-idem-001" }, { username: "cashier-a" });
  assert.equal(requested.row.state, "REQUESTED");
  assert.equal(createRefundRequest(data, { paymentEventId: "igw-original-payment", paymentTradeNo: "PAY-ORIGINAL-001", refundAmountFen: 4000, refundReason: "取消医疗服务", idempotencyKey: "refund-idem-001" }).idempotent, true);
  assert.throws(() => reviewRefundRequest(data, requested.row.id, { approved: true }, { username: "cashier-a" }), /申请人与复核人必须分离/);
  reviewRefundRequest(data, requested.row.id, { approved: true, reviewDomain: "business-review", role: "业务复核" }, { username: "reviewer-b" });
  assert.throws(() => reviewRefundRequest(data, requested.row.id, { approved: true, reviewDomain: "business-review", role: "业务复核" }, { username: "reviewer-b2" }), (error) => error.code === "REFUND_DUPLICATE_REVIEW_DOMAIN");
  const approved = reviewRefundRequest(data, requested.row.id, { approved: true, reviewDomain: "finance-review", role: "财务复核" }, { username: "reviewer-c" });
  assert.equal(approved.row.state, "APPROVED");
  const dispatch = prepareRefundDispatch(data, requested.row.id);
  assert.deepEqual(dispatch.payload, { externalId: "refund-001", paymentTradeNo: "PAY-ORIGINAL-001", refundAmountFen: 4000, refundReason: "取消医疗服务" });
  const gatewayEvent = {
    id: "igw-refund-001",
    adapterType: "financial",
    gatewayType: "PAYMENT",
    operation: "refund",
    externalId: requested.row.id,
    adapterReceipt: { receiptId: "REFUND-RECEIPT-001", status: "accepted" },
    requestPayload: { payload: dispatch.payload },
    providerStatus: "accepted",
    reconciliationStatus: "provider-processing",
    businessDate: "2026-07-22",
    callbackEvents: []
  };
  data.integrationGatewayEvents.push(gatewayEvent);
  recordRefundDispatch(data, requested.row.id, { type: "PAYMENT", operation: "refund", receiptId: "REFUND-RECEIPT-001", status: "accepted", requestId: "REFUND-REQUEST-001", acceptedAt: "2026-07-22T08:00:00.000Z" }, gatewayEvent.id, { username: "refund-worker" });
  const applied = applyFinancialCallback(data, { gatewayType: "PAYMENT", eventId: "refund-callback-001", receiptId: "REFUND-RECEIPT-001", status: "succeeded", occurredAt: "2026-07-22T08:01:00.000Z", receivedAt: "2026-07-22T08:01:01.000Z", businessDate: "2026-07-22", amountFen: 4000, providerCode: "SUCCESS", failureReason: "", settlementReferenceDigest: "a".repeat(64), nonceDigest: "b".repeat(64), signatureVerified: true });
  assert.throws(() => syncRefundFromFinancialCallback(data, applied), /已验签金融回调/);
  const synced = syncRefundFromFinancialCallback(data, applied, "financial-callback-adapter", { trustedFinancialCallback: true });
  assert.equal(synced.row.state, "SUCCEEDED");
  const run = createFinancialReconciliationRun(data, { gatewayType: "PAYMENT", businessDate: "2026-07-22", providerSummary: { total: 2, succeeded: 2, exceptions: 0, grossAmountFen: 14000, statementDigest: "c".repeat(64) } }, { username: "finance" });
  assert.equal(run.run.status, "matched");
  reconcileRefund(data, requested.row.id, { reconciliationRunId: run.run.id }, { username: "finance" });
  const closed = closeRefund(data, requested.row.id, { voucherNo: "REFUND-VOUCHER-001" }, { username: "finance" });
  assert.equal(closed.row.state, "CLOSED");
  assert.equal(verifyRefundLedger(closed.row.events), true);
  assert.throws(() => createRefundRequest(data, { paymentEventId: "igw-original-payment", paymentTradeNo: "PAY-ORIGINAL-001", refundAmountFen: 6001, refundReason: "超额退款", idempotencyKey: "refund-over" }), /超过原支付交易可退余额/);
  const remaining = createRefundRequest(data, { id: "refund-remaining", paymentEventId: "igw-original-payment", paymentTradeNo: "PAY-ORIGINAL-001", refundAmountFen: 6000, refundReason: "退回剩余金额", idempotencyKey: "refund-remaining-idem" }, { username: "cashier-a" });
  cancelRefund(data, remaining.row.id, { reason: "居民撤销退款申请", idempotencyKey: "refund-cancel" }, { username: "cashier-a" });
  assert.equal(buildRefundOperations(data).summary.refundAmountFen, 4000);
  const center = financialGatewayOperationsCenter(data, {}, "PAYMENT");
  assert.equal(center.summary.refundRequests, 2);
  assert.equal(center.refundOperations.refunds.every((item) => item.ledgerValid), true);
  assert.doesNotMatch(JSON.stringify(center.refundOperations), /PAY-ORIGINAL-001/);
});

test("failed online refund remains reserved and can retry without creating a second refund request", () => {
  const data = {
    integrationGatewayEvents: [{ id: "igw-payment-retry", adapterType: "financial", gatewayType: "PAYMENT", operation: "create-payment", adapterReceipt: { receiptId: "PAY-RETRY", status: "succeeded" }, requestPayload: { payload: { orderNo: "ORDER-RETRY", amountFen: 5000 } }, providerStatus: "succeeded", reconciliationStatus: "provider-final", businessDate: "2026-07-22", callbackEvents: [] }],
    onlinePaymentRefunds: []
  };
  const created = createRefundRequest(data, { id: "refund-retry", paymentEventId: "igw-payment-retry", paymentTradeNo: "PAY-RETRY", refundAmountFen: 1000, refundReason: "重复收费", idempotencyKey: "refund-retry-idem" }, { username: "cashier" });
  reviewRefundRequest(data, created.row.id, { approved: true, reviewDomain: "business-review" }, { username: "reviewer-1" });
  reviewRefundRequest(data, created.row.id, { approved: true, reviewDomain: "finance-review" }, { username: "reviewer-2" });
  const dispatch = prepareRefundDispatch(data, created.row.id);
  const gatewayEvent = { id: "igw-refund-retry-1", adapterType: "financial", gatewayType: "PAYMENT", operation: "refund", adapterReceipt: { receiptId: "REFUND-RETRY-1", status: "accepted" }, requestPayload: { payload: dispatch.payload }, providerStatus: "accepted", reconciliationStatus: "provider-processing", businessDate: "2026-07-22", callbackEvents: [] };
  data.integrationGatewayEvents.push(gatewayEvent);
  recordRefundDispatch(data, created.row.id, { type: "PAYMENT", operation: "refund", receiptId: "REFUND-RETRY-1", status: "accepted", requestId: "REFUND-RETRY-REQUEST-1", acceptedAt: "2026-07-22T09:00:00.000Z" }, gatewayEvent.id);
  const failed = applyFinancialCallback(data, { gatewayType: "PAYMENT", eventId: "refund-retry-failed", receiptId: "REFUND-RETRY-1", status: "failed", occurredAt: "2026-07-22T09:01:00.000Z", receivedAt: "2026-07-22T09:01:01.000Z", businessDate: "2026-07-22", amountFen: 1000, providerCode: "TIMEOUT", failureReason: "upstream timeout", settlementReferenceDigest: "d".repeat(64), nonceDigest: "e".repeat(64), signatureVerified: true });
  syncRefundFromFinancialCallback(data, failed, "financial-callback-adapter", { trustedFinancialCallback: true });
  assert.equal(created.row.state, "FAILED");
  assert.throws(() => createRefundRequest(data, { paymentEventId: "igw-payment-retry", paymentTradeNo: "PAY-RETRY", refundAmountFen: 4500, refundReason: "并发超额退款", idempotencyKey: "refund-concurrent" }), /可退余额/);
  retryRefund(data, created.row.id, { resolution: "支付机构链路恢复", idempotencyKey: "refund-retry-action" }, { username: "finance" });
  assert.equal(created.row.state, "APPROVED");
  assert.match(prepareRefundDispatch(data, created.row.id).idempotencyKey, /attempt:2$/);
});

test("successful online refund can enter controlled retry after a trusted provider reversal", () => {
  const data = {
    integrationGatewayEvents: [{ id: "igw-payment-reversal", adapterType: "financial", gatewayType: "PAYMENT", operation: "create-payment", adapterReceipt: { receiptId: "PAY-REVERSAL", status: "succeeded" }, requestPayload: { payload: { orderNo: "ORDER-REVERSAL", amountFen: 3000 } }, providerStatus: "succeeded", reconciliationStatus: "provider-final", businessDate: "2026-07-22", callbackEvents: [] }],
    onlinePaymentRefunds: []
  };
  const created = createRefundRequest(data, { id: "refund-reversal", paymentEventId: "igw-payment-reversal", paymentTradeNo: "PAY-REVERSAL", refundAmountFen: 1000, refundReason: "重复支付", idempotencyKey: "refund-reversal-idem" }, { username: "cashier" });
  reviewRefundRequest(data, created.row.id, { approved: true, reviewDomain: "business-review" }, { username: "business-reviewer" });
  reviewRefundRequest(data, created.row.id, { approved: true, reviewDomain: "finance-review" }, { username: "finance-reviewer" });
  const dispatch = prepareRefundDispatch(data, created.row.id);
  const gatewayEvent = { id: "igw-refund-reversal", adapterType: "financial", gatewayType: "PAYMENT", operation: "refund", adapterReceipt: { receiptId: "REFUND-REVERSAL", status: "accepted" }, requestPayload: { payload: dispatch.payload }, providerStatus: "accepted", reconciliationStatus: "provider-processing", businessDate: "2026-07-22", callbackEvents: [] };
  data.integrationGatewayEvents.push(gatewayEvent);
  recordRefundDispatch(data, created.row.id, { type: "PAYMENT", operation: "refund", receiptId: "REFUND-REVERSAL", status: "accepted", requestId: "REFUND-REVERSAL-REQUEST", acceptedAt: "2026-07-22T10:00:00.000Z" }, gatewayEvent.id);
  const succeeded = applyFinancialCallback(data, { gatewayType: "PAYMENT", eventId: "refund-reversal-success", receiptId: "REFUND-REVERSAL", status: "succeeded", occurredAt: "2026-07-22T10:01:00.000Z", receivedAt: "2026-07-22T10:01:01.000Z", businessDate: "2026-07-22", amountFen: 1000, providerCode: "SUCCESS", failureReason: "", settlementReferenceDigest: "1".repeat(64), nonceDigest: "2".repeat(64), signatureVerified: true });
  syncRefundFromFinancialCallback(data, succeeded, "financial-callback-adapter", { trustedFinancialCallback: true });
  const reversed = applyFinancialCallback(data, { gatewayType: "PAYMENT", eventId: "refund-reversal-provider", receiptId: "REFUND-REVERSAL", status: "reversed", occurredAt: "2026-07-22T10:05:00.000Z", receivedAt: "2026-07-22T10:05:01.000Z", businessDate: "2026-07-22", amountFen: 1000, providerCode: "PROVIDER_REVERSAL", failureReason: "provider reversal", settlementReferenceDigest: "3".repeat(64), nonceDigest: "4".repeat(64), signatureVerified: true });
  const synced = syncRefundFromFinancialCallback(data, reversed, "financial-callback-adapter", { trustedFinancialCallback: true });
  assert.equal(synced.row.state, "FAILED");
  assert.equal(synced.row.reversalPending, true);
  retryRefund(data, synced.row.id, { resolution: "支付机构确认冲正后重新发起", idempotencyKey: "refund-reversal-retry" }, { username: "finance" });
  assert.equal(synced.row.state, "APPROVED");
  assert.equal(synced.row.reversalPending, false);
  assert.equal(verifyRefundLedger(synced.row.events), true);
});
