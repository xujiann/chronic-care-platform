"use strict";

const fs = require("node:fs");
const path = require("node:path");

const COLLECTION_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,239}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const BATCH_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{3,159}$/;
const ADVISORY_LOCK_NAME = "health-platform-postgres-primary-storage-v1";

class PostgresPrimaryDriverError extends Error {
  constructor(message, code, statusCode = 400, details = undefined) {
    super(message);
    this.name = "PostgresPrimaryDriverError";
    this.code = code;
    this.statusCode = statusCode;
    if (details !== undefined) this.details = details;
  }
}

function clean(value, maxLength = 240) {
  return String(value || "").trim().slice(0, maxLength);
}

function boundedInteger(value, fallback, minimum, maximum, name) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new PostgresPrimaryDriverError(
      `${name} must be an integer between ${minimum} and ${maximum}`,
      "INVALID_POSTGRES_PRIMARY_POOL_CONFIG"
    );
  }
  return parsed;
}

function buildPostgresPrimaryPoolConfig(env = process.env, options = {}) {
  const connectionString = clean(env.DATABASE_URL, 4096);
  if (!/^postgres(?:ql)?:\/\//i.test(connectionString)) {
    throw new PostgresPrimaryDriverError(
      "DATABASE_URL must use postgres:// or postgresql://",
      "POSTGRES_PRIMARY_DATABASE_URL_REQUIRED"
    );
  }
  const sslMode = clean(env.POSTGRES_SSL_MODE, 40).toLowerCase();
  if (sslMode !== "verify-full") {
    throw new PostgresPrimaryDriverError(
      "PostgreSQL primary storage requires POSTGRES_SSL_MODE=verify-full",
      "POSTGRES_PRIMARY_TLS_VERIFY_FULL_REQUIRED"
    );
  }
  const caFile = clean(env.POSTGRES_CA_FILE, 2048);
  let ca;
  if (caFile) {
    if (!path.isAbsolute(caFile)) {
      throw new PostgresPrimaryDriverError(
        "POSTGRES_CA_FILE must be an absolute path",
        "POSTGRES_PRIMARY_CA_PATH_INVALID"
      );
    }
    try {
      ca = (options.readFile || fs.readFileSync)(caFile, "utf8");
    } catch {
      throw new PostgresPrimaryDriverError(
        "PostgreSQL primary storage CA file could not be read",
        "POSTGRES_PRIMARY_CA_UNAVAILABLE"
      );
    }
    if (!clean(ca, 64)) {
      throw new PostgresPrimaryDriverError(
        "PostgreSQL primary storage CA file is empty",
        "POSTGRES_PRIMARY_CA_UNAVAILABLE"
      );
    }
  }
  return {
    connectionString,
    application_name: clean(env.POSTGRES_PRIMARY_APPLICATION_NAME || "health-platform-primary-storage", 80),
    max: boundedInteger(env.POSTGRES_PRIMARY_POOL_MAX, 4, 1, 20, "POSTGRES_PRIMARY_POOL_MAX"),
    connectionTimeoutMillis: boundedInteger(
      env.POSTGRES_PRIMARY_CONNECT_TIMEOUT_MS,
      5000,
      1000,
      30000,
      "POSTGRES_PRIMARY_CONNECT_TIMEOUT_MS"
    ),
    idleTimeoutMillis: boundedInteger(
      env.POSTGRES_PRIMARY_IDLE_TIMEOUT_MS,
      30000,
      1000,
      300000,
      "POSTGRES_PRIMARY_IDLE_TIMEOUT_MS"
    ),
    allowExitOnIdle: true,
    ssl: {
      rejectUnauthorized: true,
      ...(ca ? { ca } : {})
    }
  };
}

function safeDriverError(error, fallbackCode = "POSTGRES_PRIMARY_DRIVER_OPERATION_FAILED") {
  if (error instanceof PostgresPrimaryDriverError) return error;
  const code = /^[A-Z0-9_]{2,80}$/.test(String(error?.code || ""))
    ? String(error.code)
    : fallbackCode;
  return new PostgresPrimaryDriverError(
    "PostgreSQL primary storage operation failed",
    code,
    502
  );
}

