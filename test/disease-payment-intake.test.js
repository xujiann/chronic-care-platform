"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const Intake = require("../disease-payment-intake");
const Service = require("../disease-payment-service");

function validRow(suffix = "001") {
  return { settlementListNo: `DL-TEST-${suffix}`, institutionCode: "HOSP-001", institution: "测试医院", residentId: "r1", admissionDate: "2026-07-01", dischargeDate: "2026-07-05", principalDiagnosis: "I10", principalDiagnosisName: "原发性高血压", totalAmount: 1200, declaredFundAmount: 900, costItems: [{ itemCode: "P001", itemName: "诊疗项目", amount: 1000, catalogVersion: "2026" }, { itemCode: "M001", itemName: "药品", category: "药品", amount: 200, catalogVersion: "2026" }] };
}

test("settlement list quality control reports all seven categories", () => {
  const { normalized, costItems } = Intake.normalizeSettlementList(validRow());
  const quality = Intake.validateSettlementList(normalized, costItems);
  assert.equal(quality.ok, true);
  assert.deepEqual(Object.keys(quality.categories), Intake.QUALITY_CATEGORIES);
  assert.equal(quality.detailTotal, 1200);
});

test("batch import links cost details and is idempotent", () => {
  const state = Service.seedDiseasePaymentState();
  const first = Intake.importBatch(state, { sourceSystem: "HIS", rows: [validRow()] }, "tester");
  assert.equal(first.report.accepted, 1);
  assert.equal(first.state.settlementLists.length, 1);
  assert.equal(first.state.medicalCostItems.length, 2);
  assert.ok(first.state.medicalCostItems.every((item) => item.settlementListNo === "DL-TEST-001"));
  const duplicate = Intake.importBatch(first.state, { sourceSystem: "HIS", rows: [validRow()] }, "tester");
  assert.equal(duplicate.report.duplicates, 1);
  assert.equal(duplicate.state.settlementLists.length, 1);
});

test("invalid rows enter correction queue and can be retried", () => {
  const state = Service.seedDiseasePaymentState();
  const row = { ...validRow("BAD"), institutionCode: "", totalAmount: 1000 };
  const imported = Intake.importBatch(state, { rows: [row] }, "tester");
  assert.equal(imported.report.rejected, 1);
  assert.equal(imported.state.importRetryQueue.length, 1);
  const retry = Intake.retryImport(imported.state, imported.state.importRetryQueue[0].id, { institutionCode: "HOSP-001", totalAmount: 1200 }, "tester");
  assert.equal(retry.retry.status, "resolved");
  assert.equal(retry.state.settlementLists.length, 1);
});

test("formal grouping requires signed official receipt and stays isolated from simulation", () => {
  let state = Service.seedDiseasePaymentState();
  const simulation = Intake.runGrouping(state, { environment: "simulation", mode: "DRG", caseIds: ["dp-case-001"] }, "tester", Service.calculateCase);
  assert.equal(simulation.run.succeeded, 1);
  assert.equal(simulation.run.environment, "simulation");
  assert.equal(simulation.state.cases[0].formalGrouping, undefined);
  const blocked = Intake.runGrouping(simulation.state, { environment: "formal", mode: "DRG", caseIds: ["dp-case-001"] }, "tester", Service.calculateCase);
  assert.equal(blocked.run.failed, 1);
  assert.match(blocked.run.results[0].error, /正式分组回执验证失败/);
  const official = { caseId: "dp-case-001", receiptId: "OFF-001", groupCode: "BR23", groupName: "脑血管疾病", schemeVersion: "DRG-2.0-DL", inputDigest: Intake.officialCaseDigest(blocked.state.cases[0], "DRG"), signedAt: "2026-07-18T08:00:00.000Z", signatureValid: true, verification: { verifiedBy: "official-adapter-v1", algorithm: "SM2/SM3", keyId: "nhsa-joint-test-key-01", verifiedAt: "2026-07-18T08:00:01.000Z" } };
  const formal = Intake.runGrouping(blocked.state, { environment: "formal", mode: "DRG", caseIds: ["dp-case-001"], officialResults: [official] }, "tester", Service.calculateCase);
  assert.equal(formal.run.succeeded, 1);
  assert.equal(formal.state.cases[0].formalGrouping.authority, "official");
  assert.equal(formal.state.cases[0].formalGrouping.inputDigest, official.inputDigest);
  assert.equal(formal.state.cases[0].formalGrouping.verification.contract, "detached-signature-attestation-v1");
  assert.equal(formal.state.cases[0].simulationCalculation.grouping.groupCode, "BR23");
  const replay = Intake.runGrouping(formal.state, { environment: "formal", mode: "DRG", caseIds: ["dp-case-001"], officialResults: [official] }, "tester", Service.calculateCase);
  assert.equal(replay.run.failed, 1);
  assert.match(replay.run.results[0].receiptErrors.join("；"), /已被病例dp-case-001使用/);
});

