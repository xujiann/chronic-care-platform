#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "chronic-followup-readiness-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "chronic-followup-readiness-report.md");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function parseArgs(argv = process.argv.slice(2)) {
  return argv.reduce((flags, arg) => {
    if (!arg.startsWith("--")) return flags;
    const [key, ...value] = arg.slice(2).split("=");
    flags[key] = value.length ? value.join("=") : true;
    return flags;
  }, {});
}

function hasRows(data, key) {
  return Array.isArray(data[key]) && data[key].length > 0;
}

function recordsByResident(data, key) {
  return new Map((data[key] || []).map((item) => [item.residentId, true]));
}

function count(items, predicate) {
  return (Array.isArray(items) ? items : []).filter(predicate).length;
}

function buildChronicFollowupReadinessReport(options = {}) {
  const data = options.data || readJson("data/db.json");
  const feedback = (data.personalRecords || []).filter((item) => item.category === "chronic-feedback" || item.meta?.followupFeedback);
  const followupMessages = (data.taskMessages || []).filter((item) => item.chronicFollowup);
  const screeningResidents = recordsByResident(data, "chronicScreeningTasks");
  const planResidents = recordsByResident(data, "chronicManagementPlans");
  const followupResidents = recordsByResident(data, "followups");
  const pickupResidents = recordsByResident(data, "medicationPickups");
  const feedbackResidents = new Map(feedback.map((item) => [item.residentId, true]));
  const policy = data.chronicFollowupStatusPolicy || {};
  const boundaries = [
    {
      id: "screening",
      name: "Screening and risk stratification",
      passed: hasRows(data, "chronicScreeningTasks") && (data.chronicScreeningTasks || []).every((item) => item.residentId && item.riskLevel && item.nextStep),
      evidence: "chronicScreeningTasks"
    },
    {
      id: "tiered-management",
      name: "Tiered chronic management plans",
      passed: hasRows(data, "chronicManagementPlans") && (data.chronicManagementPlans || []).every((item) => item.residentId && item.grade && item.nextReview),
      evidence: "chronicManagementPlans"
    },
    {
      id: "post-discharge-followup",
      name: "Post-discharge and outpatient follow-up",
      passed: hasRows(data, "followups") && (data.followups || []).some((item) => item.assignee && item.plannedAt && item.advice),
      evidence: "followups"
    },
    {
      id: "return-visit-reminder",
      name: "Return visit reminders",
      passed: count(data.followups, (item) => item.status !== "宸插畬鎴?" && item.plannedAt) >= 1,
      evidence: "followups.plannedAt/status"
    },
    {
      id: "medication-adherence",
      name: "Medication adherence and pickup loop",
      passed: hasRows(data, "medicationPickups") && (data.medicationPickups || []).every((item) => item.residentId && item.nextPickup && item.institutionReview && item.insuranceReview && item.pharmacyStatus),
      evidence: "medicationPickups"
    },
    {
      id: "family-doctor-collaboration",
      name: "Family doctor collaboration",
      passed: (data.residents || []).some((item) => item.familyDoctor) && (data.chronicManagementPlans || []).some((item) => item.owner),
      evidence: "residents.familyDoctor/chronicManagementPlans.owner"
    },
    {
      id: "resident-feedback",
      name: "Resident feedback loop",
      passed: feedback.length >= 1,
      evidence: "personalRecords[category=chronic-feedback]"
    },
    {
      id: "feedback-notification",
      name: "Feedback notification loop",
      passed: followupMessages.length >= 1 && followupMessages.every((item) => item.residentId && item.targetRole && item.status),
      evidence: "taskMessages[chronicFollowup=true]"
    },
    {
      id: "status-policy",
      name: "Status normalization policy",
      passed: Boolean(policy.version && policy.statusGroups?.open && policy.statusGroups?.closed && policy.requiredEvidence?.followup),
      evidence: "chronicFollowupStatusPolicy"
    }
  ];
  const residentCoverage = (data.residents || []).map((resident) => ({
    residentId: resident.id,
    name: resident.name,
    screening: screeningResidents.has(resident.id),
    plan: planResidents.has(resident.id),
    followup: followupResidents.has(resident.id),
    medication: pickupResidents.has(resident.id),
    feedback: feedbackResidents.has(resident.id)
  }));
  return {
    ok: boundaries.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    summary: {
      boundaries: boundaries.length,
      passed: boundaries.filter((item) => item.passed).length,
      residents: residentCoverage.length,
      feedbackRecords: feedback.length,
      notificationMessages: followupMessages.length,
      highRiskScreenings: count(data.chronicScreeningTasks, (item) => /楂樺嵄|high/i.test(String(item.riskLevel || ""))),
      openFollowups: count(data.followups, (item) => item.status !== "宸插畬鎴?")
    },
    boundaries,
    residentCoverage,
    reusePoints: [
      "chronicScreeningTasks",
      "chronicManagementPlans",
      "followups",
      "personalRecords",
      "medicationPickups",
      "citizen.html",
      "institution.html"
    ],
    apiSurface: [
      "GET /api/chronic/followup-summary",
      "POST /api/chronic/followup-feedback",
      "POST /api/chronic/followup-dispatch"
    ]
  };
}

function renderMarkdown(report) {
  const rows = report.boundaries.map((item) => `| ${item.id} | ${item.passed ? "PASS" : "FAIL"} | ${item.evidence} |`).join("\n");
  const residentRows = report.residentCoverage.map((item) => `| ${item.residentId} | ${item.screening ? "Y" : "N"} | ${item.plan ? "Y" : "N"} | ${item.followup ? "Y" : "N"} | ${item.medication ? "Y" : "N"} | ${item.feedback ? "Y" : "N"} |`).join("\n");
  return [
    "# Chronic follow-up readiness report",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `Overall: ${report.ok ? "PASS" : "FAIL"}`,
    "",
    "## Boundaries",
    "",
    "| Boundary | Status | Evidence |",
    "| --- | --- | --- |",
    rows,
    "",
    "## Resident coverage",
    "",
    "| Resident | Screening | Plan | Follow-up | Medication | Feedback |",
    "| --- | --- | --- | --- | --- | --- |",
    residentRows,
    "",
    "## API surface",
    "",
    report.apiSurface.map((item) => `- ${item}`).join("\n")
  ].join("\n");
}

function writeOutput(report, flags = {}) {
  const output = path.resolve(ROOT, String(flags.output || DEFAULT_OUTPUT));
  const markdown = path.resolve(ROOT, String(flags.markdown || DEFAULT_MARKDOWN));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2), "utf8");
  fs.mkdirSync(path.dirname(markdown), { recursive: true });
  fs.writeFileSync(markdown, renderMarkdown(report), "utf8");
  return { output, markdown };
}

function main() {
  const flags = parseArgs();
  const report = buildChronicFollowupReadinessReport();
  if (flags.write !== false) writeOutput(report, flags);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}

if (require.main === module) main();

module.exports = {
  buildChronicFollowupReadinessReport,
  parseArgs,
  renderMarkdown,
  writeOutput
};
