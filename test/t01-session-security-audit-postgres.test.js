"use strict";

const fs = require("node:fs");
const assert = require("node:assert/strict");
const test = require("node:test");

const Postgres = require("../src/identity-security/session-security-audit-postgres-repository");

const OCCURRED_AT = "2026-08-04T01:00:00.000Z";

function fakePool(handler) {
  const queries = [];
  const client = {
    async query(sql, params = []) {
      const normalized = String(sql).replace(/\s+/g, " ").trim();
      queries.push({ sql: normalized, params: structuredClone(params) });
      if ([
        "BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE",
        "COMMIT",
        "ROLLBACK"
      ].includes(normalized)) {
        return { rowCount: 0, rows: [] };
      }
      return handler(normalized, params, queries);
    },
    release() {
      queries.push({ sql: "RELEASE", params: [] });
    }
  };
  return {
    queries,
    pool: {
      async connect() {
        return client;
      }
    }
  };
}

function controlRow(overrides = {}) {
  return {
    control_id: "control-auth-001",
    control_version: 3,
    status: "pending",
    evidence: "",
    next_action: "archive",
    last_action: "review",
    updated_by_ref_sha256: Postgres.sha256("previous-operator"),
    created_at: "2026-08-01T01:00:00.000Z",
    updated_at: "2026-08-03T01:00:00.000Z",
    ...overrides
  };
}

function commandInput(overrides = {}) {
  return {
    commandId: "security-command-raw-001",
    controlId: "control-auth-001",
    user: {
      name: "Security Operator",
      username: "security-operator",
      role: "commission"
    },
    payload: {
      status: "archived",
      evidence: "signed-control-evidence",
      next: "quarterly-review",
      action: "archive-evidence"
    },
    req: {
      method: "POST",
      url: "/api/security/controls/control-auth-001/actions?token=raw-query-secret",
      correlationId: "trace-postgres-audit-001",
      headers: {
        authorization: "Bearer raw-access-token",
        "user-agent": "Sensitive Browser 9.0"
      },
      socket: { remoteAddress: "192.0.2.88" }
    },
    session: {
      sessionId: "raw-session-identifier",
      token: "raw-session-token"
    },
    occurredAt: OCCURRED_AT,
    ...overrides
  };
}

function readyConfigEnv(overrides = {}) {
  return {
    IDENTITY_SECURITY_AUDIT_POSTGRES_MODE: "evidence-gated",
    DATABASE_URL: "postgresql://audit-user:database-secret@db.example/health",
    POSTGRES_SSL_MODE: "verify-full",
    IDENTITY_SECURITY_AUDIT_MIGRATION_EVIDENCE_ID: "migration-evidence-001",
    IDENTITY_SECURITY_AUDIT_BACKUP_EVIDENCE_ID: "backup-evidence-001",
    IDENTITY_SECURITY_AUDIT_RECOVERY_EVIDENCE_ID: "recovery-evidence-001",
    IDENTITY_SECURITY_AUDIT_CUTOVER_APPROVAL_ID: "cutover-evidence-001",
    ...overrides
  };
}

function repository(pool, options = {}) {
  let sequence = 0;
  return Postgres.createPostgresSessionSecurityAuditRepository({
    pool,
    testBypassEvidenceGate: true,
    randomUUID: () => `audit-event-${++sequence}`,
    now: () => new Date(OCCURRED_AT),
    ...options
  });
}

function streamHandler(sql) {
  if (sql.startsWith("SELECT pg_advisory_xact_lock")) return { rowCount: 1, rows: [{}] };
  if (sql.startsWith("INSERT INTO health_platform.identity_security_audit_streams")) {
    return { rowCount: 0, rows: [] };
  }
  if (sql.includes("FROM health_platform.identity_security_audit_streams") && sql.includes("FOR UPDATE")) {
    return {
      rowCount: 1,
      rows: [{
        stream_id: Postgres.DEFAULT_STREAM_ID,
        stream_version: 0,
        created_at: OCCURRED_AT,
        updated_at: OCCURRED_AT
      }]
    };
  }
  return null;
}

