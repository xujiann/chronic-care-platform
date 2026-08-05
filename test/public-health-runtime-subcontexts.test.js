"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  DEPENDENCIES,
  SUBDOMAIN_DEPENDENCIES
} = require("../src/http/runtime-contexts/public-health");
const { createRouteSegments } = require("../src/http/routes/public-health");

test("public-health subdomains declare distinct least-privilege contexts", () => {
  assert.deepEqual(Object.keys(SUBDOMAIN_DEPENDENCIES), [
    "surveillance-foundation",
    "public-health-operations",
    "vital-records",
    "infectious-reporting"
  ]);
  assert.deepEqual(
    Object.fromEntries(Object.entries(SUBDOMAIN_DEPENDENCIES).map(([name, dependencies]) => [name, dependencies.length])),
    {
      "surveillance-foundation": 97,
      "public-health-operations": 59,
      "vital-records": 15,
      "infectious-reporting": 18
    }
  );
  assert.equal(new Set(Object.values(SUBDOMAIN_DEPENDENCIES).map((dependencies) => dependencies.join(","))).size, 4);
  assert.deepEqual([...new Set(Object.values(SUBDOMAIN_DEPENDENCIES).flat())].sort(), [...DEPENDENCIES].sort());
});

test("public-health facade projects each subdomain and fails fast on missing capabilities", () => {
  const runtime = Object.fromEntries(DEPENDENCIES.map((name) => [name, Symbol(name)]));
  const segments = createRouteSegments(runtime);
  assert.deepEqual(segments.map((segment) => segment.id), [
    "public-health-01",
    "public-health-02",
    "public-health-03",
    "public-health-04"
  ]);

  const incomplete = { ...runtime };
  delete incomplete.normalizeBirthCertificate;
  assert.throws(() => createRouteSegments(incomplete), /public-health\/vital-records is missing/);
});
