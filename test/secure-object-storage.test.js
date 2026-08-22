const assert = require("node:assert/strict");
const test = require("node:test");

const {
  applyObjectLifecycle,
  createObjectDownloadIntent,
  createObjectUploadIntent,
  finalizeObjectUpload,
  objectStorageCenter,
  signGatewayRequest,
  signGatewayResponse,
  stableStringify,
  validateAttachmentMetadata
} = require("../secure-object-storage");

const NOW = "2026-08-22T00:00:00.000Z";
const ENV = {
  NODE_ENV: "production",
  OBJECT_STORAGE_GATEWAY_URL: "https://storage.example.gov.cn/api/",
  OBJECT_STORAGE_BUCKET: "health-attachments",
  OBJECT_STORAGE_SIGNING_SECRET: "object-storage-request-signing-secret-v1",
  OBJECT_STORAGE_RECEIPT_SIGNING_SECRET: "object-storage-receipt-signing-secret-v1",
  OBJECT_STORAGE_TOKEN: "object-storage-token",
  OBJECT_STORAGE_GATEWAY_CONTRACT_VERSION: "object-storage-gateway-trust-v1",
  OBJECT_STORAGE_UPLOAD_URL_ALLOWED_ORIGINS: "https://storage.example.gov.cn",
  OBJECT_STORAGE_DOWNLOAD_URL_ALLOWED_ORIGINS: "https://storage.example.gov.cn",
  OBJECT_STORAGE_UPLOAD_TTL_SECONDS: "900",
  OBJECT_STORAGE_DOWNLOAD_TTL_SECONDS: "300",
  OBJECT_STORAGE_RESPONSE_MAX_SKEW_SECONDS: "300"
};

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

function gatewayBody(operation, request, overrides = {}) {
  return {
    schemaVersion: "object-storage-gateway-response-v1",
    requestId: request.requestId,
    operation,
    bucket: request.bucket,
    attachmentId: request.attachmentId,
    objectKey: request.objectKey,
    ...overrides
  };
}

function signedJsonResponse(body, options = {}) {
  const status = options.status || 200;
  const timestamp = options.timestamp || NOW;
  const requestId = options.requestId || body.requestId;
  const operation = options.operation || body.operation;
  const bodyText = JSON.stringify(body);
  const headers = new Map([
    ["x-object-storage-contract", options.contractVersion || "object-storage-gateway-trust-v1"],
    ["x-request-id", requestId],
    ["x-timestamp", timestamp],
    ["x-signature-algorithm", "HMAC-SHA256"],
    ["x-signature", options.signature || signGatewayResponse(bodyText, options.secret || ENV.OBJECT_STORAGE_RECEIPT_SIGNING_SECRET, {
      operation,
      status,
      timestamp,
      requestId
    })]
  ]);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers.get(String(name).toLowerCase()) || null },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(Buffer.from(bodyText));
        controller.close();
      }
    }),
    text: async () => bodyText
  };
}

test("object storage response signature has an independent known-answer vector", () => {
  assert.equal(signGatewayResponse(JSON.stringify({ ok: true }), "receipt-secret-0123456789abcdef0123456789", {
    operation: "upload-intents",
    status: 201,
    timestamp: "2026-08-22T00:00:00.000Z",
    requestId: "request-vector-001"
  }), "2209e2fad4c78be8286cdaffcfb960aa9b9946a19f0fd2cc9fb6a3252d0dfc33");
});

