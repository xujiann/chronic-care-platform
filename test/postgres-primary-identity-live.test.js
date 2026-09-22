"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { randomUUID } = require("node:crypto");
const { createFixture, overlappingWriters } = require("./helpers/postgres-primary-live-fixture");

const options = { timeout: 60000 };
const namespace = "health_platform";
function source(f, revision = 1) {
  const { initializeSqliteOutboxSourceIdentity } = require("../src/platform/storage/sqlite-outbox-source-identity");
  const { commitSqliteBoundOutboxTransaction, loadBoundSqliteOutboxBatches } = require("../src/platform/storage/sqlite-outbox-commit-receipt");
  if (revision === 1) initializeSqliteOutboxSourceIdentity(f.sqlite);
  commitSqliteBoundOutboxTransaction(f.sqlite, {
    entries: [["dataQualityIssues", [{ id: "synthetic-identity-only", revision }]]],
    expectedVersions: { dataQualityIssues: revision - 1 }, sourceEvent: "synthetic-identity-live"
  });
  return loadBoundSqliteOutboxBatches(f.sqliteFile).at(-1);
}
async function migrate(f) {
  const { applyPostgresPrimaryIdentityMigrations } = require("../src/platform/storage/postgres-primary-identity-migrations");
  return applyPostgresPrimaryIdentityMigrations(f.pool);
}
async function setup(t) {
  const f = await createFixture(t); if (!f) return null;
  const envelope = source(f);
  assert.equal((await migrate(f)).version, 1);
  const driver = f.createDriver(f.pool, { requireBoundIdentity: true });
  const identity = await driver.initializeTargetIdentity();
  const pin = { expectedTargetId: identity.targetInstanceId, namespace };
  await driver.bindSource({ ...pin, sourceEnvelope: envelope });
  return { f, envelope, driver, pin, identity, contract: f.createContract(f.pool, { requireBoundIdentity: true }) };
}
async function unchanged(f, operation) {
  const before = await f.rawSnapshot();
  const metadataBefore = await metadataSnapshot(f);
  await assert.rejects(operation);
  assert.deepEqual(await f.rawSnapshot(), before);
  assert.deepEqual(await metadataSnapshot(f), metadataBefore);
}

async function metadataSnapshot(f) {
  const result = {};
  for (const table of ["primary_identity_migrations", "primary_target_identity", "primary_source_binding"]) {
    const exists = (await f.pool.query("SELECT to_regclass($1)::text AS name", ["health_platform." + table])).rows[0].name;
    result[table] = exists ? (await f.pool.query("SELECT to_jsonb(t) AS row FROM health_platform." + table + " t ORDER BY to_jsonb(t)::text")).rows : null;
  }
  return result;
}

test("live identity migration is repeatable; SQLite bound replay and fresh PG driver retain identity", options, async (t) => {
  const s = await setup(t); if (!s) return;
  const { f, envelope, pin, contract } = s;
  assert.equal((await migrate(f)).applied, false);
  assert.equal((await contract.applyBoundCommittedOutbox(envelope, pin)).status, "applied");
  const before = await f.rawSnapshot();
  const pool = f.newPool();
  assert.notEqual(await f.backendPid(), await f.backendPid(pool));
  const restarted = f.createContract(pool, { requireBoundIdentity: true });
  assert.equal((await restarted.applyBoundCommittedOutbox(envelope, pin)).status, "duplicate");
  assert.deepEqual(await f.rawSnapshot(), before);
  assert.equal((await restarted.applyBoundCommittedOutbox(source(f, 2), pin)).status, "applied");
  assert.equal((await f.rawSnapshot()).batches.length, 2);
});

test("live identity rejects wrong target, namespace, fake source and legacy/direct duplicate bypass with zero writes", options, async (t) => {
  const s = await setup(t); if (!s) return;
  const { f, envelope, pin, contract, driver } = s;
  await contract.applyBoundCommittedOutbox(envelope, pin);
  await unchanged(f, () => contract.applyBoundCommittedOutbox(envelope, { ...pin, expectedTargetId: randomUUID() }));
  await unchanged(f, () => contract.applyBoundCommittedOutbox(envelope, { ...pin, namespace: "other_schema" }));
  await unchanged(f, () => contract.applyBoundCommittedOutbox(JSON.parse(JSON.stringify(envelope)), pin));
  await unchanged(f, () => contract.applyCommittedOutbox(envelope.batch, { commitment: envelope.commitment }));
  let called = false;
  await unchanged(f, () => driver.transaction({ isolation: "serializable", readOnly: false }, () => { called = true; }));
  assert.equal(called, false);
});

