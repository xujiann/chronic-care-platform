const COORDINATION_LANES = [
  {
    id: "infectious-reporting",
    name: "传染病发现与直报",
    owner: "疾控中心传染病监测部门",
    ownerRole: "cdc",
    collaborators: ["医院发热门诊", "院感部门", "检验科", "医院信息科"],
    standardDomainIds: ["ph-infectious"],
    sourceCollections: ["publicHealthEvents", "phase2DiseaseReportQueue", "phase2DiseaseReportReceipts"],
    requiredEvidence: ["direct-report-receipt", "cdc-review", "followup-conclusion"],
    externalDependencies: ["疾控直报正式地址与字段版本", "VPN/专线", "成功及拒收回执"]
  },
  {
    id: "immunization",
    name: "免疫规划",
    owner: "疾控免疫规划部门",
    ownerRole: "cdc",
    collaborators: ["预防接种门诊", "基层医疗卫生机构", "妇幼保健机构", "疫苗冷链团队"],
    standardDomainIds: ["ph-immunization"],
    sourceCollections: ["birthCertificates", "publicHealthEvents"],
    requiredEvidence: ["registry-receipt", "cold-chain-receipt", "aefi-handoff"],
    externalDependencies: ["儿童接种档案", "预约回调", "库存和冷链异常回执", "AEFI 监测"]
  },
  {
    id: "maternal-child",
    name: "妇幼健康",
    owner: "妇幼保健机构/妇幼健康处",
    ownerRole: "maternal-child",
    collaborators: ["医疗机构", "医政部门", "电子证照管理部门", "公安出生登记"],
    standardDomainIds: ["ph-maternal-child"],
    sourceCollections: ["birthCertificates", "birthStatistics", "personalRecords"],
    requiredEvidence: ["maternal-enrollment-receipt", "screening-handoff", "public-security-receipt"],
    externalDependencies: ["妇幼入册", "新生儿筛查与访视回传", "公安共享回执"]
  },
  {
    id: "senior-health",
    name: "老年健康",
    owner: "基层医疗卫生机构",
    ownerRole: "primary-care",
    collaborators: ["民政部门", "医养结合机构", "家庭医生团队"],
    standardDomainIds: ["ph-senior"],
    sourceCollections: ["seniorServices", "personalRecords", "followups"],
    requiredEvidence: ["outreach-receipt", "health-assessment", "family-doctor-handoff"],
    externalDependencies: ["老年健康评估", "民政协同授权", "医养结合服务回执"]
  },
  {
    id: "chronic-management",
    name: "慢性病防控",
    owner: "基层卫生部门/疾控慢病部门",
    ownerRole: "primary-care",
    collaborators: ["家庭医生团队", "医院专科", "药房", "居民服务团队"],
    standardDomainIds: ["ph-chronic"],
    sourceCollections: ["chronicScreeningTasks", "chronicManagementPlans", "followups"],
    requiredEvidence: ["risk-assessment", "followup-result", "medication-adherence"],
    externalDependencies: ["正式慢病平台", "医院专科回传", "药房取药回调"]
  },
  {
    id: "public-health-followup",
    name: "基本公卫随访",
    owner: "基层公卫专班",
    ownerRole: "primary-care",
    collaborators: ["家庭医生团队", "疾控慢病部门", "居民健康档案管理部门"],
    standardDomainIds: ["ph-chronic", "ph-archive"],
    sourceCollections: ["followups", "taskMessages", "personalRecords"],
    requiredEvidence: ["dispatch-receipt", "service-result", "resident-feedback"],
    externalDependencies: ["基层公卫绩效口径", "随访回写接口", "居民提醒回执"]
  },
  {
    id: "health-education",
    name: "健康教育",
    owner: "疾控健康教育部门/基层机构",
    ownerRole: "cdc",
    collaborators: ["慢病团队", "妇幼团队", "免疫规划团队", "居民服务团队"],
    standardDomainIds: ["ph-health-education"],
    sourceCollections: ["chronicEducationPushes", "publicHealthEvents"],
    requiredEvidence: ["delivery-receipt", "audience-coverage", "effect-evaluation"],
    externalDependencies: ["健康教育平台", "短信/居民端回执", "活动效果评价口径"]
  },
  {
    id: "family-doctor",
    name: "家庭医生协同",
    owner: "基层卫生部门/家庭医生团队",
    ownerRole: "primary-care",
    collaborators: ["基层公卫专班", "疾控慢病部门", "居民服务团队"],
    standardDomainIds: ["ph-chronic", "ph-archive"],
    sourceCollections: ["phase2FamilyDoctorApplications", "phase2FamilyDoctorContracts", "phase2FamilyDoctorFulfillments", "followups"],
    requiredEvidence: ["application-review", "contract-or-renewal", "fulfillment-receipt"],
    externalDependencies: ["正式签约服务", "履约回写", "基本公卫绩效联动"]
  }
];

