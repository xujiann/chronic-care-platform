"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  FinancialCallbackError,
  applyFinancialCallback,
  financialDispatchRequestDigest,
  validateFinancialRequest,
  withFinancialDispatchLock,
  withFinancialDispatchStateLock
} = require("../financial-gateways");
const { createRouteSegments: createIntegrationRouteSegments } = require("../src/http/routes/integration");
const { createRouteSegments: createInsurancePaymentRouteSegments } = require("../src/http/routes/insurance-payment");

function initialEvent(overrides = {}) {
  const idempotencyKey = overrides.idempotencyKey || "financial-retry-key-001";
  return {
    id: "financial-retry-event-001",
    direction: "outbound",
    adapterType: "financial",
    gatewayType: "PAYMENT",
    operation: "create-payment",
    contractId: "payment-transaction-v1",
    status: "failed",
    deadLetter: true,
    deadLetterReason: "financial gateway provider dispatch failed",
    retryCount: 0,
    requestPayload: {
      type: "PAYMENT",
      operation: "create-payment",
      contractId: "payment-transaction-v1",
      idempotencyKey,
      payload: { orderNo: "ORDER-RETRY-001", amountFen: 1200, currency: "CNY" }
    },
    ...overrides,
    idempotencyKey
  };
}

function createHarness(options = {}) {
  let persisted = structuredClone(options.initialState || {
    integrationGatewayEvents: [initialEvent()],
    securityEvents: []
  });
  let sequence = 0;
  let activeDispatches = 0;
  const calls = { dispatches: 0, maxActiveDispatches: 0, writes: [] };
  const runtime = {
    FinancialCallbackError,
    OnlinePaymentRefunds: {},
    appendSecurityEvent: () => {},
    applyFinancialCallback,
    collectJson: (req) => Promise.resolve(structuredClone(req.body || {})),
    dispatchFinancialRequest: async (requestPayload) => {
      calls.dispatches += 1;
      activeDispatches += 1;
      calls.maxActiveDispatches = Math.max(calls.maxActiveDispatches, activeDispatches);
      try {
        if (options.dispatchBarrier) await options.dispatchBarrier();
        if (options.mutateDuringDispatch) persisted = structuredClone(options.mutateDuringDispatch(structuredClone(persisted)));
        if (options.dispatchError) throw options.dispatchError;
        return {
          receiptId: `retry-receipt-${calls.dispatches}`,
          requestId: `retry-request-${calls.dispatches}`,
          status: "accepted",
          acceptedAt: "2026-08-23T09:00:00.000Z",
          attempts: 1,
          type: requestPayload.type
        };
      } finally {
        activeDispatches -= 1;
      }
    },
    financialDispatchRequestDigest,
    normalizeState: (value) => value,
    prependAuditTrailEntry: (trail, entry) => [entry, ...(Array.isArray(trail) ? trail : [])],
    randomUUID: () => `retry-generated-${++sequence}`,
    readDatabase: () => structuredClone(persisted),
    requireApiRole: () => ({ username: "commission-reviewer", name: "委端审核员", role: "commission" }),
    sendJson(res, status, body) {
      res.status = status;
      res.body = body;
    },
    withFinancialDispatchLock,
    withFinancialDispatchStateLock,
    verifyFinancialCallback: (payload) => ({
      eventId: payload.eventId,
      gatewayType: "PAYMENT",
      receiptId: payload.receiptId,
      status: payload.status,
      occurredAt: payload.occurredAt,
      receivedAt: payload.occurredAt,
      businessDate: payload.businessDate,
      amountFen: payload.amountFen,
      providerCode: payload.providerCode || "",
      failureReason: "",
      settlementReferenceDigest: "",
      nonceDigest: `sha256:${"a".repeat(64)}`,
      signatureVerified: true
    }),
    writeDatabase(next) {
      calls.writes.push(structuredClone(next));
      if (options.writeErrorAt === calls.writes.length) throw options.writeError || new Error("storage unavailable: retry-secret");
      persisted = structuredClone(next);
    }
  };
  const segment = createIntegrationRouteSegments(runtime).find((item) => item.id === "integration-03");
  const callbackSegment = createInsurancePaymentRouteSegments(runtime).find((item) => item.id === "insurance-payment-01");
  return {
    calls,
    getPersisted: () => structuredClone(persisted),
    async request() {
      const eventId = persisted.integrationGatewayEvents[0].id;
      const res = {};
      const handled = await segment.handle(
        { method: "POST", headers: {} },
        res,
        new URL(`http://platform.test/api/integration/events/${eventId}/retry`)
      );
      assert.equal(handled, true);
      return res;
    },
    async callback(payload) {
      const res = {};
      const handled = await callbackSegment.handle(
        { method: "POST", headers: {}, body: payload },
        res,
        new URL("http://platform.test/api/financial-gateways/callbacks/PAYMENT")
      );
      assert.equal(handled, true);
      return res;
    },
    async deadLetter() {
      const eventId = persisted.integrationGatewayEvents[0].id;
      const res = {};
      const handled = await segment.handle(
        { method: "POST", headers: {}, body: { reason: "manual" } },
        res,
        new URL(`http://platform.test/api/integration/events/${eventId}/dead-letter`)
      );
      assert.equal(handled, true);
      return res;
    }
  };
}

