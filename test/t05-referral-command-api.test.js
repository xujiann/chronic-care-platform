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

test("referral command inbox and outbox survive the real JSON persistence boundary", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "t05-referral-command-api-"));
  fs.copyFileSync(path.join(ROOT, "data", "db.json"), path.join(dataDir, "db.json"));
  const envKeys = [
    "NODE_ENV", "DATA_DIR", "STORAGE_ENGINE", "SESSION_SECRETS", "SESSION_STORE",
    "SESSION_EXPIRED_RETENTION_DAYS", "SESSION_REVOKED_RETENTION_DAYS", "SESSION_CLEANUP_INTERVAL_MS"
  ];
  const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    NODE_ENV: "test",
    DATA_DIR: dataDir,
    STORAGE_ENGINE: "json",
    SESSION_SECRETS: "t05-referral-command-api-session-secret-2026",
    SESSION_STORE: "memory",
    SESSION_EXPIRED_RETENTION_DAYS: "2",
    SESSION_REVOKED_RETENTION_DAYS: "45",
    SESSION_CLEANUP_INTERVAL_MS: "60000"
  });
  const { server, startServer, stopServer } = require("../server");
  t.after(async () => {
    await stopServer();
    fs.rmSync(dataDir, { recursive: true, force: true });
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  });

  async function startAndLogin() {
    startServer(0);
    await once(server, "listening");
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const login = await request(baseUrl, "/api/auth/login", "", {
      method: "POST",
      body: JSON.stringify({ username: "health", password: "123456" })
    });
    assert.equal(login.response.status, 200);
    return { baseUrl, token: login.body.token };
  }

  const firstRuntime = await startAndLogin();
  const command = {
    method: "POST",
    headers: { "Idempotency-Key": "t05-real-persistence-command-001" },
    body: JSON.stringify({
      expectedVersion: 1,
      status: "已接诊",
      receivingFeedback: "real persistence receipt"
    })
  };
  const created = await request(
    firstRuntime.baseUrl,
    "/api/referrals/rf1/actions",
    firstRuntime.token,
    command
  );
  assert.equal(created.response.status, 200);
  assert.equal(created.body.idempotentReplay, false);
  assert.equal(created.body.referral.version, 2);
  assert.equal(created.body.event.causationId, "t05-real-persistence-command-001");
  const firstEvent = created.body.event;
  const eventId = created.body.event.id;

  await stopServer();
  const persisted = JSON.parse(fs.readFileSync(path.join(dataDir, "db.json"), "utf8"));
  assert.equal(persisted.referralSystem.referralOutbox.length, 1);
  assert.equal(persisted.referralSystem.referralCommandInbox.length, 1);
  assert.equal(persisted.referralSystem.referralOutbox[0].id, eventId);
  assert.equal(persisted.referralSystem.referralOutbox[0].relaySequence, 1);

  const secondRuntime = await startAndLogin();
  const replay = await request(
    secondRuntime.baseUrl,
    "/api/referrals/rf1/actions",
    secondRuntime.token,
    command
  );
  assert.equal(replay.response.status, 200);
  assert.equal(replay.body.idempotentReplay, true);
  assert.equal(replay.body.event.id, eventId);
  assert.deepEqual(replay.body.event, firstEvent);
  assert.equal(replay.body.event.causationId, "t05-real-persistence-command-001");
  assert.equal(replay.body.referral.version, 2);

  const hospitalLogin = await request(secondRuntime.baseUrl, "/api/auth/login", "", {
    method: "POST",
    body: JSON.stringify({ username: "hospital", password: "123456" })
  });
  assert.equal(hospitalLogin.response.status, 200);
  const workflow = await request(secondRuntime.baseUrl, "/api/workflow-actions", hospitalLogin.body.token, {
    method: "POST",
    headers: { "Idempotency-Key": "t05-workflow-command-001" },
    body: JSON.stringify({
      collection: "referrals",
      id: "rf1",
      expectedVersion: 2,
      status: "report-returned",
      updates: { receivingFeedback: "receiving hospital returned feedback" }
    })
  });
  assert.equal(workflow.response.status, 200);
  assert.equal(workflow.body.id, "rf1");
  assert.equal(workflow.body.version, 3);

  const citizenLogin = await request(secondRuntime.baseUrl, "/api/auth/login", "", {
    method: "POST",
    body: JSON.stringify({ username: "citizen", password: "123456" })
  });
  assert.equal(citizenLogin.response.status, 200);
  const citizenTask = await request(
    secondRuntime.baseUrl,
    `/api/tasks/${encodeURIComponent("referrals:rf1")}/actions`,
    citizenLogin.body.token,
    {
      method: "POST",
      headers: { "Idempotency-Key": "t05-citizen-task-command-001" },
      body: JSON.stringify({
        action: "resident-confirm",
        comment: "居民端确认服务安排",
        expectedVersion: 3
      })
    }
  );
  assert.equal(citizenTask.response.status, 200);
  assert.equal(citizenTask.body.id, "rf1");
  assert.equal(citizenTask.body.taskAction, "resident-confirm");
  assert.equal(citizenTask.body.version, 4);

  const finalPersisted = JSON.parse(fs.readFileSync(path.join(dataDir, "db.json"), "utf8"));
  assert.equal(finalPersisted.referralSystem.referralOutbox.length, 3);
  assert.equal(finalPersisted.referralSystem.referralCommandInbox.length, 3);
  assert.equal(finalPersisted.taskMessages.some((item) => item.sourceId === "rf1" && item.createdBy === "citizen"), true);
});
