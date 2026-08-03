"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const Persistence = require("./insurance-payment-persistence");
const { postgresPoolConfig } = require("./postgres-runtime-sync");

const MIGRATION_FILE = path.join(__dirname, "deploy", "insurance-payment-postgres.sql");
const MODES = new Set(["disabled", "rehearsal", "evidence-gated"]);

function safeEvidenceReference(value) {
  const reference = String(value || "").trim();
  return reference.length >= 4 && reference.length <= 160 && !/[\r\n]/.test(reference) ? reference : "";
}

function buildPostgresInsurancePaymentConfig(env = process.env) {
  const mode = String(env.INSURANCE_PAYMENT_POSTGRES_MODE || "disabled").trim().toLowerCase();
  if (!MODES.has(mode)) {
    throw new Persistence.InsurancePaymentPersistenceError("医保支付 PostgreSQL 模式无效", "PERSISTENCE_POSTGRES_MODE_INVALID");
  }
  const databaseUrl = String(env.DATABASE_URL || "").trim();
  const sslMode = String(env.POSTGRES_SSL_MODE || "verify-full").trim().toLowerCase();
  const evidence = {
    migration: safeEvidenceReference(env.INSURANCE_PAYMENT_MIGRATION_EVIDENCE_ID),
    backup: safeEvidenceReference(env.INSURANCE_PAYMENT_BACKUP_EVIDENCE_ID),
    recovery: safeEvidenceReference(env.INSURANCE_PAYMENT_RECOVERY_EVIDENCE_ID),
    cutover: safeEvidenceReference(env.INSURANCE_PAYMENT_CUTOVER_APPROVAL_ID)
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
  const evidenceReady = requirements.migrationEvidence && requirements.backupEvidence && requirements.recoveryEvidence && requirements.cutoverApproval;
  return {
    adapter: "insurance-payment-postgres-v1",
    mode,
    configured: requirements.modeEnabled && requirements.databaseUrl,
    evidenceReady,
    writeEnabled: mode === "evidence-gated" && requirements.databaseUrl && requirements.tlsVerified && evidenceReady,
    requirements,
    evidence,
    migration: {
      path: "deploy/insurance-payment-postgres.sql",
      sha256: `sha256:${Persistence.sha256(fs.readFileSync(MIGRATION_FILE))}`
    },
    credentialsPersisted: false,
    productionPrimary: false,
    boundary: "writeEnabled only proves configuration and evidence references. T00 cutover, live database verification, backup restoration drill and signed site acceptance remain mandatory."
  };
}

function persistenceError(message, code, status = 500, detail = {}) {
  return new Persistence.InsurancePaymentPersistenceError(message, code, status, detail);
}

function safeDatabaseError(error, fallbackCode = "PERSISTENCE_POSTGRES_FAILED") {
  if (error instanceof Persistence.InsurancePaymentPersistenceError) return error;
  if (String(error?.code || "") === "40001") return persistenceError("医保支付数据库串行化冲突，请使用新版本重试", "PERSISTENCE_SERIALIZATION_RETRY", 409);
  if (String(error?.code || "") === "23505") return persistenceError("医保支付数据库唯一约束冲突", "PERSISTENCE_DATABASE_CONFLICT", 409);
  const code = /^[A-Z0-9_]{2,80}$/.test(String(error?.code || "")) ? String(error.code) : fallbackCode;
  return persistenceError("医保支付 PostgreSQL 操作失败", code, 503);
}

function dateText(value) {
  if (!value) return "";
  const timestamp = value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  return timestamp;
}

function aggregateRowToSnapshot(row = {}) {
  if (!row.aggregate_id) throw persistenceError("医保支付聚合不存在", "PERSISTENCE_AGGREGATE_NOT_FOUND", 404);
  const snapshot = {
    schema: String(row.schema_version),
    aggregateId: String(row.aggregate_id),
    version: Number(row.aggregate_version),
    state: Persistence.clone(row.state),
    stateDigest: String(row.state_sha256),
    createdAt: dateText(row.created_at),
    updatedAt: dateText(row.updated_at)
  };
  if (snapshot.schema !== Persistence.PERSISTENCE_SCHEMA || snapshot.stateDigest !== Persistence.stateDigest(snapshot.state) || !Number.isSafeInteger(snapshot.version)) {
    throw persistenceError("医保支付聚合完整性校验失败", "PERSISTENCE_INTEGRITY_FAILED", 500);
  }
  return snapshot;
}

function outboxRowToEvent(row = {}) {
  const event = {
    schema: Persistence.OUTBOX_SCHEMA,
    id: String(row.event_id || ""),
    aggregateId: String(row.aggregate_id || ""),
    aggregateVersion: Number(row.aggregate_version),
    commandId: String(row.command_id || ""),
    commandType: String(row.command_type || ""),
    eventType: String(row.event_type || ""),
    occurredAt: dateText(row.occurred_at),
    actor: String(row.actor || ""),
    traceId: String(row.trace_id || ""),
    payload: Persistence.clone(row.payload || {}),
    status: String(row.status || ""),
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    nextAttemptAt: dateText(row.next_attempt_at),
    leaseOwner: String(row.lease_owner || ""),
    leaseToken: String(row.lease_token || ""),
    leaseExpiresAt: dateText(row.lease_expires_at),
    publishedAt: dateText(row.published_at),
    deadLetteredAt: dateText(row.dead_lettered_at),
    lastErrorCode: String(row.last_error_code || ""),
    lastErrorDigest: String(row.last_error_digest || ""),
    digest: String(row.event_sha256 || "")
  };
  if (!Persistence.verifyOutboxEvent(event)) throw persistenceError("医保支付 outbox 完整性校验失败", "PERSISTENCE_OUTBOX_INTEGRITY_FAILED", 500);
  return event;
}

function normalizeCommand(commandInput = {}) {
  const command = {
    commandId: Persistence.safeId(commandInput.commandId, "commandId"),
    commandType: Persistence.safeId(commandInput.commandType, "commandType"),
    payload: Persistence.clone(commandInput.payload === undefined ? null : commandInput.payload),
    expectedVersion: Persistence.normalizeExpectedVersion(commandInput.expectedVersion),
    actor: String(commandInput.actor || "system").trim().slice(0, 160) || "system",
    traceId: Persistence.safeId(commandInput.traceId || randomUUID(), "traceId")
  };
  command.commandDigest = Persistence.commandDigest(command);
  return command;
}

async function withClient(pool, transaction, work) {
  let client;
  try {
    client = await pool.connect();
    if (transaction) await client.query(transaction);
    const result = await work(client);
    if (transaction) await client.query("COMMIT");
    return result;
  } catch (error) {
    if (transaction) {
      try { await client.query("ROLLBACK"); } catch {}
    }
    throw safeDatabaseError(error);
  } finally {
    client?.release?.();
  }
}

async function selectAggregate(client, aggregateId, lock = false) {
  const result = await client.query(`
    SELECT aggregate_id, schema_version, aggregate_version, state, state_sha256, created_at, updated_at
    FROM health_platform.insurance_payment_aggregates
    WHERE aggregate_id = $1
    ${lock ? "FOR UPDATE" : ""}
  `, [aggregateId]);
  if (result.rowCount !== 1) throw persistenceError("医保支付聚合不存在", "PERSISTENCE_AGGREGATE_NOT_FOUND", 404);
  return aggregateRowToSnapshot(result.rows[0]);
}

function prepareCommit(snapshot, command, workingState, rawMutation, options = {}) {
  const mutation = Persistence.normalizeMutationResult(rawMutation, command.commandType);
  const committedState = Persistence.clone(Persistence.requireObject(mutation.nextState || workingState, "事务业务状态"));
  const committedAt = Persistence.isoDate(options.occurredAt, "occurredAt", new Date().toISOString());
  if (Date.parse(committedAt) < Date.parse(snapshot.updatedAt)) {
    throw persistenceError("事务提交时间早于当前状态更新时间", "PERSISTENCE_TIME_REGRESSION", 409);
  }
  const nextSnapshot = {
    ...snapshot,
    version: snapshot.version + 1,
    state: committedState,
    stateDigest: Persistence.stateDigest(committedState),
    updatedAt: committedAt
  };
  const result = Persistence.clone(mutation.result);
  const outboxEvent = Persistence.buildOutboxEvent(nextSnapshot, command, mutation, committedAt, { maxAttempts: options.maxAttempts });
  return {
    nextSnapshot,
    result,
    resultDigest: `sha256:${Persistence.sha256(Persistence.stableStringify(result))}`,
    outboxEvent
  };
}

async function insertOutbox(client, event) {
  await client.query(`
    INSERT INTO health_platform.insurance_payment_outbox (
      event_id, aggregate_id, aggregate_version, command_id, command_type, event_type,
      occurred_at, actor, trace_id, payload, event_sha256, status, attempts, max_attempts,
      next_attempt_at, lease_owner, lease_token, lease_expires_at, published_at,
      dead_lettered_at, last_error_code, last_error_digest
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14,
      $15, NULL, NULL, NULL, NULL, NULL, NULL, NULL
    )
  `, [
    event.id, event.aggregateId, event.aggregateVersion, event.commandId, event.commandType,
    event.eventType, event.occurredAt, event.actor, event.traceId, JSON.stringify(event.payload),
    event.digest, event.status, event.attempts, event.maxAttempts, event.nextAttemptAt
  ]);
}

async function updateOutboxDelivery(client, event) {
  await client.query(`
    UPDATE health_platform.insurance_payment_outbox SET
      event_sha256 = $2, status = $3, attempts = $4, next_attempt_at = $5,
      lease_owner = NULLIF($6, ''), lease_token = NULLIF($7, ''), lease_expires_at = NULLIF($8, '')::timestamptz,
      published_at = NULLIF($9, '')::timestamptz, dead_lettered_at = NULLIF($10, '')::timestamptz,
      last_error_code = NULLIF($11, ''), last_error_digest = NULLIF($12, '')
    WHERE event_id = $1
  `, [
    event.id, event.digest, event.status, event.attempts, event.nextAttemptAt,
    event.leaseOwner, event.leaseToken, event.leaseExpiresAt, event.publishedAt,
    event.deadLetteredAt, event.lastErrorCode, event.lastErrorDigest
  ]);
}

function createPostgresInsurancePaymentRepository(options = {}) {
  const env = options.env || process.env;
  const config = options.config || buildPostgresInsurancePaymentConfig(env);
  const aggregateId = Persistence.safeId(options.aggregateId || Persistence.DEFAULT_AGGREGATE_ID, "aggregateId");
  const maxAttempts = Math.min(100, Math.max(1, Number(options.maxAttempts) || 8));
  const retryBaseMs = Math.max(100, Number(options.retryBaseMs) || 1_000);
  const retryMaxMs = Math.max(retryBaseMs, Number(options.retryMaxMs) || 15 * 60_000);
  let ownedPool;

  function pool() {
    if (options.pool) return options.pool;
    if (!config.configured) throw persistenceError("医保支付 PostgreSQL 仓储未配置", "PERSISTENCE_POSTGRES_NOT_CONFIGURED", 503);
    if (!ownedPool) ownedPool = new (options.PoolClass || require("pg").Pool)(options.poolConfig || postgresPoolConfig(env));
    return ownedPool;
  }

  function assertWriteEnabled() {
    if (options.testBypassEvidenceGate === true) return;
    if (!config.writeEnabled) throw persistenceError("医保支付 PostgreSQL 写入未通过证据门禁", "PERSISTENCE_POSTGRES_WRITE_BLOCKED", 409);
  }

  async function initialize(initialState = {}, input = {}) {
    assertWriteEnabled();
    const state = Persistence.clone(Persistence.requireObject(initialState, "初始业务状态"));
    const createdAt = Persistence.isoDate(input.createdAt, "createdAt", new Date().toISOString());
    const digest = Persistence.stateDigest(state);
    return withClient(pool(), "BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE", async (client) => {
      const inserted = await client.query(`
        INSERT INTO health_platform.insurance_payment_aggregates (
          aggregate_id, schema_version, aggregate_version, state, state_sha256, created_at, updated_at
        ) VALUES ($1, $2, 0, $3::jsonb, $4, $5, $5)
        ON CONFLICT (aggregate_id) DO NOTHING
        RETURNING aggregate_id, schema_version, aggregate_version, state, state_sha256, created_at, updated_at
      `, [aggregateId, Persistence.PERSISTENCE_SCHEMA, JSON.stringify(state), digest, createdAt]);
      if (inserted.rowCount === 1) return aggregateRowToSnapshot(inserted.rows[0]);
      const existing = await selectAggregate(client, aggregateId, true);
      if (existing.stateDigest !== digest) throw persistenceError("医保支付聚合已经使用不同初始状态初始化", "PERSISTENCE_ALREADY_INITIALIZED", 409);
      return existing;
    });
  }

  async function load() {
    return withClient(pool(), "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY", (client) => selectAggregate(client, aggregateId, false));
  }

  async function transact(commandInput = {}, mutator) {
    assertWriteEnabled();
    if (typeof mutator !== "function") throw persistenceError("事务必须提供 mutator", "PERSISTENCE_MUTATOR_REQUIRED", 400);
    const command = normalizeCommand(commandInput);
    return withClient(pool(), "BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE", async (client) => {
      const snapshot = await selectAggregate(client, aggregateId, true);
      const replayResult = await client.query(`
        SELECT command_type, command_sha256, aggregate_version, result, result_sha256, committed_at
        FROM health_platform.insurance_payment_commands
        WHERE aggregate_id = $1 AND command_id = $2
      `, [aggregateId, command.commandId]);
      if (replayResult.rowCount === 1) {
        const replay = replayResult.rows[0];
        if (String(replay.command_sha256) !== command.commandDigest) throw persistenceError("commandId 已被不同命令载荷使用", "PERSISTENCE_COMMAND_CONFLICT", 409);
        const eventResult = await client.query("SELECT * FROM health_platform.insurance_payment_outbox WHERE aggregate_id = $1 AND command_id = $2", [aggregateId, command.commandId]);
        return {
          snapshot,
          result: Persistence.clone(replay.result),
          outboxEvent: outboxRowToEvent(eventResult.rows[0]),
          idempotentReplay: true
        };
      }
      if (command.expectedVersion !== snapshot.version) {
        throw persistenceError("医保支付状态版本冲突", "PERSISTENCE_VERSION_CONFLICT", 409, { expectedVersion: command.expectedVersion, actualVersion: snapshot.version });
      }
      const workingState = Persistence.clone(snapshot.state);
      const rawMutation = await mutator(workingState, Persistence.clone(snapshot));
      const commit = prepareCommit(snapshot, command, workingState, rawMutation, { occurredAt: commandInput.occurredAt, maxAttempts });
      const updated = await client.query(`
        UPDATE health_platform.insurance_payment_aggregates SET
          aggregate_version = $2, state = $3::jsonb, state_sha256 = $4, updated_at = $5
        WHERE aggregate_id = $1 AND aggregate_version = $6
        RETURNING aggregate_id
      `, [aggregateId, commit.nextSnapshot.version, JSON.stringify(commit.nextSnapshot.state), commit.nextSnapshot.stateDigest, commit.nextSnapshot.updatedAt, snapshot.version]);
      if (updated.rowCount !== 1) throw persistenceError("医保支付状态版本冲突", "PERSISTENCE_VERSION_CONFLICT", 409);
      await client.query(`
        INSERT INTO health_platform.insurance_payment_commands (
          aggregate_id, command_id, command_type, command_sha256, aggregate_version,
          result, result_sha256, committed_at
        ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
      `, [aggregateId, command.commandId, command.commandType, command.commandDigest, commit.nextSnapshot.version, JSON.stringify(commit.result), commit.resultDigest, commit.nextSnapshot.updatedAt]);
      await insertOutbox(client, commit.outboxEvent);
      return { snapshot: commit.nextSnapshot, result: commit.result, outboxEvent: commit.outboxEvent, idempotentReplay: false };
    });
  }

  async function selectOutboxForUpdate(client, eventId) {
    const result = await client.query("SELECT * FROM health_platform.insurance_payment_outbox WHERE event_id = $1 AND aggregate_id = $2 FOR UPDATE", [eventId, aggregateId]);
    if (result.rowCount !== 1) throw persistenceError("outbox 事件不存在", "OUTBOX_EVENT_NOT_FOUND", 404);
    return outboxRowToEvent(result.rows[0]);
  }

  async function claimOutbox(input = {}) {
    assertWriteEnabled();
    const workerId = Persistence.safeId(input.workerId, "workerId");
    const now = Persistence.isoDate(input.now, "now", new Date().toISOString());
    const nowMs = Date.parse(now);
    const limit = Math.min(100, Math.max(1, Number(input.limit) || 10));
    const leaseMs = Math.min(15 * 60_000, Math.max(1_000, Number(input.leaseMs) || 30_000));
    return withClient(pool(), "BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED", async (client) => {
      const rows = await client.query(`
        SELECT * FROM health_platform.insurance_payment_outbox
        WHERE aggregate_id = $1 AND (
          (status = 'pending' AND next_attempt_at <= $2) OR
          (status = 'processing' AND lease_expires_at <= $2)
        )
        ORDER BY aggregate_version, occurred_at
        FOR UPDATE SKIP LOCKED
        LIMIT $3
      `, [aggregateId, now, limit]);
      const claimed = [];
      for (const row of rows.rows) {
        const event = outboxRowToEvent(row);
        if (event.status === "processing") {
          event.status = event.attempts >= event.maxAttempts ? "dead-letter" : "pending";
          event.deadLetteredAt = event.status === "dead-letter" ? now : "";
          event.leaseOwner = "";
          event.leaseToken = "";
          event.leaseExpiresAt = "";
        }
        if (event.status === "dead-letter") {
          event.digest = Persistence.eventDigest(event);
          await updateOutboxDelivery(client, event);
          continue;
        }
        event.status = "processing";
        event.attempts += 1;
        event.leaseOwner = workerId;
        event.leaseToken = randomUUID();
        event.leaseExpiresAt = new Date(nowMs + leaseMs).toISOString();
        event.digest = Persistence.eventDigest(event);
        await updateOutboxDelivery(client, event);
        claimed.push(event);
      }
      return claimed;
    });
  }

  function assertLease(event, input = {}) {
    if (event.status === "published") return true;
    if (event.status !== "processing") throw persistenceError("outbox 事件未被领取", "OUTBOX_EVENT_NOT_CLAIMED", 409);
    if (event.leaseOwner !== Persistence.safeId(input.workerId, "workerId") || event.leaseToken !== Persistence.safeId(input.leaseToken, "leaseToken")) {
      throw persistenceError("outbox 租约不匹配", "OUTBOX_LEASE_CONFLICT", 409);
    }
    return false;
  }

  async function acknowledgeOutbox(eventId, input = {}) {
    assertWriteEnabled();
    return withClient(pool(), "BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED", async (client) => {
      const event = await selectOutboxForUpdate(client, eventId);
      if (assertLease(event, input)) return { event, idempotentReplay: true };
      event.status = "published";
      event.publishedAt = Persistence.isoDate(input.publishedAt, "publishedAt", new Date().toISOString());
      event.leaseOwner = "";
      event.leaseToken = "";
      event.leaseExpiresAt = "";
      event.digest = Persistence.eventDigest(event);
      await updateOutboxDelivery(client, event);
      return { event, idempotentReplay: false };
    });
  }

  async function failOutbox(eventId, input = {}) {
    assertWriteEnabled();
    return withClient(pool(), "BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED", async (client) => {
      const event = await selectOutboxForUpdate(client, eventId);
      if (assertLease(event, input)) throw persistenceError("已发布事件不能标记失败", "OUTBOX_EVENT_ALREADY_PUBLISHED", 409);
      const failedAt = Persistence.isoDate(input.failedAt, "failedAt", new Date().toISOString());
      event.lastErrorCode = String(input.errorCode || "DELIVERY_FAILED").trim().slice(0, 80) || "DELIVERY_FAILED";
      event.lastErrorDigest = `sha256:${Persistence.sha256(String(input.errorMessage || event.lastErrorCode))}`;
      event.leaseOwner = "";
      event.leaseToken = "";
      event.leaseExpiresAt = "";
      if (event.attempts >= event.maxAttempts) {
        event.status = "dead-letter";
        event.deadLetteredAt = failedAt;
      } else {
        event.status = "pending";
        const delayMs = Math.min(retryMaxMs, retryBaseMs * (2 ** Math.max(0, event.attempts - 1)));
        event.nextAttemptAt = new Date(Date.parse(failedAt) + delayMs).toISOString();
      }
      event.digest = Persistence.eventDigest(event);
      await updateOutboxDelivery(client, event);
      return event;
    });
  }

  async function exportCheckpoint() {
    return withClient(pool(), "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY", async (client) => {
      const snapshot = await selectAggregate(client, aggregateId, false);
      const commands = await client.query("SELECT command_id, command_type, command_sha256, aggregate_version, result, result_sha256, committed_at FROM health_platform.insurance_payment_commands WHERE aggregate_id = $1 ORDER BY aggregate_version", [aggregateId]);
      const outbox = await client.query("SELECT * FROM health_platform.insurance_payment_outbox WHERE aggregate_id = $1 ORDER BY aggregate_version", [aggregateId]);
      const checkpoint = {
        ...snapshot,
        commands: commands.rows.map((item) => ({
          commandId: String(item.command_id), commandType: String(item.command_type), commandDigest: String(item.command_sha256),
          aggregateVersion: Number(item.aggregate_version), committedAt: dateText(item.committed_at),
          result: Persistence.clone(item.result), resultDigest: String(item.result_sha256)
        })),
        outbox: outbox.rows.map(outboxRowToEvent)
      };
      if (!Persistence.verifyPersistenceRecord(checkpoint)) throw persistenceError("持久化检查点完整性校验失败", "PERSISTENCE_INTEGRITY_FAILED", 500);
      return checkpoint;
    });
  }

  async function outboxStatus() {
    return withClient(pool(), "BEGIN READ ONLY", async (client) => {
      const result = await client.query("SELECT status, count(*)::integer AS count FROM health_platform.insurance_payment_outbox WHERE aggregate_id = $1 GROUP BY status", [aggregateId]);
      const counts = { pending: 0, processing: 0, published: 0, "dead-letter": 0 };
      for (const row of result.rows) if (Object.hasOwn(counts, row.status)) counts[row.status] = Number(row.count);
      return { total: Object.values(counts).reduce((sum, value) => sum + value, 0), counts, healthy: counts["dead-letter"] === 0 };
    });
  }

  async function verifySchema() {
    return withClient(pool(), "BEGIN READ ONLY", async (client) => {
      const result = await client.query(`
        SELECT
          to_regclass('health_platform.insurance_payment_aggregates') AS aggregates,
          to_regclass('health_platform.insurance_payment_commands') AS commands,
          to_regclass('health_platform.insurance_payment_outbox') AS outbox
      `);
      const row = result.rows[0] || {};
      const checks = { aggregates: Boolean(row.aggregates), commands: Boolean(row.commands), outbox: Boolean(row.outbox) };
      if (checks.aggregates && checks.commands && checks.outbox) {
        const constraints = await client.query(`
          SELECT c.contype, pg_get_constraintdef(c.oid) AS definition
          FROM pg_constraint c
          WHERE c.conrelid IN (
            'health_platform.insurance_payment_aggregates'::regclass,
            'health_platform.insurance_payment_commands'::regclass,
            'health_platform.insurance_payment_outbox'::regclass
          )
        `);
        const definitions = constraints.rows.map((item) => String(item.definition || "").replace(/\s+/g, " "));
        checks.commandIdempotencyKey = definitions.some((item) => /PRIMARY KEY \(aggregate_id, command_id\)/i.test(item));
        checks.aggregateVersionUnique = definitions.filter((item) => /UNIQUE \(aggregate_id, aggregate_version\)/i.test(item)).length >= 2;
        checks.outboxCommandForeignKey = definitions.some((item) => /FOREIGN KEY \(aggregate_id, command_id, aggregate_version\).*insurance_payment_commands/i.test(item));
        checks.outboxStatusGuard = definitions.some((item) => /CHECK .*status.*pending.*processing.*published.*dead-letter/i.test(item));
      } else {
        checks.commandIdempotencyKey = false;
        checks.aggregateVersionUnique = false;
        checks.outboxCommandForeignKey = false;
        checks.outboxStatusGuard = false;
      }
      return { ok: Object.values(checks).every(Boolean), checkedAt: new Date().toISOString(), checks, migrationSha256: config.migration.sha256, productionPrimary: false };
    });
  }

  async function close() {
    if (ownedPool) {
      await ownedPool.end();
      ownedPool = null;
    }
  }

  return Object.freeze({
    contract: Persistence.persistenceContract(), config, initialize, load, transact,
    claimOutbox, acknowledgeOutbox, failOutbox, exportCheckpoint, outboxStatus,
    verifySchema, close
  });
}

module.exports = {
  MIGRATION_FILE,
  MODES,
  aggregateRowToSnapshot,
  buildPostgresInsurancePaymentConfig,
  createPostgresInsurancePaymentRepository,
  outboxRowToEvent,
  prepareCommit,
  safeDatabaseError
};
