"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  AiGovernanceCenterError,
  buildAiGovernanceCenter
} = require("../src/identity-security/ai-governance-center");

function fixture() {
  return {
    phase2ClinicalAssistRules: [
      { id: "rule-1", name: "must-not-leak-rule-name", version: "" },
      { id: "rule-2", name: "must-not-leak-rule-name-2", version: "2.0" }
    ],
    phase2ClinicalAssistAlerts: [
      { id: "alert-1", residentName: "must-not-leak-person", institution: "must-not-leak-organization", recommendation: "must-not-leak-clinical-content" }
    ],
    phase2ClinicalAssistReceipts: [
      { id: "receipt-1", doctorAction: "accepted-recommendation", actionDetail: "must-not-leak-review-detail" }
    ],
    diseaseRegistryModels: [
      { id: "model-1", version: "1.0", reviewer: "must-not-leak-reviewer", reviewStatus: "active", population: "must-not-leak-population" }
    ],
    chronicModelGovernance: [{ reviewerComment: "must-not-read-chronic-governance" }],
    publicHealthAiReviews: [{ summary: "must-not-read-public-health-review" }],
    countyAiDiagnosisCases: [{ suggestion: "must-not-read-primary-care-case" }]
  };
}

test("platform AI governance center exposes only cross-domain governance metadata", () => {
  const center = buildAiGovernanceCenter(fixture(), { role: "commission", username: "health" });
  assert.equal(center.schemaVersion, "platform-ai-governance-center-v1");
  assert.equal(center.capabilityId, "L-GOV-AI");
  assert.equal(center.productionReady, false);
  assert.equal(center.decision, "NO-GO");
  assert.equal(center.summary.useCases, 4);
  assert.equal(center.summary.criticalRiskUseCases, 2);
  assert.equal(center.summary.authorizedSourceBindings, 4);
  assert.equal(center.summary.pendingOwnerBindings, 3);
  assert.equal(center.summary.observedRecords, 5);
  assert.equal(center.summary.productionEligibleUseCases, 0);
  assert.equal(center.actions.automaticDiagnosis, false);
  assert.equal(center.actions.automaticOrder, false);
  assert.equal(center.actions.automaticPrescription, false);
  assert.equal(center.actions.automaticPublicHealthDecision, false);
  assert.equal(center.actions.productionActivation, false);
  assert.equal(center.scope.personalDataVisible, false);
  assert.equal(center.scope.clinicalContentVisible, false);
  assert.equal(center.useCases.every((item) => item.humanOversightRequired && !item.automaticDecisionAllowed), true);
  const serialized = JSON.stringify(center);
  for (const forbidden of ["must-not-leak-person", "must-not-leak-organization", "must-not-leak-clinical-content", "must-not-leak-review-detail", "must-not-leak-reviewer", "must-not-leak-population"]) {
    assert.doesNotMatch(serialized, new RegExp(forbidden));
  }
});

test("platform AI governance center never reads sources without an owner handoff", () => {
  const source = fixture();
  const forbidden = new Set(["chronicModelGovernance", "publicHealthAiReviews", "countyAiDiagnosisCases"]);
  const guarded = new Proxy(source, {
    get(target, property, receiver) {
      if (forbidden.has(String(property))) throw new Error(`forbidden source read: ${String(property)}`);
      return Reflect.get(target, property, receiver);
    }
  });
  const center = buildAiGovernanceCenter(guarded, { role: "commission" });
  assert.equal(center.summary.pendingOwnerBindings, 3);
  assert.equal(center.useCases.find((item) => item.id === "public-health-investigation-assist").observedRecords, 0);
  assert.equal(center.useCases.find((item) => item.id === "primary-care-decision-assist").observedRecords, 0);
});

test("platform AI governance center rejects unauthorized roles and malformed authorized sources", () => {
  assert.throws(
    () => buildAiGovernanceCenter(fixture(), { role: "institution" }),
    (error) => error instanceof AiGovernanceCenterError && error.code === "AI_GOVERNANCE_ROLE_FORBIDDEN" && error.statusCode === 403
  );
  const malformed = fixture();
  malformed.phase2ClinicalAssistRules = {};
  assert.throws(
    () => buildAiGovernanceCenter(malformed, { role: "commission" }),
    (error) => error instanceof AiGovernanceCenterError && error.code === "AI_GOVERNANCE_SOURCE_INVALID" && error.statusCode === 503
  );
});

test("platform AI governance controls and risks stay fail-closed", () => {
  const center = buildAiGovernanceCenter(fixture(), { role: "commission" });
  assert.equal(center.controls.length, 8);
  assert.equal(center.controls.filter((item) => item.status === "blocked").length, 4);
  assert.equal(center.risks.some((item) => item.id === "platform-ai-incident-workflow" && item.severity === "critical"), true);
  assert.equal(center.risks.every((item) => item.status === "open"), true);
  assert.equal(center.blockers.length >= 4, true);
});
