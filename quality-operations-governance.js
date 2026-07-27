const { createHash } = require("node:crypto");

const DOMAINS = Object.freeze({
  QUALITY_RECTIFICATION: "quality-rectification",
  RESOURCE_DISPATCH: "resource-dispatch",
  DRUG_CONSUMABLE: "drug-consumable"
});

const CANONICAL_STATUSES = Object.freeze([
  "detected",
  "triaged",
  "assigned",
  "in_progress",
  "evidence_submitted",
  "under_review",
  "returned",
  "escalated",
  "closed",
  "cancelled"
]);

const TERMINAL_STATUSES = new Set(["closed", "cancelled"]);

const STATUS_MACHINES = deepFreeze({
  [DOMAINS.QUALITY_RECTIFICATION]: {
    detected: { triage: "triaged", dispatch: "assigned" },
    triaged: { dispatch: "assigned" },
    assigned: { start: "in_progress", submit_evidence: "evidence_submitted", escalate: "escalated", cancel: "cancelled" },
    in_progress: { submit_evidence: "evidence_submitted", escalate: "escalated", cancel: "cancelled" },
    evidence_submitted: { review: "under_review", return: "returned", escalate: "escalated" },
    under_review: { approve: "closed", return: "returned", escalate: "escalated" },
    returned: { resume: "in_progress", submit_evidence: "evidence_submitted", escalate: "escalated" },
    escalated: { resume: "in_progress", submit_evidence: "evidence_submitted", cancel: "cancelled" },
    closed: {},
    cancelled: {}
  },
  [DOMAINS.RESOURCE_DISPATCH]: {
    detected: { triage: "triaged" },
    triaged: { assign: "assigned", cancel: "cancelled" },
    assigned: { accept: "in_progress", start: "in_progress", return: "returned", escalate: "escalated", cancel: "cancelled" },
    in_progress: { complete: "evidence_submitted", submit_evidence: "evidence_submitted", escalate: "escalated", cancel: "cancelled" },
    evidence_submitted: { review: "under_review", return: "returned", escalate: "escalated" },
    under_review: { approve: "closed", close: "closed", return: "returned", escalate: "escalated" },
    returned: { reassign: "assigned", resume: "in_progress", cancel: "cancelled" },
    escalated: { reassign: "assigned", resume: "in_progress", cancel: "cancelled" },
    closed: {},
    cancelled: {}
  },
  [DOMAINS.DRUG_CONSUMABLE]: {
    detected: { triage: "triaged", review: "under_review" },
    triaged: { assign: "assigned", review: "under_review", request_remediation: "returned" },
    assigned: { start: "in_progress", request_remediation: "returned", escalate: "escalated" },
    in_progress: { submit_evidence: "evidence_submitted", insurance_sync: "under_review", escalate: "escalated" },
    evidence_submitted: { review: "under_review", return: "returned", escalate: "escalated" },
    under_review: { approve: "closed", return: "returned", request_remediation: "returned", escalate: "escalated" },
    returned: { resume: "in_progress", submit_evidence: "evidence_submitted", escalate: "escalated" },
    escalated: { resume: "in_progress", submit_evidence: "evidence_submitted", cancel: "cancelled" },
    closed: {},
    cancelled: {}
  }
});

const SOURCE_STATUS_MAPS = deepFreeze({
  [DOMAINS.QUALITY_RECTIFICATION]: {
    open: "detected",
    pending_disposition: "detected",
    variance_open: "detected",
    dispatched: "assigned",
    acknowledged: "in_progress",
    feedback_submitted: "evidence_submitted",
    review_pending: "under_review",
    returned: "returned",
    escalated: "escalated",
    approved: "closed",
    closed: "closed",
    disposed: "closed",
    cancelled: "cancelled"
  },
  [DOMAINS.RESOURCE_DISPATCH]: {
    open: "detected",
    draft: "triaged",
    "triage-confirmed": "triaged",
    pending: "assigned",
    "pending-review": "under_review",
    assigned: "assigned",
    "in-progress": "in_progress",
    dispatching: "in_progress",
    completed: "evidence_submitted",
    "evidence-submitted": "evidence_submitted",
    approved: "closed",
    closed: "closed",
    returned: "returned",
    blocked: "escalated",
    escalated: "escalated",
    cancelled: "cancelled"
  },
  [DOMAINS.DRUG_CONSUMABLE]: {
    open: "detected",
    "pending-review": "triaged",
    "pending-audit": "triaged",
    "clue-registered": "triaged",
    "supply-alert-registered": "triaged",
    "institution-confirmed": "assigned",
    tracking: "in_progress",
    "in-progress": "in_progress",
    "in-review": "under_review",
    coordinating: "under_review",
    submitted: "evidence_submitted",
    "remediation-submitted": "evidence_submitted",
    "evidence-complete": "evidence_submitted",
    "traceability-evidence-complete": "evidence_submitted",
    "evidence-partial": "returned",
    "traceability-evidence-partial": "returned",
    rejected: "returned",
    returned: "returned",
    escalated: "escalated",
    synced: "under_review",
    "insurance-synced": "under_review",
    approved: "closed",
    closed: "closed",
    cancelled: "cancelled"
  }
});

