#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { buildPriorityApplicationTemplates } = require("./health-dashboard-summary");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "priority-application-templates.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "priority-application-templates.md");

function renderMarkdown(report) {
  const checkRows = report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${String(item.detail || "").replace(/\|/g, "/")} |`);
  const templateRows = report.templates.map((item) => `| ${item.sequence} | ${item.conversationTitle} | ${item.id} | ${item.frontendEntry} | ${item.apiRoutes.join("<br>")} | ${item.acceptanceEvidence.join("<br>")} |`);
  const detailRows = report.templates.map((item) => {
    const documentation = item.documentationRule
      ? [`About: ${item.documentationRule.aboutPage}`, `Module doc: ${item.documentationRule.requiredDocument}`, "Policy doc: docs/政策依据说明.md", `Reference: ${item.documentationRule.maternalChildReference}`].join("<br>")
      : "Policy doc: docs/政策依据说明.md";
    return `| ${item.conversationTitle} | ${String(item.functionalBoundary || "").replace(/\|/g, "/")} | ${item.reusePoints.join("<br>")} | ${item.dataCollections.join("<br>")} | ${item.testEvidence.join("<br>")} | ${documentation} |`;
  });
  const normalizedDetailRows = detailRows.map((row) => row.replace(/docs\/[^<|]+\.md/g, "docs/maternal-child-policy.md"));
  return [
    "# Priority application templates",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Applications: ${report.summary.applications}`,
    `- Source applications: ${report.summary.sourceApplications}`,
    `- Aggregate applications: ${report.summary.aggregateApplications}`,
    `- API routes: ${report.summary.apiRoutes}`,
    `- Data collections: ${report.summary.dataCollections}`,
    `- Acceptance artifacts: ${report.summary.acceptanceArtifacts}`,
    "",
    "## Scope",
    "",
    report.scope.rule,
    "",
    "## Checks",
    "",
    "| Result | Check | Detail |",
    "|---|---|---|",
    ...checkRows,
    "",
    "## Conversation handoff",
    "",
    "| # | Conversation title | Application ID | Frontend entry | API routes | Acceptance evidence |",
    "|---:|---|---|---|---|---|",
    ...templateRows,
    "",
    "## Development details",
    "",
    "| Conversation title | Functional boundary | Reuse points | Data collections | Test evidence | Policy and documentation |",
    "|---|---|---|---|---|---|",
    ...normalizedDetailRows,
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
  const report = buildPriorityApplicationTemplates();
  if (flags.write !== false) writeOutput(report, flags);
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

module.exports = { parseArgs, renderMarkdown, writeOutput };
