const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  signPublicHealthExternalReceipt
} = require("../public-health-external-adapter-service");

const ROOT = path.resolve(__dirname, "..");
const REQUEST_SECRET = "api-request-secret-1234567890-123456789";
const RECEIPT_SECRET = "api-receipt-secret-1234567890-123456789";

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

async function login(baseUrl) {
  const result = await request(baseUrl, "/api/auth/login", "", {
    method: "POST",
    body: JSON.stringify({ username: "health", password: "123456" })
  });
  assert.equal(result.response.status, 200);
  return result.body.token;
}

async function post(baseUrl, pathname, token, idempotencyKey, body, headers = {}) {
  return request(baseUrl, pathname, token, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey, ...headers },
    body: JSON.stringify(body)
  });
}

test("public health external routes use server time full keyrings and secret-free persistence", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "public-health-external-api-"));
  fs.copyFileSync(path.join(ROOT, "data", "db.json"), path.join(dataDir, "db.json"));
  const envKeys = [
    "NODE_ENV",
    "DATA_DIR",
    "STORAGE_ENGINE",
    "SESSION_SECRETS",
    "SESSION_STORE",
    "PUBLIC_HEALTH_IMMUNIZATION_ENDPOINT",
    "PUBLIC_HEALTH_IMMUNIZATION_REQUEST_SECRET",
    "PUBLIC_HEALTH_IMMUNIZATION_RECEIPT_SECRET"
  ];
  const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    NODE_ENV: "test",
    DATA_DIR: dataDir,
    STORAGE_ENGINE: "json",
    SESSION_SECRETS: "public-health-external-api-session-secret-2026",
    SESSION_STORE: "memory",
    PUBLIC_HEALTH_IMMUNIZATION_ENDPOINT: "https://immunization.example.test/dispatch",
    PUBLIC_HEALTH_IMMUNIZATION_REQUEST_SECRET: REQUEST_SECRET,
    PUBLIC_HEALTH_IMMUNIZATION_RECEIPT_SECRET: RECEIPT_SECRET
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

  const token = await login(baseUrl);
  const runtime = await request(baseUrl, "/api/public-health/coordination-runtime", token);
  assert.equal(runtime.response.status, 200);
  assert.equal(runtime.body.productionReady, false);
  assert.doesNotMatch(JSON.stringify(runtime.body), /residentId/);
  const handoff = runtime.body.handoffs.find((item) => item.laneId === "immunization");
  assert.ok(handoff);

  const assigned = await post(
    baseUrl,
    `/api/public-health/coordination/${encodeURIComponent(handoff.id)}/actions`,
    token,
    "api-immunization-assign",
    {
      action: "assign-coordination",
      expectedVersion: 1,
      assignedTo: handoff.owner,
      dueAt: "2026-07-31",
      note: "assign local coordination",
      at: "1999-01-01T00:00:00.000Z"
    }
  );
  assert.equal(assigned.response.status, 200, JSON.stringify(assigned.body));
  assert.notEqual(assigned.body.action.at, "1999-01-01T00:00:00.000Z");

  const started = await post(
    baseUrl,
    `/api/public-health/coordination/${encodeURIComponent(handoff.id)}/actions`,
    token,
    "api-immunization-start",
    { action: "start-coordination", expectedVersion: 2, note: "start local coordination" }
  );
  assert.equal(started.response.status, 200, JSON.stringify(started.body));

  const enqueued = await post(
    baseUrl,
    `/api/public-health/external/handoffs/${encodeURIComponent(handoff.id)}/enqueue`,
    token,
    "api-immunization-enqueue",
    {
      operation: "coordination-handoff",
      evidenceRefs: ["api-immunization-request"],
      exceptionOwner: "immunization compensation team",
      exceptionDueAt: "2026-07-31",
      at: "1999-01-01T00:00:00.000Z"
    }
  );
  assert.equal(enqueued.response.status, 200, JSON.stringify(enqueued.body));
  assert.equal(enqueued.body.dispatch.outboxVersion, 1);
  assert.notEqual(enqueued.body.dispatch.request.issuedAt, "1999-01-01T00:00:00.000Z");
  assert.doesNotMatch(JSON.stringify(enqueued.body), new RegExp(REQUEST_SECRET));
  assert.doesNotMatch(JSON.stringify(enqueued.body), new RegExp(RECEIPT_SECRET));
  const dispatch = enqueued.body.dispatch;

  const due = await request(baseUrl, "/api/public-health/external/outbox/due", token);
  assert.equal(due.response.status, 200);
  assert.equal(due.body.due.some((item) => item.id === dispatch.id), true);

  const claimed = await post(
    baseUrl,
    `/api/public-health/external/dispatches/${dispatch.id}/claim`,
    token,
    "api-immunization-claim",
    { expectedVersion: 1, leaseSeconds: 60 }
  );
  assert.equal(claimed.response.status, 200, JSON.stringify(claimed.body));
  assert.match(claimed.body.leaseToken, /^[a-f0-9]{64}$/);
  assert.equal(claimed.body.dispatch.outboxVersion, 2);

  const attempted = await post(
    baseUrl,
    `/api/public-health/external/dispatches/${dispatch.id}/attempt`,
    token,
    "api-immunization-attempt",
    { expectedVersion: 2, transportStatus: 503, at: "1999-01-01T00:00:00.000Z" },
    { "X-Public-Health-Lease-Token": claimed.body.leaseToken }
  );
  assert.equal(attempted.response.status, 200, JSON.stringify(attempted.body));
  assert.equal(attempted.body.dispatch.deliveryState, "retry-scheduled");
  assert.equal(attempted.body.dispatch.outboxVersion, 3);
  assert.notEqual(attempted.body.dispatch.attempts[0].at, "1999-01-01T00:00:00.000Z");

  const receiptAt = new Date().toISOString();
  const receipt = signPublicHealthExternalReceipt({
    dispatchId: dispatch.id,
    requestDigest: dispatch.requestDigest,
    laneId: dispatch.laneId,
    handoffId: dispatch.handoffId,
    status: "accepted",
    receiptCode: "API-IMM-ACCEPT-001",
    evidenceRefs: ["api-immunization-receipt"],
    receivedAt: receiptAt,
    issuedAt: receiptAt
  }, RECEIPT_SECRET);
  const callback = await post(
    baseUrl,
    `/api/public-health/external/callbacks/${dispatch.id}`,
    "",
    "api-immunization-callback",
    { expectedVersion: 3, receipt, at: "1999-01-01T00:00:00.000Z" }
  );
  assert.equal(callback.response.status, 200, JSON.stringify(callback.body));
  assert.equal(callback.body.deliveryState, "delivered");
  assert.equal(callback.body.productionReady, false);

  const board = await request(baseUrl, "/api/public-health/external/operations-board", token);
  assert.equal(board.response.status, 200);
  assert.equal(board.body.productionReady, false);
  assert.equal(board.body.summary.signatureVerified, 1);
  assert.equal(board.body.keySafety.automaticRecoveryAllowed, false);
  assert.equal(board.body.keySafety.automaticResignAllowed, false);
  assert.doesNotMatch(JSON.stringify(board.body), new RegExp(REQUEST_SECRET));
  assert.doesNotMatch(JSON.stringify(board.body), new RegExp(RECEIPT_SECRET));

  const rotation = await request(baseUrl, "/api/public-health/external/key-rotation", token);
  assert.equal(rotation.response.status, 200);
  assert.equal(rotation.body.productionReady, false);
  assert.deepEqual(rotation.body.keySafety.rotation.steps.map((item) => item.step), [
    "new-active",
    "old-grace",
    "cross-key-audit-smoke",
    "cross-key-callback-smoke",
    "old-expire-or-revoke"
  ]);
  assert.doesNotMatch(JSON.stringify(rotation.body), new RegExp(REQUEST_SECRET));
  assert.doesNotMatch(JSON.stringify(rotation.body), new RegExp(RECEIPT_SECRET));

  const persisted = readDatabase();
  const persistedDispatch = persisted.publicHealthExternalDispatches.find((item) => item.id === dispatch.id);
  assert.equal(persistedDispatch.deliveryState, "delivered");
  assert.notEqual(persistedDispatch.attempts.at(-1).at, "1999-01-01T00:00:00.000Z");
  assert.equal(persisted.publicHealthExternalDispatchAudit.length, 4);
  const serializedState = JSON.stringify(persisted);
  assert.doesNotMatch(serializedState, new RegExp(REQUEST_SECRET));
  assert.doesNotMatch(serializedState, new RegExp(RECEIPT_SECRET));
  assert.doesNotMatch(serializedState, /requestKeyring|receiptKeyring/);
});
