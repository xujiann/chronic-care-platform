const { createHash, randomBytes, randomUUID, timingSafeEqual } = require("node:crypto");

const NODE_TYPES = new Set(["national", "provincial", "regional", "sector"]);
const NODE_STATUSES = new Set(["submitted", "verified", "active", "suspended"]);
const INSTITUTION_TYPES = new Set([
  "hospital",
  "primary-care",
  "laboratory",
  "imaging-center",
  "public-health",
  "insurance",
  "pharmaceutical",
  "elder-care",
  "research"
]);
const INSTITUTION_STATUSES = new Set(["submitted", "verified", "active", "suspended"]);
const SUBSCRIPTION_STATUSES = new Set(["requested", "approved", "active", "suspended", "cancelled"]);
const NODE_HEALTH_STATUSES = new Set(["healthy", "degraded", "unavailable"]);
const ROUTING_CONTRACTS = new Set([
  "ORG_NODE_REGISTER",
  "MPI_PATIENT_UPSERT",
  "LIS_LAB_REPORT_PUBLISH",
  "PACS_IMAGING_MANIFEST_PUBLISH",
  "SHARED_RESULT_QUERY",
  "MUTUAL_RECOGNITION_DECISION_CALLBACK",
  "EHR_RECORD_INDEX_SYNC",
  "PUBLIC_HEALTH_EVENT_PUBLISH"
]);
const CONSENT_LEGAL_BASES = new Set([
  "resident-consent",
  "legal-representative-consent",
  "statutory-public-health-duty",
  "continuity-of-care"
]);
const INTEGRATION_SYSTEM_TYPES = new Set([
  "HIS",
  "EMR",
  "LIS",
  "PACS_RIS",
  "EHR",
  "PUBLIC_HEALTH",
  "INSURANCE",
  "PHARMACY"
]);
const CALLBACK_EVENT_TYPES = new Set([
  "routing-envelope.prepared",
  "consent.revoked",
  "contract-test.completed"
]);
const CONTRACT_TEST_CHECKS = [
  "schemaValid",
  "signatureVerified",
  "idempotencyVerified",
  "retryVerified",
  "auditVerified",
  "minimizationVerified"
];
const SYSTEM_CONTRACTS = {
  HIS: new Set(["MPI_PATIENT_UPSERT", "MUTUAL_RECOGNITION_DECISION_CALLBACK"]),
  EMR: new Set(["SHARED_RESULT_QUERY", "PUBLIC_HEALTH_EVENT_PUBLISH"]),
  LIS: new Set(["LIS_LAB_REPORT_PUBLISH"]),
  PACS_RIS: new Set(["PACS_IMAGING_MANIFEST_PUBLISH"]),
  EHR: new Set(["EHR_RECORD_INDEX_SYNC", "SHARED_RESULT_QUERY"]),
  PUBLIC_HEALTH: new Set(["PUBLIC_HEALTH_EVENT_PUBLISH", "SHARED_RESULT_QUERY"]),
  INSURANCE: new Set(["SHARED_RESULT_QUERY"]),
  PHARMACY: new Set(["SHARED_RESULT_QUERY"])
};

class NationalAccessError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "NationalAccessError";
    this.status = Number(options.status || 400);
    this.code = options.code || "NATIONAL_ACCESS_INVALID";
  }
}

function nowIso() {
  return new Date().toISOString();
}

function requiredText(value, field, maxLength = 120) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw new NationalAccessError(`${field} is required`, { code: "NATIONAL_ACCESS_FIELD_REQUIRED" });
  }
  if (normalized.length > maxLength) {
    throw new NationalAccessError(`${field} exceeds ${maxLength} characters`, { code: "NATIONAL_ACCESS_FIELD_TOO_LONG" });
  }
  return normalized;
}

function optionalText(value, maxLength = 240) {
  const normalized = String(value || "").trim();
  if (normalized.length > maxLength) {
    throw new NationalAccessError(`value exceeds ${maxLength} characters`, { code: "NATIONAL_ACCESS_FIELD_TOO_LONG" });
  }
  return normalized;
}

function normalizeCode(value, field) {
  const normalized = requiredText(value, field, 64).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._:-]*$/.test(normalized)) {
    throw new NationalAccessError(`${field} must use uppercase letters, numbers, dot, colon, underscore or hyphen`, {
      code: "NATIONAL_ACCESS_CODE_INVALID"
    });
  }
  return normalized;
}

function normalizeRegionCode(value) {
  const normalized = requiredText(value, "regionCode", 12);
  if (!/^\d{2,12}$/.test(normalized)) {
    throw new NationalAccessError("regionCode must be a 2-12 digit administrative division code", {
      code: "NATIONAL_ACCESS_REGION_INVALID"
    });
  }
  return normalized;
}

function uniqueStrings(values, maxItems = 30) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((item) => String(item || "").trim()).filter(Boolean))].slice(0, maxItems);
}

function seedServicePackages() {
  return [
    {
      id: "pkg-identity-basic",
      code: "IDENTITY_BASIC",
      name: "机构注册与基础身份包",
      category: "foundation",
      version: "1.0.0",
      capabilities: ["机构注册", "节点寻址", "居民主索引", "统一认证", "授权同意", "审计查询"],
      requiredPackageIds: [],
      status: "active",
      dataPolicy: "仅交换身份匹配和授权所需最小字段"
    },
    {
      id: "pkg-lab-imaging",
      code: "LAB_IMAGING_SHARING",
      name: "检验检查跨省共享包",
      category: "clinical-sharing",
      version: "1.0.0",
      capabilities: ["LIS报告发布", "PACS影像索引", "跨省查询", "影像调阅", "互认决定回写"],
      requiredPackageIds: ["pkg-identity-basic"],
      status: "active",
      dataPolicy: "元数据先行，报告和影像按授权、按需调阅"
    },
    {
      id: "pkg-health-record",
      code: "HEALTH_RECORD",
      name: "居民电子健康档案包",
      category: "resident-service",
      version: "1.0.0",
      capabilities: ["档案首页", "本人查询", "代理授权", "来源展示", "纠错闭环"],
      requiredPackageIds: ["pkg-identity-basic"],
      status: "active",
      dataPolicy: "居民本人或合法代理范围内按需返回"
    },
    {
      id: "pkg-public-health",
      code: "PUBLIC_HEALTH_LINKAGE",
      name: "公共卫生联动包",
      category: "public-health",
      version: "1.0.0",
      capabilities: ["事件识别", "任务下发", "处置回流", "随访闭环", "监测评价"],
      requiredPackageIds: ["pkg-identity-basic"],
      status: "active",
      dataPolicy: "以法定职责和明确业务事件为访问前提"
    },
    {
      id: "pkg-three-medical",
      code: "MEDICAL_INSURANCE_PHARMA",
      name: "医疗医保医药协同包",
      category: "three-medical",
      version: "1.0.0",
      capabilities: ["资格查询", "费用关联", "药品编码", "处方流转", "监管服务"],
      requiredPackageIds: ["pkg-identity-basic"],
      status: "active",
      dataPolicy: "不替代医保结算和医药核心交易系统"
    },
    {
      id: "pkg-trusted-ai",
      code: "TRUSTED_DATA_AI",
      name: "可信数据与人工智能包",
      category: "data-and-ai",
      version: "1.0.0",
      capabilities: ["高质量数据集", "可信数据空间", "数据沙箱", "模型评测", "运行监测"],
      requiredPackageIds: ["pkg-identity-basic"],
      status: "active",
      dataPolicy: "去标识化、受控计算、用途合约和全程存证"
    }
  ];
}

function seedNodes() {
  return [
    {
      id: "node-national",
      nodeCode: "CN-NATIONAL",
      name: "国家全民健康数智化能力中心",
      nodeType: "national",
      regionCode: "00",
      parentNodeId: "",
      endpointMode: "national-hub",
      capabilities: ["registry", "catalog", "routing", "consent", "audit"],
      status: "active",
      certification: { level: "national", certifiedAt: "2026-07-24", expiresAt: "2027-07-24" },
      createdAt: "2026-07-24T00:00:00.000Z",
      updatedAt: "2026-07-24T00:00:00.000Z"
    },
    {
      id: "node-liaoning",
      nodeCode: "CN-21",
      name: "辽宁省试点节点",
      nodeType: "provincial",
      regionCode: "21",
      parentNodeId: "node-national",
      endpointMode: "provincial-node",
      capabilities: ["institution-gateway", "clinical-routing", "local-policy"],
      status: "active",
      certification: { level: "pilot", certifiedAt: "2026-07-24", expiresAt: "2027-01-24" },
      createdAt: "2026-07-24T00:00:00.000Z",
      updatedAt: "2026-07-24T00:00:00.000Z"
    },
    {
      id: "node-zhejiang",
      nodeCode: "CN-33",
      name: "浙江省试点节点",
      nodeType: "provincial",
      regionCode: "33",
      parentNodeId: "node-national",
      endpointMode: "provincial-node",
      capabilities: ["institution-gateway", "clinical-routing", "local-policy"],
      status: "active",
      certification: { level: "pilot", certifiedAt: "2026-07-24", expiresAt: "2027-01-24" },
      createdAt: "2026-07-24T00:00:00.000Z",
      updatedAt: "2026-07-24T00:00:00.000Z"
    },
    {
      id: "node-zhejiang-dr",
      nodeCode: "CN-33-DR",
      name: "浙江省试点容灾节点",
      nodeType: "regional",
      regionCode: "330100",
      parentNodeId: "node-zhejiang",
      endpointMode: "regional-failover",
      capabilities: ["institution-gateway", "clinical-routing", "disaster-recovery"],
      status: "active",
      certification: { level: "pilot-dr", certifiedAt: "2026-07-24", expiresAt: "2027-01-24" },
      createdAt: "2026-07-24T00:00:00.000Z",
      updatedAt: "2026-07-24T00:00:00.000Z"
    }
  ];
}

function seedInstitutions() {
  return [
    {
      id: "national-inst-mr1",
      orgCode: "MR1",
      nationalOrgCode: "CN-210200-H-001",
      name: "辽宁省试点综合医院",
      institutionType: "hospital",
      regionCode: "210200",
      nodeId: "node-liaoning",
      accessMode: "institution-gateway",
      tenantId: "tenant-mr1",
      requestedPackageIds: ["pkg-identity-basic", "pkg-lab-imaging"],
      status: "active",
      certification: { level: "pilot", certifiedAt: "2026-07-24", expiresAt: "2027-01-24" },
      createdAt: "2026-07-24T00:00:00.000Z",
      updatedAt: "2026-07-24T00:00:00.000Z"
    },
    {
      id: "national-inst-mr3",
      orgCode: "MR3",
      nationalOrgCode: "CN-210200-P-001",
      name: "辽宁省试点基层医疗机构",
      institutionType: "primary-care",
      regionCode: "210200",
      nodeId: "node-liaoning",
      accessMode: "institution-gateway",
      tenantId: "tenant-mr3",
      requestedPackageIds: ["pkg-identity-basic", "pkg-health-record", "pkg-public-health"],
      status: "active",
      certification: { level: "pilot", certifiedAt: "2026-07-24", expiresAt: "2027-01-24" },
      createdAt: "2026-07-24T00:00:00.000Z",
      updatedAt: "2026-07-24T00:00:00.000Z"
    },
    {
      id: "national-inst-zj1",
      orgCode: "ZJ-H001",
      nationalOrgCode: "CN-330100-H-001",
      name: "浙江省试点综合医院",
      institutionType: "hospital",
      regionCode: "330100",
      nodeId: "node-zhejiang",
      accessMode: "provincial-node",
      tenantId: "tenant-zj-h001",
      requestedPackageIds: ["pkg-identity-basic", "pkg-lab-imaging"],
      status: "active",
      certification: { level: "pilot", certifiedAt: "2026-07-24", expiresAt: "2027-01-24" },
      createdAt: "2026-07-24T00:00:00.000Z",
      updatedAt: "2026-07-24T00:00:00.000Z"
    }
  ];
}

function seedSubscriptions() {
  return [
    ["sub-mr1-identity", "MR1", "pkg-identity-basic"],
    ["sub-mr1-lab", "MR1", "pkg-lab-imaging"],
    ["sub-mr3-identity", "MR3", "pkg-identity-basic"],
    ["sub-mr3-record", "MR3", "pkg-health-record"],
    ["sub-zj1-identity", "ZJ-H001", "pkg-identity-basic"],
    ["sub-zj1-lab", "ZJ-H001", "pkg-lab-imaging"]
  ].map(([id, orgCode, packageId]) => ({
    id,
    orgCode,
    packageId,
    environment: "pilot",
    status: "active",
    approvedBy: "国家平台试点管理员",
    approvedAt: "2026-07-24T00:00:00.000Z",
    activatedAt: "2026-07-24T00:00:00.000Z",
    createdAt: "2026-07-24T00:00:00.000Z",
    updatedAt: "2026-07-24T00:00:00.000Z"
  }));
}

