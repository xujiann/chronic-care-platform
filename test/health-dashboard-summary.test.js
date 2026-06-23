const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  APPLICATIONS,
  buildHealthDashboardSummary,
  renderMarkdown
} = require("../scripts/health-dashboard-summary");

const ROOT = path.resolve(__dirname, "..");

test("health dashboard summary aggregates the first seven applications without replacing them", () => {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8"));
  const report = buildHealthDashboardSummary({ data });

  assert.equal(report.ok, true);
  assert.equal(APPLICATIONS.length, 7);
  assert.equal(report.applications.length, 7);
  assert.equal(report.applications.every((item) => item.entry.endsWith(".html")), true);
  assert.equal(report.applications.every((item) => /source application/.test(item.boundary)), true);
  assert.equal(report.totals.sourceRecords > 0, true);
  assert.equal(report.totals.interfaceTracks >= 4, true);
  assert.equal(report.totals.evidenceRecords >= 2, true);
  assert.equal(report.checks.some((item) => item.id === "dashboard:source-boundary" && item.passed), true);

  const markdown = renderMarkdown(report);
  assert.match(markdown, /Health dashboard summary/);
  assert.match(markdown, /commission-supervision/);
  assert.match(markdown, /operations-workbench/);
  assert.match(markdown, /Open action preview/);
});

test("health dashboard summary supports empty source application boundaries", () => {
  const report = buildHealthDashboardSummary({
    data: {
      platformInterfaces: [{ id: "if-demo", domain: "demo", owner: "team", status: "ready", next: "site signoff" }],
      platformEvidence: [{ id: "ev-demo", records: [{ owner: "team", status: "ready", testRecord: "demo" }, { owner: "team", status: "ready", testRecord: "demo2" }] }]
    }
  });

  assert.equal(report.applications.some((item) => item.status === "empty-ready"), true);
  assert.equal(report.scope.role, "summary-entry-for-seven-applications");
  assert.equal(report.checks.some((item) => item.id === "dashboard:source-boundary" && item.passed), true);
});
