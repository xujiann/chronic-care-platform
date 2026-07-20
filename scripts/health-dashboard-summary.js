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
    collections: ["researchDatasets", "diseaseRegistryModels", "compliantDataExports", "dataAccessLogs", "securityAcceptanceLedger", "personalRecords", "diagnosticReports"],
    functionalBoundary: "Govern research dataset application, ethics approval, de-identification release, sandbox access, compliant data export, usage audit, and outcome return without AI diagnosis.",
    reusePoints: ["research datasets", "disease registry models", "compliant data exports", "data access logs", "security acceptance ledger", "clinical source records"],
    apiRoutes: ["GET /api/research/sandbox", "GET /api/research/datasets", "GET /api/research/compliant-exports", "POST /api/research/datasets/:id/evidence", "POST /api/research/datasets/:id/approval", "POST /api/research/datasets/:id/sandbox-access", "POST /api/research/datasets/:id/compliant-exports", "POST /api/research/datasets/:id/outcomes"],
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
  return collectTaskActionRows(data).filter((item) => !item.closed).sort((left, right) =>
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
  const sourceOpenActions = applications.reduce((sum, item) => sum + item.openActions, 0);
  const previewOpenActions = openActions.length;
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
    { id: "dashboard:actions", passed: previewOpenActions > 0 && sourceOpenActions >= previewOpenActions, detail: `${previewOpenActions} 条预览待办 / ${sourceOpenActions} 条源应用待办` },
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
    indicatorCenter,
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
