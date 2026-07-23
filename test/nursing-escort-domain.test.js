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
    dailyCapacity: 6,
    assignedToday: 1,
    ...overrides
  };
}

test("workflow exposes guarded nursing and escort state transitions", () => {
  assert.deepEqual(Domain.allowedNextStates("nursing", "requested"), ["assessed", "risk-hold", "reschedule-requested", "cancel-requested", "rejected"]);
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
  delete missing.dailyCapacity;
  delete missing.assignedToday;

  const missingResult = Domain.validateNurseQualification(missing, order, { now: NOW });
  assert.equal(missingResult.ok, false);
  assert.equal(missingResult.reasons.includes("institution-code-missing"), true);
  assert.equal(missingResult.reasons.includes("specialties-missing"), true);
  assert.equal(missingResult.reasons.includes("nurse-status-missing"), true);
  assert.equal(missingResult.reasons.includes("nurse-unavailable"), true);
  assert.equal(missingResult.reasons.includes("daily-capacity-invalid"), true);
  assert.equal(missingResult.reasons.includes("assigned-count-invalid"), true);

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
  assert.equal(decision.updates.capacityReservation.status, "reserved");
  assert.equal(decision.updates.capacityReservation.orderId, order.id);
  assert.equal(decision.updates.capacityReservation.subjectId, "inn-001");
  assert.equal(decision.updates.capacityReservation.serviceDate, "2026-07-22");
  assert.equal(decision.updates.dispatchDecision.capacityReservationId, decision.updates.capacityReservation.id);

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
      name: "missing capacity reservation",
      updates: { ...updates, capacityReservation: undefined },
      reason: "capacity-reservation-missing"
    },
    {
      name: "mismatched capacity subject",
      updates: { ...updates, capacityReservation: { ...updates.capacityReservation, subjectId: "missing-nurse" } },
      reason: "capacity-subject-mismatch"
    },
    {
      name: "forged capacity ordinal",
      updates: { ...updates, capacityReservation: { ...updates.capacityReservation, reservedOrdinal: 99 } },
      reason: "capacity-limit-exceeded"
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
      && error.details.reasons.includes("capacity-stale")
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
  assert.throws(
    () => Domain.transitionOrder("nursing", order, "dispatched", { at: NOW, updates: ranked.candidates[0].updates }),
    (error) => error.code === "ORDER_DISPATCH_INTEGRITY_INVALID"
      && error.details.reasons.includes("dispatch-decision-not-issued")
      && error.details.reasons.includes("capacity-reservation-not-issued")
  );
  assert.equal(order.status, "assessed");
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
  assert.equal(dispatched.capacityReservation.subjectId, "ew-001");

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
    () => Domain.transitionOrder("escort", order, "worker-dispatched", {
      at: NOW,
      updates: { ...updates, capacityReservation: { ...updates.capacityReservation, serviceDate: "2026-07-23" } }
    }),
    (error) => error.code === "ORDER_DISPATCH_INTEGRITY_INVALID"
      && error.details.reasons.includes("capacity-service-date-mismatch")
      && error.details.reasons.includes("capacity-digest-mismatch")
  );
  assert.throws(
    () => Domain.transitionOrder("escort", order, "worker-dispatched", { at: "2026-07-22T10:00:01+08:00", updates }),
    (error) => error.code === "ORDER_DISPATCH_INTEGRITY_INVALID" && error.details.reasons.includes("dispatch-stale")
  );
  assert.equal(order.status, "provider-matched");
  assert.equal(order.timelineEvents, undefined);
});

