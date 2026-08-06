#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { buildFleetStatus } = require("../src/platform/regional/multi-region-operations");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_JSON = path.join(ROOT, "release", "regional-operations-readiness.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "regional-operations-readiness.md");

function readStaticReceipts(root = ROOT) {
  const snapshotPath = path.join(root, "data", "db.json");
  if (!fs.existsSync(snapshotPath)) return [];
  const data = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
  return Array.isArray(data.regionalDeploymentProbeReceipts) ? data.regionalDeploymentProbeReceipts : [];
}

function buildReadiness(options = {}) {
  const fleet = buildFleetStatus({
    root: options.root || ROOT,
    env: options.env || process.env,
    receipts: options.receipts || readStaticReceipts(options.root || ROOT),
    now: options.now
  });
  const checks = [
    {
      id: "regionalOperations:siteInventory",
      passed: fleet.summary.sites >= 2,
      detail: `${fleet.summary.sites} enabled non-template sites`
    },
    {
      id: "regionalOperations:metadataBoundary",
      passed: fleet.containsBusinessData === false && fleet.probeTargetsExposed === false,
      detail: "fleet output contains no business data, endpoint or resolved address"
    },
    {
      id: "regionalOperations:productionBoundary",
      passed: fleet.productionReady === false && fleet.sites.every((site) => site.productionReady === false),
      detail: "runtime metadata cannot authorize production cutover"
    },
    {
      id: "regionalOperations:serverOwnedTargets",
      passed: fleet.sites.every((site) => /^[A-Z0-9_]+_BASE_URL$/.test(site.environmentVariable)),
      detail: "probe targets are selected only through server-owned environment variables"
    }
  ];
  return {
    schemaVersion: "regional-operations-readiness-v1",
    generatedAt: options.now || new Date().toISOString(),
    ok: checks.every((item) => item.passed),
    productionReady: false,
    checks,
    fleet,
    externalBlockers: [
      "real per-site HTTPS endpoints and network routes",
      "fresh backup and certificate evidence",
      "staffed alert delivery and incident response",
      "signed disaster-recovery and site acceptance"
    ]
  };
}

function renderMarkdown(report) {
  const checkRows = report.checks.map((item) =>
    `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${item.detail} |`
  );
  const siteRows = report.fleet.sites.map((site) =>
    `| ${site.regionCode} | ${site.deploymentClass} | ${site.status} | ${site.regionalReleaseId} | ${site.blockers.join(", ") || "-"} |`
  );
  return [
    "# 多地区运维控制面就绪报告",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Local checks: ${report.ok ? "passed" : "failed"}`,
    "- Production ready: no",
    "- Business data included: no",
    "- Probe endpoints exposed: no",
    "",
    "## 检查",
    "",
    "| 状态 | 检查 | 说明 |",
    "| --- | --- | --- |",
    ...checkRows,
    "",
    "## 地区实例",
    "",
    "| 地区 | 类别 | 状态 | 组合发布 | 阻断项 |",
    "| --- | --- | --- | --- | --- |",
    ...siteRows,
    "",
    "## 外部阻断项",
    "",
    ...report.externalBlockers.map((item) => `- ${item}`),
    ""
  ].join("\n");
}

function writeReadiness(report, options = {}) {
  const output = path.resolve(options.output || DEFAULT_JSON);
  const markdown = path.resolve(options.markdown || DEFAULT_MARKDOWN);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.mkdirSync(path.dirname(markdown), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(markdown, renderMarkdown(report), "utf8");
  return { output, markdown };
}

function runCli() {
  const report = buildReadiness();
  const written = writeReadiness(report);
  process.stdout.write(`${JSON.stringify({ ...written, ok: report.ok, productionReady: false }, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  buildReadiness,
  readStaticReceipts,
  renderMarkdown,
  runCli,
  writeReadiness
};
