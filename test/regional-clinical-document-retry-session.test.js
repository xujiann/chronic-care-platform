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

function harness({ protocol = "https:" } = {}) {
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
    location: { protocol, hostname: "platform.test" },
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

function view(h) {
  return {
    center: h.state.center,
    source: h.state.source,
    title: h.node("#document-source-title").textContent,
    detail: h.node("#document-source-detail").textContent,
    tone: h.node("#document-source-banner").dataset.tone,
    refreshDisabled: h.node("#document-refresh").disabled,
    metrics: h.node("#document-metrics").children,
    exceptions: h.node("#document-exceptions").children
  };
}

function completeRead(request, outcome, ids) {
  if (outcome === "network") request.reject(new Error("synthetic read failure"));
  else if (outcome === "http") request.respond({ message: "synthetic read rejection" }, 403);
  else request.respond(center(ids));
}

for (const latestOutcome of ["success", "network", "http"]) {
  for (const oldOutcome of ["success", "network", "http"]) {
    test(`latest ${latestOutcome} view survives late old ${oldOutcome} without rerender`, async () => {
      const h = harness();
      const old = h.load();
      const latest = h.load();
      completeRead(h.requests[1], latestOutcome, ["new-event"]);
      await latest;
      assert.equal(h.state.source, latestOutcome === "success" ? "api" : "fallback");
      if (latestOutcome === "success") assert.equal(h.state.center.exceptions[0].id, "new-event");
      const expected = view(h);
      // A superseded finally must not call render, even if rendering would fail.
      h.node("#document-metrics").replaceChildren = () => { throw new Error("stale render executed"); };
      completeRead(h.requests[0], oldOutcome, ["old-event"]);
      await old;
      assert.deepEqual(view(h), expected);
    });
  }
}

for (const oldOutcome of ["success", "network", "http"]) {
  test(`old ${oldOutcome} completion cannot change the latest pending view or refresh button`, async () => {
    const h = harness();
    const old = h.load();
    const latest = h.load();
    const pending = view(h);
    assert.equal(pending.refreshDisabled, true);
    completeRead(h.requests[0], oldOutcome, ["old-event"]);
    await old;
    assert.deepEqual(view(h), pending);
    h.requests[1].respond(center(["new-event"]));
    await latest;
    assert.equal(h.node("#document-refresh").disabled, false);
    assert.equal(h.state.center.exceptions[0].id, "new-event");
  });
}

test("two actual event retries retain the newest GET and independent event locks", async () => {
  const h = harness();
  const a = h.retryDocument("event-a");
  const b = h.retryDocument("event-b");
  h.requests[0].respond({});
  await flush();
  h.requests[1].respond({});
  await flush();
  assert.deepEqual(h.requests.map((request) => request.options.method || "GET"), ["POST", "POST", "GET", "GET"]);
  const newest = center();
  newest.summary.documents = 42;
  h.requests[3].respond(newest);
  await b;
  assert.equal(h.buttons().find((button) => button.dataset.documentRetry === "event-a").disabled, true);
  assert.equal(h.buttons().find((button) => button.dataset.documentRetry === "event-b").disabled, false);
  h.retryDocument("event-a");
  assert.equal(h.requests.length, 4);
  h.requests[2].respond(center());
  await a;
  assert.equal(h.state.center.summary.documents, 42);
  assert.equal(h.buttons().every((button) => !button.disabled), true);
  assert.equal(h.requests.length, 4);
});

test("superseded retry refresh releases only its event lock while manual refresh stays busy", async () => {
  const h = harness();
  const retry = h.retryDocument("event-a");
  h.requests[0].respond({});
  await flush();
  const latest = h.load();
  const pendingTitle = h.node("#document-source-title").textContent;
  h.requests[1].respond(center(["old-event"]));
  await retry;
  assert.equal(h.node("#document-refresh").disabled, true);
  assert.equal(h.node("#document-source-title").textContent, pendingTitle);
  assert.equal(h.state.center.exceptions[0].id, "event-a");
  assert.equal(h.buttons()[0].disabled, false);
  h.requests[2].respond(center(["new-event"]));
  await latest;
  assert.equal(h.state.center.exceptions[0].id, "new-event");
});

test("latest malformed scope keeps existing fallback and a later read can recover", async () => {
  const h = harness();
  const malformed = h.load();
  h.requests[0].respond({ ...center(), scope: null });
  await malformed;
  assert.equal(h.state.source, "fallback");
  assert.equal(h.node("#document-refresh").disabled, false);
  const recovery = h.load();
  h.requests[1].respond(center());
  await recovery;
  assert.equal(h.state.source, "api");
});

test("latest render failure keeps refresh releasable and does not poison subsequent reads", async () => {
  const h = harness();
  const node = h.node("#document-metrics");
  const replace = node.replaceChildren;
  node.replaceChildren = () => { throw new Error("synthetic current render failure"); };
  const failed = h.load();
  h.requests[0].respond(center());
  await assert.rejects(failed, /synthetic current render failure/);
  assert.equal(h.node("#document-refresh").disabled, false);
  node.replaceChildren = replace;
  const recovery = h.load();
  h.requests[1].respond(center(["recovered-event"]));
  await recovery;
  assert.equal(h.state.center.exceptions[0].id, "recovered-event");
});

test("file reads remain read-only fallback without network or retry commands", async () => {
  const h = harness({ protocol: "file:" });
  await h.load();
  await h.load();
  assert.equal(h.state.source, "fallback");
  assert.equal(h.node("#document-refresh").disabled, false);
  assert.equal(h.buttons().length, 0);
  await h.retryDocument("event-a");
  assert.equal(h.requests.length, 0);
});

test("read generations are local to each document center instance", async () => {
  const a = harness();
  const b = harness();
  const aLoad = a.load();
  const bLoad = b.load();
  b.requests[0].respond(center(["b-event"]));
  await bLoad;
  a.requests[0].respond(center(["a-event"]));
  await aLoad;
  assert.equal(a.state.center.exceptions[0].id, "a-event");
  assert.equal(b.state.center.exceptions[0].id, "b-event");
});
