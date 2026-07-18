#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "health-dashboard-summary.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "health-dashboard-summary.md");

const SOURCE_APPLICATIONS = [
  {
    id: "regional-data-sharing",
    name: "Regional diagnosis data sharing",
    conversationTitle: "区域诊疗数据共享平台",
    entry: "regional-data-sharing.html",
    owner: "commission",
    collections: ["residents", "personalRecords", "diagnosticReports", "integrationContracts", "dataAccessLogs", "platformInterfaces"],
    functionalBoundary: "Share regional diagnosis and treatment data, authorization evidence, report lookup, and access review without becoming the clinical source system.",
    reusePoints: ["resident master index", "personal health records", "diagnostic reports", "integration contracts", "audit logs"],
    apiRoutes: ["GET /api/regional-data-sharing", "POST /api/regional-data-sharing/access-reviews"],
    testEvidence: ["test/static.test.js regional-data-sharing checks", "regional-data-sharing:report"],
    acceptanceEvidence: ["regional-data-sharing-report.json", "regional-data-sharing-report.md"]
  },
  {
    id: "referral-teleconsultation",
    name: "Referral and teleconsultation",
    conversationTitle: "医联体转诊与远程会诊平台",
    entry: "county.html",
    owner: "medical-services",
    collections: ["referralSystem", "referrals", "referralTeleconsultations", "careOrders", "countyCollaborationOrders", "countyAcceptanceLedger"],
    functionalBoundary: "Coordinate referral, remote consultation, receiving feedback, report return, resident authorization, and consortium performance evidence.",
    reusePoints: ["county consortium workflows", "care orders", "collaboration orders", "resident authorization", "acceptance ledger"],
    apiRoutes: ["GET /api/referral-teleconsultations", "POST /api/referral-teleconsultations", "POST /api/referral-teleconsultations/:id/actions"],
    testEvidence: ["test/referral-teleconsultation-readiness.test.js", "referral:readiness"],
    acceptanceEvidence: ["referral-teleconsultation-readiness-report.json", "referral-teleconsultation-readiness-report.md"]
  },
  {
    id: "quality-safety",
    name: "Medical quality and safety supervision",
    conversationTitle: "医疗质量与安全监管平台",
    entry: "quality-safety.html",
    owner: "quality-office",
    collections: ["diagnosticReports", "countyMutualRecognitionRecords", "dataQualityIssues", "institutionCreditEvaluations", "securityEvents", "hospitalInteroperabilityFunctions"],
    functionalBoundary: "Supervise quality events, critical values, clinical pathway evidence, mutual-recognition quality control, dispatch, feedback, and review.",
    reusePoints: ["diagnostic reports", "mutual-recognition records", "data-quality issues", "institution credit evaluation", "security audit events"],
    apiRoutes: ["GET /api/quality-safety/dashboard", "POST /api/quality-safety/issues/:id/dispatch", "POST /api/quality-safety/rectifications/:id/feedback", "POST /api/quality-safety/rectifications/:id/review"],
    testEvidence: ["test/quality-safety-report.test.js", "quality-safety:report"],
    acceptanceEvidence: ["quality-safety-report.json", "quality-safety-report.md"]
  },
  {
    id: "operations-dispatch",
    name: "Hospital operations and resource dispatch",
    conversationTitle: "医院运行监测与资源调度平台",
    entry: "operations.html",
    owner: "operations",
    collections: ["healthStatistics", "healthStatisticsIngestion", "medicalResources", "platformProcessAudit", "operationsReadiness"],
    functionalBoundary: "Monitor hospital operation indicators and coordinate resource dispatch, alert handling, and statistics reconciliation.",
    reusePoints: ["health statistics", "statistics ingestion", "medical resources", "platform process audit", "runtime metrics"],
    apiRoutes: ["GET /api/operations/dashboard", "POST /api/operations/dispatch", "POST /api/operations/reconciliation/:id/review"],
    testEvidence: ["test/hospital-operations-readiness.test.js", "operations:readiness"],
    acceptanceEvidence: ["hospital-operations-readiness-report.json", "hospital-operations-readiness-report.md"]
  },
  {
    id: "drug-consumable-supervision",
    name: "Drug, consumable, and rational medication supervision",
    conversationTitle: "药品耗材与合理用药监管平台",
    entry: "insurance.html",
    owner: "insurance-and-institution",
    collections: ["drugConsumableSupervisions", "medicationPickups", "insuranceClaims", "institutionSupervisions", "integrationContracts"],
    functionalBoundary: "Regulate rational medication, prescription review, fixed pickup, high-value consumable clues, insurance settlement, and remediation loops.",
    reusePoints: ["drug and consumable supervision records", "medication pickup records", "insurance claims", "institution supervision", "integration contracts"],
    apiRoutes: ["GET /api/drug-consumable-supervision", "POST /api/drug-consumable-supervision/:id/review", "POST /api/drug-consumable-supervision/:id/remediation", "POST /api/drug-consumable-supervision/:id/insurance-sync"],
    testEvidence: ["test/drug-consumable-readiness.test.js", "drug-consumable:readiness"],
    acceptanceEvidence: ["drug-consumable-readiness-report.json", "drug-consumable-readiness-report.md"]
  },
  {
    id: "chronic-followup",
    name: "Chronic disease management and post-discharge follow-up",
    conversationTitle: "慢病管理与院后随访平台",
    entry: "index.html",
    owner: "primary-care",
    collections: ["chronicScreeningTasks", "chronicManagementPlans", "followups", "personalRecords", "medicationPickups", "chronicAcceptanceLedger"],
    functionalBoundary: "Manage screening, tiered intervention, post-discharge follow-up, medication adherence, family doctor collaboration, and resident feedback.",
    reusePoints: ["chronic screening tasks", "management plans", "followups", "personal records", "medication pickup evidence", "chronic acceptance ledger"],
    apiRoutes: ["GET /api/service-acceptance-summary", "POST /api/chronic/followup-feedback", "PATCH /api/chronic-management-plans/:id"],
    testEvidence: ["test/chronic-followup-readiness.test.js", "chronic:followup-readiness"],
    acceptanceEvidence: ["chronic-followup-readiness-report.json", "chronic-followup-readiness-report.md"]
  },
  {
    id: "research-sandbox",
    name: "Research datasets and data sandbox",
    conversationTitle: "科研数据集与数据沙箱平台",
    entry: "platform.html",
    owner: "research-governance",
    collections: ["researchDatasets", "diseaseRegistryModels", "dataAccessLogs", "securityAcceptanceLedger", "personalRecords", "diagnosticReports"],
    functionalBoundary: "Govern research dataset application, ethics approval, de-identification release, sandbox access, usage audit, and outcome return.",
    reusePoints: ["research datasets", "disease registry models", "data access logs", "security acceptance ledger", "clinical source records"],
    apiRoutes: ["GET /api/research/sandbox", "GET /api/research/datasets", "POST /api/research/datasets/:id/approval", "POST /api/research/datasets/:id/sandbox-access", "POST /api/research/datasets/:id/outcomes"],
    testEvidence: ["test/research-sandbox-readiness.test.js", "research:sandbox"],
    acceptanceEvidence: ["research-sandbox-readiness-report.json", "research-sandbox-readiness-report.md"]
  }
];

