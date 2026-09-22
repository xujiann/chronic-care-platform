"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { setTimeout: pause } = require("node:timers/promises");
const { createHash } = require("node:crypto");
const { ADVISORY_LOCK_NAME } = require("../src/platform/storage/postgres-primary-driver");
const { canonicalStringify } = require("../scripts/postgres-migration-package");
const { createFixture } = require("./helpers/postgres-primary-live-fixture");

const settle = (promise) => promise.then((value) => ({ status: "fulfilled", value }), (reason) => ({ status: "rejected", reason }));
const applyOptions = (commitment) => ({ executionContext: "worker", commitment });

// Four actual pools: two writers, one held transaction, and an independent observer.
// Polling is bounded and succeeds only on server-reported overlapping lock waits.
async function overlappingWriters(fixture, operations) {
  const pools = [fixture.newPool(), fixture.newPool()];
  const blockerPool = fixture.newPool(), observerPool = fixture.newPool();
  const pids = await Promise.all(pools.map((pool) => fixture.backendPid(pool)));
  const blocker = await blockerPool.connect();
  let pending = [];
  let released = false;
  try {
    const blockerPid = (await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const observerPid = await fixture.backendPid(observerPool);
    assert.equal(new Set([...pids, blockerPid, observerPid]).size, 4);
    await blocker.query("BEGIN");
    await blocker.query("SELECT pg_advisory_xact_lock(hashtext($1))", [ADVISORY_LOCK_NAME]);
    pending = operations.map((operation, index) => settle(operation(pools[index])));
    const deadline = Date.now() + 4000;
    let observed = false;
    while (Date.now() < deadline) {
      const result = await observerPool.query(`SELECT pid, wait_event_type, wait_event, pg_blocking_pids(pid) AS blockers
        FROM pg_stat_activity WHERE datname = current_database() AND pid = ANY($1::int[])`, [pids]);
      if (result.rows.length === 2 && result.rows.every((row) => row.wait_event_type === "Lock"
        && row.wait_event === "advisory" && row.blockers.length > 0)) {
        observed = true;
        break;
      }
      await pause(20);
    }
    assert.equal(observed, true, "both distinct writer backends must simultaneously wait for the real advisory lock");
    await blocker.query("COMMIT");
    released = true;
    return { outcomes: await Promise.all(pending), pools, pids };
  } finally {
    if (!released) await blocker.query("ROLLBACK").catch(() => {});
    blocker.release();
    // Server-side statement/lock deadlines bound these waits even on assertion failure.
    await Promise.all(pending);
  }
}

test("live primary independent backends overlap one receipt and explicit serialization retry yields one ledger", { timeout: 45000 }, async (t) => {
  const f = await createFixture(t);
  if (!f) return;
  const { batch, commitment } = f.commitBatch([["settings", { synthetic: "duplicate" }]], { settings: 0 });
  const operation = (pool) => f.createContract(pool).applyCommittedOutbox(batch, applyOptions(commitment));
  const { outcomes, pools } = await overlappingWriters(f, [operation, operation]);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled" && outcome.value.status === "applied").length, 1);
  for (const [index, outcome] of outcomes.entries()) {
    if (outcome.status === "rejected") {
      assert.equal(outcome.reason.code, "40001", "only a real serialization abort permits this explicit test retry");
      const retried = await operation(pools[index]);
      assert.equal(retried.status, "duplicate");
    } else assert.ok(["applied", "duplicate"].includes(outcome.value.status));
  }
  const counts = await f.pool.query(`SELECT
    (SELECT count(*)::int FROM health_platform.primary_storage_batches) AS batches,
    (SELECT count(*)::int FROM health_platform.primary_collection_state) AS collections`);
  assert.deepEqual(counts.rows[0], { batches: 1, collections: 1 });
  const stored = await f.pool.query("SELECT source_transaction_id,outbox_sequence::text FROM health_platform.primary_storage_batches");
  assert.equal(stored.rows[0].source_transaction_id, commitment.sourceTransactionId);
  assert.equal(stored.rows[0].outbox_sequence, String(commitment.outboxSequence));
  const before = await f.rawSnapshot();
  assert.equal((await operation(pools[0])).status, "duplicate");
  assert.deepEqual(await f.rawSnapshot(), before);
});

test("live primary low-level CAS serializes competing payloads without claiming two valid source chains", { timeout: 45000 }, async (t) => {
  const f = await createFixture(t);
  if (!f) return;
  const original = f.commitBatch([["settings", { synthetic: "baseline" }]], { settings: 0 });
  await f.createContract().applyCommittedOutbox(original.batch, applyOptions(original.commitment));
  const operations = ["left", "right"].map((winner) => (pool) => {
    const payload = canonicalStringify({ synthetic: winner });
    return f.createDriver(pool).transaction({ isolation: "serializable", readOnly: false }, (tx) => tx.applyCollectionChange({
      collection: "settings", operation: "upsert", sourceVersion: 2, payload,
      payloadSha256: createHash("sha256").update(payload).digest("hex")
    }, { expectedVersion: 1, batchId: original.batch.batchId, appliedAt: "2026-09-22T00:00:00.000Z" }));
  });
  const { outcomes, pools } = await overlappingWriters(f, operations);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  const winner = outcomes.findIndex((outcome) => outcome.status === "fulfilled");
  const loser = 1 - winner;
  assert.ok(["40001", "POSTGRES_PRIMARY_DATABASE_CAS_CONFLICT"].includes(outcomes[loser].reason.code));
  const beforeRetry = await f.rawSnapshot();
  if (outcomes[loser].reason.code === "40001") {
    await assert.rejects(operations[loser](pools[loser]), { code: "POSTGRES_PRIMARY_DATABASE_CAS_CONFLICT" });
  }
  assert.deepEqual(await f.rawSnapshot(), beforeRetry);
  const rows = await f.pool.query("SELECT payload,source_version::text FROM health_platform.primary_collection_state WHERE collection_name='settings'");
  assert.deepEqual(rows.rows[0], { payload: { synthetic: winner === 0 ? "left" : "right" }, source_version: "2" });
  assert.equal((await f.pool.query("SELECT count(*)::int AS n FROM health_platform.primary_storage_batches")).rows[0].n, 1);
});

test("live primary transaction failure rolls back partial collections and ledger and releases its lock", { timeout: 45000 }, async (t) => {
  const f = await createFixture(t);
  if (!f) return;
  const proof = f.commitBatch([["settings", { synthetic: "rollback" }], ["dataQualityIssues", []]], { settings: 0, dataQualityIssues: 0 });
  const before = await f.rawSnapshot();
  const driver = f.createDriver(f.newPool());
  await assert.rejects(driver.transaction({ isolation: "serializable", readOnly: false }, async (tx) => {
    for (const change of proof.batch.changes) await tx.applyCollectionChange(change,
      { expectedVersion: -1, batchId: proof.batch.batchId, appliedAt: "2026-09-22T00:00:00.000Z" });
    await tx.recordAppliedBatch({ batchId: proof.batch.batchId, payloadSha256: proof.batch.payloadSha256,
      previousChainHash: proof.batch.previousChainHash, chainHash: proof.batch.chainHash,
      sourceTransactionId: proof.commitment.sourceTransactionId, outboxSequence: proof.commitment.outboxSequence,
      committedAt: proof.commitment.committedAt, appliedChanges: proof.batch.changes.length });
    throw Object.assign(new Error("synthetic failure after all writes before commit"), { code: "LIVE_TEST_ROLLBACK" });
  }), { code: "LIVE_TEST_ROLLBACK" });
  assert.deepEqual(await f.rawSnapshot(), before);
  const otherPool = f.newPool();
  const lock = await otherPool.query("SELECT pg_try_advisory_xact_lock(hashtext($1)) AS acquired", [ADVISORY_LOCK_NAME]);
  assert.equal(lock.rows[0].acquired, true, "failed writer must release its transaction lock");
  assert.equal((await f.createContract(otherPool).applyCommittedOutbox(proof.batch, applyOptions(proof.commitment))).status, "applied");
  assert.equal((await f.pool.query("SELECT count(*)::int AS n FROM health_platform.primary_storage_batches")).rows[0].n, 1);
  assert.equal((await f.pool.query("SELECT count(*)::int AS n FROM health_platform.primary_collection_state")).rows[0].n, 2);
});
