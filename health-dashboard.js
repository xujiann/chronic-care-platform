const DASHBOARD_API_BASE = location.protocol === "file:" ? "" : "/api";
const DASHBOARD_SUMMARY_ROUTE = "/api/health-dashboard/summary";
const DASHBOARD_SUMMARY_PATH = DASHBOARD_SUMMARY_ROUTE.replace(/^\/api/, "");
let currentDashboardSummary = null;
let currentPopulationPeriod = "day";
let currentJurisdictionLevel = "all";
let currentDepartmentStatus = "all";
let currentSiteIssueStatus = "all";
let currentSiteIssueOwner = "";
let currentBackendGoLiveStatus = "all";
let currentIndicatorDimension = "all";
let currentIndicatorStatus = "all";
let currentJurisdictionDistrict = "";
let currentJurisdictionType = "";
let currentJurisdictionDetail = "";
const DASHBOARD_TASK_COLLECTIONS = [
  "followups",
  "careOrders",
  "medicationPickups",
  "insuranceClaims",
  "emergencySignals",
  "chronicScreeningTasks",
  "chronicEducationPushes",
  "chronicManagementPlans",
  "countyCollaborationOrders",
  "countyMutualRecognitionRecords",
  "countyAiDiagnosisCases",
  "multiPracticeApplications",
  "dataQualityIssues",
  "integrationGatewayEvents"
];

document.addEventListener("DOMContentLoaded", async () => {
  const summary = await loadDashboardSummary();
  currentDashboardSummary = summary;
  bindDashboardFilters();
  bindDashboardExport();
  bindPopulationBoardPeriod();
  bindJurisdictionLevel();
  bindJurisdictionScopeFilters();
  bindDepartmentStatus();
  bindSiteIssueStatus();
  bindSiteIssueOwner();
  bindSiteIssueReset();
  bindBackendGoLiveStatus();
  bindBackendGoLiveReset();
  bindIndicatorCenterFilters();
  bindIndicatorCenterReset();
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
      boundary: "综合管理服务系统仅做汇总展示；具体业务流程仍在源应用办理。"
    };
  });
  const evidence = Array.isArray(state.platformEvidence) ? state.platformEvidence : [];
  const interfaces = Array.isArray(state.platformInterfaces) ? state.platformInterfaces : [];
  const dependencies = Array.isArray(state.productionDeploymentPlan) ? state.productionDeploymentPlan : [];
  const taskActions = collectStaticTaskActions(state, applications);
  const openActions = taskActions.filter((item) => !item.closed).slice(0, 12);
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
  const certificateExchange = buildStaticCertificateExchange(state);
  const riskDrilldowns = buildStaticRiskDrilldowns(openActions);
  const siteEvidencePackage = buildStaticSiteEvidencePackage(state, { interfaces, evidence, siteDependencies: dependencies });
  const siteIssueLedger = buildStaticSiteIssueLedger(siteEvidencePackage, dependencies);
  const productionReadinessGate = buildDashboardProductionReadinessGate(dependencies, { interfaces, siteEvidencePackage, siteIssueLedger });
  const jurisdictionScope = buildDashboardJurisdictionScope(state, { openActions, applications: enrichedApplications });
  const actionClosureTrend = buildDashboardActionClosureTrend(taskActions, { openActions });
  const indicatorCenter = buildDashboardIndicatorCenter({ applications: enrichedApplications, actionClosureTrend, populationServiceBoard, certificateExchange, riskDrilldowns, siteEvidencePackage, productionReadinessGate });
  const functionalReport = buildDashboardFunctionalReport({
    applications: enrichedApplications,
    openActions,
    actionClosureTrend,
    populationServiceBoard,
    certificateExchange,
    riskDrilldowns,
    siteEvidencePackage,
    siteIssueLedger,
    jurisdictionScope,
    interfaces,
    evidence,
    siteDependencies: dependencies,
    productionReadinessGate,
    indicatorCenter
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
      siteDependencies: dependencies.length,
      productionReady: productionReadinessGate.overallStatus === "ready"
    },
    applications: enrichedApplications,
    risks,
    openActions,
    populationServiceBoard,
    certificateExchange,
    riskDrilldowns,
    siteEvidencePackage,
    productionReadinessGate,
    indicatorCenter,
    jurisdictionScope,
    actionClosureTrend,
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
  const dailyServiceReports = Array.isArray(healthStatistics.dailyServiceReports) ? healthStatistics.dailyServiceReports : [];
  const statisticsPeriod = healthStatistics.period || "";
  const eventAnchor = latestDashboardDate(
    birthRows.map((item) => item.birthDateTime),
    deathRows.map((item) => item.deathDateTime),
    dailyServiceReports.map((item) => item.reportDate || item.date || item.serviceDate)
  ) || parseDashboardDate(`${statisticsPeriod || ""}-01`) || new Date();
  const monthDays = dashboardDaysInMonth(statisticsPeriod, eventAnchor);
  const serviceTotals = serviceReports.reduce((totals, item) => {
    const interfaceData = item.interfaceData || {};
    totals.visits += Number(interfaceData.outpatientVisits || 0) + Number(interfaceData.emergencyVisits || 0);
    totals.admissions += Number(interfaceData.inpatientAdmissions || 0);
    return totals;
  }, { visits: 0, admissions: 0 });
  const hasDailyServiceReports = dailyServiceReports.length > 0;
  const serviceMetric = (period, metricId) => hasDailyServiceReports
    ? sumDashboardDailyServiceWindow(dailyServiceReports, eventAnchor, period.id, metricId)
    : Math.round(serviceTotals[metricId] * period.serviceFactor);
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
      { id: "visits", label: "就诊", value: serviceMetric(period, "visits"), unit: "人次", tone: "visit", sourceLabel: hasDailyServiceReports ? "日报门急诊接口" : "月度门急诊接口折算", source: hasDailyServiceReports ? "healthStatistics.dailyServiceReports 门急诊" : "healthStatistics.serviceReports 门急诊" },
      { id: "admissions", label: "入院", value: serviceMetric(period, "admissions"), unit: "人次", tone: "admission", sourceLabel: hasDailyServiceReports ? "日报入院接口" : "月度入院接口折算", source: hasDailyServiceReports ? "healthStatistics.dailyServiceReports 入院" : "healthStatistics.serviceReports 入院" }
    ]
  }));
  return {
    defaultPeriod: "day",
    eventAnchor: formatDashboardDate(eventAnchor),
    statisticsPeriod,
    serviceMode: hasDailyServiceReports ? "daily-interface" : "monthly-snapshot",
    dailyServiceReports: dailyServiceReports.length,
    sourceDetails: buildDashboardPopulationSourceDetails({ birthRows, deathRows, serviceReports, dailyServiceReports, hasDailyServiceReports }),
    sourceNote: hasDailyServiceReports ? "出生、死亡来自证书日期；就诊、入院来自卫生统计日报接口，日、周、月、年均按日报快照汇总。" : "出生、死亡来自证书日期；就诊、入院来自月度接口快照并折算为日、周、月、年视图。",
    insights: buildDashboardPopulationInsights(periods, { serviceReports: serviceReports.length, dailyServiceReports: dailyServiceReports.length, statisticsPeriod }),
    periods
  };
}

function buildDashboardPopulationSourceDetails(context = {}) {
  const birthRows = context.birthRows || [];
  const deathRows = context.deathRows || [];
  const serviceReports = context.serviceReports || [];
  const dailyServiceReports = context.dailyServiceReports || [];
  const hasDailyServiceReports = Boolean(context.hasDailyServiceReports);
  return [
    {
      id: "births",
      label: "出生",
      field: "birthCertificates.birthDateTime",
      source: "出生医学证明日期",
      mode: "证书日期直取",
      status: birthRows.length ? "ready" : "empty",
      records: birthRows.length
    },
    {
      id: "deaths",
      label: "死亡",
      field: "deathCertificates.deathDateTime",
      source: "死亡医学证明日期",
      mode: "证书日期直取",
      status: deathRows.length ? "ready" : "empty",
      records: deathRows.length
    },
    {
      id: "visits",
      label: "就诊",
      field: hasDailyServiceReports ? "healthStatistics.dailyServiceReports.interfaceData.outpatientVisits + emergencyVisits" : "healthStatistics.serviceReports.interfaceData.outpatientVisits + emergencyVisits",
      source: hasDailyServiceReports ? "卫生统计日报接口" : "卫生统计月报快照",
      mode: hasDailyServiceReports ? "日报汇总" : "月度折算",
      status: hasDailyServiceReports ? "ready" : serviceReports.length ? "watch" : "empty",
      records: hasDailyServiceReports ? dailyServiceReports.length : serviceReports.length
    },
    {
      id: "admissions",
      label: "入院",
      field: hasDailyServiceReports ? "healthStatistics.dailyServiceReports.interfaceData.inpatientAdmissions" : "healthStatistics.serviceReports.interfaceData.inpatientAdmissions",
      source: hasDailyServiceReports ? "卫生统计日报接口" : "卫生统计月报快照",
      mode: hasDailyServiceReports ? "日报汇总" : "月度折算",
      status: hasDailyServiceReports ? "ready" : serviceReports.length ? "watch" : "empty",
      records: hasDailyServiceReports ? dailyServiceReports.length : serviceReports.length
    }
  ];
}

function dashboardServiceReportDate(item) {
  return parseDashboardDate(item.reportDate || item.date || item.serviceDate || item.createdAt);
}

function sumDashboardDailyServiceWindow(reports, anchor, periodId, metricId) {
  if (!anchor) return 0;
  const start = new Date(anchor);
  const end = new Date(anchor);
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  if (periodId === "week") start.setDate(start.getDate() - 6);
  if (periodId === "month") start.setDate(1);
  if (periodId === "year") start.setMonth(0, 1);
  return reports.reduce((sum, item) => {
    const date = dashboardServiceReportDate(item);
    if (!date || date < start || date > end) return sum;
    const interfaceData = item.interfaceData || {};
    if (metricId === "visits") return sum + Number(interfaceData.outpatientVisits || 0) + Number(interfaceData.emergencyVisits || 0);
    if (metricId === "admissions") return sum + Number(interfaceData.inpatientAdmissions || 0);
    return sum;
  }, 0);
}

function dashboardMetricValue(periods, periodId, metricId) {
  return Number((periods.find((period) => period.id === periodId)?.metrics || []).find((metric) => metric.id === metricId)?.value || 0);
}

function buildDashboardPopulationInsights(periods, context = {}) {
  const monthBirths = dashboardMetricValue(periods, "month", "births");
  const monthDeaths = dashboardMetricValue(periods, "month", "deaths");
  const monthVisits = dashboardMetricValue(periods, "month", "visits");
  const monthAdmissions = dashboardMetricValue(periods, "month", "admissions");
  const hasDailyServiceReports = Number(context.dailyServiceReports || 0) > 0;
  const hasServiceReports = hasDailyServiceReports || Number(context.serviceReports || 0) > 0;
  return [
    { id: "certificate-coverage", title: "证照登记覆盖", value: `${monthBirths + monthDeaths}例`, status: monthBirths + monthDeaths > 0 ? "ready" : "empty", detail: "出生、死亡已按医学证明日期形成月内统计；现场需补齐撤销、补正和跨部门交换回执。" },
    { id: "medical-service-signal", title: "门急诊服务量", value: `${monthVisits}人次`, status: hasDailyServiceReports ? "ready" : hasServiceReports ? "watch" : "empty", detail: hasDailyServiceReports ? "已接入日报服务量快照，日、周、月、年视图使用真实日报汇总。" : "当前使用月度接口总量折算，日报接口接入前不用于小时级预警。" },
    { id: "admission-pressure", title: "入院承压观察", value: `${monthAdmissions}人次`, status: hasDailyServiceReports && monthAdmissions >= 5000 ? "watch" : monthAdmissions >= 20000 ? "watch" : "ready", detail: "入院量用于提示床位、转诊和医共体协同压力；生产需接入床位和出入院实时状态。" },
    { id: "site-cutover", title: "现场联调重点", value: "5类接口", status: "blocked", detail: "证照链路、院内系统、统计直报、统一身份和公安/民政/疾控回执需现场签字后替换演示路径。" }
  ];
}

function buildStaticCertificateExchange(state) {
  const healthStatistics = state.healthStatistics && typeof state.healthStatistics === "object" ? state.healthStatistics : {};
  const items = Array.isArray(healthStatistics.certificateExchangeLinks) ? healthStatistics.certificateExchangeLinks : [];
  const normalized = items.map((item) => ({
    id: item.id,
    domain: item.domain || item.name || item.id,
    source: item.source || "",
    target: item.target || "",
    owner: item.owner || "owner-pending",
    status: item.status || "watch",
    receiptStatus: item.receiptStatus || "missing",
    receiptNo: item.receiptNo || "",
    revokeSupported: Boolean(item.revokeSupported),
    correctionSupported: Boolean(item.correctionSupported),
    reconciliationStatus: item.reconciliationStatus || "pending",
    lastReceiptAt: item.lastReceiptAt || "",
    nextAction: item.nextAction || ""
  }));
  const ready = normalized.filter((item) => item.status === "ready").length;
  const blocked = normalized.filter((item) => item.status === "blocked" || item.receiptStatus === "missing").length;
  return {
    status: blocked > 0 ? "blocked" : ready === normalized.length && normalized.length > 0 ? "ready" : "watch",
    source: "healthStatistics.certificateExchangeLinks",
    summary: {
      tracks: normalized.length,
      ready,
      watch: normalized.filter((item) => item.status === "watch").length,
      blocked,
      receipts: normalized.filter((item) => item.receiptStatus === "received").length,
      reversible: normalized.filter((item) => item.revokeSupported).length,
      correctable: normalized.filter((item) => item.correctionSupported).length,
      reconciled: normalized.filter((item) => item.reconciliationStatus === "matched").length
    },
    items: normalized
  };
}

function buildStaticRiskDrilldowns(openActions) {
  const items = (openActions || []).slice(0, 8).map((item, index) => ({
    id: `risk-drilldown-${item.id || index + 1}`,
    sourceActionId: item.id,
    applicationId: item.applicationId,
    application: item.application,
    entry: item.entry,
    collection: item.collection,
    title: item.title,
    owner: item.owner,
    dueAt: item.dueAt || "",
    status: item.status || "open",
    priority: item.priority || "normal",
    blocker: item.priority === "high" ? "责任处室复核、跨部门接口回执或现场签字待确认。" : "等待源应用办理节点回写。",
    trace: [
      { step: "源应用记录", status: "linked", detail: `${item.collection || "source"} / ${item.id || ""}` },
      { step: "责任人与时限", status: item.owner ? "ready" : "watch", detail: `${item.owner || "owner-pending"} / ${item.dueAt || "due-pending"}` },
      { step: "处置复核", status: item.priority === "high" ? "watch" : "ready", detail: item.status || "open" }
    ]
  }));
  return {
    status: items.length ? "ready" : "empty",
    source: "openActions",
    summary: {
      items: items.length,
      high: items.filter((item) => item.priority === "high").length,
      withOwner: items.filter((item) => item.owner && item.owner !== "owner-pending").length,
      withTrace: items.filter((item) => item.trace.length >= 3).length
    },
    items
  };
}

function buildStaticSiteEvidencePackage(state, context = {}) {
  const healthStatistics = state.healthStatistics && typeof state.healthStatistics === "object" ? state.healthStatistics : {};
  const configured = Array.isArray(healthStatistics.siteEvidencePackage) ? healthStatistics.siteEvidencePackage : [];
  const interfaces = context.interfaces || [];
  const evidence = context.evidence || [];
  const siteDependencies = context.siteDependencies || [];
  const evidenceRecords = evidence.reduce((sum, item) => sum + (Array.isArray(item.records) ? item.records.length : 0), 0);
  const fallback = [
    { id: "summary-json", type: "发布摘要", evidence: "综合管理服务系统摘要文件", owner: "规划信息处", status: "ready", nextAction: "随发布聚合报告归档。" },
    { id: "interface-messages", type: "接口报文", evidence: `${interfaces.length} 条平台接口清单`, owner: "接口联调组", status: interfaces.length >= 4 ? "ready" : "watch", nextAction: "生产联调时替换为真实请求、响应和签名样例。" },
    { id: "acceptance-records", type: "验收记录", evidence: `${evidenceRecords} 条平台验收证据`, owner: "项目办", status: evidenceRecords >= 2 ? "ready" : "watch", nextAction: "补充现场截图、签字单和复测结论。" },
    { id: "site-signoff", type: "现场签字", evidence: `${siteDependencies.length} 项现场依赖`, owner: "各级卫生健康行政部门", status: siteDependencies.length > 0 ? "watch" : "ready", nextAction: "上线前完成身份、证照、统计、院内系统和灾备签字。" }
  ];
  const items = configured.length ? configured : fallback;
  return {
    status: items.every((item) => item.status === "ready") ? "ready" : "watch",
    source: configured.length ? "healthStatistics.siteEvidencePackage" : "platformEvidence/platformInterfaces/productionDeploymentPlan",
    summary: {
      artifacts: items.length,
      ready: items.filter((item) => item.status === "ready").length,
      watch: items.filter((item) => item.status === "watch").length,
      signed: items.filter((item) => /签字|signed|signoff/i.test(`${item.status} ${item.evidence}`)).length
    },
    items
  };
}

