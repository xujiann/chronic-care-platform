const test = require("node:test");
const assert = require("node:assert/strict");

const data = require("../data/db.json");
const {
  UNIFIED_PHASES,
  applyClosureReferenceRepairs,
  normalizeChronicFollowupCase,
  normalizeFamilyDoctorCase,
  normalizePrimaryCareCase,
  normalizeReferralCase,
  normalizeRegistrationCase,
  planClosureReferenceRepairs,
  summarizeNotificationReceipts,
  validateClosureReferences,
  validateRegistrationCallbackTransition
} = require("../registration-referral-domain");

function brokenReferralData() {
  const fixture = JSON.parse(JSON.stringify(data));
  fixture.referralTeleconsultations = fixture.referralTeleconsultations.map((item) => ({ ...item, collaborationOrderId: "cco-001" }));
  return fixture;
}

function brokenNotificationData() {
  const fixture = JSON.parse(JSON.stringify(data));
  fixture.taskMessages.filter((item) => item.sourceId === "rtc-002").forEach((item) => { item.residentId = "r2"; });
  return fixture;
}

test("unified phases expose normal, continuity, cancellation and exception paths", () => {
  assert.ok(UNIFIED_PHASES.includes("requested"));
  assert.ok(UNIFIED_PHASES.includes("primary-care-followup-pending"));
  assert.ok(UNIFIED_PHASES.includes("closed"));
  assert.ok(UNIFIED_PHASES.includes("exception"));
});

test("registration responsibility moves from resident to institution to clinical team", () => {
  const base = { id: "reg-1", residentId: "r1", hospitalCode: "H1", paymentStatus: "pending", hisConfirmationStatus: "pending", checkInStatus: "not-checked-in", status: "confirmed" };
  const payment = normalizeRegistrationCase(base);
  assert.equal(payment.unifiedPhase, "payment-pending");
  assert.equal(payment.responsibleRole, "citizen");

  const confirmation = normalizeRegistrationCase({ ...base, paymentStatus: "paid" });
  assert.equal(confirmation.unifiedPhase, "payment-recorded");
  assert.equal(confirmation.responsibleRole, "institution-registration");

  const service = normalizeRegistrationCase({ ...base, paymentStatus: "paid", hisConfirmationStatus: "confirmed", checkInStatus: "checked-in" });
  assert.equal(service.unifiedPhase, "service-in-progress");
  assert.equal(service.responsibleRole, "receiving-clinical-team");
  assert.equal(service.productionEvidence, false);
});

test("primary care assessment maps local management and referral hand-off responsibilities", () => {
  const local = normalizePrimaryCareCase({ id: "pca-1", residentId: "r1", institutionCode: "P1", status: "completed", disposition: "manage-locally", nextFollowupAt: "2026-08-01" });
  assert.equal(local.unifiedPhase, "service-in-progress");
  assert.equal(local.responsibleRole, "primary-care-team");
  const referral = normalizePrimaryCareCase({ id: "pca-2", residentId: "r1", institutionCode: "P1", status: "referred", disposition: "teleconsultation", referralId: "rf1" });
  assert.equal(referral.unifiedPhase, "accepted");
  assert.equal(referral.responsibleRole, "referral-center");
});

test("registration disruption and refund failures remain explicit exceptions", () => {
  const disrupted = normalizeRegistrationCase({ id: "reg-2", status: "confirmed", disruption: { status: "pending-resident", acknowledgementDueAt: "2026-08-01T10:00:00Z" } });
  assert.equal(disrupted.unifiedPhase, "exception");
  assert.equal(disrupted.exceptionState, "resident-response-pending");
  assert.equal(disrupted.responsibleRole, "citizen");

  const refund = normalizeRegistrationCase({ id: "reg-3", hospitalCode: "H1", status: "cancelled", refundStatus: "refund-failed" });
  assert.equal(refund.unifiedPhase, "exception");
  assert.equal(refund.exceptionState, "refund-failed");
  assert.equal(refund.responsibleRole, "institution-finance");
});

test("terminal registration rejects late insurance callbacks", () => {
  assert.deepEqual(validateRegistrationCallbackTransition({ status: "completed" }, "insurance-confirmed"), {
    allowed: false,
    reason: "callback is not allowed after order closure"
  });
  assert.equal(validateRegistrationCallbackTransition({ status: "confirmed", paymentStatus: "paid", hisConfirmationStatus: "confirmed" }, "checked-in").allowed, true);
  assert.equal(validateRegistrationCallbackTransition({ status: "cancelled", refundStatus: "refund-failed" }, "refund-completed").allowed, true);
});

