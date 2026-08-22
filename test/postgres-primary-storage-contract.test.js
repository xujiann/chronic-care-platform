const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const test = require("node:test");

const { buildPostgresSyncBatch } = require("../postgres-runtime-sync");
const { canonicalStringify } = require("../scripts/postgres-migration-package");
const {
  buildPostgresPrimaryStorageConfig,
  buildTransitionAssessment,
  createPostgresPrimaryStorageContract
} = require("../src/platform/storage/postgres-primary-storage-contract");
const {
  createMemoryPostgresPrimaryDriver
} = require("../src/platform/storage/memory-postgres-primary-driver");

function digest(value) {
  return createHash("sha256").update(canonicalStringify(value)).digest("hex");
}

function evidenceEnv(mode) {
  return {
    NODE_ENV: "production",
    POSTGRES_PRIMARY_STORAGE_MODE: mode,
    DATABASE_URL: "postgresql://private-user:private-password@db.internal/platform",
    POSTGRES_SSL_MODE: "verify-full",
    POSTGRES_SCHEMA_EVIDENCE_ID: "schema:2026-08-06",
    POSTGRES_MIGRATION_EVIDENCE_ID: "migration:2026-08-06",
    POSTGRES_RECONCILIATION_EVIDENCE_ID: "reconciliation:2026-08-06",
    POSTGRES_BACKUP_EVIDENCE_ID: "backup:2026-08-06",
    POSTGRES_RTO_RPO_EVIDENCE_ID: "recovery:2026-08-06",
    POSTGRES_ROLLBACK_EVIDENCE_ID: "rollback:2026-08-06",
    POSTGRES_CUTOVER_APPROVAL_ID: "approval:2026-08-06"
  };
}

function commitment(batch, sequence = 1) {
  return {
    state: "committed",
    source: "sqlite-transactional-outbox",
    sourceTransactionId: `sqlite-tx-${sequence}`,
    outboxSequence: sequence,
    committedAt: `2026-08-06T00:00:0${sequence}.000Z`,
    payloadSha256: batch.payloadSha256
  };
}

function change(collection, value, sourceVersion, operation = "upsert") {
  if (operation === "delete") return { collection, operation, sourceVersion };
  return {
    collection,
    operation,
    sourceVersion,
    payload: canonicalStringify(value),
    payloadSha256: digest(value)
  };
}

function batch(changes, options = {}) {
  return buildPostgresSyncBatch(changes, {
    createdAt: options.createdAt || "2026-08-06T00:00:00.000Z",
    sourceEvent: options.sourceEvent || "write-state",
    previousChainHash: options.previousChainHash || ""
  });
}

test("PostgreSQL primary storage mode is explicit, fail-closed and credential-safe", () => {
  const disabled = buildPostgresPrimaryStorageConfig({});
  assert.equal(disabled.mode, "disabled");
  assert.equal(disabled.modeReady, true);
  assert.equal(disabled.capabilities.primaryRead, false);
  assert.equal(disabled.capabilities.primaryWriteRelay, false);
  assert.equal(disabled.capabilities.requestPathWrite, false);
  assert.equal(disabled.productionPrimary, false);

  const missingEvidence = buildPostgresPrimaryStorageConfig({
    POSTGRES_PRIMARY_STORAGE_MODE: "primary-write",
    DATABASE_URL: "postgresql://private-user:private-password@db.internal/platform",
    POSTGRES_SSL_MODE: "require"
  });
  assert.equal(missingEvidence.modeReady, false);
  assert.equal(missingEvidence.primaryWriteReady, false);
  assert.equal(JSON.stringify(missingEvidence).includes("private-password"), false);

  const ready = buildPostgresPrimaryStorageConfig(evidenceEnv("primary-write"));
  assert.equal(ready.modeReady, true);
  assert.equal(ready.capabilities.primaryRead, true);
  assert.equal(ready.capabilities.primaryWriteRelay, true);
  assert.equal(ready.capabilities.requestPathWrite, false);
  assert.equal(ready.writeBoundary, "committed-outbox-only");
  assert.equal(ready.productionPrimary, false);
  assert.equal(ready.runtimeCutoverEnabled, false);

  assert.throws(
    () => buildPostgresPrimaryStorageConfig({ POSTGRES_PRIMARY_STORAGE_MODE: "automatic" }),
    (error) => error.code === "INVALID_POSTGRES_PRIMARY_STORAGE_MODE"
  );
});

