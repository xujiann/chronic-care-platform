"use strict";

const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const {
  SQLITE_SCHEMA_HEAD,
  applySqliteMigrations,
  createSqliteObjectStorageRepository
} = require("../src/platform/storage/sqlite-migrations");
const { sha256 } = require("../src/platform/storage/object-storage-durable");

const NOW = "2026-08-26T01:00:00.000Z";
const CHECKSUM = `sha256:${"a".repeat(64)}`;

function openDatabase(targetVersion = SQLITE_SCHEMA_HEAD) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  applySqliteMigrations(db, { targetVersion });
  return db;
}

function legacyAttachment(id = "att-legacy-1") {
  return {
    id,
    residentId: "r1",
    sourceCollection: "personalRecords",
    sourceId: "record-1",
    filename: "legacy.pdf",
    contentType: "application/pdf",
    expectedSizeBytes: 512,
    expectedChecksumSha256: CHECKSUM,
    classification: "clinical-record",
    retentionPolicy: "clinical-record",
    retentionYears: 15,
    immutable: true,
    legalHold: false,
    createdBy: "legacy-user",
    createdByRole: "institution",
    createdByOrgCode: "ORG-1",
    objectKey: "clinical/legacy.pdf",
    objectVersion: "v1",
    status: "active",
    scanStatus: "clean",
    createdAt: NOW,
    updatedAt: NOW
  };
}

function installLegacyCollection(db, rows) {
  db.prepare(`INSERT INTO state_collections (key, payload, updated_at, version)
    VALUES ('secureAttachments', ?, ?, 1)`).run(JSON.stringify(rows), NOW);
}

function repository(db, clock = NOW) {
  return createSqliteObjectStorageRepository(db, {
    now: () => new Date(clock),
    tokenFactory: () => "lease-token-1",
    cursorSecret: "object-storage-cursor-test-secret-0123456789"
  });
}

function uploadCommandInput(index = 1) {
  const id = `att-new-${index}`;
  return {
    commandId: `cmd-upload-${index}`,
    attachmentId: id,
    idempotencyKey: `upload-key-${index}`,
    scope: "institution:ORG-1",
    actorId: "user-1",
    actorRole: "institution",
    orgCode: "ORG-1",
    createdAt: NOW,
    attachment: {
      id,
      residentId: "r1",
      sourceCollection: "personalRecords",
      sourceId: `record-${index}`,
      filename: `upload-${index}.pdf`,
      contentType: "application/pdf",
      expectedSizeBytes: 1024 + index,
      expectedChecksumSha256: CHECKSUM,
      classification: "clinical-record",
      retentionPolicy: "clinical-record",
      retentionYears: 15,
      immutable: true,
      legalHold: false,
      createdBy: "user-1",
      createdByRole: "institution",
      createdByOrgCode: "ORG-1",
      status: "pending",
      scanStatus: "pending",
      createdAt: NOW,
      updatedAt: NOW
    },
    payload: { namespace: "clinical-records" }
  };
}

test("v17 backfills every legacy attachment, records a digest reconciliation, and freezes legacy writes", () => {
  const db = openDatabase(16);
  try {
    installLegacyCollection(db, [legacyAttachment("att-a"), legacyAttachment("att-b")]);
    const result = applySqliteMigrations(db);

    assert.equal(result.head, 17);
    assert.equal(result.applied, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM secure_attachment_records").get().count, 2);
    const reconciliation = db.prepare("SELECT * FROM object_storage_reconciliation_cases WHERE case_id='object-storage-v17-backfill'").get();
    assert.equal(reconciliation.status, "resolved");
    assert.equal(reconciliation.local_sha256, reconciliation.provider_sha256);
    assert.throws(
      () => db.prepare("UPDATE state_collections SET payload='[]' WHERE key='secureAttachments'").run(),
      /legacy secureAttachments writes are frozen/
    );
    assert.throws(
      () => db.prepare("DELETE FROM state_collections WHERE key='secureAttachments'").run(),
      /legacy secureAttachments collection cannot be deleted/
    );
  } finally {
    db.close();
  }
});

test("v17 freezes creation of a missing legacy secureAttachments collection", () => {
  const db = openDatabase();
  try {
    assert.throws(() => installLegacyCollection(db, []), /cannot be created after v17 backfill/);
  } finally { db.close(); }
});

test("v17 rejects duplicate legacy ids and rolls back all five structured tables and ledger", () => {
  const db = openDatabase(16);
  try {
    installLegacyCollection(db, [legacyAttachment("att-duplicate"), legacyAttachment("att-duplicate")]);
    assert.throws(() => applySqliteMigrations(db), /OBJECT_STORAGE_BACKFILL_DUPLICATE_ID|duplicate ids/);
    assert.equal(db.prepare("SELECT version FROM schema_migrations WHERE version=17").get(), undefined);
    for (const table of [
      "secure_attachment_records",
      "object_storage_commands",
      "object_storage_command_receipts",
      "object_storage_reconciliation_cases",
      "object_storage_reconciliation_actions"
    ]) {
      assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table), undefined, table);
    }
  } finally {
    db.close();
  }
});

