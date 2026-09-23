"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { applySqliteMigrations } = require("../src/platform/storage/sqlite-migrations");
const { initializeSqliteOutboxSourceIdentity } = require("../src/platform/storage/sqlite-outbox-source-identity");
const { commitSqliteBoundOutboxTransaction, loadBoundSqliteOutboxBatches } = require("../src/platform/storage/sqlite-outbox-commit-receipt");
const { createPrimaryDurableCheckpoint } = require("../src/platform/storage/postgres-primary-durable-checkpoint");

const TARGET_ID = "a23b4567-89ab-4cde-8f01-23456789abcd";

async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "primary-checkpoint-"));
  const sourceFile = path.join(directory, "source.sqlite");
  const checkpointFile = path.join(directory, "checkpoint.sqlite");
  const db = new DatabaseSync(sourceFile);
  t.after(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  applySqliteMigrations(db);
  initializeSqliteOutboxSourceIdentity(db);
  for (let version = 1; version <= 2; version += 1) {
    commitSqliteBoundOutboxTransaction(db, { entries: [["settings", { synthetic: version }]],
      expectedVersions: { settings: version - 1 }, sourceEvent: "synthetic-checkpoint" });
  }
  const envelopes = loadBoundSqliteOutboxBatches(sourceFile);
  const applied = new Map();
  let bindingValid = true;
  let targetGate = null;
  const driver = {
    status: () => ({ supportsBoundIdentity: true }),
    async transaction(options, operation) {
      assert.equal(options.isolation, "repeatable-read");
      assert.equal(options.readOnly, true);
      assert.equal(options.binding.expectedTargetId, TARGET_ID);
      assert.equal(options.binding.namespace, "health_platform");
      if (!bindingValid) throw Object.assign(new Error("synthetic binding drift"), { code: "POSTGRES_PRIMARY_IDENTITY_MISMATCH" });
      if (targetGate) await targetGate();
      return operation({ getAppliedBatch: async (id) => applied.get(id) || null,
        getLastAppliedBatch: async () => [...applied.values()].at(-1) || null });
    }
  };
  const checkpoint = () => createPrimaryDurableCheckpoint({ checkpointFile, sourceFile, driver, expectedTargetId: TARGET_ID });
  function commitTarget(envelope) {
    applied.set(envelope.batch.batchId, { batchId: envelope.batch.batchId,
      payloadSha256: envelope.batch.payloadSha256, previousChainHash: envelope.batch.previousChainHash,
      chainHash: envelope.batch.chainHash, sourceTransactionId: envelope.commitment.sourceTransactionId,
      outboxSequence: envelope.commitment.outboxSequence, committedAt: envelope.commitment.committedAt,
      appliedChanges: envelope.batch.changes.length });
  }
  await checkpoint().initialize();
  return { checkpoint, checkpointFile, sourceFile, driver, envelopes, applied, commitTarget,
    invalidateBinding() { bindingValid = false; }, setTargetGate(value) { targetGate = value; } };
}

test("durable checkpoint survives restart, replays exactly, and recovers a target-commit crash window", async (t) => {
  const f = await fixture(t);
  assert.equal(await f.checkpoint().read(), null);
  await assert.rejects(f.checkpoint().advance(f.envelopes[0]), { code: "POSTGRES_PRIMARY_CHECKPOINT_TARGET_MISMATCH" });
  assert.equal(await f.checkpoint().read(), null);
  f.commitTarget(f.envelopes[0]);
  const first = await f.checkpoint().advance(f.envelopes[0]);
  assert.equal(first.outboxSequence, 1);
  assert.deepEqual(await f.checkpoint().advance(f.envelopes[0]), first);
  assert.deepEqual(await f.checkpoint().read(), first);
  f.commitTarget(f.envelopes[1]);
  assert.equal((await f.checkpoint().advance(f.envelopes[1])).outboxSequence, 2);
  assert.equal((await f.checkpoint().read()).outboxSequence, 2);
});

