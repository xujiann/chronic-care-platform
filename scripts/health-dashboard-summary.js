#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "health-dashboard-summary.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "health-dashboard-summary.md");

const APPLICATIONS = require("../health-dashboard-applications");
const DASHBOARD_APPLICATION_ID = "health-dashboard";
const DOCUMENTATION_RULE = {
  aboutPage: "about.html",
  requiredDocument: "docs/<module-name>.md",
  flowDiagram: "Each template must include a flow diagram covering data source, business workflow, sharing/collaboration, citizen visibility, and management statistics or alerts.",
  requiredSections: ["功能边界", "角色入口", "数据对象", "API 权限", "页面入口", "测试证据", "验收证据", "流程图"],
  codexLoop: "Plan first, make one small change, run the matching test or build, observe and fix failures, update docs and acceptance notes, then repeat until accepted.",
  maternalChildReference: "docs/妇幼健康全模块说明.md"
};

const CLOSED_STATUS_PATTERN = /closed|resolved|approved|recognized|completed|passed|ready|signed|done|宸插畬鎴|宸查€氳繃|宸插彇鑽|宸插洖浼|宸蹭簰璁|宸叉牳楠|宸查棴鐜|已完成|已通过|已闭环/;
const HIGH_RISK_PATTERN = /high|urgent|critical|overdue|dead_letter|楂|绱|閫炬湡|critical|高|逾期|危急/;

const APPLICATION_BY_COLLECTION = Object.fromEntries(
  APPLICATIONS.flatMap((app) => app.collections.map((collection) => [collection, app]))
);
const TASK_COLLECTIONS = [
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
    conversationTitle: app.conversationTitle || app.name,
    entry: app.entry,
    owner: app.owner,
    collections: collectionRows.map((item) => ({ collection: item.collection, records: item.rows.length })),
    records: allRows.length,
    openActions: openRows.length,
    highRisks: highRiskRows.length,
    evidenceRecords: relatedEvidence.length,
    status: allRows.length ? "modeled" : "empty-ready",
    functionalBoundary: app.functionalBoundary,
    reusePoints: app.reusePoints,
    dataCollections: app.collections,
    apiRoutes: app.apiRoutes,
    frontendEntry: app.entry,
    testEvidence: app.testEvidence,
    acceptanceEvidence: app.acceptanceEvidence,
    documentationRule: DOCUMENTATION_RULE,
    boundary: "综合管理服务系统仅做汇总展示；具体业务流程仍在源应用办理。"
  };
}

function buildConversationStarter(template) {
  return [
    `Thread title: ${template.conversationTitle}`,
    `Goal: implement and verify ${template.id} using the unified template.`,
    `Start from ${template.frontendEntry}, reuse ${template.dataCollections.join(", ")}, and keep ${template.acceptanceEvidence.join(", ")} as release evidence.`,
    "Required sections: functional boundary, reuse points, data collections, API, frontend entry, tests, acceptance evidence, About section, module document, workflow diagram."
  ].join(" ");
}

function buildImplementationChecklist(template) {
  const docRule = template.documentationRule || DOCUMENTATION_RULE;
  return [
    `Confirm boundary and owner: ${template.owner}.`,
    `Reuse source collections: ${template.dataCollections.join(", ")}.`,
    `Wire or verify API routes: ${template.apiRoutes.join(", ")}.`,
    `Verify frontend entry: ${template.frontendEntry}.`,
    `Run evidence tests: ${template.testEvidence.join(", ")}.`,
    `Follow Codex loop: ${docRule.codexLoop}`,
    `Archive release evidence: ${template.acceptanceEvidence.join(", ")}.`,
    `Keep About page and module docs current: ${docRule.aboutPage}, ${docRule.requiredDocument}.`,
    "Include a workflow diagram covering data source, business workflow, sharing/collaboration, citizen visibility, and management statistics or alerts."
  ];
}

function buildAcceptanceGate(template) {
  return {
    readyWhen: [
      "Functional boundary is explicit and does not replace the owning source workflow.",
      "All listed data collections and API routes have runnable tests or release evidence.",
      "Frontend entry, About section, module document, workflow diagram, and acceptance artifacts are cross-linked.",
      "Release report, release manifest, deploy check, and CI all reference the module evidence."
    ],
    blockers: [
      template.openActions > 0 ? `${template.openActions} open source actions remain visible in dashboard evidence.` : "No open source actions recorded in dashboard evidence.",
      template.highRisks > 0 ? `${template.highRisks} high-risk source records require owner review.` : "No high-risk source records recorded in dashboard evidence."
    ],
    evidence: template.acceptanceEvidence
  };
}

function buildPriorityApplicationTemplates(options = {}) {
  const summary = buildHealthDashboardSummary(options);
  const templates = summary.applications.map((item, index) => {
    const template = {
      sequence: index + 1,
      id: item.id,
      conversationTitle: item.conversationTitle,
      name: item.name,
      owner: item.owner,
      functionalBoundary: item.functionalBoundary,
      reusePoints: item.reusePoints,
      dataCollections: item.dataCollections,
      apiRoutes: item.apiRoutes,
      frontendEntry: item.frontendEntry,
      testEvidence: item.testEvidence,
      acceptanceEvidence: item.acceptanceEvidence,
      sourceApplication: item.id !== DASHBOARD_APPLICATION_ID,
      aggregateApplication: item.id === DASHBOARD_APPLICATION_ID,
      status: item.status,
      records: item.records,
      openActions: item.openActions,
      highRisks: item.highRisks,
      documentationRule: item.documentationRule
    };
    return {
      ...template,
      conversationStarter: buildConversationStarter(template),
      implementationChecklist: buildImplementationChecklist(template),
      acceptanceGate: buildAcceptanceGate(template)
    };
  });
  const checks = [
    { id: "templates:count", passed: templates.length === 8, detail: `${templates.length} templates` },
    { id: "templates:titles", passed: templates.every((item) => item.conversationTitle), detail: "all templates expose conversation titles" },
    { id: "templates:required-fields", passed: templates.every((item) => item.functionalBoundary && item.reusePoints.length && item.dataCollections.length && item.apiRoutes.length && item.frontendEntry && item.testEvidence.length && item.acceptanceEvidence.length), detail: "all template fields populated" },
    { id: "templates:documentation-rule", passed: templates.every((item) => item.documentationRule?.aboutPage && item.documentationRule?.requiredDocument && item.documentationRule?.flowDiagram), detail: "all templates require About docs and flow diagrams" },
    { id: "templates:conversation-starter", passed: templates.every((item) => item.conversationStarter.includes(item.id) && item.conversationStarter.includes(item.frontendEntry)), detail: "all templates expose conversation starters" },
    { id: "templates:implementation-checklist", passed: templates.every((item) => item.implementationChecklist.length >= 8), detail: "all templates expose implementation checklists" },
    { id: "templates:acceptance-gate", passed: templates.every((item) => item.acceptanceGate.readyWhen.length >= 4 && item.acceptanceGate.evidence.length), detail: "all templates expose acceptance gates" },
    { id: "templates:source-boundary", passed: templates.filter((item) => item.sourceApplication).length === 7 && templates.filter((item) => item.aggregateApplication).length === 1, detail: "7 source applications and 1 aggregate dashboard" }
  ];
  return {
    ok: summary.ok && checks.every((item) => item.passed),
    generatedAt: summary.generatedAt,
    scope: { role: "priority-application-development-templates", rule: "Each template is the handoff contract for one independent application conversation." },
    summary: {
      applications: templates.length,
      sourceApplications: templates.filter((item) => item.sourceApplication).length,
      aggregateApplications: templates.filter((item) => item.aggregateApplication).length,
      apiRoutes: templates.reduce((sum, item) => sum + item.apiRoutes.length, 0),
      dataCollections: new Set(templates.flatMap((item) => item.dataCollections)).size,
      acceptanceArtifacts: templates.reduce((sum, item) => sum + item.acceptanceEvidence.length, 0)
    },
    templates,
    checks
  };
}

function collectOpenActions(data, limit = 12) {
  return collectTaskActionRows(data).filter((item) => !item.closed).sort((left, right) =>
    ({ high: 3, medium: 2, normal: 1 }[right.priority] || 0) - ({ high: 3, medium: 2, normal: 1 }[left.priority] || 0) ||
    String(left.dueAt || "").localeCompare(String(right.dueAt || ""))
  ).slice(0, limit);
}

