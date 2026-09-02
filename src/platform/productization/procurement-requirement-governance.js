"use strict";

const crypto = require("node:crypto");
const defaultCatalog = require("../../../config/procurement-requirement-governance.json");
const defaultRegistry = require("../../../config/platform-capability-registry.json");
const { opaqueId, validateGovernanceCatalog } = require("./procurement-requirement-contracts");
const { analyzeRequirementGap } = require("./procurement-requirement-gap-analysis");
const { buildProcurementRevisionComparisons, candidateSemanticDigest } = require("./procurement-requirement-versioning");
const { baseState: procurementCatalogState, buildEffectiveProcurementCatalog } = require("./procurement-requirement-catalog-registry");
const { StateCommandError } = require("../storage/state-command-consistency");

const TRANSITIONS = Object.freeze({
  "pending-review": Object.freeze({ accept: "accepted", "request-revision": "revision-required", reject: "rejected" }),
  "revision-required": Object.freeze({ accept: "accepted", reject: "rejected" }),
  accepted: Object.freeze({ "request-revision": "revision-required" }),
  rejected: Object.freeze({ "request-revision": "revision-required" })
});
const FORBIDDEN_KEYS = /(?:path|filename|raw|excerpt|prompt|instruction|patient|resident|identity|credential|password|secret|token)/i;

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(String(value)).digest("hex")}`;
}

function assertSafeCommand(value, location = "command") {
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.test(key)) throw new TypeError(`${location}.${key} is not allowed`);
    if (nested && typeof nested === "object") assertSafeCommand(nested, `${location}.${key}`);
  }
}

const REVIEW_STATE_KEYS = new Set(["schemaVersion", "reviews", "events", "commands"]);
const REVIEW_KEYS = new Set(["requirementId", "status", "targetCapabilityIds", "productClass", "decision", "priority", "ownerProcess", "evidenceBinding", "noteDigest", "actorDigest", "version", "updatedAt"]);
const REVIEW_EVENT_KEYS = new Set(["eventId", "requirementId", "action", "resultingStatus", "actorDigest", "noteDigest", "version", "at"]);
const REVIEW_COMMAND_KEYS = new Set(["commandKeyDigest", "requestDigest", "requirementId", "resultingVersion", "reviewSnapshot", "resultSnapshot", "recordedAt"]);
const BINDING_KEYS = new Set(["catalogId", "seriesId", "sourceRevision", "documentDigest", "logicalRequirementId", "semanticDigest", "candidateContractDigest", "sourceAnchorDigest", "capabilityRegistryDigest"]);
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const ACTION_RESULTS = Object.freeze({ accept: "accepted", "request-revision": "revision-required", reject: "rejected" });

function exactKeys(value, allowed) {
  return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every((key) => allowed.has(key));
}

function validOpaqueId(value) {
  return typeof value === "string" && value.length >= 4 && value.length <= 96 && /^[A-Za-z0-9]+(?:[._:-][A-Za-z0-9]+)*$/.test(value);
}

function validTimestamp(value) {
  return typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));
}

function validEvidenceBinding(binding) {
  if (binding === undefined) return true; // Existing v1 records are retained but projected as invalidated.
  return exactKeys(binding, BINDING_KEYS)
    && validOpaqueId(binding.catalogId)
    && /^SRC-[A-F0-9]{12}$/.test(String(binding.seriesId || ""))
    && Number.isInteger(binding.sourceRevision) && binding.sourceRevision > 0
    && /^REQ-[A-F0-9]{12}$/.test(String(binding.logicalRequirementId || ""))
    && [binding.documentDigest, binding.semanticDigest, binding.candidateContractDigest, binding.sourceAnchorDigest, binding.capabilityRegistryDigest]
      .every((value) => SHA256_PATTERN.test(String(value || "")));
}

function validReview(review) {
  return exactKeys(review, REVIEW_KEYS)
    && validOpaqueId(review.requirementId)
    && ["accepted", "revision-required", "rejected"].includes(review.status)
    && Array.isArray(review.targetCapabilityIds) && review.targetCapabilityIds.length >= 1 && review.targetCapabilityIds.length <= 8
    && new Set(review.targetCapabilityIds).size === review.targetCapabilityIds.length
    && review.targetCapabilityIds.every(validOpaqueId)
    && ["CORE", "SHARED", "PACKAGE", "CONFIG", "DEPLOY"].includes(review.productClass)
    && ["REUSE", "ENHANCE", "BUILD", "CONFIGURE", "DEPLOY"].includes(review.decision)
    && ["P0", "P1", "P2"].includes(review.priority)
    && /^T(?:0\d)$/.test(String(review.ownerProcess || ""))
    && validEvidenceBinding(review.evidenceBinding)
    && SHA256_PATTERN.test(String(review.noteDigest || ""))
    && SHA256_PATTERN.test(String(review.actorDigest || ""))
    && Number.isInteger(review.version) && review.version > 0
    && validTimestamp(review.updatedAt);
}

function reviewEquals(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validatePersistedReviewState(state) {
  if (!exactKeys(state, REVIEW_STATE_KEYS)
    || state.schemaVersion !== "procurement-requirement-review-state-v1"
    || !Array.isArray(state.reviews) || !Array.isArray(state.events) || !Array.isArray(state.commands)
    || state.events.length !== state.commands.length
    || state.events.length > defaultCatalog.limits.maximumReviewEvents
    || state.commands.length > defaultCatalog.limits.maximumCommandReceipts
    || state.reviews.some((review) => !validReview(review))) return false;

  const latest = new Map();
  const versions = new Map();
  for (let index = 0; index < state.commands.length; index += 1) {
    const event = state.events[index];
    const receipt = state.commands[index];
    const snapshot = receipt?.reviewSnapshot;
    if (!exactKeys(event, REVIEW_EVENT_KEYS) || !exactKeys(receipt, REVIEW_COMMAND_KEYS) || !validReview(snapshot)) return false;
    const priorVersion = versions.get(event.requirementId) || 0;
    if (!SHA256_PATTERN.test(String(receipt.commandKeyDigest || ""))
      || !SHA256_PATTERN.test(String(receipt.requestDigest || ""))
      || event.eventId !== `pre-${receipt.commandKeyDigest.slice(7, 23)}`
      || event.requirementId !== receipt.requirementId || event.requirementId !== snapshot.requirementId
      || ACTION_RESULTS[event.action] !== event.resultingStatus || event.resultingStatus !== snapshot.status
      || event.version !== priorVersion + 1 || event.version !== receipt.resultingVersion || event.version !== snapshot.version
      || event.actorDigest !== snapshot.actorDigest || event.noteDigest !== snapshot.noteDigest
      || !validTimestamp(event.at) || event.at !== receipt.recordedAt || event.at !== snapshot.updatedAt
      || (receipt.resultSnapshot !== undefined && receipt.resultSnapshot !== null && (typeof receipt.resultSnapshot !== "object" || Array.isArray(receipt.resultSnapshot)))) return false;
    versions.set(event.requirementId, event.version);
    latest.set(event.requirementId, snapshot);
  }
  if (state.reviews.length !== latest.size || new Set(state.reviews.map((review) => review.requirementId)).size !== state.reviews.length) return false;
  return state.reviews.every((review) => latest.has(review.requirementId) && reviewEquals(review, latest.get(review.requirementId)));
}

function baseState(value) {
  if (value === undefined || value === null) return { schemaVersion: "procurement-requirement-review-state-v1", reviews: [], events: [], commands: [] };
  const state = value && typeof value === "object" && !Array.isArray(value) ? structuredClone(value) : null;
  if (!state || !validatePersistedReviewState(state)) throw new TypeError("procurement requirement review state is invalid");
  return state;
}

function currentDocuments(catalog) {
  const latest = new Map();
  for (const document of catalog.documents) {
    const existing = latest.get(document.seriesId);
    if (!existing || document.revision > existing.revision) latest.set(document.seriesId, document);
  }
  return [...latest.values()];
}

function sourceRows(catalog) {
  return currentDocuments(catalog).flatMap((document) => document.candidates.map((candidate) => ({ document, candidate })));
}

function evidenceBinding(document, candidate, registry, catalogId = defaultCatalog.catalogId) {
  return Object.freeze({
    catalogId,
    seriesId: document.seriesId,
    sourceRevision: document.revision,
    documentDigest: document.sha256,
    logicalRequirementId: candidate.logicalRequirementId,
    semanticDigest: candidate.semanticDigest,
    candidateContractDigest: candidateSemanticDigest(candidate),
    sourceAnchorDigest: digest(JSON.stringify(candidate.sourceAnchor)),
    capabilityRegistryDigest: digest(JSON.stringify(registry))
  });
}

function bindingMatches(review, binding) {
  return review?.evidenceBinding && Object.keys(binding).every((key) => review.evidenceBinding[key] === binding[key]);
}

function publicCandidate(document, candidate, review, registry, options = {}, change = "baseline") {
  const binding = evidenceBinding(document, candidate, registry, options.catalogId);
  const boundReview = bindingMatches(review, binding) ? review : null;
  const status = boundReview?.status || (review ? "revision-required" : "pending-review");
  const normalized = Object.freeze({
    id: candidate.id,
    logicalRequirementId: candidate.logicalRequirementId,
    documentId: document.id,
    seriesId: document.seriesId,
    sourceAlias: document.sourceAlias,
    sourceRevision: document.revision,
    change,
    title: `需求候选 ${candidate.logicalRequirementId.slice(4)}`,
    sourceAnchor: Object.freeze({ pageStart: candidate.sourceAnchor.pageStart, pageEnd: candidate.sourceAnchor.pageEnd }),
    targetCapabilityIds: Object.freeze([...(boundReview?.targetCapabilityIds || candidate.targetCapabilityIds)]),
    productClass: boundReview?.productClass || candidate.productClass,
    decision: boundReview?.decision || candidate.decision,
    priority: boundReview?.priority || candidate.priority,
    ownerProcess: boundReview?.ownerProcess || candidate.ownerProcess,
    evidenceStatus: candidate.evidenceStatus,
    reviewStatus: status,
    version: review?.version || 0,
    updatedAt: review?.updatedAt || "",
    evidenceBindingStatus: boundReview ? "current" : review ? "invalidated" : "unreviewed",
    reviewBindingDigest: boundReview ? digest(JSON.stringify(boundReview.evidenceBinding)) : "",
    productionReady: false
  });
  return Object.freeze({ ...normalized, gap: analyzeRequirementGap(normalized, registry, options) });
}

function buildProcurementRequirementGovernance(data = {}, options = {}) {
  const catalog = buildEffectiveProcurementCatalog(data, options);
  const catalogState = procurementCatalogState(data.procurementRequirementCatalog);
  const registry = options.registry || defaultRegistry;
  validateGovernanceCatalog(catalog, { ...options, registry });
  const state = baseState(data.procurementRequirementGovernance);
  const reviews = new Map(state.reviews.map((review) => [review.requirementId, review]));
  const revisionComparisons = buildProcurementRevisionComparisons(catalog);
  const changes = new Map();
  for (const comparison of revisionComparisons) {
    comparison.added.forEach((item) => changes.set(item.candidateId, "added"));
    comparison.changed.forEach((item) => changes.set(item.candidateId, "changed"));
  }
  const current = new Set(currentDocuments(catalog).map((document) => document.id));
  const items = sourceRows(catalog).map(({ document, candidate }) => publicCandidate(document, candidate, reviews.get(candidate.id), registry, { ...options, catalogId: catalog.catalogId }, changes.get(candidate.id) || (document.revision > 1 ? "unchanged" : "baseline")));
  const documents = catalog.documents.map((document) => Object.freeze({
    id: document.id,
    seriesId: document.seriesId,
    sourceAlias: document.sourceAlias,
    revision: document.revision,
    supersedesDocumentId: document.supersedesDocumentId,
    isCurrent: current.has(document.id),
    evidenceId: `EVD-${digest(document.sha256).slice(7, 23).toUpperCase()}`,
    mediaType: document.mediaType,
    byteSizeBand: document.byteSize < 1048576 ? "under-1mb" : document.byteSize < 10485760 ? "1mb-to-10mb" : "10mb-or-more",
    reviewedPageCount: document.reviewedPageCount,
    extractionMode: document.extractionMode,
    textQuality: document.textQuality,
    securityStatus: document.securityStatus,
    status: document.status,
    candidates: document.candidates.length,
    productionReady: false
  }));
  const accepted = items.filter((item) => item.reviewStatus === "accepted");
  return Object.freeze({
    schemaVersion: "procurement-requirement-governance-view-v2",
    generatedAt: options.now || new Date().toISOString(),
    ok: true,
    productionReady: false,
    containsRawDocument: false,
    containsLocalPath: false,
    containsBusinessPayload: false,
    catalogRegistrationVersion: catalogState.version,
    summary: Object.freeze({
      documents: documents.length,
      sourceSeries: current.size,
      documentRevisions: documents.length,
      historicalRevisions: documents.length - current.size,
      revisionComparisons: revisionComparisons.length,
      added: revisionComparisons.reduce((count, item) => count + item.summary.added, 0),
      changed: revisionComparisons.reduce((count, item) => count + item.summary.changed, 0),
      withdrawn: revisionComparisons.reduce((count, item) => count + item.summary.withdrawn, 0),
      candidates: items.length,
      pendingReview: items.filter((item) => item.reviewStatus === "pending-review").length,
      accepted: accepted.length,
      revisionRequired: items.filter((item) => item.reviewStatus === "revision-required").length,
      rejected: items.filter((item) => item.reviewStatus === "rejected").length,
      coveredInRepository: accepted.filter((item) => item.gap.overall === "covered-in-repository").length,
      gaps: accepted.filter((item) => item.gap.overall !== "covered-in-repository").length
    }),
    documents: Object.freeze(documents),
    revisionComparisons,
    items: Object.freeze(items),
    approvedRequirements: Object.freeze(accepted),
    boundary: "招标需求仅形成受控候选、人工复核结果和能力差距建议；不自动修改代码，不代表现场或生产就绪。"
  });
}

function applyProcurementRequirementReviewAction(data = {}, command = {}, user = {}, options = {}) {
  const catalog = buildEffectiveProcurementCatalog(data, options);
  const registry = options.registry || defaultRegistry;
  validateGovernanceCatalog(catalog, { ...options, registry });
  let commandId;
  let requirementId;
  let action;
  let expectedVersion;
  let actor;
  let note;
  try {
    assertSafeCommand(command);
    const unknown = Object.keys(command).filter((key) => !["commandId", "requirementId", "action", "expectedVersion", "note"].includes(key));
    if (unknown.length) throw new TypeError("review command contains unknown fields");
    commandId = opaqueId("commandId", command.commandId, 8, 96);
    requirementId = opaqueId("requirementId", command.requirementId, 8, 96);
    action = String(command.action || "").trim();
    if (!catalog.review.actions.includes(action)) throw new TypeError("review action is not allowlisted");
    expectedVersion = Number(command.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) throw new TypeError("expectedVersion must be a non-negative integer");
    actor = String(user.id || user.username || user.name || "").trim();
    if (actor.length < 1 || actor.length > 120 || /[\u0000-\u001f]/.test(actor)) throw new TypeError("review actor is invalid");
    note = String(command.note || "").trim();
    if (note.length < 8 || note.length > 500 || /[\u0000-\u001f]/.test(note)) throw new TypeError("note must contain 8 to 500 characters");
  } catch (error) {
    if (error instanceof StateCommandError) throw error;
    throw new StateCommandError("PROCUREMENT_REQUIREMENT_INPUT_INVALID", "招标需求复核请求无效。", 400);
  }
  if (user.role !== catalog.review.requiredRole) throw new StateCommandError("PROCUREMENT_REQUIREMENT_SCOPE_FORBIDDEN", "当前身份不能复核招标需求。", 403);
  const row = sourceRows(catalog).find(({ candidate }) => candidate.id === requirementId);
  const next = structuredClone(data || {});
  const state = baseState(next.procurementRequirementGovernance);
  const review = state.reviews.find((item) => item.requirementId === requirementId);
  let current = review?.status || "pending-review";
  const currentVersion = review?.version || 0;
  const requestDigest = digest(JSON.stringify({ requirementId, action, expectedVersion, actorDigest: digest(actor), noteDigest: digest(note) }));
  const commandKeyDigest = digest(commandId);
  const previous = state.commands.find((item) => item.commandKeyDigest === commandKeyDigest);
  if (previous) {
    if (previous.requestDigest !== requestDigest) {
      throw new StateCommandError("PROCUREMENT_REQUIREMENT_COMMAND_CONFLICT", "幂等键已用于不同的复核请求。", 409);
    }
    if (!previous.resultSnapshot) throw new StateCommandError("PROCUREMENT_REQUIREMENT_REPLAY_UNAVAILABLE", "历史回执缺少精确结果快照，不能重放。", 409);
    return Object.freeze({
      data: { ...next, procurementRequirementGovernance: state },
      result: Object.freeze(structuredClone(previous.resultSnapshot)),
      replayed: true
    });
  }
  if (!row) throw new StateCommandError("PROCUREMENT_REQUIREMENT_NOT_FOUND", "招标需求候选不存在。", 404);
  if (review && !bindingMatches(review, evidenceBinding(row.document, row.candidate, registry, catalog.catalogId))) current = "revision-required";
  if (currentVersion !== expectedVersion) {
    throw new StateCommandError("PROCUREMENT_REQUIREMENT_VERSION_CONFLICT", "招标需求复核版本冲突。", 409);
  }
  const target = TRANSITIONS[current]?.[action];
  if (!target) throw new StateCommandError("PROCUREMENT_REQUIREMENT_TRANSITION_CONFLICT", "当前状态不允许执行该复核动作。", 409);
  const now = options.now || new Date().toISOString();
  const updated = {
    requirementId,
    status: target,
    targetCapabilityIds: [...row.candidate.targetCapabilityIds],
    productClass: row.candidate.productClass,
    decision: row.candidate.decision,
    priority: row.candidate.priority,
    ownerProcess: row.candidate.ownerProcess,
    evidenceBinding: evidenceBinding(row.document, row.candidate, registry, catalog.catalogId),
    noteDigest: digest(note),
    actorDigest: digest(actor),
    version: currentVersion + 1,
    updatedAt: now
  };
  if (review) Object.assign(review, updated); else state.reviews.push(updated);
  state.events.push({ eventId: `pre-${commandKeyDigest.slice(7, 23)}`, requirementId, action, resultingStatus: target, actorDigest: digest(actor), noteDigest: digest(note), version: updated.version, at: now });
  const receipt = { commandKeyDigest, requestDigest, requirementId, resultingVersion: updated.version, reviewSnapshot: structuredClone(updated), resultSnapshot: null, recordedAt: now };
  state.commands.push(receipt);
  if (state.events.length > catalog.limits.maximumReviewEvents || state.commands.length > catalog.limits.maximumCommandReceipts) throw new StateCommandError("PROCUREMENT_REQUIREMENT_CAPACITY_EXCEEDED", "招标需求治理记录已达到受控容量上限。", 409);
  next.procurementRequirementGovernance = state;
  const report = buildProcurementRequirementGovernance(next, { ...options, registry, now });
  const result = report.items.find((item) => item.id === requirementId);
  receipt.resultSnapshot = structuredClone(result);
  return Object.freeze({ data: next, result, replayed: false });
}

module.exports = {
  TRANSITIONS,
  applyProcurementRequirementReviewAction,
  buildProcurementRequirementGovernance,
  digest
};
