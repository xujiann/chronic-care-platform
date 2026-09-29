"use strict";

const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const test = require("node:test");

const { createApiRegressionRuntime } = require("./helpers/api-regression-runtime");

async function request(baseUrl, pathname, token, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  return { status: response.status, body: await response.json() };
}

async function login(baseUrl, username, password = "123456") {
  return request(baseUrl, "/api/auth/login", "", {
    method: "POST",
    body: JSON.stringify({ username, password })
  });
}

async function command(baseUrl, token, action, fields, idempotencyKey = randomUUID()) {
  return request(baseUrl, `/api/registration-referral/commands/${action}`, token, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(fields)
  });
}

test("GS-03 referral collaboration: scope, withdrawal, recovery and report return over HTTP", async (t) => {
  const runtime = createApiRegressionRuntime();
  t.after(() => runtime.stop());
  const baseUrl = await runtime.start();
  const actors = {};
  for (const [role, username, password] of [
    ["citizen", "citizen"],
    ["source", "doctor"],
    ["receiving", "hospital"],
    ["outsider", "out_of_scope_hospital", "out-of-scope-pass"]
  ]) {
    const response = await login(baseUrl, username, password);
    assert.equal(response.status, 200, `${username}: ${JSON.stringify(response.body)}`);
    actors[role] = response.body.token;
  }

  const caseId = "rtc-001";
  const oldAuthorizationId = "auth-r1-referral-demo";
  const newAuthorizationId = `auth-gs03-${randomUUID()}`;
  const reportPayload = {
    caseId,
    expectedVersion: 0,
    payload: {
      reportSummary: "Synthetic specialist assessment returned to the referring institution.",
      note: "Synthetic cross-institution report return."
    }
  };
  const snapshot = async () => {
    const response = await request(baseUrl, "/api/state", actors.source);
    assert.equal(response.status, 200);
    return response.body;
  };
  const consultation = (data) => data.referralTeleconsultations.find((item) => item.id === caseId);
  const reportRecords = (data) => data.personalRecords.filter((item) => item.category === "teleconsultation-report" && item.teleconsultationId === caseId);
  const businessProjection = (data) => ({
    teleconsultation: consultation(data),
    referral: data.referralSystem.referrals.find((item) => item.id === "rf1"),
    collaborationOrder: data.countyCollaborationOrders.find((item) => item.id === "cco-004"),
    reportRecords: reportRecords(data),
    closureEvents: data.registrationReferralClosureEvents
  });

  const initial = await snapshot();
  assert.equal(consultation(initial).status, "scheduled");
  assert.equal(consultation(initial).sourceInstitutionCode, "MR3");
  assert.equal(consultation(initial).targetInstitutionCode, "MR1");
  assert.equal(consultation(initial).residentAuthorizationId, oldAuthorizationId);
  const initialReports = reportRecords(initial).length;

  const denied = await command(baseUrl, actors.outsider, "return-referral-report", reportPayload);
  assert.equal(denied.status, 403, JSON.stringify(denied.body));
  assert.match(denied.body.message, /institution scope denied/);
  const afterDenied = await snapshot();
  assert.deepEqual(businessProjection(afterDenied), businessProjection(initial));

  const revoked = await command(baseUrl, actors.citizen, "revoke-referral-authorization", {
    expectedVersion: 0,
    payload: {
      authorizationId: oldAuthorizationId,
      reason: "Synthetic resident withdrew referral consent.",
      note: "Pause all linked open referrals."
    }
  });
  assert.equal(revoked.status, 201, JSON.stringify(revoked.body));
  assert.equal(revoked.body.result.authorization.status, "revoked");
  assert.ok(revoked.body.result.affectedCaseIds.includes(caseId));
  const afterRevocation = await snapshot();
  assert.equal(consultation(afterRevocation).status, "authorization-on-hold");
  assert.equal(consultation(afterRevocation).authorizationStatus, "revoked");
  assert.equal(reportRecords(afterRevocation).length, initialReports);

  const blockedReport = await command(baseUrl, actors.receiving, "return-referral-report", reportPayload);
  assert.equal(blockedReport.status, 400, JSON.stringify(blockedReport.body));
  assert.match(blockedReport.body.message, /must be scheduled before report return/);
  const afterBlockedReport = await snapshot();
  assert.deepEqual(businessProjection(afterBlockedReport), businessProjection(afterRevocation));

  const granted = await command(baseUrl, actors.citizen, "grant-referral-authorization", {
    residentId: "r1",
    payload: {
      authorizationId: newAuthorizationId,
      scope: "referral-teleconsultation",
      authorizedTo: ["MR1", "MR3"],
      dataScopes: ["clinical-summary", "referral-report"],
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      consentActor: "resident",
      note: "Synthetic replacement consent for referral recovery."
    }
  });
  assert.equal(granted.status, 201, JSON.stringify(granted.body));
  assert.equal(granted.body.result.authorization.status, "active");

  const resumed = await command(baseUrl, actors.source, "resume-referral-authorization", {
    caseId,
    expectedVersion: 0,
    payload: {
      authorizationId: newAuthorizationId,
      note: "Source institution resumes after replacement consent."
    }
  });
  assert.equal(resumed.status, 201, JSON.stringify(resumed.body));
  assert.equal(resumed.body.result.teleconsultation.status, "scheduled");
  assert.equal(resumed.body.result.teleconsultation.residentAuthorizationId, newAuthorizationId);
  const afterResume = await snapshot();
  assert.equal(afterResume.personalRecords.find((item) => item.id === oldAuthorizationId).status, "revoked");
  assert.equal(consultation(afterResume).status, "scheduled");
  assert.equal(reportRecords(afterResume).length, initialReports);

  const reportCommand = { ...reportPayload, expectedVersion: 1 };
  const reportKey = randomUUID();
  const returned = await command(baseUrl, actors.receiving, "return-referral-report", reportCommand, reportKey);
  assert.equal(returned.status, 201, JSON.stringify(returned.body));
  assert.equal(returned.body.productionReady, false);
  assert.equal(returned.body.result.teleconsultation.status, "report-returned");
  assert.equal(returned.body.result.referral.status, "report-returned");
  assert.equal(returned.body.result.collaborationOrder.status, "report-returned");
  assert.equal(returned.body.result.reportRecord.category, "teleconsultation-report");
  assert.equal(returned.body.result.reportRecord.teleconsultationId, caseId);
  const afterReturn = await snapshot();

  const replay = await command(baseUrl, actors.receiving, "return-referral-report", reportCommand, reportKey);
  assert.equal(replay.status, 200, JSON.stringify(replay.body));
  assert.equal(replay.body.idempotent, true);
  assert.equal(replay.body.event.id, returned.body.event.id);
  const completed = await snapshot();
  assert.deepEqual(businessProjection(completed), businessProjection(afterReturn));
  assert.equal(consultation(completed).status, "report-returned");
  assert.equal(reportRecords(completed).length, initialReports + 1);
  assert.equal(completed.registrationReferralClosureEvents.filter((item) => item.commandId === reportKey).length, 1);
  assert.equal(completed.referralSystem.referrals.find((item) => item.id === "rf1").status, "report-returned");
  assert.equal(completed.countyCollaborationOrders.find((item) => item.id === "cco-004").status, "report-returned");
});
