const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { signExecutionCallback } = require("../digital-hospital-execution-security");

const ROOT = path.resolve(__dirname, "..");
const CALLBACK_SECRET = "api-test-digital-hospital-callback-secret-32-plus";

async function api(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const body = await response.json();
  return { response, body };
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

test("digital hospital production execution API persists jobs verifies callbacks and governs evidence", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "digital-hospital-execution-api-"));
  fs.copyFileSync(path.join(ROOT, "data", "db.json"), path.join(dataDir, "db.json"));
  process.env.DATA_DIR = dataDir;
  process.env.STORAGE_ENGINE = "json";
  process.env.DIGITAL_HOSPITAL_CALLBACK_SECRET = CALLBACK_SECRET;
  const { server, startServer, stopServer } = require("../server");
  startServer(0);
  if (!server.listening) await new Promise((resolve) => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await stopServer();
    delete process.env.DATA_DIR;
    delete process.env.STORAGE_ENGINE;
    delete process.env.DIGITAL_HOSPITAL_CALLBACK_SECRET;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const login = await api(baseUrl, "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "city", password: "123456" })
  });
  assert.equal(login.response.status, 200);
  const token = login.body.token;

  const runtime = await api(baseUrl, "/api/digital-hospital/execution/runtime", authorized(token));
  assert.equal(runtime.response.status, 200);
  assert.equal(runtime.body.repository.storage, "sqlite-wal");
  assert.equal(runtime.body.repository.atomicClaims, true);
  assert.equal(runtime.body.repository.durableLeases, true);
  assert.equal(runtime.body.security.persistenceBoundary.rawSecret, false);

  const worker = await api(baseUrl, "/api/digital-hospital/execution/workers", authorized(token, {
    method: "POST",
    body: JSON.stringify({
      id: "WORKER-API-001",
      node: "api-test-node",
      pool: "api-test",
      capabilities: ["probe"]
    })
  }));
  assert.equal(worker.response.status, 201);
  assert.equal(worker.body.result.id, "WORKER-API-001");

  const enqueue = await api(baseUrl, "/api/digital-hospital/execution/jobs", authorized(token, {
    method: "POST",
    headers: { "Idempotency-Key": "execution-api-job-001" },
    body: JSON.stringify({
      connectorId: "CONN-API-001",
      environmentId: "ENV-PILOT-UAT",
      jobType: "probe",
      payload: { batch: "api-test" }
    })
  }));
  assert.equal(enqueue.response.status, 201);
  const job = enqueue.body.result.job;

  const claim = await api(baseUrl, `/api/digital-hospital/execution/jobs/${job.id}/actions`, authorized(token, {
    method: "POST",
    body: JSON.stringify({ action: "claim", workerId: "WORKER-API-001", leaseSeconds: 60 })
  }));
  assert.equal(claim.response.status, 200);
  const leaseToken = claim.body.result.leaseToken;
  assert.match(leaseToken, /^lease-/);

  const complete = await api(baseUrl, `/api/digital-hospital/execution/jobs/${job.id}/actions`, authorized(token, {
    method: "POST",
    body: JSON.stringify({
      action: "complete-attempt",
      workerId: "WORKER-API-001",
      leaseToken
    })
  }));
  assert.equal(complete.response.status, 200);
  assert.equal(complete.body.result.status, "awaiting-receipt");

  const timestamp = String(Date.now());
  const nonce = "execution-api-callback-001";
  const callbackPayload = {
    jobId: job.id,
    connectorId: "CONN-API-001",
    source: "CONN-API-001",
    environmentId: "ENV-PILOT-UAT",
    eventType: "integration-job.completed",
    payloadDigest: job.payloadDigest
  };
  const signature = signExecutionCallback(callbackPayload, {
    secret: CALLBACK_SECRET,
    timestamp,
    nonce
  });
  const callback = await api(baseUrl, "/api/digital-hospital/execution/callbacks", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Execution-Timestamp": timestamp,
      "X-Execution-Nonce": nonce,
      "X-Execution-Signature": signature
    },
    body: JSON.stringify(callbackPayload)
  });
  assert.equal(callback.response.status, 202);
  assert.equal(callback.body.result.accepted, true);

  const after = await api(baseUrl, "/api/digital-hospital/execution/runtime", authorized(token));
  const completedJob = after.body.jobs.find((item) => item.id === job.id);
  assert.equal(completedJob.status, "succeeded");
  assert.equal(JSON.stringify(after.body).includes(leaseToken), false);
  assert.equal(JSON.stringify(after.body).includes(nonce), false);
  assert.equal(JSON.stringify(after.body).includes(CALLBACK_SECRET), false);

  const evaluatedWindow = await api(
    baseUrl,
    "/api/digital-hospital/execution/cutover-windows/CUTOVER-PILOT-001/actions",
    authorized(token, {
      method: "POST",
      body: JSON.stringify({ action: "evaluate" })
    })
  );
  assert.equal(evaluatedWindow.response.status, 200);
  assert.equal(evaluatedWindow.body.result.status, "ready");

  const createdPack = await api(baseUrl, "/api/digital-hospital/execution/cutover-evidence-packs", authorized(token, {
    method: "POST",
    body: JSON.stringify({
      windowId: "CUTOVER-PILOT-001",
      institutionId: "MR1",
      institutionName: "首批试点医院",
      releaseVersion: "v0.18"
    })
  }));
  assert.equal(createdPack.response.status, 201);
  const packId = createdPack.body.result.id;

  const evidence = await api(
    baseUrl,
    `/api/digital-hospital/execution/cutover-evidence-packs/${packId}/actions`,
    authorized(token, {
      method: "POST",
      body: JSON.stringify({
        action: "record-evidence",
        requirementId: "joint-test-success",
        artifactName: "joint-test-success.json",
        artifactDigest: "b".repeat(64),
        sourceSystem: "pilot-evidence-vault",
        role: "integration-owner"
      })
    })
  );
  assert.equal(evidence.response.status, 200);
  assert.equal(evidence.body.result.status, "recorded");

  const security = await api(baseUrl, "/api/digital-hospital/execution/security", authorized(token));
  assert.equal(security.response.status, 200);
  assert.equal(security.body.security.productionReady, false);
  assert.equal(security.body.security.blockers.length > 0, true);
});
