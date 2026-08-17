"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  DEPENDENCIES,
  SUBDOMAIN_DEPENDENCIES
} = require("../src/http/runtime-contexts/platform-governance");
const { createRouteSegments } = require("../src/http/routes/platform-governance");

test("platform governance segments use distinct least-privilege service contexts", () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(SUBDOMAIN_DEPENDENCIES).map(([name, dependencies]) => [name, dependencies.length])),
    {
      "governance-catalog": 15,
      "public-health-coordination": 18,
      "site-launch-evidence": 4,
      "digital-hospital-pilot": 17,
      "digital-hospital-readiness": 21,
      "production-operations": 22,
      "digital-hospital-governance": 54,
      "phase2-operations": 54,
      "mutual-recognition-overview": 4,
      "mutual-recognition-decision": 9,
      "productization-center": 11
    }
  );
  assert.equal(new Set(Object.values(SUBDOMAIN_DEPENDENCIES).map((dependencies) => dependencies.join(","))).size, 11);
  assert.deepEqual([...new Set(Object.values(SUBDOMAIN_DEPENDENCIES).flat())].sort(), [...DEPENDENCIES].sort());
  assert.equal(Math.max(...Object.values(SUBDOMAIN_DEPENDENCIES).map((dependencies) => dependencies.length)) <= 60, true);
});

test("platform governance facade projects every service context and fails fast", () => {
  const runtime = Object.fromEntries(DEPENDENCIES.map((name) => [name, Symbol(name)]));
  const segments = createRouteSegments(runtime);
  assert.deepEqual(
    segments.map((segment) => segment.id),
    Array.from({ length: 11 }, (_, index) => `platform-governance-${String(index + 1).padStart(2, "0")}`)
  );
  const incomplete = { ...runtime };
  delete incomplete.buildGovernanceCatalog;
  assert.throws(
    () => createRouteSegments(incomplete),
    /platform-governance\/governance-catalog is missing/
  );
});
