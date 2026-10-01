"use strict";

const assert = require("node:assert/strict");
const { createHmac, randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { createApiRegressionRuntime } = require("./helpers/api-regression-runtime");

const CASE_A = "rtc-001";
const CASE_B = "rtc-gs03-callback-boundary-b";
const RESIDENT_ID = "r1";
const SECRET = "synthetic-gs03-boundary-callback-secret-at-least-32-characters";
const ENV_KEYS = [
  "DATA_DIR", "STORAGE_ENGINE", "SMS_DELIVERY_CALLBACK_SECRET",
  "DIGITAL_HOSPITAL_CALLBACK_SECRET", "CARE_CUTOVER_EVIDENCE_FILE",
  "CARE_CUTOVER_EVIDENCE_SHA256", "CARE_DEPENDENCY_EVIDENCE_FILE",
  "CARE_DEPENDENCY_EVIDENCE_SHA256", "INTEGRATION_GATEWAY_SECRET"
];
const CONTRACTS = {
  feedback: "referral-feedback-callback-v1",
  schedule: "referral-schedule-callback-v1",
  report: "referral-report-callback-v1"
};

// Independent wire canonicalization: do not call the implementation's verifier.
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function signature(payload) {
  return createHmac("sha256", SECRET).update(stableStringify(payload)).digest("hex");
}

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
  const response = await request(baseUrl, "/api/auth/login", "", {
    method: "POST",
    body: JSON.stringify({ username, password })
  });
  assert.equal(response.status, 200, `${username}: ${JSON.stringify(response.body)}`);
  return response.body.token;
}

function payloadFor(type, key, label, caseId = CASE_A) {
  const scheduleDay = label.startsWith("relocated-") ? "02"
    : label.startsWith("principal-a-") ? "03"
      : label.startsWith("principal-b-") ? "04"
        : label.startsWith("before-revoke-") ? "05" : "06";
  const common = {
    idempotencyKey: key,
    externalId: `synthetic-${type}-${label}`,
    teleconsultationId: caseId,
    residentId: RESIDENT_ID,
    sourceSystem: "synthetic-referral-adapter"
  };
  if (type === "feedback") return {
    ...common,
    receivingFeedback: `Synthetic receiving assessment for ${label}.`,
    feedbackAt: "2026-10-01T08:00:00.000Z",
    feedbackStatus: "feedback-returned"
  };
  if (type === "schedule") return {
    ...common,
    meetingWindow: `2026-10-${scheduleDay} 09:00-09:30`,
    targetInstitution: "示范医院",
    targetInstitutionCode: "MR1",
    department: "示范专科",
    receivingDoctor: "doc-wang",
    scheduleStatus: "scheduled"
  };
  return {
    ...common,
    reportSummary: `Synthetic specialist report for ${label}.`,
    reportReturnedAt: "2026-10-01T10:00:00.000Z"
  };
}

function businessProjection(data) {
  return {
    referralTeleconsultations: data.referralTeleconsultations,
    integrationGatewayEvents: data.integrationGatewayEvents,
    personalRecords: data.personalRecords,
    taskMessages: data.taskMessages,
    dataAccessLogs: data.dataAccessLogs
  };
}

function caseRow(data, caseId) {
  const row = data.referralTeleconsultations.find((item) => item.id === caseId);
  assert.ok(row, `missing case ${caseId}`);
  return row;
}

function newRows(after, before, collection) {
  const oldIds = new Set(before[collection].map((item) => item.id));
  return after[collection].filter((item) => !oldIds.has(item.id));
}

