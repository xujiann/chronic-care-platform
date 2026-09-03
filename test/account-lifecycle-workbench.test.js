"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const core = require("../account-lifecycle-core");

const ROOT = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(ROOT, name), "utf8");

test("account request validation covers duplicate, temporary grant and separation conflicts", () => {
  const accounts = [{ id: "u1", username: "doctor" }];
  const duplicate = core.checkConflicts({ type: "open", username: "doctor", reason: "新账号申请业务原因说明" }, accounts, { id: "admin" });
  assert.ok(duplicate.some((item) => item.code === "DUPLICATE_USERNAME"));
  const temporary = core.checkConflicts({ type: "temporaryGrant", accountId: "u1", permissions: "payment.submit,payment.review", validFrom: "2026-09-02", validUntil: "2026-09-01", reason: "临时授权申请业务原因说明" }, accounts, { id: "admin" });
  assert.ok(temporary.some((item) => item.code === "INVALID_VALIDITY"));
  assert.ok(temporary.some((item) => item.code === "SEGREGATION_OF_DUTIES"));
});

test("valid requests are normalized and independent review forbids self approval", () => {
  const request = core.buildRequest({ type: "change", accountId: "u1", username: "doctor", role: "institution", orgCode: "ORG-DEMO", permissions: "record.read, record.read", reason: "岗位调整后需要变更数据范围" }, { id: "admin-a", name: "申请管理员" }, []);
  assert.deepEqual(request.permissions, ["record.read"]);
  assert.equal(request.requestedAction, "账号变更");
  assert.equal(core.canReview({ ...request, status: "pending-review" }, { id: "admin-a" }).allowed, false);
  assert.equal(core.canReview({ ...request, status: "pending-review" }, { id: "admin-b" }).allowed, true);
});

test("account lifecycle client surfaces rejected writes", async () => {
  const client = core.createClient({ fetchImpl: async () => ({ ok: false, status: 409, json: async () => ({ message: "双人复核冲突" }) }) });
  await assert.rejects(() => client.submit({ type: "open" }), /双人复核冲突/);
});

test("account lifecycle workbench contains full lifecycle forms and safe rendering", () => {
  const html = read("account-lifecycle.html");
  const source = read("account-lifecycle.js");
  assert.ok(html.indexOf("access-control-policy.js") < html.indexOf("auth.js"));
  assert.match(html, /page-auth-bootstrap\.js" data-roles="commission"/);
  for (const label of ["账号开通", "账号变更", "账号停用", "账号恢复", "临时授权", "独立复核", "审批时间线", "冲突检查"]) assert.match(html, new RegExp(label));
  assert.match(source, /identity-directory\/preview|directoryPreview/);
  assert.match(source, /服务端没有返回成功回执/);
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|window\.prompt|\.style\s*=/);
});
