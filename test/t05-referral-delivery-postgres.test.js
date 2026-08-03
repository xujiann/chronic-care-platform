"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const {
  MIGRATION_FILE,
  buildReferralDeliveryPostgresConfig,
  createReferralDeliveryPostgresRepository,
  sha256
} = require("../src/care-coordination/referral-delivery-postgres-repository");

function createFakePool() {
  const events = new Map();
  const replays = new Map();
  const queries = [];
  const client = {
    async query(sql, params = []) {
      const statement = String(sql).replace(/\s+/g, " ").trim();
      queries.push({ sql: statement, params: structuredClone(params) });
      if (/^(?:BEGIN|COMMIT|ROLLBACK)/.test(statement)) return { rowCount: 0, rows: [] };
      if (statement.startsWith("SELECT * FROM health_platform.referral_delivery_outbox WHERE event_id = $1")) {
        const row = events.get(params[0]);
        return { rowCount: row ? 1 : 0, rows: row ? [structuredClone(row)] : [] };
      }
      if (statement.startsWith("INSERT INTO health_platform.referral_delivery_outbox")) {
        if (events.has(params[0])) return { rowCount: 0, rows: [] };
        events.set(params[0], {
          event_id: params[0], event_type: params[1], contract_id: params[2],
          aggregate_version: params[3], correlation_id: params[4], payload: JSON.parse(params[5]),
          payload_sha256: params[6], status: "pending", attempts: 0, max_attempts: params[7],
          next_attempt_at: params[8], lease_owner: null, lease_token_sha256: null,
          lease_version: 0, lease_expires_at: null, ack_lease_token_sha256: null,
          receipt: null, receipt_sha256: null, delivered_at: null, dead_lettered_at: null,
          last_error_code: null, last_error_sha256: null, replay_count: 0,
          created_at: params[8], updated_at: params[8]
        });
        return { rowCount: 1, rows: [{ event_id: params[0] }] };
      }
      if (statement.startsWith("SELECT * FROM health_platform.referral_delivery_outbox WHERE (")) {
        const at = Date.parse(params[0]);
        const rows = [...events.values()].filter((row) => (
          (row.status === "pending" && Date.parse(row.next_attempt_at) <= at)
          || (row.status === "leased" && Date.parse(row.lease_expires_at) <= at)
        )).slice(0, params[1]);
        return { rowCount: rows.length, rows: structuredClone(rows) };
      }
      if (statement.startsWith("UPDATE health_platform.referral_delivery_outbox SET status = 'leased'")) {
        const row = events.get(params[0]);
        if (!row || row.lease_version !== params[6]) return { rowCount: 0, rows: [] };
        Object.assign(row, {
          status: "leased", attempts: row.attempts + 1, next_attempt_at: null,
          lease_owner: params[1], lease_token_sha256: params[2], lease_version: params[3],
          lease_expires_at: params[4], updated_at: params[5]
        });
        return { rowCount: 1, rows: [{ event_id: row.event_id }] };
      }
      if (statement.startsWith("UPDATE health_platform.referral_delivery_outbox SET status = 'dead-letter'")) {
        const row = events.get(params[0]);
        Object.assign(row, {
          status: "dead-letter", lease_owner: null, lease_token_sha256: null,
          lease_expires_at: null, dead_lettered_at: params[1],
          last_error_code: "DELIVERY_LEASE_EXPIRED", last_error_sha256: params[2], updated_at: params[1]
        });
        return { rowCount: 1, rows: [] };
      }
      if (statement.startsWith("UPDATE health_platform.referral_delivery_outbox SET status = 'delivered'")) {
        const row = events.get(params[0]);
        Object.assign(row, {
          status: "delivered", lease_owner: null, lease_token_sha256: null, lease_expires_at: null,
          ack_lease_token_sha256: params[1], receipt: JSON.parse(params[2]),
          receipt_sha256: params[3], delivered_at: params[4], updated_at: params[4],
          last_error_code: null, last_error_sha256: null
        });
        return { rowCount: 1, rows: [] };
      }
      if (statement.startsWith("UPDATE health_platform.referral_delivery_outbox SET status = $2")) {
        const row = events.get(params[0]);
        Object.assign(row, {
          status: params[1], next_attempt_at: params[2], lease_owner: null,
          lease_token_sha256: null, lease_expires_at: null, dead_lettered_at: params[3],
          last_error_code: params[4], last_error_sha256: params[5], updated_at: params[6]
        });
        return { rowCount: 1, rows: [] };
      }
      if (statement.startsWith("SELECT * FROM health_platform.referral_delivery_replays")) {
        const row = replays.get(params[0]);
        return { rowCount: row ? 1 : 0, rows: row ? [structuredClone(row)] : [] };
      }
      if (statement.startsWith("UPDATE health_platform.referral_delivery_outbox SET status = 'pending'")) {
        const row = events.get(params[0]);
        Object.assign(row, {
          status: "pending", attempts: 0, next_attempt_at: params[1], lease_owner: null,
          lease_token_sha256: null, lease_expires_at: null, lease_version: params[2],
          dead_lettered_at: null, last_error_code: null, last_error_sha256: null,
          replay_count: row.replay_count + 1, updated_at: params[1]
        });
        return { rowCount: 1, rows: [] };
      }
      if (statement.startsWith("INSERT INTO health_platform.referral_delivery_replays")) {
        replays.set(params[0], {
          replay_key_sha256: params[0], event_id: params[1], intent_sha256: params[2],
          result: JSON.parse(params[3]), result_sha256: params[4],
          requested_by: params[5], requested_at: params[6]
        });
        return { rowCount: 1, rows: [] };
      }
      if (statement.startsWith("SELECT status, count(*)::integer AS count")) {
        const counts = {};
        for (const row of events.values()) counts[row.status] = (counts[row.status] || 0) + 1;
        return { rowCount: Object.keys(counts).length, rows: Object.entries(counts).map(([status, count]) => ({ status, count })) };
      }
      if (statement.startsWith("SELECT event_id, event_type, status")) {
        const rows = [...events.values()].slice(0, params[0]).map((row) => {
          const { payload, payload_sha256, lease_token_sha256, ack_lease_token_sha256, receipt, receipt_sha256, ...safe } = row;
          return safe;
        });
        return { rowCount: rows.length, rows: structuredClone(rows) };
      }
      throw new Error(`unexpected query: ${statement}`);
    },
    release() { queries.push({ sql: "RELEASE", params: [] }); }
  };
  return {
    events,
    queries,
    replays,
    pool: { async connect() { return client; } }
  };
}

