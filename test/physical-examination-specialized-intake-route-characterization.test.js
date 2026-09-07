"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createRouteSegment } = require("../src/http/routes/clinical-specialties/blood-innovation");

const ROUTE = "/api/physical-exams/specialized-intakes/:id/actions";

function createRuntime({
  authorized = true,
  payload: payloadOverride,
  residentAllowed = true,
  serviceError,
  writeError
} = {}) {
  const calls = [];
  const responses = [];
  const user = {
    id: "physical-exam-operator",
    name: "体检机构操作员",
    role: "institution",
    username: "physical-exam-operator",
    orgType: "medical_institution",
    orgCode: "DEMO-HOSPITAL"
  };
  const payload = payloadOverride || {
    action: "assign-profile",
    evidenceRef: "evidence-001",
    targetSystem: "SPECIALIZED",
    profileId: "profile-001",
    expectedVersion: 0,
    idempotencyKey: "specialized-route-command-001"
  };
  const current = {
    id: "intake%2F001",
    residentId: "resident-001",
    examProgramName: "示范专项体检",
    status: "awaiting-specialized-profile",
    evidenceRefs: [],
    actionHistory: [{ action: "routed", at: "2026-09-07T00:00:00.000Z" }]
  };
  const data = { physicalExamSpecializedIntakes: [current], dataAccessLogs: [], securityEvents: [] };
  const runtime = {
    PhysicalExaminationService: {
      applySpecializedIntakeAction(input, intakeId, body, context) {
        calls.push(["apply-action", input, intakeId, body, context]);
        if (serviceError) throw serviceError;
        const intake = input.physicalExamSpecializedIntakes.find((item) => item.id === intakeId);
        intake.status = "routed-to-specialized-system";
        intake.actionHistory.push({ action: body.action, at: context.now, actor: context.actor, evidenceRef: body.evidenceRef });
        return intake;
      }
    },
    appendDataAccessLog(input, actor, residentId, category, detail) {
      calls.push(["access-audit", input, actor, residentId, category, detail]);
      input.dataAccessLogs.unshift({ residentId, category, detail });
    },
    appendSecurityEvent() {},
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
    prependAuditTrailEntry(rows, event) {
      calls.push(["security-audit", rows, event]);
      return [event, ...(rows || [])];
    },
    randomUUID() {
      return "security-event-001";
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
  return { calls, current, data, payload, responses, runtime, user };
}

async function handleAction(runtime, encodedId = "intake%252F001", headers = { "idempotency-key": "specialized-route-command-001" }) {
  return createRouteSegment(runtime).handle(
    { method: "POST", headers },
    {},
    new URL(`http://platform.test/api/physical-exams/specialized-intakes/${encodedId}/actions`)
  );
}

test("specialized intake action locks, rechecks scope and commits state with both audits once", async () => {
  const { calls, current, data, payload, responses, runtime, user } = createRuntime();

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
  assert.equal(calls[4][2], "intake%2F001");
  assert.equal(calls[4][3], payload);
  assert.equal(current.version, 1);
  assert.equal(current._apiCommandReceipts.length, 1);
  assert.equal(data.dataAccessLogs.length, 1);
  assert.equal(data.securityEvents.length, 1);
  assert.equal(Object.hasOwn(responses[0].body.intake, "_apiCommandReceipts"), false);
  assert.deepEqual(responses, [{
    status: 200,
    body: { ok: true, intake: responses[0].body.intake, idempotentReplay: false }
  }]);
});

test("exact replay returns the first snapshot with zero additional mutation, audit or write", async () => {
  const { calls, current, data, responses, runtime } = createRuntime();
  await handleAction(runtime);
  const firstResponse = structuredClone(responses[0].body);
  const firstHistoryLength = current.actionHistory.length;
  await handleAction(runtime);

  assert.equal(responses[1].status, 200);
  assert.deepEqual(responses[1].body.intake, firstResponse.intake);
  assert.equal(responses[1].body.idempotentReplay, true);
  assert.equal(current.actionHistory.length, firstHistoryLength);
  assert.equal(data.dataAccessLogs.length, 1);
  assert.equal(data.securityEvents.length, 1);
  assert.equal(calls.filter(([name]) => name === "write-database").length, 1);
  assert.equal(calls.filter(([name]) => name === "apply-action").length, 1);
});

test("same key payload drift and stale versions return stable conflicts without writes", async () => {
  const harness = createRuntime();
  await handleAction(harness.runtime);
  harness.payload.profileId = "profile-changed";
  await handleAction(harness.runtime);
  assert.equal(harness.responses[1].status, 409);
  assert.equal(harness.responses[1].body.code, "PHYSICAL_EXAM_SPECIALIZED_INTAKE_IDEMPOTENCY_CONFLICT");

  const stalePayload = { ...harness.payload, idempotencyKey: "specialized-route-command-002", profileId: "profile-002" };
  harness.runtime.collectJson = async () => stalePayload;
  await handleAction(harness.runtime, "intake%252F001", { "idempotency-key": stalePayload.idempotencyKey });
  assert.equal(harness.responses[2].status, 409);
  assert.equal(harness.responses[2].body.code, "PHYSICAL_EXAM_SPECIALIZED_INTAKE_VERSION_CONFLICT");
  assert.equal(harness.calls.filter(([name]) => name === "write-database").length, 1);
});

test("specialized intake action stops before body collection when authorization is denied", async () => {
  const { calls, responses, runtime } = createRuntime({ authorized: false });
  assert.equal(await handleAction(runtime), true);
  assert.deepEqual(calls.map(([name]) => name), ["authorize"]);
  assert.deepEqual(responses, []);
});

test("scope is rechecked before an idempotent replay", async () => {
  let allowed = true;
  const harness = createRuntime();
  harness.runtime.canAccessResident = (...args) => {
    harness.calls.push(["resident-scope", ...args]);
    return allowed;
  };
  await handleAction(harness.runtime);
  allowed = false;
  await handleAction(harness.runtime);
  assert.equal(harness.responses[1].status, 403);
  assert.equal(harness.responses[1].body.code, "PHYSICAL_EXAM_SPECIALIZED_INTAKE_SCOPE_FORBIDDEN");
  assert.equal(harness.calls.filter(([name]) => name === "write-database").length, 1);
});

test("unknown ids and domain conflicts expose stable errors without side effects", async () => {
  const missing = createRuntime();
  await handleAction(missing.runtime, "missing-intake");
  assert.equal(missing.responses[0].status, 404);
  assert.equal(missing.responses[0].body.code, "PHYSICAL_EXAM_SPECIALIZED_INTAKE_NOT_FOUND");
  assert.equal(missing.calls.some(([name]) => name === "write-database"), false);

  const conflict = createRuntime({ serviceError: Object.assign(new Error("state conflict"), { statusCode: 409 }) });
  await handleAction(conflict.runtime);
  assert.equal(conflict.responses[0].status, 409);
  assert.equal(conflict.responses[0].body.code, "PHYSICAL_EXAM_SPECIALIZED_INTAKE_STATE_CONFLICT");
  assert.equal(conflict.calls.some(([name]) => name === "write-database"), false);
});

test("persistence failure emits one stable failure and never a success response", async () => {
  const { calls, responses, runtime } = createRuntime({ writeError: new Error("private disk detail") });
  assert.equal(await handleAction(runtime), true);
  assert.equal(calls.filter(([name]) => name === "write-database").length, 1);
  assert.deepEqual(responses, [{
    status: 500,
    body: {
      error: "Internal Server Error",
      code: "PHYSICAL_EXAM_SPECIALIZED_INTAKE_STORAGE_FAILED",
      message: "specialized intake command persistence failed"
    }
  }]);
});

test("SQLite collection CAS conflicts map to a recoverable 409", async () => {
  const { responses, runtime } = createRuntime({
    writeError: new Error("SQLite optimistic lock conflict on physicalExamSpecializedIntakes: expected 2, current 3")
  });
  await handleAction(runtime);
  assert.deepEqual(responses, [{
    status: 409,
    body: {
      error: "Conflict",
      code: "PHYSICAL_EXAM_SPECIALIZED_INTAKE_VERSION_CONFLICT",
      message: "resource version changed; refresh and retry"
    }
  }]);
});
