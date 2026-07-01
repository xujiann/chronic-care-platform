#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { buildHospitalOperationsReadinessReport } = require("./hospital-operations-readiness");
const { buildHospitalOperationsReleaseReport } = require("./hospital-operations-release");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "hospital-operations-module-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "hospital-operations-module-report.md");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function arrayOf(data, key) {
  return Array.isArray(data[key]) ? data[key] : [];
}

function routePresent(source, route) {
  return source.includes(route);
}

function check(id, passed, detail) {
  return { id, passed: Boolean(passed), detail };
}

function buildCapabilities(data, serverSource, readiness, release) {
  return [
    {
      id: "operations-dashboard",
      name: "医院运行监测总览",
      status: readiness.ok ? "ready" : "needs-attention",
      evidence: ["/api/operations/dashboard", "hospitalOperationSnapshots"],
      detail: `${arrayOf(data, "hospitalOperationSnapshots").length} 个运行快照，支持床位、人员、设备、门急诊、住院运行态势。`
    },
    {
      id: "performance-monitoring",
      name: "绩效监测口径对齐",
      status: routePresent(serverSource, "/api/operations/performance-monitoring") ? "ready" : "missing",
      evidence: ["/api/operations/performance-monitoring", "二级/三级公立医院绩效监测操作手册"],
      detail: "沉淀绩效指标来源、责任科室、异常说明模板和接口字段联调点。"
    },
    {
      id: "dispatch-lifecycle",
      name: "资源调度闭环",
      status: release.checks.some((item) => item.id === "release:dispatchLifecycle" && item.passed) ? "ready" : "needs-attention",
      evidence: ["/api/operations/dispatch", "/api/operations/dispatch/:id/status", "resourceDispatchRequests"],
      detail: `${arrayOf(data, "resourceDispatchRequests").length} 条调度单，覆盖创建、分派、执行、关闭和审计留痕。`
    },
    {
      id: "signed-hospital-ingest",
      name: "医院系统签名接入",
      status: release.checks.some((item) => item.id === "release:hospitalIntegrationIngest" && item.passed) ? "ready" : "missing",
      evidence: [
        "/api/operations/integration/snapshots",
        "/api/operations/integration/dispatch-feedback",
        "/api/operations/integration/reconciliation"
      ],
      detail: "支持医院侧签名上报运行快照、调度回执和统计对账批次，并限制机构只能写入本机构相关数据。"
    },
    {
      id: "reconciliation-review",
      name: "统计直报对账复核",
      status: release.checks.some((item) => item.id === "release:reconciliationStatuses" && item.passed) ? "ready" : "needs-attention",
      evidence: ["/api/operations/reconciliation/:id/review", "statisticsReconciliationReviews", "healthStatisticsIngestion"],
      detail: `${arrayOf(data, "statisticsReconciliationReviews").length} 条对账复核记录，覆盖阻断、退回、补正、通过等状态。`
    },
    {
      id: "command-playbook-handover",
      name: "指挥链、预案与交接班",
      status: release.checks.some((item) => item.id === "release:handoverSignoff" && item.passed) ? "ready" : "needs-attention",
      evidence: [
        "/api/operations/command-chains",
        "/api/operations/playbooks",
        "/api/operations/handover",
        "/api/operations/handover/signoff"
      ],
      detail: "将预警、SLA、责任人、处置动作、交接班签收和审计留痕串成可追踪闭环。"
    },
    {
      id: "site-joint-test",
      name: "现场联调闭环",
      status: release.checks.some((item) => item.id === "release:siteJointTests" && item.passed) ? "ready" : "needs-attention",
      evidence: ["/api/operations/site-joint-tests", "/api/operations/interface-mapping"],
      detail: "把样例报文、验签日志、回放记录、失败重试和接收端确认整理为可复核闭环。"
    },
    {
      id: "site-joint-patrol",
      name: "现场联调巡检台",
      status: release.checks.some((item) => item.id === "release:siteJointPatrol" && item.passed) ? "ready" : "needs-attention",
      evidence: ["/api/operations/site-joint-patrol", "/api/operations/site-joint-patrol/actions", "platformProcessAudit"],
      detail: "按来源系统每日核查样例报文、验签日志、回放记录、失败重试和接收端确认，并把巡检结果写入审计留痕。"
    },
    {
      id: "production-hardening",
      name: "生产加固清单",
      status: release.checks.some((item) => item.id === "release:productionHardening" && item.passed) ? "ready" : "needs-attention",
      evidence: ["/api/operations/production-hardening", "release:report:full"],
      detail: "汇总生产密钥、审计保全、监控告警、灾备演练和现场签字状态，明确割接阻断项。"
    },
    {
      id: "cutover-command",
      name: "生产割接签收台",
      status: release.checks.some((item) => item.id === "release:cutoverCommand" && item.passed) ? "ready" : "needs-attention",
      evidence: ["/api/operations/cutover-command", "/api/operations/cutover-command/actions", "platformProcessAudit"],
      detail: "按生产加固检查项生成割接签收任务，跟踪阻断项、观察窗口、回退策略和审计留痕。"
    },
    {
      id: "post-cutover-observation",
      name: "上线后观察台",
      status: release.checks.some((item) => item.id === "release:postCutoverObservation" && item.passed) ? "ready" : "needs-attention",
      evidence: ["/api/operations/post-cutover-observation", "/api/operations/post-cutover-observation/actions", "platformProcessAudit"],
      detail: "按 T+0 2小时、T+0 8小时、T+1 24小时观察窗口跟踪运行健康、资源压力、调度积压、直报复核、巡检归档、割接签收和移动值守提醒，并列出每个窗口的现场证据清单与证据完成率。"
    },
    {
      id: "ops-intelligence",
      name: "智能调度建议",
      status: release.checks.some((item) => item.id === "release:intelligence" && item.passed) ? "ready" : "needs-attention",
      evidence: ["/api/operations/intelligence", "/api/operations/dispatch"],
      detail: "按机构生成床位缺口、人员缺口、急诊拥堵、直报风险和跨院资源建议，进入人工复核队列。"
    },
    {
      id: "cross-hospital-resource-pool",
      name: "跨院资源池",
      status: release.checks.some((item) => item.id === "release:resourcePool" && item.passed) ? "ready" : "needs-attention",
      evidence: ["/api/operations/resource-pool", "medicalResources", "resourceDispatchRequests"],
      detail: "基于医疗资源目录、运行快照和调度工单生成跨院床位、ICU、呼吸机、救护车和值班医生可支援能力，并提供调拨建议。"
    },
    {
      id: "mobile-duty-command",
      name: "移动值守台",
      status: release.checks.some((item) => item.id === "release:mobileDuty" && item.passed) ? "ready" : "needs-attention",
      evidence: ["/api/operations/mobile-duty", "/api/operations/mobile-duty/actions", "taskMessages"],
      detail: "把预警确认、交接签收、调度备注和直报复核提醒汇总为移动值守卡片，并通过 taskMessages 生成提醒和审计证据。"
    },
    {
      id: "governance-reporting",
      name: "治理报表",
      status: release.checks.some((item) => item.id === "release:governanceReport" && item.passed) ? "ready" : "needs-attention",
      evidence: ["/api/operations/governance-report", "hospital-operations-module-report.md"],
      detail: "形成月度运行报告、直报差异清单、调度复盘和绩效异常说明的导出骨架。"
    },
    {
      id: "governance-export-package",
      name: "治理导出包",
      status: release.checks.some((item) => item.id === "release:governanceExportPackage" && item.passed) ? "ready" : "needs-attention",
      evidence: ["/api/operations/governance-export-package", "operations.html", "hospital-operations-module-report.md"],
      detail: "生成月度运行治理报告、统计直报差异清单、资源调度复盘清单、绩效异常说明模板和附件目录，并支持前端下载归档。"
    },
    {
      id: "next-development-research",
      name: "下一步功能研究",
      status: release.checks.some((item) => item.id === "release:nextDevelopmentResearch" && item.passed) ? "ready" : "needs-attention",
      evidence: ["/api/operations/next-development-research", "operations.html", "hospital-operations-module-report.md"],
      detail: "沉淀现场联调、生产割接、智能调度、跨院资源、治理导出和移动值守六个可开发方向，并给出前置条件、数据来源、验收口径和风险边界。"
    },
    {
      id: "release-evidence",
      name: "发布与审计证据",
      status: readiness.ok && release.ok ? "ready" : "needs-attention",
      evidence: [
        "hospital-operations-readiness-report.md",
        "hospital-operations-release-report.md",
        "release-artifact-manifest.md"
      ],
      detail: "模块已进入 readiness、release、manifest、deploy check 和 CI 验收链。"
    }
  ];
}

