"use strict";

// Test-only GS03 composition. These synthetic rows are not business, audit, or
// production receipt facts. Only the existing adapter controls transactions.
const { createGs03MemoryTransactionSession } = require("../../src/platform/storage/gs03-memory-transaction");
const { runGs03Transaction } = require("../../src/platform/storage/gs03-transaction-outcome");

const FAULTS = new Set([
  "after-state", "after-message-1", "after-message-2", "after-audit",
  "after-receipt", "verify", "commit-before", "commit-after"
]);
const PLACEHOLDER = "synthetic-placeholder";

function admission() {
  const error = new Error("GS03_COMPOSITION_ADMISSION");
  error.code = "GS03_COMPOSITION_ADMISSION";
  return error;
}

function exactStrings(value, names) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw admission();
  let descriptors;
  try { descriptors = Object.getOwnPropertyDescriptors(value); } catch { throw admission(); }
  if (Reflect.ownKeys(descriptors).length !== names.length ||
      names.some((name) => !Object.hasOwn(descriptors, name) ||
        !Object.hasOwn(descriptors[name], "value") ||
        typeof descriptors[name].value !== "string" || !descriptors[name].value)) throw admission();
  return Object.fromEntries(names.map((name) => [name, descriptors[name].value]));
}

function selectedFault(options) {
  if (options === undefined) return undefined;
  if (!options || typeof options !== "object" || Array.isArray(options)) throw admission();
  let descriptors;
  try { descriptors = Object.getOwnPropertyDescriptors(options); } catch { throw admission(); }
  if (Reflect.ownKeys(descriptors).length !== 1 || !Object.hasOwn(descriptors, "fault") ||
      !Object.hasOwn(descriptors.fault, "value") || !FAULTS.has(descriptors.fault.value)) throw admission();
  return descriptors.fault.value;
}

function failAt(selected, checkpoint) {
  if (selected === checkpoint) throw new Error(`GS03_COMPOSITION_FAULT:${checkpoint}`);
}

function factsFor(db, command, receiptId) {
  const receipt = db.prepare("SELECT * FROM synthetic_receipts WHERE receiptId=?").get(receiptId);
  if (!receipt || receipt.namespace !== command.namespace || receipt.key !== command.key ||
      receipt.target !== command.target || receipt.intent !== command.intent) return false;
  const one = db.prepare("SELECT * FROM synthetic_messages WHERE id=?").get(receipt.message1Id);
  const two = db.prepare("SELECT * FROM synthetic_messages WHERE id=?").get(receipt.message2Id);
  const audit = db.prepare("SELECT * FROM synthetic_audit WHERE id=?").get(receipt.auditId);
  const related = (row) => row && row.receiptId === receiptId &&
    row.target === command.target && row.intent === command.intent;
  if (!related(one) || !related(two) || one.slot !== 1 || two.slot !== 2 ||
      !related(audit) || audit.kind !== PLACEHOLDER) return false;
  if (db.prepare("SELECT count(*) AS n FROM synthetic_messages WHERE receiptId=?").get(receiptId).n !== 2 ||
      db.prepare("SELECT count(*) AS n FROM synthetic_audit WHERE receiptId=?").get(receiptId).n !== 1) return false;
  const current = db.prepare("SELECT * FROM synthetic_cases WHERE target=?").get(command.target);
  return !!current && current.version >= receipt.caseVersion;
}

