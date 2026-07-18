"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const Service = require("../disease-payment-service");
const { buildDiseasePaymentReadiness } = require("../scripts/disease-payment-readiness");

test("DRG cases pass quality control, grouping, calculation and risk screening", () => {
  const state = Service.calculateAll(Service.seedDiseasePaymentState(), "tester");
  assert.equal(state.cases.length, 3);
  assert.ok(state.cases.every((item) => item.calculation.quality.ok));
  assert.equal(state.cases[0].calculation.grouping.groupCode, "BR23");
  assert.equal(state.cases[0].calculation.formula, "权重 × 费率 × 调整系数");
  assert.ok(state.cases[0].calculation.paymentStandard > 0);
  assert.equal(state.auditTrail[0].action, "批量分组测算");
});

test("DIP mode uses score and point value", () => {
  const state = Service.seedDiseasePaymentState();
  state.mode = "DIP";
  state.parameterVersions.find((item) => item.mode === "DIP").status = "已发布";
  const result = Service.calculateCase(state, state.cases[1], "DIP");
  assert.equal(result.grouping.groupCode, "DIP-E11");
  assert.equal(result.formula, "分值 × 点值 × 调整系数");
  assert.equal(result.paymentStandard, 10237.5);
});

test("special case workflow supports application and review", () => {
  let state = Service.calculateAll(Service.seedDiseasePaymentState(), "tester");
  const created = Service.createSpecialCase(state, { caseId: "dp-case-001", reason: "复杂危重症" }, "hospital");
  assert.equal(created.row.status, "待评审");
  const reviewed = Service.reviewSpecialCase(created.state, created.row.id, { approved: true, adjustedPayment: 32000 }, "insurance");
  assert.equal(reviewed.row.status, "评审通过");
  assert.equal(reviewed.row.adjustedPayment, 32000);
});

test("monthly settlement supports reconciliation and payment", () => {
  const created = Service.createSettlementBatch(Service.seedDiseasePaymentState(), { period: "2026-06" }, "insurance");
  assert.equal(created.batch.caseCount, 3);
  assert.equal(created.batch.status, "待对账");
  const reconciled = Service.reconcileBatch(created.state, created.batch.id, { status: "已对账" }, "insurance");
  assert.equal(reconciled.batch.status, "已对账");
  const paid = Service.reconcileBatch(reconciled.state, created.batch.id, { status: "已拨付" }, "insurance");
  assert.ok(paid.state.cases.every((item) => item.status === "已结算"));
});

test("readiness report distinguishes locally ready functions from external blockers", () => {
  const report = buildDiseasePaymentReadiness();
  assert.equal(report.ready, true);
  assert.ok(report.externalBlockers.some((item) => item.id === "official-grouper"));
  assert.ok(report.externalBlockers.some((item) => item.id === "insurance-core"));
});

test("2.0 policy governance covers prepayment, overdue funds, negotiation, training and hard controls", () => {
  const state = Service.seedDiseasePaymentState();
  assert.equal(state.policy2.settlementSlaWorkingDays, 30);
  assert.equal(state.policy2.annualClearanceDeadline, "次年6月30日");
  assert.equal(state.prepayments[0].recommendedMonths, 1);
  assert.ok(state.dataWorkingGroup.members.length >= 3);
  assert.ok(state.complianceRules.some((item) => item.id === "no-clinician-cap" && item.severity === "阻断"));
  const action = Service.applyGovernanceAction(state, "negotiations", "negotiation-2026-001", { status: "已达成一致", conclusion: "协商一致" }, "tester");
  assert.equal(action.row.status, "已达成一致");
  assert.equal(action.state.auditTrail[0].action, "支付治理事项更新");
});

