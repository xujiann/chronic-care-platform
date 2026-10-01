"use strict";

// TEST-026: synthetic, disposable SQLite only. Passing here is not an HTTP,
// migration, production-authority, external-provider or site-acceptance proof.
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { fork } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { createExperiment, openExperiment } = require("./helpers/gs03-sqlite-experiment");

const NOW = "2026-10-01T12:00:00.000Z";
const LATER = "2026-10-01T12:01:00.000Z";
const EXPIRY = "2026-10-02T12:00:00.000Z";
const AUTH = { id: "auth-synthetic-1", residentId: "resident-synthetic-1", status: "active", purpose: "teleconsultation-callback", institutionId: "institution-synthetic-1", expiresAt: EXPIRY };
const CASE = { id: "case-synthetic-1", residentId: AUTH.residentId, authorizationId: AUTH.id, targetInstitutionId: AUTH.institutionId, status: "scheduled", allowedPrincipalIds: ["principal-synthetic-1", "principal-synthetic-2"] };
const PRINCIPAL = { id: "principal-synthetic-1", role: "institution", institutionId: AUTH.institutionId };
const INTENT = {
  feedback: { feedbackText: "synthetic feedback" },
  schedule: { meetingWindow: "2026-10-02T09:00:00.000Z", receivingDoctor: "synthetic-doctor" },
  report: { reportSummary: "synthetic report", externalReportId: "synthetic-report-1" }
};
const workerLifetimes = new WeakMap();

function fixture(t, { authorization = AUTH, caseRow = CASE } = {}) {
  let now = NOW;
  const experiment = createExperiment({ clock: () => now });
  experiment.seed({ authorizations: [authorization], cases: [caseRow] });
  const workers = [];
  workerLifetimes.set(experiment, workers);
  t.after(async () => {
    for (const worker of workers) if (worker.child.exitCode === null && worker.child.signalCode === null) worker.child.kill();
    await Promise.all(workers.map((worker) => worker.exited));
    experiment.close();
    experiment.cleanup();
  });
  return { experiment, now: () => now, setNow: (value) => { now = value; } };
}

function command(contract = "feedback", key = "synthetic-key-1", changes = {}) {
  return {
    principal: PRINCIPAL, contract, version: 2, key,
    targetId: CASE.id, authorizationId: AUTH.id,
    intent: { ...INTENT[contract] }, ...changes
  };
}

function denial(operation, expectedCode) {
  assert.throws(operation, (error) => {
    assert.equal(error.code, `GS03_EXPERIMENT_${expectedCode}`);
    assert.equal(Object.hasOwn(error, "receipt"), false);
    return true;
  });
}

function externalSnapshot(experiment) {
  const observer = openExperiment({ dbPath: experiment.dbPath, identity: experiment.identity, clock: () => NOW });
  try { return observer.snapshot(); }
  finally { observer.close(); }
}

function count(snapshot, name) {
  assert.ok(Array.isArray(snapshot[name]), `${name} must be a real SQLite table projection`);
  return snapshot[name].length;
}

for (const contract of ["feedback", "schedule", "report"]) {
  test(`${contract}: first commit persists complete facts; exact replay is zero-write`, (t) => {
    const { experiment } = fixture(t);
    const input = command(contract);
    const before = experiment.snapshot();
    const first = experiment.applyCallback(input);
    assert.equal(first.state, "confirmed");
    assert.equal(first.outcome, "first");
    assert.equal(first.receipt.targetId, CASE.id);
    assert.equal(first.receipt.authorizationId, AUTH.id);
    assert.equal(first.receipt.contract, contract);
    assert.equal(first.receipt.version, 2);
    assert.match(first.receipt.intentDigest, /^[0-9a-f]{64}$/);
    const after = experiment.snapshot();
    assert.equal(count(after, "receipts"), count(before, "receipts") + 1);
    assert.equal(count(after, "messages"), count(before, "messages") + 2);
    assert.equal(count(after, "events"), count(before, "events") + 1);
    assert.equal(count(after, "audit"), count(before, "audit") + 2);
    assert.equal(count(after, "auditSource"), count(before, "auditSource") + 2);
    assert.deepEqual(after.audit.map((row) => row.kind).sort(), ["access-success", "security-success"]);
    assert.ok(after.auditSource.every((row) => after.audit.some((audit) => audit.id === row.audit_id)), "synthetic source rows bind both success audits; not the platform v15 source");
    assert.equal(count(after, "reports"), count(before, "reports") + (contract === "report" ? 1 : 0));
    assert.notDeepEqual(after.cases, before.cases);
    const replay = experiment.applyCallback(input);
    assert.equal(replay.state, "confirmed");
    assert.equal(replay.outcome, "replay");
    assert.deepEqual(replay.receipt, first.receipt);
    assert.deepEqual(experiment.snapshot(), after);
  });
}

