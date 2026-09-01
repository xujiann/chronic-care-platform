"use strict";

const ERROR_PREFIX = "PUBLIC_HEALTH_SUPERVISION";

const COLLECTIONS = Object.freeze({
  subjects: "publicHealthSupervisionSubjects",
  tasks: "publicHealthSupervisionInspectionTasks",
  records: "publicHealthSupervisionInspectionRecords",
  findings: "publicHealthSupervisionFindings"
});

const LIMITS = Object.freeze({
  subjects: 500,
  tasks: 2000,
  records: 2000,
  findings: 5000,
  findingsPerInspection: 20,
  checklistResults: 50,
  evidenceRefs: 12,
  remediationRounds: 20,
  workbenchRows: 50
});

const RISK_LEVELS = Object.freeze(["low", "medium", "high", "critical"]);
const TASK_TYPES = Object.freeze(["routine", "risk-triggered", "reinspection"]);
const TASK_PRIORITIES = Object.freeze(["low", "normal", "high", "urgent"]);
const TASK_STATUSES = Object.freeze([
  "assigned",
  "accepted",
  "in-progress",
  "rectification-open",
  "rectification-review",
  "closed",
  "cancelled"
]);
const FINDING_STATUSES = Object.freeze(["open", "remediation-submitted", "verified", "reopened"]);
const CHECKLIST_OUTCOMES = Object.freeze(["pass", "fail", "not-applicable"]);
const INSPECTION_RESULTS = Object.freeze(["compliant", "noncompliant"]);
const FINDING_REVIEW_DECISIONS = Object.freeze(["approved", "rejected"]);

const COMMON_COMMAND_FIELDS = Object.freeze(["expectedVersion", "idempotencyKey"]);

function supervisionError(codeSuffix, message, statusCode = 400) {
  return Object.assign(new Error(message), {
    code: `${ERROR_PREFIX}_${codeSuffix}`,
    statusCode
  });
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw supervisionError("INPUT_INVALID", `${label} must be an object`);
  }
  return value;
}

function assertClosedObject(value, allowedFields, label) {
  const object = requireObject(value, label);
  const allowed = new Set(allowedFields);
  const unsupported = Object.keys(object).filter((key) => !allowed.has(key));
  if (unsupported.length) {
    throw supervisionError("INPUT_INVALID", `${label} contains unsupported fields: ${unsupported.join(", ")}`);
  }
  return object;
}

function cleanText(value, field, { required = true, maximum = 300 } = {}) {
  if (typeof value !== "string") {
    if (!required && value === undefined) return "";
    throw supervisionError("INPUT_INVALID", `${field} must be a string`);
  }
  const result = value.trim().replace(/[\r\n\t]+/g, " ");
  if ((required && !result) || result.length > maximum) {
    throw supervisionError("INPUT_INVALID", `${field} is invalid`);
  }
  return result;
}

function safeIdentifier(value, field, maximum = 160) {
  const result = cleanText(value, field, { maximum });
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(result)) {
    throw supervisionError("INPUT_INVALID", `${field} contains unsupported characters`);
  }
  return result;
}

function enumValue(value, field, allowed) {
  const result = cleanText(value, field, { maximum: 80 }).toLowerCase();
  if (!allowed.includes(result)) {
    throw supervisionError("INPUT_INVALID", `${field} is not supported`);
  }
  return result;
}

function isoTimestamp(value, field) {
  const result = cleanText(value, field, { maximum: 40 });
  const milliseconds = Date.parse(result);
  if (!Number.isFinite(milliseconds) || !/^\d{4}-\d{2}-\d{2}T/.test(result)) {
    throw supervisionError("INPUT_INVALID", `${field} must be an ISO timestamp`);
  }
  return new Date(milliseconds).toISOString();
}

