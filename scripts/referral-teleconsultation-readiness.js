#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "referral-teleconsultation-readiness-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "referral-teleconsultation-readiness-report.md");

const REQUIRED_STATUSES = ["requested", "accepted", "scheduled", "feedback-returned", "report-returned", "closed"];
const REQUIRED_BOUNDARIES = [
  "referral",
  "teleconsultation",
  "receiving feedback",
  "report return",
  "collaboration order",
  "performance",
  "SLA disposition",
  "joint test pack",
  "joint test ledger",
  "joint test task dispatch",
  "joint test task completion",
  "insurance payment policy",
  "onsite signoff summary",
  "onsite signoff archive",
  "consortium closed loop",
  "consortium metrics",
  "consortium metrics API"
];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function averagePerformance(rows, field) {
  const values = rows.map((item) => Number(item.performance?.[field])).filter(Number.isFinite);
  if (!values.length) return null;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1));
}

function percent(count, total) {
  return total ? Math.round((count / total) * 100) : 100;
}

function hasReferralGrassrootsFollowupReturn(item) {
  const text = [
    item.type,
    item.targetInstitution,
    item.sourceInstitution,
    item.reportSummary,
    item.receivingFeedback,
    item.performance?.insurancePaymentPath,
    item.slaDisposition?.action,
    item.countySupervision?.reason
  ].join(" ").toLowerCase();
  return text.includes("down-referral") || text.includes("primary") || text.includes("community") || text.includes("follow-up") || text.includes("followup") || text.includes("grassroots");
}

function hasReferralQualityFeedbackClosure(item) {
  const text = [
    item.slaDisposition?.status,
    item.slaDisposition?.action,
    item.countySupervision?.status,
    item.countySupervision?.reason,
    item.performance?.satisfaction
  ].join(" ").toLowerCase();
  return text.includes("closed") || text.includes("acknowledged") || text.includes("quality") || text.includes("satisfaction");
}

function parseReferralDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function buildReferralTeleconsultationEscalations(rows, options = {}) {
  const now = parseReferralDate(options.asOf) || new Date();
  return (Array.isArray(rows) ? rows : [])
    .filter((item) => item.status !== "closed" && item.reportStatus !== "returned")
    .map((item) => {
      const dueDate = parseReferralDate(item.due);
      const requestedAt = parseReferralDate(item.requestedAt || item.createdAt);
      const daysOverdue = dueDate ? Math.floor((now.getTime() - dueDate.getTime()) / 86400000) : 0;
      const ageDays = requestedAt ? Math.floor((now.getTime() - requestedAt.getTime()) / 86400000) : 0;
      const responseHours = Number(item.performance?.responseHours);
      const reportReturnHours = Number(item.performance?.reportReturnHours);
      const reasons = [];
      if (daysOverdue > 0) reasons.push(`due overdue ${daysOverdue}d`);
      if (item.priority === "high") reasons.push("high priority pending report");
      if (Number.isFinite(responseHours) && responseHours > 4) reasons.push(`response ${responseHours}h`);
      if (Number.isFinite(reportReturnHours) && reportReturnHours > 24) reasons.push(`report return ${reportReturnHours}h`);
      if (!item.meetingWindow) reasons.push("meeting window missing");
      if (!reasons.length && ageDays >= 2) reasons.push(`open ${ageDays}d`);
      if (!reasons.length) return null;
      return {
        teleconsultationId: item.id,
        severity: item.priority === "high" || daysOverdue > 0 ? "high" : "medium",
        daysOverdue: Math.max(0, daysOverdue),
        reasons
      };
    })
    .filter(Boolean);
}

