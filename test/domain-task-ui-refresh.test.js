"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const SOURCE = fs.readFileSync(path.join(ROOT, "domain-task-ui.js"), "utf8");
const settle = () => new Promise(setImmediate);

class Element {
  constructor(tag = "div") {
    this.tagName = tag;
    this.dataset = {};
    this.children = [];
    this.listeners = {};
    this.value = "";
    this.textContent = "";
  }
  append(...nodes) {
    nodes.forEach((node) => { node.parent = this; this.children.push(node); });
  }
  replaceChildren(...nodes) {
    if (this.failNextRender) { this.failNextRender = false; throw new Error("render unavailable"); }
    this.children = [];
    this.append(...nodes);
  }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  closest(selector) {
    const key = { "[data-action-id]": "actionId", "[data-select-id]": "selectId" }[selector];
    return key && this.dataset[key] ? this : this.parent?.closest(selector) || null;
  }
  set innerHTML(_value) { throw new Error("HTML parsing is forbidden"); }
}

function descendants(node) { return [node, ...node.children.flatMap(descendants)]; }

function harness() {
  const nodes = Object.fromEntries([
    "status", "error", "metrics"
  ].map((id) => [`#domain-workbench-${id}`, new Element()]));
  for (const id of ["task-list", "task-detail", "status-filter", "keyword-filter", "refresh"]) {
    nodes[`#domain-${id}`] = new Element();
  }
  const events = {};
  const document = {
    readyState: "complete",
    createElement: (tag) => new Element(tag),
    querySelector: (selector) => nodes[selector] || null,
    addEventListener: (type, listener) => { events[type] = listener; }
  };
  const calls = { reads: [], writes: [] };
  let payload = [{ id: "task-1", title: "示范任务", status: "pending" }];
  let readError;
  let writeError;
  const client = {
    async get(url) { calls.reads.push(url); if (readError) throw readError; return { data: payload }; },
    async post(url, body) { calls.writes.push({ url, body }); if (writeError) throw writeError; return { data: { saved: true } }; }
  };
  const window = { document, HealthPlatformApi: { createClient: () => client }, HealthCityAuth: { getUser: () => ({ role: "commission" }) } };
  const context = vm.createContext({ window });
  vm.runInContext(SOURCE, context);
  let controller;
  const start = window.DomainTaskUI.start;
  window.DomainTaskUI = { ...window.DomainTaskUI, start(config) { controller = start(config); return controller; } };
  return {
    nodes, calls,
    get controller() { return controller; },
    get status() { return nodes["#domain-workbench-status"].textContent; },
    get error() { return nodes["#domain-workbench-error"].textContent; },
    setPayload(value) { payload = value; },
    failRead(error) { readError = error; },
    failWrite(error) { writeError = error; },
    async start(overrides = {}) {
      window.DomainTaskUI.start({ load: (api) => api.get("/tasks").then((result) => result.data), rows: (data) => data,
        normalize: (row) => row, actions: [{ id: "save", label: "保存", run: (api, row) => api.post(`/tasks/${row.id}`, { status: "closed" }) }], ...overrides });
      await settle();
    },
    async boot(file) { vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), context); await settle(); },
    async clickAction() {
      const button = descendants(nodes["#domain-task-list"]).find((node) => node.dataset.actionId);
      assert.ok(button, "the real renderer must expose an action button");
      events.click({ target: button });
      await settle();
    },
    async refresh() { await nodes["#domain-refresh"].listeners.click(); }
  };
}

function assertRefreshFailure(ui) {
  assert.equal(ui.status, "操作未完成");
  assert.match(ui.error, /已由业务接口保存/);
  assert.match(ui.error, /刷新失败/);
  assert.match(ui.error, /刷新核对/);
  assert.doesNotMatch(ui.error, /提交失败|保存并刷新|请.*重新提交/);
  assert.equal(ui.controller.state.rows.length, 0);
  assert.equal(descendants(ui.nodes["#domain-task-list"]).filter((node) => node.dataset.actionId).length, 0);
  assert.match(ui.nodes["#domain-task-detail"].children[0].textContent, /选择一项任务/);
  assert.equal(ui.nodes["#domain-workbench-metrics"].children[0].children[1].textContent, "0");
}

