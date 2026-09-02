"use strict";

const crypto = require("node:crypto");
const defaultCatalog = require("../../../config/procurement-requirement-governance.json");
const defaultRegistry = require("../../../config/platform-capability-registry.json");
const { validateGovernanceCatalog } = require("./procurement-requirement-contracts");
const { StateCommandError } = require("../storage/state-command-consistency");

const FORBIDDEN_KEYS = /(?:path|filename|raw|excerpt|prompt|instruction|patient|resident|identity|credential|password|secret|token)/i;

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(canonical(value))).digest("hex")}`;
}

function assertSafe(value, location = "artifact") {
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.test(key)) throw new TypeError(`${location}.${key} is not allowed`);
    assertSafe(nested, `${location}.${key}`);
  }
}

const CATALOG_STATE_KEYS = new Set(["schemaVersion", "version", "documents", "events", "commands"]);
const CATALOG_EVENT_KEYS = new Set(["eventId", "action", "actorDigest", "artifactDigest", "documentCount", "version", "at"]);
const CATALOG_COMMAND_KEYS = new Set(["commandKeyDigest", "requestDigest", "resultingVersion", "resultSnapshot", "recordedAt"]);
const CATALOG_RESULT_KEYS = new Set(["schemaVersion", "version", "registeredDocuments", "registeredCandidates", "documentIds", "artifactDigest", "productionReady"]);
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;

function exactKeys(value, allowed) {
  return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every((key) => allowed.has(key));
}

function validTimestamp(value) {
  return typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));
}

function validatePersistedCatalogState(state) {
  if (!exactKeys(state, CATALOG_STATE_KEYS)
    || state.schemaVersion !== "procurement-requirement-catalog-state-v1"
    || !Number.isInteger(state.version) || state.version < 0
    || !Array.isArray(state.documents) || !Array.isArray(state.events) || !Array.isArray(state.commands)
    || state.version !== state.events.length || state.version !== state.commands.length
    || state.events.length > defaultCatalog.limits.maximumReviewEvents
    || state.commands.length > defaultCatalog.limits.maximumCommandReceipts) return false;

  const registeredDocumentIds = [];
  for (let index = 0; index < state.commands.length; index += 1) {
    const event = state.events[index];
    const receipt = state.commands[index];
    const result = receipt?.resultSnapshot;
    if (!exactKeys(event, CATALOG_EVENT_KEYS) || !exactKeys(receipt, CATALOG_COMMAND_KEYS) || !exactKeys(result, CATALOG_RESULT_KEYS)) return false;
    if (!SHA256_PATTERN.test(String(receipt.commandKeyDigest || ""))
      || !SHA256_PATTERN.test(String(receipt.requestDigest || ""))
      || !SHA256_PATTERN.test(String(event.actorDigest || ""))
      || !SHA256_PATTERN.test(String(event.artifactDigest || ""))
      || event.eventId !== `pci-${receipt.commandKeyDigest.slice(7, 23)}`
      || event.action !== "register-import-batch"
      || event.version !== index + 1
      || receipt.resultingVersion !== event.version
      || result.schemaVersion !== "procurement-import-registration-result-v1"
      || result.version !== event.version
      || result.productionReady !== false
      || event.artifactDigest !== result.artifactDigest
      || !SHA256_PATTERN.test(String(result.artifactDigest || ""))
      || !validTimestamp(event.at) || event.at !== receipt.recordedAt
      || !Number.isInteger(event.documentCount) || event.documentCount < 1
      || event.documentCount !== result.registeredDocuments
      || !Number.isInteger(result.registeredCandidates) || result.registeredCandidates < 1
      || !Array.isArray(result.documentIds) || result.documentIds.length !== result.registeredDocuments
      || new Set(result.documentIds).size !== result.documentIds.length
      || result.documentIds.some((id) => typeof id !== "string" || id.length < 4 || id.length > 96)) return false;
    const batchDocuments = state.documents.slice(registeredDocumentIds.length, registeredDocumentIds.length + result.documentIds.length);
    if (batchDocuments.length !== result.documentIds.length
      || batchDocuments.some((document, documentIndex) => document?.id !== result.documentIds[documentIndex] || !Array.isArray(document.candidates))
      || batchDocuments.reduce((count, document) => count + document.candidates.length, 0) !== result.registeredCandidates) return false;
    registeredDocumentIds.push(...result.documentIds);
  }
  const actualDocumentIds = state.documents.map((document) => document?.id);
  return registeredDocumentIds.length === actualDocumentIds.length
    && registeredDocumentIds.every((id, index) => id === actualDocumentIds[index]);
}

function baseState(value) {
  if (value === undefined || value === null) return { schemaVersion: "procurement-requirement-catalog-state-v1", version: 0, documents: [], events: [], commands: [] };
  const state = value && typeof value === "object" && !Array.isArray(value) ? structuredClone(value) : null;
  if (!state || !validatePersistedCatalogState(state)) throw new TypeError("procurement requirement catalog state is invalid");
  return state;
}

function buildEffectiveProcurementCatalog(data = {}, options = {}) {
  const catalog = structuredClone(options.catalog || defaultCatalog);
  const state = baseState(data.procurementRequirementCatalog);
  catalog.documents.push(...structuredClone(state.documents));
  validateGovernanceCatalog(catalog, { ...options, registry: options.registry || defaultRegistry });
  return catalog;
}

function validateArtifact(artifact, catalog, registry, options = {}) {
  assertSafe(artifact);
  const allowed = new Set(["schemaVersion", "generatedAt", "documents", "revisionComparisons", "summary", "productionReady", "boundary"]);
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact) || Object.keys(artifact).some((key) => !allowed.has(key))) throw new TypeError("controlled import artifact is invalid");
  if (artifact.schemaVersion !== "procurement-controlled-import-batch-v2" || artifact.productionReady !== false) throw new TypeError("controlled import artifact boundary is invalid");
  if (!Array.isArray(artifact.documents) || artifact.documents.length < 1 || artifact.documents.length > catalog.limits.maximumBatchDocuments) throw new TypeError("controlled import artifact document count is invalid");
  if (artifact.documents.some((document) => document.securityStatus !== "unscanned-external-source" || document.scanEvidenceDigest !== null)) {
    throw new TypeError("runtime registration cannot trust client-supplied scanner attestations");
  }
  const summary = artifact.summary;
  if (!summary || typeof summary !== "object" || Array.isArray(summary) || Object.keys(summary).sort().join(",") !== "byteSize,candidates,documents,reviewedPages") throw new TypeError("controlled import artifact summary is invalid");
  const calculated = artifact.documents.reduce((result, document) => ({
    documents: result.documents + 1,
    byteSize: result.byteSize + Number(document.byteSize || 0),
    candidates: result.candidates + (Array.isArray(document.candidates) ? document.candidates.length : 0),
    reviewedPages: result.reviewedPages + Number(document.reviewedPageCount || 0)
  }), { documents: 0, byteSize: 0, candidates: 0, reviewedPages: 0 });
  if (Object.keys(calculated).some((key) => calculated[key] !== summary[key])) throw new TypeError("controlled import artifact summary does not match documents");
  if (summary.byteSize > catalog.limits.maximumBatchBytes || summary.candidates > catalog.limits.maximumBatchCandidates || summary.reviewedPages > catalog.limits.maximumBatchReviewedPages) throw new TypeError("controlled import artifact exceeds aggregate limits");
  const proposed = structuredClone(catalog);
  proposed.documents.push(...structuredClone(artifact.documents));
  validateGovernanceCatalog(proposed, { ...options, registry });
  return artifact.documents;
}

function applyProcurementImportRegistration(data = {}, command = {}, user = {}, options = {}) {
  let commandId;
  let expectedVersion;
  let actor;
  try {
    const unknown = Object.keys(command || {}).filter((key) => !["commandId", "expectedVersion", "artifact"].includes(key));
    if (unknown.length) throw new TypeError("registration command contains unknown fields");
    commandId = String(command.commandId || "").trim();
    if (!/^[A-Za-z0-9]+(?:[._:-][A-Za-z0-9]+)*$/.test(commandId) || commandId.length < 8 || commandId.length > 96) throw new TypeError("commandId is invalid");
    expectedVersion = Number(command.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) throw new TypeError("expectedVersion is invalid");
    actor = String(user.id || user.username || user.name || "").trim();
    if (!actor || actor.length > 120 || /[\u0000-\u001f]/.test(actor)) throw new TypeError("actor is invalid");
    assertSafe(command);
  } catch {
    throw new StateCommandError("PROCUREMENT_IMPORT_REGISTRATION_INPUT_INVALID", "受控导入登记请求无效。", 400);
  }
  if (user.role !== "commission") throw new StateCommandError("PROCUREMENT_IMPORT_REGISTRATION_SCOPE_FORBIDDEN", "当前身份不能登记受控导入。", 403);
  const next = structuredClone(data || {});
  const state = baseState(next.procurementRequirementCatalog);
  const commandKeyDigest = digest(commandId);
  const requestDigest = digest({ expectedVersion, actorDigest: digest(actor), artifact: command.artifact });
  const previous = state.commands.find((item) => item.commandKeyDigest === commandKeyDigest);
  if (previous) {
    if (previous.requestDigest !== requestDigest) throw new StateCommandError("PROCUREMENT_IMPORT_REGISTRATION_COMMAND_CONFLICT", "幂等键已用于不同的导入登记请求。", 409);
    if (!previous.resultSnapshot) throw new StateCommandError("PROCUREMENT_IMPORT_REGISTRATION_REPLAY_UNAVAILABLE", "历史导入回执缺少精确结果快照，不能重放。", 409);
    return Object.freeze({ data: { ...next, procurementRequirementCatalog: state }, result: Object.freeze(structuredClone(previous.resultSnapshot)), replayed: true });
  }
  if (state.version !== expectedVersion) throw new StateCommandError("PROCUREMENT_IMPORT_REGISTRATION_VERSION_CONFLICT", "受控导入登记版本冲突。", 409);
  let documents;
  try {
    const catalog = buildEffectiveProcurementCatalog(next, options);
    documents = validateArtifact(command.artifact, catalog, options.registry || defaultRegistry, options);
  } catch {
    throw new StateCommandError("PROCUREMENT_IMPORT_REGISTRATION_INPUT_INVALID", "受控导入登记请求无效。", 400);
  }
  const now = options.now || new Date().toISOString();
  state.documents.push(...structuredClone(documents));
  state.version += 1;
  const result = Object.freeze({
    schemaVersion: "procurement-import-registration-result-v1",
    version: state.version,
    registeredDocuments: documents.length,
    registeredCandidates: documents.reduce((count, document) => count + document.candidates.length, 0),
    documentIds: Object.freeze(documents.map((document) => document.id)),
    artifactDigest: digest(command.artifact),
    productionReady: false
  });
  state.events.push({ eventId: `pci-${commandKeyDigest.slice(7, 23)}`, action: "register-import-batch", actorDigest: digest(actor), artifactDigest: result.artifactDigest, documentCount: result.registeredDocuments, version: state.version, at: now });
  state.commands.push({ commandKeyDigest, requestDigest, resultingVersion: state.version, resultSnapshot: structuredClone(result), recordedAt: now });
  if (state.events.length > defaultCatalog.limits.maximumReviewEvents || state.commands.length > defaultCatalog.limits.maximumCommandReceipts) throw new StateCommandError("PROCUREMENT_IMPORT_REGISTRATION_CAPACITY_EXCEEDED", "受控导入登记已达到容量上限。", 409);
  next.procurementRequirementCatalog = state;
  return Object.freeze({ data: next, result, replayed: false });
}

module.exports = { applyProcurementImportRegistration, baseState, buildEffectiveProcurementCatalog, digest, validateArtifact };