function repository(fake, options = {}) {
  return createReferralDeliveryPostgresRepository({
    pool: fake.pool,
    testBypassEvidenceGate: true,
    ...options
  });
}

function event(payload = { contract: { referralId: "rf1", residentId: "r1", status: "accepted" } }) {
  return {
    id: "referral-event-001",
    type: "care-coordination.referral-updated.v1",
    contractId: "referral-order.v1",
    aggregateVersion: 2,
    correlationId: "trace-referral-001",
    occurredAt: "2026-08-04T01:00:00.000Z",
    payload
  };
}

test("additive migration and PostgreSQL configuration remain evidence gated and non-primary", () => {
  const sql = fs.readFileSync(MIGRATION_FILE, "utf8");
  assert.match(sql, /referral_delivery_outbox/);
  assert.match(sql, /referral_delivery_replays/);
  assert.match(sql, /lease_version/);
  assert.match(sql, /payload_sha256/);
  assert.doesNotMatch(sql, /\b(?:DROP|TRUNCATE|DELETE)\b/i);

  const config = buildReferralDeliveryPostgresConfig({
    REFERRAL_DELIVERY_POSTGRES_MODE: "evidence-gated",
    DATABASE_URL: "postgresql://user:secret@db.example/referral",
    POSTGRES_SSL_MODE: "verify-full",
    REFERRAL_DELIVERY_MIGRATION_EVIDENCE_ID: "migration-001",
    REFERRAL_DELIVERY_BACKUP_EVIDENCE_ID: "backup-001",
    REFERRAL_DELIVERY_RECOVERY_EVIDENCE_ID: "recovery-001",
    REFERRAL_DELIVERY_CUTOVER_APPROVAL_ID: "cutover-001"
  });
  assert.equal(config.writeEnabled, true);
  assert.equal(config.productionReady, false);
  assert.equal(config.centralCutover, false);
  assert.doesNotMatch(JSON.stringify(config), /user:secret|DATABASE_URL/);
});

