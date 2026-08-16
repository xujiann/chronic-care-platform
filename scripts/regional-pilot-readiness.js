#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { buildRegionalPilotReadiness } = require("../src/platform/regional/regional-pilot-program");

const ROOT = path.resolve(__dirname, "..");

function renderMarkdown(report) {
  return [
    "# Regional pilot readiness",
    "",
    `- Program: ${report.program.programId}`,
    `- Region: ${report.program.regionCode}`,
    `- Workflow: ${report.program.workflow}`,
    `- Local foundation: ${report.localFoundationReady ? "READY" : "BLOCKED"}`,
    `- Site readiness: ${report.siteReady ? "CANDIDATE" : "PENDING EXTERNAL"}`,
    `- Production ready: false`,
    "",
    "## Workflow",
    "",
    ...report.program.steps.map((item, index) => `${index + 1}. ${item}`),
    "",
    "## External adapter receipts",
    "",
    ...report.adapterReceipts.map((item) => `- ${item.id}: ${item.requiredReceipt} / ${item.status}`),
    "",
    `> ${report.boundary}`,
    ""
  ].join("\n");
}

function run(options = {}) {
  const report = buildRegionalPilotReadiness({ root: ROOT });
  if (options.write) {
    const release = path.join(ROOT, "release");
    fs.mkdirSync(release, { recursive: true });
    fs.writeFileSync(path.join(release, "regional-pilot-readiness.json"), `${JSON.stringify(report, null, 2)}\n`);
    fs.writeFileSync(path.join(release, "regional-pilot-readiness.md"), renderMarkdown(report));
  }
  return report;
}

if (require.main === module) {
  try {
    const report = run({ write: process.argv.includes("--write") });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.ok ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, code: "REGIONAL_PILOT_READINESS_FAILED", message: error.message })}\n`);
    process.exitCode = 1;
  }
}

module.exports = { renderMarkdown, run };
