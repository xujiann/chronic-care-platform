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
  assert.match(blocked.run.results[0].error, /正式分组回执/);
  const formal = Intake.runGrouping(blocked.state, { environment: "formal", mode: "DRG", caseIds: ["dp-case-001"], officialResults: [{ caseId: "dp-case-001", receiptId: "OFF-001", groupCode: "BR23", groupName: "脑血管疾病", schemeVersion: "DRG-2.0-DL", signatureValid: true }] }, "tester", Service.calculateCase);
  assert.equal(formal.run.succeeded, 1);
  assert.equal(formal.state.cases[0].formalGrouping.authority, "official");
  assert.equal(formal.state.cases[0].simulationCalculation.grouping.groupCode, "BR23");
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
