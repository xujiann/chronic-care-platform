const assert = require("node:assert/strict");
const test = require("node:test");

const {
  applyObjectLifecycle,
  createObjectDownloadIntent,
  createObjectUploadIntent,
  finalizeObjectUpload,
  objectStorageCenter,
  signGatewayRequest,
  stableStringify,
  validateAttachmentMetadata
} = require("../secure-object-storage");

const ENV = {
  NODE_ENV: "production",
  OBJECT_STORAGE_GATEWAY_URL: "https://storage.example.gov.cn/api/",
  OBJECT_STORAGE_BUCKET: "health-attachments",
  OBJECT_STORAGE_SIGNING_SECRET: "object-storage-signing-secret",
  OBJECT_STORAGE_TOKEN: "object-storage-token"
};

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

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
    fetchImpl: async (url, options) => {
      captured = { url: String(url), options };
      return jsonResponse({ uploadId: "upload-001", uploadUrl: "https://storage.example.gov.cn/uploads/upload-001", expiresAt: "2026-07-11T04:00:00.000Z" });
    }
  });

  const body = JSON.parse(captured.options.body);
  assert.equal(captured.url, "https://storage.example.gov.cn/api/upload-intents");
  assert.equal(body.objectKey.endsWith("/attachment-001.pdf"), true);
  assert.equal(body.immutable, true);
  assert.equal(captured.options.headers.Authorization, "Bearer object-storage-token");
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
    fetchImpl: async () => jsonResponse({ sizeBytes: 2048, checksumSha256: "a".repeat(64), scanStatus: "clean", objectVersion: "version-001" })
  });
  assert.equal(clean.status, "active");
  assert.equal(clean.scanStatus, "clean");

  await assert.rejects(() => finalizeObjectUpload({
    attachmentId: "attachment-002",
    uploadId: "upload-002",
    objectKey: "clinical/attachment-002.pdf",
    expectedSizeBytes: 2048,
    expectedChecksumSha256: "a".repeat(64)
  }, {
    env: ENV,
    fetchImpl: async () => jsonResponse({ sizeBytes: 2048, checksumSha256: "b".repeat(64), scanStatus: "clean" })
  }), /checksum verification failed/);

  await assert.rejects(() => finalizeObjectUpload({
    attachmentId: "attachment-003",
    uploadId: "upload-003",
    objectKey: "clinical/attachment-003.pdf",
    expectedSizeBytes: 2048,
    expectedChecksumSha256: "a".repeat(64)
  }, {
    env: ENV,
    fetchImpl: async () => jsonResponse({ sizeBytes: 2048, checksumSha256: "a".repeat(64), scanStatus: "infected" })
  }), /malware scan did not pass/);
});

test("download and lifecycle intents return short-lived normalized receipts", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).endsWith("download-intents")) return jsonResponse({ downloadUrl: "https://storage.example.gov.cn/downloads/short-lived", expiresAt: "2026-07-11T04:00:00.000Z" });
    return jsonResponse({ accepted: true, status: "accepted", effectiveAt: "2026-07-11T03:55:00.000Z" });
  };
  const download = await createObjectDownloadIntent({ attachmentId: "attachment-001", objectKey: "clinical/attachment-001.pdf", objectVersion: "v1" }, { env: ENV, fetchImpl });
  const lifecycle = await applyObjectLifecycle({ attachmentId: "attachment-001", objectKey: "clinical/attachment-001.pdf", action: "legal-hold", reason: "audit review" }, { env: ENV, fetchImpl });
  assert.equal(download.downloadUrl.includes("short-lived"), true);
  assert.equal(lifecycle.action, "legal-hold");
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
});
