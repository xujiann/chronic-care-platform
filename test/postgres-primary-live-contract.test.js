"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createFixture } = require("./helpers/postgres-primary-live-fixture");

const writeTx = { isolation: "serializable", readOnly: false };
const readTx = { isolation: "repeatable-read", readOnly: true };
function source(f, revision = 1) {
  return f.commitBatch([["dataQualityIssues", [{ id: "synthetic-only", revision }]], ["settings", { revision }]],
    { dataQualityIssues: revision - 1, settings: revision - 1 });
}
function ledger(item) {
  return { batchId: item.batch.batchId, payloadSha256: item.batch.payloadSha256,
    previousChainHash: item.batch.previousChainHash, chainHash: item.batch.chainHash,
    committedAt: item.commitment.committedAt, sourceTransactionId: item.commitment.sourceTransactionId,
    outboxSequence: item.commitment.outboxSequence, appliedChanges: 2 };
}

test("live primary applies actual SQLite v1/v2 receipts and exact replay preserves all SQL rows", { timeout: 60000 }, async (t) => {
  const f = await createFixture(t); if (!f) return;
  const contract = f.createContract();
  assert.equal(f.createDriver().status().tlsVerifyFull, false);
  for (const revision of [1, 2]) {
    const item = source(f, revision);
    const result = await contract.applyCommittedOutbox(item.batch, { commitment: item.commitment });
    assert.equal(result.appliedChanges, 2);
    assert.equal(result.productionPrimary, false);
    const before = await f.rawSnapshot();
    assert.equal(before.batches.length, revision);
    assert.deepEqual(before.collections.map((row) => row.source_version), [String(revision), String(revision)]);
    assert.equal((await contract.applyCommittedOutbox(item.batch, { commitment: item.commitment })).status, "duplicate");
    assert.deepEqual(await f.rawSnapshot(), before);
  }
});

const drifts = {
  batch_id: "pgsync-" + "a".repeat(32), payload_sha256: "b".repeat(64),
  previous_chain_hash: "c".repeat(64), chain_hash: "d".repeat(64),
  source_transaction_id: "00000000-0000-4000-8000-000000000002",
  outbox_sequence: "2", committed_at: "2026-01-01T00:00:00.000Z"
};
for (const [field, value] of Object.entries(drifts)) {
  test(`live primary ${field} evidence drift rejects replay without SQL writes`, { timeout: 60000 }, async (t) => {
    const f = await createFixture(t); if (!f) return;
    const item = source(f), contract = f.createContract();
    await contract.applyCommittedOutbox(item.batch, { commitment: item.commitment });
    const client = await f.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`UPDATE health_platform.primary_storage_batches SET ${field}=$1`, [value]);
      if (field === "batch_id") await client.query("UPDATE health_platform.primary_collection_state SET batch_id=$1", [value]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    const before = await f.rawSnapshot();
    // A changed primary key is no longer addressable as the old batch; the
    // continuation check must still reject it, never accept it as a duplicate.
    await assert.rejects(() => contract.applyCommittedOutbox(item.batch, { commitment: item.commitment }),
      { code: field === "batch_id" ? "POSTGRES_PRIMARY_OUTBOX_CHAIN_CONFLICT" : "POSTGRES_PRIMARY_IDEMPOTENCY_CONFLICT" });
    assert.deepEqual(await f.rawSnapshot(), before);
  });
}

const corruptions = {
  era: "NEW.committed_at := '0001-01-01 00:00:00 BC'::timestamptz;",
  microseconds: "NEW.committed_at := '2026-01-01 00:00:00.000001+00'::timestamptz;",
  bigint: "NEW.outbox_sequence := 9007199254740993;"
};
for (const [kind, assignment] of Object.entries(corruptions)) {
  for (const route of ["getAppliedBatch", "getLastAppliedBatch", "recordAppliedBatch"]) {
    test(`live primary ${route} rejects lossy ${kind} evidence`, { timeout: 60000 }, async (t) => {
      const f = await createFixture(t); if (!f) return;
      const item = source(f), driver = f.createDriver();
      await f.pool.query(`CREATE FUNCTION health_platform.corrupt_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN ${assignment} RETURN NEW; END $$;
        CREATE TRIGGER corrupt_receipt BEFORE INSERT ON health_platform.primary_storage_batches
        FOR EACH ROW EXECUTE FUNCTION health_platform.corrupt_receipt()`);
      if (route !== "recordAppliedBatch") {
        const row = ledger(item);
        await f.pool.query(`INSERT INTO health_platform.primary_storage_batches
          (batch_id,payload_sha256,previous_chain_hash,chain_hash,committed_at,source_transaction_id,outbox_sequence,applied_changes)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, Object.values(row));
      }
      const before = await f.rawSnapshot();
      await assert.rejects(() => driver.transaction(route === "recordAppliedBatch" ? writeTx : readTx, (tx) => {
        if (route === "getAppliedBatch") return tx.getAppliedBatch(item.batch.batchId);
        if (route === "getLastAppliedBatch") return tx.getLastAppliedBatch();
        return tx.recordAppliedBatch(ledger(item));
      }), { code: "INVALID_POSTGRES_PRIMARY_BATCH_RECEIPT" });
      assert.deepEqual(await f.rawSnapshot(), before);
    });
  }
}

for (const fault of ["collection", "ledger", "commit-fk"]) {
  test(`live primary ${fault} failure rolls back the whole real transaction`, { timeout: 60000 }, async (t) => {
    const f = await createFixture(t); if (!f) return;
    const item = source(f), contract = f.createContract();
    if (fault === "commit-fk") {
      await f.pool.query(`CREATE FUNCTION health_platform.break_fk() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN NEW.batch_id := 'pgsync-ffffffffffffffffffffffffffffffff'; RETURN NEW; END $$;
        CREATE TRIGGER break_fk BEFORE INSERT ON health_platform.primary_collection_state
        FOR EACH ROW EXECUTE FUNCTION health_platform.break_fk()`);
    } else {
      const table = fault === "collection" ? "primary_collection_state" : "primary_storage_batches";
      const condition = fault === "collection" ? "IF NEW.collection_name = 'settings' THEN RAISE EXCEPTION 'synthetic-fault'; END IF;" : "RAISE EXCEPTION 'synthetic-fault';";
      await f.pool.query(`CREATE FUNCTION health_platform.fail_write() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN ${condition} RETURN NEW; END $$;
        CREATE TRIGGER fail_write BEFORE INSERT ON health_platform.${table}
        FOR EACH ROW EXECUTE FUNCTION health_platform.fail_write()`);
    }
    const before = await f.rawSnapshot();
    await assert.rejects(() => contract.applyCommittedOutbox(item.batch, { commitment: item.commitment }),
      (error) => error.code === (fault === "commit-fk" ? "23503" : "P0001"));
    assert.deepEqual(await f.rawSnapshot(), before);
    const table = fault === "ledger" ? "primary_storage_batches" : "primary_collection_state";
    await f.pool.query(`DROP TRIGGER ${fault === "commit-fk" ? "break_fk" : "fail_write"} ON health_platform.${table}`);
    assert.equal((await contract.applyCommittedOutbox(item.batch, { commitment: item.commitment })).status, "applied");
  });
}
