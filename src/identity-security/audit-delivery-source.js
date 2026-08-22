"use strict";

const { createHash } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { verifyAuditTrail } = require("./audit-chain");

const AUDIT_DELIVERY_SOURCE_CONTRACT = "append-only-audit-source-v2";
const AUDIT_DELIVERY_PROJECTION_SCHEMA = "audit-delivery-minimal-projection-v1";
const AUDIT_DELIVERY_SOURCE_TABLE = "audit_delivery_source_events";
const AUDIT_TRAILS = Object.freeze(["securityEvents", "dataAccessLogs"]);
const SHA256 = /^[a-f0-9]{64}$/;

class AuditDeliverySourceError extends Error {
  constructor(message, code, details = undefined) {
    super(message);
    this.name = "AuditDeliverySourceError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function clean(value, maximum = 160) {
  return String(value || "").trim().replace(/[\r\n\t]+/g, " ").slice(0, maximum);
}

function requireTrail(value) {
  const trail = clean(value, 40);
  if (!AUDIT_TRAILS.includes(trail)) {
    throw new AuditDeliverySourceError("audit delivery source trail is invalid", "AUDIT_SOURCE_TRAIL_INVALID");
  }
  return trail;
}

function requireEventId(value) {
  const id = clean(value, 160);
  if (id.length < 1) {
    throw new AuditDeliverySourceError("audit delivery source event id is required", "AUDIT_SOURCE_EVENT_ID_REQUIRED");
  }
  return id;
}

function sourceRecordValue(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new AuditDeliverySourceError("audit delivery source record is invalid", "AUDIT_SOURCE_RECORD_INVALID");
  }
  const { auditHash, previousAuditHash, ...value } = record;
  return value;
}

function resultCode(value) {
  const result = clean(value, 80).toLowerCase();
  if (["允许", "allowed", "allow", "success", "succeeded"].includes(result)) return "allowed";
  if (["拒绝", "denied", "deny", "failed", "failure", "blocked"].includes(result)) return "denied";
  return "unknown";
}

function referenceDigest(label, value) {
  const normalized = clean(value, 1000);
  return normalized ? sha256(`${label}:${normalized}`) : "";
}

function buildAuditDeliveryProjection(trailValue, recordValue) {
  const trail = requireTrail(trailValue);
  const record = sourceRecordValue(recordValue);
  const sourceEventId = requireEventId(record.id);
  const occurredAt = clean(record.at || record.createdAt, 80);
  if (!occurredAt) {
    throw new AuditDeliverySourceError("audit delivery source timestamp is required", "AUDIT_SOURCE_TIMESTAMP_REQUIRED");
  }
  const access = trail === "dataAccessLogs";
  const projection = {
    schemaVersion: AUDIT_DELIVERY_PROJECTION_SCHEMA,
    stream: trail,
    sourceEventId,
    occurredAt,
    classification: access ? "restricted-data-access" : "security-event",
    action: access ? "data-access" : clean(record.action || "security-event", 120),
    result: resultCode(record.result),
    role: clean(record.role || "unknown", 120),
    actorRefDigest: referenceDigest("actor", record.actor),
    subjectRefDigest: access
      ? referenceDigest("subject", record.personIndex || record.residentId)
      : "",
    targetRefDigest: access
      ? referenceDigest("target", record.scope)
      : referenceDigest("target", record.target)
  };
  return Object.freeze(projection);
}

function buildAuditDeliverySourceCandidate(trail, record, options = {}) {
  const projection = buildAuditDeliveryProjection(trail, record);
  const sourceValue = sourceRecordValue(record);
  const sourceDigest = sha256(stableStringify({
    stream: projection.stream,
    sourceEventId: projection.sourceEventId,
    record: sourceValue
  }));
  const projectionJson = stableStringify(projection);
  return Object.freeze({
    stream: projection.stream,
    sourceEventId: projection.sourceEventId,
    occurredAt: projection.occurredAt,
    sourceDigest,
    projection,
    projectionJson,
    projectionDigest: sha256(projectionJson),
    historicalBaseline: options.historicalBaseline === true
  });
}

function createAuditDeliverySourceSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_delivery_source_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      stream TEXT NOT NULL CHECK (stream IN ('securityEvents', 'dataAccessLogs')),
      source_event_id TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      source_digest TEXT NOT NULL CHECK (length(source_digest) = 64),
      projection_schema TEXT NOT NULL CHECK (projection_schema = 'audit-delivery-minimal-projection-v1'),
      projection_json TEXT NOT NULL,
      projection_digest TEXT NOT NULL CHECK (length(projection_digest) = 64),
      previous_source_hash TEXT NOT NULL DEFAULT ''
        CHECK (previous_source_hash = '' OR length(previous_source_hash) = 64),
      source_hash TEXT NOT NULL UNIQUE CHECK (length(source_hash) = 64),
      historical_baseline INTEGER NOT NULL DEFAULT 0 CHECK (historical_baseline IN (0, 1)),
      recorded_at TEXT NOT NULL,
      UNIQUE (stream, source_event_id)
    );
    CREATE INDEX IF NOT EXISTS idx_audit_delivery_source_stream_sequence
      ON audit_delivery_source_events(stream, sequence);
    CREATE INDEX IF NOT EXISTS idx_audit_delivery_source_occurred_at
      ON audit_delivery_source_events(occurred_at, sequence);
    CREATE TRIGGER IF NOT EXISTS audit_delivery_source_no_update
      BEFORE UPDATE ON audit_delivery_source_events
      BEGIN
        SELECT RAISE(ABORT, 'audit delivery source is append-only');
      END;
    CREATE TRIGGER IF NOT EXISTS audit_delivery_source_no_delete
      BEFORE DELETE ON audit_delivery_source_events
      BEGIN
        SELECT RAISE(ABORT, 'audit delivery source is append-only');
      END;
  `);
}

function auditSourceHash(value) {
  return sha256(stableStringify({
    contract: AUDIT_DELIVERY_SOURCE_CONTRACT,
    sequence: value.sequence,
    stream: value.stream,
    sourceEventId: value.sourceEventId,
    occurredAt: value.occurredAt,
    sourceDigest: value.sourceDigest,
    projectionDigest: value.projectionDigest,
    previousSourceHash: value.previousSourceHash,
    historicalBaseline: value.historicalBaseline === true,
    recordedAt: value.recordedAt
  }));
}

function insertAuditDeliverySourceCandidate(db, candidate, options = {}) {
  const existing = db.prepare(`
    SELECT source_digest, projection_digest
    FROM audit_delivery_source_events
    WHERE stream = ? AND source_event_id = ?
  `).get(candidate.stream, candidate.sourceEventId);
  if (existing) {
    if (existing.source_digest !== candidate.sourceDigest || existing.projection_digest !== candidate.projectionDigest) {
      throw new AuditDeliverySourceError(
        "audit delivery source event id was reused with different content",
        "AUDIT_SOURCE_EVENT_CONFLICT",
        { stream: candidate.stream, sourceEventId: candidate.sourceEventId }
      );
    }
    return { inserted: false, sequence: 0, sourceHash: "" };
  }
  const head = db.prepare(`
    SELECT sequence, source_hash
    FROM audit_delivery_source_events
    ORDER BY sequence DESC
    LIMIT 1
  `).get();
  const sequence = Number(head?.sequence || 0) + 1;
  const recordedAt = clean(options.recordedAt || new Date().toISOString(), 80);
  const row = {
    sequence,
    stream: candidate.stream,
    sourceEventId: candidate.sourceEventId,
    occurredAt: candidate.occurredAt,
    sourceDigest: candidate.sourceDigest,
    projectionDigest: candidate.projectionDigest,
    previousSourceHash: String(head?.source_hash || ""),
    historicalBaseline: candidate.historicalBaseline === true,
    recordedAt
  };
  const sourceHash = auditSourceHash(row);
  db.prepare(`
    INSERT INTO audit_delivery_source_events (
      sequence, stream, source_event_id, occurred_at, source_digest,
      projection_schema, projection_json, projection_digest,
      previous_source_hash, source_hash, historical_baseline, recorded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sequence,
    row.stream,
    row.sourceEventId,
    row.occurredAt,
    row.sourceDigest,
    AUDIT_DELIVERY_PROJECTION_SCHEMA,
    candidate.projectionJson,
    row.projectionDigest,
    row.previousSourceHash,
    sourceHash,
    row.historicalBaseline ? 1 : 0,
    row.recordedAt
  );
  return { inserted: true, sequence, sourceHash };
}

function verifiedTrail(value, trail) {
  const rows = Array.isArray(value) ? value : [];
  const verification = verifyAuditTrail(rows);
  if (!verification.passed) {
    throw new AuditDeliverySourceError(
      `audit trail ${trail} failed integrity verification`,
      "AUDIT_SOURCE_TRAIL_INTEGRITY_FAILED",
      { trail }
    );
  }
  return rows;
}

