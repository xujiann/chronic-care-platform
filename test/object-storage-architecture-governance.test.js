"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  REQUIRED_ACTION_IDS,
  verifyRepository
} = require("../scripts/object-storage-architecture-governance");

function cloneRepositoryState() {
  const state = require("../scripts/object-storage-architecture-governance").readRepositoryState();
  return {
    ...state,
    register: structuredClone(state.register),
    ownership: structuredClone(state.ownership)
  };
}

function failed(report, id) {
  return report.checks.find((item) => item.id === id)?.passed === false;
}

test("Proposed object storage decision is complete and fail-closed", () => {
  const report = verifyRepository();

  assert.equal(report.ok, true);
  assert.equal(report.status, "proposal-blocked-no-go");
  assert.equal(report.implementationAuthorized, false);
  assert.equal(report.productionReady, false);
  assert.equal(report.summary.sqliteHead, 16);
  assert.equal(report.summary.reservedSqliteMigrationVersion, 17);
  assert.equal(report.summary.actions, REQUIRED_ACTION_IDS.length);
  assert.equal(report.summary.blockedActions, REQUIRED_ACTION_IDS.length);
  assert.equal(report.summary.unresolvedHumanDecisions, 2);
});

test("Proposed ADR cannot enable v17, runtime, API or production promotion", () => {
  for (const flag of [
    "v17MigrationAuthorized",
    "runtimeImplementationAuthorized",
    "apiImplementationAuthorized",
    "productionPromotionAllowed"
  ]) {
    const state = cloneRepositoryState();
    state.register.decision.authorization[flag] = true;
    const report = require("../scripts/object-storage-architecture-governance").buildGovernanceReport(state);

    assert.equal(report.ok, false, flag);
    assert.equal(failed(report, "objectStorageDecision:proposalAuthorizationClosed"), true, flag);
    assert.equal(report.productionReady, false, flag);
  }

  const missingFlag = cloneRepositoryState();
  delete missingFlag.register.decision.authorization.v17MigrationAuthorized;
  const report = require("../scripts/object-storage-architecture-governance").buildGovernanceReport(missingFlag);
  assert.equal(report.ok, false);
  assert.equal(failed(report, "objectStorageDecision:authorizationShape"), true);
  assert.equal(failed(report, "objectStorageDecision:proposalAuthorizationClosed"), true);
});

test("implementation actions cannot start before the ADR is Accepted", () => {
  const state = cloneRepositoryState();
  state.register.actions.find((item) => item.id === "sqlite-v17-structured-storage").status = "in-progress";
  const report = require("../scripts/object-storage-architecture-governance").buildGovernanceReport(state);

  assert.equal(report.ok, false);
  assert.equal(failed(report, "objectStorageDecision:proposalActionsBlocked"), true);
});

test("existing object storage readiness cannot claim production while the ADR is Proposed", () => {
  const state = cloneRepositoryState();
  state.readinessSource = state.readinessSource.replace("productionReady: false", "productionReady: true");
  const report = require("../scripts/object-storage-architecture-governance").buildGovernanceReport(state);

  assert.equal(report.ok, false);
  assert.equal(failed(report, "objectStorageDecision:existingReadinessNoGo"), true);
  assert.equal(report.productionReady, false);
});

test("data owner is not inferred from T08 route ownership", () => {
  const state = cloneRepositoryState();
  state.ownership.collections.secureAttachments = {
    owner: "integration",
    classification: "restricted",
    readers: []
  };
  const report = require("../scripts/object-storage-architecture-governance").buildGovernanceReport(state);

  assert.equal(report.ok, false);
  assert.equal(failed(report, "objectStorageDecision:ownerNotInferred"), true);
});

test("ADR status and required decision sections cannot drift from the machine register", () => {
  const statusDrift = cloneRepositoryState();
  statusDrift.adrSource = statusDrift.adrSource.replace("- 状态：Proposed", "- 状态：Accepted");
  let report = require("../scripts/object-storage-architecture-governance").buildGovernanceReport(statusDrift);
  assert.equal(report.ok, false);
  assert.equal(failed(report, "objectStorageDecision:adrStatus"), true);

  const missingRisk = cloneRepositoryState();
  missingRisk.adrSource = missingRisk.adrSource.replace("## Risk", "## Risks");
  report = require("../scripts/object-storage-architecture-governance").buildGovernanceReport(missingRisk);
  assert.equal(report.ok, false);
  assert.equal(failed(report, "objectStorageDecision:adrSections"), true);
});

test("v17 reservation fails if schema head advances or the required action register is incomplete", () => {
  const headDrift = cloneRepositoryState();
  headDrift.sqliteHead = 17;
  let report = require("../scripts/object-storage-architecture-governance").buildGovernanceReport(headDrift);
  assert.equal(report.ok, false);
  assert.equal(failed(report, "objectStorageDecision:v17Reservation"), true);

  const incomplete = cloneRepositoryState();
  incomplete.register.actions.pop();
  report = require("../scripts/object-storage-architecture-governance").buildGovernanceReport(incomplete);
  assert.equal(report.ok, false);
  assert.equal(failed(report, "objectStorageDecision:actionCoverage"), true);
});

test("register cannot claim Accepted while human owner or compatibility decisions are unresolved", () => {
  const state = cloneRepositoryState();
  state.register.decision.status = "accepted";
  state.adrSource = state.adrSource.replace("- 状态：Proposed", "- 状态：Accepted");
  const report = require("../scripts/object-storage-architecture-governance").buildGovernanceReport(state);

  assert.equal(report.ok, false);
  assert.equal(failed(report, "objectStorageDecision:acceptanceRequiresHumans"), true);
  assert.equal(report.implementationAuthorized, false);
  assert.equal(report.productionReady, false);
});

test("production promotion requires all implementation authorizations after acceptance", () => {
  const state = cloneRepositoryState();
  state.register.decision.status = "accepted";
  state.adrSource = state.adrSource.replace("- 状态：Proposed", "- 状态：Accepted");
  state.register.decision.requiredHumanDecisions.forEach((item) => { item.status = "resolved"; });
  state.register.decision.authorization.productionPromotionAllowed = true;
  const report = require("../scripts/object-storage-architecture-governance").buildGovernanceReport(state);

  assert.equal(report.ok, false);
  assert.equal(failed(report, "objectStorageDecision:promotionRequiresImplementation"), true);
  assert.equal(report.productionReady, false);
});
