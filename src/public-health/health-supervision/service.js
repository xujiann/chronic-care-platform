"use strict";

const defaultTemplateCatalog = require("../../../config/public-health-supervision-templates.json");
const {
  COLLECTIONS,
  LIMITS,
  projectFinding,
  projectInspectionRecord,
  projectSubject,
  projectTask,
  projectTemplate,
  supervisionError,
  validateFindingAction,
  validateSubjectCommand,
  validateTaskAction,
  validateTaskCommand
} = require("./contracts");

const COMMISSION_ORG_TYPES = new Set(["city", "health_admin", "district"]);

function clone(value) {
  return structuredClone(value);
}

function collection(state, name) {
  return Array.isArray(state?.[name]) ? state[name] : [];
}

function replaceCollections(state, replacements) {
  return { ...state, ...replacements };
}

function resolveNow(value) {
  const now = typeof value === "function" ? value() : value || new Date().toISOString();
  const milliseconds = Date.parse(now);
  if (!Number.isFinite(milliseconds)) {
    throw supervisionError("INPUT_INVALID", "now must be an ISO timestamp");
  }
  return new Date(milliseconds).toISOString();
}

function requireGeneratedId(value, field, prefix) {
  const result = String(value || "").trim();
  if (!result.startsWith(prefix) || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(result) || result.length > 160) {
    throw supervisionError("INPUT_INVALID", `${field} is invalid`);
  }
  return result;
}

function commandResult(nextData, values) {
  return Object.freeze({
    nextData,
    state: nextData,
    ...values,
    idempotent: false
  });
}

function normalizeActor(actor = {}) {
  const role = String(actor.role || "").trim().toLowerCase();
  const orgType = String(actor.orgType || "").trim().toLowerCase();
  const orgCode = String(actor.orgCode || "").trim().toUpperCase();
  const principalId = String(actor.id || actor.username || "").trim();
  if (!role || !orgType || !orgCode || !principalId) {
    throw supervisionError("SCOPE_FORBIDDEN", "actor organization scope denied", 403);
  }
  return Object.freeze({ role, orgType, orgCode, principalId });
}

function requireCommission(actor) {
  const normalized = normalizeActor(actor);
  if (normalized.role !== "commission" || !COMMISSION_ORG_TYPES.has(normalized.orgType)) {
    throw supervisionError("SCOPE_FORBIDDEN", "commission organization scope denied", 403);
  }
  return normalized;
}

function requireInstitution(actor) {
  const normalized = normalizeActor(actor);
  if (normalized.role !== "institution" || normalized.orgType !== "medical_institution") {
    throw supervisionError("SCOPE_FORBIDDEN", "institution organization scope denied", 403);
  }
  return normalized;
}

function assertCapacity(rows, maximum, resource) {
  if (rows.length >= maximum) {
    throw supervisionError("CAPACITY_REACHED", `${resource} capacity reached`, 409);
  }
}

function assertExpectedVersion(record, expected) {
  if (Number(record?.version) !== expected) {
    throw supervisionError(
      "VERSION_CONFLICT",
      `version conflict: expected ${expected}, current ${Number(record?.version) || 0}`,
      409
    );
  }
}

function findById(rows, id, resource) {
  const record = rows.find((item) => item.id === id);
  if (!record) throw supervisionError("NOT_FOUND", `${resource} not found`, 404);
  return record;
}

function commissionCanAccessSubject(actor, subject) {
  return actor.orgType === "city"
    || actor.orgType === "health_admin"
    || (actor.orgType === "district" && subject.jurisdictionCode === actor.orgCode);
}

function requireCommissionSubjectScope(actor, subject) {
  if (!commissionCanAccessSubject(actor, subject)) {
    throw supervisionError("SCOPE_FORBIDDEN", "subject jurisdiction scope denied", 403);
  }
}

function requireAssignedTaskScope(actor, task) {
  if (task.assignedOrgCode !== actor.orgCode) {
    throw supervisionError("SCOPE_FORBIDDEN", "inspection task assignment scope denied", 403);
  }
}

