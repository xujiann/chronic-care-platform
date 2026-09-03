"use strict";

const { createHash, randomUUID } = require("node:crypto");

const COLLECTION = "publicHealthSupervisionCases";
const STATUSES = Object.freeze(["立案", "调查取证", "审核", "处罚", "整改", "复查", "结案"]);
const PRIORITIES = Object.freeze(["普通", "重点", "紧急"]);
const MAX_CASES = 2000;
const MAX_RECEIPTS = 50;

class SupervisionCaseError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = "SupervisionCaseError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function fail(code, message, statusCode) { throw new SupervisionCaseError(code, message, statusCode); }
function text(value, field, maximum = 500, required = false) {
  if (value === undefined && !required) return "";
  if (typeof value !== "string") fail("SUPERVISION_CASE_INPUT_INVALID", `${field} must be a string`);
  const clean = value.trim().replace(/[\r\n\t]+/g, " ");
  if ((required && !clean) || clean.length > maximum) fail("SUPERVISION_CASE_INPUT_INVALID", `${field} is invalid`);
  return clean;
}
function actorId(user = {}) { return text(String(user.username || user.subject || user.id || user.role || ""), "actor", 160, true); }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.keys(value).sort().reduce((out, key) => { if (!["idempotencyKey", "commandId"].includes(key)) out[key] = stable(value[key]); return out; }, {});
  return value;
}
function digest(value) { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function versionOf(record) {
  const value = record.version ?? 0;
  if (!Number.isSafeInteger(value) || value < 0) fail("SUPERVISION_CASE_VERSION_INVALID", "case version is invalid", 409);
  return value;
}
function assertVersion(record, value) {
  if (!Number.isSafeInteger(value) || value < 0) fail("SUPERVISION_CASE_EXPECTED_VERSION_REQUIRED", "expectedVersion must be a non-negative integer");
  if (versionOf(record) !== value) fail("SUPERVISION_CASE_VERSION_CONFLICT", "case changed; refresh before retrying", 409);
}
function caseScope(user, record) {
  if (user.role === "commission") return !user.jurisdictionCode || !record.jurisdictionCode || String(user.jurisdictionCode) === String(record.jurisdictionCode);
  if (user.role === "institution") return Boolean(user.orgCode) && String(user.orgCode).toUpperCase() === String(record.subjectOrganizationCode || "").toUpperCase();
  return false;
}
function publicCase(record) { const copy = structuredClone(record); delete copy.commandReceipts; return copy; }

function commandIdentity(action, recordId, payload, user, headerKey) {
  const selected = text(String(headerKey || payload.idempotencyKey || payload.commandId || ""), "Idempotency-Key", 160) || `canonical:${digest(payload)}`;
  return {
    keyHash: digest({ action, recordId, actor: actorId(user), selected }),
    requestDigest: digest({ action, recordId, payload })
  };
}
function replay(record, identity) {
  const receipt = (record.commandReceipts || []).find((item) => item.keyHash === identity.keyHash);
  if (!receipt) return null;
  if (receipt.requestDigest !== identity.requestDigest) fail("SUPERVISION_CASE_IDEMPOTENCY_CONFLICT", "Idempotency-Key is already bound to another command", 409);
  return structuredClone(receipt.response);
}
function withReceipt(record, identity, response, at) {
  return { ...record, commandReceipts: [{ ...identity, response: structuredClone(response), at }, ...(record.commandReceipts || [])].slice(0, MAX_RECEIPTS) };
}

function listCases(state, user) {
  return (Array.isArray(state?.[COLLECTION]) ? state[COLLECTION] : []).filter((record) => caseScope(user, record)).map(publicCase);
}

function createCase(state, payload, user, options = {}) {
  if (user?.role !== "commission") fail("SUPERVISION_CASE_ROLE_DENIED", "only health supervision administrators may open cases", 403);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) fail("SUPERVISION_CASE_INPUT_INVALID", "case body must be an object");
  const allowed = new Set(["subjectCode", "subjectOrganizationCode", "jurisdictionCode", "inspectionTaskId", "cause", "priority", "evidenceRefs", "idempotencyKey", "commandId"]);
  if (Object.keys(payload).some((key) => !allowed.has(key))) fail("SUPERVISION_CASE_INPUT_INVALID", "case body contains unsupported fields");
  const priority = text(payload.priority || "普通", "priority", 16, true);
  if (!PRIORITIES.includes(priority)) fail("SUPERVISION_CASE_INPUT_INVALID", "priority is not supported");
  const now = options.now || new Date().toISOString();
  const records = Array.isArray(state?.[COLLECTION]) ? state[COLLECTION] : [];
  if (records.length >= MAX_CASES) fail("SUPERVISION_CASE_CAPACITY_REACHED", "case capacity reached", 409);
  const identity = commandIdentity("create", text(payload.inspectionTaskId || payload.subjectCode, "naturalKey", 160, true), payload, user, options.idempotencyKey);
  for (const item of records) {
    const prior = replay(item, identity);
    if (prior) return { state: structuredClone(state), caseRecord: prior, replayed: true };
  }
  const record = {
    id: `scase-${(options.randomUUID || randomUUID)()}`,
    subjectCode: text(payload.subjectCode, "subjectCode", 160, true),
    subjectOrganizationCode: text(payload.subjectOrganizationCode, "subjectOrganizationCode", 160, true),
    jurisdictionCode: text(payload.jurisdictionCode || user.jurisdictionCode || "DEMO", "jurisdictionCode", 80, true),
    inspectionTaskId: text(payload.inspectionTaskId, "inspectionTaskId", 160),
    cause: text(payload.cause, "cause", 500, true), priority, status: "立案", version: 0,
    evidenceRefs: Array.isArray(payload.evidenceRefs) ? payload.evidenceRefs.map((item) => text(item, "evidenceRef", 200, true)).slice(0, 20) : [],
    penaltyDecision: "", remediationDueAt: "", reinspectionDecision: "", nextAction: "进入调查取证并登记证据引用",
    owner: actorId(user), createdAt: now, updatedAt: now,
    timeline: [{ at: now, actor: actorId(user), action: "立案", note: "卫生监督案件已登记" }], commandReceipts: []
  };
  const response = publicCase(record);
  const stored = withReceipt(record, identity, response, now);
  const nextState = structuredClone(state || {});
  nextState[COLLECTION] = [stored, ...records].slice(0, MAX_CASES);
  return { state: nextState, caseRecord: response, replayed: false };
}