const ACTION_POLICIES = deepFreeze({
  [DOMAINS.QUALITY_RECTIFICATION]: {
    triage: ["commission"],
    dispatch: ["commission"],
    start: ["commission", "institution"],
    submit_evidence: ["commission", "institution"],
    review: ["commission"],
    approve: ["commission"],
    return: ["commission"],
    resume: ["commission", "institution"],
    escalate: ["commission"],
    cancel: ["commission"]
  },
  [DOMAINS.RESOURCE_DISPATCH]: {
    triage: ["commission"],
    assign: ["commission"],
    accept: ["commission", "institution"],
    start: ["commission", "institution"],
    complete: ["commission", "institution"],
    submit_evidence: ["commission", "institution"],
    review: ["commission"],
    approve: ["commission"],
    close: ["commission"],
    return: ["commission"],
    reassign: ["commission"],
    resume: ["commission", "institution"],
    escalate: ["commission"],
    cancel: ["commission"]
  },
  [DOMAINS.DRUG_CONSUMABLE]: {
    triage: ["commission", "insurance"],
    assign: ["commission"],
    start: ["commission", "institution"],
    submit_evidence: ["commission", "institution"],
    review: ["commission", "insurance"],
    insurance_sync: ["commission", "insurance"],
    approve: ["commission", "insurance"],
    return: ["commission", "insurance"],
    request_remediation: ["commission", "insurance"],
    resume: ["commission", "institution"],
    escalate: ["commission"],
    cancel: ["commission"]
  }
});