test("shadow mode requires TLS and migration evidence but never enables primary reads", () => {
  const env = evidenceEnv("shadow");
  delete env.POSTGRES_RECONCILIATION_EVIDENCE_ID;
  delete env.POSTGRES_BACKUP_EVIDENCE_ID;
  delete env.POSTGRES_RTO_RPO_EVIDENCE_ID;
  delete env.POSTGRES_ROLLBACK_EVIDENCE_ID;
  delete env.POSTGRES_CUTOVER_APPROVAL_ID;
  const config = buildPostgresPrimaryStorageConfig(env);
  assert.equal(config.shadowReady, true);
  assert.equal(config.modeReady, true);
  assert.equal(config.capabilities.shadowApply, true);
  assert.equal(config.capabilities.primaryRead, false);
  assert.equal(config.productionPrimary, false);

  const tlsBlocked = buildPostgresPrimaryStorageConfig({ ...env, POSTGRES_SSL_MODE: "require" });
  assert.equal(tlsBlocked.shadowReady, false);
  assert.equal(tlsBlocked.modeReady, false);
  assert.equal(tlsBlocked.capabilities.shadowApply, false);
});

test("every primary mode evidence reference is independently fail-closed", () => {
  const requiredEvidence = [
    "POSTGRES_SCHEMA_EVIDENCE_ID",
    "POSTGRES_MIGRATION_EVIDENCE_ID",
    "POSTGRES_RECONCILIATION_EVIDENCE_ID",
    "POSTGRES_BACKUP_EVIDENCE_ID",
    "POSTGRES_RTO_RPO_EVIDENCE_ID",
    "POSTGRES_ROLLBACK_EVIDENCE_ID",
    "POSTGRES_CUTOVER_APPROVAL_ID"
  ];
  requiredEvidence.forEach((name) => {
    const env = evidenceEnv("primary-write");
    delete env[name];
    const config = buildPostgresPrimaryStorageConfig(env);
    assert.equal(config.modeReady, false, `${name} must block mode readiness`);
    assert.equal(config.primaryWriteReady, false, `${name} must block primary write`);
    assert.equal(config.capabilities.primaryWriteRelay, false, `${name} must block the relay`);
    assert.equal(config.productionPrimary, false);
  });
});

test("committed outbox relay applies baseline and ordered CAS changes transactionally", async () => {
  const driver = createMemoryPostgresPrimaryDriver();
  const storage = createPostgresPrimaryStorageContract({
    config: buildPostgresPrimaryStorageConfig(evidenceEnv("primary-write")),
    driver
  });
  const baseline = batch([
    change("residents", [{ id: "r1" }], 4),
    change("settings", { enabled: true }, 2)
  ], { sourceEvent: "baseline-snapshot" });
  const applied = await storage.applyCommittedOutbox(baseline, {
    commitment: commitment(baseline, 1),
    executionContext: "worker",
    appliedAt: "2026-08-06T00:01:00.000Z"
  });
  assert.equal(applied.status, "applied");
  assert.equal(applied.appliedChanges, 2);
  assert.equal(applied.productionPrimary, false);
  assert.equal(driver.history.at(-1).isolation, "serializable");
  assert.equal(driver.history.at(-1).outcome, "committed");

  const next = batch([
    change("settings", { enabled: false }, 3),
    change("residents", null, 5, "delete")
  ], {
    createdAt: "2026-08-06T00:00:02.000Z",
    previousChainHash: baseline.chainHash
  });
  const changed = await storage.applyCommittedOutbox(next, {
    commitment: commitment(next, 2),
    executionContext: "worker"
  });
  assert.equal(changed.appliedChanges, 2);
  const snapshot = driver.snapshot();
  assert.equal(snapshot.collections.find((row) => row.collection === "residents").deleted, true);
  assert.equal(snapshot.collections.find((row) => row.collection === "residents").sourceVersion, 5);
  assert.equal(snapshot.collections.find((row) => row.collection === "settings").sourceVersion, 3);
  assert.equal(snapshot.batches.length, 2);
});