test("capacity reservations prevent concurrent nursing and escort overbooking without mutating rejected orders", () => {
  const nursingBase = {
    residentId: "r-cap",
    status: "assessed",
    institutionId: "inh-mr1",
    institutionCode: "MR1",
    serviceItem: "wound care",
    preferredAt: "2026-08-01",
    riskLevel: "medium",
    identityVerified: true,
    firstVisitAssessment: "passed",
    informedConsent: "signed",
    consentAttachment: { status: "signed" }
  };
  const nursingPerson = qualifiedNurse({ id: "inn-capacity-001", dailyCapacity: 1, assignedToday: 0 });
  const nursingFirst = { ...nursingBase, id: "ino-capacity-001" };
  const nursingSecond = { ...nursingBase, id: "ino-capacity-002" };
  const nursingFirstDecision = Domain.evaluateDispatchCandidate("nursing", nursingFirst, nursingPerson, { now: NOW });
  const nursingSecondDecision = Domain.evaluateDispatchCandidate("nursing", nursingSecond, nursingPerson, { now: NOW });
  assert.equal(nursingFirstDecision.eligible, true);
  assert.equal(nursingSecondDecision.eligible, true);
  assert.equal(nursingFirstDecision.updates.capacityReservation.reservedOrdinal, 1);
  Domain.transitionOrder("nursing", nursingFirst, "dispatched", { at: NOW, updates: nursingFirstDecision.updates });
  assert.throws(
    () => Domain.transitionOrder("nursing", nursingSecond, "dispatched", { at: NOW, updates: nursingSecondDecision.updates }),
    (error) => error.code === "ORDER_DISPATCH_INTEGRITY_INVALID" && error.details.reasons.includes("capacity-slot-conflict")
  );
  assert.equal(nursingSecond.status, "assessed");
  assert.equal(nursingSecond.timelineEvents, undefined);
  const nursingAfterCommit = Domain.evaluateDispatchCandidate("nursing", nursingSecond, nursingPerson, { now: NOW });
  assert.equal(nursingAfterCommit.eligible, false);
  assert.equal(nursingAfterCommit.blockers.includes("capacity:no-slot-available"), true);

  const escortBase = {
    residentId: "r-cap",
    status: "provider-matched",
    providerId: "esp-001",
    serviceItems: ["registration", "exam escort"],
    appointmentAt: "2026-08-02",
    riskLevel: "low",
    identityVerified: true,
    eligibilityResult: { status: "eligible" },
    providerAdmissionSnapshot: { status: "approved" },
    contractStatus: "signed",
    insuranceStatus: "covered"
  };
  const escortPerson = qualifiedEscortWorker({ id: "ew-capacity-001", dailyCapacity: 1, assignedToday: 0 });
  const escortFirst = { ...escortBase, id: "eso-capacity-001" };
  const escortSecond = { ...escortBase, id: "eso-capacity-002" };
  const escortFirstDecision = Domain.evaluateDispatchCandidate("escort", escortFirst, escortPerson, { now: NOW });
  const escortSecondDecision = Domain.evaluateDispatchCandidate("escort", escortSecond, escortPerson, { now: NOW });
  Domain.transitionOrder("escort", escortFirst, "worker-dispatched", { at: NOW, updates: escortFirstDecision.updates });
  assert.throws(
    () => Domain.transitionOrder("escort", escortSecond, "worker-dispatched", { at: NOW, updates: escortSecondDecision.updates }),
    (error) => error.code === "ORDER_DISPATCH_INTEGRITY_INVALID" && error.details.reasons.includes("capacity-slot-conflict")
  );
  assert.equal(escortSecond.status, "provider-matched");
  assert.equal(escortSecond.timelineEvents, undefined);
  const escortAfterCommit = Domain.evaluateDispatchCandidate("escort", escortSecond, escortPerson, { now: NOW });
  assert.equal(escortAfterCommit.eligible, false);
  assert.equal(escortAfterCommit.blockers.includes("capacity:no-slot-available"), true);
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
  assert.equal(assessed.timelineEvents[0].sequence, 1);
  assert.equal(assessed.notificationPlans[0].eventId, assessed.timelineEvents[0].id);
  assert.equal(assessed.notificationPlans[0].messages.some((item) => item.recipientRole === "resident" && item.channel === "in_app"), true);

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

test("resident timeline enforces order resident chronology state continuity and previous-event links", () => {
  const requested = {
    id: "ino-timeline-001",
    residentId: "r1",
    status: "requested",
    identityVerified: true,
    firstVisitAssessment: "passed",
    informedConsent: "signed",
    consentAttachment: { status: "signed" }
  };
  const assessed = Domain.transitionOrder("nursing", requested, "assessed", {
    at: NOW,
    actorId: "assessment-001",
    actorRole: "nurse"
  });
  const held = Domain.transitionOrder("nursing", assessed, "risk-hold", {
    at: "2026-07-22T09:05:00+08:00",
    actorId: "risk-001",
    actorRole: "risk-reviewer"
  });
  assert.equal(held.timelineEvents[0].sequence, 2);
  assert.equal(held.timelineEvents[0].previousEventId, assessed.timelineEvents[0].id);
  assert.equal(Domain.validateTimelineIntegrity("nursing", held, { at: "2026-07-22T09:06:00+08:00" }).ok, true);
  assert.throws(
    () => Domain.transitionOrder("nursing", held, "assessed", {
      at: "2026-07-22T09:04:00+08:00"
    }),
    (error) => error.code === "ORDER_TIMELINE_INTEGRITY_INVALID"
      && error.details.reasons.includes("timeline-transition-time-regression")
  );

  const wrongResident = {
    ...held,
    timelineEvents: [
      { ...held.timelineEvents[0], residentId: "other-resident" },
      ...held.timelineEvents.slice(1)
    ]
  };
  assert.throws(
    () => Domain.transitionOrder("nursing", wrongResident, "assessed", {
      at: "2026-07-22T09:10:00+08:00"
    }),
    (error) => error.code === "ORDER_TIMELINE_INTEGRITY_INVALID"
      && error.details.reasons.includes("timeline-resident-mismatch:0")
  );

  const brokenChain = {
    ...held,
    timelineEvents: [
      held.timelineEvents[0],
      { ...held.timelineEvents[1], toStatus: "risk-hold" }
    ]
  };
  assert.throws(
    () => Domain.transitionOrder("nursing", brokenChain, "assessed", {
      at: "2026-07-22T09:10:00+08:00"
    }),
    (error) => error.code === "ORDER_TIMELINE_INTEGRITY_INVALID"
      && error.details.reasons.some((item) => item.startsWith("timeline-status-chain-broken"))
  );

  const outOfOrder = {
    ...held,
    timelineEvents: [
      { ...held.timelineEvents[0], occurredAt: "2026-07-22T08:55:00+08:00" },
      held.timelineEvents[1]
    ]
  };
  assert.throws(
    () => Domain.transitionOrder("nursing", outOfOrder, "assessed", {
      at: "2026-07-22T09:10:00+08:00"
    }),
    (error) => error.code === "ORDER_TIMELINE_INTEGRITY_INVALID"
      && error.details.reasons.includes("timeline-order-invalid:0")
  );
  assert.equal(held.status, "risk-hold");
});

test("notification receipts bind timeline plan message recipient status and idempotency", () => {
  const requested = {
    id: "eso-notification-001",
    residentId: "r2",
    status: "requested",
    identityVerified: true,
    eligibilityResult: { status: "passed" }
  };
  const checked = Domain.transitionOrder("escort", requested, "eligibility-checked", {
    at: NOW,
    actorId: "eligibility-001",
    actorRole: "institution"
  });
  const plan = checked.notificationPlans[0];
  const message = plan.messages.find((item) => item.recipientRole === "resident" && item.channel === "in_app");
  assert.equal(Domain.validateNotificationPlan("escort", checked, plan).ok, true);
  const forgedPlan = {
    ...plan,
    id: "forged-plan",
    messages: plan.messages.map((item) => ({ ...item, id: `forged-plan:${item.recipientRole}:${item.channel}` }))
  };
  assert.equal(Domain.validateNotificationPlan("escort", checked, forgedPlan).reasons.includes("notification-plan-id-mismatch"), true);

  const deliveredReceipt = Domain.buildNotificationReceiptEvidence("escort", checked, message, {
    status: "delivered",
    providerMessageId: "provider-message-001"
  }, { at: "2026-07-22T09:02:00+08:00" });
  const delivered = Domain.recordNotificationReceipt("escort", checked, deliveredReceipt);
  assert.equal(delivered.duplicate, false);
  assert.equal(delivered.order.notificationReceiptSummary.delivered, 1);

  const duplicate = Domain.recordNotificationReceipt("escort", delivered.order, deliveredReceipt);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.order.notificationReceipts.length, 1);

  assert.throws(
    () => Domain.recordNotificationReceipt("escort", delivered.order, {
      ...deliveredReceipt,
      providerMessageId: "other-provider-message"
    }),
    (error) => error.code === "NOTIFICATION_RECEIPT_INVALID"
      && error.details.reasons.includes("notification-idempotency-conflict")
  );

  const regressed = Domain.buildNotificationReceiptEvidence("escort", delivered.order, message, {
    status: "queued"
  }, { at: "2026-07-22T09:03:00+08:00" });
  assert.throws(
    () => Domain.recordNotificationReceipt("escort", delivered.order, regressed),
    (error) => error.code === "NOTIFICATION_RECEIPT_INVALID"
      && error.details.reasons.includes("notification-status-regression")
  );

  const failedWithoutCode = Domain.buildNotificationReceiptEvidence("escort", delivered.order, message, {
    status: "failed"
  }, { at: "2026-07-22T09:04:00+08:00" });
  assert.throws(
    () => Domain.recordNotificationReceipt("escort", delivered.order, failedWithoutCode),
    (error) => error.code === "NOTIFICATION_RECEIPT_INVALID"
      && error.details.reasons.includes("notification-failure-code-missing")
  );

  const crossOrder = { ...deliveredReceipt, orderId: "other-order" };
  assert.throws(
    () => Domain.recordNotificationReceipt("escort", checked, crossOrder),
    (error) => error.code === "NOTIFICATION_RECEIPT_INVALID"
      && error.details.reasons.includes("notification-receipt-order-mismatch")
  );
  assert.equal(checked.notificationReceipts, undefined);
});

test("transition order rejects attempts to disable evidence enforcement", () => {
  assert.throws(
    () => Domain.transitionOrder("nursing", { id: "ino-bypass", status: "requested" }, "assessed", { enforceEvidence: false }),
    (error) => error.code === "EVIDENCE_BYPASS_FORBIDDEN" && error.statusCode === 409
  );
});

test("nursing service start and completion require bound trace record confirmation and closed exceptions", () => {
  const accepted = {
    id: "ino-service-001",
    residentId: "r1",
    status: "accepted",
    nurseId: "inn-001",
    identityVerified: true,
    adverseEvent: { status: "none" }
  };
  const startEvidence = Domain.buildServiceStartEvidence("nursing", accepted, {
    lat: 38.915,
    lng: 121.616,
    source: "nurse-mobile",
    verified: true,
    identityMatched: true
  }, { at: NOW });
  assert.throws(
    () => Domain.transitionOrder("nursing", accepted, "in-service", {
      at: NOW,
      updates: {
        ...startEvidence,
        serviceCheckIn: { ...startEvidence.serviceCheckIn, checkedInAt: "2026-07-22T09:05:00+08:00" },
        locationTracePoints: startEvidence.locationTracePoints.map((item) => item.stage === "service-start" ? { ...item, lat: null } : item)
      }
    }),
    (error) => error.code === "ORDER_SERVICE_EVIDENCE_INVALID"
      && error.details.reasons.includes("service-start-trace-location-invalid")
      && error.details.reasons.includes("service-check-in-time-mismatch")
  );
  assert.equal(accepted.status, "accepted");
  const inService = Domain.transitionOrder("nursing", accepted, "in-service", {
    actorId: "inn-001",
    actorRole: "nurse",
    at: NOW,
    updates: startEvidence
  });
  assert.equal(inService.status, "in-service");
  assert.equal(inService.serviceCheckIn.subjectId, "inn-001");

  const completionAt = "2026-07-22T10:00:00+08:00";
  const completionEvidence = Domain.buildServiceCompletionEvidence("nursing", inService, {
    lat: 38.916,
    lng: 121.617,
    source: "nurse-mobile",
    verified: true,
    actions: ["identity check", "wound care", "health education"],
    residentConfirmed: true,
    signerName: "Resident A",
    exceptionReport: { status: "none" }
  }, { at: completionAt });
  const completed = Domain.transitionOrder("nursing", inService, "completed", {
    actorId: "inn-001",
    actorRole: "nurse",
    at: completionAt,
    updates: completionEvidence
  });
  assert.equal(completed.status, "completed");
  assert.equal(completed.serviceRecord.subjectId, "inn-001");
  assert.equal(completed.residentConfirmation.status, "confirmed");

  assert.throws(
    () => Domain.transitionOrder("nursing", inService, "completed", {
      at: completionAt,
      updates: { ...completionEvidence, residentConfirmation: { ...completionEvidence.residentConfirmation, status: "rejected" } }
    }),
    (error) => error.code === "ORDER_SERVICE_EVIDENCE_INVALID" && error.details.reasons.includes("resident-confirmation-not-confirmed")
  );
  assert.throws(
    () => Domain.transitionOrder("nursing", inService, "completed", {
      at: completionAt,
      updates: { ...completionEvidence, adverseEvent: { status: "open" } }
    }),
    (error) => error.code === "ORDER_SERVICE_EVIDENCE_INVALID" && error.details.reasons.includes("adverse-event-open")
  );
  assert.equal(inService.status, "in-service");
});

test("escort service evidence rejects cross-order and cross-worker records without mutation", () => {
  const confirmed = {
    id: "eso-service-001",
    residentId: "r1",
    status: "hospital-confirmed",
    workerId: "ew-001",
    identityVerified: true,
    adverseEvent: { status: "none" }
  };
  const startEvidence = Domain.buildServiceStartEvidence("escort", confirmed, {
    lat: 38.92,
    lng: 121.62,
    source: "escort-mobile",
    verified: true,
    identityMatched: true
  }, { at: NOW });
  const inService = Domain.transitionOrder("escort", confirmed, "in-service", { at: NOW, updates: startEvidence });
  const completionAt = "2026-07-22T10:00:00+08:00";
  const completionEvidence = Domain.buildServiceCompletionEvidence("escort", inService, {
    lat: 38.921,
    lng: 121.621,
    source: "escort-mobile",
    verified: true,
    actions: ["registration", "exam escort"],
    residentConfirmed: true,
    signerName: "Resident A",
    exceptionReport: { status: "none" }
  }, { at: completionAt });
  const completed = Domain.transitionOrder("escort", inService, "completed", { at: completionAt, updates: completionEvidence });
  assert.equal(completed.status, "completed");
  assert.deepEqual(completed.serviceRecord.serviceActions, ["registration", "exam escort"]);

  assert.throws(
    () => Domain.transitionOrder("escort", inService, "completed", {
      at: completionAt,
      updates: {
        ...completionEvidence,
        serviceRecord: { ...completionEvidence.serviceRecord, subjectId: "ew-forged" },
        locationTracePoints: completionEvidence.locationTracePoints.map((item) => item.stage === "service-complete" ? { ...item, orderId: "eso-other" } : item)
      }
    }),
    (error) => error.code === "ORDER_SERVICE_EVIDENCE_INVALID"
      && error.details.reasons.includes("service-record-subject-mismatch")
      && error.details.reasons.includes("service-complete-trace-order-mismatch")
  );
  assert.equal(inService.status, "in-service");
});

test("nursing adverse events require escalation and cannot close before resolution and quality review", () => {
  const inService = {
    id: "ino-risk-001",
    residentId: "r1",
    status: "in-service",
    nurseId: "inn-001"
  };
  const incidentEvidence = Domain.buildRiskIncidentEvidence("nursing", inService, {
    severity: "high",
    type: "resident-fall",
    description: "Resident slipped while moving from the bed.",
    ownerId: "risk-duty-001",
    channel: "emergency-duty",
    emergencyContactNotified: true
  }, { at: NOW });
  const incidentOrder = Domain.transitionOrder("nursing", inService, "adverse-event", { at: NOW, updates: incidentEvidence });
  assert.equal(incidentOrder.status, "adverse-event");
  assert.equal(incidentOrder.riskEscalation.incidentId, incidentOrder.adverseEvent.id);

  const missingEmergencyNotice = Domain.buildRiskIncidentEvidence("nursing", inService, {
    severity: "critical",
    type: "acute-deterioration",
    description: "Resident condition deteriorated.",
    ownerId: "risk-duty-002",
    emergencyContactNotified: false
  }, { at: NOW });
  assert.throws(
    () => Domain.transitionOrder("nursing", inService, "adverse-event", { at: NOW, updates: missingEmergencyNotice }),
    (error) => error.code === "ORDER_RISK_QUALITY_EVIDENCE_INVALID"
      && error.details.reasons.includes("emergency-contact-not-notified")
  );

  const callback = Domain.buildQualityReviewEvidence("nursing", incidentOrder, {
    reviewerId: "quality-001",
    result: "passed",
    notes: "Incident follow-up completed."
  }, { at: "2026-07-22T10:05:00+08:00" });
  const decision = Domain.buildQualityClosureEvidence("nursing", { ...incidentOrder, ...callback }, {
    reviewerId: "quality-001",
    basis: ["incident report", "resident callback"]
  }, { at: "2026-07-22T10:10:00+08:00" });
  assert.throws(
    () => Domain.transitionOrder("nursing", incidentOrder, "closed", { updates: { ...callback, ...decision } }),
    (error) => error.code === "ORDER_RISK_QUALITY_EVIDENCE_INVALID" && error.details.reasons.includes("incident-unresolved")
  );

  const resolution = Domain.buildRiskResolutionEvidence(incidentOrder, {
    resolution: "Resident assessed, family informed, and fall controls updated.",
    reviewedBy: "risk-reviewer-001"
  }, { at: "2026-07-22T10:00:00+08:00" });
  const closed = Domain.transitionOrder("nursing", incidentOrder, "closed", {
    at: "2026-07-22T10:10:00+08:00",
    updates: { ...resolution, ...callback, ...decision }
  });
  assert.equal(closed.status, "closed");
  assert.equal(closed.adverseEvent.status, "resolved");
  assert.equal(inService.status, "in-service");
});

test("escort complaints require owner SLA resolution resident notice and final quality decision", () => {
  const qualityReview = {
    id: "eso-complaint-001",
    residentId: "r1",
    status: "quality-review",
    workerId: "ew-001"
  };
  const complaintEvidence = Domain.buildComplaintEvidence("escort", qualityReview, {
    severity: "high",
    category: "service-attitude",
    description: "Resident reported an incomplete hospital handoff.",
    ownerId: "complaint-owner-001"
  }, { at: NOW });
  const complaintOrder = Domain.transitionOrder("escort", qualityReview, "complaint-open", { at: NOW, updates: complaintEvidence });
  assert.equal(complaintOrder.status, "complaint-open");
  assert.equal(complaintOrder.complaintStatus, "open");

  const missingOwner = Domain.buildComplaintEvidence("escort", qualityReview, {
    severity: "medium",
    category: "service-delay",
    description: "Escort arrived late."
  }, { at: NOW });
  assert.throws(
    () => Domain.transitionOrder("escort", qualityReview, "complaint-open", { at: NOW, updates: missingOwner }),
    (error) => error.code === "ORDER_RISK_QUALITY_EVIDENCE_INVALID"
      && error.details.reasons.includes("complaint-owner-missing")
  );

  const unresolvedCallback = Domain.buildQualityReviewEvidence("escort", complaintOrder, {
    reviewerId: "quality-escort-001",
    result: "follow-up-required",
    notes: "Complaint still requires resident confirmation."
  }, { at: "2026-07-22T10:05:00+08:00" });
  assert.throws(
    () => Domain.transitionOrder("escort", complaintOrder, "quality-review", { updates: unresolvedCallback }),
    (error) => error.code === "ORDER_RISK_QUALITY_EVIDENCE_INVALID" && error.details.reasons.includes("complaint-unresolved")
  );

  const overdueResolution = Domain.buildComplaintResolutionEvidence(complaintOrder, {
    resolution: "Late remediation completed.",
    resolvedBy: "complaint-owner-001",
    residentNotified: true
  }, { at: "2026-07-22T14:00:00+08:00" });
  const overdueCallback = Domain.buildQualityReviewEvidence("escort", { ...complaintOrder, ...overdueResolution }, {
    reviewerId: "quality-escort-001",
    result: "passed",
    notes: "Late remediation reviewed."
  }, { at: "2026-07-22T14:05:00+08:00" });
  assert.throws(
    () => Domain.transitionOrder("escort", complaintOrder, "quality-review", {
      updates: { ...overdueResolution, ...overdueCallback }
    }),
    (error) => error.code === "ORDER_RISK_QUALITY_EVIDENCE_INVALID"
      && error.details.reasons.includes("complaint-sla-breach-unexplained")
  );

  const resolution = Domain.buildComplaintResolutionEvidence(complaintOrder, {
    resolution: "Provider completed the handoff and apologized to the resident.",
    resolvedBy: "complaint-owner-001",
    residentNotified: true
  }, { at: "2026-07-22T10:00:00+08:00" });
  const callback = Domain.buildQualityReviewEvidence("escort", { ...complaintOrder, ...resolution }, {
    reviewerId: "quality-escort-001",
    result: "passed",
    notes: "Resident confirmed that remediation was completed."
  }, { at: "2026-07-22T10:05:00+08:00" });
  const reviewed = Domain.transitionOrder("escort", complaintOrder, "quality-review", {
    at: "2026-07-22T10:05:00+08:00",
    updates: { ...resolution, ...callback }
  });
  const followupCallback = Domain.buildQualityReviewEvidence("escort", reviewed, {
    reviewerId: "quality-escort-001",
    result: "follow-up-required",
    notes: "A second resident callback is still required."
  }, { at: "2026-07-22T10:06:00+08:00" });
  const prematureClosure = Domain.buildQualityClosureEvidence("escort", { ...reviewed, ...followupCallback }, {
    reviewerId: "quality-escort-001",
    basis: ["complaint resolution"]
  }, { at: "2026-07-22T10:10:00+08:00" });
  assert.throws(
    () => Domain.transitionOrder("escort", reviewed, "closed", {
      updates: { ...followupCallback, ...prematureClosure }
    }),
    (error) => error.code === "ORDER_RISK_QUALITY_EVIDENCE_INVALID"
      && error.details.reasons.includes("quality-follow-up-incomplete")
  );
  const closure = Domain.buildQualityClosureEvidence("escort", reviewed, {
    reviewerId: "quality-escort-001",
    basis: ["complaint resolution", "resident notification", "quality callback"]
  }, { at: "2026-07-22T10:10:00+08:00" });
  const closed = Domain.transitionOrder("escort", reviewed, "closed", {
    at: "2026-07-22T10:10:00+08:00",
    updates: closure
  });
  assert.equal(closed.status, "closed");
  assert.equal(closed.complaint.status, "resolved");
  assert.equal(closed.complaintStatus, "closed");
});

test("nursing settlement binds pricing dispatch callback and reconciliation to order and amount", () => {
  const completed = {
    id: "ino-financial-001",
    residentId: "r1",
    institutionCode: "MR1",
    status: "completed",
    feeEstimate: 168
  };
  const dispatchEvidence = Domain.buildSettlementDispatchEvidence("nursing", completed, { at: NOW });
  const pending = Domain.transitionOrder("nursing", completed, "settlement-pending", {
    at: NOW,
    actorId: "finance",
    actorRole: "finance",
    updates: dispatchEvidence
  });
  assert.equal(pending.status, "settlement-pending");
  assert.equal(pending.pricingConfirmation.amountFen, 16800);
  assert.equal(pending.financialDispatch.idempotencyKey, "nursing:ino-financial-001:settlement:v1");

  const settledAt = "2026-07-22T09:05:00+08:00";
  const completionEvidence = Domain.buildSettlementCompletionEvidence("nursing", pending, {
    providerTransactionId: "provider-tx-001",
    signatureVerified: true,
    digestVerified: true
  }, { at: settledAt });
  const settled = Domain.transitionOrder("nursing", pending, "settled", { at: settledAt, updates: completionEvidence });
  assert.equal(settled.status, "settled");
  assert.equal(settled.reconciliationResult.callbackId, settled.financialCallback.id);

  assert.throws(
    () => Domain.transitionOrder("nursing", pending, "settled", {
      at: settledAt,
      updates: {
        ...completionEvidence,
        financialCallback: { ...completionEvidence.financialCallback, status: "failed", amountFen: 1 },
        reconciliationResult: { ...completionEvidence.reconciliationResult, status: "difference" }
      }
    }),
    (error) => error.code === "ORDER_FINANCIAL_EVIDENCE_INVALID"
      && error.details.reasons.includes("financial-callback-not-succeeded")
      && error.details.reasons.includes("financial-callback-amount-mismatch")
      && error.details.reasons.includes("reconciliation-not-matched")
  );
  assert.equal(pending.status, "settlement-pending");
});

test("escort settlement rejects fabricated and cross-domain financial evidence without mutation", () => {
  const completed = {
    id: "eso-financial-001",
    residentId: "r1",
    status: "completed",
    feeEstimate: 120
  };
  const missingFee = { ...completed };
  delete missingFee.feeEstimate;
  assert.throws(
    () => Domain.buildSettlementDispatchEvidence("escort", missingFee, { at: NOW }),
    (error) => error.code === "FINANCIAL_AMOUNT_INVALID"
  );
  assert.throws(
    () => Domain.transitionOrder("escort", completed, "settlement-pending", {
      at: NOW,
      updates: {
        pricingConfirmedAt: NOW,
        pricingConfirmation: { status: "confirmed", amountFen: 12000 },
        financialDispatch: { status: "accepted", idempotencyKey: "forged" }
      }
    }),
    (error) => error.code === "ORDER_FINANCIAL_EVIDENCE_INVALID"
      && error.details.reasons.includes("pricing-order-mismatch")
      && error.details.reasons.includes("financial-dispatch-idempotency-mismatch")
  );

  const dispatchEvidence = Domain.buildSettlementDispatchEvidence("escort", completed, { at: NOW });
  const pending = Domain.transitionOrder("escort", completed, "settlement-pending", { at: NOW, updates: dispatchEvidence });
  const completionEvidence = Domain.buildSettlementCompletionEvidence("escort", pending, {
    providerTransactionId: "provider-tx-escort-001",
    signatureVerified: true,
    digestVerified: true
  }, { at: "2026-07-22T09:05:00+08:00" });
  assert.throws(
    () => Domain.transitionOrder("escort", pending, "settled", {
      at: "2026-07-22T09:05:00+08:00",
      updates: {
        ...completionEvidence,
        financialCallback: { ...completionEvidence.financialCallback, domain: "nursing" },
        reconciliationResult: { ...completionEvidence.reconciliationResult, callbackId: "other-callback" }
      }
    }),
    (error) => error.code === "ORDER_FINANCIAL_EVIDENCE_INVALID"
      && error.details.reasons.includes("financial-callback-domain-mismatch")
      && error.details.reasons.includes("reconciliation-callback-mismatch")
  );
  assert.equal(completed.status, "completed");
  assert.equal(pending.status, "settlement-pending");
});

test("nursing cancellation requires a bound resident request and approved no-refund decision", () => {
  const requested = {
    id: "ino-cancel-001",
    residentId: "r1",
    status: "requested"
  };
  const requestEvidence = Domain.buildCancellationRequestEvidence("nursing", requested, {
    requesterId: "r1",
    requesterRole: "resident",
    reasonCode: "schedule-conflict",
    reason: "Resident cannot receive the visit at the scheduled time.",
    refundRequested: false
  }, { at: NOW });
  const cancelRequested = Domain.transitionOrder("nursing", requested, "cancel-requested", {
    at: NOW,
    actorId: "r1",
    actorRole: "resident",
    updates: requestEvidence
  });
  assert.equal(cancelRequested.status, "cancel-requested");
  assert.equal(cancelRequested.cancellationRequest.orderId, requested.id);

  const missingRequester = Domain.buildCancellationRequestEvidence("nursing", requested, {
    reasonCode: "schedule-conflict",
    reason: "Missing requester must fail."
  }, { at: NOW });
  assert.throws(
    () => Domain.transitionOrder("nursing", requested, "cancel-requested", { at: NOW, updates: missingRequester }),
    (error) => error.code === "ORDER_CANCELLATION_REFUND_EVIDENCE_INVALID"
      && error.details.reasons.includes("cancellation-requester-missing")
  );

  const decisionEvidence = Domain.buildCancellationDecisionEvidence("nursing", cancelRequested, {
    outcome: "cancel",
    decidedBy: "nursing-duty-001",
    reason: "Cancellation is within the no-charge window."
  }, { at: "2026-07-22T09:05:00+08:00" });
  assert.throws(
    () => Domain.transitionOrder("nursing", cancelRequested, "cancelled", {
      updates: {
        ...decisionEvidence,
        cancellationDecision: { ...decisionEvidence.cancellationDecision, orderId: "other-order" }
      }
    }),
    (error) => error.code === "ORDER_CANCELLATION_REFUND_EVIDENCE_INVALID"
      && error.details.reasons.includes("cancellation-decision-order-mismatch")
  );
  const cancelled = Domain.transitionOrder("nursing", cancelRequested, "cancelled", {
    at: "2026-07-22T09:05:00+08:00",
    updates: decisionEvidence
  });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.cancellationDecision.refundRequired, false);
  assert.equal(requested.status, "requested");
});

