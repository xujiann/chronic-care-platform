"use strict";

// OPS-054: isolated, synthetic SQLite evidence for an unwired S1 receipt port.
const test = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { auditHashFor } = require("../src/identity-security/audit-chain");
const { appendAuditDeliverySourceChanges } = require("../src/identity-security/audit-delivery-source");
const { SQLITE_MIGRATIONS, SQLITE_SCHEMA_HEAD, applySqliteMigrations } = require("../src/platform/storage/sqlite-migrations");
const {
  GS03_CALLBACK_RECEIPT_MIGRATION,
  verifyGs03CallbackReceiptSchema
} = require("../src/platform/storage/gs03-callback-receipt-migration");
const { createGs03ReceiptStore } = require("../src/platform/storage/gs03-receipt-store");

const NAMESPACE_A = "a".repeat(64);
const NAMESPACE_B = "d".repeat(64);
const KEY_A = "b".repeat(64);
const KEY_B = "e".repeat(64);
const INTENT_A = "c".repeat(64);
const INTENT_B = "f".repeat(64);
const AT = "2026-10-08T00:00:00.000Z";
const S1 = [...SQLITE_MIGRATIONS, GS03_CALLBACK_RECEIPT_MIGRATION];
const SELECTOR_FIELDS = ["contract_id", "contract_version", "key_digest", "target_id", "authorization_id",
  "intent_digest_version", "intent_digest"];
const RECORD_FIELDS = ["receipt_id", ...SELECTOR_FIELDS, "result_status", "recorded_at_ms",
  "security_stream", "security_audit_event_id", "access_stream", "access_audit_event_id"];

function selector(overrides = {}) {
  return {
    contract_id: "referral-feedback-callback", contract_version: 2, key_digest: KEY_A,
    target_id: "case-synthetic-1", authorization_id: "authorization-synthetic-1",
    intent_digest_version: 2, intent_digest: INTENT_A, ...overrides
  };
}

function record(overrides = {}) {
  return {
    receipt_id: "receipt-synthetic-1", ...selector(), result_status: "committed",
    recorded_at_ms: 1791417600000, security_stream: "securityEvents",
    security_audit_event_id: "security-synthetic-1", access_stream: "dataAccessLogs",
    access_audit_event_id: "access-synthetic-1", ...overrides
  };
}

function trail(ids, details) {
  let previousAuditHash = "";
  const newestFirst = [];
  for (const id of ids) {
    const value = { id, at: AT, ...details, previousAuditHash };
    const entry = { ...value, auditHash: auditHashFor(value) };
    previousAuditHash = entry.auditHash;
    newestFirst.unshift(entry);
  }
  return newestFirst;
}

function auditState(securityIds = ["security-synthetic-1"], accessIds = ["access-synthetic-1"]) {
  return {
    securityEvents: trail(securityIds, { action: "synthetic-success", result: "allowed", actor: "synthetic-actor" }),
    dataAccessLogs: trail(accessIds, { result: "allowed", actor: "synthetic-actor", scope: "synthetic-scope" })
  };
}

function fixture(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => { try { db.close(); } catch { /* Some tests close the connection explicitly. */ } });
  db.exec("PRAGMA foreign_keys=ON");
  assert.equal(db.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
  const migrated = applySqliteMigrations(db, { migrations: S1 });
  assert.equal(migrated.head, 20);
  assert.equal(verifyGs03CallbackReceiptSchema(db), true);
  const seeded = appendAuditDeliverySourceChanges(db, {}, auditState(), { recordedAt: AT });
  assert.equal(seeded.inserted, 2);
  const store = createGs03ReceiptStore({ environment: "test", db, namespaceDigest: NAMESPACE_A });
  return { db, store };
}

function rows(db) {
  return db.prepare("SELECT * FROM main.gs03_callback_receipts ORDER BY receipt_id").all().map((row) => ({ ...row }));
}

function auditRows(db) {
  return db.prepare("SELECT * FROM main.audit_delivery_source_events ORDER BY sequence").all().map((row) => ({ ...row }));
}

function begin(db) {
  db.exec("BEGIN IMMEDIATE");
  assert.equal(db.isTransaction, true);
}

