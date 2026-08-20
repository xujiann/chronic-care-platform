#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const {
  auditWriteFailureSignal,
  createPilotCutoverAuditLifecycleBridge,
  createSiemAuditAdapter,
  createWormAuditAdapter,
  runAuditDeliveryCycle,
  stableStringify
} = require("../src/platform/operations/audit-delivery");
const { verifyAuditTrail } = require("../src/identity-security/audit-chain");

const ROOT = path.resolve(__dirname, "..");
const TRAILS = Object.freeze(["securityEvents", "dataAccessLogs"]);
const CHECKPOINT_SCHEMA = "audit-delivery-checkpoint-v2";
const HEAD_SCHEMA = "audit-delivery-checkpoint-head-v1";
const HEX = /^[a-f0-9]{64}$/;

function sha256(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function checkpointError(code, message) {
  return Object.assign(new Error(message), { code });
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function checkpointProjection(value) {
  return { schemaVersion: value.schemaVersion, sequence: value.sequence, previousCheckpointDigest: value.previousCheckpointDigest, deliveredDigests: value.deliveredDigests, incidentOpen: value.incidentOpen, receipts: value.receipts, updatedAt: value.updatedAt };
}

function headProjection(value) {
  return { schemaVersion: value.schemaVersion, sequence: value.sequence, checkpointDigest: value.checkpointDigest };
}

function emptyCheckpoint() {
  return { schemaVersion: CHECKPOINT_SCHEMA, sequence: 0, previousCheckpointDigest: "", checkpointDigest: "", deliveredDigests: [], incidentOpen: false, receipts: [], updatedAt: "" };
}

function validateCheckpoint(value) {
  if (!value || value.schemaVersion !== CHECKPOINT_SCHEMA || !Number.isInteger(value.sequence) || value.sequence < 1
    || (value.sequence > 1 && !HEX.test(String(value.previousCheckpointDigest || "")))
    || !Array.isArray(value.deliveredDigests) || value.deliveredDigests.some((item) => !HEX.test(String(item)))
    || !Array.isArray(value.receipts) || !Number.isFinite(Date.parse(value.updatedAt || ""))
    || !HEX.test(String(value.checkpointDigest || "")) || typeof value.incidentOpen !== "boolean") {
    throw checkpointError("AUDIT_CHECKPOINT_CORRUPT", "audit delivery checkpoint is malformed");
  }
  if (value.checkpointDigest !== sha256(stableStringify(checkpointProjection(value)))) throw checkpointError("AUDIT_CHECKPOINT_CORRUPT", "audit delivery checkpoint digest is invalid");
  for (const receipt of value.receipts) {
    if (!String(receipt?.receiptId || "").trim() || !String(receipt?.batchId || "").trim() || !HEX.test(String(receipt?.digest || "")) || !Number.isInteger(receipt?.recordCount) || !Number.isFinite(Date.parse(receipt?.acknowledgedAt || ""))) {
      throw checkpointError("AUDIT_CHECKPOINT_CORRUPT", "audit delivery checkpoint receipt is malformed");
    }
  }
  return value;
}

function readJson(file, label) {
  let stat;
  try { stat = fs.lstatSync(file); } catch { throw checkpointError("AUDIT_CHECKPOINT_UNAVAILABLE", `${label} is unavailable`); }
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size < 2 || stat.size > 4 * 1024 * 1024) throw checkpointError("AUDIT_CHECKPOINT_BOUNDARY_INVALID", `${label} must be a bounded regular file`);
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { throw checkpointError("AUDIT_CHECKPOINT_CORRUPT", `${label} is not valid JSON`); }
}

function readCheckpoint(file) {
  const headFile = `${file}.head`;
  const exists = fs.existsSync(file);
  const headExists = fs.existsSync(headFile);
  if (!exists && !headExists) return emptyCheckpoint();
  if (!exists || !headExists) throw checkpointError("AUDIT_CHECKPOINT_ROLLBACK_DETECTED", "checkpoint and durable head must exist together");
  const value = validateCheckpoint(readJson(file, "audit delivery checkpoint"));
  const head = readJson(headFile, "audit delivery checkpoint head");
  if (head?.schemaVersion !== HEAD_SCHEMA || !Number.isInteger(head.sequence) || !HEX.test(String(head.checkpointDigest || "")) || !HEX.test(String(head.headDigest || "")) || head.headDigest !== sha256(stableStringify(headProjection(head)))) {
    throw checkpointError("AUDIT_CHECKPOINT_CORRUPT", "audit delivery checkpoint head is invalid");
  }
  if (value.sequence < head.sequence || value.sequence > head.sequence + 1) throw checkpointError("AUDIT_CHECKPOINT_ROLLBACK_DETECTED", "audit delivery checkpoint sequence is not monotonic");
  if (value.sequence === head.sequence && value.checkpointDigest !== head.checkpointDigest) throw checkpointError("AUDIT_CHECKPOINT_CORRUPT", "checkpoint does not match durable head");
  if (value.sequence === head.sequence + 1 && value.previousCheckpointDigest !== head.checkpointDigest) throw checkpointError("AUDIT_CHECKPOINT_ROLLBACK_DETECTED", "checkpoint does not extend durable head");
  return value;
}

function fsyncDirectory(directory) {
  if (process.platform === "win32") return;
  const descriptor = fs.openSync(directory, "r");
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}

function atomicWrite(file, body) {
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  const descriptor = fs.openSync(temporary, "wx", 0o600);
  try { fs.writeFileSync(descriptor, body, "utf8"); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  fs.renameSync(temporary, file);
  fsyncDirectory(path.dirname(file));
}

function writeCheckpoint(file, checkpoint) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const next = {
    schemaVersion: CHECKPOINT_SCHEMA,
    sequence: Number(checkpoint.sequence || 0) + 1,
    previousCheckpointDigest: checkpoint.previousCheckpointDigest || "",
    deliveredDigests: (checkpoint.deliveredDigests || []).slice(-10000),
    incidentOpen: checkpoint.incidentOpen === true,
    receipts: (checkpoint.receipts || []).slice(-1000),
    updatedAt: checkpoint.updatedAt || new Date().toISOString()
  };
  next.checkpointDigest = sha256(stableStringify(checkpointProjection(next)));
  validateCheckpoint(next);
  atomicWrite(file, `${JSON.stringify(next)}\n`);
  const head = { schemaVersion: HEAD_SCHEMA, sequence: next.sequence, checkpointDigest: next.checkpointDigest };
  head.headDigest = sha256(stableStringify(headProjection(head)));
  atomicWrite(`${file}.head`, `${JSON.stringify(head)}\n`);
  return next;
}

function acquireWorkerLock(checkpointFile) {
  fs.mkdirSync(path.dirname(checkpointFile), { recursive: true, mode: 0o700 });
  const lockFile = `${checkpointFile}.lock`;
  let descriptor;
  try { descriptor = fs.openSync(lockFile, "wx", 0o600); } catch (error) {
    if (error.code === "EEXIST") throw checkpointError("AUDIT_DELIVERY_WORKER_LOCKED", "another audit delivery worker owns the checkpoint");
    throw error;
  }
  fs.writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })}\n`);
  fs.fsyncSync(descriptor);
  return () => { fs.closeSync(descriptor); try { fs.rmSync(lockFile, { force: true }); } catch {} };
}

function loadAuditRecords(sqliteFile, deliveredDigests = []) {
  const delivered = new Set(deliveredDigests);
  const db = new DatabaseSync(sqliteFile, { readOnly: true });
  try {
    const records = [];
    for (const trail of TRAILS) {
      const row = db.prepare("SELECT payload FROM state_collections WHERE key = ?").get(trail);
      let items;
      try { items = JSON.parse(row?.payload || "null"); } catch { items = null; }
      const verification = verifyAuditTrail(items);
      if (!verification.passed) { const error = checkpointError("AUDIT_TRAIL_INTEGRITY_FAILED", `audit trail ${trail} failed integrity verification`); error.trail = trail; throw error; }
      for (const record of items) {
        const recordDigest = sha256(`${trail}:${stableStringify(record)}`);
        if (!delivered.has(recordDigest)) records.push({ trail, record, recordDigest });
      }
    }
    return records.sort((left, right) => String(left.record?.at || left.record?.createdAt || "").localeCompare(String(right.record?.at || right.record?.createdAt || "")));
  } finally { db.close(); }
}

function createConfiguredAdapter(env = process.env) {
  const siem = String(env.SIEM_AUDIT_ENDPOINT || "").trim();
  const worm = String(env.AUDIT_WORM_DIRECTORY || "").trim();
  if (Boolean(siem) === Boolean(worm)) throw checkpointError("AUDIT_DELIVERY_TARGET_INVALID", "exactly one SIEM or WORM audit target is required");
  return siem ? createSiemAuditAdapter({ env }) : createWormAuditAdapter({ directory: worm });
}

async function runWorker(options = {}) {
  const env = options.env || process.env;
  const production = String(env.NODE_ENV || "").toLowerCase() === "production";
  const sqliteInput = options.sqliteFile || path.join(env.DATA_DIR || path.join(ROOT, "data"), "health-city.sqlite");
  const checkpointInput = options.checkpointFile || env.AUDIT_DELIVERY_CHECKPOINT_PATH || path.join(ROOT, "tmp", "audit-delivery-checkpoint.json");
  if (production && (!path.isAbsolute(sqliteInput) || !path.isAbsolute(checkpointInput) || isWithin(ROOT, path.resolve(checkpointInput)))) throw checkpointError("AUDIT_DELIVERY_PATH_INVALID", "production audit paths must be absolute and checkpoint must be outside the release");
  const checkpointFile = path.resolve(checkpointInput);
  const releaseLock = acquireWorkerLock(checkpointFile);
  try {
    const checkpoint = readCheckpoint(checkpointFile);
    const pending = loadAuditRecords(path.resolve(sqliteInput), checkpoint.deliveredDigests);
    const selected = pending.slice(0, Math.min(1000, Math.max(1, Number(env.AUDIT_DELIVERY_BATCH_SIZE || 200) || 200)));
    const lifecycle = options.lifecycle || (env.PLATFORM_PILOT_CUTOVER_ALERT_JOURNAL_FILE
      ? createPilotCutoverAuditLifecycleBridge({ file: path.resolve(env.PLATFORM_PILOT_CUTOVER_ALERT_JOURNAL_FILE), actorAccount: env.AUDIT_DELIVERY_SERVICE_USER || "audit-delivery-worker" })
      : null);
    const result = await runAuditDeliveryCycle({ adapter: options.adapter || createConfiguredAdapter(env), records: selected.map(({ trail, record }) => ({ trail, record })), previousIncidentOpen: checkpoint.incidentOpen, lifecycle });
    const next = {
      sequence: checkpoint.sequence,
      previousCheckpointDigest: checkpoint.checkpointDigest,
      deliveredDigests: result.ok ? [...checkpoint.deliveredDigests, ...selected.map((item) => item.recordDigest)] : checkpoint.deliveredDigests,
      incidentOpen: !result.ok,
      receipts: result.receipt ? [...checkpoint.receipts, { receiptId: result.receipt.receiptId, batchId: result.receipt.batchId, digest: result.receipt.digest, recordCount: result.receipt.recordCount, acknowledgedAt: result.receipt.acknowledgedAt || new Date().toISOString() }] : checkpoint.receipts,
      updatedAt: new Date().toISOString()
    };
    try { (options.writeCheckpoint || writeCheckpoint)(checkpointFile, next); } catch (error) {
      const signal = auditWriteFailureSignal(error);
      if (typeof options.emitOperationalSignal === "function") await options.emitOperationalSignal(signal);
      throw Object.assign(error, { operationalSignal: signal });
    }
    return { ...result, pendingBefore: pending.length, pendingAfter: result.ok ? pending.length - selected.length : pending.length, productionReady: false };
  } finally { releaseLock(); }
}

if (require.main === module) runWorker().then((result) => { process.stdout.write(`${JSON.stringify({ ok: result.ok, delivered: result.delivered, pendingAfter: result.pendingAfter, incidentTransition: result.incidentTransition, errorCode: result.errorCode || "" })}\n`); if (!result.ok) process.exitCode = 1; }).catch((error) => { process.stderr.write(`${String(error.code || "AUDIT_DELIVERY_WORKER_FAILED")}\n`); process.exitCode = 1; });

module.exports = { acquireWorkerLock, createConfiguredAdapter, loadAuditRecords, readCheckpoint, runWorker, writeCheckpoint };