function assertSuccess(before, after, response, type, payload, caseId, actor) {
  assert.equal(response.status, 200, `${type}/${actor}: ${JSON.stringify(response.body)}`);
  const event = response.body.integrationEvent;
  assert.equal(event.contractId, CONTRACTS[type]);
  assert.equal(event.idempotencyKey, payload.idempotencyKey);
  assert.equal(event.targetId, caseId);
  assert.equal(event.receivedBy, actor);
  assert.equal(event.idempotentReplay, undefined);
  assert.deepEqual(newRows(after, before, "integrationGatewayEvents").map((item) => item.id), [event.id]);
  const updated = caseRow(after, caseId);
  if (type === "feedback") assert.equal(updated.receivingFeedback, payload.receivingFeedback);
  if (type === "schedule") {
    assert.equal(updated.meetingWindow, payload.meetingWindow);
    assert.equal(updated.targetInstitutionCode, payload.targetInstitutionCode);
    assert.equal(updated.receivingDoctor, payload.receivingDoctor);
  }
  if (type === "report") assert.equal(updated.reportSummary, payload.reportSummary);
  const storedMessages = newRows(after, before, "taskMessages");
  assert.equal(storedMessages.length, 2);
  assert.equal(response.body.messages.length, 2);
  assert.deepEqual(new Set(storedMessages.map((item) => item.targetRole)), new Set(["institution", "citizen"]));
  for (const returned of response.body.messages) {
    const stored = storedMessages.find((item) => item.id === returned.id);
    assert.ok(stored);
    assert.equal(stored.sourceId, caseId);
    assert.equal(stored.notificationKey, returned.notificationKey);
    assert.ok(stored.notificationKey.includes(payload.idempotencyKey));
  }
  const access = newRows(after, before, "dataAccessLogs");
  assert.equal(access.length, 1);
  assert.equal(access[0].residentId, RESIDENT_ID);
  assert.equal(access[0].purpose, `external ${type} callback`);
  const audits = newRows(after, before, "securityEvents");
  assert.ok(audits.some((item) => item.action === `referral teleconsultation ${type} callback` &&
    item.target === caseId && item.result === "allowed" && item.detail.includes(payload.idempotencyKey)));
  const archives = newRows(after, before, "personalRecords").filter((item) => item.category === "teleconsultation-report");
  assert.equal(archives.length, type === "report" ? 1 : 0);
  if (type === "report") {
    assert.equal(archives[0].teleconsultationId, caseId);
    assert.equal(archives[0].residentId, RESIDENT_ID);
    assert.equal(archives[0].result, payload.reportSummary);
    assert.equal(archives[0].externalReportId, payload.externalId);
  }
}