const DASHBOARD_APPLICATION = {
  id: "health-dashboard",
  name: "Health commission aggregate dashboard",
  conversationTitle: "卫生健康综合驾驶舱",
  entry: "health-dashboard.html",
  owner: "commission",
  aggregate: true,
  collections: ["healthDashboardSnapshots", "platformEvidence", "platformInterfaces", "productionDeploymentPlan", "platformRoadmap"],
  functionalBoundary: "Aggregate indicators, risks, open actions, interfaces, acceptance evidence, and site dependencies from the first seven source applications.",
  reusePoints: ["health dashboard snapshots", "platform evidence", "platform interfaces", "production deployment plan", "platform roadmap"],
  apiRoutes: ["GET /api/health-dashboard/summary"],
  testEvidence: ["test/health-dashboard-summary.test.js", "test/api.test.js health-dashboard summary assertions", "health-dashboard:summary"],
  acceptanceEvidence: ["health-dashboard-summary.json", "health-dashboard-summary.md"]
};

const APPLICATIONS = [...SOURCE_APPLICATIONS, DASHBOARD_APPLICATION];
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
    boundary: app.aggregate
      ? "Aggregate dashboard only; the first seven source applications remain the system of record."
      : "Aggregated in the dashboard; detailed workflow remains in the source application."
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
      sourceApplication: item.id !== DASHBOARD_APPLICATION.id,
      aggregateApplication: item.id === DASHBOARD_APPLICATION.id,
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
    { id: "templates:conversation-starter", passed: templates.every((item) => item.conversationStarter && item.conversationStarter.includes(item.id) && item.conversationStarter.includes(item.frontendEntry)), detail: "all templates expose copy-ready conversation starters" },
    { id: "templates:implementation-checklist", passed: templates.every((item) => Array.isArray(item.implementationChecklist) && item.implementationChecklist.length >= 8), detail: "all templates expose implementation checklists" },
    { id: "templates:acceptance-gate", passed: templates.every((item) => item.acceptanceGate?.readyWhen?.length >= 4 && item.acceptanceGate?.evidence?.length), detail: "all templates expose acceptance gates" },
    { id: "templates:source-boundary", passed: templates.filter((item) => item.sourceApplication).length === 7 && templates.filter((item) => item.aggregateApplication).length === 1, detail: "7 source applications and 1 aggregate dashboard" }
  ];
  return {
    ok: summary.ok && checks.every((item) => item.passed),
    generatedAt: summary.generatedAt,
    scope: {
      role: "priority-application-development-templates",
      rule: "Each template is the handoff contract for one independent application conversation: boundary, reuse, data, API, frontend, tests, acceptance evidence, About-page feature description, module documentation, and a workflow diagram."
    },
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
  return taskCollections.flatMap((collection) => rows(data, collection).filter(isOpen).map((item) => ({
    id: item.id || `${collection}-${item.residentId || item.status || "open"}`,
    collection,
    title: item.title || item.taskName || item.topic || item.orderType || item.item || item.claimType || item.medication || item.name || collection,
    owner: item.owner || item.assignee || item.institution || item.center || item.sourceInstitution || item.targetInstitution || "owner-pending",
    status: statusOf(item) || "open",
    priority: riskLevel(item),
    dueAt: item.dueAt || item.due || item.nextReview || item.plannedAt || item.requestedAt || item.lastUpdated || ""
  }))).sort((left, right) =>
    ({ high: 3, medium: 2, normal: 1 }[right.priority] || 0) - ({ high: 3, medium: 2, normal: 1 }[left.priority] || 0) ||
    String(left.dueAt || "").localeCompare(String(right.dueAt || ""))
  ).slice(0, limit);
}

