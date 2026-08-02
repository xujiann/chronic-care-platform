const test = require("node:test");
const assert = require("node:assert/strict");

const Core = require("../resident-mini-program-core");
const Adapter = require("../resident-mini-program-adapter");

const NOW = new Date("2026-08-01T08:00:00.000Z");

function message(overrides = {}) {
  return {
    id: "msg-1",
    residentId: "r1",
    targetRole: "citizen",
    collection: "registrationOrders",
    sourceId: "order-1",
    title: "挂号提醒",
    body: "医院已返回排班变更通知",
    status: "sent",
    createdAt: "2026-07-31T08:00:00.000Z",
    ...overrides
  };
}

function linkContext(overrides = {}) {
  return {
    residentId: "r1",
    allowedResidentIds: new Set(["r1"]),
    messages: [Core.projectMessage(message(), "r1", { now: NOW })],
    ...overrides
  };
}

test("deep links accept only explicit pages, parameters and the current resident", () => {
  assert.deepEqual(
    Core.validateDeepLink({ page: "emr", recordId: "record-1", residentId: "r1" }, linkContext()),
    { ok: true, route: "emr", params: { recordId: "record-1" }, reason: "allowed" }
  );
  assert.equal(Core.validateDeepLink("https://evil.example", linkContext()).reason, "unsafe-link");
  assert.equal(Core.validateDeepLink({ page: "javascript:alert", residentId: "r1" }, linkContext()).reason, "unknown-page");
  assert.equal(Core.validateDeepLink({ page: "unknown" }, linkContext()).reason, "unknown-page");
  assert.equal(Core.validateDeepLink({ page: "emr", url: "https://evil.example" }, linkContext()).reason, "unknown-parameter");
  assert.equal(Core.validateDeepLink({ page: "emr", residentId: "r2" }, linkContext()).reason, "cross-resident-parameter");
  assert.equal(Core.validateDeepLink({ page: "emr", recordId: "../r2" }, linkContext()).reason, "unsafe-parameter");
});

test("message deep links cannot cross residents, route mismatches or expired messages", () => {
  const projected = Core.projectMessage(message(), "r1", { now: NOW });
  const allowed = Core.messageDeepLink(projected, linkContext());
  assert.equal(allowed.ok, true);
  assert.equal(allowed.route, "registration");
  assert.deepEqual(allowed.params, { sourceId: "order-1" });

  assert.equal(Core.messageDeepLink(projected, linkContext({ residentId: "r2", allowedResidentIds: new Set(["r2"]) })).reason, "cross-resident-parameter");
  assert.equal(Core.validateDeepLink({ page: "emr", messageId: "msg-1" }, linkContext()).reason, "unknown-parameter");
  const expired = Core.projectMessage(message({ expiresAt: "2026-07-31T00:00:00.000Z" }), "r1", { now: NOW });
  assert.equal(Core.messageDeepLink(expired, linkContext()).reason, "message-unavailable");
});

test("message batches deduplicate stable ids, cap pages and keep unread totals consistent", () => {
  const rows = [
    message(),
    message({ body: "重复消息的旧版本", createdAt: "2026-07-30T08:00:00.000Z" }),
    message({ id: "msg-2", status: "read", createdAt: "2026-07-29T08:00:00.000Z" }),
    message({ id: "msg-3", expiresAt: "2026-07-31T00:00:00.000Z", createdAt: "2026-07-28T08:00:00.000Z" }),
    message({ id: "msg-r2", residentId: "r2" })
  ];
  const first = Core.buildMessageBatch(rows, "r1", { now: NOW, limit: 2 });
  assert.equal(first.total, 3);
  assert.equal(first.items.length, 2);
  assert.equal(first.unreadCount, 1);
  assert.equal(first.expiredCount, 1);
  assert.equal(first.nextCursor, "2");
  assert.equal(first.items[0].body, "医院已返回排班变更通知");

  const second = Core.buildMessageBatch(rows, "r1", { now: NOW, limit: 2, cursor: first.nextCursor });
  assert.equal(second.items.length, 1);
  assert.equal(second.nextCursor, "");
  assert.equal(Core.countUnreadMessages(first.items.concat(second.items), "r1"), 1);
});

