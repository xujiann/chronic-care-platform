"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const inventory = require("../config/worker-observability-contract.json");
const {
  CONTRACT_VERSION,
  attachWorkerObservability,
  projectWorkerObservability,
  validateInventory,
  validateWorkerObservability
} = require("../src/platform/operations/worker-observability-contract");
const {
  deployedWorkerEntrypoints,
  inspectWorkerObservabilityGovernance
} = require("../scripts/worker-observability-governance");
const { runWorkerOnce: runCareWorkerOnce } = require("../scripts/care-service-outbox-worker");
const {
  runPilotCutoverAlertDeliveryCycle
} = require("../src/platform/cutover/pilot-cutover-alert-runtime");

const NOW = "2026-08-23T08:00:00.000Z";

const REPORTS = Object.freeze({
  "postgres-shadow-sync": { ok: true, processed: 3, delivered: 3, failed: 0 },
  "domain-shadow-relay": { ok: true, relayId: "referral-shadow", relayed: 2, outcomes: [] },
  "postgres-shadow-reconciliation": { ok: true, status: "matched", runId: "reconcile-1", checkedAt: NOW, summary: { localCollections: 4, matched: 4, mismatched: 0 } },
  "cutover-alert-delivery": { status: "completed", evaluatedAt: NOW, candidates: 2, delivered: 2, failed: 0, results: [] },
  "care-service-outbox": { ok: true, runId: "care-run", workerId: "care-worker", claimed: 2, delivered: 1, retried: 1, deadLetters: 0, resultCodes: [{ errorCode: "CARE_DELIVERY_TIMEOUT" }] },
  "continuous-audit-delivery": { ok: true, pendingBefore: 2, delivered: 2, pendingAfter: 0, errorCode: "" },
  "chronic-followup-dispatch": { workerIdDigest: "a".repeat(64), claimed: 2, delivered: 1, retryScheduled: 1, deadLettered: 0, persistenceRejected: 0 },
  "object-storage-command-v2": { workerIdDigest: "b".repeat(64), claimed: 2, delivered: 1, retryScheduled: 1, deadLettered: 0, persistenceRejected: 0 },
  "public-health-direct-report": { ok: true, workerId: "public-health-worker", processed: 2, awaitingCallback: 1, retryScheduled: 1, deadLetters: 0, deliveries: [] },
  "referral-delivery": { runId: "referral-run", workerId: "referral-worker", claimed: 1, counts: { delivered: 1 }, outcomes: [] },
  "emergency-signal-delivery": { ok: true, runId: "emergency-run", workerId: "emergency-worker", summary: { claimed: 1, published: 1, retrying: 0, deadLettered: 0 }, results: [] },
  "insurance-payment-outbox": { workerId: "insurance-worker", startedAt: NOW, finishedAt: NOW, claimed: 1, published: 0, failed: 1, acknowledgementPending: 0, outcomes: [{ errorCode: "OUTBOX_PUBLISH_TIMEOUT" }], health: { status: "warning", counts: { "dead-letter": 0 } } },
  "public-health-external-dispatch": { generatedAt: NOW, due: 1, processed: 1, results: [] }
});

test("worker semantics inventory is closed, versioned, and never authorizes production", () => {
  const report = validateInventory();
  assert.equal(report.ok, true);
  assert.equal(report.contractVersion, CONTRACT_VERSION);
  assert.equal(report.profileCount, inventory.profiles.length);
  assert.equal(inventory.productionAuthorization, "never");
  assert.equal(inventory.profiles.filter((item) => item.id === "object-storage-command-v2").length, 1);
});

test("every inventoried worker report projects the same bounded metadata-only shape", () => {
  for (const profile of inventory.profiles) {
    const projection = projectWorkerObservability(profile.id, REPORTS[profile.id], { observedAt: NOW });
    assert.equal(validateWorkerObservability(projection), true, profile.id);
    assert.deepEqual(Object.keys(projection.work), [
      "claimed", "succeeded", "retryScheduled", "deadLettered", "persistenceRejected", "failed"
    ]);
    assert.equal(projection.productionAuthorization.inferred, false);
    assert.equal(projection.productionAuthorization.productionReady, false);
    assert.equal(projection.security.metadataOnly, true);
    assert.equal(projection.security.projectionBusinessDataExposed, false);
    assert.match(projection.sourceReportDigest, /^sha256:[a-f0-9]{64}$/);
  }
});

test("projection exposes only digests and stable codes when source report contains secrets and provider text", () => {
  const source = {
    ok: false,
    runId: "run-with-secret",
    workerId: "worker-with-secret",
    claimed: 1,
    delivered: 0,
    retried: 1,
    deadLetters: 0,
    resultCodes: [{
      errorCode: "CARE_DELIVERY_TIMEOUT",
      message: "provider token=super-secret",
      leaseToken: "lease-secret",
      patientName: "sensitive-name"
    }]
  };
  const projection = projectWorkerObservability("care-service-outbox", source, { observedAt: NOW });
  const body = JSON.stringify(projection);
  assert.deepEqual(projection.errorCodes, ["CARE_DELIVERY_TIMEOUT"]);
  assert.doesNotMatch(body, /super-secret|lease-secret|sensitive-name|worker-with-secret|run-with-secret/);
  assert.match(projection.workerIdDigest, /^sha256:/);
  assert.match(projection.runIdDigest, /^sha256:/);
  const differentSecret = projectWorkerObservability("care-service-outbox", {
    ...source,
    resultCodes: [{ ...source.resultCodes[0], message: "different-secret", patientName: "different-name" }]
  }, { observedAt: NOW });
  assert.equal(projection.sourceReportDigest, differentSecret.sourceReportDigest);
});

