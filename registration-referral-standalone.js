"use strict";

const { createHash } = require("node:crypto");

const {
  normalizeChronicFollowupCase,
  normalizeFamilyDoctorCase,
  normalizeFamilyDoctorServiceDisputeCase,
  normalizePrimaryCareCase,
  normalizeReferralCase,
  normalizeRegistrationCase
} = require("./registration-referral-domain");

const STANDALONE_COMMAND_CONTRACTS = Object.freeze([
  { action: "reject-referral-request", roles: ["institution", "commission"], requiredFields: ["caseId", "payload.reason", "payload.note"], suggestedEndpoint: "POST /api/registration-referral/commands/reject-referral-request" },
  { action: "withdraw-referral", roles: ["citizen", "institution", "commission"], requiredFields: ["caseId", "payload.reason", "payload.note"], suggestedEndpoint: "POST /api/registration-referral/commands/withdraw-referral" },
  { action: "reassign-referral", roles: ["institution", "commission"], requiredFields: ["caseId", "payload.targetInstitution", "payload.targetInstitutionCode", "payload.residentAuthorizationId", "payload.note"], suggestedEndpoint: "POST /api/registration-referral/commands/reassign-referral" },
  { action: "reschedule-teleconsultation", roles: ["institution", "commission"], requiredFields: ["caseId", "payload.meetingWindow", "payload.reason", "payload.note"], suggestedEndpoint: "POST /api/registration-referral/commands/reschedule-teleconsultation" },
  { action: "cancel-teleconsultation", roles: ["citizen", "institution", "commission"], requiredFields: ["caseId", "payload.reason", "payload.note"], suggestedEndpoint: "POST /api/registration-referral/commands/cancel-teleconsultation" },
  { action: "record-teleconsultation-no-show", roles: ["institution", "commission"], requiredFields: ["caseId", "payload.party", "payload.note"], suggestedEndpoint: "POST /api/registration-referral/commands/record-teleconsultation-no-show" },
  { action: "attach-referral-materials", roles: ["institution", "commission"], requiredFields: ["caseId", "payload.materials", "payload.note"], suggestedEndpoint: "POST /api/registration-referral/commands/attach-referral-materials" },
  { action: "grant-referral-authorization", roles: ["citizen", "commission"], requiredFields: ["residentId", "payload.scope", "payload.authorizedTo", "payload.dataScopes", "payload.expiresAt", "payload.note"], suggestedEndpoint: "POST /api/registration-referral/commands/grant-referral-authorization" },
  { action: "revoke-referral-authorization", roles: ["citizen", "commission"], requiredFields: ["payload.authorizationId", "payload.reason", "payload.note"], suggestedEndpoint: "POST /api/registration-referral/commands/revoke-referral-authorization" },
  { action: "resume-referral-authorization", roles: ["institution", "commission"], requiredFields: ["caseId", "payload.authorizationId", "payload.note"], suggestedEndpoint: "POST /api/registration-referral/commands/resume-referral-authorization" },
  { action: "run-closure-sla", roles: ["institution", "county", "commission"], requiredFields: ["payload.note"], suggestedEndpoint: "POST /api/registration-referral/commands/run-closure-sla" },
  { action: "acknowledge-escalation", roles: ["institution", "county", "commission"], requiredFields: ["caseId", "payload.status", "payload.note"], suggestedEndpoint: "POST /api/registration-referral/commands/acknowledge-escalation" },
  { action: "record-notification-provider-result", roles: ["institution", "county", "commission"], requiredFields: ["payload.messageId", "payload.status", "payload.providerMessageId"], suggestedEndpoint: "POST /api/registration-referral/commands/record-notification-provider-result" },
  { action: "resolve-notification-dead-letter", roles: ["institution", "commission"], requiredFields: ["caseId", "payload.resolution", "payload.note"], suggestedEndpoint: "POST /api/registration-referral/commands/resolve-notification-dead-letter" },
  { action: "submit-family-doctor-application", roles: ["citizen", "commission"], requiredFields: ["residentId", "payload.teamId", "payload.packageId", "payload.consentStatus"], suggestedEndpoint: "POST /api/registration-referral/commands/submit-family-doctor-application" },
  { action: "review-family-doctor-application", roles: ["institution", "commission"], requiredFields: ["caseId", "payload.decision", "payload.note"], suggestedEndpoint: "POST /api/registration-referral/commands/review-family-doctor-application" },
  { action: "activate-family-doctor-contract", roles: ["institution", "commission"], requiredFields: ["caseId", "payload.startDate", "payload.endDate", "payload.note"], suggestedEndpoint: "POST /api/registration-referral/commands/activate-family-doctor-contract" },
  { action: "record-family-doctor-fulfillment", roles: ["institution", "commission"], requiredFields: ["caseId", "payload.serviceType", "payload.serviceItem", "payload.serviceDate", "payload.evidenceCollection", "payload.evidenceId", "payload.note"], suggestedEndpoint: "POST /api/registration-referral/commands/record-family-doctor-fulfillment" },
  { action: "request-family-doctor-renewal", roles: ["citizen", "commission"], requiredFields: ["caseId", "payload.desiredStartDate", "payload.note"], suggestedEndpoint: "POST /api/registration-referral/commands/request-family-doctor-renewal" },
  { action: "review-family-doctor-renewal", roles: ["institution", "commission"], requiredFields: ["caseId", "payload.decision", "payload.note"], suggestedEndpoint: "POST /api/registration-referral/commands/review-family-doctor-renewal" },
  { action: "request-family-doctor-transfer", roles: ["citizen", "commission"], requiredFields: ["caseId", "payload.teamId", "payload.packageId", "payload.reason", "payload.note"], suggestedEndpoint: "POST /api/registration-referral/commands/request-family-doctor-transfer" },
  { action: "review-family-doctor-transfer", roles: ["institution", "commission"], requiredFields: ["caseId", "payload.decision", "payload.note"], suggestedEndpoint: "POST /api/registration-referral/commands/review-family-doctor-transfer" },
  { action: "raise-family-doctor-service-dispute", roles: ["citizen", "commission"], requiredFields: ["caseId", "payload.fulfillmentId", "payload.category", "payload.description", "payload.requestedResolution", "payload.note"], suggestedEndpoint: "POST /api/registration-referral/commands/raise-family-doctor-service-dispute" },
  { action: "respond-family-doctor-service-dispute", roles: ["institution", "commission"], requiredFields: ["caseId", "payload.resolution", "payload.note"], suggestedEndpoint: "POST /api/registration-referral/commands/respond-family-doctor-service-dispute" },
  { action: "acknowledge-family-doctor-service-dispute", roles: ["citizen", "commission"], requiredFields: ["caseId", "payload.decision", "payload.note"], suggestedEndpoint: "POST /api/registration-referral/commands/acknowledge-family-doctor-service-dispute" },
  { action: "terminate-family-doctor-contract", roles: ["citizen", "institution", "commission"], requiredFields: ["caseId", "payload.reason", "payload.note"], suggestedEndpoint: "POST /api/registration-referral/commands/terminate-family-doctor-contract" }
]);

const TERMINAL_REFERRAL_STATUSES = new Set(["cancelled", "closed", "report-returned", "withdrawn"]);
const PROVIDER_STATUSES = new Set(["accepted", "bounced", "delivered", "failed", "rejected", "sent", "undeliverable"]);
const PROVIDER_FAILURE_STATUSES = new Set(["bounced", "failed", "rejected", "undeliverable"]);
const REFERRAL_CONSENT_SCOPES = new Set(["referral", "teleconsultation", "referral-teleconsultation", "referral-and-teleconsultation"]);
const REFERRAL_DATA_SCOPES = new Set(["demographics", "clinical-summary", "medications", "labs", "imaging-references", "referral-report", "followup-plan"]);

function rows(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value || "").trim();
}

function requireText(value, field) {
  const result = text(value);
  if (!result) throw new Error(`${field} is required`);
  return result;
}

function actorName(actor = {}) {
  return text(actor.name || actor.username || actor.role || "unknown");
}

function residentIds(actor = {}) {
  return new Set([actor.residentId, ...rows(actor.residentIds)].map(text).filter(Boolean));
}

function requireInstitution(actor, institutionCode) {
  if (actor.role === "commission") return;
  if (actor.role !== "institution") throw new Error("institution or commission role is required");
  if (!text(actor.orgCode)) throw new Error("institution actor orgCode is required");
  if (!text(institutionCode)) throw new Error("institution target orgCode is required");
  if (text(actor.orgCode) !== text(institutionCode)) throw new Error("institution scope denied");
}

function requireOneInstitution(actor, institutionCodes) {
  if (actor.role === "commission") return;
  if (actor.role !== "institution" || !text(actor.orgCode)) throw new Error("institution actor orgCode is required");
  if (!institutionCodes.map(text).filter(Boolean).includes(text(actor.orgCode))) throw new Error("institution scope denied");
}

function requireResident(actor, residentId) {
  if (actor.role === "commission") return;
  if (actor.role !== "citizen" || !residentIds(actor).has(text(residentId))) throw new Error("resident scope denied");
}

function appendById(items, item, limit = 300) {
  return [item, ...rows(items).filter((row) => row.id !== item.id)].slice(0, limit);
}

function appendMessage(data, command, actor, fields) {
  const notificationKey = fields.notificationKey || `registration-referral:${command.action}:${fields.sourceId}:${fields.targetRole}`;
  const existing = rows(data.taskMessages).find((item) => item.notificationKey === notificationKey);
  if (existing) return existing;
  const message = {
    id: fields.id || `msg-${command.commandId}-${fields.suffix || fields.targetRole}`,
    taskId: `${fields.collection}:${fields.sourceId}`,
    collection: fields.collection,
    sourceId: fields.sourceId,
    residentId: fields.residentId || "",
    targetRole: fields.targetRole,
    targetOrgCode: fields.targetOrgCode || "",
    channel: fields.channel || "in_app",
    deliveryChannels: fields.deliveryChannels || [fields.channel || "in_app"],
    title: fields.title,
    body: fields.body,
    status: fields.status || "sent",
    receipts: rows(fields.receipts),
    notificationKey,
    createdAt: command.at,
    createdBy: text(actor.username || actor.role),
    createdByName: actorName(actor),
    productionEvidence: false
  };
  data.taskMessages = appendById(data.taskMessages, message);
  return message;
}

