"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { postgresPoolConfig } = require("../../postgres-runtime-sync");
const Delivery = require("../http/routes/t06-emergency-signal-delivery");
const { projectEmergencySignalEvent } = require("./emergency-signal-delivery-contract");

const MIGRATION_FILE = path.join(__dirname, "..", "..", "deploy", "emergency-signal-delivery-postgres.sql");
const MODES = new Set(["disabled", "rehearsal", "evidence-gated"]);
const STATUS_VALUES = new Set(["pending", "processing", "published", "dead-letter"]);

function sha256(value) {
  return `sha256:${createHash("sha256").update(String(value)).digest("hex")}`;
}

function stableDigest(value) {
  return sha256(Delivery.stableStringify(value));
}

function safeText(value, maximum = 240) {
  return String(value || "").trim().replace(/[\r\n\t]+/g, " ").slice(0, maximum);
}

function requiredText(value, label, maximum = 240) {
  const normalized = safeText(value, maximum);
  if (!normalized) {
    throw new Delivery.EmergencySignalDeliveryError(
      "EMERGENCY_SIGNAL_POSTGRES_FIELD_REQUIRED",
      `${label} is required`,
      400
    );
  }
  return normalized;
}

function safeEvidenceReference(value) {
  const reference = safeText(value, 160);
  return reference.length >= 4 ? reference : "";
}

function buildEmergencySignalPostgresConfig(env = process.env) {
  const mode = safeText(env.EMERGENCY_SIGNAL_POSTGRES_MODE || "disabled", 40).toLowerCase();
  if (!MODES.has(mode)) {
    throw new Delivery.EmergencySignalDeliveryError(
      "EMERGENCY_SIGNAL_POSTGRES_MODE_INVALID",
      "emergency signal PostgreSQL mode is invalid",
      400
    );
  }
  const databaseUrl = String(env.DATABASE_URL || "").trim();
  const sslMode = safeText(env.POSTGRES_SSL_MODE || "verify-full", 40).toLowerCase();
  const evidence = {
    migration: safeEvidenceReference(env.EMERGENCY_SIGNAL_MIGRATION_EVIDENCE_ID),
    backup: safeEvidenceReference(env.EMERGENCY_SIGNAL_BACKUP_EVIDENCE_ID),
    recovery: safeEvidenceReference(env.EMERGENCY_SIGNAL_RECOVERY_EVIDENCE_ID),
    cutover: safeEvidenceReference(env.EMERGENCY_SIGNAL_CUTOVER_APPROVAL_ID)
  };
  const requirements = {
    modeEnabled: mode !== "disabled",
    databaseUrl: /^postgres(?:ql)?:\/\//i.test(databaseUrl),
    tlsVerified: sslMode === "verify-full",
    migrationEvidence: Boolean(evidence.migration),
    backupEvidence: Boolean(evidence.backup),
    recoveryEvidence: Boolean(evidence.recovery),
    cutoverApproval: Boolean(evidence.cutover)
  };
  const evidenceReady = requirements.migrationEvidence
    && requirements.backupEvidence
    && requirements.recoveryEvidence
    && requirements.cutoverApproval;
  return Object.freeze({
    adapter: "emergency-signal-delivery-postgres.v1",
    mode,
    configured: requirements.modeEnabled && requirements.databaseUrl,
    evidenceReady,
    writeEnabled: mode === "evidence-gated"
      && requirements.databaseUrl
      && requirements.tlsVerified
      && evidenceReady,
    requirements: Object.freeze(requirements),
    migration: Object.freeze({
      path: "deploy/emergency-signal-delivery-postgres.sql",
      sha256: sha256(fs.readFileSync(MIGRATION_FILE))
    }),
    credentialsPersisted: false,
    productionReady: false,
    boundary: "Configuration does not authorize T00 cutover or prove a live database, worker, transport, restore drill, or signed site acceptance."
  });
}

function postgresError(message, code, statusCode = 500) {
  return new Delivery.EmergencySignalDeliveryError(code, message, statusCode);
}

