"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SOURCE = fs.readFileSync(path.join(__dirname, "../digital-hospital-standard-platform/app.js"), "utf8");
const STORAGE_KEY = "digitalHospitalMvpState:v0.21";
const settle = () => new Promise(setImmediate);

function boot(options = {}) {
  const nodes = new Map();
  const observers = [];
  const documentListeners = {};
  const stored = new Map();
  const reads = [];
  const guards = [];
  const faults = new Set(options.faults || []);
  function checkFault(name) { if (faults.has(name)) throw new Error(`host failure: ${name}`); }
  let user = options.user || null;
  function element(id) {
    if (!nodes.has(id)) nodes.set(id, {
      dataset: {}, attributes: {}, value: "", textContent: "", innerHTML: "", disabled: false, listeners: {},
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); },
      getAttribute(name) { checkFault("getAttribute"); return this.attributes[name] ?? null; },
      setAttribute(name, value) {
        this.attributes[name] = String(value);
        if (name === "data-auth-resolved") this.dataset.authResolved = String(value);
        for (const observer of observers) if (observer.target === this) queueMicrotask(() => {
          if (observer.target === this) observer.callback([{ type: "attributes", attributeName: name, target: this }]);
        });
      },
      querySelector() { return null; }, querySelectorAll() { return []; }
    });
    return nodes.get(id);
  }
  const html = element("html");
  html.setAttribute("data-auth-resolved", options.resolved || "pending");
  const document = {
    readyState: "loading", documentElement: html, body: element("body"),
    getElementById: element, querySelectorAll: () => [], querySelector: () => null,
    addEventListener(type, listener) { (documentListeners[type] ||= []).push(listener); }
  };
  class MutationObserver {
    constructor(callback) { checkFault("observer-constructor"); this.callback = callback; observers.push(this); }
    observe(target) {
      checkFault("observer-observe");
      if (options.resolveDuringObserve) {
        user = options.resolveDuringObserve;
        target.setAttribute("data-auth-resolved", "allowed");
      }
      this.target = target;
    }
    disconnect() { checkFault("observer-disconnect"); this.target = null; }
  }
  const auth = {
    getUser() { checkFault("getUser"); return user; },
    requireRole(roles) { checkFault("requireRole"); guards.push("role"); return Boolean(user && roles.includes(user.role)); },
    requireAccountType(types) { checkFault("requireAccountType"); guards.push("account"); return Boolean(user && types.includes(user.accountType)); },
    initializePageAccess() { throw new Error("the app must not start a second identity hydration"); },
    refreshAuthContext() { throw new Error("the app must not refresh identity itself"); },
    isDemoMode: () => true
  };
  for (const method of options.missingMethods || []) delete auth[method];
  const location = { protocol: options.protocol || "http:", hostname: options.hostname || "localhost", pathname: "/digital-hospital-standard-platform/index.html" };
  const window = { document, location, MutationObserver, setTimeout: () => 0, clearTimeout() {} };
  if (!options.missingAuth) window.HealthCityAuth = auth;
  const context = vm.createContext({ window, document, location, MutationObserver, structuredClone,
    localStorage: { getItem(key) { reads.push(key); return stored.get(key) || null; }, setItem: (key, value) => stored.set(key, value), removeItem: (key) => stored.delete(key) },
    navigator: {}, console, setTimeout: window.setTimeout, clearTimeout: window.clearTimeout });
  vm.runInContext(SOURCE, context, { filename: "digital-hospital-standard-platform/app.js" });
  return { element, reads, stored, guards, observers, documentListeners, faults,
    async resolve(nextUser, value = "allowed") { user = nextUser; html.setAttribute("data-auth-resolved", value); await settle(); },
    async domReady() { for (const listener of documentListeners.DOMContentLoaded || []) listener(); await settle(); } };
}

function assertNotStarted(ui) {
  assert.equal(ui.reads.includes(STORAGE_KEY), false, "pending or denied authentication must not load business state");
  assert.equal(ui.element("workspace").innerHTML, "", "business views must not render before admission");
  assert.equal((ui.element("resetState").listeners.click || []).length, 0);
  assert.equal((ui.element("roleSelect").listeners.change || []).length, 0);
  assert.equal((ui.documentListeners.click || []).length, 0, "business writes must not have click handlers");
}

const manager = { role: "commission", accountType: "manager" };

