const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  applyPostgresSyncBatch,
  buildCollectionChanges,
  buildCollectionSnapshotChanges,
  buildPostgresSyncBatch,
  comparePostgresShadowState,
  enqueuePostgresSyncBatch,
  enqueuePostgresSyncBaseline,
  loadPendingPostgresSyncBatches,
  loadSqliteCollectionState,
  markPostgresSyncBatch,
  postgresPoolConfig,
  readLatestPostgresReconciliation,
  readPostgresSyncStatus,
  runPostgresShadowReconciliation,
  runPostgresSyncWorker,
  validatePostgresSyncBatch
} = require("../postgres-runtime-sync");
const { parseArgs: parseWorkerArgs } = require("../scripts/postgres-sync-worker");
const { parseArgs: parseReconcileArgs, renderMarkdown } = require("../scripts/postgres-shadow-reconcile");

function createOutboxDatabase(file) {
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE postgres_sync_outbox (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      payload TEXT NOT NULL,
      payload_sha256 TEXT NOT NULL,
      previous_chain_hash TEXT NOT NULL DEFAULT '',
      chain_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT NOT NULL DEFAULT '',
      next_attempt_at TEXT NOT NULL,
      delivered_at TEXT
    );
    CREATE TABLE state_collections (
      key TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      version INTEGER NOT NULL
    );
    CREATE TABLE postgres_sync_reconciliations (
      run_id TEXT PRIMARY KEY,
      checked_at TEXT NOT NULL,
      status TEXT NOT NULL,
      local_collections INTEGER NOT NULL DEFAULT 0,
      remote_collections INTEGER NOT NULL DEFAULT 0,
      matched INTEGER NOT NULL DEFAULT 0,
      mismatched INTEGER NOT NULL DEFAULT 0,
      missing_remote INTEGER NOT NULL DEFAULT 0,
      unexpected_remote INTEGER NOT NULL DEFAULT 0,
      version_mismatches INTEGER NOT NULL DEFAULT 0,
      digest_mismatches INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      error_code TEXT NOT NULL DEFAULT '',
      detail_json TEXT NOT NULL DEFAULT '[]'
    );
  `);
  return db;
}

test("PostgreSQL sync batches contain only changed collections and preserve integrity", () => {
  const existing = [{ key: "residents", payload: JSON.stringify([{ id: "r1", name: "Before" }]), version: 3 }];
  const changes = buildCollectionChanges(existing, [
    ["residents", [{ id: "r1", name: "After" }]],
    ["settings", { enabled: true }]
  ]);
  const batch = buildPostgresSyncBatch(changes, { createdAt: "2026-07-12T00:00:00.000Z" });
  assert.deepEqual(changes.map((item) => item.collection), ["residents", "settings"]);
  assert.equal(changes.find((item) => item.collection === "residents").sourceVersion, 4);
  assert.equal(validatePostgresSyncBatch(batch).ok, true);
  assert.doesNotMatch(batch.payload, /DATABASE_URL|postgres:\/\//);
});

test("SQLite outbox chains batches and tracks delivery state", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "postgres-outbox-test-"));
  const sqliteFile = path.join(dir, "outbox.sqlite");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const db = createOutboxDatabase(sqliteFile);
  const first = enqueuePostgresSyncBatch(db, [{ collection: "residents", operation: "upsert", sourceVersion: 1, payload: [{ id: "r1" }] }], { createdAt: "2026-07-12T00:00:00.000Z" });
  const second = enqueuePostgresSyncBatch(db, [{ collection: "tasks", operation: "delete", sourceVersion: 2 }], { createdAt: "2026-07-12T00:01:00.000Z" });
  db.close();
  assert.equal(second.previousChainHash, first.chainHash);
  assert.equal(loadPendingPostgresSyncBatches(sqliteFile).length, 2);
  markPostgresSyncBatch(sqliteFile, first.batchId, { delivered: true, at: "2026-07-12T00:02:00.000Z" });
  const status = readPostgresSyncStatus(sqliteFile);
  assert.equal(status.delivered, 1);
  assert.equal(status.pending, 1);
});

test("PostgreSQL baseline bootstrap snapshots every collection once without storage metadata", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "postgres-baseline-test-"));
  const sqliteFile = path.join(dir, "outbox.sqlite");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const db = createOutboxDatabase(sqliteFile);
  const insert = db.prepare("INSERT INTO state_collections (key, payload, version) VALUES (?, ?, ?)");
  insert.run("residents", JSON.stringify([{ name: "Resident", id: "r1" }]), 4);
  insert.run("settings", JSON.stringify({ enabled: true }), 2);
  insert.run("storageMeta", JSON.stringify({ engine: "sqlite" }), 9);
  db.close();

  const result = enqueuePostgresSyncBaseline(sqliteFile, { createdAt: "2026-07-12T01:00:00.000Z" });
  assert.deepEqual({ enqueued: result.enqueued, collections: result.collections }, { enqueued: true, collections: 2 });
  const [batch] = loadPendingPostgresSyncBatches(sqliteFile);
  assert.equal(JSON.parse(batch.payload).sourceEvent, "baseline-snapshot");
  assert.deepEqual(batch.changes.map((item) => [item.collection, item.sourceVersion]), [["residents", 4], ["settings", 2]]);
  assert.equal(enqueuePostgresSyncBaseline(sqliteFile).reason, "outbox-not-empty");
});

test("PostgreSQL shadow comparison reports version digest and presence differences without payloads", () => {
  const local = buildCollectionSnapshotChanges([
    { key: "matched", payload: JSON.stringify({ id: 1 }), version: 2 },
    { key: "changed", payload: JSON.stringify({ id: 2 }), version: 3 },
    { key: "missing", payload: JSON.stringify({ id: 3 }), version: 1 }
  ]).map((item) => ({ collection: item.collection, sourceVersion: item.sourceVersion, payloadSha256: item.payloadSha256 }));
  const matched = local.find((item) => item.collection === "matched");
  const result = comparePostgresShadowState(local, [
    { ...matched, batchId: "b1" },
    { collection: "changed", sourceVersion: 2, payloadSha256: "0".repeat(64), batchId: "b2" },
    { collection: "unexpected", sourceVersion: 1, payloadSha256: "1".repeat(64), batchId: "b3" }
  ]);
  assert.equal(result.matched, 1);
  assert.equal(result.mismatched, 3);
  assert.equal(result.versionMismatches, 1);
  assert.equal(result.digestMismatches, 1);
  assert.equal(result.missingRemote, 1);
  assert.equal(result.unexpectedRemote, 1);
  assert.equal(JSON.stringify(result).includes('"id":'), false);
});

test("PostgreSQL apply uses a transaction and treats duplicate batches as delivered", async () => {
  const batch = buildPostgresSyncBatch([{ collection: "residents", operation: "upsert", sourceVersion: 1, payload: [{ id: "r1" }] }]);
  const queries = [];
  const client = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (/RETURNING batch_id/.test(sql)) return { rowCount: 1, rows: [{ batch_id: batch.batchId }] };
      return { rowCount: 1, rows: [] };
    }
  };
  const result = await applyPostgresSyncBatch(client, batch);
  assert.equal(result.applied, true);
  assert.equal(queries[0].sql, "BEGIN");
  assert.equal(queries.at(-1).sql, "COMMIT");
  assert.equal(queries.some((item) => /runtime_collection_state/.test(item.sql)), true);

  const duplicateClient = {
    async query(sql) {
      if (/RETURNING batch_id/.test(sql)) return { rowCount: 0, rows: [] };
      return { rowCount: 0, rows: [] };
    }
  };
  assert.equal((await applyPostgresSyncBatch(duplicateClient, batch)).duplicate, true);
});

test("PostgreSQL worker marks successful attempts without exposing connection details", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "postgres-worker-test-"));
  const sqliteFile = path.join(dir, "outbox.sqlite");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const db = createOutboxDatabase(sqliteFile);
  enqueuePostgresSyncBatch(db, [{ collection: "settings", operation: "upsert", sourceVersion: 1, payload: { enabled: true } }]);
  db.close();
  const queries = [];
  const client = {
    async query(sql) {
      queries.push(sql);
      if (/RETURNING batch_id/.test(sql)) return { rowCount: 1, rows: [{}] };
      return { rowCount: 1, rows: [] };
    },
    release() {}
  };
  const pool = { async connect() { return client; } };
  const result = await runPostgresSyncWorker({ mode: "outbox", sqliteFile, pool });
  assert.deepEqual(result, { ok: true, processed: 1, delivered: 1, failed: 0 });
  assert.equal(readPostgresSyncStatus(sqliteFile).delivered, 1);
  assert.equal(JSON.stringify(result).includes("DATABASE_URL"), false);
});

test("PostgreSQL worker records retry and terminal failure states", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "postgres-worker-failure-test-"));
  const sqliteFile = path.join(dir, "outbox.sqlite");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const db = createOutboxDatabase(sqliteFile);
  enqueuePostgresSyncBatch(db, [{ collection: "settings", operation: "upsert", sourceVersion: 1, payload: { enabled: true } }]);
  db.close();
  const client = {
    async query(sql) {
      if (sql === "BEGIN") return { rowCount: 0, rows: [] };
      if (sql === "ROLLBACK") return { rowCount: 0, rows: [] };
      throw new Error("target temporarily unavailable");
    },
    release() {}
  };
  const pool = { async connect() { return client; } };

  const retryResult = await runPostgresSyncWorker({ mode: "outbox", sqliteFile, pool, maxAttempts: 2 });
  assert.deepEqual(retryResult, { ok: false, processed: 1, delivered: 0, failed: 1 });
  assert.equal(readPostgresSyncStatus(sqliteFile).retry, 1);

  const retryDb = new (require("node:sqlite").DatabaseSync)(sqliteFile);
  retryDb.prepare("UPDATE postgres_sync_outbox SET next_attempt_at = ? WHERE status = 'retry'").run("1970-01-01T00:00:00.000Z");
  retryDb.close();
  const failedResult = await runPostgresSyncWorker({ mode: "outbox", sqliteFile, pool, maxAttempts: 2 });
  assert.deepEqual(failedResult, { ok: false, processed: 1, delivered: 0, failed: 1 });
  const status = readPostgresSyncStatus(sqliteFile);
  assert.equal(status.failed, 1);
  assert.equal(status.retry, 0);
});

test("PostgreSQL shadow reconciliation uses a read-only transaction and persists a payload-free result", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "postgres-reconciliation-test-"));
  const sqliteFile = path.join(dir, "outbox.sqlite");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const db = createOutboxDatabase(sqliteFile);
  db.prepare("INSERT INTO state_collections (key, payload, version) VALUES (?, ?, ?)").run("settings", JSON.stringify({ enabled: true }), 3);
  db.close();
  const [local] = loadSqliteCollectionState(sqliteFile);
  const queries = [];
  const client = {
    async query(sql) {
      queries.push(sql.trim());
      if (/SELECT collection_name/.test(sql)) {
        return { rows: [{ collection_name: local.collection, payload_sha256: local.payloadSha256, source_version: local.sourceVersion, batch_id: "batch-1" }] };
      }
      return { rows: [] };
    },
    release() {}
  };
  const report = await runPostgresShadowReconciliation({
    mode: "outbox",
    sqliteFile,
    pool: { async connect() { return client; } },
    checkedAt: "2026-07-12T02:00:00.000Z"
  });
  assert.equal(report.ok, true);
  assert.equal(report.summary.matched, 1);
  assert.equal(queries[0], "BEGIN READ ONLY");
  assert.equal(queries.at(-1), "COMMIT");
  const persisted = readLatestPostgresReconciliation(sqliteFile);
  assert.equal(persisted.status, "matched");
  assert.equal(readPostgresSyncStatus(sqliteFile).reconciliation.mismatched, 0);
  assert.doesNotMatch(JSON.stringify(report), /enabled|DATABASE_URL|postgres:\/\//);
});

test("PostgreSQL shadow reconciliation stores only a safe error code", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "postgres-reconciliation-error-test-"));
  const sqliteFile = path.join(dir, "outbox.sqlite");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const db = createOutboxDatabase(sqliteFile);
  db.prepare("INSERT INTO state_collections (key, payload, version) VALUES (?, ?, ?)").run("settings", JSON.stringify({ enabled: true }), 1);
  db.close();
  const client = {
    async query(sql) {
      if (sql === "BEGIN READ ONLY") return { rows: [] };
      if (sql === "ROLLBACK") return { rows: [] };
      const error = new Error("postgres://user:secret@db/internal unavailable");
      error.code = "ECONNREFUSED";
      throw error;
    },
    release() {}
  };
  const report = await runPostgresShadowReconciliation({ mode: "outbox", sqliteFile, pool: { async connect() { return client; } } });
  assert.equal(report.status, "error");
  assert.equal(report.errorCode, "ECONNREFUSED");
  assert.doesNotMatch(JSON.stringify(report), /user:secret|internal unavailable/);
  assert.equal(readLatestPostgresReconciliation(sqliteFile).errorCode, "ECONNREFUSED");
});

test("PostgreSQL pool and CLI contracts require secure explicit configuration", () => {
  assert.throws(() => postgresPoolConfig({ DATABASE_URL: "http://not-postgres" }), /must use postgres/);
  const config = postgresPoolConfig({ DATABASE_URL: "postgres://user:secret@db/app", POSTGRES_SSL_MODE: "require" });
  assert.equal(config.ssl.rejectUnauthorized, false);
  assert.equal(config.max, 2);
  const parsed = parseWorkerArgs(["--sqlite-file=C:/data/health.sqlite", "--limit=10", "--max-attempts=4"]);
  assert.equal(parsed["sqlite-file"], "C:/data/health.sqlite");
  assert.equal(parsed.limit, "10");
  assert.equal(parsed["max-attempts"], "4");
  assert.deepEqual(parseReconcileArgs(["reconcile", "--sqlite-file=C:/data/health.sqlite", "--output=C:/logs/reconcile.json"]), {
    command: "reconcile",
    flags: { "sqlite-file": "C:/data/health.sqlite", output: "C:/logs/reconcile.json" }
  });
  assert.match(renderMarkdown({
    checkedAt: "2026-07-12T00:00:00.000Z",
    runId: "pgrecon-test",
    status: "matched",
    durationMs: 1,
    summary: { localCollections: 1, remoteCollections: 1, matched: 1, mismatched: 0 },
    differences: []
  }), /contains no business payloads or database credentials/);
});
