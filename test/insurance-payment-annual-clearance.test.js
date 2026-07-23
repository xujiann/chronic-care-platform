"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const Settlement = require("../disease-payment-settlement");

function paidBatches() {
  return [
    {
      id: "settlement-2026-01",
      type: "月度结算",
      period: "2026-01",
      settlementState: "PAID",
      standardAmountFen: 30000,
      paymentReceipt: { paidAmountFen: 30000 },
      calculationSnapshots: [
        { caseId: "case-a", institutionCode: "H001", institution: "第一医院", paymentStandardFen: 10000 },
        { caseId: "case-b", institutionCode: "H002", institution: "第二医院", paymentStandardFen: 20000 }
      ]
    },
    {
      id: "settlement-2026-02",
      type: "月度结算",
      period: "2026-02",
      settlementState: "CLOSED",
      standardAmountFen: 15000,
      paymentReceipt: { paidAmountFen: 15000 },
      calculationSnapshots: [
        { caseId: "case-c", institutionCode: "H001", institution: "第一医院", paymentStandardFen: 15000 }
      ]
    }
  ];
}

test("annual clearance freezes per-institution targets and requires every confirmation", () => {
  const row = Settlement.createAnnualClearance(paidBatches(), { id: "annual-institution-test", year: 2026 }, "insurance");
  assert.equal(row.institutionCount, 2);
  assert.equal(row.contractVersion, Settlement.ANNUAL_CLEARANCE_CONTRACT_VERSION);
  assert.deepEqual(row.institutionConfirmations.map((item) => item.institutionId), ["H001", "H002"]);
  assert.equal(row.institutionConfirmations.find((item) => item.institutionId === "H001").standardAmountFen, 25000);
  assert.equal(Settlement.buildAnnualClearanceEnvelope(row).institutions.length, 2);

  Settlement.transitionAnnualClearance(row, { action: "start-confirmation", idempotencyKey: "start" }, "insurance");
  Settlement.transitionAnnualClearance(row, { action: "confirm-institution", idempotencyKey: "confirm-h001", institutionId: "H001", confirmationDigest: "a".repeat(64) }, "hospital-h001");
  assert.throws(() => Settlement.transitionAnnualClearance(row, { action: "confirm-institutions", idempotencyKey: "aggregate-early", confirmationDigest: "b".repeat(64) }, "insurance"), /仍有医院未完成/);
  Settlement.transitionAnnualClearance(row, { action: "confirm-institution", idempotencyKey: "confirm-h002", institutionId: "H002", confirmationDigest: "b".repeat(64) }, "hospital-h002");
  const aggregateDigest = Settlement.institutionConfirmationDigest(row);
  assert.throws(() => Settlement.transitionAnnualClearance(row, { action: "confirm-institutions", idempotencyKey: "aggregate-wrong", confirmationDigest: "c".repeat(64) }, "insurance"), /逐机构确认不一致/);
  Settlement.transitionAnnualClearance(row, { action: "confirm-institutions", idempotencyKey: "aggregate", confirmationDigest: aggregateDigest }, "insurance");
  assert.equal(row.state, "INSTITUTION_CONFIRMED");
  assert.equal(row.institutionConfirmation.institutionCount, 2);
  assert.equal(Settlement.verifyEventLedger(row.events), true);
});

