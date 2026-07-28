"use strict";

const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

async function request(baseUrl, pathname, token = "", options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  return { response, body: await response.json() };
}

async function login(baseUrl, username) {
  const result = await request(baseUrl, "/api/auth/login", "", {
    method: "POST",
    body: JSON.stringify({ username, password: "123456" })
  });
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  return result.body.token;
}

async function post(baseUrl, pathname, token, key, body) {
  return request(baseUrl, pathname, token, {
    method: "POST",
    headers: { "Idempotency-Key": key },
    body: JSON.stringify(body)
  });
}

test("modernization API binds server context, persists nextData with CAS and returns redacted summaries", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "public-health-modernization-api-"));
  fs.copyFileSync(path.join(ROOT, "data", "db.json"), path.join(dataDir, "db.json"));
  const envKeys = ["NODE_ENV", "DATA_DIR", "STORAGE_ENGINE", "SESSION_SECRETS", "SESSION_STORE"];
  const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    NODE_ENV: "test",
    DATA_DIR: dataDir,
    STORAGE_ENGINE: "sqlite",
    SESSION_SECRETS: "public-health-modernization-api-session-secret-2026",
    SESSION_STORE: "memory"
  });

  const { readDatabase, server, startServer, stopServer } = require("../server");
  startServer(0);
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await stopServer();
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const anonymous = await request(baseUrl, "/api/public-health/data-foundation");
  assert.equal(anonymous.response.status, 401);
  const hospitalToken = await login(baseUrl, "hospital");
  const forbidden = await request(baseUrl, "/api/public-health/surveillance-center", hospitalToken);
  assert.equal(forbidden.response.status, 403);

  const commissionToken = await login(baseUrl, "health");
  const foundation = await request(baseUrl, "/api/public-health/data-foundation", commissionToken);
  assert.equal(foundation.response.status, 200);
  assert.equal(foundation.body.summary.sources, 8);
  assert.equal(foundation.body.summary.catalogEntries, 7);
  assert.equal(foundation.body.productionReady, false);

  const externalSignalId = "EMR-API-SYNDROME-20260728-001";
  const intakeKey = "api-modernization-intake-20260728-001";
  const signalPayload = {
    expectedVersion: 0,
    sourceId: "ph-source-clinical-syndrome",
    externalSignalId,
    signalType: "clinical-syndrome",
    institutionId: "medical-institution-001",
    regionCode: "210202",
    observedAt: "2026-07-28T08:00:00.000Z",
    metrics: [{
      metricCode: "fever-respiratory-count",
      value: 8,
      unit: "cases/24h",
      baseline: 3
    }],
    evidenceRefs: ["API-SYNDROME-EVIDENCE-001"]
  };
  const injected = await post(
    baseUrl,
    "/api/public-health/surveillance-signals?at=2000-01-01T00:00:00.000Z",
    commissionToken,
    intakeKey,
    signalPayload
  );
  assert.equal(injected.response.status, 400);
  assert.equal(injected.body.code, "PUBLIC_HEALTH_MODERNIZATION_SERVER_CONTEXT_FORBIDDEN");
  const bodyInjected = await post(
    baseUrl,
    "/api/public-health/surveillance-signals",
    commissionToken,
    intakeKey,
    { ...signalPayload, receivedAt: "2000-01-01T00:00:00.000Z" }
  );
  assert.equal(bodyInjected.response.status, 400);
  assert.equal(bodyInjected.body.code, "PUBLIC_HEALTH_MODERNIZATION_SERVER_CONTEXT_FORBIDDEN");

  const created = await post(
    baseUrl,
    "/api/public-health/surveillance-signals",
    commissionToken,
    intakeKey,
    signalPayload
  );
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.signal.workflowState, "received");
  assert.equal(created.body.signal.version, 1);
  assert.equal(created.body.productionReady, false);
  const signalId = created.body.signal.id;
  const serializedCreated = JSON.stringify(created.body);
  assert.equal(serializedCreated.includes(externalSignalId), false);
  assert.equal(serializedCreated.includes(intakeKey), false);
  assert.equal(/externalSignalKeyHash|idempotencyKeyHash|contentFingerprint/.test(serializedCreated), false);

  const persistedAfterCreate = readDatabase();
  const persistedSignal = persistedAfterCreate.publicHealthSurveillanceSignals.find((item) => item.id === signalId);
  assert.equal(persistedSignal.version, 1);
  assert.notEqual(persistedSignal.receivedAt, "2000-01-01T00:00:00.000Z");
  assert.match(persistedSignal.externalSignalKeyHash, /^[a-f0-9]{64}$/);
  assert.match(persistedSignal.idempotencyKeyHash, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(persistedAfterCreate).includes(externalSignalId), false);
  assert.equal(JSON.stringify(persistedAfterCreate).includes(intakeKey), false);
  const { DatabaseSync } = require("node:sqlite");
  const sqlite = new DatabaseSync(path.join(dataDir, "health-city.sqlite"), { readOnly: true });
  const keyRow = sqlite.prepare(`
    SELECT signal_id, source_record_hash, idempotency_key_hash
    FROM public_health_modernization_signal_keys
    WHERE signal_id = ?
  `).get(signalId);
  const uniqueIndexes = sqlite.prepare("PRAGMA index_list(public_health_modernization_signal_keys)").all();
  sqlite.close();
  assert.equal(keyRow.signal_id, signalId);
  assert.equal(keyRow.source_record_hash, persistedSignal.externalSignalKeyHash);
  assert.equal(keyRow.idempotency_key_hash, persistedSignal.idempotencyKeyHash);
  assert.equal(uniqueIndexes.filter((item) => Number(item.unique) === 1).length >= 3, true);

  const replay = await post(
    baseUrl,
    "/api/public-health/surveillance-signals",
    commissionToken,
    intakeKey,
    signalPayload
  );
  assert.equal(replay.response.status, 200);
  assert.equal(replay.body.idempotent, true);
  const conflict = await post(
    baseUrl,
    "/api/public-health/surveillance-signals",
    commissionToken,
    "api-modernization-intake-conflict",
    { ...signalPayload, metrics: [{ metricCode: "fever-respiratory-count", value: 99 }] }
  );
  assert.equal(conflict.response.status, 409);

  const verified = await post(
    baseUrl,
    `/api/public-health/surveillance-signals/${encodeURIComponent(signalId)}/actions`,
    commissionToken,
    "api-modernization-verify-001",
    {
      action: "verify-signal",
      expectedVersion: 1,
      decision: "confirmed",
      note: "已由疾控人员复核来源和口径",
      evidenceRefs: ["API-MANUAL-VERIFY-001"]
    }
  );
  assert.equal(verified.response.status, 200, JSON.stringify(verified.body));
  assert.equal(verified.body.signal.workflowState, "human-verified");
  const stale = await post(
    baseUrl,
    `/api/public-health/surveillance-signals/${encodeURIComponent(signalId)}/actions`,
    commissionToken,
    "api-modernization-stale-001",
    {
      action: "evaluate-signal",
      expectedVersion: 1
    }
  );
  assert.equal(stale.response.status, 409);

  const evaluated = await post(
    baseUrl,
    `/api/public-health/surveillance-signals/${encodeURIComponent(signalId)}/actions`,
    commissionToken,
    "api-modernization-evaluate-001",
    {
      action: "evaluate-signal",
      expectedVersion: 2
    }
  );
  assert.equal(evaluated.response.status, 200, JSON.stringify(evaluated.body));
  assert.equal(evaluated.body.matched, true);
  assert.equal(evaluated.body.alert.status, "open");
  const alertId = evaluated.body.alert.id;

  const alertVerified = await post(
    baseUrl,
    `/api/public-health/surveillance-alerts/${encodeURIComponent(alertId)}/actions`,
    commissionToken,
    "api-modernization-alert-verify-001",
    {
      action: "verify-alert",
      expectedVersion: 1,
      riskLevel: "high",
      conclusion: "人工研判确认需启动医防协同",
      evidenceRefs: ["API-RISK-ASSESSMENT-001"]
    }
  );
  assert.equal(alertVerified.response.status, 200, JSON.stringify(alertVerified.body));
  const dispatched = await post(
    baseUrl,
    `/api/public-health/surveillance-alerts/${encodeURIComponent(alertId)}/actions`,
    commissionToken,
    "api-modernization-alert-dispatch-001",
    {
      action: "dispatch-alert",
      expectedVersion: 2,
      medicalInstitutionId: "medical-institution-001",
      primaryCareOrganizationId: "primary-care-001",
      dueAt: "2026-07-29T08:00:00.000Z",
      note: "请医院公卫科和基层机构分别核查"
    }
  );
  assert.equal(dispatched.response.status, 200, JSON.stringify(dispatched.body));
  assert.equal(dispatched.body.createdCollaborationTasks.length, 2);
  const task = dispatched.body.createdCollaborationTasks[0];
  const accepted = await post(
    baseUrl,
    `/api/public-health/medical-prevention-tasks/${encodeURIComponent(task.id)}/actions`,
    commissionToken,
    "api-modernization-task-accept-001",
    {
      action: "accept-task",
      expectedVersion: 1,
      assignedTo: "commission-reviewer",
      note: "责任人已接单"
    }
  );
  assert.equal(accepted.response.status, 200, JSON.stringify(accepted.body));
  assert.equal(accepted.body.task.state, "accepted");

  const center = await request(baseUrl, "/api/public-health/surveillance-center", commissionToken);
  assert.equal(center.response.status, 200);
  assert.equal(center.body.summary.alerts, 1);
  assert.equal(center.body.productionReady, false);
  const board = await request(baseUrl, "/api/public-health/medical-prevention-tasks", commissionToken);
  assert.equal(board.response.status, 200);
  assert.equal(board.body.summary.tasks, 2);
  assert.equal(board.body.productionReady, false);

  const state = await request(baseUrl, "/api/state", commissionToken);
  assert.equal(state.response.status, 200);
  [
    "publicHealthDataSources",
    "publicHealthSurveillanceSignals",
    "publicHealthDataLineageAudit",
    "publicHealthSurveillanceAudit",
    "publicHealthSurveillanceRules",
    "publicHealthSurveillanceAlerts",
    "publicHealthRiskAssessments",
    "publicHealthMedicalPreventionTasks",
    "publicHealthMedicalPreventionAudit"
  ].forEach((collection) => assert.equal(Object.hasOwn(state.body, collection), false));
  const serializedPublic = JSON.stringify({ center: center.body, board: board.body, state: state.body });
  assert.equal(serializedPublic.includes(externalSignalId), false);
  assert.equal(serializedPublic.includes(intakeKey), false);
  assert.equal(/externalSignalKeyHash|idempotencyKeyHash|contentFingerprint/.test(serializedPublic), false);
});
