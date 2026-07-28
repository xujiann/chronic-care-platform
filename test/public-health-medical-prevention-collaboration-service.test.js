"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  applyPublicHealthMedicalPreventionTaskActionToState,
  buildPublicHealthMedicalPreventionBoard,
  createPublicHealthMedicalPreventionTasks,
  ensurePublicHealthMedicalPreventionTasks
} = require("../public-health-medical-prevention-collaboration-service");

function verifiedAlert() {
  return {
    id: "ph-alert-medprev-001",
    status: "verified",
    severity: "high",
    regionCode: "210202",
    signalIds: ["ph-signal-001"],
    productionReady: false
  };
}

function dispatchPayload() {
  return {
    medicalInstitutionId: "medical-institution-001",
    primaryCareOrganizationId: "primary-care-organization-001",
    dueAt: "2026-07-29T08:00:00.000Z",
    idempotencyKey: "alert-medprev-dispatch-001"
  };
}

function advanceAcceptedTask(data, task, user, prefix) {
  let result = applyPublicHealthMedicalPreventionTaskActionToState(data, task.id, {
    action: "accept-task",
    idempotencyKey: `${prefix}:accept`,
    expectedVersion: 1,
    assignedTo: `${prefix}-owner`,
    note: "责任人员接单"
  }, user);
  result = applyPublicHealthMedicalPreventionTaskActionToState(result.nextData, task.id, {
    action: "start-task",
    idempotencyKey: `${prefix}:start`,
    expectedVersion: 2,
    note: "开始核对来源和处置要求"
  }, user);
  result = applyPublicHealthMedicalPreventionTaskActionToState(result.nextData, task.id, {
    action: "record-task-receipt",
    idempotencyKey: `${prefix}:receipt`,
    expectedVersion: 3,
    receiptStatus: "accepted",
    receiptCode: `${prefix.toUpperCase()}-RECEIPT`,
    evidenceRefs: [`${prefix}-receipt-evidence`]
  }, { name: "可信适配器", role: "system" });
  return applyPublicHealthMedicalPreventionTaskActionToState(result.nextData, task.id, {
    action: "close-task",
    idempotencyKey: `${prefix}:close`,
    expectedVersion: 4,
    conclusion: "业务核实和回执登记完成",
    evidenceRefs: task.requiredEvidence
  }, user);
}

test("verified alert creates one medical and one primary-care collaboration task", () => {
  const tasks = createPublicHealthMedicalPreventionTasks(verifiedAlert(), dispatchPayload(), {
    at: "2026-07-28T09:00:00.000Z",
    actor: "疾控值班员",
    role: "cdc-surveillance"
  });
  assert.equal(tasks.length, 2);
  assert.deepEqual(tasks.map((item) => item.ownerRole).sort(), [
    "medical-public-health",
    "primary-care-public-health"
  ]);
  assert.equal(tasks.every((item) => item.state === "pending" && item.productionReady === false), true);
  const ensured = ensurePublicHealthMedicalPreventionTasks(
    { publicHealthMedicalPreventionTasks: tasks },
    verifiedAlert(),
    dispatchPayload()
  );
  assert.equal(ensured.tasks.length, 2);
  assert.equal(ensured.created.length, 0);
});

test("medical and primary-care tasks close with role evidence version and audit controls", () => {
  const tasks = createPublicHealthMedicalPreventionTasks(verifiedAlert(), dispatchPayload());
  let data = {
    publicHealthSurveillanceAlerts: [verifiedAlert()],
    publicHealthMedicalPreventionTasks: tasks
  };
  const medicalTask = tasks.find((item) => item.ownerRole === "medical-public-health");
  const primaryTask = tasks.find((item) => item.ownerRole === "primary-care-public-health");
  let result = advanceAcceptedTask(data, medicalTask, {
    name: "医院公共卫生科",
    role: "medical-public-health"
  }, "medical");
  result = advanceAcceptedTask(result.nextData, primaryTask, {
    name: "基层公卫专干",
    role: "primary-care-public-health"
  }, "primary");
  const board = buildPublicHealthMedicalPreventionBoard({
    data: result.nextData,
    alerts: [verifiedAlert()]
  });
  assert.equal(board.ok, true);
  assert.equal(board.summary.tasks, 2);
  assert.equal(board.summary.closedTasks, 2);
  assert.equal(board.summary.representedRoles, 2);
  assert.equal(result.nextData.publicHealthMedicalPreventionAudit.length, 8);
  assert.equal(board.productionReady, false);
});

