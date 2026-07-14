"use strict";

const { randomUUID } = require("crypto");
const DiseasePaymentIntake = require("./disease-payment-intake");

const POLICY = {
  id: "nhsa-2025-18",
  name: "医疗保障按病种付费管理暂行办法",
  documentNo: "医保发〔2025〕18号",
  effectiveDate: "2025-08-11",
  source: "https://www.nhsa.gov.cn/art/2025/8/15/art_104_17573.html"
};

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function seedDiseasePaymentState() {
  return {
    policy: POLICY,
    policy2: { id: "nhsa-drg-dip-2.0-2024", name: "DRG/DIP付费2.0版分组方案落地要求", publishedAt: "2024-07-23", source: "https://www.nhsa.gov.cn/art/2024/7/23/art_105_13316.html", switchDeadline: "2024-12-31", annualClearanceDeadline: "次年6月30日", settlementSlaWorkingDays: 30 },
    mode: "DRG",
    externalDependencies: [
      { id: "official-grouper", name: "国家/地方正式分组器", status: "待联调", owner: "医保部门", requiredForProduction: true },
      { id: "insurance-core", name: "医保核心结算与拨付", status: "待联调", owner: "医保中心", requiredForProduction: true },
      { id: "medical-record-feed", name: "HIS/EMR/病案首页全量接口", status: "样例可用", owner: "医疗机构", requiredForProduction: true }
    ],
    schemeVersions: [
      { id: "drg-demo-2026", mode: "DRG", name: "DRG本地联调方案", nationalVersion: "国家版2.0", localVersion: "DL-DEMO-2026", status: "已发布", effectiveFrom: "2026-01-01", effectiveTo: "2026-12-31" },
      { id: "dip-demo-2026", mode: "DIP", name: "DIP本地联调病种库", nationalVersion: "国家DIP技术规范", localVersion: "DL-DIP-DEMO-2026", status: "草案", effectiveFrom: "2026-01-01", effectiveTo: "2026-12-31" }
    ],
    dip2LibraryProfile: {
      id: "national-dip-2.0",
      name: "DIP付费2.0版国家核心病种目录",
      sourceCases: 47870000,
      sourceRegions: 91,
      coreDiseaseGroups: 9520,
      conservativeTreatmentGroups: 3209,
      surgeryOperationGroups: 6311,
      mainOperationOnlyGroups: 5211,
      mainAndRelatedOperationGroups: 1100,
      icd10Coverage: { chapters: 20, sections: 218, categories: 1133, subcategories: 3332, codingVersion: "ICD-10疾病诊断医保2.0版" },
      comparedWith1: { reducedGroups: 2033, adjustedGroups: 3471, operationAdjustedGroups: 558, unchangedGroups: 6049 },
      groupingFormula: "主要诊断 + 主要手术操作 + 相关手术操作",
      relatedOperationCostThreshold: 0.1,
      supplementedTreatments: ["肿瘤基因治疗", "肿瘤分子治疗", "肿瘤免疫治疗", "放射治疗"]
    },
    parameterVersions: [
      { id: "param-drg-2026", mode: "DRG", schemeId: "drg-demo-2026", name: "2026年度DRG支付参数", rateMethod: "固定费率法", rate: 10800, status: "已发布", effectiveFrom: "2026-01-01", approvedBy: "演示医保经办" },
      { id: "param-dip-2026", mode: "DIP", schemeId: "dip-demo-2026", name: "2026年度DIP支付参数", rateMethod: "浮动费率法", rate: 112.5, status: "草案", effectiveFrom: "2026-01-01", approvedBy: "待审批" }
    ],
    groupCatalog: [
      { code: "FZ15", mode: "DRG", name: "循环系统疾病伴一般并发症", diagnosisPrefixes: ["I10", "I11", "I12", "I13", "I15"], weight: 0.82, adjustment: 1, primaryCare: true },
      { code: "KZ13", mode: "DRG", name: "代谢性疾病伴一般并发症", diagnosisPrefixes: ["E10", "E11", "E13", "E14"], weight: 0.94, adjustment: 1, primaryCare: true },
      { code: "BR23", mode: "DRG", name: "脑血管疾病伴严重并发症", diagnosisPrefixes: ["I60", "I61", "I62", "I63", "I64"], weight: 2.35, adjustment: 1.06, primaryCare: false },
      { code: "DIP-I10", mode: "DIP", name: "高血压病种组合", diagnosisPrefixes: ["I10", "I11", "I12", "I13", "I15"], score: 78, adjustment: 1, primaryCare: true },
      { code: "DIP-E11", mode: "DIP", name: "糖尿病病种组合", diagnosisPrefixes: ["E10", "E11", "E13", "E14"], score: 91, adjustment: 1, primaryCare: true }
      ,{ code: "DIP-O82-741X01", mode: "DIP", name: "选择性剖宫产-子宫下段横切口", diagnosisPrefixes: ["O82.0"], mainOperationPrefixes: ["74.1X01"], score: 126, adjustment: 1, primaryCare: false }
      ,{ code: "DIP-O82-741X01-682901", mode: "DIP", name: "选择性剖宫产-横切口+子宫肌瘤切除", diagnosisPrefixes: ["O82.0"], mainOperationPrefixes: ["74.1X01"], relatedOperationPrefixes: ["68.2901"], score: 168, adjustment: 1, primaryCare: false }
      ,{ code: "DIP-O82-741X02", mode: "DIP", name: "选择性剖宫产-子宫下段直切口", diagnosisPrefixes: ["O82.0"], mainOperationPrefixes: ["74.1X02"], score: 132, adjustment: 1, primaryCare: false }
      ,{ code: "DIP-ONCO-INNOVATION", mode: "DIP", name: "肿瘤基因/分子/免疫及放射治疗组合", diagnosisPrefixes: ["C"], treatmentTags: ["基因治疗", "分子治疗", "免疫治疗", "放射治疗"], score: 240, adjustment: 1.08, primaryCare: false }
    ],
    cases: [
      { id: "dp-case-001", settlementListNo: "DL-2026-0001", residentId: "r1", patientName: "演示居民A", institution: "大连市中心医院", admissionDate: "2026-06-02", dischargeDate: "2026-06-09", principalDiagnosis: "I63.9", principalDiagnosisName: "脑梗死", otherDiagnoses: ["I10"], procedures: ["99.10"], totalAmount: 32860, declaredFundAmount: 25600, fundPaid: 0, status: "待测算", qualityStatus: "待质控", specialCaseStatus: "未申报" },
      { id: "dp-case-002", settlementListNo: "DL-2026-0002", residentId: "r2", patientName: "演示居民B", institution: "大连市中心医院", admissionDate: "2026-06-12", dischargeDate: "2026-06-17", principalDiagnosis: "E11.9", principalDiagnosisName: "2型糖尿病", otherDiagnoses: ["I10"], procedures: [], totalAmount: 10680, declaredFundAmount: 8010, fundPaid: 0, status: "待测算", qualityStatus: "待质控", specialCaseStatus: "未申报" },
      { id: "dp-case-003", settlementListNo: "DL-2026-0003", residentId: "r3", patientName: "演示居民C", institution: "大连市普兰店区中心医院", admissionDate: "2026-06-18", dischargeDate: "2026-06-21", principalDiagnosis: "I10", principalDiagnosisName: "原发性高血压", otherDiagnoses: [], procedures: [], totalAmount: 7460, declaredFundAmount: 5600, fundPaid: 0, status: "待测算", qualityStatus: "待质控", specialCaseStatus: "未申报" }
    ],
    settlementListImports: [],
    settlementLists: [],
    medicalCostItems: [],
    groupingRuns: [],
    paymentCalculationLedger: [],
    importRetryQueue: [],
    grouperAdapters: [
      { id: "simulation-local-v1", environment: "simulation", name: "本地可解释模拟分组器", status: "ready", authority: "non-binding" },
      { id: "official-adapter-v1", environment: "formal", name: "国家/地方正式分组器适配器", status: "external-blocked", authority: "official-receipt-required" }
    ],
    specialCases: [],
    settlementBatches: [],
    budgets: [
      { id: "budget-2026", year: 2026, total: 3200000000, diseasePaymentTotal: 2380000000, executed: 1286000000, status: "执行中", rateMethod: "固定费率法" }
    ],
    feedbacks: [],
    prepayments: [
      { id: "prepay-2026-001", institution: "大连市中心医院", cooperationYears: 8, creditLevel: "A", traceabilityReportingRate: 98.6, antiFraudSupport: "良好", recommendedMonths: 1, amount: 18000000, status: "待审批", rationale: "长期合作、管理规范、信用良好、追溯码上报完整" }
    ],
    unpaidItems: [
      { id: "unpaid-2023-001", institution: "大连市中心医院", serviceYear: 2023, amount: 126000, agreementDueDate: "2024-03-31", reason: "历史对账差异", status: "待清理", owner: "结算科" }
    ],
    negotiationRounds: [
      { id: "negotiation-2026-001", topic: "2026年度DRG费率与调整系数", participants: ["医保部门", "医疗机构代表", "医学会"], evidenceBasis: ["历史费用", "基金预算", "实际病种数据"], status: "待协商", meetingDate: "2026-07-25", conclusion: "" }
    ],
    dataWorkingGroup: {
      id: "payment-data-group-2026", name: "按病种付费医保数据工作组", status: "已组建", members: [
        { name: "市医保中心结算科", type: "医保经办", level: "市级", role: "召集人" },
        { name: "大连市中心医院", type: "三级综合医院", level: "三级", role: "医疗机构代表" },
        { name: "普兰店区中心医院", type: "区级综合医院", level: "二级", role: "基层代表" }
      ],
      disclosureItems: ["基金运行", "病例入组", "结算清算", "特例单议"], lastBriefingAt: "2026-06-30"
    },
    trainings: [
      { id: "training-2026-001", audience: "医保部门经办人员", category: "分组与结算", scheduledAt: "2026-07-20", attendees: 42, status: "待开展" },
      { id: "training-2026-002", audience: "医疗机构分管负责人和医保办", category: "2.0版分组与特例单议", scheduledAt: "2026-07-22", attendees: 86, status: "待开展" }
    ],
    complianceRules: [
      { id: "no-clinician-cap", name: "禁止以DRG/DIP支付标准作为医务人员限额考核或绩效分配指标", severity: "阻断", status: "启用" },
      { id: "settlement-30-days", name: "申报截止次日起不超过30个工作日完成费用结算", severity: "预警", status: "启用" },
      { id: "clearance-june", name: "次年6月底前完成上一年度基金清算", severity: "预警", status: "启用" },
      { id: "special-case-cap", name: "DRG特例不超过5%，DIP特例不超过5‰", severity: "阻断", status: "启用" }
    ],
    auditTrail: []
  };
}

