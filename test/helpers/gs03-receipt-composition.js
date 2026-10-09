"use strict";

// Isolated composition evidence only. These commands and audit actors are
// synthetic test assumptions, not authentication or a canonical GS03 protocol.
const { createHash } = require("node:crypto");
const { auditHashFor, verifyAuditTrail } = require("../../src/identity-security/audit-chain");
const {
  appendAuditDeliverySourceChanges, buildAuditDeliverySourceCandidate,
  createAuditDeliverySourceSchema, auditSourceHash
} = require("../../src/identity-security/audit-delivery-source");
const { createGs03CallbackReceiptSchema, verifyGs03CallbackReceiptSchema } =
  require("../../src/platform/storage/gs03-callback-receipt-migration");
const { createGs03MemoryTransactionSession } = require("../../src/platform/storage/gs03-memory-transaction");
const { createGs03ReceiptStore } = require("../../src/platform/storage/gs03-receipt-store");
const { runGs03Transaction } = require("../../src/platform/storage/gs03-transaction-outcome");

const AT = "2026-10-09T00:00:00.000Z";
const ACTOR = "synthetic-gs03-actor";
const CONTRACTS = new Set([
  "referral-feedback-callback", "referral-schedule-callback", "referral-report-callback"
]);
const FAULTS = new Set([
  "after-state", "after-message-1", "after-message-2", "after-security-audit",
  "after-access-audit", "after-security-source", "after-access-source",
  "after-receipt", "verify", "commit-before", "commit-after", "missing-parent"
]);
const HEX = /^[0-9a-f]{64}$/;

function admission() {
  const error = new Error("GS03_RECEIPT_COMPOSITION_ADMISSION");
  error.code = "GS03_RECEIPT_COMPOSITION_ADMISSION";
  return error;
}

function exactData(value, names) {
  let descriptors;
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw admission();
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch { throw admission(); }
  if (Reflect.ownKeys(descriptors).length !== names.length ||
      names.some((name) => !Object.hasOwn(descriptors, name) ||
        !Object.hasOwn(descriptors[name], "value"))) throw admission();
  return Object.fromEntries(names.map((name) => [name, descriptors[name].value]));
}

function commandOf(value) {
  const command = exactData(value, [
    "namespaceDigest", "contractId", "keyDigest", "targetId", "authorizationId", "intentDigest"
  ]);
  const digest = (item) => typeof item === "string" && item.length === 64 && HEX.test(item);
  const id = (item) => typeof item === "string" && /^[A-Za-z0-9._:-]{1,120}$/.test(item);
  if (!digest(command.namespaceDigest) || !CONTRACTS.has(command.contractId) ||
      !digest(command.keyDigest) || !id(command.targetId) ||
      !id(command.authorizationId) || !digest(command.intentDigest)) throw admission();
  return command;
}

function selectedFault(options) {
  if (options === undefined) return undefined;
  const input = exactData(options, ["fault"]);
  if (!FAULTS.has(input.fault)) throw admission();
  return input.fault;
}

function failAt(selected, checkpoint) {
  if (selected === checkpoint) throw new Error(`GS03_RECEIPT_COMPOSITION_FAULT:${checkpoint}`);
}

function idsFor(command) {
  const digest = createHash("sha256").update(JSON.stringify([
    command.namespaceDigest, command.contractId, command.keyDigest
  ])).digest("hex");
  return {
    receipt: `synthetic-receipt:${digest}`,
    security: `synthetic-security:${digest}`,
    access: `synthetic-access:${digest}`,
    message1: `synthetic-message:${digest}:1`,
    message2: `synthetic-message:${digest}:2`
  };
}

function selectorFor(command) {
  return {
    contract_id: command.contractId,
    contract_version: 2,
    key_digest: command.keyDigest,
    target_id: command.targetId,
    authorization_id: command.authorizationId,
    intent_digest_version: 2,
    intent_digest: command.intentDigest
  };
}

function recordFor(command, ids) {
  return {
    receipt_id: ids.receipt,
    ...selectorFor(command),
    result_status: "committed",
    recorded_at_ms: Date.parse(AT),
    security_stream: "securityEvents",
    security_audit_event_id: ids.security,
    access_stream: "dataAccessLogs",
    access_audit_event_id: ids.access
  };
}

function auditRows(db, table) {
  return db.prepare(`SELECT sequence,event_id,receipt_id,event_json FROM main.${table} ORDER BY sequence`)
    .all().map((row) => ({ ...row }));
}

function trail(db, table) {
  return auditRows(db, table).map((row) => JSON.parse(row.event_json)).reverse();
}

function appendAudit(db, table, eventId, receiptId, properties) {
  const prior = trail(db, table);
  const value = { id: eventId, at: AT, ...properties, previousAuditHash: prior[0]?.auditHash || "" };
  const event = { ...value, auditHash: auditHashFor(value) };
  db.prepare(`INSERT INTO main.${table}(event_id,receipt_id,event_json) VALUES(?,?,?)`)
    .run(eventId, receiptId, JSON.stringify(event));
  return { prior, next: [event, ...prior], event };
}

