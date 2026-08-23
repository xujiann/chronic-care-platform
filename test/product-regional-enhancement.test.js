"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const ui = require("../product-regional-operations-ui");
const { buildProductRegionalOperationsViewModel } = require("../src/platform/productization/product-regional-operations-view-model");
const { buildProductRegionalEnhancementReadiness, parseArgs, renderMarkdown, writeReport } = require("../scripts/product-regional-enhancement-readiness");

function regionalFixtures() {
  const regionDescriptors = [
    { regionCode: "210200", deploymentClass: "production", features: [{ id: "regional.integration", enabled: true }], configKeys: ["organization"], extensions: [{ id: "adapter-one", kind: "adapter", enabled: true }] },
    { regionCode: "990001", deploymentClass: "test", features: [{ id: "regional.integration", enabled: false }], configKeys: ["organization"], extensions: [{ id: "fixture-one", kind: "policy", enabled: true }] }
  ];
  return {
    regionDescriptors,
    configuration: { ok: true, regions: regionDescriptors.map((item) => ({ regionCode: item.regionCode, technicalReady: true, summary: { configFiles: 8, enabledFeatures: 5, enabledExtensions: 4 } })) },
    replication: { ok: true, technicalReady: true, sites: regionDescriptors.map((item) => ({ regionCode: item.regionCode, siteId: `site-${item.regionCode}`, stage: item.deploymentClass === "production" ? "production" : "validation" })) },
    monitoring: { ok: true, status: "adapter-foundation-ready", summary: { routes: 5, controls: 6, blockers: 2 }, checks: [{ id: "monitoring:routes", passed: true }] },
    nonfunctional: { ok: true, productionReady: false, summary: { assets: 6, assetsWithinBudget: 6, testFiles: 500, routeFiles: 63 }, checks: [{ id: "nonfunctional:frontend", passed: true }] }
  };
}

function createFakeMountTarget() {
  const document = {
    createElement(tagName) {
      return {
        tagName,
        className: "",
        dataset: {},
        textContent: "",
        children: [],
        append(...children) {
          this.children.push(...children);
        },
        replaceChildren(...children) {
          this.children = children;
        }
      };
    }
  };
  const target = document.createElement("div");
  target.ownerDocument = document;
  return target;
}

test("six enhancement iterations report local readiness while production remains NO-GO", () => {
  const report = buildProductRegionalEnhancementReadiness({
    data: { publicHealthCommandTasks: [{ id: "task-ready-001", status: "pending", priority: "high" }] },
    now: "2026-08-17T08:00:00.000Z",
    ...regionalFixtures()
  });
  assert.equal(report.ok, true);
  assert.equal(report.iterations.length, 6);
  assert.equal(report.iterations.every((item) => item.passed), true);
  assert.equal(report.summary.iterationsPassed, 6);
  assert.equal(report.localControlReady, true);
  assert.equal(report.siteReady, false);
  assert.equal(report.productionReady, false);
  assert.equal(report.decision, "NO-GO");
  assert.match(renderMarkdown(report), /六迭代通过：6\/6/);
});

test("safe UI escapes hostile values and mounts only the fixed view model", () => {
  const viewModel = buildProductRegionalOperationsViewModel({
    ok: true,
    summary: { total: 1, breached: 0, unreadMessages: 1 },
    items: [{ id: "w2-safe", category: "<img src=x onerror=alert(1)>", domain: "public-health", priority: "high", status: "queued", slaState: "within-sla", assignedRole: "", unreadMessages: 1, version: 0, timeline: [{ action: "normalized", at: "2026-08-17T08:00:00.000Z", actorRole: "platform-governance", resultingStatus: "queued" }] }]
  }, {
    ok: true,
    summary: { regions: 1, configurationReady: 1, alertBlockers: 0 },
    alerts: { ok: true },
    regions: [{ regionCode: "210200", deploymentClass: "production", capabilities: [{ enabled: true }], configuration: { technicalReady: true }, deployment: { status: "registered" }, replication: { status: "validated" }, acceptance: { state: "pending" } }],
    configurationDiffs: []
  });
  const html = ui.render(viewModel);
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /onerror/);
  assert.match(html, /平台运行事项/);
  const target = createFakeMountTarget();
  assert.equal(ui.mount(viewModel, target), target);
  const section = target.children[0];
  const metric = section.children[0].children[0];
  const workItem = section.children[2].children[0];
  const region = section.children[4].children[0];
  assert.equal(section.dataset.productRegionalStatus, viewModel.status);
  assert.equal(metric.children[0].textContent, "1");
  assert.equal(metric.children[1].textContent, "统一事项");
  assert.equal(workItem.dataset.productWorkItemV2, "w2-safe");
  assert.equal(workItem.children[0].textContent, "平台运行事项");
  assert.equal(workItem.children[3].children[0].textContent, "2026-08-17T08:00:00.000Z · platform-governance · normalized · queued");
  assert.equal(region.dataset.regionCode, "210200");
  assert.equal(region.children[0].textContent, "地区 210200");
  assert.throws(() => ui.render({ schemaVersion: "unknown" }), /invalid/);
  assert.throws(() => ui.mount(viewModel, { innerHTML: "" }), /mount target is invalid/);
});

test("readiness helpers write deterministic review artifacts without changing the production decision", () => {
  const report = buildProductRegionalEnhancementReadiness({ data: {}, now: "2026-08-17T08:00:00.000Z", ...regionalFixtures() });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "product-regional-v2-"));
  const output = path.join(directory, "report.json");
  const markdown = path.join(directory, "report.md");
  const written = writeReport(report, { output, markdown });
  assert.deepEqual(written, { output, markdown });
  assert.equal(JSON.parse(fs.readFileSync(output, "utf8")).productionReady, false);
  assert.match(fs.readFileSync(markdown, "utf8"), /生产决策：NO-GO/);
  assert.deepEqual(parseArgs([`--output=${output}`, `--markdown=${markdown}`]), { output, markdown });
});