function buildNextPlan() {
  return [
    {
      id: "site-joint-test",
      phase: "P0 现场联调",
      owner: "医疗机构/接口联调组",
      scope: "HIS、住院管理、HR排班、设备系统、急诊分诊、卫生统计直报",
      deliverable: "已上线 /api/operations/site-joint-tests、/api/operations/site-joint-patrol 和现场联调巡检台；真实报文、验签日志、回放记录、失败重试和接收端截图为现场归档项。",
      exitCriteria: "代码侧已完成闭环与每日巡检结构；生产前每个接入系统仍需完成一轮真实快照上报、调度回执、统计对账回放和接收端签收。"
    },
    {
      id: "production-hardening",
      phase: "P0 生产加固",
      owner: "平台运维/安全管理岗",
      scope: "生产密钥、审计保全、监控告警、灾备演练、回退方案",
      deliverable: "已上线 /api/operations/production-hardening、/api/operations/cutover-command、/api/operations/post-cutover-observation、生产割接签收台和上线后观察台；真实密钥、保全路径、演练签字、观察窗口和回退策略为现场归档项。",
      exitCriteria: "代码侧已完成阻断清单、签收审计和 T+1 观察闭环；生产前需 release:report:full 无 error 且割接项完成真实签字归档。"
    },
    {
      id: "ops-intelligence",
      phase: "P1 智能调度",
      owner: "医政医管处/运行调度席",
      scope: "床位预测、人员缺口预测、急诊拥堵预测、跨院资源推荐",
      deliverable: "已上线 /api/operations/intelligence 和智能调度建议面板；模型版本和采纳率可在现场数据接入后继续强化。",
      exitCriteria: "已形成按机构分层的调度建议和人工复核队列。"
    },
    {
      id: "governance-reporting",
      phase: "P1 治理报表",
      owner: "规划发展与信息化处/统计办公室",
      scope: "绩效监测、统计直报、资源利用、预警处置、交接班质量",
      deliverable: "已上线 /api/operations/governance-report、/api/operations/governance-export-package 和治理导出包下载入口，覆盖月报、差异、调度复盘、绩效异常说明和附件目录。",
      exitCriteria: "已具备按月导出委端治理报告包的数据骨架；医院端正式版仍需现场角色、模板和签收流程确认。"
    },
    {
      id: "cross-hospital-resource-market",
      phase: "P1 跨院资源协同",
      owner: "医政医管处/医联体办公室",
      scope: "床位、ICU、检查设备、值班人员和转运能力的跨院资源池",
      deliverable: "已上线 /api/operations/resource-pool 和跨院资源池面板，生成可支援资源、审批边界、SLA 和调拨建议。",
      exitCriteria: "代码侧已形成资源池和调拨草稿；生产前需现场确认跨院协议、审批人、转运责任和正式签收流程。"
    },
    {
      id: "mobile-command",
      phase: "P2 移动值守",
      owner: "运行监测岗/值班长",
      scope: "预警确认、交接签收、调度备注、直报复核提醒和消息闭环",
      deliverable: "已上线 /api/operations/mobile-duty、/api/operations/mobile-duty/actions 和移动值守台面板，复用 taskMessages 形成提醒、弱网补传说明和审计留痕。",
      exitCriteria: "代码侧已形成移动值守卡片和消息提醒闭环；生产前需现场确认 App/企业微信/短信通道、值班角色和离线补传策略。"
    }
  ];
}

