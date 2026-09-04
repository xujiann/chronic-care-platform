"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createRouteSegments } = require("../src/http/routes/insurance-payment");

function harness(options = {}) {
  const calls = { reads: 0, audits: [], roles: [] };
  const runtime = {
    appendSecurityEvent(event) { calls.audits.push(event); },
    readDatabase() { calls.reads += 1; return structuredClone(options.data || { integrationGatewayEvents: [], onlinePaymentRefunds: [], financialReconciliationRuns: [] }); },
    requireApiRole(_req, _res, roles, route) {
      calls.roles.push({ roles, route });
      return options.authorized === false ? null : (options.user || { role: "institution", orgType: "medical_institution", orgCode: "MR1", username: "hospital", name: "医院管理员" });
    },
    sendJson(res, status, body) { res.status = status; res.body = body; }
  };
  const segment = createRouteSegments(runtime).find((item) => item.id === "insurance-payment-01");
  return {
    calls,
    async request() {
      const res = {};
      const handled = await segment.handle(
        { method: "GET", headers: {} },
        res,
        new URL("http://platform.test/api/medical-payments/center")
      );
      assert.equal(handled, true);
      return res;
    }
  };
}

test("medical payment center authenticates before reading payment ledgers", async () => {
  const subject = harness({ authorized: false });
  const response = await subject.request();
  assert.equal(response.status, undefined);
  assert.equal(subject.calls.reads, 0);
  assert.deepEqual(subject.calls.roles, [{ roles: ["commission", "institution", "insurance"], route: "/api/medical-payments/center" }]);
});

test("medical payment center returns a minimized NO-GO view and records a read audit", async () => {
  const subject = harness();
  const response = await subject.request();
  assert.equal(response.status, 200);
  assert.equal(response.body.schemaVersion, "medical-payment-one-stop-view-v1");
  assert.equal(response.body.productionReady, false);
  assert.equal(subject.calls.reads, 1);
  assert.equal(subject.calls.audits.length, 1);
  assert.equal(subject.calls.audits[0].action, "medical payment one-stop read");
});

test("medical payment center maps scope failures to a stable forbidden response", async () => {
  const subject = harness({ user: { role: "institution", orgType: "medical_institution", orgCode: "", username: "unbound" } });
  const response = await subject.request();
  assert.equal(response.status, 403);
  assert.equal(response.body.code, "MEDICAL_PAYMENT_CENTER_SCOPE_REQUIRED");
  assert.equal(response.body.productionReady, false);
  assert.equal(subject.calls.audits.at(-1).result, "denied");
});
