"use strict";

const CENTER_SCHEMA_VERSION = "regional-clinical-document-center-v1";
const DOCUMENT_CONTRACT_IDS = new Set([
  "emr-summary-v1",
  "discharge-summary-v1",
  "regional-clinical-document-v1"
]);
const DOCUMENT_TYPES = Object.freeze({
  "medical-record-card": "电子病历卡",
  "discharge-summary": "电子出院小结"
});

class RegionalClinicalDocumentError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = "RegionalClinicalDocumentError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
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

function isoDate(value) {
  const parsed = new Date(value || "");
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function publicReference(value) {
  const normalized = boundedText(value, 160);
  if (!normalized) return "未绑定居民引用";
  const visible = normalized.slice(-4);
  return `居民引用末${visible.length}位 ${visible}`;
}

function sourcePayload(event = {}) {
  const requestPayload = asObject(event.requestPayload);
  return {
    ...asObject(requestPayload.payload),
    ...asObject(event.canonicalPayload),
    ...asObject(event.payload)
  };
}

function institutionCode(event = {}, payload = sourcePayload(event)) {
  const requestPayload = asObject(event.requestPayload);
  return firstText(
    event.institutionCode,
    event.receivedByOrgCode,
    event.createdByOrgCode,
    payload.institutionCode,
    payload.institutionId,
    payload.custodianId,
    payload.sourceInstitutionCode,
    requestPayload.institutionCode,
    asObject(requestPayload.payload).institutionCode,
    asObject(requestPayload.payload).institutionId
  );
}

function documentType(event = {}, payload = sourcePayload(event)) {
  const raw = firstText(payload.documentType, payload.recordType, payload.summaryType, event.documentType)
    .toLowerCase()
    .replaceAll("_", "-");
  if (["discharge-summary", "electronic-discharge-summary", "discharge"].includes(raw)) return "discharge-summary";
  if (["medical-record-card", "emr-card", "medical-card", "clinical-summary"].includes(raw)) return "medical-record-card";
  if (payload.dischargedAt || payload.dischargeSummary || payload.dischargeDiagnosis) return "discharge-summary";
  return "medical-record-card";
}

function isClinicalDocumentEvent(event = {}) {
  const payload = sourcePayload(event);
  return DOCUMENT_CONTRACT_IDS.has(String(event.contractId || ""))
    || event.resource === "MedicalSummary"
    || Boolean(payload.documentType || payload.dischargeSummary || payload.dischargedAt);
}

function actorScope(actor = {}) {
  const role = boundedText(actor.role, 40).toLowerCase();
  if (!new Set(["commission", "institution"]).has(role)) {
    throw new RegionalClinicalDocumentError(
      "REGIONAL_CLINICAL_DOCUMENT_ROLE_FORBIDDEN",
      "当前账号无权访问区域医疗文书中心",
      403
    );
  }
  const organizationCode = firstText(actor.orgCode, actor.institutionCode, actor.organizationCode);
  if (role === "institution" && !organizationCode) {
    throw new RegionalClinicalDocumentError(
      "REGIONAL_CLINICAL_DOCUMENT_SCOPE_REQUIRED",
      "医疗机构账号必须绑定可信机构代码",
      403
    );
  }
  return Object.freeze({
    role,
    organizationCode: role === "commission" ? "cross-organization" : organizationCode,
    crossInstitutionVisible: role === "commission",
    clinicalDetailVisible: role === "institution"
  });
}

function attachmentProjection(data = {}, payload = {}, scope = {}) {
  const attachmentId = firstText(payload.secureAttachmentId, payload.pdfAttachmentId, payload.attachmentId);
  const attachment = (Array.isArray(data.secureAttachments) ? data.secureAttachments : [])
    .find((item) => item.id === attachmentId);
  const active = Boolean(attachment && attachment.status === "active" && attachment.scanStatus === "clean");
  return Object.freeze({
    available: active && scope.clinicalDetailVisible,
    attachmentId: active && scope.clinicalDetailVisible ? boundedText(attachment.id, 160) : "",
    filename: active && scope.clinicalDetailVisible ? boundedText(attachment.filename || "电子医疗文书.pdf", 160) : "",
    integrityStatus: !attachmentId ? "not-provided" : active ? "verified" : "not-ready"
  });
}

function validationProjection(event = {}, payload = {}, code = "", pdf = {}) {
  const checks = Object.freeze([
    Object.freeze({ id: "source-record", passed: Boolean(firstText(event.externalId, payload.externalId, event.domainEvent?.aggregateId)) }),
    Object.freeze({ id: "resident-reference", passed: Boolean(firstText(event.residentId, payload.residentId)) }),
    Object.freeze({ id: "institution-scope", passed: Boolean(code) }),
    Object.freeze({ id: "document-date", passed: Boolean(isoDate(firstText(payload.dischargedAt, payload.recordDate, payload.documentDate, event.receivedAt))) }),
    Object.freeze({ id: "clinical-summary", passed: Boolean(firstText(payload.dischargeSummary, payload.summary, payload.diagnosis, payload.dischargeDiagnosis)) }),
    Object.freeze({ id: "transport-signature", passed: event.signatureVerified === true || event.contractReceipt?.status === "accepted" })
  ]);
  const failed = checks.filter((item) => !item.passed).map((item) => item.id);
  if (pdf.integrityStatus === "not-ready") failed.push("pdf-attachment-not-ready");
  return Object.freeze({
    status: failed.length ? "exception" : "passed",
    passed: failed.length === 0,
    failedChecks: Object.freeze(failed),
    checks
  });
}

function reportingStatus(event = {}, payload = {}, validation = {}) {
  if (event.deadLetter === true || event.status === "failed" || validation.passed === false) return "exception";
  const raw = firstText(
    event.upstreamReporting?.status,
    payload.reportingStatus,
    event.reconciliationStatus,
    event.status
  ).toLowerCase();
  if (["published", "reported", "delivered", "provider-accepted", "已上报"].includes(raw)) return "reported";
  if (["failed", "dead-letter", "provider-exception", "exception"].includes(raw)) return "exception";
  return "pending-report";
}

function projectDocument(data, event, scope) {
  const payload = sourcePayload(event);
  const code = institutionCode(event, payload);
  const type = documentType(event, payload);
  const pdf = attachmentProjection(data, payload, scope);
  const validation = validationProjection(event, payload, code, pdf);
  const reporting = reportingStatus(event, payload, validation);
  const residentId = firstText(event.residentId, payload.residentId);
  const clinicalSummary = scope.clinicalDetailVisible
    ? firstText(payload.dischargeSummary, payload.summary, payload.diagnosis, payload.dischargeDiagnosis)
    : "";
  return Object.freeze({
    id: boundedText(event.id || event.domainEvent?.id, 200),
    documentType: type,
    documentLabel: DOCUMENT_TYPES[type],
    sourceRecordReference: firstText(event.externalId, payload.externalId, event.domainEvent?.aggregateId),
    residentReference: publicReference(residentId),
    institutionCode: code,
    documentDate: isoDate(firstText(payload.dischargedAt, payload.recordDate, payload.documentDate, event.receivedAt)),
    receivedAt: firstText(event.receivedAt, event.contractReceipt?.receivedAt),
    status: reporting === "exception" ? "exception" : validation.passed ? "accepted" : "exception",
    reportingStatus: reporting,
    clinicalSummary,
    validation,
    pdf,
    retryCount: Number(event.retryCount || 0),
    actions: Object.freeze({
      queryDetail: scope.clinicalDetailVisible,
      viewPdf: pdf.available,
      retryException: scope.role === "commission" && reporting === "exception" && Boolean(event.id)
    })
  });
}

function buildWorkstationReminders(documents, scope) {
  if (!scope.clinicalDetailVisible) return Object.freeze([]);
  const byResident = new Map();
  for (const document of documents) {
    const current = byResident.get(document.residentReference) || {
      residentReference: document.residentReference,
      documentTypes: new Set(),
      latestDocumentDate: "",
      availableDocuments: 0
    };
    current.documentTypes.add(document.documentType);
    current.availableDocuments += 1;
    if (document.documentDate > current.latestDocumentDate) current.latestDocumentDate = document.documentDate;
    byResident.set(document.residentReference, current);
  }
  return Object.freeze([...byResident.values()].slice(0, 20).map((item) => Object.freeze({
    residentReference: item.residentReference,
    documentTypes: Object.freeze([...item.documentTypes]),
    latestDocumentDate: item.latestDocumentDate,
    availableDocuments: item.availableDocuments,
    message: `医生工作站可调阅 ${item.availableDocuments} 份授权文书摘要`
  })));
}

function buildRegionalClinicalDocumentCenter(data = {}, actor = {}, options = {}) {
  const scope = actorScope(actor);
  const nowDate = isoDate(options.now || new Date().toISOString());
  const sourceEvents = (Array.isArray(data.integrationGatewayEvents) ? data.integrationGatewayEvents : [])
    .filter(isClinicalDocumentEvent)
    .filter((event) => scope.crossInstitutionVisible || institutionCode(event) === scope.organizationCode);
  const documents = sourceEvents
    .map((event) => projectDocument(data, event, scope))
    .sort((left, right) => String(right.receivedAt).localeCompare(String(left.receivedAt)));
  const exceptions = documents.filter((item) => item.reportingStatus === "exception").map((item) => Object.freeze({
    id: item.id,
    documentLabel: item.documentLabel,
    institutionCode: item.institutionCode,
    residentReference: item.residentReference,
    issueCodes: item.validation.failedChecks.length ? item.validation.failedChecks : Object.freeze(["gateway-delivery-exception"]),
    retryCount: item.retryCount,
    actions: item.actions,
    nextAction: "核对源文书后通过既有集成事件重试入口补传"
  }));
  const logs = documents.map((item) => Object.freeze({
    id: item.id,
    sourceRecordReference: item.sourceRecordReference,
    documentLabel: item.documentLabel,
    institutionCode: item.institutionCode,
    receivedAt: item.receivedAt,
    validationStatus: item.validation.status,
    reportingStatus: item.reportingStatus,
    retryCount: item.retryCount
  }));
  const institutionCount = new Set(documents.map((item) => item.institutionCode).filter(Boolean)).size;
  return Object.freeze({
    schemaVersion: CENTER_SCHEMA_VERSION,
    sourceRequirement: "D-INT-DOC",
    productionReady: false,
    scope,
    actions: Object.freeze({
      queryDocuments: true,
      queryClinicalDetail: scope.clinicalDetailVisible,
      requestPdfIntent: scope.clinicalDetailVisible,
      retryExceptions: scope.role === "commission"
    }),
    summary: Object.freeze({
      documents: documents.length,
      institutions: institutionCount,
      collectedToday: documents.filter((item) => item.documentDate === nowDate).length,
      medicalRecordCards: documents.filter((item) => item.documentType === "medical-record-card").length,
      dischargeSummaries: documents.filter((item) => item.documentType === "discharge-summary").length,
      pendingReport: documents.filter((item) => item.reportingStatus === "pending-report").length,
      reported: documents.filter((item) => item.reportingStatus === "reported").length,
      exceptions: exceptions.length,
      pdfReady: documents.filter((item) => item.pdf.integrityStatus === "verified").length
    }),
    documents: Object.freeze(documents),
    exceptions: Object.freeze(exceptions),
    uploadLogs: Object.freeze(logs),
    workstationReminders: buildWorkstationReminders(documents, scope),
    capabilities: Object.freeze([
      Object.freeze({ id: "same-day-collection", label: "当日文书采集归集", status: "repository-verified", interface: "POST /api/integration/events" }),
      Object.freeze({ id: "signed-acquisition", label: "获取认证与上传验签", status: "repository-verified", interface: "HMAC-SHA256 integration contract" }),
      Object.freeze({ id: "summary-query", label: "病历卡与出院小结摘要查询", status: "repository-verified", interface: "GET /api/integration/clinical-documents/center" }),
      Object.freeze({ id: "pdf-query", label: "PDF 安全短时调阅", status: "repository-verified", interface: "POST /api/attachments/:id/download-intent" }),
      Object.freeze({ id: "upstream-reporting", label: "上级平台正式报送", status: "external-evidence-required", interface: "现场端点、凭据、回执与签字" })
    ]),
    blockers: Object.freeze([
      "真实医疗机构文书接口、机构目录映射和生产签名凭据尚未完成现场联调",
      "上级平台报送端点、字段版本、验签回执和联合签字仍需外部证据",
      "生产 PDF 对象存储、恶意文件扫描、授权策略和医生工作站嵌入仍需现场验收"
    ])
  });
}

module.exports = {
  CENTER_SCHEMA_VERSION,
  DOCUMENT_CONTRACT_IDS,
  DOCUMENT_TYPES,
  RegionalClinicalDocumentError,
  actorScope,
  buildRegionalClinicalDocumentCenter,
  documentType,
  institutionCode,
  isClinicalDocumentEvent,
  sourcePayload
};
