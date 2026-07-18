#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function buildBloodSystemReadinessReport(options = {}) {
  const html = options.html ?? readText("blood.html");
  const js = options.js ?? readText("blood.js");
  const server = options.server ?? readText("server.js");
  const transaction = options.transaction ?? readText("blood-transaction-service.js");
  const service = options.service ?? readText("blood-service.js");
  const domain = options.domain ?? require(path.join(ROOT, "blood-domain.js"));
  const pkg = options.pkg ?? readJson("package.json");
  const ci = options.ci ?? readText(".github/workflows/ci.yml");
  const releaseReport = options.releaseReport ?? readText("scripts/release-report.js");
  const artifactManifest = options.artifactManifest ?? readText("scripts/release-artifact-manifest.js");
  const deployCheck = options.deployCheck ?? readText("scripts/deploy-check.js");
  const checks = [
    ["双角色工作台", /data-role="center"/.test(html) && /data-role="hospital"/.test(html)],
    ["血站六大业务域", ["献血者服务", "血液采集", "成分制备", "血液检测", "储存发放运输", "质量管理"].every((item) => js.includes(item))],
    ["临床用血闭环", ["用血申请", "交叉配血", "床旁输注", "输血后评价"].every((item) => html.includes(item) || js.includes(item))],
    ["唯一标识与双向追溯", html.includes("一袋血双向追溯") && js.includes("CN2102")],
    ["库存冷链和预警", html.includes("冷链运输") && js.includes("库存低于3日安全线")],
    ["质量安全控制", js.includes("信息隔离") && domain.standards.some((item) => item.evidence.includes("审计"))],
    ["三份文件条款台账", domain.standards.length >= 20 && new Set(domain.standards.map((item) => item.source)).size === 3],
    ["关键状态强制阻断", domain.canTransition("qualified", "released", {}).ok === false && domain.canTransition("issued", "transfusing", {}).ok === false],
    ["区域应急与风险预警", domain.standards.some((item) => item.id === "PLAN-EMG") && domain.standards.some((item) => item.id === "PLAN-RISK")],
    ["BIS-BTIS交换契约", domain.buildExchangeMessage("delivery_receipt", {}).standard.includes("WS/T 866")],
    ["服务端持久化接口", server.includes('url.pathname === "/api/blood-system"') && server.includes("BloodService.transitionBloodUnit")],
    ["角色数据范围", readText("blood-service.js").includes("canSeeRequest")],
    ["献血者屏蔽与回告", server.includes("donorSafetyCases") && js.includes("notificationStatus")],
    ["标本拒收门禁", server.includes("BloodService.assessSpecimen") && js.includes("标本拒收")],
    ["报告收回与召回", server.includes("BloodService.createRecall") && js.includes("报告收回联动")],
    ["输血反应调查", server.includes("BloodService.reportReaction") && js.includes("输血反应")],
    ["区域应急调配", server.includes("BloodService.createEmergencyAllocation") && html.includes("区域应急调配")],
    ["检测报告签发", server.includes("BloodTransactionService.signTestReport")],
    ["双人电子放行", server.includes("BloodTransactionService.reviewRelease")],
    ["库存锁定与配送交付", server.includes("BloodTransactionService.createShipment") && server.includes("BloodTransactionService.receiveShipment")],
    ["配血双人复核", server.includes("BloodTransactionService.recordCompatibility")],
    ["床旁核对与疗效评价", server.includes("BloodTransactionService.startTransfusion") && server.includes("BloodTransactionService.completeTransfusion")],
    ["关键操作幂等", server.includes('req.headers["idempotency-key"]')],
    ["事务闭环工作台", html.includes('id="transaction"') && js.includes("runTransactionAction")],
    ["事务证据实时回读", server.includes("releaseReviews:") && server.includes("transfusionEpisodes:")],
    ["冷链越限持久化隔离", transaction.includes("cold_chain_breach") && transaction.includes("Temperature Reading Required") && transaction.includes("awaiting_quality_review") && transaction.includes('status: "quarantined"')],
    ["冷链质控处置闭环", transaction.includes("reviewColdChainIncident") && transaction.includes("discard_or_return_to_center") && server.includes("/api/blood-system/safety-incidents/cold-chain/review")],
    ["会话绑定配血双签", transaction.includes("compatibilityReviewer") && transaction.includes("Reviewer Identity Source") && transaction.includes("compatibility_review") && !js.includes("reviewerIds:[")],
    ["血液角色和权限种子", server.includes("BLOOD-DL") && server.includes("u-blood-quality") && server.includes("u-blood-tech-1") && server.includes("bloodPermissions")],
    ["默认测试与覆盖率门禁", pkg.scripts?.pretest?.includes("test/blood-transaction-service.test.js") && pkg.scripts?.["pretest:coverage"]?.includes("blood-system:test")],
    ["CI发布链覆盖", ci.includes("npm run blood-system:readiness") && releaseReport.includes("blood-system:readiness") && artifactManifest.includes("blood-system:readiness") && deployCheck.includes("blood-system:readiness")]
    ,["Versioned blood master data", server.includes("BloodMasterData.snapshot") && readText("blood-master-data.js").includes("recallDispositions")],
    ["Recall acknowledgement and closure", server.includes("acknowledgeRecall") && server.includes("closeRecall")],
    ["Reaction investigation closure", server.includes("investigateReaction")],
    ["Emergency allocation execution", server.includes("actEmergencyAllocation")],
    ["Recall acknowledgement idempotency and exchange", service.includes("acknowledgementSummary") && service.includes("bloodIdempotencyRecords") && server.includes("idempotencyKey") && domain.buildExchangeMessage("recall_acknowledgement", {}).type === "recall_acknowledgement"],
    ["Recall institution confirmation UI", html.includes("blood-recall.js") && readText("blood-recall.js").includes("data-recall-action")]
    ,["Blood integration contract registry", server.includes("BloodIntegrationGateway.dashboard") && readText("blood-integration-gateway.js").includes("IOT-TEMPERATURE")],
    ["Integration idempotency and dead letter", server.includes("BloodIntegrationGateway.retry") && server.includes("bloodIntegrationDeadLetters") && readText("blood-integration-gateway.js").includes("idempotentReplay")],
    ["Hospital and regional exchange mapping", readText("blood-integration-gateway.js").includes("WS/T 866+WS/T 867-2025") && readText("blood-integration-gateway.js").includes("REGIONAL-REPORT")]
    ,["Integration operations workbench", html.includes('id="integration"') && js.includes("renderIntegration")],
    ["Integration test and retry actions", js.includes("IOT-TEMPERATURE/receive") && js.includes("dead-letters/")]
    ,["All BIS and BTIS business domains", server.includes("BloodBusinessService.dashboard") && readText("blood-business-service.js").includes("autologous-treatment")],
    ["Business records and governed actions", server.includes("BloodBusinessService.create") && server.includes("BloodBusinessService.action")]
    ,["Role-scoped business operations UI", readText("blood-business.html").includes("血液业务中心") && readText("blood-business.js").includes("business/resources")],
    ["All business page entry", html.includes("blood-business.html")],
    ["Thirteen innovation capabilities", readText("blood-innovation-service.js").includes('"pda-bedside"') && require(path.join(ROOT, "blood-innovation-service.js")).capabilities.length === 13],
    ["Digital twin and regional inventory", readText("blood-innovation-service.js").includes("function twin") && readText("blood-innovation-service.js").includes("function inventoryNodes")],
    ["Forecast recruitment and rational-use engine", readText("blood-innovation-service.js").includes("function forecast") && readText("blood-innovation-service.js").includes("function rationalUse")],
    ["PDA and automated compliance actions", server.includes("BloodInnovationService.execute") && readText("blood-innovation-service.js").includes('capabilityId === "pda-bedside"') && readText("blood-innovation-service.js").includes('capabilityId === "compliance-check"')],
    ["Innovation command center UI", html.includes("blood-innovation.html") && readText("blood-innovation.html").includes("13项亮点能力") && readText("blood-innovation.js").includes("/api/blood-system/innovation")],
    ["Cross-module blood event contracts", require(path.join(ROOT, "blood-event-hub.js")).contracts.length === 6 && readText("blood-event-hub.js").includes('"quality-safety"') && readText("blood-event-hub.js").includes('"health-dashboard"')],
    ["Event idempotency dead letter and retry", readText("blood-event-hub.js").includes("stableId") && readText("blood-event-hub.js").includes('status: options.failConsumer === consumer ? "dead_letter"') && server.includes("BloodEventHub.retry")],
    ["Cross-module event operations UI", readText("blood-innovation.html").includes("跨模块事件枢纽") && readText("blood-innovation.js").includes("publish-events") && server.includes('url.pathname === "/api/blood-system/events/publish"')],
    ["Four consumer dashboards receive blood projections", ["emergency.html", "quality-safety.html", "operations.html", "health-dashboard.html"].every((file) => readText(file).includes("blood-coordination")) && ["emergency.js", "quality-safety.js", "operations.js", "health-dashboard.js"].every((file) => readText(file).includes("renderBloodCoordination"))],
    ["Consumer APIs expose scoped blood coordination", server.includes("dashboard.bloodCoordination") && server.includes("bloodCoordination: { ...bloodCoordination") && server.includes("bloodCoordination: BloodEventHub.dashboard")]
  ];
  const normalizedChecks = checks.map((item) => ({ name: item?.[0] || "Unnamed check", ok: Boolean(item?.[1]) }));
  return {
    system: "区域血液信息系统",
    generatedAt: new Date().toISOString(),
    passed: normalizedChecks.filter((item) => item.ok).length,
    total: checks.length,
    ok: normalizedChecks.every((item) => item.ok),
    checks: normalizedChecks
  };
}

function renderMarkdown(report) {
  const rows = report.checks.map((item) => `| ${item.ok ? "PASS" : "FAIL"} | ${item.name} |`);
  return [
    "# Blood system readiness report",
    "",
    `- System: ${report.system}`,
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Checks: ${report.passed}/${report.total}`,
    "",
    "| Result | Check |",
    "|---|---|",
    ...rows,
    ""
  ].join("\n");
}

function main() {
  const report = buildBloodSystemReadinessReport();
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { buildBloodSystemReadinessReport, renderMarkdown };
