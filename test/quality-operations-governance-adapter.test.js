const assert = require("node:assert/strict");
const test = require("node:test");

const { executeGovernanceCommand } = require("../quality-operations-governance");
const {
  actorCanView,
  applyGovernanceResultToData,
  buildGovernanceCatalog,
  buildGovernanceRuntimeState,
  governanceAuditForRecord,
  listGovernanceRecords
} = require("../quality-operations-governance-adapter");

function state() {
  return {
    authOrganizations: [
      { orgCode: "HOSP-A", name: "Hospital A" },
      { orgCode: "HOSP-B", name: "Hospital B" }
    ],
    authUsers: [],
    qualitySafetyEvents: [{ id: "issue-1", institutionId: "HOSP-A", institutionName: "Hospital A" }],
    qualityRectificationOrders: [{
      id: "quality-1",
      issueId: "issue-1",
      institutionName: "Hospital A",
      requirement: "submit evidence",
      status: "dispatched",
      auditTrail: []
    }],
    resourceDispatchRequests: [{
      id: "dispatch-1",
      status: "assigned",
      sourceInstitutionId: "HOSP-A",
      targetInstitutionId: "HOSP-B",
      resourceType: "bed",
      auditTrail: []
    }],
    drugConsumableSupervisions: [{
      id: "drug-1",
      institution: "Hospital A",
      issue: "traceability evidence missing",
      status: "open",
      auditTrail: []
    }],
    qualityOperationsGovernanceAuditEvents: [],
    qualityOperationsGovernanceCommandReceipts: {},
    platformProcessAudit: [],
    securityEvents: []
  };
}

function command(overrides = {}) {
  return {
    idempotencyKey: "command-1",
    domain: "quality-rectification",
    recordId: "quality-1",
    action: "start",
    actor: { id: "hospital-a", role: "institution", institutionId: "HOSP-A" },
    expectedVersion: 0,
    occurredAt: "2026-07-23T06:00:00.000Z",
    payload: { note: "work started" },
    ...overrides
  };
}

test("three existing collections adapt to canonical records without resident identifiers", () => {
  const data = state();
  const runtime = buildGovernanceRuntimeState(data);
  assert.equal(Object.keys(runtime.state.records).length, 3);
  assert.equal(runtime.state.records["quality-1"].status, "assigned");
  assert.equal(runtime.state.records["dispatch-1"].institutionId, "HOSP-B");
  assert.equal(runtime.state.records["drug-1"].institutionId, "HOSP-A");
  assert.doesNotMatch(JSON.stringify(runtime.state.records), /personIndex|residentId/);
  assert.equal(buildGovernanceCatalog(data).summary.unmapped, 0);
});

test("allowed command persists source status version receipt and both audit projections", () => {
  const data = state();
  const { state: runtime } = buildGovernanceRuntimeState(data);
  const result = executeGovernanceCommand(runtime, command());
  assert.equal(result.ok, true);
  const persisted = applyGovernanceResultToData(data, result);
  assert.equal(persisted.isNewAudit, true);
  assert.equal(data.qualityRectificationOrders[0].status, "acknowledged");
  assert.equal(data.qualityRectificationOrders[0].governanceStatus, "in_progress");
  assert.equal(data.qualityRectificationOrders[0].governanceVersion, 1);
  assert.equal(data.qualityRectificationOrders[0].governanceLastCommandId, "command-1");
  assert.equal(Object.keys(data.qualityOperationsGovernanceCommandReceipts).length, 1);
  assert.equal(data.qualityOperationsGovernanceAuditEvents.length, 1);
  assert.equal(data.platformProcessAudit[0].status, "allowed");
  assert.equal(data.securityEvents[0].result, "allowed");
});

test("denied cross-institution command is audited without advancing the source version", () => {
  const data = state();
  const { state: runtime } = buildGovernanceRuntimeState(data);
  const denied = executeGovernanceCommand(runtime, command({
    actor: { id: "hospital-b", role: "institution", institutionId: "HOSP-B" }
  }));
  assert.equal(denied.ok, false);
  applyGovernanceResultToData(data, denied);
  assert.equal(data.qualityRectificationOrders[0].governanceVersion, undefined);
  assert.equal(data.qualityOperationsGovernanceAuditEvents[0].outcome, "denied");
  assert.equal(data.platformProcessAudit[0].status, "denied");
  assert.equal(data.securityEvents[0].result, "denied");
});

test("idempotent replay does not duplicate source or audit projections", () => {
  const data = state();
  let runtime = buildGovernanceRuntimeState(data).state;
  const first = executeGovernanceCommand(runtime, command());
  applyGovernanceResultToData(data, first);
  runtime = buildGovernanceRuntimeState(data).state;
  const replay = executeGovernanceCommand(runtime, command());
  assert.equal(replay.replayed, true);
  const persisted = applyGovernanceResultToData(data, replay);
  assert.equal(persisted.isNewAudit, false);
  assert.equal(data.qualityOperationsGovernanceAuditEvents.length, 1);
  assert.equal(data.platformProcessAudit.length, 1);
  assert.equal(data.securityEvents.length, 1);
});

test("read models enforce commission institution and insurance visibility", () => {
  const data = state();
  const all = listGovernanceRecords(data, { role: "commission" });
  const hospitalA = listGovernanceRecords(data, { role: "institution", orgCode: "HOSP-A" });
  const hospitalB = listGovernanceRecords(data, { role: "institution", orgCode: "HOSP-B" });
  const insurance = listGovernanceRecords(data, { role: "insurance" });
  assert.equal(all.total, 3);
  assert.deepEqual(hospitalA.records.map((item) => item.id).sort(), ["dispatch-1", "drug-1", "quality-1"]);
  assert.deepEqual(hospitalB.records.map((item) => item.id), ["dispatch-1"]);
  assert.deepEqual(insurance.records.map((item) => item.id), ["drug-1"]);
  assert.equal(actorCanView(buildGovernanceRuntimeState(data).state.records["quality-1"], { role: "institution" }), false);
  assert.equal(governanceAuditForRecord(data, "quality-1", { role: "institution", orgCode: "HOSP-B" }).allowed, false);
});

test("unmapped source statuses stay visible as blockers and never enter command state", () => {
  const data = state();
  data.qualityRectificationOrders[0].status = "vendor-new-status";
  const runtime = buildGovernanceRuntimeState(data);
  assert.equal(runtime.state.records["quality-1"], undefined);
  assert.equal(runtime.unmapped[0].sourceStatus, "vendor-new-status");
  assert.equal(buildGovernanceCatalog(data).summary.unmapped, 1);
});
