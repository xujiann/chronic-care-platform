"use strict";

const fs = require("node:fs");
const assert = require("node:assert/strict");
const test = require("node:test");
const Persistence = require("../insurance-payment-persistence");
const Postgres = require("../insurance-payment-postgres-repository");

const CREATED_AT = "2026-07-29T01:00:00.000Z";

function aggregateRow(state = { counter: 0 }, version = 0, updatedAt = CREATED_AT) {
  return {
    aggregate_id: "insurance-payment",
    schema_version: Persistence.PERSISTENCE_SCHEMA,
    aggregate_version: version,
    state,
    state_sha256: Persistence.stateDigest(state),
    created_at: CREATED_AT,
    updated_at: updatedAt
  };
}

function eventRow(event) {
  return {
    event_id: event.id,
    aggregate_id: event.aggregateId,
    aggregate_version: event.aggregateVersion,
    command_id: event.commandId,
    command_type: event.commandType,
    event_type: event.eventType,
    occurred_at: event.occurredAt,
    actor: event.actor,
    trace_id: event.traceId,
    payload: event.payload,
    event_sha256: event.digest,
    status: event.status,
    attempts: event.attempts,
    max_attempts: event.maxAttempts,
    next_attempt_at: event.nextAttemptAt,
    lease_owner: event.leaseOwner || null,
    lease_token: event.leaseToken || null,
    lease_expires_at: event.leaseExpiresAt || null,
    published_at: event.publishedAt || null,
    dead_lettered_at: event.deadLetteredAt || null,
    last_error_code: event.lastErrorCode || null,
    last_error_digest: event.lastErrorDigest || null
  };
}

function fakePool(handler) {
  const queries = [];
  const client = {
    async query(sql, params) {
      const normalized = String(sql).replace(/\s+/g, " ").trim();
      queries.push({ sql: normalized, params });
      if (["BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE", "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY", "BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED", "BEGIN READ ONLY", "COMMIT", "ROLLBACK"].includes(normalized)) {
        return { rowCount: 0, rows: [] };
      }
      return handler(normalized, params, queries);
    },
    release() { queries.push({ sql: "RELEASE" }); }
  };
  return { queries, pool: { async connect() { return client; } } };
}

function repository(pool, options = {}) {
  return Postgres.createPostgresInsurancePaymentRepository({
    pool,
    testBypassEvidenceGate: true,
    ...options
  });
}

test("production configuration is evidence-gated TLS-strict and redacted", () => {
  const blocked = Postgres.buildPostgresInsurancePaymentConfig({
    INSURANCE_PAYMENT_POSTGRES_MODE: "rehearsal",
    DATABASE_URL: "postgresql://user:secret@db.example/insurance",
    POSTGRES_SSL_MODE: "require"
  });
  assert.equal(blocked.configured, true);
  assert.equal(blocked.writeEnabled, false);
  assert.equal(blocked.requirements.tlsVerified, false);
  assert.doesNotMatch(JSON.stringify(blocked), /secret@/);

  const ready = Postgres.buildPostgresInsurancePaymentConfig({
    INSURANCE_PAYMENT_POSTGRES_MODE: "evidence-gated",
    DATABASE_URL: "postgresql://db.example/insurance",
    POSTGRES_SSL_MODE: "verify-full",
    INSURANCE_PAYMENT_MIGRATION_EVIDENCE_ID: "migration-change-001",
    INSURANCE_PAYMENT_BACKUP_EVIDENCE_ID: "backup-evidence-001",
    INSURANCE_PAYMENT_RECOVERY_EVIDENCE_ID: "restore-drill-001",
    INSURANCE_PAYMENT_CUTOVER_APPROVAL_ID: "cutover-approval-001"
  });
  assert.equal(ready.writeEnabled, true);
  assert.equal(ready.evidenceReady, true);
  assert.match(ready.migration.sha256, /^sha256:[a-f0-9]{64}$/);
  assert.equal(ready.productionPrimary, false);
  assert.throws(
    () => Postgres.buildPostgresInsurancePaymentConfig({ INSURANCE_PAYMENT_POSTGRES_MODE: "force" }),
    (error) => error.code === "PERSISTENCE_POSTGRES_MODE_INVALID"
  );
});

