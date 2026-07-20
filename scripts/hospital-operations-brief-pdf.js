#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_PDF = path.join(ROOT, "output", "pdf", "hospital-operations-module-brief-report.pdf");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "hospital-operations-brief-pdf-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "hospital-operations-brief-pdf-report.md");

function relative(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

function check(id, passed, detail) {
  return { id, passed: Boolean(passed), detail };
}

function countPdfPages(buffer) {
  const source = buffer.toString("latin1");
  return (source.match(/\/Type\s*\/Page(?!s)/g) || []).length;
}

function parseArgs(argv = process.argv.slice(2)) {
  const flags = {};
  argv.forEach((flag) => {
    if (!flag.startsWith("--")) return;
    const [key, ...rest] = flag.slice(2).split("=");
    flags[key] = rest.length ? rest.join("=") : true;
  });
  return {
    pdf: flags.pdf || DEFAULT_PDF,
    output: flags.output || DEFAULT_OUTPUT,
    markdown: flags.markdown || DEFAULT_MARKDOWN
  };
}

function buildHospitalOperationsBriefPdfReport(options = {}) {
  const pdfPath = path.resolve(ROOT, String(options.pdf || DEFAULT_PDF));
  const moduleScript = path.join(ROOT, "scripts", "hospital-operations-module-report.js");
  const releaseScript = path.join(ROOT, "scripts", "hospital-operations-release.js");
  const readinessScript = path.join(ROOT, "scripts", "hospital-operations-readiness.js");
  const exists = fs.existsSync(pdfPath);
  const buffer = exists ? fs.readFileSync(pdfPath) : Buffer.alloc(0);
  const stats = exists ? fs.statSync(pdfPath) : null;
  const pages = exists ? countPdfPages(buffer) : 0;
  const checks = [
    check("briefPdf:exists", exists, `${relative(pdfPath)} exists`),
    check("briefPdf:size", exists && stats.size >= 50000, `${stats?.size || 0} bytes`),
    check("briefPdf:twoPages", pages === 2, `${pages} pages`),
    check("briefPdf:moduleEvidenceSource", fs.existsSync(moduleScript), relative(moduleScript)),
    check("briefPdf:releaseEvidenceSource", fs.existsSync(releaseScript), relative(releaseScript)),
    check("briefPdf:readinessEvidenceSource", fs.existsSync(readinessScript), relative(readinessScript))
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    title: "医院运行监测与资源调度平台开发简要报告",
    artifact: {
      pdf: relative(pdfPath),
      pages,
      bytes: stats?.size || 0,
      updatedAt: stats?.mtime?.toISOString() || null,
      sourceEvidence: [
        "release/hospital-operations-module-report.md",
        "release/hospital-operations-release-report.md",
        "release/hospital-operations-readiness-report.md"
      ],
      frontendEntry: "operations.html"
    },
    checks
  };
}

function renderMarkdown(report) {
  return [
    "# 医院运行监测平台简要 PDF 报告验收",
    "",
    `- 生成时间：${report.generatedAt}`,
    `- 结论：${report.ok ? "通过" : "需整改"}`,
    `- PDF：${report.artifact.pdf}`,
    `- 页数：${report.artifact.pages}`,
    `- 文件大小：${report.artifact.bytes} bytes`,
    `- 页面入口：${report.artifact.frontendEntry}`,
    "",
    "## 来源证据",
    "",
    ...report.artifact.sourceEvidence.map((item) => `- ${item}`),
    "",
    "## 检查项",
    "",
    "| 结果 | 检查 | 说明 |",
    "|---|---|---|",
    ...report.checks.map((item) => `| ${item.passed ? "通过" : "未通过"} | ${item.id} | ${item.detail} |`),
    ""
  ].join("\n");
}

function writeOutput(report, flags = {}) {
  const output = path.resolve(ROOT, String(flags.output || DEFAULT_OUTPUT));
  const markdown = path.resolve(ROOT, String(flags.markdown || DEFAULT_MARKDOWN));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2), "utf8");
  fs.mkdirSync(path.dirname(markdown), { recursive: true });
  fs.writeFileSync(markdown, renderMarkdown(report), "utf8");
}

function runCli() {
  const flags = parseArgs();
  const report = buildHospitalOperationsBriefPdfReport(flags);
  writeOutput(report, flags);
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

module.exports = {
  buildHospitalOperationsBriefPdfReport,
  countPdfPages,
  parseArgs,
  renderMarkdown,
  writeOutput
};
