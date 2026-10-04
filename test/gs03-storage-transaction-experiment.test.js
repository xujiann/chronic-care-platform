"use strict";

// TEST-027: disposable synthetic SQLite only. This is not an HTTP, provider,
// external-scope, restore, production-authority or formal v2 protocol proof.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { fork } = require("node:child_process");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { verifyAuditTrail } = require("../src/identity-security/audit-chain");
const { buildAuditDeliverySourceCandidate } = require("../src/identity-security/audit-delivery-source");
const { SQLITE_MIGRATIONS, SQLITE_SCHEMA_HEAD, applySqliteMigrations } = require("../src/platform/storage/sqlite-migrations");
const { GS03_CALLBACK_RECEIPT_MIGRATION } = require("../src/platform/storage/gs03-callback-receipt-migration");
const { createExperiment, openExperiment } = require("./helpers/gs03-storage-transaction-experiment");

const NOW = "2026-10-04T12:00:00.000Z";
const LATER = "2026-10-04T12:01:00.000Z";
const EXPIRY = "2026-10-05T12:00:00.000Z";
const AUTH = {
  id: "auth-synthetic-1", residentId: "resident-synthetic-1",
  targetInstitutionCode: "institution-synthetic-1", status: "active",
  purpose: "teleconsultation-callback", expiresAt: EXPIRY
};
const CASE = {
  id: "case-synthetic-1", residentId: AUTH.residentId,
  residentAuthorizationId: AUTH.id, targetInstitutionCode: AUTH.targetInstitutionCode,
  status: "active", allowedPrincipalIds: ["principal-synthetic-1", "principal-synthetic-2"]
};
const PRINCIPAL = { id: "principal-synthetic-1", role: "institution", institutionId: AUTH.targetInstitutionCode };
const OTHER_PRINCIPAL = { ...PRINCIPAL, id: "principal-synthetic-2" };
const INTENT = {
  feedback: { feedbackText: "synthetic feedback" },
  schedule: { meetingWindow: "2026-10-05T09:00:00.000Z", receivingDoctor: "synthetic-doctor" },
  report: { reportSummary: "synthetic report", externalReportId: "synthetic-report-1" }
};
const CONTRACT_ID = {
  feedback: "referral-feedback-callback",
  schedule: "referral-schedule-callback",
  report: "referral-report-callback"
};
const REQUIRED_COLLECTIONS = [
  "personalRecords", "referralTeleconsultations", "taskMessages", "securityEvents", "dataAccessLogs"
];
const workersByExperiment = new WeakMap();

function command(contract = "feedback", key = "synthetic-key", overrides = {}) {
  return {
    contract, version: 2, principal: PRINCIPAL, key,
    targetId: CASE.id, authorizationId: AUTH.id,
    intent: { ...INTENT[contract] }, ...overrides
  };
}

function fixture(t, { authorizations = [AUTH], cases = [CASE] } = {}) {
  let now = NOW;
  const experiment = createExperiment({ clock: () => now });
  experiment.seed({ authorizations, cases });
  const workers = [];
  workersByExperiment.set(experiment, workers);
  t.after(async () => {
    for (const worker of workers) {
      if (worker.child.exitCode === null && worker.child.signalCode === null) worker.child.kill();
    }
    await Promise.all(workers.map((worker) => worker.exited));
    for (const worker of workers) {
      for (const file of [worker.gatePath, `${worker.gatePath}.phase`]) {
        if (fs.existsSync(file)) fs.unlinkSync(file);
      }
    }
    experiment.close();
    experiment.cleanup();
  });
  return { experiment, setNow(value) { now = value; } };
}

function observed(experiment, { now = NOW } = {}) {
  const reader = openExperiment({ directory: experiment.directory, identity: experiment.identity, clock: () => now });
  try { return reader.snapshot(); }
  finally { reader.close(); }
}

