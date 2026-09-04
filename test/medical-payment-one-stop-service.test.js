"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const Service = require("../src/insurance-payment/medical-payment-one-stop-service");

const NOW = "2026-09-04T09:00:00.000Z";

function event(overrides = {}) {
  return {
    id: "payment-mr1",
    adapterType: "financial",
    gatewayType: "PAYMENT",
    operation: "create-payment",
    externalId: "ORDER-MR1",
    contractId: "payment-transaction-v1",
    receivedBy: "hospital",
    requestPayload: {
      payload: {
        orderNo: "ORDER-MR1",
        amountFen: 12_600,
        insuranceAmountFen: 8_000,
        institutionCode: "MR1",
        currency: "CNY"
      }
    },
    adapterReceipt: { receiptId: "PAY-MR1", status: "succeeded" },
    providerStatus: "succeeded",
    reconciliationStatus: "provider-final",
    businessDate: "2026-09-04",
    callbackEvents: [],
    ...overrides
  };
}

function refund(overrides = {}) {
  return {
    id: "refund-mr1",
    paymentEventId: "payment-mr1",
    orderReference: "ORDER-MR1",
    organizationId: "MR1",
    refundAmountFen: 2_000,
    reasonCode: "SERVICE_CANCELLED",
    state: "REQUESTED",
    status: "待业务与财务复核",
    reviewRevision: 1,
    reviews: [],
    attempts: [],
    events: [{ sequence: 1, action: "request", from: "NONE", to: "REQUESTED", previousHash: "GENESIS", hash: "invalid-fixture" }],
    requestedAt: "2026-09-04T08:30:00.000Z",
    ...overrides
  };
}

function state() {
  return {
    integrationGatewayEvents: [
      event(),
      event({
        id: "payment-mr2",
        externalId: "ORDER-MR2",
        requestPayload: { payload: { orderNo: "ORDER-MR2", amountFen: 9_900, institutionCode: "MR2", currency: "CNY" } },
        adapterReceipt: { receiptId: "PAY-MR2", status: "accepted" },
        providerStatus: "accepted"
      }),
      event({
        id: "insurance-mr1",
        gatewayType: "INSURANCE",
        operation: "settlement",
        externalId: "CLAIM-MR1",
        contractId: "insurance-settlement-v1",
        requestPayload: { payload: { claimNo: "CLAIM-MR1", amountFen: 8_000, institutionCode: "MR1" } },
        adapterReceipt: { receiptId: "SETTLEMENT-MR1", status: "succeeded" }
      }),
      event({
        id: "unscoped-payment",
        externalId: "ORDER-UNSCOPED",
        requestPayload: { payload: { orderNo: "ORDER-UNSCOPED", amountFen: 100, currency: "CNY" } },
        adapterReceipt: { receiptId: "PAY-UNSCOPED", status: "succeeded" }
      })
    ],
    financialReconciliationRuns: [{
      id: "reconciliation-payment-global",
      gatewayType: "PAYMENT",
      businessDate: "2026-09-03",
      providerSummary: { total: 1, succeeded: 1, exceptions: 0, grossAmountFen: 12_600, statementDigest: `sha256:${"a".repeat(64)}` },
      localSummary: { total: 1, succeeded: 1, exceptions: 0, grossAmountFen: 12_600 },
      createdAt: "2026-09-04T07:00:00.000Z",
      createdBy: "platform-operator"
    }],
    onlinePaymentRefunds: [refund(), refund({ id: "refund-mr2", paymentEventId: "payment-mr2", orderReference: "ORDER-MR2", organizationId: "MR2" })]
  };
}

test("institution payment center fails closed to its trusted organization scope", () => {
  const center = Service.buildMedicalPaymentOneStopCenter(state(), {
    role: "institution",
    orgType: "medical_institution",
    orgCode: "MR1",
    username: "hospital"
  }, {}, { now: NOW });

  assert.equal(center.schemaVersion, "medical-payment-one-stop-view-v1");
  assert.equal(center.productionReady, false);
  assert.deepEqual(center.queue.map((item) => item.id).sort(), ["insurance-mr1", "payment-mr1"]);
  assert.deepEqual(center.refunds.map((item) => item.id), ["refund-mr1"]);
  assert.equal(center.queue.find((item) => item.id === "payment-mr1").availableRefundFen, 10_600);
  assert.equal(center.queue.find((item) => item.id === "payment-mr1").personalAmountFen, 4_600);
  assert.equal(center.actions.dispatchPayment, true);
  assert.equal(center.actions.requestRefund, true);
  assert.equal(center.actions.reviewRefund, true);
  assert.equal(center.actions.runReconciliation, false);
  assert.deepEqual(center.reconciliationRuns, []);
  assert.equal(JSON.stringify(center).includes("ORDER-MR2"), false);
  assert.equal(JSON.stringify(center).includes("requestPayload"), false);
});

test("insurance payment center exposes only insurance operations and no merchant refunds", () => {
  const center = Service.buildMedicalPaymentOneStopCenter(state(), {
    role: "insurance",
    orgType: "insurance_center",
    orgCode: "INSURANCE-CENTER",
    username: "insurance"
  }, {}, { now: NOW });

  assert.deepEqual(center.queue.map((item) => item.id), ["insurance-mr1"]);
  assert.deepEqual(center.refunds, []);
  assert.equal(center.actions.dispatchPayment, false);
  assert.equal(center.actions.requestRefund, false);
  assert.equal(center.actions.reviewRefund, false);
  assert.equal(center.actions.runReconciliation, true);
  assert.equal(center.gateways.every((item) => item.type === "INSURANCE"), true);
});

test("commission payment center aggregates payment and insurance without leaking internal evidence", () => {
  const data = state();
  data.integrationGatewayEvents[0].requestPayload.payload.secret = "must-not-leak";
  data.integrationGatewayEvents[0].callbackEvents = [{ eventId: "callback-1", nonceDigest: "must-not-leak", status: "succeeded", occurredAt: NOW, receivedAt: NOW, stateApplied: true }];
  const center = Service.buildMedicalPaymentOneStopCenter(data, {
    role: "commission",
    orgType: "platform",
    orgCode: "PLATFORM",
    username: "city"
  }, {}, { now: NOW });

  assert.equal(center.queue.length, 4);
  assert.equal(center.refunds.length, 2);
  assert.equal(center.summary.orders, 4);
  assert.equal(center.actions.runReconciliation, true);
  const serialized = JSON.stringify(center);
  assert.doesNotMatch(serialized, /must-not-leak|nonceDigest|requestPayload|paymentTradeNo/);
});

test("unsupported or unbound institution actors cannot read the payment center", () => {
  assert.throws(
    () => Service.buildMedicalPaymentOneStopCenter(state(), { role: "citizen", orgType: "citizen", orgCode: "PERSON-1" }),
    (error) => error.code === "MEDICAL_PAYMENT_CENTER_ROLE_DENIED" && error.statusCode === 403
  );
  assert.throws(
    () => Service.buildMedicalPaymentOneStopCenter(state(), { role: "institution", orgType: "medical_institution", orgCode: "" }),
    (error) => error.code === "MEDICAL_PAYMENT_CENTER_SCOPE_REQUIRED" && error.statusCode === 403
  );
});
