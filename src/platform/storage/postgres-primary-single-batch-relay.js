"use strict";

// Explicit, one-batch rehearsal port. No server or worker imports this module.
const { loadBoundSqliteOutboxBatches } = require("./sqlite-outbox-commit-receipt");
const { createPrimaryDurableCheckpoint } = require("./postgres-primary-durable-checkpoint");
const { createPostgresPrimaryStorageContract } = require("./postgres-primary-storage-contract");

class PrimaryRelayError extends Error {
  constructor(code) {
    super("Primary relay validation failed");
    this.name = "PrimaryRelayError";
    this.code = `POSTGRES_PRIMARY_RELAY_${code}`;
  }
}

function createPrimarySingleBatchRelay({ sourceFile, checkpointFile, driver, contractConfig, expectedTargetId }) {
  if (typeof sourceFile !== "string" || !sourceFile ||
    typeof checkpointFile !== "string" || !checkpointFile ||
    typeof expectedTargetId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(expectedTargetId) ||
    driver?.status?.().supportsBoundIdentity !== true || typeof driver?.transaction !== "function" ||
    !contractConfig?.modeReady || !contractConfig?.capabilities?.shadowApply && !contractConfig?.capabilities?.primaryWriteRelay) {
    throw new PrimaryRelayError("INPUT_INVALID");
  }
  // Both ports close over the same source, driver and target binding. Callers cannot
  // accidentally pair an empty checkpoint for target A with a writer for target B.
  const checkpoint = createPrimaryDurableCheckpoint({ sourceFile, checkpointFile, driver, expectedTargetId });
  const contract = createPostgresPrimaryStorageContract({ config: contractConfig, driver });

  return Object.freeze({
    async runOnce() {
      // Reading first validates the durable cursor against both source and target.
      // A missing checkpoint must never be silently initialized here.
      const after = await checkpoint.read();
      const next = loadBoundSqliteOutboxBatches(sourceFile, after ? { after, limit: 1 } : { limit: 1 })[0];
      if (!next) return Object.freeze({ status: "idle", outboxSequence: after?.outboxSequence || 0 });
      const result = await contract.applyBoundCommittedOutbox(next,
        { expectedTargetId, namespace: "health_platform", executionContext: "rehearsal" });
      if (!result || result.ok !== true || !["applied", "duplicate"].includes(result.status) ||
        result.batchId !== next.batch.batchId) throw new PrimaryRelayError("TARGET_RESULT_INVALID");
      const cursor = await checkpoint.advance(next);
      if (cursor.outboxSequence !== next.commitment.outboxSequence ||
        cursor.batchId !== next.batch.batchId || cursor.payloadSha256 !== next.batch.payloadSha256 ||
        cursor.chainHash !== next.batch.chainHash) throw new PrimaryRelayError("CHECKPOINT_RESULT_INVALID");
      return Object.freeze({ status: result.status, outboxSequence: cursor.outboxSequence });
    }
  });
}

module.exports = { PrimaryRelayError, createPrimarySingleBatchRelay };
