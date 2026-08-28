"use strict";

const {
  EXTERNAL_READ_COLLECTIONS,
  OWNED_COLLECTIONS
} = require("./boundary");

function requireFunction(value, name) {
  if (typeof value !== "function") throw new TypeError(`blood state repository requires ${name}`);
  return value;
}

function createLegacyBloodStateRepository(options = {}) {
  const readDatabase = requireFunction(options.readDatabase, "readDatabase");
  const writeDatabase = requireFunction(options.writeDatabase, "writeDatabase");
  const readable = new Set([...OWNED_COLLECTIONS, ...EXTERNAL_READ_COLLECTIONS]);
  const writable = new Set(OWNED_COLLECTIONS);
  const scopedStates = new WeakMap();

  function read() {
    const source = readDatabase();
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      throw new TypeError("blood state repository expected an object state");
    }
    const scoped = new Proxy(source, {
      get(target, property, receiver) {
        if (typeof property === "symbol" || readable.has(property)) {
          return Reflect.get(target, property, receiver);
        }
        throw new Error(`blood state read outside boundary: ${String(property)}`);
      },
      set(target, property, value, receiver) {
        if (!writable.has(property)) {
          throw new Error(`blood state write outside boundary: ${String(property)}`);
        }
        return Reflect.set(target, property, value, receiver);
      },
      deleteProperty(_target, property) {
        throw new Error(`blood state collection deletion is forbidden: ${String(property)}`);
      }
    });
    scopedStates.set(scoped, source);
    return scoped;
  }

  function commit(scoped) {
    const source = scopedStates.get(scoped);
    if (!source) throw new TypeError("blood state repository can only commit a state returned by read()");
    writeDatabase(source);
    return scoped;
  }

  return Object.freeze({ read, commit });
}

module.exports = { createLegacyBloodStateRepository };