function templateFor(templates, id, version) {
  const template = templates.find((item) => item.id === id && Number(item.version) === version);
  if (!template || template.productionReady === true || template.status !== "draft-reference") {
    throw supervisionError("NOT_FOUND", "checklist template not found", 404);
  }
  if (!Array.isArray(template.items) || template.items.length === 0 || template.items.length > LIMITS.checklistResults) {
    throw supervisionError("INPUT_INVALID", "checklist template is invalid");
  }
  return template;
}

function createSupervisionSubjectToState(state, {
  payload,
  user,
  directoryEntry,
  id,
  now
} = {}) {
  const command = validateSubjectCommand(payload);
  const commission = requireCommission(user);
  const committedAt = resolveNow(now);
  const subjectId = requireGeneratedId(id, "id", "phss-");
  const subjects = clone(collection(state, COLLECTIONS.subjects));
  assertCapacity(subjects, LIMITS.subjects, "supervision subject");
  if (subjects.some((item) => item.id === subjectId)) {
    throw supervisionError("STATE_CONFLICT", "supervision subject id already exists", 409);
  }
  if (subjects.some((item) => item.organizationCode === command.organizationCode)) {
    throw supervisionError("STATE_CONFLICT", "supervision subject already exists", 409);
  }
  const directory = collection(state, "authOrganizations");
  const organization = directoryEntry || directory.find((item) => String(item.orgCode || "").trim().toUpperCase() === command.organizationCode);
  if (!organization || String(organization.orgType || "").trim().toLowerCase() !== "medical_institution") {
    throw supervisionError("NOT_FOUND", "medical institution directory reference not found", 404);
  }
  if (String(organization.orgCode || "").trim().toUpperCase() !== command.organizationCode) {
    throw supervisionError("INPUT_INVALID", "directory entry does not match organizationCode");
  }
  const jurisdictionCode = String(organization.parentCode || "").trim().toUpperCase();
  if (!jurisdictionCode) {
    throw supervisionError("INPUT_INVALID", "medical institution directory reference has no jurisdiction");
  }
  const candidate = {
    id: subjectId,
    version: 1,
    directoryRef: `identity-organization:v1:${command.organizationCode}`,
    organizationCode: command.organizationCode,
    organizationLevel: String(organization.orgLevel || "").trim(),
    jurisdictionCode,
    subjectType: "medical-institution",
    riskLevel: command.riskLevel,
    status: "active",
    createdAt: committedAt,
    updatedAt: committedAt,
    createdByPrincipalId: commission.principalId,
    createdByOrgCode: commission.orgCode,
    productionReady: false
  };
  requireCommissionSubjectScope(commission, candidate);
  subjects.unshift(candidate);
  const nextData = replaceCollections(state, { [COLLECTIONS.subjects]: subjects });
  return commandResult(nextData, {
    subject: candidate
  });
}

function createInspectionTaskToState(state, {
  payload,
  user,
  id,
  now,
  templates
} = {}) {
  const command = validateTaskCommand(payload);
  const commission = requireCommission(user);
  const committedAt = resolveNow(now);
  const taskId = requireGeneratedId(id, "id", "phst-");
  const availableTemplates = Array.isArray(templates) ? templates : defaultTemplateCatalog.templates;
  if (Date.parse(command.dueAt) <= Date.parse(committedAt)) {
    throw supervisionError("INPUT_INVALID", "dueAt must be later than the command time");
  }
  const subjects = collection(state, COLLECTIONS.subjects);
  const subject = findById(subjects, command.subjectId, "supervision subject");
  if (subject.status !== "active") {
    throw supervisionError("STATE_CONFLICT", "supervision subject is not active", 409);
  }
  requireCommissionSubjectScope(commission, subject);
  templateFor(availableTemplates, command.checklistTemplateId, command.checklistTemplateVersion);
  const tasks = clone(collection(state, COLLECTIONS.tasks));
  assertCapacity(tasks, LIMITS.tasks, "inspection task");
  if (tasks.some((item) => item.id === taskId)) {
    throw supervisionError("STATE_CONFLICT", "inspection task id already exists", 409);
  }
  const task = {
    id: taskId,
    version: 1,
    subjectId: subject.id,
    taskType: command.taskType,
    priority: command.priority,
    dueAt: command.dueAt,
    checklistTemplateId: command.checklistTemplateId,
    checklistTemplateVersion: command.checklistTemplateVersion,
    creatorOrgCode: commission.orgCode,
    assignedOrgCode: commission.orgCode,
    createdByPrincipalId: commission.principalId,
    status: "assigned",
    inspectionRecordId: "",
    createdAt: committedAt,
    updatedAt: committedAt,
    productionReady: false
  };
  tasks.unshift(task);
  const nextData = replaceCollections(state, { [COLLECTIONS.tasks]: tasks });
  return commandResult(nextData, {
    task
  });
}