function normalizeState(input) {
  const seed = seedDiseasePaymentState();
  const state = input && typeof input === "object" ? input : {};
  return Object.fromEntries(Object.entries(seed).map(([key, value]) => [key, state[key] ?? value]));
}

function validateCase(item) {
  const errors = [];
  ["settlementListNo", "institution", "admissionDate", "dischargeDate", "principalDiagnosis"].forEach((field) => {
    if (!String(item[field] || "").trim()) errors.push(`${field}不能为空`);
  });
  if (Number(item.totalAmount) <= 0) errors.push("总费用必须大于0");
  if (new Date(item.dischargeDate) < new Date(item.admissionDate)) errors.push("出院日期不能早于入院日期");
  return { ok: errors.length === 0, errors, checkedAt: new Date().toISOString() };
}

function activeParameter(state, mode) {
  return state.parameterVersions.find((item) => item.mode === mode && item.status === "已发布") || state.parameterVersions.find((item) => item.mode === mode);
}

function operationRows(item) {
  return (item.procedures || []).map((operation, index) => typeof operation === "string"
    ? { code: operation.toUpperCase(), name: "", cost: 0, role: index === 0 ? "main" : "related" }
    : { code: String(operation.code || "").toUpperCase(), name: String(operation.name || ""), cost: Number(operation.cost || 0), role: operation.role || (index === 0 ? "main" : "related") });
}

