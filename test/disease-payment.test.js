"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { generateKeyPairSync } = require("node:crypto");
const Service = require("../disease-payment-service");
const Intake = require("../disease-payment-intake");
const GrouperContract = require("../disease-payment-grouper-contract");
const Settlement = require("../disease-payment-settlement");
const PackageSignature = require("../disease-payment-package-signature");
const { buildDiseasePaymentReadiness } = require("../scripts/disease-payment-readiness");

const packageSigningKeys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const packageSignerFingerprint = PackageSignature.publicKeyFingerprint(packageSigningKeys.publicKey.export({ type: "spki", format: "pem" }));
const packageSignatureOptions = { trustedSignerFingerprints: [packageSignerFingerprint] };
const grouperSigningKeys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const grouperSignerFingerprint = GrouperContract.publicKeyFingerprint(grouperSigningKeys.publicKey.export({ type: "spki", format: "pem" }));
const signedOptions = (options = {}) => ({ ...options, ...packageSignatureOptions });
const specialEvidence = () => [{ type: "medical-record-summary", digest: `sha256:${"e".repeat(64)}`, issuedBy: "hospital-medical-records" }];

function signLocalPackage(payload) {
  payload.signatureEvidence = PackageSignature.createPackageSignature(payload, packageSigningKeys.privateKey.export({ type: "pkcs8", format: "pem" }), { signerId: "test-insurance-signer", signerOrganization: payload.sourceOrganization, validUntil: "2036-12-31T23:59:59.000Z" });
  return payload;
}

function localDrgPackage(id = "local-drg-test-2027") {
  const payload = {
    id, regionCode: "210200", regionName: "测试统筹区", mode: "DRG", scope: "incremental", authority: "local-medical-insurance-approved",
    packageVersion: "TEST-DRG-2027-V1", nationalVersion: "CHS-DRG 2.0", documentNo: "测试医保发〔2027〕1号", sourceOrganization: "测试市医疗保障局",
    effectiveFrom: "2026-01-01", effectiveTo: "2026-12-31", catalogCount: 1,
    sourceFiles: [{ name: "正式DRG目录.xlsx", sha256: "a".repeat(64), verificationStatus: "verified" }],
    approvalDocument: { documentNo: "测试医保发〔2027〕1号", issuedAt: "2026-12-20", fileDigest: "b".repeat(64) },
    payment: { rateMethod: "固定费率法", rate: 12000, budgetYear: 2027, institutionCoefficients: [{ institution: "大连市中心医院", coefficient: 1.1 }] },
    catalog: [{ code: "BR23", name: "脑血管疾病伴一般并发症（正式测试）", mdcCode: "MDCB", mdcName: "神经系统", adrgCode: "BR2", adrgName: "脑血管疾病", groupType: "medical", complicationLevel: "CC", diagnosisPrefixes: ["I63"], weight: 2.5, adjustment: 1 }]
  };
  return signLocalPackage(payload);
}

function approveLocalPackage(payload, state = Service.seedDiseasePaymentState()) {
  signLocalPackage(payload);
  let result = Service.importLocalPaymentPackage(state, payload, "importer", packageSignatureOptions);
  result = Service.simulateLocalPaymentPackage(result.state, payload.id, "analyst");
  result = Service.submitLocalPaymentPackage(result.state, payload.id, "importer");
  result = Service.reviewLocalPaymentPackage(result.state, payload.id, { approved: true }, "reviewer-a");
  return Service.reviewLocalPaymentPackage(result.state, payload.id, { approved: true }, "reviewer-b");
}

function publishLocalPackage(payload, options) {
  const approved = approveLocalPackage(payload);
  return Service.publishLocalPaymentPackage(approved.state, payload.id, "publisher", signedOptions(options));
}