function validateChecklistAgainstTemplate(command, template) {
  const templateCodes = template.items.map((item) => item.code);
  const resultCodes = command.checklistResults.map((item) => item.itemCode);
  if (new Set(resultCodes).size !== resultCodes.length
    || resultCodes.length !== templateCodes.length
    || templateCodes.some((code) => !resultCodes.includes(code))) {
    throw supervisionError("INPUT_INVALID", "checklistResults must contain every template item exactly once");
  }
  const failedCodes = command.checklistResults.filter((item) => item.outcome === "fail").map((item) => item.itemCode);
  if (command.result === "compliant" && (failedCodes.length || command.findings.length)) {
    throw supervisionError("STATE_CONFLICT", "compliant inspection cannot contain failed items or findings", 409);
  }
  if (command.result === "noncompliant") {
    if (!failedCodes.length || !command.findings.length) {
      throw supervisionError("STATE_CONFLICT", "noncompliant inspection requires failed items and findings", 409);
    }
    const findingCodes = new Set(command.findings.map((item) => item.itemCode));
    if (command.findings.some((item) => !failedCodes.includes(item.itemCode))
      || failedCodes.some((code) => !findingCodes.has(code))) {
      throw supervisionError("STATE_CONFLICT", "findings must cover failed checklist items", 409);
    }
  }
}

function transitionSimpleTask(task, command, commission, now) {
  const transitions = {
    accept: { from: ["assigned"], to: "accepted", timestamp: "acceptedAt", principal: "acceptedByPrincipalId" },
    start: { from: ["accepted"], to: "in-progress", timestamp: "startedAt", principal: "startedByPrincipalId" },
    cancel: { from: ["assigned", "accepted"], to: "cancelled", timestamp: "cancelledAt", principal: "cancelledByPrincipalId" }
  };
  const transition = transitions[command.action];
  if (!transition.from.includes(task.status)) {
    throw supervisionError("STATE_CONFLICT", `${command.action} is not allowed from ${task.status}`, 409);
  }
  return {
    ...task,
    version: task.version + 1,
    status: transition.to,
    [transition.timestamp]: now,
    [transition.principal]: commission.principalId,
    ...(command.action === "cancel" ? { cancellationReason: command.reason } : {}),
    updatedAt: now,
    productionReady: false
  };
}

