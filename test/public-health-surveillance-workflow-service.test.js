"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  ingestPublicHealthSurveillanceSignalToState
} = require("../public-health-data-foundation-service");
const {
  applyPublicHealthMedicalPreventionTaskActionToState
} = require("../public-health-medical-prevention-collaboration-service");
const {
  applyPublicHealthSurveillanceAlertActionToState,
  buildPublicHealthSurveillanceCenter,
  evaluatePublicHealthSurveillanceSignalToState,
  verifyPublicHealthSurveillanceSignalToState
} = require("../public-health-surveillance-workflow-service");
const {
  activatePublicHealthSurveillanceRuleChangeToState,
  proposePublicHealthSurveillanceRuleChangeToState,
  reviewPublicHealthSurveillanceRuleChangeToState
} = require("../public-health-surveillance-rule-governance-service");
const {
  PUBLIC_HEALTH_OFFICIAL_EXCHANGE_RECEIPT_PURPOSE,
  issueTrustedPublicHealthOfficialExchangeReceipt
} = require("../public-health-official-exchange-receipt-service");

const RULE_GOVERNANCE_SECRET = "public-health-workflow-rule-governance-secret-2026";
const OFFICIAL_EXCHANGE_KEYRING = {
  purpose: PUBLIC_HEALTH_OFFICIAL_EXCHANGE_RECEIPT_PURPOSE,
  activeKeyId: "workflow-official-exchange-2026-07",
  keys: [{
    keyId: "workflow-official-exchange-2026-07",
    secret: "public-health-workflow-official-exchange-secret-2026-07",
    status: "active",
    notBefore: "2026-07-01T00:00:00.000Z",
    expiresAt: "2027-01-01T00:00:00.000Z",
    revokedAt: ""
  }]
};

function attachOfficialReceipt(data, receipt) {
  return {
    ...data,
    publicHealthOfficialExchangeReceipts: [
      ...(data.publicHealthOfficialExchangeReceipts || []),
      receipt
    ]
  };
}

function trustedOfficialReport(alertId, suffix = "001", times = {}) {
  return issueTrustedPublicHealthOfficialExchangeReceipt({
    id: `workflow-official-report-receipt-${suffix}`,
    stage: "official-report",
    alertId,
    reportId: `REPORT-${suffix}`,
    externalReceiptCode: `CDC-ACCEPTED-${suffix}`,
    status: "accepted",
    evidenceRefs: [`OFFICIAL-REPORT-RECEIPT-${suffix}`],
    issuedAt: times.issuedAt || "2026-07-28T09:00:00.000Z"
  }, {
    signedBy: "provincial-reporting-platform",
    verifiedBy: "workflow-official-report-adapter",
    verifiedAt: times.verifiedAt || "2026-07-28T09:00:30.000Z",
    signatureVerified: true,
    receiptId: `workflow-server-report-receipt-${suffix}`
  }, OFFICIAL_EXCHANGE_KEYRING);
}

function trustedOfficialFeedback(report, suffix = "001", times = {}) {
  return issueTrustedPublicHealthOfficialExchangeReceipt({
    id: `workflow-official-feedback-receipt-${suffix}`,
    stage: "feedback",
    alertId: report.alertId,
    reportId: report.reportId,
    externalReceiptCode: `CDC-FEEDBACK-${suffix}`,
    conclusion: "疾控复核确认纳入持续监测",
    status: "accepted",
    evidenceRefs: [`CDC-FEEDBACK-EVIDENCE-${suffix}`],
    issuedAt: times.issuedAt || "2026-07-28T09:30:00.000Z"
  }, {
    signedBy: "provincial-reporting-platform",
    verifiedBy: "workflow-official-feedback-adapter",
    verifiedAt: times.verifiedAt || "2026-07-28T09:30:30.000Z",
    signatureVerified: true,
    receiptId: `workflow-server-feedback-receipt-${suffix}`
  }, OFFICIAL_EXCHANGE_KEYRING, report);
}

const OFFICIAL_EXCHANGE_OPTIONS = {
  officialExchangeReceiptKeyring: OFFICIAL_EXCHANGE_KEYRING,
  officialExchangeReceiptAt: "2026-07-28T11:00:00.000Z"
};

function signalPayload(value = 8, overrides = {}) {
  return {
    sourceId: "ph-source-clinical-syndrome",
    externalSignalId: "EMR-SYNDROME-WORKFLOW-20260728-001",
    signalType: "clinical-syndrome",
    institutionId: "medical-institution-001",
    regionCode: "210202",
    observedAt: "2026-07-28T08:00:00.000Z",
    metrics: [{
      metricCode: "fever-respiratory-count",
      value,
      unit: "cases/24h",
      baseline: 3
    }],
    evidenceRefs: ["EMR-SYNDROME-WORKFLOW-EVIDENCE-001"],
    idempotencyKey: "workflow-signal-intake-001",
    ...overrides
  };
}

