"use strict";

// T08 synthetic, non-production adapter. Callbacks are trusted synchronous code.
const { DatabaseSync } = require("node:sqlite");

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

function createGs03MemoryTransactionSession(options) {
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

  function callback(port, fn, expected, next, state) {
    owned(port);
    let result;
    try {
      result = fn(db);
    } catch {
      // A callback can have executed SQL before throwing. Check ownership before
      // letting the runner request a normal rollback.
      owned(port);
      throw fault("GS03_MEMORY_CALLBACK");
    }
    try {
      if (result !== null && (typeof result === "object" || typeof result === "function") &&
          typeof result.then === "function") {
        if (result instanceof Promise) Promise.prototype.then.call(result, undefined, () => {});
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
    const state = { value: "fresh" };
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
        if (state.value !== "begun") throw fault("GS03_MEMORY_SEQUENCE");
        return callback(port, apply, (value) => value === "first" || value === "replay", "applied", state);
      },
      verify() {
        if (state.value !== "applied") throw fault("GS03_MEMORY_SEQUENCE");
        return callback(port, verify, (value) => value === true, "verified", state);
      },
      commit() {
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
        if (state.value === "begin-rejected") {
          state.value = "rejected-cleaned";
          return !isolated && !closed;
        }
        if (state.value === "committed") {
          // The runner calls cleanup here if a wrapper lost the success response.
          isolated = true;
          return false;
        }
        if (!["begun", "applied", "verified"].includes(state.value)) return false;
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

module.exports = { createGs03MemoryTransactionSession };