function applyInspectionTaskActionToState(state, {
  taskId,
  payload,
  user,
  now,
  recordId,
  findingIds,
  templates
} = {}) {
  const command = validateTaskAction(payload);
  const commission = requireCommission(user);
  const committedAt = resolveNow(now);
  const availableTemplates = Array.isArray(templates) ? templates : defaultTemplateCatalog.templates;
  const tasks = clone(collection(state, COLLECTIONS.tasks));
  const taskIndex = tasks.findIndex((item) => item.id === taskId);
  if (taskIndex < 0) throw supervisionError("NOT_FOUND", "inspection task not found", 404);
  const task = tasks[taskIndex];
  assertExpectedVersion(task, command.expectedVersion);
  requireAssignedTaskScope(commission, task);
  const subject = findById(collection(state, COLLECTIONS.subjects), task.subjectId, "supervision subject");
  requireCommissionSubjectScope(commission, subject);

  if (command.action !== "record-inspection") {
    const updatedTask = transitionSimpleTask(task, command, commission, committedAt);
    tasks[taskIndex] = updatedTask;
    const nextData = replaceCollections(state, { [COLLECTIONS.tasks]: tasks });
    return commandResult(nextData, {
      task: updatedTask,
      record: null,
      findings: Object.freeze([])
    });
  }

  if (task.status !== "in-progress" || task.inspectionRecordId) {
    throw supervisionError("STATE_CONFLICT", "inspection can only be recorded once from in-progress", 409);
  }
  const inspectedAt = Date.parse(command.inspectedAt);
  if (inspectedAt < Date.parse(task.startedAt) || inspectedAt > Date.parse(committedAt) + 5 * 60 * 1000) {
    throw supervisionError("INPUT_INVALID", "inspectedAt is outside the task execution window");
  }
  const template = templateFor(availableTemplates, task.checklistTemplateId, task.checklistTemplateVersion);
  validateChecklistAgainstTemplate(command, template);
  command.findings.forEach((finding) => {
    if (Date.parse(finding.remediationDueAt) < inspectedAt) {
      throw supervisionError("INPUT_INVALID", "remediationDueAt must not precede inspectedAt");
    }
  });
  const records = clone(collection(state, COLLECTIONS.records));
  const findings = clone(collection(state, COLLECTIONS.findings));
  assertCapacity(records, LIMITS.records, "inspection record");
  if (findings.length + command.findings.length > LIMITS.findings) {
    throw supervisionError("CAPACITY_REACHED", "supervision finding capacity reached", 409);
  }
  const persistedRecordId = requireGeneratedId(recordId, "recordId", "phsr-");
  if (records.some((item) => item.id === persistedRecordId)) {
    throw supervisionError("STATE_CONFLICT", "inspection record id already exists", 409);
  }
  if (!Array.isArray(findingIds) || findingIds.length !== command.findings.length) {
    throw supervisionError("INPUT_INVALID", "findingIds must match the inspection findings");
  }
  const persistedFindingIds = findingIds.map((value, index) => requireGeneratedId(value, `findingIds[${index}]`, "phsf-"));
  if (new Set(persistedFindingIds).size !== persistedFindingIds.length) {
    throw supervisionError("INPUT_INVALID", "findingIds contains duplicates");
  }
  if (persistedFindingIds.some((id) => findings.some((item) => item.id === id))) {
    throw supervisionError("STATE_CONFLICT", "supervision finding id already exists", 409);
  }
  const createdFindings = command.findings.map((candidate, index) => ({
    id: persistedFindingIds[index],
    version: 1,
    taskId: task.id,
    subjectId: task.subjectId,
    inspectionRecordId: persistedRecordId,
    itemCode: candidate.itemCode,
    severity: candidate.severity,
    summary: candidate.summary,
    remediationDueAt: candidate.remediationDueAt,
    evidenceRefs: [...candidate.evidenceRefs],
    status: "open",
    remediationRounds: [],
    createdAt: committedAt,
    updatedAt: committedAt,
    productionReady: false
  }));
  const record = {
    id: persistedRecordId,
    version: 1,
    taskId: task.id,
    subjectId: task.subjectId,
    checklistTemplateId: task.checklistTemplateId,
    checklistTemplateVersion: task.checklistTemplateVersion,
    result: command.result,
    inspectedAt: command.inspectedAt,
    recordedAt: committedAt,
    inspectorPrincipalId: commission.principalId,
    inspectorOrgCode: commission.orgCode,
    checklistResults: clone(command.checklistResults),
    evidenceRefs: [...command.evidenceRefs],
    findingIds: createdFindings.map((item) => item.id),
    productionReady: false
  };
  const updatedTask = {
    ...task,
    version: task.version + 1,
    inspectionRecordId: record.id,
    status: command.result === "compliant" ? "closed" : "rectification-open",
    ...(command.result === "compliant" ? { closedAt: committedAt } : {}),
    updatedAt: committedAt,
    productionReady: false
  };
  tasks[taskIndex] = updatedTask;
  records.unshift(record);
  findings.unshift(...createdFindings);
  const nextData = replaceCollections(state, {
      [COLLECTIONS.tasks]: tasks,
      [COLLECTIONS.records]: records,
      [COLLECTIONS.findings]: findings
    });
  return commandResult(nextData, {
    task: updatedTask,
    record,
    findings: Object.freeze(createdFindings)
  });
}

