"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { auditHashFor } = require("../src/identity-security/audit-chain");
const { createRouteSegments } = require("../src/http/routes/identity-security");

function sealed(row) {
  const value = { ...row, previousAuditHash: "" };
  value.auditHash = auditHashFor(value);
  return value;
}

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
        securityEvents: [sealed({ id: "event-1", at: "2026-09-06T08:00:00.000Z", actor: "hidden", role: "commission", action: "login", target: "hidden", result: "allowed", detail: "hidden" })],
        dataAccessLogs: [sealed({ id: "access-1", at: "2026-09-06T08:01:00.000Z", actor: "hidden", role: "doctor", personIndex: "hidden", residentId: "hidden", purpose: "hidden", scope: "hidden", result: "allowed" })]
      };
    },
    appendSecurityEvent(event) {
      if (options.auditError) throw options.auditError;
      calls.audits.push(event);
    },
    sendJson(res, status, body) { res.status = status; res.body = body; }
  };
  const segment = createRouteSegments(runtime).find((item) => item.id === "identity-security-01");
  return {
    calls,
    async request() {
      const res = {};
      const handled = await segment.handle(
        { method: "GET", headers: {} },
        res,
        new URL("http://platform.test/api/security/audit-governance/center")
      );
      assert.equal(handled, true);
      return res;
    }
  };
}

test("platform audit governance route authenticates before reading audit state", async () => {
  const subject = harness({ authorized: false });
  const response = await subject.request();
  assert.equal(response.status, undefined);
  assert.equal(subject.calls.reads, 0);
  assert.deepEqual(subject.calls.roles, [{ roles: ["commission"], route: "/api/security/audit-governance/center" }]);
  assert.equal(subject.calls.audits.length, 0);
});

test("platform audit governance route returns and audits a minimized NO-GO view", async () => {
  const subject = harness();
  const response = await subject.request();
  assert.equal(response.status, 200);
  assert.equal(response.body.schemaVersion, "platform-audit-governance-center-v1");
  assert.equal(response.body.productionReady, false);
  assert.equal(response.body.decision, "NO-GO");
  assert.equal(subject.calls.reads, 1);
  assert.equal(subject.calls.audits.length, 1);
  assert.equal(subject.calls.audits[0].action, "platform audit governance center read");
  assert.equal(subject.calls.audits[0].target, "L-GOV-AUDIT");
  assert.equal(subject.calls.audits[0].result, "allowed");
  assert.doesNotMatch(JSON.stringify(response.body), /hidden/);
});

test("platform audit governance route hides runtime errors behind a stable response", async () => {
  const subject = harness({ readError: new Error("must-not-leak-runtime-detail") });
  const response = await subject.request();
  assert.equal(response.status, 503);
  assert.equal(response.body.code, "AUDIT_GOVERNANCE_CENTER_FAILED");
  assert.equal(response.body.productionReady, false);
  assert.equal(response.body.decision, "NO-GO");
  assert.doesNotMatch(JSON.stringify(response.body), /must-not-leak/);
  assert.equal(subject.calls.audits.at(-1).detail, "AUDIT_GOVERNANCE_CENTER_FAILED");
});

test("platform audit governance route returns a stable integrity error", async () => {
  const data = {
    securityEvents: [{ id: "tampered", at: "2026-09-06", previousAuditHash: "", auditHash: "0".repeat(64) }],
    dataAccessLogs: []
  };
  const subject = harness({ data });
  const response = await subject.request();
  assert.equal(response.status, 503);
  assert.equal(response.body.code, "AUDIT_GOVERNANCE_INTEGRITY_FAILED");
  assert.equal(response.body.productionReady, false);
  assert.equal(subject.calls.audits.at(-1).result, "denied");
});

test("platform audit governance route remains fail-closed when read auditing fails", async () => {
  const subject = harness({ auditError: new Error("must-not-leak-audit-detail") });
  const response = await subject.request();
  assert.equal(response.status, 503);
  assert.equal(response.body.code, "AUDIT_GOVERNANCE_CENTER_FAILED");
  assert.equal(response.body.productionReady, false);
  assert.doesNotMatch(JSON.stringify(response.body), /must-not-leak/);
});
