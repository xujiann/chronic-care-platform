"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  FROZEN_LEGACY_MAX_VERSION,
  SQLITE_MIGRATIONS,
  SQLITE_SCHEMA_HEAD,
  applySqliteMigrations,
  legacyLedgerChecksum,
  migrationContentFingerprint,
  readSqliteSchemaFingerprint,
  validateSqliteMigrationRegistry
} = require("../src/platform/storage/sqlite-migrations");

let DatabaseSync = null;
try {
  ({ DatabaseSync } = require("node:sqlite"));
} catch {
  // The project requires Node >=22.5; keep unsupported local runtimes explicit.
}

function openMemoryDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

function ledgerRows(db) {
  return db.prepare("SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version").all();
}

test("SQLite migration registry freezes v1-v14 and exposes continuous v18 head", { skip: !DatabaseSync }, () => {
  const report = validateSqliteMigrationRegistry(SQLITE_MIGRATIONS);

  assert.equal(FROZEN_LEGACY_MAX_VERSION, 14);
  assert.equal(SQLITE_SCHEMA_HEAD, 18);
  assert.equal(report.head, SQLITE_SCHEMA_HEAD);
  assert.match(report.registryFingerprint, /^[a-f0-9]{64}$/);
  assert.deepEqual(SQLITE_MIGRATIONS.map((migration) => migration.version), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
  SQLITE_MIGRATIONS.forEach((migration) => {
    assert.equal(migration.owner, "T00/data-governance");
    assert.match(migration.contentFingerprint, /^[a-f0-9]{64}$/);
    assert.equal(migration.contentFingerprint, migrationContentFingerprint(migration));
    assert.match(legacyLedgerChecksum(migration), /^[a-f0-9]{64}$/);
  });

  const mutated = SQLITE_MIGRATIONS.map((migration) => migration.version === 14
    ? { ...migration, contentFingerprint: undefined, apply(db) { migration.apply(db); db.exec("SELECT 1"); } }
    : migration);
  assert.throws(
    () => validateSqliteMigrationRegistry(mutated),
    /frozen content fingerprint mismatch/
  );
});

test("SQLite migrations apply from an empty database to head and rerun without ledger changes", { skip: !DatabaseSync }, () => {
  const db = openMemoryDatabase();
  try {
    const first = applySqliteMigrations(db);
    const before = ledgerRows(db);
    const second = applySqliteMigrations(db);
    const after = ledgerRows(db);

    assert.equal(first.head, SQLITE_SCHEMA_HEAD);
    assert.equal(first.applied, SQLITE_SCHEMA_HEAD);
    assert.equal(second.applied, 0);
    assert.deepEqual(after, before);
    assert.deepEqual(after.map((row) => Number(row.version)), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
    after.forEach((row, index) => {
      assert.equal(row.name, SQLITE_MIGRATIONS[index].name);
      assert.equal(
        row.checksum,
        Number(row.version) <= FROZEN_LEGACY_MAX_VERSION
          ? legacyLedgerChecksum(SQLITE_MIGRATIONS[index])
          : migrationContentFingerprint(SQLITE_MIGRATIONS[index])
      );
    });
    assert.match(readSqliteSchemaFingerprint(db), /^[a-f0-9]{64}$/);
  } finally {
    db.close();
  }
});

test("a deterministic legacy v11 fixture upgrades to head without rewriting historical ledger rows", { skip: !DatabaseSync }, () => {
  const legacy = openMemoryDatabase();
  const fresh = openMemoryDatabase();
  try {
    applySqliteMigrations(legacy, { targetVersion: 11 });
    const historicalRows = ledgerRows(legacy);
    assert.equal(historicalRows.length, 11);

    const upgraded = applySqliteMigrations(legacy);
    const upgradedRows = ledgerRows(legacy);
    applySqliteMigrations(fresh);

    assert.equal(upgraded.applied, SQLITE_SCHEMA_HEAD - 11);
    assert.deepEqual(upgradedRows.slice(0, 11), historicalRows);
    assert.deepEqual(upgradedRows.slice(11).map((row) => Number(row.version)), [12, 13, 14, 15, 16, 17, 18]);
    assert.equal(readSqliteSchemaFingerprint(legacy), readSqliteSchemaFingerprint(fresh));
  } finally {
    legacy.close();
    fresh.close();
  }
});

test("applied migration name and checksum drift fail closed before later migrations run", { skip: !DatabaseSync }, () => {
  for (const mutation of [
    { column: "name", value: "modified historical migration" },
    { column: "checksum", value: "0".repeat(64) }
  ]) {
    const db = openMemoryDatabase();
    try {
      applySqliteMigrations(db, { targetVersion: 11 });
      db.prepare(`UPDATE schema_migrations SET ${mutation.column} = ? WHERE version = 5`).run(mutation.value);

      assert.throws(() => applySqliteMigrations(db), /migration 5 (?:name|checksum) mismatch/);
      assert.equal(Number(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get().version), 11);
      assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'public_health_modernization_signal_keys'").get(), undefined);
    } finally {
      db.close();
    }
  }
});

test("future migrations use content fingerprints and roll back failed DDL atomically", { skip: !DatabaseSync }, () => {
  const base = openMemoryDatabase();
  try {
    applySqliteMigrations(base);
    const futureMigration = {
      version: SQLITE_SCHEMA_HEAD + 1,
      name: "test content-addressed migration",
      owner: "T00/data-governance",
      apply(db) {
        db.exec("CREATE TABLE migration_future_probe (id TEXT PRIMARY KEY)");
      }
    };
    const registry = [...SQLITE_MIGRATIONS, futureMigration];
    applySqliteMigrations(base, { migrations: registry });
    const row = base.prepare("SELECT checksum FROM schema_migrations WHERE version = ?").get(SQLITE_SCHEMA_HEAD + 1);
    assert.equal(row.checksum, migrationContentFingerprint(futureMigration));
  } finally {
    base.close();
  }

  const failing = openMemoryDatabase();
  try {
    applySqliteMigrations(failing);
    const futureMigration = {
      version: SQLITE_SCHEMA_HEAD + 1,
      name: "test failed transactional migration",
      owner: "T00/data-governance",
      apply(db) {
        db.exec("CREATE TABLE failed_migration_probe (id TEXT PRIMARY KEY)");
        throw new Error("fixture failure");
      }
    };

    assert.throws(
      () => applySqliteMigrations(failing, { migrations: [...SQLITE_MIGRATIONS, futureMigration] }),
      new RegExp(`SQLite migration ${SQLITE_SCHEMA_HEAD + 1} failed: fixture failure`)
    );
    assert.equal(failing.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'failed_migration_probe'").get(), undefined);
    assert.equal(failing.prepare("SELECT version FROM schema_migrations WHERE version = ?").get(SQLITE_SCHEMA_HEAD + 1), undefined);
  } finally {
    failing.close();
  }
});