function referralRecord(data, caseId) {
  const teleconsultation = rows(data.referralTeleconsultations).find((item) => item.id === caseId);
  if (teleconsultation) return { item: teleconsultation, kind: "teleconsultation" };
  const referral = rows(data.referralSystem?.referrals).find((item) => item.id === caseId);
  return referral ? { item: referral, kind: "referral" } : null;
}

function sourceOrg(item) {
  return text(item.sourceInstitutionCode || item.fromInstitutionCode);
}

function targetOrg(item) {
  return text(item.targetInstitutionCode || item.toInstitutionCode);
}

function linkedReferral(data, record) {
  if (record.kind === "referral") return record.item;
  return rows(data.referralSystem?.referrals).find((item) => item.id === record.item.referralId) || null;
}

function linkedOrder(data, item) {
  return rows(data.countyCollaborationOrders).find((row) => row.id === item.collaborationOrderId) || null;
}

function audit(item, command, actor, action, note) {
  item.auditTrail = [{
    at: command.at,
    actor: actorName(actor),
    role: actor.role,
    action,
    note,
    productionEvidence: false
  }, ...rows(item.auditTrail)].slice(0, 50);
}

function syncReferralStatus(data, record, status, fields = {}) {
  const referral = linkedReferral(data, record);
  const order = linkedOrder(data, record.item);
  [record.item, referral].filter(Boolean).forEach((item) => Object.assign(item, fields, { status }));
  if (order) Object.assign(order, fields, { status });
  return { referral, collaborationOrder: order };
}

function notifyReferralParties(data, command, actor, item, stage, title, body, options = {}) {
  const collection = rows(data.referralTeleconsultations).includes(item) ? "referralTeleconsultations" : "referrals";
  const messages = [];
  if (options.citizen !== false) messages.push(appendMessage(data, command, actor, {
    suffix: `${stage}-citizen`,
    collection,
    sourceId: item.id,
    residentId: item.residentId,
    targetRole: "citizen",
    title,
    body,
    notificationKey: `registration-referral:${item.id}:${stage}:citizen`
  }));
  for (const [role, orgCode] of [["source", sourceOrg(item)], ["target", targetOrg(item)]]) {
    if (options[role] === false || !orgCode) continue;
    messages.push(appendMessage(data, command, actor, {
      suffix: `${stage}-${role}`,
      collection,
      sourceId: item.id,
      residentId: item.residentId,
      targetRole: "institution",
      targetOrgCode: orgCode,
      title,
      body,
      notificationKey: `registration-referral:${item.id}:${stage}:${role}:${orgCode}`
    }));
  }
  return messages;
}

function authorizationScopes(authorization) {
  return [authorization.scope, ...rows(authorization.scopes), authorization.meta?.scope, ...rows(authorization.meta?.scopes)]
    .map((item) => text(item).toLowerCase()).filter(Boolean);
}

function activeAuthorization(data, id, residentId, targetInstitutionCode, at, teleconsultation) {
  const acceptedScopes = teleconsultation
    ? new Set(["teleconsultation", "referral-teleconsultation", "referral-and-teleconsultation"])
    : new Set(["referral", "referral-teleconsultation", "referral-and-teleconsultation"]);
  return rows(data.personalRecords).find((item) => {
    if (item.id !== id || item.category !== "authorizations" || item.residentId !== residentId) return false;
    if (!["active", "authorized"].includes(text(item.status).toLowerCase())) return false;
    if (!["active", "authorized"].includes(text(item.meta?.status).toLowerCase())) return false;
    const expires = [item.expiresAt, item.meta?.expiresAt].map(text).filter(Boolean);
    if (expires.some((value) => !Number.isFinite(Date.parse(value)) || Date.parse(value) <= Date.parse(at))) return false;
    if (!authorizationScopes(item).some((scope) => acceptedScopes.has(scope))) return false;
    const targets = [...rows(item.authorizedTo), ...rows(item.meta?.authorizedTo)].map(text);
    return targets.includes(targetInstitutionCode);
  });
}

function rejectReferral(data, command, actor) {
  const record = referralRecord(data, command.caseId);
  if (!record) throw new Error("referral request not found");
  requireInstitution(actor, targetOrg(record.item));
  if (text(record.item.status).toLowerCase() !== "requested") throw new Error("only a requested referral may be rejected");
  const reason = requireText(command.payload.reason, "payload.reason");
  const note = requireText(command.payload.note, "payload.note");
  const linked = syncReferralStatus(data, record, "rejected", {
    rejectedAt: command.at,
    rejectedBy: actorName(actor),
    rejectionReason: reason,
    receivingFeedback: reason
  });
  audit(record.item, command, actor, "referral-rejected", note);
  const messages = notifyReferralParties(data, command, actor, record.item, "rejected", "Referral request rejected", reason, { target: false });
  return { ...linked, teleconsultation: record.kind === "teleconsultation" ? record.item : null, messages };
}

function withdrawReferral(data, command, actor) {
  const record = referralRecord(data, command.caseId);
  if (!record) throw new Error("referral request not found");
  const item = record.item;
  if (actor.role === "citizen") requireResident(actor, item.residentId);
  else if (actor.role === "institution") requireInstitution(actor, sourceOrg(item));
  if (!["requested", "accepted", "rejected"].includes(text(item.status).toLowerCase())) throw new Error("referral cannot be withdrawn after scheduling or report return");
  const reason = requireText(command.payload.reason, "payload.reason");
  const note = requireText(command.payload.note, "payload.note");
  const linked = syncReferralStatus(data, record, "withdrawn", {
    withdrawnAt: command.at,
    withdrawnBy: actorName(actor),
    withdrawalReason: reason
  });
  audit(item, command, actor, "referral-withdrawn", note);
  const messages = notifyReferralParties(data, command, actor, item, "withdrawn", "Referral withdrawn", reason);
  return { ...linked, teleconsultation: record.kind === "teleconsultation" ? item : null, messages };
}

function reassignReferral(data, command, actor) {
  const record = referralRecord(data, command.caseId);
  if (!record) throw new Error("referral request not found");
  const item = record.item;
  requireInstitution(actor, sourceOrg(item));
  if (!["requested", "accepted", "rejected", "authorization-on-hold"].includes(text(item.status).toLowerCase())) {
    throw new Error("referral cannot be reassigned after scheduling or report return");
  }
  const newTargetCode = requireText(command.payload.targetInstitutionCode, "payload.targetInstitutionCode");
  const newTarget = requireText(command.payload.targetInstitution, "payload.targetInstitution");
  const authorizationId = requireText(command.payload.residentAuthorizationId, "payload.residentAuthorizationId");
  if (!activeAuthorization(data, authorizationId, item.residentId, newTargetCode, command.at, record.kind === "teleconsultation")) {
    throw new Error("active unexpired resident authorization does not cover reassigned institution");
  }
  const note = requireText(command.payload.note, "payload.note");
  const priorTargetCode = targetOrg(item);
  const history = {
    at: command.at,
    by: actorName(actor),
    fromInstitutionCode: priorTargetCode,
    toInstitutionCode: newTargetCode,
    reason: text(command.payload.reason || note)
  };
  item.reassignmentHistory = [history, ...rows(item.reassignmentHistory)].slice(0, 20);
  item.targetInstitutionCode = newTargetCode;
  item.toInstitutionCode = newTargetCode;
  item.targetInstitution = newTarget;
  item.to = newTarget;
  item.residentAuthorizationId = authorizationId;
  item.authorizationStatus = "authorized";
  item.status = "requested";
  item.receivingFeedback = "";
  item.receivingDoctor = "";
  item.meetingWindow = "";
  item.acceptedAt = "";
  item.scheduledAt = "";
  const referral = linkedReferral(data, record);
  if (referral && referral !== item) {
    referral.toInstitutionCode = newTargetCode;
    referral.to = newTarget;
    referral.residentAuthorizationId = authorizationId;
    referral.status = "requested";
    referral.receivingFeedback = "";
  }
  const order = linkedOrder(data, item);
  if (order) {
    order.toInstitution = newTarget;
    order.status = "requested";
    order.result = "awaiting reassigned institution acceptance";
  }
  audit(item, command, actor, "referral-reassigned", note);
  const oldTargetMessage = priorTargetCode && priorTargetCode !== newTargetCode
    ? appendMessage(data, command, actor, {
      suffix: "reassigned-old-target",
      collection: record.kind === "teleconsultation" ? "referralTeleconsultations" : "referrals",
      sourceId: item.id,
      residentId: item.residentId,
      targetRole: "institution",
      targetOrgCode: priorTargetCode,
      title: "Referral reassigned",
      body: note,
      notificationKey: `registration-referral:${item.id}:reassigned:old:${priorTargetCode}`
    })
    : null;
  const messages = notifyReferralParties(data, command, actor, item, "reassigned", "Referral reassigned", `${newTargetCode}: ${note}`, { source: false });
  if (oldTargetMessage) messages.push(oldTargetMessage);
  return { referral, teleconsultation: record.kind === "teleconsultation" ? item : null, collaborationOrder: order, messages };
}

function rescheduleTeleconsultation(data, command, actor) {
  const record = referralRecord(data, command.caseId);
  if (!record || record.kind !== "teleconsultation") throw new Error("teleconsultation not found");
  const item = record.item;
  requireInstitution(actor, targetOrg(item));
  if (!["scheduled", "no-show"].includes(text(item.status).toLowerCase())) throw new Error("only a scheduled or no-show teleconsultation may be rescheduled");
  const meetingWindow = requireText(command.payload.meetingWindow, "payload.meetingWindow");
  const reason = requireText(command.payload.reason, "payload.reason");
  const note = requireText(command.payload.note, "payload.note");
  item.scheduleHistory = [{
    at: command.at,
    by: actorName(actor),
    priorMeetingWindow: text(item.meetingWindow),
    meetingWindow,
    reason
  }, ...rows(item.scheduleHistory)].slice(0, 20);
  item.meetingWindow = meetingWindow;
  item.receivingDoctor = text(command.payload.receivingDoctor || item.receivingDoctor);
  item.status = "scheduled";
  item.scheduleVersion = Number(item.scheduleVersion || 1) + 1;
  item.rescheduledAt = command.at;
  audit(item, command, actor, "teleconsultation-rescheduled", note);
  const linked = syncReferralStatus(data, record, "scheduled", { meetingWindow });
  const messages = notifyReferralParties(data, command, actor, item, "rescheduled", "Teleconsultation rescheduled", `${meetingWindow}: ${reason}`);
  return { ...linked, teleconsultation: item, messages };
}

