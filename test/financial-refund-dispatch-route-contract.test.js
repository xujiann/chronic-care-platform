"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const Refunds = require("../online-payment-refunds");
const {
  FinancialCallbackError,
  financialDispatchRequestDigest,
  withFinancialDispatchLock,
  withFinancialDispatchStateLock
} = require("../financial-gateways");
const { createRouteSegments } = require("../src/http/routes/insurance-payment");

function approvedRefundState() {
  const data = {
    integrationGatewayEvents: [{
      id: "refund-source-payment-001",
      adapterType: "financial",
      gatewayType: "PAYMENT",
      operation: "create-payment",
      externalId: "REFUND-SOURCE-ORDER-001",
      adapterReceipt: { receiptId: "REFUND-SOURCE-TRADE-001", status: "succeeded" },
      requestPayload: { payload: { orderNo: "REFUND-SOURCE-ORDER-001", amountFen: 5000 } },
      providerStatus: "succeeded",
      reconciliationStatus: "provider-final"
    }],
    onlinePaymentRefunds: [],
    financialReconciliationRuns: [],
    securityEvents: []
  };
  const refund = Refunds.createRefundRequest(data, {
    id: "refund-route-contract-001",
    paymentEventId: "refund-source-payment-001",
    paymentTradeNo: "REFUND-SOURCE-TRADE-001",
    orderReference: "REFUND-SOURCE-ORDER-001",
    refundAmountFen: 1200,
    refundReason: "service cancelled",
    reasonCode: "SERVICE_CANCELLED",
    idempotencyKey: "refund-route-request-001"
  }, { username: "institution-requester" }).row;
  Refunds.reviewRefundRequest(data, refund.id, {
    approved: true,
    reviewDomain: "business-review"
  }, { username: "business-reviewer" });
  Refunds.reviewRefundRequest(data, refund.id, {
    approved: true,
    reviewDomain: "finance-review"
  }, { username: "finance-reviewer" });
  return data;
}

function createHarness(options = {}) {
  let persisted = approvedRefundState();
  let sequence = 0;
  const calls = { dispatches: 0, order: [], writes: [] };
  const runtime = {
    FinancialCallbackError,
    OnlinePaymentRefunds: Refunds,
    authorizeInsurancePaymentAction: () => true,
    collectJson: (req) => Promise.resolve(structuredClone(req.body || {})),
    async dispatchFinancialRequest(requestPayload) {
      calls.dispatches += 1;
      calls.order.push("provider");
      if (options.dispatchBarrier) await options.dispatchBarrier();
      if (options.dispatchError) throw options.dispatchError;
      return {
        type: "PAYMENT",
        operation: "refund",
        contractId: requestPayload.contractId,
        idempotencyKey: requestPayload.idempotencyKey,
        requestId: "refund-route-request-provider-001",
        receiptId: "refund-route-receipt-provider-001",
        status: options.receiptStatus || "accepted",
        acceptedAt: "2026-08-23T10:00:00.000Z",
        attempts: 1
      };
    },
    financialDispatchRequestDigest,
    normalizeState: (value) => value,
    prependAuditTrailEntry: (trail, entry) => [entry, ...(Array.isArray(trail) ? trail : [])],
    randomUUID: () => `refund-route-generated-${++sequence}`,
    readDatabase: () => structuredClone(persisted),
    requireApiRole: () => ({ username: "commission-refund", name: "委端退费员", role: "commission" }),
    sendInsurancePaymentError(res, error) {
      res.status = Number(error?.statusCode || 409);
      res.body = { code: error?.code || "INSURANCE_PAYMENT_COMMAND_REJECTED", message: error?.message || "command rejected" };
    },
    sendJson(res, status, body) {
      res.status = status;
      res.body = body;
    },
    withFinancialDispatchLock,
    withFinancialDispatchStateLock,
    writeDatabase(next, writeOptions = {}) {
      calls.order.push(`write:${writeOptions.financialGatewayWrite?.kind || "generic"}`);
      calls.writes.push({ state: structuredClone(next), options: structuredClone(writeOptions) });
      if (options.writeErrorAt === calls.writes.length) throw new Error("refund storage unavailable: secret");
      persisted = structuredClone(next);
    }
  };
  const segment = createRouteSegments(runtime).find((item) => item.id === "insurance-payment-02");
  return {
    calls,
    getPersisted: () => structuredClone(persisted),
    async request() {
      const res = {};
      const handled = await segment.handle(
        { method: "POST", headers: {}, body: {} },
        res,
        new URL("http://platform.test/api/online-payments/refunds/refund-route-contract-001/dispatch")
      );
      assert.equal(handled, true);
      return res;
    }
  };
}

