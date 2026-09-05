"use strict";

const { AUDIT_CHAIN_VERSION, verifyAuditTrail } = require("./audit-chain");
const { AUDIT_DELIVERY_SOURCE_CONTRACT } = require("./audit-delivery-source");

const CENTER_SCHEMA_VERSION = "platform-audit-governance-center-v1";
const CAPABILITY_ID = "L-GOV-AUDIT";
const SOURCE_DEFINITIONS = Object.freeze([
  Object.freeze({ collection: "securityEvents", title: "安全事件链", owner: "identity-security", classification: "restricted" }),
  Object.freeze({ collection: "dataAccessLogs", title: "数据访问链", owner: "identity-security", classification: "restricted" })
]);

class AuditGovernanceCenterError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = "AuditGovernanceCenterError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function requireScope(actor = {}) {
  if (String(actor.role || "").trim().toLowerCase() !== "commission") {
    throw new AuditGovernanceCenterError(
      "AUDIT_GOVERNANCE_ROLE_FORBIDDEN",
      "当前账号无权访问平台审计治理中心",
      403
    );
  }
  return Object.freeze({
    role: "commission",
    dataScope: "audit-governance-metadata",
    actorDetailVisible: false,
    subjectDetailVisible: false,
    targetDetailVisible: false,
    purposeDetailVisible: false,
    rawExportAvailable: false
  });
}

function requireTrail(data, collection) {
  const rows = data?.[collection];
  if (!Array.isArray(rows)) {
    throw new AuditGovernanceCenterError(
      "AUDIT_GOVERNANCE_SOURCE_INVALID",
      `审计来源 ${collection} 的结构无效`,
      503
    );
  }
  return rows;
}

function resultCategory(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["允许", "allowed", "allow", "success", "succeeded", "accepted", "idempotent"].includes(normalized)) return "allowed";
  if (["拒绝", "denied", "deny", "blocked", "failed", "failure", "rejected"].includes(normalized)) return "denied";
  return "other";
}

function roleCategory(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (/commission|卫健|监管|管理/.test(normalized)) return "commission";
  if (/institution|医疗机构|医院/.test(normalized)) return "institution";
  if (/insurance|医保/.test(normalized)) return "insurance";
  if (/county|基层|医共体/.test(normalized)) return "primary-care";
  if (/doctor|医生|医师|nurse|护士/.test(normalized)) return "clinical-staff";
  if (/citizen|resident|居民/.test(normalized)) return "resident";
  if (/system|worker|adapter|provider|external/.test(normalized)) return "system-or-adapter";
  return "other";
}

function eventCategory(trail, row) {
  if (trail === "dataAccessLogs") return "data-access";
  const text = `${row?.action || ""} ${row?.result || ""} ${row?.detail || ""}`.toLowerCase();
  if (/登录|登出|会话|认证|口令|密码|otp|oidc|login|logout|session|auth/.test(text)) return "authentication";
  if (/拒绝|权限|授权|scope|forbidden|denied|access/.test(text)) return "authorization";
  if (/审计|siem|worm|checkpoint|audit/.test(text)) return "audit-delivery";
  if (/删除|变更|修改|创建|提交|审批|撤销|delete|update|create|submit|approve|revoke/.test(text)) return "sensitive-change";
  return "operational-security";
}

function isHighRisk(trail, row) {
  if (resultCategory(row?.result) === "denied") return true;
  const text = `${row?.action || ""} ${row?.result || ""} ${row?.detail || ""} ${row?.purpose || ""}`.toLowerCase();
  return trail === "dataAccessLogs"
    ? /导出|批量|共享|download|export|share/.test(text)
    : /篡改|失效|吊销|死信|高风险|敏感|tamper|revok|dead-letter|critical/.test(text);
}

function dayBucket(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!match) return "unknown";
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function countBy(values, order) {
  const counts = new Map(order.map((key) => [key, 0]));
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return Object.freeze(order.map((id) => Object.freeze({ id, count: counts.get(id) || 0 })));
}

function sourceSummary(data, definition) {
  const rows = requireTrail(data, definition.collection);
  const verification = verifyAuditTrail(rows);
  if (!verification.passed) {
    throw new AuditGovernanceCenterError(
      "AUDIT_GOVERNANCE_INTEGRITY_FAILED",
      `审计来源 ${definition.collection} 未通过完整性校验`,
      503
    );
  }
  return Object.freeze({
    collection: definition.collection,
    title: definition.title,
    owner: definition.owner,
    classification: definition.classification,
    recordCount: rows.length,
    chainVersion: verification.version,
    integrityPassed: true,
    brokenRecords: 0,
    brokenLinks: 0,
    duplicateIds: 0,
    structuralIssues: 0,
    headDigest: String(rows[0]?.auditHash || ""),
    detailVisible: false
  });
}

