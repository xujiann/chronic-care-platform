"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const core = require("../unified-work-center-core");

const ROOT = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(ROOT, name), "utf8");

test("unified tasks normalize SLA, safe deep links and filters", () => {
  const tasks = [
    core.normalizeTask({ id: "referrals:r1", collection: "referrals", title: "转诊接诊", status: "pending", dueAt: "2026-01-01T00:00:00.000Z" }, Date.parse("2026-01-02T00:00:00.000Z")),
    core.normalizeTask({ id: "insuranceClaims:i1", collection: "insuranceClaims", title: "结算复核", status: "completed", dueAt: "2026-01-01T00:00:00.000Z" }, Date.parse("2026-01-02T00:00:00.000Z"))
  ];
  assert.equal(tasks[0].overdue, true);
  assert.equal(tasks[0].deepLink, "referral-teleconsultation-about.html");
  assert.equal(tasks[1].overdue, false);
  assert.deepEqual(core.filterTasks(tasks, { keyword: "转诊", sla: "overdue" }).map((item) => item.id), ["referrals:r1"]);
  assert.deepEqual(core.summarize(tasks, [{ status: "sent" }]), { total: 2, pending: 1, overdue: 1, unassigned: 2, unread: 1 });
});

test("task actions require structured fields and never infer a successful write", () => {
  assert.throws(() => core.buildActionPayload("transfer", {}), /接收人/);
  assert.throws(() => core.buildActionPayload("return", { comment: "" }), /处理说明/);
  assert.deepEqual(core.buildActionPayload("claim", {}), { kind: "action", action: "claim", status: "processing", comment: "", assignee: "" });
  assert.equal(core.buildActionPayload("remind", { comment: "请及时处理" }).kind, "message");
});

test("batch execution retains per-task failures instead of presenting total success", async () => {
  const calls = [];
  const executor = { async act(taskId) { calls.push(taskId); if (taskId === "bad") throw new Error("服务端拒绝"); return { id: taskId }; }, async sendMessage() {} };
  const result = await core.runBatch(["ok", "bad"], "claim", {}, executor);
  assert.deepEqual(calls, ["ok", "bad"]);
  assert.equal(result.succeeded, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.results[1].error, "服务端拒绝");
});

test("unified work center uses shared auth and safe DOM rendering", () => {
  const html = read("unified-work-center.html");
  const source = read("unified-work-center.js");
  assert.ok(html.indexOf("access-control-policy.js") < html.indexOf("auth.js"));
  assert.match(html, /page-auth-bootstrap\.js" data-roles="commission,institution,insurance,county"/);
  assert.match(html, /统一待办与消息中心/);
  assert.match(source, /createElement/);
  assert.match(source, /replaceChildren/);
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|window\.prompt|\.style\s*=/);
  assert.match(source, /页面没有修改本地任务状态/);
});