test("refund dispatch reserves before provider call, finalizes atomically and replays", async () => {
  const harness = createHarness();
  const first = await harness.request();
  const replay = await harness.request();

  assert.equal(first.status, 202);
  assert.equal(first.body.refund.state, "DISPATCHED");
  assert.equal(first.body.idempotent, false);
  assert.equal(replay.status, 202);
  assert.equal(replay.body.idempotent, true);
  assert.equal(replay.body.gatewayEventId, first.body.gatewayEventId);
  assert.equal(harness.calls.dispatches, 1);
  assert.deepEqual(harness.calls.order, ["write:reserve", "provider", "write:finalize"]);
  assert.equal(harness.calls.writes[0].state.integrationGatewayEvents[0].status, "dispatching");
  assert.equal(harness.getPersisted().integrationGatewayEvents[0].status, "accepted");
});

test("a synchronous succeeded refund receipt projects the refund to its terminal state", async () => {
  const harness = createHarness({ receiptStatus: "succeeded" });
  const response = await harness.request();

  assert.equal(response.status, 202);
  assert.equal(response.body.refund.state, "SUCCEEDED");
  assert.equal(harness.getPersisted().onlinePaymentRefunds[0].state, "SUCCEEDED");
  assert.equal(harness.getPersisted().integrationGatewayEvents[0].providerStatus, "succeeded");
});

test("concurrent refund dispatches with the same key call the provider once", async () => {
  let enterProvider;
  const providerEntered = new Promise((resolve) => { enterProvider = resolve; });
  let releaseProvider;
  const providerReleased = new Promise((resolve) => { releaseProvider = resolve; });
  const harness = createHarness({
    dispatchBarrier: async () => {
      enterProvider();
      await providerReleased;
    }
  });

  const firstPromise = harness.request();
  await providerEntered;
  const secondPromise = harness.request();
  releaseProvider();
  const [first, second] = await Promise.all([firstPromise, secondPromise]);

  assert.equal(first.status, 202);
  assert.equal(second.status, 202);
  assert.equal(second.body.idempotent, true);
  assert.equal(harness.calls.dispatches, 1);
  assert.equal(harness.getPersisted().integrationGatewayEvents.filter((item) => item.operation === "refund").length, 1);
});

test("refund dispatch reservation failure performs no provider call", async () => {
  const harness = createHarness({ writeErrorAt: 1 });
  const response = await harness.request();

  assert.equal(response.status, 500);
  assert.equal(response.body.code, "REFUND_DISPATCH_STORAGE_FAILED");
  assert.equal(response.body.message, "refund dispatch storage failed");
  assert.doesNotMatch(JSON.stringify(response.body), /secret/);
  assert.equal(harness.calls.dispatches, 0);
  assert.equal(harness.getPersisted().onlinePaymentRefunds[0].state, "APPROVED");
});

test("refund dispatch final write failure is redacted and replays the reservation without redispatch", async () => {
  const harness = createHarness({ writeErrorAt: 2 });
  const failed = await harness.request();
  const replay = await harness.request();

  assert.equal(failed.status, 500);
  assert.equal(failed.body.code, "REFUND_DISPATCH_STORAGE_FAILED");
  assert.doesNotMatch(JSON.stringify(failed.body), /secret/);
  assert.equal(replay.status, 202);
  assert.equal(replay.body.idempotent, true);
  assert.equal(harness.calls.dispatches, 1);
  assert.equal(harness.getPersisted().integrationGatewayEvents[0].status, "dispatching");
});

test("refund dispatch provider failure is redacted and leaves a reconciliation event", async () => {
  const harness = createHarness({ dispatchError: new Error("refund-provider-secret-must-not-leak") });
  const response = await harness.request();

  assert.equal(response.status, 502);
  assert.equal(response.body.code, "REFUND_DISPATCH_PROVIDER_REJECTED");
  assert.equal(response.body.message, "refund gateway dispatch failed");
  assert.equal(harness.calls.dispatches, 1);
  assert.equal(harness.getPersisted().integrationGatewayEvents[0].status, "failed");
  assert.equal(harness.getPersisted().integrationGatewayEvents[0].failureCode, "REFUND_DISPATCH_PROVIDER_REJECTED");
  assert.equal(harness.getPersisted().securityEvents[0].action, "dispatch online payment refund");
  assert.equal(harness.getPersisted().securityEvents[0].result, "failed");
  assert.doesNotMatch(JSON.stringify(response.body), /refund-provider-secret/);
  assert.doesNotMatch(JSON.stringify(harness.getPersisted()), /refund-provider-secret/);
});
