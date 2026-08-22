#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { buildChronicInformatizationSourceReport } = require("./chronic-informatization-sources");
const { inspectFollowupDispatchWorkerReadiness } = require("../src/citizen-chronic/followup-dispatch-worker");

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
    },
    {
      id: "policy-referral-continuity",
      evidence: "referralSystem/referralTeleconsultations/personalRecords[chronic-referral-continuity]",
      count: buildReferralContinuityEvidence(data).readyRows.length
    }
  ].map((item) => ({
    ...item,
    covered: item.count > 0
  }));
}

function buildReferralContinuityEvidence(data) {
  const referrals = data.referralSystem?.referrals || [];
  const consultations = data.referralTeleconsultations || [];
  const records = data.personalRecords || [];
  const plans = data.chronicManagementPlans || [];
  const followups = data.followups || [];
  const rows = referrals.map((referral) => {
    const continuity = records.find((item) => item.residentId === referral.residentId && item.category === "chronic-referral-continuity" && item.meta?.referralId === referral.id);
    const consultation = consultations.find((item) => item.referralId === referral.id);
    const archiveEvidence = records.some((item) => item.residentId === referral.residentId && ["emr", "labs", "physical-exam"].includes(item.category));
    const isDownReferral = /down|下转/.test(`${referral.type || ""}${consultation?.type || ""}`);
    const reportReturned = /returned|回传/.test(`${consultation?.status || ""}${consultation?.reportStatus || ""}`);
    const handoff = Boolean(continuity?.meta?.primaryCareAccepted || (isDownReferral && (/基层承接|承接/.test(String(referral.status || "")) || reportReturned)));
    const followupPlanned = Boolean(continuity?.meta?.nextFollowupAt || plans.some((item) => item.residentId === referral.residentId) || followups.some((item) => item.residentId === referral.residentId));
    const archiveUpdated = Boolean(continuity?.meta?.archiveUpdated);
    const familyRiskPrompted = Boolean(continuity?.meta?.familyRiskPrompted);
    return { referralId: referral.id, residentId: referral.residentId, isDownReferral, handoff, reportReturned, archiveEvidence, archiveUpdated, familyRiskPrompted, followupPlanned, ready: handoff && reportReturned && archiveEvidence && followupPlanned };
  });
  return {
    rows,
    readyRows: rows.filter((item) => item.ready),
    downReferralRows: rows.filter((item) => item.isDownReferral)
  };
}

