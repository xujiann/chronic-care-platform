"use strict";

const fs = require("fs");
const path = require("path");
const { generateKeyPairSync } = require("crypto");
const Service = require("../disease-payment-service");
const Intake = require("../disease-payment-intake");
const PackageSignature = require("../disease-payment-package-signature");
const GrouperContract = require("../disease-payment-grouper-contract");
const Settlement = require("../disease-payment-settlement");

const ROOT = path.resolve(__dirname, "..");

function buildDiseasePaymentReadiness() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const signatureOptions = { trustedSignerFingerprints: [PackageSignature.publicKeyFingerprint(publicKey.export({ type: "spki", format: "pem" }))] };
  const grouperKeys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const grouperFingerprint = GrouperContract.publicKeyFingerprint(grouperKeys.publicKey.export({ type: "spki", format: "pem" }));
  const signOfficialReceipt = (payload) => GrouperContract.createSignedReceipt(payload, grouperKeys.privateKey.export({ type: "pkcs8", format: "pem" }), { keyId: "readiness-official-grouper", signerOrganization: "就绪检查医保正式分组器", validUntil: "2036-12-31T23:59:59.000Z" });
  const signPackage = (payload) => ({
    ...payload,
    signatureEvidence: PackageSignature.createPackageSignature(payload, privateKey.export({ type: "pkcs8", format: "pem" }), {
      signerId: "readiness-medical-insurance-signer",
      signerOrganization: payload.sourceOrganization,
      validUntil: "2036-12-31T23:59:59.000Z"
    })
  });
  const state = Service.calculateAll(Service.seedDiseasePaymentState(), "readiness-check");
  state.grouperAdapters.find((item) => item.id === "official-adapter-v1").trustedSignerFingerprints = [grouperFingerprint];
  const overview = Service.buildOverview(state);
  const requiredFiles = ["disease-payment-service.js", "disease-payment-intake.js", "disease-payment-grouper-contract.js", "disease-payment-settlement.js", "disease-payment-local-package.js", "disease-payment.html", "disease-payment.js", "disease-payment.css", "scripts/disease-payment-package-builder.js", "config/disease-payment/templates/local-drg-package.template.json", "config/disease-payment/templates/local-dip-package.template.json"];
  const sample = { settlementListNo: "READINESS-001", institutionCode: "HOSP-001", institution: "测试医院", admissionDate: "2026-07-01", dischargeDate: "2026-07-02", principalDiagnosis: "I10", totalAmount: 1000, declaredFundAmount: 800, costItems: [{ itemCode: "P001", itemName: "项目", amount: 1000 }] };
  const imported = Intake.importBatch(state, { sourceSystem: "readiness", rows: [sample] }, "readiness-check");
  const grouped = Intake.runGrouping(imported.state, { environment: "simulation", mode: "DRG", caseIds: [imported.state.cases.at(-1).id] }, "readiness-check", Service.calculateCase);
  const intakeSummary = Intake.buildIntakeSummary(grouped.state);
  const officialCase = state.cases[0];
  const officialReceipt = signOfficialReceipt({ caseId: officialCase.id, receiptId: "READINESS-OFFICIAL-001", groupCode: "BR23", schemeVersion: "DRG-2.0-DL", inputDigest: Intake.officialCaseDigest(officialCase, "DRG"), signedAt: "2026-07-18T08:00:00.000Z" });
  const receiptValidation = Intake.validateOfficialReceipt(state, officialCase, officialReceipt, "DRG");
  const formalJobCreated = Intake.createFormalGroupingJob(state, { id: "readiness-formal-job", idempotencyKey: "readiness-formal-job-v1", mode: "DRG", schemeVersion: "DRG-2.0-DL", caseIds: [officialCase.id] }, "readiness-operator");
  const formalJobDuplicate = Intake.createFormalGroupingJob(formalJobCreated.state, { idempotencyKey: "readiness-formal-job-v1", mode: "DRG", schemeVersion: "DRG-2.0-DL", caseIds: [officialCase.id] }, "readiness-operator");
  const formalJobDispatched = Intake.dispatchFormalGroupingJob(formalJobCreated.state, formalJobCreated.job.id, { accepted: true, transportId: "readiness-transport" }, "readiness-dispatcher");
  const formalJobReceived = Intake.receiveFormalGroupingReceipt(formalJobDispatched.state, formalJobCreated.job.id, { correlationId: formalJobDispatched.job.correlationId, officialResults: [officialReceipt] }, "readiness-callback", Service.calculateCase);
  const failureJobCreated = Intake.createFormalGroupingJob(formalJobReceived.state, { id: "readiness-formal-failure", mode: "DRG", schemeVersion: "DRG-2.0-DL", caseIds: [state.cases[1].id], maxAttempts: 1 }, "readiness-operator");
  const failureJobDead = Intake.dispatchFormalGroupingJob(failureJobCreated.state, failureJobCreated.job.id, { accepted: false, errorCode: "ADAPTER_UNAVAILABLE", errorMessage: "readiness failure rehearsal" }, "readiness-dispatcher");
  const failureJobReconciled = Intake.reconcileFormalGroupingDeadLetter(failureJobDead.state, failureJobCreated.job.id, { resolution: "readiness reconciliation completed" }, "readiness-reconciler");
  const formalOperations = Intake.buildFormalGroupingOperations(failureJobReconciled.state);
  const settlementState = Service.seedDiseasePaymentState();
  settlementState.grouperAdapters.find((item) => item.id === "official-adapter-v1").trustedSignerFingerprints = [grouperFingerprint];
  const settlementReceipts = settlementState.cases.map((item, index) => {
    const preview = Service.calculateCase(settlementState, item, "DRG").grouping;
    return signOfficialReceipt({ caseId: item.id, receiptId: `READINESS-SETTLEMENT-${index + 1}`, groupCode: preview.groupCode, groupName: preview.groupName, mdcCode: preview.mdcCode, adrgCode: preview.adrgCode, schemeVersion: "DRG-2.0-DL", inputDigest: Intake.officialCaseDigest(item, "DRG"), signedAt: "2026-07-18T08:00:00.000Z" });
  });
  const settlementGrouped = Intake.runGrouping(settlementState, { environment: "formal", mode: "DRG", caseIds: settlementState.cases.map((item) => item.id), officialResults: settlementReceipts }, "readiness-grouper", Service.calculateCase);
  const settlementCreated = Service.createSettlementBatch(settlementGrouped.state, { period: "2026-06" }, "readiness-settlement");
  const settlementFrozen = settlementCreated.batch.settlementState === "BATCH_FROZEN" && settlementCreated.batch.calculationSnapshots.every((item) => item.formalReceiptId);
  const settlementSubmitted = Service.reconcileBatch(settlementCreated.state, settlementCreated.batch.id, { action: "submit-core", externalRequestId: "READINESS-CORE-REQUEST", idempotencyKey: "READINESS-CORE-IDEM" }, "readiness-settlement");
  const settlementAccepted = Service.applyInsuranceCoreSettlementCallback(settlementSubmitted.state, settlementCreated.batch.id, { action: "core-accepted", receiptId: "READINESS-CORE-ACCEPTED" }, "readiness-insurance-core");
  const settlementReconciling = Service.reconcileBatch(settlementAccepted.state, settlementCreated.batch.id, { action: "start-reconciliation", idempotencyKey: "READINESS-RECON", providerSummaryDigest: "c".repeat(64) }, "readiness-finance");
  const settlementReconciled = Service.reconcileBatch(settlementReconciling.state, settlementCreated.batch.id, { action: "confirm-matched", idempotencyKey: "READINESS-MATCHED", providerAmountFen: settlementCreated.batch.standardAmountFen }, "readiness-finance");
  const settlementPaymentRequested = Service.reconcileBatch(settlementReconciled.state, settlementCreated.batch.id, { action: "request-payment", paymentRequestId: "READINESS-PAYMENT-REQUEST" }, "readiness-settlement");
  const settlementPaid = Service.applyInsuranceCoreSettlementCallback(settlementPaymentRequested.state, settlementCreated.batch.id, { action: "confirm-payment", receiptId: "READINESS-PAYMENT-RECEIPT", paidAmountFen: settlementCreated.batch.standardAmountFen }, "readiness-insurance-core");
  const annualCreated = Service.createAnnualClearance(settlementPaid.state, { id: "readiness-annual-2026", year: 2026 }, "readiness-settlement");
  let annualProgress = Service.applyAnnualClearanceAction(annualCreated.state, annualCreated.row.id, { action: "start-confirmation", idempotencyKey: "READINESS-ANNUAL-START" }, "readiness-settlement");
  annualProgress = Service.applyAnnualClearanceAction(annualProgress.state, annualCreated.row.id, { action: "confirm-institutions", idempotencyKey: "READINESS-ANNUAL-CONFIRM", confirmationDigest: "d".repeat(64) }, "readiness-hospital-finance");
  annualProgress = Service.applyAnnualClearanceAction(annualProgress.state, annualCreated.row.id, { action: "approve", idempotencyKey: "READINESS-ANNUAL-APPROVE", approvalNo: "READINESS-APPROVAL" }, "readiness-insurance");
  annualProgress = Service.applyAnnualClearanceAction(annualProgress.state, annualCreated.row.id, { action: "post", idempotencyKey: "READINESS-ANNUAL-POST", voucherNo: "READINESS-VOUCHER" }, "readiness-finance");
  annualProgress = Service.applyAnnualClearanceAction(annualProgress.state, annualCreated.row.id, { action: "lock", idempotencyKey: "READINESS-ANNUAL-LOCK", lockReference: "READINESS-LOCK" }, "readiness-finance");
  const parameterDraft = Service.createPaymentParameter(state, { id: "readiness-param-drg", mode: "DRG", schemeId: "drg-demo-2026", rate: 11000, effectiveFrom: "2027-01-01" }, "readiness-drafter");
  const parameterSimulation = Service.simulatePaymentParameter(parameterDraft.state, parameterDraft.row.id, "readiness-analyst");
  const parameterSubmitted = Service.submitPaymentParameter(parameterSimulation.state, parameterDraft.row.id, "readiness-drafter");
  const parameterFirstReview = Service.reviewPaymentParameter(parameterSubmitted.state, parameterDraft.row.id, { approved: true }, "readiness-reviewer-a");
  const parameterSecondReview = Service.reviewPaymentParameter(parameterFirstReview.state, parameterDraft.row.id, { approved: true }, "readiness-reviewer-b");
  const parameterPublished = Service.publishPaymentParameter(parameterSecondReview.state, parameterDraft.row.id, "readiness-publisher");
  const localPackagePayload = signPackage({
    id: "readiness-local-drg", regionCode: "210200", regionName: "就绪检查统筹区", mode: "DRG", scope: "incremental", authority: "local-medical-insurance-approved",
    packageVersion: "READINESS-DRG-V1", nationalVersion: "CHS-DRG 2.0", documentNo: "READINESS-2027-1", sourceOrganization: "就绪检查医保部门", effectiveFrom: "2026-01-01", effectiveTo: "2026-12-31", catalogCount: 1,
    sourceFiles: [{ name: "readiness-drg.xlsx", sha256: "e".repeat(64), verificationStatus: "verified" }], approvalDocument: { documentNo: "READINESS-2027-1", issuedAt: "2026-12-20", fileDigest: "f".repeat(64) },
    payment: { rateMethod: "固定费率法", rate: 11900, budgetYear: 2027, institutionCoefficients: [{ institution: "大连市中心医院", coefficient: 1.05 }] },
    catalog: [{ code: "BR23", name: "就绪检查DRG", mdcCode: "MDCB", mdcName: "神经系统", adrgCode: "BR2", adrgName: "脑血管疾病", groupType: "medical", complicationLevel: "CC", diagnosisPrefixes: ["I63"], weight: 2.45, adjustment: 1 }]
  });
  const localPackageImported = Service.importLocalPaymentPackage(state, localPackagePayload, "readiness-importer", signatureOptions);
  const localPackageSimulated = Service.simulateLocalPaymentPackage(localPackageImported.state, localPackagePayload.id, "readiness-analyst");
  const localPackageSubmitted = Service.submitLocalPaymentPackage(localPackageSimulated.state, localPackagePayload.id, "readiness-importer");
  const localPackageFirstReview = Service.reviewLocalPaymentPackage(localPackageSubmitted.state, localPackagePayload.id, { approved: true }, "readiness-local-reviewer-a");
  const localPackageSecondReview = Service.reviewLocalPaymentPackage(localPackageFirstReview.state, localPackagePayload.id, { approved: true }, "readiness-local-reviewer-b");
  const localPackagePublished = Service.publishLocalPaymentPackage(localPackageSecondReview.state, localPackagePayload.id, "readiness-local-publisher", signatureOptions);
  const scheduledPayload = signPackage({ ...localPackagePayload, signatureEvidence: undefined, id: "readiness-local-drg-next", packageVersion: "READINESS-DRG-V2", effectiveFrom: "2027-01-01", effectiveTo: "2027-12-31", catalog: localPackagePayload.catalog.map((item) => ({ ...item, weight: 2.5 })) });
  const scheduledImported = Service.importLocalPaymentPackage(localPackagePublished.state, scheduledPayload, "readiness-importer", signatureOptions);
  const scheduledSimulated = Service.simulateLocalPaymentPackage(scheduledImported.state, scheduledPayload.id, "readiness-analyst");
  const scheduledSubmitted = Service.submitLocalPaymentPackage(scheduledSimulated.state, scheduledPayload.id, "readiness-importer");
  const scheduledFirstReview = Service.reviewLocalPaymentPackage(scheduledSubmitted.state, scheduledPayload.id, { approved: true }, "readiness-scheduled-reviewer-a");
  const scheduledSecondReview = Service.reviewLocalPaymentPackage(scheduledFirstReview.state, scheduledPayload.id, { approved: true }, "readiness-scheduled-reviewer-b");
  const scheduledPublished = Service.publishLocalPaymentPackage(scheduledSecondReview.state, scheduledPayload.id, "readiness-scheduler", { ...signatureOptions, at: "2026-07-21" });
  const scheduledActivated = Service.activateDueLocalPaymentPackages(scheduledPublished.state, "readiness-activation-worker", { ...signatureOptions, at: "2027-01-01" });
  const scheduledRolledBack = Service.rollbackLocalPaymentPackage(scheduledActivated.state, scheduledPayload.id, { reason: "readiness rollback rehearsal" }, "readiness-rollback-operator");
  const localPackageView = Service.buildLocalPaymentPackageView(scheduledRolledBack.state);
  const localCatalogPage = Service.getLocalPaymentPackageCatalogPage(scheduledRolledBack.state, localPackagePayload.id, { page: 1, pageSize: 1, query: "BR23" });
  const batchPayload = signPackage({ ...localPackagePayload, signatureEvidence: undefined, id: "readiness-local-drg-batch", packageVersion: "READINESS-DRG-BATCH" });
  const batchImported = Service.importLocalPaymentPackage(Service.seedDiseasePaymentState(), batchPayload, "readiness-batch-importer", signatureOptions);
  const batchJobCreated = Service.createLocalPaymentPackageSimulationJob(batchImported.state, batchPayload.id, { batchSize: 2, idempotencyKey: "readiness-local-batch-idem" }, "readiness-batch-analyst");
  const batchJobDuplicate = Service.createLocalPaymentPackageSimulationJob(batchJobCreated.state, batchPayload.id, { batchSize: 2, idempotencyKey: "readiness-local-batch-idem" }, "readiness-batch-analyst");
  const batchJobFirst = Service.processLocalPaymentPackageSimulationJob(batchJobCreated.state, batchJobCreated.job.id, {}, "readiness-batch-worker");
  const batchJobFirstProcessed = batchJobFirst.job.processed;
  const batchJobCompleted = Service.processLocalPaymentPackageSimulationJob(batchJobFirst.state, batchJobCreated.job.id, {}, "readiness-batch-worker");
  const scaleState = Service.seedDiseasePaymentState();
  scaleState.groupCatalog = scaleState.groupCatalog.filter((item) => item.mode !== "DIP").concat(Array.from({ length: 9520 }, (_, index) => ({ code: `READINESS-DIP-${index}`, mode: "DIP", name: `规模目录${index}`, diagnosisPrefixes: [`X${String(index).padStart(5, "0")}`], score: index + 1 })));
  const catalogIndexStats = Service.buildCatalogIndexStats(scaleState);
  const checks = [
    { id: "policy-baseline", label: "医保发〔2025〕18号政策基线", ok: state.policy?.id === "nhsa-2025-18" },
    { id: "dual-mode", label: "DRG/DIP双模式目录与参数", ok: state.groupCatalog.some((item) => item.mode === "DRG") && state.groupCatalog.some((item) => item.mode === "DIP") },
    { id: "case-loop", label: "清单质控、分组、测算与监管", ok: overview.summary.calculatedCount >= 3 && state.cases.slice(0, 3).every((item) => item.calculation?.quality?.ok) },
    { id: "special-case", label: "特例单议状态机", ok: Array.isArray(state.specialCases) },
    { id: "settlement", label: "正式分组结算准入、医保核心回执与整数分状态机", ok: settlementFrozen && settlementPaid.batch.settlementState === "PAID" && Number.isSafeInteger(settlementPaid.batch.standardAmountFen) && Settlement.verifyEventLedger(settlementPaid.batch.events) },
    { id: "annual-clearance", label: "年度清算确认、批准、入账与锁账状态机", ok: annualProgress.row.state === "LOCKED" && Settlement.verifyEventLedger(annualProgress.row.events) },
    { id: "external-boundary", label: "正式分组和医保核心外部边界", ok: state.externalDependencies.filter((item) => item.requiredForProduction).length >= 3 },
    { id: "grouping-2.0", label: "DRG/DIP 2.0版切换与期限", ok: state.policy2?.switchDeadline === "2024-12-31" && state.policy2?.settlementSlaWorkingDays === 30 },
    { id: "drg2-library-profile", label: "DRG 2.0版MDC/ADRG/DRG目录结构", ok: state.drg2LibraryProfile?.mdcCount === 26 && state.drg2LibraryProfile?.adrgCount === 409 && state.drg2LibraryProfile?.drgCount === 634 },
    { id: "drg2-group-composition", label: "DRG 2.0版外科、非手术室操作与内科组构成", ok: state.drg2LibraryProfile?.surgicalGroups + state.drg2LibraryProfile?.nonOperatingRoomProcedureGroups + state.drg2LibraryProfile?.medicalGroups === state.drg2LibraryProfile?.drgCount },
    { id: "drg-hierarchy", label: "DRG本地模拟MDC、ADRG和CC/MCC分层", ok: state.cases.slice(0, 3).every((item) => item.calculation?.grouping?.mdcCode && item.calculation?.grouping?.adrgCode && item.calculation?.grouping?.complicationLevel) },
    { id: "drg-analytics", label: "DRG入组率、CMI、权重与倍率病例指标", ok: overview.summary.drg.groupedCount >= 3 && overview.summary.drg.cmi > 0 && ["highOutliers", "lowOutliers", "totalWeight"].every((key) => Object.hasOwn(overview.summary.drg, key)) },
    { id: "drg-preview-boundary", label: "DRG试分组非结算效力与正式结果隔离", ok: state.drgPreviewRules?.authority === "non-binding" && Service.simulateDrgCase(state, { caseId: "dp-case-001" }).binding === false },
    { id: "official-receipt-contract", label: "正式回执病例摘要、方案版本与可信数字签名合同", ok: receiptValidation.ok && receiptValidation.signatureVerification?.cryptographicallyValid && receiptValidation.signatureVerification?.trusted && receiptValidation.verificationContract === GrouperContract.SIGNATURE_SCHEMA_VERSION },
    { id: "formal-grouping-async", label: "正式分组异步作业、幂等派发与关联回执", ok: formalJobDuplicate.idempotent && formalJobReceived.job.status === "completed" && formalJobReceived.run.succeeded === 1 && formalJobReceived.job.receiptCount === 1 },
    { id: "formal-grouping-compensation", label: "正式分组指数退避、死信与人工对账重开", ok: failureJobDead.state.formalGroupingDeadLetters.length === 1 && failureJobReconciled.deadLetter.status === "resolved" && failureJobReconciled.job.status === "queued" && formalOperations.retryPolicy.backoffSeconds.join(",") === "60,120,240" },
    { id: "parameter-impact", label: "支付参数病例与机构影响试算", ok: parameterSimulation.report.caseCount === state.cases.length && parameterSimulation.report.byInstitution.length >= 2 && Boolean(parameterSimulation.report.inputDigest) },
    { id: "parameter-dual-review", label: "支付参数双人复核、发布与旧版冻结", ok: parameterPublished.row.status === "已发布" && parameterPublished.row.approvals.length === 2 && parameterPublished.state.parameterVersions.some((item) => item.id === "param-drg-2026" && item.status === "已冻结") },
    { id: "local-package-validation", label: "当地医保目录、权重/分值、费率和来源文件整包校验", ok: localPackageImported.validation.ok && localPackageImported.validation.summary.catalogCount === 1 && Boolean(localPackageImported.validation.digest) },
    { id: "local-package-signature", label: "当地医保规则包内容摘要、数字签名与可信公钥指纹", ok: localPackageImported.validation.signature?.ok && localPackageImported.validation.signature?.cryptographicallyValid && localPackageImported.validation.signature?.trusted },
    { id: "local-package-impact", label: "当地医保规则包病例与机构影响试算", ok: localPackageSimulated.report.caseCount === state.cases.length && localPackageSimulated.report.byInstitution.length >= 2 && Boolean(localPackageSimulated.report.inputDigest) },
    { id: "local-package-diff", label: "当地医保目录、参数和机构系数版本差异报告", ok: localPackageSimulated.diffReport.packageId === localPackagePayload.id && Array.isArray(localPackageSimulated.diffReport.catalog.changed) && Boolean(localPackageSimulated.row.latestDiffReportId) },
    { id: "local-package-release", label: "当地医保规则包双人复核、原子发布和版本冻结", ok: localPackagePublished.row.status === "已发布" && localPackagePublished.scheme.authority === "official-local" && localPackagePublished.parameter.rate === 11900 && localPackagePublished.state.groupCatalog.some((item) => item.localPackageId === localPackagePayload.id) },
    { id: "local-package-scheduling", label: "未来规则包发布排期与生效日自动激活", ok: scheduledPublished.scheduled && scheduledActivated.activated.length === 1 && scheduledActivated.activated[0].id === scheduledPayload.id && scheduledActivated.state.localPaymentPackageActivationSnapshots.length >= 2 },
    { id: "local-package-rollback", label: "生效前快照验真与无财务入账安全回退", ok: scheduledRolledBack.row.status === "已回退" && Boolean(scheduledRolledBack.snapshot.snapshotDigest) && scheduledRolledBack.state.parameterVersions.some((item) => item.id === localPackagePublished.parameter.id && item.status === "已发布") },
    { id: "local-package-pagination", label: "大目录摘要响应、分页检索与30MB规则包导入", ok: localPackageView.packages.every((item) => item.catalog === undefined) && localCatalogPage.total === 1 && localCatalogPage.items[0].code === "BR23" && fs.readFileSync(path.join(ROOT, "server.js"), "utf8").includes("collectJson(req, 30_000_000)") },
    { id: "catalog-prefix-index", label: "DRG/DIP诊断前缀索引支持9520组规模目录", ok: catalogIndexStats.DIP.groupCount >= 9520 && catalogIndexStats.DIP.strategy === "diagnosis-prefix-trie" && catalogIndexStats.DIP.nodeCount > 1 },
    { id: "local-package-batch-simulation", label: "规则包影响试算幂等作业、分批推进与断点状态", ok: batchJobDuplicate.idempotent && batchJobFirstProcessed === 2 && batchJobCompleted.job.status === "completed" && batchJobCompleted.report.caseCount === 3 && batchJobCompleted.report.processingErrorCount === 0 },
    { id: "local-package-builder", label: "当地医保CSV目录与来源文件摘要构建工具", ok: fs.readFileSync(path.join(ROOT, "scripts", "disease-payment-package-builder.js"), "utf8").includes("buildPackage") && fs.readFileSync(path.join(ROOT, "package.json"), "utf8").includes("disease-payment:package") },
    { id: "dip2-library-profile", label: "DIP 2.0版9520组目录结构", ok: state.dip2LibraryProfile?.coreDiseaseGroups === 9520 && state.dip2LibraryProfile?.conservativeTreatmentGroups === 3209 && state.dip2LibraryProfile?.surgeryOperationGroups === 6311 },
    { id: "dip2-grouping-rule", label: "主要诊断、主要操作、相关操作与10%资源阈值", ok: state.dip2LibraryProfile?.groupingFormula.includes("相关手术操作") && state.dip2LibraryProfile?.relatedOperationCostThreshold === 0.1 },
    { id: "dip2-supplement", label: "肿瘤创新治疗缺失病种补充", ok: ["肿瘤基因治疗", "肿瘤分子治疗", "肿瘤免疫治疗", "放射治疗"].every((item) => state.dip2LibraryProfile?.supplementedTreatments.includes(item)) },
    { id: "fund-relief", label: "预付金与应付未付清理", ok: state.prepayments.length > 0 && state.unpaidItems.length > 0 },
    { id: "transparent-governance", label: "谈判协商、数据工作组与培训", ok: state.negotiationRounds.length > 0 && state.dataWorkingGroup.members.length >= 3 && state.trainings.length >= 2 },
    { id: "policy-controls", label: "申报比例、结算期限、清算期限和绩效禁令", ok: ["special-case-cap", "settlement-30-days", "clearance-june", "no-clinician-cap"].every((id) => state.complianceRules.some((item) => item.id === id && item.status === "启用")) },
    { id: "intake-seven-quality-categories", label: "结算清单七类质控", ok: imported.report.accepted === 1 && Object.keys(imported.report.results[0].quality.categories).length === 7 },
    { id: "cost-detail-linkage", label: "清单与费用明细唯一关联", ok: imported.state.medicalCostItems.every((item) => item.settlementListNo === "READINESS-001") },
    { id: "formal-simulation-isolation", label: "正式与模拟分组隔离", ok: grouped.run.environment === "simulation" && grouped.state.cases.at(-1).formalGrouping === undefined },
    { id: "immutable-ledger", label: "分组与测算哈希链账本", ok: intakeSummary.ledgerValid && intakeSummary.ledgerRecords >= 1 },
    { id: "batch-retry-api", label: "批量导入、错误下载与补正重试API", ok: ["/api/disease-payment/intake/imports", "diseasePaymentImportRetryMatch", "/api/disease-payment/intake/errors", "/api/disease-payment/grouping-runs"].every((marker) => fs.readFileSync(path.join(ROOT, "server.js"), "utf8").includes(marker)) },
    { id: "runnable-ui", label: "可运行医保工作台", ok: requiredFiles.every((file) => fs.existsSync(path.join(ROOT, file))) },
    { id: "api-routes", label: "按病种付费API路由", ok: ["/api/disease-payment", "/api/disease-payment/calculate", "/api/disease-payment/special-cases", "/api/disease-payment/settlements"].every((marker) => fs.readFileSync(path.join(ROOT, "server.js"), "utf8").includes(marker)) },
    { id: "drg-api-routes", label: "DRG目录、试分组与分析API", ok: ["/api/disease-payment/drg/catalog", "/api/disease-payment/drg/simulate", "/api/disease-payment/drg/analytics"].every((marker) => fs.readFileSync(path.join(ROOT, "server.js"), "utf8").includes(marker)) },
    { id: "parameter-api-routes", label: "支付参数草案、试算、复核与发布API", ok: ["/api/disease-payment/parameters", "simulate|submit|review|publish", "createPaymentParameter", "publishPaymentParameter"].every((marker) => fs.readFileSync(path.join(ROOT, "server.js"), "utf8").includes(marker)) },
    { id: "formal-grouping-api-routes", label: "正式分组作业、派发、回执、重试与死信对账API", ok: ["/api/disease-payment/formal-grouping/operations", "/api/disease-payment/formal-grouping/jobs", "dispatch|receipts|fail|retry|reconcile", "buildFormalGroupingOperations"].every((marker) => fs.readFileSync(path.join(ROOT, "server.js"), "utf8").includes(marker)) },
    { id: "local-package-api-routes", label: "当地医保规则包导入、分页、分批试算、排期、复核与发布API", ok: ["/api/disease-payment/local-packages", "/api/disease-payment/local-packages/simulation-jobs", "catalog|diff-report|impact-report", "compare|simulate|submit|review|publish|activate|rollback", "process|retry|cancel", "activate-due", "importLocalPaymentPackage", "publishLocalPaymentPackage"].every((marker) => fs.readFileSync(path.join(ROOT, "server.js"), "utf8").includes(marker)) },
    { id: "drg-ui", label: "DRG 2.0分组与绩效工作台", ok: ["data-drg-section=\"workbench\"", "drg-profile", "drg-hierarchy", "drg-analytics"].every((marker) => fs.readFileSync(path.join(ROOT, "disease-payment.html"), "utf8").includes(marker)) },
    { id: "parameter-ui", label: "支付参数版本治理工作台", ok: ["data-payment-section=\"parameter-governance\"", "parameter-version-list", "parameter-impact-list"].every((marker) => fs.readFileSync(path.join(ROOT, "disease-payment.html"), "utf8").includes(marker)) },
    { id: "formal-grouping-ui", label: "正式分组异步联调与死信工作台", ok: ["data-payment-section=\"formal-grouping-operations\"", "formal-grouping-job-list", "formal-grouping-dead-letter-list"].every((marker) => fs.readFileSync(path.join(ROOT, "disease-payment.html"), "utf8").includes(marker)) },
    { id: "local-package-ui", label: "当地医保正式规则包导入治理工作台", ok: ["data-payment-section=\"local-package-governance\"", "local-package-file", "local-package-list", "local-package-report-list"].every((marker) => fs.readFileSync(path.join(ROOT, "disease-payment.html"), "utf8").includes(marker)) }
  ];
  return { generatedAt: new Date().toISOString(), policy: state.policy, policy2: state.policy2, summary: { ...overview.summary, intake: intakeSummary, formalGrouping: formalOperations.summary }, checks, ready: checks.every((item) => item.ok), externalBlockers: state.externalDependencies.filter((item) => item.requiredForProduction && item.status !== "已联调") };
}