for (const mode of ["403", "500", "network", "rows", "normalize", "render"]) {
  test(`successful write followed by ${mode} refresh failure cannot report refreshed success`, async () => {
    const ui = harness();
    let failProjection = false;
    await ui.start({
      rows(data) { if (failProjection && mode === "rows") throw new Error("invalid rows"); return data; },
      normalize(row) { if (failProjection && mode === "normalize") throw new Error("invalid row"); return row; }
    });
    if (["403", "500", "network"].includes(mode)) ui.failRead(new Error(mode));
    failProjection = true;
    if (mode === "render") ui.nodes["#domain-task-list"].failNextRender = true;
    await ui.clickAction();
    assert.equal(ui.calls.writes.length, 1);
    assert.equal(ui.calls.reads.length, 2);
    assertRefreshFailure(ui);
    ui.nodes["#domain-keyword-filter"].listeners.input();
    ui.nodes["#domain-status-filter"].listeners.change();
    assertRefreshFailure(ui);
  });
}

test("submission failure keeps its distinct error and does not refresh or invent a saved result", async () => {
  const ui = harness();
  await ui.start();
  ui.failWrite(new Error("write rejected"));
  await ui.clickAction();
  assert.match(ui.error, /提交失败/);
  assert.doesNotMatch(ui.error, /已由业务接口保存/);
  assert.equal(ui.calls.writes.length, 1);
  assert.equal(ui.calls.reads.length, 1);
  assert.equal(ui.controller.state.rows.length, 1);
});

test("successful and empty refreshes return explicit success and preserve action feedback", async () => {
  const ui = harness();
  await ui.start();
  assert.equal((await ui.controller.load()).ok, true);
  ui.setPayload([]);
  await ui.clickAction();
  assert.match(ui.status, /已由业务接口保存并刷新/);
  assert.equal(ui.error, "");
  assert.equal(ui.controller.state.rows.length, 0);
  assert.equal((await ui.controller.load()).ok, true);
  assert.equal(ui.calls.writes.length, 1);
});

test("load failures resolve without throwing and manual refresh recovers without another write", async () => {
  const ui = harness();
  await ui.start();
  const hostile = '<img src=x onerror="globalThis.compromised=true">';
  ui.failRead(new Error(hostile));
  await ui.clickAction();
  assertRefreshFailure(ui);
  const result = await ui.controller.load();
  assert.equal(result.ok, false);
  assert.match(result.error, /加载失败/);
  assert.ok(ui.error.includes(hostile), "errors remain inert text, never HTML");
  ui.failRead(null);
  await ui.refresh();
  assert.match(ui.status, /已从业务接口刷新/);
  assert.equal(ui.error, "");
  assert.equal(ui.controller.state.rows.length, 1);
  assert.equal(ui.calls.writes.length, 1);
});

const callers = [
  ["maternal-child.js", { certificates: [{ id: "birth-1", status: "待签发" }] }, "/workflow-actions"],
  ["referral-teleconsultation.js", { teleconsultations: [{ id: "referral-1", status: "pending" }] }, "/referral-teleconsultations/referral-1/actions"],
  ["drug-consumable.js", { rows: [{ id: "drug-1", status: "pending" }] }, "/drug-consumable-supervision/drug-1/review"],
  ["research-sandbox.js", { datasets: [{ id: "research-1", status: "requested" }] }, "/research/datasets/research-1/approval"],
  ["public-health-supervision-cases.js", { cases: [{ id: "case-1", status: "立案" }] }, "/public-health/supervision/cases/case-1/actions"]
];
for (const [file, payload, writePath] of callers) {
  test(`${file}: unchanged real caller preserves its command and refresh failure boundary`, async () => {
    const ui = harness();
    ui.setPayload(payload);
    await ui.boot(file);
    assert.equal(ui.calls.reads.length, 1);
    assert.equal(ui.controller.state.rows.length, 1);
    ui.failRead(new Error("refresh unavailable"));
    await ui.clickAction();
    assert.equal(ui.calls.writes.length, 1);
    assert.equal(ui.calls.writes[0].url, writePath);
    assert.equal(ui.calls.reads.length, 2);
    assertRefreshFailure(ui);
    ui.failRead(null);
    assert.equal((await ui.controller.load()).ok, true);
    assert.equal(ui.calls.writes.length, 1);
  });
}
