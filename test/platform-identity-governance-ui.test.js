"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const policy = require("../access-control-policy");
const governance = require("../platform-identity-governance-ui");
const accounts = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8")).authUsers;

class FakeElement {
  constructor(tagName = "div") {
    this.tagName = tagName;
    this.className = "";
    this.dataset = {};
    this.children = [];
    this.textContent = "";
    this.value = "";
    this.listeners = {};
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = children;
  }

  addEventListener(type, listener) {
    this.listeners[type] ||= [];
    this.listeners[type].push(listener);
  }

  dispatch(type) {
    (this.listeners[type] || []).forEach((listener) => listener({ target: this }));
  }
}

function fixture() {
  const selectors = [
    "#identity-account-summary",
    "#identity-account-list",
    "#identity-account-filter-status",
    "#identity-account-boundary",
    "#identity-account-search",
    "#identity-account-role-filter",
    "#identity-account-status-filter"
  ];
  const elements = Object.fromEntries(selectors.map((selector) => [selector, new FakeElement()]));
  elements["#identity-account-role-filter"].value = "all";
  elements["#identity-account-status-filter"].value = "all";
  const document = {
    createElement(tagName) { return new FakeElement(tagName); },
    querySelector(selector) { return elements[selector] || null; }
  };
  return { document, elements };
}

function allText(node) {
  return [node.textContent, ...node.children.flatMap((child) => allText(child))].join(" ");
}

function account(id, overrides = {}) {
  return {
    id,
    accountCode: id,
    username: id.toLowerCase(),
    name: `${id}账号`,
    role: "commission",
    accountType: "manager",
    orgCode: "ORG-DEMO",
    orgName: "示范机构",
    dataScope: "示范数据范围",
    status: "enabled",
    externalIssuer: "https://identity.example.test",
    externalSubject: `subject-${id}`,
    home: "platform.html",
    ...overrides
  };
}

const snapshotPolicy = {
  normalizeAccountType(row) { return row.accountType; },
  pagesForUser() { return [{ group: "治理" }]; },
  normalizePageName(name) { return name; },
  homeForUser(row) { return row.home; }
};

function visibleAccountIds(list) {
  return list.children.map((child) => child.dataset.identityAccount).filter(Boolean);
}

function setFilters(elements, { query = "", role = "all", status = "all" }, eventTarget = "search") {
  elements["#identity-account-search"].value = query;
  elements["#identity-account-role-filter"].value = role;
  elements["#identity-account-status-filter"].value = status;
  const selector = eventTarget === "role"
    ? "#identity-account-role-filter"
    : eventTarget === "status"
      ? "#identity-account-status-filter"
      : "#identity-account-search";
  elements[selector].dispatch(eventTarget === "search" ? "input" : "change");
}

test("account governance derives every account function mapping from the shared access policy", () => {
  const view = governance.buildView(accounts, policy);
  assert.equal(view.schemaVersion, "identity-account-governance-view-v1");
  assert.equal(view.summary.total, 17);
  assert.equal(view.summary.enabled, 17);
  assert.equal(view.summary.mappingReady, 17);
  assert.equal(view.accounts.find((row) => row.username === "nurse").assignedFunctionCount, 10);
  assert.equal(view.accounts.find((row) => row.username === "blood_quality").assignedFunctionCount, 7);
  assert.equal(view.accounts.find((row) => row.username === "citizen").assignedFunctionCount, 11);
  assert.equal(view.accounts.find((row) => row.username === "whjw").catalogVisible, false);
  assert.match(view.accounts.find((row) => row.username === "whjw").risks.join(" "), /兼容账号不展示/);
  assert.equal(view.productionReady, false);
  assert.doesNotMatch(JSON.stringify(view), /123456|smsCode|externalSubject|externalIssuer/);
});

test("disabled accounts keep their assigned mapping but expose zero effective functions", () => {
  const disabledAccounts = accounts.map((account) => account.username === "nurse" ? { ...account, status: "停用" } : account);
  const row = governance.buildView(disabledAccounts, policy).accounts.find((account) => account.username === "nurse");
  assert.equal(row.enabled, false);
  assert.equal(row.assignedFunctionCount, 10);
  assert.equal(row.functionCount, 0);
  assert.match(row.risks.join(" "), /账号已停用/);
});