function fails(fn, code) {
  assert.throws(fn, (error) => {
    assert.equal(error.code, code);
    assert.equal(error.message, code);
    assert.equal(error.cause, undefined);
    assert.equal(JSON.stringify(error).includes("synthetic-actor"), false);
    return true;
  });
}

test("explicit real S1 migration leaves the default registry at v19 and no default receipt table", (t) => {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec("PRAGMA foreign_keys=ON");
  assert.equal(SQLITE_SCHEMA_HEAD, 19);
  assert.equal(SQLITE_MIGRATIONS.includes(GS03_CALLBACK_RECEIPT_MIGRATION), false);
  assert.equal(applySqliteMigrations(db).head, 19);
  assert.equal(db.prepare("SELECT count(*) AS n FROM main.sqlite_master WHERE type='table' AND name='gs03_callback_receipts'").get().n, 0);
  assert.equal(applySqliteMigrations(db, { migrations: S1 }).head, 20);
  assert.equal(verifyGs03CallbackReceiptSchema(db), true);
  assert.equal(db.prepare("SELECT count(*) AS n FROM main.sqlite_master WHERE type='table' AND name='gs03_callback_receipts'").get().n, 1);
});

test("absent, staged, matched and conflict expose only the fixed frozen contract", (t) => {
  const { db, store } = fixture(t);
  assert.deepEqual(Object.keys(store).sort(), ["insert", "lookup", "productionReady"]);
  assert.equal(Object.isFrozen(store), true);
  assert.equal(store.productionReady, false);
  assert.equal(createGs03ReceiptStore({ environment: "development", db, namespaceDigest: NAMESPACE_A }).productionReady, false);
  begin(db);
  const absent = store.lookup(selector());
  assert.deepEqual(absent, { status: "absent", productionReady: false });
  assert.equal(Object.isFrozen(absent), true);
  const staged = store.insert(record());
  assert.deepEqual(staged, { status: "staged", productionReady: false });
  assert.equal(Object.isFrozen(staged), true);
  assert.equal(db.isTransaction, true);
  assert.deepEqual(rows(db), [{ namespace_digest: NAMESPACE_A, ...record() }]);
  const matched = store.lookup(selector());
  assert.deepEqual(matched, {
    status: "matched", receipt: { receiptId: "receipt-synthetic-1", recordedAtMs: 1791417600000 },
    productionReady: false
  });
  assert.equal(Object.isFrozen(matched), true);
  assert.equal(Object.isFrozen(matched.receipt), true);
  const before = rows(db);
  for (const change of [
    { target_id: "other-case" }, { authorization_id: "other-authorization" },
    { intent_digest: INTENT_B }
  ]) {
    const conflict = store.lookup(selector(change));
    assert.deepEqual(conflict, { status: "conflict", productionReady: false });
    assert.equal(Object.isFrozen(conflict), true);
    assert.equal(JSON.stringify(conflict).includes("receipt-synthetic-1"), false);
    assert.deepEqual(rows(db), before);
  }
  assert.deepEqual(store.lookup(selector({ contract_id: "referral-schedule-callback" })), absent);
  assert.deepEqual(store.lookup(selector({ key_digest: KEY_B })), absent);
  assert.deepEqual(rows(db), before);
  db.exec("COMMIT");
  begin(db);
  assert.deepEqual(store.lookup(selector()), matched);
  assert.deepEqual(rows(db), before);
  db.exec("ROLLBACK");
});

test("all three S1 contract IDs can be inserted and exactly looked up without changing one another", (t) => {
  const { db, store } = fixture(t);
  begin(db);
  const contracts = ["referral-feedback-callback", "referral-schedule-callback", "referral-report-callback"];
  contracts.forEach((contract_id, index) => {
    const value = record({ contract_id, receipt_id: `receipt-synthetic-${index + 1}` });
    assert.deepEqual(store.lookup(selector({ contract_id })), { status: "absent", productionReady: false });
    assert.deepEqual(store.insert(value), { status: "staged", productionReady: false });
    assert.deepEqual(store.lookup(selector({ contract_id })), {
      status: "matched", receipt: { receiptId: value.receipt_id, recordedAtMs: value.recorded_at_ms },
      productionReady: false
    });
  });
  assert.deepEqual(rows(db).map((row) => row.contract_id).sort(), [...contracts].sort());
  db.exec("ROLLBACK");
});

