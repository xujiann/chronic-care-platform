"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  BLOOD_COORDINATION_CONTRACT,
  OWNER,
  createEmergencyDashboardQuery
} = require("../src/clinical-specialties/emergency/dashboard-query");

test("emergency dashboard query exposes its owner and versioned blood contract", () => {
  assert.equal(OWNER, "T06/emergency");
  assert.equal(BLOOD_COORDINATION_CONTRACT, "blood-emergency-coordination.v1");
});

test("emergency dashboard query composes only emergency blood projections without mutation", () => {
  const data = Object.freeze({ marker: "source-data" });
  const user = Object.freeze({ id: "citizen-001", role: "citizen" });
  const emergencyDashboard = Object.freeze({ events: Object.freeze([{ id: "event-001" }]) });
  const projections = Object.freeze([
    Object.freeze({ consumer: "emergency", projectionId: "emergency-001" }),
    Object.freeze({ consumer: "operations", projectionId: "operations-001" })
  ]);
  const bloodDashboard = Object.freeze({ status: "operational", projections });
  const calls = [];
  const query = createEmergencyDashboardQuery({
    buildEmergencyDashboard(input, actor) {
      calls.push(["emergency", input, actor]);
      return emergencyDashboard;
    },
    readBloodCoordination(input, actor) {
      calls.push(["blood", input, actor]);
      return bloodDashboard;
    }
  });

  const result = query.execute({ data, user });

  assert.deepEqual(calls, [
    ["emergency", data, user],
    ["blood", data, user]
  ]);
  assert.deepEqual(result, {
    events: [{ id: "event-001" }],
    bloodCoordination: {
      status: "operational",
      projections: [{ consumer: "emergency", projectionId: "emergency-001" }]
    }
  });
  assert.equal(bloodDashboard.projections, projections);
  assert.equal(projections.length, 2);
});

test("emergency dashboard query fails fast when a required port is missing", () => {
  assert.throws(
    () => createEmergencyDashboardQuery({ readBloodCoordination() {} }),
    /buildEmergencyDashboard port must be a function/
  );
  assert.throws(
    () => createEmergencyDashboardQuery({ buildEmergencyDashboard() {} }),
    /readBloodCoordination port must be a function/
  );
});
