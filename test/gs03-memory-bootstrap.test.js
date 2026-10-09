"use strict";

// GOV-037/OPS-056: internally owned, synthetic :memory: evidence only.
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { auditHashFor } = require("../src/identity-security/audit-chain");
const {
  appendAuditDeliverySourceChanges, buildAuditDeliverySourceCandidate, auditSourceHash
} = require("../src/identity-security/audit-delivery-source");
const {
  SQLITE_MIGRATIONS, SQLITE_SCHEMA_HEAD, applySqliteMigrations,
  readSqliteSchemaFingerprint, validateSqliteMigrationRegistry
} = require("../src/platform/storage/sqlite-migrations");
const {
  GS03_CALLBACK_RECEIPT_MIGRATION, verifyGs03CallbackReceiptSchema
} = require("../src/platform/storage/gs03-callback-receipt-migration");
const {
  createGs03MemoryTransactionSession, createGs03MigratedMemoryTransactionSession
} = require("../src/platform/storage/gs03-memory-transaction");
const { createGs03ReceiptStore } = require("../src/platform/storage/gs03-receipt-store");
const { runGs03Transaction } = require("../src/platform/storage/gs03-transaction-outcome");

const AT = "2026-10-09T00:00:00.000Z";
const NAMESPACE = "a".repeat(64);
const KEY_A = "b".repeat(64);
const KEY_B = "c".repeat(64);
const INTENT_A = "d".repeat(64);
const INTENT_B = "e".repeat(64);
const CONTRACT = "referral-feedback-callback";

function rows(db, sql) {
  return db.prepare(sql).all().map((row) => ({ ...row }));
}

function ledger(db) {
  return rows(db, "SELECT version,name,checksum,applied_at FROM main.schema_migrations ORDER BY version");
}

function schema(db) {
  return rows(db, `SELECT type,name,tbl_name,sql FROM main.sqlite_master
    WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name,tbl_name,sql`);
}

function inspect(db) {
  return {
    fingerprint: readSqliteSchemaFingerprint(db),
    schema: schema(db),
    ledger: ledger(db),
    foreignKeys: db.prepare("PRAGMA foreign_keys").get().foreign_keys,
    databases: rows(db, "PRAGMA database_list").map((row) => row.name),
    transactionOpen: db.isTransaction,
    s1: verifyGs03CallbackReceiptSchema(db)
  };
}

async function throughPort(session, read) {
  let observed;
  const result = await runGs03Transaction({ environment: "test", port: session.createPort({
    apply(db) { observed = read(db); return "replay"; },
    verify: () => true
  }) });
  assert.deepEqual(result, { status: "confirmed-replay", phase: "commit", productionReady: false });
  return observed;
}

function facts(db) {
  return {
    state: rows(db, "SELECT key,payload,updated_at,version FROM main.state_collections WHERE key LIKE 'gs03-bootstrap-%' ORDER BY key"),
    source: rows(db, "SELECT * FROM main.audit_delivery_source_events ORDER BY sequence"),
    receipts: rows(db, "SELECT * FROM main.gs03_callback_receipts ORDER BY receipt_id")
  };
}

function event(id, action, target, receiptId, intentDigest, access) {
  const body = {
    id, at: AT, action, role: "synthetic", result: "allowed", actor: "synthetic-bootstrap-actor",
    authorizationId: "synthetic-authorization", receiptId, intentDigest,
    ...(access ? { scope: target } : { target }), previousAuditHash: ""
  };
  return { ...body, auditHash: auditHashFor(body) };
}