function dipCatalogMatch(state, item) {
  const diagnosis = String(item.principalDiagnosis || "").toUpperCase();
  const operations = operationRows(item);
  const main = operations.find((row) => row.role === "main") || operations[0];
  const threshold = Number(state.dip2LibraryProfile?.relatedOperationCostThreshold || 0.1);
  const eligibleRelated = operations.filter((row) => row !== main && row.cost / Math.max(1, Number(item.totalAmount)) >= threshold);
  const treatmentText = operations.map((row) => `${row.code} ${row.name}`).join(" ");
  const candidates = state.groupCatalog.filter((group) => group.mode === "DIP" && group.diagnosisPrefixes.some((prefix) => diagnosis.startsWith(prefix)));
  return candidates.find((group) => group.mainOperationPrefixes?.some((prefix) => main?.code.startsWith(prefix)) && group.relatedOperationPrefixes?.some((prefix) => eligibleRelated.some((row) => row.code.startsWith(prefix))))
    || candidates.find((group) => group.mainOperationPrefixes?.some((prefix) => main?.code.startsWith(prefix)) && !group.relatedOperationPrefixes)
    || candidates.find((group) => group.treatmentTags?.some((tag) => treatmentText.includes(tag)))
    || candidates.find((group) => !group.mainOperationPrefixes && !group.treatmentTags);
}

