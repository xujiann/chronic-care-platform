#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { buildIdentityContract } = require("./identity-contract");
const { buildInterfaceMappingReport } = require("./interface-mapping");
const { buildMonitoringReadinessReport } = require("./monitoring-readiness");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "site-readiness-pack.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "site-readiness-pack.md");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function readEnvFile(file) {
  if (!file) return {};
  const resolved = path.resolve(ROOT, file);
  if (!fs.existsSync(resolved)) return {};
  return Object.fromEntries(fs.readFileSync(resolved, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const [key, ...valueParts] = line.split("=");
      return [key.trim(), valueParts.join("=").trim().replace(/^["']|["']$/g, "")];
    }));
}

function envSigned(env, name) {
  return /^(1|true|yes|ready|signed|approved)$/i.test(String(env[name] || "").trim());
}

function buildSignoffTemplates(env) {
  return [
    ["cutover-env-file", "environment", "platform-ops", "NODE_ENV/STORAGE_ENGINE/.env production review", "NODE_ENV=production and non-JSON production storage confirmed"],
    ["cutover-secrets", "security", "security-admin", "session and gateway secret review", "non-placeholder SESSION_SECRETS and INTEGRATION_GATEWAY_SECRET injected"],
    ["cutover-identity", "identity", "identity-integration", "government identity source signoff", "OIDC/SAML metadata, client secret, callback URL, and organization mapping confirmed"],
    ["cutover-audit-retention", "audit", "security-admin", "audit retention signoff", "AUDIT_EXPORT_PATH or SIEM endpoint and retention permission confirmed"],
    ["cutover-storage-adapter", "storage", "data-platform", "production database and backup signoff", "database adapter, backup, rollback, and migration rehearsal confirmed"],
    ["cutover-institution-interfaces", "integration", "institution-integration", "HIS/EMR/LIS/PACS joint-test signoff", envSigned(env, "CUTOVER_SITE_INTERFACE_SIGNOFF") ? "signed" : "requires CUTOVER_SITE_INTERFACE_SIGNOFF"],
    ["cutover-insurance-certificate", "integration", "cross-agency-integration", "insurance/certificate/statistics exchange signoff", envSigned(env, "CUTOVER_INSURANCE_CERTIFICATE_SIGNOFF") ? "signed" : "requires CUTOVER_INSURANCE_CERTIFICATE_SIGNOFF"],
    ["cutover-monitoring", "operations", "platform-ops", "monitoring and on-call signoff", envSigned(env, "CUTOVER_MONITORING_SIGNOFF") ? "signed" : "requires CUTOVER_MONITORING_SIGNOFF"],
    ["cutover-dr-rehearsal", "resilience", "data-platform", "disaster recovery rehearsal signoff", envSigned(env, "CUTOVER_DR_REHEARSAL_SIGNOFF") ? "signed" : "requires CUTOVER_DR_REHEARSAL_SIGNOFF"]
  ].map(([id, phase, owner, evidence, blockingUntil]) => ({
    id: `signoff-${id}`,
    domain: "signoff",
    owner,
    template: "site-signoff-record",
    phase,
    evidence,
    blockingUntil: String(blockingUntil || ""),
    requiredSignatures: ["业务负责人", "技术负责人", "安全负责人", "现场实施负责人"]
  }));
}

function parseArgs(argv = process.argv.slice(2)) {
  const flags = {};
  argv.forEach((flag) => {
    if (!flag.startsWith("--")) return;
    const [key, ...rest] = flag.slice(2).split("=");
    flags[key] = rest.length ? rest.join("=") : true;
  });
  return {
    output: flags.output || DEFAULT_OUTPUT,
    markdown: flags.markdown || DEFAULT_MARKDOWN,
    envFile: flags["config-env"] || flags["env-file"] || ".env.example"
  };
}

function toRows(items, mapper) {
  return (Array.isArray(items) ? items : []).map(mapper);
}

function buildSiteReadinessPack(options = {}) {
  const data = options.data || readJson("data/db.json");
  const pkg = options.pkg || readJson("package.json");
  const envFile = options.envFile || ".env.example";
  const env = { ...readEnvFile(envFile), ...(options.env || {}) };
  const identity = options.identityContract || buildIdentityContract({ data });
  const interfaceMapping = options.interfaceMapping || buildInterfaceMappingReport({ data, pkg });
  const monitoring = options.monitoringReadiness || buildMonitoringReadinessReport({ data, pkg });

  const identityTemplates = toRows(identity.requiredClaims, (claim) => ({
    id: `identity-${claim.claim || claim.name}`,
    domain: "identity",
    owner: "identity-integration",
    template: "external-claim-mapping",
    required: Boolean(claim.required),
    field: claim.claim || claim.name,
    expectedSource: claim.source || "OIDC/SAML claim",
    platformUsage: claim.description || claim.usage || claim.purpose || "",
    evidenceToAttach: ["OIDC/SAML metadata", "sample signed token", "role and organization mapping screenshot"]
  }));

  const interfaceTemplates = toRows(interfaceMapping.mappings, (mapping) => ({
    id: `interface-${mapping.contractId || mapping.interfaceId || mapping.id}`,
    domain: "interface",
    owner: mapping.owner || "institution-integration",
    template: "joint-test-field-mapping",
    sourceSystem: mapping.sourceSystem || mapping.domain || mapping.contractId,
    targetCollection: mapping.targetCollection,
    requiredFields: mapping.requiredFields || (mapping.fieldCoverage || []).filter((field) => field.required).map((field) => field.sourceField || field.field || field.name),
    mappedFields: (mapping.fieldCoverage || []).filter((field) => field.mapped).map((field) => field.targetField || field.field || field.name),
    idempotency: mapping.idempotencyField || mapping.idempotencyMapped,
    evidenceToAttach: ["sample request", "sample response", "gateway signature log", "replay or retry record", "receiving user confirmation"]
  }));

  const monitoringTemplates = [
    ...toRows(monitoring.routes, (route) => ({
      id: `monitoring-route-${route.route || route.path || route.id}`,
      domain: "monitoring",
      owner: "platform-ops",
      template: "runtime-route-watch",
      signal: route.route || route.path || route.id,
      requiredEvidence: ["health check screenshot", "metrics scrape target", "alert rule", "on-call receiver"]
    })),
    ...toRows(monitoring.sloTargets, (target) => ({
      id: `monitoring-slo-${target.id || target.name}`,
      domain: "monitoring",
      owner: target.owner || "platform-ops",
      template: "slo-threshold",
      signal: target.name || target.id,
      requiredEvidence: ["threshold definition", "dashboard panel", "alert history", "escalation receiver"]
    }))
  ];

  const signoffTemplates = buildSignoffTemplates(env);

  const packs = [
    {
      id: "identity-source-pack",
      name: "Identity source mapping pack",
      owner: "identity-integration",
      rows: identityTemplates.length,
      requiredArtifacts: ["OIDC/SAML 元数据", "样例 token", "角色机构映射表", "回调地址确认单"],
      status: identityTemplates.every((item) => item.field) ? "template-ready" : "needs-template-work"
    },
    {
      id: "interface-joint-test-pack",
      name: "Institution and agency joint-test pack",
      owner: "institution-integration",
      rows: interfaceTemplates.length,
      requiredArtifacts: ["字段差异表", "样例报文", "签名验签日志", "失败重试记录", "接收端确认截图"],
      status: interfaceTemplates.every((item) => item.targetCollection) ? "template-ready" : "needs-template-work"
    },
    {
      id: "monitoring-operations-pack",
      name: "Monitoring and on-call pack",
      owner: "platform-ops",
      rows: monitoringTemplates.length,
      requiredArtifacts: ["监控目标", "SLO 阈值", "告警规则", "值班升级表", "演练记录"],
      status: monitoringTemplates.length >= 4 ? "template-ready" : "needs-template-work"
    },
    {
      id: "production-signoff-pack",
      name: "Production cutover signoff pack",
      owner: "project-office",
      rows: signoffTemplates.length,
      requiredArtifacts: ["上线清单", "现场签字", "问题清零表", "回退确认", "灾备演练记录"],
      status: signoffTemplates.length >= 8 ? "template-ready" : "needs-template-work"
    }
  ];

  const checks = [
    { id: "site-pack:identity", passed: identityTemplates.length >= 5, detail: `${identityTemplates.length} identity mapping rows` },
    { id: "site-pack:interfaces", passed: interfaceTemplates.length >= 5 && interfaceTemplates.every((item) => item.targetCollection), detail: `${interfaceTemplates.length} interface mapping rows` },
    { id: "site-pack:monitoring", passed: monitoringTemplates.length >= 4, detail: `${monitoringTemplates.length} monitoring rows` },
    { id: "site-pack:signoff", passed: signoffTemplates.length >= 8, detail: `${signoffTemplates.length} signoff rows` },
    { id: "site-pack:artifacts", passed: packs.every((item) => item.requiredArtifacts.length >= 4), detail: `${packs.length} packs with artifact lists` }
  ];

  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    envFile,
    summary: {
      packs: packs.length,
      templateRows: identityTemplates.length + interfaceTemplates.length + monitoringTemplates.length + signoffTemplates.length,
      requiredArtifacts: packs.reduce((sum, item) => sum + item.requiredArtifacts.length, 0)
    },
    packs,
    templates: {
      identity: identityTemplates,
      interfaces: interfaceTemplates,
      monitoring: monitoringTemplates,
      signoff: signoffTemplates
    },
    checks
  };
}