test("grouping and calculation ledgers form verifiable immutable hash chains", () => {
  const result = Intake.runGrouping(Service.seedDiseasePaymentState(), { environment: "simulation", mode: "DRG", caseIds: ["dp-case-001", "dp-case-002"] }, "tester", Service.calculateCase);
  assert.equal(Intake.verifyLedger(result.state.groupingRuns), true);
  assert.equal(Intake.verifyLedger(result.state.paymentCalculationLedger), true);
  assert.throws(() => { result.state.paymentCalculationLedger[0].groupCode = "TAMPERED"; }, TypeError);
  const tampered = result.state.paymentCalculationLedger.map((item) => ({ ...item }));
  tampered[0].groupCode = "TAMPERED";
  assert.equal(Intake.verifyLedger(tampered), false);
});

test("formal grouper asynchronous job accepts a correlated signed callback exactly once", () => {
  const created = Intake.createFormalGroupingJob(Service.seedDiseasePaymentState(), { id: "formal-job-success", idempotencyKey: "formal-idem-success", mode: "DRG", schemeVersion: "DRG-2.0-DL", caseIds: ["dp-case-001"] }, "operator");
  assert.equal(created.job.status, "queued");
  assert.equal(created.envelope.contractId, "disease-payment-formal-grouping-v1");
  const duplicate = Intake.createFormalGroupingJob(created.state, { idempotencyKey: "formal-idem-success", mode: "DRG", schemeVersion: "DRG-2.0-DL", caseIds: ["dp-case-001"] }, "operator");
  assert.equal(duplicate.idempotent, true);
  assert.equal(duplicate.job.id, "formal-job-success");

  const dispatched = Intake.dispatchFormalGroupingJob(created.state, created.job.id, { accepted: true, transportId: "transport-success" }, "dispatcher");
  assert.equal(dispatched.job.status, "awaiting-receipt");
  const item = dispatched.state.cases.find((row) => row.id === "dp-case-001");
  const callback = {
    correlationId: dispatched.job.correlationId,
    officialResults: [{ caseId: item.id, receiptId: "ASYNC-OFFICIAL-001", groupCode: "BR23", groupName: "脑血管疾病", schemeVersion: "DRG-2.0-DL", inputDigest: Intake.officialCaseDigest(item, "DRG"), signedAt: "2026-07-20T08:00:00.000Z", signatureValid: true, verification: { verifiedBy: "official-adapter-v1", algorithm: "SM2/SM3", keyId: "joint-test-key", verifiedAt: "2026-07-20T08:00:01.000Z" } }]
  };
  const received = Intake.receiveFormalGroupingReceipt(dispatched.state, created.job.id, callback, "callback-adapter", Service.calculateCase);
  assert.equal(received.job.status, "completed");
  assert.equal(received.run.succeeded, 1);
  assert.equal(received.state.cases.find((row) => row.id === item.id).formalGrouping.receiptId, "ASYNC-OFFICIAL-001");
  const replay = Intake.receiveFormalGroupingReceipt(received.state, created.job.id, callback, "callback-adapter", Service.calculateCase);
  assert.equal(replay.idempotent, true);
  assert.equal(Intake.buildFormalGroupingOperations(replay.state).summary.completed, 1);
});

test("formal grouper delivery uses exponential retry and dead-letter reconciliation", () => {
  const created = Intake.createFormalGroupingJob(Service.seedDiseasePaymentState(), { id: "formal-job-failure", mode: "DRG", schemeVersion: "DRG-2.0-DL", caseIds: ["dp-case-002"], maxAttempts: 2 }, "operator");
  const firstFailure = Intake.dispatchFormalGroupingJob(created.state, created.job.id, { accepted: false, errorCode: "CONNECT_TIMEOUT", errorMessage: "连接超时" }, "dispatcher");
  assert.equal(firstFailure.job.status, "retry-scheduled");
  assert.ok(firstFailure.job.nextRetryAt);
  const retried = Intake.retryFormalGroupingJob(firstFailure.state, created.job.id, "operator");
  assert.equal(retried.job.status, "queued");
  assert.notEqual(retried.job.correlationId, created.envelope.correlationId);
  const dead = Intake.dispatchFormalGroupingJob(retried.state, created.job.id, { accepted: false, errorCode: "REMOTE_UNAVAILABLE", errorMessage: "正式分组器不可用" }, "dispatcher");
  assert.equal(dead.job.status, "dead-letter");
  assert.equal(dead.state.formalGroupingDeadLetters[0].status, "pending-reconciliation");
  const reconciled = Intake.reconcileFormalGroupingDeadLetter(dead.state, created.job.id, { resolution: "医保侧恢复服务并完成链路核对" }, "reconciler");
  assert.equal(reconciled.job.status, "queued");
  assert.equal(reconciled.job.attemptCount, 0);
  assert.equal(reconciled.deadLetter.status, "resolved");
});
