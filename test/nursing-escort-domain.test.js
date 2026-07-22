const test = require("node:test");
const assert = require("node:assert/strict");

const Domain = require("../nursing-escort-domain");
const { validateFinancialRequest } = require("../financial-gateways");

const NOW = "2026-07-22T09:00:00+08:00";

function qualifiedNurse(overrides = {}) {
  return {
    id: "inn-001",
    institutionId: "inh-mr1",
    institutionCode: "MR1",
    yearsClinical: 9,
    registrationStatus: "verified",
    badPracticeRecord: "none",
    specialties: ["wound care"],
    trainingStatus: "passed",
    insuranceStatus: "covered",
    qualificationExpiresAt: "2026-12-31T23:59:59+08:00",
    status: "available",
    dailyCapacity: 6,
    assignedToday: 2,
    ...overrides
  };
}

function qualifiedEscortWorker(overrides = {}) {
  return {
    id: "ew-001",
    providerId: "esp-001",
    trainingHours: 40,
    examStatus: "passed",
    insuranceStatus: "covered",
    status: "available",
    skills: ["registration", "exam escort"],
    ...overrides
  };
}

test("workflow exposes guarded nursing and escort state transitions", () => {
  assert.deepEqual(Domain.allowedNextStates("nursing", "requested"), ["assessed", "risk-hold", "cancel-requested", "rejected"]);
  assert.equal(Domain.validateTransition("nursing", "accepted", "in-service").ok, true);
  assert.equal(Domain.validateTransition("nursing", "requested", "completed").ok, false);
  assert.equal(Domain.validateTransition("escort", "matched", "accepted").ok, true);
  assert.equal(Domain.canonicalStatus("contract-pending", "escort"), "requested");
});

test("nurse qualification rejects expired cross-institution and specialty-mismatched assignments", () => {
  const order = { institutionId: "inh-mr1", institutionCode: "MR1", serviceItem: "wound care", riskLevel: "high" };
  assert.equal(Domain.validateNurseQualification(qualifiedNurse(), order, { now: NOW }).ok, true);

  const expired = Domain.validateNurseQualification(qualifiedNurse({ qualificationExpiresAt: "2026-07-20" }), order, { now: NOW });
  assert.equal(expired.ok, false);
  assert.equal(expired.reasons.includes("qualification-expired"), true);

  const mismatched = Domain.validateNurseQualification(qualifiedNurse({ institutionId: "inh-mr3", institutionCode: "MR3", specialties: ["tube care"] }), order, { now: NOW });
  assert.equal(mismatched.reasons.includes("institution-mismatch"), true);
  assert.equal(mismatched.reasons.includes("specialty-mismatch"), true);
});

test("escort qualification enforces training exam insurance provider and skills", () => {
  const order = { providerId: "esp-001", serviceItems: ["registration", "exam escort"] };
  assert.equal(Domain.validateEscortWorkerQualification(qualifiedEscortWorker(), order, { now: NOW }).ok, true);

  const result = Domain.validateEscortWorkerQualification(qualifiedEscortWorker({
    providerId: "esp-002",
    trainingHours: 28,
    examStatus: "pending",
    insuranceStatus: "pending",
    status: "training",
    skills: ["registration"]
  }), order, { now: NOW });
  assert.deepEqual(result.missingSkills, ["exam escort"]);
  assert.equal(result.reasons.includes("provider-mismatch"), true);
  assert.equal(result.reasons.includes("training-hours-insufficient"), true);
  assert.equal(result.reasons.includes("exam-not-passed"), true);
  assert.equal(result.reasons.includes("insurance-not-covered"), true);
  assert.equal(result.reasons.includes("worker-unavailable"), true);
  assert.equal(result.reasons.includes("skill-mismatch"), true);
});

