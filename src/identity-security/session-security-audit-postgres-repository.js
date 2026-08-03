"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { postgresPoolConfig } = require("../../postgres-runtime-sync");
const { SessionSecurityAuditError } = require("./session-security-audit");

const MIGRATION_FILE = path.join(__dirname, "..", "..", "deploy", "identity-security-audit-postgres.sql");
const MODES = new Set(["disabled", "rehearsal", "evidence-gated"]);
const DEFAULT_STREAM_ID = "identity-security-audit";
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;

function sha256(value) {
  return `sha256:${createHash("sha256").update(String(value ?? "")).digest("hex")}`;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stableValue(value[key]);
    return result;
  }, {});
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function bounded(value, maximum, fallback = "") {
  return String(value ?? fallback).trim().slice(0, maximum);
}

function safeEvidenceReference(value) {
  const reference = bounded(value, 160);
  return reference.length >= 4 && !/[\r\n]/.test(reference) ? reference : "";
}

function safeIdentifier(value, label) {
  const identifier = bounded(value, 200);
  if (identifier.length < 4 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(identifier)) {
    throw new SessionSecurityAuditError(
      "SESSION_SECURITY_AUDIT_IDENTIFIER_INVALID",
      `${label} must be a stable identifier`,
      400
    );
  }
  return identifier;
}

function isoDate(value, label = "timestamp") {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  if (!Number.isFinite(date.getTime())) {
    throw new SessionSecurityAuditError(
      "SESSION_SECURITY_AUDIT_TIMESTAMP_INVALID",
      `${label} must be an ISO timestamp`,
      400
    );
  }
  return date.toISOString();
}

function digestReference(value) {
  return sha256(String(value ?? ""));
}

function requestPath(req) {
  return String(req?.url || "").split("?")[0].slice(0, 200);
}

function requestMethod(req) {
  return bounded(String(req?.method || "POST").toUpperCase(), 12, "POST");
}

function clientReference(req) {
  return digestReference(`${String(req?.socket?.remoteAddress || "")}\n${String(req?.headers?.["user-agent"] || "")}`);
}

function sessionReference(session) {
  return digestReference(session?.sessionId || "");
}

function resolveCorrelationId(req, fallback) {
  const candidate = bounded(req?.correlationId, 128);
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(candidate) ? candidate : fallback;
}

function buildPostgresSessionSecurityAuditConfig(env = process.env) {
  const mode = bounded(env.IDENTITY_SECURITY_AUDIT_POSTGRES_MODE || "disabled", 40).toLowerCase();
  if (!MODES.has(mode)) {
    throw new SessionSecurityAuditError(
      "SESSION_SECURITY_AUDIT_POSTGRES_MODE_INVALID",
      "identity security audit PostgreSQL mode is invalid",
      400
    );
  }
  const databaseUrl = bounded(env.DATABASE_URL, 2048);
  const sslMode = bounded(env.POSTGRES_SSL_MODE || "verify-full", 40).toLowerCase();
  const evidence = {
    migration: safeEvidenceReference(env.IDENTITY_SECURITY_AUDIT_MIGRATION_EVIDENCE_ID),
    backup: safeEvidenceReference(env.IDENTITY_SECURITY_AUDIT_BACKUP_EVIDENCE_ID),
    recovery: safeEvidenceReference(env.IDENTITY_SECURITY_AUDIT_RECOVERY_EVIDENCE_ID),
    cutover: safeEvidenceReference(env.IDENTITY_SECURITY_AUDIT_CUTOVER_APPROVAL_ID)
  };
  const requirements = {
    modeEnabled: mode !== "disabled",
    databaseUrl: /^postgres(?:ql)?:\/\//i.test(databaseUrl),
    tlsVerifyFull: sslMode === "verify-full",
    migrationEvidence: Boolean(evidence.migration),
    backupEvidence: Boolean(evidence.backup),
    recoveryEvidence: Boolean(evidence.recovery),
    cutoverApproval: Boolean(evidence.cutover),
    centralSwitchConnected: false
  };
  const evidenceReady = requirements.migrationEvidence
    && requirements.backupEvidence
    && requirements.recoveryEvidence
    && requirements.cutoverApproval;
  const writeEnabled = mode === "evidence-gated"
    && requirements.databaseUrl
    && requirements.tlsVerifyFull
    && evidenceReady;
  return Object.freeze({
    adapter: "identity-security-audit-postgres-v1",
    mode,
    configured: requirements.modeEnabled && requirements.databaseUrl,
    evidenceReady,
    writeEnabled,
    productionReady: false,
    productionPrimary: false,
    requirements: Object.freeze(requirements),
    evidence: Object.freeze(evidence),
    migration: Object.freeze({
      path: "deploy/identity-security-audit-postgres.sql",
      sha256: sha256(fs.readFileSync(MIGRATION_FILE))
    }),
    credentialsPersisted: false,
    boundary: "Evidence-gated writes do not activate the central production switch. T00 cutover and signed external evidence remain mandatory."
  });
}