function prepareAlert() {
  const intake = ingestPublicHealthSurveillanceSignalToState(
    {},
    signalPayload(),
    { name: "医院公卫科", role: "medical-public-health" },
    { at: "2026-07-28T08:01:00.000Z" }
  );
  const verified = verifyPublicHealthSurveillanceSignalToState(
    intake.nextData,
    intake.signal.id,
    {
      decision: "confirmed",
      note: "病例来源和症候群口径已人工核实",
      evidenceRefs: ["MANUAL-VERIFY-001"],
      idempotencyKey: "workflow-signal-verify-001",
      expectedVersion: 1,
      at: "2026-07-28T08:05:00.000Z"
    },
    { name: "疾控监测员", role: "cdc-surveillance" }
  );
  return evaluatePublicHealthSurveillanceSignalToState(
    verified.nextData,
    verified.signal.id,
    {
      idempotencyKey: "workflow-signal-evaluate-001",
      expectedVersion: 2,
      at: "2026-07-28T08:06:00.000Z"
    },
    { name: "规则执行器", role: "system" }
  );
}

function closeCollaborationTask(data, task, user, prefix) {
  let result = applyPublicHealthMedicalPreventionTaskActionToState(data, task.id, {
    action: "accept-task",
    idempotencyKey: `${prefix}:accept`,
    expectedVersion: 1,
    assignedTo: `${prefix}-owner`,
    note: "责任人接单"
  }, user);
  result = applyPublicHealthMedicalPreventionTaskActionToState(result.nextData, task.id, {
    action: "start-task",
    idempotencyKey: `${prefix}:start`,
    expectedVersion: 2,
    note: "开始业务核查"
  }, user);
  result = applyPublicHealthMedicalPreventionTaskActionToState(result.nextData, task.id, {
    action: "record-task-receipt",
    idempotencyKey: `${prefix}:receipt`,
    expectedVersion: 3,
    receiptStatus: "accepted",
    receiptCode: `${prefix.toUpperCase()}-ACCEPTED-001`,
    evidenceRefs: [`${prefix}-signed-receipt`]
  }, { name: "可信适配器", role: "system" });
  return applyPublicHealthMedicalPreventionTaskActionToState(result.nextData, task.id, {
    action: "close-task",
    idempotencyKey: `${prefix}:close`,
    expectedVersion: 4,
    conclusion: "医防协同业务闭环完成",
    evidenceRefs: task.requiredEvidence
  }, user);
}

function prepareInvestigatingAlert() {
  const evaluated = prepareAlert();
  const alertId = evaluated.alert.id;
  let result = applyPublicHealthSurveillanceAlertActionToState(evaluated.nextData, alertId, {
    action: "verify-alert",
    idempotencyKey: "trusted-receipt-alert-verify",
    expectedVersion: 1,
    riskLevel: "high",
    conclusion: "人工研判需要正式上报",
    evidenceRefs: ["trusted-receipt-risk-evidence"],
    at: "2026-07-28T08:10:00.000Z"
  }, { name: "疾控研判员", role: "cdc-surveillance" });
  result = applyPublicHealthSurveillanceAlertActionToState(result.nextData, alertId, {
    action: "dispatch-alert",
    idempotencyKey: "trusted-receipt-alert-dispatch",
    expectedVersion: 2,
    medicalInstitutionId: "medical-institution-001",
    primaryCareOrganizationId: "primary-care-organization-001",
    dueAt: "2026-07-29T08:00:00.000Z",
    note: "派发正式上报前核查",
    at: "2026-07-28T08:12:00.000Z"
  }, { name: "疾控值班员", role: "cdc-surveillance" });
  return applyPublicHealthSurveillanceAlertActionToState(result.nextData, alertId, {
    action: "start-investigation",
    idempotencyKey: "trusted-receipt-alert-investigate",
    expectedVersion: 3,
    investigationOwner: "市疾控流调组",
    note: "启动正式报告核查",
    at: "2026-07-28T08:15:00.000Z"
  }, { name: "疾控值班员", role: "cdc-surveillance" });
}

test("human verified multi-source signal creates an explainable versioned alert", () => {
  const evaluated = prepareAlert();
  assert.equal(evaluated.ok, true);
  assert.equal(evaluated.matched, true);
  assert.equal(evaluated.alert.status, "open");
  assert.equal(evaluated.alert.ruleId, "ph-rule-clinical-syndrome");
  assert.equal(evaluated.alert.ruleVersion, 1);
  assert.equal(evaluated.alert.observedValue, 8);
  assert.equal(evaluated.alert.threshold, 5);
  assert.equal(evaluated.signal.workflowState, "alert-created");
  assert.equal(evaluated.productionReady, false);
  const center = buildPublicHealthSurveillanceCenter({ data: evaluated.nextData });
  assert.equal(center.summary.rules, 8);
  assert.equal(center.summary.activeRules, 8);
  assert.equal(center.summary.alerts, 1);
  assert.equal(center.dataFoundation.summary.sources, 8);
  assert.equal(center.productionReady, false);
});

