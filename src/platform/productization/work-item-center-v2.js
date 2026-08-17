"use strict";

const crypto = require("node:crypto");
const defaultProgram = require("../../../config/product-regional-enhancement-program.json");
const sourceCatalog = require("../../../config/platform-work-item-sources.json");

const TERMINAL_SOURCE_STATUS = /^(?:complete|completed|closed|resolved|accepted|ready|sent|delivered|feedback_submitted|演示契约就绪)$/i;
const MESSAGE_KINDS = Object.freeze(["note", "handoff", "blocker", "resolution"]);
const ACTIONS = Object.freeze(["dispatch", "claim", "message", "read", "block", "resolve", "reopen", "escalate"]);
const STATUS_TRANSITIONS = Object.freeze({
  queued: Object.freeze({ dispatch: "dispatched", escalate: "escalated" }),
  dispatched: Object.freeze({ claim: "in-progress", message: "dispatched", read: "dispatched", escalate: "escalated" }),
  "in-progress": Object.freeze({ message: "in-progress", read: "in-progress", block: "blocked", resolve: "resolved", escalate: "escalated" }),
  blocked: Object.freeze({ message: "blocked", read: "blocked", resolve: "resolved", escalate: "escalated" }),
  escalated: Object.freeze({ dispatch: "dispatched", claim: "in-progress", message: "escalated", read: "escalated", resolve: "resolved" }),
  resolved: Object.freeze({ message: "resolved", read: "resolved", reopen: "dispatched" }),
  observed: Object.freeze({})
});
const FORBIDDEN_INPUT_KEYS = /(?:patient|resident|idcard|identitynumber|mobile|phone|address|diagnosis|medical|payload|credential|password|secret|token|privatekey|endpoint|host|filepath)/i;

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(String(value)).digest("hex")}`;
}

function assertOpaque(label, value, minimum = 4, maximum = 96) {
  const text = String(value || "").trim();
  if (text.length < minimum || text.length > maximum || !/^[A-Za-z0-9._:-]+$/.test(text)) {
    throw new TypeError(`${label} must be a bounded opaque identifier`);
  }
  return text;
}

function assertNoForbiddenKeys(value, path = "command") {
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_INPUT_KEYS.test(key)) throw new TypeError(`${path}.${key} is not allowed`);
    if (nested && typeof nested === "object") assertNoForbiddenKeys(nested, `${path}.${key}`);
  }
}

function validateProgram(program = defaultProgram) {
  if (program?.schemaVersion !== "product-regional-enhancement-program-v1") throw new TypeError("product regional enhancement program is invalid");
  if (!Array.isArray(program.iterations) || program.iterations.length !== 6) throw new TypeError("product regional enhancement program requires six iterations");
  if (new Set(program.iterations.map((iteration) => iteration?.id)).size !== 6 || program.iterations.some((iteration) => !/^iteration-[1-6]-[a-z-]+$/.test(String(iteration?.id || "")) || !Array.isArray(iteration.capabilities) || iteration.capabilities.length === 0)) throw new TypeError("product regional enhancement iterations must be unique and declare capabilities");
  const workItems = program.workItems;
  if (!Array.isArray(workItems?.activeRoles) || workItems.activeRoles.length === 0 || new Set(workItems.activeRoles).size !== workItems.activeRoles.length || !workItems.activeRoles.includes("platform-governance")) throw new TypeError("active work item roles are required and must include platform-governance");
  if (!workItems.priorityAliases || !workItems.slaHours) throw new TypeError("priority aliases and SLA hours are required");
  for (const priority of ["critical", "high", "medium", "normal", "low"]) {
    if (!Number.isInteger(workItems.slaHours[priority]) || workItems.slaHours[priority] < 1) throw new TypeError(`SLA hours are invalid for ${priority}`);
  }
  if (!(workItems.dueSoonRatio > 0 && workItems.dueSoonRatio < 1)) throw new TypeError("dueSoonRatio must be between zero and one");
  for (const field of ["maximumMessagesPerItem", "maximumTimelineEvents", "maximumWorkItems", "maximumReopens", "maximumEscalations"]) {
    if (!Number.isInteger(workItems[field]) || workItems[field] < 1) throw new TypeError(`${field} must be a positive integer`);
  }
  return true;
}

function normalizePriority(value, program = defaultProgram) {
  const key = String(value || "normal").trim().toLowerCase();
  return program.workItems.priorityAliases[key] || "normal";
}

function validTimestamp(value) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

function addHours(value, hours) {
  return new Date(Date.parse(value) + hours * 60 * 60 * 1000).toISOString();
}

function sourceRows(data, options = {}) {
  const catalog = options.catalog || sourceCatalog;
  const program = options.program || defaultProgram;
  validateProgram(program);
  if (catalog?.schemaVersion !== "platform-work-item-sources-v1") throw new TypeError("work item source catalog is invalid");
  const now = validTimestamp(options.now) || new Date().toISOString();
  return catalog.sources.flatMap((source) => (Array.isArray(data?.[source.collection]) ? data[source.collection] : [])
    .filter((row) => row && typeof row === "object" && row.id)
    .map((row) => {
      const sourceIdentity = `${source.collection}:${row.id}`;
      const priority = normalizePriority(row[source.priorityField], program);
      const sourceDueAt = validTimestamp(row[source.dueField]);
      return Object.freeze({
        id: `w2-${digest(sourceIdentity).slice(7, 23)}`,
        sourceCollection: source.collection,
        sourceRefDigest: digest(sourceIdentity),
        domain: source.domain,
        category: source.label,
        sourceState: TERMINAL_SOURCE_STATUS.test(String(row[source.statusField] || "")) ? "terminal" : "open",
        priority,
        slaHours: program.workItems.slaHours[priority],
        dueAt: sourceDueAt || addHours(now, program.workItems.slaHours[priority])
      });
    }));
}

function timelineEvent(item, action, actorRole, now, referenceId = "") {
  return Object.freeze({
    eventId: `evt-${digest(`${item.id}:${item.version}:${action}`).slice(7, 23)}`,
    action,
    at: now,
    actorRole,
    referenceId,
    resultingStatus: item.status,
    version: item.version
  });
}

function seedWorkItemsV2(data, options = {}) {
  const program = options.program || defaultProgram;
  validateProgram(program);
  const next = structuredClone(data || {});
  const items = Array.isArray(next.platformWorkItemsV2) ? next.platformWorkItemsV2 : [];
  const known = new Set(items.map((item) => item.sourceRefDigest));
  const now = validTimestamp(options.now) || new Date().toISOString();
  for (const source of sourceRows(next, { ...options, program, now })) {
    if (items.length >= program.workItems.maximumWorkItems) break;
    if (known.has(source.sourceRefDigest)) continue;
    const status = source.sourceState === "terminal" ? "observed" : "queued";
    const item = {
      ...source,
      status,
      assignedRole: "",
      claimedByDigest: "",
      messages: [],
      timeline: [],
      reopenCount: 0,
      escalationCount: 0,
      version: 0,
      createdAt: now,
      updatedAt: now,
      latestEvidenceDigest: "",
      latestNoteDigest: ""
    };
    item.timeline.push(timelineEvent(item, "normalized", "platform-governance", now));
    items.push(item);
    known.add(source.sourceRefDigest);
  }
  next.platformWorkItemsV2 = items;
  next.platformWorkItemV2Commands = Array.isArray(next.platformWorkItemV2Commands) ? next.platformWorkItemV2Commands : [];
  return next;
}

function slaState(item, now, program) {
  if (["resolved", "observed"].includes(item.status)) return "closed";
  const remaining = Date.parse(item.dueAt) - Date.parse(now);
  if (!Number.isFinite(remaining) || remaining <= 0) return "breached";
  return remaining <= item.slaHours * 60 * 60 * 1000 * program.workItems.dueSoonRatio ? "due-soon" : "within-sla";
}

function publicMessage(message, program = defaultProgram) {
  const kind = MESSAGE_KINDS.includes(message.kind) ? message.kind : "note";
  const readers = new Set((Array.isArray(message.readByDigests) ? message.readByDigests : []).filter((item) => /^sha256:[a-f0-9]{64}$/.test(item)));
  return Object.freeze({
    id: /^[A-Za-z0-9._:-]{8,40}$/.test(String(message.id || "")) ? message.id : "redacted",
    kind,
    authorRole: program.workItems.activeRoles.includes(message.authorRole) ? message.authorRole : "platform-governance",
    createdAt: validTimestamp(message.createdAt),
    readCount: readers.size
  });
}

function publicItem(item, options = {}) {
  const program = options.program || defaultProgram;
  const now = validTimestamp(options.now) || new Date().toISOString();
  const source = (options.catalog || sourceCatalog).sources.find((candidate) => candidate.collection === item.sourceCollection);
  const priority = Object.hasOwn(program.workItems.slaHours, item.priority) ? item.priority : "normal";
  const dueAt = validTimestamp(item.dueAt) || addHours(now, program.workItems.slaHours[priority]);
  const status = Object.hasOwn(STATUS_TRANSITIONS, item.status) ? item.status : "queued";
  const timeline = (Array.isArray(item.timeline) ? item.timeline : [])
    .slice(-program.workItems.maximumTimelineEvents)
    .map((event) => Object.freeze({
      eventId: /^[A-Za-z0-9._:-]{8,40}$/.test(String(event.eventId || "")) ? event.eventId : "redacted",
      action: [...ACTIONS, "normalized"].includes(event.action) ? event.action : "redacted",
      at: validTimestamp(event.at),
      actorRole: program.workItems.activeRoles.includes(event.actorRole) ? event.actorRole : "platform-governance",
      referenceId: /^[A-Za-z0-9._:-]{8,40}$/.test(String(event.referenceId || "")) ? event.referenceId : "",
      resultingStatus: Object.hasOwn(STATUS_TRANSITIONS, event.resultingStatus) ? event.resultingStatus : "queued",
      version: Number.isInteger(event.version) && event.version >= 0 ? event.version : 0
    }));
  const messages = (Array.isArray(item.messages) ? item.messages : [])
    .slice(-program.workItems.maximumMessagesPerItem)
    .map((message) => publicMessage(message, program));
  return Object.freeze({
    id: /^[A-Za-z0-9._:-]{8,40}$/.test(String(item.id || "")) ? item.id : "redacted",
    sourceCollection: source?.collection || "unregistered",
    sourceRefDigest: /^sha256:[a-f0-9]{64}$/.test(item.sourceRefDigest) ? item.sourceRefDigest : "redacted",
    domain: source?.domain || "platform-governance",
    category: source?.label || "平台运行事项",
    sourceState: item.sourceState === "terminal" ? "terminal" : "open",
    priority,
    slaHours: program.workItems.slaHours[priority],
    dueAt,
    slaState: slaState({ ...item, priority, slaHours: program.workItems.slaHours[priority], dueAt, status }, now, program),
    status,
    assignedRole: program.workItems.activeRoles.includes(item.assignedRole) ? item.assignedRole : "",
    claimed: /^sha256:[a-f0-9]{64}$/.test(String(item.claimedByDigest || "")),
    messages: Object.freeze(messages),
    unreadMessages: messages.filter((message) => message.readCount === 0).length,
    timeline: Object.freeze(timeline),
    reopenCount: Number.isInteger(item.reopenCount) && item.reopenCount >= 0 ? item.reopenCount : 0,
    escalationCount: Number.isInteger(item.escalationCount) && item.escalationCount >= 0 ? item.escalationCount : 0,
    version: Number.isInteger(item.version) && item.version >= 0 ? item.version : 0,
    updatedAt: validTimestamp(item.updatedAt),
    productionReady: false
  });
}

function commandDigest(command) {
  return digest(JSON.stringify({
    itemId: command.itemId,
    action: command.action,
    expectedVersion: command.expectedVersion,
    actorRole: command.actorRole,
    actorDigest: digest(command.actorId || ""),
    targetRole: command.targetRole || "",
    messageId: command.messageId || "",
    kind: command.kind || "",
    contentDigest: command.content ? digest(command.content) : "",
    noteDigest: command.note ? digest(command.note) : "",
    evidenceDigest: command.evidenceRef ? digest(command.evidenceRef) : ""
  }));
}

function applyWorkItemCommandV2(data, command, options = {}) {
  assertNoForbiddenKeys(command);
  const program = options.program || defaultProgram;
  const next = seedWorkItemsV2(data, { ...options, program });
  const commandId = assertOpaque("commandId", command.commandId, 8, 96);
  const itemId = assertOpaque("work item id", command.itemId, 8, 40);
  const action = String(command.action || "").trim();
  if (!ACTIONS.includes(action)) throw new TypeError("work item action is not allowlisted");
  const expectedVersion = Number(command.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) throw new TypeError("expectedVersion must be a non-negative integer");
  const actorRole = String(command.actorRole || "").trim();
  if (!program.workItems.activeRoles.includes(actorRole)) throw new TypeError("actorRole is not allowlisted");
  const actorId = assertOpaque("actorId", command.actorId, 4, 96);
  const requestDigest = commandDigest(command);
  const previous = next.platformWorkItemV2Commands.find((record) => record.commandId === commandId);
  if (previous) {
    if (previous.requestDigest !== requestDigest) {
      const error = new Error("command id was reused with different intent");
      error.code = "PLATFORM_WORK_ITEM_V2_COMMAND_CONFLICT";
      throw error;
    }
    return Object.freeze({ data: next, result: publicItem(next.platformWorkItemsV2.find((item) => item.id === previous.itemId), { ...options, program }), replayed: true });
  }
  const item = next.platformWorkItemsV2.find((candidate) => candidate.id === itemId);
  if (!item) throw new Error("platform work item was not found");
  if (item.version !== expectedVersion) {
    const error = new Error("platform work item version conflict");
    error.code = "PLATFORM_WORK_ITEM_V2_VERSION_CONFLICT";
    throw error;
  }
  const targetStatus = STATUS_TRANSITIONS[item.status]?.[action];
  if (!targetStatus) throw new Error(`action ${action} is not allowed from ${item.status}`);
  const now = validTimestamp(options.now) || new Date().toISOString();
  let referenceId = "";

  if (["dispatch", "reopen"].includes(action) && actorRole !== "platform-governance") throw new Error(`${action} requires platform-governance`);
  if (action === "claim" && actorRole !== item.assignedRole) throw new Error("work item claim role does not match the dispatch role");
  if (["block", "resolve"].includes(action)) {
    const governanceOverride = item.status === "escalated" && actorRole === "platform-governance";
    const ownerAction = actorRole === item.assignedRole && item.claimedByDigest === digest(actorId);
    if (!governanceOverride && !ownerAction) throw new Error(`${action} requires the current claimant or escalated platform governance`);
  }
  if (action === "escalate") {
    const governanceAction = actorRole === "platform-governance";
    const ownerAction = actorRole === item.assignedRole && (!item.claimedByDigest || item.claimedByDigest === digest(actorId));
    if (!governanceAction && !ownerAction) throw new Error("escalate requires platform governance or the current owner");
  }

  if (action === "dispatch") {
    const targetRole = String(command.targetRole || "").trim();
    if (!program.workItems.activeRoles.includes(targetRole)) throw new TypeError("targetRole is not allowlisted");
    item.assignedRole = targetRole;
    item.claimedByDigest = "";
  }
  if (action === "claim") {
    item.claimedByDigest = digest(actorId);
  }
  if (["block", "resolve", "reopen", "escalate"].includes(action)) {
    const note = String(command.note || "").trim();
    if (note.length < 8 || note.length > 500) throw new TypeError("note must contain 8 to 500 characters");
    item.latestNoteDigest = digest(note);
  }
  if (["block", "resolve"].includes(action)) {
    item.latestEvidenceDigest = digest(assertOpaque("evidenceRef", command.evidenceRef, 8, 160));
  }
  if (action === "reopen") {
    if (item.reopenCount >= program.workItems.maximumReopens) throw new Error("work item reopen limit reached");
    item.reopenCount += 1;
    item.claimedByDigest = "";
  }
  if (action === "escalate") {
    if (item.escalationCount >= program.workItems.maximumEscalations) throw new Error("work item escalation limit reached");
    item.escalationCount += 1;
    item.assignedRole = "platform-governance";
    item.claimedByDigest = "";
  }
  if (action === "message") {
    if (item.messages.length >= program.workItems.maximumMessagesPerItem) throw new Error("work item message limit reached");
    const content = String(command.content || "").trim();
    if (content.length < 2 || content.length > 1000) throw new TypeError("message content must contain 2 to 1000 characters");
    if (!MESSAGE_KINDS.includes(command.kind)) throw new TypeError("message kind is not allowlisted");
    const messageId = `msg-${digest(commandId).slice(7, 23)}`;
    item.messages.push({ id: messageId, kind: command.kind, contentDigest: digest(content), authorRole: actorRole, authorDigest: digest(actorId), createdAt: now, readByDigests: [] });
    referenceId = messageId;
  }
  if (action === "read") {
    const messageId = assertOpaque("messageId", command.messageId, 8, 40);
    const message = item.messages.find((candidate) => candidate.id === messageId);
    if (!message) throw new Error("work item message was not found");
    const readerDigest = digest(actorId);
    if (!message.readByDigests.includes(readerDigest)) message.readByDigests.push(readerDigest);
    referenceId = messageId;
  }

  item.status = targetStatus;
  item.version += 1;
  item.updatedAt = now;
  item.timeline.push(timelineEvent(item, action, actorRole, now, referenceId));
  next.platformWorkItemV2Commands.push({ commandId, requestDigest, itemId, resultingVersion: item.version, recordedAt: now });
  return Object.freeze({ data: next, result: publicItem(item, { ...options, program, now }), replayed: false });
}

function buildPlatformWorkItemCenterV2(data, options = {}) {
  const program = options.program || defaultProgram;
  const now = validTimestamp(options.now) || new Date().toISOString();
  const seeded = seedWorkItemsV2(data, { ...options, program, now });
  const items = seeded.platformWorkItemsV2.slice(0, program.workItems.maximumWorkItems).map((item) => publicItem(item, { ...options, program, now }));
  return Object.freeze({
    schemaVersion: "platform-work-item-center-v2",
    generatedAt: now,
    ok: true,
    productionReady: false,
    containsBusinessPayload: false,
    summary: Object.freeze({
      total: items.length,
      open: items.filter((item) => !["resolved", "observed"].includes(item.status)).length,
      claimed: items.filter((item) => item.claimed).length,
      breached: items.filter((item) => item.slaState === "breached").length,
      dueSoon: items.filter((item) => item.slaState === "due-soon").length,
      escalated: items.filter((item) => item.status === "escalated").length,
      unreadMessages: items.reduce((total, item) => total + item.unreadMessages, 0),
      domains: new Set(items.map((item) => item.domain)).size
    }),
    capabilities: Object.freeze(["source-normalization", "priority-normalization", "sla-evaluation", "role-dispatch", "actor-claim", "digest-only-message", "read-receipt", "reopen", "escalation", "redacted-timeline", "optimistic-version", "idempotent-command"]),
    items: Object.freeze(items),
    boundary: "统一事项中心只管理脱敏协作元数据，不修改来源业务聚合，也不授予生产权限。"
  });
}

module.exports = {
  ACTIONS,
  MESSAGE_KINDS,
  STATUS_TRANSITIONS,
  applyWorkItemCommandV2,
  buildPlatformWorkItemCenterV2,
  normalizePriority,
  seedWorkItemsV2,
  sourceRows,
  validateProgram
};
