"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { parseList, runPageAuthBootstrap } = require("../page-auth-bootstrap");
const { registerServiceWorkerOnLoad } = require("../service-worker-registration");

test("page auth bootstrap preserves role then account guard ordering", () => {
  const calls = [];
  const auth = {
    requireRole(roles) { calls.push(["role", roles]); return true; },
    requireAccountType(types) { calls.push(["account", types]); return true; }
  };
  assert.equal(runPageAuthBootstrap({ dataset: { roles: "commission, institution", accountTypes: "doctor" } }, auth), true);
  assert.deepEqual(calls, [
    ["role", ["commission", "institution"]],
    ["account", ["doctor"]]
  ]);
  assert.deepEqual(parseList(" citizen, ,institution "), ["citizen", "institution"]);
});

test("page auth bootstrap stops account checks after a denied role", () => {
  let accountChecks = 0;
  const result = runPageAuthBootstrap({ dataset: { roles: "institution", accountTypes: "doctor" } }, {
    requireRole: () => false,
    requireAccountType: () => { accountChecks += 1; return true; }
  });
  assert.equal(result, false);
  assert.equal(accountChecks, 0);
});

test("page auth bootstrap exposes only the two approved auth bar actions", () => {
  const calls = [];
  const auth = {
    initAuthBar: () => calls.push("init"),
    renderSessionBar: () => calls.push("render")
  };
  runPageAuthBootstrap({ dataset: { authAction: "init-auth-bar" } }, auth);
  runPageAuthBootstrap({ dataset: { authAction: "render-session-bar" } }, auth);
  assert.deepEqual(calls, ["init", "render"]);
  assert.throws(
    () => runPageAuthBootstrap({ dataset: { authAction: "arbitrary-code" } }, auth),
    /unsupported page auth bootstrap action/
  );
});

test("service worker registration remains load-bound and disabled for file previews", async () => {
  const listeners = [];
  const registrations = [];
  const runtime = {
    location: { protocol: "https:" },
    navigator: { serviceWorker: { register: async (value) => registrations.push(value) } },
    addEventListener(name, handler) { listeners.push([name, handler]); }
  };
  assert.equal(registerServiceWorkerOnLoad(runtime), true);
  assert.equal(listeners[0][0], "load");
  await listeners[0][1]();
  assert.deepEqual(registrations, ["./service-worker.js"]);
  assert.equal(registerServiceWorkerOnLoad({ ...runtime, location: { protocol: "file:" } }), false);
});
