const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  applyRegistrationDisruptionAction,
  applyRegistrationJourneyAction,
  applyRegistrationWaitlistAction,
  buildRegistrationJourneyCenter,
  buildRegistrationJourneyReadiness,
  buildRegistrationWaitlistCenter,
  normalizeRegistrationJourneyOrder,
  parseArgs,
  registrationDisruptionAllowedActions,
  registrationJourneyAllowedActions,
  registrationWaitlistAllowedActions,
  renderMarkdown,
  writeOutput
} = require("../scripts/registration-journey-readiness");

const ROOT = path.resolve(__dirname, "..");

function sampleOrder(overrides = {}) {
  return normalizeRegistrationJourneyOrder({
    id: "reg-test-001",
    residentId: "r1",
    hospitalCode: "MR1",
    status: "confirmed",
    scheduleLockStatus: "confirmed",
    paymentStatus: "pending",
    refundStatus: "none",
    insuranceStatus: "prechecked",
    ...overrides
  });
}

function replacementSchedule(overrides = {}) {
  return {
    id: "reg-sch-cardio-pm",
    hisScheduleId: "HIS-SCH-MR1-CARD-PM",
    hospitalCode: "MR1",
    hospital: "Hospital A",
    departmentCode: "CARD",
    department: "Cardiology",
    doctorCode: "DOC-CARD-03",
    doctor: "Doctor Chen",
    date: "2026-07-14",
    period: "PM",
    remaining: 8,
    fee: 18,
    status: "available",
    ...overrides
  };
}

test("registration journey closes payment confirmation check-in and completion", () => {
  let order = sampleOrder();
  assert.deepEqual(registrationJourneyAllowedActions(order, { role: "citizen" }), ["pay-demo"]);
  order = applyRegistrationJourneyAction(order, { action: "pay-demo", note: "resident paid in isolated demo", at: "2026-07-10T09:00:00.000Z" }, { role: "citizen", name: "Resident A" });
  assert.equal(order.paymentStatus, "paid-demo");
  assert.equal(order.productionReady, false);

  order = applyRegistrationJourneyAction(order, { action: "confirm-his-demo", note: "hospital confirmed queue", at: "2026-07-10T09:05:00.000Z" }, { role: "institution", name: "Hospital A" });
  assert.equal(order.hisConfirmationStatus, "confirmed-demo");

  order = applyRegistrationJourneyAction(order, { action: "check-in-demo", note: "resident checked in", at: "2026-07-10T09:10:00.000Z" }, { role: "citizen", name: "Resident A" });
  assert.equal(order.checkInStatus, "checked-in-demo");

  order = applyRegistrationJourneyAction(order, { action: "complete-demo", note: "consultation completed with local summary", at: "2026-07-10T09:30:00.000Z" }, { role: "institution", name: "Hospital A" });
  assert.equal(order.status, "completed");
  assert.equal(order.journeyStage, "completed-demo");
  assert.equal(order.auditTrail.length, 4);
});

test("registration journey keeps insurance and refund actions role scoped", () => {
  const order = sampleOrder({ paymentStatus: "paid-demo", status: "cancelled", refundStatus: "refund-pending" });
  assert.deepEqual(registrationJourneyAllowedActions(order, { role: "citizen" }), []);
  assert.throws(() => applyRegistrationJourneyAction(order, { action: "refund-demo", note: "resident cannot refund" }, { role: "citizen" }), /not allowed/);
  const refunded = applyRegistrationJourneyAction(order, { action: "refund-demo", note: "hospital recorded local refund" }, { role: "institution", name: "Hospital A" });
  assert.equal(refunded.refundStatus, "refunded-demo");
  assert.equal(refunded.productionReady, false);

  const insurance = applyRegistrationJourneyAction(sampleOrder(), { action: "confirm-insurance-demo", note: "insurance precheck confirmed" }, { role: "insurance", name: "Insurance A" });
  assert.equal(insurance.insuranceStatus, "confirmed-demo");
  assert.match(insurance.insuranceConfirmationNo, /^MI-CONF-DEMO-/);
});