function sourceMatches(db, stream, event, eventId) {
  const candidate = buildAuditDeliverySourceCandidate(stream, event);
  const row = db.prepare(`SELECT * FROM main.audit_delivery_source_events
    WHERE stream=? AND source_event_id=?`).get(stream, eventId);
  if (!row || row.source_digest !== candidate.sourceDigest ||
      row.projection_digest !== candidate.projectionDigest ||
      row.projection_json !== candidate.projectionJson || row.historical_baseline !== 0 ||
      row.projection_schema !== candidate.projection.schemaVersion) return false;
  return row.source_hash === auditSourceHash({
    sequence: row.sequence, stream: row.stream, sourceEventId: row.source_event_id,
    occurredAt: row.occurred_at, sourceDigest: row.source_digest,
    projectionDigest: row.projection_digest, previousSourceHash: row.previous_source_hash,
    historicalBaseline: false, recordedAt: row.recorded_at
  });
}

function factsMatch(db, command, ids, kind) {
  const row = db.prepare("SELECT * FROM main.gs03_callback_receipts WHERE receipt_id=?").get(ids.receipt);
  const expected = { namespace_digest: command.namespaceDigest, ...recordFor(command, ids) };
  if (!row || Object.entries(expected).some(([key, value]) => row[key] !== value)) return false;
  const messages = db.prepare("SELECT * FROM main.synthetic_messages WHERE receipt_id=? ORDER BY slot")
    .all(ids.receipt);
  if (messages.length !== 2 ||
      messages.some((message, index) => message.message_id !== ids[`message${index + 1}`] ||
        message.slot !== index + 1 || message.target_id !== command.targetId ||
        message.intent_digest !== command.intentDigest)) return false;
  const securityRows = db.prepare("SELECT * FROM main.synthetic_security_audit WHERE receipt_id=?")
    .all(ids.receipt);
  const accessRows = db.prepare("SELECT * FROM main.synthetic_access_audit WHERE receipt_id=?")
    .all(ids.receipt);
  if (securityRows.length !== 1 || accessRows.length !== 1 ||
      securityRows[0].event_id !== ids.security || accessRows[0].event_id !== ids.access) return false;
  const security = JSON.parse(securityRows[0].event_json);
  const access = JSON.parse(accessRows[0].event_json);
  const related = (event) => event.receiptId === ids.receipt &&
    event.authorizationId === command.authorizationId &&
    event.intentDigest === command.intentDigest && event.actor === ACTOR &&
    event.role === "synthetic" && event.result === "allowed";
  if (!related(security) || !related(access) || security.id !== ids.security ||
      security.target !== command.targetId || security.action !== command.contractId ||
      access.id !== ids.access || access.scope !== command.targetId ||
      access.action !== "data-access" ||
      !verifyAuditTrail(trail(db, "synthetic_security_audit")).passed ||
      !verifyAuditTrail(trail(db, "synthetic_access_audit")).passed ||
      !sourceMatches(db, "securityEvents", security, ids.security) ||
      !sourceMatches(db, "dataAccessLogs", access, ids.access)) return false;
  const current = db.prepare("SELECT * FROM main.synthetic_cases WHERE target_id=?")
    .get(command.targetId);
  return !!current && current.version >= 1 &&
    (kind !== "first" || current.intent_digest === command.intentDigest);
}