test("object storage v1 stops streaming an oversized gateway response before buffering it", async () => {
  const chunk = new Uint8Array(600 * 1024);
  let reads = 0;
  let cancelled = false;
  let released = false;
  let textCalls = 0;
  const response = {
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: {
      getReader() {
        return {
          async read() {
            reads += 1;
            return { done: false, value: chunk };
          },
          async cancel() {
            cancelled = true;
          },
          releaseLock() {
            released = true;
          }
        };
      }
    },
    async text() {
      textCalls += 1;
      throw new Error("unbounded text buffering must not be used");
    }
  };
  await assert.rejects(() => createObjectUploadIntent({
    attachmentId: "attachment-oversized-response",
    namespace: "clinical-records",
    filename: "oversized-response.pdf",
    contentType: "application/pdf",
    sizeBytes: 2048,
    checksumSha256: "a".repeat(64)
  }, {
    env: ENV,
    now: NOW,
    fetchImpl: async () => response
  }), (error) => error && error.code === "OBJECT_STORAGE_GATEWAY_RESPONSE_TOO_LARGE");
  assert.equal(reads, 2);
  assert.equal(cancelled, true);
  assert.equal(released, true);
  assert.equal(textCalls, 0);
});

test("object storage upload intent validates metadata and signs the gateway request", async () => {
  let captured;
  const intent = await createObjectUploadIntent({
    attachmentId: "attachment-001",
    namespace: "clinical-records",
    filename: "lab-report.pdf",
    contentType: "application/pdf",
    sizeBytes: 2048,
    checksumSha256: "a".repeat(64),
    classification: "clinical",
    retentionPolicy: "clinical-record"
  }, {
    env: ENV,
    requestId: "storage-request-001",
    now: NOW,
    fetchImpl: async (url, options) => {
      captured = { url: String(url), options };
      const request = JSON.parse(options.body);
      return signedJsonResponse(gatewayBody("upload-intents", request, {
        uploadId: "upload-001",
        uploadUrl: "https://storage.example.gov.cn/uploads/upload-001",
        expiresAt: "2026-08-22T00:10:00.000Z"
      }));
    }
  });

  const body = JSON.parse(captured.options.body);
  assert.equal(captured.url, "https://storage.example.gov.cn/api/upload-intents");
  assert.equal(body.objectKey.endsWith("/attachment-001.pdf"), true);
  assert.equal(body.immutable, true);
  assert.equal(body.contractVersion, "object-storage-gateway-trust-v1");
  assert.equal(body.operation, "upload-intents");
  assert.equal(captured.options.headers.Authorization, "Bearer object-storage-token");
  assert.equal(captured.options.headers["X-Object-Storage-Contract"], "object-storage-gateway-trust-v1");
  assert.equal(captured.options.headers["X-Signature"], signGatewayRequest(stableStringify(body), ENV.OBJECT_STORAGE_SIGNING_SECRET, captured.options.headers["X-Timestamp"], "storage-request-001"));
  assert.equal(intent.uploadId, "upload-001");
  assert.equal(JSON.stringify(intent).includes(ENV.OBJECT_STORAGE_SIGNING_SECRET), false);
  assert.equal(JSON.stringify(intent).includes(ENV.OBJECT_STORAGE_TOKEN), false);
});

test("object completion requires matching integrity and a clean server-side scan", async () => {
  const clean = await finalizeObjectUpload({
    attachmentId: "attachment-001",
    uploadId: "upload-001",
    objectKey: "clinical/attachment-001.pdf",
    expectedSizeBytes: 2048,
    expectedChecksumSha256: "a".repeat(64)
  }, {
    env: ENV,
    now: NOW,
    fetchImpl: async (_url, options) => {
      const request = JSON.parse(options.body);
      return signedJsonResponse(gatewayBody("objects/complete", request, {
        uploadId: request.uploadId,
        sizeBytes: 2048,
        checksumSha256: "a".repeat(64),
        scanStatus: "clean",
        objectVersion: "version-001",
        scannedAt: NOW,
        scanReceiptId: "scan-receipt-001"
      }));
    }
  });
  assert.equal(clean.status, "active");
  assert.equal(clean.scanStatus, "clean");
  assert.equal(clean.scanReceiptId, undefined);

  await assert.rejects(() => finalizeObjectUpload({
    attachmentId: "attachment-002",
    uploadId: "upload-002",
    objectKey: "clinical/attachment-002.pdf",
    expectedSizeBytes: 2048,
    expectedChecksumSha256: "a".repeat(64)
  }, {
    env: ENV,
    now: NOW,
    fetchImpl: async (_url, options) => {
      const request = JSON.parse(options.body);
      return signedJsonResponse(gatewayBody("objects/complete", request, {
        uploadId: request.uploadId,
        sizeBytes: 2048,
        checksumSha256: "b".repeat(64),
        scanStatus: "clean",
        objectVersion: "version-002",
        scannedAt: NOW,
        scanReceiptId: "scan-receipt-002"
      }));
    }
  }), /checksum verification failed/);

  await assert.rejects(() => finalizeObjectUpload({
    attachmentId: "attachment-003",
    uploadId: "upload-003",
    objectKey: "clinical/attachment-003.pdf",
    expectedSizeBytes: 2048,
    expectedChecksumSha256: "a".repeat(64)
  }, {
    env: ENV,
    now: NOW,
    fetchImpl: async (_url, options) => {
      const request = JSON.parse(options.body);
      return signedJsonResponse(gatewayBody("objects/complete", request, {
        uploadId: request.uploadId,
        sizeBytes: 2048,
        checksumSha256: "a".repeat(64),
        scanStatus: "infected",
        objectVersion: "version-003",
        scannedAt: NOW,
        scanReceiptId: "scan-receipt-003"
      }));
    }
  }), /malware scan did not pass/);
});

