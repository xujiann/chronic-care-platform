const { createHash } = require("node:crypto");

const INFECTIOUS_REPORTING_STAGES = [
  "detected",
  "validated",
  "card-created",
  "submitted",
  "receipt-confirmed",
  "cdc-reviewed",
  "followup-closed"
];

const INFECTIOUS_REPORTING_ACTIONS = {
  "validate-event": { from: ["detected"], to: "validated", roles: ["institution", "commission", "cdc"] },
  "review-standard-mapping": { from: INFECTIOUS_REPORTING_STAGES.slice(1), to: null, roles: ["commission", "cdc"] },
  "create-report-card": { from: ["validated"], to: "card-created", roles: ["institution", "commission", "cdc"] },
  "submit-report": { from: ["card-created", "rejected"], to: "submitted", roles: ["institution", "commission", "cdc"] },
  "record-receipt": { from: ["submitted"], to: null, roles: ["system", "commission", "cdc"] },
  "review-by-cdc": { from: ["receipt-confirmed"], to: "cdc-reviewed", roles: ["commission", "cdc"] },
  "close-followup": { from: ["cdc-reviewed"], to: "followup-closed", roles: ["commission", "cdc"] }
};

const REQUIRED_EVENT_FIELDS = [
  "externalEventId",
  "publicHealthEventId",
  "residentId",
  "diagnosisCode",
  "sampleNo",
  "sourceSystem",
  "observedAt"
];

const REQUIRED_REPORT_FIELDS = [
  "reportId",
  "reportCardNo",
  "residentId",
  "diagnosisCode",
  "sampleNo",
  "targetCounty",
  "targetPlatform",
  "reportedAt"
];

