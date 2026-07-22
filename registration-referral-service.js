"use strict";

const { randomUUID } = require("node:crypto");

const {
  classifyMessageReceipt,
  normalizeChronicFollowupCase,
  normalizeFamilyDoctorCase,
  normalizePrimaryCareCase,
  normalizeReferralCase,
  normalizeRegistrationCase,
  validateClosureReferences,
  validateRegistrationCallbackTransition
} = require("./registration-referral-domain");
const {
  applyRegistrationIntegrationCallback
} = require("./scripts/registration-integration-readiness");
const {
  applyRegistrationJourneyAction
} = require("./scripts/registration-journey-readiness");

const DEFAULT_NOTIFICATION_POLICY = Object.freeze({
  channels: Object.freeze([
    Object.freeze({ channel: "in_app", maxAttempts: 1 }),
    Object.freeze({ channel: "sms", maxAttempts: 3 }),
    Object.freeze({ channel: "phone", maxAttempts: 2 }),
    Object.freeze({ channel: "manual-task", maxAttempts: 1 })
  ])
});

const CLOSURE_COMMAND_CONTRACTS = Object.freeze([
  { action: "advance-registration", roles: ["citizen", "institution", "insurance", "commission"], requiredFields: ["caseId", "payload.action", "payload.note"], suggestedEndpoint: "POST /api/registration-referral/commands/advance-registration" },
  { action: "apply-registration-callback", roles: ["institution", "insurance", "commission"], requiredFields: ["caseId", "payload.callback.eventType", "payload.callback.orderNo"], suggestedEndpoint: "POST /api/registration-referral/commands/apply-registration-callback" },
  { action: "record-primary-care-assessment", roles: ["institution", "commission"], requiredFields: ["residentId", "payload.institutionCode", "payload.doctorId", "payload.diagnosis", "payload.disposition"], suggestedEndpoint: "POST /api/registration-referral/commands/record-primary-care-assessment" },
  { action: "create-referral-from-primary-care", roles: ["institution", "commission"], requiredFields: ["caseId", "payload.targetInstitution", "payload.targetInstitutionCode", "payload.residentAuthorizationId"], suggestedEndpoint: "POST /api/registration-referral/commands/create-referral-from-primary-care" },
  { action: "accept-referral-continuity", roles: ["institution", "commission"], requiredFields: ["caseId", "payload.note", "payload.nextFollowupAt"], suggestedEndpoint: "POST /api/registration-referral/commands/accept-referral-continuity" },
  { action: "complete-chronic-followup", roles: ["institution", "commission"], requiredFields: ["caseId", "payload.result", "payload.note"], suggestedEndpoint: "POST /api/registration-referral/commands/complete-chronic-followup" },
  { action: "acknowledge-chronic-followup", roles: ["citizen", "commission"], requiredFields: ["caseId", "payload.note"], suggestedEndpoint: "POST /api/registration-referral/commands/acknowledge-chronic-followup" },
  { action: "acknowledge-family-doctor-fulfillment", roles: ["citizen", "commission"], requiredFields: ["caseId", "payload.note"], suggestedEndpoint: "POST /api/registration-referral/commands/acknowledge-family-doctor-fulfillment" },
  { action: "record-notification-receipt", roles: ["citizen", "institution", "county", "insurance", "commission"], requiredFields: ["payload.messageId", "payload.status"], suggestedEndpoint: "POST /api/registration-referral/commands/record-notification-receipt" },
  { action: "run-notification-fallback", roles: ["institution", "county", "commission"], requiredFields: ["payload.messageId", "payload.note"], suggestedEndpoint: "POST /api/registration-referral/commands/run-notification-fallback" },
  { action: "escalate-case", roles: ["institution", "county", "commission"], requiredFields: ["caseType", "caseId", "payload.note"], suggestedEndpoint: "POST /api/registration-referral/commands/escalate-case" }
]);

const RECEIPT_STATUSES = new Set(["acknowledged", "bounced", "confirmed", "delivered", "failed", "handled", "read", "received"]);

function rows(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value || "").trim();
}

