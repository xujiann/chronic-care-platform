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
const { validateWorkerObservability } = require("../src/platform/operations/worker-observability-contract");

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

function assertSafeReport(report, expected) {
  assert.deepEqual(Object.keys(report).sort(), ["ok", "status", "phase", "targetCommit", "checkpointCommit",
    "claimed", "succeeded", "failed", "errorCode", "workerObservability"].sort());
  for (const [key, value] of Object.entries(expected)) assert.equal(report[key], value, key);
  assert.equal(Object.isFrozen(report), true);
  assert.equal(validateWorkerObservability(report.workerObservability), true);
  assert.equal(report.workerObservability.productionAuthorization.productionReady, false);
  assert.doesNotMatch(JSON.stringify(report), /synthetic-after|sensitive-name|secret-token|source\.sqlite|checkpoint\.sqlite/);
}

test("observed relay reports safe checkpoint rejection before attempting a write", async (t) => {
  const f = await fixture(t);
  const report = await createPrimarySingleBatchRelay(f.options).runObservedOnce();
  assertSafeReport(report, { ok: false, status: "failed", phase: "checkpoint-read", targetCommit: "not-attempted",
    checkpointCommit: "not-attempted", claimed: 0, succeeded: 0, failed: 1,
    errorCode: "POSTGRES_PRIMARY_CHECKPOINT_MISSING" });
  assert.equal(report.workerObservability.outcome, "failed");
  assert.equal(f.batches.size, 0);
  await f.checkpoint.initialize();
  const wrong = createPrimarySingleBatchRelay({ ...f.options, expectedTargetId: randomUUID() });
  assertSafeReport(await wrong.runObservedOnce(), { phase: "checkpoint-read", targetCommit: "not-attempted",
    errorCode: "POSTGRES_PRIMARY_CHECKPOINT_IDENTITY_MISMATCH" });
  assert.equal(f.batches.size, 0);
});

test("observed target commit failure is unknown and explicit recovery is duplicate then applied then idle", async (t) => {
  const f = await fixture(t);
  await f.checkpoint.initialize();
  const relay = createPrimarySingleBatchRelay(f.options);
  f.setCrash();
  const failed = await relay.runObservedOnce();
  assertSafeReport(failed, { ok: false, status: "failed", phase: "target-apply", targetCommit: "unknown",
    checkpointCommit: "not-attempted", claimed: 1, succeeded: 0, failed: 1,
    errorCode: "POSTGRES_PRIMARY_RELAY_EXECUTION_FAILED" });
  assert.equal(failed.workerObservability.outcome, "failed");
  assert.equal(f.batches.size, 1);
  assert.equal(await f.checkpoint.read(), null);
  for (const status of ["duplicate", "applied"]) {
    const report = await relay.runObservedOnce();
    assertSafeReport(report, { ok: true, status, phase: "complete", targetCommit: "confirmed",
      checkpointCommit: "confirmed", claimed: 1, succeeded: 1, failed: 0, errorCode: "" });
    assert.equal(report.workerObservability.outcome, "succeeded");
  }
  const idle = await relay.runObservedOnce();
  assertSafeReport(idle, { ok: true, status: "idle", phase: "complete", targetCommit: "not-attempted",
    checkpointCommit: "not-attempted", claimed: 0, succeeded: 0, failed: 0 });
  assert.equal(idle.workerObservability.outcome, "idle");
  assert.equal(f.batches.size, 2);
  assert.deepEqual(await relay.runOnce(), { status: "idle", outboxSequence: 2 });
});

test("observed source-read failure reports no target attempt and exposes no source details", async (t) => {
  const f = await fixture(t);
  await f.checkpoint.initialize();
  let armed = false;
  const driver = { status: () => f.options.driver.status(), async transaction(options, operation) {
    const result = await f.options.driver.transaction(options, operation);
    if (options.readOnly) armed = true;
    return result;
  } };
  const original = DatabaseSync.prototype.prepare;
  DatabaseSync.prototype.prepare = function failSourceRead(sql) {
    if (armed) throw new Error("sensitive-name secret-token source.sqlite");
    return original.call(this, sql);
  };
  let report;
  try { report = await createPrimarySingleBatchRelay({ ...f.options, driver }).runObservedOnce(); }
  finally { DatabaseSync.prototype.prepare = original; }
  assertSafeReport(report, { ok: false, phase: "source-read", targetCommit: "not-attempted",
    checkpointCommit: "not-attempted", claimed: 0, succeeded: 0, failed: 1 });
  assert.equal(f.batches.size, 0);
  assert.equal(await f.checkpoint.read(), null);
});

test("observed checkpoint insert failure keeps confirmed target but unknown progress and recovers", async (t) => {
  const f = await fixture(t);
  await f.checkpoint.initialize();
  const relay = createPrimarySingleBatchRelay(f.options);
  const original = DatabaseSync.prototype.prepare;
  DatabaseSync.prototype.prepare = function failCheckpointInsert(sql) {
    const statement = original.call(this, sql);
    if (!String(sql).includes("INSERT INTO checkpoint_entries(")) return statement;
    return { run(...args) { statement.run(...args); throw new Error("secret-token checkpoint.sqlite"); } };
  };
  let report;
  try { report = await relay.runObservedOnce(); }
  finally { DatabaseSync.prototype.prepare = original; }
  assertSafeReport(report, { ok: false, status: "failed", phase: "checkpoint-advance", targetCommit: "confirmed",
    checkpointCommit: "unknown", claimed: 1, succeeded: 0, failed: 1 });
  assert.equal(report.workerObservability.outcome, "failed");
  assert.equal(f.batches.size, 1);
  assert.equal(await f.checkpoint.read(), null);
  assertSafeReport(await relay.runObservedOnce(), { status: "duplicate", checkpointCommit: "confirmed" });
  assert.equal((await f.checkpoint.read()).outboxSequence, 1);
});