const METRIC_DEFINITIONS = deepFreeze([
  metric("quality.rectification-closure-rate", DOMAINS.QUALITY_RECTIFICATION, "医疗质量整改闭环率", "医政医管处/质控中心", "quality-governance", "%", "month", "at_least", 95, 90, 80, ["qualityRectificationOrders.status"]),
  metric("quality.rectification-overdue-rate", DOMAINS.QUALITY_RECTIFICATION, "医疗质量整改超期率", "医政医管处/质控中心", "quality-governance", "%", "month", "at_most", 5, 10, 20, ["qualityRectificationOrders.dueAt", "qualityRectificationOrders.status"]),
  metric("quality.evidence-completeness-rate", DOMAINS.QUALITY_RECTIFICATION, "整改证据完整率", "医疗机构质管办", "institution-quality", "%", "month", "at_least", 95, 90, 80, ["qualityRectificationOrders.feedback.attachments"]),
  metric("quality.critical-value-disposition-rate", DOMAINS.QUALITY_RECTIFICATION, "危急值处置完成率", "医疗机构值班台/医务部", "institution-duty", "%", "day", "at_least", 98, 95, 90, ["criticalValueAlerts.acknowledgedAt", "criticalValueAlerts.disposedAt"]),
  metric("operations.bed-occupancy-rate", DOMAINS.RESOURCE_DISPATCH, "开放床位占用率", "运行调度岗/医政医管处", "operations-dispatch", "%", "hour", "at_most", 90, 95, 98, ["hospitalOperationSnapshots.beds.open", "hospitalOperationSnapshots.beds.occupied"]),
  metric("operations.staff-shortage-count", DOMAINS.RESOURCE_DISPATCH, "值班人员缺口", "人事科/护理部/医务部", "workforce-operations", "person", "shift", "at_most", 0, 1, 5, ["hospitalOperationSnapshots.staff.shortage"]),
  metric("operations.equipment-availability-rate", DOMAINS.RESOURCE_DISPATCH, "关键设备可用率", "设备科/急诊科", "equipment-operations", "%", "hour", "at_least", 95, 90, 80, ["hospitalOperationSnapshots.equipment"]),
  metric("operations.dispatch-sla-rate", DOMAINS.RESOURCE_DISPATCH, "资源调度按时到位率", "运行调度岗/医政医管处", "operations-dispatch", "%", "month", "at_least", 95, 90, 80, ["resourceDispatchRequests.requiredBy", "resourceDispatchRequests.closedAt"]),
  metric("operations.reconciliation-variance-rate", DOMAINS.RESOURCE_DISPATCH, "统计直报差异率", "统计办公室/规划信息处", "statistics-governance", "%", "reporting-period", "at_most", 3, 5, 10, ["statisticsReconciliationReviews.varianceRate"]),
  metric("drug.traceability-evidence-completeness-rate", DOMAINS.DRUG_CONSUMABLE, "药品追溯证据完整率", "医院药学部/医保中心", "traceability-governance", "%", "month", "at_least", 98, 95, 90, ["drugConsumableSupervisions.traceabilityEvidenceCoverage"]),
  metric("drug.prescription-review-completion-rate", DOMAINS.DRUG_CONSUMABLE, "处方审方完成率", "医院药学部/医保中心", "prescription-review", "%", "month", "at_least", 95, 90, 80, ["drugConsumableSupervisions.reviewStatus"]),
  metric("drug.supply-alert-closure-rate", DOMAINS.DRUG_CONSUMABLE, "供应保障预警闭环率", "医院药学部/药械管理部门", "supply-governance", "%", "month", "at_least", 95, 90, 80, ["drugConsumableSupervisions.remediationStatus"]),
  metric("drug.high-value-consumable-closure-rate", DOMAINS.DRUG_CONSUMABLE, "高值耗材线索闭环率", "耗材管理部门/医政医管处", "consumable-governance", "%", "month", "at_least", 95, 90, 80, ["drugConsumableSupervisions.status", "institutionSupervisions"]),
  metric("drug.insurance-sync-success-rate", DOMAINS.DRUG_CONSUMABLE, "医保协同同步成功率", "医保局/医保中心", "insurance-integration", "%", "day", "at_least", 99, 97, 95, ["drugConsumableSupervisions.insuranceStatus", "insuranceClaims.status"])
]);

