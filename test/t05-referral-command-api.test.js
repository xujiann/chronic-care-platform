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
});