function recomputeInspectionTaskStatus(task, taskFindings, now) {
  if (!taskFindings.length) return task;
  let status;
  if (taskFindings.every((item) => item.status === "verified")) status = "closed";
  else if (taskFindings.some((item) => ["open", "reopened"].includes(item.status))) status = "rectification-open";
  else status = "rectification-review";
  return {
    ...task,
    status,
    ...(status === "closed" ? { closedAt: task.closedAt || now } : { closedAt: "" }),
    updatedAt: now,
    productionReady: false
  };
}

function applySupervisionFindingActionToState(state, {
  findingId,
  payload,
  user,
  now
} = {}) {
  const command = validateFindingAction(payload);
  const committedAt = resolveNow(now);
  const findings = clone(collection(state, COLLECTIONS.findings));
  const findingIndex = findings.findIndex((item) => item.id === findingId);
  if (findingIndex < 0) throw supervisionError("NOT_FOUND", "supervision finding not found", 404);
  const finding = findings[findingIndex];
  assertExpectedVersion(finding, command.expectedVersion);
  const tasks = clone(collection(state, COLLECTIONS.tasks));
  const taskIndex = tasks.findIndex((item) => item.id === finding.taskId);
  if (taskIndex < 0) throw supervisionError("NOT_FOUND", "inspection task not found", 404);
  const task = tasks[taskIndex];
  const subject = findById(collection(state, COLLECTIONS.subjects), finding.subjectId, "supervision subject");
  const rounds = clone(Array.isArray(finding.remediationRounds) ? finding.remediationRounds : []);
  let updatedFinding;

  if (command.action === "submit-remediation") {
    const institution = requireInstitution(user);
    if (subject.organizationCode !== institution.orgCode) {
      throw supervisionError("SCOPE_FORBIDDEN", "finding institution scope denied", 403);
    }
    if (!["open", "reopened"].includes(finding.status)) {
      throw supervisionError("STATE_CONFLICT", "remediation cannot be submitted from the current finding state", 409);
    }
    if (rounds.length >= LIMITS.remediationRounds) {
      throw supervisionError("CAPACITY_REACHED", "remediation round capacity reached", 409);
    }
    rounds.push({
      round: rounds.length + 1,
      submission: {
        at: committedAt,
        orgCode: institution.orgCode,
        principalId: institution.principalId,
        note: command.note,
        evidenceRefs: [...command.evidenceRefs]
      },
      review: null
    });
    updatedFinding = {
      ...finding,
      version: finding.version + 1,
      status: "remediation-submitted",
      remediationRounds: rounds,
      updatedAt: committedAt,
      productionReady: false
    };
  } else {
    const commission = requireCommission(user);
    requireCommissionSubjectScope(commission, subject);
    requireAssignedTaskScope(commission, task);
    if (finding.status !== "remediation-submitted") {
      throw supervisionError("STATE_CONFLICT", "remediation review requires a submitted finding", 409);
    }
    const currentRound = rounds.at(-1);
    if (!currentRound?.submission || currentRound.review) {
      throw supervisionError("STATE_CONFLICT", "remediation round is not reviewable", 409);
    }
    currentRound.review = {
      at: committedAt,
      orgCode: commission.orgCode,
      principalId: commission.principalId,
      decision: command.decision,
      note: command.note,
      evidenceRefs: [...command.evidenceRefs]
    };
    updatedFinding = {
      ...finding,
      version: finding.version + 1,
      status: command.decision === "approved" ? "verified" : "reopened",
      remediationRounds: rounds,
      updatedAt: committedAt,
      productionReady: false
    };
  }

  findings[findingIndex] = updatedFinding;
  const taskFindings = findings.filter((item) => item.taskId === task.id);
  const derivedTask = recomputeInspectionTaskStatus(task, taskFindings, committedAt);
  const updatedTask = {
    ...derivedTask,
    version: task.version + 1
  };
  tasks[taskIndex] = updatedTask;
  const nextData = replaceCollections(state, {
      [COLLECTIONS.tasks]: tasks,
      [COLLECTIONS.findings]: findings
    });
  return commandResult(nextData, {
    finding: updatedFinding,
    task: updatedTask
  });
}

