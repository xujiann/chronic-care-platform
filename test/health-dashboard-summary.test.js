const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  APPLICATIONS,
  buildHealthDashboardSummary,
  renderMarkdown
} = require("../scripts/health-dashboard-summary");
const healthDashboardApplications = require("../health-dashboard-applications");

const ROOT = path.resolve(__dirname, "..");

test("health dashboard summary aggregates the first seven applications without replacing them", () => {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8"));
  const report = buildHealthDashboardSummary({ data });

  assert.equal(report.ok, true);
  assert.equal(APPLICATIONS.length, 7);
  assert.equal(APPLICATIONS, healthDashboardApplications);
  assert.equal(report.applications.length, 7);
  assert.equal(report.applications.every((item) => item.entry.endsWith(".html")), true);
  assert.equal(report.applications.every((item) => /源应用|源业务/.test(item.boundary)), true);
  assert.equal(report.totals.sourceRecords > 0, true);
  assert.equal(report.totals.interfaceTracks >= 4, true);
  assert.equal(report.totals.evidenceRecords >= 2, true);
  assert.equal(report.totals.previewOpenActions, report.openActions.length);
  assert.equal(report.totals.openActions, report.totals.previewOpenActions);
  assert.equal(report.totals.sourceOpenActions >= report.totals.previewOpenActions, true);
  assert.equal(report.populationServiceBoard.periods.length, 4);
  assert.deepEqual(report.populationServiceBoard.periods.map((item) => item.id), ["day", "week", "month", "year"]);
  assert.equal(report.populationServiceBoard.periods.every((period) => period.metrics.length === 4), true);
  assert.equal(report.populationServiceBoard.periods.every((period) => ["births", "deaths", "visits", "admissions"].every((id) => period.metrics.some((metric) => metric.id === id))), true);
  assert.equal(report.populationServiceBoard.insights.length, 4);
  assert.equal(report.populationServiceBoard.insights.some((item) => item.id === "medical-service-signal" && item.status === "ready"), true);
  assert.equal(report.populationServiceBoard.insights.some((item) => item.id === "site-cutover" && item.status === "blocked"), true);
  assert.equal(report.populationServiceBoard.periods.find((item) => item.id === "month").metrics.find((item) => item.id === "visits").value, 92800);
  assert.equal(report.populationServiceBoard.periods.find((item) => item.id === "month").metrics.find((item) => item.id === "admissions").value, 5212);
  assert.equal(report.populationServiceBoard.serviceMode, "daily-interface");
  assert.equal(report.populationServiceBoard.sourceDetails.length, 4);
  assert.equal(report.populationServiceBoard.sourceDetails.some((item) => item.id === "visits" && item.field.includes("dailyServiceReports") && item.status === "ready"), true);
  assert.equal(report.certificateExchange.items.length, 5);
  assert.equal(report.certificateExchange.summary.receipts, 3);
  assert.equal(report.riskDrilldowns.items.length >= 4, true);
  assert.equal(report.riskDrilldowns.summary.withTrace, report.riskDrilldowns.items.length);
  assert.equal(report.siteEvidencePackage.items.length, 4);
  assert.equal(report.siteEvidencePackage.summary.ready, 3);
  assert.equal(report.siteIssueLedger.summary.total >= 1, true);
  assert.equal(report.siteIssueLedger.items.every((item) => item.owner && item.nextAction && item.boundary), true);
  assert.equal(report.functionalReport.functions.length, 13);
  assert.equal(report.functionalReport.functions.some((item) => item.id === "population-service-board" && item.status === "ready"), true);
  assert.equal(report.functionalReport.functions.some((item) => item.id === "jurisdiction-workbench" && item.status === "ready"), true);
  assert.equal(report.functionalReport.functions.some((item) => item.id === "jurisdiction-scope-drilldown" && item.status === "ready"), true);
  assert.equal(report.functionalReport.functions.some((item) => item.id === "task-closure-trend"), true);
  assert.equal(report.functionalReport.functions.some((item) => item.id === "department-workbench" && item.status === "ready"), true);
  assert.equal(report.actionClosureTrend.periods.length, 4);
  assert.equal(report.actionClosureTrend.summary.total >= report.openActions.length, true);
  assert.equal(report.actionClosureTrend.summary.overdue > 0, true);
  assert.equal(report.actionClosureTrend.applications.length >= 2, true);
  assert.equal(report.jurisdictionScope.districts.length >= 2, true);
  assert.equal(report.jurisdictionScope.summary.institutions >= 3, true);
  assert.equal(report.jurisdictionScope.institutionTypeOptions.length >= 2, true);
  assert.equal(report.jurisdictionScope.districts.some((item) => item.district === "中山区"), true);
  assert.equal(report.jurisdictionScope.districtOptions.some((item) => /医保/.test(item)), false);
  assert.equal(report.jurisdictionScope.districts.some((item) => item.id !== "all" && (item.institutionsList.length || item.serviceReportList.length || item.actionList.length)), true);
  assert.equal(report.jurisdictionScope.districts.some((item) => item.id !== "all" && Array.isArray(item.actionList)), true);
  assert.equal(report.functionalReport.departmentFunctionMatrix.length >= 6, true);
  assert.equal(report.functionalReport.departmentFunctionMatrix.some((item) => item.id === "planning-information" && item.nextPlan), true);
  assert.equal(report.functionalReport.cityCountyFunctionMatrix.length >= 4, true);
  assert.equal(report.functionalReport.cityCountyFunctionMatrix.some((item) => item.level === "市级"), true);
  assert.equal(report.functionalReport.cityCountyFunctionMatrix.some((item) => item.level === "县级"), true);
  assert.equal(report.functionalReport.cityCountyFunctionMatrix.every((item) => /卫生健康|行政部门|卫健/.test(item.agency)), true);
  assert.equal(report.functionalReport.cityCountyFunctionMatrix.some((item) => item.id === "city-admin-coordination"), true);
  assert.equal(report.functionalReport.cityCountyFunctionMatrix.some((item) => item.id === "county-admin-coordination"), true);
  assert.equal(report.functionalReport.cityCountyFunctionMatrix.some((item) => item.agency === "县域医共体牵头医院" || /乡镇卫生院|社区卫生服务中心|村卫生室|大数据中心|专业中心/.test(item.agency)), false);
  assert.equal(report.functionalReport.releaseEvidence.some((item) => item.evidence === "npm.cmd run health-dashboard:summary"), true);
  assert.equal(report.checks.some((item) => item.id === "dashboard:source-boundary" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "dashboard:population-service-board" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "dashboard:certificate-exchange" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "dashboard:risk-drilldown" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "dashboard:site-evidence-package" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "dashboard:site-issue-ledger" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "dashboard:functional-report" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "dashboard:jurisdiction-scope" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "dashboard:jurisdiction-detail" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "dashboard:action-closure-trend" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "dashboard:department-function-matrix" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "dashboard:city-county-function-matrix" && item.passed), true);
  assert.equal(report.openActions.every((item) => item.applicationId && item.application && item.entry), true);
  assert.equal(report.openActions.some((item) => item.entry === "county.html" || item.entry === "institution.html"), true);

  const markdown = renderMarkdown(report);
  assert.match(markdown, /卫生健康综合管理服务系统摘要/);
  assert.match(markdown, /卫健委综合监管/);
  assert.match(markdown, /运维验收工作台/);
  assert.match(markdown, /待办预览/);
  assert.match(markdown, /源应用待办/);
  assert.match(markdown, /预览待办/);
  assert.match(markdown, /应用 \| 数据集/);
  assert.match(markdown, /人口与服务看板/);
  assert.match(markdown, /人口与服务洞察/);
  assert.match(markdown, /主要功能报告/);
  assert.match(markdown, /内部机构功能矩阵/);
  assert.match(markdown, /市县两级机构功能矩阵/);
  assert.match(markdown, /规划信息处/);
  assert.match(markdown, /区县卫生健康局/);
  assert.match(markdown, /市级卫生健康行政部门业务处室/);
  assert.doesNotMatch(markdown, /\| .*县域医共体牵头医院 \|/);
  assert.match(markdown, /风险下钻/);
  assert.match(markdown, /现场验收证据包/);
  assert.match(markdown, /现场问题整改台账/);
  assert.match(markdown, /发布证据/);
  assert.match(markdown, /92800/);
  assert.match(markdown, /证照交换链路/);
});

test("health dashboard summary supports empty source application boundaries", () => {
  const report = buildHealthDashboardSummary({
    data: {
      platformInterfaces: [{ id: "if-demo", domain: "demo", owner: "team", status: "ready", next: "site signoff" }],
      platformEvidence: [{ id: "ev-demo", records: [{ owner: "team", status: "ready", testRecord: "demo" }, { owner: "team", status: "ready", testRecord: "demo2" }] }]
    }
  });

  assert.equal(report.applications.some((item) => item.status === "empty-ready"), true);
  assert.equal(report.scope.role, "health-administration-management-service-system");
  assert.equal(report.checks.some((item) => item.id === "dashboard:source-boundary" && item.passed), true);
});
