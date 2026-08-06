const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { buildPostgresSyncBatch } = require("../postgres-runtime-sync");
const { canonicalStringify } = require("../scripts/postgres-migration-package");
const {
  buildPostgresPrimaryStorageConfig,
  createPostgresPrimaryStorageContract
} = require("../src/platform/storage/postgres-primary-storage-contract");
const {
  ADVISORY_LOCK_NAME,
  buildPostgresPrimaryPoolConfig,
  createPostgresPrimaryDriver
} = require("../src/platform/storage/postgres-primary-driver");

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function digest(value) {
  return createHash("sha256").update(canonicalStringify(value)).digest("hex");
}

function primaryEnv(mode = "primary-write") {
  return {
    POSTGRES_PRIMARY_STORAGE_MODE: mode,
    DATABASE_URL: "postgresql://private-user:private-password@db.internal/platform",
    POSTGRES_SSL_MODE: "verify-full",
    POSTGRES_SCHEMA_EVIDENCE_ID: "schema:2026-08-06",
    POSTGRES_MIGRATION_EVIDENCE_ID: "migration:2026-08-06",
    POSTGRES_RECONCILIATION_EVIDENCE_ID: "reconciliation:2026-08-06",
    POSTGRES_BACKUP_EVIDENCE_ID: "backup:2026-08-06",
    POSTGRES_RTO_RPO_EVIDENCE_ID: "recovery:2026-08-06",
    POSTGRES_ROLLBACK_EVIDENCE_ID: "rollback:2026-08-06",
    POSTGRES_CUTOVER_APPROVAL_ID: "approval:2026-08-06"
  };
}

function fakePool(seed = {}) {
  const state = {
    collections: new Map((seed.collections || []).map((row) => [row.collection_name, clone(row)])),
    batches: new Map((seed.batches || []).map((row) => [row.batch_id, clone(row)]))
  };
  const calls = [];
  let released = 0;
  let ended = 0;

  function client() {
    let working = null;
    return {
      async query(sql, params = []) {
        const normalized = String(sql).replace(/\s+/g, " ").trim();
        calls.push({ sql: normalized, params: clone(params) });
        if (normalized.startsWith("BEGIN ")) {
          working = {
            collections: new Map([...state.collections].map(([key, value]) => [key, clone(value)])),
            batches: new Map([...state.batches].map(([key, value]) => [key, clone(value)]))
          };
          return { rowCount: 0, rows: [] };
        }
        if (normalized === "COMMIT") {
          state.collections = working.collections;
          state.batches = working.batches;
          working = null;
          return { rowCount: 0, rows: [] };
        }
        if (normalized === "ROLLBACK") {
          working = null;
          return { rowCount: 0, rows: [] };
        }
        if (/pg_advisory_xact_lock/.test(normalized)) {
          return { rowCount: 1, rows: [{ pg_advisory_xact_lock: null }] };
        }
        if (/FROM health_platform\.primary_storage_batches WHERE batch_id = \$1/.test(normalized)) {
          const row = working.batches.get(params[0]);
          return { rowCount: row ? 1 : 0, rows: row ? [clone(row)] : [] };
        }
        if (/FROM health_platform\.primary_storage_batches ORDER BY outbox_sequence DESC/.test(normalized)) {
          const rows = [...working.batches.values()]
            .sort((left, right) => Number(right.outbox_sequence) - Number(left.outbox_sequence));
          return { rowCount: rows.length ? 1 : 0, rows: rows.length ? [clone(rows[0])] : [] };
        }
        if (/FROM health_platform\.primary_collection_state WHERE collection_name = \$1/.test(normalized)) {
          const row = working.collections.get(params[0]);
          return { rowCount: row ? 1 : 0, rows: row ? [clone(row)] : [] };
        }
        if (/FROM health_platform\.primary_collection_state ORDER BY collection_name/.test(normalized)) {
          const rows = [...working.collections.values()]
            .sort((left, right) => left.collection_name.localeCompare(right.collection_name));
          return { rowCount: rows.length, rows: clone(rows) };
        }
        if (/INSERT INTO health_platform\.primary_collection_state/.test(normalized)) {
          const [collection, payload, payloadSha256, sourceVersion, deleted, batchId, updatedAt, expectedVersion] = params;
          const current = working.collections.get(collection);
          if (current && Number(current.source_version) !== Number(expectedVersion)) {
            return { rowCount: 0, rows: [] };
          }
          const row = {
            collection_name: collection,
            payload: payload === null ? null : JSON.parse(payload),
            payload_sha256: payloadSha256,
            source_version: sourceVersion,
            deleted,
            batch_id: batchId,
            updated_at: updatedAt
          };
          working.collections.set(collection, row);
          return { rowCount: 1, rows: [clone(row)] };
        }
        if (/INSERT INTO health_platform\.primary_storage_batches/.test(normalized)) {
          const [
            batchId,
            payloadSha256,
            previousChainHash,
            chainHash,
            committedAt,
            sourceTransactionId,
            outboxSequence,
            appliedChanges
          ] = params;
          if (working.batches.has(batchId)) return { rowCount: 0, rows: [] };
          const row = {
            batch_id: batchId,
            payload_sha256: payloadSha256,
            previous_chain_hash: previousChainHash,
            chain_hash: chainHash,
            committed_at: committedAt,
            source_transaction_id: sourceTransactionId,
            outbox_sequence: outboxSequence,
            applied_changes: appliedChanges,
            applied_at: "2026-08-06T00:01:00.000Z"
          };
          working.batches.set(batchId, row);
          return { rowCount: 1, rows: [clone(row)] };
        }
        throw new Error(`unexpected fake PostgreSQL query: ${normalized}`);
      },
      release() {
        released += 1;
      }
    };
  }

  return {
    calls,
    state,
    get released() {
      return released;
    },
    get ended() {
      return ended;
    },
    async connect() {
      if (seed.connectError) throw seed.connectError;
      return client();
    },
    async end() {
      ended += 1;
    }
  };
}

