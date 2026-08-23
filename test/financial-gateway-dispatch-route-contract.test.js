"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  FinancialCallbackError,
  financialDispatchRequestDigest,
  validateFinancialRequest,
  withFinancialDispatchLock,
  withFinancialDispatchStateLock
} = require("../financial-gateways");
const { createRouteSegments } = require("../src/http/routes/insurance-payment");

function payload(overrides = {}) {
  return {
    type: "PAYMENT",
    operation: "create-payment",
    idempotencyKey: "dispatch-key-001",
    ...overrides,
    payload: {
      orderNo: "ORDER-001",
      amountFen: 1200,
      currency: "CNY",
      ...(overrides.payload || {})
    }
  };
}

function createHarness(options = {}) {
  let persisted = structuredClone(options.initialState || {
    integrationGatewayEvents: [],
    securityEvents: [],
    storageMeta: {
      engine: "sqlite",
      collectionVersions: { integrationGatewayEvents: 3, securityEvents: 7 }
    }
  });
  let sequence = 0;
  let activeDispatches = 0;
  const calls = {
    appendSecurityEvent: 0,
    authorization: [],
    collects: 0,
    dispatches: [],
    maxActiveDispatches: 0,
    reads: 0,
    writes: []
  };
  const defaultUser = options.user || {
    username: "institution-operator",
    name: "机构结算员",
    role: "institution",
    orgCode: "ORG-001"
  };
  const runtime = {
    FinancialCallbackError,
    appendSecurityEvent() {
      calls.appendSecurityEvent += 1;
    },
    collectJson(req) {
      calls.collects += 1;
      return Promise.resolve(structuredClone(req.body));
    },
    async dispatchFinancialRequest(requestPayload) {
      calls.dispatches.push(structuredClone(requestPayload));
      activeDispatches += 1;
      calls.maxActiveDispatches = Math.max(calls.maxActiveDispatches, activeDispatches);
      try {
        if (options.dispatchBarrier) await options.dispatchBarrier(requestPayload);
        if (options.dispatchError) throw options.dispatchError;
        return {
          type: requestPayload.type,
          operation: requestPayload.operation,
          contractId: requestPayload.contractId,
          idempotencyKey: requestPayload.idempotencyKey,
          requestId: `request-${calls.dispatches.length}`,
          receiptId: `receipt-${calls.dispatches.length}`,
          status: "accepted",
          acceptedAt: "2026-08-23T08:00:00.000Z",
          providerCode: "OK",
          attempts: 1,
          adapter: "financial-http-json-hmac"
        };
      } finally {
        activeDispatches -= 1;
      }
    },
    financialDispatchRequestDigest,
    normalizeState(value) {
      return value;
    },
    randomUUID() {
      sequence += 1;
      return `generated-${sequence}`;
    },
    readDatabase() {
      calls.reads += 1;
      return structuredClone(persisted);
    },
    requireApiRole(_req, _res, roles, route) {
      calls.authorization.push({ roles, route });
      return options.authorized === false ? null : defaultUser;
    },
    sendJson(res, status, body) {
      res.status = status;
      res.body = body;
    },
    validateFinancialRequest,
    withFinancialDispatchLock,
    withFinancialDispatchStateLock,
    writeDatabase(next) {
      calls.writes.push(structuredClone(next));
      if (options.writeError && (!options.writeErrorAt || options.writeErrorAt === calls.writes.length)) throw options.writeError;
      persisted = structuredClone(next);
    }
  };
  const segment = createRouteSegments(runtime).find((item) => item.id === "insurance-payment-01");
  return {
    calls,
    getPersisted: () => structuredClone(persisted),
    async request(body) {
      const res = {};
      const handled = await segment.handle(
        { method: "POST", body, headers: {} },
        res,
        new URL("http://platform.test/api/financial-gateways/dispatch")
      );
      assert.equal(handled, true);
      return res;
    }
  };
}

test("financial dispatch denies identity before body collection and database read", async () => {
  const harness = createHarness({ authorized: false });
  const response = await harness.request(payload());

  assert.equal(response.status, undefined);
  assert.equal(harness.calls.collects, 0);
  assert.equal(harness.calls.reads, 0);
  assert.equal(harness.calls.writes.length, 0);
  assert.deepEqual(harness.calls.authorization, [{
    roles: ["commission", "institution", "insurance"],
    route: "/api/financial-gateways/dispatch"
  }]);
});

