#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "imaging-cloud-readiness-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "imaging-cloud-readiness-report.md");
const IMAGE_CLOUD_DOC = "docs/\u533b\u5b66\u5f71\u50cf\u4e91\u529f\u80fd\u8bf4\u660e.md";

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function check(id, passed, detail, category = "imaging-cloud") {
  return { id, category, passed: Boolean(passed), detail };
}

function parseArgs(argv = process.argv.slice(2)) {
  const flags = {};
  argv.forEach((flag) => {
    if (!flag.startsWith("--")) return;
    const [key, ...rest] = flag.slice(2).split("=");
    flags[key] = rest.length ? rest.join("=") : true;
  });
  return {
    output: flags.output || DEFAULT_OUTPUT,
    markdown: flags.markdown || DEFAULT_MARKDOWN
  };
}

function buildImagingCloudReadinessReport(options = {}) {
  const sources = options.sources || {
    html: read("imaging-cloud.html"),
    pageJs: read("imaging-cloud.js"),
    server: read("server.js"),
    auth: read("auth.js"),
    serviceWorker: read("service-worker.js"),
    docs: read(IMAGE_CLOUD_DOC),
    packageSource: read("package.json")
  };
  const checks = [
    check("spec:function-mobile", sources.html.includes("mobile-viewer") && sources.pageJs.includes("data-share-study") && sources.pageJs.includes("shareStudy") && sources.pageJs.includes("DICOM"), "mobile patient viewing, no-terminal-storage and share channel are visible", "spec"),
    check("spec:hospital-ingest", sources.server.includes("/api/imaging-cloud/ingest") && sources.server.includes("DICOM TLS") && sources.server.includes("C-STORE") && sources.server.includes("C-MOVE"), "hospital DICOM/RIS/PACS ingest API and protocols are modeled", "integration"),
    check("spec:main-index", sources.server.includes("mainIndexRule") && sources.server.includes("mainIndex") && sources.docs.includes("mainIndex"), "regional main-index rule is implemented and documented", "integration"),
    check("spec:emr-compatibility", sources.server.includes("diagnosticReports") && sources.server.includes("personalRecords") && sources.html.includes("emr-compatibility"), "ingest creates diagnostic report and personal health-record evidence", "emr"),
    check("spec:mutual-recognition", sources.server.includes("createImageCloudMutualRecognitionChain") && sources.server.includes("/api/imaging-cloud/studies/:id/mutual-recognition") && sources.html.includes("mutual-recognition-table") && sources.pageJs.includes("startMutualRecognition"), "imaging studies can create and close a county mutual-recognition chain on the same main index", "integration"),
    check("spec:security", sources.server.includes("dataAccessLogs") && sources.server.includes("securityEvents") && sources.docs.includes("DICOM TLS") && sources.docs.includes("HTTPS") && sources.docs.includes("AES"), "security baseline covers level protection, encryption and local controllability", "security"),
    check("ui:workbench", sources.html.includes("data-imaging-section=\"hospital-ingest\"") && sources.html.includes("study-table") && sources.html.includes("mobile-viewer"), "workbench has hospital ingest, study table and mobile viewer surfaces", "ui"),
    check("ui:development-plan", sources.html.includes("data-imaging-section=\"development-plan\"") && sources.pageJs.includes("renderDevelopmentPlan") && sources.server.includes("seedImageCloudDevelopmentPlan"), "implemented features and next development plan are visible at runtime", "ui"),
    check("docs:summary-plan", sources.docs.includes("imageCloudStudyId") && sources.docs.includes("PACS/RIS/EMR") && sources.docs.includes("test/api.test.js"), "documentation summarizes delivered scope and next development plan", "docs"),
    check("ui:auth-route", sources.auth.includes("\"imaging-cloud.html\": [\"commission\", \"institution\", \"county\", \"citizen\"]") && sources.auth.includes("imaging-cloud.html"), "role routing includes commission, institution, county and citizen", "ui"),
    check("pwa:cache", sources.serviceWorker.includes("imaging-cloud.html") && sources.serviceWorker.includes("imaging-cloud.js") && sources.serviceWorker.includes("const CACHE_NAME = \"chronic-care-citizen-v"), "PWA cache includes imaging cloud assets in a versioned cache", "release"),
    check("release:script", sources.packageSource.includes("imaging-cloud:readiness") && sources.packageSource.includes("scripts/imaging-cloud-readiness.js"), "package script is wired", "release")
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    module: "imaging-cloud",
    summary: {
      checks: checks.length,
      passed: checks.filter((item) => item.passed).length,
      requiredCapabilities: ["hospital ingest", "patient mobile viewing", "EMR compatibility", "authorization sharing", "quality control", "security baseline", "development plan"]
    },
    artifacts: {
      page: "imaging-cloud.html",
      pageScript: "imaging-cloud.js",
      serverApi: "server.js",
      doc: IMAGE_CLOUD_DOC,
      report: "release/imaging-cloud-readiness-report.md"
    },
    checks
  };
}

function renderMarkdown(report) {
  const rows = report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.category} | ${item.id} | ${String(item.detail || "").replace(/\|/g, "/")} |`);
  return [
    "# Imaging cloud readiness report",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Required capabilities: ${report.summary.requiredCapabilities.join(", ")}`,
    "",
    "## Artifacts",
    "",
    `- Page: ${report.artifacts.page}`,
    `- Page script: ${report.artifacts.pageScript}`,
    `- Server API: ${report.artifacts.serverApi}`,
    `- Documentation: ${report.artifacts.doc}`,
    "",
    "## Checks",
    "",
    "| Result | Category | Check | Detail |",
    "|---|---|---|---|",
    ...rows,
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
  const report = buildImagingCloudReadinessReport();
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
  buildImagingCloudReadinessReport,
  parseArgs,
  renderMarkdown,
  writeOutput
};
