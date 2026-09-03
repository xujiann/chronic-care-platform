"use strict";

const { createHash, randomUUID } = require("node:crypto");

const TASK_STATE_COLLECTION = "unifiedWorkTaskStates";
const RECEIPT_COLLECTION = "unifiedWorkCenterCommandReceipts";
const ACTIONS = Object.freeze(["claim", "transfer", "return", "escalate", "complete"]);
const CLOSED = new Set(["completed", "closed", "cancelled", "已完成", "已关闭"]);

class WorkCenterError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = "WorkCenterError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function fail(code, message, statusCode) { throw new WorkCenterError(code, message, statusCode); }
function text(value, field, maximum = 500, required = false) {
  if (value === undefined && !required) return "";
  if (typeof value !== "string") fail("WORK_CENTER_INPUT_INVALID", `${field} must be a string`);
  const normalized = value.trim().replace(/[\r\n\t]+/g, " ");
  if ((required && !normalized) || normalized.length > maximum) fail("WORK_CENTER_INPUT_INVALID", `${field} is invalid`);
  return normalized;
}
function actorId(user = {}) { return text(String(user.username || user.id || ""), "actor", 160, true); }
function digest(value) {
  const stable = (item) => Array.isArray(item) ? item.map(stable) : item && typeof item === "object"
    ? Object.keys(item).sort().reduce((result, key) => { if (!['idempotencyKey', 'commandId'].includes(key)) result[key] = stable(item[key]); return result; }, {})
    : item;
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}
function commandIdentity(endpoint, resourceId, payload, user, idempotencyKey) {
  const bodyKey = text(payload.idempotencyKey || payload.commandId || "", "idempotencyKey", 200);
  const headerKey = text(String(idempotencyKey || ""), "Idempotency-Key", 200);
  if (bodyKey && headerKey && bodyKey !== headerKey) fail("WORK_CENTER_IDEMPOTENCY_KEY_MISMATCH", "body idempotency key must match Idempotency-Key");
  const selected = headerKey || bodyKey;
  if (!selected) fail("WORK_CENTER_IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required");
  return { keyHash: digest({ endpoint, resourceId, actor: actorId(user), selected }), requestDigest: digest(payload) };
}
function receiptRows(state) { return Array.isArray(state?.[RECEIPT_COLLECTION]) ? state[RECEIPT_COLLECTION] : []; }
function findReplay(state, identity) {
  const receipt = receiptRows(state).find((item) => item.keyHash === identity.keyHash);
  if (!receipt) return null;
  if (receipt.requestDigest !== identity.requestDigest) fail("WORK_CENTER_IDEMPOTENCY_CONFLICT", "Idempotency-Key is already bound to another command", 409);
  return structuredClone(receipt.response);
}
function storeReceipt(state, identity, response, now) {
  state[RECEIPT_COLLECTION] = [{ ...identity, at: now, response: structuredClone(response) }, ...receiptRows(state)].slice(0, 2000);
}
function integer(value, field) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) fail("WORK_CENTER_EXPECTED_VERSION_REQUIRED", `${field} must be a non-negative safe integer`);
  return parsed;
}
function workStateRows(state) { return Array.isArray(state?.[TASK_STATE_COLLECTION]) ? state[TASK_STATE_COLLECTION] : []; }
function publicWorkState(record) { const copy = structuredClone(record); delete copy.commandReceipts; return copy; }
function mergeTask(task, stateRecord) {
  if (!stateRecord) return { ...task, workCenterVersion: 0 };
  return {
    ...task,
    status: stateRecord.status || task.status,
    owner: stateRecord.assigneeName || stateRecord.assigneeId || task.owner,
    assignee: stateRecord.assigneeName || stateRecord.assigneeId || "",
    escalationLevel: stateRecord.escalationLevel || task.escalationLevel,
    workCenterVersion: stateRecord.version,
    workCenterTimeline: structuredClone(stateRecord.timeline || [])
  };
}
function authorizedTasks(state, user, buildUnifiedTasks) {
  if (typeof buildUnifiedTasks !== "function") fail("WORK_CENTER_DEPENDENCY_MISSING", "task scope builder is unavailable", 500);
  const overlays = new Map(workStateRows(state).map((item) => [item.taskId, item]));
  return buildUnifiedTasks(state, user).map((task) => mergeTask(task, overlays.get(task.id)));
}
function authorizedMessages(state, user, canAccessTaskMessage) {
  if (typeof canAccessTaskMessage !== "function") fail("WORK_CENTER_DEPENDENCY_MISSING", "message scope checker is unavailable", 500);
  return (Array.isArray(state?.taskMessages) ? state.taskMessages : [])
    .filter((message) => canAccessTaskMessage(user, message, state))
    .map((message) => ({ ...structuredClone(message), workCenterVersion: Number.isSafeInteger(message.workCenterVersion) ? message.workCenterVersion : 0 }));
}
function buildCenter(state, user, dependencies = {}) {
  const tasks = authorizedTasks(state, user, dependencies.buildUnifiedTasks);
  const messages = authorizedMessages(state, user, dependencies.canAccessTaskMessage);
  return {
    generatedAt: new Date().toISOString(),
    tasks,
    messages,
    summary: {
      total: tasks.length,
      open: tasks.filter((item) => !CLOSED.has(item.status)).length,
      overdue: tasks.filter((item) => item.overdue && !CLOSED.has(item.status)).length,
      unassigned: tasks.filter((item) => !(item.assignee || item.owner)).length,
      unread: messages.filter((item) => !["read", "已读"].includes(item.status)).length
    }
  };
}
function assertTaskActionScope(task, action, user, payload) {
  const role = text(String(user.role || ""), "role", 80, true);
  if (role === "commission") {
    if (["claim", "return", "complete"].includes(action) && task.role !== "commission") {
      fail("WORK_CENTER_ACTION_SCOPE_DENIED", "management users may coordinate but cannot perform another role's business action", 403);
    }
  } else if (task.role !== role) {
    fail("WORK_CENTER_ACTION_SCOPE_DENIED", "task role is outside the caller scope", 403);
  }
  if (action === "transfer") {
    const targetRole = text(payload.targetRole || task.role, "targetRole", 80, true);
    if (targetRole !== task.role) fail("WORK_CENTER_TRANSFER_ROLE_EXPANSION_DENIED", "transfer cannot change the task role", 403);
    const targetOrgCode = text(payload.targetOrgCode || user.orgCode || "", "targetOrgCode", 120);
    if (role !== "commission" && targetOrgCode !== text(String(user.orgCode || ""), "orgCode", 120)) {
      fail("WORK_CENTER_TRANSFER_SCOPE_EXPANSION_DENIED", "transfer cannot expand the organization scope", 403);
    }
  }
}
function executeTaskAction(state, taskId, payload, user, options = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) fail("WORK_CENTER_INPUT_INVALID", "action body must be an object");
  const allowed = new Set(["action", "expectedVersion", "assignee", "targetAssignee", "targetAssigneeName", "targetRole", "targetOrgCode", "comment", "idempotencyKey", "commandId"]);
  if (Object.keys(payload).some((key) => !allowed.has(key))) fail("WORK_CENTER_INPUT_INVALID", "action body contains unsupported fields");
  const action = text(payload.action, "action", 40, true);
  if (!ACTIONS.includes(action)) fail("WORK_CENTER_ACTION_UNSUPPORTED", "task action is not supported");
  const normalizedTaskId = text(taskId, "taskId", 240, true);
  const identity = commandIdentity("task-action", normalizedTaskId, payload, user, options.idempotencyKey);
  const task = authorizedTasks(state, user, options.buildUnifiedTasks).find((item) => item.id === normalizedTaskId);
  if (!task) fail("WORK_CENTER_TASK_NOT_FOUND", "task was not found in the caller's authorized scope", 404);
  const prior = findReplay(state, identity);
  if (prior) return { state: structuredClone(state), task: prior, replayed: true };
  assertTaskActionScope(task, action, user, payload);
  const rows = workStateRows(state);
  const index = rows.findIndex((item) => item.taskId === normalizedTaskId);
  const current = index >= 0 ? rows[index] : { taskId: normalizedTaskId, version: 0, status: task.status, assigneeId: "", assigneeName: "", escalationLevel: task.escalationLevel || "", timeline: [] };
  const expectedVersion = integer(payload.expectedVersion, "expectedVersion");
  if (expectedVersion !== current.version) fail("WORK_CENTER_VERSION_CONFLICT", "task changed; refresh before retrying", 409);
  const comment = text(payload.comment || "", "comment", 1000);
  if (["return", "escalate", "complete"].includes(action) && comment.length < 2) fail("WORK_CENTER_COMMENT_REQUIRED", "return, escalate and complete require a processing note");
  const now = options.now || new Date().toISOString();
  const next = { ...current, version: current.version + 1, updatedAt: now };
  if (action === "claim") {
    if (current.assigneeId && current.assigneeId !== actorId(user)) fail("WORK_CENTER_ALREADY_CLAIMED", "task is already claimed by another account", 409);
    next.assigneeId = actorId(user); next.assigneeName = text(String(user.name || actorId(user)), "actorName", 160); next.status = "processing";
  }
  if (action === "transfer") {
    next.assigneeId = text(payload.targetAssignee || payload.assignee, "targetAssignee", 160, true);
    next.assigneeName = text(payload.targetAssigneeName || payload.targetAssignee || payload.assignee, "targetAssigneeName", 160, true);
    next.targetRole = text(payload.targetRole || task.role, "targetRole", 80, true);
    next.targetOrgCode = text(payload.targetOrgCode || user.orgCode || "", "targetOrgCode", 120);
    next.status = "assigned";
  }
  if (action === "return") { next.assigneeId = ""; next.assigneeName = ""; next.status = "returned"; }
  if (action === "escalate") { const level = Math.min(3, Number(String(current.escalationLevel || "0").match(/\d+/)?.[0] || 0) + 1); next.escalationLevel = `level-${level}`; next.status = "escalated"; }
  if (action === "complete") next.status = "completed";
  next.timeline = [{ at: now, actorId: actorId(user), actorName: text(String(user.name || actorId(user)), "actorName", 160), action, comment }, ...(current.timeline || [])].slice(0, 100);
  const nextState = structuredClone(state || {});
  const nextRows = [...rows];
  if (index >= 0) nextRows[index] = next; else nextRows.unshift(next);
  nextState[TASK_STATE_COLLECTION] = nextRows.slice(0, 5000);
  const response = mergeTask(task, next);
  storeReceipt(nextState, identity, response, now);
  return { state: nextState, task: response, replayed: false };
}