async function createGs03CompositionHarness(options) {
  const { environment } = exactStrings(options, ["environment"]);
  if (environment !== "test") throw admission();
  const session = createGs03MemoryTransactionSession({ environment: "test" });
  let db;
  let closed = false;
  try {
    const setup = session.createPort({
      apply(connection) {
        db = connection;
        connection.exec(`
          CREATE TABLE synthetic_cases (
            target TEXT PRIMARY KEY, intent TEXT NOT NULL, version INTEGER NOT NULL CHECK (version > 0)
          );
          CREATE TABLE synthetic_messages (
            id TEXT PRIMARY KEY, receiptId TEXT NOT NULL, slot INTEGER NOT NULL,
            target TEXT NOT NULL, intent TEXT NOT NULL,
            UNIQUE (receiptId, slot)
          );
          CREATE TABLE synthetic_audit (
            id TEXT PRIMARY KEY, receiptId TEXT NOT NULL UNIQUE,
            target TEXT NOT NULL, intent TEXT NOT NULL, kind TEXT NOT NULL
          );
          CREATE TABLE synthetic_receipts (
            receiptId TEXT PRIMARY KEY, namespace TEXT NOT NULL, key TEXT NOT NULL,
            target TEXT NOT NULL, intent TEXT NOT NULL, caseVersion INTEGER NOT NULL,
            message1Id TEXT NOT NULL, message2Id TEXT NOT NULL, auditId TEXT NOT NULL,
            UNIQUE (namespace, key)
          );
        `);
        return "replay";
      },
      verify(connection) {
        return connection.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name LIKE 'synthetic_%'").get().n === 4;
      }
    });
    const result = await runGs03Transaction({ environment: "test", port: setup });
    if (result.status !== "confirmed-replay") throw new Error("GS03_COMPOSITION_SETUP");
  } catch (error) {
    try { session.close(); } catch { /* Preserve setup failure. */ }
    throw error;
  }

  function snapshot() {
    if (closed) throw admission();
    // db is private: observation is restricted to SELECT and isTransaction.
    const rows = (query) => db.prepare(query).all().map((row) => ({ ...row }));
    return {
      cases: rows("SELECT target,intent,version FROM synthetic_cases ORDER BY target"),
      messages: rows("SELECT id,receiptId,slot,target,intent FROM synthetic_messages ORDER BY id"),
      audit: rows("SELECT id,receiptId,target,intent,kind FROM synthetic_audit ORDER BY id"),
      receipts: rows("SELECT receiptId,namespace,key,target,intent,caseVersion,message1Id,message2Id,auditId FROM synthetic_receipts ORDER BY namespace,key"),
      transactionOpen: db.isTransaction
    };
  }

  async function execute(input, optionsForCall) {
    if (closed) throw admission();
    const command = exactStrings(input, ["namespace", "key", "target", "intent"]);
    const selected = selectedFault(optionsForCall);
    const receiptId = JSON.stringify([command.namespace, command.key]);
    const message1Id = JSON.stringify([command.namespace, command.key, 1]);
    const message2Id = JSON.stringify([command.namespace, command.key, 2]);
    const auditId = JSON.stringify([command.namespace, command.key, "audit"]);
    let kind;
    const port = session.createPort({
      apply(connection) {
        const prior = connection.prepare("SELECT target,intent FROM synthetic_receipts WHERE namespace=? AND key=?")
          .get(command.namespace, command.key);
        if (prior) {
          if (prior.target !== command.target || prior.intent !== command.intent) {
            throw new Error("GS03_COMPOSITION_CONFLICT");
          }
          kind = "replay";
          return kind;
        }
        connection.prepare(`INSERT INTO synthetic_cases(target,intent,version) VALUES(?,?,1)
          ON CONFLICT(target) DO UPDATE SET intent=excluded.intent,version=synthetic_cases.version+1`)
          .run(command.target, command.intent);
        failAt(selected, "after-state");
        connection.prepare("INSERT INTO synthetic_messages(id,receiptId,slot,target,intent) VALUES(?,?,?,?,?)")
          .run(message1Id, receiptId, 1, command.target, command.intent);
        failAt(selected, "after-message-1");
        connection.prepare("INSERT INTO synthetic_messages(id,receiptId,slot,target,intent) VALUES(?,?,?,?,?)")
          .run(message2Id, receiptId, 2, command.target, command.intent);
        failAt(selected, "after-message-2");
        connection.prepare("INSERT INTO synthetic_audit(id,receiptId,target,intent,kind) VALUES(?,?,?,?,?)")
          .run(auditId, receiptId, command.target, command.intent, PLACEHOLDER);
        failAt(selected, "after-audit");
        const state = connection.prepare("SELECT version FROM synthetic_cases WHERE target=?").get(command.target);
        connection.prepare(`INSERT INTO synthetic_receipts
          (receiptId,namespace,key,target,intent,caseVersion,message1Id,message2Id,auditId)
          VALUES(?,?,?,?,?,?,?,?,?)`)
          .run(receiptId, command.namespace, command.key, command.target, command.intent,
            state.version, message1Id, message2Id, auditId);
        failAt(selected, "after-receipt");
        kind = "first";
        return kind;
      },
      verify(connection) {
        failAt(selected, "verify");
        if (!factsFor(connection, command, receiptId)) return false;
        if (kind === "first") {
          const state = connection.prepare("SELECT intent,version FROM synthetic_cases WHERE target=?")
            .get(command.target);
          const receipt = connection.prepare("SELECT caseVersion FROM synthetic_receipts WHERE receiptId=?")
            .get(receiptId);
          return state.intent === command.intent && state.version === receipt.caseVersion;
        }
        return kind === "replay";
      }
    });
    const wrapped = selected === "commit-before" || selected === "commit-after" ? Object.freeze({
      begin: () => port.begin(),
      apply: () => port.apply(),
      verify: () => port.verify(),
      commit() {
        failAt(selected, "commit-before");
        const committed = port.commit();
        failAt(selected, "commit-after");
        return committed;
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

module.exports = { createGs03CompositionHarness };
