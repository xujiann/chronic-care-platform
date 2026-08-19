"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createRouteSegment } = require("../src/http/routes/clinical-specialties/clinical-blood");

function createRuntime({ role = "institution", authorized = true } = {}) {
  const calls = {
    authorization: [],
    builds: 0,
    normalizations: 0,
    reads: 0,
    responses: []
  };
  const user = { id: "blood-user-001", role, orgCode: "ORG-A" };
  const data = {
    bloodTestReports: [{ id: "report-001" }],
    bloodReleaseReviews: [{ id: "review-001" }],
    bloodShipments: [
      { id: "shipment-owned-source", institutionCode: "ORG-A" },
      { id: "shipment-owned-destination", destinationInstitution: "ORG-A" },
      { id: "shipment-foreign", institutionCode: "ORG-B", destinationInstitution: "ORG-C" }
    ],
    bloodSafetyIncidents: [
      { id: "incident-owned", institutionCode: "ORG-A" },
      { id: "incident-foreign", institutionCode: "ORG-B" }
    ],
    compatibilityTests: [
      { id: "compatibility-owned", requestId: "request-owned" },
      { id: "compatibility-foreign", requestId: "request-foreign" }
    ],
    transfusionEpisodes: [
      { id: "episode-owned", destinationInstitution: "ORG-A" },
      { id: "episode-foreign", destinationInstitution: "ORG-B" }
    ]
  };
  const runtime = {
    BloodService: {
      buildDashboard(input, actor) {
        calls.builds += 1;
        assert.equal(input, data);
        assert.equal(actor, user);
        assert.equal(input.transactionStateNormalized, true);
        return {
          summary: { status: "operational" },
          transfusionRequests: [{ id: "request-owned" }]
        };
      }
    },
    BloodTransactionService: {
      normalizeTransactionState(input) {
        calls.normalizations += 1;
        assert.equal(input, data);
        input.transactionStateNormalized = true;
        return input;
      }
    },
    collectJson() {
      throw new Error("blood dashboard must not collect a request body");
    },
    readDatabase() {
      calls.reads += 1;
      return data;
    },
    requireApiRole(_req, _res, roles, route) {
      calls.authorization.push({ roles, route });
      return authorized ? user : null;
    },
    sendJson(_res, status, body) {
      calls.responses.push({ status, body });
    },
    writeDatabase() {
      throw new Error("blood dashboard must not persist normalized state");
    }
  };
  return { calls, data, runtime, user };
}

test("blood dashboard preserves institution authorization and organization scope", async () => {
  const { calls, runtime } = createRuntime();
  const segment = createRouteSegment(runtime);

  const handled = await segment.handle(
    { method: "GET" },
    {},
    new URL("http://platform.test/api/blood-system")
  );

  assert.equal(handled, true);
  assert.deepEqual(calls.authorization, [{
    roles: ["commission", "institution"],
    route: "/api/blood-system"
  }]);
  assert.equal(calls.reads, 1);
  assert.equal(calls.normalizations, 1);
  assert.equal(calls.builds, 1);
  assert.deepEqual(calls.responses, [{
    status: 200,
    body: {
      summary: { status: "operational" },
      transfusionRequests: [{ id: "request-owned" }],
      testReports: [],
      releaseReviews: [],
      shipments: [
        { id: "shipment-owned-source", institutionCode: "ORG-A" },
        { id: "shipment-owned-destination", destinationInstitution: "ORG-A" }
      ],
      safetyIncidents: [{ id: "incident-owned", institutionCode: "ORG-A" }],
      compatibilityTests: [{ id: "compatibility-owned", requestId: "request-owned" }],
      transfusionEpisodes: [{ id: "episode-owned", destinationInstitution: "ORG-A" }]
    }
  }]);
});

test("blood dashboard preserves commission-wide projections", async () => {
  const { calls, data, runtime } = createRuntime({ role: "commission" });
  const segment = createRouteSegment(runtime);

  await segment.handle(
    { method: "GET" },
    {},
    new URL("http://platform.test/api/blood-system")
  );

  const body = calls.responses[0].body;
  assert.equal(calls.responses[0].status, 200);
  assert.equal(body.testReports, data.bloodTestReports);
  assert.equal(body.releaseReviews, data.bloodReleaseReviews);
  assert.deepEqual(body.shipments, data.bloodShipments);
  assert.deepEqual(body.safetyIncidents, data.bloodSafetyIncidents);
  assert.equal(body.compatibilityTests, data.compatibilityTests);
  assert.deepEqual(body.transfusionEpisodes, data.transfusionEpisodes);
});

test("blood dashboard stops before data access when authorization is denied", async () => {
  const { calls, runtime } = createRuntime({ authorized: false });
  const segment = createRouteSegment(runtime);

  const handled = await segment.handle(
    { method: "GET" },
    {},
    new URL("http://platform.test/api/blood-system")
  );

  assert.equal(handled, true);
  assert.equal(calls.authorization.length, 1);
  assert.equal(calls.reads, 0);
  assert.equal(calls.normalizations, 0);
  assert.equal(calls.builds, 0);
  assert.deepEqual(calls.responses, []);
});

test("clinical blood route still falls through for an unrelated path", async () => {
  const { calls, runtime } = createRuntime();
  const segment = createRouteSegment(runtime);

  const handled = await segment.handle(
    { method: "GET" },
    {},
    new URL("http://platform.test/api/not-blood")
  );

  assert.equal(handled, false);
  assert.deepEqual(calls.authorization, []);
  assert.equal(calls.reads, 0);
});

test("clinical blood route construction supports manifest-only runtime probes", () => {
  const placeholder = () => "placeholder";
  const segment = createRouteSegment(new Proxy({}, { get: () => placeholder }));

  assert.equal(segment.id, "clinical-specialties-06");
});
