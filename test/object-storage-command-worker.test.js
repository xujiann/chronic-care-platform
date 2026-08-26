"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  inspectObjectStorageWorkerReadiness,
  runObjectStorageCommandWorker
} = require("../src/platform/operations/object-storage-command-worker");

function command(operation = "create-upload-intent") {
  return {
    commandId: "cmd-1",
    attachmentId: "att-1",
    operation,
    payload: operation === "apply-lifecycle" ? { action: "legal-hold", reason: "audit hold" } : { uploadId: "upload-1" },
    status: "leased",
    attempts: 1,
    leaseToken: "lease-token",
    leaseVersion: 1,
    attachment: {
      id: "att-1",
      filename: "report.pdf",
      contentType: "application/pdf",
      expectedSizeBytes: 10,
      expectedChecksumSha256: `sha256:${"a".repeat(64)}`,
      classification: "clinical-record",
      retentionPolicy: "clinical-record",
      retentionYears: 15,
      immutable: true,
      objectKey: "clinical/report.pdf",
      objectVersion: "v1"
    }
  };
}

function repository(claims) {
  const calls = [];
  return {
    calls,
    claimBatch(input) { calls.push(["claim", input]); return claims; },
    markDelivered(input) {
      calls.push(["delivered", input]);
      return { command: { status: "delivered", attempts: 1 } };
    },
    markFailed(input) {
      calls.push(["failed", input]);
      return { command: { status: "pending", attempts: 1 } };
    },
    health() { return { healthy: true, productionReady: false }; }
  };
}

function adapter(overrides = {}) {
  return {
    async createObjectUploadIntent() {
      return { objectKey: "clinical/report.pdf", uploadId: "upload-1", uploadUrl: "https://upload.example.test/report", expiresAt: "2026-08-26T01:05:00.000Z", requestId: "req-1" };
    },
    async finalizeObjectUpload() {
      return { scanStatus: "clean", scannedAt: "2026-08-26T01:00:05.000Z", checksumSha256: `sha256:${"a".repeat(64)}`, sizeBytes: 10, objectVersion: "v2", requestId: "req-2" };
    },
    async createObjectDownloadIntent() {
      return { downloadUrl: "https://download.example.test/report", expiresAt: "2026-08-26T01:05:00.000Z", requestId: "req-3" };
    },
    async applyObjectLifecycle() {
      return { status: "accepted", effectiveAt: "2026-08-26T01:00:05.000Z", requestId: "req-4" };
    },
    ...overrides
  };
}

test("worker executes every v2 operation outside the request path and persists digest-bound completion", async () => {
  for (const operation of ["create-upload-intent", "complete-upload", "create-download-intent", "apply-lifecycle"]) {
    const repo = repository([command(operation)]);
    const report = await runObjectStorageCommandWorker({
      repository: repo,
      adapter: adapter(),
      workerId: "worker-1",
      at: "2026-08-26T01:00:00.000Z",
      completedAt: "2026-08-26T01:00:05.000Z"
    });
    assert.equal(report.claimed, 1, operation);
    assert.equal(report.delivered, 1, operation);
    assert.equal(report.requestPathExternalDispatch, false, operation);
    assert.equal(report.productionReady, false, operation);
    const completion = repo.calls.find(([name]) => name === "delivered")[1];
    assert.match(completion.receiptDigest, /^sha256:[a-f0-9]{64}$/);
    assert.equal(completion.leaseToken, "lease-token");
  }
});

test("complete-upload converts the stored prefixed checksum to the v1 gateway hex contract", async () => {
  let received;
  const repo = repository([command("complete-upload")]);
  await runObjectStorageCommandWorker({
    repository: repo,
    adapter: adapter({ async finalizeObjectUpload(input) { received = input; return { scanStatus: "clean", checksumSha256: "a".repeat(64), sizeBytes: 10, objectVersion: "v2", requestId: "req" }; } }),
    workerId: "worker-1",
    at: "2026-08-26T01:00:00.000Z",
    completedAt: "2026-08-26T01:00:05.000Z"
  });
  assert.equal(received.expectedChecksumSha256, "a".repeat(64));
});

test("every provider retry uses the stable command id as the v1 gateway request id", async () => {
  for (const operation of ["create-upload-intent", "complete-upload", "create-download-intent", "apply-lifecycle"]) {
    const requestIds = [];
    const base = adapter();
    const method = {
      "create-upload-intent": "createObjectUploadIntent",
      "complete-upload": "finalizeObjectUpload",
      "create-download-intent": "createObjectDownloadIntent",
      "apply-lifecycle": "applyObjectLifecycle"
    }[operation];
    const original = base[method];
    base[method] = async (input, options) => { requestIds.push(options.requestId); return original(input, options); };
    for (let retry = 0; retry < 2; retry += 1) {
      await runObjectStorageCommandWorker({
        repository: repository([command(operation)]), adapter: base, workerId: "worker-1",
        at: "2026-08-26T01:00:00.000Z", completedAt: "2026-08-26T01:00:05.000Z"
      });
    }
    assert.deepEqual(requestIds, ["cmd-1", "cmd-1"], operation);
  }
});

test("provider failure is redacted, scheduled for retry, and does not persist raw errors", async () => {
  const repo = repository([command()]);
  const report = await runObjectStorageCommandWorker({
    repository: repo,
    adapter: adapter({
      async createObjectUploadIntent() {
        const error = new Error("provider secret response with patient data");
        error.code = "gateway timeout";
        throw error;
      }
    }),
    workerId: "worker-1",
    at: "2026-08-26T01:00:00.000Z",
    completedAt: "2026-08-26T01:00:05.000Z"
  });
  assert.equal(report.retryScheduled, 1);
  const failure = repo.calls.find(([name]) => name === "failed")[1];
  assert.equal(failure.errorCode, "GATEWAY_TIMEOUT");
  assert.equal(JSON.stringify(report).includes("patient data"), false);
});

test("worker readiness remains NO-GO until external provider capability and site evidence exist", () => {
  const report = inspectObjectStorageWorkerReadiness({
    OBJECT_STORAGE_COMMAND_WORKER_ID: "worker-1",
    OBJECT_STORAGE_CURSOR_SIGNING_SECRET: "cursor-secret-012345678901234567890123"
  }, {
    sqliteHead: 17,
    gatewayConfigured: true,
    providerStatusCapabilityVerified: false,
    externalEvidenceVerified: false,
    productionPromotionAllowed: false
  });
  assert.equal(report.configured, true);
  assert.equal(report.productionReady, false);
  assert.equal(report.checks.find((item) => item.id === "provider-status-capability").passed, false);
  assert.equal(report.checks.find((item) => item.id === "site-evidence").passed, false);
});
