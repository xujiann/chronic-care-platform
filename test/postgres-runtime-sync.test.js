const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  applyPostgresReconciliationCaseAction,
  applyPostgresSyncBatch,
  buildCollectionChanges,
  buildCollectionSnapshotChanges,
  buildPostgresSyncBatch,
  comparePostgresShadowState,
  enqueuePostgresSyncBatch,
  enqueuePostgresSyncBaseline,
  listPostgresReconciliationCases,
  listPostgresReconciliationHistory,
  loadPendingPostgresSyncBatches,
  loadSqliteCollectionState,
  markPostgresSyncBatch,
  postgresSchemaIdentifier,
  postgresPoolConfig,
  probePostgresInfrastructure,
  readLatestPostgresReconciliation,
  readPostgresReconciliationCase,
  readPostgresReconciliationRun,
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
    CREATE TABLE postgres_sync_reconciliation_cases (
      case_id TEXT PRIMARY KEY,
      collection_name TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'open',
      owner TEXT NOT NULL DEFAULT 'database-operations',
      severity TEXT NOT NULL DEFAULT 'critical',
      first_run_id TEXT NOT NULL,
      latest_run_id TEXT NOT NULL,
      cleared_run_id TEXT NOT NULL DEFAULT '',
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      cleared_at TEXT NOT NULL DEFAULT '',
      occurrence_count INTEGER NOT NULL DEFAULT 1,
      difference_types_json TEXT NOT NULL DEFAULT '[]',
      local_version INTEGER,
      remote_version INTEGER,
      local_digest TEXT NOT NULL DEFAULT '',
      remote_digest TEXT NOT NULL DEFAULT '',
      resolution_note TEXT NOT NULL DEFAULT '',
      resolved_at TEXT NOT NULL DEFAULT '',
      resolved_by TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE postgres_sync_reconciliation_case_actions (
      action_id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL,
      action TEXT NOT NULL,
      from_status TEXT NOT NULL,
      to_status TEXT NOT NULL,
      actor TEXT NOT NULL,
      role TEXT NOT NULL,
      owner TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      evidence_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      FOREIGN KEY (case_id) REFERENCES postgres_sync_reconciliation_cases(case_id) ON DELETE RESTRICT
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
      if (/SELECT payload_sha256, previous_chain_hash, chain_hash/.test(sql)) {
        return { rowCount: 1, rows: [{
          payload_sha256: batch.payloadSha256,
          previous_chain_hash: batch.previousChainHash,
          chain_hash: batch.chainHash
        }] };
      }
      return { rowCount: 0, rows: [] };
    }
  };
  assert.equal((await applyPostgresSyncBatch(duplicateClient, batch)).duplicate, true);
});

test("PostgreSQL apply rejects a reused batch id with different immutable content", async () => {
  const batch = buildPostgresSyncBatch([{ collection: "residents", operation: "upsert", sourceVersion: 1, payload: [{ id: "r1" }] }]);
  const queries = [];
  const client = {
    async query(sql) {
      queries.push(sql);
      if (/RETURNING batch_id/.test(sql)) return { rowCount: 0, rows: [] };
      if (/SELECT payload_sha256, previous_chain_hash, chain_hash/.test(sql)) {
        return { rowCount: 1, rows: [{
          payload_sha256: "f".repeat(64),
          previous_chain_hash: batch.previousChainHash,
          chain_hash: batch.chainHash
        }] };
      }
      return { rowCount: 0, rows: [] };
    }
  };
  await assert.rejects(() => applyPostgresSyncBatch(client, batch), { code: "POSTGRES_SYNC_BATCH_ID_CONFLICT" });
  assert.equal(queries.at(-1), "ROLLBACK");
  assert.equal(queries.includes("COMMIT"), false);
});

test("PostgreSQL apply accepts equal-version identical digests but rejects equal-version payload drift", async () => {
  const batch = buildPostgresSyncBatch([{ collection: "settings", operation: "upsert", sourceVersion: 7, payload: { enabled: true } }]);
  const change = JSON.parse(batch.payload).changes[0];
  const clientFor = (digest) => ({
    queries: [],
    async query(sql) {
      this.queries.push(sql);
      if (/RETURNING batch_id/.test(sql)) return { rowCount: 1, rows: [{ batch_id: batch.batchId }] };
      if (/SELECT payload_sha256, source_version/.test(sql)) return { rowCount: 1, rows: [{ payload_sha256: digest, source_version: 7 }] };
      return { rowCount: 1, rows: [] };
    }
  });
  const identical = clientFor(change.payloadSha256);
  assert.equal((await applyPostgresSyncBatch(identical, batch)).applied, true);
  assert.equal(identical.queries.some((sql) => /INSERT INTO health_platform\.runtime_collection_state/.test(sql)), false);

  const drift = clientFor("e".repeat(64));
  await assert.rejects(() => applyPostgresSyncBatch(drift, batch), { code: "POSTGRES_SYNC_VERSION_CONFLICT" });
  assert.equal(drift.queries.at(-1), "ROLLBACK");
  assert.equal(drift.queries.includes("COMMIT"), false);
});

