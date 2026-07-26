const { createHash, randomUUID } = require("node:crypto");
const {
  PostgresPrimaryReadError,
  buildPostgresPrimaryReadSnapshot,
  buildPostgresSyncBatch,
  postgresPoolConfig
} = require("./postgres-runtime-sync");
const { canonicalStringify } = require("./scripts/postgres-migration-package");
const {
  PILOT_EVIDENCE_COLLECTION,
  buildPilotEvidenceProjection
} = require("./pilot-evidence-postgres");

const ADAPTER_MODES = new Set(["disabled", "rehearsal"]);
const WRITE_MODES = new Set(["disabled", "evidence-gated"]);

class PostgresProductionAdapterError extends Error {
  constructor(message, code, statusCode = 400) {
    super(message);
    this.name = "PostgresProductionAdapterError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function safeText(value, maxLength = 160) {
  return String(value || "").trim().slice(0, maxLength);
}

function evidenceReference(value) {
  const reference = safeText(value, 160);
  return reference.length >= 4 && !/[\r\n]/.test(reference) ? reference : "";
}

function buildPostgresProductionAdapterConfig(env = process.env) {
  const adapterMode = safeText(env.POSTGRES_ADAPTER_MODE || "disabled", 40).toLowerCase();
  const writeMode = safeText(env.POSTGRES_PRODUCTION_WRITE_MODE || "disabled", 40).toLowerCase();
  if (!ADAPTER_MODES.has(adapterMode)) throw new PostgresProductionAdapterError(`Unsupported POSTGRES_ADAPTER_MODE=${adapterMode}`, "INVALID_POSTGRES_ADAPTER_MODE");
  if (!WRITE_MODES.has(writeMode)) throw new PostgresProductionAdapterError(`Unsupported POSTGRES_PRODUCTION_WRITE_MODE=${writeMode}`, "INVALID_POSTGRES_WRITE_MODE");
  const evidence = {
    cutoverApproval: evidenceReference(env.POSTGRES_CUTOVER_APPROVAL_ID),
    backup: evidenceReference(env.POSTGRES_BACKUP_EVIDENCE_ID),
    recovery: evidenceReference(env.POSTGRES_RTO_RPO_EVIDENCE_ID)
  };
  const requirements = {
    adapterMode: adapterMode === "rehearsal",
    databaseUrl: /^postgres(?:ql)?:\/\//i.test(safeText(env.DATABASE_URL, 2048)),
    cutoverApproval: Boolean(evidence.cutoverApproval),
    backupEvidence: Boolean(evidence.backup),
    recoveryEvidence: Boolean(evidence.recovery)
  };
  const evidenceReady = requirements.cutoverApproval && requirements.backupEvidence && requirements.recoveryEvidence;
  return {
    adapterMode,
    writeMode,
    configured: requirements.adapterMode && requirements.databaseUrl,
    evidenceReady,
    writeEnabled: requirements.adapterMode && requirements.databaseUrl && evidenceReady && writeMode === "evidence-gated",
    requirements,
    evidence,
    productionPrimary: false,
    runtimeCutoverEnabled: false,
    credentialsPersisted: false
  };
}

function metadataSnapshotSha256(rows = []) {
  const manifest = rows.map((row) => ({
    collection: String(row.collection_name || row.collection || ""),
    sourceVersion: Number(row.source_version ?? row.sourceVersion ?? 0),
    payloadSha256: String(row.payload_sha256 || row.payloadSha256 || "").trim().toLowerCase()
  })).sort((a, b) => a.collection.localeCompare(b.collection));
  return sha256(canonicalStringify(manifest));
}

function assertExpectedVersions(currentRows, incomingState, expectedVersions) {
  if (!expectedVersions || typeof expectedVersions !== "object" || Array.isArray(expectedVersions)) {
    throw new PostgresProductionAdapterError("PostgreSQL production write requires expected collection versions", "POSTGRES_EXPECTED_VERSIONS_REQUIRED", 409);
  }
  const current = new Map(currentRows.map((row) => [String(row.collection_name), Number(row.source_version || 0)]));
  const names = new Set([...current.keys(), ...Object.keys(incomingState).filter((name) => name !== "storageMeta")]);
  names.forEach((collection) => {
    if (!Object.hasOwn(expectedVersions, collection)) {
      throw new PostgresProductionAdapterError("PostgreSQL production write expected versions are incomplete", "POSTGRES_EXPECTED_VERSIONS_INCOMPLETE", 409);
    }
    const expected = Number(expectedVersions[collection]);
    const actual = current.get(collection) || 0;
    if (!Number.isInteger(expected) || expected !== actual) {
      throw new PostgresProductionAdapterError("PostgreSQL production write version conflict", "POSTGRES_PRIMARY_WRITE_CONFLICT", 409);
    }
  });
}

function buildPostgresPrimaryWritePlan(currentRows = [], incomingState = {}, options = {}) {
  if (!incomingState || typeof incomingState !== "object" || Array.isArray(incomingState)) {
    throw new PostgresProductionAdapterError("PostgreSQL production write requires a state object", "INVALID_POSTGRES_PRIMARY_STATE");
  }
  assertExpectedVersions(currentRows, incomingState, options.expectedVersions);
  const current = new Map(currentRows.map((row) => [String(row.collection_name), row]));
  const incomingEntries = Object.entries(incomingState).filter(([collection]) => collection !== "storageMeta");
  if (current.has(PILOT_EVIDENCE_COLLECTION) && !Object.hasOwn(incomingState, PILOT_EVIDENCE_COLLECTION)) {
    throw new PostgresProductionAdapterError(
      "pilot evidence collection deletion is blocked",
      "PILOT_EVIDENCE_COLLECTION_DELETE_BLOCKED",
      409
    );
  }
  if (!incomingEntries.length) throw new PostgresProductionAdapterError("PostgreSQL production write state is empty", "INVALID_POSTGRES_PRIMARY_STATE");
  const incomingNames = new Set(incomingEntries.map(([collection]) => collection));
  const changes = [];
  current.forEach((row, collection) => {
    if (!incomingNames.has(collection)) {
      changes.push({ collection, operation: "delete", sourceVersion: Number(row.source_version || 0) + 1 });
    }
  });
  incomingEntries.forEach(([collection, value]) => {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,239}$/.test(collection)) {
      throw new PostgresProductionAdapterError("PostgreSQL production write contains an invalid collection", "INVALID_POSTGRES_PRIMARY_COLLECTION");
    }
    const payload = canonicalStringify(value);
    const payloadSha256 = sha256(payload);
    const row = current.get(collection);
    if (row && String(row.payload_sha256 || "").trim().toLowerCase() === payloadSha256) return;
    changes.push({
      collection,
      operation: "upsert",
      sourceVersion: Number(row?.source_version || 0) + 1,
      payload,
      payloadSha256
    });
  });
  const resultingRows = new Map(currentRows.map((row) => [String(row.collection_name), {
    collection: String(row.collection_name),
    sourceVersion: Number(row.source_version || 0),
    payloadSha256: String(row.payload_sha256 || "").trim().toLowerCase()
  }]));
  changes.forEach((change) => {
    if (change.operation === "delete") resultingRows.delete(change.collection);
    else resultingRows.set(change.collection, change);
  });
  return {
    changes: changes.sort((a, b) => a.collection.localeCompare(b.collection)),
    summary: {
      currentCollections: current.size,
      resultingCollections: resultingRows.size,
      changedCollections: changes.filter((item) => item.operation === "upsert").length,
      deletedCollections: changes.filter((item) => item.operation === "delete").length,
      expectedSnapshotSha256: metadataSnapshotSha256(currentRows),
      resultingSnapshotSha256: metadataSnapshotSha256([...resultingRows.values()])
    }
  };
}

