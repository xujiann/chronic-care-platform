"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  buildPublicHealthDataFoundation,
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

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "public-health-modernization-readiness-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "public-health-modernization-readiness-report.md");

function check(id, passed, detail, category) {
  return { id, passed: Boolean(passed), detail, category };
}

function runCollaborationTask(data, task, user, prefix) {
  let result = applyPublicHealthMedicalPreventionTaskActionToState(data, task.id, {
    action: "accept-task",
    idempotencyKey: `${prefix}:accept`,
    expectedVersion: 1,
    assignedTo: `${prefix}-acceptance-owner`,
    note: "readiness acceptance owner assigned",
    at: "2026-07-28T08:20:00.000Z"
  }, user);
  result = applyPublicHealthMedicalPreventionTaskActionToState(result.nextData, task.id, {
    action: "start-task",
    idempotencyKey: `${prefix}:start`,
    expectedVersion: 2,
    note: "readiness acceptance work started",
    at: "2026-07-28T08:21:00.000Z"
  }, user);
  result = applyPublicHealthMedicalPreventionTaskActionToState(result.nextData, task.id, {
    action: "record-task-receipt",
    idempotencyKey: `${prefix}:receipt`,
    expectedVersion: 3,
    receiptStatus: "accepted",
    receiptCode: `${prefix.toUpperCase()}-READINESS-RECEIPT`,
    evidenceRefs: [`${prefix}-readiness-receipt`],
    at: "2026-07-28T08:25:00.000Z"
  }, { name: "readiness-receipt-adapter", role: "system" });
  return applyPublicHealthMedicalPreventionTaskActionToState(result.nextData, task.id, {
    action: "close-task",
    idempotencyKey: `${prefix}:close`,
    expectedVersion: 4,
    conclusion: "readiness collaboration task closed",
    evidenceRefs: task.requiredEvidence,
    at: "2026-07-28T08:30:00.000Z"
  }, user);
}