function clone(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function requireText(value, field) {
  const result = text(value);
  if (!result) throw new Error(`${field} is required`);
  return result;
}

function commandContract(action) {
  return CLOSURE_COMMAND_CONTRACTS.find((item) => item.action === action);
}

function actorName(actor = {}) {
  return text(actor.name || actor.username || actor.role || "unknown");
}

function actorResidentIds(actor = {}) {
  return new Set([actor.residentId, ...rows(actor.residentIds)].map(text).filter(Boolean));
}

function requireCommandRole(action, actor = {}) {
  const contract = commandContract(action);
  if (!contract) throw new Error(`unsupported closure command ${action}`);
  if (!contract.roles.includes(actor.role)) throw new Error(`role ${actor.role || "unknown"} cannot run ${action}`);
  return contract;
}

function requireInstitutionScope(actor = {}, institutionCode = "") {
  if (actor.role === "commission") return;
  if (actor.role !== "institution") throw new Error("institution or commission role is required");
  if (institutionCode && actor.orgCode && actor.orgCode !== institutionCode) throw new Error("institution scope denied");
}

function requireResidentScope(actor = {}, residentId = "") {
  if (actor.role === "commission") return;
  if (actor.role !== "citizen" || !actorResidentIds(actor).has(residentId)) throw new Error("resident scope denied");
}

function appendById(items, item, limit = 300) {
  const existing = rows(items).filter((row) => row.id !== item.id);
  return [item, ...existing].slice(0, limit);
}

function appendMessage(data, message) {
  const notificationKey = text(message.notificationKey);
  const existing = notificationKey ? rows(data.taskMessages).find((item) => item.notificationKey === notificationKey) : null;
  if (existing) return existing;
  data.taskMessages = appendById(data.taskMessages, message, 300);
  return message;
}

function makeMessage(command, actor, fields = {}) {
  const now = command.at;
  return {
    id: fields.id || `msg-${command.commandId}-${fields.suffix || "notice"}`,
    taskId: fields.taskId || `${fields.collection || command.caseType || "registrationReferral"}:${fields.sourceId || command.caseId || command.commandId}`,
    collection: fields.collection || command.caseType || "registrationReferralClosure",
    sourceId: fields.sourceId || command.caseId || command.commandId,
    residentId: fields.residentId || command.residentId || "",
    targetRole: fields.targetRole || "citizen",
    targetOrgCode: fields.targetOrgCode || "",
    channel: fields.channel || "in_app",
    deliveryChannels: fields.deliveryChannels || [fields.channel || "in_app"],
    title: fields.title || "Care pathway update",
    body: fields.body || fields.note || "Care pathway status updated.",
    status: fields.status || "sent",
    receipts: rows(fields.receipts),
    notificationKey: fields.notificationKey || `registration-referral:${command.action}:${fields.sourceId || command.caseId || command.commandId}:${fields.targetRole || "citizen"}`,
    createdAt: now,
    createdBy: text(actor.username || actor.role),
    createdByName: actorName(actor),
    productionEvidence: false
  };
}

function findResident(data, residentId) {
  return rows(data.residents).find((item) => item.id === residentId);
}

function findAuthorization(data, authorizationId, residentId) {
  return rows(data.personalRecords).find((item) => item.id === authorizationId && item.category === "authorizations" && item.residentId === residentId && item.status !== "revoked" && item.meta?.status !== "revoked");
}

function recordPrimaryCareAssessment(data, command, actor) {
  const payload = command.payload;
  const residentId = requireText(command.residentId || payload.residentId, "residentId");
  const institutionCode = requireText(payload.institutionCode, "payload.institutionCode");
  requireInstitutionScope(actor, institutionCode);
  const resident = findResident(data, residentId);
  if (!resident) throw new Error("resident not found");
  const disposition = requireText(payload.disposition, "payload.disposition");
  if (!["manage-locally", "refer-up", "teleconsultation"].includes(disposition)) throw new Error("unsupported primary care disposition");
  const assessment = {
    id: text(payload.id || `pca-${command.commandId}`),
    residentId,
    personIndex: text(resident.personIndex),
    institutionCode,
    institutionName: text(payload.institutionName),
    doctorId: requireText(payload.doctorId, "payload.doctorId"),
    doctorName: text(payload.doctorName || actorName(actor)),
    diagnosis: requireText(payload.diagnosis, "payload.diagnosis"),
    assessment: requireText(payload.assessment || payload.note, "payload.assessment"),
    disposition,
    urgency: text(payload.urgency || "routine"),
    status: "completed",
    assessedAt: command.at,
    nextFollowupAt: text(payload.nextFollowupAt),
    nextAction: disposition === "manage-locally" ? "create primary-care follow-up" : "create referral from primary-care assessment",
    productionEvidence: false,
    auditTrail: [{ at: command.at, action: "primary-care-assessed", by: actorName(actor), role: actor.role, note: text(payload.note || payload.assessment), productionEvidence: false }]
  };
  data.primaryCareAssessments = appendById(data.primaryCareAssessments, assessment);
  let followup = null;
  if (disposition === "manage-locally") {
    followup = {
      id: `followup-${assessment.id}`,
      residentId,
      personIndex: assessment.personIndex,
      institutionCode,
      diseaseType: assessment.diagnosis,
      plannedAt: requireText(payload.nextFollowupAt, "payload.nextFollowupAt"),
      assignee: assessment.doctorName,
      status: "待随访",
      result: "未记录",
      advice: text(payload.advice || "按基层首诊评估继续随访"),
      primaryCareAssessmentId: assessment.id,
      productionEvidence: false
    };
    data.followups = appendById(data.followups, followup);
  }
  return { assessment, followup };
}

function createReferralFromPrimaryCare(data, command, actor) {
  const assessment = rows(data.primaryCareAssessments).find((item) => item.id === command.caseId);
  if (!assessment) throw new Error("primary care assessment not found");
  requireInstitutionScope(actor, assessment.institutionCode);
  if (!["refer-up", "teleconsultation"].includes(assessment.disposition)) throw new Error("primary care assessment does not require referral");
  const payload = command.payload;
  const authorizationId = requireText(payload.residentAuthorizationId, "payload.residentAuthorizationId");
  const authorization = findAuthorization(data, authorizationId, assessment.residentId);
  if (!authorization) throw new Error("active resident referral authorization not found");
  const targetInstitution = requireText(payload.targetInstitution, "payload.targetInstitution");
  const targetInstitutionCode = requireText(payload.targetInstitutionCode, "payload.targetInstitutionCode");
  const authorizedTargets = rows(authorization.meta?.authorizedTo).map(text).filter(Boolean);
  if (authorizedTargets.length && !authorizedTargets.includes(targetInstitutionCode)) throw new Error("resident referral authorization does not cover target institution");
  const collaborationOrder = {
    id: text(payload.collaborationOrderId || `cco-${command.commandId}`),
    center: "双向转诊中心",
    region: text(payload.region),
    fromInstitution: assessment.institutionName || assessment.institutionCode,
    toInstitution: targetInstitution,
    residentId: assessment.residentId,
    personIndex: assessment.personIndex,
    orderType: assessment.disposition === "teleconsultation" ? "基层首诊远程会诊" : "基层首诊上转",
    status: "待接诊",
    priority: text(payload.priority || assessment.urgency || "routine"),
    requestedAt: command.at,
    due: requireText(payload.due, "payload.due"),
    result: "待接诊反馈",
    productionEvidence: false
  };
  data.countyCollaborationOrders = appendById(data.countyCollaborationOrders, collaborationOrder);
  const referral = {
    id: text(payload.referralId || `rf-${command.commandId}`),
    residentId: assessment.residentId,
    personIndex: assessment.personIndex,
    primaryCareAssessmentId: assessment.id,
    type: "上转",
    direction: "upward",
    diseaseType: assessment.diagnosis,
    from: assessment.institutionName || assessment.institutionCode,
    fromInstitutionCode: assessment.institutionCode,
    to: `${targetInstitution}${payload.department ? ` · ${payload.department}` : ""}`,
    toInstitutionCode: targetInstitutionCode,
    reason: text(payload.reason || assessment.assessment),
    status: "requested",
    priority: collaborationOrder.priority,
    date: command.at,
    reservedResource: text(payload.reservedResource || "待接诊机构确认"),
    insurancePolicy: text(payload.insurancePolicy || "待医保路径确认"),
    collaborationOrderId: collaborationOrder.id,
    residentAuthorizationId: authorizationId,
    productionEvidence: false
  };
  data.referralSystem = { ...(data.referralSystem || {}), referrals: appendById(data.referralSystem?.referrals, referral) };
  let teleconsultation = null;
  if (assessment.disposition === "teleconsultation" || payload.createTeleconsultation === true) {
    teleconsultation = {
      id: text(payload.teleconsultationId || `rtc-${command.commandId}`),
      referralId: referral.id,
      residentId: assessment.residentId,
      personIndex: assessment.personIndex,
      type: "teleconsultation",
      diseaseType: assessment.diagnosis,
      sourceInstitution: referral.from,
      sourceInstitutionCode: assessment.institutionCode,
      targetInstitution,
      targetInstitutionCode,
      department: text(payload.department),
      applicantDoctor: assessment.doctorId,
      receivingDoctor: "",
      residentAuthorizationId: authorizationId,
      authorizationStatus: "authorized",
      status: "requested",
      priority: collaborationOrder.priority,
      requestedAt: command.at,
      due: collaborationOrder.due,
      meetingWindow: "",
      clinicalQuestion: text(payload.clinicalQuestion || assessment.assessment),
      materials: rows(payload.materials),
      receivingFeedback: "",
      reportStatus: "pending-return",
      reportReturnedAt: "",
      reportSummary: "",
      collaborationOrderId: collaborationOrder.id,
      productionEvidence: false,
      auditTrail: [{ at: command.at, actor: actorName(actor), action: "created-from-primary-care", note: text(payload.note || referral.reason), productionEvidence: false }]
    };
    data.referralTeleconsultations = appendById(data.referralTeleconsultations, teleconsultation);
  }
  assessment.status = "referred";
  assessment.referralId = referral.id;
  assessment.collaborationOrderId = collaborationOrder.id;
  assessment.targetInstitutionCode = targetInstitutionCode;
  assessment.referralDueAt = collaborationOrder.due;
  if (teleconsultation) assessment.teleconsultationId = teleconsultation.id;
  const message = appendMessage(data, makeMessage(command, actor, {
    suffix: "referral-target",
    collection: teleconsultation ? "referralTeleconsultations" : "referrals",
    sourceId: teleconsultation?.id || referral.id,
    residentId: assessment.residentId,
    targetRole: "institution",
    targetOrgCode: targetInstitutionCode,
    title: "Primary care referral awaiting acceptance",
    body: `${referral.from} referred ${assessment.residentId} to ${targetInstitution}; acknowledgement is required.`
  }));
  return { assessment, referral, collaborationOrder, teleconsultation, message };
}

function canAccessMessage(actor, message) {
  if (actor.role === "commission") return true;
  if (actor.role === "citizen") return actorResidentIds(actor).has(message.residentId) && (!message.targetRole || message.targetRole === "citizen");
  if (message.targetRole && message.targetRole !== actor.role && !(actor.role === "institution" && /institution|hospital|primary-care|family-doctor/.test(message.targetRole))) return false;
  if (message.targetOrgCode && actor.orgCode && message.targetOrgCode !== actor.orgCode) return false;
  return ["institution", "county", "insurance"].includes(actor.role);
}

function recordNotificationReceipt(data, command, actor) {
  const messageId = requireText(command.payload.messageId, "payload.messageId");
  const message = rows(data.taskMessages).find((item) => item.id === messageId);
  if (!message) throw new Error("notification message not found");
  if (!canAccessMessage(actor, message)) throw new Error("notification message scope denied");
  const status = requireText(command.payload.status, "payload.status").toLowerCase();
  if (!RECEIPT_STATUSES.has(status)) throw new Error("unsupported notification receipt status");
  const receipt = {
    at: command.at,
    by: text(actor.username || actor.role),
    byName: actorName(actor),
    role: actor.role,
    channel: text(command.payload.channel || message.channel || "in_app"),
    status,
    note: text(command.payload.note),
    productionEvidence: false
  };
  message.status = status;
  message.receipts = [receipt, ...rows(message.receipts)].slice(0, 20);
  message.updatedAt = command.at;
  return { message, receipt, receiptState: classifyMessageReceipt(message) };
}

function runNotificationFallback(data, command, actor, policy = DEFAULT_NOTIFICATION_POLICY) {
  const messageId = requireText(command.payload.messageId, "payload.messageId");
  const note = requireText(command.payload.note, "payload.note");
  const message = rows(data.taskMessages).find((item) => item.id === messageId);
  if (!message) throw new Error("notification message not found");
  const countySupervisionAllowed = actor.role === "county" && ["referralTeleconsultations", "registrationReferralEscalations"].includes(message.collection);
  if (!countySupervisionAllowed && !canAccessMessage(actor, message)) throw new Error("notification message scope denied");
  if (classifyMessageReceipt(message) === "acknowledged") throw new Error("notification is already acknowledged");
  const channels = rows(policy.channels);
  if (!channels.length) throw new Error("notification fallback policy is empty");
  const attempts = rows(message.deliveryAttempts);
  const currentChannel = text(attempts[0]?.channel || message.channel || channels[0].channel);
  let channelIndex = Math.max(0, channels.findIndex((item) => item.channel === currentChannel));
  const sameChannelAttempts = attempts.filter((item) => item.channel === channels[channelIndex].channel).length;
  if (sameChannelAttempts >= Number(channels[channelIndex].maxAttempts || 1) && channelIndex < channels.length - 1) channelIndex += 1;
  const selected = channels[channelIndex];
  const attempt = {
    id: `delivery-${command.commandId}`,
    at: command.at,
    channel: selected.channel,
    status: selected.channel === "manual-task" ? "manual-review" : "queued",
    note,
    by: actorName(actor),
    role: actor.role,
    productionEvidence: false
  };
  message.deliveryAttempts = [attempt, ...attempts].slice(0, 30);
  message.fallbackHistory = [{ at: command.at, from: currentChannel, to: selected.channel, note, commandId: command.commandId }, ...rows(message.fallbackHistory)].slice(0, 20);
  message.channel = selected.channel;
  message.status = attempt.status;
  message.updatedAt = command.at;
  let manualTask = null;
  if (selected.channel === "manual-task") {
    manualTask = appendMessage(data, makeMessage(command, actor, {
      suffix: "manual-fallback",
      collection: "registrationReferralClosure",
      sourceId: message.sourceId,
      residentId: message.residentId,
      targetRole: "institution",
      targetOrgCode: message.targetOrgCode || actor.orgCode,
      channel: "in_app",
      title: "Manual outreach required after notification failure",
      body: note,
      notificationKey: `registration-referral:manual-fallback:${message.id}`
    }));
  }
  return { message, attempt, manualTask, nextChannel: selected.channel };
}

function acceptReferralContinuity(data, command, actor) {
  const item = rows(data.referralTeleconsultations).find((row) => row.id === command.caseId);
  if (!item) throw new Error("referral teleconsultation not found");
  const targetCode = text(item.targetInstitutionCode);
  requireInstitutionScope(actor, targetCode);
  if (!(item.reportStatus === "returned" || ["report-returned", "closed"].includes(item.status))) throw new Error("referral report has not returned");
  const note = requireText(command.payload.note, "payload.note");
  const nextFollowupAt = requireText(command.payload.nextFollowupAt, "payload.nextFollowupAt");
  const contractId = text(command.payload.familyDoctorContractId);
  if (contractId) {
    const contract = rows(data.phase2FamilyDoctorContracts).find((row) => row.id === contractId);
    if (!contract || contract.residentId !== item.residentId) throw new Error("family doctor contract does not match referral resident");
  }
  item.primaryCareAccepted = true;
  item.followupAccepted = true;
  item.continuityStatus = "accepted";
  item.status = "closed";
  item.closedAt = command.at;
  item.closedBy = actorName(actor);
  item.nextFollowupAt = nextFollowupAt;
  if (contractId) item.familyDoctorContractId = contractId;
  item.auditTrail = [{ at: command.at, actor: actorName(actor), action: "primary-care-continuity-accepted", note, productionEvidence: false }, ...rows(item.auditTrail)].slice(0, 40);
  const followup = {
    id: text(command.payload.followupId || `followup-${item.id}`),
    residentId: item.residentId,
    personIndex: item.personIndex,
    institutionCode: targetCode,
    diseaseType: item.diseaseType,
    plannedAt: nextFollowupAt,
    assignee: text(command.payload.assignee || actorName(actor)),
    status: "待随访",
    result: "未记录",
    advice: text(command.payload.advice || item.reportSummary || note),
    referralId: item.referralId,
    teleconsultationId: item.id,
    familyDoctorContractId: contractId,
    productionEvidence: false
  };
  data.followups = appendById(data.followups, followup);
  rows(data.taskMessages).filter((message) => message.sourceId === item.id && (!message.targetRole || /institution|primary-care|family-doctor/.test(message.targetRole))).forEach((message) => {
    message.status = "handled";
    message.receipts = [{ at: command.at, by: text(actor.username || actor.role), byName: actorName(actor), role: actor.role, status: "handled", note, productionEvidence: false }, ...rows(message.receipts)].slice(0, 20);
  });
  const residentMessage = appendMessage(data, makeMessage(command, actor, {
    suffix: "continuity-resident",
    collection: "referralTeleconsultations",
    sourceId: item.id,
    residentId: item.residentId,
    targetRole: "citizen",
    title: "Referral report accepted by primary care",
    body: `Primary care accepted the returned report. Next follow-up: ${nextFollowupAt}.`
  }));
  return { teleconsultation: item, followup, residentMessage };
}

function completeChronicFollowup(data, command, actor) {
  const followup = rows(data.followups).find((item) => item.id === command.caseId);
  if (!followup) throw new Error("chronic follow-up not found");
  requireInstitutionScope(actor, followup.institutionCode);
  const note = requireText(command.payload.note, "payload.note");
  followup.status = "已完成";
  followup.result = requireText(command.payload.result, "payload.result");
  followup.advice = text(command.payload.advice || followup.advice);
  followup.completedAt = command.at;
  followup.completedBy = actorName(actor);
  followup.feedbackStatus = "resident-acknowledgement-pending";
  followup.productionEvidence = false;
  const message = appendMessage(data, makeMessage(command, actor, {
    suffix: "followup-result",
    collection: "followups",
    sourceId: followup.id,
    residentId: followup.residentId,
    targetRole: "citizen",
    title: "Chronic follow-up result awaiting confirmation",
    body: `${followup.result}. ${followup.advice || note}`,
    notificationKey: `registration-referral:followup-result:${followup.id}:citizen`
  }));
  return { followup, message };
}

function acknowledgeChronicFollowup(data, command, actor) {
  const followup = rows(data.followups).find((item) => item.id === command.caseId);
  if (!followup) throw new Error("chronic follow-up not found");
  requireResidentScope(actor, followup.residentId);
  if (!/完成|completed|closed/i.test(followup.status)) throw new Error("chronic follow-up is not completed");
  const note = requireText(command.payload.note, "payload.note");
  followup.feedbackStatus = "acknowledged";
  followup.residentAcknowledgedAt = command.at;
  followup.residentAcknowledgedBy = actorName(actor);
  followup.residentFeedback = note;
  let message = rows(data.taskMessages).find((item) => item.sourceId === followup.id && item.targetRole === "citizen");
  if (!message) {
    message = appendMessage(data, makeMessage(command, actor, {
      suffix: "followup-ack",
      collection: "followups",
      sourceId: followup.id,
      residentId: followup.residentId,
      targetRole: "citizen",
      status: "acknowledged",
      title: "Chronic follow-up acknowledged",
      body: note,
      receipts: []
    }));
  }
  message.status = "acknowledged";
  const receipt = { at: command.at, by: text(actor.username || actor.role), byName: actorName(actor), role: actor.role, channel: text(command.payload.channel || "in_app"), status: "acknowledged", note, productionEvidence: false };
  message.receipts = [receipt, ...rows(message.receipts)].slice(0, 20);
  return { followup, message, receipt };
}

function acknowledgeFamilyDoctorFulfillment(data, command, actor) {
  const fulfillment = rows(data.phase2FamilyDoctorFulfillments).find((item) => item.id === command.caseId);
  if (!fulfillment) throw new Error("family doctor fulfillment not found");
  requireResidentScope(actor, fulfillment.residentId);
  const contract = rows(data.phase2FamilyDoctorContracts).find((item) => item.id === fulfillment.contractId);
  if (!contract || contract.residentId !== fulfillment.residentId) throw new Error("family doctor contract does not match fulfillment resident");
  const note = requireText(command.payload.note, "payload.note");
  fulfillment.residentAcknowledgement = {
    status: "acknowledged",
    at: command.at,
    by: actorName(actor),
    note,
    satisfactionScore: Number(command.payload.satisfactionScore || 0),
    productionEvidence: false
  };
  fulfillment.status = fulfillment.status === "completed" ? "acknowledged" : fulfillment.status;
  if (Number.isFinite(Number(command.payload.satisfactionScore)) && Number(command.payload.satisfactionScore) > 0) contract.satisfactionScore = Number(command.payload.satisfactionScore);
  contract.lastResidentAcknowledgementAt = command.at;
  const message = appendMessage(data, makeMessage(command, actor, {
    suffix: "family-fulfillment-ack",
    collection: "phase2FamilyDoctorFulfillments",
    sourceId: fulfillment.id,
    residentId: fulfillment.residentId,
    targetRole: "institution",
    targetOrgCode: text(contract.institutionCode),
    status: "acknowledged",
    title: "Family doctor service acknowledged by resident",
    body: note,
    receipts: [{ at: command.at, by: text(actor.username || actor.role), byName: actorName(actor), role: actor.role, channel: "in_app", status: "acknowledged", note, productionEvidence: false }]
  }));
  return { fulfillment, contract, message };
}

function findCaseEnvelope(data, caseType, caseId) {
  const messages = data.taskMessages || [];
  if (caseType === "registration") {
    const item = rows(data.registrationOrders).find((row) => row.id === caseId);
    return item ? normalizeRegistrationCase(item, { messages }) : null;
  }
  if (caseType === "primary-care") {
    const item = rows(data.primaryCareAssessments).find((row) => row.id === caseId);
    return item ? normalizePrimaryCareCase(item, { messages }) : null;
  }
  if (["referral", "referral-teleconsultation"].includes(caseType)) {
    const item = rows(data.referralTeleconsultations).find((row) => row.id === caseId);
    return item ? normalizeReferralCase(item, { messages }) : null;
  }
  if (caseType === "family-doctor") {
    const item = [...rows(data.phase2FamilyDoctorApplications), ...rows(data.phase2FamilyDoctorContracts)].find((row) => row.id === caseId);
    return item ? normalizeFamilyDoctorCase(item, { messages, fulfillments: data.phase2FamilyDoctorFulfillments }) : null;
  }
  if (caseType === "chronic-followup") {
    const item = rows(data.followups).find((row) => row.id === caseId);
    return item ? normalizeChronicFollowupCase(item, { messages }) : null;
  }
  return null;
}

function escalateCase(data, command, actor) {
  const note = requireText(command.payload.note, "payload.note");
  const envelope = findCaseEnvelope(data, command.caseType, command.caseId);
  if (!envelope) throw new Error("closure case not found");
  if (["closed", "cancelled"].includes(envelope.unifiedPhase)) throw new Error("terminal closure case cannot be escalated");
  if (actor.role === "institution" && envelope.responsibleOrg && actor.orgCode && actor.orgCode !== envelope.responsibleOrg) throw new Error("case escalation institution scope denied");
  const escalation = {
    id: `escalation-${command.commandId}`,
    caseType: command.caseType,
    caseId: command.caseId,
    residentId: envelope.residentId,
    severity: text(command.payload.severity || (envelope.unifiedPhase === "exception" ? "high" : "medium")),
    status: "open",
    reason: note,
    responsibleOrg: envelope.responsibleOrg,
    responsibleRole: envelope.responsibleRole,
    dueAt: text(command.payload.dueAt || envelope.dueAt),
    createdAt: command.at,
    createdBy: actorName(actor),
    productionEvidence: false
  };
  data.registrationReferralEscalations = appendById(data.registrationReferralEscalations, escalation);
  const message = appendMessage(data, makeMessage(command, actor, {
    suffix: "escalation",
    collection: "registrationReferralEscalations",
    sourceId: escalation.id,
    residentId: envelope.residentId,
    targetRole: envelope.responsibleRole,
    targetOrgCode: envelope.responsibleOrg,
    title: `Care pathway escalation: ${command.caseType}/${command.caseId}`,
    body: note,
    notificationKey: `registration-referral:escalation:${command.caseType}:${command.caseId}:${text(command.payload.escalationKey || command.commandId)}`
  }));
  return { escalation, message, envelope };
}

function advanceRegistration(data, command, actor) {
  const index = rows(data.registrationOrders).findIndex((item) => item.id === command.caseId);
  if (index < 0) throw new Error("registration order not found");
  const order = data.registrationOrders[index];
  if (actor.role === "institution" && actor.orgCode && order.hospitalCode && actor.orgCode !== order.hospitalCode) throw new Error("registration order institution scope denied");
  const next = applyRegistrationJourneyAction(order, command.payload, actor);
  data.registrationOrders[index] = next;
  const message = appendMessage(data, makeMessage(command, actor, {
    suffix: "registration-action",
    collection: "registrationOrders",
    sourceId: next.id,
    residentId: next.residentId,
    targetRole: actor.role === "citizen" ? "institution" : "citizen",
    targetOrgCode: actor.role === "citizen" ? next.hospitalCode : "",
    title: "Registration journey updated",
    body: `${command.payload.action}: ${next.journeyStage}`
  }));
  return { order: next, message };
}

function applyRegistrationCallback(data, command, actor) {
  const index = rows(data.registrationOrders).findIndex((item) => item.id === command.caseId);
  if (index < 0) throw new Error("registration order not found");
  const callback = { ...(command.payload.callback || {}), idempotencyKey: command.payload.callback?.idempotencyKey || command.commandId };
  const validation = validateRegistrationCallbackTransition(data.registrationOrders[index], callback.eventType);
  if (!validation.allowed) throw new Error(validation.reason);
  const applied = applyRegistrationIntegrationCallback(data.registrationOrders, callback, { receivedAt: command.at, idempotencyKey: callback.idempotencyKey, externalId: callback.externalId }, actor);
  data.registrationOrders = applied.orders;
  const message = appendMessage(data, makeMessage(command, actor, {
    suffix: "registration-callback",
    collection: "registrationOrders",
    sourceId: applied.order.id,
    residentId: applied.order.residentId,
    targetRole: "citizen",
    title: "Registration callback received",
    body: `${callback.eventType}: ${applied.order.journeyStage}`
  }));
  return { order: applied.order, receipt: applied.receipt, message };
}

function normalizeCommand(input = {}) {
  const command = {
    commandId: requireText(input.commandId, "commandId"),
    action: requireText(input.action, "action"),
    caseType: text(input.caseType),
    caseId: text(input.caseId),
    residentId: text(input.residentId),
    at: text(input.at || new Date().toISOString()),
    payload: input.payload && typeof input.payload === "object" ? clone(input.payload) : {}
  };
  if (!Number.isFinite(Date.parse(command.at))) throw new Error("at must be an ISO-compatible timestamp");
  return command;
}

function appendClosureEvent(data, command, actor, result) {
  const event = {
    id: `rrce-${randomUUID()}`,
    commandId: command.commandId,
    action: command.action,
    caseType: command.caseType,
    caseId: command.caseId || result?.assessment?.id || result?.order?.id || result?.teleconsultation?.id || result?.followup?.id || "",
    residentId: command.residentId || result?.assessment?.residentId || result?.teleconsultation?.residentId || result?.followup?.residentId || "",
    at: command.at,
    actor: actorName(actor),
    actorRole: actor.role,
    actorOrgCode: text(actor.orgCode),
    result: "allowed",
    productionEvidence: false
  };
  data.registrationReferralClosureEvents = appendById(data.registrationReferralClosureEvents, event);
  return event;
}

function applyClosureCommand(sourceData = {}, input = {}, actor = {}, options = {}) {
  const command = normalizeCommand(input);
  requireCommandRole(command.action, actor);
  const data = clone(sourceData);
  const prior = rows(data.registrationReferralClosureEvents).find((item) => item.commandId === command.commandId);
  if (prior) return { data, event: prior, result: null, idempotent: true, consistency: validateClosureReferences(data) };
  const handlers = {
    "advance-registration": () => advanceRegistration(data, command, actor),
    "apply-registration-callback": () => applyRegistrationCallback(data, command, actor),
    "record-primary-care-assessment": () => recordPrimaryCareAssessment(data, command, actor),
    "create-referral-from-primary-care": () => createReferralFromPrimaryCare(data, command, actor),
    "record-notification-receipt": () => recordNotificationReceipt(data, command, actor),
    "run-notification-fallback": () => runNotificationFallback(data, command, actor, options.notificationPolicy || DEFAULT_NOTIFICATION_POLICY),
    "accept-referral-continuity": () => acceptReferralContinuity(data, command, actor),
    "complete-chronic-followup": () => completeChronicFollowup(data, command, actor),
    "acknowledge-chronic-followup": () => acknowledgeChronicFollowup(data, command, actor),
    "acknowledge-family-doctor-fulfillment": () => acknowledgeFamilyDoctorFulfillment(data, command, actor),
    "escalate-case": () => escalateCase(data, command, actor)
  };
  const result = handlers[command.action]();
  const event = appendClosureEvent(data, command, actor, result);
  return {
    data,
    event,
    result,
    idempotent: false,
    consistency: validateClosureReferences(data),
    boundary: "The service returns a mutated copy only. Public API authorization, persistence transaction and production evidence remain integration responsibilities."
  };
}

module.exports = {
  CLOSURE_COMMAND_CONTRACTS,
  DEFAULT_NOTIFICATION_POLICY,
  applyClosureCommand,
  canAccessMessage,
  findCaseEnvelope,
  normalizeCommand
};