test("different bound namespaces hold the same key independently and method input cannot override binding", (t) => {
  const { db, store } = fixture(t);
  const other = createGs03ReceiptStore({ environment: "test", db, namespaceDigest: NAMESPACE_B });
  begin(db);
  assert.deepEqual(store.insert(record()), { status: "staged", productionReady: false });
  assert.deepEqual(other.lookup(selector()), { status: "absent", productionReady: false });
  assert.deepEqual(other.insert(record({ receipt_id: "receipt-synthetic-2", target_id: "case-synthetic-2" })),
    { status: "staged", productionReady: false });
  assert.deepEqual(store.lookup(selector()), {
    status: "matched", receipt: { receiptId: "receipt-synthetic-1", recordedAtMs: 1791417600000 }, productionReady: false
  });
  assert.deepEqual(other.lookup(selector({ target_id: "case-synthetic-2" })), {
    status: "matched", receipt: { receiptId: "receipt-synthetic-2", recordedAtMs: 1791417600000 }, productionReady: false
  });
  assert.deepEqual(rows(db), [
    { namespace_digest: NAMESPACE_A, ...record() },
    { namespace_digest: NAMESPACE_B, ...record({ receipt_id: "receipt-synthetic-2", target_id: "case-synthetic-2" }) }
  ]);
  const before = rows(db);
  fails(() => store.insert({ ...record({ receipt_id: "receipt-synthetic-3", key_digest: KEY_B }), namespace_digest: NAMESPACE_B }),
    "GS03_RECEIPT_STORE_INPUT");
  fails(() => store.lookup({ ...selector(), namespace_digest: NAMESPACE_B }), "GS03_RECEIPT_STORE_INPUT");
  assert.deepEqual(rows(db), before);
  db.exec("ROLLBACK");
});

test("duplicate primary/key and bad security/access parents fail without changing receipts or other caller facts", (t) => {
  const { db, store } = fixture(t);
  begin(db);
  db.prepare("INSERT INTO main.state_collections(key,payload,updated_at,version) VALUES(?,?,?,?)")
    .run("synthetic-caller-fact", "{}", AT, 1);
  const callerFact = db.prepare("SELECT * FROM main.state_collections WHERE key='synthetic-caller-fact'").get();
  assert.deepEqual(store.insert(record()), { status: "staged", productionReady: false });
  const before = rows(db);
  for (const invalid of [
    record(),
    record({ receipt_id: "receipt-synthetic-2" }),
    record({ key_digest: KEY_B }),
    record({ receipt_id: "receipt-synthetic-2", key_digest: KEY_B,
      security_audit_event_id: "missing-security-parent" }),
    record({ receipt_id: "receipt-synthetic-2", key_digest: KEY_B,
      access_audit_event_id: "missing-access-parent" })
  ]) {
    fails(() => store.insert(invalid), "GS03_RECEIPT_STORE_WRITE");
    assert.deepEqual(rows(db), before);
    assert.deepEqual(db.prepare("SELECT * FROM main.state_collections WHERE key='synthetic-caller-fact'").get(), callerFact);
    assert.equal(db.isTransaction, true);
  }
  db.exec("COMMIT");
  assert.deepEqual(rows(db), before);
  assert.deepEqual(db.prepare("SELECT * FROM main.state_collections WHERE key='synthetic-caller-fact'").get(), callerFact);
});

test("a statement reporting zero affected rows cannot be confirmed as staged", (t) => {
  const { db, store } = fixture(t);
  begin(db);
  const nativePrepare = db.prepare;
  db.prepare = function (sql) {
    if (String(sql).startsWith("INSERT INTO main.gs03_callback_receipts")) {
      return { run() { return { changes: 0 }; } };
    }
    return nativePrepare.call(this, sql);
  };
  try {
    fails(() => store.insert(record()), "GS03_RECEIPT_STORE_WRITE");
  } finally {
    db.prepare = nativePrepare;
  }
  assert.deepEqual(rows(db), []);
  assert.equal(db.isTransaction, true);
  db.exec("ROLLBACK");
});

