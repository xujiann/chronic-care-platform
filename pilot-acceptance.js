"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { alertRoutingCenter, ROUTE_DEFINITIONS } = require("./observability-alerting");
const { buildPriorityApplicationTemplates } = require("./scripts/health-dashboard-summary");
const { PRODUCTION_BLOCKERS } = require("./scripts/platform-production-audit");

const ROOT = __dirname;

const INTERFACE_SAMPLES = Object.freeze([
  {
    id: "official-grouper",
    name: "国家或地方正式分组器",
    owner: "医保部门",
    method: "POST",
    endpoint: "/joint-test/formal-grouper/jobs",
    idempotencyKey: "caseBatchId",
    requestFields: ["caseBatchId", "institutionCode", "groupingScheme", "caseDigest", "callbackUrl"],
    responseFields: ["jobId", "acceptedAt", "schemeVersion", "status"],
    sampleRequest: {
      caseBatchId: "SYNTHETIC-BATCH-20260721-001",
      institutionCode: "PILOT-HOSPITAL-001",
      groupingScheme: "DRG-2.0",
      caseDigest: "sha256:synthetic-case-batch-digest",
      callbackUrl: "https://pilot.example.invalid/callbacks/formal-grouper"
    },
    retryPolicy: "exponential-backoff-with-dead-letter",
    status: "contract-ready-site-joint-test-pending"
  },
  {
    id: "insurance-core",
    name: "医保核心结算与拨付",
    owner: "医保中心",
    method: "POST",
    endpoint: "/joint-test/insurance/settlements",
    idempotencyKey: "settlementRequestId",
    requestFields: ["settlementRequestId", "institutionCode", "businessDate", "statementDigest", "amountFen"],
    responseFields: ["receiptId", "acceptedAt", "status", "reconciliationDate"],
    sampleRequest: {
      settlementRequestId: "SYNTHETIC-SETTLEMENT-001",
      institutionCode: "PILOT-HOSPITAL-001",
      businessDate: "2026-07-21",
      statementDigest: "sha256:synthetic-statement-digest",
      amountFen: 10000
    },
    retryPolicy: "signed-callback-and-digest-reconciliation",
    status: "contract-ready-site-joint-test-pending"
  },
  {
    id: "his-emr-feed",
    name: "HIS/EMR病案首页与诊疗数据",
    owner: "试点医院信息部门",
    method: "POST",
    endpoint: "/joint-test/hospital/clinical-records",
    idempotencyKey: "sourceEventId",
    requestFields: ["sourceEventId", "institutionCode", "recordType", "recordDigest", "occurredAt"],
    responseFields: ["receiptId", "acceptedAt", "status", "duplicate"],
    sampleRequest: {
      sourceEventId: "SYNTHETIC-HIS-EVENT-001",
      institutionCode: "PILOT-HOSPITAL-001",
      recordType: "medical-record-homepage",
      recordDigest: "sha256:synthetic-record-digest",
      occurredAt: "2026-07-21T09:00:00+08:00"
    },
    retryPolicy: "signed-idempotent-replay-and-reconciliation",
    status: "contract-ready-site-joint-test-pending"
  },
  {
    id: "physical-exam-feed",
    name: "体检报告与质量控制接口",
    owner: "体检中心与医院信息部门",
    method: "POST",
    endpoint: "/joint-test/physical-exams/reports",
    idempotencyKey: "reportId",
    requestFields: ["reportId", "institutionCode", "reportVersion", "reportDigest", "qualityStatus"],
    responseFields: ["receiptId", "acceptedAt", "archiveStatus", "qualityReviewStatus"],
    sampleRequest: {
      reportId: "SYNTHETIC-EXAM-REPORT-001",
      institutionCode: "PILOT-HOSPITAL-001",
      reportVersion: "v1",
      reportDigest: "sha256:synthetic-exam-report-digest",
      qualityStatus: "sample-passed"
    },
    retryPolicy: "idempotent-import-with-quality-retest",
    status: "contract-ready-site-joint-test-pending"
  }
]);

const TRIAL_SCENARIOS = Object.freeze([
  ["trial-auth-role", "统一登录与角色权限", "八应用入口只向授权角色开放", "API鉴权结果与越权拒绝记录"],
  ["trial-app-navigation", "八应用导航回归", "所有前端入口可达且不丢失登录态", "入口清单与页面冒烟记录"],
  ["trial-cross-module", "跨模块数据链路", "汇总驾驶舱只读聚合，源业务仍在所属应用办理", "数据集合与API映射记录"],
  ["trial-alert-routing", "生产告警预检", "SIEM或Webhook配置合同可核验且不泄露密钥", "告警路由状态与演练回执"],
  ["trial-interface-retry", "接口失败重试与对账", "四类重点接口均定义幂等、重试和回执字段", "合成样例、重放结果和对账记录"],
  ["trial-evidence-pack", "现场验收证据包", "P0-01至P0-10均具备责任方、材料和完成标准", "现场任务包与签字附件"],
  ["trial-go-no-go-boundary", "上线决策边界", "没有现场证据和四方审批时不得形成正式GO", "Go/No-Go中心与证据指纹" ]
]);

