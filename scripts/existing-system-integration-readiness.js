#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const BASELINE_PATH = "config/existing-system-integration-baseline.json";
const DOC_PATH = "docs/全民健康数智化现有系统融合实施基线-2026-07-24.md";
const DEFAULT_OUTPUT = path.join(ROOT, "release", "existing-system-integration-readiness.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "existing-system-integration-readiness.md");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function check(id, passed, detail, category = "baseline") {
  return { id, category, passed: Boolean(passed), detail };
}

function unique(values) {
  return new Set(values).size === values.length;
}

function buildExistingSystemIntegrationReadiness(options = {}) {
  const baseline = options.baseline || readJson(BASELINE_PATH);
  const connectorSource = options.connectorSource ?? read("hospital-connectors.js");
  const serverSource = options.serverSource ?? read("server.js");
  const documentation = options.documentation ?? read(DOC_PATH);
  const packageSource = options.packageSource ?? read("package.json");
  const systems = Array.isArray(baseline.systems) ? baseline.systems : [];
  const contracts = Array.isArray(baseline.contracts) ? baseline.contracts : [];
  const systemIds = new Set(systems.map((item) => item.id));
  const contractIds = new Set(contracts.map((item) => item.id));
  const requiredSystems = ["PLATFORM", "HIS", "EMR", "LIS", "PACS", "EHR", "PUBLIC_HEALTH", "INSURANCE", "PHARMACY"];
  const requiredContracts = baseline.firstLoop?.requiredContracts || [];
  const securityFields = ["transport", "authentication", "authorization", "audit", "minimization"];

  const checks = [
    check(
      "baseline:metadata",
      Boolean(baseline.metadata?.id && baseline.metadata?.version && baseline.metadata?.pilot && baseline.metadata?.productionReady === false),
      "基线具有版本、试点范围，并明确当前不能直接投入生产"
    ),
    check(
      "baseline:system-boundary",
      requiredSystems.every((id) => systemIds.has(id)) && systems.every((item) => item.owner && item.integrationMode && typeof item.systemOfRecord === "boolean"),
      `${systems.length}个系统均明确事实来源、责任方和集成方式`
    ),
    check(
      "baseline:unique-identifiers",
      unique(systems.map((item) => item.id)) && unique(contracts.map((item) => item.id)),
      "系统和接口标识无重复"
    ),
    check(
      "baseline:contract-references",
      contracts.length >= 7 && contracts.every((item) => systemIds.has(item.sourceSystem) && systemIds.has(item.targetSystem)),
      `${contracts.length}个接口均引用已登记系统`
    ),
    check(
      "baseline:first-loop",
      requiredContracts.length >= 5 && requiredContracts.every((id) => contractIds.has(id)) && (baseline.firstLoop?.acceptanceScenarios || []).length >= 5,
      `${requiredContracts.length}个首期接口和${baseline.firstLoop?.acceptanceScenarios?.length || 0}个验收场景`
    ),
    check(
      "contract:minimum-payload",
      contracts.every((item) => Array.isArray(item.payloadMinimum) && item.payloadMinimum.length >= 5 && item.standard),
      "每个接口均定义最小字段集和数据标准",
      "contract"
    ),
    check(
      "contract:resilience",
      contracts.every((item) => item.idempotencyKey && item.retry && item.errorQueue),
      "每个接口均定义幂等、重试和失败处置",
      "contract"
    ),
    check(
      "contract:security",
      contracts.every((item) => securityFields.every((field) => item.security?.[field])),
      "每个接口均定义传输、认证、授权、审计和最小化要求",
      "security"
    ),
    check(
      "contract:evidence",
      contracts.every((item) => Array.isArray(item.acceptanceEvidence) && item.acceptanceEvidence.length >= 3),
      "每个接口均具有至少3项验收证据",
      "evidence"
    ),
    check(
      "architecture:no-direct-write",
      (baseline.principles || []).some((item) => /禁止.*直接写入.*数据库/.test(item))
        && contracts.every((item) => !/数据库直写|direct database write/i.test(item.mode || "")),
      "平台禁止直接写入现有业务系统数据库",
      "architecture"
    ),
    check(
      "reuse:hospital-connectors",
      ["HIS", "EMR", "LIS", "PACS", "dispatchHospitalRequest", "X-Idempotency-Key", "HMAC-SHA256"].every((marker) => connectorSource.includes(marker)),
      "复用现有医院连接器的签名、幂等、超时和重试能力",
      "reuse"
    ),
    check(
      "reuse:runtime-loop",
      [
        "DIAGNOSTIC_INTEGRATION_CONTRACT_IDS",
        "landDiagnosticIntegrationEvent",
        "matched-existing-version",
        "reportVersion conflict",
        "source report revoked",
        "/api/imaging-cloud/ingest",
        "/api/imaging-cloud/studies/",
        "/mutual-recognition",
        "/api/regional-data-sharing",
        "countyMutualRecognitionRecords",
        "diagnosticReports",
        "personalRecords"
      ].every((marker) => serverSource.includes(marker)),
      "现有运行时具备LIS/PACS签名入站、版本修订撤销、影像接入、区域共享、互认、报告和健康档案索引能力",
      "reuse"
    ),
    check(
      "delivery:documentation",
      ["首期实施范围", "接口实施台账", "现场启动清单", "生产边界"].every((marker) => documentation.includes(marker)),
      "实施文档覆盖范围、接口、现场输入和生产边界",
      "delivery"
    ),
    check(
      "delivery:package-script",
      packageSource.includes("integration:kickoff-readiness") && packageSource.includes("existing-system-integration-readiness.js"),
      "已提供一键生成接入准备度报告的命令",
      "delivery"
    ),
    check(
      "production:blockers",
      baseline.metadata?.productionReady === false
        && (baseline.onsiteInputs || []).length >= 7
        && (baseline.productionBlockers || []).length >= 5,
      `${baseline.onsiteInputs?.length || 0}项现场输入、${baseline.productionBlockers?.length || 0}项生产阻断`,
      "production"
    )
  ];

  const engineeringReady = contracts.filter((item) => item.status === "engineering-ready").length;
  const onsiteRequired = systems.filter((item) => /onsite|external/.test(item.status || "")).length;
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    baseline: {
      id: baseline.metadata?.id,
      version: baseline.metadata?.version,
      pilot: baseline.metadata?.pilot,
      scope: baseline.metadata?.scope
    },
    productionReady: false,
    summary: {
      systems: systems.length,
      contracts: contracts.length,
      firstLoopContracts: requiredContracts.length,
      engineeringReadyContracts: engineeringReady,
      onsiteRequiredSystems: onsiteRequired,
      onsiteInputs: baseline.onsiteInputs?.length || 0,
      productionBlockers: baseline.productionBlockers?.length || 0,
      checks: checks.length,
      passed: checks.filter((item) => item.passed).length
    },
    firstLoop: baseline.firstLoop,
    systems,
    contracts,
    onsiteInputs: baseline.onsiteInputs || [],
    productionBlockers: baseline.productionBlockers || [],
    checks
  };
}

