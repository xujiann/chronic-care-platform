"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { applySqliteMigrations, readSqliteSchemaFingerprint } = require("../src/platform/storage/sqlite-migrations");
const { initializeSqliteOutboxSourceIdentity } = require("../src/platform/storage/sqlite-outbox-source-identity");
const { commitSqliteOutboxTransaction, commitSqliteBoundOutboxTransaction,
  loadBoundSqliteOutboxBatches, resolveBrandedSourceEnvelope } = require("../src/platform/storage/sqlite-outbox-commit-receipt");

function fixture(t, version) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "source-identity-"));
  const file = path.join(directory, "synthetic.sqlite");
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL");
  applySqliteMigrations(db, version ? { targetVersion: version } : {});
  t.after(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { db, file };
}
function input(version = 1) {
  return { entries: [["settings", { synthetic: version }]], expectedVersions: { settings: version - 1 }, sourceEvent: "synthetic-identity-test" };
}
function snapshot(db) {
  return ["state_collections", "postgres_sync_outbox", "postgres_sync_commit_receipts", "storage_events", "source_identity", "source_genesis"]
    .map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
}

test("v19 upgrades v18 structurally without identities or historical ledger mutation", (t) => {
  const { db } = fixture(t, 18), fresh = fixture(t);
  const previous = db.prepare("SELECT * FROM schema_migrations ORDER BY version").all();
  assert.equal(applySqliteMigrations(db).applied, 1);
  assert.deepEqual(db.prepare("SELECT * FROM schema_migrations WHERE version<=18 ORDER BY version").all(), previous);
  assert.equal(db.prepare("SELECT count(*) n FROM source_identity").get().n, 0);
  assert.equal(db.prepare("SELECT count(*) n FROM source_genesis").get().n, 0);
  assert.equal(readSqliteSchemaFingerprint(db), readSqliteSchemaFingerprint(fresh.db));
  assert.equal(applySqliteMigrations(db).applied, 0);
});

test("explicit identity survives connections and genesis is committed with the first full batch", (t) => {
  const { db, file } = fixture(t);
  const identity = initializeSqliteOutboxSourceIdentity(db);
  assert.equal(identity.genesis, null);
  assert.throws(() => initializeSqliteOutboxSourceIdentity(db), { code: "SQLITE_OUTBOX_SOURCE_NOT_EMPTY" });
  assert.deepEqual(loadBoundSqliteOutboxBatches(file), []);
  const before = snapshot(db);
  db.function("observe_identity", () => {
    const reader = new DatabaseSync(file, { readOnly: true });
    try { assert.deepEqual(snapshot(reader), before); } finally { reader.close(); }
    return 0;
  });
  db.exec("CREATE TEMP TRIGGER observe BEFORE INSERT ON source_genesis BEGIN SELECT observe_identity(); END");
  const committed = commitSqliteBoundOutboxTransaction(db, input());
  const envelope = loadBoundSqliteOutboxBatches(file)[0];
  assert.equal(envelope.sourceIdentity.sourceInstanceId, identity.sourceInstanceId);
  assert.deepEqual(envelope.sourceIdentity.genesis, { outboxSequence: committed.commitment.outboxSequence,
    batchId: committed.batch.batchId, chainHash: committed.batch.chainHash });
  assert.equal(resolveBrandedSourceEnvelope(envelope), envelope);
  assert.equal(resolveBrandedSourceEnvelope(envelope), envelope);
  assert.ok(Object.isFrozen(envelope.batch.changes[0]));
  for (const forged of [committed, { ...envelope }, structuredClone(envelope), JSON.parse(JSON.stringify(envelope))]) {
    assert.throws(() => resolveBrandedSourceEnvelope(forged), { code: "SQLITE_OUTBOX_SOURCE_ENVELOPE_INVALID" });
  }
  db.exec("DROP TRIGGER observe");
  commitSqliteOutboxTransaction(db, input(2));
  assert.deepEqual(loadBoundSqliteOutboxBatches(file)[1].sourceIdentity, envelope.sourceIdentity);
});

test("first genesis insertion failure rolls back all new facts but retains initialized identity", (t) => {
  const { db } = fixture(t);
  initializeSqliteOutboxSourceIdentity(db);
  const before = snapshot(db);
  db.exec("CREATE TEMP TRIGGER fail_genesis BEFORE INSERT ON source_genesis BEGIN SELECT RAISE(ABORT,'synthetic'); END");
  assert.throws(() => commitSqliteBoundOutboxTransaction(db, input()), { code: "SQLITE_OUTBOX_RECEIPT_STORAGE_FAILED" });
  assert.deepEqual(snapshot(db), before);
});

test("historical legacy state cannot be initialized or certified by the bound path", (t) => {
  const { db, file } = fixture(t);
  commitSqliteOutboxTransaction(db, input());
  const before = snapshot(db);
  assert.throws(() => initializeSqliteOutboxSourceIdentity(db), { code: "SQLITE_OUTBOX_SOURCE_NOT_EMPTY" });
  assert.throws(() => commitSqliteBoundOutboxTransaction(db, input(2)), { code: "SQLITE_OUTBOX_SOURCE_IDENTITY_INVALID" });
  assert.throws(() => loadBoundSqliteOutboxBatches(file), { code: "SQLITE_OUTBOX_SOURCE_IDENTITY_INVALID" });
  assert.deepEqual(snapshot(db), before);
});