test("rejected collaboration receipt opens an assigned exception and supports controlled retry", () => {
  const task = createPublicHealthMedicalPreventionTasks(verifiedAlert(), dispatchPayload())[0];
  let data = { publicHealthMedicalPreventionTasks: [task] };
  const user = { name: "医院公共卫生科", role: "medical-public-health" };
  let result = applyPublicHealthMedicalPreventionTaskActionToState(data, task.id, {
    action: "accept-task",
    idempotencyKey: "reject:accept",
    expectedVersion: 1,
    assignedTo: "医院公卫责任人",
    note: "接单"
  }, user);
  result = applyPublicHealthMedicalPreventionTaskActionToState(result.nextData, task.id, {
    action: "start-task",
    idempotencyKey: "reject:start",
    expectedVersion: 2,
    note: "开始核查"
  }, user);
  result = applyPublicHealthMedicalPreventionTaskActionToState(result.nextData, task.id, {
    action: "record-task-receipt",
    idempotencyKey: "reject:receipt",
    expectedVersion: 3,
    receiptStatus: "rejected",
    receiptCode: "MEDICAL-REJECT-001",
    evidenceRefs: ["rejection-evidence"],
    reason: "来源记录缺少必要复核",
    exceptionOwner: "医院信息科",
    exceptionDueAt: "2026-07-30T08:00:00.000Z"
  }, { name: "可信适配器", role: "system" });
  assert.equal(result.task.state, "exception-open");
  assert.equal(result.task.exception.owner, "医院信息科");
  result = applyPublicHealthMedicalPreventionTaskActionToState(result.nextData, task.id, {
    action: "retry-task",
    idempotencyKey: "reject:retry",
    expectedVersion: 4,
    note: "来源记录已补正"
  }, user);
  assert.equal(result.task.state, "in-progress");
  assert.equal(result.task.exception.status, "retry-submitted");
  assert.equal(result.productionReady, false);
});

test("collaboration actions reject unauthorized roles versions and incomplete closure evidence", () => {
  const task = createPublicHealthMedicalPreventionTasks(verifiedAlert(), dispatchPayload())[0];
  const data = { publicHealthMedicalPreventionTasks: [task] };
  assert.throws(() => applyPublicHealthMedicalPreventionTaskActionToState(data, task.id, {
    action: "accept-task",
    idempotencyKey: "unauthorized",
    assignedTo: "居民",
    note: "越权"
  }, { name: "居民", role: "resident" }), /not allowed/);
  assert.throws(() => applyPublicHealthMedicalPreventionTaskActionToState(data, task.id, {
    action: "accept-task",
    idempotencyKey: "wrong-version",
    expectedVersion: 99,
    assignedTo: "医院公卫责任人",
    note: "版本错误"
  }, { name: "医院公共卫生科", role: "medical-public-health" }), /version conflict/);

  const accepted = applyPublicHealthMedicalPreventionTaskActionToState(data, task.id, {
    action: "accept-task",
    idempotencyKey: "bound-idempotency-key",
    expectedVersion: 1,
    assignedTo: "医院公卫责任人",
    note: "接单"
  }, { name: "医院公共卫生科", role: "medical-public-health" });
  const replay = applyPublicHealthMedicalPreventionTaskActionToState(accepted.nextData, task.id, {
    action: "accept-task",
    idempotencyKey: "bound-idempotency-key",
    expectedVersion: 1,
    assignedTo: "医院公卫责任人",
    note: "接单"
  }, { name: "医院公共卫生科", role: "medical-public-health" });
  assert.equal(replay.idempotent, true);
  assert.throws(() => applyPublicHealthMedicalPreventionTaskActionToState(accepted.nextData, task.id, {
    action: "accept-task",
    idempotencyKey: "bound-idempotency-key",
    expectedVersion: 1,
    assignedTo: "伪造责任人",
    note: "接单"
  }, { name: "医院公共卫生科", role: "medical-public-health" }), /payload conflict/);
});

test("collaboration workflow fails closed after persisted ownership or timeline tampering", () => {
  const task = createPublicHealthMedicalPreventionTasks(verifiedAlert(), dispatchPayload())[0];
  const ownershipTampered = JSON.parse(JSON.stringify(task));
  ownershipTampered.ownerOrganizationId = "";
  const ownershipData = { publicHealthMedicalPreventionTasks: [ownershipTampered] };
  assert.throws(() => applyPublicHealthMedicalPreventionTaskActionToState(
    ownershipData,
    ownershipTampered.id,
    {
      action: "accept-task",
      idempotencyKey: "tampered-owner-accept",
      expectedVersion: 1,
      assignedTo: "医院公卫责任人",
      note: "尝试接单"
    },
    { name: "医院公共卫生科", role: "medical-public-health" }
  ), /task integrity invalid: task-owner-binding-invalid/);
  let board = buildPublicHealthMedicalPreventionBoard({
    data: ownershipData,
    alerts: [verifiedAlert()]
  });
  assert.equal(board.ok, false);
  assert.equal(board.integrityFindings.some((item) => item.code === "task-owner-binding-invalid"), true);

  const timelineTampered = JSON.parse(JSON.stringify(task));
  timelineTampered.timeline[0].to = "closed";
  const timelineData = { publicHealthMedicalPreventionTasks: [timelineTampered] };
  board = buildPublicHealthMedicalPreventionBoard({
    data: timelineData,
    alerts: [verifiedAlert()]
  });
  assert.equal(board.ok, false);
  assert.equal(board.integrityFindings.some((item) => item.code === "task-dispatch-history-invalid"), true);
  assert.equal(board.productionReady, false);
});