function buildReferralTeleconsultationSignoffSummary(data) {
  const teleconsultations = Array.isArray(data.referralTeleconsultations) ? data.referralTeleconsultations : [];
  const signoffRecords = Array.isArray(data.referralTeleconsultationSignoffs) ? data.referralTeleconsultationSignoffs : [];
  const signoffByRole = new Map(signoffRecords
    .filter((item) => item.status === "signed")
    .map((item) => [item.role, item]));
  const taskMessages = (Array.isArray(data.taskMessages) ? data.taskMessages : [])
    .filter((item) => item.collection === "referralTeleconsultations");
  const contractIds = new Set((Array.isArray(data.integrationContracts) ? data.integrationContracts : []).map((item) => item.id));
  const archivedReportIds = new Set((Array.isArray(data.personalRecords) ? data.personalRecords : [])
    .filter((item) => item.category === "teleconsultation-report" && item.teleconsultationId)
    .map((item) => item.teleconsultationId));
  const reportReturned = teleconsultations.filter((item) => item.reportStatus === "returned" || item.status === "report-returned");
  const hasSlaDispositionEvidence = teleconsultations.some((item) => {
    const status = String(item.slaDisposition?.status || item.countySupervision?.status || "").toLowerCase();
    return status && status !== "pending-ack" && (status.includes("acknowledged") || status.includes("closed") || status.includes("已确认") || status.includes("已闭环"));
  });
  const rows = [
    {
      role: "referral-center",
      localEvidence: contractIds.has("referral-feedback-callback-v1") && taskMessages.some((item) => item.notificationKey?.includes(":feedback:")) && teleconsultations.some((item) => item.receivingFeedback)
    },
    {
      role: "receiving-hospital",
      localEvidence: contractIds.has("referral-schedule-callback-v1") && teleconsultations.some((item) => item.meetingWindow && item.receivingDoctor)
    },
    {
      role: "hospital-it",
      localEvidence: contractIds.has("referral-report-callback-v1") && reportReturned.length > 0 && reportReturned.every((item) => archivedReportIds.has(item.id))
    },
    {
      role: "county-performance",
      localEvidence: teleconsultations.every((item) => item.countySupervision?.status && item.slaDisposition?.status) && (taskMessages.some((item) => item.escalationKey) || hasSlaDispositionEvidence)
    },
    {
      role: "insurance",
      localEvidence: teleconsultations.every((item) => item.performance?.insurancePaymentPath && item.performance?.repeatExamControl)
    }
  ].map((row) => {
    const onsiteEvidence = signoffByRole.get(row.role) || null;
    return {
      ...row,
      onsiteEvidence,
      siteStatus: onsiteEvidence ? "signed" : "pending-site-signoff"
    };
  });
  const siteSigned = rows.filter((item) => item.onsiteEvidence).length;
  return {
    roles: rows,
    summary: {
      roles: rows.length,
      demoReady: rows.filter((item) => item.localEvidence).length,
      needsEvidence: rows.filter((item) => !item.localEvidence).length,
      siteSigned,
      sitePending: rows.length - siteSigned,
      allDemoReady: rows.every((item) => item.localEvidence),
      allSiteSigned: siteSigned === rows.length
    }
  };
}

function buildReferralTeleconsultationJointTestLedger(data) {
  const teleconsultations = Array.isArray(data.referralTeleconsultations) ? data.referralTeleconsultations : [];
  const events = (Array.isArray(data.integrationGatewayEvents) ? data.integrationGatewayEvents : [])
    .filter((item) => ["referral-feedback-callback-v1", "referral-schedule-callback-v1", "referral-report-callback-v1"].includes(item.contractId));
  const signoffSummary = buildReferralTeleconsultationSignoffSummary(data);
  const callbackRows = [
    { role: "referral-center", contractId: "referral-feedback-callback-v1", localEvidence: teleconsultations.some((item) => item.receivingFeedback) },
    { role: "receiving-hospital", contractId: "referral-schedule-callback-v1", localEvidence: teleconsultations.some((item) => item.meetingWindow && item.receivingDoctor) },
    { role: "hospital-it", contractId: "referral-report-callback-v1", localEvidence: teleconsultations.some((item) => item.reportStatus === "returned" || item.status === "report-returned") }
  ].map((row) => {
    const matched = events.filter((event) => event.contractId === row.contractId && event.status === "matched");
    return { ...row, type: "callback", matched: matched.length };
  });
  const governanceRows = [
    { role: "county-performance", type: "governance", localEvidence: teleconsultations.every((item) => item.countySupervision?.status && item.slaDisposition?.status) },
    { role: "insurance", type: "policy", localEvidence: teleconsultations.every((item) => item.performance?.insurancePaymentPath && item.performance?.repeatExamControl) }
  ];
  const rows = [...callbackRows, ...governanceRows];
  return {
    rows,
    summary: {
      rows: rows.length,
      localReady: rows.filter((item) => item.localEvidence).length,
      callbackContracts: callbackRows.length,
      callbackMatchedContracts: callbackRows.filter((item) => item.matched > 0).length,
      gatewayEvents: events.length,
      siteSigned: signoffSummary.summary.siteSigned,
      sitePending: signoffSummary.summary.sitePending
    }
  };
}

