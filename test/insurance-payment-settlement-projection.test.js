"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const Settlement = require("../disease-payment-settlement");

function batchAt(state, status, id = `projection-${state.toLowerCase()}`) {
  const batch = {
    id,
    type: "月度结算",
    period: "2026-06",
    institution: "测试医院",
    settlementState: state,
    status,
    batchDigest: "a".repeat(64),
    standardAmountFen: 100000,
    submissionDeadline: "2026-07-01",
    policyWorkingDays: 30,
    workingCalendar: { version: "test-calendar", nonWorkingDates: [], workingWeekendDates: [] },
    events: []
  };
  Settlement.appendEvent(batch, { id: `anchor-${id}`, action: "fixture-anchor", from: "NONE", to: state, actor: "fixture", at: "2026-07-01T08:00:00.000Z", idempotencyKey: id, detail: {} });
  return batch;
}

function paidBatches() {
  return [{
    id: "projection-paid-batch",
    type: "月度结算",
    period: "2026-06",
    settlementState: "PAID",
    standardAmountFen: 100000,
    paymentReceipt: { paidAmountFen: 100000 },
    calculationSnapshots: [{ caseId: "case-1", institutionCode: "H001", institution: "测试医院", paymentStandardFen: 100000 }]
  }];
}

test("settlement transition rejects empty ledgers and direct state promotion", () => {
  const empty = batchAt("BATCH_FROZEN", "待申报", "projection-empty");
  empty.events = [];
  assert.throws(() => Settlement.transitionSettlementBatch(empty, {
    action: "submit-core",
    externalRequestId: "CORE-EMPTY",
    idempotencyKey: "CORE-EMPTY"
  }, "insurance"), /状态投影/);

  const promoted = batchAt("BATCH_FROZEN", "待申报", "projection-promoted");
  promoted.settlementState = "RECONCILED";
  promoted.status = "已对账";
  assert.equal(Settlement.verifyEventLedger(promoted.events), true);
  assert.equal(Settlement.verifySettlementBatchProjection(promoted), false);
  assert.throws(() => Settlement.transitionSettlementBatch(promoted, {
    action: "request-payment",
    paymentRequestId: "FORGED-PAYMENT-REQUEST",
    idempotencyKey: "FORGED-PAYMENT-REQUEST"
  }, "insurance"), /状态投影/);
});

test("fabricated difference approvals cannot resolve a monthly settlement", () => {
  const batch = batchAt("RECONCILING", "对账中", "projection-difference");
  Settlement.transitionSettlementBatch(batch, {
    action: "record-difference",
    idempotencyKey: "projection-difference-record",
    at: "2026-07-02T08:00:00.000Z",
    differenceAmountFen: -500,
    reasonCode: "PROVIDER_DEDUCTION",
    evidenceDigest: "b".repeat(64)
  }, "reconciliation-operator");
  const tampered = structuredClone(batch);
  const differenceCase = tampered.reconciliation.differenceCase;
  differenceCase.state = "RESOLUTION_READY";
  differenceCase.reviews = [
    { id: "forged-hospital", reviewDomain: "hospital-finance", approved: true, reviewer: "forged-hospital", reviewedAt: "2026-07-03T08:00:00.000Z", adjustedAmountFen: 99500, resolutionDigest: "c".repeat(64) },
    { id: "forged-insurance", reviewDomain: "insurance-settlement", approved: true, reviewer: "forged-insurance", reviewedAt: "2026-07-03T08:01:00.000Z", adjustedAmountFen: 99500, resolutionDigest: "c".repeat(64) }
  ];
  assert.equal(Settlement.verifyEventLedger(differenceCase.events), true);
  assert.equal(Settlement.verifyDifferenceCaseProjection(differenceCase), false);
  assert.throws(() => Settlement.transitionSettlementBatch(tampered, {
    action: "resolve-difference",
    idempotencyKey: "forged-resolution",
    resolution: "伪造双审",
    resolutionDigest: "c".repeat(64),
    adjustedAmountFen: 99500
  }, "reconciliation-lead"), /差额状态投影/);
});

test("annual clearance dispute approval and posting projections are immutable", () => {
  const row = Settlement.createAnnualClearance(paidBatches(), { id: "annual-projection", year: 2026 }, "insurance");
  Settlement.transitionAnnualClearance(row, { action: "start-confirmation", idempotencyKey: "start" }, "insurance");
  Settlement.transitionAnnualClearance(row, {
    action: "record-dispute",
    idempotencyKey: "dispute",
    disputeId: "DISPUTE-PROJECTION",
    institutionId: "H001",
    reason: "金额口径核对",
    reasonCode: "AMOUNT_SCOPE",
    evidenceDigest: "d".repeat(64),
    amountFen: 100
  }, "hospital-H001");
  Settlement.transitionAnnualClearance(row, {
    action: "resolve-dispute",
    idempotencyKey: "resolve",
    disputeId: "DISPUTE-PROJECTION",
    resolution: "双方确认",
    resolutionDigest: "e".repeat(64),
    resolvedAmountFen: 0
  }, "insurance");
  const tamperedDispute = structuredClone(row);
  tamperedDispute.disputes[0].resolution = "被篡改的解决结论";
  assert.equal(Settlement.verifyEventLedger(tamperedDispute.events), true);
  assert.equal(Settlement.verifyAnnualClearanceProjection(tamperedDispute), false);
  assert.throws(() => Settlement.transitionAnnualClearance(tamperedDispute, {
    action: "confirm-institution",
    idempotencyKey: "confirm-after-tamper",
    institutionId: "H001",
    confirmationDigest: "f".repeat(64)
  }, "hospital-H001"), /状态投影/);

  Settlement.transitionAnnualClearance(row, { action: "confirm-institution", idempotencyKey: "confirm", institutionId: "H001", confirmationDigest: "f".repeat(64) }, "hospital-H001");
  Settlement.transitionAnnualClearance(row, { action: "confirm-institutions", idempotencyKey: "aggregate", confirmationDigest: Settlement.institutionConfirmationDigest(row) }, "insurance");
  Settlement.transitionAnnualClearance(row, { action: "approve", idempotencyKey: "approve", approvalNo: "APPROVAL-001" }, "insurance");
  const tamperedApproval = structuredClone(row);
  tamperedApproval.approval.approvalNo = "FORGED-APPROVAL";
  assert.equal(Settlement.verifyAnnualClearanceProjection(tamperedApproval), false);
  assert.throws(() => Settlement.transitionAnnualClearance(tamperedApproval, {
    action: "post",
    idempotencyKey: "post-after-tamper",
    voucherNo: "VOUCHER-001"
  }, "fund-finance"), /状态投影/);
});
