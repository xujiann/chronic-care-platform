"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const Service = require("../src/clinical-specialties/quality-safety/ai-cdss-governance-center");
const { createClinicalGovernancePorts } = require("../src/http/clinical-assist-runtime");
const { sourceDigest } = require("../src/identity-security/ai-governance");

function fixture() {
  return {
    authOrganizations: [{ orgCode: "ORG-A", name: "机构 A" }, { orgCode: "ORG-B", name: "机构 B" }],
    phase2ClinicalAssistRules: [
      {
        id: "rule-lab",
        category: "duplicate-lab",
        name: "重复检验提醒",
        sourceSystem: "HIS/LIS",
        triggerCondition: "有效期内存在可复用检验结果",
        severity: "high",
        defaultAction: "核对既有报告后由医生决定是否保留申请",
        requiredFields: ["residentId", "doctorId", "labItem"],
        configStatus: "active",
        owner: "must-not-leak-owner"
      },
      {
        id: "rule-medication",
        category: "duplicate-medication",
        name: "重复用药提醒",
        sourceSystem: "HIS/药房",
        triggerCondition: "处方与长期处方存在同类药品",
        severity: "high",
        defaultAction: "由医生调整处方或登记保留理由",
        requiredFields: ["residentId", "doctorId", "medication"],
        configStatus: "paused",
        version: "2.1.0",
        approvalEvidenceRef: "APPROVAL-001",
        validationEvidenceRef: "VALIDATION-001"
      }
    ],
    phase2ClinicalAssistAlerts: [
      {
        id: "alert-a",
        residentId: "resident-sensitive-0001",
        residentName: "must-not-leak-resident",
        doctorId: "doctor-a",
        doctorName: "must-not-leak-doctor",
        institutionCode: "ORG-A",
        institution: "must-not-leak-institution",
        ruleId: "rule-lab",
        category: "duplicate-lab",
        alertTitle: "重复检验提醒",
        alertDetail: "must-not-leak-clinical-detail",
        severity: "high",
        linkedEvidenceId: "evidence-a",
        recommendation: "核对既有报告后由医生决定是否保留申请",
        status: "pending-doctor-receipt",
        doctorAction: "pending",
        messageReceiptStatus: "received",
        pluginSurface: "doctor-workstation-banner",
        dueAt: "2026-09-06"
      },
      {
        id: "alert-b",
        residentId: "resident-sensitive-0002",
        doctorId: "doctor-b",
        institutionCode: "ORG-B",
        ruleId: "rule-medication",
        category: "duplicate-medication",
        alertTitle: "重复用药提醒",
        severity: "high",
        linkedEvidenceId: "evidence-b",
        recommendation: "调整处方或登记保留理由",
        status: "acknowledged",
        doctorAction: "adjusted-prescription",
        messageReceiptStatus: "received",
        pluginSurface: "prescription-inline-card"
      }
    ],
    phase2ClinicalAssistReceipts: [
      {
        id: "receipt-a",
        alertId: "alert-a",
        doctorId: "doctor-a",
        doctorName: "must-not-leak-doctor",
        receiptStatus: "sent",
        doctorAction: "pending",
        actionDetail: "must-not-leak-review-detail",
        receivedAt: "2026-09-05",
        messageChannel: "message-center",
        auditHash: "sha256:abc"
      },
      {
        id: "receipt-b",
        alertId: "alert-b",
        doctorId: "doctor-b",
        receiptStatus: "received",
        doctorAction: "adjusted-prescription",
        actionDetail: "医生已完成人工复核",
        receivedAt: "2026-09-05",
        messageChannel: "doctor-workstation",
        auditHash: "sha256:def"
      }
    ],
    phase2ClinicalAssistPluginContracts: [{
      id: "p2ca-plugin-workstation",
      name: "must-not-leak-contract-name",
      endpoint: "GET /api/phase2/clinical-assist",
      surface: "doctor-workstation-banner",
      payloadFields: ["alertId", "residentId", "doctorId"],
      status: "mvp-ready",
      onsiteBlocker: "must-not-leak-provider-blocker"
    }]
  };
}