test("receipt namespace separates contracts and trusted principals; one namespace rejects changed intent and target", (t) => {
  const { experiment } = fixture(t);
  const first = experiment.applyCallback(command("feedback", "shared-key"));
  const stable = experiment.snapshot();
  denial(() => experiment.applyCallback(command("feedback", "shared-key", { intent: { feedbackText: "different synthetic feedback" } })), "RECEIPT_CONFLICT");
  assert.deepEqual(experiment.snapshot(), stable);
  assert.equal(experiment.applyCallback(command("schedule", "shared-key")).outcome, "first");
  assert.equal(experiment.applyCallback(command("feedback", "shared-key", {
    principal: { ...PRINCIPAL, id: "principal-synthetic-2" }
  })).outcome, "first");
  assert.equal(first.receipt.targetId, CASE.id);
  assert.equal(count(experiment.snapshot(), "receipts"), 3);

  const alternate = createExperiment({ clock: () => NOW });
  t.after(() => { alternate.close(); alternate.cleanup(); });
  alternate.seed({ authorizations: [AUTH], cases: [CASE, { ...CASE, id: "case-synthetic-2" }] });
  alternate.applyCallback(command("feedback", "target-bound-key"));
  const targetBound = alternate.snapshot();
  denial(() => alternate.applyCallback(command("feedback", "target-bound-key", { targetId: "case-synthetic-2" })), "RECEIPT_CONFLICT");
  assert.deepEqual(alternate.snapshot(), targetBound);
});

test("exact authorization binding fails closed for missing, resident, purpose, institution, scope, revoked and expired facts", (t) => {
  const { experiment } = fixture(t);
  const before = experiment.snapshot();
  denial(() => experiment.applyCallback(command("feedback", "missing-binding", { authorizationId: "other-auth" })), "AUTHORIZATION_DENIED");
  denial(() => experiment.applyCallback(command("feedback", "wrong-principal", { principal: { ...PRINCIPAL, id: "outsider" } })), "SCOPE_DENIED");
  denial(() => experiment.applyCallback(command("feedback", "wrong-institution", { principal: { ...PRINCIPAL, institutionId: "other-institution" } })), "SCOPE_DENIED");
  assert.deepEqual(experiment.snapshot(), before);
  const variants = [
    { authorization: { ...AUTH, residentId: "other-resident" } },
    { authorization: { ...AUTH, purpose: "other-purpose" } },
    { authorization: { ...AUTH, institutionId: "other-institution" } },
    { authorization: { ...AUTH, status: "revoked" } },
    { authorization: { ...AUTH, expiresAt: NOW } },
    { caseRow: { ...CASE, authorizationId: "unbound-auth" } },
    { caseRow: { ...CASE, status: "authorization-on-hold" } },
    { caseRow: { ...CASE, targetInstitutionId: "other-institution" }, expectedCode: "SCOPE_DENIED" }
  ];
  for (const [index, variant] of variants.entries()) {
    const inner = createExperiment({ clock: () => NOW });
    try {
      inner.seed({ authorizations: [variant.authorization || AUTH], cases: [variant.caseRow || CASE] });
      const original = inner.snapshot();
      denial(() => inner.applyCallback(command("feedback", `invalid-${index}`)), variant.expectedCode || "AUTHORIZATION_DENIED");
      assert.deepEqual(inner.snapshot(), original);
    } finally { inner.close(); inner.cleanup(); }
  }
});

test("expiry is rechecked before COMMIT and confirmed rollback has no business or receipt writes", (t) => {
  const { experiment, setNow } = fixture(t, { authorization: { ...AUTH, expiresAt: LATER } });
  const before = experiment.snapshot();
  assert.throws(() => experiment.applyCallback(command(), {
    onPhase(phase) { if (phase === "beforeCommit") setNow(LATER); }
  }), (error) => error.code === "GS03_EXPERIMENT_AUTHORIZATION_DENIED" && error.transactionState === "rolledback");
  assert.deepEqual(experiment.snapshot(), before);
});

