"use strict";

const { createClinicalDecisionSupport } = require("../clinical-decision-support");

const CENTER_SCHEMA_VERSION = "clinical-ai-cdss-governance-center-v1";
const CAPABILITY_ID = "J-CLIN-CDSS";
const UPSTREAM_GOVERNANCE_CAPABILITY_ID = "L-GOV-AI";

const CATEGORY_LABELS = Object.freeze({
  "duplicate-diagnosis": "重复诊断提醒",
  "duplicate-check": "重复检查提醒",
  "duplicate-lab": "重复检验提醒",
  "duplicate-medication": "重复用药提醒"
});

const ACTION_LABELS = Object.freeze({
  "accepted-recommendation": "已采纳建议",
  "adjusted-prescription": "已调整处方",
  "cited-existing-diagnosis": "已引用既往诊断",
  acknowledged: "已确认提醒",
  pending: "待人工复核",
  rejected: "未采纳并登记理由"
});

const CONTRACT_LABELS = Object.freeze({
  "p2ca-plugin-workstation": "医生工作站提醒协议",
  "p2ca-plugin-receipt": "人工复核回执协议",
  "p2ca-plugin-rule-config": "规则配置与审批协议"
});

const HUMAN_DECISION_ACTIONS = new Set([
  "accepted-recommendation",
  "adjusted-prescription",
  "cited-existing-diagnosis",
  "acknowledged",
  "rejected", "cited-existing-report", "dismissed-with-reason", "dismissed", "ignored",
  "retained-with-reason", "keep-with-reason", "kept-order-with-reason"
]);

class ClinicalAiCdssGovernanceError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = "ClinicalAiCdssGovernanceError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function boundedText(value, max = 240) {
  return String(value ?? "").trim().slice(0, max);
}