test("factory, selector and record reject exact-key violations before any receipt write", (t) => {
  const { db, store } = fixture(t);
  for (const options of [undefined, {}, { environment: "production", db, namespaceDigest: NAMESPACE_A },
    { environment: "test", db, namespaceDigest: "A".repeat(64) },
    { environment: "test", db, namespaceDigest: NAMESPACE_A, path: ":memory:" },
    { environment: "test", db: {}, namespaceDigest: NAMESPACE_A }]) {
    fails(() => createGs03ReceiptStore(options), "GS03_RECEIPT_STORE_ADMISSION");
  }
  const factoryGetter = Object.defineProperty({ environment: "test", namespaceDigest: NAMESPACE_A }, "db",
    { get() { throw Error("private getter"); } });
  fails(() => createGs03ReceiptStore(factoryGetter), "GS03_RECEIPT_STORE_ADMISSION");
  const factorySymbol = { environment: "test", db, namespaceDigest: NAMESPACE_A };
  factorySymbol[Symbol("private")] = "private";
  fails(() => createGs03ReceiptStore(factorySymbol), "GS03_RECEIPT_STORE_ADMISSION");
  begin(db);
  const noReceipts = rows(db);
  for (const field of SELECTOR_FIELDS) {
    const invalid = selector();
    delete invalid[field];
    fails(() => store.lookup(invalid), "GS03_RECEIPT_STORE_INPUT");
  }
  for (const field of RECORD_FIELDS) {
    const invalid = record();
    delete invalid[field];
    fails(() => store.insert(invalid), "GS03_RECEIPT_STORE_INPUT");
  }
  const getter = Object.defineProperty(selector(), "key_digest", { get() { throw Error("private getter"); } });
  fails(() => store.lookup(getter), "GS03_RECEIPT_STORE_INPUT");
  const selectorSymbol = selector();
  selectorSymbol[Symbol("private")] = "private";
  fails(() => store.lookup(selectorSymbol), "GS03_RECEIPT_STORE_INPUT");
  const symbol = record();
  symbol[Symbol("private")] = "private";
  fails(() => store.insert(symbol), "GS03_RECEIPT_STORE_INPUT");
  const recordGetter = Object.defineProperty(record(), "receipt_id", { get() { throw Error("private getter"); } });
  fails(() => store.insert(recordGetter), "GS03_RECEIPT_STORE_INPUT");
  fails(() => store.lookup({ ...selector(), path: "private.db" }), "GS03_RECEIPT_STORE_INPUT");
  fails(() => store.insert({ ...record(), namespace_digest: NAMESPACE_B }), "GS03_RECEIPT_STORE_INPUT");
  assert.deepEqual(rows(db), noReceipts);
  db.exec("ROLLBACK");
});

test("revoked and throwing Proxy inputs return stable errors before SQL or fact changes", (t) => {
  const { db, store } = fixture(t);
  begin(db);
  store.insert(record());
  const beforeReceipts = rows(db);
  const beforeAudit = auditRows(db);
  const hostile = [
    (value) => {
      const handle = Proxy.revocable(value, {});
      handle.revoke();
      return handle.proxy;
    },
    (value) => new Proxy(value, { ownKeys() { throw Error("private ownKeys"); } }),
    (value) => new Proxy(value, {
      getOwnPropertyDescriptor() { throw Error("private getOwnPropertyDescriptor"); }
    })
  ];
  const nativePrepare = db.prepare;
  const nativeExec = db.exec;
  let sqlCalls = 0;
  db.prepare = function (...args) {
    sqlCalls += 1;
    return nativePrepare.apply(this, args);
  };
  db.exec = function (...args) {
    sqlCalls += 1;
    return nativeExec.apply(this, args);
  };
  try {
    for (const makeHostile of hostile) {
      fails(() => createGs03ReceiptStore(makeHostile({ environment: "test", db, namespaceDigest: NAMESPACE_A })),
        "GS03_RECEIPT_STORE_ADMISSION");
      fails(() => store.lookup(makeHostile(selector())), "GS03_RECEIPT_STORE_INPUT");
      fails(() => store.insert(makeHostile(record({ receipt_id: "receipt-synthetic-2", key_digest: KEY_B }))),
        "GS03_RECEIPT_STORE_INPUT");
      assert.equal(sqlCalls, 0);
    }
  } finally {
    db.prepare = nativePrepare;
    db.exec = nativeExec;
  }
  assert.deepEqual(rows(db), beforeReceipts);
  assert.deepEqual(auditRows(db), beforeAudit);
  assert.equal(db.isTransaction, true);
  db.exec("ROLLBACK");
});

