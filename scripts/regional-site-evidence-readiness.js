#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { buildCompositeRegionalRelease } = require("../src/platform/regional/composite-release");
const {
  buildRegionalSiteEvidencePortfolio,
  buildRegionalSiteEvidenceStatus
} = require("../src/platform/regional/regional-site-evidence");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_JSON = path.join(ROOT, "release", "regional-site-evidence-readiness.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "regional-site-evidence-readiness.md");

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
  const root = options.root || ROOT;
  const generatedAt = options.generatedAt || options.now || new Date().toISOString();
  if (!options.regionCode) {
    return buildRegionalSiteEvidencePortfolio({ ...options, root, generatedAt });
  }
  const composite = buildCompositeRegionalRelease({
    root,
    regionCode: options.regionCode,
    generatedAt
  });
  const status = buildRegionalSiteEvidenceStatus({
    ...options,
    root,
    generatedAt,
    regionCode: options.regionCode,
    expected: {
      regionCode: options.regionCode,
      releaseId: composite.releaseId,
      compositeDigest: composite.artifact.digest,
      regionalContentDigest: `sha256:${composite.region.contentDigest}`
    }
  });
  return {
    schemaVersion: "regional-site-evidence-portfolio-v1",
    generatedAt,
    ok: status.ok,
    productionReady: false,
    containsEvidenceBodies: false,
    containsReviewerIdentities: false,
    containsSignatures: false,
    containsKeyMaterial: false,
    summary: {
      regions: 1,
      verifierHealthy: status.ok ? 1 : 0,
      configured: status.configured ? 1 : 0,
      evidenceReady: status.evidenceReady ? 1 : 0,
      blocked: status.evidenceReady ? 0 : 1
    },
    regions: [status]
  };
}

function renderMarkdown(report) {
  const overview = report.regions.map((region) =>
    `| ${region.regionCode} | ${region.ok ? "PASS" : "FAIL"} | ${region.configured ? "YES" : "NO"} | ${region.summary.ready}/${region.summary.requiredScopes} | ${region.evidenceReady ? "YES" : "NO"} | ${region.blockers.join(", ") || "-"} |`
  );
  const scopes = report.regions.flatMap((region) =>
    region.scopes.map((scope) =>
      `| ${region.regionCode} | ${scope.scope} | ${scope.presentOnce ? "YES" : "NO"} | ${scope.current ? "YES" : "NO"} | ${scope.timelineValid ? "YES" : "NO"} | ${scope.independentReview ? "YES" : "NO"} | ${scope.subjectMatches ? "YES" : "NO"} | ${scope.ready ? "PASS" : "BLOCK"} |`
    )
  );
  return [
    "# 地区现场证据准入报告",
    "",
    `- 生成时间：${report.generatedAt}`,
    `- 验证器健康：${report.summary.verifierHealthy}/${report.summary.regions}`,
    `- 证据就绪：${report.summary.evidenceReady}/${report.summary.regions}`,
    "- 生产就绪：否",
    "- 包含证据正文或复核人身份：否",
    "",
    "## 地区概览",
    "",
    "| 地区 | 验证器 | 已配置 | 就绪范围 | 证据就绪 | 阻断码 |",
    "| --- | --- | --- | ---: | --- | --- |",
    ...overview,
    "",
    "## 五类证据门禁",
    "",
    "| 地区 | 范围 | 唯一存在 | 时效有效 | 时间链 | 独立复核 | 发布绑定 | 状态 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...scopes,
    "",
    "## 固定边界",
    "",
    "- 证据文件必须位于服务端绝对路径，且文件字节与服务端 SHA-256 锁定值完全一致。",
    "- 输出只保留范围状态、时间、摘要和稳定阻断码，不输出受控引用、人员身份或证据正文。",
    "- 五类证据全部通过也只能形成投产候选条件，不能产生外部生产授权。",
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
    evidenceReady: report.summary.evidenceReady,
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
  renderMarkdown,
  runCli,
  writeReport
};
