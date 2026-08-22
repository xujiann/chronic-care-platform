"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { buildMatrix, validateMatrix } = require("../scripts/api-authorization-matrix");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test("modular API authorization matrix covers owners roles scopes purposes and high-risk routes", () => {
  const matrix = buildMatrix();
  assert.deepEqual(validateMatrix(matrix), []);
  assert.equal(matrix.generatedFrom, "src/http/routes/**/*.js");
  assert.equal(matrix.summary.protected >= 550, true);
  assert.equal(matrix.summary.highRisk, 9);
  assert.equal(matrix.summary.residentScoped > 0, true);
  assert.equal(matrix.summary.institutionScoped > 0, true);
  assert.equal(matrix.routes.every((route) => route.owner && route.identity && route.dataScope && route.purpose), true);
  const callback = matrix.routes.find((route) => route.key === "POST /api/auth/sms-delivery-callback");
  assert.equal(callback.identity.mechanism, "hmac-sha256-signed-external-callback");
  assert.equal(callback.identity.principalType, "sms-provider");
  assert.equal(callback.authorizationModel, "verified-external-provider-message-scope");
  assert.deepEqual(callback.roles, []);
});

test("custom external authentication remains fail closed when its model or principal drifts", () => {
  const missingModel = clone(buildMatrix());
  const callbackWithoutModel = missingModel.routes.find((route) => route.key === "POST /api/auth/sms-delivery-callback");
  delete callbackWithoutModel.authorizationModel;
  assert.match(validateMatrix(missingModel).join("\n"), /no roles or custom authorization model/);

  const missingPrincipal = clone(buildMatrix());
  const callbackWithoutPrincipal = missingPrincipal.routes.find((route) => route.key === "POST /api/auth/sms-delivery-callback");
  delete callbackWithoutPrincipal.identity.principalType;
  assert.match(validateMatrix(missingPrincipal).join("\n"), /custom authorization model lacks an external principal/);
});
