"use strict";

const crypto = require("node:crypto");

const MEDICAL_PREVENTION_TASK_TEMPLATES = Object.freeze([
  {
    taskType: "medical-public-health-verification",
    name: "医疗机构病例与报告责任核实",
    ownerRole: "medical-public-health",
    requiredEvidence: ["case-source-review", "medical-public-health-receipt"]
  },
  {
    taskType: "primary-care-followup",
    name: "基层公共卫生核查与重点人群随访",
    ownerRole: "primary-care-public-health",
    requiredEvidence: ["primary-care-followup-record", "community-health-receipt"]
  }
]);

const TASK_ACTIONS = Object.freeze({
  "accept-task": { from: ["pending"], to: "accepted" },
  "start-task": { from: ["accepted"], to: "in-progress" },
  "record-task-receipt": { from: ["in-progress", "exception-open"], to: null },
  "retry-task": { from: ["exception-open"], to: "in-progress" },
  "close-task": { from: ["receipt-confirmed"], to: "closed" },
  "reopen-task": { from: ["closed"], to: "in-progress" }
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function clean(value) {
  return String(value ?? "").trim();
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = stableValue(value[key]);
      return result;
    }, {});
  }
  return value;
}

function actionPayloadFingerprint(payload = {}) {
  const normalized = Object.fromEntries(Object.entries(payload)
    .filter(([key]) => !["idempotencyKey", "at"].includes(key)));
  return sha256(JSON.stringify(stableValue(normalized)));
}

function actorRole(user = {}) {
  return clean(user.role).toLowerCase();
}

function actorName(user = {}) {
  return clean(user.name || user.username || user.id || "unknown");
}

function validDate(value) {
  return Number.isFinite(new Date(value).getTime());
}

function taskId(alertId, taskType) {
  return `ph-medprev-${sha256(`${clean(alertId)}\n${clean(taskType)}`).slice(0, 24)}`;
}

function validatePublicHealthMedicalPreventionTask(task = {}) {
  const findings = [];
  const template = MEDICAL_PREVENTION_TASK_TEMPLATES.find((item) => item.taskType === clean(task.taskType));
  if (!template) return ["unknown-task-type"];
  if (clean(task.id) !== taskId(task.alertId, task.taskType)) findings.push("task-id-binding-invalid");
  if (clean(task.ownerRole) !== template.ownerRole || !clean(task.ownerOrganizationId)) findings.push("task-owner-binding-invalid");
  const actualEvidence = [...new Set(Array.isArray(task.requiredEvidence) ? task.requiredEvidence.map(clean).filter(Boolean) : [])].sort();
  const expectedEvidence = [...template.requiredEvidence].sort();
  if (JSON.stringify(actualEvidence) !== JSON.stringify(expectedEvidence)) findings.push("task-required-evidence-invalid");
  const timeline = Array.isArray(task.timeline) ? task.timeline : [];
  if (Number(task.version) !== timeline.length || !timeline.length) findings.push("task-version-timeline-invalid");
  timeline.forEach((item, index) => {
    if (Number(item.sequence) !== index + 1) findings.push("task-timeline-sequence-invalid");
    if (index === 0) {
      if (item.action !== "dispatch-task" || item.to !== "pending") findings.push("task-dispatch-history-invalid");
      return;
    }
    const previous = timeline[index - 1];
    if (!TASK_ACTIONS[clean(item.action)] || clean(item.from) !== clean(previous.to)) {
      findings.push("task-timeline-transition-invalid");
    }
    if (!/^[a-f0-9]{64}$/.test(clean(item.idempotencyKeyHash))
      || !/^[a-f0-9]{64}$/.test(clean(item.payloadFingerprint))) {
      findings.push("task-timeline-integrity-fields-invalid");
    }
  });
  if (timeline.length && clean(task.state) !== clean(timeline[timeline.length - 1].to)) findings.push("task-state-history-mismatch");
  if (["receipt-confirmed", "closed"].includes(clean(task.state)) && clean(task.receipt?.status) !== "accepted") {
    findings.push("task-accepted-receipt-missing");
  }
  if (clean(task.state) === "exception-open"
    && (clean(task.exception?.status) !== "open" || !clean(task.exception?.owner) || !validDate(task.exception?.dueAt))) {
    findings.push("task-exception-invalid");
  }
  if (clean(task.state) === "closed") {
    const closureEvidence = [...new Set(Array.isArray(task.closure?.evidenceRefs)
      ? task.closure.evidenceRefs.map(clean).filter(Boolean)
      : [])].sort();
    if (!task.businessClosureComplete
      || !clean(task.closure?.conclusion)
      || JSON.stringify(closureEvidence) !== JSON.stringify(expectedEvidence)) {
      findings.push("task-closure-invalid");
    }
  }
  return [...new Set(findings)];
}