for (const table of ["source_identity", "source_genesis"]) {
  test(`${table} rejects update delete and replacement`, (t) => {
    const { db } = fixture(t);
    initializeSqliteOutboxSourceIdentity(db);
    commitSqliteBoundOutboxTransaction(db, input());
    const before = snapshot(db);
    assert.throws(() => db.exec(`UPDATE ${table} SET singleton=1`), /IMMUTABLE/);
    assert.throws(() => db.exec(`DELETE FROM ${table}`), /IMMUTABLE/);
    assert.throws(() => db.exec(`INSERT OR REPLACE INTO ${table} SELECT * FROM ${table}`), /IMMUTABLE/);
    assert.deepEqual(snapshot(db), before);
  });
}

for (const damage of [
  "DROP TRIGGER source_identity_no_update",
  "DROP TABLE source_genesis",
  "UPDATE schema_migrations SET checksum='bad' WHERE version=19"
]) test("partial source schema or ledger drift blocks both loaders and old write entry", (t) => {
  const { db, file } = fixture(t);
  initializeSqliteOutboxSourceIdentity(db);
  commitSqliteBoundOutboxTransaction(db, input());
  db.exec(damage);
  assert.throws(() => loadBoundSqliteOutboxBatches(file), { code: "SQLITE_OUTBOX_SOURCE_SCHEMA_INVALID" });
  assert.throws(() => commitSqliteOutboxTransaction(db, input(2)), { code: "SQLITE_OUTBOX_SOURCE_SCHEMA_INVALID" });
});

test("two independently initialized sources have distinct persistent identity", (t) => {
  const first = fixture(t), second = fixture(t);
  const a = initializeSqliteOutboxSourceIdentity(first.db), b = initializeSqliteOutboxSourceIdentity(second.db);
  assert.notEqual(a.sourceInstanceId, b.sourceInstanceId);
});

for (const scenario of [
  { name: "source UUID", table: "source_identity", sql: "UPDATE source_identity SET source_instance_id='invalid'", code: "SQLITE_OUTBOX_SOURCE_IDENTITY_INVALID" },
  { name: "source timestamp", table: "source_identity", sql: "UPDATE source_identity SET created_at='2026-02-30T00:00:00.000Z'", code: "SQLITE_OUTBOX_SOURCE_IDENTITY_INVALID" },
  { name: "genesis source identity", table: "source_genesis", sql: "UPDATE source_genesis SET source_instance_id='00000000-0000-4000-8000-000000000001'", code: "SQLITE_OUTBOX_SOURCE_GENESIS_INVALID" },
  { name: "genesis batch ID", table: "source_genesis", sql: "UPDATE source_genesis SET batch_id='pgsync-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'", code: "SQLITE_OUTBOX_RECEIPT_SOURCE_GENESIS_INVALID" },
  { name: "genesis chain hash", table: "source_genesis", sql: "UPDATE source_genesis SET chain_hash='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'", code: "SQLITE_OUTBOX_RECEIPT_SOURCE_GENESIS_INVALID" },
  { name: "genesis points at second batch", table: "source_genesis", sql: `UPDATE source_genesis SET
    outbox_sequence=(SELECT sequence FROM postgres_sync_outbox ORDER BY sequence DESC LIMIT 1),
    batch_id=(SELECT batch_id FROM postgres_sync_outbox ORDER BY sequence DESC LIMIT 1),
    chain_hash=(SELECT chain_hash FROM postgres_sync_outbox ORDER BY sequence DESC LIMIT 1)`, code: "SQLITE_OUTBOX_RECEIPT_SOURCE_GENESIS_INVALID" },
  { name: "genesis missing", table: "source_genesis", operation: "delete", sql: "DELETE FROM source_genesis", code: "SQLITE_OUTBOX_RECEIPT_SOURCE_GENESIS_INVALID" }
]) test(`intact source schema rejects corrupted ${scenario.name} without any writes`, (t) => {
  const { db, file } = fixture(t);
  initializeSqliteOutboxSourceIdentity(db);
  commitSqliteBoundOutboxTransaction(db, input());
  commitSqliteBoundOutboxTransaction(db, input(2));
  const schemaBefore = readSqliteSchemaFingerprint(db);
  const trigger = `${scenario.table}_no_${scenario.operation || "update"}`;
  const definition = db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").get(trigger).sql;
  // Deliberately corrupt only this disposable fixture, then restore byte-identical
  // protection so a structural check cannot accidentally satisfy this test.
  db.exec("PRAGMA foreign_keys=OFF");
  db.exec(`DROP TRIGGER ${trigger}`);
  db.exec(scenario.sql);
  db.exec(definition);
  db.exec("PRAGMA foreign_keys=ON");
  assert.equal(readSqliteSchemaFingerprint(db), schemaBefore);
  const before = snapshot(db);
  assert.throws(() => loadBoundSqliteOutboxBatches(file), { code: scenario.code });
  assert.deepEqual(snapshot(db), before);
  assert.throws(() => commitSqliteOutboxTransaction(db, input(3)), { code: scenario.code });
  assert.deepEqual(snapshot(db), before);
});
