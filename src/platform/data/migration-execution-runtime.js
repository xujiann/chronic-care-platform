"use strict";

const { randomUUID } = require("node:crypto");
const executionProgram = require("../../../config/data-migration-execution.json");
const migrationProgram = require("../../../config/data-migration-program.json");
const {
  SHA256,
  assertMetadataOnly,
  createTechnicalEvidenceFingerprint,
  sha256
} = require("../governance/technical-evidence");

const STATES = Object.freeze({
  PENDING: "pending",
  LEASED: "leased",
  APPLYING: "applying",
  AWAITING_RECONCILIATION: "awaiting-reconciliation",
  RECONCILED: "reconciled",
  LOCAL_CANDIDATE: "local-candidate",
  RECOVERY_EXHAUSTED: "recovery-exhausted"
});

function executionError(code, message, statusCode = 409) {
  return Object.assign(new Error(message), { code, statusCode });
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function text(value, field, pattern) {
  const normalized = String(value || "").trim();
  if (!normalized || (pattern && !pattern.test(normalized))) {
    throw executionError("DATA_MIGRATION_EXECUTION_METADATA_INVALID", `${field} is invalid`, 400);
  }
  return normalized;
}

function timestamp(value, field) {
  const normalized = text(value, field);
  if (Number.isNaN(Date.parse(normalized))) {
    throw executionError("DATA_MIGRATION_EXECUTION_TIMESTAMP_INVALID", `${field} must be an ISO timestamp`, 400);
  }
  return normalized;
}

function integer(value, field, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw executionError("DATA_MIGRATION_EXECUTION_COUNT_INVALID", `${field} must be an integer >= ${minimum}`, 400);
  }
  return value;
}

function digest(value, field) {
  const normalized = text(value, field).toLowerCase();
  if (!SHA256.test(normalized)) {
    throw executionError("DATA_MIGRATION_EXECUTION_DIGEST_INVALID", `${field} must be a sha256 digest`, 400);
  }
  return normalized;
}

function validateMigrationExecutionProgram(program = executionProgram) {
  if (program?.schemaVersion !== "data-migration-execution-program-v1") throw new TypeError("data migration execution program schema is invalid");
  if (program.executionBoundary !== "background-worker-only" || program.sourceBoundary !== "committed-local-outbox-only") {
    throw new TypeError("data migration execution must use a committed outbox background worker");
  }
  if (program.requestPathDualWrite !== false || program.metadataOnly !== true) {
    throw new TypeError("data migration execution must prohibit request-path dual writes and raw business data");
  }
  if (!Number.isInteger(program.lease?.minimumSeconds) || !Number.isInteger(program.lease?.maximumSeconds)
    || program.lease.minimumSeconds < 1 || program.lease.maximumSeconds < program.lease.minimumSeconds
    || !Number.isInteger(program.lease?.maximumCrashRecoveries) || program.lease.maximumCrashRecoveries < 1) {
    throw new TypeError("data migration execution lease policy is invalid");
  }
  if (program.checkpoint?.required !== true || program.checkpoint?.monotonic !== true || program.checkpoint?.recoverable !== true) {
    throw new TypeError("data migration execution requires a recoverable monotonic checkpoint");
  }
  const reconciliation = program.reconciliation || {};
  if (reconciliation.requireExactCounts !== true || reconciliation.allowedMismatchCount !== 0
    || reconciliation.allowedDuplicateCount !== 0 || reconciliation.requireMatchingDigest !== true) {
    throw new TypeError("data migration execution reconciliation must be exact");
  }
  if (program.candidate?.requiredControlState !== "local-candidate" || program.candidate?.requireMatchingCheckpoint !== true) {
    throw new TypeError("data migration local candidate gate is invalid");
  }
  if (program.productionActivationAuthorized !== false) throw new TypeError("repository execution cannot authorize production");
  return true;
}

