"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const Service = require("../disease-payment-service");
const Settlement = require("../disease-payment-settlement");

const hash = (character) => character.repeat(64);

function frozenBatch(id = "settlement-core-correction") {
  return {
    id,
    period: "2026-06",
    type: "月度结算",
    institution: "测试医院",
    settlementState: "BATCH_FROZEN",
    status: "待申报",
    batchDigest: hash("a"),
    caseCount: 0,
    declaredAmountFen: 100000,
    standardAmountFen: 90000,
    calculationSnapshots: [],
    submissionDeadline: "2026-07-10",
    policyWorkingDays: 30,
    workingCalendar: { version: "test-calendar", nonWorkingDates: [], workingWeekendDates: [] },
    events: []
  };
}

function submit(batch, suffix = "1", at = "2026-07-11T08:00:00.000Z") {
  return Settlement.transitionSettlementBatch(batch, {
    action: "submit-core",
    externalRequestId: `CORE-REQUEST-${suffix}`,
    idempotencyKey: `CORE-IDEM-${suffix}`,
    at
  }, "insurance-settlement").batch;
}

function returnFromCore(batch, suffix = "1", at = "2026-07-13T08:00:00.000Z") {
  return Settlement.transitionSettlementBatch(batch, {
    action: "core-returned",
    receiptId: `CORE-RETURN-${suffix}`,
    returnCycleId: `core-return-cycle-${suffix}`,
    reasonCode: "FIELD_VALIDATION",
    reason: "医保核心字段校验未通过",
    requirementDigest: hash(suffix),
    correctionWorkingDays: 5,
    at
  }, "insurance-core-adapter", { trustedInsuranceCoreCallback: true }).batch;
}

test("core return correction binds requirements, SLA and accepted resubmission", () => {
  let batch = returnFromCore(submit(frozenBatch()));
  const cycle = batch.coreReturnCycles[0];
  assert.equal(cycle.status, "OPEN");
  assert.equal(Settlement.verifyCoreReturnCycle(cycle), true);
  assert.equal(cycle.dueDate, "2026-07-20");

  const overdue = Settlement.buildSettlementCoreCorrectionOperations([batch], { at: "2026-07-21T08:00:00.000Z" });
  assert.equal(overdue.summary.open, 1);
  assert.equal(overdue.summary.overdue, 1);
  assert.equal(overdue.items[0].sla.overdueWorkingDays, 1);
  assert.equal("reason" in overdue.items[0], false);

  batch = Settlement.transitionSettlementBatch(batch, {
    action: "resubmit-core",
    returnCycleId: cycle.id,
    externalRequestId: "CORE-REQUEST-2",
    idempotencyKey: "CORE-IDEM-2",
    correctionDigest: hash("c"),
    at: "2026-07-17T08:00:00.000Z"
  }, "insurance-settlement").batch;
  assert.equal(batch.coreReturnCycles[0].status, "RESUBMITTED");
  assert.equal(batch.coreReturnCycles[0].sla.status, "completed-within-sla");
  assert.equal(batch.coreSubmission.revision, 2);

  batch = Settlement.transitionSettlementBatch(batch, {
    action: "core-accepted",
    receiptId: "CORE-ACCEPT-2",
    at: "2026-07-17T09:00:00.000Z"
  }, "insurance-core-adapter", { trustedInsuranceCoreCallback: true }).batch;
  assert.equal(batch.settlementState, "CORE_ACCEPTED");
  assert.equal(batch.coreReturnCycles[0].status, "ACCEPTED");
  assert.equal(batch.coreReturnCycles[0].acceptanceReceiptId, "CORE-ACCEPT-2");
  assert.equal(Settlement.verifyEventLedger(batch.events), true);
});

