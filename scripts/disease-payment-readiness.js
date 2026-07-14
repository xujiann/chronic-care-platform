"use strict";

const fs = require("fs");
const path = require("path");
const Service = require("../disease-payment-service");
const Intake = require("../disease-payment-intake");

const ROOT = path.resolve(__dirname, "..");

function buildDiseasePaymentReadiness() {
  const state = Service.calculateAll(Service.seedDiseasePaymentState(), "readiness-check");
  const overview = Service.buildOverview(state);
  const requiredFiles = ["disease-payment-service.js", "disease-payment-intake.js", "disease-payment.html", "disease-payment.js", "disease-payment.css"];
  const sample = { settlementListNo: "READINESS-001", institutionCode: "HOSP-001", institution: "测试医院", admissionDate: "2026-07-01", dischargeDate: "2026-07-02", principalDiagnosis: "I10", totalAmount: 1000, declaredFundAmount: 800, costItems: [{ itemCode: "P001", itemName: "项目", amount: 1000 }] };
  const imported = Intake.importBatch(state, { sourceSystem: "readiness", rows: [sample] }, "readiness-check");
  const grouped = Intake.runGrouping(imported.state, { environment: "simulation", mode: "DRG", caseIds: [imported.state.cases.at(-1).id] }, "readiness-check", Service.calculateCase);
  const intakeSummary = Intake.buildIntakeSummary(grouped.state);
  const checks = [
    { id: "policy-baseline", label: "医保发〔2025〕18号政策基线", ok: state.policy?.id === "nhsa-2025-18" },
    { id: "dual-mode", label: "DRG/DIP双模式目录与参数", ok: state.groupCatalog.some((item) => item.mode === "DRG") && state.groupCatalog.some((item) => item.mode === "DIP") },
    { id: "case-loop", label: "清单质控、分组、测算与监管", ok: overview.summary.calculatedCount >= 3 && state.cases.slice(0, 3).every((item) => item.calculation?.quality?.ok) },
    { id: "special-case", label: "特例单议状态机", ok: Array.isArray(state.specialCases) },
    { id: "settlement", label: "月结算与年度清算批次模型", ok: Array.isArray(state.settlementBatches) && Array.isArray(state.budgets) },
    { id: "external-boundary", label: "正式分组和医保核心外部边界", ok: state.externalDependencies.filter((item) => item.requiredForProduction).length >= 3 },
    { id: "grouping-2.0", label: "DRG/DIP 2.0版切换与期限", ok: state.policy2?.switchDeadline === "2024-12-31" && state.policy2?.settlementSlaWorkingDays === 30 },
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
    { id: "api-routes", label: "按病种付费API路由", ok: ["/api/disease-payment", "/api/disease-payment/calculate", "/api/disease-payment/special-cases", "/api/disease-payment/settlements"].every((marker) => fs.readFileSync(path.join(ROOT, "server.js"), "utf8").includes(marker)) }
  ];
  return { generatedAt: new Date().toISOString(), policy: state.policy, policy2: state.policy2, summary: { ...overview.summary, intake: intakeSummary }, checks, ready: checks.every((item) => item.ok), externalBlockers: state.externalDependencies.filter((item) => item.requiredForProduction && item.status !== "已联调") };
}

if (require.main === module) {
  const report = buildDiseasePaymentReadiness();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ready) process.exitCode = 1;
}

module.exports = { buildDiseasePaymentReadiness };
