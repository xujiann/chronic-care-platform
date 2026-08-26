"use strict";

const { createHash } = require("node:crypto");
const { createCompliantExportRequest } = require("./compliant-export-workflow");
const { canReadResearchDataset, normalizeResearchPurpose } = require("./sandbox-read-model");

const CONTRACT_ID = "research-dataset-write-command.v1";
const MAX_COMMAND_RECEIPTS = 100;
const writeTails = new Map();
const COMMISSION_ORG_TYPES = new Set(["city", "health_admin", "platform"]);

class ResearchDatasetCommandError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "ResearchDatasetCommandError";
    this.code = code;
    this.status = status;
  }
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((result, key) => {
      if (!["commandId", "idempotencyKey"].includes(key)) result[key] = stableValue(value[key]);
      return result;
    }, {});
  }
  return value;
}

function sha256(value) {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(stableValue(value))).digest("hex");
}

function text(value) {
  return String(value ?? "").trim();
}

function actorId(user = {}) {
  return text(user.username || user.subject || user.id || user.role);
}

function actorScope(user = {}) {
  return {
    id: actorId(user),
    role: text(user.role),
    orgCode: text(user.orgCode).toUpperCase(),
    orgType: text(user.orgType).toLowerCase()
  };
}

function commandError(code, message, status) {
  throw new ResearchDatasetCommandError(code, message, status);
}

function boundedText(value, field, maximumLength, required = false) {
  const normalized = text(value);
  if (required && !normalized) commandError("RESEARCH_COMMAND_INVALID", `${field} is required`);
  if (normalized.length > maximumLength) commandError("RESEARCH_COMMAND_INVALID", `${field} is too long`);
  return normalized;
}

function currentVersion(dataset = {}) {
  if (dataset.domainVersion === undefined || dataset.domainVersion === null || dataset.domainVersion === "") return 0;
  if (!Number.isSafeInteger(dataset.domainVersion) || dataset.domainVersion < 0) {
    commandError("RESEARCH_COMMAND_AGGREGATE_INVALID", "research dataset version is invalid", 409);
  }
  return dataset.domainVersion;
}

function expectedVersion(payload, version) {
  if (payload.expectedVersion === undefined) {
    return { value: version, binding: "compat-current" };
  }
  if (!Number.isSafeInteger(payload.expectedVersion) || payload.expectedVersion < 0) {
    commandError("RESEARCH_COMMAND_EXPECTED_VERSION_REQUIRED", "expectedVersion must be a non-negative integer");
  }
  return { value: payload.expectedVersion, binding: payload.expectedVersion };
}

function commandIdentity({ endpoint, datasetId, payload, user, headerKey, version }) {
  const scope = actorScope(user);
  if (!scope.id || !scope.role) commandError("RESEARCH_COMMAND_ACTOR_REQUIRED", "authenticated actor is required", 403);
  const expected = expectedVersion(payload, version);
  const semanticPayload = { ...payload };
  delete semanticPayload.commandId;
  delete semanticPayload.idempotencyKey;
  delete semanticPayload.expectedVersion;
  const requestDigest = sha256({ endpoint, datasetId, expectedVersion: expected.binding, payload: semanticPayload });
  for (const [field, value] of [["Idempotency-Key", headerKey], ["commandId", payload.commandId], ["idempotencyKey", payload.idempotencyKey]]) {
    if (value !== undefined && value !== null && typeof value !== "string") {
      commandError("RESEARCH_COMMAND_INVALID", `${field} must be a string`);
    }
  }
  const selectedKey = boundedText(headerKey, "Idempotency-Key", 160)
    || boundedText(payload.commandId || payload.idempotencyKey || payload.id, "commandId", 160)
    || `canonical:${requestDigest}`;
  return {
    commandKeyHash: sha256({ contractId: CONTRACT_ID, endpoint, datasetId, actor: scope, selectedKey }),
    requestDigest,
    expectedVersion: expected.value
  };
}

function authorizeDataset(user, dataset, endpoint) {
  if (!canReadResearchDataset(user, dataset)) {
    commandError("RESEARCH_DATASET_SCOPE_DENIED", "Dataset is outside the caller research scope", 403);
  }
  if (user.role === "commission" && !COMMISSION_ORG_TYPES.has(text(user.orgType).toLowerCase())) {
    commandError("RESEARCH_DATASET_SCOPE_DENIED", "Commission research scope is not authorized", 403);
  }
  if (endpoint === "approval" && actorId(user) === text(dataset.createdBy)) {
    commandError("RESEARCH_APPROVAL_SEPARATION_REQUIRED", "Dataset requester cannot approve the same dataset", 403);
  }
}

function projectResearchDataset(dataset = {}) {
  const { commandReceipts, ...projected } = dataset;
  return structuredClone(projected);
}

