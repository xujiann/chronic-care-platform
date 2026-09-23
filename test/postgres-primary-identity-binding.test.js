"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { applySqliteMigrations } = require("../src/platform/storage/sqlite-migrations");
const { initializeSqliteOutboxSourceIdentity } = require("../src/platform/storage/sqlite-outbox-source-identity");
const { commitSqliteBoundOutboxTransaction, loadBoundSqliteOutboxBatches } = require("../src/platform/storage/sqlite-outbox-commit-receipt");
const { createPostgresPrimaryDriver } = require("../src/platform/storage/postgres-primary-driver");
const { createPostgresPrimaryStorageContract, buildPostgresPrimaryStorageConfig } = require("../src/platform/storage/postgres-primary-storage-contract");
const { POSTGRES_PRIMARY_IDENTITY_CHECKSUM } = require("../src/platform/storage/postgres-primary-identity-migrations");

function source(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "primary-identity-unit-"));
  const file = path.join(directory, "source.sqlite");
  const db = new DatabaseSync(file);
  t.after(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  applySqliteMigrations(db);
  initializeSqliteOutboxSourceIdentity(db);
  commitSqliteBoundOutboxTransaction(db, { entries: [["settings", { synthetic: true }]], expectedVersions: { settings: 0 }, sourceEvent: "identity-unit" });
  return loadBoundSqliteOutboxBatches(file)[0];
}