test("projection is deterministic apart from the caller-controlled observation time", () => {
  const left = projectWorkerObservability("postgres-shadow-sync", { delivered: 2, ok: true, failed: 0, processed: 2 }, { observedAt: NOW });
  const right = projectWorkerObservability("postgres-shadow-sync", { processed: 2, failed: 0, ok: true, delivered: 2 }, { observedAt: NOW });
  assert.equal(left.sourceReportDigest, right.sourceReportDigest);
  assert.deepEqual(left, right);
});

test("outcome distinguishes execution failure from pre-execution blocking", () => {
  const blocked = projectWorkerObservability("cutover-alert-delivery", {
    status: "blocked",
    evaluatedAt: NOW,
    candidates: 0,
    delivered: 0,
    failed: 0
  }, { observedAt: NOW });
  assert.equal(blocked.outcome, "blocked");

  const failed = projectWorkerObservability("postgres-shadow-reconciliation", {
    ok: false,
    status: "error",
    checkedAt: NOW,
    summary: { localCollections: 1, matched: 0, mismatched: 0 }
  }, { observedAt: NOW });
  assert.equal(failed.outcome, "failed");

  const mismatch = projectWorkerObservability("postgres-shadow-reconciliation", {
    ok: false,
    status: "mismatched",
    checkedAt: NOW,
    summary: { localCollections: 2, matched: 1, mismatched: 1 }
  }, { observedAt: NOW });
  assert.equal(mismatch.outcome, "partial");
});

test("adapter is additive and idempotent but rejects profile replacement", () => {
  const report = { ok: true, processed: 0, delivered: 0, failed: 0 };
  const attached = attachWorkerObservability("postgres-shadow-sync", report, { observedAt: NOW });
  assert.deepEqual({ ok: attached.ok, processed: attached.processed }, { ok: true, processed: 0 });
  assert.equal(attachWorkerObservability("postgres-shadow-sync", attached), attached);
  assert.throws(
    () => attachWorkerObservability("care-service-outbox", attached),
    /profile cannot be replaced/
  );
});

test("unknown profiles, invalid timestamps, and widened projections fail closed", () => {
  assert.throws(() => projectWorkerObservability("unknown-worker", {}, { observedAt: NOW }), /unknown worker/);
  assert.throws(() => projectWorkerObservability("postgres-shadow-sync", {}, { observedAt: "not-a-date" }), /valid observedAt/);
  const projection = projectWorkerObservability("postgres-shadow-sync", {}, { observedAt: NOW });
  assert.throws(() => validateWorkerObservability({ ...projection, providerMessage: "leak" }), /unexpected fields/);
  assert.throws(() => validateWorkerObservability({
    ...projection,
    security: { ...projection.security, projectionBusinessDataExposed: true }
  }), /safety boundary/);
  assert.throws(() => validateWorkerObservability({
    ...projection,
    productionAuthorization: { ...projection.productionAuthorization, externalEvidenceRequired: false }
  }), /safety boundary/);
});

test("inventory drift and production-authority drift fail closed", () => {
  assert.throws(() => validateInventory({ ...inventory, productionAuthorization: "repository-can-authorize" }), /inventory is invalid/);
  assert.throws(() => validateInventory({
    ...inventory,
    profiles: [...inventory.profiles, inventory.profiles[0]]
  }), /identity is invalid/);
});

test("all deployed server-side worker entrypoints are inventoried and integrated", () => {
  assert.deepEqual(deployedWorkerEntrypoints(), [
    "scripts/audit-delivery-worker.js",
    "scripts/care-service-outbox-worker.js",
    "scripts/chronic-followup-dispatch-worker.js",
    "scripts/object-storage-command-worker.js",
    "scripts/platform-cutover-alert-worker.js",
    "scripts/platform-shadow-relay.js",
    "scripts/postgres-shadow-reconcile.js",
    "scripts/postgres-sync-worker.js",
    "scripts/production-adapter-runtime.js",
    "scripts/public-health-direct-report-worker.js"
  ]);
  const report = inspectWorkerObservabilityGovernance();
  assert.equal(report.ok, true);
  assert.equal(report.profileCount, inventory.profiles.length);
  assert.equal(report.productionReady, false);
});

test("governance rejects an unregistered deployable worker and missing adapter", () => {
  const undeclared = inspectWorkerObservabilityGovernance({
    deployedEntrypoints: [...deployedWorkerEntrypoints(), "scripts/unknown-worker.js"]
  });
  assert.equal(undeclared.ok, false);
  assert.equal(undeclared.checks.find((item) => item.id === "worker-observability:deployed-entrypoints").passed, false);

  const drifted = structuredClone(inventory);
  drifted.profiles.find((item) => item.id === "care-service-outbox").entrypoints = ["scripts/postgres-sync-worker.js"];
  drifted.profiles.find((item) => item.id === "care-service-outbox").implementationSources = ["postgres-runtime-sync.js"];
  const missingAdapter = inspectWorkerObservabilityGovernance({ inventory: drifted });
  assert.equal(missingAdapter.ok, false);
  assert.equal(missingAdapter.checks.find((item) => item.id === "worker-observability:adapter-integration").passed, false);
});

test("real compatibility boundaries expose the v1 projection without enabling work", async () => {
  const care = await runCareWorkerOnce({ env: {}, at: NOW });
  assert.equal(care.skipped, true);
  assert.equal(care.workerObservability.outcome, "skipped");

  const alerts = await runPilotCutoverAlertDeliveryCycle({
    env: {},
    now: NOW,
    routes: []
  });
  assert.equal(alerts.status, "blocked");
  assert.equal(alerts.workerObservability.outcome, "blocked");
  assert.equal(alerts.workerObservability.productionAuthorization.productionReady, false);
});
