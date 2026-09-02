"use strict";

const crypto = require("node:crypto");
const defaultCatalog = require("../../../config/procurement-requirement-governance.json");
const defaultRegistry = require("../../../config/platform-capability-registry.json");
const { opaqueId, validateGovernanceCatalog } = require("./procurement-requirement-contracts");
const { analyzeRequirementGap } = require("./procurement-requirement-gap-analysis");

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

function sourceRows(catalog) {
  return catalog.documents.flatMap((document) => document.candidates.map((candidate) => ({ document, candidate })));
}

function publicCandidate(document, candidate, review, registry, options = {}) {
  const status = review?.status || "pending-review";
  const normalized = Object.freeze({
    id: candidate.id,
    documentId: document.id,
    sourceAlias: document.sourceAlias,
    title: candidate.title,
    sourceAnchor: Object.freeze({ ...candidate.sourceAnchor }),
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
  const items = sourceRows(catalog).map(({ document, candidate }) => publicCandidate(document, candidate, reviews.get(candidate.id), registry, options));
  const documents = catalog.documents.map((document) => Object.freeze({
    id: document.id,
    sourceAlias: document.sourceAlias,
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
    schemaVersion: "procurement-requirement-governance-view-v1",
    generatedAt: options.now || new Date().toISOString(),
    ok: true,
    productionReady: false,
    containsRawDocument: false,
    containsLocalPath: false,
    containsBusinessPayload: false,
    summary: Object.freeze({
      documents: documents.length,
      candidates: items.length,
      pendingReview: items.filter((item) => item.reviewStatus === "pending-review").length,
      accepted: accepted.length,
      revisionRequired: items.filter((item) => item.reviewStatus === "revision-required").length,
      rejected: items.filter((item) => item.reviewStatus === "rejected").length,
      coveredInRepository: accepted.filter((item) => item.gap.overall === "covered-in-repository").length,
      gaps: accepted.filter((item) => item.gap.overall !== "covered-in-repository").length
    }),
    documents: Object.freeze(documents),
    items: Object.freeze(items),
    approvedRequirements: Object.freeze(accepted),
    boundary: "招标需求仅形成受控候选、人工复核结果和能力差距建议；不自动修改代码，不代表现场或生产就绪。"
  });
}

function applyProcurementRequirementReviewAction(data = {}, command = {}, user = {}, options = {}) {
  assertSafeCommand(command);
  const unknown = Object.keys(command).filter((key) => !["commandId", "requirementId", "action", "expectedVersion", "note"].includes(key));
  if (unknown.length) throw new TypeError(`review command contains unknown fields: ${unknown.join(", ")}`);
  const catalog = options.catalog || defaultCatalog;
  const registry = options.registry || defaultRegistry;
  validateGovernanceCatalog(catalog, { ...options, registry });
  const commandId = opaqueId("commandId", command.commandId, 8, 96);
  const requirementId = opaqueId("requirementId", command.requirementId, 8, 96);
  const action = String(command.action || "").trim();
  if (!catalog.review.actions.includes(action)) throw new TypeError("review action is not allowlisted");
  const expectedVersion = Number(command.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) throw new TypeError("expectedVersion must be a non-negative integer");
  if (user.role !== catalog.review.requiredRole) throw new Error("procurement requirement review requires commission role");
  const actor = String(user.id || user.username || user.name || "").trim();
  if (actor.length < 1 || actor.length > 120 || /[\u0000-\u001f]/.test(actor)) throw new TypeError("review actor is invalid");
  const note = String(command.note || "").trim();
  if (note.length < 8 || note.length > 500 || /[\u0000-\u001f]/.test(note)) throw new TypeError("note must contain 8 to 500 characters");
  const row = sourceRows(catalog).find(({ candidate }) => candidate.id === requirementId);
  if (!row) throw new Error("procurement requirement candidate was not found");
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
      const error = new Error("command id was reused with different intent");
      error.code = "PROCUREMENT_REQUIREMENT_COMMAND_CONFLICT";
      throw error;
    }
    return Object.freeze({
      data: { ...next, procurementRequirementGovernance: state },
      result: publicCandidate(row.document, row.candidate, previous.reviewSnapshot, registry, options),
      replayed: true
    });
  }
  if (currentVersion !== expectedVersion) {
    const error = new Error("procurement requirement version conflict");
    error.code = "PROCUREMENT_REQUIREMENT_VERSION_CONFLICT";
    throw error;
  }
  const target = TRANSITIONS[current]?.[action];
  if (!target) throw new Error(`action ${action} is not allowed from ${current}`);
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
  state.commands.push({ commandKeyDigest, requestDigest, requirementId, resultingVersion: updated.version, reviewSnapshot: structuredClone(updated), recordedAt: now });
  if (state.events.length > catalog.limits.maximumReviewEvents || state.commands.length > catalog.limits.maximumCommandReceipts) throw new Error("procurement requirement governance capacity reached");
  next.procurementRequirementGovernance = state;
  const report = buildProcurementRequirementGovernance(next, { ...options, catalog, registry, now });
  return Object.freeze({ data: next, result: report.items.find((item) => item.id === requirementId), replayed: false });
}

module.exports = {
  TRANSITIONS,
  applyProcurementRequirementReviewAction,
  buildProcurementRequirementGovernance,
  digest
};
