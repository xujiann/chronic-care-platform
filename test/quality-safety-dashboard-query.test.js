"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const {
  BLOOD_QUALITY_SIGNAL_CONTRACT,
  OWNER,
  USE_CASE,
  createQualitySafetyDashboardQuery
} = require("../src/clinical-specialties/quality-safety/dashboard-query");
const {
  validateClinicalSubdomainRegistry
} = require("../src/clinical-specialties/subdomain-governance");
const {
  createRouteSegment
} = require("../src/http/routes/clinical-specialties/quality-safety");

const ROOT = path.resolve(__dirname, "..");

test("quality safety dashboard query exposes its owner and versioned contracts", () => {
  assert.equal(OWNER, "T06/quality-safety");
  assert.equal(USE_CASE, "quality-safety-dashboard-query.v1");
  assert.equal(BLOOD_QUALITY_SIGNAL_CONTRACT, "blood-quality-signal.v1");
});

test("quality safety dashboard query preserves role projections and filters blood signals", () => {
  for (const role of ["commission", "institution", "county"]) {
    const data = Object.freeze({ marker: `quality-data-${role}` });
    const user = Object.freeze({ role, orgCode: `ORG-${role}` });
    const projections = Object.freeze([
      Object.freeze({ consumer: "quality-safety", projectionId: `${role}-quality` }),
      Object.freeze({ consumer: "emergency", projectionId: `${role}-emergency` }),
      Object.freeze({ consumer: "operations", projectionId: `${role}-operations` })
    ]);
    const coordination = Object.freeze({ status: "operational", projections });
    const calls = [];
    const query = createQualitySafetyDashboardQuery({
      buildQualitySafetyDashboard(input, actor) {
        calls.push(["quality", input, actor]);
        return { roleProjection: actor.role, issues: [{ id: `issue-${actor.role}` }] };
      },
      readBloodCoordination(input, actor) {
        calls.push(["blood", input, actor]);
        return coordination;
      }
    });

    const result = query.execute({ data, user });

    assert.deepEqual(calls, [
      ["blood", data, user],
      ["quality", data, user]
    ]);
    assert.deepEqual(result, {
      roleProjection: role,
      issues: [{ id: `issue-${role}` }],
      bloodCoordination: {
        status: "operational",
        projections: [{ consumer: "quality-safety", projectionId: `${role}-quality` }]
      }
    });
    assert.equal(coordination.projections, projections);
    assert.equal(projections.length, 3);
  }
});

test("quality safety dashboard query fails fast when a required port is missing", () => {
  assert.throws(
    () => createQualitySafetyDashboardQuery({ readBloodCoordination() {} }),
    /buildQualitySafetyDashboard port must be a function/
  );
  assert.throws(
    () => createQualitySafetyDashboardQuery({ buildQualitySafetyDashboard() {} }),
    /readBloodCoordination port must be a function/
  );
});

test("quality safety dashboard route preserves authentication, reads and response semantics", async () => {
  const data = { marker: "quality-route-data" };
  const user = { role: "institution", orgCode: "ORG-A" };
  const calls = [];
  const runtime = {
    BloodEventHub: {
      dashboard(input, actor) {
        calls.push(["blood", input, actor]);
        return {
          status: "operational",
          projections: [
            { consumer: "quality-safety", projectionId: "quality-001" },
            { consumer: "emergency", projectionId: "emergency-001" }
          ]
        };
      }
    },
    buildQualitySafetyDashboard(input, actor) {
      calls.push(["quality", input, actor]);
      return { roleProjection: actor.role, issues: [{ id: "issue-001" }] };
    },
    requireApiRole(req, res, roles, resource) {
      calls.push(["authorize", roles, resource]);
      return user;
    },
    readDatabase() {
      calls.push(["read"]);
      return data;
    },
    sendJson(res, status, body) {
      calls.push(["send", status, body]);
    },
    appendQualitySafetyAudit() {
      throw new Error("dashboard GET must not append a quality audit");
    },
    appendSecurityEvent() {
      throw new Error("dashboard GET must not append a security event");
    },
    writeDatabase() {
      throw new Error("dashboard GET must not write data");
    }
  };
  const segment = createRouteSegment(runtime);

  const handled = await segment.handle(
    { method: "GET" },
    {},
    new URL("http://localhost/api/quality-safety/dashboard")
  );

  assert.equal(handled, true);
  assert.deepEqual(calls, [
    ["authorize", ["commission", "institution", "county"], "/api/quality-safety/dashboard"],
    ["read"],
    ["blood", data, user],
    ["quality", data, user],
    ["send", 200, {
      roleProjection: "institution",
      issues: [{ id: "issue-001" }],
      bloodCoordination: {
        status: "operational",
        projections: [{ consumer: "quality-safety", projectionId: "quality-001" }]
      }
    }]
  ]);
});

test("quality safety dashboard route rejects before reading or producing side effects", async () => {
  const calls = [];
  const segment = createRouteSegment({
    requireApiRole(req, res, roles, resource) {
      calls.push(["authorize", roles, resource]);
      return null;
    },
    readDatabase() {
      throw new Error("unauthorized dashboard GET must not read data");
    },
    sendJson() {
      throw new Error("requireApiRole owns the unauthorized response");
    }
  });

  const handled = await segment.handle(
    { method: "GET" },
    {},
    new URL("http://localhost/api/quality-safety/dashboard")
  );

  assert.equal(handled, true);
  assert.deepEqual(calls, [
    ["authorize", ["commission", "institution", "county"], "/api/quality-safety/dashboard"]
  ]);
});

test("quality safety source guard forbids server and other clinical subdomain imports", () => {
  const report = validateClinicalSubdomainRegistry(ROOT);
  const qualityImportViolations = report.issues.filter((issue) => {
    const normalized = issue.replace(/\\/g, "/");
    return normalized.includes("clinical-specialties/quality-safety")
      && (normalized.includes("depends on server.js") || normalized.includes("implementation directly"));
  });

  assert.deepEqual(qualityImportViolations, []);
});
