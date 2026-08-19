"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  OWNER,
  USE_CASE,
  createPhysicalExaminationDashboardQuery
} = require("../src/clinical-specialties/physical-examination/dashboard-query");

function createQuery(calls) {
  return createPhysicalExaminationDashboardQuery({
    buildPhysicalExamOverview(data, options) {
      calls.push(["overview", data, options]);
      return {
        summary: { reports: 1 },
        jointTests: [{ id: "joint-001" }],
        gatewayEvents: [{ id: "gateway-001" }],
        specializedIntakes: [{ id: "intake-001" }]
      };
    },
    buildPhysicalExamReadiness(data, overview) {
      calls.push(["readiness", data, overview]);
      return {
        codeReady: true,
        goLiveReady: false,
        quality: { mappingRate: 100 },
        blockers: ["site-evidence"]
      };
    }
  });
}

test("physical examination dashboard query exposes its owner and versioned use case", () => {
  assert.equal(OWNER, "T06/physical-examination");
  assert.equal(USE_CASE, "physical-examination-dashboard-query.v1");
});

test("physical examination dashboard query builds readiness before projecting a citizen response", () => {
  const calls = [];
  const data = { marker: "physical-exam-data" };
  const query = createQuery(calls);

  const result = query.execute({
    data,
    user: { role: "citizen" },
    residentId: "resident-001",
    residentIds: ["resident-001", "resident-002"],
    excludeDemoData: true
  });

  assert.deepEqual(calls.map(([name]) => name), ["overview", "readiness"]);
  assert.equal(calls[0][1], data);
  assert.deepEqual(calls[0][2], {
    residentId: "resident-001",
    residentIds: ["resident-001", "resident-002"],
    excludeDemoData: true
  });
  assert.equal(calls[1][1], data);
  assert.equal(calls[1][2].summary.reports, 1);
  assert.deepEqual(result, {
    summary: { reports: 1 },
    readiness: {
      codeReady: true,
      quality: { mappingRate: 100 },
      blockers: 1
    }
  });
});

test("physical examination dashboard query preserves the management projection", () => {
  for (const role of ["institution", "commission"]) {
    const result = createQuery([]).execute({ data: {}, user: { role } });
    assert.deepEqual(result.jointTests, [{ id: "joint-001" }]);
    assert.deepEqual(result.gatewayEvents, [{ id: "gateway-001" }]);
    assert.deepEqual(result.specializedIntakes, [{ id: "intake-001" }]);
    assert.equal(result.readiness.goLiveReady, false);
    assert.deepEqual(result.readiness.blockers, ["site-evidence"]);
  }
});

test("physical examination dashboard query fails fast when a required port is missing", () => {
  assert.throws(
    () => createPhysicalExaminationDashboardQuery({ buildPhysicalExamReadiness() {} }),
    /buildPhysicalExamOverview port must be a function/
  );
  assert.throws(
    () => createPhysicalExaminationDashboardQuery({ buildPhysicalExamOverview() {} }),
    /buildPhysicalExamReadiness port must be a function/
  );
});