function seedNodeHealthProbes() {
  return [
    ["health-national", "node-national", "healthy", 42],
    ["health-liaoning", "node-liaoning", "healthy", 68],
    ["health-zhejiang", "node-zhejiang", "healthy", 73],
    ["health-zhejiang-dr", "node-zhejiang-dr", "healthy", 96]
  ].map(([id, nodeId, status, latencyMs]) => ({
    id,
    nodeId,
    status,
    latencyMs,
    checkedAt: "2026-07-24T00:00:00.000Z",
    checkedBy: "国家平台自动探测",
    detail: "试点基线健康探测"
  }));
}

function seedAccessCertificates() {
  return [
    {
      id: "cert-node-liaoning-pilot",
      serialNumber: "NHP-PILOT-NODE-21-001",
      subjectType: "node",
      subjectId: "node-liaoning",
      environment: "pilot",
      publicKeyFingerprint: "a".repeat(64),
      status: "active",
      issuedAt: "2026-07-24T00:00:00.000Z",
      expiresAt: "2027-01-24T00:00:00.000Z",
      issuedBy: "国家平台试点CA",
      productionEvidence: false
    },
    {
      id: "cert-inst-mr1-pilot",
      serialNumber: "NHP-PILOT-ORG-MR1-001",
      subjectType: "institution",
      subjectId: "national-inst-mr1",
      environment: "pilot",
      publicKeyFingerprint: "b".repeat(64),
      status: "active",
      issuedAt: "2026-07-24T00:00:00.000Z",
      expiresAt: "2027-01-24T00:00:00.000Z",
      issuedBy: "国家平台试点CA",
      productionEvidence: false
    }
  ];
}

function seedSlaPolicies() {
  return [
    { id: "sla-node-latency", target: "node-health", metric: "latencyMs", warningThreshold: 300, criticalThreshold: 800, unit: "ms", status: "active" },
    { id: "sla-route-latency", target: "routing", metric: "estimatedLatencyMs", warningThreshold: 1500, criticalThreshold: 3000, unit: "ms", status: "active" },
    { id: "sla-health-freshness", target: "node-health", metric: "freshnessMinutes", warningThreshold: 10, criticalThreshold: 30, unit: "minutes", status: "active" }
  ];
}

function seedApiQuotaPolicies() {
  return [
    {
      id: "quota-sandbox-default",
      environment: "sandbox",
      minuteLimit: 60,
      dailyLimit: 1000,
      status: "active",
      productionEvidence: false
    },
    {
      id: "quota-pilot-default",
      environment: "pilot",
      minuteLimit: 300,
      dailyLimit: 10000,
      status: "active",
      productionEvidence: false
    }
  ];
}

function seedNationalStandards() {
  return [
    { id: "std-org-node", code: "NHP-ORG-NODE", name: "机构与节点注册标准", version: "1.0.0", domain: "identity", requiredFields: ["nodeCode", "orgCode", "nationalOrgCode", "tenantId"], status: "active" },
    { id: "std-lab-report", code: "NHP-LIS-REPORT", name: "跨省检验报告交换标准", version: "1.0.0", domain: "laboratory", requiredFields: ["routeId", "sourceOrgCode", "targetOrgCode", "reportId", "reportVersion", "payloadDigest"], status: "active" },
    { id: "std-imaging-manifest", code: "NHP-PACS-MANIFEST", name: "跨省影像索引交换标准", version: "1.0.0", domain: "imaging", requiredFields: ["routeId", "sourceOrgCode", "targetOrgCode", "studyUid", "payloadDigest"], status: "active" },
    { id: "std-routing-envelope", code: "NHP-ROUTING", name: "国家跨省路由信封标准", version: "1.0.0", domain: "routing", requiredFields: ["traceId", "contractId", "schemaVersion", "consentReference", "payloadDigest"], status: "active" }
  ];
}

function seed() {
  return {
    nationalAccessNodes: seedNodes(),
    nationalAccessInstitutions: seedInstitutions(),
    nationalServicePackages: seedServicePackages(),
    nationalServiceSubscriptions: seedSubscriptions(),
    nationalNodeHealthProbes: seedNodeHealthProbes(),
    nationalRoutingTraces: [],
    nationalRoutingEnvelopes: [],
    nationalAccessCertificates: seedAccessCertificates(),
    nationalDeveloperCredentials: [],
    nationalApiQuotaPolicies: seedApiQuotaPolicies(),
    nationalApiUsageEvents: [],
    nationalSecurityAlerts: [],
    nationalCertificationReports: [],
    nationalConsentAuthorizations: [],
    nationalIntegrationAdapters: [],
    nationalContractTestRuns: [],
    nationalCallbackSubscriptions: [],
    nationalCallbackDeliveries: [],
    nationalSlaPolicies: seedSlaPolicies(),
    nationalSlaAlerts: [],
    nationalStandards: seedNationalStandards(),
    nationalStandardExtensions: [],
    nationalAccessAudit: []
  };
}

function mergeByKey(defaults, persisted, key) {
  const byKey = new Map(defaults.map((item) => [item[key], { ...item }]));
  for (const item of Array.isArray(persisted) ? persisted : []) {
    if (!item || !item[key]) continue;
    byKey.set(item[key], { ...(byKey.get(item[key]) || {}), ...item });
  }
  return [...byKey.values()];
}

function normalizeState(data = {}) {
  const defaults = seed();
  return {
    nationalAccessNodes: mergeByKey(defaults.nationalAccessNodes, data.nationalAccessNodes, "id"),
    nationalAccessInstitutions: mergeByKey(defaults.nationalAccessInstitutions, data.nationalAccessInstitutions, "id"),
    nationalServicePackages: mergeByKey(defaults.nationalServicePackages, data.nationalServicePackages, "id"),
    nationalServiceSubscriptions: mergeByKey(defaults.nationalServiceSubscriptions, data.nationalServiceSubscriptions, "id"),
    nationalNodeHealthProbes: mergeByKey(defaults.nationalNodeHealthProbes, data.nationalNodeHealthProbes, "id").slice(0, 5000),
    nationalRoutingTraces: Array.isArray(data.nationalRoutingTraces) ? data.nationalRoutingTraces.slice(0, 5000) : [],
    nationalRoutingEnvelopes: Array.isArray(data.nationalRoutingEnvelopes) ? data.nationalRoutingEnvelopes.slice(0, 5000) : [],
    nationalAccessCertificates: mergeByKey(defaults.nationalAccessCertificates, data.nationalAccessCertificates, "id").slice(0, 5000),
    nationalDeveloperCredentials: Array.isArray(data.nationalDeveloperCredentials) ? data.nationalDeveloperCredentials.slice(0, 5000) : [],
    nationalApiQuotaPolicies: mergeByKey(defaults.nationalApiQuotaPolicies, data.nationalApiQuotaPolicies, "id"),
    nationalApiUsageEvents: Array.isArray(data.nationalApiUsageEvents) ? data.nationalApiUsageEvents.slice(0, 10000) : [],
    nationalSecurityAlerts: Array.isArray(data.nationalSecurityAlerts) ? data.nationalSecurityAlerts.slice(0, 5000) : [],
    nationalCertificationReports: Array.isArray(data.nationalCertificationReports) ? data.nationalCertificationReports.slice(0, 5000) : [],
    nationalConsentAuthorizations: Array.isArray(data.nationalConsentAuthorizations) ? data.nationalConsentAuthorizations.slice(0, 5000) : [],
    nationalIntegrationAdapters: Array.isArray(data.nationalIntegrationAdapters) ? data.nationalIntegrationAdapters.slice(0, 5000) : [],
    nationalContractTestRuns: Array.isArray(data.nationalContractTestRuns) ? data.nationalContractTestRuns.slice(0, 10000) : [],
    nationalCallbackSubscriptions: Array.isArray(data.nationalCallbackSubscriptions) ? data.nationalCallbackSubscriptions.slice(0, 5000) : [],
    nationalCallbackDeliveries: Array.isArray(data.nationalCallbackDeliveries) ? data.nationalCallbackDeliveries.slice(0, 10000) : [],
    nationalSlaPolicies: mergeByKey(defaults.nationalSlaPolicies, data.nationalSlaPolicies, "id"),
    nationalSlaAlerts: Array.isArray(data.nationalSlaAlerts) ? data.nationalSlaAlerts.slice(0, 5000) : [],
    nationalStandards: mergeByKey(defaults.nationalStandards, data.nationalStandards, "id"),
    nationalStandardExtensions: Array.isArray(data.nationalStandardExtensions) ? data.nationalStandardExtensions.slice(0, 5000) : [],
    nationalAccessAudit: Array.isArray(data.nationalAccessAudit) ? data.nationalAccessAudit.slice(0, 2000) : []
  };
}

function assertUnique(items, field, value, code) {
  if (items.some((item) => String(item[field] || "").toUpperCase() === String(value || "").toUpperCase())) {
    throw new NationalAccessError(`${field} already exists`, { status: 409, code });
  }
}

function auditEntry(action, target, actor, detail = "") {
  return {
    id: randomUUID(),
    at: nowIso(),
    actor: actor?.name || actor?.username || "system",
    actorRole: actor?.role || "system",
    actorOrgCode: actor?.orgCode || "",
    action,
    target,
    detail: optionalText(detail, 500)
  };
}

function createNode(state, payload, actor) {
  const nodes = state.nationalAccessNodes || [];
  const nodeCode = normalizeCode(payload.nodeCode, "nodeCode");
  assertUnique(nodes, "nodeCode", nodeCode, "NATIONAL_ACCESS_NODE_EXISTS");
  const nodeType = requiredText(payload.nodeType, "nodeType", 32);
  if (!NODE_TYPES.has(nodeType) || nodeType === "national") {
    throw new NationalAccessError("nodeType must be provincial, regional or sector", {
      code: "NATIONAL_ACCESS_NODE_TYPE_INVALID"
    });
  }
  const parentNodeId = optionalText(payload.parentNodeId || "node-national", 64);
  const parent = nodes.find((item) => item.id === parentNodeId);
  if (!parent || parent.status !== "active") {
    throw new NationalAccessError("active parent node not found", {
      status: 409,
      code: "NATIONAL_ACCESS_PARENT_NODE_INACTIVE"
    });
  }
  const at = nowIso();
  const node = {
    id: randomUUID(),
    nodeCode,
    name: requiredText(payload.name, "name"),
    nodeType,
    regionCode: normalizeRegionCode(payload.regionCode),
    parentNodeId,
    endpointMode: optionalText(payload.endpointMode || `${nodeType}-node`, 64),
    capabilities: uniqueStrings(payload.capabilities),
    status: "submitted",
    certification: null,
    createdBy: actor?.username || actor?.name || "system",
    createdAt: at,
    updatedAt: at
  };
  return {
    entity: node,
    audit: auditEntry("node-register", node.id, actor, `${node.nodeCode}/${node.regionCode}`)
  };
}

function createInstitution(state, payload, actor) {
  const institutions = state.nationalAccessInstitutions || [];
  const orgCode = normalizeCode(payload.orgCode, "orgCode");
  const nationalOrgCode = normalizeCode(payload.nationalOrgCode, "nationalOrgCode");
  assertUnique(institutions, "orgCode", orgCode, "NATIONAL_ACCESS_ORG_EXISTS");
  assertUnique(institutions, "nationalOrgCode", nationalOrgCode, "NATIONAL_ACCESS_NATIONAL_ORG_EXISTS");
  const institutionType = requiredText(payload.institutionType, "institutionType", 32);
  if (!INSTITUTION_TYPES.has(institutionType)) {
    throw new NationalAccessError("institutionType is not supported", {
      code: "NATIONAL_ACCESS_INSTITUTION_TYPE_INVALID"
    });
  }
  const nodeId = requiredText(payload.nodeId, "nodeId", 64);
  const node = (state.nationalAccessNodes || []).find((item) => item.id === nodeId);
  if (!node || node.status !== "active") {
    throw new NationalAccessError("institution must attach to an active certified node", {
      status: 409,
      code: "NATIONAL_ACCESS_NODE_INACTIVE"
    });
  }
  const at = nowIso();
  const entity = {
    id: randomUUID(),
    orgCode,
    nationalOrgCode,
    name: requiredText(payload.name, "name"),
    institutionType,
    regionCode: normalizeRegionCode(payload.regionCode),
    nodeId,
    accessMode: optionalText(payload.accessMode || "institution-gateway", 64),
    tenantId: normalizeCode(payload.tenantId || `TENANT-${orgCode}`, "tenantId").toLowerCase(),
    requestedPackageIds: uniqueStrings(payload.requestedPackageIds),
    status: "submitted",
    certification: null,
    createdBy: actor?.username || actor?.name || "system",
    createdAt: at,
    updatedAt: at
  };
  return {
    entity,
    audit: auditEntry("institution-register", entity.id, actor, `${entity.orgCode}/${entity.nodeId}`)
  };
}

