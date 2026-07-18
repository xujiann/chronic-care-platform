#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "digital-hospital-standards-readiness-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "digital-hospital-standards-readiness-report.md");

const REQUIRED_FILES = [
  "digital-hospital-governance.js",
  "digital-hospital-self-assessment.js",
  "digital-hospital-self-assessment.html",
  "digital-hospital-self-assessment-ui.js",
  "digital-hospital-standards.html",
  "digital-hospital-standards.js",
  "docs/数智医院标准平台研发报告.md",
  "docs/数智医院六域规范控制矩阵-2026.md"
];

const REQUIRED_STANDARD_MARKERS = [
  "电子病历",
  "互联互通",
  "智慧服务",
  "智慧管理",
  "标准服务",
  "安全合规"
];

const REQUIRED_WORKFLOW_MARKERS = [
  "医院自评",
  "自动校验",
  "省级初审",
  "专家复核",
  "国家抽查",
  "整改闭环"
];

const REQUIRED_SOURCE_MARKERS = [
  "7d64363a20cd4ea798f8343842b28d0c",
  "1740035892298_26600.pdf",
  "43b2d23ff48448ffae96700bc6eaccd7",
  "a14c60de4af9423cbbf45712e27e3cc8",
  "content_1658745812574605312",
  "BAFB47E8874764186BDB7865E8344DAF",
  "90f3de8ae03d488cbddf509dc958f75b",
  "16a32e2b1c0b42e99480b945ef10c0dc",
  "308603c60d554dd49052b5bfb3a9d391",
  "c_1729384452307680",
  "8a23d01133214a779879094dd20cd383",
  "d1a42ae835c743b9b3e83ac0253c3e9f",
  "e26dde958ae74bf5b8f4fe97d83253c7"
];

const REQUIRED_API_MARKERS = [
  "/api/digital-hospital/standards",
  "/api/digital-hospital/policy-register",
  "/api/digital-hospital/control-matrix",
  "buildDigitalHospitalStandardsOverview",
  "buildDigitalHospitalPolicyRegisterBoard",
  "buildDigitalHospitalControlMatrixBoard",
  "normalizeDigitalHospitalControlAction",
  "normalizeDigitalHospitalPolicyReview",
  "seedDigitalHospitalStandards",
  "seedDigitalHospitalPolicyRegister",
  "seedDigitalHospitalControlMatrix",
  "digitalHospitalEvidencePackets",
  "digitalHospitalRiskItems"
];

const REQUIRED_CONTROL_ACTION_MARKERS = [
  "assign-control",
  "record-evidence",
  "verify-control",
  "reopen-control",
  "mark-not-applicable"
];

const REQUIRED_SELF_ASSESSMENT_ACTION_MARKERS = [
  "assign-assessment",
  "save-draft",
  "submit-assessment",
  "start-preliminary-review",
  "escalate-expert-review",
  "record-expert-opinion",
  "request-correction",
  "accept-assessment"
];

const REQUIRED_LAUNCH_MARKERS = [
  "/api/digital-hospital/launch-readiness",
  "/api/digital-hospital/production-evidence-packets",
  "/api/digital-hospital/launch-command-briefs",
  "/api/digital-hospital/formal-cutover-approvals",
  "buildDigitalHospitalLaunchReadiness",
  "buildDigitalHospitalLaunchCommandBriefBoard",
  "buildDigitalHospitalFormalCutoverApprovalBoard",
  "seedDigitalHospitalLaunchRequirements",
  "seedDigitalHospitalProductionEvidencePackets",
  "seedDigitalHospitalLaunchCommandBriefs",
  "seedDigitalHospitalFormalCutoverApprovals",
  "digitalHospitalLaunch:p0Ready",
  "digitalHospitalLaunch:productionEvidence",
  "digitalHospitalLaunch:commandBriefs",
  "digitalHospitalLaunch:formalApprovals",
  "digitalHospitalLaunch:formalBoundary"
];

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function exists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function check(id, passed, detail) {
  return { id, passed: Boolean(passed), detail };
}

