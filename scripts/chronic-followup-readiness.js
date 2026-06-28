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

function demoBaseDate() {
  const configured = String(process.env.DEMO_TODAY || "2026-06-22").trim();
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(configured) ? configured : "2026-06-22";
  return new Date(`${normalized}T00:00:00.000Z`);
}

function daysUntil(dateText, baseDate = demoBaseDate()) {
  if (!dateText) return 999;
  const value = new Date(`${String(dateText).slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(value.getTime())) return 999;
  const base = new Date(baseDate);
  base.setUTCHours(0, 0, 0, 0);
  return Math.round((value.getTime() - base.getTime()) / 86400000);
}

function statusClosed(policy, status) {
  return (policy.statusGroups?.closed || []).some((item) => String(status || "").includes(item) || String(item || "").includes(String(status || ""))) || /已完成|已取药|已评估|已复核|completed|picked|handled|closed|read/i.test(String(status || ""));
}

function buildAlertQueue(data, followupMessages, policy) {
  const residents = new Map((data.residents || []).map((item) => [item.id, item]));
  const normalize = (item) => {
    const days = daysUntil(item.dueAt);
    const riskText = `${item.status || ""} ${item.risk || ""}`;
    const priority = String(riskText).includes("逾期") || days < 0 ? "critical" : /高危|预警|high|alert/i.test(riskText) || days <= 3 ? "high" : days <= 7 ? "medium" : "low";
    return {
      id: `${item.collection}:${item.sourceId}`,
      ...item,
      residentName: residents.get(item.residentId)?.name || "",
      daysUntil: days,
      dueBucket: String(riskText).includes("逾期") || days < 0 ? "overdue" : days === 0 ? "due-today" : days <= 7 ? "due-soon" : "scheduled",
      priority
    };
  };
  return [
    ...(data.followups || []).filter((item) => !statusClosed(policy, item.status)).map((item) => normalize({ type: "followup", collection: "followups", sourceId: item.id, residentId: item.residentId, dueAt: item.plannedAt, status: item.status, risk: item.riskLevel || item.diseaseType })),
    ...(data.medicationPickups || []).filter((item) => !statusClosed(policy, item.status || item.pharmacyStatus)).map((item) => normalize({ type: "medication", collection: "medicationPickups", sourceId: item.id, residentId: item.residentId, dueAt: item.nextPickup, status: item.status || item.pharmacyStatus, risk: item.medication })),
    ...(data.chronicManagementPlans || []).filter((item) => !statusClosed(policy, item.status)).map((item) => normalize({ type: "management-plan", collection: "chronicManagementPlans", sourceId: item.id, residentId: item.residentId, dueAt: item.nextReview, status: item.status, risk: item.grade })),
    ...(data.chronicScreeningTasks || []).filter((item) => !statusClosed(policy, item.status)).map((item) => normalize({ type: "screening", collection: "chronicScreeningTasks", sourceId: item.id, residentId: item.residentId, dueAt: item.due, status: item.status, risk: item.riskLevel })),
    ...followupMessages.filter((item) => item.targetRole === "institution" && !["read", "handled"].includes(String(item.status || "").toLowerCase())).map((item) => normalize({ type: "resident-feedback", collection: item.collection || "taskMessages", sourceId: item.sourceId || item.id, residentId: item.residentId, dueAt: String(item.createdAt || "").slice(0, 10), status: item.status || "sent", risk: "feedback" }))
  ].sort((a, b) => ({ critical: 0, high: 1, medium: 2, low: 3 }[a.priority] ?? 9) - ({ critical: 0, high: 1, medium: 2, low: 3 }[b.priority] ?? 9) || a.daysUntil - b.daysUntil);
}

function buildPolicyAlignment(data, feedback, followupMessages) {
  return [
    {
      id: "policy-screening",
      evidence: "chronicScreeningTasks",
      count: count(data.chronicScreeningTasks, (item) => item.residentId && item.riskLevel && item.nextStep)
    },
    {
      id: "policy-tiered-management",
      evidence: "chronicManagementPlans",
      count: count(data.chronicManagementPlans, (item) => item.residentId && item.grade && item.nextReview)
    },
    {
      id: "policy-followup-guidance",
      evidence: "followups",
      count: count(data.followups, (item) => item.residentId && item.plannedAt && item.assignee)
    },
    {
      id: "policy-medication-support",
      evidence: "medicationPickups",
      count: count(data.medicationPickups, (item) => item.residentId && item.nextPickup && item.pharmacyStatus)
    },
    {
      id: "policy-family-doctor",
      evidence: "residents.familyDoctor/chronicManagementPlans.owner",
      count: count(data.residents, (item) => item.familyDoctor) + count(data.chronicManagementPlans, (item) => item.owner)
    },
    {
      id: "policy-resident-feedback",
      evidence: "personalRecords[category=chronic-feedback]",
      count: feedback.length
    },
    {
      id: "policy-feedback-dispatch",
      evidence: "taskMessages[chronicFollowup=true]",
      count: followupMessages.filter((item) => item.residentId && item.targetRole).length
    }
  ].map((item) => ({
    ...item,
    covered: item.count > 0
  }));
}

function buildChronicFollowupReadinessReport(options = {}) {
  const data = options.data || readJson("data/db.json");
  const feedback = (data.personalRecords || []).filter((item) => item.category === "chronic-feedback" || item.meta?.followupFeedback);
  const experienceRecords = (data.personalRecords || []).filter((item) => item.category === "chronic-self-checkin" || item.meta?.residentExperience);
  const followupMessages = (data.taskMessages || []).filter((item) => item.chronicFollowup);
  const policyAlignment = buildPolicyAlignment(data, feedback, followupMessages);
  const screeningResidents = recordsByResident(data, "chronicScreeningTasks");
  const planResidents = recordsByResident(data, "chronicManagementPlans");
  const followupResidents = recordsByResident(data, "followups");
  const pickupResidents = recordsByResident(data, "medicationPickups");
  const feedbackResidents = new Map(feedback.map((item) => [item.residentId, true]));
  const policy = data.chronicFollowupStatusPolicy || {};
  const alertQueue = buildAlertQueue(data, followupMessages, policy);
  const residentExperience = {
    selfMonitoring: count(data.chronicSelfManagement, (item) => item.residentId && item.latestValue && item.uploadSource),
    medicationSupport: count(data.medicationPickups, (item) => item.residentId && (item.medicationTaken !== undefined || item.applyMode || item.deliveryMode || item.adherenceStatus)),
    satisfaction: feedback.filter((item) => item.meta?.satisfaction || item.meta?.nextRequest).length + experienceRecords.filter((item) => item.meta?.satisfaction).length,
    familyProxy: count(data.seniorServices, (item) => item.residentId && /家属|proxy|代办/i.test(`${item.service || ""}${item.contact || ""}${item.nextAction || ""}`)) + count(data.medicationPickups, (item) => /家属|proxy|代办/i.test(`${item.applyMode || ""}${item.deliveryMode || ""}`)),
    seniorReminder: count(data.seniorServices, (item) => item.residentId && item.nextAction)
  };
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
      passed: count(data.followups, (item) => !statusClosed(policy, item.status) && item.plannedAt) >= 1,
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
      id: "risk-reminder-queue",
      name: "Risk and reminder queue",
      passed: alertQueue.length >= 1 && alertQueue.some((item) => ["critical", "high"].includes(item.priority)) && alertQueue.some((item) => item.dueBucket === "overdue"),
      evidence: "alertQueue[followups/medicationPickups/chronicManagementPlans/chronicScreeningTasks]"
    },
    {
      id: "resident-experience",
      name: "Resident self-management experience",
      passed: residentExperience.selfMonitoring >= 1 && residentExperience.medicationSupport >= 1 && residentExperience.satisfaction >= 1 && residentExperience.familyProxy >= 1 && residentExperience.seniorReminder >= 1,
      evidence: "chronicSelfManagement/personalRecords/seniorServices/medicationPickups"
    },
    {
      id: "policy-alignment",
      name: "Policy-aligned chronic follow-up evidence",
      passed: policyAlignment.length >= 7 && policyAlignment.every((item) => item.covered),
      evidence: "policyAlignment[chronic-followup]"
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
      alerts: alertQueue.length,
      overdueAlerts: alertQueue.filter((item) => item.dueBucket === "overdue").length,
      highPriorityAlerts: alertQueue.filter((item) => ["critical", "high"].includes(item.priority)).length,
      residentExperienceItems: Object.values(residentExperience).reduce((sum, value) => sum + value, 0),
      selfMonitoringRecords: residentExperience.selfMonitoring,
      satisfactionRecords: residentExperience.satisfaction,
      familyProxyRecords: residentExperience.familyProxy,
      policyAligned: policyAlignment.filter((item) => item.covered).length,
      policyItems: policyAlignment.length,
      highRiskScreenings: count(data.chronicScreeningTasks, (item) => /\u9ad8\u5371|high/i.test(String(item.riskLevel || ""))),
      openFollowups: count(data.followups, (item) => !statusClosed(policy, item.status))
    },
    boundaries,
    policyAlignment,
    alertQueue,
    residentExperience,
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
      "POST /api/chronic/resident-checkins",
      "POST /api/chronic/followup-dispatch"
    ]
  };
}

function renderMarkdown(report) {
  const rows = report.boundaries.map((item) => `| ${item.id} | ${item.passed ? "PASS" : "FAIL"} | ${item.evidence} |`).join("\n");
  const policyRows = (report.policyAlignment || []).map((item) => `| ${item.id} | ${item.covered ? "Y" : "N"} | ${item.count} | ${item.evidence} |`).join("\n");
  const alertRows = (report.alertQueue || []).slice(0, 12).map((item) => `| ${item.id} | ${item.residentId} | ${item.priority} | ${item.dueBucket} | ${item.dueAt || ""} |`).join("\n");
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
    "## Policy alignment",
    "",
    "| Policy item | Covered | Count | Evidence |",
    "| --- | --- | --- | --- |",
    policyRows,
    "",
    "## Alert queue",
    "",
    "| Alert | Resident | Priority | Due bucket | Due at |",
    "| --- | --- | --- | --- | --- |",
    alertRows,
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