function createSubscription(state, payload, actor) {
  const orgCode = normalizeCode(payload.orgCode, "orgCode");
  const packageId = requiredText(payload.packageId, "packageId", 64);
  const institution = (state.nationalAccessInstitutions || []).find((item) => item.orgCode === orgCode);
  if (!institution || institution.status !== "active") {
    throw new NationalAccessError("active certified institution not found", {
      status: 409,
      code: "NATIONAL_ACCESS_INSTITUTION_INACTIVE"
    });
  }
  const servicePackage = (state.nationalServicePackages || []).find((item) => item.id === packageId && item.status === "active");
  if (!servicePackage) {
    throw new NationalAccessError("active service package not found", {
      status: 404,
      code: "NATIONAL_ACCESS_PACKAGE_NOT_FOUND"
    });
  }
  const subscriptions = state.nationalServiceSubscriptions || [];
  if (subscriptions.some((item) => item.orgCode === orgCode && item.packageId === packageId && item.status !== "cancelled")) {
    throw new NationalAccessError("service package is already subscribed", {
      status: 409,
      code: "NATIONAL_ACCESS_SUBSCRIPTION_EXISTS"
    });
  }
  const missingDependency = (servicePackage.requiredPackageIds || []).find((requiredId) => (
    !subscriptions.some((item) => item.orgCode === orgCode && item.packageId === requiredId && item.status === "active")
  ));
  if (missingDependency) {
    throw new NationalAccessError(`required package ${missingDependency} is not active`, {
      status: 409,
      code: "NATIONAL_ACCESS_PACKAGE_DEPENDENCY_MISSING"
    });
  }
  const at = nowIso();
  const entity = {
    id: randomUUID(),
    orgCode,
    packageId,
    environment: optionalText(payload.environment || "sandbox", 32),
    status: "requested",
    purpose: optionalText(payload.purpose, 240),
    requestedBy: actor?.username || actor?.name || "system",
    createdAt: at,
    updatedAt: at
  };
  return {
    entity,
    audit: auditEntry("service-subscribe", entity.id, actor, `${orgCode}/${packageId}`)
  };
}

function futureExpiry(value, defaultDays = 90) {
  const fallback = new Date(Date.now() + defaultDays * 86_400_000);
  const date = value ? new Date(value) : fallback;
  if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) {
    throw new NationalAccessError("expiresAt must be a future date", {
      code: "NATIONAL_ACCESS_EXPIRY_INVALID"
    });
  }
  return date.toISOString();
}

function issueAccessCertificate(state, payload, actor) {
  const subjectType = requiredText(payload.subjectType, "subjectType", 32);
  if (!["node", "institution"].includes(subjectType)) {
    throw new NationalAccessError("subjectType must be node or institution", {
      code: "NATIONAL_ACCESS_CERTIFICATE_SUBJECT_INVALID"
    });
  }
  const subjectId = requiredText(payload.subjectId, "subjectId", 80);
  const subject = subjectType === "node"
    ? (state.nationalAccessNodes || []).find((item) => item.id === subjectId && item.status === "active")
    : (state.nationalAccessInstitutions || []).find((item) => item.id === subjectId && item.status === "active");
  if (!subject) {
    throw new NationalAccessError("certificate subject must be active and certified", {
      status: 409,
      code: "NATIONAL_ACCESS_CERTIFICATE_SUBJECT_INACTIVE"
    });
  }
  const environment = optionalText(payload.environment || "sandbox", 32);
  if (!["sandbox", "pilot"].includes(environment)) {
    throw new NationalAccessError("production certificates require formal external CA and acceptance evidence", {
      status: 409,
      code: "NATIONAL_ACCESS_PRODUCTION_CERTIFICATE_BLOCKED"
    });
  }
  const fingerprint = requiredText(payload.publicKeyFingerprint, "publicKeyFingerprint", 128).toLowerCase().replaceAll(":", "");
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) {
    throw new NationalAccessError("publicKeyFingerprint must be a SHA-256 hexadecimal fingerprint", {
      code: "NATIONAL_ACCESS_CERTIFICATE_FINGERPRINT_INVALID"
    });
  }
  const duplicate = (state.nationalAccessCertificates || []).some((item) => (
    item.subjectType === subjectType
    && item.subjectId === subjectId
    && item.environment === environment
    && item.status === "active"
  ));
  if (duplicate) {
    throw new NationalAccessError("active certificate already exists for this subject and environment", {
      status: 409,
      code: "NATIONAL_ACCESS_CERTIFICATE_EXISTS"
    });
  }
  const issuedAt = nowIso();
  const id = randomUUID();
  const entity = {
    id,
    serialNumber: `NHP-${environment.toUpperCase()}-${subjectType.toUpperCase()}-${id.slice(0, 8).toUpperCase()}`,
    subjectType,
    subjectId,
    environment,
    publicKeyFingerprint: fingerprint,
    status: "active",
    issuedAt,
    expiresAt: futureExpiry(payload.expiresAt, environment === "pilot" ? 180 : 90),
    issuedBy: actor?.username || actor?.name || "system",
    productionEvidence: false
  };
  return {
    entity,
    audit: auditEntry("certificate-issue", entity.id, actor, `${subjectType}/${subjectId}/${environment}`)
  };
}

function applyCertificateAction(entity, action, actor) {
  if (!entity) {
    throw new NationalAccessError("certificate not found", {
      status: 404,
      code: "NATIONAL_ACCESS_CERTIFICATE_NOT_FOUND"
    });
  }
  if (action !== "revoke" || entity.status !== "active") {
    throw new NationalAccessError(`certificate action ${action} is not allowed from ${entity.status}`, {
      status: 409,
      code: "NATIONAL_ACCESS_CERTIFICATE_ACTION_INVALID"
    });
  }
  const updated = {
    ...entity,
    status: "revoked",
    revokedAt: nowIso(),
    revokedBy: actor?.username || actor?.name || "system"
  };
  return {
    entity: updated,
    audit: auditEntry("certificate-revoke", updated.id, actor, updated.subjectId)
  };
}

function credentialSecret() {
  return `nhp_${randomBytes(24).toString("base64url")}`;
}

function credentialHash(secret) {
  return createHash("sha256").update(secret).digest("hex");
}

function credentialHashMatches(storedHash, candidateHash) {
  if (!/^[a-f0-9]{64}$/i.test(String(storedHash || ""))) return false;
  const stored = Buffer.from(storedHash, "hex");
  const candidate = Buffer.from(candidateHash, "hex");
  return stored.length === candidate.length && timingSafeEqual(stored, candidate);
}

function issueDeveloperCredential(state, payload, actor) {
  const orgCode = normalizeCode(payload.orgCode, "orgCode");
  const institution = (state.nationalAccessInstitutions || []).find((item) => item.orgCode === orgCode && item.status === "active");
  if (!institution) {
    throw new NationalAccessError("active institution not found", {
      status: 409,
      code: "NATIONAL_ACCESS_CREDENTIAL_INSTITUTION_INACTIVE"
    });
  }
  const environment = optionalText(payload.environment || "sandbox", 32);
  if (!["sandbox", "pilot"].includes(environment)) {
    throw new NationalAccessError("production developer credentials remain blocked until formal acceptance", {
      status: 409,
      code: "NATIONAL_ACCESS_PRODUCTION_CREDENTIAL_BLOCKED"
    });
  }
  const quotaPolicy = (state.nationalApiQuotaPolicies || seedApiQuotaPolicies())
    .find((item) => item.environment === environment && item.status === "active");
  if (!quotaPolicy) {
    throw new NationalAccessError("active API quota policy not found for environment", {
      status: 409,
      code: "NATIONAL_ACCESS_QUOTA_POLICY_MISSING"
    });
  }
  const scopes = uniqueStrings(payload.scopes);
  if (!scopes.length) {
    throw new NationalAccessError("at least one service package scope is required", {
      code: "NATIONAL_ACCESS_CREDENTIAL_SCOPE_REQUIRED"
    });
  }
  const inactiveScope = scopes.find((packageId) => (
    !(state.nationalServiceSubscriptions || []).some((item) => (
      item.orgCode === orgCode && item.packageId === packageId && item.status === "active"
    ))
  ));
  if (inactiveScope) {
    throw new NationalAccessError(`scope ${inactiveScope} is not an active subscription`, {
      status: 409,
      code: "NATIONAL_ACCESS_CREDENTIAL_SCOPE_INACTIVE"
    });
  }
  const secret = credentialSecret();
  const issuedAt = nowIso();
  const entity = {
    id: randomUUID(),
    orgCode,
    name: requiredText(payload.name, "name", 100),
    environment,
    scopes,
    quotaPolicyId: quotaPolicy.id,
    secretPrefix: secret.slice(0, 12),
    secretHash: credentialHash(secret),
    status: "active",
    issuedAt,
    expiresAt: futureExpiry(payload.expiresAt, environment === "pilot" ? 90 : 30),
    lastUsedAt: null,
    issuedBy: actor?.username || actor?.name || "system"
  };
  return {
    entity,
    secret,
    audit: auditEntry("developer-credential-issue", entity.id, actor, `${orgCode}/${environment}/${scopes.join(",")}`)
  };
}

function applyDeveloperCredentialAction(entity, action, actor) {
  if (!entity) {
    throw new NationalAccessError("developer credential not found", {
      status: 404,
      code: "NATIONAL_ACCESS_CREDENTIAL_NOT_FOUND"
    });
  }
  if (action === "revoke" && entity.status === "active") {
    const updated = {
      ...entity,
      status: "revoked",
      revokedAt: nowIso(),
      revokedBy: actor?.username || actor?.name || "system"
    };
    return {
      entity: updated,
      secret: null,
      audit: auditEntry("developer-credential-revoke", updated.id, actor, updated.orgCode)
    };
  }
  if (action === "rotate" && entity.status === "active") {
    const secret = credentialSecret();
    const updated = {
      ...entity,
      secretPrefix: secret.slice(0, 12),
      secretHash: credentialHash(secret),
      rotatedAt: nowIso(),
      rotatedBy: actor?.username || actor?.name || "system"
    };
    return {
      entity: updated,
      secret,
      audit: auditEntry("developer-credential-rotate", updated.id, actor, updated.orgCode)
    };
  }
  throw new NationalAccessError(`credential action ${action} is not allowed from ${entity.status}`, {
    status: 409,
    code: "NATIONAL_ACCESS_CREDENTIAL_ACTION_INVALID"
  });
}

function parseEvaluationTime(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    throw new NationalAccessError("now must be a valid date", {
      code: "NATIONAL_ACCESS_TIME_INVALID"
    });
  }
  return date;
}

function developerActor(credential) {
  return {
    name: `developer-key:${credential.secretPrefix}`,
    role: "developer",
    orgCode: credential.orgCode
  };
}

function contractAllowedForPackage(packageId, contractId) {
  const packageContracts = {
    "pkg-identity-basic": new Set(["ORG_NODE_REGISTER", "MPI_PATIENT_UPSERT"]),
    "pkg-lab-imaging": new Set([
      "LIS_LAB_REPORT_PUBLISH",
      "PACS_IMAGING_MANIFEST_PUBLISH",
      "SHARED_RESULT_QUERY",
      "MUTUAL_RECOGNITION_DECISION_CALLBACK"
    ]),
    "pkg-health-record": new Set(["EHR_RECORD_INDEX_SYNC", "SHARED_RESULT_QUERY"]),
    "pkg-public-health": new Set(["PUBLIC_HEALTH_EVENT_PUBLISH", "SHARED_RESULT_QUERY"]),
    "pkg-three-medical": new Set(["SHARED_RESULT_QUERY"]),
    "pkg-trusted-ai": new Set(["SHARED_RESULT_QUERY"])
  };
  return packageContracts[packageId]?.has(contractId) || false;
}