function operation(session, keyDigest, intentDigest, {
  failAfterReceipt = false, lostCommitResponse = false, targetOverride
} = {}) {
  const suffix = keyDigest === KEY_A ? "a" : "b";
  const target = targetOverride || `gs03-bootstrap-${suffix}`;
  const receiptId = `synthetic-bootstrap-receipt-${suffix}`;
  const securityId = `synthetic-bootstrap-security-${suffix}`;
  const accessId = `synthetic-bootstrap-access-${suffix}`;
  const selector = {
    contract_id: CONTRACT, contract_version: 2, key_digest: keyDigest, target_id: target,
    authorization_id: "synthetic-authorization", intent_digest_version: 2, intent_digest: intentDigest
  };
  const security = event(securityId, CONTRACT, target, receiptId, intentDigest, false);
  const access = event(accessId, "data-access", target, receiptId, intentDigest, true);
  let connection;
  const inner = session.createPort({
    apply(db) {
      connection = db; // Trusted test callback: observation only after completion.
      const store = createGs03ReceiptStore({ environment: "test", db, namespaceDigest: NAMESPACE });
      const found = store.lookup(selector);
      if (found.status === "matched") {
        assert.deepEqual(found.receipt, { receiptId, recordedAtMs: Date.parse(AT) });
        return "replay";
      }
      assert.equal(found.status, "absent");
      db.prepare(`INSERT INTO main.state_collections(key,payload,updated_at,version) VALUES(?,?,?,1)
        ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at,
          version=state_collections.version+1`)
        .run(target, JSON.stringify({ intentDigest }), AT);
      const appended = appendAuditDeliverySourceChanges(db, {}, {
        securityEvents: [security], dataAccessLogs: [access]
      }, { recordedAt: AT });
      assert.equal(appended.inserted, 2);
      assert.deepEqual(store.insert({
        receipt_id: receiptId, ...selector, result_status: "committed", recorded_at_ms: Date.parse(AT),
        security_stream: "securityEvents", security_audit_event_id: securityId,
        access_stream: "dataAccessLogs", access_audit_event_id: accessId
      }), { status: "staged", productionReady: false });
      if (failAfterReceipt) throw new Error("private synthetic rollback marker");
      return "first";
    },
    verify(db) {
      const view = facts(db);
      return view.state.some((row) => row.key === target && row.payload === JSON.stringify({ intentDigest })) &&
        view.source.some((row) => row.stream === "securityEvents" && row.source_event_id === securityId) &&
        view.source.some((row) => row.stream === "dataAccessLogs" && row.source_event_id === accessId) &&
        view.receipts.some((row) => row.receipt_id === receiptId && row.key_digest === keyDigest);
    }
  });
  const port = lostCommitResponse ? Object.freeze({
    begin: () => inner.begin(), apply: () => inner.apply(), verify: () => inner.verify(),
    commit() { inner.commit(); throw new Error("private response lost after native COMMIT"); },
    rollback: () => inner.rollback()
  }) : inner;
  return { port, observe: () => facts(connection), security, access, selector, receiptId };
}

function assertSourceFact(row, stream, auditEvent, previousHash) {
  const candidate = buildAuditDeliverySourceCandidate(stream, auditEvent);
  const digest = (label, value) => createHash("sha256").update(`${label}:${value}`).digest("hex");
  const access = stream === "dataAccessLogs";
  const expectedProjection = {
    schemaVersion: "audit-delivery-minimal-projection-v1", stream,
    sourceEventId: auditEvent.id, occurredAt: AT,
    classification: access ? "restricted-data-access" : "security-event",
    action: access ? "data-access" : CONTRACT, result: "allowed", role: "synthetic",
    actorRefDigest: digest("actor", "synthetic-bootstrap-actor"), subjectRefDigest: "",
    targetRefDigest: digest("target", access ? auditEvent.scope : auditEvent.target)
  };
  assert.equal(row.stream, stream);
  assert.equal(row.source_event_id, auditEvent.id);
  assert.equal(row.occurred_at, AT);
  assert.equal(row.source_digest, candidate.sourceDigest);
  assert.equal(row.projection_schema, "audit-delivery-minimal-projection-v1");
  assert.equal(row.projection_json, candidate.projectionJson);
  assert.deepEqual(JSON.parse(row.projection_json), expectedProjection);
  assert.equal(row.projection_digest, candidate.projectionDigest);
  assert.equal(row.previous_source_hash, previousHash);
  assert.equal(row.historical_baseline, 0);
  assert.equal(row.recorded_at, AT);
  assert.equal(row.source_hash, auditSourceHash({
    sequence: row.sequence, stream, sourceEventId: auditEvent.id, occurredAt: AT,
    sourceDigest: candidate.sourceDigest, projectionDigest: candidate.projectionDigest,
    previousSourceHash: previousHash, historicalBaseline: false, recordedAt: AT
  }));
  assert.deepEqual(candidate.projection, expectedProjection);
}

