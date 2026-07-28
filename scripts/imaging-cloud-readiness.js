#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const ImagingCloudProduction = require("../imaging-cloud-production");
const ImagingCloudPlanning = require("../imaging-cloud-planning");

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
    packageSource: read("package.json"),
    production: read("imaging-cloud-production.js"),
    planning: read("imaging-cloud-planning.js"),
    solutionA: read("solution-a-connectors.js"),
    solutionAAcceptance: read("scripts/solution-a-acceptance.js")
  };
  const productionCenter = ImagingCloudProduction.center({});
  const standaloneSmoke = ImagingCloudProduction.runStandaloneSmoke({});
  const planningReview = ImagingCloudPlanning.buildImagingDevelopmentPlanReview({});
  const checks = [
    check("spec:function-mobile", sources.html.includes("mobile-viewer") && sources.pageJs.includes("data-share-study") && sources.pageJs.includes("shareStudy") && sources.pageJs.includes("DICOM"), "mobile patient viewing, no-terminal-storage and share channel are visible", "spec"),
    check("spec:hospital-ingest", sources.server.includes("/api/imaging-cloud/ingest") && sources.server.includes("DICOM TLS") && sources.server.includes("C-STORE") && sources.server.includes("C-MOVE"), "hospital DICOM/RIS/PACS ingest API and protocols are modeled", "integration"),
    check("spec:main-index", sources.server.includes("mainIndexRule") && sources.server.includes("mainIndex") && sources.docs.includes("mainIndex"), "regional main-index rule is implemented and documented", "integration"),
    check("spec:emr-compatibility", sources.server.includes("diagnosticReports") && sources.server.includes("personalRecords") && sources.html.includes("emr-compatibility"), "ingest creates diagnostic report and personal health-record evidence", "emr"),
    check("spec:mutual-recognition", sources.server.includes("createImageCloudMutualRecognitionChain") && sources.server.includes("/api/imaging-cloud/studies/:id/mutual-recognition") && sources.html.includes("mutual-recognition-table") && sources.pageJs.includes("startMutualRecognition"), "imaging studies can create and close a county mutual-recognition chain on the same main index", "integration"),
    check("spec:recognition-appeal", ["submitImageCloudRecognitionAppeal", "reviewImageCloudRecognitionAppeal", "/api/imaging-cloud/studies/:id/mutual-recognition/appeal", "independent reviewer"].every((marker) => sources.server.includes(marker)) && ["submitMutualRecognitionAppeal", "reviewMutualRecognitionAppeal", "data-appeal-recognition", "data-review-recognition-appeal"].every((marker) => sources.pageJs.includes(marker)), "rejected recognition decisions support minimized institution appeals and independent review", "integration"),
    check("spec:security", sources.server.includes("dataAccessLogs") && sources.server.includes("securityEvents") && sources.docs.includes("DICOM TLS") && sources.docs.includes("HTTPS") && sources.docs.includes("AES"), "security baseline covers level protection, encryption and local controllability", "security"),
    check("ui:workbench", sources.html.includes("data-imaging-section=\"hospital-ingest\"") && sources.html.includes("study-table") && sources.html.includes("mobile-viewer"), "workbench has hospital ingest, study table and mobile viewer surfaces", "ui"),
    check("ui:development-plan", sources.html.includes("data-imaging-section=\"development-plan\"") && sources.pageJs.includes("renderDevelopmentPlan") && sources.server.includes("seedImageCloudDevelopmentPlan"), "implemented features and next development plan are visible at runtime", "ui"),
    check("docs:summary-plan", sources.docs.includes("imageCloudStudyId") && sources.docs.includes("PACS/RIS/EMR") && sources.docs.includes("test/api.test.js"), "documentation summarizes delivered scope and next development plan", "docs"),
    check("ui:auth-route", sources.auth.includes("\"imaging-cloud.html\": [\"commission\", \"institution\", \"county\", \"citizen\"]") && sources.auth.includes("imaging-cloud.html"), "role routing includes commission, institution, county and citizen", "ui"),
    check("pwa:cache", sources.serviceWorker.includes("imaging-cloud.html") && sources.serviceWorker.includes("imaging-cloud.js") && sources.serviceWorker.includes("const CACHE_NAME = \"chronic-care-citizen-v"), "PWA cache includes imaging cloud assets in a versioned cache", "release"),
    check("release:script", sources.packageSource.includes("imaging-cloud:readiness") && sources.packageSource.includes("scripts/imaging-cloud-readiness.js"), "package script is wired", "release"),
    check("production:formal-boundary", productionCenter.formalGoLiveState === "blocked-until-site-evidence-signed" && productionCenter.productionReady === false, "software readiness cannot silently open the formal production gate", "production"),
    check("production:synthetic-acceptance", productionCenter.summary.syntheticChecks === 10 && sources.production.includes("synthetic-test-data") && sources.solutionAAcceptance.includes("syntheticPatient"), "ten-step synthetic FHIR/DICOM/OHIF acceptance is tracked without real patient data", "production"),
    check("production:site-evidence", productionCenter.summary.requirements === 7 && ["externalSigner", "externalOrganization", "independent verification", "evidenceDigest"].every((marker) => sources.production.includes(marker)), "seven site blockers require external provenance and independent SHA-256 verification", "production"),
    check("production:structured-receipts", productionCenter.summary.siteReceipts === 5 && ImagingCloudProduction.SITE_RECEIPT_CONTRACTS.every((item) => item.requiredFields.length && item.requirementIds.length) && ["DICOM-TLS", "DiagnosticReport", "no-original-dicom-on-mobile", "independentReviewerRole", "original-pacs-and-report-priority"].every((marker) => sources.production.includes(marker)), "PACS/RIS, FHIR writeback, object storage, appeal and degradation receipts use minimized typed contracts", "production"),
    check("production:endpoints-and-drills", productionCenter.summary.endpoints === 5 && productionCenter.summary.drills === 4 && sources.production.includes("production endpoint must use HTTPS or DICOM TLS"), "five production endpoints and four failure drills are governed", "production"),
    check("production:dual-approval", productionCenter.summary.approvals === 2 && sources.production.includes("business and technical approvals require different signers"), "business and technical cutover approvals require distinct accountable signers", "production"),
    check("production:audit-chain", sources.production.includes("previousDigest") && sources.production.includes("\"GENESIS\"") && sources.production.includes("JSON.stringify(row)"), "production operations are recorded in a tamper-evident digest chain", "security"),
    check("production:ui", sources.html.includes('data-imaging-section="production-gate"') && sources.pageJs.includes("renderProductionGate"), "production boundary and blockers are visible in the imaging workbench", "ui"),
    check("ui:production-operations", ["data-production-action=\"endpoint\"", "data-production-action=\"synthetic\"", "data-production-action=\"requirement\"", "data-production-action=\"drill\"", "data-production-action=\"approval\"", "静态预览不写入生产证据"].every((marker)=>sources.pageJs.includes(marker)), "endpoint, synthetic, evidence, drill and approval operations are available while static preview stays read-only", "ui"),
    check("production:standalone-smoke", standaloneSmoke.codeReady && standaloneSmoke.releaseDecision === "no-go" && standaloneSmoke.checks.some((item) => item.id === "rollback-gate" && item.passed), "standalone module smoke verifies rollback controls while incomplete site evidence remains No-Go", "release"),
    check("production:route-contract", ImagingCloudProduction.ROUTE_CONTRACTS.length === 9 && ImagingCloudProduction.ROUTE_CONTRACTS.every((item)=>item.roles?.length && item.handler?.startsWith("ImagingCloudProduction.")) && sources.docs.includes("/api/imaging-cloud/production-center"), "nine role-guarded T00 integration route contracts are documented", "integration")
    ,check("plan:diagnostic-viewer-performance", planningReview.capabilities.some((item)=>item.id === "diagnostic-viewer-performance-acceptance" && item.status === "implemented-awaiting-site-run") && sources.planning.includes("VIEWER_ACCEPTANCE_THRESHOLDS") && sources.pageJs.includes("renderImagingPlanCompletion"), "diagnostic DICOMweb viewer performance has executable thresholds, audit checks and a visible site-run boundary", "plan")
    ,check("plan:regulatory-statistics", planningReview.capabilities.some((item)=>item.id === "regulatory-statistics-and-ranking" && item.status === "implemented-awaiting-production-data") && sources.planning.includes("buildRegulatoryStatistics") && sources.html.includes("imaging-regulatory-statistics"), "institution/city regulatory statistics, rankings and anomaly detection are implemented without patient identifiers", "plan")
  ];
  const codeReady = checks.every((item) => item.passed);
  return {
    ok: codeReady,
    codeReady,
    generatedAt: new Date().toISOString(),
    module: "imaging-cloud",
    functionalState: productionCenter.functionalState,
    formalGoLiveState: productionCenter.formalGoLiveState,
    productionReady: productionCenter.productionReady,
    summary: {
      checks: checks.length,
      passed: checks.filter((item) => item.passed).length,
      requiredCapabilities: ["hospital ingest", "patient mobile viewing", "EMR compatibility", "authorization sharing", "quality control", "mutual-recognition appeal", "security baseline", "development plan", "synthetic acceptance", "formal production gate"],
      production: productionCenter.summary,
      plannedCodeCapabilities: planningReview.summary
    },
    artifacts: {
      page: "imaging-cloud.html",
      pageScript: "imaging-cloud.js",
      serverApi: "server.js",
      doc: IMAGE_CLOUD_DOC,
      productionService: "imaging-cloud-production.js",
      productionTest: "test/imaging-cloud-production.test.js",
      planningService: "imaging-cloud-planning.js",
      planningTest: "test/imaging-cloud-planning.test.js",
      report: "release/imaging-cloud-readiness-report.md"
    },
    siteBlockers: productionCenter.requirements,
    productionCenter: {
      summary: productionCenter.summary,
      preflight: productionCenter.preflight,
      rollback: productionCenter.rollback,
      routeContracts: productionCenter.routeContracts,
      standaloneSmoke
    },
    planningReview,
    t00Integration: {
      status: "pending-shared-file-integration",
      sharedFiles: ["server.js", "package.json", "service-worker.js", "README.md", "release summary"],
      routeContracts: productionCenter.routeContracts
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
    `- Functional state: ${report.functionalState}`,
    `- Formal go-live state: ${report.formalGoLiveState}`,
    `- Production ready: ${report.productionReady ? "yes" : "no"}`,
    `- Required capabilities: ${report.summary.requiredCapabilities.join(", ")}`,
    "",
    "## Artifacts",
    "",
    `- Page: ${report.artifacts.page}`,
    `- Page script: ${report.artifacts.pageScript}`,
    `- Production service: ${report.artifacts.productionService}`,
    `- Server API: ${report.artifacts.serverApi}`,
    `- Documentation: ${report.artifacts.doc}`,
    "",
    "## Checks",
    "",
    "| Result | Category | Check | Detail |",
    "|---|---|---|---|",
    ...rows,
    "",
    "## Production gate",
    "",
    `- Synthetic checks passed: ${report.productionCenter.summary.syntheticChecksPassed}/${report.productionCenter.summary.syntheticChecks}`,
    `- Endpoints ready: ${report.productionCenter.summary.endpointsReady}/${report.productionCenter.summary.endpoints}`,
    `- Site requirements signed: ${report.productionCenter.summary.requirementsSigned}/${report.productionCenter.summary.requirements}`,
    `- Drills passed: ${report.productionCenter.summary.drillsPassed}/${report.productionCenter.summary.drills}`,
    `- Approvals signed: ${report.productionCenter.summary.approvalsSigned}/${report.productionCenter.summary.approvals}`,
    `- Typed site receipts verified: ${report.productionCenter.summary.siteReceiptsVerified}/${report.productionCenter.summary.siteReceipts}`,
    `- Standalone smoke: ${report.productionCenter.standaloneSmoke.codeReady ? "PASS" : "FAIL"}; release decision: ${report.productionCenter.standaloneSmoke.releaseDecision.toUpperCase()}`,
    `- Planned code capabilities: ${report.planningReview.summary.implementedCodeCapabilities}/${report.planningReview.summary.plannedCodeCapabilities}; site runs accepted: ${report.planningReview.summary.siteRunsAccepted}`,
    "",
    "Formal production go-live remains blocked until runtime synthetic acceptance, production endpoint probes, site evidence, drills and dual approvals are actually recorded.",
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
