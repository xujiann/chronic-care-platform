"use strict";

// Explicit synthetic/rehearsal port. No server or worker imports this module.
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const { resolveBrandedSourceEnvelope, loadBoundSqliteOutboxBatches } = require("./sqlite-outbox-commit-receipt");
const { canonicalStringify } = require("../../../scripts/postgres-migration-package");

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const SCHEMA = Object.freeze({
  checkpoint_meta: `CREATE TABLE checkpoint_meta (
    singleton INTEGER PRIMARY KEY CHECK(singleton=1), source_identity TEXT NOT NULL, target_instance_id TEXT NOT NULL)`,
  checkpoint_entries: `CREATE TABLE checkpoint_entries (
    outbox_sequence INTEGER PRIMARY KEY CHECK(outbox_sequence > 0),
    source_identity TEXT NOT NULL, target_instance_id TEXT NOT NULL,
    batch_id TEXT NOT NULL UNIQUE, payload_sha256 TEXT NOT NULL,
    previous_chain_hash TEXT NOT NULL, chain_hash TEXT NOT NULL)`,
  checkpoint_meta_no_update: `CREATE TRIGGER checkpoint_meta_no_update BEFORE UPDATE ON checkpoint_meta
    BEGIN SELECT RAISE(ABORT,'CHECKPOINT_IMMUTABLE'); END`,
  checkpoint_meta_no_delete: `CREATE TRIGGER checkpoint_meta_no_delete BEFORE DELETE ON checkpoint_meta
    BEGIN SELECT RAISE(ABORT,'CHECKPOINT_IMMUTABLE'); END`,
  checkpoint_meta_no_replace: `CREATE TRIGGER checkpoint_meta_no_replace BEFORE INSERT ON checkpoint_meta
    WHEN EXISTS(SELECT 1 FROM checkpoint_meta WHERE singleton=NEW.singleton)
    BEGIN SELECT RAISE(ABORT,'CHECKPOINT_IMMUTABLE'); END`,
  checkpoint_entries_no_update: `CREATE TRIGGER checkpoint_entries_no_update BEFORE UPDATE ON checkpoint_entries
    BEGIN SELECT RAISE(ABORT,'CHECKPOINT_IMMUTABLE'); END`,
  checkpoint_entries_no_delete: `CREATE TRIGGER checkpoint_entries_no_delete BEFORE DELETE ON checkpoint_entries
    BEGIN SELECT RAISE(ABORT,'CHECKPOINT_IMMUTABLE'); END`,
  checkpoint_entries_no_replace: `CREATE TRIGGER checkpoint_entries_no_replace BEFORE INSERT ON checkpoint_entries
    WHEN EXISTS(SELECT 1 FROM checkpoint_entries WHERE outbox_sequence=NEW.outbox_sequence OR batch_id=NEW.batch_id)
    BEGIN SELECT RAISE(ABORT,'CHECKPOINT_IMMUTABLE'); END`
});

class PrimaryCheckpointError extends Error {
  constructor(code) {
    super("Primary checkpoint validation failed");
    this.name = "PrimaryCheckpointError";
    this.code = `POSTGRES_PRIMARY_CHECKPOINT_${code}`;
  }
}

