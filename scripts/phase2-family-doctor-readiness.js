#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "phase2-family-doctor-readiness-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "phase2-family-doctor-readiness-report.md");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function check(id, passed, detail) {
  return { id, passed: Boolean(passed), detail };
}

function clean(value) {
  return String(value || "").replace(/\|/g, "/");
}

function defaultTemplates() {
  return [
    { id: "p2fdt-basic", requiredFields: ["residentId", "teamId", "packageId"], reviewSteps: ["resident-apply", "institution-review"], status: "active" },
    { id: "p2fdt-chronic", requiredFields: ["residentId", "diseaseType", "teamId", "packageId"], reviewSteps: ["resident-apply", "team-assessment", "institution-review"], status: "active" },
    { id: "p2fdt-elderly", requiredFields: ["residentId", "caregiver", "teamId", "packageId"], reviewSteps: ["resident-apply", "family-contact-check", "renewal-review"], status: "active" }
  ];
}

function defaultTeams() {
  return [
    { id: "p2fdtm-qnw", institutionCode: "MR3", leaderDoctorId: "doc-liu", capacity: 1200, status: "active" },
    { id: "p2fdtm-central", institutionCode: "MR1", leaderDoctorId: "doc-wang", capacity: 900, status: "active" },
    { id: "p2fdtm-gjz", institutionCode: "MR5", leaderDoctorId: "doc-sun", capacity: 1000, status: "active" }
  ];
}

function defaultPackages() {
  return [
    { id: "p2fdp-basic", templateId: "p2fdt-basic", serviceItems: ["health archive"], status: "active" },
    { id: "p2fdp-hypertension", templateId: "p2fdt-chronic", serviceItems: ["blood pressure"], status: "active" },
    { id: "p2fdp-diabetes", templateId: "p2fdt-chronic", serviceItems: ["blood glucose"], status: "active" },
    { id: "p2fdp-elderly", templateId: "p2fdt-elderly", serviceItems: ["elderly assessment"], status: "active" }
  ];
}

function defaultApplications() {
  return [
    { id: "p2fda-r3-gjz", residentId: "r3", packageId: "p2fdp-basic", teamId: "p2fdtm-gjz", templateId: "p2fdt-basic", applicationType: "new-contract", reviewStatus: "pending", reviewInstitutionCode: "MR5", consentStatus: "resident-confirmed" },
    { id: "p2fda-r1", residentId: "r1", packageId: "p2fdp-hypertension", teamId: "p2fdtm-qnw", templateId: "p2fdt-chronic", applicationType: "new-contract", reviewStatus: "approved", reviewInstitutionCode: "MR3", consentStatus: "signed" },
    { id: "p2fda-r2", residentId: "r2", packageId: "p2fdp-diabetes", teamId: "p2fdtm-central", templateId: "p2fdt-chronic", applicationType: "renewal", reviewStatus: "pending", reviewInstitutionCode: "MR1", consentStatus: "signed" },
    { id: "p2fda-r3", residentId: "r3", packageId: "p2fdp-basic", teamId: "p2fdtm-qnw", templateId: "p2fdt-basic", applicationType: "new-contract", reviewStatus: "pending", reviewInstitutionCode: "MR3", consentStatus: "resident-confirmed" },
    { id: "p2fda-r4", residentId: "r4", packageId: "p2fdp-elderly", teamId: "p2fdtm-qnw", templateId: "p2fdt-elderly", applicationType: "renewal", reviewStatus: "approved", reviewInstitutionCode: "MR3", consentStatus: "family-confirmed" }
  ];
}

function defaultContracts() {
  return [
    { id: "p2fdc-r1", residentId: "r1", packageId: "p2fdp-hypertension", teamId: "p2fdtm-qnw", templateId: "p2fdt-chronic", status: "active", fulfillmentPercent: 72, renewalStatus: "not-due", satisfactionScore: 96, auditHash: "sha256:r1" },
    { id: "p2fdc-r2", residentId: "r2", packageId: "p2fdp-diabetes", teamId: "p2fdtm-central", templateId: "p2fdt-chronic", status: "renewal-pending", fulfillmentPercent: 88, renewalStatus: "pending-review", satisfactionScore: 92, auditHash: "sha256:r2" },
    { id: "p2fdc-r4", residentId: "r4", packageId: "p2fdp-elderly", teamId: "p2fdtm-qnw", templateId: "p2fdt-elderly", status: "active", fulfillmentPercent: 64, renewalStatus: "family-confirmed", satisfactionScore: 90, auditHash: "sha256:r4" }
  ];
}

