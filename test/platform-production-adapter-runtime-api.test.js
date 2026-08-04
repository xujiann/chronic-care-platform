"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createRouteSegment
} = require("../src/http/routes/platform-governance/production-operations");

test("production adapter runtime API is commission-only, read-only and payload-safe", async () => {
  const events = [];
  let response = null;
  const runtime = {
    appendSecurityEvent: (event) => events.push(event),
    productionAdapterRuntimeReadiness: async () => ({
      mode: "disabled",
      workersEligible: false,
      productionReady: false,
      credentialsExposed: false
    }),
    requireApiRole: () => ({ name: "commission-user", role: "commission" }),
    sendJson: (_res, status, payload) => { response = { status, payload }; }
  };
  const segment = createRouteSegment(runtime);
  const handled = await segment.handle(
    { method: "GET" },
    {},
    new URL("http://localhost/api/production-adapters/runtime")
  );
  assert.equal(handled, true);
  assert.equal(response.status, 200);
  assert.equal(response.payload.productionReady, false);
  assert.equal(events[0].action, "production-adapter-runtime-read");
  assert.doesNotMatch(JSON.stringify(response), /password|secret|patient/i);
});
