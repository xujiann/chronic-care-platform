"use strict";

const { createHash, randomUUID } = require("node:crypto");

const REQUEST_COLLECTION = "accountLifecycleRequests";
const GRANT_COLLECTION = "accountTemporaryGrants";
const RECEIPT_COLLECTION = "accountLifecycleCommandReceipts";
const REQUEST_TYPES = Object.freeze(["create", "change", "disable", "restore", "temporary-grant"]);
const ACCOUNT_ROLES = Object.freeze(["commission", "institution", "insurance", "county", "citizen"]);
const TYPE_ALIASES = Object.freeze({ open: "create", deactivate: "disable", temporaryGrant: "temporary-grant" });
const CONFLICT_PAIRS = Object.freeze([
  ["payment.submit", "payment.review", "payment submission and review must be separated"],
  ["account.request", "account.approve", "account request and approval must be separated"],
  ["audit.write", "audit.verify", "audit writing and verification must be separated"]
]);

class AccountLifecycleError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = "AccountLifecycleError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function fail(code, message, statusCode) { throw new AccountLifecycleError(code, message, statusCode); }
function text(value, field, maximum = 500, required = false) {
  if (value === undefined && !required) return "";
  if (typeof value !== "string") fail("ACCOUNT_LIFECYCLE_INPUT_INVALID", `${field} must be a string`);
  const normalized = value.trim().replace(/[\r\n\t]+/g, " ");
  if ((required && !normalized) || normalized.length > maximum) fail("ACCOUNT_LIFECYCLE_INPUT_INVALID", `${field} is invalid`);
  return normalized;
}
function actorId(user = {}) { return text(String(user.id || user.username || ""), "actor", 160, true); }
function actorName(user = {}) { return text(String(user.name || user.username || actorId(user)), "actorName", 160, true); }
function isCommissionManager(user = {}) { return user.role === "commission" && user.accountType === "manager"; }
function assertCommissionManager(user) { if (!isCommissionManager(user)) fail("ACCOUNT_LIFECYCLE_ROLE_DENIED", "only commission manager accounts may manage account lifecycle", 403); }
function normalizeType(value) { const raw = text(value, "type", 40, true); return TYPE_ALIASES[raw] || raw; }
function permissions(value) {
  const items = Array.isArray(value) ? value : text(value || "", "permissions", 4000).split(/[，,]/);
  return [...new Set(items.map((item) => text(String(item), "permission", 160)).filter(Boolean))].slice(0, 200);
}
function findAccount(state, identifier) {
  const key = text(identifier || "", "accountId", 160);
  return (Array.isArray(state?.authUsers) ? state.authUsers : []).find((item) => [item.id, item.accountCode, item.username].map(String).includes(key));
}
function digest(value) {
  const stable = (item) => Array.isArray(item) ? item.map(stable) : item && typeof item === "object"
    ? Object.keys(item).sort().reduce((result, key) => { if (!['idempotencyKey', 'commandId', 'requesterId', 'requesterName', 'requestedAction'].includes(key)) result[key] = stable(item[key]); return result; }, {})
    : item;
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}
function identity(endpoint, resourceId, payload, user, header) {
  const headerKey = text(String(header || ""), "Idempotency-Key", 200);
  const bodyKey = text(payload.idempotencyKey || payload.commandId || "", "idempotencyKey", 200);
  if (headerKey && bodyKey && headerKey !== bodyKey) fail("ACCOUNT_LIFECYCLE_IDEMPOTENCY_KEY_MISMATCH", "body idempotency key must match Idempotency-Key");
  const selected = headerKey || bodyKey;
  if (!selected) fail("ACCOUNT_LIFECYCLE_IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required");
  return { keyHash: digest({ endpoint, resourceId, actor: actorId(user), selected }), requestDigest: digest(payload) };
}
function receipts(state) { return Array.isArray(state?.[RECEIPT_COLLECTION]) ? state[RECEIPT_COLLECTION] : []; }
function replay(state, command) {
  const prior = receipts(state).find((item) => item.keyHash === command.keyHash);
  if (!prior) return null;
  if (prior.requestDigest !== command.requestDigest) fail("ACCOUNT_LIFECYCLE_IDEMPOTENCY_CONFLICT", "Idempotency-Key is already bound to another command", 409);
  return structuredClone(prior.response);
}
function storeReceipt(state, command, response, now) { state[RECEIPT_COLLECTION] = [{ ...command, response: structuredClone(response), at: now }, ...receipts(state)].slice(0, 2000); }
function safeInteger(value, code, message) { const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed < 0) fail(code, message); return parsed; }
function collectionVersion(state) { const value = state?.accountLifecycleVersion; return Number.isSafeInteger(value) && value >= 0 ? value : 0; }
function publicRequest(request) { const copy = structuredClone(request); delete copy.commandReceipts; return copy; }
function publicAccount(account) {
  const allowed = ["id", "accountCode", "username", "name", "role", "roleName", "orgCode", "orgName", "orgType", "accountType", "status", "permissions", "catalogVisible"];
  return Object.fromEntries(allowed.filter((key) => Object.hasOwn(account, key)).map((key) => [key, structuredClone(account[key])]));
}

