"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const SESSION_KEY = "health-city-auth-session";
const EXPIRES_AT = "2026-08-22T23:59:59.000Z";

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; }
  };
}

function contextBody() {
  return {
    ok: true,
    user: { id: "u-health", username: "health", name: "Health Admin", role: "commission", accountType: "manager" },
    permissions: [],
    regionalCapabilities: [],
    pages: [],
    menus: [],
    expiresAt: EXPIRES_AT,
    productionReady: false
  };
}

function loadAuth(options = {}) {
  const values = new Map();
  if (options.storedSession) values.set(SESSION_KEY, JSON.stringify(options.storedSession));
  const writes = [];
  const requests = [];
  const location = {
    protocol: options.protocol || "https:",
    hostname: options.hostname || "identity.example.test",
    origin: options.origin || "https://identity.example.test",
    pathname: "/login.html",
    search: ""
  };
  const sandbox = {
    URL,
    URLSearchParams,
    Date,
    Headers,
    Set,
    console,
    encodeURIComponent,
    location,
    fetch: async (url, fetchOptions = {}) => {
      requests.push({ url: String(url), options: fetchOptions });
      return options.fetch(String(url), fetchOptions, requests.length - 1);
    },
    localStorage: {
      getItem(key) { return values.has(key) ? values.get(key) : null; },
      setItem(key, value) {
        const serialized = String(value);
        writes.push({ key, value: serialized });
        values.set(key, serialized);
      },
      removeItem(key) { values.delete(key); }
    },
    document: {
      body: { dataset: { authPage: "login" } },
      addEventListener() {},
      querySelectorAll() { return []; }
    },
    window: { location: {} }
  };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, "auth.js"), "utf8"), sandbox, { filename: "auth.js" });
  return {
    auth: sandbox.window.HealthCityAuth,
    requests,
    writes,
    stored() {
      const value = values.get(SESSION_KEY);
      return value ? JSON.parse(value) : null;
    }
  };
}

for (const loginCase of [
  { name: "password", endpoint: "/api/auth/login", invoke: (auth) => auth.login("health", "secret") },
  { name: "phone", endpoint: "/api/auth/phone-login", invoke: (auth) => auth.loginByPhone("13800000000", "123456") }
]) {
  test(`production ${loginCase.name} login never writes the returned bearer token to localStorage`, async () => {
    const secret = `production-${loginCase.name}-bearer-secret`;
    const harness = loadAuth({
      fetch: async (url) => {
        if (url.endsWith(loginCase.endpoint)) {
          return response(200, {
            ok: true,
            user: contextBody().user,
            token: secret,
            transport: "hybrid",
            expiresAt: EXPIRES_AT
          });
        }
        if (url.endsWith("/api/auth/context")) return response(200, contextBody());
        throw new Error(`unexpected request: ${url}`);
      }
    });

    const result = await loginCase.invoke(harness.auth);

    assert.equal(result.ok, true);
    assert.equal(harness.writes.some((entry) => entry.value.includes(secret)), false);
    assert.equal(Object.hasOwn(harness.stored(), "token"), false);
    assert.equal(harness.auth.getToken(), "");
    const contextRequest = harness.requests.find((entry) => entry.url.endsWith("/api/auth/context"));
    assert.equal(contextRequest.options.headers?.get?.("Authorization") || "", "");
  });
}

test("a stale script-readable browser credential is removed before cookie context hydration", async () => {
  const harness = loadAuth({
    storedSession: {
      id: "stale-user",
      role: "commission",
      token: "stale-token",
      accessToken: "stale-access-token",
      refreshToken: "stale-refresh-token"
    },
    fetch: async (url, options) => {
      assert.equal(url.endsWith("/api/auth/context"), true);
      assert.equal(options.headers?.get?.("Authorization") || "", "");
      return response(200, contextBody());
    }
  });

  assert.equal(JSON.stringify(harness.stored()).includes("stale-token"), false);
  assert.equal(harness.auth.getToken(), "");
  const result = await harness.auth.refreshAuthContext();
  assert.equal(result.ok, true);
  assert.equal(harness.stored().authMode, "server-cookie");
});

test("a failed bearer-only context hand-off clears the volatile token and browser session", async () => {
  const secret = "memory-only-production-bearer";
  const harness = loadAuth({
    fetch: async (url, options) => {
      if (url.endsWith("/api/auth/login")) {
        return response(200, {
          ok: true,
          user: contextBody().user,
          token: secret,
          transport: "bearer",
          expiresAt: EXPIRES_AT
        });
      }
      if (url.endsWith("/api/auth/context")) {
        assert.equal(options.headers.get("Authorization"), `Bearer ${secret}`);
        return response(401, { ok: false });
      }
      throw new Error(`unexpected request: ${url}`);
    }
  });

  const result = await harness.auth.login("health", "secret");

  assert.equal(result.ok, false);
  assert.equal(harness.auth.getToken(), "");
  assert.equal(harness.stored(), null);
  assert.equal(harness.writes.some((entry) => entry.value.includes(secret)), false);
});

test("static non-production demo login remains compatible without storing credentials", async () => {
  const harness = loadAuth({
    protocol: "file:",
    hostname: "",
    origin: "null",
    fetch: async () => { throw new Error("static demo must not call the API"); }
  });

  const result = await harness.auth.login("citizen", "123456");

  assert.equal(result.ok, true);
  assert.equal(harness.stored().authMode, "local");
  assert.equal(harness.stored().role, "citizen");
  assert.equal(Object.hasOwn(harness.stored(), "token"), false);
});
