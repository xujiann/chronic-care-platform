"use strict";

const fs = require("node:fs");
const path = require("node:path");

function checkpointError(code, message, statusCode = 409) {
  return Object.assign(new Error(message), { code, statusCode });
}

function clean(value, maximum = 240) {
  return String(value || "").trim().replace(/[\r\n\t]+/g, " ").slice(0, maximum);
}

function openSqliteCheckpointStore(options = {}) {
  const file = path.resolve(clean(options.file, 2000));
  if (!clean(options.file, 2000)) {
    throw checkpointError(
      "SHADOW_RELAY_CHECKPOINT_FILE_REQUIRED",
      "shadow relay checkpoint file is required",
      400
    );
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const DatabaseSync = options.DatabaseSync || require("node:sqlite").DatabaseSync;
  const database = new DatabaseSync(file);
  database.exec("PRAGMA journal_mode=WAL");
  database.exec("PRAGMA synchronous=FULL");
  database.exec("PRAGMA busy_timeout=5000");
  database.exec(`
    CREATE TABLE IF NOT EXISTS shadow_relay_checkpoints (
      relay_id TEXT PRIMARY KEY,
      sequence INTEGER NOT NULL CHECK (sequence >= 0),
      event_id TEXT NOT NULL,
      payload_digest TEXT NOT NULL,
      relay_digest TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT
  `);
  const select = database.prepare(`
    SELECT relay_id, sequence, event_id, payload_digest, relay_digest, updated_at
    FROM shadow_relay_checkpoints
    WHERE relay_id = ?
  `);
  const upsert = database.prepare(`
    INSERT INTO shadow_relay_checkpoints (
      relay_id, sequence, event_id, payload_digest, relay_digest, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(relay_id) DO UPDATE SET
      sequence = excluded.sequence,
      event_id = excluded.event_id,
      payload_digest = excluded.payload_digest,
      relay_digest = excluded.relay_digest,
      updated_at = excluded.updated_at
    WHERE excluded.sequence > shadow_relay_checkpoints.sequence
       OR (
         excluded.sequence = shadow_relay_checkpoints.sequence
         AND excluded.event_id = shadow_relay_checkpoints.event_id
         AND excluded.payload_digest = shadow_relay_checkpoints.payload_digest
         AND excluded.relay_digest = shadow_relay_checkpoints.relay_digest
       )
  `);
  let closed = false;

  function requireOpen() {
    if (closed) {
      throw checkpointError(
        "SHADOW_RELAY_CHECKPOINT_CLOSED",
        "shadow relay checkpoint store is closed",
        503
      );
    }
  }

  function publicRow(row) {
    if (!row) return null;
    return Object.freeze({
      relayId: String(row.relay_id),
      sequence: Number(row.sequence),
      eventId: String(row.event_id),
      payloadDigest: String(row.payload_digest),
      relayDigest: String(row.relay_digest),
      updatedAt: String(row.updated_at)
    });
  }

  async function load(relayId) {
    requireOpen();
    return publicRow(select.get(clean(relayId, 160)));
  }

  async function save(input = {}) {
    requireOpen();
    const relayId = clean(input.relayId, 160);
    const sequence = Number(input.sequence);
    const eventId = clean(input.eventId, 240);
    const payloadDigest = clean(input.payloadDigest, 80);
    const relayDigest = clean(input.relayDigest, 80);
    if (!relayId || !Number.isSafeInteger(sequence) || sequence < 0 || !eventId
      || !/^sha256:[a-f0-9]{64}$/.test(payloadDigest)
      || !/^sha256:[a-f0-9]{64}$/.test(relayDigest)) {
      throw checkpointError(
        "SHADOW_RELAY_CHECKPOINT_INVALID",
        "shadow relay checkpoint is invalid",
        400
      );
    }
    const current = publicRow(select.get(relayId));
    if (current && sequence < current.sequence) {
      throw checkpointError(
        "SHADOW_RELAY_CHECKPOINT_REGRESSION",
        "shadow relay checkpoint cannot move backwards"
      );
    }
    const updatedAt = new Date(options.now?.() || new Date().toISOString()).toISOString();
    const result = upsert.run(
      relayId,
      sequence,
      eventId,
      payloadDigest,
      relayDigest,
      updatedAt
    );
    const saved = publicRow(select.get(relayId));
    if (
      result.changes === 0
      && (
        saved?.sequence !== sequence
        || saved?.eventId !== eventId
        || saved?.payloadDigest !== payloadDigest
        || saved?.relayDigest !== relayDigest
      )
    ) {
      throw checkpointError(
        "SHADOW_RELAY_CHECKPOINT_CONFLICT",
        "shadow relay checkpoint sequence was reused with different evidence"
      );
    }
    return saved;
  }

  async function close() {
    if (closed) return;
    database.close();
    closed = true;
  }

  return Object.freeze({
    file,
    load,
    save,
    close,
    credentialsPersisted: false,
    productionReady: false
  });
}

module.exports = { openSqliteCheckpointStore };