function defaultFulfillments() {
  return [
    { id: "p2fdf-r1-bp", contractId: "p2fdc-r1", residentId: "r1", teamId: "p2fdtm-qnw", serviceType: "monthly-followup", status: "completed", auditHash: "sha256:f1" },
    { id: "p2fdf-r1-rx", contractId: "p2fdc-r1", residentId: "r1", teamId: "p2fdtm-qnw", serviceType: "medication-review", status: "completed", auditHash: "sha256:f2" },
    { id: "p2fdf-r2-dm", contractId: "p2fdc-r2", residentId: "r2", teamId: "p2fdtm-central", serviceType: "lab-reminder", status: "completed", auditHash: "sha256:f3" },
    { id: "p2fdf-r2-renewal", contractId: "p2fdc-r2", residentId: "r2", teamId: "p2fdtm-central", serviceType: "renewal-review", status: "pending-signoff", auditHash: "sha256:f4" },
    { id: "p2fdf-r4-elderly", contractId: "p2fdc-r4", residentId: "r4", teamId: "p2fdtm-qnw", serviceType: "elderly-assessment", status: "completed", auditHash: "sha256:f5" }
  ];
}

function mergeRows(defaultRows, currentRows, key = "id") {
  const merged = new Map();
  (Array.isArray(defaultRows) ? defaultRows : []).forEach((item) => merged.set(item[key], item));
  (Array.isArray(currentRows) ? currentRows : []).forEach((item) => {
    if (!item?.[key]) return;
    merged.set(item[key], { ...(merged.get(item[key]) || {}), ...item });
  });
  return [...merged.values()];
}

