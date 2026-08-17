#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { buildPlatformProductizationReadiness } = require("../src/platform/productization/productization-readiness");

const ROOT = path.resolve(__dirname, "..");

function renderMarkdown(report) {
  return [
    "# Platform productization readiness",
    "",
    `- Local foundation: ${report.localFoundationReady ? "PASS" : "BLOCKED"}`,
    `- Site readiness: ${report.siteReady ? "PASS" : "PENDING"}`,
    `- Production readiness: ${report.productionReady ? "GO" : "NO-GO"}`,
    `- Iterations: ${report.summary.iterations}`,
    `- P0 collections promoted: ${report.summary.promotedP0}`,
    `- Work-item projections: ${report.summary.projectedWorkItems}`,
    `- Institution adapters: ${report.summary.institutionAdapters}`,
    "",
    "## Checks",
    "",
    ...report.checks.map((item) => `- ${item.passed ? "PASS" : "FAIL"} ${item.id}: ${item.detail}`),
    "",
    "## External blockers",
    "",
    ...report.blockers.map((item) => `- ${item}`),
    "",
    `> ${report.boundary}`,
    ""
  ].join("\n");
}

function run(options = {}) {
  const report = buildPlatformProductizationReadiness({ root: ROOT });
  if (options.write) {
    const release = path.join(ROOT, "release");
    fs.mkdirSync(release, { recursive: true });
    fs.writeFileSync(path.join(release, "platform-productization-readiness.json"), `${JSON.stringify(report, null, 2)}\n`);
    fs.writeFileSync(path.join(release, "platform-productization-readiness.md"), renderMarkdown(report));
  }
  return report;
}

if (require.main === module) {
  try {
    const report = run({ write: process.argv.includes("--write") });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.ok ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, code: "PLATFORM_PRODUCTIZATION_READINESS_FAILED", message: error.message })}\n`);
    process.exitCode = 1;
  }
}

module.exports = { renderMarkdown, run };
