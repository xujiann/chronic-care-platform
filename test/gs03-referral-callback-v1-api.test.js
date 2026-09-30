"use strict";

const assert = require("node:assert/strict");
const { createHmac, randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { createApiRegressionRuntime } = require("./helpers/api-regression-runtime");

const CASE_ID = "rtc-001";
const RESIDENT_ID = "r1";
const TEST_SECRET = "synthetic-gs03-v1-callback-secret-at-least-32-characters";
const ENV_KEYS = [
  "DATA_DIR",
  "STORAGE_ENGINE",
  "SMS_DELIVERY_CALLBACK_SECRET",
  "DIGITAL_HOSPITAL_CALLBACK_SECRET",
  "CARE_CUTOVER_EVIDENCE_FILE",
  "CARE_CUTOVER_EVIDENCE_SHA256",
  "CARE_DEPENDENCY_EVIDENCE_FILE",
  "CARE_DEPENDENCY_EVIDENCE_SHA256",
  "INTEGRATION_GATEWAY_SECRET"
];
const CONTRACTS = Object.freeze({
  feedback: "referral-feedback-callback-v1",
  schedule: "referral-schedule-callback-v1",
  report: "referral-report-callback-v1"
});

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function signature(payload) {
  return createHmac("sha256", TEST_SECRET).update(stableStringify(payload)).digest("hex");
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
  assert.equal(response.status, 200, username);
  return response.body.token;
}

function payloadFor(type, key) {
  const actorSlot = ["source", "receiving", "county", "commission"].findIndex((actor) => key.includes(`-${actor}-`));
  const scheduleMinute = actorSlot < 0 ? 4 : actorSlot;
  const common = {
    idempotencyKey: key,
    externalId: `synthetic-${type}-${key}`,
    teleconsultationId: CASE_ID,
    residentId: RESIDENT_ID,
    sourceSystem: "synthetic-referral-adapter"
  };
  if (type === "feedback") return {
    ...common,
    receivingFeedback: `Synthetic receiving assessment accepted for ${key}.`,
    feedbackAt: "2026-09-30T08:00:00.000Z",
    feedbackStatus: "feedback-returned"
  };
  if (type === "schedule") return {
    ...common,
    meetingWindow: `2026-10-01 09:0${scheduleMinute}-09:3${scheduleMinute}`,
    targetInstitution: "示范医院",
    targetInstitutionCode: "MR1",
    department: "示范专科",
    receivingDoctor: "doc-wang",
    scheduleStatus: "scheduled"
  };
  return {
    ...common,
    reportSummary: `Synthetic specialist report returned for ${key}.`,
    reportReturnedAt: "2026-09-30T10:00:00.000Z"
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

test("GS-03 v1 referral callback HTTP characterization: roles, signatures, replay and persisted effects", async (t) => {
  const previousEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  let runtime;
  t.after(async () => {
    try {
      if (runtime) await runtime.stop();
    } finally {
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
  process.env.INTEGRATION_GATEWAY_SECRET = TEST_SECRET;
  runtime = createApiRegressionRuntime();
  const dataFile = path.join(process.env.DATA_DIR, "db.json");
  const persisted = () => JSON.parse(fs.readFileSync(dataFile, "utf8"));
  const baseUrl = await runtime.start();

  const actors = {
    source: await login(baseUrl, "doctor"),
    receiving: await login(baseUrl, "hospital"),
    county: await login(baseUrl, "county"),
    commission: await login(baseUrl, "health"),
    outsider: await login(baseUrl, "out_of_scope_hospital", "out-of-scope-pass"),
    citizen: await login(baseUrl, "citizen")
  };
  const postCallback = (type, token, payload, signedPayload = payload, caseId = CASE_ID) =>
    request(baseUrl, `/api/referral-teleconsultations/${caseId}/${type}-callback`, token, {
      method: "POST",
      headers: signedPayload ? { "x-integration-signature": signature(signedPayload) } : {},
      body: JSON.stringify(payload)
    });

  const initial = persisted();
  const initialCase = initial.referralTeleconsultations.find((item) => item.id === CASE_ID);
  assert.equal(initialCase.residentId, RESIDENT_ID);
  assert.equal(initialCase.sourceInstitutionCode, "MR3");
  assert.equal(initialCase.targetInstitutionCode, "MR1");
  const users = runtime.fixture.authUsers;
  const sourceUser = users.find((item) => item.username === "doctor");
  const receivingUser = users.find((item) => item.username === "hospital");
  const countyUser = users.find((item) => item.username === "county");
  const commissionUser = users.find((item) => item.username === "health");
  assert.equal(sourceUser.role, "institution");
  assert.equal(sourceUser.orgCode, initialCase.sourceInstitutionCode);
  assert.equal(sourceUser.doctorId, initialCase.applicantDoctor);
  assert.equal(receivingUser.role, "institution");
  assert.equal(receivingUser.orgCode, initialCase.targetInstitutionCode);
  assert.equal(countyUser.role, "county");
  assert.equal(commissionUser.role, "commission");

  for (const type of Object.keys(CONTRACTS)) {
    const payload = payloadFor(type, `gs03-v1-negative-${type}-${randomUUID()}`);
    const before = businessProjection(persisted());
    const denied = [
      ["outside institution", actors.outsider, payload, payload, 403],
      ["citizen role", actors.citizen, payload, payload, 403],
      ["anonymous", "", payload, payload, 401],
      ["unsigned", actors.source, payload, null, 401],
      ["signed body changed", actors.source, { ...payload, sourceSystem: "tampered-synthetic-adapter" }, payload, 401],
      ["resident mismatch", actors.source, { ...payload, residentId: "r2" }, { ...payload, residentId: "r2" }, 400],
      ["unknown case", actors.source, payload, payload, 404, "gs03-missing-case"]
    ];
    for (const [label, token, body, signedBody, expected, caseId] of denied) {
      const beforeAttempt = persisted();
      const response = await postCallback(type, token, body, signedBody, caseId);
      assert.equal(response.status, expected, `${type}: ${label}: ${JSON.stringify(response.body)}`);
      const afterAttempt = persisted();
      assert.deepEqual(businessProjection(afterAttempt), businessProjection(beforeAttempt), `${type}: ${label} changed business data`);
      if (["outside institution", "unsigned", "signed body changed"].includes(label)) {
        const priorIds = new Set(beforeAttempt.securityEvents.map((item) => item.id));
        const addedAudit = afterAttempt.securityEvents.filter((item) => !priorIds.has(item.id));
        assert.ok(addedAudit.some((item) =>
          item.action === `referral teleconsultation ${type} callback` && item.target === CASE_ID &&
          item.result === "denied" && item.detail === (label === "outside institution" ? "scope denied" : "signature mismatch")));
      }
    }
    // Authentication and scope failures may append security audit rows. No business collection may change.
    assert.deepEqual(businessProjection(persisted()), before, `${type}: rejected callback changed business data`);
  }

  for (const type of Object.keys(CONTRACTS)) {
    for (const [actorName, token] of [
      ["source", actors.source],
      ["receiving", actors.receiving],
      ["county", actors.county],
      ["commission", actors.commission]
    ]) {
      const key = `gs03-v1-${type}-${actorName}-${randomUUID()}`;
      const payload = payloadFor(type, key);
      const before = persisted();
      const accepted = await postCallback(type, token, payload);
      assert.equal(accepted.status, 200, `${type}/${actorName}: ${JSON.stringify(accepted.body)}`);
      assert.equal(accepted.body.integrationEvent.contractId, CONTRACTS[type]);
      assert.equal(accepted.body.integrationEvent.targetId, CASE_ID);
      assert.equal(accepted.body.integrationEvent.idempotencyKey, key);
      assert.equal(accepted.body.integrationEvent.reconciliationStatus, "matched");
      assert.equal(accepted.body.messages.length, 2);
      assert.deepEqual(new Set(accepted.body.messages.map((item) => item.targetRole)), new Set(["institution", "citizen"]));
      assert.ok(accepted.body.messages.every((item) => item.sourceId === CASE_ID && item.notificationKey.includes(key)));
      const after = persisted();
      const caseAfter = after.referralTeleconsultations.find((item) => item.id === CASE_ID);
      assert.equal(caseAfter.status, type === "feedback" ? "feedback-returned" : type === "schedule" ? "scheduled" : "report-returned");
      if (type === "feedback") assert.equal(caseAfter.receivingFeedback, payload.receivingFeedback);
      if (type === "schedule") {
        assert.equal(caseAfter.meetingWindow, payload.meetingWindow);
        assert.equal(caseAfter.targetInstitutionCode, payload.targetInstitutionCode);
        assert.equal(caseAfter.receivingDoctor, payload.receivingDoctor);
      }
      if (type === "report") assert.equal(caseAfter.reportSummary, payload.reportSummary);
      assert.equal(after.integrationGatewayEvents.length, before.integrationGatewayEvents.length + 1);
      assert.equal(after.integrationGatewayEvents.filter((item) => item.contractId === CONTRACTS[type] && item.idempotencyKey === key).length, 1);
      assert.equal(after.taskMessages.length, before.taskMessages.length + 2);
      for (const returnedMessage of accepted.body.messages) {
        const storedMessage = after.taskMessages.find((item) => item.id === returnedMessage.id);
        assert.ok(storedMessage, `${type}/${actorName}: returned message was not persisted`);
        assert.equal(storedMessage.sourceId, CASE_ID);
        assert.equal(storedMessage.targetRole, returnedMessage.targetRole);
        assert.equal(storedMessage.notificationKey, returnedMessage.notificationKey);
      }
      assert.equal(after.dataAccessLogs.length, before.dataAccessLogs.length + 1);
      assert.equal(after.dataAccessLogs[0].residentId, RESIDENT_ID);
      assert.equal(after.dataAccessLogs[0].scope, "referral teleconsultation");
      assert.equal(after.dataAccessLogs[0].purpose, `external ${type} callback`);
      assert.ok(after.securityEvents.some((item) =>
        item.action === `referral teleconsultation ${type} callback` && item.target === CASE_ID &&
        item.result === "allowed" && item.detail.includes(key)));
      const beforeReports = before.personalRecords.filter((item) => item.category === "teleconsultation-report" && item.teleconsultationId === CASE_ID);
      const afterReports = after.personalRecords.filter((item) => item.category === "teleconsultation-report" && item.teleconsultationId === CASE_ID);
      assert.equal(afterReports.length, beforeReports.length + (type === "report" ? 1 : 0));
      if (type === "report") {
        assert.equal(accepted.body.personalRecord.idempotencyKey, key);
        assert.equal(afterReports.filter((item) => item.idempotencyKey === key).length, 1);
        const archived = afterReports.find((item) => item.idempotencyKey === key);
        assert.equal(archived.residentId, RESIDENT_ID);
        assert.equal(archived.result, payload.reportSummary);
        assert.equal(archived.externalReportId, payload.externalId);
      } else {
        assert.equal(accepted.body.personalRecord, null);
      }

      const replay = await postCallback(type, token, payload);
      assert.equal(replay.status, 200);
      assert.equal(replay.body.integrationEvent.id, accepted.body.integrationEvent.id);
      assert.equal(replay.body.integrationEvent.idempotentReplay, true);
      assert.deepEqual(businessProjection(persisted()), businessProjection(after), `${type}/${actorName}: exact replay changed business data`);
      assert.deepEqual(persisted().securityEvents, after.securityEvents, `${type}/${actorName}: exact replay appended audit`);

      // Known v1 legacy behavior, not a safe idempotency contract: a changed signed body reuses the old event.
      const changed = type === "feedback"
        ? { ...payload, receivingFeedback: "Synthetic changed receiving assessment." }
        : type === "schedule"
          ? { ...payload, meetingWindow: "2026-10-02 10:00-10:30" }
          : { ...payload, reportSummary: "Synthetic changed specialist report." };
      const driftReplay = await postCallback(type, token, changed);
      assert.equal(driftReplay.status, 200, `${type}/${actorName}: v1 changed-body characterization`);
      assert.equal(driftReplay.body.integrationEvent.id, accepted.body.integrationEvent.id);
      assert.equal(driftReplay.body.integrationEvent.idempotentReplay, true);
      assert.deepEqual(businessProjection(persisted()), businessProjection(after), `${type}/${actorName}: v1 changed-body replay changed business data`);
      assert.deepEqual(persisted().securityEvents, after.securityEvents, `${type}/${actorName}: v1 changed-body replay appended audit`);
    }
  }
});
