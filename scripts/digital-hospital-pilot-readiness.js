#!/usr/bin/env node
const { readRuntimeSource } = require("../src/http/runtime-source");
const fs = require("node:fs");
const path = require("node:path");
const {
  buildDigitalHospitalEvaluationCatalog,
  buildDigitalHospitalPilotBoard
} = require("../digital-hospital-evaluation");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "digital-hospital-pilot-readiness-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "digital-hospital-pilot-readiness-report.md");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function check(id, passed, detail) {
  return { id, passed: Boolean(passed), detail };
}

function buildDigitalHospitalPilotReadiness(options = {}) {
  const data = options.data || readJson("data/db.json");
  const catalog = buildDigitalHospitalEvaluationCatalog();
  const board = buildDigitalHospitalPilotBoard(data, { role: "commission" });
  const model = options.model || read("digital-hospital-evaluation.js");
  const html = options.html || read("digital-hospital-evaluation.html");
  const ui = options.ui || read("digital-hospital-evaluation-ui.js");
  const server = options.server || readRuntimeSource(ROOT);
  const auth = options.auth || read("auth.js");
  const accessPolicy = options.accessPolicy || read("access-control-policy.js");
  const doc = options.doc || read("docs/数智医院评价试点上线说明-2026.md");
  const pkg = options.pkg || readJson("package.json");
  const manifest = options.manifest || read("scripts/release-artifact-manifest.js");
  const deploy = options.deploy || read("scripts/deploy-check.js");
  const ci = options.ci || read(".github/workflows/ci.yml");
  const requiredRoutes = [
    "/api/digital-hospital/evaluation-catalog",
    "/api/digital-hospital/pilot-readiness",
    "/api/digital-hospital/pilot-institutions/actions",
    "/api/digital-hospital/pilot-institutions/:id/actions",
    "/api/digital-hospital/pilot-issues/actions",
    "/api/digital-hospital/pilot-issues/:id/actions",
    "/api/digital-hospital/collection-jobs/:id/actions",
    "/api/digital-hospital/evaluation-evidence/:id/actions",
    "/api/digital-hospital/pre-assessments/actions",
    "/api/digital-hospital/pre-assessments/:id/actions"
  ];
  const requiredSections = ["pilot-operations", "pilot-issues", "catalog", "collection", "evidence", "preassessment", "rectification", "boundary"];
  const checks = [
    check("pilotReadiness:catalog", catalog.ok && catalog.summary.packs === 4 && catalog.summary.projects === 70 && catalog.summary.clauses === 70, `${catalog.summary.packs} packs / ${catalog.summary.projects} projects / ${catalog.summary.clauses} clauses`),
    check("pilotReadiness:officialStructure", catalog.packs.find((item) => item.id === "emr")?.projects === 39 && catalog.packs.find((item) => item.id === "smart-service")?.projects === 17 && catalog.packs.find((item) => item.id === "smart-management")?.projects === 10 && catalog.packs.find((item) => item.id === "interoperability")?.projects === 4, "39 EMR / 17 service / 10 management / 4 interoperability"),
    check("pilotReadiness:levelEngine", ["basic", "optional", "applicationCoverage", "dataQualityIndex", "targetMet", "pilot-simulation", "formalResult"].every((marker) => model.includes(marker)), "level inheritance, threshold, evidence and formal-result boundary are modeled"),
    check("pilotReadiness:collection", board.checks.find((item) => item.id === "pilot:collectionAdapters")?.passed, `${board.summary.collectionJobs} validated collection adapters`),
    check("pilotReadiness:evidence", board.checks.find((item) => item.id === "pilot:evidenceBoundary")?.passed && model.includes("independent reviewer"), `${board.summary.evidenceRecords} minimized evidence records with independent review`),
    check("pilotReadiness:rectification", board.checks.find((item) => item.id === "pilot:rectification")?.passed && ["assign-finding", "record-finding-evidence", "resolve-finding", "submit-review", "accept-preassessment"].every((marker) => model.includes(marker)), `${board.summary.openFindings} traceable pilot findings`),
    check("pilotReadiness:operations", board.checks.find((item) => item.id === "pilot:operations")?.passed && ["submit-readiness", "approve-pilot", "pause-pilot", "resume-pilot", "record-daily-review"].every((marker) => model.includes(marker)), `${board.summary.activePilotInstitutions}/${board.summary.pilotInstitutions} pilot institutions active / ${board.summary.overdueP0} overdue P0`),
    check("pilotReadiness:issueClosure", board.checks.find((item) => item.id === "pilot:issueClosure")?.passed && ["createDigitalHospitalPilotIssue", "normalizeDigitalHospitalPilotIssueAction", "independent issue reviewer"].every((marker) => model.includes(marker)), `${board.summary.openPilotIssues}/${board.summary.pilotIssues} pilot issues open / ${board.summary.pendingPilotIssueReviews} pending review`),
    check("pilotReadiness:api", requiredRoutes.every((marker) => server.includes(marker)), `${requiredRoutes.length}/${requiredRoutes.length} pilot API markers`),
    check("pilotReadiness:ui", requiredSections.every((section) => html.includes(`data-digital-evaluation-section="${section}"`)) && ui.includes("refreshBoard") && ui.includes("run-preassessment") && html.includes("digital-evaluation-pilot-issues") && ui.includes("pilotIssues"), `${requiredSections.length}/${requiredSections.length} workbench sections with pilot issue closure`),
    check("pilotReadiness:roleScope", html.includes('src="./page-auth-bootstrap.js" data-roles="commission,institution"') && accessPolicy.includes('"digital-hospital-evaluation.html": entry("评价预评", ["commission", "institution"]') && model.includes("institution account cannot"), "commission and institution role scope is enforced by the central policy"),
    check("pilotReadiness:boundary", board.functionalState === "pilot-launch-ready" && board.formalGoLiveState === "blocked-until-site-evidence-signed" && doc.includes("不替代国家或省级正式评价"), `${board.functionalState} / ${board.formalGoLiveState}`),
    check("pilotReadiness:releaseWiring", Boolean(pkg.scripts?.["digital-hospital:pilot-readiness"]) && manifest.includes("digital-hospital-pilot-readiness-report.md") && deploy.includes("digitalHospitalPilotReadiness") && ci.includes("digital-hospital:pilot-readiness"), "package, manifest, deploy check and CI are wired")
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    functionalState: board.functionalState,
    formalGoLiveState: board.formalGoLiveState,
    summary: { ...board.summary, packs: catalog.summary.packs, projects: catalog.summary.projects, clauses: catalog.summary.clauses, checks: checks.length, passed: checks.filter((item) => item.passed).length },
    checks,
    siteBlockers: board.siteBlockers,
    profiles: board.profiles
  };
}