test("live identity refuses a different genuine SQLite source and different actual PG target", options, async (t) => {
  const s = await setup(t); if (!s) return;
  const other = await createFixture(t);
  const otherEnvelope = source(other);
  assert.notEqual(otherEnvelope.sourceIdentity.sourceInstanceId, s.envelope.sourceIdentity.sourceInstanceId);
  await unchanged(s.f, () => s.contract.applyBoundCommittedOutbox(otherEnvelope, s.pin));
  await migrate(other);
  const driver = other.createDriver(other.pool, { requireBoundIdentity: true });
  const target = await driver.initializeTargetIdentity();
  assert.notEqual(target.targetInstanceId, s.identity.targetInstanceId);
  await unchanged(other, () => driver.bindSource({ ...s.pin, sourceEnvelope: s.envelope }));
  await driver.bindSource({ expectedTargetId: target.targetInstanceId, namespace, sourceEnvelope: s.envelope });
  const wrongDatabase = other.createContract(other.pool, { requireBoundIdentity: true });
  await unchanged(other, () => wrongDatabase.applyBoundCommittedOutbox(s.envelope, s.pin));
});

test("live migrated target refuses writes before initialization and before explicit binding", options, async (t) => {
  const f = await createFixture(t); if (!f) return;
  const envelope = source(f);
  await migrate(f);
  const contract = f.createContract();
  await unchanged(f, () => contract.applyCommittedOutbox(envelope.batch, { commitment: envelope.commitment }));
  const driver = f.createDriver();
  const target = await driver.initializeTargetIdentity();
  await unchanged(f, () => contract.applyBoundCommittedOutbox(envelope, { expectedTargetId: target.targetInstanceId, namespace }));
  await unchanged(f, () => driver.initializeTargetIdentity());
});

test("live identity migration does not certify a target with historical batches", options, async (t) => {
  const f = await createFixture(t); if (!f) return;
  const item = f.commitBatch([["settings", { synthetic: true }]], { settings: 0 });
  await f.createContract().applyCommittedOutbox(item.batch, { commitment: item.commitment });
  await migrate(f);
  await unchanged(f, () => f.createDriver().initializeTargetIdentity());
});

test("live identity metadata is immutable to ordinary UPDATE and DELETE statements", options, async (t) => {
  const s = await setup(t); if (!s) return;
  for (const table of ["primary_target_identity", "primary_source_binding"]) {
    await assert.rejects(() => s.f.pool.query("UPDATE health_platform." + table + " SET namespace=namespace"));
    await assert.rejects(() => s.f.pool.query("DELETE FROM health_platform." + table));
  }
  assert.equal((await s.contract.applyBoundCommittedOutbox(s.envelope, s.pin)).status, "applied");
});

test("live identity partial metadata removal is not a legacy downgrade", options, async (t) => {
  const s = await setup(t); if (!s) return;
  // DDL corruption is confined to this fixture's newly created synthetic database.
  await s.f.pool.query("DROP TABLE health_platform.primary_source_binding");
  await unchanged(s.f, () => s.contract.applyBoundCommittedOutbox(s.envelope, s.pin));
  await unchanged(s.f, () => s.f.createContract().applyCommittedOutbox(s.envelope.batch, { commitment: s.envelope.commitment }));
});

test("live identity explicit bound mode refuses a database with no identity migration", options, async (t) => {
  const f = await createFixture(t); if (!f) return;
  const envelope = source(f);
  await unchanged(f, () => f.createContract(f.pool, { requireBoundIdentity: true })
    .applyCommittedOutbox(envelope.batch, { commitment: envelope.commitment }));
  await unchanged(f, () => f.createContract().applyBoundCommittedOutbox(envelope, { expectedTargetId: randomUUID(), namespace }));
});

test("live identity checksum drift rejects writes and migration reruns without repairing evidence", options, async (t) => {
  const s = await setup(t); if (!s) return;
  await s.f.pool.query("ALTER TABLE health_platform.primary_identity_migrations DISABLE TRIGGER primary_identity_migrations_immutable");
  await s.f.pool.query("UPDATE health_platform.primary_identity_migrations SET checksum=$1", ["f".repeat(64)]);
  await s.f.pool.query("ALTER TABLE health_platform.primary_identity_migrations ENABLE TRIGGER primary_identity_migrations_immutable");
  await unchanged(s.f, () => s.contract.applyBoundCommittedOutbox(s.envelope, s.pin));
  await unchanged(s.f, () => migrate(s.f));
});

