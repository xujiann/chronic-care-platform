"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const Runtime = require("../resident-mini-program-runtime-policy");

const NOW = new Date("2026-08-02T10:00:00.000Z");

function receipt(overrides = {}) {
  return {
    exchangeId: "exchange-1",
    platform: "wechat",
    subjectKey: "u4::a1::r1::citizen",
    issuedAt: "2026-08-02T09:59:00.000Z",
    expiresAt: "2026-08-02T10:03:00.000Z",
    consumedAt: "2026-08-02T09:59:05.000Z",
    serverAccepted: true,
    ...overrides
  };
}

function link(overrides = {}) {
  return {
    page: "health-record",
    residentId: "r1",
    recordId: "record-1",
    issuedAt: "2026-08-02T09:59:00.000Z",
    expiresAt: "2026-08-02T10:03:00.000Z",
    nonce: "nonce-0123456789",
    signature: "abcdefghijklmnopqrstuvwxyz_0123456789-ABCD",
    ...overrides
  };
}

function linkContext() {
  return {
    residentId: "r1",
    allowedResidentIds: new Set(["r1"]),
    messages: []
  };
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    values
  };
}

test("server-consumed platform login exchange is subject-bound and minimized", () => {
  const decision = Runtime.validateLoginExchangeReceipt(receipt(), {
    platform: "wechat",
    subjectKey: "u4::a1::r1::citizen"
  }, {
    now: NOW,
    replayGuard: Runtime.createReplayGuard()
  });
  assert.deepEqual(decision, {
    ok: true,
    exchangeId: "exchange-1",
    platform: "wechat",
    subjectKey: "u4::a1::r1::citizen",
    expiresAt: "2026-08-02T10:03:00.000Z"
  });
  assert.equal(Object.hasOwn(decision, "code"), false);
  assert.equal(Object.hasOwn(decision, "token"), false);
});

test("login exchange replay, expiry, subject mismatch and raw credentials fail closed", () => {
  const guard = Runtime.createReplayGuard();
  const context = { platform: "wechat", subjectKey: "u4::a1::r1::citizen" };
  assert.equal(Runtime.validateLoginExchangeReceipt(receipt(), context, { now: NOW, replayGuard: guard }).ok, true);
  assert.equal(Runtime.validateLoginExchangeReceipt(receipt(), context, { now: NOW, replayGuard: guard }).reason, "login-code-replayed");
  assert.equal(Runtime.validateLoginExchangeReceipt(receipt({ expiresAt: "2026-08-02T09:59:59.000Z" }), context, {
    now: NOW,
    replayGuard: Runtime.createReplayGuard()
  }).reason, "login-code-expired");
  assert.equal(Runtime.validateLoginExchangeReceipt(receipt(), { ...context, subjectKey: "u5::a2::r4::citizen" }, {
    now: NOW,
    replayGuard: Runtime.createReplayGuard()
  }).reason, "subject-binding-mismatch");
  assert.equal(Runtime.validateLoginExchangeReceipt(receipt({ code: "raw-code" }), context, {
    now: NOW,
    replayGuard: Runtime.createReplayGuard()
  }).reason, "raw-credential-returned");
  assert.equal(Runtime.validateLoginExchangeReceipt(receipt({ consumedAt: "2026-08-02T10:01:00.000Z" }), context, {
    now: NOW,
    replayGuard: Runtime.createReplayGuard()
  }).reason, "invalid-login-code-window");
});

test("replay guard fails closed at capacity until an entry expires", () => {
  const guard = Runtime.createReplayGuard({ maximum: 10 });
  const expiresAt = new Date(NOW.getTime() + 60_000);
  for (let index = 0; index < 10; index += 1) {
    assert.equal(guard.consume(`nonce:${index}`, expiresAt, NOW), true);
  }
  assert.equal(guard.consume("nonce:overflow", expiresAt, NOW), false);
  assert.equal(guard.consume("nonce:0", expiresAt, NOW), false);
  assert.equal(guard.consume("nonce:overflow", new Date(NOW.getTime() + 120_000), expiresAt), true);
});

test("one-time platform codes accept bounded opaque values only", () => {
  assert.equal(Runtime.validOneTimeCode("abcDEF0123._-/+"), true);
  assert.equal(Runtime.validOneTimeCode("short"), false);
  assert.equal(Runtime.validOneTimeCode("bad code with spaces"), false);
  assert.equal(Runtime.validOneTimeCode("x".repeat(513)), false);
});