test("outbox relay is idempotent and rejects request-path, uncommitted and broken-chain writes", async () => {
  const driver = createMemoryPostgresPrimaryDriver();
  const storage = createPostgresPrimaryStorageContract({
    config: buildPostgresPrimaryStorageConfig(evidenceEnv("primary-write")),
    driver
  });
  const initial = batch([change("settings", { enabled: true }, 0)], {
    sourceEvent: "baseline-snapshot"
  });

  await assert.rejects(
    () => storage.applyCommittedOutbox(initial, {
      commitment: commitment(initial),
      executionContext: "request-path"
    }),
    (error) => error.code === "POSTGRES_REQUEST_PATH_WRITE_PROHIBITED"
  );
  await assert.rejects(
    () => storage.applyCommittedOutbox(initial, {
      commitment: { ...commitment(initial), state: "pending" },
      executionContext: "worker"
    }),
    (error) => error.code === "POSTGRES_COMMITTED_OUTBOX_RECEIPT_REQUIRED"
  );

  await storage.applyCommittedOutbox(initial, {
    commitment: commitment(initial),
    executionContext: "worker"
  });
  const duplicate = await storage.applyCommittedOutbox(initial, {
    commitment: commitment(initial),
    executionContext: "worker"
  });
  assert.equal(duplicate.status, "duplicate");
  assert.equal(duplicate.appliedChanges, 0);
  assert.equal(driver.snapshot().batches.length, 1);

  const broken = batch([change("settings", { enabled: false }, 1)], {
    previousChainHash: "f".repeat(64)
  });
  await assert.rejects(
    () => storage.applyCommittedOutbox(broken, {
      commitment: commitment(broken, 2),
      executionContext: "worker"
    }),
    (error) => error.code === "POSTGRES_PRIMARY_OUTBOX_CHAIN_CONFLICT"
  );
  assert.equal(driver.snapshot().batches.length, 1);
  assert.equal(driver.history.at(-1).outcome, "rolled-back");
});

test("a collection CAS failure rolls back every earlier change in the same batch", async () => {
  const seedValue = { enabled: true };
  const driver = createMemoryPostgresPrimaryDriver({
    collections: [{
      collection: "settings",
      sourceVersion: 3,
      deleted: false,
      payload: canonicalStringify(seedValue),
      payloadSha256: digest(seedValue),
      batchId: "seed"
    }, {
      collection: "residents",
      sourceVersion: 2,
      deleted: false,
      payload: canonicalStringify([]),
      payloadSha256: digest([]),
      batchId: "seed"
    }],
    batches: [{
      batchId: "seed",
      payloadSha256: "a".repeat(64),
      previousChainHash: "",
      chainHash: "b".repeat(64)
    }]
  });
  const storage = createPostgresPrimaryStorageContract({
    config: buildPostgresPrimaryStorageConfig(evidenceEnv("primary-write")),
    driver
  });
  const conflicting = batch([
    change("residents", [{ id: "r1" }], 3),
    change("settings", { enabled: false }, 5)
  ], { previousChainHash: "b".repeat(64) });

  await assert.rejects(
    () => storage.applyCommittedOutbox(conflicting, {
      commitment: commitment(conflicting, 2),
      executionContext: "worker"
    }),
    (error) => error.code === "POSTGRES_PRIMARY_COLLECTION_CAS_CONFLICT"
  );
  const state = driver.snapshot();
  assert.equal(state.collections.find((row) => row.collection === "residents").sourceVersion, 2);
  assert.equal(state.collections.find((row) => row.collection === "settings").sourceVersion, 3);
  assert.equal(state.batches.length, 1);
  assert.equal(driver.history.at(-1).outcome, "rolled-back");
});