function formallyGroupAll(state = Service.seedDiseasePaymentState(), caseIds = state.cases.map((item) => item.id)) {
  state.grouperAdapters.find((item) => item.id === "official-adapter-v1").trustedSignerFingerprints = [grouperSignerFingerprint];
  const officialResults = caseIds.map((caseId, index) => {
    const item = state.cases.find((row) => row.id === caseId);
    const local = Service.calculateCase(state, item, state.mode).grouping;
    return GrouperContract.createSignedReceipt({ caseId, receiptId: `TEST-OFFICIAL-${index + 1}`, groupCode: local.groupCode, groupName: local.groupName, mdcCode: local.mdcCode, adrgCode: local.adrgCode, schemeVersion: "DRG-2.0-DL", inputDigest: Intake.officialCaseDigest(item, "DRG"), signedAt: "2026-07-20T08:00:00.000Z" }, grouperSigningKeys.privateKey.export({ type: "pkcs8", format: "pem" }), { keyId: "test-settlement-grouper", validUntil: "2036-12-31T23:59:59.000Z" });
  });
  return Intake.runGrouping(state, { environment: "formal", mode: "DRG", caseIds, officialResults }, "formal-adapter", Service.calculateCase).state;
}

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
  const created = Service.createSpecialCase(state, { caseId: "dp-case-001", reason: "复杂危重症", requestedPaymentFen: 3200000, evidence: specialEvidence() }, "hospital");
  assert.equal(created.row.status, "待评审");
  assert.equal(created.panel.members.length, 2);
  assert.ok(created.panel.members.every((item) => item.organization !== created.row.institution));
  assert.throws(() => Service.reviewSpecialCase(created.state, created.row.id, { approved: true, adjustedPaymentFen: 3200000 }, "hospital"), (error) => error.code === "SPECIAL_CASE_REVIEWER_SEPARATION_REQUIRED");
  created.state.specialCaseExperts.find((item) => item.id === "special-expert-medical-backup").active = true;
  const replaced = Service.reselectSpecialCaseExpert(created.state, created.row.id, { expertId: "special-expert-medical-primary", reason: "专家申报与医院存在项目合作利益冲突" }, "panel-manager");
  assert.equal(replaced.replacement.expertId, "special-expert-medical-backup");
  const first = Service.reviewSpecialCase(replaced.state, created.row.id, { approved: true, adjustedPaymentFen: 3200000 }, "district-medical-reviewer");
  assert.equal(first.row.status, "复核中");
  assert.throws(() => Service.reviewSpecialCase(first.state, created.row.id, { approved: true, adjustedPaymentFen: 3200000 }, "district-medical-reviewer"), (error) => error.code === "SPECIAL_CASE_DUPLICATE_REVIEWER");
  assert.throws(() => Service.reviewSpecialCase(first.state, created.row.id, { approved: true, adjustedPaymentFen: 3190000 }, "大连市医保局管理员"), (error) => error.code === "SPECIAL_CASE_REVIEW_AMOUNT_CONFLICT");
  const reviewed = Service.reviewSpecialCase(first.state, created.row.id, { approved: true, adjustedPaymentFen: 3200000 }, "大连市医保局管理员");
  assert.equal(reviewed.row.status, "评审通过");
  assert.equal(reviewed.row.adjustedPayment, 32000);
  assert.equal(Service.verifySpecialCaseLedger(reviewed.row.events), true);
  const tampered = structuredClone(reviewed.row.events);
  tampered[0].detail.requestedPaymentFen = 1;
  assert.equal(Service.verifySpecialCaseLedger(tampered), false);
  const disclosure = Service.buildSpecialCaseDisclosure(reviewed.state);
  assert.equal(disclosure.totals.approved, 1);
  assert.doesNotMatch(JSON.stringify(disclosure), /dp-case-001|medical-record-summary|district-medical-reviewer/);
});