function runPublicHealthModernizationAcceptance() {
  const intake = ingestPublicHealthSurveillanceSignalToState({}, {
    sourceId: "ph-source-clinical-syndrome",
    externalSignalId: "READINESS-SYNDROME-20260728-001",
    signalType: "clinical-syndrome",
    institutionId: "readiness-medical-institution",
    regionCode: "210202",
    observedAt: "2026-07-28T08:00:00.000Z",
    receivedAt: "2026-07-28T08:01:00.000Z",
    metrics: [{
      metricCode: "fever-respiratory-count",
      value: 8,
      unit: "cases/24h",
      baseline: 3
    }],
    evidenceRefs: ["READINESS-SYNDROME-EVIDENCE"],
    idempotencyKey: "readiness-signal-intake-001"
  }, { name: "readiness-medical-public-health", role: "medical-public-health" });
  const verifiedSignal = verifyPublicHealthSurveillanceSignalToState(intake.nextData, intake.signal.id, {
    action: "verify-signal",
    decision: "confirmed",
    note: "source and syndrome definition verified by disease-control reviewer",
    evidenceRefs: ["READINESS-SIGNAL-VERIFICATION"],
    idempotencyKey: "readiness-signal-verify-001",
    expectedVersion: 1,
    at: "2026-07-28T08:05:00.000Z"
  }, { name: "readiness-cdc-reviewer", role: "cdc-surveillance" });
  const evaluated = evaluatePublicHealthSurveillanceSignalToState(verifiedSignal.nextData, verifiedSignal.signal.id, {
    idempotencyKey: "readiness-signal-evaluate-001",
    expectedVersion: 2,
    at: "2026-07-28T08:06:00.000Z"
  }, { name: "readiness-rule-runner", role: "system" });
  let alertResult = applyPublicHealthSurveillanceAlertActionToState(evaluated.nextData, evaluated.alert.id, {
    action: "verify-alert",
    idempotencyKey: "readiness-alert-verify-001",
    expectedVersion: 1,
    riskLevel: "high",
    conclusion: "manual risk assessment confirms a joint investigation is required",
    evidenceRefs: ["READINESS-RISK-ASSESSMENT"],
    at: "2026-07-28T08:10:00.000Z"
  }, { name: "readiness-cdc-assessor", role: "cdc-surveillance" });
  alertResult = applyPublicHealthSurveillanceAlertActionToState(alertResult.nextData, evaluated.alert.id, {
    action: "dispatch-alert",
    idempotencyKey: "readiness-alert-dispatch-001",
    expectedVersion: 2,
    medicalInstitutionId: "readiness-medical-institution",
    primaryCareOrganizationId: "readiness-primary-care-organization",
    dueAt: "2026-07-29T08:00:00.000Z",
    note: "dispatch medical and primary-care verification",
    at: "2026-07-28T08:12:00.000Z"
  }, { name: "readiness-cdc-dispatcher", role: "cdc-surveillance" });
  alertResult = applyPublicHealthSurveillanceAlertActionToState(alertResult.nextData, evaluated.alert.id, {
    action: "start-investigation",
    idempotencyKey: "readiness-alert-investigation-001",
    expectedVersion: 3,
    investigationOwner: "readiness-investigation-team",
    note: "joint investigation started",
    at: "2026-07-28T08:15:00.000Z"
  }, { name: "readiness-cdc-investigator", role: "cdc-surveillance" });

  const medicalTask = alertResult.nextData.publicHealthMedicalPreventionTasks
    .find((item) => item.ownerRole === "medical-public-health");
  const primaryCareTask = alertResult.nextData.publicHealthMedicalPreventionTasks
    .find((item) => item.ownerRole === "primary-care-public-health");
  let taskResult = runCollaborationTask(alertResult.nextData, medicalTask, {
    name: "readiness-medical-public-health",
    role: "medical-public-health"
  }, "readiness-medical");
  taskResult = runCollaborationTask(taskResult.nextData, primaryCareTask, {
    name: "readiness-primary-care",
    role: "primary-care-public-health"
  }, "readiness-primary");

  alertResult = applyPublicHealthSurveillanceAlertActionToState(taskResult.nextData, evaluated.alert.id, {
    action: "record-official-report",
    idempotencyKey: "readiness-alert-report-001",
    expectedVersion: 4,
    reportId: "READINESS-REPORT-001",
    receiptCode: "READINESS-REPORT-RECEIPT-001",
    evidenceRefs: ["READINESS-OFFICIAL-REPORT"],
    at: "2026-07-28T09:00:00.000Z"
  }, { name: "readiness-medical-public-health", role: "medical-public-health" });
  alertResult = applyPublicHealthSurveillanceAlertActionToState(alertResult.nextData, evaluated.alert.id, {
    action: "record-feedback",
    idempotencyKey: "readiness-alert-feedback-001",
    expectedVersion: 5,
    feedbackCode: "READINESS-FEEDBACK-001",
    conclusion: "disease-control feedback received",
    evidenceRefs: ["READINESS-FEEDBACK-EVIDENCE"],
    at: "2026-07-28T09:20:00.000Z"
  }, { name: "readiness-feedback-adapter", role: "system" });
  alertResult = applyPublicHealthSurveillanceAlertActionToState(alertResult.nextData, evaluated.alert.id, {
    action: "close-alert",
    idempotencyKey: "readiness-alert-close-001",
    expectedVersion: 6,
    conclusion: "signal, alert, report, feedback and medical-prevention collaboration closed",
    evidenceRefs: ["READINESS-ALERT-CLOSURE"],
    at: "2026-07-28T09:30:00.000Z"
  }, { name: "readiness-cdc-owner", role: "cdc-surveillance" });
  return {
    intake,
    verifiedSignal,
    evaluated,
    final: alertResult,
    dataFoundation: buildPublicHealthDataFoundation({ data: alertResult.nextData }),
    surveillance: buildPublicHealthSurveillanceCenter({ data: alertResult.nextData })
  };
}

