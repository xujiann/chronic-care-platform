"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { createHash } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const V2 = require("../citizen-records-v2");
const { auditHashFor } = require("../src/identity-security/audit-chain");

const ROOT = path.resolve(__dirname, "..");
const digest = (value) => createHash("sha256").update(String(value)).digest("hex");

test("access acknowledgement uses real HTTP, raw SQLite identity, CAS and atomic rollback", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "access-ack-http-"));
  fs.copyFileSync(path.join(ROOT, "data/db.json"), path.join(directory, "db.json"));
  const previous = Object.fromEntries(["DATA_DIR", "STORAGE_ENGINE", "NODE_ENV", "POSTGRES_SYNC_MODE"].map((key) => [key, process.env[key]]));
  Object.assign(process.env, { DATA_DIR: directory, STORAGE_ENGINE: "sqlite", NODE_ENV: "test", POSTGRES_SYNC_MODE: "disabled" });
  const runtime = require("../server");
  runtime.startServer(0);
  await once(runtime.server, "listening");
  const base = `http://127.0.0.1:${runtime.server.address().port}`;
  const dbFile = path.join(directory, "health-city.sqlite");
  t.after(async () => {
    await runtime.stopServer();
    fs.rmSync(directory, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const database = (work) => {
    const db = new DatabaseSync(dbFile);
    try { return work(db); } finally { db.close(); }
  };
  const raw = () => database((db) => Object.fromEntries(db.prepare("SELECT key, payload FROM state_collections").all().map((row) => [row.key, JSON.parse(row.payload)])));
  const replaceFixture = (key, value) => database((db) => db.prepare("UPDATE state_collections SET payload = ?, version = version + 1 WHERE key = ?").run(JSON.stringify(value), key));
  const snapshot = () => database((db) => ({
    rows: db.prepare("SELECT key, payload, version FROM state_collections WHERE key IN ('accessAcknowledgements','securityEvents','dataAccessLogs','personalRecords') ORDER BY key").all(),
    sources: db.prepare("SELECT * FROM audit_delivery_source_events ORDER BY sequence").all()
  }));
  const api = async (pathname, token = "", options = {}) => {
    const response = await fetch(`${base}${pathname}`, { ...options, headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {})
    } });
    return { status: response.status, body: await response.json() };
  };
  const login = async (username) => {
    const result = await api("/api/auth/login", "", { method: "POST", body: JSON.stringify({ username, password: "123456" }) });
    assert.equal(result.status, 200);
    return result.body.token;
  };
  const citizen = await login("citizen");
  const manager = await login("city");
  const institution = await login("hospital");
  const logs = raw().dataAccessLogs;
  const ownEvents = logs.filter((row) => row.residentId === "r1");
  const otherEvent = logs.find((row) => row.residentId !== "r1");
  assert.ok(ownEvents.length >= 2 && otherEvent);
  const envelope = (eventId, nonce = "first", residentId = "r1") => V2.buildIdempotentAction({
    operation: "access-acknowledge", residentId, nonce, requestedAt: "2026-09-14T10:00:00.000Z",
    payload: V2.buildAccessAcknowledgement({ residentId, accessLogId: eventId, acknowledgedAt: "2026-09-14T09:00:00.000Z" })
  });
  const firstPayload = envelope(ownEvents[0].id);
  const post = (payload, token = citizen, eventId = payload.accessLogId) => api(`/api/access-reviews/${encodeURIComponent(eventId)}/acknowledge`, token, {
    method: "POST", headers: { "Idempotency-Key": payload.idempotencyKey }, body: JSON.stringify(payload)
  });
  let firstReceipt;

  await t.test("auth precedes parsing and only the event subject can declare", async () => {
    const before = snapshot();
    const unauthenticated = await api(`/api/access-reviews/${encodeURIComponent(ownEvents[0].id)}/acknowledge`, "", { method: "POST", body: "{" });
    assert.equal(unauthenticated.status, 401);
    for (const token of [manager, institution]) assert.equal((await post(firstPayload, token)).status, 403);
    assert.equal((await post(envelope(otherEvent.id, "proxy", otherEvent.residentId))).status, 403);
    assert.deepEqual(snapshot(), before);
  });

  await t.test("self success persists server receipt without changing original audit or authorization", async () => {
    const before = raw();
    const result = await post(firstPayload);
    assert.equal(result.status, 201, JSON.stringify(result.body));
    firstReceipt = result.body;
    assert.notEqual(result.body.id, firstPayload.id);
    assert.notEqual(result.body.acknowledgedAt, firstPayload.acknowledgedAt);
    const projected = V2.projectAccessAcknowledgementReceipt(result.body, firstPayload);
    assert.equal(projected.id, result.body.id);
    assert.equal(projected.acknowledgedAt, result.body.acknowledgedAt);
    const after = raw();
    assert.equal(after.accessAcknowledgements.length, before.accessAcknowledgements.length + 1);
    assert.deepEqual(after.dataAccessLogs, before.dataAccessLogs);
    assert.deepEqual(after.personalRecords, before.personalRecords);
    assert.equal(after.securityEvents.filter((row) => row.id === result.body.auditRef).length, 1);
    assert.equal(database((db) => db.prepare("SELECT COUNT(*) AS n FROM audit_delivery_source_events WHERE source_event_id = ?").get(result.body.auditRef).n), 1);
    for (const key of ["actorId", "idempotencyKeyHash", "requestDigest", "idempotencyKey"]) assert.equal(Object.hasOwn(result.body, key), false);
  });

  await t.test("exact replay and duplicate/conflict preserve the first durable receipt", async () => {
    assert.ok(firstReceipt);
    const before = snapshot();
    const replay = await post(firstPayload);
    assert.equal(replay.status, 200);
    assert.deepEqual(replay.body, firstReceipt);
    const conflict = await post({ ...firstPayload, id: "changed-client-id" });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.code, "CARE_ACCESS_ACK_IDEMPOTENCY_CONFLICT");
    const duplicate = await post(envelope(ownEvents[0].id, "different-key"));
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.code, "CARE_ACCESS_ACK_ALREADY_ACKNOWLEDGED");
    assert.deepEqual(snapshot(), before);
  });

  await t.test("replay verifies raw audit integrity without normalizing damaged source", async () => {
    const original = raw().dataAccessLogs;
    const damaged = structuredClone(original);
    damaged[0].purpose = "tampered-source";
    replaceFixture("dataAccessLogs", damaged);
    try {
      const before = snapshot();
      assert.equal((await post(firstPayload)).status, 409);
      assert.deepEqual(snapshot(), before);
    } finally { replaceFixture("dataAccessLogs", original); }
  });

  await t.test("replay rechecks a now-foreign exact event and never trusts the cached receipt", async () => {
    const original = raw().dataAccessLogs;
    const rows = structuredClone(original);
    rows.find((row) => row.id === ownEvents[0].id).residentId = otherEvent.residentId;
    let previousHash = "";
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      rows[index].previousAuditHash = previousHash;
      rows[index].auditHash = auditHashFor(rows[index]);
      previousHash = rows[index].auditHash;
    }
    replaceFixture("dataAccessLogs", rows);
    try {
      const before = snapshot();
      assert.equal((await post(firstPayload)).status, 403);
      assert.deepEqual(snapshot(), before);
    } finally { replaceFixture("dataAccessLogs", original); }
  });

  await t.test("generic full-state, collection and reset cannot rewrite acknowledgement or source audit", async () => {
    const managerState = (await api("/api/state", manager)).body;
    for (const value of [[], null, {}, [{ id: "forged" }]]) {
      const before = snapshot();
      const result = await api("/api/state", manager, { method: "PUT", body: JSON.stringify({ ...managerState, accessAcknowledgements: value }) });
      assert.equal(result.status, 409);
      assert.equal(result.body.code, "CARE_ACCESS_ACK_SERVER_MANAGED_CONFLICT");
      assert.deepEqual(snapshot(), before);
    }
    const before = snapshot();
    const collection = await api("/api/state-collections/accessAcknowledgements", manager, { method: "PUT", body: "{" });
    assert.equal(collection.status, 403);
    assert.equal(collection.body.code, "CARE_ACCESS_ACK_SERVER_MANAGED_WRITE_DENIED");
    const reset = await api("/api/reset", manager, { method: "POST" });
    assert.equal(reset.status, 409);
    assert.equal(reset.body.code, "CARE_ACCESS_ACK_RESET_BLOCKED");
    const sourceWrite = await api("/api/state-collections/dataAccessLogs", manager, { method: "PUT", body: "[]" });
    assert.equal(sourceWrite.status, 400);
    const sourceFull = await api("/api/state", manager, { method: "PUT", body: JSON.stringify({ ...managerState, dataAccessLogs: [] }) });
    assert.equal(sourceFull.status, 409);
    assert.equal(sourceFull.body.code, "AUDIT_TRAIL_WRITE_REJECTED");
    assert.deepEqual(snapshot(), before);
  });

  await t.test("production environment denies new commands and replay", async () => {
    const before = snapshot();
    try {
      for (const environment of ["production", " Production ", "unknown-environment"]) {
        process.env.NODE_ENV = environment;
        assert.equal((await post(firstPayload)).status, 503);
        assert.equal((await post(envelope(ownEvents[1].id, "production-new"))).status, 503);
      }
    } finally { process.env.NODE_ENV = "test"; }
    assert.deepEqual(snapshot(), before);
  });

  await t.test("malformed persisted declarations and reset fail without repairing state", async () => {
    const original = raw().accessAcknowledgements;
    for (const malformed of [null, {}, [{ id: "incomplete-legacy" }]]) {
      replaceFixture("accessAcknowledgements", malformed);
      try {
        const before = snapshot();
        const result = await post(firstPayload);
        assert.equal(result.status, 409);
        assert.equal(result.body.code, "CARE_ACCESS_ACK_STORED_STATE_INVALID");
        const reset = await api("/api/reset", manager, { method: "POST" });
        assert.equal(reset.status, 409);
        assert.equal(reset.body.code, "CARE_ACCESS_ACK_RESET_BLOCKED");
        assert.deepEqual(snapshot(), before);
      } finally { replaceFixture("accessAcknowledgements", original); }
    }
  });

  await t.test("SQLite injected failures roll back declaration, receipt and audit source together", async () => {
    for (const collection of ["accessAcknowledgements", "securityEvents"]) {
      const trigger = `access_ack_fail_${collection}`;
      database((db) => db.exec(`CREATE TRIGGER ${trigger} BEFORE UPDATE ON state_collections WHEN NEW.key = '${collection}' BEGIN SELECT RAISE(ABORT, 'private-write-error'); END;`));
      const before = snapshot();
      try {
        const failed = await post(envelope(ownEvents[1].id, "storage-retry"));
        assert.equal(failed.status, 503);
        assert.equal(failed.body.code, "CARE_ACCESS_ACK_STORAGE_FAILED");
        assert.doesNotMatch(JSON.stringify(failed.body), /private-write-error/);
        assert.deepEqual(snapshot(), before);
      } finally { database((db) => db.exec(`DROP TRIGGER ${trigger}`)); }
    }
    const successful = await post(envelope(ownEvents[1].id, "storage-retry"));
    assert.equal(successful.status, 201);
  });

  await t.test("capacity keeps all original rows and valid replay while refusing a new declaration", async () => {
    const original = raw().accessAcknowledgements;
    const originalLogs = raw().dataAccessLogs;
    const event = { ...ownEvents[0], id: "capacity-new-event", previousAuditHash: originalLogs[0].auditHash };
    event.auditHash = auditHashFor(event);
    replaceFixture("dataAccessLogs", [event, ...originalLogs]);
    const template = original[0];
    const full = [...original, ...Array.from({ length: 2000 - original.length }, (_, i) => ({
      ...template, id: `historical-${i}`, accessLogId: `historical-event-${i}`, resourceId: `historical-event-${i}`,
      receiptId: `historical-receipt-${i}`, auditRef: `historical-audit-${i}`, idempotencyKeyHash: digest(i), requestDigest: digest(`payload-${i}`)
    }))];
    replaceFixture("accessAcknowledgements", full);
    try {
      const before = snapshot();
      assert.equal((await post(firstPayload)).status, 200);
      const capacity = await post(envelope(event.id, "capacity-new-key"));
      assert.equal(capacity.status, 409);
      assert.equal(capacity.body.code, "CARE_ACCESS_ACK_CAPACITY");
      assert.deepEqual(snapshot(), before);
    } finally {
      replaceFixture("accessAcknowledgements", original);
      replaceFixture("dataAccessLogs", originalLogs);
    }
  });
});
