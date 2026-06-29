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
      deliverable: "真实报文样例、字段映射差异表、签名验签日志、失败重试记录、接收端确认截图。",
      exitCriteria: "每个接入系统至少完成一轮快照上报、调度回执和统计对账回放。"
    },
    {
      id: "production-hardening",
      phase: "P0 生产加固",
      owner: "平台运维/安全管理岗",
      scope: "生产密钥、审计保全、监控告警、灾备演练、回退方案",
      deliverable: "INTEGRATION_GATEWAY_SECRET 轮换方案、AUDIT_EXPORT_PATH 或 SIEM_ENDPOINT、CUTOVER_MONITORING_SIGNOFF、CUTOVER_DR_REHEARSAL_SIGNOFF。",
      exitCriteria: "release:report:full 无 error，生产割接项完成签字归档。"
    },
    {
      id: "ops-intelligence",
      phase: "P1 智能调度",
      owner: "医政医管处/运行调度席",
      scope: "床位预测、人员缺口预测、急诊拥堵预测、跨院资源推荐",
      deliverable: "预测模型版本、人工复核队列、调度建议采纳率和闭环时效指标。",
      exitCriteria: "形成按机构、科室、资源类型分层的调度建议和复盘看板。"
    },
    {
      id: "governance-reporting",
      phase: "P1 治理报表",
      owner: "规划发展与信息化处/统计办公室",
      scope: "绩效监测、统计直报、资源利用、预警处置、交接班质量",
      deliverable: "月度运行报告、直报差异清单、调度复盘清单、绩效异常说明归档。",
      exitCriteria: "可按月导出面向委端和医院端的运行治理报告。"
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