function clean(value) {
  return String(value || "").replace(/\|/g, "/");
}

function renderMarkdown(report) {
  return [
    "# 现有系统融合实施准备度报告",
    "",
    `- 生成时间：${report.generatedAt}`,
    `- 工程基线：${report.ok ? "通过" : "未通过"}`,
    `- 生产就绪：否（仍需现场参数与签字证据）`,
    `- 首期范围：${report.baseline.scope}`,
    `- 系统/接口：${report.summary.systems}/${report.summary.contracts}`,
    `- 首期闭环接口：${report.summary.firstLoopContracts}`,
    "",
    "## 自动检查",
    "",
    "| 结果 | 分类 | 检查项 | 说明 |",
    "|---|---|---|---|",
    ...report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.category} | ${item.id} | ${clean(item.detail)} |`),
    "",
    "## 首期接口",
    "",
    "| 接口 | 来源 | 目标 | 触发 | 方式 | 状态 |",
    "|---|---|---|---|---|---|",
    ...report.contracts
      .filter((item) => report.firstLoop.requiredContracts.includes(item.id))
      .map((item) => `| ${item.id} | ${item.sourceSystem} | ${item.targetSystem} | ${clean(item.trigger)} | ${clean(item.mode)} | ${item.status} |`),
    "",
    "## 现场输入",
    "",
    ...report.onsiteInputs.map((item) => `- ${item}`),
    "",
    "## 生产阻断",
    "",
    ...report.productionBlockers.map((item) => `- ${item}`),
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
  const report = buildExistingSystemIntegrationReadiness();
  writeOutput(report, parseArgs());
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

module.exports = {
  buildExistingSystemIntegrationReadiness,
  parseArgs,
  renderMarkdown,
  writeOutput
};
