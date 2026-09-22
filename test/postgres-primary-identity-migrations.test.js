"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { applyPostgresPrimaryIdentityMigrations, inspectPostgresPrimaryIdentityMigration,
  POSTGRES_PRIMARY_IDENTITY_CHECKSUM } = require("../src/platform/storage/postgres-primary-identity-migrations");

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
function fixture(fault) {
  let state = { markers: { ledger: null, identity: null, binding: null }, ledger: [] };
  let snapshot;
  let released = 0;
  const calls = [];
  const client = { async query(sql, values = []) {
    calls.push(sql);
    if (sql.startsWith("BEGIN")) { snapshot = structuredClone(state); return { rows: [] }; }
    if (sql === "COMMIT") { if (fault === "commit") throw new Error("private connection detail"); return { rows: [] }; }
    if (sql === "ROLLBACK") { state = snapshot; return { rows: [] }; }
    if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
    if (sql.includes("to_regclass")) return { rows: [state.markers] };
    if (sql.includes("-- OPS-045 v1")) {
      state.markers = { ledger: "l", identity: "i", binding: "b" };
      if (fault === "ddl") throw new Error("private SQL detail");
      return { rows: [] };
    }
    if (sql.startsWith("INSERT INTO health_platform.primary_identity_migrations")) {
      if (fault === "ledger") throw new Error("private SQL detail");
      state.ledger = [{ version: values[0], name: values[1], checksum: values[2] }]; return { rows: [] };
    }
    if (sql.includes("SELECT version,name,checksum")) return { rows: state.ledger };
    const metadata = catalog(sql);
    if (metadata) { if (typeof fault === "function") fault(metadata, sql); return { rows: metadata }; }
    throw new Error("unexpected SQL");
  }, release() { released += 1; } };
  return { client, pool: { async connect() { return client; } }, calls,
    get state() { return state; }, get released() { return released; } };
}

test("PG identity v1 freezes actual SQL content and creates only empty metadata structures", () => {
  const sql = fs.readFileSync(path.join(__dirname, "../deploy/postgres-primary-identity-v1.sql"), "utf8").replace(/\r\n/g, "\n");
  assert.equal(createHash("sha256").update(sql).digest("hex"), POSTGRES_PRIMARY_IDENTITY_CHECKSUM);
  assert.doesNotMatch(sql, /INSERT INTO/i);
  assert.match(sql, /BEFORE UPDATE OR DELETE OR TRUNCATE/);
  assert.match(sql, /REFERENCES health_platform.primary_target_identity/);
});

test("PG identity migration initializes empty structures once and verifies repeat ledger", async () => {
  const f = fixture();
  assert.deepEqual(await applyPostgresPrimaryIdentityMigrations(f.pool), { version: 1, applied: true });
  assert.deepEqual(await applyPostgresPrimaryIdentityMigrations(f.pool), { version: 1, applied: false });
  assert.equal(f.calls.filter((sql) => sql.includes("-- OPS-045 v1")).length, 1);
  assert.equal(f.released, 2);
  f.state.ledger[0].checksum = "0".repeat(64);
  await assert.rejects(applyPostgresPrimaryIdentityMigrations(f.pool), { code: "POSTGRES_PRIMARY_IDENTITY_MIGRATION_INVALID" });
});

for (const fault of ["ddl", "ledger", "commit"]) test(`PG identity migration ${fault} failure rolls all new metadata back`, async () => {
  const f = fixture(fault);
  const before = structuredClone(f.state);
  await assert.rejects(applyPostgresPrimaryIdentityMigrations(f.pool), (error) => {
    assert.equal(error.code, "POSTGRES_PRIMARY_IDENTITY_MIGRATION_FAILED");
    assert.doesNotMatch(error.message, /private/); return true;
  });
  assert.deepEqual(f.state, before);
  assert.equal(f.released, 1);
  assert.ok(f.calls.includes("ROLLBACK"));
});

test("PG identity partial metadata is not treated as an unmigrated legacy database", async () => {
  const f = fixture();
  f.state.markers.identity = "present";
  await assert.rejects(inspectPostgresPrimaryIdentityMigration(f.client), { code: "POSTGRES_PRIMARY_IDENTITY_MIGRATION_INVALID" });
  assert.equal(f.calls.some((sql) => sql.includes("-- OPS-045 v1")), false);
});

for (const [name, route, mutate] of [
  ["missing column", "FROM pg_class c JOIN pg_namespace", (rows) => rows.pop()],
  ["column type", "FROM pg_class c JOIN pg_namespace", (rows) => { rows[0].data_type = "bigint"; }],
  ["nullable column", "FROM pg_class c JOIN pg_namespace", (rows) => { rows[0].not_null = false; }],
  ["changed default", "FROM pg_class c JOIN pg_namespace", (rows) => { rows[3].default_expression = "false"; }],
  ["missing constraint", "FROM pg_constraint", (rows) => rows.pop()],
  ["weakened check", "FROM pg_constraint", (rows) => { rows.find((row) => row.expression?.includes("version >")).expression = "version >= 0"; }],
  ["wrong foreign target", "FROM pg_constraint", (rows) => { rows.find((row) => row.kind === "f").reference_table = "other"; }],
  ["foreign cascade", "FROM pg_constraint", (rows) => { rows.find((row) => row.kind === "f").delete_action = "c"; }],
  ["unvalidated constraint", "FROM pg_constraint", (rows) => { rows[0].validated = false; }],
  ["invalid backing index", "FROM pg_constraint", (rows) => { rows[0].index_valid = false; }],
  ["trigger wrong table", "FROM pg_trigger", (rows) => { rows[0].table_name = "other"; }],
  ["trigger event", "FROM pg_trigger", (rows) => { rows[0].tgtype = 18; }],
  ["disabled trigger", "FROM pg_trigger", (rows) => { rows[0].tgenabled = "D"; }],
  ["trigger condition", "FROM pg_trigger", (rows) => { rows[0].unconditional = false; }],
  ["replaced function body", "FROM pg_trigger", (rows) => { rows[0].prosrc = "BEGIN RETURN NULL; END;"; }],
  ["wrong function schema", "FROM pg_trigger", (rows) => { rows[0].function_schema = "public"; }]
]) test(`PG identity rejects catalog drift: ${name}`, async () => {
  const f = fixture((rows, sql) => { if (sql.includes(route)) mutate(rows); });
  f.state.markers = { ledger: "l", identity: "i", binding: "b" };
  f.state.ledger = [{ version: 1, name: "primary-source-target-identity", checksum: POSTGRES_PRIMARY_IDENTITY_CHECKSUM }];
  await assert.rejects(inspectPostgresPrimaryIdentityMigration(f.client), { code: "POSTGRES_PRIMARY_IDENTITY_MIGRATION_INVALID" });
  assert.equal(f.calls.some((sql) => sql.includes("-- OPS-045 v1")), false);
});