test("expired authorization blocks both first arrival and old receipt replay/reconciliation", (t) => {
  const { experiment, setNow } = fixture(t, { authorization: { ...AUTH, expiresAt: LATER } });
  const prior = command("feedback", "before-expiry");
  experiment.applyCallback(prior);
  setNow(LATER);
  const before = externalSnapshot(experiment);
  denial(() => experiment.applyCallback(prior), "AUTHORIZATION_DENIED");
  denial(() => experiment.reconcile(prior), "AUTHORIZATION_DENIED");
  denial(() => experiment.applyCallback(command("feedback", "after-expiry")), "AUTHORIZATION_DENIED");
  assert.deepEqual(externalSnapshot(experiment), before);
});

test("a phase hook cannot rewrite the frozen canonical intent after validation", (t) => {
  const { experiment } = fixture(t);
  const input = command("feedback", "frozen-intent");
  const original = command("feedback", "frozen-intent");
  experiment.applyCallback(input, { onPhase(phase) {
    if (phase === "afterAuthorization") input.intent.feedbackText = "mutated after digest";
  } });
  assert.equal(experiment.snapshot().cases[0].feedback_text, INTENT.feedback.feedbackText);
  assert.equal(experiment.applyCallback(original).outcome, "replay");
  denial(() => experiment.applyCallback(input), "RECEIPT_CONFLICT");
});

test("each post-write fault rolls back report, two messages, success audit, simulated audit source and receipt together", (t) => {
  const { experiment } = fixture(t);
  const phases = ["after:business", "after:receipt", "after:event", "after:report", "after:message:1", "after:message:2", "after:audit", "after:accessAudit", "after:auditSource:1", "after:auditSource:2", "beforeCommit"];
  for (const [index, faultPhase] of phases.entries()) {
    const before = externalSnapshot(experiment);
    assert.throws(() => experiment.applyCallback(command("report", `fault-${index}`), {
      onPhase(phase) { if (phase === faultPhase) throw new Error("synthetic injected fault"); }
    }), (error) => error.transactionState === "rolledback", faultPhase);
    assert.deepEqual(externalSnapshot(experiment), before, faultPhase);
  }
  assert.equal(experiment.applyCallback(command("report", "fault-recovery")).outcome, "first");
});

test("an after-COMMIT response fault is acklost, not a claimed rollback", (t) => {
  const { experiment } = fixture(t);
  const input = command("report", "after-commit-fault");
  const before = externalSnapshot(experiment);
  assert.throws(() => experiment.applyCallback(input, {
    onPhase(phase) { if (phase === "afterCommit") throw new Error("synthetic response loss"); }
  }), (error) => error.transactionState === "acklost");
  assert.notDeepEqual(externalSnapshot(experiment), before);
  assert.equal(experiment.reconcile(input).state, "confirmed");
  const committed = externalSnapshot(experiment);
  assert.equal(experiment.applyCallback(input).outcome, "replay");
  assert.deepEqual(externalSnapshot(experiment), committed);
});

test("revoke blocks both first arrival and disclosure of an earlier committed replay or reconciliation", (t) => {
  const { experiment } = fixture(t);
  const prior = command("report", "pre-revoke");
  experiment.applyCallback(prior);
  const committed = experiment.snapshot();
  experiment.revokeAuthorization({ authorizationId: AUTH.id, at: NOW });
  const revoked = experiment.snapshot();
  assert.notDeepEqual(revoked, committed);
  denial(() => experiment.applyCallback(prior), "AUTHORIZATION_DENIED");
  denial(() => experiment.reconcile(prior), "AUTHORIZATION_DENIED");
  denial(() => experiment.applyCallback(command("report", "post-revoke")), "AUTHORIZATION_DENIED");
  assert.deepEqual(experiment.snapshot(), revoked);
});

test("more than 200 receipts stay durable, immutable and replayable without TTL or key reuse", (t) => {
  const { experiment } = fixture(t);
  const first = command("feedback", "retention-0");
  for (let index = 0; index < 205; index++) {
    assert.equal(experiment.applyCallback(command("feedback", `retention-${index}`)).outcome, "first");
  }
  assert.equal(count(experiment.snapshot(), "receipts"), 205);
  const reopened = openExperiment({ dbPath: experiment.dbPath, identity: experiment.identity, clock: () => NOW });
  try {
    const before = reopened.snapshot();
    assert.equal(reopened.applyCallback(first).outcome, "replay");
    assert.deepEqual(reopened.snapshot(), before);
  } finally { reopened.close(); }
});

