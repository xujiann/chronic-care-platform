"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createClinicalDecisionSupport, CONTRACT_VERSION } = require("../src/clinical-specialties/clinical-decision-support");

const doctor = { id: "u1", role: "institution", orgCode: "ORG-A", accountType: "doctor", doctorId: "d1" };
const manager = { id: "u2", role: "institution", orgCode: "ORG-A" };
const commission = { id: "u3", role: "commission" };
function fixture(overrides = {}) {
  let data = {
    authOrganizations: [{ orgCode: "ORG-A", name: "示范医院" }, { orgCode: "ORG-B", name: "基层医疗机构" }],
    phase2ClinicalAssistRules: [{ id: "rule", category: "duplicate-check", requiredFields: ["residentId"], defaultAction: "review", configStatus: "active" }],
    phase2ClinicalAssistAlerts: [
      { id: "a1", orgCode: "ORG-A", doctorId: "d1", residentId: "r1", residentName: "SYNTHETIC PATIENT", ruleId: "rule", category: "duplicate-check", pluginSurface: "workstation", serviceIntegrationStatus: "demo", recommendation: "SYNTHETIC RECOMMENDATION", alertDetail: "SYNTHETIC CLINICAL DETAIL", status: "pending" },
      { id: "a2", orgCode: "ORG-A", doctorId: "d2", residentId: "r2", ruleId: "rule", pluginSurface: "workstation", serviceIntegrationStatus: "demo", recommendation: "review" },
      { id: "a3", orgCode: "ORG-B", doctorId: "d1", residentId: "r3", ruleId: "rule", pluginSurface: "workstation", serviceIntegrationStatus: "demo", recommendation: "review" }
    ],
    phase2ClinicalAssistReceipts: [{ id: "receipt-other", alertId: "a3", auditHash: "hash", actionDetail: "OTHER INSTITUTION TEXT" }],
    phase2ClinicalAssistPluginContracts: [{ id: "plugin", endpoint: "GET /api/phase2/clinical-assist", payloadFields: ["alertId"], status: "demo" }],
    securityEvents: []
  };
  const calls = { writes: 0, audits: 0 };
  const service = createClinicalDecisionSupport({ now: () => "2026-09-05T00:00:00.000Z", readDatabase: () => data, writeDatabase: async (next) => { calls.writes++; data = next; }, verifyAuditTrail: () => ({ passed: true }), prependAuditTrailEntry: (events, event) => { calls.audits++; return [event, ...events]; }, ...overrides });
  return { service, calls, get data() { return data; }, command: (payload = {}, user = doctor, alertId = "a1") => service.executeReceipt({ alertId, user, payload }) };
}

test("scoped overview excludes foreign alerts, receipts and count/check evidence", () => {
  const f = fixture();
  const view = f.service.buildOverview(f.data, doctor);
  assert.equal(view.contractVersion, CONTRACT_VERSION);
  assert.equal(view.productionReady, false);
  assert.deepEqual(view.alerts.map((row) => row.id), ["a1"]);
  assert.equal(view.summary.alerts, 1);
  assert.equal(view.summary.receipts, 0);
  assert.equal(view.checks.find((row) => row.id.endsWith(":alertQueue")).detail, "1 scoped alerts");
  assert.equal(JSON.stringify(view).includes("OTHER INSTITUTION"), false);
  assert.equal(f.service.buildOverview(f.data, manager).alerts.length, 2);
  const management = JSON.stringify(f.service.buildOverview(f.data, commission));
  for (const secret of ["SYNTHETIC PATIENT", "SYNTHETIC CLINICAL DETAIL", "SYNTHETIC RECOMMENDATION", "OTHER INSTITUTION TEXT"]) assert.equal(management.includes(secret), false);
  for (const row of f.service.buildOverview(f.data, commission).alerts) { assert.equal(row.residentId, undefined); assert.equal(row.doctorId, undefined); }
});

test("identity, known organization and doctor binding fail closed", async () => {
  const f = fixture();
  for (const user of [{ role: "commission" }, { id: "x", role: "resident" }, { id: "x", role: "institution" }, { ...doctor, orgCode: "unknown" }, { ...doctor, doctorId: undefined }]) {
    assert.throws(() => f.service.buildOverview(f.data, user), { code: "CDSS_SCOPE_DENIED" });
    await assert.rejects(f.command({}, user), { code: "CDSS_SCOPE_DENIED" });
  }
  await assert.rejects(f.command({}, doctor, "a2"), { code: "CDSS_SCOPE_DENIED" });
  await assert.rejects(f.command({}, doctor, "a3"), { code: "CDSS_SCOPE_DENIED" });
  await assert.rejects(f.command({}, doctor, "missing"), { code: "CDSS_ALERT_NOT_FOUND" });
  assert.equal(f.calls.writes, 0);
});