test("PostgreSQL apply rejects an equal-version tombstone and keeps the existing payload", async () => {
  const batch = buildPostgresSyncBatch([{ collection: "settings", operation: "delete", sourceVersion: 7 }]);
  const queries = [];
  const client = {
    async query(sql) {
      queries.push(sql);
      if (/RETURNING batch_id/.test(sql)) return { rowCount: 1, rows: [{ batch_id: batch.batchId }] };
      if (/SELECT payload_sha256, source_version/.test(sql)) return { rowCount: 1, rows: [{ payload_sha256: "a".repeat(64), source_version: 7 }] };
      return { rowCount: 1, rows: [] };
    }
  };
  await assert.rejects(() => applyPostgresSyncBatch(client, batch), { code: "POSTGRES_SYNC_VERSION_CONFLICT" });
  assert.equal(queries.some((sql) => /^DELETE FROM/.test(sql.trim())), false);
  assert.equal(queries.at(-1), "ROLLBACK");
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

test("PostgreSQL reconciliation cases preserve assignment, clearance, resolution and automatic reopening", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "postgres-reconciliation-case-test-"));
  const sqliteFile = path.join(dir, "outbox.sqlite");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const db = createOutboxDatabase(sqliteFile);
  db.prepare("INSERT INTO state_collections (key, payload, version) VALUES (?, ?, ?)").run("settings", JSON.stringify({ enabled: true }), 3);
  db.close();
  const [local] = loadSqliteCollectionState(sqliteFile);
  const poolWithRows = (rows) => ({
    async connect() {
      return {
        async query(sql) {
          return /SELECT collection_name/.test(sql) ? { rows } : { rows: [] };
        },
        release() {}
      };
    }
  });

  const first = await runPostgresShadowReconciliation({
    mode: "outbox",
    sqliteFile,
    pool: poolWithRows([]),
    runId: "pgrecon-case-1",
    checkedAt: "2026-07-12T03:00:00.000Z"
  });
  assert.equal(first.status, "mismatched");
  let ledger = listPostgresReconciliationCases(sqliteFile);
  assert.equal(ledger.summary.open, 1);
  assert.equal(ledger.summary.unresolved, 1);
  const caseId = ledger.cases[0].caseId;
  assert.deepEqual(ledger.cases[0].differenceTypes, ["missing-remote"]);

  const acknowledged = applyPostgresReconciliationCaseAction(sqliteFile, caseId, {
    action: "acknowledge",
    owner: "database-platform-team",
    note: "Owner confirmed the shadow delivery investigation."
  }, { name: "release reviewer", role: "commission" });
  assert.equal(acknowledged.status, "acknowledged");
  assert.equal(acknowledged.owner, "database-platform-team");
  assert.throws(() => applyPostgresReconciliationCaseAction(sqliteFile, caseId, {
    action: "resolve",
    note: "Validated after replay.",
    evidenceRefs: ["reconciliation:pgrecon-case-2"]
  }, { name: "release reviewer", role: "commission" }), (error) => error.code === "RECONCILIATION_CLEARANCE_REQUIRED" && error.statusCode === 409);

  await runPostgresShadowReconciliation({
    mode: "outbox",
    sqliteFile,
    pool: poolWithRows([{ collection_name: local.collection, payload_sha256: local.payloadSha256, source_version: local.sourceVersion, batch_id: "batch-case-2" }]),
    runId: "pgrecon-case-2",
    checkedAt: "2026-07-12T03:05:00.000Z"
  });
  ledger = listPostgresReconciliationCases(sqliteFile);
  assert.equal(ledger.summary.clearedAwaitingResolution, 1);
  const resolved = applyPostgresReconciliationCaseAction(sqliteFile, caseId, {
    action: "resolve",
    note: "Validated by a later matched reconciliation run.",
    evidenceRefs: ["reconciliation:pgrecon-case-2", "ticket:DB-42"]
  }, { name: "release reviewer", role: "commission" });
  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.clearedRunId, "pgrecon-case-2");
  assert.equal(resolved.actions.some((item) => item.action === "verified-clear"), true);
  assert.equal(listPostgresReconciliationHistory(sqliteFile).length, 2);
  assert.equal(readPostgresReconciliationRun(sqliteFile, "pgrecon-case-1").summary.missingRemote, 1);

  await runPostgresShadowReconciliation({
    mode: "outbox",
    sqliteFile,
    pool: poolWithRows([]),
    runId: "pgrecon-case-3",
    checkedAt: "2026-07-12T03:10:00.000Z"
  });
  const reopened = readPostgresReconciliationCase(sqliteFile, caseId);
  assert.equal(reopened.status, "reopened");
  assert.equal(reopened.occurrenceCount, 2);
  assert.equal(reopened.actions.some((item) => item.action === "auto-reopen"), true);
  assert.equal(readPostgresSyncStatus(sqliteFile).reconciliation.cases.unresolved, 1);
  assert.doesNotMatch(JSON.stringify(reopened), /enabled|DATABASE_URL|postgres:\/\//);
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

test("PostgreSQL infrastructure probe validates the target schema without leaking connection errors", async () => {
  const queries = [];
  const pool = {
    async query(sql, params) {
      queries.push({ sql, params });
      return { rows: ["auth_security_state", "auth_sessions", "runtime_collection_state", "runtime_sync_batches"].map((table_name) => ({ table_name })) };
    }
  };
  const report = await probePostgresInfrastructure({ pool, schema: "tenant_alpha" });
  assert.equal(report.ok, true);
  assert.equal(report.productionPrimary, false);
  assert.deepEqual(queries[0].params[0], "tenant_alpha");
  assert.equal(postgresSchemaIdentifier("tenant_alpha"), "tenant_alpha");
  assert.throws(() => postgresSchemaIdentifier("tenant-alpha;drop schema public"), /lowercase SQL identifier/);

  const failed = await probePostgresInfrastructure({
    pool: { async query() { const error = new Error("postgres://user:secret@db/internal"); error.code = "ECONNREFUSED"; throw error; } },
    schema: "tenant_alpha"
  });
  assert.equal(failed.errorCode, "ECONNREFUSED");
  assert.doesNotMatch(JSON.stringify(failed), /user:secret|internal/);
});