function cancelTeleconsultation(data, command, actor) {
  const record = referralRecord(data, command.caseId);
  if (!record || record.kind !== "teleconsultation") throw new Error("teleconsultation not found");
  const item = record.item;
  if (actor.role === "citizen") requireResident(actor, item.residentId);
  else if (actor.role === "institution") requireOneInstitution(actor, [sourceOrg(item), targetOrg(item)]);
  if (TERMINAL_REFERRAL_STATUSES.has(text(item.status).toLowerCase()) || item.reportStatus === "returned") {
    throw new Error("terminal teleconsultation cannot be cancelled");
  }
  const reason = requireText(command.payload.reason, "payload.reason");
  const note = requireText(command.payload.note, "payload.note");
  const linked = syncReferralStatus(data, record, "cancelled", {
    cancelledAt: command.at,
    cancelledBy: actorName(actor),
    cancellationReason: reason
  });
  audit(item, command, actor, "teleconsultation-cancelled", note);
  const messages = notifyReferralParties(data, command, actor, item, "cancelled", "Teleconsultation cancelled", reason);
  return { ...linked, teleconsultation: item, messages };
}

function recordNoShow(data, command, actor) {
  const record = referralRecord(data, command.caseId);
  if (!record || record.kind !== "teleconsultation") throw new Error("teleconsultation not found");
  const item = record.item;
  requireInstitution(actor, targetOrg(item));
  if (text(item.status).toLowerCase() !== "scheduled") throw new Error("only a scheduled teleconsultation may record no-show");
  const party = requireText(command.payload.party, "payload.party").toLowerCase();
  if (!["resident", "specialist", "source-institution"].includes(party)) throw new Error("unsupported no-show party");
  const note = requireText(command.payload.note, "payload.note");
  item.status = "no-show";
  item.noShow = { party, at: command.at, recordedBy: actorName(actor), note };
  audit(item, command, actor, "teleconsultation-no-show", note);
  const linked = syncReferralStatus(data, record, "no-show");
  const messages = notifyReferralParties(data, command, actor, item, "no-show", "Teleconsultation no-show recorded", `${party}: ${note}`);
  return { ...linked, teleconsultation: item, messages };
}

function normalizeMaterial(material, index) {
  const id = requireText(material.id, `payload.materials[${index}].id`);
  const name = requireText(material.name, `payload.materials[${index}].name`);
  const type = requireText(material.type, `payload.materials[${index}].type`);
  const digest = requireText(material.digest, `payload.materials[${index}].digest`).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error(`payload.materials[${index}].digest must be sha256`);
  const version = Number(material.version || 1);
  if (!Number.isInteger(version) || version < 1) throw new Error(`payload.materials[${index}].version must be a positive integer`);
  return { id, name, type, digest, version, sourceSystem: text(material.sourceSystem), recordId: text(material.recordId) };
}

function attachReferralMaterials(data, command, actor) {
  const record = referralRecord(data, command.caseId);
  if (!record) throw new Error("referral request not found");
  requireInstitution(actor, sourceOrg(record.item));
  if (TERMINAL_REFERRAL_STATUSES.has(text(record.item.status).toLowerCase())) throw new Error("terminal referral materials cannot be changed");
  const supplied = rows(command.payload.materials);
  if (!supplied.length) throw new Error("payload.materials must contain at least one item");
  if (supplied.length > 50) throw new Error("payload.materials cannot contain more than 50 items per command");
  const materials = supplied.map(normalizeMaterial);
  const legacyMaterials = rows(record.item.materials).filter((item) => typeof item === "string").map(text).filter(Boolean);
  const merged = new Map(rows(record.item.materials).filter((item) => item && typeof item === "object" && item.id).map((item) => [item.id, item]));
  materials.forEach((item) => {
    const prior = merged.get(item.id);
    if (prior && Number(prior.version || 1) >= item.version && prior.digest !== item.digest) {
      throw new Error(`material ${item.id} version must increase when content changes`);
    }
    merged.set(item.id, item);
  });
  if (merged.size > 100) throw new Error("referral material manifest cannot contain more than 100 versioned items");
  record.item.materials = [...merged.values()].sort((a, b) => a.id.localeCompare(b.id));
  if (legacyMaterials.length) record.item.legacyMaterialNames = [...new Set([...rows(record.item.legacyMaterialNames), ...legacyMaterials])];
  record.item.materialManifestDigest = createHash("sha256")
    .update(JSON.stringify(record.item.materials.map((item) => ({ id: item.id, version: item.version, digest: item.digest }))))
    .digest("hex");
  record.item.materialsUpdatedAt = command.at;
  audit(record.item, command, actor, "referral-materials-attached", requireText(command.payload.note, "payload.note"));
  const referral = linkedReferral(data, record);
  if (referral && referral !== record.item) {
    referral.materials = record.item.materials;
    referral.materialManifestDigest = record.item.materialManifestDigest;
  }
  return { referral, teleconsultation: record.kind === "teleconsultation" ? record.item : null, materials: record.item.materials, manifestDigest: record.item.materialManifestDigest };
}

function grantAuthorization(data, command, actor) {
  const residentId = requireText(command.residentId || command.payload.residentId, "residentId");
  requireResident(actor, residentId);
  const scope = requireText(command.payload.scope, "payload.scope").toLowerCase();
  if (!REFERRAL_CONSENT_SCOPES.has(scope)) throw new Error("unsupported referral authorization scope");
  const authorizedTo = [...new Set(rows(command.payload.authorizedTo).map(text).filter(Boolean))];
  if (!authorizedTo.length || authorizedTo.length > 20) throw new Error("payload.authorizedTo must contain between 1 and 20 institution codes");
  const dataScopes = [...new Set(rows(command.payload.dataScopes).map((item) => text(item).toLowerCase()).filter(Boolean))];
  if (!dataScopes.length || dataScopes.some((item) => !REFERRAL_DATA_SCOPES.has(item))) throw new Error("payload.dataScopes contains an unsupported referral data scope");
  if (!dataScopes.includes("clinical-summary") || !dataScopes.includes("referral-report")) {
    throw new Error("referral authorization requires clinical-summary and referral-report data scopes");
  }
  const expiresAt = requireText(command.payload.expiresAt, "payload.expiresAt");
  if (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.parse(command.at)) {
    throw new Error("referral authorization expiresAt must be after the command timestamp");
  }
  const consentActor = text(command.payload.consentActor || "resident").toLowerCase();
  if (!["resident", "guardian"].includes(consentActor)) throw new Error("referral authorization consentActor must be resident or guardian");
  if (consentActor === "guardian" && !text(command.payload.guardianProofId)) throw new Error("guardianProofId is required for guardian authorization");
  const authorization = {
    id: text(command.payload.authorizationId || `auth-${command.commandId}`),
    residentId,
    category: "authorizations",
    type: "authorization",
    name: "Referral authorization",
    status: "active",
    scope,
    scopes: [scope],
    authorizedTo,
    dataScopes,
    expiresAt,
    consentActor,
    guardianProofId: text(command.payload.guardianProofId),
    guardianRelationship: text(command.payload.guardianRelationship),
    note: requireText(command.payload.note, "payload.note"),
    createdAt: command.at,
    createdBy: actorName(actor),
    workflowVersion: 1,
    productionEvidence: false,
    meta: {
      status: "active",
      scope,
      authorizedTo,
      dataScopes,
      expiresAt,
      consentActor,
      guardianProofId: text(command.payload.guardianProofId)
    }
  };
  if (rows(data.personalRecords).some((item) => item.id === authorization.id)) throw new Error("referral authorization id already exists");
  data.personalRecords = appendById(data.personalRecords, authorization, 500);
  return { authorization };
}

function revokeAuthorization(data, command, actor) {
  const authorizationId = requireText(command.payload.authorizationId, "payload.authorizationId");
  const authorization = rows(data.personalRecords).find((item) => item.id === authorizationId && item.category === "authorizations");
  if (!authorization) throw new Error("referral authorization not found");
  requireResident(actor, authorization.residentId);
  if (["revoked", "expired"].includes(text(authorization.status).toLowerCase())) throw new Error("referral authorization is already inactive");
  const reason = requireText(command.payload.reason, "payload.reason");
  authorization.status = "revoked";
  authorization.revokedAt = command.at;
  authorization.revokedBy = actorName(actor);
  authorization.revocationReason = reason;
  authorization.meta = { ...(authorization.meta || {}), status: "revoked", revokedAt: command.at, revocationReason: reason };
  const affected = [
    ...rows(data.referralTeleconsultations),
    ...rows(data.referralSystem?.referrals)
  ].filter((item) => item.residentAuthorizationId === authorizationId && !TERMINAL_REFERRAL_STATUSES.has(text(item.status).toLowerCase()));
  const seen = new Set();
  const messages = [];
  affected.forEach((item) => {
    item.authorizationStatus = "revoked";
    item.statusBeforeAuthorizationHold = item.status;
    item.status = "authorization-on-hold";
    item.authorizationHoldAt = command.at;
    if (seen.has(item.id)) return;
    seen.add(item.id);
    messages.push(...notifyReferralParties(data, command, actor, item, "authorization-revoked", "Referral authorization revoked", reason, { citizen: false }));
  });
  return { authorization, affectedCaseIds: [...seen], messages };
}

