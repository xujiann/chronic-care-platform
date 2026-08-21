"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  INBOX_COLLECTION,
  OUTBOX_COLLECTION,
  createReferralCommandService
} = require("../src/care-coordination/referral-command-service");
const { createRouteSegments } = require("../src/http/routes/care-coordination");

const ROOT = path.resolve(__dirname, "..");

function fixture() {
  return {
    residents: [{ id: "r1", organization: "青泥洼桥社区卫生服务中心" }],
    medicalResources: [
      { id: "mr1", institution: "大连市中心医院", region: "市级" },
      { id: "mr3", institution: "青泥洼桥社区卫生服务中心", region: "中山区" }
    ],
    referralSystem: {
      referrals: [{
        id: "rf1",
        residentId: "r1",
        type: "上转",
        from: "青泥洼桥社区卫生服务中心",
        to: "大连市中心医院 · 心内科",
        status: "待接诊",
        priority: "高",
        version: 1,
        lastUpdated: "2026-08-21T08:00:00.000Z"
      }],
      referralOutbox: [],
      referralCommandInbox: []
    },
    taskMessages: []
  };
}

function institution(overrides = {}) {
  return {
    id: "u-hospital",
    username: "hospital",
    name: "医疗机构管理员",
    role: "institution",
    orgCode: "MR1",
    orgName: "大连市中心医院",
    orgType: "medical_institution",
    ...overrides
  };
}

test("owner command authorizes actor and organization before inbox replay or CAS", async () => {
  let state = fixture();
  const service = createReferralCommandService({
    readState: () => state,
    writeState: (next) => { state = next; },
    canAccessResident: () => true,
    now: () => "2026-08-21T09:00:00.000Z"
  });
  const command = {
    referralId: "rf1",
    commandId: "ref-owner-command-001",
    expectedVersion: 1,
    source: "workflow",
    actor: institution(),
    input: { status: "已接诊" }
  };

  const first = await service.update(command);
  assert.equal(first.referral.version, 2);

  await assert.rejects(
    () => service.update({
      ...command,
      actor: institution({ id: "u-other", username: "other", orgCode: "MR9", orgName: "域外医院" })
    }),
    (error) => error.code === "REFERRAL_SCOPE_DENIED" && error.statusCode === 403
  );
  assert.equal(state.referralSystem[INBOX_COLLECTION].length, 1);
  assert.equal(state.referralSystem[OUTBOX_COLLECTION].length, 1);

  await assert.rejects(
    () => service.update({
      ...command,
      commandId: "ref-owner-command-source-cannot-accept",
      actor: institution({ id: "u-source", username: "source", orgCode: "MR3", orgName: "青泥洼桥社区卫生服务中心" })
    }),
    (error) => error.code === "REFERRAL_ACTION_SCOPE_DENIED" && error.statusCode === 403
  );

  await assert.rejects(
    () => service.update({
      ...command,
      commandId: "ref-owner-command-stale",
      expectedVersion: 1,
      actor: institution()
    }),
    (error) => error.code === "REFERRAL_VERSION_CONFLICT" && error.statusCode === 409
  );
});

test("owner command enforces citizen family scope and action-specific allowlists", async () => {
  let state = fixture();
  let residentAllowed = true;
  const service = createReferralCommandService({
    readState: () => state,
    writeState: (next) => { state = next; },
    canAccessResident: () => residentAllowed,
    now: () => "2026-08-21T09:10:00.000Z"
  });
  const actor = { id: "u-citizen", username: "citizen", name: "演示居民A", role: "citizen", residentId: "r1" };

  await assert.rejects(
    () => service.update({
      referralId: "rf1",
      commandId: "ref-citizen-direct",
      expectedVersion: 1,
      source: "direct",
      actor,
      input: { status: "已接诊" }
    }),
    (error) => error.code === "REFERRAL_ACTION_DENIED" && error.statusCode === 403
  );

  await assert.rejects(
    () => service.update({
      referralId: "rf1",
      commandId: "ref-citizen-bad-action",
      expectedVersion: 1,
      source: "task",
      actor,
      input: { action: "quality-feedback", comment: "不属于转诊动作" }
    }),
    (error) => error.code === "REFERRAL_ACTION_DENIED" && error.statusCode === 403
  );

  residentAllowed = false;
  await assert.rejects(
    () => service.update({
      referralId: "rf1",
      commandId: "ref-citizen-no-family-scope",
      expectedVersion: 1,
      source: "task",
      actor,
      input: { action: "resident-confirm", comment: "确认" }
    }),
    (error) => error.code === "REFERRAL_SCOPE_DENIED" && error.statusCode === 403
  );

  residentAllowed = true;
  const result = await service.update({
    referralId: "rf1",
    commandId: "ref-citizen-confirm",
    expectedVersion: 1,
    source: "task",
    actor,
    input: { action: "resident-confirm", comment: "居民端确认服务安排" }
  });
  assert.equal(result.referral.residentConfirmation, "confirmed");
  assert.equal(result.referral.taskAction, "resident-confirm");
  assert.equal(result.referral.version, 2);
});

