"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");
const { buildMatrix } = require("../scripts/api-authorization-matrix");
const { buildLiteralRouteInventory, buildProductionApiCatalog, validateProductionApiCatalog } = require("../scripts/production-api-catalog");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test("literal route inventory never pairs method and path across adjacent handlers", () => {
  const inventory = buildLiteralRouteInventory([{
    file: path.resolve(__dirname, "../src/http/routes/public-health/parser-regression.js"),
    source: `
      if (req.method === "GET" && url.pathname === "/api/public-health/domain-events/health") {
        return health();
      }
      if (req.method === "POST" && url.pathname === "/api/public-health/domain-events/dispatch") {
        return dispatch();
      }
    `
  }]);
  assert.deepEqual(inventory.map((entry) => entry.key), [
    "GET /api/public-health/domain-events/health",
    "POST /api/public-health/domain-events/dispatch"
  ]);
  assert.equal(inventory.some((entry) => entry.key === "POST /api/public-health/domain-events/health"), false);
});

test("inventory-only routes stay review-required without inferred authentication", () => {
  const sourceFiles = [{
    file: path.resolve(__dirname, "../src/http/routes/public-health/inventory-only-regression.js"),
    source: `if (req.method === "POST" && url.pathname === "/api/public-health/inventory-only-regression") { return true; }`
  }];
  const matrix = {
    schemaVersion: "api-authorization-matrix-v3",
    generatedFrom: "synthetic-test-source",
    routes: []
  };
  const catalog = buildProductionApiCatalog(matrix, sourceFiles);
  const entry = catalog.entries[0];
  assert.equal(entry.key, "POST /api/public-health/inventory-only-regression");
  assert.equal(entry.owner, "T03");
  assert.equal(entry.authentication.required, null);
  assert.equal(entry.production.repositoryReview, "review-required");
  assert.equal(entry.production.blockers.includes("idempotency-behavior-proof-required"), true);
});

test("API governance CLIs expose checked and full read-only projections", () => {
  for (const script of ["api-authentication-evidence.js", "api-authorization-matrix.js", "production-api-catalog.js"]) {
    const scriptPath = path.resolve(__dirname, `../scripts/${script}`);
    const checked = JSON.parse(execFileSync(process.execPath, [scriptPath, "--check"], { encoding: "utf8" }));
    assert.equal(checked.ok, true);
    const full = JSON.parse(execFileSync(process.execPath, [scriptPath], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }));
    assert.ok(full.schemaVersion);
  }
});

test("production API catalog reuses the authorization inventory and stays fail closed", () => {
  const matrix = buildMatrix();
  const catalog = buildProductionApiCatalog(matrix);
  assert.deepEqual(validateProductionApiCatalog(catalog, matrix), []);
  const literalRouteInventory = buildLiteralRouteInventory();
  const expectedKeys = new Set([...matrix.routes.map((route) => route.key), ...literalRouteInventory.map((route) => route.key)]);
  assert.equal(matrix.routes.length, matrix.summary.declarations);
  assert.equal(matrix.routes.length >= 606, true);
  assert.equal(literalRouteInventory.length, catalog.summary.literalRouteInventory);
  assert.equal(literalRouteInventory.length >= 373, true);
  assert.equal(catalog.summary.entries >= 598, true);
  assert.equal(catalog.schemaVersion, "production-api-catalog-v3");
  assert.equal(catalog.summary.authenticationEvidenceVerified, 13);
  assert.equal(catalog.summary.unclassifiedAuthentication, 0);
  assert.equal(catalog.summary.routeInventoryOnly, 0);
  assert.equal(catalog.summary.publicRoutes, 8);
  assert.equal(catalog.summary.optionalAuthenticationRoutes, 1);
  assert.equal(catalog.summary.entries, expectedKeys.size);
  assert.equal(catalog.summary.declarations, matrix.routes.length);
  assert.equal(catalog.summary.productionNoGo, catalog.summary.entries);
  assert.equal(catalog.entries.every((entry) => entry.method && entry.path && entry.owner && entry.authentication && entry.authorization && entry.idempotency), true);
  assert.equal(catalog.entries.every((entry) => entry.production.status === "NO-GO" && entry.production.productionReady === false), true);
  const publicHealthHighlightEntries = catalog.entries.filter((entry) => entry.key === "GET /api/public-health/highlights");
  assert.equal(publicHealthHighlightEntries.length, 1);
  const [publicHealthHighlights] = publicHealthHighlightEntries;
  assert.equal(publicHealthHighlights.owner, "T03");
  assert.equal(publicHealthHighlights.domain, "public-health");
  assert.equal(publicHealthHighlights.purpose, "read-public-health-command-overview");
  assert.equal(publicHealthHighlights.highRisk, true);
  assert.equal(publicHealthHighlights.authentication.required, true);
  assert.equal(publicHealthHighlights.authentication.mode, "required");
  assert.deepEqual(publicHealthHighlights.authentication.mechanisms, ["bearer-or-cookie-session"]);
  assert.deepEqual(publicHealthHighlights.authorization.roles, ["commission"]);
  assert.deepEqual(publicHealthHighlights.authorization.dataScopes, [
    "city and health-admin platform; district own organization or explicit public-health hospital allowlist"
  ]);
  assert.equal(publicHealthHighlights.authorization.variants.length, 1);
  assert.equal(
    publicHealthHighlights.authorization.variants[0].dataScope,
    "city and health-admin platform; district own organization or explicit public-health hospital allowlist"
  );
  assert.equal(publicHealthHighlights.authorization.rolesOrScope, "roles-and-resource-scope");
  assert.equal(publicHealthHighlights.routeResolution, "literal");
  assert.equal(publicHealthHighlights.sourceCoverage, "authorization-matrix-and-route-inventory");
  assert.equal(publicHealthHighlights.idempotency.required, false);
  assert.equal(publicHealthHighlights.idempotency.status, "not-required-safe-method");
  assert.equal(publicHealthHighlights.production.status, "NO-GO");
  assert.equal(publicHealthHighlights.production.productionReady, false);
});

