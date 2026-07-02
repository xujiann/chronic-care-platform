#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { buildSiteReadinessPack } = require("./site-readiness-pack");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "onsite-launch-requirements.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "onsite-launch-requirements.md");

const REQUIREMENTS = [
  {
    id: "OSL-01",
    domain: "environment",
    owner: "platform-ops",
    priority: "P0",
    title: "Production domain, HTTPS, process, logs, and reverse proxy",
    requiredInputs: ["production domain", "HTTPS certificate", "reverse proxy route", "Node.js process plan", "log directory permissions"],
    acceptance: ["/api/health returns HTTP 200", "launch:smoke passes against the production base URL"],
    evidence: ["release/launch-smoke-report.md", "deployment change record"]
  },
  {
    id: "OSL-02",
    domain: "secrets",
    owner: "security-admin",
    priority: "P0",
    title: "Production secrets and environment variables",
    requiredInputs: [".env", "NODE_ENV=production", "SESSION_SECRETS", "INTEGRATION_GATEWAY_SECRET", "secret handover record"],
    acceptance: ["env:check:production passes", "no placeholder secrets are used"],
    evidence: ["release/environment-matrix-report.md", "secret handover signoff"]
  },
  {
    id: "OSL-03",
    domain: "identity",
    owner: "identity-integration",
    priority: "P0",
    title: "Government identity source and resident real-name verification",
    requiredInputs: ["OIDC or SAML metadata", "callback URL", "sample claims", "role and organization mapping", "resident real-name verification rule"],
    acceptance: ["identity:contract matches site identity fields", "login, logout, and token refresh are traceable"],
    evidence: ["release/identity-contract.md", "identity joint-test record"]
  },
  {
    id: "OSL-04",
    domain: "sms",
    owner: "mobile-team",
    priority: "P0",
    title: "Resident SMS gateway and failed-attempt control",
    requiredInputs: ["SMS_GATEWAY_URL", "SMS template", "signature", "delivery receipt", "retry and rate-limit rule"],
    acceptance: ["resident phone-code login sends through the production gateway", "failed login lockout and audit evidence are reproducible"],
    evidence: ["release/citizen-launch-foundation-readiness.md", "SMS delivery log"]
  },
  {
    id: "OSL-05",
    domain: "medical-interfaces",
    owner: "institution-integration",
    priority: "P0",
    title: "HIS, EMR, LIS, and PACS joint-test evidence",
    requiredInputs: ["field dictionary", "sample request", "sample response", "signature log", "idempotency key", "retry evidence"],
    acceptance: ["health archive, EMR, lab, and imaging read-only loops pass with real hospital data"],
    evidence: ["release/interface-mapping-report.md", "hospital joint-test sheet"]
  },
  {
    id: "OSL-06",
    domain: "resident-services",
    owner: "service-operations",
    priority: "P0",
    title: "Registration, escort, and internet nursing service pilots",
    requiredInputs: ["service catalog", "provider registry", "worker qualification", "dispatch rule", "cancellation rule", "hospital receipt"],
    acceptance: ["resident request, institution handling, message receipt, quality review, and audit trail are closed-loop"],
    evidence: ["release/escort-service-readiness-report.md", "release/internet-nursing-readiness-report.md", "site service order screenshots"]
  },
  {
    id: "OSL-07",
    domain: "insurance-certificates",
    owner: "cross-agency-integration",
    priority: "P0",
    title: "Insurance, payment, and certificate exchange",
    requiredInputs: ["insurance pre-check rule", "payment callback", "refund rule", "certificate authorization", "manual compensation workflow"],
    acceptance: ["transaction samples, callbacks, retry records, and exception handling are archived"],
    evidence: ["release/integration-readiness-report.md", "insurance and certificate joint-test record"]
  },
  {
    id: "OSL-08",
    domain: "database",
    owner: "data-platform",
    priority: "P0",
    title: "Production data store, migration, backup, and restore rehearsal",
    requiredInputs: ["database topology", "migration script", "backup policy", "restore rehearsal", "RTO/RPO"],
    acceptance: ["production primary storage is approved", "restore rehearsal has a signed result"],
    evidence: ["release/production-db-readiness-report.md", "restore rehearsal record"]
  },
  {
    id: "OSL-09",
    domain: "security",
    owner: "security-admin",
    priority: "P0",
    title: "Security assessment, privacy, audit retention, and risk closure",
    requiredInputs: ["security assessment", "penetration test", "privacy policy", "audit retention target", "risk waiver or closure sheet"],
    acceptance: ["no unwaived high-risk issue remains", "resident authorization, revocation, and audit trails can be reproduced"],
    evidence: ["release/audit-retention-report.md", "security closure ledger"]
  },
  {
    id: "OSL-10",
    domain: "monitoring",
    owner: "platform-ops",
    priority: "P0",
    title: "Monitoring, alerting, on-call, and SLO operation",
    requiredInputs: ["metrics scrape target", "SLO threshold", "alert rule", "on-call roster", "escalation path"],
    acceptance: ["/api/metrics is scraped", "slow request, error rate, dead letter, and data-quality alerts reach on-call staff"],
    evidence: ["release/monitoring-readiness-report.md", "on-call roster"]
  },
  {
    id: "OSL-11",
    domain: "resilience",
    owner: "data-platform",
    priority: "P0",
    title: "Disaster recovery and rollback rehearsal",
    requiredInputs: ["backup copy", "rollback script", "read-only downgrade plan", "emergency contacts", "DR rehearsal record"],
    acceptance: ["at least one restore drill is complete", "rollback window and owners are explicit"],
    evidence: ["release/rollback-snapshot.md", "DR rehearsal signoff"]
  },
  {
    id: "OSL-12",
    domain: "resident-mobile",
    owner: "mobile-team",
    priority: "P1",
    title: "Mini-program, app, and PWA acceptance",
    requiredInputs: ["mini-program filing", "app signing", "PWA domain", "privacy policy", "mobile screenshot pack"],
    acceptance: ["bottom navigation, secondary page return, weak-network prompt, and 44px touch targets pass on site devices"],
    evidence: ["release/citizen-launch-foundation-readiness.md", "mobile acceptance screenshots"]
  },
  {
    id: "OSL-13",
    domain: "gray-release",
    owner: "project-office",
    priority: "P0",
    title: "Gray release scope, signoff, issue-zero list, and emergency duty",
    requiredInputs: ["launch scope", "resident whitelist", "issue-zero list", "risk waiver", "business/technical/security/site signatures"],
    acceptance: ["no P0/P1 blocker remains", "gray release boundary and rollback rule are signed"],
    evidence: ["release/production-cutover-checklist.md", "site signoff sheet"]
  }
];

