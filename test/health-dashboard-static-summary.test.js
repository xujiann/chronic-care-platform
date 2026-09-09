"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const applications = require("../health-dashboard-applications");

const source = fs.readFileSync(path.join(__dirname, "..", "health-dashboard.js"), "utf8");

function harness({ protocol = "file:", state = {}, request } = {}) {
  const metrics = { innerHTML: "" };
  let snapshotReads = 0;
  const context = vm.createContext({
    location: { protocol },
    document: { addEventListener() {}, querySelector: () => metrics },
    window: { HealthDashboardApplications: applications, HealthCityAuth: { authFetch: request } },
    loadPlatformState: async () => { snapshotReads += 1; return state; },
    fetch: async () => { throw new Error("unexpected fetch"); }
  });
  vm.runInContext(source, context, { filename: "health-dashboard.js" });
  return {
    context, metrics,
    build(data) { context.fixture = data; return vm.runInContext("buildStaticDashboardSummary(fixture)", context); },
    load: () => vm.runInContext("loadDashboardSummary()", context),
    snapshotReads: () => snapshotReads,
    renderMetrics(report) { context.report = report; vm.runInContext("renderMetrics(report)", context); }
  };
}

function tasks(count, { prefix = "task", highFrom = 12, status = "pending" } = {}) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index}`, status, priority: index >= highFrom ? "high" : "normal"
  }));
}

test("static source totals and risks include open tasks beyond the twelve-row preview", () => {
  const ui = harness();
  const report = ui.build({ followups: tasks(20) });
  assert.equal(report.totals.sourceOpenActions, 20);
  assert.equal(report.totals.highRisks, 8);
  assert.equal(report.totals.openActions, 12);
  assert.equal(report.totals.previewOpenActions, 12);
  assert.deepEqual(Array.from(report.openActions, (item) => item.id), tasks(12).map((item) => item.id));
  const app = report.applications.find((item) => item.id === "chronic-followup");
  assert.equal(app.openActions, 20);
  assert.equal(app.highRisks, 8);
  const risk = report.risks.find((item) => item.applicationId === app.id);
  assert.equal(risk.openActions, 20);
  assert.equal(risk.highRisks, 8);
  assert.match(risk.nextAction, /高风险/);
  assert.equal(report.riskDrilldowns.items.length, 8);
  assert.equal(report.jurisdictionScope.summary.openActions, 12);
  assert.equal(report.actionClosureTrend.summary.open, 20);
  assert.equal(report.actionClosureTrend.summary.previewOpenActions, 12);
  assert.equal(report.totals.productionReady, false);
});

test("an application absent from the preview still contributes its source count and risks", () => {
  const report = harness().build({
    followups: tasks(12), insuranceClaims: tasks(3, { prefix: "claim", highFrom: 0 })
  });
  const app = report.applications.find((item) => item.id === "drug-consumable-supervision");
  assert.equal(report.openActions.some((item) => item.applicationId === app.id), false);
  assert.equal(app.openActions, 3);
  assert.equal(app.highRisks, 3);
  assert.equal(report.totals.sourceOpenActions, 15);
  assert.equal(report.totals.highRisks, 3);
  assert.equal(report.risks.find((item) => item.applicationId === app.id).highRisks, 3);
  assert.equal(report.applications.reduce((sum, item) => sum + item.openActions, 0), report.totals.sourceOpenActions);
});

test("source counts remain independent of preview order while display order is unchanged", () => {
  const rows = tasks(20);
  const first = harness().build({ followups: rows });
  const reversed = harness().build({ followups: [...rows].reverse() });
  assert.equal(first.totals.sourceOpenActions, reversed.totals.sourceOpenActions);
  assert.equal(first.totals.highRisks, reversed.totals.highRisks);
  assert.equal(first.totals.highRisks, 8);
  assert.equal(first.openActions[0].id, "task-0");
  assert.equal(reversed.openActions[0].id, "task-19");
});

test("closed tasks remain outside source-open statistics without changing closure history or input", () => {
  const state = { followups: [...tasks(15), ...tasks(3, { prefix: "closed", highFrom: 0, status: "completed" })] };
  const before = JSON.stringify(state);
  state.followups.forEach(Object.freeze);
  Object.freeze(state.followups);
  Object.freeze(state);
  const report = harness().build(state);
  assert.equal(report.totals.sourceOpenActions, 15);
  assert.equal(report.totals.highRisks, 3);
  assert.equal(report.totals.sourceRecords, 18);
  assert.equal(report.actionClosureTrend.summary.total, 18);
  assert.equal(report.actionClosureTrend.summary.closed, 3);
  assert.equal(report.actionClosureTrend.summary.highRisks, 6);
  assert.equal(JSON.stringify(state), before);
});

test("zero, below-limit and exact-limit snapshots retain matching source and preview counts", () => {
  for (const count of [0, 1, 11, 12]) {
    const report = harness().build({ followups: tasks(count, { highFrom: 0 }) });
    assert.equal(report.totals.sourceOpenActions, count);
    assert.equal(report.totals.previewOpenActions, count);
    assert.equal(report.totals.highRisks, count);
  }
  for (const state of [{}, { followups: null, careOrders: {}, insuranceClaims: "not-an-array" }]) {
    const report = harness().build(state);
    assert.equal(report.totals.sourceOpenActions, 0);
    assert.equal(report.totals.highRisks, 0);
    assert.equal(report.openActions.length, 0);
    assert.equal(report.risks.length, 0);
  }
});

test("the real snapshot loader and metric renderer distinguish full source counts from preview", async () => {
  const ui = harness({ state: { followups: tasks(20) } });
  const report = await ui.load();
  assert.equal(ui.snapshotReads(), 1);
  assert.equal(report.sourceMode, "static");
  assert.equal(report.totals.sourceOpenActions, 20);
  ui.renderMetrics(report);
  assert.match(ui.metrics.innerHTML, /源待办<\/span><strong>20<\/strong>/);
  assert.match(ui.metrics.innerHTML, /预览待办<\/span><strong>12<\/strong>/);
  assert.match(ui.metrics.innerHTML, /高风险<\/span><strong>8<\/strong>/);
});

test("valid API summaries remain authoritative and do not read or recompute the static snapshot", async () => {
  const apiReport = { ok: true, totals: { sourceOpenActions: 77, previewOpenActions: 5, highRisks: 19 } };
  const calls = [];
  const ui = harness({ protocol: "https:", state: { followups: tasks(20) }, request: async (url) => {
    calls.push(url);
    return { ok: true, json: async () => apiReport };
  } });
  const report = await ui.load();
  assert.equal(report, apiReport);
  assert.equal(report.totals.sourceOpenActions, 77);
  assert.equal(report.totals.highRisks, 19);
  assert.equal(report.sourceMode, "api");
  assert.equal(ui.snapshotReads(), 0);
  assert.deepEqual(calls, ["/api/health-dashboard/summary"]);
});
