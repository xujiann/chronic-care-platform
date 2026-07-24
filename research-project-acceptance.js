"use strict";

const { createHash } = require("node:crypto");

const PROJECT = Object.freeze({
  id: "042020604",
  name: "数智医院新标准平台设计与标准平台的关键技术研究",
  leadInstitution: "大连医科大学附属第二医院",
  period: "2026-08/2027-07",
  budgetWan: 60,
  deepPilotTarget: 1,
  extensionPilotTarget: 2,
  boundary: "平台仅管理汇总指标、脱敏证据引用和摘要哈希；真实业务数据须经医院授权、伦理和安全审查。"
});

const DOMAINS = Object.freeze([
  { id: "governance", name: "治理与标准" },
  { id: "service", name: "医疗服务与体验" },
  { id: "quality", name: "临床质量与安全" },
  { id: "public-health", name: "公共卫生与区域协同" },
  { id: "operations", name: "运营与资源效率" },
  { id: "data-security", name: "数据治理与安全" }
]);

const REQUIREMENTS = Object.freeze([
  {
    id: "REQ-01",
    name: "国家—省—医疗机构三级评价架构",
    target: "贯通标准发布、地方适配、医院自评、分级审核、结果应用和持续改进。",
    domains: ["governance"],
    platformModules: ["digital-hospital-standards.html", "digital-hospital-self-assessment.html", "digital-hospital-evaluation.html"],
    apiRefs: ["/api/digital-hospital/standards", "/api/digital-hospital/self-assessments", "/api/digital-hospital/pilot-readiness"],
    acceptanceItemIds: ["architecture-three-tier", "report-comprehensive"]
  },
  {
    id: "REQ-02",
    name: "六域指标与标准资产模型",
    target: "建立标准条款—评价指标—数据元—证据项—评分规则—整改措施六级映射。",
    domains: DOMAINS.map((item) => item.id),
    platformModules: ["digital-hospital-standards.js", "platform-standards-ledgers.js", "digital-hospital-governance.js"],
    apiRefs: ["/api/platform/standards-ledgers", "/api/digital-hospital/control-matrix"],
    acceptanceItemIds: ["six-domain-index", "indicator-dictionary"]
  },
  {
    id: "REQ-03",
    name: "评价数据采集、核验与证据链",
    target: "支持多源采集、质量校验、证据哈希、版本、提交、审核、退回和更正留痕。",
    domains: ["data-security", "quality", "operations"],
    platformModules: ["digital-hospital-evaluation.js", "secure-object-storage.js", "scripts/data-quality-report.js"],
    apiRefs: ["/api/digital-hospital/collection-jobs", "/api/digital-hospital/evaluation-evidence"],
    acceptanceItemIds: ["evidence-catalog-rules", "metric-data-completeness", "metric-evidence-traceability"]
  },
  {
    id: "REQ-04",
    name: "功能评价与分级审核流程",
    target: "实现医院自评、系统预审、专家复核、省级审核、抽查反馈和整改复测。",
    domains: ["governance", "quality"],
    platformModules: ["digital-hospital-self-assessment.js", "digital-hospital-evaluation.js", "pilot-acceptance.js"],
    apiRefs: ["/api/digital-hospital/pre-assessments", "/api/pilot-acceptance/center"],
    acceptanceItemIds: ["scoring-review-rules", "metric-core-flow-pass", "metric-rectification-closure"]
  },
  {
    id: "REQ-05",
    name: "标准平台关键技术",
    target: "验证规则引擎、多机构隔离、最小权限、国产数据库适配、监测、备份和恢复。",
    domains: ["data-security", "operations"],
    platformModules: ["server.js", "postgres-production-adapter.js", "production-security-acceptance.js"],
    apiRefs: ["/api/platform/capability-map", "/api/production/go-no-go"],
    acceptanceItemIds: ["prototype-test-pack", "implementation-plan"]
  },
  {
    id: "REQ-06",
    name: "长效运行与试点推广机制",
    target: "形成年度复审、变更影响分析、深度试点、扩展验证、统计评价和推广模板。",
    domains: ["governance", "service", "operations"],
    platformModules: ["digital-hospital-governance.js", "digital-hospital-evaluation.js", "platform-capability-operations.js"],
    apiRefs: ["/api/digital-hospital/pilot-institutions", "/api/digital-hospital/policy-register"],
    acceptanceItemIds: [
      "report-detailed",
      "metric-expert-rounds",
      "metric-expert-response",
      "metric-ahp-consistency",
      "metric-content-validity",
      "metric-rater-consistency",
      "metric-deep-pilots",
      "metric-extension-pilots"
    ]
  }
]);

