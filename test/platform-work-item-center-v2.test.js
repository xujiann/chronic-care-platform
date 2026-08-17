"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const program = require("../config/product-regional-enhancement-program.json");
const {
  applyWorkItemCommandV2,
  buildPlatformWorkItemCenterV2,
  normalizePriority,
  seedWorkItemsV2,
  validateProgram
} = require("../src/platform/productization/work-item-center-v2");

const START = "2026-08-17T08:00:00.000Z";

function fixture() {
  return {
    publicHealthCommandTasks: [{ id: "task-v2-001", status: "pending", priority: "urgent", residentId: "must-not-project", patientName: "must-not-project" }],
    taskMessages: [{ id: "message-v2-001", status: "delivered", title: "must-not-project" }]
  };
}

function command(data, itemId, action, expectedVersion, additions = {}, minute = expectedVersion + 1) {
  return applyWorkItemCommandV2(data, {
    commandId: `command-${action}-${String(expectedVersion).padStart(3, "0")}`,
    itemId,
    action,
    expectedVersion,
    actorRole: additions.actorRole || "public-health",
    actorId: additions.actorId || "operator-001",
    ...additions
  }, { now: `2026-08-17T08:${String(minute).padStart(2, "0")}:00.000Z` });
}

test("work item center 2.0 normalizes sources priorities and SLA without business payloads", () => {
  const report = buildPlatformWorkItemCenterV2(fixture(), { now: START });
  assert.equal(validateProgram(program), true);
  assert.equal(normalizePriority("P0"), "critical");
  assert.equal(report.schemaVersion, "platform-work-item-center-v2");
  assert.equal(report.summary.total, 2);
  assert.equal(report.summary.open, 1);
  assert.equal(report.items.find((item) => item.status === "queued").priority, "critical");
  assert.equal(report.items.find((item) => item.status === "queued").slaHours, 2);
  assert.equal(report.productionReady, false);
  assert.equal(report.containsBusinessPayload, false);
  assert.doesNotMatch(JSON.stringify(report), /must-not-project|residentId|patientName/);
});

test("dispatch claim collaboration read reopen and escalation form a versioned metadata-only loop", () => {
  let data = seedWorkItemsV2(fixture(), { now: START });
  const itemId = data.platformWorkItemsV2.find((item) => item.status === "queued").id;
  let result = command(data, itemId, "dispatch", 0, { targetRole: "public-health", actorRole: "platform-governance" });
  data = result.data;
  assert.equal(result.result.status, "dispatched");
  result = command(data, itemId, "claim", 1);
  data = result.data;
  assert.equal(result.result.claimed, true);
  result = command(data, itemId, "message", 2, { kind: "handoff", content: "仅用于协作的说明正文，不得进入公开投影" });
  data = result.data;
  const messageId = result.result.messages[0].id;
  assert.equal(result.result.unreadMessages, 1);
  assert.doesNotMatch(JSON.stringify(data), /仅用于协作的说明正文/);
  result = command(data, itemId, "read", 3, { messageId, actorId: "reader-001" });
  data = result.data;
  assert.equal(result.result.messages[0].readCount, 1);
  assert.equal(result.result.unreadMessages, 0);
  result = command(data, itemId, "resolve", 4, { evidenceRef: "evidence:closure-001", note: "Closure evidence independently reviewed." });
  data = result.data;
  assert.equal(result.result.status, "resolved");
  result = command(data, itemId, "reopen", 5, { note: "New metadata-only exception requires review.", actorRole: "platform-governance" });
  data = result.data;
  assert.equal(result.result.status, "dispatched");
  assert.equal(result.result.reopenCount, 1);
  result = command(data, itemId, "claim", 6);
  data = result.data;
  result = command(data, itemId, "escalate", 7, { note: "SLA risk requires platform governance review." });
  assert.equal(result.result.status, "escalated");
  assert.equal(result.result.assignedRole, "platform-governance");
  assert.equal(result.result.escalationCount, 1);
  assert.deepEqual(result.result.timeline.map((event) => event.action), ["normalized", "dispatch", "claim", "message", "read", "resolve", "reopen", "claim", "escalate"]);
  assert.equal(result.result.productionReady, false);
});

test("commands are exact-replay idempotent and reject drift scope and sensitive keys", () => {
  const seeded = seedWorkItemsV2(fixture(), { now: START });
  const itemId = seeded.platformWorkItemsV2.find((item) => item.status === "queued").id;
  const intent = { targetRole: "public-health", actorRole: "platform-governance" };
  const first = command(seeded, itemId, "dispatch", 0, intent);
  const replay = command(first.data, itemId, "dispatch", 0, intent);
  assert.equal(replay.replayed, true);
  assert.throws(() => command(first.data, itemId, "dispatch", 0, { targetRole: "integration", actorRole: "platform-governance" }), /different intent/);
  assert.throws(() => applyWorkItemCommandV2(seeded, { commandId: "command-sensitive-001", itemId, action: "dispatch", expectedVersion: 0, actorRole: "public-health", actorId: "operator-001", targetRole: "public-health", residentId: "forbidden" }), /not allowed/);
  assert.throws(() => command(seeded, itemId, "claim", 0), /not allowed from queued/);
  assert.throws(() => command(seeded, itemId, "dispatch", 0, { targetRole: "unknown-role", actorRole: "platform-governance" }), /targetRole is not allowlisted/);
  assert.throws(() => command(seeded, itemId, "dispatch", 0, { targetRole: "public-health" }), /requires platform-governance/);
});

test("SLA states move from within threshold to due-soon and breached deterministically", () => {
  const initial = buildPlatformWorkItemCenterV2(fixture(), { now: START });
  const itemId = initial.items.find((item) => item.status === "queued").id;
  assert.equal(initial.items.find((item) => item.id === itemId).slaState, "within-sla");
  const dueSoon = buildPlatformWorkItemCenterV2(seedWorkItemsV2(fixture(), { now: START }), { now: "2026-08-17T09:45:00.000Z" });
  assert.equal(dueSoon.items.find((item) => item.id === itemId).slaState, "due-soon");
  const breached = buildPlatformWorkItemCenterV2(seedWorkItemsV2(fixture(), { now: START }), { now: "2026-08-17T10:01:00.000Z" });
  assert.equal(breached.items.find((item) => item.id === itemId).slaState, "breached");
});

test("public projection replaces persisted non-allowlisted metadata instead of reflecting it", () => {
  const data = seedWorkItemsV2(fixture(), { now: START });
  const item = data.platformWorkItemsV2.find((candidate) => candidate.status === "queued");
  Object.assign(item, {
    id: "患者姓名",
    sourceCollection: "patient-secret-collection",
    sourceRefDigest: "C:/secret",
    domain: "patient-name",
    category: "patient-name",
    priority: "patient-name",
    status: "patient-name",
    assignedRole: "patient-name",
    dueAt: "patient-name",
    updatedAt: "patient-name"
  });
  const report = buildPlatformWorkItemCenterV2(data, { now: START });
  const projected = report.items.find((candidate) => candidate.id === "redacted");
  assert.equal(projected.sourceCollection, "unregistered");
  assert.equal(projected.sourceRefDigest, "redacted");
  assert.equal(projected.domain, "platform-governance");
  assert.equal(projected.category, "平台运行事项");
  assert.equal(projected.priority, "normal");
  assert.equal(projected.status, "queued");
  assert.equal(projected.assignedRole, "");
  assert.doesNotMatch(JSON.stringify(projected), /patient-name|C:\/secret|患者姓名/);
});
