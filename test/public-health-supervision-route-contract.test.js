"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const route = require("../src/http/routes/public-health/health-supervision");
const publicHealth = require("../src/http/routes/public-health");
const context = require("../src/http/runtime-contexts/public-health");

test("health supervision is an explicit least-privilege public-health segment", () => {
  assert.equal(route.ROUTE_SEGMENT_ID, "public-health-05");
  assert.equal(route.SUBDOMAIN, "health-supervision");
  assert.deepEqual(context.SUBDOMAIN_DEPENDENCIES[route.SUBDOMAIN], route.REQUIRED_DEPENDENCIES);
  assert.deepEqual(publicHealth.SUBDOMAIN_SEGMENTS.map(([name]) => name), [
    "surveillance-foundation",
    "public-health-operations",
    "vital-records",
    "infectious-reporting",
    "health-supervision"
  ]);
});

test("health supervision route declares only its five approved endpoints", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/http/routes/public-health/health-supervision.js"), "utf8");
  for (const endpoint of [
    "/api/public-health/supervision/workbench",
    "/api/public-health/supervision/subjects",
    "/api/public-health/supervision/inspection-tasks",
    "/api/public-health/supervision/inspection-tasks/",
    "/api/public-health/supervision/findings/"
  ]) {
    assert.match(source, new RegExp(endpoint.replaceAll("/", "\\/")));
  }
  assert.doesNotMatch(source, /medicalResources|residentId|patientId|server\.js/);
  assert.doesNotMatch(source, /productionReady:\s*true/);
});
