const fs = require("node:fs");
const path = require("node:path");

const {
  claimExecutionJob,
  completeExecutionAttempt,
  createExecutionState,
  enqueueExecutionJob,
  evaluateCutoverWindow,
  failExecutionAttempt,
  getExecutionRuntimeSummary,
  heartbeatExecutionJob,
  recoverExpiredLeases,
  redriveDeadLetter,
  registerExecutionWorker,
  registerVaultReference,
  releaseQuarantine,
  sha256,
  verifyExecutionCallback
} = require("./digital-hospital-integration-execution");
const {
  approveCutover,
  buildCutoverGovernanceBoard,
  completeProductionCutover,
  createCutoverEvidencePack,
  evaluateProductionCutover,
  recordCutoverEvidence,
  rollbackProductionCutover,
  startProductionCutover,
  verifyCutoverEvidence
} = require("./digital-hospital-cutover-governance");

const FORBIDDEN_PERSISTED_KEYS = new Set([
  "apiKey",
  "credential",
  "idempotencyKey",
  "leaseToken",
  "nonce",
  "password",
  "privateKey",
  "rawPayload",
  "secret",
  "secretValue",
  "signature",
  "token",
  "tokenValue",
  "vaultRef"
]);

function serviceError(message, code, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertExecutionPersistenceBoundary(value, location = "state") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertExecutionPersistenceBoundary(item, `${location}[${index}]`));
    return true;
  }
  if (!value || typeof value !== "object") return true;
  Object.entries(value).forEach(([key, item]) => {
    if (FORBIDDEN_PERSISTED_KEYS.has(key)) {
      throw serviceError(`forbidden execution field cannot be persisted: ${location}.${key}`, "EXECUTION_SECRET_PERSISTENCE_BLOCKED");
    }
    assertExecutionPersistenceBoundary(item, `${location}.${key}`);
  });
  return true;
}

function seedDigitalHospitalExecutionState() {
  const state = createExecutionState({
    environments: [
      {
        id: "ENV-PILOT-UAT",
        name: "首批试点联调环境",
        status: "healthy",
        networkZone: "政务外网接入区",
        verifiedAt: "2026-07-29T00:10:00.000Z"
      },
      {
        id: "ENV-PILOT-PROD",
        name: "首批试点生产环境",
        status: "healthy",
        networkZone: "生产接入区",
        verifiedAt: "2026-07-29T00:12:00.000Z"
      }
    ],
    cutoverWindows: [{
      id: "CUTOVER-PILOT-001",
      environmentId: "ENV-PILOT-PROD",
      connectorIds: ["CONN-HIS-001"],
      integrationApproved: true,
      rollbackPlan: "Restore the previous gateway route and replay the reconciliation ledger.",
      plannedAt: "2026-08-03T14:00:00.000Z",
      status: "blocked",
      checks: {}
    }]
  });
  registerVaultReference(state, {
    id: "VAULT-HIS-PROD",
    connectorId: "CONN-HIS-001",
    environmentId: "ENV-PILOT-PROD",
    provider: "managed-vault",
    vaultRef: "vault://digital-hospital/prod/conn-his-001",
    keyVersion: 3,
    rotationDueAt: "2026-10-31T00:00:00.000Z",
    owner: "平台安全组",
    updatedAt: "2026-07-29T00:15:00.000Z"
  });
  registerExecutionWorker(state, {
    id: "WORKER-PILOT-01",
    node: "worker-pilot-a",
    pool: "certification",
    capabilities: ["contract-certification", "full-chain", "reconciliation"],
    now: "2026-07-29T00:20:00.000Z"
  });
  const completed = enqueueExecutionJob(state, {
    id: "JOB-PILOT-CERT-001",
    connectorId: "CONN-HIS-001",
    environmentId: "ENV-PILOT-PROD",
    jobType: "contract-certification",
    idempotencyKey: "pilot-certification-001",
    payload: { contractVersion: "v1", institution: "pilot-001" },
    now: "2026-07-29T00:21:00.000Z"
  }).job;
  const completedState = state.jobs.find((item) => item.id === completed.id);
  completedState.status = "succeeded";
  completedState.progress = 100;
  completedState.attempts = 1;
  completedState.startedAt = "2026-07-29T00:22:00.000Z";
  completedState.completedAt = "2026-07-29T00:23:00.000Z";
  completedState.receiptId = "RECEIPT-PILOT-001";
  state.receipts.unshift({
    id: "RECEIPT-PILOT-001",
    jobId: completed.id,
    connectorId: completed.connectorId,
    source: completed.connectorId,
    eventType: "integration-job.completed",
    signatureStatus: "valid",
    timestampStatus: "valid",
    nonceStatus: "fresh",
    nonceHash: sha256("CONN-HIS-001:seed-receipt"),
    payloadDigest: completed.payloadDigest,
    digestStatus: "matched",
    status: "accepted",
    decision: "verified",
    receivedAt: "2026-07-29T00:23:00.000Z"
  });
  enqueueExecutionJob(state, {
    id: "JOB-PILOT-FULL-002",
    connectorId: "CONN-HIS-001",
    environmentId: "ENV-PILOT-PROD",
    jobType: "full-chain",
    idempotencyKey: "pilot-full-chain-002",
    payload: { batch: "pilot-002" },
    now: "2026-07-29T00:24:00.000Z"
  });
  assertExecutionPersistenceBoundary(state);
  return state;
}

