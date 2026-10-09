"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { runGs03Transaction } = require("../src/platform/storage/gs03-transaction-outcome");

function fixture(t, kind = "first") {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec("CREATE TABLE synthetic_facts (value INTEGER NOT NULL)");
  const calls = [];
  const port = {
    begin() { calls.push("begin"); db.exec("BEGIN IMMEDIATE"); return true; },
    apply() {
      calls.push("apply");
      if (kind === "first") db.exec("INSERT INTO synthetic_facts VALUES (1)");
      return kind;
    },
    verify() { calls.push("verify"); return true; },
    commit() { calls.push("commit"); db.exec("COMMIT"); return true; },
    rollback() { calls.push("rollback"); db.exec("ROLLBACK"); return true; }
  };
  const count = () => db.prepare("SELECT count(*) AS n FROM synthetic_facts").get().n;
  return { db, port, calls, count };
}

function assertAdmissionReport(result) {
  assert.deepEqual(result, { status: "rejected", phase: "admission", productionReady: false });
  assert.deepEqual(Object.keys(result).sort(), ["phase", "productionReady", "status"]);
  assert.equal(Object.isFrozen(result), true);
  assert.doesNotMatch(JSON.stringify(result), /private|secret|patient|provider/i);
}

test("null and revoked options fail closed as fixed reports, without port calls", async (t) => {
  const f = fixture(t);
  assertAdmissionReport(await runGs03Transaction(null));
  const revoked = Proxy.revocable({ environment: "test", port: f.port }, {});
  revoked.revoke();
  assertAdmissionReport(await runGs03Transaction(revoked.proxy));
  assert.deepEqual(f.calls, []);
  assert.equal(f.count(), 0);
  assert.equal((await runGs03Transaction({ environment: "test", port: f.port })).status,
    "confirmed-first", "invalid options must not occupy the valid port");
});

test("environment access faults are sanitized before the port property is read", async (t) => {
  const f = fixture(t);
  let portReads = 0;
  const getterOptions = {
    get environment() { throw new Error("private environment payload"); },
    get port() { portReads += 1; return f.port; }
  };
  assertAdmissionReport(await runGs03Transaction(getterOptions));
  const proxyOptions = new Proxy({ port: f.port }, {
    get(target, key) {
      if (key === "environment") throw new Error("secret proxy environment");
      if (key === "port") portReads += 1;
      return Reflect.get(target, key);
    }
  });
  assertAdmissionReport(await runGs03Transaction(proxyOptions));
  assert.equal(portReads, 0);
  assert.deepEqual(f.calls, []);
  assert.equal((await runGs03Transaction({ environment: "test", port: f.port })).status,
    "confirmed-first");
});

test("valid environment with throwing port getter or Proxy read rejects without acquiring a lease", async (t) => {
  const f = fixture(t);
  assertAdmissionReport(await runGs03Transaction({
    environment: "test", get port() { throw new Error("private port payload"); }
  }));
  const options = new Proxy({ environment: "development" }, {
    get(target, key) {
      if (key === "port") throw new Error("secret proxy port");
      return Reflect.get(target, key);
    }
  });
  assertAdmissionReport(await runGs03Transaction(options));
  assert.deepEqual(f.calls, []);
  assert.equal((await runGs03Transaction({ environment: "test", port: f.port })).status,
    "confirmed-first");
});

test("invalid and production environments never read a port property", async (t) => {
  const f = fixture(t);
  let reads = 0;
  for (const environment of ["production", "", null, undefined, "TEST"]) {
    assertAdmissionReport(await runGs03Transaction({
      environment,
      get port() { reads += 1; throw new Error("private port must not be read"); }
    }));
  }
  assert.equal(reads, 0);
  assert.deepEqual(f.calls, []);
  assert.equal((await runGs03Transaction({ environment: "test", port: f.port })).status,
    "confirmed-first");
});

test("legacy getter, inherited fields and extra options remain accepted", async (t) => {
  const getter = fixture(t);
  const withGetters = {
    get environment() { return "test"; }, get port() { return getter.port; },
    unrelated: "legacy-extra"
  };
  assert.deepEqual(await runGs03Transaction(withGetters),
    { status: "confirmed-first", phase: "commit", productionReady: false });
  const inherited = fixture(t, "replay");
  const inheritedPort = Object.create(inherited.port);
  const inheritedOptions = Object.assign(Object.create({
    environment: "development", port: inheritedPort
  }), { unrelated: "legacy-extra" });
  assert.deepEqual(await runGs03Transaction(inheritedOptions),
    { status: "confirmed-replay", phase: "commit", productionReady: false });
  assert.deepEqual(inherited.calls, ["begin", "apply", "verify", "commit"]);
});

for (const kind of ["first", "replay"]) {
  test("real SQLite confirmed " + kind, async (t) => {
    const f = fixture(t, kind);
    const result = await runGs03Transaction({ environment: "test", port: f.port });
    assert.deepEqual(result, { status: "confirmed-" + kind, phase: "commit", productionReady: false });
    assert.deepEqual(f.calls, ["begin", "apply", "verify", "commit"]);
    assert.equal(f.count(), kind === "first" ? 1 : 0);
    assert.ok(Object.isFrozen(result));
  });
}

for (const phase of ["begin", "apply", "verify"]) {
  for (const failure of ["throw", "false"]) {
    test(phase + " " + failure + " rolls back actual SQLite facts", async (t) => {
      const f = fixture(t);
      const original = f.port[phase];
      f.port[phase] = async function () {
        original.call(this);
        if (failure === "throw") throw new Error("private provider payload");
        return false;
      };
      const result = await runGs03Transaction({ environment: "test", port: f.port });
      assert.deepEqual(result, { status: "rolled-back", phase, productionReady: false });
      assert.equal(f.count(), 0);
      assert.equal(f.calls.filter((s) => s === "rollback").length, 1);
      assert.ok(!f.calls.includes("commit"));
    });
  }
}