test("financial dispatch enforces insurance gateway scope before database read", async () => {
  const harness = createHarness({ user: { username: "insurance", name: "医保经办员", role: "insurance" } });
  const response = await harness.request(payload());

  assert.equal(response.status, 403);
  assert.equal(response.body.code, "FINANCIAL_DISPATCH_GATEWAY_SCOPE_DENIED");
  assert.equal(harness.calls.reads, 0);
  assert.equal(harness.calls.writes.length, 0);
  assert.equal(harness.calls.dispatches.length, 0);
});

test("financial dispatch binds institution requests to the authenticated organization", async () => {
  const denied = createHarness();
  const deniedResponse = await denied.request(payload({ payload: { institutionCode: "ORG-OTHER" } }));
  assert.equal(deniedResponse.status, 403);
  assert.equal(deniedResponse.body.code, "FINANCIAL_DISPATCH_INSTITUTION_SCOPE_DENIED");
  assert.equal(denied.calls.reads, 0);
  assert.equal(denied.calls.dispatches.length, 0);

  const allowed = createHarness();
  const allowedResponse = await allowed.request(payload());
  assert.equal(allowedResponse.status, 202);
  assert.equal(allowed.calls.dispatches[0].payload.institutionCode, "ORG-001");
  assert.equal(allowedResponse.body.payload.institutionCode, "ORG-001");
});

test("financial dispatch exact replay and conflicting payload retain one event", async () => {
  const harness = createHarness();
  const first = await harness.request(payload());
  const replay = await harness.request(payload());
  const conflict = await harness.request(payload({ payload: { amountFen: 1300 } }));

  assert.equal(first.status, 202);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.idempotentReplay, true);
  assert.equal(replay.body.id, first.body.id);
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, "FINANCIAL_DISPATCH_IDEMPOTENCY_CONFLICT");
  assert.equal(conflict.body.message, "financial dispatch idempotency key is bound to a different request");
  assert.equal(harness.calls.dispatches.length, 1);
  assert.equal(harness.calls.writes.length, 2);
  assert.equal(harness.getPersisted().integrationGatewayEvents.length, 1);
});

test("financial dispatch serializes concurrent exact replay and conflicting payloads", async () => {
  let releaseFirst;
  const firstReachedProvider = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  let providerEntered;
  const providerEntry = new Promise((resolve) => {
    providerEntered = resolve;
  });
  const harness = createHarness({
    dispatchBarrier: async () => {
      providerEntered();
      await firstReachedProvider;
    }
  });
  const firstPromise = harness.request(payload());
  await providerEntry;
  const replayPromise = harness.request(payload());
  const conflictPromise = harness.request(payload({ payload: { orderNo: "ORDER-CONFLICT" } }));
  releaseFirst();
  const [first, replay, conflict] = await Promise.all([firstPromise, replayPromise, conflictPromise]);

  assert.equal(first.status, 202);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.id, first.body.id);
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, "FINANCIAL_DISPATCH_IDEMPOTENCY_CONFLICT");
  assert.equal(harness.calls.dispatches.length, 1);
  assert.equal(harness.calls.maxActiveDispatches, 1);
  assert.equal(harness.calls.writes.length, 2);
});

test("financial dispatch runs different keys concurrently and retains both events", async () => {
  let releaseFirst;
  const firstMayFinish = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  let providerEntered;
  const firstProviderEntry = new Promise((resolve) => {
    providerEntered = resolve;
  });
  let bothProvidersEntered;
  const bothProviderEntries = new Promise((resolve) => {
    bothProvidersEntered = resolve;
  });
  let providerCalls = 0;
  const harness = createHarness({
    dispatchBarrier: async () => {
      providerCalls += 1;
      if (providerCalls === 1) {
        providerEntered();
        await firstMayFinish;
      }
      if (providerCalls === 2) bothProvidersEntered();
    }
  });
  const firstPromise = harness.request(payload({ idempotencyKey: "dispatch-key-a" }));
  await firstProviderEntry;
  const secondPromise = harness.request(payload({
    idempotencyKey: "dispatch-key-b",
    payload: { orderNo: "ORDER-002" }
  }));
  await bothProviderEntries;
  releaseFirst();
  const [first, second] = await Promise.all([firstPromise, secondPromise]);

  assert.equal(first.status, 202);
  assert.equal(second.status, 202);
  assert.equal(harness.calls.dispatches.length, 2);
  assert.equal(harness.calls.maxActiveDispatches, 2);
  assert.equal(harness.calls.writes.length, 4);
  assert.equal(harness.getPersisted().integrationGatewayEvents.length, 2);
});

