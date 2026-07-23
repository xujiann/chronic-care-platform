"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const Refunds = require("../online-payment-refunds");

function payment(id = "payment-refund-correction", amountFen = 5000) {
  return {
    id,
    adapterType: "financial",
    gatewayType: "PAYMENT",
    operation: "create-payment",
    externalId: `ORDER-${id}`,
    adapterReceipt: { receiptId: `TRADE-${id}`, status: "succeeded" },
    requestPayload: { payload: { orderNo: `ORDER-${id}`, amountFen } },
    providerStatus: "succeeded",
    reconciliationStatus: "provider-final"
  };
}

function createData(amountFen = 5000) {
  return { integrationGatewayEvents: [payment("payment-refund-correction", amountFen)], onlinePaymentRefunds: [], financialReconciliationRuns: [] };
}

function requestRefund(data, overrides = {}) {
  return Refunds.createRefundRequest(data, {
    id: overrides.id || "refund-correction",
    paymentEventId: "payment-refund-correction",
    paymentTradeNo: "TRADE-payment-refund-correction",
    orderReference: "ORDER-payment-refund-correction",
    refundAmountFen: overrides.refundAmountFen || 3000,
    refundReason: overrides.refundReason || "原服务取消",
    reasonCode: overrides.reasonCode || "SERVICE_CANCELLED",
    idempotencyKey: overrides.idempotencyKey || "refund-correction-request"
  }, { username: overrides.requestedBy || "cashier-a" }).row;
}

function rejectRefund(data, row, reviewer = "business-reviewer-a") {
  return Refunds.reviewRefundRequest(data, row.id, {
    approved: false,
    reviewDomain: "business-review",
    role: "业务复核",
    opinion: "材料不足"
  }, { username: reviewer }).row;
}

test("rejected refund can be resubmitted with linked decision and fresh digest evidence", () => {
  const data = createData();
  const row = rejectRefund(data, requestRefund(data));
  const firstDecisionDigest = row.rejectionDecisionDigest;
  assert.match(firstDecisionDigest, /^[a-f0-9]{64}$/);

  const input = {
    originalDecisionDigest: `sha256:${firstDecisionDigest}`,
    evidenceDigest: "a".repeat(64),
    correctionReason: "补齐退费申请单及患者确认凭据",
    refundReason: "取消服务并完成患者确认",
    reasonCode: "PATIENT_CONFIRMED",
    idempotencyKey: "refund-correction-resubmit-1"
  };
  const resubmitted = Refunds.resubmitRejectedRefund(data, row.id, input, { username: "cashier-a" });
  assert.equal(resubmitted.idempotent, false);
  assert.equal(row.state, "REQUESTED");
  assert.equal(row.reviewRevision, 2);
  assert.equal(row.reviews.length, 0);
  assert.equal(row.reviewHistory.length, 1);
  assert.equal(row.reviewHistory[0].rejectionDecisionDigest, firstDecisionDigest);
  assert.equal(row.reviewHistory[0].reviews.length, 1);
  assert.equal(row.resubmissions[0].evidenceDigest, "a".repeat(64));
  assert.equal(Refunds.buildRefundSla(row, row.requestedAt).phase, "review");
  assert.equal(Refunds.verifyRefundLedger(row.events), true);

  const replay = Refunds.resubmitRejectedRefund(data, row.id, input, { username: "cashier-a" });
  assert.equal(replay.idempotent, true);
  assert.equal(row.resubmissions.length, 1);
  Refunds.reviewRefundRequest(data, row.id, { approved: true, reviewDomain: "business-review" }, { username: "business-reviewer-b" });
  Refunds.reviewRefundRequest(data, row.id, { approved: true, reviewDomain: "finance-review" }, { username: "finance-reviewer-b" });
  assert.equal(row.state, "APPROVED");
  assert.equal(Refunds.buildRefundOperations(data).refunds[0].resubmissionCount, 1);
});