test("financial manual retry reserves before provider dispatch and commits one audit", async () => {
  const harness = createHarness();
  const response = await harness.request();

  assert.equal(response.status, 200);
  assert.equal(response.body.status, "accepted");
  assert.equal(response.body.retryCount, 1);
  assert.equal(response.body.lastRetryResult, "provider-accepted");
  assert.equal(harness.calls.dispatches, 1);
  assert.equal(harness.calls.writes.length, 2);
  assert.equal(harness.calls.writes[0].integrationGatewayEvents[0].status, "retrying");
  assert.equal(harness.getPersisted().securityEvents[0].action, "重试金融网关事件");
});

test("concurrent financial manual retries dispatch once", async () => {
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

  assert.equal(first.status, 200);
  assert.equal(second.status, 409);
  assert.equal(second.body.code, "FINANCIAL_RETRY_NOT_ALLOWED");
  assert.equal(harness.calls.dispatches, 1);
});

test("financial manual retry redacts provider failures", async () => {
  const harness = createHarness({ dispatchError: new Error("provider rejected retry-secret-must-not-leak") });
  const response = await harness.request();

  assert.equal(response.status, 200);
  assert.equal(response.body.status, "failed");
  assert.equal(response.body.failureCode, "FINANCIAL_RETRY_PROVIDER_REJECTED");
  assert.equal(response.body.deadLetterReason, "financial gateway provider retry failed");
  assert.doesNotMatch(JSON.stringify(response.body), /retry-secret-must-not-leak/);
  assert.doesNotMatch(JSON.stringify(harness.getPersisted()), /retry-secret-must-not-leak/);
});

test("financial manual retry final write failure preserves reservation and prevents redispatch", async () => {
  const harness = createHarness({ writeErrorAt: 2 });
  const failed = await harness.request();
  const replay = await harness.request();

  assert.equal(failed.status, 500);
  assert.equal(failed.body.code, "FINANCIAL_RETRY_FAILED");
  assert.equal(replay.status, 202);
  assert.equal(replay.body.status, "retrying");
  assert.equal(replay.body.idempotentReplay, true);
  assert.equal(harness.calls.dispatches, 1);
  assert.equal(harness.getPersisted().integrationGatewayEvents[0].status, "retrying");
  assert.doesNotMatch(JSON.stringify(failed.body), /retry-secret/);
});