const ITEM_DEFINITIONS = Object.freeze([
  ["report-comprehensive", "deliverable", "《数智医院新标准平台设计与关键技术综合研究报告》", "第五阶段", "", "", "", "docs/项目综合研究报告.md"],
  ["report-detailed", "deliverable", "《数智医院新标准评价体系、数据核验与试点验证详细研究报告》", "第五阶段", "", "", "", "docs/项目详细研究报告.md"],
  ["implementation-plan", "deliverable", "《适配数智医院新标准的平台落地实施工作方案》", "第五阶段", "", "", "", "docs/平台落地实施工作方案.md"],
  ["architecture-three-tier", "supporting", "国家—省—医疗机构三级业务架构", "第一阶段", "", "", "", "digital-hospital-standards.html"],
  ["six-domain-index", "supporting", "六域指标体系", "第二阶段", "", "", "", "docs/数智医院六域规范控制矩阵-2026.md"],
  ["indicator-dictionary", "supporting", "指标字典与六级追溯矩阵", "第二阶段", "", "", "", "platform-standards-ledgers.js"],
  ["evidence-catalog-rules", "supporting", "证据目录、数据质量和安全管理规则", "第二阶段", "", "", "", "digital-hospital-evaluation.js"],
  ["scoring-review-rules", "supporting", "评分、专家复核与分级审核规则", "第二阶段", "", "", "", "digital-hospital-self-assessment.js"],
  ["prototype-test-pack", "supporting", "可运行原型、测试报告、操作手册和演示材料", "第五阶段", "", "", "", "scripts/release-report.js"],
  ["metric-expert-rounds", "metric", "专家咨询轮次", "第二阶段", ">=", 2, "轮"],
  ["metric-expert-response", "metric", "专家积极系数", "第二阶段", ">=", 80, "%"],
  ["metric-ahp-consistency", "metric", "层次分析判断矩阵一致性比率 CR", "第二阶段", "<", 0.1, ""],
  ["metric-content-validity", "metric", "核心指标内容效度 I-CVI", "第二阶段", ">=", 0.78, ""],
  ["metric-rater-consistency", "metric", "评价者间一致性 Kappa/ICC", "第四阶段", ">=", 0.75, ""],
  ["metric-data-completeness", "metric", "试点关键数据完整率", "第三阶段", ">=", 95, "%"],
  ["metric-evidence-traceability", "metric", "评价证据可追溯率", "第三阶段", ">=", 95, "%"],
  ["metric-rectification-closure", "metric", "试点问题整改闭环率", "第四阶段", ">=", 90, "%"],
  ["metric-core-flow-pass", "metric", "平台核心流程通过率", "第五阶段", "=", 100, "%"],
  ["metric-deep-pilots", "metric", "三甲综合医院深度验证", "第三阶段", ">=", 1, "家"],
  ["metric-extension-pilots", "metric", "不同类型医疗机构扩展验证", "第四阶段", ">=", 2, "家"]
].map(([id, type, name, milestone, comparator, targetValue, unit, platformEvidenceRef]) => ({
  id,
  type,
  name,
  milestone,
  comparator,
  targetValue,
  unit,
  platformEvidenceRef,
  required: true
})));

const MILESTONES = Object.freeze([
  { id: "phase-1", name: "第一阶段：标准梳理与三级架构", window: "2026-08/2026-09", requiredItemIds: ["architecture-three-tier"] },
  { id: "phase-2", name: "第二阶段：六域指标、专家咨询与平台适配", window: "2026-10/2026-12", requiredItemIds: ["six-domain-index", "indicator-dictionary", "evidence-catalog-rules", "scoring-review-rules", "metric-expert-rounds", "metric-expert-response", "metric-ahp-consistency", "metric-content-validity"] },
  { id: "phase-3", name: "第三阶段：二院深度试点", window: "2027-01/2027-03", requiredItemIds: ["metric-data-completeness", "metric-evidence-traceability", "metric-deep-pilots"] },
  { id: "phase-4", name: "第四阶段：扩展试点与一致性分析", window: "2027-04/2027-05", requiredItemIds: ["metric-rater-consistency", "metric-rectification-closure", "metric-extension-pilots"] },
  { id: "phase-5", name: "第五阶段：成果定稿与验收", window: "2027-06/2027-07", requiredItemIds: ["report-comprehensive", "report-detailed", "implementation-plan", "prototype-test-pack", "metric-core-flow-pass"] }
]);

