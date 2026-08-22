"use strict";

const { createHash, randomBytes } = require("node:crypto");

const OUTBOX_CONTRACT = "citizen-chronic.followup-dispatch-outbox.v1";
const EVENT_TYPE = "citizen-chronic.followup-updated.v1";
const EVENT_VERSION = 1;
const STATUS_VALUES = new Set(["pending", "leased", "delivered", "dead-letter"]);

class FollowupDispatchOutboxError extends Error {
  constructor(code, message, statusCode = 409) {
    super(message);
    this.name = "FollowupDispatchOutboxError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(typeof value === "string" ? value : stableStringify(value)).digest("hex")}`;
}

function requiredText(value, label, maximum = 240) {
  const result = String(value || "").trim();
  if (!result || result.length > maximum || /[\r\n\t]/.test(result)) {
    throw new FollowupDispatchOutboxError("FOLLOWUP_DISPATCH_SOURCE_INVALID", `${label} is missing or invalid`);
  }
  return result;
}

function requiredDigest(value, label) {
  const result = String(value || "").trim().toLowerCase();
  if (!/^sha256:[a-f0-9]{64}$/.test(result)) {
    throw new FollowupDispatchOutboxError("FOLLOWUP_DISPATCH_DIGEST_INVALID", `${label} must be a SHA-256 digest`);
  }
  return result;
}

function iso(value, label = "time") {
  const timestamp = Date.parse(String(value || ""));
  if (!Number.isFinite(timestamp)) {
    throw new FollowupDispatchOutboxError("FOLLOWUP_DISPATCH_TIME_INVALID", `${label} is invalid`);
  }
  return new Date(timestamp).toISOString();
}

function normalizeEvent(event = {}) {
  const eventId = requiredText(event.id || event.eventId, "eventId");
  const aggregateId = requiredText(event.aggregateId, "aggregateId");
  const eventType = requiredText(event.type || event.eventType, "eventType", 160);
  const eventVersion = Number(event.eventVersion || EVENT_VERSION);
  const aggregateVersion = Number(event.aggregateVersion);
  const correlationId = requiredText(event.correlationId, "correlationId");
  const payload = event.payload || {};
  const normalizedPayload = {
    followupId: requiredText(payload.followupId, "payload.followupId"),
    status: requiredText(payload.status, "payload.status", 80),
    updatedAt: iso(payload.updatedAt, "payload.updatedAt"),
    version: Number(payload.version)
  };
  if (eventType !== EVENT_TYPE || eventVersion !== EVENT_VERSION
    || !Number.isSafeInteger(aggregateVersion) || aggregateVersion < 1
    || !Number.isSafeInteger(normalizedPayload.version)
    || normalizedPayload.version !== aggregateVersion
    || normalizedPayload.followupId !== aggregateId) {
    throw new FollowupDispatchOutboxError("FOLLOWUP_DISPATCH_SOURCE_INVALID", "followup dispatch event contract is invalid");
  }
  const source = {
    contract: OUTBOX_CONTRACT,
    eventId,
    eventType,
    eventVersion,
    aggregateId,
    aggregateVersion,
    correlationId,
    payload: normalizedPayload
  };
  return Object.freeze({ ...source, payloadDigest: sha256(normalizedPayload), sourceDigest: sha256(source) });
}

function createFollowupDispatchOutboxSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chronic_followup_dispatch_outbox (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      event_type TEXT NOT NULL CHECK (event_type = 'citizen-chronic.followup-updated.v1'),
      event_version INTEGER NOT NULL CHECK (event_version = 1),
      aggregate_id TEXT NOT NULL,
      aggregate_version INTEGER NOT NULL CHECK (aggregate_version > 0),
      correlation_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      payload_sha256 TEXT NOT NULL CHECK (substr(payload_sha256, 1, 7) = 'sha256:' AND length(payload_sha256) = 71 AND substr(payload_sha256, 8) NOT GLOB '*[^0-9a-f]*'),
      source_sha256 TEXT NOT NULL CHECK (substr(source_sha256, 1, 7) = 'sha256:' AND length(source_sha256) = 71 AND substr(source_sha256, 8) NOT GLOB '*[^0-9a-f]*'),
      status TEXT NOT NULL CHECK (status IN ('pending', 'leased', 'delivered', 'dead-letter')),
      attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
      next_attempt_at TEXT NOT NULL,
      lease_owner TEXT,
      lease_token_sha256 TEXT,
      lease_version INTEGER NOT NULL DEFAULT 0 CHECK (lease_version >= 0),
      lease_expires_at TEXT,
      receipt_sha256 TEXT,
      delivery_status TEXT,
      delivered_at TEXT,
      dead_lettered_at TEXT,
      last_error_code TEXT,
      last_error_sha256 TEXT,
      replay_count INTEGER NOT NULL DEFAULT 0 CHECK (replay_count >= 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK ((status = 'leased') = (lease_owner IS NOT NULL AND lease_token_sha256 IS NOT NULL AND lease_expires_at IS NOT NULL)),
      CHECK (lease_token_sha256 IS NULL OR (substr(lease_token_sha256, 1, 7) = 'sha256:' AND length(lease_token_sha256) = 71 AND substr(lease_token_sha256, 8) NOT GLOB '*[^0-9a-f]*')),
      CHECK (receipt_sha256 IS NULL OR (substr(receipt_sha256, 1, 7) = 'sha256:' AND length(receipt_sha256) = 71 AND substr(receipt_sha256, 8) NOT GLOB '*[^0-9a-f]*')),
      CHECK (last_error_sha256 IS NULL OR (substr(last_error_sha256, 1, 7) = 'sha256:' AND length(last_error_sha256) = 71 AND substr(last_error_sha256, 8) NOT GLOB '*[^0-9a-f]*')),
      CHECK ((status = 'delivered') = (receipt_sha256 IS NOT NULL AND delivered_at IS NOT NULL)),
      CHECK ((status = 'dead-letter') = (dead_lettered_at IS NOT NULL))
    );
    CREATE INDEX IF NOT EXISTS idx_chronic_followup_dispatch_due
      ON chronic_followup_dispatch_outbox(status, next_attempt_at, sequence);
    CREATE INDEX IF NOT EXISTS idx_chronic_followup_dispatch_lease_expiry
      ON chronic_followup_dispatch_outbox(status, lease_expires_at);
    CREATE TABLE IF NOT EXISTS chronic_followup_dispatch_replays (
      replay_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      replay_key_sha256 TEXT NOT NULL UNIQUE CHECK (substr(replay_key_sha256, 1, 7) = 'sha256:' AND length(replay_key_sha256) = 71 AND substr(replay_key_sha256, 8) NOT GLOB '*[^0-9a-f]*'),
      binding_sha256 TEXT NOT NULL CHECK (substr(binding_sha256, 1, 7) = 'sha256:' AND length(binding_sha256) = 71 AND substr(binding_sha256, 8) NOT GLOB '*[^0-9a-f]*'),
      event_id TEXT NOT NULL,
      actor_sha256 TEXT NOT NULL CHECK (substr(actor_sha256, 1, 7) = 'sha256:' AND length(actor_sha256) = 71 AND substr(actor_sha256, 8) NOT GLOB '*[^0-9a-f]*'),
      reason_sha256 TEXT NOT NULL CHECK (substr(reason_sha256, 1, 7) = 'sha256:' AND length(reason_sha256) = 71 AND substr(reason_sha256, 8) NOT GLOB '*[^0-9a-f]*'),
      prior_lease_version INTEGER NOT NULL,
      replayed_at TEXT NOT NULL,
      FOREIGN KEY (event_id) REFERENCES chronic_followup_dispatch_outbox(event_id)
    );
    CREATE TRIGGER IF NOT EXISTS trg_chronic_followup_dispatch_source_immutable
    BEFORE UPDATE OF event_id, event_type, event_version, aggregate_id, aggregate_version,
      correlation_id, payload_json, payload_sha256, source_sha256, created_at
    ON chronic_followup_dispatch_outbox
    BEGIN
      SELECT RAISE(ABORT, 'chronic followup dispatch source is immutable');
    END;
    CREATE TRIGGER IF NOT EXISTS trg_chronic_followup_dispatch_no_delete
    BEFORE DELETE ON chronic_followup_dispatch_outbox
    BEGIN
      SELECT RAISE(ABORT, 'chronic followup dispatch outbox cannot be deleted');
    END;
    CREATE TRIGGER IF NOT EXISTS trg_chronic_followup_dispatch_replay_no_update
    BEFORE UPDATE ON chronic_followup_dispatch_replays
    BEGIN
      SELECT RAISE(ABORT, 'chronic followup dispatch replay is append-only');
    END;
    CREATE TRIGGER IF NOT EXISTS trg_chronic_followup_dispatch_replay_no_delete
    BEFORE DELETE ON chronic_followup_dispatch_replays
    BEGIN
      SELECT RAISE(ABORT, 'chronic followup dispatch replay is append-only');
    END;
  `);
}

function embeddedEvents(state = {}) {
  const result = [];
  for (const followup of Array.isArray(state.followups) ? state.followups : []) {
    for (const event of Array.isArray(followup?.domainRuntime?.outbox) ? followup.domainRuntime.outbox : []) {
      if ((event.type || event.eventType) === EVENT_TYPE) result.push(event);
    }
  }
  return result;
}

function insertOrVerifyEvent(db, event, options = {}) {
  const normalized = normalizeEvent(event);
  const existing = db.prepare(`
    SELECT source_sha256 AS sourceDigest FROM chronic_followup_dispatch_outbox WHERE event_id = ?
  `).get(normalized.eventId);
  if (existing) {
    if (existing.sourceDigest !== normalized.sourceDigest) {
      throw new FollowupDispatchOutboxError("FOLLOWUP_DISPATCH_EVENT_ID_CONFLICT", "followup dispatch event id has immutable source drift");
    }
    return Object.freeze({ inserted: false, eventId: normalized.eventId });
  }
  const recordedAt = iso(options.recordedAt || new Date().toISOString(), "recordedAt");
  const candidateReceiptDigest = event.receiptDigest
    ? (/^sha256:/.test(event.receiptDigest) ? event.receiptDigest : `sha256:${event.receiptDigest}`)
    : null;
  const delivered = event.deliveryState === "published" && /^sha256:[a-f0-9]{64}$/.test(candidateReceiptDigest || "");
  const receiptDigest = delivered ? candidateReceiptDigest : null;
  db.prepare(`
    INSERT INTO chronic_followup_dispatch_outbox (
      event_id, event_type, event_version, aggregate_id, aggregate_version, correlation_id,
      payload_json, payload_sha256, source_sha256, status, attempts, max_attempts,
      next_attempt_at, receipt_sha256, delivery_status, delivered_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 5, ?, ?, ?, ?, ?, ?)
  `).run(
    normalized.eventId, normalized.eventType, normalized.eventVersion, normalized.aggregateId,
    normalized.aggregateVersion, normalized.correlationId, stableStringify(normalized.payload),
    normalized.payloadDigest, normalized.sourceDigest, delivered ? "delivered" : "pending",
    Number(event.attempts || 0), recordedAt, receiptDigest,
    delivered ? String(event.externalDeliveryStatus || "accepted") : null,
    delivered ? iso(event.publishedAt || recordedAt, "publishedAt") : null,
    recordedAt, recordedAt
  );
  return Object.freeze({ inserted: true, eventId: normalized.eventId });
}

function backfillFollowupDispatchOutboxFromCollections(db) {
  const row = db.prepare("SELECT payload FROM state_collections WHERE key = 'followups'").get();
  if (!row) return Object.freeze({ inserted: 0 });
  let followups;
  try {
    followups = JSON.parse(row.payload);
  } catch {
    throw new FollowupDispatchOutboxError("FOLLOWUP_DISPATCH_BACKFILL_INVALID", "followups snapshot is invalid JSON");
  }
  let inserted = 0;
  for (const event of embeddedEvents({ followups })) {
    if (insertOrVerifyEvent(db, event, { recordedAt: event.occurredAt || new Date().toISOString() }).inserted) inserted += 1;
  }
  return Object.freeze({ inserted });
}

function appendFollowupDispatchOutboxChanges(db, previousState, nextState, options = {}) {
  const previousIds = new Set(embeddedEvents(previousState).map((event) => String(event.id || event.eventId)));
  let inserted = 0;
  for (const event of embeddedEvents(nextState)) {
    const result = insertOrVerifyEvent(db, event, {
      recordedAt: options.recordedAt || event.occurredAt || new Date().toISOString()
    });
    if (result.inserted) {
      if (previousIds.has(result.eventId) && options.historicalBaseline !== true) {
        throw new FollowupDispatchOutboxError("FOLLOWUP_DISPATCH_SOURCE_MISSING", "persisted followup event is missing from durable outbox");
      }
      inserted += 1;
    }
  }
  return Object.freeze({ inserted });
}

function rowToEvent(row) {
  return Object.freeze({
    sequence: Number(row.sequence),
    eventId: row.event_id,
    eventType: row.event_type,
    eventVersion: Number(row.event_version),
    aggregateId: row.aggregate_id,
    aggregateVersion: Number(row.aggregate_version),
    correlationId: row.correlation_id,
    payload: JSON.parse(row.payload_json),
    payloadDigest: row.payload_sha256,
    status: row.status,
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    nextAttemptAt: row.next_attempt_at,
    leaseOwner: row.lease_owner || "",
    leaseVersion: Number(row.lease_version),
    leaseExpiresAt: row.lease_expires_at || "",
    receiptDigest: row.receipt_sha256 || "",
    deliveryStatus: row.delivery_status || "",
    deliveredAt: row.delivered_at || "",
    deadLetteredAt: row.dead_lettered_at || "",
    lastErrorCode: row.last_error_code || "",
    lastErrorDigest: row.last_error_sha256 || "",
    replayCount: Number(row.replay_count),
    productionReady: false
  });
}

function createSqliteFollowupDispatchRepository(db, options = {}) {
  if (!db || typeof db.prepare !== "function") throw new TypeError("SQLite database is required");
  const clock = typeof options.now === "function" ? options.now : () => new Date();
  const tokenFactory = typeof options.tokenFactory === "function" ? options.tokenFactory : () => randomBytes(32).toString("hex");
  const nowIso = () => iso(clock().toISOString(), "now");
  const getRow = (eventId) => db.prepare("SELECT * FROM chronic_followup_dispatch_outbox WHERE event_id = ?").get(eventId);
  const fenced = (input, at) => {
    const eventId = requiredText(input.eventId, "eventId");
    const workerId = requiredText(input.workerId, "workerId", 160);
    const leaseToken = requiredText(input.leaseToken, "leaseToken", 300);
    const leaseVersion = Number(input.leaseVersion);
    if (!Number.isSafeInteger(leaseVersion) || leaseVersion < 1) throw new FollowupDispatchOutboxError("FOLLOWUP_DISPATCH_STALE_LEASE", "lease version is invalid");
    const row = getRow(eventId);
    if (!row || row.status !== "leased" || row.lease_owner !== workerId
      || row.lease_token_sha256 !== sha256(leaseToken) || Number(row.lease_version) !== leaseVersion
      || Date.parse(row.lease_expires_at) <= Date.parse(at)) {
      throw new FollowupDispatchOutboxError("FOLLOWUP_DISPATCH_STALE_LEASE", "followup dispatch lease is stale or invalid");
    }
    return row;
  };

  return Object.freeze({
    enqueue(event, enqueueOptions = {}) {
      return insertOrVerifyEvent(db, event, { recordedAt: enqueueOptions.recordedAt || nowIso() });
    },
    claimBatch(input = {}) {
      const workerId = requiredText(input.workerId, "workerId", 160);
      const at = iso(input.at || nowIso(), "claimAt");
      const limit = Math.min(100, Math.max(1, Number(input.limit) || 20));
      const leaseSeconds = Math.min(900, Math.max(10, Number(input.leaseSeconds) || 60));
      const leaseExpiresAt = new Date(Date.parse(at) + leaseSeconds * 1000).toISOString();
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare(`
          UPDATE chronic_followup_dispatch_outbox
          SET status = 'dead-letter', dead_lettered_at = ?, lease_owner = NULL,
            lease_token_sha256 = NULL, lease_expires_at = NULL,
            last_error_code = 'FOLLOWUP_DISPATCH_LEASE_EXHAUSTED',
            last_error_sha256 = ?, updated_at = ?
          WHERE status = 'leased' AND lease_expires_at <= ? AND attempts >= max_attempts
        `).run(at, sha256("FOLLOWUP_DISPATCH_LEASE_EXHAUSTED"), at, at);
        db.prepare(`
          UPDATE chronic_followup_dispatch_outbox
          SET status = 'pending', next_attempt_at = ?, lease_owner = NULL,
            lease_token_sha256 = NULL, lease_expires_at = NULL, updated_at = ?
          WHERE status = 'leased' AND lease_expires_at <= ? AND attempts < max_attempts
        `).run(at, at, at);
        const rows = db.prepare(`
          SELECT * FROM chronic_followup_dispatch_outbox
          WHERE status = 'pending' AND next_attempt_at <= ?
          ORDER BY next_attempt_at, sequence LIMIT ?
        `).all(at, limit);
        const claims = rows.map((row) => {
          const leaseToken = tokenFactory();
          const leaseVersion = Number(row.lease_version) + 1;
          const changed = db.prepare(`
            UPDATE chronic_followup_dispatch_outbox
            SET status = 'leased', attempts = attempts + 1, lease_owner = ?,
              lease_token_sha256 = ?, lease_version = ?, lease_expires_at = ?, updated_at = ?
            WHERE event_id = ? AND status = 'pending'
          `).run(workerId, sha256(leaseToken), leaseVersion, leaseExpiresAt, at, row.event_id);
          if (Number(changed.changes) !== 1) throw new FollowupDispatchOutboxError("FOLLOWUP_DISPATCH_CLAIM_CONFLICT", "followup dispatch claim conflicted");
          return Object.freeze({ ...rowToEvent(getRow(row.event_id)), leaseToken });
        });
        db.exec("COMMIT");
        return Object.freeze(claims);
      } catch (error) {
        try { db.exec("ROLLBACK"); } catch { /* preserve the original claim error */ }
        throw error;
      }
    },
    markDelivered(input = {}) {
      const at = iso(input.deliveredAt || nowIso(), "deliveredAt");
      fenced(input, at);
      const receiptDigest = requiredDigest(input.receiptDigest, "receiptDigest");
      const deliveryStatus = requiredText(input.deliveryStatus || "accepted", "deliveryStatus", 40).toLowerCase();
      if (!new Set(["accepted", "delivered"]).has(deliveryStatus)) {
        throw new FollowupDispatchOutboxError("FOLLOWUP_DISPATCH_RECEIPT_INVALID", "delivery status is invalid");
      }
      const result = db.prepare(`
        UPDATE chronic_followup_dispatch_outbox
        SET status = 'delivered', receipt_sha256 = ?, delivery_status = ?, delivered_at = ?,
          dead_lettered_at = NULL, last_error_code = NULL, last_error_sha256 = NULL,
          lease_owner = NULL, lease_token_sha256 = NULL, lease_expires_at = NULL, updated_at = ?
        WHERE event_id = ? AND status = 'leased' AND lease_version = ?
      `).run(receiptDigest, deliveryStatus, at, at, input.eventId, Number(input.leaseVersion));
      if (Number(result.changes) !== 1) throw new FollowupDispatchOutboxError("FOLLOWUP_DISPATCH_STALE_LEASE", "followup dispatch completion was fenced");
      return rowToEvent(getRow(input.eventId));
    },
    markFailed(input = {}) {
      const at = iso(input.failedAt || nowIso(), "failedAt");
      const row = fenced(input, at);
      const errorCode = String(input.errorCode || "FOLLOWUP_DISPATCH_FAILED").trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 120) || "FOLLOWUP_DISPATCH_FAILED";
      const terminal = Number(row.attempts) >= Number(row.max_attempts);
      const baseSeconds = Math.min(3600, Math.max(1, Number(input.baseBackoffSeconds) || 5));
      const backoffSeconds = Math.min(86400, baseSeconds * (2 ** Math.max(0, Number(row.attempts) - 1)));
      const nextAttemptAt = new Date(Date.parse(at) + backoffSeconds * 1000).toISOString();
      const result = db.prepare(`
        UPDATE chronic_followup_dispatch_outbox
        SET status = ?, next_attempt_at = ?, dead_lettered_at = ?, last_error_code = ?,
          last_error_sha256 = ?, lease_owner = NULL, lease_token_sha256 = NULL,
          lease_expires_at = NULL, updated_at = ?
        WHERE event_id = ? AND status = 'leased' AND lease_version = ?
      `).run(terminal ? "dead-letter" : "pending", nextAttemptAt, terminal ? at : null,
        errorCode, sha256(errorCode), at, input.eventId, Number(input.leaseVersion));
      if (Number(result.changes) !== 1) throw new FollowupDispatchOutboxError("FOLLOWUP_DISPATCH_STALE_LEASE", "followup dispatch failure was fenced");
      return rowToEvent(getRow(input.eventId));
    },
    replayDeadLetter(input = {}) {
      const eventId = requiredText(input.eventId, "eventId");
      const replayKeyDigest = requiredDigest(input.replayKeyDigest, "replayKeyDigest");
      const actorDigest = requiredDigest(input.actorDigest, "actorDigest");
      const reasonDigest = requiredDigest(input.reasonDigest, "reasonDigest");
      const replayedAt = iso(input.replayedAt || nowIso(), "replayedAt");
      const bindingDigest = sha256({ eventId, actorDigest, reasonDigest });
      const existing = db.prepare("SELECT * FROM chronic_followup_dispatch_replays WHERE replay_key_sha256 = ?").get(replayKeyDigest);
      if (existing) {
        if (existing.binding_sha256 !== bindingDigest) throw new FollowupDispatchOutboxError("FOLLOWUP_DISPATCH_REPLAY_KEY_CONFLICT", "replay key was used for a different request");
        return Object.freeze({ event: rowToEvent(getRow(eventId)), idempotent: true });
      }
      const row = getRow(eventId);
      if (!row) throw new FollowupDispatchOutboxError("FOLLOWUP_DISPATCH_NOT_FOUND", "followup dispatch event was not found", 404);
      if (row.status !== "dead-letter") throw new FollowupDispatchOutboxError("FOLLOWUP_DISPATCH_NOT_DEAD_LETTER", "only dead-letter followup dispatches can be replayed");
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare(`
          INSERT INTO chronic_followup_dispatch_replays (
            replay_key_sha256, binding_sha256, event_id, actor_sha256, reason_sha256,
            prior_lease_version, replayed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(replayKeyDigest, bindingDigest, eventId, actorDigest, reasonDigest, Number(row.lease_version), replayedAt);
        db.prepare(`
          UPDATE chronic_followup_dispatch_outbox
          SET status = 'pending', attempts = 0, next_attempt_at = ?, lease_owner = NULL,
            lease_token_sha256 = NULL, lease_version = lease_version + 1, lease_expires_at = NULL,
            dead_lettered_at = NULL, last_error_code = NULL, last_error_sha256 = NULL,
            replay_count = replay_count + 1, updated_at = ?
          WHERE event_id = ? AND status = 'dead-letter'
        `).run(replayedAt, replayedAt, eventId);
        db.exec("COMMIT");
      } catch (error) {
        try { db.exec("ROLLBACK"); } catch { /* preserve the original replay error */ }
        throw error;
      }
      return Object.freeze({ event: rowToEvent(getRow(eventId)), idempotent: false });
    },
    get(eventId) {
      const row = getRow(requiredText(eventId, "eventId"));
      return row ? rowToEvent(row) : null;
    },
    health() {
      const counts = Object.fromEntries([...STATUS_VALUES].map((status) => [status, 0]));
      db.prepare("SELECT status, COUNT(*) AS count FROM chronic_followup_dispatch_outbox GROUP BY status")
        .all().forEach((row) => { counts[row.status] = Number(row.count); });
      const oldest = db.prepare("SELECT MIN(created_at) AS at FROM chronic_followup_dispatch_outbox WHERE status IN ('pending', 'leased')").get();
      return Object.freeze({
        contract: OUTBOX_CONTRACT,
        counts: Object.freeze(counts),
        oldestOutstandingAt: oldest?.at || "",
        healthy: counts["dead-letter"] === 0,
        requestPathExternalDispatch: false,
        productionReady: false
      });
    }
  });
}

const followupDispatchMigrationFingerprintDependencies = Object.freeze([
  stableValue,
  stableStringify,
  sha256,
  requiredText,
  iso,
  normalizeEvent,
  embeddedEvents,
  insertOrVerifyEvent
]);

module.exports = {
  EVENT_TYPE,
  EVENT_VERSION,
  FollowupDispatchOutboxError,
  OUTBOX_CONTRACT,
  appendFollowupDispatchOutboxChanges,
  backfillFollowupDispatchOutboxFromCollections,
  createFollowupDispatchOutboxSchema,
  createSqliteFollowupDispatchRepository,
  followupDispatchMigrationFingerprintDependencies,
  normalizeEvent,
  sha256,
  stableStringify
};
