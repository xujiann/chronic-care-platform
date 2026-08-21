const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  APPLICATIONS,
  DOCUMENTATION_RULE,
  buildHealthDashboardSummary,
  buildPriorityApplicationTemplates,
  renderMarkdown
} = require("../scripts/health-dashboard-summary");
const healthDashboardApplications = require("../health-dashboard-applications");

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
  assert.equal(report.applications.find((item) => item.id === "research-sandbox").apiRoutes.includes("POST /api/research/datasets/:id/evidence"), true);
  assert.equal(report.applications.find((item) => item.id === "research-sandbox").apiRoutes.includes("POST /api/research/datasets/:id/compliant-exports"), true);
  assert.equal(report.applications.find((item) => item.id === "research-sandbox").dataCollections.includes("compliantDataExports"), true);
  assert.equal(report.applications.filter((item) => item.id !== "health-dashboard").every((item) => /source application/.test(item.boundary)), true);
  assert.match(report.applications.find((item) => item.id === "health-dashboard").boundary, /first seven source applications/);
  assert.equal(report.totals.sourceRecords > 0, true);
  assert.equal(report.totals.interfaceTracks >= 4, true);
  assert.equal(report.totals.evidenceRecords >= 1, true);
  assert.equal(report.indicatorCenter.indicators.length, 8);
  assert.equal(report.indicatorCenter.periodViews.length, 2);
  assert.equal(report.indicatorCenter.categories.includes("专项监管"), true);
  assert.equal(report.indicatorCenter.indicators.some((item) => item.id === "industry-physical-exam" && item.status === "blocked"), true);
  assert.equal(report.indicatorCenter.indicators.some((item) => item.id === "industry-appointment-reconciliation" && item.drilldown.href === "./citizen.html"), true);
  assert.equal(report.indicatorCenter.indicators.every((item) => item.definition && item.owner && item.sourceCollections.length && item.sourceSystems.length && item.reports.length === 2 && item.drilldown.href), true);
  assert.equal(report.indicatorCenter.summary.contractVersion, "health-dashboard-indicator-contract.v1");
  assert.equal(report.indicatorCenter.contracts[0].id, "population-service-visits.v1");
  assert.equal(report.indicatorCenter.legacyAliases.length, 3);
  const governedVisits = report.indicatorCenter.indicators.find((item) => item.canonicalId === "performance-public-hospital");
  assert.equal(governedVisits.id, "industry-appointment-reconciliation");
  assert.equal(governedVisits.legacyAlias.mapping, "explicit-compatibility-alias");
  assert.equal(governedVisits.contract.id, "population-service-visits.v1");
  assert.equal(governedVisits.measurement.value.type, "integer");
  assert.equal(governedVisits.measurement.value.unit, "visits");
  assert.equal(governedVisits.measurement.scope.provenance, "server-runtime");
  assert.equal(governedVisits.measurement.qualityStatus, "blocked");
  assert.equal(governedVisits.measurement.blockers.includes("SERVER_SCOPE_UNRESOLVED"), true);
  assert.equal(report.checks.some((item) => item.id === "dashboard:source-boundary" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "dashboard:aggregate-boundary" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "dashboard:development-template" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "dashboard:documentation-rule" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "dashboard:industry-governance-indicators" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "dashboard:industry-governance-reports" && item.passed), true);
  assert.equal(report.applications.every((item) => item.documentationRule.aboutPage === DOCUMENTATION_RULE.aboutPage && item.documentationRule.requiredDocument === DOCUMENTATION_RULE.requiredDocument), true);

  const markdown = renderMarkdown(report);
  assert.match(markdown, /Health dashboard summary/);
  assert.match(markdown, /Development template/);
  assert.match(markdown, /Documentation rule/);
  assert.match(markdown, /docs\/<module-name>\.md/);
  assert.match(markdown, /docs\/妇幼健康全模块说明\.md/);
  assert.match(markdown, /regional-data-sharing/);
  assert.match(markdown, /health-dashboard/);
  assert.match(markdown, /POST \/api\/research\/datasets\/:id\/evidence/);
  assert.match(markdown, /POST \/api\/research\/datasets\/:id\/compliant-exports/);
  assert.match(markdown, /Open action preview/);
  assert.match(markdown, /Industry governance indicator center/);
  assert.match(markdown, /健康体检覆盖/);
  assert.match(markdown, /Monthly and yearly report views/);
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
  assert.equal(report.templates.every((item) => item.documentationRule.aboutPage === "about.html" && item.documentationRule.flowDiagram), true);
  assert.equal(report.templates.every((item) => /small change/.test(item.documentationRule.codexLoop) && /test or build/.test(item.documentationRule.codexLoop)), true);
  assert.equal(report.templates.every((item) => item.conversationStarter && item.conversationStarter.includes(item.id)), true);
  assert.equal(report.templates.every((item) => item.implementationChecklist.length >= 8), true);
  assert.equal(report.templates.every((item) => item.implementationChecklist.some((step) => /Follow Codex loop/.test(step) && /small change/.test(step))), true);
  assert.equal(report.templates.every((item) => item.acceptanceGate.readyWhen.length >= 4 && item.acceptanceGate.evidence.length), true);
  assert.equal(report.templates[0].documentationRule.maternalChildReference, "docs/妇幼健康全模块说明.md");
  assert.equal(report.checks.some((item) => item.id === "templates:documentation-rule" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "templates:conversation-starter" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "templates:implementation-checklist" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "templates:acceptance-gate" && item.passed), true);
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

test("industry compatibility aliases are keyed by canonical id rather than array position", () => {
  const source = fs.readFileSync(path.join(ROOT, "scripts", "health-dashboard-summary.js"), "utf8");
  assert.match(source, /legacyAliasFor\(item\.id\)/);
  assert.doesNotMatch(source, /compatibilityIds|compatibilityIds\s*\[\s*index\s*\]/);
});