test("annual clearance dispute is institution-bound and requires reconfirmation after resolution", () => {
  const row = Settlement.createAnnualClearance(paidBatches(), { id: "annual-dispute-test", year: 2026, adjustmentFundFen: 100, adjustmentReason: "年度调节" }, "insurance");
  Settlement.transitionAnnualClearance(row, { action: "start-confirmation", idempotencyKey: "start" }, "insurance");
  Settlement.transitionAnnualClearance(row, { action: "record-dispute", idempotencyKey: "dispute-h001", disputeId: "DISPUTE-H001", institutionId: "H001", reasonCode: "AMOUNT_SCOPE", reason: "金额口径待核对", amountFen: 100, evidenceDigest: "d".repeat(64) }, "hospital-h001");
  assert.equal(row.institutionConfirmations.find((item) => item.institutionId === "H001").state, "DISPUTED");
  assert.throws(() => Settlement.transitionAnnualClearance(row, { action: "resolve-dispute", idempotencyKey: "resolve-wrong", disputeId: "UNKNOWN", resolution: "invalid", resolutionDigest: "e".repeat(64), resolvedAmountFen: 0 }, "insurance"), /没有待处理/);
  Settlement.transitionAnnualClearance(row, { action: "resolve-dispute", idempotencyKey: "resolve-h001", disputeId: "DISPUTE-H001", resolution: "按双方核对结果确认", resolutionDigest: "e".repeat(64), resolvedAmountFen: 0 }, "insurance");
  assert.equal(row.institutionConfirmations.find((item) => item.institutionId === "H001").state, "PENDING");
  assert.equal(row.disputes[0].status, "resolved");

  for (const target of row.institutionConfirmations) {
    Settlement.transitionAnnualClearance(row, { action: "confirm-institution", idempotencyKey: `confirm-${target.institutionId}`, institutionId: target.institutionId, confirmationDigest: target.institutionId === "H001" ? "f".repeat(64) : "1".repeat(64) }, `hospital-${target.institutionId}`);
  }
  Settlement.transitionAnnualClearance(row, { action: "confirm-institutions", idempotencyKey: "aggregate", confirmationDigest: Settlement.institutionConfirmationDigest(row) }, "insurance");
  Settlement.transitionAnnualClearance(row, { action: "approve", idempotencyKey: "approve", approvalNo: "ANNUAL-APPROVAL", adjustmentApprovalDigest: "2".repeat(64) }, "insurance");
  Settlement.transitionAnnualClearance(row, { action: "post", idempotencyKey: "post", voucherNo: "ANNUAL-VOUCHER" }, "fund-finance");
  Settlement.transitionAnnualClearance(row, { action: "lock", idempotencyKey: "lock", lockReference: "ANNUAL-LOCK" }, "fund-finance");
  assert.equal(row.state, "LOCKED");
  assert.equal(Settlement.verifyEventLedger(row.events), true);
});

test("annual clearance digest detects institution target tampering", () => {
  const row = Settlement.createAnnualClearance(paidBatches(), { id: "annual-tamper-test", year: 2026 }, "insurance");
  row.institutionConfirmations[0].standardAmountFen += 1;
  assert.throws(() => Settlement.buildAnnualClearanceEnvelope(row), /摘要校验失败/);
});

test("annual clearance rejects fabricated confirmations and still verifies legacy v1 envelopes", () => {
  const row = Settlement.createAnnualClearance(paidBatches(), { id: "annual-fabricated-confirmation", year: 2026 }, "insurance");
  Settlement.transitionAnnualClearance(row, { action: "start-confirmation", idempotencyKey: "start" }, "insurance");
  for (const target of row.institutionConfirmations) {
    target.state = "CONFIRMED";
    target.confirmation = { digest: "3".repeat(64), confirmedAt: new Date().toISOString(), confirmedBy: "fabricated" };
  }
  assert.throws(() => Settlement.institutionConfirmationDigest(row), /缺少匹配的账本事件/);

  const legacy = {
    id: "annual-legacy-v1",
    year: 2025,
    batchIds: ["legacy-batch"],
    standardAmountFen: 1000,
    paidAmountFen: 1000,
    adjustmentFundFen: 0,
    retainedBalanceFen: 0,
    riskReserveFen: 0,
    finalClearanceAmountFen: 1000,
    adjustmentReason: ""
  };
  legacy.clearanceDigest = Settlement.digest(Settlement.annualClearanceDigestPayload(legacy));
  assert.equal(Settlement.buildAnnualClearanceEnvelope(legacy).contractVersion, "1.0.0");
});