function buildReferralConsortiumClosedLoopEvidence(data, countySource) {
  const teleconsultations = Array.isArray(data.referralTeleconsultations) ? data.referralTeleconsultations : [];
  const archivedReportIds = new Set((data.personalRecords || [])
    .filter((item) => item.category === "teleconsultation-report" && item.teleconsultationId)
    .map((item) => item.teleconsultationId));
  const mutualRecognitionEvidence = (data.countyMutualRecognitionRecords || []).filter((item) => item.status || item.reason || item.reportId);
  const returned = teleconsultations.filter((item) => item.reportStatus === "returned" || item.status === "report-returned");
  const grassrootsFollowupReturned = teleconsultations.filter(hasReferralGrassrootsFollowupReturn);
  const qualityFeedbackClosed = teleconsultations.filter(hasReferralQualityFeedbackClosure);
  const steps = [
    {
      id: "initiate",
      owner: "primary institution + lead hospital",
      roles: ["referral-center"],
      localEvidence: teleconsultations.length > 0 && teleconsultations.every((item) => item.referralId && item.residentAuthorizationId && item.collaborationOrderId),
      blockerType: "external"
    },
    {
      id: "accept",
      owner: "receiving hospital",
      roles: ["receiving-hospital"],
      localEvidence: teleconsultations.length > 0 && teleconsultations.every((item) => Object.hasOwn(item, "receivingFeedback")),
      blockerType: "external"
    },
    {
      id: "execute",
      owner: "lead hospital specialist team",
      roles: ["receiving-hospital", "hospital-it"],
      localEvidence: teleconsultations.some((item) => item.meetingWindow && item.receivingDoctor),
      blockerType: "external"
    },
    {
      id: "report-return",
      owner: "hospital IT + medical technology center",
      roles: ["hospital-it"],
      localEvidence: teleconsultations.some((item) => item.reportStatus === "returned" || item.status === "report-returned")
        && teleconsultations.filter((item) => item.reportStatus === "returned" || item.status === "report-returned").every((item) => archivedReportIds.has(item.id)),
      blockerType: "external",
      lightEvidence: mutualRecognitionEvidence.length
    },
    {
      id: "feedback-evaluation",
      owner: "county performance office",
      roles: ["county-performance"],
      localEvidence: teleconsultations.length > 0 && teleconsultations.every((item) => item.countySupervision?.status && item.slaDisposition?.status),
      blockerType: "onsite"
    },
    {
      id: "performance-archive",
      owner: "insurance + performance",
      roles: ["county-performance", "insurance"],
      localEvidence: teleconsultations.length > 0 && teleconsultations.every((item) => item.performance?.insurancePaymentPath && item.performance?.repeatExamControl),
      blockerType: "external"
    }
  ];
  const roleSet = new Set(steps.flatMap((item) => item.roles));
  const signedRoles = new Set((data.referralTeleconsultationSignoffs || [])
    .filter((item) => item.status === "signed")
    .map((item) => item.role));
  const roleTodoBacklog = [...roleSet].filter((role) => !signedRoles.has(role)).length;
  const localReady = steps.filter((item) => item.localEvidence).length;
  const avgResponseHours = averagePerformance(teleconsultations, "responseHours");
  const metrics = [
    { id: "consortium-loop-completion-rate", value: percent(localReady, steps.length), numerator: localReady, denominator: steps.length, source: "closed-loop stage evidence" },
    { id: "collaboration-efficiency-hours", value: avgResponseHours, unit: "h", source: "referralTeleconsultations.performance.responseHours" },
    { id: "report-return-rate", value: percent(returned.length, teleconsultations.length), numerator: returned.length, denominator: teleconsultations.length, source: "referralTeleconsultations.reportStatus" },
    { id: "mutual-recognition-evidence", value: mutualRecognitionEvidence.length, unit: "rows", source: "countyMutualRecognitionRecords" },
    { id: "grassroots-followup-return", value: grassrootsFollowupReturned.length, unit: "rows", source: "down-referral follow-up feedback" },
    { id: "quality-feedback-closure", value: qualityFeedbackClosed.length, unit: "rows", source: "slaDisposition + countySupervision" },
    { id: "role-todo-backlog", value: roleTodoBacklog, unit: "items", source: "onsite signoff roles" }
  ];
  const metricsUiReady = /data-consortium-loop-metrics/.test(countySource)
    && /data-gov-consortium-metric/.test(countySource)
    && /consortium-loop-completion-rate/.test(countySource)
    && /grassroots-followup-return/.test(countySource)
    && /quality-feedback-closure/.test(countySource);
  return {
    steps,
    metrics,
    summary: {
      steps: steps.length,
      localReady,
      externalBlockers: steps.filter((item) => item.blockerType === "external").length,
      onsiteBlockers: steps.filter((item) => item.blockerType === "onsite").length,
      roleCount: roleSet.size,
      mutualRecognitionEvidence: mutualRecognitionEvidence.length,
      completionRate: percent(localReady, steps.length),
      collaborationEfficiencyHours: avgResponseHours,
      reportReturnRate: percent(returned.length, teleconsultations.length),
      grassrootsFollowupReturned: grassrootsFollowupReturned.length,
      qualityFeedbackClosed: qualityFeedbackClosed.length,
      roleTodoBacklog,
      metricsCount: metrics.length,
      metricsUiReady,
      uiReady: /buildCountyConsortiumClosedLoopChain/.test(countySource)
        && /data-consortium-loop-summary/.test(countySource)
        && /data-consortium-loop-step/.test(countySource)
        && /data-referral-loop-target/.test(countySource)
    }
  };
}

