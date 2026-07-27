"use strict";

const { createHash } = require("node:crypto");

const ADVANCED_COMMAND_CONTRACTS = Object.freeze([
  { action: "create-down-referral", roles: ["institution", "commission"], requiredFields: ["residentId", "payload.externalReferralId", "payload.sourceInstitutionCode", "payload.targetInstitution", "payload.targetInstitutionCode", "payload.residentAuthorizationId", "payload.reason", "payload.due", "payload.note"], suggestedEndpoint: "POST /api/registration-referral/commands/create-down-referral" },
  { action: "request-referral-supplement", roles: ["institution", "commission"], requiredFields: ["caseId", "payload.requirements", "payload.dueAt", "payload.note"], suggestedEndpoint: "POST /api/registration-referral/commands/request-referral-supplement" },
  { action: "submit-referral-supplement", roles: ["institution", "commission"], requiredFields: ["caseId", "payload.fulfilledRequirementIds", "payload.materials", "payload.note"], suggestedEndpoint: "POST /api/registration-referral/commands/submit-referral-supplement" },
  { action: "review-referral-supplement", roles: ["institution", "commission"], requiredFields: ["caseId", "payload.decision", "payload.note"], suggestedEndpoint: "POST /api/registration-referral/commands/review-referral-supplement" },
  { action: "run-family-doctor-scheduler", roles: ["institution", "commission"], requiredFields: ["payload.note"], suggestedEndpoint: "POST /api/registration-referral/commands/run-family-doctor-scheduler" }
]);

const AUTHORIZATION_SCOPES = new Set(["referral", "referral-teleconsultation", "referral-and-teleconsultation"]);
const TERMINAL_REFERRAL_STATUSES = new Set(["cancelled", "closed", "report-returned", "withdrawn"]);

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

function requireInstitution(actor, institutionCode) {
  if (actor.role === "commission") return;
  if (actor.role !== "institution" || !text(actor.orgCode)) throw new Error("institution actor orgCode is required");
  if (!text(institutionCode)) throw new Error("institution target orgCode is required");
  if (text(actor.orgCode) !== text(institutionCode)) throw new Error("institution scope denied");
}

function appendById(items, item, limit = 300) {
  return [item, ...rows(items).filter((row) => row.id !== item.id)].slice(0, limit);
}

function appendMessage(data, command, actor, fields) {
  const existing = rows(data.taskMessages).find((item) => item.notificationKey === fields.notificationKey);
  if (existing) return existing;
  const message = {
    id: fields.id || `msg-${command.commandId}-${fields.suffix}`,
    taskId: `${fields.collection}:${fields.sourceId}`,
    collection: fields.collection,
    sourceId: fields.sourceId,
    residentId: fields.residentId || "",
    targetRole: fields.targetRole,
    targetOrgCode: fields.targetOrgCode || "",
    channel: "in_app",
    deliveryChannels: ["in_app", "sms"],
    title: fields.title,
    body: fields.body,
    status: "sent",
    receipts: [],
    notificationKey: fields.notificationKey,
    createdAt: command.at,
    createdBy: text(actor.username || actor.role),
    createdByName: actorName(actor),
    productionEvidence: false
  };
  data.taskMessages = appendById(data.taskMessages, message);
  return message;
}

function authorizationScopes(authorization) {
  return [authorization.scope, ...rows(authorization.scopes), authorization.meta?.scope, ...rows(authorization.meta?.scopes)]
    .map((item) => text(item).toLowerCase()).filter(Boolean);
}

function findActiveAuthorization(data, id, residentId, targetOrgCode, at) {
  return rows(data.personalRecords).find((item) => {
    if (item.id !== id || item.category !== "authorizations" || item.residentId !== residentId) return false;
    if (!["active", "authorized"].includes(text(item.status).toLowerCase())) return false;
    if (!["active", "authorized"].includes(text(item.meta?.status).toLowerCase())) return false;
    if (!authorizationScopes(item).some((scope) => AUTHORIZATION_SCOPES.has(scope))) return false;
    const targets = [...rows(item.authorizedTo), ...rows(item.meta?.authorizedTo)].map(text);
    if (!targets.includes(targetOrgCode)) return false;
    const expires = [item.expiresAt, item.meta?.expiresAt].map(text).filter(Boolean);
    return !expires.some((value) => !Number.isFinite(Date.parse(value)) || Date.parse(value) <= Date.parse(at));
  });
}