async function syncPilotEvidenceProjection(client, batches, options = {}) {
  const rows = buildPilotEvidenceProjection(batches, {
    retentionYears: options.retentionYears
  });
  const existing = await client.query(`
    SELECT batch_id
    FROM health_platform.pilot_evidence_batches
    ORDER BY batch_id
    FOR UPDATE
  `);
  const incomingIds = new Set(rows.map((row) => row.batchId));
  const removed = existing.rows.filter((row) => !incomingIds.has(String(row.batch_id)));
  if (removed.length) {
    throw new PostgresProductionAdapterError(
      "pilot evidence batch deletion is blocked",
      "PILOT_EVIDENCE_BATCH_DELETE_BLOCKED",
      409
    );
  }
  for (const row of rows) {
    const projected = await client.query(`
      INSERT INTO health_platform.pilot_evidence_batches (
        batch_id, organization_code, pilot_id, hospital_name, title, status, revision, payload,
        payload_sha256, manifest_sha256, created_at, updated_at, frozen_at, retention_until, legal_hold
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13, $14, $15
      )
      ON CONFLICT (batch_id) DO UPDATE SET
        organization_code = EXCLUDED.organization_code,
        pilot_id = EXCLUDED.pilot_id,
        hospital_name = EXCLUDED.hospital_name,
        title = EXCLUDED.title,
        status = EXCLUDED.status,
        revision = EXCLUDED.revision,
        payload = EXCLUDED.payload,
        payload_sha256 = EXCLUDED.payload_sha256,
        manifest_sha256 = EXCLUDED.manifest_sha256,
        updated_at = EXCLUDED.updated_at,
        frozen_at = EXCLUDED.frozen_at,
        retention_until = GREATEST(health_platform.pilot_evidence_batches.retention_until, EXCLUDED.retention_until),
        legal_hold = health_platform.pilot_evidence_batches.legal_hold OR EXCLUDED.legal_hold
      WHERE (
           health_platform.pilot_evidence_batches.status != 'frozen'
           AND health_platform.pilot_evidence_batches.revision < EXCLUDED.revision
         )
         OR (
           health_platform.pilot_evidence_batches.revision = EXCLUDED.revision
           AND health_platform.pilot_evidence_batches.payload_sha256 = EXCLUDED.payload_sha256
         )
      RETURNING batch_id
    `, [
      row.batchId,
      row.organizationCode,
      row.pilotId,
      row.hospitalName,
      row.title,
      row.status,
      row.revision,
      row.payload,
      row.payloadSha256,
      row.manifestSha256,
      row.createdAt,
      row.updatedAt,
      row.frozenAt,
      row.retentionUntil,
      row.legalHold
    ]);
    if (projected.rowCount !== 1) {
      throw new PostgresProductionAdapterError(
        "pilot evidence projection revision conflict",
        "PILOT_EVIDENCE_PROJECTION_CONFLICT",
        409
      );
    }
    const version = await client.query(`
      WITH inserted AS (
        INSERT INTO health_platform.pilot_evidence_batch_versions (
          batch_id, revision, payload, payload_sha256, actor, recorded_at
        ) VALUES ($1, $2, $3::jsonb, $4, $5, $6)
        ON CONFLICT (batch_id, revision) DO NOTHING
        RETURNING batch_id
      )
      SELECT batch_id FROM inserted
      UNION ALL
      SELECT batch_id
      FROM health_platform.pilot_evidence_batch_versions
      WHERE batch_id = $1 AND revision = $2 AND payload_sha256 = $4
      LIMIT 1
    `, [
      row.batchId,
      row.revision,
      row.payload,
      row.payloadSha256,
      options.actor,
      options.at || row.updatedAt
    ]);
    if (version.rowCount !== 1) {
      throw new PostgresProductionAdapterError(
        "pilot evidence version digest conflict",
        "PILOT_EVIDENCE_VERSION_CONFLICT",
        409
      );
    }
  }
  return { batches: rows.length, versions: rows.length };
}