test("primary-read exposes digest-verified collections through read-only repeatable-read transactions", async () => {
  const residents = [{ id: "r1", name: "sensitive name" }];
  const driver = createMemoryPostgresPrimaryDriver({
    collections: [{
      collection: "residents",
      sourceVersion: 7,
      deleted: false,
      payload: canonicalStringify(residents),
      payloadSha256: digest(residents),
      batchId: "batch-7"
    }]
  });
  const storage = createPostgresPrimaryStorageContract({
    config: buildPostgresPrimaryStorageConfig(evidenceEnv("primary-read")),
    driver
  });
  const row = await storage.readCollection("residents");
  assert.equal(row.sourceVersion, 7);
  assert.equal(row.value[0].id, "r1");

  const snapshot = await storage.readSnapshot({ requiredCollections: ["residents"] });
  assert.equal(snapshot.state.residents[0].name, "sensitive name");
  assert.equal(snapshot.report.collections, 1);
  assert.equal(snapshot.report.transaction, "repeatable-read-read-only");
  assert.equal(snapshot.report.productionPrimary, false);
  assert.equal(snapshot.report.payloadsExposed, false);
  assert.equal(driver.history.every((item) => item.readOnly), true);
});

test("shadow reconciliation is payload-free and reports version and digest differences", async () => {
  const target = { enabled: true };
  const driver = createMemoryPostgresPrimaryDriver({
    collections: [{
      collection: "settings",
      sourceVersion: 2,
      deleted: false,
      payload: canonicalStringify(target),
      payloadSha256: digest(target),
      batchId: "batch-2"
    }]
  });
  const storage = createPostgresPrimaryStorageContract({
    config: buildPostgresPrimaryStorageConfig(evidenceEnv("shadow")),
    driver
  });
  const report = await storage.compareShadow([{
    collection: "settings",
    sourceVersion: 3,
    payloadSha256: digest({ enabled: false })
  }]);
  assert.equal(report.ok, false);
  assert.equal(report.mismatched, 1);
  assert.deepEqual(report.differences[0].types, ["version-mismatch", "digest-mismatch"]);
  assert.equal(report.productionPrimary, false);
  assert.doesNotMatch(JSON.stringify(report), /"enabled"/);
});

function completeTransitionEvidence() {
  const sourceDigest = "a".repeat(64);
  return {
    requestedMode: "primary-write",
    migration: {
      status: "verified",
      sourceCollections: 150,
      targetCollections: 150,
      sourceDigest,
      targetDigest: sourceDigest
    },
    reconciliation: {
      status: "matched",
      mismatched: 0,
      unresolvedCases: 0
    },
    delivery: { pending: 0, retry: 0, failed: 0 },
    recovery: {
      backupStatus: "verified",
      restoreStatus: "verified",
      measuredRtoSeconds: 240,
      targetRtoSeconds: 300,
      measuredRpoSeconds: 20,
      targetRpoSeconds: 30
    },
    capacity: {
      status: "verified",
      profileRef: "controlled://database/capacity-profile-2026-08-22",
      evidenceRef: "controlled://database/capacity-result-2026-08-22",
      targetRecords: 1_000_000,
      testedRecords: 1_200_000,
      targetConcurrency: 200,
      measuredConcurrency: 240,
      targetThroughputPerSecond: 500,
      measuredThroughputPerSecond: 560,
      targetP95LatencyMs: 300,
      measuredP95LatencyMs: 220,
      targetP99LatencyMs: 800,
      measuredP99LatencyMs: 640,
      criticalFindingsOpen: 0
    },
    failover: {
      status: "verified",
      evidenceRef: "controlled://database/failover-2026-08-22",
      targetFailoverSeconds: 120,
      measuredFailoverSeconds: 75,
      dataLossObserved: false,
      criticalFindingsOpen: 0
    },
    fallback: {
      status: "verified",
      target: "sqlite",
      dataLossObserved: false,
      evidenceRef: "fallback:2026-08-06"
    }
  };
}

