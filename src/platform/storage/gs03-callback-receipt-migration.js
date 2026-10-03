"use strict";

const { migrationContentFingerprint } = require("./sqlite-migrations");

const GS03_CALLBACK_RECEIPT_TABLE = "gs03_callback_receipts";

function schemaStatements() {
  const edgeWhitespace = "char(9,10,11,12,13,32,133,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)";
  return Object.freeze({
    table: `CREATE TABLE gs03_callback_receipts (
      receipt_id TEXT NOT NULL PRIMARY KEY
        CHECK(length(CAST(receipt_id AS BLOB)) BETWEEN 1 AND 128
          AND receipt_id = trim(receipt_id, ${edgeWhitespace}) AND instr(receipt_id, char(0)) = 0),
      namespace_digest TEXT NOT NULL
        CHECK(length(CAST(namespace_digest AS BLOB)) = 64 AND instr(namespace_digest, char(0)) = 0
          AND namespace_digest NOT GLOB '*[^0-9a-f]*'),
      contract_id TEXT NOT NULL
        CHECK(contract_id IN ('referral-feedback-callback', 'referral-schedule-callback', 'referral-report-callback')),
      contract_version INTEGER NOT NULL CHECK(contract_version = 2),
      key_digest TEXT NOT NULL
        CHECK(length(CAST(key_digest AS BLOB)) = 64 AND instr(key_digest, char(0)) = 0
          AND key_digest NOT GLOB '*[^0-9a-f]*'),
      target_id TEXT NOT NULL
        CHECK(length(CAST(target_id AS BLOB)) BETWEEN 1 AND 240
          AND target_id = trim(target_id, ${edgeWhitespace}) AND instr(target_id, char(0)) = 0),
      authorization_id TEXT NOT NULL
        CHECK(length(CAST(authorization_id AS BLOB)) BETWEEN 1 AND 240
          AND authorization_id = trim(authorization_id, ${edgeWhitespace}) AND instr(authorization_id, char(0)) = 0),
      intent_digest_version INTEGER NOT NULL CHECK(intent_digest_version = 2),
      intent_digest TEXT NOT NULL
        CHECK(length(CAST(intent_digest AS BLOB)) = 64 AND instr(intent_digest, char(0)) = 0
          AND intent_digest NOT GLOB '*[^0-9a-f]*'),
      result_status TEXT NOT NULL CHECK(result_status = 'committed'),
      recorded_at_ms INTEGER NOT NULL CHECK(recorded_at_ms BETWEEN 0 AND 8640000000000000),
      security_stream TEXT NOT NULL CHECK(security_stream = 'securityEvents'),
      security_audit_event_id TEXT NOT NULL
        CHECK(length(CAST(security_audit_event_id AS BLOB)) BETWEEN 1 AND 240
          AND security_audit_event_id = trim(security_audit_event_id, ${edgeWhitespace})
          AND instr(security_audit_event_id, char(0)) = 0),
      access_stream TEXT NOT NULL CHECK(access_stream = 'dataAccessLogs'),
      access_audit_event_id TEXT NOT NULL
        CHECK(length(CAST(access_audit_event_id AS BLOB)) BETWEEN 1 AND 240
          AND access_audit_event_id = trim(access_audit_event_id, ${edgeWhitespace})
          AND instr(access_audit_event_id, char(0)) = 0),
      FOREIGN KEY (security_stream, security_audit_event_id)
        REFERENCES audit_delivery_source_events(stream, source_event_id) ON DELETE RESTRICT,
      FOREIGN KEY (access_stream, access_audit_event_id)
        REFERENCES audit_delivery_source_events(stream, source_event_id) ON DELETE RESTRICT
    ) STRICT`,
    keyIndex: `CREATE UNIQUE INDEX gs03_callback_receipts_key_unique
      ON gs03_callback_receipts(namespace_digest, contract_id, contract_version, key_digest)`,
    noUpdate: `CREATE TRIGGER gs03_callback_receipts_no_update
      BEFORE UPDATE ON gs03_callback_receipts
      BEGIN SELECT RAISE(ABORT, 'GS03_CALLBACK_RECEIPT_IMMUTABLE'); END`,
    noDelete: `CREATE TRIGGER gs03_callback_receipts_no_delete
      BEFORE DELETE ON gs03_callback_receipts
      BEGIN SELECT RAISE(ABORT, 'GS03_CALLBACK_RECEIPT_IMMUTABLE'); END`,
    noReplace: `CREATE TRIGGER gs03_callback_receipts_no_replace
      BEFORE INSERT ON gs03_callback_receipts
      BEGIN
        SELECT CASE WHEN EXISTS (
          SELECT 1 FROM gs03_callback_receipts
          WHERE receipt_id = NEW.receipt_id
            OR (namespace_digest = NEW.namespace_digest AND contract_id = NEW.contract_id
              AND contract_version = NEW.contract_version AND key_digest = NEW.key_digest)
        ) THEN RAISE(ABORT, 'GS03_CALLBACK_RECEIPT_IMMUTABLE') END;
      END`
  });
}

function assertForeignKeysEnabled(db) {
  if (db.prepare("PRAGMA foreign_keys").get()?.foreign_keys !== 1) {
    throw new Error("GS03_CALLBACK_RECEIPT_SCHEMA_FOREIGN_KEYS_DISABLED");
  }
}