function clean(value) {
  return String(value || "").replace(/\|/g, "/");
}

function countMatches(source, pattern) {
  const matches = source.match(new RegExp(pattern, "g"));
  return matches ? matches.length : 0;
}

function buildDigitalHospitalStandardsReadiness(options = {}) {
  const pkg = options.pkg || readJson("package.json");
  const html = options.html || read("digital-hospital-standards.html");
  const js = options.js || read("digital-hospital-standards.js");
  const doc = options.doc || read("docs/数智医院标准平台研发报告.md");
  const controlDoc = options.controlDoc || read("docs/数智医院六域规范控制矩阵-2026.md");
  const governance = options.governance || read("digital-hospital-governance.js");
  const selfAssessmentModel = options.selfAssessmentModel || read("digital-hospital-self-assessment.js");
  const selfAssessmentHtml = options.selfAssessmentHtml || read("digital-hospital-self-assessment.html");
  const selfAssessmentUi = options.selfAssessmentUi || read("digital-hospital-self-assessment-ui.js");
  const manifest = options.manifest || read("scripts/release-artifact-manifest.js");
  const deployCheck = options.deployCheck || read("scripts/deploy-check.js");
  const releaseReport = options.releaseReport || read("scripts/release-report.js");
  const server = options.server || read("server.js");
  const ci = options.ci || read(".github/workflows/ci.yml");
  const auth = options.auth || read("auth.js");

  const standardMarkersPresent = REQUIRED_STANDARD_MARKERS.filter((marker) => js.includes(marker) && (doc.includes(marker) || html.includes(marker)));
  const workflowMarkersPresent = REQUIRED_WORKFLOW_MARKERS.filter((marker) => js.includes(marker) || doc.includes(marker));
  const sourceMarkersPresent = REQUIRED_SOURCE_MARKERS.filter((marker) => js.includes(marker) || doc.includes(marker));
  const apiMarkersPresent = REQUIRED_API_MARKERS.filter((marker) => server.includes(marker) || js.includes(marker));
  const controlActionMarkersPresent = REQUIRED_CONTROL_ACTION_MARKERS.filter((marker) => governance.includes(marker) && (html.includes(marker) || js.includes(marker)));
  const selfAssessmentActionMarkersPresent = REQUIRED_SELF_ASSESSMENT_ACTION_MARKERS.filter((marker) => selfAssessmentModel.includes(marker) && (selfAssessmentHtml.includes(marker) || selfAssessmentUi.includes(marker)));
  const launchMarkersPresent = REQUIRED_LAUNCH_MARKERS.filter((marker) => server.includes(marker) || js.includes(marker) || doc.includes(marker));
  const sectionCount = countMatches(html, "data-digital-hospital-section=");
  const evidencePackCount = countMatches(js, "id: \"(interface|template|material|sample|audit)\"");
  const pilotRowCount = countMatches(js, "target: \"");
  const policyRecordCount = countMatches(governance, "id: \"dhp-");
  const controlCount = countMatches(governance, "id: \"dhc-");

  const checks = [
    check("digitalHospital:files", REQUIRED_FILES.every(exists), REQUIRED_FILES.filter((file) => !exists(file)).join(", ") || "all module files present"),
    check("digitalHospital:roleGuard", html.includes('requireRole(["commission"])') && auth.includes('"digital-hospital-standards.html": ["commission"]'), "commission-only route guard is wired"),
    check("digitalHospital:standardDomains", standardMarkersPresent.length === REQUIRED_STANDARD_MARKERS.length && countMatches(js, "sourceUrl:") >= 6, `${standardMarkersPresent.length}/${REQUIRED_STANDARD_MARKERS.length} standard domains with official sources`),
    check("digitalHospital:workflowLoop", workflowMarkersPresent.length === REQUIRED_WORKFLOW_MARKERS.length && sectionCount >= 6, `${workflowMarkersPresent.length}/${REQUIRED_WORKFLOW_MARKERS.length} workflow markers and ${sectionCount} UI sections`),
    check("digitalHospital:evidenceModel", evidencePackCount >= 5 && js.includes("DIGITAL_HOSPITAL_EVIDENCE_PACKS") && js.includes("DIGITAL_HOSPITAL_REVIEW_QUEUE"), `${evidencePackCount} evidence collection modes`),
    check("digitalHospital:pilotBoundary", pilotRowCount >= 5 && js.includes("现场阻断项") && doc.includes("原则上不集中采集患者姓名"), `${pilotRowCount} pilot rows and explicit no-PII boundary`),
    check("digitalHospital:officialSources", sourceMarkersPresent.length === REQUIRED_SOURCE_MARKERS.length, `${sourceMarkersPresent.length}/${REQUIRED_SOURCE_MARKERS.length} official source markers present`),
    check("digitalHospital:apiContract", apiMarkersPresent.length === REQUIRED_API_MARKERS.length && js.includes("HealthCityAuth?.authFetch"), `${apiMarkersPresent.length}/${REQUIRED_API_MARKERS.length} API markers and frontend auth fetch wiring`),
    check("digitalHospital:policyGovernance", policyRecordCount >= 18 && controlCount >= 12 && html.includes("data-digital-hospital-section=\"policy-register\"") && html.includes("data-digital-hospital-section=\"control-matrix\"") && js.includes("recordDigitalHospitalPolicyReview") && governance.includes("historical-planning") && controlDoc.includes("2026 年现行基线"), `${policyRecordCount} policy records / ${controlCount} controls with lifecycle and review workflow`),
    check("digitalHospital:controlRemediation", controlActionMarkersPresent.length === REQUIRED_CONTROL_ACTION_MARKERS.length && html.includes("digital-hospital-control-action-form") && html.includes("digital-hospital-control-no-pii") && js.includes("loadDigitalHospitalControlMatrixApi") && server.includes("/api/digital-hospital/control-matrix/:id/actions") && governance.includes("independent reviewer"), `${controlActionMarkersPresent.length}/${REQUIRED_CONTROL_ACTION_MARKERS.length} control actions with minimized evidence and independent review`),
    check("digitalHospital:selfAssessment", selfAssessmentActionMarkersPresent.length === REQUIRED_SELF_ASSESSMENT_ACTION_MARKERS.length && selfAssessmentModel.includes("DIGITAL_HOSPITAL_SELF_ASSESSMENT_INDICATORS") && countMatches(selfAssessmentModel, "id: \"dhsi-") >= 12 && selfAssessmentHtml.includes('requireRole(["commission", "institution"])') && selfAssessmentHtml.includes("digital-self-assessment-action-form") && selfAssessmentHtml.includes("digital-self-assessment-no-pii") && selfAssessmentUi.includes("recordDigitalSelfAssessmentAction") && server.includes("/api/digital-hospital/self-assessments/:id/actions") && auth.includes('"digital-hospital-self-assessment.html": ["commission", "institution"]'), `${selfAssessmentActionMarkersPresent.length}/${REQUIRED_SELF_ASSESSMENT_ACTION_MARKERS.length} self-assessment actions with 12 indicators, institution scope and independent review`),
    check("digitalHospital:launchReadiness", launchMarkersPresent.length === REQUIRED_LAUNCH_MARKERS.length && html.includes("data-digital-hospital-section=\"launch-readiness\"") && html.includes("data-digital-hospital-section=\"production-evidence-packets\"") && html.includes("data-digital-hospital-section=\"launch-command-briefs\"") && html.includes("data-digital-hospital-section=\"formal-cutover-approvals\"") && js.includes("recordDigitalHospitalLaunchEvidence") && js.includes("recordDigitalHospitalProductionEvidence") && js.includes("recordDigitalHospitalLaunchCommandBrief") && js.includes("recordDigitalHospitalFormalCutoverApproval"), `${launchMarkersPresent.length}/${REQUIRED_LAUNCH_MARKERS.length} launch readiness markers`),
    check("digitalHospital:docs", doc.includes("flowchart TD") && doc.includes("npm.cmd run digital-hospital:standards-readiness") && doc.includes("数智医院标准平台研发报告"), "module report has workflow diagram and acceptance command"),
    check("digitalHospital:releaseWiring", Boolean(pkg.scripts?.["digital-hospital:standards-readiness"]) && manifest.includes("digital-hospital-standards-readiness-report.md") && deployCheck.includes("digitalHospitalStandards") && releaseReport.includes("digitalHospitalStandards") && ci.includes("digital-hospital:standards-readiness"), "package, manifest, deploy check, release report and CI are wired")
  ];

  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    summary: {
      files: REQUIRED_FILES.length,
      standardDomains: standardMarkersPresent.length,
      workflowMarkers: workflowMarkersPresent.length,
      officialSources: sourceMarkersPresent.length,
      apiMarkers: apiMarkersPresent.length,
      controlActions: controlActionMarkersPresent.length,
      selfAssessmentActions: selfAssessmentActionMarkersPresent.length,
      launchMarkers: launchMarkersPresent.length,
      uiSections: sectionCount,
      evidenceModes: evidencePackCount,
      pilotRows: pilotRowCount,
      policyRecords: policyRecordCount,
      policyControls: controlCount
    },
    source: {
      html: "digital-hospital-standards.html",
      js: "digital-hospital-standards.js",
      doc: "docs/数智医院标准平台研发报告.md",
      controlDoc: "docs/数智医院六域规范控制矩阵-2026.md",
      officialSourceMarkers: REQUIRED_SOURCE_MARKERS
    },
    checks
  };
}