test("repository atomically creates an attachment and idempotent command, then fences delivery", () => {
  const db = openDatabase();
  try {
    const repo = repository(db);
    const first = repo.createUploadCommand(uploadCommandInput());
    const replay = repo.createUploadCommand(uploadCommandInput());
    assert.equal(first.idempotent, false);
    assert.equal(replay.idempotent, true);
    assert.equal(first.command.status, "pending");
    assert.equal(first.attachment.status, "pending");
    assert.throws(
      () => repo.createUploadCommand({ ...uploadCommandInput(), payload: { namespace: "different" } }),
      /idempotency key was used for a different command/
    );

    const [claim] = repo.claimBatch({ workerId: "worker-1", at: NOW, leaseSeconds: 60 });
    assert.equal(claim.status, "leased");
    assert.throws(() => repo.markDelivered({
      commandId: claim.commandId,
      workerId: "worker-1",
      leaseToken: "stale-token",
      leaseVersion: claim.leaseVersion,
      deliveredAt: "2026-08-26T01:00:10.000Z",
      result: { objectKey: "clinical/object.pdf" }
    }), /lease is stale/);

    const delivered = repo.markDelivered({
      commandId: claim.commandId,
      workerId: "worker-1",
      leaseToken: claim.leaseToken,
      leaseVersion: claim.leaseVersion,
      deliveredAt: "2026-08-26T01:00:10.000Z",
      result: {
        objectKey: "clinical/object.pdf",
        uploadId: "upload-1",
        uploadUrl: "https://upload.example.test/object",
        expiresAt: "2026-08-26T01:05:00.000Z"
      },
      resultExpiresAt: "2026-08-26T01:05:00.000Z",
      receiptDigest: sha256("receipt-1")
    });
    assert.equal(delivered.command.status, "delivered");
    assert.equal(delivered.attachment.status, "upload-authorized");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM object_storage_command_receipts").get().count, 1);
    assert.throws(
      () => db.prepare("UPDATE object_storage_command_receipts SET outcome='completed'").run(),
      /receipts are immutable/
    );
    const later = repository(db, "2026-08-26T01:06:00.000Z");
    assert.equal(later.getCommand(claim.commandId).command.result, null);
    const stored = db.prepare("SELECT result_json, result_expires_at FROM object_storage_commands WHERE command_id=?").get(claim.commandId);
    assert.equal(stored.result_json, null);
    assert.equal(stored.result_expires_at, null);
  } finally {
    db.close();
  }
});

test("two SQLite connections recheck idempotency under the write lock", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "object-storage-idempotency-"));
  const file = path.join(directory, "state.sqlite");
  const firstDb = new DatabaseSync(file);
  const secondDb = new DatabaseSync(file);
  t.after(() => { firstDb.close(); secondDb.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  firstDb.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000");
  secondDb.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000");
  applySqliteMigrations(firstDb);
  const second = repository(secondDb);

  let interleaved = false;
  const first = createSqliteObjectStorageRepository(firstDb, {
    now: () => new Date(NOW),
    cursorSecret: "object-storage-cursor-test-secret-0123456789",
    beforeEnqueueTransaction() {
      if (interleaved) return;
      interleaved = true;
      second.createUploadCommand(uploadCommandInput(20));
    }
  });
  const replay = first.createUploadCommand(uploadCommandInput(20));
  assert.equal(replay.idempotent, true);
  assert.equal(firstDb.prepare("SELECT COUNT(*) AS count FROM object_storage_commands WHERE idempotency_key_sha256 IS NOT NULL").get().count, 1);

  interleaved = false;
  const conflicting = createSqliteObjectStorageRepository(firstDb, {
    now: () => new Date(NOW),
    cursorSecret: "object-storage-cursor-test-secret-0123456789",
    beforeEnqueueTransaction() {
      if (interleaved) return;
      interleaved = true;
      second.createUploadCommand(uploadCommandInput(21));
    }
  });
  assert.throws(
    () => conflicting.createUploadCommand({ ...uploadCommandInput(21), payload: { namespace: "conflicting" } }),
    (error) => error.code === "OBJECT_STORAGE_IDEMPOTENCY_CONFLICT"
  );
  assert.equal(firstDb.prepare("SELECT COUNT(*) AS count FROM object_storage_commands").get().count, 2);
});

