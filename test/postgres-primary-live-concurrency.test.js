"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createHash } = require("node:crypto");
const { canonicalStringify } = require("../scripts/postgres-migration-package");
const { createFixture, overlappingWriters } = require("./helpers/postgres-primary-live-fixture");

const applyOptions = (commitment) => ({ executionContext: "worker", commitment });

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
