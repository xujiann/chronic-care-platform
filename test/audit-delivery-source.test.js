"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { auditHashFor } = require("../src/identity-security/audit-chain");
const {
  AUDIT_DELIVERY_PROJECTION_SCHEMA,
  AUDIT_DELIVERY_SOURCE_CONTRACT,
  appendAuditDeliverySourceChanges,
  readAuditDeliverySourceBatch
} = require("../src/identity-security/audit-delivery-source");
const { applySqliteMigrations } = require("../src/platform/storage/sqlite-migrations");

let DatabaseSync = null;
try {
  ({ DatabaseSync } = require("node:sqlite"));
} catch {
  // The repository requires Node >=22.5; unsupported local runtimes remain explicit.
}

function seal(rows) {
  let previousAuditHash = "";
  return rows.slice().reverse().map((row) => {
    const item = { ...row, previousAuditHash };
    item.auditHash = auditHashFor(item);
    previousAuditHash = item.auditHash;
    return item;
  }).reverse();
}

function fixtureState() {
  return {
    securityEvents: seal([{
      id: "security-001",
      at: "2026-08-22T01:00:00.000Z",
      action: "login",
      result: "allowed",
      role: "市级管理员",
      actor: "operator-account-001",
      target: "identity-console",
      detail: "sensitive free-text detail"
    }]),
    dataAccessLogs: seal([{
      id: "access-001",
      at: "2026-08-22T01:01:00.000Z",
      result: "allowed",
      role: "医务人员",
      actor: "doctor-account-001",
      personIndex: "PERSON-INDEX-SECRET",
      residentId: "RESIDENT-SECRET",
      scope: "resident-health-record",
      purpose: "sensitive free-text purpose",
      detail: "patient name and diagnosis"
    }])
  };
}

function insertStateCollections(db, state) {
  const insert = db.prepare("INSERT INTO state_collections (key, payload, updated_at, version) VALUES (?, ?, ?, 1)");
  for (const [key, value] of Object.entries(state)) {
    insert.run(key, JSON.stringify(value), "2026-08-22T02:00:00.000Z");
  }
}

test("SQLite v15 backfills only the verified current window as an immutable minimal baseline", { skip: !DatabaseSync }, () => {
  const db = new DatabaseSync(":memory:");
  try {
    applySqliteMigrations(db, { targetVersion: 14 });
    insertStateCollections(db, fixtureState());

    const result = applySqliteMigrations(db, { targetVersion: 15 });
    assert.equal(result.head, 15);
    assert.equal(result.applied, 1);

    const rows = db.prepare(`
      SELECT sequence, stream, source_event_id, source_digest, projection_schema,
             projection_json, projection_digest, previous_source_hash, source_hash,
             historical_baseline
      FROM audit_delivery_source_events
      ORDER BY sequence
    `).all();
    assert.deepEqual(rows.map((row) => Number(row.sequence)), [1, 2]);
    assert.deepEqual(rows.map((row) => row.stream), ["securityEvents", "dataAccessLogs"]);
    assert.equal(rows.every((row) => Number(row.historical_baseline) === 1), true);
    assert.equal(rows[0].previous_source_hash, "");
    assert.equal(rows[1].previous_source_hash, rows[0].source_hash);
    assert.equal(rows.every((row) => row.projection_schema === AUDIT_DELIVERY_PROJECTION_SCHEMA), true);
    assert.equal(rows.every((row) => /^[a-f0-9]{64}$/.test(row.source_digest)), true);
    assert.equal(rows.every((row) => /^[a-f0-9]{64}$/.test(row.projection_digest)), true);
    assert.equal(rows.every((row) => /^[a-f0-9]{64}$/.test(row.source_hash)), true);

    const projections = rows.map((row) => JSON.parse(row.projection_json));
    assert.equal(projections[1].classification, "restricted-data-access");
    assert.match(projections[1].subjectRefDigest, /^[a-f0-9]{64}$/);
    const serialized = JSON.stringify(projections);
    for (const forbidden of ["PERSON-INDEX-SECRET", "RESIDENT-SECRET", "sensitive free-text", "patient name", "purpose", "detail"]) {
      assert.equal(serialized.includes(forbidden), false, `${forbidden} must not enter the delivery projection`);
    }

    assert.throws(
      () => db.prepare("UPDATE audit_delivery_source_events SET occurred_at = occurred_at WHERE sequence = 1").run(),
      /append-only/
    );
    assert.throws(
      () => db.prepare("DELETE FROM audit_delivery_source_events WHERE sequence = 1").run(),
      /append-only/
    );
  } finally {
    db.close();
  }
});