test("migration creates aggregate command and outbox constraints without destructive statements", () => {
  const sql = fs.readFileSync(Postgres.MIGRATION_FILE, "utf8");
  assert.match(sql, /insurance_payment_aggregates/);
  assert.match(sql, /insurance_payment_commands/);
  assert.match(sql, /insurance_payment_outbox/);
  assert.match(sql, /FOREIGN KEY \(aggregate_id, command_id, aggregate_version\)/);
  assert.match(sql, /UNIQUE \(aggregate_id, aggregate_version\)/);
  assert.match(sql, /CHECK \(attempts <= max_attempts\)/);
  assert.match(sql, /dead-letter/);
  assert.doesNotMatch(sql, /\b(?:DROP|TRUNCATE)\b/i);
});

test("PostgreSQL transaction commits aggregate command and outbox in one serializable unit", async () => {
  const mock = fakePool((sql) => {
    if (sql.includes("FROM health_platform.insurance_payment_aggregates")) return { rowCount: 1, rows: [aggregateRow()] };
    if (sql.includes("FROM health_platform.insurance_payment_commands")) return { rowCount: 0, rows: [] };
    if (sql.startsWith("UPDATE health_platform.insurance_payment_aggregates")) return { rowCount: 1, rows: [{ aggregate_id: "insurance-payment" }] };
    if (sql.startsWith("INSERT INTO health_platform.insurance_payment_commands")) return { rowCount: 1, rows: [] };
    if (sql.startsWith("INSERT INTO health_platform.insurance_payment_outbox")) return { rowCount: 1, rows: [] };
    throw new Error(`unexpected query: ${sql}`);
  });
  const result = await repository(mock.pool).transact({
    commandId: "cmd-postgres-001",
    commandType: "refund.requested",
    payload: { refundId: "refund-001" },
    expectedVersion: 0,
    actor: "finance-operator",
    traceId: "trace-postgres-001",
    occurredAt: "2026-07-29T02:00:00.000Z"
  }, (state) => {
    state.counter += 1;
    return { result: { counter: 1 }, eventType: "refund.requested", eventPayload: { refundId: "refund-001" } };
  });

  assert.equal(result.snapshot.version, 1);
  assert.equal(result.outboxEvent.aggregateVersion, 1);
  assert.equal(result.idempotentReplay, false);
  assert.equal(mock.queries[0].sql, "BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");
  assert.equal(mock.queries.at(-2).sql, "COMMIT");
  assert.equal(mock.queries.at(-1).sql, "RELEASE");
  const statements = mock.queries.map((item) => item.sql).join("\n");
  assert.match(statements, /FOR UPDATE/);
  assert.match(statements, /UPDATE health_platform\.insurance_payment_aggregates/);
  assert.match(statements, /INSERT INTO health_platform\.insurance_payment_commands/);
  assert.match(statements, /INSERT INTO health_platform\.insurance_payment_outbox/);
});

test("PostgreSQL transaction rolls back completely when the domain mutator fails", async () => {
  const mock = fakePool((sql) => {
    if (sql.includes("FROM health_platform.insurance_payment_aggregates")) return { rowCount: 1, rows: [aggregateRow()] };
    if (sql.includes("FROM health_platform.insurance_payment_commands")) return { rowCount: 0, rows: [] };
    throw new Error(`unexpected query: ${sql}`);
  });
  await assert.rejects(repository(mock.pool).transact({
    commandId: "cmd-postgres-fail",
    commandType: "refund.requested",
    payload: {}, expectedVersion: 0, occurredAt: "2026-07-29T02:00:00.000Z"
  }, (state) => {
    state.counter = 99;
    throw new Persistence.InsurancePaymentPersistenceError("domain rejected", "DOMAIN_REJECTED", 409);
  }), (error) => error.code === "DOMAIN_REJECTED");
  assert.equal(mock.queries.some((item) => item.sql === "ROLLBACK"), true);
  assert.equal(mock.queries.some((item) => item.sql.startsWith("UPDATE health_platform.insurance_payment_aggregates")), false);
});