function expectedVersion(value, { create = false } = {}) {
  const version = Number(value);
  if (!Number.isSafeInteger(version) || version < 0 || (create && version !== 0)) {
    throw supervisionError("INPUT_INVALID", create
      ? "expectedVersion must be 0 for create commands"
      : "expectedVersion must be a non-negative integer");
  }
  return version;
}

function optionalIdempotencyKey(value) {
  if (value === undefined) return "";
  return safeIdentifier(value, "idempotencyKey", 160);
}

function evidenceRef(value, field) {
  const result = safeIdentifier(value, field, 160);
  if (/^(?:data|file|javascript):/i.test(result) || result.includes("..") || result.includes("://")) {
    throw supervisionError("INPUT_INVALID", `${field} must be an opaque evidence reference`);
  }
  return result;
}

function evidenceRefs(value, field, { required = false } = {}) {
  if (value === undefined && !required) return [];
  if (!Array.isArray(value) || (required && value.length === 0) || value.length > LIMITS.evidenceRefs) {
    throw supervisionError(required ? "EVIDENCE_REQUIRED" : "INPUT_INVALID", `${field} must contain ${required ? "1 to" : "0 to"} ${LIMITS.evidenceRefs} references`);
  }
  const results = value.map((item, index) => evidenceRef(item, `${field}[${index}]`));
  if (new Set(results).size !== results.length) {
    throw supervisionError("INPUT_INVALID", `${field} contains duplicate references`);
  }
  return results;
}

function validateSubjectCommand(payload) {
  assertClosedObject(payload, ["organizationCode", "riskLevel", ...COMMON_COMMAND_FIELDS], "subject command");
  return Object.freeze({
    organizationCode: safeIdentifier(payload.organizationCode, "organizationCode", 64).toUpperCase(),
    riskLevel: enumValue(payload.riskLevel, "riskLevel", RISK_LEVELS),
    expectedVersion: expectedVersion(payload.expectedVersion, { create: true }),
    idempotencyKey: optionalIdempotencyKey(payload.idempotencyKey)
  });
}

function validateTaskCommand(payload) {
  assertClosedObject(payload, [
    "subjectId",
    "taskType",
    "priority",
    "dueAt",
    "checklistTemplateId",
    "checklistTemplateVersion",
    ...COMMON_COMMAND_FIELDS
  ], "inspection task command");
  const templateVersion = Number(payload.checklistTemplateVersion);
  if (!Number.isSafeInteger(templateVersion) || templateVersion < 1) {
    throw supervisionError("INPUT_INVALID", "checklistTemplateVersion must be a positive integer");
  }
  return Object.freeze({
    subjectId: safeIdentifier(payload.subjectId, "subjectId"),
    taskType: enumValue(payload.taskType, "taskType", TASK_TYPES),
    priority: enumValue(payload.priority, "priority", TASK_PRIORITIES),
    dueAt: isoTimestamp(payload.dueAt, "dueAt"),
    checklistTemplateId: safeIdentifier(payload.checklistTemplateId, "checklistTemplateId"),
    checklistTemplateVersion: templateVersion,
    expectedVersion: expectedVersion(payload.expectedVersion, { create: true }),
    idempotencyKey: optionalIdempotencyKey(payload.idempotencyKey)
  });
}

function validateChecklistResult(value, index) {
  const label = `checklistResults[${index}]`;
  assertClosedObject(value, ["itemCode", "outcome", "note", "evidenceRefs"], label);
  return Object.freeze({
    itemCode: safeIdentifier(value.itemCode, `${label}.itemCode`),
    outcome: enumValue(value.outcome, `${label}.outcome`, CHECKLIST_OUTCOMES),
    note: cleanText(value.note, `${label}.note`, { required: false, maximum: 500 }),
    evidenceRefs: evidenceRefs(value.evidenceRefs, `${label}.evidenceRefs`)
  });
}

