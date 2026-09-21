"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { applySqliteMigrations, readSqliteSchemaFingerprint } = require("../src/platform/storage/sqlite-migrations");
const { enqueuePostgresSyncBatch } = require("../postgres-runtime-sync");
const { canonicalStringify } = require("../scripts/postgres-migration-package");
const { commitSqliteOutboxTransaction, loadCommittedSqliteOutboxBatches } = require("../src/platform/storage/sqlite-outbox-commit-receipt");

const TABLES = ["state_collections", "postgres_sync_outbox", "postgres_sync_commit_receipts", "storage_events"];
const code = (name) => ({ code: `SQLITE_OUTBOX_RECEIPT_${name}` });
const sha = (text) => createHash("sha256").update(text).digest("hex");
function fixture(t, targetVersion) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sqlite-receipt-test-"));
  const file = path.join(directory, "source.sqlite");
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL");
  applySqliteMigrations(db, targetVersion ? { targetVersion } : {});
  t.after(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { db, file };
}
function snapshot(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try { return Object.fromEntries(TABLES.map((name) => [name, db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()])); }
  finally { db.close(); }
}
function request(value = 1, version = 0) {
  return { entries: [["dataQualityIssues", [{ id: "synthetic-issue", version: value }]]], expectedVersions: { dataQualityIssues: version }, sourceEvent: "receipt-fixture" };
}
function commit(db, value = 1, version = 0) { return commitSqliteOutboxTransaction(db, request(value, version)); }
function cursor(row) {
  return { outboxSequence: row.commitment.outboxSequence, batchId: row.batch.batchId, payloadSha256: row.batch.payloadSha256, chainHash: row.batch.chainHash };
}

test("formal v17 file upgrades without changing historical ledger or fabricating receipts", (t) => {
  const { db, file } = fixture(t, 17);
  const ledger = db.prepare("SELECT * FROM schema_migrations ORDER BY version").all();
  enqueuePostgresSyncBatch(db, [{ collection: "dataQualityIssues", operation: "upsert", sourceVersion: 1, payload: [] }]);
  const history = db.prepare("SELECT * FROM postgres_sync_outbox").all();
  assert.equal(applySqliteMigrations(db).applied, 1);
  assert.deepEqual(db.prepare("SELECT * FROM schema_migrations WHERE version<=17 ORDER BY version").all(), ledger);
  assert.deepEqual(db.prepare("SELECT * FROM postgres_sync_outbox").all(), history);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM postgres_sync_commit_receipts").get().n, 0);
  assert.throws(() => loadCommittedSqliteOutboxBatches(file), code("MISSING"));
  const upgraded = db.prepare("SELECT * FROM schema_migrations ORDER BY version").all();
  assert.equal(applySqliteMigrations(db).applied, 0);
  assert.deepEqual(db.prepare("SELECT * FROM schema_migrations ORDER BY version").all(), upgraded);
  const fresh = fixture(t);
  assert.equal(readSqliteSchemaFingerprint(db), readSqliteSchemaFingerprint(fresh.db));
});

