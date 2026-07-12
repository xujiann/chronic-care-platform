const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { canonicalStringify } = require("./scripts/postgres-migration-package");

const SYNC_MODE = String(process.env.POSTGRES_SYNC_MODE || "disabled").trim().toLowerCase();
const SYNC_MODES = new Set(["disabled", "outbox"]);
const MAX_BATCH_LIMIT = 100;

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

function openSqlite(sqliteFile) {
  const sqlite = require("node:sqlite");
  if (!sqlite?.DatabaseSync) throw new Error("node:sqlite DatabaseSync unavailable");
  return new sqlite.DatabaseSync(sqliteFile);
}

function readPostgresSyncStatus(sqliteFile) {
  if (!fs.existsSync(sqliteFile)) return { pending: 0, retry: 0, delivered: 0, failed: 0, oldestPendingAt: "", lastDeliveredAt: "" };
  const db = openSqlite(sqliteFile);
  try {
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'postgres_sync_outbox'").get();
    if (!table) return { pending: 0, retry: 0, delivered: 0, failed: 0, oldestPendingAt: "", lastDeliveredAt: "" };
    const counts = db.prepare("SELECT status, COUNT(*) AS count FROM postgres_sync_outbox GROUP BY status").all()
      .reduce((result, row) => ({ ...result, [row.status]: Number(row.count) }), {});
    const pending = db.prepare("SELECT MIN(created_at) AS oldest FROM postgres_sync_outbox WHERE status IN ('pending', 'retry')").get();
    const delivered = db.prepare("SELECT MAX(delivered_at) AS latest FROM postgres_sync_outbox WHERE status = 'delivered'").get();
    return {
      pending: counts.pending || 0,
      retry: counts.retry || 0,
      delivered: counts.delivered || 0,
      failed: counts.failed || 0,
      oldestPendingAt: pending?.oldest || "",
      lastDeliveredAt: delivered?.latest || ""
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
  buildPostgresSyncBatch,
  enqueuePostgresSyncBatch,
  loadPendingPostgresSyncBatches,
  markPostgresSyncBatch,
  postgresPoolConfig,
  readPostgresSyncStatus,
  runPostgresSyncWorker,
  validatePostgresSyncBatch
};
