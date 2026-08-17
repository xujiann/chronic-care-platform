"use strict";

const crypto = require("node:crypto");
const sourceCatalog = require("../../../config/platform-work-item-sources.json");

const ACTIVE_ROLES = Object.freeze(["platform-governance", "public-health", "care-coordination", "clinical-specialties", "integration", "identity-security"]);
const TERMINAL_SOURCE_STATUS = /^(?:complete|completed|closed|resolved|accepted|ready|sent|delivered|feedback_submitted|演示契约就绪)$/i;
const TRANSITIONS = Object.freeze({
  queued: Object.freeze({ assign: "assigned" }),
  assigned: Object.freeze({ start: "in-progress" }),
  "in-progress": Object.freeze({ block: "blocked", resolve: "resolved" }),
  blocked: Object.freeze({ start: "in-progress", resolve: "resolved" }),
  observed: Object.freeze({}),
  resolved: Object.freeze({})
});

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(String(value)).digest("hex")}`;
}

function assertOpaque(label, value, minimum = 8, maximum = 96) {
  const text = String(value || "").trim();
  if (text.length < minimum || text.length > maximum || !/^[A-Za-z0-9._:/-]+$/.test(text)) {
    throw new TypeError(`${label} must be a bounded opaque identifier`);
  }
  return text;
}

function sourceRows(data, catalog = sourceCatalog) {
  if (catalog?.schemaVersion !== "platform-work-item-sources-v1") throw new TypeError("work item source catalog is invalid");
  return catalog.sources.flatMap((source) => (Array.isArray(data[source.collection]) ? data[source.collection] : [])
    .filter((row) => row && typeof row === "object" && row.id)
    .map((row) => {
      const rawStatus = String(row[source.statusField] || "unknown").trim();
      const sourceIdentity = `${source.collection}:${row.id}`;
      return Object.freeze({
        id: `wi-${digest(sourceIdentity).slice(7, 23)}`,
        sourceCollection: source.collection,
        sourceRefDigest: digest(sourceIdentity),
        domain: source.domain,
        label: source.label,
        sourceStatus: rawStatus.slice(0, 64),
        sourceState: TERMINAL_SOURCE_STATUS.test(rawStatus) ? "terminal" : "open",
        priority: String(row[source.priorityField] || "normal").slice(0, 24),
        dueAt: String(row[source.dueField] || "").slice(0, 40)
      });
    }));
}

function seedPlatformWorkItems(data, options = {}) {
  const next = structuredClone(data || {});
  const existing = Array.isArray(next.platformWorkItems) ? next.platformWorkItems : [];
  const known = new Set(existing.map((item) => item.sourceRefDigest));
  const now = options.now || new Date().toISOString();
  for (const source of sourceRows(next, options.catalog || sourceCatalog)) {
    if (known.has(source.sourceRefDigest)) continue;
    existing.push({
      ...source,
      status: source.sourceState === "terminal" ? "observed" : "queued",
      assigneeRole: "",
      version: 0,
      latestEvidenceRef: "",
      latestNoteDigest: "",
      createdAt: now,
      updatedAt: now
    });
    known.add(source.sourceRefDigest);
  }
  next.platformWorkItems = existing;
  next.platformWorkItemCommands = Array.isArray(next.platformWorkItemCommands) ? next.platformWorkItemCommands : [];
  return next;
}

function publicWorkItem(item) {
  return Object.freeze({
    id: item.id,
    sourceCollection: item.sourceCollection,
    domain: item.domain,
    label: item.label,
    sourceStatus: item.sourceStatus,
    sourceState: item.sourceState,
    priority: item.priority,
    dueAt: item.dueAt,
    status: item.status,
    assigneeRole: item.assigneeRole,
    version: item.version,
    latestEvidenceRef: item.latestEvidenceRef,
    updatedAt: item.updatedAt
  });
}

function buildPlatformWorkItemCenter(data, options = {}) {
  const seeded = seedPlatformWorkItems(data, options);
  const items = seeded.platformWorkItems.map(publicWorkItem);
  return Object.freeze({
    schemaVersion: "platform-work-item-center-v1",
    generatedAt: options.now || new Date().toISOString(),
    ok: true,
    productionReady: false,
    summary: Object.freeze({
      total: items.length,
      open: items.filter((item) => !["resolved", "observed"].includes(item.status)).length,
      blocked: items.filter((item) => item.status === "blocked").length,
      resolved: items.filter((item) => item.status === "resolved").length,
      observed: items.filter((item) => item.status === "observed").length,
      domains: new Set(items.map((item) => item.domain)).size
    }),
    items: Object.freeze(items),
    boundary: "Operational work-item state never mutates or closes the source business aggregate."
  });
}

function applyPlatformWorkItemAction(data, command, options = {}) {
  const next = seedPlatformWorkItems(data, options);
  const commandId = assertOpaque("commandId", command.commandId);
  const itemId = assertOpaque("work item id", command.itemId, 10, 40);
  const action = String(command.action || "").trim();
  const expectedVersion = Number(command.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) throw new TypeError("expectedVersion must be a non-negative integer");
  const requestDigest = digest(JSON.stringify({ itemId, action, expectedVersion, assigneeRole: command.assigneeRole || "", evidenceRef: command.evidenceRef || "", note: command.note || "" }));
  const previous = next.platformWorkItemCommands.find((item) => item.commandId === commandId);
  if (previous) {
    if (previous.requestDigest !== requestDigest) {
      const error = new Error("command id was reused with different intent");
      error.code = "PLATFORM_WORK_ITEM_COMMAND_CONFLICT";
      throw error;
    }
    return Object.freeze({ data: next, result: publicWorkItem(next.platformWorkItems.find((item) => item.id === previous.itemId)), replayed: true });
  }
  const item = next.platformWorkItems.find((candidate) => candidate.id === itemId);
  if (!item) throw new Error("platform work item was not found");
  if (item.version !== expectedVersion) {
    const error = new Error("platform work item version conflict");
    error.code = "PLATFORM_WORK_ITEM_VERSION_CONFLICT";
    throw error;
  }
  const target = TRANSITIONS[item.status]?.[action];
  if (!target) throw new Error(`action ${action} is not allowed from ${item.status}`);
  if (action === "assign") {
    if (!ACTIVE_ROLES.includes(command.assigneeRole)) throw new TypeError("assigneeRole is not allowlisted");
    item.assigneeRole = command.assigneeRole;
  }
  if (action === "resolve" || action === "block") {
    item.latestEvidenceRef = assertOpaque("evidenceRef", command.evidenceRef, 8, 160);
    const note = String(command.note || "").trim();
    if (note.length < 8 || note.length > 500) throw new TypeError("note must contain 8 to 500 characters");
    item.latestNoteDigest = digest(note);
  }
  item.status = target;
  item.version += 1;
  item.updatedAt = options.now || new Date().toISOString();
  next.platformWorkItemCommands.push({ commandId, requestDigest, itemId, resultingVersion: item.version, recordedAt: item.updatedAt });
  return Object.freeze({ data: next, result: publicWorkItem(item), replayed: false });
}

module.exports = {
  ACTIVE_ROLES,
  TRANSITIONS,
  applyPlatformWorkItemAction,
  buildPlatformWorkItemCenter,
  seedPlatformWorkItems,
  sourceRows
};
