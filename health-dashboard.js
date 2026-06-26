const DASHBOARD_API_BASE = location.protocol === "file:" ? "" : "/api";
const DASHBOARD_SUMMARY_ROUTE = "/api/health-dashboard/summary";
const DASHBOARD_SUMMARY_PATH = DASHBOARD_SUMMARY_ROUTE.replace(/^\/api/, "");
let currentDashboardSummary = null;
let currentPopulationPeriod = "day";

document.addEventListener("DOMContentLoaded", async () => {
  const summary = await loadDashboardSummary();
  currentDashboardSummary = summary;
  bindDashboardFilters();
  bindDashboardExport();
  bindPopulationBoardPeriod();
  renderDashboard(summary);
});

async function loadDashboardSummary() {
  let fallbackReason = "静态预览";
  if (DASHBOARD_API_BASE) {
    try {
      const request = window.HealthCityAuth?.authFetch || fetch;
      const response = await request(`${DASHBOARD_API_BASE}${DASHBOARD_SUMMARY_PATH}`);
      if (response.ok) {
        const summary = await response.json();
        summary.sourceMode = "api";
        summary.sourceLabel = "管理端动态汇总";
        return summary;
      }
      fallbackReason = `接口返回 ${response.status}`;
    } catch (error) {
      fallbackReason = "接口不可用";
      // Static preview falls back to local data.
    }
  }
  const state = await loadPlatformState({});
  const summary = buildStaticDashboardSummary(state);
  summary.sourceMode = "static";
  summary.sourceLabel = "静态快照兜底";
  summary.sourceReason = fallbackReason;
  return summary;
}

function buildStaticDashboardSummary(state) {
  const applications = healthDashboardApplications().map(({ id, name, entry, collections }) => {
    const records = collections.reduce((sum, collection) => sum + countRows(state[collection]), 0);
    return {
      id,
      name,
      entry,
      collections: collections.map((collection) => ({ collection, records: countRows(state[collection]) })),
      records,
      openActions: 0,
      highRisks: 0,
      evidenceRecords: 0,
      status: records ? "modeled" : "empty-ready",
      boundary: "Aggregated in the dashboard; detailed workflow remains in the source application."
    };
  });
  const evidence = Array.isArray(state.platformEvidence) ? state.platformEvidence : [];
  const interfaces = Array.isArray(state.platformInterfaces) ? state.platformInterfaces : [];
  const dependencies = Array.isArray(state.productionDeploymentPlan) ? state.productionDeploymentPlan : [];
  const openActions = collectStaticOpenActions(state, applications);
  const actionSummary = openActions.reduce((summary, item) => {
    const current = summary[item.applicationId] || { openActions: 0, highRisks: 0 };
    current.openActions += 1;
    if (item.priority === "high") current.highRisks += 1;
    summary[item.applicationId] = current;
    return summary;
  }, {});
  const enrichedApplications = applications.map((item) => ({
    ...item,
    openActions: actionSummary[item.id]?.openActions || 0,
    highRisks: actionSummary[item.id]?.highRisks || 0
  }));
  const sourceOpenActions = enrichedApplications.reduce((sum, item) => sum + item.openActions, 0);
  const risks = enrichedApplications
    .filter((item) => item.highRisks > 0 || item.openActions > 0)
    .map((item) => ({
      applicationId: item.id,
      application: item.name,
      highRisks: item.highRisks,
      openActions: item.openActions,
      nextAction: item.highRisks > 0 ? "回到源应用复核高风险记录。" : "回到源应用闭环待办。"
    }));
  const populationServiceBoard = buildStaticPopulationServiceBoard(state);
  const functionalReport = buildDashboardFunctionalReport({
    applications: enrichedApplications,
    openActions,
    populationServiceBoard,
    interfaces,
    evidence,
    siteDependencies: dependencies
  });
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    scope: {
      rule: "静态预览模式：仅汇总本地快照，不替代源业务应用。"
    },
    totals: {
      applications: enrichedApplications.length,
      sourceRecords: enrichedApplications.reduce((sum, item) => sum + item.records, 0),
      openActions: openActions.length,
      previewOpenActions: openActions.length,
      sourceOpenActions,
      highRisks: openActions.filter((item) => item.priority === "high").length,
      interfaceTracks: interfaces.length,
      evidenceRecords: evidence.reduce((sum, item) => sum + (Array.isArray(item.records) ? item.records.length : 0), 0),
      siteDependencies: dependencies.length
    },
    applications: enrichedApplications,
    risks,
    openActions,
    populationServiceBoard,
    functionalReport,
    interfaces: interfaces.map((item) => ({ id: item.id, domain: item.domain || item.name, priority: item.priority, owner: item.owner, status: item.status, nextAction: item.next })),
    evidence: evidence.map((item) => ({ id: item.id, name: item.name || item.category, owner: item.owner, status: item.status, records: Array.isArray(item.records) ? item.records.length : 0, nextAction: item.next })),
    siteDependencies: dependencies.map((item) => ({ id: item.id, track: item.track || item.name, owner: item.owner, status: item.status, nextAction: item.nextAction || item.next }))
  };
}

