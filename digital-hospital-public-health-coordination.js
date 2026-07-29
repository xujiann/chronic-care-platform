"use strict";

const { randomUUID } = require("crypto");

const PUBLIC_HEALTH_INCIDENT_TRANSITIONS = Object.freeze({
  "待核查": Object.freeze({
    action: "start-handling",
    nextStatus: "处置中",
    label: "开始处置"
  }),
  "处置中": Object.freeze({
    action: "submit-review",
    nextStatus: "待复核",
    label: "提交复核"
  }),
  "待复核": Object.freeze({
    action: "verify-close",
    nextStatus: "已关闭",
    label: "复核关闭"
  })
});

const PUBLIC_HEALTH_SLA_ESCALATION_ROUTES = Object.freeze({
  P0: Object.freeze({ level: "red", route: "卫健委值班负责人 -> 疾控业务负责人 -> 项目总指挥" }),
  P1: Object.freeze({ level: "amber", route: "业务处室负责人 -> 平台运营负责人" }),
  P2: Object.freeze({ level: "yellow", route: "责任组负责人 -> 平台运营值班" })
});

const PUBLIC_HEALTH_LANE_PROFESSIONAL_REFS = Object.freeze({
  "infectious-reporting": Object.freeze({
    eventId: "phe-infectious-001",
    exchangeTaskId: "phx-national-direct-report",
    exchangeRunId: "phxr-direct-report-001",
    evidencePacketId: "phcep-direct-report-endpoint",
    probeLaneId: "infectious-reporting"
  }),
  immunization: Object.freeze({
    eventId: "phe-immunization-001",
    exchangeTaskId: "phx-immunization",
    exchangeRunId: "phxr-immunization-001",
    evidencePacketId: "phcep-immunization-registry",
    probeLaneId: "immunization"
  }),
  "maternal-child": Object.freeze({
    exchangeTaskId: "phx-maternal-child",
    exchangeRunId: "phxr-maternal-child-001",
    evidencePacketId: "phcep-lis-emr-credentials",
    probeLaneId: "maternal-child"
  }),
  "senior-health": Object.freeze({ probeLaneId: "senior-health" }),
  "chronic-disease": Object.freeze({
    eventId: "phe-chronic-001",
    probeLaneId: "chronic-disease"
  }),
  "public-health-followup": Object.freeze({
    eventId: "phe-chronic-001",
    probeLaneId: "public-health-followup"
  }),
  "health-education": Object.freeze({ probeLaneId: "health-education" }),
  "family-doctor": Object.freeze({
    eventId: "phe-chronic-001",
    probeLaneId: "family-doctor"
  })
});

const SENSITIVE_FIELD_PATTERN = /(secret|password|token|signature|nonce|credential|certificate|private.?key|payload)/i;
const PROFESSIONAL_REFERENCE_KEYS = Object.freeze([
  "eventId",
  "exchangeTaskId",
  "exchangeRunId",
  "evidencePacketId",
  "probeLaneId"
]);

class PublicHealthCoordinationError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "PublicHealthCoordinationError";
    this.code = options.code || "PUBLIC_HEALTH_COORDINATION_INVALID";
    this.status = Number(options.status || 400);
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function coordinationError(message, code, status = 400) {
  throw new PublicHealthCoordinationError(message, { code, status });
}

function assertNoSensitiveFields(value, path = "payload") {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_FIELD_PATTERN.test(key)) {
      coordinationError(
        `${path}.${key} is not allowed in the public health coordination ledger`,
        "PUBLIC_HEALTH_SENSITIVE_FIELD_REJECTED"
      );
    }
    assertNoSensitiveFields(child, `${path}.${key}`);
  }
}

function normalizeProfessionalRefs(laneId, value = {}) {
  const defaults = PUBLIC_HEALTH_LANE_PROFESSIONAL_REFS[laneId] || {};
  const supplied = value && typeof value === "object" ? value : {};
  return Object.fromEntries(PROFESSIONAL_REFERENCE_KEYS
    .map((key) => [key, String(supplied[key] || defaults[key] || "").trim()])
    .filter(([, reference]) => reference));
}

