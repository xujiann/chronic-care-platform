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
  const serverSource = options.serverSource ?? read("server.js");
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
    { id: "receipt", markers: ["receiptId", "providerCode", "financial-http-json-hmac"] }
  ].map((item) => ({ ...item, passed: item.markers.every((marker) => adapterSource.includes(marker)) }));
  const apiMarkers = [
    "/api/financial-gateways",
    "/api/financial-gateways/dispatch",
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
    "FINANCIAL_GATEWAY_MAX_ATTEMPTS"
  ];
  const checks = [
    { id: "financialGateway:capabilities", passed: capabilities.every((item) => item.passed), detail: `${capabilities.filter((item) => item.passed).length}/${capabilities.length} capability groups` },
    { id: "financialGateway:api", passed: apiMarkers.every((marker) => serverSource.includes(marker)), detail: `${apiMarkers.filter((marker) => serverSource.includes(marker)).length}/${apiMarkers.length} runtime markers` },
    { id: "financialGateway:environment", passed: envVariables.every((marker) => environment.includes(marker)), detail: `${envVariables.filter((marker) => environment.includes(marker)).length}/${envVariables.length} environment variables documented` },
    { id: "financialGateway:boundary", passed: ["适配器基础通过不等于支付、医保或电子证照已经正式验收", "回调的来源校验、验签、防重放与乱序处理", "日终对账", "现场联合测试回执"].every((marker) => documentation.includes(marker)), detail: "credentials, callbacks, reconciliation and signed acceptance boundaries documented" },
    { id: "financialGateway:releaseWiring", passed: Boolean(pkg.scripts?.["financial-gateway:readiness"]) && releaseSource.includes("buildFinancialGatewayReadiness") && deploySource.includes("financialGatewayReadiness") && manifestSource.includes("financial-gateway-readiness-report"), detail: "package, release report, deploy check and manifest wiring" }
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    status: "adapter-foundation-ready-site-joint-test-pending",
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
      "signed callback verification and replay protection joint test",
      "payment and insurance daily reconciliation acceptance",
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