function outboxCommitment(batch, sequence = 1) {
  return {
    state: "committed",
    source: "sqlite-transactional-outbox",
    sourceTransactionId: `sqlite-tx-${sequence}`,
    outboxSequence: sequence,
    committedAt: `2026-08-06T00:00:0${sequence}.000Z`,
    payloadSha256: batch.payloadSha256
  };
}

test("PostgreSQL primary pool requires verify-full and returns bounded controlled settings", () => {
  assert.throws(
    () => buildPostgresPrimaryPoolConfig({
      DATABASE_URL: "postgresql://db/platform",
      POSTGRES_SSL_MODE: "require"
    }),
    (error) => error.code === "POSTGRES_PRIMARY_TLS_VERIFY_FULL_REQUIRED"
  );
  assert.throws(
    () => buildPostgresPrimaryPoolConfig({
      DATABASE_URL: "postgresql://db/platform",
      POSTGRES_SSL_MODE: "verify-full",
      POSTGRES_PRIMARY_POOL_MAX: "21"
    }),
    (error) => error.code === "INVALID_POSTGRES_PRIMARY_POOL_CONFIG"
  );
  assert.throws(
    () => buildPostgresPrimaryPoolConfig({
      DATABASE_URL: "postgresql://db/platform",
      POSTGRES_SSL_MODE: "verify-full",
      POSTGRES_CA_FILE: "relative/ca.pem"
    }),
    (error) => error.code === "POSTGRES_PRIMARY_CA_PATH_INVALID"
  );

  const config = buildPostgresPrimaryPoolConfig({
    DATABASE_URL: "postgresql://private-user:private-password@db.internal/platform",
    POSTGRES_SSL_MODE: "verify-full",
    POSTGRES_CA_FILE: path.resolve("controlled-ca.pem"),
    POSTGRES_PRIMARY_POOL_MAX: "6",
    POSTGRES_PRIMARY_CONNECT_TIMEOUT_MS: "4000",
    POSTGRES_PRIMARY_IDLE_TIMEOUT_MS: "20000"
  }, {
    readFile() {
      return "-----BEGIN CERTIFICATE-----\ncontrolled\n-----END CERTIFICATE-----";
    }
  });
  assert.equal(config.ssl.rejectUnauthorized, true);
  assert.match(config.ssl.ca, /BEGIN CERTIFICATE/);
  assert.equal(config.max, 6);
  assert.equal(config.connectionTimeoutMillis, 4000);
  assert.equal(config.idleTimeoutMillis, 20000);
});

