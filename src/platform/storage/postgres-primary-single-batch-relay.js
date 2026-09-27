"use strict";

// Explicit, one-batch rehearsal port. No server or worker imports this module.
const { loadBoundSqliteOutboxBatches } = require("./sqlite-outbox-commit-receipt");
const { createPrimaryDurableCheckpoint } = require("./postgres-primary-durable-checkpoint");
const { createPostgresPrimaryStorageContract } = require("./postgres-primary-storage-contract");
const { attachWorkerObservability } = require("../operations/worker-observability-contract");

// Closed allowlist, not a prefix/regex pass-through of driver-supplied strings.
const SAFE_ERROR_CODES = new Set([
  "POSTGRES_PRIMARY_CHECKPOINT_MISSING", "POSTGRES_PRIMARY_CHECKPOINT_SCHEMA_INVALID",
  "POSTGRES_PRIMARY_CHECKPOINT_IDENTITY_MISMATCH", "POSTGRES_PRIMARY_CHECKPOINT_DRIFT",
  "POSTGRES_PRIMARY_CHECKPOINT_SOURCE_EMPTY", "POSTGRES_PRIMARY_CHECKPOINT_SOURCE_MISMATCH",
  "POSTGRES_PRIMARY_CHECKPOINT_TARGET_MISMATCH", "POSTGRES_PRIMARY_CHECKPOINT_CONFLICT",
  "POSTGRES_PRIMARY_IDENTITY_MISMATCH", "POSTGRES_PRIMARY_IDEMPOTENCY_CONFLICT",
  "POSTGRES_PRIMARY_OUTBOX_CHAIN_CONFLICT", "POSTGRES_PRIMARY_COLLECTION_VERSION_CONFLICT",
  "POSTGRES_PRIMARY_COLLECTION_CAS_CONFLICT", "POSTGRES_PRIMARY_STORAGE_CAPABILITY_BLOCKED",
  "POSTGRES_PRIMARY_RELAY_TARGET_RESULT_INVALID", "POSTGRES_PRIMARY_RELAY_CHECKPOINT_RESULT_INVALID"
]);

function safeErrorCode(error) {
  try {
    // Do not evaluate getters or stringify arbitrary objects supplied by a driver.
    const code = error && Object.getOwnPropertyDescriptor(error, "code")?.value;
    if (typeof code === "string" && SAFE_ERROR_CODES.has(code)) return code;
  } catch { /* An opaque thrown value has no safe diagnostic fields. */ }
  return "POSTGRES_PRIMARY_RELAY_EXECUTION_FAILED";
}

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

  async function execute(state) {
      // Reading first validates the durable cursor against both source and target.
      // A missing checkpoint must never be silently initialized here.
      const after = await checkpoint.read();
      state.phase = "source-read";
      const next = loadBoundSqliteOutboxBatches(sourceFile, after ? { after, limit: 1 } : { limit: 1 })[0];
      if (!next) {
        state.phase = "complete";
        return Object.freeze({ status: "idle", outboxSequence: after?.outboxSequence || 0 });
      }
      state.claimed = 1;
      state.phase = "target-apply";
      state.targetCommit = "unknown";
      const result = await contract.applyBoundCommittedOutbox(next,
        { expectedTargetId, namespace: "health_platform", executionContext: "rehearsal" });
      const targetStatus = result?.status;
      if (!result || result.ok !== true || !["applied", "duplicate"].includes(targetStatus) ||
        result.batchId !== next.batch.batchId) throw new PrimaryRelayError("TARGET_RESULT_INVALID");
      state.targetCommit = "confirmed";
      state.phase = "checkpoint-advance";
      state.checkpointCommit = "unknown";
      const cursor = await checkpoint.advance(next);
      if (cursor.outboxSequence !== next.commitment.outboxSequence ||
        cursor.batchId !== next.batch.batchId || cursor.payloadSha256 !== next.batch.payloadSha256 ||
        cursor.chainHash !== next.batch.chainHash) throw new PrimaryRelayError("CHECKPOINT_RESULT_INVALID");
      state.checkpointCommit = "confirmed";
      state.phase = "complete";
      state.succeeded = 1;
      return Object.freeze({ status: targetStatus, outboxSequence: cursor.outboxSequence });
  }

  function initialState() {
    return { phase: "checkpoint-read", targetCommit: "not-attempted", checkpointCommit: "not-attempted",
      claimed: 0, succeeded: 0 };
  }

  return Object.freeze({
    async runOnce() {
      // Preserve the original result and thrown error, without attaching diagnostics.
      return execute(initialState());
    },
    async runObservedOnce() {
      const state = initialState();
      let status;
      let errorCode = "";
      try { status = (await execute(state)).status; }
      catch (error) { status = "failed"; errorCode = safeErrorCode(error); }
      // Construct only technical metadata. No raw exception/result/envelope enters
      // the shared adapter; it is not responsible for scrubbing business payloads.
      return attachWorkerObservability("postgres-primary-rehearsal-relay", {
        ok: status !== "failed", status, ...state, failed: status === "failed" ? 1 : 0, errorCode
      });
    }
  });
}

module.exports = { PrimaryRelayError, createPrimarySingleBatchRelay };