test("alert completes manual assessment dispatch investigation report feedback and collaboration closure", () => {
  const evaluated = prepareAlert();
  const alertId = evaluated.alert.id;
  let result = applyPublicHealthSurveillanceAlertActionToState(evaluated.nextData, alertId, {
    action: "verify-alert",
    idempotencyKey: "workflow-alert-verify-001",
    expectedVersion: 1,
    riskLevel: "high",
    conclusion: "症候群数量超过规则阈值，需要启动医防联合核查",
    evidenceRefs: ["RISK-ASSESSMENT-EVIDENCE-001"],
    at: "2026-07-28T08:10:00.000Z"
  }, { name: "疾控研判员", role: "cdc-surveillance" });
  assert.equal(result.alert.status, "verified");
  assert.equal(result.riskAssessment.humanDecision, true);
  assert.equal(result.riskAssessment.modelAdviceOnly, true);

  result = applyPublicHealthSurveillanceAlertActionToState(result.nextData, alertId, {
    action: "dispatch-alert",
    idempotencyKey: "workflow-alert-dispatch-001",
    expectedVersion: 2,
    medicalInstitutionId: "medical-institution-001",
    primaryCareOrganizationId: "primary-care-organization-001",
    dueAt: "2026-07-29T08:00:00.000Z",
    note: "派发医院公卫科与基层公卫核查",
    at: "2026-07-28T08:12:00.000Z"
  }, { name: "疾控值班员", role: "cdc-surveillance" });
  assert.equal(result.alert.status, "dispatched");
  assert.equal(result.createdCollaborationTasks.length, 2);

  result = applyPublicHealthSurveillanceAlertActionToState(result.nextData, alertId, {
    action: "start-investigation",
    idempotencyKey: "workflow-alert-investigate-001",
    expectedVersion: 3,
    investigationOwner: "市疾控流调一组",
    note: "启动病例清单和共同暴露核查",
    at: "2026-07-28T08:15:00.000Z"
  }, { name: "疾控值班员", role: "cdc-surveillance" });

  const medicalTask = result.nextData.publicHealthMedicalPreventionTasks.find((item) => item.ownerRole === "medical-public-health");
  const primaryTask = result.nextData.publicHealthMedicalPreventionTasks.find((item) => item.ownerRole === "primary-care-public-health");
  let taskResult = closeCollaborationTask(result.nextData, medicalTask, {
    name: "医院公共卫生科",
    role: "medical-public-health"
  }, "workflow-medical");
  taskResult = closeCollaborationTask(taskResult.nextData, primaryTask, {
    name: "基层公卫专干",
    role: "primary-care-public-health"
  }, "workflow-primary");

  const reportReceipt = trustedOfficialReport(alertId);
  const reportData = attachOfficialReceipt(taskResult.nextData, reportReceipt);
  result = applyPublicHealthSurveillanceAlertActionToState(reportData, alertId, {
    action: "record-official-report",
    idempotencyKey: "workflow-alert-report-001",
    expectedVersion: 4,
    trustedReceiptId: reportReceipt.id,
    at: "2026-07-28T09:00:00.000Z"
  }, { name: "医院公共卫生科", role: "medical-public-health" }, OFFICIAL_EXCHANGE_OPTIONS);
  const feedbackReceipt = trustedOfficialFeedback(reportReceipt);
  const feedbackData = attachOfficialReceipt(result.nextData, feedbackReceipt);
  result = applyPublicHealthSurveillanceAlertActionToState(feedbackData, alertId, {
    action: "record-feedback",
    idempotencyKey: "workflow-alert-feedback-001",
    expectedVersion: 5,
    trustedReceiptId: feedbackReceipt.id,
    at: "2026-07-28T09:30:00.000Z"
  }, { name: "疾控反馈适配器", role: "system" }, OFFICIAL_EXCHANGE_OPTIONS);
  result = applyPublicHealthSurveillanceAlertActionToState(result.nextData, alertId, {
    action: "close-alert",
    idempotencyKey: "workflow-alert-close-001",
    expectedVersion: 6,
    conclusion: "医防协同核查、正式报告和反馈均已完成",
    evidenceRefs: ["ALERT-CLOSURE-EVIDENCE-001"],
    at: "2026-07-28T10:00:00.000Z"
  }, { name: "疾控监测负责人", role: "cdc-surveillance" }, OFFICIAL_EXCHANGE_OPTIONS);
  assert.equal(result.alert.status, "closed");
  assert.equal(result.alert.version, 7);
  assert.equal(result.surveillance.summary.closedAlerts, 1);
  assert.equal(result.surveillance.summary.closedCollaborationTasks, 2);
  assert.equal(result.surveillance.summary.trustedOfficialReports, 1);
  assert.equal(result.surveillance.summary.trustedOfficialFeedbacks, 1);
  assert.equal(result.surveillance.productionReady, false);

  result = applyPublicHealthSurveillanceAlertActionToState(result.nextData, alertId, {
    action: "reopen-alert",
    idempotencyKey: "workflow-alert-reopen-001",
    expectedVersion: 7,
    note: "new evidence requires another investigation cycle",
    at: "2026-07-28T10:10:00.000Z"
  }, { name: "cdc owner", role: "cdc-surveillance" }, OFFICIAL_EXCHANGE_OPTIONS);
  assert.throws(() => applyPublicHealthSurveillanceAlertActionToState(result.nextData, alertId, {
    action: "record-official-report",
    idempotencyKey: "workflow-alert-reuse-report",
    expectedVersion: 8,
    trustedReceiptId: reportReceipt.id
  }, { name: "medical public health", role: "medical-public-health" }, OFFICIAL_EXCHANGE_OPTIONS), /already used by this alert/);
  const staleCycleReceipt = trustedOfficialReport(alertId, "STALE-CYCLE");
  assert.throws(() => applyPublicHealthSurveillanceAlertActionToState(
    attachOfficialReceipt(result.nextData, staleCycleReceipt),
    alertId,
    {
      action: "record-official-report",
      idempotencyKey: "workflow-alert-stale-cycle-report",
      expectedVersion: 8,
      trustedReceiptId: staleCycleReceipt.id
    },
    { name: "medical public health", role: "medical-public-health" },
    OFFICIAL_EXCHANGE_OPTIONS
  ), /predates the current investigation cycle/);
  const secondReportReceipt = trustedOfficialReport(alertId, "REOPEN-002", {
    issuedAt: "2026-07-28T10:20:00.000Z",
    verifiedAt: "2026-07-28T10:20:30.000Z"
  });
  result = applyPublicHealthSurveillanceAlertActionToState(
    attachOfficialReceipt(result.nextData, secondReportReceipt),
    alertId,
    {
      action: "record-official-report",
      idempotencyKey: "workflow-alert-report-002",
      expectedVersion: 8,
      trustedReceiptId: secondReportReceipt.id
    },
    { name: "medical public health", role: "medical-public-health" },
    OFFICIAL_EXCHANGE_OPTIONS
  );
  assert.equal(result.alert.feedback, null);
  const secondFeedbackReceipt = trustedOfficialFeedback(secondReportReceipt, "REOPEN-002", {
    issuedAt: "2026-07-28T10:30:00.000Z",
    verifiedAt: "2026-07-28T10:30:30.000Z"
  });
  result = applyPublicHealthSurveillanceAlertActionToState(
    attachOfficialReceipt(result.nextData, secondFeedbackReceipt),
    alertId,
    {
      action: "record-feedback",
      idempotencyKey: "workflow-alert-feedback-002",
      expectedVersion: 9,
      trustedReceiptId: secondFeedbackReceipt.id
    },
    { name: "trusted feedback adapter", role: "system" },
    OFFICIAL_EXCHANGE_OPTIONS
  );
  assert.equal(result.alert.status, "feedback-confirmed");
  assert.equal(result.surveillance.summary.trustedOfficialReports, 2);
  assert.equal(result.surveillance.summary.trustedOfficialFeedbacks, 2);
  assert.equal(result.surveillance.summary.alertIntegrityFindings, 0);
});

