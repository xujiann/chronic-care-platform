#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

const ENVIRONMENT_PROFILES = [
  {
    id: "demo",
    name: "Demo static and local API",
    owner: "product-demo",
    envFile: ".env.example",
    requiredVars: ["PORT", "NODE_ENV", "STORAGE_ENGINE", "SESSION_SECRETS", "INTEGRATION_GATEWAY_SECRET"],
    blockedVars: [],
    gateScripts: ["env:check", "release:report"],
    acceptance: "Demo profile can use template secrets and local SQLite/JSON snapshot evidence."
  },
  {
    id: "staging",
    name: "Pre-production joint testing",
    owner: "platform-ops",
    envFile: ".env.staging",
    requiredVars: ["NODE_ENV", "STORAGE_ENGINE", "SESSION_SECRETS", "INTEGRATION_GATEWAY_SECRET", "OIDC_ISSUER_URL", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET", "SMS_GATEWAY_URL", "AUDIT_EXPORT_PATH"],
    blockedVars: ["STORAGE_ENGINE=json"],
    gateScripts: ["env:check:production", "integration:readiness", "operations:readiness", "monitoring:readiness"],
    acceptance: "Staging must use non-placeholder secrets, identity adapter values, audit retention, and signed interface test records."
  },
  {
    id: "production",
    name: "Production cutover environment",
    owner: "release-manager",
    envFile: ".env",
    requiredVars: ["NODE_ENV", "STORAGE_ENGINE", "SESSION_SECRETS", "INTEGRATION_GATEWAY_SECRET", "OIDC_ISSUER_URL", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET", "SMS_GATEWAY_URL", "AUDIT_EXPORT_PATH", "CUTOVER_SITE_INTERFACE_SIGNOFF", "CUTOVER_INSURANCE_CERTIFICATE_SIGNOFF", "CUTOVER_MONITORING_SIGNOFF", "CUTOVER_DR_REHEARSAL_SIGNOFF"],
    blockedVars: ["STORAGE_ENGINE=json", "STORAGE_ENGINE=postgres", "STORAGE_ENGINE=postgresql"],
    gateScripts: ["env:check:production", "deploy:check:full", "release:report:full"],
    acceptance: "Production remains blocked until real site signoffs, monitoring, DR rehearsal, identity, and audit-retention evidence are archived."
  }
];

function read(relativePath, fallback = "") {
  const file = path.join(ROOT, relativePath);
  if (!fs.existsSync(file)) return fallback;
  return fs.readFileSync(file, "utf8");
}

function readJson(relativePath, fallback = {}) {
  try {
    return JSON.parse(read(relativePath, "{}"));
  } catch {
    return fallback;
  }
}

function parseEnvTemplate(source) {
  const entries = new Map();
  String(source || "").split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim().replace(/^#\s*/, "");
    if (!trimmed || !trimmed.includes("=")) return;
    const [key, ...valueParts] = trimmed.split("=");
    entries.set(key.trim(), valueParts.join("=").trim());
  });
  return entries;
}

function check(id, passed, detail, severity = "error") {
  return { id, passed: Boolean(passed), detail, severity };
}

function buildEnvironmentMatrixReport(options = {}) {
  const pkg = options.pkg || readJson("package.json");
  const data = options.data || readJson("data/db.json");
  const envTemplate = parseEnvTemplate(options.envTemplate ?? read(".env.example"));
  const readme = options.readme ?? read("README.md");
  const deployment = options.deployment ?? read("DEPLOYMENT.md");
  const profileRows = ENVIRONMENT_PROFILES.map((profile) => {
    const missingTemplateVars = profile.requiredVars.filter((name) => !envTemplate.has(name));
    const missingScripts = profile.gateScripts.filter((script) => !pkg.scripts?.[script]);
    const deploymentTracks = Array.isArray(data.productionDeploymentPlan) ? data.productionDeploymentPlan : [];
    return {
      ...profile,
      requiredVarCount: profile.requiredVars.length,
      missingTemplateVars,
      missingScripts,
      productionTrackLinked: deploymentTracks.some((item) => String(item.nextAction || item.evidence || "").includes(profile.id) || profile.id === "production"),
      passed: missingTemplateVars.length === 0 && missingScripts.length === 0
    };
  });
  const checks = [
    check("environment:profiles", profileRows.length === 3, `${profileRows.length} profiles`),
    check("environment:templateVars", profileRows.every((item) => item.missingTemplateVars.length === 0), profileRows.map((item) => `${item.id}:${item.missingTemplateVars.join(",") || "complete"}`).join("; ")),
    check("environment:gateScripts", profileRows.every((item) => item.missingScripts.length === 0), profileRows.map((item) => `${item.id}:${item.missingScripts.join(",") || "complete"}`).join("; ")),
    check("environment:productionTracks", Array.isArray(data.productionDeploymentPlan) && data.productionDeploymentPlan.length >= 4, `${data.productionDeploymentPlan?.length || 0} production deployment tracks`),
    check("environment:readmeDocs", /env:check:production/.test(readme) && /release:report/.test(readme), "README documents production env and release report"),
    check("environment:deploymentDocs", /\.env\.example/.test(deployment) && /env:check:production/.test(deployment), "DEPLOYMENT documents env template and production check")
  ];
  return {
    ok: checks.every((item) => item.severity !== "error" || item.passed),
    generatedAt: new Date().toISOString(),
    profiles: profileRows,
    checks
  };
}

function renderMarkdown(report) {
  const profileRows = report.profiles.map((item) => `| ${item.passed ? "PASS" : "BLOCKED"} | ${item.id} | ${item.name} | ${item.owner} | ${item.envFile} | ${item.requiredVarCount} | ${item.gateScripts.join(", ")} | ${item.acceptance} |`);
  const checkRows = report.checks.map((item) => `| ${item.passed ? "PASS" : item.severity.toUpperCase()} | ${item.id} | ${String(item.detail || "").replace(/\|/g, "/")} |`);
  return [
    "# Environment matrix report",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    "",
    "| Result | Profile | Name | Owner | Env file | Required vars | Gate scripts | Acceptance rule |",
    "|---|---|---|---|---|---:|---|---|",
    ...profileRows,
    "",
    "| Result | Check | Detail |",
    "|---|---|---|",
    ...checkRows,
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
  if (flags.output) {
    const output = path.resolve(ROOT, String(flags.output));
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(report, null, 2), "utf8");
  }
  if (flags.markdown) {
    const markdown = path.resolve(ROOT, String(flags.markdown));
    fs.mkdirSync(path.dirname(markdown), { recursive: true });
    fs.writeFileSync(markdown, renderMarkdown(report), "utf8");
  }
}

function main() {
  const flags = parseArgs();
  const report = buildEnvironmentMatrixReport();
  writeOutput(report, flags);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = {
  ENVIRONMENT_PROFILES,
  buildEnvironmentMatrixReport,
  parseArgs,
  renderMarkdown,
  writeOutput
};
