"use strict";

const { createHash } = require("node:crypto");

const UNIFIED_PHASES = Object.freeze([
  "requested",
  "accepted",
  "resource-reserved",
  "payment-pending",
  "payment-recorded",
  "scheduled",
  "service-in-progress",
  "result-returned",
  "primary-care-followup-pending",
  "closed",
  "cancelled",
  "exception"
]);

const APPOINTMENT_CALLBACK_EVENTS = Object.freeze([
  "payment-succeeded",
  "payment-failed",
  "his-confirmed",
  "insurance-confirmed",
  "checked-in",
  "completed",
  "refund-completed",
  "refund-failed"
]);

const ACKNOWLEDGED_RECEIPT_STATUSES = new Set([
  "acknowledged",
  "accepted",
  "confirmed",
  "handled",
  "manual-confirmed",
  "read"
]);
const DELIVERED_RECEIPT_STATUSES = new Set(["delivered", "received"]);
const FAILED_RECEIPT_STATUSES = new Set(["bounced", "failed", "rejected", "undeliverable"]);

function rows(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value || "").trim();
}

function lower(value) {
  return text(value).toLowerCase();
}

function isPaymentReady(order = {}) {
  return ["paid", "paid-demo", "waived"].includes(order.paymentStatus);
}

function isHisConfirmed(order = {}) {
  return ["confirmed", "confirmed-demo"].includes(order.hisConfirmationStatus);
}

function isCheckedIn(order = {}) {
  return ["checked-in", "checked-in-demo"].includes(order.checkInStatus);
}

function messageMatchesCase(message = {}, caseId = "") {
  if (!caseId) return false;
  if ([message.sourceId, message.serviceOrderId, message.caseId].some((value) => text(value) === caseId)) return true;
  const taskId = text(message.taskId);
  return taskId === caseId || taskId.endsWith(`:${caseId}`) || taskId.includes(`:${caseId}:`);
}

function classifyMessageReceipt(message = {}) {
  const receiptStatuses = rows(message.receipts).map((receipt) => lower(receipt.status));
  if (receiptStatuses.some((status) => ACKNOWLEDGED_RECEIPT_STATUSES.has(status))) return "acknowledged";
  if (receiptStatuses.some((status) => FAILED_RECEIPT_STATUSES.has(status))) return "failed";
  if (receiptStatuses.some((status) => DELIVERED_RECEIPT_STATUSES.has(status))) return "delivered";
  const status = lower(message.status);
  if (ACKNOWLEDGED_RECEIPT_STATUSES.has(status)) return "acknowledged";
  if (FAILED_RECEIPT_STATUSES.has(status)) return "failed";
  if (DELIVERED_RECEIPT_STATUSES.has(status)) return "delivered";
  if (status === "sent") return "sent";
  if (status === "queued" || status === "pending") return "queued";
  return "created";
}

function summarizeNotificationReceipts(messages = [], caseId = "") {
  const matched = rows(messages).filter((message) => !caseId || messageMatchesCase(message, caseId));
  const states = matched.map(classifyMessageReceipt);
  const counts = states.reduce((summary, status) => {
    summary[status] = (summary[status] || 0) + 1;
    return summary;
  }, {});
  let notificationState = "not-created";
  let receiptState = "missing";
  if (matched.length) {
    if (states.includes("failed")) notificationState = "attention-required";
    else if (states.every((status) => status === "acknowledged")) notificationState = "acknowledged";
    else if (states.includes("acknowledged")) notificationState = "partially-acknowledged";
    else if (states.includes("delivered")) notificationState = "delivered-unacknowledged";
    else if (states.includes("sent")) notificationState = "sent-unconfirmed";
    else if (states.includes("queued")) notificationState = "queued";
    else notificationState = "created";

    if (states.every((status) => status === "acknowledged")) receiptState = "acknowledged";
    else if (states.includes("acknowledged")) receiptState = "partial";
    else if (states.includes("delivered")) receiptState = "delivery-only";
    else if (states.includes("failed")) receiptState = "failed";
  }
  return {
    messageCount: matched.length,
    notificationState,
    receiptState,
    counts
  };
}

function responsibility(org = "", role = "", dueAt = "", nextAction = "") {
  return {
    responsibleOrg: text(org),
    responsibleRole: text(role),
    dueAt: text(dueAt),
    nextAction: text(nextAction)
  };
}

function baseEnvelope(caseType, item = {}, notification = {}) {
  return {
    caseType,
    caseId: text(item.id),
    residentId: text(item.residentId),
    businessStatus: text(item.status),
    unifiedPhase: "requested",
    sourceOrg: text(item.sourceInstitutionCode || item.hospitalCode || item.reviewInstitutionCode),
    responsibleOrg: "",
    responsibleRole: "",
    dueAt: "",
    nextAction: "",
    notificationState: notification.notificationState || "not-created",
    receiptState: notification.receiptState || "missing",
    exceptionState: "none",
    upstreamRefs: [],
    downstreamRefs: [],
    productionEvidence: false
  };
}