function readinessProjection(config) {
  const blockers = [];
  if (!config.configured) blockers.push("postgres-not-configured");
  if (!config.requirements.tlsVerifyFull) blockers.push("tls-verify-full-required");
  if (!config.evidenceReady) blockers.push("external-evidence-incomplete");
  if (!config.requirements.centralSwitchConnected) blockers.push("central-switch-not-connected");
  return Object.freeze({
    adapter: config.adapter,
    mode: config.mode,
    configured: config.configured,
    tlsVerifyFull: config.requirements.tlsVerifyFull,
    evidenceReady: config.evidenceReady,
    writeEnabled: config.writeEnabled,
    centralSwitchConnected: false,
    productionReady: false,
    productionPrimary: false,
    migration: config.migration,
    blockers: Object.freeze(blockers),
    credentialsPersisted: false
  });
}

function safeDatabaseError(error) {
  if (error instanceof SessionSecurityAuditError) return error;
  if (String(error?.code || "") === "40001") {
    return new SessionSecurityAuditError(
      "SESSION_SECURITY_AUDIT_SERIALIZATION_RETRY",
      "identity security audit serialization conflict; retry with a fresh command",
      409
    );
  }
  if (String(error?.code || "") === "23505") {
    return new SessionSecurityAuditError(
      "SESSION_SECURITY_AUDIT_DATABASE_CONFLICT",
      "identity security audit database constraint conflict",
      409
    );
  }
  return new SessionSecurityAuditError(
    "SESSION_SECURITY_AUDIT_POSTGRES_FAILED",
    "identity security audit PostgreSQL operation failed",
    503
  );
}

async function withSerializableTransaction(pool, work) {
  let client;
  let began = false;
  try {
    client = await pool.connect();
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");
    began = true;
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    if (began && client) {
      try {
        await client.query("ROLLBACK");
      } catch {}
    }
    throw safeDatabaseError(error);
  } finally {
    client?.release?.();
  }
}

function verifyDigest(value, label) {
  if (!DIGEST_PATTERN.test(String(value || ""))) {
    throw new SessionSecurityAuditError(
      "SESSION_SECURITY_AUDIT_INTEGRITY_FAILED",
      `${label} digest is invalid`,
      500
    );
  }
  return String(value);
}

function resultFromCommandRow(row) {
  const result = clone(row?.result_snapshot || {});
  const digest = verifyDigest(row?.result_sha256, "command result");
  if (sha256(stableStringify(result)) !== digest) {
    throw new SessionSecurityAuditError(
      "SESSION_SECURITY_AUDIT_INTEGRITY_FAILED",
      "command result digest mismatch",
      500
    );
  }
  return result;
}

function auditFromRow(row = {}) {
  const audit = {
    eventId: String(row.event_id || ""),
    streamVersion: Number(row.stream_version || 0),
    occurredAt: isoDate(row.occurred_at, "occurredAt"),
    correlationId: bounded(row.correlation_id, 128),
    actorRef: verifyDigest(row.actor_ref_sha256, "actor reference"),
    role: bounded(row.role, 80),
    action: bounded(row.action, 120),
    targetRef: verifyDigest(row.target_ref_sha256, "target reference"),
    result: bounded(row.result, 40),
    request: Object.freeze({
      method: bounded(row.request_method, 12),
      path: requestPath({ url: row.request_path })
    }),
    clientRef: verifyDigest(row.client_ref_sha256, "client reference"),
    sessionRef: verifyDigest(row.session_ref_sha256, "session reference"),
    eventDigest: verifyDigest(row.event_sha256, "audit event")
  };
  if (row.command_key_sha256 && row.intent_sha256 && row.detail_sha256) {
    const eventRecord = {
      eventId: audit.eventId,
      occurredAt: audit.occurredAt,
      correlationId: audit.correlationId,
      actorRef: audit.actorRef,
      role: audit.role,
      action: audit.action,
      targetRef: audit.targetRef,
      result: audit.result,
      detailDigest: verifyDigest(row.detail_sha256, "audit detail"),
      requestMethod: audit.request.method,
      requestPath: audit.request.path,
      clientRef: audit.clientRef,
      sessionRef: audit.sessionRef,
      streamVersion: audit.streamVersion,
      commandKeyHash: verifyDigest(row.command_key_sha256, "command key"),
      intentHash: verifyDigest(row.intent_sha256, "command intent")
    };
    if (sha256(stableStringify(eventRecord)) !== audit.eventDigest) {
      throw new SessionSecurityAuditError(
        "SESSION_SECURITY_AUDIT_INTEGRITY_FAILED",
        "audit event digest mismatch",
        500
      );
    }
  }
  return Object.freeze(audit);
}

