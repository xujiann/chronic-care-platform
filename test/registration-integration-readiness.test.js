const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  APPOINTMENT_CONTRACT_ID,
  applyRegistrationIntegrationCallback,
  buildRegistrationIntegrationCenter,
  buildRegistrationIntegrationReadiness,
  parseArgs,
  renderMarkdown,
  writeOutput
} = require("../scripts/registration-integration-readiness");

const ROOT = path.resolve(__dirname, "..");

function baseOrder(overrides = {}) {
  return {
    id: "reg-integration-001",
    residentId: "r1",
    hospitalCode: "MR1",
    registrationNo: "REG-INTEGRATION-001",
    scheduleId: "reg-sch-cardio-am",
    paymentStatus: "pending",
    hisConfirmationStatus: "pending-demo",
    insuranceStatus: "prechecked",
    checkInStatus: "not-checked-in",
    refundStatus: "none",
    status: "confirmed",
    productionReady: false,
    auditTrail: [],
    ...overrides
  };
}

function callback(eventType, sequence = 1, overrides = {}) {
  return {
    contractId: APPOINTMENT_CONTRACT_ID,
    idempotencyKey: `appointment-callback-${sequence}`,
    externalId: `APPT-CB-${sequence}`,
    residentId: "r1",
    orderNo: "REG-INTEGRATION-001",
    slotId: "reg-sch-cardio-am",
    eventType,
    orderStatus: eventType,
    occurredAt: `2026-07-10T10:0${sequence}:00.000Z`,
    ...overrides
  };
}

const institution = { role: "institution", orgCode: "MR1", username: "hospital", name: "Hospital integration" };
const insurance = { role: "insurance", orgCode: "ORG-MI", username: "insurance", name: "Insurance integration" };

test("appointment callbacks land a signed cross-system journey in order", () => {
  let rows = [baseOrder()];
  const paid = applyRegistrationIntegrationCallback(rows, callback("payment-succeeded", 1), {}, institution);
  rows = paid.orders;
  assert.equal(paid.order.paymentStatus, "paid");
  assert.equal(paid.receipt.reconciliationStatus, "matched");

  const his = applyRegistrationIntegrationCallback(rows, callback("his-confirmed", 2), {}, institution);
  rows = his.orders;
  assert.equal(his.order.hisConfirmationStatus, "confirmed");

  const insuranceResult = applyRegistrationIntegrationCallback(rows, callback("insurance-confirmed", 3), {}, insurance);
  rows = insuranceResult.orders;
  assert.equal(insuranceResult.order.insuranceStatus, "confirmed");

  const checkedIn = applyRegistrationIntegrationCallback(rows, callback("checked-in", 4), {}, institution);
  rows = checkedIn.orders;
  assert.equal(checkedIn.order.checkInStatus, "checked-in");

  const completed = applyRegistrationIntegrationCallback(rows, callback("completed", 5), {}, institution);
  assert.equal(completed.order.status, "completed");
  assert.equal(completed.order.journeyStage, "completed-callback");
  assert.equal(completed.order.productionReady, false);
  assert.equal(completed.order.auditTrail.every((item) => item.productionEvidence === false), true);
});

test("appointment callbacks enforce role scope and state ordering", () => {
  assert.throws(
    () => applyRegistrationIntegrationCallback([baseOrder()], callback("checked-in", 1), {}, institution),
    /requires an open order with payment and HIS confirmation/
  );
  assert.throws(
    () => applyRegistrationIntegrationCallback([baseOrder()], callback("his-confirmed", 2), {}, insurance),
    /cannot submit/
  );
  assert.throws(
    () => applyRegistrationIntegrationCallback([baseOrder()], callback("payment-succeeded", 3), {}, { ...institution, orgCode: "MR2" }),
    /scope denied/
  );
  assert.throws(
    () => applyRegistrationIntegrationCallback([baseOrder()], callback("unknown", 4), {}, institution),
    /unsupported/
  );
});

test("refund callbacks keep failure and completion reconciliation explicit", () => {
  let rows = [baseOrder({ status: "cancelled", paymentStatus: "refund-pending", refundStatus: "refund-pending" })];
  const failed = applyRegistrationIntegrationCallback(rows, callback("refund-failed", 1, { failureCode: "UPSTREAM-TIMEOUT" }), {}, institution);
  rows = failed.orders;
  assert.equal(failed.order.refundStatus, "refund-failed");
  assert.equal(failed.order.refundFailureCode, "UPSTREAM-TIMEOUT");
  const completed = applyRegistrationIntegrationCallback(rows, callback("refund-completed", 2, { receiptNo: "REFUND-RECEIPT-001" }), {}, institution);
  assert.equal(completed.order.paymentStatus, "refunded");
  assert.equal(completed.order.refundStatus, "refunded");
  assert.equal(completed.order.refundReceiptNo, "REFUND-RECEIPT-001");
});

