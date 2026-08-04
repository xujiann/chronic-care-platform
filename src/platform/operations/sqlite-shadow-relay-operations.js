"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { sha256, stableStringify } = require("./shadow-outbox-relay");

const DOMAINS = Object.freeze(["referral", "emergency"]);
const OPERATIONS = new Set(["relay", "reconcile"]);
const OUTCOMES = new Set(["success", "mismatch", "fault-injected", "failed"]);
const SHA256 = /^sha256:[a-f0-9]{64}$/;

function operationsError(code, message, statusCode = 409) {
  return Object.assign(new Error(message), { code, statusCode });
}

function clean(value, maximum = 240) {
  return String(value || "").trim().replace(/[\r\n\t]+/g, " ").slice(0, maximum);
}

function integer(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function iso(value, label) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) {
    throw operationsError(
      "SHADOW_RELAY_OPERATION_TIME_INVALID",
      `${label} must be a valid timestamp`,
      400
    );
  }
  return new Date(parsed).toISOString();
}

function digest(value, required = false) {
  const normalized = clean(value, 80);
  if (!normalized && !required) return "";
  if (!SHA256.test(normalized)) {
    throw operationsError(
      "SHADOW_RELAY_OPERATION_DIGEST_INVALID",
      "shadow relay operation digest is invalid",
      400
    );
  }
  return normalized;
}

function snapshot(input = {}) {
  const count = integer(input.count);
  const highWatermark = integer(input.highWatermark);
  const value = digest(input.digest, count > 0 || highWatermark > 0);
  if (highWatermark < count || (count === 0 && highWatermark !== 0)) {
    throw operationsError(
      "SHADOW_RELAY_OPERATION_SNAPSHOT_INVALID",
      "shadow relay operation snapshot count or watermark is invalid",
      400
    );
  }
  return Object.freeze({ count, highWatermark, digest: value });
}

function normalizeReceipt(input = {}, options = {}) {
  const domain = clean(input.domain, 40);
  const operation = clean(input.operation, 40);
  const outcome = clean(input.outcome, 40);
  const startedAt = iso(input.startedAt, "startedAt");
  const completedAt = iso(input.completedAt, "completedAt");
  if (!DOMAINS.includes(domain) || !OPERATIONS.has(operation) || !OUTCOMES.has(outcome)) {
    throw operationsError(
      "SHADOW_RELAY_OPERATION_RECEIPT_INVALID",
      "shadow relay operation domain, operation, or outcome is invalid",
      400
    );
  }
  if (Date.parse(completedAt) < Date.parse(startedAt)) {
    throw operationsError(
      "SHADOW_RELAY_OPERATION_TIME_ORDER_INVALID",
      "shadow relay operation completion cannot precede its start",
      400
    );
  }
  const relayId = clean(input.relayId || `${domain}-postgres-shadow-v1`, 160);
  const operationId = clean(input.operationId || options.randomUUID?.() || randomUUID(), 160);
  if (!relayId || !operationId) {
    throw operationsError(
      "SHADOW_RELAY_OPERATION_ID_REQUIRED",
      "shadow relay operation and relay ids are required",
      400
    );
  }
  const source = snapshot(input.source);
  const target = snapshot(input.target);
  const fromSequence = integer(input.fromSequence);
  const toSequence = integer(input.toSequence);
  const checkpointSequence = integer(input.checkpointSequence, toSequence);
  const relayed = integer(input.relayed);
  const idempotentReplays = integer(input.idempotentReplays);
  const faultSequence = integer(input.faultSequence);
  if (toSequence < fromSequence || idempotentReplays > relayed
    || (operation === "relay" && outcome === "success" && checkpointSequence !== toSequence)) {
    throw operationsError(
      "SHADOW_RELAY_OPERATION_SEQUENCE_INVALID",
      "shadow relay operation sequence evidence is invalid",
      400
    );
  }
  const errorCode = clean(input.errorCode, 120);
  if (outcome === "success" && errorCode) {
    throw operationsError(
      "SHADOW_RELAY_OPERATION_ERROR_CONFLICT",
      "successful shadow relay operation cannot retain an error code",
      400
    );
  }
  return Object.freeze({
    operationId,
    relayId,
    domain,
    operation,
    outcome,
    startedAt,
    completedAt,
    fromSequence,
    toSequence,
    checkpointSequence,
    relayed,
    idempotentReplays,
    source,
    target,
    faultPhase: clean(input.faultPhase, 80),
    faultSequence,
    errorCode,
    payloadsExposed: false,
    productionReady: false
  });
}