test("every selector and record field enforces S1 types, bytes and exact enums", (t) => {
  const { db, store } = fixture(t);
  begin(db);
  const badSelector = [
    ["contract_id", "unknown-contract"], ["contract_version", 1], ["contract_version", "2"],
    ["key_digest", "A".repeat(64)], ["key_digest", "a".repeat(63)],
    ["target_id", "\u0085case"], ["target_id", "x\0y"], ["target_id", "\ud800"],
    ["target_id", "é".repeat(121)], ["authorization_id", "\udc00"],
    ["authorization_id", "\u00a0auth"], ["authorization_id", "x".repeat(241)],
    ["intent_digest_version", 1], ["intent_digest_version", "2"],
    ["intent_digest", "g".repeat(64)], ["intent_digest", "f".repeat(65)]
  ];
  for (const [field, value] of badSelector) {
    fails(() => store.lookup(selector({ [field]: value })), "GS03_RECEIPT_STORE_INPUT");
    fails(() => store.insert(record({ [field]: value })), "GS03_RECEIPT_STORE_INPUT");
    assert.deepEqual(rows(db), []);
  }
  const badRecord = [
    ["receipt_id", ""], ["receipt_id", "\u0085receipt"], ["receipt_id", "\ud800"],
    ["receipt_id", "é".repeat(65)], ["result_status", "pending"],
    ["recorded_at_ms", -1], ["recorded_at_ms", 8640000000000001],
    ["recorded_at_ms", 1.5], ["recorded_at_ms", "1791417600000"],
    ["security_stream", "dataAccessLogs"], ["access_stream", "securityEvents"],
    ["security_audit_event_id", "\0security"], ["security_audit_event_id", "\udfff"],
    ["security_audit_event_id", "é".repeat(121)],
    ["access_audit_event_id", "access\u0085"], ["access_audit_event_id", "\ud800"],
    ["access_audit_event_id", "x".repeat(241)]
  ];
  for (const [field, value] of badRecord) {
    fails(() => store.insert(record({ [field]: value })), "GS03_RECEIPT_STORE_INPUT");
    assert.deepEqual(rows(db), []);
  }
  for (const [field, byteLimit] of [
    ["receipt_id", 128], ["target_id", 240], ["authorization_id", 240],
    ["security_audit_event_id", 240], ["access_audit_event_id", 240]
  ]) {
    for (const value of ["", " leading", "trailing ", "\u0085leading", "trailing\u0085",
      "prefix\0suffix", "\ud800", "\udc00", "é".repeat(Math.floor(byteLimit / 2) + 1)]) {
      fails(() => store.insert(record({ [field]: value })), "GS03_RECEIPT_STORE_INPUT");
      if (SELECTOR_FIELDS.includes(field)) {
        fails(() => store.lookup(selector({ [field]: value })), "GS03_RECEIPT_STORE_INPUT");
      }
      assert.deepEqual(rows(db), []);
    }
  }
  db.exec("ROLLBACK");
});

test("digest lengths are exact, including LF, CRLF and U+2028 suffixes", (t) => {
  const { db, store } = fixture(t);
  for (const suffix of ["\n", "\r\n", "\u2028"]) {
    fails(() => createGs03ReceiptStore({ environment: "test", db, namespaceDigest: NAMESPACE_A + suffix }),
      "GS03_RECEIPT_STORE_ADMISSION");
  }
  begin(db);
  const before = rows(db);
  for (const field of ["key_digest", "intent_digest"]) {
    for (const suffix of ["\n", "\r\n", "\u2028"]) {
      const value = (field === "key_digest" ? KEY_A : INTENT_A) + suffix;
      fails(() => store.lookup(selector({ [field]: value })), "GS03_RECEIPT_STORE_INPUT");
      fails(() => store.insert(record({ [field]: value })), "GS03_RECEIPT_STORE_INPUT");
      assert.deepEqual(rows(db), before);
    }
  }
  db.exec("ROLLBACK");
});