function assertCollection(value) {
  const collection = clean(value);
  if (!COLLECTION_PATTERN.test(collection) || collection === "storageMeta") {
    throw new PostgresPrimaryDriverError(
      "PostgreSQL primary storage collection is invalid",
      "INVALID_POSTGRES_PRIMARY_COLLECTION"
    );
  }
  return collection;
}

function assertBatchId(value) {
  const batchId = clean(value, 160);
  if (!BATCH_ID_PATTERN.test(batchId)) {
    throw new PostgresPrimaryDriverError(
      "PostgreSQL primary storage batch id is invalid",
      "INVALID_POSTGRES_PRIMARY_BATCH_ID"
    );
  }
  return batchId;
}

function assertDigest(value, allowEmpty = false) {
  const digest = clean(value, 80).toLowerCase();
  if ((!allowEmpty || digest) && !SHA256_PATTERN.test(digest)) {
    throw new PostgresPrimaryDriverError(
      "PostgreSQL primary storage digest is invalid",
      "INVALID_POSTGRES_PRIMARY_DIGEST"
    );
  }
  return digest;
}

function assertVersion(value, allowMissing = false) {
  const version = Number(value);
  if (!Number.isSafeInteger(version) || version < (allowMissing ? -1 : 0)) {
    throw new PostgresPrimaryDriverError(
      "PostgreSQL primary storage version is invalid",
      "INVALID_POSTGRES_PRIMARY_VERSION"
    );
  }
  return version;
}

function collectionRow(row) {
  if (!row) return null;
  return {
    collection: String(row.collection_name),
    payload: row.payload === null
      ? "null"
      : typeof row.payload === "string"
        ? row.payload
        : JSON.stringify(row.payload),
    payloadSha256: String(row.payload_sha256 || ""),
    sourceVersion: Number(row.source_version),
    deleted: Boolean(row.deleted),
    batchId: String(row.batch_id),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at || "")
  };
}

function batchRow(row) {
  if (!row) return null;
  return {
    batchId: String(row.batch_id),
    payloadSha256: String(row.payload_sha256),
    previousChainHash: String(row.previous_chain_hash || ""),
    chainHash: String(row.chain_hash),
    committedAt: row.committed_at instanceof Date ? row.committed_at.toISOString() : String(row.committed_at || ""),
    sourceTransactionId: String(row.source_transaction_id),
    outboxSequence: Number(row.outbox_sequence),
    appliedChanges: Number(row.applied_changes),
    appliedAt: row.applied_at instanceof Date ? row.applied_at.toISOString() : String(row.applied_at || "")
  };
}

