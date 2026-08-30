"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  MODULE_IDS,
  applyInstitutionModuleAction,
  buildInstitutionModuleView
} = require("../t10-specialty-module-governance");

const INSTITUTION_ID = "MR1";
const AT = "2026-07-24T02:00:00.000Z";
const COMMISSION = { id: "commission-operator-1", role: "commission" };
const OPTIONS = {
  at: AT,
  idempotencyKey: "t10-module-command-001",
  institutionExists: (institutionId) => institutionId === INSTITUTION_ID
};

function action(overrides = {}) {
  return {
    action: "disable-module",
    moduleId: "physical-examination",
    expectedVersion: 0,
    evidenceRef: "urn:t10-module-change:MR1:20260724:001",
    ...overrides
  };
}

test("institution module view defaults to independent rehearsal-only modules and preserves site No-Go", () => {
  const view = buildInstitutionModuleView({}, INSTITUTION_ID, { at: AT });

  assert.deepEqual(view.enabledModuleIds, MODULE_IDS);
  assert.equal(view.modules.length, 4);
  assert.equal(view.modules.every((item) => item.independentlySelectable && item.requiredPeerModules.length === 0), true);
  const blood = view.modules.find((item) => item.id === "clinical-blood");
  assert.equal(blood.independentDeploymentAuthorized, false);
  assert.equal(blood.deploymentUnit, "shared-platform-node-runtime");
  assert.equal(view.modules.every((item) => item.controlState === "configured-for-controlled-rehearsal"), true);
  assert.equal(view.formalGoLiveState, "blocked-until-site-evidence-signed");
  assert.equal(view.siteNoGoEnforced, true);
  assert.equal(view.productionReady, false);
});

test("commission module change is versioned idempotent audited and cannot close the site gate", () => {
  const changed = applyInstitutionModuleAction({}, INSTITUTION_ID, action(), COMMISSION, OPTIONS);

  assert.equal(changed.replayed, false);
  assert.equal(changed.record.version, 1);
  assert.equal(changed.view.enabledModuleIds.includes("physical-examination"), false);
  assert.equal(changed.view.productionReady, false);
  assert.equal(changed.view.siteNoGoEnforced, true);
  assert.equal(changed.state.t10SpecialtyModuleAudit.length, 1);
  assert.equal(changed.state.t10SpecialtyModuleAudit[0].formalGoLiveState, "blocked-until-site-evidence-signed");

  const replayed = applyInstitutionModuleAction(changed.state, INSTITUTION_ID, action(), COMMISSION, OPTIONS);
  assert.equal(replayed.replayed, true);
  assert.equal(replayed.record.version, 1);
  assert.equal(replayed.state.t10SpecialtyModuleAudit.length, 1);
});

test("module governance rejects privilege boundary and idempotency bypasses", () => {
  assert.throws(
    () => applyInstitutionModuleAction({}, INSTITUTION_ID, action(), { id: "institution-1", role: "institution" }, OPTIONS),
    (error) => error.code === "T10_MODULE_ACTOR_FORBIDDEN" && error.statusCode === 403
  );
  assert.throws(
    () => applyInstitutionModuleAction({}, INSTITUTION_ID, action({ productionReady: true }), COMMISSION, OPTIONS),
    (error) => error.code === "T10_MODULE_BOUNDARY_OVERRIDE_FORBIDDEN"
  );
  assert.throws(
    () => applyInstitutionModuleAction({}, INSTITUTION_ID, action(), COMMISSION, { ...OPTIONS, idempotencyKey: "" }),
    (error) => error.code === "T10_MODULE_IDEMPOTENCY_KEY_REQUIRED"
  );
  assert.throws(
    () => applyInstitutionModuleAction({}, "UNKNOWN", action(), COMMISSION, OPTIONS),
    (error) => error.code === "T10_INSTITUTION_NOT_FOUND"
  );
});

test("module governance rejects stale versions conflicting retries and disabling the final module", () => {
  const changed = applyInstitutionModuleAction({}, INSTITUTION_ID, action(), COMMISSION, OPTIONS);
  assert.throws(
    () => applyInstitutionModuleAction(
      changed.state,
      INSTITUTION_ID,
      action({ moduleId: "regional-imaging-cloud", expectedVersion: 0 }),
      COMMISSION,
      { ...OPTIONS, idempotencyKey: "t10-module-command-002" }
    ),
    (error) => error.code === "T10_MODULE_VERSION_CONFLICT"
  );
  assert.throws(
    () => applyInstitutionModuleAction(
      changed.state,
      INSTITUTION_ID,
      action({ moduleId: "regional-imaging-cloud" }),
      COMMISSION,
      OPTIONS
    ),
    (error) => error.code === "T10_MODULE_IDEMPOTENCY_CONFLICT"
  );

  const oneModuleState = {
    t10SpecialtyModuleSelections: [{
      institutionId: INSTITUTION_ID,
      enabledModuleIds: ["clinical-blood"],
      version: 3,
      actionHistory: []
    }]
  };
  assert.throws(
    () => applyInstitutionModuleAction(
      oneModuleState,
      INSTITUTION_ID,
      action({ moduleId: "clinical-blood", expectedVersion: 3 }),
      COMMISSION,
      { ...OPTIONS, idempotencyKey: "t10-module-command-003" }
    ),
    (error) => error.code === "T10_MODULE_SELECTION_EMPTY"
  );
});