test("legacy institution names are allowed only through trusted directory port", () => {
  const f = fixture({ resolveOrganizationCode: (data, row) => row.orgCode || data.authOrganizations.find((org) => org.name === row.institution)?.orgCode || "" });
  const alert = { institution: "示范医院", doctorId: "d1" };
  assert.equal(f.service.canAccessAlert(doctor, alert, f.data), true);
  assert.equal(f.service.canAccessAlert(doctor, { institution: "untrusted", doctorId: "d1" }, f.data), false);
});

test("injected seeds remain reusable without sharing mutable state", () => {
  const f = fixture();
  let calls = 0;
  const alerts = f.data.phase2ClinicalAssistAlerts;
  const svc = createClinicalDecisionSupport({ seeds: { alerts: () => { calls++; return alerts; } } });
  const view = svc.buildOverview({ authOrganizations: f.data.authOrganizations }, doctor);
  view.alerts[0].residentName = "changed";
  assert.equal(alerts[0].residentName, "SYNTHETIC PATIENT");
  assert.equal(calls, 1);
});

test("legacy payload aliases preserve public response; audit is metadata only", async () => {
  const f = fixture();
  const before = f.data;
  const result = await f.command({ action: "accepted-recommendation", status: "received", detail: "SYNTHETIC CLINICAL NOTE" });
  assert.equal(result.alert.status, "acknowledged");
  assert.equal(result.alert.version, 1);
  assert.equal(result.receipt.id, "p2car-a1");
  assert.equal(result.productionReady, false);
  assert.equal(before.phase2ClinicalAssistAlerts[0].version, undefined);
  assert.equal(f.calls.writes, 1);
  assert.equal(f.calls.audits, 1);
  assert.equal(JSON.stringify(f.data.securityEvents).includes("SYNTHETIC"), false);
  await f.command({ action: "acknowledged" });
  assert.equal(f.data.phase2ClinicalAssistAlerts[0].version, 2);
  assert.equal(f.calls.writes, 2);
});

test("explicit CAS and actor-bound idempotency replay exact response once", async () => {
  const f = fixture();
  const payload = { idempotencyKey: "request-1", expectedVersion: 0, doctorAction: "accepted-recommendation" };
  const [first, replay] = await Promise.all([f.command(payload), f.command(payload)]);
  assert.deepEqual(replay, first);
  assert.equal(f.calls.writes, 1);
  assert.equal(f.calls.audits, 1);
  assert.equal(JSON.stringify(first).includes("commandMetadata"), false);
  await assert.rejects(f.command({ ...payload, doctorAction: "acknowledged" }), { code: "CDSS_IDEMPOTENCY_CONFLICT" });
  await assert.rejects(f.command({ ...payload, idempotencyKey: "request-2" }), { code: "CDSS_VERSION_CONFLICT" });
  await assert.rejects(f.command(payload, manager), { code: "CDSS_VERSION_CONFLICT" });
  await f.command({ idempotencyKey: "request-1", expectedVersion: 1 }, manager);
  assert.equal(f.calls.writes, 2);
});

test("replay checks current resource authorization before stored response", async () => {
  const f = fixture();
  await f.command({ idempotencyKey: "key" });
  f.data.phase2ClinicalAssistAlerts[0].orgCode = "ORG-B";
  await assert.rejects(f.command({ idempotencyKey: "key" }), { code: "CDSS_SCOPE_DENIED" });
  assert.equal(f.calls.writes, 1);
});

test("unknown statuses, malformed keys/versions and unexplained dismissal are rejected", async () => {
  const f = fixture();
  for (const payload of [{ doctorAction: "invented" }, { receiptStatus: "invented" }, { expectedVersion: "0" }, { expectedVersion: -1 }, { expectedVersion: 1.5 }, { idempotencyKey: "" }, { idempotencyKey: 1 }, { idempotencyKey: "has spaces" }, { actionDetail: {} }, { doctorAction: "ignored" }, { doctorAction: "rejected", actionDetail: " " }, { receiptStatus: "rejected" }]) await assert.rejects(f.command(payload), (error) => error.statusCode === 400);
  const dismissed = await f.command({ doctorAction: "ignored", actionDetail: "Documented clinical reason" });
  assert.equal(dismissed.alert.status, "dismissed-with-reason");
});

test("audit and persistence failures do not mutate shared state or create replay receipts", async () => {
  for (const port of ["verifyAuditTrail", "prependAuditTrailEntry", "writeDatabase"]) {
    const f = fixture({ [port]: () => { throw new Error("sensitive provider failure"); } });
    const before = structuredClone(f.data);
    await assert.rejects(f.command({ idempotencyKey: "key" }), { code: "CDSS_COMMIT_FAILED", statusCode: 503 });
    assert.deepEqual(f.data, before);
  }
});

test("invalid existing audit chains fail without resealing or persistence", async () => {
  const f = fixture({ verifyAuditTrail: () => ({ passed: false }) });
  await assert.rejects(f.command(), { code: "CDSS_COMMIT_FAILED" });
  assert.equal(f.calls.audits, 0);
  assert.equal(f.calls.writes, 0);
});