test("registration disruption transfers a same-department slot after resident acceptance", () => {
  const current = sampleOrder({
    scheduleId: "reg-sch-cardio-am",
    hisScheduleId: "HIS-SCH-MR1-CARD-AM",
    departmentCode: "CARD",
    appointmentDate: "2026-07-12",
    period: "AM",
    doctorCode: "DOC-CARD-01",
    doctor: "Doctor Wang",
    hisVisitId: "HIS-OLD-001",
    registrationNo: "REG-OLD-001",
    queueNo: "A08",
    fee: 18
  });
  assert.deepEqual(registrationDisruptionAllowedActions(current, { role: "institution" }), ["notify"]);
  const notified = applyRegistrationDisruptionAction(current, {
    action: "notify",
    type: "doctor-unavailable",
    reason: "doctor clinic suspended",
    acknowledgementDueAt: "2026-07-11T18:00:00.000Z",
    at: "2026-07-10T10:00:00.000Z"
  }, { role: "institution", name: "Hospital A" }, replacementSchedule());
  assert.equal(notified.disruption.status, "pending-resident");
  assert.equal(notified.disruption.originalSchedule.registrationNo, "REG-OLD-001");
  assert.equal(notified.journeyStage, "reschedule-response-pending");
  assert.deepEqual(registrationJourneyAllowedActions(notified, { role: "citizen" }), []);
  assert.deepEqual(registrationDisruptionAllowedActions(notified, { role: "citizen" }), ["accept", "cancel"]);

  const accepted = applyRegistrationDisruptionAction(notified, {
    action: "accept",
    note: "resident accepts replacement slot",
    at: "2026-07-10T11:00:00.000Z"
  }, { role: "citizen", name: "Resident A" }, replacementSchedule());
  assert.equal(accepted.scheduleId, "reg-sch-cardio-pm");
  assert.equal(accepted.appointmentDate, "2026-07-14");
  assert.equal(accepted.doctor, "Doctor Chen");
  assert.equal(accepted.hisConfirmationStatus, "pending-demo");
  assert.equal(accepted.disruption.status, "accepted");
  assert.equal(accepted.disruption.paymentAdjustmentStatus, "not-required");
  assert.equal(accepted.journeyStage, "rescheduled-his-confirmation-pending");
  assert.equal(accepted.productionReady, false);

  const center = buildRegistrationJourneyCenter([notified, accepted]);
  assert.equal(center.summary.disruptionPending, 1);
  assert.equal(center.summary.rescheduled, 1);
});

test("registration disruption supports institution withdrawal and resident cancellation", () => {
  const current = sampleOrder({ scheduleId: "reg-sch-cardio-am", departmentCode: "CARD", appointmentDate: "2026-07-12" });
  const notify = () => applyRegistrationDisruptionAction(current, {
    action: "notify",
    reason: "schedule adjusted by hospital",
    acknowledgementDueAt: "2026-07-12T18:00:00.000Z",
    at: "2026-07-10T10:00:00.000Z"
  }, { role: "institution", name: "Hospital A" }, replacementSchedule());
  const withdrawn = applyRegistrationDisruptionAction(notify(), { action: "withdraw", note: "original clinic restored" }, { role: "institution", name: "Hospital A" });
  assert.equal(withdrawn.disruption.status, "withdrawn");
  const cancelled = applyRegistrationDisruptionAction(notify(), { action: "cancel", note: "resident requests cancellation" }, { role: "citizen", name: "Resident A" });
  assert.equal(cancelled.disruption.status, "cancelled");
  assert.throws(() => applyRegistrationDisruptionAction(current, {
    action: "notify",
    reason: "wrong department",
    acknowledgementDueAt: "2026-07-12T18:00:00.000Z",
    at: "2026-07-10T10:00:00.000Z"
  }, { role: "institution" }, replacementSchedule({ departmentCode: "ENDO" })), /same department/);
});

