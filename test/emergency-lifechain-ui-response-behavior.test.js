"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const lifeChain = require("../emergency-lifechain");
const source = fs.readFileSync(path.join(__dirname, "..", "emergency-lifechain-ui.js"), "utf8");

function validBody(action) {
  const data = {};
  const user = { role: "citizen", residentId: "resident-fixture" };
  const item = lifeChain.createAuthorization(data, user, { deviceId: "device-fixture", confirmed: true });
  item.id = "authorization-fixture";
  if (action === "revoke") lifeChain.revokeAuthorization(data, user, item.id, { confirmed: true });
  return { ok: true, item };
}

function harness(response, { confirmation = true, protocol = "http:" } = {}) {
  const requests = [];
  const listeners = new Map();
  const message = { hidden: true, textContent: "", style: {} };
  let ready;
  let refreshes = 0;
  let confirmations = 0;
  const forms = new Map(["authorization", "family", "device-sos"].map((name) => {
    const id = `lifechain-${name}-form`;
    return [id, { id, addEventListener(type, callback) { listeners.set(`${id}:${type}`, callback); } }];
  }));
  const document = {
    addEventListener(type, callback) { if (type === "DOMContentLoaded") ready = callback; },
    querySelector(selector) {
      if (selector === "#emergency-message") return message;
      if (forms.has(selector.slice(1))) return forms.get(selector.slice(1));
      return { addEventListener(type, callback) { listeners.set(`${selector}:${type}`, callback); } };
    }
  };
  const context = {
    document, location: { protocol },
    FormData: class { entries() { return Object.entries({ deviceId: " device-fixture ", confirmed: "true" }); } },
    window: {
      confirm() { confirmations += 1; return confirmation; },
      HealthCityAuth: { async authFetch(url, options) { requests.push({ url, options }); if (response instanceof Error) throw response; return response; } }
    },
    refreshProbe() { refreshes += 1; }
  };
  vm.runInNewContext(`${source}\n;loadLifeChain = async () => refreshProbe();`, context);
  ready();
  refreshes = 0;
  return {
    message, requests, get refreshes() { return refreshes; }, get confirmations() { return confirmations; },
    async act(action, formName = "authorization") {
      if (action === "create") {
        const form = forms.get(`lifechain-${formName}-form`);
        await listeners.get(`${form.id}:submit`)({ preventDefault() {}, currentTarget: form });
      } else {
        await listeners.get("#lifechain-overview:click")({ target: { closest() { return { dataset: { revokeAuthorization: "authorization-fixture" } }; } } });
      }
    }
  };
}

function responseFor(action, body = validBody(action), status = action === "create" ? 201 : 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}

for (const action of ["create", "revoke"]) {
  test(`${action}: actual owner success remains compatible`, async () => {
    const h = harness(responseFor(action));
    await h.act(action);
    assert.equal(h.message.style.color, "#166534");
    assert.match(h.message.textContent, action === "create" ? /information saved/ : /authorization revoked/);
    assert.equal(h.requests.length, 1);
    assert.equal(h.refreshes, 1);
    assert.equal(h.requests[0].options.method, "POST");
    assert.equal(h.requests[0].url, action === "create" ? "/api/emergency/life-chain/authorizations" : "/api/emergency/life-chain/authorizations/authorization-fixture/revoke");
    assert.equal(JSON.parse(h.requests[0].options.body).confirmed, action === "create" ? "true" : true);
  });

  const malformed = [
    ["invalid JSON", () => ({ ...responseFor(action), async json() { throw new SyntaxError("private raw response"); } })],
    ...[null, [], "success", {}, { ok: false }, { ok: "true" }, { ok: true }, { ok: true, item: null }, { ok: true, item: [] }].map((body, i) => [`invalid envelope ${i}`, () => responseFor(action, body)]),
    ...["id", "active", "autoCallEnabled"].map((field) => [`missing ${field}`, () => { const body = validBody(action); delete body.item[field]; return responseFor(action, body); }]),
    ["blank id", () => { const body = validBody(action); body.item.id = " "; return responseFor(action, body); }],
    ["opposite active", () => { const body = validBody(action); body.item.active = action !== "create"; return responseFor(action, body); }],
    ["wrong autoCallEnabled type", () => { const body = validBody(action); body.item.autoCallEnabled = String(body.item.autoCallEnabled); return responseFor(action, body); }],
    ["wrong binding", () => { const body = validBody(action); body.item[action === "create" ? "deviceId" : "id"] = "other-fixture"; return responseFor(action, body); }],
    ...[202, 204].map((status) => [`unconfirmed HTTP ${status}`, () => responseFor(action, validBody(action), status)])
  ];
  for (const [name, buildResponse] of malformed) {
    test(`${action}: ${name} never reports success or refreshes/reposts`, async () => {
      const h = harness(buildResponse());
      await h.act(action);
      assert.equal(h.message.style.color, "#b91c1c");
      assert.match(h.message.textContent, /not confirmed/i);
      assert.doesNotMatch(h.message.textContent, /private raw response|information saved|authorization revoked/);
      assert.equal(h.requests.length, 1);
      assert.equal(h.refreshes, 0);
    });
  }
  for (const response of [responseFor(action, { message: "Access denied" }, 403), new Error("Network unavailable")]) {
    test(`${action}: transport rejection remains failure`, async () => {
      const h = harness(response);
      await h.act(action);
      assert.equal(h.message.style.color, "#b91c1c");
      assert.equal(h.requests.length, 1);
      assert.equal(h.refreshes, 0);
    });
  }
}

test("revoke: cancelled confirmation sends nothing", async () => {
  const h = harness(responseFor("revoke"), { confirmation: false });
  await h.act("revoke");
  assert.equal(h.confirmations, 1);
  assert.equal(h.requests.length, 0);
  assert.equal(h.refreshes, 0);
  assert.equal(h.message.hidden, true);
});

test("family contact response is not subjected to authorization projection", async () => {
  const h = harness(responseFor("create", { ok: true, item: { id: "contact-fixture" } }));
  await h.act("create", "family");
  assert.equal(h.message.style.color, "#166534");
  assert.equal(h.refreshes, 1);
});

test("deduplicated device SOS preserves its separate success projection", async () => {
  const h = harness(responseFor("revoke", { ok: true, submission: { deduplicated: true } }));
  await h.act("create", "device-sos");
  assert.equal(h.message.style.color, "#166534");
  assert.match(h.message.textContent, /Duplicate device signal was suppressed/);
  assert.equal(h.refreshes, 1);
  assert.equal(h.requests.length, 1);
});

test("file preview retains its existing relative request behavior", async () => {
  const h = harness(responseFor("create"), { protocol: "file:" });
  await h.act("create");
  assert.equal(h.requests[0].url, "/life-chain/authorizations");
  assert.equal(h.message.style.color, "#166534");
});