function safeDatabaseError(error, fallbackCode = "EMERGENCY_SIGNAL_POSTGRES_FAILED") {
  if (error instanceof Delivery.EmergencySignalDeliveryError) return error;
  if (String(error?.code || "") === "40001") {
    return postgresError(
      "emergency signal PostgreSQL serialization conflict",
      "EMERGENCY_SIGNAL_POSTGRES_SERIALIZATION_RETRY",
      409
    );
  }
  if (String(error?.code || "") === "23505") {
    return postgresError(
      "emergency signal PostgreSQL uniqueness conflict",
      "EMERGENCY_SIGNAL_POSTGRES_CONFLICT",
      409
    );
  }
  return postgresError(
    "emergency signal PostgreSQL operation failed",
    /^[A-Z0-9_]{2,80}$/.test(String(error?.code || "")) ? String(error.code) : fallbackCode,
    503
  );
}

function jsonValue(value) {
  if (typeof value !== "string") return structuredClone(value || {});
  try {
    return JSON.parse(value);
  } catch {
    throw postgresError(
      "emergency signal PostgreSQL JSON state is invalid",
      "EMERGENCY_SIGNAL_POSTGRES_INTEGRITY_INVALID"
    );
  }
}

function isoText(value, label = "time") {
  const parsed = value instanceof Date ? value.getTime() : Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) {
    throw postgresError(`${label} must be a valid timestamp`, "EMERGENCY_SIGNAL_POSTGRES_TIME_INVALID", 400);
  }
  return new Date(parsed).toISOString();
}

function optionalIsoText(value, label) {
  return value ? isoText(value, label) : "";
}

function eventPayload(outboxRow = {}) {
  try {
    return projectEmergencySignalEvent(outboxRow);
  } catch (error) {
    throw postgresError(
      "emergency signal event failed the persistence contract",
      String(error?.code || "EMERGENCY_SIGNAL_DELIVERY_CONTRACT_INVALID"),
      Number(error?.statusCode || 400)
    );
  }
}

function rowToOutbox(row = {}) {
  const event = jsonValue(row.event_payload);
  if (!event.id || event.id !== String(row.event_id || "")) {
    throw postgresError(
      "emergency signal PostgreSQL event identity failed integrity validation",
      "EMERGENCY_SIGNAL_POSTGRES_INTEGRITY_INVALID"
    );
  }
  if (stableDigest(event) !== String(row.event_payload_sha256 || "")) {
    throw postgresError(
      "emergency signal PostgreSQL event payload failed integrity validation",
      "EMERGENCY_SIGNAL_POSTGRES_INTEGRITY_INVALID"
    );
  }
  const outbox = {
    ...event,
    outboxStatus: String(row.status || ""),
    delivery: jsonValue(row.delivery_state)
  };
  const delivery = Delivery.ensureDelivery(outbox);
  if (
    delivery.digest !== String(row.delivery_state_sha256 || "")
    || delivery.status !== String(row.status || "")
    || delivery.attempts !== Number(row.attempts)
    || delivery.maxAttempts !== Number(row.max_attempts)
    || delivery.generation !== Number(row.generation)
    || delivery.nextAttemptAt !== optionalIsoText(row.next_attempt_at, "nextAttemptAt")
    || delivery.leaseOwner !== String(row.lease_owner || "")
    || delivery.leaseToken !== String(row.lease_token || "")
    || delivery.leaseExpiresAt !== optionalIsoText(row.lease_expires_at, "leaseExpiresAt")
    || delivery.publishedAt !== optionalIsoText(row.published_at, "publishedAt")
    || delivery.deadLetteredAt !== optionalIsoText(row.dead_lettered_at, "deadLetteredAt")
    || delivery.lastErrorCode !== String(row.last_error_code || "")
    || delivery.lastErrorDigest !== String(row.last_error_digest || "")
    || (delivery.receipt?.receiptDigest || "") !== String(row.receipt_digest || "")
  ) {
    throw postgresError(
      "emergency signal PostgreSQL delivery state failed integrity validation",
      "EMERGENCY_SIGNAL_POSTGRES_INTEGRITY_INVALID"
    );
  }
  return outbox;
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
    try { await client?.query?.("ROLLBACK"); } catch {}
    throw safeDatabaseError(error);
  } finally {
    client?.release?.();
  }
}