test("physical SQLite rejects receipt UPDATE, DELETE and duplicate namespace/contract/version/key", (t) => {
  const { experiment } = fixture(t);
  experiment.applyCallback(command("feedback", "immutable-key"));
  const before = externalSnapshot(experiment);
  const db = new DatabaseSync(experiment.dbPath);
  try {
    const unique = db.prepare("PRAGMA index_list(receipts)").all().filter((row) => row.unique);
    assert.ok(unique.some((index) => {
      const fields = db.prepare(`PRAGMA index_info(${JSON.stringify(index.name)})`).all().map((row) => row.name);
      return ["namespace", "contract", "version", "idempotency_key"].every((field) => fields.includes(field));
    }), "receipt's durable composite uniqueness must be explicit");
    assert.throws(() => db.exec("UPDATE receipts SET intent_digest=intent_digest WHERE id=(SELECT id FROM receipts LIMIT 1)"));
    assert.throws(() => db.exec("DELETE FROM receipts WHERE id=(SELECT id FROM receipts LIMIT 1)"));
    assert.throws(() => db.exec(`INSERT INTO receipts(id,namespace,contract,version,idempotency_key,target_id,authorization_id,intent_digest,audit_ref,committed_at)
      SELECT 'synthetic-duplicate',namespace,contract,version,idempotency_key,target_id,authorization_id,intent_digest,audit_ref,committed_at FROM receipts LIMIT 1`));
  } finally { db.close(); }
  assert.deepEqual(externalSnapshot(experiment), before);
});

test("an unmarked database or wrong identity cannot be opened as this experiment", (t) => {
  const { experiment } = fixture(t);
  const known = externalSnapshot(experiment);
  denial(() => openExperiment({ dbPath: experiment.dbPath, identity: "not-the-identity", clock: () => NOW }), "FOREIGN_DATABASE");
  assert.deepEqual(externalSnapshot(experiment), known);
  const alienDirectory = path.join(experiment.directory, "gs03-sqlite-experiment-foreign");
  fs.mkdirSync(alienDirectory);
  const alien = path.join(alienDirectory, "experiment.sqlite");
  const db = new DatabaseSync(alien);
  db.exec("CREATE TABLE unrelated(id INTEGER PRIMARY KEY)");
  db.close();
  const digest = () => createHash("sha256").update(fs.readFileSync(alien)).digest("hex");
  const beforeFiles = fs.readdirSync(alienDirectory).sort();
  const beforeDigest = digest();
  denial(() => openExperiment({ dbPath: alien, identity: experiment.identity, clock: () => NOW }), "FOREIGN_DATABASE");
  assert.equal(digest(), beforeDigest);
  assert.deepEqual(fs.readdirSync(alienDirectory).sort(), beforeFiles, "foreign DB must gain no WAL, SHM or other file");
});