function groupCase(state, item, mode = state.mode || "DRG") {
  const code = String(item.principalDiagnosis || "").toUpperCase();
  const catalog = mode === "DIP" ? dipCatalogMatch(state, item) : state.groupCatalog.find((group) => group.mode === mode && group.diagnosisPrefixes.some((prefix) => code.startsWith(prefix)));
  if (!catalog) return { ok: false, mode, groupCode: "UNGROUPED", groupName: "未入组", reason: "演示目录未覆盖该主要诊断，需调用正式分组器", groupedAt: new Date().toISOString() };
  const operations = operationRows(item);
  const relatedThreshold = Number(state.dip2LibraryProfile?.relatedOperationCostThreshold || 0.1);
  return { ok: true, mode, groupCode: catalog.code, groupName: catalog.name, weight: catalog.weight, score: catalog.score, adjustment: catalog.adjustment || 1, primaryCare: catalog.primaryCare, schemeId: state.schemeVersions.find((scheme) => scheme.mode === mode && scheme.status === "已发布")?.id, groupedAt: new Date().toISOString(), grouper: "本地可解释联调适配器", groupingBasis: mode === "DIP" ? { principalDiagnosis: code, mainOperation: operations.find((row) => row.role === "main")?.code || operations[0]?.code || "", includedRelatedOperations: operations.filter((row, index) => index > 0 && row.cost / Math.max(1, Number(item.totalAmount)) >= relatedThreshold).map((row) => row.code), excludedRelatedOperations: operations.filter((row, index) => index > 0 && row.cost / Math.max(1, Number(item.totalAmount)) < relatedThreshold).map((row) => row.code), relatedOperationCostThreshold: relatedThreshold } : undefined };
}

function detectRisks(item, grouping, paymentStandard) {
  const risks = [];
  const ratio = paymentStandard ? Number(item.totalAmount) / paymentStandard : 0;
  const stayDays = Math.max(1, Math.round((new Date(item.dischargeDate) - new Date(item.admissionDate)) / 86400000));
  if (!grouping.ok) risks.push({ code: "UNGROUPED", level: "高", name: "病例未入组" });
  if (ratio > 2) risks.push({ code: "HIGH_OUTLIER", level: "高", name: "高倍率病例", value: round(ratio) });
  if (ratio > 0 && ratio < 0.35) risks.push({ code: "LOW_OUTLIER", level: "中", name: "低倍率病例", value: round(ratio) });
  if (stayDays <= 1 && Number(item.totalAmount) < 3000) risks.push({ code: "SPLIT_ADMISSION", level: "中", name: "疑似分解住院线索" });
  if ((item.otherDiagnoses || []).length >= 5) risks.push({ code: "UPCODING", level: "中", name: "高编高套复核线索" });
  return risks;
}

function calculateCase(state, item, mode = state.mode || "DRG") {
  const quality = validateCase(item);
  if (!quality.ok) return { ok: false, quality, error: "结算清单质控未通过" };
  const grouping = groupCase(state, item, mode);
  const parameter = activeParameter(state, mode);
  if (!parameter) return { ok: false, quality, grouping, error: "没有可用支付参数" };
  const unit = mode === "DRG" ? Number(grouping.weight || 0) : Number(grouping.score || 0);
  const standard = round(unit * Number(parameter.rate) * Number(grouping.adjustment || 1));
  const risks = detectRisks(item, grouping, standard);
  return {
    ok: grouping.ok,
    quality,
    grouping,
    parameterId: parameter.id,
    rateMethod: parameter.rateMethod,
    rate: parameter.rate,
    formula: mode === "DRG" ? "权重 × 费率 × 调整系数" : "分值 × 点值 × 调整系数",
    paymentStandard: standard,
    variance: round(Number(item.totalAmount) - standard),
    projectedBalance: round(standard - Number(item.totalAmount)),
    risks,
    calculatedAt: new Date().toISOString()
  };
}