test("report return waits for primary care acknowledgement before closure", () => {
  const item = { id: "rtc-1", residentId: "r1", status: "report-returned", reportStatus: "returned", targetInstitutionCode: "P1" };
  const pending = normalizeReferralCase(item, { messages: [{ id: "m1", sourceId: "rtc-1", status: "sent", receipts: [] }] });
  assert.equal(pending.unifiedPhase, "primary-care-followup-pending");
  assert.equal(pending.responsibleRole, "primary-care-institution");
  assert.equal(pending.receiptState, "missing");

  const closed = normalizeReferralCase({ ...item, status: "closed" }, { messages: [{ id: "m1", sourceId: "rtc-1", status: "handled", receipts: [{ status: "handled" }] }] });
  assert.equal(closed.unifiedPhase, "closed");
});

test("notification receipt summary distinguishes sending, delivery and acknowledgement", () => {
  const sent = summarizeNotificationReceipts([{ sourceId: "case-1", status: "sent", receipts: [] }], "case-1");
  assert.equal(sent.notificationState, "sent-unconfirmed");
  assert.equal(sent.receiptState, "missing");

  const delivered = summarizeNotificationReceipts([{ sourceId: "case-1", status: "sent", receipts: [{ status: "delivered" }] }], "case-1");
  assert.equal(delivered.notificationState, "delivered-unacknowledged");
  assert.equal(delivered.receiptState, "delivery-only");

  const acknowledged = summarizeNotificationReceipts([{ sourceId: "case-1", status: "handled", receipts: [{ status: "handled" }] }], "case-1");
  assert.equal(acknowledged.notificationState, "acknowledged");
  assert.equal(acknowledged.receiptState, "acknowledged");
});

test("family doctor applications and contracts retain distinct responsibilities", () => {
  const application = normalizeFamilyDoctorCase({ id: "p2fda-1", residentId: "r1", reviewStatus: "pending", reviewInstitutionCode: "P1" });
  assert.equal(application.unifiedPhase, "requested");
  assert.equal(application.responsibleRole, "institution-review");

  const contract = normalizeFamilyDoctorCase({ id: "p2fdc-1", residentId: "r1", status: "active", fulfillmentPercent: 70, nextServiceAt: "2026-08-10" });
  assert.equal(contract.unifiedPhase, "service-in-progress");
  assert.equal(contract.responsibleRole, "family-doctor-team");
});

test("completed chronic follow-up still requires resident acknowledgement", () => {
  const item = { id: "f1", residentId: "r1", institutionCode: "P1", status: "completed" };
  const pending = normalizeChronicFollowupCase(item, { messages: [{ sourceId: "f1", status: "sent", receipts: [{ status: "delivered" }] }] });
  assert.equal(pending.unifiedPhase, "result-returned");
  assert.equal(pending.responsibleRole, "citizen");

  const closed = normalizeChronicFollowupCase(item, { messages: [{ sourceId: "f1", status: "handled", receipts: [{ status: "handled" }] }] });
  assert.equal(closed.unifiedPhase, "closed");
});

test("reference validator exposes referral linkage blockers without claiming production readiness", () => {
  const report = validateClosureReferences(brokenReferralData());
  assert.equal(report.functionalOk, true);
  assert.equal(report.dataReady, false);
  assert.equal(report.productionReady, false);
  assert.equal(report.summary.P0, 3);
  assert.ok(report.issues.some((issue) => issue.code === "teleconsult-referral-collaboration-mismatch" && issue.entityId === "rtc-001"));
  assert.ok(report.issues.some((issue) => issue.code === "teleconsult-referral-collaboration-mismatch" && issue.entityId === "rtc-002"));
  assert.ok(report.issues.some((issue) => issue.code === "teleconsult-collaboration-resident-mismatch" && issue.entityId === "rtc-002"));
  assert.ok(!report.issues.some((issue) => issue.entityId === "p2fdc-r2"), "a pending renewal may legitimately point back to its existing contract");
});

