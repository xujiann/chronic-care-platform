const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const test = require("node:test");

const {
  buildPostgresPrimaryWritePlan,
  buildPostgresProductionAdapterConfig,
  createPostgresProductionAdapter,
  readPostgresProductionState,
  verifyPostgresProductionAdapterSchema,
  writePostgresProductionState
} = require("../postgres-production-adapter");
const { canonicalStringify } = require("../scripts/postgres-migration-package");
const { runCli } = require("../scripts/postgres-production-adapter");

function digest(value) {
  return createHash("sha256").update(canonicalStringify(value)).digest("hex");
}

function currentRow(collection, value, sourceVersion = 1) {
  return {
    collection_name: collection,
    payload: value,
    payload_sha256: digest(value),
    source_version: sourceVersion,
    batch_id: `batch-${collection}`
  };
}

test("PostgreSQL production adapter configuration keeps writes evidence-gated", () => {
  const disabled = buildPostgresProductionAdapterConfig({});
  assert.equal(disabled.configured, false);
  assert.equal(disabled.writeEnabled, false);
  assert.equal(disabled.productionPrimary, false);

  const readReady = buildPostgresProductionAdapterConfig({
    POSTGRES_ADAPTER_MODE: "rehearsal",
    DATABASE_URL: "postgres://user:secret@db/platform"
  });
  assert.equal(readReady.configured, true);
  assert.equal(readReady.writeEnabled, false);
  assert.equal(JSON.stringify(readReady).includes("user:secret"), false);

  const writeReady = buildPostgresProductionAdapterConfig({
    POSTGRES_ADAPTER_MODE: "rehearsal",
    POSTGRES_PRODUCTION_WRITE_MODE: "evidence-gated",
    DATABASE_URL: "postgres://user:secret@db/platform",
    POSTGRES_CUTOVER_APPROVAL_ID: "CAB-2026-001",
    POSTGRES_BACKUP_EVIDENCE_ID: "BACKUP-2026-001",
    POSTGRES_RTO_RPO_EVIDENCE_ID: "DR-2026-001"
  });
  assert.equal(writeReady.writeEnabled, true);
  assert.equal(writeReady.runtimeCutoverEnabled, false);
});

test("PostgreSQL primary write plan requires complete optimistic versions", () => {
  const rows = [currentRow("residents", [{ id: "r1" }], 3), currentRow("settings", { enabled: true }, 2)];
  assert.throws(() => buildPostgresPrimaryWritePlan(rows, { residents: [{ id: "r1" }], settings: { enabled: false } }, {
    expectedVersions: { residents: 3 }
  }), (error) => error.code === "POSTGRES_EXPECTED_VERSIONS_INCOMPLETE");
  assert.throws(() => buildPostgresPrimaryWritePlan(rows, { residents: [{ id: "r1" }], settings: { enabled: false } }, {
    expectedVersions: { residents: 3, settings: 1 }
  }), (error) => error.code === "POSTGRES_PRIMARY_WRITE_CONFLICT");

  const plan = buildPostgresPrimaryWritePlan(rows, { residents: [{ id: "r1" }], settings: { enabled: false } }, {
    expectedVersions: { residents: 3, settings: 2 }
  });
  assert.equal(plan.changes.length, 1);
  assert.equal(plan.changes[0].collection, "settings");
  assert.equal(plan.changes[0].sourceVersion, 3);
  assert.equal(plan.summary.changedCollections, 1);
  assert.match(plan.summary.resultingSnapshotSha256, /^[a-f0-9]{64}$/);
});

