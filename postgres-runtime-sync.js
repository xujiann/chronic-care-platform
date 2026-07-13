const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { canonicalStringify } = require("./scripts/postgres-migration-package");

const SYNC_MODE = String(process.env.POSTGRES_SYNC_MODE || "disabled").trim().toLowerCase();
const SYNC_MODES = new Set(["disabled", "outbox"]);
const MAX_BATCH_LIMIT = 100;
const MAX_RECONCILIATION_HISTORY = 100;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertSyncMode(mode = SYNC_MODE) {
  if (!SYNC_MODES.has(mode)) throw new Error(`Unsupported POSTGRES_SYNC_MODE=${mode}`);
  return mode;
}

function buildCollectionChanges(existingRows = [], incomingEntries = []) {
  const existing = new Map(existingRows.map((row) => [row.key, row]));
  const incoming = new Map(incomingEntries.filter(([key]) => key !== "storageMeta"));
  const changes = [];
  existing.forEach((row, collection) => {
    if (!incoming.has(collection)) {
      changes.push({ collection, operation: "delete", sourceVersion: Number(row.version || 0) + 1 });
    }
  });
  incoming.forEach((value, collection) => {
    const payload = canonicalStringify(value);
    const row = existing.get(collection);
    if (!row || row.payload !== JSON.stringify(value)) {
      changes.push({
        collection,
        operation: "upsert",
        sourceVersion: Number(row?.version || 0) + 1,
        payload,
        payloadSha256: sha256(payload)
      });
    }
  });
  return changes.sort((a, b) => a.collection.localeCompare(b.collection));
}

function buildCollectionSnapshotChanges(rows = []) {
  return rows
    .filter((row) => row.key !== "storageMeta")
    .map((row) => {
      const payload = canonicalStringify(JSON.parse(row.payload));
      return {
        collection: row.key,
        operation: "upsert",
        sourceVersion: Number(row.version || 0),
        payload,
        payloadSha256: sha256(payload)
      };
    })
    .sort((a, b) => a.collection.localeCompare(b.collection));
}

function buildPostgresSyncBatch(changes, options = {}) {
  if (!Array.isArray(changes) || !changes.length) throw new Error("PostgreSQL sync batch requires collection changes");
  const normalizedChanges = changes.map((change) => {
    const collection = String(change.collection || "").trim();
    const operation = String(change.operation || "").trim();
    if (!collection || !["upsert", "delete"].includes(operation)) throw new Error("invalid PostgreSQL collection change");
    if (operation === "delete") return { collection, operation, sourceVersion: Number(change.sourceVersion || 0) };
    const payload = typeof change.payload === "string" ? change.payload : canonicalStringify(change.payload);
    JSON.parse(payload);
    return {
      collection,
      operation,
      sourceVersion: Number(change.sourceVersion || 0),
      payload,
      payloadSha256: sha256(payload)
    };
  });
  const createdAt = options.createdAt || new Date().toISOString();
  const previousChainHash = String(options.previousChainHash || "").trim();
  const envelope = {
    formatVersion: 1,
    createdAt,
    sourceEvent: String(options.sourceEvent || "write-state"),
    changes: normalizedChanges
  };
  const payload = canonicalStringify(envelope);
  const payloadSha256 = sha256(payload);
  const chainHash = sha256(`${previousChainHash}:${payloadSha256}`);
  return {
    batchId: options.batchId || `pgsync-${chainHash.slice(0, 32)}`,
    createdAt,
    payload,
    payloadSha256,
    previousChainHash,
    chainHash,
    changes: normalizedChanges
  };
}