function resumeReferralAuthorization(data, command, actor) {
  const record = referralRecord(data, command.caseId);
  if (!record) throw new Error("referral request not found");
  const item = record.item;
  requireInstitution(actor, sourceOrg(item));
  if (text(item.status).toLowerCase() !== "authorization-on-hold") throw new Error("referral is not on authorization hold");
  const authorizationId = requireText(command.payload.authorizationId, "payload.authorizationId");
  if (!activeAuthorization(data, authorizationId, item.residentId, targetOrg(item), command.at, record.kind === "teleconsultation")) {
    throw new Error("active unexpired resident authorization does not cover held referral");
  }
  const note = requireText(command.payload.note, "payload.note");
  const restoredStatus = ["requested", "accepted", "scheduled", "no-show"].includes(text(item.statusBeforeAuthorizationHold).toLowerCase())
    ? text(item.statusBeforeAuthorizationHold).toLowerCase()
    : "requested";
  const linked = syncReferralStatus(data, record, restoredStatus, {
    residentAuthorizationId: authorizationId,
    authorizationStatus: "authorized",
    authorizationResumedAt: command.at,
    authorizationResumedBy: actorName(actor)
  });
  audit(item, command, actor, "referral-authorization-resumed", note);
  const messages = notifyReferralParties(data, command, actor, item, "authorization-resumed", "Referral authorization restored", note);
  return { ...linked, teleconsultation: record.kind === "teleconsultation" ? item : null, messages };
}

function normalizeFamilyServiceTask(item) {
  const status = text(item.status).toLowerCase();
  const terminal = ["completed", "cancelled"].includes(status);
  return {
    caseType: "family-doctor-service-task",
    caseId: item.id,
    residentId: item.residentId,
    businessStatus: item.status,
    unifiedPhase: terminal ? "closed" : status === "overdue" ? "exception" : status === "scheduled" ? "scheduled" : "requested",
    sourceOrg: item.institutionCode,
    responsibleOrg: terminal ? "" : item.institutionCode,
    responsibleRole: terminal ? "" : item.kind === "renewal-reminder" ? "institution-review" : "family-doctor-team",
    dueAt: item.dueAt || item.plannedAt,
    nextAction: terminal ? "none" : item.kind === "renewal-reminder" ? "review contract renewal" : "complete contracted family doctor service",
    notificationState: "",
    receiptState: "",
    exceptionState: status === "overdue" ? "family-doctor-service-overdue" : "none",
    upstreamRefs: [item.contractId].filter(Boolean),
    downstreamRefs: [item.fulfillmentId].filter(Boolean),
    productionEvidence: false
  };
}

function allCaseEnvelopes(data) {
  const messages = data.taskMessages || [];
  return [
    ...rows(data.registrationOrders).map((item) => normalizeRegistrationCase(item, { messages })),
    ...rows(data.primaryCareAssessments).map((item) => normalizePrimaryCareCase(item, { messages })),
    ...rows(data.referralTeleconsultations).map((item) => normalizeReferralCase(item, { messages })),
    ...rows(data.referralSystem?.referrals)
      .filter((item) => !rows(data.referralTeleconsultations).some((tele) => tele.referralId === item.id))
      .map((item) => normalizeReferralCase(item, { messages })),
    ...rows(data.phase2FamilyDoctorApplications).map((item) => normalizeFamilyDoctorCase(item, { messages, fulfillments: data.phase2FamilyDoctorFulfillments })),
    ...rows(data.phase2FamilyDoctorContracts).map((item) => normalizeFamilyDoctorCase(item, { messages, fulfillments: data.phase2FamilyDoctorFulfillments })),
    ...rows(data.followups).map((item) => normalizeChronicFollowupCase(item, { messages })),
    ...rows(data.phase2FamilyDoctorServiceTasks).map(normalizeFamilyServiceTask),
    ...rows(data.phase2FamilyDoctorServiceDisputes).map((item) => normalizeFamilyDoctorServiceDisputeCase(item, { messages }))
  ];
}

function buildClosureWorkQueue(data = {}, options = {}) {
  const asOf = text(options.asOf || new Date().toISOString());
  const asOfMs = Date.parse(asOf);
  if (!Number.isFinite(asOfMs)) throw new Error("asOf must be an ISO-compatible timestamp");
  const actor = options.actor || { role: "commission" };
  const terminal = new Set(["closed", "cancelled"]);
  return allCaseEnvelopes(data)
    .filter((item) => item.caseId && !terminal.has(item.unifiedPhase))
    .filter((item) => {
      if (actor.role === "commission") return true;
      if (actor.role === "citizen") return residentIds(actor).has(item.residentId);
      if (actor.role === "institution") return Boolean(actor.orgCode && item.responsibleOrg === actor.orgCode);
      if (actor.role === "county") return item.caseType === "referral-teleconsultation" || item.unifiedPhase === "exception";
      return false;
    })
    .map((item) => {
      const dueMs = Date.parse(item.dueAt || "");
      const overdueHours = Number.isFinite(dueMs) ? Math.max(0, Math.round((asOfMs - dueMs) / 36_000) / 100) : 0;
      return {
        ...item,
        overdue: Number.isFinite(dueMs) && dueMs < asOfMs,
        overdueHours,
        priority: item.unifiedPhase === "exception" || overdueHours >= 24 ? "high" : overdueHours > 0 ? "medium" : "normal"
      };
    })
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || b.overdueHours - a.overdueHours || text(a.dueAt).localeCompare(text(b.dueAt)));
}

function runClosureSla(data, command, actor) {
  const note = requireText(command.payload.note, "payload.note");
  if (actor.role === "institution" && !text(actor.orgCode)) throw new Error("institution actor orgCode is required");
  const queue = buildClosureWorkQueue(data, { asOf: command.at, actor });
  const overdue = queue.filter((item) => item.overdue);
  const created = [];
  const skipped = [];
  overdue.forEach((item) => {
    const slaKey = `${item.caseType}:${item.caseId}:${item.dueAt}`;
    const existing = rows(data.registrationReferralEscalations).find((row) => row.slaKey === slaKey && !["resolved", "closed"].includes(row.status));
    if (existing) {
      skipped.push(existing.id);
      return;
    }
    const escalation = {
      id: `sla-${command.commandId}-${created.length + 1}`,
      slaKey,
      caseType: item.caseType,
      caseId: item.caseId,
      residentId: item.residentId,
      severity: item.priority,
      status: "open",
      reason: note,
      responsibleOrg: item.responsibleOrg,
      responsibleRole: item.responsibleRole,
      dueAt: item.dueAt,
      overdueHours: item.overdueHours,
      createdAt: command.at,
      createdBy: actorName(actor),
      createdByRole: actor.role,
      productionEvidence: false
    };
    data.registrationReferralEscalations = appendById(data.registrationReferralEscalations, escalation);
    appendMessage(data, command, actor, {
      suffix: `sla-${created.length + 1}`,
      collection: "registrationReferralEscalations",
      sourceId: escalation.id,
      residentId: item.residentId,
      targetRole: item.responsibleRole,
      targetOrgCode: item.responsibleOrg,
      title: `SLA overdue: ${item.caseType}/${item.caseId}`,
      body: `${item.overdueHours} hours overdue. ${note}`,
      notificationKey: `registration-referral:sla:${slaKey}`
    });
    created.push(escalation);
  });
  return { queue, overdue: overdue.length, created, skipped };
}

function acknowledgeEscalation(data, command, actor) {
  const escalation = rows(data.registrationReferralEscalations).find((item) => item.id === command.caseId);
  if (!escalation) throw new Error("escalation not found");
  if (actor.role === "institution") requireInstitution(actor, escalation.responsibleOrg);
  const status = requireText(command.payload.status, "payload.status").toLowerCase();
  if (!["acknowledged", "resolved"].includes(status)) throw new Error("escalation status must be acknowledged or resolved");
  if (["resolved", "closed"].includes(escalation.status)) throw new Error("escalation is already resolved");
  const note = requireText(command.payload.note, "payload.note");
  if (actor.role === "county" && status === "resolved" && escalation.responsibleOrg) throw new Error("county supervision cannot resolve an institution responsibility");
  escalation.status = status;
  escalation.acknowledgedAt = command.at;
  escalation.acknowledgedBy = actorName(actor);
  escalation.acknowledgementNote = note;
  if (status === "resolved") escalation.resolvedAt = command.at;
  rows(data.taskMessages).filter((item) => item.sourceId === escalation.id).forEach((message) => {
    message.status = status === "resolved" ? "handled" : "acknowledged";
    message.receipts = [{
      at: command.at,
      by: text(actor.username || actor.role),
      byName: actorName(actor),
      role: actor.role,
      status: message.status,
      note,
      productionEvidence: false
    }, ...rows(message.receipts)].slice(0, 20);
  });
  return { escalation };
}

function canOperateMessage(actor, message) {
  if (actor.role === "commission") return true;
  if (actor.role === "institution") return Boolean(actor.orgCode && message.targetOrgCode && actor.orgCode === message.targetOrgCode);
  if (actor.role === "county") return ["referralTeleconsultations", "registrationReferralEscalations"].includes(message.collection);
  return false;
}

function providerResult(data, command, actor) {
  const messageId = requireText(command.payload.messageId, "payload.messageId");
  const message = rows(data.taskMessages).find((item) => item.id === messageId);
  if (!message) throw new Error("notification message not found");
  if (!canOperateMessage(actor, message)) throw new Error("notification provider scope denied");
  const status = requireText(command.payload.status, "payload.status").toLowerCase();
  if (!PROVIDER_STATUSES.has(status)) throw new Error("unsupported notification provider status");
  const providerMessageId = requireText(command.payload.providerMessageId, "payload.providerMessageId");
  if (rows(message.providerReceipts).some((item) => item.providerMessageId === providerMessageId && item.status === status)) {
    throw new Error("notification provider result is already recorded");
  }
  const receipt = {
    at: command.at,
    provider: text(command.payload.provider || "unspecified"),
    providerMessageId,
    channel: text(command.payload.channel || message.channel || "in_app"),
    status,
    errorCode: text(command.payload.errorCode),
    note: text(command.payload.note),
    productionEvidence: false
  };
  message.providerReceipts = [receipt, ...rows(message.providerReceipts)].slice(0, 50);
  message.providerStatus = status;
  message.updatedAt = command.at;
  if (["accepted", "delivered", "sent"].includes(status)) message.status = status;
  const failures = message.providerReceipts.filter((item) => PROVIDER_FAILURE_STATUSES.has(item.status)).length;
  const maxAttempts = Math.max(1, Number(command.payload.maxAttempts || 3));
  let deadLetter = null;
  if (PROVIDER_FAILURE_STATUSES.has(status) && failures >= maxAttempts) {
    deadLetter = {
      id: `dead-${message.id}`,
      messageId: message.id,
      residentId: message.residentId,
      targetRole: message.targetRole,
      targetOrgCode: message.targetOrgCode,
      status: "open",
      failures,
      lastErrorCode: receipt.errorCode,
      openedAt: command.at,
      productionEvidence: false
    };
    data.registrationReferralNotificationDeadLetters = appendById(data.registrationReferralNotificationDeadLetters, deadLetter);
    message.deadLetterStatus = "open";
    message.status = "failed";
  }
  return { message, receipt, deadLetter };
}

