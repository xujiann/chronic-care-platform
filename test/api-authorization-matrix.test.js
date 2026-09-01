"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { buildMatrix, validateMatrix } = require("../scripts/api-authorization-matrix");
const { routeImplementationSourceRecords } = require("../src/http/runtime-source");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test("modular API authorization matrix covers owners roles scopes purposes and high-risk routes", () => {
  const matrix = buildMatrix();
  assert.deepEqual(validateMatrix(matrix), []);
  assert.equal(matrix.generatedFrom, routeImplementationSourceRecords().length
    ? "src/http/routes/**/*.js + config/clinical-subdomains.json#routeImplementationSources"
    : "src/http/routes/**/*.js");
  assert.equal(matrix.schemaVersion, "api-authorization-matrix-v3");
  assert.equal(matrix.summary.declarations, matrix.routes.length);
  assert.equal(matrix.summary.declarations, matrix.summary.protected + matrix.summary.public);
  assert.equal(matrix.summary.declarations >= 606, true);
  assert.equal(matrix.summary.customAuthenticationEvidence, 13);
  assert.equal(matrix.summary.protected >= 550, true);
  assert.equal(matrix.summary.highRisk, 15);
  assert.equal(matrix.summary.residentScoped > 0, true);
  assert.equal(matrix.summary.institutionScoped > 0, true);
  assert.equal(matrix.routes.every((route) => route.owner && route.identity && route.dataScope && route.purpose), true);
  const callback = matrix.routes.find((route) => route.key === "POST /api/auth/sms-delivery-callback");
  assert.equal(callback.identity.mechanism, "hmac-sha256-signed-external-callback");
  assert.equal(callback.identity.principalType, "sms-provider");
  assert.equal(callback.authorizationModel, "verified-external-provider-message-scope");
  assert.deepEqual(callback.roles, []);
  const logout = matrix.routes.find((route) => route.key === "POST /api/auth/logout");
  assert.equal(logout.identity.mode, "optional");
  assert.equal(logout.authenticationEvidenceContractId, "identity-security.logout-optional-session.v1");
  const regionalContext = matrix.routes.find((route) => route.key === "GET /api/regional/context");
  assert.equal(regionalContext.identity.mode, "none");
  assert.equal(regionalContext.owner, "T00");
  const t10CutoverPack = matrix.routes.find((route) => route.key === "GET /api/t10-specialty/cutover-pack");
  assert.deepEqual(t10CutoverPack.roles, ["commission"]);
  assert.equal(t10CutoverPack.authenticationEvidenceContractId, "shared.t10-specialty-cutover-pack-commission-session.v1");
  const regionalAccess = matrix.routes.find((route) => route.key === "POST /api/regional-data-sharing/access-reviews");
  assert.equal(regionalAccess.owner, "T02");
  assert.equal(regionalAccess.highRisk, true);
  assert.deepEqual(regionalAccess.roles, ["commission", "institution"]);
  const publicHealthHighlightRoutes = matrix.routes.filter((route) => route.key === "GET /api/public-health/highlights");
  assert.equal(publicHealthHighlightRoutes.length, 1);
  const [publicHealthHighlights] = publicHealthHighlightRoutes;
  assert.equal(publicHealthHighlights.owner, "T03");
  assert.equal(publicHealthHighlights.domain, "public-health");
  assert.equal(publicHealthHighlights.identity.required, true);
  assert.equal(publicHealthHighlights.identity.mode, "required");
  assert.equal(publicHealthHighlights.identity.mechanism, "bearer-or-cookie-session");
  assert.equal(publicHealthHighlights.highRisk, true);
  assert.deepEqual(publicHealthHighlights.roles, ["commission"]);
  assert.equal(
    publicHealthHighlights.dataScope,
    "city and health-admin platform; district own organization or explicit public-health hospital allowlist"
  );
  assert.equal(publicHealthHighlights.purpose, "read-public-health-command-overview");
});

test("custom external authentication remains fail closed when its model or principal drifts", () => {
  const missingModel = clone(buildMatrix());
  const callbackWithoutModel = missingModel.routes.find((route) => route.key === "POST /api/auth/sms-delivery-callback");
  delete callbackWithoutModel.authorizationModel;
  assert.match(validateMatrix(missingModel).join("\n"), /no roles or custom authorization model/);

  const missingPrincipal = clone(buildMatrix());
  const callbackWithoutPrincipal = missingPrincipal.routes.find((route) => route.key === "POST /api/auth/sms-delivery-callback");
  delete callbackWithoutPrincipal.identity.principalType;
  assert.match(validateMatrix(missingPrincipal).join("\n"), /custom authorization model lacks a governed principal/);

  const forgedEvidence = clone(buildMatrix());
  forgedEvidence.routes.find((route) => route.key === "GET /api/auth/context").authenticationEvidenceContractId = "forged.authentication.v1";
  assert.match(validateMatrix(forgedEvidence).join("\n"), /custom authentication lacks matching governed evidence/);
});