function assertBackground(input) {
  if (input?.executionContext === "request-path") {
    throw executionError("DATA_MIGRATION_REQUEST_PATH_WRITE_PROHIBITED", "migration writes are prohibited on the request path");
  }
  if (input?.executionContext !== "background-worker") {
    throw executionError("DATA_MIGRATION_BACKGROUND_WORKER_REQUIRED", "migration execution requires the background-worker context");
  }
}

function safeBatch(batch) {
  if (!batch) return null;
  return Object.freeze({
    schemaVersion: batch.schemaVersion,
    batchId: batch.batchId,
    runId: batch.runId,
    waveId: batch.waveId,
    collections: Object.freeze([...batch.collections]),
    sourceTransactionId: batch.sourceTransactionId,
    sourceVersion: batch.sourceVersion,
    manifestDigest: batch.manifestDigest,
    sourceRange: Object.freeze({ ...batch.sourceRange }),
    state: batch.state,
    leaseVersion: batch.leaseVersion,
    leaseExpiresAt: batch.leaseExpiresAt || null,
    crashRecoveries: batch.crashRecoveries,
    checkpoint: batch.checkpoint ? Object.freeze({ ...batch.checkpoint }) : null,
    reconciliation: batch.reconciliation ? Object.freeze({ ...batch.reconciliation }) : null,
    localCandidate: batch.state === STATES.LOCAL_CANDIDATE,
    productionReady: false,
    productionPrimary: false,
    activationAuthorized: false,
    requestPathWrite: false,
    payloadsExposed: false,
    credentialsExposed: false
  });
}

function createMemoryMigrationExecutionRepository(seed = {}) {
  assertMetadataOnly(seed, "migrationExecutionRecoveryState");
  let records = new Map((seed.batches || []).map((item) => [item.batchId, clone(item)]));
  let events = clone(seed.outboxEvents || []);
  let eventSequence = events.reduce((maximum, event) => Math.max(maximum, Number(event.sequence) || 0), 0);

  return Object.freeze({
    transaction(work) {
      const previousRecords = clone([...records.entries()]);
      const previousEvents = clone(events);
      const previousSequence = eventSequence;
      const tx = {
        get(batchId) { return clone(records.get(batchId)); },
        list() { return clone([...records.values()]); },
        save(batch) { records.set(batch.batchId, clone(batch)); },
        appendEvent(event) {
          const committed = { ...clone(event), sequence: ++eventSequence, commitState: "committed" };
          events.push(committed);
          return clone(committed);
        }
      };
      try {
        return work(tx);
      } catch (error) {
        records = new Map(previousRecords);
        events = previousEvents;
        eventSequence = previousSequence;
        throw error;
      }
    },
    exportRecoveryState() {
      return clone({
        schemaVersion: "data-migration-execution-recovery-v1",
        batches: [...records.values()],
        outboxEvents: events,
        productionReady: false,
        productionPrimary: false,
        activationAuthorized: false,
        credentialsExposed: false,
        payloadsExposed: false
      });
    }
  });
}

function eventProjection(type, batch, at, detail = {}) {
  assertMetadataOnly(detail, "migrationExecutionEvent");
  const projection = {
    schemaVersion: "data-migration-execution-outbox-event-v1",
    eventId: `migration-${type}-${batch.batchId}-${batch.leaseVersion}-${detail.checkpointId || "none"}`,
    eventType: type,
    batchId: batch.batchId,
    runId: batch.runId,
    waveId: batch.waveId,
    state: batch.state,
    occurredAt: at,
    manifestDigest: batch.manifestDigest,
    detail,
    payloadsExposed: false,
    credentialsExposed: false,
    productionReady: false
  };
  return { ...projection, eventDigest: createTechnicalEvidenceFingerprint("data-migration-execution-outbox-event-v1", projection) };
}