function buildTransactionApi(client, readOnly) {
  return Object.freeze({
    async getAppliedBatch(batchId) {
      const id = assertBatchId(batchId);
      const result = await client.query(`
        SELECT batch_id, payload_sha256, previous_chain_hash, chain_hash, committed_at,
               source_transaction_id, outbox_sequence, applied_changes, applied_at
        FROM health_platform.primary_storage_batches
        WHERE batch_id = $1
      `, [id]);
      return batchRow(result.rows[0]);
    },

    async getLastAppliedBatch() {
      const result = await client.query(`
        SELECT batch_id, payload_sha256, previous_chain_hash, chain_hash, committed_at,
               source_transaction_id, outbox_sequence, applied_changes, applied_at
        FROM health_platform.primary_storage_batches
        ORDER BY outbox_sequence DESC, applied_at DESC, batch_id DESC
        LIMIT 1
      `);
      return batchRow(result.rows[0]);
    },

    async getCollection(collection) {
      const name = assertCollection(collection);
      const result = await client.query(`
        SELECT collection_name, payload, payload_sha256, source_version, deleted, batch_id, updated_at
        FROM health_platform.primary_collection_state
        WHERE collection_name = $1
      `, [name]);
      return collectionRow(result.rows[0]);
    },

    async listCollections() {
      const result = await client.query(`
        SELECT collection_name, payload, payload_sha256, source_version, deleted, batch_id, updated_at
        FROM health_platform.primary_collection_state
        ORDER BY collection_name
      `);
      return result.rows.map(collectionRow);
    },

    async applyCollectionChange(change, options = {}) {
      if (readOnly) {
        throw new PostgresPrimaryDriverError(
          "PostgreSQL primary storage transaction is read-only",
          "POSTGRES_PRIMARY_TRANSACTION_READ_ONLY",
          409
        );
      }
      const collection = assertCollection(change?.collection);
      const operation = clean(change?.operation, 20).toLowerCase();
      if (!["upsert", "delete"].includes(operation)) {
        throw new PostgresPrimaryDriverError(
          "PostgreSQL primary storage operation is invalid",
          "INVALID_POSTGRES_PRIMARY_OPERATION"
        );
      }
      const sourceVersion = assertVersion(change?.sourceVersion);
      const expectedVersion = assertVersion(options.expectedVersion, true);
      const batchId = assertBatchId(options.batchId);
      const appliedAt = clean(options.appliedAt, 80);
      if (!Number.isFinite(Date.parse(appliedAt))) {
        throw new PostgresPrimaryDriverError(
          "PostgreSQL primary storage applied timestamp is invalid",
          "INVALID_POSTGRES_PRIMARY_TIMESTAMP"
        );
      }
      const deleted = operation === "delete";
      let payload = null;
      let payloadSha256 = "";
      if (!deleted) {
        payload = typeof change.payload === "string"
          ? change.payload
          : JSON.stringify(change.payload);
        try {
          JSON.parse(payload);
        } catch {
          throw new PostgresPrimaryDriverError(
            "PostgreSQL primary storage payload is invalid",
            "INVALID_POSTGRES_PRIMARY_PAYLOAD"
          );
        }
        payloadSha256 = assertDigest(change.payloadSha256);
      }
      const result = await client.query(`
        INSERT INTO health_platform.primary_collection_state (
          collection_name, payload, payload_sha256, source_version, deleted, batch_id, updated_at
        ) VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7)
        ON CONFLICT (collection_name) DO UPDATE SET
          payload = EXCLUDED.payload,
          payload_sha256 = EXCLUDED.payload_sha256,
          source_version = EXCLUDED.source_version,
          deleted = EXCLUDED.deleted,
          batch_id = EXCLUDED.batch_id,
          updated_at = EXCLUDED.updated_at
        WHERE health_platform.primary_collection_state.source_version = $8
        RETURNING collection_name, payload, payload_sha256, source_version, deleted, batch_id, updated_at
      `, [
        collection,
        payload,
        payloadSha256,
        sourceVersion,
        deleted,
        batchId,
        appliedAt,
        expectedVersion
      ]);
      if (result.rowCount !== 1) {
        throw new PostgresPrimaryDriverError(
          "PostgreSQL primary storage database CAS conflict",
          "POSTGRES_PRIMARY_DATABASE_CAS_CONFLICT",
          409,
          { collection, expectedVersion }
        );
      }
      return collectionRow(result.rows[0]);
    },

    async recordAppliedBatch(batch) {
      if (readOnly) {
        throw new PostgresPrimaryDriverError(
          "PostgreSQL primary storage transaction is read-only",
          "POSTGRES_PRIMARY_TRANSACTION_READ_ONLY",
          409
        );
      }
      const batchId = assertBatchId(batch?.batchId);
      const payloadSha256 = assertDigest(batch?.payloadSha256);
      const previousChainHash = assertDigest(batch?.previousChainHash, true);
      const chainHash = assertDigest(batch?.chainHash);
      const committedAt = clean(batch?.committedAt, 80);
      const sourceTransactionId = clean(batch?.sourceTransactionId, 160);
      const outboxSequence = Number(batch?.outboxSequence);
      const appliedChanges = Number(batch?.appliedChanges);
      if (!Number.isFinite(Date.parse(committedAt))
        || sourceTransactionId.length < 4
        || !Number.isSafeInteger(outboxSequence)
        || outboxSequence <= 0
        || !Number.isSafeInteger(appliedChanges)
        || appliedChanges < 0) {
        throw new PostgresPrimaryDriverError(
          "PostgreSQL primary storage batch receipt is invalid",
          "INVALID_POSTGRES_PRIMARY_BATCH_RECEIPT"
        );
      }
      const result = await client.query(`
        INSERT INTO health_platform.primary_storage_batches (
          batch_id, payload_sha256, previous_chain_hash, chain_hash, committed_at,
          source_transaction_id, outbox_sequence, applied_changes, applied_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
        ON CONFLICT (batch_id) DO NOTHING
        RETURNING batch_id, payload_sha256, previous_chain_hash, chain_hash, committed_at,
                  source_transaction_id, outbox_sequence, applied_changes, applied_at
      `, [
        batchId,
        payloadSha256,
        previousChainHash,
        chainHash,
        committedAt,
        sourceTransactionId,
        outboxSequence,
        appliedChanges
      ]);
      if (result.rowCount !== 1) {
        throw new PostgresPrimaryDriverError(
          "PostgreSQL primary storage batch is not unique",
          "POSTGRES_PRIMARY_BATCH_CONFLICT",
          409
        );
      }
      return batchRow(result.rows[0]);
    }
  });
}