function seedPublicHealthCoordination() {
  return {
    schemaVersion: 2,
    migrationSource: {
      taskTitle: "开发数智医院标准平台",
      sourceCommit: "4142402e0c79fd8457c00c370b5d163e88cca0e7",
      sourceVersion: "v0.17",
      mergedInto: "github-v0.19"
    },
    endpointConnectivityReady: true,
    continuousConnectivityReady: true,
    productionReady: false,
    consecutiveCampaigns: 3,
    requiredConsecutiveCampaigns: 3,
    campaignChainLinksVerified: 2,
    continuityBreak: null,
    lanes: [
      { id: "infectious-reporting", name: "传染病直报", owner: "疾控与医政", endpoint: "已配置", probe: "已验证", campaign: "PHC-20260728-003" },
      { id: "immunization", name: "免疫规划", owner: "疾控免疫科", endpoint: "已配置", probe: "已验证", campaign: "PHC-20260728-003" },
      { id: "maternal-child", name: "妇幼健康", owner: "妇幼健康处", endpoint: "已配置", probe: "已验证", campaign: "PHC-20260728-003" },
      { id: "senior-health", name: "老年健康", owner: "基层卫生处", endpoint: "已配置", probe: "已验证", campaign: "PHC-20260728-003" },
      { id: "chronic-disease", name: "慢病管理", owner: "疾控慢病科", endpoint: "已配置", probe: "已验证", campaign: "PHC-20260728-003" },
      { id: "public-health-followup", name: "公卫随访", owner: "基层卫生处", endpoint: "已配置", probe: "已验证", campaign: "PHC-20260728-003" },
      { id: "health-education", name: "健康教育", owner: "宣传与健康促进", endpoint: "已配置", probe: "已验证", campaign: "PHC-20260728-003" },
      { id: "family-doctor", name: "家庭医生", owner: "基层卫生处", endpoint: "已配置", probe: "已验证", campaign: "PHC-20260728-003" }
    ],
    campaigns: [
      { id: "PHC-20260728-001", completedAt: "2026-07-28 09:20", receipts: 8, status: "已验证", chain: "genesis" },
      { id: "PHC-20260728-002", completedAt: "2026-07-28 09:35", receipts: 8, status: "已验证", chain: "verified" },
      { id: "PHC-20260728-003", completedAt: "2026-07-28 09:50", receipts: 8, status: "已验证", chain: "verified" }
    ],
    incidents: [
      {
        id: "PHE-20260728-003",
        revision: 1,
        laneId: "infectious-reporting",
        title: "传染病直报回执超时",
        level: "P0",
        source: "连续探测",
        hospitalCode: "H000001",
        owner: "疾控与医政联络组",
        status: "待核查",
        discoveredAt: "2026-07-28 09:52",
        dueAt: "2026-07-28 10:22",
        lastUpdatedAt: "2026-07-28 09:52",
        latestAction: "等待核对上报端与接收端回执",
        submittedForReviewBy: "",
        professionalRefs: normalizeProfessionalRefs("infectious-reporting")
      },
      {
        id: "PHE-20260728-002",
        revision: 2,
        laneId: "public-health-followup",
        title: "重点人群随访数据延迟",
        level: "P1",
        source: "时效规则",
        hospitalCode: "H000003",
        owner: "基层卫生处协同组",
        status: "处置中",
        discoveredAt: "2026-07-28 08:40",
        dueAt: "2026-07-28 12:00",
        lastUpdatedAt: "2026-07-28 09:35",
        latestAction: "医院已补传，等待平台侧重算",
        submittedForReviewBy: "",
        professionalRefs: normalizeProfessionalRefs("public-health-followup")
      },
      {
        id: "PHE-20260727-006",
        revision: 3,
        laneId: "immunization",
        title: "免疫规划代码映射差异",
        level: "P1",
        source: "数据校验",
        hospitalCode: "H000002",
        owner: "疾控免疫科",
        status: "待复核",
        discoveredAt: "2026-07-27 15:10",
        dueAt: "2026-07-28 15:10",
        lastUpdatedAt: "2026-07-28 09:10",
        latestAction: "映射表已修订，等待业务复核",
        submittedForReviewBy: "u-city",
        professionalRefs: normalizeProfessionalRefs("immunization")
      },
      {
        id: "PHE-20260727-004",
        revision: 4,
        laneId: "maternal-child",
        title: "妇幼健康批次完整性告警",
        level: "P1",
        source: "完整性规则",
        hospitalCode: "H000001",
        owner: "妇幼健康处",
        status: "已关闭",
        discoveredAt: "2026-07-27 10:20",
        dueAt: "2026-07-27 14:20",
        lastUpdatedAt: "2026-07-27 13:05",
        closedAt: "2026-07-27 13:05",
        latestAction: "补传完成，完整性复核通过",
        submittedForReviewBy: "u-city",
        professionalRefs: normalizeProfessionalRefs("maternal-child")
      }
    ],
    incidentActions: [
      { id: "PHA-004", incidentId: "PHE-20260727-004", action: "verify-close", label: "复核关闭", actorId: "u-health", actor: "妇幼健康处", at: "2026-07-27 13:05", result: "补传完成，完整性复核通过", revision: 4 },
      { id: "PHA-003", incidentId: "PHE-20260727-006", action: "submit-review", label: "提交复核", actorId: "u-city", actor: "疾控免疫科", at: "2026-07-28 09:10", result: "代码映射表已修订", revision: 3 },
      { id: "PHA-002", incidentId: "PHE-20260728-002", action: "start-handling", label: "开始处置", actorId: "u-city", actor: "基层卫生处协同组", at: "2026-07-28 09:35", result: "医院已补传，等待平台侧重算", revision: 2 },
      { id: "PHA-001", incidentId: "PHE-20260728-003", action: "create", label: "登记事件", actorId: "system", actor: "连续探测服务", at: "2026-07-28 09:52", result: "回执超时，进入人工核查", revision: 1 }
    ],
    blockers: [
      "可信现场证据尚未签收",
      "正式业务回执与生产交接尚未完成",
      "P0/P1阻断需由责任部门关闭",
      "灾备、回退演练及多方上线审批待完成"
    ],
    updatedAt: "2026-07-28T13:05:00.000Z"
  };
}

