"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const routeSource = fs.readFileSync(
  path.resolve(__dirname, "..", "src", "http", "routes", "public-health", "public-health-operations.js"),
  "utf8"
);

test("public health highlight contracts have exactly one reachable implementation", () => {
  const exactRoutes = [
    ["GET", "/api/public-health/highlights"],
    ["POST", "/api/public-health/highlights/signals"]
  ];
  for (const [method, route] of exactRoutes) {
    const marker = `req.method === "${method}" && url.pathname === "${route}"`;
    assert.equal(routeSource.split(marker).length - 1, 1, `${method} ${route}`);
  }

  const dynamicContracts = [
    "/api/public-health/highlights/alerts/:id/actions",
    "/api/public-health/highlights/command-tasks/:id/actions",
    "/api/public-health/highlights/ai-reviews/:id/actions",
    "/api/public-health/highlights/evidence/:id/actions"
  ];
  for (const route of dynamicContracts) {
    assert.equal(routeSource.split(`requireApiRole(req, res, ["commission"], "${route}")`).length - 1, 1, route);
  }

  assert.doesNotMatch(routeSource, /ActionMatchV2/);
});
