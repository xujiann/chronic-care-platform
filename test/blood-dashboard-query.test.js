"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  OWNER,
  USE_CASE,
  createBloodDashboardQuery
} = require("../src/clinical-specialties/blood/dashboard-query");

function fixture() {
  return {
    bloodTestReports: [{ id: "report-001" }],
    bloodReleaseReviews: [{ id: "review-001" }],
    bloodShipments: [
      { id: "shipment-owned", institutionCode: "ORG-A" },
      { id: "shipment-foreign", destinationInstitution: "ORG-B" }
    ],
    bloodSafetyIncidents: [
      { id: "incident-owned", destinationInstitution: "ORG-A" },
      { id: "incident-foreign", institutionCode: "ORG-B" }
    ],
    compatibilityTests: [
      { id: "compatibility-owned", requestId: "request-owned" },
      { id: "compatibility-foreign", requestId: "request-foreign" }
    ],
    transfusionEpisodes: [
      { id: "episode-owned", institutionCode: "ORG-A" },
      { id: "episode-foreign", institutionCode: "ORG-B" }
    ]
  };
}

test("blood dashboard query exposes its owner and versioned use case", () => {
  assert.equal(OWNER, "T06/blood");
  assert.equal(USE_CASE, "blood-dashboard-query.v1");
});

test("blood dashboard query normalizes before building and scopes institution projections", () => {
  const data = fixture();
  const user = { role: "institution", orgCode: "ORG-A" };
  const calls = [];
  const query = createBloodDashboardQuery({
    normalizeTransactionState(input) {
      calls.push("normalize");
      assert.equal(input, data);
      input.normalized = true;
    },
    buildBloodDashboard(input, actor) {
      calls.push("build");
      assert.equal(input.normalized, true);
      assert.equal(actor, user);
      return {
        summary: { status: "operational" },
        transfusionRequests: [{ id: "request-owned" }]
      };
    }
  });

  const result = query.execute({ data, user });

  assert.deepEqual(calls, ["normalize", "build"]);
  assert.deepEqual(result, {
    summary: { status: "operational" },
    transfusionRequests: [{ id: "request-owned" }],
    testReports: [],
    releaseReviews: [],
    shipments: [{ id: "shipment-owned", institutionCode: "ORG-A" }],
    safetyIncidents: [{ id: "incident-owned", destinationInstitution: "ORG-A" }],
    compatibilityTests: [{ id: "compatibility-owned", requestId: "request-owned" }],
    transfusionEpisodes: [{ id: "episode-owned", institutionCode: "ORG-A" }]
  });
});

test("blood dashboard query preserves commission-wide collection projections", () => {
  const data = fixture();
  const query = createBloodDashboardQuery({
    normalizeTransactionState() {},
    buildBloodDashboard() {
      return { transfusionRequests: [] };
    }
  });

  const result = query.execute({ data, user: { role: "commission", orgCode: "BLOOD-CENTER" } });

  assert.equal(result.testReports, data.bloodTestReports);
  assert.equal(result.releaseReviews, data.bloodReleaseReviews);
  assert.deepEqual(result.shipments, data.bloodShipments);
  assert.deepEqual(result.safetyIncidents, data.bloodSafetyIncidents);
  assert.equal(result.compatibilityTests, data.compatibilityTests);
  assert.deepEqual(result.transfusionEpisodes, data.transfusionEpisodes);
});

test("blood dashboard query fails fast when a required port is missing", () => {
  assert.throws(
    () => createBloodDashboardQuery({ normalizeTransactionState() {} }),
    /buildBloodDashboard port must be a function/
  );
  assert.throws(
    () => createBloodDashboardQuery({ buildBloodDashboard() {} }),
    /normalizeTransactionState port must be a function/
  );
});
