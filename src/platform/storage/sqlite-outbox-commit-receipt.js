"use strict";

// T00 synthetic, isolated SQLite fixtures only. This is not writeDatabase:
// identity mirrors, domain hooks and production authorization are not composed here.
const { createHash, randomUUID } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { buildCollectionChanges, enqueuePostgresSyncBatch, validatePostgresSyncBatch } = require("../../../postgres-runtime-sync");
const { canonicalStringify } = require("../../../scripts/postgres-migration-package");
const { readSqliteOutboxSourceIdentity } = require("./sqlite-outbox-source-identity");
const brandedSources = new WeakMap();

function deepFreeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function resolveBrandedSourceEnvelope(envelope) {
  if (!envelope || !brandedSources.has(envelope)) {
    const code = "SQLITE_OUTBOX_SOURCE_ENVELOPE_INVALID";
    throw Object.assign(new Error(code), { code });
  }
  return brandedSources.get(envelope);
}

function checkGenesis(identity, all) {
  if (!identity) return;
  const first = all[0], genesis = identity.genesis;
  insist(first ? genesis && genesis.outboxSequence === first.commitment.outboxSequence
    && genesis.batchId === first.batch.batchId && genesis.chainHash === first.batch.chainHash : !genesis, "SOURCE_GENESIS_INVALID");
}

const MAX_ROWS = 1000;
const MAX_BYTES = 1024 * 1024;
const MAX_SCAN_BYTES = 16 * MAX_BYTES;
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const COLLECTION = /^[A-Za-z][A-Za-z0-9_-]{0,239}$/;

function fail(suffix) {
  const code = `SQLITE_OUTBOX_RECEIPT_${suffix}`;
  return Object.assign(new Error(code), { code });
}

function insist(condition, suffix = "INTEGRITY") {
  if (!condition) throw fail(suffix);
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function fields(value, names, suffix = "INTEGRITY") {
  insist(object(value) && Reflect.ownKeys(value).length === names.length
    && names.every((name) => Object.hasOwn(value, name)
      && Object.hasOwn(Object.getOwnPropertyDescriptor(value, name), "value")), suffix);
}

function text(value, limit = 240) {
  return typeof value === "string" && value.length > 0 && value.length <= limit
    && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
}

function utc(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function jsonValue(value, seen = new Set(), depth = 0, budget = { nodes: 0, characters: 0 }) {
  budget.nodes += 1;
  if (typeof value === "string") budget.characters += value.length;
  insist(depth <= 40 && budget.nodes <= 100000 && budget.characters <= MAX_BYTES, "INVALID_INPUT");
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") { insist(Number.isFinite(value), "INVALID_INPUT"); return; }
  insist((Array.isArray(value) || object(value)) && !seen.has(value), "INVALID_INPUT");
  seen.add(value);
  const keys = Reflect.ownKeys(value).filter((key) => !(Array.isArray(value) && key === "length"));
  insist(keys.length <= 10000 && keys.every((key) => typeof key === "string"
    && Object.getOwnPropertyDescriptor(value, key)?.enumerable
    && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), "value")), "INVALID_INPUT");
  if (Array.isArray(value)) insist(keys.length === value.length && keys.every((key, i) => key === String(i)), "INVALID_INPUT");
  for (const key of keys) {
    budget.characters += key.length;
    jsonValue(value[key], seen, depth + 1, budget);
  }
  seen.delete(value);
}

