"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { randomUUID } = require("node:crypto");
const { applySqliteMigrations } = require("../src/platform/storage/sqlite-migrations");
const { initializeSqliteOutboxSourceIdentity } = require("../src/platform/storage/sqlite-outbox-source-identity");
const { commitSqliteBoundOutboxTransaction } = require("../src/platform/storage/sqlite-outbox-commit-receipt");
const { createPrimarySingleBatchRelay } = require("../src/platform/storage/postgres-primary-single-batch-relay");
const { createPrimaryDurableCheckpoint } = require("../src/platform/storage/postgres-primary-durable-checkpoint");

const TARGET_ID = "a23b4567-89ab-4cde-8f01-23456789abcd";
const contractConfig = { mode: "shadow", modeReady: true, shadowReady: true,
  capabilities: { shadowApply: true, primaryWriteRelay: false } };

async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "primary-relay-"));
  const sourceFile = path.join(directory, "source.sqlite");
  const checkpointFile = path.join(directory, "checkpoint.sqlite");
  const db = new DatabaseSync(sourceFile);
  t.after(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  applySqliteMigrations(db);
  initializeSqliteOutboxSourceIdentity(db);
  for (let version = 1; version <= 2; version += 1) {
    commitSqliteBoundOutboxTransaction(db, { entries: [["settings", { synthetic: version }]],
      expectedVersions: { settings: version - 1 }, sourceEvent: "synthetic-relay" });
  }
  const batches = new Map();
  const collections = new Map();
  let failAfterTarget = false;
  const driver = {
    status: () => ({ supportsBoundIdentity: true }),
    async transaction(options, operation) {
      if (options.binding?.expectedTargetId !== TARGET_ID) throw Object.assign(new Error("wrong target"),
        { code: "POSTGRES_PRIMARY_IDENTITY_MISMATCH" });
      const tx = {
        getAppliedBatch: async (id) => batches.get(id) || null,
        getLastAppliedBatch: async () => [...batches.values()].at(-1) || null,
        getCollection: async (name) => collections.get(name) || null,
        listCollections: async () => [...collections.values()],
        applyCollectionChange: async (change, input) => {
          collections.set(change.collection, { collection: change.collection, sourceVersion: change.sourceVersion,
            payload: change.payload, payloadSha256: change.payloadSha256, batchId: input.batchId, deleted: false });
        },
        recordAppliedBatch: async (batch) => { batches.set(batch.batchId, batch); }
      };
      const result = await operation(tx);
      if (!options.readOnly && failAfterTarget) { failAfterTarget = false; throw new Error("synthetic-after-target-commit"); }
      return result;
    }
  };
  const options = { sourceFile, checkpointFile, driver, contractConfig, expectedTargetId: TARGET_ID };
  const checkpoint = createPrimaryDurableCheckpoint(options);
  return { options, checkpoint, batches, setCrash() { failAfterTarget = true; } };
}

test("single-batch relay replays a committed target and processes only one next batch", async (t) => {
  const f = await fixture(t);
  const relay = createPrimarySingleBatchRelay(f.options);
  await assert.rejects(relay.runOnce(), { code: "POSTGRES_PRIMARY_CHECKPOINT_MISSING" });
  await f.checkpoint.initialize();
  f.setCrash();
  await assert.rejects(relay.runOnce(), /synthetic-after-target-commit/);
  assert.equal(f.batches.size, 1);
  assert.equal(await f.checkpoint.read(), null);
  assert.deepEqual(await relay.runOnce(), { status: "duplicate", outboxSequence: 1 });
  assert.deepEqual(await relay.runOnce(), { status: "applied", outboxSequence: 2 });
  assert.deepEqual(await relay.runOnce(), { status: "idle", outboxSequence: 2 });
  assert.equal(f.batches.size, 2);
});

test("mismatched checkpoint target fails before writing a target batch", async (t) => {
  const f = await fixture(t);
  await f.checkpoint.initialize();
  const wrongTarget = createPrimarySingleBatchRelay({ ...f.options, expectedTargetId: randomUUID() });
  await assert.rejects(wrongTarget.runOnce(), { code: "POSTGRES_PRIMARY_CHECKPOINT_IDENTITY_MISMATCH" });
  assert.equal(f.batches.size, 0);
});

test("relay rejects independently injected ports and malformed binding", async () => {
  assert.throws(() => createPrimarySingleBatchRelay({ sourceFile: "source.sqlite", checkpoint: {}, contract: {},
    expectedTargetId: TARGET_ID }), { code: "POSTGRES_PRIMARY_RELAY_INPUT_INVALID" });
});