test("expired messages and cross-resident rows cannot create read intents", () => {
  const valid = Core.projectMessage(message(), "r1", { now: NOW });
  const intent = Core.messageReadIntent(valid, "r1");
  assert.equal(intent.ok, true);
  assert.equal(intent.idempotencyKey, "resident-message-read-msg-1");
  assert.equal(Core.messageReadIntent(valid, "r2").ok, false);
  const expired = Core.projectMessage(message({ expiresAt: "2026-07-31T00:00:00.000Z" }), "r1", { now: NOW });
  assert.equal(Core.messageReadIntent(expired, "r1").ok, false);
});

test("read receipts are resident-bound and idempotent without optimistic success", () => {
  const current = Core.projectMessage(message({ status: "read" }), "r1", { now: NOW });
  const payload = {
    ...message({ status: "read" }),
    receipts: [{ status: "read", at: NOW.toISOString() }]
  };
  assert.equal(Core.confirmMessageReceipt(payload, "msg-1", { residentId: "r2" }).reason, "receipt-resident-mismatch");
  const confirmed = Core.confirmMessageReceipt(payload, "msg-1", {
    residentId: "r1",
    currentMessage: current,
    now: NOW
  });
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.idempotent, true);
  assert.equal(confirmed.message.isRead, true);
});

test("session subject fingerprints detect resident, account and role changes", () => {
  const base = { id: "u4", accountId: "a1", residentId: "r1", role: "citizen" };
  assert.equal(Core.sessionSubjectKey(base), "u4::a1::r1::citizen");
  assert.notEqual(Core.sessionSubjectKey(base), Core.sessionSubjectKey({ ...base, residentId: "r2" }));
  assert.equal(Core.sessionSubjectKey({ ...base, accountId: "" }), "");
});

test("automatic Chinese scan rejects English business status regressions", () => {
  assert.deepEqual(Core.findEnglishBusinessCopy(Object.values(Core.STATUS_LABELS)), []);
  assert.deepEqual(Core.findEnglishBusinessCopy(["加载中", "连接超时", "已读", "已过期"]), []);
  assert.deepEqual(Core.findEnglishBusinessCopy(["pending", "service failed"]), ["pending", "service failed"]);
});

test("platform navigation rejects unknown routes and unsafe parameters", async () => {
  const history = [];
  const environment = {
    localStorage: { getItem: () => null, setItem: () => {} },
    location: { pathname: "/resident-mini-program.html" },
    history: { pushState: (_state, _title, url) => history.push(url) },
    CustomEvent: class CustomEvent { constructor(name, options) { this.name = name; this.detail = options.detail; } },
    dispatchEvent: () => {}
  };
  const adapter = Adapter.createAdapter(environment);
  assert.equal((await adapter.navigate("https://evil.example")).status, "invalid");
  assert.equal((await adapter.navigate("home", { url: "javascript:alert" })).status, "invalid");
  assert.equal(history.length, 0);
  assert.equal((await adapter.navigate("messages", { messageId: "msg-1" })).status, "success");
  assert.equal(history[0], "/resident-mini-program.html?page=messages&messageId=msg-1");
});

test("platform bridge maps cancel, deny and timeout without exposing raw returns", async () => {
  const cancelled = Adapter.createAdapter({
    wx: { navigateTo: ({ fail }) => fail({ errMsg: "navigateTo:fail cancel", privateData: "不得返回" }) }
  });
  const cancelResult = await cancelled.navigate("home");
  assert.deepEqual(Object.keys(cancelResult).sort(), ["capability", "message", "ok", "runtime", "status"]);
  assert.equal(cancelResult.status, "cancelled");
  assert.equal(JSON.stringify(cancelResult).includes("不得返回"), false);

  const denied = Adapter.createAdapter({
    my: { makePhoneCall: ({ fail }) => fail({ errorMessage: "permission denied", phone: "13800000000" }) }
  });
  assert.equal((await denied.makeEmergencyCall()).status, "denied");

  const timeout = Adapter.createAdapter({
    wx: { navigateTo: () => {} }
  });
  assert.equal((await timeout.navigate("home", {}, { timeoutMs: 200 })).status, "timeout");
});

test("platform capability probes expose booleans only and persist no platform data", () => {
  const writes = [];
  const adapter = Adapter.createAdapter({
    wx: {
      navigateTo: () => {},
      makePhoneCall: () => {},
      onAppShow: () => {}
    },
    localStorage: { setItem: (...args) => writes.push(args), getItem: () => null }
  });
  assert.deepEqual(adapter.probeCapabilities(), {
    runtime: "wechat",
    navigation: true,
    phoneCall: true,
    lifecycle: true
  });
  assert.deepEqual(writes, []);
});
