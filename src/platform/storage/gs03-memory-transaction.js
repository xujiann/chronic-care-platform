"use strict";

// T08 synthetic, non-production adapter. Callbacks are trusted synchronous code.
const { DatabaseSync } = require("node:sqlite");
const { types: { isPromise } } = require("node:util");

function fault(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function dataOptions(value, names) {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).length !== names.length) return null;
    if (names.some((name) => !Object.hasOwn(descriptors, name) || !Object.hasOwn(descriptors[name], "value"))) return null;
    return descriptors;
  } catch {
    return null;
  }
}

function bootstrapMigratedMemoryDatabase(db) {
  // Load only for the explicit migrated factory. The default factory remains
  // an empty, internally owned memory database with no migration dependency.
  const {
    SQLITE_MIGRATIONS, SQLITE_SCHEMA_HEAD, applySqliteMigrations,
    validateSqliteMigrationRegistry
  } = require("./sqlite-migrations");
  const {
    GS03_CALLBACK_RECEIPT_MIGRATION, verifyGs03CallbackReceiptSchema
  } = require("./gs03-callback-receipt-migration");
  const soleMain = () => {
    const databases = db.prepare("PRAGMA database_list").all();
    return databases.length === 1 && databases[0].name === "main";
  };
  const foreignKeysOn = () => db.prepare("PRAGMA foreign_keys").get()?.foreign_keys === 1;
  const ledger = () => db.prepare(`SELECT version,name,checksum,applied_at
    FROM schema_migrations ORDER BY version`).all();

  if (db.isTransaction !== false || !soleMain()) throw new Error("bootstrap admission");
  db.exec("PRAGMA foreign_keys=ON");
  if (!foreignKeysOn()) throw new Error("foreign keys unavailable");
  if (SQLITE_SCHEMA_HEAD !== 19 || !Array.isArray(SQLITE_MIGRATIONS) ||
      SQLITE_MIGRATIONS.length !== 19 ||
      SQLITE_MIGRATIONS.some((migration, index) => migration.version !== index + 1) ||
      GS03_CALLBACK_RECEIPT_MIGRATION.version !== 20 ||
      SQLITE_MIGRATIONS.includes(GS03_CALLBACK_RECEIPT_MIGRATION) ||
      validateSqliteMigrationRegistry(SQLITE_MIGRATIONS).head !== 19) {
    throw new Error("fixed registry unavailable");
  }
  const migrations = [...SQLITE_MIGRATIONS, GS03_CALLBACK_RECEIPT_MIGRATION];
  const expectedRegistryFingerprint = validateSqliteMigrationRegistry(migrations).registryFingerprint;
  const first = applySqliteMigrations(db, { migrations });
  if (first.head !== 20 || first.applied !== 20 ||
      first.registryFingerprint !== expectedRegistryFingerprint ||
      verifyGs03CallbackReceiptSchema(db) !== true || !soleMain() ||
      db.isTransaction !== false) throw new Error("initial migration incomplete");
  const before = ledger();
  if (before.length !== 20 || before.some((row, index) => row.version !== index + 1)) {
    throw new Error("initial ledger incomplete");
  }
  const again = applySqliteMigrations(db, { migrations });
  if (again.head !== 20 || again.applied !== 0 ||
      again.registryFingerprint !== first.registryFingerprint ||
      JSON.stringify(ledger()) !== JSON.stringify(before) ||
      verifyGs03CallbackReceiptSchema(db) !== true || !foreignKeysOn() ||
      !soleMain() || db.isTransaction !== false) {
    throw new Error("repeated migration inconsistent");
  }
}