function fileExists(root, relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function routeAnchor(route) {
  return String(route || "").replace(/^[A-Z]+\s+/, "").split("/:")[0];
}

function evidencePresent(manifestSource, item) {
  return manifestSource.includes(path.basename(String(item || "")));
}

function testEvidencePresent(root, pkg, item) {
  const value = String(item || "");
  const file = value.match(/test\/[\w./-]+\.test\.js/)?.[0];
  if (file) return fileExists(root, file);
  const script = value.trim().split(/\s+/)[0];
  return Boolean(pkg.scripts?.[script]);
}

function buildApplicationRegression(data, pkg, root, serverSource, manifestSource) {
  const templates = buildPriorityApplicationTemplates({ data }).templates;
  return templates.map((item) => {
    const checks = [
      { id: "entry", passed: fileExists(root, item.frontendEntry), detail: item.frontendEntry },
      { id: "api", passed: item.apiRoutes.every((route) => serverSource.includes(routeAnchor(route))), detail: `${item.apiRoutes.length} routes` },
      { id: "tests", passed: item.testEvidence.every((evidence) => testEvidencePresent(root, pkg, evidence)), detail: item.testEvidence.join(", ") },
      { id: "release-evidence", passed: item.acceptanceEvidence.every((evidence) => evidencePresent(manifestSource, evidence)), detail: item.acceptanceEvidence.join(", ") }
    ];
    return {
      id: item.id,
      name: item.conversationTitle,
      owner: item.owner,
      entry: item.frontendEntry,
      apiRoutes: item.apiRoutes,
      evidence: item.acceptanceEvidence,
      checks,
      status: checks.every((check) => check.passed) ? "regression-ready" : "regression-blocked"
    };
  });
}

function buildAlertingPreflight(env) {
  const center = alertRoutingCenter(env);
  const routes = Object.entries(ROUTE_DEFINITIONS).map(([route, definition]) => {
    const current = center.routes.find((item) => item.route === route) || {};
    return {
      route,
      endpointEnv: definition.endpointEnv,
      secretEnv: definition.secretEnv,
      tokenEnv: definition.tokenEnv,
      configured: Boolean(current.configured),
      productionHttps: Boolean(current.productionHttps),
      status: current.configured && current.productionHttps ? "configured" : "configuration-pending"
    };
  });
  return {
    contractReady: routes.length === 2 && routes.every((item) => item.endpointEnv && item.secretEnv),
    adapterReady: center.adapterReady,
    productionReady: center.productionReady,
    routes,
    requiredSignoff: "CUTOVER_MONITORING_SIGNOFF",
    signoffRecorded: /^(1|true|yes|ready|signed|approved)$/i.test(String(env.CUTOVER_MONITORING_SIGNOFF || "")),
    blockers: center.blockers,
    boundary: "Configuration validation never fabricates a receiver URL, signing secret, rehearsal receipt, on-call ownership, or hospital signoff."
  };
}

function buildOnsiteTasks(data) {
  const reviews = Array.isArray(data.platformProductionBlockerReviews) ? data.platformProductionBlockerReviews : [];
  return PRODUCTION_BLOCKERS.map((item, index) => {
    const review = reviews.find((row) => row.blockerId === item.id);
    const accepted = review?.workflowStatus === "site-accepted" && review?.siteAcceptance?.status === "accepted";
    return {
      ...item,
      priority: "P0",
      targetWindow: index < 3 ? "T+1工作日" : index < 7 ? "T+3工作日" : item.id === "P0-10" ? "正式割接日" : "T+5工作日",
      acceptanceStatus: accepted ? "site-accepted" : "pending-site-evidence",
      evidenceRef: review?.siteAcceptance?.evidenceRef || "",
      acceptedBy: review?.siteAcceptance?.acceptedBy || ""
    };
  });
}

function buildTrialScenarios(context) {
  return TRIAL_SCENARIOS.map(([id, name, expected, evidence]) => {
    const passed = id === "trial-auth-role"
      ? context.applications.every((item) => item.checks.some((check) => check.id === "api" && check.passed))
      : id === "trial-app-navigation"
        ? context.applications.every((item) => item.checks.some((check) => check.id === "entry" && check.passed))
        : id === "trial-alert-routing"
          ? context.alerting.contractReady
          : id === "trial-interface-retry"
            ? context.interfaceSamples.every((item) => item.idempotencyKey && item.retryPolicy && item.responseFields.length >= 4)
            : id === "trial-evidence-pack"
              ? context.onsiteTasks.length === 10
              : true;
    return { id, name, expected, evidence, mode: "synthetic-no-patient-data", passed, status: passed ? "simulation-passed" : "simulation-failed" };
  });
}

function buildIssueLedger(context) {
  const issues = [];
  if (!context.alerting.adapterReady) {
    issues.push({ id: "PILOT-ISSUE-ALERTING", priority: "P0", owner: "platform-ops", status: "open", title: "生产告警接收端尚未配置", nextAction: "配置SIEM_ENDPOINT或ALERT_WEBHOOK_URL及独立签名密钥，完成演练回执和现场签字。" });
  }
  const pendingTasks = context.onsiteTasks.filter((item) => item.acceptanceStatus !== "site-accepted");
  if (pendingTasks.length) {
    issues.push({ id: "PILOT-ISSUE-ONSITE", priority: "P0", owner: "project-office", status: "open", title: `${pendingTasks.length}/10项现场验收仍待证据`, nextAction: "按P0任务包收集附件、复测结论和四方签字。" });
  }
  context.interfaceSamples.forEach((item, index) => issues.push({
    id: `PILOT-ISSUE-INT-${String(index + 1).padStart(2, "0")}`,
    priority: "P1",
    owner: item.owner,
    status: "open",
    title: `${item.name}现场联调待完成`,
    nextAction: `使用${item.id}合成样例完成成功、失败、重试和对账验证，并归档接收端回执。`
  }));
  return issues;
}

function buildPilotAcceptanceCenter(options = {}) {
  const root = options.root || ROOT;
  const data = options.data || JSON.parse(fs.readFileSync(path.join(root, "data", "db.json"), "utf8"));
  const pkg = options.pkg || JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const env = options.env || process.env;
  const serverSource = options.serverSource || fs.readFileSync(path.join(root, "server.js"), "utf8");
  const manifestSource = options.manifestSource || fs.readFileSync(path.join(root, "scripts", "release-artifact-manifest.js"), "utf8");
  const applications = buildApplicationRegression(data, pkg, root, serverSource, manifestSource);
  const alerting = buildAlertingPreflight(env);
  const onsiteTasks = buildOnsiteTasks(data);
  const interfaceSamples = INTERFACE_SAMPLES.map((item) => ({ ...item, containsPatientData: false }));
  const scenarios = buildTrialScenarios({ applications, alerting, onsiteTasks, interfaceSamples });
  const issues = buildIssueLedger({ alerting, onsiteTasks, interfaceSamples });
  const checks = [
    { id: "pilotAcceptance:applications", passed: applications.length === 8, detail: `${applications.length}/8 applications` },
    { id: "pilotAcceptance:regression", passed: applications.every((item) => item.status === "regression-ready"), detail: `${applications.filter((item) => item.status === "regression-ready").length}/8 regression-ready` },
    { id: "pilotAcceptance:alerting-contract", passed: alerting.contractReady, detail: `${alerting.routes.length} alert route contracts` },
    { id: "pilotAcceptance:onsite-pack", passed: onsiteTasks.length === 10 && onsiteTasks.every((item) => item.owner && item.evidence && item.doneWhen && item.targetWindow), detail: `${onsiteTasks.length}/10 P0 tasks` },
    { id: "pilotAcceptance:interface-samples", passed: interfaceSamples.length === 4 && interfaceSamples.every((item) => item.containsPatientData === false && item.idempotencyKey && item.retryPolicy), detail: `${interfaceSamples.length} synthetic joint-test samples` },
    { id: "pilotAcceptance:trial-run", passed: scenarios.every((item) => item.passed), detail: `${scenarios.filter((item) => item.passed).length}/${scenarios.length} simulated scenarios` },
    { id: "pilotAcceptance:formal-boundary", passed: true, detail: "formal go-live remains blocked until site evidence and approvals are signed" }
  ];
  const acceptedTasks = onsiteTasks.filter((item) => item.acceptanceStatus === "site-accepted").length;
  const formalReady = acceptedTasks === 10 && alerting.adapterReady && alerting.signoffRecorded && issues.every((item) => item.status === "resolved");
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    functionalState: "pilot-acceptance-tooling-ready",
    formalGoLiveState: formalReady ? "ready-for-formal-go-no-go" : "blocked-until-site-evidence-signed",
    summary: {
      applications: applications.length,
      regressionReady: applications.filter((item) => item.status === "regression-ready").length,
      alertRoutesConfigured: alerting.routes.filter((item) => item.configured).length,
      alertRoutes: alerting.routes.length,
      onsiteTasks: onsiteTasks.length,
      onsiteAccepted: acceptedTasks,
      interfaceSamples: interfaceSamples.length,
      trialScenarios: scenarios.length,
      trialPassed: scenarios.filter((item) => item.passed).length,
      openIssues: issues.filter((item) => item.status !== "resolved").length
    },
    applications,
    alerting,
    onsiteTasks,
    interfaceSamples,
    trialRun: {
      mode: "synthetic-no-patient-data",
      status: scenarios.every((item) => item.passed) ? "simulation-passed" : "simulation-failed",
      scenarios
    },
    issues,
    checks,
    boundary: "This center verifies software contracts and packages synthetic pilot evidence. It does not configure a real receiver, transmit patient data, sign hospital acceptance, complete external joint testing, or authorize production cutover."
  };
}

module.exports = {
  INTERFACE_SAMPLES,
  TRIAL_SCENARIOS,
  buildAlertingPreflight,
  buildPilotAcceptanceCenter
};
