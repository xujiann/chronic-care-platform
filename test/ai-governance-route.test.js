"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createRouteSegments } = require("../src/http/routes/runtime");

function harness(options = {}) {
  const calls = { reads: 0, audits: [], roles: [] };
  const runtime = {
    requireApiRole(_req, _res, roles, route) {
      calls.roles.push({ roles, route });
      return options.authorized === false ? null : { role: "commission", username: "health", name: "平台治理人员" };
    },
    readDatabase() {
      calls.reads += 1;
      if (options.readError) throw options.readError;
      return options.data || {
        phase2ClinicalAssistRules: [],
        phase2ClinicalAssistAlerts: [],
        phase2ClinicalAssistReceipts: [],
        diseaseRegistryModels: []
      };
    },
    appendSecurityEvent(event) {
      if (options.auditError) throw options.auditError;
      calls.audits.push(event);
    },
    sendJson(res, status, body) { res.status = status; res.body = body; }
  };
  const segment = createRouteSegments(runtime).find((item) => item.id === "runtime-02");
  return {
    calls,
    async request() {
      const res = {};
      const handled = await segment.handle(
        { method: "GET", headers: {} },
        res,
        new URL("http://platform.test/api/runtime/ai-governance/center")
      );
      assert.equal(handled, true);
      return res;
    }
  };
}

test("platform AI governance route authenticates before reading state", async () => {
  const subject = harness({ authorized: false });
  const response = await subject.request();
  assert.equal(response.status, undefined);
  assert.equal(subject.calls.reads, 0);
  assert.deepEqual(subject.calls.roles, [{ roles: ["commission"], route: "/api/runtime/ai-governance/center" }]);
  assert.equal(subject.calls.audits.length, 0);
});

test("platform AI governance route returns and audits a minimized NO-GO view", async () => {
  const subject = harness();
  const response = await subject.request();
  assert.equal(response.status, 200);
  assert.equal(response.body.schemaVersion, "platform-ai-governance-center-v1");
  assert.equal(response.body.productionReady, false);
  assert.equal(response.body.decision, "NO-GO");
  assert.equal(subject.calls.reads, 1);
  assert.equal(subject.calls.audits.length, 1);
  assert.equal(subject.calls.audits[0].action, "platform ai governance center read");
  assert.equal(subject.calls.audits[0].target, "L-GOV-AI");
  assert.equal(subject.calls.audits[0].result, "allowed");
});

test("platform AI governance route hides runtime errors behind a stable response", async () => {
  const subject = harness({ readError: new Error("must-not-leak-runtime-detail") });
  const response = await subject.request();
  assert.equal(response.status, 503);
  assert.equal(response.body.code, "AI_GOVERNANCE_CENTER_FAILED");
  assert.equal(response.body.productionReady, false);
  assert.equal(response.body.decision, "NO-GO");
  assert.doesNotMatch(JSON.stringify(response.body), /must-not-leak/);
  assert.equal(subject.calls.audits.at(-1).detail, "AI_GOVERNANCE_CENTER_FAILED");
});

test("platform AI governance route remains fail-closed when audit delivery fails", async () => {
  const subject = harness({ auditError: new Error("must-not-leak-audit-detail") });
  const response = await subject.request();
  assert.equal(response.status, 503);
  assert.equal(response.body.code, "AI_GOVERNANCE_CENTER_FAILED");
  assert.equal(response.body.productionReady, false);
  assert.doesNotMatch(JSON.stringify(response.body), /must-not-leak/);
});