test("download and lifecycle intents return short-lived normalized receipts", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push(String(url));
    const request = JSON.parse(options.body);
    if (String(url).endsWith("download-intents")) {
      return signedJsonResponse(gatewayBody("download-intents", request, {
        objectVersion: request.objectVersion,
        downloadUrl: "https://storage.example.gov.cn/downloads/short-lived",
        expiresAt: "2026-08-22T00:04:00.000Z"
      }));
    }
    return signedJsonResponse(gatewayBody("objects/lifecycle", request, {
      objectVersion: request.objectVersion,
      action: request.action,
      accepted: true,
      status: "applied",
      receiptId: "lifecycle-receipt-001",
      effectiveAt: NOW
    }));
  };
  const download = await createObjectDownloadIntent({ attachmentId: "attachment-001", objectKey: "clinical/attachment-001.pdf", objectVersion: "v1" }, { env: ENV, now: NOW, fetchImpl });
  const lifecycle = await applyObjectLifecycle({ attachmentId: "attachment-001", objectKey: "clinical/attachment-001.pdf", objectVersion: "v1", action: "legal-hold", reason: "audit review" }, { env: ENV, now: NOW, fetchImpl });
  assert.equal(download.downloadUrl.includes("short-lived"), true);
  assert.equal(lifecycle.action, "legal-hold");
  assert.equal(lifecycle.receiptId, undefined);
  assert.deepEqual(calls.map((item) => item.split("/").pop()), ["download-intents", "lifecycle"]);
});

test("metadata validation rejects executable paths, invalid checksums and oversized files", () => {
  assert.throws(() => validateAttachmentMetadata({ filename: "../malware.exe", contentType: "application/octet-stream", sizeBytes: 10, checksumSha256: "a".repeat(64) }, ENV), /invalid path segment/);
  assert.throws(() => validateAttachmentMetadata({ filename: "report.pdf", contentType: "application/pdf", sizeBytes: 10, checksumSha256: "bad" }, ENV), /checksum/);
  assert.throws(() => validateAttachmentMetadata({ filename: "report.pdf", contentType: "application/pdf", sizeBytes: 101 * 1024 * 1024, checksumSha256: "a".repeat(64) }, ENV), /attachment size/);
});

test("storage center never exposes endpoint, bucket or credentials", () => {
  const center = objectStorageCenter(ENV);
  assert.equal(center.adapterReady, true);
  assert.equal(center.productionReady, false);
  assert.equal(center.controls.serverSideMalwareScanRequired, true);
  const serialized = JSON.stringify(center);
  assert.equal(serialized.includes("storage.example.gov.cn"), false);
  assert.equal(serialized.includes("health-attachments"), false);
  assert.equal(serialized.includes(ENV.OBJECT_STORAGE_SIGNING_SECRET), false);
  assert.equal(serialized.includes(ENV.OBJECT_STORAGE_TOKEN), false);
  assert.equal(serialized.includes(ENV.OBJECT_STORAGE_RECEIPT_SIGNING_SECRET), false);
});