function normalizeRegistrationCase(order = {}, context = {}) {
  const notification = summarizeNotificationReceipts(context.messages, order.id);
  const envelope = baseEnvelope("registration", order, notification);
  envelope.upstreamRefs = [text(order.scheduleId), text(order.hisScheduleId)].filter(Boolean);
  envelope.downstreamRefs = [text(order.hisVisitId), text(order.registrationNo)].filter(Boolean);

  if (["completed", "closed"].includes(order.status)) {
    envelope.unifiedPhase = "closed";
    Object.assign(envelope, responsibility("", "", "", "none"));
    return envelope;
  }
  if (order.status === "cancelled") {
    envelope.unifiedPhase = ["refund-pending", "refund-failed"].includes(order.refundStatus) ? "exception" : "cancelled";
    envelope.exceptionState = order.refundStatus === "refund-failed" ? "refund-failed" : order.refundStatus === "refund-pending" ? "refund-pending" : "none";
    Object.assign(envelope, responsibility(order.hospitalCode, "institution-finance", order.refundDueAt, envelope.exceptionState === "refund-failed" ? "reconcile refund failure" : "complete refund or compensation"));
    return envelope;
  }
  if (order.disruption?.status === "pending-resident") {
    envelope.unifiedPhase = "exception";
    envelope.exceptionState = "resident-response-pending";
    Object.assign(envelope, responsibility("resident", "citizen", order.disruption.acknowledgementDueAt, "accept or decline replacement schedule"));
    return envelope;
  }
  if (order.paymentStatus === "failed") {
    envelope.unifiedPhase = "exception";
    envelope.exceptionState = "payment-failed";
    Object.assign(envelope, responsibility("resident", "citizen", order.paymentDueAt, "retry payment or cancel appointment"));
    return envelope;
  }
  if (!isPaymentReady(order)) {
    envelope.unifiedPhase = "payment-pending";
    Object.assign(envelope, responsibility("resident", "citizen", order.paymentDueAt, "complete payment or confirm waiver"));
    return envelope;
  }
  if (!isHisConfirmed(order)) {
    envelope.unifiedPhase = "payment-recorded";
    Object.assign(envelope, responsibility(order.hospitalCode, "institution-registration", order.confirmationDueAt, "confirm HIS appointment"));
    return envelope;
  }
  if (!isCheckedIn(order)) {
    envelope.unifiedPhase = "scheduled";
    Object.assign(envelope, responsibility("resident", "citizen", order.appointmentDate, "check in for appointment"));
    return envelope;
  }
  envelope.unifiedPhase = "service-in-progress";
  Object.assign(envelope, responsibility(order.hospitalCode, "receiving-clinical-team", order.completionDueAt, "complete visit and return result"));
  return envelope;
}

function normalizePrimaryCareCase(item = {}, context = {}) {
  const notification = summarizeNotificationReceipts(context.messages, item.id);
  const envelope = baseEnvelope("primary-care", item, notification);
  envelope.sourceOrg = text(item.institutionCode || item.institutionName);
  envelope.upstreamRefs = [text(item.residentAuthorizationId)].filter(Boolean);
  envelope.downstreamRefs = [text(item.referralId), text(item.collaborationOrderId), text(item.teleconsultationId), text(item.followupId || `followup-${item.id}`)].filter(Boolean);
  if (item.status === "referred") {
    envelope.unifiedPhase = "accepted";
    Object.assign(envelope, responsibility(item.targetInstitutionCode, "referral-center", item.referralDueAt, "accept referral and confirm receiving resource"));
  } else if (item.status === "completed" && item.disposition === "manage-locally") {
    envelope.unifiedPhase = "service-in-progress";
    Object.assign(envelope, responsibility(item.institutionCode, "primary-care-team", item.nextFollowupAt, "complete primary-care follow-up"));
  } else if (item.status === "completed" && ["refer-up", "teleconsultation"].includes(item.disposition)) {
    envelope.unifiedPhase = "requested";
    Object.assign(envelope, responsibility(item.institutionCode, "primary-care-team", item.referralDueAt, "create authorized referral from assessment"));
  } else {
    envelope.unifiedPhase = "requested";
    Object.assign(envelope, responsibility(item.institutionCode, "primary-care-team", item.assessmentDueAt, "complete primary-care assessment"));
  }
  return envelope;
}

function referralContinuityAccepted(item = {}, notification = {}) {
  return item.primaryCareAccepted === true || item.continuityStatus === "accepted" || item.followupAccepted === true || notification.receiptState === "acknowledged";
}

