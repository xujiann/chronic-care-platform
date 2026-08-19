"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createRouteSegment } = require("../src/http/routes/clinical-specialties/emergency-care");

function createRuntime(overrides = {}) {
  const calls = {
    authorization: [],
    reads: 0,
    redactions: [],
    responses: []
  };
  const user = { id: "citizen-001", role: "citizen" };
  const data = { marker: "emergency-dashboard-characterization" };
  const runtime = {
    BloodEventHub: {
      dashboard(input, actor) {
        assert.equal(input, data);
        assert.equal(actor, user);
        return {
          status: "operational",
          projections: [
            { consumer: "emergency", projectionId: "projection-emergency" },
            { consumer: "operations", projectionId: "projection-operations" }
          ]
        };
      }
    },
    EmergencyLifeChain: {},
    EmergencyProduction: {},
    EmergencyService: {
      buildDashboard(input, actor) {
        assert.equal(input, data);
        assert.equal(actor, user);
        return { events: [{ id: "event-001" }], scope: "citizen" };
      }
    },
    collectJson() {
      throw new Error("dashboard must not collect a request body");
    },
    readDatabase() {
      calls.reads += 1;
      return data;
    },
    redactSensitiveResponse(payload, actor) {
      calls.redactions.push({ payload, actor });
      return { ...payload, redacted: true };
    },
    requireApiRole(_req, _res, roles, route) {
      calls.authorization.push({ roles, route });
      return user;
    },
    sendDownload() {
      throw new Error("dashboard must not send a download");
    },
    sendJson(_res, status, body) {
      calls.responses.push({ status, body });
    },
    writeDatabase() {
      throw new Error("dashboard must remain read-only");
    },
    ...overrides
  };
  return { calls, data, runtime, user };
}

test("emergency dashboard preserves authorization, response and blood projection scope", async () => {
  const { calls, runtime, user } = createRuntime();
  const segment = createRouteSegment(runtime);

  const handled = await segment.handle(
    { method: "GET" },
    {},
    new URL("http://platform.test/api/emergency/dashboard")
  );

  assert.equal(handled, true);
  assert.deepEqual(calls.authorization, [{
    roles: ["commission", "institution", "citizen"],
    route: "/api/emergency/dashboard"
  }]);
  assert.equal(calls.reads, 1);
  assert.equal(calls.redactions.length, 1);
  assert.equal(calls.redactions[0].actor, user);
  assert.deepEqual(calls.responses, [{
    status: 200,
    body: {
      events: [{ id: "event-001" }],
      scope: "citizen",
      bloodCoordination: {
        status: "operational",
        projections: [{ consumer: "emergency", projectionId: "projection-emergency" }]
      },
      redacted: true
    }
  }]);
});

test("emergency dashboard stops before data access when authorization is denied", async () => {
  const { calls, runtime } = createRuntime({
    requireApiRole(_req, _res, roles, route) {
      calls.authorization.push({ roles, route });
      return null;
    }
  });
  const segment = createRouteSegment(runtime);

  const handled = await segment.handle(
    { method: "GET" },
    {},
    new URL("http://platform.test/api/emergency/dashboard")
  );

  assert.equal(handled, true);
  assert.equal(calls.authorization.length, 1);
  assert.equal(calls.reads, 0);
  assert.deepEqual(calls.redactions, []);
  assert.deepEqual(calls.responses, []);
});

test("emergency route still falls through for an unrelated path", async () => {
  const { calls, runtime } = createRuntime();
  const segment = createRouteSegment(runtime);

  const handled = await segment.handle(
    { method: "GET" },
    {},
    new URL("http://platform.test/api/not-emergency")
  );

  assert.equal(handled, false);
  assert.deepEqual(calls.authorization, []);
  assert.equal(calls.reads, 0);
});

test("emergency route construction remains lazy for manifest-only runtime probes", () => {
  const placeholder = () => "placeholder";
  const segment = createRouteSegment({
    BloodEventHub: placeholder,
    EmergencyLifeChain: placeholder,
    EmergencyProduction: placeholder,
    EmergencyService: placeholder,
    collectJson: placeholder,
    readDatabase: placeholder,
    redactSensitiveResponse: placeholder,
    requireApiRole: placeholder,
    sendDownload: placeholder,
    sendJson: placeholder,
    writeDatabase: placeholder
  });

  assert.equal(segment.id, "clinical-specialties-04");
});
