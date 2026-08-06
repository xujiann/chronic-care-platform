#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  buildRegionalCutoverDossier,
  buildRegionalCutoverPortfolio
} = require("../src/platform/regional/regional-cutover-dossier");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_JSON = path.join(ROOT, "release", "regional-cutover-dossier.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "regional-cutover-dossier.md");

function parseArgs(argv = process.argv.slice(2)) {
  const flags = {};
  for (const item of argv) {
    if (!item.startsWith("--")) continue;
    const [key, ...value] = item.slice(2).split("=");
    flags[key] = value.length ? value.join("=") : true;
  }
  return flags;
}

function readStaticReceipts(root = ROOT) {
  const snapshotPath = path.join(root, "data", "db.json");
  if (!fs.existsSync(snapshotPath)) return [];
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
  return Array.isArray(snapshot.regionalDeploymentProbeReceipts)
    ? snapshot.regionalDeploymentProbeReceipts
    : [];
}

function buildReport(options = {}) {
  const common = {
    root: options.root || ROOT,
    env: options.env || process.env,
    receipts: options.receipts || readStaticReceipts(options.root || ROOT),
    generatedAt: options.generatedAt
  };
  if (options.regionCode) {
    const dossier = buildRegionalCutoverDossier({
      ...common,
      regionCode: options.regionCode
    });
    return {
      schemaVersion: "regional-cutover-dossier-portfolio-v1",
      generatedAt: dossier.generatedAt,
      ok: dossier.ok,
      candidateReady: dossier.candidateReady ? 1 : 0,
      productionReady: false,
      summary: {
        regions: 1,
        localControlReady: dossier.ok ? 1 : 0,
        candidateReady: dossier.candidateReady ? 1 : 0,
        blocked: dossier.candidateReady ? 0 : 1
      },
      regions: [dossier]
    };
  }
  return buildRegionalCutoverPortfolio(common);
}

function renderMarkdown(report) {
  const overview = report.regions.map((region) =>
    `| ${region.regionCode} | ${region.deploymentClass} | ${region.ok ? "PASS" : "FAIL"} | ${region.release.governanceState} | ${region.operations.status} | ${region.candidateReady ? "YES" : "NO"} | ${region.blockers.join(", ") || "-"} |`
  );
  const gates = report.regions.flatMap((region) =>
    region.gates.map((item) =>
      `| ${region.regionCode} | ${item.passed ? "PASS" : "BLOCK"} | ${item.id} | ${String(item.detail).replaceAll("|", "/")} |`
    )
  );
  return [
    "# 地区投产档案汇总",
    "",
    `- 生成时间：${report.generatedAt}`,
    `- 本地控制面检查：${report.ok ? "通过" : "未通过"}`,
    `- 候选就绪地区：${report.summary.candidateReady}/${report.summary.regions}`,
    "- 生产就绪：否",
    "- 包含业务数据、探测地址或证据正文：否",
    "",
    "## 地区概览",
    "",
    "| 地区 | 类别 | 控制面 | 发布状态 | 运维状态 | 候选就绪 | 阻断码 |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...overview,
    "",
    "## 候选门禁",
    "",
    "| 地区 | 状态 | 门禁 | 说明 |",
    "| --- | --- | --- | --- |",
    ...gates,
    "",
    "## 固定边界",
    "",
    "- 候选就绪只表示本地配置、不可变发布、运维回执及安全边界已形成一致快照。",
    "- 档案永远不能把仓库内检查转换为真实生产授权。",
    "- 真实联调、测评、灾备、值守、验收和外部批准必须通过受控证据另行完成。",
    ""
  ].join("\n");
}

function writeReport(report, options = {}) {
  const output = path.resolve(options.output || DEFAULT_JSON);
  const markdown = path.resolve(options.markdown || DEFAULT_MARKDOWN);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.mkdirSync(path.dirname(markdown), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(markdown, renderMarkdown(report), "utf8");
  return { output, markdown };
}

function runCli() {
  const flags = parseArgs();
  const report = buildReport({
    root: ROOT,
    regionCode: flags.region ? String(flags.region) : undefined
  });
  const written = writeReport(report, {
    output: flags.output,
    markdown: flags.markdown
  });
  process.stdout.write(`${JSON.stringify({
    ...written,
    ok: report.ok,
    candidateReady: report.summary.candidateReady,
    productionReady: false
  }, null, 2)}\n`);
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
  buildReport,
  parseArgs,
  readStaticReceipts,
  renderMarkdown,
  runCli,
  writeReport
};