function invokeDeveloperSandbox(state, secretValue, payload, options = {}) {
  const secret = requiredText(secretValue, "developerKey", 200);
  const secretHash = credentialHash(secret);
  const credential = (state.nationalDeveloperCredentials || [])
    .find((item) => credentialHashMatches(item.secretHash, secretHash));
  if (!credential || credential.status !== "active") {
    throw new NationalAccessError("developer credential is invalid or inactive", {
      status: 401,
      code: "NATIONAL_ACCESS_DEVELOPER_KEY_INVALID"
    });
  }
  const now = parseEvaluationTime(options.now);
  if (new Date(credential.expiresAt).getTime() <= now.getTime()) {
    throw new NationalAccessError("developer credential has expired", {
      status: 401,
      code: "NATIONAL_ACCESS_DEVELOPER_KEY_EXPIRED"
    });
  }
  if (!["sandbox", "pilot"].includes(credential.environment)) {
    throw new NationalAccessError("production invocation is blocked until formal acceptance", {
      status: 409,
      code: "NATIONAL_ACCESS_PRODUCTION_INVOCATION_BLOCKED"
    });
  }
  const packageId = requiredText(payload.packageId, "packageId", 64);
  if (!(credential.scopes || []).includes(packageId)) {
    throw new NationalAccessError("developer credential does not include requested package scope", {
      status: 403,
      code: "NATIONAL_ACCESS_DEVELOPER_SCOPE_FORBIDDEN"
    });
  }
  const activeSubscription = (state.nationalServiceSubscriptions || []).some((item) => (
    item.orgCode === credential.orgCode
    && item.packageId === packageId
    && item.status === "active"
  ));
  if (!activeSubscription) {
    throw new NationalAccessError("service package subscription is not active", {
      status: 409,
      code: "NATIONAL_ACCESS_DEVELOPER_SUBSCRIPTION_INACTIVE"
    });
  }
  const contractId = requiredText(payload.contractId, "contractId", 80);
  if (!ROUTING_CONTRACTS.has(contractId) || !contractAllowedForPackage(packageId, contractId)) {
    throw new NationalAccessError("contract is not available in requested package scope", {
      status: 403,
      code: "NATIONAL_ACCESS_DEVELOPER_CONTRACT_FORBIDDEN"
    });
  }
  const idempotencyKey = requiredText(payload.idempotencyKey, "idempotencyKey", 120);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$/.test(idempotencyKey)) {
    throw new NationalAccessError("idempotencyKey must contain 8-120 safe characters", {
      code: "NATIONAL_ACCESS_IDEMPOTENCY_KEY_INVALID"
    });
  }
  const payloadDigest = requiredText(payload.payloadDigest, "payloadDigest", 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(payloadDigest)) {
    throw new NationalAccessError("payloadDigest must be a SHA-256 hexadecimal digest", {
      code: "NATIONAL_ACCESS_SANDBOX_DIGEST_INVALID"
    });
  }
  const usageEvents = state.nationalApiUsageEvents || [];
  const replay = usageEvents.find((item) => (
    item.credentialId === credential.id && item.idempotencyKey === idempotencyKey
  ));
  if (replay) {
    return {
      event: replay,
      credential,
      duplicate: true,
      audit: null
    };
  }
  const quotaPolicy = (state.nationalApiQuotaPolicies || seedApiQuotaPolicies()).find((item) => (
    item.id === (credential.quotaPolicyId || `quota-${credential.environment}-default`)
    && item.status === "active"
  ));
  if (!quotaPolicy) {
    throw new NationalAccessError("active API quota policy not found", {
      status: 409,
      code: "NATIONAL_ACCESS_QUOTA_POLICY_MISSING"
    });
  }
  const minuteStart = now.getTime() - 60_000;
  const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const accepted = usageEvents.filter((item) => item.credentialId === credential.id && item.status === "accepted");
  const minuteUsage = accepted.filter((item) => new Date(item.at).getTime() >= minuteStart).length;
  const dailyUsage = accepted.filter((item) => new Date(item.at).getTime() >= dayStart).length;
  if (minuteUsage >= quotaPolicy.minuteLimit) {
    throw new NationalAccessError("developer credential minute quota exceeded", {
      status: 429,
      code: "NATIONAL_ACCESS_MINUTE_QUOTA_EXCEEDED"
    });
  }
  if (dailyUsage >= quotaPolicy.dailyLimit) {
    throw new NationalAccessError("developer credential daily quota exceeded", {
      status: 429,
      code: "NATIONAL_ACCESS_DAILY_QUOTA_EXCEEDED"
    });
  }
  const eventId = randomUUID();
  const event = {
    id: eventId,
    requestId: optionalText(payload.requestId || randomUUID(), 80),
    credentialId: credential.id,
    orgCode: credential.orgCode,
    environment: credential.environment,
    packageId,
    contractId,
    idempotencyKey,
    payloadDigest,
    payloadIncluded: false,
    status: "accepted",
    synthetic: true,
    latencyMs: 35,
    quotaPolicyId: quotaPolicy.id,
    minuteUsage: minuteUsage + 1,
    dailyUsage: dailyUsage + 1,
    responseMetadata: {
      acknowledgementId: `sandbox-ack-${eventId.slice(0, 12)}`,
      acceptedAt: now.toISOString(),
      processingMode: "synthetic-metadata-only"
    },
    at: now.toISOString()
  };
  const updatedCredential = {
    ...credential,
    lastUsedAt: now.toISOString(),
    usageCount: Number(credential.usageCount || 0) + 1
  };
  return {
    event,
    credential: updatedCredential,
    duplicate: false,
    audit: auditEntry(
      "developer-sandbox-invoke",
      event.id,
      developerActor(credential),
      `${credential.orgCode}/${packageId}/${contractId}`
    )
  };
}

function securityAlert(key, severity, category, targetType, targetId, orgCode, message, now) {
  return {
    id: `security-${createHash("sha256").update(key).digest("hex").slice(0, 16)}`,
    key,
    severity,
    category,
    targetType,
    targetId,
    orgCode,
    message,
    status: "open",
    detectedAt: now.toISOString(),
    updatedAt: now.toISOString(),
    productionEvidence: false
  };
}

function evaluateSecurityLifecycle(state, actor, options = {}) {
  const now = parseEvaluationTime(options.now);
  const institutions = state.nationalAccessInstitutions || [];
  const certificates = (state.nationalAccessCertificates || []).map((item) => ({ ...item }));
  const credentials = (state.nationalDeveloperCredentials || []).map((item) => ({ ...item }));
  const alerts = [];
  const evaluateEntity = (item, targetType, orgCode) => {
    if (item.status !== "active") return;
    const expiresAt = new Date(item.expiresAt);
    if (Number.isNaN(expiresAt.getTime())) {
      item.status = "expired";
      item.expiredAt = now.toISOString();
      alerts.push(securityAlert(
        `${targetType}-invalid-expiry:${item.id}`,
        "critical",
        "credential-lifecycle",
        targetType,
        item.id,
        orgCode,
        `${targetType} has an invalid expiry and was disabled`,
        now
      ));
      return;
    }
    const remainingDays = Math.ceil((expiresAt.getTime() - now.getTime()) / 86_400_000);
    if (remainingDays <= 0) {
      item.status = "expired";
      item.expiredAt = now.toISOString();
      alerts.push(securityAlert(
        `${targetType}-expired:${item.id}`,
        "critical",
        "credential-lifecycle",
        targetType,
        item.id,
        orgCode,
        `${targetType} has expired and was disabled`,
        now
      ));
      return;
    }
    if (remainingDays <= 30) {
      alerts.push(securityAlert(
        `${targetType}-expiring:${item.id}`,
        remainingDays <= 7 ? "critical" : "warning",
        "credential-lifecycle",
        targetType,
        item.id,
        orgCode,
        `${targetType} expires in ${remainingDays} day(s)`,
        now
      ));
    }
  };
  for (const certificate of certificates) {
    const institution = certificate.subjectType === "institution"
      ? institutions.find((item) => item.id === certificate.subjectId)
      : null;
    evaluateEntity(certificate, "certificate", institution?.orgCode || "");
  }
  for (const credential of credentials) {
    evaluateEntity(credential, "developer-credential", credential.orgCode);
  }
  return {
    evaluatedAt: now.toISOString(),
    certificates,
    credentials,
    alerts,
    summary: {
      activeCertificates: certificates.filter((item) => item.status === "active").length,
      expiredCertificates: certificates.filter((item) => item.status === "expired").length,
      activeCredentials: credentials.filter((item) => item.status === "active").length,
      expiredCredentials: credentials.filter((item) => item.status === "expired").length,
      alerts: alerts.length,
      critical: alerts.filter((item) => item.severity === "critical").length,
      warning: alerts.filter((item) => item.severity === "warning").length,
      productionReady: false
    },
    audit: auditEntry("security-lifecycle-evaluate", "national-access", actor, `${alerts.length} alerts`)
  };
}

function createCertificationReport(state, payload, actor, options = {}) {
  const now = parseEvaluationTime(options.now);
  const orgCode = normalizeCode(payload.orgCode, "orgCode");
  const environment = optionalText(payload.environment || "pilot", 32);
  if (!["sandbox", "pilot"].includes(environment)) {
    throw new NationalAccessError("production certification remains blocked until formal acceptance", {
      status: 409,
      code: "NATIONAL_ACCESS_PRODUCTION_CERTIFICATION_BLOCKED"
    });
  }
  const institution = (state.nationalAccessInstitutions || []).find((item) => item.orgCode === orgCode);
  if (!institution) {
    throw new NationalAccessError("institution not found", {
      status: 404,
      code: "NATIONAL_ACCESS_CERTIFICATION_INSTITUTION_NOT_FOUND"
    });
  }
  const node = (state.nationalAccessNodes || []).find((item) => item.id === institution.nodeId);
  const health = latestNodeHealth(state.nationalNodeHealthProbes, institution.nodeId);
  const subscriptions = (state.nationalServiceSubscriptions || []).filter((item) => item.orgCode === orgCode);
  const certificate = (state.nationalAccessCertificates || []).find((item) => (
    item.subjectType === "institution"
    && item.subjectId === institution.id
    && item.status === "active"
    && new Date(item.expiresAt).getTime() > now.getTime()
  ));
  const credential = (state.nationalDeveloperCredentials || []).find((item) => (
    item.orgCode === orgCode
    && item.status === "active"
    && new Date(item.expiresAt).getTime() > now.getTime()
  ));
  const openSecurityAlerts = (state.nationalSecurityAlerts || []).filter((item) => (
    item.orgCode === orgCode && item.status === "open"
  ));
  const checklist = [
    { id: "institution-active", name: "Institution is active", passed: institution.status === "active" },
    { id: "node-operational", name: "Access node is active and operational", passed: node?.status === "active" && Boolean(health) && health.status !== "unavailable" },
    { id: "identity-package", name: "Identity package subscription is active", passed: subscriptions.some((item) => item.packageId === "pkg-identity-basic" && item.status === "active") },
    { id: "business-package", name: "At least one business package is active", passed: subscriptions.some((item) => item.packageId !== "pkg-identity-basic" && item.status === "active") },
    { id: "access-certificate", name: "Institution access certificate is valid", passed: Boolean(certificate) },
    { id: "developer-credential", name: "Developer credential is valid", passed: Boolean(credential) },
    { id: "security-alerts", name: "No open credential security alert", passed: openSecurityAlerts.length === 0 }
  ];
  const passedCount = checklist.filter((item) => item.passed).length;
  const mandatoryPassed = checklist
    .filter((item) => ["institution-active", "node-operational", "identity-package", "access-certificate"].includes(item.id))
    .every((item) => item.passed);
  const status = passedCount === checklist.length ? "passed" : mandatoryPassed ? "conditional" : "failed";
  const candidateExpiries = [
    now.getTime() + 90 * 86_400_000,
    certificate ? new Date(certificate.expiresAt).getTime() : Infinity,
    credential ? new Date(credential.expiresAt).getTime() : Infinity
  ].filter(Number.isFinite);
  const id = randomUUID();
  const entity = {
    id,
    reportCode: `NHP-CERT-${orgCode}-${now.toISOString().slice(0, 10).replaceAll("-", "")}-${id.slice(0, 8).toUpperCase()}`,
    orgCode,
    institutionId: institution.id,
    nodeId: institution.nodeId,
    environment,
    status,
    score: Math.round((passedCount / checklist.length) * 100),
    checklist,
    activePackageIds: subscriptions.filter((item) => item.status === "active").map((item) => item.packageId),
    certificateId: certificate?.id || "",
    credentialId: credential?.id || "",
    openSecurityAlertIds: openSecurityAlerts.map((item) => item.id),
    productionReady: false,
    productionBlockers: [
      "formal CA and commercial cryptography evidence",
      "real institution and node network acceptance",
      "performance, security, disaster recovery and multi-party sign-off"
    ],
    issuedAt: now.toISOString(),
    validUntil: new Date(Math.min(...candidateExpiries)).toISOString(),
    issuedBy: actor?.username || actor?.name || "system"
  };
  return {
    entity,
    audit: auditEntry("institution-certification-report", entity.id, actor, `${orgCode}/${status}/${entity.score}`)
  };
}

