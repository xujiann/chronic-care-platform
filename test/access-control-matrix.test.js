"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const policy = require("../access-control-policy");

const ROOT = path.resolve(__dirname, "..");

function loadDemoUsers() {
  const values = new Map();
  const sandbox = {
    URL,
    URLSearchParams,
    Date,
    Set,
    console,
    encodeURIComponent,
    fetch: async () => { throw new Error("unexpected fetch"); },
    location: {
      protocol: "file:",
      hostname: "",
      origin: "null",
      pathname: "/login.html",
      search: ""
    },
    localStorage: {
      getItem(key) { return values.has(key) ? values.get(key) : null; },
      setItem(key, value) { values.set(key, String(value)); },
      removeItem(key) { values.delete(key); }
    },
    document: {
      body: { dataset: { authPage: "login" } },
      addEventListener() {},
      querySelectorAll() { return []; }
    },
    window: { location: {}, HealthAccessPolicy: policy }
  };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, "auth.js"), "utf8"), sandbox, { filename: "auth.js" });
  return sandbox.window.HealthCityAuth.demoUsers;
}

test("every demo identity has an authorized deterministic home and menu", () => {
  const users = loadDemoUsers();
  assert.equal(users.length, 17);
  for (const user of users) {
    const home = policy.homeForUser(user);
    assert.equal(policy.canAccessPage(home, user), true, `${user.username} home ${home} must be allowed`);
    const menu = policy.pagesForUser(user, {}, { includeHome: true });
    assert.ok(menu.length > 0, `${user.username} must receive at least one menu entry`);
    for (const item of menu) {
      assert.equal(policy.canAccessPage(item.page, user), true, `${user.username} menu ${item.page} must be authorized`);
    }
  }
});

test("login catalog presents unique neutral accounts and hides compatibility aliases", () => {
  const users = loadDemoUsers();
  const visible = users.filter((user) => user.catalogVisible !== false);
  assert.equal(visible.length, 16);
  assert.equal(new Set(visible.map((user) => user.username)).size, visible.length);
  assert.equal(new Set(visible.map((user) => user.accountCode)).size, visible.length);
  assert.equal(visible.some((user) => user.username === "health"), true);
  assert.equal(visible.some((user) => user.username === "whjw"), false);
  assert.equal(users.find((user) => user.username === "whjw").legacyAliasFor, "health");
  for (const user of visible) {
    assert.ok(user.accountCode, `${user.username} must have a stable account code`);
    assert.ok(user.accountType, `${user.username} must have an explicit account type`);
    assert.ok(user.roleName, `${user.username} must have a distinct岗位 name`);
    assert.ok(user.orgName, `${user.username} must have an organization display name`);
    assert.doesNotMatch(
      [user.name, user.roleName, user.orgName, user.dataScope].join(" "),
      /大连|Dalian|中山区|青泥洼桥/,
      `${user.username} login presentation must stay region-neutral`
    );
  }
});

test("the complete demo identity by page matrix is fail-closed and internally consistent", () => {
  const users = loadDemoUsers();
  const pages = Object.keys(policy.pageCatalog);
  let evaluated = 0;
  for (const user of users) {
    for (const page of pages) {
      const decision = policy.accessDecision(page, user);
      assert.equal(typeof decision.allowed, "boolean");
      assert.ok(decision.reason);
      assert.equal(policy.canAccessPage(page, user), decision.allowed);
      evaluated += 1;
    }
  }
  assert.equal(evaluated, users.length * pages.length);
  assert.ok(evaluated >= 17 * 44);
});

test("anonymous and unknown identities cannot enter protected business pages", () => {
  const protectedPages = Object.entries(policy.pageCatalog)
    .filter(([, entry]) => !entry.public)
    .map(([page]) => page);
  assert.ok(protectedPages.length > 30);
  for (const page of protectedPages) {
    assert.equal(policy.accessDecision(page, null).reason, "LOGIN_REQUIRED", page);
    assert.equal(policy.accessDecision(page, { role: "superadmin" }).reason, "UNKNOWN_ROLE", page);
  }
  assert.equal(policy.accessDecision("future-module.html", { role: "commission" }).reason, "PAGE_NOT_REGISTERED");
});

test("high-risk professional workstations remain account-type scoped", () => {
  const users = loadDemoUsers();
  const doctors = users.filter((user) => policy.normalizeAccountType(user) === "doctor");
  const nonDoctors = users.filter((user) => user.role === "institution" && policy.normalizeAccountType(user) !== "doctor");
  assert.ok(doctors.length >= 2);
  assert.ok(nonDoctors.length >= 3);
  doctors.forEach((user) => assert.equal(policy.canAccessPage("doctor.html", user), true));
  nonDoctors.forEach((user) => assert.equal(policy.canAccessPage("doctor.html", user), false));
});