function buildHospitalOperationsModuleReport(options = {}) {
  const data = options.data ?? readJson("data/db.json");
  const pkg = options.pkg ?? readJson("package.json");
  const serverSource = options.serverSource ?? readText("server.js");
  const readiness = options.readiness ?? buildHospitalOperationsReadinessReport({ data, pkg, serverSource });
  const release = options.release ?? buildHospitalOperationsReleaseReport({ data, pkg, serverSource, readiness });
  const capabilities = buildCapabilities(data, serverSource, readiness, release);
  const nextPlan = buildNextPlan();
  const checks = [
    check("module:readiness", readiness.ok, "hospital operations readiness passes"),
    check("module:release", release.ok, "hospital operations release passes"),
    check("module:signedIngestApis", capabilities.find((item) => item.id === "signed-hospital-ingest")?.status === "ready", "signed hospital ingest APIs are ready"),
    check("module:dashboardAggregator", /buildHospitalOperationsDashboard/.test(serverSource), "dashboard aggregator remains source of truth"),
    check("module:capabilityCoverage", capabilities.every((item) => item.status === "ready"), `${capabilities.filter((item) => item.status === "ready").length}/${capabilities.length} capabilities ready`),
    check("module:nextPlan", nextPlan.length >= 4 && nextPlan.every((item) => item.phase && item.owner && item.exitCriteria), `${nextPlan.length} next-plan rows`)
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    module: {
      id: "hospital-operations-dispatch",
      name: "医院运行监测与资源调度平台",
      branch: "codex/app-operations-dispatch",
      entrypoint: "operations.html"
    },
    summary: {
      capabilities: capabilities.length,
      readyCapabilities: capabilities.filter((item) => item.status === "ready").length,
      operationSnapshots: arrayOf(data, "hospitalOperationSnapshots").length,
      dispatchRequests: arrayOf(data, "resourceDispatchRequests").length,
      reconciliationReviews: arrayOf(data, "statisticsReconciliationReviews").length,
      releaseChecks: release.summary?.checks || release.checks.length,
      releasePassed: release.summary?.passed || release.checks.filter((item) => item.passed).length
    },
    capabilities,
    nextPlan,
    checks
  };
}