function normalizeReferralCase(item = {}, context = {}) {
  const notification = summarizeNotificationReceipts(context.messages, item.id);
  const envelope = baseEnvelope("referral-teleconsultation", item, notification);
  envelope.sourceOrg = text(item.sourceInstitutionCode || item.fromInstitutionCode || item.sourceInstitution || item.from);
  envelope.upstreamRefs = [text(item.referralId), text(item.collaborationOrderId), text(item.residentAuthorizationId)].filter(Boolean);
  envelope.downstreamRefs = [text(item.reportRecordId), text(item.followupId), text(item.familyDoctorContractId)].filter(Boolean);
  const status = lower(item.status);
  const reportReturned = item.reportStatus === "returned" || ["report-returned", "closed"].includes(status);
  const continuityOrg = item.type === "down-referral-feedback" || item.direction === "downward"
    ? item.targetInstitutionCode || item.toInstitutionCode || item.targetInstitution || item.to
    : item.sourceInstitutionCode || item.fromInstitutionCode || item.sourceInstitution || item.from;

  if (reportReturned) {
    if (status === "closed" && referralContinuityAccepted(item, notification)) {
      envelope.unifiedPhase = "closed";
      Object.assign(envelope, responsibility("", "", "", "none"));
    } else {
      envelope.unifiedPhase = "primary-care-followup-pending";
      envelope.exceptionState = notification.receiptState === "acknowledged" ? "none" : "business-acknowledgement-pending";
      Object.assign(envelope, responsibility(continuityOrg, "primary-care-institution", item.nextFollowupAt || item.due, "accept report and create follow-up task"));
    }
    return envelope;
  }
  if (status === "scheduled") {
    envelope.unifiedPhase = "scheduled";
    Object.assign(envelope, responsibility(item.targetInstitutionCode || item.toInstitutionCode || item.targetInstitution || item.to, "receiving-hospital", item.due, "perform consultation and return signed report"));
    return envelope;
  }
  if (["accepted", "feedback-returned"].includes(status)) {
    envelope.unifiedPhase = "accepted";
    Object.assign(envelope, responsibility(item.targetInstitutionCode || item.toInstitutionCode || item.targetInstitution || item.to, "receiving-hospital", item.due, "reserve specialist resource and schedule consultation"));
    return envelope;
  }
  if (status === "no-show") {
    envelope.unifiedPhase = "exception";
    envelope.exceptionState = `teleconsultation-no-show-${text(item.noShow?.party || "unknown")}`;
    Object.assign(envelope, responsibility(item.targetInstitutionCode || item.toInstitutionCode || item.targetInstitution || item.to, "receiving-hospital", item.due, "reschedule or cancel teleconsultation"));
    return envelope;
  }
  if (status === "authorization-on-hold") {
    envelope.unifiedPhase = "exception";
    envelope.exceptionState = "resident-authorization-revoked";
    Object.assign(envelope, responsibility(item.sourceInstitutionCode || item.fromInstitutionCode || item.sourceInstitution || item.from, "primary-care-institution", item.due, "obtain new resident authorization, reassign, or withdraw referral"));
    return envelope;
  }
  if (["cancelled", "rejected", "withdrawn"].includes(status)) {
    envelope.unifiedPhase = "cancelled";
    Object.assign(envelope, responsibility("", "", "", "none"));
    return envelope;
  }
  envelope.unifiedPhase = "requested";
  Object.assign(envelope, responsibility(item.targetInstitutionCode || item.toInstitutionCode || item.targetInstitution || item.to, "referral-center", item.due, "triage and accept referral"));
  return envelope;
}

function normalizeFamilyDoctorCase(item = {}, context = {}) {
  const notification = summarizeNotificationReceipts(context.messages, item.id);
  const envelope = baseEnvelope("family-doctor", item, notification);
  envelope.upstreamRefs = [text(item.applicationId), text(item.templateId), text(item.packageId), text(item.teamId)].filter(Boolean);
  envelope.downstreamRefs = rows(context.fulfillments).filter((row) => row.contractId === item.id).map((row) => row.id);
  const isApplication = Boolean(item.reviewStatus || /^p2fda-/i.test(text(item.id)));

  if (isApplication) {
    if (["rejected", "cancelled"].includes(item.reviewStatus || item.status)) {
      envelope.unifiedPhase = "cancelled";
      Object.assign(envelope, responsibility("resident", "citizen", item.supplementDueAt, "supplement application or stop contracting"));
    } else if ((item.reviewStatus || item.status) === "approved") {
      envelope.unifiedPhase = "accepted";
      Object.assign(envelope, responsibility(item.reviewInstitutionCode, "family-doctor-team", item.contractDueAt, "activate contract and notify resident"));
    } else {
      envelope.unifiedPhase = "requested";
      Object.assign(envelope, responsibility(item.reviewInstitutionCode, "institution-review", item.reviewDueAt, "review family doctor application"));
    }
    return envelope;
  }

  if (["closed", "terminated", "expired"].includes(item.status)) {
    envelope.unifiedPhase = item.status === "closed" ? "closed" : "cancelled";
    Object.assign(envelope, responsibility("", "", "", "none"));
  } else if (item.status === "renewal-pending" || item.renewalStatus === "pending-review") {
    envelope.unifiedPhase = "requested";
    Object.assign(envelope, responsibility(item.institutionCode || item.reviewInstitutionCode, "institution-review", item.renewalDueAt, "review contract renewal"));
  } else if (Number(item.fulfillmentPercent || 0) >= 100) {
    envelope.unifiedPhase = "result-returned";
    Object.assign(envelope, responsibility("resident", "citizen", item.satisfactionDueAt, "confirm service completion and satisfaction"));
  } else {
    envelope.unifiedPhase = "service-in-progress";
    Object.assign(envelope, responsibility(item.institutionCode || item.reviewInstitutionCode, "family-doctor-team", item.nextServiceAt, "deliver next contracted service"));
  }
  return envelope;
}