function buildReferralTeleconsultationReadinessReport(options = {}) {
  const data = options.data ?? readJson("data/db.json");
  const pkg = options.pkg ?? readJson("package.json");
  const server = options.server ?? readText("server.js");
  const institution = options.institution ?? readText("institution.html") + readText("institution.js");
  const county = options.county ?? readText("county.html") + readText("county.js");
  const teleconsultations = Array.isArray(data.referralTeleconsultations) ? data.referralTeleconsultations : [];
  const taskMessages = (Array.isArray(data.taskMessages) ? data.taskMessages : [])
    .filter((item) => item.collection === "referralTeleconsultations" && item.sourceId);
  const contractIds = new Set((Array.isArray(data.integrationContracts) ? data.integrationContracts : []).map((item) => item.id));
  const authorizations = new Set((data.personalRecords || [])
    .filter((item) => item.category === "authorizations" && item.status !== "revoked" && item.meta?.status !== "revoked")
    .map((item) => item.id));
  const collaborationOrderIds = new Set((data.countyCollaborationOrders || []).map((item) => item.id));
  const referralIds = new Set((data.referralSystem?.referrals || []).map((item) => item.id));
  const statusSet = new Set(teleconsultations.map((item) => item.status));
  const reportReturned = teleconsultations.filter((item) => item.reportStatus === "returned" || item.status === "report-returned");
  const archivedReportIds = new Set((data.personalRecords || [])
    .filter((item) => item.category === "teleconsultation-report" && item.teleconsultationId)
    .map((item) => item.teleconsultationId));
  const notifiedReportIds = new Set(taskMessages
    .filter((item) => item.notificationKey && item.notificationKey.includes(":report:"))
    .map((item) => item.sourceId));
  const notifiedFeedbackIds = new Set(taskMessages
    .filter((item) => item.notificationKey && item.notificationKey.includes(":feedback:"))
    .map((item) => item.sourceId));
  const avgResponseHours = averagePerformance(teleconsultations, "responseHours");
  const avgReportReturnHours = averagePerformance(teleconsultations, "reportReturnHours");
  const escalations = buildReferralTeleconsultationEscalations(teleconsultations, options);
  const signoffSummary = buildReferralTeleconsultationSignoffSummary(data);
  const jointLedger = buildReferralTeleconsultationJointTestLedger(data);
  const consortiumClosedLoop = buildReferralConsortiumClosedLoopEvidence(data, county);
  const acknowledgedEscalations = teleconsultations.filter((item) => item.slaDisposition?.status && item.slaDisposition.status !== "pending-ack");
  const countySupervised = teleconsultations.filter((item) => item.countySupervision?.status);
  const insurancePerformanceRows = teleconsultations.filter((item) => item.performance?.insurancePaymentPath && item.performance?.repeatExamControl);
  const slaMessages = taskMessages.filter((item) => item.escalationKey);
  const boundaryEvidence = {
    referral: teleconsultations.every((item) => item.referralId),
    teleconsultation: teleconsultations.every((item) => item.meetingWindow || item.type),
    "receiving feedback": teleconsultations.every((item) => Object.hasOwn(item, "receivingFeedback")),
    "report return": teleconsultations.every((item) => Object.hasOwn(item, "reportStatus") && Object.hasOwn(item, "reportSummary")),
    "collaboration order": teleconsultations.every((item) => item.collaborationOrderId),
    performance: teleconsultations.every((item) => item.performance && typeof item.performance === "object"),
    "SLA disposition": teleconsultations.every((item) => item.slaDisposition && item.countySupervision),
    "joint test pack": /buildReferralTeleconsultationJointTestPack/.test(server),
    "joint test ledger": /buildReferralTeleconsultationJointTestLedger/.test(server) && /county-teleconsultation-joint-ledger/.test(county),
    "joint test task dispatch": /joint-test-ledger\/tasks/.test(server) && /createReferralJointLedgerTasks/.test(county),
    "joint test task completion": /completeReferralTeleconsultationJointTestTask/.test(server) && /completeReferralJointLedgerTask/.test(county),
    "insurance payment policy": teleconsultations.every((item) => item.performance?.insurancePaymentPath),
    "onsite signoff summary": signoffSummary.summary.roles >= 5 && signoffSummary.summary.demoReady >= 5,
    "onsite signoff archive": /upsertReferralTeleconsultationSignoff/.test(server) && /data-referral-signoff-submit/.test(county),
    "consortium closed loop": consortiumClosedLoop.summary.steps === 6 && consortiumClosedLoop.summary.localReady >= 6 && consortiumClosedLoop.summary.uiReady,
    "consortium metrics": consortiumClosedLoop.summary.metricsCount >= 6 && consortiumClosedLoop.summary.metricsUiReady && consortiumClosedLoop.summary.grassrootsFollowupReturned >= 1 && consortiumClosedLoop.summary.qualityFeedbackClosed >= 1,
    "consortium metrics API": /referral-teleconsultations\/consortium-metrics/.test(server) && /buildReferralConsortiumClosedLoopMetrics/.test(server)
  };
  const checks = [
    { id: "referral:boundary", passed: REQUIRED_BOUNDARIES.every((item) => boundaryEvidence[item]), detail: REQUIRED_BOUNDARIES.join(", ") },
    { id: "referral:seedData", passed: teleconsultations.length >= 2, detail: `${teleconsultations.length} teleconsultations` },
    { id: "referral:statusNormalization", passed: teleconsultations.every((item) => REQUIRED_STATUSES.includes(item.status) || item.status === "cancelled"), detail: [...statusSet].join(", ") },
    { id: "referral:residentAuthorization", passed: teleconsultations.every((item) => item.authorizationStatus === "authorized" && authorizations.has(item.residentAuthorizationId)), detail: `${teleconsultations.filter((item) => authorizations.has(item.residentAuthorizationId)).length}/${teleconsultations.length} authorized` },
    { id: "referral:reusePoints", passed: teleconsultations.every((item) => referralIds.has(item.referralId) && collaborationOrderIds.has(item.collaborationOrderId)), detail: "referralSystem and countyCollaborationOrders linked" },
    { id: "referral:reportReturn", passed: reportReturned.length >= 1 && teleconsultations.every((item) => item.reportStatus), detail: `${reportReturned.length} returned reports` },
    { id: "referral:reportArchive", passed: reportReturned.length >= 1 && reportReturned.every((item) => archivedReportIds.has(item.id)), detail: `${reportReturned.filter((item) => archivedReportIds.has(item.id)).length}/${reportReturned.length} returned reports archived` },
    { id: "referral:notifications", passed: reportReturned.length >= 1 && reportReturned.every((item) => notifiedReportIds.has(item.id)) && /appendReferralTeleconsultationNotifications/.test(server), detail: `${reportReturned.filter((item) => notifiedReportIds.has(item.id)).length}/${reportReturned.length} returned reports notified` },
    { id: "referral:feedbackCallback", passed: contractIds.has("referral-feedback-callback-v1") && /feedback-callback/.test(server) && teleconsultations.some((item) => item.receivingFeedback && notifiedFeedbackIds.has(item.id)), detail: `${notifiedFeedbackIds.size} feedback notifications with signed callback contract` },
    { id: "referral:performance", passed: avgResponseHours !== null && avgReportReturnHours !== null && /county-teleconsultation-performance/.test(county), detail: `avg response ${avgResponseHours}h, avg report return ${avgReportReturnHours}h` },
    { id: "referral:slaEscalation", passed: /buildReferralTeleconsultationEscalations/.test(server) && /SLA risks/.test(county), detail: `${escalations.length} SLA escalation items surfaced` },
    { id: "referral:slaReminder", passed: /referral-teleconsultations\/escalations\/run/.test(server) && /data-referral-escalation/.test(county) && /escalationKey/.test(server), detail: "SLA reminders create idempotent taskMessages for institutions" },
    { id: "referral:slaAcknowledgement", passed: /escalations\/ack/.test(server) && /data-teleconsultation-ack/.test(institution) && /data-county-sla-ack/.test(county) && slaMessages.length >= 1, detail: `${acknowledgedEscalations.length} acknowledged, ${slaMessages.length} SLA messages` },
    { id: "referral:countySupervision", passed: countySupervised.length === teleconsultations.length && /Supervision/.test(county), detail: `${countySupervised.length}/${teleconsultations.length} county supervision rows` },
    { id: "referral:jointTestPack", passed: /joint-test-pack/.test(server) && /buildReferralTeleconsultationJointTestPack/.test(server) && /taskReceipts/.test(server) && /exportSummary/.test(server) && /cutoverReadiness/.test(server) && /nextDevelopmentPlan/.test(server), detail: "runtime joint-test pack exposes callback samples, checklist, task receipts, export summary, cutover readiness, next plan, and signoff roles" },
    { id: "referral:jointTestLedger", passed: /joint-test-ledger/.test(server) && /buildReferralTeleconsultationJointTestLedger/.test(server) && /renderCountyTeleconsultationJointLedger/.test(county), detail: `${jointLedger.summary.localReady}/${jointLedger.summary.rows} local-ready rows; ${jointLedger.summary.callbackMatchedContracts}/${jointLedger.summary.callbackContracts} callbacks replayed` },
    { id: "referral:jointTestTaskDispatch", passed: /joint-test-ledger\/tasks/.test(server) && /createReferralTeleconsultationJointTestTasks/.test(server) && /data-referral-joint-ledger-tasks/.test(county), detail: "county command board can create idempotent joint-test taskMessages from the ledger" },
    { id: "referral:jointTestTaskCompletion", passed: /completeReferralTeleconsultationJointTestTask/.test(server) && /joint-test-ledger\/tasks\/[^/]+\/complete/.test(server) && /data-referral-joint-ledger-complete/.test(county) && /completeReferralJointLedgerTask/.test(county), detail: "joint-test task owners can record completion receipts before onsite signoff" },
    { id: "referral:signoffSummary", passed: /signoff-summary/.test(server) && /county-teleconsultation-signoff/.test(county) && signoffSummary.summary.allDemoReady, detail: `${signoffSummary.summary.demoReady}/${signoffSummary.summary.roles} demo-ready roles; ${signoffSummary.summary.sitePending} site signoffs pending` },
    { id: "referral:signoffArchive", passed: /upsertReferralTeleconsultationSignoff/.test(server) && /signoff-summary\/:role\/evidence/.test(server) && /archiveReferralSignoff/.test(county) && /data-referral-signoff-submit/.test(county), detail: `${signoffSummary.summary.siteSigned}/${signoffSummary.summary.roles} onsite signoffs archived; ${signoffSummary.summary.sitePending} pending` },
    { id: "referral:consortiumClosedLoop", passed: consortiumClosedLoop.summary.steps === 6 && consortiumClosedLoop.summary.localReady >= 6 && consortiumClosedLoop.summary.uiReady && consortiumClosedLoop.summary.roleCount >= 5, detail: `${consortiumClosedLoop.summary.localReady}/${consortiumClosedLoop.summary.steps} stages local-ready; ${consortiumClosedLoop.summary.externalBlockers} external blockers; ${consortiumClosedLoop.summary.onsiteBlockers} onsite blockers; ${consortiumClosedLoop.summary.mutualRecognitionEvidence} mutual-recognition evidence rows` },
    { id: "referral:consortiumMetrics", passed: consortiumClosedLoop.summary.metricsCount >= 6 && consortiumClosedLoop.summary.metricsUiReady && consortiumClosedLoop.summary.grassrootsFollowupReturned >= 1 && consortiumClosedLoop.summary.qualityFeedbackClosed >= 1, detail: `${consortiumClosedLoop.summary.completionRate}% completion; ${consortiumClosedLoop.summary.collaborationEfficiencyHours ?? "-"}h avg response; ${consortiumClosedLoop.summary.grassrootsFollowupReturned} grassroots follow-up rows; ${consortiumClosedLoop.summary.qualityFeedbackClosed} quality feedback closures; ${consortiumClosedLoop.summary.roleTodoBacklog} role todos` },
    { id: "referral:consortiumMetricsApi", passed: /referral-teleconsultations\/consortium-metrics/.test(server) && /buildReferralConsortiumClosedLoopMetrics/.test(server), detail: "G-end consortium metrics API exposes completion, efficiency, report-return, mutual-recognition, follow-up, quality closure, and role backlog keys" },
    { id: "referral:insurancePerformancePolicy", passed: insurancePerformanceRows.length === teleconsultations.length && /performance-policy/.test(server) && /referral-performance-policy/.test(readText("insurance.html") + readText("insurance.js")), detail: `${insurancePerformanceRows.length}/${teleconsultations.length} payment policy rows` },
    { id: "referral:api", passed: /\/api\/referral-teleconsultations/.test(server) && /feedback-callback/.test(server) && /schedule-callback/.test(server) && /report-callback/.test(server) && /verifyIntegrationSignature/.test(server) && /canAccessReferralTeleconsultation/.test(server) && /appendDataAccessLog/.test(server), detail: "specialized API, signed feedback/schedule/report callbacks, role guard, and audit log present" },
    { id: "referral:frontend", passed: /teleconsultation-form/.test(institution) && /teleconsultation-action-form/.test(institution) && /teleconsultation-loop/.test(institution) && /county-teleconsultation-loop/.test(county) && /county-teleconsultation-status-filter/.test(county), detail: "institution create form, feedback form, institution loop, and county command entry present" },
    { id: "referral:releaseScript", passed: Boolean(pkg.scripts?.["referral:readiness"]), detail: pkg.scripts?.["referral:readiness"] || "missing" }
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    boundaries: REQUIRED_BOUNDARIES,
    statusCatalog: REQUIRED_STATUSES,
    summary: {
      total: teleconsultations.length,
      reportReturned: reportReturned.length,
      archivedReports: reportReturned.filter((item) => archivedReportIds.has(item.id)).length,
      notifications: taskMessages.length,
      feedbackNotifications: notifiedFeedbackIds.size,
      slaEscalations: escalations.length,
      highRiskEscalations: escalations.filter((item) => item.severity === "high").length,
      slaMessages: slaMessages.length,
      acknowledgedEscalations: acknowledgedEscalations.length,
      signoffRoles: signoffSummary.summary.roles,
      signoffDemoReady: signoffSummary.summary.demoReady,
      signoffSiteSigned: signoffSummary.summary.siteSigned,
      signoffSitePending: signoffSummary.summary.sitePending,
      jointLedgerRows: jointLedger.summary.rows,
      jointLedgerLocalReady: jointLedger.summary.localReady,
      jointLedgerMatchedContracts: jointLedger.summary.callbackMatchedContracts,
      consortiumLoopSteps: consortiumClosedLoop.summary.steps,
      consortiumLoopLocalReady: consortiumClosedLoop.summary.localReady,
      consortiumLoopExternalBlockers: consortiumClosedLoop.summary.externalBlockers,
      consortiumLoopOnsiteBlockers: consortiumClosedLoop.summary.onsiteBlockers,
      mutualRecognitionEvidenceRows: consortiumClosedLoop.summary.mutualRecognitionEvidence,
      consortiumLoopCompletionRate: consortiumClosedLoop.summary.completionRate,
      consortiumCollaborationEfficiencyHours: consortiumClosedLoop.summary.collaborationEfficiencyHours,
      consortiumReportReturnRate: consortiumClosedLoop.summary.reportReturnRate,
      grassrootsFollowupReturned: consortiumClosedLoop.summary.grassrootsFollowupReturned,
      qualityFeedbackClosed: consortiumClosedLoop.summary.qualityFeedbackClosed,
      roleTodoBacklog: consortiumClosedLoop.summary.roleTodoBacklog,
      consortiumMetrics: consortiumClosedLoop.summary.metricsCount,
      consortiumMetricsApi: boundaryEvidence["consortium metrics API"],
      countySupervisionRows: countySupervised.length,
      insurancePerformanceRows: insurancePerformanceRows.length,
      collaborationOrders: teleconsultations.filter((item) => collaborationOrderIds.has(item.collaborationOrderId)).length,
      avgResponseHours,
      avgReportReturnHours
    },
    escalations,
    signoff: signoffSummary.roles,
    consortiumClosedLoop: consortiumClosedLoop.steps,
    consortiumMetrics: consortiumClosedLoop.metrics,
    teleconsultations: teleconsultations.map((item) => ({
      id: item.id,
      referralId: item.referralId,
      residentId: item.residentId,
      status: item.status,
      reportStatus: item.reportStatus,
      sourceInstitution: item.sourceInstitution,
      targetInstitution: item.targetInstitution,
      collaborationOrderId: item.collaborationOrderId,
      performance: item.performance,
      slaDisposition: item.slaDisposition,
      countySupervision: item.countySupervision,
      auditEvents: Array.isArray(item.auditTrail) ? item.auditTrail.length : 0
    })),
    checks
  };
}

