"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  applyPlatformWorkItemAction,
  buildPlatformWorkItemCenter,
  seedPlatformWorkItems
} = require("../src/platform/productization/work-item-center");

function fixture() {
  return {
    publicHealthCommandTasks: [{ id: "task-1", status: "pending", priority: "high", dueAt: "2026-08-18", residentId: "must-not-project" }],
    taskMessages: [{ id: "message-1", status: "delivered", title: "must-not-project" }]
  };
}

test("work item center projects source tasks without business payloads", () => {
  const report = buildPlatformWorkItemCenter(fixture(), { now: "2026-08-17T02:00:00.000Z" });
  assert.equal(report.summary.total, 2);
  assert.equal(report.summary.open, 1);
  assert.equal(report.summary.observed, 1);
  assert.equal(report.productionReady, false);
  assert.doesNotMatch(JSON.stringify(report), /must-not-project|residentId/);
});

test("work item commands enforce versions transitions evidence and exact replay", () => {
  let data = seedPlatformWorkItems(fixture(), { now: "2026-08-17T02:00:00.000Z" });
  const item = data.platformWorkItems.find((candidate) => candidate.status === "queued");
  let result = applyPlatformWorkItemAction(data, { itemId: item.id, action: "assign", assigneeRole: "public-health", expectedVersion: 0, commandId: "command-assign-001" }, { now: "2026-08-17T02:01:00.000Z" });
  data = result.data;
  assert.equal(result.result.status, "assigned");
  result = applyPlatformWorkItemAction(data, { itemId: item.id, action: "start", expectedVersion: 1, commandId: "command-start-001" }, { now: "2026-08-17T02:02:00.000Z" });
  data = result.data;
  result = applyPlatformWorkItemAction(data, { itemId: item.id, action: "resolve", expectedVersion: 2, commandId: "command-resolve-001", evidenceRef: "evidence:synthetic-001", note: "Synthetic closure reviewed." }, { now: "2026-08-17T02:03:00.000Z" });
  assert.equal(result.result.status, "resolved");
  assert.doesNotMatch(JSON.stringify(result.data), /Synthetic closure reviewed/);
  const replay = applyPlatformWorkItemAction(result.data, { itemId: item.id, action: "resolve", expectedVersion: 2, commandId: "command-resolve-001", evidenceRef: "evidence:synthetic-001", note: "Synthetic closure reviewed." });
  assert.equal(replay.replayed, true);
  assert.throws(() => applyPlatformWorkItemAction(result.data, { itemId: item.id, action: "resolve", expectedVersion: 2, commandId: "command-resolve-001", evidenceRef: "evidence:changed-001", note: "Synthetic closure reviewed." }), /different intent/);
});