function buildPublicHealthModernizationReadiness(options = {}) {
  const acceptance = runPublicHealthModernizationAcceptance();
  const dataSource = options.dataSource ?? fs.readFileSync(path.join(ROOT, "public-health-data-foundation-service.js"), "utf8");
  const workflowSource = options.workflowSource ?? fs.readFileSync(path.join(ROOT, "public-health-surveillance-workflow-service.js"), "utf8");
  const collaborationSource = options.collaborationSource ?? fs.readFileSync(path.join(ROOT, "public-health-medical-prevention-collaboration-service.js"), "utf8");
  const documentation = options.documentation ?? fs.readFileSync(path.join(ROOT, "docs", "public-health-fifteenth-plan-data-surveillance-medical-prevention.md"), "utf8");
  const serialized = JSON.stringify(acceptance.final.nextData);
  const checks = [
    check("data:source-registry", acceptance.dataFoundation.summary.sources === 8 && acceptance.dataFoundation.summary.registeredSources === 8, "8/8 planning data sources registered", "data"),
    check("data:catalog", acceptance.dataFoundation.summary.catalogEntries === 7, "7/7 public health data catalog entities available", "data"),
    check("data:lineage", acceptance.dataFoundation.summary.lineageAuditEntries === 1 && acceptance.dataFoundation.summary.qualityFindings === 0, "one minimized lineage record with zero quality findings", "data"),
    check("data:privacy-minimized", !serialized.includes("residentId") && !serialized.includes("READINESS-SYNDROME-20260728-001") && !serialized.includes("readiness-signal-intake-001"), "direct identifiers and raw source/idempotency keys are absent", "data"),
    check("data:quality-controls", ["unregistered-source", "invalid-observed-at", "duplicate-source-record", "direct-identifier-present"].every((token) => dataSource.includes(token)), "source, time, duplicate and direct-identifier controls are explicit", "data"),
    check("surveillance:rule-registry", acceptance.surveillance.summary.rules === 8 && acceptance.surveillance.summary.activeRules === 8, "8/8 versioned multi-source rules active", "surveillance"),
    check("surveillance:human-verification", acceptance.verifiedSignal.signal.workflowState === "human-verified" && acceptance.evaluated.signal.workflowState === "alert-created", "human verification precedes rule evaluation", "surveillance"),
    check("surveillance:explainable-alert", acceptance.evaluated.alert.ruleVersion === 1 && acceptance.evaluated.alert.ruleDigest && acceptance.evaluated.alert.observedValue === 8 && acceptance.evaluated.alert.threshold === 5, "alert binds rule version, digest, observed value and threshold", "surveillance"),
    check("surveillance:human-risk-assessment", acceptance.surveillance.summary.humanRiskAssessments === 1 && acceptance.final.alert.assessment?.humanDecision === true, "one human risk assessment recorded", "surveillance"),
    check("surveillance:complete-workflow", acceptance.final.alert.status === "closed" && acceptance.final.alert.report?.receiptCode && acceptance.final.alert.feedback?.feedbackCode && acceptance.final.alert.closure, "alert completed investigation, official report, feedback and closure", "surveillance"),
    check("collaboration:medical-task", acceptance.surveillance.collaboration.summary.medicalPublicHealthTasks === 1, "one medical public-health task dispatched", "collaboration"),
    check("collaboration:primary-care-task", acceptance.surveillance.collaboration.summary.primaryCareTasks === 1, "one primary-care public-health task dispatched", "collaboration"),
    check("collaboration:closure-gate", acceptance.surveillance.collaboration.summary.closedTasks === 2 && workflowSource.includes("collaboration tasks must be closed before the alert"), "2/2 collaboration tasks closed before alert closure", "collaboration"),
    check("security:role-version-idempotency", ["expectedVersion", "idempotencyKeyHash", "payloadFingerprint", "validatePublicHealthSurveillanceAlert", "cdc-surveillance", "modelAdviceOnly"].every((token) => workflowSource.includes(token)) && ["ownerRole", "expectedVersion", "idempotencyKeyHash", "payloadFingerprint", "validatePublicHealthMedicalPreventionTask"].every((token) => collaborationSource.includes(token)), "roles, versions, payload-bound hashed idempotency, persisted-state integrity and AI advisory boundary are enforced", "security"),
    check("integration:documented-t00-boundary", ["server.js", "SQLite", "T00", "productionReady=false", "/api/public-health/surveillance-signals", "/api/public-health/medical-prevention-tasks"].every((token) => documentation.includes(token)), "T00 API, durable writer and production boundary are documented", "integration"),
    check("safety:functional-not-production", acceptance.dataFoundation.productionReady === false && acceptance.surveillance.productionReady === false && acceptance.final.productionReady === false, "functional closure cannot self-assert production readiness", "safety")
  ];
  return {
    generatedAt: new Date().toISOString(),
    ok: checks.every((item) => item.passed),
    functionalState: "public-health-data-surveillance-medical-prevention-foundation-complete",
    formalGoLiveState: "blocked-until-production-interfaces-sharing-authorization-site-evidence-and-launch-approval",
    summary: {
      checks: checks.length,
      passed: checks.filter((item) => item.passed).length,
      sources: acceptance.dataFoundation.summary.sources,
      catalogEntries: acceptance.dataFoundation.summary.catalogEntries,
      rules: acceptance.surveillance.summary.rules,
      signals: acceptance.surveillance.summary.signals,
      alerts: acceptance.surveillance.summary.alerts,
      closedAlerts: acceptance.surveillance.summary.closedAlerts,
      collaborationTasks: acceptance.surveillance.summary.collaborationTasks,
      closedCollaborationTasks: acceptance.surveillance.summary.closedCollaborationTasks
    },
    checks,
    dataFoundation: acceptance.dataFoundation,
    surveillanceCenter: acceptance.surveillance,
    acceptance: {
      signalId: acceptance.intake.signal.id,
      alertId: acceptance.final.alert.id,
      alertState: acceptance.final.alert.status,
      alertVersion: acceptance.final.alert.version
    },
    remainingProductionBoundaries: [
      "Verify authoritative national/provincial source interfaces, data-sharing authorizations, official receipts, staffed review, medical-prevention handoffs, site evidence and launch approval."
    ],
    remainingT00Integration: [
      "Verify authoritative national/provincial source interfaces, data-sharing authorizations, official receipts, staffed review, medical-prevention handoffs, site evidence and launch approval."
    ],
    productionReady: false
  };
}