function receiptEvidence(receipt, previousDigest) {
  return Object.freeze({
    operationId: receipt.operationId,
    relayId: receipt.relayId,
    domain: receipt.domain,
    operation: receipt.operation,
    outcome: receipt.outcome,
    startedAt: receipt.startedAt,
    completedAt: receipt.completedAt,
    fromSequence: receipt.fromSequence,
    toSequence: receipt.toSequence,
    checkpointSequence: receipt.checkpointSequence,
    relayed: receipt.relayed,
    idempotentReplays: receipt.idempotentReplays,
    source: receipt.source,
    target: receipt.target,
    faultPhase: receipt.faultPhase,
    faultSequence: receipt.faultSequence,
    errorCode: receipt.errorCode,
    previousDigest
  });
}

function publicRow(row = {}) {
  return Object.freeze({
    sequence: Number(row.sequence),
    operationId: String(row.operation_id),
    relayId: String(row.relay_id),
    domain: String(row.domain),
    operation: String(row.operation),
    outcome: String(row.outcome),
    startedAt: String(row.started_at),
    completedAt: String(row.completed_at),
    fromSequence: Number(row.from_sequence),
    toSequence: Number(row.to_sequence),
    checkpointSequence: Number(row.checkpoint_sequence),
    relayed: Number(row.relayed),
    idempotentReplays: Number(row.idempotent_replays),
    source: Object.freeze({
      count: Number(row.source_count),
      highWatermark: Number(row.source_high_watermark),
      digest: String(row.source_digest || "")
    }),
    target: Object.freeze({
      count: Number(row.target_count),
      highWatermark: Number(row.target_high_watermark),
      digest: String(row.target_digest || "")
    }),
    faultPhase: String(row.fault_phase || ""),
    faultSequence: Number(row.fault_sequence),
    errorCode: String(row.error_code || ""),
    previousDigest: String(row.previous_digest),
    receiptDigest: String(row.receipt_digest),
    payloadsExposed: false,
    productionReady: false
  });
}