function mergeById(seedRows, rows) {
  const result = new Map(seedRows.map((item) => [item.id, clone(item)]));
  for (const item of Array.isArray(rows) ? rows : []) {
    if (!item || typeof item !== "object" || !item.id) continue;
    result.set(item.id, { ...(result.get(item.id) || {}), ...clone(item) });
  }
  return Array.from(result.values());
}

function normalizePublicHealthCoordination(value = {}) {
  const seed = seedPublicHealthCoordination();
  const current = value && typeof value === "object" ? value : {};
  return {
    ...seed,
    ...clone(current),
    schemaVersion: 2,
    migrationSource: seed.migrationSource,
    productionReady: false,
    lanes: mergeById(seed.lanes, current.lanes),
    campaigns: mergeById(seed.campaigns, current.campaigns),
    incidents: mergeById(seed.incidents, current.incidents).map((item) => ({
      ...item,
      revision: Math.max(1, Number(item.revision || 1)),
      submittedForReviewBy: String(item.submittedForReviewBy || ""),
      professionalRefs: normalizeProfessionalRefs(item.laneId, item.professionalRefs),
      escalation: item.escalation && typeof item.escalation === "object"
        ? clone(item.escalation)
        : null
    })),
    incidentActions: mergeById(seed.incidentActions, current.incidentActions).slice(0, 500),
    blockers: Array.isArray(current.blockers) && current.blockers.length ? current.blockers.map(String) : seed.blockers
  };
}

function actorIdentity(actor = {}) {
  const id = String(actor.id || actor.username || actor.name || actor.role || "system").trim();
  return {
    id,
    name: String(actor.name || actor.username || actor.role || "系统").trim(),
    role: String(actor.role || "system").trim()
  };
}

function requiredText(value, field, minimum = 1) {
  const text = String(value || "").trim();
  if (text.length < minimum) {
    coordinationError(
      `${field} is required`,
      `PUBLIC_HEALTH_${field.replace(/([A-Z])/g, "_$1").toUpperCase()}_REQUIRED`
    );
  }
  return text;
}