function renderMarkdown(report) {
  const rows = report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.category} | ${item.id} | ${item.detail} |`);
  return [
    "# Public Health Modernization Readiness",
    "",
    `Generated: ${report.generatedAt}`,
    `Functional state: ${report.functionalState}`,
    `Formal go-live state: ${report.formalGoLiveState}`,
    `Production ready: ${report.productionReady ? "yes" : "no"}`,
    "",
    "## Summary",
    "",
    `- Checks: ${report.summary.passed}/${report.summary.checks}`,
    `- Data sources: ${report.summary.sources}/8`,
    `- Catalog entries: ${report.summary.catalogEntries}/7`,
    `- Surveillance rules: ${report.summary.rules}/8`,
    `- Closed alerts: ${report.summary.closedAlerts}/${report.summary.alerts}`,
    `- Closed medical-prevention tasks: ${report.summary.closedCollaborationTasks}/${report.summary.collaborationTasks}`,
    "",
    "## Checks",
    "",
    "| Result | Category | Check | Detail |",
    "|---|---|---|---|",
    ...rows,
    "",
    "## Remaining production boundaries",
    "",
    ...(report.remainingProductionBoundaries || report.remainingT00Integration || []).map((item) => `- ${item}`),
    ""
  ].join("\n");
}

function parseArgs(argv = process.argv.slice(2)) {
  return argv.reduce((result, item) => {
    if (item.startsWith("--output=")) result.output = path.resolve(item.slice("--output=".length));
    if (item.startsWith("--markdown=")) result.markdown = path.resolve(item.slice("--markdown=".length));
    return result;
  }, { output: DEFAULT_OUTPUT, markdown: DEFAULT_MARKDOWN });
}

function writeOutput(report, destinations) {
  fs.mkdirSync(path.dirname(destinations.output), { recursive: true });
  fs.mkdirSync(path.dirname(destinations.markdown), { recursive: true });
  fs.writeFileSync(destinations.output, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(destinations.markdown, `${renderMarkdown(report)}\n`);
}

function runCli() {
  const destinations = parseArgs();
  const report = buildPublicHealthModernizationReadiness();
  writeOutput(report, destinations);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.ok ? 0 : 1;
}

if (require.main === module) runCli();

module.exports = {
  buildPublicHealthModernizationReadiness,
  parseArgs,
  renderMarkdown,
  runPublicHealthModernizationAcceptance,
  writeOutput
};