test("alert cannot close before both medical-prevention tasks are complete", () => {
  const evaluated = prepareAlert();
  const alertId = evaluated.alert.id;
  let result = applyPublicHealthSurveillanceAlertActionToState(evaluated.nextData, alertId, {
    action: "verify-alert",
    idempotencyKey: "blocked-alert-verify",
    riskLevel: "high",
    conclusion: "人工确认需要核查",
    evidenceRefs: ["risk-evidence"],
    at: "2026-07-28T08:10:00.000Z"
  }, { name: "疾控研判员", role: "cdc-surveillance" });
  result = applyPublicHealthSurveillanceAlertActionToState(result.nextData, alertId, {
    action: "dispatch-alert",
    idempotencyKey: "blocked-alert-dispatch",
    medicalInstitutionId: "medical-institution-001",
    primaryCareOrganizationId: "primary-care-organization-001",
    dueAt: "2026-07-29T08:00:00.000Z",
    note: "派发核查",
    at: "2026-07-28T08:12:00.000Z"
  }, { name: "疾控值班员", role: "cdc-surveillance" });
  result = applyPublicHealthSurveillanceAlertActionToState(result.nextData, alertId, {
    action: "start-investigation",
    idempotencyKey: "blocked-alert-investigate",
    investigationOwner: "流调一组",
    note: "启动流调",
    at: "2026-07-28T08:15:00.000Z"
  }, { name: "疾控值班员", role: "cdc-surveillance" });
  const blockedReportReceipt = trustedOfficialReport(alertId, "BLOCKED-001");
  result = applyPublicHealthSurveillanceAlertActionToState(
    attachOfficialReceipt(result.nextData, blockedReportReceipt),
    alertId,
    {
    action: "record-official-report",
    idempotencyKey: "blocked-alert-report",
    trustedReceiptId: blockedReportReceipt.id
  }, { name: "医院公共卫生科", role: "medical-public-health" }, OFFICIAL_EXCHANGE_OPTIONS);
  const blockedFeedbackReceipt = trustedOfficialFeedback(blockedReportReceipt, "BLOCKED-001");
  result = applyPublicHealthSurveillanceAlertActionToState(
    attachOfficialReceipt(result.nextData, blockedFeedbackReceipt),
    alertId,
    {
    action: "record-feedback",
    idempotencyKey: "blocked-alert-feedback",
    trustedReceiptId: blockedFeedbackReceipt.id
  }, { name: "疾控反馈适配器", role: "system" }, OFFICIAL_EXCHANGE_OPTIONS);
  assert.throws(() => applyPublicHealthSurveillanceAlertActionToState(result.nextData, alertId, {
    action: "close-alert",
    idempotencyKey: "blocked-alert-close",
    conclusion: "尝试提前关闭",
    evidenceRefs: ["closure-evidence"]
  }, { name: "疾控监测负责人", role: "cdc-surveillance" }, OFFICIAL_EXCHANGE_OPTIONS), /collaboration tasks must be closed/);
});