function executeCaseAction(state, caseId, payload, user, options = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) fail("SUPERVISION_CASE_INPUT_INVALID", "action body must be an object");
  const allowed = new Set(["toStatus", "expectedVersion", "note", "evidenceRefs", "penaltyDecision", "remediationDueAt", "reinspectionDecision", "idempotencyKey", "commandId", "action"]);
  if (Object.keys(payload).some((key) => !allowed.has(key))) fail("SUPERVISION_CASE_INPUT_INVALID", "action body contains unsupported fields");
  const records = Array.isArray(state?.[COLLECTION]) ? state[COLLECTION] : [];
  const index = records.findIndex((item) => item.id === caseId);
  if (index < 0) fail("SUPERVISION_CASE_NOT_FOUND", "case not found", 404);
  const current = records[index];
  if (!caseScope(user, current)) fail("SUPERVISION_CASE_SCOPE_DENIED", "case is outside the caller scope", 403);
  const toStatus = text(payload.toStatus, "toStatus", 20, true);
  const identity = commandIdentity(`transition:${toStatus}`, caseId, payload, user, options.idempotencyKey);
  const prior = replay(current, identity);
  if (prior) return { state: structuredClone(state), caseRecord: prior, replayed: true };
  const fromIndex = STATUSES.indexOf(current.status);
  if (STATUSES[fromIndex + 1] !== toStatus) fail("SUPERVISION_CASE_TRANSITION_DENIED", `cannot transition from ${current.status} to ${toStatus}`, 409);
  const institutionStep = current.status === "处罚" && toStatus === "整改";
  if (!(user.role === "commission" || (user.role === "institution" && institutionStep))) fail("SUPERVISION_CASE_ROLE_DENIED", "current actor cannot perform this case transition", 403);
  assertVersion(current, payload.expectedVersion);
  const newEvidence = Array.isArray(payload.evidenceRefs) ? payload.evidenceRefs.map((item) => text(item, "evidenceRef", 200, true)).slice(0, 20) : [];
  if (toStatus === "调查取证" && !(current.evidenceRefs.length || newEvidence.length)) fail("SUPERVISION_CASE_EVIDENCE_REQUIRED", "investigation requires evidence references", 409);
  if (toStatus === "处罚" && !text(payload.penaltyDecision, "penaltyDecision", 1000)) fail("SUPERVISION_CASE_PENALTY_REQUIRED", "penalty decision is required", 409);
  if (toStatus === "整改" && !newEvidence.length) fail("SUPERVISION_CASE_REMEDIATION_EVIDENCE_REQUIRED", "remediation evidence is required", 409);
  if (toStatus === "结案" && (text(payload.reinspectionDecision, "reinspectionDecision", 40) || current.reinspectionDecision) !== "通过") fail("SUPERVISION_CASE_REINSPECTION_REQUIRED", "a passed reinspection is required before closure", 409);
  const now = options.now || new Date().toISOString();
  let updated = {
    ...current, status: toStatus, version: versionOf(current) + 1, updatedAt: now,
    evidenceRefs: [...new Set([...(current.evidenceRefs || []), ...newEvidence])].slice(0, 40),
    penaltyDecision: text(payload.penaltyDecision, "penaltyDecision", 1000) || current.penaltyDecision,
    remediationDueAt: text(payload.remediationDueAt, "remediationDueAt", 40) || current.remediationDueAt,
    reinspectionDecision: text(payload.reinspectionDecision, "reinspectionDecision", 40) || current.reinspectionDecision,
    nextAction: toStatus === "结案" ? "归档案卷并持续复盘" : `进入${STATUSES[STATUSES.indexOf(toStatus) + 1]}`,
    timeline: [{ at: now, actor: actorId(user), action: toStatus, note: text(payload.note, "note", 1000) || `案件进入${toStatus}` }, ...(current.timeline || [])].slice(0, 100)
  };
  const response = publicCase(updated);
  updated = withReceipt(updated, identity, response, now);
  const nextState = structuredClone(state);
  nextState[COLLECTION] = records.map((item, itemIndex) => itemIndex === index ? updated : item);
  return { state: nextState, caseRecord: response, replayed: false };
}

module.exports = { COLLECTION, STATUSES, SupervisionCaseError, caseScope, createCase, executeCaseAction, listCases, publicCase };