function firstText(...values) {
  for (const value of values) {
    const normalized = boundedText(value);
    if (normalized) return normalized;
  }
  return "";
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function actorScope(actor = {}) {
  const role = boundedText(actor.role, 40).toLowerCase();
  if (!new Set(["commission", "institution"]).has(role)) {
    throw new ClinicalAiCdssGovernanceError(
      "CLINICAL_AI_CDSS_ROLE_FORBIDDEN",
      "当前账号无权访问临床决策支持安全治理中心",
      403
    );
  }
  const organizationCode = firstText(actor.orgCode, actor.institutionCode, actor.organizationCode);
  const organizationName = firstText(actor.orgName, actor.institutionName, actor.organization);
  const doctorId = firstText(actor.doctorId);
  if (role === "institution" && !organizationCode) {
    throw new ClinicalAiCdssGovernanceError(
      "CLINICAL_AI_CDSS_SCOPE_REQUIRED",
      "医疗机构账号必须绑定可信机构代码",
      403
    );
  }
  return Object.freeze({
    role,
    organizationCode: role === "commission" ? "cross-organization" : organizationCode,
    organizationName,
    doctorId,
    crossInstitutionVisible: role === "commission",
    clinicalDetailVisible: role === "institution",
    doctorBound: Boolean(doctorId)
  });
}

function alertMatchesScope(alert = {}, scope = {}) {
  if (scope.role === "commission") return true;
  if (scope.doctorId) return boundedText(alert.doctorId) === scope.doctorId;
  const alertCode = firstText(alert.institutionCode, alert.orgCode, alert.sourceInstitutionCode);
  if (alertCode) return alertCode === scope.organizationCode;
  const alertName = firstText(alert.institution, alert.institutionName, alert.sourceInstitution);
  return Boolean(scope.organizationName && alertName === scope.organizationName);
}

function humanDecisionValue(value) {
  return HUMAN_DECISION_ACTIONS.has(boundedText(value, 100).toLowerCase());
}

function publicResidentReference(value) {
  const normalized = boundedText(value, 160);
  if (!normalized) return "未绑定居民引用";
  const visible = normalized.slice(-4);
  return `居民引用末${visible.length}位 ${visible}`;
}

function rulePolicy(rule, ports = {}) {
  if (!rule) return { status: "missing", decisionAvailable: false };
  if (!rule.governance) return { status: "legacy", decisionAvailable: true };
  try {
    const policy = ports.rulePolicy?.(rule);
    return { status: policy?.status || "unverified", decisionAvailable: policy?.decisionAvailable === true };
  } catch { return { status: "unverified", decisionAvailable: false }; }
}

function projectRule(rule = {}, ports = {}) {
  const policy = rulePolicy(rule, ports);
  const category = boundedText(rule.category, 80);
  const status = boundedText(rule.configStatus, 80).toLowerCase() || "unconfigured";
  const version = firstText(rule.version, rule.ruleVersion);
  const riskLevel = boundedText(rule.severity, 40).toLowerCase() || "medium";
  const findings = [];
  if (!version) findings.push("缺少可追溯规则版本");
  if (!firstText(rule.approvedAt, rule.approvalEvidenceRef)) findings.push("缺少独立审批证据");
  if (!firstText(rule.validationEvidenceRef, rule.validatedPopulation)) findings.push("缺少临床验证与适用人群证据");
  if (status !== "active") findings.push("规则未处于受控启用状态");
  if (!policy.decisionAvailable) findings.push("规则治理未批准或来源已漂移，建议不可采纳");
  return Object.freeze({
    id: boundedText(rule.id, 160),
    name: firstText(rule.name, CATEGORY_LABELS[category], "未命名临床规则"),
    category,
    categoryLabel: CATEGORY_LABELS[category] || "临床风险提醒",
    algorithmClass: "deterministic-rules-engine",
    sourceSystem: firstText(rule.sourceSystem, "临床业务系统"),
    version: version || "待建立版本基线",
    lifecycleStatus: findings.length ? "restricted-pilot" : "governed-active",
    configurationStatus: status,
    riskLevel,
    intendedUse: firstText(rule.triggerCondition, "在诊疗工作流中向临床人员提示需要复核的风险"),
    recommendedReview: policy.decisionAvailable ? firstText(rule.defaultAction, "由临床人员核对证据并作出独立判断") : "",
    governanceStatus: policy.status,
    decisionAvailable: policy.decisionAvailable,
    requiredEvidenceFields: Object.freeze(asArray(rule.requiredFields).map((item) => boundedText(item, 80)).filter(Boolean)),
    accountableRole: "临床业务与医疗质量联合责任人",
    humanReviewRequired: true,
    autoExecutionAllowed: false,
    prohibitedUses: Object.freeze([
      "不得自动形成诊断结论",
      "不得自动开立或取消医嘱与处方",
      "不得替代临床人员知情复核",
      "不得以仓库演示结果作为生产放行依据"
    ]),
    governanceFindings: Object.freeze(findings)
  });
}

function projectSuggestion(alert = {}, scope = {}, policy = { status: "unverified", decisionAvailable: false }) {
  const category = boundedText(alert.category, 80);
  const doctorAction = boundedText(alert.doctorAction, 100).toLowerCase() || "pending";
  const reviewStatus = humanDecisionValue(doctorAction) ? "reviewed" : "pending-human-review";
  return Object.freeze({
    id: boundedText(alert.id, 160),
    ruleId: boundedText(alert.ruleId, 160),
    category,
    categoryLabel: CATEGORY_LABELS[category] || "临床风险提醒",
    title: scope.clinicalDetailVisible ? firstText(alert.alertTitle, CATEGORY_LABELS[category]) : (CATEGORY_LABELS[category] || "临床风险提醒"),
    riskLevel: boundedText(alert.severity, 40).toLowerCase() || "medium",
    institutionReference: scope.crossInstitutionVisible ? "跨机构治理汇总" : scope.organizationCode,
    residentReference: scope.clinicalDetailVisible ? publicResidentReference(alert.residentId) : "",
    practitionerReference: scope.clinicalDetailVisible ? boundedText(alert.doctorId, 120) : "",
    evidenceBound: Boolean(firstText(alert.linkedEvidenceId)),
    evidenceReference: scope.clinicalDetailVisible ? boundedText(alert.linkedEvidenceId, 160) : "",
    recommendation: scope.clinicalDetailVisible && policy.decisionAvailable ? boundedText(alert.recommendation, 400) : "",
    governanceStatus: policy.status,
    decisionAvailable: policy.decisionAvailable,
    version: Number.isSafeInteger(alert.version) ? alert.version : 0,
    pluginSurface: boundedText(alert.pluginSurface, 120),
    dueAt: boundedText(alert.dueAt, 80),
    reviewStatus,
    doctorAction,
    doctorActionLabel: ACTION_LABELS[doctorAction] || (reviewStatus === "reviewed" ? "已完成人工复核" : "待人工复核"),
    humanReviewRequired: true,
    autoExecutionAllowed: false,
    actions: Object.freeze({
      submitReview: scope.role === "institution" && reviewStatus === "pending-human-review",
      reviewEndpoint: scope.role === "institution" ? `POST /api/phase2/clinical-assist/alerts/${boundedText(alert.id, 160)}/receipt` : ""
    })
  });
}

function projectReview(receipt = {}, suggestionById = new Map(), scope = {}) {
  const suggestion = suggestionById.get(boundedText(receipt.alertId, 160));
  const doctorAction = boundedText(receipt.doctorAction, 100).toLowerCase() || "pending";
  return Object.freeze({
    id: boundedText(receipt.id, 160),
    suggestionId: boundedText(receipt.alertId, 160),
    categoryLabel: suggestion?.categoryLabel || "临床风险提醒",
    receiptStatus: boundedText(receipt.receiptStatus, 80).toLowerCase() || "unknown",
    doctorAction,
    doctorActionLabel: ACTION_LABELS[doctorAction] || "处理状态待核验",
    practitionerReference: scope.clinicalDetailVisible ? boundedText(receipt.doctorId, 120) : "",
    actionDetail: scope.clinicalDetailVisible ? boundedText(receipt.actionDetail, 400) : "",
    reviewedAt: boundedText(receipt.receivedAt, 80),
    channel: boundedText(receipt.messageChannel, 120),
    auditDigestPresent: /^sha256:/i.test(boundedText(receipt.auditHash, 160)),
    humanDecisionRecorded: humanDecisionValue(doctorAction)
  });
}

function projectContract(contract = {}) {
  const id = boundedText(contract.id, 160);
  return Object.freeze({
    id,
    name: CONTRACT_LABELS[id] || "临床决策支持集成协议",
    endpoint: boundedText(contract.endpoint, 200),
    surface: boundedText(contract.surface, 120),
    payloadFields: Object.freeze(asArray(contract.payloadFields).map((item) => boundedText(item, 80)).filter(Boolean)),
    repositoryStatus: boundedText(contract.status, 80) || "declared",
    productionStatus: "external-evidence-required",
    blocker: "真实临床系统接入、身份映射、签名回执与现场联合验收待完成"
  });
}

function buildMonitoring(ruleCards, suggestions, reviews, source) {
  const ruleIds = new Set(ruleCards.map((item) => item.id));
  const suggestionIds = new Set(suggestions.map((item) => item.id));
  const signals = [];
  for (const rule of ruleCards) {
    if (rule.governanceFindings.length) signals.push(Object.freeze({
      id: `rule-governance-${rule.id}`,
      type: "model-governance-gap",
      severity: rule.riskLevel === "high" ? "high" : "medium",
      subjectReference: rule.id,
      status: "open",
      detail: rule.governanceFindings.join("；")
    }));
  }
  for (const alert of source.alerts) {
    if (suggestions.some((item) => item.id === boundedText(alert.id, 160)) && !ruleIds.has(boundedText(alert.ruleId, 160))) {
      signals.push(Object.freeze({ id: `orphan-suggestion-${boundedText(alert.id, 160)}`, type: "evidence-lineage-gap", severity: "high", subjectReference: boundedText(alert.id, 160), status: "open", detail: "临床建议未绑定已登记规则" }));
    }
  }
  for (const receipt of source.receipts) {
    if (!suggestionIds.has(boundedText(receipt.alertId, 160))) {
      signals.push(Object.freeze({ id: `orphan-review-${boundedText(receipt.id, 160)}`, type: "review-lineage-gap", severity: "medium", subjectReference: boundedText(receipt.id, 160), status: "open", detail: "人工复核回执未绑定当前授权范围内建议" }));
    }
  }
  const pending = suggestions.filter((item) => item.reviewStatus === "pending-human-review").length;
  if (pending) signals.push(Object.freeze({ id: "pending-human-review-backlog", type: "human-review-backlog", severity: "medium", subjectReference: "authorized-scope", status: "monitoring", detail: `${pending} 条建议等待临床人员复核` }));
  const reviewedSuggestionIds = new Set(reviews.filter((item) => item.humanDecisionRecorded).map((item) => item.suggestionId));
  return Object.freeze({
    telemetryAvailable: false,
    outcomeDriftEvaluated: false,
    incidentWorkflowAvailable: false,
    humanReviewCoverage: suggestions.length ? Number(((reviewedSuggestionIds.size / suggestions.length) * 100).toFixed(1)) : 100,
    signals: Object.freeze(signals),
    blockers: Object.freeze([
      "缺少经审批的基线样本、效果指标和分层阈值，暂不能计算临床效果漂移",
      "缺少生产级模型/规则注册、变更签名和回滚演练证据",
      "缺少不良事件上报、医学复核和独立安全评价闭环"
    ])
  });
}

function buildClinicalAiCdssGovernanceCenter(data = {}, actor = {}, ports = {}) {
  const scope = actorScope(actor);
  const canAccess = ports.canAccessAlert || createClinicalDecisionSupport({}).canAccessAlert;
  if (scope.role === "institution" && !canAccess(actor, { orgCode: actor.orgCode || actor.institutionCode, doctorId: actor.doctorId }, data)) {
    throw new ClinicalAiCdssGovernanceError("CLINICAL_AI_CDSS_SCOPE_REQUIRED", "可信机构或医生范围无效", 403);
  }
  const source = {
    rules: asArray(data.phase2ClinicalAssistRules),
    alerts: asArray(data.phase2ClinicalAssistAlerts).filter((item) => canAccess(actor, item, data)),
    receipts: asArray(data.phase2ClinicalAssistReceipts),
    contracts: asArray(data.phase2ClinicalAssistPluginContracts)
  };
  const ruleCards = Object.freeze(source.rules.map((rule) => projectRule(rule, ports)));
  const suggestions = Object.freeze(source.alerts.map((item) => projectSuggestion(item, scope, rulePolicy(source.rules.find((rule) => rule.id === item.ruleId), ports))));
  const suggestionById = new Map(suggestions.map((item) => [item.id, item]));
  const visibleReceipts = source.receipts.filter((item) => suggestionById.has(boundedText(item.alertId, 160)));
  const reviewLedger = Object.freeze(visibleReceipts.map((item) => projectReview(item, suggestionById, scope)));
  const integrationContracts = Object.freeze(source.contracts.map(projectContract));
  const monitoring = buildMonitoring(ruleCards, suggestions, reviewLedger, { ...source, receipts: visibleReceipts });
  const pending = suggestions.filter((item) => item.reviewStatus === "pending-human-review").length;
  const reviewed = suggestions.length - pending;
  return Object.freeze({
    schemaVersion: CENTER_SCHEMA_VERSION,
    sourceRequirement: CAPABILITY_ID,
    upstreamGovernanceRequirement: Object.freeze({
      id: UPSTREAM_GOVERNANCE_CAPABILITY_ID,
      status: "declared-only",
      ownerProcess: "T01",
      note: "本中心仅实现临床侧安全治理投影，不代替平台级人工智能治理能力。"
    }),
    productionReady: false,
    decision: "NO-GO",
    scope,
    actions: Object.freeze({
      queryGovernance: true,
      viewClinicalRecommendation: scope.clinicalDetailVisible,
      submitHumanReview: scope.role === "institution",
      configureRules: scope.role === "commission",
      automaticDiagnosis: false,
      automaticOrder: false,
      automaticPrescription: false,
      productionActivation: false
    }),
    summary: Object.freeze({
      rules: ruleCards.length,
      governedRules: ruleCards.filter((item) => item.lifecycleStatus === "governed-active").length,
      restrictedRules: ruleCards.filter((item) => item.lifecycleStatus !== "governed-active").length,
      suggestions: suggestions.length,
      pendingHumanReview: pending,
      reviewed,
      evidenceBound: suggestions.filter((item) => item.evidenceBound).length,
      reviewReceipts: reviewLedger.length,
      openGovernanceSignals: monitoring.signals.filter((item) => item.status !== "closed").length,
      integrationContracts: integrationContracts.length
    }),
    ruleCards,
    suggestions,
    reviewLedger,
    monitoring,
    integrationContracts,
    safetyBoundaries: Object.freeze([
      "所有输出均为临床人员复核建议，不构成诊断或治疗决定",
      "建议必须展示规则来源、证据绑定和人工处理状态",
      "缺少可信机构范围、规则版本、审批或验证证据时失败关闭",
      "仓库验证不能替代临床验证、伦理审查、厂商联调和现场签字"
    ]),
    blockers: Object.freeze([
      "真实 HIS/EMR/LIS/PACS 工作站嵌入、单点登录和医嘱上下文仍需现场联调",
      "临床规则版本、适用人群、审批记录、灰度与回滚证据尚未形成可信外部闭环",
      "效果漂移、不良事件、偏差与公平性监测尚无生产数据和独立医学评估",
      "平台级人工智能治理能力 L-GOV-AI 仍由 T01 后续建设"
    ])
  });
}

module.exports = {
  CAPABILITY_ID,
  CENTER_SCHEMA_VERSION,
  ClinicalAiCdssGovernanceError,
  UPSTREAM_GOVERNANCE_CAPABILITY_ID,
  actorScope,
  alertMatchesScope,
  buildClinicalAiCdssGovernanceCenter,
  projectRule,
  projectSuggestion
};
