"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  OWNER,
  USE_CASE,
  createImagingDashboardQuery
} = require("../src/clinical-specialties/imaging/dashboard-query");

test("imaging dashboard query exposes its owner and versioned use case", () => {
  assert.equal(OWNER, "T06/imaging");
  assert.equal(USE_CASE, "imaging-dashboard-query.v1");
});

test("imaging dashboard query builds, redacts and projects in order", () => {
  const data = { marker: "imaging-data" };
  const user = { role: "citizen", id: "citizen-001" };
  const calls = [];
  const query = createImagingDashboardQuery({
    buildImagingDashboard(input, actor, filters) {
      calls.push(["build", input, actor, filters]);
      return {
        summary: { studies: 1 },
        studies: [{ id: "study-001", objectPath: "oss://private/study-001" }],
        shares: [{ id: "share-001", token: "IMG-SECRET" }]
      };
    },
    redactSensitiveResponse(payload, actor) {
      calls.push(["redact", payload, actor]);
      return { ...payload, redacted: true };
    }
  });

  const result = query.execute({
    data,
    user,
    residentId: "resident-001",
    institutionCode: "ORG-A"
  });

  assert.equal(calls[0][0], "build");
  assert.equal(calls[0][1], data);
  assert.equal(calls[0][2], user);
  assert.deepEqual(calls[0][3], { residentId: "resident-001", institutionCode: "ORG-A" });
  assert.equal(calls[1][0], "redact");
  assert.equal(calls[1][2], user);
  assert.deepEqual(result, {
    summary: { studies: 1 },
    studies: [{ id: "study-001" }],
    shares: [{ id: "share-001" }],
    redacted: true,
    mutualRecognition: []
  });
});

test("imaging dashboard query fails fast when a required port is missing", () => {
  assert.throws(
    () => createImagingDashboardQuery({ redactSensitiveResponse() {} }),
    /buildImagingDashboard port must be a function/
  );
  assert.throws(
    () => createImagingDashboardQuery({ buildImagingDashboard() {} }),
    /redactSensitiveResponse port must be a function/
  );
});
