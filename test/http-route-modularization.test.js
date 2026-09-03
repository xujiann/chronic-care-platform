"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { createApiRouter } = require("../src/http/api-router");
const { ROUTE_SUBDOMAINS } = require("../src/http/route-subdomains");
const { readRuntimeSource, runtimeSourceFiles } = require("../src/http/runtime-source");
const { ROUTE_ORDER } = require("../src/http/routes");

const ROOT = path.resolve(__dirname, "..");
const EXPECTED_DOMAINS = [
  "care-coordination",
  "citizen-chronic",
  "clinical-specialties",
  "identity-security",
  "insurance-payment",
  "integration",
  "platform-governance",
  "public-health",
  "regional",
  "research",
  "runtime",
  "shared",
  "state-data"
];

test("platform routes have one explicit ordered manifest across domain modules", () => {
  assert.equal(ROUTE_ORDER.length, 80);
  assert.equal(new Set(ROUTE_ORDER.map((route) => route.id)).size, ROUTE_ORDER.length);
  assert.deepEqual([...new Set(ROUTE_ORDER.map((route) => route.domain))].sort(), EXPECTED_DOMAINS);

  const files = runtimeSourceFiles(ROOT).map((file) => path.relative(ROOT, file).replaceAll("\\", "/"));
  assert.equal(files[0], "server.js");
  assert.equal(files.includes("src/http/routes/index.js"), true);
  EXPECTED_DOMAINS.forEach((domain) => {
    assert.equal(files.includes(`src/http/routes/${domain}.js`), true);
  });
});

test("large governance, public-health and clinical contexts are physically split by subdomain", () => {
  const files = runtimeSourceFiles(ROOT).map((file) => path.relative(ROOT, file).replaceAll("\\", "/"));
  const splitEntries = Object.entries(ROUTE_SUBDOMAINS);
  assert.equal(splitEntries.length, 27);
  for (const [id, subdomain] of splitEntries) {
    const domain = id.startsWith("platform-governance-")
      ? "platform-governance"
      : id.startsWith("public-health-")
        ? "public-health"
        : "clinical-specialties";
    const modulePath = `src/http/routes/${domain}/${subdomain}.js`;
    assert.equal(files.includes(modulePath), true, modulePath);
    const routeModule = require(path.join(ROOT, modulePath));
    assert.equal(routeModule.ROUTE_SEGMENT_ID, id);
    assert.equal(routeModule.SUBDOMAIN, subdomain);
    assert.equal(typeof routeModule.createRouteSegment, "function");
  }
  for (const domain of ["platform-governance", "public-health", "clinical-specialties"]) {
    const facade = fs.readFileSync(path.join(ROOT, "src", "http", "routes", `${domain}.js`), "utf8");
    assert.equal(facade.split(/\r?\n/).length < 40, true);
  }
});

test("runtime source combines the server shell and all route domains", () => {
  const source = readRuntimeSource(ROOT);
  assert.match(source, /createPlatformApiRouter/);
  assert.match(source, /\/api\/live/);
  assert.match(source, /\/api\/public-health/);
  assert.match(source, /\/api\/insurance/);
  assert.match(source, /\/api\/research/);
});

test("router preserves manifest order and stops after a handled segment", async () => {
  const calls = [];
  const router = createApiRouter([
    { id: "first", domain: "runtime", handle: async () => { calls.push("first"); return false; } },
    { id: "second", domain: "shared", handle: async () => { calls.push("second"); return true; } },
    { id: "third", domain: "research", handle: async () => { calls.push("third"); return true; } }
  ]);

  assert.deepEqual(router.manifest, [
    { id: "first", domain: "runtime" },
    { id: "second", domain: "shared" },
    { id: "third", domain: "research" }
  ]);
  assert.equal(await router.handle({}, { writableEnded: false, headersSent: false }, new URL("http://localhost/api/live")), true);
  assert.deepEqual(calls, ["first", "second"]);
});

test("router rejects duplicate segment identifiers", () => {
  assert.throws(
    () => createApiRouter([
      { id: "duplicate", domain: "runtime", handle: async () => false },
      { id: "duplicate", domain: "shared", handle: async () => false }
    ]),
    /duplicate route segment id/
  );
});