test("escort cancellation can be withdrawn only with a bound resume decision", () => {
  const eligible = {
    id: "eso-cancel-001",
    residentId: "r2",
    status: "eligibility-checked"
  };
  const requestEvidence = Domain.buildCancellationRequestEvidence("escort", eligible, {
    requesterId: "family-001",
    requesterRole: "family",
    reasonCode: "family-review",
    reason: "Family requested a temporary cancellation review.",
    refundRequested: false
  }, { at: NOW });
  const cancelRequested = Domain.transitionOrder("escort", eligible, "cancel-requested", {
    at: NOW,
    updates: requestEvidence
  });
  const resumeEvidence = Domain.buildCancellationDecisionEvidence("escort", cancelRequested, {
    outcome: "resume",
    status: "withdrawn",
    decidedBy: "family-001",
    reason: "Family confirmed that the escort is still required."
  }, { at: "2026-07-22T09:03:00+08:00" });
  const resumed = Domain.transitionOrder("escort", cancelRequested, "requested", {
    at: "2026-07-22T09:03:00+08:00",
    updates: resumeEvidence
  });
  assert.equal(resumed.status, "requested");
  assert.equal(resumed.cancellationDecision.outcome, "resume");

  assert.throws(
    () => Domain.transitionOrder("escort", cancelRequested, "requested", {
      updates: {
        ...resumeEvidence,
        cancellationDecision: { ...resumeEvidence.cancellationDecision, status: "approved", outcome: "cancel" }
      }
    }),
    (error) => error.code === "ORDER_CANCELLATION_REFUND_EVIDENCE_INVALID"
      && error.details.reasons.includes("cancellation-resume-not-approved")
  );
});

