"use strict";

// DATA-009: synthetic SQLite only. The proposed migration is deliberately not
// registered with the runtime and this suite never opens an application DB.
const assert = require("node:assert/strict");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { auditHashFor } = require("../src/identity-security/audit-chain");
const { appendAuditDeliverySourceChanges } = require("../src/identity-security/audit-delivery-source");
const {
  SQLITE_MIGRATIONS,
  SQLITE_SCHEMA_HEAD,
  applySqliteMigrations,
  migrationContentFingerprint,
  readSqliteSchemaFingerprint
} = require("../src/platform/storage/sqlite-migrations");
const {
  GS03_CALLBACK_RECEIPT_TABLE,
  GS03_CALLBACK_RECEIPT_MIGRATION,
  verifyGs03CallbackReceiptSchema
} = require("../src/platform/storage/gs03-callback-receipt-migration");

const PROPOSED = [...SQLITE_MIGRATIONS, GS03_CALLBACK_RECEIPT_MIGRATION];
const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const DIGEST_C = "c".repeat(64);
const RECORDED_AT = "2026-10-03T00:00:00.000Z";
const COLUMNS = [
  "receipt_id", "namespace_digest", "contract_id", "contract_version", "key_digest",
  "target_id", "authorization_id", "intent_digest_version", "intent_digest",
  "result_status", "recorded_at_ms", "security_stream", "security_audit_event_id",
  "access_stream", "access_audit_event_id"
];

function openDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  assert.equal(Number(db.prepare("PRAGMA foreign_keys").get().foreign_keys), 1);
  return db;
}

function ledger(db) {
  return db.prepare("SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version").all();
}

function tableExists(db) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(GS03_CALLBACK_RECEIPT_TABLE));
}