test("failed commands use bounded backoff, dead-letter, and audited idempotent replay", () => {
  const db = openDatabase();
  try {
    const repo = repository(db);
    repo.createUploadCommand(uploadCommandInput());
    db.prepare("UPDATE object_storage_commands SET max_attempts=1 WHERE command_id='cmd-upload-1'").run();
    const [claim] = repo.claimBatch({ workerId: "worker-1", at: NOW });
    const failed = repo.markFailed({
      commandId: claim.commandId,
      workerId: "worker-1",
      leaseToken: claim.leaseToken,
      leaseVersion: claim.leaseVersion,
      failedAt: "2026-08-26T01:00:10.000Z",
      errorCode: "PROVIDER_TIMEOUT"
    });
    assert.equal(failed.command.status, "dead-letter");
    const input = {
      commandId: claim.commandId,
      replayKeyDigest: sha256("replay-key"),
      actorDigest: sha256("commission-1"),
      reasonDigest: sha256("provider recovered"),
      replayedAt: "2026-08-26T01:01:00.000Z"
    };
    assert.equal(repo.replayDeadLetter(input).idempotent, false);
    assert.equal(repo.replayDeadLetter(input).idempotent, true);
    assert.equal(repo.getCommand(claim.commandId).command.status, "pending");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM object_storage_reconciliation_actions").get().count, 1);
  } finally {
    db.close();
  }
});

test("manual replay rechecks its receipt under the SQLite write lock", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "object-storage-replay-"));
  const file = path.join(directory, "state.sqlite");
  const firstDb = new DatabaseSync(file);
  const secondDb = new DatabaseSync(file);
  t.after(() => { firstDb.close(); secondDb.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  firstDb.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000");
  secondDb.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000");
  applySqliteMigrations(firstDb);
  const setup = repository(firstDb);
  setup.createUploadCommand(uploadCommandInput(30));
  firstDb.prepare("UPDATE object_storage_commands SET status='dead-letter', dead_lettered_at=? WHERE command_id='cmd-upload-30'").run(NOW);
  const input = {
    commandId: "cmd-upload-30",
    replayKeyDigest: sha256("concurrent-replay-key"),
    actorDigest: sha256("commission-1"),
    reasonDigest: sha256("provider recovered"),
    replayedAt: "2026-08-26T01:01:00.000Z"
  };
  const second = repository(secondDb);
  let interleaved = false;
  const first = createSqliteObjectStorageRepository(firstDb, {
    now: () => new Date(NOW),
    cursorSecret: "object-storage-cursor-test-secret-0123456789",
    beforeReplayTransaction() {
      if (interleaved) return;
      interleaved = true;
      assert.equal(second.replayDeadLetter(input).idempotent, false);
    }
  });
  assert.equal(first.replayDeadLetter(input).idempotent, true);
  assert.equal(firstDb.prepare("SELECT COUNT(*) AS count FROM object_storage_reconciliation_actions").get().count, 1);
  assert.equal(firstDb.prepare("SELECT replay_count FROM object_storage_commands WHERE command_id='cmd-upload-30'").get().replay_count, 1);
});

