"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  buildPublicHealthDataFoundation,
  buildPublicHealthDataSourceOperations,
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
  buildPublicHealthSurveillanceRuleGovernance,
  proposePublicHealthSurveillanceRuleChangeToState,
  reviewPublicHealthSurveillanceRuleChangeToState
} = require("../public-health-surveillance-rule-governance-service");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "public-health-modernization-readiness-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "public-health-modernization-readiness-report.md");
const RULE_GOVERNANCE_SECRET = "public-health-modernization-readiness-rule-secret-2026";
const RULE_GOVERNANCE_NEXT_SECRET = "public-health-modernization-readiness-next-secret-2026";
const RULE_GOVERNANCE_OLD_KEYRING = {
  purpose: "public-health-surveillance-rule-activation",
  activeKeyId: "readiness-rule-key-a",
  keys: [{
    keyId: "readiness-rule-key-a",
    secret: RULE_GOVERNANCE_SECRET,
    status: "active",
    notBefore: "2026-01-01T00:00:00.000Z",
    expiresAt: "2027-01-01T00:00:00.000Z",
    revokedAt: ""
  }]
};
const RULE_GOVERNANCE_ROTATED_KEYRING = {
  purpose: "public-health-surveillance-rule-activation",
  activeKeyId: "readiness-rule-key-b",
  keys: [
    { ...RULE_GOVERNANCE_OLD_KEYRING.keys[0], status: "grace" },
    {
      keyId: "readiness-rule-key-b",
      secret: RULE_GOVERNANCE_NEXT_SECRET,
      status: "active",
      notBefore: "2026-07-28T09:41:00.000Z",
      expiresAt: "2027-07-28T00:00:00.000Z",
      revokedAt: ""
    }
  ]
};

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

function runRuleGovernanceAcceptance(data) {
  let result = proposePublicHealthSurveillanceRuleChangeToState(data, {
    ruleId: "ph-rule-clinical-syndrome",
    expectedCurrentVersion: 1,
    threshold: 10,
    severity: "high",
    status: "active",
    reason: "readiness controlled threshold change",
    evidenceRefs: ["READINESS-RULE-PROPOSAL"],
    idempotencyKey: "readiness-rule-submit-001",
    at: "2026-07-28T09:35:00.000Z"
  }, { name: "readiness-rule-owner", role: "cdc-surveillance" });
  result = reviewPublicHealthSurveillanceRuleChangeToState(result.nextData, result.change.id, {
    decision: "approved",
    note: "readiness independent commission review",
    evidenceRefs: ["READINESS-RULE-REVIEW"],
    idempotencyKey: "readiness-rule-review-001",
    expectedVersion: 1,
    at: "2026-07-28T09:40:00.000Z"
  }, { name: "readiness-commission-reviewer", role: "commission" });
  return activatePublicHealthSurveillanceRuleChangeToState(result.nextData, result.change.id, {
    note: "readiness trusted server activation",
    evidenceRefs: ["READINESS-RULE-ACTIVATION"],
    idempotencyKey: "readiness-rule-activate-001",
    expectedVersion: 2,
    at: "2026-07-28T09:45:00.000Z"
  }, { name: "readiness-rule-service", role: "system" }, {
    activationKeyring: RULE_GOVERNANCE_OLD_KEYRING
  });
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
  const ruleGovernanceAcceptance = runRuleGovernanceAcceptance(alertResult.nextData);
  const ruleGovernance = buildPublicHealthSurveillanceRuleGovernance({
    data: ruleGovernanceAcceptance.nextData,
    activationKeyring: RULE_GOVERNANCE_ROTATED_KEYRING,
    at: "2026-07-28T09:50:00.000Z"
  });
  return {
    intake,
    verifiedSignal,
    evaluated,
    final: alertResult,
    ruleGovernanceAcceptance,
    ruleGovernance,
    dataFoundation: buildPublicHealthDataFoundation({ data: ruleGovernanceAcceptance.nextData }),
    sourceOperations: buildPublicHealthDataSourceOperations({
      data: ruleGovernanceAcceptance.nextData,
      now: "2026-07-28T08:10:00.000Z"
    }),
    surveillance: buildPublicHealthSurveillanceCenter({
      data: ruleGovernanceAcceptance.nextData,
      ruleActivationKeyring: RULE_GOVERNANCE_ROTATED_KEYRING
    })
  };
}