function resolveDeadLetter(data, command, actor) {
  const deadLetter = rows(data.registrationReferralNotificationDeadLetters).find((item) => item.id === command.caseId);
  if (!deadLetter) throw new Error("notification dead letter not found");
  requireInstitution(actor, deadLetter.targetOrgCode);
  if (deadLetter.status === "resolved") throw new Error("notification dead letter is already resolved");
  const resolution = requireText(command.payload.resolution, "payload.resolution").toLowerCase();
  if (!["manual-contact", "retry", "suppress"].includes(resolution)) throw new Error("unsupported dead-letter resolution");
  const note = requireText(command.payload.note, "payload.note");
  deadLetter.status = "resolved";
  deadLetter.resolution = resolution;
  deadLetter.resolutionNote = note;
  deadLetter.resolvedAt = command.at;
  deadLetter.resolvedBy = actorName(actor);
  const message = rows(data.taskMessages).find((item) => item.id === deadLetter.messageId);
  if (message) {
    message.deadLetterStatus = "resolved";
    if (resolution === "retry") {
      message.status = "sent";
      message.providerStatus = "retry-requested";
    } else if (resolution === "manual-contact") {
      message.status = "handled";
    } else {
      message.status = "suppressed";
    }
  }
  return { deadLetter, message };
}

function teamFor(data, teamId) {
  return rows(data.phase2FamilyDoctorTeams).find((item) => item.id === teamId);
}

function packageFor(data, packageId) {
  return rows(data.phase2FamilyDoctorServicePackages).find((item) => item.id === packageId);
}

function familyMessage(data, command, actor, source, targetRole, targetOrgCode, title, body, stage) {
  return appendMessage(data, command, actor, {
    suffix: `${stage}-${targetRole}`,
    collection: source.id.startsWith("p2fdf")
      ? "phase2FamilyDoctorFulfillments"
      : source.id.startsWith("p2fdc")
        ? "phase2FamilyDoctorContracts"
        : source.id.startsWith("p2fdd")
          ? "phase2FamilyDoctorServiceDisputes"
          : "phase2FamilyDoctorApplications",
    sourceId: source.id,
    residentId: source.residentId,
    targetRole,
    targetOrgCode,
    title,
    body,
    notificationKey: `registration-referral:family-doctor:${source.id}:${stage}:${targetRole}`
  });
}

function submitFamilyApplication(data, command, actor) {
  const residentId = requireText(command.residentId || command.payload.residentId, "residentId");
  requireResident(actor, residentId);
  const team = teamFor(data, requireText(command.payload.teamId, "payload.teamId"));
  const servicePackage = packageFor(data, requireText(command.payload.packageId, "payload.packageId"));
  if (!team || team.status !== "active") throw new Error("active family doctor team not found");
  if (!servicePackage || servicePackage.status !== "active") throw new Error("active family doctor package not found");
  if (rows(servicePackage.availableInstitutionCodes).length && !servicePackage.availableInstitutionCodes.includes(team.institutionCode)) {
    throw new Error("family doctor package is unavailable for selected team");
  }
  if (!["resident-confirmed", "signed", "guardian-confirmed"].includes(text(command.payload.consentStatus).toLowerCase())) {
    throw new Error("active resident consent is required");
  }
  const duplicate = rows(data.phase2FamilyDoctorApplications).find((item) =>
    item.residentId === residentId && item.teamId === team.id && item.packageId === servicePackage.id
    && !["rejected", "cancelled", "contracted"].includes(text(item.status).toLowerCase()));
  if (duplicate) throw new Error("open family doctor application already exists");
  const application = {
    id: text(command.payload.applicationId || `p2fda-${command.commandId}`),
    residentId,
    residentName: text(command.payload.residentName),
    packageId: servicePackage.id,
    teamId: team.id,
    templateId: servicePackage.templateId,
    applicationType: "new-contract",
    diseaseTags: rows(command.payload.diseaseTags).map(text).filter(Boolean),
    submittedAt: command.at,
    status: "submitted",
    reviewStatus: "pending",
    reviewInstitutionCode: team.institutionCode,
    reviewer: "",
    consentStatus: text(command.payload.consentStatus),
    desiredStartDate: requireText(command.payload.desiredStartDate, "payload.desiredStartDate"),
    reviewDueAt: text(command.payload.reviewDueAt),
    lastAction: text(command.payload.note || "Resident submitted family doctor application."),
    workflowVersion: 1,
    productionEvidence: false
  };
  data.phase2FamilyDoctorApplications = appendById(data.phase2FamilyDoctorApplications, application);
  const message = familyMessage(data, command, actor, application, "institution", team.institutionCode, "Family doctor application awaiting review", application.lastAction, "submitted");
  return { application, message };
}

function reviewFamilyApplication(data, command, actor) {
  const application = rows(data.phase2FamilyDoctorApplications).find((item) => item.id === command.caseId);
  if (!application) throw new Error("family doctor application not found");
  requireInstitution(actor, application.reviewInstitutionCode);
  if (application.applicationType === "renewal") throw new Error("renewal application requires review-family-doctor-renewal");
  if (application.reviewStatus !== "pending") throw new Error("family doctor application is not pending review");
  const decision = requireText(command.payload.decision, "payload.decision").toLowerCase();
  if (!["approved", "rejected"].includes(decision)) throw new Error("family doctor application decision must be approved or rejected");
  const note = requireText(command.payload.note, "payload.note");
  application.reviewStatus = decision;
  application.status = decision;
  application.reviewedAt = command.at;
  application.reviewer = actorName(actor);
  application.reviewNote = note;
  if (decision === "approved") application.contractDueAt = text(command.payload.contractDueAt);
  else application.rejectionReason = text(command.payload.reason || note);
  const message = familyMessage(data, command, actor, application, "citizen", "", `Family doctor application ${decision}`, note, `review-${decision}`);
  return { application, message };
}

function activateFamilyContract(data, command, actor) {
  const application = rows(data.phase2FamilyDoctorApplications).find((item) => item.id === command.caseId);
  if (!application) throw new Error("family doctor application not found");
  requireInstitution(actor, application.reviewInstitutionCode);
  if (application.applicationType === "renewal") throw new Error("renewal application cannot create a second contract");
  if (application.reviewStatus !== "approved") throw new Error("family doctor application must be approved before activation");
  if (application.contractId || application.status === "contracted" || rows(data.phase2FamilyDoctorContracts).some((item) => item.applicationId === application.id)) {
    throw new Error("family doctor application already has a contract");
  }
  const team = teamFor(data, application.teamId);
  if (!team || team.institutionCode !== application.reviewInstitutionCode) throw new Error("family doctor team institution mismatch");
  if (Number(team.capacity || 0) > 0 && Number(team.signedResidents || 0) >= Number(team.capacity)) {
    throw new Error("family doctor team has no signing capacity");
  }
  const startDate = requireText(command.payload.startDate, "payload.startDate");
  const endDate = requireText(command.payload.endDate, "payload.endDate");
  if (!Number.isFinite(Date.parse(startDate)) || !Number.isFinite(Date.parse(endDate)) || Date.parse(endDate) <= Date.parse(startDate)) {
    throw new Error("family doctor contract endDate must be after startDate");
  }
  const contract = {
    id: text(command.payload.contractId || `p2fdc-${command.commandId}`),
    residentId: application.residentId,
    residentName: application.residentName,
    applicationId: application.id,
    packageId: application.packageId,
    teamId: application.teamId,
    templateId: application.templateId,
    institutionCode: application.reviewInstitutionCode,
    startDate,
    endDate,
    status: "active",
    fulfillmentPercent: 0,
    renewalStatus: "not-due",
    satisfactionScore: 0,
    nextServiceAt: text(command.payload.nextServiceAt),
    activatedAt: command.at,
    activatedBy: actorName(actor),
    auditHash: createHash("sha256").update(`${application.id}/${startDate}/${endDate}`).digest("hex"),
    workflowVersion: 1,
    productionEvidence: false
  };
  data.phase2FamilyDoctorContracts = appendById(data.phase2FamilyDoctorContracts, contract);
  team.signedResidents = Number(team.signedResidents || 0) + 1;
  application.status = "contracted";
  application.contractId = contract.id;
  application.activatedAt = command.at;
  const message = familyMessage(data, command, actor, contract, "citizen", "", "Family doctor contract activated", requireText(command.payload.note, "payload.note"), "activated");
  return { application, contract, message };
}