function findReferralRecord(data, caseId) {
  const teleconsultation = rows(data.referralTeleconsultations).find((item) => item.id === caseId);
  if (teleconsultation) return { item: teleconsultation, kind: "teleconsultation" };
  const referral = rows(data.referralSystem?.referrals).find((item) => item.id === caseId);
  return referral ? { item: referral, kind: "referral" } : null;
}

function linkedReferral(data, record) {
  if (record.kind === "referral") return record.item;
  return rows(data.referralSystem?.referrals).find((item) => item.id === record.item.referralId) || null;
}

function linkedOrder(data, item) {
  return rows(data.countyCollaborationOrders).find((row) => row.id === item.collaborationOrderId) || null;
}

function sourceOrg(item) {
  return text(item.sourceInstitutionCode || item.fromInstitutionCode);
}

function targetOrg(item) {
  return text(item.targetInstitutionCode || item.toInstitutionCode);
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

function notifyReferral(data, command, actor, item, stage, title, body, options = {}) {
  const collection = rows(data.referralTeleconsultations).includes(item) ? "referralTeleconsultations" : "referrals";
  const messages = [];
  const targets = [
    { key: "citizen", targetRole: "citizen", targetOrgCode: "" },
    { key: "source", targetRole: "institution", targetOrgCode: sourceOrg(item) },
    { key: "target", targetRole: "institution", targetOrgCode: targetOrg(item) }
  ];
  targets.forEach((target) => {
    if (options[target.key] === false || (target.targetRole === "institution" && !target.targetOrgCode)) return;
    messages.push(appendMessage(data, command, actor, {
      suffix: `${stage}-${target.key}`,
      collection,
      sourceId: item.id,
      residentId: item.residentId,
      targetRole: target.targetRole,
      targetOrgCode: target.targetOrgCode,
      title,
      body,
      notificationKey: `registration-referral:${item.id}:${stage}:${target.key}:${target.targetOrgCode}`
    }));
  });
  return messages;
}

function createDownReferral(data, command, actor) {
  const payload = command.payload;
  const residentId = requireText(command.residentId || payload.residentId, "residentId");
  if (!rows(data.residents).some((item) => item.id === residentId)) throw new Error("resident not found");
  const sourceInstitutionCode = requireText(payload.sourceInstitutionCode, "payload.sourceInstitutionCode");
  const targetInstitutionCode = requireText(payload.targetInstitutionCode, "payload.targetInstitutionCode");
  const externalReferralId = requireText(payload.externalReferralId, "payload.externalReferralId");
  requireInstitution(actor, sourceInstitutionCode);
  if (sourceInstitutionCode === targetInstitutionCode) throw new Error("down-referral source and target institutions must differ");
  const authorizationId = requireText(payload.residentAuthorizationId, "payload.residentAuthorizationId");
  if (!findActiveAuthorization(data, authorizationId, residentId, targetInstitutionCode, command.at)) {
    throw new Error("active unexpired resident referral authorization does not cover target institution");
  }
  if (rows(data.referralSystem?.referrals).some((item) => item.externalReferralId === externalReferralId)) {
    throw new Error("down-referral externalReferralId already exists");
  }
  const familyDoctorContractId = text(payload.familyDoctorContractId);
  if (familyDoctorContractId) {
    const contract = rows(data.phase2FamilyDoctorContracts).find((item) => item.id === familyDoctorContractId);
    const team = contract && rows(data.phase2FamilyDoctorTeams).find((item) => item.id === contract.teamId);
    if (!contract || contract.residentId !== residentId || !["active", "renewal-pending"].includes(contract.status)) {
      throw new Error("active family doctor contract does not match down-referral resident");
    }
    if (text(contract.institutionCode || team?.institutionCode) !== targetInstitutionCode) {
      throw new Error("family doctor contract does not belong to down-referral target institution");
    }
  }
  const resident = rows(data.residents).find((item) => item.id === residentId);
  const due = requireText(payload.due, "payload.due");
  if (!Number.isFinite(Date.parse(due)) || Date.parse(due) <= Date.parse(command.at)) throw new Error("down-referral due must be after the command timestamp");
  const reason = requireText(payload.reason, "payload.reason");
  const order = {
    id: text(payload.collaborationOrderId || `cco-${command.commandId}`),
    center: "bidirectional-referral-center",
    region: text(payload.region),
    fromInstitution: text(payload.sourceInstitution || sourceInstitutionCode),
    toInstitution: requireText(payload.targetInstitution, "payload.targetInstitution"),
    residentId,
    personIndex: text(resident.personIndex),
    orderType: "down-referral",
    status: "requested",
    priority: text(payload.priority || "routine"),
    requestedAt: command.at,
    due,
    result: "awaiting primary-care acceptance",
    productionEvidence: false
  };
  const referral = {
    id: text(payload.referralId || `rf-${command.commandId}`),
    residentId,
    personIndex: text(resident.personIndex),
    type: "down-referral",
    direction: "downward",
    diseaseType: requireText(payload.diseaseType, "payload.diseaseType"),
    from: order.fromInstitution,
    fromInstitutionCode: sourceInstitutionCode,
    to: order.toInstitution,
    toInstitutionCode: targetInstitutionCode,
    reason,
    status: "requested",
    priority: order.priority,
    requestedAt: command.at,
    date: command.at,
    due,
    collaborationOrderId: order.id,
    residentAuthorizationId: authorizationId,
    externalReferralId,
    authorizationStatus: "authorized",
    familyDoctorContractId,
    dischargeSummaryId: text(payload.dischargeSummaryId),
    productionEvidence: false,
    auditTrail: [{
      at: command.at,
      actor: actorName(actor),
      role: actor.role,
      action: "down-referral-created",
      note: requireText(payload.note, "payload.note"),
      productionEvidence: false
    }]
  };
  data.countyCollaborationOrders = appendById(data.countyCollaborationOrders, order);
  data.referralSystem = { ...(data.referralSystem || {}), referrals: appendById(data.referralSystem?.referrals, referral) };
  const messages = notifyReferral(data, command, actor, referral, "down-referral-created", "Down-referral awaiting primary-care acceptance", reason, { source: false });
  return { referral, collaborationOrder: order, messages };
}

function normalizeRequirements(requirements) {
  const normalized = rows(requirements).map((item, index) => {
    if (typeof item === "string") return { id: `requirement-${index + 1}`, description: requireText(item, `payload.requirements[${index}]`) };
    return {
      id: requireText(item?.id, `payload.requirements[${index}].id`),
      description: requireText(item?.description, `payload.requirements[${index}].description`)
    };
  });
  if (!normalized.length || normalized.length > 20) throw new Error("payload.requirements must contain between 1 and 20 items");
  if (new Set(normalized.map((item) => item.id)).size !== normalized.length) throw new Error("payload.requirements ids must be unique");
  return normalized;
}

function requestSupplement(data, command, actor) {
  const record = findReferralRecord(data, command.caseId);
  if (!record) throw new Error("referral request not found");
  const item = record.item;
  requireInstitution(actor, targetOrg(item));
  if (TERMINAL_REFERRAL_STATUSES.has(text(item.status).toLowerCase()) || ["scheduled", "supplement-required", "supplement-submitted"].includes(text(item.status).toLowerCase())) {
    throw new Error("referral cannot request a supplement in its current state");
  }
  const requirements = normalizeRequirements(command.payload.requirements);
  const dueAt = requireText(command.payload.dueAt, "payload.dueAt");
  if (!Number.isFinite(Date.parse(dueAt)) || Date.parse(dueAt) <= Date.parse(command.at)) throw new Error("supplement dueAt must be after the command timestamp");
  const note = requireText(command.payload.note, "payload.note");
  item.statusBeforeSupplement = item.status;
  item.status = "supplement-required";
  item.supplementRequest = {
    version: Number(item.supplementRequest?.version || 0) + 1,
    requirements,
    dueAt,
    requestedAt: command.at,
    requestedBy: actorName(actor),
    status: "awaiting-source",
    note
  };
  const referral = linkedReferral(data, record);
  if (referral && referral !== item) {
    referral.statusBeforeSupplement = referral.status;
    referral.status = "supplement-required";
    referral.supplementRequest = item.supplementRequest;
  }
  const order = linkedOrder(data, item);
  if (order) {
    order.status = "supplement-required";
    order.result = note;
  }
  audit(item, command, actor, "referral-supplement-requested", note);
  const messages = notifyReferral(data, command, actor, item, `supplement-requested-v${item.supplementRequest.version}`, "Referral materials require supplementation", note, { target: false });
  return { referral, teleconsultation: record.kind === "teleconsultation" ? item : null, collaborationOrder: order, supplementRequest: item.supplementRequest, messages };
}

function normalizeMaterials(materials) {
  const normalized = rows(materials).map((material, index) => {
    const digest = requireText(material?.digest, `payload.materials[${index}].digest`).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error(`payload.materials[${index}].digest must be sha256`);
    const version = Number(material.version || 1);
    if (!Number.isInteger(version) || version < 1) throw new Error(`payload.materials[${index}].version must be a positive integer`);
    return {
      id: requireText(material.id, `payload.materials[${index}].id`),
      name: requireText(material.name, `payload.materials[${index}].name`),
      type: requireText(material.type, `payload.materials[${index}].type`),
      digest,
      version,
      sourceSystem: text(material.sourceSystem),
      recordId: text(material.recordId)
    };
  });
  if (!normalized.length || normalized.length > 50) throw new Error("payload.materials must contain between 1 and 50 items");
  return normalized;
}

function submitSupplement(data, command, actor) {
  const record = findReferralRecord(data, command.caseId);
  if (!record) throw new Error("referral request not found");
  const item = record.item;
  requireInstitution(actor, sourceOrg(item));
  if (text(item.status).toLowerCase() !== "supplement-required" || item.supplementRequest?.status !== "awaiting-source") {
    throw new Error("referral is not awaiting source supplementation");
  }
  const fulfilled = new Set(rows(command.payload.fulfilledRequirementIds).map(text).filter(Boolean));
  const required = rows(item.supplementRequest.requirements).map((requirement) => requirement.id);
  if (!required.every((id) => fulfilled.has(id))) throw new Error("all referral supplement requirements must be fulfilled");
  const materials = normalizeMaterials(command.payload.materials);
  const legacyMaterials = rows(item.materials).filter((material) => typeof material === "string").map(text).filter(Boolean);
  const merged = new Map(rows(item.materials).filter((material) => material && typeof material === "object" && material.id).map((material) => [material.id, material]));
  materials.forEach((material) => {
    const prior = merged.get(material.id);
    if (prior && Number(prior.version || 1) >= material.version && prior.digest !== material.digest) throw new Error(`material ${material.id} version must increase when content changes`);
    merged.set(material.id, material);
  });
  item.materials = [...merged.values()].sort((a, b) => a.id.localeCompare(b.id));
  if (legacyMaterials.length) item.legacyMaterialNames = [...new Set([...rows(item.legacyMaterialNames), ...legacyMaterials])];
  item.materialManifestDigest = createHash("sha256")
    .update(JSON.stringify(item.materials.map((material) => ({ id: material.id, version: material.version, digest: material.digest }))))
    .digest("hex");
  item.status = "supplement-submitted";
  item.supplementRequest = {
    ...item.supplementRequest,
    status: "awaiting-target-review",
    submittedAt: command.at,
    submittedBy: actorName(actor),
    fulfilledRequirementIds: [...fulfilled],
    materialIds: materials.map((material) => material.id),
    submissionNote: requireText(command.payload.note, "payload.note")
  };
  const referral = linkedReferral(data, record);
  if (referral && referral !== item) {
    referral.status = "supplement-submitted";
    referral.supplementRequest = item.supplementRequest;
    referral.materials = item.materials;
    referral.materialManifestDigest = item.materialManifestDigest;
  }
  const order = linkedOrder(data, item);
  if (order) {
    order.status = "supplement-submitted";
    order.result = item.supplementRequest.submissionNote;
  }
  audit(item, command, actor, "referral-supplement-submitted", item.supplementRequest.submissionNote);
  const messages = notifyReferral(data, command, actor, item, `supplement-submitted-v${item.supplementRequest.version}`, "Referral supplement awaiting review", item.supplementRequest.submissionNote, { source: false });
  return { referral, teleconsultation: record.kind === "teleconsultation" ? item : null, collaborationOrder: order, supplementRequest: item.supplementRequest, messages };
}

function reviewSupplement(data, command, actor) {
  const record = findReferralRecord(data, command.caseId);
  if (!record) throw new Error("referral request not found");
  const item = record.item;
  requireInstitution(actor, targetOrg(item));
  if (text(item.status).toLowerCase() !== "supplement-submitted" || item.supplementRequest?.status !== "awaiting-target-review") {
    throw new Error("referral supplement is not awaiting target review");
  }
  const decision = requireText(command.payload.decision, "payload.decision").toLowerCase();
  if (!["approved", "rejected"].includes(decision)) throw new Error("supplement decision must be approved or rejected");
  const note = requireText(command.payload.note, "payload.note");
  const restoredStatus = ["requested", "accepted"].includes(text(item.statusBeforeSupplement).toLowerCase())
    ? text(item.statusBeforeSupplement).toLowerCase()
    : "requested";
  item.status = decision === "approved" ? restoredStatus : "supplement-required";
  item.supplementRequest = {
    ...item.supplementRequest,
    status: decision === "approved" ? "approved" : "awaiting-source",
    reviewedAt: command.at,
    reviewedBy: actorName(actor),
    decision,
    reviewNote: note
  };
  if (decision === "rejected" && rows(command.payload.requirements).length) {
    item.supplementRequest.requirements = normalizeRequirements(command.payload.requirements);
    const dueAt = requireText(command.payload.dueAt, "payload.dueAt");
    if (!Number.isFinite(Date.parse(dueAt)) || Date.parse(dueAt) <= Date.parse(command.at)) throw new Error("supplement dueAt must be after the command timestamp");
    item.supplementRequest.dueAt = dueAt;
  }
  const referral = linkedReferral(data, record);
  if (referral && referral !== item) {
    referral.status = item.status;
    referral.supplementRequest = item.supplementRequest;
  }
  const order = linkedOrder(data, item);
  if (order) {
    order.status = item.status;
    order.result = note;
  }
  audit(item, command, actor, `referral-supplement-${decision}`, note);
  const messages = notifyReferral(data, command, actor, item, `supplement-${decision}-v${item.supplementRequest.version}`, `Referral supplement ${decision}`, note, { target: false });
  return { referral, teleconsultation: record.kind === "teleconsultation" ? item : null, collaborationOrder: order, supplementRequest: item.supplementRequest, messages };
}

function contractInstitution(data, contract) {
  const team = rows(data.phase2FamilyDoctorTeams).find((item) => item.id === contract.teamId);
  return text(contract.institutionCode || team?.institutionCode);
}

function schedulerMessage(data, command, actor, task, targetRole, targetOrgCode, title, body) {
  return appendMessage(data, command, actor, {
    suffix: `${task.kind}-${task.id}-${targetRole}`,
    collection: "phase2FamilyDoctorServiceTasks",
    sourceId: task.id,
    residentId: task.residentId,
    targetRole,
    targetOrgCode,
    title,
    body,
    notificationKey: `registration-referral:family-scheduler:${task.id}:${targetRole}:${targetOrgCode}`
  });
}

function runFamilyDoctorScheduler(data, command, actor) {
  if (actor.role === "institution" && !text(actor.orgCode)) throw new Error("institution actor orgCode is required");
  const note = requireText(command.payload.note, "payload.note");
  const asOfMs = Date.parse(command.at);
  const serviceLeadDays = Number(command.payload.serviceLeadDays ?? 7);
  const renewalLeadDays = Number(command.payload.renewalLeadDays ?? 30);
  if (!Number.isInteger(serviceLeadDays) || serviceLeadDays < 0 || serviceLeadDays > 30) throw new Error("serviceLeadDays must be an integer between 0 and 30");
  if (!Number.isInteger(renewalLeadDays) || renewalLeadDays < 1 || renewalLeadDays > 180) throw new Error("renewalLeadDays must be an integer between 1 and 180");
  const scopedContracts = rows(data.phase2FamilyDoctorContracts).filter((contract) => {
    if (!["active", "renewal-pending"].includes(contract.status)) return false;
    return actor.role === "commission" || contractInstitution(data, contract) === text(actor.orgCode);
  });
  const created = [];
  const expired = [];
  const messages = [];
  scopedContracts.forEach((contract) => {
    const institutionCode = contractInstitution(data, contract);
    const endMs = Date.parse(contract.endDate || "");
    if (Number.isFinite(endMs) && endMs < asOfMs) {
      contract.status = "expired";
      contract.expiredAt = command.at;
      contract.expirationReason = "contract end date elapsed";
      const team = rows(data.phase2FamilyDoctorTeams).find((item) => item.id === contract.teamId);
      if (team && Number(team.signedResidents || 0) > 0) team.signedResidents = Number(team.signedResidents) - 1;
      expired.push(contract.id);
      const task = {
        id: `fdst-${contract.id}-expired`,
        contractId: contract.id,
        residentId: contract.residentId,
        institutionCode,
        kind: "contract-expired",
        status: "open",
        dueAt: command.at,
        createdAt: command.at,
        note,
        productionEvidence: false
      };
      data.phase2FamilyDoctorServiceTasks = appendById(data.phase2FamilyDoctorServiceTasks, task);
      created.push(task);
      messages.push(schedulerMessage(data, command, actor, task, "citizen", "", "Family doctor contract expired", note));
      return;
    }
    const plannedAt = text(contract.nextServiceAt);
    const plannedMs = Date.parse(plannedAt);
    if (Number.isFinite(plannedMs) && plannedMs <= asOfMs + serviceLeadDays * 86_400_000) {
      const taskId = `fdst-${contract.id}-service-${plannedAt.slice(0, 10)}`;
      if (!rows(data.phase2FamilyDoctorServiceTasks).some((task) => task.id === taskId)) {
        const task = {
          id: taskId,
          contractId: contract.id,
          residentId: contract.residentId,
          institutionCode,
          teamId: contract.teamId,
          packageId: contract.packageId,
          kind: "service-due",
          status: plannedMs < asOfMs ? "overdue" : "scheduled",
          plannedAt,
          dueAt: plannedAt,
          createdAt: command.at,
          note,
          productionEvidence: false
        };
        data.phase2FamilyDoctorServiceTasks = appendById(data.phase2FamilyDoctorServiceTasks, task);
        created.push(task);
        messages.push(schedulerMessage(data, command, actor, task, "institution", institutionCode, "Family doctor service task due", `${plannedAt}: ${note}`));
      }
    }
    if (Number.isFinite(endMs) && endMs <= asOfMs + renewalLeadDays * 86_400_000 && contract.renewalStatus !== "pending-review") {
      const taskId = `fdst-${contract.id}-renewal-${text(contract.endDate).slice(0, 10)}`;
      if (!rows(data.phase2FamilyDoctorServiceTasks).some((task) => task.id === taskId)) {
        const task = {
          id: taskId,
          contractId: contract.id,
          residentId: contract.residentId,
          institutionCode,
          kind: "renewal-reminder",
          status: "open",
          dueAt: contract.endDate,
          createdAt: command.at,
          note,
          productionEvidence: false
        };
        data.phase2FamilyDoctorServiceTasks = appendById(data.phase2FamilyDoctorServiceTasks, task);
        created.push(task);
        messages.push(schedulerMessage(data, command, actor, task, "citizen", "", "Family doctor renewal reminder", `${contract.endDate}: ${note}`));
      }
    }
  });
  return { contracts: scopedContracts.length, created, expired, messages };
}

const HANDLERS = Object.freeze({
  "create-down-referral": createDownReferral,
  "request-referral-supplement": requestSupplement,
  "submit-referral-supplement": submitSupplement,
  "review-referral-supplement": reviewSupplement,
  "run-family-doctor-scheduler": runFamilyDoctorScheduler
});

function applyAdvancedCommand(data, command, actor) {
  const handler = HANDLERS[command.action];
  return handler ? handler(data, command, actor) : null;
}

module.exports = {
  ADVANCED_COMMAND_CONTRACTS,
  applyAdvancedCommand
};
