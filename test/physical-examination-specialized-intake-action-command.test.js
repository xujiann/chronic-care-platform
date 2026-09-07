"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  MAX_RECEIPTS,
  OWNER,
  RECEIPT_FIELD,
  USE_CASE,
  createPhysicalExaminationSpecializedIntakeActionCommand,
  physicalExaminationSpecializedIntakeHttpError
} = require("../src/clinical-specialties/physical-examination/specialized-intake-action-command");

function createPorts({ applyError, writeError } = {}) {
  const calls = [];
  const intake = {
    id: "intake-001",
    residentId: "resident-001",
    examProgramName: "示范专项体检",
    status: "awaiting-specialized-profile",
    evidenceRefs: [],
    actionHistory: [{ action: "routed", at: "2026-09-07T00:00:00.000Z" }]
  };
  const data = { physicalExamSpecializedIntakes: [intake], dataAccessLogs: [], securityEvents: [] };
  const ports = {
    applySpecializedIntakeAction(input, intakeId, payload, context) {
      calls.push(["apply", input, intakeId, payload, context]);
      if (applyError) throw applyError;
      const current = input.physicalExamSpecializedIntakes.find((item) => item.id === intakeId);
      current.status = "routed-to-specialized-system";
      current.actionHistory.push({ action: payload.action, at: context.now, actor: context.actor, evidenceRef: payload.evidenceRef });
      return current;
    },
    appendDataAccessLog(input, ...args) {
      calls.push(["access-audit", input, ...args]);
      input.dataAccessLogs.unshift({ action: "specialized-access" });
    },
    appendSecurityAuditToState(input, event) {
      calls.push(["security-audit", input, event]);
      input.securityEvents.unshift(event);
    },
    normalizeState(input) {
      calls.push(["normalize", input]);
      return input;
    },
    now() {
      calls.push(["now"]);
      return "2026-09-07T01:02:03.000Z";
    },
    writeDatabase(input) {
      calls.push(["write", input]);
      if (writeError) throw writeError;
    }
  };
  return { calls, data, intake, ports };
}

function governedPayload(overrides = {}) {
  return {
    action: "assign-profile",
    evidenceRef: "evidence-001",
    targetSystem: "SPECIALIZED",
    profileId: "profile-001",
    expectedVersion: 0,
    idempotencyKey: "specialized-command-001",
    ...overrides
  };
}

function user(overrides = {}) {
  return {
    id: "operator-001",
    name: "机构操作员",
    role: "institution",
    username: "operator-001",
    orgType: "medical_institution",
    orgCode: "DEMO-HOSPITAL",
    ...overrides
  };
}

test("specialized intake action command publishes a stable owner and upgraded use case", () => {
  assert.equal(OWNER, "T06/physical-examination");
  assert.equal(USE_CASE, "physical-examination-specialized-intake-action-command.v2");
});

test("governed command persists mutation, receipt and both audits in one write", () => {
  const { calls, data, intake, ports } = createPorts();
  const command = createPhysicalExaminationSpecializedIntakeActionCommand(ports);
  const payload = governedPayload();
  const actor = user();

  const result = command.execute({
    data,
    idempotencyKey: payload.idempotencyKey,
    intakeId: intake.id,
    payload,
    user: actor
  });

  assert.equal(result.idempotentReplay, false);
  assert.equal(result.intake.version, 1);
  assert.equal(Object.hasOwn(result.intake, RECEIPT_FIELD), false);
  assert.equal(intake[RECEIPT_FIELD].length, 1);
  assert.equal(intake[RECEIPT_FIELD][0].schemaVersion, "physical-exam-specialized-intake-command-receipt.v1");
  assert.deepEqual(calls.map(([name]) => name), ["now", "apply", "access-audit", "security-audit", "normalize", "write"]);
  assert.equal(data.dataAccessLogs.length, 1);
  assert.equal(data.securityEvents.length, 1);
  assert.equal(calls.filter(([name]) => name === "write").length, 1);
});

test("exact replay returns the first public snapshot without mutation, audit or write", () => {
  const { calls, data, intake, ports } = createPorts();
  const command = createPhysicalExaminationSpecializedIntakeActionCommand(ports);
  const payload = governedPayload();
  const input = { data, idempotencyKey: payload.idempotencyKey, intakeId: intake.id, payload, user: user() };
  const first = command.execute(input);
  const callCount = calls.length;
  const replay = command.execute(input);

  assert.equal(replay.idempotentReplay, true);
  assert.deepEqual(replay.intake, first.intake);
  assert.equal(calls.length, callCount);
  assert.equal(intake.actionHistory.length, 2);
  assert.equal(data.dataAccessLogs.length, 1);
  assert.equal(data.securityEvents.length, 1);
});

