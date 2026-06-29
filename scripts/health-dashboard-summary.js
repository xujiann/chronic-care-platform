#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "health-dashboard-summary.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "health-dashboard-summary.md");

const APPLICATIONS = require("../health-dashboard-applications");

const CLOSED_STATUS_PATTERN = /closed|resolved|approved|recognized|completed|passed|ready|signed|done|宸插畬鎴|宸查€氳繃|宸插彇鑽|宸插洖浼|宸蹭簰璁|宸叉牳楠|宸查棴鐜|已完成|已通过|已闭环/;
const HIGH_RISK_PATTERN = /high|urgent|critical|overdue|dead_letter|楂|绱|閫炬湡|critical|高|逾期|危急/;

const APPLICATION_BY_COLLECTION = Object.fromEntries(
  APPLICATIONS.flatMap((app) => app.collections.map((collection) => [collection, app]))
);

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function rows(data, collection) {
  if (collection === "authorizations") {
    return Array.isArray(data.personalRecords)
      ? data.personalRecords.filter((item) => item.category === "authorizations" || item.type === "authorization")
      : [];
  }
  const value = data[collection];
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    return Object.values(value).flatMap((item) => Array.isArray(item) ? item : []);
  }
  return [];
}

function statusOf(item) {
  return String(item.status || item.reviewStatus || item.authorizationStatus || item.state || "").trim();
}

function isOpen(item) {
  const status = statusOf(item);
  return !status || !CLOSED_STATUS_PATTERN.test(status);
}

function riskLevel(item) {
  const text = [item.priority, item.level, item.risk, item.riskLevel, item.status, item.deadLetter ? "dead_letter" : ""].filter(Boolean).join(" ");
  if (HIGH_RISK_PATTERN.test(text)) return "high";
  if (/medium|warning|涓|寰|待|warn/i.test(text)) return "medium";
  return "normal";
}

function summarizeApplication(data, app) {
  const collectionRows = app.collections.map((collection) => ({ collection, rows: rows(data, collection) }));
  const allRows = collectionRows.flatMap((item) => item.rows.map((row) => ({ ...row, collection: item.collection })));
  const openRows = allRows.filter(isOpen);
  const highRiskRows = allRows.filter((item) => riskLevel(item) === "high");
  const evidenceRows = rows(data, "platformEvidence").flatMap((item) => item.records || []);
  const relatedEvidence = evidenceRows.filter((item) => {
    const text = JSON.stringify(item);
    return app.collections.some((collection) => text.includes(collection)) || text.includes(app.entry) || text.includes(app.id);
  });
  return {
    id: app.id,
    name: app.name,
    entry: app.entry,
    owner: app.owner,
    collections: collectionRows.map((item) => ({ collection: item.collection, records: item.rows.length })),
    records: allRows.length,
    openActions: openRows.length,
    highRisks: highRiskRows.length,
    evidenceRecords: relatedEvidence.length,
    status: allRows.length ? "modeled" : "empty-ready",
    boundary: "Aggregated in the dashboard; detailed workflow remains in the source application."
  };
}