test("enqueue is durable and idempotent while payload digest drift conflicts", async () => {
  const fake = createFakePool();
  const repo = repository(fake);
  const first = await repo.enqueue(event());
  const replay = await repo.enqueue(event());
  assert.equal(first.idempotentReplay, false);
  assert.equal(replay.idempotentReplay, true);
  assert.match(fake.events.get("referral-event-001").payload_sha256, /^sha256:[a-f0-9]{64}$/);
  assert.equal(fake.queries.some((item) => /ON CONFLICT \(event_id\) DO NOTHING/.test(item.sql)), true);
  await assert.rejects(
    () => repo.enqueue(event({ contract: { referralId: "rf1", status: "cancelled" } })),
    (error) => error.code === "REFERRAL_DELIVERY_ENQUEUE_CONFLICT" && error.statusCode === 409
  );
  assert.equal(fake.queries.some((item) => /BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE/.test(item.sql)), true);
});

test("claim uses row locking and lease versions, stale workers cannot acknowledge, and exact ack is idempotent", async () => {
  const fake = createFakePool();
  const repo = repository(fake);
  await repo.enqueue(event());
  const [oldClaim] = await repo.claim({
    workerId: "worker-old",
    now: "2026-08-04T01:00:01.000Z",
    leaseMs: 1000
  });
  const persisted = fake.events.get(oldClaim.id);
  assert.notEqual(persisted.lease_token_sha256, oldClaim.leaseToken);
  assert.equal(persisted.lease_token_sha256, sha256(oldClaim.leaseToken));
  assert.equal(fake.queries.some((item) => /FOR UPDATE SKIP LOCKED/.test(item.sql)), true);

  const [newClaim] = await repo.claim({
    workerId: "worker-new",
    now: "2026-08-04T01:00:03.000Z",
    leaseMs: 10000
  });
  assert.equal(newClaim.leaseVersion, oldClaim.leaseVersion + 1);
  const receipt = {
    eventId: newClaim.id,
    payloadDigest: newClaim.payloadDigest,
    providerMessageId: "provider-001",
    status: "accepted",
    occurredAt: "2026-08-04T01:00:04.000Z",
    signatureDigest: sha256("provider-receipt-signature"),
    signatureVerified: true
  };
  await assert.rejects(
    () => repo.acknowledge(oldClaim.id, {
      workerId: "worker-old", leaseToken: oldClaim.leaseToken, leaseVersion: oldClaim.leaseVersion,
      receipt, acknowledgedAt: "2026-08-04T01:00:04.000Z"
    }),
    (error) => error.code === "REFERRAL_DELIVERY_LEASE_STALE"
  );
  const acknowledged = await repo.acknowledge(newClaim.id, {
    workerId: "worker-new", leaseToken: newClaim.leaseToken, leaseVersion: newClaim.leaseVersion,
    receipt, acknowledgedAt: "2026-08-04T01:00:04.000Z"
  });
  assert.equal(acknowledged.idempotentReplay, false);
  const exactReplay = await repo.acknowledge(newClaim.id, {
    workerId: "worker-new", leaseToken: newClaim.leaseToken, leaseVersion: newClaim.leaseVersion,
    receipt, acknowledgedAt: "2026-08-04T01:00:05.000Z"
  });
  assert.equal(exactReplay.idempotentReplay, true);
  await assert.rejects(
    () => repo.acknowledge(newClaim.id, {
      workerId: "worker-new", leaseToken: newClaim.leaseToken, leaseVersion: newClaim.leaseVersion,
      receipt: { ...receipt, providerMessageId: "provider-drift" },
      acknowledgedAt: "2026-08-04T01:00:05.000Z"
    }),
    (error) => error.code === "REFERRAL_DELIVERY_ACK_CONFLICT"
  );
});