test("live observed bound driver refuses full marker deletion while explicit mode remains pinned on restart", options, async (t) => {
  const s = await setup(t); if (!s) return;
  const driver = s.f.createDriver();
  const binding = { ...s.pin, sourceEnvelope: s.envelope };
  await driver.transaction({ isolation: "serializable", readOnly: false, binding }, async () => {});
  await s.f.pool.query("DROP TABLE health_platform.primary_source_binding, health_platform.primary_target_identity, health_platform.primary_identity_migrations");
  await unchanged(s.f, () => driver.transaction({ isolation: "serializable", readOnly: false }, async () => {}));
  await unchanged(s.f, () => s.f.createContract(s.f.newPool(), { requireBoundIdentity: true })
    .applyCommittedOutbox(s.envelope.batch, { commitment: s.envelope.commitment }));
});

test("live identity migration failure rolls back every newly created structure and can retry cleanly", options, async (t) => {
  const f = await createFixture(t); if (!f) return;
  // An occupied function name fails the version SQL after its CREATE TABLE statements.
  await f.pool.query("CREATE FUNCTION health_platform.primary_identity_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END; $$");
  await unchanged(f, () => migrate(f));
  const rows = (await f.pool.query("SELECT to_regclass('health_platform.primary_identity_migrations') AS ledger, to_regclass('health_platform.primary_target_identity') AS identity, to_regclass('health_platform.primary_source_binding') AS binding")).rows;
  assert.deepEqual(rows, [{ ledger: null, identity: null, binding: null }]);
  await f.pool.query("DROP FUNCTION health_platform.primary_identity_immutable()");
  assert.equal((await migrate(f)).applied, true);
});

for (const [name, sql] of Object.entries({
  constraint: "ALTER TABLE health_platform.primary_source_binding DROP CONSTRAINT primary_source_binding_pkey",
  functionBody: "CREATE OR REPLACE FUNCTION health_platform.primary_identity_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$",
  triggerEvents: "DROP TRIGGER primary_source_binding_immutable ON health_platform.primary_source_binding; CREATE TRIGGER primary_source_binding_immutable BEFORE UPDATE ON health_platform.primary_source_binding FOR EACH STATEMENT EXECUTE FUNCTION health_platform.primary_identity_immutable()"
})) {
  test("live identity rejects actual schema drift despite intact ledger: " + name, options, async (t) => {
    const s = await setup(t); if (!s) return;
    await s.f.pool.query(sql);
    await unchanged(s.f, () => s.contract.applyBoundCommittedOutbox(s.envelope, s.pin));
    await unchanged(s.f, () => migrate(s.f));
  });
}

test("live competing source bindings use independent connections and leave one immutable winner", options, async (t) => {
  const f = await createFixture(t); if (!f) return;
  const other = await createFixture(t);
  const envelopes = [source(f), source(other)];
  await migrate(f);
  const target = await f.createDriver().initializeTargetIdentity();
  const pin = { expectedTargetId: target.targetInstanceId, namespace };
  const { outcomes: results } = await overlappingWriters(f, envelopes.map((sourceEnvelope) =>
    (pool) => f.createDriver(pool).bindSource({ ...pin, sourceEnvelope })));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.filter((r) => r.status === "rejected").length, 1);
  const winner = results.findIndex((r) => r.status === "fulfilled");
  const contract = f.createContract(f.newPool(), { requireBoundIdentity: true });
  assert.equal((await contract.applyBoundCommittedOutbox(envelopes[winner], pin)).status, "applied");
  await unchanged(f, () => contract.applyBoundCommittedOutbox(envelopes[1 - winner], pin));
});

test("live competing target initializers create one persistent identity", options, async (t) => {
  const f = await createFixture(t); if (!f) return;
  await migrate(f);
  const initialize = (pool) => f.createDriver(pool).initializeTargetIdentity();
  const { outcomes: results } = await overlappingWriters(f, [initialize, initialize]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.filter((r) => r.status === "rejected").length, 1);
  const target = results.find((r) => r.status === "fulfilled").value;
  const envelope = source(f);
  const pin = { expectedTargetId: target.targetInstanceId, namespace };
  await f.createDriver(f.newPool()).bindSource({ ...pin, sourceEnvelope: envelope });
  assert.equal((await f.createContract().applyBoundCommittedOutbox(envelope, pin)).status, "applied");
});
