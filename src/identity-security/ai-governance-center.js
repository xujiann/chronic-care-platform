"use strict";

const CENTER_SCHEMA_VERSION = "platform-ai-governance-center-v1";
const CAPABILITY_ID = "L-GOV-AI";

const USE_CASE_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: "clinical-decision-support",
    title: "临床决策支持",
    capabilityId: "J-CLIN-CDSS",
    ownerProcess: "T06",
    ownerDomain: "clinical-specialties",
    riskLevel: "critical",
    lifecycleStatus: "restricted-pilot",
    intendedUse: "向临床人员提示需要核对的重复诊断、检查、检验和用药风险",
    decisionImpact: "影响诊疗判断，必须由具备资质的临床人员独立复核",
    targetPage: "clinical-ai-cdss.html",
    sources: Object.freeze([
      Object.freeze({ collection: "phase2ClinicalAssistRules", dataOwner: "clinical-specialties", access: "approved-read", kind: "rules" }),
      Object.freeze({ collection: "phase2ClinicalAssistAlerts", dataOwner: "clinical-specialties", access: "approved-read", kind: "alerts" }),
      Object.freeze({ collection: "phase2ClinicalAssistReceipts", dataOwner: "clinical-specialties", access: "approved-read", kind: "receipts" })
    ])
  }),
  Object.freeze({
    id: "research-risk-models",
    title: "科研专病风险模型",
    capabilityId: "research-disease-models",
    ownerProcess: "T09",
    ownerDomain: "research",
    riskLevel: "high",
    lifecycleStatus: "registry-only",
    intendedUse: "在伦理、授权和脱敏边界内管理专病模型版本、适用人群与研究输出",
    decisionImpact: "仅用于科研队列和人工研究复核，不得直接进入临床诊疗",
    targetPage: "research-sandbox.html",
    sources: Object.freeze([
      Object.freeze({ collection: "diseaseRegistryModels", dataOwner: "research", access: "approved-read", kind: "models" }),
      Object.freeze({ collection: "chronicModelGovernance", dataOwner: "unresolved", access: "owner-handoff-required", kind: "governance" })
    ])
  }),
  Object.freeze({
    id: "public-health-investigation-assist",
    title: "公共卫生研判辅助",
    capabilityId: "public-health-ai-review",
    ownerProcess: "T03",
    ownerDomain: "public-health",
    riskLevel: "high",
    lifecycleStatus: "source-binding-pending",
    intendedUse: "辅助工作人员识别需要人工核查的公共卫生信号和证据线索",
    decisionImpact: "不得自动发布信息、替代流调结论或自动升级重大事件",
    targetPage: "public-health-highlights.html",
    sources: Object.freeze([
      Object.freeze({ collection: "publicHealthAiReviews", dataOwner: "unresolved", access: "owner-handoff-required", kind: "reviews" })
    ])
  }),
  Object.freeze({
    id: "primary-care-decision-assist",
    title: "基层诊疗辅助",
    capabilityId: "primary-care-ai-assist",
    ownerProcess: "T05",
    ownerDomain: "care-coordination",
    riskLevel: "critical",
    lifecycleStatus: "source-binding-pending",
    intendedUse: "为基层临床人员提供风险线索和检查建议的人工复核入口",
    decisionImpact: "不得自动形成诊断、处方、医嘱、转诊或质量结论",
    targetPage: "county.html",
    sources: Object.freeze([
      Object.freeze({ collection: "countyAiDiagnosisCases", dataOwner: "unresolved", access: "owner-handoff-required", kind: "cases" })
    ])
  })
]);

class AiGovernanceCenterError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = "AiGovernanceCenterError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function asArray(value, collection) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new AiGovernanceCenterError(
      "AI_GOVERNANCE_SOURCE_INVALID",
      `人工智能治理来源 ${collection} 的结构无效`,
      503
    );
  }
  return value;
}

function requireScope(actor = {}) {
  if (String(actor.role || "").trim().toLowerCase() !== "commission") {
    throw new AiGovernanceCenterError(
      "AI_GOVERNANCE_ROLE_FORBIDDEN",
      "当前账号无权访问平台人工智能治理中心",
      403
    );
  }
  return Object.freeze({
    role: "commission",
    dataScope: "cross-domain-governance-metadata",
    personalDataVisible: false,
    clinicalContentVisible: false,
    sourceRecordDetailVisible: false
  });
}