test("owner command rejects overlong identity, scope, idempotency, and patch fields without truncation", async () => {
  let state = fixture();
  const service = createReferralCommandService({
    readState: () => state,
    writeState: (next) => { state = next; },
    canAccessResident: () => true
  });
  const base = {
    referralId: "rf1",
    commandId: "bounded-command",
    expectedVersion: 1,
    source: "workflow",
    actor: institution(),
    input: { status: "已接诊" }
  };
  const cases = [
    [{ ...base, commandId: "c".repeat(161) }, "REFERRAL_COMMAND_ID_TOO_LONG"],
    [{ ...base, actor: institution({ id: "a".repeat(121) }) }, "REFERRAL_ACTOR_ID_TOO_LONG"],
    [{ ...base, actor: institution({ orgName: "机".repeat(201) }) }, "REFERRAL_ACTOR_ORG_TOO_LONG"],
    [{ ...base, input: { reason: "说".repeat(1001) } }, "REFERRAL_PATCH_FIELD_TOO_LONG"]
  ];
  for (const [command, code] of cases) {
    await assert.rejects(() => service.update(command), (error) => error.code === code);
  }
  assert.equal(state.referralSystem[INBOX_COLLECTION].length, 0);
});

test("owner command rejects a missing actor and ambiguous organization substrings before inbox lookup", async () => {
  let state = fixture();
  const service = createReferralCommandService({
    readState: () => state,
    writeState: (next) => { state = next; },
    canAccessResident: () => true
  });
  const base = {
    referralId: "rf1",
    expectedVersion: 1,
    source: "workflow",
    input: { status: "已接诊" }
  };
  await assert.rejects(
    () => service.update({ ...base, commandId: "ref-missing-actor" }),
    (error) => error.code === "REFERRAL_ACTOR_REQUIRED" && error.statusCode === 403
  );
  await assert.rejects(
    () => service.update({
      ...base,
      commandId: "ref-ambiguous-org",
      actor: institution({ orgCode: "", orgName: "中心医院" })
    }),
    (error) => error.code === "REFERRAL_SCOPE_DENIED" && error.statusCode === 403
  );
  assert.equal(state.referralSystem[INBOX_COLLECTION].length, 0);
});

function routeRuntime({ payload, user }) {
  let state = fixture();
  const responses = [];
  const runtime = {
    WORKFLOW_COLLECTIONS: new Set(["referrals"]),
    WORKFLOW_ROLE_COLLECTIONS: {
      institution: new Set(["referrals"]),
      citizen: new Set(["referrals"]),
      commission: new Set(["referrals"])
    },
    appendSecurityEvent: () => undefined,
    buildCitizenTaskActionMessage: (item, collection, command, actor) => ({
      id: "message-1", sourceId: item.id, collection, residentId: item.residentId,
      createdBy: actor.username, action: command.action
    }),
    canAccessResident: () => true,
    collectJson: async () => payload,
    readDatabase: () => state,
    requireApiRole: () => user,
    sendJson: (res, status, body) => {
      responses.push({ status, body });
      res.statusCode = status;
      res.body = body;
    },
    writeDatabase: (next) => { state = next; }
  };
  return { runtime, responses, state: () => state };
}

async function dispatch(runtime, req, pathname) {
  const url = new URL(`http://localhost${pathname}`);
  const res = {};
  for (const segment of createRouteSegments(runtime)) {
    if (await segment.handle(req, res, url)) return res;
  }
  throw new Error(`unhandled route ${pathname}`);
}

test("three public referral action paths delegate to one inbox/outbox command track and preserve response shapes", async () => {
  const scenarios = [
    {
      pathname: "/api/referrals/rf1/actions",
      user: institution(),
      payload: { expectedVersion: 1, status: "已接诊" },
      assertShape: (body) => assert.equal(body.referral.id, "rf1")
    },
    {
      pathname: "/api/workflow-actions",
      user: institution(),
      payload: { collection: "referrals", id: "rf1", expectedVersion: 1, status: "已接诊", updates: {} },
      assertShape: (body) => assert.equal(body.id, "rf1")
    },
    {
      pathname: "/api/tasks/referrals%3Arf1/actions",
      user: { id: "u-citizen", username: "citizen", name: "演示居民A", role: "citizen", residentId: "r1" },
      payload: { action: "resident-confirm", comment: "居民端确认服务安排", expectedVersion: 1 },
      assertShape: (body) => assert.equal(body.taskAction, "resident-confirm")
    }
  ];
  for (const [index, scenario] of scenarios.entries()) {
    const holder = routeRuntime(scenario);
    const res = await dispatch(holder.runtime, {
      method: "POST",
      correlationId: `trace-${index}`,
      headers: { "idempotency-key": `ref-path-${index}` }
    }, scenario.pathname);
    assert.equal(res.statusCode, 200);
    scenario.assertShape(res.body);
    assert.equal(holder.state().referralSystem.referrals[0].version, 2);
    assert.equal(holder.state().referralSystem[INBOX_COLLECTION].length, 1);
    assert.equal(holder.state().referralSystem[OUTBOX_COLLECTION].length, 1);
  }
});

test("T05 route and browser callers are guarded against bypassing the owner command", () => {
  const route = fs.readFileSync(path.join(ROOT, "src", "http", "routes", "care-coordination.js"), "utf8");
  const owner = fs.readFileSync(path.join(ROOT, "src", "care-coordination", "referral-command-service.js"), "utf8");
  const shared = fs.readFileSync(path.join(ROOT, "shared.js"), "utf8");
  const citizen = fs.readFileSync(path.join(ROOT, "citizen.js"), "utf8");
  assert.doesNotMatch(route, /require\(["'](?:\.\.\/)+server["']\)/);
  assert.doesNotMatch(owner, /require\(["']\.\.\/(?:clinical-specialties|insurance-payment|public-health)\//);
  assert.match(route, /executeReferralCommand/);
  assert.match(shared, /Idempotency-Key/);
  assert.match(shared, /expectedVersion/);
  assert.match(citizen, /Idempotency-Key/);
  assert.match(citizen, /expectedVersion/);
});