test("client supplied report and feedback claims cannot advance the alert", () => {
  const investigated = prepareInvestigatingAlert();
  const alertId = investigated.alert.id;
  assert.throws(() => applyPublicHealthSurveillanceAlertActionToState(investigated.nextData, alertId, {
    action: "record-official-report",
    idempotencyKey: "forged-client-report",
    expectedVersion: 4,
    reportId: "FORGED-REPORT",
    receiptCode: "FORGED-ACCEPTED",
    evidenceRefs: ["FORGED-EVIDENCE"]
  }, { name: "medical public health", role: "medical-public-health" }, OFFICIAL_EXCHANGE_OPTIONS), /must come from a trusted server receipt/);

  const reportReceipt = trustedOfficialReport(alertId, "CLIENT-BOUNDARY");
  const reported = applyPublicHealthSurveillanceAlertActionToState(
    attachOfficialReceipt(investigated.nextData, reportReceipt),
    alertId,
    {
      action: "record-official-report",
      idempotencyKey: "trusted-client-boundary-report",
      expectedVersion: 4,
      trustedReceiptId: reportReceipt.id
    },
    { name: "medical public health", role: "medical-public-health" },
    OFFICIAL_EXCHANGE_OPTIONS
  );
  assert.throws(() => applyPublicHealthSurveillanceAlertActionToState(reported.nextData, alertId, {
    action: "record-feedback",
    idempotencyKey: "forged-client-feedback",
    expectedVersion: 5,
    feedbackCode: "FORGED-FEEDBACK",
    conclusion: "FORGED-CONCLUSION",
    evidenceRefs: ["FORGED-EVIDENCE"]
  }, { name: "trusted feedback adapter", role: "system" }, OFFICIAL_EXCHANGE_OPTIONS), /must come from a trusted server receipt/);
});

test("official receipt must be trusted by the managed keyring and bound to the alert", () => {
  const investigated = prepareInvestigatingAlert();
  const alertId = investigated.alert.id;
  const crossAlertReceipt = trustedOfficialReport("another-alert", "CROSS-ALERT");
  const receiptData = attachOfficialReceipt(investigated.nextData, crossAlertReceipt);
  assert.throws(() => applyPublicHealthSurveillanceAlertActionToState(receiptData, alertId, {
    action: "record-official-report",
    idempotencyKey: "cross-alert-report",
    expectedVersion: 4,
    trustedReceiptId: crossAlertReceipt.id
  }, { name: "medical public health", role: "medical-public-health" }, OFFICIAL_EXCHANGE_OPTIONS), /bound to this alert is required/);

  const ownReceipt = trustedOfficialReport(alertId, "NO-KEYRING");
  assert.throws(() => applyPublicHealthSurveillanceAlertActionToState(
    attachOfficialReceipt(investigated.nextData, ownReceipt),
    alertId,
    {
      action: "record-official-report",
      idempotencyKey: "missing-keyring-report",
      expectedVersion: 4,
      trustedReceiptId: ownReceipt.id
    },
    { name: "medical public health", role: "medical-public-health" }
  ), /official-exchange-receipt-registry-invalid/);
});