function recordFamilyFulfillment(data, command, actor) {
  const contract = rows(data.phase2FamilyDoctorContracts).find((item) => item.id === command.caseId);
  if (!contract) throw new Error("family doctor contract not found");
  const team = teamFor(data, contract.teamId);
  const servicePackage = packageFor(data, contract.packageId);
  requireInstitution(actor, contract.institutionCode || team?.institutionCode);
  if (!["active", "renewal-pending"].includes(contract.status)) throw new Error("family doctor contract is not active");
  if (!servicePackage) throw new Error("family doctor contract package not found");
  const serviceDate = requireText(command.payload.serviceDate, "payload.serviceDate");
  if (!Number.isFinite(Date.parse(serviceDate))) throw new Error("payload.serviceDate must be an ISO-compatible date");
  const value = Number(command.payload.fulfillmentValue || 0);
  if (!Number.isFinite(value) || value <= 0 || value > 100) throw new Error("payload.fulfillmentValue must be between 1 and 100");
  const serviceItem = requireText(command.payload.serviceItem, "payload.serviceItem");
  if (rows(servicePackage.serviceItems).length && !servicePackage.serviceItems.includes(serviceItem)) {
    throw new Error("family doctor service item is outside the contracted package");
  }
  const evidenceCollection = requireText(command.payload.evidenceCollection, "payload.evidenceCollection");
  const evidenceId = requireText(command.payload.evidenceId, "payload.evidenceId");
  const serviceTaskId = text(command.payload.serviceTaskId);
  const serviceTask = serviceTaskId ? rows(data.phase2FamilyDoctorServiceTasks).find((item) => item.id === serviceTaskId) : null;
  if (serviceTaskId && (!serviceTask || serviceTask.contractId !== contract.id || serviceTask.residentId !== contract.residentId)) {
    throw new Error("family doctor service task does not match contract");
  }
  if (serviceTask && ["completed", "cancelled"].includes(serviceTask.status)) throw new Error("family doctor service task is already terminal");
  const fulfillment = {
    id: text(command.payload.fulfillmentId || `p2fdf-${command.commandId}`),
    contractId: contract.id,
    residentId: contract.residentId,
    teamId: contract.teamId,
    packageId: contract.packageId,
    serviceDate,
    serviceType: requireText(command.payload.serviceType, "payload.serviceType"),
    serviceItem,
    status: "completed",
    evidenceCollection,
    evidenceId,
    serviceTaskId,
    fulfillmentValue: value,
    satisfaction: "pending",
    completedAt: command.at,
    completedBy: actorName(actor),
    note: requireText(command.payload.note, "payload.note"),
    auditHash: createHash("sha256").update(`${contract.id}/${serviceDate}/${command.commandId}`).digest("hex"),
    workflowVersion: 1,
    productionEvidence: false
  };
  data.phase2FamilyDoctorFulfillments = appendById(data.phase2FamilyDoctorFulfillments, fulfillment);
  if (serviceTask) {
    serviceTask.status = "completed";
    serviceTask.completedAt = command.at;
    serviceTask.completedBy = actorName(actor);
    serviceTask.fulfillmentId = fulfillment.id;
  }
  contract.fulfillmentPercent = Math.min(100, Number(contract.fulfillmentPercent || 0) + value);
  contract.lastServiceAt = serviceDate;
  contract.nextServiceAt = text(command.payload.nextServiceAt || contract.nextServiceAt);
  const message = familyMessage(data, command, actor, fulfillment, "citizen", "", "Family doctor service completed", fulfillment.note, "fulfilled");
  return { contract, fulfillment, message };
}

function requestFamilyRenewal(data, command, actor) {
  const contract = rows(data.phase2FamilyDoctorContracts).find((item) => item.id === command.caseId);
  if (!contract) throw new Error("family doctor contract not found");
  requireResident(actor, contract.residentId);
  if (!["active", "renewal-pending"].includes(contract.status)) throw new Error("family doctor contract cannot be renewed");
  if (rows(data.phase2FamilyDoctorApplications).some((item) => item.existingContractId === contract.id && item.reviewStatus === "pending")) {
    throw new Error("family doctor renewal is already pending");
  }
  const team = teamFor(data, contract.teamId);
  const servicePackage = packageFor(data, text(command.payload.packageId || contract.packageId));
  if (!servicePackage || servicePackage.status !== "active") throw new Error("active family doctor package not found");
  if (rows(servicePackage.availableInstitutionCodes).length && !servicePackage.availableInstitutionCodes.includes(contract.institutionCode || team?.institutionCode)) {
    throw new Error("family doctor package is unavailable for selected team");
  }
  const application = {
    id: text(command.payload.applicationId || `p2fda-renew-${command.commandId}`),
    residentId: contract.residentId,
    residentName: contract.residentName,
    packageId: servicePackage.id,
    teamId: contract.teamId,
    templateId: contract.templateId,
    applicationType: "renewal",
    submittedAt: command.at,
    status: "renewal-review",
    reviewStatus: "pending",
    reviewInstitutionCode: contract.institutionCode || team?.institutionCode,
    consentStatus: text(command.payload.consentStatus || "signed"),
    desiredStartDate: requireText(command.payload.desiredStartDate, "payload.desiredStartDate"),
    existingContractId: contract.id,
    lastAction: requireText(command.payload.note, "payload.note"),
    workflowVersion: 1,
    productionEvidence: false
  };
  data.phase2FamilyDoctorApplications = appendById(data.phase2FamilyDoctorApplications, application);
  contract.status = "renewal-pending";
  contract.renewalStatus = "pending-review";
  contract.renewalApplicationId = application.id;
  const message = familyMessage(data, command, actor, application, "institution", application.reviewInstitutionCode, "Family doctor renewal awaiting review", application.lastAction, "renewal-requested");
  return { contract, application, message };
}

function reviewFamilyRenewal(data, command, actor) {
  const application = rows(data.phase2FamilyDoctorApplications).find((item) => item.id === command.caseId);
  if (!application || application.applicationType !== "renewal") throw new Error("family doctor renewal application not found");
  requireInstitution(actor, application.reviewInstitutionCode);
  if (application.reviewStatus !== "pending") throw new Error("family doctor renewal is not pending review");
  const contract = rows(data.phase2FamilyDoctorContracts).find((item) => item.id === application.existingContractId);
  if (!contract || contract.residentId !== application.residentId) throw new Error("family doctor renewal contract mismatch");
  const decision = requireText(command.payload.decision, "payload.decision").toLowerCase();
  if (!["approved", "rejected"].includes(decision)) throw new Error("family doctor renewal decision must be approved or rejected");
  const note = requireText(command.payload.note, "payload.note");
  application.reviewStatus = decision;
  application.status = decision;
  application.reviewedAt = command.at;
  application.reviewer = actorName(actor);
  application.reviewNote = note;
  if (decision === "approved") {
    const startDate = requireText(command.payload.startDate || application.desiredStartDate, "payload.startDate");
    const endDate = requireText(command.payload.endDate, "payload.endDate");
    if (!Number.isFinite(Date.parse(startDate)) || !Number.isFinite(Date.parse(endDate)) || Date.parse(endDate) <= Date.parse(startDate)) {
      throw new Error("renewed contract endDate must be after startDate");
    }
    contract.startDate = startDate;
    contract.endDate = endDate;
    contract.packageId = application.packageId;
    contract.status = "active";
    contract.renewalStatus = "approved";
    contract.renewedAt = command.at;
    contract.renewalApplicationId = application.id;
  } else {
    contract.status = "active";
    contract.renewalStatus = "rejected";
    contract.renewalRejectionReason = text(command.payload.reason || note);
  }
  rows(data.phase2FamilyDoctorServiceTasks)
    .filter((task) => task.contractId === contract.id && task.kind === "renewal-reminder" && !["completed", "cancelled"].includes(task.status))
    .forEach((task) => {
      task.status = "completed";
      task.completedAt = command.at;
      task.completedBy = actorName(actor);
      task.resolution = `renewal-${decision}`;
    });
  const message = familyMessage(data, command, actor, application, "citizen", "", `Family doctor renewal ${decision}`, note, `renewal-${decision}`);
  return { contract, application, message };
}

function requestFamilyTransfer(data, command, actor) {
  const contract = rows(data.phase2FamilyDoctorContracts).find((item) => item.id === command.caseId);
  if (!contract) throw new Error("family doctor contract not found");
  requireResident(actor, contract.residentId);
  if (contract.status !== "active") throw new Error("only an active family doctor contract may be transferred");
  if (rows(data.phase2FamilyDoctorApplications).some((item) =>
    item.applicationType === "team-transfer"
    && item.existingContractId === contract.id
    && !["completed", "rejected", "cancelled"].includes(text(item.status).toLowerCase()))) {
    throw new Error("family doctor transfer is already pending");
  }
  const sourceTeam = teamFor(data, contract.teamId);
  if (!sourceTeam) throw new Error("current family doctor team not found");
  const targetTeam = teamFor(data, requireText(command.payload.teamId, "payload.teamId"));
  const servicePackage = packageFor(data, requireText(command.payload.packageId, "payload.packageId"));
  if (!targetTeam || targetTeam.status !== "active") throw new Error("active target family doctor team not found");
  if (targetTeam.id === sourceTeam.id) throw new Error("target family doctor team must differ from current team");
  if (!servicePackage || servicePackage.status !== "active") throw new Error("active family doctor package not found");
  if (rows(servicePackage.availableInstitutionCodes).length && !servicePackage.availableInstitutionCodes.includes(targetTeam.institutionCode)) {
    throw new Error("family doctor package is unavailable for target team");
  }
  if (Number(targetTeam.capacity || 0) > 0 && Number(targetTeam.signedResidents || 0) >= Number(targetTeam.capacity)) {
    throw new Error("target family doctor team has no signing capacity");
  }
  const reason = requireText(command.payload.reason, "payload.reason");
  const note = requireText(command.payload.note, "payload.note");
  const application = {
    id: text(command.payload.applicationId || `p2fda-transfer-${command.commandId}`),
    residentId: contract.residentId,
    residentName: contract.residentName,
    packageId: servicePackage.id,
    teamId: targetTeam.id,
    templateId: servicePackage.templateId,
    applicationType: "team-transfer",
    existingContractId: contract.id,
    sourceTeamId: sourceTeam.id,
    sourceInstitutionCode: contract.institutionCode || sourceTeam.institutionCode,
    targetInstitutionCode: targetTeam.institutionCode,
    submittedAt: command.at,
    status: "submitted",
    reviewStatus: "pending",
    reviewStage: "source",
    reviewInstitutionCode: contract.institutionCode || sourceTeam.institutionCode,
    transferReason: reason,
    lastAction: note,
    workflowVersion: 1,
    productionEvidence: false
  };
  data.phase2FamilyDoctorApplications = appendById(data.phase2FamilyDoctorApplications, application);
  contract.transferStatus = "pending-source";
  contract.transferApplicationId = application.id;
  const message = familyMessage(data, command, actor, application, "institution", application.reviewInstitutionCode, "Family doctor transfer awaiting source review", `${reason}: ${note}`, "transfer-source-requested");
  return { contract, application, message };
}