function checkConflicts(state, input, actor, options = {}) {
  assertCommissionManager(actor);
  const type = normalizeType(input.type);
  const issues = [];
  if (!REQUEST_TYPES.includes(type)) issues.push({ code: "ACCOUNT_LIFECYCLE_TYPE_UNSUPPORTED", message: "account lifecycle request type is not supported" });
  const account = type === "create" ? null : findAccount(state, input.accountId);
  if (type !== "create" && !account) issues.push({ code: "ACCOUNT_LIFECYCLE_ACCOUNT_NOT_FOUND", message: "target account was not found" });
  const username = text(input.username || "", "username", 120);
  if (type === "create") {
    if (!username) issues.push({ code: "ACCOUNT_LIFECYCLE_USERNAME_REQUIRED", message: "account creation requires a username" });
    if ((state.authUsers || []).some((item) => String(item.username || "").toLowerCase() === username.toLowerCase())) issues.push({ code: "ACCOUNT_LIFECYCLE_USERNAME_CONFLICT", message: "username already exists" });
    if (!text(input.displayName || "", "displayName", 160)) issues.push({ code: "ACCOUNT_LIFECYCLE_NAME_REQUIRED", message: "account creation requires a display name" });
    if (!text(input.role || "", "role", 80)) issues.push({ code: "ACCOUNT_LIFECYCLE_ROLE_REQUIRED", message: "account creation requires a role" });
    else if (!ACCOUNT_ROLES.includes(text(input.role, "role", 80))) issues.push({ code: "ACCOUNT_LIFECYCLE_ROLE_INVALID", message: "requested account role is not supported" });
    if (!text(input.orgCode || "", "orgCode", 120)) issues.push({ code: "ACCOUNT_LIFECYCLE_ORG_REQUIRED", message: "account creation requires an organization" });
  }
  if (type === "disable" && account) {
    if (actorId(actor) === String(account.id || account.username)) issues.push({ code: "ACCOUNT_LIFECYCLE_SELF_DISABLE_DENIED", message: "the current account cannot disable itself" });
    if (account.status === "停用") issues.push({ code: "ACCOUNT_LIFECYCLE_ALREADY_DISABLED", message: "target account is already disabled" });
    if (account.role === "commission" && account.accountType === "manager") {
      const activeManagers = (state.authUsers || []).filter((item) => item.role === "commission" && item.accountType === "manager" && item.status !== "停用");
      if (activeManagers.length <= 1) issues.push({ code: "ACCOUNT_LIFECYCLE_LAST_MANAGER_DENIED", message: "the last active commission manager cannot be disabled" });
    }
  }
  if (type === "change" && account && input.role) {
    const requestedRole = text(input.role, "role", 80);
    if (!ACCOUNT_ROLES.includes(requestedRole)) issues.push({ code: "ACCOUNT_LIFECYCLE_ROLE_INVALID", message: "requested account role is not supported" });
    if (account.role === "commission" && account.accountType === "manager" && requestedRole !== "commission") {
      const activeManagers = (state.authUsers || []).filter((item) => item.role === "commission" && item.accountType === "manager" && item.status !== "停用");
      if (activeManagers.length <= 1) issues.push({ code: "ACCOUNT_LIFECYCLE_LAST_MANAGER_DENIED", message: "the last active commission manager cannot be moved to another role" });
    }
  }
  if (type === "restore" && account && account.status !== "停用") issues.push({ code: "ACCOUNT_LIFECYCLE_NOT_DISABLED", message: "only disabled accounts may be restored" });
  const requestedPermissions = permissions(input.permissions);
  for (const [left, right, message] of CONFLICT_PAIRS) if (requestedPermissions.includes(left) && requestedPermissions.includes(right)) issues.push({ code: "ACCOUNT_LIFECYCLE_DUTY_CONFLICT", message });
  if (type === "temporary-grant") {
    const start = Date.parse(input.validFrom || "");
    const end = Date.parse(input.validUntil || "");
    const now = Date.parse(options.now || new Date().toISOString());
    if (!requestedPermissions.length) issues.push({ code: "ACCOUNT_LIFECYCLE_PERMISSION_REQUIRED", message: "temporary grant requires at least one permission" });
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end <= now) issues.push({ code: "ACCOUNT_LIFECYCLE_VALIDITY_INVALID", message: "temporary grant validity is invalid" });
    if (Number.isFinite(start) && Number.isFinite(end) && end - start > 90 * 86_400_000) issues.push({ code: "ACCOUNT_LIFECYCLE_VALIDITY_TOO_LONG", message: "temporary grants cannot exceed 90 days" });
  }
  if (text(input.reason || "", "reason", 1000).length < 8) issues.push({ code: "ACCOUNT_LIFECYCLE_REASON_REQUIRED", message: "request reason must contain at least 8 characters" });
  return issues;
}

