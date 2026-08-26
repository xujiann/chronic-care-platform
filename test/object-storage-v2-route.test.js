"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createHandler } = require("../src/http/routes/integration/object-storage-v2");

function response() {
  return { status: 0, body: null };
}

function runtime(overrides = {}) {
  const calls = [];
  const attachment = {
    id: "att-1",
    residentId: "r1",
    filename: "report.pdf",
    contentType: "application/pdf",
    expectedSizeBytes: 10,
    expectedChecksumSha256: `sha256:${"a".repeat(64)}`,
    classification: "clinical-record",
    retentionPolicy: "clinical-record",
    retentionYears: 15,
    immutable: true,
    legalHold: false,
    createdBy: "citizen-1",
    createdByRole: "citizen",
    createdByOrgCode: "",
    objectKey: "",
    objectVersion: "",
    status: "pending",
    scanStatus: "pending",
    version: 1,
    createdAt: "2026-08-26T01:00:00.000Z",
    updatedAt: "2026-08-26T01:00:00.000Z",
    ...(overrides.attachment || {})
  };
  const repository = {
    createUploadCommand(input) {
      calls.push(["create", input]);
      return {
        command: { commandId: "cmd-1", attachmentId: "att-1", status: "pending" },
        attachment: { ...attachment, id: input.attachmentId },
        idempotent: false
      };
    },
    getCommand() {
      calls.push(["get"]);
      return {
        command: {
          commandId: "cmd-1",
          attachmentId: "att-1",
          operation: "create-upload-intent",
          status: "pending",
          attempts: 0,
          nextAttemptAt: "2026-08-26T01:00:00.000Z",
          result: null,
          resultExpiresAt: "",
          lastErrorCode: "",
          deadLetteredAt: "",
          replayCount: 0,
          createdAt: "2026-08-26T01:00:00.000Z",
          updatedAt: "2026-08-26T01:00:00.000Z"
        },
        attachment
      };
    },
    getAttachment() { calls.push(["get-attachment"]); return attachment; },
    enqueueCommand(input) {
      calls.push(["enqueue", input]);
      return { command: { commandId: "cmd-operation-1", attachmentId: attachment.id, operation: input.operation, status: "pending" }, attachment, idempotent: false };
    },
    replayDeadLetter(input) {
      calls.push(["replay", input]);
      return { command: { commandId: input.commandId, attachmentId: attachment.id, operation: "complete-upload", status: "pending" }, attachment, idempotent: false };
    },
    listAttachments() { return { items: [attachment], nextCursor: "", highWaterMark: 1 }; }
  };
  Object.assign(repository, overrides.repository || {});
  return {
    calls,
    canAccessResident: () => true,
    canAccessSecureAttachment: () => true,
    collectJson: async (req) => req.body || {},
    randomUUID: (() => { let value = 0; return () => `${++value}`; })(),
    readDatabase: () => ({ residents: [{ id: "r1" }] }),
    requireApiRole: () => ({ role: "citizen", username: "citizen-1", residentId: "r1" }),
    sendJson(res, status, body) { res.status = status; res.body = body; },
    validateAttachmentMetadata: (input) => ({
      filename: String(input.filename || "").trim(),
      contentType: String(input.contentType || "").toLowerCase(),
      sizeBytes: Number(input.sizeBytes),
      checksumSha256: String(input.checksumSha256 || "").replace(/^sha256:/, ""),
      classification: "clinical-record",
      retentionPolicy: "clinical-record",
      retentionYears: 15,
      immutable: true
    }),
    withObjectStorageDurableRepository(callback) { calls.push(["repository"]); return callback(repository); },
    ...overrides
  };
}

test("v2 upload command returns 202 without invoking an external provider", async () => {
  const fixture = runtime();
  const handler = createHandler(fixture);
  const res = response();
  const handled = await handler({
    method: "POST",
    headers: { "idempotency-key": "upload-1" },
    body: {
      residentId: "r1",
      filename: "report.pdf",
      contentType: "application/pdf",
      sizeBytes: 10,
      checksumSha256: `sha256:${"a".repeat(64)}`,
      classification: "clinical-record",
      retentionPolicy: "clinical-record",
      retentionYears: 15,
      immutable: true
    }
  }, res, new URL("https://platform.example.test/api/attachments/v2/upload-intents"));

  assert.equal(handled, true);
  assert.equal(res.status, 202);
  assert.equal(res.body.commandId, "cmd-1");
  assert.equal(res.body.statusUrl, "/api/attachments/v2/commands/cmd-1");
  assert.equal(res.body.productionReady, false);
  assert.deepEqual(fixture.calls.map(([name]) => name), ["repository", "create"]);
  const persisted = fixture.calls.find(([name]) => name === "create")[1].attachment;
  assert.equal(persisted.expectedChecksumSha256, `sha256:${"a".repeat(64)}`);
  assert.equal(persisted.retentionYears, 15);
  assert.equal(persisted.immutable, true);
});

test("v2 upload persists only normalized retention metadata", async () => {
  const fixture = runtime();
  const res = response();
  await createHandler(fixture)({
    method: "POST",
    headers: { "idempotency-key": "normalized-upload" },
    body: {
      residentId: "r1", filename: " report.pdf ", contentType: "APPLICATION/PDF", sizeBytes: 10,
      checksumSha256: "a".repeat(64), classification: "public", retentionPolicy: "temporary",
      retentionYears: 1, immutable: false
    }
  }, res, new URL("https://platform.example.test/api/attachments/v2/upload-intents"));
  const persisted = fixture.calls.find(([name]) => name === "create")[1].attachment;
  assert.equal(persisted.classification, "clinical-record");
  assert.equal(persisted.retentionPolicy, "clinical-record");
  assert.equal(persisted.retentionYears, 15);
  assert.equal(persisted.immutable, true);
});

