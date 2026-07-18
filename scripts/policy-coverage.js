#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "policy-coverage-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "policy-coverage-report.md");

const REQUIRED_POLICY_IDS = [
  "chronic-care-2025",
  "chronic-capability-guide",
  "tiered-care-2026",
  "multi-practice-2014",
  "digital-health",
  "maternal-child-certificates"
];

const REQUIRED_DOCS = [
  {
    file: "docs/政策依据说明.md",
    tokens: ["国卫基层发〔2025〕15号", "国卫办基层函〔2025〕439号", "国办发〔2026〕11号", "国卫医发〔2014〕86号", "flowchart LR"]
  },
  {
    file: "docs/maternal-child-policy.md",
    tokens: ["卫妇社发〔2009〕96 号", "国卫办妇幼发〔2023〕4 号", "flowchart TD"]
  },
  {
    file: "docs/医师多点执业政策说明.md",
    tokens: ["国卫医发〔2014〕86号", "multi-practice", "flowchart TD"]
  },
  {
    file: "docs/妇幼健康全模块说明.md",
    tokens: ["政策依据摘要", "maternal-child-policy.md", "flowchart TD"]
  }
];

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function exists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

function check(id, passed, detail, category = "policy-coverage") {
  return { id, category, passed: Boolean(passed), detail };
}

function fileEvidence(relativePath, tokens) {
  const present = exists(relativePath);
  const content = present ? read(relativePath) : "";
  const missingTokens = tokens.filter((token) => !content.includes(token));
  return {
    file: relativePath,
    present,
    tokens,
    missingTokens,
    passed: present && missingTokens.length === 0
  };
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

function buildPolicyCoverageReport() {
  const about = read("about.html");
  const maternalAbout = read("maternal-child-about.html");
  const packageJson = JSON.parse(read("package.json"));
  const releaseManifest = read("scripts/release-artifact-manifest.js");
  const releaseReport = read("scripts/release-report.js");
  const deployCheck = read("scripts/deploy-check.js");
  const priorityTemplates = read("scripts/priority-application-templates.js");
  const workflow = exists(".github/workflows/ci.yml") ? read(".github/workflows/ci.yml") : "";
  const readme = read("README.md");
  const deployment = read("DEPLOYMENT.md");

  const policyIds = REQUIRED_POLICY_IDS.map((id) => ({
    id,
    present: about.includes(`data-policy-id="${id}"`)
  }));
  const docs = REQUIRED_DOCS.map((item) => fileEvidence(item.file, item.tokens));
  const checks = [
    check("policyCoverage:aboutPage", about.includes('data-about-section="policy-basis"') && about.includes("maternal-child-about.html"), "about.html exposes policy basis and maternal-child policy page"),
    check("policyCoverage:maternalChildPage", maternalAbout.includes('data-maternal-about="policy-basis"') && maternalAbout.includes('data-about-flow="maternal-child-policy"'), "maternal-child-about.html exposes policy basis and workflow"),
    check("policyCoverage:policyIds", policyIds.every((item) => item.present), `${policyIds.filter((item) => item.present).length}/${policyIds.length} policy ids present`),
    check("policyCoverage:documents", docs.every((item) => item.passed), `${docs.filter((item) => item.passed).length}/${docs.length} policy documents complete`),
    check("policyCoverage:templateRule", priorityTemplates.includes("Policy and documentation") && priorityTemplates.includes("Policy doc: docs/maternal-child-policy.md"), "priority application templates keep policy and module documentation columns"),
    check("policyCoverage:releaseManifest", releaseManifest.includes("policy-coverage-report.md") && releaseManifest.includes("policy:coverage"), "release artifact manifest indexes policy coverage"),
    check("policyCoverage:releaseReport", releaseReport.includes("policyCoverage:report") && releaseReport.includes("policy-coverage-report.md"), "release report includes policy coverage checks and artifact"),
    check("policyCoverage:deployCheck", deployCheck.includes("package:policyCoverage") && deployCheck.includes("manifest:policyCoverage"), "deploy check gates policy coverage script and manifest"),
    check("policyCoverage:packageScript", Boolean(packageJson.scripts?.["policy:coverage"]), packageJson.scripts?.["policy:coverage"] || "missing"),
    check("policyCoverage:ci", workflow.includes("npm run policy:coverage"), "CI generates policy coverage evidence"),
    check("policyCoverage:operatorDocs", readme.includes("policy:coverage") && deployment.includes("policy:coverage"), "README and DEPLOYMENT document policy coverage evidence")
  ];

  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    project: packageJson.name,
    version: packageJson.version,
    summary: {
      policies: policyIds.length,
      policyIdsPresent: policyIds.filter((item) => item.present).length,
      documents: docs.length,
      documentsPassed: docs.filter((item) => item.passed).length,
      checks: checks.length,
      passed: checks.filter((item) => item.passed).length
    },
    policyIds,
    documents: docs,
    checks
  };
}

function renderMarkdown(report) {
  const checkRows = report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${String(item.detail || "").replace(/\|/g, "/")} |`);
  const policyRows = report.policyIds.map((item) => `| ${item.present ? "PASS" : "FAIL"} | ${item.id} |`);
  const docRows = report.documents.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.file} | ${item.missingTokens.join("<br>") || "complete"} |`);
  return [
    "# Policy coverage report",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Policy IDs: ${report.summary.policyIdsPresent}/${report.summary.policies}`,
    `- Documents: ${report.summary.documentsPassed}/${report.summary.documents}`,
    "",
    "## Checks",
    "",
    "| Result | Check | Detail |",
    "|---|---|---|",
    ...checkRows,
    "",
    "## About-page policy IDs",
    "",
    "| Result | Policy ID |",
    "|---|---|",
    ...policyRows,
    "",
    "## Policy documents",
    "",
    "| Result | Document | Missing tokens |",
    "|---|---|---|",
    ...docRows,
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
  const report = buildPolicyCoverageReport();
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
  buildPolicyCoverageReport,
  parseArgs,
  renderMarkdown,
  writeOutput
};