test("registration waitlist promotes FIFO and closes resident response states", () => {
  const schedule = replacementSchedule({ id: "reg-sch-full", remaining: 1 });
  const entries = [
    { id: "wait-2", residentId: "r4", scheduleId: schedule.id, status: "waiting", joinedAt: "2026-07-11T09:05:00.000Z" },
    { id: "wait-1", residentId: "r1", scheduleId: schedule.id, status: "waiting", joinedAt: "2026-07-11T09:00:00.000Z" }
  ];
  const center = buildRegistrationWaitlistCenter(entries, [schedule], Date.parse("2026-07-11T09:10:00.000Z"));
  const first = center.entries.find((item) => item.id === "wait-1");
  const second = center.entries.find((item) => item.id === "wait-2");
  assert.equal(first.position, 1);
  assert.equal(second.position, 2);
  assert.deepEqual(registrationWaitlistAllowedActions(first, { role: "institution" }, first), ["promote"]);
  assert.deepEqual(registrationWaitlistAllowedActions(second, { role: "institution" }, second), []);

  const offered = applyRegistrationWaitlistAction(first, {
    action: "promote",
    note: "released slot offered to first resident",
    offerMinutes: 30,
    at: "2026-07-11T09:10:00.000Z"
  }, { role: "institution", name: "Hospital A" }, first);
  assert.equal(offered.status, "offer-pending");
  assert.equal(offered.offerExpiresAt, "2026-07-11T09:40:00.000Z");
  const offeredContext = buildRegistrationWaitlistCenter([offered], [{ ...schedule, remaining: 0 }], Date.parse("2026-07-11T09:20:00.000Z")).entries[0];
  assert.deepEqual(registrationWaitlistAllowedActions(offered, { role: "citizen" }, offeredContext), ["accept", "decline"]);
  const accepted = applyRegistrationWaitlistAction(offered, { action: "accept", note: "resident accepts slot", at: "2026-07-11T09:20:00.000Z" }, { role: "citizen", name: "Resident A" }, offeredContext);
  assert.equal(accepted.status, "accepted");
  assert.equal(accepted.productionReady, false);

  const expiredContext = buildRegistrationWaitlistCenter([offered], [{ ...schedule, remaining: 0 }], Date.parse("2026-07-11T10:00:00.000Z")).entries[0];
  assert.deepEqual(registrationWaitlistAllowedActions(offered, { role: "citizen" }, expiredContext), []);
  assert.deepEqual(registrationWaitlistAllowedActions(offered, { role: "institution" }, expiredContext), ["expire"]);
  const expired = applyRegistrationWaitlistAction(offered, { action: "expire", note: "confirmation timeout", at: "2026-07-11T10:00:00.000Z" }, { role: "institution", name: "Hospital A" }, expiredContext);
  assert.equal(expired.status, "expired");
});

test("registration journey requires notes and reports production blockers", () => {
  assert.throws(() => applyRegistrationJourneyAction(sampleOrder(), { action: "pay-demo" }, { role: "citizen" }), /note is required/);
  const center = buildRegistrationJourneyCenter([sampleOrder()]);
  assert.equal(center.ok, true);
  assert.equal(center.summary.orders, 1);
  assert.equal(center.summary.productionReady, 0);
  assert.equal(center.summary.onsiteBlockers, 4);
});

test("registration journey readiness renders writes and parses flags", (t) => {
  const report = buildRegistrationJourneyReadiness();
  assert.equal(report.ok, true);
  assert.equal(report.checks.every((item) => item.passed), true);
  const markdown = renderMarkdown(report);
  assert.match(markdown, /Registration journey readiness report/);
  assert.match(markdown, /Production boundary/);

  const outputDir = path.join(ROOT, "tmp", "registration-journey-readiness-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  writeOutput(report, {
    output: path.join("tmp", "registration-journey-readiness-test", "report.json"),
    markdown: path.join("tmp", "registration-journey-readiness-test", "report.md")
  });
  assert.equal(JSON.parse(fs.readFileSync(path.join(outputDir, "report.json"), "utf8")).ok, true);
  assert.match(fs.readFileSync(path.join(outputDir, "report.md"), "utf8"), /registrationJourney:stateMachine/);

  const parsed = parseArgs(["--output=release/custom-registration.json", "--markdown=release/custom-registration.md"]);
  assert.match(parsed.output, /custom-registration\.json$/);
  assert.match(parsed.markdown, /custom-registration\.md$/);
});