test("command enqueue fences attachment state while preserving exact idempotent replay", () => {
  const db = openDatabase();
  try {
    const repo = repository(db);
    repo.createUploadCommand(uploadCommandInput(31));
    db.prepare("UPDATE secure_attachment_records SET status='upload-authorized', version=2 WHERE attachment_id='att-new-31'").run();
    const input = {
      commandId: "cmd-complete-31",
      attachmentId: "att-new-31",
      operation: "complete-upload",
      idempotencyKey: "complete-key-31",
      scope: "institution:ORG-1",
      actorId: "user-1",
      expectedAttachmentVersion: 2,
      expectedAttachmentStatus: "upload-authorized",
      payload: { uploadId: "upload-31" }
    };
    assert.equal(repo.enqueueCommand(input).idempotent, false);
    db.prepare("UPDATE secure_attachment_records SET status='active', scan_status='clean', version=3 WHERE attachment_id='att-new-31'").run();
    assert.equal(repo.enqueueCommand(input).idempotent, true);
    assert.throws(
      () => repo.enqueueCommand({ ...input, commandId: "cmd-download-31", operation: "create-download-intent", idempotencyKey: "download-key-31", expectedAttachmentStatus: "active", expectedAttachmentScanStatus: "clean", expectedAttachmentVersion: 2, payload: {} }),
      (error) => error.code === "OBJECT_STORAGE_ATTACHMENT_STATE_CONFLICT"
    );
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM object_storage_commands WHERE command_id='cmd-download-31'").get().count, 0);
  } finally {
    db.close();
  }
});

test("scope-bound high-water keyset pagination has no duplicates during concurrent insertion", () => {
  const db = openDatabase();
  try {
    const repo = repository(db);
    for (let index = 1; index <= 5; index += 1) repo.createUploadCommand(uploadCommandInput(index));
    const scope = { role: "institution", orgCode: "ORG-1" };
    const first = repo.listAttachments({ scope, limit: 2 });
    repo.createUploadCommand(uploadCommandInput(6));
    const second = repo.listAttachments({ scope, limit: 2, cursor: first.nextCursor });
    const third = repo.listAttachments({ scope, limit: 2, cursor: second.nextCursor });
    const ids = [...first.items, ...second.items, ...third.items].map((item) => item.id);
    assert.deepEqual(ids, ["att-new-5", "att-new-4", "att-new-3", "att-new-2", "att-new-1"]);
    assert.equal(new Set(ids).size, 5);
    assert.equal(ids.includes("att-new-6"), false);
    assert.throws(
      () => repo.listAttachments({ scope: { role: "institution", orgCode: "ORG-2" }, cursor: first.nextCursor }),
      /cursor scope does not match/
    );
    const [body] = first.nextCursor.split(".");
    const decoded = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    decoded.extra = true;
    const forgedBody = Buffer.from(JSON.stringify(decoded)).toString("base64url");
    const forgedSignature = createHmac("sha256", "object-storage-cursor-test-secret-0123456789").update(forgedBody).digest("base64url");
    assert.throws(() => repo.listAttachments({ scope, cursor: `${forgedBody}.${forgedSignature}` }), /cursor is invalid/);
    assert.throws(() => repo.listAttachments({ scope, cursor: `${body}.invalid` }), /cursor is invalid/);
  } finally {
    db.close();
  }
});

test("provider observations persist reconciliation cases without overwriting attachment facts", () => {
  const db = openDatabase();
  try {
    const repo = repository(db);
    repo.createUploadCommand(uploadCommandInput());
    const before = repo.getAttachment("att-new-1");
    const opened = repo.reconcileObservation({
      attachmentId: "att-new-1",
      providerDigest: sha256("provider-state-mismatch"),
      matches: false,
      actionId: "reconcile-action-1",
      actorDigest: sha256("worker-1"),
      observedAt: NOW
    });
    assert.equal(opened.status, "open");
    assert.deepEqual(repo.getAttachment("att-new-1"), before);
    assert.equal(repo.health().openReconciliationCases, 1);
    assert.throws(() => repo.reconcileObservation({
      attachmentId: "att-new-1",
      providerDigest: sha256("provider-state-now-matches"),
      matches: true,
      actionId: "reconcile-action-1",
      actorDigest: sha256("worker-1"),
      observedAt: "2026-08-26T01:01:00.000Z"
    }), /UNIQUE constraint failed/);
    const unchangedCase = db.prepare("SELECT status, occurrence_count FROM object_storage_reconciliation_cases WHERE case_id='provider-state:att-new-1'").get();
    assert.equal(unchangedCase.status, "open");
    assert.equal(unchangedCase.occurrence_count, 1);
  } finally {
    db.close();
  }
});
