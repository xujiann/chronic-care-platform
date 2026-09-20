"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { buildPostgresSyncBatch } = require("../postgres-runtime-sync");
const { assessDataQualityMigrationSample } = require("../src/platform/data/data-quality-migration-sample");

function sample(records = [{ id: "synthetic-issue-1", status: "in_progress" }]) {
  const sourceRow = { key: "dataQualityIssues", payload: JSON.stringify(records), version: 2 };
  const outboxBatch = buildPostgresSyncBatch([
    { collection: "dataQualityIssues", operation: "upsert", sourceVersion: 2, payload: records }
  ], { createdAt: "2026-09-20T00:00:00.000Z" });
  const change = outboxBatch.changes[0];
  return {
    sourceRow,
    outboxBatch,
    commitment: {
      state: "committed",
      source: "sqlite-transactional-outbox",
      sourceTransactionId: "synthetic-sqlite-tx-1",
      outboxSequence: 1,
      committedAt: "2026-09-20T00:00:01.000Z",
      payloadSha256: outboxBatch.payloadSha256
    },
    targetRow: {
      collection: "dataQualityIssues",
      sourceVersion: 2,
      payloadSha256: change.payloadSha256,
      deleted: false
    }
  };
}

test("synthetic source, committed outbox and target match without exposing records", () => {
  const result = assessDataQualityMigrationSample(sample());
  assert.equal(result.ok, true);
  assert.equal(result.recordCount, 1);
  assert.equal(result.localExecutionAuthorized, false);
  assert.equal(result.productionReady, false);
  assert.equal(JSON.stringify(result).includes("synthetic-issue-1"), false);
});

test("the current outbox reader's missing transaction and sequence proof blocks the sample", () => {
  const input = sample();
  delete input.commitment.sourceTransactionId;
  delete input.commitment.outboxSequence;
  assert.deepEqual(assessDataQualityMigrationSample(input).blockers, ["COMMITTED_OUTBOX_PROOF_MISSING"]);
});

test("derived issues cannot replace persisted overrides and duplicate IDs fail closed", () => {
  const derived = sample();
  derived.sourceRow = { ...derived.sourceRow, key: "buildDataQualityIssues" };
  assert.ok(assessDataQualityMigrationSample(derived).blockers.includes("SOURCE_COLLECTION_INVALID"));

  const duplicate = sample([{ id: "a" }, { id: "a" }]);
  assert.ok(assessDataQualityMigrationSample(duplicate).blockers.includes("SOURCE_OVERRIDE_SET_INVALID"));
});

test("changed versions, payload digests and target state are rejected", () => {
  const changed = sample();
  changed.sourceRow.version = 3;
  assert.ok(assessDataQualityMigrationSample(changed).blockers.includes("OUTBOX_SOURCE_MISMATCH"));

  const missingTarget = sample();
  missingTarget.targetRow = null;
  assert.ok(assessDataQualityMigrationSample(missingTarget).blockers.includes("TARGET_RECONCILIATION_MISMATCH"));

  const alteredTarget = sample();
  alteredTarget.targetRow.payloadSha256 = "0".repeat(64);
  assert.ok(assessDataQualityMigrationSample(alteredTarget).blockers.includes("TARGET_RECONCILIATION_MISMATCH"));

  const alteredDecodedBatch = sample();
  alteredDecodedBatch.outboxBatch.changes[0].sourceVersion = 3;
  assert.ok(assessDataQualityMigrationSample(alteredDecodedBatch).blockers.includes("OUTBOX_SOURCE_MISMATCH"));
});

test("malformed and oversized source rows do not leak records", () => {
  const malformed = sample();
  malformed.sourceRow.payload = "{not-json";
  assert.ok(assessDataQualityMigrationSample(malformed).blockers.includes("SOURCE_PAYLOAD_INVALID"));

  const oversized = sample(Array.from({ length: 301 }, (_, index) => ({ id: `synthetic-${index}` })));
  const result = assessDataQualityMigrationSample(oversized);
  assert.ok(result.blockers.includes("SOURCE_OVERRIDE_SET_INVALID"));
  assert.equal(JSON.stringify(result).includes("synthetic-300"), false);
});