function safeAdapterFailure(error, fallbackCode = "POSTGRES_PRODUCTION_ADAPTER_FAILED") {
  if (error instanceof PostgresProductionAdapterError || error instanceof PostgresPrimaryReadError) return error;
  const code = /^[A-Z0-9_]{2,80}$/.test(String(error?.code || "")) ? String(error.code) : fallbackCode;
  return new PostgresProductionAdapterError("PostgreSQL production adapter operation failed", code, 502);
}

async function readPostgresProductionState(options = {}) {
  const env = options.env || process.env;
  const config = options.config || buildPostgresProductionAdapterConfig(env);
  if (!config.configured && !options.pool) {
    throw new PostgresProductionAdapterError("PostgreSQL production adapter is not configured", "POSTGRES_ADAPTER_NOT_CONFIGURED", 409);
  }
  const pool = options.pool || new (options.PoolClass || require("pg").Pool)(options.poolConfig || postgresPoolConfig(env));
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const result = await client.query(`
      SELECT collection_name, payload, payload_sha256, source_version, batch_id, updated_at
      FROM health_platform.runtime_collection_state
      ORDER BY collection_name
    `);
    const snapshot = buildPostgresPrimaryReadSnapshot(result.rows, {
      requiredCollections: options.requiredCollections,
      maxCollections: options.maxCollections || env.POSTGRES_PRIMARY_READ_MAX_COLLECTIONS,
      maxBytes: options.maxBytes || env.POSTGRES_PRIMARY_READ_MAX_BYTES
    });
    await client.query("COMMIT");
    return {
      state: snapshot.state,
      collectionVersions: Object.fromEntries(result.rows.map((row) => [String(row.collection_name), Number(row.source_version || 0)])),
      report: {
        ok: true,
        readId: options.readId || `pgprimary-read-${randomUUID()}`,
        readAt: options.readAt || new Date().toISOString(),
        transaction: "repeatable-read-read-only",
        ...snapshot.report,
        adapterMode: config.adapterMode,
        productionPrimary: false,
        runtimeCutoverEnabled: false
      }
    };
  } catch (error) {
    try { await client?.query?.("ROLLBACK"); } catch {}
    throw safeAdapterFailure(error, "POSTGRES_PRIMARY_READ_FAILED");
  } finally {
    client?.release?.();
    if (!options.pool) await pool.end();
  }
}