test("risk assessment turns missing assessment consent and assignment into controls", () => {
  const nursing = Domain.assessOrderRisk("nursing", {
    riskLevel: "high",
    firstVisitAssessment: "pending",
    informedConsent: "pending",
    nurseId: "",
    complaintStatus: "none"
  });
  assert.equal(nursing.band, "critical");
  assert.equal(nursing.reasons.includes("assessment-pending"), true);
  assert.equal(nursing.controls.includes("stop-auto-dispatch"), true);

  const escort = Domain.assessOrderRisk("escort", {
    riskLevel: "medium",
    contractStatus: "pending",
    insuranceStatus: "covered",
    workerId: "",
    hospitalInterfaceStatus: "returned",
    familyContactStatus: "pending"
  });
  assert.equal(["high", "critical"].includes(escort.band), true);
  assert.equal(escort.reasons.includes("hospital-returned"), true);
});

test("transition order blocks missing evidence and emits resident timeline evidence", () => {
  const requested = {
    id: "ino-test-001",
    residentId: "r1",
    status: "requested",
    identityVerified: true,
    firstVisitAssessment: "passed",
    informedConsent: "signed",
    consentAttachment: { status: "signed" },
    auditTrail: []
  };
  const assessed = Domain.transitionOrder("nursing", requested, "assessed", { actorId: "hospital", actorRole: "institution", at: NOW });
  assert.equal(assessed.status, "assessed");
  assert.equal(assessed.timelineEvents[0].residentId, "r1");
  assert.equal(assessed.timelineEvents[0].evidenceTypes.includes("signed-consent"), true);

  assert.throws(
    () => Domain.transitionOrder("nursing", assessed, "dispatched", { actorId: "hospital", at: NOW }),
    (error) => error.code === "ORDER_EVIDENCE_INCOMPLETE" && error.details.missing.includes("qualification-snapshot")
  );

  const dispatched = Domain.transitionOrder("nursing", assessed, "dispatched", {
    actorId: "hospital",
    at: NOW,
    updates: { nurseId: "inn-001", qualificationSnapshot: { status: "passed" }, dispatchDecision: { score: 12 } }
  });
  assert.equal(dispatched.status, "dispatched");
});

test("completion requires service record trace confirmation and exception declaration", () => {
  const order = {
    id: "ino-test-002",
    residentId: "r1",
    status: "in-service",
    serviceRecordStatus: "completed",
    serviceRecord: { status: "completed", exceptionReport: { status: "none" } },
    serviceAttachments: [{ type: "resident-signature", name: "resident.png" }],
    locationTracePoints: [
      { stage: "service-start", verified: true },
      { stage: "service-complete", verified: true }
    ],
    adverseEvent: { status: "none" }
  };
  const completed = Domain.transitionOrder("nursing", order, "completed", { actorId: "inn-001", actorRole: "nurse", at: NOW });
  assert.equal(completed.status, "completed");

  assert.throws(
    () => Domain.transitionOrder("nursing", { ...order, serviceAttachments: [], residentConfirmation: "pending" }, "completed", { at: NOW }),
    (error) => error.code === "ORDER_EVIDENCE_INCOMPLETE" && error.details.missing.includes("resident-confirmation")
  );
});

test("financial command correlates an order using integer cents and a stable idempotency key", () => {
  const payment = Domain.buildFinancialCommand("escort", { id: "eso-001", feeEstimate: 120 }, "create-payment");
  assert.equal(payment.type, "PAYMENT");
  assert.equal(payment.payload.amountFen, 12000);
  assert.equal(payment.payload.businessOrderType, "escort");
  assert.equal(payment.idempotencyKey, "escort:eso-001:create-payment:v1");
  assert.equal(validateFinancialRequest(payment).operation, "create-payment");

  const settlement = Domain.buildFinancialCommand("nursing", { id: "ino-001", residentId: "r1", institutionCode: "MR1", feeEstimate: 168 }, "settlement");
  assert.equal(settlement.type, "INSURANCE");
  assert.equal(settlement.payload.amountFen, 16800);
  assert.equal(validateFinancialRequest(settlement).operation, "settlement");
});