function createRequest(state, input, actor, options = {}) {
  assertCommissionManager(actor);
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("ACCOUNT_LIFECYCLE_INPUT_INVALID", "request body must be an object");
  const allowed = new Set(["type", "accountId", "username", "displayName", "role", "orgCode", "permissions", "validFrom", "validUntil", "reason", "expectedVersion", "idempotencyKey", "commandId", "requesterId", "requesterName", "requestedAction"]);
  if (Object.keys(input).some((key) => !allowed.has(key))) fail("ACCOUNT_LIFECYCLE_INPUT_INVALID", "request body contains unsupported fields");
  const command = identity("create-request", "account-lifecycle", input, actor, options.idempotencyKey);
  const prior = replay(state, command);
  if (prior) return { state: structuredClone(state), request: prior, replayed: true };
  const expectedVersion = safeInteger(input.expectedVersion, "ACCOUNT_LIFECYCLE_EXPECTED_VERSION_REQUIRED", "expectedVersion must be a non-negative safe integer");
  if (expectedVersion !== collectionVersion(state)) fail("ACCOUNT_LIFECYCLE_VERSION_CONFLICT", "account request collection changed; refresh before retrying", 409);
  const issues = checkConflicts(state, input, actor, options);
  if (issues.length) { const error = new AccountLifecycleError("ACCOUNT_LIFECYCLE_CONFLICT", issues.map((item) => item.message).join("; "), 409); error.conflicts = issues; throw error; }
  const now = options.now || new Date().toISOString();
  const type = normalizeType(input.type);
  const request = {
    id: `alr-${(options.randomUUID || randomUUID)()}`, type, accountId: text(input.accountId || "", "accountId", 160), username: text(input.username || "", "username", 120),
    displayName: text(input.displayName || "", "displayName", 160), role: text(input.role || "", "role", 80), orgCode: text(input.orgCode || "", "orgCode", 120),
    permissions: permissions(input.permissions), validFrom: text(input.validFrom || "", "validFrom", 60), validUntil: text(input.validUntil || "", "validUntil", 60),
    reason: text(input.reason, "reason", 1000, true), requesterId: actorId(actor), requesterName: actorName(actor), status: "pending-review", version: 0,
    createdAt: now, updatedAt: now, timeline: [{ at: now, actorId: actorId(actor), actorName: actorName(actor), action: "request-submitted", note: text(input.reason, "reason", 1000, true) }]
  };
  const nextState = structuredClone(state || {});
  nextState[REQUEST_COLLECTION] = [request, ...(Array.isArray(nextState[REQUEST_COLLECTION]) ? nextState[REQUEST_COLLECTION] : [])].slice(0, 5000);
  nextState.accountLifecycleVersion = collectionVersion(state) + 1;
  const response = publicRequest(request); storeReceipt(nextState, command, response, now);
  return { state: nextState, request: response, replayed: false };
}