test("skips, forged envelopes, target drift and checkpoint mutation fail closed", async (t) => {
  const f = await fixture(t);
  f.commitTarget(f.envelopes[0]);
  f.commitTarget(f.envelopes[1]);
  await assert.rejects(f.checkpoint().advance(f.envelopes[1]), { code: "POSTGRES_PRIMARY_CHECKPOINT_SOURCE_MISMATCH" });
  await assert.rejects(f.checkpoint().advance({ ...f.envelopes[0] }), { code: "SQLITE_OUTBOX_SOURCE_ENVELOPE_INVALID" });
  f.applied.get(f.envelopes[0].batch.batchId).payloadSha256 = "0".repeat(64);
  await assert.rejects(f.checkpoint().advance(f.envelopes[0]), { code: "POSTGRES_PRIMARY_CHECKPOINT_TARGET_MISMATCH" });
  f.commitTarget(f.envelopes[0]);
  await f.checkpoint().advance(f.envelopes[0]);
  const db = new DatabaseSync(f.checkpointFile);
  assert.throws(() => db.exec("UPDATE checkpoint_entries SET outbox_sequence=3"), /CHECKPOINT_IMMUTABLE/);
  assert.throws(() => db.exec("DELETE FROM checkpoint_entries"), /CHECKPOINT_IMMUTABLE/);
  db.close();
  assert.equal((await f.checkpoint().read()).outboxSequence, 1);
});

test("missing checkpoint after initialization is not silently recreated", async (t) => {
  const f = await fixture(t);
  f.commitTarget(f.envelopes[0]);
  await f.checkpoint().advance(f.envelopes[0]);
  fs.rmSync(f.checkpointFile);
  await assert.rejects(f.checkpoint().read(), { code: "POSTGRES_PRIMARY_CHECKPOINT_MISSING" });
  await assert.rejects(f.checkpoint().advance(f.envelopes[1]), { code: "POSTGRES_PRIMARY_CHECKPOINT_MISSING" });
});

test("initialization refuses target history without creating a checkpoint", async (t) => {
  const f = await fixture(t);
  f.commitTarget(f.envelopes[0]);
  const secondFile = path.join(path.dirname(f.checkpointFile), "second-checkpoint.sqlite");
  const second = createPrimaryDurableCheckpoint({ checkpointFile: secondFile,
    sourceFile: f.sourceFile, driver: f.driver, expectedTargetId: TARGET_ID });
  await assert.rejects(second.initialize(), { code: "POSTGRES_PRIMARY_CHECKPOINT_TARGET_NOT_EMPTY" });
  assert.equal(fs.existsSync(secondFile), false);
});

test("empty checkpoint remains bound and read fails when target receipt drifts", async (t) => {
  const f = await fixture(t);
  f.invalidateBinding();
  await assert.rejects(f.checkpoint().read(), { code: "POSTGRES_PRIMARY_IDENTITY_MISMATCH" });
  const other = await fixture(t);
  const wrong = createPrimaryDurableCheckpoint({ checkpointFile: other.checkpointFile,
    sourceFile: path.join(path.dirname(other.checkpointFile), "source.sqlite"),
    driver: { status: () => ({ supportsBoundIdentity: true }), transaction: async () => null },
    expectedTargetId: "b23b4567-89ab-4cde-8f01-23456789abcd" });
  await assert.rejects(wrong.read(), { code: "POSTGRES_PRIMARY_CHECKPOINT_IDENTITY_MISMATCH" });
  other.commitTarget(other.envelopes[0]);
  await other.checkpoint().advance(other.envelopes[0]);
  other.applied.delete(other.envelopes[0].batch.batchId);
  await assert.rejects(other.checkpoint().read(), { code: "POSTGRES_PRIMARY_CHECKPOINT_TARGET_MISMATCH" });
});