function createPublicHealthIncident(currentState, payload = {}, actor = {}, options = {}) {
  assertNoSensitiveFields(payload);
  const state = normalizePublicHealthCoordination(currentState);
  const laneId = requiredText(payload.laneId, "laneId");
  if (!state.lanes.some((lane) => lane.id === laneId)) {
    coordinationError("laneId is not part of the governed public health catalog", "PUBLIC_HEALTH_LANE_NOT_FOUND", 404);
  }
  const id = String(payload.id || `PHE-${randomUUID()}`).trim();
  if (state.incidents.some((item) => item.id === id)) {
    coordinationError("incident id already exists", "PUBLIC_HEALTH_INCIDENT_DUPLICATE", 409);
  }
  const level = String(payload.level || "P1").trim().toUpperCase();
  if (!["P0", "P1", "P2"].includes(level)) {
    coordinationError("level must be P0, P1 or P2", "PUBLIC_HEALTH_INCIDENT_LEVEL_INVALID");
  }
  const now = String(options.now || new Date().toISOString());
  const principal = actorIdentity(actor);
  const note = requiredText(payload.note || payload.latestAction, "note", 4);
  const incident = {
    id,
    revision: 1,
    laneId,
    title: requiredText(payload.title, "title", 4),
    level,
    source: requiredText(payload.source || "人工登记", "source", 2),
    hospitalCode: requiredText(payload.hospitalCode, "hospitalCode", 2),
    owner: requiredText(payload.owner, "owner", 2),
    status: "待核查",
    discoveredAt: now,
    dueAt: requiredText(payload.dueAt, "dueAt", 8),
    lastUpdatedAt: now,
    latestAction: note,
    createdBy: principal.id,
    submittedForReviewBy: "",
    professionalRefs: normalizeProfessionalRefs(laneId, payload.professionalRefs),
    escalation: null
  };
  const action = {
    id: `PHA-${randomUUID()}`,
    incidentId: incident.id,
    action: "create",
    label: "登记事件",
    actorId: principal.id,
    actor: principal.name,
    actorRole: principal.role,
    at: now,
    result: note,
    revision: incident.revision
  };
  state.incidents = [incident, ...state.incidents].slice(0, 500);
  state.incidentActions = [action, ...state.incidentActions].slice(0, 500);
  state.updatedAt = now;
  state.productionReady = false;
  return { state, incident, action };
}

function parseCoordinationTime(value) {
  const text = String(value || "").trim();
  if (!text) return Number.NaN;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?$/.test(text)
    ? `${text.replace(" ", "T")}${text.length === 16 ? ":00" : ""}+08:00`
    : text;
  return Date.parse(normalized);
}

function evaluatePublicHealthIncidentSla(incident, now = new Date().toISOString()) {
  const dueAtMs = parseCoordinationTime(incident?.dueAt);
  const nowMs = parseCoordinationTime(now);
  const closedAtMs = parseCoordinationTime(incident?.closedAt);
  const terminal = incident?.status === "已关闭";
  const referenceMs = terminal && Number.isFinite(closedAtMs) ? closedAtMs : nowMs;
  const remainingMinutes = Number.isFinite(dueAtMs) && Number.isFinite(referenceMs)
    ? Math.round((dueAtMs - referenceMs) / 60000)
    : null;
  const overdue = Number.isFinite(remainingMinutes) && remainingMinutes < 0;
  const dueSoon = !terminal && Number.isFinite(remainingMinutes) && remainingMinutes >= 0 && remainingMinutes <= 60;
  const route = PUBLIC_HEALTH_SLA_ESCALATION_ROUTES[String(incident?.level || "P2")] ||
    PUBLIC_HEALTH_SLA_ESCALATION_ROUTES.P2;
  return {
    status: terminal
      ? overdue ? "closed-overdue" : "closed-within-sla"
      : overdue ? "overdue" : dueSoon ? "due-soon" : "within-sla",
    overdue,
    dueSoon,
    remainingMinutes,
    escalationRequired: !terminal && overdue && !incident?.escalation?.escalatedAt,
    escalationLevel: route.level,
    escalationRoute: route.route
  };
}