function reportForRows(rows = [], options = {}) {
  const now = iso(options.now?.() || new Date().toISOString(), "now");
  const maximumAgeMinutes = Math.min(24 * 60, Math.max(1, integer(options.maximumAgeMinutes, 60)));
  const chainChecks = [];
  let previousByRelay = new Map();
  for (const row of rows) {
    const previous = previousByRelay.get(row.relayId) || sha256(`shadow-relay-origin:${row.relayId}`);
    const normalized = normalizeReceipt({
      ...row,
      operationId: row.operationId,
      source: row.source,
      target: row.target
    }, { randomUUID: () => row.operationId });
    const expected = sha256(receiptEvidence(normalized, previous));
    const valid = row.previousDigest === previous && row.receiptDigest === expected;
    chainChecks.push(valid);
    previousByRelay.set(row.relayId, row.receiptDigest);
  }
  const domains = Object.fromEntries(DOMAINS.map((domain) => {
    const domainRows = rows.filter((row) => row.domain === domain);
    const latestRelay = [...domainRows].reverse().find((row) =>
      row.operation === "relay");
    const latestSuccessfulRelay = latestRelay?.outcome === "success" ? latestRelay : null;
    const latestReconciliation = [...domainRows].reverse().find((row) =>
      row.operation === "reconcile");
    const fault = [...domainRows].reverse().find((row) =>
      row.operation === "relay" && row.outcome === "fault-injected");
    const recovery = fault
      ? domainRows.find((row) =>
        row.sequence > fault.sequence
        && row.operation === "relay"
        && row.outcome === "success"
        && row.idempotentReplays > 0
        && row.checkpointSequence >= row.toSequence
        && row.checkpointSequence >= fault.faultSequence)
      : null;
    const reconciliationAfterRecovery = recovery
      ? domainRows.find((row) =>
        row.sequence > recovery.sequence
        && row.operation === "reconcile"
        && row.outcome === "success")
      : null;
    const ageMinutes = latestReconciliation
      ? Math.max(0, (Date.parse(now) - Date.parse(latestReconciliation.completedAt)) / 60_000)
      : null;
    const checks = Object.freeze({
      chainValid: domainRows.length > 0 && domainRows.every((row) => {
        const index = rows.findIndex((candidate) => candidate.sequence === row.sequence);
        return chainChecks[index] === true;
      }),
      relaySucceeded: Boolean(latestSuccessfulRelay),
      reconciliationMatched: latestReconciliation?.outcome === "success"
        && latestReconciliation.source.count === latestReconciliation.target.count
        && latestReconciliation.source.highWatermark === latestReconciliation.target.highWatermark
        && latestReconciliation.source.digest === latestReconciliation.target.digest,
      reconciliationCoversRelay: Boolean(latestSuccessfulRelay && latestReconciliation)
        && latestReconciliation.sequence > latestSuccessfulRelay.sequence
        && latestReconciliation.source.highWatermark >= latestSuccessfulRelay.checkpointSequence,
      durableCheckpointVerified: Boolean(latestReconciliation)
        && latestReconciliation.checkpointSequence === latestReconciliation.source.highWatermark,
      faultRecoveryVerified: Boolean(fault && recovery && reconciliationAfterRecovery),
      reconciliationFresh: ageMinutes !== null && ageMinutes <= maximumAgeMinutes
    });
    return [domain, Object.freeze({
      ok: Object.values(checks).every(Boolean),
      checks,
      latestRelayReceiptDigest: latestRelay?.receiptDigest || "",
      latestReconciliationReceiptDigest: latestReconciliation?.receiptDigest || "",
      ageMinutes: ageMinutes === null ? null : Number(ageMinutes.toFixed(3)),
      receipts: domainRows.length,
      payloadsExposed: false,
      productionReady: false
    })];
  }));
  const allRowsValid = rows.length > 0 && chainChecks.every(Boolean);
  const technicalEvidenceFingerprint = sha256({
    domains: Object.fromEntries(Object.entries(domains).map(([domain, value]) => [
      domain,
      {
        ok: value.ok,
        latestRelayReceiptDigest: value.latestRelayReceiptDigest,
        latestReconciliationReceiptDigest: value.latestReconciliationReceiptDigest
      }
    ])),
    receiptDigests: rows.map((row) => row.receiptDigest)
  });
  return Object.freeze({
    schema: "shadow-relay-control-plane-v1",
    ok: allRowsValid && Object.values(domains).every((value) => value.ok),
    generatedAt: now,
    maximumAgeMinutes,
    domains: Object.freeze(domains),
    durableCheckpointVerified: Object.values(domains)
      .every((value) => value.checks.durableCheckpointVerified),
    faultRecoveryVerified: Object.values(domains)
      .every((value) => value.checks.faultRecoveryVerified),
    technicalEvidenceFingerprint,
    receipts: rows.length,
    chainValid: allRowsValid,
    payloadsExposed: false,
    externalEvidenceVerified: false,
    cutoverAuthorized: false,
    productionPrimary: false,
    productionReady: false,
    boundary: "This report verifies only payload-free local relay operations evidence. It cannot prove migration, external delivery, site acceptance, disaster recovery, approval, or production cutover."
  });
}

