const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  APPLICATIONS,
  buildHealthDashboardSummary,
  buildPriorityApplicationTemplates,
  renderMarkdown
} = require("../scripts/health-dashboard-summary");

const ROOT = path.resolve(__dirname, "..");

test("health dashboard summary tracks the eight priority applications without replacing source workflows", () => {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8"));
  const report = buildHealthDashboardSummary({ data });

  assert.equal(report.ok, true);
  assert.equal(APPLICATIONS.length, 8);
  assert.equal(report.applications.length, 8);
  assert.equal(report.totals.sourceApplications, 7);
  assert.equal(report.applications.every((item) => item.entry.endsWith(".html")), true);
  assert.equal(report.applications.every((item) => item.functionalBoundary && item.reusePoints.length && item.dataCollections.length && item.apiRoutes.length && item.frontendEntry && item.testEvidence.length && item.acceptanceEvidence.length), true);
  assert.equal(report.applications.filter((item) => item.id !== "health-dashboard").every((item) => /source application/.test(item.boundary)), true);
  assert.match(report.applications.find((item) => item.id === "health-dashboard").boundary, /first seven source applications/);
  assert.equal(report.totals.sourceRecords > 0, true);
  assert.equal(report.totals.interfaceTracks >= 4, true);
  assert.equal(report.totals.evidenceRecords >= 1, true);
  assert.equal(report.checks.some((item) => item.id === "dashboard:source-boundary" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "dashboard:aggregate-boundary" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "dashboard:development-template" && item.passed), true);

  const markdown = renderMarkdown(report);
  assert.match(markdown, /Health dashboard summary/);
  assert.match(markdown, /Development template/);
  assert.match(markdown, /regional-data-sharing/);
  assert.match(markdown, /health-dashboard/);
  assert.match(markdown, /Open action preview/);
});

test("priority application templates expose the eight conversation handoff contracts", () => {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8"));
  const report = buildPriorityApplicationTemplates({ data });

  assert.equal(report.ok, true);
  assert.equal(report.scope.role, "priority-application-development-templates");
  assert.equal(report.summary.applications, 8);
  assert.equal(report.summary.sourceApplications, 7);
  assert.equal(report.summary.aggregateApplications, 1);
  assert.equal(report.templates[0].conversationTitle, "区域诊疗数据共享平台");
  assert.equal(report.templates.some((item) => item.conversationTitle === "卫生健康综合驾驶舱" && item.aggregateApplication), true);
  assert.equal(report.templates.every((item) => item.functionalBoundary && item.reusePoints.length && item.dataCollections.length && item.apiRoutes.length && item.frontendEntry && item.testEvidence.length && item.acceptanceEvidence.length), true);
  assert.equal(report.checks.every((item) => item.passed), true);
});

test("health dashboard summary supports empty source application boundaries", () => {
  const report = buildHealthDashboardSummary({
    data: {
      platformInterfaces: [{ id: "if-demo", domain: "demo", owner: "team", status: "ready", next: "site signoff" }],
      platformEvidence: [{ id: "ev-demo", records: [{ owner: "team", status: "ready", testRecord: "demo" }, { owner: "team", status: "ready", testRecord: "demo2" }] }]
    }
  });

  assert.equal(report.applications.some((item) => item.status === "empty-ready"), true);
  assert.equal(report.scope.role, "priority-eight-application-portfolio");
  assert.equal(report.checks.some((item) => item.id === "dashboard:source-boundary" && item.passed), true);
});