function normalizeChronicFollowupCase(item = {}, context = {}) {
  const notification = summarizeNotificationReceipts(context.messages, item.id);
  const envelope = baseEnvelope("chronic-followup", item, notification);
  envelope.sourceOrg = text(item.institutionCode || item.sourceInstitutionCode);
  envelope.upstreamRefs = [text(item.planId), text(item.contractId), text(item.referralId)].filter(Boolean);
  envelope.downstreamRefs = [text(item.feedbackId), text(item.nextFollowupId)].filter(Boolean);
  const status = lower(item.status);
  const completed = /completed|closed|done|已完成|已闭环/.test(`${status} ${text(item.resultStatus)}`);
  if (completed && notification.receiptState === "acknowledged") {
    envelope.unifiedPhase = "closed";
    Object.assign(envelope, responsibility("", "", "", "none"));
  } else if (completed) {
    envelope.unifiedPhase = "result-returned";
    Object.assign(envelope, responsibility("resident", "citizen", item.feedbackDueAt, "confirm follow-up result or record manual contact"));
  } else if (/overdue|逾期|high-risk|高风险/.test(`${status} ${text(item.riskLevel)}`)) {
    envelope.unifiedPhase = "exception";
    envelope.exceptionState = "followup-overdue-or-high-risk";
    Object.assign(envelope, responsibility(item.institutionCode, "family-doctor-team", item.plannedAt || item.due, "complete or escalate follow-up"));
  } else {
    envelope.unifiedPhase = "scheduled";
    Object.assign(envelope, responsibility(item.institutionCode, "family-doctor-team", item.plannedAt || item.due, "perform scheduled follow-up"));
  }
  return envelope;
}

function normalizeDomainCase(caseType, item = {}, context = {}) {
  const normalizers = {
    registration: normalizeRegistrationCase,
    "primary-care": normalizePrimaryCareCase,
    referral: normalizeReferralCase,
    "referral-teleconsultation": normalizeReferralCase,
    "family-doctor": normalizeFamilyDoctorCase,
    "chronic-followup": normalizeChronicFollowupCase
  };
  const normalize = normalizers[caseType];
  if (!normalize) throw new Error(`unsupported caseType ${caseType}`);
  return normalize(item, context);
}

function validateRegistrationCallbackTransition(order = {}, eventType = "") {
  if (!APPOINTMENT_CALLBACK_EVENTS.includes(eventType)) return { allowed: false, reason: "unsupported appointment callback eventType" };
  const terminal = ["completed", "closed"].includes(order.status);
  const cancelled = order.status === "cancelled";
  if (eventType === "refund-completed") {
    const allowed = cancelled && ["refund-pending", "refund-failed"].includes(order.refundStatus);
    return { allowed, reason: allowed ? "allowed" : "refund callback requires a cancelled refund-pending or refund-failed order" };
  }
  if (eventType === "refund-failed") {
    const allowed = cancelled && order.refundStatus === "refund-pending";
    return { allowed, reason: allowed ? "allowed" : "refund failure requires a cancelled refund-pending order" };
  }
  if (terminal || cancelled) return { allowed: false, reason: "callback is not allowed after order closure" };
  if (eventType === "his-confirmed" && !isPaymentReady(order)) return { allowed: false, reason: "HIS confirmation requires payment evidence" };
  if (eventType === "checked-in" && (!isPaymentReady(order) || !isHisConfirmed(order))) return { allowed: false, reason: "check-in requires payment and HIS confirmation" };
  if (eventType === "completed" && !isCheckedIn(order)) return { allowed: false, reason: "completion requires check-in" };
  return { allowed: true, reason: "allowed" };
}