function validateExpectedRevision(current, payload) {
  const expectedRevision = Number(payload.expectedRevision);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
    coordinationError("expectedRevision is required", "PUBLIC_HEALTH_EXPECTED_REVISION_REQUIRED");
  }
  if (expectedRevision !== current.revision) {
    coordinationError("public health incident revision conflict", "PUBLIC_HEALTH_INCIDENT_REVISION_CONFLICT", 409);
  }
}

function advancePublicHealthIncident(currentState, incidentId, payload = {}, actor = {}, options = {}) {
  assertNoSensitiveFields(payload);
  const state = normalizePublicHealthCoordination(currentState);
  const index = state.incidents.findIndex((item) => item.id === incidentId);
  if (index < 0) {
    coordinationError("public health incident not found", "PUBLIC_HEALTH_INCIDENT_NOT_FOUND", 404);
  }
  const current = state.incidents[index];
  const transition = PUBLIC_HEALTH_INCIDENT_TRANSITIONS[current.status];
  if (!transition) {
    coordinationError("public health incident is already terminal", "PUBLIC_HEALTH_INCIDENT_TERMINAL", 409);
  }
  validateExpectedRevision(current, payload);
  const requestedAction = String(payload.action || transition.action).trim();
  if (requestedAction !== transition.action) {
    coordinationError(
      `action ${requestedAction} is invalid while status is ${current.status}`,
      "PUBLIC_HEALTH_INCIDENT_ACTION_INVALID",
      409
    );
  }
  const principal = actorIdentity(actor);
  if (transition.action === "verify-close" && principal.id === current.submittedForReviewBy) {
    coordinationError(
      "the submitter cannot independently verify and close the same incident",
      "PUBLIC_HEALTH_INDEPENDENT_REVIEW_REQUIRED",
      409
    );
  }
  const now = String(options.now || new Date().toISOString());
  const note = requiredText(payload.note, "note", 4);
  const revision = current.revision + 1;
  const incident = {
    ...current,
    revision,
    status: transition.nextStatus,
    owner: String(payload.owner || current.owner).trim(),
    dueAt: String(payload.dueAt || current.dueAt).trim(),
    lastUpdatedAt: now,
    latestAction: note,
    submittedForReviewBy: transition.action === "submit-review" ? principal.id : current.submittedForReviewBy,
    ...(transition.nextStatus === "已关闭"
      ? { closedAt: now, closedBy: principal.id, verifiedBy: principal.name }
      : {})
  };
  const action = {
    id: `PHA-${randomUUID()}`,
    incidentId: incident.id,
    action: transition.action,
    label: transition.label,
    actorId: principal.id,
    actor: principal.name,
    actorRole: principal.role,
    at: now,
    result: note,
    revision
  };
  state.incidents[index] = incident;
  state.incidentActions = [action, ...state.incidentActions].slice(0, 500);
  state.updatedAt = now;
  state.productionReady = false;
  return { state, incident, action };
}

function escalatePublicHealthIncident(currentState, incidentId, payload = {}, actor = {}, options = {}) {
  assertNoSensitiveFields(payload);
  const state = normalizePublicHealthCoordination(currentState);
  const index = state.incidents.findIndex((item) => item.id === incidentId);
  if (index < 0) {
    coordinationError("public health incident not found", "PUBLIC_HEALTH_INCIDENT_NOT_FOUND", 404);
  }
  const current = state.incidents[index];
  if (current.status === "已关闭") {
    coordinationError("closed public health incidents cannot be escalated", "PUBLIC_HEALTH_INCIDENT_TERMINAL", 409);
  }
  validateExpectedRevision(current, payload);
  if (String(payload.action || "") !== "escalate-overdue") {
    coordinationError("action must be escalate-overdue", "PUBLIC_HEALTH_ESCALATION_ACTION_INVALID", 409);
  }
  if (current.escalation?.escalatedAt) {
    coordinationError("public health incident is already escalated", "PUBLIC_HEALTH_INCIDENT_ALREADY_ESCALATED", 409);
  }
  const now = String(options.now || new Date().toISOString());
  const sla = evaluatePublicHealthIncidentSla(current, now);
  if (!sla.overdue) {
    coordinationError("public health incident is not overdue", "PUBLIC_HEALTH_INCIDENT_NOT_OVERDUE", 409);
  }
  const principal = actorIdentity(actor);
  const note = requiredText(payload.note, "note", 4);
  const revision = current.revision + 1;
  const escalation = {
    status: "已升级",
    level: sla.escalationLevel,
    route: sla.escalationRoute,
    escalatedAt: now,
    escalatedBy: principal.id,
    escalatedByName: principal.name,
    note
  };
  const incident = {
    ...current,
    revision,
    escalation,
    lastUpdatedAt: now,
    latestAction: note
  };
  const action = {
    id: `PHA-${randomUUID()}`,
    incidentId: incident.id,
    action: "escalate-overdue",
    label: "SLA超时升级",
    actorId: principal.id,
    actor: principal.name,
    actorRole: principal.role,
    at: now,
    result: note,
    revision
  };
  state.incidents[index] = incident;
  state.incidentActions = [action, ...state.incidentActions].slice(0, 500);
  state.updatedAt = now;
  state.productionReady = false;
  return { state, incident, action };
}