function isValidClosedPublicHealthMedicalPreventionTask(task = {}) {
  return clean(task.state) === "closed"
    && task.businessClosureComplete === true
    && validatePublicHealthMedicalPreventionTask(task).length === 0;
}

function createPublicHealthMedicalPreventionTasks(alert = {}, payload = {}, options = {}) {
  const alertId = clean(alert.id);
  if (!alertId || !["verified", "dispatched", "investigating"].includes(clean(alert.status))) {
    throw new Error("a verified public health alert is required to create medical-prevention tasks");
  }
  const dueAt = clean(payload.dueAt);
  if (!validDate(dueAt)) throw new Error("medical-prevention task dueAt is required");
  const medicalInstitutionId = clean(payload.medicalInstitutionId);
  const primaryCareOrganizationId = clean(payload.primaryCareOrganizationId);
  if (!medicalInstitutionId || !primaryCareOrganizationId) {
    throw new Error("medicalInstitutionId and primaryCareOrganizationId are required for medical-prevention dispatch");
  }
  const organizationByType = {
    "medical-public-health-verification": medicalInstitutionId,
    "primary-care-followup": primaryCareOrganizationId
  };
  const at = clean(options.at || payload.at || new Date().toISOString());
  return MEDICAL_PREVENTION_TASK_TEMPLATES.map((template) => ({
    id: taskId(alertId, template.taskType),
    version: 1,
    alertId,
    signalIds: Array.isArray(alert.signalIds) ? [...new Set(alert.signalIds.map(clean).filter(Boolean))] : [],
    taskType: template.taskType,
    name: template.name,
    ownerRole: template.ownerRole,
    ownerOrganizationId: organizationByType[template.taskType],
    regionCode: clean(alert.regionCode),
    dueAt: new Date(dueAt).toISOString(),
    priority: clean(alert.severity || "medium"),
    state: "pending",
    assignedTo: "",
    requiredEvidence: clone(template.requiredEvidence),
    receipt: null,
    exception: null,
    closure: null,
    timeline: [{
      id: `${taskId(alertId, template.taskType)}:history:1`,
      sequence: 1,
      action: "dispatch-task",
      from: "",
      to: "pending",
      actor: clean(options.actor || "surveillance-workflow"),
      role: clean(options.role || "system"),
      at,
      idempotencyKeyHash: sha256(clean(payload.idempotencyKey || `${alertId}:dispatch`))
    }],
    businessClosureComplete: false,
    productionReady: false
  }));
}

function ensurePublicHealthMedicalPreventionTasks(data = {}, alert = {}, payload = {}, options = {}) {
  const existing = Array.isArray(data.publicHealthMedicalPreventionTasks)
    ? clone(data.publicHealthMedicalPreventionTasks)
    : [];
  const expected = createPublicHealthMedicalPreventionTasks(alert, payload, options);
  const existingById = new Map(existing.map((item) => [clean(item.id), item]));
  const created = [];
  expected.forEach((task) => {
    const current = existingById.get(task.id);
    if (current) {
      if (clean(current.alertId) !== task.alertId
        || clean(current.taskType) !== task.taskType
        || clean(current.ownerOrganizationId) !== task.ownerOrganizationId) {
        throw new Error("medical-prevention task immutable binding conflict");
      }
      return;
    }
    existing.push(task);
    created.push(task);
  });
  return { tasks: existing, created };
}

function authorizeTask(task, action, user) {
  const role = actorRole(user);
  const allowed = action === "record-task-receipt"
    ? [task.ownerRole, "system", "commission", "cdc-surveillance"]
    : [task.ownerRole, "commission", "cdc-surveillance"];
  if (!allowed.includes(role)) {
    throw new Error(`role ${role || "missing"} is not allowed to ${action} for ${task.taskType}`);
  }
  return role;
}

