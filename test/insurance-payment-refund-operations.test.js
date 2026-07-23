"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const Refunds = require("../online-payment-refunds");

function refund(overrides = {}) {
  return {
    id: "refund-default",
    orderReference: "ORDER-001",
    refundAmountFen: 1000,
    reasonCode: "SERVICE_CANCELLED",
    state: "REQUESTED",
    status: "待复核",
    requestedAt: "2026-07-23T10:30:00.000Z",
    reviews: [],
    attempts: [],
    events: [],
    ...overrides
  };
}

test("refund operations ranks callback timeout reversal and ledger exceptions without sensitive fields", () => {
  const data = {
    onlinePaymentRefunds: [
      refund({ id: "refund-within-review" }),
      refund({ id: "refund-callback-overdue", state: "PROCESSING", attempts: [{ dispatchedAt: "2026-07-23T10:00:00.000Z" }] }),
      refund({ id: "refund-reversal", state: "FAILED", failedAt: "2026-07-23T10:50:00.000Z", reversalPending: true, attempts: [{}, {}, {}], failureReason: "provider reversal", paymentTradeNo: "SECRET-TRADE-NO" }),
      refund({ id: "refund-reconcile-overdue", state: "SUCCEEDED", succeededAt: "2026-07-21T10:00:00.000Z" }),
      refund({ id: "refund-ledger-invalid", events: [{ sequence: 1, previousHash: "GENESIS", eventHash: "tampered" }] })
    ]
  };
  const operations = Refunds.buildRefundOperations(data, { at: "2026-07-23T11:00:00.000Z" });
  assert.equal(operations.summary.total, 5);
  assert.equal(operations.summary.exceptions, 4);
  assert.equal(operations.summary.overdue, 2);
  assert.equal(operations.summary.critical, 3);
  assert.equal(operations.exceptionQueue[0].priority, "critical");
  assert.ok(operations.exceptionQueue.find((item) => item.id === "refund-callback-overdue").issueCodes.includes("provider-callback-overdue"));
  assert.ok(operations.exceptionQueue.find((item) => item.id === "refund-reversal").issueCodes.includes("retry-exhausted"));
  assert.equal(operations.refunds.find((item) => item.id === "refund-within-review").sla.status, "within-sla");
  assert.doesNotMatch(JSON.stringify(operations), /SECRET-TRADE-NO|paymentTradeNo|failureReason|refundReason/);
});

test("refund SLA exposes deterministic phase deadlines and rejects invalid policy", () => {
  const callback = Refunds.buildRefundSla(refund({ state: "DISPATCHED", attempts: [{ dispatchedAt: "2026-07-23T10:00:00.000Z" }] }), "2026-07-23T10:20:00.000Z");
  assert.equal(callback.phase, "provider-callback");
  assert.equal(callback.status, "within-sla");
  assert.equal(callback.dueAt, "2026-07-23T10:30:00.000Z");
  assert.equal(callback.remainingMinutes, 10);
  const overdue = Refunds.buildRefundSla(refund({ state: "SUCCEEDED", succeededAt: "2026-07-21T10:00:00.000Z" }), "2026-07-23T11:00:00.000Z");
  assert.equal(overdue.phase, "daily-reconciliation");
  assert.equal(overdue.status, "overdue");
  assert.equal(overdue.overdueMinutes, 780);
  assert.throws(() => Refunds.buildRefundSla(refund(), "2026-07-23T11:00:00.000Z", { callbackMinutes: 0 }), (error) => error.code === "REFUND_SLA_POLICY_INVALID");
  assert.throws(() => Refunds.buildRefundSla(refund(), "invalid-time"), (error) => error.code === "REFUND_SLA_EVALUATION_TIME_INVALID");
});

test("refund dual review records the approval milestone used by dispatch SLA", () => {
  const data = {
    integrationGatewayEvents: [{
      id: "payment-for-sla",
      adapterType: "financial",
      gatewayType: "PAYMENT",
      operation: "create-payment",
      adapterReceipt: { receiptId: "PAYMENT-SLA", status: "succeeded" },
      requestPayload: { payload: { amountFen: 5000 } },
      providerStatus: "succeeded",
      reconciliationStatus: "provider-final"
    }],
    onlinePaymentRefunds: []
  };
  const created = Refunds.createRefundRequest(data, { id: "refund-sla-milestone", paymentEventId: "payment-for-sla", paymentTradeNo: "PAYMENT-SLA", refundAmountFen: 1000, refundReason: "取消服务", idempotencyKey: "refund-sla-idem" }, { username: "cashier" });
  Refunds.reviewRefundRequest(data, created.row.id, { approved: true, reviewDomain: "business-review" }, { username: "business-reviewer" });
  Refunds.reviewRefundRequest(data, created.row.id, { approved: true, reviewDomain: "finance-review" }, { username: "finance-reviewer" });
  assert.equal(created.row.state, "APPROVED");
  assert.match(created.row.approvedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(Refunds.buildRefundSla(created.row, created.row.approvedAt).phase, "dispatch");
});