test("custom authentication evidence classifies every proven control flow without inventing a route", () => {
  const catalog = buildProductionApiCatalog();
  for (const key of ["GET /api/auth/context", "GET /api/auth/me", "POST /api/auth/logout", "GET /api/regional/context"]) {
    const entry = catalog.entries.find((candidate) => candidate.key === key);
    assert.ok(entry, `${key} is catalogued`);
    assert.equal(entry.sourceCoverage, "authorization-matrix-and-route-inventory");
    assert.equal(entry.authentication.evidenceContractIds.length, 1);
    assert.equal(entry.production.status, "NO-GO");
  }
  assert.equal(catalog.entries.find((entry) => entry.key === "POST /api/auth/logout").authentication.mode, "optional");
  assert.equal(catalog.entries.find((entry) => entry.key === "GET /api/regional/context").authentication.mode, "none");
  const t10CutoverPack = catalog.entries.find((entry) => entry.key === "GET /api/t10-specialty/cutover-pack");
  assert.equal(t10CutoverPack.authentication.required, true);
  assert.deepEqual(t10CutoverPack.authorization.roles, ["commission"]);
  assert.equal(t10CutoverPack.authentication.evidenceContractIds[0], "shared.t10-specialty-cutover-pack-commission-session.v1");
  assert.equal(t10CutoverPack.sourceCoverage, "authorization-matrix-and-route-inventory");
  const health = catalog.entries.find((entry) => entry.key === "GET /api/public-health/domain-events/health");
  assert.equal(health.authentication.required, true);
  assert.deepEqual(health.authorization.roles, ["commission"]);
  assert.equal(catalog.entries.some((entry) => entry.key === "POST /api/public-health/domain-events/health"), false);
  const callback = catalog.entries.find((entry) => entry.key === "POST /api/auth/sms-delivery-callback");
  assert.equal(callback.authentication.required, true);
  assert.deepEqual(callback.authentication.mechanisms, ["hmac-sha256-signed-external-callback"]);
  assert.equal(callback.authorization.rolesOrScope, "verified-external-provider-message-scope");
  assert.equal(callback.sourceCoverage, "authorization-matrix-and-route-inventory");
  assert.equal(callback.production.productionReady, false);
});