function createConsentAuthorization(state, payload, actor) {
  const sourceOrgCode = normalizeCode(payload.sourceOrgCode, "sourceOrgCode");
  const targetOrgCodes = uniqueStrings(payload.targetOrgCodes, 30)
    .map((item) => normalizeCode(item, "targetOrgCodes"));
  if (!targetOrgCodes.length || targetOrgCodes.includes(sourceOrgCode)) {
    throw new NationalAccessError("targetOrgCodes must include at least one different institution", {
      code: "NATIONAL_ACCESS_CONSENT_TARGET_INVALID"
    });
  }
  const packageIds = uniqueStrings(payload.packageIds, 30);
  if (!packageIds.length) {
    throw new NationalAccessError("at least one service package is required", {
      code: "NATIONAL_ACCESS_CONSENT_PACKAGE_REQUIRED"
    });
  }
  const contractIds = uniqueStrings(payload.contractIds, 20);
  if (!contractIds.length || contractIds.some((item) => !ROUTING_CONTRACTS.has(item))) {
    throw new NationalAccessError("contractIds must contain supported national routing contracts", {
      code: "NATIONAL_ACCESS_CONSENT_CONTRACT_INVALID"
    });
  }
  const legalBasis = requiredText(payload.legalBasis, "legalBasis", 64);
  if (!CONSENT_LEGAL_BASES.has(legalBasis)) {
    throw new NationalAccessError("legalBasis is not supported", {
      code: "NATIONAL_ACCESS_CONSENT_LEGAL_BASIS_INVALID"
    });
  }
  const institutions = state.nationalAccessInstitutions || [];
  const source = institutions.find((item) => item.orgCode === sourceOrgCode && item.status === "active");
  const targets = targetOrgCodes.map((orgCode) => (
    institutions.find((item) => item.orgCode === orgCode && item.status === "active")
  ));
  if (!source || targets.some((item) => !item)) {
    throw new NationalAccessError("source and target institutions must be active", {
      status: 409,
      code: "NATIONAL_ACCESS_CONSENT_INSTITUTION_INACTIVE"
    });
  }
  for (const packageId of packageIds) {
    const packageItem = (state.nationalServicePackages || []).find((item) => item.id === packageId && item.status === "active");
    if (!packageItem) {
      throw new NationalAccessError(`service package ${packageId} is not active`, {
        status: 409,
        code: "NATIONAL_ACCESS_CONSENT_PACKAGE_INACTIVE"
      });
    }
    const missingSubscription = [sourceOrgCode, ...targetOrgCodes].find((orgCode) => (
      !(state.nationalServiceSubscriptions || []).some((item) => (
        item.orgCode === orgCode && item.packageId === packageId && item.status === "active"
      ))
    ));
    if (missingSubscription) {
      throw new NationalAccessError(`${missingSubscription} has no active subscription for ${packageId}`, {
        status: 409,
        code: "NATIONAL_ACCESS_CONSENT_SUBSCRIPTION_INACTIVE"
      });
    }
  }
  const incompatibleContract = contractIds.find((contractId) => (
    !packageIds.some((packageId) => contractAllowedForPackage(packageId, contractId))
  ));
  if (incompatibleContract) {
    throw new NationalAccessError(`${incompatibleContract} is not covered by selected packages`, {
      status: 409,
      code: "NATIONAL_ACCESS_CONSENT_CONTRACT_SCOPE_INVALID"
    });
  }
  const evidenceDigest = requiredText(payload.evidenceDigest, "evidenceDigest", 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(evidenceDigest)) {
    throw new NationalAccessError("evidenceDigest must be a SHA-256 hexadecimal digest", {
      code: "NATIONAL_ACCESS_CONSENT_EVIDENCE_DIGEST_INVALID"
    });
  }
  const validFrom = payload.validFrom ? new Date(payload.validFrom) : new Date();
  if (Number.isNaN(validFrom.getTime())) {
    throw new NationalAccessError("validFrom must be a valid date", {
      code: "NATIONAL_ACCESS_CONSENT_VALID_FROM_INVALID"
    });
  }
  const validUntil = futureExpiry(payload.validUntil, 90);
  if (new Date(validUntil).getTime() <= validFrom.getTime()) {
    throw new NationalAccessError("validUntil must be later than validFrom", {
      code: "NATIONAL_ACCESS_CONSENT_PERIOD_INVALID"
    });
  }
  const entity = {
    id: randomUUID(),
    reference: `nhc_${randomBytes(18).toString("base64url")}`,
    residentReference: requiredText(payload.residentReference, "residentReference", 120),
    sourceOrgCode,
    targetOrgCodes,
    packageIds,
    contractIds,
    purpose: requiredText(payload.purpose, "purpose", 120),
    legalBasis,
    evidenceDigest,
    evidenceIncluded: false,
    status: "active",
    validFrom: validFrom.toISOString(),
    validUntil,
    createdAt: nowIso(),
    createdBy: actor?.username || actor?.name || "system",
    productionEvidence: false
  };
  return {
    entity,
    audit: auditEntry(
      "consent-authorization-create",
      entity.id,
      actor,
      `${sourceOrgCode}->${targetOrgCodes.join(",")}/${packageIds.join(",")}`
    )
  };
}

function applyConsentAuthorizationAction(entity, action, actor) {
  if (!entity) {
    throw new NationalAccessError("consent authorization not found", {
      status: 404,
      code: "NATIONAL_ACCESS_CONSENT_NOT_FOUND"
    });
  }
  if (action !== "revoke" || entity.status !== "active") {
    throw new NationalAccessError(`consent action ${action} is not allowed from ${entity.status}`, {
      status: 409,
      code: "NATIONAL_ACCESS_CONSENT_ACTION_INVALID"
    });
  }
  const updated = {
    ...entity,
    status: "revoked",
    revokedAt: nowIso(),
    revokedBy: actor?.username || actor?.name || "system"
  };
  return {
    entity: updated,
    audit: auditEntry("consent-authorization-revoke", updated.id, actor, updated.reference)
  };
}

function validateConsentAuthorization(state, reference, route, contractId, options = {}) {
  const now = parseEvaluationTime(options.now);
  const consent = (state.nationalConsentAuthorizations || []).find((item) => item.reference === reference);
  if (!consent) {
    throw new NationalAccessError("consent authorization reference not found", {
      status: 409,
      code: "NATIONAL_ACCESS_CONSENT_REFERENCE_INVALID"
    });
  }
  if (
    consent.status !== "active"
    || new Date(consent.validFrom).getTime() > now.getTime()
    || new Date(consent.validUntil).getTime() <= now.getTime()
  ) {
    throw new NationalAccessError("consent authorization is inactive, revoked or expired", {
      status: 409,
      code: "NATIONAL_ACCESS_CONSENT_INACTIVE"
    });
  }
  if (
    consent.sourceOrgCode !== route.sourceOrgCode
    || !consent.targetOrgCodes.includes(route.targetOrgCode)
    || !consent.packageIds.includes(route.packageId)
    || !consent.contractIds.includes(contractId)
    || consent.purpose !== route.purpose
  ) {
    throw new NationalAccessError("route or contract exceeds consent authorization scope", {
      status: 403,
      code: "NATIONAL_ACCESS_CONSENT_SCOPE_FORBIDDEN"
    });
  }
  return consent;
}

function buildDeveloperSdkManifest(data = {}, user = null) {
  const state = normalizeState(data);
  const orgCode = user?.role === "institution" ? String(user.orgCode || "").toUpperCase() : "";
  const activePackageIds = new Set(
    state.nationalServiceSubscriptions
      .filter((item) => item.status === "active" && (!orgCode || item.orgCode === orgCode))
      .map((item) => item.packageId)
  );
  const packageIds = orgCode
    ? [...activePackageIds]
    : state.nationalServicePackages.filter((item) => item.status === "active").map((item) => item.id);
  const contracts = [...ROUTING_CONTRACTS].map((contractId) => ({
    id: contractId,
    packageIds: packageIds.filter((packageId) => contractAllowedForPackage(packageId, contractId)),
    metadataOnly: true,
    requiresConsent: contractId !== "ORG_NODE_REGISTER",
    productionReady: false
  })).filter((item) => item.packageIds.length);
  return {
    generatedAt: nowIso(),
    sdk: {
      name: "@national-health/access-client",
      version: "1.0.0",
      browserAsset: "/national-access-developer-sdk.js",
      invokeEndpoint: "/api/national-access/sandbox/invoke",
      authenticationHeader: "X-National-Access-Key",
      environments: ["sandbox", "pilot"],
      productionBlocked: true
    },
    requestSchema: {
      required: ["packageId", "contractId", "idempotencyKey", "payloadDigest"],
      payloadDigest: "lowercase SHA-256 hexadecimal digest",
      payloadIncluded: false,
      idempotencyKey: "8-120 safe characters"
    },
    consentSchema: {
      createEndpoint: "/api/national-access/consents",
      actionEndpoint: "/api/national-access/consents/:id/actions",
      requiredForRoutingEnvelope: true,
      evidencePolicy: "digest-only; authorization document remains in source system"
    },
    integrationSchema: {
      adapterEndpoint: "/api/national-access/adapters",
      contractTestEndpoint: "/api/national-access/adapters/:id/contract-tests",
      requiredChecks: CONTRACT_TEST_CHECKS,
      secretsAccepted: false,
      productionBlocked: true
    },
    callbackSchema: {
      subscriptionEndpoint: "/api/national-access/callbacks",
      deliveryActionEndpoint: "/api/national-access/callback-deliveries/:id/actions",
      eventTypes: [...CALLBACK_EVENT_TYPES],
      payloadIncluded: false,
      productionDeliveryBlocked: true
    },
    quotaPolicies: state.nationalApiQuotaPolicies.filter((item) => item.status === "active"),
    contracts,
    example: {
      packageId: activePackageIds.has("pkg-lab-imaging") || !orgCode ? "pkg-lab-imaging" : packageIds[0],
      contractId: activePackageIds.has("pkg-lab-imaging") || !orgCode ? "LIS_LAB_REPORT_PUBLISH" : contracts[0]?.id,
      idempotencyKey: "example-request-0001",
      payloadDigest: "0".repeat(64)
    }
  };
}

function sha256Digest(value, field, code = "NATIONAL_ACCESS_DIGEST_INVALID") {
  const digest = requiredText(value, field, 128).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new NationalAccessError(`${field} must be a SHA-256 hexadecimal digest`, { code });
  }
  return digest;
}

function activePackagesForInstitution(state, orgCode) {
  return new Set(
    (state.nationalServiceSubscriptions || [])
      .filter((item) => item.orgCode === orgCode && item.status === "active")
      .map((item) => item.packageId)
  );
}

function createIntegrationAdapter(state, payload, actor) {
  const orgCode = normalizeCode(payload.orgCode, "orgCode");
  const institution = (state.nationalAccessInstitutions || []).find((item) => (
    item.orgCode === orgCode && item.status === "active"
  ));
  if (!institution) {
    throw new NationalAccessError("integration adapter institution must be active", {
      status: 409,
      code: "NATIONAL_ACCESS_ADAPTER_INSTITUTION_INACTIVE"
    });
  }
  const systemType = requiredText(payload.systemType, "systemType", 40).toUpperCase();
  if (!INTEGRATION_SYSTEM_TYPES.has(systemType)) {
    throw new NationalAccessError("systemType is not supported", {
      code: "NATIONAL_ACCESS_ADAPTER_SYSTEM_INVALID"
    });
  }
  const environment = optionalText(payload.environment || "sandbox", 32);
  if (!["sandbox", "pilot"].includes(environment)) {
    throw new NationalAccessError("production adapters remain blocked until formal joint acceptance", {
      status: 409,
      code: "NATIONAL_ACCESS_PRODUCTION_ADAPTER_BLOCKED"
    });
  }
  const supportedContracts = uniqueStrings(payload.supportedContracts, 20);
  if (!supportedContracts.length) {
    throw new NationalAccessError("at least one supported contract is required", {
      code: "NATIONAL_ACCESS_ADAPTER_CONTRACT_REQUIRED"
    });
  }
  const invalidContract = supportedContracts.find((contractId) => (
    !ROUTING_CONTRACTS.has(contractId) || !SYSTEM_CONTRACTS[systemType]?.has(contractId)
  ));
  if (invalidContract) {
    throw new NationalAccessError(`contract ${invalidContract} is not valid for ${systemType}`, {
      code: "NATIONAL_ACCESS_ADAPTER_CONTRACT_INVALID"
    });
  }
  const activePackageIds = activePackagesForInstitution(state, orgCode);
  const unavailableContract = supportedContracts.find((contractId) => (
    ![...activePackageIds].some((packageId) => contractAllowedForPackage(packageId, contractId))
  ));
  if (unavailableContract) {
    throw new NationalAccessError(`contract ${unavailableContract} is outside active service packages`, {
      status: 409,
      code: "NATIONAL_ACCESS_ADAPTER_CONTRACT_INACTIVE"
    });
  }
  const certificateId = requiredText(payload.certificateId, "certificateId", 100);
  const certificate = (state.nationalAccessCertificates || []).find((item) => (
    item.id === certificateId
    && item.subjectType === "institution"
    && item.subjectId === institution.id
    && item.environment === environment
    && item.status === "active"
    && new Date(item.expiresAt).getTime() > Date.now()
  ));
  if (!certificate) {
    throw new NationalAccessError("an active institution certificate is required for this environment", {
      status: 409,
      code: "NATIONAL_ACCESS_ADAPTER_CERTIFICATE_INVALID"
    });
  }
  const duplicate = (state.nationalIntegrationAdapters || []).some((item) => (
    item.orgCode === orgCode
    && item.systemType === systemType
    && item.environment === environment
    && item.status !== "suspended"
  ));
  if (duplicate) {
    throw new NationalAccessError("an adapter already exists for this institution, system and environment", {
      status: 409,
      code: "NATIONAL_ACCESS_ADAPTER_EXISTS"
    });
  }
  const at = nowIso();
  const entity = {
    id: randomUUID(),
    orgCode,
    systemType,
    name: requiredText(payload.name, "name", 100),
    vendor: optionalText(payload.vendor, 100),
    systemVersion: optionalText(payload.systemVersion, 80),
    integrationMode: requiredText(payload.integrationMode, "integrationMode", 100),
    environment,
    endpointReference: requiredText(payload.endpointReference, "endpointReference", 180),
    certificateId,
    supportedContracts,
    adapterConfigDigest: sha256Digest(
      payload.adapterConfigDigest,
      "adapterConfigDigest",
      "NATIONAL_ACCESS_ADAPTER_CONFIG_DIGEST_INVALID"
    ),
    secretsIncluded: false,
    status: "configured",
    productionReady: false,
    createdAt: at,
    updatedAt: at,
    createdBy: actor?.username || actor?.name || "system"
  };
  return {
    entity,
    audit: auditEntry("integration-adapter-create", entity.id, actor, `${orgCode}/${systemType}/${environment}`)
  };
}

