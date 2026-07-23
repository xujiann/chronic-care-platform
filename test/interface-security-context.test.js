const assert = require("node:assert/strict");
const test = require("node:test");

const {
  isIssuedCrossInstitutionAuthorization,
  issueCrossInstitutionAuthorization
} = require("../interface-security-context");

test("cross-institution authorization is process-issued, accountable and not JSON-forgeable", () => {
  assert.throws(
    () => issueCrossInstitutionAuthorization(""),
    (error) => error.code === "CROSS_INSTITUTION_AUTHORIZATION_ACTOR_REQUIRED"
  );
  const authorization = issueCrossInstitutionAuthorization("commission-router", {
    reason: "approved pilot relay",
    issuedAt: "2026-07-22T01:59:00.000Z"
  });
  assert.equal(isIssuedCrossInstitutionAuthorization(authorization), true);
  assert.equal(Object.isFrozen(authorization), true);
  assert.equal(authorization.authorizedBy, "commission-router");
  const forged = JSON.parse(JSON.stringify(authorization));
  assert.equal(isIssuedCrossInstitutionAuthorization(forged), false);
  assert.equal(isIssuedCrossInstitutionAuthorization({
    type: "cross-institution-interface",
    authorizedBy: "commission-router"
  }), false);
});