function deliveryConfiguration(environment = {}) {
  const siemTargetConfigured = Boolean(String(environment.SIEM_AUDIT_ENDPOINT || "").trim());
  const wormTargetConfigured = Boolean(String(environment.AUDIT_WORM_DIRECTORY || "").trim());
  const legacyRetentionConfigured = Boolean(
    String(environment.AUDIT_EXPORT_PATH || "").trim()
    || String(environment.SIEM_ENDPOINT || "").trim()
  );
  const sourceContractConfigured = String(environment.AUDIT_DELIVERY_SOURCE_CONTRACT || "").trim() === AUDIT_DELIVERY_SOURCE_CONTRACT;
  return Object.freeze({
    appendOnlySourceContract: AUDIT_DELIVERY_SOURCE_CONTRACT,
    sourceContractConfigured,
    siemTargetConfigured,
    wormTargetConfigured,
    exactlyOneDeliveryTargetConfigured: Number(siemTargetConfigured) + Number(wormTargetConfigured) === 1,
    retentionTargetConfigured: legacyRetentionConfigured || siemTargetConfigured || wormTargetConfigured,
    trustedExternalReceiptObserved: false,
    externalMonotonicAnchorObserved: false,
    workerActivationAuthorized: false,
    productionReady: false
  });
}

function controlMatrix(sources, delivery, accessRecords, highRiskEvents) {
  const nonEmptySources = sources.filter((item) => item.recordCount > 0).length;
  const integrityReady = sources.every((item) => item.integrityPassed);
  return Object.freeze([
    Object.freeze({ id: "chain-integrity", name: "严格哈希链完整性", status: integrityReady && nonEmptySources === sources.length ? "controlled" : "blocked", evidence: `${sources.length} 条链通过 v2 校验；${sources.reduce((sum, item) => sum + item.recordCount, 0)} 条受控记录`, blocker: nonEmptySources === sources.length ? "" : "审计链为空，无法形成运行证据" }),
    Object.freeze({ id: "metadata-minimization", name: "治理投影最小化", status: "repository-controlled", evidence: "只输出固定分类、计数、状态和摘要，不输出人员、主体、目标、用途或原始内容", blocker: "需独立隐私与安全评估确认生产最小化规则" }),
    Object.freeze({ id: "access-review", name: "敏感访问复核", status: accessRecords > 0 ? "partial" : "blocked", evidence: `${accessRecords} 条数据访问记录纳入聚合复核`, blocker: "真实数据 Owner、复核频率、处置 SLA 与电子签字待现场确认" }),
    Object.freeze({ id: "high-risk-detection", name: "高风险事件识别", status: "repository-controlled", evidence: `${highRiskEvents} 条事件进入固定规则分类`, blocker: "生产告警阈值、分级通知和独立处置回执待完成" }),
    Object.freeze({ id: "append-only-source", name: "不可截断审计来源", status: "repository-controlled", evidence: `${AUDIT_DELIVERY_SOURCE_CONTRACT} 已登记并由持久化合同保护`, blocker: "真实 PostgreSQL/WORM 来源、回填与恢复演练待完成" }),
    Object.freeze({ id: "continuous-delivery", name: "连续投递与检查点", status: delivery.exactlyOneDeliveryTargetConfigured && delivery.sourceContractConfigured ? "partial" : "blocked", evidence: `来源合同：${delivery.sourceContractConfigured ? "已配置" : "未配置"}；单一投递目标：${delivery.exactlyOneDeliveryTargetConfigured ? "已配置" : "未配置"}`, blocker: "可信接收回执、外部单调锚、告警恢复与故障演练尚未形成现场证据" }),
    Object.freeze({ id: "retention", name: "留存、查询与保全", status: delivery.retentionTargetConfigured ? "partial" : "blocked", evidence: `留存目标：${delivery.retentionTargetConfigured ? "已配置" : "未配置"}`, blocker: "留存期限、访问控制、保全目录、查询权限和销毁策略待签收" }),
    Object.freeze({ id: "release-approval", name: "上线审批与持续复核", status: "blocked", evidence: "生产激活和 Worker 授权固定禁用", blocker: "安全、审计、运维、数据 Owner 与项目责任方现场签字未完成" })
  ]);
}

function riskRegister(sources, delivery, highRiskEvents) {
  const risks = [];
  for (const source of sources.filter((item) => item.recordCount === 0)) {
    risks.push(Object.freeze({ id: `${source.collection}-empty`, title: `${source.title}缺少可核验记录`, severity: "high", status: "open", owner: "T01", nextAction: "确认来源接线、运行事件产生和受控回填边界" }));
  }
  if (highRiskEvents > 0) risks.push(Object.freeze({ id: "high-risk-review-backlog", title: "高风险事件需要责任方复核", severity: "high", status: "open", owner: "T01", nextAction: "按生产阈值、时效和独立签字规则形成处置闭环" }));
  if (!delivery.sourceContractConfigured) risks.push(Object.freeze({ id: "append-only-source-runtime-binding", title: "运行环境未绑定 append-only 审计来源合同", severity: "critical", status: "open", owner: "T00/T01", nextAction: "在受控环境绑定来源合同并执行连续性、回填和恢复验证" }));
  if (!delivery.exactlyOneDeliveryTargetConfigured) risks.push(Object.freeze({ id: "delivery-target", title: "连续投递目标未唯一配置", severity: "critical", status: "open", owner: "T00", nextAction: "在 SIEM HTTPS 或 WORM 目标中选择一个并完成凭据、权限和故障演练" }));
  if (!delivery.retentionTargetConfigured) risks.push(Object.freeze({ id: "retention-target", title: "审计留存目标未配置", severity: "critical", status: "open", owner: "T00/T01", nextAction: "配置外部保全目标并签收留存、查询、归档和销毁策略" }));
  risks.push(Object.freeze({ id: "external-trust-evidence", title: "可信接收回执和外部单调锚缺失", severity: "critical", status: "open", owner: "T00/T01", nextAction: "取得独立接收、锚定、告警、恢复和现场验收证据" }));
  return Object.freeze(risks);
}

