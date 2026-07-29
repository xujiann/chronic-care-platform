"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
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
const {
  buildPublicHealthSurveillanceModelGovernance,
  reviewPublicHealthSurveillanceModelValidationToState,
  runPublicHealthSurveillanceModelToState,
  submitPublicHealthSurveillanceModelValidationToState
} = require("../public-health-surveillance-model-governance-service");
const {
  RESPIRATORY_PANEL,
  RESPIRATORY_PATHOGENS,
  buildPublicHealthRespiratoryPathogenSurveillance,
  ingestPublicHealthRespiratoryPathogenBatchToState,
  publishPublicHealthRespiratoryPathogenSignalsToState,
  verifyPublicHealthRespiratoryPathogenBatchToState
} = require("../public-health-respiratory-pathogen-surveillance-service");
const {
  REQUIRED_RESPIRATORY_NETWORK_EVIDENCE,
  RESPIRATORY_NETWORK_EVIDENCE_PURPOSE,
  buildPublicHealthRespiratoryNetworkReadiness,
  issueTrustedRespiratoryNetworkEvidenceReceipt
} = require("../public-health-respiratory-network-readiness-service");

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
const RESPIRATORY_EVIDENCE_KEYRING = {
  purpose: RESPIRATORY_NETWORK_EVIDENCE_PURPOSE,
  activeKeyId: "readiness-respiratory-evidence-2026-07",
  keys: [{
    keyId: "readiness-respiratory-evidence-2026-07",
    secret: "readiness-respiratory-network-evidence-secret-2026-07",
    status: "active",
    notBefore: "2026-07-01T00:00:00.000Z",
    expiresAt: "2027-01-01T00:00:00.000Z",
    revokedAt: ""
  }]
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

function readinessRespiratoryResults(specimenCount) {
  const positives = new Map([
    ["influenza-a", 4],
    ["rsv", 3],
    ["mycoplasma-pneumoniae", 2]
  ]);
  return RESPIRATORY_PATHOGENS.map((item) => ({
    pathogenCode: item.code,
    testedSpecimens: specimenCount,
    positiveSpecimens: positives.get(item.code) || 0
  }));
}

function runRespiratoryPathogenAcceptance(data) {
  const basePayload = {
    sourceId: "ph-source-laboratory-pathogen",
    panelId: RESPIRATORY_PANEL.id,
    panelVersion: RESPIRATORY_PANEL.version,
    regionCode: "210202",
    specimenCount: 20,
    results: readinessRespiratoryResults(20)
  };
  const child = ingestPublicHealthRespiratoryPathogenBatchToState(data, {
    ...basePayload,
    externalBatchId: "READINESS-RESPIRATORY-CHILD-BATCH-001",
    institutionId: "readiness-respiratory-laboratory-child",
    observedAt: "2026-07-28T07:50:00.000Z",
    receivedAt: "2026-07-28T07:51:00.000Z",
    ageGroup: "child",
    placeType: "school",
    evidenceRefs: ["READINESS-RESPIRATORY-CHILD-PANEL", "READINESS-RESPIRATORY-CHILD-QC"],
    idempotencyKey: "readiness-respiratory-child-intake"
  }, { name: "readiness-respiratory-laboratory-child", role: "laboratory" });
  const olderAdult = ingestPublicHealthRespiratoryPathogenBatchToState(child.nextData, {
    ...basePayload,
    externalBatchId: "READINESS-RESPIRATORY-OLDER-BATCH-001",
    institutionId: "readiness-respiratory-laboratory-older",
    observedAt: "2026-07-28T07:55:00.000Z",
    receivedAt: "2026-07-28T07:56:00.000Z",
    ageGroup: "older-adult",
    placeType: "elderly-care",
    evidenceRefs: ["READINESS-RESPIRATORY-OLDER-PANEL", "READINESS-RESPIRATORY-OLDER-QC"],
    idempotencyKey: "readiness-respiratory-older-intake"
  }, { name: "readiness-respiratory-laboratory-older", role: "laboratory" });
  const verified = verifyPublicHealthRespiratoryPathogenBatchToState(
    olderAdult.nextData,
    child.batch.id,
    {
      decision: "confirmed",
      note: "readiness panel, aggregate counts and quality evidence verified",
      evidenceRefs: ["READINESS-RESPIRATORY-HUMAN-VERIFICATION"],
      idempotencyKey: "readiness-respiratory-child-verify",
      expectedVersion: 1,
      at: "2026-07-28T09:33:30.000Z"
    },
    { name: "readiness-respiratory-cdc-reviewer", role: "cdc-surveillance" }
  );
  const published = publishPublicHealthRespiratoryPathogenSignalsToState(
    verified.nextData,
    child.batch.id,
    {
      note: "readiness positive pathogens published as minimized signals",
      evidenceRefs: ["READINESS-RESPIRATORY-SIGNAL-PUBLICATION"],
      idempotencyKey: "readiness-respiratory-child-publish",
      expectedVersion: 2,
      at: "2026-07-28T09:34:00.000Z"
    },
    { name: "readiness-respiratory-signal-service", role: "system" }
  );
  return {
    child,
    olderAdult,
    verified,
    published,
    board: buildPublicHealthRespiratoryPathogenSurveillance({
      data: published.nextData,
      at: "2026-07-28T09:34:30.000Z"
    })
  };
}

function runRespiratoryNetworkReadinessAcceptance(data) {
  let nextData = data;
  const institutions = [
    { id: "readiness-respiratory-laboratory-child", ageGroup: "child", placeType: "school", minute: "50" },
    { id: "readiness-respiratory-laboratory-older", ageGroup: "older-adult", placeType: "elderly-care", minute: "55" }
  ];
  for (const institution of institutions) {
    for (const day of [27, 29]) {
      const intake = ingestPublicHealthRespiratoryPathogenBatchToState(nextData, {
        sourceId: "ph-source-laboratory-pathogen",
        externalBatchId: `READINESS-RESPIRATORY-CONTINUITY-${institution.ageGroup}-202607${day}`,
        panelId: RESPIRATORY_PANEL.id,
        panelVersion: RESPIRATORY_PANEL.version,
        institutionId: institution.id,
        regionCode: "210202",
        observedAt: `2026-07-${day}T07:${institution.minute}:00.000Z`,
        receivedAt: `2026-07-${day}T08:01:00.000Z`,
        specimenCount: 20,
        ageGroup: institution.ageGroup,
        placeType: institution.placeType,
        results: readinessRespiratoryResults(20),
        evidenceRefs: [`READINESS-RESPIRATORY-CONTINUITY-QC-${institution.ageGroup}-${day}`],
        idempotencyKey: `readiness-respiratory-continuity-intake-${institution.ageGroup}-${day}`
      }, { name: institution.id, role: "laboratory" });
      const verified = verifyPublicHealthRespiratoryPathogenBatchToState(intake.nextData, intake.batch.id, {
        decision: "confirmed",
        note: "readiness continuity window panel and quality evidence verified",
        evidenceRefs: [`READINESS-RESPIRATORY-CONTINUITY-VERIFY-${institution.ageGroup}-${day}`],
        idempotencyKey: `readiness-respiratory-continuity-verify-${institution.ageGroup}-${day}`,
        expectedVersion: 1,
        at: `2026-07-${day}T08:20:00.000Z`
      }, { name: "readiness-respiratory-cdc-reviewer", role: "cdc-surveillance" });
      nextData = verified.nextData;
    }
  }
  const olderBaseline = (nextData.publicHealthRespiratoryPathogenBatches || []).find((item) =>
    item.institutionId === "readiness-respiratory-laboratory-older" && item.observedAt === "2026-07-28T07:55:00.000Z"
  );
  const olderBaselineVerified = verifyPublicHealthRespiratoryPathogenBatchToState(nextData, olderBaseline.id, {
    decision: "confirmed",
    note: "readiness baseline older-adult panel and quality evidence verified",
    evidenceRefs: ["READINESS-RESPIRATORY-OLDER-BASELINE-VERIFY"],
    idempotencyKey: "readiness-respiratory-older-baseline-verify",
    expectedVersion: 1,
    at: "2026-07-28T09:36:00.000Z"
  }, { name: "readiness-respiratory-cdc-reviewer", role: "cdc-surveillance" });
  nextData = olderBaselineVerified.nextData;
  const evidenceRecords = institutions.flatMap((institution, institutionIndex) => REQUIRED_RESPIRATORY_NETWORK_EVIDENCE.map((requirement, requirementIndex) => {
    const evidenceIndex = institutionIndex * REQUIRED_RESPIRATORY_NETWORK_EVIDENCE.length + requirementIndex + 1;
    const digest = createHash("sha256").update(`readiness-respiratory-artifact:${institution.id}:${requirement.type}`).digest("hex");
    return issueTrustedRespiratoryNetworkEvidenceReceipt({
      id: `readiness-respiratory-network-evidence-${String(evidenceIndex).padStart(2, "0")}`,
      institutionId: institution.id,
      evidenceType: requirement.type,
      panelId: RESPIRATORY_PANEL.id,
      panelVersion: RESPIRATORY_PANEL.version,
      status: "verified",
      artifactName: `${institution.ageGroup}-${requirement.type}.pdf`,
      artifactDigest: digest,
      validFrom: "2026-07-01T00:00:00.000Z",
      expiresAt: "2026-12-31T23:59:59.999Z"
    }, {
      signedBy: `readiness-external-owner:${institution.id}:${requirement.type}`,
      verifiedBy: "readiness-server-evidence-verifier",
      verifiedAt: "2026-07-29T10:00:00.000Z",
      signatureVerified: true,
      receiptId: `readiness-respiratory-network-receipt-${String(evidenceIndex).padStart(2, "0")}`
    }, RESPIRATORY_EVIDENCE_KEYRING);
  }));
  return {
    nextData,
    evidenceRecords,
    board: buildPublicHealthRespiratoryNetworkReadiness({
      data: nextData,
      evidenceRecords,
      keyring: RESPIRATORY_EVIDENCE_KEYRING,
      at: "2026-07-29T12:00:00.000Z"
    })
  };
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
  const modelRun = runPublicHealthSurveillanceModelToState(
    alertResult.nextData,
    "ph-model-baseline-deviation",
    {
      expectedModelVersion: 1,
      signalIds: [evaluated.signal.id],
      windowStart: "2026-07-28T08:00:00.000Z",
      windowEnd: "2026-07-28T09:31:00.000Z",
      evidenceRefs: ["READINESS-MODEL-DATASET-SNAPSHOT"],
      idempotencyKey: "readiness-model-run-001",
      at: "2026-07-28T09:31:00.000Z"
    },
    { name: "readiness-shadow-model-runner", role: "system" }
  );
  const submittedModelValidation = submitPublicHealthSurveillanceModelValidationToState(
    modelRun.nextData,
    "ph-model-baseline-deviation",
    {
      expectedModelVersion: 1,
      sampleWindowStart: "2026-07-01T00:00:00.000Z",
      sampleWindowEnd: "2026-07-27T23:59:59.000Z",
      sampleSize: 120,
      sensitivity: 0.91,
      positivePredictiveValue: 0.72,
      falseNegativeRate: 0.07,
      note: "readiness retrospective model performance validation",
      evidenceRefs: ["READINESS-MODEL-VALIDATION-DATASET", "READINESS-MODEL-VALIDATION-REPORT"],
      idempotencyKey: "readiness-model-validation-submit-001",
      at: "2026-07-28T09:32:00.000Z"
    },
    { name: "readiness-model-owner", role: "cdc-surveillance" }
  );
  const reviewedModelValidation = reviewPublicHealthSurveillanceModelValidationToState(
    submittedModelValidation.nextData,
    submittedModelValidation.validation.id,
    {
      decision: "approved",
      note: "independent review approves continued shadow-only use",
      evidenceRefs: ["READINESS-MODEL-INDEPENDENT-REVIEW"],
      idempotencyKey: "readiness-model-validation-review-001",
      expectedVersion: 1,
      at: "2026-07-28T09:33:00.000Z"
    },
    { name: "readiness-commission-model-reviewer", role: "commission" }
  );
  const modelGovernance = buildPublicHealthSurveillanceModelGovernance({
    data: reviewedModelValidation.nextData,
    at: "2026-07-28T09:34:00.000Z"
  });
  const respiratoryAcceptance = runRespiratoryPathogenAcceptance(reviewedModelValidation.nextData);
  const respiratoryNetworkReadinessAcceptance = runRespiratoryNetworkReadinessAcceptance(respiratoryAcceptance.published.nextData);
  const ruleGovernanceAcceptance = runRuleGovernanceAcceptance(respiratoryAcceptance.published.nextData);
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
    modelRun,
    submittedModelValidation,
    reviewedModelValidation,
    modelGovernance,
    respiratoryAcceptance,
    respiratoryNetworkReadinessAcceptance,
    ruleGovernanceAcceptance,
    ruleGovernance,
    dataFoundation: buildPublicHealthDataFoundation({ data: ruleGovernanceAcceptance.nextData }),
    sourceOperations: buildPublicHealthDataSourceOperations({
      data: ruleGovernanceAcceptance.nextData,
      now: "2026-07-28T08:10:00.000Z"
    }),
    surveillance: buildPublicHealthSurveillanceCenter({
      data: ruleGovernanceAcceptance.nextData,
      ruleActivationKeyring: RULE_GOVERNANCE_ROTATED_KEYRING,
      modelGovernanceAt: "2026-07-28T09:50:00.000Z",
      respiratorySurveillanceAt: "2026-07-28T09:50:00.000Z"
    })
  };
}

