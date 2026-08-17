"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  applyPlatformWorkItemV2GovernanceAction,
  buildPlatformEnhancementCockpit,
  dataGovernanceInput
} = require("../src/platform/productization/enhancement-runtime");

const NOW = "2026-08-17T08:00:00.000Z";

test("enhancement runtime aggregates three lines without authorizing production", () => {
  const report = buildPlatformEnhancementCockpit({}, { now: NOW });
  assert.equal(report.schemaVersion, "platform-enhancement-cockpit-v1");
  assert.equal(report.lines.data.productionReady, false);
  assert.equal(report.lines.care.productionReady, false);
  assert.equal(report.lines.product.productionReady, false);
  assert.equal(report.productionReady, false);
  assert.equal(report.decision, "NO-GO");
  assert.equal(report.containsBusinessPayload, false);
  assert.equal(report.cockpit.schemaVersion, "product-regional-operations-view-model-v1");
});

test("data governance runtime input uses only explicit metadata collections", () => {
  assert.deepEqual(dataGovernanceInput({ patientName: "not-projected" }), {
    migrationRuns: [],
    executionState: undefined,
    reconciliationExceptions: [],
    qualityFindings: [],
    changes: []
  });
});

test("work item v2 governance action ignores forged actor identity", () => {
  const data = { taskMessages: [{ id: "message-001", status: "open", priority: "high", dueAt: "2026-08-18T00:00:00.000Z" }] };
  const center = require("../src/platform/productization/work-item-center-v2").buildPlatformWorkItemCenterV2(data, { now: NOW });
  const item = center.items.find((candidate) => candidate.status === "queued");
  const result = applyPlatformWorkItemV2GovernanceAction(data, {
    commandId: "command-v2-governance-001",
    itemId: item.id,
    action: "escalate",
    expectedVersion: 0,
    actorRole: "integration",
    actorId: "forged-actor",
    note: "Escalate metadata control issue"
  }, { name: "commission-operator" }, { now: NOW });
  assert.equal(result.result.status, "escalated");
  assert.equal(result.result.assignedRole, "platform-governance");
  assert.equal(result.result.productionReady, false);
});
