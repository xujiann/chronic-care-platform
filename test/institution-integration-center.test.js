"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildInstitutionIntegrationCenter,
  registerInstitutionIntegrationProfile,
  runInstitutionSyntheticJointTest
} = require("../src/platform/productization/institution-integration-center");

test("institution integration profile runs a credential-free synthetic joint test", () => {
  let result = registerInstitutionIntegrationProfile({}, {
    commandId: "profile-command-001",
    regionCode: "210200",
    institutionSlot: "pilot-general-hospital",
    adapters: ["government-oidc", "hospital-his", "hospital-emr", "resident-message"]
  }, { now: "2026-08-17T03:00:00.000Z" });
  assert.equal(result.result.status, "synthetic-pending");
  result = runInstitutionSyntheticJointTest(result.data, {
    commandId: "joint-test-command-001",
    profileId: result.result.profileId,
    expectedVersion: 0
  }, { now: "2026-08-17T03:01:00.000Z" });
  assert.equal(result.result.passed, true);
  assert.equal(result.result.scenarioCount, 8);
  assert.equal(result.profile.status, "synthetic-complete");
  const center = buildInstitutionIntegrationCenter(result.data);
  assert.equal(center.summary.syntheticComplete, 1);
  assert.equal(center.summary.siteReady, 0);
  assert.equal(center.productionReady, false);
});

test("institution integration profiles reject endpoints credentials and patient fields", () => {
  assert.throws(() => registerInstitutionIntegrationProfile({}, {
    commandId: "profile-command-002",
    regionCode: "210200",
    institutionSlot: "unsafe-hospital",
    adapters: ["hospital-his"],
    endpoint: "https://example.invalid"
  }), /cannot contain endpoint/);
});