test("platform capability matrix enforces minimum versions and essential abilities", () => {
  const ready = Runtime.platformCapabilityDecision({
    runtime: "wechat",
    currentVersion: "2.27.1",
    permission: "granted",
    capabilities: { navigation: true, lifecycle: true, phoneCall: true, loginCode: true }
  });
  assert.equal(ready.supported, true);
  assert.equal(ready.status, "ready");
  assert.equal(Runtime.platformCapabilityDecision({
    runtime: "wechat",
    currentVersion: "2.26.9",
    permission: "granted",
    capabilities: { navigation: true, lifecycle: true }
  }).status, "version-too-low");
  assert.equal(Runtime.platformCapabilityDecision({
    runtime: "alipay",
    currentVersion: "2.9.1",
    permission: "denied",
    capabilities: { navigation: true, lifecycle: true }
  }).status, "permission-denied");
});

test("API policy permits HTTPS same-origin and localhost preview only", () => {
  assert.equal(Runtime.requestOriginDecision("/api/state", { origin: "https://health.example.cn" }).ok, true);
  assert.equal(Runtime.requestOriginDecision("/api/state", { origin: "http://127.0.0.1:5173" }).ok, true);
  assert.equal(Runtime.requestOriginDecision("http://health.example.cn/api/state", { origin: "http://health.example.cn" }).reason, "https-required");
  assert.equal(Runtime.requestOriginDecision("https://evil.example/api/state", { origin: "https://health.example.cn" }).reason, "origin-denied");
  assert.equal(Runtime.requestOriginDecision("/api/state?token=secret", { origin: "https://health.example.cn" }).reason, "sensitive-query-denied");
});

test("write requests require stable idempotency keys", () => {
  assert.equal(Runtime.validateApiRequest({ url: "/api/state", method: "GET" }, {
    origin: "https://health.example.cn"
  }).ok, true);
  assert.equal(Runtime.validateApiRequest({ url: "/api/messages/m1/receipt", method: "POST" }, {
    origin: "https://health.example.cn"
  }).reason, "idempotency-key-required");
  const key = Runtime.createIdempotencyKey("message-read", {
    accountId: "a1",
    residentId: "r1",
    resourceId: "m1"
  });
  assert.match(key, /^resident-write:/);
  assert.equal(Runtime.validateApiRequest({
    url: "/api/messages/m1/receipt",
    method: "POST",
    idempotencyKey: key
  }, {
    origin: "https://health.example.cn"
  }).ok, true);
});

test("resident responses reject cross-resident rows, secrets and excessive batches", () => {
  const allowed = new Set(["r1"]);
  assert.equal(Runtime.validateResidentRows([{ id: "m1", residentId: "r1" }], allowed).ok, true);
  assert.equal(Runtime.validateResidentRows([{ id: "m2", residentId: "r4" }], allowed).reason, "cross-resident-response");
  assert.equal(Runtime.validateResidentRows([{ id: "m1", residentId: "r1", token: "secret" }], allowed).reason, "forbidden-response-field");
  assert.equal(Runtime.validateResidentRows(Array.from({ length: 101 }, (_, index) => ({ id: `m${index}`, residentId: "r1" })), allowed).reason, "response-row-limit");
});

test("unsigned deep links are restricted to parameter-free public pages", async () => {
  assert.equal((await Runtime.validateSignedDeepLink({ page: "messages" }, linkContext())).ok, true);
  assert.equal((await Runtime.validateSignedDeepLink({ page: "health-record", recordId: "record-1" }, linkContext())).reason, "signed-link-required");
  assert.equal((await Runtime.validateSignedDeepLink("javascript:alert(1)", linkContext())).reason, "malformed-signed-link");
});

test("valid signed deep link is verified, resident-bound and one-time", async () => {
  const guard = Runtime.createReplayGuard();
  const options = { now: NOW, replayGuard: guard, verifier: async () => true };
  const first = await Runtime.validateSignedDeepLink(link(), linkContext(), options);
  assert.deepEqual(first, { ok: true, route: "health-record", params: { recordId: "record-1" }, reason: "allowed" });
  assert.equal((await Runtime.validateSignedDeepLink(link(), linkContext(), options)).reason, "signed-link-replayed");
});