test("source repository appends new IDs in the caller transaction and rejects ID content drift", { skip: !DatabaseSync }, () => {
  const db = new DatabaseSync(":memory:");
  try {
    applySqliteMigrations(db, { targetVersion: 14 });
    const previous = fixtureState();
    insertStateCollections(db, previous);
    applySqliteMigrations(db);
    const next = {
      ...previous,
      securityEvents: seal([{
        id: "security-002",
        at: "2026-08-22T01:02:00.000Z",
        action: "logout",
        result: "allowed",
        role: "市级管理员",
        actor: "operator-account-001",
        target: "identity-console"
      }, ...previous.securityEvents])
    };

    db.exec("BEGIN");
    const appended = appendAuditDeliverySourceChanges(db, previous, next, { recordedAt: "2026-08-22T02:10:00.000Z" });
    db.prepare("INSERT INTO storage_events (id, at, event, detail) VALUES (?, ?, ?, ?)")
      .run("transaction-proof", "2026-08-22T02:10:00.000Z", "test", "same transaction");
    db.exec("COMMIT");
    assert.equal(appended.inserted, 1);
    assert.equal(Number(db.prepare("SELECT COUNT(*) AS count FROM audit_delivery_source_events").get().count), 3);

    const drifted = {
      ...next,
      securityEvents: seal(next.securityEvents.map((row) => row.id === "security-002" ? { ...row, action: "changed" } : row))
    };
    db.exec("BEGIN");
    assert.throws(
      () => appendAuditDeliverySourceChanges(db, next, drifted),
      { code: "AUDIT_SOURCE_EVENT_CONFLICT" }
    );
    db.exec("ROLLBACK");
    assert.equal(Number(db.prepare("SELECT COUNT(*) AS count FROM audit_delivery_source_events").get().count), 3);

    db.exec("BEGIN");
    assert.throws(
      () => appendAuditDeliverySourceChanges(db, drifted, drifted),
      { code: "AUDIT_SOURCE_EVENT_CONFLICT" },
      "strictly resealed state must still match the immutable source digest"
    );
    db.exec("ROLLBACK");
    assert.equal(Number(db.prepare("SELECT COUNT(*) AS count FROM audit_delivery_source_events").get().count), 3);
  } finally {
    db.close();
  }
});

test("source reader consumes a validated continuous sequence from a stable cursor", { skip: !DatabaseSync }, (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "audit-source-reader-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const sqliteFile = path.join(directory, "source.sqlite");
  const db = new DatabaseSync(sqliteFile);
  try {
    applySqliteMigrations(db, { targetVersion: 14 });
    insertStateCollections(db, fixtureState());
    applySqliteMigrations(db);
  } finally {
    db.close();
  }

  const first = readAuditDeliverySourceBatch(sqliteFile, { afterCursor: 0, limit: 1 });
  assert.equal(first.contract, AUDIT_DELIVERY_SOURCE_CONTRACT);
  assert.equal(first.startCursor, 1);
  assert.equal(first.endCursor, 1);
  assert.equal(first.databaseHeadCursor, 2);
  assert.equal(first.records.length, 1);
  assert.equal(first.records[0].cursor, 1);
  assert.equal(first.records[0].record.schemaVersion, AUDIT_DELIVERY_PROJECTION_SCHEMA);

  const second = readAuditDeliverySourceBatch(sqliteFile, {
    afterCursor: first.endCursor,
    expectedSourceHeadHash: first.sourceHeadHash,
    limit: 10
  });
  assert.equal(second.startCursor, 2);
  assert.equal(second.endCursor, 2);
  assert.equal(second.records.length, 1);
  assert.throws(
    () => readAuditDeliverySourceBatch(sqliteFile, { afterCursor: 3, expectedSourceHeadHash: "0".repeat(64) }),
    { code: "AUDIT_SOURCE_CURSOR_AHEAD" }
  );
  assert.throws(
    () => readAuditDeliverySourceBatch(sqliteFile, { afterCursor: 1, expectedSourceHeadHash: "0".repeat(64) }),
    { code: "AUDIT_SOURCE_CURSOR_BINDING_MISMATCH" }
  );
});