function actorKey(user = {}) {
  return String(user.id || user.username || user.name || user.role || "").trim();
}

function requireText(value, field) {
  const result = String(value || "").trim();
  if (!result) throw new Error(`${field} is required`);
  return result;
}

function seedResearchProjectAcceptanceItems() {
  return ITEM_DEFINITIONS.map((definition) => ({
    ...definition,
    status: "planned",
    measuredValue: null,
    evidenceRef: "",
    sha256: "",
    note: "",
    recordedBy: "",
    recordedAt: "",
    submittedBy: "",
    submittedAt: "",
    reviewedBy: "",
    reviewedAt: "",
    reviewNote: "",
    noPatientPii: true,
    history: []
  }));
}

function normalizeResearchProjectAcceptanceItems(source) {
  const stored = Array.isArray(source) ? source : [];
  return seedResearchProjectAcceptanceItems().map((definition) => {
    const current = stored.find((item) => item.id === definition.id) || {};
    const status = ["planned", "evidence-recorded", "submitted", "verified", "returned"].includes(current.status)
      ? current.status
      : definition.status;
    const measuredValue = current.measuredValue === null || current.measuredValue === undefined || current.measuredValue === ""
      ? null
      : Number(current.measuredValue);
    return {
      ...definition,
      ...current,
      id: definition.id,
      type: definition.type,
      name: definition.name,
      milestone: definition.milestone,
      comparator: definition.comparator,
      targetValue: definition.targetValue,
      unit: definition.unit,
      platformEvidenceRef: definition.platformEvidenceRef,
      required: definition.required,
      status,
      measuredValue: Number.isFinite(measuredValue) ? measuredValue : null,
      noPatientPii: current.noPatientPii !== false,
      history: Array.isArray(current.history) ? current.history.slice(0, 50) : []
    };
  });
}

function metricMeetsTarget(item) {
  if (item.type !== "metric" || !Number.isFinite(item.measuredValue)) return null;
  if (item.comparator === ">=") return item.measuredValue >= item.targetValue;
  if (item.comparator === "<") return item.measuredValue < item.targetValue;
  if (item.comparator === "<=") return item.measuredValue <= item.targetValue;
  if (item.comparator === "=") return item.measuredValue === item.targetValue;
  return false;
}

function isAcceptanceVerified(item) {
  return item.status === "verified"
    && Boolean(item.evidenceRef)
    && /^[a-f0-9]{64}$/i.test(String(item.sha256 || ""))
    && item.noPatientPii === true
    && (item.type !== "metric" || metricMeetsTarget(item) === true);
}