function renderMarkdown(report) {
  return [
    "# Digital hospital standards readiness report",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Standard domains: ${report.summary.standardDomains}`,
    `- Workflow markers: ${report.summary.workflowMarkers}`,
    `- API markers: ${report.summary.apiMarkers}`,
    `- Control actions: ${report.summary.controlActions}`,
    `- Self-assessment actions: ${report.summary.selfAssessmentActions}`,
    `- Launch markers: ${report.summary.launchMarkers}`,
    `- UI sections: ${report.summary.uiSections}`,
    `- Evidence modes: ${report.summary.evidenceModes}`,
    `- Pilot rows: ${report.summary.pilotRows}`,
    `- Policy records: ${report.summary.policyRecords}`,
    `- Policy controls: ${report.summary.policyControls}`,
    "",
    "## Checks",
    "",
    "| Result | Check | Detail |",
    "|---|---|---|",
    ...report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${clean(item.detail)} |`),
    "",
    "## Source files",
    "",
    `- Page: \`${report.source.html}\``,
    `- Model: \`${report.source.js}\``,
    `- Report: \`${report.source.doc}\``,
    `- Control matrix: \`${report.source.controlDoc}\``,
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
  const report = buildDigitalHospitalStandardsReadiness();
  if (flags.write !== "false" && flags.write !== false) writeOutput(report, flags);
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
  REQUIRED_FILES,
  REQUIRED_SOURCE_MARKERS,
  REQUIRED_API_MARKERS,
  REQUIRED_CONTROL_ACTION_MARKERS,
  REQUIRED_SELF_ASSESSMENT_ACTION_MARKERS,
  REQUIRED_LAUNCH_MARKERS,
  REQUIRED_STANDARD_MARKERS,
  REQUIRED_WORKFLOW_MARKERS,
  buildDigitalHospitalStandardsReadiness,
  parseArgs,
  renderMarkdown,
  writeOutput
};
