"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { buildMatrix } = require("../scripts/api-authorization-matrix");
const { buildLiteralRouteInventory, buildProductionApiCatalog, validateProductionApiCatalog } = require("../scripts/production-api-catalog");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test("production API catalog reuses the authorization inventory and stays fail closed", () => {
  const matrix = buildMatrix();
  const catalog = buildProductionApiCatalog(matrix);
  assert.deepEqual(validateProductionApiCatalog(catalog, matrix), []);
  const literalRouteInventory = buildLiteralRouteInventory();
  const expectedKeys = new Set([...matrix.routes.map((route) => route.key), ...literalRouteInventory.map((route) => route.key)]);
  assert.equal(matrix.routes.length, 588);
  assert.equal(literalRouteInventory.length, 372);
  assert.equal(catalog.summary.entries, 594);
  assert.equal(catalog.summary.unclassifiedAuthentication, 14);
  assert.equal(catalog.summary.entries, expectedKeys.size);
  assert.equal(catalog.summary.declarations, matrix.routes.length);
  assert.equal(catalog.summary.publicRoutes, 5);
  assert.equal(catalog.summary.productionNoGo, catalog.summary.entries);
  assert.equal(catalog.entries.every((entry) => entry.method && entry.path && entry.owner && entry.authentication && entry.authorization && entry.idempotency), true);
  assert.equal(catalog.entries.every((entry) => entry.production.status === "NO-GO" && entry.production.productionReady === false), true);
});

test("literal route inventory adds custom session and callback policies without guessing authorization", () => {
  const catalog = buildProductionApiCatalog();
  for (const key of ["GET /api/auth/context", "GET /api/auth/me", "POST /api/auth/logout", "POST /api/auth/sms-delivery-callback"]) {
    const entry = catalog.entries.find((candidate) => candidate.key === key);
    assert.ok(entry, `${key} is catalogued`);
    assert.equal(entry.sourceCoverage, "route-inventory-only");
    assert.equal(entry.authentication.required, null);
    assert.equal(entry.production.repositoryReview, "review-required");
    assert.equal(entry.production.status, "NO-GO");
  }
});

test("write APIs always expose an idempotency classification without claiming proof", () => {
  const catalog = buildProductionApiCatalog();
  const writes = catalog.entries.filter((entry) => entry.idempotency.required);
  assert.equal(writes.length > 0, true);
  assert.equal(writes.every((entry) => ["source-marker-observed", "not-observed"].includes(entry.idempotency.status)), true);
  assert.equal(catalog.policy.writeIdempotencyEvidence, "source-marker-observation-only");
  assert.equal(catalog.entries.filter((entry) => entry.idempotency.status === "not-observed").every((entry) => entry.production.repositoryReview === "review-required"), true);
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
});

test("catalog validation rejects missing authorization roles", () => {
  const matrix = buildMatrix();
  const missingAuthorization = clone(buildProductionApiCatalog(matrix));
  const protectedEntry = missingAuthorization.entries.find((entry) => entry.authentication.required);
  protectedEntry.authorization.roles = [];
  assert.match(validateProductionApiCatalog(missingAuthorization, matrix).join("\n"), /no role or scope policy/);
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
