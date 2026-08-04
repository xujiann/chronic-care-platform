"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");

const { sha256 } = require("../src/platform/operations/shadow-outbox-relay");
const {
  openSqliteShadowRelayOperations
} = require("../src/platform/operations/sqlite-shadow-relay-operations");

const NOW = "2026-08-04T08:00:00.000Z";

test("operations ledger requires an explicit absolute file path", () => {
  assert.throws(
    () => openSqliteShadowRelayOperations({ file: "relative-operations.sqlite" }),
    (error) => error.code === "SHADOW_RELAY_OPERATIONS_FILE_NOT_ABSOLUTE"
  );
});

function receipt(domain, input = {}) {
  return {
    operationId: `${domain}-${input.operation || "relay"}-${input.outcome || "success"}`,
    relayId: `${domain}-postgres-shadow-v1`,
    domain,
    operation: "relay",
    outcome: "success",
    startedAt: "2026-08-04T07:55:00.000Z",
    completedAt: "2026-08-04T07:56:00.000Z",
    fromSequence: 0,
    toSequence: 2,
    checkpointSequence: 2,
    relayed: 2,
    idempotentReplays: 1,
    ...input
  };
}

async function appendVerifiedDomain(store, domain) {
  await store.append(receipt(domain, {
    operationId: `${domain}-fault`,
    outcome: "fault-injected",
    completedAt: "2026-08-04T07:51:00.000Z",
    startedAt: "2026-08-04T07:50:00.000Z",
    fromSequence: 0,
    toSequence: 0,
    checkpointSequence: 0,
    relayed: 0,
    idempotentReplays: 0,
    faultPhase: "after-enqueue",
    faultSequence: 1,
    errorCode: "PLATFORM_SHADOW_RELAY_FAULT_INJECTED"
  }));
  await store.append(receipt(domain, {
    operationId: `${domain}-recovery`,
    completedAt: "2026-08-04T07:53:00.000Z",
    startedAt: "2026-08-04T07:52:00.000Z"
  }));
  const digest = sha256([{ id: `${domain}-1` }, { id: `${domain}-2` }]);
  await store.append(receipt(domain, {
    operationId: `${domain}-reconcile`,
    operation: "reconcile",
    completedAt: "2026-08-04T07:55:00.000Z",
    startedAt: "2026-08-04T07:54:00.000Z",
    relayed: 0,
    idempotentReplays: 0,
    source: { count: 2, highWatermark: 2, digest },
    target: { count: 2, highWatermark: 2, digest }
  }));
}

test("operations ledger produces payload-free dual-domain technical evidence", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "shadow-relay-operations-"));
  const file = path.join(directory, "operations.sqlite");
  const store = openSqliteShadowRelayOperations({
    file,
    now: () => NOW
  });
  t.after(async () => {
    await store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  await appendVerifiedDomain(store, "referral");
  await appendVerifiedDomain(store, "emergency");
  const report = await store.report({ maximumAgeMinutes: 60 });
  const rows = await store.list({ limit: 100 });

  assert.equal(report.schema, "shadow-relay-control-plane-v1");
  assert.equal(report.ok, true);
  assert.equal(report.chainValid, true);
  assert.equal(report.durableCheckpointVerified, true);
  assert.equal(report.faultRecoveryVerified, true);
  assert.match(report.technicalEvidenceFingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.equal(report.externalEvidenceVerified, false);
  assert.equal(report.productionReady, false);
  assert.equal(report.domains.referral.checks.faultRecoveryVerified, true);
  assert.equal(report.domains.emergency.checks.reconciliationFresh, true);
  assert.equal(rows.length, 6);
  assert.equal(JSON.stringify({ report, rows }).includes("payload"), true);
  assert.equal(JSON.stringify({ report, rows }).includes("patient"), false);
  assert.equal(JSON.stringify({ report, rows }).includes("resident"), false);
  assert.equal(JSON.stringify({ report, rows }).includes("eventId"), false);
});

test("operation ids are idempotent and reject semantic drift", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "shadow-relay-operation-id-"));
  const store = openSqliteShadowRelayOperations({
    file: path.join(directory, "operations.sqlite"),
    now: () => NOW
  });
  t.after(async () => {
    await store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const input = receipt("referral");
  const first = await store.append(input);
  const replay = await store.append(input);
  assert.equal(replay.sequence, first.sequence);
  assert.equal(replay.receiptDigest, first.receiptDigest);
  await assert.rejects(
    () => store.append({ ...input, relayed: 1, idempotentReplays: 0 }),
    (error) => error.code === "SHADOW_RELAY_OPERATION_ID_CONFLICT"
  );
});

test("read-only reports detect tampering and reject appends", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "shadow-relay-tamper-"));
  const file = path.join(directory, "operations.sqlite");
  const writer = openSqliteShadowRelayOperations({ file, now: () => NOW });
  await appendVerifiedDomain(writer, "referral");
  await appendVerifiedDomain(writer, "emergency");
  await writer.close();

  const database = new DatabaseSync(file);
  database.prepare(`
    UPDATE shadow_relay_operation_receipts
    SET error_code = ?
    WHERE operation_id = ?
  `).run("PLATFORM_SHADOW_RELAY_DIFFERENT_FAULT", "referral-fault");
  database.close();

  const reader = openSqliteShadowRelayOperations({
    file,
    readOnly: true,
    now: () => NOW
  });
  t.after(async () => {
    await reader.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const report = await reader.report();
  assert.equal(report.ok, false);
  assert.equal(report.chainValid, false);
  assert.equal(report.domains.referral.checks.chainValid, false);
  await assert.rejects(
    () => reader.append(receipt("referral", { operationId: "read-only" })),
    (error) => error.code === "SHADOW_RELAY_OPERATIONS_READ_ONLY"
  );
});

test("stale reconciliation keeps the control plane closed", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "shadow-relay-stale-"));
  const store = openSqliteShadowRelayOperations({
    file: path.join(directory, "operations.sqlite"),
    now: () => "2026-08-05T08:00:00.000Z"
  });
  t.after(async () => {
    await store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  await appendVerifiedDomain(store, "referral");
  await appendVerifiedDomain(store, "emergency");

  const report = await store.report({ maximumAgeMinutes: 60 });
  assert.equal(report.ok, false);
  assert.equal(report.domains.referral.checks.reconciliationFresh, false);
  assert.equal(report.domains.emergency.checks.reconciliationFresh, false);
});

test("a later relay failure invalidates older successful evidence", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "shadow-relay-later-failure-"));
  const store = openSqliteShadowRelayOperations({
    file: path.join(directory, "operations.sqlite"),
    now: () => NOW
  });
  t.after(async () => {
    await store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  await appendVerifiedDomain(store, "referral");
  await appendVerifiedDomain(store, "emergency");
  assert.equal((await store.report()).ok, true);

  await store.append(receipt("referral", {
    operationId: "referral-later-failure",
    outcome: "failed",
    startedAt: "2026-08-04T07:57:00.000Z",
    completedAt: "2026-08-04T07:58:00.000Z",
    fromSequence: 2,
    toSequence: 2,
    checkpointSequence: 2,
    relayed: 0,
    idempotentReplays: 0,
    errorCode: "DOMAIN_SHADOW_RUNTIME_UNAVAILABLE"
  }));
  const report = await store.report();
  assert.equal(report.ok, false);
  assert.equal(report.domains.referral.checks.relaySucceeded, false);
  assert.equal(report.domains.referral.checks.reconciliationCoversRelay, false);
});
