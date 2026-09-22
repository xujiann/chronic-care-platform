"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

function invalid() {
  return Object.assign(new Error("PRIMARY_LIVE_CONFIG_INVALID"), { code: "PRIMARY_LIVE_CONFIG_INVALID" });
}

// Pure admission check. Never read DATABASE_URL, POSTGRES_URL or PG* fallbacks.
function readLiveConfig(env = process.env) {
  if (env.POSTGRES_PRIMARY_LIVE_TEST === undefined) return null;
  if (env.POSTGRES_PRIMARY_LIVE_TEST !== "1") throw invalid();
  if (String(env.NODE_ENV || "").trim().toLowerCase() === "production") throw invalid();
  const raw = env.POSTGRES_PRIMARY_LIVE_TEST_ADMIN_URL;
  if (typeof raw !== "string" || raw !== raw.trim() || /[\s\\?#]/.test(raw)) throw invalid();
  let url;
  try { url = new URL(raw); } catch { throw invalid(); }
  // Validate original authority too: URL canonicalization must not admit 127.1,
  // encoded hosts, alternate account spellings, fragments or query options.
  const authority = raw.match(/^postgres(?:ql)?:\/\/contract_runner:([^@]+)@(localhost|127\.0\.0\.1|\[::1\])(?::([1-9][0-9]{0,4}))?\/health_platform_contract$/);
  if (!authority || !["postgres:", "postgresql:"].includes(url.protocol)
    || url.username !== "contract_runner" || url.pathname !== "/health_platform_contract"
    || url.search || url.hash || !url.password) throw invalid();
  const port = authority[3] === undefined ? 5432 : Number(authority[3]);
  if (port < 1 || port > 65535) throw invalid();
  let password;
  try { password = decodeURIComponent(url.password); } catch { throw invalid(); }
  if (!password || /[\u0000-\u001f\u007f]/.test(password)) throw invalid();
  return Object.freeze({ host: authority[2] === "[::1]" ? "::1" : authority[2], port,
    user: "contract_runner", password, database: "health_platform_contract", ssl: false });
}

async function createFixture(t) {
  const config = readLiveConfig();
  if (!config) { t.skip("POSTGRES_PRIMARY_LIVE_TEST is not enabled; no live PG evidence"); return null; }
  const { Pool } = require("pg");
  const { DatabaseSync } = require("node:sqlite");
  const { applySqliteMigrations } = require("../../src/platform/storage/sqlite-migrations");
  const { commitSqliteOutboxTransaction, loadCommittedSqliteOutboxBatches } = require("../../src/platform/storage/sqlite-outbox-commit-receipt");
  const { createPostgresPrimaryDriver } = require("../../src/platform/storage/postgres-primary-driver");
  const { buildPostgresPrimaryStorageConfig, createPostgresPrimaryStorageContract } = require("../../src/platform/storage/postgres-primary-storage-contract");
  const bounds = { max: 1, options: "", application_name: "platform-primary-live-test", connectionTimeoutMillis: 5000, query_timeout: 12000,
    statement_timeout: 10000, lock_timeout: 8000, idle_in_transaction_session_timeout: 15000 };
  const admin = new Pool({ ...config, ...bounds });
  const databaseName = `platform_primary_test_${randomUUID().replaceAll("-", "")}`;
  const pools = [];
  let created = false;
  let databaseOid;
  let sqlite;
  let directory;
  t.after(async () => {
    let failure;
    for (const pool of pools) { try { await pool.end(); } catch { failure = new Error("PRIMARY_LIVE_POOL_CLEANUP_FAILED"); } }
    try {
      if (created) {
        const row = (await admin.query("SELECT oid::text, pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname=$1", [databaseName])).rows[0];
        if (!row || row.oid !== databaseOid || row.owner !== config.user) throw new Error("PRIMARY_LIVE_DATABASE_IDENTITY_CHANGED");
        // Only this successful CREATE grants cleanup authority; never FORCE or terminate backends.
        await admin.query(`DROP DATABASE "${databaseName}"`);
      }
    } catch { failure = new Error("PRIMARY_LIVE_DATABASE_CLEANUP_FAILED"); }
    finally {
      await admin.end();
      sqlite?.close();
      if (directory) fs.rmSync(directory, { recursive: true, force: true });
    }
    if (failure) throw failure;
  });
  const identity = (await admin.query("SELECT current_database() AS database, current_user AS username")).rows[0];
  if (identity.database !== config.database || identity.username !== config.user) throw invalid();
  await admin.query(`CREATE DATABASE "${databaseName}" TEMPLATE template0`);
  created = true;
  databaseOid = (await admin.query("SELECT oid::text FROM pg_database WHERE datname=$1", [databaseName])).rows[0]?.oid;
  if (!databaseOid) throw new Error("PRIMARY_LIVE_DATABASE_IDENTITY_MISSING");
  const poolConfig = { ...config, ...bounds, database: databaseName };
  function newPool() {
    const pool = new Pool(poolConfig);
    pools.push(pool);
    return pool;
  }
  const pool = newPool();
  const actual = (await pool.query("SELECT current_database() AS database")).rows[0];
  if (actual.database !== databaseName) throw new Error("PRIMARY_LIVE_DATABASE_IDENTITY_MISMATCH");
  await pool.query(fs.readFileSync(path.join(__dirname, "../../deploy/postgres-primary-storage-schema.sql"), "utf8"));
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "primary-live-sqlite-"));
  const sqliteFile = path.join(directory, "synthetic.sqlite");
  sqlite = new DatabaseSync(sqliteFile);
  sqlite.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL");
  applySqliteMigrations(sqlite);
  function createDriver(selected = pool) {
    if (!pools.includes(selected)) throw new Error("PRIMARY_LIVE_POOL_NOT_OWNED");
    return createPostgresPrimaryDriver({ pool: selected, controlledPool: true, poolConfig });
  }
  function createContract(selected = pool) {
    const contractConfig = buildPostgresPrimaryStorageConfig({
      POSTGRES_PRIMARY_STORAGE_MODE: "shadow", DATABASE_URL: "postgresql://synthetic.invalid/fixture",
      POSTGRES_SSL_MODE: "verify-full", POSTGRES_SCHEMA_EVIDENCE_ID: "synthetic-schema",
      POSTGRES_MIGRATION_EVIDENCE_ID: "synthetic-migration"
    });
    // Above opens only the library gate; actual driver status truthfully reports ssl:false.
    return createPostgresPrimaryStorageContract({ config: contractConfig, driver: createDriver(selected) });
  }
  function commitBatch(entries, expectedVersions, sourceEvent = "synthetic-live-test") {
    const result = commitSqliteOutboxTransaction(sqlite, { entries, expectedVersions, sourceEvent });
    const loaded = loadCommittedSqliteOutboxBatches(sqliteFile);
    const found = loaded.find((row) => row.commitment.outboxSequence === result.commitment.outboxSequence);
    if (!found) throw new Error("PRIMARY_LIVE_SOURCE_RECEIPT_MISSING");
    return found;
  }
  async function rawSnapshot() {
    const client = await pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const batches = (await client.query(`SELECT batch_id,payload_sha256,previous_chain_hash,chain_hash,
        to_char(committed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US BC') AS committed_at,
        source_transaction_id,outbox_sequence::text,applied_changes,
        to_char(applied_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US BC') AS applied_at
        FROM health_platform.primary_storage_batches ORDER BY batch_id`)).rows;
      const collections = (await client.query(`SELECT collection_name,payload,payload_sha256,source_version::text,deleted,batch_id,
        to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US BC') AS updated_at
        FROM health_platform.primary_collection_state ORDER BY collection_name`)).rows;
      await client.query("COMMIT");
      return { batches, collections };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  return { pool, newPool, createDriver, createContract, commitBatch, rawSnapshot, databaseName,
    async backendPid(selected = pool) { return (await selected.query("SELECT pg_backend_pid() AS pid")).rows[0].pid; } };
}

module.exports = { readLiveConfig, createFixture };
