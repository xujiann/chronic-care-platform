"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const SOURCE = fs.readFileSync(path.join(ROOT, "health-dashboard-about.js"), "utf8");
const HOSTILE_TEXT = '<img data-dashboard-about-xss src=x onerror="globalThis.dashboardAboutCompromised=true">';

function createElement(tagName) {
  return {
    tagName: String(tagName).toUpperCase(),
    className: "",
    dataset: {},
    textContent: "",
    children: [],
    innerHTMLWrites: 0,
    activeMarkupCount: 0,
    set innerHTML(value) {
      this.innerHTMLWrites += 1;
      this.activeMarkupCount = (String(value).match(/<img\b/gi) || []).length;
    },
    append(...children) {
      this.children.push(...children);
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    replaceChildren(...children) {
      this.children = children;
      this.activeMarkupCount = 0;
    }
  };
}

function createHarness() {
  const selectors = [
    "#dashboard-about-function-report",
    "#dashboard-about-department-matrix",
    "#dashboard-about-city-county-matrix",
    "#dashboard-about-release-evidence",
    "#dashboard-about-onsite-boundaries"
  ];
  const targets = new Map(selectors.map((selector) => [selector, createElement("div")]));
  const document = {
    addEventListener() {},
    createElement,
    querySelector(selector) {
      return targets.get(selector) || null;
    }
  };
  const context = vm.createContext({
    console,
    document,
    fetch: async () => { throw new Error("unexpected fetch"); },
    window: {}
  });
  vm.runInContext(SOURCE, context, { filename: "health-dashboard-about.js" });
  return { context, targets };
}

function collectText(node) {
  return [node.textContent, ...node.children.flatMap(collectText)];
}

test("health dashboard about renders hostile report fields as inert text and dataset values", () => {
  const { context, targets } = createHarness();
  context.report = {
    functions: [{ id: HOSTILE_TEXT, name: HOSTILE_TEXT, status: "watch", evidence: HOSTILE_TEXT, boundary: HOSTILE_TEXT }],
    departmentFunctionMatrix: [{ id: HOSTILE_TEXT, name: HOSTILE_TEXT, level: HOSTILE_TEXT, status: "watch", implemented: [HOSTILE_TEXT], nextPlan: HOSTILE_TEXT, evidence: HOSTILE_TEXT }],
    cityCountyFunctionMatrix: [{ id: HOSTILE_TEXT, agency: HOSTILE_TEXT, level: HOSTILE_TEXT, status: "watch", implemented: [HOSTILE_TEXT], nextPlan: HOSTILE_TEXT, evidence: HOSTILE_TEXT }],
    releaseEvidence: [{ id: HOSTILE_TEXT, name: HOSTILE_TEXT, evidence: HOSTILE_TEXT }],
    onsiteBoundaries: [HOSTILE_TEXT]
  };

  vm.runInContext('renderAboutRuntime(report, "api")', context);

  for (const target of targets.values()) {
    assert.equal(target.innerHTMLWrites, 0);
    assert.equal(target.activeMarkupCount, 0);
  }
  assert.equal(targets.get("#dashboard-about-function-report").children[0].dataset.aboutRuntimeFunction, HOSTILE_TEXT);
  assert.equal(targets.get("#dashboard-about-department-matrix").children[0].dataset.aboutFunctionMatrix, HOSTILE_TEXT);
  assert.equal(targets.get("#dashboard-about-city-county-matrix").children[0].dataset.aboutFunctionMatrix, HOSTILE_TEXT);
  assert.equal(targets.get("#dashboard-about-release-evidence").children[0].dataset.aboutRuntimeEvidence, HOSTILE_TEXT);
  for (const selector of ["#dashboard-about-function-report", "#dashboard-about-department-matrix", "#dashboard-about-city-county-matrix", "#dashboard-about-onsite-boundaries"]) {
    assert.equal(collectText(targets.get(selector)).includes(HOSTILE_TEXT), true);
  }
  assert.equal(targets.get("#dashboard-about-release-evidence").children[0].textContent, `${HOSTILE_TEXT}：${HOSTILE_TEXT}`);
  assert.equal(context.dashboardAboutCompromised, undefined);
});

test("health dashboard about preserves fixed empty states and clears stale children without HTML parsing", () => {
  const { context, targets } = createHarness();
  for (const target of targets.values()) target.appendChild(createElement("legacy"));

  context.report = {};
  vm.runInContext('renderAboutRuntime(report, "static")', context);

  const functions = targets.get("#dashboard-about-function-report");
  assert.equal(functions.children.length, 1);
  assert.equal(functions.children[0].dataset.aboutRuntimeFunction, "empty-runtime-report");
  assert.equal(functions.children[0].children[1].textContent, "等待模块功能报告");
  for (const selector of ["#dashboard-about-department-matrix", "#dashboard-about-city-county-matrix"]) {
    const matrix = targets.get(selector);
    assert.equal(matrix.children.length, 1);
    assert.equal(matrix.children[0].textContent, "等待摘要接口返回机构功能矩阵。");
  }
  assert.equal(targets.get("#dashboard-about-release-evidence").children.length, 0);
  assert.equal(targets.get("#dashboard-about-onsite-boundaries").children.length, 0);
  for (const target of targets.values()) assert.equal(target.innerHTMLWrites, 0);
});

test("health dashboard about source has no generic HTML parsing sink", () => {
  assert.doesNotMatch(SOURCE, /\binnerHTML\b|insertAdjacentHTML|DOMParser|createContextualFragment/);
  assert.equal((SOURCE.match(/\.replaceChildren\(/g) || []).length, 4);
});