function runContractConformanceTest(state, adapterId, payload, actor) {
  const adapter = (state.nationalIntegrationAdapters || []).find((item) => item.id === adapterId);
  if (!adapter) {
    throw new NationalAccessError("integration adapter not found", {
      status: 404,
      code: "NATIONAL_ACCESS_ADAPTER_NOT_FOUND"
    });
  }
  if (adapter.status === "suspended") {
    throw new NationalAccessError("suspended integration adapter cannot run contract tests", {
      status: 409,
      code: "NATIONAL_ACCESS_ADAPTER_SUSPENDED"
    });
  }
  const contractId = requiredText(payload.contractId, "contractId", 80);
  if (!(adapter.supportedContracts || []).includes(contractId)) {
    throw new NationalAccessError("contract is outside adapter scope", {
      status: 403,
      code: "NATIONAL_ACCESS_CONTRACT_TEST_SCOPE_FORBIDDEN"
    });
  }
  const results = payload.results && typeof payload.results === "object" ? payload.results : {};
  const checklist = CONTRACT_TEST_CHECKS.map((check) => ({
    check,
    passed: results[check] === true
  }));
  const passed = checklist.every((item) => item.passed);
  const at = nowIso();
  const entity = {
    id: randomUUID(),
    adapterId: adapter.id,
    orgCode: adapter.orgCode,
    systemType: adapter.systemType,
    environment: adapter.environment,
    contractId,
    checklist,
    passedChecks: checklist.filter((item) => item.passed).length,
    totalChecks: checklist.length,
    evidenceDigest: sha256Digest(
      payload.evidenceDigest,
      "evidenceDigest",
      "NATIONAL_ACCESS_CONTRACT_TEST_EVIDENCE_INVALID"
    ),
    payloadIncluded: false,
    status: passed ? "passed" : "failed",
    productionReady: false,
    executedAt: at,
    executedBy: actor?.username || actor?.name || "system"
  };
  return {
    entity,
    audit: auditEntry("contract-conformance-test", entity.id, actor, `${adapter.orgCode}/${contractId}/${entity.status}`)
  };
}

function applyIntegrationAdapterAction(state, entity, action, actor) {
  if (!entity) {
    throw new NationalAccessError("integration adapter not found", {
      status: 404,
      code: "NATIONAL_ACCESS_ADAPTER_NOT_FOUND"
    });
  }
  if (action === "suspend" && ["configured", "verified"].includes(entity.status)) {
    const updated = {
      ...entity,
      status: "suspended",
      suspendedAt: nowIso(),
      suspendedBy: actor?.username || actor?.name || "system",
      updatedAt: nowIso()
    };
    return {
      entity: updated,
      audit: auditEntry("integration-adapter-suspend", updated.id, actor, updated.orgCode)
    };
  }
  if (action === "verify" && ["configured", "suspended"].includes(entity.status)) {
    if (actor?.role !== "commission") {
      throw new NationalAccessError("only national administrators may verify an integration adapter", {
        status: 403,
        code: "NATIONAL_ACCESS_ADAPTER_VERIFY_FORBIDDEN"
      });
    }
    const testRuns = state.nationalContractTestRuns || [];
    const missingContract = (entity.supportedContracts || []).find((contractId) => (
      !testRuns.some((item) => (
        item.adapterId === entity.id && item.contractId === contractId && item.status === "passed"
      ))
    ));
    if (missingContract) {
      throw new NationalAccessError(`contract ${missingContract} has no passed conformance test`, {
        status: 409,
        code: "NATIONAL_ACCESS_ADAPTER_TESTS_INCOMPLETE"
      });
    }
    const updated = {
      ...entity,
      status: "verified",
      verifiedAt: nowIso(),
      verifiedBy: actor?.username || actor?.name || "system",
      updatedAt: nowIso()
    };
    return {
      entity: updated,
      audit: auditEntry("integration-adapter-verify", updated.id, actor, updated.orgCode)
    };
  }
  throw new NationalAccessError(`adapter action ${action} is not allowed from ${entity.status}`, {
    status: 409,
    code: "NATIONAL_ACCESS_ADAPTER_ACTION_INVALID"
  });
}

function createCallbackSubscription(state, payload, actor) {
  const orgCode = normalizeCode(payload.orgCode, "orgCode");
  const institution = (state.nationalAccessInstitutions || []).find((item) => (
    item.orgCode === orgCode && item.status === "active"
  ));
  if (!institution) {
    throw new NationalAccessError("callback institution must be active", {
      status: 409,
      code: "NATIONAL_ACCESS_CALLBACK_INSTITUTION_INACTIVE"
    });
  }
  const environment = optionalText(payload.environment || "sandbox", 32);
  if (!["sandbox", "pilot"].includes(environment)) {
    throw new NationalAccessError("production callback subscriptions remain blocked until formal acceptance", {
      status: 409,
      code: "NATIONAL_ACCESS_PRODUCTION_CALLBACK_BLOCKED"
    });
  }
  const eventTypes = uniqueStrings(payload.eventTypes, 20);
  if (!eventTypes.length || eventTypes.some((item) => !CALLBACK_EVENT_TYPES.has(item))) {
    throw new NationalAccessError("eventTypes contains an unsupported callback event", {
      code: "NATIONAL_ACCESS_CALLBACK_EVENT_INVALID"
    });
  }
  const publicKeyFingerprint = sha256Digest(
    String(payload.publicKeyFingerprint || "").replaceAll(":", ""),
    "publicKeyFingerprint",
    "NATIONAL_ACCESS_CALLBACK_FINGERPRINT_INVALID"
  );
  const endpointReference = requiredText(payload.endpointReference, "endpointReference", 180);
  const duplicate = (state.nationalCallbackSubscriptions || []).some((item) => (
    item.orgCode === orgCode
    && item.environment === environment
    && item.endpointReference === endpointReference
    && item.status === "active"
  ));
  if (duplicate) {
    throw new NationalAccessError("active callback subscription already exists", {
      status: 409,
      code: "NATIONAL_ACCESS_CALLBACK_EXISTS"
    });
  }
  const entity = {
    id: randomUUID(),
    orgCode,
    name: requiredText(payload.name, "name", 100),
    environment,
    endpointReference,
    eventTypes,
    publicKeyFingerprint,
    signatureAlgorithm: "detached-signature",
    secretsIncluded: false,
    status: "active",
    productionReady: false,
    createdAt: nowIso(),
    createdBy: actor?.username || actor?.name || "system"
  };
  return {
    entity,
    audit: auditEntry("callback-subscription-create", entity.id, actor, `${orgCode}/${eventTypes.join(",")}`)
  };
}

function applyCallbackSubscriptionAction(entity, action, actor) {
  if (!entity) {
    throw new NationalAccessError("callback subscription not found", {
      status: 404,
      code: "NATIONAL_ACCESS_CALLBACK_NOT_FOUND"
    });
  }
  if (action !== "revoke" || entity.status !== "active") {
    throw new NationalAccessError(`callback action ${action} is not allowed from ${entity.status}`, {
      status: 409,
      code: "NATIONAL_ACCESS_CALLBACK_ACTION_INVALID"
    });
  }
  const updated = {
    ...entity,
    status: "revoked",
    revokedAt: nowIso(),
    revokedBy: actor?.username || actor?.name || "system"
  };
  return {
    entity: updated,
    audit: auditEntry("callback-subscription-revoke", updated.id, actor, updated.orgCode)
  };
}

function createCallbackDeliveries(state, event, actor) {
  const orgCode = normalizeCode(event.orgCode, "orgCode");
  const eventType = requiredText(event.eventType, "eventType", 80);
  if (!CALLBACK_EVENT_TYPES.has(eventType)) {
    throw new NationalAccessError("unsupported callback event type", {
      code: "NATIONAL_ACCESS_CALLBACK_EVENT_INVALID"
    });
  }
  const subjectReference = requiredText(event.subjectReference, "subjectReference", 160);
  const eventDigest = sha256Digest(
    event.eventDigest,
    "eventDigest",
    "NATIONAL_ACCESS_CALLBACK_EVENT_DIGEST_INVALID"
  );
  const subscriptions = (state.nationalCallbackSubscriptions || []).filter((item) => (
    item.orgCode === orgCode
    && item.status === "active"
    && (item.eventTypes || []).includes(eventType)
  ));
  const entities = subscriptions.map((subscription) => {
    const id = randomUUID();
    return {
      id,
      subscriptionId: subscription.id,
      orgCode,
      environment: subscription.environment,
      endpointReference: subscription.endpointReference,
      eventType,
      subjectReference,
      eventDigest,
      idempotencyKey: createHash("sha256")
        .update(`${subscription.id}|${eventType}|${subjectReference}|${eventDigest}`)
        .digest("hex"),
      signatureAlgorithm: subscription.signatureAlgorithm,
      payloadIncluded: false,
      status: "prepared",
      attemptCount: 1,
      productionDelivered: false,
      preparedAt: nowIso()
    };
  });
  return {
    entities,
    audits: entities.map((item) => (
      auditEntry("callback-delivery-prepare", item.id, actor, `${orgCode}/${eventType}/${subjectReference}`)
    ))
  };
}

function applyCallbackDeliveryAction(entity, action, payload, actor) {
  if (!entity) {
    throw new NationalAccessError("callback delivery not found", {
      status: 404,
      code: "NATIONAL_ACCESS_CALLBACK_DELIVERY_NOT_FOUND"
    });
  }
  if (!["acknowledge", "reject"].includes(action) || entity.status !== "prepared") {
    throw new NationalAccessError(`callback delivery action ${action} is not allowed from ${entity.status}`, {
      status: 409,
      code: "NATIONAL_ACCESS_CALLBACK_DELIVERY_ACTION_INVALID"
    });
  }
  const updated = {
    ...entity,
    status: action === "acknowledge" ? "acknowledged" : "rejected",
    receiptDigest: sha256Digest(
      payload.receiptDigest,
      "receiptDigest",
      "NATIONAL_ACCESS_CALLBACK_RECEIPT_DIGEST_INVALID"
    ),
    receiptCode: optionalText(payload.receiptCode, 100),
    acknowledgedAt: nowIso(),
    acknowledgedBy: actor?.username || actor?.name || "system"
  };
  return {
    entity: updated,
    audit: auditEntry(`callback-delivery-${action}`, updated.id, actor, `${updated.orgCode}/${updated.eventType}`)
  };
}

function recordNodeHealthProbe(state, payload, actor) {
  const nodeId = requiredText(payload.nodeId, "nodeId", 64);
  const node = (state.nationalAccessNodes || []).find((item) => item.id === nodeId);
  if (!node) {
    throw new NationalAccessError("node not found", {
      status: 404,
      code: "NATIONAL_ACCESS_NODE_NOT_FOUND"
    });
  }
  const status = requiredText(payload.status, "status", 32);
  if (!NODE_HEALTH_STATUSES.has(status)) {
    throw new NationalAccessError("status must be healthy, degraded or unavailable", {
      code: "NATIONAL_ACCESS_HEALTH_STATUS_INVALID"
    });
  }
  const latencyMs = Number(payload.latencyMs);
  if (!Number.isFinite(latencyMs) || latencyMs < 0 || latencyMs > 120_000) {
    throw new NationalAccessError("latencyMs must be between 0 and 120000", {
      code: "NATIONAL_ACCESS_LATENCY_INVALID"
    });
  }
  const entity = {
    id: randomUUID(),
    nodeId,
    status,
    latencyMs: Math.round(latencyMs),
    checkedAt: nowIso(),
    checkedBy: actor?.username || actor?.name || "system",
    detail: optionalText(payload.detail, 240)
  };
  return {
    entity,
    audit: auditEntry("node-health-probe", nodeId, actor, `${status}/${entity.latencyMs}ms`)
  };
}

function latestNodeHealth(probes, nodeId) {
  return (probes || [])
    .filter((item) => item.nodeId === nodeId)
    .sort((left, right) => String(right.checkedAt || "").localeCompare(String(left.checkedAt || "")))[0] || null;
}

function assertActiveSubscription(state, orgCode, packageId) {
  const found = (state.nationalServiceSubscriptions || []).find((item) => (
    item.orgCode === orgCode && item.packageId === packageId && item.status === "active"
  ));
  if (!found) {
    throw new NationalAccessError(`${orgCode} does not have active package ${packageId}`, {
      status: 409,
      code: "NATIONAL_ACCESS_ROUTE_PACKAGE_INACTIVE"
    });
  }
  return found;
}

