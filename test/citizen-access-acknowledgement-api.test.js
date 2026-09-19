"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { createHash, randomBytes } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawnSync } = require("node:child_process");
const V2 = require("../citizen-records-v2");
const { auditHashFor } = require("../src/identity-security/audit-chain");

const ROOT = path.resolve(__dirname, "..");
const digest = (value) => createHash("sha256").update(String(value)).digest("hex");

test("JSON target POST reads damaged audit authority without hydration repair or byte changes", () => {
  // A fresh process is required: the real server captures its storage mode at load time.
  const child = spawnSync(process.execPath, ["-e", `(${async function () {
    const assert = require("node:assert/strict");
    const fs = require("node:fs");
    const path = require("node:path");
    const http = require("node:http");
    const { createApiRegressionRuntime } = require("./test/helpers/api-regression-runtime");
    const V2 = require("./citizen-records-v2");
    process.env.NODE_ENV = "test";
    process.env.POSTGRES_SYNC_MODE = "disabled";
    process.env.SESSION_STORE = "memory";
    process.env.AUTH_SESSION_TRANSPORT = "bearer";
    const runtime = createApiRegressionRuntime();
    try {
      const base = await runtime.start();
      const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "citizen", password: "123456" }) });
      assert.equal(login.status, 200);
      const { token } = await login.json();
      const file = path.join(process.env.DATA_DIR, "db.json");
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      const event = data.dataAccessLogs.find((row) => row.residentId === "r1");
      assert.ok(event);
      const payload = V2.buildIdempotentAction({ operation: "access-acknowledge", residentId: "r1", nonce: "json-raw", requestedAt: "2026-09-14T10:00:00.000Z",
        payload: V2.buildAccessAcknowledgement({ residentId: "r1", accessLogId: event.id, acknowledgedAt: "2026-09-14T09:00:00.000Z" }) });
      for (const row of data.dataAccessLogs) { delete row.auditHash; delete row.previousAuditHash; }
      const results = [];
      for (const prefix of ["/api/", "/api/./", "/api/x/../", "/api/%2e/"]) {
        fs.writeFileSync(file, JSON.stringify(data, null, 2));
        const before = fs.readFileSync(file);
        const result = await new Promise((resolve, reject) => {
          const request = http.request({ hostname: "127.0.0.1", port: new URL(base).port,
            path: `${prefix}access-reviews/${encodeURIComponent(event.id)}/acknowledge`, method: "POST", headers: {
              "Content-Type": "application/json", Authorization: `Bearer ${token}`, "Idempotency-Key": payload.idempotencyKey
            } }, (response) => {
              let text = "";
              response.on("data", (part) => { text += part; });
              response.on("end", () => resolve({ prefix, status: response.statusCode, code: JSON.parse(text).code }));
            });
          request.on("error", reject);
          request.end(JSON.stringify(payload));
        });
        results.push({ ...result, byteIdentical: fs.readFileSync(file).equals(before) });
      }
      assert.deepEqual(results, ["/api/", "/api/./", "/api/x/../", "/api/%2e/"].map((prefix) => ({
        prefix, status: 409, code: "RESIDENT_ACCESS_EVENT_INVALID", byteIdentical: true
      })), "all raw URL spellings must reject without normalization or resealing");
    } finally { await runtime.stop(); }
  }.toString()})().catch(error => { console.error(error); process.exitCode = 1; });`], {
    cwd: ROOT, encoding: "utf8", timeout: 30000,
    env: { ...process.env, SESSION_SECRETS: randomBytes(48).toString("hex") }
  });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, `${child.stdout}\n${child.stderr}`);
});

