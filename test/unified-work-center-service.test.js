"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const Service = require("../src/work-center/unified-work-center-service");
const Route = require("../src/http/routes/care-coordination/unified-work-center");

const institution = { id: "u-hospital", username: "hospital", name: "医院管理员", role: "institution", orgCode: "ORG-1" };
const commission = { id: "u-health", username: "health", name: "平台管理员", role: "commission", orgCode: "ADMIN" };
const tasks = [{ id: "referrals:r1", collection: "referrals", sourceId: "r1", title: "转诊接诊", role: "institution", residentId: "resident-1", status: "pending", overdue: false }];
const buildUnifiedTasks = (_state, user) => user.orgCode === "ORG-2" ? [] : structuredClone(tasks);
const canAccessTaskMessage = (user, message) => user.role === "commission" || message.targetRole === user.role;

test("work center aggregates only scope-filtered tasks and messages", () => {
  const state = { taskMessages: [{ id: "m1", targetRole: "institution", status: "sent" }, { id: "m2", targetRole: "insurance", status: "sent" }] };
  const center = Service.buildCenter(state, institution, { buildUnifiedTasks, canAccessTaskMessage });
  assert.deepEqual(center.tasks.map((item) => item.id), ["referrals:r1"]);
  assert.deepEqual(center.messages.map((item) => item.id), ["m1"]);
  assert.equal(center.summary.unread, 1);
  assert.equal(Service.buildCenter(state, { ...institution, orgCode: "ORG-2" }, { buildUnifiedTasks, canAccessTaskMessage }).tasks.length, 0);
});

test("task actions require expected version and idempotency and fail stale writes closed", () => {
  const options = { buildUnifiedTasks, canAccessTaskMessage, idempotencyKey: "claim-r1", now: "2026-09-03T00:00:00.000Z" };
  const first = Service.executeTaskAction({}, "referrals:r1", { action: "claim", expectedVersion: 0 }, institution, options);
  assert.equal(first.task.status, "processing");
  assert.equal(first.task.workCenterVersion, 1);
  const replay = Service.executeTaskAction(first.state, "referrals:r1", { action: "claim", expectedVersion: 0 }, institution, options);
  assert.equal(replay.replayed, true);
  assert.throws(() => Service.executeTaskAction(first.state, "referrals:r1", { action: "claim", expectedVersion: 0 }, institution, { ...options, idempotencyKey: "stale-command" }), (error) => error.code === "WORK_CENTER_VERSION_CONFLICT" && error.statusCode === 409);
  assert.throws(() => Service.executeTaskAction({}, "referrals:r1", { action: "claim", expectedVersion: 0 }, institution, { ...options, idempotencyKey: "" }), (error) => error.code === "WORK_CENTER_IDEMPOTENCY_KEY_REQUIRED");
});

test("transfer and management actions cannot expand task role or organization scope", () => {
  const options = { buildUnifiedTasks, canAccessTaskMessage, idempotencyKey: "transfer-r1" };
  assert.throws(() => Service.executeTaskAction({}, "referrals:r1", { action: "transfer", expectedVersion: 0, targetAssignee: "other", targetRole: "insurance", targetOrgCode: "ORG-2" }, institution, options), (error) => error.code === "WORK_CENTER_TRANSFER_ROLE_EXPANSION_DENIED");
  assert.throws(() => Service.executeTaskAction({}, "referrals:r1", { action: "complete", expectedVersion: 0, comment: "管理端代办" }, commission, { ...options, idempotencyKey: "commission-complete" }), (error) => error.code === "WORK_CENTER_ACTION_SCOPE_DENIED");
});

test("task messages and receipts are versioned, scoped and idempotent", () => {
  const sent = Service.sendTaskMessage({}, "referrals:r1", { expectedVersion: 0, channel: "in_app", targetRole: "institution", body: "请及时处理任务" }, institution, { buildUnifiedTasks, canAccessTaskMessage, idempotencyKey: "message-r1", randomUUID: () => "m1" });
  assert.equal(sent.message.id, "msg-m1");
  const read = Service.acknowledgeMessage(sent.state, "msg-m1", { expectedVersion: 0 }, institution, { canAccessTaskMessage, idempotencyKey: "receipt-m1" });
  assert.equal(read.message.status, "read");
  assert.equal(read.message.workCenterVersion, 1);
  assert.throws(() => Service.acknowledgeMessage(read.state, "msg-m1", { expectedVersion: 0 }, institution, { canAccessTaskMessage, idempotencyKey: "receipt-stale" }), (error) => error.code === "WORK_CENTER_MESSAGE_VERSION_CONFLICT");
});

test("work center route is independently mountable", () => {
  assert.equal(Route.ROUTE_SEGMENT_ID, "work-center-01");
  const runtime = Object.fromEntries(Route.REQUIRED_DEPENDENCIES.map((name) => [name, () => {}]));
  const segment = Route.createRouteSegment(runtime);
  assert.equal(segment.domain, "care-coordination");
  assert.equal(typeof segment.handle, "function");
});
