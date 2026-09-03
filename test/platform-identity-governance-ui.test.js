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
