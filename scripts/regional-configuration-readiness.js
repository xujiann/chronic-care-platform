#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  buildRegionConfigurationReadiness,
  buildRegionalConfigurationPortfolio
} = require("../src/platform/regional/regional-configuration-readiness");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_JSON = path.join(ROOT, "release", "regional-configuration-readiness.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "regional-configuration-readiness.md");

function parseArgs(argv = process.argv.slice(2)) {
  const flags = {};
  for (const item of argv) {
    if (!item.startsWith("--")) continue;
    const [key, ...value] = item.slice(2).split("=");
    flags[key] = value.length ? value.join("=") : true;
  }
  return flags;
}

function buildReport(options = {}) {
  const report = options.regionCode
    ? {
      schemaVersion: "regional-configuration-portfolio-v1",
      generatedAt: options.generatedAt || new Date().toISOString(),
      ok: true,
      productionReady: false,
      summary: {
        regions: 1,
        technicalReady: 0,
        productionCandidates: 0,
        testFixtures: 0
      },
      regions: [buildRegionConfigurationReadiness(options)]
    }
    : buildRegionalConfigurationPortfolio(options);
  return normalizeReport(report);
}

function normalizeReport(report) {
  const technicalReady = report.regions.filter((item) => item.technicalReady).length;
  const productionCandidates = report.regions.filter((item) => item.candidateEligible).length;
  const testFixtures = report.regions.filter((item) => item.deploymentClass === "test").length;
  return {
    ...report,
    ok: technicalReady === report.regions.length,
    summary: {
      regions: report.regions.length,
      technicalReady,
      productionCandidates,
      testFixtures
    },
    productionReady: false
  };
}

function renderMarkdown(input) {
  const report = normalizeReport(input);
  const regionRows = report.regions.map((region) =>
    `| ${region.regionCode} | ${region.deploymentClass} | ${region.technicalReady ? "PASS" : "FAIL"} | ${region.summary.configFiles} | ${region.summary.organizations} | ${region.summary.areas} | ${region.summary.enabledFeatures}/${region.summary.enabledExtensions} |`
  );
  const checkRows = report.regions.flatMap((region) =>
    region.checks.map((item) =>
      `| ${region.regionCode} | ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${String(item.detail).replaceAll("|", "/")} |`
    )
  );
  return [
    "# 地区配置准入审计报告",
    "",
    `- 生成时间：${report.generatedAt}`,
    `- 本地技术检查：${report.ok ? "通过" : "未通过"}`,
    "- 生产就绪：否",
    "- 包含配置值：否",
    "",
    "## 地区概览",
    "",
    "| 地区 | 类别 | 技术检查 | 配置文件 | 机构 | 区划 | 功能/扩展 |",
    "| --- | --- | --- | ---: | ---: | ---: | --- |",
    ...regionRows,
    "",
    "## 检查明细",
    "",
    "| 地区 | 状态 | 检查 | 说明 |",
    "| --- | --- | --- | --- |",
    ...checkRows,
    "",
    "## 固定边界",
    "",
    "- 报告只输出计数、状态和 SHA-256 摘要，不输出机构目录、政策正文或适配器参数。",
    "- 自动化检查不能证明地区配置已经由现场责任部门确认。",
    "- 测试地区和通用模板永远不能成为生产候选。",
    ""
  ].join("\n");
}

function writeReport(report, options = {}) {
  const output = path.resolve(options.output || DEFAULT_JSON);
  const markdown = path.resolve(options.markdown || DEFAULT_MARKDOWN);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.mkdirSync(path.dirname(markdown), { recursive: true });
  const normalized = normalizeReport(report);
  fs.writeFileSync(output, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  fs.writeFileSync(markdown, renderMarkdown(normalized), "utf8");
  return { output, markdown };
}

function runCli() {
  const flags = parseArgs();
  const report = normalizeReport(buildReport({
    root: ROOT,
    regionCode: flags.region ? String(flags.region) : undefined
  }));
  const written = writeReport(report, {
    output: flags.output,
    markdown: flags.markdown
  });
  process.stdout.write(`${JSON.stringify({
    ...written,
    ok: report.ok,
    regions: report.summary.regions,
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
  normalizeReport,
  parseArgs,
  renderMarkdown,
  runCli,
  writeReport
};