function applyApprovedRequest(state, request, reviewer, now, options = {}) {
  const users = Array.isArray(state.authUsers) ? state.authUsers : [];
  const account = request.type === "create" ? null : findAccount(state, request.accountId);
  if (request.type === "create") {
    const user = {
      id: `u-${(options.randomUUID || randomUUID)()}`, accountCode: `ACCOUNT-${String(request.username).toUpperCase()}`, username: request.username,
      name: request.displayName, role: request.role, roleName: request.role, orgCode: request.orgCode, accountType: request.role === "citizen" ? "resident" : "manager",
      permissions: request.permissions, status: "待绑定", loginDisabled: true, catalogVisible: false, createdAt: now, createdBy: actorId(reviewer)
    };
    state.authUsers = [user, ...users];
    return { result: "account-created-pending-identity-binding", account: publicAccount(user) };
  }
  const index = users.findIndex((item) => item === account || item.id === account.id || item.username === account.username);
  if (index < 0) fail("ACCOUNT_LIFECYCLE_ACCOUNT_NOT_FOUND", "target account was not found", 404);
  if (request.type === "change") {
    const updated = { ...users[index] };
    if (request.displayName) updated.name = request.displayName;
    if (request.role) updated.role = request.role;
    if (request.orgCode) updated.orgCode = request.orgCode;
    if (request.permissions.length) updated.permissions = request.permissions;
    updated.updatedAt = now; updated.updatedBy = actorId(reviewer); state.authUsers[index] = updated;
    return { result: "account-changed", account: publicAccount(updated) };
  }
  if (request.type === "disable") { state.authUsers[index] = { ...users[index], status: "停用", disabledAt: now, disabledBy: actorId(reviewer) }; return { result: "account-disabled", account: publicAccount(state.authUsers[index]) }; }
  if (request.type === "restore") { state.authUsers[index] = { ...users[index], status: "启用", restoredAt: now, restoredBy: actorId(reviewer) }; return { result: "account-restored", account: publicAccount(state.authUsers[index]) }; }
  const grant = {
    id: `atg-${(options.randomUUID || randomUUID)()}`, requestId: request.id, accountId: String(account.id || account.username), username: account.username,
    permissions: request.permissions, validFrom: request.validFrom, validUntil: request.validUntil, status: "active", approvedAt: now, approvedBy: actorId(reviewer)
  };
  state[GRANT_COLLECTION] = [grant, ...(Array.isArray(state[GRANT_COLLECTION]) ? state[GRANT_COLLECTION] : [])].slice(0, 5000);
  return { result: "temporary-grant-activated", grant: structuredClone(grant) };
}