function candidateOrder(left, right) {
  const leftTime = Date.parse(left.occurredAt);
  const rightTime = Date.parse(right.occurredAt);
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) return leftTime - rightTime;
  const occurred = left.occurredAt.localeCompare(right.occurredAt);
  if (occurred !== 0) return occurred;
  const stream = left.stream.localeCompare(right.stream);
  return stream !== 0 ? stream : left.sourceEventId.localeCompare(right.sourceEventId);
}

function appendAuditDeliverySourceChanges(db, previousState = {}, nextState = {}, options = {}) {
  createAuditDeliverySourceSchema(db);
  const candidates = [];
  for (const trail of AUDIT_TRAILS) {
    const previous = verifiedTrail(previousState[trail], trail);
    const next = verifiedTrail(nextState[trail], trail);
    const previousById = new Map(previous.map((record) => {
      const candidate = buildAuditDeliverySourceCandidate(trail, record);
      return [candidate.sourceEventId, candidate];
    }));
    for (const record of next) {
      const candidate = buildAuditDeliverySourceCandidate(trail, record, options);
      const prior = previousById.get(candidate.sourceEventId);
      if (prior && (prior.sourceDigest !== candidate.sourceDigest || prior.projectionDigest !== candidate.projectionDigest)) {
        throw new AuditDeliverySourceError(
          "audit trail event id was reused with different content",
          "AUDIT_SOURCE_EVENT_CONFLICT",
          { trail, sourceEventId: candidate.sourceEventId }
        );
      }
      candidates.push(candidate);
    }
  }
  candidates.sort(candidateOrder);
  const inserted = candidates.map((candidate) => insertAuditDeliverySourceCandidate(db, candidate, options))
    .filter((item) => item.inserted);
  return Object.freeze({
    inserted: inserted.length,
    firstSequence: inserted[0]?.sequence || 0,
    lastSequence: inserted.at(-1)?.sequence || 0,
    sourceHeadHash: inserted.at(-1)?.sourceHash || ""
  });
}

function parseCollectionPayload(row, trail) {
  if (!row) return [];
  try {
    return JSON.parse(row.payload);
  } catch {
    throw new AuditDeliverySourceError(
      `audit trail ${trail} payload is not valid JSON`,
      "AUDIT_SOURCE_TRAIL_PAYLOAD_INVALID",
      { trail }
    );
  }
}

function backfillAuditDeliverySourceFromCollections(db, options = {}) {
  createAuditDeliverySourceSchema(db);
  const state = {};
  const statement = db.prepare("SELECT payload FROM state_collections WHERE key = ?");
  for (const trail of AUDIT_TRAILS) state[trail] = parseCollectionPayload(statement.get(trail), trail);
  return appendAuditDeliverySourceChanges(db, {}, state, {
    historicalBaseline: true,
    recordedAt: options.recordedAt
  });
}

function sourceRow(row) {
  let projection;
  try {
    projection = JSON.parse(row.projection_json);
  } catch {
    throw new AuditDeliverySourceError("audit delivery source projection is invalid", "AUDIT_SOURCE_CORRUPT");
  }
  const value = {
    sequence: Number(row.sequence),
    stream: String(row.stream),
    sourceEventId: String(row.source_event_id),
    occurredAt: String(row.occurred_at),
    sourceDigest: String(row.source_digest),
    projectionDigest: String(row.projection_digest),
    previousSourceHash: String(row.previous_source_hash || ""),
    sourceHash: String(row.source_hash),
    historicalBaseline: Number(row.historical_baseline) === 1,
    recordedAt: String(row.recorded_at),
    projection
  };
  const projectionJson = stableStringify(projection);
  if (!Number.isSafeInteger(value.sequence)
    || value.sequence < 1
    || !SHA256.test(value.sourceDigest)
    || !SHA256.test(value.projectionDigest)
    || (value.previousSourceHash && !SHA256.test(value.previousSourceHash))
    || !SHA256.test(value.sourceHash)
    || projection.schemaVersion !== AUDIT_DELIVERY_PROJECTION_SCHEMA
    || projection.stream !== value.stream
    || projection.sourceEventId !== value.sourceEventId
    || sha256(projectionJson) !== value.projectionDigest
    || auditSourceHash(value) !== value.sourceHash) {
    throw new AuditDeliverySourceError("audit delivery source row failed integrity validation", "AUDIT_SOURCE_CORRUPT");
  }
  return value;
}

