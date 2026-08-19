"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createRouteSegment } = require("../src/http/routes/clinical-specialties/clinical-blood");

function createRuntime({ authorized = true, residentAllowed = true } = {}) {
  const calls = {
    accessLogs: [],
    authorization: [],
    builds: [],
    reads: 0,
    redactions: [],
    responses: [],
    securityEvents: [],
    writes: []
  };
  const user = { id: "imaging-user-001", name: "影像调阅员", role: "institution", orgCode: "ORG-A" };
  const data = { marker: "imaging-dashboard-characterization" };
  const runtime = {
    BloodTransactionService: new Proxy({}, { get: () => () => undefined }),
    appendDataAccessLog(input, actor, residentId, category, detail) {
      calls.accessLogs.push({ input, actor, residentId, category, detail });
    },
    appendSecurityEvent(event) {
      calls.securityEvents.push(event);
    },
    buildImageCloudDashboard(input, actor, filters) {
      calls.builds.push({ input, actor, filters });
      return {
        summary: { studies: 1 },
        studies: [{ id: "study-001", objectPath: "oss://private/study-001", viewerUrl: "https://viewer.test/?token=secret" }],
        shares: [{ id: "share-001", token: "IMG-SECRET" }]
      };
    },
    canAccessResident(actor, residentId, input) {
      assert.equal(actor, user);
      assert.equal(residentId, "resident-001");
      assert.equal(input, data);
      return residentAllowed;
    },
    collectJson() {
      throw new Error("imaging dashboard must not collect a request body");
    },
    readDatabase() {
      calls.reads += 1;
      return data;
    },
    redactSensitiveResponse(payload, actor) {
      calls.redactions.push({ payload, actor });
      return { ...payload, redactionMarker: true };
    },
    requireApiRole(_req, _res, roles, route) {
      calls.authorization.push({ roles, route });
      return authorized ? user : null;
    },
    sendJson(_res, status, body) {
      calls.responses.push({ status, body });
    },
    writeDatabase(input) {
      calls.writes.push(input);
    }
  };
  return { calls, data, runtime, user };
}

test("imaging dashboard preserves resident scope, audit persistence and public projection", async () => {
  const { calls, data, runtime, user } = createRuntime();
  const segment = createRouteSegment(runtime);

  const handled = await segment.handle(
    { method: "GET" },
    {},
    new URL("http://platform.test/api/imaging-cloud?residentId=resident-001&institutionCode=ORG-A")
  );

  assert.equal(handled, true);
  assert.deepEqual(calls.authorization, [{
    roles: ["commission", "institution", "county", "citizen"],
    route: "/api/imaging-cloud"
  }]);
  assert.equal(calls.reads, 1);
  assert.deepEqual(calls.accessLogs, [{
    input: data,
    actor: user,
    residentId: "resident-001",
    category: "医学影像云",
    detail: "查询影像检查、报告和电子病历索引"
  }]);
  assert.deepEqual(calls.writes, [data]);
  assert.deepEqual(calls.builds, [{
    input: data,
    actor: user,
    filters: { residentId: "resident-001", institutionCode: "ORG-A" }
  }]);
  assert.equal(calls.redactions.length, 1);
  assert.equal(calls.redactions[0].actor, user);
  assert.deepEqual(calls.responses, [{
    status: 200,
    body: {
      summary: { studies: 1 },
      studies: [{ id: "study-001" }],
      shares: [{ id: "share-001" }],
      redactionMarker: true,
      mutualRecognition: []
    }
  }]);
});

test("imaging dashboard without resident filter does not append an access audit", async () => {
  const { calls, runtime } = createRuntime();
  const segment = createRouteSegment(runtime);

  await segment.handle(
    { method: "GET" },
    {},
    new URL("http://platform.test/api/imaging-cloud?institutionCode=ORG-A")
  );

  assert.equal(calls.reads, 1);
  assert.deepEqual(calls.accessLogs, []);
  assert.deepEqual(calls.writes, []);
  assert.deepEqual(calls.builds[0].filters, { residentId: "", institutionCode: "ORG-A" });
  assert.equal(calls.responses[0].status, 200);
});

test("imaging dashboard denies resident scope before audit, build and persistence", async () => {
  const { calls, runtime } = createRuntime({ residentAllowed: false });
  const segment = createRouteSegment(runtime);

  const handled = await segment.handle(
    { method: "GET" },
    {},
    new URL("http://platform.test/api/imaging-cloud?residentId=resident-001")
  );

  assert.equal(handled, true);
  assert.equal(calls.reads, 1);
  assert.deepEqual(calls.accessLogs, []);
  assert.deepEqual(calls.writes, []);
  assert.deepEqual(calls.builds, []);
  assert.deepEqual(calls.redactions, []);
  assert.deepEqual(calls.securityEvents, [{
    actor: "影像调阅员",
    role: "institution",
    action: "access imaging cloud",
    target: "resident-001",
    result: "denied",
    detail: "resident scope denied"
  }]);
  assert.deepEqual(calls.responses, [{
    status: 403,
    body: { error: "Forbidden", code: undefined, message: "无权调阅该居民影像云资料", productionReady: undefined }
  }]);
});

test("imaging dashboard stops before data access when authorization is denied", async () => {
  const { calls, runtime } = createRuntime({ authorized: false });
  const segment = createRouteSegment(runtime);

  const handled = await segment.handle(
    { method: "GET" },
    {},
    new URL("http://platform.test/api/imaging-cloud?residentId=resident-001")
  );

  assert.equal(handled, true);
  assert.equal(calls.authorization.length, 1);
  assert.equal(calls.reads, 0);
  assert.deepEqual(calls.securityEvents, []);
  assert.deepEqual(calls.responses, []);
});

test("clinical blood route construction remains lazy for imaging manifest probes", () => {
  const placeholder = () => "placeholder";
  const segment = createRouteSegment(new Proxy({}, { get: () => placeholder }));

  assert.equal(segment.id, "clinical-specialties-06");
});