function buildStaticSiteIssueLedger(siteEvidencePackage = {}, siteDependencies = []) {
  const evidenceItems = Array.isArray(siteEvidencePackage.items) ? siteEvidencePackage.items : [];
  const evidenceIssues = evidenceItems.filter((item) => item.status !== "ready").map((item) => ({
    id: `evidence-${item.id}`,
    category: item.type || "现场证据",
    owner: item.owner || "项目办",
    status: item.status || "watch",
    source: item.evidence || item.id,
    nextAction: item.nextAction || "补齐现场验收材料并复核。",
    boundary: "只跟踪现场证据补齐，不替代源系统办理。"
  }));
  const dependencyIssues = siteDependencies.map((item) => ({
    id: `dependency-${item.id}`,
    category: item.track || item.name || "现场依赖",
    owner: item.owner || "现场负责人",
    status: item.status || "watch",
    source: item.id,
    nextAction: item.nextAction || item.next || "完成现场签字或联调确认。",
    boundary: "只跟踪上线依赖和签字状态，不替代外部系统建设。"
  }));
  const items = [...evidenceIssues, ...dependencyIssues];
  return {
    status: items.length ? "watch" : "ready",
    source: "siteEvidencePackage/productionDeploymentPlan",
    summary: {
      total: items.length,
      ready: items.filter((item) => item.status === "ready").length,
      watch: items.filter((item) => item.status !== "ready").length,
      owners: Array.from(new Set(items.map((item) => item.owner).filter(Boolean))).length
    },
    items
  };
}

function buildDashboardProductionAcceptanceRouting() {
  return [
    {
      id: "identity",
      gateId: "identity-audit",
      name: "统一身份接收判定",
      receiver: "规划信息处、统一认证管理员",
      requiredPreparation: "真实账号、角色映射、机构目录和区县科室权限样例",
      passCondition: "真实账号完成登录、角色映射和区县科室权限验证。",
      failedAction: "退回身份源配置并保留审计记录。",
      status: "pending"
    },
    {
      id: "audit-retention",
      gateId: "identity-audit",
      name: "审计留存接收判定",
      receiver: "安全管理岗、项目办",
      requiredPreparation: "审计导出目录、哈希链校验、留存周期和查询权限",
      passCondition: "审计导出目录、哈希链校验和查询权限全部可复核。",
      failedAction: "不得解除生产上线阻断。",
      status: "pending"
    },
    {
      id: "database",
      gateId: "data-storage",
      name: "生产数据库接收判定",
      receiver: "数据平台、运维负责人",
      requiredPreparation: "迁移日志、备份恢复截图、脱敏演练记录和回滚窗口",
      passCondition: "迁移、备份、恢复、脱敏和回滚窗口均有演练记录。",
      failedAction: "继续限定为演示或联调环境。",
      status: "pending"
    },
    {
      id: "monitoring-dr",
      gateId: "operations-dr",
      name: "监控灾备接收判定",
      receiver: "运维、安全管理岗",
      requiredPreparation: "健康检查、指标采集、告警路由、值班升级和 RTO/RPO 演练记录",
      passCondition: "健康检查、指标采集、告警路由、值班升级和 RTO/RPO 演练可追溯。",
      failedAction: "不得转连续运行。",
      status: "pending"
    },
    {
      id: "interface-signoff",
      gateId: "interface-signoff",
      name: "接口联调接收判定",
      receiver: "医疗机构接口负责人、项目办",
      requiredPreparation: "真实报文、截图、问题清单、整改复测和联合签字单",
      passCondition: "真实报文、截图、问题清单、整改复测和联合签字单一致归档。",
      failedAction: "保留接口试运行状态。",
      status: "pending"
    }
  ];
}

function buildDashboardProductionBackendGoLiveChecklist() {
  const items = [
    {
      id: "backend-runtime",
      capability: "Node.js API 生产部署",
      owner: "平台运维",
      status: "watch",
      requiredPreparation: "Node 运行时、进程守护、HTTPS、反向代理、环境变量、生产密钥和部署账号。",
      evidence: "环境部署单、域名证书、env:check:production、发布记录。",
      nextAction: "在目标服务器完成 Node API、反向代理、证书和生产环境变量配置。"
    },
    {
      id: "backend-database",
      capability: "生产数据库",
      owner: "数据平台、数据库管理员",
      status: "blocked",
      requiredPreparation: "正式数据库、连接池、迁移脚本、账号权限、索引约束、备份恢复和回滚窗口。",
      evidence: "数据库验收单、迁移日志、恢复演练报告、production-db:readiness。",
      nextAction: "用正式数据库替换演示 JSON/SQLite 口径，并完成迁移和恢复演练。"
    },
    {
      id: "backend-identity",
      capability: "统一身份与机构目录",
      owner: "规划信息处、统一认证管理员",
      status: "blocked",
      requiredPreparation: "政务统一认证或主管部门身份源、OIDC/SAML、claim 映射、机构目录和角色权限。",
      evidence: "身份联调记录、权限矩阵、拒绝访问审计、签字单。",
      nextAction: "完成真实身份源、机构目录、区县科室映射和拒绝访问审计测试。"
    },
    {
      id: "backend-interfaces",
      capability: "外部接口适配",
      owner: "接口联调组、医疗机构接口负责人",
      status: "blocked",
      requiredPreparation: "HIS/EMR/LIS/PACS、医保、电子证照、统计直报等真实接口、签名、幂等、重试和死信。",
      evidence: "字段映射表、真实报文、联调截图、整改复测、联合签字。",
      nextAction: "按 P0 接口清单完成真实报文联调、失败重试、死信和对账验证。"
    },
    {
      id: "backend-audit-retention",
      capability: "审计留存",
      owner: "安全管理岗、项目办",
      status: "blocked",
      requiredPreparation: "安全事件、访问日志、数据读取日志接入审计留存目录或 SIEM，并支持哈希链验证。",
      evidence: "AUDIT_EXPORT_PATH 或 SIEM_ENDPOINT、导出样例、留存策略。",
      nextAction: "配置生产审计留存目标，导出并校验哈希链审计样例。"
    },
    {
      id: "backend-monitoring",
      capability: "监控告警",
      owner: "运维、安全管理岗",
      status: "pending",
      requiredPreparation: "健康检查、指标采集、错误率、响应时间、任务积压、接口失败率和告警路由。",
      evidence: "监控截图、告警规则、值班表、演练记录。",
      nextAction: "接入 /api/health、/api/metrics、接口失败率、响应时间和告警升级链路。"
    },
    {
      id: "backend-dr",
      capability: "备份恢复与灾备",
      owner: "运维、数据平台",
      status: "pending",
      requiredPreparation: "自动备份、恢复脚本、RTO/RPO、灾备切换和回滚方案。",
      evidence: "备份报告、恢复日志、灾备演练报告、签字单。",
      nextAction: "完成真实数据库备份恢复、异地副本切换和 RTO/RPO 验收。"
    },
    {
      id: "backend-security-compliance",
      capability: "安全合规",
      owner: "安全管理岗、测评机构",
      status: "pending",
      requiredPreparation: "等保、密评、信创、国密、漏洞整改、最小权限和脱敏策略。",
      evidence: "测评报告、整改闭环、安全评审单。",
      nextAction: "归档等保、密评、信创、国密和上线安全评审材料。"
    }
  ];
  return {
    status: "blocked",
    summary: {
      total: items.length,
      ready: 0,
      watch: 1,
      pending: 3,
      blocked: 4
    },
    items,
    boundary: "真实上线必须使用生产级后端；当前 Node API 是基础，仍需完成生产数据库、统一身份、真实接口、审计留存、监控告警、备份恢复和安全合规闭环。"
  };
}

function buildDashboardProductionReadinessGate(productionDeploymentPlan = [], context = {}) {
  const planRows = Array.isArray(productionDeploymentPlan) ? productionDeploymentPlan : [];
  const byId = Object.fromEntries(planRows.map((item) => [item.id, item]));
  const statusValue = (item) => String(item?.status || "").toLowerCase();
  const isReady = (item) => ["ready", "done", "passed", "complete"].includes(statusValue(item));
  const isBlocked = (item) => !item || ["planned", "blocked", "missing", "pending"].includes(statusValue(item));
  const gateStatus = (items, fallback = "blocked") => {
    const rows = items.filter(Boolean);
    if (!rows.length) return fallback;
    if (rows.every(isReady)) return "ready";
    return rows.some(isBlocked) ? "blocked" : "watch";
  };
  const evidenceCount = Number(context.siteEvidencePackage?.summary?.artifacts || 0);
  const issueTotal = Number(context.siteIssueLedger?.summary?.total || 0);
  const interfaceCount = Array.isArray(context.interfaces) ? context.interfaces.length : 0;
  const gates = [
    {
      id: "runtime-env",
      name: "正式环境与密钥",
      owner: byId["prod-env-gate"]?.owner || "platform-ops",
      status: gateStatus([byId["prod-env-gate"]], "watch"),
      evidence: (byId["prod-env-gate"]?.evidence || ["env:check", "release:report"]).join(" / "),
      nextAction: "在目标服务器执行生产环境检查，确认 NODE_ENV、会话密钥、接口网关密钥和存储模式。",
      boundary: "演示环境通过不等同于生产环境通过。"
    },
    {
      id: "identity-audit",
      name: "统一身份与审计留存",
      owner: "identity-integration / security-admin",
      status: gateStatus([byId["prod-identity-adapter"], byId["prod-audit-retention"]]),
      evidence: "统一身份映射、哈希链审计、日志留存目标",
      nextAction: "完成政务统一认证映射、审计日志导出目标和留存年限签字。",
      boundary: "未完成身份源和审计留存前不得开放生产管理端。"
    },
    {
      id: "data-storage",
      name: "生产数据库与备份恢复",
      owner: byId["prod-storage-adapter"]?.owner || "data-platform",
      status: gateStatus([byId["prod-storage-adapter"]]),
      evidence: "数据库适配、迁移演练、备份恢复报告",
      nextAction: byId["prod-storage-adapter"]?.nextAction || "完成生产数据库适配、迁移、回滚和备份恢复演练。",
      boundary: "JSON/SQLite 演示快照不能作为生产主存储验收。"
    },
    {
      id: "interface-signoff",
      name: "接口联调与现场签字",
      owner: "各级卫生健康行政部门 / 接口联调组",
      status: evidenceCount >= 4 && interfaceCount >= 4 ? "watch" : "blocked",
      evidence: `${interfaceCount} 条接口轨道 / ${evidenceCount} 项现场证据 / ${issueTotal} 项整改台账`,
      nextAction: "补齐 HIS/EMR/LIS/PACS、医保、电子证照、统计直报和证照交换现场签字。",
      boundary: "本系统只汇总签字状态，不替代外部系统联调验收。"
    },
    {
      id: "operations-dr",
      name: "监控告警与灾备演练",
      owner: "platform-ops / data-platform",
      status: "blocked",
      evidence: "监控告警、值班升级、RTO/RPO、恢复演练",
      nextAction: "绑定 /api/health、/api/metrics、告警路由、备份策略和恢复演练签字。",
      boundary: "未完成监控和灾备演练前不得按连续运行系统上线。"
    }
  ];
  const summary = {
    total: gates.length,
    ready: gates.filter((item) => item.status === "ready").length,
    watch: gates.filter((item) => item.status === "watch").length,
    blocked: gates.filter((item) => item.status === "blocked").length
  };
  return {
    overallStatus: summary.blocked ? "blocked" : summary.watch ? "watch" : "ready",
    summary,
    items: gates,
    acceptanceRouting: buildDashboardProductionAcceptanceRouting(),
    backendGoLiveChecklist: buildDashboardProductionBackendGoLiveChecklist(),
    boundary: "上线运行标准以正式环境、统一身份、审计留存、生产数据库、接口签字、监控告警和灾备演练全部闭环为准。"
  };
}

function buildDashboardJurisdictionScope(state, context = {}) {
  const organizations = Array.isArray(state.authOrganizations) ? state.authOrganizations : [];
  const resources = Array.isArray(state.medicalResources) ? state.medicalResources : [];
  const jurisdictionOrganizations = organizations.filter(isDashboardHealthJurisdictionOrganization);
  const healthStatistics = state.healthStatistics && typeof state.healthStatistics === "object" ? state.healthStatistics : {};
  const dailyReports = Array.isArray(healthStatistics.dailyServiceReports) ? healthStatistics.dailyServiceReports : [];
  const openActions = context.openActions || [];
  const resourceDistricts = resources.map((item) => normalizeDashboardDistrictRegion(item.region)).filter(Boolean);
  const organizationDistricts = jurisdictionOrganizations
    .filter((item) => item.orgType === "district" || item.orgLevel === "区市县")
    .map((item) => normalizeDashboardDistrictRegion(dashboardDistrictName(item.name)))
    .filter(Boolean);
  const baseDistricts = new Set([...organizationDistricts, ...resourceDistricts]);
  const actionDistricts = openActions
    .map((item) => normalizeDashboardDistrictRegion(item.region))
    .filter((region) => region && (baseDistricts.has(region) || /(?:区|县|市)$/.test(region)));
  const districtNames = Array.from(new Set([
    ...organizationDistricts,
    ...resourceDistricts,
    ...actionDistricts
  ].filter(Boolean))).sort((left, right) => left.localeCompare(right, "zh-CN"));
  const allResourceTypes = Array.from(new Set(resources.map((item) => item.type || item.orgLevel).filter(Boolean))).sort((left, right) => left.localeCompare(right, "zh-CN"));
  const districts = [
    buildDashboardJurisdictionRow("全市", { organizations: jurisdictionOrganizations, resources, dailyReports, openActions, all: true }),
    ...districtNames.map((district) => buildDashboardJurisdictionRow(district, { organizations: jurisdictionOrganizations, resources, dailyReports, openActions }))
  ];
  const totals = districts[0] || {};
  return {
    defaultDistrict: "",
    districtOptions: districtNames,
    institutionTypeOptions: allResourceTypes,
    summary: {
      districts: districtNames.length,
      institutions: totals.institutions || 0,
      beds: totals.beds || 0,
      doctors: totals.doctors || 0,
      openActions: totals.openActions || 0,
      highRisks: totals.highRisks || 0,
      serviceReports: totals.serviceReports || 0
    },
    districts
  };
}

function dashboardDistrictName(name) {
  return String(name || "").replace(/健康城市平台|卫生健康局|县域医共体/g, "").trim();
}

function isDashboardHealthJurisdictionOrganization(item = {}) {
  return ["city", "district", "health_admin"].includes(item.orgType);
}

function normalizeDashboardDistrictRegion(value) {
  const region = String(value || "").trim();
  if (!region || region === "市级" || /医保/.test(region)) return "";
  return region.replace(/健康城市平台|卫生健康局|县域医共体/g, "").trim();
}