test("full app waits for resolved identity, then starts once and locks the real role", async () => {
  const ui = boot({ user: { role: "institution", accountType: "manager" } });
  assertNotStarted(ui);
  await ui.domReady();
  assertNotStarted(ui);
  await ui.resolve(manager);
  assert.equal(ui.element("roleSelect").value, "省级管理员");
  assert.equal(ui.element("roleSelect").disabled, true);
  assert.ok(ui.element("workspace").innerHTML.length > 0);
  assert.equal(ui.reads.filter((key) => key === STORAGE_KEY).length, 1);
  assert.deepEqual(ui.guards, ["role", "account"]);
  await ui.resolve(manager);
  assert.equal(ui.reads.filter((key) => key === STORAGE_KEY).length, 1);
  assert.equal(ui.element("resetState").listeners.click.length, 1);
  assert.equal(ui.observers.filter((observer) => observer.target).length, 0);
  ui.element("roleSelect").value = "国家级管理员";
  ui.element("roleSelect").listeners.change[0]();
  assert.equal(ui.element("roleSelect").value, "省级管理员");
  assert.equal(ui.stored.has(STORAGE_KEY), false, "rejected role changes must not save a demo role");
});

test("already allowed identity starts immediately with the existing institution mapping", () => {
  const ui = boot({ resolved: "allowed", user: { role: "institution", accountType: "manager", orgName: "区域示例专科医院" } });
  assert.equal(ui.element("roleSelect").value, "医院管理员");
  assert.equal(ui.element("hospitalSelect").value, "H000002");
  assert.equal(ui.element("roleSelect").disabled, true);
});

for (const user of [null, { role: "citizen", accountType: "manager" }, { role: "commission", accountType: "auditor" }]) {
  test(`allowed signal alone does not admit missing or unauthorized identity: ${JSON.stringify(user)}`, async () => {
    const ui = boot();
    await ui.resolve(user);
    assertNotStarted(ui);
  });
}

test("online missing auth never falls back to demo", async () => {
  const ui = boot({ missingAuth: true, resolved: "allowed" });
  await ui.domReady();
  assertNotStarted(ui);
});

for (const failure of ["pending", "denied", "failed"]) {
  test(`non-allowed auth state ${failure} does not start even with a cached user and demo mode`, async () => {
    const ui = boot({ user: manager });
    await ui.resolve(null, failure);
    await ui.domReady();
    assertNotStarted(ui);
  });
}

test("registration-time allowed transition is rechecked without another notification", async () => {
  const ui = boot({ resolveDuringObserve: manager });
  await settle();
  assert.equal(ui.element("roleSelect").value, "省级管理员");
  assert.equal(ui.element("roleSelect").disabled, true);
  assert.equal(ui.reads.filter((key) => key === STORAGE_KEY).length, 1);
  assert.equal(ui.observers.filter((observer) => observer.target).length, 0);
});

for (const options of [{ protocol: "file:", hostname: "" }, { protocol: "https:", hostname: "example.github.io" }]) {
  test(`explicit static preview keeps its existing demo startup: ${options.protocol}${options.hostname}`, () => {
    const ui = boot({ ...options, missingAuth: true });
    assert.ok(ui.element("workspace").innerHTML.length > 0);
    assert.equal(ui.element("roleSelect").disabled, false);
    assert.equal(ui.element("roleSelect").value, "国家级管理员");
  });
}

for (const method of ["getUser", "requireRole", "requireAccountType"]) {
  test(`missing ${method} port fails closed before business startup`, () => {
    assertNotStarted(boot({ resolved: "allowed", user: manager, missingMethods: [method] }));
  });
  test(`throwing ${method} port fails closed before business startup`, () => {
    assertNotStarted(boot({ resolved: "allowed", user: manager, faults: [method] }));
  });
}

for (const fault of ["getAttribute", "observer-constructor", "observer-observe"]) {
  test(`initial ${fault} host failure does not start or throw`, () => {
    assertNotStarted(boot({ user: manager, faults: [fault] }));
  });
}

for (const fault of ["getAttribute", "observer-disconnect"]) {
  test(`observer callback ${fault} failure does not start business work`, async () => {
    const ui = boot({ user: manager });
    assertNotStarted(ui);
    ui.faults.add(fault);
    await ui.resolve(manager);
    assertNotStarted(ui);
  });
}