test("monthly settlement supports reconciliation and payment", () => {
  assert.throws(() => Service.createSettlementBatch(Service.seedDiseasePaymentState(), { period: "2026-06" }, "insurance"), /结算准入失败.*缺少可信正式分组回执/);
  assert.throws(() => Service.createSettlementBatch(formallyGroupAll(), { period: "2026-06", submissionDeadline: "2026-06-30" }, "insurance"), /结算月结束后90日内/);
  const workingCalendar = { version: "test-calendar-2026", nonWorkingDates: ["2026-07-13"], workingWeekendDates: ["2026-07-18"] };
  const created = Service.createSettlementBatch(formallyGroupAll(), { period: "2026-06", submissionDeadline: "2026-07-10", workingCalendar }, "insurance");
  assert.equal(created.batch.caseCount, 3);
  assert.equal(created.batch.status, "待申报");
  assert.equal(created.batch.settlementState, "BATCH_FROZEN");
  assert.equal(Number.isSafeInteger(created.batch.standardAmountFen), true);
  assert.ok(created.batch.batchDigest);
  assert.equal(created.batch.sla.submissionDeadline, "2026-07-10");
  assert.equal(Settlement.addWorkingDays("2026-07-10", 1, workingCalendar), "2026-07-14");
  assert.equal(created.batch.sla.status, "within-sla");
  assert.ok(created.batch.calculationSnapshots.every((item) => item.formalReceiptId && item.parameterId));
  assert.throws(() => Service.applyInsuranceCoreSettlementCallback(created.state, created.batch.id, { action: "confirm-payment", receiptId: "PAY-TOO-EARLY", paidAmountFen: created.batch.standardAmountFen }), /结算状态不允许/);
  const submitted = Service.reconcileBatch(created.state, created.batch.id, { action: "submit-core", externalRequestId: "CORE-REQ-001", idempotencyKey: "CORE-IDEM-001" }, "insurance");
  assert.equal(submitted.batch.settlementState, "CORE_SUBMITTED");
  const duplicate = Service.reconcileBatch(submitted.state, created.batch.id, { action: "submit-core", externalRequestId: "CORE-REQ-001", idempotencyKey: "CORE-IDEM-001" }, "insurance");
  assert.equal(duplicate.idempotent, true);
  assert.throws(() => Service.reconcileBatch(duplicate.state, created.batch.id, { action: "core-accepted", receiptId: "MANUAL-FAKE-RECEIPT" }, "insurance"), /只能由医保核心可信回调驱动/);
  const accepted = Service.applyInsuranceCoreSettlementCallback(duplicate.state, created.batch.id, { action: "core-accepted", receiptId: "CORE-ACCEPT-001" });
  const reconciling = Service.reconcileBatch(accepted.state, created.batch.id, { action: "start-reconciliation", idempotencyKey: "RECON-001", providerSummaryDigest: "a".repeat(64) }, "finance");
  const reconciled = Service.reconcileBatch(reconciling.state, created.batch.id, { action: "confirm-matched", idempotencyKey: "MATCH-001", providerAmountFen: created.batch.standardAmountFen }, "finance");
  assert.equal(reconciled.batch.status, "已对账");
  assert.equal(reconciled.batch.settlementState, "RECONCILED");
  const requested = Service.reconcileBatch(reconciled.state, created.batch.id, { action: "request-payment", paymentRequestId: "PAY-REQ-001" }, "insurance");
  const paid = Service.applyInsuranceCoreSettlementCallback(requested.state, created.batch.id, { action: "confirm-payment", receiptId: "PAY-RECEIPT-001", paidAmountFen: created.batch.standardAmountFen });
  assert.equal(paid.batch.settlementState, "PAID");
  assert.equal(paid.batch.sla.status, "completed-within-sla");
  assert.ok(paid.state.cases.every((item) => item.status === "已结算"));
  assert.ok(paid.state.cases.every((item) => item.fundPaid === item.formalCalculation.paymentStandard));
  assert.equal(Settlement.verifyEventLedger(paid.batch.events), true);
});

test("approved special case is frozen into the formal settlement contract", () => {
  let state = formallyGroupAll();
  const created = Service.createSpecialCase(state, { caseId: "dp-case-001", reason: "复杂危重病例资源消耗异常", requestedPaymentFen: 3200000, evidence: specialEvidence() }, "hospital");
  let reviewed = Service.reviewSpecialCase(created.state, created.row.id, { approved: true, adjustedPaymentFen: 3200000 }, "大连市医保中心审核员");
  reviewed = Service.reviewSpecialCase(reviewed.state, created.row.id, { approved: true, adjustedPaymentFen: 3200000 }, "大连市医保局管理员");
  const panelTampered = structuredClone(reviewed.state);
  panelTampered.specialCases[0].expertPanel.members[0].displayName = "被篡改的专家";
  assert.throws(() => Service.createSettlementBatch(panelTampered, { period: "2026-06" }, "insurance"), /专家抽取|账本校验失败/);
  const batchResult = Service.createSettlementBatch(reviewed.state, { period: "2026-06" }, "insurance");
  const snapshot = batchResult.batch.calculationSnapshots.find((item) => item.caseId === "dp-case-001");
  assert.equal(snapshot.specialCaseId, created.row.id);
  assert.equal(snapshot.paymentStandardFen, 3200000);
  assert.ok(snapshot.basePaymentStandardFen < snapshot.paymentStandardFen);
  assert.match(snapshot.specialCaseDecisionDigest, /^[a-f0-9]{64}$/);
  const envelope = Settlement.buildCoreSettlementEnvelope(batchResult.batch);
  assert.equal(envelope.cases.find((item) => item.caseId === "dp-case-001").specialCaseDecisionDigest, snapshot.specialCaseDecisionDigest);
  const tamperedBatch = structuredClone(batchResult.batch);
  tamperedBatch.calculationSnapshots.find((item) => item.caseId === "dp-case-001").specialCaseDecisionDigest = "invalid";
  assert.throws(() => Settlement.buildCoreSettlementEnvelope(tamperedBatch), /有效决议摘要/);
  assert.equal(batchResult.state.specialCases[0].state, "INCLUDED");
  assert.equal(Service.verifySpecialCaseLedger(batchResult.state.specialCases[0].events), true);
  assert.throws(() => Service.createSpecialCase(batchResult.state, { caseId: "dp-case-001", reason: "重复申请", requestedPaymentFen: 10000, evidence: specialEvidence() }, "hospital"), /已有在办特例单议/);
});