function buildChronicFollowupReadinessReport(options = {}) {
  const data = options.data || readJson("data/db.json");
  const sourceTraceability = options.sourceTraceability || buildChronicInformatizationSourceReport({ data, pkg: options.pkg });
  const productionDispatch = options.productionDispatch || inspectFollowupDispatchWorkerReadiness(options.env || process.env, {
    activationVerifierConfigured: options.activationVerifierConfigured === true
  });
  const feedback = (data.personalRecords || []).filter((item) => item.category === "chronic-feedback" || item.meta?.followupFeedback);
  const experienceRecords = (data.personalRecords || []).filter((item) => item.category === "chronic-self-checkin" || item.meta?.residentExperience);
  const followupMessages = (data.taskMessages || []).filter((item) => item.chronicFollowup);
  const feedbackResidentIds = new Set(feedback.map((item) => item.residentId).filter(Boolean));
  const highRiskResidentIds = new Set([
    ...(data.chronicScreeningTasks || []).filter((item) => String(item.riskLevel || item.risk || "").includes("高危")).map((item) => item.residentId),
    ...(data.chronicManagementPlans || []).filter((item) => String(item.grade || item.riskLevel || item.risk || "").includes("高危")).map((item) => item.residentId)
  ].filter(Boolean));
  const feedbackHighRiskCovered = highRiskResidentIds.size > 0 && [...highRiskResidentIds].every((residentId) => feedbackResidentIds.has(residentId));
  const policyAlignment = buildPolicyAlignment(data, feedback, followupMessages);
  const referralContinuity = buildReferralContinuityEvidence(data);
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
  const fieldIntegration = {
    deviceMeasurements: experienceRecords.filter((item) => item.meta?.deviceExternalId || item.meta?.deviceId || /device gateway|remote device/i.test(`${item.source || ""}${item.meta?.measurementType || ""}`)).length + count(data.chronicSelfManagement, (item) => item.deviceExternalId || item.deviceId || /device gateway|remote/i.test(`${item.uploadSource || ""}${item.integrationStatus || ""}`)),
    pharmacyCallbacks: count(data.medicationPickups, (item) => item.callbackExternalId || item.pickupConfirmedAt || /callback|pharmacy callback/i.test(`${item.adherenceStatus || ""}${item.integrationStatus || ""}`)),
    familyDoctorClosures: count(data.personalRecords, (item) => item.category === "chronic-family-doctor-note" || item.meta?.familyDoctorClosure) + count(data.taskMessages, (item) => item.chronicFollowup && item.targetRole === "institution" && ["handled", "read"].includes(String(item.status || "").toLowerCase())),
    reminderOutreach: count(data.seniorServices, (item) => item.outreachEvidence || /outreach|sms|phone|call/i.test(`${item.service || ""}${item.channel || ""}${item.nextAction || ""}`)) + count(data.taskMessages, (item) => item.chronicFollowup && item.meta?.reminderOutreach)
  };
  const publicHealthLoopStages = [
    { id: "monitor", evidence: "chronicScreeningTasks/chronicManagementPlans", count: highRiskResidentIds.size },
    { id: "alert", evidence: "alertQueue[critical/high]", count: alertQueue.filter((item) => ["critical", "high"].includes(item.priority)).length },
    { id: "dispatch", evidence: "taskMessages[chronicFollowup targetRole=institution]", count: followupMessages.filter((item) => item.targetRole === "institution").length },
    { id: "intervention", evidence: "familyDoctorActions/followup-dispatch", count: fieldIntegration.familyDoctorClosures },
    { id: "followup", evidence: "followups/personalRecords[chronic-feedback]", count: count(data.followups, (item) => statusClosed(policy, item.status)) + feedback.length },
    { id: "summary", evidence: "policyAlignment[chronic-followup]", count: policyAlignment.filter((item) => item.covered).length }
  ].map((item) => ({
    ...item,
    passed: item.count > 0
  }));
  const infectiousSignals =
    count(data.deathCertificates, (item) => /传染|infectious|浼犳煋/i.test(`${item.deathReasonType || ""} ${item.underlyingCause || ""} ${item.causeCategory || ""}`)) +
    count(data.hospitalOperationSnapshots, (item) => Number(item.outpatient?.feverClinicVisits || 0) >= 40);
  const immunizationTargets =
    count(data.personalRecords, (item) => item.category === "vaccines") +
    highRiskResidentIds.size +
    count(data.birthCertificates, (item) => item.residentId || item.maternalResidentId);
  const cdcCommandRows = highRiskResidentIds.size + infectiousSignals;
  const publicHealthIntegrationLinks = [
    { id: "immunization-planning", evidence: "personalRecords[vaccines]/birthCertificates/chronicManagementPlans", count: immunizationTargets },
    { id: "infectious-disease-reporting", evidence: "deathCertificates/hospitalOperationSnapshots[feverClinicVisits]", count: infectiousSignals },
    { id: "cdc-command-summary", evidence: "publicHealthLoop.cdcSummary.commandRows", count: cdcCommandRows }
  ].map((item) => ({
    ...item,
    passed: item.count > 0
  }));
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
      passed: feedback.length >= 2 && feedbackHighRiskCovered,
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
      id: "field-integration-closure",
      name: "Field integration and outreach closure",
      passed: fieldIntegration.deviceMeasurements >= 1 && fieldIntegration.pharmacyCallbacks >= 1 && fieldIntegration.familyDoctorClosures >= 1 && fieldIntegration.reminderOutreach >= 1,
      evidence: "device measurements/pharmacy callbacks/family doctor actions/reminder outreach"
    },
    {
      id: "public-health-risk-loop",
      name: "CDC and public health risk loop",
      passed: publicHealthLoopStages.length === 6 && publicHealthLoopStages.every((item) => item.passed) && publicHealthIntegrationLinks.every((item) => item.passed),
      evidence: "monitor-alert-dispatch-intervention-followup-summary-immunization-infectious-cdc"
    },
    {
      id: "policy-alignment",
      name: "Policy-aligned chronic follow-up evidence",
      passed: policyAlignment.length >= 8 && policyAlignment.every((item) => item.covered),
      evidence: "policyAlignment[chronic-followup]"
    },
    {
      id: "referral-continuity",
      name: "Referral return and primary-care continuity",
      passed: referralContinuity.downReferralRows.length >= 1 && referralContinuity.readyRows.length >= 1,
      evidence: "referralSystem/referralTeleconsultations/personalRecords[chronic-referral-continuity]"
    },
    {
      id: "informatization-source-traceability",
      name: "Chronic informatization source traceability",
      passed: Boolean(sourceTraceability.ok) && sourceTraceability.summary?.readyCapabilityTracks === sourceTraceability.summary?.capabilityTracks,
      evidence: "chronic-informatization-sources"
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
      feedbackHighRiskCovered,
      notificationMessages: followupMessages.length,
      alerts: alertQueue.length,
      overdueAlerts: alertQueue.filter((item) => item.dueBucket === "overdue").length,
      highPriorityAlerts: alertQueue.filter((item) => ["critical", "high"].includes(item.priority)).length,
      residentExperienceItems: Object.values(residentExperience).reduce((sum, value) => sum + value, 0),
      selfMonitoringRecords: residentExperience.selfMonitoring,
      satisfactionRecords: residentExperience.satisfaction,
      familyProxyRecords: residentExperience.familyProxy,
      fieldIntegrationItems: Object.values(fieldIntegration).reduce((sum, value) => sum + value, 0),
      deviceMeasurementRecords: fieldIntegration.deviceMeasurements,
      pharmacyCallbackRecords: fieldIntegration.pharmacyCallbacks,
      familyDoctorClosureRecords: fieldIntegration.familyDoctorClosures,
      reminderOutreachRecords: fieldIntegration.reminderOutreach,
      publicHealthLoopStages: publicHealthLoopStages.length,
      publicHealthLoopReadyStages: publicHealthLoopStages.filter((item) => item.passed).length,
      publicHealthIntegrationLinks: publicHealthIntegrationLinks.length,
      publicHealthReadyIntegrationLinks: publicHealthIntegrationLinks.filter((item) => item.passed).length,
      informatizationSources: sourceTraceability.summary?.sources || 0,
      informatizationCategoriesCovered: sourceTraceability.summary?.categoriesCovered || 0,
      informatizationReadyCapabilityTracks: sourceTraceability.summary?.readyCapabilityTracks || 0,
      informatizationCapabilityTracks: sourceTraceability.summary?.capabilityTracks || 0,
      immunizationTargets,
      infectiousSignals,
      cdcCommandRows,
      referralContinuityRows: referralContinuity.rows.length,
      referralContinuityReadyRows: referralContinuity.readyRows.length,
      referralFamilyRiskPrompts: referralContinuity.rows.filter((item) => item.familyRiskPrompted).length,
      policyAligned: policyAlignment.filter((item) => item.covered).length,
      policyItems: policyAlignment.length,
      highRiskScreenings: count(data.chronicScreeningTasks, (item) => /\u9ad8\u5371|high/i.test(String(item.riskLevel || ""))),
      openFollowups: count(data.followups, (item) => !statusClosed(policy, item.status))
    },
    boundaries,
    policyAlignment,
    alertQueue,
    residentExperience,
    fieldIntegration,
    referralContinuity,
    publicHealthLoopStages,
    publicHealthIntegrationLinks,
    sourceTraceability,
    productionDispatch,
    productionReady: false,
    productionBoundary: "Durable local queue code is present; real endpoint, credential injection, trusted receipt, worker service activation and site acceptance remain NO-GO.",
    residentCoverage,
    reusePoints: [
      "chronicScreeningTasks",
      "chronicManagementPlans",
      "followups",
      "personalRecords",
      "medicationPickups",
      "birthCertificates",
      "deathCertificates",
      "hospitalOperationSnapshots",
      "referralSystem",
      "referralTeleconsultations",
      "docs/chronic-informatization-source-inventory.md",
      "citizen.html",
      "institution.html"
    ],
    apiSurface: [
      "GET /api/chronic/followup-summary",
      "GET /api/chronic/archive-standard",
      "GET /api/chronic/pathway-quality",
      "GET /api/chronic/pharmacy-insurance-closure",
      "GET /api/chronic/production-safety",
      "GET /api/chronic/production-safety-evidence",
      "GET /api/chronic/interoperability-profiles",
      "POST /api/chronic/interoperability-validation",
      "GET /api/chronic/referral-continuity",
      "GET /api/chronic/public-health-loop",
      "POST /api/chronic/followup-feedback",
      "POST /api/chronic/resident-checkins",
      "POST /api/chronic/device-measurements",
      "POST /api/chronic/pharmacy-callbacks",
      "POST /api/chronic/family-doctor-actions",
      "POST /api/chronic/reminder-outreach",
      "POST /api/chronic/referral-continuity",
      "POST /api/chronic/followup-escalations",
      "POST /api/chronic/followup-dispatch"
    ]
  };
}