async function writePostgresProductionState(state, options = {}) {
  const env = options.env || process.env;
  const config = options.config || buildPostgresProductionAdapterConfig(env);
  if ((!config.writeEnabled || options.allowWrite !== true) && !options.testBypassEvidenceGate) {
    throw new PostgresProductionAdapterError("PostgreSQL production writes require explicit evidence-gated approval", "POSTGRES_PRIMARY_WRITE_BLOCKED", 409);
  }
  const actor = safeText(options.actor, 120);
  const reason = safeText(options.reason, 1000);
  if (actor.length < 2 || reason.length < 8) {
    throw new PostgresProductionAdapterError("PostgreSQL production write requires actor and reason", "POSTGRES_PRIMARY_WRITE_AUDIT_REQUIRED");
  }
  const pool = options.pool || new (options.PoolClass || require("pg").Pool)(options.poolConfig || postgresPoolConfig(env));
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('health_platform.runtime_primary_write'))");
    const currentResult = await client.query(`
      SELECT collection_name, payload_sha256, source_version, batch_id
      FROM health_platform.runtime_collection_state
      ORDER BY collection_name
      FOR UPDATE
    `);
    const plan = buildPostgresPrimaryWritePlan(currentResult.rows, state, { expectedVersions: options.expectedVersions });
    if (!plan.changes.length) {
      await client.query("COMMIT");
      return {
        ok: true,
        status: "no-change",
        batchId: "",
        ...plan.summary,
        productionPrimary: false,
        runtimeCutoverEnabled: false
      };
    }
    const previous = await client.query("SELECT chain_hash FROM health_platform.runtime_sync_batches ORDER BY created_at DESC, batch_id DESC LIMIT 1");
    const batch = buildPostgresSyncBatch(plan.changes, {
      createdAt: options.at || new Date().toISOString(),
      sourceEvent: "postgres-primary-adapter-write",
      previousChainHash: previous.rows[0]?.chain_hash || ""
    });
    const inserted = await client.query(`
      INSERT INTO health_platform.runtime_sync_batches (
        batch_id, created_at, payload_sha256, previous_chain_hash, chain_hash, status
      ) VALUES ($1, $2, $3, $4, $5, 'applying')
      ON CONFLICT (batch_id) DO NOTHING
      RETURNING batch_id
    `, [batch.batchId, batch.createdAt, batch.payloadSha256, batch.previousChainHash, batch.chainHash]);
    if (inserted.rowCount !== 1) throw new PostgresProductionAdapterError("PostgreSQL primary write batch already exists", "POSTGRES_PRIMARY_WRITE_DUPLICATE", 409);
    for (const change of plan.changes) {
      if (change.operation === "delete") {
        await client.query("DELETE FROM health_platform.runtime_collection_state WHERE collection_name = $1", [change.collection]);
        continue;
      }
      await client.query(`
        INSERT INTO health_platform.runtime_collection_state (
          collection_name, payload, payload_sha256, source_version, batch_id, updated_at
        ) VALUES ($1, $2::jsonb, $3, $4, $5, $6)
        ON CONFLICT (collection_name) DO UPDATE SET
          payload = EXCLUDED.payload,
          payload_sha256 = EXCLUDED.payload_sha256,
          source_version = EXCLUDED.source_version,
          batch_id = EXCLUDED.batch_id,
          updated_at = EXCLUDED.updated_at
      `, [change.collection, change.payload, change.payloadSha256, change.sourceVersion, batch.batchId, batch.createdAt]);
    }
    const pilotEvidenceProjection = plan.changes.some((change) => change.collection === PILOT_EVIDENCE_COLLECTION)
      ? await syncPilotEvidenceProjection(client, state[PILOT_EVIDENCE_COLLECTION], {
        actor,
        at: batch.createdAt,
        retentionYears: env.PILOT_EVIDENCE_RETENTION_YEARS
      })
      : { batches: 0, versions: 0 };
    await client.query("UPDATE health_platform.runtime_sync_batches SET status = 'applied', applied_at = now() WHERE batch_id = $1", [batch.batchId]);
    await client.query(`
      INSERT INTO health_platform.runtime_primary_write_audit (
        write_id, batch_id, actor, reason, expected_snapshot_sha256, resulting_snapshot_sha256,
        changed_collections, deleted_collections, status, applied_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'applied', now())
    `, [
      `pgwrite-${randomUUID()}`,
      batch.batchId,
      actor,
      reason,
      plan.summary.expectedSnapshotSha256,
      plan.summary.resultingSnapshotSha256,
      plan.summary.changedCollections,
      plan.summary.deletedCollections
    ]);
    await client.query("COMMIT");
    return {
      ok: true,
      status: "applied",
      batchId: batch.batchId,
      ...plan.summary,
      credentialsPersisted: false,
      payloadsExposed: false,
      pilotEvidenceProjection: {
        batches: pilotEvidenceProjection.batches,
        versions: pilotEvidenceProjection.versions
      },
      productionPrimary: false,
      runtimeCutoverEnabled: false
    };
  } catch (error) {
    try { await client?.query?.("ROLLBACK"); } catch {}
    throw safeAdapterFailure(error, "POSTGRES_PRIMARY_WRITE_FAILED");
  } finally {
    client?.release?.();
    if (!options.pool) await pool.end();
  }
}