function healthDashboardApplications() {
  return Array.isArray(window.HealthDashboardApplications) ? window.HealthDashboardApplications : [];
}

function buildStaticPopulationServiceBoard(state) {
  const birthRows = Array.isArray(state.birthCertificates) ? state.birthCertificates : [];
  const deathRows = Array.isArray(state.deathCertificates) ? state.deathCertificates : [];
  const healthStatistics = state.healthStatistics && typeof state.healthStatistics === "object" ? state.healthStatistics : {};
  const serviceReports = Array.isArray(healthStatistics.serviceReports) ? healthStatistics.serviceReports : [];
  const statisticsPeriod = healthStatistics.period || "";
  const eventAnchor = latestDashboardDate(
    birthRows.map((item) => item.birthDateTime),
    deathRows.map((item) => item.deathDateTime)
  ) || parseDashboardDate(`${statisticsPeriod || ""}-01`) || new Date();
  const monthDays = dashboardDaysInMonth(statisticsPeriod, eventAnchor);
  const serviceTotals = serviceReports.reduce((totals, item) => {
    const interfaceData = item.interfaceData || {};
    totals.visits += Number(interfaceData.outpatientVisits || 0) + Number(interfaceData.emergencyVisits || 0);
    totals.admissions += Number(interfaceData.inpatientAdmissions || 0);
    return totals;
  }, { visits: 0, admissions: 0 });
  const periods = [
    { id: "day", label: "日", serviceFactor: 1 / monthDays },
    { id: "week", label: "周", serviceFactor: 7 / monthDays },
    { id: "month", label: "月", serviceFactor: 1 },
    { id: "year", label: "年", serviceFactor: 12 }
  ].map((period) => ({
    id: period.id,
    label: period.label,
    rangeLabel: dashboardPeriodRange(eventAnchor, period.id),
    metrics: [
      { id: "births", label: "出生", value: countDashboardWindow(birthRows, "birthDateTime", eventAnchor, period.id), unit: "例", tone: "birth", sourceLabel: "出生医学证明日期", source: "birthCertificates.birthDateTime" },
      { id: "deaths", label: "死亡", value: countDashboardWindow(deathRows, "deathDateTime", eventAnchor, period.id), unit: "例", tone: "death", sourceLabel: "死亡医学证明日期", source: "deathCertificates.deathDateTime" },
      { id: "visits", label: "就诊", value: Math.round(serviceTotals.visits * period.serviceFactor), unit: "人次", tone: "visit", sourceLabel: "月度门急诊接口折算", source: "healthStatistics.serviceReports 门急诊" },
      { id: "admissions", label: "入院", value: Math.round(serviceTotals.admissions * period.serviceFactor), unit: "人次", tone: "admission", sourceLabel: "月度入院接口折算", source: "healthStatistics.serviceReports 入院" }
    ]
  }));
  return {
    defaultPeriod: "day",
    eventAnchor: formatDashboardDate(eventAnchor),
    statisticsPeriod,
    sourceNote: "出生、死亡来自证书日期；就诊、入院来自月度接口快照并折算为日、周、月、年视图，现场日报接口接入后可替换为真实分时数据。",
    insights: buildDashboardPopulationInsights(periods, { serviceReports: serviceReports.length, statisticsPeriod }),
    periods
  };
}

function dashboardMetricValue(periods, periodId, metricId) {
  return Number((periods.find((period) => period.id === periodId)?.metrics || []).find((metric) => metric.id === metricId)?.value || 0);
}