function spawnWorker(experiment, operation, request, { holdPhase = "", gateName = "" } = {}) {
  const gatePath = path.join(experiment.directory, gateName || `gate-${Math.random().toString(16).slice(2)}`);
  const encoded = Buffer.from(JSON.stringify({
    dbPath: experiment.dbPath, identity: experiment.identity, operation, request,
    holdPhase, gatePath, now: NOW
  })).toString("base64url");
  const child = fork(path.join(__dirname, "helpers", "gs03-sqlite-experiment-child.js"), [encoded], {
    cwd: __dirname, execArgv: [], windowsHide: true, stdio: ["ignore", "ignore", "pipe", "ipc"]
  });
  const messages = [];
  const listeners = new Set();
  let exit;
  const exited = new Promise((resolve) => { exit = resolve; });
  child.on("message", (message) => { messages.push(message); for (const listener of listeners) listener(); });
  child.on("exit", (code, signal) => { exit({ code, signal }); for (const listener of listeners) listener(); });
  function wait(predicate, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { listeners.delete(check); reject(new Error(`child message timeout: ${JSON.stringify(messages)}`)); }, timeoutMs);
      function check() {
        const found = messages.find(predicate);
        if (found) { clearTimeout(timer); listeners.delete(check); resolve(found); }
        else if (child.exitCode !== null) { clearTimeout(timer); listeners.delete(check); reject(new Error(`child exited before expected message: ${JSON.stringify(messages)}`)); }
      }
      listeners.add(check);
      check();
    });
  }
  async function waitAtGate(timeoutMs = 15000) {
    const marker = `${gatePath}.phase`;
    const deadline = Date.now() + timeoutMs;
    while (!fs.existsSync(marker)) {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`child exited before gate: ${JSON.stringify(messages)}`);
      if (Date.now() > deadline) throw new Error(`child gate timeout: ${JSON.stringify(messages)}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(fs.readFileSync(marker, "utf8"), holdPhase);
  }
  const worker = { child, messages, wait, waitAtGate, exited, release() { fs.writeFileSync(gatePath, "go"); } };
  const tracked = workerLifetimes.get(experiment);
  if (!tracked) throw new Error("synthetic child requires fixture-owned experiment");
  tracked.push(worker);
  return worker;
}

function callerObservation(worker) {
  return { state: worker.messages.some((message) => message.type === "result") ? "confirmed" : "unknown" };
}

test("two real processes competing for one key produce one first and one zero-write replay", async (t) => {
  const { experiment } = fixture(t);
  const input = command("report", "race-key");
  const first = spawnWorker(experiment, "callback", input, { holdPhase: "beforeCommit" });
  await first.waitAtGate();
  const second = spawnWorker(experiment, "callback", input);
  await second.wait((message) => message.type === "started");
  first.release();
  const a = await first.wait((message) => message.type === "result");
  const b = await second.wait((message) => message.type === "result");
  await Promise.all([first.exited, second.exited]);
  assert.deepEqual([a.result.outcome, b.result.outcome].sort(), ["first", "replay"]);
  assert.equal(count(experiment.snapshot(), "receipts"), 1);
  assert.equal(count(experiment.snapshot(), "messages"), 2);
});

test("controlled revoke-before-callback and callback-before-revoke commit orders are serialized across processes", async (t) => {
  const before = fixture(t);
  const revoke = spawnWorker(before.experiment, "revoke", { authorizationId: AUTH.id }, { holdPhase: "beforeCommit" });
  await revoke.waitAtGate();
  const denied = spawnWorker(before.experiment, "callback", command("report", "revoke-first"));
  await denied.wait((message) => message.type === "started");
  revoke.release();
  await revoke.wait((message) => message.type === "result");
  const rejection = await denied.wait((message) => message.type === "error");
  await Promise.all([revoke.exited, denied.exited]);
  assert.equal(rejection.code, "GS03_EXPERIMENT_AUTHORIZATION_DENIED");
  assert.equal(count(before.experiment.snapshot(), "receipts"), 0);

  const after = fixture(t);
  const callback = spawnWorker(after.experiment, "callback", command("report", "callback-first"), { holdPhase: "beforeCommit" });
  await callback.waitAtGate();
  const lateRevoke = spawnWorker(after.experiment, "revoke", { authorizationId: AUTH.id });
  await lateRevoke.wait((message) => message.type === "started");
  callback.release();
  assert.equal((await callback.wait((message) => message.type === "result")).result.outcome, "first");
  await lateRevoke.wait((message) => message.type === "result");
  await Promise.all([callback.exited, lateRevoke.exited]);
  assert.equal(count(after.experiment.snapshot(), "receipts"), 1);
  denial(() => after.experiment.applyCallback(command("report", "callback-first")), "AUTHORIZATION_DENIED");
});

test("process death before COMMIT rolls back; death after COMMIT loses response but same-key reconciliation recovers", async (t) => {
  const { experiment } = fixture(t);
  const prior = experiment.snapshot();
  const uncommitted = command("report", "killed-before-commit");
  const dying = spawnWorker(experiment, "callback", uncommitted, { holdPhase: "beforeCommit" });
  await dying.waitAtGate();
  dying.child.kill("SIGKILL");
  await dying.exited;
  assert.equal(callerObservation(dying).state, "unknown");
  assert.deepEqual(experiment.snapshot(), prior);
  const uncommittedReader = openExperiment({ dbPath: experiment.dbPath, identity: experiment.identity, clock: () => NOW });
  try { assert.equal(uncommittedReader.reconcile(uncommitted).state, "not-found"); }
  finally { uncommittedReader.close(); }
  assert.equal(experiment.applyCallback(uncommitted).outcome, "first");

  const committed = command("report", "killed-after-commit");
  const lost = spawnWorker(experiment, "callback", committed, { holdPhase: "afterCommit" });
  await lost.waitAtGate();
  lost.child.kill("SIGKILL");
  await lost.exited;
  assert.equal(lost.messages.some((message) => message.type === "result"), false);
  // The caller has no acknowledgement: state is UNKNOWN until a same-key read.
  assert.equal(callerObservation(lost).state, "unknown");
  const reopened = openExperiment({ dbPath: experiment.dbPath, identity: experiment.identity, clock: () => NOW });
  try {
    const recovered = reopened.reconcile(committed);
    assert.equal(recovered.state, "confirmed");
    const stable = reopened.snapshot();
    assert.equal(reopened.applyCallback(committed).outcome, "replay");
    assert.deepEqual(reopened.snapshot(), stable);
  } finally { reopened.close(); }
});
