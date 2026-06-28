#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "multi-practice-readiness-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "multi-practice-readiness-report.md");

const REQUIRED_DOCUMENT_CHECKS = [
  "firstPracticeConsent",
  "cooperationAgreement",
  "liabilityInsurance",
  "scheduleConflict",
  "publicDisclosure"
];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function hasAll(source, needles) {
  return needles.every((needle) => source.includes(needle));
}

function buildMultiPracticeReadinessReport(options = {}) {
  const data = options.data ?? readJson("data/db.json");
  const pkg = options.pkg ?? readJson("package.json");
  const server = options.server ?? readText("server.js");
  const institution = options.institution ?? `${readText("institution.html")}\n${readText("institution.js")}`;
  const commission = options.commission ?? `${readText("index.html")}\n${readText("app.js")}`;
  const policyDoc = options.policyDoc ?? readText("docs/医师多点执业政策说明.md");
  const functionReport = options.functionReport ?? readText("docs/医师多点执业主要功能报告.md");
  const doctors = Array.isArray(data.doctorProfiles) ? data.doctorProfiles : [];
  const applications = Array.isArray(data.multiPracticeApplications) ? data.multiPracticeApplications : [];
  const policy = data.multiPracticePolicy && typeof data.multiPracticePolicy === "object" ? data.multiPracticePolicy : {};
  const checks = [
    { id: "multiPractice:doctorAccounts", passed: doctors.length >= 2 && doctors.every((item) => item.id && item.licenseNo && item.primaryInstitution && item.practiceScope), detail: `${doctors.length} doctor profiles` },
    { id: "multiPractice:electronicRegistration", passed: doctors.every((item) => item.electronicRegistration?.registryId && item.electronicRegistration?.verificationStatus === "已核验" && item.electronicRegistration?.signatureNo), detail: "doctor profiles carry verified electronic registration source records" },
    { id: "multiPractice:applications", passed: applications.length >= 2 && applications.every((item) => item.doctorId && item.targetInstitution && item.status && item.lifecycle), detail: `${applications.length} applications` },
    { id: "multiPractice:documentChecks", passed: applications.every((item) => REQUIRED_DOCUMENT_CHECKS.every((field) => Object.hasOwn(item.documentChecks || {}, field))), detail: REQUIRED_DOCUMENT_CHECKS.join(", ") },
    { id: "multiPractice:firstPracticeConfirmation", passed: applications.every((item) => item.primaryPracticeConfirmation?.status && item.primaryPracticeConfirmation?.signatureNo && item.documentChecks?.firstPracticeConsent === true), detail: "first-practice electronic confirmations are signed and reflected in document checks" },
    { id: "multiPractice:riskFlags", passed: hasAll(server, ["withMultiPracticeReviewState", "multiPracticeRiskFlags", "schedule-conflict"]) && applications.every((item) => Array.isArray(item.riskFlags)), detail: "risk flags normalized across API responses" },
    { id: "multiPractice:doctorApi", passed: hasAll(server, ["/api/doctors/me", "multiPracticeSummary", "verifyDoctorElectronicRegistration", "withMultiPracticeReviewState"]), detail: "doctor account API returns own summary, registration verification, and reviewed applications" },
    { id: "multiPractice:registryApi", passed: hasAll(server, ["/api/multi-practice-registry", "publicLedger", "reviewQueue", "canAccessMultiPracticeApplication"]), detail: "registry API covers public ledger, review queue, and role guard" },
    { id: "multiPractice:institutionUi", passed: hasAll(institution, ["multi-practice-form", "renderDoctorAccounts", "电子化注册", "第一执业地点电子确认", "责任保险", "补正提示", "riskFlags"]), detail: "doctor/institution view exposes application, registration, confirmation, and material-check workflow" },
    { id: "multiPractice:commissionUi", passed: hasAll(commission, ["renderMultiPracticeGovernance", "multi-practice-governance-summary", "风险补正"]), detail: "commission view exposes supervision summary and risk queue" },
    { id: "multiPractice:policy", passed: hasAll(policyDoc, ["国卫医发〔2014〕86号", "documentChecks.liabilityInsurance", "flowchart LR"]) && hasAll(functionReport, ["multiPracticeSummary", "riskFlags", "flowchart TD"]), detail: "policy and main function reports are linked" },
    { id: "multiPractice:releaseScript", passed: Boolean(pkg.scripts?.["multi-practice:readiness"]), detail: pkg.scripts?.["multi-practice:readiness"] || "missing" }
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    policySource: policy.source || "",
    summary: {
      doctors: doctors.length,
      verifiedRegistrations: doctors.filter((item) => item.electronicRegistration?.verificationStatus === "已核验").length,
      applications: applications.length,
      signedConfirmations: applications.filter((item) => item.primaryPracticeConfirmation?.signatureNo).length,
      filed: applications.filter((item) => String(item.status || "").includes("备案")).length,
      publicVisible: applications.filter((item) => item.publicVisible !== false).length,
      reviewQueue: applications.filter((item) => String(item.status || "").includes("待") || (item.riskFlags || []).length > 0).length,
      riskApplications: applications.filter((item) => (item.riskFlags || []).length > 0).length
    },
    requiredDocumentChecks: REQUIRED_DOCUMENT_CHECKS,
    checks
  };
}

function renderMarkdown(report) {
  return [
    "# Doctor multi-practice readiness report",
    "",
    `Generated at: ${report.generatedAt}`,
    `Result: ${report.ok ? "PASS" : "FAIL"}`,
    `Policy source: ${report.policySource || "not configured"}`,
    "",
    "## Summary",
    "",
    `- Doctor profiles: ${report.summary.doctors}`,
    `- Verified registrations: ${report.summary.verifiedRegistrations}`,
    `- Applications: ${report.summary.applications}`,
    `- Signed first-practice confirmations: ${report.summary.signedConfirmations}`,
    `- Filed applications: ${report.summary.filed}`,
    `- Public ledger rows: ${report.summary.publicVisible}`,
    `- Review queue rows: ${report.summary.reviewQueue}`,
    `- Risk applications: ${report.summary.riskApplications}`,
    "",
    "## Required Document Checks",
    "",
    ...report.requiredDocumentChecks.map((item) => `- ${item}`),
    "",
    "## Checks",
    "",
    "| Status | Check | Detail |",
    "| --- | --- | --- |",
    ...report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${String(item.detail || "").replace(/\|/g, "/")} |`)
  ].join("\n");
}

function writeReport(report, output = DEFAULT_OUTPUT, markdown = DEFAULT_MARKDOWN) {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({ ok: report.ok, multiPracticeReadiness: report }, null, 2), "utf8");
  fs.writeFileSync(markdown, renderMarkdown(report), "utf8");
}

function main() {
  const report = buildMultiPracticeReadinessReport();
  writeReport(report);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}

if (require.main === module) main();

module.exports = {
  buildMultiPracticeReadinessReport,
  renderMarkdown,
  writeReport
};
