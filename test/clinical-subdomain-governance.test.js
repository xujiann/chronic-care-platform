"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const {
  EXPECTED_SUBDOMAINS,
  loadClinicalSubdomainRegistry,
  matchesPrefix,
  validateClinicalSubdomainRegistry
} = require("../src/clinical-specialties/subdomain-governance");

const ROOT = path.resolve(__dirname, "..");

test("clinical specialty governance defines exactly five bounded subdomains", () => {
  const registry = loadClinicalSubdomainRegistry(ROOT);
  assert.deepEqual(registry.subdomains.map((item) => item.id), EXPECTED_SUBDOMAINS);
  assert.equal(registry.architecture, "modular-monolith");
  assert.equal(registry.independentDeploymentAuthorized, false);
  assert.deepEqual(
    registry.subdomains.map((item) => item.owner),
    ["T06/emergency", "T06/blood", "T06/imaging", "T06/physical-examination", "T06/quality-safety"]
  );
  assert.deepEqual(
    registry.subdomains[0].implementedUseCases.map((useCase) => useCase.id),
    ["emergency-dashboard-query.v1"]
  );
  assert.deepEqual(
    registry.subdomains[1].implementedUseCases.map((useCase) => useCase.id),
    ["blood-dashboard-query.v1"]
  );
});

test("all current clinical API literals have one subdomain or explicit handoff owner", () => {
  const report = validateClinicalSubdomainRegistry(ROOT);
  assert.deepEqual(report.issues, []);
  assert.equal(report.ok, true);
  assert.equal(report.routeLiteralCount > 70, true);
  EXPECTED_SUBDOMAINS.forEach((id) => assert.equal(report.routeCounts[id] > 0, true, id));
  assert.equal(report.routeCounts["legacy-platform-operations"] > 0, true);
});

test("route prefix matching respects path boundaries", () => {
  assert.equal(matchesPrefix("/api/emergency/events/1", "/api/emergency"), true);
  assert.equal(matchesPrefix("/api/emergency-signals/1", "/api/emergency"), false);
  assert.equal(matchesPrefix("/api/emergency-signals/1", "/api/emergency-signals"), true);
});

test("data subdomain ownership is unique and central registrations remain authoritative", () => {
  const registry = loadClinicalSubdomainRegistry(ROOT);
  const claims = registry.subdomains.flatMap((subdomain) =>
    [...subdomain.registeredCollections, ...subdomain.candidateCollections].map((collection) => [collection, subdomain.id])
  );
  assert.equal(new Set(claims.map(([collection]) => collection)).size, claims.length);
  assert.equal(registry.subdomains.find((item) => item.id === "quality-safety").writeBoundary, "quality-owned-only");
  const report = validateClinicalSubdomainRegistry(ROOT);
  assert.equal(report.registeredCollectionCount, 9);
  assert.equal(report.candidateCollectionCount > 50, true);
});

test("cross-subdomain access is versioned and quality consumes observations without foreign writes", () => {
  const registry = loadClinicalSubdomainRegistry(ROOT);
  assert.deepEqual(
    registry.crossSubdomainContracts.map((contract) => contract.id),
    ["blood-emergency-coordination.v1", "blood-quality-signal.v1", "clinical-quality-observation.v1"]
  );
  registry.crossSubdomainContracts.forEach((contract) => {
    assert.match(contract.id, /\.v\d+$/);
    assert.match(contract.version, /^\d+\.\d+\.\d+$/);
    assert.equal(contract.requiredFields.length > 0, true);
  });
  const quality = registry.subdomains.find((item) => item.id === "quality-safety");
  assert.deepEqual(quality.externalReadCollections, []);
});

test("governance gate rejects overlapping source, route and contract boundaries", () => {
  const registry = structuredClone(loadClinicalSubdomainRegistry(ROOT));
  registry.subdomains[1].targetSourceRoot = registry.subdomains[0].targetSourceRoot;
  registry.subdomains[1].routePrefixes = ["/api/emergency/events"];
  registry.crossSubdomainContracts[0].interaction = "direct-implementation-import";
  registry.crossSubdomainContracts[0].consumers = ["blood"];
  registry.subdomains[0].implementedUseCases[0].source = "src/http/routes/clinical-specialties/emergency-care.js";
  registry.subdomains[0].implementedUseCases[0].contracts = ["unknown-contract.v1"];
  delete registry.subdomains[0].implementedUseCases[0].sideEffects;

  const report = validateClinicalSubdomainRegistry(ROOT, registry);
  const issues = report.issues.join("\n");
  assert.equal(report.ok, false);
  assert.match(issues, /target source roots must be unique/);
  assert.match(issues, /route prefixes overlap/);
  assert.match(issues, /must separate non-empty providers and consumers/);
  assert.match(issues, /uses disallowed interaction/);
  assert.match(issues, /source is outside emergency/);
  assert.match(issues, /references unknown contract unknown-contract\.v1/);
  assert.match(issues, /must declare side effects explicitly/);
});
