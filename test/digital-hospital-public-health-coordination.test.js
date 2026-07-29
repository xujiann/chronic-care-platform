"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  advancePublicHealthIncident,
  buildPublicHealthCoordinationBoard,
  createPublicHealthIncident,
  normalizePublicHealthCoordination,
  seedPublicHealthCoordination
} = require("../digital-hospital-public-health-coordination");

const creator = {
  id: "u-city",
  username: "city",
  name: "市级管理员",
  role: "commission"
};

const reviewer = {
  id: "u-health",
  username: "health",
  name: "卫健委复核员",
  role: "commission"
};

function validIncident(overrides = {}) {
  return {
    id: "PHE-TEST-001",
    laneId: "infectious-reporting",
    title: "测试直报回执超时",
    level: "P0",
    source: "自动监测",
    hospitalCode: "H000001",
    owner: "疾控与医政联络组",
    dueAt: "2026-07-30T12:00:00.000Z",
    note: "已登记并等待责任组核查",
    ...overrides
  };
}

test("migrated public health coordination keeps eight lanes and a closed production gate", () => {
  const state = seedPublicHealthCoordination();
  const normalized = normalizePublicHealthCoordination({
    ...state,
    productionReady: true,
    lanes: [{ id: "infectious-reporting", probe: "失败" }]
  });
  const board = buildPublicHealthCoordinationBoard(normalized);

  assert.equal(normalized.lanes.length, 8);
  assert.equal(normalized.lanes.find((item) => item.id === "infectious-reporting").probe, "失败");
  assert.equal(normalized.productionReady, false);
  assert.equal(normalized.migrationSource.sourceCommit, "4142402e0c79fd8457c00c370b5d163e88cca0e7");
  assert.equal(board.productionBoundary.releaseGate, "site-evidence-and-approval-required");
  assert.equal(board.summary.totalLanes, 8);
});

test("incident creation validates governed lanes and rejects sensitive material", () => {
  assert.throws(
    () => createPublicHealthIncident(seedPublicHealthCoordination(), validIncident({
      id: "PHE-SECRET",
      credential: "must-not-be-persisted"
    }), creator),
    (error) => error.code === "PUBLIC_HEALTH_SENSITIVE_FIELD_REJECTED"
  );
  assert.throws(
    () => createPublicHealthIncident(seedPublicHealthCoordination(), validIncident({
      id: "PHE-LANE",
      laneId: "unknown-lane"
    }), creator),
    (error) => error.code === "PUBLIC_HEALTH_LANE_NOT_FOUND" && error.status === 404
  );

  const result = createPublicHealthIncident(
    seedPublicHealthCoordination(),
    validIncident(),
    creator,
    { now: "2026-07-30T08:00:00.000Z" }
  );

  assert.equal(result.incident.status, "待核查");
  assert.equal(result.incident.revision, 1);
  assert.equal(result.action.actorId, "u-city");
  assert.equal(result.state.incidents[0].id, "PHE-TEST-001");
  assert.equal(result.state.productionReady, false);
});

test("incident lifecycle enforces optimistic revisions and independent close review", () => {
  let state = createPublicHealthIncident(
    seedPublicHealthCoordination(),
    validIncident(),
    creator,
    { now: "2026-07-30T08:00:00.000Z" }
  ).state;

  assert.throws(
    () => advancePublicHealthIncident(state, "PHE-TEST-001", {
      action: "start-handling",
      expectedRevision: 99,
      note: "错误版本不得覆盖"
    }, creator),
    (error) => error.code === "PUBLIC_HEALTH_INCIDENT_REVISION_CONFLICT" && error.status === 409
  );

  let result = advancePublicHealthIncident(state, "PHE-TEST-001", {
    action: "start-handling",
    expectedRevision: 1,
    note: "核查确认异常并开始处置"
  }, creator, { now: "2026-07-30T08:10:00.000Z" });
  state = result.state;
  assert.equal(result.incident.status, "处置中");

  result = advancePublicHealthIncident(state, "PHE-TEST-001", {
    action: "submit-review",
    expectedRevision: 2,
    note: "补传完成并提交独立复核"
  }, creator, { now: "2026-07-30T08:20:00.000Z" });
  state = result.state;
  assert.equal(result.incident.status, "待复核");
  assert.equal(result.incident.submittedForReviewBy, "u-city");

  assert.throws(
    () => advancePublicHealthIncident(state, "PHE-TEST-001", {
      action: "verify-close",
      expectedRevision: 3,
      note: "提交人不得复核自己"
    }, creator),
    (error) => error.code === "PUBLIC_HEALTH_INDEPENDENT_REVIEW_REQUIRED"
  );

  result = advancePublicHealthIncident(state, "PHE-TEST-001", {
    action: "verify-close",
    expectedRevision: 3,
    note: "卫健委独立复核通过并关闭"
  }, reviewer, { now: "2026-07-30T08:30:00.000Z" });

  assert.equal(result.incident.status, "已关闭");
  assert.equal(result.incident.revision, 4);
  assert.equal(result.incident.closedBy, "u-health");
  assert.equal(result.state.productionReady, false);
});

test("terminal incidents and invalid transition actions fail closed", () => {
  const state = seedPublicHealthCoordination();
  const pending = state.incidents.find((item) => item.status === "待核查");
  const closed = state.incidents.find((item) => item.status === "已关闭");

  assert.throws(
    () => advancePublicHealthIncident(state, pending.id, {
      action: "verify-close",
      expectedRevision: pending.revision,
      note: "不得跳过处置阶段"
    }, reviewer),
    (error) => error.code === "PUBLIC_HEALTH_INCIDENT_ACTION_INVALID"
  );
  assert.throws(
    () => advancePublicHealthIncident(state, closed.id, {
      action: "verify-close",
      expectedRevision: closed.revision,
      note: "终态不得重复关闭"
    }, reviewer),
    (error) => error.code === "PUBLIC_HEALTH_INCIDENT_TERMINAL"
  );
});