test("PostgreSQL replay returns the durable result without invoking the mutator", async () => {
  const snapshot = aggregateRow({ counter: 1 }, 1, "2026-07-29T02:00:00.000Z");
  const command = {
    commandId: "cmd-postgres-replay",
    commandType: "counter.increment",
    payload: { amount: 1 },
    expectedVersion: 0,
    actor: "operator",
    traceId: "trace-replay"
  };
  const normalized = {
    commandId: command.commandId,
    commandType: command.commandType,
    payload: command.payload
  };
  const event = Persistence.buildOutboxEvent({
    schema: Persistence.PERSISTENCE_SCHEMA,
    aggregateId: "insurance-payment",
    version: 1,
    state: snapshot.state,
    stateDigest: snapshot.state_sha256,
    createdAt: CREATED_AT,
    updatedAt: "2026-07-29T02:00:00.000Z"
  }, { ...command, commandDigest: Persistence.commandDigest(normalized) }, {
    eventType: "counter.incremented",
    eventPayload: { counter: 1 }
  }, "2026-07-29T02:00:00.000Z", { maxAttempts: 8 });
  const mock = fakePool((sql) => {
    if (sql.includes("FROM health_platform.insurance_payment_aggregates")) return { rowCount: 1, rows: [snapshot] };
    if (sql.includes("FROM health_platform.insurance_payment_commands")) return { rowCount: 1, rows: [{ command_sha256: Persistence.commandDigest(normalized), result: { counter: 1 } }] };
    if (sql.includes("FROM health_platform.insurance_payment_outbox")) return { rowCount: 1, rows: [eventRow(event)] };
    throw new Error(`unexpected query: ${sql}`);
  });
  let invoked = false;
  const result = await repository(mock.pool).transact(command, () => { invoked = true; });
  assert.equal(result.idempotentReplay, true);
  assert.equal(result.result.counter, 1);
  assert.equal(invoked, false);
  assert.equal(mock.queries.some((item) => item.sql.startsWith("UPDATE health_platform.insurance_payment_aggregates")), false);
});

test("PostgreSQL outbox claims with a lease and persists acknowledgement", async () => {
  const event = Persistence.buildOutboxEvent({ aggregateId: "insurance-payment", version: 1 }, {
    commandId: "cmd-delivery", commandType: "refund.requested", actor: "operator", traceId: "trace-delivery"
  }, { eventType: "refund.requested", eventPayload: { refundId: "refund-001" } }, "2026-07-29T02:00:00.000Z", { maxAttempts: 8 });
  let current = eventRow(event);
  const mock = fakePool((sql, params) => {
    if (sql.startsWith("SELECT * FROM health_platform.insurance_payment_outbox") && sql.includes("status = 'pending'")) {
      return { rowCount: 1, rows: [structuredClone(current)] };
    }
    if (sql.startsWith("SELECT * FROM health_platform.insurance_payment_outbox") && sql.includes("event_id = $1")) {
      return { rowCount: 1, rows: [structuredClone(current)] };
    }
    if (sql.startsWith("UPDATE health_platform.insurance_payment_outbox SET")) {
      current = {
        ...current,
        event_sha256: params[1], status: params[2], attempts: params[3], next_attempt_at: params[4],
        lease_owner: params[5] || null, lease_token: params[6] || null, lease_expires_at: params[7] || null,
        published_at: params[8] || null, dead_lettered_at: params[9] || null,
        last_error_code: params[10] || null, last_error_digest: params[11] || null
      };
      return { rowCount: 1, rows: [] };
    }
    throw new Error(`unexpected query: ${sql}`);
  });
  const pg = repository(mock.pool);
  const [claimed] = await pg.claimOutbox({ workerId: "worker-a", now: "2026-07-29T02:00:01.000Z", leaseMs: 5_000 });
  assert.equal(claimed.status, "processing");
  assert.equal(claimed.attempts, 1);
  assert.equal(current.lease_owner, "worker-a");
  const acknowledged = await pg.acknowledgeOutbox(claimed.id, {
    workerId: "worker-a", leaseToken: claimed.leaseToken, publishedAt: "2026-07-29T02:00:02.000Z"
  });
  assert.equal(acknowledged.event.status, "published");
  assert.equal(current.status, "published");
  assert.equal(current.lease_owner, null);
  assert.equal(current.published_at, "2026-07-29T02:00:02.000Z");
  assert.equal(Postgres.outboxRowToEvent(current).status, "published");
  assert.equal(mock.queries.filter((item) => item.sql === "COMMIT").length, 2);
});