async function createGs03ReceiptCompositionHarness(options) {
  const { environment } = exactData(options, ["environment"]);
  if (environment !== "test") throw admission();
  const session = createGs03MemoryTransactionSession({ environment: "test" });
  let db;
  let closed = false;
  try {
    const setup = session.createPort({
      apply(connection) {
        db = connection;
        createAuditDeliverySourceSchema(connection);
        createGs03CallbackReceiptSchema(connection);
        connection.exec(`
          CREATE TABLE synthetic_cases (
            target_id TEXT PRIMARY KEY, intent_digest TEXT NOT NULL,
            version INTEGER NOT NULL CHECK(version > 0)
          );
          CREATE TABLE synthetic_messages (
            message_id TEXT PRIMARY KEY, receipt_id TEXT NOT NULL, slot INTEGER NOT NULL,
            target_id TEXT NOT NULL, intent_digest TEXT NOT NULL, UNIQUE(receipt_id,slot)
          );
          CREATE TABLE synthetic_security_audit (
            sequence INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE,
            receipt_id TEXT NOT NULL, event_json TEXT NOT NULL
          );
          CREATE TABLE synthetic_access_audit (
            sequence INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE,
            receipt_id TEXT NOT NULL, event_json TEXT NOT NULL
          );
        `);
        return "replay";
      },
      verify(connection) { return verifyGs03CallbackReceiptSchema(connection) === true; }
    });
    const result = await runGs03Transaction({ environment: "test", port: setup });
    if (result.status !== "confirmed-replay") throw new Error("GS03_RECEIPT_COMPOSITION_SETUP");
  } catch (error) {
    try { session.close(); } catch { /* Preserve setup failure. */ }
    throw error;
  }

  function snapshot() {
    if (closed) throw admission();
    const rows = (sql) => db.prepare(sql).all().map((row) => ({ ...row }));
    return {
      cases: rows("SELECT * FROM main.synthetic_cases ORDER BY target_id"),
      messages: rows("SELECT * FROM main.synthetic_messages ORDER BY message_id"),
      securityAudit: auditRows(db, "synthetic_security_audit"),
      accessAudit: auditRows(db, "synthetic_access_audit"),
      sourceEvents: rows("SELECT * FROM main.audit_delivery_source_events ORDER BY sequence"),
      receipts: rows("SELECT * FROM main.gs03_callback_receipts ORDER BY receipt_id"),
      databaseList: db.prepare("PRAGMA database_list").all().map((row) => row.name).sort(),
      transactionOpen: db.isTransaction
    };
  }

  async function execute(input, optionsForCall) {
    if (closed) throw admission();
    const command = commandOf(input);
    const selected = selectedFault(optionsForCall);
    const ids = idsFor(command);
    let kind;
    const port = session.createPort({
      apply(connection) {
        const store = createGs03ReceiptStore({
          environment: "test", db: connection, namespaceDigest: command.namespaceDigest
        });
        const lookup = store.lookup(selectorFor(command));
        if (lookup.status === "conflict") throw new Error("GS03_RECEIPT_COMPOSITION_CONFLICT");
        if (lookup.status === "matched") {
          if (lookup.receipt.receiptId !== ids.receipt) throw new Error("GS03_RECEIPT_COMPOSITION_RECEIPT");
          kind = "replay";
          return kind;
        }
        connection.prepare(`INSERT INTO main.synthetic_cases(target_id,intent_digest,version) VALUES(?,?,1)
          ON CONFLICT(target_id) DO UPDATE SET
            intent_digest=excluded.intent_digest,version=synthetic_cases.version+1`)
          .run(command.targetId, command.intentDigest);
        failAt(selected, "after-state");
        for (const slot of [1, 2]) {
          connection.prepare(`INSERT INTO main.synthetic_messages
            (message_id,receipt_id,slot,target_id,intent_digest) VALUES(?,?,?,?,?)`)
            .run(ids[`message${slot}`], ids.receipt, slot, command.targetId, command.intentDigest);
          failAt(selected, `after-message-${slot}`);
        }
        const security = appendAudit(connection, "synthetic_security_audit", ids.security,
          ids.receipt, { action: command.contractId, result: "allowed", role: "synthetic",
            actor: ACTOR, target: command.targetId, authorizationId: command.authorizationId,
            receiptId: ids.receipt, intentDigest: command.intentDigest });
        failAt(selected, "after-security-audit");
        const access = appendAudit(connection, "synthetic_access_audit", ids.access,
          ids.receipt, { action: "data-access", result: "allowed", role: "synthetic",
            actor: ACTOR, scope: command.targetId, authorizationId: command.authorizationId,
            receiptId: ids.receipt, intentDigest: command.intentDigest });
        failAt(selected, "after-access-audit");
        if (selected !== "missing-parent") {
          appendAuditDeliverySourceChanges(connection,
            { securityEvents: security.prior, dataAccessLogs: access.prior },
            { securityEvents: security.next, dataAccessLogs: access.prior }, { recordedAt: AT });
        }
        failAt(selected, "after-security-source");
        const sourceSecurity = selected === "missing-parent" ? security.prior : security.next;
        appendAuditDeliverySourceChanges(connection,
          { securityEvents: sourceSecurity, dataAccessLogs: access.prior },
          { securityEvents: sourceSecurity, dataAccessLogs: access.next }, { recordedAt: AT });
        failAt(selected, "after-access-source");
        const inserted = store.insert(recordFor(command, ids));
        if (inserted.status !== "staged") throw new Error("GS03_RECEIPT_COMPOSITION_INSERT");
        failAt(selected, "after-receipt");
        kind = "first";
        return kind;
      },
      verify(connection) {
        failAt(selected, "verify");
        return factsMatch(connection, command, ids, kind);
      }
    });
    const wrapped = selected === "commit-before" || selected === "commit-after" ? Object.freeze({
      begin: () => port.begin(),
      apply: () => port.apply(),
      verify: () => port.verify(),
      commit() {
        failAt(selected, "commit-before");
        const result = port.commit();
        failAt(selected, "commit-after");
        return result;
      },
      rollback: () => port.rollback()
    }) : port;
    return runGs03Transaction({ environment: "test", port: wrapped });
  }

  function close() {
    if (closed) return true;
    const result = session.close();
    closed = true;
    db = null;
    return result;
  }

  return Object.freeze({ execute, snapshot, close, productionReady: false });
}

module.exports = { createGs03ReceiptCompositionHarness };