test("refund resubmission rejects stale decisions reused evidence and idempotency conflicts", () => {
  const data = createData();
  const row = rejectRefund(data, requestRefund(data));
  assert.throws(() => Refunds.resubmitRejectedRefund(data, row.id, {
    originalDecisionDigest: "0".repeat(64),
    evidenceDigest: "a".repeat(64),
    correctionReason: "补齐材料",
    idempotencyKey: "resubmit-wrong-decision"
  }, { username: "cashier-a" }), (error) => error.code === "REFUND_RESUBMISSION_DECISION_DIGEST_MISMATCH");

  const firstInput = {
    originalDecisionDigest: row.rejectionDecisionDigest,
    evidenceDigest: "a".repeat(64),
    correctionReason: "补齐材料",
    idempotencyKey: "resubmit-first"
  };
  Refunds.resubmitRejectedRefund(data, row.id, firstInput, { username: "cashier-a" });
  assert.throws(() => Refunds.resubmitRejectedRefund(data, row.id, { ...firstInput, correctionReason: "冲突内容" }, { username: "cashier-a" }), (error) => error.code === "REFUND_RESUBMISSION_IDEMPOTENCY_CONFLICT");

  rejectRefund(data, row, "business-reviewer-b");
  assert.throws(() => Refunds.resubmitRejectedRefund(data, row.id, {
    originalDecisionDigest: row.rejectionDecisionDigest,
    evidenceDigest: "a".repeat(64),
    correctionReason: "再次补齐材料",
    idempotencyKey: "resubmit-reused-evidence"
  }, { username: "cashier-a" }), (error) => error.code === "REFUND_RESUBMISSION_NEW_EVIDENCE_REQUIRED");
});

test("refund resubmission rechecks the currently available payment balance", () => {
  const data = createData(5000);
  const rejected = rejectRefund(data, requestRefund(data, { refundAmountFen: 3000 }));
  requestRefund(data, { id: "refund-concurrent-reservation", refundAmountFen: 3000, idempotencyKey: "refund-concurrent-reservation" });
  const before = structuredClone(rejected);
  assert.throws(() => Refunds.resubmitRejectedRefund(data, rejected.id, {
    originalDecisionDigest: rejected.rejectionDecisionDigest,
    evidenceDigest: "b".repeat(64),
    correctionReason: "补齐材料",
    idempotencyKey: "resubmit-no-balance"
  }, { username: "cashier-a" }), (error) => error.code === "REFUND_RESUBMISSION_AMOUNT_EXCEEDS_AVAILABLE");
  assert.deepEqual(rejected, before);
});

test("tampered refund ledger blocks every existing refund transition before mutation", () => {
  const data = createData();
  const row = requestRefund(data);
  row.events[0].detail.reasonCode = "TAMPERED";
  const before = structuredClone(row);
  for (const action of [
    () => Refunds.reviewRefundRequest(data, row.id, { approved: true, reviewDomain: "business-review" }, { username: "reviewer" }),
    () => Refunds.cancelRefund(data, row.id, { reason: "取消" }, { username: "cashier-a" })
  ]) {
    assert.throws(action, (error) => error.code === "REFUND_LEDGER_INVALID");
    assert.deepEqual(row, before);
  }

  for (const [state, action] of [
    ["APPROVED", () => Refunds.prepareRefundDispatch(data, row.id)],
    ["FAILED", () => Refunds.retryRefund(data, row.id, { resolution: "恢复" }, { username: "finance" })],
    ["SUCCEEDED", () => Refunds.reconcileRefund(data, row.id, { reconciliationRunId: "run" }, { username: "finance" })],
    ["RECONCILED", () => Refunds.closeRefund(data, row.id, { voucherNo: "voucher" }, { username: "finance" })],
    ["REJECTED", () => Refunds.resubmitRejectedRefund(data, row.id, { originalDecisionDigest: "c".repeat(64), evidenceDigest: "d".repeat(64), correctionReason: "补证", idempotencyKey: "resubmit-tampered" }, { username: "cashier-a" })]
  ]) {
    row.state = state;
    assert.throws(action, (error) => error.code === "REFUND_LEDGER_INVALID");
  }

  row.state = "DISPATCHED";
  row.gatewayEventId = "gateway-refund-tampered";
  row.refundReceiptId = "receipt-refund-tampered";
  data.integrationGatewayEvents.push({ id: row.gatewayEventId, gatewayType: "PAYMENT", operation: "refund" });
  assert.throws(() => Refunds.syncRefundFromFinancialCallback(data, {
    gatewayEvent: data.integrationGatewayEvents.at(-1),
    callbackEvent: { receiptId: row.refundReceiptId, eventId: "callback-tampered", signatureVerified: true, stateApplied: true, status: "succeeded" }
  }, "financial-callback-adapter", { trustedFinancialCallback: true }), (error) => error.code === "REFUND_LEDGER_INVALID");

  const missingLedgerData = createData();
  const missingLedgerRow = requestRefund(missingLedgerData);
  missingLedgerRow.events = [];
  assert.throws(() => Refunds.reviewRefundRequest(missingLedgerData, missingLedgerRow.id, {
    approved: true,
    reviewDomain: "business-review"
  }, { username: "reviewer" }), (error) => error.code === "REFUND_LEDGER_INVALID");
});
