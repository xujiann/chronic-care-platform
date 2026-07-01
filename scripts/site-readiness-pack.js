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
    ["cutover-identity", "identity", "identity-integration", "government identity and SMS gateway signoff", "OIDC/SAML metadata, client secret, callback URL, organization mapping, and SMS_GATEWAY_URL confirmed"],
    ["cutover-audit-retention", "audit", "security-admin", "audit retention signoff", "AUDIT_EXPORT_PATH or SIEM endpoint and retention permission confirmed"],
    ["cutover-storage-adapter", "storage", "data-platform", "production database and backup signoff", "database adapter, backup, rollback, and migration rehearsal confirmed"],
    ["cutover-institution-interfaces", "integration", "institution-integration", "HIS/EMR/LIS/PACS joint-test signoff", envSigned(env, "CUTOVER_SITE_INTERFACE_SIGNOFF") ? "signed" : "requires CUTOVER_SITE_INTERFACE_SIGNOFF"],
    ["cutover-chronic-launch-core", "integration", "chronic-followup", "chronic launch core action closure signoff", envSigned(env, "CUTOVER_CHRONIC_LAUNCH_CORE_SIGNOFF") ? "signed" : "requires CUTOVER_CHRONIC_LAUNCH_CORE_SIGNOFF"],
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
    evidenceToAttach: ["OIDC/SAML metadata", "sample signed token", "role and organization mapping screenshot", "SMS gateway delivery receipt"]
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

function renderTemplateReadmes(report) {
  const templates = report.templates || {};
  const packById = Object.fromEntries((report.packs || []).map((pack) => [pack.id, pack]));
  const sections = [
    {
      file: "identity-source-mapping/README.md",
      title: "Identity source mapping template",
      pack: packById["identity-source-pack"],
      rows: templates.identity || [],
      capability: "Maps government OIDC/SAML claims, role codes, organization scope, and resident identity signals into the platform login and authorization model.",
      input: "OIDC/SAML metadata, sample signed token, role and organization directory, callback URL, SMS gateway delivery receipt, and identity source owner confirmation.",
      output: "Claim mapping table, role-to-portal mapping, organization scope evidence, and signoff-ready identity integration notes.",
      apiEvidence: "/api/auth/login, /api/auth/me, /api/system/readiness, /api/site-readiness-pack"
    },
    {
      file: "interface-joint-test/README.md",
      title: "Interface joint-test template",
      pack: packById["interface-joint-test-pack"],
      rows: templates.interfaces || [],
      capability: "Turns HIS/EMR/LIS/PACS/insurance/certificate/statistics contracts into field mapping, sample message, signature, retry, and receiving confirmation evidence.",
      input: "Contract field dictionary, sample request and response, gateway signature log, idempotency key, replay or retry record, and receiving user confirmation.",
      output: "Joint-test field table, target collection mapping, required field coverage, and implementation evidence for release review.",
      apiEvidence: "/api/integrations/gateway, /api/system/readiness, /api/process-audit, /api/site-readiness-pack"
    },
    {
      file: "monitoring-on-call/README.md",
      title: "Monitoring and on-call template",
      pack: packById["monitoring-operations-pack"],
      rows: templates.monitoring || [],
      capability: "Converts runtime health, metrics, SLO, alert, dead-letter, and escalation signals into an operations readiness checklist.",
      input: "Health route screenshot, metrics scrape target, dashboard panel, alert rule, duty roster, escalation receiver, and drill record.",
      output: "Route watch list, SLO threshold table, alert ownership, on-call escalation evidence, and cutover monitoring signoff material.",
      apiEvidence: "/api/health, /api/metrics, /api/system/readiness, /api/site-readiness-pack"
    },
    {
      file: "production-signoff/README.md",
      title: "Production cutover signoff template",
      pack: packById["production-signoff-pack"],
      rows: templates.signoff || [],
      capability: "Collects production environment, secrets, identity, audit retention, database, interface, monitoring, and disaster recovery signatures before cutover.",
      input: ".env review, production secrets proof, database and backup rehearsal, external interface acceptance, monitoring binding, DR rehearsal, and issue-cleared checklist.",
      output: "Signoff rows with owner, evidence requirement, blocking condition, and required signature roles for final release review.",
      apiEvidence: "/api/system/readiness, /api/process-audit, /api/site-readiness-pack, release/production-cutover-checklist.md"
    }
  ];

  return Object.fromEntries(sections.map((section) => {
    const rows = section.rows.slice(0, 12).map((row) => {
      const name = row.field || row.sourceSystem || row.signal || row.phase || row.id;
      const owner = row.owner || section.pack?.owner || "owner-pending";
      const evidence = row.evidence || row.expectedSource || row.targetCollection || (row.requiredEvidence || row.evidenceToAttach || []).join(", ") || row.blockingUntil || "evidence-pending";
      return `| ${String(name || "").replace(/\|/g, "/")} | ${String(owner).replace(/\|/g, "/")} | ${String(evidence).replace(/\|/g, "/")} |`;
    });
    const content = [
      `# ${section.title}`,
      "",
      `- Current status: ${section.pack?.status || "unknown"}`,
      `- Owner: ${section.pack?.owner || "owner-pending"}`,
      `- Template rows: ${section.rows.length}`,
      `- Source command: npm.cmd run site:pack`,
      `- Live evidence: ${section.apiEvidence}`,
      "",
      "## What this template supports now",
      "",
      section.capability,
      "",
      "## Current implementation coverage",
      "",
      `This README is generated from the live site readiness pack. It currently covers ${section.rows.length} rows, ${section.pack?.requiredArtifacts?.length || 0} required artifact types, owner ${section.pack?.owner || "owner-pending"}, and status ${section.pack?.status || "unknown"}.`,
      "",
      "## Inputs to collect",
      "",
      section.input,
      "",
      "## Outputs produced",
      "",
      section.output,
      "",
      "## Required artifacts",
      "",
      ...(section.pack?.requiredArtifacts || []).map((item) => `- ${item}`),
      "",
      "## Rows preview",
      "",
      "| Item | Owner | Evidence or mapping |",
      "|---|---|---|",
      ...rows,
      "",
      "## How to verify now",
      "",
      `- Run: npm.cmd run site:pack`,
      `- Read API: ${section.apiEvidence}`,
      `- Review generated file: release/templates/${section.file}`,
      ""
    ].join("\n");
    return [section.file, content];
  }));
}

function writeTemplateReadmes(report, baseDir) {
  const root = path.resolve(ROOT, baseDir || path.join("release", "templates"));
  const readmes = renderTemplateReadmes(report);
  Object.entries(readmes).forEach(([file, content]) => {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf8");
  });
  return Object.keys(readmes).map((file) => path.join(root, file));
}

function writeOutput(report, flags = {}) {
  const output = path.resolve(ROOT, String(flags.output || DEFAULT_OUTPUT));
  const markdown = path.resolve(ROOT, String(flags.markdown || DEFAULT_MARKDOWN));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2), "utf8");
  fs.mkdirSync(path.dirname(markdown), { recursive: true });
  fs.writeFileSync(markdown, renderMarkdown(report), "utf8");
  writeTemplateReadmes(report, path.join(path.dirname(path.relative(ROOT, markdown)), "templates"));
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
  renderTemplateReadmes,
  writeTemplateReadmes,
  writeOutput
};