function validateInspectionFinding(value, index) {
  const label = `findings[${index}]`;
  assertClosedObject(value, ["itemCode", "severity", "summary", "remediationDueAt", "evidenceRefs"], label);
  return Object.freeze({
    itemCode: safeIdentifier(value.itemCode, `${label}.itemCode`),
    severity: enumValue(value.severity, `${label}.severity`, RISK_LEVELS),
    summary: cleanText(value.summary, `${label}.summary`, { maximum: 500 }),
    remediationDueAt: isoTimestamp(value.remediationDueAt, `${label}.remediationDueAt`),
    evidenceRefs: evidenceRefs(value.evidenceRefs, `${label}.evidenceRefs`, { required: true })
  });
}

function validateTaskAction(payload) {
  requireObject(payload, "inspection task action");
  const action = enumValue(payload.action, "action", ["accept", "start", "record-inspection", "cancel"]);
  const fieldsByAction = {
    accept: ["action", ...COMMON_COMMAND_FIELDS],
    start: ["action", ...COMMON_COMMAND_FIELDS],
    cancel: ["action", "reason", ...COMMON_COMMAND_FIELDS],
    "record-inspection": [
      "action",
      "inspectedAt",
      "result",
      "checklistResults",
      "findings",
      "evidenceRefs",
      ...COMMON_COMMAND_FIELDS
    ]
  };
  assertClosedObject(payload, fieldsByAction[action], "inspection task action");
  const base = {
    action,
    expectedVersion: expectedVersion(payload.expectedVersion),
    idempotencyKey: optionalIdempotencyKey(payload.idempotencyKey)
  };
  if (action === "cancel") {
    return Object.freeze({ ...base, reason: cleanText(payload.reason, "reason", { maximum: 500 }) });
  }
  if (action !== "record-inspection") return Object.freeze(base);
  if (!Array.isArray(payload.checklistResults) || payload.checklistResults.length === 0 || payload.checklistResults.length > LIMITS.checklistResults) {
    throw supervisionError("INPUT_INVALID", `checklistResults must contain 1 to ${LIMITS.checklistResults} rows`);
  }
  const findings = payload.findings === undefined ? [] : payload.findings;
  if (!Array.isArray(findings) || findings.length > LIMITS.findingsPerInspection) {
    throw supervisionError("INPUT_INVALID", `findings must contain 0 to ${LIMITS.findingsPerInspection} rows`);
  }
  return Object.freeze({
    ...base,
    inspectedAt: isoTimestamp(payload.inspectedAt, "inspectedAt"),
    result: enumValue(payload.result, "result", INSPECTION_RESULTS),
    checklistResults: Object.freeze(payload.checklistResults.map(validateChecklistResult)),
    findings: Object.freeze(findings.map(validateInspectionFinding)),
    evidenceRefs: Object.freeze(evidenceRefs(payload.evidenceRefs, "evidenceRefs"))
  });
}

function validateFindingAction(payload) {
  requireObject(payload, "finding action");
  const action = enumValue(payload.action, "action", ["submit-remediation", "review-remediation"]);
  const allowed = action === "submit-remediation"
    ? ["action", "note", "evidenceRefs", ...COMMON_COMMAND_FIELDS]
    : ["action", "decision", "note", "evidenceRefs", ...COMMON_COMMAND_FIELDS];
  assertClosedObject(payload, allowed, "finding action");
  const result = {
    action,
    note: cleanText(payload.note, "note", { maximum: 1000 }),
    evidenceRefs: Object.freeze(evidenceRefs(payload.evidenceRefs, "evidenceRefs", { required: true })),
    expectedVersion: expectedVersion(payload.expectedVersion),
    idempotencyKey: optionalIdempotencyKey(payload.idempotencyKey)
  };
  if (action === "review-remediation") {
    result.decision = enumValue(payload.decision, "decision", FINDING_REVIEW_DECISIONS);
  }
  return Object.freeze(result);
}

