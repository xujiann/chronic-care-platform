"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const Delivery = require("../resident-mini-program-delivery-policy");
const Release = require("../scripts/resident-mini-program-release");

const NOW = new Date("2026-08-03T01:00:00.000Z");

function shell(platform, overrides = {}) {
  return {
    platform,
    appId: platform === "wechat" ? "wx0123456789abcdef" : "2026000000000001",
    configurationVerified: true,
    configurationEvidenceId: "site-evidence-20260803",
    minimumVersion: platform === "wechat" ? "2.27.0" : "2.9.0",
    apiOrigin: "https://api.health.dalian.gov.cn",
    businessOrigin: "https://resident.health.dalian.gov.cn",
    pages: [...Delivery.REQUIRED_PAGES],
    permissions: ["makePhoneCall", "subscribeMessage"],
    privacy: {
      makePhoneCall: "仅在居民主动确认急救拨号时调用",
      subscribeMessage: "仅在居民明确同意后接收脱敏通知"
    },
    debug: false,
    grayReleaseEnabled: false,
    grayReleaseRuleId: "",
    ...overrides
  };
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    values
  };
}

test("platform shell requires real app ids, HTTPS domains, complete pages and privacy mapping", () => {
  assert.equal(Delivery.validatePlatformShell(shell("wechat")).ok, true);
  assert.equal(Delivery.validatePlatformShell(shell("alipay")).ok, true);
  const placeholder = Delivery.validatePlatformShell(shell("wechat", {
    appId: "__WECHAT_APP_ID__",
    apiOrigin: "http://localhost:5210",
    businessOrigin: "https://example.invalid",
    pages: ["home"],
    privacy: {}
  }));
  assert.equal(placeholder.ok, false);
  assert.match(placeholder.blockers.join("；"), /应用标识|接口域名|业务域名|页面清单|隐私声明/);
});

test("session lifecycle continues, renews and reauthenticates without trusting a role string", () => {
  const context = { subjectKey: "subject-a" };
  assert.equal(Delivery.sessionLifecycleDecision({
    subjectKey: "subject-a",
    expiresAt: "2026-08-03T01:20:00.000Z"
  }, { ...context, now: NOW }).action, "continue");
  assert.equal(Delivery.sessionLifecycleDecision({
    subjectKey: "subject-a",
    expiresAt: "2026-08-03T01:04:00.000Z"
  }, { ...context, now: NOW }).action, "renew");
  assert.equal(Delivery.sessionLifecycleDecision({
    subjectKey: "subject-b",
    expiresAt: "2026-08-03T01:20:00.000Z"
  }, { ...context, now: NOW }).action, "reauthenticate");
});

test("member switching is confirmed, single-flight and rolls back on stale authorization", () => {
  const begin = Delivery.beginMemberSwitch({
    currentResidentId: "r1",
    targetResidentId: "r2",
    allowedResidentIds: new Set(["r1", "r2"]),
    startedAt: NOW.toISOString()
  });
  assert.equal(begin.ok, true);
  assert.equal(Delivery.beginMemberSwitch({
    currentResidentId: "r1",
    targetResidentId: "r2",
    allowedResidentIds: new Set(["r1", "r2"]),
    inProgress: true
  }).ok, false);
  const failed = Delivery.finishMemberSwitch(begin.transaction, {
    ok: true,
    residentId: "r2",
    allowedResidentIds: new Set(["r1"])
  });
  assert.deepEqual(failed, {
    ok: false,
    residentId: "r1",
    reason: "切换未完成，已恢复原居民页面"
  });
});

test("batch read caps stable ids and half-failure rolls the entire page back", () => {
  const messages = [
    { id: "m1", residentId: "r1", isRead: false, expired: false },
    { id: "m2", residentId: "r1", isRead: false, expired: false },
    { id: "m2", residentId: "r1", isRead: false, expired: false },
    { id: "foreign", residentId: "r2", isRead: false, expired: false },
    { id: "expired", residentId: "r1", isRead: false, expired: true }
  ];
  const intent = Delivery.createBatchReadIntent(messages, "r1");
  assert.deepEqual([...intent.messageIds], ["m1", "m2"]);
  const half = Delivery.reconcileBatchRead(messages, intent, [
    { id: "m1", residentId: "r1", status: "read" },
    { id: "m2", residentId: "r1", status: "failed" }
  ]);
  assert.equal(half.ok, false);
  assert.equal(half.messages, messages);
  const complete = Delivery.reconcileBatchRead(messages, intent, [
    { id: "m1", residentId: "r1", status: "read" },
    { id: "m2", residentId: "r1", status: "read" }
  ]);
  assert.equal(complete.ok, true);
  assert.equal(complete.messages.filter((item) => ["m1", "m2"].includes(item.id)).every((item) => item.isRead), true);
});