function receiptCount(db) {
  return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${GS03_CALLBACK_RECEIPT_TABLE}`).get().count);
}

function receipt(overrides = {}) {
  return {
    receipt_id: "receipt-synthetic-1",
    namespace_digest: DIGEST_A,
    contract_id: "referral-feedback-callback",
    contract_version: 2,
    key_digest: DIGEST_B,
    target_id: "case-synthetic-1",
    authorization_id: "authorization-synthetic-1",
    intent_digest_version: 2,
    intent_digest: DIGEST_C,
    result_status: "committed",
    recorded_at_ms: 1790985600000,
    security_stream: "securityEvents",
    security_audit_event_id: "security-synthetic-1",
    access_stream: "dataAccessLogs",
    access_audit_event_id: "access-synthetic-1",
    ...overrides
  };
}

function insertReceipt(db, value, verb = "INSERT") {
  const row = receipt(value);
  return db.prepare(`${verb} INTO ${GS03_CALLBACK_RECEIPT_TABLE} (${COLUMNS.join(", ")}) VALUES (${COLUMNS.map(() => "?").join(", ")})`)
    .run(...COLUMNS.map((column) => row[column]));
}

function auditEvent(id, at, details) {
  const value = { id, at, ...details, previousAuditHash: "" };
  return { ...value, auditHash: auditHashFor(value) };
}

function seedActualV15AuditSource(db, {
  securityId = "security-synthetic-1", accessId = "access-synthetic-1"
} = {}) {
  const state = {
    securityEvents: [auditEvent(securityId, RECORDED_AT, {
      action: "synthetic-success", result: "allowed", actor: "synthetic-actor"
    })],
    dataAccessLogs: [auditEvent(accessId, RECORDED_AT, {
      result: "allowed", actor: "synthetic-actor", scope: "synthetic-scope"
    })]
  };
  const result = appendAuditDeliverySourceChanges(db, {}, state, { recordedAt: RECORDED_AT });
  assert.equal(result.inserted, 2);
  return db.prepare("SELECT * FROM audit_delivery_source_events ORDER BY sequence").all();
}

function openCandidateDatabase() {
  const db = openDatabase();
  applySqliteMigrations(db, { migrations: PROPOSED });
  seedActualV15AuditSource(db);
  return db;
}

test("candidate remains absent from default registry and default empty database", () => {
  const db = openDatabase();
  try {
    assert.equal(SQLITE_SCHEMA_HEAD, 19);
    assert.deepEqual(SQLITE_MIGRATIONS.map((entry) => entry.version), Array.from({ length: 19 }, (_, index) => index + 1));
    assert.equal(GS03_CALLBACK_RECEIPT_MIGRATION.version, SQLITE_SCHEMA_HEAD + 1);
    assert.equal(GS03_CALLBACK_RECEIPT_MIGRATION.owner, "T00/data-governance");
    assert.equal(SQLITE_MIGRATIONS.includes(GS03_CALLBACK_RECEIPT_MIGRATION), false);
    const result = applySqliteMigrations(db);
    assert.equal(result.head, 19);
    assert.equal(tableExists(db), false);
    assert.equal(ledger(db).length, 19);
  } finally {
    db.close();
  }
});

test("explicit candidate upgrades every supported prefix 0..19 with stable history and schema", () => {
  let expectedFingerprint;
  for (let prefix = 0; prefix <= 19; prefix += 1) {
    const db = openDatabase();
    try {
      applySqliteMigrations(db, { targetVersion: prefix });
      const priorLedger = ledger(db);
      const result = applySqliteMigrations(db, { migrations: PROPOSED });
      assert.equal(result.head, 20, `prefix ${prefix}`);
      assert.equal(result.applied, 20 - prefix, `prefix ${prefix}`);
      assert.deepEqual(ledger(db).slice(0, prefix), priorLedger, `historical ledger ${prefix}`);
      assert.equal(tableExists(db), true, `prefix ${prefix}`);
      assert.equal(verifyGs03CallbackReceiptSchema(db), true, `prefix ${prefix}`);
      const rows = ledger(db);
      assert.equal(rows.length, 20, `prefix ${prefix}`);
      assert.equal(rows[19].checksum, migrationContentFingerprint(GS03_CALLBACK_RECEIPT_MIGRATION));
      const fingerprint = readSqliteSchemaFingerprint(db);
      expectedFingerprint ||= fingerprint;
      assert.equal(fingerprint, expectedFingerprint, `schema fingerprint ${prefix}`);
    } finally {
      db.close();
    }
  }
});

test("candidate preserves the real v15 audit chain, does not forge legacy receipts, and reruns without writes", () => {
  const db = openDatabase();
  try {
    applySqliteMigrations(db);
    const sourceBefore = seedActualV15AuditSource(db);
    assert.equal(sourceBefore[0].previous_source_hash, "");
    assert.equal(sourceBefore[1].previous_source_hash, sourceBefore[0].source_hash);
    db.prepare("INSERT INTO state_collections (key, payload, updated_at, version) VALUES (?, ?, ?, ?)")
      .run("integrationGatewayEvents", JSON.stringify([{
        contractId: "referral-feedback-callback", idempotencyKey: "legacy-key-without-proof"
      }]), RECORDED_AT, 1);
    const existingCollections = db.prepare("SELECT * FROM state_collections ORDER BY key").all();

    const first = applySqliteMigrations(db, { migrations: PROPOSED });
    assert.equal(first.applied, 1);
    assert.equal(receiptCount(db), 0);
    const firstLedger = ledger(db);
    const firstSchema = readSqliteSchemaFingerprint(db);
    const second = applySqliteMigrations(db, { migrations: PROPOSED });
    assert.equal(second.applied, 0);
    assert.deepEqual(ledger(db), firstLedger);
    assert.equal(readSqliteSchemaFingerprint(db), firstSchema);
    assert.deepEqual(db.prepare("SELECT * FROM audit_delivery_source_events ORDER BY sequence").all(), sourceBefore);
    assert.deepEqual(db.prepare("SELECT * FROM state_collections ORDER BY key").all(), existingCollections);
    assert.equal(receiptCount(db), 0);
  } finally {
    db.close();
  }
});

test("candidate rejects disabled foreign keys before creating schema", () => {
  const db = openDatabase();
  try {
    applySqliteMigrations(db);
    db.exec("PRAGMA foreign_keys = OFF");
    assert.throws(() => applySqliteMigrations(db, { migrations: PROPOSED }), /GS03_CALLBACK_RECEIPT_SCHEMA_|foreign.key/i);
    assert.equal(tableExists(db), false);
    assert.equal(ledger(db).length, 19);
  } finally {
    db.close();
  }
});

test("foreign keys, unique namespace key, and immutable rows are enforced by SQLite", () => {
  const db = openCandidateDatabase();
  try {
    insertReceipt(db, {});
    assert.equal(receiptCount(db), 1);
    assert.throws(() => insertReceipt(db, { receipt_id: "receipt-synthetic-2" }), /constraint|unique|immutable|duplicate/i);
    assert.throws(() => insertReceipt(db, { receipt_id: "receipt-synthetic-2", key_digest: DIGEST_C,
      security_audit_event_id: "missing-security-event" }), /foreign.key|constraint/i);
    assert.throws(() => insertReceipt(db, { receipt_id: "receipt-synthetic-2", key_digest: DIGEST_C,
      access_audit_event_id: "missing-access-event" }), /foreign.key|constraint/i);
    assert.throws(() => db.prepare(`UPDATE ${GS03_CALLBACK_RECEIPT_TABLE} SET result_status = result_status WHERE receipt_id = ?`)
      .run("receipt-synthetic-1"), /append.only|immutable|update|constraint/i);
    assert.throws(() => db.prepare(`DELETE FROM ${GS03_CALLBACK_RECEIPT_TABLE} WHERE receipt_id = ?`)
      .run("receipt-synthetic-1"), /append.only|immutable|delete|constraint/i);
    assert.equal(receiptCount(db), 1);
    insertReceipt(db, { receipt_id: "receipt-synthetic-2", key_digest: DIGEST_C,
      contract_id: "referral-schedule-callback" });
    insertReceipt(db, { receipt_id: "receipt-synthetic-3", namespace_digest: DIGEST_B });
    assert.equal(receiptCount(db), 3);
  } finally {
    db.close();
  }
});

test("INSERT OR REPLACE cannot erase a receipt with recursive triggers disabled", () => {
  const db = openCandidateDatabase();
  try {
    db.exec("PRAGMA recursive_triggers = OFF");
    assert.equal(Number(db.prepare("PRAGMA recursive_triggers").get().recursive_triggers), 0);
    insertReceipt(db, {});
    const before = db.prepare(`SELECT * FROM ${GS03_CALLBACK_RECEIPT_TABLE}`).all();
    assert.throws(() => insertReceipt(db, { result_status: "committed", target_id: "changed-target" }, "INSERT OR REPLACE"), /immutable|duplicate|constraint|replace/i);
    assert.throws(() => insertReceipt(db, { receipt_id: "new-receipt", target_id: "changed-target" }, "INSERT OR REPLACE"), /immutable|duplicate|constraint|replace/i);
    assert.deepEqual(db.prepare(`SELECT * FROM ${GS03_CALLBACK_RECEIPT_TABLE}`).all(), before);
  } finally {
    db.close();
  }
});

test("each column is NOT NULL and STRICT rejects incompatible storage classes", () => {
  const db = openCandidateDatabase();
  try {
    for (const column of COLUMNS) {
      assert.throws(() => insertReceipt(db, { [column]: null }), /constraint|NOT NULL/i, column);
      assert.equal(receiptCount(db), 0, column);
    }
    for (const column of COLUMNS.filter((name) => !["contract_version", "intent_digest_version", "recorded_at_ms"].includes(name))) {
      assert.throws(() => insertReceipt(db, { [column]: Buffer.from("wrong-type") }),
        /cannot store BLOB value in TEXT column/i, column);
    }
    for (const column of ["contract_version", "intent_digest_version", "recorded_at_ms"]) {
      assert.throws(() => insertReceipt(db, { [column]: 1.5 }),
        /cannot store REAL value in INTEGER column/i, column);
    }
    assert.equal(receiptCount(db), 0);
  } finally {
    db.close();
  }
});

test("digest, enum, version, timestamp and identifier boundaries reject invalid values", () => {
  const db = openCandidateDatabase();
  try {
    for (const column of ["namespace_digest", "key_digest", "intent_digest"]) {
      for (const value of ["a".repeat(63), "A".repeat(64), "g".repeat(64), "a".repeat(65),
        `\u0000${"a".repeat(64)}`, `${"a".repeat(32)}\u0000${"a".repeat(32)}`,
        `${"a".repeat(64)}\u0000suffix`, "é".repeat(32)]) {
        assert.throws(() => insertReceipt(db, { [column]: value }), /constraint|CHECK/i, `${column}:${value.length}`);
      }
    }
    for (const value of ["feedback", "referral-unknown-callback", ""]) {
      assert.throws(() => insertReceipt(db, { contract_id: value }), /constraint|CHECK/i);
    }
    for (const column of ["contract_version", "intent_digest_version"]) {
      for (const value of [0, 1, 3]) assert.throws(() => insertReceipt(db, { [column]: value }), /constraint|CHECK/i);
    }
    for (const value of [-1, 8640000000000001]) {
      assert.throws(() => insertReceipt(db, { recorded_at_ms: value }), /constraint|CHECK/i);
    }
    for (const [column, limit] of [
      ["receipt_id", 128], ["target_id", 240], ["authorization_id", 240],
      ["security_audit_event_id", 240], ["access_audit_event_id", 240]
    ]) {
      for (const value of ["", " leading", "trailing ", "\tleading", "trailing\t",
        "\u00a0leading", "trailing\u00a0", "\u2003leading", "trailing\u2003",
        "\ufeffleading", "trailing\ufeff",
        "\u0000prefix", "nul\u0000inside", "suffix\u0000",
        "é".repeat(Math.ceil(limit / 2) + 1)]) {
        assert.throws(() => insertReceipt(db, { [column]: value }), /CHECK constraint failed/i, column);
      }
    }
    assert.throws(() => insertReceipt(db, { security_stream: "dataAccessLogs" }), /constraint|CHECK|foreign.key/i);
    assert.throws(() => insertReceipt(db, { access_stream: "securityEvents" }), /constraint|CHECK|foreign.key/i);
    assert.equal(receiptCount(db), 0);
  } finally {
    db.close();
  }
});

test("all bounded identifiers accept their exact UTF-8 byte limit", () => {
  const db = openDatabase();
  try {
    applySqliteMigrations(db, { migrations: PROPOSED });
    const securityId = "é".repeat(120);
    const accessId = "à".repeat(120);
    seedActualV15AuditSource(db, { securityId, accessId });
    insertReceipt(db, {
      receipt_id: "é".repeat(64),
      target_id: "é".repeat(120),
      authorization_id: "à".repeat(120),
      security_audit_event_id: securityId,
      access_audit_event_id: accessId
    });
    assert.equal(receiptCount(db), 1);
  } finally {
    db.close();
  }
});

test("DDL or ledger failure rolls back the candidate without touching v15 audit source", () => {
  for (const failure of ["after-ddl", "ledger-insert"]) {
    const db = openDatabase();
    try {
      applySqliteMigrations(db);
      const sourceBefore = seedActualV15AuditSource(db);
      if (failure === "ledger-insert") {
        db.exec(`CREATE TRIGGER reject_candidate_ledger BEFORE INSERT ON schema_migrations
          WHEN NEW.version = 20 BEGIN SELECT RAISE(ABORT, 'synthetic ledger failure'); END`);
      }
      const ledgerBefore = ledger(db);
      const schemaBefore = readSqliteSchemaFingerprint(db);
      const candidate = failure === "after-ddl"
        ? { ...GS03_CALLBACK_RECEIPT_MIGRATION, contentFingerprint: undefined,
          apply(connection) {
            GS03_CALLBACK_RECEIPT_MIGRATION.apply(connection);
            throw new Error("synthetic DDL interruption");
          } }
        : GS03_CALLBACK_RECEIPT_MIGRATION;
      assert.throws(
        () => applySqliteMigrations(db, { migrations: [...SQLITE_MIGRATIONS, candidate] }),
        /SQLite migration 20 failed/
      );
      assert.equal(tableExists(db), false, failure);
      assert.deepEqual(ledger(db), ledgerBefore, failure);
      assert.equal(readSqliteSchemaFingerprint(db), schemaBefore, failure);
      assert.deepEqual(db.prepare("SELECT * FROM audit_delivery_source_events ORDER BY sequence").all(), sourceBefore, failure);
    } finally {
      db.close();
    }
  }
});

test("candidate rejects absent or malformed v15 parent schema without advancing its ledger", () => {
  const brokenParents = {
    absent: "DROP TABLE audit_delivery_source_events",
    wrongColumn: `DROP TABLE audit_delivery_source_events;
      CREATE TABLE audit_delivery_source_events (
        stream TEXT NOT NULL, wrong_event_id TEXT NOT NULL,
        UNIQUE(stream, wrong_event_id))`,
    missingCompositeUnique: `DROP TABLE audit_delivery_source_events;
      CREATE TABLE audit_delivery_source_events (
        stream TEXT NOT NULL, source_event_id TEXT NOT NULL)`,
    indexWithNoCase: `DROP TABLE audit_delivery_source_events;
      CREATE TABLE audit_delivery_source_events (
        stream TEXT NOT NULL, source_event_id TEXT NOT NULL);
      CREATE UNIQUE INDEX parent_wrong_collation ON audit_delivery_source_events
        (stream COLLATE NOCASE, source_event_id)`,
    columnWithNoCase: `DROP TABLE audit_delivery_source_events;
      CREATE TABLE audit_delivery_source_events (
        stream TEXT NOT NULL COLLATE NOCASE, source_event_id TEXT NOT NULL);
      CREATE UNIQUE INDEX parent_wrong_column_collation ON audit_delivery_source_events
        (stream COLLATE BINARY, source_event_id COLLATE BINARY)`
  };
  for (const [name, damage] of Object.entries(brokenParents)) {
    const db = openDatabase();
    try {
      applySqliteMigrations(db);
      db.exec(damage);
      const ledgerBefore = ledger(db);
      const schemaBefore = readSqliteSchemaFingerprint(db);
      assert.throws(() => applySqliteMigrations(db, { migrations: PROPOSED }),
        /SQLite migration 20 failed: GS03_CALLBACK_RECEIPT_SCHEMA_/, name);
      assert.equal(tableExists(db), false, name);
      assert.deepEqual(ledger(db), ledgerBefore, name);
      assert.equal(readSqliteSchemaFingerprint(db), schemaBefore, name);
    } finally {
      db.close();
    }
  }
});

test("explicit verification rejects orphan audit references in a previously applied candidate", () => {
  const db = openCandidateDatabase();
  try {
    db.exec("PRAGMA foreign_keys = OFF");
    insertReceipt(db, {
      receipt_id: "orphan-synthetic",
      key_digest: DIGEST_C,
      security_audit_event_id: "missing-security-event"
    });
    db.exec("PRAGMA foreign_keys = ON");
    assert.equal(Number(db.prepare("PRAGMA foreign_keys").get().foreign_keys), 1);
    assert.equal(receiptCount(db), 1);
    assert.throws(() => verifyGs03CallbackReceiptSchema(db),
      /GS03_CALLBACK_RECEIPT_SCHEMA_FOREIGN_KEY_CHECK_FAILED/);
  } finally {
    db.close();
  }
});

test("candidate content, applied checksum and schema drift fail closed", () => {
  const db = openCandidateDatabase();
  try {
    const applied = ledger(db);
    const schemaBefore = readSqliteSchemaFingerprint(db);
    const changedDefinition = {
      ...GS03_CALLBACK_RECEIPT_MIGRATION,
      contentFingerprint: undefined,
      fingerprintDependencies: [...GS03_CALLBACK_RECEIPT_MIGRATION.fingerprintDependencies, () => "changed" ]
    };
    assert.notEqual(migrationContentFingerprint(changedDefinition), applied[19].checksum);
    assert.throws(() => applySqliteMigrations(db, { migrations: [...SQLITE_MIGRATIONS, changedDefinition] }), /migration 20 checksum mismatch/);
    assert.deepEqual(ledger(db), applied);

    db.prepare("UPDATE schema_migrations SET checksum = ? WHERE version = 20").run("0".repeat(64));
    assert.throws(() => applySqliteMigrations(db, { migrations: PROPOSED }), /migration 20 checksum mismatch/);
    db.prepare("UPDATE schema_migrations SET checksum = ? WHERE version = 20").run(applied[19].checksum);

    const index = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL ORDER BY name LIMIT 1")
      .get(GS03_CALLBACK_RECEIPT_TABLE);
    assert.ok(index);
    db.exec(`DROP INDEX ${index.name}`);
    assert.equal(applySqliteMigrations(db, { migrations: PROPOSED }).applied, 0,
      "ledger rerun does not itself verify already applied schema");
    assert.throws(() => verifyGs03CallbackReceiptSchema(db), /GS03_CALLBACK_RECEIPT_SCHEMA_/);
    assert.notEqual(readSqliteSchemaFingerprint(db), schemaBefore);
  } finally {
    db.close();
  }
});

test("explicit verification detects removed or weakened guards, extra column, and changed FK", () => {
  const damageCases = {
    noUpdateRemoved(db) { db.exec("DROP TRIGGER gs03_callback_receipts_no_update"); },
    noDeleteRemoved(db) { db.exec("DROP TRIGGER gs03_callback_receipts_no_delete"); },
    noReplaceRemoved(db) { db.exec("DROP TRIGGER gs03_callback_receipts_no_replace"); },
    noUpdateWeakened(db) {
      db.exec(`DROP TRIGGER gs03_callback_receipts_no_update;
        CREATE TRIGGER gs03_callback_receipts_no_update BEFORE UPDATE ON gs03_callback_receipts
        BEGIN SELECT 1; END`);
    },
    noDeleteWeakened(db) {
      db.exec(`DROP TRIGGER gs03_callback_receipts_no_delete;
        CREATE TRIGGER gs03_callback_receipts_no_delete BEFORE DELETE ON gs03_callback_receipts
        BEGIN SELECT 1; END`);
    },
    noReplaceWeakened(db) {
      db.exec(`DROP TRIGGER gs03_callback_receipts_no_replace;
        CREATE TRIGGER gs03_callback_receipts_no_replace BEFORE INSERT ON gs03_callback_receipts
        BEGIN SELECT 1; END`);
    },
    extraIndex(db) {
      db.exec("CREATE INDEX gs03_callback_receipts_extra ON gs03_callback_receipts(target_id)");
    },
    extraSqlitexTrigger(db) {
      db.exec(`CREATE TRIGGER sqlitex_unexpected BEFORE INSERT ON gs03_callback_receipts
        BEGIN SELECT RAISE(IGNORE); END`);
      const ignored = insertReceipt(db, {});
      assert.equal(Number(ignored.changes), 0, "unexpected trigger silently suppresses a valid insert");
      assert.equal(receiptCount(db), 0);
    },
    extraColumn(db) { db.exec("ALTER TABLE gs03_callback_receipts ADD COLUMN unapproved TEXT"); },
    changedForeignKey(db) {
      const objects = db.prepare(`SELECT type, sql FROM sqlite_master
        WHERE tbl_name = ? AND type IN ('table', 'index', 'trigger') AND sql IS NOT NULL
        ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, name`)
        .all(GS03_CALLBACK_RECEIPT_TABLE);
      const table = objects.find((item) => item.type === "table");
      assert.ok(table);
      const changed = table.sql.replace(
        "REFERENCES audit_delivery_source_events(stream, source_event_id) ON DELETE RESTRICT",
        "REFERENCES audit_delivery_source_events(stream, sequence) ON DELETE RESTRICT"
      );
      assert.notEqual(changed, table.sql);
      db.exec(`DROP TABLE ${GS03_CALLBACK_RECEIPT_TABLE}`);
      db.exec(`${changed};`);
      for (const object of objects.filter((item) => item.type !== "table")) db.exec(`${object.sql};`);
    }
  };
  for (const [name, damage] of Object.entries(damageCases)) {
    const db = openCandidateDatabase();
    try {
      const before = readSqliteSchemaFingerprint(db);
      damage(db);
      if (name === "extraSqlitexTrigger") {
        assert.equal(readSqliteSchemaFingerprint(db), before,
          "shared fingerprint currently omits this prefix; candidate verification must still reject it");
      } else {
        assert.notEqual(readSqliteSchemaFingerprint(db), before, name);
      }
      assert.equal(applySqliteMigrations(db, { migrations: PROPOSED }).applied, 0, name);
      assert.throws(() => verifyGs03CallbackReceiptSchema(db), /GS03_CALLBACK_RECEIPT_SCHEMA_/, name);
    } finally {
      db.close();
    }
  }
});
