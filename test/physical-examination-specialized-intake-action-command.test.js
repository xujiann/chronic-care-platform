"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  OWNER,
  USE_CASE,
  createPhysicalExaminationSpecializedIntakeActionCommand
} = require("../src/clinical-specialties/physical-examination/specialized-intake-action-command");

function createPorts({ applyError } = {}) {
  const calls = [];
  const intake = {
    id: "intake-001",
    residentId: "resident-001",
    examProgramName: "高血压专项体检"
  };
  const ports = {
    applySpecializedIntakeAction(data, intakeId, payload, context) {
      calls.push(["apply", data, intakeId, payload, context]);
      if (applyError) throw applyError;
      return intake;
    },
    appendDataAccessLog(...args) {
      calls.push(["access-audit", ...args]);
    },
    appendSecurityEvent(event) {
      calls.push(["security-audit", event]);
    },
    normalizeState(data) {
      calls.push(["normalize", data]);
      return { normalized: data };
    },
    now() {
      calls.push(["now"]);
      return "2026-08-25T01:02:03.000Z";
    },
    writeDatabase(data) {
      calls.push(["write", data]);
    }
  };
  return { calls, intake, ports };
}

test("specialized intake action command publishes a stable owner and versioned use case", () => {
  assert.equal(OWNER, "T06/physical-examination");
  assert.equal(USE_CASE, "physical-examination-specialized-intake-action-command.v1");
});

test("specialized intake action command owns mutation, audit and persistence in legacy order", () => {
  const { calls, intake, ports } = createPorts();
  const command = createPhysicalExaminationSpecializedIntakeActionCommand(ports);
  const data = { physicalExamSpecializedIntakes: [] };
  const payload = { action: "assign-profile", evidenceRef: "evidence-001" };
  const user = { name: "机构操作员", role: "institution", username: "operator-001" };

  assert.equal(command.execute({ data, intakeId: "intake-001", payload, user }), intake);
  assert.deepEqual(calls.map(([name]) => name), [
    "now",
    "apply",
    "access-audit",
    "security-audit",
    "normalize",
    "write"
  ]);
  assert.deepEqual(calls[1].slice(1), [
    data,
    "intake-001",
    payload,
    { actor: "operator-001", now: "2026-08-25T01:02:03.000Z" }
  ]);
  assert.deepEqual(calls[2].slice(1), [
    data,
    user,
    "resident-001",
    "专项体检分流处置",
    "高血压专项体检 · assign-profile"
  ]);
  assert.deepEqual(calls[3][1], {
    actor: "机构操作员",
    role: "institution",
    action: "专项体检分流处置",
    target: "intake-001",
    result: "成功",
    detail: "assign-profile · evidence-001"
  });
  assert.deepEqual(calls[5][1], { normalized: data });
});

test("specialized intake action command propagates domain errors before audit and persistence", () => {
  const domainError = Object.assign(new Error("record missing"), { statusCode: 404 });
  const { calls, ports } = createPorts({ applyError: domainError });
  const command = createPhysicalExaminationSpecializedIntakeActionCommand(ports);

  assert.throws(
    () => command.execute({
      data: {},
      intakeId: "missing",
      payload: {},
      user: { role: "commission" }
    }),
    (error) => error === domainError
  );
  assert.deepEqual(calls.map(([name]) => name), ["now", "apply"]);
});

test("specialized intake action command fails fast when a required port is absent", () => {
  const { ports } = createPorts();
  delete ports.writeDatabase;

  assert.throws(
    () => createPhysicalExaminationSpecializedIntakeActionCommand(ports),
    /writeDatabase port must be a function/
  );
});
