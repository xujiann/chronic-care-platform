#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const { buildJointTestPackage } = require("../interface-joint-test-package");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "full-interface-integration-readiness.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "full-interface-integration-readiness.md");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function containsEvery(source, markers) {
  return markers.every((marker) => source.includes(marker));
}

function buildFullInterfaceIntegrationReadiness(options = {}) {
  const interfaceSource = options.interfaceSource ?? read("interface-domain-integration.js");
  const securityContextSource = options.securityContextSource ?? read("interface-security-context.js");
  const financialSource = options.financialSource ?? read("financial-domain-integration.js");
  const publicHealthSource = options.publicHealthSource ?? read("medical-public-health-integration.js");
  const connectorSource = options.connectorSource ?? read("public-health-connectors.js");
  const mappingSource = options.mappingSource ?? read("scripts/interface-mapping.js");
  const tests = options.tests ?? [
    read("test/interface-domain-integration.test.js"),
    read("test/interface-security-context.test.js"),
    read("test/financial-domain-integration.test.js"),
    read("test/medical-public-health-integration.test.js"),
    read("test/public-health-connectors.test.js"),
    read("test/interface-joint-test-package.test.js")
  ].join("\n");
  const documentation = options.documentation ?? read("docs/full-interface-integration-handoff.md");
  const serverSource = options.serverSource ?? read("server.js");
  const jointTestPackage = options.jointTestPackage ?? buildJointTestPackage();
  const checks = [
    {
      id: "fullInterface:medicalLanding",
      passed: containsEvery(interfaceSource, ["his-patient-v1", "emr-summary-v1", "pacs-report-v1", "ingestInterfaceEvent", "retryInboundLanding", "INTERFACE_IDEMPOTENCY_PAYLOAD_CONFLICT", "INTERFACE_AUTHENTICATED_INSTITUTION_REQUIRED"]),
      detail: "HIS, EMR and PACS normalized landing, scoped idempotency and compensation"
    },
    {
      id: "fullInterface:institutionAuthorization",
      passed: containsEvery(interfaceSource, ["isIssuedCrossInstitutionAuthorization"])
        && containsEvery(publicHealthSource, ["isIssuedCrossInstitutionAuthorization"])
        && containsEvery(securityContextSource, ["WeakSet", "issueCrossInstitutionAuthorization", "isIssuedCrossInstitutionAuthorization"]),
      detail: "cross-institution routing requires a process-issued non-JSON-forgeable accountable capability"
    },
    {
      id: "fullInterface:lisPublicHealth",
      passed: containsEvery(publicHealthSource, ["ingestLisReport", "retryDirectReport", "applyDirectReportCallback", "publicHealthReportRequired", "LIS_AUTHENTICATED_INSTITUTION_REQUIRED"])
        && containsEvery(connectorSource, ["PUBLIC_HEALTH_DIRECT_REPORT_URL", "PUBLIC_HEALTH_REFERENCE_SECRET", "HMAC-SHA256", "hmac-sha256:v1", "createKeyedReference", "verifyDirectReportCallback"]),
      detail: "LIS landing and minimized signed public-health direct report"
    },
    {
      id: "fullInterface:financialProjection",
      passed: containsEvery(financialSource, ["applyFinancialCallbackAndSync", "projectInsurance", "projectCertificate", "retryFinancialProjection", "pending-reconciliation"]),
      detail: "verified insurance and certificate callback projection with P0 reconciliation"
    },
    {
      id: "fullInterface:mapping",
      passed: ["his-patient-v1", "emr-summary-v1", "lis-report-v1", "pacs-report-v1", "insurance-settlement-v1", "certificate-sync-v1", "public-health-direct-report-v1"]
        .every((contractId) => mappingSource.includes(`"${contractId}"`)),
      detail: "seven P0 contracts have field mappings"
    },
    {
      id: "fullInterface:jointTestPackage",
      passed: jointTestPackage.p0Interfaces?.length === 7
        && jointTestPackage.fieldResponsibilityMatrix?.length === 7
        && Object.keys(jointTestPackage.sampleMessages || {}).length === 7
        && jointTestPackage.testChecklist?.length >= 10
        && jointTestPackage.acceptanceStandards?.length >= 8,
      detail: "P0 list, responsibility matrix, samples, environment, test and acceptance package"
    },
    {
      id: "fullInterface:tests",
      passed: containsEvery(tests, ["HIS and EMR", "PACS report", "missing-org", "process-issued capability", "not JSON-forgeable", "keyed subject and specimen references", "insurance callback", "certificate issue", "direct-report callback", "joint-test samples"]),
      detail: "normal, replay, security, dead-letter, callback and compensation tests"
    },
    {
      id: "fullInterface:handoff",
      passed: containsEvery(documentation, ["责任部门", "外部依赖", "实施步骤", "文件边界", "测试清单", "验收标准", "T00 集成钩子", "productionReady=false"]),
      detail: "responsibilities, dependencies, execution, boundaries, tests, acceptance and T00 hooks documented"
    }
  ];
  const integrationHooks = {
    domainImportsReady: serverSource.includes("interface-domain-integration"),
    financialProjectionImportReady: serverSource.includes("financial-domain-integration"),
    inboundLandingRouteReady: serverSource.includes("ingestInterfaceEvent("),
    financialCallbackProjectionReady: serverSource.includes("applyFinancialCallbackAndSync("),
    publicHealthCallbackRouteReady: serverSource.includes("/api/public-health/direct-report/callback"),
    compensationRoutesReady: serverSource.includes("retryInboundLanding(") && serverSource.includes("retryFinancialProjection(")
  };
  const handoffReady = checks.every((item) => item.passed);
  return {
    ok: handoffReady,
    handoffReady,
    productionReady: false,
    status: "code-and-joint-test-package-ready-t00-hook-and-real-site-evidence-pending",
    generatedAt: new Date().toISOString(),
    contractIds: jointTestPackage.p0Interfaces.map((item) => item.contractId),
    checks,
    integrationHooks,
    blockers: [
      ...(!Object.values(integrationHooks).every(Boolean) ? ["T00 shared server routes, callback handlers and persistence wiring"] : []),
      ...jointTestPackage.externalDependencies,
      "real site evidence is not generated by local automated tests"
    ]
  };
}

function renderMarkdown(report) {
  return [
    "# Full interface integration readiness",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Foundation result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Handoff ready: ${report.handoffReady ? "yes" : "no"}`,
    `- Production ready: ${report.productionReady ? "yes" : "no"}`,
    `- Status: ${report.status}`,
    "",
    "## Checks",
    "",
    "| Result | Check | Detail |",
    "|---|---|---|",
    ...report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${item.detail} |`),
    "",
    "## T00 integration hooks",
    "",
    ...Object.entries(report.integrationHooks).map(([key, ready]) => `- ${ready ? "READY" : "PENDING"}: ${key}`),
    "",
    "## Production blockers",
    "",
    ...report.blockers.map((item) => `- ${item}`),
    ""
  ].join("\n");
}

function parseArgs(argv = process.argv.slice(2)) {
  return argv.reduce((flags, flag) => {
    if (!flag.startsWith("--")) return flags;
    const [key, ...rest] = flag.slice(2).split("=");
    flags[key] = rest.length ? rest.join("=") : true;
    return flags;
  }, {});
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
  const report = buildFullInterfaceIntegrationReadiness();
  if (flags.write !== "false" && flags.write !== false) writeOutput(report, flags);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

if (require.main === module) runCli();

module.exports = { buildFullInterfaceIntegrationReadiness, parseArgs, renderMarkdown, writeOutput };
