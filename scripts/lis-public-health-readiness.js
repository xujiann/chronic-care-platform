#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "lis-public-health-readiness-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "lis-public-health-readiness-report.md");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function buildLisPublicHealthReadiness(options = {}) {
  const connectorSource = options.connectorSource ?? read("public-health-connectors.js");
  const integrationSource = options.integrationSource ?? read("medical-public-health-integration.js");
  const mappingSource = options.mappingSource ?? read("scripts/interface-mapping.js");
  const connectorTestSource = options.connectorTestSource ?? read("test/public-health-connectors.test.js");
  const integrationTestSource = options.integrationTestSource ?? read("test/medical-public-health-integration.test.js");
  const documentation = options.documentation ?? read("docs/lis-public-health-first-increment.md");
  const serverSource = options.serverSource ?? read("server.js");
  const checks = [
    {
      id: "lisPublicHealth:connector",
      passed: [
        "PUBLIC_HEALTH_DIRECT_REPORT_URL",
        "PUBLIC_HEALTH_REFERENCE_SECRET",
        "HMAC-SHA256",
        "createKeyedReference",
        "hmac-sha256:v1",
        "DIRECT_REPORT_REFERENCE_SECRET_WEAK",
        "X-Idempotency-Key",
        "verifyDirectReportCallback",
        "nonceDigest"
      ].every((marker) => connectorSource.includes(marker)),
      detail: "signed HTTPS dispatch, bounded retry and verified callback foundation"
    },
    {
      id: "lisPublicHealth:landing",
      passed: [
        "validateLisReport",
        "buildDiagnosticReport",
        "publicHealthReportRequired",
        "payloadDigest",
        "rawInboundPayloadStored",
        "LIS_AUTHENTICATED_INSTITUTION_REQUIRED",
        "isIssuedCrossInstitutionAuthorization"
      ].every((marker) => integrationSource.includes(marker)),
      detail: "LIS validation, idempotent diagnostic landing and minimized evidence"
    },
    {
      id: "lisPublicHealth:compensation",
      passed: [
        "retryDirectReport",
        "dead-letter",
        "manual-reconciliation-required",
        "applyDirectReportCallback",
        "DIRECT_REPORT_CALLBACK_REPLAY_DETECTED"
      ].every((marker) => integrationSource.includes(marker)),
      detail: "dead letter, bounded manual retry and provider final callback"
    },
    {
      id: "lisPublicHealth:mapping",
      passed: mappingSource.includes('"public-health-direct-report-v1"')
        && mappingSource.includes('targetCollection: "publicHealthEvents"')
        && mappingSource.includes('owner: "public-health-integration"'),
      detail: "draft direct-report contract mapping is ready for the shared contract registry"
    },
    {
      id: "lisPublicHealth:tests",
      passed: [
        "positive LIS result",
        "enters dead letter",
        "callback closes",
        "retries transient failures",
        "rejects direct identifiers",
        "keyed subject and specimen references",
        "missing-org",
        "process-issued capability"
      ].every((marker) => `${connectorTestSource}\n${integrationTestSource}`.includes(marker)),
      detail: "normal, duplicate, signature, minimization, retry, dead letter and callback coverage"
    },
    {
      id: "lisPublicHealth:handoff",
      passed: [
        "T00 integration hooks",
        "PUBLIC_HEALTH_DIRECT_REPORT_URL",
        "PUBLIC_HEALTH_REFERENCE_SECRET",
        "hmac-sha256:v1",
        "productionReady",
        "signed joint-test receipt"
      ].every((marker) => documentation.includes(marker)),
      detail: "shared server, environment, release and site acceptance boundaries documented"
    }
  ];
  const integrationHooks = {
    serverImportsReady: serverSource.includes("medical-public-health-integration"),
    connectorStatusRouteReady: serverSource.includes("/api/public-health/direct-report/connector"),
    callbackRouteReady: serverSource.includes("/api/public-health/direct-report/callback"),
    retryRouteReady: serverSource.includes("/api/public-health/direct-report/events/:id/retry")
  };
  return {
    ok: checks.every((item) => item.passed),
    handoffReady: checks.every((item) => item.passed),
    productionReady: false,
    status: "code-ready-t00-hook-and-site-joint-test-pending",
    generatedAt: new Date().toISOString(),
    contractIds: ["lis-report-v1", "public-health-direct-report-v1"],
    checks,
    integrationHooks,
    blockers: [
      ...(!Object.values(integrationHooks).every(Boolean) ? ["T00 shared server route and persistence integration"] : []),
      "official public-health direct-report field version",
      "site endpoint, VPN or allowlist and agency credentials",
      "hospital LIS account and signing-key handoff",
      "signed positive-result callback and direct-report receipt"
    ]
  };
}

function renderMarkdown(report) {
  return [
    "# LIS to public-health direct-report readiness",
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
  const report = buildLisPublicHealthReadiness();
  if (flags.write !== "false" && flags.write !== false) writeOutput(report, flags);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

if (require.main === module) runCli();

module.exports = { buildLisPublicHealthReadiness, parseArgs, renderMarkdown, writeOutput };