test("nursing refund binds approval dispatch callback reconciliation amount and original payment", () => {
  const settled = {
    id: "ino-refund-001",
    residentId: "r1",
    status: "settled",
    financialCallback: {
      id: "settlement-callback-001",
      status: "succeeded",
      signatureStatus: "verified",
      providerTransactionId: "provider-payment-001",
      orderId: "ino-refund-001",
      domain: "nursing",
      amountFen: 16800,
      idempotencyKey: "nursing:ino-refund-001:settlement:v1",
      verifiedAt: NOW
    }
  };
  assert.throws(
    () => Domain.buildRefundDispatchEvidence("nursing", settled, {
      amountFen: 16801,
      reason: "Overpayment",
      requestedBy: "finance-001",
      approvedBy: "finance-reviewer-001"
    }, { at: NOW }),
    (error) => error.code === "REFUND_AMOUNT_INVALID"
  );

  const refundDispatch = Domain.buildRefundDispatchEvidence("nursing", settled, {
    amountFen: 5800,
    reason: "Insurance recalculation reduced the resident self-pay amount.",
    requestedBy: "finance-001",
    approvedBy: "finance-reviewer-001"
  }, { at: "2026-07-22T09:10:00+08:00" });
  const forged = {
    ...refundDispatch,
    refundRequest: { ...refundDispatch.refundRequest, sourceTransactionId: "other-payment" }
  };
  assert.throws(
    () => Domain.transitionOrder("nursing", settled, "refund-pending", { updates: forged }),
    (error) => error.code === "ORDER_CANCELLATION_REFUND_EVIDENCE_INVALID"
      && error.details.reasons.includes("refund-source-transaction-mismatch")
  );
  const pending = Domain.transitionOrder("nursing", settled, "refund-pending", {
    at: "2026-07-22T09:10:00+08:00",
    updates: refundDispatch
  });
  assert.equal(pending.status, "refund-pending");
  assert.equal(pending.refundDispatch.sourceTransactionId, "provider-payment-001");

  const completion = Domain.buildRefundCompletionEvidence("nursing", pending, {
    providerRefundId: "provider-refund-001",
    signatureVerified: true,
    digestVerified: true
  }, { at: "2026-07-22T09:15:00+08:00" });
  assert.throws(
    () => Domain.transitionOrder("nursing", pending, "refunded", {
      updates: {
        ...completion,
        refundCallback: { ...completion.refundCallback, signatureStatus: "rejected" },
        refundReconciliation: { ...completion.refundReconciliation, callbackId: "forged-callback" }
      }
    }),
    (error) => error.code === "ORDER_CANCELLATION_REFUND_EVIDENCE_INVALID"
      && error.details.reasons.includes("refund-callback-signature-invalid")
      && error.details.reasons.includes("refund-reconciliation-callback-mismatch")
  );
  const refunded = Domain.transitionOrder("nursing", pending, "refunded", {
    at: "2026-07-22T09:15:00+08:00",
    updates: completion
  });
  assert.equal(refunded.status, "refunded");
  assert.equal(refunded.refundReconciliation.callbackId, refunded.refundCallback.id);
  assert.equal(settled.status, "settled");
});

