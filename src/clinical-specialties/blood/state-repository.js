"use strict";

const {
  EXTERNAL_READ_COLLECTIONS,
  OWNED_COLLECTIONS
} = require("./boundary");

function requireFunction(value, name) {
  if (typeof value !== "function") throw new TypeError(`blood state repository requires ${name}`);
  return value;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Reflect.ownKeys(value).forEach((key) => deepFreeze(value[key], seen));
  return Object.freeze(value);
}

function detachedReadOnlySnapshot(value) {
  return deepFreeze(structuredClone(value));
}

function createLegacyBloodStateRepository(options = {}) {
  const readDatabase = requireFunction(options.readDatabase, "readDatabase");
  const writeDatabase = requireFunction(options.writeDatabase, "writeDatabase");
  const readable = new Set([...OWNED_COLLECTIONS, ...EXTERNAL_READ_COLLECTIONS]);
  const externalReadOnly = new Set(EXTERNAL_READ_COLLECTIONS);
  const writable = new Set(OWNED_COLLECTIONS);
  const scopedStates = new WeakMap();

  function read() {
    const source = readDatabase();
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      throw new TypeError("blood state repository expected an object state");
    }
    const externalSnapshots = new Map();
    const scoped = new Proxy(source, {
      get(target, property, receiver) {
        if (typeof property === "symbol") return Reflect.get(target, property, receiver);
        if (externalReadOnly.has(property)) {
          if (!externalSnapshots.has(property)) {
            externalSnapshots.set(property, detachedReadOnlySnapshot(Reflect.get(target, property, receiver)));
          }
          return externalSnapshots.get(property);
        }
        if (readable.has(property)) return Reflect.get(target, property, receiver);
        throw new Error(`blood state read outside boundary: ${String(property)}`);
      },
      set(target, property, value) {
        if (!writable.has(property)) {
          throw new Error(`blood state write outside boundary: ${String(property)}`);
        }
        return Reflect.set(target, property, value);
      },
      deleteProperty(_target, property) {
        throw new Error(`blood state collection deletion is forbidden: ${String(property)}`);
      },
      defineProperty(_target, property) {
        throw new Error(`blood state property definition is forbidden: ${String(property)}`);
      },
      setPrototypeOf() {
        throw new Error("blood state prototype mutation is forbidden");
      },
      preventExtensions() {
        throw new Error("blood state preventing extensions is forbidden");
      },
      ownKeys(target) {
        return Reflect.ownKeys(target).filter((property) => typeof property === "symbol" || readable.has(property));
      },
      getOwnPropertyDescriptor(target, property) {
        if (typeof property !== "symbol" && !readable.has(property)) return undefined;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
      has(_target, property) {
        return typeof property === "symbol" || readable.has(property);
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