async function updateDeliveryRow(client, outbox, at) {
  const delivery = Delivery.ensureDelivery(outbox);
  const result = await client.query(`
    UPDATE health_platform.emergency_signal_delivery_outbox SET
      delivery_state = $2::jsonb,
      delivery_state_sha256 = $3,
      status = $4,
      attempts = $5,
      max_attempts = $6,
      generation = $7,
      next_attempt_at = $8,
      lease_owner = NULLIF($9, ''),
      lease_token = NULLIF($10, ''),
      lease_expires_at = NULLIF($11, '')::timestamptz,
      published_at = NULLIF($12, '')::timestamptz,
      dead_lettered_at = NULLIF($13, '')::timestamptz,
      last_error_code = NULLIF($14, ''),
      last_error_digest = NULLIF($15, ''),
      receipt_digest = NULLIF($16, ''),
      updated_at = $17
    WHERE event_id = $1
  `, [
    outbox.id,
    JSON.stringify(delivery),
    delivery.digest,
    delivery.status,
    delivery.attempts,
    delivery.maxAttempts,
    delivery.generation,
    delivery.nextAttemptAt,
    delivery.leaseOwner,
    delivery.leaseToken,
    delivery.leaseExpiresAt,
    delivery.publishedAt,
    delivery.deadLetteredAt,
    delivery.lastErrorCode,
    delivery.lastErrorDigest,
    delivery.receipt?.receiptDigest || "",
    isoText(at, "updatedAt")
  ]);
  if (result.rowCount !== 1) {
    throw postgresError(
      "emergency signal PostgreSQL delivery update was lost",
      "EMERGENCY_SIGNAL_POSTGRES_UPDATE_CONFLICT",
      409
    );
  }
}