function buildDashboardPopulationInsights(periods, context = {}) {
  const monthBirths = dashboardMetricValue(periods, "month", "births");
  const monthDeaths = dashboardMetricValue(periods, "month", "deaths");
  const monthVisits = dashboardMetricValue(periods, "month", "visits");
  const monthAdmissions = dashboardMetricValue(periods, "month", "admissions");
  const hasServiceReports = Number(context.serviceReports || 0) > 0;
  return [
    {
      id: "certificate-coverage",
      title: "证照登记覆盖",
      value: `${monthBirths + monthDeaths}例`,
      status: monthBirths + monthDeaths > 0 ? "ready" : "empty",
      detail: "出生、死亡已按医学证明日期形成月内统计；现场需补齐撤销、补正和跨部门交换回执。"
    },
    {
      id: "medical-service-signal",
      title: "门急诊服务量",
      value: `${monthVisits}人次`,
      status: hasServiceReports ? "watch" : "empty",
      detail: hasServiceReports ? "当前使用月度接口总量折算，日报接口接入前不用于小时级预警。" : "等待卫生统计或院内门急诊日报接口写入。"
    },
    {
      id: "admission-pressure",
      title: "入院承压观察",
      value: `${monthAdmissions}人次`,
      status: monthAdmissions >= 20000 ? "watch" : "ready",
      detail: "入院量用于提示床位、转诊和医共体协同压力；生产需接入床位和出入院实时状态。"
    },
    {
      id: "site-cutover",
      title: "现场联调重点",
      value: "4类接口",
      status: "blocked",
      detail: "证照链路、院内系统、统计直报和统一身份需现场签字后替换演示口径。"
    }
  ];
}

function buildDashboardFunctionalReport(context) {
  const applications = context.applications || [];
  const openActions = context.openActions || [];
  const populationServiceBoard = context.populationServiceBoard || {};
  const interfaces = context.interfaces || [];
  const evidence = context.evidence || [];
  const siteDependencies = context.siteDependencies || [];
  const sourceRecords = applications.reduce((sum, item) => sum + Number(item.records || 0), 0);
  const sourceOpenActions = applications.reduce((sum, item) => sum + Number(item.openActions || 0), 0);
  const highRisks = applications.reduce((sum, item) => sum + Number(item.highRisks || 0), 0);
  const evidenceRecords = evidence.reduce((sum, item) => sum + (Array.isArray(item.records) ? item.records.length : 0), 0);
  const functions = [
    {
      id: "aggregate-entry",
      name: "前七应用汇总入口",
      status: applications.length === 7 ? "ready" : "watch",
      evidence: `${applications.length} source applications, ${sourceRecords} source records`,
      boundary: "只做跨应用总览与导航，不替代源应用业务办理。"
    },
    {
      id: "population-service-board",
      name: "出生死亡就诊入院看板",
      status: populationServiceBoard.periods?.length === 4 ? "ready" : "watch",
      evidence: `${populationServiceBoard.periods?.length || 0} periods, ${populationServiceBoard.insights?.length || 0} insights`,
      boundary: "日报接口接入前，就诊和入院使用月度快照折算。"
    },
    {
      id: "risk-action-loop",
      name: "风险预警与任务闭环",
      status: openActions.length > 0 ? "watch" : "ready",
      evidence: `${openActions.length} preview open actions, ${sourceOpenActions} source open actions, ${highRisks} high risks`,
      boundary: "处置回写仍在源业务端完成。"
    },
    {
      id: "interface-evidence",
      name: "接口联调与验收证据",
      status: interfaces.length >= 4 && evidenceRecords >= 2 ? "ready" : "watch",
      evidence: `${interfaces.length} interface tracks, ${evidenceRecords} evidence records`,
      boundary: "复用平台接口和验收证据，不替代现场签字。"
    },
    {
      id: "policy-about",
      name: "政策说明与关于页",
      status: "ready",
      evidence: "health-dashboard-about.html",
      boundary: "说明政策依据、数据口径和现场切换条件。"
    },
    {
      id: "release-audit",
      name: "发布审计与验收报告",
      status: siteDependencies.length > 0 ? "watch" : "ready",
      evidence: "health-dashboard:summary, release:report, deploy:check",
      boundary: "生产切换仍依赖现场签字和正式环境配置。"
    }
  ];
  return {
    title: "卫生健康综合驾驶舱主要功能报告",
    generatedFrom: "/api/health-dashboard/summary",
    summary: {
      functions: functions.length,
      ready: functions.filter((item) => item.status === "ready").length,
      watch: functions.filter((item) => item.status === "watch").length,
      blocked: functions.filter((item) => item.status === "blocked").length
    },
    functions,
    releaseEvidence: [
      { id: "summary-api", name: "综合驾驶舱摘要接口", evidence: "/api/health-dashboard/summary" },
      { id: "summary-script", name: "模块摘要与功能报告", evidence: "npm.cmd run health-dashboard:summary" },
      { id: "release-gate", name: "发布聚合报告", evidence: "npm.cmd run release:report" },
      { id: "deploy-gate", name: "部署门禁", evidence: "npm.cmd run deploy:check" }
    ]
  };
}