function readJson(relativePath, fallback = null) {
  const fullPath = path.join(ROOT, relativePath);
  if (!fs.existsSync(fullPath)) return fallback;
  return JSON.parse(fs.readFileSync(fullPath, "utf8"));
}

function parseArgs(argv = process.argv.slice(2)) {
  const flags = {};
  argv.forEach((arg) => {
    if (!arg.startsWith("--")) return;
    const [key, ...rest] = arg.slice(2).split("=");
    flags[key] = rest.length ? rest.join("=") : true;
  });
  return {
    output: flags.output || DEFAULT_OUTPUT,
    markdown: flags.markdown || DEFAULT_MARKDOWN,
    envFile: flags["config-env"] || flags["env-file"] || ".env.example"
  };
}

function buildOnsiteLaunchRequirements(options = {}) {
  const pkg = options.pkg || readJson("package.json", {});
  const sitePack = options.sitePack || buildSiteReadinessPack({ envFile: options.envFile || ".env.example", env: options.env });
  const releaseReport = options.releaseReport === undefined ? readJson("release/release-report.json", null) : options.releaseReport;
  const requiredScripts = ["check", "test", "deploy:check", "release:report", "release:manifest", "launch:smoke", "site:pack"];
  const blockingConditions = REQUIREMENTS
    .filter((item) => item.priority === "P0")
    .map((item) => ({
      id: `${item.id}-blocker`,
      requirementId: item.id,
      domain: item.domain,
      owner: item.owner,
      condition: `${item.title} must have signed site evidence before formal production cutover.`
    }));
  const checks = [
    { id: "onsite:model", passed: REQUIREMENTS.length >= 12, detail: `${REQUIREMENTS.length} launch requirements modeled` },
    { id: "onsite:p0-coverage", passed: REQUIREMENTS.filter((item) => item.priority === "P0").length >= 10, detail: `${REQUIREMENTS.filter((item) => item.priority === "P0").length} P0 requirements` },
    { id: "onsite:evidence", passed: REQUIREMENTS.every((item) => item.requiredInputs.length >= 4 && item.acceptance.length >= 1 && item.evidence.length >= 1), detail: "each requirement has inputs, acceptance, and evidence" },
    { id: "onsite:resident-mobile", passed: REQUIREMENTS.some((item) => item.domain === "resident-mobile") && REQUIREMENTS.some((item) => item.domain === "resident-services"), detail: "resident mobile and resident service pilots are covered" },
    { id: "onsite:site-pack", passed: sitePack.ok === true && sitePack.checks?.some((item) => item.id === "site-pack:onsite-materials" && item.passed), detail: "site readiness pack includes onsite materials" },
    { id: "onsite:release-gates", passed: requiredScripts.every((name) => Boolean(pkg.scripts?.[name])), detail: requiredScripts.join(", ") },
    { id: "onsite:release-report", passed: !releaseReport || releaseReport.ok === true, detail: releaseReport?.ok === true ? "latest release report is green" : "release report will be generated by release:report" }
  ];
  const owners = [...new Set(REQUIREMENTS.map((item) => item.owner))].sort();
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    formalGoLiveState: "blocked-until-site-materials-signed",
    summary: {
      requirements: REQUIREMENTS.length,
      p0Requirements: REQUIREMENTS.filter((item) => item.priority === "P0").length,
      owners: owners.length,
      blockingConditions: blockingConditions.length
    },
    owners,
    requirements: REQUIREMENTS,
    blockingConditions,
    checks,
    sourceArtifacts: [
      "docs/on-site-launch-materials.md",
      "docs/production-go-live-requirements.md",
      "release/site-readiness-pack.md",
      "release/production-cutover-checklist.md",
      "release/launch-smoke-report.md",
      "release/release-report.md"
    ]
  };
}

