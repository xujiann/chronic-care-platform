#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { buildCollectionGovernanceInventory } = require("../src/platform/data/collection-governance");

const ROOT = path.resolve(__dirname, "..");

function renderMarkdown(report) {
  return [
    "# Data collection governance",
    "",
    `- Result: ${report.ok ? "PASS" : "BLOCKED"}`,
    `- Collections: ${report.summary.collections}`,
    `- Authoritative business collections: ${report.summary.authoritative}`,
    `- Governed system collections: ${report.summary.governedSystem}`,
    `- Legacy non-authoritative collections: ${report.summary.blockedLegacy}`,
    `- Classified collections: ${report.summary.classified}`,
    "",
    "## Inventory",
    "",
    ...report.collections.map((item) => `- ${item.name}: ${item.classification}; production write ${item.productionWriteAllowed ? "allowed" : "blocked"}`),
    "",
    `> ${report.boundary}`,
    ""
  ].join("\n");
}

function run(options = {}) {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8"));
  const report = buildCollectionGovernanceInventory(data);
  if (options.write) {
    const release = path.join(ROOT, "release");
    fs.mkdirSync(release, { recursive: true });
    fs.writeFileSync(path.join(release, "data-collection-governance.json"), `${JSON.stringify(report, null, 2)}\n`);
    fs.writeFileSync(path.join(release, "data-collection-governance.md"), renderMarkdown(report));
  }
  return report;
}

if (require.main === module) {
  try {
    const report = run({ write: process.argv.includes("--write") });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.ok ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, code: "DATA_COLLECTION_GOVERNANCE_FAILED", message: error.message })}\n`);
    process.exitCode = 1;
  }
}

module.exports = { renderMarkdown, run };
