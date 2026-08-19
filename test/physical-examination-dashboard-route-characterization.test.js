"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createRouteSegment } = require("../src/http/routes/clinical-specialties/blood-innovation");

function createRuntime({
  authorized = true,
  role = "citizen",
  residentAllowed = true,
  production = false
} = {}) {
  const calls = [];
  const responses = [];
  const data = { marker: "physical-examination-dashboard-characterization" };
  const user = {
    id: "physical-exam-user-001",
    name: "体检查询用户",
    orgCode: "ORG-A",
    role
  };
  const allowedResidentIds = new Set(residentAllowed ? ["resident-001"] : ["resident-002"]);
  const runtime = {
    PhysicalExaminationService: {
      buildOverview(input, options) {
        calls.push(["build-overview", input, options]);
        return {
          summary: { reports: 2 },
          jointTests: [{ id: "joint-test-001" }],
          gatewayEvents: [{ id: "gateway-event-001" }],
          specializedIntakes: [{ id: "intake-001" }],
          reports: [{ id: "report-001", residentId: "resident-001" }]
        };
      }
    },
    allowedResidentIdsForUser(input, actor) {
      calls.push(["allowed-residents", input, actor]);
      return allowedResidentIds;
    },
    appendDataAccessLog(input, actor, residentId, category, detail) {
      calls.push(["access-audit", input, actor, residentId, category, detail]);
    },
    appendSecurityEvent(event) {
      calls.push(["security-event", event]);
    },
    buildPhysicalExamProductionReadiness(input, overview) {
      calls.push(["build-readiness", input, overview]);
      return {
        codeReady: true,
        goLiveReady: false,
        production,
        gateway: { secretConfigured: false },
        quality: { mappingRate: 100 },
        blockers: ["site-evidence", "object-storage"]
      };
    },
    isProductionRuntime() {
      calls.push(["production-runtime"]);
      return production;
    },
    readDatabase() {
      calls.push(["read-database"]);
      return data;
    },
    redactSensitiveResponse(payload, actor) {
      calls.push(["redact", payload, actor]);
      return { ...payload, redacted: true };
    },
    requireApiRole(_req, _res, roles, route) {
      calls.push(["authorize", roles, route]);
      return authorized ? user : null;
    },
    sendJson(_res, status, body) {
      calls.push(["send", status, body]);
      responses.push({ status, body });
    },
    writeDatabase(input) {
      calls.push(["write-database", input]);
    }
  };
  return { allowedResidentIds, calls, data, responses, runtime, user };
}

async function handleDashboard(runtime, query = "") {
  return createRouteSegment(runtime).handle(
    { method: "GET" },
    {},
    new URL(`http://platform.test/api/physical-exams${query}`)
  );
}

test("physical examination dashboard preserves citizen scope, projection and access audit order", async () => {
  const { calls, data, responses, runtime, user } = createRuntime();

  assert.equal(await handleDashboard(runtime, "?residentId=%20resident-001%20"), true);
  assert.deepEqual(calls.map(([name]) => name), [
    "authorize",
    "read-database",
    "allowed-residents",
    "production-runtime",
    "build-overview",
    "build-readiness",
    "access-audit",
    "write-database",
    "redact",
    "send"
  ]);
  assert.deepEqual(calls[0].slice(1), [
    ["citizen", "institution", "commission"],
    "/api/physical-exams"
  ]);
  assert.equal(calls[2][1], data);
  assert.equal(calls[2][2], user);
  assert.deepEqual(calls[4][2], {
    residentId: "resident-001",
    residentIds: ["resident-001"],
    excludeDemoData: false
  });
  assert.deepEqual(calls[6].slice(1), [
    data,
    user,
    "resident-001",
    "历史体检报告",
    "同步查看居民健康档案中的体检报告"
  ]);
  assert.equal(calls[7][1], data);
  assert.equal(calls[8][1].jointTests, undefined);
  assert.equal(calls[8][1].gatewayEvents, undefined);
  assert.equal(calls[8][1].specializedIntakes, undefined);
  assert.deepEqual(calls[8][1].readiness, {
    codeReady: true,
    quality: { mappingRate: 100 },
    blockers: 2
  });
  assert.equal(calls[8][2], user);
  assert.equal(responses[0].status, 200);
  assert.equal(responses[0].body.redacted, true);
});

test("physical examination dashboard keeps the full management projection", async () => {
  const { calls, responses, runtime } = createRuntime({ role: "institution" });

  await handleDashboard(runtime, "?residentId=resident-001");

  const redactedInput = calls.find(([name]) => name === "redact")[1];
  assert.deepEqual(redactedInput.jointTests, [{ id: "joint-test-001" }]);
  assert.deepEqual(redactedInput.gatewayEvents, [{ id: "gateway-event-001" }]);
  assert.deepEqual(redactedInput.specializedIntakes, [{ id: "intake-001" }]);
  assert.equal(redactedInput.readiness.goLiveReady, false);
  assert.deepEqual(redactedInput.readiness.blockers, ["site-evidence", "object-storage"]);
  assert.equal(responses[0].status, 200);
});

test("physical examination dashboard passes the production demo-data boundary", async () => {
  const { calls, runtime } = createRuntime({ production: true, role: "commission" });

  await handleDashboard(runtime);

  assert.deepEqual(calls.find(([name]) => name === "build-overview")[2], {
    residentId: "",
    residentIds: ["resident-001"],
    excludeDemoData: true
  });
});

test("physical examination dashboard without a resident filter does not persist an access audit", async () => {
  const { calls, runtime } = createRuntime({ role: "institution" });

  await handleDashboard(runtime);

  assert.equal(calls.some(([name]) => name === "access-audit"), false);
  assert.equal(calls.some(([name]) => name === "write-database"), false);
  assert.equal(calls.some(([name]) => name === "build-overview"), true);
  assert.equal(calls.some(([name]) => name === "redact"), true);
});

test("physical examination dashboard denies resident scope before building or persisting", async () => {
  const { calls, responses, runtime } = createRuntime({ residentAllowed: false });

  assert.equal(await handleDashboard(runtime, "?residentId=resident-001"), true);
  assert.deepEqual(calls.map(([name]) => name), [
    "authorize",
    "read-database",
    "allowed-residents",
    "security-event",
    "send"
  ]);
  assert.deepEqual(calls[3][1], {
    actor: "体检查询用户",
    role: "citizen",
    action: "查看体检报告",
    target: "resident-001",
    result: "拒绝",
    detail: "超出居民授权范围"
  });
  assert.deepEqual(responses, [{
    status: 403,
    body: { error: "Forbidden", message: "无权查看该居民体检报告" }
  }]);
});

test("physical examination dashboard stops before data access when authorization is denied", async () => {
  const { calls, responses, runtime } = createRuntime({ authorized: false });

  assert.equal(await handleDashboard(runtime, "?residentId=resident-001"), true);
  assert.deepEqual(calls.map(([name]) => name), ["authorize"]);
  assert.deepEqual(responses, []);
});

test("blood innovation route construction remains lazy for physical examination manifest probes", () => {
  const placeholder = () => "placeholder";
  const segment = createRouteSegment(new Proxy({}, { get: () => placeholder }));

  assert.equal(segment.id, "clinical-specialties-10");
});