function renderMarkdown(report) {
  const requirementRows = report.requirements.map((item) => `| ${item.priority} | ${item.id} | ${item.domain} | ${item.owner} | ${item.title.replace(/\|/g, "/")} | ${item.evidence.join(", ").replace(/\|/g, "/")} |`);
  const blockerRows = report.blockingConditions.map((item) => `| ${item.requirementId} | ${item.domain} | ${item.owner} | ${item.condition.replace(/\|/g, "/")} |`);
  const checkRows = report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${String(item.detail || "").replace(/\|/g, "/")} |`);
  return [
    "# On-site launch requirements",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Formal go-live state: ${report.formalGoLiveState}`,
    `- Requirements: ${report.summary.requirements}`,
    `- P0 requirements: ${report.summary.p0Requirements}`,
    `- Blocking conditions: ${report.summary.blockingConditions}`,
    "",
    "## Checks",
    "",
    "| Result | Check | Detail |",
    "|---|---|---|",
    ...checkRows,
    "",
    "## Requirement Matrix",
    "",
    "| Priority | ID | Domain | Owner | Requirement | Evidence |",
    "|---|---|---|---|---|---|",
    ...requirementRows,
    "",
    "## Blocking Conditions",
    "",
    "| Requirement | Domain | Owner | Condition |",
    "|---|---|---|---|",
    ...blockerRows,
    "",
    "## Source Artifacts",
    "",
    ...report.sourceArtifacts.map((item) => `- ${item}`),
    ""
  ].join("\n");
}

function writeOutput(report, flags = {}) {
  const output = path.resolve(ROOT, String(flags.output || DEFAULT_OUTPUT));
  const markdown = path.resolve(ROOT, String(flags.markdown || DEFAULT_MARKDOWN));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2), "utf8");
  fs.mkdirSync(path.dirname(markdown), { recursive: true });
  fs.writeFileSync(markdown, renderMarkdown(report), "utf8");
}

async function runCli() {
  const flags = parseArgs();
  const report = buildOnsiteLaunchRequirements(flags);
  writeOutput(report, flags);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

if (require.main === module) {
  runCli().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  buildOnsiteLaunchRequirements,
  parseArgs,
  renderMarkdown,
  writeOutput
};