test("production trust v1 configuration fails before fetch when contract, origins or independent receipt key is missing", async () => {
  const cases = [
    ["contract", { ...ENV, OBJECT_STORAGE_GATEWAY_CONTRACT_VERSION: "" }],
    ["upload origins", { ...ENV, OBJECT_STORAGE_UPLOAD_URL_ALLOWED_ORIGINS: "" }],
    ["download origins", { ...ENV, OBJECT_STORAGE_DOWNLOAD_URL_ALLOWED_ORIGINS: "" }],
    ["receipt key", { ...ENV, OBJECT_STORAGE_RECEIPT_SIGNING_SECRET: "" }],
    ["separate receipt key", { ...ENV, OBJECT_STORAGE_RECEIPT_SIGNING_SECRET: ENV.OBJECT_STORAGE_SIGNING_SECRET }]
  ];
  for (const [label, env] of cases) {
    let fetches = 0;
    assert.equal(objectStorageCenter(env).adapterReady, false, label);
    await assert.rejects(() => createObjectUploadIntent({
      attachmentId: "attachment-config",
      filename: "report.pdf",
      contentType: "application/pdf",
      sizeBytes: 10,
      checksumSha256: "a".repeat(64)
    }, { env, now: NOW, fetchImpl: async () => { fetches += 1; return jsonResponse({}); } }), /trust contract/i, label);
    assert.equal(fetches, 0, label);
  }
});

test("production rejects invalid or credential-bearing gateway bases before fetch", async () => {
  for (const gatewayUrl of ["https://", "https://user:password@storage.example.gov.cn/api/"]) {
    const env = { ...ENV, OBJECT_STORAGE_GATEWAY_URL: gatewayUrl };
    let fetches = 0;
    assert.equal(objectStorageCenter(env).adapterReady, false);
    await assert.rejects(() => createObjectUploadIntent({
      attachmentId: "attachment-gateway-base",
      filename: "report.pdf",
      contentType: "application/pdf",
      sizeBytes: 10,
      checksumSha256: "a".repeat(64)
    }, { env, now: NOW, fetchImpl: async () => { fetches += 1; return jsonResponse({}); } }), /GATEWAY_URL|gateway URL|adapter is not configured/i);
    assert.equal(fetches, 0);
  }
});

test("trust v1 rejects unsigned, stale and request-mismatched gateway responses", async () => {
  const baseInput = {
    attachmentId: "attachment-response",
    filename: "report.pdf",
    contentType: "application/pdf",
    sizeBytes: 10,
    checksumSha256: "a".repeat(64)
  };
  const cases = [
    ["unsigned", (body) => ({ ...signedJsonResponse(body), headers: { get: () => null } })],
    ["bad signature", (body) => signedJsonResponse(body, { signature: "0".repeat(64) })],
    ["stale", (body) => signedJsonResponse(body, { timestamp: "2026-08-21T23:00:00.000Z" })],
    ["request mismatch", (body) => signedJsonResponse({ ...body, requestId: "different-request" })]
  ];
  for (const [label, response] of cases) {
    await assert.rejects(() => createObjectUploadIntent(baseInput, {
      env: ENV,
      now: NOW,
      requestId: "request-response",
      fetchImpl: async (_url, options) => {
        const request = JSON.parse(options.body);
        const body = gatewayBody("upload-intents", request, {
          uploadId: "upload-response",
          uploadUrl: "https://storage.example.gov.cn/uploads/upload-response",
          expiresAt: "2026-08-22T00:10:00.000Z"
        });
        return response(body);
      }
    }), /object storage gateway response/i, label);
  }
});

