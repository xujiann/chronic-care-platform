"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { spawnSync } = require("node:child_process");
const { runGs03Transaction } = require("../src/platform/storage/gs03-transaction-outcome");
const { createGs03MemoryTransactionSession } = require("../src/platform/storage/gs03-memory-transaction");

async function fixture(t) {
  const session = createGs03MemoryTransactionSession({ environment: "test" });
  t.after(() => { try { session.close(); } catch { /* Individual tests assert a busy close. */ } });
  let db;
  const setup = session.createPort({
    apply(connection) {
      db = connection;
      connection.exec("CREATE TABLE facts (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
      return "replay";
    },
    verify: () => true
  });
  assert.equal((await runGs03Transaction({ environment: "test", port: setup })).status, "confirmed-replay");
  return { session, db, count: () => db.prepare("SELECT count(*) AS n FROM facts").get().n };
}

function port(session, apply, verify = () => true) {
  return session.createPort({ apply, verify });
}

test("only development/test and exact options may create an internally owned session", () => {
  for (const options of [undefined, {}, { environment: "production" },
    { environment: "test", path: ":memory:" }, { environment: "test", database: {} },
    { environment: "test", initialize() {} }, { get environment() { throw Error("secret"); } }]) {
    assert.throws(() => createGs03MemoryTransactionSession(options), { code: "GS03_MEMORY_ADMISSION" });
  }
  const session = createGs03MemoryTransactionSession({ environment: "development" });
  assert.deepEqual(Object.keys(session).sort(), ["close", "createPort", "productionReady"]);
  assert.equal(session.productionReady, false);
  assert.equal(session.close(), true);
});

test("capability gate closes its internally created connection", () => {
  const source = require.resolve("../src/platform/storage/gs03-memory-transaction");
  const originalLoad = Module._load;
  const prior = require.cache[source];
  let closed = 0;
  class MissingCapability {
    constructor(name) { assert.equal(name, ":memory:"); }
    close() { closed += 1; }
  }
  try {
    Module._load = function (request, parent, isMain) {
      if (request === "node:sqlite") return { DatabaseSync: MissingCapability };
      return originalLoad.call(this, request, parent, isMain);
    };
    delete require.cache[source];
    const isolatedModule = require(source);
    assert.throws(() => isolatedModule.createGs03MemoryTransactionSession({ environment: "test" }),
      { code: "GS03_MEMORY_CAPABILITY" });
    assert.equal(closed, 1);
  } finally {
    Module._load = originalLoad;
    delete require.cache[source];
    if (prior) require.cache[source] = prior;
  }
});

test("first and replay commit real SQLite on one in-memory connection", async (t) => {
  const f = await fixture(t);
  const first = port(f.session, (db) => { db.exec("INSERT INTO facts VALUES (1, 'synthetic')"); return "first"; },
    (db) => db.prepare("SELECT value FROM facts WHERE id=1").get().value === "synthetic");
  assert.deepEqual(await runGs03Transaction({ environment: "test", port: first }),
    { status: "confirmed-first", phase: "commit", productionReady: false });
  assert.equal(f.count(), 1);
  const replay = port(f.session, (db) => { assert.equal(db, f.db); return "replay"; });
  assert.equal((await runGs03Transaction({ environment: "test", port: replay })).status, "confirmed-replay");
  assert.equal(f.count(), 1);
  assert.equal(f.db.prepare("PRAGMA database_list").all().length, 1);
});

test("invalid port options and direct method order do not acquire a lease", async (t) => {
  const f = await fixture(t);
  for (const options of [null, {}, { apply() {}, verify: true },
    { apply() {}, verify() {}, extra: 1 }]) {
    assert.throws(() => f.session.createPort(options), { code: "GS03_MEMORY_ADMISSION" });
  }
  const p = port(f.session, () => "first");
  assert.throws(() => p.apply(), { code: "GS03_MEMORY_SEQUENCE" });
  assert.throws(() => p.verify(), { code: "GS03_MEMORY_SEQUENCE" });
  assert.throws(() => p.commit(), { code: "GS03_MEMORY_SEQUENCE" });
  assert.equal(p.rollback(), false);
  assert.equal(p.begin(), true);
  assert.throws(() => p.verify(), { code: "GS03_MEMORY_SEQUENCE" });
  assert.equal(p.rollback(), true);
  assert.equal(p.rollback(), false);
  assert.equal(p.begin(), false);
  assert.equal((await runGs03Transaction({ environment: "test", port: port(f.session, () => "replay") })).status,
    "confirmed-replay");
});

test("repeated begin while owning a lease isolates rather than cleaning an older call", async (t) => {
  const f = await fixture(t);
  const p = port(f.session, () => "replay");
  assert.equal(p.begin(), true);
  assert.equal(p.begin(), false);
  assert.equal(p.rollback(), false);
  assert.equal(f.db.isTransaction, true);
  assert.equal((await runGs03Transaction({ environment: "test", port: port(f.session, () => "replay") })).status,
    "unknown");
  assert.equal(f.session.close(), true);
});

test("same-session ports contend without rolling back the active owner", async (t) => {
  const f = await fixture(t);
  let second;
  const first = port(f.session, (db) => {
    db.exec("INSERT INTO facts VALUES (1, 'first')");
    second = runGs03Transaction({ environment: "test", port: port(f.session, () => "first") });
    return "first";
  });
  assert.equal((await runGs03Transaction({ environment: "test", port: first })).status, "confirmed-first");
  assert.equal((await second).status, "rolled-back");
  assert.equal(f.count(), 1);
});

test("pre-existing external transaction is never rolled back by rejected begin", async (t) => {
  const f = await fixture(t);
  f.db.exec("BEGIN IMMEDIATE");
  f.db.exec("INSERT INTO facts VALUES (1, 'external')");
  const outcome = await runGs03Transaction({ environment: "test", port: port(f.session, () => "first") });
  assert.deepEqual(outcome, { status: "rolled-back", phase: "begin", productionReady: false });
  assert.equal(f.db.isTransaction, true);
  assert.equal(f.count(), 1);
  assert.throws(() => f.session.close(), { code: "GS03_MEMORY_BUSY" });
  f.db.exec("ROLLBACK");
  assert.equal(f.count(), 0);
  assert.equal(f.session.close(), true);
});

test("normal synchronous apply and verify errors roll back real writes", async (t) => {
  const f = await fixture(t);
  for (const phase of ["apply", "verify"]) {
    const p = port(f.session, (db) => {
      db.exec("INSERT INTO facts VALUES (1, 'private')");
      if (phase === "apply") throw Error("secret provider payload");
      return "first";
    }, () => { if (phase === "verify") throw Error("secret provider payload"); return true; });
    const result = await runGs03Transaction({ environment: "test", port: p });
    assert.deepEqual(result, { status: "rolled-back", phase, productionReady: false });
    assert.equal(f.count(), 0);
    assert.equal(JSON.stringify(result).includes("secret"), false);
  }
});

for (const phase of ["apply", "verify"]) {
  for (const swallowed of [false, true]) {
    test(`${phase} reentry isolates even when its error is ${swallowed ? "caught" : "uncaught"}`, async (t) => {
      const f = await fixture(t);
      let p;
      function reenter() {
        if (swallowed) {
          try { p[phase](); } catch (error) { assert.equal(error.code, "GS03_MEMORY_SEQUENCE"); }
        } else {
          p[phase]();
        }
      }
      p = port(f.session, (db) => {
        db.exec("INSERT INTO facts VALUES (1, 'synthetic')");
        if (phase === "apply") reenter();
        return "first";
      }, () => { if (phase === "verify") reenter(); return true; });
      assert.deepEqual(await runGs03Transaction({ environment: "test", port: p }),
        { status: "unknown", phase, productionReady: false });
      assert.equal(f.db.isTransaction, true);
      assert.equal(f.count(), 1);
      assert.equal((await runGs03Transaction({ environment: "test", port: port(f.session, () => "replay") })).status,
        "unknown");
      assert.equal(f.session.close(), true);
    });
  }
}

test("invalid callback results roll back and cannot be mistaken for confirmation", async (t) => {
  const f = await fixture(t);
  for (const bad of [false, { kind: "first" }]) {
    const p = port(f.session, (db) => { db.exec("INSERT INTO facts VALUES (1, 'x')"); return bad; });
    assert.equal((await runGs03Transaction({ environment: "test", port: p })).status, "rolled-back");
    assert.equal(f.count(), 0);
  }
  const p = port(f.session, (db) => { db.exec("INSERT INTO facts VALUES (1, 'x')"); return "first"; }, () => false);
  assert.equal((await runGs03Transaction({ environment: "test", port: p })).status, "rolled-back");
  assert.equal(f.count(), 0);
});

test("SQLite auto-ROLLBACK loss isolates the whole session", async (t) => {
  const f = await fixture(t);
  f.db.exec("INSERT INTO facts VALUES (1, 'existing')");
  const p = port(f.session, (db) => {
    db.exec("INSERT OR ROLLBACK INTO facts VALUES (2, 'new')");
    db.exec("INSERT OR ROLLBACK INTO facts VALUES (1, 'conflict')");
    return "first";
  });
  assert.equal((await runGs03Transaction({ environment: "test", port: p })).status, "unknown");
  assert.equal(f.db.isTransaction, false);
  assert.equal(f.count(), 1);
  assert.equal((await runGs03Transaction({ environment: "test", port: port(f.session, () => "replay") })).status,
    "unknown");
  assert.equal(f.session.close(), true);
});

test("async and thenable callbacks isolate even if they wrote before returning", async (t) => {
  for (const makeApply of [
    (db) => async () => { db.exec("INSERT INTO facts VALUES (1, 'x')"); return "first"; },
    (db) => () => { db.exec("INSERT INTO facts VALUES (1, 'x')"); return { then() {} }; },
    (db) => async () => { db.exec("INSERT INTO facts VALUES (1, 'x')"); throw Error("private async"); }
  ]) {
    const f = await fixture(t);
    const p = port(f.session, makeApply(f.db));
    assert.equal((await runGs03Transaction({ environment: "test", port: p })).status, "unknown");
    assert.equal((await runGs03Transaction({ environment: "test", port: port(f.session, () => "replay") })).status,
      "unknown");
    assert.equal(f.session.close(), true);
  }
});

test("cross-realm rejected Promise is consumed without an unhandled rejection or raw error", () => {
  const adapterPath = JSON.stringify(require.resolve("../src/platform/storage/gs03-memory-transaction"));
  const runnerPath = JSON.stringify(require.resolve("../src/platform/storage/gs03-transaction-outcome"));
  const script = `
    const vm = require('node:vm');
    const { createGs03MemoryTransactionSession } = require(${adapterPath});
    const { runGs03Transaction } = require(${runnerPath});
    const session = createGs03MemoryTransactionSession({ environment: 'test' });
    const port = session.createPort({
      apply(db) {
        db.exec('CREATE TABLE synthetic (id INTEGER)');
        return vm.runInNewContext("Promise.reject(new Error('private vm rejection'))");
      },
      verify() { return true; }
    });
    runGs03Transaction({ environment: 'test', port }).then((result) => {
      process.stdout.write(result.status);
      session.close();
    });
  `;
  const child = spawnSync(process.execPath, ["-e", script], { encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, "unknown");
  assert.equal(child.stderr.includes("private vm rejection"), false);
  assert.equal(child.stderr.includes("unhandledRejection"), false);
});

test("rollback response loss isolates even after SQLite actually rolled back", async (t) => {
  const f = await fixture(t);
  const original = f.db.exec;
  f.db.exec = function (sql) {
    const result = original.call(this, sql);
    if (sql === "ROLLBACK") throw Error("private transport failure");
    return result;
  };
  const p = port(f.session, (db) => { db.exec("INSERT INTO facts VALUES (1, 'x')"); throw Error("private"); });
  assert.deepEqual(await runGs03Transaction({ environment: "test", port: p }),
    { status: "unknown", phase: "apply", productionReady: false });
  assert.equal(f.count(), 0);
  assert.equal((await runGs03Transaction({ environment: "test", port: port(f.session, () => "replay") })).status,
    "unknown");
  assert.equal(f.session.close(), true);
});

test("deferred constraint failure at COMMIT is unknown and quarantines new ports", async (t) => {
  const f = await fixture(t);
  f.db.exec("PRAGMA foreign_keys=ON");
  f.db.exec("CREATE TABLE parent (id INTEGER PRIMARY KEY)");
  f.db.exec("CREATE TABLE child (pid INTEGER REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED)");
  const p = port(f.session, (db) => { db.exec("INSERT INTO child VALUES (9)"); return "first"; });
  assert.deepEqual(await runGs03Transaction({ environment: "test", port: p }),
    { status: "unknown", phase: "commit", productionReady: false });
  assert.equal(f.db.isTransaction, true);
  assert.equal((await runGs03Transaction({ environment: "test", port: port(f.session, () => "replay") })).status,
    "unknown");
  assert.equal(f.session.close(), true);
});

test("successful COMMIT followed by lost response cannot be cleaned into rollback", async (t) => {
  const f = await fixture(t);
  const original = f.db.exec;
  f.db.exec = function (sql) {
    const result = original.call(this, sql);
    if (sql === "COMMIT") throw Error("private transport failure");
    return result;
  };
  const p = port(f.session, (db) => { db.exec("INSERT INTO facts VALUES (1, 'x')"); return "first"; });
  assert.deepEqual(await runGs03Transaction({ environment: "test", port: p }),
    { status: "unknown", phase: "commit", productionReady: false });
  assert.equal(f.count(), 1);
  assert.equal(f.db.isTransaction, false);
  assert.equal((await runGs03Transaction({ environment: "test", port: port(f.session, () => "replay") })).status,
    "unknown");
  assert.equal(f.session.close(), true);
});

test("lost wrapper response after a confirmed commit isolates the session", async (t) => {
  const f = await fixture(t);
  const inner = port(f.session, (db) => { db.exec("INSERT INTO facts VALUES (1, 'x')"); return "first"; });
  const wrapper = {
    begin: () => inner.begin(),
    apply: () => inner.apply(),
    verify: () => inner.verify(),
    commit: () => { inner.commit(); throw Error("private response lost"); },
    rollback: () => inner.rollback()
  };
  assert.deepEqual(await runGs03Transaction({ environment: "test", port: wrapper }),
    { status: "unknown", phase: "commit", productionReady: false });
  assert.equal(f.count(), 1);
  assert.equal((await runGs03Transaction({ environment: "test", port: port(f.session, () => "replay") })).status,
    "unknown");
  assert.equal(f.session.close(), true);
});

test("stale committed-port cleanup never rolls back another active port", async (t) => {
  const f = await fixture(t);
  const older = port(f.session, (db) => { db.exec("INSERT INTO facts VALUES (1, 'older')"); return "first"; });
  assert.equal((await runGs03Transaction({ environment: "test", port: older })).status, "confirmed-first");
  const newer = port(f.session, (db) => { db.exec("INSERT INTO facts VALUES (2, 'newer')"); return "first"; });
  assert.equal(newer.begin(), true);
  assert.equal(newer.apply(), "first");
  assert.equal(older.rollback(), false);
  assert.equal(f.db.isTransaction, true);
  assert.equal(f.count(), 2);
  assert.equal(newer.rollback(), false); // quarantine cannot be cleared by a newer port
  assert.equal(f.session.close(), true);
});

test("attached database is rejected and isolated", async (t) => {
  const f = await fixture(t);
  const p = port(f.session, (db) => { db.exec("ATTACH ':memory:' AS other"); return "first"; });
  assert.equal((await runGs03Transaction({ environment: "test", port: p })).status, "unknown");
  assert.equal((await runGs03Transaction({ environment: "test", port: port(f.session, () => "replay") })).status,
    "unknown");
  assert.equal(f.session.close(), true);
});

test("close refuses a healthy active lease and accepts explicit isolated destruction", async (t) => {
  const f = await fixture(t);
  const p = port(f.session, () => "replay");
  assert.equal(p.begin(), true);
  assert.throws(() => f.session.close(), { code: "GS03_MEMORY_BUSY" });
  assert.equal(p.rollback(), true);
  assert.equal(f.session.close(), true);
  assert.throws(() => f.session.createPort({ apply() {}, verify() {} }), { code: "GS03_MEMORY_CLOSED" });
});

test("connection close failure is sanitized and does not pretend destruction", async (t) => {
  const f = await fixture(t);
  const original = f.db.close;
  f.db.close = () => { throw Error("private path"); };
  assert.throws(() => f.session.close(), { code: "GS03_MEMORY_CLOSE" });
  assert.equal((await runGs03Transaction({ environment: "test", port: port(f.session, () => "replay") })).status,
    "unknown");
  f.db.close = original;
  assert.equal(f.session.close(), true);
});
