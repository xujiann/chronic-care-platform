#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "release-artifact-manifest.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "release-artifact-manifest.md");

const ARTIFACTS = [
  ["release-report", "release", "Release readiness aggregate", "release/release-report.json", "release/release-report.md", "release:report", "/api/release-report"],
  ["release-artifact-manifest", "release", "Release artifact manifest", "release/release-artifact-manifest.json", "release/release-artifact-manifest.md", "release:manifest", "release/release-artifact-manifest.md"],
  ["production-cutover", "cutover", "Production cutover checklist", "release/production-cutover-checklist.json", "release/production-cutover-checklist.md", "release:report", "/api/system/readiness"],
  ["storage-model", "data", "Storage model inspection", "release/storage-model-inspection.json", "release/storage-model-inspection.md", "release:report", "npm.cmd run storage:inspect"],
  ["identity-contract", "identity", "Identity integration contract", "release/identity-contract.json", "release/identity-contract.md", "identity:contract", "/api/auth/identity/preview"],
  ["audit-retention", "security", "Audit retention report", "release/audit-retention-report.json", "release/audit-retention-report.md", "audit:retention", "/api/audit/verify"],
  ["data-quality", "data", "Data quality report", "release/data-quality-report.json", "release/data-quality-report.md", "data-quality:report", "/api/data-quality/scorecard"],
  ["environment-matrix", "environment", "Environment matrix report", "release/environment-matrix-report.json", "release/environment-matrix-report.md", "environment:matrix", "env:check:production"],
  ["integration-readiness", "integration", "Integration readiness report", "release/integration-readiness-report.json", "release/integration-readiness-report.md", "integration:readiness", "/api/integration/contracts"],
  ["interface-mapping", "integration", "Interface mapping report", "release/interface-mapping-report.json", "release/interface-mapping-report.md", "interface:mapping", "/api/integrations/gateway"],
  ["monitoring-readiness", "operations", "Monitoring readiness report", "release/monitoring-readiness-report.json", "release/monitoring-readiness-report.md", "monitoring:readiness", "/api/metrics"],
  ["operations-readiness", "operations", "Operations readiness report", "release/operations-readiness-report.json", "release/operations-readiness-report.md", "operations:readiness", "/api/system/readiness"],
  ["process-audit", "process", "Full process audit report", "release/process-audit-report.json", "release/process-audit-report.md", "process:audit", "/api/process-audit"],
  ["site-readiness", "site", "Site readiness pack", "release/site-readiness-pack.json", "release/site-readiness-pack.md", "site:pack", "/api/site-readiness-pack"],
  ["production-db", "data", "Production database readiness report", "release/production-db-readiness-report.json", "release/production-db-readiness-report.md", "production-db:readiness", "STORAGE_ENGINE=sqlite"],
  ["evaluation-evidence", "evaluation", "Interoperability evaluation evidence report", "release/evaluation-evidence-report.json", "release/evaluation-evidence-report.md", "evaluation:evidence", "release/evaluation-evidence-report.md"]
];

const TEMPLATE_READMES = [
  ["identity-source-mapping", "Identity source mapping template", "release/templates/identity-source-mapping/README.md", "site:pack", "/api/auth/identity/preview"],
  ["interface-joint-test", "Interface joint-test template", "release/templates/interface-joint-test/README.md", "site:pack", "/api/integrations/gateway"],
  ["monitoring-on-call", "Monitoring and on-call template", "release/templates/monitoring-on-call/README.md", "site:pack", "/api/metrics"],
  ["production-signoff", "Production cutover signoff template", "release/templates/production-signoff/README.md", "site:pack", "/api/release-report"]
];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
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
    markdown: flags.markdown || DEFAULT_MARKDOWN
  };
}

function buildReleaseArtifactManifest(options = {}) {
  const pkg = options.pkg || readJson("package.json");
  const releaseReport = options.releaseReport || null;
  const artifacts = ARTIFACTS.map(([id, category, title, json, markdown, command, evidence]) => ({
    id,
    category,
    title,
    json,
    markdown,
    command,
    commandAvailable: Boolean(pkg.scripts?.[command]),
    evidence,
    status: releaseReport?.checks?.some((item) => item.name === command || item.name?.startsWith(`${id}:`) || item.name?.startsWith(`${command}:`))
      ? "checked-in-release-report"
      : "declared"
  }));
  const templateReadmes = TEMPLATE_READMES.map(([id, title, file, command, evidence]) => ({
    id,
    category: "template-readme",
    title,
    file,
    command,
    commandAvailable: Boolean(pkg.scripts?.[command]),
    evidence,
    status: "generated-by-site-pack"
  }));
  const checks = [
    { id: "manifest:releaseReport", passed: artifacts.some((item) => item.id === "release-report" && item.commandAvailable), detail: "release:report script and aggregate artifact declared" },
    { id: "manifest:siteTemplates", passed: templateReadmes.length === 4 && templateReadmes.every((item) => item.commandAvailable), detail: `${templateReadmes.length} template readmes` },
    { id: "manifest:artifactCommands", passed: artifacts.every((item) => item.commandAvailable), detail: `${artifacts.filter((item) => item.commandAvailable).length}/${artifacts.length} artifact commands available` },
    { id: "manifest:apiEvidence", passed: artifacts.concat(templateReadmes).every((item) => item.evidence), detail: "every artifact has API or command evidence" }
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    project: pkg.name,
    version: pkg.version,
    summary: {
      artifacts: artifacts.length,
      templateReadmes: templateReadmes.length,
      categories: new Set(artifacts.map((item) => item.category)).size,
      releaseChecks: releaseReport?.summary?.total || 0
    },
    artifacts,
    templateReadmes,
    checks
  };
}

function renderMarkdown(report) {
  const artifactRows = report.artifacts.map((item) => `| ${item.category} | ${item.title} | ${item.command} | ${item.markdown} | ${item.evidence} |`);
  const templateRows = report.templateReadmes.map((item) => `| ${item.title} | ${item.command} | ${item.file} | ${item.evidence} |`);
  const checkRows = report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${item.detail} |`);
  return [
    "# Release artifact manifest",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Artifacts: ${report.summary.artifacts}`,
    `- Template READMEs: ${report.summary.templateReadmes}`,
    `- Release checks: ${report.summary.releaseChecks}`,
    "",
    "## Checks",
    "",
    "| Result | Check | Detail |",
    "|---|---|---|",
    ...checkRows,
    "",
    "## Release artifacts",
    "",
    "| Category | Artifact | Command | Markdown | Evidence |",
    "|---|---|---|---|---|",
    ...artifactRows,
    "",
    "## Template READMEs",
    "",
    "| Template | Command | File | Evidence |",
    "|---|---|---|---|",
    ...templateRows,
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
  const report = buildReleaseArtifactManifest();
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
  buildReleaseArtifactManifest,
  parseArgs,
  renderMarkdown,
  writeOutput
};