test("GS-03 v1 callback boundaries: signed URL relocation, principal-free receipt and revoked authorization", async (t) => {
  const oldEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  let runtime;
  t.after(async () => {
    try {
      if (runtime) await runtime.stop();
    } finally {
      for (const [key, value] of Object.entries(oldEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
  process.env.INTEGRATION_GATEWAY_SECRET = SECRET;
  runtime = createApiRegressionRuntime();
  const dataFile = path.join(process.env.DATA_DIR, "db.json");
  const persisted = () => JSON.parse(fs.readFileSync(dataFile, "utf8"));
  const initial = persisted();
  const original = caseRow(initial, CASE_A);
  assert.equal(original.residentId, RESIDENT_ID);
  const authorizationId = original.residentAuthorizationId;
  assert.ok(authorizationId);
  assert.equal(initial.personalRecords.find((item) => item.id === authorizationId)?.status, "active");
  assert.ok(!initial.referralTeleconsultations.some((item) => item.id === CASE_B));
  // This clone exists only in the runtime's disposable JSON fixture, before the server starts.
  initial.referralTeleconsultations.push({ ...structuredClone(original), id: CASE_B });
  fs.writeFileSync(dataFile, JSON.stringify(initial, null, 2), "utf8");
  const baseUrl = await runtime.start();
  const actors = {
    source: await login(baseUrl, "doctor"),
    receiving: await login(baseUrl, "hospital"),
    outsider: await login(baseUrl, "out_of_scope_hospital", "out-of-scope-pass"),
    citizen: await login(baseUrl, "citizen")
  };
  const users = runtime.fixture.authUsers;
  const source = users.find((item) => item.username === "doctor");
  const receiving = users.find((item) => item.username === "hospital");
  assert.equal(source.role, "institution");
  assert.equal(source.orgCode, original.sourceInstitutionCode);
  assert.equal(source.doctorId, original.applicantDoctor);
  assert.equal(receiving.role, "institution");
  assert.equal(receiving.orgCode, original.targetInstitutionCode);
  assert.equal(caseRow(persisted(), CASE_B).residentAuthorizationId, authorizationId);
  const postCallback = (type, caseId, token, payload, signedPayload = payload) =>
    request(baseUrl, `/api/referral-teleconsultations/${caseId}/${type}-callback`, token, {
      method: "POST",
      headers: { "x-integration-signature": signature(signedPayload) },
      body: JSON.stringify(payload)
    });

  // Known v1 legacy behavior: HMAC covers the body but not the URL resource.
  for (const type of ["report", "schedule", "feedback"]) {
    const key = `gs03-boundary-relocate-${type}-${randomUUID()}`;
    const bodyForA = payloadFor(type, key, `relocated-${type}`, CASE_A);
    const before = persisted();
    assert.equal(caseRow(before, CASE_A).residentId, caseRow(before, CASE_B).residentId);
    assert.equal(caseRow(before, CASE_A).residentAuthorizationId, caseRow(before, CASE_B).residentAuthorizationId);
    const relocated = await postCallback(type, CASE_B, actors.source, bodyForA);
    const after = persisted();
    assertSuccess(before, after, relocated, type, bodyForA, CASE_B, source.username);
    assert.deepEqual(caseRow(after, CASE_A), caseRow(before, CASE_A), `${type}: signed relocation changed body-named case A`);
    const tampered = { ...bodyForA, sourceSystem: "tampered-synthetic-adapter" };
    const beforeTamper = persisted();
    const denied = await postCallback(type, CASE_B, actors.source, tampered, bodyForA);
    assert.equal(denied.status, 401, `${type}: signed-body tamper control`);
    const afterTamper = persisted();
    assert.deepEqual(businessProjection(afterTamper), businessProjection(beforeTamper));
    assert.ok(newRows(afterTamper, beforeTamper, "securityEvents").some((item) =>
      item.action === `referral teleconsultation ${type} callback` && item.target === CASE_B &&
      item.result === "denied" && item.detail === "signature mismatch"));
  }

  // Known v1 legacy behavior: receipt lookup is contract + key, not actor or target resource.
  for (const type of ["report", "schedule", "feedback"]) {
    const key = `gs03-boundary-principal-${type}-${randomUUID()}`;
    const bodyForA = payloadFor(type, key, `principal-a-${type}`, CASE_A);
    const before = persisted();
    const first = await postCallback(type, CASE_A, actors.source, bodyForA);
    const afterFirst = persisted();
    assertSuccess(before, afterFirst, first, type, bodyForA, CASE_A, source.username);
    const sameKeyOtherPrincipal = await postCallback(type, CASE_A, actors.receiving, bodyForA);
    assert.equal(sameKeyOtherPrincipal.status, 200);
    assert.equal(sameKeyOtherPrincipal.body.integrationEvent.id, first.body.integrationEvent.id);
    assert.equal(sameKeyOtherPrincipal.body.integrationEvent.receivedBy, source.username);
    assert.equal(sameKeyOtherPrincipal.body.integrationEvent.idempotentReplay, true);
    assert.deepEqual(businessProjection(persisted()), businessProjection(afterFirst));
    assert.deepEqual(persisted().securityEvents, afterFirst.securityEvents);

    const bodyForB = payloadFor(type, key, `principal-b-${type}`, CASE_B);
    const beforeCrossTarget = persisted();
    const crossTargetReplay = await postCallback(type, CASE_B, actors.receiving, bodyForB);
    assert.equal(crossTargetReplay.status, 200);
    assert.equal(crossTargetReplay.body.integrationEvent.id, first.body.integrationEvent.id);
    assert.equal(crossTargetReplay.body.integrationEvent.targetId, CASE_A);
    assert.equal(crossTargetReplay.body.integrationEvent.receivedBy, source.username);
    assert.equal(crossTargetReplay.body.integrationEvent.idempotentReplay, true);
    assert.equal(crossTargetReplay.body.teleconsultation.id, CASE_B);
    assert.deepEqual(businessProjection(persisted()), businessProjection(beforeCrossTarget));
    assert.deepEqual(persisted().securityEvents, beforeCrossTarget.securityEvents);

    const beforeOutsider = persisted();
    const outsider = await postCallback(type, CASE_B, actors.outsider, bodyForB);
    assert.equal(outsider.status, 403, `${type}: outsider scope control`);
    const afterOutsider = persisted();
    assert.deepEqual(businessProjection(afterOutsider), businessProjection(beforeOutsider));
    assert.ok(newRows(afterOutsider, beforeOutsider, "securityEvents").some((item) =>
      item.action === `referral teleconsultation ${type} callback` && item.target === CASE_B &&
      item.result === "denied" && item.detail === "scope denied"));
  }

  // Store one successful pre-withdrawal receipt per contract; leave A nonterminal for real HTTP withdrawal.
  const oldReceipts = {};
  for (const type of ["report", "schedule", "feedback"]) {
    const key = `gs03-boundary-before-revoke-${type}-${randomUUID()}`;
    const payload = payloadFor(type, key, `before-revoke-${type}`);
    const before = persisted();
    const accepted = await postCallback(type, CASE_A, actors.source, payload);
    const after = persisted();
    assertSuccess(before, after, accepted, type, payload, CASE_A, source.username);
    oldReceipts[type] = { payload, eventId: accepted.body.integrationEvent.id };
  }
  const beforeRevoke = persisted();
  assert.equal(caseRow(beforeRevoke, CASE_A).residentAuthorizationId, authorizationId);
  assert.equal(caseRow(beforeRevoke, CASE_A).status, "feedback-returned");
  assert.equal(beforeRevoke.personalRecords.find((item) => item.id === authorizationId).status, "active");
  const revoked = await request(baseUrl, "/api/registration-referral/commands/revoke-referral-authorization", actors.citizen, {
    method: "POST",
    headers: { "Idempotency-Key": randomUUID() },
    body: JSON.stringify({
      expectedVersion: 0,
      payload: {
        authorizationId,
        reason: "Synthetic resident withdrew referral authorization.",
        note: "Synthetic callback boundary characterization."
      }
    })
  });
  assert.equal(revoked.status, 201, JSON.stringify(revoked.body));
  assert.equal(revoked.body.result.authorization.id, authorizationId);
  assert.ok(revoked.body.result.affectedCaseIds.includes(CASE_A));
  const afterRevoke = persisted();
  const authorization = afterRevoke.personalRecords.find((item) => item.id === authorizationId);
  assert.equal(authorization.status, "revoked");
  assert.ok(authorization.revokedAt);
  assert.equal(authorization.meta.status, "revoked");
  assert.equal(caseRow(afterRevoke, CASE_A).status, "authorization-on-hold");
  assert.equal(caseRow(afterRevoke, CASE_A).authorizationStatus, "revoked");
  assert.equal(caseRow(afterRevoke, CASE_A).residentAuthorizationId, authorizationId);
  assert.equal(newRows(afterRevoke, beforeRevoke, "integrationGatewayEvents").length, 0);
  // Revocation itself may write notifications/audit; callback deltas begin from this post-command snapshot.
  // Replay old receipts while A is still on authorization hold, before any fresh callback can alter that state.
  for (const type of ["report", "schedule", "feedback"]) {
    const oldReceipt = oldReceipts[type];
    const beforeReplay = persisted();
    assert.equal(caseRow(beforeReplay, CASE_A).status, "authorization-on-hold");
    assert.equal(beforeReplay.personalRecords.find((item) => item.id === authorizationId).status, "revoked");
    const replay = await postCallback(type, CASE_A, actors.source, oldReceipt.payload);
    assert.equal(replay.status, 200, `${type}: old receipt while authorization is revoked and case is on hold`);
    assert.equal(replay.body.integrationEvent.id, oldReceipt.eventId);
    assert.equal(replay.body.integrationEvent.idempotentReplay, true);
    assert.deepEqual(businessProjection(persisted()), businessProjection(beforeReplay));
    assert.deepEqual(persisted().securityEvents, beforeReplay.securityEvents);
  }
  // Known v1 legacy behavior, not an authorized v2 contract: a scoped actor can first-use a new key after revocation.
  for (const type of ["report", "schedule", "feedback"]) {
    const newKey = `gs03-boundary-revoked-new-${type}-${randomUUID()}`;
    const freshPayload = payloadFor(type, newKey, `revoked-new-${type}`);
    const beforeFresh = persisted();
    assert.equal(beforeFresh.personalRecords.find((item) => item.id === authorizationId).status, "revoked");
    const fresh = await postCallback(type, CASE_A, actors.source, freshPayload);
    const afterFresh = persisted();
    assertSuccess(beforeFresh, afterFresh, fresh, type, freshPayload, CASE_A, source.username);
    assert.equal(afterFresh.personalRecords.find((item) => item.id === authorizationId).status, "revoked");
    assert.equal(caseRow(afterFresh, CASE_A).residentAuthorizationId, authorizationId);
  }
});