function buildPublicHealthModernizationReadiness(options = {}) {
  const acceptance = runPublicHealthModernizationAcceptance();
  const dataSource = options.dataSource ?? fs.readFileSync(path.join(ROOT, "public-health-data-foundation-service.js"), "utf8");
  const workflowSource = options.workflowSource ?? fs.readFileSync(path.join(ROOT, "public-health-surveillance-workflow-service.js"), "utf8");
  const ruleGovernanceSource = options.ruleGovernanceSource ?? fs.readFileSync(path.join(ROOT, "public-health-surveillance-rule-governance-service.js"), "utf8");
  const collaborationSource = options.collaborationSource ?? fs.readFileSync(path.join(ROOT, "public-health-medical-prevention-collaboration-service.js"), "utf8");
  const documentation = options.documentation ?? fs.readFileSync(path.join(ROOT, "docs", "public-health-fifteenth-plan-data-surveillance-medical-prevention.md"), "utf8");
  const serialized = JSON.stringify(acceptance.final.nextData);
  const checks = [
    check("data:source-registry", acceptance.dataFoundation.summary.sources === 8 && acceptance.dataFoundation.summary.registeredSources === 8, "8/8 planning data sources registered", "data"),
    check("data:catalog", acceptance.dataFoundation.summary.catalogEntries === 7, "7/7 public health data catalog entities available", "data"),
    check("data:lineage", acceptance.dataFoundation.summary.lineageAuditEntries === 1 && acceptance.dataFoundation.summary.qualityFindings === 0, "one minimized lineage record with zero quality findings", "data"),
    check("data:privacy-minimized", !serialized.includes("residentId") && !serialized.includes("READINESS-SYNDROME-20260728-001") && !serialized.includes("readiness-signal-intake-001"), "direct identifiers and raw source/idempotency keys are absent", "data"),
    check("data:quality-controls", ["unregistered-source", "invalid-observed-at", "duplicate-source-record", "direct-identifier-present"].every((token) => dataSource.includes(token)), "source, time, duplicate and direct-identifier controls are explicit", "data"),
    check("data:source-operations", acceptance.sourceOperations.summary.fresh === 1 && acceptance.sourceOperations.summary.noData === 7 && acceptance.sourceOperations.productionReady === false, "source operations distinguishes one fresh source from seven registered sources without observed data", "data"),
    check("surveillance:rule-registry", acceptance.surveillance.summary.rules === 8 && acceptance.surveillance.summary.activeRules === 8, "8/8 versioned multi-source rules active", "surveillance"),
    check("surveillance:trusted-rule-governance", acceptance.ruleGovernance.summary.trustedActivations === 1 && acceptance.ruleGovernance.summary.ruleVersions === 9 && acceptance.ruleGovernance.rules.find((item) => item.id === "ph-rule-clinical-syndrome")?.version === 2, "independent review and trusted server activation advances one rule while preserving version history", "surveillance"),
    check("surveillance:historical-rule-binding", acceptance.surveillance.summary.closedAlerts === 1 && acceptance.surveillance.summary.alertIntegrityFindings === 0 && acceptance.final.alert.ruleVersion === 1, "the version-1 closed alert remains verifiable after version 2 becomes active", "surveillance"),
    check("surveillance:human-verification", acceptance.verifiedSignal.signal.workflowState === "human-verified" && acceptance.evaluated.signal.workflowState === "alert-created", "human verification precedes rule evaluation", "surveillance"),
    check("surveillance:explainable-alert", acceptance.evaluated.alert.ruleVersion === 1 && acceptance.evaluated.alert.ruleDigest && acceptance.evaluated.alert.observedValue === 8 && acceptance.evaluated.alert.threshold === 5, "alert binds rule version, digest, observed value and threshold", "surveillance"),
    check("surveillance:human-risk-assessment", acceptance.surveillance.summary.humanRiskAssessments === 1 && acceptance.final.alert.assessment?.humanDecision === true, "one human risk assessment recorded", "surveillance"),
    check("surveillance:complete-workflow", acceptance.final.alert.status === "closed" && acceptance.final.alert.report?.receiptCode && acceptance.final.alert.feedback?.feedbackCode && acceptance.final.alert.closure, "alert completed investigation, official report, feedback and closure", "surveillance"),
    check("collaboration:medical-task", acceptance.surveillance.collaboration.summary.medicalPublicHealthTasks === 1, "one medical public-health task dispatched", "collaboration"),
    check("collaboration:primary-care-task", acceptance.surveillance.collaboration.summary.primaryCareTasks === 1, "one primary-care public-health task dispatched", "collaboration"),
    check("collaboration:closure-gate", acceptance.surveillance.collaboration.summary.closedTasks === 2 && workflowSource.includes("collaboration tasks must be closed before the alert"), "2/2 collaboration tasks closed before alert closure", "collaboration"),
    check("security:role-version-idempotency", ["expectedVersion", "idempotencyKeyHash", "payloadFingerprint", "validatePublicHealthSurveillanceAlert", "cdc-surveillance", "modelAdviceOnly"].every((token) => workflowSource.includes(token)) && ["ownerRole", "expectedVersion", "idempotencyKeyHash", "payloadFingerprint", "validatePublicHealthMedicalPreventionTask"].every((token) => collaborationSource.includes(token)), "roles, versions, payload-bound hashed idempotency, persisted-state integrity and AI advisory boundary are enforced", "security"),
    check("security:trusted-rule-activation", ["createHmac", "timingSafeEqual", "verificationSource", "signatureVerified", "signPublicHealthSurveillanceRuleActivationReceipt", "verifyPublicHealthSurveillanceRuleActivationReceipt", "ungoverned-rule-materialization"].every((token) => ruleGovernanceSource.includes(token)), "rule activation binds trust fields to a server receipt and rejects ungoverned materialization", "security"),
    check("security:managed-rule-keyring", acceptance.ruleGovernance.summary.managedKeyringReady === true && acceptance.ruleGovernance.keyring.activeKeyId === "readiness-rule-key-b" && acceptance.ruleGovernance.keyring.keys.some((item) => item.keyId === "readiness-rule-key-a" && item.status === "grace") && !JSON.stringify(acceptance.ruleGovernance).includes(RULE_GOVERNANCE_SECRET) && !JSON.stringify(acceptance.ruleGovernance).includes(RULE_GOVERNANCE_NEXT_SECRET) && ["selectSigningKey", "resolveVerificationKey", "summarizeKeyring"].every((token) => ruleGovernanceSource.includes(token)), "managed active/grace key rotation verifies history without exposing signing secrets", "security"),
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
      ruleVersions: acceptance.ruleGovernance.summary.ruleVersions,
      trustedRuleActivations: acceptance.ruleGovernance.summary.trustedActivations,
      managedRuleKeyringReady: acceptance.ruleGovernance.summary.managedKeyringReady,
      freshSources: acceptance.sourceOperations.summary.fresh,
      noDataSources: acceptance.sourceOperations.summary.noData,
      signals: acceptance.surveillance.summary.signals,
      alerts: acceptance.surveillance.summary.alerts,
      closedAlerts: acceptance.surveillance.summary.closedAlerts,
      collaborationTasks: acceptance.surveillance.summary.collaborationTasks,
      closedCollaborationTasks: acceptance.surveillance.summary.closedCollaborationTasks
    },
    checks,
    dataFoundation: acceptance.dataFoundation,
    dataSourceOperations: acceptance.sourceOperations,
    ruleGovernance: acceptance.ruleGovernance,
    surveillanceCenter: acceptance.surveillance,
    acceptance: {
      signalId: acceptance.intake.signal.id,
      alertId: acceptance.final.alert.id,
      alertState: acceptance.final.alert.status,
      alertVersion: acceptance.final.alert.version
    },
    remainingProductionBoundaries: [
      "Verify authoritative national/provincial source interfaces, data-sharing authorizations, official receipts, staffed review, medical-prevention handoffs, managed activation keys, approved production thresholds, controlled change windows, sustained source-quality observation, site evidence and launch approval."
    ],
    remainingT00Integration: [
      "Verify authoritative national/provincial source interfaces, data-sharing authorizations, official receipts, staffed review, medical-prevention handoffs, managed activation keys, approved production thresholds, controlled change windows, sustained source-quality observation, site evidence and launch approval."
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
    `- Surveillance rule versions: ${report.summary.ruleVersions}`,
    `- Trusted rule activations: ${report.summary.trustedRuleActivations}`,
    `- Managed rule keyring ready: ${report.summary.managedRuleKeyringReady ? "yes" : "no"}`,
    `- Fresh/no-data sources: ${report.summary.freshSources}/${report.summary.noDataSources}`,
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