function projectSubject(subject = {}) {
  return Object.freeze({
    id: subject.id,
    version: subject.version,
    directoryRef: subject.directoryRef,
    organizationCode: subject.organizationCode,
    organizationLevel: subject.organizationLevel,
    jurisdictionCode: subject.jurisdictionCode,
    subjectType: subject.subjectType,
    riskLevel: subject.riskLevel,
    status: subject.status,
    createdAt: subject.createdAt,
    updatedAt: subject.updatedAt,
    productionReady: false
  });
}

function projectTask(task = {}) {
  return Object.freeze({
    id: task.id,
    version: task.version,
    subjectId: task.subjectId,
    taskType: task.taskType,
    priority: task.priority,
    dueAt: task.dueAt,
    checklistTemplateId: task.checklistTemplateId,
    checklistTemplateVersion: task.checklistTemplateVersion,
    assignedOrgCode: task.assignedOrgCode,
    status: task.status,
    inspectionRecordId: task.inspectionRecordId || "",
    createdAt: task.createdAt,
    acceptedAt: task.acceptedAt || "",
    startedAt: task.startedAt || "",
    closedAt: task.closedAt || "",
    cancelledAt: task.cancelledAt || "",
    cancellationReason: task.cancellationReason || "",
    updatedAt: task.updatedAt,
    productionReady: false
  });
}

function projectInspectionRecord(record = {}) {
  return Object.freeze({
    id: record.id,
    version: 1,
    taskId: record.taskId,
    subjectId: record.subjectId,
    checklistTemplateId: record.checklistTemplateId,
    checklistTemplateVersion: record.checklistTemplateVersion,
    result: record.result,
    inspectedAt: record.inspectedAt,
    recordedAt: record.recordedAt,
    inspectorOrgCode: record.inspectorOrgCode,
    checklistResults: structuredClone(record.checklistResults || []),
    evidenceRefs: [...(record.evidenceRefs || [])],
    findingIds: [...(record.findingIds || [])],
    productionReady: false
  });
}

function projectFinding(finding = {}) {
  return Object.freeze({
    id: finding.id,
    version: finding.version,
    taskId: finding.taskId,
    subjectId: finding.subjectId,
    inspectionRecordId: finding.inspectionRecordId,
    itemCode: finding.itemCode,
    severity: finding.severity,
    summary: finding.summary,
    remediationDueAt: finding.remediationDueAt,
    evidenceRefs: [...(finding.evidenceRefs || [])],
    status: finding.status,
    remediationRounds: (finding.remediationRounds || []).map((round) => ({
      round: round.round,
      submission: round.submission ? {
        at: round.submission.at,
        orgCode: round.submission.orgCode,
        note: round.submission.note,
        evidenceRefs: [...round.submission.evidenceRefs]
      } : null,
      review: round.review ? {
        at: round.review.at,
        orgCode: round.review.orgCode,
        decision: round.review.decision,
        note: round.review.note,
        evidenceRefs: [...round.review.evidenceRefs]
      } : null
    })),
    createdAt: finding.createdAt,
    updatedAt: finding.updatedAt,
    productionReady: false
  });
}

function projectTemplate(template = {}) {
  return Object.freeze({
    id: template.id,
    version: template.version,
    title: template.title,
    status: template.status,
    boundary: template.boundary,
    items: (template.items || []).map((item) => Object.freeze({
      code: item.code,
      label: item.label,
      required: item.required === true
    })),
    productionReady: false
  });
}

module.exports = {
  CHECKLIST_OUTCOMES,
  COLLECTIONS,
  ERROR_PREFIX,
  FINDING_REVIEW_DECISIONS,
  FINDING_STATUSES,
  INSPECTION_RESULTS,
  LIMITS,
  RISK_LEVELS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_TYPES,
  assertClosedObject,
  projectFinding,
  projectInspectionRecord,
  projectInspectionTask: projectTask,
  projectSubject,
  projectTask,
  projectTemplate,
  supervisionError,
  validateFindingAction,
  validateSubjectCommand,
  validateTaskAction,
  validateTaskCommand
};