function sourceObservation(data, source) {
  if (source.access !== "approved-read") {
    return Object.freeze({
      collection: source.collection,
      dataOwner: source.dataOwner,
      access: source.access,
      recordCount: null,
      detailRead: false,
      status: "owner-handoff-required"
    });
  }
  const records = asArray(data[source.collection], source.collection);
  const versioned = source.kind === "models"
    ? records.filter((item) => String(item?.version || "").trim()).length
    : source.kind === "rules"
      ? records.filter((item) => String(item?.version || item?.ruleVersion || "").trim()).length
      : 0;
  const reviewed = source.kind === "receipts"
    ? records.filter((item) => String(item?.doctorAction || "").trim() && String(item?.doctorAction || "").trim() !== "pending").length
    : source.kind === "models"
      ? records.filter((item) => String(item?.reviewStatus || "").trim() && String(item?.reviewer || "").trim()).length
      : 0;
  return Object.freeze({
    collection: source.collection,
    dataOwner: source.dataOwner,
    access: source.access,
    recordCount: records.length,
    versionedRecords: versioned,
    reviewedRecords: reviewed,
    detailRead: false,
    status: records.length ? "repository-observed" : "source-empty"
  });
}

function buildUseCase(data, definition) {
  const sources = Object.freeze(definition.sources.map((source) => sourceObservation(data, source)));
  const observedRecords = sources.reduce((total, source) => total + (Number.isInteger(source.recordCount) ? source.recordCount : 0), 0);
  const pendingOwnership = sources.filter((source) => source.access !== "approved-read").length;
  const findings = [];
  if (pendingOwnership) findings.push(`${pendingOwnership} 个来源尚未完成数据 Owner 授权接线`);
  if (sources.some((source) => source.status === "source-empty")) findings.push("已授权来源当前没有可核验记录");
  if (definition.id === "clinical-decision-support" && sources.find((source) => source.collection === "phase2ClinicalAssistRules")?.versionedRecords === 0) {
    findings.push("临床规则缺少可追溯版本基线");
  }
  findings.push("缺少独立验证、效果基线和生产现场签字");
  findings.push("缺少分层漂移、偏差、公平性和不良事件生产监测");
  return Object.freeze({
    id: definition.id,
    title: definition.title,
    capabilityId: definition.capabilityId,
    ownerProcess: definition.ownerProcess,
    ownerDomain: definition.ownerDomain,
    riskLevel: definition.riskLevel,
    lifecycleStatus: definition.lifecycleStatus,
    intendedUse: definition.intendedUse,
    decisionImpact: definition.decisionImpact,
    targetPage: definition.targetPage,
    observedRecords,
    sourceBindings: sources,
    humanOversightRequired: true,
    automaticDecisionAllowed: false,
    productionEligible: false,
    governanceFindings: Object.freeze(findings)
  });
}

function buildControlMatrix(useCases) {
  const authorized = useCases.flatMap((item) => item.sourceBindings).filter((item) => item.access === "approved-read").length;
  const pending = useCases.flatMap((item) => item.sourceBindings).filter((item) => item.access !== "approved-read").length;
  return Object.freeze([
    Object.freeze({ id: "inventory-accountability", name: "场景清单与责任归属", status: pending ? "partial" : "controlled", evidence: `${useCases.length} 个场景；${authorized} 个来源已授权；${pending} 个来源待 Owner 接线`, blocker: pending ? "来源责任和跨域读取授权未全部闭合" : "" }),
    Object.freeze({ id: "intended-use", name: "预期用途与禁用边界", status: "repository-controlled", evidence: "所有场景均声明用途、决策影响、人工监督和禁止自动决策", blocker: "外部业务、医学、伦理和安全签字待完成" }),
    Object.freeze({ id: "data-governance", name: "数据治理与最小必要", status: "partial", evidence: "中心只输出跨域治理元数据，不返回居民、机构、临床正文或源记录明细", blocker: "生产数据授权、质量、代表性、脱敏与留存证据待完成" }),
    Object.freeze({ id: "validation", name: "独立验证与效果评估", status: "blocked", evidence: "仓库只验证接口、投影与安全边界", blocker: "缺少基线样本、分层阈值、临床/业务有效性和独立评估" }),
    Object.freeze({ id: "human-oversight", name: "人工监督与可追责", status: "partial", evidence: "所有高风险场景强制人工复核且禁止自动执行", blocker: "真实身份、电子签名、跨实例回执和复核时效证据待完成" }),
    Object.freeze({ id: "monitoring", name: "漂移、偏差与公平性监测", status: "blocked", evidence: "已登记监测要求和失败关闭边界", blocker: "缺少生产基线、分层观测指标和可信告警回执" }),
    Object.freeze({ id: "incident-response", name: "事件响应、暂停与回滚", status: "blocked", evidence: "生产激活固定禁用", blocker: "缺少 AI 不良事件分级、暂停、召回、回滚和复盘流程" }),
    Object.freeze({ id: "release-approval", name: "上线审批与持续复核", status: "blocked", evidence: "平台决策固定 NO-GO", blocker: "缺少责任方独立签字、现场验收和持续复审证据" })
  ]);
}