function descendingByTime(left, right) {
  return String(right.updatedAt || right.createdAt || "").localeCompare(String(left.updatedAt || left.createdAt || ""));
}

function buildHealthSupervisionWorkbench(state, { user, templates, now } = {}) {
  const normalized = normalizeActor(user);
  const availableTemplates = Array.isArray(templates) ? templates : defaultTemplateCatalog.templates;
  let visibleSubjects;
  if (normalized.role === "commission" && COMMISSION_ORG_TYPES.has(normalized.orgType)) {
    visibleSubjects = collection(state, COLLECTIONS.subjects).filter((item) => commissionCanAccessSubject(normalized, item));
  } else if (normalized.role === "institution" && normalized.orgType === "medical_institution") {
    visibleSubjects = collection(state, COLLECTIONS.subjects).filter((item) => item.organizationCode === normalized.orgCode);
  } else {
    throw supervisionError("SCOPE_FORBIDDEN", "workbench organization scope denied", 403);
  }
  const subjectIds = new Set(visibleSubjects.map((item) => item.id));
  const visibleTasks = collection(state, COLLECTIONS.tasks).filter((item) => subjectIds.has(item.subjectId));
  const taskIds = new Set(visibleTasks.map((item) => item.id));
  const visibleRecords = collection(state, COLLECTIONS.records).filter((item) => taskIds.has(item.taskId));
  const visibleFindings = collection(state, COLLECTIONS.findings).filter((item) => taskIds.has(item.taskId));
  const cap = (rows) => [...rows].sort(descendingByTime).slice(0, LIMITS.workbenchRows);
  return Object.freeze({
    schemaVersion: "public-health-supervision-workbench.v1",
    generatedAt: resolveNow(now),
    productionReady: false,
    boundary: Object.freeze({
      caseManagementIncluded: false,
      attachmentUploadIncluded: false,
      externalIntegrationIncluded: false,
      localRuleValidationRequired: true
    }),
    summary: Object.freeze({
      subjects: visibleSubjects.length,
      tasks: visibleTasks.length,
      openTasks: visibleTasks.filter((item) => !["closed", "cancelled"].includes(item.status)).length,
      inspectionRecords: visibleRecords.length,
      findings: visibleFindings.length,
      pendingRemediation: visibleFindings.filter((item) => ["open", "reopened", "remediation-submitted"].includes(item.status)).length
    }),
    templates: Object.freeze(availableTemplates.map(projectTemplate)),
    subjects: Object.freeze(cap(visibleSubjects).map(projectSubject)),
    tasks: Object.freeze(cap(visibleTasks).map(projectTask)),
    inspectionRecords: Object.freeze(cap(visibleRecords).map(projectInspectionRecord)),
    findings: Object.freeze(cap(visibleFindings).map(projectFinding))
  });
}

module.exports = {
  applyInspectionTaskActionToState,
  applySupervisionFindingActionToState,
  buildHealthSupervisionWorkbench,
  commissionCanAccessSubject,
  createInspectionTaskToState,
  createSupervisionSubjectToState,
  recomputeInspectionTaskStatus
};
