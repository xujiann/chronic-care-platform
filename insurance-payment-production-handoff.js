"use strict";

const { createHash } = require("node:crypto");

const HANDOFF_STATES = Object.freeze({
  PENDING: "PENDING",
  SUBMITTED: "SUBMITTED",
  VERIFIED: "VERIFIED",
  REJECTED: "REJECTED"
});

const SUBMISSION_ROLES = Object.freeze({
  route: Object.freeze(["integration-owner"]),
  external: Object.freeze(["external-owner"])
});

const VERIFICATION_ROLES = Object.freeze(["acceptance-reviewer", "security-reviewer", "finance-auditor"]);

class ProductionHandoffError extends Error {
  constructor(message, code, statusCode = 409) {
    super(message);
    this.name = "ProductionHandoffError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function digest(value) {
  return createHash("sha256").update(typeof value === "string" ? value : stableStringify(value)).digest("hex");
}

function safeText(value, maximum = 300) {
  return String(value || "").replace(/[\r\n\0]/g, " ").trim().slice(0, maximum);
}

function actorIdentity(actor = {}) {
  return safeText(actor.username || actor.name || actor.id, 120);
}

function actorRoles(actor = {}) {
  return new Set((Array.isArray(actor.roles) ? actor.roles : [actor.role]).map((item) => safeText(item, 80)).filter(Boolean));
}

function requireActorRole(actor, allowedRoles, code) {
  const identity = actorIdentity(actor);
  if (!identity) throw new ProductionHandoffError("交接证据操作人不能为空", "HANDOFF_ACTOR_REQUIRED", 400);
  const roles = actorRoles(actor);
  if (!allowedRoles.some((role) => roles.has(role))) throw new ProductionHandoffError("操作人不具备交接证据职责", code, 403);
  return identity;
}

function handoffItemProjection(item = {}) {
  return {
    id: item.id,
    scope: item.scope,
    owner: item.owner,
    requirement: item.requirement,
    requirementDigest: item.requirementDigest,
    required: item.required,
    state: item.state,
    evidence: item.evidence,
    verification: item.verification
  };
}

function appendEvent(item, event) {
  item.events ||= [];
  const previousHash = item.events.length ? item.events[item.events.length - 1].eventHash : "GENESIS";
  const base = { ...event, projectionDigest: `sha256:${digest(handoffItemProjection(item))}`, sequence: item.events.length + 1, previousHash };
  const sealed = Object.freeze({ ...base, eventHash: digest(base) });
  item.events.push(sealed);
  return sealed;
}

function verifyItemEventLedger(events = []) {
  const transitionRules = {
    "requirement-created": { from: ["NONE"], to: [HANDOFF_STATES.PENDING] },
    "requirement-reactivated": { from: Object.values(HANDOFF_STATES), to: [HANDOFF_STATES.PENDING] },
    "requirement-changed": { from: Object.values(HANDOFF_STATES), to: [HANDOFF_STATES.PENDING] },
    "requirement-retired": { from: Object.values(HANDOFF_STATES), sameState: true },
    "evidence-submitted": { from: [HANDOFF_STATES.PENDING, HANDOFF_STATES.REJECTED], to: [HANDOFF_STATES.SUBMITTED] },
    "evidence-verified": { from: [HANDOFF_STATES.SUBMITTED], to: [HANDOFF_STATES.VERIFIED] },
    "evidence-rejected": { from: [HANDOFF_STATES.SUBMITTED], to: [HANDOFF_STATES.REJECTED] }
  };
  return events.length > 0 && events.every((event, index) => {
    const { eventHash, ...base } = event;
    const rule = transitionRules[event.action];
    const previous = events[index - 1];
    const transitionValid = rule
      && rule.from.includes(event.from)
      && (rule.sameState ? event.to === event.from : rule.to.includes(event.to))
      && (index === 0 ? event.action === "requirement-created" : previous.to === event.from);
    return base.sequence === index + 1
      && base.previousHash === (index ? previous.eventHash : "GENESIS")
      && eventHash === digest(base)
      && /^sha256:[a-f0-9]{64}$/.test(String(event.projectionDigest || ""))
      && transitionValid;
  });
}

function verifyItemLedger(itemOrEvents = []) {
  if (Array.isArray(itemOrEvents)) return verifyItemEventLedger(itemOrEvents);
  const item = itemOrEvents;
  if (!item || !verifyItemEventLedger(item.events || [])) return false;
  return item.events.at(-1).projectionDigest === `sha256:${digest(handoffItemProjection(item))}`;
}

function requirementsFromAcceptance(acceptance = {}) {
  const routes = acceptance.integrationHandoff?.routes || [];
  const blockers = acceptance.externalBlockers || [];
  return [
    ...routes.filter((route) => !route.wired).map((route) => ({
      id: `route:${safeText(route.id, 120)}`,
      scope: "route",
      owner: "T00",
      requirement: { id: route.id, method: route.method, path: route.path, handler: route.handler || route.handlers }
    })),
    ...blockers.map((blocker) => {
      const reviewerRole = VERIFICATION_ROLES.includes(blocker.reviewerRole) ? blocker.reviewerRole : "";
      return {
        id: `external:${safeText(blocker.source, 80)}:${safeText(blocker.id, 120)}`,
        scope: "external",
        owner: safeText(blocker.owner || blocker.source, 120) || "external-owner",
        requirement: { source: blocker.source, id: blocker.id, dependencyId: blocker.dependencyId, detail: blocker.detail, reviewerRole }
      };
    })
  ].map((item) => ({ ...item, requirementDigest: `sha256:${digest({ scope: item.scope, owner: item.owner, requirement: item.requirement })}` }));
}

function ensureProductionHandoff(data = {}, acceptance = {}, at = new Date().toISOString()) {
  const requirements = requirementsFromAcceptance(acceptance);
  const state = data.insurancePaymentProductionHandoff ||= {
    schema: "insurance-payment-production-handoff-v1",
    items: []
  };
  state.items = Array.isArray(state.items) ? state.items : [];
  const activeIds = new Set(requirements.map((item) => item.id));

  for (const requirement of requirements) {
    let item = state.items.find((candidate) => candidate.id === requirement.id);
    if (!item) {
      item = {
        ...requirement,
        required: true,
        state: HANDOFF_STATES.PENDING,
        evidence: null,
        verification: null,
        events: []
      };
      state.items.push(item);
      appendEvent(item, { action: "requirement-created", from: "NONE", to: HANDOFF_STATES.PENDING, actor: "system:t07-handoff-model", at, detail: { requirementDigest: item.requirementDigest } });
      continue;
    }
    if (!verifyItemLedger(item)) continue;
    if (item.required === false) {
      const before = item.state;
      Object.assign(item, requirement, { required: true, state: HANDOFF_STATES.PENDING, evidence: null, verification: null });
      appendEvent(item, { action: "requirement-reactivated", from: before, to: HANDOFF_STATES.PENDING, actor: "system:t07-handoff-model", at, detail: { requirementDigest: item.requirementDigest } });
      continue;
    }
    item.required = true;
    if (item.requirementDigest !== requirement.requirementDigest) {
      const before = item.state;
      Object.assign(item, requirement, { state: HANDOFF_STATES.PENDING, evidence: null, verification: null });
      appendEvent(item, { action: "requirement-changed", from: before, to: HANDOFF_STATES.PENDING, actor: "system:t07-handoff-model", at, detail: { requirementDigest: item.requirementDigest } });
    }
  }

  for (const item of state.items) {
    if (activeIds.has(item.id) || item.required === false) continue;
    if (!verifyItemLedger(item)) continue;
    const before = item.state;
    item.required = false;
    appendEvent(item, { action: "requirement-retired", from: before, to: before, actor: "system:t07-handoff-model", at, detail: { requirementDigest: item.requirementDigest } });
  }

  state.requirementsDigest = `sha256:${digest(requirements.map((item) => ({ id: item.id, requirementDigest: item.requirementDigest })))}`;
  return state;
}

function requiredItem(data, acceptance, itemId, at) {
  const state = ensureProductionHandoff(data, acceptance, at);
  const normalizedItemId = safeText(itemId, 240);
  const activeIds = new Set(requirementsFromAcceptance(acceptance).map((item) => item.id));
  const item = state.items.find((candidate) => candidate.id === normalizedItemId);
  if (!item || !activeIds.has(normalizedItemId)) throw new ProductionHandoffError("生产交接要求不存在或已停用", "HANDOFF_REQUIREMENT_NOT_FOUND", 404);
  if (!verifyItemLedger(item)) throw new ProductionHandoffError("生产交接事件账本或状态投影校验失败", "HANDOFF_LEDGER_INVALID");
  return item;
}

function submitHandoffEvidence(data, acceptance, itemId, input = {}, actor = {}) {
  const submittedAt = input.submittedAt || new Date().toISOString();
  const item = requiredItem(data, acceptance, itemId, submittedAt);
  const submittedBy = requireActorRole(actor, SUBMISSION_ROLES[item.scope] || [], "HANDOFF_SUBMISSION_RESPONSIBILITY_DENIED");
  const evidenceReference = safeText(input.evidenceReference);
  const evidenceDigest = safeText(input.evidenceDigest, 80).toLowerCase();
  const idempotencyKey = safeText(input.idempotencyKey, 160);
  if (!evidenceReference) throw new ProductionHandoffError("证据引用不能为空", "HANDOFF_EVIDENCE_REFERENCE_REQUIRED", 400);
  if (!/^sha256:[a-f0-9]{64}$/.test(evidenceDigest)) throw new ProductionHandoffError("证据摘要必须为 SHA-256", "HANDOFF_EVIDENCE_DIGEST_INVALID", 400);
  if (!idempotencyKey) throw new ProductionHandoffError("证据提交幂等键不能为空", "HANDOFF_IDEMPOTENCY_REQUIRED", 400);
  const evidenceRequest = {
    evidenceReference,
    evidenceDigest,
    artifactType: safeText(input.artifactType, 100) || "acceptance-evidence",
    issuedAt: safeText(input.issuedAt, 40) || submittedAt,
    submittedBy,
    idempotencyKey
  };
  const requestDigest = `sha256:${digest(evidenceRequest)}`;
  const evidence = { ...evidenceRequest, submittedAt, requestDigest };
  evidence.recordDigest = `sha256:${digest(evidence)}`;
  if (item.state === HANDOFF_STATES.SUBMITTED && item.evidence?.idempotencyKey === idempotencyKey) {
    if (item.evidence.requestDigest !== requestDigest) throw new ProductionHandoffError("幂等键对应的证据内容不一致", "HANDOFF_IDEMPOTENCY_CONFLICT");
    return { item, idempotent: true };
  }
  if (![HANDOFF_STATES.PENDING, HANDOFF_STATES.REJECTED].includes(item.state)) throw new ProductionHandoffError("当前状态不允许提交证据", "HANDOFF_SUBMISSION_STATE_INVALID");
  const before = item.state;
  item.state = HANDOFF_STATES.SUBMITTED;
  item.evidence = evidence;
  item.verification = null;
  appendEvent(item, { action: "evidence-submitted", from: before, to: item.state, actor: submittedBy, at: submittedAt, idempotencyKey, detail: { evidenceDigest, recordDigest: evidence.recordDigest } });
  return { item, idempotent: false };
}

function verifyHandoffEvidence(data, acceptance, itemId, input = {}, actor = {}) {
  const verifiedAt = input.verifiedAt || new Date().toISOString();
  const item = requiredItem(data, acceptance, itemId, verifiedAt);
  const requiredReviewerRole = safeText(item.requirement?.reviewerRole, 80);
  const verifiedBy = requireActorRole(actor, requiredReviewerRole ? [requiredReviewerRole] : VERIFICATION_ROLES, "HANDOFF_VERIFICATION_RESPONSIBILITY_DENIED");
  if (typeof input.approved !== "boolean") throw new ProductionHandoffError("核验结论不能为空", "HANDOFF_VERDICT_REQUIRED", 400);
  const verificationReference = safeText(input.verificationReference);
  const idempotencyKey = safeText(input.idempotencyKey, 160);
  const reasonCode = safeText(input.reasonCode, 100);
  if (!verificationReference || !idempotencyKey) throw new ProductionHandoffError("核验引用和幂等键不能为空", "HANDOFF_VERIFICATION_REFERENCE_REQUIRED", 400);
  if (!input.approved && !reasonCode) throw new ProductionHandoffError("驳回时必须填写原因代码", "HANDOFF_REJECTION_REASON_REQUIRED", 400);
  const verificationRequest = { approved: input.approved, verificationReference, reasonCode, verifiedBy, idempotencyKey, evidenceRecordDigest: item.evidence?.recordDigest || "" };
  const requestDigest = `sha256:${digest(verificationRequest)}`;
  if (item.verification?.idempotencyKey === idempotencyKey) {
    if (item.verification.requestDigest !== requestDigest) throw new ProductionHandoffError("幂等键对应的核验内容不一致", "HANDOFF_IDEMPOTENCY_CONFLICT");
    return item;
  }
  if (item.state !== HANDOFF_STATES.SUBMITTED || !item.evidence) throw new ProductionHandoffError("仅已提交证据可以核验", "HANDOFF_VERIFICATION_STATE_INVALID");
  if (verifiedBy === item.evidence.submittedBy) throw new ProductionHandoffError("证据提交人与核验人必须分离", "HANDOFF_FOUR_EYES_REQUIRED", 403);
  const before = item.state;
  item.state = input.approved ? HANDOFF_STATES.VERIFIED : HANDOFF_STATES.REJECTED;
  item.verification = { ...verificationRequest, verifiedAt, requestDigest };
  item.verification.recordDigest = `sha256:${digest(item.verification)}`;
  appendEvent(item, { action: input.approved ? "evidence-verified" : "evidence-rejected", from: before, to: item.state, actor: verifiedBy, at: verifiedAt, idempotencyKey, detail: { evidenceRecordDigest: item.evidence.recordDigest, verificationDigest: item.verification.recordDigest, reasonCode } });
  return item;
}

function buildProductionHandoffStatus(data = {}, acceptance = {}) {
  const state = ensureProductionHandoff(data, acceptance);
  const activeIds = new Set(requirementsFromAcceptance(acceptance).map((item) => item.id));
  const required = state.items.filter((item) => activeIds.has(item.id));
  const ledgerValid = state.items.every((item) => verifyItemLedger(item));
  const counts = Object.fromEntries(Object.keys(HANDOFF_STATES).map((stateName) => [stateName.toLowerCase(), required.filter((item) => item.state === stateName).length]));
  const evidenceComplete = required.length > 0 && required.every((item) => item.state === HANDOFF_STATES.VERIFIED);
  return {
    schema: state.schema,
    requirementsDigest: state.requirementsDigest,
    localReady: acceptance.localReady === true,
    evidenceComplete,
    productionReady: acceptance.productionReady === true && evidenceComplete && ledgerValid,
    ledgerValid,
    summary: { required: required.length, ...counts },
    items: required.map((item) => ({ id: item.id, scope: item.scope, owner: item.owner, reviewerRole: item.requirement?.reviewerRole || "", state: item.state, requirementDigest: item.requirementDigest, evidenceDigest: item.evidence?.evidenceDigest || "", evidenceRecordDigest: item.evidence?.recordDigest || "", verificationDigest: item.verification?.recordDigest || "", ledgerValid: verifyItemLedger(item) })),
    boundary: "Verified handoff evidence closes documentary requirements only; productionReady also requires the acceptance report to confirm real public wiring and live-environment acceptance."
  };
}

module.exports = {
  HANDOFF_STATES,
  ProductionHandoffError,
  SUBMISSION_ROLES,
  VERIFICATION_ROLES,
  buildProductionHandoffStatus,
  digest,
  ensureProductionHandoff,
  handoffItemProjection,
  requirementsFromAcceptance,
  stableStringify,
  submitHandoffEvidence,
  verifyHandoffEvidence,
  verifyItemLedger
};