function renderMarkdown(report) {
  const rows = report.boundaries.map((item) => `| ${item.id} | ${item.passed ? "PASS" : "FAIL"} | ${item.evidence} |`).join("\n");
  const policyRows = (report.policyAlignment || []).map((item) => `| ${item.id} | ${item.covered ? "Y" : "N"} | ${item.count} | ${item.evidence} |`).join("\n");
  const alertRows = (report.alertQueue || []).slice(0, 12).map((item) => `| ${item.id} | ${item.residentId} | ${item.priority} | ${item.dueBucket} | ${item.dueAt || ""} |`).join("\n");
  const publicHealthRows = (report.publicHealthLoopStages || []).map((item) => `| ${item.id} | ${item.passed ? "PASS" : "FAIL"} | ${item.count} | ${item.evidence} |`).join("\n");
  const publicHealthIntegrationRows = (report.publicHealthIntegrationLinks || []).map((item) => `| ${item.id} | ${item.passed ? "PASS" : "FAIL"} | ${item.count} | ${item.evidence} |`).join("\n");
  const sourceRows = (report.sourceTraceability?.capabilityTracks || []).map((item) => `| ${item.ready ? "PASS" : "FAIL"} | ${item.id} | ${item.name} | ${item.dataCovered.length}/${item.dataCollections.length} | ${item.apiCovered.length}/${item.apiMarkers.length} | ${item.docsCovered.length}/${item.docMarkers.length} |`).join("\n");
  const referralRows = (report.referralContinuity?.rows || []).map((item) => `| ${item.referralId} | ${item.handoff ? "Y" : "N"} | ${item.reportReturned ? "Y" : "N"} | ${item.archiveUpdated ? "Y" : "N"} | ${item.familyRiskPrompted ? "Y" : "N"} | ${item.followupPlanned ? "Y" : "N"} | ${item.ready ? "PASS" : "FAIL"} |`).join("\n");
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
    "## Public health loop",
    "",
    "| Stage | Status | Count | Evidence |",
    "| --- | --- | --- | --- |",
    publicHealthRows,
    "",
    "## Public health integrations",
    "",
    "| Link | Status | Count | Evidence |",
    "| --- | --- | --- | --- |",
    publicHealthIntegrationRows,
    "",
    "## Informatization source traceability",
    "",
    "| Status | Track | Name | Data | API | Docs |",
    "| --- | --- | --- | --- | --- | --- |",
    sourceRows,
    "",
    "## Referral continuity",
    "",
    "| Referral | Primary care handoff | Report returned | Archive updated | Family risk prompt | Follow-up planned | Status |",
    "| --- | --- | --- | --- | --- | --- |",
    referralRows,
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
