const assert = require("node:assert/strict");
const test = require("node:test");

const {
  dispatchFinancialRequest,
  financialGatewayCenter,
  signFinancialRequest,
  stableStringify,
  validateFinancialRequest
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
    INSURANCE_GATEWAY_URL: "https://insurance.example.gov.cn",
    INSURANCE_GATEWAY_SECRET: "insurance-secret",
    CERTIFICATE_GATEWAY_URL: "https://certificate.example.gov.cn",
    CERTIFICATE_GATEWAY_SECRET: "certificate-secret"
  });
  assert.equal(center.adapterReady, true);
  assert.equal(center.productionReady, false);
  assert.equal(center.summary.total, 3);
  assert.equal(center.summary.operations, 14);
  const serialized = JSON.stringify(center);
  assert.equal(serialized.includes("payment.example.gov.cn"), false);
  assert.equal(serialized.includes("payment-secret"), false);
});