function assertAuditSourceParentSchema(db) {
  const parent = db.prepare("SELECT type FROM sqlite_master WHERE name = 'audit_delivery_source_events'").get();
  const columns = db.prepare("PRAGMA table_info(audit_delivery_source_events)").all();
  if (parent?.type !== "table" || !["stream", "source_event_id"].every((name) => {
    const column = columns.find((item) => item.name === name);
    return column?.type === "TEXT" && column.notnull === 1;
  })) throw new Error("GS03_CALLBACK_RECEIPT_SCHEMA_AUDIT_SOURCE_PARENT_INVALID");

  const indexes = db.prepare("PRAGMA index_list(audit_delivery_source_events)").all();
  const hasUniqueKey = indexes.some((index) => index.unique === 1 && index.partial === 0
    && JSON.stringify(db.prepare("SELECT name FROM pragma_index_info(?) ORDER BY seqno").all(index.name)
      .map((column) => column.name)) === JSON.stringify(["stream", "source_event_id"])
    && JSON.stringify(db.prepare("SELECT name, coll FROM pragma_index_xinfo(?) WHERE key = 1 ORDER BY seqno")
      .all(index.name).map((column) => [column.name, column.coll]))
      === JSON.stringify([["stream", "BINARY"], ["source_event_id", "BINARY"]]));
  if (!hasUniqueKey) throw new Error("GS03_CALLBACK_RECEIPT_SCHEMA_AUDIT_SOURCE_KEY_INVALID");
}

function createGs03CallbackReceiptSchema(db) {
  assertForeignKeysEnabled(db);
  assertAuditSourceParentSchema(db);
  for (const statement of Object.values(schemaStatements())) db.exec(`${statement};`);
}

function verifyGs03CallbackReceiptSchema(db) {
  assertForeignKeysEnabled(db);
  assertAuditSourceParentSchema(db);
  const statements = schemaStatements();
  const expected = new Map([
    ["gs03_callback_receipts", ["table", statements.table]],
    ["gs03_callback_receipts_key_unique", ["index", statements.keyIndex]],
    ["gs03_callback_receipts_no_update", ["trigger", statements.noUpdate]],
    ["gs03_callback_receipts_no_delete", ["trigger", statements.noDelete]],
    ["gs03_callback_receipts_no_replace", ["trigger", statements.noReplace]]
  ]);
  const rows = db.prepare(`SELECT type, name, sql FROM sqlite_master
    WHERE tbl_name = 'gs03_callback_receipts' AND sql IS NOT NULL`).all();
  if (rows.length !== expected.size || rows.some((row) => {
    const entry = expected.get(row.name);
    return !entry || row.type !== entry[0] || String(row.sql || "").trim() !== entry[1];
  })) throw new Error("GS03_CALLBACK_RECEIPT_SCHEMA_OBJECT_DRIFT");

  const columns = db.prepare("PRAGMA table_info(gs03_callback_receipts)").all();
  const names = ["receipt_id", "namespace_digest", "contract_id", "contract_version", "key_digest",
    "target_id", "authorization_id", "intent_digest_version", "intent_digest", "result_status",
    "recorded_at_ms", "security_stream", "security_audit_event_id", "access_stream", "access_audit_event_id"];
  if (columns.length !== names.length || columns.some((column, index) =>
    column.name !== names[index] || column.type !== ([3, 7, 10].includes(index) ? "INTEGER" : "TEXT")
      || column.notnull !== 1 || column.pk !== (index === 0 ? 1 : 0))) {
    throw new Error("GS03_CALLBACK_RECEIPT_SCHEMA_COLUMN_DRIFT");
  }

  const foreignKeys = db.prepare("PRAGMA foreign_key_list(gs03_callback_receipts)").all();
  const groups = new Map();
  for (const row of foreignKeys) {
    if (!groups.has(row.id)) groups.set(row.id, []);
    groups.get(row.id).push(row);
  }
  const actual = [...groups.values()].map((group) => group.sort((a, b) => a.seq - b.seq)
    .map((row) => [row.table, row.from, row.to, row.on_delete, row.on_update])).sort();
  const expectedForeignKeys = [
    [["audit_delivery_source_events", "access_stream", "stream", "RESTRICT", "NO ACTION"],
      ["audit_delivery_source_events", "access_audit_event_id", "source_event_id", "RESTRICT", "NO ACTION"]],
    [["audit_delivery_source_events", "security_stream", "stream", "RESTRICT", "NO ACTION"],
      ["audit_delivery_source_events", "security_audit_event_id", "source_event_id", "RESTRICT", "NO ACTION"]]
  ];
  if (JSON.stringify(actual) !== JSON.stringify(expectedForeignKeys)) {
    throw new Error("GS03_CALLBACK_RECEIPT_SCHEMA_FOREIGN_KEY_DRIFT");
  }
  try {
    if (db.prepare("PRAGMA foreign_key_check(gs03_callback_receipts)").all().length !== 0) {
      throw new Error("foreign key violation");
    }
  } catch {
    throw new Error("GS03_CALLBACK_RECEIPT_SCHEMA_FOREIGN_KEY_CHECK_FAILED");
  }
  return true;
}

const migrationDefinition = {
  version: 20,
  name: "add immutable GS-03 callback receipts",
  owner: "T00/data-governance",
  apply(db) {
    createGs03CallbackReceiptSchema(db);
    verifyGs03CallbackReceiptSchema(db);
  },
  verify: verifyGs03CallbackReceiptSchema,
  fingerprintDependencies: Object.freeze([
    schemaStatements,
    assertForeignKeysEnabled,
    assertAuditSourceParentSchema,
    createGs03CallbackReceiptSchema,
    verifyGs03CallbackReceiptSchema
  ])
};
const GS03_CALLBACK_RECEIPT_MIGRATION = Object.freeze({
  ...migrationDefinition,
  contentFingerprint: migrationContentFingerprint(migrationDefinition)
});

module.exports = {
  GS03_CALLBACK_RECEIPT_TABLE,
  GS03_CALLBACK_RECEIPT_MIGRATION,
  createGs03CallbackReceiptSchema,
  verifyGs03CallbackReceiptSchema
};