test("forged, expired, overlong and cross-resident signed links fail closed", async () => {
  const options = { now: NOW, replayGuard: Runtime.createReplayGuard(), verifier: async () => false };
  assert.equal((await Runtime.validateSignedDeepLink(link(), linkContext(), options)).reason, "signature-verification-failed");
  assert.equal((await Runtime.validateSignedDeepLink(link({ expiresAt: "2026-08-02T09:59:59.000Z" }), linkContext(), {
    ...options,
    verifier: async () => true
  })).reason, "signed-link-expired");
  assert.equal((await Runtime.validateSignedDeepLink(link({ residentId: "r4" }), linkContext(), {
    ...options,
    verifier: async () => true
  })).reason, "signed-link-resident-mismatch");
  assert.equal(Runtime.normalizeDeepLinkInput(`page=home&value=${"x".repeat(1300)}`), null);
  assert.equal(Runtime.normalizeDeepLinkInput("page=home&page=messages"), null);
  assert.equal((await Runtime.validateSignedDeepLink(link(), linkContext(), {
    now: NOW,
    replayGuard: Runtime.createReplayGuard(),
    verifier: async () => {
      throw new Error("bridge failed");
    }
  })).reason, "signature-verification-failed");
});

test("bound cache enforces whitelist, TTL and account plus resident binding", () => {
  const storage = memoryStorage();
  let now = NOW;
  const cache = Runtime.createBoundCache(storage, { now: () => now });
  const binding = { accountId: "a1", residentId: "r1" };
  assert.equal(cache.write("service-navigation", { route: "messages" }, binding, 10_000), true);
  assert.deepEqual(cache.read("service-navigation", binding), { route: "messages" });
  assert.equal(cache.read("service-navigation", { accountId: "a1", residentId: "r4" }), null);
  assert.equal(cache.write("unknown", { route: "home" }, binding), false);
  cache.write("service-navigation", { route: "home" }, binding, 1000);
  now = new Date(NOW.getTime() + 2000);
  assert.equal(cache.read("service-navigation", binding), null);
});

test("bound cache refuses medical text and credentials then clears allowed records", () => {
  const storage = memoryStorage();
  const cache = Runtime.createBoundCache(storage, { now: () => NOW });
  const binding = { accountId: "a1", residentId: "r1" };
  assert.equal(cache.write("service-navigation", { record: { body: "病历正文" } }, binding), false);
  assert.equal(cache.write("notification-consent", { token: "secret" }, binding), false);
  assert.equal(cache.write("notification-consent", { enabled: true }, binding), true);
  cache.clearAll();
  assert.equal(cache.read("notification-consent", binding), null);
});

test("notifications require consent, fresh account and resident binding and generic lock-screen copy", () => {
  const notification = {
    id: "notification-1",
    accountId: "a1",
    residentId: "r1",
    createdAt: "2026-08-02T09:59:00.000Z",
    expiresAt: "2026-08-03T09:59:00.000Z",
    status: "sent",
    title: "检验结果提醒",
    body: "请打开应用安全查看。"
  };
  const context = { consent: true, accountId: "a1", residentId: "r1" };
  const guard = Runtime.createReplayGuard();
  const decision = Runtime.validateNotification(notification, context, { now: NOW, replayGuard: guard });
  assert.equal(decision.ok, true);
  assert.equal(decision.lockScreenTitle, "您有一条新的健康服务消息");
  assert.doesNotMatch(decision.lockScreenBody, /检验|病历|处方/);
  assert.equal(Runtime.validateNotification(notification, context, { now: NOW, replayGuard: guard }).reason, "notification-replayed");
});

test("withdrawn, stale, wrong-resident and non-consented notifications are suppressed", () => {
  const base = {
    id: "notification-2",
    accountId: "a1",
    residentId: "r1",
    createdAt: "2026-08-02T09:59:00.000Z",
    expiresAt: "2026-08-03T09:59:00.000Z",
    status: "sent"
  };
  const options = { now: NOW, replayGuard: Runtime.createReplayGuard() };
  assert.equal(Runtime.validateNotification(base, { consent: false, accountId: "a1", residentId: "r1" }, options).reason, "notification-consent-required");
  assert.equal(Runtime.validateNotification({ ...base, residentId: "r4" }, { consent: true, accountId: "a1", residentId: "r1" }, options).reason, "notification-binding-mismatch");
  assert.equal(Runtime.validateNotification({ ...base, status: "withdrawn" }, { consent: true, accountId: "a1", residentId: "r1" }, options).reason, "notification-withdrawn");
  assert.equal(Runtime.validateNotification({ ...base, expiresAt: "2026-08-02T09:59:59.000Z" }, { consent: true, accountId: "a1", residentId: "r1" }, options).reason, "notification-expired");
});