test("exact UTF-8 ID byte limits and timestamp endpoints can be staged against real audit parents", (t) => {
  const { db, store } = fixture(t);
  const longSecurityId = "é".repeat(120);
  const longAccessId = "à".repeat(120);
  const state = auditState(["security-synthetic-1", longSecurityId], ["access-synthetic-1", longAccessId]);
  const added = appendAuditDeliverySourceChanges(db, auditState(), state, { recordedAt: AT });
  assert.equal(added.inserted, 2);
  begin(db);
  const edge = record({ receipt_id: "é".repeat(64), key_digest: KEY_B,
    target_id: "é".repeat(120), authorization_id: "à".repeat(120),
    security_audit_event_id: longSecurityId, access_audit_event_id: longAccessId, recorded_at_ms: 0 });
  assert.deepEqual(store.insert(edge), { status: "staged", productionReady: false });
  assert.deepEqual(store.lookup(selector({ key_digest: KEY_B, target_id: edge.target_id,
    authorization_id: edge.authorization_id })), {
    status: "matched", receipt: { receiptId: edge.receipt_id, recordedAtMs: 0 }, productionReady: false
  });
  const maxTime = record({ receipt_id: "receipt-synthetic-max-time", recorded_at_ms: 8640000000000000 });
  assert.deepEqual(store.insert(maxTime), { status: "staged", productionReady: false });
  assert.equal(rows(db).length, 2);
  db.exec("ROLLBACK");
});

test("operations fail outside a live transaction and after closing the caller connection", (t) => {
  const { db, store } = fixture(t);
  fails(() => store.lookup(selector()), "GS03_RECEIPT_STORE_UNAVAILABLE");
  fails(() => store.insert(record()), "GS03_RECEIPT_STORE_UNAVAILABLE");
  begin(db);
  assert.deepEqual(store.lookup(selector()), { status: "absent", productionReady: false });
  db.exec("COMMIT");
  fails(() => store.lookup(selector()), "GS03_RECEIPT_STORE_UNAVAILABLE");
  begin(db);
  db.exec("ROLLBACK");
  fails(() => store.insert(record()), "GS03_RECEIPT_STORE_UNAVAILABLE");
  assert.deepEqual(rows(db), []);
  db.close();
  fails(() => store.lookup(selector()), "GS03_RECEIPT_STORE_UNAVAILABLE");
  fails(() => store.insert(record()), "GS03_RECEIPT_STORE_UNAVAILABLE");
});

test("schema drift and disabled foreign keys reject both operations", (t) => {
  const first = fixture(t);
  first.db.exec("DROP TRIGGER main.gs03_callback_receipts_no_update");
  begin(first.db);
  fails(() => first.store.lookup(selector()), "GS03_RECEIPT_STORE_UNAVAILABLE");
  fails(() => first.store.insert(record()), "GS03_RECEIPT_STORE_UNAVAILABLE");
  assert.deepEqual(rows(first.db), []);
  first.db.exec("ROLLBACK");

  const second = fixture(t);
  second.db.exec("PRAGMA foreign_keys=OFF");
  begin(second.db);
  fails(() => second.store.lookup(selector()), "GS03_RECEIPT_STORE_UNAVAILABLE");
  fails(() => second.store.insert(record()), "GS03_RECEIPT_STORE_UNAVAILABLE");
  assert.deepEqual(rows(second.db), []);
  second.db.exec("ROLLBACK");
});