function audit(state, action, target, actor, detail = "") {
  state.auditTrail.unshift({ id: randomUUID(), at: new Date().toISOString(), actor: actor || "system", action, target, detail });
  state.auditTrail = state.auditTrail.slice(0, 200);
}

function calculateAll(input, actor) {
  const state = normalizeState(input);
  state.cases = state.cases.map((item) => {
    const calculation = calculateCase(state, item, state.mode);
    return { ...item, qualityStatus: calculation.quality?.ok ? "已通过" : "未通过", status: calculation.ok ? "已测算" : "待补正", calculation };
  });
  audit(state, "批量分组测算", `${state.cases.length}个病例`, actor, `模式=${state.mode}`);
  return state;
}

function createSpecialCase(input, payload, actor) {
  const state = normalizeState(input);
  const item = state.cases.find((row) => row.id === payload.caseId);
  if (!item) throw new Error("病例不存在");
  if (state.specialCases.some((row) => row.caseId === item.id && !["不予通过", "已撤回"].includes(row.status))) throw new Error("该病例已有在办特例单议");
  const discharged = Math.max(1, state.cases.length);
  const activeApplications = state.specialCases.filter((row) => !["不予通过", "已撤回"].includes(row.status)).length;
  const capRate = state.mode === "DRG" ? 0.05 : 0.005;
  if ((activeApplications + 1) / discharged > capRate && discharged >= (state.mode === "DRG" ? 20 : 200)) throw new Error(`${state.mode}特例单议申报数量超过政策上限`);
  const row = { id: `special-${Date.now()}`, caseId: item.id, institution: item.institution, reason: String(payload.reason || "复杂危重症或资源消耗异常"), requestedMethod: String(payload.requestedMethod || "调整支付标准"), evidence: payload.evidence || [], status: "待评审", submittedAt: new Date().toISOString(), submittedBy: actor };
  state.specialCases.unshift(row);
  item.specialCaseStatus = "待评审";
  audit(state, "特例单议申报", row.id, actor, row.reason);
  return { state, row };
}

function reviewSpecialCase(input, id, payload, actor) {
  const state = normalizeState(input);
  const row = state.specialCases.find((item) => item.id === id);
  if (!row) throw new Error("特例单议不存在");
  row.status = payload.approved ? "评审通过" : "不予通过";
  row.reviewMethod = payload.reviewMethod || "智能评审+专家评审";
  row.reviewOpinion = payload.opinion || (payload.approved ? "符合特例单议范围" : "仍按病种标准付费");
  row.adjustedPayment = payload.approved ? round(Number(payload.adjustedPayment || state.cases.find((item) => item.id === row.caseId)?.totalAmount || 0)) : 0;
  row.reviewedAt = new Date().toISOString();
  row.reviewedBy = actor;
  const target = state.cases.find((item) => item.id === row.caseId);
  if (target) target.specialCaseStatus = row.status;
  audit(state, "特例单议评审", row.id, actor, row.status);
  return { state, row };
}

function createSettlementBatch(input, payload, actor) {
  let state = calculateAll(input, actor);
  const period = String(payload.period || new Date().toISOString().slice(0, 7));
  const candidates = state.cases.filter((item) => item.status === "已测算" && !item.settlementBatchId && item.dischargeDate.startsWith(period));
  if (!candidates.length) throw new Error("该期间没有可结算病例");
  const batch = { id: `settlement-${period}-${Date.now()}`, type: payload.type === "annual" ? "年度清算" : "月度结算", period, institution: payload.institution || "全部机构", caseCount: candidates.length, declaredAmount: round(candidates.reduce((sum, item) => sum + Number(item.declaredFundAmount || 0), 0)), standardAmount: round(candidates.reduce((sum, item) => sum + Number(item.calculation?.paymentStandard || 0), 0)), adjustedAmount: 0, status: "待对账", createdAt: new Date().toISOString(), createdBy: actor };
  candidates.forEach((item) => { item.settlementBatchId = batch.id; item.status = "待对账"; });
  state.settlementBatches.unshift(batch);
  audit(state, "生成结算批次", batch.id, actor, `${batch.caseCount}个病例`);
  return { state, batch };
}