function buildDashboardJurisdictionRow(district, context = {}) {
  const all = Boolean(context.all);
  const organizations = context.organizations || [];
  const resources = context.resources || [];
  const dailyReports = context.dailyReports || [];
  const openActions = context.openActions || [];
  const scopedResources = all ? resources : resources.filter((item) => item.region === district);
  const scopedOrganizations = all ? organizations : organizations.filter((item) => dashboardDistrictName(item.name) === district || (item.parentCode === "ORG-DIST-ZS" && district === "中山区"));
  const scopedReports = all ? dailyReports : dailyReports.filter((item) => item.region === district);
  const scopedActions = all ? openActions : openActions.filter((item) => item.region === district || JSON.stringify(item).includes(district));
  const serviceTotals = scopedReports.reduce((totals, item) => {
    const data = item.interfaceData || {};
    totals.visits += Number(data.outpatientVisits || 0) + Number(data.emergencyVisits || 0);
    totals.admissions += Number(data.inpatientAdmissions || 0);
    return totals;
  }, { visits: 0, admissions: 0 });
  const typeCounts = scopedResources.reduce((counts, item) => {
    const type = item.type || "未标注";
    counts[type] = (counts[type] || 0) + 1;
    return counts;
  }, {});
  return {
    id: all ? "all" : `district-${district}`,
    district,
    status: scopedActions.some((item) => item.priority === "high") ? "watch" : "ready",
    organizations: scopedOrganizations.length,
    institutions: scopedResources.length,
    institutionTypes: Object.entries(typeCounts).map(([type, count]) => ({ type, count })),
    beds: scopedResources.reduce((sum, item) => sum + Number(item.beds || 0), 0),
    doctors: scopedResources.reduce((sum, item) => sum + Number(item.doctors || 0), 0),
    openActions: scopedActions.length,
    highRisks: scopedActions.filter((item) => item.priority === "high").length,
    serviceReports: scopedReports.length,
    visits: serviceTotals.visits,
    admissions: serviceTotals.admissions,
    institutionsList: scopedResources.map((item) => ({
      id: item.id || item.institutionId || item.name,
      name: item.name || item.institution || item.id || "未命名机构",
      type: item.type || item.orgLevel || "未标注",
      region: item.region || district,
      beds: Number(item.beds || 0),
      doctors: Number(item.doctors || 0)
    })),
    serviceReportList: scopedReports.map((item) => ({
      id: item.id || item.reportId || item.reportDate,
      reportDate: item.reportDate || item.date || item.period || "",
      institution: item.institution || item.institutionName || item.orgName || item.region || district,
      visits: Number(item.interfaceData?.outpatientVisits || 0) + Number(item.interfaceData?.emergencyVisits || 0),
      admissions: Number(item.interfaceData?.inpatientAdmissions || 0),
      status: item.status || item.reviewStatus || "待复核"
    })),
    actionList: scopedActions.slice(0, 6).map((item) => ({
      id: item.id,
      title: item.title || item.collection || "源应用待办",
      application: item.application || item.applicationId || "源应用",
      owner: item.owner || "待明确",
      status: item.status || "open",
      priority: item.priority || "normal",
      dueAt: item.dueAt || "",
      entry: item.entry || ""
    })),
    nextAction: all ? "市级视角继续补齐各区县机构目录、日报接口和闭环率对账。" : "县级视角继续补齐辖区机构目录、源应用回写和问题整改台账。"
  };
}

function buildDashboardActionClosureTrend(actions, context = {}) {
  const rows = Array.isArray(actions) ? actions : [];
  const anchor = latestDashboardDate(rows.map((item) => item.dueAt), rows.map((item) => item.updatedAt)) || new Date();
  const periods = [
    { id: "day", label: "日", days: 1 },
    { id: "week", label: "周", days: 7 },
    { id: "month", label: "月", month: true },
    { id: "year", label: "年", year: true }
  ].map((period) => buildDashboardActionPeriod(period, rows, anchor));
  const applications = Object.values(rows.reduce((summary, item) => {
    const key = item.applicationId || item.application || "unknown";
    const row = summary[key] || {
      id: key,
      application: item.application || item.applicationId || "源应用",
      total: 0,
      closed: 0,
      open: 0,
      overdue: 0,
      highRisks: 0
    };
    row.total += 1;
    if (item.closed) row.closed += 1;
    else row.open += 1;
    if (item.overdue) row.overdue += 1;
    if (item.priority === "high") row.highRisks += 1;
    summary[key] = row;
    return summary;
  }, {})).map((item) => ({
    ...item,
    closureRate: dashboardRate(item.closed, item.total),
    overdueRate: dashboardRate(item.overdue, item.total)
  })).sort((left, right) => right.overdueRate - left.overdueRate || right.open - left.open || left.application.localeCompare(right.application, "zh-CN"));
  const total = rows.length;
  const closed = rows.filter((item) => item.closed).length;
  const overdue = rows.filter((item) => item.overdue).length;
  const open = total - closed;
  const closureRate = dashboardRate(closed, total);
  const overdueRate = dashboardRate(overdue, total);
  return {
    status: overdue ? "watch" : "ready",
    source: "source application task collections",
    generatedAt: new Date().toISOString(),
    summary: {
      total,
      open,
      closed,
      overdue,
      highRisks: rows.filter((item) => item.priority === "high").length,
      closureRate,
      overdueRate,
      previewOpenActions: context.openActions?.length || open
    },
    periods,
    applications,
    boundary: "仅用于卫生健康行政部门监管、督办和调度分析；具体办理、接诊、审核、随访和整改仍在源应用闭环。"
  };
}

function buildDashboardActionPeriod(period, rows, anchor) {
  const start = new Date(anchor);
  start.setHours(0, 0, 0, 0);
  if (period.days) start.setDate(start.getDate() - period.days + 1);
  if (period.month) start.setDate(1);
  if (period.year) start.setMonth(0, 1);
  const end = new Date(anchor);
  end.setHours(23, 59, 59, 999);
  const periodRows = rows.filter((item) => {
    const date = parseDashboardDate(item.dueAt || item.updatedAt);
    return date && date >= start && date <= end;
  });
  const total = periodRows.length;
  const closed = periodRows.filter((item) => item.closed).length;
  const overdue = periodRows.filter((item) => item.overdue).length;
  return {
    id: period.id,
    label: period.label,
    rangeLabel: `${formatDashboardDate(start)} 至 ${formatDashboardDate(end)}`,
    total,
    closed,
    open: total - closed,
    overdue,
    closureRate: dashboardRate(closed, total),
    overdueRate: dashboardRate(overdue, total)
  };
}

function dashboardRate(part, total) {
  return total > 0 ? Math.round((Number(part || 0) / total) * 100) : 0;
}

function buildDashboardDepartmentFunctionMatrix(context = {}) {
  const applications = context.applications || [];
  const openActions = context.openActions || [];
  const populationServiceBoard = context.populationServiceBoard || {};
  const certificateExchange = context.certificateExchange || { summary: {} };
  const riskDrilldowns = context.riskDrilldowns || { summary: {} };
  const siteEvidencePackage = context.siteEvidencePackage || { summary: {} };
  const interfaces = context.interfaces || [];
  const evidence = context.evidence || [];
  const siteDependencies = context.siteDependencies || [];
  const sourceRecords = applications.reduce((sum, item) => sum + Number(item.records || 0), 0);
  const evidenceRecords = evidence.reduce((sum, item) => sum + (Array.isArray(item.records) ? item.records.length : 0), 0);
  return [
    {
      id: "planning-information",
      name: "规划信息处/信息中心",
      level: "内部机构",
      implemented: [`${applications.length}个源应用汇总入口`, `日/周/月/年服务量看板（${populationServiceBoard.serviceMode || "snapshot"}）`, `${interfaces.length}条接口联调轨道`, `${siteEvidencePackage.summary?.artifacts || 0}项现场证据包`],
      nextPlan: "接入市级平台运行监控、真实卫生统计日报、机构目录和生产数据库适配，形成按区县和机构钻取的运行视图。",
      evidence: "healthDashboardSummary.populationServiceBoard/platformInterfaces/siteEvidencePackage",
      status: populationServiceBoard.serviceMode === "daily-interface" ? "ready" : "watch"
    },
    {
      id: "medical-administration",
      name: "医政医管处",
      level: "内部机构",
      implemented: ["就诊、入院、出院、床位日报汇总", "转诊、远程会诊、医技互认和高风险待办归集", `${riskDrilldowns.summary?.items || 0}条风险下钻处置轨迹`],
      nextPlan: "联调 HIS、EMR、LIS、PACS、床位、远程会诊和检查检验互认接口，补齐处置回写和复核签字。",
      evidence: "healthStatistics.dailyServiceReports/openActions/riskDrilldowns",
      status: riskDrilldowns.summary?.items ? "ready" : "watch"
    },
    {
      id: "primary-public-health",
      name: "基层卫生处/公共卫生处",
      level: "内部机构",
      implemented: ["县域医共体、基层慢病、家庭医生和公共卫生任务汇总", "基层风险、逾期随访、上转复核和服务协同待办", `${openActions.length}条预览待办与源应用导航`],
      nextPlan: "按区县维度接入基层源业务回写结果，形成监管用闭环率和超期率看板；基层机构具体办理仍在源业务系统完成。",
      evidence: "county.html/index.html/openActions",
      status: openActions.length ? "watch" : "ready"
    },
    {
      id: "maternal-child",
      name: "妇幼健康处",
      level: "内部机构",
      implemented: ["出生医学证明指标纳入四周期统计", "出生证照交换、撤销、补正、回执和跨部门对账状态", `${certificateExchange.summary?.receipts || 0}条交换回执`],
      nextPlan: "联调出生医学证明签发系统、省电子证照平台和公安户籍回执，补齐撤销、补正和纸电一致性证据。",
      evidence: "birthCertificates/certificateExchange",
      status: certificateExchange.summary?.receipts >= 3 ? "ready" : "watch"
    },
    {
      id: "disease-control",
      name: "疾控处/应急办",
      level: "内部机构",
      implemented: ["死亡医学证明、死因监测和公共卫生风险汇总", "死亡证照、疾控死因监测和法定传染病关联链路", "高风险预警纳入管理端任务闭环"],
      nextPlan: "联调疾控死因监测、传染病报告、突发公共卫生事件和应急处置接口，补齐编码修订和补报回执。",
      evidence: "deathCertificates/certificateExchange/openActions",
      status: certificateExchange.summary?.blocked > 0 ? "watch" : "ready"
    },
    {
      id: "supervision-policy",
      name: "综合监督处/政策法规处",
      level: "内部机构",
      implemented: ["政策说明、数据边界、管理端权限和审计链说明", `${evidenceRecords}条平台验收证据`, `${sourceRecords}条源应用记录纳入汇总审计`],
      nextPlan: "补齐行政监管事项清单、执法监督接口、数据授权规则和个人信息保护影响评估证据。",
      evidence: "health-dashboard-about.html/platformEvidence/securityEvents",
      status: evidenceRecords >= 2 ? "ready" : "watch"
    },
    {
      id: "project-security",
      name: "项目办/安全管理岗",
      level: "内部机构",
      implemented: ["发布报告、部署门禁、现场证据包和验收材料索引", "接口报文、验收记录、现场签字和复测结论归集", `${siteDependencies.length}项生产现场依赖`],
      nextPlan: "完成生产统一身份、审计留存、监控告警、备份恢复、等保密评、信创适配和上线签字闭环。",
      evidence: "release-report/deploy-check/siteEvidencePackage",
      status: siteEvidencePackage.summary?.ready >= 3 ? "ready" : "watch"
    }
  ];
}

function buildDashboardCityCountyFunctionMatrix(context = {}) {
  const applications = context.applications || [];
  const openActions = context.openActions || [];
  const certificateExchange = context.certificateExchange || { summary: {} };
  const riskDrilldowns = context.riskDrilldowns || { summary: {} };
  const siteEvidencePackage = context.siteEvidencePackage || { summary: {} };
  const interfaces = context.interfaces || [];
  return [
    {
      id: "city-health-commission",
      level: "市级",
      agency: "市卫生健康委",
      implemented: ["跨前七应用总览、指标、风险、任务和验收证据汇总", "出生、死亡、就诊、入院四指标日/周/月/年看板", "按医政、基层、公卫、妇幼、疾控、监督和规划信息职能关联源模块"],
      nextPlan: "建设市级行政监管专题视图；医疗机构、平台中心、专业中心和基层机构仅作为数据来源或协同对象，不在本系统承接办理职责。",
      evidence: "/api/health-dashboard/summary",
      status: applications.length === 7 ? "ready" : "watch"
    },
    {
      id: "city-admin-coordination",
      level: "市级",
      agency: "市级卫生健康行政部门业务处室",
      implemented: [`规划信息处关联${interfaces.length}条接口联调轨道和${siteEvidencePackage.summary?.artifacts || 0}项现场证据包`, `妇幼、疾控、统计职能汇总${certificateExchange.summary?.tracks || 0}条证照/统计交换链路`, `医政医管、基层公卫职能监管${riskDrilldowns.summary?.items || 0}条风险下钻和${openActions.length}条跨应用待办`],
      nextPlan: "补齐处室职责清单、事项权限、督办规则和审计字段；源业务办理继续回到对应业务系统。",
      evidence: "platformInterfaces/certificateExchange/riskDrilldowns/openActions",
      status: interfaces.length >= 5 && certificateExchange.summary?.tracks >= 5 ? "ready" : "watch"
    },
    {
      id: "county-health-bureau",
      level: "县级",
      agency: "区县卫生健康局",
      implemented: ["按行政辖区汇总基层、医共体、慢病、转诊和公共卫生监管信号", `${openActions.length}条跨应用预览待办`, "可从管理系统回到源应用查看、督办和留痕，具体办理不在本系统完成"],
      nextPlan: "增加区县筛选、辖区机构监管看板、任务闭环率、超期率和现场问题整改台账。",
      evidence: "county.html/index.html/openActions",
      status: openActions.length ? "watch" : "ready"
    },
    {
      id: "county-admin-coordination",
      level: "县级",
      agency: "区县卫生健康行政部门业务科室",
      implemented: ["基层卫生、医政医管、公卫和妇幼职能按源模块分工关联", "医共体牵头医院、乡镇卫生院和社区卫生服务中心仅作为辖区服务数据来源", "入院、床位、随访和证照信号用于监管提示，不下放医疗机构办理任务"],
      nextPlan: "建立区县业务科室与源模块的权限映射，现场联调只验收数据归集、督办和审计，不替代机构端业务闭环。",
      evidence: "county.html/riskDrilldowns/healthStatistics.dailyServiceReports/siteEvidencePackage",
      status: "watch"
    }
  ];
}