test("formal driver fixes read transactions to repeatable-read read-only and releases clients", async () => {
  const value = [{ id: "r1" }];
  const pool = fakePool({
    collections: [{
      collection_name: "residents",
      payload: value,
      payload_sha256: digest(value),
      source_version: 3,
      deleted: false,
      batch_id: "pgsync-seed",
      updated_at: "2026-08-06T00:00:00.000Z"
    }]
  });
  const driver = createPostgresPrimaryDriver({
    env: primaryEnv("primary-read"),
    pool,
    controlledPool: true
  });
  const rows = await driver.transaction({
    isolation: "repeatable-read",
    readOnly: true
  }, (tx) => tx.listCollections());
  assert.equal(rows.length, 1);
  assert.equal(rows[0].collection, "residents");
  assert.deepEqual(pool.calls.map((call) => call.sql), [
    "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    "SELECT collection_name, payload, payload_sha256, source_version, deleted, batch_id, updated_at FROM health_platform.primary_collection_state ORDER BY collection_name",
    "COMMIT"
  ]);
  assert.equal(pool.released, 1);
  assert.equal(driver.status().productionPrimary, false);
  assert.doesNotMatch(JSON.stringify(driver.status()), /private-password|DATABASE_URL/);
});

test("formal driver and storage contract apply committed batches with lock, CAS, tombstones and parameters", async () => {
  const pool = fakePool();
  const env = primaryEnv("primary-write");
  const driver = createPostgresPrimaryDriver({ env, pool, controlledPool: true });
  const storage = createPostgresPrimaryStorageContract({
    config: buildPostgresPrimaryStorageConfig(env),
    driver
  });
  const dangerousValue = { note: "x'); DROP TABLE primary_collection_state; --" };
  const baseline = buildPostgresSyncBatch([{
    collection: "settings",
    operation: "upsert",
    sourceVersion: 4,
    payload: canonicalStringify(dangerousValue),
    payloadSha256: digest(dangerousValue)
  }], {
    sourceEvent: "baseline-snapshot",
    createdAt: "2026-08-06T00:00:00.000Z"
  });
  const result = await storage.applyCommittedOutbox(baseline, {
    executionContext: "worker",
    commitment: outboxCommitment(baseline),
    appliedAt: "2026-08-06T00:00:10.000Z"
  });
  assert.equal(result.status, "applied");
  assert.equal(result.productionPrimary, false);
  assert.equal(pool.calls[0].sql, "BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");
  assert.equal(pool.calls[1].sql, "SELECT pg_advisory_xact_lock(hashtext($1))");
  assert.deepEqual(pool.calls[1].params, [ADVISORY_LOCK_NAME]);
  const collectionInsert = pool.calls.find((call) => /INSERT INTO health_platform\.primary_collection_state/.test(call.sql));
  assert.equal(collectionInsert.sql.includes("DROP TABLE"), false);
  assert.equal(collectionInsert.params[1].includes("DROP TABLE"), true);
  assert.equal(collectionInsert.params[7], -1);
  assert.equal(pool.calls.some((call) => /INSERT INTO health_platform\.primary_storage_batches/.test(call.sql)), true);
  assert.equal(pool.calls.at(-1).sql, "COMMIT");
  assert.equal(pool.state.collections.get("settings").source_version, 4);
  assert.equal(pool.state.batches.size, 1);

  const deletion = buildPostgresSyncBatch([{
    collection: "settings",
    operation: "delete",
    sourceVersion: 5
  }], {
    createdAt: "2026-08-06T00:00:02.000Z",
    previousChainHash: baseline.chainHash
  });
  await storage.applyCommittedOutbox(deletion, {
    executionContext: "worker",
    commitment: outboxCommitment(deletion, 2),
    appliedAt: "2026-08-06T00:00:20.000Z"
  });
  const tombstone = pool.state.collections.get("settings");
  assert.equal(tombstone.deleted, true);
  assert.equal(tombstone.payload, null);
  assert.equal(tombstone.payload_sha256, "");
  assert.equal(tombstone.source_version, 5);
});