function readAuditDeliverySourceBatch(sqliteFile, options = {}) {
  const afterCursor = Number(options.afterCursor || 0);
  const expectedSourceHeadHash = String(options.expectedSourceHeadHash || "").trim().toLowerCase();
  const limit = Math.min(1000, Math.max(1, Number(options.limit || 200) || 200));
  if (!Number.isSafeInteger(afterCursor) || afterCursor < 0) {
    throw new AuditDeliverySourceError("audit delivery source cursor is invalid", "AUDIT_SOURCE_CURSOR_INVALID");
  }
  if ((afterCursor === 0 && expectedSourceHeadHash)
    || (afterCursor > 0 && !SHA256.test(expectedSourceHeadHash))) {
    throw new AuditDeliverySourceError("audit delivery source cursor binding is invalid", "AUDIT_SOURCE_CURSOR_BINDING_INVALID");
  }
  const db = new DatabaseSync(sqliteFile, { readOnly: true });
  try {
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(AUDIT_DELIVERY_SOURCE_TABLE);
    if (!table) throw new AuditDeliverySourceError("audit delivery source schema is unavailable", "AUDIT_SOURCE_SCHEMA_UNAVAILABLE");
    const head = db.prepare("SELECT sequence, source_hash FROM audit_delivery_source_events ORDER BY sequence DESC LIMIT 1").get();
    const headCursor = Number(head?.sequence || 0);
    if (afterCursor > headCursor) {
      throw new AuditDeliverySourceError("audit delivery source cursor is ahead of source head", "AUDIT_SOURCE_CURSOR_AHEAD");
    }
    let previousHash = "";
    if (afterCursor > 0) {
      const previous = db.prepare("SELECT source_hash FROM audit_delivery_source_events WHERE sequence = ?").get(afterCursor);
      if (!previous || !SHA256.test(String(previous.source_hash || ""))) {
        throw new AuditDeliverySourceError("audit delivery source cursor does not exist", "AUDIT_SOURCE_CURSOR_GAP");
      }
      previousHash = String(previous.source_hash);
      if (previousHash !== expectedSourceHeadHash) {
        throw new AuditDeliverySourceError("audit delivery source cursor does not match its checkpoint hash", "AUDIT_SOURCE_CURSOR_BINDING_MISMATCH");
      }
    }
    const rows = db.prepare(`
      SELECT sequence, stream, source_event_id, occurred_at, source_digest,
             projection_json, projection_digest, previous_source_hash, source_hash,
             historical_baseline, recorded_at
      FROM audit_delivery_source_events
      WHERE sequence > ?
      ORDER BY sequence
      LIMIT ?
    `).all(afterCursor, limit).map(sourceRow);
    let expected = afterCursor + 1;
    for (const row of rows) {
      if (row.sequence !== expected || row.previousSourceHash !== previousHash) {
        throw new AuditDeliverySourceError("audit delivery source sequence is discontinuous", "AUDIT_SOURCE_SEQUENCE_GAP");
      }
      expected += 1;
      previousHash = row.sourceHash;
    }
    return Object.freeze({
      contract: AUDIT_DELIVERY_SOURCE_CONTRACT,
      afterCursor,
      startCursor: rows[0]?.sequence || afterCursor,
      endCursor: rows.at(-1)?.sequence || afterCursor,
      sourceHeadHash: rows.at(-1)?.sourceHash || previousHash,
      databaseHeadCursor: headCursor,
      databaseHeadHash: String(head?.source_hash || ""),
      records: Object.freeze(rows.map((row) => Object.freeze({
        trail: row.stream,
        record: row.projection,
        cursor: row.sequence,
        sourceHash: row.sourceHash
      })))
    });
  } finally {
    db.close();
  }
}

const auditDeliverySourceMigrationFingerprintDependencies = Object.freeze([
  stableStringify,
  sha256,
  clean,
  requireTrail,
  requireEventId,
  sourceRecordValue,
  resultCode,
  referenceDigest,
  buildAuditDeliveryProjection,
  buildAuditDeliverySourceCandidate,
  createAuditDeliverySourceSchema,
  auditSourceHash,
  insertAuditDeliverySourceCandidate,
  verifiedTrail,
  candidateOrder,
  appendAuditDeliverySourceChanges,
  parseCollectionPayload,
  backfillAuditDeliverySourceFromCollections
]);

module.exports = {
  AUDIT_DELIVERY_PROJECTION_SCHEMA,
  AUDIT_DELIVERY_SOURCE_CONTRACT,
  AUDIT_DELIVERY_SOURCE_TABLE,
  AUDIT_TRAILS,
  AuditDeliverySourceError,
  appendAuditDeliverySourceChanges,
  auditDeliverySourceMigrationFingerprintDependencies,
  auditSourceHash,
  backfillAuditDeliverySourceFromCollections,
  buildAuditDeliveryProjection,
  buildAuditDeliverySourceCandidate,
  createAuditDeliverySourceSchema,
  readAuditDeliverySourceBatch,
  stableStringify
};