function cloneOwnDatabase(t, experiment) {
  const root = path.dirname(experiment.directory);
  const directory = path.join(root, `gs03-storage-experiment-clone-${randomUUID()}`);
  assert.equal(path.dirname(directory), root);
  fs.mkdirSync(directory);
  const dbPath = path.join(directory, "experiment.sqlite");
  fs.copyFileSync(experiment.dbPath, dbPath, fs.constants.COPYFILE_EXCL);
  t.after(() => {
    assert.equal(path.dirname(directory), root);
    assert.equal(path.basename(directory).startsWith("gs03-storage-experiment-clone-"), true);
    assert.equal(fs.lstatSync(directory).isSymbolicLink(), false);
    for (const name of ["experiment.sqlite", "experiment.sqlite-wal", "experiment.sqlite-shm"]) {
      const file = path.join(directory, name);
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
    fs.rmdirSync(directory);
  });
  return { directory, dbPath };
}

function rebindSyntheticCase(experiment, caseId, authorizationId) {
  // Test-only competing writer: keep the case, collection version and exact
  // authorization reference mutually consistent before retrying the old key.
  const db = new DatabaseSync(experiment.dbPath);
  try {
    db.exec("PRAGMA foreign_keys=ON");
    db.exec("BEGIN IMMEDIATE");
    const row = db.prepare("SELECT payload, version FROM state_collections WHERE key='referralTeleconsultations'").get();
    assert.ok(row);
    const cases = JSON.parse(row.payload);
    const item = cases.find((entry) => entry.id === caseId);
    assert.ok(item);
    item.residentAuthorizationId = authorizationId;
    item.version += 1;
    const updated = db.prepare("UPDATE state_collections SET payload=?, version=version+1, updated_at=? WHERE key='referralTeleconsultations' AND version=?")
      .run(JSON.stringify(cases), NOW, row.version);
    assert.equal(updated.changes, 1);
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* preserve the setup failure */ }
    throw error;
  } finally { db.close(); }
}

function collection(snapshot, name) {
  const rows = snapshot.collections?.[name];
  assert.ok(Array.isArray(rows), `${name} must be a real state_collections projection`);
  return rows;
}

function denied(operation, code) {
  assert.throws(operation, (error) => {
    assert.equal(error.code, code);
    assert.equal(Object.hasOwn(error, "receipt"), false);
    return true;
  });
}

function assertSourceForEvent(snapshot, stream, event) {
  const source = snapshot.sourceEvents.find((row) => row.stream === stream && row.source_event_id === event.id);
  assert.ok(source, `${stream}/${event.id} must have a real v15 source row`);
  const candidate = buildAuditDeliverySourceCandidate(stream, event);
  assert.equal(source.source_digest, candidate.sourceDigest);
  assert.equal(source.projection_digest, candidate.projectionDigest);
  assert.deepEqual(JSON.parse(source.projection_json), candidate.projection);
  assert.equal(Number(source.historical_baseline), 0);
  return source;
}

