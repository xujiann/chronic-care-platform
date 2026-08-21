"use strict";

const { createHash, randomUUID } = require("node:crypto");

const CONTRACT_ID = "research-compliant-export-workflow.v1";
const CONTRACT_VERSION = 1;
const MAX_COMMAND_RECEIPTS = 100;

const FORBIDDEN_REQUESTED_FIELDS = new Set([
  "address",
  "bankAccount",
  "credentialNumber",
  "email",
  "fullName",
  "idCard",
  "identityNumber",
  "medicalRecordNumber",
  "mobile",
  "name",
  "nationalId",
  "patientId",
  "personId",
  "phone",
  "rawRecord",
  "residentId",
  "token"
].map((item) => item.toLowerCase().replace(/[^a-z0-9]/g, "")));

class ResearchExportWorkflowError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "ResearchExportWorkflowError";
    this.code = code;
    this.status = status;
  }
}

function workflowError(code, message, status = 400) {
  return new ResearchExportWorkflowError(code, message, status);
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function commandDigest(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function requiredText(value, field, maximumLength = 500) {
  const normalized = String(value || "").trim();
  if (!normalized) throw workflowError("RESEARCH_EXPORT_INVALID_REQUEST", `${field} is required`);
  if (normalized.length > maximumLength) {
    throw workflowError("RESEARCH_EXPORT_INVALID_REQUEST", `${field} must not exceed ${maximumLength} characters`);
  }
  return normalized;
}

function optionalText(value, field, maximumLength = 500) {
  const normalized = String(value || "").trim();
  if (normalized.length > maximumLength) {
    throw workflowError("RESEARCH_EXPORT_INVALID_REQUEST", `${field} must not exceed ${maximumLength} characters`);
  }
  return normalized;
}

function actorId(user = {}) {
  return String(user.username || user.subject || user.id || user.role || "").trim();
}

function normalizeRequestedFields(value) {
  const requestedFields = Array.isArray(value)
    ? value
    : String(value || "").split(/[,;\n]/);
  const normalized = [...new Set(requestedFields.map((item) => String(item).trim()).filter(Boolean))];
  if (!normalized.length) {
    throw workflowError("RESEARCH_EXPORT_INVALID_REQUEST", "requestedFields are required");
  }
  if (normalized.length > 100 || normalized.some((item) => item.length > 100)) {
    throw workflowError("RESEARCH_EXPORT_INVALID_REQUEST", "requestedFields exceed the allowed field count or length");
  }
  const forbidden = normalized.find((item) => String(item).split(/[.[\]]/).filter(Boolean).some((segment) => (
    FORBIDDEN_REQUESTED_FIELDS.has(segment.toLowerCase().replace(/[^a-z0-9]/g, ""))
  )));
  if (forbidden) {
    throw workflowError("RESEARCH_EXPORT_DIRECT_IDENTIFIER_FORBIDDEN", `requested field ${forbidden} is a direct identifier`, 403);
  }
  return normalized;
}

function resolveEvidenceReference(payload, dataset) {
  const explicit = optionalText(payload.evidenceRef, "evidenceRef", 200);
  if (explicit) return explicit;
  const documents = Array.isArray(dataset.evidenceDocuments) ? dataset.evidenceDocuments : [];
  const evidenceDocument = documents.find((item) => item.type === "export-review" && item.status !== "rejected")
    || documents.find((item) => item.type === "data-use-agreement" && item.status !== "rejected");
  return String(evidenceDocument?.id || evidenceDocument?.referenceNo || "").trim();
}

function createCompliantExportRequest(payload = {}, user = {}, dataset = {}, options = {}) {
  const now = String(options.now || new Date().toISOString());
  const requester = actorId(user);
  if (!requester) throw workflowError("RESEARCH_EXPORT_ACTOR_REQUIRED", "authenticated requester is required", 403);
  if (!dataset.id) throw workflowError("RESEARCH_EXPORT_DATASET_REQUIRED", "dataset is required");
  const retentionDays = Number(payload.retentionDays || dataset.governance?.retentionDays || 180);
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) {
    throw workflowError("RESEARCH_EXPORT_INVALID_RETENTION", "retentionDays must be an integer between 1 and 3650");
  }
  const idGenerator = typeof options.idGenerator === "function" ? options.idGenerator : randomUUID;
  const id = optionalText(payload.id, "id", 200) || `cde-${dataset.id}-${idGenerator()}`;
  const purpose = requiredText(payload.purpose, "purpose", 1000);
  const destination = requiredText(payload.destination, "destination", 500);
  const requestedFields = normalizeRequestedFields(payload.requestedFields);
  const evidenceRef = resolveEvidenceReference(payload, dataset);
  const exportFormat = optionalText(payload.exportFormat || "csv", "exportFormat", 30).toLowerCase();
  if (!new Set(["csv", "json", "parquet"]).has(exportFormat)) {
    throw workflowError("RESEARCH_EXPORT_FORMAT_UNSUPPORTED", "exportFormat must be csv, json, or parquet");
  }

  return {
    id,
    contractId: CONTRACT_ID,
    domainVersion: CONTRACT_VERSION,
    datasetId: String(dataset.id),
    datasetName: String(dataset.name || dataset.id),
    purpose,
    destination,
    requestedFields,
    exportFormat,
    reviewStatus: "pending",
    exportStatus: "blocked",
    deidentified: true,
    minimumNecessary: false,
    watermark: "",
    evidenceRef,
    reviewer: "",
    requestedBy: requester,
    requestedAt: now,
    reviewedAt: "",
    retentionDays,
    policyBasis: Array.isArray(dataset.governance?.policyBasis)
      ? [...dataset.governance.policyBasis]
      : ["PIPL", "Data Security Law", "Network Data Security Regulation", "Ethics Review Measures"],
    decisionHistory: [{
      at: now,
      by: requester,
      role: String(user.role || ""),
      action: "requested",
      from: "none",
      to: "pending",
      version: CONTRACT_VERSION,
      evidenceRef
    }],
    commandReceipts: []
  };
}

function normalizeAction(payload = {}) {
  const action = requiredText(payload.action, "action", 30).toLowerCase();
  if (!new Set(["approve", "reject", "release"]).has(action)) {
    throw workflowError("RESEARCH_EXPORT_ACTION_UNSUPPORTED", "action must be approve, reject, or release");
  }
  return action;
}

function semanticCommand(payload, action) {
  return {
    action,
    expectedVersion: payload.expectedVersion,
    reviewEvidenceRef: String(payload.reviewEvidenceRef || "").trim(),
    reviewNote: String(payload.reviewNote || "").trim(),
    releaseEvidenceRef: String(payload.releaseEvidenceRef || "").trim(),
    releaseNote: String(payload.releaseNote || "").trim(),
    watermark: String(payload.watermark || "").trim()
  };
}

function applyCompliantExportAction(exportRecord = {}, payload = {}, user = {}, options = {}) {
  const now = String(options.now || new Date().toISOString());
  const actor = actorId(user);
  if (String(user.role || "") !== "commission") {
    throw workflowError("RESEARCH_EXPORT_REVIEW_ROLE_REQUIRED", "commission role is required for export decisions", 403);
  }
  if (!actor) throw workflowError("RESEARCH_EXPORT_ACTOR_REQUIRED", "authenticated decision actor is required", 403);
  if (!exportRecord.id) throw workflowError("RESEARCH_EXPORT_NOT_FOUND", "compliant export not found", 404);
  if (actor === String(exportRecord.requestedBy || "")) {
    throw workflowError("RESEARCH_EXPORT_REVIEWER_SEPARATION_REQUIRED", "requester cannot review or release the same export", 403);
  }

  const action = normalizeAction(payload);
  const commandId = requiredText(options.commandId || payload.commandId, "commandId", 200);
  const digest = commandDigest(semanticCommand(payload, action));
  const receipts = Array.isArray(exportRecord.commandReceipts) ? exportRecord.commandReceipts : [];
  const priorReceipt = receipts.find((item) => item.commandId === commandId);
  if (priorReceipt) {
    if (priorReceipt.digest !== digest) {
      throw workflowError("RESEARCH_EXPORT_IDEMPOTENCY_CONFLICT", "commandId was already used with a different command", 409);
    }
    return { exportRecord: { ...exportRecord }, replayed: true };
  }

  const currentVersion = Number.isInteger(exportRecord.domainVersion) ? exportRecord.domainVersion : 0;
  const expectedVersion = Number(payload.expectedVersion);
  if (!Number.isInteger(expectedVersion)) {
    throw workflowError("RESEARCH_EXPORT_EXPECTED_VERSION_REQUIRED", "expectedVersion must be an integer");
  }
  if (expectedVersion !== currentVersion) {
    throw workflowError("RESEARCH_EXPORT_VERSION_CONFLICT", `expectedVersion ${expectedVersion} does not match current version ${currentVersion}`, 409);
  }

  const nextVersion = currentVersion + 1;
  const next = {
    ...exportRecord,
    requestedFields: [...(Array.isArray(exportRecord.requestedFields) ? exportRecord.requestedFields : [])],
    decisionHistory: [...(Array.isArray(exportRecord.decisionHistory) ? exportRecord.decisionHistory : [])],
    commandReceipts: [...receipts]
  };
  const from = `${String(exportRecord.reviewStatus || "unknown")}/${String(exportRecord.exportStatus || "unknown")}`;
  let evidenceRef = "";
  let note = "";

  if (action === "approve") {
    if (exportRecord.reviewStatus !== "pending" || exportRecord.exportStatus !== "blocked") {
      throw workflowError("RESEARCH_EXPORT_ILLEGAL_TRANSITION", "only a pending blocked request can be approved", 409);
    }
    evidenceRef = requiredText(payload.reviewEvidenceRef, "reviewEvidenceRef", 200);
    note = optionalText(payload.reviewNote, "reviewNote", 1000);
    next.reviewStatus = "approved";
    next.exportStatus = "approved-pending-release";
    next.minimumNecessary = true;
    next.reviewer = actor;
    next.reviewedAt = now;
    next.reviewEvidenceRef = evidenceRef;
    next.reviewNote = note;
  } else if (action === "reject") {
    const rejectable = (exportRecord.reviewStatus === "pending" && exportRecord.exportStatus === "blocked")
      || (exportRecord.reviewStatus === "approved" && exportRecord.exportStatus === "approved-pending-release");
    if (!rejectable) {
      throw workflowError("RESEARCH_EXPORT_ILLEGAL_TRANSITION", "only a pending or approved-pending-release request can be rejected", 409);
    }
    evidenceRef = requiredText(payload.reviewEvidenceRef, "reviewEvidenceRef", 200);
    note = requiredText(payload.reviewNote, "reviewNote", 1000);
    next.reviewStatus = "rejected";
    next.exportStatus = "blocked";
    next.minimumNecessary = false;
    next.reviewer = actor;
    next.reviewedAt = now;
    next.reviewEvidenceRef = evidenceRef;
    next.reviewNote = note;
  } else {
    if (exportRecord.reviewStatus !== "approved" || exportRecord.exportStatus !== "approved-pending-release") {
      throw workflowError("RESEARCH_EXPORT_ILLEGAL_TRANSITION", "only an independently approved request can be released", 409);
    }
    evidenceRef = requiredText(payload.releaseEvidenceRef, "releaseEvidenceRef", 200);
    note = optionalText(payload.releaseNote, "releaseNote", 1000);
    next.watermark = requiredText(payload.watermark, "watermark", 300);
    next.exportStatus = "released";
    next.releasedBy = actor;
    next.releasedAt = now;
    next.releaseEvidenceRef = evidenceRef;
    next.releaseNote = note;
  }

  next.domainVersion = nextVersion;
  next.decisionHistory.push({
    at: now,
    by: actor,
    role: String(user.role || ""),
    action,
    from,
    to: `${next.reviewStatus}/${next.exportStatus}`,
    version: nextVersion,
    evidenceRef,
    note,
    commandId
  });
  next.commandReceipts.push({ commandId, digest, action, resultVersion: nextVersion, at: now, by: actor });
  next.commandReceipts = next.commandReceipts.slice(-MAX_COMMAND_RECEIPTS);
  return { exportRecord: next, replayed: false };
}

function isExportVisibleToUser(exportRecord, user = {}) {
  if (user.role === "commission") return true;
  return user.role === "institution" && String(exportRecord.requestedBy || "") === actorId(user);
}

module.exports = {
  CONTRACT_ID,
  CONTRACT_VERSION,
  FORBIDDEN_REQUESTED_FIELDS,
  ResearchExportWorkflowError,
  applyCompliantExportAction,
  commandDigest,
  createCompliantExportRequest,
  isExportVisibleToUser
};