function renderMarkdown(report) {
  return [
    "# 按病种付费系统就绪报告",
    "",
    `- 生成时间：${report.generatedAt}`,
    `- 本地可开发能力：${report.ready ? "通过" : "未通过"}`,
    `- 检查：${report.checks.filter((item) => item.ok).length}/${report.checks.length}`,
    `- 外部生产依赖：${report.externalBlockers.length}项`,
    "",
    "## DRG运行摘要",
    "",
    `- 入组病例：${report.summary.drg.groupedCount}/${report.summary.drg.caseCount}`,
    `- CMI：${report.summary.drg.cmi}`,
    `- 总权重：${report.summary.drg.totalWeight}`,
    `- MDC/ADRG/DRG覆盖：${report.summary.drg.mdcCount}/${report.summary.drg.adrgCount}/${report.summary.drg.drgCount}`,
    `- 正式分组异步作业：${report.summary.formalGrouping.total}（完成${report.summary.formalGrouping.completed}，待对账死信${report.summary.formalGrouping.pendingDeadLetters}）`,
    "",
    "## 检查项",
    "",
    ...report.checks.map((item) => `- ${item.ok ? "[x]" : "[ ]"} ${item.label}`),
    "",
    "## 外部生产依赖",
    "",
    ...report.externalBlockers.map((item) => `- ${item.name}：${item.status}（${item.owner}）`),
    ""
  ].join("\n");
}

if (require.main === module) {
  const report = buildDiseasePaymentReadiness();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ready) process.exitCode = 1;
}

module.exports = { buildDiseasePaymentReadiness, renderMarkdown };
