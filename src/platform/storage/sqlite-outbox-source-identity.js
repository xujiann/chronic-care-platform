"use strict";

const { randomUUID } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

function sourceError(suffix) {
  const code = `SQLITE_OUTBOX_SOURCE_${suffix}`;
  return Object.assign(new Error(code), { code });
}

// Self-contained versioned DDL; never mutate this creator after v19 ships.
function createSqliteOutboxSourceIdentitySchema(db) {
  db.exec(`CREATE TABLE source_identity (
    singleton INTEGER PRIMARY KEY CHECK(singleton=1),
    source_instance_id TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  );
  CREATE TABLE source_genesis (
    singleton INTEGER PRIMARY KEY CHECK(singleton=1),
    source_instance_id TEXT NOT NULL REFERENCES source_identity(source_instance_id) ON DELETE RESTRICT,
    outbox_sequence INTEGER NOT NULL UNIQUE REFERENCES postgres_sync_outbox(sequence) ON DELETE RESTRICT,
    batch_id TEXT NOT NULL UNIQUE,
    chain_hash TEXT NOT NULL
  );`);
  for (const table of ["source_identity", "source_genesis"]) {
    db.exec(`CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table}
      BEGIN SELECT RAISE(ABORT,'SQLITE_OUTBOX_SOURCE_IMMUTABLE'); END;
      CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table}
      BEGIN SELECT RAISE(ABORT,'SQLITE_OUTBOX_SOURCE_IMMUTABLE'); END;
      CREATE TRIGGER ${table}_no_replace BEFORE INSERT ON ${table}
      WHEN EXISTS(SELECT 1 FROM ${table})
      BEGIN SELECT RAISE(ABORT,'SQLITE_OUTBOX_SOURCE_IMMUTABLE'); END;`);
  }
}

let expectedSchema;
function schemaRows(db) {
  return db.prepare("SELECT type,name,sql FROM sqlite_master WHERE name IN ('source_identity','source_genesis','source_identity_no_update','source_identity_no_delete','source_identity_no_replace','source_genesis_no_update','source_genesis_no_delete','source_genesis_no_replace') ORDER BY name").all();
}

function assertSchema(db, required) {
  const actual = schemaRows(db);
  const ledger = db.prepare("SELECT name,checksum FROM schema_migrations WHERE version=19").get();
  if (!actual.length && !ledger && !required) return false;
  if (!expectedSchema) {
    const memory = new DatabaseSync(":memory:");
    try { createSqliteOutboxSourceIdentitySchema(memory); expectedSchema = JSON.stringify(schemaRows(memory)); }
    finally { memory.close(); }
  }
  // Lazy import avoids the migration registry -> schema creator dependency cycle.
  const { SQLITE_MIGRATIONS, migrationContentFingerprint } = require("./sqlite-migrations");
  const migration = SQLITE_MIGRATIONS.find((entry) => entry.version === 19);
  if (JSON.stringify(actual) !== expectedSchema || !ledger || ledger.name !== migration?.name
    || ledger.checksum !== migrationContentFingerprint(migration)) throw sourceError("SCHEMA_INVALID");
  return true;
}

function validUuid(value) {
  return typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
}

function readSqliteOutboxSourceIdentity(db, { required = false } = {}) {
  if (!assertSchema(db, required)) return null;
  const identities = db.prepare("SELECT * FROM source_identity").all();
  const anchors = db.prepare("SELECT * FROM source_genesis").all();
  if (!identities.length && !anchors.length && !required) return null;
  const row = identities[0], anchor = anchors[0];
  if (identities.length !== 1 || row.singleton !== 1 || !validUuid(row.source_instance_id)
    || typeof row.created_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.created_at)
    || !Number.isFinite(Date.parse(row.created_at)) || new Date(row.created_at).toISOString() !== row.created_at
    || anchors.length > 1) throw sourceError("IDENTITY_INVALID");
  if (anchor && (anchor.singleton !== 1 || anchor.source_instance_id !== row.source_instance_id
    || !Number.isSafeInteger(anchor.outbox_sequence) || anchor.outbox_sequence <= 0
    || !/^pgsync-[a-f0-9]{32}$/.test(anchor.batch_id) || !/^[a-f0-9]{64}$/.test(anchor.chain_hash))) throw sourceError("GENESIS_INVALID");
  return { schemaVersion: "sqlite-outbox-source.v1", sourceInstanceId: row.source_instance_id, createdAt: row.created_at,
    genesis: anchor ? { outboxSequence: anchor.outbox_sequence, batchId: anchor.batch_id, chainHash: anchor.chain_hash } : null };
}

function initializeSqliteOutboxSourceIdentity(db) {
  let begun = false;
  try {
    db.exec("BEGIN IMMEDIATE"); begun = true;
    assertSchema(db, true);
    for (const table of ["state_collections", "postgres_sync_outbox", "postgres_sync_commit_receipts", "storage_events", "source_identity", "source_genesis"]) {
      if (db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get()) throw sourceError("NOT_EMPTY");
    }
    const sourceInstanceId = randomUUID(), createdAt = new Date().toISOString();
    db.prepare("INSERT INTO source_identity(singleton,source_instance_id,created_at) VALUES(1,?,?)").run(sourceInstanceId, createdAt);
    db.exec("COMMIT"); begun = false;
    return Object.freeze({ schemaVersion: "sqlite-outbox-source.v1", sourceInstanceId, createdAt, genesis: null });
  } catch (error) {
    if (begun) { try { db.exec("ROLLBACK"); } catch { /* Keep original failure. */ } }
    throw /^SQLITE_OUTBOX_SOURCE_[A-Z_]+$/.test(error?.code || "") ? error : sourceError("STORAGE_FAILED");
  }
}

module.exports = { createSqliteOutboxSourceIdentitySchema, initializeSqliteOutboxSourceIdentity, readSqliteOutboxSourceIdentity };
