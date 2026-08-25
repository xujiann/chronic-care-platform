"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createRouteSegment } = require("../src/http/routes/clinical-specialties/blood-innovation");

const ROUTE = "/api/physical-exams/specialized-intakes/:id/actions";

function createRuntime({
  authorized = true,
  residentAllowed = true,
  serviceError,
  writeError
} = {}) {
  const calls = [];
  const responses = [];
  const user = {
    name: "体检机构操作员",
    role: "institution",
    username: "physical-exam-operator"
  };
  const payload = {
    action: "assign-profile",
    evidenceRef: "evidence-001",
    targetSystem: "CHRONIC",
    profileId: "profile-001"
  };
  const current = {
    id: "intake%2F001",
    residentId: "resident-001",
    examProgramName: "高血压专项体检"
  };
  const data = { physicalExamSpecializedIntakes: [current] };
  const intake = { ...current, status: "routed-to-specialized-system" };
  const runtime = {
    PhysicalExaminationService: {
      applySpecializedIntakeAction(input, intakeId, body, context) {
        calls.push(["apply-action", input, intakeId, body, context]);
        if (serviceError) throw serviceError;
        return intake;
      }
    },
    appendDataAccessLog(input, actor, residentId, category, detail) {
      calls.push(["access-audit", input, actor, residentId, category, detail]);
    },
    appendSecurityEvent(event) {
      calls.push(["security-audit", event]);
    },
    canAccessResident(actor, residentId, input) {
      calls.push(["resident-scope", actor, residentId, input]);
      return residentAllowed;
    },
    async collectJson() {
      calls.push(["collect-body"]);
      return payload;
    },
    normalizeState(input) {
      calls.push(["normalize", input]);
      return input;
    },
    readDatabase() {
      calls.push(["read-database"]);
      return data;
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
      if (writeError) throw writeError;
    }
  };
  return { calls, current, data, intake, payload, responses, runtime, user };
}

async function handleAction(runtime, encodedId = "intake%252F001") {
  return createRouteSegment(runtime).handle(
    { method: "POST" },
    {},
    new URL(`http://platform.test/api/physical-exams/specialized-intakes/${encodedId}/actions`)
  );
}

test("specialized intake action preserves authorization, scope, mutation, audit and persistence order", async () => {
  const { calls, data, intake, payload, responses, runtime, user } = createRuntime();

  assert.equal(await handleAction(runtime), true);
  assert.deepEqual(calls.map(([name]) => name), [
    "authorize",
    "collect-body",
    "read-database",
    "resident-scope",
    "apply-action",
    "access-audit",
    "security-audit",
    "normalize",
    "write-database",
    "send"
  ]);
  assert.deepEqual(calls[0].slice(1), [["institution", "commission"], ROUTE]);
  assert.deepEqual(calls[3].slice(1), [user, "resident-001", data]);
  assert.equal(calls[4][1], data);
  assert.equal(calls[4][2], "intake%2F001");
  assert.equal(calls[4][3], payload);
  assert.equal(calls[4][4].actor, "physical-exam-operator");
  assert.match(calls[4][4].now, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(calls[5].slice(1), [
    data,
    user,
    "resident-001",
    "专项体检分流处置",
    "高血压专项体检 · assign-profile"
  ]);
  assert.deepEqual(calls[6][1], {
    actor: "体检机构操作员",
    role: "institution",
    action: "专项体检分流处置",
    target: "intake%2F001",
    result: "成功",
    detail: "assign-profile · evidence-001"
  });
  assert.equal(calls[7][1], data);
  assert.equal(calls[8][1], data);
  assert.deepEqual(responses, [{ status: 200, body: { ok: true, intake } }]);
});

test("specialized intake action stops before body collection when authorization is denied", async () => {
  const { calls, responses, runtime } = createRuntime({ authorized: false });

  assert.equal(await handleAction(runtime), true);
  assert.deepEqual(calls.map(([name]) => name), ["authorize"]);
  assert.deepEqual(responses, []);
});

test("specialized intake action denies resident scope before mutation, audit or persistence", async () => {
  const { calls, responses, runtime } = createRuntime({ residentAllowed: false });

  assert.equal(await handleAction(runtime), true);
  assert.deepEqual(calls.map(([name]) => name), [
    "authorize",
    "collect-body",
    "read-database",
    "resident-scope",
    "send"
  ]);
  assert.deepEqual(responses, [{
    status: 403,
    body: { error: "Forbidden", message: "无权处置该专项体检分流记录" }
  }]);
});

test("specialized intake action delegates an unknown id to the domain 404 without scope or side effects", async () => {
  const serviceError = Object.assign(new Error("service-404"), { statusCode: 404 });
  const { calls, responses, runtime } = createRuntime({ serviceError });

  assert.equal(await handleAction(runtime, "missing-intake"), true);
  assert.deepEqual(calls.map(([name]) => name), [
    "authorize",
    "collect-body",
    "read-database",
    "apply-action",
    "send"
  ]);
  assert.deepEqual(responses, [{
    status: 404,
    body: { error: "Not Found", message: "service-404" }
  }]);
});

for (const [statusCode, errorName] of [
  [409, "Conflict"],
  [400, "Bad Request"]
]) {
  test(`specialized intake action preserves ${statusCode} service error mapping without side effects`, async () => {
    const serviceError = Object.assign(new Error(`service-${statusCode}`), { statusCode });
    const { calls, responses, runtime } = createRuntime({ serviceError });

    assert.equal(await handleAction(runtime), true);
    assert.deepEqual(calls.map(([name]) => name), [
      "authorize",
      "collect-body",
      "read-database",
      "resident-scope",
      "apply-action",
      "send"
    ]);
    assert.deepEqual(responses, [{
      status: statusCode,
      body: { error: errorName, message: `service-${statusCode}` }
    }]);
  });
}

test("specialized intake action maps persistence failure once and never emits a success response", async () => {
  const { calls, responses, runtime } = createRuntime({ writeError: new Error("write-failed") });

  assert.equal(await handleAction(runtime), true);
  assert.deepEqual(calls.map(([name]) => name), [
    "authorize",
    "collect-body",
    "read-database",
    "resident-scope",
    "apply-action",
    "access-audit",
    "security-audit",
    "normalize",
    "write-database",
    "send"
  ]);
  assert.deepEqual(responses, [{
    status: 400,
    body: { error: "Bad Request", message: "write-failed" }
  }]);
});
