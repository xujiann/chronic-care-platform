"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  FinancialCallbackError,
  createFinancialReconciliationRun,
  withFinancialReconciliationLock
} = require("../financial-gateways");
const { createRouteSegments } = require("../src/http/routes/insurance-payment");

function payload(overrides = {}) {
  return {
    gatewayType: "INSURANCE",
    businessDate: "2026-08-23",
    ...overrides,
    providerSummary: {
      total: 0,
      succeeded: 0,
      exceptions: 0,
      grossAmountFen: 0,
      statementDigest: "a".repeat(64),
      ...(overrides.providerSummary || {})
    }
  };
}

function createHarness(options = {}) {
  let persisted = structuredClone(options.initialState || {
    integrationGatewayEvents: [],
    financialReconciliationRuns: [],
    securityEvents: [],
    storageMeta: {
      engine: "sqlite",
      collectionVersions: { financialReconciliationRuns: 3, securityEvents: 7 }
    }
  });
  let sequence = 0;
  const calls = {
    appendSecurityEvent: 0,
    authorization: [],
    collects: 0,
    reads: 0,
    writes: []
  };
  const defaultUser = options.user || {
    username: "insurance-operator",
    name: "医保对账员",
    role: "insurance",
    orgCode: "INSURANCE-GATEWAY"
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
    createFinancialReconciliationRun,
    normalizeState(value) {
      return value;
    },
    prependAuditTrailEntry(rows, entry) {
      return [entry, ...(Array.isArray(rows) ? rows : [])].slice(0, 120);
    },
    randomUUID() {
      sequence += 1;
      return `audit-${sequence}`;
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
    withFinancialReconciliationLock,
    writeDatabase(next) {
      calls.writes.push(structuredClone(next));
      if (options.writeError) throw options.writeError;
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
        new URL("http://platform.test/api/financial-gateways/reconciliation-runs")
      );
      assert.equal(handled, true);
      return res;
    }
  };
}

test("financial reconciliation denies identity before body collection and database read", async () => {
  const harness = createHarness({ authorized: false });
  const response = await harness.request(payload());

  assert.equal(response.status, undefined);
  assert.equal(harness.calls.collects, 0);
  assert.equal(harness.calls.reads, 0);
  assert.equal(harness.calls.writes.length, 0);
  assert.deepEqual(harness.calls.authorization, [{
    roles: ["commission", "insurance"],
    route: "/api/financial-gateways/reconciliation-runs"
  }]);
});

test("financial reconciliation enforces insurance gateway scope before database read", async () => {
  const harness = createHarness();
  const response = await harness.request(payload({ gatewayType: "PAYMENT" }));

  assert.equal(response.status, 403);
  assert.equal(response.body.code, "FINANCIAL_RECONCILIATION_GATEWAY_SCOPE_DENIED");
  assert.equal(harness.calls.reads, 0);
  assert.equal(harness.calls.writes.length, 0);
});

test("financial reconciliation allows commission global gateway scope and insurance own scope", async () => {
  const commission = createHarness({ user: { username: "commission", name: "监管对账员", role: "commission" } });
  const commissionResponse = await commission.request(payload({ gatewayType: "PAYMENT" }));
  assert.equal(commissionResponse.status, 201);
  assert.equal(commissionResponse.body.run.gatewayType, "PAYMENT");

  const insurance = createHarness();
  const insuranceResponse = await insurance.request(payload());
  assert.equal(insuranceResponse.status, 201);
  assert.equal(insuranceResponse.body.run.gatewayType, "INSURANCE");
});

test("financial reconciliation exact replay and conflicting payload retain one run", async () => {
  const harness = createHarness();
  const first = await harness.request(payload());
  const replay = await harness.request(payload());
  const conflict = await harness.request(payload({ providerSummary: { total: 1 } }));

  assert.equal(first.status, 201);
  assert.equal(first.body.idempotentReplay, false);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.idempotentReplay, true);
  assert.equal(replay.body.run.id, first.body.run.id);
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, "FINANCIAL_RECONCILIATION_DIGEST_CONFLICT");
  const persisted = harness.getPersisted();
  assert.equal(persisted.financialReconciliationRuns.length, 1);
  assert.equal(persisted.securityEvents.length, 2);
  assert.equal(persisted.securityEvents.every((event) => event.action === "financial daily reconciliation"), true);
  assert.deepEqual(persisted.securityEvents.map((event) => event.id).sort(), ["audit-1", "audit-2"]);
  assert.equal(harness.calls.writes.length, 2);
});

test("financial reconciliation serializes concurrent exact replay without duplicate runs", async () => {
  const harness = createHarness();
  const results = await Promise.all([harness.request(payload()), harness.request(payload())]);

  assert.deepEqual(results.map((item) => item.status).sort(), [200, 201]);
  assert.equal(results[0].body.run.id, results[1].body.run.id);
  assert.equal(harness.getPersisted().financialReconciliationRuns.length, 1);
  assert.equal(harness.calls.writes.length, 2);
});

test("financial reconciliation serializes concurrent conflicting payloads", async () => {
  const harness = createHarness();
  const results = await Promise.all([
    harness.request(payload()),
    harness.request(payload({ providerSummary: { total: 1 } }))
  ]);

  assert.deepEqual(results.map((item) => item.status).sort(), [201, 409]);
  assert.equal(results.find((item) => item.status === 409).body.code, "FINANCIAL_RECONCILIATION_DIGEST_CONFLICT");
  assert.equal(harness.getPersisted().financialReconciliationRuns.length, 1);
  assert.equal(harness.calls.writes.length, 1);
});

test("financial reconciliation commits run and audit in one atomic write", async () => {
  const harness = createHarness();
  const response = await harness.request(payload());

  assert.equal(response.status, 201);
  assert.equal(harness.calls.writes.length, 1);
  const committed = harness.calls.writes[0];
  assert.equal(committed.financialReconciliationRuns.length, 1);
  assert.equal(committed.securityEvents.length, 1);
  assert.equal(committed.securityEvents[0].target, "INSURANCE/2026-08-23");
  assert.match(committed.securityEvents[0].detail, new RegExp(`^${response.body.run.id}:matched:sha256:`));
  assert.equal(harness.calls.appendSecurityEvent, 0);
  assert.equal(response.body.productionEvidence, false);
});

test("financial reconciliation write failure performs no second audit write", async () => {
  const harness = createHarness({ writeError: new Error("disk unavailable: provider-secret-must-not-leak") });
  const response = await harness.request(payload());

  assert.equal(response.status, 500);
  assert.equal(response.body.code, "FINANCIAL_RECONCILIATION_FAILED");
  assert.equal(response.body.message, "financial reconciliation failed");
  assert.equal(harness.calls.writes.length, 1);
  assert.equal(harness.calls.appendSecurityEvent, 0);
  assert.equal(harness.getPersisted().financialReconciliationRuns.length, 0);
});

test("financial reconciliation maps SQLite CAS failure to a stable redacted conflict", async () => {
  const harness = createHarness({
    writeError: new Error("SQLite optimistic lock conflict on securityEvents: expected 7, current 8")
  });
  const response = await harness.request(payload());

  assert.equal(response.status, 409);
  assert.equal(response.body.code, "FINANCIAL_RECONCILIATION_VERSION_CONFLICT");
  assert.equal(response.body.message, "financial reconciliation state changed; retry with a fresh snapshot");
  assert.doesNotMatch(JSON.stringify(response.body), /securityEvents|expected 7|current 8/);
  assert.equal(harness.calls.writes.length, 1);
  assert.equal(harness.calls.appendSecurityEvent, 0);
});