function validateClosureReferences(data = {}) {
  const issues = [];
  const addIssue = (severity, code, entityType, entityId, detail, references = {}) => issues.push({ severity, code, entityType, entityId, detail, references });
  const index = (items) => new Map(rows(items).filter((item) => item?.id).map((item) => [item.id, item]));
  const schedules = index(data.registrationSchedules);
  const referrals = index(data.referralSystem?.referrals);
  const collaborationOrders = index(data.countyCollaborationOrders);
  const authorizations = index(rows(data.personalRecords).filter((item) => item.category === "authorizations"));
  const applications = rows(data.phase2FamilyDoctorApplications);
  const contracts = index(data.phase2FamilyDoctorContracts);
  const familyTeams = index(data.phase2FamilyDoctorTeams);
  const familyPackages = index(data.phase2FamilyDoctorServicePackages);
  const taskMessages = index(data.taskMessages);
  const messageSourceIndexes = {
    referralTeleconsultations: index(data.referralTeleconsultations),
    registrationOrders: index(data.registrationOrders),
    followups: index(data.followups),
    phase2FamilyDoctorApplications: index(data.phase2FamilyDoctorApplications),
    phase2FamilyDoctorContracts: index(data.phase2FamilyDoctorContracts),
    phase2FamilyDoctorFulfillments: index(data.phase2FamilyDoctorFulfillments)
  };

  rows(data.registrationOrders).forEach((order) => {
    const schedule = schedules.get(order.scheduleId);
    if (!schedule) addIssue("P0", "registration-schedule-missing", "registrationOrder", order.id, "registration order references a missing schedule", { scheduleId: order.scheduleId });
    if (schedule && order.hospitalCode && schedule.hospitalCode && order.hospitalCode !== schedule.hospitalCode) addIssue("P0", "registration-hospital-mismatch", "registrationOrder", order.id, "order and schedule hospital codes differ", { orderHospitalCode: order.hospitalCode, scheduleHospitalCode: schedule.hospitalCode });
    if (schedule && order.departmentCode && schedule.departmentCode && order.departmentCode !== schedule.departmentCode) addIssue("P0", "registration-department-mismatch", "registrationOrder", order.id, "order and schedule department codes differ", { orderDepartmentCode: order.departmentCode, scheduleDepartmentCode: schedule.departmentCode });
  });

  authorizations.forEach((authorization) => {
    const dataScopes = rows(authorization.dataScopes || authorization.meta?.dataScopes).map((item) => lower(item));
    if (dataScopes.length && (!dataScopes.includes("clinical-summary") || !dataScopes.includes("referral-report"))) {
      addIssue("P0", "referral-authorization-data-scope-incomplete", "authorization", authorization.id, "versioned referral authorization must include clinical-summary and referral-report scopes", { dataScopes });
    }
    const consentActor = lower(authorization.consentActor || authorization.meta?.consentActor);
    const guardianProofId = text(authorization.guardianProofId || authorization.meta?.guardianProofId);
    if (consentActor === "guardian" && !guardianProofId) {
      addIssue("P0", "referral-authorization-guardian-proof-missing", "authorization", authorization.id, "guardian authorization requires a proof reference", {});
    }
  });

  rows(data.referralTeleconsultations).forEach((teleconsultation) => {
    const referral = referrals.get(teleconsultation.referralId);
    const collaborationOrder = collaborationOrders.get(teleconsultation.collaborationOrderId);
    const authorization = authorizations.get(teleconsultation.residentAuthorizationId);
    if (!referral) addIssue("P0", "teleconsult-referral-missing", "referralTeleconsultation", teleconsultation.id, "teleconsultation references a missing referral", { referralId: teleconsultation.referralId });
    if (referral && referral.residentId !== teleconsultation.residentId) addIssue("P0", "teleconsult-referral-resident-mismatch", "referralTeleconsultation", teleconsultation.id, "teleconsultation and referral residents differ", { teleconsultationResidentId: teleconsultation.residentId, referralResidentId: referral.residentId });
    if (referral?.collaborationOrderId && referral.collaborationOrderId !== teleconsultation.collaborationOrderId) addIssue("P0", "teleconsult-referral-collaboration-mismatch", "referralTeleconsultation", teleconsultation.id, "teleconsultation and referral point to different collaboration orders", { teleconsultationCollaborationOrderId: teleconsultation.collaborationOrderId, referralCollaborationOrderId: referral.collaborationOrderId });
    if (!collaborationOrder) addIssue("P0", "teleconsult-collaboration-missing", "referralTeleconsultation", teleconsultation.id, "teleconsultation references a missing collaboration order", { collaborationOrderId: teleconsultation.collaborationOrderId });
    if (collaborationOrder && collaborationOrder.residentId !== teleconsultation.residentId) addIssue("P0", "teleconsult-collaboration-resident-mismatch", "referralTeleconsultation", teleconsultation.id, "teleconsultation and collaboration order residents differ", { teleconsultationResidentId: teleconsultation.residentId, collaborationOrderResidentId: collaborationOrder.residentId });
    if (!authorization) addIssue("P0", "teleconsult-authorization-missing", "referralTeleconsultation", teleconsultation.id, "teleconsultation references a missing resident authorization", { residentAuthorizationId: teleconsultation.residentAuthorizationId });
    if (authorization && authorization.residentId !== teleconsultation.residentId) addIssue("P0", "teleconsult-authorization-resident-mismatch", "referralTeleconsultation", teleconsultation.id, "teleconsultation and authorization residents differ", { teleconsultationResidentId: teleconsultation.residentId, authorizationResidentId: authorization.residentId });
    const versionedMaterials = rows(teleconsultation.materials).filter((item) => item && typeof item === "object");
    const materialIds = new Set();
    versionedMaterials.forEach((material) => {
      if (!material.id || materialIds.has(material.id)) addIssue("P0", "teleconsult-material-id-invalid", "referralTeleconsultation", teleconsultation.id, "versioned material ids must be present and unique", { materialId: material.id || "" });
      materialIds.add(material.id);
      if (!/^[a-f0-9]{64}$/i.test(text(material.digest))) addIssue("P0", "teleconsult-material-digest-invalid", "referralTeleconsultation", teleconsultation.id, "versioned material digest must be SHA-256", { materialId: material.id || "", digest: material.digest || "" });
      if (!Number.isInteger(Number(material.version)) || Number(material.version) < 1) addIssue("P0", "teleconsult-material-version-invalid", "referralTeleconsultation", teleconsultation.id, "versioned material version must be a positive integer", { materialId: material.id || "", version: material.version });
    });
    if (versionedMaterials.length && !/^[a-f0-9]{64}$/i.test(text(teleconsultation.materialManifestDigest))) {
      addIssue("P0", "teleconsult-material-manifest-missing", "referralTeleconsultation", teleconsultation.id, "versioned materials require a SHA-256 manifest digest", { materialCount: versionedMaterials.length });
    } else if (versionedMaterials.length) {
      const expectedManifestDigest = createHash("sha256")
        .update(JSON.stringify([...versionedMaterials].sort((a, b) => text(a.id).localeCompare(text(b.id))).map((item) => ({ id: item.id, version: item.version, digest: item.digest }))))
        .digest("hex");
      if (expectedManifestDigest !== text(teleconsultation.materialManifestDigest).toLowerCase()) {
        addIssue("P0", "teleconsult-material-manifest-mismatch", "referralTeleconsultation", teleconsultation.id, "clinical material manifest digest does not match its versioned entries", { expectedManifestDigest, actualManifestDigest: teleconsultation.materialManifestDigest });
      }
    }
  });

  rows(data.referralSystem?.referrals).forEach((referral) => {
    const versionedMaterials = rows(referral.materials).filter((item) => item && typeof item === "object");
    if (!versionedMaterials.length) return;
    const expectedManifestDigest = createHash("sha256")
      .update(JSON.stringify([...versionedMaterials].sort((a, b) => text(a.id).localeCompare(text(b.id))).map((item) => ({ id: item.id, version: item.version, digest: item.digest }))))
      .digest("hex");
    if (!/^[a-f0-9]{64}$/i.test(text(referral.materialManifestDigest)) || expectedManifestDigest !== text(referral.materialManifestDigest).toLowerCase()) {
      addIssue("P0", "referral-material-manifest-invalid", "referral", referral.id, "referral clinical material manifest is missing or does not match its versioned entries", { expectedManifestDigest, actualManifestDigest: referral.materialManifestDigest || "" });
    }
  });

  applications.forEach((application) => {
    const team = familyTeams.get(application.teamId);
    const servicePackage = familyPackages.get(application.packageId);
    if (familyTeams.size && !team) addIssue("P0", "family-application-team-missing", "familyDoctorApplication", application.id, "application references a missing family doctor team", { teamId: application.teamId });
    if (familyPackages.size && !servicePackage) addIssue("P0", "family-application-package-missing", "familyDoctorApplication", application.id, "application references a missing family doctor package", { packageId: application.packageId });
    if (team && application.reviewInstitutionCode && team.institutionCode !== application.reviewInstitutionCode) addIssue("P0", "family-application-review-org-mismatch", "familyDoctorApplication", application.id, "application review institution differs from its team institution", { reviewInstitutionCode: application.reviewInstitutionCode, teamInstitutionCode: team.institutionCode });
  });

  rows(data.phase2FamilyDoctorContracts).forEach((contract) => {
    const linkedApplication = contract.applicationId ? applications.find((application) => application.id === contract.applicationId) : null;
    const approvedCandidates = applications.filter((application) => application.residentId === contract.residentId && application.packageId === contract.packageId && application.teamId === contract.teamId && application.reviewStatus === "approved");
    const pendingRenewalForExistingContract = linkedApplication
      && linkedApplication.applicationType === "renewal"
      && linkedApplication.existingContractId === contract.id
      && ["renewal-pending", "active"].includes(contract.status);
    if (contract.applicationId && !linkedApplication) addIssue("P1", "family-contract-application-missing", "familyDoctorContract", contract.id, "contract references a missing application", { applicationId: contract.applicationId });
    if (linkedApplication && linkedApplication.reviewStatus !== "approved" && !pendingRenewalForExistingContract) addIssue("P0", "family-contract-application-not-approved", "familyDoctorContract", contract.id, "contract was created from an application that is not approved", { applicationId: linkedApplication.id, reviewStatus: linkedApplication.reviewStatus });
    if (!contract.applicationId && !approvedCandidates.length) addIssue("P1", "family-contract-approved-application-unlinked", "familyDoctorContract", contract.id, "contract cannot be traced to an approved application", { residentId: contract.residentId, packageId: contract.packageId, teamId: contract.teamId });
    if (familyTeams.size && !familyTeams.has(contract.teamId)) addIssue("P0", "family-contract-team-missing", "familyDoctorContract", contract.id, "contract references a missing family doctor team", { teamId: contract.teamId });
    if (familyPackages.size && !familyPackages.has(contract.packageId)) addIssue("P0", "family-contract-package-missing", "familyDoctorContract", contract.id, "contract references a missing family doctor package", { packageId: contract.packageId });
  });

  rows(data.phase2FamilyDoctorFulfillments).forEach((fulfillment) => {
    const contract = contracts.get(fulfillment.contractId);
    if (!contract) addIssue("P0", "family-fulfillment-contract-missing", "familyDoctorFulfillment", fulfillment.id, "fulfillment references a missing contract", { contractId: fulfillment.contractId });
    if (contract && (contract.residentId !== fulfillment.residentId || contract.teamId !== fulfillment.teamId || (fulfillment.packageId && contract.packageId !== fulfillment.packageId))) addIssue("P0", "family-fulfillment-contract-scope-mismatch", "familyDoctorFulfillment", fulfillment.id, "fulfillment resident, team, or package differs from its contract", { contractId: fulfillment.contractId });
  });

  rows(data.taskMessages).forEach((message) => {
    const sourceIndex = messageSourceIndexes[message.collection];
    if (!sourceIndex || !message.sourceId) return;
    const source = sourceIndex.get(message.sourceId);
    if (!source) addIssue("P0", "notification-source-missing", "taskMessage", message.id, "notification references a missing business source", { collection: message.collection, sourceId: message.sourceId });
    if (source && source.residentId && message.residentId !== source.residentId) addIssue("P0", "notification-source-resident-mismatch", "taskMessage", message.id, "notification and source record residents differ", { collection: message.collection, sourceId: message.sourceId, messageResidentId: message.residentId, sourceResidentId: source.residentId });
  });

  rows(data.registrationReferralNotificationDeadLetters).forEach((deadLetter) => {
    const message = taskMessages.get(deadLetter.messageId);
    if (!message) addIssue("P0", "notification-dead-letter-message-missing", "notificationDeadLetter", deadLetter.id, "dead letter references a missing task message", { messageId: deadLetter.messageId });
    if (message && deadLetter.residentId && deadLetter.residentId !== message.residentId) addIssue("P0", "notification-dead-letter-resident-mismatch", "notificationDeadLetter", deadLetter.id, "dead letter and task message residents differ", { messageId: deadLetter.messageId });
    if (message && deadLetter.targetOrgCode && deadLetter.targetOrgCode !== message.targetOrgCode) addIssue("P0", "notification-dead-letter-org-mismatch", "notificationDeadLetter", deadLetter.id, "dead letter and task message target organizations differ", { messageId: deadLetter.messageId });
  });

  const summary = issues.reduce((result, issue) => {
    result[issue.severity] = (result[issue.severity] || 0) + 1;
    return result;
  }, { total: issues.length, P0: 0, P1: 0, P2: 0 });
  summary.total = issues.length;
  return {
    functionalOk: true,
    dataReady: summary.P0 === 0,
    productionReady: false,
    summary,
    issues,
    boundary: "Local consistency and workflow evidence do not constitute production integration evidence."
  };
}