function sendTaskMessage(state, taskId, payload, user, options = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) fail("WORK_CENTER_INPUT_INVALID", "message body must be an object");
  const allowed = new Set(["expectedVersion", "targetRole", "channel", "title", "body", "message", "idempotencyKey", "commandId"]);
  if (Object.keys(payload).some((key) => !allowed.has(key))) fail("WORK_CENTER_INPUT_INVALID", "message body contains unsupported fields");
  const normalizedTaskId = text(taskId, "taskId", 240, true);
  const identity = commandIdentity("task-message", normalizedTaskId, payload, user, options.idempotencyKey);
  const task = authorizedTasks(state, user, options.buildUnifiedTasks).find((item) => item.id === normalizedTaskId);
  if (!task) fail("WORK_CENTER_TASK_NOT_FOUND", "task was not found in the caller's authorized scope", 404);
  const prior = findReplay(state, identity);
  if (prior) return { state: structuredClone(state), message: prior, replayed: true };
  const targetRole = text(payload.targetRole || task.role, "targetRole", 80, true);
  if (targetRole !== task.role) fail("WORK_CENTER_MESSAGE_SCOPE_EXPANSION_DENIED", "message cannot expand the task role", 403);
  const body = text(payload.body || payload.message, "body", 2000, true);
  const channel = text(payload.channel || "in_app", "channel", 40, true);
  if (!["in_app", "sms", "subscription"].includes(channel)) fail("WORK_CENTER_MESSAGE_CHANNEL_UNSUPPORTED", "message channel is not supported");
  const expectedVersion = integer(payload.expectedVersion, "expectedVersion");
  if (expectedVersion !== task.workCenterVersion) fail("WORK_CENTER_VERSION_CONFLICT", "task changed; refresh before sending a message", 409);
  const now = options.now || new Date().toISOString();
  const message = {
    id: `msg-${(options.randomUUID || randomUUID)()}`, taskId: task.id, collection: task.collection, sourceId: task.sourceId,
    residentId: task.residentId || "", targetRole, channel, title: text(payload.title || `任务提醒：${task.title}`, "title", 300, true), body,
    status: channel === "in_app" ? "sent" : "pending-delivery", deliveryBoundary: channel === "in_app" ? "persisted-in-app" : "external-delivery-receipt-required", receipts: [], workCenterVersion: 0, createdAt: now, createdBy: actorId(user), createdByName: text(String(user.name || actorId(user)), "actorName", 160)
  };
  const nextState = structuredClone(state || {});
  nextState.taskMessages = [message, ...(Array.isArray(nextState.taskMessages) ? nextState.taskMessages : [])].slice(0, 3000);
  storeReceipt(nextState, identity, message, now);
  return { state: nextState, message, replayed: false };
}