function groupCount(items, keySelector) {
  const counts = {};
  for (const item of items) {
    const key = String(keySelector(item) || "未指定");
    counts[key] = Number(counts[key] || 0) + 1;
  }
  return counts;
}

function resolveProfessionalAssociation(incident, context = {}) {
  const refs = normalizeProfessionalRefs(incident.laneId, incident.professionalRefs);
  const event = (context.events || []).find((item) => item.id === refs.eventId);
  const exchangeTask = (context.exchangeTasks || []).find((item) => item.id === refs.exchangeTaskId);
  const exchangeRun = (context.exchangeRuns || []).find((item) => item.id === refs.exchangeRunId);
  const evidencePacket = (context.evidencePackets || []).find((item) => item.id === refs.evidencePacketId);
  const evidenceBridgeLinks = (context.evidenceBridgeLinks || [])
    .filter((item) => item.packetId === refs.evidencePacketId);
  const endpointProbe = (context.endpointProbeEntries || [])
    .find((item) => item.laneId === (refs.probeLaneId || incident.laneId));
  const requiredItems = Array.isArray(evidencePacket?.requiredItems) ? evidencePacket.requiredItems : [];
  const verifiedItems = requiredItems.filter((item) =>
    /verified|accepted|signed|complete|已验证|已签收|已完成/i.test(String(item.status || ""))
  ).length;
  const referenceEntries = Object.entries(refs).filter(([, value]) => value);
  const resolved = [
    event && "eventId",
    exchangeTask && "exchangeTaskId",
    exchangeRun && "exchangeRunId",
    evidencePacket && "evidencePacketId",
    endpointProbe && "probeLaneId"
  ].filter(Boolean);
  const unresolved = referenceEntries.map(([key]) => key).filter((key) => !resolved.includes(key));
  return {
    references: refs,
    event: event ? {
      id: String(event.id || ""),
      domain: String(event.domain || ""),
      status: String(event.status || ""),
      level: String(event.level || event.priority || "")
    } : null,
    exchange: exchangeTask || exchangeRun ? {
      taskId: String(exchangeTask?.id || refs.exchangeTaskId || ""),
      taskName: String(exchangeTask?.name || ""),
      taskStatus: String(exchangeTask?.status || ""),
      runId: String(exchangeRun?.id || refs.exchangeRunId || ""),
      runStatus: String(exchangeRun?.status || ""),
      receiptStatus: String(exchangeRun?.receiptStatus || ""),
      compensationStatus: String(exchangeRun?.compensationStatus || "")
    } : null,
    endpointProbe: endpointProbe ? {
      laneId: String(endpointProbe.laneId || ""),
      connectivityVerified: endpointProbe.connectivityVerified === true,
      issuedAt: String(endpointProbe.issuedAt || ""),
      expiresAt: String(endpointProbe.expiresAt || ""),
      latencyMs: Number.isFinite(endpointProbe.latencyMs) ? Number(endpointProbe.latencyMs) : null,
      mutualTlsVerified: endpointProbe.mutualTlsVerified === true,
      blockerCode: String(endpointProbe.blockerCode || "")
    } : {
      laneId: String(refs.probeLaneId || incident.laneId || ""),
      connectivityVerified: false,
      blockerCode: "trusted-endpoint-probe-required"
    },
    evidence: evidencePacket ? {
      packetId: String(evidencePacket.id || ""),
      status: String(evidencePacket.status || ""),
      requiredItems: requiredItems.length,
      verifiedItems,
      bridgeLinks: evidenceBridgeLinks.length,
      verifiedBridgeLinks: evidenceBridgeLinks.filter((item) =>
        /verified|accepted|signed|complete|已验证|已签收|已完成/i.test(String(item.status || ""))
      ).length
    } : null,
    integrity: {
      linkedReferences: referenceEntries.length,
      resolvedReferences: resolved.length,
      unresolvedReferences: unresolved,
      status: referenceEntries.length === 0
        ? "unlinked"
        : unresolved.length === 0 ? "resolved" : "partial"
    }
  };
}