test("authentication denial stops before database reads and repository access", async () => {
  let reads = 0;
  const fixture = runtime({
    requireApiRole: () => null,
    readDatabase() { reads += 1; return {}; }
  });
  const handled = await createHandler(fixture)(
    { method: "GET", headers: {} },
    response(),
    new URL("https://platform.example.test/api/attachments/v2/commands/cmd-1")
  );
  assert.equal(handled, true);
  assert.equal(reads, 0);
  assert.deepEqual(fixture.calls, []);
});

test("command status is scope checked and does not expose object keys", async () => {
  const fixture = runtime();
  const res = response();
  await createHandler(fixture)(
    { method: "GET", headers: {} },
    res,
    new URL("https://platform.example.test/api/attachments/v2/commands/cmd-1")
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.command.status, "pending");
  assert.equal(res.body.attachment.objectKey, undefined);
  assert.equal(res.body.attachment.objectKeyPresent, false);
});

test("list uses role-bound repository scope and carries keyset metadata", async () => {
  let scope = null;
  const fixture = runtime();
  fixture.withObjectStorageDurableRepository = (callback) => callback({
    listAttachments(input) {
      scope = input.scope;
      return { items: [], nextCursor: "cursor-2", highWaterMark: 9 };
    }
  });
  const res = response();
  await createHandler(fixture)(
    { method: "GET", headers: {} },
    res,
    new URL("https://platform.example.test/api/attachments/v2?limit=10")
  );
  assert.equal(res.status, 200);
  assert.deepEqual(scope, { role: "citizen", residentIds: ["r1"] });
  assert.equal(res.body.nextCursor, "cursor-2");
  assert.equal(res.body.highWaterMark, 9);
});

test("complete and download commands carry attachment CAS preconditions into the durable transaction", async () => {
  const fixture = runtime({ attachment: { status: "upload-authorized", version: 7 } });
  const handler = createHandler(fixture);
  const completeResponse = response();
  await handler({
    method: "POST",
    headers: { "idempotency-key": "complete-1" },
    body: { uploadId: "provider-upload-1" }
  }, completeResponse, new URL("https://platform.example.test/api/attachments/v2/att-1/complete"));
  assert.equal(completeResponse.status, 202);
  const complete = fixture.calls.find(([name, input]) => name === "enqueue" && input.operation === "complete-upload")[1];
  assert.equal(complete.expectedAttachmentVersion, 7);
  assert.equal(complete.expectedAttachmentStatus, "upload-authorized");
  assert.equal(complete.expectedAttachmentScanStatus, "");

  fixture.calls.length = 0;
  const downloadResponse = response();
  await handler({
    method: "POST",
    headers: { "idempotency-key": "download-1" },
    body: {}
  }, downloadResponse, new URL("https://platform.example.test/api/attachments/v2/att-1/download-intents"));
  assert.equal(downloadResponse.status, 202);
  const download = fixture.calls.find(([name, input]) => name === "enqueue" && input.operation === "create-download-intent")[1];
  assert.equal(download.expectedAttachmentVersion, 7);
  assert.equal(download.expectedAttachmentStatus, "active");
  assert.equal(download.expectedAttachmentScanStatus, "clean");
});

test("lifecycle and manual replay routes preserve commission-only authorization and durable receipts", async () => {
  const fixture = runtime({
    requireApiRole: () => ({ role: "commission", username: "commission-1", orgCode: "COMMISSION" })
  });
  const handler = createHandler(fixture);
  const lifecycleResponse = response();
  await handler({
    method: "POST",
    headers: { "idempotency-key": "hold-1" },
    body: { action: "legal-hold", reason: "case preservation" }
  }, lifecycleResponse, new URL("https://platform.example.test/api/attachments/v2/att-1/actions"));
  assert.equal(lifecycleResponse.status, 202);
  const lifecycle = fixture.calls.find(([name, input]) => name === "enqueue" && input.operation === "apply-lifecycle")[1];
  assert.equal(lifecycle.expectedAttachmentVersion, 1);
  assert.deepEqual(lifecycle.payload, { action: "legal-hold", reason: "case preservation" });

  fixture.calls.length = 0;
  const replayResponse = response();
  await handler({
    method: "POST",
    headers: { "idempotency-key": "replay-1" },
    body: { reason: "provider recovered" }
  }, replayResponse, new URL("https://platform.example.test/api/attachments/v2/commands/cmd-dead/replay"));
  assert.equal(replayResponse.status, 202);
  const replay = fixture.calls.find(([name]) => name === "replay")[1];
  assert.equal(replay.commandId, "cmd-dead");
  assert.match(replay.replayKeyDigest, /^sha256:[a-f0-9]{64}$/);
  assert.match(replay.reasonDigest, /^sha256:[a-f0-9]{64}$/);
});

test("malformed encoded identifiers fail closed before repository mutation", async () => {
  const fixture = runtime();
  const res = response();
  await createHandler(fixture)({
    method: "POST",
    headers: { "idempotency-key": "complete-invalid" },
    body: { uploadId: "provider-upload-1" }
  }, res, new URL("https://platform.example.test/api/attachments/v2/%/complete"));
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "OBJECT_STORAGE_PATH_ID_INVALID");
  assert.equal(fixture.calls.some(([name]) => name === "enqueue"), false);
});