test("a verified callback route can persist during retry and its evidence survives finalization", async () => {
  let enterProvider;
  const providerEntered = new Promise((resolve) => { enterProvider = resolve; });
  let releaseProvider;
  const providerReleased = new Promise((resolve) => { releaseProvider = resolve; });
  const harness = createHarness({
    initialState: {
      integrationGatewayEvents: [initialEvent({
        adapterReceipt: { receiptId: "retry-old-receipt-001", status: "accepted" },
        providerStatus: "accepted",
        callbackEvents: []
      })],
      securityEvents: []
    },
    dispatchBarrier: async () => {
      enterProvider();
      await providerReleased;
    }
  });
  const retryPromise = harness.request();
  await providerEntered;
  const callback = await harness.callback({
    eventId: "trusted-callback-during-retry",
    receiptId: "retry-old-receipt-001",
    status: "succeeded",
    occurredAt: "2026-08-23T09:00:01.000Z",
    businessDate: "2026-08-23",
    amountFen: 1200,
    providerCode: "OK"
  });
  assert.equal(callback.status, 200);
  assert.equal(harness.getPersisted().integrationGatewayEvents[0].status, "retrying");
  assert.equal(harness.calls.writes[1].securityEvents[0].action, "financial gateway callback");
  assert.equal(harness.calls.writes[1].integrationGatewayEvents[0].callbackEvents[0].eventId, "trusted-callback-during-retry");
  releaseProvider();
  const response = await retryPromise;

  assert.equal(response.status, 200);
  assert.equal(response.body.status, "accepted");
  assert.equal(response.body.providerStatus, "succeeded");
  assert.equal(response.body.reconciliationStatus, "provider-exception");
  assert.equal(response.body.lastRetryResult, "callback-race-reconciliation-required");
  assert.equal(harness.calls.dispatches, 1);
  assert.equal(harness.getPersisted().integrationGatewayEvents[0].callbackEvents[0].eventId, "trusted-callback-during-retry");
  assert.equal(harness.getPersisted().securityEvents[0].result, "需复核");
});

test("a successful callback racing a failed retry blocks every further provider dispatch until reconciliation", async () => {
  let enterProvider;
  const providerEntered = new Promise((resolve) => { enterProvider = resolve; });
  let releaseProvider;
  const providerReleased = new Promise((resolve) => { releaseProvider = resolve; });
  const harness = createHarness({
    initialState: {
      integrationGatewayEvents: [initialEvent({
        adapterReceipt: { receiptId: "retry-old-receipt-failure-001", status: "accepted" },
        providerStatus: "accepted",
        callbackEvents: []
      })],
      securityEvents: []
    },
    dispatchError: new Error("provider retry failed"),
    dispatchBarrier: async () => {
      enterProvider();
      await providerReleased;
    }
  });
  const retryPromise = harness.request();
  await providerEntered;
  const callback = await harness.callback({
    eventId: "trusted-success-during-failed-retry",
    receiptId: "retry-old-receipt-failure-001",
    status: "succeeded",
    occurredAt: "2026-08-23T09:05:01.000Z",
    businessDate: "2026-08-23",
    amountFen: 1200,
    providerCode: "OK"
  });
  assert.equal(callback.status, 200);
  releaseProvider();
  const failedRetry = await retryPromise;
  const blockedRetry = await harness.request();

  assert.equal(failedRetry.status, 200);
  assert.equal(failedRetry.body.status, "failed");
  assert.equal(failedRetry.body.providerStatus, "succeeded");
  assert.equal(failedRetry.body.reconciliationStatus, "provider-exception");
  assert.equal(blockedRetry.status, 409);
  assert.equal(blockedRetry.body.code, "FINANCIAL_RETRY_RECONCILIATION_REQUIRED");
  assert.equal(harness.calls.dispatches, 1);
});

test("financial retry finalizer rejects a replaced dispatch attempt token", async () => {
  const harness = createHarness({
    mutateDuringDispatch(state) {
      state.integrationGatewayEvents[0].dispatchAttemptId = "another-retry-attempt";
      return state;
    }
  });
  const response = await harness.request();

  assert.equal(response.status, 500);
  assert.equal(response.body.code, "FINANCIAL_RETRY_FAILED");
  assert.equal(harness.calls.dispatches, 1);
  assert.equal(harness.getPersisted().integrationGatewayEvents[0].dispatchAttemptId, "another-retry-attempt");
});

test("manual dead-letter cannot downgrade a successful financial lifecycle or trigger retry", async () => {
  const harness = createHarness({
    initialState: {
      integrationGatewayEvents: [initialEvent({
        status: "succeeded",
        deadLetter: false,
        providerStatus: "succeeded"
      })],
      securityEvents: []
    }
  });
  const deadLetter = await harness.deadLetter();
  const retry = await harness.request();

  assert.equal(deadLetter.status, 409);
  assert.equal(deadLetter.body.code, "FINANCIAL_DEAD_LETTER_NOT_ALLOWED");
  assert.equal(retry.status, 409);
  assert.equal(retry.body.code, "FINANCIAL_RETRY_RECONCILIATION_REQUIRED");
  assert.equal(harness.calls.dispatches, 0);
  assert.equal(harness.getPersisted().integrationGatewayEvents[0].status, "succeeded");
});