function validatePostgresSyncBatch(batch) {
  const checks = {
    batchId: /^pgsync-[a-f0-9]{32}$/.test(String(batch?.batchId || "")),
    payloadDigest: sha256(String(batch?.payload || "")) === batch?.payloadSha256,
    chainDigest: sha256(`${batch?.previousChainHash || ""}:${batch?.payloadSha256 || ""}`) === batch?.chainHash,
    payloadShape: false,
    credentialsAbsent: !["databaseUrl", "connectionString", "password", "credentials"].some((key) => Object.hasOwn(batch || {}, key))
  };
  try {
    const parsed = JSON.parse(batch.payload);
    checks.payloadShape = parsed.formatVersion === 1 && Array.isArray(parsed.changes) && parsed.changes.length > 0;
  } catch {
    checks.payloadShape = false;
  }
  return { ok: Object.values(checks).every(Boolean), checks };
}

function enqueuePostgresSyncBatch(db, changes, options = {}) {
  if (!changes.length) return null;
  const previous = db.prepare("SELECT chain_hash FROM postgres_sync_outbox ORDER BY sequence DESC LIMIT 1").get();
  const batch = buildPostgresSyncBatch(changes, { ...options, previousChainHash: previous?.chain_hash || "" });
  const validation = validatePostgresSyncBatch(batch);
  if (!validation.ok) throw new Error("PostgreSQL sync batch integrity validation failed");
  db.prepare(`
    INSERT INTO postgres_sync_outbox (
      batch_id, created_at, payload, payload_sha256, previous_chain_hash, chain_hash,
      status, attempts, next_attempt_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?)
  `).run(batch.batchId, batch.createdAt, batch.payload, batch.payloadSha256, batch.previousChainHash, batch.chainHash, batch.createdAt);
  return batch;
}

function enqueuePostgresSyncBaseline(sqliteFile, options = {}) {
  const resolvedSqliteFile = path.resolve(sqliteFile || path.join(process.env.DATA_DIR || path.join(__dirname, "data"), "health-city.sqlite"));
  const db = openSqlite(resolvedSqliteFile);
  try {
    db.exec("BEGIN IMMEDIATE");
    const existingBatch = db.prepare("SELECT batch_id FROM postgres_sync_outbox ORDER BY sequence LIMIT 1").get();
    if (existingBatch && !options.force) {
      db.exec("ROLLBACK");
      return { ok: true, enqueued: false, reason: "outbox-not-empty", batchId: existingBatch.batch_id, collections: 0 };
    }
    const rows = db.prepare("SELECT key, payload, version FROM state_collections ORDER BY key").all();
    const changes = buildCollectionSnapshotChanges(rows);
    if (!changes.length) throw new Error("SQLite collection state is empty");
    const batch = enqueuePostgresSyncBatch(db, changes, {
      createdAt: options.createdAt,
      sourceEvent: "baseline-snapshot"
    });
    db.exec("COMMIT");
    return { ok: true, enqueued: true, batchId: batch.batchId, collections: changes.length };
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  } finally {
    db.close();
  }
}

function openSqlite(sqliteFile) {
  const sqlite = require("node:sqlite");
  if (!sqlite?.DatabaseSync) throw new Error("node:sqlite DatabaseSync unavailable");
  return new sqlite.DatabaseSync(sqliteFile);
}

