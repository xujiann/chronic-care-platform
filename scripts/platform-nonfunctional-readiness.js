#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { buildPlatformNonfunctionalReadiness } = require("../src/platform/governance/platform-nonfunctional-readiness");

const ROOT = path.resolve(__dirname, "..");

function renderMarkdown(report) {
  return [
    "# Platform nonfunctional readiness",
    "",
    `- Result: ${report.ok ? "PASS" : "BLOCKED"}`,
    `- Frontend budgets: ${report.summary.assetsWithinBudget}/${report.summary.assets}`,
    `- Server: ${report.summary.serverLines} lines / ${report.summary.serverRequires} requires`,
    `- Tests: ${report.summary.testFiles} files`,
    `- Routes: ${report.summary.routeFiles} files`,
    "",
    ...report.checks.map((item) => `- ${item.passed ? "PASS" : "FAIL"} ${item.id}: ${item.detail}`),
    "",
    "## External gates",
    "",
    ...report.externalGates.map((item) => `- ${item}`),
    "",
    `> ${report.boundary}`,
    ""
  ].join("\n");
}

function run(options = {}) {
  const report = buildPlatformNonfunctionalReadiness({ root: ROOT });
  if (options.write) {
    const release = path.join(ROOT, "release");
    fs.mkdirSync(release, { recursive: true });
    fs.writeFileSync(path.join(release, "platform-nonfunctional-readiness.json"), `${JSON.stringify(report, null, 2)}\n`);
    fs.writeFileSync(path.join(release, "platform-nonfunctional-readiness.md"), renderMarkdown(report));
  }
  return report;
}

if (require.main === module) {
  try {
    const report = run({ write: process.argv.includes("--write") });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.ok ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, code: "PLATFORM_NONFUNCTIONAL_READINESS_FAILED", message: error.message })}\n`);
    process.exitCode = 1;
  }
}

module.exports = { renderMarkdown, run };