function buildRiskRegister(useCases) {
  const risks = [];
  for (const useCase of useCases) {
    if (useCase.sourceBindings.some((source) => source.access !== "approved-read")) {
      risks.push(Object.freeze({ id: `${useCase.id}-owner-binding`, useCaseId: useCase.id, title: "来源 Owner 接线未闭合", severity: "high", status: "open", responsibleProcess: useCase.ownerProcess, nextAction: "由业务域确认数据 Owner、最小投影和版本化只读合同" }));
    }
    risks.push(Object.freeze({ id: `${useCase.id}-validation`, useCaseId: useCase.id, title: "独立验证与漂移证据缺失", severity: useCase.riskLevel, status: "open", responsibleProcess: useCase.ownerProcess, nextAction: "补齐适用人群、效果基线、分层阈值、偏差与不良事件证据" }));
  }
  risks.push(Object.freeze({ id: "platform-ai-incident-workflow", useCaseId: "cross-domain", title: "平台级 AI 事件处置流程未现场验证", severity: "critical", status: "open", responsibleProcess: "T01", nextAction: "建立报告、分级、暂停、回滚、通知、复盘和持续复审的现场签收闭环" }));
  return Object.freeze(risks);
}

function buildAiGovernanceCenter(data = {}, actor = {}) {
  const scope = requireScope(actor);
  const useCases = Object.freeze(USE_CASE_DEFINITIONS.map((definition) => buildUseCase(data, definition)));
  const controls = buildControlMatrix(useCases);
  const risks = buildRiskRegister(useCases);
  const sourceBindings = useCases.flatMap((item) => item.sourceBindings);
  return Object.freeze({
    schemaVersion: CENTER_SCHEMA_VERSION,
    capabilityId: CAPABILITY_ID,
    productionReady: false,
    decision: "NO-GO",
    scope,
    actions: Object.freeze({
      queryGovernance: true,
      viewSourceRecordDetail: false,
      approveModel: false,
      activateModel: false,
      automaticDiagnosis: false,
      automaticOrder: false,
      automaticPrescription: false,
      automaticPublicHealthDecision: false,
      productionActivation: false
    }),
    summary: Object.freeze({
      useCases: useCases.length,
      criticalRiskUseCases: useCases.filter((item) => item.riskLevel === "critical").length,
      highOrCriticalRiskUseCases: useCases.filter((item) => new Set(["high", "critical"]).has(item.riskLevel)).length,
      authorizedSourceBindings: sourceBindings.filter((item) => item.access === "approved-read").length,
      pendingOwnerBindings: sourceBindings.filter((item) => item.access !== "approved-read").length,
      observedRecords: useCases.reduce((total, item) => total + item.observedRecords, 0),
      controls: controls.length,
      blockedControls: controls.filter((item) => item.status === "blocked").length,
      openRisks: risks.length,
      productionEligibleUseCases: 0
    }),
    useCases,
    controls,
    risks,
    safetyBoundaries: Object.freeze([
      "平台治理中心仅汇总场景、责任、来源状态和控制证据，不读取未获 Owner 授权的业务集合",
      "页面不得展示居民、患者、机构、医生、临床建议正文或源记录明细",
      "所有高风险输出必须由具备职责和资质的人员独立复核并可追责",
      "不得自动形成诊断、医嘱、处方、疫情发布、转诊、支付或生产放行决定",
      "仓库测试和演示记录不能替代医学验证、伦理审查、安全评估和现场签字"
    ]),
    blockers: Object.freeze([
      "公共卫生和基层辅助来源尚未完成数据 Owner、最小投影与跨域只读合同",
      "四类场景均缺少可信独立验证、效果基线、分层漂移和公平性生产证据",
      "真实身份、电子签名、模型/规则制品签名、变更审批、暂停与回滚流程尚未闭合",
      "AI 不良事件上报、责任通知、复盘和持续复审仍需业务、医学、伦理、安全与运维共同签收"
    ])
  });
}

module.exports = {
  CAPABILITY_ID,
  CENTER_SCHEMA_VERSION,
  USE_CASE_DEFINITIONS,
  AiGovernanceCenterError,
  buildAiGovernanceCenter,
  buildControlMatrix,
  buildRiskRegister,
  requireScope
};
