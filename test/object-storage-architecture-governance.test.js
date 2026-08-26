"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const governance = require("../scripts/object-storage-architecture-governance");

function cloneRepositoryState() {
  const state = governance.readRepositoryState();
  return { ...state, register: structuredClone(state.register), ownership: structuredClone(state.ownership) };
}

function failed(report, id) {
  return report.checks.find((item) => item.id === id)?.passed === false;
}

test("Accepted object storage decision authorizes repository implementation but not production", () => {
  const report = governance.verifyRepository();
  assert.equal(report.ok, true);
  assert.equal(report.status, "accepted-not-production-ready");
  assert.equal(report.implementationAuthorized, true);
  assert.equal(report.productionReady, false);
  assert.equal(report.summary.sqliteHead, 17);
  assert.equal(report.summary.reservedSqliteMigrationVersion, 17);
  assert.equal(report.summary.actions, governance.REQUIRED_ACTION_IDS.length);
  assert.equal(report.summary.unresolvedHumanDecisions, 0);
});

test("Accepted ADR requires all repository implementation authorizations", () => {
  for (const flag of ["v17MigrationAuthorized", "runtimeImplementationAuthorized", "apiImplementationAuthorized"]) {
    const state = cloneRepositoryState();
    state.register.decision.authorization[flag] = false;
    const report = governance.buildGovernanceReport(state);
    assert.equal(report.ok, false, flag);
    assert.equal(failed(report, "objectStorageDecision:acceptedAuthorization"), true, flag);
    assert.equal(report.productionReady, false, flag);
  }
});

test("external evidence actions cannot be silently marked complete", () => {
  const state = cloneRepositoryState();
  state.register.actions.find((item) => item.id === "persistent-provider-reconciliation").status = "completed";
  const report = governance.buildGovernanceReport(state);
  assert.equal(report.ok, false);
  assert.equal(failed(report, "objectStorageDecision:acceptedActions"), true);
});

test("readiness cannot claim production without external evidence", () => {
  const state = cloneRepositoryState();
  state.readinessSource = state.readinessSource.replace(
    /(status:\s*"durable-v2-repository-ready-external-evidence-pending",\s*\r?\n\s*productionReady:\s*)false/,
    "$1true"
  );
  const report = governance.buildGovernanceReport(state);
  assert.equal(report.ok, false);
  assert.equal(failed(report, "objectStorageDecision:readinessNoGo"), true);
  assert.equal(report.productionReady, false);
});

test("confirmed data ownership cannot drift", () => {
  const state = cloneRepositoryState();
  state.ownership.collections.secureAttachments.owner = "platform-governance";
  const report = governance.buildGovernanceReport(state);
  assert.equal(report.ok, false);
  assert.equal(failed(report, "objectStorageDecision:confirmedDataOwnership"), true);
});

test("ADR status and required sections cannot drift", () => {
  const statusDrift = cloneRepositoryState();
  statusDrift.adrSource = statusDrift.adrSource.replace("- 状态：Accepted", "- 状态：Proposed");
  let report = governance.buildGovernanceReport(statusDrift);
  assert.equal(report.ok, false);
  assert.equal(failed(report, "objectStorageDecision:adrStatus"), true);

  const missingRisk = cloneRepositoryState();
  missingRisk.adrSource = missingRisk.adrSource.replace("## Risk", "## Risks");
  report = governance.buildGovernanceReport(missingRisk);
  assert.equal(report.ok, false);
  assert.equal(failed(report, "objectStorageDecision:adrSections"), true);
});

test("v17 application and action coverage are governed", () => {
  const headDrift = cloneRepositoryState();
  headDrift.sqliteHead = 16;
  let report = governance.buildGovernanceReport(headDrift);
  assert.equal(report.ok, false);
  assert.equal(failed(report, "objectStorageDecision:v17Applied"), true);

  const incomplete = cloneRepositoryState();
  incomplete.register.actions.pop();
  report = governance.buildGovernanceReport(incomplete);
  assert.equal(report.ok, false);
  assert.equal(failed(report, "objectStorageDecision:actionCoverage"), true);
});

test("production promotion remains closed while external-evidence actions are blocked", () => {
  const state = cloneRepositoryState();
  state.register.decision.authorization.productionPromotionAllowed = true;
  const report = governance.buildGovernanceReport(state);
  assert.equal(report.ok, false);
  assert.equal(failed(report, "objectStorageDecision:acceptedAuthorization"), true);
  assert.equal(failed(report, "objectStorageDecision:promotionRequiresImplementation"), true);
  assert.equal(report.productionReady, false);
});
