const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  applyRegistrationJourneyAction,
  buildRegistrationJourneyCenter,
  buildRegistrationJourneyReadiness,
  normalizeRegistrationJourneyOrder,
  parseArgs,
  registrationJourneyAllowedActions,
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