test("retry, dead letter and digest-key replay persist no raw errors or idempotency keys", async () => {
  const fake = createFakePool();
  const repo = repository(fake, { maxAttempts: 2, retryBaseMs: 1000 });
  await repo.enqueue(event());
  const [first] = await repo.claim({ workerId: "worker-a", now: "2026-08-04T01:00:01.000Z" });
  await repo.fail(first.id, {
    workerId: "worker-a", leaseToken: first.leaseToken, leaseVersion: first.leaseVersion,
    errorCode: "TRANSPORT_TIMEOUT", errorMessage: "private provider failure detail",
    failedAt: "2026-08-04T01:00:02.000Z"
  });
  assert.equal(fake.events.get(first.id).status, "pending");
  assert.equal(fake.events.get(first.id).last_error_sha256, sha256("private provider failure detail"));
  assert.doesNotMatch(JSON.stringify(fake.events.get(first.id)), /private provider failure detail/);

  const [second] = await repo.claim({ workerId: "worker-b", now: "2026-08-04T01:00:04.000Z" });
  await repo.fail(second.id, {
    workerId: "worker-b", leaseToken: second.leaseToken, leaseVersion: second.leaseVersion,
    errorCode: "PROVIDER_REJECTED", errorMessage: "second private detail",
    failedAt: "2026-08-04T01:00:05.000Z"
  });
  assert.equal(fake.events.get(second.id).status, "dead-letter");

  const replay = await repo.replayDeadLetter({
    eventId: second.id,
    replayKey: "commission-secret-replay-key",
    reason: "approved after provider recovery",
    actorRole: "commission",
    requestedBy: "commission",
    requestedAt: "2026-08-04T01:00:06.000Z"
  });
  assert.equal(replay.idempotentReplay, false);
  assert.equal(replay.event.status, "pending");
  assert.equal(fake.replays.size, 1);
  assert.doesNotMatch(JSON.stringify([...fake.replays.values()]), /commission-secret-replay-key|approved after provider recovery/);

  const [claimAfterReplay] = await repo.claim({ workerId: "worker-c", now: "2026-08-04T01:00:07.000Z" });
  assert.equal(claimAfterReplay.id, second.id);
  const replayAgain = await repo.replayDeadLetter({
    eventId: second.id,
    replayKey: "commission-secret-replay-key",
    reason: "approved after provider recovery",
    actorRole: "commission",
    requestedBy: "commission",
    requestedAt: "2026-08-04T01:00:08.000Z"
  });
  assert.equal(replayAgain.idempotentReplay, true);
  assert.equal(replayAgain.event.status, "pending");
  await assert.rejects(
    () => repo.replayDeadLetter({
      eventId: second.id,
      replayKey: "institution-replay-key",
      reason: "attempted by an unauthorized operator",
      actorRole: "institution",
      requestedBy: "institution",
      requestedAt: "2026-08-04T01:00:09.000Z"
    }),
    (error) => error.code === "REFERRAL_DELIVERY_REPLAY_FORBIDDEN" && error.statusCode === 403
  );
});

test("operations expose only minimal metadata and never payload or lease material", async () => {
  const fake = createFakePool();
  const repo = repository(fake);
  await repo.enqueue(event());
  await repo.claim({ workerId: "worker-private", now: "2026-08-04T01:00:01.000Z" });
  const operations = await repo.operations();
  assert.equal(operations.productionReady, false);
  assert.equal(operations.events.length, 1);
  assert.equal("payload" in operations.events[0], false);
  assert.equal("leaseToken" in operations.events[0], false);
  assert.equal("leaseTokenDigest" in operations.events[0], false);
  assert.doesNotMatch(JSON.stringify(operations), /residentId|worker-private|lease_token|payload/);
});
