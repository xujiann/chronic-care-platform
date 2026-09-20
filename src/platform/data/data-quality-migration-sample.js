"use strict";

const { createHash } = require("node:crypto");
const { canonicalStringify } = require("../../../scripts/postgres-migration-package");
const { validatePostgresSyncBatch } = require("../../../postgres-runtime-sync");

const COLLECTION = "dataQualityIssues";
const MAX_OVERRIDES = 300;
const SHA256 = /^[a-f0-9]{64}$/;

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

// T02-owned, read-only admission check. Inputs must come from independently
// verified source/outbox/target readers; this function cannot attest provenance.
function assessDataQualityMigrationSample(input = {}) {
  const blockers = [];
  const source = input.sourceRow;
  let sourceVersion = null;
  let sourceDigest = null;
  let recordCount = null;

  if (source?.key !== COLLECTION || !Number.isSafeInteger(source.version) || source.version < 1
    || typeof source.payload !== "string") {
    blockers.push("SOURCE_COLLECTION_INVALID");
  } else {
    sourceVersion = source.version;
    try {
      const records = JSON.parse(source.payload);
      if (!Array.isArray(records) || records.length > MAX_OVERRIDES
        || records.some((item) => !item || typeof item !== "object" || Array.isArray(item)
          || typeof item.id !== "string" || !item.id.trim())
        || new Set(records.map((item) => item.id)).size !== records.length) {
        blockers.push("SOURCE_OVERRIDE_SET_INVALID");
      } else {
        recordCount = records.length;
        sourceDigest = digest(canonicalStringify(records));
      }
    } catch {
      blockers.push("SOURCE_PAYLOAD_INVALID");
    }
  }

  const batch = input.outboxBatch;
  let change = null;
  if (!batch || !validatePostgresSyncBatch(batch).ok) {
    blockers.push("OUTBOX_BATCH_INVALID");
  } else {
    const envelope = JSON.parse(batch.payload);
    const matches = envelope.changes.filter((item) => item.collection === COLLECTION);
    if (matches.length !== 1) {
      blockers.push("OUTBOX_COLLECTION_CHANGE_INVALID");
    } else {
      change = matches[0];
      if (canonicalStringify(batch.changes) !== canonicalStringify(envelope.changes)
        || change.operation !== "upsert" || change.sourceVersion !== sourceVersion
        || !sourceDigest || change.payloadSha256 !== sourceDigest
        || typeof change.payload !== "string" || digest(change.payload) !== sourceDigest) {
        blockers.push("OUTBOX_SOURCE_MISMATCH");
      }
    }
  }

  const receipt = input.commitment;
  if (receipt?.state !== "committed" || receipt.source !== "sqlite-transactional-outbox"
    || typeof receipt.sourceTransactionId !== "string" || !receipt.sourceTransactionId.trim()
    || !Number.isSafeInteger(receipt.outboxSequence) || receipt.outboxSequence < 1
    || typeof receipt.committedAt !== "string"
    || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(receipt.committedAt)
    || !Number.isFinite(Date.parse(receipt.committedAt))
    || receipt.payloadSha256 !== batch?.payloadSha256) {
    blockers.push("COMMITTED_OUTBOX_PROOF_MISSING");
  }

  const target = input.targetRow;
  if (target?.collection !== COLLECTION || target.deleted === true
    || !Number.isSafeInteger(target.sourceVersion) || target.sourceVersion !== sourceVersion
    || !SHA256.test(target.payloadSha256 || "") || target.payloadSha256 !== sourceDigest) {
    blockers.push("TARGET_RECONCILIATION_MISMATCH");
  }

  return Object.freeze({
    ok: blockers.length === 0,
    collection: COLLECTION,
    blockers: Object.freeze(blockers),
    sourceVersion,
    sourceDigest,
    recordCount,
    targetVersion: Number.isSafeInteger(target?.sourceVersion) ? target.sourceVersion : null,
    targetDigest: SHA256.test(target?.payloadSha256 || "") ? target.payloadSha256 : null,
    localExecutionAuthorized: false,
    productionReady: false,
    productionPrimary: false,
    externalEvidenceVerified: false
  });
}

module.exports = { assessDataQualityMigrationSample };
