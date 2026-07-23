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

test("nurse qualification fails closed when ownership capability or availability fields are missing or unknown", () => {
  const order = { institutionCode: "MR1", serviceItem: "wound care", riskLevel: "high" };
  const missing = qualifiedNurse();
  delete missing.institutionId;
  delete missing.institutionCode;
  delete missing.specialties;
  delete missing.status;

  const missingResult = Domain.validateNurseQualification(missing, order, { now: NOW });
  assert.equal(missingResult.ok, false);
  assert.equal(missingResult.reasons.includes("institution-code-missing"), true);
  assert.equal(missingResult.reasons.includes("specialties-missing"), true);
  assert.equal(missingResult.reasons.includes("nurse-status-missing"), true);
  assert.equal(missingResult.reasons.includes("nurse-unavailable"), true);

  const unknownStatus = Domain.validateNurseQualification(qualifiedNurse({ status: "unknown" }), order, { now: NOW });
  assert.equal(unknownStatus.ok, false);
  assert.equal(unknownStatus.reasons.includes("nurse-status-not-allowed"), true);
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

test("escort qualification fails closed when provider skills or availability fields are missing or unknown", () => {
  const order = { providerId: "esp-001", serviceItems: ["registration", "exam escort"] };
  const missing = qualifiedEscortWorker();
  delete missing.providerId;
  delete missing.skills;
  delete missing.status;

  const missingResult = Domain.validateEscortWorkerQualification(missing, order, { now: NOW });
  assert.equal(missingResult.ok, false);
  assert.equal(missingResult.reasons.includes("provider-id-missing"), true);
  assert.equal(missingResult.reasons.includes("skills-missing"), true);
  assert.equal(missingResult.reasons.includes("skill-mismatch"), true);
  assert.equal(missingResult.reasons.includes("worker-status-missing"), true);
  assert.equal(missingResult.reasons.includes("worker-unavailable"), true);

  const unknownStatus = Domain.validateEscortWorkerQualification(qualifiedEscortWorker({ status: "mystery" }), order, { now: NOW });
  assert.equal(unknownStatus.ok, false);
  assert.equal(unknownStatus.reasons.includes("worker-status-not-allowed"), true);
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

test("dispatch evaluation produces evidence-backed nursing updates for an eligible candidate", () => {
  const order = {
    id: "ino-dispatch-001",
    residentId: "r1",
    status: "assessed",
    institutionId: "inh-mr1",
    institutionCode: "MR1",
    serviceItem: "wound care",
    riskLevel: "medium",
    identityVerified: true,
    firstVisitAssessment: "passed",
    informedConsent: "signed",
    consentAttachment: { status: "signed" }
  };
  const decision = Domain.evaluateDispatchCandidate("nursing", order, qualifiedNurse(), { now: NOW });
  assert.equal(decision.eligible, true);
  assert.equal(decision.targetStatus, "dispatched");
  assert.equal(decision.updates.qualificationSnapshot.status, "passed");
  assert.equal(decision.updates.qualificationSnapshot.orderId, order.id);
  assert.equal(decision.updates.qualificationSnapshot.domain, "nursing");
  assert.match(decision.updates.qualificationSnapshot.digest, /^fnv1a32:/);
  assert.equal(decision.updates.dispatchDecision.status, "approved");
  assert.equal(decision.updates.dispatchDecision.orderId, order.id);
  assert.equal(decision.updates.dispatchDecision.domain, "nursing");
  assert.equal(decision.updates.dispatchDecision.subjectId, "inn-001");
  assert.match(decision.updates.dispatchDecision.id, /^dispatch:fnv1a32:/);

  const dispatched = Domain.transitionOrder("nursing", order, "dispatched", {
    at: NOW,
    actorId: "hospital",
    actorRole: "institution",
    updates: decision.updates
  });
  assert.equal(dispatched.status, "dispatched");
  assert.equal(dispatched.nurseId, "inn-001");
});

test("nursing dispatch rejects failed denied missing mismatched and stale evidence without mutation", () => {
  const order = {
    id: "ino-integrity-001",
    residentId: "r1",
    status: "assessed",
    institutionId: "inh-mr1",
    institutionCode: "MR1",
    serviceItem: "wound care",
    riskLevel: "medium",
    identityVerified: true,
    firstVisitAssessment: "passed",
    informedConsent: "signed",
    consentAttachment: { status: "signed" }
  };
  const updates = Domain.evaluateDispatchCandidate("nursing", order, qualifiedNurse(), { now: NOW }).updates;
  assert.throws(
    () => Domain.transitionOrder("nursing", order, "dispatched", {
      at: NOW,
      updates: {
        nurseId: "missing-nurse",
        qualificationSnapshot: { status: "failed" },
        dispatchDecision: { status: "denied" }
      }
    }),
    (error) => error.code === "ORDER_DISPATCH_INTEGRITY_INVALID"
      && error.details.reasons.includes("qualification-status-not-passed")
      && error.details.reasons.includes("dispatch-decision-not-approved")
      && error.details.reasons.includes("dispatch-decision-not-issued")
  );
  const cases = [
    {
      name: "failed qualification",
      updates: { ...updates, qualificationSnapshot: { ...updates.qualificationSnapshot, status: "failed" } },
      reason: "qualification-status-not-passed"
    },
    {
      name: "denied decision",
      updates: { ...updates, dispatchDecision: { ...updates.dispatchDecision, status: "denied" } },
      reason: "dispatch-decision-not-approved"
    },
    {
      name: "missing decision",
      updates: { ...updates, dispatchDecision: undefined },
      reason: "dispatch-decision-missing"
    },
    {
      name: "mismatched subject",
      updates: { ...updates, nurseId: "missing-nurse" },
      reason: "qualification-subject-mismatch"
    },
    {
      name: "mismatched order binding",
      updates: { ...updates, dispatchDecision: { ...updates.dispatchDecision, orderId: "ino-other" } },
      reason: "dispatch-order-mismatch"
    }
  ];

  for (const item of cases) {
    assert.throws(
      () => Domain.transitionOrder("nursing", order, "dispatched", { at: NOW, updates: item.updates }),
      (error) => error.code === "ORDER_DISPATCH_INTEGRITY_INVALID" && error.details.reasons.includes(item.reason),
      item.name
    );
    assert.equal(order.status, "assessed");
    assert.equal(order.timelineEvents, undefined);
  }

  assert.throws(
    () => Domain.transitionOrder("nursing", order, "dispatched", { at: "2026-07-22T10:00:01+08:00", updates }),
    (error) => error.code === "ORDER_DISPATCH_INTEGRITY_INVALID"
      && error.details.reasons.includes("qualification-stale")
      && error.details.reasons.includes("dispatch-stale")
  );
  assert.equal(order.status, "assessed");
});

test("dispatch ranking excludes fail-closed candidates and reports order blockers", () => {
  const order = {
    id: "ino-dispatch-002",
    status: "assessed",
    institutionId: "inh-mr1",
    institutionCode: "MR1",
    serviceItem: "wound care",
    riskLevel: "medium",
    identityVerified: true,
    firstVisitAssessment: "passed",
    informedConsent: "signed",
    consentAttachment: { status: "signed" }
  };
  const missingFields = qualifiedNurse({ id: "inn-missing" });
  delete missingFields.institutionCode;
  delete missingFields.specialties;
  delete missingFields.status;
  const ranked = Domain.rankDispatchCandidates("nursing", order, [
    qualifiedNurse({ id: "inn-expired", qualificationExpiresAt: "2026-07-20" }),
    missingFields,
    qualifiedNurse({ id: "inn-qualified", assignedToday: 1 })
  ], { now: NOW });
  assert.deepEqual(ranked.candidates.map((item) => item.personId), ["inn-qualified"]);
  assert.equal(ranked.blockedCandidates.length, 2);
  assert.equal(ranked.blockers.includes("qualification:qualification-expired"), true);
  assert.equal(ranked.blockers.includes("qualification:institution-code-missing"), true);
  assert.equal(ranked.blockers.includes("qualification:specialties-missing"), true);
  assert.equal(ranked.blockers.includes("qualification:nurse-status-missing"), true);
});

test("dispatch evaluation requires escort prerequisites and blocks critical nursing risk", () => {
  const escortOrder = {
    id: "eso-dispatch-001",
    status: "provider-matched",
    providerId: "esp-001",
    serviceItems: ["registration", "exam escort"],
    riskLevel: "low",
    identityVerified: true,
    eligibilityResult: { status: "eligible" },
    providerAdmissionSnapshot: { status: "approved" },
    contractStatus: "signed",
    insuranceStatus: "covered"
  };
  assert.equal(Domain.evaluateDispatchCandidate("escort", escortOrder, qualifiedEscortWorker(), { now: NOW }).eligible, true);

  const missingEligibility = Domain.evaluateDispatchCandidate("escort", { ...escortOrder, eligibilityResult: undefined }, qualifiedEscortWorker(), { now: NOW });
  assert.equal(missingEligibility.eligible, false);
  assert.equal(missingEligibility.blockers.includes("evidence:eligibility-result"), true);

  const criticalNursing = {
    id: "ino-critical",
    status: "assessed",
    institutionId: "inh-mr1",
    institutionCode: "MR1",
    serviceItem: "wound care",
    riskLevel: "high",
    identityVerified: true,
    firstVisitAssessment: "passed",
    informedConsent: "signed",
    consentAttachment: { status: "signed" },
    adverseEvent: { status: "open" },
    riskReview: { status: "approved" }
  };
  const criticalDecision = Domain.evaluateDispatchCandidate("nursing", criticalNursing, qualifiedNurse(), { now: NOW });
  assert.equal(criticalDecision.eligible, false);
  assert.equal(criticalDecision.blockers.includes("risk:critical"), true);
});

test("escort dispatch accepts evaluator evidence and rejects forged subject domain and stale bindings", () => {
  const order = {
    id: "eso-integrity-001",
    residentId: "r1",
    status: "provider-matched",
    providerId: "esp-001",
    serviceItems: ["registration", "exam escort"],
    riskLevel: "low",
    identityVerified: true,
    eligibilityResult: { status: "eligible" },
    providerAdmissionSnapshot: { status: "approved" },
    contractStatus: "signed",
    insuranceStatus: "covered"
  };
  const updates = Domain.evaluateDispatchCandidate("escort", order, qualifiedEscortWorker(), { now: NOW }).updates;
  const dispatched = Domain.transitionOrder("escort", order, "worker-dispatched", { at: NOW, updates });
  assert.equal(dispatched.status, "worker-dispatched");
  assert.equal(dispatched.workerId, "ew-001");
  assert.equal(dispatched.dispatchDecision.orderId, order.id);
  assert.equal(dispatched.dispatchDecision.domain, "escort");

  assert.throws(
    () => Domain.transitionOrder("escort", order, "worker-dispatched", { at: NOW, updates: { ...updates, workerId: "ew-forged" } }),
    (error) => error.code === "ORDER_DISPATCH_INTEGRITY_INVALID"
      && error.details.reasons.includes("qualification-subject-mismatch")
      && error.details.reasons.includes("dispatch-subject-mismatch")
  );
  assert.throws(
    () => Domain.transitionOrder("escort", order, "worker-dispatched", {
      at: NOW,
      updates: { ...updates, dispatchDecision: { ...updates.dispatchDecision, domain: "nursing" } }
    }),
    (error) => error.code === "ORDER_DISPATCH_INTEGRITY_INVALID" && error.details.reasons.includes("dispatch-domain-mismatch")
  );
  assert.throws(
    () => Domain.transitionOrder("escort", order, "worker-dispatched", { at: "2026-07-22T10:00:01+08:00", updates }),
    (error) => error.code === "ORDER_DISPATCH_INTEGRITY_INVALID" && error.details.reasons.includes("dispatch-stale")
  );
  assert.equal(order.status, "provider-matched");
  assert.equal(order.timelineEvents, undefined);
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
    (error) => error.code === "ORDER_DISPATCH_INTEGRITY_INVALID"
      && error.details.reasons.includes("qualification-snapshot-missing")
      && error.details.reasons.includes("dispatch-decision-missing")
  );

  const decision = Domain.evaluateDispatchCandidate("nursing", assessed, qualifiedNurse(), { now: NOW });
  const dispatched = Domain.transitionOrder("nursing", assessed, "dispatched", {
    actorId: "hospital",
    at: NOW,
    updates: decision.updates
  });
  assert.equal(dispatched.status, "dispatched");
});

test("transition order rejects attempts to disable evidence enforcement", () => {
  assert.throws(
    () => Domain.transitionOrder("nursing", { id: "ino-bypass", status: "requested" }, "assessed", { enforceEvidence: false }),
    (error) => error.code === "EVIDENCE_BYPASS_FORBIDDEN" && error.statusCode === 409
  );
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
