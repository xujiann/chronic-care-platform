"use strict";

const fs = require("node:fs");
const assert = require("node:assert/strict");
const test = require("node:test");
const { createDomainEvent } = require("../src/platform/events/domain-event-runtime");
const Delivery = require("../src/http/routes/t06-emergency-signal-delivery");
const Postgres = require("../src/clinical-specialties/emergency-signal-delivery-postgres");

const OCCURRED_AT = "2030-08-04T01:00:00.000Z";

function outboxEvent(overrides = {}) {
  const event = createDomainEvent({
    id: overrides.id || "emergency-event-001",
    domain: "clinical-specialties",
    type: "clinical-specialties.emergency-signal-updated.v1",
    aggregateId: "signal-001",
    aggregateVersion: 1,
    correlationId: "correlation-emergency-postgres",
    causationId: "command-emergency-postgres",
    occurredAt: OCCURRED_AT,
    payload: {
      signalId: "signal-001",
      previousStatus: "pending_acknowledgement",
      status: overrides.status || "acknowledged",
      action: "physician notified",
      level: "high",
      ownerRole: "county"
    }
  });
  const outbox = {
    ...event,
    action: "domain-event-outbox",
    owner: "clinical-specialties",
    outboxStatus: "pending"
  };
  outbox.delivery = Delivery.createEmergencySignalDelivery(outbox, {
    now: OCCURRED_AT,
    maxAttempts: overrides.maxAttempts || 5
  });
  return outbox;
}

function databaseRow(outbox) {
  const { delivery, outboxStatus: _outboxStatus, ...event } = structuredClone(outbox);
  return {
    event_id: outbox.id,
    event_payload: event,
    event_payload_sha256: Postgres.stableDigest(event),
    delivery_state: structuredClone(delivery),
    delivery_state_sha256: delivery.digest,
    status: delivery.status,
    attempts: delivery.attempts,
    max_attempts: delivery.maxAttempts,
    generation: delivery.generation,
    next_attempt_at: delivery.nextAttemptAt,
    lease_owner: delivery.leaseOwner || null,
    lease_token: delivery.leaseToken || null,
    lease_expires_at: delivery.leaseExpiresAt || null,
    published_at: delivery.publishedAt || null,
    dead_lettered_at: delivery.deadLetteredAt || null,
    last_error_code: delivery.lastErrorCode || null,
    last_error_digest: delivery.lastErrorDigest || null,
    receipt_digest: delivery.receipt?.receiptDigest || null,
    created_at: OCCURRED_AT,
    updated_at: OCCURRED_AT
  };
}

function applyDeliveryUpdate(row, params) {
  const delivery = JSON.parse(params[1]);
  Object.assign(row, {
    delivery_state: delivery,
    delivery_state_sha256: params[2],
    status: params[3],
    attempts: params[4],
    max_attempts: params[5],
    generation: params[6],
    next_attempt_at: params[7],
    lease_owner: params[8] || null,
    lease_token: params[9] || null,
    lease_expires_at: params[10] || null,
    published_at: params[11] || null,
    dead_lettered_at: params[12] || null,
    last_error_code: params[13] || null,
    last_error_digest: params[14] || null,
    receipt_digest: params[15] || null,
    updated_at: params[16]
  });
}

