#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "financial-gateway-readiness-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "financial-gateway-readiness-report.md");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function buildFinancialGatewayReadiness(options = {}) {
  const pkg = options.pkg || readJson("package.json");
  const adapterSource = options.adapterSource ?? read("financial-gateways.js");
  const refundSource = options.refundSource ?? read("online-payment-refunds.js");
  const serverSource = options.serverSource ?? read("server.js");
  const platformHtml = options.platformHtml ?? read("platform.html");
  const platformSource = options.platformSource ?? read("platform.js");
  const documentation = options.documentation ?? read("docs/production-financial-certificate-gateways.md");
  const environment = options.environment ?? read(".env.example");
  const releaseSource = options.releaseSource ?? read("scripts/release-report.js");
  const deploySource = options.deploySource ?? read("scripts/deploy-check.js");
  const manifestSource = options.manifestSource ?? read("scripts/release-artifact-manifest.js");
  const capabilities = [
    { id: "domain-operations", markers: ["PAYMENT", "INSURANCE", "CERTIFICATE", "create-payment", "settlement", "authorization-verify"] },
    { id: "request-security", markers: ["HMAC-SHA256", "X-Signature", "X-Idempotency-Key", "must use HTTPS in production"] },
    { id: "data-minimization", markers: ["FORBIDDEN_PAYLOAD_KEYS", "credentialToken", "documentBase64", "documentDigest must be a SHA-256 digest"] },
    { id: "money-integrity", markers: ["amountFen", "refundAmountFen", "positive integer in cents"] },
    { id: "resilience", markers: ["FINANCIAL_GATEWAY_MAX_ATTEMPTS", "retryable", "financial gateway request timed out"] },
    { id: "receipt", markers: ["receiptId", "providerCode", "financial-http-json-hmac"] },
    { id: "callback-security", markers: ["verifyFinancialCallback", "timingSafeEqual", "FINANCIAL_CALLBACK_REPLAY_DETECTED", "FINANCIAL_CALLBACK_MAX_SKEW_SECONDS"] },
    { id: "callback-state", markers: ["applyFinancialCallback", "superseded-receipt", "amount-mismatch", "terminal-conflict", "reversed"] },
    { id: "daily-reconciliation", markers: ["createFinancialReconciliationRun", "statementDigest", "grossAmountFen", "provider-summary-digest"] },
    {
      id: "online-refund-closed-loop",
      source: `${adapterSource}\n${refundSource}`,
      markers: [
        "createRefundRequest",
        "reviewRefundRequest",
        "REQUIRED_REFUND_REVIEW_DOMAINS",
        "prepareRefundDispatch",
        "syncRefundFromFinancialCallback",
        "providerReversal",
        "REFUND_AMOUNT_EXCEEDS_AVAILABLE",
        "REFUND_LEDGER_INVALID",
        "reconcileRefund",
        "refundOperations"
      ]
    },
    {
      id: "online-refund-sla-operations",
      source: refundSource,
      markers: [
        "REFUND_SLA_POLICY",
        "buildRefundSla",
        "buildRefundExceptionQueue",
        "provider-callback-overdue",
        "retry-exhausted",
        "ledger-invalid"
      ]
    }
  ].map((item) => {
    const source = item.source || adapterSource;
    const { source: _source, ...capability } = item;
    return { ...capability, passed: item.markers.every((marker) => source.includes(marker)) };
  });
  const apiMarkers = [
    "/api/financial-gateways",
    "/api/financial-gateways/dispatch",
    "/api/financial-gateways/callbacks/",
    "/api/financial-gateways/operations",
    "/api/financial-gateways/reconciliation-runs",
    "adapterType: \"financial\"",
    "event.adapterType === \"financial\"",
    "payment-transaction-v1"
  ];
  const envVariables = [
    "FINANCIAL_GATEWAY_SECRET",
    "PAYMENT_GATEWAY_URL",
    "INSURANCE_GATEWAY_URL",
    "CERTIFICATE_GATEWAY_URL",
    "FINANCIAL_GATEWAY_TIMEOUT_MS",
    "FINANCIAL_GATEWAY_MAX_ATTEMPTS",
    "FINANCIAL_CALLBACK_SECRET",
    "FINANCIAL_CALLBACK_MAX_SKEW_SECONDS"
  ];
  const checks = [
    { id: "financialGateway:capabilities", passed: capabilities.every((item) => item.passed), detail: `${capabilities.filter((item) => item.passed).length}/${capabilities.length} capability groups` },
    { id: "financialGateway:api", passed: apiMarkers.every((marker) => serverSource.includes(marker)), detail: `${apiMarkers.filter((marker) => serverSource.includes(marker)).length}/${apiMarkers.length} runtime markers` },
    { id: "financialGateway:operationsUi", passed: ["financial-gateway-operations-center", "financial-gateway-callback-events", "financial-reconciliation-runs", "financial-reconciliation-dialog"].every((marker) => platformHtml.includes(marker)) && ["renderFinancialGatewayOperationsCenter", "loadFinancialGatewayOperationsCenter", "financial-gateways/reconciliation-runs"].every((marker) => platformSource.includes(marker)), detail: "commission callback, exception and daily reconciliation operations UI" },
    { id: "financialGateway:environment", passed: envVariables.every((marker) => environment.includes(marker)), detail: `${envVariables.filter((marker) => environment.includes(marker)).length}/${envVariables.length} environment variables documented` },
    { id: "financialGateway:boundary", passed: ["适配器基础通过不等于支付、医保或电子证照已经正式验收", "签名回调代码就绪", "摘要级日终对账", "现场联合测试回执"].every((marker) => documentation.includes(marker)), detail: "credentials, callbacks, reconciliation and signed acceptance boundaries documented" },
    { id: "financialGateway:releaseWiring", passed: Boolean(pkg.scripts?.["financial-gateway:readiness"]) && releaseSource.includes("buildFinancialGatewayReadiness") && deploySource.includes("financialGatewayReadiness") && manifestSource.includes("financial-gateway-readiness-report"), detail: "package, release report, deploy check and manifest wiring" }
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    status: "signed-callback-reconciliation-ready-site-joint-test-pending",
    productionReady: false,
    summary: {
      gateways: 3,
      operations: 14,
      capabilityGroups: capabilities.length,
      capabilityGroupsReady: capabilities.filter((item) => item.passed).length,
      productionBlockers: 6
    },
    capabilities,
    envVariables,
    blockers: [
      "merchant, insurance-agency and certificate-authority credentials",
      "provider-specific callback mapping, source allowlist and replay-protection joint test",
      "payment and insurance statement transport plus daily reconciliation acceptance",
      "provider field dictionaries and error-code mapping signoff",
      "security, privacy and cryptography assessments",
      "signed site and agency acceptance receipts"
    ],
    checks
  };
}

function renderMarkdown(report) {
  return [
    "# Financial and certificate gateway readiness",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Status: ${report.status}`,
    `- Production ready: ${report.productionReady ? "yes" : "no"}`,
    "",
    "## Checks",
    "",
    "| Result | Check | Detail |",
    "|---|---|---|",
    ...report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${String(item.detail).replace(/\|/g, "/")} |`),
    "",
    "## Production blockers",
    "",
    ...report.blockers.map((item) => `- ${item}`),
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
  const report = buildFinancialGatewayReadiness();
  if (flags.write !== "false" && flags.write !== false) writeOutput(report, flags);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

if (require.main === module) runCli();

module.exports = { buildFinancialGatewayReadiness, parseArgs, renderMarkdown, writeOutput };