function acknowledgeMessage(state, messageId, payload, user, options = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) fail("WORK_CENTER_INPUT_INVALID", "receipt body must be an object");
  const normalizedId = text(messageId, "messageId", 240, true);
  const identity = commandIdentity("message-receipt", normalizedId, payload, user, options.idempotencyKey);
  const visible = authorizedMessages(state, user, options.canAccessTaskMessage).find((item) => item.id === normalizedId);
  if (!visible) fail("WORK_CENTER_MESSAGE_NOT_FOUND", "message was not found in the caller's authorized scope", 404);
  const prior = findReplay(state, identity);
  if (prior) return { state: structuredClone(state), message: prior, replayed: true };
  const expectedVersion = integer(payload.expectedVersion, "expectedVersion");
  if (expectedVersion !== visible.workCenterVersion) fail("WORK_CENTER_MESSAGE_VERSION_CONFLICT", "message changed; refresh before retrying", 409);
  const nextState = structuredClone(state || {});
  const index = (nextState.taskMessages || []).findIndex((item) => item.id === normalizedId);
  const now = options.now || new Date().toISOString();
  const receipt = { at: now, by: actorId(user), byName: text(String(user.name || actorId(user)), "actorName", 160), status: "read" };
  const updated = { ...nextState.taskMessages[index], status: "read", workCenterVersion: expectedVersion + 1, receipts: [receipt, ...(nextState.taskMessages[index].receipts || [])].slice(0, 30) };
  nextState.taskMessages[index] = updated;
  storeReceipt(nextState, identity, updated, now);
  return { state: nextState, message: updated, replayed: false };
}

module.exports = {
  ACTIONS, CLOSED, RECEIPT_COLLECTION, TASK_STATE_COLLECTION, WorkCenterError, acknowledgeMessage, authorizedMessages,
  authorizedTasks, buildCenter, executeTaskAction, mergeTask, sendTaskMessage
};