test("legacy financial dead-letter returns a stable contract error", async () => {
  const legacy = initialEvent({ idempotencyKey: "legacy-key-without-request" });
  delete legacy.requestPayload;
  const harness = createHarness({ initialState: { integrationGatewayEvents: [legacy], securityEvents: [] } });
  const response = await harness.deadLetter();

  assert.equal(response.status, 409);
  assert.equal(response.body.code, "FINANCIAL_DEAD_LETTER_CONTRACT_UNAVAILABLE");
  assert.equal(harness.calls.writes.length, 0);
});

test("financial manual retry recovers after reservation write failure without duplicate provider calls", async () => {
  const harness = createHarness({ writeErrorAt: 1 });
  const failed = await harness.request();
  const recovered = await harness.request();

  assert.equal(failed.status, 500);
  assert.equal(failed.body.code, "FINANCIAL_RETRY_FAILED");
  assert.equal(recovered.status, 200);
  assert.equal(recovered.body.status, "accepted");
  assert.equal(harness.calls.dispatches, 1);
  assert.equal(harness.getPersisted().integrationGatewayEvents[0].status, "accepted");
});

test("financial dispatch waits for an in-flight retry on the same key and replays without another provider call", async () => {
  const event = initialEvent({ idempotencyKey: "financial-cross-endpoint-key-001" });
  let persisted = { integrationGatewayEvents: [event], securityEvents: [] };
  let providerCalls = 0;
  let enterProvider;
  const providerEntered = new Promise((resolve) => { enterProvider = resolve; });
  let releaseProvider;
  const providerReleased = new Promise((resolve) => { releaseProvider = resolve; });
  let sequence = 0;
  const shared = {
    FinancialCallbackError,
    collectJson: (req) => Promise.resolve(structuredClone(req.body || {})),
    async dispatchFinancialRequest(requestPayload) {
      providerCalls += 1;
      enterProvider();
      await providerReleased;
      return {
        type: requestPayload.type,
        operation: requestPayload.operation,
        contractId: requestPayload.contractId,
        idempotencyKey: requestPayload.idempotencyKey,
        receiptId: "cross-endpoint-receipt-001",
        requestId: "cross-endpoint-request-001",
        status: "accepted",
        acceptedAt: "2026-08-23T09:30:00.000Z",
        attempts: 1
      };
    },
    financialDispatchRequestDigest,
    randomUUID: () => `cross-endpoint-generated-${++sequence}`,
    readDatabase: () => structuredClone(persisted),
    requireApiRole: () => ({ username: "commission-reviewer", name: "委端审核员", role: "commission" }),
    sendJson(res, status, body) {
      res.status = status;
      res.body = body;
    },
    validateFinancialRequest,
    withFinancialDispatchLock,
    withFinancialDispatchStateLock,
    writeDatabase(next) {
      persisted = structuredClone(next);
    }
  };
  const retrySegment = createIntegrationRouteSegments(shared).find((item) => item.id === "integration-03");
  const dispatchSegment = createInsurancePaymentRouteSegments(shared).find((item) => item.id === "insurance-payment-01");
  const retryResponse = {};
  const retryPromise = retrySegment.handle(
    { method: "POST", headers: {} },
    retryResponse,
    new URL(`http://platform.test/api/integration/events/${event.id}/retry`)
  );
  await providerEntered;
  const dispatchResponse = {};
  const dispatchPromise = dispatchSegment.handle(
    {
      method: "POST",
      headers: {},
      body: {
        type: "PAYMENT",
        operation: "create-payment",
        idempotencyKey: event.idempotencyKey,
        payload: event.requestPayload.payload
      }
    },
    dispatchResponse,
    new URL("http://platform.test/api/financial-gateways/dispatch")
  );
  releaseProvider();
  await Promise.all([retryPromise, dispatchPromise]);

  assert.equal(retryResponse.status, 200);
  assert.equal(dispatchResponse.status, 200);
  assert.equal(dispatchResponse.body.idempotentReplay, true);
  assert.equal(dispatchResponse.body.id, event.id);
  assert.equal(providerCalls, 1);
  assert.equal(persisted.integrationGatewayEvents.length, 1);
  assert.equal(persisted.integrationGatewayEvents[0].retryCount, 1);
  assert.equal(persisted.securityEvents.length, 1);
});
