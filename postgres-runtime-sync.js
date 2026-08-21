const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID, timingSafeEqual } = require("node:crypto");
const { canonicalStringify } = require("./scripts/postgres-migration-package");

const SYNC_MODE = String(process.env.POSTGRES_SYNC_MODE || "disabled").trim().toLowerCase();
const SYNC_MODES = new Set(["disabled", "outbox"]);
const PRIMARY_READ_MODE = String(process.env.POSTGRES_PRIMARY_READ_MODE || "disabled").trim().toLowerCase();
const PRIMARY_READ_MODES = new Set(["disabled", "rehearsal"]);
const MAX_BATCH_LIMIT = 100;
const MAX_RECONCILIATION_HISTORY = 100;
const DEFAULT_PRIMARY_READ_MAX_BYTES = 128 * 1024 * 1024;
const MAX_PRIMARY_READ_COLLECTIONS = 2000;
const RECONCILIATION_CASE_STATUSES = new Set(["open", "acknowledged", "resolved", "reopened"]);
const RECONCILIATION_CASE_ACTIONS = new Set(["assign", "acknowledge", "resolve", "reopen", "comment"]);

class PostgresReconciliationCaseError extends Error {
  constructor(message, code, statusCode = 400) {
    super(message);
    this.name = "PostgresReconciliationCaseError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

class PostgresPrimaryReadError extends Error {
  constructor(message, code, statusCode = 400) {
    super(message);
    this.name = "PostgresPrimaryReadError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function postgresSchemaIdentifier(value = "health_platform") {
  const schema = String(value || "").trim();
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) {
    throw new Error("PostgreSQL schema must be a lowercase SQL identifier");
  }
  return schema;
}

function safePostgresErrorCode(error) {
  const candidate = String(error?.code || error || "").trim().toUpperCase();
  return /^[A-Z0-9_]{2,80}$/.test(candidate) ? candidate : "POSTGRES_SYNC_FAILED";
}

function constantTimeTextEqual(left, right) {
  const leftDigest = createHash("sha256").update(String(left ?? "")).digest();
  const rightDigest = createHash("sha256").update(String(right ?? "")).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function postgresSyncConflict(code, message) {
  return Object.assign(new Error(message), { code, statusCode: 409, retryable: false });
}

function assertSyncMode(mode = SYNC_MODE) {
  if (!SYNC_MODES.has(mode)) throw new Error(`Unsupported POSTGRES_SYNC_MODE=${mode}`);
  return mode;
}

function assertPrimaryReadMode(mode = PRIMARY_READ_MODE) {
  if (!PRIMARY_READ_MODES.has(mode)) throw new PostgresPrimaryReadError(`Unsupported POSTGRES_PRIMARY_READ_MODE=${mode}`, "INVALID_POSTGRES_PRIMARY_READ_MODE");
  return mode;
}

function buildCollectionChanges(existingRows = [], incomingEntries = []) {
  const existing = new Map(existingRows.map((row) => [row.key, row]));
  const incoming = new Map(incomingEntries.filter(([key]) => key !== "storageMeta"));
  const changes = [];
  existing.forEach((row, collection) => {
    if (!incoming.has(collection)) {
      changes.push({ collection, operation: "delete", sourceVersion: Number(row.version || 0) + 1 });
    }
  });
  incoming.forEach((value, collection) => {
    const payload = canonicalStringify(value);
    const row = existing.get(collection);
    if (!row || row.payload !== JSON.stringify(value)) {
      changes.push({
        collection,
        operation: "upsert",
        sourceVersion: Number(row?.version || 0) + 1,
        payload,
        payloadSha256: sha256(payload)
      });
    }
  });
  return changes.sort((a, b) => a.collection.localeCompare(b.collection));
}

function buildCollectionSnapshotChanges(rows = []) {
  return rows
    .filter((row) => row.key !== "storageMeta")
    .map((row) => {
      const payload = canonicalStringify(JSON.parse(row.payload));
      return {
        collection: row.key,
        operation: "upsert",
        sourceVersion: Number(row.version || 0),
        payload,
        payloadSha256: sha256(payload)
      };
    })
    .sort((a, b) => a.collection.localeCompare(b.collection));
}

function buildPostgresSyncBatch(changes, options = {}) {
  if (!Array.isArray(changes) || !changes.length) throw new Error("PostgreSQL sync batch requires collection changes");
  const normalizedChanges = changes.map((change) => {
    const collection = String(change.collection || "").trim();
    const operation = String(change.operation || "").trim();
    if (!collection || !["upsert", "delete"].includes(operation)) throw new Error("invalid PostgreSQL collection change");
    if (operation === "delete") return { collection, operation, sourceVersion: Number(change.sourceVersion || 0) };
    const payload = typeof change.payload === "string" ? change.payload : canonicalStringify(change.payload);
    JSON.parse(payload);
    return {
      collection,
      operation,
      sourceVersion: Number(change.sourceVersion || 0),
      payload,
      payloadSha256: sha256(payload)
    };
  });
  const createdAt = options.createdAt || new Date().toISOString();
  const previousChainHash = String(options.previousChainHash || "").trim();
  const envelope = {
    formatVersion: 1,
    createdAt,
    sourceEvent: String(options.sourceEvent || "write-state"),
    changes: normalizedChanges
  };
  const payload = canonicalStringify(envelope);
  const payloadSha256 = sha256(payload);
  const chainHash = sha256(`${previousChainHash}:${payloadSha256}`);
  return {
    batchId: options.batchId || `pgsync-${chainHash.slice(0, 32)}`,
    createdAt,
    payload,
    payloadSha256,
    previousChainHash,
    chainHash,
    changes: normalizedChanges
  };
}

function validatePostgresSyncBatch(batch) {
  const checks = {
    batchId: /^pgsync-[a-f0-9]{32}$/.test(String(batch?.batchId || "")),
    payloadDigest: sha256(String(batch?.payload || "")) === batch?.payloadSha256,
    chainDigest: sha256(`${batch?.previousChainHash || ""}:${batch?.payloadSha256 || ""}`) === batch?.chainHash,
    payloadShape: false,
    credentialsAbsent: !["databaseUrl", "connectionString", "password", "credentials"].some((key) => Object.hasOwn(batch || {}, key))
  };
  try {
    const parsed = JSON.parse(batch.payload);
    checks.payloadShape = parsed.formatVersion === 1 && Array.isArray(parsed.changes) && parsed.changes.length > 0;
  } catch {
    checks.payloadShape = false;
  }
  return { ok: Object.values(checks).every(Boolean), checks };
}

function enqueuePostgresSyncBatch(db, changes, options = {}) {
  if (!changes.length) return null;
  const previous = db.prepare("SELECT chain_hash FROM postgres_sync_outbox ORDER BY sequence DESC LIMIT 1").get();
  const batch = buildPostgresSyncBatch(changes, { ...options, previousChainHash: previous?.chain_hash || "" });
  const validation = validatePostgresSyncBatch(batch);
  if (!validation.ok) throw new Error("PostgreSQL sync batch integrity validation failed");
  db.prepare(`
    INSERT INTO postgres_sync_outbox (
      batch_id, created_at, payload, payload_sha256, previous_chain_hash, chain_hash,
      status, attempts, next_attempt_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?)
  `).run(batch.batchId, batch.createdAt, batch.payload, batch.payloadSha256, batch.previousChainHash, batch.chainHash, batch.createdAt);
  return batch;
}

function enqueuePostgresSyncBaseline(sqliteFile, options = {}) {
  const resolvedSqliteFile = path.resolve(sqliteFile || path.join(process.env.DATA_DIR || path.join(__dirname, "data"), "health-city.sqlite"));
  const db = openSqlite(resolvedSqliteFile);
  try {
    db.exec("BEGIN IMMEDIATE");
    const existingBatch = db.prepare("SELECT batch_id FROM postgres_sync_outbox ORDER BY sequence LIMIT 1").get();
    if (existingBatch && !options.force) {
      db.exec("ROLLBACK");
      return { ok: true, enqueued: false, reason: "outbox-not-empty", batchId: existingBatch.batch_id, collections: 0 };
    }
    const rows = db.prepare("SELECT key, payload, version FROM state_collections ORDER BY key").all();
    const changes = buildCollectionSnapshotChanges(rows);
    if (!changes.length) throw new Error("SQLite collection state is empty");
    const batch = enqueuePostgresSyncBatch(db, changes, {
      createdAt: options.createdAt,
      sourceEvent: "baseline-snapshot"
    });
    db.exec("COMMIT");
    return { ok: true, enqueued: true, batchId: batch.batchId, collections: changes.length };
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  } finally {
    db.close();
  }
}

function openSqlite(sqliteFile) {
  const sqlite = require("node:sqlite");
  if (!sqlite?.DatabaseSync) throw new Error("node:sqlite DatabaseSync unavailable");
  const db = new sqlite.DatabaseSync(sqliteFile);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  return db;
}

function sqliteTableExists(db, name) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function reconciliationRow(row) {
  if (!row) return null;
  return {
    runId: row.run_id,
    checkedAt: row.checked_at,
    status: row.status,
    durationMs: Number(row.duration_ms || 0),
    errorCode: row.error_code || "",
    summary: {
      localCollections: Number(row.local_collections || 0),
      remoteCollections: Number(row.remote_collections || 0),
      matched: Number(row.matched || 0),
      mismatched: Number(row.mismatched || 0),
      missingRemote: Number(row.missing_remote || 0),
      unexpectedRemote: Number(row.unexpected_remote || 0),
      versionMismatches: Number(row.version_mismatches || 0),
      digestMismatches: Number(row.digest_mismatches || 0)
    },
    differences: parseJsonArray(row.detail_json),
    productionPrimary: false
  };
}

function reconciliationCaseActionRow(row) {
  return {
    actionId: row.action_id,
    action: row.action,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    actor: row.actor,
    role: row.role,
    owner: row.owner,
    note: row.note,
    evidenceRefs: parseJsonArray(row.evidence_json),
    createdAt: row.created_at
  };
}

function reconciliationCaseRow(row, actions = []) {
  if (!row) return null;
  return {
    caseId: row.case_id,
    collection: row.collection_name,
    status: row.status,
    owner: row.owner,
    severity: row.severity,
    firstRunId: row.first_run_id,
    latestRunId: row.latest_run_id,
    clearedRunId: row.cleared_run_id,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    clearedAt: row.cleared_at,
    occurrenceCount: Number(row.occurrence_count || 0),
    differenceTypes: parseJsonArray(row.difference_types_json),
    localVersion: row.local_version === null ? null : Number(row.local_version),
    remoteVersion: row.remote_version === null ? null : Number(row.remote_version),
    localDigest: row.local_digest || "",
    remoteDigest: row.remote_digest || "",
    resolutionNote: row.resolution_note || "",
    resolvedAt: row.resolved_at || "",
    resolvedBy: row.resolved_by || "",
    updatedAt: row.updated_at,
    actions
  };
}

function emptyReconciliationCaseLedger() {
  return {
    summary: { total: 0, open: 0, acknowledged: 0, resolved: 0, reopened: 0, unresolved: 0, clearedAwaitingResolution: 0 },
    cases: []
  };
}

function readReconciliationCaseFromDb(db, caseId, includeActions = true) {
  const row = db.prepare("SELECT * FROM postgres_sync_reconciliation_cases WHERE case_id = ?").get(caseId);
  if (!row) return null;
  const actions = includeActions
    ? db.prepare("SELECT * FROM postgres_sync_reconciliation_case_actions WHERE case_id = ? ORDER BY created_at DESC, rowid DESC").all(caseId).map(reconciliationCaseActionRow)
    : [];
  return reconciliationCaseRow(row, actions);
}

function listPostgresReconciliationHistory(sqliteFile, options = {}) {
  if (!fs.existsSync(sqliteFile)) return [];
  const limit = Math.min(MAX_RECONCILIATION_HISTORY, Math.max(1, Number(options.limit || 20) || 20));
  const status = String(options.status || "").trim();
  if (status && !["matched", "mismatched", "error"].includes(status)) {
    throw new PostgresReconciliationCaseError("Unsupported reconciliation status", "INVALID_RECONCILIATION_STATUS");
  }
  const db = openSqlite(sqliteFile);
  try {
    if (!sqliteTableExists(db, "postgres_sync_reconciliations")) return [];
    const rows = status
      ? db.prepare("SELECT * FROM postgres_sync_reconciliations WHERE status = ? ORDER BY checked_at DESC, rowid DESC LIMIT ?").all(status, limit)
      : db.prepare("SELECT * FROM postgres_sync_reconciliations ORDER BY checked_at DESC, rowid DESC LIMIT ?").all(limit);
    return rows.map(reconciliationRow);
  } finally {
    db.close();
  }
}

function readPostgresReconciliationRun(sqliteFile, runId) {
  if (!fs.existsSync(sqliteFile)) return null;
  const db = openSqlite(sqliteFile);
  try {
    if (!sqliteTableExists(db, "postgres_sync_reconciliations")) return null;
    return reconciliationRow(db.prepare("SELECT * FROM postgres_sync_reconciliations WHERE run_id = ?").get(String(runId || "")));
  } finally {
    db.close();
  }
}

function listPostgresReconciliationCases(sqliteFile, options = {}) {
  if (!fs.existsSync(sqliteFile)) return emptyReconciliationCaseLedger();
  const limit = Math.min(200, Math.max(1, Number(options.limit || 50) || 50));
  const status = String(options.status || "").trim();
  if (status && !RECONCILIATION_CASE_STATUSES.has(status)) {
    throw new PostgresReconciliationCaseError("Unsupported reconciliation case status", "INVALID_RECONCILIATION_CASE_STATUS");
  }
  const db = openSqlite(sqliteFile);
  try {
    if (!sqliteTableExists(db, "postgres_sync_reconciliation_cases")) return emptyReconciliationCaseLedger();
    const rows = status
      ? db.prepare("SELECT * FROM postgres_sync_reconciliation_cases WHERE status = ? ORDER BY updated_at DESC, rowid DESC LIMIT ?").all(status, limit)
      : db.prepare("SELECT * FROM postgres_sync_reconciliation_cases ORDER BY CASE status WHEN 'reopened' THEN 0 WHEN 'open' THEN 1 WHEN 'acknowledged' THEN 2 ELSE 3 END, updated_at DESC, rowid DESC LIMIT ?").all(limit);
    const counts = db.prepare("SELECT status, COUNT(*) AS count FROM postgres_sync_reconciliation_cases GROUP BY status").all()
      .reduce((summary, row) => ({ ...summary, [row.status]: Number(row.count || 0) }), {});
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    const cleared = db.prepare("SELECT COUNT(*) AS count FROM postgres_sync_reconciliation_cases WHERE status != 'resolved' AND cleared_at != ''").get();
    return {
      summary: {
        total,
        open: counts.open || 0,
        acknowledged: counts.acknowledged || 0,
        resolved: counts.resolved || 0,
        reopened: counts.reopened || 0,
        unresolved: (counts.open || 0) + (counts.acknowledged || 0) + (counts.reopened || 0),
        clearedAwaitingResolution: Number(cleared?.count || 0)
      },
      cases: rows.map((row) => reconciliationCaseRow(row))
    };
  } finally {
    db.close();
  }
}

function readPostgresReconciliationCase(sqliteFile, caseId) {
  if (!fs.existsSync(sqliteFile)) return null;
  const db = openSqlite(sqliteFile);
  try {
    if (!sqliteTableExists(db, "postgres_sync_reconciliation_cases")) return null;
    return readReconciliationCaseFromDb(db, String(caseId || ""));
  } finally {
    db.close();
  }
}

function boundedCaseText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeCaseEvidenceRefs(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new PostgresReconciliationCaseError("evidenceRefs must be an array", "INVALID_RECONCILIATION_EVIDENCE");
  return [...new Set(value.map((item) => boundedCaseText(item, 240)).filter(Boolean))].slice(0, 10);
}

function applyPostgresReconciliationCaseAction(sqliteFile, caseId, input = {}, actor = {}) {
  const action = boundedCaseText(input.action, 40);
  if (!RECONCILIATION_CASE_ACTIONS.has(action)) {
    throw new PostgresReconciliationCaseError("Unsupported reconciliation case action", "INVALID_RECONCILIATION_CASE_ACTION");
  }
  const db = openSqlite(sqliteFile);
  try {
    if (!sqliteTableExists(db, "postgres_sync_reconciliation_cases")) {
      throw new PostgresReconciliationCaseError("Reconciliation case ledger is unavailable", "RECONCILIATION_CASE_LEDGER_UNAVAILABLE", 409);
    }
    db.exec("BEGIN IMMEDIATE");
    const current = readReconciliationCaseFromDb(db, String(caseId || ""), false);
    if (!current) throw new PostgresReconciliationCaseError("Reconciliation case not found", "RECONCILIATION_CASE_NOT_FOUND", 404);
    const note = boundedCaseText(input.note, 1000);
    const requestedOwner = boundedCaseText(input.owner, 120);
    const evidenceRefs = normalizeCaseEvidenceRefs(input.evidenceRefs);
    const now = input.at || new Date().toISOString();
    const actorName = boundedCaseText(actor.name || actor.username || actor.id || "unknown", 120);
    const actorRole = boundedCaseText(actor.role || "unknown", 60);
    let nextStatus = current.status;
    let owner = requestedOwner || current.owner;
    let resolutionNote = current.resolutionNote;
    let resolvedAt = current.resolvedAt;
    let resolvedBy = current.resolvedBy;
    let clearedAt = current.clearedAt;
    let clearedRunId = current.clearedRunId;

    if (action === "assign") {
      if (requestedOwner.length < 2) throw new PostgresReconciliationCaseError("owner is required", "RECONCILIATION_CASE_OWNER_REQUIRED");
    } else if (action === "acknowledge") {
      if (!["open", "reopened"].includes(current.status)) throw new PostgresReconciliationCaseError("Only open or reopened cases can be acknowledged", "INVALID_RECONCILIATION_CASE_TRANSITION", 409);
      if (!owner) throw new PostgresReconciliationCaseError("owner is required before acknowledgement", "RECONCILIATION_CASE_OWNER_REQUIRED");
      if (note.length < 4) throw new PostgresReconciliationCaseError("acknowledgement note is required", "RECONCILIATION_CASE_NOTE_REQUIRED");
      nextStatus = "acknowledged";
    } else if (action === "resolve") {
      if (current.status !== "acknowledged") throw new PostgresReconciliationCaseError("Only acknowledged cases can be resolved", "INVALID_RECONCILIATION_CASE_TRANSITION", 409);
      if (!current.clearedAt) throw new PostgresReconciliationCaseError("A matched reconciliation run is required before resolution", "RECONCILIATION_CLEARANCE_REQUIRED", 409);
      if (note.length < 8 || evidenceRefs.length === 0) throw new PostgresReconciliationCaseError("resolution note and evidenceRefs are required", "RECONCILIATION_RESOLUTION_EVIDENCE_REQUIRED");
      nextStatus = "resolved";
      resolutionNote = note;
      resolvedAt = now;
      resolvedBy = actorName;
    } else if (action === "reopen") {
      if (current.status !== "resolved") throw new PostgresReconciliationCaseError("Only resolved cases can be reopened", "INVALID_RECONCILIATION_CASE_TRANSITION", 409);
      if (note.length < 8) throw new PostgresReconciliationCaseError("reopen note is required", "RECONCILIATION_CASE_NOTE_REQUIRED");
      nextStatus = "reopened";
      resolutionNote = "";
      resolvedAt = "";
      resolvedBy = "";
      clearedAt = "";
      clearedRunId = "";
    } else if (action === "comment" && note.length < 2) {
      throw new PostgresReconciliationCaseError("comment note is required", "RECONCILIATION_CASE_NOTE_REQUIRED");
    }

    db.prepare(`
      UPDATE postgres_sync_reconciliation_cases
      SET status = ?, owner = ?, resolution_note = ?, resolved_at = ?, resolved_by = ?,
          cleared_at = ?, cleared_run_id = ?, updated_at = ?
      WHERE case_id = ?
    `).run(nextStatus, owner, resolutionNote, resolvedAt, resolvedBy, clearedAt, clearedRunId, now, current.caseId);
    db.prepare(`
      INSERT INTO postgres_sync_reconciliation_case_actions (
        action_id, case_id, action, from_status, to_status, actor, role, owner, note, evidence_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(`pgrca-${randomUUID()}`, current.caseId, action, current.status, nextStatus, actorName, actorRole, owner, note, JSON.stringify(evidenceRefs), now);
    db.exec("COMMIT");
    return readPostgresReconciliationCase(sqliteFile, current.caseId);
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  } finally {
    db.close();
  }
}

function readPostgresSyncStatus(sqliteFile) {
  const empty = {
    pending: 0,
    retry: 0,
    delivered: 0,
    failed: 0,
    oldestPendingAt: "",
    lastDeliveredAt: "",
    reconciliation: {
      status: "never",
      runId: "",
      checkedAt: "",
      matched: 0,
      mismatched: 0,
      durationMs: 0,
      cases: emptyReconciliationCaseLedger().summary
    }
  };
  if (!fs.existsSync(sqliteFile)) return empty;
  const db = openSqlite(sqliteFile);
  try {
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'postgres_sync_outbox'").get();
    if (!table) return empty;
    const counts = db.prepare("SELECT status, COUNT(*) AS count FROM postgres_sync_outbox GROUP BY status").all()
      .reduce((result, row) => ({ ...result, [row.status]: Number(row.count) }), {});
    const pending = db.prepare("SELECT MIN(created_at) AS oldest FROM postgres_sync_outbox WHERE status IN ('pending', 'retry')").get();
    const delivered = db.prepare("SELECT MAX(delivered_at) AS latest FROM postgres_sync_outbox WHERE status = 'delivered'").get();
    const reconciliationTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'postgres_sync_reconciliations'").get();
    const latest = reconciliationTable ? db.prepare(`
      SELECT run_id, checked_at, status, matched, mismatched, duration_ms
      FROM postgres_sync_reconciliations
      ORDER BY checked_at DESC, rowid DESC
      LIMIT 1
    `).get() : null;
    const caseTable = sqliteTableExists(db, "postgres_sync_reconciliation_cases");
    const caseCounts = caseTable
      ? db.prepare("SELECT status, COUNT(*) AS count FROM postgres_sync_reconciliation_cases GROUP BY status").all()
        .reduce((summary, row) => ({ ...summary, [row.status]: Number(row.count || 0) }), {})
      : {};
    const caseTotal = Object.values(caseCounts).reduce((sum, count) => sum + count, 0);
    const clearedAwaitingResolution = caseTable
      ? Number(db.prepare("SELECT COUNT(*) AS count FROM postgres_sync_reconciliation_cases WHERE status != 'resolved' AND cleared_at != ''").get()?.count || 0)
      : 0;
    const caseSummary = {
      total: caseTotal,
      open: caseCounts.open || 0,
      acknowledged: caseCounts.acknowledged || 0,
      resolved: caseCounts.resolved || 0,
      reopened: caseCounts.reopened || 0,
      unresolved: (caseCounts.open || 0) + (caseCounts.acknowledged || 0) + (caseCounts.reopened || 0),
      clearedAwaitingResolution
    };
    return {
      pending: counts.pending || 0,
      retry: counts.retry || 0,
      delivered: counts.delivered || 0,
      failed: counts.failed || 0,
      oldestPendingAt: pending?.oldest || "",
      lastDeliveredAt: delivered?.latest || "",
      reconciliation: latest ? {
        status: latest.status,
        runId: latest.run_id,
        checkedAt: latest.checked_at,
        matched: Number(latest.matched || 0),
        mismatched: Number(latest.mismatched || 0),
        durationMs: Number(latest.duration_ms || 0),
        cases: caseSummary
      } : empty.reconciliation
    };
  } finally {
    db.close();
  }
}

function assessPostgresSyncHealth(sqliteFile, options = {}) {
  const status = readPostgresSyncStatus(sqliteFile);
  const nowMs = Number(options.nowMs ?? Date.now());
  const maxBacklog = boundedPrimaryReadLimit(options.maxBacklog, 1000, 0, 1000000);
  const maxPendingAgeSeconds = boundedPrimaryReadLimit(options.maxPendingAgeSeconds, 300, 1, 86400 * 30);
  const maxReconciliationAgeSeconds = boundedPrimaryReadLimit(options.maxReconciliationAgeSeconds, 900, 1, 86400 * 30);
  const backlog = status.pending + status.retry;
  const pendingAgeSeconds = status.oldestPendingAt
    ? Math.max(0, Math.floor((nowMs - Date.parse(status.oldestPendingAt)) / 1000))
    : 0;
  const reconciliationAgeSeconds = status.reconciliation.checkedAt
    ? Math.max(0, Math.floor((nowMs - Date.parse(status.reconciliation.checkedAt)) / 1000))
    : null;
  const checks = [
    { id: "postgres-sync:backlog-capacity", passed: backlog <= maxBacklog, value: backlog, threshold: maxBacklog },
    { id: "postgres-sync:pending-lag", passed: pendingAgeSeconds <= maxPendingAgeSeconds, value: pendingAgeSeconds, threshold: maxPendingAgeSeconds },
    { id: "postgres-sync:terminal-failures", passed: status.failed === 0, value: status.failed, threshold: 0 },
    { id: "postgres-sync:reconciliation-current", passed: reconciliationAgeSeconds !== null && reconciliationAgeSeconds <= maxReconciliationAgeSeconds, value: reconciliationAgeSeconds, threshold: maxReconciliationAgeSeconds },
    { id: "postgres-sync:reconciliation-matched", passed: status.reconciliation.status === "matched" && status.reconciliation.mismatched === 0, value: status.reconciliation.mismatched, threshold: 0 },
    { id: "postgres-sync:difference-cases", passed: status.reconciliation.cases.unresolved === 0, value: status.reconciliation.cases.unresolved, threshold: 0 }
  ];
  return { ok: checks.every((item) => item.passed), productionPrimary: false, role: "shadow-sync-and-reconciliation", checkedAt: new Date(nowMs).toISOString(), backlog, pendingAgeSeconds, reconciliationAgeSeconds, status, checks };
}

async function probePostgresInfrastructure(options = {}) {
  const schema = postgresSchemaIdentifier(options.schema);
  const requiredTables = ["auth_security_state", "auth_sessions", "runtime_collection_state", "runtime_sync_batches"];
  const poolConfig = options.pool ? null : (options.poolConfig || postgresPoolConfig(options.env || process.env));
  const pool = options.pool || new (options.PoolClass || require("pg").Pool)(poolConfig);
  try {
    const result = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = $1 AND table_name = ANY($2::text[])
      ORDER BY table_name
    `, [schema, requiredTables]);
    const available = new Set((result.rows || []).map((row) => String(row.table_name || "")));
    const missingTables = requiredTables.filter((table) => !available.has(table));
    return { ok: missingTables.length === 0, available: true, schema, requiredTables: requiredTables.length, verifiedTables: requiredTables.length - missingTables.length, missingTables, errorCode: "", productionPrimary: false, credentialsExposed: false };
  } catch (error) {
    return { ok: false, available: false, schema, requiredTables: requiredTables.length, verifiedTables: 0, missingTables: [], errorCode: safePostgresErrorCode(error), productionPrimary: false, credentialsExposed: false };
  } finally {
    if (!options.pool) await pool.end();
  }
}

async function assessPostgresInfrastructureHealth(sqliteFile, options = {}) {
  const shadow = assessPostgresSyncHealth(sqliteFile, options);
  const target = await probePostgresInfrastructure(options);
  const checks = [
    ...shadow.checks,
    { id: "postgres-target:connectivity", passed: target.available, value: target.available, threshold: true },
    { id: "postgres-target:schema", passed: target.ok, value: target.verifiedTables, threshold: target.requiredTables }
  ];
  return { ok: checks.every((item) => item.passed), productionPrimary: false, role: "session-auth-state-and-shadow-sync", checkedAt: shadow.checkedAt, shadow, target, checks };
}

function loadSqliteCollectionState(sqliteFile) {
  const db = openSqlite(sqliteFile);
  try {
    return buildCollectionSnapshotChanges(db.prepare("SELECT key, payload, version FROM state_collections ORDER BY key").all())
      .map((item) => ({
        collection: item.collection,
        sourceVersion: item.sourceVersion,
        payloadSha256: item.payloadSha256
      }));
  } finally {
    db.close();
  }
}

function comparePostgresShadowState(localRows = [], remoteRows = []) {
  const local = new Map(localRows.map((row) => [row.collection, row]));
  const remote = new Map(remoteRows.map((row) => [row.collection, row]));
  const names = [...new Set([...local.keys(), ...remote.keys()])].sort();
  const differences = [];
  let matched = 0;
  names.forEach((collection) => {
    const source = local.get(collection);
    const target = remote.get(collection);
    const types = [];
    if (!target) types.push("missing-remote");
    else if (!source) types.push("unexpected-remote");
    else {
      if (Number(source.sourceVersion) !== Number(target.sourceVersion)) types.push("version-mismatch");
      if (source.payloadSha256 !== target.payloadSha256) types.push("digest-mismatch");
    }
    if (!types.length) {
      matched += 1;
      return;
    }
    differences.push({
      collection,
      types,
      localVersion: source ? Number(source.sourceVersion) : null,
      remoteVersion: target ? Number(target.sourceVersion) : null,
      localDigest: source?.payloadSha256 || "",
      remoteDigest: target?.payloadSha256 || "",
      batchId: target?.batchId || ""
    });
  });
  const countType = (type) => differences.filter((item) => item.types.includes(type)).length;
  return {
    localCollections: local.size,
    remoteCollections: remote.size,
    matched,
    mismatched: differences.length,
    missingRemote: countType("missing-remote"),
    unexpectedRemote: countType("unexpected-remote"),
    versionMismatches: countType("version-mismatch"),
    digestMismatches: countType("digest-mismatch"),
    differences
  };
}

function boundedPrimaryReadLimit(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function normalizePostgresPrimaryReadRow(row) {
  const collection = String(row?.collection_name || row?.collection || "").trim();
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,239}$/.test(collection) || collection === "storageMeta") {
    throw new PostgresPrimaryReadError("PostgreSQL primary read returned an invalid collection name", "INVALID_PRIMARY_READ_COLLECTION", 409);
  }
  const sourceVersion = Number(row?.source_version ?? row?.sourceVersion);
  if (!Number.isInteger(sourceVersion) || sourceVersion < 0) {
    throw new PostgresPrimaryReadError("PostgreSQL primary read returned an invalid collection version", "INVALID_PRIMARY_READ_VERSION", 409);
  }
  let value;
  try {
    value = typeof row?.payload === "string" ? JSON.parse(row.payload) : row?.payload;
  } catch {
    throw new PostgresPrimaryReadError("PostgreSQL primary read returned invalid JSON", "INVALID_PRIMARY_READ_PAYLOAD", 409);
  }
  if (value === undefined) {
    throw new PostgresPrimaryReadError("PostgreSQL primary read returned an empty payload", "INVALID_PRIMARY_READ_PAYLOAD", 409);
  }
  const payload = canonicalStringify(value);
  const payloadSha256 = String(row?.payload_sha256 || row?.payloadSha256 || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(payloadSha256) || sha256(payload) !== payloadSha256) {
    throw new PostgresPrimaryReadError("PostgreSQL primary read payload digest verification failed", "PRIMARY_READ_DIGEST_MISMATCH", 409);
  }
  return {
    collection,
    sourceVersion,
    payloadSha256,
    batchId: String(row?.batch_id || row?.batchId || "").trim().slice(0, 120),
    value,
    bytes: Buffer.byteLength(payload)
  };
}

function buildPostgresPrimaryReadSnapshot(rows = [], options = {}) {
  if (!Array.isArray(rows) || !rows.length) {
    throw new PostgresPrimaryReadError("PostgreSQL primary read returned no collections", "PRIMARY_READ_EMPTY", 409);
  }
  const maxCollections = boundedPrimaryReadLimit(options.maxCollections, MAX_PRIMARY_READ_COLLECTIONS, 1, MAX_PRIMARY_READ_COLLECTIONS);
  const maxBytes = boundedPrimaryReadLimit(options.maxBytes, DEFAULT_PRIMARY_READ_MAX_BYTES, 1024, 512 * 1024 * 1024);
  if (rows.length > maxCollections) {
    throw new PostgresPrimaryReadError("PostgreSQL primary read collection limit exceeded", "PRIMARY_READ_COLLECTION_LIMIT", 409);
  }
  const normalized = rows.map(normalizePostgresPrimaryReadRow).sort((a, b) => a.collection.localeCompare(b.collection));
  const names = new Set();
  let payloadBytes = 0;
  normalized.forEach((item) => {
    if (names.has(item.collection)) {
      throw new PostgresPrimaryReadError("PostgreSQL primary read returned duplicate collections", "PRIMARY_READ_DUPLICATE_COLLECTION", 409);
    }
    names.add(item.collection);
    payloadBytes += item.bytes;
    if (payloadBytes > maxBytes) {
      throw new PostgresPrimaryReadError("PostgreSQL primary read payload limit exceeded", "PRIMARY_READ_PAYLOAD_LIMIT", 409);
    }
  });
  const requiredCollections = [...new Set((options.requiredCollections || []).map((item) => String(item || "").trim()).filter(Boolean))];
  const missingRequired = requiredCollections.filter((item) => !names.has(item));
  if (missingRequired.length) {
    throw new PostgresPrimaryReadError("PostgreSQL primary read is missing required collections", "PRIMARY_READ_REQUIRED_COLLECTION_MISSING", 409);
  }
  const metadata = normalized.map((item) => ({
    collection: item.collection,
    sourceVersion: item.sourceVersion,
    payloadSha256: item.payloadSha256,
    batchId: item.batchId
  }));
  const expectedRows = Array.isArray(options.expectedRows) ? options.expectedRows : [];
  const comparison = expectedRows.length ? comparePostgresShadowState(expectedRows, metadata) : null;
  if (comparison && comparison.mismatched > 0) {
    const error = new PostgresPrimaryReadError("PostgreSQL primary read does not match the verified shadow baseline", "PRIMARY_READ_BASELINE_MISMATCH", 409);
    error.report = {
      localCollections: comparison.localCollections,
      remoteCollections: comparison.remoteCollections,
      matched: comparison.matched,
      mismatched: comparison.mismatched
    };
    throw error;
  }
  const manifest = metadata.map(({ collection, sourceVersion, payloadSha256 }) => ({ collection, sourceVersion, payloadSha256 }));
  const state = normalized.reduce((result, item) => {
    result[item.collection] = item.value;
    return result;
  }, {});
  const versions = normalized.map((item) => item.sourceVersion);
  return {
    state,
    report: {
      collections: normalized.length,
      payloadBytes,
      matchedBaselineCollections: comparison?.matched || 0,
      sourceVersionMin: Math.min(...versions),
      sourceVersionMax: Math.max(...versions),
      snapshotSha256: sha256(canonicalStringify(manifest)),
      credentialsPersisted: false,
      payloadsExposed: false,
      productionPrimary: false,
      writePrimary: false,
      runtimeCutoverEnabled: false
    }
  };
}

async function runPostgresPrimaryReadRehearsal(options = {}) {
  const mode = assertPrimaryReadMode(options.mode || PRIMARY_READ_MODE);
  if (mode !== "rehearsal") {
    throw new PostgresPrimaryReadError("POSTGRES_PRIMARY_READ_MODE=rehearsal is required", "PRIMARY_READ_REHEARSAL_DISABLED", 409);
  }
  const syncMode = assertSyncMode(options.syncMode || SYNC_MODE);
  if (syncMode !== "outbox") {
    throw new PostgresPrimaryReadError("POSTGRES_SYNC_MODE=outbox is required", "PRIMARY_READ_OUTBOX_REQUIRED", 409);
  }
  const sqliteFile = path.resolve(options.sqliteFile || path.join(process.env.DATA_DIR || path.join(__dirname, "data"), "health-city.sqlite"));
  if (!fs.existsSync(sqliteFile)) {
    throw new PostgresPrimaryReadError("SQLite shadow baseline is unavailable", "PRIMARY_READ_BASELINE_UNAVAILABLE", 409);
  }
  const expectedRows = options.expectedRows || loadSqliteCollectionState(sqliteFile);
  if (!expectedRows.length) {
    throw new PostgresPrimaryReadError("SQLite shadow baseline is empty", "PRIMARY_READ_BASELINE_UNAVAILABLE", 409);
  }
  const env = options.env || process.env;
  const poolConfig = options.pool ? null : (options.poolConfig || postgresPoolConfig(env));
  const pool = options.pool || new (options.PoolClass || require("pg").Pool)(poolConfig);
  const runId = options.runId || `pgread-${randomUUID()}`;
  const schema = postgresSchemaIdentifier(options.schema);
  const checkedAt = options.checkedAt || new Date().toISOString();
  const startedAt = Date.now();
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const result = await client.query(`
      SELECT collection_name, payload, payload_sha256, source_version, batch_id, updated_at
      FROM ${schema}.runtime_collection_state
      ORDER BY collection_name
    `);
    const snapshot = buildPostgresPrimaryReadSnapshot(result.rows, {
      expectedRows,
      requiredCollections: options.requiredCollections,
      maxCollections: options.maxCollections || env.POSTGRES_PRIMARY_READ_MAX_COLLECTIONS,
      maxBytes: options.maxBytes || env.POSTGRES_PRIMARY_READ_MAX_BYTES
    });
    await client.query("COMMIT");
    return {
      state: snapshot.state,
      report: {
        ok: true,
        runId,
        checkedAt,
        status: "verified-rehearsal",
        durationMs: Math.max(0, Date.now() - startedAt),
        transaction: "repeatable-read-read-only",
        ...snapshot.report
      }
    };
  } catch (error) {
    try { await client?.query?.("ROLLBACK"); } catch {}
    if (error instanceof PostgresPrimaryReadError) throw error;
    const safeCode = /^[A-Z0-9_]{2,80}$/.test(String(error?.code || "")) ? String(error.code) : "POSTGRES_PRIMARY_READ_FAILED";
    throw new PostgresPrimaryReadError("PostgreSQL primary read rehearsal failed", safeCode, 502);
  } finally {
    client?.release?.();
    if (!options.pool) await pool.end();
  }
}

function insertSystemReconciliationCaseAction(db, caseId, action, fromStatus, toStatus, owner, runId, createdAt) {
  db.prepare(`
    INSERT INTO postgres_sync_reconciliation_case_actions (
      action_id, case_id, action, from_status, to_status, actor, role, owner, note, evidence_json, created_at
    ) VALUES (?, ?, ?, ?, ?, 'shadow-reconciler', 'system', ?, ?, ?, ?)
  `).run(
    `pgrca-${randomUUID()}`,
    caseId,
    action,
    fromStatus,
    toStatus,
    owner,
    action === "detected" ? "Difference detected by read-only shadow reconciliation." : action === "auto-reopen" ? "Resolved difference appeared again." : "A later reconciliation no longer observed this difference.",
    JSON.stringify([`reconciliation:${runId}`]),
    createdAt
  );
}

function syncPostgresReconciliationCases(db, report) {
  if (!sqliteTableExists(db, "postgres_sync_reconciliation_cases") || !sqliteTableExists(db, "postgres_sync_reconciliation_case_actions")) return;
  if (report.status === "error") return;
  const observedCollections = new Set();
  (report.differences || []).forEach((difference) => {
    const collection = boundedCaseText(difference.collection, 240);
    if (!collection) return;
    observedCollections.add(collection);
    const existing = db.prepare("SELECT * FROM postgres_sync_reconciliation_cases WHERE collection_name = ?").get(collection);
    const caseId = existing?.case_id || `pgrc-${sha256(collection).slice(0, 24)}`;
    const differenceTypes = [...new Set((difference.types || []).map((item) => boundedCaseText(item, 80)).filter(Boolean))];
    if (!existing) {
      db.prepare(`
        INSERT INTO postgres_sync_reconciliation_cases (
          case_id, collection_name, status, owner, severity, first_run_id, latest_run_id, cleared_run_id,
          first_seen_at, last_seen_at, cleared_at, occurrence_count, difference_types_json,
          local_version, remote_version, local_digest, remote_digest,
          resolution_note, resolved_at, resolved_by, updated_at
        ) VALUES (?, ?, 'open', 'database-operations', 'critical', ?, ?, '', ?, ?, '', 1, ?, ?, ?, ?, ?, '', '', '', ?)
      `).run(
        caseId,
        collection,
        report.runId,
        report.runId,
        report.checkedAt,
        report.checkedAt,
        JSON.stringify(differenceTypes),
        difference.localVersion ?? null,
        difference.remoteVersion ?? null,
        boundedCaseText(difference.localDigest, 128),
        boundedCaseText(difference.remoteDigest, 128),
        report.checkedAt
      );
      insertSystemReconciliationCaseAction(db, caseId, "detected", "none", "open", "database-operations", report.runId, report.checkedAt);
      return;
    }
    const nextStatus = existing.status === "resolved" ? "reopened" : existing.status;
    db.prepare(`
      UPDATE postgres_sync_reconciliation_cases
      SET status = ?, latest_run_id = ?, cleared_run_id = '', last_seen_at = ?, cleared_at = '',
          occurrence_count = occurrence_count + 1, difference_types_json = ?,
          local_version = ?, remote_version = ?, local_digest = ?, remote_digest = ?,
          resolution_note = CASE WHEN status = 'resolved' THEN '' ELSE resolution_note END,
          resolved_at = CASE WHEN status = 'resolved' THEN '' ELSE resolved_at END,
          resolved_by = CASE WHEN status = 'resolved' THEN '' ELSE resolved_by END,
          updated_at = ?
      WHERE case_id = ?
    `).run(
      nextStatus,
      report.runId,
      report.checkedAt,
      JSON.stringify(differenceTypes),
      difference.localVersion ?? null,
      difference.remoteVersion ?? null,
      boundedCaseText(difference.localDigest, 128),
      boundedCaseText(difference.remoteDigest, 128),
      report.checkedAt,
      caseId
    );
    if (existing.status === "resolved") {
      insertSystemReconciliationCaseAction(db, caseId, "auto-reopen", "resolved", "reopened", existing.owner, report.runId, report.checkedAt);
    }
  });

  db.prepare("SELECT * FROM postgres_sync_reconciliation_cases WHERE status != 'resolved' AND cleared_at = ''").all()
    .filter((row) => !observedCollections.has(row.collection_name))
    .forEach((row) => {
      db.prepare(`
        UPDATE postgres_sync_reconciliation_cases
        SET cleared_run_id = ?, cleared_at = ?, updated_at = ?
        WHERE case_id = ?
      `).run(report.runId, report.checkedAt, report.checkedAt, row.case_id);
      insertSystemReconciliationCaseAction(db, row.case_id, "verified-clear", row.status, row.status, row.owner, report.runId, report.checkedAt);
    });
}

function recordPostgresReconciliation(sqliteFile, report) {
  const db = openSqlite(sqliteFile);
  try {
    db.exec("BEGIN IMMEDIATE");
    db.prepare(`
      INSERT INTO postgres_sync_reconciliations (
        run_id, checked_at, status, local_collections, remote_collections, matched, mismatched,
        missing_remote, unexpected_remote, version_mismatches, digest_mismatches,
        duration_ms, error_code, detail_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      report.runId,
      report.checkedAt,
      report.status,
      report.summary.localCollections,
      report.summary.remoteCollections,
      report.summary.matched,
      report.summary.mismatched,
      report.summary.missingRemote,
      report.summary.unexpectedRemote,
      report.summary.versionMismatches,
      report.summary.digestMismatches,
      report.durationMs,
      report.errorCode || "",
      JSON.stringify(report.differences || [])
    );
    syncPostgresReconciliationCases(db, report);
    db.prepare(`
      DELETE FROM postgres_sync_reconciliations
      WHERE rowid NOT IN (
        SELECT rowid FROM postgres_sync_reconciliations ORDER BY checked_at DESC, rowid DESC LIMIT ?
      )
    `).run(MAX_RECONCILIATION_HISTORY);
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  } finally {
    db.close();
  }
}

function readLatestPostgresReconciliation(sqliteFile) {
  if (!fs.existsSync(sqliteFile)) return null;
  const db = openSqlite(sqliteFile);
  try {
    if (!sqliteTableExists(db, "postgres_sync_reconciliations")) return null;
    const row = db.prepare("SELECT * FROM postgres_sync_reconciliations ORDER BY checked_at DESC, rowid DESC LIMIT 1").get();
    return reconciliationRow(row);
  } finally {
    db.close();
  }
}

function loadPendingPostgresSyncBatches(sqliteFile, options = {}) {
  const limit = Math.min(MAX_BATCH_LIMIT, Math.max(1, Number(options.limit || 20) || 20));
  const now = options.now || new Date().toISOString();
  const db = openSqlite(sqliteFile);
  try {
    return db.prepare(`
      SELECT batch_id, created_at, payload, payload_sha256, previous_chain_hash, chain_hash, attempts
      FROM postgres_sync_outbox
      WHERE status IN ('pending', 'retry') AND next_attempt_at <= ?
      ORDER BY sequence
      LIMIT ?
    `).all(now, limit).map((row) => ({
      batchId: row.batch_id,
      createdAt: row.created_at,
      payload: row.payload,
      payloadSha256: row.payload_sha256,
      previousChainHash: row.previous_chain_hash,
      chainHash: row.chain_hash,
      attempts: Number(row.attempts || 0),
      changes: JSON.parse(row.payload).changes
    }));
  } finally {
    db.close();
  }
}

function markPostgresSyncBatch(sqliteFile, batchId, result = {}) {
  const db = openSqlite(sqliteFile);
  try {
    const now = result.at || new Date().toISOString();
    if (result.delivered) {
      const update = db.prepare(`
        UPDATE postgres_sync_outbox
        SET status = 'delivered', attempts = attempts + 1, delivered_at = ?, last_error = '', next_attempt_at = ?
        WHERE batch_id = ? AND status IN ('pending', 'retry')
      `).run(now, now, batchId);
      return Number(update.changes || 0) === 1;
    }
    const row = db.prepare("SELECT attempts, status FROM postgres_sync_outbox WHERE batch_id = ?").get(batchId);
    if (!row || !["pending", "retry"].includes(row.status)) return false;
    const attempts = Number(row?.attempts || 0) + 1;
    const terminal = attempts >= Number(result.maxAttempts || 5);
    const delayMs = Math.min(300000, 1000 * (2 ** Math.min(attempts, 8)));
    const nextAttemptAt = new Date(new Date(now).getTime() + delayMs).toISOString();
    const update = db.prepare(`
      UPDATE postgres_sync_outbox
      SET status = ?, attempts = ?, last_error = ?, next_attempt_at = ?
      WHERE batch_id = ? AND status IN ('pending', 'retry')
    `).run(terminal ? "failed" : "retry", attempts, safePostgresErrorCode(result.error), nextAttemptAt, batchId);
    return Number(update.changes || 0) === 1;
  } finally {
    db.close();
  }
}

async function applyPostgresSyncBatch(client, batch, options = {}) {
  const validation = validatePostgresSyncBatch(batch);
  if (!validation.ok) throw new Error("PostgreSQL sync batch integrity validation failed");
  const schema = postgresSchemaIdentifier(options.schema);
  const parsed = JSON.parse(batch.payload);
  await client.query("BEGIN");
  try {
    const inserted = await client.query(`
      INSERT INTO ${schema}.runtime_sync_batches (
        batch_id, created_at, payload_sha256, previous_chain_hash, chain_hash, status
      ) VALUES ($1, $2, $3, $4, $5, 'applying')
      ON CONFLICT (batch_id) DO NOTHING
      RETURNING batch_id
    `, [batch.batchId, batch.createdAt, batch.payloadSha256, batch.previousChainHash, batch.chainHash]);
    if (inserted.rowCount === 0) {
      const existingBatch = await client.query(`
        SELECT payload_sha256, previous_chain_hash, chain_hash
        FROM ${schema}.runtime_sync_batches
        WHERE batch_id = $1
        FOR UPDATE
      `, [batch.batchId]);
      const existing = existingBatch.rows?.[0];
      const sameIdentity = existingBatch.rowCount === 1
        && constantTimeTextEqual(existing.payload_sha256, batch.payloadSha256)
        && constantTimeTextEqual(existing.previous_chain_hash, batch.previousChainHash)
        && constantTimeTextEqual(existing.chain_hash, batch.chainHash);
      if (!sameIdentity) {
        throw postgresSyncConflict("POSTGRES_SYNC_BATCH_ID_CONFLICT", "PostgreSQL sync batch id is bound to different content");
      }
      await client.query("COMMIT");
      return { applied: false, duplicate: true, changes: 0 };
    }
    for (const change of parsed.changes) {
      if (change.operation === "delete") {
        const current = await client.query(`
          SELECT payload_sha256, source_version
          FROM ${schema}.runtime_collection_state
          WHERE collection_name = $1
          FOR UPDATE
        `, [change.collection]);
        if (current.rowCount === 1 && current.rows?.[0]) {
          const remoteVersion = Number(current.rows[0].source_version);
          if (remoteVersion === Number(change.sourceVersion)) {
            throw postgresSyncConflict("POSTGRES_SYNC_VERSION_CONFLICT", "an equal-version tombstone cannot delete an existing PostgreSQL payload");
          }
          if (remoteVersion < Number(change.sourceVersion)) {
            await client.query(`DELETE FROM ${schema}.runtime_collection_state WHERE collection_name = $1 AND source_version < $2`, [change.collection, change.sourceVersion]);
          }
        }
        continue;
      }
      const current = await client.query(`
        SELECT payload_sha256, source_version
        FROM ${schema}.runtime_collection_state
        WHERE collection_name = $1
        FOR UPDATE
      `, [change.collection]);
      if (current.rowCount === 1 && current.rows?.[0] && Number(current.rows[0].source_version) === Number(change.sourceVersion)) {
        if (!constantTimeTextEqual(current.rows[0].payload_sha256, change.payloadSha256)) {
          throw postgresSyncConflict("POSTGRES_SYNC_VERSION_CONFLICT", "equal PostgreSQL source versions must have identical payload digests");
        }
        continue;
      }
      await client.query(`
        INSERT INTO ${schema}.runtime_collection_state (
          collection_name, payload, payload_sha256, source_version, batch_id, updated_at
        ) VALUES ($1, $2::jsonb, $3, $4, $5, $6)
        ON CONFLICT (collection_name) DO UPDATE SET
          payload = EXCLUDED.payload,
          payload_sha256 = EXCLUDED.payload_sha256,
          source_version = EXCLUDED.source_version,
          batch_id = EXCLUDED.batch_id,
          updated_at = EXCLUDED.updated_at
        WHERE ${schema}.runtime_collection_state.source_version < EXCLUDED.source_version
      `, [change.collection, change.payload, change.payloadSha256, change.sourceVersion, batch.batchId, batch.createdAt]);
    }
    await client.query(`UPDATE ${schema}.runtime_sync_batches SET status = 'applied', applied_at = now() WHERE batch_id = $1`, [batch.batchId]);
    await client.query("COMMIT");
    return { applied: true, duplicate: false, changes: parsed.changes.length };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

function postgresPoolConfig(env = process.env) {
  const connectionString = String(env.DATABASE_URL || "").trim();
  if (!/^postgres(?:ql)?:\/\//i.test(connectionString)) throw new Error("DATABASE_URL must use postgres:// or postgresql://");
  const sslMode = String(env.POSTGRES_SSL_MODE || "verify-full").trim().toLowerCase();
  if (!["disable", "require", "verify-full"].includes(sslMode)) throw new Error(`Unsupported POSTGRES_SSL_MODE=${sslMode}`);
  let ssl = false;
  if (sslMode !== "disable") {
    ssl = { rejectUnauthorized: sslMode === "verify-full" };
    if (env.POSTGRES_CA_FILE) ssl.ca = fs.readFileSync(path.resolve(env.POSTGRES_CA_FILE), "utf8");
  }
  return { connectionString, max: Math.min(10, Math.max(1, Number(env.POSTGRES_POOL_MAX || 2) || 2)), ssl };
}

async function runPostgresShadowReconciliation(options = {}) {
  assertSyncMode(options.mode || SYNC_MODE);
  if ((options.mode || SYNC_MODE) !== "outbox") throw new Error("POSTGRES_SYNC_MODE=outbox is required");
  const startedAt = Date.now();
  const checkedAt = options.checkedAt || new Date().toISOString();
  const sqliteFile = path.resolve(options.sqliteFile || path.join(process.env.DATA_DIR || path.join(__dirname, "data"), "health-city.sqlite"));
  const localRows = loadSqliteCollectionState(sqliteFile);
  const poolConfig = options.pool ? null : (options.poolConfig || postgresPoolConfig(options.env || process.env));
  const PoolClass = options.PoolClass || require("pg").Pool;
  const pool = options.pool || new PoolClass(poolConfig);
  const runId = options.runId || `pgrecon-${randomUUID()}`;
  const schema = postgresSchemaIdentifier(options.schema);
  let client;
  let report;
  try {
    client = await pool.connect();
    await client.query("BEGIN READ ONLY");
    const result = await client.query(`
      SELECT collection_name, payload_sha256, source_version, batch_id
      FROM ${schema}.runtime_collection_state
      ORDER BY collection_name
    `);
    await client.query("COMMIT");
    const remoteRows = result.rows.map((row) => ({
      collection: row.collection_name,
      payloadSha256: row.payload_sha256,
      sourceVersion: Number(row.source_version || 0),
      batchId: row.batch_id || ""
    }));
    const comparison = comparePostgresShadowState(localRows, remoteRows);
    report = {
      ok: comparison.mismatched === 0,
      runId,
      checkedAt,
      status: comparison.mismatched === 0 ? "matched" : "mismatched",
      durationMs: Math.max(0, Date.now() - startedAt),
      summary: {
        localCollections: comparison.localCollections,
        remoteCollections: comparison.remoteCollections,
        matched: comparison.matched,
        mismatched: comparison.mismatched,
        missingRemote: comparison.missingRemote,
        unexpectedRemote: comparison.unexpectedRemote,
        versionMismatches: comparison.versionMismatches,
        digestMismatches: comparison.digestMismatches
      },
      differences: comparison.differences,
      productionPrimary: false
    };
  } catch (error) {
    try { await client?.query?.("ROLLBACK"); } catch {}
    report = {
      ok: false,
      runId,
      checkedAt,
      status: "error",
      durationMs: Math.max(0, Date.now() - startedAt),
      errorCode: safePostgresErrorCode(error),
      summary: {
        localCollections: localRows.length,
        remoteCollections: 0,
        matched: 0,
        mismatched: 0,
        missingRemote: 0,
        unexpectedRemote: 0,
        versionMismatches: 0,
        digestMismatches: 0
      },
      differences: [],
      productionPrimary: false
    };
  } finally {
    client?.release?.();
    if (!options.pool) await pool.end();
  }
  recordPostgresReconciliation(sqliteFile, report);
  return report;
}

async function runPostgresSyncWorker(options = {}) {
  assertSyncMode(options.mode || SYNC_MODE);
  if ((options.mode || SYNC_MODE) !== "outbox") throw new Error("POSTGRES_SYNC_MODE=outbox is required");
  const sqliteFile = path.resolve(options.sqliteFile || path.join(process.env.DATA_DIR || path.join(__dirname, "data"), "health-city.sqlite"));
  const poolConfig = options.pool ? null : (options.poolConfig || postgresPoolConfig(options.env || process.env));
  const batches = loadPendingPostgresSyncBatches(sqliteFile, { limit: options.limit });
  if (!batches.length) return { ok: true, processed: 0, delivered: 0, failed: 0 };
  const PoolClass = options.PoolClass || require("pg").Pool;
  const pool = options.pool || new PoolClass(poolConfig);
  let delivered = 0;
  let failed = 0;
  try {
    for (const batch of batches) {
      let client;
      try {
        client = await pool.connect();
        await applyPostgresSyncBatch(client, batch, { schema: options.schema });
        markPostgresSyncBatch(sqliteFile, batch.batchId, { delivered: true });
        delivered += 1;
      } catch (error) {
        markPostgresSyncBatch(sqliteFile, batch.batchId, { error, maxAttempts: options.maxAttempts });
        failed += 1;
      } finally {
        client?.release?.();
      }
    }
  } finally {
    if (!options.pool) await pool.end();
  }
  return { ok: failed === 0, processed: batches.length, delivered, failed };
}

module.exports = {
  PostgresPrimaryReadError,
  PostgresReconciliationCaseError,
  PRIMARY_READ_MODES,
  SYNC_MODES,
  applyPostgresReconciliationCaseAction,
  applyPostgresSyncBatch,
  assessPostgresInfrastructureHealth,
  assessPostgresSyncHealth,
  assertPrimaryReadMode,
  assertSyncMode,
  buildCollectionChanges,
  buildCollectionSnapshotChanges,
  buildPostgresSyncBatch,
  buildPostgresPrimaryReadSnapshot,
  comparePostgresShadowState,
  enqueuePostgresSyncBatch,
  enqueuePostgresSyncBaseline,
  listPostgresReconciliationCases,
  listPostgresReconciliationHistory,
  loadPendingPostgresSyncBatches,
  loadSqliteCollectionState,
  markPostgresSyncBatch,
  postgresSchemaIdentifier,
  postgresPoolConfig,
  probePostgresInfrastructure,
  readPostgresReconciliationCase,
  readPostgresReconciliationRun,
  readLatestPostgresReconciliation,
  readPostgresSyncStatus,
  recordPostgresReconciliation,
  runPostgresPrimaryReadRehearsal,
  runPostgresShadowReconciliation,
  runPostgresSyncWorker,
  safePostgresErrorCode,
  validatePostgresSyncBatch
};
