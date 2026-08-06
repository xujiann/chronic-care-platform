"use strict";

const { createHash } = require("node:crypto");
const { canonicalStringify } = require("../../../scripts/postgres-migration-package");
const {
  buildPostgresPrimaryReadSnapshot,
  comparePostgresShadowState,
  validatePostgresSyncBatch
} = require("../../../postgres-runtime-sync");

const STORAGE_MODES = Object.freeze({
  DISABLED: "disabled",
  SHADOW: "shadow",
  PRIMARY_READ: "primary-read",
  PRIMARY_WRITE: "primary-write"
});
const VALID_STORAGE_MODES = new Set(Object.values(STORAGE_MODES));
const COLLECTION_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,239}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

class PostgresPrimaryStorageContractError extends Error {
  constructor(message, code, statusCode = 400, details = undefined) {
    super(message);
    this.name = "PostgresPrimaryStorageContractError";
    this.code = code;
    this.statusCode = statusCode;
    if (details !== undefined) this.details = details;
  }
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function clean(value, maxLength = 240) {
  return String(value || "").trim().slice(0, maxLength);
}

function validEvidenceRef(value) {
  const reference = clean(value);
  return reference.length >= 4 && !/[\r\n]/.test(reference);
}

function validPostgresUrl(value) {
  return /^postgres(?:ql)?:\/\//i.test(clean(value, 2048));
}

function buildPostgresPrimaryStorageConfig(env = process.env) {
  const mode = clean(env.POSTGRES_PRIMARY_STORAGE_MODE || STORAGE_MODES.DISABLED, 40).toLowerCase();
  if (!VALID_STORAGE_MODES.has(mode)) {
    throw new PostgresPrimaryStorageContractError(
      `Unsupported POSTGRES_PRIMARY_STORAGE_MODE=${mode}`,
      "INVALID_POSTGRES_PRIMARY_STORAGE_MODE"
    );
  }

  const evidence = {
    schema: validEvidenceRef(env.POSTGRES_SCHEMA_EVIDENCE_ID),
    migration: validEvidenceRef(env.POSTGRES_MIGRATION_EVIDENCE_ID),
    reconciliation: validEvidenceRef(env.POSTGRES_RECONCILIATION_EVIDENCE_ID),
    backup: validEvidenceRef(env.POSTGRES_BACKUP_EVIDENCE_ID),
    recovery: validEvidenceRef(env.POSTGRES_RTO_RPO_EVIDENCE_ID),
    rollback: validEvidenceRef(env.POSTGRES_ROLLBACK_EVIDENCE_ID),
    approval: validEvidenceRef(env.POSTGRES_CUTOVER_APPROVAL_ID)
  };
  const requirements = {
    databaseUrl: validPostgresUrl(env.DATABASE_URL),
    tlsVerifyFull: clean(env.POSTGRES_SSL_MODE, 40).toLowerCase() === "verify-full",
    schemaEvidence: evidence.schema,
    migrationEvidence: evidence.migration,
    reconciliationEvidence: evidence.reconciliation,
    backupEvidence: evidence.backup,
    recoveryEvidence: evidence.recovery,
    rollbackEvidence: evidence.rollback,
    cutoverApproval: evidence.approval
  };
  const connectionReady = requirements.databaseUrl && requirements.tlsVerifyFull;
  const shadowReady = connectionReady && requirements.schemaEvidence && requirements.migrationEvidence;
  const primaryReadReady = shadowReady
    && requirements.reconciliationEvidence
    && requirements.backupEvidence
    && requirements.recoveryEvidence
    && requirements.rollbackEvidence
    && requirements.cutoverApproval;
  const primaryWriteReady = primaryReadReady;
  const modeReady = mode === STORAGE_MODES.DISABLED
    || (mode === STORAGE_MODES.SHADOW && shadowReady)
    || (mode === STORAGE_MODES.PRIMARY_READ && primaryReadReady)
    || (mode === STORAGE_MODES.PRIMARY_WRITE && primaryWriteReady);

  return {
    mode,
    configured: mode !== STORAGE_MODES.DISABLED && connectionReady,
    modeReady,
    connectionReady,
    shadowReady,
    primaryReadReady,
    primaryWriteReady,
    requirements,
    evidencePresent: evidence,
    capabilities: {
      shadowApply: mode === STORAGE_MODES.SHADOW && shadowReady,
      primaryRead: [STORAGE_MODES.PRIMARY_READ, STORAGE_MODES.PRIMARY_WRITE].includes(mode) && primaryReadReady,
      primaryWriteRelay: mode === STORAGE_MODES.PRIMARY_WRITE && primaryWriteReady,
      requestPathWrite: false
    },
    writeBoundary: "committed-outbox-only",
    productionPrimary: false,
    runtimeCutoverEnabled: false,
    externalEvidenceVerified: false,
    credentialsPersisted: false
  };
}

function safeConfigStatus(config) {
  return {
    mode: config.mode,
    configured: Boolean(config.configured),
    modeReady: Boolean(config.modeReady),
    connectionReady: Boolean(config.connectionReady),
    shadowReady: Boolean(config.shadowReady),
    primaryReadReady: Boolean(config.primaryReadReady),
    primaryWriteReady: Boolean(config.primaryWriteReady),
    requirements: { ...config.requirements },
    capabilities: { ...config.capabilities },
    writeBoundary: "committed-outbox-only",
    productionPrimary: false,
    runtimeCutoverEnabled: false,
    externalEvidenceVerified: false,
    credentialsPersisted: false
  };
}

function requireCapability(config, capability) {
  if (!config?.modeReady || !config?.capabilities?.[capability]) {
    throw new PostgresPrimaryStorageContractError(
      `PostgreSQL primary storage capability ${capability} is blocked`,
      "POSTGRES_PRIMARY_STORAGE_CAPABILITY_BLOCKED",
      409,
      { mode: config?.mode || STORAGE_MODES.DISABLED, capability }
    );
  }
}

function normalizeCommitReceipt(value, batch) {
  const receipt = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const sequence = Number(receipt.outboxSequence);
  const committedAt = clean(receipt.committedAt, 80);
  const committedTime = Date.parse(committedAt);
  const normalized = {
    state: clean(receipt.state, 40).toLowerCase(),
    source: clean(receipt.source, 80).toLowerCase(),
    sourceTransactionId: clean(receipt.sourceTransactionId, 160),
    outboxSequence: sequence,
    committedAt,
    payloadSha256: clean(receipt.payloadSha256, 80).toLowerCase()
  };
  const valid = normalized.state === "committed"
    && normalized.source === "sqlite-transactional-outbox"
    && normalized.sourceTransactionId.length >= 4
    && Number.isSafeInteger(sequence)
    && sequence > 0
    && Number.isFinite(committedTime)
    && normalized.payloadSha256 === batch.payloadSha256;
  if (!valid) {
    throw new PostgresPrimaryStorageContractError(
      "PostgreSQL primary write relay requires a valid committed outbox receipt",
      "POSTGRES_COMMITTED_OUTBOX_RECEIPT_REQUIRED",
      409
    );
  }
  return normalized;
}

function normalizeChange(change) {
  const collection = clean(change?.collection);
  const operation = clean(change?.operation, 20).toLowerCase();
  const sourceVersion = Number(change?.sourceVersion);
  if (!COLLECTION_PATTERN.test(collection) || collection === "storageMeta") {
    throw new PostgresPrimaryStorageContractError(
      "PostgreSQL outbox contains an invalid collection",
      "INVALID_POSTGRES_PRIMARY_COLLECTION"
    );
  }
  if (!["upsert", "delete"].includes(operation)) {
    throw new PostgresPrimaryStorageContractError(
      "PostgreSQL outbox contains an invalid collection operation",
      "INVALID_POSTGRES_PRIMARY_OPERATION"
    );
  }
  if (!Number.isSafeInteger(sourceVersion) || sourceVersion < 0) {
    throw new PostgresPrimaryStorageContractError(
      "PostgreSQL outbox contains an invalid collection version",
      "INVALID_POSTGRES_PRIMARY_VERSION"
    );
  }
  if (operation === "delete") return { collection, operation, sourceVersion };
  const payload = typeof change.payload === "string"
    ? change.payload
    : canonicalStringify(change.payload);
  let value;
  try {
    value = JSON.parse(payload);
  } catch {
    throw new PostgresPrimaryStorageContractError(
      "PostgreSQL outbox contains invalid JSON",
      "INVALID_POSTGRES_PRIMARY_PAYLOAD"
    );
  }
  const canonicalPayload = canonicalStringify(value);
  const payloadSha256 = clean(change.payloadSha256, 80).toLowerCase();
  if (!SHA256_PATTERN.test(payloadSha256) || sha256(canonicalPayload) !== payloadSha256) {
    throw new PostgresPrimaryStorageContractError(
      "PostgreSQL outbox payload digest verification failed",
      "POSTGRES_PRIMARY_PAYLOAD_DIGEST_MISMATCH",
      409
    );
  }
  return { collection, operation, sourceVersion, payload: canonicalPayload, payloadSha256 };
}

function normalizeCommittedBatch(batch, commitment) {
  const validation = validatePostgresSyncBatch(batch);
  if (!validation.ok) {
    throw new PostgresPrimaryStorageContractError(
      "PostgreSQL outbox batch integrity validation failed",
      "POSTGRES_PRIMARY_BATCH_INTEGRITY_FAILED",
      409,
      validation.checks
    );
  }
  const receipt = normalizeCommitReceipt(commitment, batch);
  const parsed = JSON.parse(batch.payload);
  const changes = parsed.changes.map(normalizeChange);
  const names = new Set();
  changes.forEach((change) => {
    if (names.has(change.collection)) {
      throw new PostgresPrimaryStorageContractError(
        "PostgreSQL outbox batch contains duplicate collections",
        "POSTGRES_PRIMARY_BATCH_DUPLICATE_COLLECTION",
        409
      );
    }
    names.add(change.collection);
  });
  return {
    batchId: batch.batchId,
    createdAt: batch.createdAt,
    payloadSha256: batch.payloadSha256,
    previousChainHash: batch.previousChainHash || "",
    chainHash: batch.chainHash,
    sourceEvent: clean(parsed.sourceEvent, 120),
    changes,
    commitment: receipt
  };
}

function assertDriver(driver) {
  if (!driver || typeof driver.transaction !== "function") {
    throw new PostgresPrimaryStorageContractError(
      "PostgreSQL primary storage driver must expose transaction",
      "POSTGRES_PRIMARY_DRIVER_INVALID"
    );
  }
}

function assertTransaction(tx) {
  const methods = [
    "getAppliedBatch",
    "getLastAppliedBatch",
    "getCollection",
    "listCollections",
    "applyCollectionChange",
    "recordAppliedBatch"
  ];
  if (!tx || methods.some((method) => typeof tx[method] !== "function")) {
    throw new PostgresPrimaryStorageContractError(
      "PostgreSQL primary storage transaction contract is incomplete",
      "POSTGRES_PRIMARY_TRANSACTION_INVALID"
    );
  }
}

function compareReplay(existing, incoming) {
  if (!existing) return false;
  if (existing.payloadSha256 !== incoming.payloadSha256 || existing.chainHash !== incoming.chainHash) {
    throw new PostgresPrimaryStorageContractError(
      "PostgreSQL outbox idempotency key was reused with different evidence",
      "POSTGRES_PRIMARY_IDEMPOTENCY_CONFLICT",
      409
    );
  }
  return true;
}

function assertChainContinuity(previous, batch) {
  const expected = previous?.chainHash || "";
  if (batch.previousChainHash !== expected) {
    throw new PostgresPrimaryStorageContractError(
      "PostgreSQL outbox chain is discontinuous",
      "POSTGRES_PRIMARY_OUTBOX_CHAIN_CONFLICT",
      409,
      { expectedPreviousChainHash: expected, actualPreviousChainHash: batch.previousChainHash }
    );
  }
}

function assertCollectionCas(current, change, baseline) {
  const actualVersion = current ? Number(current.sourceVersion) : -1;
  if (current && actualVersion === change.sourceVersion) {
    const same = change.operation === "delete"
      ? Boolean(current.deleted)
      : !current.deleted && current.payloadSha256 === change.payloadSha256;
    if (same) return { replay: true, expectedVersion: actualVersion };
    throw new PostgresPrimaryStorageContractError(
      "PostgreSQL collection version was reused with different content",
      "POSTGRES_PRIMARY_COLLECTION_VERSION_CONFLICT",
      409,
      { collection: change.collection, sourceVersion: change.sourceVersion }
    );
  }
  const allowedVersion = baseline && !current ? change.sourceVersion : actualVersion + 1;
  if (change.sourceVersion !== allowedVersion) {
    throw new PostgresPrimaryStorageContractError(
      "PostgreSQL collection compare-and-swap version conflict",
      "POSTGRES_PRIMARY_COLLECTION_CAS_CONFLICT",
      409,
      {
        collection: change.collection,
        expectedSourceVersion: allowedVersion,
        actualSourceVersion: change.sourceVersion
      }
    );
  }
  return { replay: false, expectedVersion: actualVersion };
}

function normalizeStoredRow(row) {
  if (!row || row.deleted) return null;
  const normalized = normalizeChange({
    collection: row.collection,
    operation: "upsert",
    sourceVersion: row.sourceVersion,
    payload: row.payload,
    payloadSha256: row.payloadSha256
  });
  return {
    collection: normalized.collection,
    sourceVersion: normalized.sourceVersion,
    payload: normalized.payload,
    payloadSha256: normalized.payloadSha256,
    batchId: clean(row.batchId, 160),
    value: JSON.parse(normalized.payload)
  };
}

function buildTransitionAssessment(input = {}, config = buildPostgresPrimaryStorageConfig({})) {
  const requestedMode = clean(input.requestedMode || config.mode, 40).toLowerCase();
  if (![STORAGE_MODES.PRIMARY_READ, STORAGE_MODES.PRIMARY_WRITE].includes(requestedMode)) {
    throw new PostgresPrimaryStorageContractError(
      "PostgreSQL transition assessment requires primary-read or primary-write",
      "INVALID_POSTGRES_TRANSITION_MODE"
    );
  }
  const migration = input.migration || {};
  const reconciliation = input.reconciliation || {};
  const delivery = input.delivery || {};
  const recovery = input.recovery || {};
  const fallback = input.fallback || {};
  const checks = [
    {
      id: "configuration",
      passed: requestedMode === STORAGE_MODES.PRIMARY_READ ? config.primaryReadReady : config.primaryWriteReady
    },
    {
      id: "migration",
      passed: migration.status === "verified"
        && Number(migration.sourceCollections) > 0
        && Number(migration.sourceCollections) === Number(migration.targetCollections)
        && SHA256_PATTERN.test(clean(migration.sourceDigest, 80).toLowerCase())
        && clean(migration.sourceDigest, 80).toLowerCase() === clean(migration.targetDigest, 80).toLowerCase()
    },
    {
      id: "reconciliation",
      passed: reconciliation.status === "matched"
        && Number(reconciliation.mismatched) === 0
        && Number(reconciliation.unresolvedCases) === 0
    },
    {
      id: "outbox",
      passed: Number(delivery.pending) === 0
        && Number(delivery.retry) === 0
        && Number(delivery.failed) === 0
    },
    {
      id: "backup-and-recovery",
      passed: recovery.backupStatus === "verified"
        && recovery.restoreStatus === "verified"
        && Number(recovery.measuredRtoSeconds) >= 0
        && Number(recovery.measuredRtoSeconds) <= Number(recovery.targetRtoSeconds)
        && Number(recovery.measuredRpoSeconds) >= 0
        && Number(recovery.measuredRpoSeconds) <= Number(recovery.targetRpoSeconds)
    },
    {
      id: "fallback",
      passed: fallback.status === "verified"
        && fallback.target === "sqlite"
        && fallback.dataLossObserved === false
        && validEvidenceRef(fallback.evidenceRef)
    }
  ];
  const readyForControlledRehearsal = checks.every((check) => check.passed);
  return {
    requestedMode,
    readyForControlledRehearsal,
    checks,
    blockers: checks.filter((check) => !check.passed).map((check) => check.id),
    activationAuthorized: false,
    productionReady: false,
    productionPrimary: false,
    runtimeCutoverEnabled: false,
    boundary: "Repository checks can qualify a controlled rehearsal only. Live capacity, failover, restore and independent site approval remain external evidence."
  };
}

function createPostgresPrimaryStorageContract(options = {}) {
  const config = options.config || buildPostgresPrimaryStorageConfig(options.env || process.env);
  const driver = options.driver;
  assertDriver(driver);

  return {
    config: safeConfigStatus(config),

    status() {
      return safeConfigStatus(config);
    },

    async readCollection(collection) {
      requireCapability(config, "primaryRead");
      const name = clean(collection);
      if (!COLLECTION_PATTERN.test(name) || name === "storageMeta") {
        throw new PostgresPrimaryStorageContractError(
          "PostgreSQL primary read requires a valid collection",
          "INVALID_POSTGRES_PRIMARY_COLLECTION"
        );
      }
      return driver.transaction({ isolation: "repeatable-read", readOnly: true }, async (tx) => {
        assertTransaction(tx);
        return normalizeStoredRow(await tx.getCollection(name));
      });
    },

    async readSnapshot(readOptions = {}) {
      requireCapability(config, "primaryRead");
      return driver.transaction({ isolation: "repeatable-read", readOnly: true }, async (tx) => {
        assertTransaction(tx);
        const rows = (await tx.listCollections()).filter((row) => !row.deleted);
        const snapshot = buildPostgresPrimaryReadSnapshot(rows.map((row) => ({
          collection_name: row.collection,
          source_version: row.sourceVersion,
          payload: row.payload,
          payload_sha256: row.payloadSha256,
          batch_id: row.batchId
        })), readOptions);
        return {
          ...snapshot,
          report: {
            ...snapshot.report,
            mode: config.mode,
            transaction: "repeatable-read-read-only",
            productionPrimary: false,
            runtimeCutoverEnabled: false
          }
        };
      });
    },

    async compareShadow(sourceRows = []) {
      if (![STORAGE_MODES.SHADOW, STORAGE_MODES.PRIMARY_READ, STORAGE_MODES.PRIMARY_WRITE].includes(config.mode)
        || !config.shadowReady) {
        throw new PostgresPrimaryStorageContractError(
          "PostgreSQL shadow comparison is blocked",
          "POSTGRES_SHADOW_COMPARISON_BLOCKED",
          409
        );
      }
      return driver.transaction({ isolation: "repeatable-read", readOnly: true }, async (tx) => {
        assertTransaction(tx);
        const targetRows = (await tx.listCollections())
          .filter((row) => !row.deleted)
          .map((row) => ({
            collection: row.collection,
            sourceVersion: row.sourceVersion,
            payloadSha256: row.payloadSha256,
            batchId: row.batchId
          }));
        const comparison = comparePostgresShadowState(sourceRows, targetRows);
        return {
          ok: comparison.mismatched === 0,
          ...comparison,
          productionPrimary: false,
          runtimeCutoverEnabled: false
        };
      });
    },

    async applyCommittedOutbox(batch, applyOptions = {}) {
      const capability = config.mode === STORAGE_MODES.SHADOW ? "shadowApply" : "primaryWriteRelay";
      requireCapability(config, capability);
      if (applyOptions.executionContext === "request-path") {
        throw new PostgresPrimaryStorageContractError(
          "PostgreSQL writes are prohibited on the request path",
          "POSTGRES_REQUEST_PATH_WRITE_PROHIBITED",
          409
        );
      }
      const normalized = normalizeCommittedBatch(batch, applyOptions.commitment);
      return driver.transaction({ isolation: "serializable", readOnly: false }, async (tx) => {
        assertTransaction(tx);
        const existing = await tx.getAppliedBatch(normalized.batchId);
        if (compareReplay(existing, normalized)) {
          return {
            ok: true,
            status: "duplicate",
            batchId: normalized.batchId,
            appliedChanges: 0,
            productionPrimary: false,
            runtimeCutoverEnabled: false
          };
        }
        assertChainContinuity(await tx.getLastAppliedBatch(), normalized);
        const baseline = normalized.sourceEvent === "baseline-snapshot";
        let appliedChanges = 0;
        for (const change of normalized.changes) {
          const current = await tx.getCollection(change.collection);
          const cas = assertCollectionCas(current, change, baseline);
          if (cas.replay) continue;
          await tx.applyCollectionChange(change, {
            expectedVersion: cas.expectedVersion,
            batchId: normalized.batchId,
            appliedAt: applyOptions.appliedAt || new Date().toISOString()
          });
          appliedChanges += 1;
        }
        await tx.recordAppliedBatch({
          batchId: normalized.batchId,
          payloadSha256: normalized.payloadSha256,
          previousChainHash: normalized.previousChainHash,
          chainHash: normalized.chainHash,
          committedAt: normalized.commitment.committedAt,
          sourceTransactionId: normalized.commitment.sourceTransactionId,
          outboxSequence: normalized.commitment.outboxSequence,
          appliedChanges
        });
        return {
          ok: true,
          status: "applied",
          batchId: normalized.batchId,
          appliedChanges,
          payloadsExposed: false,
          credentialsPersisted: false,
          productionPrimary: false,
          runtimeCutoverEnabled: false
        };
      });
    },

    assessTransition(input = {}) {
      return buildTransitionAssessment(input, config);
    }
  };
}

module.exports = {
  STORAGE_MODES,
  VALID_STORAGE_MODES,
  PostgresPrimaryStorageContractError,
  buildPostgresPrimaryStorageConfig,
  buildTransitionAssessment,
  createPostgresPrimaryStorageContract,
  normalizeCommittedBatch,
  safeConfigStatus
};