test("access acknowledgement uses real HTTP, raw SQLite identity, CAS and atomic rollback", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "access-ack-http-"));
  fs.copyFileSync(path.join(ROOT, "data/db.json"), path.join(directory, "db.json"));
  const previous = Object.fromEntries(["DATA_DIR", "STORAGE_ENGINE", "NODE_ENV", "POSTGRES_SYNC_MODE", "SESSION_SECRETS", "SESSION_STORE", "AUTH_SESSION_TRANSPORT", "AUTH_BEARER_COMPATIBILITY", "SESSION_TOPOLOGY", "INSTANCE_COUNT", "AUTH_SECURITY_STATE_STORE", "SESSION_EXPIRED_RETENTION_DAYS", "SESSION_REVOKED_RETENTION_DAYS", "SESSION_CLEANUP_INTERVAL_MS"].map((key) => [key, process.env[key]]));
  Object.assign(process.env, { DATA_DIR: directory, STORAGE_ENGINE: "sqlite", NODE_ENV: "test", POSTGRES_SYNC_MODE: "disabled",
    SESSION_SECRETS: randomBytes(48).toString("hex"), SESSION_STORE: "sqlite", AUTH_SESSION_TRANSPORT: "bearer", AUTH_BEARER_COMPATIBILITY: "enabled",
    SESSION_TOPOLOGY: "single-host", INSTANCE_COUNT: "1", AUTH_SECURITY_STATE_STORE: "sqlite",
    SESSION_EXPIRED_RETENTION_DAYS: "2", SESSION_REVOKED_RETENTION_DAYS: "45", SESSION_CLEANUP_INTERVAL_MS: "60000" });
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
    const after = snapshot();
    // Existing authentication/role rejection audit is expected. It must not be
    // confused with a declaration write or rewriting the source access event.
    assert.deepEqual(after.rows.filter((row) => row.key !== "securityEvents"), before.rows.filter((row) => row.key !== "securityEvents"));
    const beforeIds = new Set(before.sources.map((row) => row.source_event_id));
    const added = after.sources.filter((row) => !beforeIds.has(row.source_event_id));
    assert.equal(added.length, 2, "both role denials retain their normal durable audit");
    for (const row of before.sources) assert.deepEqual(after.sources.find((item) => item.source_event_id === row.source_event_id), row);
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
    assert.ok(firstReceipt, "successful first command is required to test replay");
    const original = raw().dataAccessLogs;
    const damaged = structuredClone(original);
    damaged[0].purpose = "tampered-source";
    replaceFixture("dataAccessLogs", damaged);
    try {
      const before = snapshot();
      const result = await post(firstPayload);
      assert.equal(result.status, 409);
      assert.equal(result.body.code, "RESIDENT_ACCESS_EVENT_INVALID");
      assert.deepEqual(snapshot(), before);
    } finally { replaceFixture("dataAccessLogs", original); }
  });

  await t.test("replay rechecks a now-foreign exact event and never trusts the cached receipt", async () => {
    assert.ok(firstReceipt, "successful first command is required to test replay");
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
      const result = await post(firstPayload);
      assert.equal(result.status, 403);
      assert.equal(result.body.code, "RESIDENT_ACCESS_EVENT_SCOPE_DENIED");
      assert.deepEqual(snapshot(), before);
    } finally { replaceFixture("dataAccessLogs", original); }
  });

  await t.test("generic full-state, collection and reset cannot rewrite acknowledgement or source audit", async () => {
    assert.ok(firstReceipt, "do not run a reset against an empty declaration fixture");
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
    assert.equal(sourceFull.status, 400);
    assert.equal(sourceFull.body.code, "AUDIT_TRAIL_WRITE_REJECTED");
    assert.deepEqual(snapshot(), before);
  });

  await t.test("production environment denies new commands and replay", async () => {
    assert.ok(firstReceipt);
    const before = snapshot();
    try {
      for (const environment of ["production", " Production ", "unknown-environment"]) {
        process.env.NODE_ENV = environment;
        const code = environment.trim().toLowerCase() === "production" ? "CARE_ACCESS_ACK_PRODUCTION_DISABLED" : "CARE_ACCESS_ACK_STORAGE_UNSUPPORTED";
        for (const payload of [firstPayload, envelope(ownEvents[1].id, "production-new")]) {
          const result = await post(payload);
          assert.equal(result.status, 503);
          assert.equal(result.body.code, code, "must reach the acknowledgement environment gate, not fail authentication");
        }
      }
    } finally { process.env.NODE_ENV = "test"; }
    assert.deepEqual(snapshot(), before);
  });

  await t.test("malformed persisted declarations and reset fail without repairing state", async () => {
    assert.ok(firstReceipt);
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
    assert.ok(firstReceipt);
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

  await t.test("full-state omission and equality preserve declarations while reorder and deletion are refused", async () => {
    assert.ok(firstReceipt);
    const original = raw().accessAcknowledgements;
    assert.ok(original.length >= 2, "requires distinct persisted declarations");
    for (const mode of ["omit", "equal"]) {
      const state = (await api("/api/state", manager)).body;
      if (mode === "omit") delete state.accessAcknowledgements;
      else state.accessAcknowledgements = structuredClone(original);
      const result = await api("/api/state", manager, { method: "PUT", body: JSON.stringify(state) });
      assert.equal(result.status, 200, `${mode}: ${JSON.stringify(result.body)}`);
      assert.deepEqual(raw().accessAcknowledgements, original);
    }
    for (const changed of [[...original].reverse(), original.slice(1)]) {
      const state = (await api("/api/state", manager)).body;
      const before = snapshot();
      const result = await api("/api/state", manager, { method: "PUT", body: JSON.stringify({ ...state, accessAcknowledgements: changed }) });
      assert.equal(result.status, 409);
      assert.equal(result.body.code, "CARE_ACCESS_ACK_SERVER_MANAGED_CONFLICT");
      assert.deepEqual(snapshot(), before);
    }
  });

  await t.test("an event evicted from a 120-row raw audit window cannot be acknowledged by replay", async () => {
    assert.ok(firstReceipt);
    const original = raw().dataAccessLogs;
    const window = Array.from({ length: 120 }, (_, index) => ({ ...ownEvents[0], id: `retained-window-${index}` }));
    let previousHash = "";
    for (let index = window.length - 1; index >= 0; index -= 1) {
      window[index].previousAuditHash = previousHash;
      window[index].auditHash = auditHashFor(window[index]);
      previousHash = window[index].auditHash;
    }
    replaceFixture("dataAccessLogs", window);
    try {
      const before = snapshot();
      const result = await post(firstPayload);
      assert.equal(result.status, 404);
      assert.equal(result.body.code, "RESIDENT_ACCESS_EVENT_INVALID");
      assert.deepEqual(snapshot(), before);
      assert.equal(raw().dataAccessLogs.length, 120);
    } finally { replaceFixture("dataAccessLogs", original); }
  });

  await t.test("a full security audit window trims only its projection and appends exactly one durable source", async () => {
    const original = raw();
    const window = [...original.securityEvents];
    while (window.length < 120) {
      const entry = { ...window[0], id: `security-window-${window.length}`, previousAuditHash: window[0]?.auditHash || "" };
      entry.auditHash = auditHashFor(entry);
      window.unshift(entry);
    }
    assert.equal(window.length, 120);
    const event = { ...ownEvents[0], id: "security-window-command", previousAuditHash: original.dataAccessLogs[0].auditHash };
    event.auditHash = auditHashFor(event);
    replaceFixture("securityEvents", window);
    replaceFixture("dataAccessLogs", [event, ...original.dataAccessLogs]);
    try {
      // Seed the real immutable source from this test-owned authority before the command.
      const { backfillAuditDeliverySourceFromCollections } = require("../src/identity-security/audit-delivery-source");
      database((db) => backfillAuditDeliverySourceFromCollections(db));
      const before = snapshot();
      const result = await post(envelope(event.id, "full-security-window"));
      assert.equal(result.status, 201, JSON.stringify(result.body));
      const after = snapshot();
      const audit = raw().securityEvents;
      assert.equal(audit.length, 120);
      assert.equal(audit[0].id, result.body.auditRef);
      assert.equal(audit.some((row) => row.id === window.at(-1).id), false);
      assert.equal(after.sources.length, before.sources.length + 1);
      for (const row of before.sources) assert.deepEqual(after.sources.find((item) => item.source_event_id === row.source_event_id), row);
      const added = after.sources.filter((row) => !before.sources.some((item) => item.source_event_id === row.source_event_id));
      assert.equal(added.length, 1);
      assert.equal(added[0].source_event_id, result.body.auditRef);
      assert.equal(added[0].stream, "securityEvents");
      assert.equal(after.sources.some((row) => row.source_event_id === window.at(-1).id), true);
    } finally {
      replaceFixture("securityEvents", original.securityEvents);
      replaceFixture("dataAccessLogs", original.dataAccessLogs);
    }
  });

  await t.test("a real SQLite writer racing the raw snapshot is rejected by persisted CAS", async () => {
    assert.ok(firstReceipt);
    const original = raw().dataAccessLogs;
    const event = { ...ownEvents[0], id: "cas-new-event", previousAuditHash: original[0].auditHash };
    event.auditHash = auditHashFor(event);
    replaceFixture("dataAccessLogs", [event, ...original]);
    const originalPrepare = DatabaseSync.prototype.prepare;
    let raced = false;
    let rawReads = 0;
    let afterExternalCommit;
    DatabaseSync.prototype.prepare = function (sql) {
      const statement = originalPrepare.call(this, sql);
      if (sql === "SELECT key, payload, version FROM state_collections" && !raced) {
        return new Proxy(statement, {
          get(target, property) {
            if (property === "all") return (...args) => {
              const snapshotRows = target.all(...args);
              rawReads += 1;
              // The first raw read hydrates authentication; the second belongs to the command.
              if (!raced && rawReads === 2) {
                raced = true;
                database((db) => db.prepare("UPDATE state_collections SET version = version + 1 WHERE key = 'accessAcknowledgements'").run());
                afterExternalCommit = snapshot();
              }
              return snapshotRows;
            };
            const value = Reflect.get(target, property);
            return typeof value === "function" ? value.bind(target) : value;
          }
        });
      }
      return statement;
    };
    try {
      const result = await post(envelope(event.id, "cas-command"));
      assert.equal(raced, true, "fault injection must reach the command's raw snapshot read");
      assert.equal(result.status, 409);
      assert.equal(result.body.code, "CARE_ACCESS_ACK_STORAGE_CONFLICT");
      assert.deepEqual(snapshot(), afterExternalCommit, "only the independent writer's version increment persists");
    } finally {
      DatabaseSync.prototype.prepare = originalPrepare;
      replaceFixture("dataAccessLogs", original);
    }
  });

  for (const replay of [false, true]) for (const change of ["disabled", "role", "resident", "revoked"]) {
    await t.test(`slow body ${replay ? "replay" : "new command"} rechecks ${change} after authenticated arrival`, async () => {
      const token = await login("citizen");
      const originalUsers = raw().authUsers;
      const originalLogs = raw().dataAccessLogs;
      const event = { ...ownEvents[0], id: `slow-${change}-${replay}`, previousAuditHash: originalLogs[0].auditHash };
      event.auditHash = auditHashFor(event);
      if (!replay) replaceFixture("dataAccessLogs", [event, ...originalLogs]);
      const payload = replay ? firstPayload : envelope(event.id, event.id);
      const pathname = `/api/access-reviews/${encodeURIComponent(payload.accessLogId)}/acknowledge`;
      const bytes = JSON.stringify(payload);
      let reached;
      const authenticatedArrival = new Promise((resolve) => { reached = resolve; });
      const originalOn = http.IncomingMessage.prototype.on;
      let observed = false;
      http.IncomingMessage.prototype.on = function (name, callback) {
        const result = originalOn.call(this, name, callback);
        if (this.url === pathname && name === "end" && this.authResolution?.session && !observed) {
          observed = true;
          reached(this.authResolution.session.user.id);
        }
        return result;
      };
      let request;
      try {
        const response = new Promise((resolve, reject) => {
          request = http.request(`${base}${pathname}`, { method: "POST", headers: {
            Authorization: `Bearer ${token}`, "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(bytes), "Idempotency-Key": payload.idempotencyKey
          } }, (res) => {
            let body = "";
            res.on("data", (part) => { body += part; });
            res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
          });
          request.on("error", reject);
          request.write(bytes.slice(0, 1));
        });
        const actorId = await Promise.race([authenticatedArrival, response.then(() => { throw new Error("request completed before authenticated body barrier"); })]);
        http.IncomingMessage.prototype.on = originalOn;
        assert.equal(observed, true);
        if (change === "revoked") {
          const logout = await api("/api/auth/logout", token, { method: "POST", body: "{}" });
          assert.equal(logout.status, 200);
        } else {
          replaceFixture("authUsers", originalUsers.map((user) => user.id !== actorId ? user : {
            ...user, ...(change === "disabled" ? { status: "disabled" } : change === "role" ? { role: "institution" } : { residentId: "r2" })
          }));
        }
        const before = snapshot();
        request.end(bytes.slice(1));
        const result = await response;
        assert.equal(result.status, 403, JSON.stringify(result.body));
        assert.equal(result.body.code, "CARE_ACCESS_ACK_FORBIDDEN");
        assert.deepEqual(snapshot(), before, "no declaration or audit source is committed after revocation");
      } finally {
        http.IncomingMessage.prototype.on = originalOn;
        request?.destroy();
        replaceFixture("authUsers", originalUsers);
        replaceFixture("dataAccessLogs", originalLogs);
      }
    });
  }

  await t.test("capacity keeps all original rows and valid replay while refusing a new declaration", async () => {
    assert.ok(firstReceipt);
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