test("configuration is TLS verify-full and external-evidence gated without claiming production cutover", () => {
  const ready = Postgres.buildPostgresSessionSecurityAuditConfig(readyConfigEnv());
  assert.equal(ready.writeEnabled, true);
  assert.equal(ready.requirements.tlsVerifyFull, true);
  assert.equal(ready.evidenceReady, true);
  assert.equal(ready.requirements.centralSwitchConnected, false);
  assert.equal(ready.productionReady, false);
  assert.equal(ready.productionPrimary, false);
  assert.match(ready.migration.sha256, /^sha256:[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(ready), /database-secret/);

  const readiness = Postgres.readinessProjection(ready);
  assert.deepEqual(readiness.blockers, ["central-switch-not-connected"]);
  assert.equal(readiness.productionReady, false);
  assert.equal(readiness.credentialsPersisted, false);

  const blocked = Postgres.buildPostgresSessionSecurityAuditConfig(
    readyConfigEnv({ POSTGRES_SSL_MODE: "require" })
  );
  assert.equal(blocked.writeEnabled, false);
  assert.equal(blocked.requirements.tlsVerifyFull, false);
  assert.equal(Postgres.readinessProjection(blocked).blockers.includes("tls-verify-full-required"), true);
});

test("migration is additive and constrains stream CAS, digest receipts and event linkage", () => {
  const sql = fs.readFileSync(Postgres.MIGRATION_FILE, "utf8");
  assert.match(sql, /identity_security_audit_streams/);
  assert.match(sql, /identity_security_controls/);
  assert.match(sql, /identity_security_audit_commands/);
  assert.match(sql, /identity_security_audit_events/);
  assert.match(sql, /PRIMARY KEY \(stream_id, command_key_sha256\)/);
  assert.match(sql, /UNIQUE \(stream_id, stream_version\)/);
  assert.match(sql, /FOREIGN KEY \(stream_id, command_key_sha256, stream_version\)/);
  assert.match(sql, /position\('\?' in request_path\) = 0/);
  assert.doesNotMatch(sql, /\b(?:DROP|TRUNCATE|DELETE|ALTER\s+TABLE)\b/i);
});

test("security action, CAS, command receipt and audit event commit in one serializable transaction", async () => {
  const mock = fakePool((sql) => {
    const stream = streamHandler(sql);
    if (stream) return stream;
    if (sql.includes("FROM health_platform.identity_security_audit_commands")) {
      return { rowCount: 0, rows: [] };
    }
    if (sql.includes("FROM health_platform.identity_security_controls") && sql.includes("FOR UPDATE")) {
      return { rowCount: 1, rows: [controlRow()] };
    }
    if (sql.startsWith("UPDATE health_platform.identity_security_controls")) {
      return {
        rowCount: 1,
        rows: [controlRow({
          control_version: 4,
          status: "archived",
          evidence: "signed-control-evidence",
          next_action: "quarterly-review",
          last_action: "archive-evidence",
          updated_by_ref_sha256: Postgres.sha256("security-operator"),
          updated_at: OCCURRED_AT
        })]
      };
    }
    if (sql.startsWith("UPDATE health_platform.identity_security_audit_streams")) {
      return { rowCount: 1, rows: [{ stream_id: Postgres.DEFAULT_STREAM_ID }] };
    }
    if (sql.startsWith("INSERT INTO health_platform.identity_security_audit_commands")) {
      return { rowCount: 1, rows: [] };
    }
    if (sql.startsWith("INSERT INTO health_platform.identity_security_audit_events")) {
      return { rowCount: 1, rows: [] };
    }
    throw new Error(`unexpected query: ${sql}`);
  });

  const outcome = await repository(mock.pool).transactSecurityControlAction(commandInput());
  assert.equal(outcome.idempotentReplay, false);
  assert.equal(outcome.streamVersion, 1);
  assert.equal(outcome.result.version, 4);
  assert.equal(outcome.result.status, "archived");
  assert.equal(outcome.audit.request.path, "/api/security/controls/control-auth-001/actions");
  assert.equal(mock.queries[0].sql, "BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");
  assert.equal(mock.queries.at(-2).sql, "COMMIT");
  assert.equal(mock.queries.at(-1).sql, "RELEASE");

  const statements = mock.queries.map((item) => item.sql).join("\n");
  assert.match(statements, /pg_advisory_xact_lock/);
  assert.match(statements, /identity_security_audit_streams.*FOR UPDATE/s);
  assert.match(statements, /identity_security_controls.*FOR UPDATE/s);
  assert.match(statements, /WHERE stream_id = \$1 AND stream_version = \$4/);
  assert.match(statements, /INSERT INTO health_platform\.identity_security_audit_commands/);
  assert.match(statements, /INSERT INTO health_platform\.identity_security_audit_events/);

  const transmitted = JSON.stringify(mock.queries.map((item) => item.params));
  [
    "security-command-raw-001",
    "raw-query-secret",
    "raw-access-token",
    "raw-session-identifier",
    "raw-session-token",
    "192.0.2.88",
    "Sensitive Browser"
  ].forEach((secret) => {
    assert.equal(transmitted.includes(secret), false, `${secret} must not reach PostgreSQL`);
  });
});

test("equal command intent replays the original result without touching control state", async () => {
  const input = commandInput();
  const actorRef = Postgres.sha256("security-operator");
  const commandKeyHash = Postgres.sha256(input.commandId);
  const intentHash = Postgres.sha256(Postgres.stableStringify({
    type: "security-control-action",
    controlId: input.controlId,
    actorRef,
    payload: {
      status: "archived",
      evidence: "signed-control-evidence",
      next: "quarterly-review",
      action: "archive-evidence"
    }
  }));
  const result = {
    id: input.controlId,
    version: 4,
    status: "archived",
    evidence: "signed-control-evidence",
    next: "quarterly-review",
    lastAction: "archive-evidence",
    updatedByRef: actorRef,
    updatedAt: OCCURRED_AT
  };
  const replayEvent = {
    eventId: "audit-event-original",
    occurredAt: OCCURRED_AT,
    correlationId: "trace-postgres-audit-001",
    actorRef,
    role: "commission",
    action: "security-control-action",
    targetRef: Postgres.sha256(input.controlId),
    result: "allowed",
    detailDigest: Postgres.sha256("archived"),
    requestMethod: "POST",
    requestPath: "/api/security/controls/control-auth-001/actions",
    clientRef: Postgres.sha256("client"),
    sessionRef: Postgres.sha256("session"),
    streamVersion: 1,
    commandKeyHash,
    intentHash
  };
  const mock = fakePool((sql) => {
    const stream = streamHandler(sql);
    if (stream) {
      if (sql.includes("FROM health_platform.identity_security_audit_streams")) {
        stream.rows[0].stream_version = 1;
      }
      return stream;
    }
    if (sql.includes("FROM health_platform.identity_security_audit_commands")) {
      return {
        rowCount: 1,
        rows: [{
          command_key_sha256: commandKeyHash,
          intent_sha256: intentHash,
          stream_version: 1,
          result_snapshot: result,
          result_sha256: Postgres.sha256(Postgres.stableStringify(result)),
          committed_at: OCCURRED_AT
        }]
      };
    }
    if (sql.includes("FROM health_platform.identity_security_audit_events")) {
      return {
        rowCount: 1,
        rows: [{
          event_id: replayEvent.eventId,
          stream_version: 1,
          occurred_at: OCCURRED_AT,
          correlation_id: replayEvent.correlationId,
          actor_ref_sha256: actorRef,
          role: "commission",
          action: "security-control-action",
          target_ref_sha256: replayEvent.targetRef,
          result: "allowed",
          detail_sha256: replayEvent.detailDigest,
          request_method: "POST",
          request_path: replayEvent.requestPath,
          client_ref_sha256: replayEvent.clientRef,
          session_ref_sha256: replayEvent.sessionRef,
          command_key_sha256: commandKeyHash,
          intent_sha256: intentHash,
          event_sha256: Postgres.sha256(Postgres.stableStringify(replayEvent))
        }]
      };
    }
    throw new Error(`replay must not execute query: ${sql}`);
  });

  const replay = await repository(mock.pool).transactSecurityControlAction(input);
  assert.equal(replay.idempotentReplay, true);
  assert.deepEqual(replay.result, result);
  assert.equal(replay.audit.eventId, "audit-event-original");
  assert.equal(mock.queries.some((item) => item.sql.startsWith("UPDATE health_platform.identity_security_controls")), false);
  assert.equal(mock.queries.some((item) => item.sql.startsWith("INSERT INTO health_platform.identity_security_audit_commands")), false);
  assert.equal(mock.queries.at(-2).sql, "COMMIT");
});

test("same command key with intent drift returns 409 and rolls back", async () => {
  const mock = fakePool((sql) => {
    const stream = streamHandler(sql);
    if (stream) return stream;
    if (sql.includes("FROM health_platform.identity_security_audit_commands")) {
      return {
        rowCount: 1,
        rows: [{
          command_key_sha256: Postgres.sha256("security-command-raw-001"),
          intent_sha256: Postgres.sha256("different-intent"),
          stream_version: 1,
          result_snapshot: {},
          result_sha256: Postgres.sha256("{}"),
          committed_at: OCCURRED_AT
        }]
      };
    }
    throw new Error(`unexpected query: ${sql}`);
  });

  await assert.rejects(
    repository(mock.pool).transactSecurityControlAction(commandInput()),
    (error) => {
      assert.equal(error.code, "SESSION_SECURITY_AUDIT_IDEMPOTENCY_CONFLICT");
      assert.equal(error.statusCode, 409);
      return true;
    }
  );
  assert.equal(mock.queries.at(-2).sql, "ROLLBACK");
  assert.equal(mock.queries.at(-1).sql, "RELEASE");
  assert.equal(mock.queries.some((item) => item.sql === "COMMIT"), false);
});

test("stream CAS failure rolls back the already-issued control update", async () => {
  const mock = fakePool((sql) => {
    const stream = streamHandler(sql);
    if (stream) return stream;
    if (sql.includes("FROM health_platform.identity_security_audit_commands")) {
      return { rowCount: 0, rows: [] };
    }
    if (sql.includes("FROM health_platform.identity_security_controls") && sql.includes("FOR UPDATE")) {
      return { rowCount: 1, rows: [controlRow()] };
    }
    if (sql.startsWith("UPDATE health_platform.identity_security_controls")) {
      return {
        rowCount: 1,
        rows: [controlRow({
          control_version: 4,
          updated_by_ref_sha256: Postgres.sha256("security-operator"),
          updated_at: OCCURRED_AT
        })]
      };
    }
    if (sql.startsWith("UPDATE health_platform.identity_security_audit_streams")) {
      return { rowCount: 0, rows: [] };
    }
    throw new Error(`unexpected query: ${sql}`);
  });

  await assert.rejects(
    repository(mock.pool).transactSecurityControlAction(commandInput()),
    (error) => error.code === "SESSION_SECURITY_AUDIT_VERSION_CONFLICT" && error.statusCode === 409
  );
  assert.equal(mock.queries.at(-2).sql, "ROLLBACK");
  assert.equal(mock.queries.some((item) => item.sql.startsWith("INSERT INTO health_platform.identity_security_audit_commands")), false);
});

test("audit insert failure rolls back control, stream CAS and command receipt", async () => {
  const mock = fakePool((sql) => {
    const stream = streamHandler(sql);
    if (stream) return stream;
    if (sql.includes("FROM health_platform.identity_security_audit_commands")) {
      return { rowCount: 0, rows: [] };
    }
    if (sql.includes("FROM health_platform.identity_security_controls") && sql.includes("FOR UPDATE")) {
      return { rowCount: 1, rows: [controlRow()] };
    }
    if (sql.startsWith("UPDATE health_platform.identity_security_controls")) {
      return {
        rowCount: 1,
        rows: [controlRow({
          control_version: 4,
          updated_by_ref_sha256: Postgres.sha256("security-operator"),
          updated_at: OCCURRED_AT
        })]
      };
    }
    if (sql.startsWith("UPDATE health_platform.identity_security_audit_streams")) {
      return { rowCount: 1, rows: [{ stream_id: Postgres.DEFAULT_STREAM_ID }] };
    }
    if (sql.startsWith("INSERT INTO health_platform.identity_security_audit_commands")) {
      return { rowCount: 1, rows: [] };
    }
    if (sql.startsWith("INSERT INTO health_platform.identity_security_audit_events")) {
      const error = new Error("simulated insert failure");
      error.code = "XX999";
      throw error;
    }
    throw new Error(`unexpected query: ${sql}`);
  });

  await assert.rejects(
    repository(mock.pool).transactSecurityControlAction(commandInput()),
    (error) => error.code === "SESSION_SECURITY_AUDIT_POSTGRES_FAILED" && error.statusCode === 503
  );
  assert.equal(mock.queries.at(-2).sql, "ROLLBACK");
  assert.equal(mock.queries.some((item) => item.sql === "COMMIT"), false);
});

test("write gate fails closed before pool use and schema readiness remains non-primary", async () => {
  const mock = fakePool(() => {
    throw new Error("pool must not be used while blocked");
  });
  const blocked = Postgres.createPostgresSessionSecurityAuditRepository({
    pool: mock.pool,
    env: {}
  });
  await assert.rejects(
    blocked.transactSecurityControlAction(commandInput()),
    (error) => error.code === "SESSION_SECURITY_AUDIT_POSTGRES_WRITE_BLOCKED"
  );
  assert.equal(mock.queries.length, 0);

  const schemaMock = fakePool((sql) => {
    if (sql.includes("to_regclass('health_platform.identity_security_audit_streams')")) {
      return {
        rowCount: 1,
        rows: [{
          streams: "health_platform.identity_security_audit_streams",
          controls: "health_platform.identity_security_controls",
          commands: "health_platform.identity_security_audit_commands",
          events: "health_platform.identity_security_audit_events"
        }]
      };
    }
    throw new Error(`unexpected query: ${sql}`);
  });
  const report = await repository(schemaMock.pool).verifySchema();
  assert.equal(report.ok, true);
  assert.equal(report.productionReady, false);
  assert.equal(report.productionPrimary, false);
});