test("escort paid cancellation requires refund intent decision and verified payment receipt", () => {
  const accepted = {
    id: "eso-refund-001",
    residentId: "r2",
    status: "accepted",
    paymentReceipt: {
      id: "escort-payment-receipt-001",
      status: "paid",
      signatureStatus: "verified",
      providerTransactionId: "escort-payment-001",
      orderId: "eso-refund-001",
      domain: "escort",
      amountFen: 12000,
      idempotencyKey: "escort:eso-refund-001:create-payment:v1",
      paidAt: NOW,
      policyVersion: "nursing-escort-workflow-v1"
    }
  };
  assert.throws(
    () => Domain.buildRefundDispatchEvidence("escort", {
      ...accepted,
      paymentReceipt: { ...accepted.paymentReceipt, policyVersion: "unknown", paidAt: "" }
    }, {
      reason: "Invalid source receipt must fail.",
      requestedBy: "escort-duty-001",
      approvedBy: "finance-reviewer-002"
    }, { at: NOW }),
    (error) => error.code === "REFUND_SOURCE_PAYMENT_INVALID"
      && error.details.reasons.includes("refund-source-payment-policy-version-invalid")
      && error.details.reasons.includes("refund-source-payment-time-invalid")
  );
  const requestEvidence = Domain.buildCancellationRequestEvidence("escort", accepted, {
    requesterId: "r2",
    requesterRole: "resident",
    reasonCode: "appointment-cancelled",
    reason: "The hospital appointment was cancelled.",
    refundRequested: true
  }, { at: NOW });
  const cancelRequested = Domain.transitionOrder("escort", accepted, "cancel-requested", {
    at: NOW,
    updates: requestEvidence
  });
  const decision = Domain.buildCancellationDecisionEvidence("escort", cancelRequested, {
    outcome: "refund",
    decidedBy: "escort-duty-001",
    reason: "Verified hospital cancellation before service."
  }, { at: "2026-07-22T09:05:00+08:00" });
  const refundDispatch = Domain.buildRefundDispatchEvidence("escort", { ...cancelRequested, ...decision }, {
    reason: "Full refund for cancelled appointment.",
    requestedBy: "escort-duty-001",
    approvedBy: "finance-reviewer-002"
  }, { at: "2026-07-22T09:06:00+08:00" });
  const pending = Domain.transitionOrder("escort", cancelRequested, "refund-pending", {
    at: "2026-07-22T09:06:00+08:00",
    updates: { ...decision, ...refundDispatch }
  });
  assert.equal(pending.status, "refund-pending");
  assert.equal(pending.refundRequest.amountFen, 12000);

  const noRefundIntent = {
    ...cancelRequested,
    cancellationRequest: { ...cancelRequested.cancellationRequest, refundRequested: false }
  };
  assert.throws(
    () => Domain.transitionOrder("escort", noRefundIntent, "refund-pending", {
      updates: { ...decision, ...refundDispatch }
    }),
    (error) => error.code === "ORDER_CANCELLATION_REFUND_EVIDENCE_INVALID"
      && error.details.reasons.includes("cancellation-refund-not-requested")
  );
});