for (const committed of [false, true]) {
  for (const failure of ["throw", "false"]) {
    test("commit uncertainty remains unknown committed=" + committed + " " + failure, async (t) => {
      const f = fixture(t);
      f.port.commit = () => {
        f.calls.push("commit");
        if (committed) f.db.exec("COMMIT");
        if (failure === "throw") throw new Error("secret");
        return false;
      };
      const result = await runGs03Transaction({ environment: "test", port: f.port });
      assert.deepEqual(result, { status: "unknown", phase: "commit", productionReady: false });
      assert.equal(f.count(), committed ? 1 : 0);
      const calls = [...f.calls];
      assert.deepEqual(await runGs03Transaction({ environment: "test", port: f.port }),
        { status: "unknown", phase: "admission", productionReady: false });
      assert.deepEqual(f.calls, calls); // no automatic retry or reuse of uncertain port
    });
  }
}

for (const failure of ["throw", "false"]) {
  test("rollback " + failure + " cannot prove zero writes", async (t) => {
    const f = fixture(t);
    f.port.verify = () => false;
    f.port.rollback = () => {
      if (failure === "throw") throw new Error("sensitive path");
      return false;
    };
    const result = await runGs03Transaction({ environment: "test", port: f.port });
    assert.deepEqual(result, { status: "unknown", phase: "verify", productionReady: false });
    assert.equal(f.count(), 1); // transaction still open, never falsely report rollback
    f.db.exec("ROLLBACK");
    assert.equal(f.count(), 0);
  });
}

test("invalid environment never reads or invokes the adapter", async () => {
  const port = new Proxy({}, { get() { assert.fail("adapter read"); } });
  for (const environment of ["production", "", null, undefined]) {
    assert.equal((await runGs03Transaction({ environment, port })).status, "rejected");
  }
  assert.equal((await runGs03Transaction()).status, "rejected");
});

test("missing method and throwing method getter are rejected without calls", async (t) => {
  const f = fixture(t);
  delete f.port.commit;
  assert.equal((await runGs03Transaction({ environment: "test", port: f.port })).status, "rejected");
  assert.deepEqual(f.calls, []);
  Object.defineProperty(f.port, "commit", { get() { throw new Error("private"); } });
  assert.equal((await runGs03Transaction({ environment: "test", port: f.port })).status, "rejected");
  assert.deepEqual(f.calls, []);
});

test("async reentry uses the same exclusive adapter and does not start a second transaction", async (t) => {
  const f = fixture(t);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const apply = f.port.apply;
  f.port.apply = async () => { await gate; return apply(); };
  const first = runGs03Transaction({ environment: "development", port: f.port });
  assert.deepEqual(await runGs03Transaction({ environment: "test", port: f.port }),
    { status: "busy", phase: "admission", productionReady: false });
  release();
  assert.equal((await first).status, "confirmed-first");
  assert.equal(f.count(), 1);
  assert.equal(f.calls.filter((s) => s === "begin").length, 1);
});

test("result is fixed and does not expose arbitrary business objects", async (t) => {
  const f = fixture(t);
  f.port.apply = () => ({ kind: "first", patient: "private" });
  assert.deepEqual(await runGs03Transaction({ environment: "test", port: f.port }),
    { status: "rolled-back", phase: "apply", productionReady: false });
  assert.equal(f.count(), 0);
});

test("method getter reentry is busy before a second begin", async (t) => {
  const f = fixture(t);
  const begin = f.port.begin;
  let nested;
  Object.defineProperty(f.port, "begin", { get() {
    nested = runGs03Transaction({ environment: "test", port: f.port });
    return begin;
  } });
  assert.equal((await runGs03Transaction({ environment: "test", port: f.port })).status, "confirmed-first");
  assert.equal((await nested).status, "busy");
  assert.equal(f.calls.filter((s) => s === "begin").length, 1);
  assert.equal(f.count(), 1);
});

for (const malformed of ["missing", "getter"]) {
  test("admission rejection releases occupancy after " + malformed, async (t) => {
    const f = fixture(t);
    const commit = f.port.commit;
    if (malformed === "missing") delete f.port.commit;
    else Object.defineProperty(f.port, "commit", { configurable: true, get() { throw new Error("private"); } });
    assert.equal((await runGs03Transaction({ environment: "test", port: f.port })).status, "rejected");
    Object.defineProperty(f.port, "commit", { configurable: true, value: commit });
    assert.equal((await runGs03Transaction({ environment: "test", port: f.port })).status, "confirmed-first");
    assert.equal(f.count(), 1);
  });
}

test("async commit rejection after actual commit stays unknown", async (t) => {
  const f = fixture(t);
  f.port.commit = async () => { f.db.exec("COMMIT"); throw new Error("private"); };
  assert.equal((await runGs03Transaction({ environment: "test", port: f.port })).status, "unknown");
  assert.equal(f.count(), 1);
});

test("occupancy spans asynchronous rollback rejection", async (t) => {
  const f = fixture(t);
  let release, entered;
  const waiting = new Promise((resolve) => { release = resolve; });
  const rollbackEntered = new Promise((resolve) => { entered = resolve; });
  f.port.verify = () => false;
  f.port.rollback = async () => { entered(); await waiting; throw new Error("private"); };
  const first = runGs03Transaction({ environment: "test", port: f.port });
  await rollbackEntered;
  assert.equal((await runGs03Transaction({ environment: "test", port: f.port })).status, "busy");
  release();
  assert.equal((await first).status, "unknown");
  assert.equal(f.count(), 1);
  f.db.exec("ROLLBACK");
});