const COORDINATION_ACTIONS = {
  "assign-coordination": { from: ["detected", "reopened"], to: "assigned" },
  "start-coordination": { from: ["assigned"], to: "in-progress" },
  "record-coordination-receipt": { from: ["in-progress"], to: null },
  "open-coordination-exception": { from: ["in-progress"], to: "exception-open" },
  "retry-coordination": { from: ["exception-open"], to: "in-progress" },
  "close-coordination": { from: ["receipt-confirmed"], to: "closed" },
  "reopen-coordination": { from: ["closed"], to: "reopened" }
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function clean(value) {
  return String(value ?? "").trim();
}

function rows(data, key) {
  const value = data?.[key];
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return [value];
  return [];
}

function isOpen(value) {
  return !/closed|completed|accepted|verified|resolved|已完成|已关闭|通过|已签约/i.test(clean(value));
}

function actorRole(user = {}) {
  const role = clean(user.role || user.roleName).toLowerCase();
  if (["commission", "health-admin", "public-health-admin"].includes(role)) return "commission";
  if (["cdc", "disease-control"].includes(role)) return "cdc";
  if (["primary-care", "family-doctor"].includes(role)) return "primary-care";
  if (["maternal-child", "mch"].includes(role)) return "maternal-child";
  if (["institution", "hospital"].includes(role)) return "institution";
  if (["system", "adapter", "integration"].includes(role)) return "system";
  return role || "anonymous";
}

function actorName(user = {}) {
  return clean(user.name || user.username || "coordination operator");
}

function sourceMetrics(data, laneId) {
  if (laneId === "infectious-reporting") {
    const reports = rows(data, "phase2DiseaseReportQueue").filter((item) => clean(item.diseaseCategory).toLowerCase() === "infectious");
    return { total: reports.length, open: reports.filter((item) => isOpen(`${item.pushStatus} ${item.exceptionStatus}`)).length };
  }
  if (laneId === "immunization") {
    const events = rows(data, "publicHealthEvents").filter((item) => /免疫|冷链|接种/.test(`${item.domain} ${item.signal}`));
    return { total: rows(data, "birthCertificates").length + events.length, open: events.filter((item) => isOpen(item.status)).length };
  }
  if (laneId === "maternal-child") {
    const certificates = rows(data, "birthCertificates");
    return { total: certificates.length, open: certificates.filter((item) => /待|pending/i.test(`${item.maternalChildSync} ${item.publicSecuritySync} ${item.qualityCheck}`)).length };
  }
  if (laneId === "senior-health") {
    const services = rows(data, "seniorServices");
    return { total: services.length, open: services.filter((item) => isOpen(item.status)).length };
  }
  if (laneId === "chronic-management") {
    const tasks = rows(data, "chronicScreeningTasks");
    return { total: tasks.length + rows(data, "chronicManagementPlans").length, open: tasks.filter((item) => isOpen(item.status)).length };
  }
  if (laneId === "public-health-followup") {
    const followups = rows(data, "followups");
    return { total: followups.length, open: followups.filter((item) => isOpen(item.status)).length };
  }
  if (laneId === "health-education") {
    const pushes = rows(data, "chronicEducationPushes");
    return { total: pushes.length, open: pushes.filter((item) => isOpen(item.status)).length };
  }
  const applications = rows(data, "phase2FamilyDoctorApplications");
  return { total: applications.length + rows(data, "phase2FamilyDoctorContracts").length, open: applications.filter((item) => /pending|submitted|review/i.test(`${item.reviewStatus} ${item.status}`)).length };
}

function firstMatching(data, laneId) {
  if (laneId === "infectious-reporting") {
    const report = rows(data, "phase2DiseaseReportQueue").find((item) => clean(item.diseaseCategory).toLowerCase() === "infectious") || {};
    const event = rows(data, "publicHealthEvents").find((item) => /传染病/.test(item.domain || "")) || {};
    return { residentId: report.residentId || "", sourceRefs: [event.id, report.id].filter(Boolean), targetRefs: [report.reportCardNo].filter(Boolean), sourceStatus: `${event.status || ""}/${report.pushStatus || ""}`, businessKey: event.id || report.id || "infectious-reporting" };
  }
  if (laneId === "immunization") {
    const event = rows(data, "publicHealthEvents").find((item) => /免疫|冷链|接种/.test(`${item.domain} ${item.signal}`)) || {};
    const certificate = rows(data, "birthCertificates")[0] || {};
    return { residentId: certificate.maternalResidentId || "", sourceRefs: [event.id, certificate.id].filter(Boolean), targetRefs: ["immunization-schedule-2026"], sourceStatus: event.status || "schedule-ready", businessKey: event.id || certificate.id || "immunization" };
  }
  if (laneId === "maternal-child") {
    const certificate = rows(data, "birthCertificates").find((item) => /待|pending/i.test(`${item.maternalChildSync} ${item.publicSecuritySync} ${item.qualityCheck}`)) || rows(data, "birthCertificates")[0] || {};
    return { residentId: certificate.maternalResidentId || "", sourceRefs: [certificate.id].filter(Boolean), targetRefs: [certificate.maternalChildSync, certificate.publicSecuritySync].filter(Boolean), sourceStatus: `${certificate.maternalChildSync || ""}/${certificate.publicSecuritySync || ""}`, businessKey: certificate.id || "maternal-child" };
  }
  if (laneId === "senior-health") {
    const service = rows(data, "seniorServices").find((item) => isOpen(item.status)) || rows(data, "seniorServices")[0] || {};
    return { residentId: service.residentId || "", sourceRefs: [service.id].filter(Boolean), targetRefs: [service.service, service.channel].filter(Boolean), sourceStatus: service.status || "", businessKey: service.id || "senior-health" };
  }
  if (laneId === "chronic-management") {
    const task = rows(data, "chronicScreeningTasks").find((item) => isOpen(item.status)) || rows(data, "chronicScreeningTasks")[0] || {};
    const plan = rows(data, "chronicManagementPlans").find((item) => item.residentId === task.residentId) || {};
    return { residentId: task.residentId || "", sourceRefs: [task.id, plan.id].filter(Boolean), targetRefs: [task.assignee, plan.owner].filter(Boolean), sourceStatus: `${task.status || ""}/${plan.status || ""}`, businessKey: task.id || "chronic-management" };
  }
  if (laneId === "public-health-followup") {
    const followup = rows(data, "followups").find((item) => isOpen(item.status)) || rows(data, "followups")[0] || {};
    const message = rows(data, "taskMessages").find((item) => item.sourceId === followup.id || item.residentId === followup.residentId) || {};
    return { residentId: followup.residentId || "", sourceRefs: [followup.id, message.id].filter(Boolean), targetRefs: [followup.assignee].filter(Boolean), sourceStatus: followup.status || "", businessKey: followup.id || "public-health-followup" };
  }
  if (laneId === "health-education") {
    const push = rows(data, "chronicEducationPushes").find((item) => isOpen(item.status)) || rows(data, "chronicEducationPushes")[0] || {};
    return { residentId: push.residentId || "", sourceRefs: [push.id].filter(Boolean), targetRefs: [push.channel, push.targetGroup].filter(Boolean), sourceStatus: `${push.status || ""}/${push.feedback || ""}`, businessKey: push.id || "health-education" };
  }
  const application = rows(data, "phase2FamilyDoctorApplications").find((item) => /pending|submitted|review/i.test(`${item.reviewStatus} ${item.status}`)) || rows(data, "phase2FamilyDoctorApplications")[0] || {};
  const contract = rows(data, "phase2FamilyDoctorContracts").find((item) => item.residentId === application.residentId) || {};
  return { residentId: application.residentId || "", sourceRefs: [application.id, contract.id].filter(Boolean), targetRefs: [application.teamId, application.packageId].filter(Boolean), sourceStatus: `${application.reviewStatus || ""}/${contract.status || ""}`, businessKey: application.id || "family-doctor" };
}

function buildPublicHealthCoordinationCenter({ data = {}, eventReporting = null, standardReview = null } = {}) {
  const lanes = COORDINATION_LANES.map((definition) => {
    const metric = sourceMetrics(data, definition.id);
    const missingCollections = definition.sourceCollections.filter((key) => !rows(data, key).length);
    return { ...clone(definition), metrics: metric, missingCollections, structurallyReady: !missingCollections.length };
  });
  const handoffs = lanes.map((lane) => {
    const source = firstMatching(data, lane.id);
    return {
      id: `phc-${lane.id}-001`,
      laneId: lane.id,
      name: `${lane.name}跨域协同任务`,
      version: 1,
      state: "detected",
      owner: lane.owner,
      ownerRole: lane.ownerRole,
      collaborators: clone(lane.collaborators),
      standardDomainIds: clone(lane.standardDomainIds),
      externalDependencies: clone(lane.externalDependencies),
      requiredEvidence: clone(lane.requiredEvidence),
      residentId: source.residentId,
      businessKey: source.businessKey,
      sourceRefs: source.sourceRefs,
      targetRefs: source.targetRefs,
      sourceStatus: source.sourceStatus,
      assignedTo: "",
      dueAt: "",
      receipt: null,
      exception: null,
      closure: null,
      timeline: [],
      businessClosureComplete: false,
      productionReady: false
    };
  });
  const structurallyReady = lanes.filter((item) => item.structurallyReady).length;
  const eventReportingLinked = Boolean(eventReporting?.publicHealthEventId && eventReporting?.reportId);
  const standardReviewTracks = Number(standardReview?.summary?.tracks || 0);
  return {
    ok: lanes.length === 8 && handoffs.length === 8 && structurallyReady === 8 && eventReportingLinked && standardReviewTracks === 8 && handoffs.every((item) => item.businessKey && item.sourceRefs.length && item.standardDomainIds.length),
    functionalState: "eight-lane-coordination-runnable",
    formalGoLiveState: "blocked-until-external-receipts-and-site-evidence-verified",
    summary: {
      lanes: lanes.length,
      structurallyReady,
      handoffs: handoffs.length,
      openHandoffs: handoffs.filter((item) => item.state !== "closed").length,
      closedHandoffs: 0,
      externalDependencies: new Set(lanes.flatMap((item) => item.externalDependencies)).size,
      eventReportingLinked,
      standardReviewTracks
    },
    lanes,
    handoffs,
    eventReporting: eventReporting ? clone(eventReporting) : null,
    standardReview: standardReview ? clone(standardReview) : null,
    productionReady: false
  };
}

function actionDefinition(action) {
  const definition = COORDINATION_ACTIONS[action];
  if (!definition) throw new Error(`unsupported public health coordination action: ${action}`);
  return definition;
}

function authorize(handoff, action, user) {
  const role = actorRole(user);
  const allowed = ["record-coordination-receipt", "open-coordination-exception"].includes(action)
    ? [handoff.ownerRole, "system", "commission"]
    : [handoff.ownerRole, "commission"];
  if (!allowed.includes(role)) throw new Error(`role ${role} is not allowed to ${action} for lane ${handoff.laneId}`);
  return role;
}

function applyPublicHealthCoordinationAction(current, payload = {}, user = {}) {
  const handoff = clone(current);
  const action = clean(payload.action);
  const definition = actionDefinition(action);
  const role = authorize(handoff, action, user);
  const idempotencyKey = clean(payload.idempotencyKey);
  if (!idempotencyKey) throw new Error(`idempotencyKey is required for ${action}`);
  const duplicate = (handoff.timeline || []).find((item) => item.action === action && item.idempotencyKey === idempotencyKey);
  if (duplicate) return { handoff, history: duplicate, idempotent: true };
  if (!definition.from.includes(handoff.state)) throw new Error(`action ${action} is not allowed from state ${handoff.state}`);
  if (payload.expectedVersion !== undefined && Number(payload.expectedVersion) !== Number(handoff.version)) {
    throw new Error(`version conflict: expected ${payload.expectedVersion}, current ${handoff.version}`);
  }
  let nextState = definition.to || handoff.state;

  if (action === "assign-coordination") {
    if (!clean(payload.assignedTo) || !/^\d{4}-\d{2}-\d{2}/.test(clean(payload.dueAt)) || !clean(payload.note)) {
      throw new Error("assignedTo, dueAt and note are required to assign coordination");
    }
    handoff.assignedTo = clean(payload.assignedTo);
    handoff.dueAt = clean(payload.dueAt);
  }
  if (action === "start-coordination" && !clean(payload.note)) throw new Error("note is required to start coordination");
  if (action === "record-coordination-receipt") {
    const receiptStatus = clean(payload.receiptStatus).toLowerCase();
    const evidenceRefs = Array.isArray(payload.evidenceRefs) ? payload.evidenceRefs.map(clean).filter(Boolean) : [];
    if (!["accepted", "rejected"].includes(receiptStatus) || !clean(payload.receiptCode) || !evidenceRefs.length) {
      throw new Error("receiptStatus, receiptCode and evidenceRefs are required for coordination receipt");
    }
    handoff.receipt = { status: receiptStatus, code: clean(payload.receiptCode), receivedAt: clean(payload.at || new Date().toISOString()), evidenceRefs };
    if (receiptStatus === "accepted") {
      nextState = "receipt-confirmed";
      handoff.exception = handoff.exception ? { ...handoff.exception, status: "closed" } : null;
    } else {
      if (!clean(payload.reason) || !clean(payload.exceptionOwner) || !/^\d{4}-\d{2}-\d{2}/.test(clean(payload.dueAt))) {
        throw new Error("reason, exceptionOwner and dueAt are required for rejected coordination receipt");
      }
      nextState = "exception-open";
      handoff.exception = { status: "open", reason: clean(payload.reason), owner: clean(payload.exceptionOwner), dueAt: clean(payload.dueAt) };
    }
  }
  if (action === "open-coordination-exception") {
    const evidenceRefs = Array.isArray(payload.evidenceRefs) ? payload.evidenceRefs.map(clean).filter(Boolean) : [];
    if (!clean(payload.reason) || !clean(payload.exceptionOwner) || !/^\d{4}-\d{2}-\d{2}/.test(clean(payload.dueAt)) || !evidenceRefs.length) {
      throw new Error("reason, exceptionOwner, dueAt and evidenceRefs are required to open coordination exception");
    }
    handoff.exception = {
      status: "open",
      reason: clean(payload.reason),
      owner: clean(payload.exceptionOwner),
      dueAt: clean(payload.dueAt),
      evidenceRefs
    };
  }
  if (action === "retry-coordination") {
    if (!clean(payload.note)) throw new Error("note is required to retry coordination");
    handoff.exception = { ...handoff.exception, status: "retry-submitted" };
  }
  if (action === "close-coordination") {
    const evidenceRefs = Array.isArray(payload.evidenceRefs) ? payload.evidenceRefs.map(clean).filter(Boolean) : [];
    if (!clean(payload.conclusion)) throw new Error("conclusion is required to close coordination");
    if (JSON.stringify([...new Set(evidenceRefs)].sort()) !== JSON.stringify([...new Set(handoff.requiredEvidence)].sort())) {
      throw new Error("closure evidenceRefs must exactly match requiredEvidence");
    }
    handoff.closure = { conclusion: clean(payload.conclusion), evidenceRefs, closedAt: clean(payload.at || new Date().toISOString()), closedBy: actorName(user) };
    handoff.businessClosureComplete = true;
  }
  if (action === "reopen-coordination") {
    if (!clean(payload.note)) throw new Error("note is required to reopen coordination");
    handoff.businessClosureComplete = false;
    handoff.closure = null;
  }

  const sequence = (handoff.timeline || []).length + 1;
  const history = {
    id: `${handoff.id}-history-${sequence}`,
    sequence,
    action,
    from: handoff.state,
    to: nextState,
    actor: actorName(user),
    role,
    at: clean(payload.at || new Date().toISOString()),
    idempotencyKey,
    note: clean(payload.note || payload.conclusion || payload.reason)
  };
  handoff.state = nextState;
  handoff.version = Number(handoff.version || 0) + 1;
  handoff.timeline = [...(handoff.timeline || []), history].slice(-30);
  handoff.lastAction = history;
  handoff.productionReady = false;
  return { handoff, history, idempotent: false };
}

function runPublicHealthCoordinationAcceptanceScenario(center) {
  const completed = center.handoffs.map((initial, index) => {
    const owner = { name: `${initial.owner}责任人`, role: initial.ownerRole };
    const adapter = { name: `${initial.name}回执适配器`, role: "system" };
    let handoff = clone(initial);
    const apply = (payload, user) => { handoff = applyPublicHealthCoordinationAction(handoff, payload, user).handoff; };
    apply({ action: "assign-coordination", idempotencyKey: `${handoff.id}:assign`, assignedTo: handoff.owner, dueAt: `2026-07-${String(23 + (index % 5)).padStart(2, "0")}`, note: "确认跨域任务责任人和完成时限。" }, owner);
    apply({ action: "start-coordination", idempotencyKey: `${handoff.id}:start`, note: "责任部门接单并开始核对源记录、目标系统和接口字段。" }, owner);
    apply({ action: "record-coordination-receipt", idempotencyKey: `${handoff.id}:receipt`, receiptStatus: "accepted", receiptCode: `PHC-${String(index + 1).padStart(3, "0")}`, evidenceRefs: [`${handoff.laneId}-receipt`] }, adapter);
    apply({ action: "close-coordination", idempotencyKey: `${handoff.id}:close`, conclusion: `${handoff.name}演示闭环完成，正式现场证据仍需独立核验。`, evidenceRefs: handoff.requiredEvidence }, owner);
    return handoff;
  });
  return {
    ...clone(center),
    handoffs: completed,
    functionalState: "eight-lane-business-closure-runnable",
    summary: {
      ...clone(center.summary),
      openHandoffs: 0,
      closedHandoffs: completed.filter((item) => item.businessClosureComplete).length,
      auditEntries: completed.reduce((sum, item) => sum + item.timeline.length, 0)
    },
    productionReady: false
  };
}

module.exports = {
  COORDINATION_ACTIONS,
  COORDINATION_LANES,
  applyPublicHealthCoordinationAction,
  buildPublicHealthCoordinationCenter,
  runPublicHealthCoordinationAcceptanceScenario
};
