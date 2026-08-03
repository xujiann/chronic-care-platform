#!/usr/bin/env node
const { readRuntimeSource } = require("../src/http/runtime-source");
const fs = require("node:fs");
const path = require("node:path");
const {
  HIGHLIGHT_CAPABILITIES,
  buildPublicHealthHighlights,
  seedPublicHealthAiReviews,
  seedPublicHealthAlerts,
  seedPublicHealthCommandTasks,
  seedPublicHealthEvidenceRecords,
  seedPublicHealthResources,
  seedPublicHealthSignals,
  seedPublicHealthTriggerRules
} = require("../public-health-highlights-service");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "public-health-highlights-readiness-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "public-health-highlights-readiness-report.md");

function readJson(relativePath) {
  const file = path.join(ROOT, relativePath);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
}

function readText(relativePath) {
  const file = path.join(ROOT, relativePath);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function check(id, passed, detail, evidence) {
  return { id, passed: Boolean(passed), detail, evidence };
}

function buildPublicHealthHighlightsReadiness({ data = readJson("data/db.json"), pkg = readJson("package.json") } = {}) {
  const board = buildPublicHealthHighlights({ data });
  const server = readRuntimeSource(ROOT);
  const html = readText("public-health-highlights.html");
  const frontend = readText("public-health-highlights.js");
  const doc = readText("docs/公共卫生五件套功能说明与验收.md");
  const checks = [
    check("capabilities:five-suite", HIGHLIGHT_CAPABILITIES.length === 5 && board.capabilities.length === 5, `${board.capabilities.length}/5 capabilities`, "public-health-highlights-service.js"),
    check("trigger-engine:rules-signals-alerts", board.triggerCenter.rules.length >= 5 && board.triggerCenter.signals.length >= 6 && board.triggerCenter.alerts.length >= 4, `${board.triggerCenter.rules.length} rules / ${board.triggerCenter.signals.length} signals / ${board.triggerCenter.alerts.length} active alerts`, "publicHealthTriggerRules/publicHealthSignals/publicHealthAlerts"),
    check("gis:map-board", board.mapBoard.nodes.length >= 8 && board.mapBoard.regions.length >= 3, `${board.mapBoard.nodes.length} nodes / ${board.mapBoard.regions.length} regions`, "buildMapBoard"),
    check("ai:human-review", board.aiCenter.reviews.length >= 2 && board.aiCenter.reviews.every((item) => item.humanApprovalRequired && item.evidenceRefs?.length), `${board.aiCenter.reviews.length} AI reviews with evidence and human approval`, "publicHealthAiReviews.modelCard"),
    check("command:dispatch-resources", board.commandCenter.tasks.length >= 4 && board.commandCenter.resources.length >= 5 && board.commandCenter.tasks.every((item) => item.owner && item.dueAt && item.resourceIds?.length), `${board.commandCenter.tasks.length} tasks / ${board.commandCenter.resources.length} resources`, "publicHealthCommandTasks/publicHealthResources"),
    check("evidence:quality-cockpit", board.evidenceCenter.records.length >= 8 && board.evidenceCenter.summary.recorded >= 8 && board.evidenceCenter.records.every((item) => item.sourceCollection && item.evidenceRefs?.length), `${board.evidenceCenter.summary.recorded}/${board.evidenceCenter.summary.total} evidence records`, "publicHealthEvidenceRecords"),
    check("api:read-and-actions", ["/api/public-health/highlights", "/api/public-health/highlights/signals", "/api/public-health/highlights/alerts/:id/actions", "/api/public-health/highlights/command-tasks/:id/actions", "/api/public-health/highlights/ai-reviews/:id/actions", "/api/public-health/highlights/evidence/:id/actions"].every((marker) => server.includes(marker)), "read, intake, alert, task, AI and evidence action APIs are wired", "server.js"),
    check("api:audit-boundary", (server.includes("public-health-highlight-signal") || server.includes("public-health-highlight-signal-intake")) && server.includes("public-health-highlight-alert-action") && server.includes("public-health-highlight-command-task-action") && server.includes("public-health-highlight-ai-review-action") && server.includes("public-health-highlight-evidence-action"), "all five suite actions write securityEvents", "server.js/securityEvents"),
    check("frontend:command-center", fs.existsSync(path.join(ROOT, "public-health-highlights.html")) && fs.existsSync(path.join(ROOT, "public-health-highlights.js")) && ["HIGHLIGHTS_API", "highlight-map", "highlight-alerts", "highlight-ai", "highlight-tasks", "highlight-evidence", "signal-form"].every((marker) => html.includes(marker) || frontend.includes(marker)), "five-suite command center and signal intake UI are wired", "public-health-highlights.html/public-health-highlights.js"),
    check("release:package-script", Boolean(pkg.scripts?.["public-health:highlights:readiness"]), pkg.scripts?.["public-health:highlights:readiness"] || "missing package script", "package.json"),
    check("docs:acceptance", ["五件套", "多点触发", "GIS", "AI", "应急指挥", "证据链", "人工确认", "formalGoLiveState"].every((marker) => doc.includes(marker)), "implementation, acceptance and formal go-live boundary are documented", "docs/公共卫生五件套功能说明与验收.md")
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    functionalState: board.functionalState,
    formalGoLiveState: board.formalGoLiveState,
    summary: {
      capabilities: board.capabilities.length,
      checks: checks.length,
      checksPassed: checks.filter((item) => item.passed).length,
      rules: board.summary.rules,
      signals: board.summary.signals,
      alerts: board.summary.activeAlerts,
      tasks: board.summary.openTasks,
      resources: board.summary.readyResources,
      evidenceScore: board.summary.evidenceScore
    },
    checks,
    board
  };
}

function renderMarkdown(report) {
  const rows = report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${String(item.detail).replace(/\|/g, "/")} | ${item.evidence} |`);
  return [
    "# 公共卫生五件套就绪报告",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Functional state: ${report.functionalState}`,
    `- Formal go-live state: ${report.formalGoLiveState}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Summary: ${report.summary.checksPassed}/${report.summary.checks} checks, ${report.summary.rules} rules, ${report.summary.signals} signals, ${report.summary.alerts} active alerts, ${report.summary.tasks} open tasks, ${report.summary.evidenceScore}% evidence score`,
    "",
    "| Result | Check | Detail | Evidence |",
    "|---|---|---|---|",
    ...rows,
    "",
    "五件套包含多点触发监测预警、GIS公共卫生一张图、AI流调研判助手、应急指挥与资源调度、数据质量与证据链驾驶舱。AI建议必须人工确认；正式上线仍需现场接口、账号、安全、监控、备份和签字材料。",
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

function runCli() {
  const flags = parseArgs();
  const report = buildPublicHealthHighlightsReadiness();
  const output = path.resolve(ROOT, flags.output || DEFAULT_OUTPUT);
  const markdown = path.resolve(ROOT, flags.markdown || DEFAULT_MARKDOWN);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2), "utf8");
  fs.mkdirSync(path.dirname(markdown), { recursive: true });
  fs.writeFileSync(markdown, renderMarkdown(report), "utf8");
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

if (require.main === module) runCli();

module.exports = { buildPublicHealthHighlightsReadiness, renderMarkdown };