const DEFAULT_INFECTIOUS_EVENT_LINK = {
  id: "pherl-infectious-001",
  externalEventId: "EMR-LIS-CLUSTER-20260708-001",
  publicHealthEventId: "phe-infectious-001",
  reportId: "p2drq-inf-r3",
  ruleId: "p2dr-rule-infectious",
  diagnosisCode: "A15",
  sampleNo: "LIS-SAMPLE-20260708-001",
  standardDomainId: "ph-infectious",
  standardItems: ["病例报告", "流行病学调查", "实验室检测", "报告质量控制"]
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function clean(value) {
  return String(value ?? "").trim();
}

function actorRole(user = {}) {
  const role = clean(user.role || user.roleName || "").toLowerCase();
  if (["commission", "health-admin", "public-health-admin"].includes(role)) return "commission";
  if (["cdc", "disease-control"].includes(role)) return "cdc";
  if (["institution", "hospital", "primary-care"].includes(role)) return "institution";
  if (["system", "integration", "adapter"].includes(role)) return "system";
  return role || "anonymous";
}

function actorName(user = {}) {
  return clean(user.name || user.username || user.actor || "system");
}

function missingFields(source, fields) {
  return fields.filter((field) => {
    const value = source?.[field];
    return value === undefined || value === null || clean(value) === "";
  });
}

function requireFields(source, fields, label) {
  const missing = missingFields(source, fields);
  if (missing.length) throw new Error(`${label} missing required fields: ${missing.join(", ")}`);
}

function auditHash(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function buildInfectiousReportingCaseFromSources({ event, report, receipt, link = DEFAULT_INFECTIOUS_EVENT_LINK } = {}) {
  if (!event || event.id !== link.publicHealthEventId) throw new Error(`public health event ${link.publicHealthEventId} is required`);
  if (!report || report.id !== link.reportId) throw new Error(`disease report ${link.reportId} is required`);
  if (clean(report.diseaseCategory).toLowerCase() !== "infectious") throw new Error("linked disease report must be infectious");

  const eventData = {
    externalEventId: link.externalEventId,
    publicHealthEventId: event.id,
    residentId: report.residentId,
    diagnosisCode: report.diseaseCode || link.diagnosisCode,
    sampleNo: report.sampleNo || link.sampleNo,
    signal: event.signal,
    sourceSystem: event.sourceSystem,
    sourceInstitution: report.sourceInstitution || event.institution,
    region: event.region,
    observedAt: event.reportedAt,
    priority: event.priority,
    evidenceRefs: Array.from(new Set([event.id, report.id, link.sampleNo].filter(Boolean)))
  };
  const draftReport = {
    reportId: report.id,
    reportCardNo: report.reportCardNo,
    ruleId: report.ruleId || link.ruleId,
    residentId: report.residentId,
    diagnosisCode: report.diseaseCode || link.diagnosisCode,
    sampleNo: report.sampleNo || link.sampleNo,
    targetCounty: report.targetCounty,
    targetPlatform: report.targetPlatform,
    reportedAt: report.reportedAt,
    dueAt: report.dueAt,
    riskLevel: report.riskLevel,
    sourceInstitution: report.sourceInstitution || event.institution
  };
  requireFields(eventData, REQUIRED_EVENT_FIELDS, "infectious event");
  requireFields(draftReport, REQUIRED_REPORT_FIELDS, "infectious report draft");

  const detectedAt = clean(event.reportedAt || report.reportedAt || new Date().toISOString());
  const detectedHistory = {
    id: `${link.id}-history-1`,
    sequence: 1,
    action: "detect-event",
    from: "",
    to: "detected",
    at: detectedAt,
    actor: "EMR/LIS trigger adapter",
    role: "system",
    note: clean(event.signal),
    idempotencyKey: link.externalEventId,
    evidenceRefs: eventData.evidenceRefs
  };

  return {
    id: link.id,
    version: 1,
    state: "detected",
    externalEventId: link.externalEventId,
    publicHealthEventId: event.id,
    reportId: report.id,
    event: eventData,
    draftReport,
    reportCard: null,
    receipt: receipt ? clone(receipt) : null,
    exception: null,
    cdcReview: null,
    followup: { status: "pending", conclusion: "", evidenceRefs: [] },
    standardMapping: {
      domainId: link.standardDomainId,
      itemNames: clone(link.standardItems),
      status: "pending-review",
      reviewedBy: "",
      reviewedAt: "",
      evidenceRefs: []
    },
    timeline: [detectedHistory],
    lastAction: detectedHistory,
    businessClosureComplete: false,
    productionReady: false
  };
}

function authorizeAction(action, user) {
  const definition = INFECTIOUS_REPORTING_ACTIONS[action];
  if (!definition) throw new Error(`unsupported infectious reporting action: ${action}`);
  const role = actorRole(user);
  if (!definition.roles.includes(role)) throw new Error(`role ${role} is not allowed to ${action}`);
  return { definition, role };
}

function validateActionState(workflow, action, payload, definition) {
  if (!definition.from.includes(workflow.state)) throw new Error(`action ${action} is not allowed from state ${workflow.state}`);
  const idempotencyKey = clean(payload.idempotencyKey);
  if (!idempotencyKey) throw new Error(`idempotencyKey is required for ${action}`);
  if (payload.expectedVersion !== undefined && Number(payload.expectedVersion) !== Number(workflow.version)) {
    throw new Error(`version conflict: expected ${payload.expectedVersion}, current ${workflow.version}`);
  }
}

function existingIdempotentAction(workflow, action, payload) {
  const idempotencyKey = clean(payload.idempotencyKey);
  if (!idempotencyKey) return null;
  return (workflow.timeline || []).find((item) => item.action === action && item.idempotencyKey === idempotencyKey) || null;
}

function historyEntry(workflow, action, nextState, payload, user, role) {
  const sequence = (workflow.timeline || []).length + 1;
  return {
    id: `${workflow.id}-history-${sequence}`,
    sequence,
    action,
    from: workflow.state,
    to: nextState,
    at: clean(payload.at || new Date().toISOString()),
    actor: actorName(user),
    role,
    note: clean(payload.note),
    idempotencyKey: clean(payload.idempotencyKey),
    evidenceRefs: Array.isArray(payload.evidenceRefs) ? payload.evidenceRefs.map(clean).filter(Boolean).slice(0, 20) : []
  };
}

function applyInfectiousReportingAction(current, payload = {}, user = {}) {
  const workflow = clone(current);
  const action = clean(payload.action);
  const { definition, role } = authorizeAction(action, user);
  const duplicate = existingIdempotentAction(workflow, action, payload);
  if (duplicate) return { case: workflow, history: duplicate, idempotent: true };

  validateActionState(workflow, action, payload, definition);
  let nextState = definition.to || workflow.state;

  if (action === "validate-event") {
    requireFields(workflow.event, REQUIRED_EVENT_FIELDS, "infectious event");
  }

  if (action === "review-standard-mapping") {
    const evidenceRefs = Array.isArray(payload.evidenceRefs) ? payload.evidenceRefs.map(clean).filter(Boolean) : [];
    if (!evidenceRefs.length) throw new Error("standard mapping review requires evidenceRefs");
    workflow.standardMapping = {
      ...workflow.standardMapping,
      status: "reviewed",
      reviewedBy: actorName(user),
      reviewedAt: clean(payload.at || new Date().toISOString()),
      evidenceRefs: Array.from(new Set([...(workflow.standardMapping.evidenceRefs || []), ...evidenceRefs]))
    };
  }

  if (action === "create-report-card") {
    const reportCard = { ...workflow.draftReport, ...(payload.reportCard || {}) };
    requireFields(reportCard, REQUIRED_REPORT_FIELDS, "infectious report card");
    workflow.reportCard = reportCard;
  }

  if (action === "submit-report") {
    if (!workflow.reportCard) throw new Error("report card must be created before submission");
    requireFields(workflow.reportCard, REQUIRED_REPORT_FIELDS, "infectious report card");
    workflow.reportCard = {
      ...workflow.reportCard,
      pushStatus: "sent",
      submittedAt: clean(payload.at || new Date().toISOString()),
      retryCount: Number(workflow.reportCard.retryCount || 0) + (workflow.state === "rejected" ? 1 : 0),
      submissionIdempotencyKey: clean(payload.idempotencyKey)
    };
    if (workflow.state === "rejected") workflow.exception = { ...workflow.exception, status: "retry-submitted" };
  }

  if (action === "record-receipt") {
    const receiptStatus = clean(payload.receiptStatus).toLowerCase();
    if (!['accepted', 'rejected'].includes(receiptStatus)) throw new Error("receiptStatus must be accepted or rejected");
    requireFields(payload, ["receiptCode", "receivedAt"], "direct-report receipt");
    workflow.receipt = {
      id: clean(payload.receiptId || `${workflow.reportId}-receipt-${(workflow.reportCard?.retryCount || 0) + 1}`),
      reportId: workflow.reportId,
      receiptStatus,
      receiptCode: clean(payload.receiptCode),
      receivedAt: clean(payload.receivedAt),
      detail: clean(payload.detail || payload.reason),
      retryCount: Number(workflow.reportCard?.retryCount || 0),
      auditHash: auditHash({ reportId: workflow.reportId, receiptStatus, receiptCode: payload.receiptCode, receivedAt: payload.receivedAt })
    };
    if (receiptStatus === "accepted") {
      nextState = "receipt-confirmed";
      workflow.reportCard = { ...workflow.reportCard, pushStatus: "accepted", receiptId: workflow.receipt.id };
      workflow.exception = workflow.exception ? { ...workflow.exception, status: "closed", resolvedAt: workflow.receipt.receivedAt } : null;
    } else {
      requireFields(payload, ["reason", "exceptionOwner", "dueAt"], "rejected receipt exception");
      nextState = "rejected";
      workflow.reportCard = { ...workflow.reportCard, pushStatus: "rejected", receiptId: workflow.receipt.id };
      workflow.exception = {
        status: "open",
        reason: clean(payload.reason),
        owner: clean(payload.exceptionOwner),
        dueAt: clean(payload.dueAt),
        receiptId: workflow.receipt.id,
        retryCount: Number(workflow.reportCard.retryCount || 0)
      };
    }
  }

  if (action === "review-by-cdc") {
    requireFields(payload, ["note"], "CDC review");
    workflow.cdcReview = {
      status: "confirmed",
      reviewer: actorName(user),
      reviewedAt: clean(payload.at || new Date().toISOString()),
      conclusion: clean(payload.note),
      evidenceRefs: Array.isArray(payload.evidenceRefs) ? payload.evidenceRefs.map(clean).filter(Boolean) : []
    };
  }

  if (action === "close-followup") {
    requireFields(payload, ["followupConclusion"], "follow-up closure");
    const evidenceRefs = Array.isArray(payload.evidenceRefs) ? payload.evidenceRefs.map(clean).filter(Boolean) : [];
    if (!evidenceRefs.length) throw new Error("follow-up closure requires evidenceRefs");
    if (workflow.standardMapping.status !== "reviewed" || !(workflow.standardMapping.evidenceRefs || []).length) {
      throw new Error("standard mapping must be reviewed with evidence before follow-up closure");
    }
    workflow.followup = {
      status: "closed",
      conclusion: clean(payload.followupConclusion),
      closedBy: actorName(user),
      closedAt: clean(payload.at || new Date().toISOString()),
      evidenceRefs
    };
  }

  const history = historyEntry(workflow, action, nextState, payload, user, role);
  workflow.state = nextState;
  workflow.version = Number(workflow.version || 0) + 1;
  workflow.timeline = [...(workflow.timeline || []), history].slice(-50);
  workflow.lastAction = history;
  workflow.businessClosureComplete = workflow.state === "followup-closed"
    && workflow.receipt?.receiptStatus === "accepted"
    && workflow.cdcReview?.status === "confirmed"
    && workflow.standardMapping?.status === "reviewed";
  workflow.productionReady = false;
  return { case: workflow, history, idempotent: false };
}

function upsertInfectiousReportingCase(cases = [], candidate) {
  requireFields(candidate, ["externalEventId", "publicHealthEventId"], "infectious reporting case");
  const existing = cases.find((item) => item.externalEventId === candidate.externalEventId);
  if (existing) return { cases: clone(cases), case: clone(existing), created: false, idempotent: true };
  if (cases.some((item) => item.publicHealthEventId === candidate.publicHealthEventId)) {
    throw new Error(`publicHealthEventId ${candidate.publicHealthEventId} is already linked to another external event`);
  }
  const next = [...clone(cases), clone(candidate)];
  return { cases: next, case: clone(candidate), created: true, idempotent: false };
}

function runInfectiousReportingAcceptanceScenario(initialCase) {
  const institution = { name: "医院传染病报告员", role: "institution" };
  const cdc = { name: "疾控复核员", role: "cdc" };
  const adapter = { name: "疾控直报回执适配器", role: "system" };
  let workflow = clone(initialCase);
  const apply = (payload, user) => {
    workflow = applyInfectiousReportingAction(workflow, payload, user).case;
  };

  apply({ action: "validate-event", idempotencyKey: `${workflow.externalEventId}:validate`, at: "2026-07-08T08:35:00+08:00", note: "病例、样本和属地信息校验通过" }, institution);
  apply({ action: "review-standard-mapping", idempotencyKey: `${workflow.externalEventId}:standard-review`, at: "2026-07-08T08:37:00+08:00", note: "复核病例报告、流调、实验室检测和报告质控映射", evidenceRefs: ["standard-2020-ph-infectious", "site-mapping-review-001"] }, cdc);
  apply({ action: "create-report-card", idempotencyKey: `${workflow.externalEventId}:card`, at: "2026-07-08T08:40:00+08:00", note: "生成传染病疑似报卡" }, institution);
  apply({ action: "submit-report", idempotencyKey: `${workflow.externalEventId}:submit:1`, at: "2026-07-08T08:42:00+08:00", note: "提交疾控直报平台" }, institution);
  apply({ action: "record-receipt", idempotencyKey: `${workflow.externalEventId}:receipt:1`, receiptStatus: "accepted", receiptCode: "CDC-DR-20260708-001", receivedAt: "2026-07-08T08:43:00+08:00", at: "2026-07-08T08:43:00+08:00", detail: "直报平台接收成功", evidenceRefs: ["cdc-receipt-001"] }, adapter);
  apply({ action: "review-by-cdc", idempotencyKey: `${workflow.externalEventId}:cdc-review`, at: "2026-07-08T09:10:00+08:00", note: "完成病例复核并发起流行病学调查", evidenceRefs: ["cdc-review-001", "investigation-task-001"] }, cdc);
  apply({ action: "close-followup", idempotencyKey: `${workflow.externalEventId}:followup-close`, at: "2026-07-09T08:30:00+08:00", followupConclusion: "流调、实验室复核和报告质量控制均已完成", note: "24小时内完成随访闭环", evidenceRefs: ["investigation-conclusion-001", "lab-review-001", "report-quality-001"] }, cdc);
  return workflow;
}

module.exports = {
  DEFAULT_INFECTIOUS_EVENT_LINK,
  INFECTIOUS_REPORTING_ACTIONS,
  INFECTIOUS_REPORTING_STAGES,
  REQUIRED_EVENT_FIELDS,
  REQUIRED_REPORT_FIELDS,
  applyInfectiousReportingAction,
  buildInfectiousReportingCaseFromSources,
  runInfectiousReportingAcceptanceScenario,
  upsertInfectiousReportingCase
};
