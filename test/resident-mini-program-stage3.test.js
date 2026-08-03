"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const Adapter = require("../resident-mini-program-adapter");

const SUBJECT = "u4::a1::r1::citizen";
const NOW = new Date("2026-08-02T10:00:00.000Z");

function receipt(overrides = {}) {
  return {
    exchangeId: "exchange-wechat-1",
    platform: "wechat",
    subjectKey: SUBJECT,
    issuedAt: "2026-08-02T09:59:00.000Z",
    expiresAt: "2026-08-02T10:03:00.000Z",
    consumedAt: "2026-08-02T09:59:05.000Z",
    serverAccepted: true,
    ...overrides
  };
}

function wechatEnvironment(overrides = {}) {
  return {
    wx: {
      getSystemInfoSync: () => ({ SDKVersion: "2.27.1" }),
      onAppShow: () => {},
      onAppHide: () => {},
      navigateTo: ({ success }) => success?.({ raw: "ignored" }),
      login: ({ success }) => success({ code: "ONE_TIME_CODE_123456", profile: "不得返回" }),
      ...overrides
    }
  };
}

test("platform login code is exchanged once and never returned or persisted", async () => {
  const storageWrites = [];
  const exchangeInputs = [];
  const adapter = Adapter.createAdapter({
    ...wechatEnvironment(),
    localStorage: {
      getItem: () => null,
      setItem: (...args) => storageWrites.push(args),
      removeItem: () => {}
    }
  });
  const decision = await adapter.exchangeLoginCode({
    subjectKey: SUBJECT,
    now: NOW,
    exchange: async (input) => {
      exchangeInputs.push(input);
      return receipt();
    }
  });
  assert.equal(decision.ok, true);
  assert.equal(exchangeInputs.length, 1);
  assert.deepEqual(exchangeInputs[0], { platform: "wechat", code: "ONE_TIME_CODE_123456" });
  assert.equal(JSON.stringify(decision).includes("ONE_TIME_CODE_123456"), false);
  assert.deepEqual(storageWrites, []);
});

test("platform login receipt replay is rejected by the in-memory guard", async () => {
  const adapter = Adapter.createAdapter(wechatEnvironment());
  const exchange = async () => receipt();
  assert.equal((await adapter.exchangeLoginCode({ subjectKey: SUBJECT, now: NOW, exchange })).ok, true);
  assert.equal((await adapter.exchangeLoginCode({ subjectKey: SUBJECT, now: NOW, exchange })).reason, "login-code-replayed");
});

test("malformed platform login returns are minimized and fail closed", async () => {
  let exchanges = 0;
  const adapter = Adapter.createAdapter(wechatEnvironment({
    login: ({ success }) => success({ code: "bad code", token: "raw-token", userInfo: { name: "不读取" } })
  }));
  const result = await adapter.exchangeLoginCode({
    subjectKey: SUBJECT,
    now: NOW,
    exchange: async () => {
      exchanges += 1;
      return receipt();
    }
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, "invalid");
  assert.equal(exchanges, 0);
  assert.deepEqual(Object.keys(result).sort(), ["capability", "message", "ok", "runtime", "status"]);
  assert.equal(JSON.stringify(result).includes("raw-token"), false);
});

test("minimum platform version blocks bridge calls before invocation", async () => {
  let called = 0;
  const adapter = Adapter.createAdapter(wechatEnvironment({
    getSystemInfoSync: () => ({ SDKVersion: "2.26.9" }),
    navigateTo: () => {
      called += 1;
    },
    login: () => {
      called += 1;
    }
  }));
  assert.equal((await adapter.navigate("home")).status, "unsupported");
  assert.equal((await adapter.exchangeLoginCode({ subjectKey: SUBJECT, exchange: async () => receipt() })).status, "unsupported");
  assert.equal(called, 0);
  assert.equal(adapter.probeCapabilities().versionSupported, false);
});

test("resident cache cleanup removes only the dedicated cache whitelist", () => {
  const removed = [];
  const adapter = Adapter.createAdapter({
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: (key) => removed.push(key)
    },
    history: { pushState: () => {} },
    document: { addEventListener: () => {} }
  });
  adapter.clearResidentCache();
  assert.deepEqual(removed.sort(), [
    "resident-mini-program-cache:notification-consent",
    "resident-mini-program-cache:service-navigation"
  ]);
  assert.equal(removed.includes("health-city-auth-session"), false);
});
