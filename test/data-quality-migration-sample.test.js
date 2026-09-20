"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const {
  buildPostgresSyncBatch,
  enqueuePostgresSyncBatch,
  loadPendingPostgresSyncBatches
} = require("../postgres-runtime-sync");
const { assessDataQualityMigrationSample } = require("../src/platform/data/data-quality-migration-sample");

function sample(records = [{ id: "synthetic-issue-1", status: "in_progress" }]) {
  const sourceRow = { key: "dataQualityIssues", payload: JSON.stringify(records), version: 2 };
  const outboxBatch = buildPostgresSyncBatch([
    { collection: "dataQualityIssues", operation: "upsert", sourceVersion: 2, payload: records }
  ], { createdAt: "2026-09-20T00:00:00.000Z" });
  const change = outboxBatch.changes[0];
  return {
    sourceRow,
    outboxBatch,
    commitment: {
      state: "committed",
      source: "sqlite-transactional-outbox",
      sourceTransactionId: "synthetic-sqlite-tx-1",
      outboxSequence: 1,
      committedAt: "2026-09-20T00:00:01.000Z",
      payloadSha256: outboxBatch.payloadSha256
    },
    targetRow: {
      collection: "dataQualityIssues",
      sourceVersion: 2,
      payloadSha256: change.payloadSha256,
      deleted: false
    }
  };
}

test("synthetic source, committed outbox and target match without exposing records", () => {
  const result = assessDataQualityMigrationSample(sample());
  assert.equal(result.ok, true);
  assert.equal(result.recordCount, 1);
  assert.equal(result.localExecutionAuthorized, false);
  assert.equal(result.productionReady, false);
  assert.equal(JSON.stringify(result).includes("synthetic-issue-1"), false);
});

test("the actual SQLite outbox reader omits transaction and sequence proof", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dq-migration-sample-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const sqliteFile = path.join(dir, "outbox.sqlite");
  const db = new DatabaseSync(sqliteFile);
  db.exec(`CREATE TABLE postgres_sync_outbox (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT, batch_id TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL, payload TEXT NOT NULL, payload_sha256 TEXT NOT NULL,
    previous_chain_hash TEXT NOT NULL DEFAULT '', chain_hash TEXT NOT NULL,
    status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT NOT NULL
  )`);
  const input = sample();
  db.exec("BEGIN IMMEDIATE");
  enqueuePostgresSyncBatch(db, [{
    collection: "dataQualityIssues", operation: "upsert", sourceVersion: 2,
    payload: [{ id: "synthetic-issue-1", status: "in_progress" }]
  }], { createdAt: "2026-09-20T00:00:00.000Z" });
  db.exec("COMMIT");
  db.close();
  const [loaded] = loadPendingPostgresSyncBatches(sqliteFile, { now: "2026-09-20T00:01:00.000Z" });
  assert.equal(loaded.outboxSequence, undefined);
  assert.equal(loaded.sourceTransactionId, undefined);
  input.outboxBatch = loaded;
  input.commitment = {
    state: "committed", source: "sqlite-transactional-outbox",
    outboxSequence: loaded.outboxSequence, sourceTransactionId: loaded.sourceTransactionId,
    committedAt: loaded.createdAt, payloadSha256: loaded.payloadSha256
  };
  assert.deepEqual(assessDataQualityMigrationSample(input).blockers, ["COMMITTED_OUTBOX_PROOF_MISSING"]);
});

test("derived issues cannot replace persisted overrides and duplicate IDs fail closed", () => {
  const derived = sample();
  derived.sourceRow = { ...derived.sourceRow, key: "buildDataQualityIssues" };
  assert.ok(assessDataQualityMigrationSample(derived).blockers.includes("SOURCE_COLLECTION_INVALID"));

  const duplicate = sample([{ id: "a" }, { id: "a" }]);
  assert.ok(assessDataQualityMigrationSample(duplicate).blockers.includes("SOURCE_OVERRIDE_SET_INVALID"));
});

test("changed versions, payload digests and target state are rejected", () => {
  const changed = sample();
  changed.sourceRow.version = 3;
  assert.ok(assessDataQualityMigrationSample(changed).blockers.includes("OUTBOX_SOURCE_MISMATCH"));

  const missingTarget = sample();
  missingTarget.targetRow = null;
  assert.ok(assessDataQualityMigrationSample(missingTarget).blockers.includes("TARGET_RECONCILIATION_MISMATCH"));

  const alteredTarget = sample();
  alteredTarget.targetRow.payloadSha256 = "0".repeat(64);
  assert.ok(assessDataQualityMigrationSample(alteredTarget).blockers.includes("TARGET_RECONCILIATION_MISMATCH"));

  const alteredDecodedBatch = sample();
  alteredDecodedBatch.outboxBatch.changes[0].sourceVersion = 3;
  assert.ok(assessDataQualityMigrationSample(alteredDecodedBatch).blockers.includes("OUTBOX_SOURCE_MISMATCH"));
});

test("malformed and oversized source rows do not leak records", () => {
  const malformed = sample();
  malformed.sourceRow.payload = "{not-json";
  assert.ok(assessDataQualityMigrationSample(malformed).blockers.includes("SOURCE_PAYLOAD_INVALID"));

  const oversized = sample(Array.from({ length: 301 }, (_, index) => ({ id: `synthetic-${index}` })));
  const result = assessDataQualityMigrationSample(oversized);
  assert.ok(result.blockers.includes("SOURCE_OVERRIDE_SET_INVALID"));
  assert.equal(JSON.stringify(result).includes("synthetic-300"), false);
});

test("forged dates and non-canonical receipts cannot pass the proof shape", () => {
  const input = sample();
  input.commitment.committedAt = "2026-02-30T00:00:00.000Z";
  assert.ok(assessDataQualityMigrationSample(input).blockers.includes("COMMITTED_OUTBOX_PROOF_MISSING"));
});

test("oversized source and outbox inputs fail before parsing", () => {
  const oversizedSource = sample();
  oversizedSource.sourceRow.payload = "x".repeat(1_048_577);
  assert.ok(assessDataQualityMigrationSample(oversizedSource).blockers.includes("SOURCE_COLLECTION_INVALID"));

  const oversizedBatch = sample();
  oversizedBatch.outboxBatch.payload = "x".repeat(1_048_577);
  assert.ok(assessDataQualityMigrationSample(oversizedBatch).blockers.includes("OUTBOX_BATCH_INVALID"));
});