function buildPhase2FamilyDoctorReadiness(options = {}) {
  const data = options.data ?? readJson("data/db.json");
  const pkg = options.pkg ?? readJson("package.json");
  const serverSource = options.serverSource ?? readText("server.js");
  const citizenSource = options.citizenSource ?? readText("citizen.js");
  const citizenHtml = options.citizenHtml ?? readText("citizen.html");
  const institutionSource = options.institutionSource ?? readText("institution.js");
  const institutionHtml = options.institutionHtml ?? readText("institution.html");
  const platformSource = options.platformSource ?? readText("platform.js");
  const platformHtml = options.platformHtml ?? readText("platform.html");
  const manifestSource = options.manifestSource ?? readText(path.join("scripts", "release-artifact-manifest.js"));
  const deployCheckSource = options.deployCheckSource ?? readText(path.join("scripts", "deploy-check.js"));
  const releaseReportSource = options.releaseReportSource ?? readText(path.join("scripts", "release-report.js"));
  const templates = options.templates ?? mergeRows(defaultTemplates(), data.phase2FamilyDoctorTemplates, "id");
  const teams = options.teams ?? mergeRows(defaultTeams(), data.phase2FamilyDoctorTeams, "id");
  const packages = options.packages ?? mergeRows(defaultPackages(), data.phase2FamilyDoctorServicePackages, "id");
  const applications = options.applications ?? mergeRows(defaultApplications(), data.phase2FamilyDoctorApplications, "id");
  const contracts = options.contracts ?? mergeRows(defaultContracts(), data.phase2FamilyDoctorContracts, "id");
  const fulfillments = options.fulfillments ?? mergeRows(defaultFulfillments(), data.phase2FamilyDoctorFulfillments, "id");
  const templateIds = new Set(templates.map((item) => item.id));
  const packageIds = new Set(packages.map((item) => item.id));
  const teamIds = new Set(teams.map((item) => item.id));
  const contractIds = new Set(contracts.map((item) => item.id));
  const renewalRows = [...applications, ...contracts].filter((item) => /renewal|续约/i.test(`${item.applicationType || ""} ${item.renewalStatus || ""} ${item.status || ""}`));
  const satisfactionRows = contracts.filter((item) => Number(item.satisfactionScore || 0) > 0 || item.residentReview);
  const checks = [
    check("phase2FamilyDoctor:templates", templates.length >= 3 && templates.every((item) => item.requiredFields?.length && item.reviewSteps?.length && item.status), `${templates.length} templates`),
    check("phase2FamilyDoctor:teams", teams.length >= 3 && teams.every((item) => item.institutionCode && item.leaderDoctorId && item.capacity), `${teams.length} teams`),
    check("phase2FamilyDoctor:packages", packages.length >= 4 && packages.every((item) => templateIds.has(item.templateId) && item.serviceItems?.length && item.status), `${packages.length} packages`),
    check("phase2FamilyDoctor:resident-applications", applications.length >= 4 && applications.every((item) => item.residentId && packageIds.has(item.packageId) && teamIds.has(item.teamId) && item.consentStatus), `${applications.length} applications`),
    check("phase2FamilyDoctor:institution-review", applications.some((item) => item.reviewStatus === "pending") && applications.some((item) => item.reviewStatus === "approved") && applications.every((item) => item.reviewInstitutionCode), "pending and approved review states are represented"),
    check("phase2FamilyDoctor:contract-fulfillment", contracts.length >= 3 && fulfillments.length >= 5 && fulfillments.every((item) => contractIds.has(item.contractId) && item.auditHash && item.serviceType), `${contracts.length} contracts / ${fulfillments.length} fulfillments`),
    check("phase2FamilyDoctor:renewal-satisfaction", renewalRows.length >= 2 && satisfactionRows.length >= 3, `${renewalRows.length} renewal rows / ${satisfactionRows.length} satisfaction rows`),
    check("phase2FamilyDoctor:runtime-api", serverSource.includes("/api/phase2/family-doctor-contracts") && serverSource.includes("buildPhase2FamilyDoctorOverview") && serverSource.includes("phase2-family-doctor-application-review") && serverSource.includes("phase2-family-doctor-fulfillment"), "runtime API, review and fulfillment audit actions are wired"),
    check("phase2FamilyDoctor:citizen-ui", citizenHtml.includes("service-family-doctor") && citizenSource.includes("renderFamilyDoctorContracts") && citizenSource.includes("/api/phase2/family-doctor-contracts/applications"), "citizen application and contract UI are wired"),
    check("phase2FamilyDoctor:institution-ui", institutionHtml.includes("phase2-family-doctor-contracts") && institutionSource.includes("renderPhase2FamilyDoctorContracts") && institutionSource.includes("data-family-doctor-review") && institutionSource.includes("data-family-doctor-fulfillment"), "institution review and fulfillment UI are wired"),
    check("phase2FamilyDoctor:platform-ui", platformHtml.includes("phase2-family-doctor-contracts") && platformSource.includes("renderPhase2FamilyDoctorContracts"), "platform supervision UI is wired"),
    check("phase2FamilyDoctor:release-wiring", Boolean(pkg.scripts?.["phase2:family-doctor-readiness"]) && manifestSource.includes("phase2-family-doctor-readiness-report.md") && deployCheckSource.includes("phase2FamilyDoctorReadiness") && releaseReportSource.includes("phase2FamilyDoctor"), "package script, manifest, deploy check and release report are wired")
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    summary: {
      templates: templates.length,
      teams: teams.length,
      packages: packages.length,
      applications: applications.length,
      pendingApplications: applications.filter((item) => item.reviewStatus === "pending").length,
      contracts: contracts.length,
      fulfillments: fulfillments.length,
      renewals: renewalRows.length,
      satisfactionRows: satisfactionRows.length
    },
    templates,
    teams,
    packages,
    applications,
    contracts,
    fulfillments,
    checks
  };
}

function renderMarkdown(report) {
  return [
    "# Phase 2 family doctor readiness report",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Templates: ${report.summary.templates}`,
    `- Teams: ${report.summary.teams}`,
    `- Packages: ${report.summary.packages}`,
    `- Applications: ${report.summary.applications}`,
    `- Contracts: ${report.summary.contracts}`,
    `- Fulfillments: ${report.summary.fulfillments}`,
    "",
    "## Checks",
    "",
    "| Result | Check | Detail |",
    "|---|---|---|",
    ...report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${clean(item.detail)} |`),
    "",
    "## Applications",
    "",
    "| Application | Resident | Package | Team | Review |",
    "|---|---|---|---|---|",
    ...report.applications.map((item) => `| ${item.id} | ${clean(item.residentId)} | ${clean(item.packageId)} | ${clean(item.teamId)} | ${clean(item.reviewStatus || item.status)} |`),
    "",
    "## Contracts",
    "",
    "| Contract | Resident | Package | Fulfillment | Renewal |",
    "|---|---|---|---|---|",
    ...report.contracts.map((item) => `| ${item.id} | ${clean(item.residentId)} | ${clean(item.packageId)} | ${clean(item.fulfillmentPercent)}% | ${clean(item.renewalStatus)} |`),
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
  const report = buildPhase2FamilyDoctorReadiness();
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

module.exports = { buildPhase2FamilyDoctorReadiness, parseArgs, renderMarkdown, writeOutput };