function normalizePublicHealthFilters(filters = {}) {
  return {
    hospitalCode: String(filters.hospitalCode || "").trim(),
    laneId: String(filters.laneId || "").trim(),
    level: String(filters.level || "").trim().toUpperCase(),
    status: String(filters.status || "").trim(),
    overdueOnly: ["1", "true", "yes"].includes(String(filters.overdueOnly || "").trim().toLowerCase())
  };
}

function filterPublicHealthIncidents(incidents, filters = {}, now = new Date().toISOString()) {
  const normalized = normalizePublicHealthFilters(filters);
  return (Array.isArray(incidents) ? incidents : []).filter((item) => {
    if (normalized.hospitalCode && item.hospitalCode !== normalized.hospitalCode) return false;
    if (normalized.laneId && item.laneId !== normalized.laneId) return false;
    if (normalized.level && item.level !== normalized.level) return false;
    if (normalized.status && item.status !== normalized.status) return false;
    if (normalized.overdueOnly && !evaluatePublicHealthIncidentSla(item, now).overdue) return false;
    return true;
  });
}

function buildPublicHealthIncidentStatistics(incidents, now = new Date().toISOString()) {
  const rows = Array.isArray(incidents) ? incidents : [];
  const open = rows.filter((item) => item.status !== "已关闭");
  const slaRows = rows.map((item) => ({ item, sla: evaluatePublicHealthIncidentSla(item, now) }));
  return {
    total: rows.length,
    open: open.length,
    closed: rows.length - open.length,
    overdue: slaRows.filter(({ item, sla }) => item.status !== "已关闭" && sla.overdue).length,
    dueSoon: slaRows.filter(({ item, sla }) => item.status !== "已关闭" && sla.dueSoon).length,
    escalated: rows.filter((item) => Boolean(item.escalation?.escalatedAt)).length,
    professionallyLinked: rows.filter((item) =>
      Object.keys(normalizeProfessionalRefs(item.laneId, item.professionalRefs)).length > 1
    ).length,
    byHospital: groupCount(rows, (item) => item.hospitalCode),
    byLane: groupCount(rows, (item) => item.laneId),
    byLevel: groupCount(rows, (item) => item.level),
    byStatus: groupCount(rows, (item) => item.status)
  };
}

function summarizePublicHealthCoordination(currentState, options = {}) {
  const state = normalizePublicHealthCoordination(currentState);
  const now = String(options.now || new Date().toISOString());
  const incidents = filterPublicHealthIncidents(state.incidents, options.filters, now);
  const openIncidents = incidents.filter((item) => item.status !== "已关闭");
  const statistics = buildPublicHealthIncidentStatistics(incidents, now);
  return {
    verifiedLanes: state.lanes.filter((item) => item.probe === "已验证").length,
    totalLanes: state.lanes.length,
    openIncidents: openIncidents.length,
    p0Incidents: openIncidents.filter((item) => item.level === "P0").length,
    pendingVerification: openIncidents.filter((item) => item.status === "待复核").length,
    closedIncidents: incidents.filter((item) => item.status === "已关闭").length,
    filteredIncidents: incidents.length,
    overdueIncidents: statistics.overdue,
    escalatedIncidents: statistics.escalated,
    professionalLinkedIncidents: statistics.professionallyLinked,
    continuityReady: state.continuousConnectivityReady,
    productionReady: false
  };
}