test("reference validator accepts a consistent minimal chain", () => {
  const fixture = {
    registrationSchedules: [{ id: "s1", hospitalCode: "H1", departmentCode: "D1" }],
    registrationOrders: [{ id: "reg-1", residentId: "r1", scheduleId: "s1", hospitalCode: "H1", departmentCode: "D1" }],
    referralSystem: { referrals: [{ id: "rf1", residentId: "r1", collaborationOrderId: "cco1" }] },
    countyCollaborationOrders: [{ id: "cco1", residentId: "r1" }],
    personalRecords: [{ id: "auth1", residentId: "r1", category: "authorizations" }],
    referralTeleconsultations: [{ id: "rtc1", residentId: "r1", referralId: "rf1", collaborationOrderId: "cco1", residentAuthorizationId: "auth1" }],
    phase2FamilyDoctorApplications: [{ id: "app1", residentId: "r1", packageId: "pkg1", teamId: "team1", reviewStatus: "approved" }],
    phase2FamilyDoctorContracts: [{ id: "contract1", applicationId: "app1", residentId: "r1", packageId: "pkg1", teamId: "team1" }],
    phase2FamilyDoctorFulfillments: [{ id: "fulfillment1", contractId: "contract1", residentId: "r1", packageId: "pkg1", teamId: "team1" }]
  };
  const report = validateClosureReferences(fixture);
  assert.equal(report.dataReady, true);
  assert.equal(report.summary.total, 0);
});

test("repair planner proposes two resident-consistent collaboration order replacements", () => {
  const plan = planClosureReferenceRepairs(brokenReferralData());
  assert.equal(plan.persistenceMutation, false);
  assert.equal(plan.safeToApply, true);
  assert.equal(plan.summary.p0Before, 3);
  assert.equal(plan.summary.safeRepairs, 2);
  assert.equal(plan.summary.manualReviews, 0);
  assert.equal(plan.summary.p0AfterRehearsal, 0);
  assert.deepEqual(plan.repairs.map((item) => [item.entityId, item.from, item.to]), [
    ["rtc-001", "cco-001", "cco-004"],
    ["rtc-002", "cco-001", "cco-005"]
  ]);
  assert.ok(plan.repairs.every((item) => item.impactedSources.some((source) => source.includes("seedReferralTeleconsultations"))));
});

test("repair application validates preconditions and never mutates source data", () => {
  const source = brokenReferralData();
  const original = JSON.parse(JSON.stringify(source.referralTeleconsultations));
  const plan = planClosureReferenceRepairs(source);
  const result = applyClosureReferenceRepairs(source, plan);
  assert.equal(result.persistenceMutation, false);
  assert.equal(result.applied.length, 2);
  assert.equal(result.consistency.dataReady, true);
  assert.equal(result.consistency.summary.P0, 0);
  assert.deepEqual(source.referralTeleconsultations, original);

  const stale = JSON.parse(JSON.stringify(source));
  stale.referralTeleconsultations[0].collaborationOrderId = "cco-stale";
  assert.throws(() => applyClosureReferenceRepairs(stale, plan), /precondition failed/);
});

test("repair planner sends resident-unsafe authoritative targets to manual review", () => {
  const unsafe = brokenReferralData();
  const target = unsafe.countyCollaborationOrders.find((item) => item.id === "cco-005");
  target.residentId = "different-resident";
  const plan = planClosureReferenceRepairs(unsafe);
  assert.equal(plan.summary.safeRepairs, 1);
  assert.equal(plan.summary.manualReviews, 1);
  assert.equal(plan.safeToApply, false);
  assert.equal(plan.manualReviews[0].entityId, "rtc-002");
});

test("notification resident mismatch is P0 and can be safely rehearsed from its source", () => {
  const fixture = brokenNotificationData();
  const validation = validateClosureReferences(fixture);
  assert.equal(validation.summary.P0, 2);
  assert.ok(validation.issues.every((item) => item.code === "notification-source-resident-mismatch"));
  const plan = planClosureReferenceRepairs(fixture);
  assert.equal(plan.summary.safeRepairs, 2);
  assert.ok(plan.repairs.every((item) => item.collection === "taskMessages" && item.to === "r4"));
  const rehearsed = applyClosureReferenceRepairs(fixture, plan);
  assert.equal(rehearsed.consistency.dataReady, true);
  assert.ok(rehearsed.data.taskMessages.filter((item) => item.sourceId === "rtc-002").every((item) => item.residentId === "r4"));
});
