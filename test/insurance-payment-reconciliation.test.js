"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const Settlement = require("../disease-payment-settlement");

function reconcilingBatch() {
  const batch = {
    id: "settlement-difference-test",
    settlementState: "RECONCILING",
    status: "对账中",
    standardAmountFen: 100000,
    submissionDeadline: "2026-07-01",
    policyWorkingDays: 30,
    workingCalendar: { version: "test-calendar", nonWorkingDates: [], workingWeekendDates: [] },
    reconciliation: { providerSummaryDigest: "a".repeat(64) },
    events: []
  };
  Settlement.appendEvent(batch, { id: "fixture-reconciling", action: "start-reconciliation", from: "NONE", to: "RECONCILING", actor: "fixture", at: "2026-07-01T07:00:00.000Z", idempotencyKey: "fixture-reconciling", detail: { providerSummaryDigest: batch.reconciliation.providerSummaryDigest } });
  return batch;
}

test("monthly settlement difference requires matching hospital and insurance approvals", () => {
  const batch = reconcilingBatch();
  Settlement.transitionSettlementBatch(batch, { action: "record-difference", idempotencyKey: "record-1", at: "2026-07-06T08:00:00.000Z", differenceAmountFen: -500, reasonCode: "PROVIDER_DEDUCTION", evidenceDigest: "b".repeat(64), reviewWorkingDays: 5 }, "reconciliation-operator");
  const differenceCase = batch.reconciliation.differenceCase;
  assert.equal(differenceCase.state, "OPEN");
  assert.equal(differenceCase.sla.dueDate, "2026-07-13");
  assert.equal(Settlement.verifyEventLedger(differenceCase.events), true);
  const tamperedBatch = structuredClone(batch);
  tamperedBatch.reconciliation.differenceCase.events[0].actor = "tampered";
  assert.throws(() => Settlement.transitionSettlementBatch(tamperedBatch, { action: "review-difference", idempotencyKey: "tampered-review", reviewDomain: "hospital-finance", approved: true, adjustedAmountFen: 99500, resolutionDigest: "c".repeat(64) }, "hospital-reviewer"), /账本校验失败/);
  assert.throws(() => Settlement.transitionSettlementBatch(batch, { action: "resolve-difference", idempotencyKey: "resolve-too-early", resolution: "premature", resolutionDigest: "c".repeat(64), adjustedAmountFen: 99500 }, "operator"), /双域复核/);

  const first = Settlement.transitionSettlementBatch(batch, { action: "review-difference", idempotencyKey: "hospital-review-1", at: "2026-07-07T08:00:00.000Z", reviewDomain: "hospital-finance", approved: true, adjustedAmountFen: 99500, resolutionDigest: "c".repeat(64) }, "hospital-reviewer");
  assert.equal(first.batch.reconciliation.differenceCase.state, "UNDER_REVIEW");
  assert.equal(Settlement.transitionSettlementBatch(batch, { action: "review-difference", idempotencyKey: "hospital-review-1", reviewDomain: "hospital-finance", approved: true, adjustedAmountFen: 99500, resolutionDigest: "c".repeat(64) }, "hospital-reviewer").idempotent, true);
  assert.throws(() => Settlement.transitionSettlementBatch(batch, { action: "review-difference", idempotencyKey: "insurance-mismatch", reviewDomain: "insurance-settlement", approved: true, adjustedAmountFen: 99400, resolutionDigest: "c".repeat(64) }, "insurance-reviewer"), /必须一致/);

  Settlement.transitionSettlementBatch(batch, { action: "review-difference", idempotencyKey: "insurance-review-1", at: "2026-07-08T08:00:00.000Z", reviewDomain: "insurance-settlement", approved: true, adjustedAmountFen: 99500, resolutionDigest: "c".repeat(64) }, "insurance-reviewer");
  assert.equal(differenceCase.state, "RESOLUTION_READY");
  Settlement.transitionSettlementBatch(batch, { action: "resolve-difference", idempotencyKey: "resolve-1", at: "2026-07-09T08:00:00.000Z", resolution: "双方确认服务商核减5元", resolutionDigest: "c".repeat(64), adjustedAmountFen: 99500 }, "reconciliation-lead");
  assert.equal(batch.settlementState, "RECONCILED");
  assert.equal(batch.adjustedAmountFen, 99500);
  assert.equal(batch.reconciliation.differenceAmountFen, 0);
  assert.equal(differenceCase.state, "RESOLVED");
  assert.equal(differenceCase.sla.status, "completed-within-sla");
  assert.equal(Settlement.verifyEventLedger(differenceCase.events), true);
});

test("rejected settlement difference requires new digest evidence and resets dual review", () => {
  const batch = reconcilingBatch();
  Settlement.transitionSettlementBatch(batch, { action: "record-difference", idempotencyKey: "record-2", at: "2026-07-01T08:00:00.000Z", differenceAmountFen: 200, reasonCode: "MISSING_LINE", evidenceDigest: "d".repeat(64), reviewWorkingDays: 2 }, "reconciliation-operator");
  Settlement.transitionSettlementBatch(batch, { action: "review-difference", idempotencyKey: "reject-1", at: "2026-07-02T08:00:00.000Z", reviewDomain: "hospital-finance", approved: false, reasonCode: "EVIDENCE_INCOMPLETE", opinion: "缺少费用明细摘要" }, "hospital-reviewer");
  const differenceCase = batch.reconciliation.differenceCase;
  assert.equal(differenceCase.state, "REJECTED");
  assert.throws(() => Settlement.transitionSettlementBatch(batch, { action: "review-difference", idempotencyKey: "review-after-reject", reviewDomain: "insurance-settlement", approved: true, adjustedAmountFen: 100200, resolutionDigest: "e".repeat(64) }, "insurance-reviewer"), /不允许复核/);

  Settlement.transitionSettlementBatch(batch, { action: "submit-difference-evidence", idempotencyKey: "evidence-v2", at: "2026-07-03T08:00:00.000Z", evidenceDigest: "f".repeat(64), correctionReason: "补充费用明细摘要" }, "reconciliation-operator");
  assert.equal(differenceCase.state, "OPEN");
  assert.equal(differenceCase.evidence.revision, 2);
  assert.equal(differenceCase.reviews.length, 0);
  assert.equal(differenceCase.sla.dueDate, "2026-07-07");
  assert.equal(Settlement.verifyEventLedger(differenceCase.events), true);

  const tampered = structuredClone(differenceCase.events);
  tampered[0].detail.differenceAmountFen = 999;
  assert.equal(Settlement.verifyEventLedger(tampered), false);
});

test("settlement difference SLA reports overdue open cases", () => {
  const batch = reconcilingBatch();
  Settlement.transitionSettlementBatch(batch, { action: "record-difference", idempotencyKey: "record-3", at: "2026-07-01T08:00:00.000Z", differenceAmountFen: -100, reasonCode: "ROUNDING", evidenceDigest: "1".repeat(64), reviewWorkingDays: 2 }, "reconciliation-operator");
  const sla = Settlement.buildDifferenceCaseSla(batch.reconciliation.differenceCase, batch.workingCalendar, "2026-07-08T08:00:00.000Z");
  assert.equal(sla.status, "overdue");
  assert.equal(sla.overdueWorkingDays, 3);
});
