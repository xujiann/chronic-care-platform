"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildProductOperationsCenter,
  summarizeMonitoring,
  summarizeReplication,
  validateProgram
} = require("../src/platform/productization/product-operations-center");
const { buildProductOperationsViewModel } = require("../src/platform/productization/product-operations-view-model");
const operationsUi = require("../product-operations-ui");

const PROGRAM = Object.freeze({
  schemaVersion: "product-operations-program-v1",
  requiredSections: ["work-items", "frontend", "monitoring", "nonfunctional", "regional-replication"],
  minimumProjectedWorkItems: 1,
  maximumVisibleWorkItems: 1,
  frontendAsset: { file: "product-operations-ui.js", maximumBytes: 12000, maximumLines: 250 },
  minimumReplicationSites: 2,
  requiredMonitoringChecks: ["monitoring:routes", "monitoring:productionBoundary"],
  externalBlockers: ["signed-site-acceptance-pending"]
});

function monitoringFixture(overrides = {}) {
  return {
    ok: true,
    productionReady: false,
    status: "adapter-foundation-ready-site-acceptance-pending",
    summary: { routes: 5, controls: 6, blockers: 2 },
    checks: [
      { id: "monitoring:routes", passed: true, detail: "must-not-project-raw-route-details" },
      { id: "monitoring:productionBoundary", passed: true, detail: "must-not-project-receiver-address" }
    ],
    rawAlertPayload: { patientName: "must-not-project" },
    ...overrides
  };
}

function replicationFixture(overrides = {}) {
  return {
    ok: true,
    technicalReady: true,
    productionReady: false,
    sites: [
      { siteId: "production-candidate", regionCode: "210200", stage: "production", deploymentClass: "production", hostId: "must-not-project-host", serviceUser: "must-not-project-user" },
      { siteId: "validation-fixture", regionCode: "990001", stage: "validation", deploymentClass: "test", directories: { data: "must-not-project-path" } }
    ],
    ...overrides
  };
}

function nonfunctionalFixture(overrides = {}) {
  return {
    ok: true,
    productionReady: false,
    summary: { assets: 6, assetsWithinBudget: 6, testFiles: 400, routeFiles: 50 },
    checks: [{ id: "nonfunctional:frontendBudgets", passed: true }],
    externalGates: ["load-and-capacity-test"],
    ...overrides
  };
}

function dataFixture() {
  return {
    publicHealthCommandTasks: [
      { id: "task-operations-1", status: "pending", priority: "high", residentId: "must-not-project-resident", title: "must-not-project-title" },
      { id: "task-operations-2", status: "pending", priority: "normal" }
    ]
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

test("product operations center unifies five local control sections without exposing payloads", () => {
  const report = buildProductOperationsCenter(dataFixture(), {
    program: PROGRAM,
    now: "2026-08-17T08:00:00.000Z",
    monitoring: monitoringFixture(),
    replication: replicationFixture(),
    nonfunctional: nonfunctionalFixture()
  });
  assert.equal(report.ok, true);
  assert.equal(report.localControlReady, true);
  assert.equal(report.productionReady, false);
  assert.equal(report.frontend.sections.length, 5);
  assert.equal(report.frontend.workItems.length, 1);
  assert.equal(report.frontend.asset.withinBudget, true);
  assert.equal(report.replication.summary.sites, 2);
  assert.equal(report.monitoring.requiredChecks.length, 2);
  assert.equal(report.containsBusinessPayload, false);
  assert.doesNotMatch(JSON.stringify(report), /must-not-project|residentId|rawAlertPayload|hostId|serviceUser|directories/);
});

test("product operations center fails closed when monitoring or replication evidence is absent", () => {
  const report = buildProductOperationsCenter(dataFixture(), {
    program: PROGRAM,
    monitoring: monitoringFixture({ ok: false, checks: [] }),
    nonfunctional: nonfunctionalFixture()
  });
  assert.equal(report.ok, false);
  assert.equal(report.localControlReady, false);
  assert.equal(report.siteReady, false);
  assert.equal(report.productionReady, false);
  assert.equal(report.frontend.status, "blocked");
  assert.equal(report.checks.find((check) => check.id === "operations:monitoring").passed, false);
  assert.equal(report.checks.find((check) => check.id === "operations:regionalReplication").passed, false);
});

test("monitoring and replication summaries expose only allowlisted metadata", () => {
  const monitoring = summarizeMonitoring(monitoringFixture(), PROGRAM.requiredMonitoringChecks);
  const replication = summarizeReplication(replicationFixture(), 2);
  assert.deepEqual(Object.keys(monitoring).sort(), ["boundary", "ok", "productionReady", "requiredChecks", "schemaVersion", "status", "summary"].sort());
  assert.deepEqual(Object.keys(replication.sites[0]).sort(), ["deploymentClass", "productionReady", "regionCode", "siteId", "stage"].sort());
  assert.equal(monitoring.productionReady, false);
  assert.equal(replication.productionReady, false);
});

test("product operations program and view model enforce bounded frontend input", () => {
  assert.equal(validateProgram(PROGRAM), true);
  assert.throws(() => validateProgram({ ...PROGRAM, requiredSections: ["monitoring"] }), /requires five sections/);
  assert.throws(() => buildProductOperationsViewModel({}, { maximumVisibleWorkItems: 0 }), /between 1 and 50/);
});

test("standalone product operations UI escapes every projected value", () => {
  const viewModel = buildProductOperationsViewModel({
    workItems: {
      ok: true,
      summary: { open: 1, blocked: 0 },
      items: [{ id: "wi-safe", label: "<img src=x onerror=alert(1)>", domain: "public-health", status: "queued", priority: "high", version: 0 }]
    },
    monitoring: { ok: true, summary: { controls: 6 } },
    nonfunctional: { ok: true, summary: { assetsWithinBudget: 6 } },
    replication: { ok: true, summary: { sites: 2 } }
  });
  const html = operationsUi.render(viewModel);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img/);
  const target = createFakeMountTarget();
  assert.equal(operationsUi.mount(viewModel, target), target);
  const section = target.children[0];
  const metric = section.children[0].children[0];
  const workItem = section.children[1].children[0];
  assert.equal(section.dataset.productOperationsStatus, viewModel.status);
  assert.equal(metric.children[0].textContent, "1");
  assert.equal(metric.children[1].textContent, "开放事项");
  assert.equal(workItem.dataset.productOperationItem, "wi-safe");
  assert.equal(workItem.children[0].textContent, "<img src=x onerror=alert(1)>");
  assert.throws(() => operationsUi.mount(viewModel, { innerHTML: "" }), /mount target is invalid/);
});