function applyPublicHealthMedicalPreventionTaskAction(current = {}, payload = {}, user = {}) {
  const task = clone(current);
  const integrityFindings = validatePublicHealthMedicalPreventionTask(task);
  if (integrityFindings.length) {
    throw new Error(`medical-prevention task integrity invalid: ${integrityFindings[0]}`);
  }
  const action = clean(payload.action);
  const definition = TASK_ACTIONS[action];
  if (!definition) throw new Error(`unsupported medical-prevention task action: ${action}`);
  const role = authorizeTask(task, action, user);
  const idempotencyKey = clean(payload.idempotencyKey);
  if (!idempotencyKey) throw new Error(`idempotencyKey is required for ${action}`);
  const idempotencyKeyHash = sha256(idempotencyKey);
  const payloadFingerprint = actionPayloadFingerprint(payload);
  const duplicate = (task.timeline || []).find((item) => item.action === action && item.idempotencyKeyHash === idempotencyKeyHash);
  if (duplicate) {
    if (clean(duplicate.payloadFingerprint) !== payloadFingerprint) {
      throw new Error("medical-prevention task idempotency key payload conflict");
    }
    return { task, history: duplicate, idempotent: true };
  }
  if (!definition.from.includes(clean(task.state))) {
    throw new Error(`action ${action} is not allowed from state ${clean(task.state)}`);
  }
  if (payload.expectedVersion !== undefined && Number(payload.expectedVersion) !== Number(task.version)) {
    throw new Error(`medical-prevention task version conflict: expected ${payload.expectedVersion}, current ${task.version}`);
  }
  let nextState = definition.to || task.state;
  if (action === "accept-task") {
    if (!clean(payload.assignedTo) || !clean(payload.note)) {
      throw new Error("assignedTo and note are required to accept a medical-prevention task");
    }
    task.assignedTo = clean(payload.assignedTo);
  }
  if (["start-task", "retry-task", "reopen-task"].includes(action) && !clean(payload.note)) {
    throw new Error(`note is required to ${action}`);
  }
  if (action === "record-task-receipt") {
    const receiptStatus = clean(payload.receiptStatus).toLowerCase();
    const evidenceRefs = Array.isArray(payload.evidenceRefs)
      ? [...new Set(payload.evidenceRefs.map(clean).filter(Boolean))]
      : [];
    if (!["accepted", "rejected"].includes(receiptStatus) || !clean(payload.receiptCode) || !evidenceRefs.length) {
      throw new Error("receiptStatus, receiptCode and evidenceRefs are required for medical-prevention receipt");
    }
    task.receipt = {
      status: receiptStatus,
      code: clean(payload.receiptCode),
      evidenceRefs,
      receivedAt: clean(payload.at || new Date().toISOString())
    };
    if (receiptStatus === "accepted") {
      nextState = "receipt-confirmed";
      task.exception = task.exception ? { ...task.exception, status: "closed" } : null;
    } else {
      if (!clean(payload.reason) || !clean(payload.exceptionOwner) || !validDate(payload.exceptionDueAt)) {
        throw new Error("reason, exceptionOwner and exceptionDueAt are required for rejected medical-prevention receipt");
      }
      nextState = "exception-open";
      task.exception = {
        status: "open",
        reason: clean(payload.reason),
        owner: clean(payload.exceptionOwner),
        dueAt: new Date(payload.exceptionDueAt).toISOString()
      };
    }
  }
  if (action === "retry-task") {
    task.exception = task.exception ? { ...task.exception, status: "retry-submitted" } : null;
  }
  if (action === "close-task") {
    const evidenceRefs = Array.isArray(payload.evidenceRefs)
      ? [...new Set(payload.evidenceRefs.map(clean).filter(Boolean))]
      : [];
    const expectedEvidence = [...new Set(task.requiredEvidence || [])].sort();
    if (JSON.stringify(evidenceRefs.sort()) !== JSON.stringify(expectedEvidence) || !clean(payload.conclusion)) {
      throw new Error("conclusion and the exact requiredEvidence are required to close a medical-prevention task");
    }
    task.closure = {
      conclusion: clean(payload.conclusion),
      evidenceRefs,
      closedAt: clean(payload.at || new Date().toISOString()),
      closedBy: actorName(user)
    };
    task.businessClosureComplete = true;
  }
  if (action === "reopen-task") {
    task.closure = null;
    task.businessClosureComplete = false;
  }
  const sequence = (task.timeline || []).length + 1;
  const history = {
    id: `${task.id}:history:${sequence}`,
    sequence,
    action,
    from: task.state,
    to: nextState,
    actor: actorName(user),
    role,
    at: clean(payload.at || new Date().toISOString()),
    idempotencyKeyHash,
    payloadFingerprint,
    note: clean(payload.note || payload.conclusion || payload.reason)
  };
  task.state = nextState;
  task.version = Number(task.version || 0) + 1;
  task.timeline = [...(task.timeline || []), history].slice(-40);
  task.productionReady = false;
  return { task, history, idempotent: false };
}