test("settlement difference correction and annual clearance remain auditable until lock", () => {
  const created = Service.createSettlementBatch(formallyGroupAll(), { period: "2026-06" }, "insurance");
  let result = Service.reconcileBatch(created.state, created.batch.id, { action: "submit-core", externalRequestId: "CORE-REQ-DIFF", idempotencyKey: "CORE-IDEM-DIFF" }, "insurance");
  result = Service.applyInsuranceCoreSettlementCallback(result.state, created.batch.id, { action: "core-accepted", receiptId: "CORE-ACCEPT-DIFF" });
  result = Service.reconcileBatch(result.state, created.batch.id, { action: "start-reconciliation", idempotencyKey: "RECON-DIFF", providerSummaryDigest: "b".repeat(64) }, "finance");
  result = Service.reconcileBatch(result.state, created.batch.id, { action: "record-difference", idempotencyKey: "DIFF-001", differenceAmountFen: -100, reasonCode: "ROUNDING", evidenceDigest: "d".repeat(64) }, "finance");
  assert.equal(result.batch.settlementState, "DIFFERENCE_PENDING");
  result = Service.reconcileBatch(result.state, created.batch.id, { action: "review-difference", idempotencyKey: "DIFF-HOSPITAL-REVIEW", reviewDomain: "hospital-finance", approved: true, adjustedAmountFen: created.batch.standardAmountFen - 100, resolutionDigest: "e".repeat(64) }, "hospital-finance");
  result = Service.reconcileBatch(result.state, created.batch.id, { action: "review-difference", idempotencyKey: "DIFF-INSURANCE-REVIEW", reviewDomain: "insurance-settlement", approved: true, adjustedAmountFen: created.batch.standardAmountFen - 100, resolutionDigest: "e".repeat(64) }, "insurance");
  result = Service.reconcileBatch(result.state, created.batch.id, { action: "resolve-difference", idempotencyKey: "DIFF-RESOLVE-001", resolution: "医保核心核减1元并由双方确认", resolutionDigest: "e".repeat(64), adjustedAmountFen: created.batch.standardAmountFen - 100 }, "finance");
  assert.equal(result.batch.reconciliation.differenceCase.state, "RESOLVED");
  assert.equal(Settlement.verifyEventLedger(result.batch.reconciliation.differenceCase.events), true);
  result = Service.reconcileBatch(result.state, created.batch.id, { action: "request-payment", paymentRequestId: "PAY-REQ-DIFF" }, "insurance");
  result = Service.applyInsuranceCoreSettlementCallback(result.state, created.batch.id, { action: "confirm-payment", receiptId: "PAY-RECEIPT-DIFF", paidAmountFen: created.batch.standardAmountFen - 100 });
  const annual = Service.createAnnualClearance(result.state, { id: "annual-2026", year: 2026, adjustmentFundFen: 500, retainedBalanceFen: 200, riskReserveFen: 100, adjustmentReason: "年度基金预算与质量考核调节" }, "insurance");
  assert.equal(annual.row.state, "PREPARED");
  assert.equal(annual.row.finalClearanceAmountFen, annual.row.paidAmountFen + 200);
  assert.equal(Settlement.buildAnnualClearanceEnvelope(annual.row).contractId, "insurance-annual-clearance-v1");
  const clearanceTampered = structuredClone(annual.row);
  clearanceTampered.adjustmentFundFen += 1;
  assert.throws(() => Settlement.transitionAnnualClearance(clearanceTampered, { action: "start-confirmation", idempotencyKey: "TAMPERED" }, "insurance"), /摘要校验失败/);
  let clearance = Service.applyAnnualClearanceAction(annual.state, annual.row.id, { action: "start-confirmation", idempotencyKey: "ANNUAL-CONFIRM-START" }, "insurance");
  const disputedInstitutionId = clearance.row.institutionConfirmations[0].institutionId;
  clearance = Service.applyAnnualClearanceAction(clearance.state, annual.row.id, { action: "record-dispute", idempotencyKey: "ANNUAL-DISPUTE", disputeId: "ANNUAL-DISPUTE-001", institutionId: disputedInstitutionId, reasonCode: "ADJUSTMENT_SCOPE", reason: "调节金口径待确认", amountFen: 100, evidenceDigest: "9".repeat(64) }, "hospital-finance");
  assert.throws(() => Service.applyAnnualClearanceAction(clearance.state, annual.row.id, { action: "confirm-institutions", confirmationDigest: "c".repeat(64) }, "hospital-finance"), /状态不允许|未解决/);
  clearance = Service.applyAnnualClearanceAction(clearance.state, annual.row.id, { action: "resolve-dispute", idempotencyKey: "ANNUAL-DISPUTE-RESOLVE", disputeId: "ANNUAL-DISPUTE-001", resolution: "按双方签署口径处理", resolutionDigest: "8".repeat(64), resolvedAmountFen: 0 }, "insurance");
  for (const target of clearance.row.institutionConfirmations) {
    clearance = Service.applyAnnualClearanceAction(clearance.state, annual.row.id, { action: "confirm-institution", idempotencyKey: `ANNUAL-CONFIRM-${target.institutionId}`, institutionId: target.institutionId, confirmationDigest: "c".repeat(64) }, `hospital-finance-${target.institutionId}`);
  }
  clearance = Service.applyAnnualClearanceAction(clearance.state, annual.row.id, { action: "confirm-institutions", idempotencyKey: "ANNUAL-CONFIRMED", confirmationDigest: Settlement.institutionConfirmationDigest(clearance.row) }, "hospital-finance");
  clearance = Service.applyAnnualClearanceAction(clearance.state, annual.row.id, { action: "approve", idempotencyKey: "ANNUAL-APPROVE", approvalNo: "医保清算〔2027〕1号", adjustmentApprovalDigest: "f".repeat(64) }, "insurance-bureau");
  assert.throws(() => Service.applyAnnualClearanceAction(clearance.state, annual.row.id, { action: "post", idempotencyKey: "ANNUAL-POST-BAD", voucherNo: "VOUCHER-BAD", postedAmountFen: clearance.row.finalClearanceAmountFen - 1 }, "finance"), /最终清算金额一致/);
  clearance = Service.applyAnnualClearanceAction(clearance.state, annual.row.id, { action: "post", idempotencyKey: "ANNUAL-POST", voucherNo: "VOUCHER-2026-001", postedAmountFen: clearance.row.finalClearanceAmountFen }, "finance");
  clearance = Service.applyAnnualClearanceAction(clearance.state, annual.row.id, { action: "lock", idempotencyKey: "ANNUAL-LOCK", lockReference: "LOCK-2026-001" }, "finance");
  assert.equal(clearance.row.state, "LOCKED");
  assert.equal(Settlement.verifyEventLedger(clearance.row.events), true);
  assert.throws(() => Service.applyAnnualClearanceAction(clearance.state, annual.row.id, { action: "record-dispute", institution: "测试医院", reason: "锁账后争议", amountFen: 1 }, "hospital"), /状态不允许/);
});