test("observability recursively redacts sensitive data and admits only allowlisted event fields", () => {
  const redacted = Delivery.redactTelemetry({
    route: "messages",
    nested: {
      phone: "13800138000",
      detail: "token=secret-value"
    }
  });
  assert.equal(redacted.nested.phone, "[已脱敏]");
  assert.equal(redacted.nested.detail, "[已脱敏]");
  const event = Delivery.minimizeTelemetryEvent({
    name: "request_failed",
    route: "messages",
    statusCode: 503,
    residentId: "r1",
    token: "secret",
    arbitrary: "drop-me"
  });
  assert.deepEqual(event, {
    name: "request_failed",
    fields: {
      statusCode: 503,
      route: "messages"
    }
  });
  assert.equal(Delivery.minimizeTelemetryEvent({ name: "medical_record_viewed", route: "emr" }), null);
});

test("offline observability queue requires consent, binding, TTL and capacity", () => {
  const storage = memoryStorage();
  let now = NOW;
  const queue = Delivery.createObservabilityQueue(storage, { now: () => now });
  assert.equal(queue.enqueue({ name: "page_ready", route: "home" }, "account-a"), false);
  queue.setConsent(true);
  for (let index = 0; index < 25; index += 1) {
    assert.equal(queue.enqueue({ name: "page_ready", route: `page-${index}` }, "account-a"), true);
  }
  assert.equal(queue.read("account-a").length, Delivery.QUEUE_LIMIT);
  assert.deepEqual(queue.read("account-b"), []);
  assert.equal(storage.values.size, 0);
  queue.setConsent(true);
  queue.enqueue({ name: "page_ready", route: "home" }, "account-a");
  now = new Date(NOW.getTime() + Delivery.QUEUE_TTL_MS + 1);
  assert.deepEqual(queue.read("account-a"), []);
  queue.setConsent(false);
  assert.equal(storage.values.size, 0);
});

test("release gate defaults gray controls off and blocks missing external services", () => {
  const blocked = Delivery.releaseDecision({
    shells: [shell("wechat"), shell("alipay")],
    version: Delivery.RELEASE_VERSION,
    buildNumber: "20260803.1",
    services: {}
  });
  assert.equal(blocked.softwareCandidate, true);
  assert.equal(blocked.productionReady, false);
  assert.equal(blocked.grayReleaseEnabled, false);
  assert.match(blocked.blockers.join("；"), /身份|居民关系|消息回执|深链签名|通知/);
  const ready = Delivery.releaseDecision({
    shells: [shell("wechat"), shell("alipay")],
    version: Delivery.RELEASE_VERSION,
    buildNumber: "20260803.1",
    services: {
      identity: true,
      residentScope: true,
      messageReceipt: true,
      deepLinkSignature: true,
      notification: true
    }
  });
  assert.equal(ready.productionReady, true);
  assert.equal(Delivery.releaseDecision({
    shells: [shell("wechat"), shell("alipay")],
    buildNumber: "20260803.1",
    services: {
      identity: true,
      residentScope: true,
      messageReceipt: true,
      deepLinkSignature: true,
      notification: true
    },
    emergencyStop: true
  }).productionReady, false);
});

test("all service view states remain Chinese and fail closed", () => {
  assert.equal(Delivery.serviceViewDecision({ loading: true }).state, "loading");
  assert.equal(Delivery.serviceViewDecision({ permission: false }).state, "forbidden");
  assert.equal(Delivery.serviceViewDecision({ permission: true, network: "offline" }).state, "offline");
  assert.equal(Delivery.serviceViewDecision({ permission: true, error: true }).state, "error");
  assert.equal(Delivery.serviceViewDecision({ permission: true, rows: [] }).state, "empty");
  assert.equal(Delivery.serviceViewDecision({ permission: true, rows: [{}] }).state, "ready");
});

test("release candidate build is deterministic, clean and production-blocked by placeholders", () => {
  const output = path.join(os.tmpdir(), "t04-mp-release-candidate-stage4-test");
  try {
    const first = Release.buildCandidate(["--output", output]);
    const firstManifest = fs.readFileSync(path.join(output, "release-manifest.json"), "utf8");
    const second = Release.buildCandidate(["--output", output]);
    const secondManifest = fs.readFileSync(path.join(output, "release-manifest.json"), "utf8");
    assert.equal(first.softwareReady, true);
    assert.equal(first.productionReady, false);
    assert.equal(second.softwareReady, true);
    assert.equal(firstManifest, secondManifest);
    assert.doesNotMatch(firstManifest, /localhost|127\.0\.0\.1|123456|888888/);
    assert.match(first.blockers.join("；"), /正式应用标识未配置/);
  } finally {
    fs.rmSync(output, { recursive: true, force: true });
  }
});