function buildDashboardIndicatorCenter(context = {}) {
  const applications = context.applications || [];
  const populationServiceBoard = context.populationServiceBoard || { summary: {}, periods: [] };
  const certificateExchange = context.certificateExchange || { summary: {}, items: [] };
  const riskDrilldowns = context.riskDrilldowns || { summary: {}, items: [] };
  const siteEvidencePackage = context.siteEvidencePackage || { summary: {}, items: [] };
  const actionClosureTrend = context.actionClosureTrend || { summary: {}, periods: [] };
  const productionReadinessGate = context.productionReadinessGate || { overallStatus: "blocked", summary: {}, items: [] };
  const sourceRecords = applications.reduce((sum, item) => sum + Number(item.records || 0), 0);
  const sourceOpenActions = applications.reduce((sum, item) => sum + Number(item.openActions || 0), 0);
  const highRisks = applications.reduce((sum, item) => sum + Number(item.highRisks || 0), 0);
  const backendChecklist = productionReadinessGate.backendGoLiveChecklist || { summary: {}, items: [] };
  const monthPeriod = (populationServiceBoard.periods || []).find((item) => item.id === "month") || { metrics: [] };
  const metricValue = (id) => monthPeriod.metrics?.find((item) => item.id === id)?.value || 0;
  const dimensions = [
    { id: "performance", name: "公立医院绩效考核", owner: "医政医管处、规划信息处", policy: "对齐国家公立医院绩效考核与高质量发展运营评价。" },
    { id: "grade-review", name: "等级评审", owner: "医政医管处、项目办", policy: "围绕四甲/五乙评审、互联互通测评和现场证据闭环。" },
    { id: "quality", name: "医疗质量", owner: "医政医管处、质控中心", policy: "聚焦高风险事件、质量安全、处置闭环和可追溯证据。" },
    { id: "operation", name: "运营效率", owner: "规划信息处、财务运营协同", policy: "支持运行决策、服务量、任务效率和资源调度分析。" },
    { id: "chronic", name: "慢病管理", owner: "基层卫生处、公卫处", policy: "汇总慢病筛查、随访、教育、用药和医防融合任务。" },
    { id: "experience", name: "服务体验/便民惠民", owner: "妇幼处、基层卫生处、政务服务协同", policy: "关注出生死亡证照、居民服务、回执和便民协同。" },
    { id: "interface-launch", name: "接口联调/上线准备", owner: "规划信息处、项目办、安全管理岗", policy: "覆盖接口联调、生产后端、审计留存、灾备和上线门禁。" },
    { id: "standard", name: "标准指标集", owner: "规划信息处、统计信息岗", policy: "沉淀统一指标目录、口径、来源、质量和责任方。" }
  ];
  const indicators = [
    { id: "standard-indicator-catalog", dimension: "standard", name: "标准指标目录覆盖率", definition: "已纳入统一目录的指标数 / 本期应纳入指标数，覆盖绩效、评审、质量、运营、慢病、体验和上线准备。", source: "healthDashboardSummary / applicationCatalog / platformEvidence", owner: "规划信息处、统计信息岗", currentValue: `${sourceRecords} 条源记录 / 7 个源应用`, targetValue: "形成可追溯标准指标集并逐项绑定口径、来源和责任方", trend: "稳定扩展", status: "ready", quality: "高", confidence: 88, blockers: ["现场需确认最终标准指标编码和上报口径"], drilldown: { label: "查看功能报告", href: "#dashboard-function-report", evidence: "functionalReport/functions" } },
    { id: "performance-public-hospital", dimension: "performance", name: "公立医院绩效考核对齐度", definition: "围绕国家公立医院绩效考核的医疗质量、运营效率、持续发展和满意度维度建立指标映射。", source: "healthStatistics.dailyServiceReports / institutionCreditEvaluations / platformInterfaces", owner: "医政医管处、规划信息处", currentValue: `月就诊 ${metricValue("visits").toLocaleString("zh-CN")} 人次 / 入院 ${metricValue("admissions").toLocaleString("zh-CN")} 人次`, targetValue: "接入国家绩效考核口径、病案首页和 DRG/DIP 评价数据", trend: "需联调", status: "watch", quality: "中", confidence: 76, blockers: ["缺国家绩效考核平台真实回传", "缺病案首页质量与 DRG/DIP 明细"], drilldown: { label: "查看运营服务看板", href: "#population-service-board", evidence: "populationServiceBoard" } },
    { id: "grade-review-evidence", dimension: "grade-review", name: "等级评审证据闭环率", definition: "已形成可审查证据的评审材料 / 等级评审与互联互通现场材料总数。", source: "platformEvidence / siteEvidencePackage / release-artifact-manifest", owner: "项目办、医政医管处", currentValue: `${siteEvidencePackage.summary?.ready || 0}/${siteEvidencePackage.summary?.artifacts || 0} 项证据已就绪`, targetValue: "四甲/五乙、互联互通、整改复测和签字材料全量闭环", trend: "持续补证", status: siteEvidencePackage.summary?.ready >= 3 ? "ready" : "watch", quality: "高", confidence: 84, blockers: ["生产现场截图、第三方测评结论仍需替换演示样例"], drilldown: { label: "查看现场验收证据包", href: "#site-evidence-package", evidence: "siteEvidencePackage" } },
    { id: "quality-risk-closure", dimension: "quality", name: "医疗质量风险闭环率", definition: "已闭环质量风险 / 全部高风险与预警任务，按责任人、时限、轨迹和阻塞项追踪。", source: "riskDrilldowns / emergencySignals / followups / countyAcceptanceLedger", owner: "医政医管处、质控中心", currentValue: `${riskDrilldowns.summary?.items || 0} 条风险下钻 / ${highRisks} 条高风险`, targetValue: "高风险 100% 明确责任人、时限和复核结论", trend: "需督办", status: highRisks > 0 ? "watch" : "ready", quality: "中", confidence: 78, blockers: ["源应用处置结论尚未全部回写到驾驶舱"], drilldown: { label: "查看风险下钻", href: "#risk-drilldown-board", evidence: "riskDrilldowns" } },
    { id: "operation-closure-efficiency", dimension: "operation", name: "运营任务闭环效率", definition: "跨应用任务闭环率、超期率和应用分布，用于行政调度和运营决策。", source: "actionClosureTrend / openActions / sourceApplications", owner: "规划信息处、运行调度岗", currentValue: `闭环率 ${actionClosureTrend.summary?.closureRate || 0}% / 超期率 ${actionClosureTrend.summary?.overdueRate || 0}%`, targetValue: "闭环率 >=95%，超期率 <=5%", trend: "受阻", status: (actionClosureTrend.summary?.overdueRate || 0) > 20 ? "blocked" : "watch", quality: "中", confidence: 74, blockers: [`仍有 ${sourceOpenActions} 条源应用待办需回到源系统闭环`], drilldown: { label: "查看任务闭环趋势", href: "#action-closure-trend-board", evidence: "actionClosureTrend" } },
    { id: "chronic-management-continuity", dimension: "chronic", name: "慢病医防融合连续管理", definition: "慢病筛查、随访、教育、管理计划和用药支持的连续服务任务汇总。", source: "followups / chronicScreeningTasks / chronicEducationPushes / chronicManagementPlans", owner: "基层卫生处、公卫处", currentValue: `${applications.find((item) => item.id === "commission-supervision")?.openActions || 0} 条综合监管源待办`, targetValue: "慢病筛查、随访、教育、处方和复核闭环可追踪", trend: "需闭环", status: "watch", quality: "中", confidence: 72, blockers: ["家庭医生、药师和公卫随访结果仍需现场接口回写"], drilldown: { label: "查看任务闭环", href: "#dashboard-actions-panel", evidence: "openActions/followups" } },
    { id: "experience-certificate-service", dimension: "experience", name: "便民证照服务协同", definition: "出生、死亡、电子证照、公安、民政、疾控和统计直报回执协同情况。", source: "birthCertificates / deathCertificates / digitalCredentials / certificateExchange", owner: "妇幼处、基层卫生处、政务服务协同", currentValue: `${certificateExchange.summary?.receipts || 0} 条回执 / ${certificateExchange.summary?.tracks || 0} 条证照链路`, targetValue: "证照回执、补正、撤销、对账和跨部门共享全链条闭环", trend: "需补回执", status: certificateExchange.status === "ready" ? "ready" : "watch", quality: "中", confidence: 75, blockers: ["公安户籍、民政殡葬、疾控死因监测回执需现场确认"], drilldown: { label: "查看证照交换", href: "#certificate-exchange-board", evidence: "certificateExchange" } },
    { id: "interface-launch-readiness", dimension: "interface-launch", name: "接口联调与上线准备通过率", definition: "接口联调、生产后端、统一身份、审计留存、监控告警、备份恢复和安全合规的上线门禁状态。", source: "platformInterfaces / productionReadinessGate / backendGoLiveChecklist", owner: "规划信息处、项目办、安全管理岗", currentValue: `${productionReadinessGate.summary?.ready || 0}/${productionReadinessGate.summary?.total || 0} 项门禁就绪，后端 ${backendChecklist.summary?.blocked || 0} 项阻塞`, targetValue: "生产门禁、后端清单和接口签字全部通过", trend: "阻塞", status: "blocked", quality: "中", confidence: 70, blockers: ["生产数据库、统一身份、真实接口、审计留存仍未现场签字"], drilldown: { label: "查看上线门禁", href: "#production-readiness-board", evidence: "productionReadinessGate/backendGoLiveChecklist" } }
  ];
  const dimensionLookup = Object.fromEntries(dimensions.map((item) => [item.id, item]));
  const reformCategories = [
    { id: "operation", name: "运营", owner: "规划信息处、运行调度岗", target: "服务量、闭环效率、运营决策和资源调度。" },
    { id: "quality", name: "质量", owner: "医政医管处、质控中心", target: "医疗质量、等级评审、风险下钻和整改复核。" },
    { id: "safety", name: "安全", owner: "安全管理岗、项目办", target: "上线门禁、审计留存、灾备演练和安全合规。" },
    { id: "coordination", name: "协同", owner: "医政医管处、基层卫生处", target: "医共体、转诊、证照交换和跨部门接口协同。" },
    { id: "public-health", name: "公卫", owner: "公卫处、基层卫生处", target: "慢病、公卫随访、出生死亡和疾控协同。" },
    { id: "research", name: "科研", owner: "科教处、科研管理岗", target: "科研数据集、专病库、转化证据和伦理合规。" },
    { id: "resource-efficiency", name: "资源效率", owner: "规划信息处、财务运营协同", target: "床位、人力、设备、药耗和服务效率。" }
  ];
  const categoryByIndicator = {
    "standard-indicator-catalog": "operation",
    "performance-public-hospital": "resource-efficiency",
    "grade-review-evidence": "quality",
    "quality-risk-closure": "quality",
    "operation-closure-efficiency": "operation",
    "chronic-management-continuity": "public-health",
    "experience-certificate-service": "coordination",
    "interface-launch-readiness": "safety"
  };
  const enriched = indicators.map((item) => ({
    ...item,
    reformCategory: categoryByIndicator[item.id] || "operation",
    dimensionName: dimensionLookup[item.dimension]?.name || item.dimension,
    dimensionOwner: dimensionLookup[item.dimension]?.owner || item.owner
  }));
  return {
    title: "指标中心",
    basis: "吸收标准指标集、国家公立医院绩效考核、等级评审、运营决策和指标下钻思路，服务各级卫生健康行政部门审查。",
    summary: {
      indicators: enriched.length,
      dimensions: dimensions.length,
      ready: enriched.filter((item) => item.status === "ready").length,
      watch: enriched.filter((item) => item.status === "watch").length,
      blocked: enriched.filter((item) => item.status === "blocked").length,
      averageConfidence: Math.round(enriched.reduce((sum, item) => sum + Number(item.confidence || 0), 0) / enriched.length)
    },
    dimensions: dimensions.map((item) => ({ ...item, indicators: enriched.filter((indicator) => indicator.dimension === item.id).length })),
    reformCategories: reformCategories.map((item) => ({ ...item, indicators: enriched.filter((indicator) => indicator.reformCategory === item.id).length })),
    aggregationEntrypoints: [
      { id: "smart-hospital", name: "智慧医院管理线汇聚入口", href: "#dashboard-indicator-center", status: "planned", modules: ["医疗质量安全", "医院运行监测", "科研平台", "药品耗材监管"], nextAction: "等待各智慧医院子模块完成首轮指标 API 后接入本指标中心。" },
      { id: "medical-consortium", name: "医共体协同指标汇聚入口", href: "#dashboard-indicator-center", status: "planned", modules: ["转诊", "会诊", "检查检验互认", "基层随访"], nextAction: "接收医共体协同闭环线程输出的协同效率和闭环完成率。" },
      { id: "public-health", name: "公卫闭环指标汇聚入口", href: "#dashboard-indicator-center", status: "planned", modules: ["慢病管理", "监测预警", "任务派发", "随访回填"], nextAction: "接收公卫风险闭环线程输出的预警、干预和随访指标。" }
    ],
    indicators: enriched,
    releaseEvidence: [
      { id: "indicator-center-summary", name: "指标中心摘要", evidence: "healthDashboardSummary.indicatorCenter" },
      { id: "indicator-center-page", name: "驾驶舱指标中心页面", evidence: "health-dashboard.html#dashboard-indicator-center" },
      { id: "indicator-center-release", name: "指标中心发布证据", evidence: "docs/health-dashboard-indicator-center-report.md" }
    ],
    boundary: "指标中心只做行政管理、绩效评估、等级评审和上线审查的指标汇总与下钻，不替代国家平台、医院源系统或业务处置系统。"
  };
}