function openSqliteShadowRelayOperations(options = {}) {
  const inputFile = clean(options.file, 2000);
  if (!inputFile) {
    throw operationsError(
      "SHADOW_RELAY_OPERATIONS_FILE_REQUIRED",
      "shadow relay operations file is required",
      400
    );
  }
  if (!path.isAbsolute(inputFile)) {
    throw operationsError(
      "SHADOW_RELAY_OPERATIONS_FILE_NOT_ABSOLUTE",
      "shadow relay operations file must use an absolute path",
      400
    );
  }
  const file = path.resolve(inputFile);
  const readOnly = options.readOnly === true;
  if (readOnly && !fs.existsSync(file)) {
    throw operationsError(
      "SHADOW_RELAY_OPERATIONS_FILE_NOT_FOUND",
      "shadow relay operations file was not found",
      404
    );
  }
  if (!readOnly) fs.mkdirSync(path.dirname(file), { recursive: true });
  const DatabaseSync = options.DatabaseSync || require("node:sqlite").DatabaseSync;
  const database = new DatabaseSync(file, readOnly ? { readOnly: true } : {});
  database.exec("PRAGMA busy_timeout=5000");
  if (readOnly) database.exec("PRAGMA query_only=ON");
  if (!readOnly) {
    database.exec("PRAGMA journal_mode=WAL");
    database.exec("PRAGMA synchronous=FULL");
    database.exec(`
      CREATE TABLE IF NOT EXISTS shadow_relay_operation_receipts (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        operation_id TEXT NOT NULL UNIQUE,
        relay_id TEXT NOT NULL,
        domain TEXT NOT NULL CHECK (domain IN ('referral', 'emergency')),
        operation TEXT NOT NULL CHECK (operation IN ('relay', 'reconcile')),
        outcome TEXT NOT NULL CHECK (outcome IN ('success', 'mismatch', 'fault-injected', 'failed')),
        started_at TEXT NOT NULL,
        completed_at TEXT NOT NULL,
        from_sequence INTEGER NOT NULL CHECK (from_sequence >= 0),
        to_sequence INTEGER NOT NULL CHECK (to_sequence >= from_sequence),
        checkpoint_sequence INTEGER NOT NULL CHECK (checkpoint_sequence >= 0),
        relayed INTEGER NOT NULL CHECK (relayed >= 0),
        idempotent_replays INTEGER NOT NULL CHECK (
          idempotent_replays >= 0 AND idempotent_replays <= relayed
        ),
        source_count INTEGER NOT NULL CHECK (source_count >= 0),
        source_high_watermark INTEGER NOT NULL CHECK (source_high_watermark >= source_count),
        source_digest TEXT NOT NULL,
        target_count INTEGER NOT NULL CHECK (target_count >= 0),
        target_high_watermark INTEGER NOT NULL CHECK (target_high_watermark >= target_count),
        target_digest TEXT NOT NULL,
        fault_phase TEXT NOT NULL,
        fault_sequence INTEGER NOT NULL CHECK (fault_sequence >= 0),
        error_code TEXT NOT NULL,
        previous_digest TEXT NOT NULL,
        receipt_digest TEXT NOT NULL UNIQUE
      ) STRICT;
      CREATE INDEX IF NOT EXISTS shadow_relay_operation_domain_sequence
        ON shadow_relay_operation_receipts(domain, sequence);
      CREATE INDEX IF NOT EXISTS shadow_relay_operation_relay_sequence
        ON shadow_relay_operation_receipts(relay_id, sequence);
    `);
  }
  const selectAll = database.prepare(`
    SELECT *
    FROM shadow_relay_operation_receipts
    ORDER BY sequence
  `);
  const selectExisting = readOnly ? null : database.prepare(`
    SELECT *
    FROM shadow_relay_operation_receipts
    WHERE operation_id = ?
  `);
  const selectLast = readOnly ? null : database.prepare(`
    SELECT receipt_digest
    FROM shadow_relay_operation_receipts
    WHERE relay_id = ?
    ORDER BY sequence DESC
    LIMIT 1
  `);
  const insert = readOnly ? null : database.prepare(`
    INSERT INTO shadow_relay_operation_receipts (
      operation_id, relay_id, domain, operation, outcome, started_at, completed_at,
      from_sequence, to_sequence, checkpoint_sequence, relayed, idempotent_replays,
      source_count, source_high_watermark, source_digest,
      target_count, target_high_watermark, target_digest,
      fault_phase, fault_sequence, error_code, previous_digest, receipt_digest
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?, ?
    )
  `);
  let closed = false;

  function requireOpen() {
    if (closed) {
      throw operationsError(
        "SHADOW_RELAY_OPERATIONS_CLOSED",
        "shadow relay operations store is closed",
        503
      );
    }
  }

  function rows() {
    requireOpen();
    return selectAll.all().map(publicRow);
  }

  async function append(input = {}) {
    requireOpen();
    if (readOnly) {
      throw operationsError(
        "SHADOW_RELAY_OPERATIONS_READ_ONLY",
        "shadow relay operations store is read-only",
        409
      );
    }
    const receipt = normalizeReceipt(input, options);
    database.exec("BEGIN IMMEDIATE");
    try {
      const existing = selectExisting.get(receipt.operationId);
      if (existing) {
        const current = publicRow(existing);
        const comparable = normalizeReceipt({
          ...current,
          source: current.source,
          target: current.target
        }, { randomUUID: () => current.operationId });
        if (stableStringify(comparable) !== stableStringify(receipt)) {
          throw operationsError(
            "SHADOW_RELAY_OPERATION_ID_CONFLICT",
            "shadow relay operation id was reused with different evidence"
          );
        }
        database.exec("COMMIT");
        return current;
      }
      const previousDigest = String(
        selectLast.get(receipt.relayId)?.receipt_digest
        || sha256(`shadow-relay-origin:${receipt.relayId}`)
      );
      const receiptDigest = sha256(receiptEvidence(receipt, previousDigest));
      insert.run(
        receipt.operationId,
        receipt.relayId,
        receipt.domain,
        receipt.operation,
        receipt.outcome,
        receipt.startedAt,
        receipt.completedAt,
        receipt.fromSequence,
        receipt.toSequence,
        receipt.checkpointSequence,
        receipt.relayed,
        receipt.idempotentReplays,
        receipt.source.count,
        receipt.source.highWatermark,
        receipt.source.digest,
        receipt.target.count,
        receipt.target.highWatermark,
        receipt.target.digest,
        receipt.faultPhase,
        receipt.faultSequence,
        receipt.errorCode,
        previousDigest,
        receiptDigest
      );
      const saved = publicRow(selectExisting.get(receipt.operationId));
      database.exec("COMMIT");
      return saved;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  async function list(input = {}) {
    const domain = clean(input.domain, 40);
    const limit = Math.min(500, Math.max(1, integer(input.limit, 100)));
    return Object.freeze(rows()
      .filter((row) => !domain || row.domain === domain)
      .slice(-limit)
      .reverse());
  }

  async function report(input = {}) {
    return reportForRows(rows(), {
      now: options.now,
      maximumAgeMinutes: input.maximumAgeMinutes
    });
  }

  async function close() {
    if (closed) return;
    database.close();
    closed = true;
  }

  return Object.freeze({
    file,
    readOnly,
    append,
    list,
    report,
    close,
    credentialsPersisted: false,
    payloadsPersisted: false,
    productionReady: false
  });
}

module.exports = {
  DOMAINS,
  normalizeReceipt,
  openSqliteShadowRelayOperations,
  receiptEvidence,
  reportForRows
};