test("database CAS failure rolls back collection and batch changes and releases the client", async () => {
  const seedValue = { enabled: true };
  const pool = fakePool({
    collections: [{
      collection_name: "settings",
      payload: seedValue,
      payload_sha256: digest(seedValue),
      source_version: 3,
      deleted: false,
      batch_id: "pgsync-seed",
      updated_at: "2026-08-06T00:00:00.000Z"
    }]
  });
  const driver = createPostgresPrimaryDriver({
    env: primaryEnv(),
    pool,
    controlledPool: true
  });
  await assert.rejects(
    () => driver.transaction({ isolation: "serializable", readOnly: false }, async (tx) => {
      await tx.applyCollectionChange({
        collection: "settings",
        operation: "upsert",
        sourceVersion: 5,
        payload: canonicalStringify({ enabled: false }),
        payloadSha256: digest({ enabled: false })
      }, {
        expectedVersion: 2,
        batchId: "pgsync-conflict",
        appliedAt: "2026-08-06T00:01:00.000Z"
      });
    }),
    (error) => error.code === "POSTGRES_PRIMARY_DATABASE_CAS_CONFLICT"
  );
  assert.equal(pool.calls.at(-1).sql, "ROLLBACK");
  assert.equal(pool.state.collections.get("settings").source_version, 3);
  assert.equal(pool.state.batches.size, 0);
  assert.equal(pool.released, 1);
});

test("driver sanitizes connection failures, requires controlled injection and closes owned pools", async () => {
  assert.throws(
    () => createPostgresPrimaryDriver({
      env: primaryEnv(),
      pool: fakePool()
    }),
    (error) => error.code === "POSTGRES_PRIMARY_POOL_NOT_CONTROLLED"
  );

  const failingPool = fakePool({
    connectError: Object.assign(
      new Error("postgresql://private-user:private-password@db.internal/platform refused"),
      { code: "ECONNREFUSED" }
    )
  });
  const failingDriver = createPostgresPrimaryDriver({
    env: primaryEnv(),
    pool: failingPool,
    controlledPool: true
  });
  await assert.rejects(
    () => failingDriver.transaction(
      { isolation: "repeatable-read", readOnly: true },
      async () => null
    ),
    (error) => {
      assert.equal(error.code, "ECONNREFUSED");
      assert.doesNotMatch(error.message, /private-password|postgresql:\/\//);
      return true;
    }
  );

  const ownedPool = fakePool();
  class FakePool {
    constructor(config) {
      assert.equal(config.ssl.rejectUnauthorized, true);
      return ownedPool;
    }
  }
  const ownedDriver = createPostgresPrimaryDriver({
    env: primaryEnv(),
    PoolClass: FakePool
  });
  await ownedDriver.close();
  await ownedDriver.close();
  assert.equal(ownedPool.ended, 1);
  assert.equal(ownedDriver.status().closed, true);
  await assert.rejects(
    () => ownedDriver.transaction(
      { isolation: "repeatable-read", readOnly: true },
      async () => null
    ),
    (error) => error.code === "POSTGRES_PRIMARY_DRIVER_CLOSED"
  );
});

test("primary storage schema binds tombstones and deferred batch evidence in one transaction", () => {
  const sql = fs.readFileSync(
    path.join(__dirname, "..", "deploy", "postgres-primary-storage-schema.sql"),
    "utf8"
  );
  [
    "primary_storage_batches",
    "primary_collection_state",
    "previous_chain_hash",
    "outbox_sequence bigint NOT NULL UNIQUE",
    "deleted boolean NOT NULL",
    "payload IS NULL",
    "DEFERRABLE INITIALLY DEFERRED",
    "ON DELETE RESTRICT"
  ].forEach((marker) => assert.equal(sql.includes(marker), true, marker));
  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /COMMIT;\s*$/);
});