function createEmergencySignalPostgresRepository(options = {}) {
  const env = options.env || process.env;
  const config = options.config || buildEmergencySignalPostgresConfig(env);
  let ownedPool;

  function validatedPoolConfig() {
    const candidate = options.poolConfig || postgresPoolConfig(env);
    if (candidate?.ssl?.rejectUnauthorized !== true) {
      throw postgresError(
        "emergency signal PostgreSQL requires a connection with certificate verification",
        "EMERGENCY_SIGNAL_POSTGRES_TLS_REQUIRED",
        503
      );
    }
    return candidate;
  }

  function assertInjectedPoolSecurity() {
    if (!options.pool || options.testBypassEvidenceGate === true) return;
    const proof = options.poolTlsVerification || {};
    if (
      proof.verified !== true
      || !safeEvidenceReference(proof.evidenceId)
      || !Number.isFinite(Date.parse(String(proof.checkedAt || "")))
    ) {
      throw postgresError(
        "injected emergency signal PostgreSQL pool lacks verified TLS connection evidence",
        "EMERGENCY_SIGNAL_POSTGRES_TLS_EVIDENCE_REQUIRED",
        503
      );
    }
  }

  function pool() {
    if (options.pool) {
      assertInjectedPoolSecurity();
      return options.pool;
    }
    if (!config.configured) {
      throw postgresError(
        "emergency signal PostgreSQL repository is not configured",
        "EMERGENCY_SIGNAL_POSTGRES_NOT_CONFIGURED",
        503
      );
    }
    if (!ownedPool) {
      ownedPool = new (options.PoolClass || require("pg").Pool)(
        validatedPoolConfig()
      );
    }
    return ownedPool;
  }

  function assertWriteEnabled() {
    if (options.testBypassEvidenceGate === true) return;
    if (!config.writeEnabled) {
      throw postgresError(
        "emergency signal PostgreSQL writes are blocked by the evidence gate",
        "EMERGENCY_SIGNAL_POSTGRES_WRITE_BLOCKED",
        409
      );
    }
  }

  async function selectForUpdate(client, eventId) {
    const result = await client.query(`
      SELECT *
      FROM health_platform.emergency_signal_delivery_outbox
      WHERE event_id = $1
      FOR UPDATE
    `, [requiredText(eventId, "eventId")]);
    if (result.rowCount !== 1) {
      throw postgresError(
        "emergency signal delivery was not found",
        "EMERGENCY_SIGNAL_DELIVERY_NOT_FOUND",
        404
      );
    }
    return rowToOutbox(result.rows[0]);
  }

  async function enqueue(input = {}, enqueueOptions = {}) {
    assertWriteEnabled();
    const outbox = structuredClone(input);
    if (!outbox.delivery) {
      outbox.delivery = Delivery.createEmergencySignalDelivery(outbox, {
        now: enqueueOptions.now || outbox.occurredAt
      });
    }
    const delivery = Delivery.ensureDelivery(outbox);
    const event = eventPayload(outbox);
    const eventDigest = stableDigest(event);
    const createdAt = isoText(enqueueOptions.now || outbox.occurredAt, "createdAt");
    return withClient(pool(), "BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE", async (client) => {
      const inserted = await client.query(`
        INSERT INTO health_platform.emergency_signal_delivery_outbox (
          event_id, event_payload, event_payload_sha256, delivery_state, delivery_state_sha256,
          status, attempts, max_attempts, generation, next_attempt_at,
          lease_owner, lease_token, lease_expires_at, published_at, dead_lettered_at,
          last_error_code, last_error_digest, receipt_digest, created_at, updated_at
        ) VALUES (
          $1, $2::jsonb, $3, $4::jsonb, $5,
          $6, $7, $8, $9, $10,
          NULL, NULL, NULL, NULL, NULL,
          NULL, NULL, NULL, $11, $11
        )
        ON CONFLICT (event_id) DO NOTHING
        RETURNING event_id
      `, [
        outbox.id,
        JSON.stringify(event),
        eventDigest,
        JSON.stringify(delivery),
        delivery.digest,
        delivery.status,
        delivery.attempts,
        delivery.maxAttempts,
        delivery.generation,
        delivery.nextAttemptAt,
        createdAt
      ]);
      if (inserted.rowCount === 1) {
        return Object.freeze({ eventId: outbox.id, status: delivery.status, idempotentReplay: false });
      }
      const existingResult = await client.query(`
        SELECT *
        FROM health_platform.emergency_signal_delivery_outbox
        WHERE event_id = $1
        FOR UPDATE
      `, [outbox.id]);
      const existing = rowToOutbox(existingResult.rows[0]);
      if (stableDigest(eventPayload(existing)) !== eventDigest) {
        throw postgresError(
          "emergency signal event id was reused with a different payload",
          "EMERGENCY_SIGNAL_POSTGRES_ENQUEUE_CONFLICT",
          409
        );
      }
      return Object.freeze({
        eventId: existing.id,
        status: existing.delivery.status,
        idempotentReplay: true
      });
    });
  }

  async function claim(input = {}) {
    assertWriteEnabled();
    const workerId = requiredText(input.workerId, "workerId", 160);
    const now = isoText(input.now || new Date().toISOString(), "now");
    const limit = Math.min(100, Math.max(1, Number(input.limit) || 10));
    const leaseMs = Math.min(15 * 60_000, Math.max(1_000, Number(input.leaseMs) || 30_000));
    return withClient(pool(), "BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED", async (client) => {
      const result = await client.query(`
        SELECT *
        FROM health_platform.emergency_signal_delivery_outbox
        WHERE
          (status = 'pending' AND next_attempt_at <= $1)
          OR (status = 'processing' AND lease_expires_at <= $1)
        ORDER BY created_at, event_id
        FOR UPDATE SKIP LOCKED
        LIMIT $2
      `, [now, limit]);
      const claims = [];
      for (const row of result.rows) {
        const outbox = rowToOutbox(row);
        const claimed = Delivery.claimEmergencySignalDeliveries(
          { emergencyAuditEvents: [outbox] },
          { workerId, now, leaseMs, limit: 1 }
        );
        await updateDeliveryRow(client, outbox, now);
        if (claimed[0]) claims.push(claimed[0]);
      }
      return Object.freeze(claims);
    });
  }

  async function acknowledge(claimInput, receipt, acknowledgeOptions = {}) {
    assertWriteEnabled();
    const at = acknowledgeOptions.now || receipt?.receivedAt || new Date().toISOString();
    return withClient(pool(), "BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED", async (client) => {
      const outbox = await selectForUpdate(client, claimInput?.eventId);
      const result = Delivery.acknowledgeEmergencySignalDelivery(
        { emergencyAuditEvents: [outbox] },
        claimInput,
        receipt,
        { now: at }
      );
      if (!result.duplicate) await updateDeliveryRow(client, outbox, at);
      return result;
    });
  }

  async function fail(claimInput, failure = {}, failureOptions = {}) {
    assertWriteEnabled();
    const at = failureOptions.now || new Date().toISOString();
    return withClient(pool(), "BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED", async (client) => {
      const outbox = await selectForUpdate(client, claimInput?.eventId);
      const result = Delivery.failEmergencySignalDelivery(
        { emergencyAuditEvents: [outbox] },
        claimInput,
        failure,
        { ...failureOptions, now: at }
      );
      await updateDeliveryRow(client, outbox, at);
      return result;
    });
  }

  async function replay(eventId, input = {}, actor = {}, replayOptions = {}) {
    assertWriteEnabled();
    const normalizedEventId = requiredText(eventId, "eventId");
    const idempotencyKey = requiredText(input.idempotencyKey, "idempotencyKey");
    const reason = requiredText(input.reason, "reason", 240);
    const replayKeyDigest = sha256(idempotencyKey);
    const intentDigest = stableDigest({ eventId: normalizedEventId, reason });
    const requestedAt = isoText(replayOptions.now || new Date().toISOString(), "requestedAt");
    return withClient(pool(), "BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE", async (client) => {
      const outbox = await selectForUpdate(client, normalizedEventId);
      const existingResult = await client.query(`
        SELECT event_id, intent_sha256, result, result_sha256
        FROM health_platform.emergency_signal_delivery_replays
        WHERE replay_key_sha256 = $1
        FOR UPDATE
      `, [replayKeyDigest]);
      if (existingResult.rowCount === 1) {
        const existing = existingResult.rows[0];
        if (
          String(existing.event_id) !== normalizedEventId
          || String(existing.intent_sha256) !== intentDigest
        ) {
          throw postgresError(
            "emergency signal replay key was used for another intent",
            "EMERGENCY_SIGNAL_DELIVERY_REPLAY_CONFLICT",
            409
          );
        }
        const stored = jsonValue(existing.result);
        if (stableDigest(stored) !== String(existing.result_sha256 || "")) {
          throw postgresError(
            "emergency signal replay evidence failed integrity validation",
            "EMERGENCY_SIGNAL_POSTGRES_INTEGRITY_INVALID"
          );
        }
        return Object.freeze({ duplicate: true, status: stored.status, generation: stored.generation });
      }
      const result = Delivery.replayEmergencySignalDelivery(
        { emergencyAuditEvents: [outbox] },
        normalizedEventId,
        { idempotencyKey, reason },
        {
          role: actor.role,
          username: sha256(safeText(actor.username || actor.name || actor.role, 160))
        },
        { now: requestedAt }
      );
      if (!result.duplicate) await updateDeliveryRow(client, outbox, requestedAt);
      const stored = { status: result.status, generation: result.generation };
      await client.query(`
        INSERT INTO health_platform.emergency_signal_delivery_replays (
          replay_key_sha256, event_id, intent_sha256, reason_sha256,
          requested_by_sha256, requested_at, result, result_sha256
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
      `, [
        replayKeyDigest,
        normalizedEventId,
        intentDigest,
        sha256(reason),
        sha256(safeText(actor.username || actor.name || actor.role, 160)),
        requestedAt,
        JSON.stringify(stored),
        stableDigest(stored)
      ]);
      return result;
    });
  }

  async function operations(input = {}) {
    const limit = Math.min(200, Math.max(1, Number(input.limit) || 100));
    const status = safeText(input.status, 40);
    if (status && !STATUS_VALUES.has(status)) {
      throw postgresError(
        "emergency signal delivery status filter is invalid",
        "EMERGENCY_SIGNAL_POSTGRES_STATUS_INVALID",
        400
      );
    }
    return withClient(pool(), "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY", async (client) => {
      const countsResult = await client.query(`
        SELECT status, count(*)::integer AS count
        FROM health_platform.emergency_signal_delivery_outbox
        GROUP BY status
      `);
      const params = status ? [status, limit] : [limit];
      const listResult = await client.query(`
        SELECT
          event_id, status, attempts, max_attempts, generation, next_attempt_at,
          lease_expires_at, published_at, dead_lettered_at, last_error_code,
          receipt_digest, updated_at
        FROM health_platform.emergency_signal_delivery_outbox
        ${status ? "WHERE status = $1" : ""}
        ORDER BY updated_at DESC, event_id
        LIMIT $${status ? 2 : 1}
      `, params);
      const counts = { pending: 0, processing: 0, published: 0, "dead-letter": 0 };
      for (const row of countsResult.rows) {
        if (Object.hasOwn(counts, row.status)) counts[row.status] = Number(row.count);
      }
      return Object.freeze({
        summary: Object.freeze({
          total: Object.values(counts).reduce((sum, value) => sum + value, 0),
          ...counts,
          healthy: counts["dead-letter"] === 0
        }),
        deliveries: Object.freeze(listResult.rows.map((row) => Object.freeze({
          eventId: String(row.event_id),
          status: String(row.status),
          attempts: Number(row.attempts),
          maxAttempts: Number(row.max_attempts),
          generation: Number(row.generation),
          nextAttemptAt: isoText(row.next_attempt_at),
          leaseExpiresAt: row.lease_expires_at ? isoText(row.lease_expires_at) : "",
          publishedAt: row.published_at ? isoText(row.published_at) : "",
          deadLetteredAt: row.dead_lettered_at ? isoText(row.dead_lettered_at) : "",
          lastErrorCode: String(row.last_error_code || ""),
          receiptDigest: String(row.receipt_digest || ""),
          updatedAt: isoText(row.updated_at)
        }))),
        repository: "postgresql",
        productionReady: false,
        boundary: config.boundary
      });
    });
  }

  async function verifySchema() {
    return withClient(pool(), "BEGIN READ ONLY", async (client) => {
      const result = await client.query(`
        SELECT
          to_regclass('health_platform.emergency_signal_delivery_outbox') AS outbox,
          to_regclass('health_platform.emergency_signal_delivery_replays') AS replays
      `);
      const row = result.rows[0] || {};
      const checks = { outbox: Boolean(row.outbox), replays: Boolean(row.replays) };
      return Object.freeze({
        ok: Object.values(checks).every(Boolean),
        checks: Object.freeze(checks),
        migrationSha256: config.migration.sha256,
        productionReady: false
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
    config,
    enqueue,
    claim,
    acknowledge,
    fail,
    replay,
    operations,
    verifySchema,
    close
  });
}

module.exports = {
  MIGRATION_FILE,
  MODES,
  buildEmergencySignalPostgresConfig,
  createEmergencySignalPostgresRepository,
  rowToOutbox,
  safeDatabaseError,
  stableDigest
};