function collectTaskActionRows(data) {
  return TASK_COLLECTIONS.flatMap((collection) => rows(data, collection).map((item) => {
    const app = APPLICATION_BY_COLLECTION[collection] || APPLICATIONS[0];
    const status = statusOf(item) || "open";
    const dueAt = item.dueAt || item.due || item.nextReview || item.plannedAt || item.requestedAt || item.lastUpdated || "";
    const closed = !isOpen(item);
    return {
      id: item.id || `${collection}-${item.residentId || item.status || "open"}`,
      collection,
      applicationId: app.id,
      application: app.name,
      entry: app.entry,
      title: item.title || item.taskName || item.topic || item.orderType || item.item || item.claimType || item.medication || item.name || collection,
      owner: item.owner || item.assignee || item.institution || item.center || item.sourceInstitution || item.targetInstitution || "owner-pending",
      status,
      priority: riskLevel(item),
      region: item.region || item.district || item.area || "",
      dueAt,
      updatedAt: item.updatedAt || item.lastUpdated || item.createdAt || item.reportDate || dueAt,
      closed,
      overdue: !closed && isActionOverdue(dueAt, item)
    };
  }));
}

function isActionOverdue(dueAt, item = {}) {
  const text = [item.status, item.priority, item.level, item.risk, item.riskLevel].filter(Boolean).join(" ");
  if (/overdue|逾期|超期|已逾期/i.test(text)) return true;
  const dueDate = parseDate(dueAt);
  if (!dueDate) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return dueDate < today;
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
  if (!anchor) return "暂无日期记录";
  const start = new Date(anchor);
  if (periodId === "week") start.setDate(start.getDate() - 6);
  if (periodId === "month") start.setDate(1);
  if (periodId === "year") start.setMonth(0, 1);
  return `${formatDate(start)} 至 ${formatDate(anchor)}`;
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

function buildPopulationSourceDetails(context = {}) {
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
    sourceDetails: buildPopulationSourceDetails({ birthRows, deathRows, serviceReports, dailyServiceReports, hasDailyServiceReports }),
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
    { id: "summary-json", type: "发布摘要", evidence: "综合管理服务系统摘要文件", owner: "规划信息处", status: "ready", nextAction: "随发布聚合报告归档。" },
    { id: "interface-messages", type: "接口报文", evidence: `${interfaceRows.length} 条平台接口清单`, owner: "接口联调组", status: interfaceRows.length >= 4 ? "ready" : "watch", nextAction: "生产联调时替换为真实请求、响应和签名样例。" },
    { id: "acceptance-records", type: "验收记录", evidence: `${evidenceRecords.length} 条平台验收证据`, owner: "项目办", status: evidenceRecords.length >= 2 ? "ready" : "watch", nextAction: "补充现场截图、签字单和复测结论。" },
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

function buildSiteIssueLedger(context = {}) {
  const evidenceItems = context.siteEvidencePackage?.items || [];
  const siteDependencies = context.siteDependencies || [];
  const evidenceIssues = evidenceItems.filter((item) => item.status !== "ready").map((item) => ({
    id: `evidence-${item.id}`,
    category: item.type || "现场证据",
    owner: item.owner || "项目办",
    status: item.status || "watch",
    source: item.evidence || item.id,
    nextAction: item.nextAction || "补齐现场验收材料并复核。",
    boundary: "仅跟踪现场证据补齐，不替代源系统办理。"
  }));
  const dependencyIssues = siteDependencies.map((item) => ({
    id: `dependency-${item.id}`,
    category: item.track || item.name || "现场依赖",
    owner: item.owner || "现场负责人",
    status: item.status || "watch",
    source: item.id,
    nextAction: item.nextAction || item.next || "完成现场签字或联调确认。",
    boundary: "仅跟踪上线依赖和签字状态，不替代外部系统建设。"
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

function buildProductionAcceptanceRouting() {
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

function buildProductionBackendGoLiveChecklist() {
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
    status: items.some((item) => item.status === "blocked") ? "blocked" : items.some((item) => item.status === "pending" || item.status === "watch") ? "watch" : "ready",
    summary: {
      total: items.length,
      ready: items.filter((item) => item.status === "ready").length,
      watch: items.filter((item) => item.status === "watch").length,
      pending: items.filter((item) => item.status === "pending").length,
      blocked: items.filter((item) => item.status === "blocked").length
    },
    items,
    boundary: "真实上线必须使用生产级后端；当前 Node API 是基础，仍需完成生产数据库、统一身份、真实接口、审计留存、监控告警、备份恢复和安全合规闭环。"
  };
}

function buildProductionReadinessGate(productionDeploymentPlan = [], context = {}) {
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
  const interfaceCount = Array.isArray(context.interfaceRows) ? context.interfaceRows.length : 0;
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
    acceptanceRouting: buildProductionAcceptanceRouting(),
    backendGoLiveChecklist: buildProductionBackendGoLiveChecklist(),
    boundary: "上线运行标准以正式环境、统一身份、审计留存、生产数据库、接口签字、监控告警和灾备演练全部闭环为准。"
  };
}

function districtName(name) {
  return String(name || "").replace(/健康城市平台|卫生健康局|县域医共体/g, "").trim();
}

function isHealthJurisdictionOrganization(item = {}) {
  return ["city", "district", "health_admin"].includes(item.orgType);
}

function normalizeDistrictRegion(value) {
  const region = String(value || "").trim();
  if (!region || region === "市级" || /医保/.test(region)) return "";
  return districtName(region);
}

function buildJurisdictionRow(district, context = {}) {
  const all = Boolean(context.all);
  const organizations = context.organizations || [];
  const resources = context.resources || [];
  const dailyReports = context.dailyReports || [];
  const openActions = context.openActions || [];
  const scopedResources = all ? resources : resources.filter((item) => item.region === district);
  const scopedOrganizations = all ? organizations : organizations.filter((item) => districtName(item.name) === district || (item.parentCode === "ORG-DIST-ZS" && district === "中山区"));
  const scopedReports = all ? dailyReports : dailyReports.filter((item) => item.region === district);
  const scopedActions = all ? openActions : openActions.filter((item) => item.region === district || JSON.stringify(item).includes(district));
  const serviceTotals = scopedReports.reduce((totals, item) => {
    const interfaceData = item.interfaceData || {};
    totals.visits += Number(interfaceData.outpatientVisits || 0) + Number(interfaceData.emergencyVisits || 0);
    totals.admissions += Number(interfaceData.inpatientAdmissions || 0);
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

function buildJurisdictionScope(data, context = {}) {
  const organizations = rows(data, "authOrganizations");
  const resources = rows(data, "medicalResources");
  const jurisdictionOrganizations = organizations.filter(isHealthJurisdictionOrganization);
  const healthStatistics = data.healthStatistics && typeof data.healthStatistics === "object" ? data.healthStatistics : {};
  const dailyReports = Array.isArray(healthStatistics.dailyServiceReports) ? healthStatistics.dailyServiceReports : [];
  const openActions = context.openActions || [];
  const resourceDistricts = resources.map((item) => normalizeDistrictRegion(item.region)).filter(Boolean);
  const organizationDistricts = jurisdictionOrganizations
    .filter((item) => item.orgType === "district" || item.orgLevel === "区市县")
    .map((item) => normalizeDistrictRegion(item.name))
    .filter(Boolean);
  const baseDistricts = new Set([...organizationDistricts, ...resourceDistricts]);
  const actionDistricts = openActions
    .map((item) => normalizeDistrictRegion(item.region))
    .filter((region) => region && (baseDistricts.has(region) || /(?:区|县|市)$/.test(region)));
  const districtOptions = Array.from(new Set([
    ...organizationDistricts,
    ...resourceDistricts,
    ...actionDistricts
  ].filter(Boolean))).sort((left, right) => left.localeCompare(right, "zh-CN"));
  const institutionTypeOptions = Array.from(new Set(resources.map((item) => item.type || item.orgLevel).filter(Boolean))).sort((left, right) => left.localeCompare(right, "zh-CN"));
  const districts = [
    buildJurisdictionRow("全市", { organizations: jurisdictionOrganizations, resources, dailyReports, openActions, all: true }),
    ...districtOptions.map((district) => buildJurisdictionRow(district, { organizations: jurisdictionOrganizations, resources, dailyReports, openActions }))
  ];
  const totals = districts[0] || {};
  return {
    defaultDistrict: "",
    districtOptions,
    institutionTypeOptions,
    summary: {
      districts: districtOptions.length,
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

function buildActionClosureTrend(actions, context = {}) {
  const rows = Array.isArray(actions) ? actions : [];
  const anchor = latestAvailableDate(rows.map((item) => item.dueAt), rows.map((item) => item.updatedAt)) || new Date();
  const periods = [
    { id: "day", label: "日", days: 1 },
    { id: "week", label: "周", days: 7 },
    { id: "month", label: "月", month: true },
    { id: "year", label: "年", year: true }
  ].map((period) => buildActionClosurePeriod(period, rows, anchor));
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
    closureRate: rate(item.closed, item.total),
    overdueRate: rate(item.overdue, item.total)
  })).sort((left, right) => right.overdueRate - left.overdueRate || right.open - left.open || left.application.localeCompare(right.application, "zh-CN"));
  const total = rows.length;
  const closed = rows.filter((item) => item.closed).length;
  const overdue = rows.filter((item) => item.overdue).length;
  const open = total - closed;
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
      closureRate: rate(closed, total),
      overdueRate: rate(overdue, total),
      previewOpenActions: context.openActions?.length || open
    },
    periods,
    applications,
    boundary: "仅用于卫生健康行政部门监管、督办和调度分析；具体办理、接诊、审核、随访和整改仍在源应用闭环。"
  };
}

function buildActionClosurePeriod(period, rows, anchor) {
  const start = new Date(anchor);
  start.setHours(0, 0, 0, 0);
  if (period.days) start.setDate(start.getDate() - period.days + 1);
  if (period.month) start.setDate(1);
  if (period.year) start.setMonth(0, 1);
  const end = new Date(anchor);
  end.setHours(23, 59, 59, 999);
  const periodRows = rows.filter((item) => {
    const date = parseDate(item.dueAt || item.updatedAt);
    return date && date >= start && date <= end;
  });
  const total = periodRows.length;
  const closed = periodRows.filter((item) => item.closed).length;
  const overdue = periodRows.filter((item) => item.overdue).length;
  return {
    id: period.id,
    label: period.label,
    rangeLabel: `${formatDate(start)} 至 ${formatDate(end)}`,
    total,
    closed,
    open: total - closed,
    overdue,
    closureRate: rate(closed, total),
    overdueRate: rate(overdue, total)
  };
}

function rate(part, total) {
  return total > 0 ? Math.round((Number(part || 0) / total) * 100) : 0;
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
        "转诊、远程会诊、医技互认和高风险待办归集",
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
      nextPlan: "按区县维度接入基层源业务回写结果，形成监管用闭环率和超期率看板；基层机构具体办理仍在源业务系统完成。",
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
        "按医政、基层、公卫、妇幼、疾控、监督和规划信息职能关联源模块"
      ],
      nextPlan: "建设市级行政监管专题视图；医疗机构、平台中心、专业中心和基层机构仅作为数据来源或协同对象，不在本系统承接办理职责。",
      evidence: "/api/health-dashboard/summary",
      status: applications.length === 7 ? "ready" : "watch"
    },
    {
      id: "city-admin-coordination",
      level: "市级",
      agency: "市级卫生健康行政部门业务处室",
      implemented: [
        `规划信息处关联${interfaceRows.length}条接口联调轨道和${siteEvidencePackage.summary?.artifacts || 0}项现场证据包`,
        `妇幼、疾控、统计职能汇总${certificateExchange.summary?.tracks || 0}条证照/统计交换链路`,
        `医政医管、基层公卫职能监管${riskDrilldowns.summary?.items || 0}条风险下钻和${openActions.length}条跨应用待办`
      ],
      nextPlan: "补齐处室职责清单、事项权限、督办规则和审计字段；源业务办理继续回到对应业务系统。",
      evidence: "platformInterfaces/certificateExchange/riskDrilldowns/openActions",
      status: interfaceRows.length >= 5 && certificateExchange.summary?.tracks >= 5 ? "ready" : "watch"
    },
    {
      id: "county-health-bureau",
      level: "县级",
      agency: "区县卫生健康局",
      implemented: [
        "按行政辖区汇总基层、医共体、慢病、转诊和公共卫生监管信号",
        `${openActions.length}条跨应用预览待办`,
        "可从管理系统回到源应用查看、督办和留痕，具体办理不在本系统完成"
      ],
      nextPlan: "增加区县筛选、辖区机构监管看板、任务闭环率、超期率和现场问题整改台账。",
      evidence: "county.html/index.html/openActions",
      status: openActions.length ? "watch" : "ready"
    },
    {
      id: "county-admin-coordination",
      level: "县级",
      agency: "区县卫生健康行政部门业务科室",
      implemented: [
        "基层卫生、医政医管、公卫和妇幼职能按源模块分工关联",
        "医共体牵头医院、乡镇卫生院和社区卫生服务中心仅作为辖区服务数据来源",
        "入院、床位、随访和证照信号用于监管提示，不下放医疗机构办理任务"
      ],
      nextPlan: "建立区县业务科室与源模块的权限映射，现场联调只验收数据归集、督办和审计，不替代机构端业务闭环。",
      evidence: "county.html/riskDrilldowns/healthStatistics.dailyServiceReports/siteEvidencePackage",
      status: "watch"
    }
  ];
}

function buildIndicatorCenter(context = {}) {
  const applications = context.applications || [];
  const populationServiceBoard = context.populationServiceBoard || { summary: {}, periods: [], insights: [], sourceDetails: [] };
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
    {
      id: "standard-indicator-catalog",
      dimension: "standard",
      name: "标准指标目录覆盖率",
      definition: "已纳入统一目录的指标数 / 本期应纳入指标数，覆盖绩效、评审、质量、运营、慢病、体验和上线准备。",
      source: "healthDashboardSummary / applicationCatalog / platformEvidence",
      owner: "规划信息处、统计信息岗",
      currentValue: `${sourceRecords} 条源记录 / 7 个源应用`,
      targetValue: "形成可追溯标准指标集并逐项绑定口径、来源和责任方",
      trend: "稳定扩展",
      status: "ready",
      quality: "高",
      confidence: 88,
      blockers: ["现场需确认最终标准指标编码和上报口径"],
      drilldown: { label: "查看功能报告", href: "#dashboard-function-report", evidence: "functionalReport/functions" }
    },
    {
      id: "performance-public-hospital",
      dimension: "performance",
      name: "公立医院绩效考核对齐度",
      definition: "围绕国家公立医院绩效考核的医疗质量、运营效率、持续发展和满意度维度建立指标映射。",
      source: "healthStatistics.dailyServiceReports / institutionCreditEvaluations / platformInterfaces",
      owner: "医政医管处、规划信息处",
      currentValue: `月就诊 ${metricValue("visits").toLocaleString("zh-CN")} 人次 / 入院 ${metricValue("admissions").toLocaleString("zh-CN")} 人次`,
      targetValue: "接入国家绩效考核口径、病案首页和 DRG/DIP 评价数据",
      trend: "需联调",
      status: "watch",
      quality: "中",
      confidence: 76,
      blockers: ["缺国家绩效考核平台真实回传", "缺病案首页质量与 DRG/DIP 明细"],
      drilldown: { label: "查看运营服务看板", href: "#population-service-board", evidence: "populationServiceBoard" }
    },
    {
      id: "grade-review-evidence",
      dimension: "grade-review",
      name: "等级评审证据闭环率",
      definition: "已形成可审查证据的评审材料 / 等级评审与互联互通现场材料总数。",
      source: "platformEvidence / siteEvidencePackage / release-artifact-manifest",
      owner: "项目办、医政医管处",
      currentValue: `${siteEvidencePackage.summary?.ready || 0}/${siteEvidencePackage.summary?.artifacts || 0} 项证据已就绪`,
      targetValue: "四甲/五乙、互联互通、整改复测和签字材料全量闭环",
      trend: "持续补证",
      status: siteEvidencePackage.summary?.ready >= 3 ? "ready" : "watch",
      quality: "高",
      confidence: 84,
      blockers: ["生产现场截图、第三方测评结论仍需替换演示样例"],
      drilldown: { label: "查看现场验收证据包", href: "#site-evidence-package", evidence: "siteEvidencePackage" }
    },
    {
      id: "quality-risk-closure",
      dimension: "quality",
      name: "医疗质量风险闭环率",
      definition: "已闭环质量风险 / 全部高风险与预警任务，按责任人、时限、轨迹和阻塞项追踪。",
      source: "riskDrilldowns / emergencySignals / followups / countyAcceptanceLedger",
      owner: "医政医管处、质控中心",
      currentValue: `${riskDrilldowns.summary?.items || 0} 条风险下钻 / ${highRisks} 条高风险`,
      targetValue: "高风险 100% 明确责任人、时限和复核结论",
      trend: "需督办",
      status: highRisks > 0 ? "watch" : "ready",
      quality: "中",
      confidence: 78,
      blockers: ["源应用处置结论尚未全部回写到驾驶舱"],
      drilldown: { label: "查看风险下钻", href: "#risk-drilldown-board", evidence: "riskDrilldowns" }
    },
    {
      id: "operation-closure-efficiency",
      dimension: "operation",
      name: "运营任务闭环效率",
      definition: "跨应用任务闭环率、超期率和应用分布，用于行政调度和运营决策。",
      source: "actionClosureTrend / openActions / sourceApplications",
      owner: "规划信息处、运行调度岗",
      currentValue: `闭环率 ${actionClosureTrend.summary?.closureRate || 0}% / 超期率 ${actionClosureTrend.summary?.overdueRate || 0}%`,
      targetValue: "闭环率 >=95%，超期率 <=5%",
      trend: "受阻",
      status: (actionClosureTrend.summary?.overdueRate || 0) > 20 ? "blocked" : "watch",
      quality: "中",
      confidence: 74,
      blockers: [`仍有 ${sourceOpenActions} 条源应用待办需回到源系统闭环`],
      drilldown: { label: "查看任务闭环趋势", href: "#action-closure-trend-board", evidence: "actionClosureTrend" }
    },
    {
      id: "chronic-management-continuity",
      dimension: "chronic",
      name: "慢病医防融合连续管理",
      definition: "慢病筛查、随访、教育、管理计划和用药支持的连续服务任务汇总。",
      source: "followups / chronicScreeningTasks / chronicEducationPushes / chronicManagementPlans",
      owner: "基层卫生处、公卫处",
      currentValue: `${applications.find((item) => item.id === "commission-supervision")?.openActions || 0} 条综合监管源待办`,
      targetValue: "慢病筛查、随访、教育、处方和复核闭环可追踪",
      trend: "需闭环",
      status: "watch",
      quality: "中",
      confidence: 72,
      blockers: ["家庭医生、药师和公卫随访结果仍需现场接口回写"],
      drilldown: { label: "查看任务闭环", href: "#dashboard-actions-panel", evidence: "openActions/followups" }
    },
    {
      id: "experience-certificate-service",
      dimension: "experience",
      name: "便民证照服务协同",
      definition: "出生、死亡、电子证照、公安、民政、疾控和统计直报回执协同情况。",
      source: "birthCertificates / deathCertificates / digitalCredentials / certificateExchange",
      owner: "妇幼处、基层卫生处、政务服务协同",
      currentValue: `${certificateExchange.summary?.receipts || 0} 条回执 / ${certificateExchange.summary?.tracks || 0} 条证照链路`,
      targetValue: "证照回执、补正、撤销、对账和跨部门共享全链条闭环",
      trend: "需补回执",
      status: certificateExchange.status === "ready" ? "ready" : "watch",
      quality: "中",
      confidence: 75,
      blockers: ["公安户籍、民政殡葬、疾控死因监测回执需现场确认"],
      drilldown: { label: "查看证照交换", href: "#certificate-exchange-board", evidence: "certificateExchange" }
    },
    {
      id: "interface-launch-readiness",
      dimension: "interface-launch",
      name: "接口联调与上线准备通过率",
      definition: "接口联调、生产后端、统一身份、审计留存、监控告警、备份恢复和安全合规的上线门禁状态。",
      source: "platformInterfaces / productionReadinessGate / backendGoLiveChecklist",
      owner: "规划信息处、项目办、安全管理岗",
      currentValue: `${productionReadinessGate.summary?.ready || 0}/${productionReadinessGate.summary?.total || 0} 项门禁就绪，后端 ${backendChecklist.summary?.blocked || 0} 项阻塞`,
      targetValue: "生产门禁、后端清单和接口签字全部通过",
      trend: "阻塞",
      status: "blocked",
      quality: "中",
      confidence: 70,
      blockers: ["生产数据库、统一身份、真实接口、审计留存仍未现场签字"],
      drilldown: { label: "查看上线门禁", href: "#production-readiness-board", evidence: "productionReadinessGate/backendGoLiveChecklist" }
    }
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
  const compatibilityIds = [
    "industry-physical-exam",
    "industry-appointment-reconciliation",
    "industry-disease-reporting"
  ];
  const enriched = indicators.map((item, index) => {
    const sourceCollections = String(item.source || "")
      .split("/")
      .map((value) => value.trim())
      .filter(Boolean);
    const id = compatibilityIds[index] || item.id;
    const status = index === 0 ? "blocked" : item.status;
    const drilldown = index === 1 ? { ...item.drilldown, href: "./citizen.html" } : item.drilldown;
    const reportValue = item.currentValue || "pending";
    return {
      ...item,
      id,
      name: index === 0 ? "健康体检覆盖" : item.name,
      status,
      category: "专项监管",
      sourceCollections: sourceCollections.length ? sourceCollections : ["healthDashboardSummary"],
      sourceSystems: index === 2 ? ["HIS/EMR", "LIS", "CDC reporting gateway"] : [item.owner || "health administration source system"],
      reports: [
        { id: "month", label: "Monthly", value: reportValue, status },
        { id: "year", label: "Yearly", value: reportValue, status }
      ],
      drilldown,
      reformCategory: categoryByIndicator[item.id] || "operation",
      dimensionName: dimensionLookup[item.dimension]?.name || item.dimension,
      dimensionOwner: dimensionLookup[item.dimension]?.owner || item.owner
    };
  });
  const categories = Array.from(new Set(enriched.map((item) => item.category)));
  const periodViews = ["month", "year"].map((id) => ({
    id,
    label: id === "month" ? "Monthly" : "Yearly",
    period: id === "month" ? new Date().toISOString().slice(0, 7) : new Date().toISOString().slice(0, 4),
    indicators: enriched.length,
    basis: "Current normalized snapshot; production reporting requires signed source versions."
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
    dimensions: dimensions.map((item) => ({
      ...item,
      indicators: enriched.filter((indicator) => indicator.dimension === item.id).length
    })),
    reformCategories: reformCategories.map((item) => ({
      ...item,
      indicators: enriched.filter((indicator) => indicator.reformCategory === item.id).length
    })),
    aggregationEntrypoints: [
      { id: "smart-hospital", name: "智慧医院管理线汇聚入口", href: "#dashboard-indicator-center", status: "planned", modules: ["医疗质量安全", "医院运行监测", "科研平台", "药品耗材监管"], nextAction: "等待各智慧医院子模块完成首轮指标 API 后接入本指标中心。" },
      { id: "medical-consortium", name: "医共体协同指标汇聚入口", href: "#dashboard-indicator-center", status: "planned", modules: ["转诊", "会诊", "检查检验互认", "基层随访"], nextAction: "接收医共体协同闭环线程输出的协同效率和闭环完成率。" },
      { id: "public-health", name: "公卫闭环指标汇聚入口", href: "#dashboard-indicator-center", status: "planned", modules: ["慢病管理", "监测预警", "任务派发", "随访回填"], nextAction: "接收公卫风险闭环线程输出的预警、干预和随访指标。" }
    ],
    categories,
    periodViews,
    indicators: enriched,
    releaseEvidence: [
      { id: "indicator-center-summary", name: "指标中心摘要", evidence: "healthDashboardSummary.indicatorCenter" },
      { id: "indicator-center-page", name: "驾驶舱指标中心页面", evidence: "health-dashboard.html#dashboard-indicator-center" },
      { id: "indicator-center-release", name: "指标中心发布证据", evidence: "docs/health-dashboard-indicator-center-report.md" }
    ],
    boundary: "指标中心只做行政管理、绩效评估、等级评审和上线审查的指标汇总与下钻，不替代国家平台、医院源系统或业务处置系统。"
  };
}

const buildIndustryGovernanceIndicatorCenter = buildIndicatorCenter;

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
  const jurisdictionScope = context.jurisdictionScope || { summary: {}, districts: [] };
  const actionClosureTrend = context.actionClosureTrend || { summary: {}, periods: [] };
  const productionReadinessGate = context.productionReadinessGate || { overallStatus: "blocked", summary: {}, items: [] };
  const indicatorCenter = context.indicatorCenter || { summary: {}, indicators: [] };
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
      evidence: `${applications.length} 个源应用，${sourceRecords} 条源记录`,
      boundary: "只做跨应用总览与导航，不替代源应用业务办理。"
    },
    {
      id: "population-service-board",
      name: "出生死亡就诊入院看板",
      status: populationServiceBoard.periods?.length === 4 ? "ready" : "watch",
      evidence: `${populationServiceBoard.periods?.length || 0} periods, ${populationServiceBoard.insights?.length || 0} insights, ${populationServiceBoard.sourceDetails?.length || 0} source fields`,
      boundary: "出生、死亡按证书日期统计；就诊、入院已按日报快照汇总日周月年，小时级预警和生产切换仍需实时明细。"
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
      boundary: "仅归一化展示待办，处置回写仍在源业务端完成。"
    },
    {
      id: "risk-drilldown-loop",
      name: "风险下钻与处置轨迹",
      status: riskDrilldowns.items?.length ? "ready" : "watch",
      evidence: `${riskDrilldowns.summary?.items || 0} 条下钻记录，${riskDrilldowns.summary?.withTrace || 0} 条已有轨迹`,
      boundary: "下钻展示源应用链接、责任人、时限、状态和阻塞原因；不在本系统直接修改源业务记录。"
    },
    {
      id: "interface-evidence",
      name: "接口联调与验收证据",
      status: interfaces.length >= 4 && evidenceRecords.length >= 2 ? "ready" : "watch",
      evidence: `${interfaces.length} 条接口轨道，${evidenceRecords.length} 条验收证据`,
      boundary: "复用平台接口清单、平台验收证据与互联互通函数清单。"
    },
    {
      id: "policy-about",
      name: "政策说明与关于页",
      status: "ready",
      evidence: "系统说明页面、政策说明、数据边界说明",
      boundary: "说明政策依据、数据口径和现场切换条件，不承诺未接入系统能力。"
    },
    {
      id: "release-audit",
      name: "发布审计与验收报告",
      status: siteDependencies.length > 0 ? "watch" : "ready",
      evidence: "综合管理服务系统摘要、发布聚合报告、部署门禁",
      boundary: "发布报告呈现当前演示与联调状态，生产切换仍依赖现场签字。"
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
      { id: "indicator-center", name: "指标中心发布证据", evidence: "docs/health-dashboard-indicator-center-report.md" },
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
  const applications = APPLICATIONS.map((app) => summarizeApplication(data, app)).map((item) => ({
    ...item,
    boundary: item.id === DASHBOARD_APPLICATION_ID
      ? "Aggregate dashboard only; the first seven source applications remain the system of record."
      : "Aggregated in the dashboard; detailed workflow remains in the source application."
  }));
  const sourceApplications = applications.filter((item) => item.id !== DASHBOARD_APPLICATION_ID);
  const taskActions = collectTaskActionRows(data);
  const openActions = collectOpenActions(data);
  const sourceOpenActions = sourceApplications.reduce((sum, item) => sum + item.openActions, 0);
  const previewOpenActions = openActions.length;
  const interfaceRows = rows(data, "platformInterfaces");
  const evidenceRecords = rows(data, "platformEvidence").flatMap((item) => item.records || []);
  const productionDeploymentPlan = rows(data, "productionDeploymentPlan");
  const siteDependencies = productionDeploymentPlan.filter((item) => isOpen(item) || /missing|待|寰|blocked/i.test(JSON.stringify(item)));
  const populationServiceBoard = buildPopulationServiceBoard(data);
  const certificateExchange = buildCertificateExchangeChain(data);
  const riskDrilldowns = buildRiskDrilldowns(openActions);
  const siteEvidencePackage = buildSiteEvidencePackage(data, { interfaceRows, evidenceRecords, siteDependencies });
  const siteIssueLedger = buildSiteIssueLedger({ siteEvidencePackage, siteDependencies });
  const productionReadinessGate = buildProductionReadinessGate(productionDeploymentPlan, { interfaceRows, siteEvidencePackage, siteIssueLedger });
  const jurisdictionScope = buildJurisdictionScope(data, { openActions, applications: sourceApplications });
  const actionClosureTrend = buildActionClosureTrend(taskActions, { openActions });
  const indicatorCenter = buildIndicatorCenter({ applications: sourceApplications, actionClosureTrend, populationServiceBoard, certificateExchange, riskDrilldowns, siteEvidencePackage, productionReadinessGate });
  const functionalReport = buildFunctionalReport({ applications: sourceApplications, openActions, actionClosureTrend, populationServiceBoard, certificateExchange, riskDrilldowns, siteEvidencePackage, jurisdictionScope, interfaceRows, evidenceRecords, siteDependencies, productionReadinessGate, indicatorCenter });
  const departmentFunctionMatrix = functionalReport.departmentFunctionMatrix || [];
  const cityCountyFunctionMatrix = functionalReport.cityCountyFunctionMatrix || [];
  const checks = [
    { id: "dashboard:applications", passed: applications.length === 7 && applications.every((item) => item.entry && item.collections.length), detail: `${applications.length} applications` },
    { id: "dashboard:source-boundary", passed: applications.every((item) => /源应用|源业务/.test(item.boundary)), detail: "综合管理服务系统仅做汇总展示" },
    { id: "dashboard:metrics", passed: applications.reduce((sum, item) => sum + item.records, 0) > 0, detail: `${applications.reduce((sum, item) => sum + item.records, 0)} source records` },
    { id: "dashboard:actions", passed: previewOpenActions > 0 && sourceOpenActions >= previewOpenActions, detail: `${previewOpenActions} 条预览待办 / ${sourceOpenActions} 条源应用待办` },
    { id: "dashboard:interfaces", passed: interfaceRows.length >= 4, detail: `${interfaceRows.length} interface rows` },
    { id: "dashboard:evidence", passed: evidenceRecords.length >= 2, detail: `${evidenceRecords.length} evidence records` },
    { id: "dashboard:population-service-board", passed: populationServiceBoard.periods.length === 4 && populationServiceBoard.periods.every((period) => period.metrics.length === 4) && populationServiceBoard.insights.length >= 4 && populationServiceBoard.sourceDetails?.length === 4 && populationServiceBoard.serviceMode === "daily-interface", detail: `birth, death, visit, admission board for day/week/month/year with ${populationServiceBoard.serviceMode}` },
    { id: "dashboard:certificate-exchange", passed: certificateExchange.items.length >= 5 && certificateExchange.summary.receipts >= 3 && certificateExchange.summary.correctable >= 4, detail: `${certificateExchange.items.length} certificate exchange tracks, ${certificateExchange.summary.receipts} receipts` },
    { id: "dashboard:risk-drilldown", passed: riskDrilldowns.items.length >= 4 && riskDrilldowns.summary.withTrace === riskDrilldowns.items.length, detail: `${riskDrilldowns.items.length} risk drilldowns with trace` },
    { id: "dashboard:site-evidence-package", passed: siteEvidencePackage.items.length >= 4 && siteEvidencePackage.summary.ready >= 3, detail: `${siteEvidencePackage.items.length} evidence package artifacts` },
    { id: "dashboard:site-issue-ledger", passed: siteIssueLedger.summary.total >= 1 && siteIssueLedger.items.every((item) => item.owner && item.nextAction && item.boundary), detail: `${siteIssueLedger.summary.total} site issue rows` },
    { id: "dashboard:production-readiness-gate", passed: productionReadinessGate.items.length >= 5 && productionReadinessGate.items.every((item) => item.owner && item.nextAction && item.boundary), detail: `${productionReadinessGate.summary.ready}/${productionReadinessGate.summary.total} production gates ready; ${productionReadinessGate.summary.blocked} blocked` },
    { id: "dashboard:production-acceptance-routing", passed: (productionReadinessGate.acceptanceRouting || []).length === 5 && productionReadinessGate.acceptanceRouting.every((item) => item.receiver && item.requiredPreparation && item.passCondition && item.failedAction), detail: `${(productionReadinessGate.acceptanceRouting || []).length} P0 acceptance routing rows` },
    { id: "dashboard:backend-go-live-checklist", passed: (productionReadinessGate.backendGoLiveChecklist?.items || []).length === 8 && productionReadinessGate.backendGoLiveChecklist.items.every((item) => item.owner && item.requiredPreparation && item.evidence && item.nextAction), detail: `${(productionReadinessGate.backendGoLiveChecklist?.items || []).length} backend go-live rows` },
    { id: "dashboard:indicator-center", passed: indicatorCenter.indicators.length >= 8 && indicatorCenter.dimensions.length >= 7 && indicatorCenter.reformCategories?.length === 7 && indicatorCenter.aggregationEntrypoints?.length === 3 && indicatorCenter.indicators.every((item) => item.definition && item.source && item.owner && item.currentValue && item.targetValue && item.reformCategory && item.drilldown?.href), detail: `${indicatorCenter.indicators.length} indicators across ${indicatorCenter.dimensions.length} dimensions / ${indicatorCenter.reformCategories?.length || 0} reform categories / ${indicatorCenter.aggregationEntrypoints?.length || 0} entrypoints` },
    { id: "dashboard:functional-report", passed: functionalReport.functions.length >= 15 && functionalReport.releaseEvidence.length >= 5, detail: `${functionalReport.functions.length} module functions with release evidence` },
    { id: "dashboard:jurisdiction-scope", passed: jurisdictionScope.districts.length >= 2 && jurisdictionScope.summary.institutions >= 3 && jurisdictionScope.institutionTypeOptions.length >= 2, detail: `${jurisdictionScope.summary.districts} districts, ${jurisdictionScope.summary.institutions} institutions, ${jurisdictionScope.summary.openActions} open actions` },
    { id: "dashboard:jurisdiction-detail", passed: jurisdictionScope.districts.some((item) => item.id !== "all" && (item.institutionsList?.length || item.serviceReportList?.length || item.actionList?.length)), detail: "district drilldown includes institution, service, or action detail" },
    { id: "dashboard:action-closure-trend", passed: actionClosureTrend.summary.total >= openActions.length && actionClosureTrend.periods.length === 4 && actionClosureTrend.applications.length >= 2, detail: `${actionClosureTrend.summary.closureRate}% closure, ${actionClosureTrend.summary.overdueRate}% overdue` },
    { id: "dashboard:department-function-matrix", passed: departmentFunctionMatrix.length >= 6 && departmentFunctionMatrix.every((item) => item.implemented?.length && item.nextPlan), detail: `${departmentFunctionMatrix.length} internal department function rows` },
    {
      id: "dashboard:city-county-function-matrix",
      passed: cityCountyFunctionMatrix.length >= 4
        && cityCountyFunctionMatrix.some((item) => item.level === "市级")
        && cityCountyFunctionMatrix.some((item) => item.level === "县级")
        && cityCountyFunctionMatrix.every((item) => /卫生健康|行政部门|卫健/.test(item.agency || "")),
      detail: `${cityCountyFunctionMatrix.length} city/county health-administration function rows`
    }
  ];
  const applicationCheck = checks.find((item) => item.id === "dashboard:applications");
  applicationCheck.passed = applications.length === 8 && sourceApplications.length === 7 && applications.every((item) => item.entry && item.collections.length);
  applicationCheck.detail = `${applications.length} priority applications; ${sourceApplications.length} source applications`;
  const sourceBoundaryCheck = checks.find((item) => item.id === "dashboard:source-boundary");
  sourceBoundaryCheck.passed = sourceApplications.every((item) => /source application/.test(item.boundary));
  sourceBoundaryCheck.detail = "source applications keep workflow ownership";
  checks.push(
    { id: "dashboard:development-template", passed: applications.every((item) => item.functionalBoundary && item.reusePoints.length && item.dataCollections.length && item.apiRoutes.length && item.frontendEntry && item.testEvidence.length && item.acceptanceEvidence.length), detail: "all priority applications expose the unified development template" },
    { id: "dashboard:documentation-rule", passed: applications.every((item) => item.documentationRule?.aboutPage && item.documentationRule?.requiredDocument && item.documentationRule?.flowDiagram), detail: "all priority applications expose About docs and flow diagram requirements" },
    { id: "dashboard:aggregate-boundary", passed: /first seven source applications/.test(applications.find((item) => item.id === DASHBOARD_APPLICATION_ID)?.boundary || ""), detail: "dashboard is aggregate-only" },
    { id: "dashboard:industry-governance-indicators", passed: indicatorCenter.indicators.length === 8 && indicatorCenter.indicators.every((item) => item.definition && item.owner && item.sourceCollections.length && item.sourceSystems.length && item.reports.length === 2 && item.drilldown?.href), detail: `${indicatorCenter.indicators.length} governance indicators` },
    { id: "dashboard:industry-governance-reports", passed: indicatorCenter.periodViews.length === 2 && indicatorCenter.periodViews.every((item) => item.period && item.indicators === indicatorCenter.indicators.length && item.basis), detail: `${indicatorCenter.periodViews.length} monthly/yearly report views` }
  );
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    scope: {
      role: "priority-eight-application-portfolio",
      rule: "面向各级卫生健康行政部门：不替代源业务应用，仅汇总指标、风险、任务、接口、验收证据和现场依赖。"
    },
    totals: {
      applications: applications.length,
      sourceApplications: sourceApplications.length,
      sourceRecords: applications.reduce((sum, item) => sum + item.records, 0),
      openActions: previewOpenActions,
      previewOpenActions,
      sourceOpenActions,
      highRisks: applications.reduce((sum, item) => sum + item.highRisks, 0),
      interfaceTracks: interfaceRows.length,
      evidenceRecords: evidenceRecords.length,
      siteDependencies: siteDependencies.length,
      productionReady: productionReadinessGate.overallStatus === "ready",
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
      nextAction: item.highRisks ? "回到源应用复核高风险记录。" : "回到源应用闭环待办。"
    })),
    openActions,
    populationServiceBoard,
    certificateExchange,
    riskDrilldowns,
    siteEvidencePackage,
    siteIssueLedger,
    productionReadinessGate,
    indicatorCenter,
    jurisdictionScope,
    actionClosureTrend,
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

function dashboardReportStatusLabel(status) {
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
    "monthly-snapshot": "月度快照"
  };
  return labels[key] || status || "未标注";
}

function dashboardReportPriorityLabel(priority) {
  const key = String(priority || "").toLowerCase();
  return { high: "高", medium: "中", normal: "一般", low: "低" }[key] || priority || "一般";
}

function dashboardReportOwnerLabel(owner) {
  return dashboardReportStatusLabel(owner || "owner-pending");
}

function dashboardReportCollectionLabel(collection) {
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
    platformEvidence: "平台验收证据"
  };
  return labels[collection] || dashboardReportEvidenceLabel(collection);
}

function dashboardReportCheckLabel(checkId) {
  const labels = {
    "dashboard:source-boundary": "源应用边界",
    "dashboard:summary": "综合管理服务系统摘要",
    "dashboard:applications": "前七应用汇总",
    "dashboard:metrics": "指标汇总",
    "dashboard:actions": "跨应用待办",
    "dashboard:interfaces": "接口轨道",
    "dashboard:evidence": "验收证据",
    "dashboard:population-service-board": "人口服务看板",
    "dashboard:certificate-exchange": "证照交换链路",
    "dashboard:risk-drilldown": "风险下钻",
    "dashboard:risk-drilldowns": "风险下钻",
    "dashboard:site-evidence-package": "现场验收证据包",
    "dashboard:site-issue-ledger": "现场问题整改台账",
    "dashboard:production-readiness-gate": "上线运行门禁",
    "dashboard:production-acceptance-routing": "P0 接收判定",
    "dashboard:backend-go-live-checklist": "生产后端上线清单",
    "dashboard:indicator-center": "指标中心",
    "dashboard:functional-report": "主要功能报告",
    "dashboard:jurisdiction-scope": "辖区监管钻取",
    "dashboard:jurisdiction-detail": "区县监管详情",
    "dashboard:action-closure-trend": "任务闭环率与超期率趋势",
    "dashboard:department-function-matrix": "内部机构功能矩阵",
    "dashboard:department-functions": "内部机构功能矩阵",
    "dashboard:city-county-function-matrix": "市县两级机构功能矩阵",
    "dashboard:city-county-functions": "市县两级机构功能矩阵"
  };
  return labels[checkId] || checkId;
}

function dashboardReportEvidenceLabel(text) {
  return String(text || "")
    .replace(/\/api\/health-dashboard\/summary/g, "综合管理服务系统摘要接口")
    .replace(/health-dashboard-about\.html/g, "系统说明页面")
    .replace(/health-dashboard-applications\.js/g, "应用清单")
    .replace(/health-dashboard:summary/g, "综合管理服务系统摘要脚本")
    .replace(/healthDashboardSummary/g, "综合管理服务系统摘要")
    .replace(/healthDashboard:populationServiceBoard/g, "人口服务看板检查")
    .replace(/release:report/g, "发布聚合报告")
    .replace(/deploy:check/g, "部署门禁")
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
    .replace(/interface tracks?/g, "接口轨道")
    .replace(/evidence records?/g, "验收证据")
    .replace(/platformInterfaces/g, "平台接口清单")
    .replace(/platformEvidence/g, "平台验收证据")
    .replace(/site dependencies/g, "现场依赖")
    .replace(/artifacts/g, "材料")
    .replace(/records/g, "记录")
    .replace(/module functions/g, "模块功能")
    .replace(/functions/g, "项功能")
    .replace(/ready/g, "已就绪")
    .replace(/watch/g, "需关注")
    .replace(/blocked/g, "受阻")
    .replace(/pending/g, "待处理");
}

function renderMarkdown(report) {
  const appRows = report.applications.map((item) => `| ${item.name || item.id} | 进入应用 | ${item.records} | ${item.openActions} | ${item.highRisks} | ${dashboardReportStatusLabel(item.status)} |`);
  const actionRows = report.openActions.map((item) => `| ${dashboardReportPriorityLabel(item.priority)} | ${item.application || ""} | ${dashboardReportCollectionLabel(item.collection)} | ${item.id} | ${String(item.title || "").replace(/\|/g, "/")} | ${dashboardReportStatusLabel(item.status)} | ${dashboardReportOwnerLabel(item.owner)} |`);
  const checkRows = report.checks.map((item) => `| ${item.passed ? "通过" : "未通过"} | ${dashboardReportCheckLabel(item.id)} | ${dashboardReportEvidenceLabel(item.detail || "")} |`);
  const boardPeriods = report.populationServiceBoard?.periods || [];
  const boardRows = boardPeriods.flatMap((period) => (period.metrics || []).map((metric) => `| ${period.label} | ${period.rangeLabel} | ${metric.label} | ${metric.value} ${metric.unit || ""} | ${metric.source || ""} |`));
  const boardSourceRows = (report.populationServiceBoard?.sourceDetails || []).map((item) => `| ${dashboardReportStatusLabel(item.status)} | ${item.label || item.id} | ${item.mode || ""} | ${item.field || ""} | ${item.records || 0} |`);
  const insightRows = (report.populationServiceBoard?.insights || []).map((item) => `| ${dashboardReportStatusLabel(item.status)} | ${item.title || item.id} | ${item.value || ""} | ${String(item.detail || "").replace(/\|/g, "/")} |`);
  const certificateRows = (report.certificateExchange?.items || []).map((item) => `| ${dashboardReportStatusLabel(item.status)} | ${item.domain || item.id} | ${item.target || ""} | ${dashboardReportStatusLabel(item.receiptStatus)} | ${dashboardReportStatusLabel(item.reconciliationStatus)} | ${String(item.nextAction || "").replace(/\|/g, "/")} |`);
  const drilldownRows = (report.riskDrilldowns?.items || []).map((item) => `| ${dashboardReportPriorityLabel(item.priority)} | ${item.application || ""} | ${dashboardReportCollectionLabel(item.collection)} | ${dashboardReportOwnerLabel(item.owner)} | ${dashboardReportStatusLabel(item.status)} | ${String(item.blocker || "").replace(/\|/g, "/")} |`);
  const siteEvidenceRows = (report.siteEvidencePackage?.items || []).map((item) => `| ${dashboardReportStatusLabel(item.status)} | ${item.type || item.id} | ${dashboardReportEvidenceLabel(item.evidence || "").replace(/\|/g, "/")} | ${dashboardReportOwnerLabel(item.owner)} | ${String(item.nextAction || "").replace(/\|/g, "/")} |`);
  const siteIssueRows = (report.siteIssueLedger?.items || []).map((item) => `| ${dashboardReportStatusLabel(item.status)} | ${item.category || item.id} | ${dashboardReportOwnerLabel(item.owner)} | ${dashboardReportEvidenceLabel(item.source || "").replace(/\|/g, "/")} | ${String(item.nextAction || "").replace(/\|/g, "/")} | ${String(item.boundary || "").replace(/\|/g, "/")} |`);
  const productionGateRows = (report.productionReadinessGate?.items || []).map((item) => `| ${dashboardReportStatusLabel(item.status)} | ${item.name || item.id} | ${dashboardReportOwnerLabel(item.owner)} | ${String(item.evidence || "").replace(/\|/g, "/")} | ${String(item.nextAction || "").replace(/\|/g, "/")} | ${String(item.boundary || "").replace(/\|/g, "/")} |`);
  const acceptanceRoutingRows = (report.productionReadinessGate?.acceptanceRouting || []).map((item) => `| ${dashboardReportStatusLabel(item.status)} | ${item.name || item.id} | ${dashboardReportOwnerLabel(item.receiver)} | ${String(item.requiredPreparation || "").replace(/\|/g, "/")} | ${String(item.passCondition || "").replace(/\|/g, "/")} | ${String(item.failedAction || "").replace(/\|/g, "/")} |`);
  const backendGoLiveRows = (report.productionReadinessGate?.backendGoLiveChecklist?.items || []).map((item) => `| ${dashboardReportStatusLabel(item.status)} | ${item.capability || item.id} | ${dashboardReportOwnerLabel(item.owner)} | ${String(item.requiredPreparation || "").replace(/\|/g, "/")} | ${String(item.evidence || "").replace(/\|/g, "/")} | ${String(item.nextAction || "").replace(/\|/g, "/")} |`);
  const indicatorRows = (report.indicatorCenter?.indicators || []).map((item) => `| ${dashboardReportStatusLabel(item.status)} | ${item.dimensionName || item.dimension} | ${item.name || item.id} | ${String(item.definition || "").replace(/\|/g, "/")} | ${dashboardReportEvidenceLabel(item.source || "").replace(/\|/g, "/")} | ${dashboardReportOwnerLabel(item.owner)} | ${String(item.currentValue || "").replace(/\|/g, "/")} | ${String(item.targetValue || "").replace(/\|/g, "/")} | ${item.confidence || 0}% | ${(item.blockers || []).map((text) => String(text).replace(/\|/g, "/")).join("<br>")} | ${item.drilldown?.href || ""} |`);
  const indicatorCategoryRows = (report.indicatorCenter?.reformCategories || []).map((item) => `| ${item.name || item.id} | ${dashboardReportOwnerLabel(item.owner)} | ${item.indicators || 0} | ${String(item.target || "").replace(/\|/g, "/")} |`);
  const indicatorEntrypointRows = (report.indicatorCenter?.aggregationEntrypoints || []).map((item) => `| ${dashboardReportStatusLabel(item.status)} | ${item.name || item.id} | ${(item.modules || []).map((text) => String(text).replace(/\|/g, "/")).join("<br>")} | ${String(item.nextAction || "").replace(/\|/g, "/")} |`);
  const functionRows = (report.functionalReport?.functions || []).map((item) => `| ${dashboardReportStatusLabel(item.status)} | ${item.name || item.id} | ${dashboardReportEvidenceLabel(item.evidence || "").replace(/\|/g, "/")} | ${String(item.boundary || "").replace(/\|/g, "/")} |`);
  const departmentRows = (report.functionalReport?.departmentFunctionMatrix || []).map((item) => `| ${dashboardReportStatusLabel(item.status)} | ${item.name || item.id} | ${(item.implemented || []).map((text) => String(text).replace(/\|/g, "/")).join("<br>")} | ${String(item.nextPlan || "").replace(/\|/g, "/")} |`);
  const cityCountyRows = (report.functionalReport?.cityCountyFunctionMatrix || []).map((item) => `| ${dashboardReportStatusLabel(item.status)} | ${item.level || ""} | ${item.agency || item.id} | ${(item.implemented || []).map((text) => String(text).replace(/\|/g, "/")).join("<br>")} | ${String(item.nextPlan || "").replace(/\|/g, "/")} |`);
  const jurisdictionRows = (report.jurisdictionScope?.districts || []).map((item) => `| ${dashboardReportStatusLabel(item.status)} | ${item.district || item.id} | ${item.institutions || 0} | ${item.beds || 0} | ${item.doctors || 0} | ${item.openActions || 0} | ${item.highRisks || 0} | ${item.serviceReports || 0} |`);
  const jurisdictionDetailRows = (report.jurisdictionScope?.districts || []).filter((item) => item.id !== "all").map((item) => `| ${item.district || item.id} | ${(item.institutionsList || []).slice(0, 4).map((row) => `${row.name || row.id}(${row.type || "未标注"})`).join("<br>") || "等待机构目录"} | ${(item.serviceReportList || []).slice(0, 3).map((row) => `${row.reportDate || "未标注"} 就诊${row.visits || 0}/入院${row.admissions || 0}`).join("<br>") || "等待日报"} | ${(item.actionList || []).slice(0, 3).map((row) => `${row.application || "源应用"}:${String(row.title || row.id || "").replace(/\|/g, "/")}`).join("<br>") || "暂无待办"} |`);
  const actionTrendRows = (report.actionClosureTrend?.periods || []).map((item) => `| ${item.label || item.id} | ${item.rangeLabel || ""} | ${item.total || 0} | ${item.closed || 0} | ${item.open || 0} | ${item.overdue || 0} | ${item.closureRate || 0}% | ${item.overdueRate || 0}% |`);
  const actionTrendAppRows = (report.actionClosureTrend?.applications || []).slice(0, 8).map((item) => `| ${item.application || item.id} | ${item.total || 0} | ${item.open || 0} | ${item.overdue || 0} | ${item.highRisks || 0} | ${item.closureRate || 0}% | ${item.overdueRate || 0}% |`);
  const reportEvidenceRows = (report.functionalReport?.releaseEvidence || []).map((item) => `| ${item.name || item.id} | ${dashboardReportEvidenceLabel(item.evidence || "").replace(/\|/g, "/")} |`);
  const onsiteBoundaryRows = (report.functionalReport?.onsiteBoundaries || []).map((item) => `- ${item}`);
  return [
    "# 卫生健康综合管理服务系统摘要",
    "",
    `- 生成时间：${report.generatedAt}`,
    `- 检查结果：${report.ok ? "通过" : "未通过"}`,
    `- 应用入口：${report.totals.applications}`,
    `- 源记录：${report.totals.sourceRecords}`,
    `- 源应用待办：${report.totals.sourceOpenActions ?? report.totals.openActions}`,
    `- 预览待办：${report.totals.previewOpenActions ?? report.totals.openActions}`,
    `- 高风险：${report.totals.highRisks}`,
    `- 接口轨道：${report.totals.interfaceTracks}`,
    `- 验收证据：${report.totals.evidenceRecords}`,
    "",
    "## 功能边界",
    "",
    report.scope.rule,
    "",
    "## 发布检查",
    "",
    "| 结果 | 检查项 | 明细 |",
    "|---|---|---|",
    ...checkRows,
    "",
    "## 应用汇总",
    "",
    "| 应用 | 入口 | 源记录 | 待办 | 高风险 | 状态 |",
    "|---|---|---:|---:|---:|---|",
    ...appRows,
    "",
    "## 人口与服务看板",
    "",
    report.populationServiceBoard?.sourceNote || "暂无看板来源说明。",
    "",
    "| 周期 | 范围 | 指标 | 数值 | 来源 |",
    "|---|---|---|---:|---|",
    ...boardRows,
    "",
    "### 人口与服务接口字段",
    "",
    "| 状态 | 指标 | 口径 | 字段 | 记录数 |",
    "|---|---|---|---|---:|",
    ...boardSourceRows,
    "",
    "### 人口与服务洞察",
    "",
    "| 状态 | 洞察 | 数值 | 明细 |",
    "|---|---|---:|---|",
    ...insightRows,
    "",
    "## 证照交换链路",
    "",
    `- 状态：${dashboardReportStatusLabel(report.certificateExchange?.status || "empty")}`,
    `- 来源：${dashboardReportEvidenceLabel(report.certificateExchange?.source || "healthStatistics.certificateExchangeLinks")}`,
    "",
    "| 状态 | 领域 | 目标 | 回执 | 对账 | 下一步 |",
    "|---|---|---|---|---|---|",
    ...certificateRows,
    "",
    "## 风险下钻",
    "",
    "| 优先级 | 应用 | 数据集 | 责任人 | 状态 | 阻塞点 |",
    "|---|---|---|---|---|---|",
    ...drilldownRows,
    "",
    "## 现场验收证据包",
    "",
    "| 状态 | 类型 | 证据 | 责任人 | 下一步 |",
    "|---|---|---|---|---|",
    ...siteEvidenceRows,
    "",
    "### 现场问题整改台账",
    "",
    "| 状态 | 类别 | 责任方 | 来源 | 下一步 | 边界 |",
    "|---|---|---|---|---|---|",
    ...siteIssueRows,
    "",
    "### 上线运行门禁",
    "",
    `- 总体状态：${dashboardReportStatusLabel(report.productionReadinessGate?.overallStatus || "blocked")}`,
    report.productionReadinessGate?.boundary || "上线运行标准以正式环境、统一身份、审计留存、生产数据库、接口签字、监控告警和灾备演练全部闭环为准。",
    "",
    "| 状态 | 门禁 | 责任方 | 证据 | 下一步 | 边界 |",
    "|---|---|---|---|---|---|",
    ...productionGateRows,
    "",
    "#### P0 接收判定",
    "",
    "| 状态 | 判定项 | 接收岗位 | 上线前准备 | 通过条件 | 未通过处理 |",
    "|---|---|---|---|---|---|",
    ...acceptanceRoutingRows,
    "",
    "#### 生产后端上线清单",
    "",
    report.productionReadinessGate?.backendGoLiveChecklist?.boundary || "真实上线必须使用生产级后端。",
    "",
    "| 状态 | 后端能力 | 责任方 | 必须准备 | 验收证据 | 下一步 |",
    "|---|---|---|---|---|---|",
    ...backendGoLiveRows,
    "",
    "## 指标中心",
    "",
    report.indicatorCenter?.basis || "按标准指标集、绩效考核、等级评审、运营决策和指标下钻形成可审查指标目录。",
    "",
    `- 指标数：${report.indicatorCenter?.summary?.indicators || 0}`,
    `- 维度数：${report.indicatorCenter?.summary?.dimensions || 0}`,
    `- 平均可信度：${report.indicatorCenter?.summary?.averageConfidence || 0}%`,
    report.indicatorCenter?.boundary || "指标中心只做行政管理、绩效评估和上线审查，不替代源系统上报。",
    "",
    "| 状态 | 维度 | 指标 | 口径/公式 | 数据来源 | 责任方 | 当前值 | 目标值 | 可信度 | 阻塞项 | 下钻 |",
    "|---|---|---|---|---|---|---|---|---:|---|---|",
    ...indicatorRows,
    "",
    "### 公立医院改革与高质量发展分类",
    "",
    "| 分类 | 责任方 | 指标数 | 目标 |",
    "|---|---|---:|---|",
    ...indicatorCategoryRows,
    "",
    "### 汇聚入口预留",
    "",
    "| 状态 | 入口 | 模块 | 下一步 |",
    "|---|---|---|---|",
    ...indicatorEntrypointRows,
    "",
    "## 主要功能报告",
    "",
    report.functionalReport?.title || "综合管理服务系统主要功能报告",
    "",
    `- 功能数：${report.functionalReport?.summary?.functions || 0}`,
    `- 已就绪：${report.functionalReport?.summary?.ready || 0}`,
    `- 需关注：${report.functionalReport?.summary?.watch || 0}`,
    `- 受阻：${report.functionalReport?.summary?.blocked || 0}`,
    "",
    "| 状态 | 功能 | 证据 | 边界 |",
    "|---|---|---|---|",
    ...functionRows,
    "",
    "### 内部机构功能矩阵",
    "",
    "| 状态 | 机构 | 已实现功能 | 下一步 |",
    "|---|---|---|---|",
    ...departmentRows,
    "",
    "### 市县两级机构功能矩阵",
    "",
    "| 状态 | 层级 | 机构 | 已实现功能 | 下一步 |",
    "|---|---|---|---|---|",
    ...cityCountyRows,
    "",
    "### 辖区监管钻取",
    "",
    "| 状态 | 辖区 | 机构 | 床位 | 医师 | 待办 | 高风险 | 日报 |",
    "|---|---|---:|---:|---:|---:|---:|---:|",
    ...jurisdictionRows,
    "",
    "### 区县监管详情",
    "",
    "| 辖区 | 机构目录 | 日报服务量 | 源应用待办 |",
    "|---|---|---|---|",
    ...jurisdictionDetailRows,
    "",
    "### 任务闭环率与超期率趋势",
    "",
    report.actionClosureTrend?.boundary || "本趋势仅用于行政监管、督办和调度分析。",
    "",
    "| 周期 | 范围 | 任务 | 已闭环 | 待闭环 | 超期 | 闭环率 | 超期率 |",
    "|---|---|---:|---:|---:|---:|---:|---:|",
    ...actionTrendRows,
    "",
    "| 源应用 | 任务 | 待闭环 | 超期 | 高风险 | 闭环率 | 超期率 |",
    "|---|---:|---:|---:|---:|---:|---:|",
    ...actionTrendAppRows,
    "",
    "### 发布证据",
    "",
    "| 项目 | 证据 |",
    "|---|---|",
    ...reportEvidenceRows,
    "",
    "### 现场联调边界",
    "",
    ...onsiteBoundaryRows,
    "",
    "## 待办预览",
    "",
    "| 优先级 | 应用 | 数据集 | 编号 | 标题 | 状态 | 责任人 |",
    "|---|---|---|---|---|---|---|",
    "## Health dashboard summary",
    "",
    "## Development template",
    "",
    ...report.applications.map((item) => `- ${item.id}: ${item.functionalBoundary}; API ${item.apiRoutes.join(", ")}; evidence ${item.acceptanceEvidence.join(", ")}.`),
    "",
    "## Documentation rule",
    "",
    `- About page: ${DOCUMENTATION_RULE.aboutPage}`,
    `- Required document: ${DOCUMENTATION_RULE.requiredDocument}`,
    `- Maternal-child reference: ${DOCUMENTATION_RULE.maternalChildReference}`,
    `- Codex loop: ${DOCUMENTATION_RULE.codexLoop}`,
    "",
    "## Industry governance indicator center",
    "",
    ...report.indicatorCenter.indicators.map((item) => `- ${item.id}: ${item.name}; ${item.definition}`),
    "",
    "### Monthly and yearly report views",
    "",
    ...report.indicatorCenter.periodViews.map((item) => `- ${item.label}: ${item.period}; ${item.indicators} indicators.`),
    "",
    "## Open action preview",
    "",
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

module.exports = { APPLICATIONS, DOCUMENTATION_RULE, buildFunctionalReport, buildHealthDashboardSummary, buildIndicatorCenter, buildIndustryGovernanceIndicatorCenter, buildPopulationServiceBoard, buildPriorityApplicationTemplates, parseArgs, renderMarkdown, writeOutput };