function applyResearchProjectAcceptanceAction(item, payload = {}, user = {}, now = new Date()) {
  if (!item) throw Object.assign(new Error("research project acceptance item not found"), { status: 404 });
  const action = requireText(payload.action, "action");
  const actor = requireText(actorKey(user), "actor");
  const at = now instanceof Date ? now.toISOString() : String(now);
  const next = { ...item, history: [...(item.history || [])] };
  const previousStatus = item.status;

  if (action === "record-evidence") {
    if (!["commission", "institution"].includes(user.role)) throw Object.assign(new Error("current role cannot record project evidence"), { status: 403 });
    if (!["planned", "evidence-recorded", "returned"].includes(item.status)) throw new Error("project evidence cannot be changed from current status");
    if (payload.noPatientPii !== true) throw new Error("noPatientPii must be confirmed");
    next.evidenceRef = requireText(payload.evidenceRef, "evidenceRef");
    next.note = requireText(payload.note, "note");
    if (item.type === "metric") {
      const measuredValue = Number(payload.measuredValue);
      if (!Number.isFinite(measuredValue)) throw new Error("measuredValue is required for a metric");
      next.measuredValue = measuredValue;
    }
    next.sha256 = createHash("sha256").update(next.evidenceRef).digest("hex");
    next.status = "evidence-recorded";
    next.recordedBy = actor;
    next.recordedAt = at;
    next.submittedBy = "";
    next.submittedAt = "";
    next.reviewedBy = "";
    next.reviewedAt = "";
    next.reviewNote = "";
    next.noPatientPii = true;
  } else if (action === "submit-review") {
    if (!["commission", "institution"].includes(user.role)) throw Object.assign(new Error("current role cannot submit project evidence"), { status: 403 });
    if (item.status !== "evidence-recorded" || !item.evidenceRef || !item.sha256) throw new Error("evidence must be recorded before review submission");
    if (item.type === "metric" && metricMeetsTarget(item) !== true) throw new Error("metric evidence does not meet the acceptance target");
    next.status = "submitted";
    next.submittedBy = actor;
    next.submittedAt = at;
    next.note = requireText(payload.note, "note");
  } else if (action === "verify-evidence") {
    if (user.role !== "commission") throw Object.assign(new Error("only commission reviewer can verify project evidence"), { status: 403 });
    if (item.status !== "submitted") throw new Error("project evidence must be submitted before verification");
    if ([item.recordedBy, item.submittedBy].filter(Boolean).includes(actor)) throw new Error("independent reviewer is required");
    if (item.type === "metric" && metricMeetsTarget(item) !== true) throw new Error("metric evidence does not meet the acceptance target");
    next.status = "verified";
    next.reviewedBy = actor;
    next.reviewedAt = at;
    next.reviewNote = requireText(payload.note, "note");
  } else if (action === "return-evidence") {
    if (user.role !== "commission") throw Object.assign(new Error("only commission reviewer can return project evidence"), { status: 403 });
    if (item.status !== "submitted") throw new Error("only submitted project evidence can be returned");
    if ([item.recordedBy, item.submittedBy].filter(Boolean).includes(actor)) throw new Error("independent reviewer is required");
    next.status = "returned";
    next.reviewedBy = actor;
    next.reviewedAt = at;
    next.reviewNote = requireText(payload.note, "note");
  } else if (action === "revoke-verification") {
    if (user.role !== "commission") throw Object.assign(new Error("only commission reviewer can revoke verification"), { status: 403 });
    if (item.status !== "verified") throw new Error("only verified project evidence can be revoked");
    next.status = "evidence-recorded";
    next.reviewedBy = "";
    next.reviewedAt = "";
    next.reviewNote = requireText(payload.note, "note");
  } else {
    throw new Error("unsupported research project acceptance action");
  }

  next.history.unshift({
    action,
    actor,
    role: String(user.role || ""),
    at,
    fromStatus: previousStatus,
    toStatus: next.status,
    note: String(payload.note || "")
  });
  next.history = next.history.slice(0, 50);
  return next;
}