test("an empty TEMP schema is accepted, while TEMP objects and attached databases are rejected", (t) => {
  const empty = fixture(t);
  assert.deepEqual(empty.db.prepare("SELECT * FROM temp.sqlite_master").all(), []);
  begin(empty.db);
  assert.deepEqual(empty.store.lookup(selector()), { status: "absent", productionReady: false });
  empty.db.exec("ROLLBACK");

  const trigger = fixture(t);
  trigger.db.exec(`CREATE TEMP TRIGGER synthetic_ignore BEFORE INSERT ON main.gs03_callback_receipts
    BEGIN SELECT RAISE(IGNORE); END`);
  begin(trigger.db);
  fails(() => trigger.store.lookup(selector()), "GS03_RECEIPT_STORE_UNAVAILABLE");
  fails(() => trigger.store.insert(record()), "GS03_RECEIPT_STORE_UNAVAILABLE");
  assert.deepEqual(rows(trigger.db), []);
  trigger.db.exec("ROLLBACK");

  const shadow = fixture(t);
  shadow.db.exec("CREATE TEMP TABLE gs03_callback_receipts(receipt_id TEXT)");
  begin(shadow.db);
  fails(() => shadow.store.lookup(selector()), "GS03_RECEIPT_STORE_UNAVAILABLE");
  fails(() => shadow.store.insert(record()), "GS03_RECEIPT_STORE_UNAVAILABLE");
  assert.deepEqual(rows(shadow.db), []);
  shadow.db.exec("ROLLBACK");

  const attached = fixture(t);
  attached.db.exec("ATTACH ':memory:' AS other");
  begin(attached.db);
  fails(() => attached.store.lookup(selector()), "GS03_RECEIPT_STORE_UNAVAILABLE");
  fails(() => attached.store.insert(record()), "GS03_RECEIPT_STORE_UNAVAILABLE");
  assert.deepEqual(rows(attached.db), []);
  attached.db.exec("ROLLBACK");
});

test("S1 prevents UPDATE, DELETE and REPLACE of an inserted receipt", (t) => {
  const { db, store } = fixture(t);
  begin(db);
  store.insert(record());
  const before = rows(db);
  assert.throws(() => db.prepare("UPDATE main.gs03_callback_receipts SET result_status=result_status WHERE receipt_id=?")
    .run("receipt-synthetic-1"));
  assert.deepEqual(rows(db), before);
  assert.throws(() => db.prepare("DELETE FROM main.gs03_callback_receipts WHERE receipt_id=?")
    .run("receipt-synthetic-1"));
  assert.deepEqual(rows(db), before);
  assert.throws(() => db.prepare(`INSERT OR REPLACE INTO main.gs03_callback_receipts
    SELECT * FROM main.gs03_callback_receipts WHERE receipt_id=?`).run("receipt-synthetic-1"));
  assert.deepEqual(rows(db), before);
  db.exec("ROLLBACK");
});

test("caller rollback removes its real v15 audit parents and S1 receipt while preserving prior committed history", (t) => {
  const { db, store } = fixture(t);
  begin(db);
  store.insert(record());
  db.exec("COMMIT");
  const committedReceipts = rows(db);
  const committedAudit = auditRows(db);

  begin(db);
  const next = auditState(["security-synthetic-1", "security-synthetic-2"],
    ["access-synthetic-1", "access-synthetic-2"]);
  assert.equal(appendAuditDeliverySourceChanges(db, auditState(), next, { recordedAt: AT }).inserted, 2);
  const added = record({ receipt_id: "receipt-synthetic-2", key_digest: KEY_B,
    security_audit_event_id: "security-synthetic-2", access_audit_event_id: "access-synthetic-2" });
  assert.deepEqual(store.insert(added), { status: "staged", productionReady: false });
  assert.equal(rows(db).length, 2);
  assert.equal(auditRows(db).length, committedAudit.length + 2);
  db.exec("ROLLBACK");
  assert.deepEqual(rows(db), committedReceipts);
  assert.deepEqual(auditRows(db), committedAudit);
  begin(db);
  assert.deepEqual(store.lookup(selector()), {
    status: "matched", receipt: { receiptId: "receipt-synthetic-1", recordedAtMs: 1791417600000 },
    productionReady: false
  });
  assert.deepEqual(store.lookup(selector({ key_digest: KEY_B })), { status: "absent", productionReady: false });
  db.exec("ROLLBACK");
});