function buildPublicHealthCoordinationBoard(currentState, options = {}) {
  const state = normalizePublicHealthCoordination(currentState);
  const now = String(options.now || new Date().toISOString());
  const filters = normalizePublicHealthFilters(options.filters);
  const filteredIncidents = filterPublicHealthIncidents(state.incidents, filters, now)
    .map((item) => ({
      ...item,
      sla: evaluatePublicHealthIncidentSla(item, now),
      professionalAssociation: resolveProfessionalAssociation(item, options.professionalContext)
    }));
  const incidentIds = new Set(filteredIncidents.map((item) => item.id));
  const statistics = buildPublicHealthIncidentStatistics(filteredIncidents, now);
  return {
    ok: true,
    generatedAt: now,
    filters: {
      ...filters,
      availableHospitals: Array.from(new Set(state.incidents.map((item) => item.hospitalCode))).sort(),
      availableStatuses: Array.from(new Set(state.incidents.map((item) => item.status))),
      availableLevels: ["P0", "P1", "P2"]
    },
    summary: summarizePublicHealthCoordination(state, { now, filters }),
    portfolioSummary: summarizePublicHealthCoordination(state, { now }),
    statistics,
    coordination: {
      ...state,
      incidents: filteredIncidents,
      incidentActions: state.incidentActions.filter((item) => incidentIds.has(item.incidentId))
    },
    runtimeRoutes: {
      system: "/api/public-health/system",
      coordination: "/api/digital-hospital/public-health/coordination",
      incidents: "/api/digital-hospital/public-health/incidents",
      incidentActions: "/api/digital-hospital/public-health/incidents/:id/actions",
      incidentExport: "/api/digital-hospital/public-health/incidents/export"
    },
    productionBoundary: {
      productionReady: false,
      releaseGate: "site-evidence-and-approval-required",
      blockers: state.blockers
    }
  };
}

function csvCell(value) {
  const text = String(value ?? "");
  const protectedValue = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${protectedValue.replace(/"/g, "\"\"")}"`;
}

function renderPublicHealthIncidentCsv(board) {
  const headers = [
    "事件编号", "事件标题", "业务通道", "医院代码", "级别", "状态", "SLA状态", "是否超时",
    "升级级别", "责任组", "发现时间", "处置时限", "专业事件编号", "交换运行编号", "回执状态",
    "可信探测", "证据包", "证据完成度", "最新处置"
  ];
  const rows = (board?.coordination?.incidents || []).map((item) => {
    const association = item.professionalAssociation || {};
    return [
      item.id,
      item.title,
      item.laneId,
      item.hospitalCode,
      item.level,
      item.status,
      item.sla?.status,
      item.sla?.overdue ? "是" : "否",
      item.escalation?.level || "",
      item.owner,
      item.discoveredAt,
      item.dueAt,
      association.event?.id || "",
      association.exchange?.runId || "",
      association.exchange?.receiptStatus || "",
      association.endpointProbe?.connectivityVerified ? "已验证" : "待可信探测",
      association.evidence?.packetId || "",
      association.evidence
        ? `${association.evidence.verifiedItems}/${association.evidence.requiredItems}`
        : "",
      item.latestAction
    ].map(csvCell).join(",");
  });
  return `\uFEFF${[headers.map(csvCell).join(","), ...rows].join("\r\n")}`;
}

module.exports = {
  PUBLIC_HEALTH_INCIDENT_TRANSITIONS,
  PUBLIC_HEALTH_LANE_PROFESSIONAL_REFS,
  PUBLIC_HEALTH_SLA_ESCALATION_ROUTES,
  PublicHealthCoordinationError,
  advancePublicHealthIncident,
  assertNoSensitiveFields,
  buildPublicHealthIncidentStatistics,
  buildPublicHealthCoordinationBoard,
  createPublicHealthIncident,
  escalatePublicHealthIncident,
  evaluatePublicHealthIncidentSla,
  filterPublicHealthIncidents,
  normalizePublicHealthCoordination,
  normalizePublicHealthFilters,
  renderPublicHealthIncidentCsv,
  resolveProfessionalAssociation,
  seedPublicHealthCoordination,
  summarizePublicHealthCoordination
};