function withResearchDatasetWriteLock(datasetId, work) {
  const key = text(datasetId);
  const previous = writeTails.get(key) || Promise.resolve();
  const pending = previous.then(work, work);
  const tail = pending.then(() => undefined, () => undefined);
  writeTails.set(key, tail);
  tail.finally(() => {
    if (writeTails.get(key) === tail) writeTails.delete(key);
  });
  return pending;
}

function requireReadyDataset(dataset, requireDatasetSandboxAccess) {
  if (!requireDatasetSandboxAccess(dataset)) {
    commandError(
      "RESEARCH_DATASET_NOT_RELEASED",
      "Dataset is not approved, de-identified, governance-ready, evidence-ready, and active",
      403
    );
  }
}

function requireApprovalEvidence(dataset) {
  const documents = Array.isArray(dataset.evidenceDocuments) ? dataset.evidenceDocuments : [];
  for (const type of ["ethics-approval", "data-use-agreement"]) {
    if (!documents.some((item) => item?.type === type && item.status !== "rejected")) {
      commandError("RESEARCH_APPROVAL_EVIDENCE_REQUIRED", "Ethics approval and data-use evidence are required", 409);
    }
  }
}

function receiptReplay(dataset, identity, state, endpoint) {
  const receipts = Array.isArray(dataset.commandReceipts) ? dataset.commandReceipts : [];
  const receipt = receipts.find((item) => item.endpoint === endpoint && item.commandKeyHash === identity.commandKeyHash);
  if (!receipt) return null;
  if (receipt.requestDigest !== identity.requestDigest) {
    commandError("RESEARCH_COMMAND_IDEMPOTENCY_CONFLICT", "Idempotency-Key is bound to another research command", 409);
  }
  if (endpoint === "compliant-export") {
    const exportRecord = (Array.isArray(state.compliantDataExports) ? state.compliantDataExports : [])
      .find((item) => item.id === receipt.resultId);
    if (!exportRecord) commandError("RESEARCH_COMMAND_RECEIPT_INVALID", "Research command receipt target is missing", 409);
    return { response: { ...structuredClone(exportRecord), commandReceipts: [] }, replayed: true };
  }
  if (endpoint === "sandbox-access") return { response: buildSandboxResponse(dataset), replayed: true };
  return { response: projectResearchDataset(dataset), replayed: true };
}

function appendReceipt(dataset, identity, endpoint, resultId, now) {
  const receipts = Array.isArray(dataset.commandReceipts) ? dataset.commandReceipts : [];
  if (receipts.length >= MAX_COMMAND_RECEIPTS) {
    commandError("RESEARCH_COMMAND_RECEIPT_CAPACITY_EXCEEDED", "Research command receipt capacity is exhausted", 409);
  }
  dataset.commandReceipts = [
    ...receipts,
    {
      contractId: CONTRACT_ID,
      endpoint,
      commandKeyHash: identity.commandKeyHash,
      requestDigest: identity.requestDigest,
      resultVersion: dataset.domainVersion,
      resultId: text(resultId || dataset.id),
      at: now
    }
  ];
}

function buildSandboxResponse(dataset) {
  return {
    datasetId: dataset.id,
    deidentified: true,
    access: {
      mode: "read-only",
      contractId: "research-sandbox-read-model.v1",
      contractVersion: "1.0.0",
      endpoint: `/api/research/datasets/${encodeURIComponent(dataset.id)}/read-model`,
      expiresInMinutes: 120
    },
    controls: {
      minimumNecessary: dataset.governance?.minimumNecessary === true,
      reidentificationProhibited: dataset.governance?.reidentificationProhibited === true,
      exportReviewRequired: dataset.governance?.exportReviewRequired !== false
    }
  };
}

