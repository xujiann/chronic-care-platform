#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { buildCollectionGovernanceInventory } = require("../src/platform/data/collection-governance");
const { loadManifest, resolveProtectedOwner } = require("./process-worktree");

const ROOT = path.resolve(__dirname, "..");
const SOURCE_EXTENSIONS = Object.freeze(new Set([".js", ".html"]));
const EXCLUDED_SOURCE_PREFIXES = Object.freeze([
  ".github/", "config/", "data/", "docs/", "node_modules/", "output/", "release/", "test/"
]);

function trackedRuntimeSourceFiles(root = ROOT) {
  const result = spawnSync("git", ["ls-files", "-z", "--", "*.js", "*.html"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true
  });
  if (result.status !== 0) throw new Error(String(result.stderr || "cannot enumerate tracked runtime sources").trim());
  return result.stdout.split("\0")
    .map((file) => file.replaceAll("\\", "/"))
    .filter(Boolean)
    .filter((file) => SOURCE_EXTENSIONS.has(path.extname(file)))
    .filter((file) => !EXCLUDED_SOURCE_PREFIXES.some((prefix) => file.startsWith(prefix)))
    .sort();
}

function readRuntimeSourceEntries(root = ROOT, processManifest = loadManifest()) {
  return trackedRuntimeSourceFiles(root).map((file) => ({
    file,
    source: fs.readFileSync(path.join(root, file), "utf8"),
    processOwner: resolveProtectedOwner(file, processManifest) || ""
  }));
}

function readCoreConcepts(root = ROOT) {
  const source = fs.readFileSync(path.join(root, "CORE_DATA_DEFINITIONS.md"), "utf8");
  const concepts = [];
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\|\s*([A-Za-z][A-Za-z ]*)\s*\|/);
    if (match) concepts.push(match[1].trim());
  }
  return [...new Set(concepts)].sort();
}

function renderMarkdown(report) {
  return [
    "# Data collection governance",
    "",
    `- Result: ${report.ok ? "PASS" : "BLOCKED"}`,
    `- Collections: ${report.summary.collections}`,
    `- Collections with assigned owners: ${report.summary.ownerAssigned}`,
    `- Authoritative business collections in snapshot: ${report.summary.authoritative}`,
    `- Owner-reviewed legacy collections (production writes blocked): ${report.summary.ownerReviewedLegacy}`,
    `- Governed system collections: ${report.summary.governedSystem}`,
    `- Review-required collections: ${report.summary.reviewRequired}`,
    `- Legacy quarantined collections: ${report.summary.legacyQuarantined}`,
    `- Unassigned legacy collections: ${report.summary.unassignedLegacy}`,
    `- Source-referenced collections: ${report.summary.sourceReferenced}`,
    `- Seed-only collections: ${report.summary.seedOnly}`,
    `- Classified collections: ${report.summary.classified}`,
    `- Production promotion: ${report.productionPromotionAllowed ? "allowed" : "blocked"}`,
    "",
    "## Inventory",
    "",
    ...report.collections.map((item) => [
      `- ${item.name}: ${item.governanceStatus}; owner ${item.owner || "unassigned"};`,
      ` source ${item.actualUsage.state}; production promotion blocked`
    ].join("")),
    "",
    `> ${report.boundary}`,
    ""
  ].join("\n");
}

function run(options = {}) {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8"));
  const report = buildCollectionGovernanceInventory(data, undefined, {
    sourceEntries: readRuntimeSourceEntries(ROOT),
    coreConcepts: readCoreConcepts(ROOT),
    now: options.now
  });
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
    const summaryOnly = process.argv.includes("--verify") && !process.argv.includes("--json");
    process.stdout.write(`${JSON.stringify(summaryOnly ? {
      schemaVersion: report.schemaVersion,
      ok: report.ok,
      productionReady: report.productionReady,
      productionPromotionAllowed: report.productionPromotionAllowed,
      summary: report.summary,
      failedChecks: report.checks.filter((item) => !item.passed)
    } : report, null, 2)}\n`);
    process.exitCode = report.ok ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, code: "DATA_COLLECTION_GOVERNANCE_FAILED", message: error.message })}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  EXCLUDED_SOURCE_PREFIXES,
  SOURCE_EXTENSIONS,
  readCoreConcepts,
  readRuntimeSourceEntries,
  renderMarkdown,
  run,
  trackedRuntimeSourceFiles
};
