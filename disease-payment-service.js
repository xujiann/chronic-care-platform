"use strict";

const { randomUUID } = require("crypto");
const DiseasePaymentIntake = require("./disease-payment-intake");
const LocalPaymentPackage = require("./disease-payment-local-package");
const SpecialCase = require("./disease-payment-special-case");
const Settlement = require("./disease-payment-settlement");
const catalogIndexCache = new WeakMap();

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
    drg2LibraryProfile: {
      id: "national-drg-2.0",
      name: "DRG付费2.0版国家分组方案",
      sourceCases: 53710000,
      sourceCities: 78,
      mdcCount: 26,
      adrgCount: 409,
      drgCount: 634,
      surgicalGroups: 251,
      nonOperatingRoomProcedureGroups: 57,
      medicalGroups: 326,
      excludedDiagnosisItems: 1849,
      excludedProcedureItems: 1827,
      groupingRate: 0.928,
      riv: 0.71,
      optimizedDisciplines: 13,
      hierarchy: ["MDC", "ADRG", "DRG"],
      complicationLevels: ["MCC", "CC", "NONE"],
      authority: "国家核心分组统一，本地细分组和支付参数按规定配置"
    },
    drgPreviewRules: {
      id: "drg-preview-rules-2026",
      name: "DRG 2.0本地可解释模拟规则",
      authority: "non-binding",
      lowMultiplier: 0.35,
      highMultiplier: 2,
      complicationCatalog: {
        MCC: ["A41", "J96", "N17"],
        CC: ["I10", "E11", "N18"]
      },
      principalDiagnosisExclusions: [
        { prefix: "Z00", reason: "本地预览排除：一般检查类诊断不能作为模拟分组主诊断" },
        { prefix: "Z02", reason: "本地预览排除：行政性检查类诊断不能作为模拟分组主诊断" }
      ],
      operationExclusions: [
        { prefix: "89.01", reason: "本地预览排除：常规小操作不作为ADRG入组条件" }
      ]
    },
    parameterVersions: [
      { id: "param-drg-2026", mode: "DRG", schemeId: "drg-demo-2026", name: "2026年度DRG支付参数", rateMethod: "固定费率法", rate: 10800, status: "已发布", effectiveFrom: "2026-01-01", approvedBy: "演示医保经办" },
      { id: "param-dip-2026", mode: "DIP", schemeId: "dip-demo-2026", name: "2026年度DIP支付参数", rateMethod: "浮动费率法", rate: 112.5, status: "草案", effectiveFrom: "2026-01-01", approvedBy: "待审批" }
    ],
    parameterImpactReports: [],
    localPaymentPackages: [],
    localPaymentPackageValidationReports: [],
    localPaymentPackageImpactReports: [],
    localPaymentPackageDiffReports: [],
    localPaymentPackageActivationSnapshots: [],
    localPaymentPackageSimulationJobs: [],
    groupCatalog: [
      { code: "FZ11", mode: "DRG", name: "循环系统疾病伴严重并发症", mdcCode: "MDCF", mdcName: "循环系统疾病及功能障碍", adrgCode: "FZ1", adrgName: "循环系统内科诊疗组", groupType: "medical", complicationLevel: "MCC", diagnosisPrefixes: ["I10", "I11", "I12", "I13", "I15"], weight: 1.28, adjustment: 1, primaryCare: false },
      { code: "FZ13", mode: "DRG", name: "循环系统疾病伴一般并发症", mdcCode: "MDCF", mdcName: "循环系统疾病及功能障碍", adrgCode: "FZ1", adrgName: "循环系统内科诊疗组", groupType: "medical", complicationLevel: "CC", diagnosisPrefixes: ["I10", "I11", "I12", "I13", "I15"], weight: 0.98, adjustment: 1, primaryCare: true },
      { code: "FZ15", mode: "DRG", name: "循环系统疾病不伴并发症", mdcCode: "MDCF", mdcName: "循环系统疾病及功能障碍", adrgCode: "FZ1", adrgName: "循环系统内科诊疗组", groupType: "medical", complicationLevel: "NONE", diagnosisPrefixes: ["I10", "I11", "I12", "I13", "I15"], weight: 0.82, adjustment: 1, primaryCare: true },
      { code: "KZ11", mode: "DRG", name: "代谢性疾病伴严重并发症", mdcCode: "MDCK", mdcName: "内分泌、营养及代谢疾病", adrgCode: "KZ1", adrgName: "代谢性疾病内科诊疗组", groupType: "medical", complicationLevel: "MCC", diagnosisPrefixes: ["E10", "E11", "E13", "E14"], weight: 1.36, adjustment: 1, primaryCare: false },
      { code: "KZ13", mode: "DRG", name: "代谢性疾病伴一般并发症", mdcCode: "MDCK", mdcName: "内分泌、营养及代谢疾病", adrgCode: "KZ1", adrgName: "代谢性疾病内科诊疗组", groupType: "medical", complicationLevel: "CC", diagnosisPrefixes: ["E10", "E11", "E13", "E14"], weight: 0.94, adjustment: 1, primaryCare: true },
      { code: "KZ15", mode: "DRG", name: "代谢性疾病不伴并发症", mdcCode: "MDCK", mdcName: "内分泌、营养及代谢疾病", adrgCode: "KZ1", adrgName: "代谢性疾病内科诊疗组", groupType: "medical", complicationLevel: "NONE", diagnosisPrefixes: ["E10", "E11", "E13", "E14"], weight: 0.72, adjustment: 1, primaryCare: true },
      { code: "BR21", mode: "DRG", name: "脑血管疾病伴严重并发症", mdcCode: "MDCB", mdcName: "神经系统疾病及功能障碍", adrgCode: "BR2", adrgName: "脑血管疾病内科诊疗组", groupType: "medical", complicationLevel: "MCC", diagnosisPrefixes: ["I60", "I61", "I62", "I63", "I64"], weight: 2.82, adjustment: 1.08, primaryCare: false },
      { code: "BR23", mode: "DRG", name: "脑血管疾病伴一般并发症", mdcCode: "MDCB", mdcName: "神经系统疾病及功能障碍", adrgCode: "BR2", adrgName: "脑血管疾病内科诊疗组", groupType: "medical", complicationLevel: "CC", diagnosisPrefixes: ["I60", "I61", "I62", "I63", "I64"], weight: 2.35, adjustment: 1.06, primaryCare: false },
      { code: "BR25", mode: "DRG", name: "脑血管疾病不伴并发症", mdcCode: "MDCB", mdcName: "神经系统疾病及功能障碍", adrgCode: "BR2", adrgName: "脑血管疾病内科诊疗组", groupType: "medical", complicationLevel: "NONE", diagnosisPrefixes: ["I60", "I61", "I62", "I63", "I64"], weight: 1.72, adjustment: 1.03, primaryCare: false },
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
    formalGroupingJobs: [],
    formalGroupingDeadLetters: [],
    grouperAdapters: [
      { id: "simulation-local-v1", environment: "simulation", name: "本地可解释模拟分组器", status: "ready", authority: "non-binding" },
      { id: "official-adapter-v1", environment: "formal", name: "国家/地方正式分组器适配器", status: "external-blocked", authority: "official-receipt-required", acceptedSchemeVersions: ["DRG-2.0-DL", "drg-demo-2026", "DIP-2.0-DL", "dip-demo-2026"], trustedSignerFingerprints: String(process.env.DISEASE_PAYMENT_GROUPER_TRUSTED_SIGNER_FINGERPRINTS || "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean), verificationContract: "disease-payment-grouper-receipt-signature-v1" }
    ],
    specialCases: [],
    specialCaseExperts: [
      { id: "special-expert-medical-primary", name: "医保医学评审专家", displayName: "医保医学评审专家", reviewerAccount: "大连市医保中心审核员", role: "medical-insurance-review", institution: "大连市医保中心", expertise: ["复杂危重症", "DRG/DIP支付"], conflictInstitutions: [], active: true },
      { id: "special-expert-fund-primary", name: "基金财务评审专家", displayName: "基金财务评审专家", reviewerAccount: "大连市医保局管理员", role: "fund-finance-review", institution: "大连市医保局", expertise: ["基金预算", "支付标准"], conflictInstitutions: [], active: true },
      { id: "special-expert-medical-backup", name: "医学评审备选专家", displayName: "医学评审备选专家", reviewerAccount: "district-medical-reviewer", role: "medical-insurance-review", institution: "区县医保经办机构", expertise: ["复杂病例", "病案编码"], conflictInstitutions: [], active: false },
      { id: "special-expert-fund-backup", name: "基金评审备选专家", displayName: "基金评审备选专家", reviewerAccount: "fund-reviewer-backup", role: "fund-finance-review", institution: "区县医保局", expertise: ["基金财务", "年度预算"], conflictInstitutions: [], active: false }
    ],
    settlementBatches: [],
    annualClearances: [],
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
  const normalized = Object.fromEntries(Object.entries(seed).map(([key, value]) => [key, state[key] ?? value]));
  normalized.drg2LibraryProfile = { ...seed.drg2LibraryProfile, ...(state.drg2LibraryProfile || {}) };
  normalized.drgPreviewRules = {
    ...seed.drgPreviewRules,
    ...(state.drgPreviewRules || {}),
    complicationCatalog: { ...seed.drgPreviewRules.complicationCatalog, ...(state.drgPreviewRules?.complicationCatalog || {}) }
  };
  const storedCatalog = Array.isArray(state.groupCatalog) ? state.groupCatalog : [];
  const fullPublishedModes = new Set((state.localPaymentPackages || []).filter((item) => item.status === "已发布" && item.scope === "full").map((item) => item.mode));
  const officialStoredCatalog = storedCatalog.filter((item) => item.authority === "official-local");
  const officialCodes = new Set(officialStoredCatalog.map((item) => `${item.mode}:${item.code}`));
  const seedCatalog = seed.groupCatalog.filter((item) => !fullPublishedModes.has(item.mode));
  const storedByCode = new Map(storedCatalog.map((item) => [`${item.mode}:${item.code}`, item]));
  normalized.groupCatalog = [
    ...officialStoredCatalog,
    ...seedCatalog.filter((item) => !officialCodes.has(`${item.mode}:${item.code}`)).map((item) => ({ ...item, ...(storedByCode.get(`${item.mode}:${item.code}`) || {}) })),
    ...storedCatalog.filter((item) => item.authority !== "official-local" && !fullPublishedModes.has(item.mode) && !seedCatalog.some((seedItem) => seedItem.code === item.code))
  ];
  const storedAdapters = Array.isArray(state.grouperAdapters) ? state.grouperAdapters : [];
  const storedAdaptersById = new Map(storedAdapters.map((item) => [item.id, item]));
  normalized.grouperAdapters = [
    ...seed.grouperAdapters.map((item) => ({ ...item, ...(storedAdaptersById.get(item.id) || {}) })),
    ...storedAdapters.filter((item) => !seed.grouperAdapters.some((seedItem) => seedItem.id === item.id))
  ];
  return normalized;
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

function effectiveOn(item, effectiveDate) {
  const date = String(effectiveDate || "").slice(0, 10);
  if (!date) return true;
  return (!item.effectiveFrom || item.effectiveFrom <= date) && (!item.effectiveTo || item.effectiveTo >= date);
}

function activeParameter(state, mode, effectiveDate = "") {
  const candidate = state.parameterVersions.find((item) => item.mode === mode && item.simulationCandidate);
  if (candidate) return candidate;
  const versions = state.parameterVersions.filter((item) => item.mode === mode && ["已发布", "已冻结"].includes(item.status) && effectiveOn(item, effectiveDate)).sort((a, b) => String(b.effectiveFrom || "").localeCompare(String(a.effectiveFrom || "")) || (a.status === "已发布" ? -1 : 1));
  if (versions[0] || effectiveDate) return versions[0];
  return state.parameterVersions.find((item) => item.mode === mode && item.status === "已发布") || state.parameterVersions.find((item) => item.mode === mode);
}

function activeScheme(state, mode, effectiveDate = "") {
  const candidate = state.schemeVersions.find((item) => item.mode === mode && item.simulationCandidate);
  if (candidate) return candidate;
  const version = state.schemeVersions.filter((item) => item.mode === mode && ["已发布", "已冻结"].includes(item.status) && effectiveOn(item, effectiveDate)).sort((a, b) => String(b.effectiveFrom || "").localeCompare(String(a.effectiveFrom || "")) || (a.status === "已发布" ? -1 : 1))[0];
  return version || (effectiveDate ? undefined : state.schemeVersions.find((item) => item.mode === mode && item.status === "已发布"));
}

function buildCatalogPrefixIndex(state, mode) {
  const cached = catalogIndexCache.get(state);
  if (cached?.catalog === state.groupCatalog && cached.byMode.has(mode)) return cached.byMode.get(mode);
  const byMode = cached?.catalog === state.groupCatalog ? cached.byMode : new Map();
  const root = { children: new Map(), groups: [] };
  let prefixCount = 0;
  let nodeCount = 1;
  state.groupCatalog.filter((group) => group.mode === mode).forEach((group, catalogOrder) => {
    (group.diagnosisPrefixes || []).forEach((rawPrefix) => {
      const prefix = String(rawPrefix || "").toUpperCase();
      if (!prefix) return;
      prefixCount += 1;
      let node = root;
      for (const char of prefix) {
        if (!node.children.has(char)) { node.children.set(char, { children: new Map(), groups: [] }); nodeCount += 1; }
        node = node.children.get(char);
      }
      node.groups.push({ group, catalogOrder });
    });
  });
  const index = { root, mode, groupCount: state.groupCatalog.filter((group) => group.mode === mode).length, prefixCount, nodeCount };
  byMode.set(mode, index);
  catalogIndexCache.set(state, { catalog: state.groupCatalog, byMode });
  return index;
}

function indexedCatalogMatches(state, mode, diagnosis) {
  const index = buildCatalogPrefixIndex(state, mode);
  const matches = [];
  let node = index.root;
  for (const char of String(diagnosis || "").toUpperCase()) {
    node = node.children.get(char);
    if (!node) break;
    matches.push(...node.groups);
  }
  const seen = new Set();
  return matches.sort((a, b) => a.catalogOrder - b.catalogOrder).map((item) => item.group).filter((group) => { if (seen.has(group)) return false; seen.add(group); return true; });
}

function applicableCatalogMatches(state, mode, item, diagnosis) {
  const date = item.dischargeDate || item.admissionDate || "";
  const matches = indexedCatalogMatches(state, mode, diagnosis);
  const candidateRows = matches.filter((group) => group.simulationCandidate);
  if (candidateRows.length) {
    if (candidateRows.some((group) => group.packageScope === "full")) return candidateRows;
    const candidateCodes = new Set(candidateRows.map((group) => group.code));
    return [...candidateRows, ...matches.filter((group) => !group.simulationCandidate && !candidateCodes.has(group.code))];
  }
  const officialRows = matches.filter((group) => group.authority === "official-local" && effectiveOn(group, date));
  const fallbackRows = matches.filter((group) => group.authority !== "official-local");
  if (!officialRows.length) {
    const fullPackages = (state.localPaymentPackages || []).filter((group) => group.mode === mode && group.authority === "local-medical-insurance-approved" && group.scope === "full" && ["已发布", "已冻结"].includes(group.status));
    if (date && fullPackages.length && date > fullPackages.map((group) => group.effectiveTo).sort().at(-1)) return [];
    return fallbackRows;
  }
  if (officialRows.some((group) => group.packageScope === "full")) return officialRows;
  const officialCodes = new Set(officialRows.map((group) => group.code));
  return [...officialRows, ...fallbackRows.filter((group) => !officialCodes.has(group.code))];
}

function buildCatalogIndexStats(input) {
  const state = normalizeState(input);
  return Object.fromEntries(["DRG", "DIP"].map((mode) => {
    const index = buildCatalogPrefixIndex(state, mode);
    return [mode, { groupCount: index.groupCount, prefixCount: index.prefixCount, nodeCount: index.nodeCount, strategy: "diagnosis-prefix-trie" }];
  }));
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
  const candidates = applicableCatalogMatches(state, "DIP", item, diagnosis);
  return candidates.find((group) => group.mainOperationPrefixes?.some((prefix) => main?.code.startsWith(prefix)) && group.relatedOperationPrefixes?.some((prefix) => eligibleRelated.some((row) => row.code.startsWith(prefix))))
    || candidates.find((group) => group.mainOperationPrefixes?.some((prefix) => main?.code.startsWith(prefix)) && !group.relatedOperationPrefixes)
    || candidates.find((group) => group.treatmentTags?.some((tag) => treatmentText.includes(tag)))
    || candidates.find((group) => !group.mainOperationPrefixes && !group.treatmentTags);
}

function matchesPrefix(value, prefixes = []) {
  const code = String(value || "").toUpperCase();
  return prefixes.some((prefix) => code.startsWith(String(prefix).toUpperCase()));
}

function inferDrgComplicationLevel(state, item) {
  const explicit = String(item.complicationLevel || "").toUpperCase();
  if (["MCC", "CC", "NONE"].includes(explicit)) return { level: explicit, source: "病例标记", matchedDiagnoses: [] };
  const diagnoses = (item.otherDiagnoses || []).map((diagnosis) => typeof diagnosis === "string" ? diagnosis : diagnosis.code).filter(Boolean);
  const catalog = state.drgPreviewRules?.complicationCatalog || {};
  const mcc = diagnoses.filter((diagnosis) => matchesPrefix(diagnosis, catalog.MCC));
  if (mcc.length) return { level: "MCC", source: "本地预览并发症表", matchedDiagnoses: mcc };
  const cc = diagnoses.filter((diagnosis) => matchesPrefix(diagnosis, catalog.CC));
  if (cc.length) return { level: "CC", source: "本地预览并发症表", matchedDiagnoses: cc };
  return { level: "NONE", source: "本地预览并发症表", matchedDiagnoses: [] };
}

function drgCatalogMatch(state, item) {
  const diagnosis = String(item.principalDiagnosis || "").toUpperCase();
  const diagnosisExclusion = (state.drgPreviewRules?.principalDiagnosisExclusions || []).find((rule) => diagnosis.startsWith(String(rule.prefix).toUpperCase()));
  if (diagnosisExclusion) {
    return { catalog: null, stage: "MDC", reasonCode: "EXCLUDED_PRINCIPAL_DIAGNOSIS", reason: diagnosisExclusion.reason, diagnosis };
  }
  const candidates = applicableCatalogMatches(state, "DRG", item, diagnosis);
  if (!candidates.length) return { catalog: null, stage: "MDC", reasonCode: "MDC_NOT_FOUND", reason: "本地模拟目录未覆盖该主要诊断，需调用正式分组器", diagnosis };
  const complication = inferDrgComplicationLevel(state, item);
  const catalog = candidates.find((group) => group.complicationLevel === complication.level)
    || candidates.find((group) => group.complicationLevel === "NONE")
    || candidates[0];
  const operations = operationRows(item);
  const excludedOperations = operations.filter((operation) => (state.drgPreviewRules?.operationExclusions || []).some((rule) => operation.code.startsWith(String(rule.prefix).toUpperCase())));
  return { catalog, stage: "DRG", reasonCode: "GROUPED", reason: "本地模拟分组完成", diagnosis, complication, operations, excludedOperations };
}

function groupCase(state, item, mode = state.mode || "DRG") {
  const code = String(item.principalDiagnosis || "").toUpperCase();
  const drgMatch = mode === "DRG" ? drgCatalogMatch(state, item) : null;
  const catalog = mode === "DIP" ? dipCatalogMatch(state, item) : drgMatch.catalog;
  if (!catalog) return { ok: false, mode, groupCode: "UNGROUPED", groupName: "未入组", reasonCode: drgMatch?.reasonCode || "CATALOG_NOT_FOUND", stage: drgMatch?.stage || "病种目录", reason: drgMatch?.reason || "演示目录未覆盖该主要诊断，需调用正式分组器", groupedAt: new Date().toISOString(), authority: "non-binding" };
  const operations = operationRows(item);
  const relatedThreshold = Number(state.dip2LibraryProfile?.relatedOperationCostThreshold || 0.1);
  return {
    ok: true,
    mode,
    groupCode: catalog.code,
    groupName: catalog.name,
    mdcCode: catalog.mdcCode,
    mdcName: catalog.mdcName,
    adrgCode: catalog.adrgCode,
    adrgName: catalog.adrgName,
    groupType: catalog.groupType,
    complicationLevel: catalog.complicationLevel,
    weight: catalog.weight,
    score: catalog.score,
    adjustment: catalog.adjustment || 1,
    primaryCare: catalog.primaryCare,
    schemeId: activeScheme(state, mode, item.dischargeDate)?.id,
    groupedAt: new Date().toISOString(),
    grouper: "本地可解释联调适配器",
    authority: "non-binding",
    groupingBasis: mode === "DIP"
      ? { principalDiagnosis: code, mainOperation: operations.find((row) => row.role === "main")?.code || operations[0]?.code || "", includedRelatedOperations: operations.filter((row, index) => index > 0 && row.cost / Math.max(1, Number(item.totalAmount)) >= relatedThreshold).map((row) => row.code), excludedRelatedOperations: operations.filter((row, index) => index > 0 && row.cost / Math.max(1, Number(item.totalAmount)) < relatedThreshold).map((row) => row.code), relatedOperationCostThreshold: relatedThreshold }
      : { principalDiagnosis: code, mdc: catalog.mdcCode, adrg: catalog.adrgCode, complicationSource: drgMatch.complication.source, matchedComplicationDiagnoses: drgMatch.complication.matchedDiagnoses, includedOperations: drgMatch.operations.filter((operation) => !drgMatch.excludedOperations.includes(operation)).map((operation) => operation.code), excludedOperations: drgMatch.excludedOperations.map((operation) => operation.code) }
  };
}

function detectRisks(state, item, grouping, paymentStandard, mode) {
  const risks = [];
  const ratio = paymentStandard ? Number(item.totalAmount) / paymentStandard : 0;
  const stayDays = Math.max(1, Math.round((new Date(item.dischargeDate) - new Date(item.admissionDate)) / 86400000));
  const lowMultiplier = mode === "DRG" ? Number(state.drgPreviewRules?.lowMultiplier || 0.35) : 0.35;
  const highMultiplier = mode === "DRG" ? Number(state.drgPreviewRules?.highMultiplier || 2) : 2;
  if (!grouping.ok) risks.push({ code: "UNGROUPED", level: "高", name: "病例未入组" });
  if (ratio > highMultiplier) risks.push({ code: "HIGH_OUTLIER", level: "高", name: "高倍率病例", value: round(ratio), threshold: highMultiplier });
  if (ratio > 0 && ratio < lowMultiplier) risks.push({ code: "LOW_OUTLIER", level: "中", name: "低倍率病例", value: round(ratio), threshold: lowMultiplier });
  if (stayDays <= 1 && Number(item.totalAmount) < 3000) risks.push({ code: "SPLIT_ADMISSION", level: "中", name: "疑似分解住院线索" });
  if ((item.otherDiagnoses || []).length >= 5) risks.push({ code: "UPCODING", level: "中", name: "高编高套复核线索" });
  return risks;
}

function calculateCase(state, item, mode = state.mode || "DRG") {
  const quality = validateCase(item);
  if (!quality.ok) return { ok: false, quality, error: "结算清单质控未通过" };
  const grouping = groupCase(state, item, mode);
  const parameter = activeParameter(state, mode, item.dischargeDate);
  if (!parameter) return { ok: false, quality, grouping, error: "没有可用支付参数" };
  const unit = mode === "DRG" ? Number(grouping.weight || 0) : Number(grouping.score || 0);
  const institutionCoefficientRow = (parameter.institutionCoefficients || []).find((row) => (row.institutionCode && row.institutionCode === item.institutionCode) || (row.institution && row.institution === item.institution));
  const institutionCoefficient = Number(institutionCoefficientRow?.coefficient || 1);
  const standard = round(unit * Number(parameter.rate) * Number(grouping.adjustment || 1) * institutionCoefficient);
  const risks = detectRisks(state, item, grouping, standard, mode);
  const costRatio = standard > 0 ? round(Number(item.totalAmount) / standard, 4) : 0;
  const outlierType = risks.some((risk) => risk.code === "HIGH_OUTLIER") ? "HIGH" : risks.some((risk) => risk.code === "LOW_OUTLIER") ? "LOW" : grouping.ok ? "NORMAL" : "UNGROUPED";
  return {
    ok: grouping.ok,
    quality,
    grouping,
    parameterId: parameter.id,
    rateMethod: parameter.rateMethod,
    rate: parameter.rate,
    institutionCoefficient,
    formula: `${mode === "DRG" ? "权重 × 费率 × 调整系数" : "分值 × 点值 × 调整系数"}${institutionCoefficient !== 1 ? " × 机构系数" : ""}`,
    paymentStandard: standard,
    variance: round(Number(item.totalAmount) - standard),
    projectedBalance: round(standard - Number(item.totalAmount)),
    costRatio,
    outlierType,
    risks,
    calculatedAt: new Date().toISOString()
  };
}

function calculateFormalCase(state, item) {
  const quality = validateCase(item);
  if (!quality.ok) return { ok: false, quality, error: "结算清单质控未通过" };
  const formal = item.formalGrouping;
  if (!formal || formal.authority !== "official" || !formal.receiptId || !formal.inputDigest || !formal.verification?.keyFingerprint) {
    return { ok: false, quality, error: "缺少可信正式分组回执" };
  }
  if (formal.inputDigest !== DiseasePaymentIntake.officialCaseDigest(item, formal.mode || state.mode || "DRG")) {
    return { ok: false, quality, error: "正式分组回执与当前病例快照不一致" };
  }
  const mode = formal.mode === "DIP" ? "DIP" : "DRG";
  const catalogRows = state.groupCatalog.filter((row) => row.mode === mode && row.code === formal.groupCode);
  const catalog = catalogRows.find((row) => row.authority === "official-local" && effectiveOn(row, item.dischargeDate)) || catalogRows[0];
  if (!catalog) return { ok: false, quality, error: "正式分组编码未匹配支付目录" };
  const parameter = activeParameter(state, mode, item.dischargeDate);
  if (!parameter || !["已发布", "已冻结"].includes(parameter.status)) return { ok: false, quality, error: "没有已发布或已冻结的正式支付参数" };
  const grouping = {
    ...formal,
    ok: true,
    mode,
    groupName: formal.groupName || catalog.name,
    mdcCode: formal.mdcCode || catalog.mdcCode,
    adrgCode: formal.adrgCode || catalog.adrgCode,
    weight: catalog.weight,
    score: catalog.score,
    adjustment: catalog.adjustment || 1,
    authority: "official"
  };
  const unit = mode === "DRG" ? Number(grouping.weight || 0) : Number(grouping.score || 0);
  if (!(unit > 0)) return { ok: false, quality, grouping, error: "正式分组编码缺少有效权重或分值" };
  const institutionCoefficientRow = (parameter.institutionCoefficients || []).find((row) => (row.institutionCode && row.institutionCode === item.institutionCode) || (row.institution && row.institution === item.institution));
  const institutionCoefficient = Number(institutionCoefficientRow?.coefficient || 1);
  const standard = round(unit * Number(parameter.rate) * Number(grouping.adjustment || 1) * institutionCoefficient);
  const risks = detectRisks(state, item, grouping, standard, mode);
  return {
    ok: true,
    quality,
    grouping,
    authority: "official-grouping",
    parameterId: parameter.id,
    parameterStatus: parameter.status,
    rateMethod: parameter.rateMethod,
    rate: parameter.rate,
    institutionCoefficient,
    formula: `${mode === "DRG" ? "正式权重 × 费率 × 调整系数" : "正式分值 × 点值 × 调整系数"}${institutionCoefficient !== 1 ? " × 机构系数" : ""}`,
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
  if (state.specialCases.some((row) => row.caseId === item.id && SpecialCase.ACTIVE_STATES.has(SpecialCase.specialCaseState(row)))) throw new Error("该病例已有在办特例单议");
  const discharged = Math.max(1, state.cases.length);
  const activeApplications = state.specialCases.filter((row) => SpecialCase.ACTIVE_STATES.has(SpecialCase.specialCaseState(row))).length;
  const capRate = state.mode === "DRG" ? 0.05 : 0.005;
  if ((activeApplications + 1) / discharged > capRate && discharged >= (state.mode === "DRG" ? 20 : 200)) throw new Error(`${state.mode}特例单议申报数量超过政策上限`);
  const row = SpecialCase.createSpecialCaseApplication(item, payload, actor);
  const panel = SpecialCase.selectSpecialCaseExperts(row, state.specialCaseExperts, { excludedExpertIds: payload.excludedExpertIds, selectionNonce: payload.selectionNonce }, "special-case-panel-service");
  state.specialCases.unshift(row);
  item.specialCaseStatus = row.status;
  audit(state, "特例单议申报", row.id, actor, row.reason);
  return { state, row, panel };
}

function reselectSpecialCaseExpert(input, id, payload, actor) {
  const state = normalizeState(input);
  const row = state.specialCases.find((item) => item.id === id);
  if (!row) throw new Error("特例单议不存在");
  const result = SpecialCase.reselectSpecialCaseExpert(row, state.specialCaseExperts, payload, actor);
  audit(state, "特例单议专家回避", row.id, actor, `${result.recused.expertId}->${result.replacement.expertId}`);
  return { state, row, ...result };
}

function buildSpecialCaseDisclosure(input) {
  const state = normalizeState(input);
  const caseCountByInstitution = Object.fromEntries([...new Set(state.cases.map((item) => item.institution))].map((institution) => [institution, state.cases.filter((item) => item.institution === institution).length]));
  return SpecialCase.buildSpecialCaseDisclosure(state.specialCases, caseCountByInstitution);
}

function reviewSpecialCase(input, id, payload, actor) {
  const state = normalizeState(input);
  const row = state.specialCases.find((item) => item.id === id);
  if (!row) throw new Error("特例单议不存在");
  const reviewed = SpecialCase.reviewSpecialCaseApplication(row, payload, actor);
  const target = state.cases.find((item) => item.id === row.caseId);
  if (target) target.specialCaseStatus = row.status;
  audit(state, "特例单议评审", row.id, actor, row.status);
  return { state, row, review: reviewed.review };
}

function createSettlementBatch(input, payload, actor) {
  const state = normalizeState(input);
  if (payload.type === "annual") throw new Error("年度清算必须基于已拨付月度批次单独创建");
  const period = String(payload.period || new Date().toISOString().slice(0, 7));
  if (!/^\d{4}-\d{2}$/.test(period)) throw new Error("结算期间必须为YYYY-MM");
  const [periodYear, periodMonth] = period.split("-").map(Number);
  if (periodMonth < 1 || periodMonth > 12) throw new Error("结算期间月份无效");
  const defaultDeadline = new Date(Date.UTC(periodYear, periodMonth, 10)).toISOString().slice(0, 10);
  const submissionDeadline = Settlement.dateOnly(payload.submissionDeadline || defaultDeadline, "申报截止日");
  const periodEnd = new Date(Date.UTC(periodYear, periodMonth, 0));
  const deadlineDate = new Date(`${submissionDeadline}T00:00:00.000Z`);
  const latestDeadline = new Date(periodEnd);
  latestDeadline.setUTCDate(latestDeadline.getUTCDate() + 90);
  if (deadlineDate <= periodEnd || deadlineDate > latestDeadline) throw new Error("申报截止日必须在结算月结束后90日内");
  const workingCalendar = Settlement.normalizeWorkingCalendar(payload.workingCalendar || {});
  const institution = String(payload.institution || "").trim();
  const candidates = state.cases.filter((item) => !item.settlementBatchId && String(item.dischargeDate || "").startsWith(period) && (!institution || item.institution === institution || item.institutionCode === institution));
  if (!candidates.length) throw new Error("该期间没有可结算病例");
  const admission = candidates.map((item) => {
    const calculation = calculateFormalCase(state, item);
    const specialCase = calculation.ok ? SpecialCase.settlementAdjustment(state.specialCases, item) : null;
    const basePaymentStandardFen = calculation.ok ? Settlement.yuanToFen(calculation.paymentStandard, "病例基础支付标准") : 0;
    const paymentStandardFen = specialCase?.adjustedPaymentFen || basePaymentStandardFen;
    return { item, calculation, specialCase, basePaymentStandardFen, paymentStandardFen, paymentStandard: paymentStandardFen / 100 };
  });
  const blocked = admission.filter((row) => !row.calculation.ok);
  if (blocked.length) throw new Error(`结算准入失败：${blocked.map((row) => `${row.item.settlementListNo || row.item.id}(${row.calculation.error})`).join("；")}`);
  const snapshots = admission.map(({ item, calculation, specialCase, basePaymentStandardFen, paymentStandardFen, paymentStandard }) => ({ caseId: item.id, settlementListNo: item.settlementListNo, institution: item.institution, institutionCode: item.institutionCode, formalReceiptId: calculation.grouping.receiptId, formalReceiptDigest: calculation.grouping.receiptDigest, schemeVersion: calculation.grouping.schemeVersion, groupCode: calculation.grouping.groupCode, parameterId: calculation.parameterId, basePaymentStandardFen, paymentStandardFen, paymentStandard, specialCaseId: specialCase?.row.id || "", specialCaseDecisionDigest: specialCase?.decisionDigest || "" }));
  const declaredAmount = round(candidates.reduce((sum, item) => sum + Number(item.declaredFundAmount || 0), 0));
  const standardAmount = round(admission.reduce((sum, row) => sum + row.paymentStandard, 0));
  const batch = { id: `settlement-${period}-${Date.now()}`, type: "月度结算", period, institution: institution || "全部机构", caseCount: candidates.length, declaredAmount, declaredAmountFen: Settlement.yuanToFen(declaredAmount, "申报金额"), standardAmount, standardAmountFen: Settlement.yuanToFen(standardAmount, "标准金额"), adjustedAmount: standardAmount, adjustedAmountFen: Settlement.yuanToFen(standardAmount, "调整后金额"), submissionDeadline, policyWorkingDays: 30, workingCalendar, status: Settlement.SETTLEMENT_LABELS.BATCH_FROZEN, settlementState: "BATCH_FROZEN", calculationSnapshots: snapshots, batchDigest: DiseasePaymentIntake.digest({ period, institution: institution || "全部机构", submissionDeadline, workingCalendar, snapshots }), frozenAt: new Date().toISOString(), createdAt: new Date().toISOString(), createdBy: actor, events: [] };
  batch.sla = Settlement.buildSettlementSla(batch, batch.frozenAt);
  Settlement.appendEvent(batch, { id: `settlement-event-${randomUUID()}`, action: "freeze", from: "NONE", to: "BATCH_FROZEN", actor, at: batch.frozenAt, idempotencyKey: batch.id, detail: { batchDigest: batch.batchDigest, standardAmountFen: batch.standardAmountFen, submissionDeadline, slaDueDate: batch.sla.dueDate } });
  admission.forEach(({ item, calculation, specialCase, basePaymentStandardFen, paymentStandardFen, paymentStandard }) => {
    item.settlementBatchId = batch.id;
    item.status = Settlement.SETTLEMENT_LABELS.BATCH_FROZEN;
    item.formalCalculation = { ...calculation, basePaymentStandard: basePaymentStandardFen / 100, basePaymentStandardFen, paymentStandard, paymentStandardFen, specialCaseId: specialCase?.row.id || "", specialCaseDecisionDigest: specialCase?.decisionDigest || "" };
    if (specialCase) {
      SpecialCase.includeSpecialCaseInSettlement(specialCase.row, batch.id, actor);
      item.specialCaseStatus = specialCase.row.status;
    }
  });
  state.settlementBatches.unshift(batch);
  audit(state, "生成正式结算批次", batch.id, actor, `${batch.caseCount}个病例，摘要=${batch.batchDigest}`);
  return { state, batch };
}

function transitionSettlement(input, id, payload, actor, options = {}) {
  const state = normalizeState(input);
  const batch = state.settlementBatches.find((item) => item.id === id);
  if (!batch) throw new Error("结算批次不存在");
  const before = Settlement.settlementState(batch);
  const transitioned = Settlement.transitionSettlementBatch(batch, payload, actor, options);
  state.cases.filter((item) => item.settlementBatchId === id).forEach((item) => {
    item.status = ["PAID", "CLOSED"].includes(batch.settlementState) ? "已结算" : batch.status;
    if (batch.settlementState === "PAID") item.fundPaid = item.formalCalculation?.paymentStandard || 0;
  });
  if (!transitioned.idempotent) audit(state, "结算状态转换", id, actor, `${before}->${batch.settlementState}`);
  return { state, batch, event: transitioned.event, idempotent: transitioned.idempotent };
}

function reconcileBatch(input, id, payload, actor) {
  return transitionSettlement(input, id, payload, actor);
}

function applyInsuranceCoreSettlementCallback(input, id, payload, actor = "insurance-core-adapter") {
  if (!["core-accepted", "core-returned", "confirm-payment"].includes(payload.action)) throw new Error("医保核心回调动作不受支持");
  return transitionSettlement(input, id, payload, actor, { trustedInsuranceCoreCallback: true });
}

function createAnnualClearance(input, payload, actor) {
  const state = normalizeState(input);
  const year = Number(payload.year);
  if (state.annualClearances.some((item) => item.year === year && item.state !== "LOCKED")) throw new Error("该年度已有在办清算批次");
  const row = Settlement.createAnnualClearance(state.settlementBatches, payload, actor);
  state.annualClearances.unshift(row);
  audit(state, "创建年度清算", row.id, actor, `${row.batchCount}个月度批次，摘要=${row.clearanceDigest}`);
  return { state, row };
}

function applyAnnualClearanceAction(input, id, payload, actor) {
  const state = normalizeState(input);
  const row = state.annualClearances.find((item) => item.id === id);
  if (!row) throw new Error("年度清算批次不存在");
  const before = row.state;
  const transitioned = Settlement.transitionAnnualClearance(row, payload, actor);
  if (!transitioned.idempotent) audit(state, "年度清算状态转换", id, actor, `${before}->${row.state}`);
  return { state, row, event: transitioned.event, idempotent: transitioned.idempotent };
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

function createPaymentParameter(input, payload, actor) {
  const state = normalizeState(input);
  const mode = payload.mode === "DIP" ? "DIP" : "DRG";
  const rate = Number(payload.rate);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("费率或点值必须大于0");
  const schemeId = String(payload.schemeId || state.schemeVersions.find((item) => item.mode === mode && item.status === "已发布")?.id || "");
  if (!state.schemeVersions.some((item) => item.id === schemeId && item.mode === mode)) throw new Error("参数未绑定有效分组方案版本");
  const row = {
    id: String(payload.id || `param-${mode.toLowerCase()}-${Date.now()}`),
    mode,
    schemeId,
    name: String(payload.name || `${new Date().getFullYear()}年度${mode}支付参数草案`),
    rateMethod: String(payload.rateMethod || (mode === "DRG" ? "固定费率法" : "浮动点值法")),
    rate,
    status: "草案",
    effectiveFrom: String(payload.effectiveFrom || new Date().toISOString().slice(0, 10)),
    approvals: [],
    createdAt: new Date().toISOString(),
    createdBy: actor
  };
  if (state.parameterVersions.some((item) => item.id === row.id)) throw new Error("参数版本编号已存在");
  state.parameterVersions.unshift(row);
  audit(state, "支付参数草案创建", row.id, actor, `${mode} ${row.rateMethod}=${row.rate}`);
  return { state, row };
}

function simulatePaymentParameter(input, id, actor) {
  const state = normalizeState(input);
  const row = state.parameterVersions.find((item) => item.id === id);
  if (!row) throw new Error("参数版本不存在");
  if (!["草案", "已试算", "已驳回"].includes(row.status)) throw new Error("当前状态不允许重新试算");
  const active = activeParameter({ ...state, parameterVersions: state.parameterVersions.filter((item) => item.id !== row.id) }, row.mode);
  const details = state.cases.map((item) => {
    const calculation = calculateCase(state, item, row.mode);
    const unit = row.mode === "DRG" ? Number(calculation.grouping?.weight || 0) : Number(calculation.grouping?.score || 0);
    const adjustment = Number(calculation.grouping?.adjustment || 1);
    const candidateAmount = round(unit * row.rate * adjustment);
    const currentAmount = active ? round(unit * Number(active.rate) * adjustment) : 0;
    return { caseId: item.id, institution: item.institution, groupCode: calculation.grouping?.groupCode || "UNGROUPED", currentAmount, candidateAmount, delta: round(candidateAmount - currentAmount) };
  });
  const byInstitution = [...new Set(details.map((item) => item.institution))].map((institution) => {
    const rows = details.filter((item) => item.institution === institution);
    const currentAmount = round(rows.reduce((sum, item) => sum + item.currentAmount, 0));
    const candidateAmount = round(rows.reduce((sum, item) => sum + item.candidateAmount, 0));
    return { institution, caseCount: rows.length, currentAmount, candidateAmount, delta: round(candidateAmount - currentAmount), changeRate: currentAmount ? round((candidateAmount - currentAmount) / currentAmount, 4) : null };
  });
  const currentTotal = round(details.reduce((sum, item) => sum + item.currentAmount, 0));
  const candidateTotal = round(details.reduce((sum, item) => sum + item.candidateAmount, 0));
  const report = {
    id: `param-impact-${Date.now()}-${randomUUID().slice(0, 8)}`,
    parameterId: row.id,
    mode: row.mode,
    schemeId: row.schemeId,
    baselineParameterId: active?.id || null,
    caseCount: details.length,
    currentTotal,
    candidateTotal,
    delta: round(candidateTotal - currentTotal),
    changeRate: currentTotal ? round((candidateTotal - currentTotal) / currentTotal, 4) : null,
    byInstitution,
    details,
    inputDigest: DiseasePaymentIntake.digest({ parameterId: row.id, rate: row.rate, schemeId: row.schemeId, cases: state.cases.map((item) => ({ id: item.id, totalAmount: item.totalAmount, principalDiagnosis: item.principalDiagnosis })) }),
    generatedAt: new Date().toISOString(),
    generatedBy: actor
  };
  state.parameterImpactReports.unshift(report);
  row.status = "已试算";
  row.latestImpactReportId = report.id;
  row.simulatedAt = report.generatedAt;
  audit(state, "支付参数影响试算", row.id, actor, `影响${report.delta}，病例${report.caseCount}例`);
  return { state, row, report };
}

function submitPaymentParameter(input, id, actor) {
  const state = normalizeState(input);
  const row = state.parameterVersions.find((item) => item.id === id);
  if (!row) throw new Error("参数版本不存在");
  if (row.status !== "已试算" || !row.latestImpactReportId) throw new Error("参数必须先完成影响试算");
  row.status = "待复核";
  row.submittedAt = new Date().toISOString();
  row.submittedBy = actor;
  row.approvals = [];
  audit(state, "支付参数提交复核", row.id, actor, row.latestImpactReportId);
  return { state, row };
}

function reviewPaymentParameter(input, id, payload, actor) {
  const state = normalizeState(input);
  const row = state.parameterVersions.find((item) => item.id === id);
  if (!row) throw new Error("参数版本不存在");
  if (!["待复核", "复核中"].includes(row.status)) throw new Error("当前状态不允许复核");
  row.approvals ||= [];
  if (row.approvals.some((item) => item.reviewer === actor)) throw new Error("同一复核人不得重复签署");
  const approval = { reviewer: actor, role: String(payload.role || "医保参数复核"), approved: payload.approved === true, opinion: String(payload.opinion || ""), reviewedAt: new Date().toISOString() };
  row.approvals.push(approval);
  if (!approval.approved) {
    row.status = "已驳回";
  } else {
    row.status = row.approvals.filter((item) => item.approved).length >= 2 ? "已批准" : "复核中";
  }
  audit(state, "支付参数复核", row.id, actor, `${approval.approved ? "通过" : "驳回"}，已签署${row.approvals.length}人`);
  return { state, row, approval };
}

function publishPaymentParameter(input, id, actor) {
  const state = normalizeState(input);
  const row = state.parameterVersions.find((item) => item.id === id);
  if (!row) throw new Error("参数版本不存在");
  if (row.status !== "已批准" || new Set((row.approvals || []).filter((item) => item.approved).map((item) => item.reviewer)).size < 2) throw new Error("参数发布需要两名不同复核人批准");
  state.parameterVersions.filter((item) => item.id !== row.id && item.mode === row.mode && item.status === "已发布").forEach((item) => {
    item.status = "已冻结";
    item.frozenAt = new Date().toISOString();
    item.frozenBy = actor;
    item.replacedBy = row.id;
  });
  row.status = "已发布";
  row.publishedAt = new Date().toISOString();
  row.publishedBy = actor;
  row.frozen = true;
  audit(state, "支付参数发布", row.id, actor, `${row.mode} ${row.rateMethod}=${row.rate}`);
  return { state, row };
}

function buildParameterGovernanceView(input) {
  const state = normalizeState(input);
  return {
    versions: state.parameterVersions,
    impactReports: state.parameterImpactReports,
    active: ["DRG", "DIP"].map((mode) => ({ mode, parameter: activeParameter(state, mode) })),
    workflow: ["草案", "已试算", "待复核", "复核中", "已批准", "已发布/已冻结"]
  };
}

function importLocalPaymentPackage(input, payload, actor, options) {
  return LocalPaymentPackage.importLocalPaymentPackage(normalizeState(input), payload, actor, options);
}

function simulateLocalPaymentPackage(input, id, actor) {
  return LocalPaymentPackage.simulateLocalPaymentPackage(normalizeState(input), id, actor, calculateCase);
}

function compareLocalPaymentPackage(input, id, actor, baselineId) {
  return LocalPaymentPackage.compareLocalPaymentPackage(normalizeState(input), id, actor, baselineId);
}

function createLocalPaymentPackageSimulationJob(input, id, payload, actor) {
  return LocalPaymentPackage.createLocalPaymentPackageSimulationJob(normalizeState(input), id, payload, actor);
}

function processLocalPaymentPackageSimulationJob(input, jobId, payload, actor) {
  return LocalPaymentPackage.processLocalPaymentPackageSimulationJob(normalizeState(input), jobId, payload, actor, calculateCase);
}

function retryLocalPaymentPackageSimulationJob(input, jobId, actor) {
  return LocalPaymentPackage.retryLocalPaymentPackageSimulationJob(normalizeState(input), jobId, actor);
}

function cancelLocalPaymentPackageSimulationJob(input, jobId, payload, actor) {
  return LocalPaymentPackage.cancelLocalPaymentPackageSimulationJob(normalizeState(input), jobId, payload, actor);
}

function submitLocalPaymentPackage(input, id, actor) {
  return LocalPaymentPackage.submitLocalPaymentPackage(normalizeState(input), id, actor);
}

function reviewLocalPaymentPackage(input, id, payload, actor) {
  return LocalPaymentPackage.reviewLocalPaymentPackage(normalizeState(input), id, payload, actor);
}

function publishLocalPaymentPackage(input, id, actor, options) {
  return LocalPaymentPackage.publishLocalPaymentPackage(normalizeState(input), id, actor, options);
}

function activateLocalPaymentPackage(input, id, actor, options) {
  return LocalPaymentPackage.activateLocalPaymentPackage(normalizeState(input), id, actor, options);
}

function activateDueLocalPaymentPackages(input, actor, options) {
  return LocalPaymentPackage.activateDueLocalPaymentPackages(normalizeState(input), actor, options);
}

function rollbackLocalPaymentPackage(input, id, payload, actor) {
  return LocalPaymentPackage.rollbackLocalPaymentPackage(normalizeState(input), id, payload, actor);
}

function buildLocalPaymentPackageView(input) {
  return LocalPaymentPackage.buildLocalPaymentPackageView(normalizeState(input));
}

function getLocalPaymentPackageCatalogPage(input, id, options) {
  return LocalPaymentPackage.getLocalPaymentPackageCatalogPage(normalizeState(input), id, options);
}

function getLocalPaymentPackageReport(input, id, type) {
  return LocalPaymentPackage.getLocalPaymentPackageReport(normalizeState(input), id, type);
}

function buildDrgAnalytics(input) {
  const state = normalizeState(input);
  const rows = state.cases.map((item) => ({ item, calculation: item.calculation })).filter(({ calculation }) => calculation?.grouping?.mode === "DRG");
  const grouped = rows.filter(({ calculation }) => calculation.grouping.ok);
  const weightTotal = round(grouped.reduce((sum, { calculation }) => sum + Number(calculation.grouping.weight || 0), 0), 4);
  const groupMap = new Map();
  grouped.forEach(({ item, calculation }) => {
    const grouping = calculation.grouping;
    const current = groupMap.get(grouping.groupCode) || { groupCode: grouping.groupCode, groupName: grouping.groupName, mdcCode: grouping.mdcCode, adrgCode: grouping.adrgCode, caseCount: 0, totalCost: 0, paymentStandard: 0, weightTotal: 0 };
    current.caseCount += 1;
    current.totalCost += Number(item.totalAmount || 0);
    current.paymentStandard += Number(calculation.paymentStandard || 0);
    current.weightTotal += Number(grouping.weight || 0);
    groupMap.set(grouping.groupCode, current);
  });
  const groupDistribution = [...groupMap.values()].map((row) => ({ ...row, totalCost: round(row.totalCost), paymentStandard: round(row.paymentStandard), weightTotal: round(row.weightTotal, 4), balance: round(row.paymentStandard - row.totalCost) })).sort((a, b) => b.caseCount - a.caseCount || a.groupCode.localeCompare(b.groupCode));
  return {
    caseCount: rows.length,
    groupedCount: grouped.length,
    ungroupedCount: rows.length - grouped.length,
    groupingRate: rows.length ? round(grouped.length / rows.length, 4) : 0,
    totalWeight: weightTotal,
    cmi: grouped.length ? round(weightTotal / grouped.length, 4) : 0,
    mdcCount: new Set(grouped.map(({ calculation }) => calculation.grouping.mdcCode).filter(Boolean)).size,
    adrgCount: new Set(grouped.map(({ calculation }) => calculation.grouping.adrgCode).filter(Boolean)).size,
    drgCount: new Set(grouped.map(({ calculation }) => calculation.grouping.groupCode).filter(Boolean)).size,
    mccCases: grouped.filter(({ calculation }) => calculation.grouping.complicationLevel === "MCC").length,
    ccCases: grouped.filter(({ calculation }) => calculation.grouping.complicationLevel === "CC").length,
    normalCases: rows.filter(({ calculation }) => calculation.outlierType === "NORMAL").length,
    highOutliers: rows.filter(({ calculation }) => calculation.outlierType === "HIGH").length,
    lowOutliers: rows.filter(({ calculation }) => calculation.outlierType === "LOW").length,
    groupDistribution
  };
}

function buildDrgCatalogView(input) {
  const state = normalizeState(input);
  const groups = state.groupCatalog.filter((item) => item.mode === "DRG");
  const hierarchy = [...new Map(groups.map((group) => [group.mdcCode, { code: group.mdcCode, name: group.mdcName }])).values()].filter((item) => item.code).map((mdc) => ({
    ...mdc,
    adrgs: [...new Map(groups.filter((group) => group.mdcCode === mdc.code).map((group) => [group.adrgCode, { code: group.adrgCode, name: group.adrgName }])).values()].map((adrg) => ({ ...adrg, groups: groups.filter((group) => group.adrgCode === adrg.code) }))
  }));
  return { profile: state.drg2LibraryProfile, previewRules: state.drgPreviewRules, schemeVersions: state.schemeVersions.filter((item) => item.mode === "DRG"), parameterVersions: state.parameterVersions.filter((item) => item.mode === "DRG"), hierarchy, groups };
}

function simulateDrgCase(input, payload = {}) {
  const state = normalizeState(input);
  const item = payload.caseId ? state.cases.find((row) => row.id === payload.caseId) : (payload.case || payload);
  if (!item) throw new Error("病例不存在");
  const calculation = calculateCase(state, item, "DRG");
  return { caseId: item.id || null, settlementListNo: item.settlementListNo || "", environment: "simulation", authority: "non-binding", binding: false, profileVersion: state.drg2LibraryProfile.id, calculation };
}

function buildOverview(input) {
  const state = DiseasePaymentIntake.ensureIntakeState(normalizeState(input));
  const localPackageView = LocalPaymentPackage.buildLocalPaymentPackageView(state);
  const clientState = {
    ...state,
    groupCatalog: state.groupCatalog.filter((item) => item.mode === "DRG"),
    localPaymentPackages: localPackageView.packages,
    localPaymentPackageImpactReports: localPackageView.impactReports,
    localPaymentPackageDiffReports: localPackageView.diffReports,
    localPaymentPackageActivationSnapshots: localPackageView.activationSnapshots,
    localPaymentPackageSimulationJobs: localPackageView.simulationJobs,
    specialCaseDisclosure: buildSpecialCaseDisclosure(state)
  };
  const calculated = state.cases.filter((item) => item.calculation?.ok);
  const risks = state.cases.flatMap((item) => item.calculation?.risks || []);
  const totalCost = round(state.cases.reduce((sum, item) => sum + Number(item.totalAmount || 0), 0));
  const paymentStandard = round(calculated.reduce((sum, item) => sum + Number(item.calculation.paymentStandard || 0), 0));
  const institutions = [...new Set(state.cases.map((item) => item.institution))].map((institution) => {
    const cases = state.cases.filter((item) => item.institution === institution);
    return { institution, caseCount: cases.length, totalCost: round(cases.reduce((sum, item) => sum + Number(item.totalAmount || 0), 0)), standardAmount: round(cases.reduce((sum, item) => sum + Number(item.calculation?.paymentStandard || 0), 0)), riskCount: cases.reduce((sum, item) => sum + (item.calculation?.risks?.length || 0), 0) };
  });
  const specialCapRate = state.mode === "DRG" ? 0.05 : 0.005;
  return { state: clientState, summary: { caseCount: state.cases.length, calculatedCount: calculated.length, ungroupedCount: state.cases.filter((item) => item.calculation?.grouping && !item.calculation.grouping.ok).length, totalCost, paymentStandard, projectedBalance: round(paymentStandard - totalCost), riskCount: risks.length, specialPending: state.specialCases.filter((item) => ["APPLIED", "UNDER_REVIEW"].includes(SpecialCase.specialCaseState(item))).length, specialCapRate, specialUsageRate: round(state.specialCases.filter((item) => SpecialCase.ACTIVE_STATES.has(SpecialCase.specialCaseState(item))).length / Math.max(1, state.cases.length), 4), settlementPending: state.settlementBatches.filter((item) => !["PAID", "CLOSED"].includes(Settlement.settlementState(item))).length, annualClearancePending: state.annualClearances.filter((item) => item.state !== "LOCKED").length, prepaymentPending: state.prepayments.filter((item) => item.status === "待审批").length, unpaidPending: state.unpaidItems.filter((item) => item.status !== "已支付").length, negotiationPending: state.negotiationRounds.filter((item) => item.status !== "已达成一致").length, trainingPending: state.trainings.filter((item) => item.status !== "已完成").length, intake: DiseasePaymentIntake.buildIntakeSummary(state), drg: buildDrgAnalytics(state) }, institutions };
}

module.exports = { POLICY, SETTLEMENT_ACTIONS: Settlement.ACTION_TARGETS, SETTLEMENT_LABELS: Settlement.SETTLEMENT_LABELS, SPECIAL_CASE_LABELS: SpecialCase.SPECIAL_CASE_LABELS, activateDueLocalPaymentPackages, activateLocalPaymentPackage, applyAnnualClearanceAction, applyGovernanceAction, applyInsuranceCoreSettlementCallback, buildCatalogIndexStats, buildDrgAnalytics, buildDrgCatalogView, buildLocalPaymentPackageView, buildOverview, buildParameterGovernanceView, buildSpecialCaseDisclosure, calculateAll, calculateCase, calculateFormalCase, cancelLocalPaymentPackageSimulationJob, compareLocalPaymentPackage, createAnnualClearance, createLocalPaymentPackageSimulationJob, createPaymentParameter, createSettlementBatch, createSpecialCase, drgCatalogMatch, getLocalPaymentPackageCatalogPage, getLocalPaymentPackageReport, importLocalPaymentPackage, inferDrgComplicationLevel, normalizeState, processLocalPaymentPackageSimulationJob, publishLocalPaymentPackage, publishPaymentParameter, reconcileBatch, reselectSpecialCaseExpert, retryLocalPaymentPackageSimulationJob, reviewLocalPaymentPackage, reviewPaymentParameter, reviewSpecialCase, rollbackLocalPaymentPackage, seedDiseasePaymentState, simulateDrgCase, simulateLocalPaymentPackage, simulatePaymentParameter, submitLocalPaymentPackage, submitPaymentParameter, validateCase, validateLocalPaymentPackage: LocalPaymentPackage.validateLocalPaymentPackage, verifySpecialCaseLedger: SpecialCase.verifySpecialCaseLedger };
