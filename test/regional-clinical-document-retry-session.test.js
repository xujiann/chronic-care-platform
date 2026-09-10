"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

function center(ids = ["event-a", "event-b"]) {
  return {
    scope: { crossInstitutionVisible: true }, actions: { retryExceptions: true },
    summary: {}, documents: [], uploadLogs: [], workstationReminders: [], capabilities: [], blockers: [],
    exceptions: ids.map((id) => ({ id, actions: { retryException: true }, retryCount: 1, issueCodes: [] }))
  };
}

function harness() {
  class Element {
    constructor() { this.children = []; this.dataset = {}; this.listeners = {}; this.value = "all"; this.disabled = false; }
    append(...items) { this.children.push(...items); }
    replaceChildren(...items) { this.children = items; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    get options() { return this.children; }
    remove(index) { this.children.splice(index, 1); }
  }
  const nodes = new Map();
  const node = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, new Element());
    return nodes.get(selector);
  };
  const requests = [];
  const context = {
    location: { protocol: "https:", hostname: "platform.test" },
    window: { HealthCityAuth: { getUser: () => ({ role: "commission" }) } },
    document: { querySelector: node, querySelectorAll: () => [], createElement: () => new Element() },
    fetch(url, options = {}) {
      return new Promise((resolve, reject) => requests.push({ url, options, reject,
        respond(payload = {}, status = 200) { resolve({ ok: status >= 200 && status < 300, status, json: async () => payload }); }
      }));
    }
  };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, "..", "regional-clinical-documents.js"), "utf8").replace(/\r\n/g, "\n");
  // Expose actual closure functions; only suppress automatic startup GET.
  const marker = "\n  load();\n})();";
  assert.ok(source.includes(marker));
  vm.runInContext(source.replace(marker, "\n  window.test = { state, retryDocument, renderExceptions, load };\n})();"), context);
  const api = context.window.test;
  api.state.center = center();
  api.state.source = "api";
  api.renderExceptions();
  const buttons = () => {
    const result = [];
    function walk(element) {
      if (element.dataset?.documentRetry) result.push(element);
      (element.children || []).forEach(walk);
    }
    walk(node("#document-exceptions"));
    return result;
  };
  return { ...api, requests, node, buttons,
    click(id) {
      const button = buttons().find((item) => item.dataset.documentRetry === id);
      assert.ok(button);
      node("#document-exceptions").listeners.click({ target: { closest: () => button } });
    }
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test("a one-time pre-submit render failure releases the event for a later action", async () => {
  const h = harness();
  const target = h.node("#document-exceptions");
  const replace = target.replaceChildren;
  let fail = true;
  target.replaceChildren = function (...items) {
    if (fail) { fail = false; throw new Error("synthetic render failure"); }
    return replace.apply(this, items);
  };
  await h.retryDocument("event-a").catch(() => {});
  assert.equal(h.requests.length, 0);
  h.renderExceptions();
  assert.equal(h.buttons()[0].disabled, false);
  const retry = h.retryDocument("event-a");
  h.retryDocument("event-a");
  assert.equal(h.requests.length, 1);
  h.requests[0].respond({}, 403);
  await retry;
});

test("a final render failure cannot retain the pending lock", async () => {
  const h = harness();
  const first = h.retryDocument("event-a");
  const target = h.node("#document-exceptions");
  const replace = target.replaceChildren;
  target.replaceChildren = () => { throw new Error("synthetic final render failure"); };
  h.requests[0].respond({}, 403);
  await first.catch(() => {});
  target.replaceChildren = replace;
  h.renderExceptions();
  assert.equal(h.buttons()[0].disabled, false);
  const retry = h.retryDocument("event-a");
  assert.equal(h.requests.length, 2);
  h.requests[1].respond({}, 403);
  await retry;
});

test("same event is single-flight through the real delegated click and rerender", async () => {
  const h = harness();
  h.click("event-a");
  h.renderExceptions();
  assert.equal(h.buttons().find((button) => button.dataset.documentRetry === "event-a").disabled, true);
  h.click("event-a"); // A synthetic queued event must also be guarded, beyond disabled UI.
  assert.equal(h.requests.length, 1);
  h.requests[0].respond({}, 403);
  await flush();
  assert.equal(h.buttons()[0].disabled, false);
});

test("lock covers POST and authoritative refresh, preserving wire payload and counters", async () => {
  const h = harness();
  const first = h.retryDocument("event-a");
  assert.equal(h.requests[0].url, "/api/integration/events/event-a/retry");
  assert.equal(h.requests[0].options.method, "POST");
  assert.deepEqual(JSON.parse(h.requests[0].options.body), { reason: "区域医疗文书中心人工复核后补传" });
  h.requests[0].respond({ status: "retrying" });
  await flush();
  assert.equal(h.requests[1].url, "/api/integration/clinical-documents/center");
  h.retryDocument("event-a");
  assert.equal(h.requests.length, 2);
  assert.equal(h.state.center.exceptions[0].retryCount, 1);
  h.requests[1].respond(center());
  await first;
  assert.equal(h.buttons()[0].disabled, false);
});

test("different events do not share a lock", async () => {
  const h = harness();
  const a = h.retryDocument("event-a");
  const b = h.retryDocument("event-b");
  assert.equal(h.requests.length, 2);
  h.requests.forEach((request) => request.respond({}, 403));
  await Promise.all([a, b]);
  assert.equal(h.buttons().every((button) => !button.disabled), true);
});

for (const mode of ["fallback", "global-denied", "item-denied", "missing"]) {
  test(`stale delegate and direct invocation reject ${mode} without POST`, async () => {
    const h = harness();
    if (mode === "fallback") h.state.source = "fallback";
    if (mode === "global-denied") h.state.center.actions.retryExceptions = false;
    if (mode === "item-denied") h.state.center.exceptions[0].actions.retryException = false;
    if (mode === "missing") h.state.center.exceptions = [];
    h.click("event-a");
    h.retryDocument("event-a");
    assert.equal(h.requests.length, 0);
  });
}

test("an explicit server rejection releases the lock for a later user action", async () => {
  const h = harness();
  const first = h.retryDocument("event-a");
  h.requests[0].respond({ message: "无权处理" }, 403);
  await first;
  assert.match(h.node("#document-source-title").textContent, /未完成/);
  const second = h.retryDocument("event-a");
  assert.equal(h.requests.length, 2);
  h.requests[1].respond({}, 403);
  await second;
});

test("unknown transport outcome requests verification, never claims zero server writes", async () => {
  const h = harness();
  const first = h.retryDocument("event-a");
  h.requests[0].reject(new Error("connection lost"));
  await first;
  assert.match(h.node("#document-source-detail").textContent, /核对/);
  assert.doesNotMatch(h.node("#document-source-detail").textContent, /重新提交|请重试|点击重试/);
  assert.equal(h.requests.length, 1);
  assert.equal(h.state.center.exceptions[0].retryCount, 1);
});

test("failed post-success refresh enters read-only fallback and cannot submit again", async () => {
  const h = harness();
  const first = h.retryDocument("event-a");
  h.requests[0].respond({});
  await flush();
  h.requests[1].reject(new Error("offline"));
  await first;
  assert.equal(h.state.source, "fallback");
  h.retryDocument("event-a");
  assert.equal(h.requests.length, 2);
  assert.equal(h.buttons().length, 0);
});

test("another completed refresh cannot unlock an event still awaiting its POST", async () => {
  const h = harness();
  const first = h.retryDocument("event-a");
  const refresh = h.load();
  h.requests[1].respond(center());
  await refresh;
  assert.equal(h.buttons()[0].disabled, true);
  h.click("event-a");
  assert.equal(h.requests.length, 2);
  h.requests[0].respond({}, 403);
  await first;
});
