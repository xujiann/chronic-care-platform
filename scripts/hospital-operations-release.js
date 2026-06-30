#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { buildHospitalOperationsReadinessReport } = require("./hospital-operations-readiness");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "hospital-operations-release-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "hospital-operations-release-report.md");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function check(id, passed, detail) {
  return { id, passed: Boolean(passed), detail };
}

function buildHospitalOperationsReleaseReport(options = {}) {
  const data = options.data ?? readJson("data/db.json");
  const pkg = options.pkg ?? readJson("package.json");
  const serverSource = options.serverSource ?? readText("server.js");
  const operationsHtml = options.operationsHtml ?? readText("operations.html");
  const operationsJs = options.operationsJs ?? readText("operations.js");
  const portalCss = options.portalCss ?? readText("portal.css");
  const sharedJs = options.sharedJs ?? readText("shared.js");
  const readiness = options.readiness ?? buildHospitalOperationsReadinessReport({ data, pkg, serverSource, operationsHtml, operationsJs });
  const checks = [
    check("release:readinessBase", readiness.ok, "hospital operations readiness report passes"),
    check("release:interfaceMapping", /\/api\/operations\/interface-mapping/.test(serverSource) && /operations-interface-mapping/.test(operationsHtml) && /renderInterfaceMapping/.test(operationsJs), "field mapping API and panel are present"),
    check("release:sla", /buildCommandSla/.test(serverSource) && /command-chain-sla/.test(operationsJs) && /command-chain-sla/.test(portalCss), "command chain SLA evidence is rendered"),
    check("release:playbooks", /\/api\/operations\/playbooks/.test(serverSource) && /buildOperationsPlaybooks/.test(serverSource) && /operation-playbooks/.test(operationsHtml) && /renderOperationsPlaybooks/.test(operationsJs), "alert playbooks are generated and rendered"),
    check("release:handover", /\/api\/operations\/handover/.test(serverSource) && /buildOperationsHandover/.test(serverSource) && /operation-handover/.test(operationsHtml) && /renderOperationsHandover/.test(operationsJs) && /operation-handover-card/.test(portalCss), "shift handover checklist is generated and rendered"),
    check("release:handoverOwners", /\/api\/operations\/handover\/owners/.test(serverSource) && /buildOperationsHandoverOwnerMatrix/.test(serverSource) && /operation-handover-owner-matrix/.test(operationsHtml) && /renderHandoverOwnerMatrix/.test(operationsJs) && /operation-handover-owner-card/.test(portalCss), "shift handover owner matrix is generated and rendered"),
    check("release:handoverSignoff", /\/api\/operations\/handover\/signoff/.test(serverSource) && /normalizeHandoverSignoff/.test(serverSource) && /operations-handover-signoff/.test(serverSource) && /operation-handover-signoffs/.test(operationsHtml) && /signoffOperationsHandover/.test(operationsJs), "shift handover signoff and audit evidence are present"),
    check("release:reconciliationStatuses", /returned/.test(sharedJs) && /correcting/.test(sharedJs) && /reconciliationActionButtons/.test(operationsJs) && /review-status-change/.test(serverSource), "direct-report review statuses and audit trail are present"),
    check("release:performanceDetail", /performance-indicator-detail/.test(operationsHtml) && /renderPerformanceIndicatorDetail/.test(operationsJs) && /indicatorDetails/.test(serverSource), "performance indicator detail view is present"),
    check("release:dispatchLifecycle", /\/api\/operations\/dispatch\/:id\/status/.test(serverSource) && /dispatchStatusButtons/.test(operationsJs) && /status-change/.test(serverSource), "dispatch lifecycle actions are present"),
    check("release:hospitalIntegrationIngest", /\/api\/operations\/integration\/snapshots/.test(serverSource) && /\/api\/operations\/integration\/dispatch-feedback/.test(serverSource) && /\/api\/operations\/integration\/reconciliation/.test(serverSource) && /医院运行接口验签/.test(serverSource), "signed hospital system ingest APIs are present"),
    check("release:siteJointTests", /\/api\/operations\/site-joint-tests/.test(serverSource) && /buildOperationsSiteJointTests/.test(serverSource) && /operations-site-joint-tests/.test(operationsHtml) && /renderSiteJointTests/.test(operationsJs), "site joint-test closeout is present"),
    check("release:productionHardening", /\/api\/operations\/production-hardening/.test(serverSource) && /buildOperationsProductionHardening/.test(serverSource) && /operation-production-hardening/.test(operationsHtml) && /renderProductionHardening/.test(operationsJs), "production hardening checklist is present"),
    check("release:intelligence", /\/api\/operations\/intelligence/.test(serverSource) && /buildOperationsIntelligence/.test(serverSource) && /operation-intelligence/.test(operationsHtml) && /renderOperationsIntelligence/.test(operationsJs), "intelligent dispatch recommendations are present"),
    check("release:governanceReport", /\/api\/operations\/governance-report/.test(serverSource) && /buildOperationsGovernanceReport/.test(serverSource) && /operation-governance-report/.test(operationsHtml) && /renderGovernanceReport/.test(operationsJs), "governance report panel is present"),
    check("release:nextDevelopmentResearch", /\/api\/operations\/next-development-research/.test(serverSource) && /buildOperationsNextDevelopmentResearch/.test(serverSource) && /operation-next-development/.test(operationsHtml) && /renderNextDevelopmentResearch/.test(operationsJs), "next development research panel is present"),
    check("release:packageScript", Boolean(pkg.scripts?.["hospital-operations:release"]), "package script registered")
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    scope: "医院运行监测与资源调度平台发布证据",
    summary: {
      checks: checks.length,
      passed: checks.filter((item) => item.passed).length,
      failed: checks.filter((item) => !item.passed).length,
      snapshots: Array.isArray(data.hospitalOperationSnapshots) ? data.hospitalOperationSnapshots.length : 0,
      dispatchRequests: Array.isArray(data.resourceDispatchRequests) ? data.resourceDispatchRequests.length : 0,
      reconciliationReviews: Array.isArray(data.statisticsReconciliationReviews) ? data.statisticsReconciliationReviews.length : 0
    },
    releaseItems: [
      "现场联调字段映射",
      "调度与处置链SLA",
      "预警处置预案",
      "运行交接清单",
      "交接责任矩阵",
      "交接签收与审计留痕",
      "统计直报多状态复核",
      "绩效指标详情与异常说明模板",
      "现场联调闭环",
      "生产加固清单",
      "智能调度建议",
      "治理报表",
      "下一步功能研究",
      "发布证据脚本与闸口集成"
    ],
    checks
  };
}

function renderMarkdown(report) {
  return [
    "# 医院运行监测平台发布证据",
    "",
    `- 生成时间：${report.generatedAt}`,
    `- 结果：${report.ok ? "通过" : "未通过"}`,
    `- 检查项：${report.summary.passed}/${report.summary.checks}`,
    "",
    "## 发布范围",
    "",
    ...report.releaseItems.map((item) => `- ${item}`),
    "",
    "## 检查结果",
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
  const report = buildHospitalOperationsReleaseReport();
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

module.exports = { buildHospitalOperationsReleaseReport, parseArgs, renderMarkdown, writeOutput };