function createSqliteOutboxCommitReceiptSchema(db) {
  db.exec(`
    CREATE TABLE postgres_sync_commit_receipts (
      outbox_sequence INTEGER PRIMARY KEY REFERENCES postgres_sync_outbox(sequence) ON DELETE RESTRICT,
      batch_id TEXT NOT NULL UNIQUE CHECK(length(batch_id) > 0),
      source_transaction_id TEXT NOT NULL UNIQUE CHECK(length(source_transaction_id) = 36),
      recorded_at TEXT NOT NULL CHECK(length(recorded_at) = 24),
      payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256) = 64 AND payload_sha256 NOT GLOB '*[^a-f0-9]*'),
      chain_hash TEXT NOT NULL CHECK(length(chain_hash) = 64 AND chain_hash NOT GLOB '*[^a-f0-9]*'),
      CHECK(outbox_sequence > 0)
    );
    CREATE TRIGGER postgres_sync_commit_receipts_no_update BEFORE UPDATE ON postgres_sync_commit_receipts
      BEGIN SELECT RAISE(ABORT, 'SQLITE_OUTBOX_RECEIPT_IMMUTABLE'); END;
    CREATE TRIGGER postgres_sync_commit_receipts_no_delete BEFORE DELETE ON postgres_sync_commit_receipts
      BEGIN SELECT RAISE(ABORT, 'SQLITE_OUTBOX_RECEIPT_IMMUTABLE'); END;
    CREATE TRIGGER postgres_sync_commit_receipts_insert_guard BEFORE INSERT ON postgres_sync_commit_receipts
      BEGIN
        SELECT CASE WHEN EXISTS (SELECT 1 FROM postgres_sync_commit_receipts
          WHERE outbox_sequence = NEW.outbox_sequence OR batch_id = NEW.batch_id OR source_transaction_id = NEW.source_transaction_id)
          THEN RAISE(ABORT, 'SQLITE_OUTBOX_RECEIPT_IMMUTABLE') END;
        SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM postgres_sync_outbox
          WHERE sequence = NEW.outbox_sequence AND batch_id = NEW.batch_id
            AND payload_sha256 = NEW.payload_sha256 AND chain_hash = NEW.chain_hash)
          THEN RAISE(ABORT, 'SQLITE_OUTBOX_RECEIPT_INTEGRITY') END;
      END;
  `);
}

function validateRow(row) {
  insist(row.receipt_batch_id !== null, "MISSING");
  insist(Number.isSafeInteger(row.sequence) && row.sequence > 0
    && row.receipt_sequence === row.sequence && row.receipt_batch_id === row.batch_id
    && typeof row.source_transaction_id === "string" && UUID.test(row.source_transaction_id) && utc(row.recorded_at)
    && typeof row.payload_sha256 === "string" && HASH.test(row.payload_sha256)
    && typeof row.chain_hash === "string" && HASH.test(row.chain_hash)
    && row.receipt_digest === row.payload_sha256 && row.receipt_chain === row.chain_hash
    && typeof row.previous_chain_hash === "string" && (row.previous_chain_hash === "" || HASH.test(row.previous_chain_hash))
    && utc(row.created_at) && typeof row.payload === "string" && Buffer.byteLength(row.payload) <= MAX_BYTES);
  const envelope = JSON.parse(row.payload);
  fields(envelope, ["formatVersion", "createdAt", "sourceEvent", "changes"]);
  insist(envelope.formatVersion === 1 && envelope.createdAt === row.created_at && text(envelope.sourceEvent)
    && Array.isArray(envelope.changes) && envelope.changes.length > 0 && envelope.changes.length <= 100);
  const names = new Set();
  for (const change of envelope.changes) {
    insist(object(change));
    fields(change, change.operation === "delete"
      ? ["collection", "operation", "sourceVersion"]
      : ["collection", "operation", "sourceVersion", "payload", "payloadSha256"]);
    insist(typeof change.collection === "string" && COLLECTION.test(change.collection)
      && change.collection !== "storageMeta" && !names.has(change.collection)
      && ["upsert", "delete"].includes(change.operation)
      && Number.isSafeInteger(change.sourceVersion) && change.sourceVersion > 0);
    names.add(change.collection);
    if (change.operation === "upsert") {
      insist(typeof change.payload === "string" && typeof change.payloadSha256 === "string" && HASH.test(change.payloadSha256)
        && hash(change.payload) === change.payloadSha256);
      const value = JSON.parse(change.payload);
      jsonValue(value);
      insist(canonicalStringify(value) === change.payload);
    }
  }
  insist(canonicalStringify(envelope) === row.payload);
  const batch = { batchId: row.batch_id, createdAt: row.created_at, payload: row.payload,
    payloadSha256: row.payload_sha256, previousChainHash: row.previous_chain_hash,
    chainHash: row.chain_hash, changes: envelope.changes };
  insist(validatePostgresSyncBatch(batch).ok && batch.batchId === `pgsync-${batch.chainHash.slice(0, 32)}`);
  return { batch, commitment: { state: "committed", source: "sqlite-transactional-outbox",
    sourceTransactionId: row.source_transaction_id, outboxSequence: row.sequence,
    committedAt: row.recorded_at, payloadSha256: row.payload_sha256 } };
}

