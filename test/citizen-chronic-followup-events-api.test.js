"use strict";

const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { createSqliteFollowupDispatchRepository } = require("../src/citizen-chronic/followup-dispatch-outbox");
const { runFollowupDispatchWorker } = require("../src/citizen-chronic/followup-dispatch-worker");

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

test("followup API persists aggregate and durable outbox atomically while worker dispatches separately", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "citizen-chronic-events-api-"));
  fs.copyFileSync(path.join(ROOT, "data", "db.json"), path.join(dataDir, "db.json"));
  const envKeys = ["NODE_ENV", "DATA_DIR", "STORAGE_ENGINE", "SESSION_SECRETS", "SESSION_STORE"];
  const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    NODE_ENV: "test",
    DATA_DIR: dataDir,
    STORAGE_ENGINE: "sqlite",
    SESSION_SECRETS: "citizen-chronic-events-api-session-secret-2026",
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

  const token = await login(baseUrl, "health");
  const initial = readDatabase();
  const followup = initial.followups[0];
  assert.ok(followup?.id);
  const commandKey = "citizen-chronic-followup-event-api-001";
  const patch = {
    status: "completed",
    result: "followup completed with resident feedback",
    expectedVersion: initial.storageMeta.collectionVersions.followups,
    expectedDomainVersion: Number(followup.domainVersion || 0)
  };
  const updated = await request(baseUrl, `/api/followups/${encodeURIComponent(followup.id)}`, token, {
    method: "PATCH",
    headers: { "Idempotency-Key": commandKey },
    body: JSON.stringify(patch)
  });
  assert.equal(updated.response.status, 200, JSON.stringify(updated.body));
  assert.equal(updated.body.status, "completed");
  assert.equal(updated.body.domainVersion, 1);
  assert.equal(updated.body.idempotent, false);
  assert.equal(updated.body.domainRuntime, undefined);
  assert.equal(updated.body.productionReady, false);

  let persisted = readDatabase().followups.find((item) => item.id === followup.id);
  assert.equal(persisted.domainRuntime.outbox.length, 1);
  assert.equal(persisted.domainRuntime.outbox[0].type, "citizen-chronic.followup-updated.v1");
  assert.equal(persisted.domainRuntime.outbox[0].deliveryState, "pending");
  assert.equal(persisted.domainRuntime.commands.length, 1);
  assert.equal(JSON.stringify(persisted).includes(commandKey), false);

  const pending = await request(baseUrl, "/api/chronic/followup-events/health", token);
  assert.equal(pending.response.status, 200);
  assert.equal(pending.body.ok, false);
  assert.equal(pending.body.summary.pending, 1);
  assert.equal(pending.body.publisher.mode, "local-simulated");
  assert.equal(pending.body.publisher.configured, false);
  assert.equal(pending.body.publisher.productionReady, false);
  assert.equal(pending.body.durableQueue.counts.pending, 1);
  assert.equal(pending.body.durableQueue.requestPathExternalDispatch, false);
  assert.equal(pending.body.productionReady, false);

  const dispatched = await request(baseUrl, "/api/chronic/followup-events/dispatch", token, {
    method: "POST"
  });
  assert.equal(dispatched.response.status, 200, JSON.stringify(dispatched.body));
  assert.equal(dispatched.body.ok, true);
  assert.equal(dispatched.body.processed.length, 0);
  assert.equal(dispatched.body.queued, 1);
  assert.equal(dispatched.body.dispatchMode, "durable-worker");
  assert.equal(dispatched.body.requestPathExternalDispatch, false);
  assert.deepEqual(dispatched.body.health.summary, {
    outbox: 1,
    pending: 1,
    published: 0,
    completedInbox: 0,
    projections: 0,
    receipts: 0,
    acceptedReceipts: 0,
    deliveredReceipts: 0
  });
  persisted = readDatabase().followups.find((item) => item.id === followup.id);
  assert.equal(persisted.domainRuntime.outbox[0].deliveryState, "pending");

  const db = new DatabaseSync(path.join(dataDir, "health-city.sqlite"));
  try {
    const repository = createSqliteFollowupDispatchRepository(db);
    const worker = await runFollowupDispatchWorker({
      repository,
      env: { NODE_ENV: "test" },
      workerId: "api-test-worker",
      publisher: { async publish(envelope) { return { accepted: true, receiptId: `local:${envelope.eventId}`, status: "accepted" }; } }
    });
    assert.equal(worker.delivered, 1);
    assert.equal(repository.health().counts.delivered, 1);
  } finally {
    db.close();
  }

  const replay = await request(baseUrl, `/api/followups/${encodeURIComponent(followup.id)}`, token, {
    method: "PATCH",
    headers: { "Idempotency-Key": commandKey },
    body: JSON.stringify(patch)
  });
  assert.equal(replay.response.status, 200);
  assert.equal(replay.body.idempotent, true);
  assert.equal(readDatabase().followups.find((item) => item.id === followup.id).domainRuntime.outbox.length, 1);

  const keyConflict = await request(baseUrl, `/api/followups/${encodeURIComponent(followup.id)}`, token, {
    method: "PATCH",
    headers: { "Idempotency-Key": commandKey },
    body: JSON.stringify({ status: "cancelled", expectedDomainVersion: 1 })
  });
  assert.equal(keyConflict.response.status, 409);
  const currentCollectionVersion = readDatabase().storageMeta.collectionVersions.followups;
  const staleVersion = await request(baseUrl, `/api/followups/${encodeURIComponent(followup.id)}`, token, {
    method: "PATCH",
    headers: { "Idempotency-Key": "citizen-chronic-followup-event-api-002" },
    body: JSON.stringify({
      status: "reviewed",
      expectedVersion: currentCollectionVersion,
      expectedDomainVersion: 0
    })
  });
  assert.equal(staleVersion.response.status, 409);
});