function applyResearchDatasetCommand(options) {
  const {
    state,
    datasetId,
    endpoint,
    payload = {},
    user,
    headerKey,
    appendResearchAudit,
    normalizeResearchApproval,
    normalizeResearchEvidenceDocument,
    requireDatasetSandboxAccess,
    now = new Date().toISOString()
  } = options;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    commandError("RESEARCH_COMMAND_INVALID", "Research command body must be an object");
  }
  const datasets = Array.isArray(state.researchDatasets) ? state.researchDatasets : [];
  const index = datasets.findIndex((item) => item.id === datasetId);
  if (index < 0) commandError("RESEARCH_DATASET_NOT_FOUND", "Research dataset not found", 404);
  const dataset = datasets[index];
  authorizeDataset(user, dataset, endpoint);
  const identity = commandIdentity({ endpoint, datasetId, payload, user, headerKey, version: currentVersion(dataset) });
  const replay = receiptReplay(dataset, identity, state, endpoint);
  if (replay) return { state, ...replay };
  if (identity.expectedVersion !== currentVersion(dataset)) {
    commandError("RESEARCH_COMMAND_VERSION_CONFLICT", "Research dataset version changed; retry with a fresh snapshot", 409);
  }

  let nextDataset = structuredClone(dataset);
  let response;
  let auditAction;
  let auditDetail;
  let auditResult = "allowed";
  let resultId = datasetId;

  if (endpoint === "approval") {
    requireApprovalEvidence(dataset);
    try {
      nextDataset = normalizeResearchApproval(nextDataset, payload, user);
    } catch (error) {
      if (error instanceof ResearchDatasetCommandError) throw error;
      commandError("RESEARCH_COMMAND_INVALID", text(error?.message) || "Research approval is invalid");
    }
    if (nextDataset.approval?.decision === "approved" && (
      !text(nextDataset.governance?.dataUseAgreement)
      || nextDataset.governance?.minimumNecessary !== true
      || nextDataset.governance?.reidentificationProhibited !== true
    )) commandError("RESEARCH_APPROVAL_MINIMIZATION_REQUIRED", "Minimum-necessary controls are required", 409);
    auditAction = "ethics-approval";
    auditDetail = nextDataset.approval?.decision || "approved";
  } else if (endpoint === "evidence") {
    let document;
    try {
      document = normalizeResearchEvidenceDocument(payload, user, nextDataset);
    } catch (error) {
      if (error instanceof ResearchDatasetCommandError) throw error;
      commandError("RESEARCH_COMMAND_INVALID", text(error?.message) || "Research evidence is invalid");
    }
    if (user.role === "institution") document.status = "submitted";
    nextDataset.evidenceDocuments = [
      document,
      ...(Array.isArray(nextDataset.evidenceDocuments) ? nextDataset.evidenceDocuments : [])
    ].slice(0, 50);
    auditAction = "evidence-document";
    auditDetail = `${document.type}:${document.referenceNo}`;
  } else if (endpoint === "outcomes") {
    requireReadyDataset(dataset, requireDatasetSandboxAccess);
    const title = boundedText(payload.title || "research outcome", "title", 200, true);
    const summary = boundedText(payload.summary, "summary", 2000, true);
    const returnedTo = Array.isArray(payload.returnedTo)
      ? payload.returnedTo.map((item) => boundedText(item, "returnedTo", 100, true)).filter(Boolean)
      : ["diseaseRegistryModels"];
    const outcome = {
      at: now,
      by: actorId(user),
      title,
      summary,
      registryImpact: boundedText(payload.registryImpact, "registryImpact", 1000),
      returnedTo
    };
    nextDataset.outcomes = [outcome, ...(Array.isArray(nextDataset.outcomes) ? nextDataset.outcomes : [])].slice(0, 50);
    auditAction = "outcome-return";
    auditDetail = title;
  } else if (endpoint === "sandbox-access") {
    requireReadyDataset(dataset, requireDatasetSandboxAccess);
    const purpose = normalizeResearchPurpose(payload.purpose);
    nextDataset.sandbox = {
      ...(nextDataset.sandbox || {}),
      status: "active",
      lastAccessAt: now,
      lastAccessBy: actorId(user)
    };
    auditAction = "sandbox-access";
    auditDetail = purpose;
  } else if (endpoint === "compliant-export") {
    requireReadyDataset(dataset, requireDatasetSandboxAccess);
    const exports = Array.isArray(state.compliantDataExports) ? state.compliantDataExports : [];
    const exportRequest = createCompliantExportRequest(payload, user, nextDataset, {
      now,
      idGenerator: () => identity.commandKeyHash.slice(0, 24)
    });
    if (exports.some((item) => item.id === exportRequest.id)) {
      commandError("RESEARCH_EXPORT_ID_CONFLICT", "Compliant export id already exists", 409);
    }
    state.compliantDataExports = [exportRequest, ...exports].slice(0, 120);
    response = exportRequest;
    resultId = exportRequest.id;
    auditAction = "compliant-export-request";
    auditDetail = `${exportRequest.id}:${exportRequest.destination}`;
    auditResult = "submitted";
  } else {
    commandError("RESEARCH_COMMAND_INVALID", "Research command endpoint is not supported");
  }

  nextDataset.domainVersion = currentVersion(dataset) + 1;
  datasets[index] = nextDataset;
  state.researchDatasets = datasets;
  appendResearchAudit(state, user, nextDataset, auditAction, auditDetail, auditResult);
  appendReceipt(nextDataset, identity, endpoint, resultId, now);
  if (!response) response = endpoint === "sandbox-access" ? buildSandboxResponse(nextDataset) : projectResearchDataset(nextDataset);
  return { state, response, replayed: false };
}

module.exports = {
  CONTRACT_ID,
  ResearchDatasetCommandError,
  applyResearchDatasetCommand,
  projectResearchDataset,
  withResearchDatasetWriteLock
};