// SQL adapter tests complement (not replace) independently executed real PG tests.
function catalog(sql) {
  const tables = {
    primary_identity_migrations: [["version", "integer"], ["name", "text"], ["checksum", "text"]],
    primary_source_binding: [["singleton", "boolean", "true"], ["target_instance_id", "text"], ["namespace", "text"], ["source_identity", "jsonb"]],
    primary_target_identity: [["singleton", "boolean", "true"], ["target_instance_id", "text"], ["namespace", "text"], ["created_at", "text"]]
  };
  if (sql.includes("FROM pg_class c JOIN pg_namespace")) return Object.entries(tables).flatMap(([table, columns]) =>
    columns.map(([name, type, defaultValue]) => ({ table_name: table, column_name: name, data_type: type,
      not_null: true, default_expression: defaultValue || null, identity_kind: "", generated_kind: "" })));
  if (sql.includes("FROM pg_constraint")) {
    const rows = [];
    function add(table, kind, column, expression = null) {
      rows.push({ table_name: table, kind, columns: [column], expression, validated: true, deferrable: false,
        deferred: false, index_valid: true, reference_schema: kind === "f" ? "health_platform" : null,
        reference_table: kind === "f" ? "primary_target_identity" : null, reference_columns: kind === "f" ? ["target_instance_id"] : [],
        update_action: kind === "f" ? "a" : " ", delete_action: kind === "f" ? "r" : " ", match_type: kind === "f" ? "s" : " " });
    }
    add("primary_identity_migrations", "p", "version");
    add("primary_identity_migrations", "c", "version", "(version > 0)");
    add("primary_identity_migrations", "c", "checksum", "(checksum ~ '^[a-f0-9]{64}$'::text)");
    for (const table of ["primary_target_identity", "primary_source_binding"]) {
      add(table, "p", "singleton"); add(table, "c", "singleton", "singleton");
      add(table, "c", "namespace", "(namespace = 'health_platform'::text)");
    }
    add("primary_target_identity", "u", "target_instance_id");
    add("primary_target_identity", "c", "target_instance_id", "(target_instance_id ~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'::text)");
    add("primary_source_binding", "c", "source_identity", "(jsonb_typeof(source_identity) = 'object'::text)");
    add("primary_source_binding", "f", "target_instance_id");
    return rows;
  }
  if (sql.includes("FROM pg_trigger")) return Object.keys(tables).map((table) => ({
    table_name: table, tgname: table + "_immutable", tgtype: 58, tgenabled: "O", tgnargs: 0, argument_bytes: 0,
    unconditional: true, proname: "primary_identity_immutable", function_schema: "health_platform", lanname: "plpgsql",
    prosecdef: false, proconfig: null, returns_trigger: true, pronargs: 0,
    prosrc: "BEGIN RAISE EXCEPTION 'primary identity metadata is immutable' USING ERRCODE = '23514'; END;"
  }));
  return null;
}
function target() {
  let state = { migrated: true, checksum: POSTGRES_PRIMARY_IDENTITY_CHECKSUM, target: [], binding: [], batches: [], collections: [] };
  const calls = [];
  const pool = { async connect() {
    let before;
    return { release() {}, async query(sql, params = []) {
      const q = sql.replace(/\s+/g, " ").trim(); calls.push(q);
      if (q.startsWith("BEGIN")) { before = structuredClone(state); return { rows: [] }; }
      if (q === "ROLLBACK") { state = before; return { rows: [] }; }
      if (q === "COMMIT" || q.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (q.includes("to_regclass")) return { rows: [{ ledger: state.migrated ? "l" : null, identity: state.migrated ? "i" : null, binding: state.migrated ? "b" : null }] };
      if (q.includes("SELECT version,name,checksum")) return { rows: [{ version: 1, name: "primary-source-target-identity", checksum: state.checksum }] };
      const metadata = catalog(q); if (metadata) return { rows: metadata };
      if (q.includes("EXISTS(SELECT 1")) return { rows: [{ batches: !!state.batches.length, collections: !!state.collections.length }] };
      if (q.startsWith("INSERT INTO health_platform.primary_target_identity")) {
        state.target.push({ target_instance_id: params[0], namespace: params[1], created_at: params[2] }); return { rows: [] };
      }
      if (q.startsWith("INSERT INTO health_platform.primary_source_binding")) {
        state.binding.push({ target_instance_id: params[0], namespace: params[1], source_identity: JSON.parse(params[2]) }); return { rows: [] };
      }
      if (q.includes("FROM health_platform.primary_target_identity")) return { rows: structuredClone(state.target) };
      if (q.includes("FROM health_platform.primary_source_binding")) return { rows: structuredClone(state.binding) };
      const project = (row) => ({ ...row, committed_at_era: "AD", committed_at_utc: row.committed_at.replace(/\.(\d{3})Z$/, ".$1000Z") });
      if (q.includes("FROM health_platform.primary_storage_batches")) {
        const rows = q.includes("WHERE batch_id") ? state.batches.filter((row) => row.batch_id === params[0]) : state.batches.slice(-1);
        return { rows: rows.map(project) };
      }
      if (q.includes("FROM health_platform.primary_collection_state")) return { rows: state.collections.filter((row) => row.collection_name === params[0]) };
      if (q.startsWith("INSERT INTO health_platform.primary_collection_state")) {
        const row = { collection_name: params[0], payload: JSON.parse(params[1]), payload_sha256: params[2], source_version: params[3], deleted: params[4], batch_id: params[5], updated_at: params[6] };
        state.collections = state.collections.filter((item) => item.collection_name !== params[0]); state.collections.push(row);
        return { rows: [row], rowCount: 1 };
      }
      if (q.startsWith("INSERT INTO health_platform.primary_storage_batches")) {
        const row = { batch_id: params[0], payload_sha256: params[1], previous_chain_hash: params[2], chain_hash: params[3], committed_at: params[4], source_transaction_id: params[5], outbox_sequence: String(params[6]), applied_changes: params[7] };
        state.batches.push(row); return { rows: [project(row)], rowCount: 1 };
      }
      throw new Error(`unexpected fixture SQL: ${q}`);
    } };
  } };
  const driver = createPostgresPrimaryDriver({ pool, controlledPool: true, poolConfig: { max: 1, ssl: false } });
  const config = buildPostgresPrimaryStorageConfig({ POSTGRES_PRIMARY_STORAGE_MODE: "shadow", DATABASE_URL: "postgresql://synthetic/fixture",
    POSTGRES_SSL_MODE: "verify-full", POSTGRES_SCHEMA_EVIDENCE_ID: "synthetic-schema", POSTGRES_MIGRATION_EVIDENCE_ID: "synthetic-migration" });
  const contract = createPostgresPrimaryStorageContract({ config, driver });
  return { driver, contract, pool, calls, get state() { return state; } };
}

async function bound(t) {
  const envelope = source(t), f = target();
  const identity = await f.driver.initializeTargetIdentity();
  const binding = { expectedTargetId: identity.targetInstanceId, namespace: identity.namespace, sourceEnvelope: envelope };
  await f.driver.bindSource(binding);
  return { ...f, f, envelope, binding, options: { expectedTargetId: identity.targetInstanceId, namespace: identity.namespace } };
}

test("bound read-only transaction verifies target and source identity before checkpoint receipt access", async (t) => {
  const { f, envelope, binding, options } = await bound(t);
  await f.contract.applyBoundCommittedOutbox(envelope, options);
  const stored = await f.driver.transaction({ isolation: "repeatable-read", readOnly: true, binding },
    (tx) => tx.getAppliedBatch(envelope.batch.batchId));
  assert.equal(stored.batchId, envelope.batch.batchId);
  await assert.rejects(f.driver.transaction({ isolation: "repeatable-read", readOnly: true,
    binding: { ...binding, expectedTargetId: "a23b4567-89ab-4cde-8f01-23456789abcd" } },
  (tx) => tx.getAppliedBatch(envelope.batch.batchId)), { code: "POSTGRES_PRIMARY_IDENTITY_MISMATCH" });
});

test("read-only binding observation pins migrated driver against later marker loss", async (t) => {
  const { f, binding } = await bound(t);
  const freshDriver = createPostgresPrimaryDriver({ pool: f.pool, controlledPool: true,
    poolConfig: { max: 1, ssl: false } });
  await freshDriver.transaction({ isolation: "repeatable-read", readOnly: true, binding },
    (tx) => tx.getLastAppliedBatch());
  f.state.migrated = false;
  await assert.rejects(freshDriver.transaction({ isolation: "serializable", readOnly: false },
    async () => null), { code: "POSTGRES_PRIMARY_IDENTITY_MISSING" });
});

test("identity initialization and genuine branded source binding permit exact apply and repeat without writes", async (t) => {
  const { f, envelope, options, binding } = await bound(t);
  assert.equal((await f.contract.applyBoundCommittedOutbox(envelope, options)).status, "applied");
  const before = structuredClone(f.state);
  assert.equal((await f.contract.applyBoundCommittedOutbox(envelope, options)).status, "duplicate");
  assert.deepEqual(f.state, before);
  await assert.rejects(f.driver.bindSource(binding));
  assert.deepEqual(f.state, before);
});

test("migrated targets reject old apply and direct callback before any business mutation", async (t) => {
  const { f, envelope } = await bound(t);
  const before = structuredClone(f.state);
  await assert.rejects(f.contract.applyCommittedOutbox(envelope.batch, { commitment: envelope.commitment }), { code: "POSTGRES_PRIMARY_IDENTITY_INVALID" });
  let called = false;
  await assert.rejects(f.driver.transaction({ isolation: "serializable" }, () => { called = true; }), { code: "POSTGRES_PRIMARY_IDENTITY_INVALID" });
  assert.equal(called, false); assert.deepEqual(f.state, before);
});

test("wrong target namespace source and counterfeit brands fail without target writes", async (t) => {
  const { f, envelope, options } = await bound(t);
  const wrongSource = source(t);
  const before = structuredClone(f.state);
  for (const [item, input] of [[envelope, { ...options, expectedTargetId: "00000000-0000-4000-8000-000000000001" }],
    [envelope, { ...options, namespace: "other" }], [wrongSource, options], [structuredClone(envelope), options]]) {
    await assert.rejects(f.contract.applyBoundCommittedOutbox(item, input));
    assert.deepEqual(f.state, before);
  }
});

test("direct callback cannot borrow a binding for another payload or a partial batch", async (t) => {
  const { f, envelope, binding } = await bound(t);
  const before = structuredClone(f.state);
  const options = { expectedVersion: -1, batchId: envelope.batch.batchId, appliedAt: "2026-09-22T00:00:00.000Z" };
  await assert.rejects(f.driver.transaction({ isolation: "serializable", binding }, async (tx) => {
    try { await tx.applyCollectionChange({ ...envelope.batch.changes[0], payload: "false" }, options); } catch {}
  }), { code: "POSTGRES_PRIMARY_IDENTITY_BATCH_MISMATCH" });
  await assert.rejects(f.driver.transaction({ isolation: "serializable", binding }, (tx) => tx.applyCollectionChange(envelope.batch.changes[0], options)),
    { code: "POSTGRES_PRIMARY_IDENTITY_BATCH_MISMATCH" });
  assert.deepEqual(f.state, before);
});

test("sticky and constructor pins refuse loss of all migration markers", async (t) => {
  const { f, binding } = await bound(t);
  f.state.migrated = false;
  await assert.rejects(f.driver.transaction({ isolation: "serializable", binding }, () => {}), { code: "POSTGRES_PRIMARY_IDENTITY_MISSING" });
  const pinned = createPostgresPrimaryDriver({ pool: f.pool, controlledPool: true, poolConfig: { ssl: false }, requireBoundIdentity: true });
  await assert.rejects(pinned.transaction({ isolation: "serializable" }, () => {}), { code: "POSTGRES_PRIMARY_IDENTITY_MISSING" });
});

test("bound duplicate lookup cannot borrow another batch id even when callback catches the rejection", async (t) => {
  const { f, envelope, binding } = await bound(t);
  const before = structuredClone(f.state);
  const otherBatch = "unrelated-existing-batch";
  const lookupCount = f.calls.filter((sql) => sql.includes("primary_storage_batches WHERE batch_id")).length;
  await assert.rejects(f.driver.transaction({ isolation: "serializable", binding }, async (tx) => {
    assert.equal(await tx.getAppliedBatch(envelope.batch.batchId), null);
    try { await tx.getAppliedBatch(otherBatch); } catch {}
  }), { code: "POSTGRES_PRIMARY_IDENTITY_BATCH_MISMATCH" });
  assert.deepEqual(f.state, before);
  assert.equal(f.calls.filter((sql) => sql.includes("primary_storage_batches WHERE batch_id")).length - lookupCount, 2,
    "only the internal exact-receipt check and allowed same-batch lookup reach SQL");
});

test("historical target state cannot be retroactively assigned an identity", async () => {
  const f = target(); f.state.collections.push({ collection_name: "settings" });
  const before = structuredClone(f.state);
  await assert.rejects(f.driver.initializeTargetIdentity(), { code: "POSTGRES_PRIMARY_IDENTITY_HISTORY_PRESENT" });
  assert.deepEqual(f.state, before);
});