function createSession(options, migrated) {
  const input = dataOptions(options, ["environment"]);
  if (!input || !["development", "test"].includes(input.environment.value)) {
    throw fault("GS03_MEMORY_ADMISSION");
  }

  let db;
  try {
    db = new DatabaseSync(":memory:");
  } catch {
    throw fault("GS03_MEMORY_OPEN");
  }
  let nativeTransaction;
  try {
    nativeTransaction = db.isTransaction;
    if (typeof nativeTransaction !== "boolean") throw fault("GS03_MEMORY_CAPABILITY");
  } catch {
    try { db.close(); } catch { /* The owned connection is already unusable. */ }
    throw fault("GS03_MEMORY_CAPABILITY");
  }
  if (migrated) {
    try {
      bootstrapMigratedMemoryDatabase(db);
    } catch {
      try { db.close(); } catch { throw fault("GS03_MEMORY_BOOTSTRAP_CLOSE"); }
      throw fault("GS03_MEMORY_BOOTSTRAP");
    }
  }

  let closed = false;
  let isolated = false;
  let lease = null;

  function transactionState() {
    try {
      const value = db.isTransaction;
      if (typeof value !== "boolean") throw fault("GS03_MEMORY_CAPABILITY");
      return value;
    } catch {
      isolated = true;
      throw fault("GS03_MEMORY_UNCERTAIN");
    }
  }

  function soleMain() {
    try {
      const databases = db.prepare("PRAGMA database_list").all();
      if (databases.length !== 1 || databases[0].name !== "main") {
        throw fault("GS03_MEMORY_ATTACHED");
      }
    } catch {
      isolated = true;
      throw fault("GS03_MEMORY_UNCERTAIN");
    }
  }

  function owned(port) {
    if (closed || isolated || lease !== port) throw fault("GS03_MEMORY_SEQUENCE");
    if (!transactionState()) {
      isolated = true;
      throw fault("GS03_MEMORY_UNCERTAIN");
    }
    soleMain();
  }

  function callback(port, fn, expected, running, next, state) {
    owned(port);
    let result;
    state.value = running;
    state.inCallback = true;
    try {
      result = fn(db);
    } catch {
      // A callback can have executed SQL before throwing. Check ownership before
      // letting the runner request a normal rollback.
      owned(port);
      throw fault("GS03_MEMORY_CALLBACK");
    } finally {
      state.inCallback = false;
    }
    try {
      if (result !== null && (typeof result === "object" || typeof result === "function") &&
          typeof result.then === "function") {
        if (isPromise(result)) Promise.prototype.then.call(result, undefined, () => {});
        isolated = true;
        throw fault("GS03_MEMORY_ASYNC");
      }
    } catch {
      isolated = true;
      throw fault("GS03_MEMORY_UNCERTAIN");
    }
    owned(port);
    if (!expected(result)) throw fault("GS03_MEMORY_RESULT");
    state.value = next;
    return result;
  }

  function createPort(options) {
    if (closed) throw fault("GS03_MEMORY_CLOSED");
    const input = dataOptions(options, ["apply", "verify"]);
    if (!input || typeof input.apply.value !== "function" || typeof input.verify.value !== "function") {
      throw fault("GS03_MEMORY_ADMISSION");
    }
    const apply = input.apply.value;
    const verify = input.verify.value;
    const state = { value: "fresh", inCallback: false };
    function rejectReentry() {
      if (!state.inCallback) return;
      isolated = true;
      throw fault("GS03_MEMORY_SEQUENCE");
    }
    const port = {
      begin() {
        if (state.value !== "fresh") {
          if (lease === port) isolated = true;
          return false;
        }
        state.value = "begin-rejected";
        if (closed || isolated || lease !== null) return false;
        try {
          if (transactionState()) return false; // Never roll back another owner's transaction.
          soleMain();
          db.exec("BEGIN IMMEDIATE");
          lease = port;
          state.value = "begun";
          owned(port);
          return true;
        } catch {
          isolated = true;
          return false;
        }
      },
      apply() {
        rejectReentry();
        if (state.value !== "begun") throw fault("GS03_MEMORY_SEQUENCE");
        return callback(port, apply, (value) => value === "first" || value === "replay", "applying", "applied", state);
      },
      verify() {
        rejectReentry();
        if (state.value !== "applied") throw fault("GS03_MEMORY_SEQUENCE");
        return callback(port, verify, (value) => value === true, "verifying", "verified", state);
      },
      commit() {
        rejectReentry();
        if (state.value !== "verified") throw fault("GS03_MEMORY_SEQUENCE");
        owned(port);
        try {
          db.exec("COMMIT");
          if (transactionState()) throw fault("GS03_MEMORY_UNCERTAIN");
          soleMain();
          lease = null;
          state.value = "committed";
          return true;
        } catch {
          isolated = true;
          throw fault("GS03_MEMORY_UNCERTAIN");
        }
      },
      rollback() {
        if (state.inCallback) {
          isolated = true;
          return false;
        }
        if (state.value === "begin-rejected") {
          state.value = "rejected-cleaned";
          return !isolated && !closed;
        }
        if (state.value === "committed") {
          // The runner calls cleanup here if a wrapper lost the success response.
          isolated = true;
          return false;
        }
        if (!["begun", "applying", "applied", "verifying", "verified"].includes(state.value)) return false;
        if (isolated || closed || lease !== port) return false;
        try {
          owned(port);
          db.exec("ROLLBACK");
          if (transactionState()) throw fault("GS03_MEMORY_UNCERTAIN");
          soleMain();
          lease = null;
          state.value = "rolled-back";
          return true;
        } catch {
          isolated = true;
          return false;
        }
      }
    };
    return Object.freeze(port);
  }

  function close() {
    if (closed) return true;
    if (!isolated && transactionState()) throw fault("GS03_MEMORY_BUSY");
    if (!isolated && lease !== null) {
      isolated = true; // The owned transaction disappeared before disposal.
    }
    try {
      db.close();
      closed = true;
      lease = null;
      return true;
    } catch {
      isolated = true;
      throw fault("GS03_MEMORY_CLOSE");
    }
  }

  return Object.freeze({ createPort, close, productionReady: false });
}

function createGs03MemoryTransactionSession(options) {
  return createSession(options, false);
}

function createGs03MigratedMemoryTransactionSession(options) {
  return createSession(options, true);
}

module.exports = { createGs03MemoryTransactionSession, createGs03MigratedMemoryTransactionSession };