async function verifyPostgresProductionAdapterSchema(options = {}) {
  const env = options.env || process.env;
  const config = options.config || buildPostgresProductionAdapterConfig(env);
  if (!config.configured && !options.pool) {
    throw new PostgresProductionAdapterError("PostgreSQL production adapter is not configured", "POSTGRES_ADAPTER_NOT_CONFIGURED", 409);
  }
  const pool = options.pool || new (options.PoolClass || require("pg").Pool)(options.poolConfig || postgresPoolConfig(env));
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN READ ONLY");
    const result = await client.query(`
      SELECT
        to_regclass('health_platform.runtime_sync_batches') AS sync_batches,
        to_regclass('health_platform.runtime_collection_state') AS collection_state,
        to_regclass('health_platform.runtime_primary_write_audit') AS primary_write_audit,
        to_regclass('health_platform.pilot_evidence_batches') AS pilot_evidence_batches,
        to_regclass('health_platform.pilot_evidence_batch_versions') AS pilot_evidence_batch_versions
    `);
    await client.query("COMMIT");
    const row = result.rows[0] || {};
    const checks = {
      syncBatches: Boolean(row.sync_batches),
      collectionState: Boolean(row.collection_state),
      primaryWriteAudit: Boolean(row.primary_write_audit),
      pilotEvidenceBatches: Boolean(row.pilot_evidence_batches),
      pilotEvidenceBatchVersions: Boolean(row.pilot_evidence_batch_versions)
    };
    return {
      ok: Object.values(checks).every(Boolean),
      checkedAt: options.checkedAt || new Date().toISOString(),
      checks,
      adapterMode: config.adapterMode,
      productionPrimary: false,
      runtimeCutoverEnabled: false
    };
  } catch (error) {
    try { await client?.query?.("ROLLBACK"); } catch {}
    throw safeAdapterFailure(error, "POSTGRES_ADAPTER_SCHEMA_VERIFY_FAILED");
  } finally {
    client?.release?.();
    if (!options.pool) await pool.end();
  }
}

function createPostgresProductionAdapter(options = {}) {
  const env = options.env || process.env;
  const config = options.config || buildPostgresProductionAdapterConfig(env);
  return {
    config,
    async read(readOptions = {}) {
      return readPostgresProductionState({ ...options, ...readOptions, env, config });
    },
    async write(state, writeOptions = {}) {
      return writePostgresProductionState(state, { ...options, ...writeOptions, env, config });
    }
  };
}

module.exports = {
  ADAPTER_MODES,
  WRITE_MODES,
  PostgresProductionAdapterError,
  buildPostgresPrimaryWritePlan,
  buildPostgresProductionAdapterConfig,
  createPostgresProductionAdapter,
  metadataSnapshotSha256,
  readPostgresProductionState,
  syncPilotEvidenceProjection,
  verifyPostgresProductionAdapterSchema,
  writePostgresProductionState
};