function validatePlan(input) {
  assertMetadataOnly(input, "migrationExecutionPlan");
  assertBackground(input);
  const runId = text(input.runId, "runId", /^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/);
  const batchId = text(input.batchId, "batchId", /^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/);
  const waveId = text(input.waveId, "waveId", /^[a-z][a-z0-9-]+$/);
  const wave = migrationProgram.waves.find((item) => item.id === waveId);
  if (!wave) throw executionError("DATA_MIGRATION_EXECUTION_WAVE_UNKNOWN", `unknown migration wave: ${waveId}`, 400);
  const firstSequence = integer(input.sourceRange?.firstSequence, "sourceRange.firstSequence", 1);
  const lastSequence = integer(input.sourceRange?.lastSequence, "sourceRange.lastSequence", firstSequence);
  const eventCount = integer(input.sourceRange?.eventCount, "sourceRange.eventCount", 1);
  if (lastSequence - firstSequence + 1 !== eventCount) {
    throw executionError("DATA_MIGRATION_EXECUTION_RANGE_INVALID", "source outbox range and event count must be contiguous", 400);
  }
  const plan = {
    batchId,
    runId,
    waveId,
    collections: [...wave.collections],
    sourceTransactionId: text(input.sourceTransactionId, "sourceTransactionId"),
    sourceVersion: text(input.sourceVersion, "sourceVersion"),
    manifestDigest: digest(input.manifestDigest, "manifestDigest"),
    sourceRange: { firstSequence, lastSequence, eventCount },
    plannedAt: timestamp(input.plannedAt, "plannedAt")
  };
  return { ...plan, planDigest: createTechnicalEvidenceFingerprint("data-migration-execution-plan-v1", plan) };
}

function leaseMatches(batch, input, now) {
  if (![STATES.LEASED, STATES.APPLYING].includes(batch.state)
    || batch.leaseVersion !== input.leaseVersion
    || batch.leaseClaimDigest !== sha256(text(input.leaseKey, "leaseKey"))
    || Date.parse(batch.leaseExpiresAt) <= Date.parse(now)) {
    throw executionError("DATA_MIGRATION_EXECUTION_STALE_LEASE", "migration lease is stale, expired or invalid");
  }
}