test("tampering a persisted official receipt invalidates the alert chain", () => {
  const investigated = prepareInvestigatingAlert();
  const alertId = investigated.alert.id;
  const reportReceipt = trustedOfficialReport(alertId, "TAMPER");
  const reported = applyPublicHealthSurveillanceAlertActionToState(
    attachOfficialReceipt(investigated.nextData, reportReceipt),
    alertId,
    {
      action: "record-official-report",
      idempotencyKey: "tamper-report",
      expectedVersion: 4,
      trustedReceiptId: reportReceipt.id
    },
    { name: "medical public health", role: "medical-public-health" },
    OFFICIAL_EXCHANGE_OPTIONS
  );
  const feedbackReceipt = trustedOfficialFeedback(reportReceipt, "TAMPER");
  const tamperedData = attachOfficialReceipt({
    ...reported.nextData,
    publicHealthOfficialExchangeReceipts: reported.nextData.publicHealthOfficialExchangeReceipts.map((receipt) => (
      receipt.id === reportReceipt.id
        ? { ...receipt, evidenceRefs: [...receipt.evidenceRefs, "CLIENT-INJECTED-EVIDENCE"] }
        : receipt
    ))
  }, feedbackReceipt);
  assert.throws(() => applyPublicHealthSurveillanceAlertActionToState(tamperedData, alertId, {
    action: "record-feedback",
    idempotencyKey: "tamper-feedback",
    expectedVersion: 5,
    trustedReceiptId: feedbackReceipt.id
  }, { name: "trusted feedback adapter", role: "system" }, OFFICIAL_EXCHANGE_OPTIONS), /official-exchange-receipt-registry-invalid/);
});

test("below-threshold signal records an explainable no-alert decision", () => {
  const intake = ingestPublicHealthSurveillanceSignalToState(
    {},
    signalPayload(2, {
      externalSignalId: "EMR-SYNDROME-WORKFLOW-LOW-001",
      idempotencyKey: "workflow-signal-intake-low-001"
    }),
    { name: "医院公卫科", role: "medical-public-health" }
  );
  const verified = verifyPublicHealthSurveillanceSignalToState(intake.nextData, intake.signal.id, {
    decision: "confirmed",
    note: "低于阈值但来源真实",
    evidenceRefs: ["manual-low-evidence"],
    idempotencyKey: "workflow-signal-verify-low-001"
  }, { name: "疾控监测员", role: "cdc-surveillance" });
  const evaluated = evaluatePublicHealthSurveillanceSignalToState(verified.nextData, verified.signal.id, {
    idempotencyKey: "workflow-signal-evaluate-low-001"
  }, { name: "规则执行器", role: "system" });
  assert.equal(evaluated.matched, false);
  assert.equal(evaluated.alert, null);
  assert.equal(evaluated.signal.workflowState, "evaluated-no-alert");
  assert.equal(evaluated.nextData.publicHealthSurveillanceAlerts.length, 0);
});

test("AI and residents cannot replace human verification or disease-control decisions", () => {
  const intake = ingestPublicHealthSurveillanceSignalToState(
    {},
    signalPayload(),
    { name: "医院公卫科", role: "medical-public-health" }
  );
  assert.throws(() => verifyPublicHealthSurveillanceSignalToState(intake.nextData, intake.signal.id, {
    decision: "confirmed",
    note: "模型自动确认",
    evidenceRefs: ["model-evidence"],
    idempotencyKey: "ai-forged-verification"
  }, { name: "AI模型", role: "system" }), /not allowed/);
  assert.throws(() => evaluatePublicHealthSurveillanceSignalToState(intake.nextData, intake.signal.id, {
    idempotencyKey: "evaluate-before-human"
  }, { name: "规则执行器", role: "system" }), /human-verified/);
});

