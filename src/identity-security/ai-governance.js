"use strict";

const { createHash } = require("node:crypto");
const CONTRACT_VERSION = "ai-governance.v1";
const MAX_COMMANDS = 1000;
class AiGovernanceError extends Error {
  constructor(code, message, statusCode = 400) { super(message); this.code = code; this.statusCode = statusCode; }
}
function fail(code, statusCode = 400) { throw new AiGovernanceError(code, code, statusCode); }
function assertActor(user) {
  if (!user || user.role !== "commission") fail("AI_GOVERNANCE_FORBIDDEN", 403);
  if (user.accountType !== undefined && user.accountType !== "manager") fail("AI_GOVERNANCE_FORBIDDEN", 403);
  const actor = user.id || user.username;
  if (typeof actor !== "string" || !actor.trim()) fail("AI_GOVERNANCE_ACTOR_REQUIRED", 403);
  return actor;
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}
function digest(value) { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function validateFields(value, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !allowed.includes(key))) fail("AI_GOVERNANCE_INPUT_INVALID");
}
function cardInput(card) {
  validateFields(card, ["sourceRef", "sourceDigest", "ruleVersion", "evidenceRef", "evidenceDigest", "riskLevel"]);
  for (const field of ["sourceRef", "ruleVersion", "evidenceRef"]) {
    if (typeof card[field] !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,159}$/.test(card[field])) fail("AI_GOVERNANCE_REFERENCE_INVALID");
  }
  for (const field of ["sourceDigest", "evidenceDigest"]) if (typeof card[field] !== "string" || !/^[a-f0-9]{64}$/.test(card[field])) fail("AI_GOVERNANCE_DIGEST_INVALID");
  if (!["low", "medium", "high"].includes(card.riskLevel)) fail("AI_GOVERNANCE_RISK_INVALID");
  return structuredClone(card);
}
function sourceDigest(rule) { const source = { ...rule }; delete source.governance; return digest(source); }
function sourceIntegrity(rule) {
  if (!rule.governance?.card) return "unregistered";
  return rule.governance.card.sourceDigest === sourceDigest(rule) ? "matched" : "drifted";
}
function evaluateAiRulePolicy(rule) {
  const integrity = sourceIntegrity(rule);
  const status = integrity === "drifted" ? "stale" : rule.governance?.status || "unregistered";
  return { status, decisionAvailable: !rule.governance || (status === "approved" && integrity === "matched"), productionReady: false };
}
function projectRule(rule) {
  const g = rule.governance || {};
  const integrity = sourceIntegrity(rule);
  return { id: rule.id, governance: { version: g.version || 0, status: integrity === "drifted" ? "stale" : g.status || "unregistered", storedStatus: g.status || "unregistered", sourceIntegrity: integrity, card: g.card ? structuredClone(g.card) : null, sourceDigest: sourceDigest(rule), submittedBy: g.submittedBy || null, reviewedBy: g.reviewedBy || null }, productionReady: false };
}
function buildAiGovernanceCenter(data, user) {
  assertActor(user);
  const rules = (data.phase2ClinicalAssistRules || []).map(projectRule);
  const summary = { total: rules.length, unregistered: 0, draft: 0, submitted: 0, approved: 0, rejected: 0, suspended: 0, stale: 0 };
  for (const rule of rules) if (Object.hasOwn(summary, rule.governance.status)) summary[rule.governance.status] += 1;
  return { contractVersion: CONTRACT_VERSION, rules, summary, productionReady: false };
}

