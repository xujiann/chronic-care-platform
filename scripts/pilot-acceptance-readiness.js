#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { buildPilotAcceptanceCenter } = require("../pilot-acceptance");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "pilot-acceptance-readiness-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "pilot-acceptance-readiness-report.md");

function readEnvFile(relativePath) {
  const file = path.resolve(ROOT, relativePath || ".env.example");
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(fs.readFileSync(file, "utf8").split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#") && line.includes("=")).map((line) => {
    const [key, ...parts] = line.split("=");
    return [key.trim(), parts.join("=").trim().replace(/^["']|["']$/g, "")];
  }));
}

function clean(value) {
  return String(value ?? "").replace(/\|/g, "/").replace(/\r?\n/g, " ");
}

function renderMarkdown(report) {
  return [
    "# Priority application pilot acceptance readiness",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Functional state: ${report.functionalState}`,
    `- Formal go-live state: ${report.formalGoLiveState}`,
    `- Applications: ${report.summary.regressionReady}/${report.summary.applications} regression-ready`,
    `- Trial scenarios: ${report.summary.trialPassed}/${report.summary.trialScenarios} simulation-passed`,
    `- On-site acceptance: ${report.summary.onsiteAccepted}/${report.summary.onsiteTasks}`,
    `- Production alert drill receipts: ${report.summary.alertDrillReceipts}`,
    `- Interface joint-tests independently reviewed: ${report.summary.interfaceReviewed}/${report.summary.interfaceSamples}`,
    `- Open issues: ${report.summary.openIssues}`,
    "",
    "## Checks",
    "",
    "| Result | Check | Detail |",
    "|---|---|---|",
    ...report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${clean(item.detail)} |`),
    "",
    "## Eight-application regression matrix",
    "",
    "| Application | Owner | Entry | Status | API routes | Evidence |",
    "|---|---|---|---|---:|---|",
    ...report.applications.map((item) => `| ${clean(item.name)} | ${item.owner} | ${item.entry} | ${item.status} | ${item.apiRoutes.length} | ${item.evidence.join("<br>")} |`),
    "",
    "## Production alerting preflight",
    "",
    "| Route | Endpoint env | Secret env | Configuration |",
    "|---|---|---|---|",
    ...report.alerting.routes.map((item) => `| ${item.route} | ${item.endpointEnv} | ${item.secretEnv} | ${item.status} |`),
    "",
    `Accepted production drill receipts: ${report.alerting.receiptEvidence.acceptedProductionReceipts}; latest receipt: ${clean(report.alerting.receiptEvidence.latestReceiptId || "pending")}; monitoring signoff: ${report.alerting.signoffRecorded ? "recorded" : "pending"}.`,
    "",
    "## P0 on-site acceptance task pack",
    "",
    "| ID | Task | Owner | Target | Status | Evidence | Done when |",
    "|---|---|---|---|---|---|---|",
    ...report.onsiteTasks.map((item) => `| ${item.id} | ${clean(item.name)} | ${item.owner} | ${item.targetWindow} | ${item.acceptanceStatus} | ${clean(item.evidence)} | ${clean(item.doneWhen)} |`),
    "",
    "## Joint-test samples",
    "",
    "| Interface | Owner | Method | Endpoint | Evidence | Recorder / reviewer | Status |",
    "|---|---|---|---|---|---|---|",
    ...report.interfaceSamples.map((item) => `| ${clean(item.name)} | ${clean(item.owner)} | ${item.method} | ${item.endpoint} | ${clean(item.review?.evidenceRef || "pending")} | ${clean([item.review?.recordedBy, item.review?.reviewedBy].filter(Boolean).join(" / ") || "pending")} | ${item.status} |`),
    "",
    "All sample payloads use synthetic identifiers and contain no patient data.",
    "",
    "## End-to-end trial run",
    "",
    "| Result | Scenario | Expected | Evidence | Mode |",
    "|---|---|---|---|---|",
    ...report.trialRun.scenarios.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${clean(item.name)} | ${clean(item.expected)} | ${clean(item.evidence)} | ${item.mode} |`),
    "",
    "## Issue ledger",
    "",
    "| Priority | Issue | Owner | Status | Next action |",
    "|---|---|---|---|---|",
    ...report.issues.map((item) => `| ${item.priority} | ${clean(item.title)} | ${clean(item.owner)} | ${item.status} | ${clean(item.nextAction)} |`),
    "",
    "## Production boundary",
    "",
    report.boundary,
    ""
  ].join("\n");
}

function parseArgs(argv = process.argv.slice(2)) {
  const flags = {};
  argv.forEach((flag) => {
    if (!flag.startsWith("--")) return;
    const [key, ...parts] = flag.slice(2).split("=");
    flags[key] = parts.length ? parts.join("=") : true;
  });
  return {
    output: flags.output || DEFAULT_OUTPUT,
    markdown: flags.markdown || DEFAULT_MARKDOWN,
    envFile: flags["config-env"] || ".env.example"
  };
}

function writeOutput(report, options = {}) {
  const output = path.resolve(ROOT, options.output || DEFAULT_OUTPUT);
  const markdown = path.resolve(ROOT, options.markdown || DEFAULT_MARKDOWN);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2), "utf8");
  fs.mkdirSync(path.dirname(markdown), { recursive: true });
  fs.writeFileSync(markdown, renderMarkdown(report), "utf8");
}

function runCli() {
  const options = parseArgs();
  const report = buildPilotAcceptanceCenter({ env: { ...process.env, ...readEnvFile(options.envFile) } });
  writeOutput(report, options);
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

module.exports = { parseArgs, readEnvFile, renderMarkdown, writeOutput };