test("row projection rejects state or outbox digest tampering", () => {
  const stateRow = aggregateRow();
  stateRow.state.counter = 9;
  assert.throws(() => Postgres.aggregateRowToSnapshot(stateRow), (error) => error.code === "PERSISTENCE_INTEGRITY_FAILED");

  const event = Persistence.buildOutboxEvent({ aggregateId: "insurance-payment", version: 1 }, {
    commandId: "cmd-tamper", commandType: "test", actor: "tester", traceId: "trace-tamper"
  }, { eventType: "test.event", eventPayload: {} }, CREATED_AT, { maxAttempts: 8 });
  const row = eventRow(event);
  row.status = "published";
  row.published_at = CREATED_AT;
  assert.throws(() => Postgres.outboxRowToEvent(row), (error) => error.code === "PERSISTENCE_OUTBOX_INTEGRITY_FAILED");
});

test("write operations fail closed when production evidence gate is not ready", async () => {
  const mock = fakePool(() => ({ rowCount: 0, rows: [] }));
  const blocked = Postgres.createPostgresInsurancePaymentRepository({ pool: mock.pool });
  await assert.rejects(blocked.initialize({}), (error) => error.code === "PERSISTENCE_POSTGRES_WRITE_BLOCKED");
  await assert.rejects(blocked.transact({}, () => {}), (error) => error.code === "PERSISTENCE_POSTGRES_WRITE_BLOCKED");
  assert.equal(mock.queries.length, 0);
});

test("schema verification requires all tables and relational integrity constraints", async () => {
  const mock = fakePool((sql) => {
    if (sql.includes("to_regclass('health_platform.insurance_payment_aggregates')")) {
      return { rowCount: 1, rows: [{ aggregates: "health_platform.insurance_payment_aggregates", commands: "health_platform.insurance_payment_commands", outbox: "health_platform.insurance_payment_outbox" }] };
    }
    if (sql.includes("FROM pg_constraint")) {
      return { rowCount: 5, rows: [
        { definition: "PRIMARY KEY (aggregate_id, command_id)" },
        { definition: "UNIQUE (aggregate_id, aggregate_version)" },
        { definition: "UNIQUE (aggregate_id, aggregate_version)" },
        { definition: "FOREIGN KEY (aggregate_id, command_id, aggregate_version) REFERENCES health_platform.insurance_payment_commands(aggregate_id, command_id, aggregate_version)" },
        { definition: "CHECK ((status = ANY (ARRAY['pending', 'processing', 'published', 'dead-letter'])))" }
      ] };
    }
    throw new Error(`unexpected query: ${sql}`);
  });
  const report = await repository(mock.pool).verifySchema();
  assert.equal(report.ok, true);
  assert.equal(Object.values(report.checks).every(Boolean), true);
  assert.equal(report.productionPrimary, false);
});