test("another SQLite connection sees all four facts only after actual COMMIT", (t) => {
  const { db, file } = fixture(t);
  const before = snapshot(file);
  let observed = 0;
  db.function("test_receipt_visibility", () => {
    observed += 1;
    assert.deepEqual(snapshot(file), before);
    assert.deepEqual(loadCommittedSqliteOutboxBatches(file), []);
    return 0;
  });
  db.exec("CREATE TEMP TRIGGER observe_commit BEFORE INSERT ON storage_events BEGIN SELECT test_receipt_visibility(); END");
  const result = commit(db);
  assert.equal(observed, 1);
  const after = snapshot(file);
  for (const table of TABLES) assert.equal(after[table].length, before[table].length + 1, table);
  assert.deepEqual(loadCommittedSqliteOutboxBatches(file), [result]);
  assert.equal(result.commitment.state, "committed");
  assert.equal(result.commitment.source, "sqlite-transactional-outbox");
  assert.match(result.commitment.sourceTransactionId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(new Date(result.commitment.committedAt).toISOString(), result.commitment.committedAt);
  assert.equal(result.commitment.committedAt, after.postgres_sync_commit_receipts[0].recorded_at);
});

for (const table of TABLES) test(`failure inserting ${table} rolls back every durable fact`, (t) => {
  const { db, file } = fixture(t);
  const before = snapshot(file);
  db.exec(`CREATE TEMP TRIGGER reject_write BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'receipt-step-fault'); END`);
  assert.throws(() => commit(db), (error) => error.code === "SQLITE_OUTBOX_RECEIPT_STORAGE_FAILED" && !error.message.includes("receipt-step-fault"));
  assert.deepEqual(snapshot(file), before);
  db.exec("DROP TRIGGER reject_write");
  commit(db);
  assert.equal(loadCommittedSqliteOutboxBatches(file).length, 1);
});

test("deferred constraint failure at COMMIT rolls back state outbox receipt and storage event", (t) => {
  const { db, file } = fixture(t);
  db.exec(`CREATE TABLE test_parent(id INTEGER PRIMARY KEY);
    CREATE TABLE test_deferred(id INTEGER REFERENCES test_parent(id) DEFERRABLE INITIALLY DEFERRED);
    CREATE TRIGGER fail_commit AFTER INSERT ON storage_events BEGIN INSERT INTO test_deferred VALUES(1); END`);
  const before = snapshot(file);
  assert.throws(() => commit(db), code("STORAGE_FAILED"));
  assert.deepEqual(snapshot(file), before);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM test_deferred").get().n, 0);
  db.exec("DROP TRIGGER fail_commit");
  commit(db);
});

test("nested wrapper refusal does not roll back the caller transaction", (t) => {
  const { db, file } = fixture(t);
  db.exec("BEGIN");
  db.prepare("INSERT INTO storage_events(id,at,event,detail) VALUES('outer','2026-09-21T00:00:00.000Z','test','outer')").run();
  assert.throws(() => commit(db), code("TRANSACTION_REQUIRED"));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM storage_events WHERE id='outer'").get().n, 1);
  db.exec("COMMIT");
  assert.equal(snapshot(file).storage_events.length, 1);
});

for (const mutate of [
  (r) => ({ ...r, sourceTransactionId: "d60a4c87-5d0e-4f78-8daf-99eb44919c21" }),
  (r) => ({ ...r, batch: {} }), (r) => ({ ...r, receipt: {} }), (r) => ({ ...r, unknown: true }),
  (r) => ({ ...r, entries: [] }), (r) => ({ ...r, entries: [...r.entries, ...r.entries] }),
  (r) => ({ ...r, entries: [["storageMeta", {}]], expectedVersions: { storageMeta: 0 } }),
  (r) => ({ ...r, expectedVersions: { dataQualityIssues: "0" } }),
  (r) => Object.defineProperty({ ...r }, "entries", { get() { assert.fail("input getter must not execute"); }, enumerable: true }),
  (r) => ({ ...r, expectedVersions: { dataQualityIssues: 0, extra: 0 } })
]) test("wrapper rejects untrusted or malformed transaction input without writes", (t) => {
  const { db, file } = fixture(t);
  const before = snapshot(file);
  assert.throws(() => commitSqliteOutboxTransaction(db, mutate(request())), code("INVALID_INPUT"));
  assert.deepEqual(snapshot(file), before);
});

test("CAS and unchanged content cannot manufacture another receipt", (t) => {
  const { db, file } = fixture(t);
  commit(db);
  const before = snapshot(file);
  assert.throws(() => commit(db, 2, 0), code("VERSION_CONFLICT"));
  assert.throws(() => commit(db, 1, 1), code("NO_CHANGES"));
  assert.deepEqual(snapshot(file), before);
});

test("expectedVersions accessors are rejected before executing caller code", (t) => {
  const { db, file } = fixture(t);
  const before = snapshot(file);
  let executed = false;
  const expectedVersions = Object.defineProperty({}, "dataQualityIssues", {
    enumerable: true,
    get() { executed = true; return 0; }
  });
  assert.throws(() => commitSqliteOutboxTransaction(db, { ...request(), expectedVersions }), code("INVALID_INPUT"));
  assert.equal(executed, false);
  assert.deepEqual(snapshot(file), before);
});

test("loader reads all old delivery states and never changes their scheduling or payload", (t) => {
  const { db, file } = fixture(t);
  const results = [];
  for (const [index, status] of ["pending", "retry", "delivered", "failed"].entries()) {
    const row = commit(db, index + 1, index);
    results.push(row);
    db.prepare("UPDATE postgres_sync_outbox SET status=?, attempts=7, next_attempt_at='2999-01-01T00:00:00.000Z', last_error='fixture' WHERE batch_id=?").run(status, row.batch.batchId);
  }
  const before = snapshot(file);
  assert.deepEqual(loadCommittedSqliteOutboxBatches(file), results);
  assert.deepEqual(loadCommittedSqliteOutboxBatches(file, { after: cursor(results[1]), limit: 1 }), [results[2]]);
  assert.deepEqual(snapshot(file), before);
});

test("receipt-less historical prefix cannot be bypassed by a later valid cursor", (t) => {
  const { db, file } = fixture(t);
  const first = commit(db);
  const row = commit(db, 2, 1);
  db.exec("DROP TRIGGER postgres_sync_commit_receipts_no_delete");
  db.prepare("DELETE FROM postgres_sync_commit_receipts WHERE outbox_sequence=?").run(first.commitment.outboxSequence);
  assert.throws(() => loadCommittedSqliteOutboxBatches(file), code("MISSING"));
  assert.throws(() => loadCommittedSqliteOutboxBatches(file, { after: cursor(row) }), code("MISSING"));
});

test("old standalone enqueue cannot mint receipts and wrapper cannot bless historical rows", (t) => {
  const { db, file } = fixture(t);
  enqueuePostgresSyncBatch(db, [{ collection: "dataQualityIssues", operation: "upsert", sourceVersion: 1, payload: [] }]);
  const before = snapshot(file);
  assert.equal(before.postgres_sync_commit_receipts.length, 0);
  assert.throws(() => commit(db), code("MISSING"));
  assert.deepEqual(snapshot(file), before);
});

test("receipt immutability uniqueness and parent deletion protection preserve source facts", (t) => {
  const { db, file } = fixture(t);
  commit(db);
  const before = snapshot(file);
  assert.throws(() => db.exec("UPDATE postgres_sync_commit_receipts SET recorded_at=recorded_at"), /IMMUTABLE/);
  assert.throws(() => db.exec("DELETE FROM postgres_sync_commit_receipts"), /IMMUTABLE/);
  assert.throws(() => db.exec("DELETE FROM postgres_sync_outbox"), /FOREIGN KEY/);
  assert.throws(() => db.exec("INSERT INTO postgres_sync_commit_receipts SELECT * FROM postgres_sync_commit_receipts"), /IMMUTABLE|UNIQUE/);
  assert.deepEqual(snapshot(file), before);
});

test("partial upsert retains unrelated state and complete multi-collection batch bytes", (t) => {
  const { db, file } = fixture(t);
  db.prepare("INSERT INTO state_collections(key,payload,updated_at,version) VALUES('syntheticUnrelated','[1]','2026-09-21T00:00:00.000Z',3)").run();
  const input = { entries: [["dataQualityIssues", [{ id: "one" }]], ["settings", { synthetic: true }]], expectedVersions: { dataQualityIssues: 0, settings: 0 }, sourceEvent: "synthetic-multi" };
  const row = commitSqliteOutboxTransaction(db, input);
  assert.deepEqual(row.batch.changes.map((change) => change.collection).sort(), ["dataQualityIssues", "settings"]);
  assert.equal(db.prepare("SELECT version FROM state_collections WHERE key='syntheticUnrelated'").get().version, 3);
  assert.equal(db.prepare("SELECT payload FROM postgres_sync_outbox").get().payload, row.batch.payload);
  assert.deepEqual(loadCommittedSqliteOutboxBatches(file)[0], row);
});

test("numeric sequence gaps are allowed only with intact bound chain succession", (t) => {
  const { db, file } = fixture(t);
  const first = commit(db);
  db.prepare("UPDATE sqlite_sequence SET seq=40 WHERE name='postgres_sync_outbox'").run();
  const second = commit(db, 2, 1);
  assert.equal(second.commitment.outboxSequence, 41);
  assert.equal(second.batch.previousChainHash, first.batch.chainHash);
  assert.deepEqual(loadCommittedSqliteOutboxBatches(file, { after: cursor(first) }), [second]);
  for (const mutate of [
    (a) => ({ ...a, outboxSequence: String(a.outboxSequence) }),
    (a) => ({ ...a, outboxSequence: Number.MAX_SAFE_INTEGER + 1 }),
    (a) => ({ ...a, batchId: `${a.batchId} ` }),
    (a) => ({ ...a, payloadSha256: "f".repeat(64) }),
    (a) => ({ ...a, chainHash: "f".repeat(64) }),
    (a) => ({ ...a, unknown: 1 })
  ]) assert.throws(() => loadCommittedSqliteOutboxBatches(file, { after: mutate(cursor(first)) }), code("CURSOR_INVALID"));
});

for (const [column, value] of [
  ["source_transaction_id", " d60a4c87-5d0e-4f78-8daf-99eb44919c21"],
  ["source_transaction_id", "d60a4c87-5d0e-4f78-8daf-99eb44919c21-extra"],
  ["source_transaction_id", "D60A4C87-5D0E-4F78-8DAF-99EB44919C21"],
  ["recorded_at", "2026-02-30T00:00:00.000Z"], ["recorded_at", "2026-09-21T00:00:00+00:00"],
  ["payload_sha256", "A".repeat(64)], ["chain_hash", "0".repeat(64)], ["batch_id", "wrong-batch"]
]) test(`loader rejects damaged receipt ${column} without repair`, (t) => {
  const { db, file } = fixture(t);
  commit(db);
  // Corrupt only the disposable fixture to exercise loader defense behind immutable storage.
  db.exec("DROP TRIGGER postgres_sync_commit_receipts_no_update; PRAGMA ignore_check_constraints=ON");
  db.prepare(`UPDATE postgres_sync_commit_receipts SET ${column}=?`).run(value);
  const before = snapshot(file);
  assert.throws(() => loadCommittedSqliteOutboxBatches(file), code("INTEGRITY"));
  assert.deepEqual(snapshot(file), before);
});

for (const mutate of [
  (e) => { e.extra = true; }, (e) => { e.formatVersion = 2; },
  (e) => { e.changes[0].unknown = true; }, (e) => { e.changes[0].sourceVersion = "1"; },
  (e) => { e.changes[0].sourceVersion = 0; }, (e) => { e.changes[0].operation = "unknown"; },
  (e) => { e.changes[0].sourceVersion = 7; },
  (e) => { e.changes[0] = null; },
  (e) => { e.changes.push({ ...e.changes[0] }); }, (e) => { e.changes[0].payloadSha256 = "0".repeat(64); }
]) test("loader rejects rehashed malformed envelope and change members", (t) => {
  const { db, file } = fixture(t);
  const result = commit(db);
  const envelope = JSON.parse(result.batch.payload); mutate(envelope);
  const payload = canonicalStringify(envelope), digest = sha(payload), chain = sha(`:${digest}`), batchId = `pgsync-${chain.slice(0, 32)}`;
  db.exec("DROP TRIGGER postgres_sync_commit_receipts_no_update");
  db.prepare("UPDATE postgres_sync_outbox SET payload=?,payload_sha256=?,chain_hash=?,batch_id=?").run(payload, digest, chain, batchId);
  db.prepare("UPDATE postgres_sync_commit_receipts SET payload_sha256=?,chain_hash=?,batch_id=?").run(digest, chain, batchId);
  assert.throws(() => loadCommittedSqliteOutboxBatches(file), code("INTEGRITY"));
});

test("orphan receipt is rejected rather than appearing as an empty source", (t) => {
  const { db, file } = fixture(t);
  commit(db);
  db.exec("PRAGMA foreign_keys=OFF; DELETE FROM postgres_sync_outbox");
  assert.throws(() => loadCommittedSqliteOutboxBatches(file), code("INTEGRITY"));
});

for (const mutation of [
  "UPDATE state_collections SET version=7 WHERE key='dataQualityIssues'",
  "UPDATE state_collections SET payload='[]' WHERE key='dataQualityIssues'",
  "UPDATE state_collections SET payload='{' WHERE key='dataQualityIssues'"
]) test("wrapper refuses preexisting state divergence from committed history", (t) => {
  const { db, file } = fixture(t);
  commit(db);
  db.exec(mutation);
  const before = snapshot(file);
  const version = db.prepare("SELECT version FROM state_collections WHERE key='dataQualityIssues'").get().version;
  assert.throws(() => commit(db, 2, version), code("INTEGRITY"));
  assert.deepEqual(snapshot(file), before);
});

test("rehashing does not authorize a cross-batch collection version jump", (t) => {
  const { db, file } = fixture(t);
  const first = commit(db);
  const second = commit(db, 2, 1);
  const envelope = JSON.parse(second.batch.payload);
  envelope.changes[0].sourceVersion = 7;
  const payload = canonicalStringify(envelope), digest = sha(payload), chain = sha(`${first.batch.chainHash}:${digest}`), batchId = `pgsync-${chain.slice(0, 32)}`;
  db.exec("DROP TRIGGER postgres_sync_commit_receipts_no_update");
  db.prepare("UPDATE postgres_sync_outbox SET payload=?,payload_sha256=?,chain_hash=?,batch_id=? WHERE sequence=?").run(payload, digest, chain, batchId, second.commitment.outboxSequence);
  db.prepare("UPDATE postgres_sync_commit_receipts SET payload_sha256=?,chain_hash=?,batch_id=? WHERE outbox_sequence=?").run(digest, chain, batchId, second.commitment.outboxSequence);
  assert.throws(() => loadCommittedSqliteOutboxBatches(file, { after: cursor(first) }), code("INTEGRITY"));
});

for (const version of [1, 7]) test(`unproven preexisting state version ${version} cannot acquire a fresh receipt`, (t) => {
  const { db, file } = fixture(t);
  db.prepare("INSERT INTO state_collections(key,payload,updated_at,version) VALUES('dataQualityIssues','[]','2026-09-21T00:00:00.000Z',?)").run(version);
  const before = snapshot(file);
  assert.throws(() => commit(db, version + 1, version), code("INTEGRITY"));
  assert.deepEqual(snapshot(file), before);
});

test("a missing current collection cannot restart an existing committed version history", (t) => {
  const { db, file } = fixture(t);
  commit(db);
  db.exec("DELETE FROM state_collections WHERE key='dataQualityIssues'");
  const before = snapshot(file);
  assert.throws(() => commit(db, 2, 0), code("INTEGRITY"));
  assert.deepEqual(snapshot(file), before);
});

test("loader rejects unknown options and non-integer or unbounded page limits", (t) => {
  const { file } = fixture(t);
  for (const options of [{ unknown: true }, { limit: "1" }, { limit: 0 }, { limit: 101 }, { limit: NaN }, { limit: 1.5 }]) {
    assert.throws(() => loadCommittedSqliteOutboxBatches(file, options), code("INVALID_INPUT"));
  }
});

test("a rehashed batch disconnected from its predecessor cannot pass a bound cursor", (t) => {
  const { db, file } = fixture(t);
  const first = commit(db);
  const second = commit(db, 2, 1);
  const chain = sha(`:${second.batch.payloadSha256}`), batchId = `pgsync-${chain.slice(0, 32)}`;
  db.exec("DROP TRIGGER postgres_sync_commit_receipts_no_update");
  db.prepare("UPDATE postgres_sync_outbox SET previous_chain_hash='',chain_hash=?,batch_id=? WHERE sequence=?").run(chain, batchId, second.commitment.outboxSequence);
  db.prepare("UPDATE postgres_sync_commit_receipts SET chain_hash=?,batch_id=? WHERE outbox_sequence=?").run(chain, batchId, second.commitment.outboxSequence);
  const before = snapshot(file);
  assert.throws(() => loadCommittedSqliteOutboxBatches(file, { after: cursor(first) }), code("INTEGRITY"));
  assert.deepEqual(snapshot(file), before);
});
