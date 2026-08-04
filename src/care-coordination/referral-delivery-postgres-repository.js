"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID, timingSafeEqual } = require("node:crypto");
const { postgresPoolConfig } = require("../../postgres-runtime-sync");

const CONTRACT_ID = "referral-order.v1";
const MIGRATION_FILE = path.resolve(__dirname, "..", "..", "deploy", "referral-delivery-postgres.sql");
const MODES = new Set(["disabled", "rehearsal", "evidence-gated"]);
const PAYLOAD_MAX_BYTES = 16 * 1024;
const PAYLOAD_FIELDS = new Set(["commandId", "intentDigest", "contract"]);
const CONTRACT_FIELDS = new Set([
  "contractId", "contractVersion", "referralId", "residentId", "status", "version",
  "type", "priority", "sourceInstitution", "targetInstitution", "updatedAt"
]);
const SENSITIVE_FIELD = /^(?:access[_-]?token|refresh[_-]?token|authorization|api[_-]?key|secret|password|credentials?|private[_-]?key|signing[_-]?key|lease[_-]?token|object[_-]?path)$/i;

class ReferralDeliveryPostgresError extends Error {
  constructor(code, message, statusCode = 503) {
    super(message);
    this.name = "ReferralDeliveryPostgresError";
    this.code = code;
    this.statusCode = statusCode;
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
  return `sha256:${createHash("sha256").update(typeof value === "string" ? value : stableStringify(value)).digest("hex")}`;
}

function secureEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

function text(value, max = 300) {
  return String(value || "").trim().replace(/[\r\n\t]+/g, " ").slice(0, max);
}

function requiredText(value, label, max = 300) {
  const result = text(value, max);
  if (!result) throw new ReferralDeliveryPostgresError("REFERRAL_DELIVERY_INPUT_INVALID", `${label} is required`, 400);
  return result;
}

function iso(value, label = "timestamp", fallback = new Date().toISOString()) {
  const result = new Date(value || fallback);
  if (!Number.isFinite(result.getTime())) {
    throw new ReferralDeliveryPostgresError("REFERRAL_DELIVERY_TIME_INVALID", `${label} is invalid`, 400);
  }
  return result.toISOString();
}

function safeEvidence(value) {
  const result = text(value, 160);
  return result.length >= 4 ? result : "";
}

function assertNoSensitiveFields(value, location = "payload") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSensitiveFields(item, `${location}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_FIELD.test(key)) {
      throw new ReferralDeliveryPostgresError(
        "REFERRAL_DELIVERY_PAYLOAD_SENSITIVE_FIELD",
        `${location}.${key} is not allowed`,
        400
      );
    }
    assertNoSensitiveFields(item, `${location}.${key}`);
  }
}

function boundedString(value, field, max, required = false) {
  if (value === undefined || value === null || value === "") {
    if (required) {
      throw new ReferralDeliveryPostgresError("REFERRAL_DELIVERY_PAYLOAD_INVALID", `${field} is required`, 400);
    }
    return "";
  }
  if (typeof value !== "string" || value.length > max || /[\r\n\t]/.test(value)) {
    throw new ReferralDeliveryPostgresError("REFERRAL_DELIVERY_PAYLOAD_INVALID", `${field} is invalid`, 400);
  }
  return value;
}

function validateReferralPayload(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ReferralDeliveryPostgresError("REFERRAL_DELIVERY_PAYLOAD_INVALID", "referral payload must be an object", 400);
  }
  assertNoSensitiveFields(input);
  const unexpectedPayload = Object.keys(input).filter((key) => !PAYLOAD_FIELDS.has(key));
  if (unexpectedPayload.length) {
    throw new ReferralDeliveryPostgresError("REFERRAL_DELIVERY_PAYLOAD_FIELD_FORBIDDEN", `payload field is not allowed: ${unexpectedPayload[0]}`, 400);
  }
  const contract = input.contract;
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
    throw new ReferralDeliveryPostgresError("REFERRAL_DELIVERY_PAYLOAD_INVALID", "referral contract is required", 400);
  }
  const unexpectedContract = Object.keys(contract).filter((key) => !CONTRACT_FIELDS.has(key));
  if (unexpectedContract.length) {
    throw new ReferralDeliveryPostgresError("REFERRAL_DELIVERY_CONTRACT_FIELD_FORBIDDEN", `contract field is not allowed: ${unexpectedContract[0]}`, 400);
  }
  const normalized = {
    commandId: boundedString(input.commandId, "payload.commandId", 160, true),
    intentDigest: boundedString(input.intentDigest, "payload.intentDigest", 80, true),
    contract: {
      contractId: boundedString(contract.contractId, "contract.contractId", 80, true),
      contractVersion: boundedString(contract.contractVersion, "contract.contractVersion", 32, true),
      referralId: boundedString(contract.referralId, "contract.referralId", 200, true),
      residentId: boundedString(contract.residentId, "contract.residentId", 200, true),
      status: boundedString(contract.status, "contract.status", 100, true),
      version: Number(contract.version),
      type: boundedString(contract.type, "contract.type", 100),
      priority: boundedString(contract.priority, "contract.priority", 80),
      sourceInstitution: boundedString(contract.sourceInstitution, "contract.sourceInstitution", 200),
      targetInstitution: boundedString(contract.targetInstitution, "contract.targetInstitution", 200),
      updatedAt: boundedString(contract.updatedAt, "contract.updatedAt", 80, true)
    }
  };
  if (normalized.contract.contractId !== CONTRACT_ID
    || !/^[a-f0-9]{64}$/i.test(normalized.intentDigest)
    || !Number.isSafeInteger(normalized.contract.version)
    || normalized.contract.version < 1
    || !Number.isFinite(Date.parse(normalized.contract.updatedAt))) {
    throw new ReferralDeliveryPostgresError("REFERRAL_DELIVERY_PAYLOAD_INVALID", "referral contract binding is invalid", 400);
  }
  if (Buffer.byteLength(stableStringify(normalized), "utf8") > PAYLOAD_MAX_BYTES) {
    throw new ReferralDeliveryPostgresError("REFERRAL_DELIVERY_PAYLOAD_TOO_LARGE", "referral payload exceeds 16KB", 413);
  }
  return Object.freeze(normalized);
}

function buildReferralDeliveryPostgresConfig(env = process.env) {
  const mode = text(env.REFERRAL_DELIVERY_POSTGRES_MODE || "disabled", 40).toLowerCase();
  if (!MODES.has(mode)) {
    throw new ReferralDeliveryPostgresError("REFERRAL_DELIVERY_POSTGRES_MODE_INVALID", "referral delivery PostgreSQL mode is invalid", 400);
  }
  const databaseUrl = text(env.DATABASE_URL, 2000);
  const sslMode = text(env.POSTGRES_SSL_MODE || "verify-full", 40).toLowerCase();
  const evidence = {
    migration: safeEvidence(env.REFERRAL_DELIVERY_MIGRATION_EVIDENCE_ID),
    backup: safeEvidence(env.REFERRAL_DELIVERY_BACKUP_EVIDENCE_ID),
    recovery: safeEvidence(env.REFERRAL_DELIVERY_RECOVERY_EVIDENCE_ID),
    cutover: safeEvidence(env.REFERRAL_DELIVERY_CUTOVER_APPROVAL_ID),
    tlsProbe: safeEvidence(env.REFERRAL_DELIVERY_POSTGRES_TLS_PROBE_EVIDENCE_ID)
  };
  const requirements = {
    modeEnabled: mode !== "disabled",
    databaseUrl: /^postgres(?:ql)?:\/\//i.test(databaseUrl),
    tlsVerified: sslMode === "verify-full",
    migrationEvidence: Boolean(evidence.migration),
    backupEvidence: Boolean(evidence.backup),
    recoveryEvidence: Boolean(evidence.recovery),
    cutoverEvidence: Boolean(evidence.cutover),
    tlsProbeEvidence: Boolean(evidence.tlsProbe)
  };
  const evidenceReady = requirements.migrationEvidence
    && requirements.backupEvidence
    && requirements.recoveryEvidence
    && requirements.cutoverEvidence
    && requirements.tlsProbeEvidence;
  return Object.freeze({
    adapter: "referral-delivery-postgres-v1",
    mode,
    configured: requirements.modeEnabled && requirements.databaseUrl,
    writeEnabled: mode === "evidence-gated" && requirements.databaseUrl && requirements.tlsVerified && evidenceReady,
    evidenceReady,
    requirements: Object.freeze(requirements),
    evidence: Object.freeze(evidence),
    migration: Object.freeze({
      path: "deploy/referral-delivery-postgres.sql",
      sha256: sha256(fs.readFileSync(MIGRATION_FILE))
    }),
    credentialsPersisted: false,
    centralCutover: false,
    productionReady: false
  });
}

function buildReferralDeliveryPoolConfig(env = process.env, override = {}) {
  const base = { ...postgresPoolConfig(env), ...(override || {}) };
  const ssl = base.ssl && typeof base.ssl === "object" ? { ...base.ssl } : {};
  return Object.freeze({
    ...base,
    ssl: Object.freeze({ ...ssl, rejectUnauthorized: true })
  });
}

function safeDatabaseError(error) {
  if (error instanceof ReferralDeliveryPostgresError) return error;
  if (String(error?.code || "") === "23505") {
    return new ReferralDeliveryPostgresError("REFERRAL_DELIVERY_DATABASE_CONFLICT", "referral delivery database conflict", 409);
  }
  if (String(error?.code || "") === "40001") {
    return new ReferralDeliveryPostgresError("REFERRAL_DELIVERY_SERIALIZATION_RETRY", "referral delivery transaction must be retried", 409);
  }
  return new ReferralDeliveryPostgresError("REFERRAL_DELIVERY_DATABASE_FAILED", "referral delivery database operation failed");
}

async function withClient(pool, transaction, work) {
  let client;
  try {
    client = await pool.connect();
    await client.query(transaction);
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { await client?.query("ROLLBACK"); } catch {}
    throw safeDatabaseError(error);
  } finally {
    client?.release?.();
  }
}

function rowToInternal(row = {}) {
  const payload = validateReferralPayload(row.payload);
  const payloadDigest = String(row.payload_sha256 || "");
  if (!secureEqual(sha256(payload), payloadDigest)) {
    throw new ReferralDeliveryPostgresError(
      "REFERRAL_DELIVERY_PAYLOAD_INTEGRITY_FAILED",
      "persisted referral delivery payload integrity failed",
      500
    );
  }
  return {
    id: String(row.event_id || ""),
    type: String(row.event_type || ""),
    contractId: String(row.contract_id || ""),
    aggregateVersion: Number(row.aggregate_version || 0),
    correlationId: String(row.correlation_id || ""),
    payload,
    payloadDigest,
    status: String(row.status || ""),
    attempts: Number(row.attempts || 0),
    maxAttempts: Number(row.max_attempts || 0),
    nextAttemptAt: row.next_attempt_at ? iso(row.next_attempt_at) : null,
    leaseOwner: String(row.lease_owner || ""),
    leaseTokenDigest: String(row.lease_token_sha256 || ""),
    leaseVersion: Number(row.lease_version || 0),
    leaseExpiresAt: row.lease_expires_at ? iso(row.lease_expires_at) : null,
    ackLeaseTokenDigest: String(row.ack_lease_token_sha256 || ""),
    receipt: row.receipt ? structuredClone(row.receipt) : null,
    receiptDigest: String(row.receipt_sha256 || ""),
    deliveredAt: row.delivered_at ? iso(row.delivered_at) : null,
    deadLetteredAt: row.dead_lettered_at ? iso(row.dead_lettered_at) : null,
    lastErrorCode: String(row.last_error_code || ""),
    lastErrorDigest: String(row.last_error_sha256 || ""),
    replayCount: Number(row.replay_count || 0),
    createdAt: row.created_at ? iso(row.created_at) : null,
    updatedAt: row.updated_at ? iso(row.updated_at) : null
  };
}

function operationsRowToPublic(row = {}) {
  return Object.freeze({
    id: String(row.event_id || ""),
    type: String(row.event_type || ""),
    status: String(row.status || ""),
    attempts: Number(row.attempts || 0),
    maxAttempts: Number(row.max_attempts || 0),
    leaseVersion: Number(row.lease_version || 0),
    nextAttemptAt: row.next_attempt_at ? iso(row.next_attempt_at) : null,
    leaseExpiresAt: row.lease_expires_at ? iso(row.lease_expires_at) : null,
    deliveredAt: row.delivered_at ? iso(row.delivered_at) : null,
    deadLetteredAt: row.dead_lettered_at ? iso(row.dead_lettered_at) : null,
    lastErrorCode: String(row.last_error_code || "") || null,
    replayCount: Number(row.replay_count || 0),
    createdAt: row.created_at ? iso(row.created_at) : null,
    updatedAt: row.updated_at ? iso(row.updated_at) : null
  });
}

function publicEvent(event) {
  return Object.freeze({
    id: event.id,
    type: event.type,
    status: event.status,
    attempts: event.attempts,
    maxAttempts: event.maxAttempts,
    leaseVersion: event.leaseVersion,
    nextAttemptAt: event.nextAttemptAt,
    leaseExpiresAt: event.leaseExpiresAt,
    deliveredAt: event.deliveredAt,
    deadLetteredAt: event.deadLetteredAt,
    lastErrorCode: event.lastErrorCode || null,
    replayCount: event.replayCount,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt
  });
}

function receiptProjection(receipt = {}) {
  return {
    requestId: requiredText(receipt.requestId, "receipt.requestId", 240),
    eventId: requiredText(receipt.eventId, "receipt.eventId", 240),
    payloadDigest: requiredText(receipt.payloadDigest, "receipt.payloadDigest", 80),
    providerMessageId: requiredText(receipt.providerMessageId, "receipt.providerMessageId", 240),
    status: requiredText(receipt.status, "receipt.status", 40).toLowerCase(),
    occurredAt: iso(receipt.occurredAt, "receipt.occurredAt"),
    attempt: Number(receipt.attempt),
    leaseVersion: Number(receipt.leaseVersion),
    sentAt: iso(receipt.sentAt, "receipt.sentAt"),
    nonce: requiredText(receipt.nonce, "receipt.nonce", 128),
    signatureDigest: requiredText(receipt.signatureDigest, "receipt.signatureDigest", 80),
    signatureVerified: receipt.signatureVerified === true
  };
}

function createReferralDeliveryPostgresRepository(options = {}) {
  const env = options.env || process.env;
  const config = options.config || buildReferralDeliveryPostgresConfig(env);
  const maxAttempts = Math.min(100, Math.max(1, Number(options.maxAttempts) || 5));
  const retryBaseMs = Math.max(100, Number(options.retryBaseMs) || 1000);
  const retryMaxMs = Math.max(retryBaseMs, Number(options.retryMaxMs) || 15 * 60 * 1000);
  let ownedPool;

  function assertExternalPoolTlsEvidence() {
    if (!options.pool || options.testBypassEvidenceGate === true) return;
    const probe = options.tlsProbeEvidence || {};
    if (!config.requirements?.tlsProbeEvidence
      || probe.verified !== true
      || probe.rejectUnauthorized !== true
      || probe.evidenceId !== config.evidence?.tlsProbe
      || !Number.isFinite(Date.parse(probe.checkedAt || ""))) {
      throw new ReferralDeliveryPostgresError(
        "REFERRAL_DELIVERY_POSTGRES_TLS_PROBE_REQUIRED",
        "verified PostgreSQL TLS probe evidence is required for an injected pool",
        409
      );
    }
  }

  function pool() {
    if (options.pool) {
      assertExternalPoolTlsEvidence();
      return options.pool;
    }
    if (!config.configured) {
      throw new ReferralDeliveryPostgresError("REFERRAL_DELIVERY_POSTGRES_NOT_CONFIGURED", "referral delivery PostgreSQL is not configured");
    }
    if (!ownedPool) {
      ownedPool = new (options.PoolClass || require("pg").Pool)(
        buildReferralDeliveryPoolConfig(env, options.poolConfig)
      );
    }
    return ownedPool;
  }

  function assertWriteEnabled() {
    if (options.testBypassEvidenceGate === true) return;
    if (!config.writeEnabled) {
      throw new ReferralDeliveryPostgresError("REFERRAL_DELIVERY_POSTGRES_WRITE_BLOCKED", "referral delivery PostgreSQL evidence gate is closed", 409);
    }
  }

  async function enqueue(eventInput = {}) {
    assertWriteEnabled();
    const createdAt = iso(eventInput.occurredAt, "occurredAt");
    const event = {
      id: requiredText(eventInput.id, "event.id", 240),
      type: requiredText(eventInput.type, "event.type", 160),
      contractId: requiredText(eventInput.contractId || CONTRACT_ID, "event.contractId", 80),
      aggregateVersion: Number(eventInput.aggregateVersion),
      correlationId: requiredText(eventInput.correlationId || "not-provided", "event.correlationId", 240),
      payload: validateReferralPayload(eventInput.payload),
      status: "pending",
      attempts: 0,
      maxAttempts: Math.min(100, Math.max(1, Number(eventInput.maxAttempts) || maxAttempts)),
      nextAttemptAt: createdAt,
      leaseVersion: 0,
      replayCount: 0,
      createdAt,
      updatedAt: createdAt
    };
    if (event.contractId !== CONTRACT_ID || !Number.isSafeInteger(event.aggregateVersion) || event.aggregateVersion < 1) {
      throw new ReferralDeliveryPostgresError("REFERRAL_DELIVERY_EVENT_INVALID", "referral delivery event contract or version is invalid", 400);
    }
    event.payloadDigest = sha256(event.payload);
    return withClient(pool(), "BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE", async (client) => {
      const inserted = await client.query(`
        INSERT INTO health_platform.referral_delivery_outbox (
          event_id, event_type, contract_id, aggregate_version, correlation_id, payload, payload_sha256,
          status, attempts, max_attempts, next_attempt_at, lease_version, replay_count, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, 'pending', 0, $8, $9, 0, 0, $9, $9)
        ON CONFLICT (event_id) DO NOTHING
        RETURNING event_id
      `, [
        event.id, event.type, event.contractId, event.aggregateVersion, event.correlationId,
        JSON.stringify(event.payload), event.payloadDigest, event.maxAttempts, event.createdAt
      ]);
      if (inserted.rowCount === 1) {
        return Object.freeze({ idempotentReplay: false, event: publicEvent(event) });
      }
      const existing = await client.query(
        "SELECT * FROM health_platform.referral_delivery_outbox WHERE event_id = $1 FOR UPDATE",
        [event.id]
      );
      if (existing.rowCount !== 1) {
        throw new ReferralDeliveryPostgresError("REFERRAL_DELIVERY_ENQUEUE_INTEGRITY_FAILED", "enqueued event could not be verified", 500);
      }
      const current = rowToInternal(existing.rows[0]);
      if (current.type !== event.type
        || current.contractId !== event.contractId
        || current.aggregateVersion !== event.aggregateVersion
        || !secureEqual(current.payloadDigest, event.payloadDigest)) {
        throw new ReferralDeliveryPostgresError(
          "REFERRAL_DELIVERY_ENQUEUE_CONFLICT",
          "event id was already enqueued with a different payload",
          409
        );
      }
      return Object.freeze({ idempotentReplay: true, event: publicEvent(current) });
    });
  }

  async function selectForUpdate(client, eventId) {
    const result = await client.query(
      "SELECT * FROM health_platform.referral_delivery_outbox WHERE event_id = $1 FOR UPDATE",
      [requiredText(eventId, "eventId", 240)]
    );
    if (result.rowCount !== 1) {
      throw new ReferralDeliveryPostgresError("REFERRAL_DELIVERY_EVENT_NOT_FOUND", "referral delivery event was not found", 404);
    }
    return rowToInternal(result.rows[0]);
  }

  async function claim(input = {}) {
    assertWriteEnabled();
    const workerId = requiredText(input.workerId, "workerId", 160);
    const claimedAt = iso(input.now, "now");
    const limit = Math.min(100, Math.max(1, Number(input.limit) || 10));
    const leaseMs = Math.min(15 * 60 * 1000, Math.max(1000, Number(input.leaseMs) || 30 * 1000));
    return withClient(pool(), "BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED", async (client) => {
      const rows = await client.query(`
        SELECT * FROM health_platform.referral_delivery_outbox
        WHERE (
          (status = 'pending' AND next_attempt_at <= $1) OR
          (status = 'leased' AND lease_expires_at <= $1)
        )
        ORDER BY created_at, event_id
        FOR UPDATE SKIP LOCKED
        LIMIT $2
      `, [claimedAt, limit]);
      const claims = [];
      for (const row of rows.rows) {
        const event = rowToInternal(row);
        if (event.status === "leased" && event.attempts >= event.maxAttempts) {
          const failureDigest = sha256("delivery lease expired at maximum attempts");
          await client.query(`
            UPDATE health_platform.referral_delivery_outbox SET
              status = 'dead-letter', lease_owner = NULL, lease_token_sha256 = NULL,
              lease_expires_at = NULL, dead_lettered_at = $2, last_error_code = 'DELIVERY_LEASE_EXPIRED',
              last_error_sha256 = $3, updated_at = $2
            WHERE event_id = $1 AND lease_version = $4
          `, [event.id, claimedAt, failureDigest, event.leaseVersion]);
          continue;
        }
        const leaseToken = randomUUID();
        const leaseTokenDigest = sha256(leaseToken);
        const leaseVersion = event.leaseVersion + 1;
        const leaseExpiresAt = new Date(Date.parse(claimedAt) + leaseMs).toISOString();
        const updated = await client.query(`
          UPDATE health_platform.referral_delivery_outbox SET
            status = 'leased', attempts = attempts + 1, next_attempt_at = NULL,
            lease_owner = $2, lease_token_sha256 = $3, lease_version = $4,
            lease_expires_at = $5, updated_at = $6
          WHERE event_id = $1 AND lease_version = $7
          RETURNING event_id
        `, [event.id, workerId, leaseTokenDigest, leaseVersion, leaseExpiresAt, claimedAt, event.leaseVersion]);
        if (updated.rowCount !== 1) {
          throw new ReferralDeliveryPostgresError("REFERRAL_DELIVERY_LEASE_CONFLICT", "referral delivery lease version changed", 409);
        }
        claims.push(Object.freeze({
          id: event.id,
          type: event.type,
          contractId: event.contractId,
          aggregateVersion: event.aggregateVersion,
          correlationId: event.correlationId,
          payload: structuredClone(event.payload),
          payloadDigest: event.payloadDigest,
          attempt: event.attempts + 1,
          leaseToken,
          leaseVersion,
          leaseExpiresAt
        }));
      }
      return Object.freeze(claims);
    });
  }

  function assertActiveLease(event, input, at) {
    const tokenDigest = sha256(requiredText(input.leaseToken, "leaseToken", 240));
    const workerId = requiredText(input.workerId, "workerId", 160);
    const leaseVersion = Number(input.leaseVersion);
    if (event.status !== "leased"
      || event.leaseOwner !== workerId
      || !secureEqual(event.leaseTokenDigest, tokenDigest)
      || event.leaseVersion !== leaseVersion
      || Date.parse(event.leaseExpiresAt || 0) <= Date.parse(at)) {
      throw new ReferralDeliveryPostgresError("REFERRAL_DELIVERY_LEASE_STALE", "referral delivery lease is stale or invalid", 409);
    }
    return tokenDigest;
  }

  async function acknowledge(eventId, input = {}) {
    assertWriteEnabled();
    const acknowledgedAt = iso(input.acknowledgedAt, "acknowledgedAt");
    const normalizedReceipt = receiptProjection(input.receipt);
    const receiptDigest = sha256(normalizedReceipt);
    return withClient(pool(), "BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED", async (client) => {
      const event = await selectForUpdate(client, eventId);
      const tokenDigest = sha256(requiredText(input.leaseToken, "leaseToken", 240));
      if (event.status === "delivered") {
        if (!secureEqual(event.ackLeaseTokenDigest, tokenDigest) || !secureEqual(event.receiptDigest, receiptDigest)) {
          throw new ReferralDeliveryPostgresError("REFERRAL_DELIVERY_ACK_CONFLICT", "acknowledgement differs from persisted receipt", 409);
        }
        return Object.freeze({ idempotentReplay: true, event: publicEvent(event) });
      }
      assertActiveLease(event, input, acknowledgedAt);
      if (!normalizedReceipt.signatureVerified
        || !/^sha256:[a-f0-9]{64}$/.test(normalizedReceipt.signatureDigest)
        || normalizedReceipt.requestId !== event.id
        || normalizedReceipt.eventId !== event.id
        || normalizedReceipt.payloadDigest !== event.payloadDigest
        || normalizedReceipt.attempt !== event.attempts
        || normalizedReceipt.leaseVersion !== event.leaseVersion
        || !/^[a-f0-9]{64}$/.test(normalizedReceipt.nonce)
        || !new Set(["accepted", "delivered"]).has(normalizedReceipt.status)) {
        throw new ReferralDeliveryPostgresError("REFERRAL_DELIVERY_RECEIPT_INVALID", "verified receipt binding is required", 409);
      }
      await client.query(`
        UPDATE health_platform.referral_delivery_outbox SET
          status = 'delivered', lease_owner = NULL, lease_token_sha256 = NULL, lease_expires_at = NULL,
          ack_lease_token_sha256 = $2, receipt = $3::jsonb, receipt_sha256 = $4,
          delivered_at = $5, last_error_code = NULL, last_error_sha256 = NULL, updated_at = $5
        WHERE event_id = $1 AND lease_version = $6
      `, [event.id, tokenDigest, JSON.stringify(normalizedReceipt), receiptDigest, acknowledgedAt, event.leaseVersion]);
      const delivered = {
        ...event,
        status: "delivered",
        leaseOwner: "",
        leaseTokenDigest: "",
        leaseExpiresAt: null,
        ackLeaseTokenDigest: tokenDigest,
        receipt: normalizedReceipt,
        receiptDigest,
        deliveredAt: acknowledgedAt,
        updatedAt: acknowledgedAt
      };
      return Object.freeze({ idempotentReplay: false, event: publicEvent(delivered) });
    });
  }

  async function fail(eventId, input = {}) {
    assertWriteEnabled();
    const failedAt = iso(input.failedAt, "failedAt");
    return withClient(pool(), "BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED", async (client) => {
      const event = await selectForUpdate(client, eventId);
      assertActiveLease(event, input, failedAt);
      const errorCode = text(input.errorCode || "DELIVERY_FAILED", 120) || "DELIVERY_FAILED";
      const errorDigest = sha256(text(input.errorMessage || errorCode, 1000));
      const deadLetter = event.attempts >= event.maxAttempts;
      const nextAttemptAt = deadLetter
        ? null
        : new Date(Date.parse(failedAt) + Math.min(retryMaxMs, retryBaseMs * (2 ** Math.max(0, event.attempts - 1)))).toISOString();
      await client.query(`
        UPDATE health_platform.referral_delivery_outbox SET
          status = $2, next_attempt_at = $3, lease_owner = NULL, lease_token_sha256 = NULL,
          lease_expires_at = NULL, dead_lettered_at = $4, last_error_code = $5,
          last_error_sha256 = $6, updated_at = $7
        WHERE event_id = $1 AND lease_version = $8
      `, [
        event.id, deadLetter ? "dead-letter" : "pending", nextAttemptAt,
        deadLetter ? failedAt : null, errorCode, errorDigest, failedAt, event.leaseVersion
      ]);
      return publicEvent({
        ...event,
        status: deadLetter ? "dead-letter" : "pending",
        nextAttemptAt,
        leaseOwner: "",
        leaseTokenDigest: "",
        leaseExpiresAt: null,
        deadLetteredAt: deadLetter ? failedAt : null,
        lastErrorCode: errorCode,
        lastErrorDigest: errorDigest,
        updatedAt: failedAt
      });
    });
  }

  async function replayDeadLetter(input = {}) {
    assertWriteEnabled();
    if (text(input.actorRole, 40) !== "commission") {
      throw new ReferralDeliveryPostgresError("REFERRAL_DELIVERY_REPLAY_FORBIDDEN", "commission role is required for replay", 403);
    }
    const eventId = requiredText(input.eventId, "eventId", 240);
    const replayKeyDigest = sha256(requiredText(input.replayKey, "replayKey", 240));
    const reasonDigest = sha256(requiredText(input.reason, "reason", 1000));
    const intentDigest = sha256({ eventId, reasonDigest });
    const requestedAt = iso(input.requestedAt, "requestedAt");
    const requestedBy = requiredText(input.requestedBy, "requestedBy", 160);
    return withClient(pool(), "BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE", async (client) => {
      const replay = await client.query(
        "SELECT * FROM health_platform.referral_delivery_replays WHERE replay_key_sha256 = $1 FOR UPDATE",
        [replayKeyDigest]
      );
      if (replay.rowCount === 1) {
        const evidence = replay.rows[0];
        if (!secureEqual(evidence.intent_sha256, intentDigest)) {
          throw new ReferralDeliveryPostgresError("REFERRAL_DELIVERY_REPLAY_CONFLICT", "replay key was used for another intent", 409);
        }
        if (!secureEqual(evidence.result_sha256, sha256(evidence.result))) {
          throw new ReferralDeliveryPostgresError("REFERRAL_DELIVERY_REPLAY_INTEGRITY_FAILED", "replay result integrity failed", 500);
        }
        return Object.freeze({ idempotentReplay: true, event: structuredClone(evidence.result), evidenceDigest: replayKeyDigest });
      }
      const event = await selectForUpdate(client, eventId);
      if (event.status !== "dead-letter") {
        throw new ReferralDeliveryPostgresError("REFERRAL_DELIVERY_NOT_DEAD_LETTER", "only dead-letter events can be replayed", 409);
      }
      const next = {
        ...event,
        status: "pending",
        attempts: 0,
        nextAttemptAt: requestedAt,
        leaseOwner: "",
        leaseTokenDigest: "",
        leaseExpiresAt: null,
        leaseVersion: event.leaseVersion + 1,
        deadLetteredAt: null,
        lastErrorCode: "",
        lastErrorDigest: "",
        replayCount: event.replayCount + 1,
        updatedAt: requestedAt
      };
      const result = publicEvent(next);
      const resultDigest = sha256(result);
      await client.query(`
        UPDATE health_platform.referral_delivery_outbox SET
          status = 'pending', attempts = 0, next_attempt_at = $2, lease_owner = NULL,
          lease_token_sha256 = NULL, lease_expires_at = NULL, lease_version = $3,
          dead_lettered_at = NULL, last_error_code = NULL, last_error_sha256 = NULL,
          replay_count = replay_count + 1, updated_at = $2
        WHERE event_id = $1 AND lease_version = $4
      `, [event.id, requestedAt, next.leaseVersion, event.leaseVersion]);
      await client.query(`
        INSERT INTO health_platform.referral_delivery_replays (
          replay_key_sha256, event_id, intent_sha256, result, result_sha256, requested_by, requested_at
        ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)
      `, [replayKeyDigest, event.id, intentDigest, JSON.stringify(result), resultDigest, requestedBy, requestedAt]);
      return Object.freeze({ idempotentReplay: false, event: result, evidenceDigest: replayKeyDigest });
    });
  }

  async function operations(input = {}) {
    const limit = Math.min(500, Math.max(1, Number(input.limit) || 100));
    return withClient(pool(), "BEGIN READ ONLY", async (client) => {
      const countsResult = await client.query(`
        SELECT status, count(*)::integer AS count
        FROM health_platform.referral_delivery_outbox
        GROUP BY status
      `);
      const eventsResult = await client.query(`
        SELECT event_id, event_type, status, attempts, max_attempts, lease_version,
          next_attempt_at, lease_expires_at, delivered_at, dead_lettered_at,
          last_error_code, replay_count, created_at, updated_at
        FROM health_platform.referral_delivery_outbox
        ORDER BY updated_at DESC
        LIMIT $1
      `, [limit]);
      const counts = { pending: 0, leased: 0, delivered: 0, "dead-letter": 0 };
      for (const row of countsResult.rows) if (Object.hasOwn(counts, row.status)) counts[row.status] = Number(row.count);
      return Object.freeze({
        counts: Object.freeze(counts),
        total: Object.values(counts).reduce((sum, value) => sum + value, 0),
        events: eventsResult.rows.map(operationsRowToPublic),
        returnedEvents: eventsResult.rows.length,
        postgresConfigured: config.configured,
        postgresEvidenceReady: config.evidenceReady,
        centralCutover: false,
        productionReady: false
      });
    });
  }

  async function verifySchema() {
    return withClient(pool(), "BEGIN READ ONLY", async (client) => {
      const result = await client.query(`
        SELECT
          to_regclass('health_platform.referral_delivery_outbox') AS outbox,
          to_regclass('health_platform.referral_delivery_replays') AS replays
      `);
      const row = result.rows[0] || {};
      const checks = {
        outbox: Boolean(row.outbox),
        replays: Boolean(row.replays)
      };
      return Object.freeze({
        ok: Object.values(checks).every(Boolean),
        checks: Object.freeze(checks),
        migration: config.migration,
        productionReady: false,
        productionPrimary: false
      });
    });
  }

  async function close() {
    if (ownedPool) {
      await ownedPool.end();
      ownedPool = null;
    }
  }

  return Object.freeze({
    acknowledge,
    claim,
    close,
    config,
    enqueue,
    fail,
    operations,
    replayDeadLetter,
    verifySchema
  });
}

module.exports = {
  CONTRACT_ID,
  MIGRATION_FILE,
  ReferralDeliveryPostgresError,
  buildReferralDeliveryPostgresConfig,
  buildReferralDeliveryPoolConfig,
  createReferralDeliveryPostgresRepository,
  PAYLOAD_MAX_BYTES,
  operationsRowToPublic,
  publicEvent,
  rowToInternal,
  sha256,
  stableStringify,
  validateReferralPayload
};