function fakePool(handler) {
  const queries = [];
  const client = {
    async query(sql, params = []) {
      const normalized = String(sql).replace(/\s+/g, " ").trim();
      queries.push({ sql: normalized, params: structuredClone(params) });
      if (
        normalized.startsWith("BEGIN")
        || normalized === "COMMIT"
        || normalized === "ROLLBACK"
      ) {
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

function repository(pool, options = {}) {
  return Postgres.createEmergencySignalPostgresRepository({
    pool,
    testBypassEvidenceGate: true,
    ...options
  });
}

test("PostgreSQL configuration is TLS and evidence gated without exposing credentials", () => {
  const blocked = Postgres.buildEmergencySignalPostgresConfig({
    EMERGENCY_SIGNAL_POSTGRES_MODE: "evidence-gated",
    DATABASE_URL: "postgresql://user:private-password@db.example/health",
    POSTGRES_SSL_MODE: "require"
  });
  assert.equal(blocked.writeEnabled, false);
  assert.equal(blocked.requirements.tlsVerified, false);
  assert.doesNotMatch(JSON.stringify(blocked), /private-password/);

  const ready = Postgres.buildEmergencySignalPostgresConfig({
    EMERGENCY_SIGNAL_POSTGRES_MODE: "evidence-gated",
    DATABASE_URL: "postgresql://db.example/health",
    POSTGRES_SSL_MODE: "verify-full",
    EMERGENCY_SIGNAL_MIGRATION_EVIDENCE_ID: "migration-001",
    EMERGENCY_SIGNAL_BACKUP_EVIDENCE_ID: "backup-001",
    EMERGENCY_SIGNAL_RECOVERY_EVIDENCE_ID: "restore-001",
    EMERGENCY_SIGNAL_CUTOVER_APPROVAL_ID: "approval-001"
  });
  assert.equal(ready.writeEnabled, true);
  assert.equal(ready.productionReady, false);
  assert.match(ready.migration.sha256, /^sha256:[a-f0-9]{64}$/);
});

test("migration is additive and constrains delivery and replay evidence", () => {
  const sql = fs.readFileSync(Postgres.MIGRATION_FILE, "utf8");
  assert.match(sql, /emergency_signal_delivery_outbox/);
  assert.match(sql, /emergency_signal_delivery_replays/);
  assert.match(sql, /PRIMARY KEY.*replay_key_sha256|replay_key_sha256 text PRIMARY KEY/s);
  assert.match(sql, /CHECK .*status.*pending.*processing.*published.*dead-letter/is);
  assert.match(sql, /octet_length\(event_payload::text\) <= 16384/i);
  assert.doesNotMatch(sql, /\b(?:DROP|TRUNCATE)\b/i);
});

test("event contract rejects unknown or sensitive payload fields before persistence", async () => {
  const event = outboxEvent();
  event.payload = { ...event.payload, accessToken: "must-not-persist" };
  delete event.delivery;
  await assert.rejects(
    () => repository(fakePool(() => {
      throw new Error("database must not be reached");
    }).pool).enqueue(event),
    (error) => error.code === "EMERGENCY_SIGNAL_DELIVERY_PAYLOAD_FIELD_FORBIDDEN"
  );
});

test("runtime pool injection and pool configuration cannot bypass TLS verification", async () => {
  const injected = Postgres.createEmergencySignalPostgresRepository({
    pool: fakePool(() => ({ rowCount: 0, rows: [] })).pool,
    config: {
      configured: true,
      writeEnabled: true,
      boundary: "test",
      migration: { sha256: "sha256:test" }
    }
  });
  await assert.rejects(
    () => injected.claim({ workerId: "worker", now: OCCURRED_AT }),
    (error) => error.code === "EMERGENCY_SIGNAL_POSTGRES_TLS_EVIDENCE_REQUIRED"
  );

  class PoolMustNotConstruct {
    constructor() {
      throw new Error("pool must not be constructed");
    }
  }
  const unsafe = Postgres.createEmergencySignalPostgresRepository({
    env: {
      EMERGENCY_SIGNAL_POSTGRES_MODE: "evidence-gated",
      DATABASE_URL: "postgresql://db.example/health",
      POSTGRES_SSL_MODE: "verify-full",
      EMERGENCY_SIGNAL_MIGRATION_EVIDENCE_ID: "migration-001",
      EMERGENCY_SIGNAL_BACKUP_EVIDENCE_ID: "backup-001",
      EMERGENCY_SIGNAL_RECOVERY_EVIDENCE_ID: "restore-001",
      EMERGENCY_SIGNAL_CUTOVER_APPROVAL_ID: "approval-001"
    },
    poolConfig: { connectionString: "postgresql://db.example/health", ssl: { rejectUnauthorized: false } },
    PoolClass: PoolMustNotConstruct
  });
  await assert.rejects(
    () => unsafe.claim({ workerId: "worker", now: OCCURRED_AT }),
    (error) => error.code === "EMERGENCY_SIGNAL_POSTGRES_TLS_REQUIRED"
  );
});

test("row projection rejects duplicated lease or delivery metadata drift", () => {
  const row = databaseRow(outboxEvent());
  row.lease_token = "tampered-lease-token";
  assert.throws(
    () => Postgres.rowToOutbox(row),
    (error) => error.code === "EMERGENCY_SIGNAL_POSTGRES_INTEGRITY_INVALID"
  );
});

test("enqueue is one serializable insert and rejects event-id payload drift", async () => {
  const outbox = outboxEvent();
  let current = null;
  const mock = fakePool((sql, params) => {
    if (sql.startsWith("INSERT INTO health_platform.emergency_signal_delivery_outbox")) {
      if (current) return { rowCount: 0, rows: [] };
      current = databaseRow(outbox);
      return { rowCount: 1, rows: [{ event_id: outbox.id }] };
    }
    if (sql.includes("FROM health_platform.emergency_signal_delivery_outbox") && sql.includes("FOR UPDATE")) {
      return { rowCount: 1, rows: [structuredClone(current)] };
    }
    throw new Error(`unexpected query: ${sql}`);
  });
  const pg = repository(mock.pool);
  assert.equal((await pg.enqueue(outbox)).idempotentReplay, false);
  assert.equal((await pg.enqueue(outbox)).idempotentReplay, true);
  const drift = outboxEvent({ status: "closed" });
  await assert.rejects(
    () => pg.enqueue(drift),
    (error) => error.code === "EMERGENCY_SIGNAL_POSTGRES_ENQUEUE_CONFLICT"
  );
  assert.equal(mock.queries.filter((item) => item.sql === "COMMIT").length, 2);
  assert.equal(mock.queries.filter((item) => item.sql === "ROLLBACK").length, 1);
});

test("claim uses SKIP LOCKED and exact acknowledgement is persisted once", async () => {
  let current = databaseRow(outboxEvent());
  const mock = fakePool((sql, params) => {
    if (sql.includes("FOR UPDATE SKIP LOCKED")) {
      return current.status === "pending"
        ? { rowCount: 1, rows: [structuredClone(current)] }
        : { rowCount: 0, rows: [] };
    }
    if (sql.startsWith("UPDATE health_platform.emergency_signal_delivery_outbox")) {
      applyDeliveryUpdate(current, params);
      return { rowCount: 1, rows: [] };
    }
    if (sql.includes("WHERE event_id = $1") && sql.endsWith("FOR UPDATE")) {
      return { rowCount: 1, rows: [structuredClone(current)] };
    }
    throw new Error(`unexpected query: ${sql}`);
  });
  const pg = repository(mock.pool);
  const [claim] = await pg.claim({
    workerId: "postgres-worker-a",
    now: "2030-08-04T01:00:01.000Z",
    leaseMs: 30_000
  });
  assert.equal(current.status, "processing");
  assert.equal(claim.attempt, 1);
  assert.equal(mock.queries.some((item) => /FOR UPDATE SKIP LOCKED/.test(item.sql)), true);

  const receipt = {
    status: "delivered",
    providerMessageId: "provider-emergency-001",
    eventId: claim.eventId,
    payloadDigest: claim.payloadDigest,
    receivedAt: "2030-08-04T01:00:02.000Z",
    transportVerified: true,
    signatureVerified: true
  };
  assert.equal((await pg.acknowledge(claim, receipt)).duplicate, false);
  assert.equal(current.status, "published");
  assert.equal((await pg.acknowledge(claim, receipt)).duplicate, true);
  await assert.rejects(
    () => pg.acknowledge(claim, { ...receipt, providerMessageId: "provider-drift" }),
    (error) => error.code === "EMERGENCY_SIGNAL_DELIVERY_ACK_CONFLICT"
  );
});

test("dead-letter replay stores only digests and replays the first durable result", async () => {
  const event = outboxEvent({ maxAttempts: 1 });
  const state = { emergencyAuditEvents: [event] };
  const [claim] = Delivery.claimEmergencySignalDeliveries(state, {
    workerId: "failed-worker",
    now: "2030-08-04T02:00:00.000Z"
  });
  Delivery.failEmergencySignalDelivery(
    state,
    claim,
    { errorCode: "TRANSPORT_DOWN", message: "private endpoint failure" },
    { now: "2030-08-04T02:00:01.000Z" }
  );
  let current = databaseRow(event);
  let replayEvidence = null;
  const mock = fakePool((sql, params) => {
    if (sql.includes("FROM health_platform.emergency_signal_delivery_outbox") && sql.endsWith("FOR UPDATE")) {
      return { rowCount: 1, rows: [structuredClone(current)] };
    }
    if (sql.includes("FROM health_platform.emergency_signal_delivery_replays")) {
      return replayEvidence
        ? { rowCount: 1, rows: [structuredClone(replayEvidence)] }
        : { rowCount: 0, rows: [] };
    }
    if (sql.startsWith("UPDATE health_platform.emergency_signal_delivery_outbox")) {
      applyDeliveryUpdate(current, params);
      return { rowCount: 1, rows: [] };
    }
    if (sql.startsWith("INSERT INTO health_platform.emergency_signal_delivery_replays")) {
      replayEvidence = {
        replay_key_sha256: params[0],
        event_id: params[1],
        intent_sha256: params[2],
        reason_sha256: params[3],
        requested_by_sha256: params[4],
        requested_at: params[5],
        result: JSON.parse(params[6]),
        result_sha256: params[7]
      };
      return { rowCount: 1, rows: [] };
    }
    throw new Error(`unexpected query: ${sql}`);
  });
  const pg = repository(mock.pool);
  const input = {
    idempotencyKey: "commission-replay-private-001",
    reason: "approved after verified transport recovery"
  };
  const actor = { role: "commission", username: "commission-operator" };
  const first = await pg.replay(event.id, input, actor, {
    now: "2030-08-04T02:01:00.000Z"
  });
  const replay = await pg.replay(event.id, input, actor, {
    now: "2030-08-04T03:01:00.000Z"
  });
  assert.deepEqual(first, { duplicate: false, status: "pending", generation: 2 });
  assert.deepEqual(replay, { duplicate: true, status: "pending", generation: 2 });
  assert.doesNotMatch(
    JSON.stringify(replayEvidence),
    /commission-replay-private-001|approved after verified|commission-operator/
  );
  assert.doesNotMatch(JSON.stringify(current.delivery_state), /commission-operator/);
  assert.match(current.delivery_state.replayHistory[0].actor, /^sha256:[a-f0-9]{64}$/);
  assert.match(replayEvidence.replay_key_sha256, /^sha256:[a-f0-9]{64}$/);
});

test("database failures roll back and never expose the raw driver message", async () => {
  const mock = fakePool(() => {
    const error = new Error("postgresql://user:secret@private-db");
    error.code = "ECONNRESET";
    throw error;
  });
  await assert.rejects(
    () => repository(mock.pool).claim({ workerId: "worker-a", now: OCCURRED_AT }),
    (error) => error.code === "ECONNRESET" && !/private-db|secret/.test(error.message)
  );
  assert.equal(mock.queries.some((item) => item.sql === "ROLLBACK"), true);
});
