"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const POSTGRES_PRIMARY_IDENTITY_VERSION = 1;
// Frozen LF-normalized v1 fingerprint. Runtime verification never reads deployment SQL.
const POSTGRES_PRIMARY_IDENTITY_CHECKSUM = "14979a6016d3a4f7866e47b91eb810fffff2d296a13f9f1a6ac4c365990587cb";
const NAME = "primary-source-target-identity";
const LOCK = "health-platform-postgres-primary-storage-v1";
const TABLES = ["primary_identity_migrations", "primary_source_binding", "primary_target_identity"];
const UUID = "^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$";
const EXPECTED_COLUMNS = {
  primary_identity_migrations: [["version", "integer"], ["name", "text"], ["checksum", "text"]],
  primary_target_identity: [["singleton", "boolean", "true"], ["target_instance_id", "text"], ["namespace", "text"], ["created_at", "text"]],
  primary_source_binding: [["singleton", "boolean", "true"], ["target_instance_id", "text"], ["namespace", "text"], ["source_identity", "jsonb"]]
};
// These scalar CHECK expressions contain no compound operators. Removing only
// deparser parentheses/text casts preserves their exact scalar semantics.
function expression(value) { return typeof value === "string"
  ? value.replace(/'(?:''|[^'])*'|::text|[()\s]+/g, (token) => token.startsWith("'") ? token : "") : value; }
function body(value) { return value.replace(/'(?:''|[^'])*'|\s+/g, (token) => token.startsWith("'") ? token : ""); }
const EXPECTED_CONSTRAINTS = {
  primary_identity_migrations: ["p:version", "c:version:version>0", "c:checksum:checksum~'^[a-f0-9]{64}$'"],
  primary_target_identity: ["p:singleton", "c:singleton:singleton", "u:target_instance_id", `c:target_instance_id:target_instance_id~'${UUID}'`, "c:namespace:namespace='health_platform'"],
  primary_source_binding: ["p:singleton", "c:singleton:singleton", "c:namespace:namespace='health_platform'", "c:source_identity:jsonb_typeofsource_identity='object'", "f:target_instance_id:primary_target_identity:target_instance_id:a:r"]
};

async function verifyStructure(client) {
  const columns = (await client.query(`SELECT c.relname AS table_name,a.attname AS column_name,
    format_type(a.atttypid,a.atttypmod) AS data_type,a.attnotnull AS not_null,
    pg_get_expr(d.adbin,d.adrelid) AS default_expression,a.attidentity AS identity_kind,a.attgenerated AS generated_kind
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
    LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
    WHERE n.nspname='health_platform' AND c.relname=ANY($1::text[]) AND c.relkind='r'
    ORDER BY c.relname,a.attnum`, [TABLES])).rows;
  const expectedColumns = TABLES.flatMap((table) => EXPECTED_COLUMNS[table].map(([name, type, defaultValue]) => ({
    table_name: table, column_name: name, data_type: type, not_null: true,
    default_expression: defaultValue || null, identity_kind: "", generated_kind: ""
  })));
  if (JSON.stringify(columns) !== JSON.stringify(expectedColumns)) throw invalid();
  const constraints = (await client.query(`SELECT c.relname AS table_name,k.contype AS kind,
    ARRAY(SELECT a.attname::text FROM unnest(k.conkey) WITH ORDINALITY u(num,ord)
      JOIN pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=u.num ORDER BY u.ord) AS columns,
    k.convalidated AS validated,k.condeferrable AS deferrable,k.condeferred AS deferred,
    pg_get_expr(k.conbin,k.conrelid) AS expression,r.relname AS reference_table,rn.nspname AS reference_schema,
    ARRAY(SELECT a.attname::text FROM unnest(k.confkey) WITH ORDINALITY u(num,ord)
      JOIN pg_attribute a ON a.attrelid=k.confrelid AND a.attnum=u.num ORDER BY u.ord) AS reference_columns,
    k.confupdtype AS update_action,k.confdeltype AS delete_action,k.confmatchtype AS match_type,
    COALESCE(i.indisvalid AND i.indisready AND i.indisunique,true) AS index_valid
    FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_class r ON r.oid=k.confrelid LEFT JOIN pg_namespace rn ON rn.oid=r.relnamespace
    LEFT JOIN pg_index i ON i.indexrelid=k.conindid
    WHERE n.nspname='health_platform' AND c.relname=ANY($1::text[])`, [TABLES])).rows;
  for (const table of TABLES) {
    const actual = constraints.filter((row) => row.table_name === table).map((row) => {
      if (row.validated !== true || row.deferrable !== false || row.deferred !== false || row.index_valid !== true
        || !Array.isArray(row.columns)) throw invalid();
      let result = `${row.kind}:${row.columns.join(",")}`;
      if (row.kind === "c") result += `:${expression(row.expression)}`;
      if (row.kind === "f") {
        if (row.reference_schema !== "health_platform" || row.match_type !== "s" || !Array.isArray(row.reference_columns)) throw invalid();
        result += `:${row.reference_table}:${row.reference_columns.join(",")}:${row.update_action}:${row.delete_action}`;
      }
      return result;
    }).sort();
    if (JSON.stringify(actual) !== JSON.stringify(EXPECTED_CONSTRAINTS[table].slice().sort())) throw invalid();
  }
  const triggers = (await client.query(`SELECT c.relname AS table_name,t.tgname,t.tgtype,t.tgenabled,
    t.tgnargs,octet_length(t.tgargs) AS argument_bytes,t.tgqual IS NULL AS unconditional,
    p.proname,pn.nspname AS function_schema,p.prosrc,l.lanname,p.prosecdef,p.proconfig,
    p.prorettype='trigger'::regtype AS returns_trigger,p.pronargs
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace pn ON pn.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
    WHERE NOT t.tgisinternal AND n.nspname='health_platform' AND c.relname=ANY($1::text[])`, [TABLES])).rows;
  const expectedBody = body("BEGIN RAISE EXCEPTION 'primary identity metadata is immutable' USING ERRCODE = '23514'; END;");
  if (triggers.length !== 3) throw invalid();
  for (const table of TABLES) {
    const rows = triggers.filter((row) => row.table_name === table);
    const row = rows[0];
    if (rows.length !== 1 || row.tgname !== `${table}_immutable` || row.tgtype !== 58 || row.tgenabled !== "O"
      || row.tgnargs !== 0 || row.argument_bytes !== 0 || row.unconditional !== true
      || row.proname !== "primary_identity_immutable" || row.function_schema !== "health_platform"
      || row.lanname !== "plpgsql" || row.prosecdef !== false || row.proconfig !== null
      || row.returns_trigger !== true || row.pronargs !== 0 || typeof row.prosrc !== "string"
      || body(row.prosrc) !== expectedBody) throw invalid();
  }
}
function invalid() {
  return Object.assign(new Error("PostgreSQL primary identity migration is invalid"), { code: "POSTGRES_PRIMARY_IDENTITY_MIGRATION_INVALID" });
}