test("explicit bootstrap matches an independent real 20-migration runner and preserves default head", async (t) => {
  assert.equal(SQLITE_SCHEMA_HEAD, 19);
  assert.deepEqual(SQLITE_MIGRATIONS.map((migration) => migration.version),
    Array.from({ length: 19 }, (_, index) => index + 1));
  assert.equal(GS03_CALLBACK_RECEIPT_MIGRATION.version, 20);
  assert.equal(SQLITE_MIGRATIONS.includes(GS03_CALLBACK_RECEIPT_MIGRATION), false);
  const expectedRegistry = validateSqliteMigrationRegistry([...SQLITE_MIGRATIONS, GS03_CALLBACK_RECEIPT_MIGRATION]);
  assert.equal(expectedRegistry.head, 20);
  const reference = new DatabaseSync(":memory:");
  t.after(() => reference.close());
  reference.exec("PRAGMA foreign_keys=ON");
  const first = applySqliteMigrations(reference, {
    migrations: [...SQLITE_MIGRATIONS, GS03_CALLBACK_RECEIPT_MIGRATION]
  });
  assert.equal(first.applied, 20);
  assert.equal(first.registryFingerprint, expectedRegistry.registryFingerprint);
  const referenceView = inspect(reference);
  const repeated = applySqliteMigrations(reference, {
    migrations: [...SQLITE_MIGRATIONS, GS03_CALLBACK_RECEIPT_MIGRATION]
  });
  assert.deepEqual(repeated, {
    head: 20, applied: 0, registryFingerprint: first.registryFingerprint
  });
  assert.deepEqual(inspect(reference), referenceView);
  const session = createGs03MigratedMemoryTransactionSession({ environment: "test" });
  t.after(() => session.close());
  assert.deepEqual(Object.keys(session).sort(), ["close", "createPort", "productionReady"]);
  assert.equal(Object.isFrozen(session), true);
  assert.equal(session.productionReady, false);
  const actual = await throughPort(session, inspect);
  assert.deepEqual(actual.schema, referenceView.schema);
  assert.equal(actual.schema.filter((item) => item.type === "table").length, 42);
  assert.equal(actual.fingerprint, referenceView.fingerprint);
  assert.deepEqual(actual.ledger.map(({ applied_at: _at, ...row }) => row),
    referenceView.ledger.map(({ applied_at: _at, ...row }) => row));
  assert.equal(actual.ledger.length, 20);
  for (const row of actual.ledger) {
    assert.match(row.applied_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    assert.equal(Number.isNaN(Date.parse(row.applied_at)), false);
  }
  assert.equal(actual.foreignKeys, 1);
  assert.deepEqual(actual.databases, ["main"]);
  assert.equal(actual.transactionOpen, true); // Inspection occurs within its owned callback.
  assert.equal(actual.s1, true);
  assert.deepEqual(await throughPort(session, inspect), actual, "new ports must not rerun migration or rewrite ledger");
  const old = createGs03MemoryTransactionSession({ environment: "test" });
  t.after(() => old.close());
  assert.equal((await throughPort(old, (db) => rows(db, "PRAGMA database_list").map((row) => row.name)))[0], "main");
  assert.equal(await throughPort(old, (db) => rows(db,
    "SELECT name FROM main.sqlite_master WHERE name='schema_migrations' OR name='gs03_callback_receipts'"))
    .then((value) => value.length), 0, "legacy factory remains an empty database");
});

test("fresh bootstraps are isolated and receipt/source first, replay, rollback retain exact facts", async (t) => {
  const left = createGs03MigratedMemoryTransactionSession({ environment: "development" });
  const right = createGs03MigratedMemoryTransactionSession({ environment: "test" });
  t.after(() => { left.close(); right.close(); });
  assert.deepEqual(await throughPort(left, facts), { state: [], source: [], receipts: [] });
  assert.deepEqual(await throughPort(right, facts), { state: [], source: [], receipts: [] });
  const first = operation(left, KEY_A, INTENT_A);
  assert.deepEqual(await runGs03Transaction({ environment: "test", port: first.port }),
    { status: "confirmed-first", phase: "commit", productionReady: false });
  const committed = first.observe();
  assert.deepEqual(committed.state, [{
    key: "gs03-bootstrap-a", payload: JSON.stringify({ intentDigest: INTENT_A }), updated_at: AT, version: 1
  }]);
  assert.deepEqual(committed.receipts, [{
    receipt_id: first.receiptId, namespace_digest: NAMESPACE, ...first.selector,
    result_status: "committed", recorded_at_ms: Date.parse(AT),
    security_stream: "securityEvents", security_audit_event_id: first.security.id,
    access_stream: "dataAccessLogs", access_audit_event_id: first.access.id
  }]);
  assert.equal(committed.source.length, 2);
  for (const [index, row] of committed.source.entries()) {
    assert.equal(row.sequence, index + 1);
    assertSourceFact(row, row.stream, row.stream === "securityEvents" ? first.security : first.access,
      index === 0 ? "" : committed.source[index - 1].source_hash);
  }
  const replay = operation(left, KEY_A, INTENT_A);
  assert.deepEqual(await runGs03Transaction({ environment: "test", port: replay.port }),
    { status: "confirmed-replay", phase: "commit", productionReady: false });
  assert.deepEqual(replay.observe(), committed);
  const failed = operation(left, KEY_B, INTENT_B, {
    failAfterReceipt: true, targetOverride: "gs03-bootstrap-a"
  });
  assert.deepEqual(await runGs03Transaction({ environment: "test", port: failed.port }),
    { status: "rolled-back", phase: "apply", productionReady: false });
  assert.deepEqual(failed.observe(), committed,
    "same-target version 2 and all staged v15 source/S1 receipt must roll back to version 1 history");
  assert.deepEqual(await throughPort(right, facts), { state: [], source: [], receipts: [] });
  assert.deepEqual(await throughPort(left, facts), committed);
});

test("native COMMIT followed by lost wrapper response keeps facts but isolates subsequent ports", async (t) => {
  const session = createGs03MigratedMemoryTransactionSession({ environment: "test" });
  t.after(() => session.close());
  const lost = operation(session, KEY_A, INTENT_A, { lostCommitResponse: true });
  assert.deepEqual(await runGs03Transaction({ environment: "test", port: lost.port }),
    { status: "unknown", phase: "commit", productionReady: false });
  const committed = lost.observe();
  assert.equal(committed.state.length, 1);
  assert.equal(committed.source.length, 2);
  assert.equal(committed.receipts.length, 1);
  const later = operation(session, KEY_B, INTENT_B);
  assert.deepEqual(await runGs03Transaction({ environment: "test", port: later.port }),
    { status: "unknown", phase: "begin", productionReady: false });
  assert.deepEqual(lost.observe(), committed);
  assert.equal(session.close(), true);
  assert.throws(() => session.createPort({ apply: () => "replay", verify: () => true }),
    { code: "GS03_MEMORY_CLOSED" });
});

test("migrated factory rejects production and non-exact input", () => {
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  for (const options of [undefined, null, {}, { environment: "production" },
    { environment: "test", db: {} }, { environment: "test", path: ":memory:" },
    { environment: "test", initialize() {} }, { environment: "test", migrations: [] },
    { get environment() { throw new Error("private value"); } }, revoked.proxy]) {
    assert.throws(() => createGs03MigratedMemoryTransactionSession(options), (error) =>
      error.code === "GS03_MEMORY_ADMISSION" && error.message === error.code &&
      !Object.hasOwn(error, "cause"));
  }
});

const adapterPath = require.resolve("../src/platform/storage/gs03-memory-transaction");
const injectionScript = `
  const Module = require('node:module');
  const { DatabaseSync } = require('node:sqlite');
  const adapterPath = ${JSON.stringify(adapterPath)};
  const kind = process.argv[1];
  const originalLoad = Module._load;
  const prior = require.cache[adapterPath];
  let closes = 0;
  let nativeCloses = 0;
  let applyCalls = 0;
  class TrackedDatabase extends DatabaseSync {
    constructor(name) {
      super(name);
      if (name !== ':memory:') throw Error('wrong database target');
      if (kind === 'initial-transaction') super.exec('BEGIN IMMEDIATE');
      if (kind === 'foreign-keys-off') super.exec('PRAGMA foreign_keys=OFF');
      if (kind === 'initial-attach') super.exec("ATTACH ':memory:' AS private_extra");
      if (kind === 'initial-temp') super.exec('CREATE TEMP TABLE private_shadow(id INTEGER)');
    }
    exec(sql) {
      if (kind === 'foreign-keys-off' && sql === 'PRAGMA foreign_keys=ON') return;
      return super.exec(sql);
    }
    close() {
      closes += 1;
      if (kind === 'cleanup-fails') throw Error('private cleanup failure');
      const result = super.close();
      nativeCloses += 1;
      return result;
    }
  }
  try {
    Module._load = function (request, parent, isMain) {
      if (request === 'node:sqlite' && parent?.filename === adapterPath)
        return { DatabaseSync: TrackedDatabase };
      const loaded = originalLoad.call(this, request, parent, isMain);
      if (parent?.filename === adapterPath && request === './sqlite-migrations') {
        if (kind === 'head-drift') return { ...loaded, SQLITE_SCHEMA_HEAD: 18 };
        if (kind === 'registry-drift') return { ...loaded, SQLITE_MIGRATIONS: loaded.SQLITE_MIGRATIONS.slice(1) };
        if (kind === 'migration-throws' || kind === 'cleanup-fails' || kind === 'first-result' ||
            kind === 's1-drift' || kind === 'rerun-s1-drift' || kind === 'rerun-result' ||
            kind === 'rerun-fingerprint' || kind === 'rerun-ledger' || kind === 'rerun-attach' ||
            kind === 'rerun-temp' || kind === 'rerun-transaction') {
          return { ...loaded, applySqliteMigrations(db, options) {
            applyCalls += 1;
            if (kind === 'migration-throws' || kind === 'cleanup-fails')
              throw Error('private migration sql and path');
            const result = loaded.applySqliteMigrations(db, options);
            if (kind === 'first-result' && applyCalls === 1) return { ...result, applied: 19 };
            if (kind === 's1-drift' && applyCalls === 1)
              db.exec('DROP TRIGGER gs03_callback_receipts_no_update');
            if (kind === 'rerun-s1-drift' && applyCalls === 2)
              db.exec('DROP TRIGGER gs03_callback_receipts_no_update');
            if (kind === 'rerun-result' && applyCalls === 2) return { ...result, applied: 1 };
            if (kind === 'rerun-fingerprint' && applyCalls === 2)
              return { ...result, registryFingerprint: 'private-drift' };
            if (applyCalls === 2 && kind === 'rerun-ledger')
              db.exec("UPDATE schema_migrations SET applied_at='private-drift' WHERE version=20");
            if (applyCalls === 2 && kind === 'rerun-attach') db.exec("ATTACH ':memory:' AS private_extra");
            if (applyCalls === 2 && kind === 'rerun-temp') db.exec('CREATE TEMP TABLE private_shadow(id INTEGER)');
            if (applyCalls === 2 && kind === 'rerun-transaction') db.exec('BEGIN IMMEDIATE');
            return result;
          } };
        }
      }
      return loaded;
    };
    delete require.cache[adapterPath];
    const { createGs03MigratedMemoryTransactionSession } = require(adapterPath);
    let error;
    try { createGs03MigratedMemoryTransactionSession({ environment: 'test' }); }
    catch (caught) { error = caught; }
    process.stdout.write(JSON.stringify({ code: error?.code, message: error?.message,
      cause: !!error && Object.hasOwn(error, 'cause'), closes, nativeCloses, applyCalls }));
  } finally {
    Module._load = originalLoad;
    delete require.cache[adapterPath];
    if (prior) require.cache[adapterPath] = prior;
  }
`;

test("bootstrap failures close the private database and expose only stable sanitized errors", () => {
  for (const kind of ["initial-transaction", "initial-attach", "initial-temp", "foreign-keys-off",
    "head-drift", "registry-drift", "migration-throws", "first-result", "s1-drift",
    "rerun-result", "rerun-fingerprint", "rerun-s1-drift", "rerun-ledger", "rerun-attach",
    "rerun-temp", "rerun-transaction", "cleanup-fails"]) {
    const child = spawnSync(process.execPath, ["-e", injectionScript, kind], { encoding: "utf8" });
    assert.equal(child.status, 0, `${kind}: ${child.stderr}`);
    const result = JSON.parse(child.stdout);
    const code = kind === "cleanup-fails" ? "GS03_MEMORY_BOOTSTRAP_CLOSE" : "GS03_MEMORY_BOOTSTRAP";
    assert.equal(result.code, code, kind);
    assert.equal(result.message, code, kind);
    assert.equal(result.cause, false, kind);
    assert.equal(result.closes, 1, kind);
    assert.equal(result.nativeCloses, kind === "cleanup-fails" ? 0 : 1, kind);
    assert.equal(result.applyCalls, ["initial-transaction", "initial-attach", "initial-temp",
      "foreign-keys-off", "head-drift", "registry-drift"].includes(kind) ? 0 :
      ["migration-throws", "first-result", "s1-drift", "cleanup-fails"].includes(kind) ? 1 : 2, kind);
  }
});
