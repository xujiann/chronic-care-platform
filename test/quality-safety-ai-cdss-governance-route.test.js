"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createRouteSegment } = require("../src/http/routes/clinical-specialties/quality-safety");
const { sourceDigest } = require("../src/identity-security/ai-governance");

function harness(options = {}) {
  const calls = { reads: 0, audits: [], roles: [], responses: [] };
  const runtime = {
    appendSecurityEvent(event) { calls.audits.push(event); },
    readDatabase() {
      calls.reads += 1;
      return structuredClone(options.data || {
        phase2ClinicalAssistRules: [],
        phase2ClinicalAssistAlerts: [],
        phase2ClinicalAssistReceipts: [],
        phase2ClinicalAssistPluginContracts: []
      });
    },
    requireApiRole(_req, _res, roles, route) {
      calls.roles.push({ roles, route });
      return options.authorized === false ? null : (options.user || { role: "commission", orgCode: "COMMISSION", username: "health" });
    },
    sendJson(res, status, body) {
      res.status = status;
      res.body = body;
      calls.responses.push({ status, body });
    }
  };
  const segment = createRouteSegment(runtime);
  return {
    calls,
    async request() {
      const res = {};
      const handled = await segment.handle(
        { method: "GET", headers: {} },
        res,
        new URL("http://platform.test/api/quality-safety/ai-cdss/center")
      );
      assert.equal(handled, true);
      return res;
    }
  };
}

test("AI CDSS governance center authenticates before reading state", async () => {
  const subject = harness({ authorized: false });
  const response = await subject.request();
  assert.equal(response.status, undefined);
  assert.equal(subject.calls.reads, 0);
  assert.deepEqual(subject.calls.roles, [{
    roles: ["commission", "institution"],
    route: "/api/quality-safety/ai-cdss/center"
  }]);
  assert.equal(subject.calls.audits.length, 0);
});

test("AI CDSS governance center returns a minimized NO-GO view and audits the read", async () => {
  const subject = harness();
  const response = await subject.request();
  assert.equal(response.status, 200);
  assert.equal(response.body.schemaVersion, "clinical-ai-cdss-governance-center-v1");
  assert.equal(response.body.productionReady, false);
  assert.equal(response.body.decision, "NO-GO");
  assert.equal(subject.calls.reads, 1);
  assert.equal(subject.calls.audits.length, 1);
  assert.equal(subject.calls.audits[0].action, "clinical ai cdss governance center read");
  assert.equal(subject.calls.audits[0].result, "allowed");
});

test("AI CDSS governance center maps missing institution scope to a stable forbidden response", async () => {
  const subject = harness({ user: { role: "institution", orgCode: "", username: "unbound" } });
  const response = await subject.request();
  assert.equal(response.status, 403);
  assert.equal(response.body.code, "CLINICAL_AI_CDSS_SCOPE_REQUIRED");
  assert.equal(response.body.productionReady, false);
  assert.equal(response.body.decision, "NO-GO");
  assert.equal(subject.calls.audits.at(-1).result, "denied");
});

test("AI CDSS governance center hides unexpected runtime errors behind a stable NO-GO response", async () => {
  const subject = harness();
  subject.calls.reads = 0;
  const segment = createRouteSegment({
    requireApiRole() { return { role: "commission", orgCode: "COMMISSION", username: "health" }; },
    readDatabase() { subject.calls.reads += 1; throw new Error("must-not-leak-runtime-detail"); },
    appendSecurityEvent(event) { subject.calls.audits.push(event); },
    sendJson(res, status, body) { res.status = status; res.body = body; }
  });
  const res = {};
  const handled = await segment.handle(
    { method: "GET", headers: {} },
    res,
    new URL("http://platform.test/api/quality-safety/ai-cdss/center")
  );
  assert.equal(handled, true);
  assert.equal(res.status, 503);
  assert.equal(res.body.code, "CLINICAL_AI_CDSS_CENTER_FAILED");
  assert.equal(res.body.productionReady, false);
  assert.doesNotMatch(JSON.stringify(res.body), /must-not-leak/);
  assert.equal(subject.calls.audits.at(-1).detail, "CLINICAL_AI_CDSS_CENTER_FAILED");
});