function parseDashboardDate(value) {
  if (!value) return null;
  const date = new Date(String(value).replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDashboardDate(date) {
  if (!date) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function latestDashboardDate(...values) {
  return values
    .flat()
    .map(parseDashboardDate)
    .filter(Boolean)
    .sort((left, right) => right.getTime() - left.getTime())[0] || null;
}

function dashboardDaysInMonth(period, fallbackDate) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(period || ""));
  if (match) return new Date(Number(match[1]), Number(match[2]), 0).getDate();
  const date = fallbackDate || new Date();
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function countDashboardWindow(items, field, anchor, periodId) {
  if (!anchor) return 0;
  const start = new Date(anchor);
  const end = new Date(anchor);
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  if (periodId === "week") start.setDate(start.getDate() - 6);
  if (periodId === "month") start.setDate(1);
  if (periodId === "year") start.setMonth(0, 1);
  return items.filter((item) => {
    const date = parseDashboardDate(item[field]);
    return date && date >= start && date <= end;
  }).length;
}

function dashboardPeriodRange(anchor, periodId) {
  if (!anchor) return "等待日期";
  const start = new Date(anchor);
  if (periodId === "week") start.setDate(start.getDate() - 6);
  if (periodId === "month") start.setDate(1);
  if (periodId === "year") start.setMonth(0, 1);
  return `${formatDashboardDate(start)} to ${formatDashboardDate(anchor)}`;
}

function renderDashboard(summary) {
  renderMetrics(summary);
  renderDataState(summary);
  renderPopulationServiceBoard(summary);
  renderFunctionReport(summary.functionalReport || {});
  document.querySelector("#dashboard-scope").textContent = summary.scope?.rule || "";
  renderFilterOptions(summary);
  renderApplications(summary.applications || []);
  renderRisks(summary.risks || []);
  renderActions(filteredDashboardActions(summary));
  renderDependencies(summary.siteDependencies || []);
  renderInterfaces(summary.interfaces || []);
  renderEvidence(summary.evidence || []);
  renderFilterSummary(summary);
}

function renderDataState(summary) {
  const state = document.querySelector("#dashboard-api-state");
  const boundary = document.querySelector("#dashboard-data-boundary");
  if (state) {
    state.dataset.sourceMode = summary.sourceMode || "unknown";
    state.dataset.sourceReason = summary.sourceReason || "";
    state.textContent = summary.sourceMode === "api"
      ? `${summary.sourceLabel || "管理端动态汇总"} / ${summary.generatedAt || ""}`
      : `${summary.sourceLabel || "静态快照兜底"} / ${summary.sourceReason || "本地数据"}`;
  }
  if (boundary) {
    boundary.textContent = summary.scope?.rule || "综合驾驶舱只汇总源应用，不替代源业务办理。";
  }
}

function renderMetrics(summary) {
  const totals = summary.totals || {};
  document.querySelector("#dashboard-metrics").innerHTML = [
    ["应用入口", totals.applications || 0, "前 7 个应用汇总"],
    ["源记录", totals.sourceRecords || 0, "来自 data/db.json 与业务 API"],
    ["源待办", totals.sourceOpenActions ?? totals.openActions ?? 0, "源应用全部待闭环"],
    ["预览待办", totals.previewOpenActions ?? totals.openActions ?? 0, "驾驶舱优先展示"],
    ["高风险", totals.highRisks || 0, "状态/优先级归一化"],
    ["接口轨道", totals.interfaceTracks || 0, "platformInterfaces"],
    ["验收证据", totals.evidenceRecords || 0, "platformEvidence records"],
    ["现场依赖", totals.siteDependencies || 0, "生产切换签字项"],
    ["就绪状态", summary.ok ? "OK" : "Check", summary.generatedAt || ""]
  ].map(([label, value, hint]) => `<article class="metric-card"><span>${label}</span><strong>${value}</strong><small>${hint}</small></article>`).join("");
}

function renderFunctionReport(report) {
  const summary = document.querySelector("#dashboard-function-summary");
  const list = document.querySelector("#dashboard-function-list");
  const evidence = document.querySelector("#dashboard-function-evidence");
  const rows = Array.isArray(report.functions) ? report.functions : [];
  const evidenceRows = Array.isArray(report.releaseEvidence) ? report.releaseEvidence : [];
  if (summary) {
    summary.textContent = `${report.summary?.functions || rows.length} functions / ${report.summary?.ready || 0} ready / ${report.summary?.watch || 0} watch`;
  }
  if (list) {
    list.innerHTML = rows.map((item) => `<article class="function-report-card ${item.status || "normal"}" data-function-report="${item.id}">
      <span>${item.status || "ready"}</span>
      <strong>${item.name || item.id}</strong>
      <small>${item.evidence || ""}</small>
      <p>${item.boundary || ""}</p>
    </article>`).join("") || `<article class="function-report-card empty"><strong>等待功能报告</strong><p>摘要接口返回后生成本模块主要功能报告。</p></article>`;
  }
  if (evidence) {
    evidence.innerHTML = evidenceRows.map((item) => `<span data-function-evidence="${item.id}">${item.name || item.id}: ${item.evidence || ""}</span>`).join("");
  }
}

function bindPopulationBoardPeriod() {
  const controls = document.querySelector("#population-period-controls");
  if (!controls || controls.dataset.bound === "true") return;
  controls.dataset.bound = "true";
  controls.addEventListener("click", (event) => {
    const button = event.target.closest("[data-population-period]");
    if (!button) return;
    currentPopulationPeriod = button.dataset.populationPeriod || "day";
    if (currentDashboardSummary) renderPopulationServiceBoard(currentDashboardSummary);
  });
}

function renderPopulationServiceBoard(summary) {
  const board = summary.populationServiceBoard || {};
  const section = document.querySelector("#population-service-board");
  const controls = document.querySelector("#population-period-controls");
  const cards = document.querySelector("#population-metric-cards");
  const chart = document.querySelector("#population-chart");
  const insights = document.querySelector("#population-insights");
  const range = document.querySelector("#population-board-range");
  const source = document.querySelector("#population-board-source");
  if (!section || !controls || !cards || !chart) return;
  const periods = Array.isArray(board.periods) ? board.periods : [];
  const selected = periods.find((period) => period.id === currentPopulationPeriod) || periods.find((period) => period.id === board.defaultPeriod) || periods[0];
  if (!selected) {
    section.dataset.activePeriod = "empty";
    controls.innerHTML = "";
    cards.innerHTML = `<article class="population-empty">暂无出生、死亡、就诊、入院数据</article>`;
    chart.innerHTML = "";
    if (insights) insights.innerHTML = "";
    if (range) range.textContent = "等待数据";
    if (source) source.textContent = "等待前 7 个应用或现场接口写入统计快照。";
    return;
  }
  currentPopulationPeriod = selected.id;
  section.dataset.activePeriod = selected.id;
  controls.innerHTML = periods.map((period) => `<button type="button" data-population-period="${period.id}" class="${period.id === selected.id ? "active" : ""}">${period.label}</button>`).join("");
  if (range) range.textContent = `${selected.label} / ${selected.rangeLabel || board.eventAnchor || ""}`;
  if (source) source.textContent = board.sourceNote || "";
  const metrics = Array.isArray(selected.metrics) ? selected.metrics : [];
  cards.innerHTML = metrics.map((metric) => `<article class="population-metric-card ${metric.tone || metric.id}" data-population-metric="${metric.id}">
    <span>${metric.label}</span>
    <strong>${formatDashboardNumber(metric.value)}</strong>
    <small>${metric.unit || ""} / ${metric.sourceLabel || metric.source || ""}</small>
  </article>`).join("");
  const maxValue = Math.max(1, ...metrics.map((metric) => Number(metric.value) || 0));
  chart.innerHTML = metrics.map((metric) => {
    const value = Number(metric.value) || 0;
    const width = Math.max(value === 0 ? 0 : 4, Math.round((value / maxValue) * 100));
    return `<div class="population-bar-row" data-population-metric="${metric.id}">
      <span>${metric.label}</span>
      <div class="population-bar-track"><i class="population-bar-fill ${metric.tone || metric.id}" style="--bar-width:${width}%"></i></div>
      <strong>${formatDashboardNumber(value)}${metric.unit || ""}</strong>
    </div>`;
  }).join("");
  if (insights) {
    const insightRows = Array.isArray(board.insights) ? board.insights : [];
    insights.innerHTML = insightRows.map((item) => `<article class="population-insight ${item.status || "normal"}" data-population-insight="${item.id}">
      <span>${item.title || item.id}</span>
      <strong>${item.value || ""}</strong>
      <small>${item.detail || ""}</small>
    </article>`).join("");
  }
}

function formatDashboardNumber(value) {
  return Number(value || 0).toLocaleString("zh-CN");
}

function renderApplications(applications) {
  document.querySelector("#dashboard-applications").innerHTML = `<table>
    <thead><tr><th>应用</th><th>入口</th><th>源记录</th><th>Open actions</th><th>高风险</th><th>状态</th></tr></thead>
    <tbody>${applications.map((item) => `<tr>
      <td>${item.name}</td>
      <td><a href="./${item.entry}">${item.entry}</a></td>
      <td>${item.records}</td>
      <td>${item.openActions}</td>
      <td>${item.highRisks}</td>
      <td><span class="badge ${item.status === "modeled" ? "info" : "warn"}">${item.status}</span></td>
    </tr>`).join("")}</tbody>
  </table>`;
}

function renderRisks(risks) {
  document.querySelector("#dashboard-risks").innerHTML = risks.map((item) => `<div>
    <strong>${item.application}</strong>
    <span>${item.highRisks} high / ${item.openActions} open</span>
    <small>${item.nextAction}</small>
  </div>`).join("") || `<div><strong>暂无高风险汇总</strong><span>等待源应用产生风险或现场联调数据。</span></div>`;
}

function renderActions(actions) {
  document.querySelector("#dashboard-actions").innerHTML = actions.map((item, index) => `<article class="priority-row">
    <div class="priority-rank ${item.priority === "high" ? "danger" : item.priority === "medium" ? "warn" : "info"}">${index + 1}</div>
    <div>
      <h3>${item.title}</h3>
      <p>${item.application || item.collection} / ${item.collection} / ${item.status}</p>
    </div>
    <div class="capability-side">
      <span class="badge ${item.priority === "high" ? "danger" : item.priority === "medium" ? "warn" : "info"}">${item.priority}</span>
      ${item.entry ? `<a href="./${item.entry}">源应用</a>` : ""}
      <small>${item.owner || "owner-pending"}</small>
    </div>
  </article>`).join("") || `<article class="priority-row"><div class="priority-rank info">0</div><div><h3>暂无跨应用待办</h3><p>源应用 open action 完成后这里会归零。</p></div></article>`;
}

function bindDashboardFilters() {
  ["#dashboard-application-filter", "#dashboard-priority-filter"].forEach((selector) => {
    const control = document.querySelector(selector);
    if (!control || control.dataset.bound === "true") return;
    control.dataset.bound = "true";
    control.addEventListener("change", () => {
      if (currentDashboardSummary) renderDashboard(currentDashboardSummary);
    });
  });
}

function bindDashboardExport() {
  const button = document.querySelector("#dashboard-export-json");
  if (!button || button.dataset.bound === "true") return;
  button.dataset.bound = "true";
  button.addEventListener("click", () => {
    if (!currentDashboardSummary) return;
    exportDashboardSummary(currentDashboardSummary);
  });
}

function exportDashboardSummary(summary) {
  const payload = {
    exportedAt: new Date().toISOString(),
    sourceMode: summary.sourceMode || "unknown",
    sourceReason: summary.sourceReason || "",
    filters: dashboardFilters(),
    filteredOpenActions: filteredDashboardActions(summary),
    summary
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  link.href = URL.createObjectURL(blob);
  link.download = `health-dashboard-summary-${stamp}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

function renderFilterOptions(summary) {
  const select = document.querySelector("#dashboard-application-filter");
  if (!select || select.dataset.ready === "1") return;
  const options = (summary.applications || []).map((item) => `<option value="${item.id}">${item.name}</option>`);
  select.innerHTML = [`<option value="">全部应用</option>`, ...options].join("");
  select.dataset.ready = "1";
}

function dashboardFilters() {
  return {
    applicationId: document.querySelector("#dashboard-application-filter")?.value || "",
    priority: document.querySelector("#dashboard-priority-filter")?.value || ""
  };
}

function filteredDashboardActions(summary) {
  const filters = dashboardFilters();
  return (summary.openActions || []).filter((item) =>
    (!filters.applicationId || item.applicationId === filters.applicationId) &&
    (!filters.priority || item.priority === filters.priority)
  );
}

function renderFilterSummary(summary) {
  const filters = dashboardFilters();
  const app = (summary.applications || []).find((item) => item.id === filters.applicationId);
  const count = filteredDashboardActions(summary).length;
  document.querySelector("#dashboard-filter-summary").textContent = [
    app?.name || "全部应用",
    filters.priority || "全部优先级",
    `${count} open actions`
  ].join(" / ");
}

function renderDependencies(items) {
  document.querySelector("#dashboard-dependencies").innerHTML = items.map((item) => `<div>
    <strong>${item.track || item.id}</strong>
    <span>${item.status || "pending"} / ${item.owner || "owner-pending"}</span>
    <small>${item.nextAction || ""}</small>
  </div>`).join("") || `<div><strong>暂无现场依赖</strong><span>生产签字项尚未进入快照。</span></div>`;
}

function renderInterfaces(items) {
  document.querySelector("#dashboard-interfaces").innerHTML = items.slice(0, 8).map((item) => `<div>
    <strong>${item.domain || item.id}</strong>
    <span>${item.priority || "P2"} / ${item.status || "pending"}</span>
    <small>${item.nextAction || ""}</small>
  </div>`).join("") || `<div><strong>暂无接口轨道</strong><span>等待 platformInterfaces 数据。</span></div>`;
}

function renderEvidence(items) {
  document.querySelector("#dashboard-evidence").innerHTML = items.slice(0, 8).map((item) => `<div>
    <strong>${item.name || item.id}</strong>
    <span>${item.status || "pending"} / ${item.records || 0} records</span>
    <small>${item.owner || ""}</small>
  </div>`).join("") || `<div><strong>暂无验收证据</strong><span>等待平台证据归档。</span></div>`;
}

function collectStaticOpenActions(state, applications) {
  const appByCollection = Object.fromEntries(applications.flatMap((app) =>
    app.collections.map((item) => [item.collection, app])
  ));
  return ["followups", "careOrders", "medicationPickups", "insuranceClaims", "emergencySignals", "countyCollaborationOrders", "countyMutualRecognitionRecords", "countyAiDiagnosisCases"]
    .flatMap((collection) => {
      const app = appByCollection[collection] || applications[0];
      return (Array.isArray(state[collection]) ? state[collection] : []).filter((item) => !isClosedDashboardStatus(item.status)).map((item) => ({
        id: item.id || `${collection}-open`,
        collection,
        applicationId: app.id,
        application: app.name,
        entry: app.entry,
        title: item.title || item.taskName || item.orderType || item.item || item.claimType || item.medication || collection,
        owner: item.owner || item.assignee || item.institution || item.center || "owner-pending",
        status: item.status || "open",
        priority: dashboardPriority(item)
      }));
    }).slice(0, 12);
}

function isClosedDashboardStatus(status) {
  return /closed|resolved|approved|recognized|completed|passed|ready|signed|done|已完成|已通过|已闭环/.test(String(status || ""));
}

function dashboardPriority(item) {
  const text = [item.priority, item.level, item.risk, item.riskLevel, item.status].filter(Boolean).join(" ");
  if (/high|urgent|critical|overdue|高|逾期|危急/i.test(text)) return "high";
  if (/medium|warning|中|待/i.test(text)) return "medium";
  return "normal";
}

function countRows(value) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object") return Object.values(value).reduce((sum, item) => sum + (Array.isArray(item) ? item.length : 0), 0);
  return 0;
}