function buildAuditGovernanceCenter(data = {}, actor = {}, options = {}) {
  const scope = requireScope(actor);
  const sources = Object.freeze(SOURCE_DEFINITIONS.map((definition) => sourceSummary(data, definition)));
  const rows = SOURCE_DEFINITIONS.flatMap((definition) => requireTrail(data, definition.collection).map((row) => ({ trail: definition.collection, row })));
  const results = rows.map(({ row }) => resultCategory(row?.result));
  const categories = rows.map(({ trail, row }) => eventCategory(trail, row));
  const roles = rows.map(({ row }) => roleCategory(row?.role));
  const highRiskEvents = rows.filter(({ trail, row }) => isHighRisk(trail, row)).length;
  const delivery = deliveryConfiguration(options.environment || {});
  const controls = controlMatrix(sources, delivery, sources.find((item) => item.collection === "dataAccessLogs")?.recordCount || 0, highRiskEvents);
  const risks = riskRegister(sources, delivery, highRiskEvents);
  const bucketCounts = new Map();
  for (const { row } of rows) {
    const day = dayBucket(row?.at || row?.createdAt);
    bucketCounts.set(day, (bucketCounts.get(day) || 0) + 1);
  }
  const activityByDay = Object.freeze([...bucketCounts.entries()]
    .map(([day, count]) => Object.freeze({ day, count }))
    .sort((left, right) => right.day.localeCompare(left.day))
    .slice(0, 14));
  return Object.freeze({
    schemaVersion: CENTER_SCHEMA_VERSION,
    capabilityId: CAPABILITY_ID,
    productionReady: false,
    decision: "NO-GO",
    scope,
    actions: Object.freeze({
      queryGovernance: true,
      viewRawEvents: false,
      exportRawEvents: false,
      repairAuditChain: false,
      activateDeliveryWorker: false,
      approveRetention: false,
      productionActivation: false
    }),
    summary: Object.freeze({
      sources: sources.length,
      totalRecords: rows.length,
      dataAccessRecords: sources.find((item) => item.collection === "dataAccessLogs")?.recordCount || 0,
      deniedEvents: results.filter((item) => item === "denied").length,
      highRiskEvents,
      controls: controls.length,
      blockedControls: controls.filter((item) => item.status === "blocked").length,
      openRisks: risks.length,
      productionEligible: false
    }),
    sources,
    distributions: Object.freeze({
      results: countBy(results, ["allowed", "denied", "other"]),
      categories: countBy(categories, ["authentication", "authorization", "data-access", "sensitive-change", "audit-delivery", "operational-security"]),
      roles: countBy(roles, ["commission", "institution", "insurance", "primary-care", "clinical-staff", "resident", "system-or-adapter", "other"]),
      activityByDay
    }),
    delivery,
    controls,
    risks,
    safetyBoundaries: Object.freeze([
      "治理中心只输出固定分类、计数、状态和摘要，不返回人员、患者、居民、机构、访问目标、用途或事件正文",
      "审计链完整性异常、来源结构异常或读取审计失败时接口失败关闭，不提供部分可信结果",
      "append-only 来源、投递适配器和本地测试不能替代真实 SIEM/WORM、可信回执、外部锚定和现场验收",
      "中心不得修复、重封、删除、导出原始审计记录，不得启动 Worker 或解除生产阻断"
    ]),
    blockers: Object.freeze([
      "真实运行环境尚未形成可信 append-only 来源绑定、连续投递检查点和独立接收回执",
      "SIEM/WORM、外部单调锚、留存期限、查询权限、归档销毁和灾备恢复证据尚未闭合",
      "高风险事件阈值、责任分级、通知、处置 SLA、电子签字和持续复核仍需现场确认",
      "生产身份、数据库、密钥、网络、安全评估及安全/审计/运维/数据 Owner 签字尚未完成"
    ])
  });
}

module.exports = {
  AUDIT_CHAIN_VERSION,
  CAPABILITY_ID,
  CENTER_SCHEMA_VERSION,
  SOURCE_DEFINITIONS,
  AuditGovernanceCenterError,
  buildAuditGovernanceCenter,
  controlMatrix,
  deliveryConfiguration,
  eventCategory,
  isHighRisk,
  requireScope,
  resultCategory,
  roleCategory
};
