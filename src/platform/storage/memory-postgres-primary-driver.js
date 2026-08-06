"use strict";

const { canonicalStringify } = require("../../../scripts/postgres-migration-package");

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createTransaction(state, readOnly) {
  return {
    async getAppliedBatch(batchId) {
      return clone(state.batches.find((batch) => batch.batchId === batchId) || null);
    },

    async getLastAppliedBatch() {
      return clone(state.batches.at(-1) || null);
    },

    async getCollection(collection) {
      return clone(state.collections.get(collection) || null);
    },

    async listCollections() {
      return [...state.collections.values()]
        .map(clone)
        .sort((left, right) => left.collection.localeCompare(right.collection));
    },

    async applyCollectionChange(change, options = {}) {
      if (readOnly) throw new Error("memory PostgreSQL transaction is read-only");
      const current = state.collections.get(change.collection);
      const currentVersion = current ? Number(current.sourceVersion) : -1;
      if (currentVersion !== Number(options.expectedVersion)) {
        const error = new Error("memory PostgreSQL collection CAS conflict");
        error.code = "MEMORY_POSTGRES_CAS_CONFLICT";
        throw error;
      }
      const row = {
        collection: change.collection,
        sourceVersion: change.sourceVersion,
        deleted: change.operation === "delete",
        payload: change.operation === "delete" ? "null" : canonicalStringify(JSON.parse(change.payload)),
        payloadSha256: change.operation === "delete" ? "" : change.payloadSha256,
        batchId: options.batchId,
        updatedAt: options.appliedAt
      };
      state.collections.set(change.collection, row);
      return clone(row);
    },

    async recordAppliedBatch(batch) {
      if (readOnly) throw new Error("memory PostgreSQL transaction is read-only");
      state.batches.push(clone(batch));
    }
  };
}

function createMemoryPostgresPrimaryDriver(seed = {}) {
  const state = {
    collections: new Map((seed.collections || []).map((row) => [row.collection, clone(row)])),
    batches: clone(seed.batches || [])
  };
  const history = [];
  return {
    history,

    async transaction(options = {}, operation) {
      const working = {
        collections: new Map([...state.collections].map(([key, value]) => [key, clone(value)])),
        batches: clone(state.batches)
      };
      history.push({
        isolation: options.isolation,
        readOnly: Boolean(options.readOnly),
        outcome: "started"
      });
      try {
        const result = await operation(createTransaction(working, Boolean(options.readOnly)));
        if (!options.readOnly) {
          state.collections = working.collections;
          state.batches = working.batches;
        }
        history.at(-1).outcome = options.readOnly ? "read" : "committed";
        return result;
      } catch (error) {
        history.at(-1).outcome = "rolled-back";
        throw error;
      }
    },

    snapshot() {
      return {
        collections: [...state.collections.values()].map(clone),
        batches: clone(state.batches)
      };
    }
  };
}

module.exports = { createMemoryPostgresPrimaryDriver };