function createPostgresPrimaryDriver(options = {}) {
  const env = options.env || process.env;
  const poolConfig = options.poolConfig || buildPostgresPrimaryPoolConfig(env, options);
  if (options.pool && options.controlledPool !== true) {
    throw new PostgresPrimaryDriverError(
      "Injected PostgreSQL primary storage pools must be explicitly controlled",
      "POSTGRES_PRIMARY_POOL_NOT_CONTROLLED"
    );
  }
  const ownsPool = !options.pool;
  const PoolClass = options.PoolClass || (!options.pool ? require("pg").Pool : null);
  const pool = options.pool || new PoolClass(poolConfig);
  if (!pool || typeof pool.connect !== "function") {
    throw new PostgresPrimaryDriverError(
      "PostgreSQL primary storage pool is invalid",
      "POSTGRES_PRIMARY_POOL_INVALID"
    );
  }
  let closed = false;

  return {
    status() {
      return {
        configured: true,
        tlsVerifyFull: poolConfig.ssl?.rejectUnauthorized === true,
        poolMax: poolConfig.max,
        controlledPool: options.pool ? options.controlledPool === true : true,
        ownsPool,
        closed,
        productionPrimary: false,
        runtimeCutoverEnabled: false,
        credentialsPersisted: false
      };
    },

    async transaction(transactionOptions = {}, operation) {
      if (closed) {
        throw new PostgresPrimaryDriverError(
          "PostgreSQL primary storage driver is closed",
          "POSTGRES_PRIMARY_DRIVER_CLOSED",
          409
        );
      }
      if (typeof operation !== "function") {
        throw new PostgresPrimaryDriverError(
          "PostgreSQL primary storage transaction callback is required",
          "POSTGRES_PRIMARY_TRANSACTION_CALLBACK_REQUIRED"
        );
      }
      const readOnly = transactionOptions.readOnly === true;
      const isolation = clean(transactionOptions.isolation, 40).toLowerCase();
      if ((readOnly && isolation !== "repeatable-read")
        || (!readOnly && isolation !== "serializable")) {
        throw new PostgresPrimaryDriverError(
          "PostgreSQL primary storage transaction mode is not permitted",
          "POSTGRES_PRIMARY_TRANSACTION_MODE_INVALID"
        );
      }

      let client;
      let begun = false;
      try {
        client = await pool.connect();
        if (!client || typeof client.query !== "function") {
          throw new PostgresPrimaryDriverError(
            "PostgreSQL primary storage client is invalid",
            "POSTGRES_PRIMARY_CLIENT_INVALID",
            502
          );
        }
        await client.query(readOnly
          ? "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"
          : "BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");
        begun = true;
        if (!readOnly) {
          await client.query(
            "SELECT pg_advisory_xact_lock(hashtext($1))",
            [ADVISORY_LOCK_NAME]
          );
        }
        const result = await operation(buildTransactionApi(client, readOnly));
        await client.query("COMMIT");
        begun = false;
        return result;
      } catch (error) {
        if (begun) {
          try {
            await client?.query?.("ROLLBACK");
          } catch {}
        }
        throw safeDriverError(error);
      } finally {
        client?.release?.();
      }
    },

    async close() {
      if (closed) return;
      closed = true;
      if (ownsPool && typeof pool.end === "function") {
        try {
          await pool.end();
        } catch (error) {
          throw safeDriverError(error, "POSTGRES_PRIMARY_POOL_CLOSE_FAILED");
        }
      }
    }
  };
}

module.exports = {
  ADVISORY_LOCK_NAME,
  PostgresPrimaryDriverError,
  buildPostgresPrimaryPoolConfig,
  createPostgresPrimaryDriver,
  safeDriverError
};