function reviewFamilyTransfer(data, command, actor) {
  const application = rows(data.phase2FamilyDoctorApplications).find((item) => item.id === command.caseId);
  if (!application || application.applicationType !== "team-transfer") throw new Error("family doctor transfer application not found");
  if (application.reviewStatus !== "pending" || !["source", "target"].includes(application.reviewStage)) {
    throw new Error("family doctor transfer is not pending review");
  }
  requireInstitution(actor, application.reviewInstitutionCode);
  const contract = rows(data.phase2FamilyDoctorContracts).find((item) => item.id === application.existingContractId);
  if (!contract || contract.residentId !== application.residentId) throw new Error("family doctor transfer contract mismatch");
  if (contract.status !== "active") throw new Error("family doctor contract is not active");
  const sourceTeam = teamFor(data, application.sourceTeamId);
  const targetTeam = teamFor(data, application.teamId);
  const servicePackage = packageFor(data, application.packageId);
  if (!sourceTeam || !targetTeam || !servicePackage) throw new Error("family doctor transfer target is incomplete");
  const decision = requireText(command.payload.decision, "payload.decision").toLowerCase();
  if (!["approved", "rejected"].includes(decision)) throw new Error("family doctor transfer decision must be approved or rejected");
  const note = requireText(command.payload.note, "payload.note");
  const stage = application.reviewStage;
  const messages = [];

  if (decision === "rejected") {
    application.reviewStatus = "rejected";
    application.status = "rejected";
    application.reviewedAt = command.at;
    application.reviewer = actorName(actor);
    application.reviewNote = note;
    application.rejectionStage = stage;
    application.rejectionReason = text(command.payload.reason || note);
    contract.transferStatus = "rejected";
    contract.transferRejectionReason = application.rejectionReason;
    messages.push(familyMessage(data, command, actor, application, "citizen", "", "Family doctor transfer rejected", note, `transfer-${stage}-rejected`));
    if (stage === "target") {
      messages.push(familyMessage(data, command, actor, application, "institution", application.sourceInstitutionCode, "Family doctor transfer rejected by target team", note, "transfer-target-rejected-source"));
    }
    return { contract, application, messages };
  }

  if (stage === "source") {
    application.sourceApprovedAt = command.at;
    application.sourceApprovedBy = actorName(actor);
    application.sourceReviewNote = note;
    application.status = "source-approved";
    application.reviewStage = "target";
    application.reviewInstitutionCode = application.targetInstitutionCode;
    contract.transferStatus = "pending-target";
    messages.push(familyMessage(data, command, actor, application, "institution", application.targetInstitutionCode, "Family doctor transfer awaiting target review", note, "transfer-target-requested"));
    messages.push(familyMessage(data, command, actor, application, "citizen", "", "Family doctor transfer released by current team", note, "transfer-source-approved"));
    return { contract, application, messages };
  }

  if (targetTeam.status !== "active") throw new Error("active target family doctor team not found");
  if (rows(servicePackage.availableInstitutionCodes).length && !servicePackage.availableInstitutionCodes.includes(targetTeam.institutionCode)) {
    throw new Error("family doctor package is unavailable for target team");
  }
  if (Number(targetTeam.capacity || 0) > 0 && Number(targetTeam.signedResidents || 0) >= Number(targetTeam.capacity)) {
    throw new Error("target family doctor team has no signing capacity");
  }
  const prior = {
    at: command.at,
    applicationId: application.id,
    fromTeamId: contract.teamId,
    fromInstitutionCode: contract.institutionCode || sourceTeam.institutionCode,
    fromPackageId: contract.packageId,
    toTeamId: targetTeam.id,
    toInstitutionCode: targetTeam.institutionCode,
    toPackageId: servicePackage.id,
    reason: application.transferReason,
    reviewedBy: actorName(actor)
  };
  if (Number(sourceTeam.signedResidents || 0) > 0) sourceTeam.signedResidents = Number(sourceTeam.signedResidents) - 1;
  targetTeam.signedResidents = Number(targetTeam.signedResidents || 0) + 1;
  rows(data.phase2FamilyDoctorServiceTasks)
    .filter((task) => task.contractId === contract.id && !["completed", "cancelled"].includes(task.status))
    .forEach((task) => {
      task.status = "cancelled";
      task.cancelledAt = command.at;
      task.cancelledBy = actorName(actor);
      task.cancellationReason = "family-doctor-team-transferred";
    });
  contract.teamId = targetTeam.id;
  contract.packageId = servicePackage.id;
  contract.templateId = servicePackage.templateId;
  contract.institutionCode = targetTeam.institutionCode;
  contract.transferStatus = "completed";
  contract.lastTransferApplicationId = application.id;
  contract.transferredAt = command.at;
  contract.transferredBy = actorName(actor);
  contract.transferHistory = [prior, ...rows(contract.transferHistory)].slice(0, 20);
  contract.nextServiceAt = text(command.payload.nextServiceAt);
  application.reviewStatus = "approved";
  application.status = "completed";
  application.reviewStage = "completed";
  application.reviewedAt = command.at;
  application.reviewer = actorName(actor);
  application.reviewNote = note;
  application.completedAt = command.at;
  messages.push(familyMessage(data, command, actor, application, "citizen", "", "Family doctor transfer completed", note, "transfer-completed"));
  messages.push(familyMessage(data, command, actor, application, "institution", application.sourceInstitutionCode, "Family doctor transfer completed", note, "transfer-completed-source"));
  return { contract, application, messages };
}

function addHours(at, hours) {
  return new Date(Date.parse(at) + hours * 3_600_000).toISOString();
}

function raiseFamilyServiceDispute(data, command, actor) {
  const disputeId = requireText(command.caseId, "caseId");
  if (rows(data.phase2FamilyDoctorServiceDisputes).some((item) => item.id === disputeId)) {
    throw new Error("family doctor service dispute id already exists");
  }
  const fulfillment = rows(data.phase2FamilyDoctorFulfillments).find((item) => item.id === requireText(command.payload.fulfillmentId, "payload.fulfillmentId"));
  if (!fulfillment) throw new Error("family doctor fulfillment not found");
  requireResident(actor, fulfillment.residentId);
  if (text(fulfillment.status).toLowerCase() !== "completed") throw new Error("only a completed family doctor fulfillment may be disputed");
  const contract = rows(data.phase2FamilyDoctorContracts).find((item) => item.id === fulfillment.contractId);
  if (!contract || contract.residentId !== fulfillment.residentId) throw new Error("family doctor dispute contract mismatch");
  if (rows(data.phase2FamilyDoctorServiceDisputes).some((item) =>
    item.fulfillmentId === fulfillment.id && !["resolved", "cancelled"].includes(text(item.status).toLowerCase()))) {
    throw new Error("open family doctor service dispute already exists");
  }
  const serviceTeam = teamFor(data, fulfillment.teamId);
  const institutionCode = text(serviceTeam?.institutionCode || contract.institutionCode);
  if (!institutionCode) throw new Error("family doctor service institution is required");
  const category = requireText(command.payload.category, "payload.category").toLowerCase();
  if (!["service-quality", "communication", "record-accuracy", "accessibility", "billing", "other"].includes(category)) {
    throw new Error("unsupported family doctor service dispute category");
  }
  const responseDueAt = text(command.payload.responseDueAt || addHours(command.at, 72));
  if (!Number.isFinite(Date.parse(responseDueAt)) || Date.parse(responseDueAt) <= Date.parse(command.at)) {
    throw new Error("family doctor dispute responseDueAt must be after command time");
  }
  const dispute = {
    id: disputeId,
    fulfillmentId: fulfillment.id,
    contractId: contract.id,
    residentId: fulfillment.residentId,
    teamId: fulfillment.teamId,
    institutionCode,
    category,
    description: requireText(command.payload.description, "payload.description"),
    requestedResolution: requireText(command.payload.requestedResolution, "payload.requestedResolution"),
    status: "open",
    responseDueAt,
    raisedAt: command.at,
    raisedBy: actorName(actor),
    lastAction: requireText(command.payload.note, "payload.note"),
    responseHistory: [],
    residentDecisionHistory: [],
    reopenCount: 0,
    workflowVersion: 1,
    productionEvidence: false
  };
  data.phase2FamilyDoctorServiceDisputes = appendById(data.phase2FamilyDoctorServiceDisputes, dispute);
  const message = familyMessage(data, command, actor, dispute, "institution", institutionCode, "Family doctor service dispute awaiting response", dispute.lastAction, "dispute-raised");
  return { dispute, fulfillment, contract, message };
}

function respondFamilyServiceDispute(data, command, actor) {
  const dispute = rows(data.phase2FamilyDoctorServiceDisputes).find((item) => item.id === command.caseId);
  if (!dispute) throw new Error("family doctor service dispute not found");
  requireInstitution(actor, dispute.institutionCode);
  if (!["open", "reopened"].includes(text(dispute.status).toLowerCase())) {
    throw new Error("family doctor service dispute is not awaiting institution response");
  }
  const resolution = requireText(command.payload.resolution, "payload.resolution");
  const note = requireText(command.payload.note, "payload.note");
  const evidenceCollection = text(command.payload.evidenceCollection);
  const evidenceId = text(command.payload.evidenceId);
  if (Boolean(evidenceCollection) !== Boolean(evidenceId)) {
    throw new Error("family doctor dispute resolution evidence requires both collection and id");
  }
  const residentDueAt = text(command.payload.residentDueAt || addHours(command.at, 72));
  if (!Number.isFinite(Date.parse(residentDueAt)) || Date.parse(residentDueAt) <= Date.parse(command.at)) {
    throw new Error("family doctor dispute residentDueAt must be after command time");
  }
  const response = {
    at: command.at,
    by: actorName(actor),
    institutionCode: dispute.institutionCode,
    resolution,
    note,
    evidenceCollection,
    evidenceId,
    cycle: Number(dispute.reopenCount || 0) + 1
  };
  dispute.responseHistory = [response, ...rows(dispute.responseHistory)].slice(0, 20);
  dispute.status = "responded";
  dispute.latestResolution = resolution;
  dispute.latestResponseAt = command.at;
  dispute.latestResponder = actorName(actor);
  dispute.residentDueAt = residentDueAt;
  const message = familyMessage(data, command, actor, dispute, "citizen", "", "Family doctor service dispute response ready", `${resolution}: ${note}`, `dispute-responded-${response.cycle}`);
  return { dispute, response, message };
}