function renderMarkdown(report) {
  return [
    "# Referral teleconsultation readiness report",
    "",
    `Generated at: ${report.generatedAt}`,
    "",
    "## Summary",
    "",
    `- Teleconsultations: ${report.summary.total}`,
    `- Returned reports: ${report.summary.reportReturned}`,
    `- Archived reports: ${report.summary.archivedReports}`,
    `- Referral notifications: ${report.summary.notifications}`,
    `- Feedback notifications: ${report.summary.feedbackNotifications}`,
    `- SLA escalations: ${report.summary.slaEscalations}`,
    `- High risk escalations: ${report.summary.highRiskEscalations}`,
    `- SLA messages: ${report.summary.slaMessages}`,
    `- Acknowledged escalations: ${report.summary.acknowledgedEscalations}`,
    `- Signoff demo-ready roles: ${report.summary.signoffDemoReady}/${report.summary.signoffRoles}`,
    `- Site signoffs archived: ${report.summary.signoffSiteSigned}/${report.summary.signoffRoles}`,
    `- Site signoffs pending: ${report.summary.signoffSitePending}`,
    `- Joint-test ledger rows: ${report.summary.jointLedgerLocalReady}/${report.summary.jointLedgerRows}`,
    `- Joint-test matched contracts: ${report.summary.jointLedgerMatchedContracts}`,
    `- Consortium closed-loop steps: ${report.summary.consortiumLoopLocalReady}/${report.summary.consortiumLoopSteps}`,
    `- Consortium external blockers: ${report.summary.consortiumLoopExternalBlockers}`,
    `- Consortium onsite blockers: ${report.summary.consortiumLoopOnsiteBlockers}`,
    `- Mutual-recognition evidence rows: ${report.summary.mutualRecognitionEvidenceRows}`,
    `- Consortium closed-loop completion rate: ${report.summary.consortiumLoopCompletionRate}%`,
    `- Consortium collaboration efficiency hours: ${report.summary.consortiumCollaborationEfficiencyHours ?? "-"}`,
    `- Consortium report return rate: ${report.summary.consortiumReportReturnRate}%`,
    `- Grassroots follow-up returned: ${report.summary.grassrootsFollowupReturned}`,
    `- Quality feedback closed: ${report.summary.qualityFeedbackClosed}`,
    `- Role todo backlog: ${report.summary.roleTodoBacklog}`,
    `- G-end consortium metrics: ${report.summary.consortiumMetrics}`,
    `- G-end consortium metrics API: ${report.summary.consortiumMetricsApi ? "/api/referral-teleconsultations/consortium-metrics" : "missing"}`,
    `- County supervision rows: ${report.summary.countySupervisionRows}`,
    `- Insurance performance rows: ${report.summary.insurancePerformanceRows}`,
    `- Linked collaboration orders: ${report.summary.collaborationOrders}`,
    `- Avg response hours: ${report.summary.avgResponseHours ?? "-"}`,
    `- Avg report return hours: ${report.summary.avgReportReturnHours ?? "-"}`,
    "",
    "## Boundary",
    "",
    ...report.boundaries.map((item) => `- ${item}`),
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
  fs.writeFileSync(output, JSON.stringify({ ok: report.ok, referralTeleconsultationReadiness: report }, null, 2), "utf8");
  fs.writeFileSync(markdown, renderMarkdown(report), "utf8");
}

function main() {
  const report = buildReferralTeleconsultationReadinessReport();
  writeReport(report);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}

if (require.main === module) main();

module.exports = {
  buildReferralConsortiumClosedLoopEvidence,
  buildReferralTeleconsultationReadinessReport,
  renderMarkdown,
  writeReport
};