test("signal and alert idempotency keys reject a different decision payload", () => {
  const intake = ingestPublicHealthSurveillanceSignalToState(
    {},
    signalPayload(),
    { name: "医院公卫科", role: "medical-public-health" }
  );
  const verificationPayload = {
    decision: "confirmed",
    note: "人工核实通过",
    evidenceRefs: ["manual-verification"],
    idempotencyKey: "bound-signal-verification",
    expectedVersion: 1
  };
  const verified = verifyPublicHealthSurveillanceSignalToState(
    intake.nextData,
    intake.signal.id,
    verificationPayload,
    { name: "疾控监测员", role: "cdc-surveillance" }
  );
  const replay = verifyPublicHealthSurveillanceSignalToState(
    verified.nextData,
    intake.signal.id,
    verificationPayload,
    { name: "疾控监测员", role: "cdc-surveillance" }
  );
  assert.equal(replay.idempotent, true);
  assert.throws(() => verifyPublicHealthSurveillanceSignalToState(
    verified.nextData,
    intake.signal.id,
    { ...verificationPayload, decision: "dismissed" },
    { name: "疾控监测员", role: "cdc-surveillance" }
  ), /payload conflict/);

  const evaluated = evaluatePublicHealthSurveillanceSignalToState(
    verified.nextData,
    verified.signal.id,
    { idempotencyKey: "bound-evaluation", expectedVersion: 2 },
    { name: "规则执行器", role: "system" }
  );
  const alertPayload = {
    action: "verify-alert",
    idempotencyKey: "bound-alert-verification",
    expectedVersion: 1,
    riskLevel: "high",
    conclusion: "人工研判确认",
    evidenceRefs: ["risk-evidence"]
  };
  const alertVerified = applyPublicHealthSurveillanceAlertActionToState(
    evaluated.nextData,
    evaluated.alert.id,
    alertPayload,
    { name: "疾控研判员", role: "cdc-surveillance" }
  );
  const alertReplay = applyPublicHealthSurveillanceAlertActionToState(
    alertVerified.nextData,
    evaluated.alert.id,
    alertPayload,
    { name: "疾控研判员", role: "cdc-surveillance" }
  );
  assert.equal(alertReplay.idempotent, true);
  assert.equal(alertReplay.nextData.publicHealthRiskAssessments.length, 1);
  assert.throws(() => applyPublicHealthSurveillanceAlertActionToState(
    alertVerified.nextData,
    evaluated.alert.id,
    { ...alertPayload, riskLevel: "low" },
    { name: "疾控研判员", role: "cdc-surveillance" }
  ), /payload conflict/);
});

test("surveillance workflow rejects persisted rule and source-verification tampering", () => {
  const evaluated = prepareAlert();
  const ruleTamperedData = JSON.parse(JSON.stringify(evaluated.nextData));
  ruleTamperedData.publicHealthSurveillanceAlerts[0].ruleDigest = "f".repeat(64);
  let center = buildPublicHealthSurveillanceCenter({ data: ruleTamperedData });
  assert.equal(center.ok, false);
  assert.equal(center.alertIntegrityFindings.some((item) => item.code === "alert-rule-binding-invalid"), true);
  assert.throws(() => applyPublicHealthSurveillanceAlertActionToState(
    ruleTamperedData,
    evaluated.alert.id,
    {
      action: "verify-alert",
      idempotencyKey: "tampered-rule-verification",
      expectedVersion: 1,
      riskLevel: "high",
      conclusion: "不应接受被改写的规则绑定",
      evidenceRefs: ["RISK-EVIDENCE"]
    },
    { name: "疾控研判员", role: "cdc-surveillance" }
  ), /alert integrity invalid: alert-rule-binding-invalid/);

  const verificationTamperedData = JSON.parse(JSON.stringify(evaluated.nextData));
  verificationTamperedData.publicHealthSurveillanceSignals[0].verification.role = "system";
  center = buildPublicHealthSurveillanceCenter({ data: verificationTamperedData });
  assert.equal(center.ok, false);
  assert.equal(center.dataFoundation.qualityFindings.some((item) => item.code === "human-verification-integrity-invalid"), true);
  assert.equal(center.alertIntegrityFindings.some((item) => item.code === "alert-source-signal-integrity-invalid"), true);
  assert.throws(() => applyPublicHealthSurveillanceAlertActionToState(
    verificationTamperedData,
    evaluated.alert.id,
    {
      action: "verify-alert",
      idempotencyKey: "tampered-source-verification",
      expectedVersion: 1,
      riskLevel: "high",
      conclusion: "不应接受伪造的人工核验",
      evidenceRefs: ["RISK-EVIDENCE"]
    },
    { name: "疾控研判员", role: "cdc-surveillance" }
  ), /alert integrity invalid: alert-source-signal-integrity-invalid/);
  assert.equal(center.productionReady, false);
});

