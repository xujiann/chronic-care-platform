const fs = require("node:fs");
const path = require("node:path");
const Production = require("../physical-examination-production");

const ROOT = path.resolve(__dirname, "..");

function buildReport(options = {}) {
  const root = options.root || ROOT;
  const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
  const exists = (file) => fs.existsSync(path.join(root, file));
  const productionSource = read("physical-examination-production.js");
  const standaloneHtml = read("physical-examination-standalone.html");
  const standaloneClient = read("physical-examination-standalone.js");
  const dependencyRefs = [
    ...[...standaloneHtml.matchAll(/<script\s+src="\.\/([^"]+)"/g)].map((match) => match[1]),
    ...[...productionSource.matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1]),
    ...[...standaloneClient.matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1])
  ];
  const forbiddenDependencies = dependencyRefs.filter((item) => /(emergency|blood|imaging)/i.test(item));
  const noGoProbe = Production.buildGoLiveDecision({
    environment: "production",
    enabledSourceTypes: ["exam-center", "hospital"],
    mappingEvidence: [],
    integrationReceipts: [],
    reports: [],
    archiveEvidence: [],
    workflows: [],
    siteSignoffs: [],
    smoke: {},
    rollback: {}
  });
  const checks = [
    check("module:id", Production.MODULE_ID === "physical-examination", Production.MODULE_ID),
    check("module:version", /^physical-examination-production-v\d+$/.test(Production.VERSION), Production.VERSION),
    check("module:standalone-files", Production.REQUIRED_STANDALONE_FILES.every(exists), Production.REQUIRED_STANDALONE_FILES.join(", ")),
    check("module:domain-independence", forbiddenDependencies.length === 0, forbiddenDependencies.join(", ") || "no emergency/blood/imaging dependency"),
    check("mapping:profiles", Object.keys(Production.SOURCE_MAPPING_PROFILES).length === 2 && Object.values(Production.SOURCE_MAPPING_PROFILES).every((item) => item.version && item.fields.signature), "exam-center-v1 + hospital-v1"),
    check("mapping:receipt-validator", typeof Production.validateSourceMappingEvidence === "function" && typeof Production.validateIntegrationReceipt === "function", "mapping and landing receipts"),
    check("signature:contract", productionSource.includes("WS/T 847") || productionSource.includes("DIGITAL_SIGNATURE_STANDARD"), "WS/T 847 production signature and document binding"),
    check("closure:state-machine", ["confirm", "notify", "schedule-review", "family-doctor-followup", "close"].every((item) => Production.CLOSURE_ACTIONS.includes(item)), Production.CLOSURE_ACTIONS.join(", ")),
    check("archive:scan-evidence", typeof Production.validateArchiveEvidence === "function" && productionSource.includes("malware-scan-not-clean") && productionSource.includes("retention-less-than-15-years"), "checksum + malware scan + immutable 15-year retention"),
    check("site:independent-signoff", typeof Production.validateIndependentSignoff === "function" && productionSource.includes("signoff-self-verification-forbidden"), "submitter and verifier separation"),
    check("operations:smoke", typeof Production.validateStandaloneSmoke === "function" && standaloneHtml.includes("运行 Go-Live 门禁"), "standalone browser gate"),
    check("operations:rollback", typeof Production.validateRollbackGate === "function" && productionSource.includes("rollback-rto-not-met"), "snapshot + rehearsal + RTO + reconciliation"),
    check("boundary:no-go-default", noGoProbe.goLiveReady === false && noGoProbe.decision === "NO-GO" && noGoProbe.blockers.length > 0, `${noGoProbe.decision} / ${noGoProbe.blockers.length} blockers`)
  ];
  const passed = checks.filter((item) => item.passed).length;
  return {
    generatedAt: new Date().toISOString(),
    moduleId: Production.MODULE_ID,
    version: Production.VERSION,
    ok: passed === checks.length,
    codeReady: passed === checks.length,
    goLiveReady: false,
    decision: "NO-GO",
    summary: { checks: checks.length, passed, failed: checks.length - passed, sourceProfiles: Object.keys(Production.SOURCE_MAPPING_PROFILES).length },
    checks,
    externalDependencies: [
      "体检中心与医院生产端点、网络白名单、机器身份和非占位密钥",
      "WS/T 847—2024生产CA、SM2/SM3、ES-T时间戳和证书状态验证服务",
      "生产对象存储、服务端恶意文件扫描、15年不可变留存和备份恢复",
      "居民消息送达回执、复查预约回执、家庭医生随访回执",
      "双人现场验收、独立核验和正式回退演练证据"
    ],
    blockers: noGoProbe.blockers,
    commands: {
      syntax: "node --check physical-examination-production.js && node --check physical-examination-standalone.js",
      test: "node --test test/physical-examination-production.test.js",
      readiness: "node scripts/physical-examination-standalone-readiness.js"
    },
    integrationFiles: [
      "physical-examination-production.js",
      "physical-examination-standalone.html",
      "physical-examination-standalone.js",
      "scripts/physical-examination-standalone-readiness.js",
      "test/physical-examination-production.test.js",
      "docs/体检独立模块生产切换说明-2026-07-24.md"
    ],
    boundary: "代码就绪不等于生产上线；现场证据未独立核验或回退演练未通过时必须保持 NO-GO。"
  };
}

function check(id, passed, detail) {
  return { id, passed: Boolean(passed), detail };
}

function renderMarkdown(report) {
  return `# 健康体检独立模块就绪报告

- 生成时间：${report.generatedAt}
- 模块：${report.moduleId}
- 版本：${report.version}
- 代码就绪：${report.codeReady ? "是" : "否"}
- 正式上线：否（${report.decision}，等待真实现场证据）
- 检查：${report.summary.passed}/${report.summary.checks}

## 检查结果

${report.checks.map((item) => `- [${item.passed ? "x" : " "}] ${item.id}：${item.detail}`).join("\n")}

## 外部依赖

${report.externalDependencies.map((item) => `- ${item}`).join("\n")}

## 当前阻断

${report.blockers.map((item) => `- ${item}`).join("\n")}

## 可集成文件

${report.integrationFiles.map((item) => `- \`${item}\``).join("\n")}

> ${report.boundary}
`;
}

function writeReport(report, options = {}) {
  const outputDir = options.outputDir || path.join(ROOT, "release");
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "physical-examination-standalone-readiness-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(outputDir, "physical-examination-standalone-readiness-report.md"), renderMarkdown(report), "utf8");
}

if (require.main === module) {
  const report = buildReport();
  writeReport(report);
  console.log(JSON.stringify({ moduleId: report.moduleId, checks: report.summary.checks, passed: report.summary.passed, failed: report.summary.failed, decision: report.decision }));
  if (!report.ok) process.exitCode = 1;
}

module.exports = { buildReport, renderMarkdown, writeReport };
