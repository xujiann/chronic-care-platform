"use strict";

// Real SQLite source and in-memory target only: this is not live PostgreSQL evidence.
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { applySqliteMigrations } = require("../src/platform/storage/sqlite-migrations");
const { commitSqliteOutboxTransaction, loadCommittedSqliteOutboxBatches } = require("../src/platform/storage/sqlite-outbox-commit-receipt");
const { buildPostgresPrimaryStorageConfig, createPostgresPrimaryStorageContract } = require("../src/platform/storage/postgres-primary-storage-contract");
const { createMemoryPostgresPrimaryDriver } = require("../src/platform/storage/memory-postgres-primary-driver");

function storage(driver) {
  // Synthetic configuration merely opens the existing library contract gate.
  // No pool, relay, worker or production endpoint is constructed.
  const config = buildPostgresPrimaryStorageConfig({
    POSTGRES_PRIMARY_STORAGE_MODE: "shadow", DATABASE_URL: "postgresql://fixture.invalid/synthetic",
    POSTGRES_SSL_MODE: "verify-full", POSTGRES_SCHEMA_EVIDENCE_ID: "synthetic-schema",
    POSTGRES_MIGRATION_EVIDENCE_ID: "synthetic-migration"
  });
  return createPostgresPrimaryStorageContract({ config, driver });
}

function source(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "primary-receipt-replay-"));
  const file = path.join(directory, "synthetic.sqlite");
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL");
  applySqliteMigrations(db);
  t.after(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const first = commitSqliteOutboxTransaction(db, {
    entries: [["dataQualityIssues", [{ id: "synthetic-only", revision: 1 }]], ["settings", { synthetic: 1 }]],
    expectedVersions: { dataQualityIssues: 0, settings: 0 }, sourceEvent: "synthetic-replay-test"
  });
  const second = commitSqliteOutboxTransaction(db, {
    entries: [["dataQualityIssues", [{ id: "synthetic-only", revision: 2 }]], ["settings", { synthetic: 2 }]],
    expectedVersions: { dataQualityIssues: 1, settings: 1 }, sourceEvent: "synthetic-replay-test"
  });
  const loaded = loadCommittedSqliteOutboxBatches(file);
  assert.deepEqual(loaded, [first, second]);
  return { db, file, loaded };
}

function sourceFacts(db) {
  return ["state_collections", "postgres_sync_outbox", "postgres_sync_commit_receipts", "storage_events"]
    .map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
}

test("formal SQLite receipts apply first v1 and next v2 to memory target and replay without writes (not live PG)", async (t) => {
  const { db, file, loaded } = source(t);
  const original = sourceFacts(db);
  const inner = createMemoryPostgresPrimaryDriver();
  let writes = 0;
  const expectedVersions = [];
  const driver = { transaction(options, operation) {
    return inner.transaction(options, (tx) => operation({ ...tx,
      applyCollectionChange: async (change, opts) => {
        writes++; expectedVersions.push(opts.expectedVersion); return tx.applyCollectionChange(change, opts);
      },
      recordAppliedBatch: async (...args) => { writes++; return tx.recordAppliedBatch(...args); }
    }));
  } };
  const target = storage(driver);
  for (const item of loaded) {
    const result = await target.applyCommittedOutbox(item.batch, { commitment: item.commitment });
    assert.equal(result.status, "applied");
    assert.equal(result.appliedChanges, 2);
    assert.equal(result.productionPrimary, false);
    assert.equal(result.runtimeCutoverEnabled, false);
    const before = inner.snapshot(), count = writes;
    assert.equal((await target.applyCommittedOutbox(item.batch, { commitment: item.commitment })).status, "duplicate");
    assert.equal(writes, count);
    assert.deepEqual(inner.snapshot(), before);
  }
  assert.deepEqual(expectedVersions, [-1, -1, 1, 1]);
  assert.deepEqual(inner.snapshot().collections.map((row) => row.sourceVersion), [2, 2]);
  assert.equal(inner.snapshot().batches.length, 2);
  assert.deepEqual(loadCommittedSqliteOutboxBatches(file), loaded);
  assert.deepEqual(sourceFacts(db), original);
});

for (const failureAt of ["second-collection", "batch-ledger"]) {
  test(`real SQLite receipt target ${failureAt} fault rolls back the entire memory transaction (not live PG)`, async (t) => {
    const { db, loaded } = source(t);
    const sourceBefore = sourceFacts(db);
    const inner = createMemoryPostgresPrimaryDriver();
    await storage(inner).applyCommittedOutbox(loaded[0].batch, { commitment: loaded[0].commitment });
    const before = inner.snapshot();
    let applied = 0;
    const driver = { transaction(options, operation) {
      return inner.transaction(options, (tx) => operation({ ...tx,
        applyCollectionChange: async (...args) => {
          applied++;
          if (failureAt === "second-collection" && applied === 2) throw new Error("synthetic-target-fault");
          return tx.applyCollectionChange(...args);
        },
        recordAppliedBatch: async (...args) => {
          if (failureAt === "batch-ledger") throw new Error("synthetic-target-fault");
          return tx.recordAppliedBatch(...args);
        }
      }));
    } };
    await assert.rejects(() => storage(driver).applyCommittedOutbox(loaded[1].batch, {
      commitment: loaded[1].commitment
    }), /synthetic-target-fault/);
    assert.equal(applied, 2);
    assert.equal(inner.history.at(-1).outcome, "rolled-back");
    assert.deepEqual(inner.snapshot(), before);
    assert.deepEqual(sourceFacts(db), sourceBefore);
    assert.equal((await storage(inner).applyCommittedOutbox(loaded[1].batch, {
      commitment: loaded[1].commitment
    })).status, "applied");
  });
}