// A bounded full-prefix scan deliberately rejects cursors that skip legacy gaps.
function scan(db) {
  const size = db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(bytes), 0) AS bytes FROM
    (SELECT length(CAST(payload AS BLOB)) AS bytes FROM postgres_sync_outbox ORDER BY sequence LIMIT ?)`)
    .get(MAX_ROWS + 1);
  insist(size.count <= MAX_ROWS && size.bytes <= MAX_SCAN_BYTES, "LIMIT");
  const receipts = db.prepare("SELECT COUNT(*) AS count FROM (SELECT outbox_sequence FROM postgres_sync_commit_receipts LIMIT ?)").get(MAX_ROWS + 1);
  insist(receipts.count <= MAX_ROWS, "LIMIT");
  insist(!db.prepare(`SELECT 1 AS orphan FROM postgres_sync_commit_receipts r
    LEFT JOIN postgres_sync_outbox o ON o.sequence = r.outbox_sequence WHERE o.sequence IS NULL LIMIT 1`).get());
  const rows = db.prepare(`SELECT o.*, r.outbox_sequence AS receipt_sequence, r.batch_id AS receipt_batch_id,
    r.source_transaction_id, r.recorded_at, r.payload_sha256 AS receipt_digest, r.chain_hash AS receipt_chain
    FROM postgres_sync_outbox o LEFT JOIN postgres_sync_commit_receipts r ON r.outbox_sequence = o.sequence
    ORDER BY o.sequence LIMIT ?`).all(MAX_ROWS + 1);
  insist(rows.length <= MAX_ROWS, "LIMIT");
  let previous = "";
  let sequence = 0;
  const seen = new Set();
  const versions = new Map();
  return rows.map((row) => {
    let result;
    try { result = validateRow(row); } catch (error) {
      throw error?.code === "SQLITE_OUTBOX_RECEIPT_MISSING" ? error : fail("INTEGRITY");
    }
    insist(row.sequence > sequence && row.previous_chain_hash === previous
      && !seen.has(row.source_transaction_id));
    sequence = row.sequence;
    previous = row.chain_hash;
    seen.add(row.source_transaction_id);
    // A delete retains the last version; any later recreation is its successor,
    // never a reset to version 1. This wrapper itself exposes no delete command.
    for (const change of result.batch.changes) {
      insist(change.sourceVersion === (versions.get(change.collection) ?? 0) + 1);
      versions.set(change.collection, change.sourceVersion);
    }
    return result;
  });
}

function safeError(error) {
  return /^SQLITE_OUTBOX_(RECEIPT|SOURCE)_[A-Z_]+$/.test(error?.code || "") ? error : fail("STORAGE_FAILED");
}

// Partial upserts only: keys not listed in entries are retained, never deleted.
// The synchronous wrapper owns BEGIN/COMMIT; callers cannot supply transaction IDs.
function commitSqliteOutboxTransaction(db, input) {
  return commitTransaction(db, input, false);
}

function commitSqliteBoundOutboxTransaction(db, input) {
  return commitTransaction(db, input, true);
}

function commitTransaction(db, input, requireIdentity) {
  let begun = false;
  try {
    fields(input, ["entries", "expectedVersions", "sourceEvent"], "INVALID_INPUT");
    const { entries, expectedVersions, sourceEvent } = input;
    insist(Array.isArray(entries) && entries.length > 0 && entries.length <= 100
      && object(expectedVersions) && text(sourceEvent), "INVALID_INPUT");
    jsonValue(entries);
    const names = new Set();
    for (const entry of entries) {
      insist(Array.isArray(entry) && entry.length === 2 && typeof entry[0] === "string"
        && COLLECTION.test(entry[0]) && entry[0] !== "storageMeta" && !names.has(entry[0]), "INVALID_INPUT");
      names.add(entry[0]);
      jsonValue(entry[1]);
    }
    fields(expectedVersions, [...names], "INVALID_INPUT");
    for (const name of names) {
      insist(Number.isSafeInteger(expectedVersions[name]) && expectedVersions[name] >= 0, "INVALID_INPUT");
    }
    insist(Buffer.byteLength(canonicalStringify(entries)) <= MAX_BYTES / 2, "LIMIT");
    // BEGIN failure must never roll back a transaction owned by the caller.
    try { db.exec("BEGIN IMMEDIATE"); } catch { throw fail("TRANSACTION_REQUIRED"); }
    begun = true;
    const transactionId = randomUUID();
    const recordedAt = new Date().toISOString();
    const identity = readSqliteOutboxSourceIdentity(db, { required: requireIdentity });
    const history = scan(db);
    checkGenesis(identity, history);
    if (identity && !identity.genesis) {
      for (const table of ["state_collections", "storage_events"]) {
        insist(!db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get(), "SOURCE_GENESIS_INVALID");
      }
    }
    const latest = new Map(history.flatMap(({ batch }) => batch.changes.map((change) => [change.collection, change])));
    const existing = [];
    const lookup = db.prepare("SELECT key, payload, version FROM state_collections WHERE key = ?");
    for (const [key] of entries) {
      const row = lookup.get(key);
      insist(!row || (Number.isSafeInteger(row.version) && row.version > 0 && row.version < Number.MAX_SAFE_INTEGER));
      let digest;
      if (row) {
        insist(typeof row.payload === "string" && Buffer.byteLength(row.payload) <= MAX_BYTES);
        let parsed;
        try { parsed = JSON.parse(row.payload); jsonValue(parsed); } catch { throw fail("INTEGRITY"); }
        insist(JSON.stringify(parsed) === row.payload);
        digest = hash(canonicalStringify(parsed));
      }
      const last = latest.get(key);
      // This slice starts new synthetic collections at v1; importing a baseline
      // or certifying previously persisted state is not an authorized operation.
      insist(Boolean(last) === Boolean(row));
      if (last) {
        insist(last.operation === "upsert" && row?.version === last.sourceVersion && digest === last.payloadSha256);
      }
      insist((row?.version ?? 0) === expectedVersions[key], "VERSION_CONFLICT");
      if (row) existing.push(row);
    }
    const changes = buildCollectionChanges(existing, entries);
    insist(changes.length > 0, "NO_CHANGES");
    const write = db.prepare(`INSERT INTO state_collections(key,payload,updated_at,version) VALUES(?,?,?,?)
      ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at,version=excluded.version`);
    for (const change of changes) {
      insist(change.operation === "upsert");
      const entry = entries.find(([key]) => key === change.collection);
      write.run(change.collection, JSON.stringify(entry[1]), recordedAt, change.sourceVersion);
    }
    const batch = enqueuePostgresSyncBatch(db, changes, { createdAt: recordedAt, sourceEvent });
    const row = db.prepare("SELECT sequence FROM postgres_sync_outbox WHERE batch_id = ?").get(batch.batchId);
    insist(Number.isSafeInteger(row?.sequence) && row.sequence > 0);
    db.prepare(`INSERT INTO postgres_sync_commit_receipts
      (outbox_sequence,batch_id,source_transaction_id,recorded_at,payload_sha256,chain_hash) VALUES(?,?,?,?,?,?)`)
      .run(row.sequence, batch.batchId, transactionId, recordedAt, batch.payloadSha256, batch.chainHash);
    db.prepare("INSERT INTO storage_events(id,at,event,detail) VALUES(?,?,?,?)")
      .run(randomUUID(), recordedAt, sourceEvent, "synthetic isolated outbox transaction persisted");
    const committed = scan(db).at(-1);
    insist(committed?.commitment.sourceTransactionId === transactionId);
    if (identity && !identity.genesis) {
      db.prepare("INSERT INTO source_genesis(singleton,source_instance_id,outbox_sequence,batch_id,chain_hash) VALUES(1,?,?,?,?)")
        .run(identity.sourceInstanceId, row.sequence, batch.batchId, batch.chainHash);
    }
    checkGenesis(readSqliteOutboxSourceIdentity(db, { required: requireIdentity }), scan(db));
    db.exec("COMMIT");
    begun = false;
    return committed;
  } catch (error) {
    if (begun) { try { db.exec("ROLLBACK"); } catch { /* Preserve the stable original failure. */ } }
    throw safeError(error);
  }
}

function loadCommittedSqliteOutboxBatches(sqliteFile, options = {}) {
  return loadBatches(sqliteFile, options, false);
}

function loadBoundSqliteOutboxBatches(sqliteFile, options = {}) {
  return loadBatches(sqliteFile, options, true);
}

function loadBatches(sqliteFile, options, requireIdentity) {
  let db;
  try {
    insist(text(sqliteFile, 4096) && object(options)
      && Reflect.ownKeys(options).every((key) => ["after", "limit"].includes(key)
        && Object.hasOwn(Object.getOwnPropertyDescriptor(options, key), "value")), "INVALID_INPUT");
    const after = options.after === undefined ? null : options.after;
    const limit = options.limit === undefined ? 20 : options.limit;
    insist(Number.isSafeInteger(limit) && limit >= 1 && limit <= 100, "INVALID_INPUT");
    if (after !== null) {
      fields(after, ["outboxSequence", "batchId", "payloadSha256", "chainHash"], "CURSOR_INVALID");
      insist(Number.isSafeInteger(after.outboxSequence) && after.outboxSequence > 0
        && typeof after.batchId === "string" && /^pgsync-[a-f0-9]{32}$/.test(after.batchId)
        && typeof after.payloadSha256 === "string" && HASH.test(after.payloadSha256)
        && typeof after.chainHash === "string" && HASH.test(after.chainHash), "CURSOR_INVALID");
    }
    db = new DatabaseSync(sqliteFile, { readOnly: true });
    db.exec("PRAGMA query_only = ON; BEGIN");
    const identity = readSqliteOutboxSourceIdentity(db, { required: requireIdentity });
    const all = scan(db);
    checkGenesis(identity, all);
    let start = 0;
    if (after !== null) {
      const index = all.findIndex(({ commitment }) => commitment.outboxSequence === after.outboxSequence);
      insist(index >= 0 && all[index].batch.batchId === after.batchId
        && all[index].batch.payloadSha256 === after.payloadSha256 && all[index].batch.chainHash === after.chainHash, "CURSOR_INVALID");
      start = index + 1;
    }
    const result = all.slice(start, start + limit).map((item) => {
      if (!requireIdentity) return item;
      const envelope = deepFreeze({ sourceIdentity: { ...identity, genesis: { ...identity.genesis } }, ...item });
      brandedSources.set(envelope, envelope);
      return envelope;
    });
    db.exec("COMMIT");
    return result;
  } catch (error) {
    throw safeError(error);
  } finally {
    if (db) { try { db.close(); } catch { /* No path or SQL leakage from cleanup. */ } }
  }
}

module.exports = { createSqliteOutboxCommitReceiptSchema, commitSqliteOutboxTransaction, loadCommittedSqliteOutboxBatches,
  commitSqliteBoundOutboxTransaction, loadBoundSqliteOutboxBatches, resolveBrandedSourceEnvelope };