function assertCompleteFirst(before, after, input, result) {
  assert.equal(result.state, "confirmed");
  assert.equal(result.outcome, "first");
  assert.deepEqual(Object.keys(result.receipt).sort(), ["authorizationId", "contract", "receiptId", "targetId"]);
  assert.equal(result.receipt.contract, input.contract);
  assert.equal(result.receipt.targetId, input.targetId);
  assert.equal(result.receipt.authorizationId, input.authorizationId);
  const receiptId = result.receipt.receiptId;
  const receipt = after.receipts.find((row) => row.receipt_id === receiptId);
  assert.ok(receipt, "first result must identify a durable S1 receipt");
  assert.equal(receipt.contract_id, CONTRACT_ID[input.contract]);
  assert.equal(Number(receipt.contract_version), 2);
  assert.equal(Number(receipt.intent_digest_version), 2);
  assert.equal(receipt.target_id, input.targetId);
  assert.equal(receipt.authorization_id, input.authorizationId);
  assert.equal(receipt.result_status, "committed");
  for (const digest of [receipt.namespace_digest, receipt.key_digest, receipt.intent_digest]) {
    assert.match(digest, /^[a-f0-9]{64}$/);
  }
  assert.equal(after.receipts.length, before.receipts.length + 1);
  const priorCase = collection(before, "referralTeleconsultations").find((row) => row.id === input.targetId);
  const nextCase = collection(after, "referralTeleconsultations").find((row) => row.id === input.targetId);
  assert.ok(priorCase && nextCase);
  assert.equal(nextCase.version, priorCase.version + 1);
  if (input.contract === "feedback") assert.equal(nextCase.feedbackText, input.intent.feedbackText);
  if (input.contract === "schedule") {
    assert.equal(nextCase.meetingWindow, input.intent.meetingWindow);
    assert.equal(nextCase.receivingDoctor, input.intent.receivingDoctor);
  }
  if (input.contract === "report") {
    assert.equal(nextCase.reportSummary, input.intent.reportSummary);
    assert.equal(nextCase.externalReportId, input.intent.externalReportId);
  }
  const priorReports = collection(before, "personalRecords").filter((row) => row.receiptId);
  const reports = collection(after, "personalRecords").filter((row) => row.receiptId === receiptId);
  assert.equal(reports.length, input.contract === "report" ? 1 : 0);
  assert.equal(collection(after, "personalRecords").filter((row) => row.receiptId).length,
    priorReports.length + (input.contract === "report" ? 1 : 0));
  if (input.contract === "report") {
    assert.deepEqual(reports[0], {
      id: `report:${receiptId}`, residentId: AUTH.residentId,
      caseId: input.targetId, targetId: input.targetId, authorizationId: input.authorizationId,
      externalReportId: input.intent.externalReportId, summary: input.intent.reportSummary, receiptId
    });
  }
  const messages = collection(after, "taskMessages").filter((row) => row.receiptId === receiptId);
  assert.equal(collection(after, "taskMessages").length, collection(before, "taskMessages").length + 2);
  assert.equal(messages.length, 2);
  assert.deepEqual(messages.map((row) => row.targetRole).sort(), ["receiver", "requester"]);
  for (const message of messages) {
    assert.equal(message.contractId, CONTRACT_ID[input.contract]);
    assert.equal(message.targetId, input.targetId);
    assert.equal(message.status, "queued");
  }
  const security = collection(after, "securityEvents").find((row) => row.id === receipt.security_audit_event_id);
  const access = collection(after, "dataAccessLogs").find((row) => row.id === receipt.access_audit_event_id);
  assert.ok(security && access);
  assert.equal(collection(after, "securityEvents").length, collection(before, "securityEvents").length + 1);
  assert.equal(collection(after, "dataAccessLogs").length, collection(before, "dataAccessLogs").length + 1);
  assert.equal(verifyAuditTrail(collection(after, "securityEvents")).passed, true);
  assert.equal(verifyAuditTrail(collection(after, "dataAccessLogs")).passed, true);
  for (const event of [security, access]) {
    assert.equal(event.actor, input.principal.id);
    assert.equal(event.receiptId, receiptId);
    assert.equal(event.contractId, CONTRACT_ID[input.contract]);
    assert.equal(event.result, "allowed");
  }
  assert.equal(security.target, input.targetId);
  assert.equal(access.scope, input.targetId);
  assert.equal(receipt.security_stream, "securityEvents");
  assert.equal(receipt.access_stream, "dataAccessLogs");
  const newSecuritySource = assertSourceForEvent(after, "securityEvents", security);
  const newAccessSource = assertSourceForEvent(after, "dataAccessLogs", access);
  assert.equal(after.sourceEvents.length, before.sourceEvents.length + 2);
  assert.equal(newSecuritySource.source_event_id, receipt.security_audit_event_id);
  assert.equal(newAccessSource.source_event_id, receipt.access_audit_event_id);
  const appended = after.sourceEvents.slice(before.sourceEvents.length).sort((a, b) => Number(a.sequence) - Number(b.sequence));
  assert.equal(appended[0].previous_source_hash, before.sourceEvents.at(-1)?.source_hash || "");
  assert.equal(appended[1].previous_source_hash, appended[0].source_hash);
}