function acknowledgeFamilyServiceDispute(data, command, actor) {
  const dispute = rows(data.phase2FamilyDoctorServiceDisputes).find((item) => item.id === command.caseId);
  if (!dispute) throw new Error("family doctor service dispute not found");
  requireResident(actor, dispute.residentId);
  if (dispute.status !== "responded") throw new Error("family doctor service dispute is not awaiting resident acknowledgement");
  const decision = requireText(command.payload.decision, "payload.decision").toLowerCase();
  if (!["accepted", "reopen"].includes(decision)) throw new Error("family doctor service dispute decision must be accepted or reopen");
  const note = requireText(command.payload.note, "payload.note");
  const decisionRecord = {
    at: command.at,
    by: actorName(actor),
    decision,
    note,
    cycle: Number(dispute.reopenCount || 0) + 1
  };
  dispute.residentDecisionHistory = [decisionRecord, ...rows(dispute.residentDecisionHistory)].slice(0, 20);
  dispute.residentDecision = decision;
  dispute.residentDecisionAt = command.at;
  const escalations = [];
  let title;
  if (decision === "accepted") {
    dispute.status = "resolved";
    dispute.resolvedAt = command.at;
    dispute.resolvedBy = actorName(actor);
    dispute.resolutionStatus = "resident-accepted";
    rows(data.registrationReferralEscalations)
      .filter((item) => item.caseType === "family-doctor-service-dispute"
        && item.caseId === dispute.id
        && !["resolved", "closed"].includes(text(item.status).toLowerCase()))
      .forEach((item) => {
        item.status = "resolved";
        item.resolvedAt = command.at;
        item.resolvedBy = actorName(actor);
        item.resolution = "resident-accepted-remediation";
        escalations.push(item);
      });
    title = "Family doctor service dispute resolved";
  } else {
    const responseDueAt = text(command.payload.responseDueAt || addHours(command.at, 48));
    if (!Number.isFinite(Date.parse(responseDueAt)) || Date.parse(responseDueAt) <= Date.parse(command.at)) {
      throw new Error("family doctor dispute responseDueAt must be after command time");
    }
    dispute.status = "reopened";
    dispute.reopenCount = Number(dispute.reopenCount || 0) + 1;
    dispute.responseDueAt = responseDueAt;
    dispute.reopenReason = note;
    dispute.resolutionStatus = "resident-reopened";
    title = "Family doctor service dispute reopened";
  }
  const message = familyMessage(data, command, actor, dispute, "institution", dispute.institutionCode, title, note, `dispute-${decision}-${decisionRecord.cycle}`);
  return { dispute, decision: decisionRecord, escalations, message };
}

function terminateFamilyContract(data, command, actor) {
  const contract = rows(data.phase2FamilyDoctorContracts).find((item) => item.id === command.caseId);
  if (!contract) throw new Error("family doctor contract not found");
  const team = teamFor(data, contract.teamId);
  if (actor.role === "citizen") requireResident(actor, contract.residentId);
  else if (actor.role === "institution") requireInstitution(actor, contract.institutionCode || team?.institutionCode);
  if (["terminated", "expired", "closed"].includes(contract.status)) throw new Error("family doctor contract is already terminal");
  const reason = requireText(command.payload.reason, "payload.reason");
  const note = requireText(command.payload.note, "payload.note");
  contract.status = "terminated";
  contract.terminatedAt = command.at;
  contract.terminatedBy = actorName(actor);
  contract.terminationReason = reason;
  contract.terminationNote = note;
  if (team && Number(team.signedResidents || 0) > 0) team.signedResidents = Number(team.signedResidents) - 1;
  rows(data.phase2FamilyDoctorServiceTasks)
    .filter((task) => task.contractId === contract.id && !["completed", "cancelled"].includes(task.status))
    .forEach((task) => {
      task.status = "cancelled";
      task.cancelledAt = command.at;
      task.cancelledBy = actorName(actor);
      task.cancellationReason = reason;
    });
  const targetRole = actor.role === "citizen" ? "institution" : "citizen";
  const message = familyMessage(data, command, actor, contract, targetRole, targetRole === "institution" ? contract.institutionCode || team?.institutionCode : "", "Family doctor contract terminated", `${reason}: ${note}`, "terminated");
  return { contract, message };
}

function buildNotificationReliability(data = {}) {
  const messages = rows(data.taskMessages);
  const deadLetters = rows(data.registrationReferralNotificationDeadLetters);
  const providerReceipts = messages.flatMap((item) => rows(item.providerReceipts));
  const delivered = providerReceipts.filter((item) => ["accepted", "delivered", "sent"].includes(item.status)).length;
  const failures = providerReceipts.filter((item) => PROVIDER_FAILURE_STATUSES.has(item.status)).length;
  return {
    messages: messages.length,
    providerReceipts: providerReceipts.length,
    delivered,
    failures,
    openDeadLetters: deadLetters.filter((item) => item.status === "open").length,
    resolvedDeadLetters: deadLetters.filter((item) => item.status === "resolved").length,
    providerSuccessRate: providerReceipts.length ? Math.round((delivered / providerReceipts.length) * 10_000) / 100 : 0,
    productionReady: false
  };
}

function averageHours(items, startField, endField) {
  const values = items.map((item) => {
    const start = Date.parse(item[startField] || "");
    const end = Date.parse(item[endField] || "");
    return Number.isFinite(start) && Number.isFinite(end) && end >= start ? (end - start) / 3_600_000 : null;
  }).filter((value) => value !== null);
  return values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100 : 0;
}

function buildClosureQualityMetrics(data = {}, options = {}) {
  const teleconsultations = rows(data.referralTeleconsultations);
  const referrals = rows(data.referralSystem?.referrals);
  const allReferrals = [...teleconsultations, ...referrals.filter((item) => !teleconsultations.some((tele) => tele.referralId === item.id))];
  const returned = allReferrals.filter((item) => item.reportStatus === "returned" || ["report-returned", "closed"].includes(text(item.status).toLowerCase()));
  const acceptedContinuity = returned.filter((item) => item.primaryCareAccepted || item.followupAccepted || item.continuityStatus === "accepted" || item.status === "closed");
  const rejected = allReferrals.filter((item) => item.status === "rejected");
  const reassigned = allReferrals.filter((item) => rows(item.reassignmentHistory).length);
  const materialComplete = allReferrals.filter((item) => rows(item.materials).length && item.materialManifestDigest);
  const repeatExamReuse = allReferrals.filter((item) => /recognized|reused|mutual-recognition/i.test(text(item.performance?.repeatExamControl)));
  const familyContracts = rows(data.phase2FamilyDoctorContracts);
  const familyFulfillments = rows(data.phase2FamilyDoctorFulfillments);
  const familyDisputes = rows(data.phase2FamilyDoctorServiceDisputes);
  const pct = (numerator, denominator) => denominator ? Math.round((numerator / denominator) * 10_000) / 100 : 0;
  return {
    asOf: text(options.asOf || new Date().toISOString()),
    referrals: allReferrals.length,
    reportReturnRate: pct(returned.length, allReferrals.length),
    continuityAcceptanceRate: pct(acceptedContinuity.length, returned.length),
    referralRejectionRate: pct(rejected.length, allReferrals.length),
    referralReassignmentRate: pct(reassigned.length, allReferrals.length),
    materialManifestCoverage: pct(materialComplete.length, allReferrals.length),
    repeatExamReuseRate: pct(repeatExamReuse.length, allReferrals.length),
    averageAcceptanceHours: averageHours(allReferrals, "requestedAt", "acceptedAt"),
    averageReportReturnHours: averageHours(allReferrals, "requestedAt", "reportReturnedAt"),
    familyContracts: familyContracts.length,
    activeFamilyContracts: familyContracts.filter((item) => item.status === "active").length,
    familyFulfillments: familyFulfillments.length,
    acknowledgedFamilyFulfillments: familyFulfillments.filter((item) => item.residentAcknowledgement?.status === "acknowledged").length,
    familyServiceDisputes: familyDisputes.length,
    openFamilyServiceDisputes: familyDisputes.filter((item) => !["resolved", "cancelled"].includes(text(item.status).toLowerCase())).length,
    resolvedFamilyServiceDisputes: familyDisputes.filter((item) => text(item.status).toLowerCase() === "resolved").length,
    notificationReliability: buildNotificationReliability(data),
    openWorkItems: buildClosureWorkQueue(data, { asOf: options.asOf, actor: { role: "commission" } }).length,
    productionReady: false
  };
}

const HANDLERS = Object.freeze({
  "reject-referral-request": rejectReferral,
  "withdraw-referral": withdrawReferral,
  "reassign-referral": reassignReferral,
  "reschedule-teleconsultation": rescheduleTeleconsultation,
  "cancel-teleconsultation": cancelTeleconsultation,
  "record-teleconsultation-no-show": recordNoShow,
  "attach-referral-materials": attachReferralMaterials,
  "grant-referral-authorization": grantAuthorization,
  "revoke-referral-authorization": revokeAuthorization,
  "resume-referral-authorization": resumeReferralAuthorization,
  "run-closure-sla": runClosureSla,
  "acknowledge-escalation": acknowledgeEscalation,
  "record-notification-provider-result": providerResult,
  "resolve-notification-dead-letter": resolveDeadLetter,
  "submit-family-doctor-application": submitFamilyApplication,
  "review-family-doctor-application": reviewFamilyApplication,
  "activate-family-doctor-contract": activateFamilyContract,
  "record-family-doctor-fulfillment": recordFamilyFulfillment,
  "request-family-doctor-renewal": requestFamilyRenewal,
  "review-family-doctor-renewal": reviewFamilyRenewal,
  "request-family-doctor-transfer": requestFamilyTransfer,
  "review-family-doctor-transfer": reviewFamilyTransfer,
  "raise-family-doctor-service-dispute": raiseFamilyServiceDispute,
  "respond-family-doctor-service-dispute": respondFamilyServiceDispute,
  "acknowledge-family-doctor-service-dispute": acknowledgeFamilyServiceDispute,
  "terminate-family-doctor-contract": terminateFamilyContract
});

function applyStandaloneCommand(data, command, actor) {
  const handler = HANDLERS[command.action];
  if (!handler) return null;
  return handler(data, command, actor);
}

module.exports = {
  STANDALONE_COMMAND_CONTRACTS,
  applyStandaloneCommand,
  buildClosureQualityMetrics,
  buildClosureWorkQueue,
  buildNotificationReliability
};