function controlFromRow(row = {}) {
  if (!row.control_id) {
    throw new SessionSecurityAuditError(
      "SECURITY_CONTROL_NOT_FOUND",
      "security compliance control was not found",
      404
    );
  }
  return {
    id: String(row.control_id),
    version: Number(row.control_version),
    status: bounded(row.status, 160),
    evidence: bounded(row.evidence, 500),
    next: bounded(row.next_action, 500),
    lastAction: bounded(row.last_action, 120),
    updatedByRef: verifyDigest(row.updated_by_ref_sha256, "control updater"),
    updatedAt: isoDate(row.updated_at, "updatedAt")
  };
}

function normalizeSecurityControlCommand(input, idFactory, now) {
  const commandId = safeIdentifier(input.commandId, "commandId");
  const controlId = safeIdentifier(input.controlId, "controlId");
  const user = input.user || {};
  const payload = input.payload || {};
  const actorRef = digestReference(user.username || user.id || user.role || "anonymous");
  const normalizedPayload = {
    status: bounded(payload.status, 160),
    evidence: bounded(payload.evidence, 500),
    next: bounded(payload.next, 500),
    action: bounded(payload.action || "update-evidence", 120)
  };
  const commandKeyHash = digestReference(commandId);
  const intentHash = sha256(stableStringify({
    type: "security-control-action",
    controlId,
    actorRef,
    payload: normalizedPayload
  }));
  const occurredAt = isoDate(input.occurredAt || now(), "occurredAt");
  const correlationId = resolveCorrelationId(input.req, idFactory());
  const event = {
    eventId: idFactory(),
    occurredAt,
    correlationId,
    actorRef,
    role: bounded(user.role || "unknown", 80),
    action: "security-control-action",
    targetRef: digestReference(controlId),
    result: "allowed",
    detailDigest: digestReference(normalizedPayload.status || "security control evidence updated"),
    requestMethod: requestMethod(input.req),
    requestPath: requestPath(input.req),
    clientRef: clientReference(input.req),
    sessionRef: sessionReference(input.session)
  };
  return {
    controlId,
    commandKeyHash,
    intentHash,
    actorRef,
    normalizedPayload,
    event
  };
}