class MemoryExecutionRepository {
  constructor(seed = seedDigitalHospitalExecutionState()) {
    this.state = createExecutionState(seed);
    this.version = 1;
  }

  read() {
    return { state: clone(this.state), version: this.version, storage: "memory" };
  }

  transact(mutator) {
    const next = createExecutionState(this.state);
    const result = mutator(next);
    assertExecutionPersistenceBoundary(next);
    this.state = next;
    this.version += 1;
    return { result: clone(result), state: clone(next), version: this.version, storage: "memory" };
  }

  close() {}
}

class SqliteExecutionRepository {
  constructor(options = {}) {
    const databaseFile = String(options.databaseFile || "").trim();
    if (!databaseFile) throw serviceError("execution database file is required", "EXECUTION_DATABASE_FILE_REQUIRED");
    fs.mkdirSync(path.dirname(path.resolve(databaseFile)), { recursive: true });
    const { DatabaseSync } = require("node:sqlite");
    this.databaseFile = path.resolve(databaseFile);
    this.database = new DatabaseSync(this.databaseFile);
    this.database.exec("PRAGMA journal_mode = WAL");
    this.database.exec("PRAGMA synchronous = FULL");
    this.database.exec(`PRAGMA busy_timeout = ${Math.max(1000, Number(options.busyTimeoutMs || 5000))}`);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS digital_hospital_execution_state (
        singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
        version INTEGER NOT NULL,
        state_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT
    `);
    const existing = this.database.prepare(
      "SELECT singleton_id FROM digital_hospital_execution_state WHERE singleton_id = 1"
    ).get();
    if (!existing) {
      const seed = createExecutionState(
        typeof options.seed === "function" ? options.seed() : (options.seed || seedDigitalHospitalExecutionState())
      );
      assertExecutionPersistenceBoundary(seed);
      this.database.prepare(`
        INSERT INTO digital_hospital_execution_state (singleton_id, version, state_json, updated_at)
        VALUES (1, 1, ?, ?)
      `).run(JSON.stringify(seed), new Date().toISOString());
    }
  }

  read() {
    const row = this.database.prepare(
      "SELECT version, state_json, updated_at FROM digital_hospital_execution_state WHERE singleton_id = 1"
    ).get();
    if (!row) throw serviceError("execution state is unavailable", "EXECUTION_STATE_UNAVAILABLE", 503);
    return {
      state: createExecutionState(JSON.parse(row.state_json)),
      version: Number(row.version),
      updatedAt: row.updated_at,
      storage: "sqlite-wal"
    };
  }

  transact(mutator) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const current = this.read();
      const next = createExecutionState(current.state);
      const result = mutator(next);
      assertExecutionPersistenceBoundary(next);
      const version = current.version + 1;
      const updatedAt = new Date().toISOString();
      this.database.prepare(`
        UPDATE digital_hospital_execution_state
        SET version = ?, state_json = ?, updated_at = ?
        WHERE singleton_id = 1 AND version = ?
      `).run(version, JSON.stringify(next), updatedAt, current.version);
      this.database.exec("COMMIT");
      return {
        result: clone(result),
        state: clone(next),
        version,
        updatedAt,
        storage: "sqlite-wal"
      };
    } catch (error) {
      try {
        this.database.exec("ROLLBACK");
      } catch {
        // The original transaction error is more useful.
      }
      throw error;
    }
  }

  close() {
    if (this.database) this.database.close();
    this.database = null;
  }
}

function publicExecutionState(state) {
  return {
    environments: clone(state.environments),
    vaultEntries: clone(state.vaultEntries),
    jobs: clone(state.jobs),
    workers: clone(state.workers),
    deadLetters: clone(state.deadLetters),
    executionEvents: clone(state.executionEvents.slice(0, 200)),
    receipts: clone(state.receipts.slice(0, 200)),
    replayEvents: clone(state.replayEvents.slice(0, 200)),
    quarantines: clone(state.quarantines),
    cutoverWindows: clone(state.cutoverWindows),
    cutoverEvidencePacks: clone(state.cutoverEvidencePacks),
    cutoverApprovals: clone(state.cutoverApprovals),
    cutoverEvents: clone(state.cutoverEvents.slice(0, 200))
  };
}

class DigitalHospitalExecutionService {
  constructor(repository) {
    if (!repository || typeof repository.read !== "function" || typeof repository.transact !== "function") {
      throw serviceError("execution repository is required", "EXECUTION_REPOSITORY_REQUIRED");
    }
    this.repository = repository;
  }

  runtimeBoard(now = new Date().toISOString()) {
    const snapshot = this.repository.read();
    return {
      ok: true,
      generatedAt: now,
      repository: {
        storage: snapshot.storage,
        version: snapshot.version,
        updatedAt: snapshot.updatedAt || "",
        atomicClaims: true,
        durableLeases: snapshot.storage !== "memory"
      },
      summary: getExecutionRuntimeSummary(snapshot.state, now),
      cutoverGovernance: buildCutoverGovernanceBoard(snapshot.state),
      ...publicExecutionState(snapshot.state)
    };
  }

  mutate(mutator) {
    const transaction = this.repository.transact(mutator);
    return {
      ok: true,
      repositoryVersion: transaction.version,
      result: transaction.result
    };
  }

  registerWorker(input) {
    return this.mutate((state) => registerExecutionWorker(state, input));
  }

  registerVaultReference(input) {
    return this.mutate((state) => registerVaultReference(state, input));
  }

  enqueue(input) {
    return this.mutate((state) => enqueueExecutionJob(state, input));
  }

  claim(input) {
    return this.mutate((state) => claimExecutionJob(state, input));
  }

  heartbeat(jobId, input) {
    return this.mutate((state) => heartbeatExecutionJob(state, jobId, input));
  }

  completeAttempt(jobId, input) {
    return this.mutate((state) => completeExecutionAttempt(state, jobId, input));
  }

  failAttempt(jobId, input) {
    return this.mutate((state) => failExecutionAttempt(state, jobId, input));
  }

  recoverExpiredLeases(input) {
    return this.mutate((state) => recoverExpiredLeases(state, input));
  }

  redrive(deadLetterId, input) {
    return this.mutate((state) => redriveDeadLetter(state, deadLetterId, input));
  }

  verifyCallback(input, policy) {
    return this.mutate((state) => verifyExecutionCallback(state, input, policy));
  }

  releaseQuarantine(quarantineId, input) {
    return this.mutate((state) => releaseQuarantine(state, quarantineId, input));
  }

  evaluateCutover(windowId, now) {
    return this.mutate((state) => evaluateCutoverWindow(state, windowId, now));
  }

  createCutoverEvidencePack(input) {
    return this.mutate((state) => createCutoverEvidencePack(state, input));
  }

  recordCutoverEvidence(packId, input) {
    return this.mutate((state) => recordCutoverEvidence(state, packId, input));
  }

  verifyCutoverEvidence(packId, evidenceId, input) {
    return this.mutate((state) => verifyCutoverEvidence(state, packId, evidenceId, input));
  }

  approveCutover(packId, input) {
    return this.mutate((state) => approveCutover(state, packId, input));
  }

  evaluateProductionCutover(packId, context) {
    return this.mutate((state) => evaluateProductionCutover(state, packId, context));
  }

  startProductionCutover(packId, input) {
    return this.mutate((state) => startProductionCutover(state, packId, input));
  }

  completeProductionCutover(packId, input) {
    return this.mutate((state) => completeProductionCutover(state, packId, input));
  }

  rollbackProductionCutover(packId, input) {
    return this.mutate((state) => rollbackProductionCutover(state, packId, input));
  }

  close() {
    if (typeof this.repository.close === "function") this.repository.close();
  }
}

function createDigitalHospitalExecutionService(options = {}) {
  const repository = options.repository || new SqliteExecutionRepository(options);
  return new DigitalHospitalExecutionService(repository);
}

module.exports = {
  DigitalHospitalExecutionService,
  MemoryExecutionRepository,
  SqliteExecutionRepository,
  assertExecutionPersistenceBoundary,
  createDigitalHospitalExecutionService,
  publicExecutionState,
  seedDigitalHospitalExecutionState,
  serviceError
};