test("checkpoint COMMIT followed by exception must still report progress unknown, not success", async (t) => {
  const f = await fixture(t);
  await f.checkpoint.initialize();
  const relay = createPrimarySingleBatchRelay(f.options);
  const checkpointConnections = new WeakSet();
  const originalPrepare = DatabaseSync.prototype.prepare;
  const originalExec = DatabaseSync.prototype.exec;
  DatabaseSync.prototype.prepare = function trackCheckpoint(sql) {
    if (String(sql).includes("INSERT INTO checkpoint_entries(")) checkpointConnections.add(this);
    return originalPrepare.call(this, sql);
  };
  DatabaseSync.prototype.exec = function failAfterCommit(sql) {
    const result = originalExec.call(this, sql);
    if (sql === "COMMIT" && checkpointConnections.has(this)) throw new Error("secret-token");
    return result;
  };
  let report;
  try { report = await relay.runObservedOnce(); }
  finally { DatabaseSync.prototype.prepare = originalPrepare; DatabaseSync.prototype.exec = originalExec; }
  assertSafeReport(report, { ok: false, phase: "checkpoint-advance", targetCommit: "confirmed", checkpointCommit: "unknown" });
  assert.equal((await f.checkpoint.read()).outboxSequence, 1);
  assertSafeReport(await relay.runObservedOnce(), { status: "applied", checkpointCommit: "confirmed" });
});

test("driver exception codes use a closed allowlist; opaque throws are safe and legacy exceptions stay identical", async (t) => {
  const f = await fixture(t);
  await f.checkpoint.initialize();
  const getter = Object.defineProperty({}, "code", { get() { throw new Error("secret-token"); } });
  const opaque = new Proxy({}, { getOwnPropertyDescriptor() { throw new Error("secret-token"); } });
  const allowedError = Object.assign(new Error("sensitive-name"), { code: "POSTGRES_PRIMARY_COLLECTION_CAS_CONFLICT" });
  for (const error of [
    allowedError,
    Object.assign(new Error("secret-token"), { code: "POSTGRES_PRIMARY_SECRET_TOKEN" }),
    "secret-token", null, getter, opaque
  ]) {
    const driver = { status: () => f.options.driver.status(), async transaction(options, operation) {
      if (!options.readOnly) throw error;
      return f.options.driver.transaction(options, operation);
    } };
    const relay = createPrimarySingleBatchRelay({ ...f.options, driver });
    const report = await relay.runObservedOnce();
    assertSafeReport(report, { phase: "target-apply", targetCommit: "unknown", checkpointCommit: "not-attempted" });
    const allowed = error === allowedError;
    assert.equal(report.errorCode, allowed ? "POSTGRES_PRIMARY_COLLECTION_CAS_CONFLICT" : "POSTGRES_PRIMARY_RELAY_EXECUTION_FAILED");
    await relay.runOnce().then(() => assert.fail("legacy must reject"), (thrown) => assert.equal(thrown, error));
  }
  assert.equal(f.batches.size, 0);
});

test("invalid target response cannot confirm a commit or advance progress", async (t) => {
  const f = await fixture(t);
  await f.checkpoint.initialize();
  const driver = { status: () => f.options.driver.status(), async transaction(options, operation) {
    const result = await f.options.driver.transaction(options, operation);
    return options.readOnly ? result : { ...result, batchId: "secret-token" };
  } };
  const report = await createPrimarySingleBatchRelay({ ...f.options, driver }).runObservedOnce();
  assertSafeReport(report, { phase: "target-apply", targetCommit: "unknown", checkpointCommit: "not-attempted",
    errorCode: "POSTGRES_PRIMARY_RELAY_TARGET_RESULT_INVALID" });
  assert.equal(await f.checkpoint.read(), null);
  assertSafeReport(await createPrimarySingleBatchRelay(f.options).runObservedOnce(), { status: "duplicate" });
});

test("observed target status is validated once and never reread from an untrusted accessor", async (t) => {
  const f = await fixture(t);
  await f.checkpoint.initialize();
  let reads = 0;
  const driver = { status: () => f.options.driver.status(), async transaction(options, operation) {
    const result = await f.options.driver.transaction(options, operation);
    if (options.readOnly) return result;
    return Object.defineProperty({ ...result }, "status", { get() {
      reads += 1;
      return reads === 1 ? "applied" : "secret-token";
    } });
  } };
  const report = await createPrimarySingleBatchRelay({ ...f.options, driver }).runObservedOnce();
  assertSafeReport(report, { status: "applied", targetCommit: "confirmed", checkpointCommit: "confirmed" });
  assert.equal(reads, 1);
});