test("signal evaluation rejects ungoverned thresholds and adopts only trusted activated versions", () => {
  const intake = ingestPublicHealthSurveillanceSignalToState(
    {},
    signalPayload(8, {
      externalSignalId: "EMR-SYNDROME-RULE-GOVERNANCE-001",
      idempotencyKey: "rule-governance-signal-intake-001"
    }),
    { name: "医院公卫科", role: "medical-public-health" }
  );
  const verified = verifyPublicHealthSurveillanceSignalToState(
    intake.nextData,
    intake.signal.id,
    {
      decision: "confirmed",
      note: "来源与口径已人工核实",
      evidenceRefs: ["RULE-GOVERNANCE-MANUAL-VERIFY-001"],
      idempotencyKey: "rule-governance-signal-verify-001",
      expectedVersion: 1
    },
    { name: "疾控监测员", role: "cdc-surveillance" }
  );
  const forgedData = {
    ...verified.nextData,
    publicHealthSurveillanceRules: [{
      id: "ph-rule-clinical-syndrome",
      version: 99,
      signalType: "clinical-syndrome",
      metricCode: "fever-respiratory-count",
      operator: ">=",
      threshold: 999,
      severity: "low",
      status: "active",
      owner: "客户端伪造"
    }]
  };
  assert.throws(() => evaluatePublicHealthSurveillanceSignalToState(
    forgedData,
    verified.signal.id,
    { idempotencyKey: "forged-rule-evaluation", expectedVersion: 2 },
    { name: "规则执行器", role: "system" }
  ), /rule registry integrity invalid: ungoverned-rule-materialization/);

  let governed = proposePublicHealthSurveillanceRuleChangeToState(
    verified.nextData,
    {
      ruleId: "ph-rule-clinical-syndrome",
      expectedCurrentVersion: 1,
      threshold: 10,
      severity: "high",
      status: "active",
      reason: "提高技术验收阈值以验证受控变更",
      evidenceRefs: ["RULE-GOVERNANCE-PROPOSAL-001"],
      idempotencyKey: "workflow-rule-submit-001"
    },
    { name: "疾控规则管理员", role: "cdc-surveillance" }
  );
  governed = reviewPublicHealthSurveillanceRuleChangeToState(
    governed.nextData,
    governed.change.id,
    {
      decision: "approved",
      note: "独立复核通过",
      evidenceRefs: ["RULE-GOVERNANCE-REVIEW-001"],
      idempotencyKey: "workflow-rule-review-001",
      expectedVersion: 1
    },
    { name: "委级复核员", role: "commission" }
  );
  governed = activatePublicHealthSurveillanceRuleChangeToState(
    governed.nextData,
    governed.change.id,
    {
      note: "服务端受控激活",
      evidenceRefs: ["RULE-GOVERNANCE-ACTIVATION-001"],
      idempotencyKey: "workflow-rule-activate-001",
      expectedVersion: 2
    },
    { name: "规则配置服务", role: "system" },
    { verificationSecret: RULE_GOVERNANCE_SECRET }
  );
  const evaluated = evaluatePublicHealthSurveillanceSignalToState(
    governed.nextData,
    verified.signal.id,
    { idempotencyKey: "trusted-rule-evaluation", expectedVersion: 2 },
    { name: "规则执行器", role: "system" },
    { verificationSecret: RULE_GOVERNANCE_SECRET }
  );
  assert.equal(evaluated.matched, false);
  assert.equal(evaluated.signal.lastRuleEvaluation.ruleVersion, 2);
  assert.equal(evaluated.signal.lastRuleEvaluation.threshold, 10);
  assert.equal(evaluated.productionReady, false);
});

test("historical alerts remain bound to their original trusted rule version", () => {
  const evaluated = prepareAlert();
  let governed = proposePublicHealthSurveillanceRuleChangeToState(
    evaluated.nextData,
    {
      ruleId: "ph-rule-clinical-syndrome",
      expectedCurrentVersion: 1,
      threshold: 10,
      severity: "high",
      status: "active",
      reason: "验证历史预警规则版本保留",
      evidenceRefs: ["HISTORICAL-RULE-PROPOSAL"],
      idempotencyKey: "historical-rule-submit"
    },
    { name: "疾控规则管理员", role: "cdc-surveillance" }
  );
  governed = reviewPublicHealthSurveillanceRuleChangeToState(
    governed.nextData,
    governed.change.id,
    {
      decision: "approved",
      note: "独立复核历史版本兼容性",
      evidenceRefs: ["HISTORICAL-RULE-REVIEW"],
      idempotencyKey: "historical-rule-review",
      expectedVersion: 1
    },
    { name: "委级复核员", role: "commission" }
  );
  governed = activatePublicHealthSurveillanceRuleChangeToState(
    governed.nextData,
    governed.change.id,
    {
      note: "服务端激活第二版规则",
      evidenceRefs: ["HISTORICAL-RULE-ACTIVATION"],
      idempotencyKey: "historical-rule-activate",
      expectedVersion: 2
    },
    { name: "规则配置服务", role: "system" },
    { verificationSecret: RULE_GOVERNANCE_SECRET }
  );
  const center = buildPublicHealthSurveillanceCenter({
    data: governed.nextData,
    ruleVerificationSecret: RULE_GOVERNANCE_SECRET
  });
  assert.equal(center.ok, true);
  assert.equal(center.alertIntegrityFindings.length, 0);
  assert.equal(center.alerts[0].version, 1);
  assert.equal(center.ruleGovernance.summary.ruleVersions, 9);
  assert.equal(center.ruleGovernance.rules.find((item) => item.id === "ph-rule-clinical-syndrome").version, 2);
  assert.equal(center.productionReady, false);
});