test("commission receives cross-institution governance metadata without patient or clinical detail", () => {
  const center = Service.buildClinicalAiCdssGovernanceCenter(fixture(), {
    role: "commission",
    orgCode: "COMMISSION",
    username: "health"
  });

  assert.equal(center.schemaVersion, "clinical-ai-cdss-governance-center-v1");
  assert.equal(center.sourceRequirement, "J-CLIN-CDSS");
  assert.equal(center.upstreamGovernanceRequirement.id, "L-GOV-AI");
  assert.equal(center.upstreamGovernanceRequirement.status, "declared-only");
  assert.equal(center.productionReady, false);
  assert.equal(center.decision, "NO-GO");
  assert.equal(center.summary.rules, 2);
  assert.equal(center.summary.suggestions, 2);
  assert.equal(center.actions.automaticDiagnosis, false);
  assert.equal(center.actions.automaticOrder, false);
  assert.equal(center.actions.automaticPrescription, false);
  assert.equal(center.suggestions.every((item) => item.residentReference === ""), true);
  assert.equal(center.suggestions.every((item) => item.practitionerReference === ""), true);
  assert.equal(center.suggestions.every((item) => item.recommendation === ""), true);
  assert.equal(center.reviewLedger.every((item) => item.actionDetail === ""), true);
  assert.equal(center.ruleCards.every((item) => item.autoExecutionAllowed === false), true);
  assert.equal(center.monitoring.telemetryAvailable, false);
  assert.equal(center.monitoring.signals.some((item) => item.type === "model-governance-gap"), true);
  assert.doesNotMatch(JSON.stringify(center), /must-not-leak|resident-sensitive/);
});

test("institution doctor is strictly scoped and receives minimized recommendation evidence", () => {
  const center = Service.buildClinicalAiCdssGovernanceCenter(fixture(), {
    role: "institution",
    orgCode: "ORG-A",
    orgName: "机构 A",
    doctorId: "doctor-a",
    username: "doctor-a"
  });

  assert.equal(center.summary.suggestions, 1);
  assert.equal(center.suggestions[0].id, "alert-a");
  assert.equal(center.suggestions[0].residentReference.includes("resident-sensitive"), false);
  assert.equal(center.suggestions[0].residentReference.endsWith("0001"), true);
  assert.equal(center.suggestions[0].practitionerReference, "doctor-a");
  assert.equal(center.suggestions[0].recommendation.includes("由医生决定"), true);
  assert.equal(center.suggestions[0].evidenceReference, "evidence-a");
  assert.equal(center.suggestions[0].actions.submitReview, true);
  assert.equal(center.suggestions[0].reviewStatus, "pending-human-review");
  assert.equal(center.reviewLedger.length, 1);
  assert.equal(center.reviewLedger[0].id, "receipt-a");
  assert.equal(center.actions.submitHumanReview, true);
  assert.doesNotMatch(JSON.stringify(center), /alert-b|receipt-b|resident-sensitive-0002/);
});

test("institution manager uses an exact trusted organization scope", () => {
  const center = Service.buildClinicalAiCdssGovernanceCenter(fixture(), {
    role: "institution",
    orgCode: "ORG-B",
    orgName: "机构 B",
    username: "hospital-manager"
  });
  assert.deepEqual(center.suggestions.map((item) => item.id), ["alert-b"]);
  assert.equal(center.summary.reviewed, 1);
  assert.equal(center.monitoring.humanReviewCoverage, 100);
});

test("missing institution scope and unrelated roles fail closed", () => {
  assert.throws(
    () => Service.buildClinicalAiCdssGovernanceCenter(fixture(), { role: "institution" }),
    (error) => error.code === "CLINICAL_AI_CDSS_SCOPE_REQUIRED" && error.statusCode === 403
  );
  assert.throws(
    () => Service.buildClinicalAiCdssGovernanceCenter(fixture(), { role: "citizen", orgCode: "PERSON-1" }),
    (error) => error.code === "CLINICAL_AI_CDSS_ROLE_FORBIDDEN" && error.statusCode === 403
  );
});