test("write APIs always expose an idempotency classification without claiming proof", () => {
  const catalog = buildProductionApiCatalog();
  const writes = catalog.entries.filter((entry) => entry.idempotency.required);
  assert.equal(writes.length > 0, true);
  assert.equal(writes.every((entry) => ["source-marker-observed", "not-observed"].includes(entry.idempotency.status)), true);
  assert.equal(catalog.policy.sourceMarkersAreBehaviorProof, false);
  assert.equal(catalog.policy.writeIdempotencyEvidence, "explicit-behavior-contract-and-executable-test-evidence");
  assert.equal(catalog.entries.filter((entry) => entry.idempotency.status === "not-observed").every((entry) => entry.production.repositoryReview === "review-required"), true);
  assert.equal(catalog.summary.writeIdempotencyBehaviorVerified, 38);
  assert.equal(catalog.summary.writeIdempotencyActionSlicesVerified, 2);
  assert.equal(catalog.summary.writeIdempotencyBehaviorProofRequired, writes.length - 38);
  assert.equal(writes.filter((entry) => entry.idempotency.behaviorEvidence.status === "behavior-proof-required").every((entry) => entry.production.blockers.includes("idempotency-behavior-proof-required")), true);
  const callback = catalog.entries.find((entry) => entry.key === "POST /api/auth/sms-delivery-callback");
  assert.equal(callback.idempotency.status, "source-marker-observed");
  assert.equal(callback.idempotency.behaviorEvidence.status, "behavior-verified");
  assert.equal(callback.idempotency.behaviorEvidence.distributedExactlyOnceClaimed, false);
  assert.equal(callback.production.status, "NO-GO");
  const reconciliation = catalog.entries.find((entry) => entry.key === "POST /api/financial-gateways/reconciliation-runs");
  assert.equal(reconciliation.idempotency.behaviorEvidence.status, "behavior-verified");
  assert.equal(reconciliation.idempotency.behaviorEvidence.distributedExactlyOnceClaimed, false);
  assert.equal(reconciliation.production.status, "NO-GO");
  const securityControl = catalog.entries.find((entry) => entry.key === "POST /api/security/controls/:id/actions");
  assert.equal(securityControl.idempotency.behaviorEvidence.status, "behavior-verified");
  assert.equal(securityControl.idempotency.behaviorEvidence.distributedExactlyOnceClaimed, false);
  assert.equal(securityControl.production.status, "NO-GO");
  const publicHealthSignal = catalog.entries.find((entry) => entry.key === "POST /api/public-health/highlights/signals");
  assert.equal(publicHealthSignal.idempotency.behaviorEvidence.contractId, "public-health.highlight-signal-intake-command.v1");
  assert.equal(publicHealthSignal.idempotency.behaviorEvidence.distributedExactlyOnceClaimed, false);
  assert.equal(publicHealthSignal.production.status, "NO-GO");
  for (const key of [
    "POST /api/public-health/supervision/subjects",
    "POST /api/public-health/supervision/inspection-tasks",
    "POST /api/public-health/supervision/inspection-tasks/:id/actions",
    "POST /api/public-health/supervision/findings/:id/actions"
  ]) {
    const supervision = catalog.entries.find((entry) => entry.key === key);
    assert.equal(supervision.idempotency.behaviorEvidence.status, "behavior-verified", key);
    assert.equal(supervision.idempotency.behaviorEvidence.distributedExactlyOnceClaimed, false, key);
    assert.equal(supervision.production.status, "NO-GO", key);
  }
  for (const key of ["POST /api/workflow-actions", "POST /api/tasks/:id/actions"]) {
    const actionSlice = catalog.entries.find((entry) => entry.key === key);
    assert.equal(actionSlice.idempotency.behaviorEvidence.status, "behavior-proof-required");
    assert.equal(actionSlice.idempotency.behaviorEvidence.verifiedActionContracts.length, 1);
    assert.equal(actionSlice.production.repositoryReview, "review-required");
  }
});

test("runtime-derived paths and roles remain explicit review blockers", () => {
  const catalog = buildProductionApiCatalog();
  const unresolved = catalog.entries.filter((entry) => entry.routeResolution === "runtime-policy");
  assert.equal(unresolved.length > 0, true);
  assert.equal(unresolved.every((entry) => entry.production.blockers.includes("runtime-route-policy-not-resolved")), true);
  assert.equal(unresolved.every((entry) => entry.production.status === "NO-GO"), true);
});

test("catalog validation rejects production promotion", () => {
  const matrix = buildMatrix();
  const promoted = clone(buildProductionApiCatalog(matrix));
  promoted.entries[0].production.status = "GO";
  promoted.entries[0].production.productionReady = true;
  assert.match(validateProductionApiCatalog(promoted, matrix).join("\n"), /must fail closed/);
});

test("catalog validation rejects duplicate keys", () => {
  const matrix = buildMatrix();
  const duplicated = clone(buildProductionApiCatalog(matrix));
  duplicated.entries.push(clone(duplicated.entries[0]));
  duplicated.summary.entries += 1;
  duplicated.summary.productionNoGo += 1;
  assert.match(validateProductionApiCatalog(duplicated, matrix).join("\n"), /duplicate catalog key/);
});

test("catalog validation rejects missing authentication classification", () => {
  const matrix = buildMatrix();
  const missingAuthentication = clone(buildProductionApiCatalog(matrix));
  delete missingAuthentication.entries[0].authentication;
  assert.match(validateProductionApiCatalog(missingAuthentication, matrix).join("\n"), /no authentication classification/);

  const forgedAuthenticationEvidence = clone(buildProductionApiCatalog(matrix));
  forgedAuthenticationEvidence.entries.find((entry) => entry.key === "GET /api/auth/context").authentication.evidenceContractIds[0] = "forged.authentication.v1";
  assert.match(validateProductionApiCatalog(forgedAuthenticationEvidence, matrix).join("\n"), /authentication classification lacks matching governed evidence/);
});