function metric(id, domain, name, department, stewardRole, unit, period, direction, target, warning, critical, sourceFields) {
  return {
    id,
    domain,
    name,
    owner: { department, stewardRole },
    unit,
    period,
    threshold: { direction, target, warning, critical },
    sourceFields
  };
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
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

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function normalizeSourceStatus(domain, sourceStatus) {
  const map = SOURCE_STATUS_MAPS[domain];
  if (!map) return "unknown";
  const key = String(sourceStatus || "").trim().toLowerCase();
  return map[key] || "unknown";
}

function institutionScope(record) {
  return [...new Set([
    record.institutionId,
    record.sourceInstitutionId,
    record.targetInstitutionId
  ].map((item) => String(item || "").trim()).filter(Boolean))];
}

function institutionActionTarget(record, action) {
  if (record.domain === DOMAINS.RESOURCE_DISPATCH && ["accept", "start", "complete", "submit_evidence", "resume"].includes(action)) {
    return String(record.targetInstitutionId || record.institutionId || "").trim();
  }
  return String(record.institutionId || "").trim();
}

function authorizeGovernanceCommand(record, command) {
  const actor = command.actor || {};
  const actorRole = String(actor.role || "").trim();
  const roles = ACTION_POLICIES[record.domain]?.[command.action] || [];
  if (!roles.includes(actorRole)) {
    return { allowed: false, code: "ACTOR_FORBIDDEN", reason: `${actorRole || "missing-role"} cannot ${command.action} ${record.domain}` };
  }

  const recordInstitutions = institutionScope(record);
  const explicitScope = Array.isArray(actor.scopeInstitutionIds)
    ? actor.scopeInstitutionIds.map((item) => String(item).trim()).filter(Boolean)
    : [];
  if (explicitScope.length && recordInstitutions.some((institutionId) => !explicitScope.includes(institutionId))) {
    return { allowed: false, code: "INSTITUTION_SCOPE_DENIED", reason: "record institutions exceed actor scope" };
  }

  if (actorRole === "institution") {
    const actorInstitutionId = String(actor.institutionId || "").trim();
    const targetInstitutionId = institutionActionTarget(record, command.action);
    if (!actorInstitutionId || !targetInstitutionId || actorInstitutionId !== targetInstitutionId) {
      return { allowed: false, code: "INSTITUTION_SCOPE_DENIED", reason: "institution actor can only operate its assigned institution record" };
    }
  }

  return { allowed: true, code: "ALLOWED", reason: "role and institution scope accepted" };
}

function normalizeRecord(record) {
  const domain = String(record.domain || "").trim();
  const status = String(record.status || "").trim();
  if (!STATUS_MACHINES[domain]) throw new Error(`unsupported governance domain: ${domain || "missing"}`);
  if (!CANONICAL_STATUSES.includes(status)) throw new Error(`unsupported canonical status: ${status || "missing"}`);
  if (!String(record.id || "").trim()) throw new Error("governance record id is required");
  return {
    ...clone(record),
    id: String(record.id).trim(),
    domain,
    status,
    version: Number.isInteger(record.version) && record.version >= 0 ? record.version : 0,
    auditEvents: Array.isArray(record.auditEvents) ? clone(record.auditEvents) : []
  };
}

function createGovernanceState(records = []) {
  const normalized = records.map(normalizeRecord);
  const ids = normalized.map((item) => item.id);
  if (new Set(ids).size !== ids.length) throw new Error("governance record ids must be unique");
  return {
    records: Object.fromEntries(normalized.map((item) => [item.id, item])),
    commandReceipts: {},
    auditEvents: []
  };
}

function normalizeState(state) {
  const records = Object.values(state?.records || {}).map(normalizeRecord);
  return {
    records: Object.fromEntries(records.map((item) => [item.id, item])),
    commandReceipts: clone(state?.commandReceipts || {}),
    auditEvents: clone(state?.auditEvents || [])
  };
}

function commandFingerprint(command) {
  return sha256(stableStringify({
    domain: command.domain,
    recordId: command.recordId,
    action: command.action,
    actor: {
      id: command.actor?.id,
      role: command.actor?.role,
      institutionId: command.actor?.institutionId,
      scopeInstitutionIds: command.actor?.scopeInstitutionIds
    },
    expectedVersion: command.expectedVersion,
    payload: command.payload || {}
  }));
}

function appendAuditEvent(state, record, command, details) {
  const occurredAt = String(command.occurredAt || new Date().toISOString());
  const previousHash = state.auditEvents.at(-1)?.hash || "";
  const base = {
    id: `qod-audit-${sha256(`${command.idempotencyKey}:${state.auditEvents.length}:${occurredAt}`).slice(0, 20)}`,
    occurredAt,
    commandId: command.idempotencyKey,
    recordId: String(command.recordId || ""),
    domain: String(command.domain || record?.domain || ""),
    action: String(command.action || ""),
    actorId: String(command.actor?.id || ""),
    actorRole: String(command.actor?.role || ""),
    actorInstitutionId: String(command.actor?.institutionId || ""),
    institutionIds: record ? institutionScope(record) : [],
    outcome: details.outcome,
    code: details.code,
    reason: details.reason,
    fromStatus: details.fromStatus || "",
    toStatus: details.toStatus || "",
    previousHash
  };
  const event = { ...base, hash: sha256(stableStringify(base)) };
  state.auditEvents.push(event);
  return event;
}

function commandError(code, message) {
  return { code, message };
}

function validateCommand(command) {
  if (!command || typeof command !== "object") return commandError("INVALID_COMMAND", "command is required");
  if (!String(command.idempotencyKey || "").trim()) return commandError("INVALID_COMMAND", "idempotencyKey is required");
  if (!String(command.recordId || "").trim()) return commandError("INVALID_COMMAND", "recordId is required");
  if (!String(command.domain || "").trim()) return commandError("INVALID_COMMAND", "domain is required");
  if (!String(command.action || "").trim()) return commandError("INVALID_COMMAND", "action is required");
  if (!String(command.actor?.id || "").trim() || !String(command.actor?.role || "").trim()) {
    return commandError("INVALID_COMMAND", "actor id and role are required");
  }
  if (!Number.isInteger(command.expectedVersion) || command.expectedVersion < 0) {
    return commandError("INVALID_COMMAND", "expectedVersion must be a non-negative integer");
  }
  return null;
}

function resultFromReceipt(state, receipt, replayed) {
  const auditEvent = state.auditEvents.find((item) => item.id === receipt.auditEventId);
  return {
    ok: receipt.ok,
    replayed,
    state,
    record: clone(receipt.recordSnapshot),
    auditEvent: clone(auditEvent),
    receipt: clone(receipt),
    error: receipt.ok ? undefined : { code: receipt.code, message: receipt.message }
  };
}

function rememberResult(state, command, fingerprint, record, auditEvent, outcome) {
  const receipt = {
    idempotencyKey: command.idempotencyKey,
    fingerprint,
    ok: outcome.ok,
    code: outcome.code,
    message: outcome.message,
    recordId: String(command.recordId || ""),
    domain: String(command.domain || record?.domain || ""),
    action: String(command.action || ""),
    fromStatus: outcome.fromStatus || "",
    toStatus: outcome.toStatus || "",
    version: record?.version ?? null,
    auditEventId: auditEvent.id,
    recordSnapshot: clone(record)
  };
  state.commandReceipts[command.idempotencyKey] = receipt;
  return resultFromReceipt(state, receipt, false);
}

function rejectCommand(state, record, command, fingerprint, code, message, remember = true) {
  const auditEvent = appendAuditEvent(state, record, command, {
    outcome: "denied",
    code,
    reason: message,
    fromStatus: record?.status || "",
    toStatus: record?.status || ""
  });
  if (!remember) {
    return {
      ok: false,
      replayed: false,
      state,
      record: clone(record),
      auditEvent,
      error: { code, message }
    };
  }
  return rememberResult(state, command, fingerprint, record, auditEvent, {
    ok: false,
    code,
    message,
    fromStatus: record?.status || "",
    toStatus: record?.status || ""
  });
}

function executeGovernanceCommand(inputState, inputCommand) {
  const state = normalizeState(inputState);
  const command = {
    ...clone(inputCommand || {}),
    idempotencyKey: String(inputCommand?.idempotencyKey || "").trim(),
    domain: String(inputCommand?.domain || "").trim(),
    recordId: String(inputCommand?.recordId || "").trim(),
    action: String(inputCommand?.action || "").trim()
  };
  const validationError = validateCommand(command);
  if (validationError) {
    const fallbackKey = command.idempotencyKey || `invalid-${sha256(stableStringify(command)).slice(0, 20)}`;
    command.idempotencyKey = fallbackKey;
    return rejectCommand(state, null, command, commandFingerprint(command), validationError.code, validationError.message, false);
  }

  const fingerprint = commandFingerprint(command);
  const existingReceipt = state.commandReceipts[command.idempotencyKey];
  if (existingReceipt) {
    if (existingReceipt.fingerprint === fingerprint) return resultFromReceipt(state, existingReceipt, true);
    const record = state.records[command.recordId];
    return rejectCommand(state, record, command, fingerprint, "IDEMPOTENCY_CONFLICT", "idempotency key was already used by a different command", false);
  }

  const record = state.records[command.recordId];
  if (!record) return rejectCommand(state, null, command, fingerprint, "RECORD_NOT_FOUND", "governance record not found");
  if (record.domain !== command.domain) {
    return rejectCommand(state, record, command, fingerprint, "DOMAIN_MISMATCH", "command domain does not match record domain");
  }
  if (command.expectedVersion !== undefined && Number(command.expectedVersion) !== record.version) {
    return rejectCommand(state, record, command, fingerprint, "VERSION_CONFLICT", `expected version ${command.expectedVersion}, current version ${record.version}`);
  }

  const authorization = authorizeGovernanceCommand(record, command);
  if (!authorization.allowed) {
    return rejectCommand(state, record, command, fingerprint, authorization.code, authorization.reason);
  }

  const nextStatus = STATUS_MACHINES[record.domain]?.[record.status]?.[command.action];
  if (!nextStatus) {
    const terminal = TERMINAL_STATUSES.has(record.status);
    return rejectCommand(
      state,
      record,
      command,
      fingerprint,
      "INVALID_TRANSITION",
      terminal ? `${record.status} is terminal` : `${command.action} is not allowed from ${record.status}`
    );
  }

  const fromStatus = record.status;
  const occurredAt = String(command.occurredAt || new Date().toISOString());
  const updated = {
    ...record,
    status: nextStatus,
    version: record.version + 1,
    updatedAt: occurredAt,
    updatedBy: command.actor.id,
    lastCommandId: command.idempotencyKey,
    lastAction: command.action,
    details: {
      ...(record.details || {}),
      ...(command.payload || {})
    }
  };
  const auditEvent = appendAuditEvent(state, updated, command, {
    outcome: "allowed",
    code: "TRANSITION_APPLIED",
    reason: String(command.payload?.note || `${command.action}: ${fromStatus} -> ${nextStatus}`),
    fromStatus,
    toStatus: nextStatus
  });
  updated.auditEvents = [...record.auditEvents, auditEvent];
  state.records[record.id] = updated;
  return rememberResult(state, command, fingerprint, updated, auditEvent, {
    ok: true,
    code: "TRANSITION_APPLIED",
    message: "governance transition applied",
    fromStatus,
    toStatus: nextStatus
  });
}

function evaluateMetricThreshold(definition, value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "unknown";
  const threshold = definition?.threshold || {};
  if (threshold.direction === "at_least") {
    if (number >= threshold.target) return "target";
    if (number >= threshold.warning) return "warning";
    if (number >= threshold.critical) return "critical";
    return "breached";
  }
  if (threshold.direction === "at_most") {
    if (number <= threshold.target) return "target";
    if (number <= threshold.warning) return "warning";
    if (number <= threshold.critical) return "critical";
    return "breached";
  }
  return "unknown";
}

function validateMetricCatalog(definitions = METRIC_DEFINITIONS) {
  const errors = [];
  const ids = new Set();
  for (const definition of definitions) {
    if (!definition.id || ids.has(definition.id)) errors.push(`duplicate or missing metric id: ${definition.id || "missing"}`);
    ids.add(definition.id);
    if (!Object.values(DOMAINS).includes(definition.domain)) errors.push(`${definition.id}: unsupported domain`);
    if (!definition.owner?.department || !definition.owner?.stewardRole) errors.push(`${definition.id}: owner is incomplete`);
    if (!definition.unit || !definition.period) errors.push(`${definition.id}: unit or period is missing`);
    if (!["at_least", "at_most"].includes(definition.threshold?.direction)) errors.push(`${definition.id}: threshold direction is invalid`);
    if (![definition.threshold?.target, definition.threshold?.warning, definition.threshold?.critical].every(Number.isFinite)) {
      errors.push(`${definition.id}: threshold values are incomplete`);
    } else if (
      definition.threshold.direction === "at_least" &&
      !(definition.threshold.target >= definition.threshold.warning && definition.threshold.warning >= definition.threshold.critical)
    ) {
      errors.push(`${definition.id}: at_least thresholds must descend from target to critical`);
    } else if (
      definition.threshold.direction === "at_most" &&
      !(definition.threshold.target <= definition.threshold.warning && definition.threshold.warning <= definition.threshold.critical)
    ) {
      errors.push(`${definition.id}: at_most thresholds must ascend from target to critical`);
    }
    if (!Array.isArray(definition.sourceFields) || !definition.sourceFields.length) errors.push(`${definition.id}: source fields are missing`);
  }
  return { ok: errors.length === 0, errors, metrics: definitions.length };
}

module.exports = {
  ACTION_POLICIES,
  CANONICAL_STATUSES,
  DOMAINS,
  METRIC_DEFINITIONS,
  SOURCE_STATUS_MAPS,
  STATUS_MACHINES,
  TERMINAL_STATUSES,
  authorizeGovernanceCommand,
  createGovernanceState,
  evaluateMetricThreshold,
  executeGovernanceCommand,
  institutionScope,
  normalizeSourceStatus,
  validateMetricCatalog
};
