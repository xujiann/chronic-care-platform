"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");

test("platform productization UI is an independent bounded module", () => {
  const html = fs.readFileSync(path.join(ROOT, "platform.html"), "utf8");
  const source = fs.readFileSync(path.join(ROOT, "platform-productization-ui.js"), "utf8");
  assert.match(html, /id="platform-productization-panel"/);
  assert.match(html, /id="platform-productization-regional-requirements"/);
  assert.match(html, /id="platform-procurement-requirement-workbench"/);
  assert.match(html, /platform-productization-ui\.js/);
  assert.match(html, /id="platform-product-operations"/);
  assert.match(html, /product-operations-ui\.js/);
  assert.match(source, /\/platform\/productization\/center/);
  assert.match(source, /正在提交…/);
  assert.match(source, /重新打开复核/);
  assert.match(source, /\/platform\/productization\/operations\/cockpit/);
  assert.match(source, /HealthPlatformProductOperationsUi\.mount/);
  assert.match(source, /report\.regionalRequirements \|\| \{ summary: \{\}, items: \[\] \}/);
  assert.match(source, /report\.requirementGovernance \|\| \{ summary: \{\}, items: \[\] \}/);
  assert.match(source, /renderRegionalRequirements/);
  assert.match(source, /renderRequirementGovernance/);
  assert.match(source, /\/platform\/productization\/requirements\/\$\{encodeURIComponent\(item\.id\)\}\/actions/);
  assert.match(source, /escapeHtml/);
  assert.doesNotMatch(source, /innerHTML\s*=\s*[^;]*(?:error|message)\.message/);
  assert.ok(Buffer.byteLength(source) < 30000);
});

function renderHarness() {
  const ids = [
    "#platform-productization-status",
    "#platform-productization-metrics",
    "#platform-productization-work-items",
    "#platform-productization-integrations",
    "#platform-productization-regional-requirements",
    "#platform-procurement-requirement-workbench",
    "#platform-productization-boundary"
  ];
  const document = {
    addEventListener() {},
    createElement(tagName) {
      return {
        tagName,
        className: "",
        dataset: {},
        innerHTML: "",
        textContent: "",
        children: [],
        addEventListener() {},
        append(...children) { this.children.push(...children); },
        replaceChildren(...children) { this.children = children; }
      };
    },
    querySelector(selector) { return elements[selector] || null; }
  };
  const elements = Object.fromEntries(ids.map((id) => {
    const element = document.createElement("div");
    element.ownerDocument = document;
    return [id, element];
  }));
  const source = fs.readFileSync(path.join(ROOT, "platform-productization-ui.js"), "utf8");
  const sandbox = { document };
  vm.runInNewContext(source, sandbox);
  return { elements, render: sandbox.HealthPlatformProductization.render };
}

function baseReport() {
  return {
    ok: true,
    dataPromotion: { summary: { promotedP0: 1, authoritative: 2, legacyBlocked: 3 } },
    workItems: { summary: { total: 4, open: 2 }, items: [] },
    institutionIntegration: { summary: { profiles: 1 }, adapters: [] },
    boundary: "local only"
  };
}

test("regional requirement rendering is optional and escapes every dynamic field", () => {
  const fixture = renderHarness();
  assert.doesNotThrow(() => fixture.render(baseReport()));
  assert.equal(fixture.elements["#platform-productization-regional-requirements"].children[0].textContent, "暂无地区需求。");

  const hostile = '<img src=x onerror="globalThis.compromised=true">';
  fixture.render({
    ...baseReport(),
    regionalRequirements: {
      summary: { requirements: hostile, p0: hostile, ownerReview: hostile },
      items: [{
        id: hostile,
        title: hostile,
        targetCapabilityIds: [hostile],
        productClass: hostile,
        decision: hostile,
        priority: hostile,
        ownerProcess: hostile,
        status: hostile,
        evidenceStatus: hostile,
        sourceLocations: [hostile]
      }]
    }
  });
  assert.match(fixture.elements["#platform-productization-metrics"].innerHTML, /&lt;img/);
  const regionalTarget = fixture.elements["#platform-productization-regional-requirements"];
  assert.equal(regionalTarget.children[0].tagName, "article");
  assert.equal(regionalTarget.children[0].children[0].textContent, hostile);
  assert.equal(regionalTarget.children.some((child) => child.tagName === "img"), false);
  assert.equal(fixture.compromised, undefined);
});

test("procurement requirement workbench is optional, minimized and DOM-safe", () => {
  const fixture = renderHarness();
  assert.doesNotThrow(() => fixture.render(baseReport()));
  assert.equal(fixture.elements["#platform-procurement-requirement-workbench"].children[0].textContent, "暂无待治理的招标需求。");

  const hostile = '<svg onload="globalThis.compromised=true">';
  fixture.render({
    ...baseReport(),
    requirementGovernance: {
      summary: { candidates: hostile, pendingReview: hostile, gaps: hostile },
      items: [{
        id: hostile,
        sourceAlias: hostile,
        title: hostile,
        sourceAnchor: { pageStart: hostile, pageEnd: hostile, section: hostile },
        targetCapabilityIds: [hostile],
        productClass: hostile,
        decision: hostile,
        priority: hostile,
        reviewStatus: "pending-review",
        version: 0,
        gap: { overall: hostile }
      }]
    }
  });
  const target = fixture.elements["#platform-procurement-requirement-workbench"];
  assert.equal(target.children[0].tagName, "article");
  assert.equal(target.children[0].children[0].textContent, hostile);
  assert.equal(target.children[0].children.at(-1).children.length, 3);
  assert.equal(target.children.some((child) => child.tagName === "svg"), false);
  assert.equal(fixture.compromised, undefined);
});