test("PostgreSQL production adapter reads a verified state in a repeatable read-only transaction", async () => {
  const rows = [currentRow("residents", [{ id: "r1", name: "private resident" }], 3)];
  const queries = [];
  const client = {
    async query(sql) {
      queries.push(sql.trim());
      return /SELECT collection_name/.test(sql) ? { rows } : { rows: [] };
    },
    release() {}
  };
  const result = await readPostgresProductionState({
    pool: { async connect() { return client; } },
    config: { configured: true, adapterMode: "rehearsal" },
    requiredCollections: ["residents"]
  });
  assert.equal(queries[0], "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  assert.equal(queries.at(-1), "COMMIT");
  assert.equal(result.state.residents[0].id, "r1");
  assert.deepEqual(result.collectionVersions, { residents: 3 });
  assert.equal(result.report.productionPrimary, false);
  assert.doesNotMatch(JSON.stringify(result.report), /private resident|postgres:\/\//);
});

test("PostgreSQL production adapter writes with serializable locking and payload-free audit", async () => {
  const rows = [currentRow("settings", { enabled: true }, 2)];
  const queries = [];
  const client = {
    async query(sql, params) {
      const normalized = sql.trim();
      queries.push({ sql: normalized, params });
      if (/SELECT collection_name/.test(sql)) return { rows };
      if (/SELECT chain_hash/.test(sql)) return { rows: [{ chain_hash: "a".repeat(64) }] };
      if (/INSERT INTO health_platform\.runtime_sync_batches/.test(sql)) return { rowCount: 1, rows: [{ batch_id: "inserted" }] };
      return { rowCount: 1, rows: [] };
    },
    release() {}
  };
  const result = await writePostgresProductionState({ settings: { enabled: false } }, {
    pool: { async connect() { return client; } },
    config: { writeEnabled: true },
    allowWrite: true,
    expectedVersions: { settings: 2 },
    actor: "database release manager",
    reason: "Approved production adapter transaction rehearsal."
  });
  assert.equal(queries[0].sql, "BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");
  assert.equal(queries.some((item) => /pg_advisory_xact_lock/.test(item.sql)), true);
  assert.equal(queries.some((item) => /FOR UPDATE/.test(item.sql)), true);
  assert.equal(queries.some((item) => /runtime_primary_write_audit/.test(item.sql)), true);
  assert.equal(queries.at(-1).sql, "COMMIT");
  assert.equal(result.status, "applied");
  assert.equal(result.changedCollections, 1);
  assert.equal(result.productionPrimary, false);
  assert.equal(result.payloadsExposed, false);
  assert.doesNotMatch(JSON.stringify(result), /enabled|database release manager/);
});

test("PostgreSQL production adapter blocks writes without evidence and rolls back conflicts", async () => {
  await assert.rejects(() => writePostgresProductionState({ settings: {} }, {
    config: { writeEnabled: false },
    allowWrite: true
  }), (error) => error.code === "POSTGRES_PRIMARY_WRITE_BLOCKED");

  const queries = [];
  const client = {
    async query(sql) {
      queries.push(sql.trim());
      if (/SELECT collection_name/.test(sql)) return { rows: [currentRow("settings", { enabled: true }, 2)] };
      return { rows: [] };
    },
    release() {}
  };
  await assert.rejects(() => createPostgresProductionAdapter({
    pool: { async connect() { return client; } },
    config: { writeEnabled: true }
  }).write({ settings: { enabled: false } }, {
    allowWrite: true,
    expectedVersions: { settings: 1 },
    actor: "database manager",
    reason: "Version conflict regression coverage."
  }), (error) => error.code === "POSTGRES_PRIMARY_WRITE_CONFLICT");
  assert.equal(queries.at(-1), "ROLLBACK");
});

test("PostgreSQL production adapter verifies the runtime and audit schema without exposing credentials", async () => {
  const queries = [];
  const client = {
    async query(sql) {
      queries.push(sql.trim());
      if (/to_regclass/.test(sql)) {
        return { rows: [{
          sync_batches: "health_platform.runtime_sync_batches",
          collection_state: "health_platform.runtime_collection_state",
          primary_write_audit: "health_platform.runtime_primary_write_audit"
        }] };
      }
      return { rows: [] };
    },
    release() {}
  };
  const result = await verifyPostgresProductionAdapterSchema({
    pool: { async connect() { return client; } },
    config: { configured: true, adapterMode: "rehearsal" },
    checkedAt: "2026-07-14T06:00:00.000Z"
  });
  assert.equal(queries[0], "BEGIN READ ONLY");
  assert.equal(queries.at(-1), "COMMIT");
  assert.equal(result.ok, true);
  assert.equal(Object.values(result.checks).every(Boolean), true);
  assert.equal(result.productionPrimary, false);
  assert.doesNotMatch(JSON.stringify(result), /DATABASE_URL|postgres:\/\//);
});

test("PostgreSQL production adapter status CLI is safe for release evidence", async () => {
  const status = await runCli(["status"], {
    POSTGRES_ADAPTER_MODE: "rehearsal",
    DATABASE_URL: "postgres://user:secret@db/platform"
  });
  assert.equal(status.ok, true);
  assert.equal(status.configured, true);
  assert.equal(status.writeEnabled, false);
  assert.equal(status.productionPrimary, false);
  assert.doesNotMatch(JSON.stringify(status), /user:secret|DATABASE_URL/);
});