function buildPublicHealthModernizationReadiness(options = {}) {
  const acceptance = runPublicHealthModernizationAcceptance();
  const dataSource = options.dataSource ?? fs.readFileSync(path.join(ROOT, "public-health-data-foundation-service.js"), "utf8");
  const workflowSource = options.workflowSource ?? fs.readFileSync(path.join(ROOT, "public-health-surveillance-workflow-service.js"), "utf8");
  const ruleGovernanceSource = options.ruleGovernanceSource ?? fs.readFileSync(path.join(ROOT, "public-health-surveillance-rule-governance-service.js"), "utf8");
  const modelGovernanceSource = options.modelGovernanceSource ?? fs.readFileSync(path.join(ROOT, "public-health-surveillance-model-governance-service.js"), "utf8");
  const respiratorySource = options.respiratorySource ?? fs.readFileSync(path.join(ROOT, "public-health-respiratory-pathogen-surveillance-service.js"), "utf8");
  const respiratoryNetworkReadinessSource = options.respiratoryNetworkReadinessSource ?? fs.readFileSync(path.join(ROOT, "public-health-respiratory-network-readiness-service.js"), "utf8");
  const collaborationSource = options.collaborationSource ?? fs.readFileSync(path.join(ROOT, "public-health-medical-prevention-collaboration-service.js"), "utf8");
  const documentation = options.documentation ?? fs.readFileSync(path.join(ROOT, "docs", "public-health-fifteenth-plan-data-surveillance-medical-prevention.md"), "utf8");
  const serialized = JSON.stringify(acceptance.final.nextData);
  const checks = [
    check("data:source-registry", acceptance.dataFoundation.summary.sources === 8 && acceptance.dataFoundation.summary.registeredSources === 8, "8/8 planning data sources registered", "data"),
    check("data:catalog", acceptance.dataFoundation.summary.catalogEntries === 7, "7/7 public health data catalog entities available", "data"),
    check("data:lineage", acceptance.dataFoundation.summary.lineageAuditEntries === 4 && acceptance.dataFoundation.summary.qualityFindings === 0, "four minimized lineage records with zero quality findings", "data"),
    check("data:privacy-minimized", !serialized.includes("residentId") && !serialized.includes("READINESS-SYNDROME-20260728-001") && !serialized.includes("readiness-signal-intake-001"), "direct identifiers and raw source/idempotency keys are absent", "data"),
    check("data:quality-controls", ["unregistered-source", "invalid-observed-at", "duplicate-source-record", "direct-identifier-present"].every((token) => dataSource.includes(token)), "source, time, duplicate and direct-identifier controls are explicit", "data"),
    check("data:source-operations", acceptance.sourceOperations.summary.fresh === 2 && acceptance.sourceOperations.summary.noData === 6 && acceptance.sourceOperations.productionReady === false, "source operations distinguishes two fresh sources from six registered sources without observed data", "data"),
    check("surveillance:rule-registry", acceptance.surveillance.summary.rules === 8 && acceptance.surveillance.summary.activeRules === 8, "8/8 versioned multi-source rules active", "surveillance"),
    check("surveillance:trusted-rule-governance", acceptance.ruleGovernance.summary.trustedActivations === 1 && acceptance.ruleGovernance.summary.ruleVersions === 9 && acceptance.ruleGovernance.rules.find((item) => item.id === "ph-rule-clinical-syndrome")?.version === 2, "independent review and trusted server activation advances one rule while preserving version history", "surveillance"),
    check("surveillance:model-registry", acceptance.modelGovernance.summary.models === 3 && acceptance.modelGovernance.summary.shadowModels === 3, "3/3 versioned surveillance models are registered for shadow-only use", "surveillance"),
    check("surveillance:model-shadow-run", acceptance.modelGovernance.summary.modelRuns === 1 && acceptance.modelRun.run.output.modelAdviceOnly === true && acceptance.modelRun.run.output.humanDecisionRequired === true && acceptance.modelRun.run.output.alertCreated === false, "one explainable model observation remains advisory and creates no alert", "surveillance"),
    check("surveillance:model-independent-validation", acceptance.modelGovernance.summary.validatedShadowModels === 1 && acceptance.modelGovernance.summary.driftReviewsDue === 0 && acceptance.reviewedModelValidation.validation.status === "validated-shadow", "independent performance review validates one model only for time-bounded shadow use", "surveillance"),
    check("surveillance:respiratory-pathogen-catalog", acceptance.respiratoryAcceptance.board.summary.catalogPathogens === 18 && acceptance.respiratoryAcceptance.board.summary.planningMinimumPathogens === 15, "18 respiratory pathogens exceed the planning target of more than 15 pathogens", "surveillance"),
    check("surveillance:one-sample-multi-test", acceptance.respiratoryAcceptance.board.summary.observedPathogens === 18 && acceptance.respiratoryAcceptance.board.summary.oneSampleMultiTestBatches === 2 && acceptance.respiratoryAcceptance.board.summary.planningCoverageReady === true, "two aggregate sentinel batches prove one-sample multi-pathogen planning coverage", "surveillance"),
    check("surveillance:old-young-priority-places", acceptance.respiratoryAcceptance.board.summary.childBatches === 1 && acceptance.respiratoryAcceptance.board.summary.olderAdultBatches === 1 && acceptance.respiratoryAcceptance.board.summary.priorityPlaceBatches === 2, "child and older-adult surveillance covers school and elderly-care priority places", "surveillance"),
    check("surveillance:respiratory-minimized-signal-publication", acceptance.respiratoryAcceptance.board.summary.publishedSignals === 3 && acceptance.respiratoryAcceptance.published.nextData.publicHealthSurveillanceSignals.filter((item) => item.sourceId === "ph-source-laboratory-pathogen").every((item) => item.workflowState === "received" && item.verification === null), "three positive pathogen results publish minimized signals that still require human verification", "surveillance"),
    check("surveillance:respiratory-network-release-readiness", acceptance.respiratoryNetworkReadinessAcceptance.board.technicalLaunchReady === true && acceptance.respiratoryNetworkReadinessAcceptance.board.summary.trustedEvidence === 12 && acceptance.respiratoryNetworkReadinessAcceptance.board.institutions.every((item) => item.consecutiveQualityDays === 3), "six trusted evidence tracks per institution and three consecutive human-verified quality days prove network software release readiness", "surveillance"),
    check("security:respiratory-network-trusted-evidence", ["attestationOrigin", "verificationSource", "signatureVerified", "receiptSignature", "resolveVerificationKey", "timingSafeEqual", "receipt signature mismatch"].every((token) => respiratoryNetworkReadinessSource.includes(token)), "server receipt binds every trust field and managed key lifecycle fails closed on forgery, tampering, expiry or revocation", "security"),
    check("safety:respiratory-network-formal-launch-boundary", acceptance.respiratoryNetworkReadinessAcceptance.board.functionalState === "software-release-ready" && acceptance.respiratoryNetworkReadinessAcceptance.board.productionReady === false && acceptance.respiratoryNetworkReadinessAcceptance.board.externalProductionBlockers.length === 2, "software release readiness never substitutes for central site evidence and authorized formal launch approval", "safety"),
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
    check("security:model-governance-boundary", ["assertNoDirectIdentifiers", "model-run-input-digest-invalid", "model-run-output-invalid", "model-validation-integrity-invalid", "ungoverned-model-materialization", "modelAdviceOnly", "humanDecisionRequired", "driftReviewsDue"].every((token) => modelGovernanceSource.includes(token)), "model inputs, outputs, validation evidence, drift window and advisory-only boundary fail closed", "security"),
    check("security:respiratory-privacy-integrity-boundary", ["assertNoDirectIdentifiers", "sourceRecordHash", "one-sample-multi-test-incomplete", "respiratory-batch-content-fingerprint-invalid", "respiratory-batch-signal-binding-invalid", "respiratory-batch-audit-orphan"].every((token) => respiratorySource.includes(token)), "aggregate respiratory batches exclude direct identifiers and fail closed on incomplete, tampered, duplicate or orphaned state", "security"),
    check("integration:documented-t00-boundary", ["server.js", "SQLite", "T00", "productionReady=false", "/api/public-health/surveillance-signals", "/api/public-health/surveillance-model-governance", "/api/public-health/surveillance-models/:id/shadow-runs", "/api/public-health/respiratory-pathogen-surveillance", "/api/public-health/respiratory-pathogen-batches/:id/actions", "/api/public-health/medical-prevention-tasks"].every((token) => documentation.includes(token)), "T00 API, durable writer, model advisory, aggregate respiratory privacy and production boundaries are documented", "integration"),
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
      models: acceptance.modelGovernance.summary.models,
      modelRuns: acceptance.modelGovernance.summary.modelRuns,
      validatedShadowModels: acceptance.modelGovernance.summary.validatedShadowModels,
      modelDriftReviewsDue: acceptance.modelGovernance.summary.driftReviewsDue,
      respiratoryCatalogPathogens: acceptance.respiratoryAcceptance.board.summary.catalogPathogens,
      respiratoryObservedPathogens: acceptance.respiratoryAcceptance.board.summary.observedPathogens,
      respiratoryBatches: acceptance.respiratoryAcceptance.board.summary.batches,
      respiratoryOneSampleMultiTestBatches: acceptance.respiratoryAcceptance.board.summary.oneSampleMultiTestBatches,
      respiratoryPublishedSignals: acceptance.respiratoryAcceptance.board.summary.publishedSignals,
      respiratoryPlanningCoverageReady: acceptance.respiratoryAcceptance.board.summary.planningCoverageReady,
      respiratoryNetworkTechnicalLaunchReady: acceptance.respiratoryNetworkReadinessAcceptance.board.technicalLaunchReady,
      respiratoryNetworkTrustedEvidence: acceptance.respiratoryNetworkReadinessAcceptance.board.summary.trustedEvidence,
      respiratoryNetworkConsecutiveQualityDays: Math.min(...acceptance.respiratoryNetworkReadinessAcceptance.board.institutions.map((item) => item.consecutiveQualityDays)),
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
    modelGovernance: acceptance.modelGovernance,
    respiratoryPathogenSurveillance: acceptance.respiratoryAcceptance.board,
    respiratoryNetworkReadiness: acceptance.respiratoryNetworkReadinessAcceptance.board,
    surveillanceCenter: acceptance.surveillance,
    acceptance: {
      signalId: acceptance.intake.signal.id,
      alertId: acceptance.final.alert.id,
      alertState: acceptance.final.alert.status,
      alertVersion: acceptance.final.alert.version
    },
    remainingT00Integration: [
      "Wire a minimized data-source operations route and freshness panel without exposing endpoints or raw source identifiers.",
      "Wire rule-change submit, independent review and trusted server activation routes without accepting client-supplied trust metadata.",
      "Wire shadow model run and independent validation routes without allowing model output to create, verify, publish or close alerts.",
      "Wire aggregate respiratory batch intake, human verification, minimized signal publication and coverage routes without accepting person- or specimen-level identifiers.",
      "Wire respiratory network readiness and server-only evidence receipt routes; resolve the purpose-bound evidence keyring from managed configuration and reject all client trust claims.",
      "Persist model runs, validation evidence and audit records with optimistic versions and integrity checks.",
      "Add readiness, release and deploy gates while preserving productionReady=false until central site evidence, P0/P1 closure, production handoff and formal launch approval are verified."
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
    `- Surveillance models: ${report.summary.models}/3`,
    `- Shadow model runs: ${report.summary.modelRuns}`,
    `- Validated shadow models: ${report.summary.validatedShadowModels}`,
    `- Model drift reviews due: ${report.summary.modelDriftReviewsDue}`,
    `- Respiratory pathogens catalogued/observed: ${report.summary.respiratoryCatalogPathogens}/${report.summary.respiratoryObservedPathogens}`,
    `- One-sample multi-test batches: ${report.summary.respiratoryOneSampleMultiTestBatches}`,
    `- Respiratory minimized signals published: ${report.summary.respiratoryPublishedSignals}`,
    `- Respiratory planning coverage ready: ${report.summary.respiratoryPlanningCoverageReady ? "yes" : "no"}`,
    `- Respiratory network technical launch ready: ${report.summary.respiratoryNetworkTechnicalLaunchReady ? "yes" : "no"}`,
    `- Respiratory network trusted evidence: ${report.summary.respiratoryNetworkTrustedEvidence}`,
    `- Respiratory network consecutive quality days: ${report.summary.respiratoryNetworkConsecutiveQualityDays}`,
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
    "## Remaining T00 integration",
    "",
    ...report.remainingT00Integration.map((item) => `- ${item}`),
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