test("account governance renders a safe searchable and filterable commission view", () => {
  const { document, elements } = fixture();
  const view = governance.render(accounts, { document, policy });
  assert.equal(view.summary.total, 17);
  assert.equal(elements["#identity-account-list"].children.length, 17);
  assert.equal(elements["#identity-account-summary"].children.length, 4);
  assert.equal(elements["#identity-account-filter-status"].textContent, "当前显示 17/17 个账号");
  assert.match(allText(elements["#identity-account-list"]), /DEMO-NURSE/);
  assert.doesNotMatch(allText(elements["#identity-account-list"]), /123456/);

  elements["#identity-account-search"].value = "输血科";
  elements["#identity-account-search"].dispatch("input");
  assert.equal(elements["#identity-account-list"].children.length, 2);
  assert.equal(elements["#identity-account-filter-status"].textContent, "当前显示 2/17 个账号");

  elements["#identity-account-search"].value = "";
  elements["#identity-account-role-filter"].value = "institution";
  elements["#identity-account-role-filter"].dispatch("change");
  assert.equal(elements["#identity-account-list"].children.length, 7);
  assert.equal(elements["#identity-account-filter-status"].textContent, "当前显示 7/17 个账号");
});

test("every filter consumes the latest account snapshot and never revives removed or disabled rows", () => {
  const { document, elements } = fixture();
  const first = [
    account("REMOVED"),
    account("TRANSITION")
  ];
  const second = [
    account("CURRENT"),
    account("TRANSITION", { role: "institution", accountType: "doctor", status: "disabled" }),
    account("UNBOUND", { role: "insurance", externalIssuer: "", externalSubject: "" }),
    account("REVIEW", { role: "county", orgCode: "" })
  ];

  governance.render(first, { document, policy: snapshotPolicy });
  governance.render(second, { document, policy: snapshotPolicy });

  setFilters(elements, { query: "REMOVED" });
  assert.deepEqual(visibleAccountIds(elements["#identity-account-list"]), []);
  assert.equal(elements["#identity-account-filter-status"].textContent, "当前显示 0/4 个账号");

  setFilters(elements, { role: "institution" }, "role");
  assert.deepEqual(visibleAccountIds(elements["#identity-account-list"]), ["TRANSITION"]);

  setFilters(elements, { status: "enabled" }, "status");
  assert.deepEqual(visibleAccountIds(elements["#identity-account-list"]), ["CURRENT", "REVIEW", "UNBOUND"]);

  setFilters(elements, { status: "disabled" }, "status");
  assert.deepEqual(visibleAccountIds(elements["#identity-account-list"]), ["TRANSITION"]);

  setFilters(elements, { status: "external-unbound" }, "status");
  assert.deepEqual(visibleAccountIds(elements["#identity-account-list"]), ["UNBOUND"]);

  setFilters(elements, { status: "review" }, "status");
  assert.deepEqual(visibleAccountIds(elements["#identity-account-list"]), ["REVIEW", "TRANSITION", "UNBOUND"]);
});

test("repeated renders keep one listener per event on every filter control", () => {
  const { document, elements } = fixture();
  const snapshots = [[account("FIRST")], [account("SECOND")], [account("THIRD")]];
  snapshots.forEach((snapshot) => governance.render(snapshot, { document, policy: snapshotPolicy }));

  [
    "#identity-account-search",
    "#identity-account-role-filter",
    "#identity-account-status-filter"
  ].forEach((selector) => {
    assert.equal(elements[selector].listeners.input.length, 1);
    assert.equal(elements[selector].listeners.change.length, 1);
  });
});

test("filter state and latest snapshots stay isolated between documents", () => {
  const firstFixture = fixture();
  const secondFixture = fixture();
  const latest = [account("LATEST")];

  governance.render([account("REMOVED")], { document: firstFixture.document, policy: snapshotPolicy });
  governance.render(latest, { document: firstFixture.document, policy: snapshotPolicy });
  setFilters(firstFixture.elements, { query: "REMOVED" });
  assert.equal(firstFixture.elements["#identity-account-filter-status"].textContent, "当前显示 0/1 个账号");

  governance.render(latest, { document: secondFixture.document, policy: snapshotPolicy });
  assert.deepEqual(visibleAccountIds(secondFixture.elements["#identity-account-list"]), ["LATEST"]);
  assert.equal(secondFixture.elements["#identity-account-filter-status"].textContent, "当前显示 1/1 个账号");
});

test("hostile fields in the latest snapshot remain inert text after filtering", () => {
  const { document, elements } = fixture();
  const hostile = '<img src=x onerror="globalThis.__identityGovernanceCompromised=true"><script>bad()</script>';
  governance.render([account("SAFE")], { document, policy: snapshotPolicy });
  governance.render([account(hostile, { name: hostile, orgName: hostile, dataScope: hostile })], { document, policy: snapshotPolicy });

  setFilters(elements, { query: "onerror" });
  const list = elements["#identity-account-list"];
  assert.equal(list.children.length, 1);
  assert.match(allText(list), /<img src=x onerror=/);
  assert.match(allText(list), /<script>bad\(\)<\/script>/);
  const tags = [];
  (function collect(node) {
    tags.push(String(node.tagName).toLowerCase());
    node.children.forEach(collect);
  })(list);
  assert.equal(tags.includes("img"), false);
  assert.equal(tags.includes("script"), false);
  assert.equal(globalThis.__identityGovernanceCompromised, undefined);
});