function createPostgresSessionSecurityAuditRepository(options = {}) {
  const env = options.env || process.env;
  const config = options.config || buildPostgresSessionSecurityAuditConfig(env);
  const streamId = safeIdentifier(options.streamId || DEFAULT_STREAM_ID, "streamId");
  const idFactory = options.randomUUID || randomUUID;
  const now = options.now || (() => new Date());
  let ownedPool;

  function pool() {
    if (options.pool) return options.pool;
    if (!config.configured) {
      throw new SessionSecurityAuditError(
        "SESSION_SECURITY_AUDIT_POSTGRES_NOT_CONFIGURED",
        "identity security audit PostgreSQL repository is not configured",
        503
      );
    }
    if (!ownedPool) {
      const strictPoolConfig = options.poolConfig || postgresPoolConfig(env);
      if (strictPoolConfig?.ssl?.rejectUnauthorized !== true) {
        throw new SessionSecurityAuditError(
          "SESSION_SECURITY_AUDIT_TLS_VERIFY_FULL_REQUIRED",
          "identity security audit PostgreSQL requires TLS verify-full",
          503
        );
      }
      ownedPool = new (options.PoolClass || require("pg").Pool)(strictPoolConfig);
    }
    return ownedPool;
  }

  function assertWriteEnabled() {
    if (options.testBypassEvidenceGate === true) return;
    if (!config.writeEnabled) {
      throw new SessionSecurityAuditError(
        "SESSION_SECURITY_AUDIT_POSTGRES_WRITE_BLOCKED",
        "identity security audit PostgreSQL writes are blocked by external evidence gates",
        409
      );
    }
  }

  async function lockStream(client, occurredAt) {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [streamId]
    );
    await client.query(`
      INSERT INTO health_platform.identity_security_audit_streams (
        stream_id, stream_version, created_at, updated_at
      ) VALUES ($1, 0, $2, $2)
      ON CONFLICT (stream_id) DO NOTHING
    `, [streamId, occurredAt]);
    const result = await client.query(`
      SELECT stream_id, stream_version, created_at, updated_at
      FROM health_platform.identity_security_audit_streams
      WHERE stream_id = $1
      FOR UPDATE
    `, [streamId]);
    if (result.rowCount !== 1) {
      throw new SessionSecurityAuditError(
        "SESSION_SECURITY_AUDIT_STREAM_MISSING",
        "identity security audit stream is unavailable",
        503
      );
    }
    return {
      streamId: String(result.rows[0].stream_id),
      version: Number(result.rows[0].stream_version)
    };
  }

  async function findReplay(client, command) {
    const receipt = await client.query(`
      SELECT command_key_sha256, intent_sha256, stream_version,
             result_snapshot, result_sha256, committed_at
      FROM health_platform.identity_security_audit_commands
      WHERE stream_id = $1 AND command_key_sha256 = $2
    `, [streamId, command.commandKeyHash]);
    if (receipt.rowCount !== 1) return null;
    const row = receipt.rows[0];
    if (String(row.intent_sha256) !== command.intentHash) {
      throw new SessionSecurityAuditError(
        "SESSION_SECURITY_AUDIT_IDEMPOTENCY_CONFLICT",
        "command key was already used for a different security intent",
        409
      );
    }
    const event = await client.query(`
      SELECT event_id, stream_version, occurred_at, correlation_id,
             actor_ref_sha256, role, action, target_ref_sha256, result,
             detail_sha256, request_method, request_path, client_ref_sha256,
             session_ref_sha256, command_key_sha256, intent_sha256, event_sha256
      FROM health_platform.identity_security_audit_events
      WHERE stream_id = $1 AND command_key_sha256 = $2
    `, [streamId, command.commandKeyHash]);
    if (event.rowCount !== 1) {
      throw new SessionSecurityAuditError(
        "SESSION_SECURITY_AUDIT_INTEGRITY_FAILED",
        "command receipt does not reference one audit event",
        500
      );
    }
    return {
      result: resultFromCommandRow(row),
      audit: auditFromRow(event.rows[0]),
      streamVersion: Number(row.stream_version),
      idempotentReplay: true
    };
  }

  async function updateStreamVersion(client, expectedVersion, nextVersion, occurredAt) {
    const updated = await client.query(`
      UPDATE health_platform.identity_security_audit_streams
      SET stream_version = $2, updated_at = $3
      WHERE stream_id = $1 AND stream_version = $4
      RETURNING stream_id
    `, [streamId, nextVersion, occurredAt, expectedVersion]);
    if (updated.rowCount !== 1) {
      throw new SessionSecurityAuditError(
        "SESSION_SECURITY_AUDIT_VERSION_CONFLICT",
        "identity security audit stream version conflict",
        409
      );
    }
  }

  async function insertReceiptAndAudit(client, command, result, streamVersion) {
    const resultDigest = sha256(stableStringify(result));
    const eventRecord = {
      ...command.event,
      streamVersion,
      commandKeyHash: command.commandKeyHash,
      intentHash: command.intentHash
    };
    const eventDigest = sha256(stableStringify(eventRecord));
    await client.query(`
      INSERT INTO health_platform.identity_security_audit_commands (
        stream_id, command_key_sha256, intent_sha256, stream_version,
        result_snapshot, result_sha256, committed_at
      ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
    `, [
      streamId,
      command.commandKeyHash,
      command.intentHash,
      streamVersion,
      JSON.stringify(result),
      resultDigest,
      command.event.occurredAt
    ]);
    await client.query(`
      INSERT INTO health_platform.identity_security_audit_events (
        event_id, stream_id, stream_version, command_key_sha256, intent_sha256,
        occurred_at, correlation_id, actor_ref_sha256, role, action,
        target_ref_sha256, result, detail_sha256, request_method, request_path,
        client_ref_sha256, session_ref_sha256, event_sha256
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18
      )
    `, [
      command.event.eventId,
      streamId,
      streamVersion,
      command.commandKeyHash,
      command.intentHash,
      command.event.occurredAt,
      command.event.correlationId,
      command.event.actorRef,
      command.event.role,
      command.event.action,
      command.event.targetRef,
      command.event.result,
      command.event.detailDigest,
      command.event.requestMethod,
      command.event.requestPath,
      command.event.clientRef,
      command.event.sessionRef,
      eventDigest
    ]);
    return auditFromRow({
      event_id: command.event.eventId,
      stream_version: streamVersion,
      occurred_at: command.event.occurredAt,
      correlation_id: command.event.correlationId,
      actor_ref_sha256: command.event.actorRef,
      role: command.event.role,
      action: command.event.action,
      target_ref_sha256: command.event.targetRef,
      result: command.event.result,
      detail_sha256: command.event.detailDigest,
      request_method: command.event.requestMethod,
      request_path: command.event.requestPath,
      client_ref_sha256: command.event.clientRef,
      session_ref_sha256: command.event.sessionRef,
      command_key_sha256: command.commandKeyHash,
      intent_sha256: command.intentHash,
      event_sha256: eventDigest
    });
  }

  async function transactSecurityControlAction(input = {}) {
    assertWriteEnabled();
    const command = normalizeSecurityControlCommand(input, idFactory, now);
    return withSerializableTransaction(pool(), async (client) => {
      const stream = await lockStream(client, command.event.occurredAt);
      const replay = await findReplay(client, command);
      if (replay) return replay;

      const selected = await client.query(`
        SELECT control_id, control_version, status, evidence, next_action,
               last_action, updated_by_ref_sha256, created_at, updated_at
        FROM health_platform.identity_security_controls
        WHERE control_id = $1
        FOR UPDATE
      `, [command.controlId]);
      if (selected.rowCount !== 1) {
        throw new SessionSecurityAuditError(
          "SECURITY_CONTROL_NOT_FOUND",
          "security compliance control was not found",
          404
        );
      }
      const current = selected.rows[0];
      const expectedControlVersion = Number(current.control_version);
      const updated = await client.query(`
        UPDATE health_platform.identity_security_controls
        SET control_version = $2, status = $3, evidence = $4,
            next_action = $5, last_action = $6,
            updated_by_ref_sha256 = $7, updated_at = $8
        WHERE control_id = $1 AND control_version = $9
        RETURNING control_id, control_version, status, evidence, next_action,
                  last_action, updated_by_ref_sha256, created_at, updated_at
      `, [
        command.controlId,
        expectedControlVersion + 1,
        command.normalizedPayload.status || current.status,
        command.normalizedPayload.evidence || current.evidence,
        command.normalizedPayload.next || current.next_action,
        command.normalizedPayload.action,
        command.actorRef,
        command.event.occurredAt,
        expectedControlVersion
      ]);
      if (updated.rowCount !== 1) {
        throw new SessionSecurityAuditError(
          "SECURITY_CONTROL_VERSION_CONFLICT",
          "security control version conflict",
          409
        );
      }
      const result = controlFromRow(updated.rows[0]);
      const nextVersion = stream.version + 1;
      await updateStreamVersion(client, stream.version, nextVersion, command.event.occurredAt);
      const audit = await insertReceiptAndAudit(client, command, result, nextVersion);
      return {
        result,
        audit,
        streamVersion: nextVersion,
        idempotentReplay: false
      };
    });
  }

  async function verifySchema() {
    return withSerializableTransaction(pool(), async (client) => {
      const tables = await client.query(`
        SELECT
          to_regclass('health_platform.identity_security_audit_streams') AS streams,
          to_regclass('health_platform.identity_security_controls') AS controls,
          to_regclass('health_platform.identity_security_audit_commands') AS commands,
          to_regclass('health_platform.identity_security_audit_events') AS events
      `);
      const row = tables.rows[0] || {};
      const checks = {
        streams: Boolean(row.streams),
        controls: Boolean(row.controls),
        commands: Boolean(row.commands),
        events: Boolean(row.events)
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
    config,
    readiness: () => readinessProjection(config),
    transactSecurityControlAction,
    verifySchema,
    close
  });
}

module.exports = {
  DEFAULT_STREAM_ID,
  MIGRATION_FILE,
  MODES,
  auditFromRow,
  buildPostgresSessionSecurityAuditConfig,
  controlFromRow,
  createPostgresSessionSecurityAuditRepository,
  readinessProjection,
  safeDatabaseError,
  sha256,
  stableStringify
};
