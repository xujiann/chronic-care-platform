"use strict";

// Unwired GS03 storage port. The caller owns the connection, transaction,
// namespace authority, and every business/audit check outside this S1 receipt.
const { verifyGs03CallbackReceiptSchema } = require("./gs03-callback-receipt-migration");

const HEX = /^[0-9a-f]{64}$/;
const CONTRACTS = new Set([
  "referral-feedback-callback",
  "referral-schedule-callback",
  "referral-report-callback"
]);
const EDGE_WHITESPACE = new Set([
  9, 10, 11, 12, 13, 32, 133, 160, 5760, 8192, 8193, 8194, 8195,
  8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239,
  8287, 12288, 65279
]);
const SELECTOR_FIELDS = Object.freeze([
  "contract_id", "contract_version", "key_digest", "target_id",
  "authorization_id", "intent_digest_version", "intent_digest"
]);
const RECORD_FIELDS = Object.freeze([
  "receipt_id", "contract_id", "contract_version", "key_digest", "target_id",
  "authorization_id", "intent_digest_version", "intent_digest", "result_status",
  "recorded_at_ms", "security_stream", "security_audit_event_id",
  "access_stream", "access_audit_event_id"
]);
const ABSENT = Object.freeze({ status: "absent", productionReady: false });
const CONFLICT = Object.freeze({ status: "conflict", productionReady: false });
const STAGED = Object.freeze({ status: "staged", productionReady: false });

function failure(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function exactData(value, names, code) {
  let descriptors;
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw failure(code);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch { throw failure(code); }
  if (Reflect.ownKeys(descriptors).length !== names.length ||
      names.some((name) => !Object.hasOwn(descriptors, name) ||
        !Object.hasOwn(descriptors[name], "value"))) throw failure(code);
  return Object.fromEntries(names.map((name) => [name, descriptors[name].value]));
}

function validUtf16(value) {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      i += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

function validId(value, maxBytes) {
  if (typeof value !== "string" || !value || value.length > maxBytes ||
      !validUtf16(value) || value.includes("\0")) return false;
  const points = Array.from(value);
  if (EDGE_WHITESPACE.has(points[0].codePointAt(0)) ||
      EDGE_WHITESPACE.has(points.at(-1).codePointAt(0))) return false;
  const bytes = Buffer.byteLength(value, "utf8");
  return bytes >= 1 && bytes <= maxBytes;
}

function validDigest(value) {
  return typeof value === "string" && value.length === 64 && HEX.test(value);
}

function validateSelector(value) {
  const item = exactData(value, SELECTOR_FIELDS, "GS03_RECEIPT_STORE_INPUT");
  if (!CONTRACTS.has(item.contract_id) || item.contract_version !== 2 ||
      !validDigest(item.key_digest) || !validId(item.target_id, 240) ||
      !validId(item.authorization_id, 240) || item.intent_digest_version !== 2 ||
      !validDigest(item.intent_digest)) throw failure("GS03_RECEIPT_STORE_INPUT");
  return item;
}

function validateRecord(value) {
  const item = exactData(value, RECORD_FIELDS, "GS03_RECEIPT_STORE_INPUT");
  const selector = Object.fromEntries(SELECTOR_FIELDS.map((name) => [name, item[name]]));
  validateSelector(selector);
  if (!validId(item.receipt_id, 128) || item.result_status !== "committed" ||
      !Number.isSafeInteger(item.recorded_at_ms) || item.recorded_at_ms < 0 ||
      item.recorded_at_ms > 8640000000000000 ||
      item.security_stream !== "securityEvents" ||
      !validId(item.security_audit_event_id, 240) ||
      item.access_stream !== "dataAccessLogs" ||
      !validId(item.access_audit_event_id, 240)) throw failure("GS03_RECEIPT_STORE_INPUT");
  return item;
}

function assertReady(db) {
  try {
    if (db.isTransaction !== true) throw failure("GS03_RECEIPT_STORE_UNAVAILABLE");
    const databases = db.prepare("PRAGMA database_list").all();
    if (!Array.isArray(databases) || databases.length < 1 || databases.length > 2 ||
        databases.filter((row) => row.name === "main").length !== 1 ||
        databases.some((row) => row.name !== "main" && row.name !== "temp") ||
        db.prepare("SELECT 1 AS present FROM temp.sqlite_master LIMIT 1").get()) {
      throw failure("GS03_RECEIPT_STORE_UNAVAILABLE");
    }
    if (verifyGs03CallbackReceiptSchema(db) !== true) throw failure("GS03_RECEIPT_STORE_UNAVAILABLE");
  } catch {
    throw failure("GS03_RECEIPT_STORE_UNAVAILABLE");
  }
}

function createGs03ReceiptStore(options) {
  const input = exactData(options, ["environment", "db", "namespaceDigest"],
    "GS03_RECEIPT_STORE_ADMISSION");
  if ((input.environment !== "development" && input.environment !== "test") ||
      !validDigest(input.namespaceDigest)) throw failure("GS03_RECEIPT_STORE_ADMISSION");
  const db = input.db;
  try {
    if (!db || typeof db !== "object" || typeof db.prepare !== "function") {
      throw failure("GS03_RECEIPT_STORE_ADMISSION");
    }
  } catch {
    throw failure("GS03_RECEIPT_STORE_ADMISSION");
  }
  const namespaceDigest = input.namespaceDigest;

  function lookup(value) {
    const selector = validateSelector(value);
    assertReady(db);
    let row;
    try {
      row = db.prepare(`SELECT receipt_id, recorded_at_ms, target_id, authorization_id,
        intent_digest_version, intent_digest
        FROM main.gs03_callback_receipts
        WHERE namespace_digest=? AND contract_id=? AND contract_version=? AND key_digest=?`)
        .get(namespaceDigest, selector.contract_id, selector.contract_version, selector.key_digest);
    } catch {
      throw failure("GS03_RECEIPT_STORE_UNAVAILABLE");
    }
    if (!row) return ABSENT;
    if (row.target_id !== selector.target_id ||
        row.authorization_id !== selector.authorization_id ||
        row.intent_digest_version !== selector.intent_digest_version ||
        row.intent_digest !== selector.intent_digest) return CONFLICT;
    return Object.freeze({
      status: "matched",
      receipt: Object.freeze({ receiptId: row.receipt_id, recordedAtMs: row.recorded_at_ms }),
      productionReady: false
    });
  }

  function insert(value) {
    const record = validateRecord(value);
    assertReady(db);
    try {
      const result = db.prepare(`INSERT INTO main.gs03_callback_receipts
        (receipt_id,namespace_digest,contract_id,contract_version,key_digest,target_id,
          authorization_id,intent_digest_version,intent_digest,result_status,recorded_at_ms,
          security_stream,security_audit_event_id,access_stream,access_audit_event_id)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(record.receipt_id, namespaceDigest, record.contract_id, record.contract_version,
          record.key_digest, record.target_id, record.authorization_id,
          record.intent_digest_version, record.intent_digest, record.result_status,
          record.recorded_at_ms, record.security_stream, record.security_audit_event_id,
          record.access_stream, record.access_audit_event_id);
      if (result?.changes !== 1) throw failure("GS03_RECEIPT_STORE_WRITE");
      return STAGED;
    } catch {
      throw failure("GS03_RECEIPT_STORE_WRITE");
    }
  }

  return Object.freeze({ lookup, insert, productionReady: false });
}

module.exports = { createGs03ReceiptStore };