function buildPublicHealthMedicalPreventionBoard({ data = {}, alerts = [] } = {}) {
  const tasks = Array.isArray(data.publicHealthMedicalPreventionTasks)
    ? clone(data.publicHealthMedicalPreventionTasks)
    : [];
  const alertIds = new Set((Array.isArray(alerts) ? alerts : []).map((item) => clean(item.id)));
  const orphanTasks = tasks.filter((item) => alertIds.size && !alertIds.has(clean(item.alertId)));
  const integrityFindings = tasks.flatMap((task) => validatePublicHealthMedicalPreventionTask(task)
    .map((code) => ({ taskId: clean(task.id), alertId: clean(task.alertId), code })));
  const closedTasks = tasks.filter(isValidClosedPublicHealthMedicalPreventionTask);
  const representedRoles = new Set(tasks.map((item) => clean(item.ownerRole)).filter(Boolean));
  return {
    ok: orphanTasks.length === 0 && integrityFindings.length === 0,
    functionalState: orphanTasks.length || integrityFindings.length
      ? "medical-prevention-collaboration-review-required"
      : "medical-prevention-collaboration-runnable",
    formalGoLiveState: "blocked-until-medical-primary-care-receipts-and-site-evidence-verified",
    summary: {
      tasks: tasks.length,
      openTasks: tasks.length - closedTasks.length,
      closedTasks: closedTasks.length,
      medicalPublicHealthTasks: tasks.filter((item) => item.ownerRole === "medical-public-health").length,
      primaryCareTasks: tasks.filter((item) => item.ownerRole === "primary-care-public-health").length,
      representedRoles: representedRoles.size,
      exceptions: tasks.filter((item) => item.state === "exception-open").length,
      orphanTasks: orphanTasks.length,
      integrityFindings: integrityFindings.length
    },
    tasks: tasks.map((item) => ({
      id: clean(item.id),
      alertId: clean(item.alertId),
      taskType: clean(item.taskType),
      ownerRole: clean(item.ownerRole),
      ownerOrganizationId: clean(item.ownerOrganizationId),
      regionCode: clean(item.regionCode),
      state: clean(item.state),
      dueAt: clean(item.dueAt),
      version: Number(item.version || 0),
      businessClosureComplete: Boolean(item.businessClosureComplete)
    })),
    integrityFindings,
    productionReady: false,
    blockers: [
      "Medical institution public-health department and primary-care receipts require production verification.",
      "Disease-control supervisor review and trusted site evidence remain required."
    ]
  };
}

function applyPublicHealthMedicalPreventionTaskActionToState(data = {}, taskIdValue, payload = {}, user = {}) {
  const tasks = Array.isArray(data.publicHealthMedicalPreventionTasks)
    ? clone(data.publicHealthMedicalPreventionTasks)
    : [];
  const index = tasks.findIndex((item) => clean(item.id) === clean(taskIdValue));
  if (index < 0) throw new Error(`unknown medical-prevention task: ${clean(taskIdValue) || "missing"}`);
  const result = applyPublicHealthMedicalPreventionTaskAction(tasks[index], payload, user);
  tasks[index] = result.task;
  const existingAudit = Array.isArray(data.publicHealthMedicalPreventionAudit)
    ? clone(data.publicHealthMedicalPreventionAudit)
    : [];
  const audit = result.idempotent ? existingAudit : [...existingAudit, {
    id: `${result.task.id}:audit:${result.history.sequence}`,
    taskId: result.task.id,
    alertId: result.task.alertId,
    taskType: result.task.taskType,
    action: result.history.action,
    from: result.history.from,
    to: result.history.to,
    actor: result.history.actor,
    role: result.history.role,
    at: result.history.at,
    version: result.task.version
  }];
  const nextData = {
    ...data,
    publicHealthMedicalPreventionTasks: tasks,
    publicHealthMedicalPreventionAudit: audit
  };
  return {
    ok: true,
    idempotent: result.idempotent,
    task: clone(result.task),
    action: clone(result.history),
    nextData,
    collaboration: buildPublicHealthMedicalPreventionBoard({
      data: nextData,
      alerts: data.publicHealthSurveillanceAlerts
    }),
    productionReady: false
  };
}

module.exports = {
  MEDICAL_PREVENTION_TASK_TEMPLATES,
  TASK_ACTIONS,
  applyPublicHealthMedicalPreventionTaskAction,
  applyPublicHealthMedicalPreventionTaskActionToState,
  buildPublicHealthMedicalPreventionBoard,
  createPublicHealthMedicalPreventionTasks,
  ensurePublicHealthMedicalPreventionTasks,
  isValidClosedPublicHealthMedicalPreventionTask,
  validatePublicHealthMedicalPreventionTask
};