test("nursing reschedule releases the original slot and binds an approved replacement reservation", () => {
  const dispatchedBase = {
    id: "ino-reschedule-001",
    residentId: "r1",
    nurseId: "inn-001",
    status: "dispatched"
  };
  const reservation = Domain.buildResourceReservationEvidence("nursing", dispatchedBase, {
    resourceId: "nursing-slot-mr1-0900",
    slotAt: "2026-07-23T09:00:00+08:00",
    reservedBy: "dispatch-001"
  }, { at: "2026-07-21T09:00:00+08:00" });
  const dispatched = { ...dispatchedBase, ...reservation };
  const requestEvidence = Domain.buildRescheduleRequestEvidence("nursing", dispatched, {
    proposedSlotAt: "2026-07-24T14:00:00+08:00",
    requesterId: "r1",
    requesterRole: "resident",
    reason: "Resident has a conflicting outpatient appointment."
  }, { at: NOW });
  const forgedReservation = {
    ...reservation.resourceReservation,
    id: "forged-reservation",
    resourceId: "forged-slot"
  };
  const forgedRequest = Domain.buildRescheduleRequestEvidence("nursing", {
    ...dispatched,
    resourceReservation: forgedReservation
  }, {
    proposedSlotAt: "2026-07-24T14:00:00+08:00",
    requesterId: "r1",
    requesterRole: "resident",
    reason: "Attempt to replace the original reservation during request."
  }, { at: NOW });
  assert.throws(
    () => Domain.transitionOrder("nursing", dispatched, "reschedule-requested", {
      updates: { ...forgedRequest, resourceReservation: forgedReservation }
    }),
    (error) => error.code === "ORDER_SCHEDULING_EVIDENCE_INVALID"
      && error.details.reasons.includes("reschedule-original-reservation-mismatch")
  );
  const rescheduleRequested = Domain.transitionOrder("nursing", dispatched, "reschedule-requested", {
    at: NOW,
    updates: requestEvidence
  });
  assert.equal(rescheduleRequested.status, "reschedule-requested");
  assert.equal(rescheduleRequested.rescheduleRequest.originalReservationId, reservation.resourceReservation.id);

  const completion = Domain.buildRescheduleCompletionEvidence("nursing", rescheduleRequested, {
    decidedBy: "dispatch-reviewer-001",
    reason: "Replacement nurse slot is available.",
    resourceId: "nursing-slot-mr1-1400",
    reservedBy: "dispatch-reviewer-001"
  }, { at: "2026-07-22T09:10:00+08:00" });
  assert.throws(
    () => Domain.transitionOrder("nursing", rescheduleRequested, "requested", {
      updates: {
        ...completion,
        resourceReservation: { ...completion.resourceReservation, orderId: "other-order" }
      }
    }),
    (error) => error.code === "ORDER_SCHEDULING_EVIDENCE_INVALID"
      && error.details.reasons.includes("replacement-reservation-order-mismatch")
  );
  const rescheduled = Domain.transitionOrder("nursing", rescheduleRequested, "requested", {
    at: "2026-07-22T09:10:00+08:00",
    updates: completion
  });
  assert.equal(rescheduled.status, "requested");
  assert.equal(rescheduled.resourceRelease.reservationId, reservation.resourceReservation.id);
  assert.equal(rescheduled.resourceReservation.previousReservationId, reservation.resourceReservation.id);
  assert.equal(rescheduled.preferredAt, "2026-07-24T14:00:00+08:00");
  assert.equal(dispatched.status, "dispatched");

  const noReservation = {
    id: "ino-reschedule-missing-001",
    residentId: "r1",
    status: "requested"
  };
  const invalidRequest = Domain.buildRescheduleRequestEvidence("nursing", noReservation, {
    proposedSlotAt: "2026-07-24T14:00:00+08:00",
    requesterId: "r1",
    reason: "Missing original reservation."
  }, { at: NOW });
  assert.throws(
    () => Domain.transitionOrder("nursing", noReservation, "reschedule-requested", { updates: invalidRequest }),
    (error) => error.code === "ORDER_SCHEDULING_EVIDENCE_INVALID"
      && error.details.reasons.includes("resource-reservation-missing")
  );
});

