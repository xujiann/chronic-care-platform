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

test("SQLite migration registry freezes continuous v1-v14 content fingerprints", { skip: !DatabaseSync }, () => {
  const report = validateSqliteMigrationRegistry(SQLITE_MIGRATIONS);

  assert.equal(FROZEN_LEGACY_MAX_VERSION, 14);
  assert.equal(SQLITE_SCHEMA_HEAD, 14);
  assert.equal(report.head, 14);
  assert.match(report.registryFingerprint, /^[a-f0-9]{64}$/);
  assert.deepEqual(SQLITE_MIGRATIONS.map((migration) => migration.version), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
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

test("SQLite migrations apply from an empty database to v14 and rerun without ledger changes", { skip: !DatabaseSync }, () => {
  const db = openMemoryDatabase();
  try {
    const first = applySqliteMigrations(db);
    const before = ledgerRows(db);
    const second = applySqliteMigrations(db);
    const after = ledgerRows(db);

    assert.equal(first.head, 14);
    assert.equal(first.applied, 14);
    assert.equal(second.applied, 0);
    assert.deepEqual(after, before);
    assert.deepEqual(after.map((row) => Number(row.version)), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    after.forEach((row, index) => {
      assert.equal(row.name, SQLITE_MIGRATIONS[index].name);
      assert.equal(row.checksum, legacyLedgerChecksum(SQLITE_MIGRATIONS[index]));
    });
    assert.match(readSqliteSchemaFingerprint(db), /^[a-f0-9]{64}$/);
  } finally {
    db.close();
  }
});

test("a deterministic legacy v11 fixture upgrades to v14 without rewriting historical ledger rows", { skip: !DatabaseSync }, () => {
  const legacy = openMemoryDatabase();
  const fresh = openMemoryDatabase();
  try {
    applySqliteMigrations(legacy, { targetVersion: 11 });
    const historicalRows = ledgerRows(legacy);
    assert.equal(historicalRows.length, 11);

    const upgraded = applySqliteMigrations(legacy);
    const upgradedRows = ledgerRows(legacy);
    applySqliteMigrations(fresh);

    assert.equal(upgraded.applied, 3);
    assert.deepEqual(upgradedRows.slice(0, 11), historicalRows);
    assert.deepEqual(upgradedRows.slice(11).map((row) => Number(row.version)), [12, 13, 14]);
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
    const migration15 = {
      version: 15,
      name: "test content-addressed migration",
      owner: "T00/data-governance",
      apply(db) {
        db.exec("CREATE TABLE migration_v15_probe (id TEXT PRIMARY KEY)");
      }
    };
    const registry = [...SQLITE_MIGRATIONS, migration15];
    applySqliteMigrations(base, { migrations: registry });
    const row = base.prepare("SELECT checksum FROM schema_migrations WHERE version = 15").get();
    assert.equal(row.checksum, migrationContentFingerprint(migration15));
  } finally {
    base.close();
  }

  const failing = openMemoryDatabase();
  try {
    applySqliteMigrations(failing);
    const migration15 = {
      version: 15,
      name: "test failed transactional migration",
      owner: "T00/data-governance",
      apply(db) {
        db.exec("CREATE TABLE failed_migration_probe (id TEXT PRIMARY KEY)");
        throw new Error("fixture failure");
      }
    };

    assert.throws(
      () => applySqliteMigrations(failing, { migrations: [...SQLITE_MIGRATIONS, migration15] }),
      /SQLite migration 15 failed: fixture failure/
    );
    assert.equal(failing.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'failed_migration_probe'").get(), undefined);
    assert.equal(failing.prepare("SELECT version FROM schema_migrations WHERE version = 15").get(), undefined);
  } finally {
    failing.close();
  }
});
