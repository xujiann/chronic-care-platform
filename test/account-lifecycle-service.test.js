"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const Service = require("../src/identity-security/account-lifecycle-service");
const Route = require("../src/http/routes/identity-security/account-lifecycle");

const requester = { id: "manager-a", username: "manager_a", name: "申请管理员", role: "commission", accountType: "manager" };
const reviewer = { id: "manager-b", username: "manager_b", name: "复核管理员", role: "commission", accountType: "manager" };
function seed() {
  return { authUsers: [
    { id: "manager-a", username: "manager_a", name: "申请管理员", role: "commission", accountType: "manager", status: "启用" },
    { id: "manager-b", username: "manager_b", name: "复核管理员", role: "commission", accountType: "manager", status: "启用" },
    { id: "doctor-1", username: "doctor", name: "示范医生", role: "institution", accountType: "doctor", orgCode: "ORG-1", status: "启用" }
  ] };
}

test("only commission manager accounts may manage lifecycle", () => {
  assert.throws(() => Service.listCenter(seed(), { role: "commission", accountType: "reviewer", id: "reviewer" }), (error) => error.code === "ACCOUNT_LIFECYCLE_ROLE_DENIED" && error.statusCode === 403);
  assert.equal(Service.listCenter(seed(), requester).summary.accounts, 3);
});

test("request creation checks conflicts, versions and idempotency", () => {
  const input = { type: "disable", accountId: "doctor-1", reason: "岗位离任申请停用账号", expectedVersion: 0 };
  const first = Service.createRequest(seed(), input, requester, { idempotencyKey: "disable-doctor", randomUUID: () => "request-1", now: "2026-09-03T00:00:00.000Z" });
  assert.equal(first.request.id, "alr-request-1");
  assert.equal(first.request.status, "pending-review");
  const replay = Service.createRequest(first.state, input, requester, { idempotencyKey: "disable-doctor" });
  assert.equal(replay.replayed, true);
  assert.throws(() => Service.createRequest(first.state, { ...input, reason: "岗位调整后申请停用账号" }, requester, { idempotencyKey: "disable-doctor" }), (error) => error.code === "ACCOUNT_LIFECYCLE_IDEMPOTENCY_CONFLICT");
  assert.throws(() => Service.createRequest(first.state, { ...input, expectedVersion: 0 }, requester, { idempotencyKey: "disable-stale" }), (error) => error.code === "ACCOUNT_LIFECYCLE_VERSION_CONFLICT");
});

test("independent reviewer applies disable while self review is forbidden", () => {
  const created = Service.createRequest(seed(), { type: "disable", accountId: "doctor-1", reason: "岗位离任申请停用账号", expectedVersion: 0 }, requester, { idempotencyKey: "request-disable", randomUUID: () => "request-1" });
  assert.throws(() => Service.reviewRequest(created.state, created.request.id, { decision: "approve", note: "申请材料完整同意停用", expectedVersion: 0 }, requester, { idempotencyKey: "self-review" }), (error) => error.code === "ACCOUNT_LIFECYCLE_SELF_REVIEW_DENIED");
  const reviewed = Service.reviewRequest(created.state, created.request.id, { decision: "approve", note: "申请材料完整同意停用", expectedVersion: 0 }, reviewer, { idempotencyKey: "review-disable" });
  assert.equal(reviewed.request.status, "applied");
  assert.equal(reviewed.state.authUsers.find((item) => item.id === "doctor-1").status, "停用");
});

test("temporary grants activate only after review and expire by time", () => {
  const input = { type: "temporary-grant", accountId: "doctor-1", permissions: ["record.quality.review"], validFrom: "2026-09-03T00:00:00.000Z", validUntil: "2026-09-04T00:00:00.000Z", reason: "临时参加病历质量核验", expectedVersion: 0 };
  const created = Service.createRequest(seed(), input, requester, { idempotencyKey: "temp-create", randomUUID: () => "temp-request", now: "2026-09-03T00:00:00.000Z" });
  assert.deepEqual(Service.activeTemporaryPermissions(created.state, "doctor-1", "2026-09-03T12:00:00.000Z"), []);
  const reviewed = Service.reviewRequest(created.state, created.request.id, { decision: "approve", note: "范围与期限合理同意授权", expectedVersion: 0 }, reviewer, { idempotencyKey: "temp-review", randomUUID: () => "grant-1", now: "2026-09-03T00:10:00.000Z" });
  assert.deepEqual(Service.activeTemporaryPermissions(reviewed.state, "doctor-1", "2026-09-03T12:00:00.000Z"), ["record.quality.review"]);
  assert.deepEqual(Service.activeTemporaryPermissions(reviewed.state, "doctor-1", "2026-09-05T00:00:00.000Z"), []);
  assert.equal(Service.listCenter(reviewed.state, reviewer, { now: "2026-09-05T00:00:00.000Z" }).temporaryGrants[0].status, "expired");
});

test("duty conflicts and last manager protection fail closed", () => {
  const duty = Service.checkConflicts(seed(), { type: "temporary-grant", accountId: "doctor-1", permissions: ["payment.submit", "payment.review"], validFrom: "2026-09-03T00:00:00.000Z", validUntil: "2026-09-04T00:00:00.000Z", reason: "临时授权职责范围复核" }, requester, { now: "2026-09-02T00:00:00.000Z" });
  assert.ok(duty.some((item) => item.code === "ACCOUNT_LIFECYCLE_DUTY_CONFLICT"));
  const oneManager = seed(); oneManager.authUsers = oneManager.authUsers.filter((item) => item.id !== "manager-b");
  const last = Service.checkConflicts(oneManager, { type: "disable", accountId: "manager-a", reason: "申请停用最后管理账号" }, reviewer);
  assert.ok(last.some((item) => item.code === "ACCOUNT_LIFECYCLE_LAST_MANAGER_DENIED"));
});

test("account lifecycle route fails writes closed without sensitive mutation guard", async () => {
  const responses = [];
  const runtime = {
    collectJson: async () => ({ type: "disable", accountId: "doctor-1", reason: "岗位离任申请停用账号", expectedVersion: 0 }),
    readDatabase: seed,
    requireApiRole: () => requester,
    sendJson: (_res, status, body) => responses.push({ status, body }),
    writeDatabase: () => { throw new Error("write must not run"); }
  };
  const handled = await Route.createRouteSegment(runtime).handle({ method: "POST", headers: {} }, {}, new URL("http://local/api/auth/account-lifecycle-requests"));
  assert.equal(handled, true);
  assert.equal(responses[0].status, 503);
  assert.equal(responses[0].body.code, "ACCOUNT_LIFECYCLE_MUTATION_GUARD_UNAVAILABLE");
});