function createMigrationExecutionRuntime(options = {}) {
  const program = options.program || executionProgram;
  validateMigrationExecutionProgram(program);
  const repository = options.repository || createMemoryMigrationExecutionRepository();
  if (!repository || typeof repository.transaction !== "function" || typeof repository.exportRecoveryState !== "function") {
    throw new TypeError("migration execution repository contract is invalid");
  }
  const currentTime = typeof options.now === "function" ? options.now : () => new Date().toISOString();
  const newLeaseKey = typeof options.newLeaseKey === "function" ? options.newLeaseKey : randomUUID;

  function plan(input) {
    const normalized = validatePlan(input);
    return repository.transaction((tx) => {
      const existing = tx.get(normalized.batchId);
      if (existing) {
        if (existing.planDigest !== normalized.planDigest) {
          throw executionError("DATA_MIGRATION_EXECUTION_IDEMPOTENCY_CONFLICT", "batch id was reused with different plan metadata");
        }
        return { idempotentReplay: true, batch: safeBatch(existing), outboxEvent: null };
      }
      const batch = {
        schemaVersion: "data-migration-execution-batch-v1",
        ...normalized,
        state: STATES.PENDING,
        leaseVersion: 0,
        leaseClaimDigest: "",
        leaseOwnerDigest: "",
        leaseExpiresAt: null,
        crashRecoveries: 0,
        checkpoint: null,
        reconciliation: null,
        productionReady: false,
        productionPrimary: false,
        activationAuthorized: false,
        requestPathWrite: false,
        payloadsExposed: false,
        credentialsExposed: false
      };
      const event = tx.appendEvent(eventProjection("planned", batch, normalized.plannedAt, { sourceRange: batch.sourceRange }));
      tx.save(batch);
      return { idempotentReplay: false, batch: safeBatch(batch), outboxEvent: event };
    });
  }

  function claim(input) {
    assertMetadataOnly(input, "migrationExecutionClaim");
    assertBackground(input);
    const now = timestamp(input.now || currentTime(), "now");
    const leaseSeconds = integer(input.leaseSeconds, "leaseSeconds", program.lease.minimumSeconds);
    if (leaseSeconds > program.lease.maximumSeconds) throw executionError("DATA_MIGRATION_EXECUTION_LEASE_INVALID", "lease duration exceeds policy", 400);
    const workerId = text(input.workerId, "workerId");
    const result = repository.transaction((tx) => {
      const batch = tx.get(text(input.batchId, "batchId"));
      if (!batch) throw executionError("DATA_MIGRATION_EXECUTION_BATCH_UNKNOWN", "migration batch does not exist", 404);
      const activeLease = [STATES.LEASED, STATES.APPLYING].includes(batch.state) && Date.parse(batch.leaseExpiresAt) > Date.parse(now);
      if (activeLease) throw executionError("DATA_MIGRATION_EXECUTION_BATCH_BUSY", "migration batch already has an active lease");
      if (![STATES.PENDING, STATES.LEASED, STATES.APPLYING].includes(batch.state)) {
        throw executionError("DATA_MIGRATION_EXECUTION_NOT_CLAIMABLE", `migration batch in ${batch.state} cannot be claimed`);
      }
      if ([STATES.LEASED, STATES.APPLYING].includes(batch.state)) {
        batch.crashRecoveries += 1;
        if (batch.crashRecoveries > program.lease.maximumCrashRecoveries) {
          batch.state = STATES.RECOVERY_EXHAUSTED;
          batch.leaseClaimDigest = "";
          batch.leaseOwnerDigest = "";
          batch.leaseExpiresAt = null;
          tx.save(batch);
          tx.appendEvent(eventProjection("recovery-exhausted", batch, now));
          return { recoveryExhausted: true, batch: safeBatch(batch) };
        }
      }
      const leaseKey = text(newLeaseKey(), "generated leaseKey");
      batch.state = batch.checkpoint ? STATES.APPLYING : STATES.LEASED;
      batch.leaseVersion += 1;
      batch.leaseClaimDigest = sha256(leaseKey);
      batch.leaseOwnerDigest = sha256(workerId);
      batch.leaseExpiresAt = new Date(Date.parse(now) + leaseSeconds * 1000).toISOString();
      tx.save(batch);
      tx.appendEvent(eventProjection("claimed", batch, now, { leaseVersion: batch.leaseVersion, crashRecoveries: batch.crashRecoveries }));
      return {
        batch: safeBatch(batch),
        claim: Object.freeze({ leaseKey, leaseVersion: batch.leaseVersion, expiresAt: batch.leaseExpiresAt }),
        recoveredFromCheckpoint: Boolean(batch.checkpoint)
      };
    });
    if (result.recoveryExhausted) {
      throw executionError("DATA_MIGRATION_EXECUTION_RECOVERY_EXHAUSTED", "migration batch exceeded crash recovery policy");
    }
    return result;
  }

  function recordCheckpoint(input) {
    assertMetadataOnly(input, "migrationExecutionCheckpoint");
    assertBackground(input);
    const now = timestamp(input.recordedAt || currentTime(), "recordedAt");
    return repository.transaction((tx) => {
      const batch = tx.get(text(input.batchId, "batchId"));
      if (!batch) throw executionError("DATA_MIGRATION_EXECUTION_BATCH_UNKNOWN", "migration batch does not exist", 404);
      leaseMatches(batch, input, now);
      const checkpoint = {
        checkpointId: text(input.checkpointId, "checkpointId", /^[A-Za-z0-9][A-Za-z0-9._-]{2,99}$/),
        sourceOutboxSequence: integer(input.sourceOutboxSequence, "sourceOutboxSequence", batch.sourceRange.firstSequence),
        appliedEventCount: integer(input.appliedEventCount, "appliedEventCount", 1),
        targetDigest: digest(input.targetDigest, "targetDigest"),
        recordedAt: now
      };
      if (checkpoint.sourceOutboxSequence > batch.sourceRange.lastSequence || checkpoint.appliedEventCount > batch.sourceRange.eventCount) {
        throw executionError("DATA_MIGRATION_EXECUTION_CHECKPOINT_RANGE_INVALID", "checkpoint exceeds the planned source range", 400);
      }
      checkpoint.checkpointDigest = createTechnicalEvidenceFingerprint("data-migration-execution-checkpoint-v1", checkpoint);
      if (batch.checkpoint) {
        const sameCheckpoint = batch.checkpoint.checkpointId === checkpoint.checkpointId
          && batch.checkpoint.sourceOutboxSequence === checkpoint.sourceOutboxSequence
          && batch.checkpoint.appliedEventCount === checkpoint.appliedEventCount
          && batch.checkpoint.targetDigest === checkpoint.targetDigest;
        if (sameCheckpoint) {
          return { idempotentReplay: true, batch: safeBatch(batch) };
        }
        if (checkpoint.sourceOutboxSequence <= batch.checkpoint.sourceOutboxSequence || checkpoint.appliedEventCount <= batch.checkpoint.appliedEventCount) {
          throw executionError("DATA_MIGRATION_EXECUTION_CHECKPOINT_REGRESSION", "checkpoint must advance monotonically");
        }
      }
      batch.state = STATES.APPLYING;
      batch.checkpoint = checkpoint;
      tx.save(batch);
      tx.appendEvent(eventProjection("checkpointed", batch, now, { checkpointId: checkpoint.checkpointId, checkpointDigest: checkpoint.checkpointDigest }));
      return { idempotentReplay: false, batch: safeBatch(batch) };
    });
  }

  function completeApply(input) {
    assertMetadataOnly(input, "migrationExecutionCompletion");
    assertBackground(input);
    const now = timestamp(input.completedAt || currentTime(), "completedAt");
    return repository.transaction((tx) => {
      const batch = tx.get(text(input.batchId, "batchId"));
      if (!batch) throw executionError("DATA_MIGRATION_EXECUTION_BATCH_UNKNOWN", "migration batch does not exist", 404);
      leaseMatches(batch, input, now);
      if (!batch.checkpoint || batch.checkpoint.sourceOutboxSequence !== batch.sourceRange.lastSequence
        || batch.checkpoint.appliedEventCount !== batch.sourceRange.eventCount) {
        throw executionError("DATA_MIGRATION_EXECUTION_CHECKPOINT_INCOMPLETE", "final checkpoint must cover the complete planned outbox range");
      }
      batch.state = STATES.AWAITING_RECONCILIATION;
      batch.leaseClaimDigest = "";
      batch.leaseOwnerDigest = "";
      batch.leaseExpiresAt = null;
      tx.save(batch);
      tx.appendEvent(eventProjection("apply-completed", batch, now, { checkpointId: batch.checkpoint.checkpointId, checkpointDigest: batch.checkpoint.checkpointDigest }));
      return safeBatch(batch);
    });
  }

  function reconcile(input) {
    assertMetadataOnly(input, "migrationExecutionReconciliation");
    assertBackground(input);
    const now = timestamp(input.completedAt || currentTime(), "completedAt");
    return repository.transaction((tx) => {
      const batch = tx.get(text(input.batchId, "batchId"));
      if (!batch) throw executionError("DATA_MIGRATION_EXECUTION_BATCH_UNKNOWN", "migration batch does not exist", 404);
      if (batch.state !== STATES.AWAITING_RECONCILIATION) throw executionError("DATA_MIGRATION_EXECUTION_RECONCILIATION_NOT_ALLOWED", "apply completion is required before reconciliation");
      const reconciliation = {
        evidenceRef: text(input.evidenceRef, "evidenceRef"),
        sourceCount: integer(input.sourceCount, "sourceCount"),
        targetCount: integer(input.targetCount, "targetCount"),
        mismatchCount: integer(input.mismatchCount, "mismatchCount"),
        duplicateCount: integer(input.duplicateCount, "duplicateCount"),
        sourceDigest: digest(input.sourceDigest, "sourceDigest"),
        targetDigest: digest(input.targetDigest, "targetDigest"),
        checkpointId: text(input.checkpointId, "checkpointId"),
        completedAt: now
      };
      if (reconciliation.sourceCount !== reconciliation.targetCount || reconciliation.mismatchCount !== 0
        || reconciliation.duplicateCount !== 0 || reconciliation.sourceDigest !== reconciliation.targetDigest
        || reconciliation.checkpointId !== batch.checkpoint.checkpointId) {
        throw executionError("DATA_MIGRATION_EXECUTION_RECONCILIATION_FAILED", "exact reconciliation and matching checkpoint are required");
      }
      reconciliation.reconciliationDigest = createTechnicalEvidenceFingerprint("data-migration-execution-reconciliation-v1", reconciliation);
      batch.state = STATES.RECONCILED;
      batch.reconciliation = reconciliation;
      tx.save(batch);
      tx.appendEvent(eventProjection("reconciled", batch, now, { checkpointId: reconciliation.checkpointId, reconciliationDigest: reconciliation.reconciliationDigest }));
      return safeBatch(batch);
    });
  }

  function qualifyLocalCandidate(input) {
    assertMetadataOnly(input, "migrationExecutionCandidate");
    assertBackground(input);
    const now = timestamp(input.qualifiedAt || currentTime(), "qualifiedAt");
    return repository.transaction((tx) => {
      const batch = tx.get(text(input.batchId, "batchId"));
      if (!batch) throw executionError("DATA_MIGRATION_EXECUTION_BATCH_UNKNOWN", "migration batch does not exist", 404);
      const controlRun = input.controlRun;
      if (batch.state !== STATES.RECONCILED || controlRun?.schemaVersion !== "data-migration-run-v1"
        || controlRun.state !== program.candidate.requiredControlState || controlRun.runId !== batch.runId
        || controlRun.waveId !== batch.waveId || controlRun.controls?.reconciliation?.outboxCheckpoint !== batch.checkpoint.checkpointId) {
        throw executionError("DATA_MIGRATION_EXECUTION_CANDIDATE_GATE_BLOCKED", "runtime reconciliation and the matching control-center local candidate are required");
      }
      batch.state = STATES.LOCAL_CANDIDATE;
      batch.controlEvidenceDigest = createTechnicalEvidenceFingerprint("data-migration-execution-control-binding-v1", {
        runId: controlRun.runId,
        waveId: controlRun.waveId,
        checkpointId: batch.checkpoint.checkpointId,
        reconciliationDigest: batch.reconciliation.reconciliationDigest,
        controlHistory: controlRun.history.map((item) => item.evidenceDigest)
      });
      tx.save(batch);
      tx.appendEvent(eventProjection("local-candidate-qualified", batch, now, { checkpointId: batch.checkpoint.checkpointId, controlEvidenceDigest: batch.controlEvidenceDigest }));
      return safeBatch(batch);
    });
  }

  function recoverExpiredLeases(input = {}) {
    assertMetadataOnly(input, "migrationExecutionRecovery");
    assertBackground(input);
    const now = timestamp(input.now || currentTime(), "now");
    return repository.transaction((tx) => {
      const recovered = [];
      for (const batch of tx.list()) {
        if (![STATES.LEASED, STATES.APPLYING].includes(batch.state) || Date.parse(batch.leaseExpiresAt) > Date.parse(now)) continue;
        batch.crashRecoveries += 1;
        batch.state = batch.crashRecoveries > program.lease.maximumCrashRecoveries ? STATES.RECOVERY_EXHAUSTED : STATES.PENDING;
        batch.leaseClaimDigest = "";
        batch.leaseOwnerDigest = "";
        batch.leaseExpiresAt = null;
        tx.save(batch);
        tx.appendEvent(eventProjection(batch.state === STATES.RECOVERY_EXHAUSTED ? "recovery-exhausted" : "lease-recovered", batch, now, {
          crashRecoveries: batch.crashRecoveries,
          checkpointId: batch.checkpoint?.checkpointId || "none"
        }));
        recovered.push(safeBatch(batch));
      }
      return Object.freeze({ recovered: recovered.length, batches: Object.freeze(recovered) });
    });
  }

  function operations() {
    const state = repository.exportRecoveryState();
    assertMetadataOnly(state, "migrationExecutionState");
    const batches = state.batches.map(safeBatch);
    const counts = Object.fromEntries(Object.values(STATES).map((status) => [status, batches.filter((item) => item.state === status).length]));
    return Object.freeze({
      schemaVersion: "data-migration-execution-operations-v1",
      generatedAt: currentTime(),
      ok: batches.every((item) => item.productionReady === false && item.requestPathWrite === false),
      summary: Object.freeze({ batches: batches.length, outboxEvents: state.outboxEvents.length, states: Object.freeze(counts) }),
      batches: Object.freeze(batches),
      sourceBoundary: program.sourceBoundary,
      requestPathDualWrite: false,
      productionReady: false,
      productionPrimary: false,
      activationAuthorized: false,
      payloadsExposed: false,
      credentialsExposed: false,
      boundary: "Only committed local outbox metadata may be applied by a leased background worker. Exact reconciliation can produce a local candidate but cannot authorize production."
    });
  }

  return Object.freeze({
    plan,
    claim,
    recordCheckpoint,
    completeApply,
    reconcile,
    qualifyLocalCandidate,
    recoverExpiredLeases,
    operations,
    exportRecoveryState: () => repository.exportRecoveryState()
  });
}