function selectOperationalNode(state, institution) {
  const nodes = state.nationalAccessNodes || [];
  const primary = nodes.find((item) => item.id === institution.nodeId && item.status === "active");
  const primaryHealth = primary ? latestNodeHealth(state.nationalNodeHealthProbes, primary.id) : null;
  if (primary && primaryHealth?.status !== "unavailable") {
    return { node: primary, health: primaryHealth, failoverFromNodeId: "" };
  }
  const provinceCode = institution.regionCode.slice(0, 2);
  const candidate = nodes.find((item) => (
    item.id !== institution.nodeId
    && item.status === "active"
    && item.regionCode.slice(0, 2) === provinceCode
    && (item.capabilities || []).includes("clinical-routing")
    && latestNodeHealth(state.nationalNodeHealthProbes, item.id)?.status === "healthy"
  ));
  if (!candidate) return { node: null, health: null, failoverFromNodeId: institution.nodeId };
  return {
    node: candidate,
    health: latestNodeHealth(state.nationalNodeHealthProbes, candidate.id),
    failoverFromNodeId: institution.nodeId
  };
}

function planCrossProvinceRoute(state, payload, actor) {
  const sourceOrgCode = normalizeCode(payload.sourceOrgCode, "sourceOrgCode");
  const targetOrgCode = normalizeCode(payload.targetOrgCode, "targetOrgCode");
  if (sourceOrgCode === targetOrgCode) {
    throw new NationalAccessError("source and target institutions must be different", {
      code: "NATIONAL_ACCESS_ROUTE_SAME_INSTITUTION"
    });
  }
  const packageId = optionalText(payload.packageId || "pkg-lab-imaging", 64);
  const institutions = state.nationalAccessInstitutions || [];
  const source = institutions.find((item) => item.orgCode === sourceOrgCode && item.status === "active");
  const target = institutions.find((item) => item.orgCode === targetOrgCode && item.status === "active");
  if (!source || !target) {
    throw new NationalAccessError("source and target institutions must both be active", {
      status: 409,
      code: "NATIONAL_ACCESS_ROUTE_INSTITUTION_INACTIVE"
    });
  }
  assertActiveSubscription(state, sourceOrgCode, packageId);
  assertActiveSubscription(state, targetOrgCode, packageId);
  const sourceSelection = selectOperationalNode(state, source);
  const targetSelection = selectOperationalNode(state, target);
  const sourceNode = sourceSelection.node;
  const targetNode = targetSelection.node;
  if (!sourceNode || !targetNode) {
    throw new NationalAccessError("no healthy active primary or failover node is available", {
      status: 503,
      code: "NATIONAL_ACCESS_ROUTE_NODE_UNAVAILABLE"
    });
  }
  const sourceHealth = sourceSelection.health;
  const targetHealth = targetSelection.health;
  const crossProvince = source.regionCode.slice(0, 2) !== target.regionCode.slice(0, 2);
  const hops = sourceNode.id === targetNode.id
    ? [sourceNode.id]
    : [sourceNode.id, "node-national", targetNode.id].filter((item, index, all) => all.indexOf(item) === index);
  const estimatedLatencyMs = hops.reduce((total, nodeId) => (
    total + Number(latestNodeHealth(state.nationalNodeHealthProbes, nodeId)?.latencyMs || 100)
  ), 0);
  const at = nowIso();
  const entity = {
    id: randomUUID(),
    requestId: optionalText(payload.requestId || randomUUID(), 80),
    sourceOrgCode,
    targetOrgCode,
    sourceNodeId: sourceNode.id,
    targetNodeId: targetNode.id,
    primarySourceNodeId: source.nodeId,
    primaryTargetNodeId: target.nodeId,
    sourceFailoverFromNodeId: sourceSelection.failoverFromNodeId,
    targetFailoverFromNodeId: targetSelection.failoverFromNodeId,
    packageId,
    purpose: optionalText(payload.purpose || "authorized-clinical-query", 120),
    residentReference: optionalText(payload.residentReference, 120),
    crossProvince,
    hops,
    estimatedLatencyMs,
    status: sourceSelection.failoverFromNodeId || targetSelection.failoverFromNodeId
      ? "failover"
      : sourceHealth?.status === "degraded" || targetHealth?.status === "degraded"
        ? "degraded"
        : "ready",
    dataPolicy: "minimum necessary result; source-controlled business data; metadata-first routing",
    plannedBy: actor?.username || actor?.name || "system",
    plannedAt: at
  };
  return {
    entity,
    audit: auditEntry("cross-province-route-plan", entity.id, actor, `${sourceOrgCode}->${targetOrgCode}/${packageId}`)
  };
}

function createRoutingEnvelope(state, payload, actor) {
  const routeId = requiredText(payload.routeId, "routeId", 80);
  const route = (state.nationalRoutingTraces || []).find((item) => item.id === routeId);
  if (!route || !["ready", "degraded", "failover"].includes(route.status)) {
    throw new NationalAccessError("ready routing trace not found", {
      status: 409,
      code: "NATIONAL_ACCESS_ENVELOPE_ROUTE_INVALID"
    });
  }
  const contractId = requiredText(payload.contractId, "contractId", 80);
  if (!ROUTING_CONTRACTS.has(contractId)) {
    throw new NationalAccessError("contractId is not a supported national routing contract", {
      code: "NATIONAL_ACCESS_ENVELOPE_CONTRACT_INVALID"
    });
  }
  const payloadDigest = requiredText(payload.payloadDigest, "payloadDigest", 128).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(payloadDigest)) {
    throw new NationalAccessError("payloadDigest must be a SHA-256 hexadecimal digest", {
      code: "NATIONAL_ACCESS_ENVELOPE_DIGEST_INVALID"
    });
  }
  const consentReference = requiredText(payload.consentReference, "consentReference", 120);
  const consent = validateConsentAuthorization(state, consentReference, route, contractId);
  const source = (state.nationalAccessInstitutions || []).find((item) => item.orgCode === route.sourceOrgCode);
  const target = (state.nationalAccessInstitutions || []).find((item) => item.orgCode === route.targetOrgCode);
  const entity = {
    id: randomUUID(),
    traceId: optionalText(payload.traceId || randomUUID(), 80),
    routeId,
    requestId: route.requestId,
    contractId,
    schemaVersion: optionalText(payload.schemaVersion || "1.0.0", 32),
    sourceOrgCode: route.sourceOrgCode,
    targetOrgCode: route.targetOrgCode,
    sourceTenantId: source?.tenantId || "",
    targetTenantId: target?.tenantId || "",
    sourceNodeId: route.sourceNodeId,
    targetNodeId: route.targetNodeId,
    hops: route.hops,
    purpose: route.purpose,
    consentId: consent.id,
    consentReference,
    consentLegalBasis: consent.legalBasis,
    consentEvidenceDigest: consent.evidenceDigest,
    payloadDigest,
    payloadIncluded: false,
    signatureRequirement: "mTLS + JWS/SM2 production signature",
    status: "prepared",
    createdAt: nowIso(),
    createdBy: actor?.username || actor?.name || "system"
  };
  return {
    entity,
    audit: auditEntry("routing-envelope-create", entity.id, actor, `${contractId}/${route.sourceOrgCode}->${route.targetOrgCode}`)
  };
}

function slaAlert(key, severity, category, targetId, message, value, threshold, now) {
  return {
    id: `sla-${createHash("sha256").update(key).digest("hex").slice(0, 16)}`,
    key,
    severity,
    category,
    targetId,
    message,
    value,
    threshold,
    status: "open",
    detectedAt: now,
    updatedAt: now,
    productionEvidence: false
  };
}

function evaluateOperations(state, actor, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  if (Number.isNaN(now.getTime())) {
    throw new NationalAccessError("now must be a valid date", {
      code: "NATIONAL_ACCESS_OPERATIONS_TIME_INVALID"
    });
  }
  const policies = state.nationalSlaPolicies || seedSlaPolicies();
  const nodeLatencyPolicy = policies.find((item) => item.id === "sla-node-latency");
  const routeLatencyPolicy = policies.find((item) => item.id === "sla-route-latency");
  const freshnessPolicy = policies.find((item) => item.id === "sla-health-freshness");
  const alerts = [];
  const activeNodes = (state.nationalAccessNodes || []).filter((item) => item.status === "active");
  for (const node of activeNodes) {
    const health = latestNodeHealth(state.nationalNodeHealthProbes, node.id);
    if (!health) {
      alerts.push(slaAlert(`node-missing:${node.id}`, "critical", "node-health", node.id, "节点缺少健康探测", null, 0, now.toISOString()));
      continue;
    }
    const freshnessMinutes = Math.max(0, (now.getTime() - new Date(health.checkedAt).getTime()) / 60_000);
    if (health.status === "unavailable") {
      alerts.push(slaAlert(`node-unavailable:${node.id}`, "critical", "node-health", node.id, "节点不可用，已触发路由故障转移", health.status, "healthy", now.toISOString()));
    } else if (health.status === "degraded") {
      alerts.push(slaAlert(`node-degraded:${node.id}`, "warning", "node-health", node.id, "节点处于降级状态", health.status, "healthy", now.toISOString()));
    }
    if (nodeLatencyPolicy && health.latencyMs >= nodeLatencyPolicy.warningThreshold) {
      const severity = health.latencyMs >= nodeLatencyPolicy.criticalThreshold ? "critical" : "warning";
      alerts.push(slaAlert(`node-latency:${node.id}`, severity, "node-latency", node.id, "节点探测延迟超过SLA", health.latencyMs, severity === "critical" ? nodeLatencyPolicy.criticalThreshold : nodeLatencyPolicy.warningThreshold, now.toISOString()));
    }
    if (freshnessPolicy && freshnessMinutes >= freshnessPolicy.warningThreshold) {
      const severity = freshnessMinutes >= freshnessPolicy.criticalThreshold ? "critical" : "warning";
      alerts.push(slaAlert(`node-freshness:${node.id}`, severity, "node-health", node.id, "节点健康探测已过期", Math.round(freshnessMinutes), severity === "critical" ? freshnessPolicy.criticalThreshold : freshnessPolicy.warningThreshold, now.toISOString()));
    }
  }
  for (const route of (state.nationalRoutingTraces || []).slice(0, 500)) {
    if (!routeLatencyPolicy || route.estimatedLatencyMs < routeLatencyPolicy.warningThreshold) continue;
    const severity = route.estimatedLatencyMs >= routeLatencyPolicy.criticalThreshold ? "critical" : "warning";
    alerts.push(slaAlert(`route-latency:${route.id}`, severity, "route-latency", route.id, "跨省路由预计延迟超过SLA", route.estimatedLatencyMs, severity === "critical" ? routeLatencyPolicy.criticalThreshold : routeLatencyPolicy.warningThreshold, now.toISOString()));
  }
  return {
    evaluatedAt: now.toISOString(),
    alerts,
    summary: {
      activeNodes: activeNodes.length,
      alerts: alerts.length,
      critical: alerts.filter((item) => item.severity === "critical").length,
      warning: alerts.filter((item) => item.severity === "warning").length,
      failoverRoutes: (state.nationalRoutingTraces || []).filter((item) => item.status === "failover").length,
      productionReady: false
    },
    audit: auditEntry("operations-evaluate", "national-access", actor, `${alerts.length} alerts`)
  };
}

function registerStandardExtension(state, payload, actor) {
  const nodeId = requiredText(payload.nodeId, "nodeId", 80);
  const node = (state.nationalAccessNodes || []).find((item) => item.id === nodeId && item.status === "active");
  if (!node) {
    throw new NationalAccessError("active node not found", {
      status: 409,
      code: "NATIONAL_ACCESS_STANDARD_NODE_INACTIVE"
    });
  }
  const standardId = requiredText(payload.standardId, "standardId", 80);
  const standard = (state.nationalStandards || []).find((item) => item.id === standardId && item.status === "active");
  if (!standard) {
    throw new NationalAccessError("active national standard not found", {
      status: 404,
      code: "NATIONAL_ACCESS_STANDARD_NOT_FOUND"
    });
  }
  const basedOnVersion = requiredText(payload.basedOnVersion, "basedOnVersion", 32);
  const extensionVersion = requiredText(payload.extensionVersion, "extensionVersion", 32);
  const fields = uniqueStrings(payload.fields, 100);
  const conflictReasons = [];
  if (basedOnVersion !== standard.version) {
    conflictReasons.push(`basedOnVersion ${basedOnVersion} does not match national version ${standard.version}`);
  }
  const invalidField = fields.find((field) => !field.startsWith(`${node.nodeCode}.`));
  if (invalidField) {
    conflictReasons.push(`extension field ${invalidField} must use namespace ${node.nodeCode}.`);
  }
  const entity = {
    id: randomUUID(),
    nodeId,
    standardId,
    basedOnVersion,
    extensionVersion,
    name: requiredText(payload.name, "name", 120),
    fields,
    status: conflictReasons.length ? "conflict" : "compatible",
    conflictReasons,
    submittedAt: nowIso(),
    submittedBy: actor?.username || actor?.name || "system",
    reviewedAt: null,
    reviewedBy: ""
  };
  return {
    entity,
    audit: auditEntry("standard-extension-register", entity.id, actor, `${node.nodeCode}/${standard.code}/${entity.status}`)
  };
}