function buildResearchProjectAcceptanceCenter(data = {}) {
  const items = normalizeResearchProjectAcceptanceItems(data.researchProjectAcceptanceItems);
  const itemById = new Map(items.map((item) => [item.id, item]));
  const requirements = REQUIREMENTS.map((requirement) => {
    const linkedItems = requirement.acceptanceItemIds.map((id) => itemById.get(id)).filter(Boolean);
    const traceabilityComplete = requirement.domains.length > 0
      && requirement.platformModules.length > 0
      && requirement.apiRefs.length > 0
      && linkedItems.length === requirement.acceptanceItemIds.length;
    return {
      ...requirement,
      domainNames: requirement.domains.map((id) => DOMAINS.find((domain) => domain.id === id)?.name || id),
      linkedItems: linkedItems.map((item) => ({ id: item.id, name: item.name, status: item.status, acceptanceVerified: isAcceptanceVerified(item) })),
      traceabilityComplete,
      verifiedItems: linkedItems.filter(isAcceptanceVerified).length,
      status: linkedItems.length > 0 && linkedItems.every(isAcceptanceVerified) ? "verified" : "in-progress"
    };
  });
  const milestones = MILESTONES.map((milestone) => {
    const requiredItems = milestone.requiredItemIds.map((id) => itemById.get(id)).filter(Boolean);
    const verified = requiredItems.filter(isAcceptanceVerified).length;
    return {
      ...milestone,
      verified,
      total: requiredItems.length,
      status: verified === requiredItems.length ? "completed" : verified > 0 ? "in-progress" : "planned"
    };
  });
  const requiredItems = items.filter((item) => item.required);
  const verifiedItems = requiredItems.filter(isAcceptanceVerified);
  const metricItems = items.filter((item) => item.type === "metric").map((item) => ({
    ...item,
    meetsTarget: metricMeetsTarget(item)
  }));
  const traceabilityCoverage = Math.round(100 * requirements.filter((item) => item.traceabilityComplete).length / requirements.length);
  const verifiedRate = Math.round(100 * verifiedItems.length / requiredItems.length);
  return {
    ok: true,
    project: PROJECT,
    domains: DOMAINS,
    requirements,
    deliverables: items.filter((item) => item.type !== "metric"),
    metrics: metricItems,
    milestones,
    items,
    summary: {
      requirements: requirements.length,
      domains: DOMAINS.length,
      acceptanceItems: items.length,
      evidenceRecorded: items.filter((item) => ["evidence-recorded", "submitted", "verified"].includes(item.status)).length,
      submitted: items.filter((item) => item.status === "submitted").length,
      verified: verifiedItems.length,
      verifiedRate,
      traceabilityCoverage,
      reports: items.filter((item) => item.id.startsWith("report-")).length,
      implementationPlans: items.filter((item) => item.id === "implementation-plan").length
    },
    applicationAlignmentState: traceabilityCoverage === 100 ? "application-requirements-mapped" : "application-mapping-incomplete",
    formalAcceptanceState: verifiedItems.length === requiredItems.length ? "ready-for-formal-acceptance-review" : "blocked-until-project-evidence-verified",
    boundary: PROJECT.boundary
  };
}

function renderResearchProjectAcceptanceMarkdown(center) {
  const lines = [
    `# ${center.project.name}验收追溯报告`,
    "",
    `- 项目编码：${center.project.id}`,
    `- 牵头单位：${center.project.leadInstitution}`,
    `- 项目周期：${center.project.period}`,
    `- 申报经费：${center.project.budgetWan}万元`,
    `- 申报要求映射：${center.applicationAlignmentState}`,
    `- 正式验收状态：${center.formalAcceptanceState}`,
    `- 追溯覆盖率：${center.summary.traceabilityCoverage}%`,
    `- 已复核验收项：${center.summary.verified}/${center.summary.acceptanceItems}`,
    "",
    "## 委托任务追溯矩阵",
    "",
    "| 编号 | 委托任务 | 六域 | 平台实现 | 验收项 | 状态 |",
    "| --- | --- | --- | --- | --- | --- |",
    ...center.requirements.map((item) => `| ${item.id} | ${item.name} | ${item.domainNames.join("、")} | ${item.platformModules.join("<br>")} | ${item.linkedItems.map((entry) => `${entry.name}（${entry.status}）`).join("<br>")} | ${item.status} |`),
    "",
    "## 验收指标",
    "",
    "| 指标 | 目标 | 实测 | 证据状态 | 是否达标 |",
    "| --- | --- | --- | --- | --- |",
    ...center.metrics.map((item) => `| ${item.name} | ${item.comparator}${item.targetValue}${item.unit} | ${item.measuredValue ?? "待登记"}${item.measuredValue === null ? "" : item.unit} | ${item.status} | ${item.meetsTarget === null ? "待评价" : item.meetsTarget ? "是" : "否"} |`),
    "",
    "## 里程碑",
    "",
    ...center.milestones.map((item) => `- ${item.name}（${item.window}）：${item.verified}/${item.total}，${item.status}`),
    "",
    "## 数据与证据边界",
    "",
    center.boundary,
    ""
  ];
  return lines.join("\n");
}

module.exports = {
  DOMAINS,
  ITEM_DEFINITIONS,
  MILESTONES,
  PROJECT,
  REQUIREMENTS,
  applyResearchProjectAcceptanceAction,
  buildResearchProjectAcceptanceCenter,
  isAcceptanceVerified,
  metricMeetsTarget,
  normalizeResearchProjectAcceptanceItems,
  renderResearchProjectAcceptanceMarkdown,
  seedResearchProjectAcceptanceItems
};