async function inspectPostgresPrimaryIdentityMigration(client) {
  const result = await client.query(`SELECT
    to_regclass('health_platform.primary_identity_migrations')::text AS ledger,
    to_regclass('health_platform.primary_target_identity')::text AS identity,
    to_regclass('health_platform.primary_source_binding')::text AS binding`);
  const row = result.rows[0];
  if (!row || !["ledger", "identity", "binding"].every((key) => Object.hasOwn(row, key))) throw invalid();
  if (Object.values(row).every((value) => value === null)) return false;
  if (![row.ledger, row.identity, row.binding].every((value) => typeof value === "string" && value.length)) throw invalid();
  const ledger = (await client.query("SELECT version,name,checksum FROM health_platform.primary_identity_migrations ORDER BY version")).rows;
  if (ledger.length !== 1 || ledger[0].version !== 1 || ledger[0].name !== NAME
    || ledger[0].checksum !== POSTGRES_PRIMARY_IDENTITY_CHECKSUM) throw invalid();
  await verifyStructure(client);
  return true;
}

async function applyPostgresPrimaryIdentityMigrations(pool) {
  const client = await pool.connect();
  let begun = false;
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");
    begun = true;
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [LOCK]);
    const migrated = await inspectPostgresPrimaryIdentityMigration(client);
    if (!migrated) {
      const sql = fs.readFileSync(path.join(__dirname, "../../../deploy/postgres-primary-identity-v1.sql"), "utf8").replace(/\r\n/g, "\n");
      if (createHash("sha256").update(sql).digest("hex") !== POSTGRES_PRIMARY_IDENTITY_CHECKSUM) throw invalid();
      await client.query(sql);
      await client.query("INSERT INTO health_platform.primary_identity_migrations(version,name,checksum) VALUES ($1,$2,$3)", [1, NAME, POSTGRES_PRIMARY_IDENTITY_CHECKSUM]);
      await inspectPostgresPrimaryIdentityMigration(client);
    }
    await client.query("COMMIT");
    begun = false;
    return { version: POSTGRES_PRIMARY_IDENTITY_VERSION, applied: !migrated };
  } catch (error) {
    if (begun) await client.query("ROLLBACK").catch(() => {});
    throw Object.assign(new Error("PostgreSQL primary identity migration failed"), {
      code: error.code === "POSTGRES_PRIMARY_IDENTITY_MIGRATION_INVALID" ? error.code : "POSTGRES_PRIMARY_IDENTITY_MIGRATION_FAILED"
    });
  } finally { client.release(); }
}

module.exports = { POSTGRES_PRIMARY_IDENTITY_VERSION, POSTGRES_PRIMARY_IDENTITY_CHECKSUM,
  inspectPostgresPrimaryIdentityMigration, applyPostgresPrimaryIdentityMigrations };
