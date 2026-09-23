"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { createFixture } = require("./helpers/postgres-primary-live-fixture");
const { initializeSqliteOutboxSourceIdentity } = require("../src/platform/storage/sqlite-outbox-source-identity");
const { commitSqliteBoundOutboxTransaction, loadBoundSqliteOutboxBatches } = require("../src/platform/storage/sqlite-outbox-commit-receipt");
const { applyPostgresPrimaryIdentityMigrations } = require("../src/platform/storage/postgres-primary-identity-migrations");
const { createPrimaryDurableCheckpoint } = require("../src/platform/storage/postgres-primary-durable-checkpoint");

const options = { timeout: 60000 };
async function setup(t) {
  const f = await createFixture(t);
  if (!f) return null;
  initializeSqliteOutboxSourceIdentity(f.sqlite);
  const envelopes = [];
  for (let version = 1; version <= 2; version += 1) {
    commitSqliteBoundOutboxTransaction(f.sqlite, {
      entries: [["dataQualityIssues", [{ id: "synthetic-checkpoint-only", version }]]],
      expectedVersions: { dataQualityIssues: version - 1 }, sourceEvent: "synthetic-checkpoint-live"
    });
    envelopes.push(loadBoundSqliteOutboxBatches(f.sqliteFile).at(-1));
  }
  await applyPostgresPrimaryIdentityMigrations(f.pool);
  const driver = f.createDriver(f.pool, { requireBoundIdentity: true });
  const target = await driver.initializeTargetIdentity();
  const pin = { expectedTargetId: target.targetInstanceId, namespace: "health_platform" };
  await driver.bindSource({ ...pin, sourceEnvelope: envelopes[0] });
  const checkpointFile = path.join(path.dirname(f.sqliteFile), "checkpoint.sqlite");
  const checkpoint = (selected = driver, file = checkpointFile, targetId = pin.expectedTargetId) =>
    createPrimaryDurableCheckpoint({ checkpointFile: file, sourceFile: f.sqliteFile,
      driver: selected, expectedTargetId: targetId });
  const contract = f.createContract(f.pool, { requireBoundIdentity: true });
  return { f, envelopes, pin, checkpoint, checkpointFile, contract };
}

test("live PG checkpoint recovers a committed target before progress and survives fresh connections", options, async (t) => {
  const s = await setup(t); if (!s) return;
  const { f, envelopes, pin, checkpoint, contract } = s;
  await checkpoint().initialize();
  assert.equal(await checkpoint().read(), null);
  await assert.rejects(checkpoint().advance(envelopes[0]), { code: "POSTGRES_PRIMARY_CHECKPOINT_TARGET_MISMATCH" });
  assert.equal(await checkpoint().read(), null);
  assert.equal((await contract.applyBoundCommittedOutbox(envelopes[0], pin)).status, "applied");
  const targetBeforeFailure = await f.rawSnapshot();
  // The actual PG commit has completed; an INSERT-side checkpoint failure must roll back progress.
  const originalPrepare = DatabaseSync.prototype.prepare;
  DatabaseSync.prototype.prepare = function failAfterCheckpointInsert(sql) {
    const statement = originalPrepare.call(this, sql);
    if (!String(sql).includes("INSERT INTO checkpoint_entries(")) return statement;
    return { run(...args) { statement.run(...args); throw new Error("synthetic-after-checkpoint-insert"); } };
  };
  try {
    await assert.rejects(checkpoint().advance(envelopes[0]), /synthetic-after-checkpoint-insert/);
  } finally { DatabaseSync.prototype.prepare = originalPrepare; }
  assert.equal(await checkpoint().read(), null);
  assert.deepEqual(await f.rawSnapshot(), targetBeforeFailure);
  const reopened = checkpoint(f.createDriver(f.newPool(), { requireBoundIdentity: true }));
  const first = await reopened.advance(envelopes[0]);
  assert.equal(first.outboxSequence, 1);
  assert.deepEqual(await reopened.advance(envelopes[0]), first);
  assert.deepEqual(await checkpoint().read(), first);
  assert.equal((await contract.applyBoundCommittedOutbox(envelopes[1], pin)).status, "applied");
  assert.equal((await reopened.advance(envelopes[1])).outboxSequence, 2);
  assert.equal((await checkpoint().read()).outboxSequence, 2);
  assert.equal((await f.rawSnapshot()).batches.length, 2);
});

test("live PG checkpoint refuses wrong target and nonempty initialization without progress", options, async (t) => {
  const s = await setup(t); if (!s) return;
  const { f, envelopes, pin, checkpoint, checkpointFile, contract } = s;
  await checkpoint().initialize();
  const before = await f.rawSnapshot();
  await assert.rejects(checkpoint(undefined, checkpointFile, randomUUID()).read(),
    { code: "POSTGRES_PRIMARY_CHECKPOINT_IDENTITY_MISMATCH" });
  const other = await createFixture(t);
  await applyPostgresPrimaryIdentityMigrations(other.pool);
  const otherDriver = other.createDriver(other.pool, { requireBoundIdentity: true });
  const otherTarget = await otherDriver.initializeTargetIdentity();
  assert.notEqual(otherTarget.targetInstanceId, pin.expectedTargetId);
  await otherDriver.bindSource({ expectedTargetId: otherTarget.targetInstanceId,
    namespace: pin.namespace, sourceEnvelope: envelopes[0] });
  // Local checkpoint pin is correct; the wrong isolated PG database rejects the bound read.
  await assert.rejects(checkpoint(otherDriver).read(), { code: "POSTGRES_PRIMARY_IDENTITY_MISMATCH" });
  await assert.rejects(checkpoint().advance(envelopes[1]),
    { code: "POSTGRES_PRIMARY_CHECKPOINT_SOURCE_MISMATCH" });
  assert.deepEqual(await f.rawSnapshot(), before);
  assert.equal(await checkpoint().read(), null);
  await contract.applyBoundCommittedOutbox(envelopes[0], pin);
  const secondFile = path.join(path.dirname(checkpointFile), "nonempty-checkpoint.sqlite");
  await assert.rejects(checkpoint(undefined, secondFile).initialize(),
    { code: "POSTGRES_PRIMARY_CHECKPOINT_TARGET_NOT_EMPTY" });
  assert.equal(fs.existsSync(secondFile), false);
  assert.equal((await checkpoint().advance(envelopes[0])).outboxSequence, 1);
});