test("same key with changed payload and stale versions fail closed before side effects", () => {
  const { calls, data, intake, ports } = createPorts();
  const command = createPhysicalExaminationSpecializedIntakeActionCommand(ports);
  const firstPayload = governedPayload();
  command.execute({ data, idempotencyKey: firstPayload.idempotencyKey, intakeId: intake.id, payload: firstPayload, user: user() });
  const callCount = calls.length;

  assert.throws(
    () => command.execute({
      data,
      idempotencyKey: firstPayload.idempotencyKey,
      intakeId: intake.id,
      payload: governedPayload({ profileId: "profile-changed" }),
      user: user()
    }),
    { code: "PHYSICAL_EXAM_SPECIALIZED_INTAKE_IDEMPOTENCY_CONFLICT", statusCode: 409 }
  );
  assert.throws(
    () => command.execute({
      data,
      idempotencyKey: "specialized-command-002",
      intakeId: intake.id,
      payload: governedPayload({ idempotencyKey: "specialized-command-002" }),
      user: user()
    }),
    { code: "PHYSICAL_EXAM_SPECIALIZED_INTAKE_VERSION_CONFLICT", statusCode: 409 }
  );
  assert.equal(calls.length, callCount);
});

test("governed contract validates keys and versions while legacy clients remain compatible", () => {
  const { data, intake, ports } = createPorts();
  const command = createPhysicalExaminationSpecializedIntakeActionCommand(ports);
  assert.throws(
    () => command.execute({ data, idempotencyKey: "header-key", intakeId: intake.id, payload: governedPayload({ idempotencyKey: "body-key" }), user: user() }),
    { code: "PHYSICAL_EXAM_SPECIALIZED_INTAKE_INVALID", statusCode: 400 }
  );
  assert.throws(
    () => command.execute({ data, idempotencyKey: "header-key", intakeId: intake.id, payload: { action: "assign-profile" }, user: user() }),
    { code: "PHYSICAL_EXAM_SPECIALIZED_INTAKE_EXPECTED_VERSION_REQUIRED", statusCode: 400 }
  );

  const legacy = command.execute({
    data,
    intakeId: intake.id,
    payload: { action: "assign-profile", evidenceRef: "legacy-evidence", targetSystem: "SPECIALIZED", profileId: "legacy-profile" },
    user: user()
  });
  assert.equal(legacy.intake.version, 1);
  assert.equal(Object.hasOwn(intake, RECEIPT_FIELD), false);
});

test("receipt capacity rejects new governed commands without evicting recovery evidence", () => {
  const { calls, data, intake, ports } = createPorts();
  intake[RECEIPT_FIELD] = Array.from({ length: MAX_RECEIPTS }, (_, index) => ({
    commandKeyHash: `old-${index}`,
    requestDigest: `digest-${index}`,
    response: { intake: { id: intake.id } }
  }));
  const command = createPhysicalExaminationSpecializedIntakeActionCommand(ports);
  const payload = governedPayload();
  assert.throws(
    () => command.execute({ data, idempotencyKey: payload.idempotencyKey, intakeId: intake.id, payload, user: user() }),
    { code: "PHYSICAL_EXAM_SPECIALIZED_INTAKE_RECEIPT_CAPACITY_REACHED", statusCode: 409 }
  );
  assert.equal(intake[RECEIPT_FIELD].length, MAX_RECEIPTS);
  assert.deepEqual(calls, []);
});

test("domain and persistence failures never produce an additional write", () => {
  const domainError = Object.assign(new Error("record invalid"), { statusCode: 400 });
  const domain = createPorts({ applyError: domainError });
  const payload = governedPayload();
  assert.throws(
    () => createPhysicalExaminationSpecializedIntakeActionCommand(domain.ports).execute({
      data: domain.data,
      idempotencyKey: payload.idempotencyKey,
      intakeId: domain.intake.id,
      payload,
      user: user()
    }),
    (error) => error === domainError
  );
  assert.deepEqual(domain.calls.map(([name]) => name), ["now", "apply"]);

  const storage = createPorts({ writeError: new Error("write-failed") });
  assert.throws(() => createPhysicalExaminationSpecializedIntakeActionCommand(storage.ports).execute({
    data: storage.data,
    idempotencyKey: payload.idempotencyKey,
    intakeId: storage.intake.id,
    payload,
    user: user()
  }), /write-failed/);
  assert.equal(storage.calls.filter(([name]) => name === "write").length, 1);
});

test("HTTP error projection exposes stable conflict and storage recovery codes", () => {
  assert.deepEqual(
    physicalExaminationSpecializedIntakeHttpError(new Error("SQLite optimistic lock conflict on physicalExamSpecializedIntakes")),
    {
      status: 409,
      body: {
        error: "Conflict",
        code: "PHYSICAL_EXAM_SPECIALIZED_INTAKE_VERSION_CONFLICT",
        message: "resource version changed; refresh and retry"
      }
    }
  );
  assert.equal(
    physicalExaminationSpecializedIntakeHttpError(new Error("disk details")).body.code,
    "PHYSICAL_EXAM_SPECIALIZED_INTAKE_STORAGE_FAILED"
  );
});

test("specialized intake action command fails fast when a required port is absent", () => {
  const { ports } = createPorts();
  delete ports.appendSecurityAuditToState;
  assert.throws(
    () => createPhysicalExaminationSpecializedIntakeActionCommand(ports),
    /appendSecurityAuditToState port must be a function/
  );
});