test("transition assessment requires migration, reconciliation, drained outbox, recovery, capacity, failover and fallback evidence", () => {
  const config = buildPostgresPrimaryStorageConfig(evidenceEnv("primary-write"));
  const complete = completeTransitionEvidence();
  const ready = buildTransitionAssessment(complete, config);
  assert.equal(ready.readyForControlledRehearsal, true);
  assert.equal(ready.blockers.length, 0);
  assert.equal(ready.activationAuthorized, false);
  assert.equal(ready.productionReady, false);
  assert.equal(ready.productionPrimary, false);

  const blocked = buildTransitionAssessment({
    ...complete,
    reconciliation: { status: "mismatched", mismatched: 1, unresolvedCases: 1 },
    delivery: { pending: 2, retry: 1, failed: 0 },
    recovery: { ...complete.recovery, measuredRtoSeconds: 360 }
  }, config);
  assert.equal(blocked.readyForControlledRehearsal, false);
  assert.deepEqual(blocked.blockers, ["reconciliation", "outbox", "backup-and-recovery"]);
  assert.equal(blocked.productionPrimary, false);
});

test("transition assessment fails closed on missing capacity, failover and blank numeric evidence", () => {
  const config = buildPostgresPrimaryStorageConfig(evidenceEnv("primary-read"));
  const complete = { ...completeTransitionEvidence(), requestedMode: "primary-read" };

  const missing = buildTransitionAssessment({
    ...complete,
    capacity: undefined,
    failover: undefined
  }, config);
  assert.equal(missing.readyForControlledRehearsal, false);
  assert.deepEqual(missing.blockers, ["capacity-and-failover"]);

  const blank = buildTransitionAssessment({
    ...complete,
    delivery: { pending: "", retry: " ", failed: null },
    recovery: {
      ...complete.recovery,
      measuredRtoSeconds: "",
      targetRtoSeconds: " ",
      measuredRpoSeconds: Number.NaN,
      targetRpoSeconds: Number.POSITIVE_INFINITY
    },
    capacity: {
      ...complete.capacity,
      testedRecords: "",
      measuredThroughputPerSecond: Number.POSITIVE_INFINITY,
      criticalFindingsOpen: -1
    },
    failover: {
      ...complete.failover,
      measuredFailoverSeconds: "",
      dataLossObserved: true
    }
  }, config);
  assert.equal(blank.readyForControlledRehearsal, false);
  assert.deepEqual(blank.blockers, ["outbox", "backup-and-recovery", "capacity-and-failover"]);
  assert.equal(blank.activationAuthorized, false);
  assert.equal(blank.productionReady, false);
  assert.equal(blank.productionPrimary, false);
  assert.equal(blank.runtimeCutoverEnabled, false);
});