test("AI CDSS governance center remains fail-closed when its audit sink is unavailable", async () => {
  const segment = createRouteSegment({
    requireApiRole() { return { role: "commission", orgCode: "COMMISSION", username: "health" }; },
    readDatabase() {
      return {
        phase2ClinicalAssistRules: [],
        phase2ClinicalAssistAlerts: [],
        phase2ClinicalAssistReceipts: [],
        phase2ClinicalAssistPluginContracts: []
      };
    },
    appendSecurityEvent() { throw new Error("must-not-leak-audit-detail"); },
    sendJson(res, status, body) { res.status = status; res.body = body; }
  });
  const res = {};
  const handled = await segment.handle(
    { method: "GET", headers: {} },
    res,
    new URL("http://platform.test/api/quality-safety/ai-cdss/center")
  );
  assert.equal(handled, true);
  assert.equal(res.status, 503);
  assert.equal(res.body.code, "CLINICAL_AI_CDSS_CENTER_FAILED");
  assert.equal(res.body.productionReady, false);
  assert.doesNotMatch(JSON.stringify(res.body), /must-not-leak/);
});

test("clinical center route applies the production scope and governance adapters", async () => {
  const rule = { id: "rule-a", configStatus: "active", version: "1", approvalEvidenceRef: "legacy", validationEvidenceRef: "legacy", defaultAction: "must-not-leak-rule-advice" };
  rule.governance = { status: "suspended", card: { sourceDigest: sourceDigest(rule) } };
  const subject = harness({
    user: { role: "institution", orgCode: "ORG-A", doctorId: "doctor-a", accountType: "doctor", username: "doctor-a" },
    data: {
      authOrganizations: [{ orgCode: "ORG-A" }, { orgCode: "ORG-B" }],
      phase2ClinicalAssistRules: [rule],
      phase2ClinicalAssistAlerts: [
        { id: "own", institutionCode: "ORG-A", doctorId: "doctor-a", ruleId: "rule-a", recommendation: "must-not-leak-suspended-advice" },
        { id: "foreign", institutionCode: "ORG-B", doctorId: "doctor-a", ruleId: "rule-a", recommendation: "must-not-leak-foreign-advice" }
      ],
      phase2ClinicalAssistReceipts: [{ id: "foreign-receipt", alertId: "foreign", actionDetail: "must-not-leak-foreign-receipt" }]
    }
  });
  const response = await subject.request();
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.suggestions.map((item) => item.id), ["own"]);
  assert.equal(response.body.suggestions[0].recommendation, "");
  assert.equal(response.body.suggestions[0].decisionAvailable, false);
  assert.equal(response.body.ruleCards[0].recommendedReview, "");
  assert.deepEqual(response.body.reviewLedger, []);
  assert.doesNotMatch(JSON.stringify(response.body), /must-not-leak|foreign/);
  assert.equal(response.body.productionReady, false);
});

test("clinical center route rejects untrusted organizations and missing doctor bindings", async () => {
  for (const options of [
    { user: { role: "institution", orgCode: "ORG-A", username: "manager" }, data: {} },
    { user: { role: "institution", orgCode: "ORG-A", username: "doctor", accountType: "doctor" }, data: { authOrganizations: [{ orgCode: "ORG-A" }] } }
  ]) {
    const subject = harness(options);
    const response = await subject.request();
    assert.equal(response.status, 403);
    assert.equal(response.body.productionReady, false);
    assert.equal(response.body.decision, "NO-GO");
    assert.equal(subject.calls.audits.at(-1).result, "denied");
  }
});

test("clinical center route recognizes a matched approval then fails closed on source drift", async () => {
  const rule = { id: "rule-a", configStatus: "active", version: "1", defaultAction: "复核有效报告后由医生决定" };
  rule.governance = { status: "approved", card: { sourceDigest: sourceDigest(rule) } };
  const options = {
    user: { role: "institution", orgCode: "ORG-A", doctorId: "doctor-a", accountType: "doctor", username: "doctor-a" },
    data: {
      authOrganizations: [{ orgCode: "ORG-A" }],
      phase2ClinicalAssistRules: [rule],
      phase2ClinicalAssistAlerts: [{ id: "own", institutionCode: "ORG-A", doctorId: "doctor-a", ruleId: "rule-a", recommendation: "复核有效报告后由医生决定" }]
    }
  };
  const approved = await harness(options).request();
  assert.equal(approved.status, 200);
  assert.equal(approved.body.suggestions[0].decisionAvailable, true);
  assert.equal(approved.body.suggestions[0].recommendation, "复核有效报告后由医生决定");
  rule.defaultAction = "must-not-leak-drifted-source";
  const drifted = await harness(options).request();
  assert.equal(drifted.status, 200);
  assert.equal(drifted.body.suggestions[0].decisionAvailable, false);
  assert.equal(drifted.body.suggestions[0].recommendation, "");
  assert.equal(drifted.body.ruleCards[0].recommendedReview, "");
  assert.doesNotMatch(JSON.stringify(drifted.body), /must-not-leak-drifted-source/);
});