function cloneData(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function planClosureReferenceRepairs(data = {}) {
  const referrals = new Map(rows(data.referralSystem?.referrals).filter((item) => item?.id).map((item) => [item.id, item]));
  const collaborationOrders = new Map(rows(data.countyCollaborationOrders).filter((item) => item?.id).map((item) => [item.id, item]));
  const repairs = [];
  const manualReviews = [];

  rows(data.referralTeleconsultations).forEach((teleconsultation) => {
    const referral = referrals.get(teleconsultation.referralId);
    if (!referral?.collaborationOrderId || referral.collaborationOrderId === teleconsultation.collaborationOrderId) return;
    const authoritativeOrder = collaborationOrders.get(referral.collaborationOrderId);
    const currentOrder = collaborationOrders.get(teleconsultation.collaborationOrderId);
    const common = {
      entityType: "referralTeleconsultation",
      entityId: teleconsultation.id,
      field: "collaborationOrderId",
      from: teleconsultation.collaborationOrderId,
      to: referral.collaborationOrderId,
      authoritativeSource: {
        collection: "referralSystem.referrals",
        entityId: referral.id,
        field: "collaborationOrderId"
      }
    };
    if (!authoritativeOrder || authoritativeOrder.residentId !== teleconsultation.residentId) {
      manualReviews.push({
        ...common,
        id: `manual-review:${teleconsultation.id}:collaborationOrderId`,
        severity: "P0",
        reason: !authoritativeOrder
          ? "the referral's collaboration order does not exist"
          : "the referral's collaboration order belongs to another resident",
        evidence: {
          teleconsultationResidentId: teleconsultation.residentId,
          authoritativeOrderResidentId: authoritativeOrder?.residentId || "",
          currentOrderResidentId: currentOrder?.residentId || ""
        }
      });
      return;
    }
    repairs.push({
      ...common,
      id: `repair:${teleconsultation.id}:collaborationOrderId`,
      severity: "P0",
      operation: "replace",
      collection: "referralTeleconsultations",
      reason: "align the teleconsultation with its referral's resident-consistent collaboration order",
      preconditions: {
        referralId: teleconsultation.referralId,
        residentId: teleconsultation.residentId,
        currentValue: teleconsultation.collaborationOrderId,
        authoritativeValue: referral.collaborationOrderId,
        authoritativeOrderResidentId: authoritativeOrder.residentId
      },
      impactedSources: ["data/db.json", "server.js:seedReferralTeleconsultations (verify parity)"]
    });
  });

  const messageSources = {
    referralTeleconsultations: new Map(rows(data.referralTeleconsultations).filter((item) => item?.id).map((item) => [item.id, item])),
    registrationOrders: new Map(rows(data.registrationOrders).filter((item) => item?.id).map((item) => [item.id, item])),
    followups: new Map(rows(data.followups).filter((item) => item?.id).map((item) => [item.id, item])),
    phase2FamilyDoctorApplications: new Map(rows(data.phase2FamilyDoctorApplications).filter((item) => item?.id).map((item) => [item.id, item])),
    phase2FamilyDoctorContracts: new Map(rows(data.phase2FamilyDoctorContracts).filter((item) => item?.id).map((item) => [item.id, item])),
    phase2FamilyDoctorFulfillments: new Map(rows(data.phase2FamilyDoctorFulfillments).filter((item) => item?.id).map((item) => [item.id, item]))
  };
  rows(data.taskMessages).forEach((message) => {
    const source = messageSources[message.collection]?.get(message.sourceId);
    if (!source?.residentId || source.residentId === message.residentId) return;
    repairs.push({
      id: `repair:${message.id}:residentId`,
      severity: "P0",
      operation: "replace",
      collection: "taskMessages",
      entityType: "taskMessage",
      entityId: message.id,
      field: "residentId",
      from: message.residentId,
      to: source.residentId,
      reason: "align notification resident scope with its authoritative business source",
      authoritativeSource: { collection: message.collection, entityId: source.id, field: "residentId" },
      preconditions: { sourceCollection: message.collection, sourceId: message.sourceId, currentValue: message.residentId, authoritativeValue: source.residentId },
      impactedSources: ["data/db.json", "server.js:seedTaskMessages"]
    });
  });

  const before = validateClosureReferences(data);
  const rehearsal = repairs.length ? applyClosureReferenceRepairs(data, repairs) : { consistency: before, applied: [] };
  return {
    functionalOk: true,
    safeToApply: manualReviews.length === 0 && rehearsal.consistency.summary.P0 < before.summary.P0,
    persistenceMutation: false,
    summary: {
      p0Before: before.summary.P0,
      safeRepairs: repairs.length,
      manualReviews: manualReviews.length,
      rehearsedRepairs: rehearsal.applied.length,
      p0AfterRehearsal: rehearsal.consistency.summary.P0
    },
    repairs,
    manualReviews,
    rehearsal: {
      dataReady: rehearsal.consistency.dataReady,
      consistency: rehearsal.consistency,
      applied: rehearsal.applied
    },
    boundary: "The plan is read-only. Persistence and server seed updates require an explicitly reviewed integration change."
  };
}

function applyClosureReferenceRepairs(data = {}, repairsOrPlan = []) {
  const repairs = Array.isArray(repairsOrPlan) ? repairsOrPlan : rows(repairsOrPlan.repairs);
  const next = cloneData(data);
  const teleconsultations = rows(next.referralTeleconsultations);
  const referrals = new Map(rows(next.referralSystem?.referrals).filter((item) => item?.id).map((item) => [item.id, item]));
  const collaborationOrders = new Map(rows(next.countyCollaborationOrders).filter((item) => item?.id).map((item) => [item.id, item]));
  const messageSources = {
    referralTeleconsultations: new Map(rows(next.referralTeleconsultations).filter((item) => item?.id).map((item) => [item.id, item])),
    registrationOrders: new Map(rows(next.registrationOrders).filter((item) => item?.id).map((item) => [item.id, item])),
    followups: new Map(rows(next.followups).filter((item) => item?.id).map((item) => [item.id, item])),
    phase2FamilyDoctorApplications: new Map(rows(next.phase2FamilyDoctorApplications).filter((item) => item?.id).map((item) => [item.id, item])),
    phase2FamilyDoctorContracts: new Map(rows(next.phase2FamilyDoctorContracts).filter((item) => item?.id).map((item) => [item.id, item])),
    phase2FamilyDoctorFulfillments: new Map(rows(next.phase2FamilyDoctorFulfillments).filter((item) => item?.id).map((item) => [item.id, item]))
  };
  const applied = [];

  repairs.forEach((repair) => {
    if (repair.operation === "replace" && repair.collection === "taskMessages" && repair.field === "residentId") {
      const message = rows(next.taskMessages).find((item) => item.id === repair.entityId);
      if (!message) throw new Error(`repair target ${repair.entityId} not found`);
      if (message.residentId !== repair.from) throw new Error(`repair precondition failed for ${repair.entityId}: current residentId changed`);
      if (message.collection !== repair.preconditions?.sourceCollection || message.sourceId !== repair.preconditions?.sourceId) throw new Error(`repair precondition failed for ${repair.entityId}: notification source changed`);
      const source = messageSources[message.collection]?.get(message.sourceId);
      if (!source || source.residentId !== repair.to) throw new Error(`repair authority failed for ${repair.entityId}: source resident changed`);
      message.residentId = repair.to;
      applied.push({ repairId: repair.id, entityId: message.id, field: repair.field, from: repair.from, to: repair.to, persisted: false });
      return;
    }
    if (repair.operation !== "replace" || repair.collection !== "referralTeleconsultations" || repair.field !== "collaborationOrderId") {
      throw new Error(`unsupported closure repair ${repair.id || "unknown"}`);
    }
    const item = teleconsultations.find((row) => row.id === repair.entityId);
    if (!item) throw new Error(`repair target ${repair.entityId} not found`);
    if (item.collaborationOrderId !== repair.from) throw new Error(`repair precondition failed for ${repair.entityId}: current collaborationOrderId changed`);
    if (item.referralId !== repair.preconditions?.referralId || item.residentId !== repair.preconditions?.residentId) {
      throw new Error(`repair precondition failed for ${repair.entityId}: referral or resident scope changed`);
    }
    const referral = referrals.get(item.referralId);
    const authoritativeOrder = collaborationOrders.get(repair.to);
    if (!referral || referral.collaborationOrderId !== repair.to) throw new Error(`repair authority failed for ${repair.entityId}: referral no longer points to ${repair.to}`);
    if (!authoritativeOrder || authoritativeOrder.residentId !== item.residentId) throw new Error(`repair authority failed for ${repair.entityId}: target collaboration order resident mismatch`);
    item.collaborationOrderId = repair.to;
    applied.push({
      repairId: repair.id,
      entityId: item.id,
      field: repair.field,
      from: repair.from,
      to: repair.to,
      persisted: false
    });
  });

  next.referralTeleconsultations = teleconsultations;
  return {
    data: next,
    applied,
    consistency: validateClosureReferences(next),
    persistenceMutation: false
  };
}

module.exports = {
  APPOINTMENT_CALLBACK_EVENTS,
  UNIFIED_PHASES,
  classifyMessageReceipt,
  messageMatchesCase,
  normalizeChronicFollowupCase,
  normalizeDomainCase,
  normalizeFamilyDoctorCase,
  normalizePrimaryCareCase,
  normalizeReferralCase,
  normalizeRegistrationCase,
  applyClosureReferenceRepairs,
  planClosureReferenceRepairs,
  summarizeNotificationReceipts,
  validateClosureReferences,
  validateRegistrationCallbackTransition
};
