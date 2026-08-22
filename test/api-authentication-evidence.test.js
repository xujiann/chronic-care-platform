"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  AUTHENTICATION_REGISTRY,
  authenticationEvidenceContracts,
  validateAuthenticationEvidence
} = require("../scripts/api-authentication-evidence");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test("custom authentication evidence binds control flow negative tests and fail-closed production state", () => {
  const contracts = authenticationEvidenceContracts();
  assert.deepEqual(validateAuthenticationEvidence(), []);
  assert.equal(contracts.length, 13);
  assert.equal(contracts.filter((contract) => contract.authentication.mode === "required").length, 10);
  assert.equal(contracts.filter((contract) => contract.authentication.mode === "optional").length, 1);
  assert.equal(contracts.filter((contract) => contract.authentication.mode === "none").length, 2);
  assert.equal(contracts.every((contract) => contract.repositoryStatus === "control-flow-and-negative-test-verified"), true);
  assert.equal(contracts.every((contract) => contract.productionReady === false && contract.externalEvidenceRequired === true), true);
  assert.equal(contracts.every((contract) => contract.authentication.credentialSource.length > 0 && contract.replayCsrf.replayProtection && contract.replayCsrf.csrf), true);
  assert.equal(contracts.some((contract) => contract.key === "POST /api/auth/sms-delivery-callback" && contract.governanceSource.startsWith("config/api-idempotency-evidence.json#")), true);
  assert.equal(contracts.some((contract) => contract.key === "GET /api/t10-specialty/cutover-pack" && contract.authorization.roles.includes("commission")), true);
});

test("authentication evidence rejects marker promotion ownership drift missing test proof and production promotion", () => {
  const markerPromotion = clone(AUTHENTICATION_REGISTRY);
  markerPromotion.policy.sourceMarkersAreAuthenticationProof = true;
  assert.match(validateAuthenticationEvidence(markerPromotion).join("\n"), /source markers must not be authentication proof/);

  const ownerDrift = clone(AUTHENTICATION_REGISTRY);
  ownerDrift.contracts[0].owner = "unknown";
  assert.match(validateAuthenticationEvidence(ownerDrift).join("\n"), /incomplete authentication evidence ownership/);

  const missingCredential = clone(AUTHENTICATION_REGISTRY);
  missingCredential.contracts[0].authentication.credentialSource = [];
  assert.match(validateAuthenticationEvidence(missingCredential).join("\n"), /credential source/);

  const missingNegativeTest = clone(AUTHENTICATION_REGISTRY);
  missingNegativeTest.contracts[0].negativeTestEvidence = [];
  assert.match(validateAuthenticationEvidence(missingNegativeTest).join("\n"), /implementation and negative test evidence required/);

  const promoted = clone(AUTHENTICATION_REGISTRY);
  promoted.contracts[0].productionReady = true;
  assert.match(validateAuthenticationEvidence(promoted).join("\n"), /production fail closed/);
});

test("authentication evidence rejects route replay-CSRF and executable anchor drift", () => {
  const routeDrift = clone(AUTHENTICATION_REGISTRY);
  routeDrift.contracts[0].path = "/api/auth/forged-context";
  routeDrift.contracts[0].key = "GET /api/auth/forged-context";
  assert.match(validateAuthenticationEvidence(routeDrift).join("\n"), /route source drift/);

  const replayDrift = clone(AUTHENTICATION_REGISTRY);
  delete replayDrift.contracts[0].replayCsrf.csrf;
  assert.match(validateAuthenticationEvidence(replayDrift).join("\n"), /replay and CSRF classification required/);

  const anchorDrift = clone(AUTHENTICATION_REGISTRY);
  anchorDrift.contracts[0].negativeTestEvidence[0].anchors[0] = "forged negative test marker";
  assert.match(validateAuthenticationEvidence(anchorDrift).join("\n"), /missing negative test evidence anchor/);

  const missingEvidenceFile = clone(AUTHENTICATION_REGISTRY);
  missingEvidenceFile.contracts[0].negativeTestEvidence[0].file = "test/missing-authentication-evidence.test.js";
  assert.match(validateAuthenticationEvidence(missingEvidenceFile).join("\n"), /missing negative test evidence file/);

  const missingAnchors = clone(AUTHENTICATION_REGISTRY);
  missingAnchors.contracts[0].negativeTestEvidence[0].anchors = [];
  assert.match(validateAuthenticationEvidence(missingAnchors).join("\n"), /negative test evidence anchors required/);

  const conflictingMode = clone(AUTHENTICATION_REGISTRY);
  conflictingMode.contracts[0].authentication.mode = "none";
  assert.match(validateAuthenticationEvidence(conflictingMode).join("\n"), /mode and required flag conflict/);

  const missingScope = clone(AUTHENTICATION_REGISTRY);
  delete missingScope.contracts[0].authorization.dataScope;
  assert.match(validateAuthenticationEvidence(missingScope).join("\n"), /incomplete authentication authorization scope/);
});