function insist(condition, code) { if (!condition) throw new PrimaryCheckpointError(code); }
function cursor(row) {
  return row && { outboxSequence: row.outbox_sequence, batchId: row.batch_id,
    payloadSha256: row.payload_sha256, chainHash: row.chain_hash };
}
function open(file, identity, targetId, initialize = false) {
  insist(typeof file === "string" && file.length > 0, "PATH_INVALID");
  insist(initialize || fs.existsSync(file), "MISSING");
  const db = new DatabaseSync(file);
  try {
  db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000");
  const version = db.prepare("PRAGMA user_version").get().user_version;
  if (version === 0 && initialize) {
    const existing = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
    insist(existing.length === 0, "SCHEMA_INVALID");
    db.exec(`BEGIN IMMEDIATE; ${Object.values(SCHEMA).join(";\n")}; PRAGMA user_version=1;`);
    db.prepare("INSERT INTO checkpoint_meta(singleton,source_identity,target_instance_id) VALUES(1,?,?)").run(identity, targetId);
    db.exec("COMMIT");
  } else insist(version === 1, "SCHEMA_INVALID");
  const objects = db.prepare("SELECT name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all();
  const normalize = (sql) => sql.replace(/\s+/g, " ").trim();
  insist(objects.length === Object.keys(SCHEMA).length
    && objects.every((row) => SCHEMA[row.name] && normalize(row.sql) === normalize(SCHEMA[row.name])), "SCHEMA_INVALID");
  const meta = db.prepare("SELECT source_identity,target_instance_id FROM checkpoint_meta WHERE singleton=1").all();
  insist(meta.length === 1 && meta[0].source_identity === identity && meta[0].target_instance_id === targetId,
    "IDENTITY_MISMATCH");
  return db;
  } catch (error) { db.close(); throw error; }
}

function scan(db, identity, targetId) {
  const rows = db.prepare("SELECT * FROM checkpoint_entries ORDER BY outbox_sequence").all();
  let prior = null;
  for (const row of rows) {
    insist(Number.isSafeInteger(row.outbox_sequence) && row.outbox_sequence === (prior ? prior.outbox_sequence + 1 : 1)
      && row.source_identity === identity && row.target_instance_id === targetId
      && typeof row.batch_id === "string" && row.batch_id.length > 0
      && HASH.test(row.payload_sha256) && HASH.test(row.chain_hash)
      && row.previous_chain_hash === (prior ? prior.chain_hash : ""), "DRIFT");
    prior = row;
  }
  return prior;
}

function createPrimaryDurableCheckpoint({ checkpointFile, sourceFile, driver, expectedTargetId }) {
  insist(typeof sourceFile === "string" && sourceFile.length > 0 && UUID.test(expectedTargetId)
    && driver?.status?.().supportsBoundIdentity === true && typeof driver.transaction === "function", "INPUT_INVALID");
  function sourceAt(after) {
    const rows = loadBoundSqliteOutboxBatches(sourceFile, after ? { after, limit: 1 } : { limit: 1 });
    return rows[0] || null;
  }
  function sourceAtSequence(sequence) {
    let after = null;
    for (let page = 0; page < 10; page += 1) {
      const rows = loadBoundSqliteOutboxBatches(sourceFile, after ? { after, limit: 100 } : { limit: 100 });
      const found = rows.find((item) => item.commitment.outboxSequence === sequence);
      if (found) return found;
      if (rows.length < 100) break;
      const tail = rows.at(-1);
      after = { outboxSequence: tail.commitment.outboxSequence, batchId: tail.batch.batchId,
        payloadSha256: tail.batch.payloadSha256, chainHash: tail.batch.chainHash };
    }
    throw new PrimaryCheckpointError("SOURCE_MISMATCH");
  }
  async function targetReceipt(envelope) {
    const source = resolveBrandedSourceEnvelope(envelope);
    const target = await driver.transaction({ isolation: "repeatable-read", readOnly: true,
      binding: { expectedTargetId, namespace: "health_platform", sourceEnvelope: envelope } },
    (tx) => tx.getAppliedBatch(source.batch.batchId));
    insist(target && target.batchId === source.batch.batchId
      && target.payloadSha256 === source.batch.payloadSha256
      && target.previousChainHash === source.batch.previousChainHash
      && target.chainHash === source.batch.chainHash
      && target.sourceTransactionId === source.commitment.sourceTransactionId
      && target.outboxSequence === source.commitment.outboxSequence
      && target.committedAt === source.commitment.committedAt
      && target.appliedChanges === source.batch.changes.length, "TARGET_MISMATCH");
  }
  async function verifyBoundTarget(envelope) {
    return driver.transaction({ isolation: "repeatable-read", readOnly: true,
      binding: { expectedTargetId, namespace: "health_platform", sourceEnvelope: envelope } },
    (tx) => tx.getLastAppliedBatch());
  }
  function last() {
    const first = sourceAt(null);
    insist(first, "SOURCE_EMPTY");
    const identity = canonicalStringify(first.sourceIdentity);
    const db = open(checkpointFile, identity, expectedTargetId);
    try { return { row: scan(db, identity, expectedTargetId), identity }; }
    finally { db.close(); }
  }
  return Object.freeze({
    async initialize() {
      insist(!fs.existsSync(checkpointFile), "ALREADY_INITIALIZED");
      const first = sourceAt(null);
      insist(first, "SOURCE_EMPTY");
      // A bound read transaction validates the actual target identity before creating an empty checkpoint.
      insist(await verifyBoundTarget(first) === null, "TARGET_NOT_EMPTY");
      const db = open(checkpointFile, canonicalStringify(first.sourceIdentity), expectedTargetId, true);
      db.close();
      return { schemaVersion: 1, sourceInstanceId: first.sourceIdentity.sourceInstanceId,
        targetInstanceId: expectedTargetId };
    },
    async read() {
      const { row } = last();
      if (!row) { await verifyBoundTarget(sourceAt(null)); return null; }
      // The source loader verifies the complete bounded source chain and cursor.
      loadBoundSqliteOutboxBatches(sourceFile, { after: cursor(row), limit: 1 });
      await targetReceipt(sourceAtSequence(row.outbox_sequence));
      return cursor(row);
    },
    async advance(envelope) {
      const source = resolveBrandedSourceEnvelope(envelope);
      const { row, identity } = last();
      const replay = row && row.outbox_sequence === source.commitment.outboxSequence
        && row.batch_id === source.batch.batchId && row.payload_sha256 === source.batch.payloadSha256
        && row.chain_hash === source.batch.chainHash;
      const expected = replay ? sourceAtSequence(row.outbox_sequence) : sourceAt(cursor(row));
      insist(expected && canonicalStringify(source.sourceIdentity) === identity
        && canonicalStringify(source.batch) === canonicalStringify(expected.batch)
        && canonicalStringify(source.commitment) === canonicalStringify(expected.commitment), "SOURCE_MISMATCH");
      await targetReceipt(envelope);
      if (replay) return cursor(row);
      const db = open(checkpointFile, identity, expectedTargetId);
      let begun = false;
      try {
        db.exec("BEGIN IMMEDIATE"); begun = true;
        const current = scan(db, identity, expectedTargetId);
        insist((current?.outbox_sequence || 0) === (row?.outbox_sequence || 0)
          && (current?.chain_hash || "") === (row?.chain_hash || ""), "CONFLICT");
        db.prepare(`INSERT INTO checkpoint_entries(outbox_sequence,source_identity,target_instance_id,
          batch_id,payload_sha256,previous_chain_hash,chain_hash) VALUES(?,?,?,?,?,?,?)`).run(
          source.commitment.outboxSequence, identity, expectedTargetId, source.batch.batchId,
          source.batch.payloadSha256, source.batch.previousChainHash, source.batch.chainHash);
        db.exec("COMMIT"); begun = false;
        return cursor({ outbox_sequence: source.commitment.outboxSequence, batch_id: source.batch.batchId,
          payload_sha256: source.batch.payloadSha256, chain_hash: source.batch.chainHash });
      } catch (error) {
        if (begun) db.exec("ROLLBACK");
        throw error;
      } finally { db.close(); }
    }
  });
}

module.exports = { PrimaryCheckpointError, createPrimaryDurableCheckpoint };