function buildIndustryGovernanceIndicatorCenter(data = {}, context = {}) {
  const now = context.now instanceof Date ? context.now : new Date();
  const month = now.toISOString().slice(0, 7);
  const year = now.toISOString().slice(0, 4);
  const residents = rows(data, "residents");
  const physicalExamRows = [...rows(data, "physicalExaminationRecords"), ...rows(data, "healthExamRecords")];
  const feverClinicRows = [
    ...rows(data, "feverClinicVisits"),
    ...rows(data, "publicHealthEvents").filter((item) => /发热|fever/i.test(JSON.stringify(item)))
  ];
  const diseaseQueue = [...rows(data, "phase2DiseaseReportQueue"), ...rows(data, "diseaseReportQueue")];
  const diseaseReceipts = [...rows(data, "phase2DiseaseReportReceipts"), ...rows(data, "diseaseReportReceipts")];
  const clinicalAlerts = rows(data, "phase2ClinicalAssistAlerts");
  const clinicalReceipts = rows(data, "phase2ClinicalAssistReceipts");
  const archiveAccess = rows(data, "dataAccessLogs");
  const appointmentRows = [
    ...rows(data, "registrationOrders"),
    ...rows(data, "careOrders").filter((item) => /appointment|registration|挂号|预约/i.test(JSON.stringify(item)))
  ];
  const familyDoctorContracts = rows(data, "phase2FamilyDoctorContracts");
  const familyDoctorFulfillments = rows(data, "phase2FamilyDoctorFulfillments");
  const regionalPerformanceRows = [
    ...rows(data, "institutionCreditEvaluations"),
    ...rows(data, "countyAcceptanceLedger"),
    ...rows(data, "healthDashboardSnapshots")
  ];
  const completedCount = (items) => items.filter((item) => !isOpen(item)).length;
  const allowedAccess = archiveAccess.filter((item) => /allowed|approved|success|granted|已授权|通过/i.test(String(item.result || item.status || item.decision || ""))).length;
  const confirmedAppointments = appointmentRows.filter((item) => /confirmed|paid|completed|registered|accepted|已确认|已支付|已完成/i.test(statusOf(item))).length;
  const fulfilledContractIds = new Set(familyDoctorFulfillments.map((item) => item.contractId).filter(Boolean));
  const fulfilledContracts = familyDoctorContracts.filter((item) => fulfilledContractIds.has(item.id) || /active|fulfilled|renewed|履约|已签约/i.test(statusOf(item))).length;
  const metric = ({ id, topic, category, definition, numerator, denominator, unit = "%", owner, sourceCollections, sourceSystems, drilldown, missingSource }) => {
    const safeNumerator = Number(numerator || 0);
    const safeDenominator = Number(denominator || 0);
    const rate = safeDenominator > 0 ? Math.min(100, Math.round((safeNumerator / safeDenominator) * 1000) / 10) : 0;
    const status = missingSource || safeDenominator === 0 ? "blocked" : rate >= 90 ? "ready" : "watch";
    const currentValue = unit === "%" ? `${rate}%` : `${safeNumerator} ${unit}`;
    const exceptionCount = safeDenominator > 0 ? Math.max(0, safeDenominator - safeNumerator) : 1;
    const reports = [
      { id: "month", label: "月报", period: month, value: currentValue, numerator: safeNumerator, denominator: safeDenominator, status, basis: "current normalized snapshot" },
      { id: "year", label: "年报", period: year, value: currentValue, numerator: safeNumerator, denominator: safeDenominator, status, basis: "current normalized snapshot" }
    ];
    return {
      id,
      topic,
      category,
      definition,
      numerator: safeNumerator,
      denominator: safeDenominator,
      currentValue,
      rate,
      unit,
      status,
      exceptionCount,
      owner,
      sourceCollections,
      sourceSystems,
      dataQuality: status === "ready" ? "high" : status === "watch" ? "medium" : "source-required",
      reports,
      drilldown,
      nextAction: status === "blocked"
        ? `Connect and verify ${sourceSystems.join(" / ")} source data before production reporting.`
        : exceptionCount > 0
          ? `Review ${exceptionCount} exception records in the owning source workflow.`
          : "Keep the metric definition, source version and report evidence current."
    };
  };
  const indicators = [
    metric({ id: "industry-physical-exam", topic: "健康体检覆盖", category: "专项监管", definition: "已形成可追溯体检记录的居民数 / 纳入监管居民数。", numerator: new Set(physicalExamRows.map((item) => item.residentId).filter(Boolean)).size, denominator: residents.length, owner: "医政医管处/基层卫生处", sourceCollections: ["physicalExaminationRecords", "healthExamRecords", "residents"], sourceSystems: ["体检系统", "居民主索引"], drilldown: { label: "居民健康档案", href: "./citizen.html" }, missingSource: physicalExamRows.length === 0 }),
    metric({ id: "industry-fever-clinic", topic: "发热门诊报告闭环", category: "专项监管", definition: "已完成报告和处置回执的发热门诊事件 / 发热门诊事件总数。", numerator: completedCount(feverClinicRows), denominator: feverClinicRows.length, owner: "医政医管处/疾控处", sourceCollections: ["feverClinicVisits", "publicHealthEvents"], sourceSystems: ["发热门诊系统", "公共卫生平台"], drilldown: { label: "公共卫生", href: "./public-health.html" }, missingSource: feverClinicRows.length === 0 }),
    metric({ id: "industry-disease-reporting", topic: "疾病报卡回执率", category: "公卫监管", definition: "已取得区县平台回执的报卡数 / 疾病报卡队列总数。", numerator: Math.min(diseaseQueue.length, diseaseReceipts.length), denominator: diseaseQueue.length, owner: "疾控处/区县信息中心", sourceCollections: ["phase2DiseaseReportQueue", "phase2DiseaseReportReceipts"], sourceSystems: ["HIS/EMR", "区县直报平台"], drilldown: { label: "二期报病协同", href: "./platform.html#phase2-disease-reporting" }, missingSource: diseaseQueue.length === 0 }),
    metric({ id: "industry-clinical-assist", topic: "临床辅助消息回执率", category: "医政质量", definition: "医生已处理并回执的临床辅助提醒 / 已生成提醒总数。", numerator: clinicalReceipts.length, denominator: clinicalAlerts.length, owner: "医政医管处/质控中心", sourceCollections: ["phase2ClinicalAssistAlerts", "phase2ClinicalAssistReceipts"], sourceSystems: ["医生工作站", "临床辅助规则中心"], drilldown: { label: "临床治疗辅助", href: "./platform.html#phase2-clinical-assist" }, missingSource: clinicalAlerts.length === 0 }),
    metric({ id: "industry-archive-access", topic: "健康档案调阅合规率", category: "便民服务", definition: "通过授权和审计校验的档案调阅次数 / 档案调阅审计总数。", numerator: allowedAccess, denominator: archiveAccess.length, owner: "规划信息处/数据安全岗", sourceCollections: ["dataAccessLogs", "personalRecords"], sourceSystems: ["全民健康信息平台", "统一授权服务"], drilldown: { label: "数据共享审计", href: "./regional-data-sharing.html" }, missingSource: archiveAccess.length === 0 }),
    metric({ id: "industry-appointment-reconciliation", topic: "预约订单对账完成率", category: "便民服务", definition: "已确认、支付或完成的预约订单 / 预约与挂号订单总数。", numerator: confirmedAppointments, denominator: appointmentRows.length, owner: "医政医管处/便民服务运营", sourceCollections: ["registrationOrders", "careOrders"], sourceSystems: ["17 家医院号源", "支付/医保回调"], drilldown: { label: "居民预约", href: "./citizen.html" }, missingSource: appointmentRows.length === 0 }),
    metric({ id: "industry-family-doctor", topic: "家庭医生履约覆盖率", category: "基层卫生", definition: "已有履约记录或处于有效履约状态的签约数 / 家庭医生签约总数。", numerator: fulfilledContracts, denominator: familyDoctorContracts.length, owner: "基层卫生处/区县卫健局", sourceCollections: ["phase2FamilyDoctorContracts", "phase2FamilyDoctorFulfillments"], sourceSystems: ["家庭医生签约系统", "基层公卫系统"], drilldown: { label: "家庭医生监管", href: "./platform.html#phase2-family-doctor-contracts" }, missingSource: familyDoctorContracts.length === 0 }),
    metric({ id: "industry-regional-performance", topic: "区域绩效证据就绪率", category: "区域绩效", definition: "已闭环或通过的区域绩效与机构评价记录 / 区域绩效证据总数。", numerator: completedCount(regionalPerformanceRows), denominator: regionalPerformanceRows.length, owner: "规划信息处/医政医管处", sourceCollections: ["institutionCreditEvaluations", "countyAcceptanceLedger", "healthDashboardSnapshots"], sourceSystems: ["综合监管", "医共体绩效", "机构信用评价"], drilldown: { label: "医共体绩效", href: "./county.html" }, missingSource: regionalPerformanceRows.length === 0 })
  ];
  const categories = Array.from(new Set(indicators.map((item) => item.category)));
  const periodViews = ["month", "year"].map((periodId) => ({
    id: periodId,
    label: periodId === "month" ? "月报" : "年报",
    period: periodId === "month" ? month : year,
    indicators: indicators.length,
    readyIndicators: indicators.filter((item) => item.reports.find((report) => report.id === periodId)?.status === "ready").length,
    blockedIndicators: indicators.filter((item) => item.reports.find((report) => report.id === periodId)?.status === "blocked").length,
    exceptionCount: indicators.reduce((sum, item) => sum + item.exceptionCount, 0),
    basis: "current normalized snapshot; production reports require event-date filtering and signed source versions"
  }));
  return {
    title: "二期行业治理指标中心",
    summary: {
      indicators: indicators.length,
      categories: categories.length,
      ready: indicators.filter((item) => item.status === "ready").length,
      watch: indicators.filter((item) => item.status === "watch").length,
      blocked: indicators.filter((item) => item.status === "blocked").length,
      exceptions: indicators.reduce((sum, item) => sum + item.exceptionCount, 0),
      reportViews: periodViews.length
    },
    categories,
    periodViews,
    indicators,
    exportFields: ["topic", "category", "definition", "currentValue", "status", "exceptionCount", "owner", "sourceCollections", "sourceSystems", "nextAction"],
    releaseEvidence: ["/api/health-dashboard/industry-governance-indicators", "health-dashboard.html#industry-governance-indicator-center", "docs/health-dashboard-indicator-center-report.md"],
    boundary: "The indicator center is a governance definition, reporting and drilldown surface. It does not replace source-system reporting, statutory submissions or signed production statistics."
  };
}

