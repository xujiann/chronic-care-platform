"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const V2 = require("../citizen-records-v2");
const { auditHashFor, verifyAuditTrail } = require("../src/identity-security/audit-chain");
const { createResidentAccessAcknowledgementRuntime } = require("../src/http/resident-access-acknowledgement-runtime");

function fixture(t, fsOverrides = {}, overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "access-ack-runtime-"));
  const file = path.join(directory, "db.json");
  const event = { id: "event-1", residentId: "resident-1", at: "2026-09-14T00:00:00.000Z", actor: "synthetic-provider", role: "institution", scope: "record", purpose: "care", result: "拒绝", previousAuditHash: "" };
  event.auditHash = auditHashFor(event);
  const initial = { residents: [{ id: "resident-1" }], accessAcknowledgements: [], dataAccessLogs: [event], securityEvents: [] };
  fs.writeFileSync(file, JSON.stringify(initial));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const previousEnvironment = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  t.after(() => { if (previousEnvironment === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousEnvironment; });
  const command = createResidentAccessAcknowledgementRuntime({
    fs: { ...fs, ...fsOverrides }, path, DATA_DIR: directory, DB_FILE: file, STORAGE_ENGINE: "json",
    RUNTIME_STORAGE_ENGINES: new Set(["auto", "json", "sqlite"]), POSTGRES_SYNC_MODE: "disabled",
    shouldUseSqlite: () => false, loadSqliteModule: () => null, createHash, randomUUID, verifyAuditTrail,
    sessionStoreMode: () => "memory",
    runtimeSessionStore: () => ({ get: () => ({ sessionId: "session-1", user: { id: "actor-1", role: "citizen", residentId: "resident-1" } }) }),
    validateLiveSession: (session) => ({ user: session.user }),
    prependAuditTrailEntry: (rows, entry) => {
      const row = { ...entry, previousAuditHash: rows[0]?.auditHash || "" };
      row.auditHash = auditHashFor(row);
      return [row, ...rows];
    }, ...overrides
  });
  const payload = V2.buildIdempotentAction({ operation: "access-acknowledge", residentId: "resident-1", nonce: "runtime-test",
    payload: V2.buildAccessAcknowledgement({ residentId: "resident-1", accessLogId: "event-1" }) });
  const user = { id: "actor-1", role: "citizen", residentId: "resident-1" };
  const request = { user, session: { sessionId: "session-1", user }, accessLogId: "event-1", payload, idempotencyKey: payload.idempotencyKey };
  return { command: () => command(request), initial, file, directory, read: () => JSON.parse(fs.readFileSync(file, "utf8")) };
}

test("JSON runtime atomically persists one declaration and audit, then replays without replacing file", async (t) => {
  let replacements = 0;
  const h = fixture(t, { renameSync: (...args) => { replacements += 1; return fs.renameSync(...args); } });
  const first = await h.command();
  assert.equal(first.statusCode, 201);
  const persisted = fs.readFileSync(h.file);
  assert.equal(h.read().accessAcknowledgements.length, 1);
  assert.equal(h.read().securityEvents.length, 1);
  assert.deepEqual(h.read().dataAccessLogs, h.initial.dataAccessLogs);
  assert.equal(verifyAuditTrail(h.read().securityEvents).passed, true);
  assert.deepEqual((await h.command()).body, first.body);
  assert.deepEqual(fs.readFileSync(h.file), persisted);
  assert.equal(replacements, 1);
  assert.deepEqual(fs.readdirSync(h.directory), ["db.json"]);
});

for (const operation of ["writeFileSync", "fsyncSync", "renameSync"]) {
  test(`JSON ${operation} failure leaves authority bytes unchanged and removes only temporary file`, async (t) => {
    const h = fixture(t, { [operation]: () => { throw new Error("synthetic file fault"); } });
    const before = fs.readFileSync(h.file);
    await assert.rejects(h.command(), { code: "CARE_ACCESS_ACK_STORAGE_FAILED" });
    assert.deepEqual(fs.readFileSync(h.file), before);
    assert.deepEqual(fs.readdirSync(h.directory), ["db.json"]);
  });
}

for (const mutate of [
  (data) => { data.accessAcknowledgements = null; },
  (data) => { delete data.dataAccessLogs[0].auditHash; },
  (data) => { data.dataAccessLogs[0].result = "允许"; }
]) {
  test("raw JSON authority damage is rejected without repair or write", async (t) => {
    const h = fixture(t);
    const data = h.read(); mutate(data);
    fs.writeFileSync(h.file, JSON.stringify(data));
    const before = fs.readFileSync(h.file);
    await assert.rejects(h.command());
    assert.deepEqual(fs.readFileSync(h.file), before);
  });
}

for (const environment of ["production", " PRODUCTION ", "staging", "unknown"]) {
  test(`server environment ${environment} rejects writes and replays before reading authority`, async (t) => {
    const h = fixture(t);
    await h.command();
    const before = fs.readFileSync(h.file);
    process.env.NODE_ENV = environment;
    await assert.rejects(h.command());
    assert.deepEqual(fs.readFileSync(h.file), before);
  });
}

test("explicit unavailable SQLite cannot silently fall back to JSON", async (t) => {
  const h = fixture(t, {}, { STORAGE_ENGINE: "sqlite" });
  const before = fs.readFileSync(h.file);
  await assert.rejects(h.command());
  assert.deepEqual(fs.readFileSync(h.file), before);
});

test("PostgreSQL outbox configuration is outside this non-production command", async (t) => {
  const h = fixture(t, {}, { POSTGRES_SYNC_MODE: "outbox" });
  const before = fs.readFileSync(h.file);
  await assert.rejects(h.command());
  assert.deepEqual(fs.readFileSync(h.file), before);
});

test("cached PostgreSQL sessions are not accepted as synchronous revocation evidence", async (t) => {
  const h = fixture(t, {}, { sessionStoreMode: () => "postgres" });
  const before = fs.readFileSync(h.file);
  await assert.rejects(h.command(), { code: "CARE_ACCESS_ACK_STORAGE_UNSUPPORTED" });
  assert.deepEqual(fs.readFileSync(h.file), before);
});

for (const live of [null, { sessionId: "session-1", user: { id: "actor-1", role: "citizen", residentId: "different-resident" } }]) {
  test("revoked or rebound live session cannot commit using the request snapshot", async (t) => {
    const h = fixture(t, {}, { runtimeSessionStore: () => ({ get: () => live }) });
    const before = fs.readFileSync(h.file);
    await assert.rejects(h.command(), { code: "CARE_ACCESS_ACK_FORBIDDEN" });
    assert.deepEqual(fs.readFileSync(h.file), before);
  });
}

test("a JSON writer after the authority snapshot is preserved and causes an explicit conflict", async (t) => {
  let h;
  h = fixture(t, {}, { validateLiveSession: (session) => {
    const changed = h.read();
    changed.concurrentWriterMarker = "synthetic-change";
    fs.writeFileSync(h.file, JSON.stringify(changed));
    return { user: session.user };
  } });
  await assert.rejects(h.command(), { code: "CARE_ACCESS_ACK_STORAGE_CONFLICT" });
  assert.equal(h.read().concurrentWriterMarker, "synthetic-change");
  assert.deepEqual(h.read().accessAcknowledgements, []);
  assert.deepEqual(h.read().securityEvents, []);
  assert.deepEqual(fs.readdirSync(h.directory), ["db.json"]);
});