function buildDashboardFunctionalReport(context) {
  const applications = context.applications || [];
  const openActions = context.openActions || [];
  const populationServiceBoard = context.populationServiceBoard || {};
  const interfaces = context.interfaces || [];
  const evidence = context.evidence || [];
  const siteDependencies = context.siteDependencies || [];
  const certificateExchange = context.certificateExchange || { summary: {}, items: [] };
  const riskDrilldowns = context.riskDrilldowns || { summary: {}, items: [] };
  const siteEvidencePackage = context.siteEvidencePackage || { summary: {}, items: [] };
  const jurisdictionScope = context.jurisdictionScope || { summary: {}, districts: [] };
  const actionClosureTrend = context.actionClosureTrend || { summary: {}, periods: [] };
  const productionReadinessGate = context.productionReadinessGate || { overallStatus: "blocked", summary: {}, items: [] };
  const indicatorCenter = context.indicatorCenter || { summary: {}, indicators: [] };
  const departmentFunctionMatrix = buildDashboardDepartmentFunctionMatrix(context);
  const cityCountyFunctionMatrix = buildDashboardCityCountyFunctionMatrix(context);
  const sourceRecords = applications.reduce((sum, item) => sum + Number(item.records || 0), 0);
  const sourceOpenActions = applications.reduce((sum, item) => sum + Number(item.openActions || 0), 0);
  const highRisks = applications.reduce((sum, item) => sum + Number(item.highRisks || 0), 0);
  const evidenceRecords = evidence.reduce((sum, item) => sum + (Array.isArray(item.records) ? item.records.length : 0), 0);
  const functions = [
    {
      id: "aggregate-entry",
      name: "前七应用汇总入口",
      status: applications.length === 7 ? "ready" : "watch",
      evidence: `${applications.length} 个源应用，${sourceRecords} 条源记录`,
      boundary: "只做跨应用总览与导航，不替代源应用业务办理。"
    },
    {
      id: "population-service-board",
      name: "出生死亡就诊入院看板",
      status: populationServiceBoard.periods?.length === 4 ? "ready" : "watch",
      evidence: `${populationServiceBoard.periods?.length || 0} periods, ${populationServiceBoard.insights?.length || 0} insights, ${populationServiceBoard.sourceDetails?.length || 0} source fields`,
      boundary: "就诊、入院已按日报快照汇总日周月年，小时级预警和生产切换仍需实时明细。"
    },
    {
      id: "jurisdiction-workbench",
      name: "市县两级行政工作台",
      status: cityCountyFunctionMatrix.length >= 4 ? "ready" : "watch",
      evidence: `${cityCountyFunctionMatrix.length} 条市县机构功能矩阵`,
      boundary: "仅面向卫生健康行政部门监管、督办、审计和联调；非本机关单位不承接本系统办理职责。"
    },
    {
      id: "jurisdiction-scope-drilldown",
      name: "辖区机构监管钻取",
      status: jurisdictionScope.districts?.length ? "ready" : "watch",
      evidence: `${jurisdictionScope.summary?.districts || 0} 个辖区，${jurisdictionScope.summary?.institutions || 0} 个机构，${jurisdictionScope.summary?.openActions || 0} 条待办`,
      boundary: "仅按辖区汇总机构目录、日报服务量和源应用待办，不替代区县或机构端办理。"
    },
    {
      id: "task-closure-trend",
      name: "任务闭环率与超期率趋势",
      status: actionClosureTrend.summary?.overdue ? "watch" : "ready",
      evidence: `${actionClosureTrend.summary?.closureRate || 0}% 闭环率，${actionClosureTrend.summary?.overdueRate || 0}% 超期率，${actionClosureTrend.periods?.length || 0} 个周期`,
      boundary: "仅做行政监管、调度和审计分析；源任务办理继续在对应业务系统完成。"
    },
    {
      id: "department-workbench",
      name: "内设机构职能台账",
      status: departmentFunctionMatrix.length >= 6 ? "ready" : "watch",
      evidence: `${departmentFunctionMatrix.length} 条委机关内设机构职能矩阵`,
      boundary: "按规划信息、医政、基层公卫、妇幼、疾控、监督和项目安全职责关联源模块，不带入非本机关办理任务。"
    },
    {
      id: "indicator-center",
      name: "指标中心",
      status: indicatorCenter.indicators?.length >= 8 ? "ready" : "watch",
      evidence: `${indicatorCenter.summary?.indicators || 0} 个指标，${indicatorCenter.summary?.dimensions || 0} 个维度，平均可信度 ${indicatorCenter.summary?.averageConfidence || 0}%`,
      boundary: "按标准指标集、绩效考核、等级评审、运营决策和上线准备形成可审查指标目录；不替代源系统上报。"
    },
    {
      id: "certificate-exchange-chain",
      name: "证照交换链路",
      status: certificateExchange.status === "ready" ? "ready" : "watch",
      evidence: `${certificateExchange.summary?.tracks || 0} tracks, ${certificateExchange.summary?.receipts || 0} receipts, ${certificateExchange.summary?.reconciled || 0} reconciled`,
      boundary: "汇总出生、死亡、电子证照、公安、民政、疾控和统计直报回执，不替代各部门源系统办件。"
    },
    {
      id: "risk-action-loop",
      name: "风险预警与任务闭环",
      status: openActions.length > 0 ? "watch" : "ready",
      evidence: `${openActions.length} 条预览待办，${sourceOpenActions} 条源应用待办，${highRisks} 条高风险`,
      boundary: "处置回写仍在源业务端完成。"
    },
    {
      id: "risk-drilldown-loop",
      name: "风险下钻与处置轨迹",
      status: riskDrilldowns.items?.length ? "ready" : "watch",
      evidence: `${riskDrilldowns.summary?.items || 0} 条下钻记录，${riskDrilldowns.summary?.withTrace || 0} 条已有轨迹`,
      boundary: "展示源应用链接、责任人、时限、状态和阻塞原因；不直接修改源业务记录。"
    },
    {
      id: "interface-evidence",
      name: "接口联调与验收证据",
      status: interfaces.length >= 4 && evidenceRecords >= 2 ? "ready" : "watch",
      evidence: `${interfaces.length} 条接口轨道，${evidenceRecords} 条验收证据`,
      boundary: "复用平台接口和验收证据，不替代现场签字。"
    },
    {
      id: "policy-about",
      name: "政策说明与关于页",
      status: "ready",
      evidence: "系统说明页面",
      boundary: "说明政策依据、数据口径和现场切换条件。"
    },
    {
      id: "release-audit",
      name: "发布审计与验收报告",
      status: siteDependencies.length > 0 ? "watch" : "ready",
      evidence: "综合管理服务系统摘要、发布聚合报告、部署门禁",
      boundary: "生产切换仍依赖现场签字和正式环境配置。"
    },
    {
      id: "production-readiness-gate",
      name: "上线运行门禁",
      status: productionReadinessGate.overallStatus === "ready" ? "ready" : "blocked",
      evidence: `${productionReadinessGate.summary?.ready || 0}/${productionReadinessGate.summary?.total || 0} 项达到上线条件，${productionReadinessGate.summary?.blocked || 0} 项阻塞`,
      boundary: "未完成正式环境、统一身份、审计留存、生产数据库、接口签字、监控告警和灾备演练前不得生产上线。"
    },
    {
      id: "site-evidence-package",
      name: "现场验收证据包",
      status: siteEvidencePackage.items?.length >= 4 ? "ready" : "watch",
      evidence: `${siteEvidencePackage.summary?.artifacts || 0} 项材料，${siteEvidencePackage.summary?.ready || 0} 项已就绪`,
      boundary: "绑定接口报文、截图、签字单、整改、复测和上线批次材料。"
    }
  ];
  return {
    title: "卫生健康综合管理服务系统主要功能报告",
    generatedFrom: "/api/health-dashboard/summary",
    summary: {
      functions: functions.length,
      ready: functions.filter((item) => item.status === "ready").length,
      watch: functions.filter((item) => item.status === "watch").length,
      blocked: functions.filter((item) => item.status === "blocked").length
    },
    functions,
    departmentFunctionMatrix,
    cityCountyFunctionMatrix,
    releaseEvidence: [
      { id: "summary-api", name: "综合管理服务系统摘要接口", evidence: "/api/health-dashboard/summary" },
      { id: "summary-script", name: "模块摘要与功能报告", evidence: "npm.cmd run health-dashboard:summary" },
      { id: "indicator-center", name: "指标中心发布证据", evidence: "docs/health-dashboard-indicator-center-report.md" },
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
  return `${formatDashboardDate(start)} 至 ${formatDashboardDate(anchor)}`;
}

function renderDashboard(summary) {
  renderMetrics(summary);
  renderDataState(summary);
  renderPopulationServiceBoard(summary);
  renderCertificateExchange(summary.certificateExchange || {});
  renderRiskDrilldowns(summary.riskDrilldowns || {});
  renderSiteEvidencePackage(summary.siteEvidencePackage || {});
  renderSiteIssueLedger(summary.siteIssueLedger || {});
  renderProductionReadinessGate(summary.productionReadinessGate || {});
  renderIndicatorCenter(summary.indicatorCenter || {});
  renderFunctionReport(summary.functionalReport || {});
  renderJurisdictionWorkbench(summary.functionalReport || {});
  renderJurisdictionScope(summary.jurisdictionScope || {});
  renderActionClosureTrend(summary.actionClosureTrend || {});
  renderDepartmentWorkbench(summary.functionalReport || {});
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

function dashboardStatusLabel(status) {
  const key = String(status || "").toLowerCase();
  const labels = {
    ready: "已就绪",
    watch: "需关注",
    blocked: "受阻",
    empty: "暂无数据",
    "empty-ready": "待接入",
    modeled: "已建模",
    normal: "正常",
    open: "待办",
    pending: "待处理",
    linked: "已关联",
    received: "已回执",
    partial: "部分回执",
    missing: "缺少回执",
    matched: "已对账",
    "variance-review": "差异复核",
    "owner-pending": "待明确责任人",
    "due-pending": "待明确时限",
    "daily-interface": "日报接口",
    "monthly-snapshot": "月度快照",
    planned: "计划中"
  };
  return labels[key] || status || "未标注";
}

function dashboardPriorityLabel(priority) {
  const key = String(priority || "").toLowerCase();
  return { high: "高", medium: "中", normal: "一般", low: "低" }[key] || priority || "一般";
}

function dashboardInterfacePriorityLabel(priority) {
  return { P0: "一级", P1: "二级", P2: "三级" }[priority] || priority || "二级";
}

function dashboardSourceModeLabel(mode) {
  const key = String(mode || "").toLowerCase();
  return { api: "接口实时汇总", static: "静态快照", unknown: "来源未知" }[key] || mode || "来源未知";
}

function dashboardCollectionLabel(collection) {
  const labels = {
    followups: "随访任务",
    careOrders: "照护服务工单",
    medicationPickups: "取药预约",
    insuranceClaims: "医保审核",
    emergencySignals: "风险预警",
    countyCollaborationOrders: "县域协同工单",
    countyMutualRecognitionRecords: "检查检验互认",
    countyAiDiagnosisCases: "人工智能辅助诊断",
    chronicScreeningTasks: "慢病筛查任务",
    chronicEducationPushes: "健康教育推送",
    birthCertificates: "出生医学证明",
    deathCertificates: "死亡医学证明",
    platformInterfaces: "平台接口清单",
    platformEvidence: "平台验收证据",
    healthStatistics: "卫生统计",
    "healthStatistics.dailyServiceReports": "卫生统计日报",
    "healthStatistics.serviceReports": "卫生统计月报",
    "healthStatistics.siteEvidencePackage": "卫生统计现场证据包",
    "healthStatistics.certificateExchangeLinks": "卫生统计证照交换链路",
    productionDeploymentPlan: "生产部署计划",
    "release-governance": "发布治理",
    "platform-ops": "平台运维",
    "data-platform": "数据平台",
    "identity-integration": "身份集成",
    "security-admin": "安全管理员",
    database: "数据库",
    identity: "身份集成",
    security: "安全审计"
  };
  return labels[collection] || dashboardTechnicalLabel(collection);
}

function dashboardDateLabel(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function dashboardTechnicalLabel(text) {
  return String(text || "")
    .replace(/\/api\/health-dashboard\/summary/g, "综合管理服务系统摘要接口")
    .replace(/release\/health-dashboard-summary\.json/g, "综合管理服务系统摘要文件")
    .replace(/health-dashboard-about\.html/g, "系统说明页面")
    .replace(/health-dashboard-applications\.js/g, "应用清单")
    .replace(/healthDashboardSummary/g, "综合管理服务系统摘要")
    .replace(/health-dashboard:summary/g, "综合管理服务系统摘要脚本")
    .replace(/release:report/g, "发布聚合报告")
    .replace(/release-report/g, "发布聚合报告")
    .replace(/deploy:check/g, "部署门禁")
    .replace(/npm\.cmd run /g, "运行脚本：")
    .replace(/env:check:production/g, "生产环境检查")
    .replace(/Run /g, "运行")
    .replace(/site-specific \.env/g, "现场环境配置")
    .replace(/site-specific env/g, "现场环境配置")
    .replace(/before production cutover\.?/g, "后再生产切换")
    .replace(/Implement PostgreSQL adapter behind the existing storage API and rehearse migration with masked data\.?/g, "在现有存储接口后接入正式数据库适配器，并使用脱敏数据演练迁移。")
    .replace(/Map external identity claims to authUsers, authOrganizations, orgCode and role home pages\.?/g, "把外部身份字段映射到用户、机构、机构编码和角色首页。")
    .replace(/Export hash-chain audit trails to production log retention infrastructure and attach assessment evidence\.?/g, "把哈希链审计日志导出到生产日志留存设施，并补充评估证据。")
    .replace(/with /g, "包含")
    .replace(/production cutover\.?/g, "生产切换")
    .replace(/PostgreSQL/g, "正式数据库")
    .replace(/API/g, "接口")
    .replace(/source applications?/g, "源应用")
    .replace(/source records?/g, "源记录")
    .replace(/source open actions?/g, "源应用待办")
    .replace(/preview open actions?/g, "预览待办")
    .replace(/openActions/g, "待办")
    .replace(/open actions?/g, "待办")
    .replace(/high risks?/g, "高风险")
    .replace(/riskDrilldowns/g, "风险下钻")
    .replace(/certificateExchange/g, "证照交换")
    .replace(/siteEvidencePackage/g, "现场证据包")
    .replace(/dailyServiceReports/g, "日报服务量")
    .replace(/birthCertificates/g, "出生医学证明")
    .replace(/deathCertificates/g, "死亡医学证明")
    .replace(/deathStatistics/g, "死亡统计")
    .replace(/healthStatistics/g, "卫生统计")
    .replace(/hospitalInteroperabilityFunctions/g, "医院互联互通能力清单")
    .replace(/productionDeploymentPlan/g, "生产部署计划")
    .replace(/signoff/g, "签字确认")
    .replace(/drilldowns?/g, "下钻记录")
    .replace(/with trace/g, "已有轨迹")
    .replace(/periods/g, "周期")
    .replace(/insights/g, "洞察")
    .replace(/tracks/g, "链路")
    .replace(/receipts/g, "回执")
    .replace(/reconciled/g, "已对账")
    .replace(/interface tracks?/g, "接口轨道")
    .replace(/evidence records?/g, "验收证据")
    .replace(/platformInterfaces/g, "平台接口清单")
    .replace(/platformEvidence/g, "平台验收证据")
    .replace(/site dependencies/g, "现场依赖")
    .replace(/data-platform/g, "数据平台")
    .replace(/platform-ops/g, "平台运维")
    .replace(/identity-integration/g, "身份集成")
    .replace(/security-admin/g, "安全管理员")
    .replace(/database/g, "数据库")
    .replace(/identity/g, "身份集成")
    .replace(/security/g, "安全审计")
    .replace(/adapter/g, "适配器")
    .replace(/migration/g, "迁移")
    .replace(/masked data/g, "脱敏数据")
    .replace(/external/g, "外部")
    .replace(/claims/g, "身份字段")
    .replace(/authUsers/g, "用户")
    .replace(/authOrganizations/g, "机构")
    .replace(/orgCode/g, "机构编码")
    .replace(/role home pages/g, "角色首页")
    .replace(/hash-chain audit trails/g, "哈希链审计日志")
    .replace(/log retention infrastructure/g, "日志留存设施")
    .replace(/assessment evidence/g, "评估证据")
    .replace(/artifacts/g, "材料")
    .replace(/records/g, "记录")
    .replace(/functions/g, "项功能")
    .replace(/ready/g, "已就绪")
    .replace(/watch/g, "需关注")
    .replace(/blocked/g, "受阻")
    .replace(/pending/g, "待处理");
}

function renderCertificateExchange(exchange) {
  const board = document.querySelector("#certificate-exchange-board");
  const summary = document.querySelector("#certificate-exchange-summary");
  const cards = document.querySelector("#certificate-exchange-cards");
  if (!board || !summary || !cards) return;
  const items = Array.isArray(exchange.items) ? exchange.items : [];
  const counts = exchange.summary || {};
  board.dataset.exchangeStatus = exchange.status || "empty";
  summary.textContent = `${counts.tracks || items.length} 条链路 / ${counts.receipts || 0} 回执 / ${counts.correctable || 0} 支持补正 / ${counts.reconciled || 0} 已对账`;
  cards.innerHTML = items.map((item) => `<article class="certificate-exchange-card ${item.status || "watch"}" data-certificate-exchange="${item.id}">
    <span>${dashboardStatusLabel(item.status || "watch")} / ${dashboardStatusLabel(item.receiptStatus || "missing")}</span>
    <strong>${item.domain || item.id}</strong>
    <small>${dashboardTechnicalLabel(item.source || "")} 至 ${dashboardTechnicalLabel(item.target || "")}</small>
    <p>${dashboardStatusLabel(item.reconciliationStatus || "pending")} / ${dashboardStatusLabel(item.owner || "owner-pending")}</p>
    <p>${dashboardTechnicalLabel(item.nextAction || "")}</p>
  </article>`).join("") || `<article class="certificate-exchange-card empty"><strong>等待证照交换链路</strong><p>现场补齐出生、死亡、电子证照、公安、民政、疾控和统计直报回执后显示。</p></article>`;
}

function renderRiskDrilldowns(drilldowns) {
  const section = document.querySelector("#risk-drilldown-board");
  const summary = document.querySelector("#risk-drilldown-summary");
  const list = document.querySelector("#risk-drilldown-list");
  if (!section || !summary || !list) return;
  const items = Array.isArray(drilldowns.items) ? drilldowns.items : [];
  const counts = drilldowns.summary || {};
  section.dataset.drilldownStatus = drilldowns.status || "empty";
  summary.textContent = `${counts.items || items.length} 条下钻 / ${counts.high || 0} 高风险 / ${counts.withTrace || 0} 有轨迹`;
  list.innerHTML = items.map((item) => `<article class="drilldown-card ${item.priority || "normal"}" data-risk-drilldown="${item.sourceActionId || item.id}">
    <span>${dashboardPriorityLabel(item.priority || "normal")} / ${dashboardStatusLabel(item.status || "open")}</span>
    <strong>${dashboardCollectionLabel(item.title || item.id)}</strong>
    <small>${item.application || ""} / ${dashboardCollectionLabel(item.collection || "")}</small>
    <p>${dashboardStatusLabel(item.owner || "owner-pending")} / ${dashboardStatusLabel(item.dueAt || "due-pending")}</p>
    <p>${item.blocker || ""}</p>
    ${item.entry ? `<a href="./${item.entry}">源应用</a>` : ""}
  </article>`).join("") || `<article class="drilldown-card empty"><strong>等待风险下钻</strong><p>源应用产生待办后显示责任人、时限、轨迹和阻塞原因。</p></article>`;
}

function renderSiteEvidencePackage(packageData) {
  const section = document.querySelector("#site-evidence-package");
  const summary = document.querySelector("#site-evidence-summary");
  const list = document.querySelector("#site-evidence-list");
  if (!section || !summary || !list) return;
  const items = Array.isArray(packageData.items) ? packageData.items : [];
  const counts = packageData.summary || {};
  section.dataset.evidenceStatus = packageData.status || "empty";
  summary.textContent = `${counts.artifacts || items.length} 项材料 / ${counts.ready || 0} 已就绪 / ${counts.watch || 0} 需关注`;
  list.innerHTML = items.map((item) => `<article class="site-evidence-card ${item.status || "watch"}" data-site-evidence="${item.id}">
    <span>${dashboardStatusLabel(item.status || "watch")}</span>
    <strong>${item.type || item.id}</strong>
    <small>${dashboardTechnicalLabel(item.evidence || "")}</small>
    <p>${dashboardStatusLabel(item.owner || "owner-pending")}</p>
    <p>${dashboardTechnicalLabel(item.nextAction || "")}</p>
  </article>`).join("") || `<article class="site-evidence-card empty"><strong>等待现场验收证据</strong><p>接口报文、截图、签字单、整改和复测结论归档后显示。</p></article>`;
}

function renderSiteIssueLedger(ledger) {
  const section = document.querySelector("#site-issue-ledger-board");
  const controls = document.querySelector("#site-issue-ledger-status-controls");
  const ownerFilter = document.querySelector("#site-issue-owner-filter");
  const resetButton = document.querySelector("#site-issue-reset-filters");
  const summary = document.querySelector("#site-issue-ledger-summary");
  const list = document.querySelector("#site-issue-ledger-list");
  const boundary = document.querySelector("#site-issue-ledger-boundary");
  if (!section || !summary || !list) return;
  const items = Array.isArray(ledger.items) ? ledger.items : [];
  const statuses = ["all", ...Array.from(new Set(items.map((item) => item.status).filter(Boolean)))];
  const owners = Array.from(new Set(items.map((item) => item.owner).filter(Boolean)));
  if (!statuses.includes(currentSiteIssueStatus)) currentSiteIssueStatus = "all";
  if (currentSiteIssueOwner && !owners.includes(currentSiteIssueOwner)) currentSiteIssueOwner = "";
  const statusItems = currentSiteIssueStatus === "all" ? items : items.filter((item) => item.status === currentSiteIssueStatus);
  const visibleItems = currentSiteIssueOwner ? statusItems.filter((item) => item.owner === currentSiteIssueOwner) : statusItems;
  const counts = ledger.summary || {};
  section.dataset.issueStatus = ledger.status || "empty";
  section.dataset.activeStatus = currentSiteIssueStatus;
  section.dataset.activeOwner = currentSiteIssueOwner || "all";
  section.dataset.filtered = currentSiteIssueStatus !== "all" || Boolean(currentSiteIssueOwner) ? "true" : "false";
  if (controls) {
    controls.innerHTML = statuses.map((status) => `<button type="button" data-site-issue-status="${status}" class="${status === currentSiteIssueStatus ? "active" : ""}">${status === "all" ? "全部" : dashboardStatusLabel(status)}</button>`).join("");
  }
  if (ownerFilter) {
    ownerFilter.innerHTML = [`<option value="">全部责任方</option>`, ...owners.map((owner) => `<option value="${owner}">${dashboardTechnicalLabel(owner)}</option>`)].join("");
    ownerFilter.value = currentSiteIssueOwner;
  }
  if (resetButton) {
    resetButton.disabled = currentSiteIssueStatus === "all" && !currentSiteIssueOwner;
  }
  summary.textContent = `${currentSiteIssueStatus === "all" ? "全部状态" : dashboardStatusLabel(currentSiteIssueStatus)} / ${currentSiteIssueOwner || "全部责任方"} / ${counts.total || items.length} 项问题 / 当前 ${visibleItems.length} 项`;
  if (boundary) {
    boundary.textContent = "台账只用于行政管理、上线督办和验收留痕，不替代源业务系统、医疗机构或平台厂商的实际整改办理。";
  }
  list.innerHTML = visibleItems.map((item) => `<article class="site-issue-ledger-card ${item.status || "watch"}" data-site-issue="${item.id}" data-site-issue-status="${item.status || "watch"}">
    <span>${dashboardStatusLabel(item.status || "watch")}</span>
    <strong>${dashboardTechnicalLabel(item.category || item.id)}</strong>
    <small>${dashboardTechnicalLabel(item.owner || "owner-pending")} / ${dashboardTechnicalLabel(item.source || "")}</small>
    <p>${dashboardTechnicalLabel(item.nextAction || "")}</p>
    <p>${dashboardTechnicalLabel(item.boundary || "")}</p>
  </article>`).join("") || `<article class="site-issue-ledger-card empty"><strong>暂无匹配的现场整改问题</strong><p>切换其他状态查看，或等待现场联调产生新的整改记录。</p></article>`;
}

function renderIndicatorCenter(center) {
  const board = document.querySelector("#dashboard-indicator-center");
  const summary = document.querySelector("#indicator-center-summary");
  const dimensionFilter = document.querySelector("#indicator-dimension-filter");
  const statusFilter = document.querySelector("#indicator-status-filter");
  const resetButton = document.querySelector("#indicator-center-reset");
  const metrics = document.querySelector("#indicator-center-metrics");
  const categoryList = document.querySelector("#indicator-category-list");
  const entrypoints = document.querySelector("#indicator-aggregation-entrypoints");
  const list = document.querySelector("#indicator-center-list");
  const boundary = document.querySelector("#indicator-center-boundary");
  if (!board || !summary || !list) return;
  const indicators = Array.isArray(center.indicators) ? center.indicators : [];
  const dimensions = Array.isArray(center.dimensions) ? center.dimensions : [];
  const statuses = ["all", ...Array.from(new Set(indicators.map((item) => item.status).filter(Boolean)))];
  const dimensionIds = ["all", ...dimensions.map((item) => item.id)];
  if (!dimensionIds.includes(currentIndicatorDimension)) currentIndicatorDimension = "all";
  if (!statuses.includes(currentIndicatorStatus)) currentIndicatorStatus = "all";
  const visibleIndicators = indicators.filter((item) =>
    (currentIndicatorDimension === "all" || item.dimension === currentIndicatorDimension) &&
    (currentIndicatorStatus === "all" || item.status === currentIndicatorStatus)
  );
  const counts = center.summary || {};
  board.dataset.indicatorDimension = currentIndicatorDimension;
  board.dataset.indicatorStatus = currentIndicatorStatus;
  board.dataset.filtered = currentIndicatorDimension !== "all" || currentIndicatorStatus !== "all" ? "true" : "false";
  summary.textContent = `${currentIndicatorDimension === "all" ? "全部维度" : (dimensions.find((item) => item.id === currentIndicatorDimension)?.name || currentIndicatorDimension)} / ${currentIndicatorStatus === "all" ? "全部状态" : dashboardStatusLabel(currentIndicatorStatus)} / 当前 ${visibleIndicators.length} 项 / 总计 ${counts.indicators || indicators.length} 项`;
  if (dimensionFilter) {
    dimensionFilter.innerHTML = [`<option value="all">全部维度</option>`, ...dimensions.map((item) => `<option value="${item.id}">${dashboardTechnicalLabel(item.name)}（${item.indicators || 0}）</option>`)].join("");
    dimensionFilter.value = currentIndicatorDimension;
  }
  if (statusFilter) {
    statusFilter.innerHTML = statuses.map((status) => `<option value="${status}">${status === "all" ? "全部状态" : dashboardStatusLabel(status)}</option>`).join("");
    statusFilter.value = currentIndicatorStatus;
  }
  if (resetButton) {
    resetButton.disabled = currentIndicatorDimension === "all" && currentIndicatorStatus === "all";
  }
  if (metrics) {
    metrics.innerHTML = [
      { id: "indicators", label: "指标数", value: counts.indicators || indicators.length, detail: `${counts.dimensions || dimensions.length} 个维度` },
      { id: "ready", label: "已就绪", value: counts.ready || 0, detail: "可用于演示审查" },
      { id: "watch", label: "需关注", value: counts.watch || 0, detail: "等待现场补证或联调" },
      { id: "confidence", label: "平均可信度", value: `${counts.averageConfidence || 0}%`, detail: "基于来源与证据完整性" }
    ].map((item) => `<article class="metric-card" data-indicator-summary="${item.id}">
      <span>${item.label}</span>
      <strong>${item.value}</strong>
      <small>${item.detail}</small>
    </article>`).join("");
  }
  if (categoryList) {
    const categories = Array.isArray(center.reformCategories) ? center.reformCategories : [];
    categoryList.innerHTML = categories.map((item) => `<article class="indicator-category-card" data-indicator-category="${item.id}">
      <span>${dashboardTechnicalLabel(item.name || item.id)}</span>
      <strong>${item.indicators || 0} 项指标</strong>
      <small>${dashboardTechnicalLabel(item.owner || "")}</small>
      <p>${dashboardTechnicalLabel(item.target || "")}</p>
    </article>`).join("");
  }
  if (entrypoints) {
    const rows = Array.isArray(center.aggregationEntrypoints) ? center.aggregationEntrypoints : [];
    entrypoints.innerHTML = rows.map((item) => `<article class="indicator-entry-card ${item.status || "planned"}" data-indicator-entry="${item.id}">
      <span>${dashboardStatusLabel(item.status || "planned")}</span>
      <strong>${dashboardTechnicalLabel(item.name || item.id)}</strong>
      <small>${(item.modules || []).map((text) => dashboardTechnicalLabel(text)).join(" / ")}</small>
      <p>${dashboardTechnicalLabel(item.nextAction || "")}</p>
      <a class="inline-action" href="${item.href || "#dashboard-indicator-center"}">查看入口</a>
    </article>`).join("");
  }
  if (boundary) boundary.textContent = center.boundary || "指标中心只做行政管理、绩效评估和上线审查的指标汇总与下钻，不替代源系统上报。";
  list.innerHTML = visibleIndicators.map((item) => `<article class="indicator-card ${item.status || "watch"}" data-indicator="${item.id}" data-indicator-dimension="${item.dimension || ""}" data-indicator-status="${item.status || "watch"}">
    <span>${dashboardStatusLabel(item.status || "watch")} / ${dashboardTechnicalLabel(item.dimensionName || item.dimension || "")}</span>
    <strong>${dashboardTechnicalLabel(item.name || item.id)}</strong>
    <small>${dashboardTechnicalLabel(item.owner || "责任方待定")} / 可信度 ${item.confidence || 0}% / ${dashboardTechnicalLabel(item.quality || "未标注")}</small>
    <p>${dashboardTechnicalLabel(item.definition || "")}</p>
    <p><b>来源：</b>${dashboardTechnicalLabel(item.source || "")}</p>
    <p><b>当前：</b>${dashboardTechnicalLabel(item.currentValue || "")} / <b>目标：</b>${dashboardTechnicalLabel(item.targetValue || "")}</p>
    <p><b>阻塞：</b>${(item.blockers || ["暂无阻塞"]).map((text) => dashboardTechnicalLabel(text)).join("；")}</p>
    <a class="inline-action" href="${item.drilldown?.href || "#dashboard-indicator-center"}" data-indicator-drilldown="${item.id}">${dashboardTechnicalLabel(item.drilldown?.label || "查看下钻")}</a>
  </article>`).join("") || `<article class="indicator-card empty"><strong>暂无匹配指标</strong><p>切换维度或状态查看，或等待现场指标口径确认后补充。</p></article>`;
}

function renderProductionReadinessGate(gate) {
  const board = document.querySelector("#production-readiness-board");
  const summary = document.querySelector("#production-readiness-summary");
  const list = document.querySelector("#production-readiness-list");
  const routingSummary = document.querySelector("#production-acceptance-routing-summary");
  const routingList = document.querySelector("#production-acceptance-routing-list");
  const backendSummary = document.querySelector("#production-backend-go-live-summary");
  const backendControls = document.querySelector("#production-backend-go-live-status-controls");
  const backendReset = document.querySelector("#production-backend-go-live-reset");
  const backendList = document.querySelector("#production-backend-go-live-list");
  const boundary = document.querySelector("#production-readiness-boundary");
  if (!board || !summary || !list) return;
  const items = Array.isArray(gate.items) ? gate.items : [];
  const routingItems = Array.isArray(gate.acceptanceRouting) ? gate.acceptanceRouting : [];
  const backendChecklist = gate.backendGoLiveChecklist || {};
  const backendItems = Array.isArray(backendChecklist.items) ? backendChecklist.items : [];
  const backendStatuses = ["all", ...Array.from(new Set(backendItems.map((item) => item.status).filter(Boolean)))];
  if (!backendStatuses.includes(currentBackendGoLiveStatus)) currentBackendGoLiveStatus = "all";
  const visibleBackendItems = currentBackendGoLiveStatus === "all" ? backendItems : backendItems.filter((item) => item.status === currentBackendGoLiveStatus);
  const counts = gate.summary || {};
  const backendCounts = backendChecklist.summary || {};
  board.dataset.productionStatus = gate.overallStatus || "blocked";
  board.dataset.backendGoLiveStatus = backendChecklist.status || "blocked";
  board.dataset.backendGoLiveActiveStatus = currentBackendGoLiveStatus;
  board.dataset.backendGoLiveFiltered = currentBackendGoLiveStatus === "all" ? "false" : "true";
  summary.textContent = `${dashboardStatusLabel(gate.overallStatus || "blocked")} / ${counts.ready || 0} 项就绪 / ${counts.watch || 0} 项关注 / ${counts.blocked || 0} 项阻塞`;
  if (routingSummary) {
    const pending = routingItems.filter((item) => item.status !== "ready").length;
    routingSummary.textContent = `${routingItems.length} 项 P0 接收判定 / ${pending} 项仍待现场接收`;
  }
  if (backendSummary) {
    backendSummary.textContent = `${currentBackendGoLiveStatus === "all" ? "全部状态" : dashboardStatusLabel(currentBackendGoLiveStatus)} / ${backendItems.length} 项后端上线准备 / 当前 ${visibleBackendItems.length} 项 / ${backendCounts.blocked || 0} 项阻塞 / ${backendCounts.pending || 0} 项待办 / ${backendCounts.watch || 0} 项关注`;
  }
  if (backendControls) {
    backendControls.innerHTML = backendStatuses.map((status) => `<button type="button" data-production-backend-status-filter="${status}" class="${status === currentBackendGoLiveStatus ? "active" : ""}">${status === "all" ? "全部" : dashboardStatusLabel(status)}</button>`).join("");
  }
  if (backendReset) {
    backendReset.disabled = currentBackendGoLiveStatus === "all";
  }
  if (boundary) {
    boundary.textContent = gate.boundary || "上线运行标准以正式环境、统一身份、审计留存、生产数据库、接口签字、监控告警和灾备演练全部闭环为准。";
  }
  list.innerHTML = items.map((item) => `<article class="production-readiness-card ${item.status || "blocked"}" data-production-gate="${item.id}" data-production-gate-status="${item.status || "blocked"}">
    <span>${dashboardStatusLabel(item.status || "blocked")}</span>
    <strong>${dashboardTechnicalLabel(item.name || item.id)}</strong>
    <small>${dashboardTechnicalLabel(item.owner || "owner-pending")} / ${dashboardTechnicalLabel(item.evidence || "")}</small>
    <p>${dashboardTechnicalLabel(item.nextAction || "")}</p>
    <p>${dashboardTechnicalLabel(item.boundary || "")}</p>
  </article>`).join("") || `<article class="production-readiness-card empty"><strong>等待上线门禁清单</strong><p>补齐生产部署计划、现场签字、监控和灾备演练记录后显示。</p></article>`;
  if (routingList) {
    routingList.innerHTML = routingItems.map((item) => `<article class="production-readiness-card ${item.status || "pending"}" data-production-acceptance="${item.id}" data-production-acceptance-status="${item.status || "pending"}">
      <span>${dashboardStatusLabel(item.status || "pending")}</span>
      <strong>${dashboardTechnicalLabel(item.name || item.id)}</strong>
      <small>${dashboardTechnicalLabel(item.receiver || "接收岗位待定")}</small>
      <p>${dashboardTechnicalLabel(item.requiredPreparation || "")}</p>
      <p>${dashboardTechnicalLabel(item.passCondition || "")}</p>
      <p>${dashboardTechnicalLabel(item.failedAction || "")}</p>
    </article>`).join("") || `<article class="production-readiness-card empty"><strong>等待 P0 接收判定</strong><p>补齐统一身份、审计留存、生产数据库、监控灾备和接口联调接收口径后显示。</p></article>`;
  }
  if (backendList) {
    backendList.innerHTML = visibleBackendItems.map((item) => `<article class="production-readiness-card ${item.status || "pending"}" data-production-backend-go-live="${item.id}" data-production-backend-status="${item.status || "pending"}">
      <span>${dashboardStatusLabel(item.status || "pending")}</span>
      <strong>${dashboardTechnicalLabel(item.capability || item.id)}</strong>
      <small>${dashboardTechnicalLabel(item.owner || "责任方待定")}</small>
      <p>${dashboardTechnicalLabel(item.requiredPreparation || "")}</p>
      <p>${dashboardTechnicalLabel(item.evidence || "")}</p>
      <p>${dashboardTechnicalLabel(item.nextAction || "")}</p>
    </article>`).join("") || `<article class="production-readiness-card empty"><strong>暂无匹配的生产后端上线准备项</strong><p>切换其他状态查看，或等待现场补齐生产数据库、统一身份、真实接口、审计留存、监控告警、备份恢复和安全合规计划。</p></article>`;
  }
}

function renderDataState(summary) {
  const state = document.querySelector("#dashboard-api-state");
  const boundary = document.querySelector("#dashboard-data-boundary");
  if (state) {
    state.dataset.sourceMode = summary.sourceMode || "unknown";
    state.dataset.sourceReason = summary.sourceReason || "";
    state.textContent = summary.sourceMode === "api"
      ? `${summary.sourceLabel || "管理端动态汇总"} / ${dashboardDateLabel(summary.generatedAt)}`
      : `${dashboardSourceModeLabel(summary.sourceMode)} / ${summary.sourceReason || "本地数据"}`;
  }
  if (boundary) {
    boundary.textContent = summary.scope?.rule || "综合管理服务系统只汇总源应用，不替代源业务办理。";
  }
}

function renderMetrics(summary) {
  const totals = summary.totals || {};
  document.querySelector("#dashboard-metrics").innerHTML = [
    ["应用入口", totals.applications || 0, "前 7 个应用汇总"],
    ["源记录", totals.sourceRecords || 0, "来自演示数据快照与业务接口"],
    ["源待办", totals.sourceOpenActions ?? totals.openActions ?? 0, "源应用全部待闭环"],
    ["预览待办", totals.previewOpenActions ?? totals.openActions ?? 0, "驾驶舱优先展示"],
    ["高风险", totals.highRisks || 0, "状态/优先级归一化"],
    ["接口轨道", totals.interfaceTracks || 0, "平台接口清单"],
    ["验收证据", totals.evidenceRecords || 0, "平台验收证据"],
    ["现场依赖", totals.siteDependencies || 0, "生产切换签字项"],
    ["就绪状态", summary.ok ? "通过" : "待核验", dashboardDateLabel(summary.generatedAt)]
  ].map(([label, value, hint]) => `<article class="metric-card"><span>${label}</span><strong>${value}</strong><small>${hint}</small></article>`).join("");
}

function renderFunctionReport(report) {
  const summary = document.querySelector("#dashboard-function-summary");
  const list = document.querySelector("#dashboard-function-list");
  const evidence = document.querySelector("#dashboard-function-evidence");
  const rows = Array.isArray(report.functions) ? report.functions : [];
  const evidenceRows = Array.isArray(report.releaseEvidence) ? report.releaseEvidence : [];
  if (summary) {
    summary.textContent = `${report.summary?.functions || rows.length} 项功能 / ${report.summary?.ready || 0} 已就绪 / ${report.summary?.watch || 0} 需关注`;
  }
  if (list) {
    list.innerHTML = rows.map((item) => `<article class="function-report-card ${item.status || "normal"}" data-function-report="${item.id}">
      <span>${dashboardStatusLabel(item.status || "ready")}</span>
      <strong>${item.name || item.id}</strong>
      <small>${dashboardTechnicalLabel(item.evidence || "")}</small>
      <p>${item.boundary || ""}</p>
    </article>`).join("") || `<article class="function-report-card empty"><strong>等待功能报告</strong><p>摘要接口返回后生成本模块主要功能报告。</p></article>`;
  }
  if (evidence) {
    evidence.innerHTML = evidenceRows.map((item) => `<span data-function-evidence="${item.id}">${item.name || item.id}：${dashboardTechnicalLabel(item.evidence || "")}</span>`).join("");
  }
}

function bindJurisdictionLevel() {
  const controls = document.querySelector("#jurisdiction-level-controls");
  if (!controls || controls.dataset.bound === "true") return;
  controls.dataset.bound = "true";
  controls.addEventListener("click", (event) => {
    const button = event.target.closest("[data-jurisdiction-level]");
    if (!button) return;
    currentJurisdictionLevel = button.dataset.jurisdictionLevel || "all";
    if (currentDashboardSummary) renderJurisdictionWorkbench(currentDashboardSummary.functionalReport || {});
  });
}

function bindJurisdictionScopeFilters() {
  ["#jurisdiction-district-filter", "#jurisdiction-type-filter"].forEach((selector) => {
    const control = document.querySelector(selector);
    if (!control || control.dataset.bound === "true") return;
    control.dataset.bound = "true";
    control.addEventListener("change", () => {
      currentJurisdictionDistrict = document.querySelector("#jurisdiction-district-filter")?.value || "";
      currentJurisdictionType = document.querySelector("#jurisdiction-type-filter")?.value || "";
      currentJurisdictionDetail = "";
      if (currentDashboardSummary) renderJurisdictionScope(currentDashboardSummary.jurisdictionScope || {});
    });
  });
  const grid = document.querySelector("#jurisdiction-scope-grid");
  if (grid && grid.dataset.bound !== "true") {
    grid.dataset.bound = "true";
    grid.addEventListener("click", (event) => {
      const card = event.target.closest("[data-jurisdiction-scope]");
      if (!card) return;
      currentJurisdictionDetail = card.dataset.jurisdictionScope || "";
      if (currentDashboardSummary) renderJurisdictionScope(currentDashboardSummary.jurisdictionScope || {});
    });
    grid.addEventListener("keydown", (event) => {
      if (!["Enter", " "].includes(event.key)) return;
      const card = event.target.closest("[data-jurisdiction-scope]");
      if (!card) return;
      event.preventDefault();
      currentJurisdictionDetail = card.dataset.jurisdictionScope || "";
      if (currentDashboardSummary) renderJurisdictionScope(currentDashboardSummary.jurisdictionScope || {});
    });
  }
}

function renderJurisdictionWorkbench(report) {
  const board = document.querySelector("#dashboard-jurisdiction-board");
  const controls = document.querySelector("#jurisdiction-level-controls");
  const summary = document.querySelector("#jurisdiction-board-summary");
  const matrix = document.querySelector("#jurisdiction-matrix");
  const boundary = document.querySelector("#jurisdiction-boundary");
  if (!board || !controls || !matrix) return;
  const rows = Array.isArray(report.cityCountyFunctionMatrix) ? report.cityCountyFunctionMatrix : [];
  const levels = ["all", ...Array.from(new Set(rows.map((item) => item.level).filter(Boolean)))];
  if (!levels.includes(currentJurisdictionLevel)) currentJurisdictionLevel = "all";
  const filteredRows = currentJurisdictionLevel === "all" ? rows : rows.filter((item) => item.level === currentJurisdictionLevel);
  board.dataset.activeLevel = currentJurisdictionLevel;
  controls.innerHTML = levels.map((level) => `<button type="button" data-jurisdiction-level="${level}" class="${level === currentJurisdictionLevel ? "active" : ""}">${level === "all" ? "全部" : level}</button>`).join("");
  if (summary) {
    const cityRows = rows.filter((item) => item.level === "市级").length;
    const countyRows = rows.filter((item) => item.level === "县级").length;
    summary.textContent = `${currentJurisdictionLevel === "all" ? "全部层级" : currentJurisdictionLevel} / 市级 ${cityRows} 项 / 县级 ${countyRows} 项 / 当前 ${filteredRows.length} 项`;
  }
  matrix.innerHTML = filteredRows.map((item) => `<article class="jurisdiction-card ${item.status || "watch"}" data-jurisdiction-row="${item.id}" data-jurisdiction-level="${item.level || ""}">
    <span>${item.level || "未标注"} / ${dashboardStatusLabel(item.status || "watch")}</span>
    <strong>${item.agency || item.id}</strong>
    <ul>${(item.implemented || []).map((text) => `<li>${dashboardTechnicalLabel(text)}</li>`).join("")}</ul>
    <p>${item.nextPlan || ""}</p>
    <small>${dashboardTechnicalLabel(item.evidence || "")}</small>
  </article>`).join("") || `<article class="jurisdiction-card empty"><strong>等待行政层级矩阵</strong><p>摘要接口返回市、县两级卫生健康行政部门职责后显示。</p></article>`;
  if (boundary) {
    boundary.textContent = "本工作台仅呈现卫生健康行政部门监管、督办、审计和联调视角；医疗机构、专业中心、平台中心和基层服务机构不在本系统承接非本机关办理职责。";
  }
}

function renderJurisdictionScope(scope) {
  const districtFilter = document.querySelector("#jurisdiction-district-filter");
  const typeFilter = document.querySelector("#jurisdiction-type-filter");
  const summary = document.querySelector("#jurisdiction-scope-summary");
  const grid = document.querySelector("#jurisdiction-scope-grid");
  const detail = document.querySelector("#jurisdiction-detail-panel");
  if (!districtFilter || !typeFilter || !grid) return;
  const districts = Array.isArray(scope.districts) ? scope.districts : [];
  const districtOptions = Array.isArray(scope.districtOptions) ? scope.districtOptions : [];
  const typeOptions = Array.isArray(scope.institutionTypeOptions) ? scope.institutionTypeOptions : [];
  if (!districtFilter.dataset.ready) {
    districtFilter.innerHTML = [`<option value="">全部辖区</option>`, ...districtOptions.map((item) => `<option value="${item}">${item}</option>`)].join("");
    districtFilter.dataset.ready = "1";
  }
  if (!typeFilter.dataset.ready) {
    typeFilter.innerHTML = [`<option value="">全部机构类型</option>`, ...typeOptions.map((item) => `<option value="${item}">${item}</option>`)].join("");
    typeFilter.dataset.ready = "1";
  }
  const selectedDistrict = currentJurisdictionDistrict || districtFilter.value || "";
  const selectedType = currentJurisdictionType || typeFilter.value || "";
  const selectedRows = districts.filter((item) =>
    (!selectedDistrict ? item.id === "all" || item.district !== "全市" : item.district === selectedDistrict) &&
    (!selectedType || (item.institutionTypes || []).some((type) => type.type === selectedType))
  );
  const rows = selectedDistrict ? selectedRows : selectedRows.filter((item) => item.id !== "all");
  const visibleRows = rows.length ? rows : districts.filter((item) => item.id === "all");
  const totals = visibleRows.reduce((sum, item) => ({
    districts: sum.districts + (item.id === "all" ? 0 : 1),
    institutions: sum.institutions + Number(item.institutions || 0),
    openActions: sum.openActions + Number(item.openActions || 0),
    highRisks: sum.highRisks + Number(item.highRisks || 0)
  }), { districts: 0, institutions: 0, openActions: 0, highRisks: 0 });
  if (summary) {
    summary.textContent = `${selectedDistrict || "全部辖区"} / ${selectedType || "全部机构类型"} / ${totals.institutions} 个机构 / ${totals.openActions} 条待办 / ${totals.highRisks} 条高风险`;
  }
  if (!currentJurisdictionDetail || !visibleRows.some((item) => item.id === currentJurisdictionDetail)) {
    currentJurisdictionDetail = visibleRows.find((item) => item.id !== "all")?.id || visibleRows[0]?.id || "";
  }
  grid.innerHTML = visibleRows.map((item) => `<article class="jurisdiction-scope-card ${item.status || "watch"} ${item.id === currentJurisdictionDetail ? "active" : ""}" data-jurisdiction-scope="${item.id}" role="button" tabindex="0" aria-pressed="${item.id === currentJurisdictionDetail ? "true" : "false"}">
    <span>${dashboardStatusLabel(item.status || "watch")} / ${item.district}</span>
    <strong>${item.institutions || 0} 个机构 · ${item.openActions || 0} 条待办</strong>
    <small>${(item.institutionTypes || []).map((type) => `${type.type}${type.count}`).join(" / ") || "等待机构目录"}</small>
    <p>床位 ${formatDashboardNumber(item.beds || 0)} / 医师 ${formatDashboardNumber(item.doctors || 0)} / 日报 ${formatDashboardNumber(item.serviceReports || 0)} 条</p>
    <p>就诊 ${formatDashboardNumber(item.visits || 0)} 人次 / 入院 ${formatDashboardNumber(item.admissions || 0)} 人次 / 高风险 ${formatDashboardNumber(item.highRisks || 0)} 条</p>
    <small>${item.nextAction || ""}</small>
  </article>`).join("") || `<article class="jurisdiction-scope-card empty"><strong>等待辖区数据</strong><p>接入机构目录、日报和源应用待办后显示。</p></article>`;
  if (detail) renderJurisdictionDetail(detail, visibleRows.find((item) => item.id === currentJurisdictionDetail), selectedType);
}

function renderJurisdictionDetail(container, row, selectedType) {
  if (!row) {
    container.innerHTML = `<article class="jurisdiction-detail-card empty"><strong>等待区县详情</strong><p>选择辖区卡片后显示监管明细。</p></article>`;
    return;
  }
  const institutions = selectedType ? (row.institutionsList || []).filter((item) => item.type === selectedType) : (row.institutionsList || []);
  const serviceReports = row.serviceReportList || [];
  const actions = row.actionList || [];
  const institutionRows = institutions.slice(0, 5).map((item) => `<li><strong>${item.name}</strong><span>${item.type} / 床位 ${formatDashboardNumber(item.beds)} / 医师 ${formatDashboardNumber(item.doctors)}</span></li>`).join("");
  const serviceRows = serviceReports.slice(0, 4).map((item) => `<li><strong>${item.reportDate || "未标注日期"}</strong><span>${item.institution} / 就诊 ${formatDashboardNumber(item.visits)} / 入院 ${formatDashboardNumber(item.admissions)} / ${dashboardStatusLabel(item.status)}</span></li>`).join("");
  const actionRows = actions.slice(0, 5).map((item) => `<li><strong>${item.title}</strong><span>${item.application} / ${dashboardStatusLabel(item.priority)} / ${item.owner} / ${item.status}</span></li>`).join("");
  container.innerHTML = `<article class="jurisdiction-detail-card ${row.status || "watch"}">
    <div>
      <span>${row.district}监管详情</span>
      <strong>${selectedType || "全部机构类型"} / ${formatDashboardNumber(institutions.length)} 个机构 / ${formatDashboardNumber(row.openActions || 0)} 条待办</strong>
      <p>仅展示卫生健康行政监管、接口联调和验收证据视角；具体业务办理继续回到对应源应用或属地系统。</p>
    </div>
    <div class="jurisdiction-detail-metrics">
      <span>床位 <strong>${formatDashboardNumber(row.beds || 0)}</strong></span>
      <span>医师 <strong>${formatDashboardNumber(row.doctors || 0)}</strong></span>
      <span>就诊 <strong>${formatDashboardNumber(row.visits || 0)}</strong></span>
      <span>入院 <strong>${formatDashboardNumber(row.admissions || 0)}</strong></span>
      <span>高风险 <strong>${formatDashboardNumber(row.highRisks || 0)}</strong></span>
    </div>
    <div class="jurisdiction-detail-columns">
      <section><h4>机构目录</h4><ul>${institutionRows || "<li><span>等待机构目录接入</span></li>"}</ul></section>
      <section><h4>日报服务量</h4><ul>${serviceRows || "<li><span>等待日报接口接入</span></li>"}</ul></section>
      <section><h4>源应用待办</h4><ul>${actionRows || "<li><span>暂无源应用待办</span></li>"}</ul></section>
    </div>
    <small>${row.nextAction || ""}</small>
  </article>`;
}

function renderActionClosureTrend(trend) {
  const section = document.querySelector("#action-closure-trend-board");
  const summary = document.querySelector("#action-trend-summary");
  const cards = document.querySelector("#action-trend-cards");
  const periods = document.querySelector("#action-trend-periods");
  const apps = document.querySelector("#action-trend-apps");
  const boundary = document.querySelector("#action-trend-boundary");
  if (!section || !cards || !periods || !apps) return;
  const totals = trend.summary || {};
  const periodRows = Array.isArray(trend.periods) ? trend.periods : [];
  const appRows = Array.isArray(trend.applications) ? trend.applications : [];
  section.dataset.trendStatus = trend.status || "empty";
  if (summary) {
    summary.textContent = `${totals.total || 0} 条任务 / 闭环率 ${totals.closureRate || 0}% / 超期率 ${totals.overdueRate || 0}% / ${totals.overdue || 0} 条超期`;
  }
  cards.innerHTML = [
    ["任务总量", totals.total || 0, "源应用任务全集"],
    ["已闭环", totals.closed || 0, `${totals.closureRate || 0}% 闭环率`],
    ["待闭环", totals.open || 0, `${totals.previewOpenActions || 0} 条进入驾驶舱预览`],
    ["超期任务", totals.overdue || 0, `${totals.overdueRate || 0}% 超期率`]
  ].map(([label, value, detail]) => `<article class="action-trend-card">
    <span>${label}</span>
    <strong>${formatDashboardNumber(value)}</strong>
    <small>${detail}</small>
  </article>`).join("");
  periods.innerHTML = periodRows.map((item) => `<article class="action-trend-period" data-action-period="${item.id}">
    <div>
      <strong>${item.label}</strong>
      <span>${item.rangeLabel || ""}</span>
    </div>
    <div class="trend-bar-row">
      <span>闭环 ${item.closureRate || 0}%</span>
      <div class="trend-bar"><i style="width:${Math.min(100, item.closureRate || 0)}%"></i></div>
    </div>
    <div class="trend-bar-row overdue">
      <span>超期 ${item.overdueRate || 0}%</span>
      <div class="trend-bar"><i style="width:${Math.min(100, item.overdueRate || 0)}%"></i></div>
    </div>
    <small>${item.total || 0} 条 / 已闭环 ${item.closed || 0} / 超期 ${item.overdue || 0}</small>
  </article>`).join("") || `<article class="action-trend-period empty"><strong>等待周期数据</strong><span>源应用补齐任务日期后显示趋势。</span></article>`;
  apps.innerHTML = appRows.slice(0, 6).map((item) => `<article class="action-trend-app" data-action-app="${item.id}">
    <span>${item.application || item.id}</span>
    <strong>${item.open || 0} 待闭环 / ${item.overdue || 0} 超期</strong>
    <small>闭环率 ${item.closureRate || 0}% / 超期率 ${item.overdueRate || 0}% / 高风险 ${item.highRisks || 0}</small>
  </article>`).join("") || `<article class="action-trend-app empty"><strong>等待源应用任务</strong><small>接入随访、转诊、慢病筛查、医共体协同等任务后显示。</small></article>`;
  if (boundary) boundary.textContent = trend.boundary || "本趋势仅用于卫生健康行政部门监管、督办和调度分析，具体办理仍回到源应用。";
}

function bindDepartmentStatus() {
  const controls = document.querySelector("#department-status-controls");
  if (!controls || controls.dataset.bound === "true") return;
  controls.dataset.bound = "true";
  controls.addEventListener("click", (event) => {
    const button = event.target.closest("[data-department-status]");
    if (!button) return;
    currentDepartmentStatus = button.dataset.departmentStatus || "all";
    if (currentDashboardSummary) renderDepartmentWorkbench(currentDashboardSummary.functionalReport || {});
  });
}

function bindSiteIssueStatus() {
  const controls = document.querySelector("#site-issue-ledger-status-controls");
  if (!controls || controls.dataset.bound === "true") return;
  controls.dataset.bound = "true";
  controls.addEventListener("click", (event) => {
    const button = event.target.closest("[data-site-issue-status]");
    if (!button) return;
    currentSiteIssueStatus = button.dataset.siteIssueStatus || "all";
    if (currentDashboardSummary) renderSiteIssueLedger(currentDashboardSummary.siteIssueLedger || {});
  });
}

function bindSiteIssueOwner() {
  const control = document.querySelector("#site-issue-owner-filter");
  if (!control || control.dataset.bound === "true") return;
  control.dataset.bound = "true";
  control.addEventListener("change", () => {
    currentSiteIssueOwner = control.value || "";
    if (currentDashboardSummary) renderSiteIssueLedger(currentDashboardSummary.siteIssueLedger || {});
  });
}

function bindSiteIssueReset() {
  const button = document.querySelector("#site-issue-reset-filters");
  if (!button || button.dataset.bound === "true") return;
  button.dataset.bound = "true";
  button.addEventListener("click", () => {
    currentSiteIssueStatus = "all";
    currentSiteIssueOwner = "";
    if (currentDashboardSummary) renderSiteIssueLedger(currentDashboardSummary.siteIssueLedger || {});
  });
}

function bindBackendGoLiveStatus() {
  const controls = document.querySelector("#production-backend-go-live-status-controls");
  if (!controls || controls.dataset.bound === "true") return;
  controls.dataset.bound = "true";
  controls.addEventListener("click", (event) => {
    const button = event.target.closest("[data-production-backend-status-filter]");
    if (!button) return;
    currentBackendGoLiveStatus = button.dataset.productionBackendStatusFilter || "all";
    if (currentDashboardSummary) renderProductionReadinessGate(currentDashboardSummary.productionReadinessGate || {});
  });
}

function bindBackendGoLiveReset() {
  const button = document.querySelector("#production-backend-go-live-reset");
  if (!button || button.dataset.bound === "true") return;
  button.dataset.bound = "true";
  button.addEventListener("click", () => {
    currentBackendGoLiveStatus = "all";
    if (currentDashboardSummary) renderProductionReadinessGate(currentDashboardSummary.productionReadinessGate || {});
  });
}

function bindIndicatorCenterFilters() {
  ["#indicator-dimension-filter", "#indicator-status-filter"].forEach((selector) => {
    const control = document.querySelector(selector);
    if (!control || control.dataset.bound === "true") return;
    control.dataset.bound = "true";
    control.addEventListener("change", () => {
      currentIndicatorDimension = document.querySelector("#indicator-dimension-filter")?.value || "all";
      currentIndicatorStatus = document.querySelector("#indicator-status-filter")?.value || "all";
      if (currentDashboardSummary) renderIndicatorCenter(currentDashboardSummary.indicatorCenter || {});
    });
  });
}

function bindIndicatorCenterReset() {
  const button = document.querySelector("#indicator-center-reset");
  if (!button || button.dataset.bound === "true") return;
  button.dataset.bound = "true";
  button.addEventListener("click", () => {
    currentIndicatorDimension = "all";
    currentIndicatorStatus = "all";
    if (currentDashboardSummary) renderIndicatorCenter(currentDashboardSummary.indicatorCenter || {});
  });
}

function renderDepartmentWorkbench(report) {
  const board = document.querySelector("#dashboard-department-board");
  const controls = document.querySelector("#department-status-controls");
  const summary = document.querySelector("#department-board-summary");
  const matrix = document.querySelector("#department-function-matrix");
  const boundary = document.querySelector("#department-boundary");
  if (!board || !controls || !matrix) return;
  const rows = Array.isArray(report.departmentFunctionMatrix) ? report.departmentFunctionMatrix : [];
  const statuses = ["all", ...Array.from(new Set(rows.map((item) => item.status).filter(Boolean)))];
  if (!statuses.includes(currentDepartmentStatus)) currentDepartmentStatus = "all";
  const filteredRows = currentDepartmentStatus === "all" ? rows : rows.filter((item) => item.status === currentDepartmentStatus);
  board.dataset.activeStatus = currentDepartmentStatus;
  controls.innerHTML = statuses.map((status) => `<button type="button" data-department-status="${status}" class="${status === currentDepartmentStatus ? "active" : ""}">${status === "all" ? "全部" : dashboardStatusLabel(status)}</button>`).join("");
  if (summary) {
    const readyRows = rows.filter((item) => item.status === "ready").length;
    const watchRows = rows.filter((item) => item.status === "watch").length;
    summary.textContent = `${currentDepartmentStatus === "all" ? "全部状态" : dashboardStatusLabel(currentDepartmentStatus)} / 已就绪 ${readyRows} 项 / 需关注 ${watchRows} 项 / 当前 ${filteredRows.length} 项`;
  }
  matrix.innerHTML = filteredRows.map((item) => `<article class="department-card ${item.status || "watch"}" data-department-row="${item.id}" data-department-status="${item.status || ""}">
    <span>${item.name || item.id} / ${dashboardStatusLabel(item.status || "watch")}</span>
    <strong>${item.level || "内部机构"}</strong>
    <ul>${(item.implemented || []).map((text) => `<li>${dashboardTechnicalLabel(text)}</li>`).join("")}</ul>
    <p>${item.nextPlan || ""}</p>
    <small>${dashboardTechnicalLabel(item.evidence || "")}</small>
  </article>`).join("") || `<article class="department-card empty"><strong>等待内设机构职能台账</strong><p>摘要接口返回委机关内设机构职责后显示。</p></article>`;
  if (boundary) {
    boundary.textContent = "本台账只呈现卫生健康行政部门内部处室的监管、督办、审计和联调事项；源业务办理仍由对应业务系统或责任单位完成。";
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
  const sourceDetails = document.querySelector("#population-source-details");
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
    if (sourceDetails) sourceDetails.innerHTML = "";
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
  if (sourceDetails) {
    const details = Array.isArray(board.sourceDetails) ? board.sourceDetails : metrics.map((metric) => ({
      id: metric.id,
      label: metric.label,
      field: metric.source || "",
      source: metric.sourceLabel || "",
      mode: "接口字段",
      status: "watch",
      records: 0
    }));
    sourceDetails.innerHTML = details.map((item) => `<article class="population-source-card ${item.status || "watch"}" data-population-source="${item.id}">
      <span>${dashboardStatusLabel(item.status || "watch")} / ${item.mode || ""}</span>
      <strong>${item.label || item.id}</strong>
      <small>${dashboardTechnicalLabel(item.field || "")}</small>
      <p>${item.source || ""} / ${formatDashboardNumber(item.records || 0)} 条记录</p>
    </article>`).join("");
  }
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
    <thead><tr><th>应用</th><th>入口</th><th>源记录</th><th>待办</th><th>高风险</th><th>状态</th></tr></thead>
    <tbody>${applications.map((item) => `<tr>
      <td>${item.name}</td>
      <td><a href="./${item.entry}">进入应用</a></td>
      <td>${item.records}</td>
      <td>${item.openActions}</td>
      <td>${item.highRisks}</td>
      <td><span class="badge ${item.status === "modeled" ? "info" : "warn"}">${dashboardStatusLabel(item.status)}</span></td>
    </tr>`).join("")}</tbody>
  </table>`;
}

function renderRisks(risks) {
  document.querySelector("#dashboard-risks").innerHTML = risks.map((item) => `<div>
    <strong>${item.application}</strong>
    <span>${item.highRisks} 高风险 / ${item.openActions} 待办</span>
    <small>${dashboardTechnicalLabel(item.nextAction)}</small>
  </div>`).join("") || `<div><strong>暂无高风险汇总</strong><span>等待源应用产生风险或现场联调数据。</span></div>`;
}

function renderActions(actions) {
  document.querySelector("#dashboard-actions").innerHTML = actions.map((item, index) => `<article class="priority-row">
    <div class="priority-rank ${item.priority === "high" ? "danger" : item.priority === "medium" ? "warn" : "info"}">${index + 1}</div>
    <div>
      <h3>${dashboardCollectionLabel(item.title || item.id)}</h3>
      <p>${item.application || dashboardCollectionLabel(item.collection)} / ${dashboardCollectionLabel(item.collection)} / ${dashboardStatusLabel(item.status)}</p>
    </div>
    <div class="capability-side">
      <span class="badge ${item.priority === "high" ? "danger" : item.priority === "medium" ? "warn" : "info"}">${dashboardPriorityLabel(item.priority)}</span>
      ${item.entry ? `<a href="./${item.entry}">源应用</a>` : ""}
      <small>${dashboardStatusLabel(item.owner || "owner-pending")}</small>
    </div>
  </article>`).join("") || `<article class="priority-row"><div class="priority-rank info">0</div><div><h3>暂无跨应用待办</h3><p>源应用待办完成后这里会归零。</p></div></article>`;
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
  const resetButton = document.querySelector("#dashboard-reset-filters");
  if (resetButton && resetButton.dataset.bound !== "true") {
    resetButton.dataset.bound = "true";
    resetButton.addEventListener("click", () => {
      const appFilter = document.querySelector("#dashboard-application-filter");
      const priorityFilter = document.querySelector("#dashboard-priority-filter");
      if (appFilter) appFilter.value = "";
      if (priorityFilter) priorityFilter.value = "";
      if (currentDashboardSummary) renderDashboard(currentDashboardSummary);
    });
  }
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
  const summaryNode = document.querySelector("#dashboard-filter-summary");
  if (!summaryNode) return;
  summaryNode.textContent = [
    app?.name || "全部应用",
    filters.priority ? dashboardPriorityLabel(filters.priority) : "全部优先级",
    `${count} 条待办`
  ].join(" / ");
  summaryNode.dataset.filtered = filters.applicationId || filters.priority ? "true" : "false";
}

function renderDependencies(items) {
  document.querySelector("#dashboard-dependencies").innerHTML = items.map((item) => `<div>
    <strong>${dashboardCollectionLabel(item.track || item.id)}</strong>
    <span>${dashboardStatusLabel(item.status || "pending")} / ${dashboardCollectionLabel(item.owner || "owner-pending")}</span>
    <small>${dashboardTechnicalLabel(item.nextAction || "")}</small>
  </div>`).join("") || `<div><strong>暂无现场依赖</strong><span>生产签字项尚未进入快照。</span></div>`;
}

function renderInterfaces(items) {
  document.querySelector("#dashboard-interfaces").innerHTML = items.slice(0, 8).map((item) => `<div>
    <strong>${item.domain || item.id}</strong>
    <span>${dashboardInterfacePriorityLabel(item.priority)} / ${dashboardStatusLabel(item.status || "pending")}</span>
    <small>${item.nextAction || ""}</small>
  </div>`).join("") || `<div><strong>暂无接口轨道</strong><span>等待平台接口清单数据。</span></div>`;
}

function renderEvidence(items) {
  document.querySelector("#dashboard-evidence").innerHTML = items.slice(0, 8).map((item) => `<div>
    <strong>${item.name || item.id}</strong>
    <span>${dashboardStatusLabel(item.status || "pending")} / ${item.records || 0} 条记录</span>
    <small>${item.owner || ""}</small>
  </div>`).join("") || `<div><strong>暂无验收证据</strong><span>等待平台证据归档。</span></div>`;
}

function collectStaticOpenActions(state, applications) {
  return collectStaticTaskActions(state, applications).filter((item) => !item.closed).slice(0, 12);
}

function collectStaticTaskActions(state, applications) {
  const appByCollection = Object.fromEntries(applications.flatMap((app) =>
    app.collections.map((item) => [item.collection, app])
  ));
  return DASHBOARD_TASK_COLLECTIONS
    .flatMap((collection) => {
      const app = appByCollection[collection] || applications[0];
      return (Array.isArray(state[collection]) ? state[collection] : []).map((item) => {
        const status = item.status || item.reviewStatus || item.authorizationStatus || item.state || "";
        const dueAt = item.dueAt || item.due || item.nextReview || item.plannedAt || item.requestedAt || item.lastUpdated || item.createdAt || "";
        const closed = isClosedDashboardStatus(status);
        return {
        id: item.id || `${collection}-task`,
        collection,
        applicationId: app.id,
        application: app.name,
        entry: app.entry,
        title: item.title || item.taskName || item.topic || item.orderType || item.item || item.claimType || item.medication || item.name || collection,
        owner: item.owner || item.assignee || item.institution || item.center || item.sourceInstitution || item.targetInstitution || "owner-pending",
        status: status || "open",
        region: item.region || item.district || item.area || "",
        priority: dashboardPriority(item),
        dueAt,
        updatedAt: item.updatedAt || item.lastUpdated || item.createdAt || item.reportDate || dueAt,
        closed,
        overdue: !closed && isDashboardOverdue(dueAt, item)
      };
      });
    });
}

function isClosedDashboardStatus(status) {
  return /closed|resolved|approved|recognized|completed|passed|ready|signed|done|已完成|已通过|已闭环/.test(String(status || ""));
}

function isDashboardOverdue(dueAt, item = {}) {
  const text = [item.status, item.priority, item.level, item.risk, item.riskLevel].filter(Boolean).join(" ");
  if (/overdue|逾期|超期|已逾期/i.test(text)) return true;
  const dueDate = parseDashboardDate(dueAt);
  if (!dueDate) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return dueDate < today;
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