// Pure transition: the caller seals audit and persists this cloned state once.
function executeAiGovernanceAction(data, id, payload, user, options = {}) {
  const actor = assertActor(user);
  validateFields(payload, ["action", "expectedVersion", "idempotencyKey", "card"]);
  if (!["register", "submit", "approve", "reject", "suspend", "rollback"].includes(payload.action)) fail("AI_GOVERNANCE_ACTION_INVALID");
  if (!Number.isSafeInteger(payload.expectedVersion) || payload.expectedVersion < 0) fail("AI_GOVERNANCE_VERSION_REQUIRED");
  const key = options.idempotencyKey || payload.idempotencyKey;
  if (typeof key !== "string" || !/^[A-Za-z0-9_.:-]{1,160}$/.test(key)) fail("AI_GOVERNANCE_KEY_REQUIRED");
  if (options.idempotencyKey && payload.idempotencyKey && options.idempotencyKey !== payload.idempotencyKey) fail("AI_GOVERNANCE_KEY_MISMATCH");
  const rule = (data.phase2ClinicalAssistRules || []).find((item) => item.id === id);
  if (!rule) fail("AI_GOVERNANCE_NOT_FOUND", 404);
  const g = rule.governance || { version: 0, status: "unregistered", history: [], receipts: [] };
  const keyHash = digest({ actor, id, key });
  const requestDigest = digest({ payload: { ...payload, idempotencyKey: undefined }, actorContext: { actor, role: user.role, orgCode: user.orgCode || "" } });
  const prior = (g.receipts || []).find((receipt) => receipt.keyHash === keyHash);
  if (prior) {
    if (prior.requestDigest !== requestDigest) fail("AI_GOVERNANCE_KEY_CONFLICT", 409);
    return { state: data, response: structuredClone(prior.response), replayed: true };
  }
  if (g.version !== payload.expectedVersion) fail("AI_GOVERNANCE_VERSION_CONFLICT", 409);
  if (g.version >= Number.MAX_SAFE_INTEGER) fail("AI_GOVERNANCE_VERSION_EXHAUSTED", 409);
  // Preserve retained receipts: evicting them would allow an old key to execute again.
  if ((g.receipts || []).length >= MAX_COMMANDS || (g.history || []).length >= MAX_COMMANDS) fail("AI_GOVERNANCE_CAPACITY_EXHAUSTED", 409);
  if (sourceIntegrity(rule) === "drifted" && payload.action !== "register") fail("AI_GOVERNANCE_SOURCE_CHANGED", 409);
  const status = sourceIntegrity(rule) === "drifted" ? "stale" : g.status;
  const allowed = { register: ["unregistered", "draft", "rejected", "suspended", "stale"], submit: ["draft"], approve: ["submitted"], reject: ["submitted"], suspend: ["approved"], rollback: ["suspended", "rejected"] };
  if (!allowed[payload.action].includes(status)) fail("AI_GOVERNANCE_STATE_CONFLICT", 409);
  if (payload.action !== "register" && Object.hasOwn(payload, "card")) fail("AI_GOVERNANCE_CARD_NOT_ALLOWED");
  if (["approve", "reject"].includes(payload.action) && [g.registeredBy, g.submittedBy].includes(actor)) fail("AI_GOVERNANCE_SELF_REVIEW", 403);
  const state = structuredClone(data);
  const nextRule = state.phase2ClinicalAssistRules.find((item) => item.id === id);
  const next = structuredClone(g);
  if (payload.action === "register") {
    next.card = cardInput(payload.card);
    if (next.card.sourceDigest !== sourceDigest(rule)) fail("AI_GOVERNANCE_SOURCE_CHANGED", 409);
    next.registeredBy = actor;
    next.submittedBy = null;
    next.reviewedBy = null;
  } else if (payload.action === "rollback") {
    if (!g.approvedCard) fail("AI_GOVERNANCE_ROLLBACK_UNAVAILABLE", 409);
    next.card = structuredClone(g.approvedCard);
    next.registeredBy = actor;
    next.submittedBy = null;
    next.reviewedBy = null;
  } else if (["submit", "approve"].includes(payload.action)) {
    if (next.card?.sourceDigest !== sourceDigest(rule)) fail("AI_GOVERNANCE_SOURCE_CHANGED", 409);
    if (payload.action === "submit") next.submittedBy = actor;
    else { next.reviewedBy = actor; next.approvedCard = structuredClone(next.card); }
  } else if (payload.action === "reject") next.reviewedBy = actor;
  next.version = g.version + 1;
  next.status = { register: "draft", submit: "submitted", approve: "approved", reject: "rejected", suspend: "suspended", rollback: "draft" }[payload.action];
  next.productionReady = false;
  const at = options.now || new Date().toISOString();
  next.history = [...(g.history || []), { version: next.version, action: payload.action, actor, at, sourceDigest: sourceDigest(rule) }];
  nextRule.governance = next;
  const response = { contractVersion: CONTRACT_VERSION, rule: projectRule(nextRule), productionReady: false };
  next.receipts = [...(g.receipts || []), { keyHash, requestDigest, response: structuredClone(response) }];
  return { state, response, replayed: false, audit: { actor, role: user.role, action: `ai-governance:${payload.action}`, target: id, result: "allowed", detail: `version:${next.version};source:${sourceDigest(rule)}` } };
}

module.exports = { CONTRACT_VERSION, MAX_COMMANDS, AiGovernanceError, assertActor, buildAiGovernanceCenter, evaluateAiRulePolicy, executeAiGovernanceAction, sourceDigest };