function spawnWorker(experiment, operation, request, options = {}) {
  const gatePath = path.join(path.dirname(experiment.directory),
    `gate-${path.basename(experiment.directory)}-${randomUUID()}`);
  const encoded = Buffer.from(JSON.stringify({
    directory: experiment.directory, identity: experiment.identity, operation, request,
    holdPhase: options.holdPhase || "", failPhase: options.failPhase || "",
    busyTimeoutMs: options.busyTimeoutMs || 100, gatePath, now: options.now || NOW
  })).toString("base64url");
  const child = fork(path.join(__dirname, "helpers", "gs03-storage-transaction-experiment-child.js"), [encoded], {
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
      const timer = setTimeout(() => {
        listeners.delete(check);
        reject(new Error(`child message timeout: ${JSON.stringify(messages)}`));
      }, timeoutMs);
      function check() {
        const found = messages.find(predicate);
        if (found) { clearTimeout(timer); listeners.delete(check); resolve(found); }
        else if (child.exitCode !== null || child.signalCode !== null) {
          clearTimeout(timer); listeners.delete(check);
          reject(new Error(`child exited before expected message: ${JSON.stringify(messages)}`));
        }
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
    assert.equal(fs.readFileSync(marker, "utf8"), options.holdPhase);
  }
  const worker = {
    child, messages, exited, wait, waitAtGate, gatePath,
    release() { fs.writeFileSync(gatePath, "go", { flag: "wx" }); }
  };
  const tracked = workersByExperiment.get(experiment);
  if (!tracked) throw new Error("worker must belong to this test fixture");
  tracked.push(worker);
  return worker;
}

test("isolated candidate uses the real runner and v15 source without runtime registration", (t) => {
  const { experiment } = fixture(t);
  assert.equal(SQLITE_SCHEMA_HEAD, 19);
  assert.equal(SQLITE_MIGRATIONS.includes(GS03_CALLBACK_RECEIPT_MIGRATION), false);
  const defaultDb = new DatabaseSync(":memory:");
  try {
    applySqliteMigrations(defaultDb);
    assert.equal(Number(defaultDb.prepare("SELECT MAX(version) AS head FROM schema_migrations").get().head), 19);
    assert.equal(defaultDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().length, 41);
    assert.equal(defaultDb.prepare("SELECT 1 FROM sqlite_master WHERE name='gs03_callback_receipts'").get(), undefined);
  } finally { defaultDb.close(); }
  const db = new DatabaseSync(experiment.dbPath, { readOnly: true });
  try {
    db.exec("PRAGMA foreign_keys=ON");
    const userTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
    assert.equal(userTables.length, 42);
    assert.equal(Number(db.prepare("SELECT MAX(version) AS head FROM schema_migrations").get().head), 20);
    assert.equal(Number(db.prepare("PRAGMA foreign_keys").get().foreign_keys), 1);
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='audit_delivery_source_events'").get());
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='gs03_callback_receipts'").get());
    assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name='audit_source'").get(), undefined);
    assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name='experiment_metadata'").get(), undefined);
  } finally { db.close(); }
  const snapshot = observed(experiment);
  for (const name of REQUIRED_COLLECTIONS) collection(snapshot, name);
  assert.deepEqual(snapshot.receipts, []);
  assert.deepEqual(snapshot.sourceEvents, []);
  assert.equal(Object.hasOwn(snapshot.collections, "gs03CallbackReceipts"), false);
  assert.equal(Object.keys(require.cache).some((file) => file.endsWith(`${path.sep}server.js`)), false);
});

test("three contracts commit every owned fact, real audit source and S1 receipt once", (t) => {
  const { experiment } = fixture(t);
  for (const contract of ["feedback", "schedule", "report"]) {
    const input = command(contract, `first-${contract}`);
    const before = observed(experiment);
    const first = experiment.applyCallback(input);
    const after = observed(experiment);
    assertCompleteFirst(before, after, input, first);
    const replay = experiment.applyCallback(input);
    assert.deepEqual(replay, { ...first, outcome: "replay" });
    assert.deepEqual(observed(experiment), after, `${contract} replay must be zero-write`);
  }
});

test("same namespace conflicts do not leak old receipt; another authorized principal owns an independent key", (t) => {
  const second = { ...CASE, id: "case-synthetic-2" };
  const { experiment } = fixture(t, { cases: [CASE, second] });
  for (const contract of ["feedback", "schedule", "report"]) {
    const input = command(contract, `scope-${contract}`);
    const first = experiment.applyCallback(input);
    const stable = observed(experiment);
    for (const changedField of Object.keys(INTENT[contract])) {
      const changedIntent = { ...INTENT[contract] };
      changedIntent[changedField] = changedField === "meetingWindow"
        ? "2026-10-05T10:00:00.000Z"
        : `${changedIntent[changedField]}-different`;
      denied(() => experiment.applyCallback({ ...input, intent: changedIntent }), "RECEIPT_CONFLICT");
      assert.deepEqual(observed(experiment), stable, `${contract}.${changedField} conflict must be zero-write`);
    }
    denied(() => experiment.applyCallback({ ...input, targetId: second.id }), "RECEIPT_CONFLICT");
    denied(() => experiment.applyCallback({ ...input, authorizationId: "another-authorization" }), "AUTHORIZATION_REJECTED");
    assert.deepEqual(observed(experiment), stable);
    const other = { ...input, principal: OTHER_PRINCIPAL };
    const otherFirst = experiment.applyCallback(other);
    assert.equal(otherFirst.outcome, "first");
    assert.notEqual(otherFirst.receipt.receiptId, first.receipt.receiptId);
    assert.equal(experiment.applyCallback(other).outcome, "replay");
    assert.equal(observed(experiment).receipts.length, stable.receipts.length + 1);
  }
});

test("a valid new exact authorization on the same case conflicts with its old receipt key", (t) => {
  const successor = { ...AUTH, id: "auth-synthetic-successor" };
  for (const contract of ["feedback", "schedule", "report"]) {
    const { experiment } = fixture(t, { authorizations: [AUTH, successor] });
    const input = command(contract, `rebound-${contract}`);
    experiment.applyCallback(input);
    rebindSyntheticCase(experiment, CASE.id, successor.id);
    const beforeConflict = observed(experiment);
    denied(() => experiment.applyCallback({ ...input, authorizationId: successor.id }), "RECEIPT_CONFLICT");
    assert.deepEqual(observed(experiment), beforeConflict, `${contract} new valid authorization must not change facts/source`);
  }
});

test("current exact authorization and scope gate first arrival, replay and reconciliation", (t) => {
  const { experiment, setNow } = fixture(t);
  const input = command("report", "auth-recheck");
  const first = experiment.applyCallback(input);
  const committed = observed(experiment);
  denied(() => experiment.applyCallback({ ...input, principal: { ...PRINCIPAL, id: "outsider" } }), "AUTHORIZATION_REJECTED");
  denied(() => experiment.reconcile({ ...input, principal: { ...PRINCIPAL, id: "outsider" } }), "AUTHORIZATION_REJECTED");
  assert.deepEqual(observed(experiment), committed);
  setNow(EXPIRY);
  denied(() => experiment.applyCallback(input), "AUTHORIZATION_REJECTED");
  denied(() => experiment.reconcile(input), "AUTHORIZATION_REJECTED");
  denied(() => experiment.applyCallback(command("report", "expired-first")), "AUTHORIZATION_REJECTED");
  assert.deepEqual(observed(experiment), committed);
  assert.ok(first.receipt.receiptId);
});

test("reconciliation rechecks expiry before COMMIT and never discloses an old receipt", (t) => {
  const { experiment } = fixture(t, { authorizations: [{ ...AUTH, expiresAt: LATER }] });
  const input = command("report", "reconcile-expiry-crossing");
  experiment.applyCallback(input);
  const committed = observed(experiment);
  let clockReads = 0;
  const verifier = openExperiment({
    directory: experiment.directory, identity: experiment.identity,
    clock() { clockReads += 1; return clockReads === 1 ? NOW : LATER; }
  });
  try {
    denied(() => verifier.reconcile(input), "AUTHORIZATION_REJECTED");
  } finally { verifier.close(); }
  assert.ok(clockReads >= 2, "reconcile must read the clock again before committing its decision");
  assert.deepEqual(observed(experiment), committed, "failed reconciliation must leave all facts/source unchanged");
});

test("missing or changed exact authorization fails without substituting another grant", (t) => {
  const variants = [
    { authorizations: [{ ...AUTH, residentId: "another-resident" }] },
    { authorizations: [{ ...AUTH, targetInstitutionCode: "another-institution" }] },
    { authorizations: [{ ...AUTH, purpose: "another-purpose" }] },
    { authorizations: [{ ...AUTH, status: "revoked" }] },
    { authorizations: [{ ...AUTH, expiresAt: NOW }] },
    { cases: [{ ...CASE, residentAuthorizationId: "missing-authorization" }] },
    { cases: [{ ...CASE, allowedPrincipalIds: ["someone-else"] }] },
    { cases: [{ ...CASE, targetInstitutionCode: "another-institution" }] }
  ];
  for (const [index, variant] of variants.entries()) {
    const { experiment } = fixture(t, variant);
    const before = observed(experiment);
    denied(() => experiment.applyCallback(command("feedback", `invalid-${index}`)), "AUTHORIZATION_REJECTED");
    assert.deepEqual(observed(experiment), before, `variant ${index}`);
  }
  const { experiment } = fixture(t, {
    authorizations: [AUTH, { ...AUTH, id: "another-valid-grant" }],
    cases: [{ ...CASE, residentAuthorizationId: "missing-authorization" }]
  });
  const before = observed(experiment);
  denied(() => experiment.applyCallback(command("feedback", "no-substitute", {
    authorizationId: "another-valid-grant"
  })), "AUTHORIZATION_REJECTED");
  assert.deepEqual(observed(experiment), before);
});

test("lock-inside read sees a revoked authorization even when the case version is unchanged", (t) => {
  const { experiment } = fixture(t);
  const stale = observed(experiment);
  assert.equal(stale.collections.personalRecords[0].status, "active");
  const caseVersion = stale.collectionVersions.referralTeleconsultations;
  experiment.revokeAuthorization({ authorizationId: AUTH.id });
  const revoked = observed(experiment);
  assert.equal(revoked.collectionVersions.referralTeleconsultations, caseVersion);
  assert.ok(revoked.collectionVersions.personalRecords > stale.collectionVersions.personalRecords);
  denied(() => experiment.applyCallback(command("schedule", "stale-read")), "AUTHORIZATION_REJECTED");
  assert.deepEqual(observed(experiment), revoked);
});

test("expiry at the commit boundary and each staged fact fault roll back real source and receipt", (t) => {
  const { experiment, setNow } = fixture(t, { authorizations: [{ ...AUTH, expiresAt: LATER }] });
  const beforeExpiry = observed(experiment);
  assert.throws(() => experiment.applyCallback(command("report", "expires-before-commit"), {
    onPhase(name) { if (name === "beforeCommit") setNow(LATER); }
  }), (error) => error.code === "AUTHORIZATION_REJECTED" && error.outcome === "rolledback");
  assert.deepEqual(observed(experiment), beforeExpiry);
  setNow(NOW);
  const phases = [
    "afterBusiness", "afterReport", "afterMessage1", "afterMessage2", "afterSecurityAudit",
    "afterAccessAudit", "afterSecuritySource", "afterAccessSource", "beforeReceipt", "afterReceipt", "beforeCommit"
  ];
  for (const [index, phase] of phases.entries()) {
    const before = observed(experiment);
    assert.throws(() => experiment.applyCallback(command("report", `fault-${index}`), {
      onPhase(name) { if (name === phase) throw new Error(`injected ${phase}`); }
    }), (error) => error.outcome === "rolledback", phase);
    assert.deepEqual(observed(experiment), before, `${phase} must leave no committed fact`);
  }
  assert.equal(experiment.applyCallback(command("report", "post-fault-recovery")).outcome, "first");
});

test("a post-COMMIT acknowledgement fault is a committed write recovered by the same key", (t) => {
  const { experiment } = fixture(t);
  const input = command("schedule", "ack-lost");
  const before = observed(experiment);
  assert.throws(() => experiment.applyCallback(input, {
    onPhase(name) { if (name === "afterCommit") throw new Error("synthetic response lost"); }
  }), (error) => error.outcome === "ack-lost");
  const committed = observed(experiment);
  assert.equal(committed.receipts.length, before.receipts.length + 1);
  const recovered = experiment.reconcile(input);
  assert.equal(recovered.state, "confirmed");
  assert.equal(experiment.applyCallback(input).outcome, "replay");
  assert.deepEqual(observed(experiment), committed);
});

test("valid old v15 source IDs for another actor or target cannot be borrowed by a new receipt", (t) => {
  const otherCase = { ...CASE, id: "case-synthetic-2" };
  const { experiment } = fixture(t, { cases: [CASE, otherCase] });
  const old = experiment.applyCallback(command("feedback", "old-source"));
  const oldReceipt = observed(experiment).receipts.find((row) => row.receipt_id === old.receipt.receiptId);
  assert.ok(oldReceipt);
  for (const changed of [
    { targetId: otherCase.id },
    { principal: OTHER_PRINCIPAL }
  ]) {
    const before = observed(experiment);
    denied(() => experiment.applyCallback(command("report", `borrow-${changed.targetId || changed.principal.id}`, changed), {
      testOnlyAuditRefOverride: {
        securityAuditEventId: oldReceipt.security_audit_event_id,
        accessAuditEventId: oldReceipt.access_audit_event_id
      }
    }), "AUDIT_REFERENCE_MISMATCH");
    assert.deepEqual(observed(experiment), before);
  }
});

test("two processes sharing a key serialize to one first and one zero-write replay", async (t) => {
  const { experiment } = fixture(t);
  const input = command("report", "race-key");
  const before = observed(experiment);
  const first = spawnWorker(experiment, "callback", input, { holdPhase: "beforeCommit", busyTimeoutMs: 5000 });
  await first.waitAtGate();
  const second = spawnWorker(experiment, "callback", input, { busyTimeoutMs: 5000 });
  await second.wait((message) => message.type === "started");
  first.release();
  const a = await first.wait((message) => message.type === "result");
  const b = await second.wait((message) => message.type === "result");
  await Promise.all([first.exited, second.exited]);
  assert.deepEqual([a.result.outcome, b.result.outcome].sort(), ["first", "replay"]);
  assert.deepEqual(a.result.receipt, b.result.receipt);
  assertCompleteFirst(before, observed(experiment), input, a.result.outcome === "first" ? a.result : b.result);
});

test("revoke-first and callback-first orders are serialized across real processes", async (t) => {
  const before = fixture(t);
  const revoke = spawnWorker(before.experiment, "revoke", { authorizationId: AUTH.id }, {
    holdPhase: "beforeCommit", busyTimeoutMs: 5000
  });
  await revoke.waitAtGate();
  const deniedWorker = spawnWorker(before.experiment, "callback", command("report", "revoke-first"), {
    busyTimeoutMs: 5000
  });
  await deniedWorker.wait((message) => message.type === "started");
  revoke.release();
  await revoke.wait((message) => message.type === "result");
  const rejection = await deniedWorker.wait((message) => message.type === "error");
  assert.equal(rejection.code, "AUTHORIZATION_REJECTED");
  await Promise.all([revoke.exited, deniedWorker.exited]);
  assert.equal(observed(before.experiment).receipts.length, 0);

  const after = fixture(t);
  const input = command("report", "callback-first");
  const callback = spawnWorker(after.experiment, "callback", input, {
    holdPhase: "beforeCommit", busyTimeoutMs: 5000
  });
  await callback.waitAtGate();
  const lateRevoke = spawnWorker(after.experiment, "revoke", { authorizationId: AUTH.id }, {
    busyTimeoutMs: 5000
  });
  await lateRevoke.wait((message) => message.type === "started");
  callback.release();
  assert.equal((await callback.wait((message) => message.type === "result")).result.outcome, "first");
  await lateRevoke.wait((message) => message.type === "result");
  await Promise.all([callback.exited, lateRevoke.exited]);
  assert.equal(observed(after.experiment).receipts.length, 1);
  denied(() => after.experiment.applyCallback(input), "AUTHORIZATION_REJECTED");
  denied(() => after.experiment.reconcile(input), "AUTHORIZATION_REJECTED");
});

test("a held writer makes new-connection reconciliation unknown until commit or rollback", async (t) => {
  for (const terminal of ["commit", "rollback"]) {
    const { experiment } = fixture(t);
    const input = command("feedback", `inflight-${terminal}`);
    const writer = spawnWorker(experiment, "callback", input, {
      holdPhase: "beforeCommit", failPhase: terminal === "rollback" ? "beforeCommit" : "",
      busyTimeoutMs: 5000
    });
    await writer.waitAtGate();
    const ordinaryReader = new DatabaseSync(experiment.dbPath, { readOnly: true });
    try {
      const count = Number(ordinaryReader.prepare("SELECT COUNT(*) AS n FROM gs03_callback_receipts").get().n);
      assert.equal(count, 0, "ordinary absence while a writer holds the transaction proves nothing");
    } finally { ordinaryReader.close(); }
    const reconciling = openExperiment({
      directory: experiment.directory, identity: experiment.identity, clock: () => NOW, busyTimeoutMs: 100
    });
    try { assert.deepEqual(reconciling.reconcile(input, { busyTimeoutMs: 100 }), { state: "unknown" }); }
    finally { reconciling.close(); }
    writer.release();
    const terminalMessage = await writer.wait((message) => message.type === (terminal === "commit" ? "result" : "error"));
    if (terminal === "rollback") assert.equal(terminalMessage.outcome, "rolledback");
    await writer.exited;
    const reopened = openExperiment({ directory: experiment.directory, identity: experiment.identity, clock: () => NOW });
    try {
      const verified = reopened.reconcile(input);
      assert.equal(verified.state, terminal === "commit" ? "confirmed" : "not-found");
      if (terminal === "rollback") assert.equal(observed(experiment).receipts.length, 0);
    } finally { reopened.close(); }
  }
});

test("process death around COMMIT is caller-unknown until current-scope same-key recovery", async (t) => {
  const { experiment } = fixture(t);
  const uncommitted = command("report", "killed-before-commit");
  const before = observed(experiment);
  const dying = spawnWorker(experiment, "callback", uncommitted, { holdPhase: "beforeCommit" });
  await dying.waitAtGate();
  dying.child.kill("SIGKILL");
  await dying.exited;
  assert.equal(dying.messages.some((message) => message.type === "result"), false);
  assert.deepEqual(observed(experiment), before);
  const reopenedBefore = openExperiment({ directory: experiment.directory, identity: experiment.identity, clock: () => NOW });
  try { assert.equal(reopenedBefore.reconcile(uncommitted).state, "not-found"); }
  finally { reopenedBefore.close(); }

  const committed = command("report", "killed-after-commit");
  const lost = spawnWorker(experiment, "callback", committed, { holdPhase: "afterCommit" });
  await lost.waitAtGate();
  lost.child.kill("SIGKILL");
  await lost.exited;
  assert.equal(lost.messages.some((message) => message.type === "result"), false);
  const reopenedAfter = openExperiment({ directory: experiment.directory, identity: experiment.identity, clock: () => NOW });
  try {
    assert.equal(reopenedAfter.reconcile(committed).state, "confirmed");
    const stable = reopenedAfter.snapshot();
    assert.equal(reopenedAfter.applyCallback(committed).outcome, "replay");
    assert.deepEqual(reopenedAfter.snapshot(), stable);
  } finally { reopenedAfter.close(); }
});

test("path, identity, ledger and exact schema checks reject foreign databases before mutation", (t) => {
  const { experiment } = fixture(t);
  const current = observed(experiment);
  denied(() => openExperiment({ directory: experiment.directory, identity: "wrong-identity" }), "FOREIGN_DATABASE");
  assert.deepEqual(observed(experiment), current);
  const alien = path.join(experiment.directory, "alien.sqlite");
  const db = new DatabaseSync(alien);
  db.exec("CREATE TABLE unrelated(id INTEGER PRIMARY KEY)");
  db.close();
  const checksum = () => createHash("sha256").update(fs.readFileSync(alien)).digest("hex");
  const originalBytes = checksum();
  const originalFiles = fs.readdirSync(experiment.directory).sort();
  denied(() => openExperiment({ directory: alien, identity: experiment.identity }), "FOREIGN_FILE");
  assert.equal(checksum(), originalBytes);
  assert.deepEqual(fs.readdirSync(experiment.directory).sort(), originalFiles);
  fs.unlinkSync(alien);
  assert.deepEqual(observed(experiment), current);
  assert.equal(path.resolve(experiment.directory).includes("OneDrive"), false);
  if (process.platform === "win32") {
    assert.equal(path.resolve(experiment.directory).toLowerCase().startsWith("c:\\users\\drxuj\\temp\\"), true);
    assert.equal(path.resolve(experiment.directory).toLowerCase().includes("appdata"), false);
  } else {
    assert.equal(path.relative(fs.realpathSync(os.tmpdir()), fs.realpathSync(experiment.directory)).startsWith(".."), false);
  }
});

test("a copied experiment with ledger or exact-schema drift is refused without repair", (t) => {
  const { experiment } = fixture(t);
  for (const defect of ["ledger", "schema"]) {
    const clone = cloneOwnDatabase(t, experiment);
    const db = new DatabaseSync(clone.dbPath);
    try {
      if (defect === "ledger") {
        db.prepare("UPDATE schema_migrations SET checksum=? WHERE version=20").run("f".repeat(64));
      } else {
        db.exec("CREATE INDEX gs03_synthetic_rogue ON storage_events(event)");
      }
    } finally { db.close(); }
    const digest = () => createHash("sha256").update(fs.readFileSync(clone.dbPath)).digest("hex");
    const before = digest();
    const files = fs.readdirSync(clone.directory).sort();
    denied(() => openExperiment({ directory: clone.directory, identity: experiment.identity }),
      defect === "ledger" ? "LEDGER_DRIFT" : "SCHEMA_DRIFT");
    assert.equal(digest(), before);
    assert.deepEqual(fs.readdirSync(clone.directory).sort(), files);
  }
});

test("a symlinked experiment path is rejected before touching its target", (t) => {
  const { experiment } = fixture(t);
  const root = path.dirname(experiment.directory);
  const targetDigest = createHash("sha256").update(fs.readFileSync(experiment.dbPath)).digest("hex");
  const targetFiles = fs.readdirSync(experiment.directory).sort();
  if (process.platform === "win32") {
    const junction = path.join(root, `gs03-storage-experiment-clone-${randomUUID()}`);
    try { fs.symlinkSync(experiment.directory, junction, "junction"); }
    catch (error) {
      if (["EPERM", "EACCES"].includes(error.code)) {
        t.skip("Windows denied creating a junction; symlink rejection is unverified on this host");
        return;
      }
      throw error;
    }
    t.after(() => {
      assert.equal(fs.lstatSync(junction).isSymbolicLink(), true);
      fs.rmSync(junction, { force: true });
    });
    assert.equal(fs.lstatSync(junction).isSymbolicLink(), true);
    assert.equal(fs.realpathSync(junction), fs.realpathSync(experiment.directory));
    denied(() => openExperiment({ directory: junction, identity: experiment.identity }), "UNSAFE_LINK");
  } else {
    const directory = path.join(root, `gs03-storage-experiment-clone-${randomUUID()}`);
    fs.mkdirSync(directory);
    const link = path.join(directory, "experiment.sqlite");
    t.after(() => {
      try { fs.unlinkSync(link); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      fs.rmdirSync(directory);
    });
    try { fs.symlinkSync(experiment.dbPath, link, "file"); }
    catch (error) {
      if (["EPERM", "EACCES"].includes(error.code)) {
        t.skip("Host denied creating a file symlink; rejection is unverified here");
        return;
      }
      throw error;
    }
    assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
    denied(() => openExperiment({ directory, identity: experiment.identity }), "UNSAFE_LINK");
  }
  assert.equal(createHash("sha256").update(fs.readFileSync(experiment.dbPath)).digest("hex"), targetDigest);
  assert.deepEqual(fs.readdirSync(experiment.directory).sort(), targetFiles);
});