function assessMigrationExecutionState(state = {}, options = {}) {
  const program = options.program || executionProgram;
  validateMigrationExecutionProgram(program);
  assertMetadataOnly(state, "migrationExecutionState");
  const batches = Array.isArray(state.batches) ? state.batches : [];
  const outboxEvents = Array.isArray(state.outboxEvents) ? state.outboxEvents : [];
  const batchIds = new Set();
  const validBatches = batches.every((batch) => {
    const unique = !batchIds.has(batch.batchId);
    batchIds.add(batch.batchId);
    const planProjection = {
      batchId: batch.batchId,
      runId: batch.runId,
      waveId: batch.waveId,
      collections: batch.collections,
      sourceTransactionId: batch.sourceTransactionId,
      sourceVersion: batch.sourceVersion,
      manifestDigest: batch.manifestDigest,
      sourceRange: batch.sourceRange,
      plannedAt: batch.plannedAt
    };
    const planIntact = batch.planDigest === createTechnicalEvidenceFingerprint("data-migration-execution-plan-v1", planProjection);
    let checkpointIntact = !batch.checkpoint;
    if (batch.checkpoint) {
      const { checkpointDigest, ...checkpointProjection } = batch.checkpoint;
      checkpointIntact = checkpointDigest === createTechnicalEvidenceFingerprint("data-migration-execution-checkpoint-v1", checkpointProjection)
        && batch.checkpoint.sourceOutboxSequence >= batch.sourceRange.firstSequence
        && batch.checkpoint.sourceOutboxSequence <= batch.sourceRange.lastSequence
        && batch.checkpoint.appliedEventCount <= batch.sourceRange.eventCount;
    }
    const leaseActive = [STATES.LEASED, STATES.APPLYING].includes(batch.state);
    const leaseIntact = leaseActive
      ? SHA256.test(batch.leaseClaimDigest || "") && SHA256.test(batch.leaseOwnerDigest || "") && !Number.isNaN(Date.parse(batch.leaseExpiresAt))
      : !batch.leaseClaimDigest && !batch.leaseOwnerDigest && batch.leaseExpiresAt === null;
    const reconciliationRequired = [STATES.RECONCILED, STATES.LOCAL_CANDIDATE].includes(batch.state);
    const reconciliationIntact = !reconciliationRequired || (batch.reconciliation
      && batch.reconciliation.sourceCount === batch.reconciliation.targetCount
      && batch.reconciliation.mismatchCount === 0 && batch.reconciliation.duplicateCount === 0
      && batch.reconciliation.sourceDigest === batch.reconciliation.targetDigest
      && batch.reconciliation.checkpointId === batch.checkpoint?.checkpointId
      && SHA256.test(batch.reconciliation.reconciliationDigest || ""));
    const candidateIntact = batch.state !== STATES.LOCAL_CANDIDATE || SHA256.test(batch.controlEvidenceDigest || "");
    return unique && batch.schemaVersion === "data-migration-execution-batch-v1"
      && Object.values(STATES).includes(batch.state) && planIntact && checkpointIntact && leaseIntact
      && reconciliationIntact && candidateIntact
      && batch.requestPathWrite === false && batch.productionReady === false
      && batch.productionPrimary === false && batch.activationAuthorized === false
      && batch.payloadsExposed === false && batch.credentialsExposed === false
      && (!batch.leaseClaimDigest || SHA256.test(batch.leaseClaimDigest));
  });
  const validOutbox = outboxEvents.every((event, index) => {
    const { eventDigest, sequence, commitState, ...projection } = event;
    return event.schemaVersion === "data-migration-execution-outbox-event-v1"
      && commitState === "committed" && sequence === index + 1
      && eventDigest === createTechnicalEvidenceFingerprint("data-migration-execution-outbox-event-v1", projection)
      && event.payloadsExposed === false && event.credentialsExposed === false && event.productionReady === false;
  });
  const localCandidates = batches.filter((batch) => batch.state === STATES.LOCAL_CANDIDATE).length;
  const checks = Object.freeze([
    { id: "dataMigrationExecution:program", passed: true, detail: program.executionBoundary },
    { id: "dataMigrationExecution:noRequestDualWrite", passed: program.requestPathDualWrite === false, detail: program.sourceBoundary },
    { id: "dataMigrationExecution:recoveryState", passed: validBatches, detail: `${batches.length} metadata-only batches` },
    { id: "dataMigrationExecution:transactionalOutbox", passed: validOutbox, detail: `${outboxEvents.length} committed metadata events` },
    { id: "dataMigrationExecution:productionFailClosed", passed: program.productionActivationAuthorized === false && batches.every((batch) => batch.productionReady === false && batch.productionPrimary === false && batch.activationAuthorized === false), detail: "repository evidence cannot activate production" }
  ]);
  return Object.freeze({
    schemaVersion: "data-migration-execution-readiness-v1",
    generatedAt: options.now || new Date().toISOString(),
    ok: checks.every((check) => check.passed),
    controlPlaneReady: checks.every((check) => check.passed),
    localGateReady: checks.every((check) => check.passed) && batches.length > 0 && localCandidates === batches.length,
    productionReady: false,
    productionPrimary: false,
    activationAuthorized: false,
    summary: Object.freeze({ batches: batches.length, outboxEvents: outboxEvents.length, localCandidates }),
    checks,
    boundary: "This assessment validates recoverable metadata only and never supplies production authorization."
  });
}

module.exports = {
  STATES,
  assessMigrationExecutionState,
  createMemoryMigrationExecutionRepository,
  createMigrationExecutionRuntime,
  safeBatch,
  validateMigrationExecutionProgram
};