test("trust v1 rejects upload URLs outside the exact origin allowlist or TTL", async () => {
  const cases = [
    ["untrusted origin", "https://evil.example.cn/uploads/upload-url", "2026-08-22T00:10:00.000Z"],
    ["expired", "https://storage.example.gov.cn/uploads/upload-url", "2026-08-21T23:59:59.000Z"],
    ["overlong TTL", "https://storage.example.gov.cn/uploads/upload-url", "2026-08-22T01:00:00.000Z"]
  ];
  for (const [label, uploadUrl, expiresAt] of cases) {
    await assert.rejects(() => createObjectUploadIntent({
      attachmentId: "attachment-url",
      filename: "report.pdf",
      contentType: "application/pdf",
      sizeBytes: 10,
      checksumSha256: "a".repeat(64)
    }, {
      env: ENV,
      now: NOW,
      fetchImpl: async (_url, options) => {
        const request = JSON.parse(options.body);
        return signedJsonResponse(gatewayBody("upload-intents", request, {
          uploadId: "upload-url",
          uploadUrl,
          expiresAt
        }));
      }
    }), /object storage .*intent|signed URL/i, label);
  }
});

test("trust v1 applies the exact-origin and TTL policy to download URLs", async () => {
  const cases = [
    ["untrusted origin", "https://download.evil.example.cn/attachment", "2026-08-22T00:04:00.000Z"],
    ["userinfo", "https://user@storage.example.gov.cn/downloads/attachment", "2026-08-22T00:04:00.000Z"],
    ["fragment", "https://storage.example.gov.cn/downloads/attachment#token", "2026-08-22T00:04:00.000Z"],
    ["expired", "https://storage.example.gov.cn/downloads/attachment", "2026-08-21T23:59:59.000Z"],
    ["overlong TTL", "https://storage.example.gov.cn/downloads/attachment", "2026-08-22T00:20:00.000Z"]
  ];
  for (const [label, downloadUrl, expiresAt] of cases) {
    await assert.rejects(() => createObjectDownloadIntent({
      attachmentId: "attachment-download",
      objectKey: "clinical/attachment-download.pdf",
      objectVersion: "v1"
    }, {
      env: ENV,
      now: NOW,
      fetchImpl: async (_url, options) => {
        const request = JSON.parse(options.body);
        return signedJsonResponse(gatewayBody("download-intents", request, {
          objectVersion: request.objectVersion,
          downloadUrl,
          expiresAt
        }));
      }
    }), /object storage .*intent|signed URL/i, label);
  }
});

test("trust v1 rejects signed response body binding drift and hides provider errors", async () => {
  const input = {
    attachmentId: "attachment-binding",
    filename: "report.pdf",
    contentType: "application/pdf",
    sizeBytes: 10,
    checksumSha256: "a".repeat(64)
  };
  await assert.rejects(() => createObjectUploadIntent(input, {
    env: ENV,
    now: NOW,
    fetchImpl: async (_url, options) => {
      const request = JSON.parse(options.body);
      return signedJsonResponse(gatewayBody("upload-intents", request, {
        attachmentId: "different-attachment",
        uploadId: "upload-binding",
        uploadUrl: "https://storage.example.gov.cn/uploads/upload-binding",
        expiresAt: "2026-08-22T00:10:00.000Z"
      }));
    }
  }), /attachmentId binding is invalid/);

  await assert.rejects(() => createObjectUploadIntent(input, {
    env: ENV,
    now: NOW,
    fetchImpl: async (_url, options) => {
      const request = JSON.parse(options.body);
      return signedJsonResponse(gatewayBody("upload-intents", request, {
        message: "provider-secret-internal-stack",
        error: "provider-secret-internal-stack"
      }), { status: 502 });
    }
  }), (error) => {
    assert.equal(error.code, "OBJECT_STORAGE_GATEWAY_REQUEST_FAILED");
    assert.equal(error.message.includes("provider-secret-internal-stack"), false);
    return true;
  });
});