function buildHealthDashboardSummary(options = {}) {
  const data = options.data || readJson("data/db.json");
  const runtime = options.runtime || null;
  const readiness = options.readiness || null;
  const releaseReport = options.releaseReport || null;
  const applications = APPLICATIONS.map((app) => summarizeApplication(data, app));
  const sourceApplications = applications.filter((item) => item.id !== DASHBOARD_APPLICATION.id);
  const openActions = collectOpenActions(data);
  const interfaceRows = rows(data, "platformInterfaces");
  const evidenceRecords = rows(data, "platformEvidence").flatMap((item) => item.records || []);
  const siteDependencies = rows(data, "productionDeploymentPlan").filter((item) => isOpen(item) || /missing|待|寰|blocked/i.test(JSON.stringify(item)));
  const indicatorCenter = buildIndustryGovernanceIndicatorCenter(data, { now: options.now });
  const checks = [
    { id: "dashboard:applications", passed: applications.length === 8 && sourceApplications.length === 7 && applications.every((item) => item.entry && item.collections.length), detail: `${applications.length} priority applications; ${sourceApplications.length} source applications` },
    { id: "dashboard:development-template", passed: applications.every((item) => item.functionalBoundary && item.reusePoints.length && item.dataCollections.length && item.apiRoutes.length && item.frontendEntry && item.testEvidence.length && item.acceptanceEvidence.length), detail: "all priority applications expose boundary, reuse, data, API, frontend, test, and acceptance fields" },
    { id: "dashboard:documentation-rule", passed: applications.every((item) => item.documentationRule?.aboutPage && item.documentationRule?.requiredDocument && item.documentationRule?.flowDiagram), detail: "all priority applications expose About docs and flow diagram requirements" },
    { id: "dashboard:source-boundary", passed: sourceApplications.every((item) => /source application/.test(item.boundary)), detail: "source applications keep workflow ownership" },
    { id: "dashboard:aggregate-boundary", passed: /first seven source applications/.test(applications.find((item) => item.id === DASHBOARD_APPLICATION.id)?.boundary || ""), detail: "dashboard is aggregate-only" },
    { id: "dashboard:metrics", passed: applications.reduce((sum, item) => sum + item.records, 0) > 0, detail: `${applications.reduce((sum, item) => sum + item.records, 0)} source records` },
    { id: "dashboard:actions", passed: openActions.length > 0, detail: `${openActions.length} open actions previewed` },
    { id: "dashboard:interfaces", passed: interfaceRows.length >= 4, detail: `${interfaceRows.length} interface rows` },
    { id: "dashboard:evidence", passed: evidenceRecords.length >= 1, detail: `${evidenceRecords.length} evidence records` },
    { id: "dashboard:industry-governance-indicators", passed: indicatorCenter.indicators.length === 8 && indicatorCenter.indicators.every((item) => item.definition && item.owner && item.sourceCollections.length && item.sourceSystems.length && item.reports.length === 2 && item.drilldown?.href), detail: `${indicatorCenter.indicators.length} governance indicators across ${indicatorCenter.summary.categories} categories` },
    { id: "dashboard:industry-governance-reports", passed: indicatorCenter.periodViews.length === 2 && indicatorCenter.periodViews.every((item) => item.period && item.indicators === indicatorCenter.indicators.length && item.basis), detail: `${indicatorCenter.periodViews.length} monthly/yearly report views` }
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    scope: {
      role: "priority-eight-application-portfolio",
      rule: "Track the eight priority applications; the health dashboard summarizes the first seven source business applications without replacing their workflows."
    },
    totals: {
      applications: applications.length,
      sourceApplications: sourceApplications.length,
      sourceRecords: applications.reduce((sum, item) => sum + item.records, 0),
      openActions: openActions.length,
      highRisks: applications.reduce((sum, item) => sum + item.highRisks, 0),
      interfaceTracks: interfaceRows.length,
      evidenceRecords: evidenceRecords.length,
      siteDependencies: siteDependencies.length,
      runtimeRequests: runtime?.http?.apiRequests ?? null,
      readinessPassed: readiness?.passed ?? null,
      releasePassed: releaseReport?.ok ?? null
    },
    indicatorCenter,
    applications,
    risks: applications.filter((item) => item.highRisks > 0 || item.openActions > 0).map((item) => ({
      applicationId: item.id,
      application: item.name,
      highRisks: item.highRisks,
      openActions: item.openActions,
      nextAction: item.highRisks ? "Review high-risk source records in the owning application." : "Close source workflow actions in the owning application."
    })),
    openActions,
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
  const templateRows = report.applications.map((item) => {
    const documentation = item.documentationRule
      ? [`About: ${item.documentationRule.aboutPage}`, `Doc: ${item.documentationRule.requiredDocument}`, "Flow: required", `Reference: ${item.documentationRule.maternalChildReference}`].join("<br>")
      : "";
    return `| ${item.id} | ${String(item.functionalBoundary || "").replace(/\|/g, "/")} | ${item.reusePoints.join("<br>")} | ${item.dataCollections.join("<br>")} | ${item.apiRoutes.join("<br>")} | ${item.frontendEntry} | ${item.testEvidence.join("<br>")} | ${item.acceptanceEvidence.join("<br>")} | ${documentation} |`;
  });
  const actionRows = report.openActions.map((item) => `| ${item.priority} | ${item.collection} | ${item.id} | ${String(item.title || "").replace(/\|/g, "/")} | ${item.status} | ${item.owner} |`);
  const indicatorRows = (report.indicatorCenter?.indicators || []).map((item) => `| ${item.category} | ${item.topic} | ${item.currentValue} | ${item.status} | ${item.exceptionCount} | ${item.owner} | ${item.sourceCollections.join("<br>")} |`);
  const periodRows = (report.indicatorCenter?.periodViews || []).map((item) => `| ${item.label} | ${item.period} | ${item.indicators} | ${item.readyIndicators} | ${item.blockedIndicators} | ${item.exceptionCount} | ${item.basis} |`);
  const checkRows = report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${String(item.detail || "").replace(/\|/g, "/")} |`);
  return [
    "# Health dashboard summary",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Applications: ${report.totals.applications}`,
    `- Source records: ${report.totals.sourceRecords}`,
    `- Open actions: ${report.totals.openActions}`,
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
    "## Development template",
    "",
    "| Application | Boundary | Reuse points | Data collections | API | Frontend entry | Tests | Acceptance evidence | Documentation rule |",
    "|---|---|---|---|---|---|---|---|---|",
    ...templateRows,
    "",
    "## Industry governance indicator center",
    "",
    report.indicatorCenter?.boundary || "",
    "",
    "| Category | Indicator | Current value | Status | Exceptions | Owner | Sources |",
    "|---|---|---|---|---:|---|---|",
    ...indicatorRows,
    "",
    "### Monthly and yearly report views",
    "",
    "| View | Period | Indicators | Ready | Blocked | Exceptions | Basis |",
    "|---|---|---:|---:|---:|---:|---|",
    ...periodRows,
    "",
    "## Open action preview",
    "",
    "| Priority | Collection | ID | Title | Status | Owner |",
    "|---|---|---|---|---|---|",
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

module.exports = { APPLICATIONS, DOCUMENTATION_RULE, buildHealthDashboardSummary, buildIndustryGovernanceIndicatorCenter, buildPriorityApplicationTemplates, parseArgs, renderMarkdown, writeOutput };