test("authentication evidence fails closed for malformed registry and contract structure", () => {
  assert.deepEqual(authenticationEvidenceContracts({ contracts: null }, { contracts: null }), []);

  const invalidPolicy = clone(AUTHENTICATION_REGISTRY);
  invalidPolicy.schemaVersion = "unknown";
  invalidPolicy.policy.unregisteredCustomAuthenticationStatus = "catalogued";
  invalidPolicy.policy.productionPromotionAllowed = true;
  const policyErrors = validateAuthenticationEvidence(invalidPolicy).join("\n");
  assert.match(policyErrors, /unsupported authentication evidence schema/);
  assert.match(policyErrors, /unregistered custom authentication must remain review-required/);
  assert.match(policyErrors, /must not allow production promotion/);

  const invalidIdentity = clone(AUTHENTICATION_REGISTRY);
  invalidIdentity.contracts[0].contractId = "";
  invalidIdentity.contracts[0].key = "";
  invalidIdentity.contracts[0].domain = "";
  invalidIdentity.contracts[0].purpose = "";
  invalidIdentity.contracts[0].authentication = {};
  invalidIdentity.contracts[0].authorization = {};
  invalidIdentity.contracts[0].repositoryStatus = "marker-observed";
  invalidIdentity.contracts[0].externalEvidenceRequired = false;
  invalidIdentity.contracts[0].implementationEvidence = [];
  invalidIdentity.contracts[0].negativeTestEvidence = [];
  const identityErrors = validateAuthenticationEvidence(invalidIdentity).join("\n");
  assert.match(identityErrors, /duplicate or missing authentication contract id/);
  assert.match(identityErrors, /duplicate or invalid authentication evidence key/);
  assert.match(identityErrors, /incomplete authentication evidence ownership/);
  assert.match(identityErrors, /incomplete authentication requirement/);
  assert.match(identityErrors, /incomplete authentication mechanism or credential source/);
  assert.match(identityErrors, /authentication evidence must be behavior verified/);
  assert.match(identityErrors, /authentication evidence must remain production fail closed/);
  assert.match(identityErrors, /bind exactly one route source/);

  const unsafeEvidence = clone(AUTHENTICATION_REGISTRY);
  unsafeEvidence.contracts[0].negativeTestEvidence[0].file = "../outside.test.js";
  unsafeEvidence.contracts[0].negativeTestEvidence[0].anchors = [""];
  const unsafeErrors = validateAuthenticationEvidence(unsafeEvidence).join("\n");
  assert.match(unsafeErrors, /negative evidence must reference an executable test/);
  assert.match(unsafeErrors, /missing negative test evidence file/);

  const emptyAnchor = clone(AUTHENTICATION_REGISTRY);
  emptyAnchor.contracts[0].negativeTestEvidence[0].anchors[0] = "";
  assert.match(validateAuthenticationEvidence(emptyAnchor).join("\n"), /missing negative test evidence anchor/);
});
