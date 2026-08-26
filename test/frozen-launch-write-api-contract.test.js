"use strict";

const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");

const ROOT = path.resolve(__dirname, "..");

async function api(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  return { response, body: await response.json() };
}

function authorized(token, options = {}) {
  return {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`
    }
  };
}

async function login(baseUrl, username) {
  const result = await api(baseUrl, "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "123456" })
  });
  assert.equal(result.response.status, 200, `${username}: ${JSON.stringify(result.body)}`);
  return result.body.token;
}

test("frozen T04/T05 write APIs prove identity, scope, replay, conflict, CAS and atomic audit behavior", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "health-platform-frozen-write-api-"));
  fs.copyFileSync(path.join(ROOT, "data", "db.json"), path.join(dataDir, "db.json"));
  const previous = { DATA_DIR: process.env.DATA_DIR, STORAGE_ENGINE: process.env.STORAGE_ENGINE };
  process.env.DATA_DIR = dataDir;
  process.env.STORAGE_ENGINE = "sqlite";

  const { server, startServer, stopServer } = require(path.join(ROOT, "server.js"));
  startServer(0);
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await stopServer();
    fs.rmSync(dataDir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  for (const [pathname, method] of [
    ["/api/chronic-management-plans/cmp-001", "PATCH"],
    ["/api/chronic/followup-feedback", "POST"],
    ["/api/referral-teleconsultations", "POST"],
    ["/api/referral-teleconsultations/rtc-001/actions", "POST"]
  ]) {
    const denied = await api(baseUrl, pathname, {
      method,
      headers: { "Content-Type": "application/json" },
      body: "{"
    });
    assert.equal(denied.response.status, 401, `${method} ${pathname} must authenticate before parsing body`);
  }

  const commissionToken = await login(baseUrl, "health");
  const doctorToken = await login(baseUrl, "doctor");
  const citizenToken = await login(baseUrl, "citizen");
  const nurseToken = await login(baseUrl, "nurse");
  const countyToken = await login(baseUrl, "county");

  const citizenPatchDenied = await api(baseUrl, "/api/chronic-management-plans/cmp-001", authorized(citizenToken, {
    method: "PATCH",
    body: JSON.stringify({ status: "tampered" })
  }));
  assert.equal(citizenPatchDenied.response.status, 403);

  let state = (await api(baseUrl, "/api/state", authorized(commissionToken))).body;
  const planVersion = state.storageMeta.collectionVersions.chronicManagementPlans;
  const planAuditBefore = state.securityEvents.filter((event) => event.target === "chronicManagementPlans/cmp-001").length;
  const planHeaders = { "Idempotency-Key": "t04-plan-command-001" };
  const planPayload = { expectedVersion: planVersion, status: "versioned-followup", intervention: "protected command path" };
  const planFirst = await api(baseUrl, "/api/chronic-management-plans/cmp-001", authorized(doctorToken, { method: "PATCH", headers: planHeaders, body: JSON.stringify(planPayload) }));
  const planReplay = await api(baseUrl, "/api/chronic-management-plans/cmp-001", authorized(doctorToken, { method: "PATCH", headers: planHeaders, body: JSON.stringify(planPayload) }));
  assert.equal(planFirst.response.status, 200);
  assert.equal(planReplay.response.status, 200);
  assert.deepEqual(planReplay.body, planFirst.body);
  const planConflict = await api(baseUrl, "/api/chronic-management-plans/cmp-001", authorized(doctorToken, { method: "PATCH", headers: planHeaders, body: JSON.stringify({ ...planPayload, intervention: "different intent" }) }));
  assert.equal(planConflict.response.status, 409);
  assert.equal(planConflict.body.code, "CHRONIC_MANAGEMENT_PLAN_IDEMPOTENCY_CONFLICT");
  const planStale = await api(baseUrl, "/api/chronic-management-plans/cmp-001", authorized(doctorToken, { method: "PATCH", headers: { "Idempotency-Key": "t04-plan-stale-001" }, body: JSON.stringify({ expectedVersion: planVersion, status: "stale" }) }));
  assert.equal(planStale.response.status, 409);
  assert.equal(planStale.body.code, "CHRONIC_MANAGEMENT_PLAN_VERSION_CONFLICT");
  state = (await api(baseUrl, "/api/state", authorized(commissionToken))).body;
  assert.equal(state.securityEvents.filter((event) => event.target === "chronicManagementPlans/cmp-001").length, planAuditBefore + 1);
  assert.equal(state.storageMeta.collectionVersions.chronicManagementPlans, planVersion + 1);

  const feedbackWrongRole = await api(baseUrl, "/api/chronic/followup-feedback", authorized(countyToken, { method: "POST", body: JSON.stringify({ residentId: "r1" }) }));
  assert.equal(feedbackWrongRole.response.status, 403);
  state = (await api(baseUrl, "/api/state", authorized(commissionToken))).body;
  const feedbackVersion = state.storageMeta.collectionVersions.personalRecords;
  const feedbackPayload = { expectedVersion: feedbackVersion, residentId: "r1", followupId: "f1", medicationTaken: true, symptoms: "stable after medication", nextRequest: "routine review" };
  const feedbackHeaders = { "Idempotency-Key": "t04-feedback-command-001" };
  const feedbackFirst = await api(baseUrl, "/api/chronic/followup-feedback", authorized(citizenToken, { method: "POST", headers: feedbackHeaders, body: JSON.stringify(feedbackPayload) }));
  const feedbackReplay = await api(baseUrl, "/api/chronic/followup-feedback", authorized(citizenToken, { method: "POST", headers: feedbackHeaders, body: JSON.stringify(feedbackPayload) }));
  assert.equal(feedbackFirst.response.status, 201, JSON.stringify(feedbackFirst.body));
  assert.equal(feedbackReplay.response.status, 200);
  assert.deepEqual(feedbackReplay.body, feedbackFirst.body);
  const feedbackConflict = await api(baseUrl, "/api/chronic/followup-feedback", authorized(citizenToken, { method: "POST", headers: feedbackHeaders, body: JSON.stringify({ ...feedbackPayload, symptoms: "different intent" }) }));
  assert.equal(feedbackConflict.response.status, 409);
  assert.equal(feedbackConflict.body.code, "CHRONIC_FEEDBACK_IDEMPOTENCY_CONFLICT");
  const feedbackScopeDenied = await api(baseUrl, "/api/chronic/followup-feedback", authorized(citizenToken, { method: "POST", headers: { "Idempotency-Key": "t04-feedback-scope-001" }, body: JSON.stringify({ residentId: "r2", followupId: "f2" }) }));
  assert.equal(feedbackScopeDenied.response.status, 403);
  state = (await api(baseUrl, "/api/state", authorized(commissionToken))).body;
  assert.equal(state.storageMeta.collectionVersions.personalRecords, feedbackVersion + 1);

  state = (await api(baseUrl, "/api/state", authorized(commissionToken))).body;
  const authorization = state.personalRecords.find((item) => item.category === "authorizations" && item.residentId === "r1" && !item.revokedAt);
  const teleVersion = state.storageMeta.collectionVersions.referralTeleconsultations;
  const createPayload = {
    expectedVersion: teleVersion,
    residentId: "r1",
    residentAuthorizationId: authorization.id,
    referralId: "rf1",
    targetInstitution: "区域中心医院",
    targetInstitutionCode: "MR1",
    department: "Cardiology",
    clinicalQuestion: "Review persistent hypertension"
  };
  const createHeaders = { "Idempotency-Key": "t05-tele-create-001" };
  const createFirst = await api(baseUrl, "/api/referral-teleconsultations", authorized(doctorToken, { method: "POST", headers: createHeaders, body: JSON.stringify(createPayload) }));
  const createReplay = await api(baseUrl, "/api/referral-teleconsultations", authorized(doctorToken, { method: "POST", headers: createHeaders, body: JSON.stringify(createPayload) }));
  assert.equal(createFirst.response.status, 201, JSON.stringify(createFirst.body));
  assert.equal(createReplay.response.status, 200);
  assert.deepEqual(createReplay.body, createFirst.body);
  const createConflict = await api(baseUrl, "/api/referral-teleconsultations", authorized(doctorToken, { method: "POST", headers: createHeaders, body: JSON.stringify({ ...createPayload, clinicalQuestion: "Different intent" }) }));
  assert.equal(createConflict.response.status, 409);
  assert.equal(createConflict.body.code, "REFERRAL_TELECONSULTATION_CREATE_IDEMPOTENCY_CONFLICT");
  const createScopeDenied = await api(baseUrl, "/api/referral-teleconsultations", authorized(doctorToken, { method: "POST", headers: { "Idempotency-Key": "t05-tele-create-scope-001" }, body: JSON.stringify({ ...createPayload, expectedVersion: teleVersion + 1, sourceInstitution: "Other Hospital", sourceInstitutionCode: "OTHER" }) }));
  assert.equal(createScopeDenied.response.status, 403);

  state = (await api(baseUrl, "/api/state", authorized(commissionToken))).body;
  const privateCreate = await api(baseUrl, "/api/referral-teleconsultations", authorized(commissionToken, {
    method: "POST",
    headers: { "Idempotency-Key": "t05-tele-private-create-001" },
    body: JSON.stringify({
      ...createPayload,
      id: "rtc-scope-private",
      expectedVersion: state.storageMeta.collectionVersions.referralTeleconsultations,
      sourceInstitution: "Other Source Hospital",
      sourceInstitutionCode: "OTHER-SOURCE",
      targetInstitution: "Other Target Hospital",
      targetInstitutionCode: "OTHER-TARGET"
    })
  }));
  assert.equal(privateCreate.response.status, 201, JSON.stringify(privateCreate.body));

  state = (await api(baseUrl, "/api/state", authorized(commissionToken))).body;
  const actionVersion = state.storageMeta.collectionVersions.referralTeleconsultations;
  const actionPayload = { expectedVersion: actionVersion, status: "feedback-returned", feedback: "Accepted by command track", note: "command audit" };
  const actionHeaders = { "Idempotency-Key": "t05-tele-action-001" };
  const actionFirst = await api(baseUrl, "/api/referral-teleconsultations/rtc-001/actions", authorized(commissionToken, { method: "POST", headers: actionHeaders, body: JSON.stringify(actionPayload) }));
  const actionReplay = await api(baseUrl, "/api/referral-teleconsultations/rtc-001/actions", authorized(commissionToken, { method: "POST", headers: actionHeaders, body: JSON.stringify(actionPayload) }));
  assert.equal(actionFirst.response.status, 200);
  assert.equal(actionReplay.response.status, 200);
  assert.deepEqual(actionReplay.body, actionFirst.body);
  const actionConflict = await api(baseUrl, "/api/referral-teleconsultations/rtc-001/actions", authorized(commissionToken, { method: "POST", headers: actionHeaders, body: JSON.stringify({ ...actionPayload, feedback: "Different intent" }) }));
  assert.equal(actionConflict.response.status, 409);
  assert.equal(actionConflict.body.code, "REFERRAL_TELECONSULTATION_ACTION_IDEMPOTENCY_CONFLICT");
  const actionScopeDenied = await api(baseUrl, "/api/referral-teleconsultations/rtc-scope-private/actions", authorized(nurseToken, { method: "POST", headers: { "Idempotency-Key": "t05-tele-action-scope-001" }, body: JSON.stringify({ status: "closed" }) }));
  assert.equal(actionScopeDenied.response.status, 403);

  const concurrentVersion = (await api(baseUrl, "/api/state", authorized(commissionToken))).body.storageMeta.collectionVersions.referralTeleconsultations;
  const concurrent = await Promise.all([
    api(baseUrl, "/api/referral-teleconsultations/rtc-001/actions", authorized(commissionToken, { method: "POST", headers: { "Idempotency-Key": "t05-tele-concurrent-a" }, body: JSON.stringify({ expectedVersion: concurrentVersion, status: "accepted", note: "concurrent-a" }) })),
    api(baseUrl, "/api/referral-teleconsultations/rtc-001/actions", authorized(commissionToken, { method: "POST", headers: { "Idempotency-Key": "t05-tele-concurrent-b" }, body: JSON.stringify({ expectedVersion: concurrentVersion, status: "scheduled", note: "concurrent-b" }) }))
  ]);
  assert.deepEqual(concurrent.map((item) => item.response.status).sort(), [200, 409]);
  assert.equal(concurrent.find((item) => item.response.status === 409).body.code, "REFERRAL_TELECONSULTATION_VERSION_CONFLICT");

  const sqliteFile = path.join(dataDir, "health-city.sqlite");
  async function rejectOneCollectionWrite(collection, request) {
    const triggerName = `test_fail_${collection.replace(/[^a-z0-9]/gi, "_")}`;
    const db = new DatabaseSync(sqliteFile);
    db.exec(`CREATE TRIGGER ${triggerName} BEFORE UPDATE ON state_collections WHEN NEW.key = '${collection}' BEGIN SELECT RAISE(ABORT, 'forced state command failure'); END;`);
    db.close();
    try {
      return await request();
    } finally {
      const cleanup = new DatabaseSync(sqliteFile);
      cleanup.exec(`DROP TRIGGER IF EXISTS ${triggerName}`);
      cleanup.close();
    }
  }

  state = (await api(baseUrl, "/api/state", authorized(commissionToken))).body;
  const planFailureSnapshot = {
    chronicManagementPlans: state.chronicManagementPlans,
    securityEvents: state.securityEvents
  };
  const planFailure = await rejectOneCollectionWrite("chronicManagementPlans", () => api(baseUrl, "/api/chronic-management-plans/cmp-001", authorized(doctorToken, {
    method: "PATCH",
    headers: { "Idempotency-Key": "t04-plan-storage-failure-001" },
    body: JSON.stringify({ expectedVersion: state.storageMeta.collectionVersions.chronicManagementPlans, status: "must-not-persist" })
  })));
  assert.equal(planFailure.response.status, 500);
  assert.equal(planFailure.body.code, "CHRONIC_MANAGEMENT_PLAN_PERSISTENCE_FAILED");
  let afterFailure = (await api(baseUrl, "/api/state", authorized(commissionToken))).body;
  assert.deepEqual(afterFailure.chronicManagementPlans, planFailureSnapshot.chronicManagementPlans);
  assert.deepEqual(afterFailure.securityEvents, planFailureSnapshot.securityEvents);

  state = afterFailure;
  const feedbackFailureSnapshot = {
    personalRecords: state.personalRecords,
    followups: state.followups,
    taskMessages: state.taskMessages,
    securityEvents: state.securityEvents,
    dataAccessLogs: state.dataAccessLogs
  };
  const feedbackFailure = await rejectOneCollectionWrite("personalRecords", () => api(baseUrl, "/api/chronic/followup-feedback", authorized(citizenToken, {
    method: "POST",
    headers: { "Idempotency-Key": "t04-feedback-storage-failure-001" },
    body: JSON.stringify({ expectedVersion: state.storageMeta.collectionVersions.personalRecords, residentId: "r1", followupId: "f1", symptoms: "must-not-persist-feedback" })
  })));
  assert.equal(feedbackFailure.response.status, 500);
  assert.equal(feedbackFailure.body.code, "CHRONIC_FEEDBACK_PERSISTENCE_FAILED");
  afterFailure = (await api(baseUrl, "/api/state", authorized(commissionToken))).body;
  for (const [collection, before] of Object.entries(feedbackFailureSnapshot)) {
    assert.deepEqual(afterFailure[collection], before, `failed feedback must not persist ${collection}`);
  }

  state = afterFailure;
  const teleCreateFailureSnapshot = {
    referralTeleconsultations: state.referralTeleconsultations,
    securityEvents: state.securityEvents,
    dataAccessLogs: state.dataAccessLogs
  };
  const teleCreateFailure = await rejectOneCollectionWrite("referralTeleconsultations", () => api(baseUrl, "/api/referral-teleconsultations", authorized(commissionToken, {
    method: "POST",
    headers: { "Idempotency-Key": "t05-tele-create-storage-failure-001" },
    body: JSON.stringify({ ...createPayload, id: "rtc-must-not-persist", expectedVersion: state.storageMeta.collectionVersions.referralTeleconsultations })
  })));
  assert.equal(teleCreateFailure.response.status, 500);
  assert.equal(teleCreateFailure.body.code, "REFERRAL_TELECONSULTATION_PERSISTENCE_FAILED");
  afterFailure = (await api(baseUrl, "/api/state", authorized(commissionToken))).body;
  for (const [collection, before] of Object.entries(teleCreateFailureSnapshot)) {
    assert.deepEqual(afterFailure[collection], before, `failed teleconsultation create must not persist ${collection}`);
  }

  state = afterFailure;
  const teleActionFailureSnapshot = {
    referralTeleconsultations: state.referralTeleconsultations,
    securityEvents: state.securityEvents,
    dataAccessLogs: state.dataAccessLogs
  };
  const teleActionFailure = await rejectOneCollectionWrite("referralTeleconsultations", () => api(baseUrl, "/api/referral-teleconsultations/rtc-001/actions", authorized(commissionToken, {
    method: "POST",
    headers: { "Idempotency-Key": "t05-tele-action-storage-failure-001" },
    body: JSON.stringify({ expectedVersion: state.storageMeta.collectionVersions.referralTeleconsultations, status: "closed", note: "must-not-persist-action" })
  })));
  assert.equal(teleActionFailure.response.status, 500);
  assert.equal(teleActionFailure.body.code, "REFERRAL_TELECONSULTATION_ACTION_PERSISTENCE_FAILED");
  afterFailure = (await api(baseUrl, "/api/state", authorized(commissionToken))).body;
  for (const [collection, before] of Object.entries(teleActionFailureSnapshot)) {
    assert.deepEqual(afterFailure[collection], before, `failed teleconsultation action must not persist ${collection}`);
  }
});
