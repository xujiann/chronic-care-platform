"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const Settlement = require("../disease-payment-settlement");

const hash = (character) => character.repeat(64);

function reconciledBatch(id = "settlement-payment-retry") {
  return {
    id,
    period: "2026-06",
    type: "月度结算",
    institution: "测试医院",
    settlementState: "RECONCILED",
    status: "已对账",
    batchDigest: hash("a"),
    standardAmountFen: 90000,
    adjustedAmountFen: 89000,
    submissionDeadline: "2026-07-10",
    policyWorkingDays: 30,
    workingCalendar: { version: "test-calendar", nonWorkingDates: [], workingWeekendDates: [] },
    events: []
  };
}

function requestPayment(batch, suffix = "1", at = "2026-07-11T08:00:00.000Z") {
  return Settlement.transitionSettlementBatch(batch, {
    action: "request-payment",
    paymentRequestId: `PAYMENT-REQUEST-${suffix}`,
    idempotencyKey: `PAYMENT-REQUEST-IDEM-${suffix}`,
    at
  }, "insurance-settlement").batch;
}

function failPayment(batch, suffix = "1", at = "2026-07-13T08:00:00.000Z") {
  return Settlement.transitionSettlementBatch(batch, {
    action: "payment-failed",
    receiptId: `PAYMENT-FAILED-RECEIPT-${suffix}`,
    failureCycleId: `payment-failure-cycle-${suffix}`,
    reasonCode: "ACCOUNT_VALIDATION",
    reason: "拨付账户校验失败",
    failureEvidenceDigest: hash(suffix),
    resolutionWorkingDays: 2,
    at
  }, "insurance-core-adapter", { trustedInsuranceCoreCallback: true }).batch;
}

function retryPayment(batch, suffix, at) {
  return Settlement.transitionSettlementBatch(batch, {
    action: "retry-payment",
    failureCycleId: `payment-failure-cycle-${suffix - 1}`,
    paymentRequestId: `PAYMENT-REQUEST-${suffix}`,
    idempotencyKey: `PAYMENT-RETRY-IDEM-${suffix}`,
    resolution: "完成账户信息核验后重新申请拨付",
    resolutionDigest: hash("c"),
    at
  }, "insurance-settlement").batch;
}

test("failed settlement payment is retried with SLA and trusted success receipt", () => {
  let batch = failPayment(requestPayment(reconciledBatch()));
  const cycle = batch.paymentFailureCycles[0];
  assert.equal(batch.settlementState, "PAYMENT_FAILED");
  assert.equal(cycle.status, "OPEN");
  assert.equal(cycle.dueDate, "2026-07-15");
  assert.equal(Settlement.verifyPaymentFailureCycleEvidence(batch, cycle), true);

  const overdue = Settlement.buildSettlementPaymentFailureOperations([batch], { at: "2026-07-16T08:00:00.000Z" });
  assert.equal(overdue.summary.overdue, 1);
  assert.equal(overdue.items[0].sla.overdueWorkingDays, 1);
  assert.equal("reason" in overdue.items[0], false);

  batch = retryPayment(batch, 2, "2026-07-14T08:00:00.000Z");
  assert.equal(batch.settlementState, "PAYMENT_REQUESTED");
  assert.equal(batch.paymentRequest.revision, 2);
  assert.equal(batch.paymentFailureCycles[0].status, "RETRIED");
  assert.equal(batch.paymentFailureCycles[0].sla.status, "completed-within-sla");

  batch = Settlement.transitionSettlementBatch(batch, {
    action: "confirm-payment",
    receiptId: "PAYMENT-SUCCESS-RECEIPT-2",
    paidAmountFen: 89000,
    at: "2026-07-14T09:00:00.000Z"
  }, "insurance-core-adapter", { trustedInsuranceCoreCallback: true }).batch;
  assert.equal(batch.settlementState, "PAID");
  assert.equal(batch.paymentFailureCycles[0].status, "SUCCEEDED");
  assert.equal(batch.paymentFailureCycles[0].paymentReceiptId, "PAYMENT-SUCCESS-RECEIPT-2");
  assert.equal(Settlement.verifyEventLedger(batch.events), true);
});

test("repeated payment failures preserve history and stop after three cycles", () => {
  let batch = failPayment(requestPayment(reconciledBatch("settlement-payment-repeat")));
  batch = retryPayment(batch, 2, "2026-07-14T08:00:00.000Z");
  batch = failPayment(batch, "2", "2026-07-15T08:00:00.000Z");
  assert.equal(batch.paymentFailureCycles[0].status, "FAILED_AGAIN");
  assert.equal(batch.paymentFailureCycles[1].status, "OPEN");

  batch = retryPayment(batch, 3, "2026-07-16T08:00:00.000Z");
  batch = failPayment(batch, "3", "2026-07-17T08:00:00.000Z");
  assert.equal(batch.paymentFailureCycles.length, 3);
  assert.throws(() => retryPayment(batch, 4, "2026-07-20T08:00:00.000Z"), /最大重试周期数/);
  const operations = Settlement.buildSettlementPaymentFailureOperations([batch], { at: "2026-07-20T08:00:00.000Z" });
  assert.equal(operations.summary.failedAgain, 2);
  assert.equal(operations.summary.retryExhausted, 1);
});

test("payment failure requires trusted callback and ledger-bound evidence", () => {
  const requested = requestPayment(reconciledBatch("settlement-payment-tamper"));
  assert.throws(() => Settlement.transitionSettlementBatch(requested, {
    action: "payment-failed",
    receiptId: "UNTRUSTED",
    reasonCode: "FAILED",
    reason: "untrusted",
    failureEvidenceDigest: hash("d")
  }, "operator"), /可信回调/);

  const failed = failPayment(requested);
  const recomputed = structuredClone(failed);
  recomputed.paymentFailureCycles[0].reason = "篡改后重算摘要";
  recomputed.paymentFailureCycles[0].failureDigest = Settlement.digest(Settlement.paymentFailureDigestPayload(recomputed.paymentFailureCycles[0]));
  assert.equal(Settlement.verifyPaymentFailureCycle(recomputed.paymentFailureCycles[0]), true);
  assert.equal(Settlement.verifyPaymentFailureCycleEvidence(recomputed, recomputed.paymentFailureCycles[0]), false);
  assert.throws(() => retryPayment(recomputed, 2, "2026-07-14T08:00:00.000Z"), /摘要或账本证据校验失败/);
});

test("tampered retry evidence blocks the payment success callback", () => {
  let batch = failPayment(requestPayment(reconciledBatch("settlement-payment-retry-tamper")));
  batch = retryPayment(batch, 2, "2026-07-14T08:00:00.000Z");
  batch.paymentFailureCycles[0].retry.resolutionDigest = hash("d");

  assert.equal(Settlement.verifyPaymentFailureCycleEvidence(batch, batch.paymentFailureCycles[0]), false);
  assert.throws(() => Settlement.transitionSettlementBatch(batch, {
    action: "confirm-payment",
    receiptId: "PAYMENT-SUCCESS-RECEIPT-2",
    paidAmountFen: 89000,
    at: "2026-07-14T09:00:00.000Z"
  }, "insurance-core-adapter", { trustedInsuranceCoreCallback: true }), /摘要或账本证据校验失败/);
});