test("transition assessment rejects coercible counts, non-canonical metrics and non-string evidence references", () => {
  const config = buildPostgresPrimaryStorageConfig(evidenceEnv("primary-write"));
  const complete = completeTransitionEvidence();
  const cases = [
    ["blank migration count", { migration: { ...complete.migration, sourceCollections: "" } }, "migration"],
    ["infinite migration counts", {
      migration: { ...complete.migration, sourceCollections: Number.POSITIVE_INFINITY, targetCollections: Number.POSITIVE_INFINITY }
    }, "migration"],
    ["fractional migration counts", {
      migration: { ...complete.migration, sourceCollections: 1.5, targetCollections: 1.5 }
    }, "migration"],
    ["exponent migration counts", {
      migration: { ...complete.migration, sourceCollections: "1e2", targetCollections: "1e2" }
    }, "migration"],
    ["blank reconciliation count", {
      reconciliation: { ...complete.reconciliation, mismatched: "" }
    }, "reconciliation"],
    ["whitespace reconciliation count", {
      reconciliation: { ...complete.reconciliation, unresolvedCases: " " }
    }, "reconciliation"],
    ["hexadecimal outbox count", { delivery: { ...complete.delivery, pending: "0x0" } }, "outbox"],
    ["hexadecimal capacity count", {
      capacity: { ...complete.capacity, targetRecords: "0xF4240" }
    }, "capacity-and-failover"],
    ["exponent throughput", {
      capacity: { ...complete.capacity, targetThroughputPerSecond: "5e2" }
    }, "capacity-and-failover"],
    ["boolean capacity profile reference", {
      capacity: { ...complete.capacity, profileRef: true }
    }, "capacity-and-failover"],
    ["object capacity evidence reference", {
      capacity: { ...complete.capacity, evidenceRef: {} }
    }, "capacity-and-failover"],
    ["numeric failover evidence reference", {
      failover: { ...complete.failover, evidenceRef: 1234 }
    }, "capacity-and-failover"]
  ];

  cases.forEach(([label, overrides, blocker]) => {
    const assessment = buildTransitionAssessment({ ...complete, ...overrides }, config);
    assert.equal(assessment.readyForControlledRehearsal, false, label);
    assert.deepEqual(assessment.blockers, [blocker], label);
    assert.equal(assessment.activationAuthorized, false, label);
    assert.equal(assessment.productionPrimary, false, label);
  });
});

test("capacity and failover gates reject unmet targets, untrusted references and open findings", () => {
  const config = buildPostgresPrimaryStorageConfig(evidenceEnv("primary-write"));
  const complete = completeTransitionEvidence();
  const cases = [
    ["capacity status", { capacity: { ...complete.capacity, status: "pending" } }],
    ["capacity profile reference", { capacity: { ...complete.capacity, profileRef: "bad\nreference" } }],
    ["tested records", { capacity: { ...complete.capacity, testedRecords: complete.capacity.targetRecords - 1 } }],
    ["measured concurrency", { capacity: { ...complete.capacity, measuredConcurrency: complete.capacity.targetConcurrency - 1 } }],
    ["measured throughput", { capacity: { ...complete.capacity, measuredThroughputPerSecond: complete.capacity.targetThroughputPerSecond - 1 } }],
    ["P95 latency", { capacity: { ...complete.capacity, measuredP95LatencyMs: complete.capacity.targetP95LatencyMs + 1 } }],
    ["P99 latency", { capacity: { ...complete.capacity, measuredP99LatencyMs: complete.capacity.targetP99LatencyMs + 1 } }],
    ["capacity critical finding", { capacity: { ...complete.capacity, criticalFindingsOpen: 1 } }],
    ["failover status", { failover: { ...complete.failover, status: "failed" } }],
    ["failover evidence reference", { failover: { ...complete.failover, evidenceRef: "" } }],
    ["failover duration", { failover: { ...complete.failover, measuredFailoverSeconds: complete.failover.targetFailoverSeconds + 1 } }],
    ["failover data loss", { failover: { ...complete.failover, dataLossObserved: true } }],
    ["failover critical finding", { failover: { ...complete.failover, criticalFindingsOpen: 1 } }]
  ];

  cases.forEach(([label, overrides]) => {
    const assessment = buildTransitionAssessment({ ...complete, ...overrides }, config);
    assert.equal(assessment.readyForControlledRehearsal, false, label);
    assert.deepEqual(assessment.blockers, ["capacity-and-failover"], label);
    assert.equal(assessment.productionPrimary, false, label);
  });
});