function applyStandardExtensionAction(entity, action, actor) {
  if (!entity) {
    throw new NationalAccessError("standard extension not found", {
      status: 404,
      code: "NATIONAL_ACCESS_STANDARD_EXTENSION_NOT_FOUND"
    });
  }
  if (action === "approve" && entity.status === "compatible") {
    const updated = { ...entity, status: "approved", reviewedAt: nowIso(), reviewedBy: actor?.username || actor?.name || "system" };
    return { entity: updated, audit: auditEntry("standard-extension-approve", updated.id, actor, updated.standardId) };
  }
  if (action === "reject" && ["compatible", "conflict"].includes(entity.status)) {
    const updated = { ...entity, status: "rejected", reviewedAt: nowIso(), reviewedBy: actor?.username || actor?.name || "system" };
    return { entity: updated, audit: auditEntry("standard-extension-reject", updated.id, actor, updated.standardId) };
  }
  throw new NationalAccessError(`standard extension action ${action} is not allowed from ${entity.status}`, {
    status: 409,
    code: "NATIONAL_ACCESS_STANDARD_EXTENSION_ACTION_INVALID"
  });
}

const ENTITY_TRANSITIONS = {
  submitted: { verify: "verified", suspend: "suspended" },
  verified: { activate: "active", suspend: "suspended" },
  active: { suspend: "suspended" },
  suspended: { verify: "verified", activate: "active" }
};

const SUBSCRIPTION_TRANSITIONS = {
  requested: { approve: "approved", cancel: "cancelled" },
  approved: { activate: "active", suspend: "suspended", cancel: "cancelled" },
  active: { suspend: "suspended", cancel: "cancelled" },
  suspended: { activate: "active", cancel: "cancelled" },
  cancelled: {}
};

function applyLifecycleAction(entity, action, actor, kind) {
  if (!entity) {
    throw new NationalAccessError(`${kind} not found`, { status: 404, code: "NATIONAL_ACCESS_ENTITY_NOT_FOUND" });
  }
  const transitions = kind === "subscription" ? SUBSCRIPTION_TRANSITIONS : ENTITY_TRANSITIONS;
  const nextStatus = transitions[entity.status]?.[action];
  if (!nextStatus) {
    throw new NationalAccessError(`action ${action} is not allowed from ${entity.status}`, {
      status: 409,
      code: "NATIONAL_ACCESS_TRANSITION_INVALID"
    });
  }
  const at = nowIso();
  const updated = {
    ...entity,
    status: nextStatus,
    updatedAt: at,
    lastAction: action,
    lastActionBy: actor?.username || actor?.name || "system"
  };
  if (action === "verify") {
    updated.certification = { level: "candidate", verifiedAt: at, verifiedBy: updated.lastActionBy };
  }
  if (action === "activate") {
    updated.activatedAt = at;
    if (kind !== "subscription") {
      updated.certification = {
        ...(updated.certification || {}),
        level: "certified",
        certifiedAt: at,
        certifiedBy: updated.lastActionBy
      };
    }
  }
  if (action === "approve") {
    updated.approvedAt = at;
    updated.approvedBy = updated.lastActionBy;
  }
  return {
    entity: updated,
    audit: auditEntry(`${kind}-${action}`, updated.id, actor, `${entity.status}->${nextStatus}`)
  };
}

function countBy(items, field) {
  return items.reduce((acc, item) => {
    const key = String(item[field] || "unknown");
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function buildCenter(data = {}, user = null) {
  const state = normalizeState(data);
  const isInstitution = user?.role === "institution";
  const orgCode = String(user?.orgCode || "").toUpperCase();
  const institutions = isInstitution
    ? state.nationalAccessInstitutions.filter((item) => item.orgCode === orgCode)
    : state.nationalAccessInstitutions;
  const visibleOrgCodes = new Set(institutions.map((item) => item.orgCode));
  const visibleInstitutionIds = new Set(institutions.map((item) => item.id));
  const subscriptions = isInstitution
    ? state.nationalServiceSubscriptions.filter((item) => visibleOrgCodes.has(item.orgCode))
    : state.nationalServiceSubscriptions;
  const visibleNodeIds = new Set(institutions.map((item) => item.nodeId));
  const nodes = isInstitution
    ? state.nationalAccessNodes.filter((item) => item.nodeType === "national" || visibleNodeIds.has(item.id))
    : state.nationalAccessNodes;
  const visibleNodeIdSet = new Set(nodes.map((item) => item.id));
  const nodeHealth = state.nationalNodeHealthProbes
    .filter((item) => visibleNodeIdSet.has(item.nodeId))
    .sort((left, right) => String(right.checkedAt || "").localeCompare(String(left.checkedAt || "")));
  const latestHealthByNode = nodes.map((node) => ({
    nodeId: node.id,
    nodeCode: node.nodeCode,
    nodeName: node.name,
    nodeStatus: node.status,
    health: latestNodeHealth(nodeHealth, node.id)
  }));
  const routingTraces = isInstitution
    ? state.nationalRoutingTraces.filter((item) => item.sourceOrgCode === orgCode || item.targetOrgCode === orgCode)
    : state.nationalRoutingTraces;
  const visibleRouteIds = new Set(routingTraces.map((item) => item.id));
  const routingEnvelopes = isInstitution
    ? state.nationalRoutingEnvelopes.filter((item) => visibleRouteIds.has(item.routeId))
    : state.nationalRoutingEnvelopes;
  const consentAuthorizations = isInstitution
    ? state.nationalConsentAuthorizations.filter((item) => (
      item.sourceOrgCode === orgCode || (item.targetOrgCodes || []).includes(orgCode)
    ))
    : state.nationalConsentAuthorizations;
  const integrationAdapters = isInstitution
    ? state.nationalIntegrationAdapters.filter((item) => item.orgCode === orgCode)
    : state.nationalIntegrationAdapters;
  const visibleAdapterIds = new Set(integrationAdapters.map((item) => item.id));
  const contractTestRuns = isInstitution
    ? state.nationalContractTestRuns.filter((item) => visibleAdapterIds.has(item.adapterId))
    : state.nationalContractTestRuns;
  const callbackSubscriptions = isInstitution
    ? state.nationalCallbackSubscriptions.filter((item) => item.orgCode === orgCode)
    : state.nationalCallbackSubscriptions;
  const visibleCallbackIds = new Set(callbackSubscriptions.map((item) => item.id));
  const callbackDeliveries = isInstitution
    ? state.nationalCallbackDeliveries.filter((item) => visibleCallbackIds.has(item.subscriptionId))
    : state.nationalCallbackDeliveries;
  const certificates = isInstitution
    ? state.nationalAccessCertificates.filter((item) => (
      item.subjectType === "institution" && visibleInstitutionIds.has(item.subjectId)
    ) || (item.subjectType === "node" && visibleNodeIdSet.has(item.subjectId)))
    : state.nationalAccessCertificates;
  const developerCredentials = state.nationalDeveloperCredentials
    .filter((item) => !isInstitution || item.orgCode === orgCode)
    .map(({ secretHash, ...item }) => item);
  const slaAlerts = isInstitution
    ? state.nationalSlaAlerts.filter((item) => visibleNodeIdSet.has(item.targetId) || visibleRouteIds.has(item.targetId))
    : state.nationalSlaAlerts;
  const standardExtensions = isInstitution
    ? state.nationalStandardExtensions.filter((item) => visibleNodeIdSet.has(item.nodeId))
    : state.nationalStandardExtensions;
  const apiUsageEvents = isInstitution
    ? state.nationalApiUsageEvents.filter((item) => item.orgCode === orgCode)
    : state.nationalApiUsageEvents;
  const securityAlerts = isInstitution
    ? state.nationalSecurityAlerts.filter((item) => item.orgCode === orgCode)
    : state.nationalSecurityAlerts;
  const certificationReports = isInstitution
    ? state.nationalCertificationReports.filter((item) => item.orgCode === orgCode)
    : state.nationalCertificationReports;
  const activeLabRegions = new Set(
    subscriptions
      .filter((item) => item.packageId === "pkg-lab-imaging" && item.status === "active")
      .map((item) => institutions.find((institution) => institution.orgCode === item.orgCode)?.regionCode?.slice(0, 2))
      .filter(Boolean)
  );
  return {
    generatedAt: nowIso(),
    architecture: {
      model: "1+N+M",
      nationalHub: "node-national",
      dataPolicy: "centralized metadata and service catalog; federated business data routed on demand",
      accessPolicy: "institutions subscribe to service packages on demand"
    },
    summary: {
      nodes: nodes.length,
      activeNodes: nodes.filter((item) => item.status === "active").length,
      institutions: institutions.length,
      activeInstitutions: institutions.filter((item) => item.status === "active").length,
      servicePackages: state.nationalServicePackages.filter((item) => item.status === "active").length,
      activeSubscriptions: subscriptions.filter((item) => item.status === "active").length,
      healthyNodes: latestHealthByNode.filter((item) => item.health?.status === "healthy").length,
      degradedNodes: latestHealthByNode.filter((item) => item.health?.status === "degraded").length,
      unavailableNodes: latestHealthByNode.filter((item) => item.health?.status === "unavailable").length,
      routesPlanned: routingTraces.length,
      routingEnvelopes: routingEnvelopes.length,
      activeConsentAuthorizations: consentAuthorizations.filter((item) => (
        item.status === "active"
        && new Date(item.validFrom).getTime() <= Date.now()
        && new Date(item.validUntil).getTime() > Date.now()
      )).length,
      integrationAdapters: integrationAdapters.length,
      verifiedIntegrationAdapters: integrationAdapters.filter((item) => item.status === "verified").length,
      passedContractTests: contractTestRuns.filter((item) => item.status === "passed").length,
      activeCallbackSubscriptions: callbackSubscriptions.filter((item) => item.status === "active").length,
      pendingCallbackDeliveries: callbackDeliveries.filter((item) => item.status === "prepared").length,
      activeCertificates: certificates.filter((item) => item.status === "active").length,
      activeDeveloperCredentials: developerCredentials.filter((item) => item.status === "active").length,
      openSlaAlerts: slaAlerts.filter((item) => item.status === "open").length,
      apiCalls: apiUsageEvents.filter((item) => item.status === "accepted").length,
      openSecurityAlerts: securityAlerts.filter((item) => item.status === "open").length,
      validCertificationReports: certificationReports.filter((item) => (
        ["passed", "conditional"].includes(item.status) && new Date(item.validUntil).getTime() > Date.now()
      )).length,
      standardConflicts: standardExtensions.filter((item) => item.status === "conflict").length,
      crossProvinceLabSharingReady: activeLabRegions.size >= 2
    },
    distributions: {
      nodeTypes: countBy(nodes, "nodeType"),
      institutionTypes: countBy(institutions, "institutionType"),
      institutionStatuses: countBy(institutions, "status"),
      subscriptionStatuses: countBy(subscriptions, "status")
    },
    nodes,
    institutions,
    servicePackages: state.nationalServicePackages,
    subscriptions,
    nodeHealth: latestHealthByNode,
    routingTraces: routingTraces.slice(0, 200),
    routingEnvelopes: routingEnvelopes.slice(0, 200),
    consentAuthorizations: consentAuthorizations.slice(0, 200),
    integrationAdapters: integrationAdapters.slice(0, 200),
    contractTestRuns: contractTestRuns.slice(0, 500),
    callbackSubscriptions: callbackSubscriptions.slice(0, 200),
    callbackDeliveries: callbackDeliveries.slice(0, 500),
    certificates,
    developerCredentials,
    apiQuotaPolicies: state.nationalApiQuotaPolicies,
    apiUsageEvents: apiUsageEvents.slice(0, 200),
    securityAlerts: securityAlerts.slice(0, 200),
    certificationReports: certificationReports.slice(0, 200),
    slaPolicies: state.nationalSlaPolicies,
    slaAlerts: slaAlerts.slice(0, 200),
    standards: state.nationalStandards,
    standardExtensions: standardExtensions.slice(0, 200),
    audit: isInstitution ? [] : state.nationalAccessAudit.slice(0, 200)
  };
}

module.exports = {
  INSTITUTION_STATUSES,
  INSTITUTION_TYPES,
  NODE_STATUSES,
  NODE_TYPES,
  NODE_HEALTH_STATUSES,
  NationalAccessError,
  ROUTING_CONTRACTS,
  CONSENT_LEGAL_BASES,
  INTEGRATION_SYSTEM_TYPES,
  CALLBACK_EVENT_TYPES,
  CONTRACT_TEST_CHECKS,
  SUBSCRIPTION_STATUSES,
  applyCertificateAction,
  applyCallbackDeliveryAction,
  applyCallbackSubscriptionAction,
  applyConsentAuthorizationAction,
  applyDeveloperCredentialAction,
  applyIntegrationAdapterAction,
  applyLifecycleAction,
  applyStandardExtensionAction,
  buildCenter,
  buildDeveloperSdkManifest,
  createCallbackDeliveries,
  createCallbackSubscription,
  createConsentAuthorization,
  createIntegrationAdapter,
  createInstitution,
  createCertificationReport,
  createNode,
  createRoutingEnvelope,
  createSubscription,
  evaluateOperations,
  evaluateSecurityLifecycle,
  issueAccessCertificate,
  issueDeveloperCredential,
  invokeDeveloperSandbox,
  planCrossProvinceRoute,
  recordNodeHealthProbe,
  registerStandardExtension,
  runContractConformanceTest,
  validateConsentAuthorization,
  normalizeState,
  seed
};