function renderMarkdown(report) {
  return [
    "# Digital hospital pilot readiness report",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Functional state: ${report.functionalState}`,
    `- Formal go-live state: ${report.formalGoLiveState}`,
    `- Evaluation packs/projects/clauses: ${report.summary.packs}/${report.summary.projects}/${report.summary.clauses}`,
    `- Collection jobs/evidence/pre-assessments: ${report.summary.collectionJobs}/${report.summary.evidenceRecords}/${report.summary.preAssessments}`,
    "",
    "## Checks",
    "",
    "| Result | Check | Detail |",
    "|---|---|---|",
    ...report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${String(item.detail).replace(/\|/g, "/")} |`),
    "",
    "## Formal production boundary",
    "",
    ...(report.siteBlockers.length ? report.siteBlockers.map((item) => `- ${item.title}: ${item.nextAction}`) : ["- Site evidence is complete and ready for formal review."])
  ].join("\n");
}

function parseArgs(argv = process.argv.slice(2)) {
  return Object.fromEntries(argv.filter((item) => item.startsWith("--")).map((item) => {
    const [key, ...rest] = item.slice(2).split("=");
    return [key, rest.length ? rest.join("=") : true];
  }));
}

function writeOutput(report, flags = {}) {
  const output = path.resolve(ROOT, String(flags.output || DEFAULT_OUTPUT));
  const markdown = path.resolve(ROOT, String(flags.markdown || DEFAULT_MARKDOWN));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(markdown, renderMarkdown(report), "utf8");
}

if (require.main === module) {
  try {
    const flags = parseArgs();
    const report = buildDigitalHospitalPilotReadiness();
    writeOutput(report, flags);
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { buildDigitalHospitalPilotReadiness, parseArgs, renderMarkdown, writeOutput };