test("readiness report distinguishes locally ready functions from external blockers", () => {
  const report = buildDiseasePaymentReadiness();
  assert.equal(report.ready, true);
  assert.equal(report.operatingModel.ok, true);
  assert.ok(report.integrationHandoff.pending > 0);
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

test("payment parameter workflow requires impact simulation and two distinct reviewers", () => {
  const created = Service.createPaymentParameter(Service.seedDiseasePaymentState(), { id: "param-drg-2027", mode: "DRG", schemeId: "drg-demo-2026", name: "2027年度DRG参数", rate: 11000, effectiveFrom: "2027-01-01" }, "drafter");
  assert.equal(created.row.status, "草案");
  assert.throws(() => Service.submitPaymentParameter(created.state, created.row.id, "drafter"), /必须先完成影响试算/);
  const simulated = Service.simulatePaymentParameter(created.state, created.row.id, "analyst");
  assert.equal(simulated.row.status, "已试算");
  assert.equal(simulated.report.caseCount, 3);
  assert.ok(simulated.report.inputDigest);
  assert.equal(simulated.report.byInstitution.length, 2);
  const submitted = Service.submitPaymentParameter(simulated.state, created.row.id, "drafter");
  const first = Service.reviewPaymentParameter(submitted.state, created.row.id, { approved: true, role: "医保业务复核" }, "reviewer-a");
  assert.equal(first.row.status, "复核中");
  assert.throws(() => Service.reviewPaymentParameter(first.state, created.row.id, { approved: true }, "reviewer-a"), /不得重复签署/);
  const second = Service.reviewPaymentParameter(first.state, created.row.id, { approved: true, role: "基金财务复核" }, "reviewer-b");
  assert.equal(second.row.status, "已批准");
  const published = Service.publishPaymentParameter(second.state, created.row.id, "publisher");
  assert.equal(published.row.status, "已发布");
  assert.equal(published.state.parameterVersions.find((item) => item.id === "param-drg-2026").status, "已冻结");
});

test("local official package rejects patient identifiers and incomplete source evidence", () => {
  const invalid = localDrgPackage("invalid-local-package");
  invalid.catalog[0].patientName = "不应出现的姓名";
  invalid.sourceFiles[0].sha256 = "not-a-digest";
  const result = Service.importLocalPaymentPackage(Service.seedDiseasePaymentState(), invalid, "importer", packageSignatureOptions);
  assert.equal(result.row.status, "校验失败");
  assert.ok(result.validation.errors.some((item) => item.includes("患者个人信息")));
  assert.ok(result.validation.errors.some((item) => item.includes("64位文件摘要")));
  assert.throws(() => Service.simulateLocalPaymentPackage(result.state, invalid.id, "analyst"), /通过完整性校验/);
});

test("local official package is simulated, dual-reviewed, atomically published and frozen", () => {
  const payload = localDrgPackage();
  const imported = Service.importLocalPaymentPackage(Service.seedDiseasePaymentState(), payload, "importer", packageSignatureOptions);
  assert.equal(imported.row.status, "校验通过");
  assert.equal(imported.validation.summary.catalogCount, 1);
  const simulated = Service.simulateLocalPaymentPackage(imported.state, payload.id, "analyst");
  assert.equal(simulated.row.status, "已试算");
  assert.equal(simulated.report.caseCount, 3);
  assert.equal(simulated.report.byInstitution.length, 2);
  assert.equal(simulated.diffReport.packageId, payload.id);
  assert.ok(simulated.diffReport.catalog.changed.some((item) => item.code === "BR23" && item.fields.includes("weight")));
  const submitted = Service.submitLocalPaymentPackage(simulated.state, payload.id, "importer");
  const first = Service.reviewLocalPaymentPackage(submitted.state, payload.id, { approved: true, role: "医保业务复核" }, "reviewer-a");
  assert.throws(() => Service.reviewLocalPaymentPackage(first.state, payload.id, { approved: true }, "reviewer-a"), /不得重复签署/);
  const second = Service.reviewLocalPaymentPackage(first.state, payload.id, { approved: true, role: "基金财务复核" }, "reviewer-b");
  const published = Service.publishLocalPaymentPackage(second.state, payload.id, "publisher", packageSignatureOptions);
  assert.equal(published.row.status, "已发布");
  assert.equal(published.scheme.authority, "official-local");
  assert.equal(published.parameter.rate, 12000);
  assert.equal(published.state.parameterVersions.find((item) => item.id === "param-drg-2026").status, "已冻结");
  assert.ok(published.state.groupCatalog.some((item) => item.code === "BR23" && item.localPackageId === payload.id && item.authority === "official-local"));
  const calculation = Service.calculateCase(published.state, published.state.cases[0], "DRG");
  assert.equal(calculation.institutionCoefficient, 1.1);
  assert.equal(calculation.paymentStandard, 33000);
  assert.ok(calculation.formula.includes("机构系数"));
  const view = Service.buildLocalPaymentPackageView(published.state);
  assert.equal(view.packages[0].catalog, undefined);
  assert.equal(view.packages[0].catalogCount, 1);
  assert.equal(view.diffReports[0].catalog.changedCount, 1);
  const catalogPage = Service.getLocalPaymentPackageCatalogPage(published.state, payload.id, { page: 1, pageSize: 1, query: "BR23" });
  assert.equal(catalogPage.total, 1);
  assert.equal(catalogPage.items[0].code, "BR23");
  const fullDiff = Service.getLocalPaymentPackageReport(published.state, payload.id, "diff");
  assert.ok(fullDiff.catalog.changed.some((item) => item.code === "BR23"));
  const overview = Service.buildOverview(published.state);
  assert.equal(overview.state.localPaymentPackages[0].catalog, undefined);
  assert.ok(overview.state.groupCatalog.every((item) => item.mode === "DRG"));
});

test("template-only package cannot be promoted to formal settlement parameters", () => {
  const payload = localDrgPackage("template-package");
  payload.authority = "template-only";
  let result = Service.importLocalPaymentPackage(Service.seedDiseasePaymentState(), payload, "importer", packageSignatureOptions);
  result = Service.simulateLocalPaymentPackage(result.state, payload.id, "analyst");
  result = Service.submitLocalPaymentPackage(result.state, payload.id, "importer");
  result = Service.reviewLocalPaymentPackage(result.state, payload.id, { approved: true }, "reviewer-a");
  result = Service.reviewLocalPaymentPackage(result.state, payload.id, { approved: true }, "reviewer-b");
  assert.throws(() => Service.publishLocalPaymentPackage(result.state, payload.id, "publisher"), /不得发布为正式参数/);
});

test("published official catalog remains authoritative after persisted state normalization", () => {
  const incremental = localDrgPackage("incremental-official-priority");
  incremental.catalog[0].code = "LOCAL-BR23";
  incremental.catalog[0].weight = 2.6;
  const incrementalPublished = publishLocalPackage(incremental);
  const incrementalReloaded = Service.normalizeState(JSON.parse(JSON.stringify(incrementalPublished.state)));
  assert.equal(Service.calculateCase(incrementalReloaded, incrementalReloaded.cases[0], "DRG").grouping.groupCode, "LOCAL-BR23");

  const full = localDrgPackage("full-official-replacement");
  full.scope = "full";
  full.catalog[0].code = "LOCAL-FULL-BR23";
  const fullPublished = publishLocalPackage(full);
  const fullReloaded = Service.normalizeState(JSON.parse(JSON.stringify(fullPublished.state)));
  assert.deepEqual(fullReloaded.groupCatalog.filter((item) => item.mode === "DRG").map((item) => item.code), ["LOCAL-FULL-BR23"]);
  assert.ok(fullReloaded.groupCatalog.some((item) => item.mode === "DIP"));
});

test("future official package is scheduled, activates on its effective date and can safely roll back", () => {
  const payload = localDrgPackage("scheduled-local-package");
  payload.effectiveFrom = "2026-08-01";
  payload.effectiveTo = "2026-12-31";
  payload.catalog[0].code = "SCHEDULED-BR23";
  const approved = approveLocalPackage(payload);
  const scheduled = Service.publishLocalPaymentPackage(approved.state, payload.id, "publisher", signedOptions({ at: "2026-07-21" }));
  assert.equal(scheduled.row.status, "待生效");
  assert.equal(scheduled.scheduled, true);
  assert.equal(scheduled.state.parameterVersions.find((item) => item.mode === "DRG" && item.status === "已发布").id, "param-drg-2026");
  assert.throws(() => Service.activateLocalPaymentPackage(scheduled.state, payload.id, "operator", signedOptions({ at: "2026-07-31" })), /尚未到生效日期/);
  const activated = Service.activateDueLocalPaymentPackages(scheduled.state, "scheduler", signedOptions({ at: "2026-08-01" }));
  assert.equal(activated.activated.length, 1);
  assert.equal(activated.activated[0].status, "已发布");
  assert.equal(activated.state.localPaymentPackageActivationSnapshots.length, 1);
  const augustCase = { ...activated.state.cases[0], dischargeDate: "2026-08-05" };
  assert.equal(Service.calculateCase(activated.state, augustCase, "DRG").grouping.groupCode, "SCHEDULED-BR23");
  assert.equal(Service.calculateCase(activated.state, augustCase, "DRG").paymentStandard, 33000);
  const juneCase = activated.state.cases[0];
  assert.equal(Service.calculateCase(activated.state, juneCase, "DRG").grouping.groupCode, "BR23");
  assert.equal(Service.calculateCase(activated.state, juneCase, "DRG").parameterId, "param-drg-2026");
  const expiredCase = { ...activated.state.cases[0], dischargeDate: "2027-01-05" };
  assert.match(Service.calculateCase(activated.state, expiredCase, "DRG").error, /没有可用支付参数/);
  const rolledBack = Service.rollbackLocalPaymentPackage(activated.state, payload.id, { reason: "正式文件勘误，恢复上一版本" }, "rollback-operator");
  assert.equal(rolledBack.row.status, "已回退");
  assert.equal(rolledBack.state.parameterVersions.find((item) => item.mode === "DRG" && item.status === "已发布").id, "param-drg-2026");
  assert.equal(rolledBack.state.auditTrail[0].action, "当地医保规则包安全回退");
});

test("package activation blocks overlapping schedules, expired releases and rollback after financial posting", () => {
  const firstPayload = localDrgPackage("schedule-conflict-a");
  firstPayload.effectiveFrom = "2026-08-01";
  const firstApproved = approveLocalPackage(firstPayload);
  const firstScheduled = Service.publishLocalPaymentPackage(firstApproved.state, firstPayload.id, "publisher", signedOptions({ at: "2026-07-21" }));
  const secondPayload = localDrgPackage("schedule-conflict-b");
  secondPayload.effectiveFrom = "2026-09-01";
  const secondApproved = approveLocalPackage(secondPayload, firstScheduled.state);
  assert.throws(() => Service.publishLocalPaymentPackage(secondApproved.state, secondPayload.id, "publisher", signedOptions({ at: "2026-07-21" })), /有效期与schedule-conflict-a重叠/);

  const expiredPayload = localDrgPackage("expired-package");
  expiredPayload.effectiveTo = "2026-07-01";
  const expiredApproved = approveLocalPackage(expiredPayload);
  assert.throws(() => Service.publishLocalPaymentPackage(expiredApproved.state, expiredPayload.id, "publisher", signedOptions({ at: "2026-07-21" })), /有效期已结束/);

  const activePayload = localDrgPackage("financial-posting-block");
  const active = publishLocalPackage(activePayload, { at: "2026-07-21" });
  active.state.settlementBatches.push({ id: "post-activation-settlement", createdAt: "2099-01-01T00:00:00.000Z" });
  assert.throws(() => Service.rollbackLocalPaymentPackage(active.state, activePayload.id, { reason: "尝试回退" }, "operator"), /必须走财务冲正流程/);
});

test("large catalog uses diagnosis prefix index without changing grouping semantics", () => {
  const state = Service.seedDiseasePaymentState();
  state.parameterVersions.find((item) => item.mode === "DIP").status = "已发布";
  state.groupCatalog = state.groupCatalog.filter((item) => item.mode !== "DIP");
  state.groupCatalog.push(...Array.from({ length: 9520 }, (_, index) => ({ code: `DIP-X-${index}`, mode: "DIP", name: `规模测试病种${index}`, diagnosisPrefixes: [`X${String(index).padStart(5, "0")}`], score: index + 1, adjustment: 1 })));
  const stats = Service.buildCatalogIndexStats(state);
  assert.ok(stats.DIP.groupCount >= 9520);
  assert.equal(stats.DIP.strategy, "diagnosis-prefix-trie");
  const item = { ...state.cases[0], id: "large-catalog-case", settlementListNo: "LARGE-CATALOG-001", principalDiagnosis: "X09519.1" };
  const result = Service.calculateCase(state, item, "DIP");
  assert.equal(result.grouping.groupCode, "DIP-X-9519");
  assert.equal(result.paymentStandard, 9520 * 112.5);
});

test("package impact simulation job is idempotent and advances in resumable batches", () => {
  const payload = localDrgPackage("batch-simulation-package");
  const imported = Service.importLocalPaymentPackage(Service.seedDiseasePaymentState(), payload, "importer", packageSignatureOptions);
  imported.state.cases.push({ ...imported.state.cases[0], id: "batch-case-4", settlementListNo: "BATCH-004" }, { ...imported.state.cases[1], id: "batch-case-5", settlementListNo: "BATCH-005" });
  const created = Service.createLocalPaymentPackageSimulationJob(imported.state, payload.id, { batchSize: 2, idempotencyKey: "batch-simulation-idempotency" }, "analyst");
  assert.equal(created.job.status, "queued");
  assert.equal(created.job.total, 5);
  const duplicate = Service.createLocalPaymentPackageSimulationJob(created.state, payload.id, { batchSize: 2, idempotencyKey: "batch-simulation-idempotency" }, "analyst");
  assert.equal(duplicate.idempotent, true);
  assert.equal(duplicate.job.id, created.job.id);
  const firstBatch = Service.processLocalPaymentPackageSimulationJob(created.state, created.job.id, {}, "worker");
  assert.equal(firstBatch.job.processed, 2);
  assert.equal(firstBatch.job.status, "running");
  const secondBatch = Service.processLocalPaymentPackageSimulationJob(firstBatch.state, created.job.id, {}, "worker");
  assert.equal(secondBatch.job.processed, 4);
  const completed = Service.processLocalPaymentPackageSimulationJob(secondBatch.state, created.job.id, {}, "worker");
  assert.equal(completed.job.status, "completed");
  assert.equal(completed.job.processed, 5);
  assert.equal(completed.row.status, "已试算");
  assert.equal(completed.report.caseCount, 5);
  assert.equal(completed.report.processingErrorCount, 0);
  const view = Service.buildLocalPaymentPackageView(completed.state);
  assert.equal(view.simulationJobs[0].caseSnapshots, undefined);
  assert.equal(view.simulationJobs[0].snapshotCount, 5);
});

test("batch simulation detects case changes and refuses to certify an incomplete impact report", () => {
  const payload = localDrgPackage("batch-simulation-stale-case");
  const imported = Service.importLocalPaymentPackage(Service.seedDiseasePaymentState(), payload, "importer", packageSignatureOptions);
  const created = Service.createLocalPaymentPackageSimulationJob(imported.state, payload.id, { batchSize: 10 }, "analyst");
  created.state.cases[0].totalAmount += 1;
  const completed = Service.processLocalPaymentPackageSimulationJob(created.state, created.job.id, {}, "worker");
  assert.equal(completed.job.status, "completed-with-errors");
  assert.equal(completed.report.processingErrorCount, 1);
  assert.equal(completed.row.status, "校验通过");
  assert.equal(completed.row.latestImpactReportId, undefined);
});