test("catalog validation rejects missing authorization roles", () => {
  const matrix = buildMatrix();
  const missingAuthorization = clone(buildProductionApiCatalog(matrix));
  const protectedEntry = missingAuthorization.entries.find((entry) => entry.authentication.required && entry.authorization.roles.length);
  protectedEntry.authorization.roles = [];
  assert.match(validateProductionApiCatalog(missingAuthorization, matrix).join("\n"), /no role or scope policy/);

  const forgedBehaviorProof = clone(buildProductionApiCatalog(matrix));
  const markerOnly = forgedBehaviorProof.entries.find((entry) => entry.idempotency.status === "source-marker-observed" && entry.idempotency.behaviorEvidence.status === "behavior-proof-required");
  markerOnly.idempotency.behaviorEvidence = {
    status: "behavior-verified",
    contractId: "forged.source-marker-proof",
    owner: markerOnly.owner,
    distributedExactlyOnceClaimed: false
  };
  markerOnly.production.blockers = markerOnly.production.blockers.filter((blocker) => blocker !== "idempotency-behavior-proof-required");
  assert.match(validateProductionApiCatalog(forgedBehaviorProof, matrix).join("\n"), /matching governed (?:endpoint )?contract/);

  const exactlyOnceClaim = clone(buildProductionApiCatalog(matrix));
  exactlyOnceClaim.entries.find((entry) => entry.idempotency.behaviorEvidence.status === "behavior-verified").idempotency.behaviorEvidence.distributedExactlyOnceClaimed = true;
  assert.match(validateProductionApiCatalog(exactlyOnceClaim, matrix).join("\n"), /must not claim distributed exactly-once/);
});

test("catalog validation rejects method and path drift", () => {
  const matrix = buildMatrix();
  const drifted = clone(buildProductionApiCatalog(matrix));
  drifted.entries[0].path = "/api/drifted-path";
  assert.match(validateProductionApiCatalog(drifted, matrix).join("\n"), /method\/path drift/);
});

test("catalog validation rejects missing idempotency classification", () => {
  const matrix = buildMatrix();
  const missingIdempotency = clone(buildProductionApiCatalog(matrix));
  const writeEntry = missingIdempotency.entries.find((entry) => entry.idempotency.required);
  delete writeEntry.idempotency;
  assert.match(validateProductionApiCatalog(missingIdempotency, matrix).join("\n"), /no idempotency classification/);
});

test("catalog validation rejects source inventory drift", () => {
  const matrix = buildMatrix();
  const catalog = buildProductionApiCatalog(matrix);
  catalog.entries.pop();
  catalog.summary.entries -= 1;
  catalog.summary.productionNoGo -= 1;
  assert.match(validateProductionApiCatalog(catalog, matrix).join("\n"), /missing from catalog/);
});

test("catalog validation rejects idempotency and review summary drift", () => {
  const matrix = buildMatrix();
  const drifted = clone(buildProductionApiCatalog(matrix));
  drifted.summary.writeIdempotencyBehaviorVerified += 1;
  drifted.summary.writeIdempotencyActionSlicesVerified -= 1;
  drifted.summary.writeIdempotencyBehaviorProofRequired -= 1;
  drifted.summary.writeIdempotencyObserved -= 1;
  drifted.summary.writeIdempotencyNotObserved += 1;
  drifted.summary.reviewRequired -= 1;
  drifted.summary.authenticationEvidenceVerified -= 1;
  drifted.summary.optionalAuthenticationRoutes -= 1;
  drifted.summary.publicRoutes -= 1;
  const errors = validateProductionApiCatalog(drifted, matrix).join("\n");
  assert.match(errors, /behavior-verified idempotency summary drift/);
  assert.match(errors, /action-slice idempotency summary drift/);
  assert.match(errors, /behavior-proof-required summary drift/);
  assert.match(errors, /source-marker observed summary drift/);
  assert.match(errors, /source-marker not-observed summary drift/);
  assert.match(errors, /review-required summary drift/);
  assert.match(errors, /authentication evidence summary drift/);
  assert.match(errors, /optional authentication summary drift/);
  assert.match(errors, /public API summary drift/);
});

test("catalog validation rejects incomplete identity scope blockers and unclassified promotion", () => {
  const matrix = buildMatrix();
  const drifted = clone(buildProductionApiCatalog(matrix));
  const entry = drifted.entries.find((candidate) => candidate.key === "GET /api/t10-specialty/cutover-pack");
  entry.owner = "";
  entry.authorization.dataScopes = [];
  entry.authentication.required = null;
  entry.authentication.mode = "review-required";
  entry.production.repositoryReview = "catalogued";
  entry.production.blockers = [];
  const errors = validateProductionApiCatalog(drifted, matrix).join("\n");
  assert.match(errors, /incomplete API identity/);
  assert.match(errors, /unclassified authentication must remain review-required/);
  assert.match(errors, /no data scope/);
  assert.match(errors, /lacks the external evidence blocker/);
});
