"use strict";

const crypto = require("node:crypto");
const defaultCatalog = require("../../../config/procurement-requirement-governance.json");
const defaultRegistry = require("../../../config/platform-capability-registry.json");
const { opaqueId, validateGovernanceCatalog } = require("./procurement-requirement-contracts");
const { analyzeRequirementGap } = require("./procurement-requirement-gap-analysis");
const { buildProcurementRevisionComparisons } = require("./procurement-requirement-versioning");
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

function baseState(value) {
  const state = value && typeof value === "object" && !Array.isArray(value) ? structuredClone(value) : {};
  if (state.schemaVersion && state.schemaVersion !== "procurement-requirement-review-state-v1") throw new TypeError("procurement requirement review state is invalid");
  state.schemaVersion = "procurement-requirement-review-state-v1";
  state.reviews = Array.isArray(state.reviews) ? state.reviews : [];
  state.events = Array.isArray(state.events) ? state.events : [];
  state.commands = Array.isArray(state.commands) ? state.commands : [];
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

function publicCandidate(document, candidate, review, registry, options = {}, change = "baseline") {
  const status = review?.status || "pending-review";
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
    targetCapabilityIds: Object.freeze([...(review?.targetCapabilityIds || candidate.targetCapabilityIds)]),
    productClass: review?.productClass || candidate.productClass,
    decision: review?.decision || candidate.decision,
    priority: review?.priority || candidate.priority,
    ownerProcess: review?.ownerProcess || candidate.ownerProcess,
    evidenceStatus: candidate.evidenceStatus,
    reviewStatus: status,
    version: review?.version || 0,
    updatedAt: review?.updatedAt || "",
    productionReady: false
  });
  return Object.freeze({ ...normalized, gap: analyzeRequirementGap(normalized, registry, options) });
}

function buildProcurementRequirementGovernance(data = {}, options = {}) {
  const catalog = options.catalog || defaultCatalog;
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
  const items = sourceRows(catalog).map(({ document, candidate }) => publicCandidate(document, candidate, reviews.get(candidate.id), registry, options, changes.get(candidate.id) || (document.revision > 1 ? "unchanged" : "baseline")));
  const documents = catalog.documents.map((document) => Object.freeze({
    id: document.id,
    seriesId: document.seriesId,
    sourceAlias: document.sourceAlias,
    revision: document.revision,
    supersedesDocumentId: document.supersedesDocumentId,
    isCurrent: current.has(document.id),
    documentDigest: document.sha256,
    mediaType: document.mediaType,
    byteSize: document.byteSize,
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
  const catalog = options.catalog || defaultCatalog;
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
  const current = review?.status || "pending-review";
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
  const report = buildProcurementRequirementGovernance(next, { ...options, catalog, registry, now });
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