function renderMarkdown(report) {
  return [
    "# 医院运行监测模块功能报告",
    "",
    `- 生成时间：${report.generatedAt}`,
    `- 模块：${report.module.name}`,
    `- 入口：${report.module.entrypoint}`,
    `- 审计结论：${report.ok ? "通过" : "需整改"}`,
    `- 能力就绪：${report.summary.readyCapabilities}/${report.summary.capabilities}`,
    "",
    "## 核心功能",
    "",
    "| 状态 | 功能 | 说明 | 证据 |",
    "|---|---|---|---|",
    ...report.capabilities.map((item) => `| ${item.status} | ${item.name} | ${String(item.detail || "").replace(/\|/g, "/")} | ${(item.evidence || []).join(", ")} |`),
    "",
    "## 下一步开发规划",
    "",
    "| 阶段 | 责任方 | 范围 | 交付物 | 退出标准 |",
    "|---|---|---|---|---|",
    ...report.nextPlan.map((item) => `| ${item.phase} | ${item.owner} | ${item.scope} | ${item.deliverable} | ${item.exitCriteria} |`),
    "",
    "## 审计检查",
    "",
    "| 结果 | 检查项 | 说明 |",
    "|---|---|---|",
    ...report.checks.map((item) => `| ${item.passed ? "通过" : "未通过"} | ${item.id} | ${String(item.detail || "").replace(/\|/g, "/")} |`),
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
  const report = buildHospitalOperationsModuleReport();
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

module.exports = { buildHospitalOperationsModuleReport, parseArgs, renderMarkdown, writeOutput };