function readPostgresSyncStatus(sqliteFile) {
  const empty = {
    pending: 0,
    retry: 0,
    delivered: 0,
    failed: 0,
    oldestPendingAt: "",
    lastDeliveredAt: "",
    reconciliation: { status: "never", runId: "", checkedAt: "", matched: 0, mismatched: 0, durationMs: 0 }
  };
  if (!fs.existsSync(sqliteFile)) return empty;
  const db = openSqlite(sqliteFile);
  try {
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'postgres_sync_outbox'").get();
    if (!table) return empty;
    const counts = db.prepare("SELECT status, COUNT(*) AS count FROM postgres_sync_outbox GROUP BY status").all()
      .reduce((result, row) => ({ ...result, [row.status]: Number(row.count) }), {});
    const pending = db.prepare("SELECT MIN(created_at) AS oldest FROM postgres_sync_outbox WHERE status IN ('pending', 'retry')").get();
    const delivered = db.prepare("SELECT MAX(delivered_at) AS latest FROM postgres_sync_outbox WHERE status = 'delivered'").get();
    const reconciliationTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'postgres_sync_reconciliations'").get();
    const latest = reconciliationTable ? db.prepare(`
      SELECT run_id, checked_at, status, matched, mismatched, duration_ms
      FROM postgres_sync_reconciliations
      ORDER BY checked_at DESC, rowid DESC
      LIMIT 1
    `).get() : null;
    return {
      pending: counts.pending || 0,
      retry: counts.retry || 0,
      delivered: counts.delivered || 0,
      failed: counts.failed || 0,
      oldestPendingAt: pending?.oldest || "",
      lastDeliveredAt: delivered?.latest || "",
      reconciliation: latest ? {
        status: latest.status,
        runId: latest.run_id,
        checkedAt: latest.checked_at,
        matched: Number(latest.matched || 0),
        mismatched: Number(latest.mismatched || 0),
        durationMs: Number(latest.duration_ms || 0)
      } : empty.reconciliation
    };
  } finally {
    db.close();
  }
}

function loadSqliteCollectionState(sqliteFile) {
  const db = openSqlite(sqliteFile);
  try {
    return buildCollectionSnapshotChanges(db.prepare("SELECT key, payload, version FROM state_collections ORDER BY key").all())
      .map((item) => ({
        collection: item.collection,
        sourceVersion: item.sourceVersion,
        payloadSha256: item.payloadSha256
      }));
  } finally {
    db.close();
  }
}

function comparePostgresShadowState(localRows = [], remoteRows = []) {
  const local = new Map(localRows.map((row) => [row.collection, row]));
  const remote = new Map(remoteRows.map((row) => [row.collection, row]));
  const names = [...new Set([...local.keys(), ...remote.keys()])].sort();
  const differences = [];
  let matched = 0;
  names.forEach((collection) => {
    const source = local.get(collection);
    const target = remote.get(collection);
    const types = [];
    if (!target) types.push("missing-remote");
    else if (!source) types.push("unexpected-remote");
    else {
      if (Number(source.sourceVersion) !== Number(target.sourceVersion)) types.push("version-mismatch");
      if (source.payloadSha256 !== target.payloadSha256) types.push("digest-mismatch");
    }
    if (!types.length) {
      matched += 1;
      return;
    }
    differences.push({
      collection,
      types,
      localVersion: source ? Number(source.sourceVersion) : null,
      remoteVersion: target ? Number(target.sourceVersion) : null,
      localDigest: source?.payloadSha256 || "",
      remoteDigest: target?.payloadSha256 || "",
      batchId: target?.batchId || ""
    });
  });
  const countType = (type) => differences.filter((item) => item.types.includes(type)).length;
  return {
    localCollections: local.size,
    remoteCollections: remote.size,
    matched,
    mismatched: differences.length,
    missingRemote: countType("missing-remote"),
    unexpectedRemote: countType("unexpected-remote"),
    versionMismatches: countType("version-mismatch"),
    digestMismatches: countType("digest-mismatch"),
    differences
  };
}

