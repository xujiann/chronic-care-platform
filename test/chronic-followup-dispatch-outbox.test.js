"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { applySqliteMigrations } = require("../src/platform/storage/sqlite-migrations");
const {
  appendFollowupDispatchOutboxChanges,
  createSqliteFollowupDispatchRepository,
  sha256
} = require("../src/citizen-chronic/followup-dispatch-outbox");
const { runFollowupDispatchWorker } = require("../src/citizen-chronic/followup-dispatch-worker");

const T0 = "2026-08-22T01:00:00.000Z";
const T1 = "2026-08-22T01:00:30.000Z";
const T2 = "2026-08-22T01:01:00.000Z";

function event(overrides = {}) {
  return {
    id: "citizen-chronic:followup-001:1",
    type: "citizen-chronic.followup-updated.v1",
    aggregateId: "followup-001",
    aggregateVersion: 1,
    correlationId: "correlation-001",
    occurredAt: T0,
    payload: { followupId: "followup-001", status: "completed", updatedAt: T0, version: 1 },
    deliveryState: "pending",
    attempts: 0,
    ...overrides
  };
}

function state(candidate = event()) {
  return { followups: [{ id: candidate.aggregateId, domainRuntime: { outbox: [candidate] } }] };
}

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  applySqliteMigrations(db);
  return db;
}

test("v16 hook enqueues atomically, is idempotent, and rejects immutable event drift", () => {
  const db = database();
  try {
    db.exec("BEGIN");
    appendFollowupDispatchOutboxChanges(db, { followups: [] }, state(), { recordedAt: T0 });
    db.prepare("INSERT INTO state_collections (key, payload, updated_at, version) VALUES ('followups', ?, ?, 1)")
      .run(JSON.stringify(state().followups), T0);
    db.exec("COMMIT");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM chronic_followup_dispatch_outbox").get().count, 1);

    appendFollowupDispatchOutboxChanges(db, state(), state(), { recordedAt: T1 });
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM chronic_followup_dispatch_outbox").get().count, 1);
    assert.throws(
      () => appendFollowupDispatchOutboxChanges(db, state(), state(event({ payload: { followupId: "followup-001", status: "drift", updatedAt: T0, version: 1 } })), { recordedAt: T1 }),
      (error) => error.code === "FOLLOWUP_DISPATCH_EVENT_ID_CONFLICT"
    );

    db.exec("BEGIN");
    appendFollowupDispatchOutboxChanges(db, state(), state(event({ id: "citizen-chronic:followup-001:2", aggregateVersion: 2, payload: { followupId: "followup-001", status: "reviewed", updatedAt: T1, version: 2 } })), { recordedAt: T1 });
    db.exec("ROLLBACK");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM chronic_followup_dispatch_outbox").get().count, 1);
  } finally {
    db.close();
  }
});

test("v15 history upgrades through v17 without fabricating delivery evidence", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys = ON");
    applySqliteMigrations(db, { targetVersion: 15 });
    const legacyPublished = event({ deliveryState: "published", publishedAt: T0, receiptDigest: "" });
    db.prepare("INSERT INTO state_collections (key, payload, updated_at, version) VALUES ('followups', ?, ?, 1)")
      .run(JSON.stringify(state(legacyPublished).followups), T0);
    const upgraded = applySqliteMigrations(db);
    const row = db.prepare("SELECT status, receipt_sha256 FROM chronic_followup_dispatch_outbox WHERE event_id = ?").get(legacyPublished.id);
    assert.equal(upgraded.applied, 2);
    assert.equal(row.status, "pending");
    assert.equal(row.receipt_sha256, null);
    assert.equal(applySqliteMigrations(db).applied, 0);
  } finally {
    db.close();
  }
});

test("leases use token hashes and versions, fence stale workers, and dead-letter after bounded retry", () => {
  const db = database();
  try {
    let current = new Date(T0);
    let token = 0;
    const repository = createSqliteFollowupDispatchRepository(db, {
      now: () => current,
      tokenFactory: () => `private-token-${++token}`
    });
    repository.enqueue(event(), { recordedAt: T0 });
    const first = repository.claimBatch({ workerId: "worker-a", leaseSeconds: 10 })[0];
    assert.equal(first.leaseVersion, 1);
    const persisted = db.prepare("SELECT lease_token_sha256 FROM chronic_followup_dispatch_outbox WHERE event_id = ?").get(first.eventId);
    assert.equal(persisted.lease_token_sha256, sha256(first.leaseToken));
    assert.doesNotMatch(persisted.lease_token_sha256, /private-token/);

    current = new Date(T1);
    const second = repository.claimBatch({ workerId: "worker-b", leaseSeconds: 10 })[0];
    assert.equal(second.leaseVersion, 2);
    assert.throws(
      () => repository.markDelivered({ eventId: first.eventId, workerId: "worker-a", leaseToken: first.leaseToken, leaseVersion: 1, receiptDigest: sha256("receipt") }),
      (error) => error.code === "FOLLOWUP_DISPATCH_STALE_LEASE"
    );
    let failed = repository.markFailed({ eventId: second.eventId, workerId: "worker-b", leaseToken: second.leaseToken, leaseVersion: 2, errorCode: "provider timeout", failedAt: T1, baseBackoffSeconds: 1 });
    assert.equal(failed.status, "pending");
    assert.equal(failed.lastErrorCode, "PROVIDER_TIMEOUT");
    assert.doesNotMatch(JSON.stringify(failed), /private-token|provider timeout/i);

    for (let attempt = 3; attempt <= 5; attempt += 1) {
      current = new Date(Date.parse(T1) + attempt * 10_000);
      const claim = repository.claimBatch({ workerId: "worker-b", leaseSeconds: 10 })[0];
      failed = repository.markFailed({ eventId: claim.eventId, workerId: "worker-b", leaseToken: claim.leaseToken, leaseVersion: claim.leaseVersion, errorCode: "UPSTREAM_UNAVAILABLE", baseBackoffSeconds: 1 });
    }
    assert.equal(failed.status, "dead-letter");
    assert.equal(failed.attempts, 5);
  } finally {
    db.close();
  }
});