test("escort no-show review requires grace-period attendance evidence and a bound human decision", () => {
  const confirmedBase = {
    id: "eso-no-show-001",
    residentId: "r2",
    workerId: "ew-001",
    status: "hospital-confirmed"
  };
  const reservation = Domain.buildResourceReservationEvidence("escort", confirmedBase, {
    resourceId: "hospital-mr1-checkin-0800",
    slotAt: "2026-07-22T08:00:00+08:00",
    reservedBy: "escort-dispatch-001"
  }, { at: "2026-07-21T08:00:00+08:00" });
  const confirmed = { ...confirmedBase, ...reservation };
  const premature = Domain.buildNoShowEvidence("escort", confirmed, {
    absentPartyRole: "resident",
    reporterId: "ew-001",
    presentPartyId: "ew-001",
    evidenceType: "hospital-check-in",
    verifierId: "hospital-desk-001",
    verified: true,
    graceMinutes: 30,
    capturedAt: "2026-07-22T08:15:00+08:00"
  }, { at: "2026-07-22T08:20:00+08:00" });
  assert.throws(
    () => Domain.transitionOrder("escort", confirmed, "no-show-review", { updates: premature }),
    (error) => error.code === "ORDER_SCHEDULING_EVIDENCE_INVALID"
      && error.details.reasons.includes("no-show-detected-before-grace-period")
  );

  const evidence = Domain.buildNoShowEvidence("escort", confirmed, {
    absentPartyRole: "resident",
    reporterId: "ew-001",
    presentPartyId: "ew-001",
    evidenceType: "hospital-check-in",
    verifierId: "hospital-desk-001",
    verified: true,
    graceMinutes: 30,
    capturedAt: "2026-07-22T08:35:00+08:00"
  }, { at: NOW });
  const review = Domain.transitionOrder("escort", confirmed, "no-show-review", {
    at: NOW,
    updates: evidence
  });
  assert.equal(review.status, "no-show-review");
  assert.equal(review.attendanceEvidence.reportId, review.noShowReport.id);

  const resumeDecision = Domain.buildNoShowDecisionEvidence("escort", review, {
    outcome: "resume",
    decidedBy: "escort-duty-001",
    reason: "Hospital confirmed the resident was delayed in another queue."
  }, { at: "2026-07-22T09:05:00+08:00" });
  assert.throws(
    () => Domain.transitionOrder("escort", review, "accepted", {
      updates: {
        ...resumeDecision,
        noShowDecision: { ...resumeDecision.noShowDecision, outcome: "cancel", status: "confirmed" }
      }
    }),
    (error) => error.code === "ORDER_SCHEDULING_EVIDENCE_INVALID"
      && error.details.reasons.includes("no-show-decision-outcome-invalid")
  );
  const resumed = Domain.transitionOrder("escort", review, "accepted", {
    at: "2026-07-22T09:05:00+08:00",
    updates: resumeDecision
  });
  assert.equal(resumed.status, "accepted");
  assert.equal(resumed.noShowDecision.status, "overturned");
});