test("integration center scopes callback receipts and preserves blockers", () => {
  const data = {
    integrationContracts: [{ id: APPOINTMENT_CONTRACT_ID }],
    registrationSchedules: [
      { id: "s1", hospitalCode: "MR1", hospital: "Hospital One", sourceSystem: "HIS-1" },
      { id: "s2", hospitalCode: "MR2", hospital: "Hospital Two", sourceSystem: "HIS-2" }
    ],
    registrationOrders: [baseOrder(), baseOrder({ id: "reg-2", registrationNo: "REG-2", hospitalCode: "MR2" })],
    integrationGatewayEvents: [
      { id: "e1", contractId: APPOINTMENT_CONTRACT_ID, orderId: "reg-integration-001", hospitalCode: "MR1", eventType: "his-confirmed", reconciliationStatus: "matched", signatureVerified: true },
      { id: "e2", contractId: APPOINTMENT_CONTRACT_ID, orderId: "reg-2", hospitalCode: "MR2", eventType: "payment-failed", reconciliationStatus: "unmatched", deadLetter: true },
      { id: "e3", contractId: APPOINTMENT_CONTRACT_ID, orderNo: "REG-INTEGRATION-001", requestPayload: { orderNo: "REG-INTEGRATION-001" }, eventType: "checked-in", reconciliationStatus: "dead-letter", deadLetter: true },
      { id: "e4", contractId: APPOINTMENT_CONTRACT_ID, orderId: "reg-integration-001", hospitalCode: "MR1", eventType: "checked-in", reconciliationStatus: "manual-review", deadLetter: true, manualReconciliation: { id: "case-open", status: "assigned", owner: "integration owner", dueAt: "2020-01-01", priority: "P0" } },
      { id: "e5", contractId: APPOINTMENT_CONTRACT_ID, orderId: "reg-integration-001", hospitalCode: "MR1", eventType: "checked-in", reconciliationStatus: "manual-resolved", deadLetter: false, manualReconciliation: { id: "case-resolved", status: "resolved", owner: "integration owner", dueAt: "2026-07-20", priority: "P1", evidenceRef: "receipt-001" } }
    ]
  };
  const commissionCenter = buildRegistrationIntegrationCenter(data, { role: "commission" });
  const institutionCenter = buildRegistrationIntegrationCenter(data, { role: "institution", orgCode: "MR1" });
  const insuranceCenter = buildRegistrationIntegrationCenter(data, { role: "insurance" });
  assert.equal(commissionCenter.summary.callbacks, 5);
  assert.equal(commissionCenter.summary.deadLetters, 3);
  assert.equal(institutionCenter.summary.callbacks, 4);
  assert.equal(institutionCenter.events.some((item) => item.id === "e3"), true);
  assert.equal(institutionCenter.summary.manualCases, 2);
  assert.equal(institutionCenter.summary.openManualCases, 1);
  assert.equal(institutionCenter.summary.overdueManualCases, 1);
  assert.equal(institutionCenter.summary.resolvedManualCases, 1);
  assert.equal(insuranceCenter.summary.callbacks, 1);
  assert.equal(commissionCenter.summary.productionReady, 0);
  assert.equal(commissionCenter.blockers.length, 5);
});

test("registration integration readiness renders and writes release evidence", (t) => {
  const report = buildRegistrationIntegrationReadiness();
  assert.equal(report.ok, true);
  assert.equal(report.checks.every((item) => item.passed), true);
  assert.equal(report.center.contract.id, APPOINTMENT_CONTRACT_ID);
  assert.match(renderMarkdown(report), /Registration integration readiness report/);

  const outputDir = path.join(ROOT, "tmp", "registration-integration-readiness-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const parsed = parseArgs([
    "--output=tmp/registration-integration-readiness-test/report.json",
    "--markdown=tmp/registration-integration-readiness-test/report.md"
  ]);
  writeOutput(report, parsed);
  assert.equal(JSON.parse(fs.readFileSync(path.join(outputDir, "report.json"), "utf8")).ok, true);
  assert.match(fs.readFileSync(path.join(outputDir, "report.md"), "utf8"), /Production boundary/);
});