function renderMarkdown(report) {
  const checkRows = report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${String(item.detail || "").replace(/\|/g, "/")} |`);
  const packRows = report.packs.map((item) => `| ${item.status} | ${item.id} | ${item.owner} | ${item.rows} | ${item.requiredArtifacts.join(", ")} |`);
  const identityRows = report.templates.identity.map((item) => `| ${item.field} | ${item.owner} | ${item.expectedSource} | ${item.platformUsage.replace(/\|/g, "/")} |`);
  const interfaceRows = report.templates.interfaces.map((item) => `| ${item.sourceSystem || item.id} | ${item.owner} | ${item.targetCollection || ""} | ${(item.requiredFields || []).join(", ")} |`);
  const monitoringRows = report.templates.monitoring.map((item) => `| ${item.signal || item.id} | ${item.owner} | ${item.template} | ${(item.requiredEvidence || []).join(", ")} |`);
  const signoffRows = report.templates.signoff.map((item) => `| ${item.phase || ""} | ${item.owner || ""} | ${item.id} | ${(item.requiredSignatures || []).join(", ")} |`);
  return [
    "# Site readiness pack",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Template rows: ${report.summary.templateRows}`,
    `- Required artifact slots: ${report.summary.requiredArtifacts}`,
    "",
    "## Checks",
    "",
    "| Result | Check | Detail |",
    "|---|---|---|",
    ...checkRows,
    "",
    "## Packs",
    "",
    "| Status | Pack | Owner | Rows | Required artifacts |",
    "|---|---|---|---:|---|",
    ...packRows,
    "",
    "## Identity source mapping template",
    "",
    "| Claim | Owner | Expected source | Platform usage |",
    "|---|---|---|---|",
    ...identityRows,
    "",
    "## Interface joint-test template",
    "",
    "| Source system | Owner | Target collection | Required fields |",
    "|---|---|---|---|",
    ...interfaceRows,
    "",
    "## Monitoring and on-call template",
    "",
    "| Signal | Owner | Template | Required evidence |",
    "|---|---|---|---|",
    ...monitoringRows,
    "",
    "## Site signoff template",
    "",
    "| Phase | Owner | Item | Required signatures |",
    "|---|---|---|---|",
    ...signoffRows,
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

function runCli() {
  const flags = parseArgs();
  const report = buildSiteReadinessPack({ envFile: flags.envFile });
  writeOutput(report, flags);
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
  buildSiteReadinessPack,
  parseArgs,
  renderMarkdown,
  writeOutput
};