test("confirmed no-show can enter reschedule and cancellation releases reserved resources", () => {
  const acceptedBase = {
    id: "ino-no-show-cancel-001",
    residentId: "r1",
    nurseId: "inn-001",
    status: "accepted"
  };
  const reservation = Domain.buildResourceReservationEvidence("nursing", acceptedBase, {
    resourceId: "nursing-slot-mr1-0800",
    slotAt: "2026-07-22T08:00:00+08:00",
    reservedBy: "dispatch-001"
  }, { at: "2026-07-21T08:00:00+08:00" });
  const accepted = { ...acceptedBase, ...reservation };
  const noShowEvidence = Domain.buildNoShowEvidence("nursing", accepted, {
    absentPartyRole: "resident",
    reporterId: "inn-001",
    presentPartyId: "inn-001",
    evidenceType: "geo-check-in",
    verifierId: "nursing-duty-001",
    verified: true,
    graceMinutes: 30,
    capturedAt: "2026-07-22T08:35:00+08:00"
  }, { at: NOW });
  const review = Domain.transitionOrder("nursing", accepted, "no-show-review", {
    at: NOW,
    updates: noShowEvidence
  });
  const noShowDecision = Domain.buildNoShowDecisionEvidence("nursing", review, {
    outcome: "cancel",
    decidedBy: "nursing-duty-001",
    reason: "Resident confirmed the service is no longer required."
  }, { at: "2026-07-22T09:05:00+08:00" });
  const cancelRequest = Domain.buildCancellationRequestEvidence("nursing", review, {
    requesterId: "r1",
    requesterRole: "resident",
    reasonCode: "resident-no-show",
    reason: "Resident confirmed cancellation after no-show review.",
    refundRequested: false
  }, { at: "2026-07-22T09:05:00+08:00" });
  const cancelRequested = Domain.transitionOrder("nursing", review, "cancel-requested", {
    at: "2026-07-22T09:05:00+08:00",
    updates: { ...noShowDecision, ...cancelRequest }
  });
  const cancellationDecision = Domain.buildCancellationDecisionEvidence("nursing", cancelRequested, {
    outcome: "cancel",
    decidedBy: "nursing-duty-001",
    reason: "No-show cancellation approved."
  }, { at: "2026-07-22T09:10:00+08:00" });
  assert.throws(
    () => Domain.transitionOrder("nursing", cancelRequested, "cancelled", { updates: cancellationDecision }),
    (error) => error.code === "ORDER_CANCELLATION_REFUND_EVIDENCE_INVALID"
      && error.details.reasons.includes("resource-release-missing")
  );
  const release = Domain.buildResourceReleaseEvidence("nursing", cancelRequested, {
    releasedBy: "dispatch-001",
    reason: "Release reserved nurse slot after approved cancellation."
  }, { at: "2026-07-22T09:11:00+08:00" });
  const cancelled = Domain.transitionOrder("nursing", cancelRequested, "cancelled", {
    at: "2026-07-22T09:11:00+08:00",
    updates: { ...cancellationDecision, ...release }
  });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.resourceRelease.reservationId, reservation.resourceReservation.id);
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