function collectOpenActions(data, limit = 12) {
  const taskCollections = [
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
  return taskCollections.flatMap((collection) => rows(data, collection).filter(isOpen).map((item) => {
    const app = APPLICATION_BY_COLLECTION[collection] || APPLICATIONS[0];
    return {
      id: item.id || `${collection}-${item.residentId || item.status || "open"}`,
      collection,
      applicationId: app.id,
      application: app.name,
      entry: app.entry,
      title: item.title || item.taskName || item.topic || item.orderType || item.item || item.claimType || item.medication || item.name || collection,
      owner: item.owner || item.assignee || item.institution || item.center || item.sourceInstitution || item.targetInstitution || "owner-pending",
      status: statusOf(item) || "open",
      priority: riskLevel(item),
      dueAt: item.dueAt || item.due || item.nextReview || item.plannedAt || item.requestedAt || item.lastUpdated || ""
    };
  })).sort((left, right) =>
    ({ high: 3, medium: 2, normal: 1 }[right.priority] || 0) - ({ high: 3, medium: 2, normal: 1 }[left.priority] || 0) ||
    String(left.dueAt || "").localeCompare(String(right.dueAt || ""))
  ).slice(0, limit);
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(String(value).replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(date) {
  if (!date) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function daysInMonthFromPeriod(period, fallbackDate) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(period || ""));
  if (match) return new Date(Number(match[1]), Number(match[2]), 0).getDate();
  const date = fallbackDate || new Date();
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function latestAvailableDate(...values) {
  return values
    .flat()
    .map(parseDate)
    .filter(Boolean)
    .sort((left, right) => right.getTime() - left.getTime())[0] || null;
}

function countInWindow(items, field, anchor, periodId) {
  if (!anchor) return 0;
  const start = new Date(anchor);
  const end = new Date(anchor);
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  if (periodId === "week") start.setDate(start.getDate() - 6);
  if (periodId === "month") start.setDate(1);
  if (periodId === "year") start.setMonth(0, 1);
  return items.filter((item) => {
    const date = parseDate(item[field]);
    return date && date >= start && date <= end;
  }).length;
}

function serviceReportDate(item) {
  return parseDate(item.reportDate || item.date || item.serviceDate || item.createdAt);
}

function sumDailyServiceWindow(reports, anchor, periodId, metricId) {
  if (!anchor) return 0;
  const start = new Date(anchor);
  const end = new Date(anchor);
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  if (periodId === "week") start.setDate(start.getDate() - 6);
  if (periodId === "month") start.setDate(1);
  if (periodId === "year") start.setMonth(0, 1);
  return reports.reduce((sum, item) => {
    const date = serviceReportDate(item);
    if (!date || date < start || date > end) return sum;
    const interfaceData = item.interfaceData || {};
    if (metricId === "visits") return sum + Number(interfaceData.outpatientVisits || 0) + Number(interfaceData.emergencyVisits || 0);
    if (metricId === "admissions") return sum + Number(interfaceData.inpatientAdmissions || 0);
    return sum;
  }, 0);
}

function periodRangeLabel(anchor, periodId) {
  if (!anchor) return "No dated records";
  const start = new Date(anchor);
  if (periodId === "week") start.setDate(start.getDate() - 6);
  if (periodId === "month") start.setDate(1);
  if (periodId === "year") start.setMonth(0, 1);
  return `${formatDate(start)} to ${formatDate(anchor)}`;
}

function boardMetricValue(periods, periodId, metricId) {
  return Number((periods.find((period) => period.id === periodId)?.metrics || []).find((metric) => metric.id === metricId)?.value || 0);
}

function buildPopulationServiceInsights(periods, context = {}) {
  const monthBirths = boardMetricValue(periods, "month", "births");
  const monthDeaths = boardMetricValue(periods, "month", "deaths");
  const monthVisits = boardMetricValue(periods, "month", "visits");
  const monthAdmissions = boardMetricValue(periods, "month", "admissions");
  const hasDailyServiceReports = Number(context.dailyServiceReports || 0) > 0;
  const hasServiceReports = hasDailyServiceReports || Number(context.serviceReports || 0) > 0;
  return [
    {
      id: "certificate-coverage",
      title: "证照登记覆盖",
      value: `${monthBirths + monthDeaths}例`,
      status: monthBirths + monthDeaths > 0 ? "ready" : "empty",
      detail: "出生、死亡已按医学证明日期形成月内统计；现场继续补齐撤销、补正和跨部门交换回执。",
      source: "birthCertificates/deathCertificates"
    },
    {
      id: "medical-service-signal",
      title: "门急诊服务量",
      value: `${monthVisits}人次`,
      status: hasDailyServiceReports ? "ready" : hasServiceReports ? "watch" : "empty",
      detail: hasDailyServiceReports ? "已接入日报服务量快照，日、周、月、年视图使用真实日报汇总，月报仍作为对账基线。" : hasServiceReports ? "当前使用月度接口总量折算，日报接口接入前不用于小时级预警。" : "等待卫生统计或院内门急诊日报接口写入。",
      source: hasDailyServiceReports ? "healthStatistics.dailyServiceReports" : "healthStatistics.serviceReports"
    },
    {
      id: "admission-pressure",
      title: "入院承压观察",
      value: `${monthAdmissions}人次`,
      status: hasDailyServiceReports && monthAdmissions >= 5000 ? "watch" : monthAdmissions >= 20000 ? "watch" : "ready",
      detail: "入院量用于提示床位、转诊和医共体协同压力；生产需接入床位和出入院实时状态。",
      source: hasDailyServiceReports ? "healthStatistics.dailyServiceReports.interfaceData.inpatientAdmissions" : "inpatientAdmissions"
    },
    {
      id: "site-cutover",
      title: "现场联调重点",
      value: "5类接口",
      status: "blocked",
      detail: "证照链路、院内 HIS/EMR/LIS/PACS、统计直报、统一身份和公安/民政/疾控回执需现场签字后替换演示路径。",
      source: "site dependencies"
    }
  ];
}

function buildPopulationServiceBoard(data) {
  const birthRows = rows(data, "birthCertificates");
  const deathRows = rows(data, "deathCertificates");
  const healthStatistics = data.healthStatistics && typeof data.healthStatistics === "object" ? data.healthStatistics : {};
  const serviceReports = Array.isArray(healthStatistics.serviceReports) ? healthStatistics.serviceReports : [];
  const dailyServiceReports = Array.isArray(healthStatistics.dailyServiceReports) ? healthStatistics.dailyServiceReports : [];
  const statisticsPeriod = healthStatistics.period || "";
  const periodAnchor = parseDate(`${statisticsPeriod || ""}-01`);
  const eventAnchor = latestAvailableDate(
    birthRows.map((item) => item.birthDateTime),
    deathRows.map((item) => item.deathDateTime),
    dailyServiceReports.map((item) => item.reportDate || item.date || item.serviceDate)
  ) || periodAnchor || new Date();
  const monthDays = daysInMonthFromPeriod(statisticsPeriod, eventAnchor);
  const serviceTotals = serviceReports.reduce((totals, item) => {
    const interfaceData = item.interfaceData || {};
    totals.visits += Number(interfaceData.outpatientVisits || 0) + Number(interfaceData.emergencyVisits || 0);
    totals.admissions += Number(interfaceData.inpatientAdmissions || 0);
    return totals;
  }, { visits: 0, admissions: 0 });
  const hasDailyServiceReports = dailyServiceReports.length > 0;
  const serviceMetric = (period, metricId) => hasDailyServiceReports
    ? sumDailyServiceWindow(dailyServiceReports, eventAnchor, period.id, metricId)
    : Math.round(serviceTotals[metricId] * period.serviceFactor);
  const periods = [
    { id: "day", label: "日", serviceFactor: 1 / monthDays },
    { id: "week", label: "周", serviceFactor: 7 / monthDays },
    { id: "month", label: "月", serviceFactor: 1 },
    { id: "year", label: "年", serviceFactor: 12 }
  ].map((period) => ({
    id: period.id,
    label: period.label,
    rangeLabel: periodRangeLabel(eventAnchor, period.id),
    metrics: [
      { id: "births", label: "出生", value: countInWindow(birthRows, "birthDateTime", eventAnchor, period.id), unit: "例", tone: "birth", sourceLabel: "出生医学证明日期", source: "birthCertificates.birthDateTime" },
      { id: "deaths", label: "死亡", value: countInWindow(deathRows, "deathDateTime", eventAnchor, period.id), unit: "例", tone: "death", sourceLabel: "死亡医学证明日期", source: "deathCertificates.deathDateTime" },
      { id: "visits", label: "就诊", value: serviceMetric(period, "visits"), unit: "人次", tone: "visit", sourceLabel: hasDailyServiceReports ? "日报门急诊接口" : "月度门急诊接口折算", source: hasDailyServiceReports ? "healthStatistics.dailyServiceReports.interfaceData.outpatientVisits + emergencyVisits" : "healthStatistics.serviceReports.interfaceData.outpatientVisits + emergencyVisits" },
      { id: "admissions", label: "入院", value: serviceMetric(period, "admissions"), unit: "人次", tone: "admission", sourceLabel: hasDailyServiceReports ? "日报入院接口" : "月度入院接口折算", source: hasDailyServiceReports ? "healthStatistics.dailyServiceReports.interfaceData.inpatientAdmissions" : "healthStatistics.serviceReports.interfaceData.inpatientAdmissions" }
    ]
  }));
  return {
    defaultPeriod: "day",
    eventAnchor: formatDate(eventAnchor),
    statisticsPeriod,
    serviceMode: hasDailyServiceReports ? "daily-interface" : "monthly-snapshot",
    dailyServiceReports: dailyServiceReports.length,
    sourceNote: hasDailyServiceReports ? "出生、死亡按医学证明日期统计；就诊、入院来自卫生统计日报接口，日、周、月、年均按日报快照汇总，月度直报保留为对账基线。" : "出生、死亡按证书日期统计；就诊、入院先使用月度接口总量折算日、周、月、年，现场日报接口接入后可替换为真实分时数据。",
    insights: buildPopulationServiceInsights(periods, { serviceReports: serviceReports.length, dailyServiceReports: dailyServiceReports.length, statisticsPeriod }),
    periods
  };
}

function buildCertificateExchangeChain(data) {
  const healthStatistics = data.healthStatistics && typeof data.healthStatistics === "object" ? data.healthStatistics : {};
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
    requiredCapabilities: ["receipt", "revoke", "correction", "reconciliation"],
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

function buildRiskDrilldowns(openActions) {
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

function buildSiteEvidencePackage(data, context = {}) {
  const healthStatistics = data.healthStatistics && typeof data.healthStatistics === "object" ? data.healthStatistics : {};
  const configured = Array.isArray(healthStatistics.siteEvidencePackage) ? healthStatistics.siteEvidencePackage : [];
  const evidenceRecords = context.evidenceRecords || [];
  const interfaceRows = context.interfaceRows || [];
  const siteDependencies = context.siteDependencies || [];
  const fallback = [
    { id: "summary-json", type: "发布摘要", evidence: "release/health-dashboard-summary.json", owner: "规划信息处", status: "ready", nextAction: "随 release:report 归档。" },
    { id: "interface-messages", type: "接口报文", evidence: `${interfaceRows.length} platformInterfaces`, owner: "接口联调组", status: interfaceRows.length >= 4 ? "ready" : "watch", nextAction: "生产联调时替换为真实请求、响应和签名样例。" },
    { id: "acceptance-records", type: "验收记录", evidence: `${evidenceRecords.length} platformEvidence records`, owner: "项目办", status: evidenceRecords.length >= 2 ? "ready" : "watch", nextAction: "补充现场截图、签字单和复测结论。" },
    { id: "site-signoff", type: "现场签字", evidence: `${siteDependencies.length} site dependencies`, owner: "各级卫生健康行政部门", status: siteDependencies.length > 0 ? "watch" : "ready", nextAction: "上线前完成身份、证照、统计、院内系统和灾备签字。" }
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

function buildDepartmentFunctionMatrix(context = {}) {
  const applications = context.applications || [];
  const openActions = context.openActions || [];
  const populationServiceBoard = context.populationServiceBoard || {};
  const certificateExchange = context.certificateExchange || { summary: {} };
  const riskDrilldowns = context.riskDrilldowns || { summary: {} };
  const siteEvidencePackage = context.siteEvidencePackage || { summary: {} };
  const interfaceRows = context.interfaceRows || [];
  const evidenceRecords = context.evidenceRecords || [];
  const siteDependencies = context.siteDependencies || [];
  const sourceRecords = applications.reduce((sum, item) => sum + Number(item.records || 0), 0);
  return [
    {
      id: "planning-information",
      name: "规划信息处/信息中心",
      level: "内部机构",
      implemented: [
        `${applications.length}个源应用汇总入口`,
        `日/周/月/年服务量看板（${populationServiceBoard.serviceMode || "snapshot"}）`,
        `${interfaceRows.length}条接口联调轨道`,
        `${siteEvidencePackage.summary?.artifacts || 0}项现场证据包`
      ],
      nextPlan: "接入市级平台运行监控、真实卫生统计日报、机构目录和生产数据库适配，形成按区县和机构钻取的运行视图。",
      evidence: "healthDashboardSummary.populationServiceBoard/platformInterfaces/siteEvidencePackage",
      status: populationServiceBoard.serviceMode === "daily-interface" ? "ready" : "watch"
    },
    {
      id: "medical-administration",
      name: "医政医管处",
      level: "内部机构",
      implemented: [
        "就诊、入院、出院、床位日报汇总",
        "转诊、远程会诊、医技互认和高风险 open action 归集",
        `${riskDrilldowns.summary?.items || 0}条风险下钻处置轨迹`
      ],
      nextPlan: "联调 HIS、EMR、LIS、PACS、床位、远程会诊和检查检验互认接口，补齐处置回写和复核签字。",
      evidence: "healthStatistics.dailyServiceReports/openActions/riskDrilldowns",
      status: riskDrilldowns.summary?.items ? "ready" : "watch"
    },
    {
      id: "primary-public-health",
      name: "基层卫生处/公共卫生处",
      level: "内部机构",
      implemented: [
        "县域医共体、基层慢病、家庭医生和公共卫生任务汇总",
        "基层风险、逾期随访、上转复核和服务协同待办",
        `${openActions.length}条预览待办与源应用导航`
      ],
      nextPlan: "按区县、乡镇卫生院、社区卫生服务中心和村卫生室接入真实任务回写，形成基层闭环率和超期率看板。",
      evidence: "county.html/index.html/openActions",
      status: openActions.length ? "watch" : "ready"
    },
    {
      id: "maternal-child",
      name: "妇幼健康处",
      level: "内部机构",
      implemented: [
        "出生医学证明指标纳入四周期统计",
        "出生证照交换、撤销、补正、回执和跨部门对账状态",
        `${certificateExchange.summary?.receipts || 0}条交换回执`
      ],
      nextPlan: "联调出生医学证明签发系统、省电子证照平台和公安户籍回执，补齐撤销、补正和纸电一致性证据。",
      evidence: "birthCertificates/certificateExchange",
      status: certificateExchange.summary?.receipts >= 3 ? "ready" : "watch"
    },
    {
      id: "disease-control",
      name: "疾控处/应急办",
      level: "内部机构",
      implemented: [
        "死亡医学证明、死因监测和公共卫生风险汇总",
        "死亡证照、疾控死因监测和法定传染病关联链路",
        "高风险预警纳入管理端任务闭环"
      ],
      nextPlan: "联调疾控死因监测、传染病报告、突发公共卫生事件和应急处置接口，补齐编码修订和补报回执。",
      evidence: "deathCertificates/certificateExchange/openActions",
      status: certificateExchange.summary?.blocked > 0 ? "watch" : "ready"
    },
    {
      id: "supervision-policy",
      name: "综合监督处/政策法规处",
      level: "内部机构",
      implemented: [
        "政策说明、数据边界、管理端权限和审计链说明",
        `${evidenceRecords.length}条平台验收证据`,
        `${sourceRecords}条源应用记录纳入汇总审计`
      ],
      nextPlan: "补齐行政监管事项清单、执法监督接口、数据授权规则和个人信息保护影响评估证据。",
      evidence: "health-dashboard-about.html/platformEvidence/securityEvents",
      status: evidenceRecords.length >= 2 ? "ready" : "watch"
    },
    {
      id: "project-security",
      name: "项目办/安全管理岗",
      level: "内部机构",
      implemented: [
        "发布报告、部署门禁、现场证据包和验收材料索引",
        "接口报文、验收记录、现场签字和复测结论归集",
        `${siteDependencies.length}项生产现场依赖`
      ],
      nextPlan: "完成生产统一身份、审计留存、监控告警、备份恢复、等保密评、信创适配和上线签字闭环。",
      evidence: "release-report/deploy-check/siteEvidencePackage",
      status: siteEvidencePackage.summary?.ready >= 3 ? "ready" : "watch"
    }
  ];
}

function buildCityCountyFunctionMatrix(context = {}) {
  const applications = context.applications || [];
  const openActions = context.openActions || [];
  const populationServiceBoard = context.populationServiceBoard || {};
  const certificateExchange = context.certificateExchange || { summary: {} };
  const riskDrilldowns = context.riskDrilldowns || { summary: {} };
  const siteEvidencePackage = context.siteEvidencePackage || { summary: {} };
  const interfaceRows = context.interfaceRows || [];
  return [
    {
      id: "city-health-commission",
      level: "市级",
      agency: "市卫生健康委",
      implemented: [
        "跨前七应用总览、指标、风险、任务和验收证据汇总",
        "出生、死亡、就诊、入院四指标日/周/月/年看板",
        "管理端权限和摘要接口审计留痕"
      ],
      nextPlan: "建设市级专题驾驶视图，接入真实机构目录、统计直报、统一认证和跨部门证照交换回执。",
      evidence: "/api/health-dashboard/summary",
      status: applications.length === 7 ? "ready" : "watch"
    },
    {
      id: "city-platform-center",
      level: "市级",
      agency: "市级全民健康信息平台/大数据中心",
      implemented: [
        `${interfaceRows.length}条接口联调轨道`,
        "平台证据、发布报告、部署门禁和静态快照",
        `${siteEvidencePackage.summary?.artifacts || 0}项现场证据包`
      ],
      nextPlan: "联调生产数据库、消息总线、统一身份、日志留存、监控告警和灾备演练。",
      evidence: "platformInterfaces/release-report/deploy-check",
      status: interfaceRows.length >= 5 ? "ready" : "watch"
    },
    {
      id: "city-specialized-centers",
      level: "市级",
      agency: "疾控中心/妇幼保健机构/急救与统计中心",
      implemented: [
        "出生、死亡、证照、疾控死因监测和统计日报汇总",
        `${certificateExchange.summary?.tracks || 0}条证照/统计交换链路`,
        "风险预警与现场依赖统一展示"
      ],
      nextPlan: "接入妇幼、疾控、急救、统计直报和电子证照正式接口，形成专业条线可追溯对账。",
      evidence: "certificateExchange/populationServiceBoard",
      status: certificateExchange.summary?.tracks >= 5 ? "ready" : "watch"
    },
    {
      id: "county-health-bureau",
      level: "县级",
      agency: "区县卫生健康局",
      implemented: [
        "按源应用汇总基层、医共体、慢病、转诊和公共卫生任务",
        `${openActions.length}条跨应用预览待办`,
        "可从管理系统回到源应用办理页面"
      ],
      nextPlan: "增加区县筛选、辖区机构看板、任务闭环率、超期率和现场问题整改台账。",
      evidence: "county.html/index.html/openActions",
      status: openActions.length ? "watch" : "ready"
    },
    {
      id: "county-consortium",
      level: "县级",
      agency: "县域医共体牵头医院",
      implemented: [
        "转诊、远程会诊、检查检验互认和高危慢病上转风险汇总",
        `${riskDrilldowns.summary?.items || 0}条下钻轨迹关联责任人和时限`,
        "入院与床位压力作为管理提示"
      ],
      nextPlan: "联调牵头医院 HIS/EMR/LIS/PACS、床位、会诊和绩效接口，补齐医共体内闭环回写。",
      evidence: "county.html/riskDrilldowns/healthStatistics.dailyServiceReports",
      status: riskDrilldowns.summary?.items ? "ready" : "watch"
    },
    {
      id: "primary-institutions",
      level: "县级",
      agency: "乡镇卫生院/社区卫生服务中心/村卫生室",
      implemented: [
        "基层随访、家庭医生、慢病管理、取药和公共卫生待办汇总",
        "源应用边界清晰，办理仍回基层业务端完成",
        "现场验收证据可挂接到发布报告"
      ],
      nextPlan: "接入移动随访、家庭医生签约、公卫系统和基层药品供应接口，形成网底服务质控与提醒。",
      evidence: "index.html/citizen.html/siteEvidencePackage",
      status: "watch"
    }
  ];
}

function buildFunctionalReport(context) {
  const applications = context.applications || [];
  const openActions = context.openActions || [];
  const populationServiceBoard = context.populationServiceBoard || {};
  const interfaces = context.interfaceRows || [];
  const evidenceRecords = context.evidenceRecords || [];
  const siteDependencies = context.siteDependencies || [];
  const certificateExchange = context.certificateExchange || { summary: {}, items: [] };
  const riskDrilldowns = context.riskDrilldowns || { summary: {}, items: [] };
  const siteEvidencePackage = context.siteEvidencePackage || { summary: {}, items: [] };
  const departmentFunctionMatrix = buildDepartmentFunctionMatrix(context);
  const cityCountyFunctionMatrix = buildCityCountyFunctionMatrix(context);
  const sourceRecords = applications.reduce((sum, item) => sum + Number(item.records || 0), 0);
  const sourceOpenActions = applications.reduce((sum, item) => sum + Number(item.openActions || 0), 0);
  const highRisks = applications.reduce((sum, item) => sum + Number(item.highRisks || 0), 0);
  const functionRows = [
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
      boundary: "出生、死亡按证书日期统计；就诊、入院已按日报快照汇总日周月年，小时级预警和生产切换仍需实时明细。"
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
      evidence: `${openActions.length} preview open actions, ${sourceOpenActions} source open actions, ${highRisks} high risks`,
      boundary: "仅归一化展示 open action，处置回写仍在源业务端完成。"
    },
    {
      id: "risk-drilldown-loop",
      name: "风险下钻与处置轨迹",
      status: riskDrilldowns.items?.length ? "ready" : "watch",
      evidence: `${riskDrilldowns.summary?.items || 0} drilldowns, ${riskDrilldowns.summary?.withTrace || 0} with trace`,
      boundary: "下钻展示源应用链接、责任人、时限、状态和阻塞原因；不在本系统直接修改源业务记录。"
    },
    {
      id: "interface-evidence",
      name: "接口联调与验收证据",
      status: interfaces.length >= 4 && evidenceRecords.length >= 2 ? "ready" : "watch",
      evidence: `${interfaces.length} interface tracks, ${evidenceRecords.length} evidence records`,
      boundary: "复用 platformInterfaces、platformEvidence 与互联互通函数清单。"
    },
    {
      id: "policy-about",
      name: "政策说明与关于页",
      status: "ready",
      evidence: "health-dashboard-about.html, policy notes, data boundary copy",
      boundary: "说明政策依据、数据口径和现场切换条件，不承诺未接入系统能力。"
    },
    {
      id: "release-audit",
      name: "发布审计与验收报告",
      status: siteDependencies.length > 0 ? "watch" : "ready",
      evidence: "health-dashboard:summary, release:report, deploy:check",
      boundary: "发布报告呈现当前演示与联调状态，生产切换仍依赖现场签字。"
    },
    {
      id: "site-evidence-package",
      name: "现场验收证据包",
      status: siteEvidencePackage.items?.length >= 4 ? "ready" : "watch",
      evidence: `${siteEvidencePackage.summary?.artifacts || 0} artifacts, ${siteEvidencePackage.summary?.ready || 0} ready`,
      boundary: "绑定接口报文、截图、签字单、整改、复测和上线批次材料；生产证据需现场替换演示样例。"
    }
  ];
  return {
    title: "卫生健康综合管理服务系统主要功能报告",
    generatedFrom: "/api/health-dashboard/summary",
    summary: {
      functions: functionRows.length,
      ready: functionRows.filter((item) => item.status === "ready").length,
      watch: functionRows.filter((item) => item.status === "watch").length,
      blocked: functionRows.filter((item) => item.status === "blocked").length
    },
    functions: functionRows,
    departmentFunctionMatrix,
    cityCountyFunctionMatrix,
    releaseEvidence: [
      { id: "summary-api", name: "综合管理服务系统摘要接口", evidence: "/api/health-dashboard/summary" },
      { id: "summary-script", name: "模块摘要与功能报告", evidence: "npm.cmd run health-dashboard:summary" },
      { id: "release-gate", name: "发布聚合报告", evidence: "npm.cmd run release:report" },
      { id: "deploy-gate", name: "部署门禁", evidence: "npm.cmd run deploy:check" }
    ],
    onsiteBoundaries: [
      "证照链路需补齐出生、死亡、电子证照、公安户籍、民政殡葬交换回执。",
      "就诊和入院已接入日报快照；小时级预警不得使用日/月汇总值替代实时明细。",
      "HIS/EMR/LIS/PACS、医保核心、统计直报、统一身份需以现场联调签字替换演示口径。",
      "生产环境还需完成审计留存、监控告警、数据库适配、备份恢复和应急演练。"
    ]
  };
}

function buildHealthDashboardSummary(options = {}) {
  const data = options.data || readJson("data/db.json");
  const runtime = options.runtime || null;
  const readiness = options.readiness || null;
  const releaseReport = options.releaseReport || null;
  const applications = APPLICATIONS.map((app) => summarizeApplication(data, app));
  const openActions = collectOpenActions(data);
  const sourceOpenActions = applications.reduce((sum, item) => sum + item.openActions, 0);
  const previewOpenActions = openActions.length;
  const interfaceRows = rows(data, "platformInterfaces");
  const evidenceRecords = rows(data, "platformEvidence").flatMap((item) => item.records || []);
  const siteDependencies = rows(data, "productionDeploymentPlan").filter((item) => isOpen(item) || /missing|待|寰|blocked/i.test(JSON.stringify(item)));
  const populationServiceBoard = buildPopulationServiceBoard(data);
  const certificateExchange = buildCertificateExchangeChain(data);
  const riskDrilldowns = buildRiskDrilldowns(openActions);
  const siteEvidencePackage = buildSiteEvidencePackage(data, { interfaceRows, evidenceRecords, siteDependencies });
  const functionalReport = buildFunctionalReport({ applications, openActions, populationServiceBoard, certificateExchange, riskDrilldowns, siteEvidencePackage, interfaceRows, evidenceRecords, siteDependencies });
  const departmentFunctionMatrix = functionalReport.departmentFunctionMatrix || [];
  const cityCountyFunctionMatrix = functionalReport.cityCountyFunctionMatrix || [];
  const checks = [
    { id: "dashboard:applications", passed: applications.length === 7 && applications.every((item) => item.entry && item.collections.length), detail: `${applications.length} applications` },
    { id: "dashboard:source-boundary", passed: applications.every((item) => /source application/.test(item.boundary)), detail: "dashboard is aggregate-only" },
    { id: "dashboard:metrics", passed: applications.reduce((sum, item) => sum + item.records, 0) > 0, detail: `${applications.reduce((sum, item) => sum + item.records, 0)} source records` },
    { id: "dashboard:actions", passed: previewOpenActions > 0 && sourceOpenActions >= previewOpenActions, detail: `${previewOpenActions} preview / ${sourceOpenActions} source open actions` },
    { id: "dashboard:interfaces", passed: interfaceRows.length >= 4, detail: `${interfaceRows.length} interface rows` },
    { id: "dashboard:evidence", passed: evidenceRecords.length >= 2, detail: `${evidenceRecords.length} evidence records` },
    { id: "dashboard:population-service-board", passed: populationServiceBoard.periods.length === 4 && populationServiceBoard.periods.every((period) => period.metrics.length === 4) && populationServiceBoard.insights.length >= 4 && populationServiceBoard.serviceMode === "daily-interface", detail: `birth, death, visit, admission board for day/week/month/year with ${populationServiceBoard.serviceMode}` },
    { id: "dashboard:certificate-exchange", passed: certificateExchange.items.length >= 5 && certificateExchange.summary.receipts >= 3 && certificateExchange.summary.correctable >= 4, detail: `${certificateExchange.items.length} certificate exchange tracks, ${certificateExchange.summary.receipts} receipts` },
    { id: "dashboard:risk-drilldown", passed: riskDrilldowns.items.length >= 4 && riskDrilldowns.summary.withTrace === riskDrilldowns.items.length, detail: `${riskDrilldowns.items.length} risk drilldowns with trace` },
    { id: "dashboard:site-evidence-package", passed: siteEvidencePackage.items.length >= 4 && siteEvidencePackage.summary.ready >= 3, detail: `${siteEvidencePackage.items.length} evidence package artifacts` },
    { id: "dashboard:functional-report", passed: functionalReport.functions.length >= 9 && functionalReport.releaseEvidence.length >= 4, detail: `${functionalReport.functions.length} module functions with release evidence` },
    { id: "dashboard:department-function-matrix", passed: departmentFunctionMatrix.length >= 6 && departmentFunctionMatrix.every((item) => item.implemented?.length && item.nextPlan), detail: `${departmentFunctionMatrix.length} internal department function rows` },
    { id: "dashboard:city-county-function-matrix", passed: cityCountyFunctionMatrix.length >= 5 && cityCountyFunctionMatrix.some((item) => item.level === "市级") && cityCountyFunctionMatrix.some((item) => item.level === "县级"), detail: `${cityCountyFunctionMatrix.length} city/county agency function rows` }
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    scope: {
      role: "health-administration-management-service-system",
      rule: "For health administration departments at all levels: do not replace source business applications; expose metrics, risk, actions, interfaces, acceptance evidence, and site dependencies."
    },
    totals: {
      applications: applications.length,
      sourceRecords: applications.reduce((sum, item) => sum + item.records, 0),
      openActions: previewOpenActions,
      previewOpenActions,
      sourceOpenActions,
      highRisks: applications.reduce((sum, item) => sum + item.highRisks, 0),
      interfaceTracks: interfaceRows.length,
      evidenceRecords: evidenceRecords.length,
      siteDependencies: siteDependencies.length,
      runtimeRequests: runtime?.http?.apiRequests ?? null,
      readinessPassed: readiness?.passed ?? null,
      releasePassed: releaseReport?.ok ?? null
    },
    applications,
    risks: applications.filter((item) => item.highRisks > 0 || item.openActions > 0).map((item) => ({
      applicationId: item.id,
      application: item.name,
      highRisks: item.highRisks,
      openActions: item.openActions,
      nextAction: item.highRisks ? "Review high-risk source records in the owning application." : "Close source workflow actions in the owning application."
    })),
    openActions,
    populationServiceBoard,
    certificateExchange,
    riskDrilldowns,
    siteEvidencePackage,
    functionalReport,
    interfaces: interfaceRows.map((item) => ({
      id: item.id || item.domain,
      domain: item.domain || item.name || item.id,
      priority: item.priority || "P2",
      owner: item.owner || "",
      status: item.status || "",
      nextAction: item.next || item.nextAction || ""
    })),
    evidence: rows(data, "platformEvidence").map((item) => ({
      id: item.id,
      name: item.name || item.category || item.id,
      owner: item.owner || "",
      status: item.status || "",
      records: Array.isArray(item.records) ? item.records.length : 0,
      nextAction: item.next || item.nextAction || ""
    })),
    siteDependencies: siteDependencies.map((item) => ({
      id: item.id,
      track: item.track || item.name,
      owner: item.owner || "",
      status: item.status || "",
      nextAction: item.nextAction || item.next || ""
    })),
    checks
  };
}

function renderMarkdown(report) {
  const appRows = report.applications.map((item) => `| ${item.id} | ${item.entry} | ${item.records} | ${item.openActions} | ${item.highRisks} | ${item.status} |`);
  const actionRows = report.openActions.map((item) => `| ${item.priority} | ${item.application || ""} | ${item.entry || ""} | ${item.collection} | ${item.id} | ${String(item.title || "").replace(/\|/g, "/")} | ${item.status} | ${item.owner} |`);
  const checkRows = report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${String(item.detail || "").replace(/\|/g, "/")} |`);
  const boardPeriods = report.populationServiceBoard?.periods || [];
  const boardRows = boardPeriods.flatMap((period) => (period.metrics || []).map((metric) => `| ${period.label} | ${period.rangeLabel} | ${metric.label} | ${metric.value} ${metric.unit || ""} | ${metric.source || ""} |`));
  const insightRows = (report.populationServiceBoard?.insights || []).map((item) => `| ${item.status || ""} | ${item.title || item.id} | ${item.value || ""} | ${String(item.detail || "").replace(/\|/g, "/")} |`);
  const certificateRows = (report.certificateExchange?.items || []).map((item) => `| ${item.status || ""} | ${item.domain || item.id} | ${item.target || ""} | ${item.receiptStatus || ""} | ${item.reconciliationStatus || ""} | ${String(item.nextAction || "").replace(/\|/g, "/")} |`);
  const drilldownRows = (report.riskDrilldowns?.items || []).map((item) => `| ${item.priority || ""} | ${item.application || ""} | ${item.collection || ""} | ${item.owner || ""} | ${item.status || ""} | ${String(item.blocker || "").replace(/\|/g, "/")} |`);
  const siteEvidenceRows = (report.siteEvidencePackage?.items || []).map((item) => `| ${item.status || ""} | ${item.type || item.id} | ${String(item.evidence || "").replace(/\|/g, "/")} | ${item.owner || ""} | ${String(item.nextAction || "").replace(/\|/g, "/")} |`);
  const functionRows = (report.functionalReport?.functions || []).map((item) => `| ${item.status || ""} | ${item.name || item.id} | ${String(item.evidence || "").replace(/\|/g, "/")} | ${String(item.boundary || "").replace(/\|/g, "/")} |`);
  const departmentRows = (report.functionalReport?.departmentFunctionMatrix || []).map((item) => `| ${item.status || ""} | ${item.name || item.id} | ${(item.implemented || []).map((text) => String(text).replace(/\|/g, "/")).join("<br>")} | ${String(item.nextPlan || "").replace(/\|/g, "/")} |`);
  const cityCountyRows = (report.functionalReport?.cityCountyFunctionMatrix || []).map((item) => `| ${item.status || ""} | ${item.level || ""} | ${item.agency || item.id} | ${(item.implemented || []).map((text) => String(text).replace(/\|/g, "/")).join("<br>")} | ${String(item.nextPlan || "").replace(/\|/g, "/")} |`);
  const reportEvidenceRows = (report.functionalReport?.releaseEvidence || []).map((item) => `| ${item.name || item.id} | ${String(item.evidence || "").replace(/\|/g, "/")} |`);
  const onsiteBoundaryRows = (report.functionalReport?.onsiteBoundaries || []).map((item) => `- ${item}`);
  return [
    "# Health dashboard summary",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Applications: ${report.totals.applications}`,
    `- Source records: ${report.totals.sourceRecords}`,
    `- Source open actions: ${report.totals.sourceOpenActions ?? report.totals.openActions}`,
    `- Preview open actions: ${report.totals.previewOpenActions ?? report.totals.openActions}`,
    `- High risks: ${report.totals.highRisks}`,
    `- Interface tracks: ${report.totals.interfaceTracks}`,
    `- Evidence records: ${report.totals.evidenceRecords}`,
    "",
    "## Boundary",
    "",
    report.scope.rule,
    "",
    "## Checks",
    "",
    "| Result | Check | Detail |",
    "|---|---|---|",
    ...checkRows,
    "",
    "## Applications",
    "",
    "| Application | Entry | Records | Open actions | High risks | Status |",
    "|---|---|---:|---:|---:|---|",
    ...appRows,
    "",
    "## Population and service board",
    "",
    report.populationServiceBoard?.sourceNote || "No board source note.",
    "",
    "| Period | Range | Metric | Value | Source |",
    "|---|---|---|---:|---|",
    ...boardRows,
    "",
    "### Population and service insights",
    "",
    "| Status | Insight | Value | Detail |",
    "|---|---|---:|---|",
    ...insightRows,
    "",
    "## Certificate exchange chain",
    "",
    `- Status: ${report.certificateExchange?.status || "empty"}`,
    `- Source: ${report.certificateExchange?.source || "healthStatistics.certificateExchangeLinks"}`,
    "",
    "| Status | Domain | Target | Receipt | Reconciliation | Next action |",
    "|---|---|---|---|---|---|",
    ...certificateRows,
    "",
    "## Risk drilldowns",
    "",
    "| Priority | Application | Collection | Owner | Status | Blocker |",
    "|---|---|---|---|---|---|",
    ...drilldownRows,
    "",
    "## Site evidence package",
    "",
    "| Status | Type | Evidence | Owner | Next action |",
    "|---|---|---|---|---|",
    ...siteEvidenceRows,
    "",
    "## Main function report",
    "",
    report.functionalReport?.title || "Health dashboard main function report",
    "",
    `- Functions: ${report.functionalReport?.summary?.functions || 0}`,
    `- Ready: ${report.functionalReport?.summary?.ready || 0}`,
    `- Watch: ${report.functionalReport?.summary?.watch || 0}`,
    `- Blocked: ${report.functionalReport?.summary?.blocked || 0}`,
    "",
    "| Status | Function | Evidence | Boundary |",
    "|---|---|---|---|",
    ...functionRows,
    "",
    "### Internal department function matrix",
    "",
    "| Status | Department | Implemented functions | Next plan |",
    "|---|---|---|---|",
    ...departmentRows,
    "",
    "### City and county agency function matrix",
    "",
    "| Status | Level | Agency | Implemented functions | Next plan |",
    "|---|---|---|---|---|",
    ...cityCountyRows,
    "",
    "### Release evidence",
    "",
    "| Item | Evidence |",
    "|---|---|",
    ...reportEvidenceRows,
    "",
    "### Onsite boundaries",
    "",
    ...onsiteBoundaryRows,
    "",
    "## Open action preview",
    "",
    "| Priority | Application | Entry | Collection | ID | Title | Status | Owner |",
    "|---|---|---|---|---|---|---|---|",
    ...actionRows,
    ""
  ].join("\n");
}

function parseArgs(argv = process.argv.slice(2)) {
  const flags = {};
  argv.forEach((flag) => {
    if (!flag.startsWith("--")) return;
    const [key, ...rest] = flag.slice(2).split("=");
    flags[key] = rest.length ? rest.join("=") : true;
  });
  return flags;
}

function writeOutput(report, flags = {}) {
  const output = path.resolve(ROOT, String(flags.output || DEFAULT_OUTPUT));
  const markdown = path.resolve(ROOT, String(flags.markdown || DEFAULT_MARKDOWN));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2), "utf8");
  fs.mkdirSync(path.dirname(markdown), { recursive: true });
  fs.writeFileSync(markdown, renderMarkdown(report), "utf8");
}

function runCli() {
  const flags = parseArgs();
  const report = buildHealthDashboardSummary();
  if (flags.write !== false) writeOutput(report, flags);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { APPLICATIONS, buildFunctionalReport, buildHealthDashboardSummary, buildPopulationServiceBoard, parseArgs, renderMarkdown, writeOutput };