test("schema semantics and replace attempts are rejected", async (t) => {
  const f = await fixture(t);
  f.commitTarget(f.envelopes[0]);
  await f.checkpoint().advance(f.envelopes[0]);
  const db = new DatabaseSync(f.checkpointFile);
  assert.throws(() => db.exec("INSERT OR REPLACE INTO checkpoint_entries SELECT * FROM checkpoint_entries"), /CHECKPOINT_IMMUTABLE/);
  assert.throws(() => db.exec("INSERT OR REPLACE INTO checkpoint_meta SELECT * FROM checkpoint_meta"), /CHECKPOINT_IMMUTABLE/);
  db.exec("DROP TRIGGER checkpoint_entries_no_delete");
  db.exec("CREATE TRIGGER checkpoint_entries_no_delete BEFORE DELETE ON checkpoint_entries WHEN 0 BEGIN SELECT RAISE(ABORT,'CHECKPOINT_IMMUTABLE'); END");
  db.close();
  await assert.rejects(f.checkpoint().read(), { code: "POSTGRES_PRIMARY_CHECKPOINT_SCHEMA_INVALID" });
});

test("checkpoint read lock failure leaves zero progress and can be retried", async (t) => {
  const f = await fixture(t);
  f.commitTarget(f.envelopes[0]);
  const db = new DatabaseSync(f.checkpointFile);
  db.exec("CREATE TEMP TRIGGER synthetic_failure BEFORE INSERT ON checkpoint_entries BEGIN SELECT RAISE(ABORT,'synthetic'); END");
  // A second connection does not see a TEMP trigger; use an exclusive lock to force the writer failure.
  db.exec("BEGIN EXCLUSIVE");
  await assert.rejects(f.checkpoint().advance(f.envelopes[0]));
  db.exec("ROLLBACK");
  db.close();
  assert.equal(await f.checkpoint().read(), null);
  assert.equal((await f.checkpoint().advance(f.envelopes[0])).outboxSequence, 1);
});

test("failure after checkpoint INSERT rolls back and restart sees zero progress", async (t) => {
  const f = await fixture(t);
  f.commitTarget(f.envelopes[0]);
  const originalPrepare = DatabaseSync.prototype.prepare;
  DatabaseSync.prototype.prepare = function patchedPrepare(sql) {
    const statement = originalPrepare.call(this, sql);
    if (!String(sql).includes("INSERT INTO checkpoint_entries(")) return statement;
    return { run(...args) { statement.run(...args); throw new Error("synthetic-after-insert-failure"); } };
  };
  try {
    await assert.rejects(f.checkpoint().advance(f.envelopes[0]), /synthetic-after-insert-failure/);
  } finally { DatabaseSync.prototype.prepare = originalPrepare; }
  const reopened = f.checkpoint();
  assert.equal(await reopened.read(), null);
  const db = new DatabaseSync(f.checkpointFile, { readOnly: true });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM checkpoint_entries").get().n, 0);
  db.close();
  assert.equal((await reopened.advance(f.envelopes[0])).outboxSequence, 1);
});

test("competing advances serialize at checkpoint CAS and a rejected writer leaves one row", async (t) => {
  const f = await fixture(t);
  f.commitTarget(f.envelopes[0]);
  let arrivals = 0;
  let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  f.setTargetGate(async () => { arrivals += 1; if (arrivals === 2) release(); await barrier; });
  const outcomes = await Promise.allSettled([
    f.checkpoint().advance(f.envelopes[0]), f.checkpoint().advance(f.envelopes[0])
  ]);
  assert.equal(outcomes.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((item) => item.status === "rejected").length, 1);
  assert.equal(outcomes.find((item) => item.status === "rejected").reason.code,
    "POSTGRES_PRIMARY_CHECKPOINT_CONFLICT");
  f.setTargetGate(null);
  assert.equal((await f.checkpoint().read()).outboxSequence, 1);
  const db = new DatabaseSync(f.checkpointFile, { readOnly: true });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM checkpoint_entries").get().n, 1);
  db.close();
});