test("manual replay is digest-only, idempotent, auditable, and fences the old lease generation", () => {
  const db = database();
  try {
    let current = new Date(T0);
    const repository = createSqliteFollowupDispatchRepository(db, { now: () => current, tokenFactory: () => "lease-token" });
    repository.enqueue(event(), { recordedAt: T0 });
    db.prepare("UPDATE chronic_followup_dispatch_outbox SET max_attempts = 1 WHERE event_id = ?").run(event().id);
    const claim = repository.claimBatch({ workerId: "worker-a", leaseSeconds: 30 })[0];
    const dead = repository.markFailed({ eventId: claim.eventId, workerId: "worker-a", leaseToken: claim.leaseToken, leaseVersion: claim.leaseVersion, errorCode: "PERMANENT_REJECTION" });
    assert.equal(dead.status, "dead-letter");
    const replayInput = {
      eventId: dead.eventId,
      replayKeyDigest: sha256("replay-001"),
      actorDigest: sha256("commission-operator"),
      reasonDigest: sha256("approved-remediation")
    };
    const replayed = repository.replayDeadLetter(replayInput);
    const repeated = repository.replayDeadLetter(replayInput);
    assert.equal(replayed.idempotent, false);
    assert.equal(repeated.idempotent, true);
    assert.equal(replayed.event.status, "pending");
    assert.equal(replayed.event.leaseVersion, 2);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM chronic_followup_dispatch_replays").get().count, 1);
    assert.doesNotMatch(JSON.stringify(db.prepare("SELECT * FROM chronic_followup_dispatch_replays").all()), /commission-operator|approved-remediation/);
    assert.throws(() => repository.replayDeadLetter({ ...replayInput, reasonDigest: sha256("different") }), (error) => error.code === "FOLLOWUP_DISPATCH_REPLAY_KEY_CONFLICT");
  } finally {
    db.close();
  }
});

test("worker publishes outside request flow and persists only minimized receipt and error digests", async () => {
  const db = database();
  try {
    const repository = createSqliteFollowupDispatchRepository(db, { now: () => new Date(T2), tokenFactory: () => "worker-secret-token" });
    repository.enqueue(event(), { recordedAt: T0 });
    const published = [];
    const report = await runFollowupDispatchWorker({
      repository,
      env: { NODE_ENV: "test" },
      workerId: "worker-a",
      publisher: {
        async publish(envelope) {
          published.push(envelope);
          return { accepted: true, receiptId: "provider-receipt-private", status: "accepted" };
        }
      }
    });
    assert.equal(report.delivered, 1);
    assert.equal(published.length, 1);
    const raw = db.prepare("SELECT * FROM chronic_followup_dispatch_outbox").get();
    assert.equal(raw.status, "delivered");
    assert.match(raw.receipt_sha256, /^sha256:[a-f0-9]{64}$/);
    assert.doesNotMatch(JSON.stringify(raw), /provider-receipt-private|worker-secret-token/);
    assert.equal(report.productionReady, false);
    assert.equal(report.requestPathExternalDispatch, false);
  } finally {
    db.close();
  }
});

test("worker fences a stale completion and continues processing later claims", async () => {
  const claims = [event({ id: "followup-event-stale" }), event({ id: "followup-event-next" })]
    .map((item, index) => ({
      ...item,
      eventId: item.id,
      eventType: item.type,
      eventVersion: 1,
      payloadDigest: sha256(item.payload),
      leaseToken: `lease-token-${index}`,
      leaseVersion: 1,
      attempts: 1
    }));
  const completed = [];
  let failureWrites = 0;
  const repository = {
    claimBatch: () => claims,
    markDelivered(input) {
      if (input.eventId === "followup-event-stale") {
        const error = new Error("private stale lease detail");
        error.code = "FOLLOWUP_DISPATCH_STALE_LEASE";
        throw error;
      }
      completed.push(input.eventId);
      return { status: "delivered", attempts: 1 };
    },
    markFailed() {
      failureWrites += 1;
      throw new Error("markFailed must not follow an accepted external receipt");
    },
    health: () => ({ healthy: true })
  };
  const report = await runFollowupDispatchWorker({
    repository,
    env: { NODE_ENV: "test" },
    workerId: "worker-a",
    publisher: {
      async publish(envelope) {
        return { accepted: true, receiptId: `receipt:${envelope.eventId}`, status: "accepted" };
      }
    }
  });
  assert.equal(report.claimed, 2);
  assert.equal(report.delivered, 1);
  assert.equal(report.persistenceRejected, 1);
  assert.deepEqual(completed, ["followup-event-next"]);
  assert.equal(failureWrites, 0);
  assert.deepEqual(report.outcomes.map((item) => item.status), ["persistence-rejected", "delivered"]);
  assert.equal(report.outcomes[0].persistenceOperation, "completion");
  assert.match(report.outcomes[0].errorDigest, /^sha256:[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(report), /private stale lease detail|lease-token-/);
});
