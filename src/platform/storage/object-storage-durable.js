"use strict";

const { createHash, createHmac, randomBytes, timingSafeEqual } = require("node:crypto");

const OBJECT_STORAGE_DURABLE_CONTRACT = "object-storage-durable-command-and-metadata.v2";
const ATTACHMENT_STATUS = new Set(["pending", "upload-authorized", "active", "quarantined", "deleted"]);
const COMMAND_STATUS = new Set(["pending", "leased", "delivered", "dead-letter"]);
const COMMAND_OPERATIONS = new Set(["create-upload-intent", "complete-upload", "create-download-intent", "apply-lifecycle"]);

class ObjectStorageDurableError extends Error {
  constructor(code, message, statusCode = 409) {
    super(message);
    this.name = "ObjectStorageDurableError";
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
    throw new ObjectStorageDurableError("OBJECT_STORAGE_INPUT_INVALID", `${label} is missing or invalid`, 400);
  }
  return result;
}

function optionalText(value, maximum = 240) {
  const result = String(value || "").trim();
  if (result.length > maximum || /[\r\n\t]/.test(result)) {
    throw new ObjectStorageDurableError("OBJECT_STORAGE_INPUT_INVALID", "optional text is invalid", 400);
  }
  return result;
}

function iso(value, label = "time") {
  const timestamp = Date.parse(String(value || ""));
  if (!Number.isFinite(timestamp)) {
    throw new ObjectStorageDurableError("OBJECT_STORAGE_TIME_INVALID", `${label} is invalid`, 400);
  }
  return new Date(timestamp).toISOString();
}

function digest(value, label = "digest") {
  const result = String(value || "").trim().toLowerCase();
  if (!/^sha256:[a-f0-9]{64}$/.test(result)) {
    throw new ObjectStorageDurableError("OBJECT_STORAGE_DIGEST_INVALID", `${label} is invalid`, 400);
  }
  return result;
}

function normalizeAttachment(input = {}, options = {}) {
  const createdAt = iso(input.createdAt || options.recordedAt || new Date().toISOString(), "createdAt");
  const status = optionalText(input.status || "pending", 40).toLowerCase();
  if (!ATTACHMENT_STATUS.has(status)) {
    throw new ObjectStorageDurableError("OBJECT_STORAGE_ATTACHMENT_STATUS_INVALID", "attachment status is invalid", 400);
  }
  const version = Number(input.version || 1);
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new ObjectStorageDurableError("OBJECT_STORAGE_ATTACHMENT_VERSION_INVALID", "attachment version is invalid", 400);
  }
  const normalized = {
    id: requiredText(input.id, "attachmentId", 180),
    residentId: optionalText(input.residentId, 180),
    recordId: optionalText(input.recordId || input.sourceId, 180),
    sourceCollection: optionalText(input.sourceCollection, 100),
    filename: requiredText(input.filename, "filename", 240),
    contentType: requiredText(input.contentType, "contentType", 120).toLowerCase(),
    expectedSizeBytes: Number(input.expectedSizeBytes ?? input.sizeBytes),
    expectedChecksumSha256: digest(input.expectedChecksumSha256 || input.checksumSha256, "checksum"),
    classification: requiredText(input.classification, "classification", 80),
    retentionPolicy: requiredText(input.retentionPolicy, "retentionPolicy", 80),
    retentionYears: Number(input.retentionYears),
    immutable: input.immutable === true,
    legalHold: input.legalHold === true,
    createdBy: requiredText(input.createdBy || options.actorId, "createdBy", 180),
    createdByRole: requiredText(input.createdByRole || options.actorRole, "createdByRole", 40),
    createdByOrgCode: optionalText(input.createdByOrgCode || options.orgCode, 120),
    objectKey: optionalText(input.objectKey, 500),
    objectVersion: optionalText(input.objectVersion, 240),
    status,
    scanStatus: optionalText(input.scanStatus || "pending", 80),
    version,
    createdAt,
    updatedAt: iso(input.updatedAt || createdAt, "updatedAt")
  };
  if (!Number.isSafeInteger(normalized.expectedSizeBytes) || normalized.expectedSizeBytes < 0) {
    throw new ObjectStorageDurableError("OBJECT_STORAGE_ATTACHMENT_SIZE_INVALID", "attachment size is invalid", 400);
  }
  if (!Number.isSafeInteger(normalized.retentionYears) || normalized.retentionYears < 1 || normalized.retentionYears > 100) {
    throw new ObjectStorageDurableError("OBJECT_STORAGE_ATTACHMENT_RETENTION_INVALID", "attachment retention is invalid", 400);
  }
  return Object.freeze(normalized);
}

function createObjectStorageDurableSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS secure_attachment_records (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      attachment_id TEXT NOT NULL UNIQUE,
      resident_id TEXT NOT NULL DEFAULT '',
      record_id TEXT NOT NULL DEFAULT '',
      source_collection TEXT NOT NULL DEFAULT '',
      filename TEXT NOT NULL,
      content_type TEXT NOT NULL,
      expected_size_bytes INTEGER NOT NULL CHECK (expected_size_bytes >= 0),
      expected_checksum_sha256 TEXT NOT NULL CHECK (substr(expected_checksum_sha256, 1, 7) = 'sha256:' AND length(expected_checksum_sha256) = 71),
      classification TEXT NOT NULL,
      retention_policy TEXT NOT NULL,
      retention_years INTEGER NOT NULL CHECK (retention_years BETWEEN 1 AND 100),
      immutable INTEGER NOT NULL CHECK (immutable IN (0, 1)),
      legal_hold INTEGER NOT NULL CHECK (legal_hold IN (0, 1)),
      created_by TEXT NOT NULL,
      created_by_role TEXT NOT NULL,
      created_by_org_code TEXT NOT NULL DEFAULT '',
      object_key TEXT NOT NULL DEFAULT '',
      object_version TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK (status IN ('pending', 'upload-authorized', 'active', 'quarantined', 'deleted')),
      scan_status TEXT NOT NULL DEFAULT 'pending',
      version INTEGER NOT NULL CHECK (version > 0),
      legacy_metadata_json TEXT NOT NULL DEFAULT '{}',
      metadata_sha256 TEXT NOT NULL CHECK (substr(metadata_sha256, 1, 7) = 'sha256:' AND length(metadata_sha256) = 71),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_secure_attachment_scope_keyset
      ON secure_attachment_records(created_by_org_code, resident_id, sequence DESC);
    CREATE INDEX IF NOT EXISTS idx_secure_attachment_status_keyset
      ON secure_attachment_records(status, sequence DESC);

    CREATE TABLE IF NOT EXISTS object_storage_commands (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      command_id TEXT NOT NULL UNIQUE,
      attachment_id TEXT NOT NULL,
      operation TEXT NOT NULL CHECK (operation IN ('create-upload-intent', 'complete-upload', 'create-download-intent', 'apply-lifecycle')),
      idempotency_key_sha256 TEXT NOT NULL UNIQUE CHECK (substr(idempotency_key_sha256, 1, 7) = 'sha256:' AND length(idempotency_key_sha256) = 71),
      request_sha256 TEXT NOT NULL CHECK (substr(request_sha256, 1, 7) = 'sha256:' AND length(request_sha256) = 71),
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'leased', 'delivered', 'dead-letter')),
      attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
      next_attempt_at TEXT NOT NULL,
      lease_owner TEXT,
      lease_token_sha256 TEXT,
      lease_version INTEGER NOT NULL DEFAULT 0 CHECK (lease_version >= 0),
      lease_expires_at TEXT,
      result_json TEXT,
      result_expires_at TEXT,
      receipt_sha256 TEXT,
      last_error_code TEXT,
      last_error_sha256 TEXT,
      dead_lettered_at TEXT,
      replay_count INTEGER NOT NULL DEFAULT 0 CHECK (replay_count >= 0),
      actor_sha256 TEXT NOT NULL CHECK (substr(actor_sha256, 1, 7) = 'sha256:' AND length(actor_sha256) = 71),
      scope_sha256 TEXT NOT NULL CHECK (substr(scope_sha256, 1, 7) = 'sha256:' AND length(scope_sha256) = 71),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (attachment_id) REFERENCES secure_attachment_records(attachment_id) ON DELETE RESTRICT,
      CHECK ((status = 'leased') = (lease_owner IS NOT NULL AND lease_token_sha256 IS NOT NULL AND lease_expires_at IS NOT NULL)),
      CHECK ((status = 'delivered') = (receipt_sha256 IS NOT NULL))
    );
    CREATE INDEX IF NOT EXISTS idx_object_storage_commands_due
      ON object_storage_commands(status, next_attempt_at, sequence);
    CREATE INDEX IF NOT EXISTS idx_object_storage_commands_attachment
      ON object_storage_commands(attachment_id, sequence DESC);

    CREATE TABLE IF NOT EXISTS object_storage_command_receipts (
      receipt_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      command_id TEXT NOT NULL UNIQUE,
      attachment_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      outcome TEXT NOT NULL CHECK (outcome IN ('accepted', 'completed')),
      receipt_sha256 TEXT NOT NULL CHECK (substr(receipt_sha256, 1, 7) = 'sha256:' AND length(receipt_sha256) = 71),
      result_sha256 TEXT NOT NULL CHECK (substr(result_sha256, 1, 7) = 'sha256:' AND length(result_sha256) = 71),
      provider_observed_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (command_id) REFERENCES object_storage_commands(command_id) ON DELETE RESTRICT,
      FOREIGN KEY (attachment_id) REFERENCES secure_attachment_records(attachment_id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS object_storage_reconciliation_cases (
      case_id TEXT PRIMARY KEY,
      attachment_id TEXT NOT NULL DEFAULT '',
      command_id TEXT NOT NULL DEFAULT '',
      case_type TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('open', 'acknowledged', 'resolved', 'reopened')),
      local_sha256 TEXT NOT NULL,
      provider_sha256 TEXT NOT NULL,
      occurrence_count INTEGER NOT NULL DEFAULT 1 CHECK (occurrence_count > 0),
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      resolved_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_object_storage_reconciliation_status
      ON object_storage_reconciliation_cases(status, updated_at DESC);

    CREATE TABLE IF NOT EXISTS object_storage_reconciliation_actions (
      action_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      action_id TEXT NOT NULL UNIQUE,
      case_id TEXT NOT NULL,
      action TEXT NOT NULL,
      from_status TEXT NOT NULL,
      to_status TEXT NOT NULL,
      actor_sha256 TEXT NOT NULL CHECK (substr(actor_sha256, 1, 7) = 'sha256:' AND length(actor_sha256) = 71),
      evidence_sha256 TEXT NOT NULL CHECK (substr(evidence_sha256, 1, 7) = 'sha256:' AND length(evidence_sha256) = 71),
      created_at TEXT NOT NULL,
      FOREIGN KEY (case_id) REFERENCES object_storage_reconciliation_cases(case_id) ON DELETE RESTRICT
    );

    CREATE TRIGGER IF NOT EXISTS trg_secure_attachment_identity_immutable
    BEFORE UPDATE OF attachment_id, resident_id, record_id, source_collection, created_by,
      created_by_role, created_by_org_code, created_at, metadata_sha256
    ON secure_attachment_records
    BEGIN
      SELECT RAISE(ABORT, 'secure attachment identity is immutable');
    END;
    CREATE TRIGGER IF NOT EXISTS trg_secure_attachment_no_delete
    BEFORE DELETE ON secure_attachment_records
    BEGIN
      SELECT RAISE(ABORT, 'secure attachment records cannot be deleted');
    END;
    CREATE TRIGGER IF NOT EXISTS trg_object_storage_command_source_immutable
    BEFORE UPDATE OF command_id, attachment_id, operation, idempotency_key_sha256,
      request_sha256, payload_json, actor_sha256, scope_sha256, created_at
    ON object_storage_commands
    BEGIN
      SELECT RAISE(ABORT, 'object storage command source is immutable');
    END;
    CREATE TRIGGER IF NOT EXISTS trg_object_storage_command_no_delete
    BEFORE DELETE ON object_storage_commands
    BEGIN
      SELECT RAISE(ABORT, 'object storage commands cannot be deleted');
    END;
    CREATE TRIGGER IF NOT EXISTS trg_object_storage_receipt_no_update
    BEFORE UPDATE ON object_storage_command_receipts
    BEGIN
      SELECT RAISE(ABORT, 'object storage receipts are immutable');
    END;
    CREATE TRIGGER IF NOT EXISTS trg_object_storage_receipt_no_delete
    BEFORE DELETE ON object_storage_command_receipts
    BEGIN
      SELECT RAISE(ABORT, 'object storage receipts cannot be deleted');
    END;
    CREATE TRIGGER IF NOT EXISTS trg_object_storage_reconciliation_action_no_update
    BEFORE UPDATE ON object_storage_reconciliation_actions
    BEGIN
      SELECT RAISE(ABORT, 'object storage reconciliation actions are append-only');
    END;
    CREATE TRIGGER IF NOT EXISTS trg_object_storage_reconciliation_action_no_delete
    BEFORE DELETE ON object_storage_reconciliation_actions
    BEGIN
      SELECT RAISE(ABORT, 'object storage reconciliation actions are append-only');
    END;
    CREATE TRIGGER IF NOT EXISTS trg_secure_attachments_legacy_write_frozen
    BEFORE UPDATE OF payload ON state_collections
    WHEN OLD.key = 'secureAttachments' AND OLD.payload <> NEW.payload
    BEGIN
      SELECT RAISE(ABORT, 'legacy secureAttachments writes are frozen after v17 backfill');
    END;
    CREATE TRIGGER IF NOT EXISTS trg_secure_attachments_legacy_insert_frozen
    BEFORE INSERT ON state_collections
    WHEN NEW.key = 'secureAttachments'
    BEGIN
      SELECT RAISE(ABORT, 'legacy secureAttachments collection cannot be created after v17 backfill');
    END;
    CREATE TRIGGER IF NOT EXISTS trg_secure_attachments_legacy_delete_frozen
    BEFORE DELETE ON state_collections
    WHEN OLD.key = 'secureAttachments'
    BEGIN
      SELECT RAISE(ABORT, 'legacy secureAttachments collection cannot be deleted after v17 backfill');
    END;
  `);
}

function insertAttachment(db, normalized, legacyMetadata = {}) {
  const metadataJson = stableStringify(legacyMetadata);
  const metadataDigest = sha256(normalized);
  db.prepare(`
    INSERT INTO secure_attachment_records (
      attachment_id, resident_id, record_id, source_collection, filename, content_type,
      expected_size_bytes, expected_checksum_sha256, classification, retention_policy,
      retention_years, immutable, legal_hold, created_by, created_by_role, created_by_org_code,
      object_key, object_version, status, scan_status, version, legacy_metadata_json,
      metadata_sha256, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    normalized.id, normalized.residentId, normalized.recordId, normalized.sourceCollection,
    normalized.filename, normalized.contentType, normalized.expectedSizeBytes,
    normalized.expectedChecksumSha256, normalized.classification, normalized.retentionPolicy,
    normalized.retentionYears, normalized.immutable ? 1 : 0, normalized.legalHold ? 1 : 0,
    normalized.createdBy, normalized.createdByRole, normalized.createdByOrgCode,
    normalized.objectKey, normalized.objectVersion, normalized.status, normalized.scanStatus,
    normalized.version, metadataJson, metadataDigest, normalized.createdAt, normalized.updatedAt
  );
  return metadataDigest;
}

function backfillObjectStorageFromLegacyCollection(db, options = {}) {
  const row = db.prepare("SELECT payload FROM state_collections WHERE key = 'secureAttachments'").get();
  let legacy = [];
  if (row) {
    try { legacy = JSON.parse(row.payload); } catch {
      throw new ObjectStorageDurableError("OBJECT_STORAGE_BACKFILL_INVALID_JSON", "legacy secureAttachments is invalid JSON");
    }
  }
  if (!Array.isArray(legacy)) {
    throw new ObjectStorageDurableError("OBJECT_STORAGE_BACKFILL_INVALID_SHAPE", "legacy secureAttachments must be an array");
  }
  const seen = new Set();
  const sourcePairs = [];
  for (const item of legacy) {
    const normalized = normalizeAttachment(item, { recordedAt: options.recordedAt });
    if (seen.has(normalized.id)) {
      throw new ObjectStorageDurableError("OBJECT_STORAGE_BACKFILL_DUPLICATE_ID", "legacy secureAttachments contains duplicate ids");
    }
    seen.add(normalized.id);
    sourcePairs.push(`${normalized.id}:${sha256(normalized)}`);
    const existing = db.prepare("SELECT metadata_sha256 FROM secure_attachment_records WHERE attachment_id = ?").get(normalized.id);
    if (existing && existing.metadata_sha256 !== sha256(normalized)) {
      throw new ObjectStorageDurableError("OBJECT_STORAGE_BACKFILL_DRIFT", "structured attachment differs from legacy source");
    }
    if (!existing) insertAttachment(db, normalized, item);
  }
  const rows = db.prepare("SELECT attachment_id, metadata_sha256 FROM secure_attachment_records ORDER BY attachment_id").all();
  const sourceDigest = sha256(sourcePairs.sort().join("\n"));
  const targetDigest = sha256(rows.map((item) => `${item.attachment_id}:${item.metadata_sha256}`).join("\n"));
  if (rows.length !== legacy.length || sourceDigest !== targetDigest) {
    throw new ObjectStorageDurableError("OBJECT_STORAGE_BACKFILL_RECONCILIATION_FAILED", "object storage backfill count or digest mismatch");
  }
  const at = iso(options.recordedAt || new Date().toISOString(), "recordedAt");
  db.prepare(`
    INSERT INTO object_storage_reconciliation_cases (
      case_id, case_type, status, local_sha256, provider_sha256,
      occurrence_count, first_seen_at, last_seen_at, resolved_at, updated_at
    ) VALUES ('object-storage-v17-backfill', 'legacy-backfill', 'resolved', ?, ?, 1, ?, ?, ?, ?)
    ON CONFLICT(case_id) DO UPDATE SET
      local_sha256 = excluded.local_sha256,
      provider_sha256 = excluded.provider_sha256,
      last_seen_at = excluded.last_seen_at,
      resolved_at = excluded.resolved_at,
      updated_at = excluded.updated_at
  `).run(sourceDigest, targetDigest, at, at, at, at);
  return Object.freeze({ sourceCount: legacy.length, targetCount: rows.length, sourceDigest, targetDigest, orphanCount: 0 });
}

function rowToAttachment(row) {
  return row ? Object.freeze({
    id: row.attachment_id,
    residentId: row.resident_id,
    recordId: row.record_id,
    sourceCollection: row.source_collection,
    filename: row.filename,
    contentType: row.content_type,
    expectedSizeBytes: Number(row.expected_size_bytes),
    expectedChecksumSha256: row.expected_checksum_sha256,
    classification: row.classification,
    retentionPolicy: row.retention_policy,
    retentionYears: Number(row.retention_years),
    immutable: Boolean(row.immutable),
    legalHold: Boolean(row.legal_hold),
    createdBy: row.created_by,
    createdByRole: row.created_by_role,
    createdByOrgCode: row.created_by_org_code,
    objectKey: row.object_key,
    objectVersion: row.object_version,
    status: row.status,
    scanStatus: row.scan_status,
    version: Number(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }) : null;
}

function rowToCommand(row) {
  return row ? Object.freeze({
    sequence: Number(row.sequence),
    commandId: row.command_id,
    attachmentId: row.attachment_id,
    operation: row.operation,
    payload: JSON.parse(row.payload_json),
    status: row.status,
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    nextAttemptAt: row.next_attempt_at,
    leaseVersion: Number(row.lease_version),
    leaseExpiresAt: row.lease_expires_at || "",
    result: row.result_json ? JSON.parse(row.result_json) : null,
    resultExpiresAt: row.result_expires_at || "",
    receiptDigest: row.receipt_sha256 || "",
    lastErrorCode: row.last_error_code || "",
    lastErrorDigest: row.last_error_sha256 || "",
    deadLetteredAt: row.dead_lettered_at || "",
    replayCount: Number(row.replay_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    productionReady: false
  }) : null;
}

function encodeCursor(payload, secret) {
  const body = Buffer.from(stableStringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function decodeCursor(value, secret) {
  const [body, signature, ...rest] = String(value || "").split(".");
  const expected = createHmac("sha256", secret).update(body || "").digest();
  let received;
  try { received = Buffer.from(signature || "", "base64url"); } catch { received = Buffer.alloc(0); }
  if (!body || !signature || rest.length || received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new ObjectStorageDurableError("OBJECT_STORAGE_CURSOR_INVALID", "attachment cursor is invalid", 400);
  }
  try {
    const decoded = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    const keys = decoded && typeof decoded === "object" && !Array.isArray(decoded) ? Object.keys(decoded).sort() : [];
    if (JSON.stringify(keys) !== JSON.stringify(["before", "contract", "highWater", "scopeDigest"])) throw new Error("cursor shape");
    if (decoded.contract !== "object-storage-keyset-cursor.v1" || !/^sha256:[a-f0-9]{64}$/.test(decoded.scopeDigest)) throw new Error("cursor binding");
    if (!Number.isSafeInteger(decoded.highWater) || decoded.highWater < 0
      || !Number.isSafeInteger(decoded.before) || decoded.before < 1 || decoded.before > decoded.highWater + 1) throw new Error("cursor bounds");
    return decoded;
  } catch {
    throw new ObjectStorageDurableError("OBJECT_STORAGE_CURSOR_INVALID", "attachment cursor is invalid", 400);
  }
}

function createSqliteObjectStorageRepository(db, options = {}) {
  if (!db || typeof db.prepare !== "function") throw new TypeError("SQLite database is required");
  const now = typeof options.now === "function" ? options.now : () => new Date();
  const tokenFactory = typeof options.tokenFactory === "function" ? options.tokenFactory : () => randomBytes(32).toString("hex");
  const beforeEnqueueTransaction = typeof options.beforeEnqueueTransaction === "function" ? options.beforeEnqueueTransaction : null;
  const beforeReplayTransaction = typeof options.beforeReplayTransaction === "function" ? options.beforeReplayTransaction : null;
  const cursorSecret = String(options.cursorSecret || "");
  const nowIso = () => iso(now().toISOString(), "now");
  const commandRow = (commandId) => db.prepare("SELECT * FROM object_storage_commands WHERE command_id = ?").get(commandId);
  const attachmentRow = (attachmentId) => db.prepare("SELECT * FROM secure_attachment_records WHERE attachment_id = ?").get(attachmentId);
  const fenced = (input, at) => {
    const row = commandRow(requiredText(input.commandId, "commandId"));
    if (!row || row.status !== "leased" || row.lease_owner !== requiredText(input.workerId, "workerId")
      || row.lease_token_sha256 !== sha256(requiredText(input.leaseToken, "leaseToken", 300))
      || Number(row.lease_version) !== Number(input.leaseVersion)
      || Date.parse(row.lease_expires_at) <= Date.parse(at)) {
      throw new ObjectStorageDurableError("OBJECT_STORAGE_STALE_LEASE", "object storage command lease is stale");
    }
    return row;
  };
  const enqueue = (input, createAttachment) => {
    const at = iso(input.createdAt || nowIso(), "createdAt");
    const commandId = requiredText(input.commandId, "commandId", 180);
    const attachmentId = requiredText(input.attachmentId || input.attachment?.id, "attachmentId", 180);
    const operation = requiredText(input.operation, "operation", 80);
    if (!COMMAND_OPERATIONS.has(operation)) throw new ObjectStorageDurableError("OBJECT_STORAGE_OPERATION_INVALID", "object storage operation is invalid", 400);
    const request = { attachmentId, operation, payload: stableValue(input.payload || {}) };
    const requestDigest = sha256(request);
    const idempotencyDigest = sha256({ scope: requiredText(input.scope, "scope", 300), key: requiredText(input.idempotencyKey, "idempotencyKey", 240) });
    const existing = db.prepare("SELECT * FROM object_storage_commands WHERE idempotency_key_sha256 = ?").get(idempotencyDigest);
    if (existing) {
      if (existing.request_sha256 !== requestDigest) throw new ObjectStorageDurableError("OBJECT_STORAGE_IDEMPOTENCY_CONFLICT", "idempotency key was used for a different command");
      return Object.freeze({ command: rowToCommand(existing), attachment: rowToAttachment(attachmentRow(existing.attachment_id)), idempotent: true });
    }
    if (beforeEnqueueTransaction) beforeEnqueueTransaction({ commandId, attachmentId, idempotencyDigest, requestDigest });
    db.exec("BEGIN IMMEDIATE");
    try {
      const lockedExisting = db.prepare("SELECT * FROM object_storage_commands WHERE idempotency_key_sha256 = ?").get(idempotencyDigest);
      if (lockedExisting) {
        if (lockedExisting.request_sha256 !== requestDigest) {
          throw new ObjectStorageDurableError("OBJECT_STORAGE_IDEMPOTENCY_CONFLICT", "idempotency key was used for a different command");
        }
        db.exec("COMMIT");
        return Object.freeze({ command: rowToCommand(lockedExisting), attachment: rowToAttachment(attachmentRow(lockedExisting.attachment_id)), idempotent: true });
      }
      if (createAttachment) {
        const normalized = normalizeAttachment(input.attachment, { recordedAt: at, actorId: input.actorId, actorRole: input.actorRole, orgCode: input.orgCode });
        insertAttachment(db, normalized);
      } else {
        const currentAttachment = attachmentRow(attachmentId);
        if (!currentAttachment) {
          throw new ObjectStorageDurableError("OBJECT_STORAGE_ATTACHMENT_NOT_FOUND", "attachment was not found", 404);
        }
        if (input.expectedAttachmentVersion !== undefined) {
          const expectedVersion = Number(input.expectedAttachmentVersion);
          if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
            throw new ObjectStorageDurableError("OBJECT_STORAGE_ATTACHMENT_VERSION_INVALID", "expected attachment version is invalid", 400);
          }
          if (Number(currentAttachment.version) !== expectedVersion) {
            throw new ObjectStorageDurableError("OBJECT_STORAGE_ATTACHMENT_STATE_CONFLICT", "attachment changed before the command was accepted");
          }
        }
        if (input.expectedAttachmentStatus && currentAttachment.status !== input.expectedAttachmentStatus) {
          throw new ObjectStorageDurableError("OBJECT_STORAGE_ATTACHMENT_STATE_CONFLICT", "attachment cannot accept this command in its current state");
        }
        if (input.expectedAttachmentScanStatus && currentAttachment.scan_status !== input.expectedAttachmentScanStatus) {
          throw new ObjectStorageDurableError("OBJECT_STORAGE_ATTACHMENT_STATE_CONFLICT", "attachment scan state does not allow this command");
        }
      }
      db.prepare(`
        INSERT INTO object_storage_commands (
          command_id, attachment_id, operation, idempotency_key_sha256, request_sha256,
          payload_json, status, next_attempt_at, actor_sha256, scope_sha256, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)
      `).run(commandId, attachmentId, operation, idempotencyDigest, requestDigest,
        stableStringify(input.payload || {}), at, sha256(input.actorId), sha256(input.scope), at, at);
      db.exec("COMMIT");
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch { /* preserve original error */ }
      throw error;
    }
    return Object.freeze({ command: rowToCommand(commandRow(commandId)), attachment: rowToAttachment(attachmentRow(attachmentId)), idempotent: false });
  };

  return Object.freeze({
    createUploadCommand(input = {}) {
      return enqueue({ ...input, operation: "create-upload-intent" }, true);
    },
    enqueueCommand(input = {}) {
      return enqueue(input, false);
    },
    getAttachment(attachmentId) {
      return rowToAttachment(attachmentRow(requiredText(attachmentId, "attachmentId")));
    },
    getCommand(commandId) {
      const id = requiredText(commandId, "commandId");
      const at = nowIso();
      db.prepare(`UPDATE object_storage_commands SET result_json=NULL, result_expires_at=NULL, updated_at=?
        WHERE command_id=? AND result_json IS NOT NULL AND result_expires_at IS NOT NULL AND result_expires_at<=?`).run(at, id, at);
      const command = rowToCommand(commandRow(id));
      return command ? Object.freeze({ command, attachment: rowToAttachment(attachmentRow(command.attachmentId)) }) : null;
    },
    purgeExpiredCommandResults(input = {}) {
      const at = iso(input.at || nowIso(), "purgeAt");
      const changed = db.prepare(`UPDATE object_storage_commands SET result_json=NULL, result_expires_at=NULL, updated_at=?
        WHERE result_json IS NOT NULL AND result_expires_at IS NOT NULL AND result_expires_at<=?`).run(at, at);
      return Object.freeze({ purged: Number(changed.changes), at, productionReady: false });
    },
    claimBatch(input = {}) {
      const workerId = requiredText(input.workerId, "workerId", 160);
      const at = iso(input.at || nowIso(), "claimAt");
      const limit = Math.min(100, Math.max(1, Number(input.limit) || 20));
      const leaseSeconds = Math.min(900, Math.max(10, Number(input.leaseSeconds) || 60));
      const leaseExpiresAt = new Date(Date.parse(at) + leaseSeconds * 1000).toISOString();
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare(`UPDATE object_storage_commands SET status='dead-letter', dead_lettered_at=?,
          lease_owner=NULL, lease_token_sha256=NULL, lease_expires_at=NULL,
          last_error_code='OBJECT_STORAGE_LEASE_EXHAUSTED', last_error_sha256=?, updated_at=?
          WHERE status='leased' AND lease_expires_at<=? AND attempts>=max_attempts`)
          .run(at, sha256("OBJECT_STORAGE_LEASE_EXHAUSTED"), at, at);
        db.prepare(`UPDATE object_storage_commands SET status='pending', next_attempt_at=?,
          lease_owner=NULL, lease_token_sha256=NULL, lease_expires_at=NULL, updated_at=?
          WHERE status='leased' AND lease_expires_at<=? AND attempts<max_attempts`).run(at, at, at);
        const rows = db.prepare(`SELECT * FROM object_storage_commands
          WHERE status='pending' AND next_attempt_at<=? ORDER BY next_attempt_at, sequence LIMIT ?`).all(at, limit);
        const claims = rows.map((row) => {
          const leaseToken = tokenFactory();
          const leaseVersion = Number(row.lease_version) + 1;
          const changed = db.prepare(`UPDATE object_storage_commands SET status='leased', attempts=attempts+1,
            lease_owner=?, lease_token_sha256=?, lease_version=?, lease_expires_at=?, updated_at=?
            WHERE command_id=? AND status='pending'`).run(workerId, sha256(leaseToken), leaseVersion, leaseExpiresAt, at, row.command_id);
          if (Number(changed.changes) !== 1) throw new ObjectStorageDurableError("OBJECT_STORAGE_CLAIM_CONFLICT", "object storage command claim conflicted");
          return Object.freeze({ ...rowToCommand(commandRow(row.command_id)), leaseToken, attachment: rowToAttachment(attachmentRow(row.attachment_id)) });
        });
        db.exec("COMMIT");
        return Object.freeze(claims);
      } catch (error) {
        try { db.exec("ROLLBACK"); } catch { /* preserve original error */ }
        throw error;
      }
    },
    markDelivered(input = {}) {
      const at = iso(input.deliveredAt || nowIso(), "deliveredAt");
      const row = fenced(input, at);
      const result = stableValue(input.result || {});
      const receiptDigest = digest(input.receiptDigest || sha256(result), "receiptDigest");
      const resultDigest = sha256(result);
      const resultExpiresAt = input.resultExpiresAt ? iso(input.resultExpiresAt, "resultExpiresAt") : null;
      db.exec("BEGIN IMMEDIATE");
      try {
        if (row.operation === "create-upload-intent") {
          db.prepare(`UPDATE secure_attachment_records SET status='upload-authorized', object_key=?, version=version+1,
            updated_at=? WHERE attachment_id=?`).run(optionalText(result.objectKey, 500), at, row.attachment_id);
        } else if (row.operation === "complete-upload") {
          db.prepare(`UPDATE secure_attachment_records SET status='active', scan_status=?, object_version=?,
            version=version+1, updated_at=? WHERE attachment_id=?`).run(requiredText(result.scanStatus, "scanStatus", 80), optionalText(result.objectVersion, 240), at, row.attachment_id);
        } else if (row.operation === "apply-lifecycle") {
          const action = requiredText(JSON.parse(row.payload_json).action, "action", 80).toLowerCase();
          const current = attachmentRow(row.attachment_id);
          if (action === "delete" && (current.immutable || current.legal_hold)) throw new ObjectStorageDurableError("OBJECT_STORAGE_RETENTION_CONFLICT", "immutable or legal-hold attachment cannot be deleted");
          const status = action === "delete" ? "deleted" : action === "quarantine" ? "quarantined" : current.status;
          const legalHold = action === "legal-hold" ? 1 : action === "release-hold" ? 0 : current.legal_hold;
          db.prepare(`UPDATE secure_attachment_records SET status=?, legal_hold=?, version=version+1, updated_at=? WHERE attachment_id=?`)
            .run(status, legalHold, at, row.attachment_id);
        }
        db.prepare(`INSERT INTO object_storage_command_receipts (
          command_id, attachment_id, operation, outcome, receipt_sha256, result_sha256, provider_observed_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(row.command_id, row.attachment_id, row.operation, input.outcome === "completed" ? "completed" : "accepted", receiptDigest, resultDigest, at, at);
        const leaseTokenDigest = sha256(requiredText(input.leaseToken, "leaseToken", 300));
        const changed = db.prepare(`UPDATE object_storage_commands SET status='delivered', result_json=?, result_expires_at=?,
          receipt_sha256=?, last_error_code=NULL, last_error_sha256=NULL, dead_lettered_at=NULL,
          lease_owner=NULL, lease_token_sha256=NULL, lease_expires_at=NULL, updated_at=?
          WHERE command_id=? AND status='leased' AND lease_owner=? AND lease_token_sha256=?
            AND lease_version=? AND lease_expires_at>?`)
          .run(stableStringify(result), resultExpiresAt, receiptDigest, at, row.command_id,
            requiredText(input.workerId, "workerId"), leaseTokenDigest, Number(input.leaseVersion), at);
        if (Number(changed.changes) !== 1) throw new ObjectStorageDurableError("OBJECT_STORAGE_STALE_LEASE", "object storage command completion was fenced");
        db.exec("COMMIT");
      } catch (error) {
        try { db.exec("ROLLBACK"); } catch { /* preserve original error */ }
        throw error;
      }
      return this.getCommand(row.command_id);
    },
    markFailed(input = {}) {
      const at = iso(input.failedAt || nowIso(), "failedAt");
      const row = fenced(input, at);
      const code = String(input.errorCode || "OBJECT_STORAGE_PROVIDER_FAILED").trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 120);
      const terminal = Number(row.attempts) >= Number(row.max_attempts);
      const base = Math.min(3600, Math.max(1, Number(input.baseBackoffSeconds) || 5));
      const next = new Date(Date.parse(at) + Math.min(86400, base * (2 ** Math.max(0, Number(row.attempts) - 1))) * 1000).toISOString();
      const changed = db.prepare(`UPDATE object_storage_commands SET status=?, next_attempt_at=?, dead_lettered_at=?,
        last_error_code=?, last_error_sha256=?, lease_owner=NULL, lease_token_sha256=NULL,
        lease_expires_at=NULL, updated_at=? WHERE command_id=? AND status='leased' AND lease_owner=?
          AND lease_token_sha256=? AND lease_version=? AND lease_expires_at>?`)
        .run(terminal ? "dead-letter" : "pending", next, terminal ? at : null, code, sha256(code), at,
          row.command_id, requiredText(input.workerId, "workerId"), sha256(requiredText(input.leaseToken, "leaseToken", 300)),
          Number(input.leaseVersion), at);
      if (Number(changed.changes) !== 1) throw new ObjectStorageDurableError("OBJECT_STORAGE_STALE_LEASE", "object storage command failure was fenced");
      return this.getCommand(row.command_id);
    },
    replayDeadLetter(input = {}) {
      const commandId = requiredText(input.commandId, "commandId");
      const at = iso(input.replayedAt || nowIso(), "replayedAt");
      const replayDigest = digest(input.replayKeyDigest, "replayKeyDigest");
      const caseId = `replay:${commandId}:${replayDigest}`;
      if (beforeReplayTransaction) beforeReplayTransaction({ commandId, caseId, replayDigest });
      db.exec("BEGIN IMMEDIATE");
      try {
        const row = commandRow(commandId);
        if (!row) throw new ObjectStorageDurableError("OBJECT_STORAGE_COMMAND_NOT_FOUND", "object storage command was not found", 404);
        const existing = db.prepare("SELECT case_id FROM object_storage_reconciliation_cases WHERE case_id=?").get(caseId);
        if (existing) {
          db.exec("COMMIT");
          return Object.freeze({ ...this.getCommand(commandId), idempotent: true });
        }
        if (row.status !== "dead-letter") throw new ObjectStorageDurableError("OBJECT_STORAGE_COMMAND_NOT_DEAD_LETTER", "only dead-letter commands can be replayed");
        db.prepare(`INSERT INTO object_storage_reconciliation_cases (
          case_id, attachment_id, command_id, case_type, status, local_sha256, provider_sha256,
          first_seen_at, last_seen_at, resolved_at, updated_at
        ) VALUES (?, ?, ?, 'manual-replay', 'resolved', ?, ?, ?, ?, ?, ?)`)
          .run(caseId, row.attachment_id, commandId, replayDigest, sha256({ commandId, priorLeaseVersion: row.lease_version }), at, at, at, at);
        db.prepare(`INSERT INTO object_storage_reconciliation_actions (
          action_id, case_id, action, from_status, to_status, actor_sha256, evidence_sha256, created_at
        ) VALUES (?, ?, 'replay', 'dead-letter', 'pending', ?, ?, ?)`)
          .run(`action:${caseId}`, caseId, digest(input.actorDigest, "actorDigest"), digest(input.reasonDigest, "reasonDigest"), at);
        db.prepare(`UPDATE object_storage_commands SET status='pending', attempts=0, next_attempt_at=?,
          lease_owner=NULL, lease_token_sha256=NULL, lease_version=lease_version+1, lease_expires_at=NULL,
          dead_lettered_at=NULL, last_error_code=NULL, last_error_sha256=NULL,
          replay_count=replay_count+1, updated_at=? WHERE command_id=? AND status='dead-letter'`).run(at, at, commandId);
        db.exec("COMMIT");
      } catch (error) {
        try { db.exec("ROLLBACK"); } catch { /* preserve original error */ }
        throw error;
      }
      return Object.freeze({ ...this.getCommand(commandId), idempotent: false });
    },
    listAttachments(input = {}) {
      if (cursorSecret.length < 32) throw new ObjectStorageDurableError("OBJECT_STORAGE_CURSOR_SECRET_UNAVAILABLE", "attachment cursor signing is unavailable", 503);
      const scope = stableValue(input.scope || { role: "none" });
      const scopeDigest = sha256(scope);
      const limit = Math.min(100, Math.max(1, Number(input.limit) || 50));
      const cursor = input.cursor ? decodeCursor(input.cursor, cursorSecret) : null;
      if (cursor && (cursor.contract !== "object-storage-keyset-cursor.v1" || cursor.scopeDigest !== scopeDigest)) {
        throw new ObjectStorageDurableError("OBJECT_STORAGE_CURSOR_SCOPE_MISMATCH", "attachment cursor scope does not match", 400);
      }
      const highWater = cursor?.highWater || Number(db.prepare("SELECT COALESCE(MAX(sequence), 0) AS value FROM secure_attachment_records").get().value);
      const before = cursor?.before || highWater + 1;
      const where = ["sequence <= ?", "sequence < ?"];
      const values = [highWater, before];
      if (scope.role === "citizen") {
        const residents = Array.isArray(scope.residentIds) ? scope.residentIds.map(String).filter(Boolean) : [];
        if (!residents.length) return Object.freeze({ items: [], nextCursor: "", highWaterMark: highWater });
        where.push(`resident_id IN (${residents.map(() => "?").join(",")})`);
        values.push(...residents);
      } else if (scope.role === "institution") {
        where.push("created_by_org_code = ?");
        values.push(requiredText(scope.orgCode, "orgCode", 120));
      } else if (scope.role !== "commission") {
        throw new ObjectStorageDurableError("OBJECT_STORAGE_SCOPE_INVALID", "attachment list scope is invalid", 403);
      }
      values.push(limit + 1);
      const rows = db.prepare(`SELECT * FROM secure_attachment_records WHERE ${where.join(" AND ")}
        ORDER BY sequence DESC LIMIT ?`).all(...values);
      const page = rows.slice(0, limit);
      const nextCursor = rows.length > limit ? encodeCursor({
        contract: "object-storage-keyset-cursor.v1",
        scopeDigest,
        highWater,
        before: Number(page.at(-1).sequence)
      }, cursorSecret) : "";
      return Object.freeze({ items: Object.freeze(page.map(rowToAttachment)), nextCursor, highWaterMark: highWater });
    },
    reconcileObservation(input = {}) {
      const attachmentId = requiredText(input.attachmentId, "attachmentId");
      const at = iso(input.observedAt || nowIso(), "observedAt");
      const providerDigest = digest(input.providerDigest, "providerDigest");
      const matches = input.matches === true;
      const caseId = `provider-state:${attachmentId}`;
      db.exec("BEGIN IMMEDIATE");
      try {
        const local = rowToAttachment(attachmentRow(attachmentId));
        if (!local) throw new ObjectStorageDurableError("OBJECT_STORAGE_ATTACHMENT_NOT_FOUND", "attachment was not found", 404);
        const localDigest = sha256({ objectKey: local.objectKey, objectVersion: local.objectVersion, status: local.status, scanStatus: local.scanStatus, legalHold: local.legalHold });
        const current = db.prepare("SELECT * FROM object_storage_reconciliation_cases WHERE case_id=?").get(caseId);
        const nextStatus = matches ? "resolved" : current?.status === "resolved" ? "reopened" : "open";
        db.prepare(`INSERT INTO object_storage_reconciliation_cases (
          case_id, attachment_id, case_type, status, local_sha256, provider_sha256,
          occurrence_count, first_seen_at, last_seen_at, resolved_at, updated_at
        ) VALUES (?, ?, 'provider-state', ?, ?, ?, 1, ?, ?, ?, ?)
        ON CONFLICT(case_id) DO UPDATE SET status=excluded.status, local_sha256=excluded.local_sha256,
          provider_sha256=excluded.provider_sha256, occurrence_count=object_storage_reconciliation_cases.occurrence_count+1,
          last_seen_at=excluded.last_seen_at, resolved_at=excluded.resolved_at, updated_at=excluded.updated_at`)
          .run(caseId, attachmentId, nextStatus, localDigest, providerDigest, at, at, matches ? at : "", at);
        db.prepare(`INSERT INTO object_storage_reconciliation_actions (
          action_id, case_id, action, from_status, to_status, actor_sha256, evidence_sha256, created_at
        ) VALUES (?, ?, 'provider-observation', ?, ?, ?, ?, ?)`)
          .run(requiredText(input.actionId, "actionId"), caseId, current?.status || "missing", nextStatus,
            digest(input.actorDigest, "actorDigest"), providerDigest, at);
        db.exec("COMMIT");
        return Object.freeze({ caseId, status: nextStatus, localDigest, providerDigest, productionReady: false });
      } catch (error) {
        try { db.exec("ROLLBACK"); } catch { /* preserve original error */ }
        throw error;
      }
    },
    health() {
      const counts = Object.fromEntries([...COMMAND_STATUS].map((status) => [status, 0]));
      db.prepare("SELECT status, COUNT(*) AS count FROM object_storage_commands GROUP BY status").all()
        .forEach((row) => { counts[row.status] = Number(row.count); });
      const openCases = Number(db.prepare("SELECT COUNT(*) AS count FROM object_storage_reconciliation_cases WHERE status IN ('open','reopened')").get().count);
      return Object.freeze({
        contract: OBJECT_STORAGE_DURABLE_CONTRACT,
        schemaVersion: 17,
        counts: Object.freeze(counts),
        openReconciliationCases: openCases,
        healthy: counts["dead-letter"] === 0 && openCases === 0,
        requestPathExternalDispatch: false,
        legacyWritesFrozen: true,
        productionReady: false
      });
    }
  });
}

const objectStorageMigrationFingerprintDependencies = Object.freeze([
  stableValue,
  stableStringify,
  sha256,
  requiredText,
  optionalText,
  iso,
  digest,
  normalizeAttachment,
  createObjectStorageDurableSchema,
  insertAttachment,
  backfillObjectStorageFromLegacyCollection
]);

module.exports = {
  COMMAND_OPERATIONS,
  COMMAND_STATUS,
  OBJECT_STORAGE_DURABLE_CONTRACT,
  ObjectStorageDurableError,
  backfillObjectStorageFromLegacyCollection,
  createObjectStorageDurableSchema,
  createSqliteObjectStorageRepository,
  normalizeAttachment,
  objectStorageMigrationFingerprintDependencies,
  sha256,
  stableStringify
};