test("trust v1 refuses coercible integrity values in completion receipts", async () => {
  await assert.rejects(() => finalizeObjectUpload({
    attachmentId: "attachment-size-type",
    uploadId: "upload-size-type",
    objectKey: "clinical/attachment-size-type.pdf",
    expectedSizeBytes: 10,
    expectedChecksumSha256: "a".repeat(64)
  }, {
    env: ENV,
    now: NOW,
    fetchImpl: async (_url, options) => {
      const request = JSON.parse(options.body);
      return signedJsonResponse(gatewayBody("objects/complete", request, {
        uploadId: request.uploadId,
        sizeBytes: "10",
        checksumSha256: "a".repeat(64),
        scanStatus: "clean",
        objectVersion: "version-size-type",
        scannedAt: NOW,
        scanReceiptId: "scan-receipt-size-type"
      }));
    }
  }), /size verification failed/);
});

test("trust v1 keeps untrusted scan status text out of errors", async () => {
  const providerText = "provider-secret-internal-stack";
  await assert.rejects(() => finalizeObjectUpload({
    attachmentId: "attachment-scan-text",
    uploadId: "upload-scan-text",
    objectKey: "clinical/attachment-scan-text.pdf",
    expectedSizeBytes: 10,
    expectedChecksumSha256: "a".repeat(64)
  }, {
    env: ENV,
    now: NOW,
    fetchImpl: async (_url, options) => {
      const request = JSON.parse(options.body);
      return signedJsonResponse(gatewayBody("objects/complete", request, {
        uploadId: request.uploadId,
        sizeBytes: 10,
        checksumSha256: "a".repeat(64),
        scanStatus: providerText,
        objectVersion: "version-scan-text",
        scannedAt: NOW,
        scanReceiptId: "scan-receipt-text"
      }));
    }
  }), (error) => {
    assert.equal(error.code, "OBJECT_STORAGE_MALWARE_SCAN_NOT_CLEAN");
    assert.equal(error.message.includes(providerText), false);
    return true;
  });
});

test("trust v1 requires object versions and binds even an empty quarantine version", async () => {
  let fetches = 0;
  await assert.rejects(() => createObjectDownloadIntent({
    attachmentId: "attachment-version",
    objectKey: "clinical/attachment-version.pdf",
    objectVersion: ""
  }, { env: ENV, now: NOW, fetchImpl: async () => { fetches += 1; return jsonResponse({}); } }), /object version is required/);
  await assert.rejects(() => applyObjectLifecycle({
    attachmentId: "attachment-version",
    objectKey: "clinical/attachment-version.pdf",
    objectVersion: "",
    action: "legal-hold",
    reason: "review"
  }, { env: ENV, now: NOW, fetchImpl: async () => { fetches += 1; return jsonResponse({}); } }), /object version is required/);
  assert.equal(fetches, 0);

  await assert.rejects(() => applyObjectLifecycle({
    attachmentId: "attachment-version",
    objectKey: "clinical/attachment-version.pdf",
    objectVersion: "",
    action: "quarantine",
    reason: "scan failed"
  }, {
    env: ENV,
    now: NOW,
    fetchImpl: async (_url, options) => {
      const request = JSON.parse(options.body);
      return signedJsonResponse(gatewayBody("objects/lifecycle", request, {
        objectVersion: "unexpected-current-version",
        action: request.action,
        accepted: true,
        status: "applied",
        receiptId: "lifecycle-version-drift",
        effectiveAt: NOW
      }));
    }
  }), /objectVersion binding is invalid/);
});

