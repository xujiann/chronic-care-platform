"use strict";

const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const ENDPOINT = "/api/physical-exams/specialized-intakes";
const ERROR_PREFIX = "PHYSICAL_EXAM_SPECIALIZED_INTAKE";

async function request(baseUrl, pathname, token = "", options = {}) {
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

async function login(baseUrl, username) {
  const response = await request(baseUrl, "/api/auth/login", "", {
    method: "POST",
    body: JSON.stringify({ username, password: "123456" })
  });
  assert.equal(response.status, 200);
  return response.body.token;
}

function intake({ id, residentId, status, institutionId = "MR1", institutionName = "示范医院" }) {
  const routed = status === "routed-to-specialized-system";
  return {
    id,
    residentId,
    personIndex: `TEST-INDEX-${residentId}`,
    sourceType: "institution",
    externalId: `TEST-${id}`,
    institutionId,
    institutionName,
    reportNo: `REPORT-${id}`,
    examDate: "2026-09-07",
    examProgramType: "occupational-health",
    examProgramName: "示范专项体检",
    targetArchiveCategory: "occupational-health-exam",
    route: "specialized-system",
    status,
    ...(routed ? { targetSystem: "specialized-profile-system", profileId: `profile-${id}` } : {}),
    restrictedData: true,
    payloadDigest: `digest-${id}`,
    routingReason: "专项体检受限分流测试夹具",
    evidenceRefs: [],
    actionHistory: [{ action: "routed", at: "2026-09-07T00:00:00.000Z", actor: "integration" }],
    version: 0,
    createdAt: "2026-09-07T00:00:00.000Z",
    updatedAt: "2026-09-07T00:00:00.000Z"
  };
}

function persistedState(dbFile) {
  return JSON.parse(fs.readFileSync(dbFile, "utf8"));
}

function persistedIntake(dbFile, intakeId) {
  return persistedState(dbFile).physicalExamSpecializedIntakes.find((item) => item.id === intakeId);
}

function actionRequest(baseUrl, token, intakeId, payload, key) {
  return request(baseUrl, `${ENDPOINT}/${encodeURIComponent(intakeId)}/actions`, token, {
    method: "POST",
    headers: { "Idempotency-Key": key },
    body: JSON.stringify(payload)
  });
}

test("assign-profile, return-source and close have complete real HTTP command evidence", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "physical-exam-specialized-http-"));
  const dbFile = path.join(dataDir, "db.json");
  fs.copyFileSync(path.join(ROOT, "data", "db.json"), dbFile);
  const fixture = persistedState(dbFile);
  const inScopeResidentId = "specialized-http-resident-in-scope";
  const outOfScopeResidentId = "specialized-http-resident-out-of-scope";
  fixture.residents.push(
    {
      id: inScopeResidentId,
      name: "示范居民甲",
      orgCode: "MR1",
      organization: "示范医院",
      personIndex: `TEST-INDEX-${inScopeResidentId}`
    },
    {
      id: outOfScopeResidentId,
      name: "示范居民乙",
      organization: "范围外基层医疗机构",
      personIndex: `TEST-INDEX-${outOfScopeResidentId}`
    }
  );

  const scenarios = [
    {
      action: "assign-profile",
      expectedStatus: "routed-to-specialized-system",
      initialStatus: "awaiting-specialized-profile",
      commandFields: {
        targetSystem: "specialized-profile-system",
        profileId: "specialized-http-profile-v1"
      },
      changedPayloadFields: { profileId: "specialized-http-profile-changed" }
    },
    {
      action: "return-source",
      expectedStatus: "returned-to-source",
      initialStatus: "awaiting-specialized-profile"
    },
    {
      action: "close",
      expectedStatus: "closed",
      initialStatus: "routed-to-specialized-system"
    }
  ].map((scenario) => ({
    ...scenario,
    primaryId: `specialized-http-${scenario.action}-primary`,
    deniedId: `specialized-http-${scenario.action}-scope-denied`,
    failureId: `specialized-http-${scenario.action}-storage-failure`
  }));

  fixture.physicalExamSpecializedIntakes = [
    ...scenarios.flatMap((scenario) => [
      intake({ id: scenario.primaryId, residentId: inScopeResidentId, status: scenario.initialStatus }),
      intake({
        id: scenario.deniedId,
        residentId: outOfScopeResidentId,
        status: scenario.initialStatus,
        institutionId: "OUT-OF-SCOPE-ORG",
        institutionName: "范围外基层医疗机构"
      }),
      intake({ id: scenario.failureId, residentId: inScopeResidentId, status: scenario.initialStatus })
    ]),
    ...(fixture.physicalExamSpecializedIntakes || [])
  ];
  fs.writeFileSync(dbFile, JSON.stringify(fixture), "utf8");

  const previousEnv = Object.fromEntries(
    ["NODE_ENV", "DATA_DIR", "STORAGE_ENGINE", "SESSION_SECRETS", "SESSION_STORE"]
      .map((key) => [key, process.env[key]])
  );
  Object.assign(process.env, {
    NODE_ENV: "test",
    DATA_DIR: dataDir,
    STORAGE_ENGINE: "json",
    SESSION_SECRETS: "physical-examination-specialized-http-session-secret-2026",
    SESSION_STORE: "memory"
  });

  const { server, startServer, stopServer } = require("../server");
  startServer(0);
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await stopServer();
    fs.rmSync(dataDir, { recursive: true, force: true });
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  });

  const institutionToken = await login(baseUrl, "hospital");
  const citizenToken = await login(baseUrl, "citizen");

  for (const scenario of scenarios) {
    const commandKey = `specialized-http-${scenario.action}-command`;
    const command = {
      action: scenario.action,
      evidenceRef: `EVIDENCE-${scenario.action.toUpperCase()}`,
      note: `${scenario.action} real HTTP evidence`,
      expectedVersion: 0,
      idempotencyKey: commandKey,
      ...(scenario.commandFields || {})
    };

    const roleDeniedBefore = structuredClone(persistedIntake(dbFile, scenario.primaryId));
    const roleDenied = await actionRequest(baseUrl, citizenToken, scenario.primaryId, command, commandKey);
    assert.deepEqual(roleDenied, {
      status: 403,
      body: {
        error: "Forbidden",
        code: "ROLE_DENIED",
        message: "当前身份、权限或数据范围无权访问该接口"
      }
    }, `${scenario.action}: stable role denial`);
    assert.deepEqual(persistedIntake(dbFile, scenario.primaryId), roleDeniedBefore, `${scenario.action}: role denial is immutable`);

    const scopeDeniedBefore = structuredClone(persistedIntake(dbFile, scenario.deniedId));
    const scopeDenied = await actionRequest(baseUrl, institutionToken, scenario.deniedId, {
      ...command,
      idempotencyKey: `${commandKey}-scope-denied`
    }, `${commandKey}-scope-denied`);
    assert.deepEqual(scopeDenied, {
      status: 403,
      body: {
        error: "Forbidden",
        code: `${ERROR_PREFIX}_SCOPE_FORBIDDEN`,
        message: "无权处置该专项体检分流记录"
      }
    }, `${scenario.action}: resource scope denial`);
    assert.deepEqual(persistedIntake(dbFile, scenario.deniedId), scopeDeniedBefore, `${scenario.action}: scope denial is immutable`);

    if (scenario.action === "assign-profile") {
      const keyMismatchBefore = persistedState(dbFile);
      const bodyKey = `${commandKey}-body-key`;
      const keyMismatch = await actionRequest(baseUrl, institutionToken, scenario.primaryId, {
        ...command,
        idempotencyKey: bodyKey
      }, `${commandKey}-header-key`);
      assert.deepEqual(keyMismatch, {
        status: 400,
        body: {
          error: "Bad Request",
          code: `${ERROR_PREFIX}_INVALID`,
          message: "Idempotency-Key conflicts with body idempotencyKey"
        }
      }, `${scenario.action}: header and body keys are bound`);
      assert.deepEqual(persistedState(dbFile), keyMismatchBefore, `${scenario.action}: key mismatch is immutable`);
    }

    const beforeSuccess = persistedState(dbFile);
    const accessAuditMatches = (state) => state.dataAccessLogs.filter((item) =>
      item.residentId === inScopeResidentId && item.scope === "专项体检分流处置" && item.purpose?.endsWith(`· ${scenario.action}`)
    ).length;
    const securityAuditMatches = (state) => state.securityEvents.filter((item) =>
      item.target === scenario.primaryId && item.action === "专项体检分流处置"
    ).length;
    const beforeAccessAudits = accessAuditMatches(beforeSuccess);
    const beforeSecurityAudits = securityAuditMatches(beforeSuccess);
    const success = await actionRequest(baseUrl, institutionToken, scenario.primaryId, command, commandKey);
    assert.equal(success.status, 200, `${scenario.action}: success status`);
    assert.equal(success.body.ok, true, `${scenario.action}: success body`);
    assert.equal(success.body.idempotentReplay, false, `${scenario.action}: first execution`);
    assert.equal(success.body.intake.status, scenario.expectedStatus, `${scenario.action}: state transition`);
    assert.equal(success.body.intake.version, 1, `${scenario.action}: version increment`);
    assert.equal(Object.hasOwn(success.body.intake, "_apiCommandReceipts"), false, `${scenario.action}: receipt is private`);
    Object.entries(scenario.commandFields || {}).forEach(([field, value]) => {
      assert.equal(success.body.intake[field], value, `${scenario.action}: ${field} is committed`);
    });

    const replay = await actionRequest(baseUrl, institutionToken, scenario.primaryId, command, commandKey);
    assert.equal(replay.status, 200, `${scenario.action}: replay status`);
    assert.equal(replay.body.idempotentReplay, true, `${scenario.action}: replay marker`);
    assert.deepEqual(replay.body.intake, success.body.intake, `${scenario.action}: replay response snapshot`);

    const changedPayload = await actionRequest(baseUrl, institutionToken, scenario.primaryId, {
      ...command,
      ...(scenario.changedPayloadFields || { note: `${command.note} changed` })
    }, commandKey);
    assert.equal(changedPayload.status, 409, `${scenario.action}: changed payload status`);
    assert.equal(changedPayload.body.code, `${ERROR_PREFIX}_IDEMPOTENCY_CONFLICT`, `${scenario.action}: changed payload code`);

    const staleKey = `${commandKey}-stale-version`;
    const staleVersion = await actionRequest(baseUrl, institutionToken, scenario.primaryId, {
      ...command,
      idempotencyKey: staleKey
    }, staleKey);
    assert.equal(staleVersion.status, 409, `${scenario.action}: stale version status`);
    assert.equal(staleVersion.body.code, `${ERROR_PREFIX}_VERSION_CONFLICT`, `${scenario.action}: stale version code`);

    const afterReplayAndConflicts = persistedState(dbFile);
    const committed = afterReplayAndConflicts.physicalExamSpecializedIntakes.find((item) => item.id === scenario.primaryId);
    assert.equal(committed.actionHistory.filter((item) => item.action === scenario.action).length, 1, `${scenario.action}: one business mutation`);
    assert.equal(committed.evidenceRefs.filter((item) => item === command.evidenceRef).length, 1, `${scenario.action}: one evidence link`);
    assert.equal(committed._apiCommandReceipts.length, 1, `${scenario.action}: one private receipt`);
    assert.equal(accessAuditMatches(afterReplayAndConflicts), beforeAccessAudits + 1, `${scenario.action}: one access audit`);
    assert.equal(securityAuditMatches(afterReplayAndConflicts), beforeSecurityAudits + 1, `${scenario.action}: one security audit`);

    const beforeFailure = persistedState(dbFile);
    const originalWriteFileSync = fs.writeFileSync;
    fs.writeFileSync = function failTargetDatabaseWrite(target, ...args) {
      if (path.resolve(String(target)) === path.resolve(dbFile)) throw new Error("injected private storage detail");
      return originalWriteFileSync.call(this, target, ...args);
    };
    let storageFailure;
    try {
      const failureKey = `${commandKey}-storage-failure`;
      storageFailure = await actionRequest(baseUrl, institutionToken, scenario.failureId, {
        ...command,
        idempotencyKey: failureKey
      }, failureKey);
    } finally {
      fs.writeFileSync = originalWriteFileSync;
    }
    assert.deepEqual(storageFailure, {
      status: 500,
      body: {
        error: "Internal Server Error",
        code: `${ERROR_PREFIX}_STORAGE_FAILED`,
        message: "specialized intake command persistence failed"
      }
    }, `${scenario.action}: stable storage failure`);
    assert.deepEqual(persistedState(dbFile), beforeFailure, `${scenario.action}: failed commit is fully atomic and immutable`);
    assert.equal(Object.hasOwn(persistedIntake(dbFile, scenario.failureId), "_apiCommandReceipts"), false, `${scenario.action}: failed receipt is not persisted`);
  }
});