function reviewRequest(state, requestId, input, reviewer, options = {}) {
  assertCommissionManager(reviewer);
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("ACCOUNT_LIFECYCLE_INPUT_INVALID", "review body must be an object");
  const allowed = new Set(["decision", "note", "expectedVersion", "idempotencyKey", "commandId"]);
  if (Object.keys(input).some((key) => !allowed.has(key))) fail("ACCOUNT_LIFECYCLE_INPUT_INVALID", "review body contains unsupported fields");
  const id = text(requestId, "requestId", 200, true);
  const command = identity("review-request", id, input, reviewer, options.idempotencyKey);
  const prior = replay(state, command);
  if (prior) return { state: structuredClone(state), request: prior, replayed: true };
  const rows = Array.isArray(state?.[REQUEST_COLLECTION]) ? state[REQUEST_COLLECTION] : [];
  const index = rows.findIndex((item) => item.id === id);
  if (index < 0) fail("ACCOUNT_LIFECYCLE_REQUEST_NOT_FOUND", "account lifecycle request was not found", 404);
  const current = rows[index];
  if (current.status !== "pending-review") fail("ACCOUNT_LIFECYCLE_REVIEW_STATE_CONFLICT", "request is not pending independent review", 409);
  if (current.requesterId === actorId(reviewer)) fail("ACCOUNT_LIFECYCLE_SELF_REVIEW_DENIED", "requester and reviewer must be different accounts", 403);
  const expectedVersion = safeInteger(input.expectedVersion, "ACCOUNT_LIFECYCLE_EXPECTED_VERSION_REQUIRED", "expectedVersion must be a non-negative safe integer");
  if (expectedVersion !== current.version) fail("ACCOUNT_LIFECYCLE_REQUEST_VERSION_CONFLICT", "request changed; refresh before retrying", 409);
  const decision = text(input.decision, "decision", 20, true);
  if (!["approve", "reject"].includes(decision)) fail("ACCOUNT_LIFECYCLE_DECISION_INVALID", "review decision must be approve or reject");
  const note = text(input.note, "note", 1000, true);
  if (note.length < 8) fail("ACCOUNT_LIFECYCLE_REVIEW_NOTE_REQUIRED", "review note must contain at least 8 characters");
  if (decision === "approve") {
    const issues = checkConflicts(state, current, reviewer, options);
    if (issues.length) { const error = new AccountLifecycleError("ACCOUNT_LIFECYCLE_CONFLICT", issues.map((item) => item.message).join("; "), 409); error.conflicts = issues; throw error; }
  }
  const now = options.now || new Date().toISOString();
  const nextState = structuredClone(state);
  const updated = { ...current, status: decision === "reject" ? "rejected" : "approved", version: current.version + 1, reviewerId: actorId(reviewer), reviewerName: actorName(reviewer), reviewedAt: now, updatedAt: now };
  if (decision === "approve") { updated.application = applyApprovedRequest(nextState, updated, reviewer, now, options); updated.status = "applied"; }
  updated.timeline = [{ at: now, actorId: actorId(reviewer), actorName: actorName(reviewer), action: decision === "approve" ? "independent-review-approved" : "independent-review-rejected", note }, ...(current.timeline || [])].slice(0, 100);
  nextState[REQUEST_COLLECTION] = rows.map((item, itemIndex) => itemIndex === index ? updated : item);
  nextState.accountLifecycleVersion = collectionVersion(state) + 1;
  const response = publicRequest(updated); storeReceipt(nextState, command, response, now);
  return { state: nextState, request: response, replayed: false };
}

function activeTemporaryPermissions(state, accountId, now = new Date().toISOString()) {
  const time = Date.parse(now);
  return [...new Set((Array.isArray(state?.[GRANT_COLLECTION]) ? state[GRANT_COLLECTION] : [])
    .filter((grant) => grant.accountId === accountId || grant.username === accountId)
    .filter((grant) => grant.status === "active" && Date.parse(grant.validFrom) <= time && Date.parse(grant.validUntil) > time)
    .flatMap((grant) => grant.permissions || []))];
}

function listCenter(state, actor, options = {}) {
  assertCommissionManager(actor);
  const now = options.now || new Date().toISOString();
  const grants = (Array.isArray(state?.[GRANT_COLLECTION]) ? state[GRANT_COLLECTION] : []).map((grant) => ({ ...structuredClone(grant), status: grant.status === "active" && Date.parse(grant.validUntil) <= Date.parse(now) ? "expired" : grant.status }));
  const requests = (Array.isArray(state?.[REQUEST_COLLECTION]) ? state[REQUEST_COLLECTION] : []).map(publicRequest);
  return {
    generatedAt: now, collectionVersion: collectionVersion(state), accounts: (state.authUsers || []).map(publicAccount), requests, temporaryGrants: grants,
    summary: { accounts: (state.authUsers || []).length, pendingReview: requests.filter((item) => item.status === "pending-review").length, activeTemporaryGrants: grants.filter((item) => item.status === "active").length, expiredTemporaryGrants: grants.filter((item) => item.status === "expired").length }
  };
}

module.exports = {
  ACCOUNT_ROLES, AccountLifecycleError, CONFLICT_PAIRS, GRANT_COLLECTION, RECEIPT_COLLECTION, REQUEST_COLLECTION, REQUEST_TYPES,
  activeTemporaryPermissions, assertCommissionManager, checkConflicts, createRequest, isCommissionManager, listCenter,
  normalizeType, publicAccount, publicRequest, reviewRequest
};