function recordPostgresReconciliation(sqliteFile, report) {
  const db = openSqlite(sqliteFile);
  try {
    db.prepare(`
      INSERT INTO postgres_sync_reconciliations (
        run_id, checked_at, status, local_collections, remote_collections, matched, mismatched,
        missing_remote, unexpected_remote, version_mismatches, digest_mismatches,
        duration_ms, error_code, detail_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      report.runId,
      report.checkedAt,
      report.status,
      report.summary.localCollections,
      report.summary.remoteCollections,
      report.summary.matched,
      report.summary.mismatched,
      report.summary.missingRemote,
      report.summary.unexpectedRemote,
      report.summary.versionMismatches,
      report.summary.digestMismatches,
      report.durationMs,
      report.errorCode || "",
      JSON.stringify(report.differences || [])
    );
    db.prepare(`
      DELETE FROM postgres_sync_reconciliations
      WHERE rowid NOT IN (
        SELECT rowid FROM postgres_sync_reconciliations ORDER BY checked_at DESC, rowid DESC LIMIT ?
      )
    `).run(MAX_RECONCILIATION_HISTORY);
  } finally {
    db.close();
  }
}

function readLatestPostgresReconciliation(sqliteFile) {
  if (!fs.existsSync(sqliteFile)) return null;
  const db = openSqlite(sqliteFile);
  try {
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'postgres_sync_reconciliations'").get();
    if (!table) return null;
    const row = db.prepare("SELECT * FROM postgres_sync_reconciliations ORDER BY checked_at DESC, rowid DESC LIMIT 1").get();
    if (!row) return null;
    return {
      runId: row.run_id,
      checkedAt: row.checked_at,
      status: row.status,
      durationMs: Number(row.duration_ms || 0),
      errorCode: row.error_code || "",
      summary: {
        localCollections: Number(row.local_collections || 0),
        remoteCollections: Number(row.remote_collections || 0),
        matched: Number(row.matched || 0),
        mismatched: Number(row.mismatched || 0),
        missingRemote: Number(row.missing_remote || 0),
        unexpectedRemote: Number(row.unexpected_remote || 0),
        versionMismatches: Number(row.version_mismatches || 0),
        digestMismatches: Number(row.digest_mismatches || 0)
      },
      differences: JSON.parse(row.detail_json || "[]"),
      productionPrimary: false
    };
  } finally {
    db.close();
  }
}

function loadPendingPostgresSyncBatches(sqliteFile, options = {}) {
  const limit = Math.min(MAX_BATCH_LIMIT, Math.max(1, Number(options.limit || 20) || 20));
  const now = options.now || new Date().toISOString();
  const db = openSqlite(sqliteFile);
  try {
    return db.prepare(`
      SELECT batch_id, created_at, payload, payload_sha256, previous_chain_hash, chain_hash, attempts
      FROM postgres_sync_outbox
      WHERE status IN ('pending', 'retry') AND next_attempt_at <= ?
      ORDER BY sequence
      LIMIT ?
    `).all(now, limit).map((row) => ({
      batchId: row.batch_id,
      createdAt: row.created_at,
      payload: row.payload,
      payloadSha256: row.payload_sha256,
      previousChainHash: row.previous_chain_hash,
      chainHash: row.chain_hash,
      attempts: Number(row.attempts || 0),
      changes: JSON.parse(row.payload).changes
    }));
  } finally {
    db.close();
  }
}

function markPostgresSyncBatch(sqliteFile, batchId, result = {}) {
  const db = openSqlite(sqliteFile);
  try {
    const now = result.at || new Date().toISOString();
    if (result.delivered) {
      db.prepare(`
        UPDATE postgres_sync_outbox
        SET status = 'delivered', attempts = attempts + 1, delivered_at = ?, last_error = '', next_attempt_at = ?
        WHERE batch_id = ?
      `).run(now, now, batchId);
      return;
    }
    const row = db.prepare("SELECT attempts FROM postgres_sync_outbox WHERE batch_id = ?").get(batchId);
    const attempts = Number(row?.attempts || 0) + 1;
    const terminal = attempts >= Number(result.maxAttempts || 5);
    const delayMs = Math.min(300000, 1000 * (2 ** Math.min(attempts, 8)));
    const nextAttemptAt = new Date(new Date(now).getTime() + delayMs).toISOString();
    db.prepare(`
      UPDATE postgres_sync_outbox
      SET status = ?, attempts = ?, last_error = ?, next_attempt_at = ?
      WHERE batch_id = ?
    `).run(terminal ? "failed" : "retry", attempts, String(result.error || "PostgreSQL sync failed").slice(0, 500), nextAttemptAt, batchId);
  } finally {
    db.close();
  }
}

async function applyPostgresSyncBatch(client, batch) {
  const validation = validatePostgresSyncBatch(batch);
  if (!validation.ok) throw new Error("PostgreSQL sync batch integrity validation failed");
  const parsed = JSON.parse(batch.payload);
  await client.query("BEGIN");
  try {
    const inserted = await client.query(`
      INSERT INTO health_platform.runtime_sync_batches (
        batch_id, created_at, payload_sha256, previous_chain_hash, chain_hash, status
      ) VALUES ($1, $2, $3, $4, $5, 'applying')
      ON CONFLICT (batch_id) DO NOTHING
      RETURNING batch_id
    `, [batch.batchId, batch.createdAt, batch.payloadSha256, batch.previousChainHash, batch.chainHash]);
    if (inserted.rowCount === 0) {
      await client.query("COMMIT");
      return { applied: false, duplicate: true, changes: 0 };
    }
    for (const change of parsed.changes) {
      if (change.operation === "delete") {
        await client.query("DELETE FROM health_platform.runtime_collection_state WHERE collection_name = $1", [change.collection]);
        continue;
      }
      await client.query(`
        INSERT INTO health_platform.runtime_collection_state (
          collection_name, payload, payload_sha256, source_version, batch_id, updated_at
        ) VALUES ($1, $2::jsonb, $3, $4, $5, $6)
        ON CONFLICT (collection_name) DO UPDATE SET
          payload = EXCLUDED.payload,
          payload_sha256 = EXCLUDED.payload_sha256,
          source_version = EXCLUDED.source_version,
          batch_id = EXCLUDED.batch_id,
          updated_at = EXCLUDED.updated_at
        WHERE health_platform.runtime_collection_state.source_version <= EXCLUDED.source_version
      `, [change.collection, change.payload, change.payloadSha256, change.sourceVersion, batch.batchId, batch.createdAt]);
    }
    await client.query("UPDATE health_platform.runtime_sync_batches SET status = 'applied', applied_at = now() WHERE batch_id = $1", [batch.batchId]);
    await client.query("COMMIT");
    return { applied: true, duplicate: false, changes: parsed.changes.length };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

function postgresPoolConfig(env = process.env) {
  const connectionString = String(env.DATABASE_URL || "").trim();
  if (!/^postgres(?:ql)?:\/\//i.test(connectionString)) throw new Error("DATABASE_URL must use postgres:// or postgresql://");
  const sslMode = String(env.POSTGRES_SSL_MODE || "verify-full").trim().toLowerCase();
  if (!["disable", "require", "verify-full"].includes(sslMode)) throw new Error(`Unsupported POSTGRES_SSL_MODE=${sslMode}`);
  let ssl = false;
  if (sslMode !== "disable") {
    ssl = { rejectUnauthorized: sslMode === "verify-full" };
    if (env.POSTGRES_CA_FILE) ssl.ca = fs.readFileSync(path.resolve(env.POSTGRES_CA_FILE), "utf8");
  }
  return { connectionString, max: Math.min(10, Math.max(1, Number(env.POSTGRES_POOL_MAX || 2) || 2)), ssl };
}

async function runPostgresShadowReconciliation(options = {}) {
  assertSyncMode(options.mode || SYNC_MODE);
  if ((options.mode || SYNC_MODE) !== "outbox") throw new Error("POSTGRES_SYNC_MODE=outbox is required");
  const startedAt = Date.now();
  const checkedAt = options.checkedAt || new Date().toISOString();
  const sqliteFile = path.resolve(options.sqliteFile || path.join(process.env.DATA_DIR || path.join(__dirname, "data"), "health-city.sqlite"));
  const localRows = loadSqliteCollectionState(sqliteFile);
  const poolConfig = options.pool ? null : (options.poolConfig || postgresPoolConfig(options.env || process.env));
  const PoolClass = options.PoolClass || require("pg").Pool;
  const pool = options.pool || new PoolClass(poolConfig);
  const runId = options.runId || `pgrecon-${randomUUID()}`;
  let client;
  let report;
  try {
    client = await pool.connect();
    await client.query("BEGIN READ ONLY");
    const result = await client.query(`
      SELECT collection_name, payload_sha256, source_version, batch_id
      FROM health_platform.runtime_collection_state
      ORDER BY collection_name
    `);
    await client.query("COMMIT");
    const remoteRows = result.rows.map((row) => ({
      collection: row.collection_name,
      payloadSha256: row.payload_sha256,
      sourceVersion: Number(row.source_version || 0),
      batchId: row.batch_id || ""
    }));
    const comparison = comparePostgresShadowState(localRows, remoteRows);
    report = {
      ok: comparison.mismatched === 0,
      runId,
      checkedAt,
      status: comparison.mismatched === 0 ? "matched" : "mismatched",
      durationMs: Math.max(0, Date.now() - startedAt),
      summary: {
        localCollections: comparison.localCollections,
        remoteCollections: comparison.remoteCollections,
        matched: comparison.matched,
        mismatched: comparison.mismatched,
        missingRemote: comparison.missingRemote,
        unexpectedRemote: comparison.unexpectedRemote,
        versionMismatches: comparison.versionMismatches,
        digestMismatches: comparison.digestMismatches
      },
      differences: comparison.differences,
      productionPrimary: false
    };
  } catch (error) {
    try { await client?.query?.("ROLLBACK"); } catch {}
    report = {
      ok: false,
      runId,
      checkedAt,
      status: "error",
      durationMs: Math.max(0, Date.now() - startedAt),
      errorCode: String(error.code || "POSTGRES_RECONCILIATION_FAILED").slice(0, 80),
      summary: {
        localCollections: localRows.length,
        remoteCollections: 0,
        matched: 0,
        mismatched: 0,
        missingRemote: 0,
        unexpectedRemote: 0,
        versionMismatches: 0,
        digestMismatches: 0
      },
      differences: [],
      productionPrimary: false
    };
  } finally {
    client?.release?.();
    if (!options.pool) await pool.end();
  }
  recordPostgresReconciliation(sqliteFile, report);
  return report;
}

async function runPostgresSyncWorker(options = {}) {
  assertSyncMode(options.mode || SYNC_MODE);
  if ((options.mode || SYNC_MODE) !== "outbox") throw new Error("POSTGRES_SYNC_MODE=outbox is required");
  const sqliteFile = path.resolve(options.sqliteFile || path.join(process.env.DATA_DIR || path.join(__dirname, "data"), "health-city.sqlite"));
  const poolConfig = options.pool ? null : (options.poolConfig || postgresPoolConfig(options.env || process.env));
  const batches = loadPendingPostgresSyncBatches(sqliteFile, { limit: options.limit });
  if (!batches.length) return { ok: true, processed: 0, delivered: 0, failed: 0 };
  const PoolClass = options.PoolClass || require("pg").Pool;
  const pool = options.pool || new PoolClass(poolConfig);
  let delivered = 0;
  let failed = 0;
  try {
    for (const batch of batches) {
      let client;
      try {
        client = await pool.connect();
        await applyPostgresSyncBatch(client, batch);
        markPostgresSyncBatch(sqliteFile, batch.batchId, { delivered: true });
        delivered += 1;
      } catch (error) {
        markPostgresSyncBatch(sqliteFile, batch.batchId, { error: error.message, maxAttempts: options.maxAttempts });
        failed += 1;
      } finally {
        client?.release?.();
      }
    }
  } finally {
    if (!options.pool) await pool.end();
  }
  return { ok: failed === 0, processed: batches.length, delivered, failed };
}

module.exports = {
  SYNC_MODES,
  applyPostgresSyncBatch,
  assertSyncMode,
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
  recordPostgresReconciliation,
  runPostgresShadowReconciliation,
  runPostgresSyncWorker,
  validatePostgresSyncBatch
};