function reconcileBatch(input, id, payload, actor) {
  const state = normalizeState(input);
  const batch = state.settlementBatches.find((item) => item.id === id);
  if (!batch) throw new Error("结算批次不存在");
  batch.adjustedAmount = round(Number(payload.adjustedAmount ?? batch.standardAmount));
  batch.status = payload.status || "已对账";
  batch.reconciledAt = new Date().toISOString();
  batch.reconciledBy = actor;
  state.cases.filter((item) => item.settlementBatchId === id).forEach((item) => { item.status = batch.status === "已拨付" ? "已结算" : "已对账"; item.fundPaid = batch.status === "已拨付" ? item.calculation?.paymentStandard || 0 : item.fundPaid; });
  audit(state, "结算批次对账", id, actor, batch.status);
  return { state, batch };
}

function applyGovernanceAction(input, resource, id, payload, actor) {
  const state = normalizeState(input);
  const collections = { prepayments: "prepayments", unpaid: "unpaidItems", negotiations: "negotiationRounds", trainings: "trainings" };
  const collection = collections[resource];
  if (!collection) throw new Error("不支持的治理资源");
  const row = state[collection].find((item) => item.id === id);
  if (!row) throw new Error("治理事项不存在");
  const allowed = {
    prepayments: ["待审批", "已审批", "已拨付", "已暂停"],
    unpaid: ["待清理", "对账中", "已支付", "争议处理中"],
    negotiations: ["待协商", "协商中", "已达成一致", "需再次协商"],
    trainings: ["待开展", "进行中", "已完成", "已取消"]
  };
  if (!allowed[resource].includes(payload.status)) throw new Error("目标状态不符合治理流程");
  Object.assign(row, payload, { updatedAt: new Date().toISOString(), updatedBy: actor });
  audit(state, "支付治理事项更新", `${resource}/${id}`, actor, payload.status);
  return { state, row };
}

function buildOverview(input) {
  const state = DiseasePaymentIntake.ensureIntakeState(normalizeState(input));
  const calculated = state.cases.filter((item) => item.calculation?.ok);
  const risks = state.cases.flatMap((item) => item.calculation?.risks || []);
  const totalCost = round(state.cases.reduce((sum, item) => sum + Number(item.totalAmount || 0), 0));
  const paymentStandard = round(calculated.reduce((sum, item) => sum + Number(item.calculation.paymentStandard || 0), 0));
  const institutions = [...new Set(state.cases.map((item) => item.institution))].map((institution) => {
    const cases = state.cases.filter((item) => item.institution === institution);
    return { institution, caseCount: cases.length, totalCost: round(cases.reduce((sum, item) => sum + Number(item.totalAmount || 0), 0)), standardAmount: round(cases.reduce((sum, item) => sum + Number(item.calculation?.paymentStandard || 0), 0)), riskCount: cases.reduce((sum, item) => sum + (item.calculation?.risks?.length || 0), 0) };
  });
  const specialCapRate = state.mode === "DRG" ? 0.05 : 0.005;
  return { state, summary: { caseCount: state.cases.length, calculatedCount: calculated.length, ungroupedCount: state.cases.filter((item) => item.calculation?.grouping && !item.calculation.grouping.ok).length, totalCost, paymentStandard, projectedBalance: round(paymentStandard - totalCost), riskCount: risks.length, specialPending: state.specialCases.filter((item) => item.status === "待评审").length, specialCapRate, specialUsageRate: round(state.specialCases.filter((item) => !["不予通过", "已撤回"].includes(item.status)).length / Math.max(1, state.cases.length), 4), settlementPending: state.settlementBatches.filter((item) => item.status !== "已拨付").length, prepaymentPending: state.prepayments.filter((item) => item.status === "待审批").length, unpaidPending: state.unpaidItems.filter((item) => item.status !== "已支付").length, negotiationPending: state.negotiationRounds.filter((item) => item.status !== "已达成一致").length, trainingPending: state.trainings.filter((item) => item.status !== "已完成").length, intake: DiseasePaymentIntake.buildIntakeSummary(state) }, institutions };
}

module.exports = { POLICY, applyGovernanceAction, buildOverview, calculateAll, calculateCase, createSettlementBatch, createSpecialCase, normalizeState, reconcileBatch, reviewSpecialCase, seedDiseasePaymentState, validateCase };