test("DIP 2.0 groups by diagnosis, main operation and eligible related operation", () => {
  const state = Service.seedDiseasePaymentState();
  state.parameterVersions.find((item) => item.mode === "DIP").status = "已发布";
  const cesarean = { id: "dip-o82", settlementListNo: "DIP-O82-001", principalDiagnosis: "O82.0", institution: "测试医院", admissionDate: "2026-01-01", dischargeDate: "2026-01-05", totalAmount: 20000, procedures: [
    { code: "74.1x01", name: "剖宫产术，子宫下段横切口", cost: 9000, role: "main" },
    { code: "68.2901", name: "子宫肌瘤切除术", cost: 2400, role: "related" }
  ] };
  const result = Service.calculateCase(state, cesarean, "DIP");
  assert.equal(result.grouping.groupCode, "DIP-O82-741X01-682901");
  assert.deepEqual(result.grouping.groupingBasis.includedRelatedOperations, ["68.2901"]);
  cesarean.procedures[1].cost = 1900;
  const belowThreshold = Service.calculateCase(state, cesarean, "DIP");
  assert.equal(belowThreshold.grouping.groupCode, "DIP-O82-741X01");
  assert.deepEqual(belowThreshold.grouping.groupingBasis.excludedRelatedOperations, ["68.2901"]);
});

test("DIP 2.0 profile preserves official catalog statistics and treatment supplements", () => {
  const profile = Service.seedDiseasePaymentState().dip2LibraryProfile;
  assert.equal(profile.coreDiseaseGroups, 9520);
  assert.equal(profile.mainOperationOnlyGroups + profile.mainAndRelatedOperationGroups, profile.surgeryOperationGroups);
  assert.deepEqual(profile.icd10Coverage, { chapters: 20, sections: 218, categories: 1133, subcategories: 3332, codingVersion: "ICD-10疾病诊断医保2.0版" });
  assert.ok(profile.supplementedTreatments.includes("肿瘤免疫治疗"));
});

test("DRG 2.0 profile preserves the official three-level structure and composition", () => {
  const profile = Service.seedDiseasePaymentState().drg2LibraryProfile;
  assert.equal(profile.mdcCount, 26);
  assert.equal(profile.adrgCount, 409);
  assert.equal(profile.drgCount, 634);
  assert.equal(profile.surgicalGroups + profile.nonOperatingRoomProcedureGroups + profile.medicalGroups, profile.drgCount);
  assert.equal(profile.excludedDiagnosisItems, 1849);
  assert.equal(profile.excludedProcedureItems, 1827);
});

test("DRG preview explains MDC, ADRG, complication split and non-binding authority", () => {
  const state = Service.seedDiseasePaymentState();
  const preview = Service.simulateDrgCase(state, { caseId: "dp-case-001" });
  assert.equal(preview.binding, false);
  assert.equal(preview.calculation.grouping.mdcCode, "MDCB");
  assert.equal(preview.calculation.grouping.adrgCode, "BR2");
  assert.equal(preview.calculation.grouping.groupCode, "BR23");
  assert.equal(preview.calculation.grouping.complicationLevel, "CC");
  assert.deepEqual(preview.calculation.grouping.groupingBasis.matchedComplicationDiagnoses, ["I10"]);
});

test("DRG preview handles MCC, excluded principal diagnoses and performance analytics", () => {
  const state = Service.seedDiseasePaymentState();
  const mccCase = { ...state.cases[2], id: "drg-mcc", settlementListNo: "DRG-MCC-001", otherDiagnoses: ["J96.0"] };
  const mcc = Service.calculateCase(state, mccCase, "DRG");
  assert.equal(mcc.grouping.groupCode, "FZ11");
  assert.equal(mcc.grouping.complicationLevel, "MCC");
  const excluded = Service.calculateCase(state, { ...mccCase, id: "drg-excluded", settlementListNo: "DRG-EXCLUDED-001", principalDiagnosis: "Z00.0" }, "DRG");
  assert.equal(excluded.grouping.reasonCode, "EXCLUDED_PRINCIPAL_DIAGNOSIS");
  const calculated = Service.calculateAll(state, "tester");
  const analytics = Service.buildDrgAnalytics(calculated);
  assert.equal(analytics.groupedCount, 3);
  assert.ok(analytics.cmi > 0);
  assert.equal(analytics.mdcCount, 3);
  assert.equal(analytics.groupDistribution.length, 3);
});