test("financial dispatch commits accepted event and audit in one atomic write", async () => {
  const harness = createHarness();
  const response = await harness.request(payload());

  assert.equal(response.status, 202);
  assert.equal(harness.calls.writes.length, 2);
  const reserved = harness.calls.writes[0];
  assert.equal(reserved.integrationGatewayEvents[0].status, "dispatching");
  assert.equal(reserved.securityEvents.length, 0);
  assert.deepEqual(reserved.storageMeta.collectionVersions, { integrationGatewayEvents: 3, securityEvents: 7 });
  const committed = harness.calls.writes[1];
  assert.equal(committed.integrationGatewayEvents.length, 1);
  assert.equal(committed.securityEvents.length, 1);
  assert.equal(committed.securityEvents[0].action, "dispatch financial gateway request");
  assert.equal(committed.integrationGatewayEvents[0].id, response.body.id);
  assert.equal(harness.calls.appendSecurityEvent, 0);
});

test("financial dispatch preserves one failed business event and audit commit on adapter rejection", async () => {
  const harness = createHarness({ dispatchError: new Error("provider rejected: secret-must-not-leak") });
  const response = await harness.request(payload());
  const replay = await harness.request(payload());

  assert.equal(response.status, 502);
  assert.equal(response.body.code, "FINANCIAL_DISPATCH_PROVIDER_REJECTED");
  assert.equal(response.body.message, "financial gateway dispatch failed");
  assert.equal(response.body.event.status, "failed");
  assert.equal(replay.status, 502);
  assert.equal(replay.body.code, "FINANCIAL_DISPATCH_PROVIDER_REJECTED");
  assert.equal(replay.body.event.idempotentReplay, true);
  assert.equal(harness.calls.dispatches.length, 1);
  assert.equal(harness.calls.writes.length, 2);
  assert.equal(harness.calls.writes[1].integrationGatewayEvents.length, 1);
  assert.equal(harness.calls.writes[1].securityEvents.length, 1);
  assert.equal(harness.calls.appendSecurityEvent, 0);
  assert.doesNotMatch(JSON.stringify(response.body), /secret-must-not-leak/);
  assert.doesNotMatch(JSON.stringify(harness.getPersisted()), /secret-must-not-leak/);
});

test("financial dispatch write failure performs no fallback write", async () => {
  const harness = createHarness({ writeError: new Error("disk unavailable: provider-secret-must-not-leak"), writeErrorAt: 1 });
  const response = await harness.request(payload());

  assert.equal(response.status, 500);
  assert.equal(response.body.code, "FINANCIAL_DISPATCH_FAILED");
  assert.equal(response.body.message, "financial dispatch failed");
  assert.equal(harness.calls.writes.length, 1);
  assert.equal(harness.calls.dispatches.length, 0);
  assert.equal(harness.calls.appendSecurityEvent, 0);
  assert.equal(harness.getPersisted().integrationGatewayEvents.length, 0);
});

test("financial dispatch recovers after a reservation write failure without duplicate provider calls", async () => {
  const harness = createHarness({ writeError: new Error("temporary storage failure"), writeErrorAt: 1 });
  const failed = await harness.request(payload());
  const recovered = await harness.request(payload());

  assert.equal(failed.status, 500);
  assert.equal(recovered.status, 202);
  assert.equal(recovered.body.status, "accepted");
  assert.equal(harness.calls.dispatches.length, 1);
  assert.equal(harness.getPersisted().integrationGatewayEvents.length, 1);
});

test("financial dispatch final write failure leaves a durable reservation and prevents redispatch", async () => {
  const harness = createHarness({ writeError: new Error("disk unavailable after provider acceptance"), writeErrorAt: 2 });
  const response = await harness.request(payload());
  const replay = await harness.request(payload());

  assert.equal(response.status, 500);
  assert.equal(response.body.code, "FINANCIAL_DISPATCH_FAILED");
  assert.equal(replay.status, 202);
  assert.equal(replay.body.status, "dispatching");
  assert.equal(replay.body.idempotentReplay, true);
  assert.equal(harness.calls.dispatches.length, 1);
  assert.equal(harness.getPersisted().integrationGatewayEvents.length, 1);
  assert.equal(harness.getPersisted().integrationGatewayEvents[0].status, "dispatching");
});

test("financial dispatch maps SQLite CAS failure to a stable redacted conflict", async () => {
  const harness = createHarness({
    writeError: new Error("SQLite optimistic lock conflict on securityEvents: expected 7, current 8")
  });
  const response = await harness.request(payload());

  assert.equal(response.status, 409);
  assert.equal(response.body.code, "FINANCIAL_DISPATCH_VERSION_CONFLICT");
  assert.equal(response.body.message, "financial dispatch state changed; retry with a fresh snapshot");
  assert.doesNotMatch(JSON.stringify(response.body), /securityEvents|expected 7|current 8/);
  assert.equal(harness.calls.writes.length, 1);
  assert.equal(harness.calls.appendSecurityEvent, 0);
});
