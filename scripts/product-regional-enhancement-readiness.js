#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const program = require("../config/product-regional-enhancement-program.json");
const { buildMonitoringReadinessReport } = require("./monitoring-readiness");
const { buildExercise } = require("./regional-replication-exercise");
const { buildPlatformNonfunctionalReadiness, fileMetrics } = require("../src/platform/governance/platform-nonfunctional-readiness");
const { buildProductRegionalOperationsViewModel } = require("../src/platform/productization/product-regional-operations-view-model");
const { buildPlatformWorkItemCenterV2 } = require("../src/platform/productization/work-item-center-v2");
const { buildProductRegionalOperationsView } = require("../src/platform/regional/product-regional-operations-view");

const ROOT = path.resolve(__dirname, "..");

function buildProductRegionalEnhancementReadiness(options = {}) {
  const root = path.resolve(options.root || ROOT);
  const activeProgram = options.program || program;
  const data = options.data || JSON.parse(fs.readFileSync(path.join(root, "data", "db.json"), "utf8"));
  const monitoring = options.monitoring || buildMonitoringReadinessReport();
  const replication = options.replication || buildExercise({ root, generatedAt: options.now, gitCommit: options.gitCommit });
  const nonfunctional = options.nonfunctional || buildPlatformNonfunctionalReadiness({ root, now: options.now });
  const workItems = buildPlatformWorkItemCenterV2(data, { program: activeProgram, now: options.now });
  const regional = buildProductRegionalOperationsView({
    root,
    now: options.now,
    program: activeProgram,
    monitoring,
    replication,
    nonfunctional,
    configuration: options.configuration,
    acceptance: options.acceptance,
    regionDescriptors: options.regionDescriptors
  });
  const frontendAsset = fileMetrics(root, activeProgram.frontend.file);
  const frontend = Object.freeze({
    ...buildProductRegionalOperationsViewModel(workItems, regional),
    asset: Object.freeze({
      ...frontendAsset,
      maximumBytes: activeProgram.frontend.maximumBytes,
      maximumLines: activeProgram.frontend.maximumLines,
      withinBudget: frontendAsset.present && frontendAsset.bytes <= activeProgram.frontend.maximumBytes && frontendAsset.lines <= activeProgram.frontend.maximumLines
    })
  });
  const workCapabilities = new Set(workItems.capabilities);
  const iterationChecks = new Map([
    ["iteration-1-source-sla", ["source-normalization", "priority-normalization", "sla-evaluation"].every((item) => workCapabilities.has(item))],
    ["iteration-2-dispatch-claim", ["role-dispatch", "actor-claim", "optimistic-version"].every((item) => workCapabilities.has(item))],
    ["iteration-3-collaboration", ["digest-only-message", "read-receipt", "idempotent-command"].every((item) => workCapabilities.has(item))],
    ["iteration-4-lifecycle", ["reopen", "escalation", "redacted-timeline"].every((item) => workCapabilities.has(item))],
    ["iteration-5-regional-view", regional.regions.length >= activeProgram.regional.minimumRegions && regional.configurationDiffs.length >= regional.regions.length - 1],
    ["iteration-6-runtime-quality", nonfunctional.ok === true && monitoring.ok === true && frontend.asset.withinBudget]
  ]);
  const iterations = Object.freeze(activeProgram.iterations.map((iteration) => Object.freeze({
    id: iteration.id,
    passed: iterationChecks.get(iteration.id) === true,
    capabilities: Object.freeze([...iteration.capabilities])
  })));
  const checks = Object.freeze([
    Object.freeze({ id: "productRegional:iterations", passed: iterations.length === 6 && iterations.every((item) => item.passed) }),
    Object.freeze({ id: "productRegional:workItems", passed: workItems.ok === true && workItems.containsBusinessPayload === false }),
    Object.freeze({ id: "productRegional:regionalOperations", passed: regional.ok === true && regional.containsBusinessPayload === false && regional.containsCredentials === false }),
    Object.freeze({ id: "productRegional:frontend", passed: frontend.status === "local-control-ready" && frontend.asset.withinBudget }),
    Object.freeze({ id: "productRegional:productionFailClosed", passed: workItems.productionReady === false && regional.productionReady === false && frontend.productionReady === false })
  ]);
  return Object.freeze({
    schemaVersion: "product-regional-enhancement-readiness-v1",
    generatedAt: options.now || new Date().toISOString(),
    ok: checks.every((check) => check.passed),
    localControlReady: checks.every((check) => check.passed),
    siteReady: false,
    productionReady: false,
    decision: "NO-GO",
    iterations,
    summary: Object.freeze({ iterationsPassed: iterations.filter((item) => item.passed).length, workItems: workItems.summary.total, regions: regional.summary.regions, enabledCapabilities: regional.summary.capabilities, configurationDiffs: regional.summary.configurationDiffs, alertBlockers: regional.summary.alertBlockers }),
    workItems,
    regional,
    frontend,
    checks,
    blockers: Object.freeze([...activeProgram.externalBlockers]),
    boundary: "六迭代本地产品能力可以完成，但真实地区验收、监控值守、容灾、安全评估和生产授权仍为外部门禁。"
  });
}

function renderMarkdown(report) {
  return [
    "# 产品与地区运行增强就绪报告",
    "",
    `- 生成时间：${report.generatedAt}`,
    `- 本地控制：${report.localControlReady ? "READY" : "BLOCKED"}`,
    "- 生产决策：NO-GO",
    `- 六迭代通过：${report.summary.iterationsPassed}/6`,
    `- 统一事项：${report.summary.workItems}`,
    `- 地区实例：${report.summary.regions}`,
    "",
    "## 迭代",
    "",
    ...report.iterations.map((iteration) => `- ${iteration.passed ? "PASS" : "FAIL"} ${iteration.id}: ${iteration.capabilities.join(", ")}`),
    "",
    "## 外部门禁",
    "",
    ...report.blockers.map((blocker) => `- ${blocker}`),
    ""
  ].join("\n");
}

function parseArgs(argv = process.argv.slice(2)) {
  return Object.fromEntries(argv.filter((item) => item.startsWith("--") && item.includes("=")).map((item) => {
    const [key, ...value] = item.slice(2).split("=");
    return [key, value.join("=")];
  }));
}

function writeReport(report, options = {}) {
  const output = path.resolve(options.output);
  const markdown = path.resolve(options.markdown);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.mkdirSync(path.dirname(markdown), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(markdown, `${renderMarkdown(report)}\n`, "utf8");
  return { output, markdown };
}

function runCli() {
  const flags = parseArgs();
  const report = buildProductRegionalEnhancementReadiness();
  if (flags.output && flags.markdown) writeReport(report, flags);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

if (require.main === module) {
  try { runCli(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}

module.exports = { buildProductRegionalEnhancementReadiness, parseArgs, renderMarkdown, runCli, writeReport };
