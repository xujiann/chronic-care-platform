"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { createRouteSegments } = require("../src/http/routes/integration");

const UPLOAD_URL = "https://uploads.example.test/direct-upload/new-attachment";

function attachment(index) {
  return {
    id: `attachment-${index}`,
    filename: `protected-${index}.pdf`,
    status: "active",
    scanStatus: "clean",
    immutable: index === 0,
    legalHold: index === 1
  };
}

function uploadPayload() {
  return {
    filename: "new-report.pdf",
    contentType: "application/pdf",
    sizeBytes: 4096,
    checksumSha256: "a".repeat(64),
    classification: "clinical",
    retentionPolicy: "clinical-record"
  };
}

function createHarness(attachmentCount) {
  let state = {
    residents: [],
    secureAttachments: Array.from({ length: attachmentCount }, (_, index) => attachment(index)),
    securityEvents: []
  };
  let gatewayCalls = 0;
  let writes = 0;
  let responseStatus = null;
  let responseBody = null;
  const runtime = {
    canAccessResident: () => true,
    collectJson: async () => uploadPayload(),
    createObjectUploadIntent: async ({ attachmentId }) => {
      gatewayCalls += 1;
      return {
        attachmentId,
        objectKey: `clinical-records/2026/08/22/${attachmentId}.pdf`,
        uploadId: `upload-${attachmentId}`,
        uploadUrl: UPLOAD_URL,
        expiresAt: "2026-08-22T10:15:00.000Z",
        metadata: {
          filename: "new-report.pdf",
          contentType: "application/pdf",
          sizeBytes: 4096,
          checksumSha256: "a".repeat(64),
          classification: "clinical",
          retentionPolicy: "clinical-record",
          retentionYears: 15,
          immutable: true
        }
      };
    },
    randomUUID: () => "new-attachment",
    readDatabase: () => structuredClone(state),
    requireApiRole: () => ({ role: "commission", username: "health", name: "Platform Operator" }),
    sendJson: (_res, status, body) => {
      responseStatus = status;
      responseBody = body;
    },
    validateAttachmentMetadata: () => true,
    writeDatabase: (next) => {
      writes += 1;
      state = structuredClone(next);
    }
  };
  const segment = createRouteSegments(runtime).find((candidate) => candidate.id === "integration-01");
  return {
    async upload() {
      await segment.handle(
        { method: "POST", headers: {} },
        {},
        new URL("https://platform.example.test/api/attachments/upload-intents")
      );
      return { responseStatus, responseBody };
    },
    snapshot: () => structuredClone(state),
    metrics: () => ({ gatewayCalls, writes })
  };
}

test("the 500th attachment is retained without deleting existing immutable metadata", async () => {
  const harness = createHarness(499);
  const beforeIds = harness.snapshot().secureAttachments.map((item) => item.id);

  const response = await harness.upload();

  assert.equal(response.responseStatus, 201);
  assert.equal(harness.metrics().gatewayCalls, 1);
  assert.equal(harness.metrics().writes, 1);
  const persisted = harness.snapshot().secureAttachments;
  assert.equal(persisted.length, 500);
  assert.equal(persisted[0].id, "att-new-attachment");
  assert.deepEqual(persisted.slice(1).map((item) => item.id), beforeIds);
  assert.equal(persisted.find((item) => item.id === "attachment-0").immutable, true);
  assert.equal(persisted.find((item) => item.id === "attachment-1").legalHold, true);
});

for (const attachmentCount of [500, 501]) {
  test(`${attachmentCount} existing attachments fail closed before the gateway and preserve every row`, async () => {
    const harness = createHarness(attachmentCount);
    const before = harness.snapshot();

    const response = await harness.upload();

    assert.equal(response.responseStatus, 507);
    assert.deepEqual(response.responseBody, {
      error: "Insufficient Storage",
      code: "SECURE_ATTACHMENT_METADATA_CAPACITY_EXCEEDED",
      message: "安全附件元数据容量已满，请联系平台管理员处理",
      productionReady: false
    });
    assert.equal(harness.metrics().gatewayCalls, 0);
    assert.equal(harness.metrics().writes, 0);
    assert.deepEqual(harness.snapshot(), before);
    assert.equal(JSON.stringify(response.responseBody).includes("protected-0.pdf"), false);
    assert.equal(JSON.stringify(response.responseBody).includes("attachment-0"), false);
    assert.equal(JSON.stringify(response.responseBody).includes(UPLOAD_URL), false);
  });
}