test("doctor scope requires both a trusted organization and the matching doctor", () => {
  const data = fixture();
  data.phase2ClinicalAssistAlerts[1].doctorId = "doctor-a";
  const center = Service.buildClinicalAiCdssGovernanceCenter(data, {
    role: "institution", orgCode: "ORG-A", doctorId: "doctor-a", accountType: "doctor", username: "doctor-a"
  }, createClinicalGovernancePorts());
  assert.deepEqual(center.suggestions.map((item) => item.id), ["alert-a"]);
  assert.deepEqual(center.reviewLedger.map((item) => item.id), ["receipt-a"]);
  assert.doesNotMatch(JSON.stringify(center), /alert-b|receipt-b|resident-sensitive-0002/);
});

test("doctor without binding and institution without a trusted directory fail closed", () => {
  assert.throws(() => Service.buildClinicalAiCdssGovernanceCenter(fixture(), {
    role: "institution", orgCode: "ORG-A", accountType: "doctor", username: "unbound-doctor"
  }, createClinicalGovernancePorts()), (error) => error.statusCode === 403);
  const data = fixture();
  delete data.authOrganizations;
  assert.throws(() => Service.buildClinicalAiCdssGovernanceCenter(data, {
    role: "institution", orgCode: "ORG-A", username: "manager"
  }, createClinicalGovernancePorts()), (error) => error.statusCode === 403);
});

test("suspended and source-drifted rules cannot leak recommendations through either projection", () => {
  for (const status of ["suspended", "stale"]) {
    const data = fixture();
    const rule = data.phase2ClinicalAssistRules[0];
    Object.assign(rule, { version: "1.0", approvalEvidenceRef: "legacy-approval", validationEvidenceRef: "legacy-validation" });
    rule.governance = { status: status === "stale" ? "approved" : status, card: { sourceDigest: sourceDigest(rule) } };
    if (status === "stale") rule.defaultAction = "must-not-leak-drifted-recommendation";
    const center = Service.buildClinicalAiCdssGovernanceCenter(data, {
      role: "institution", orgCode: "ORG-A", doctorId: "doctor-a", username: "doctor-a"
    }, createClinicalGovernancePorts());
    assert.equal(center.ruleCards[0].recommendedReview, "", status);
    assert.notEqual(center.ruleCards[0].lifecycleStatus, "governed-active", status);
    assert.equal(center.suggestions[0].recommendation, "", status);
    assert.equal(center.suggestions[0].decisionAvailable, false, status);
    assert.doesNotMatch(JSON.stringify(center), /must-not-leak-drifted-recommendation/);
    assert.equal(center.productionReady, false);
  }
});

test("governed rules without a trusted policy stay unavailable", () => {
  const data = fixture();
  const rule = data.phase2ClinicalAssistRules[0];
  rule.governance = { status: "approved", card: { sourceDigest: sourceDigest(rule) } };
  const center = Service.buildClinicalAiCdssGovernanceCenter(data, {
    role: "institution", orgCode: "ORG-A", doctorId: "doctor-a", username: "doctor-a"
  });
  assert.equal(center.ruleCards[0].recommendedReview, "");
  assert.equal(center.suggestions[0].recommendation, "");
  assert.equal(center.suggestions[0].decisionAvailable, false);
});

test("reasoned keep-order receipts count as completed human review", () => {
  const data = fixture();
  data.phase2ClinicalAssistAlerts[0].doctorAction = "kept-order-with-reason";
  Object.assign(data.phase2ClinicalAssistReceipts[0], {
    doctorAction: "kept-order-with-reason", receiptStatus: "received", actionDetail: "已核对既有报告并确认本次检查必要"
  });
  const center = Service.buildClinicalAiCdssGovernanceCenter(data, {
    role: "institution", orgCode: "ORG-A", doctorId: "doctor-a", username: "doctor-a"
  }, createClinicalGovernancePorts());
  assert.equal(center.suggestions[0].reviewStatus, "reviewed");
  assert.equal(center.reviewLedger[0].humanDecisionRecorded, true);
  assert.equal(center.summary.pendingHumanReview, 0);
  assert.equal(center.summary.reviewed, 1);
  assert.equal(center.monitoring.humanReviewCoverage, 100);
});
