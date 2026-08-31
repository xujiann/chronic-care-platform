"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  DEPENDENCIES,
  SUBDOMAIN_DEPENDENCIES
} = require("../src/http/runtime-contexts/clinical-specialties");
const { createRouteSegments } = require("../src/http/routes/clinical-specialties");

const EXPECTED_COUNTS = {
  "imaging-cloud": 12,
  "emergency-care": 11,
  "quality-safety": 18,
  "clinical-blood": 30,
  "mutual-recognition-ingest": 9,
  "mutual-recognition-review": 8,
  "emergency-signals": 8,
  "blood-innovation": 20
};

test("clinical specialty subdomains declare distinct least-privilege contexts", () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(SUBDOMAIN_DEPENDENCIES).map(([name, dependencies]) => [name, dependencies.length])),
    EXPECTED_COUNTS
  );
  assert.equal(new Set(Object.values(SUBDOMAIN_DEPENDENCIES).map((dependencies) => dependencies.join(","))).size, 8);
  assert.deepEqual([...new Set(Object.values(SUBDOMAIN_DEPENDENCIES).flat())].sort(), [...DEPENDENCIES].sort());
});

test("clinical specialty facade projects every segment and fails fast on missing capabilities", () => {
  const runtime = Object.fromEntries(DEPENDENCIES.map((name) => [name, Symbol(name)]));
  const segments = createRouteSegments(runtime);
  assert.deepEqual(
    segments.map((segment) => segment.id),
    ["clinical-specialties-01", ...Array.from({ length: 7 }, (_, index) => `clinical-specialties-${String(index + 4).padStart(2, "0")}`)]
  );

  const incomplete = { ...runtime };
  delete incomplete.BloodInnovationService;
  assert.throws(() => createRouteSegments(incomplete), /clinical-specialties\/blood-innovation is missing/);
});