test("a repeated core return preserves both correction cycles", () => {
  let batch = returnFromCore(submit(frozenBatch("settlement-repeat-return")));
  batch = Settlement.transitionSettlementBatch(batch, {
    action: "resubmit-core",
    returnCycleId: "core-return-cycle-1",
    externalRequestId: "CORE-REQUEST-2",
    idempotencyKey: "CORE-IDEM-2",
    correctionDigest: hash("d"),
    at: "2026-07-17T08:00:00.000Z"
  }, "insurance-settlement").batch;
  batch = returnFromCore(batch, "2", "2026-07-18T08:00:00.000Z");

  assert.equal(batch.coreReturnCycles.length, 2);
  assert.equal(batch.coreReturnCycles[0].status, "RETURNED_AGAIN");
  assert.equal(batch.coreReturnCycles[1].status, "OPEN");
  assert.equal(Settlement.verifyCoreReturnCycle(batch.coreReturnCycles[0]), true);
  assert.equal(Settlement.verifyCoreReturnCycle(batch.coreReturnCycles[1]), true);
  const operations = Settlement.buildSettlementCoreCorrectionOperations([batch], { at: "2026-07-18T08:00:00.000Z" });
  assert.equal(operations.summary.returnedAgain, 1);
  assert.equal(operations.summary.open, 1);
});

test("tampered return requirements or batch ledger block correction", () => {
  const batch = returnFromCore(submit(frozenBatch("settlement-tamper")));
  const tamperedCycle = structuredClone(batch);
  tamperedCycle.coreReturnCycles[0].reason = "被篡改的退回原因";
  assert.equal(Settlement.verifyCoreReturnCycle(tamperedCycle.coreReturnCycles[0]), false);
  assert.equal(Settlement.verifyCoreReturnCycleEvidence(tamperedCycle, tamperedCycle.coreReturnCycles[0]), false);
  assert.throws(() => Settlement.transitionSettlementBatch(tamperedCycle, {
    action: "resubmit-core",
    returnCycleId: "core-return-cycle-1",
    externalRequestId: "CORE-REQUEST-2",
    idempotencyKey: "CORE-IDEM-2",
    correctionDigest: hash("e")
  }, "insurance-settlement"), /退回周期摘要或账本证据校验失败/);

  const recomputedCycle = structuredClone(batch);
  recomputedCycle.coreReturnCycles[0].reason = "篡改后重算摘要";
  recomputedCycle.coreReturnCycles[0].returnDigest = Settlement.digest(Settlement.coreReturnDigestPayload(recomputedCycle.coreReturnCycles[0]));
  assert.equal(Settlement.verifyCoreReturnCycle(recomputedCycle.coreReturnCycles[0]), true);
  assert.equal(Settlement.verifyCoreReturnCycleEvidence(recomputedCycle, recomputedCycle.coreReturnCycles[0]), false);
  assert.throws(() => Settlement.transitionSettlementBatch(recomputedCycle, {
    action: "resubmit-core",
    returnCycleId: "core-return-cycle-1",
    externalRequestId: "CORE-REQUEST-2",
    idempotencyKey: "CORE-IDEM-2",
    correctionDigest: hash("e")
  }, "insurance-settlement"), /退回周期摘要或账本证据校验失败/);

  const tamperedLedger = structuredClone(batch);
  tamperedLedger.events[0].actor = "tampered";
  assert.throws(() => Settlement.transitionSettlementBatch(tamperedLedger, {
    action: "resubmit-core",
    returnCycleId: "core-return-cycle-1",
    externalRequestId: "CORE-REQUEST-2",
    idempotencyKey: "CORE-IDEM-2",
    correctionDigest: hash("f")
  }, "insurance-settlement"), /结算批次事件账本校验失败/);
});

test("service keeps settlement state unchanged when correction transition fails", () => {
  const batch = returnFromCore(submit(frozenBatch("settlement-atomic")));
  const state = Service.seedDiseasePaymentState();
  state.settlementBatches = [batch];
  const before = structuredClone(batch);

  assert.throws(() => Service.reconcileBatch(state, batch.id, {
    action: "resubmit-core",
    returnCycleId: "core-return-cycle-1",
    externalRequestId: "CORE-REQUEST-2",
    idempotencyKey: "CORE-IDEM-2",
    correctionDigest: hash("f"),
    at: "invalid-time"
  }, "insurance-settlement"), /日期|时间/);
  assert.deepEqual(state.settlementBatches[0], before);
});