test("trust v1 rejects non-RFC3339 response and receipt times", async () => {
  const uploadInput = {
    attachmentId: "attachment-time",
    filename: "report.pdf",
    contentType: "application/pdf",
    sizeBytes: 10,
    checksumSha256: "a".repeat(64)
  };
  await assert.rejects(() => createObjectUploadIntent(uploadInput, {
    env: ENV,
    now: NOW,
    fetchImpl: async (_url, options) => {
      const request = JSON.parse(options.body);
      return signedJsonResponse(gatewayBody("upload-intents", request, {
        uploadId: "upload-time",
        uploadUrl: "https://storage.example.gov.cn/uploads/upload-time",
        expiresAt: "2026-08-22T00:10:00.000Z"
      }), { timestamp: "2026-08-22" });
    }
  }), /timestamp is outside/);

  await assert.rejects(() => createObjectUploadIntent(uploadInput, {
    env: ENV,
    now: NOW,
    fetchImpl: async (_url, options) => {
      const request = JSON.parse(options.body);
      return signedJsonResponse(gatewayBody("upload-intents", request, {
        uploadId: "upload-time",
        uploadUrl: "https://storage.example.gov.cn/uploads/upload-time",
        expiresAt: "2026-08-22T00:10:00"
      }));
    }
  }), /intent expiry is invalid/);

  await assert.rejects(() => finalizeObjectUpload({
    attachmentId: "attachment-time",
    uploadId: "upload-time",
    objectKey: "clinical/attachment-time.pdf",
    expectedSizeBytes: 10,
    expectedChecksumSha256: "a".repeat(64)
  }, {
    env: ENV,
    now: NOW,
    fetchImpl: async (_url, options) => {
      const request = JSON.parse(options.body);
      return signedJsonResponse(gatewayBody("objects/complete", request, {
        uploadId: request.uploadId,
        sizeBytes: 10,
        checksumSha256: "a".repeat(64),
        scanStatus: "clean",
        objectVersion: "version-time",
        scannedAt: "2026-08-22",
        scanReceiptId: "scan-receipt-time"
      }));
    }
  }), /completion receipt/i);
});

test("trust v1 requires explicit complete and applied lifecycle receipts", async () => {
  await assert.rejects(() => finalizeObjectUpload({
    attachmentId: "attachment-strict",
    uploadId: "upload-strict",
    objectKey: "clinical/attachment-strict.pdf",
    expectedSizeBytes: 10,
    expectedChecksumSha256: "a".repeat(64)
  }, {
    env: ENV,
    now: NOW,
    fetchImpl: async (_url, options) => {
      const request = JSON.parse(options.body);
      return signedJsonResponse(gatewayBody("objects/complete", request, {
        uploadId: request.uploadId,
        sizeBytes: 10,
        checksumSha256: "a".repeat(64),
        scanStatus: "clean"
      }));
    }
  }), /completion receipt/i);

  await assert.rejects(() => applyObjectLifecycle({
    attachmentId: "attachment-strict",
    objectKey: "clinical/attachment-strict.pdf",
    objectVersion: "v1",
    action: "legal-hold",
    reason: "review"
  }, {
    env: ENV,
    now: NOW,
    fetchImpl: async (_url, options) => {
      const request = JSON.parse(options.body);
      return signedJsonResponse(gatewayBody("objects/lifecycle", request, {
        objectVersion: request.objectVersion,
        action: request.action
      }));
    }
  }), /lifecycle receipt/i);
});

test("non-production without explicit contract version preserves the legacy migration path", async () => {
  const env = { ...ENV, NODE_ENV: "test" };
  delete env.OBJECT_STORAGE_GATEWAY_CONTRACT_VERSION;
  delete env.OBJECT_STORAGE_RECEIPT_SIGNING_SECRET;
  delete env.OBJECT_STORAGE_UPLOAD_URL_ALLOWED_ORIGINS;
  delete env.OBJECT_STORAGE_DOWNLOAD_URL_ALLOWED_ORIGINS;
  const intent = await createObjectUploadIntent({
    attachmentId: "attachment-legacy",
    filename: "legacy.pdf",
    contentType: "application/pdf",
    sizeBytes: 10,
    checksumSha256: "a".repeat(64)
  }, {
    env,
    fetchImpl: async () => jsonResponse({
      uploadId: "upload-legacy",
      uploadUrl: "https://storage.example.gov.cn/uploads/upload-legacy",
      expiresAt: "2099-01-01T00:00:00.000Z"
    })
  });
  assert.equal(intent.uploadId, "upload-legacy");
  assert.equal(objectStorageCenter(env).adapterReady, true);
  assert.equal(objectStorageCenter(env).productionReady, false);
});
