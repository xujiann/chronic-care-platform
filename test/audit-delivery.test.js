"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { auditHashFor } = require("../src/identity-security/audit-chain");
const { AUDIT_DELIVERY_SOURCE_CONTRACT } = require("../src/identity-security/audit-delivery-source");
const { applySqliteMigrations } = require("../src/platform/storage/sqlite-migrations");
const {
  assessAuditDeliveryConfig,
  auditWriteFailureSignal,
  buildAuditBatch,
  createPilotCutoverAuditLifecycleBridge,
  createSecureAuditTransport,
  createSiemAuditAdapter,
  createWormAuditAdapter,
  runAuditDeliveryCycle
} = require("../src/platform/operations/audit-delivery");
const { acquireWorkerLock, createOperationalSignalEmitter, readCheckpoint, runWorker } = require("../scripts/audit-delivery-worker");

const RECORDS = [
  { trail: "securityEvents", record: { id: "event-1", action: "login", result: "allowed" } },
  { trail: "dataAccessLogs", record: { id: "access-1", action: "read", result: "allowed" } }
];

function seal(rows) {
  let previousAuditHash = "";
  return rows.slice().reverse().map((row) => {
    const item = { ...row, previousAuditHash };
    item.auditHash = auditHashFor(item);
    previousAuditHash = item.auditHash;
    return item;
  }).reverse();
}

function createAuditDatabase(file) {
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(file);
  db.exec("CREATE TABLE state_collections (key TEXT PRIMARY KEY, payload TEXT NOT NULL)");
  const insert = db.prepare("INSERT INTO state_collections (key, payload) VALUES (?, ?)");
  for (const trail of ["securityEvents", "dataAccessLogs"]) insert.run(trail, JSON.stringify(seal(RECORDS.filter((item) => item.trail === trail).map((item) => item.record))));
  db.close();
}

function createAppendOnlyAuditDatabase(file) {
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(file);
  applySqliteMigrations(db, { targetVersion: 14 });
  const insert = db.prepare("INSERT INTO state_collections (key, payload, updated_at, version) VALUES (?, ?, ?, 1)");
  insert.run("securityEvents", JSON.stringify(seal([{
    id: "event-append-1",
    at: "2026-08-22T01:00:00.000Z",
    action: "login",
    result: "allowed",
    role: "administrator",
    actor: "sensitive-actor-account",
    target: "identity-console",
    detail: "sensitive free text"
  }])), "2026-08-22T02:00:00.000Z");
  insert.run("dataAccessLogs", JSON.stringify(seal([{
    id: "access-append-1",
    at: "2026-08-22T01:01:00.000Z",
    result: "allowed",
    role: "doctor",
    actor: "doctor-account-secret",
    personIndex: "person-index-secret",
    residentId: "resident-secret",
    scope: "clinical-record",
    purpose: "sensitive purpose"
  }])), "2026-08-22T02:00:00.000Z");
  applySqliteMigrations(db);
  db.close();
}

test("WORM adapter is create-only idempotent and rejects immutable content drift", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "audit-worm-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const adapter = createWormAuditAdapter({ directory });
  const batch = buildAuditBatch(RECORDS, { createdAt: "2026-08-20T00:00:00.000Z" });
  const first = await adapter.deliver(batch);
  assert.equal((await adapter.deliver(buildAuditBatch(RECORDS))).receiptId, first.receiptId);
  const target = path.join(directory, `${batch.batchId}.json`);
  fs.chmodSync(target, 0o600);
  const tampered = JSON.parse(fs.readFileSync(target, "utf8"));
  tampered.records[0].record.result = "tampered";
  fs.writeFileSync(target, JSON.stringify(tampered));
  fs.chmodSync(target, 0o400);
  await assert.rejects(adapter.deliver(batch), { code: "AUDIT_WORM_CONFLICT" });
  assert.throws(() => buildAuditBatch(RECORDS, { batchId: "../escape" }), { code: "AUDIT_BATCH_ID_INVALID" });
});

test("SIEM delivery retries within Retry-After bounds and requires a batch-bound receipt", async () => {
  const delays = [];
  const batch = buildAuditBatch(RECORDS);
  let attempts = 0;
  const adapter = createSiemAuditAdapter({
    endpoint: "https://siem.example.gov.cn/audit",
    signingSecret: "a".repeat(32),
    maxAttempts: 2,
    maxDelayMs: 1000,
    sleep: async (delay) => delays.push(delay),
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) return { ok: false, status: 429, headers: { "retry-after": "60" }, text: async () => "{}" };
      return { ok: true, status: 202, text: async () => JSON.stringify({ receiptId: "receipt-1", batchId: batch.batchId, digest: batch.digest, recordCount: batch.recordCount }) };
    }
  });
  const result = await runAuditDeliveryCycle({ adapter, records: RECORDS });
  assert.equal(result.ok, true);
  assert.deepEqual(delays, [1000]);

  const mismatched = createSiemAuditAdapter({ endpoint: "https://siem.example.gov.cn/audit", signingSecret: "b".repeat(32), maxAttempts: 1, fetchImpl: async () => ({ ok: true, status: 202, text: async () => JSON.stringify({ receiptId: "bad", batchId: "other", digest: batch.digest, recordCount: batch.recordCount }) }) });
  assert.equal((await runAuditDeliveryCycle({ adapter: mismatched, records: RECORDS })).ok, false);
});

test("secure audit transport enforces TLS verification and complete mTLS", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "audit-tls-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const cert = path.join(directory, "cert.pem");
  fs.writeFileSync(cert, "fixture");
  assert.throws(() => createSecureAuditTransport({ env: { NODE_ENV: "production", NODE_TLS_REJECT_UNAUTHORIZED: "0" } }), { code: "AUDIT_TLS_VERIFICATION_DISABLED" });
  assert.throws(() => createSecureAuditTransport({ env: { NODE_ENV: "production" }, clientCertFile: cert }), { code: "AUDIT_MTLS_CONFIG_INVALID" });
  assert.throws(() => createSecureAuditTransport({ env: { NODE_ENV: " production ", SIEM_AUDIT_CA_FILE: "relative-ca.pem" } }), { code: "AUDIT_TLS_FILE_INVALID" });
  assert.throws(() => createSiemAuditAdapter({
    env: {
      NODE_ENV: "production",
      SIEM_AUDIT_ENDPOINT: "https://siem.example.gov.cn/audit",
      SIEM_AUDIT_SIGNING_SECRET: "a".repeat(32),
      SIEM_AUDIT_TLS_MODE: "mtls"
    },
    fetchImpl: async () => { throw new Error("must not fetch"); }
  }), { code: "AUDIT_MTLS_CONFIG_INVALID" });
});

test("production preflight requires one external target dedicated identity and explicit TLS", () => {
  const ready = assessAuditDeliveryConfig({
    SIEM_AUDIT_ENDPOINT: "https://siem.example.gov.cn/audit",
    SIEM_AUDIT_SIGNING_SECRET: "a".repeat(32),
    SIEM_AUDIT_TLS_MODE: "mtls",
    SIEM_AUDIT_CLIENT_CERT_FILE: "C:\\secrets\\audit-client.pem",
    SIEM_AUDIT_CLIENT_KEY_FILE: "C:\\secrets\\audit-client.key",
    AUDIT_DELIVERY_CHECKPOINT_PATH: "C:\\health-data\\audit-state\\checkpoint.json",
    AUDIT_DELIVERY_SOURCE_CONTRACT: "append-only-audit-source-v2",
    AUDIT_DELIVERY_SERVICE_USER: "health-audit",
    AUDIT_DELIVERY_SERVICE_GROUP: "health-audit",
    PLATFORM_PILOT_CUTOVER_ALERT_JOURNAL_FILE: "C:\\health-data\\audit-state\\alerts.json"
  }, { root: path.resolve(__dirname, ".."), sourceContinuityImplemented: true });
  assert.equal(ready.ready, process.platform === "win32");
  assert.equal(ready.productionReady, false);
  const unsafe = assessAuditDeliveryConfig({ SIEM_AUDIT_ENDPOINT: "http://siem.invalid", AUDIT_WORM_DIRECTORY: "/tmp/worm", AUDIT_DELIVERY_SERVICE_USER: "root", NODE_TLS_REJECT_UNAUTHORIZED: "0" });
  assert.equal(unsafe.ready, false);
});

test("SIEM retry bounds honor the documented environment contract", async () => {
  const delays = [];
  const batch = buildAuditBatch(RECORDS);
  let attempts = 0;
  const adapter = createSiemAuditAdapter({
    env: {
      SIEM_AUDIT_ENDPOINT: "https://siem.example.gov.cn/audit",
      SIEM_AUDIT_SIGNING_SECRET: "c".repeat(32),
      AUDIT_DELIVERY_MAX_ATTEMPTS: "2",
      AUDIT_DELIVERY_RETRY_BASE_MS: "50",
      AUDIT_DELIVERY_MAX_RETRY_DELAY_MS: "175"
    },
    sleep: async (delay) => delays.push(delay),
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) return { ok: false, status: 503, headers: { "retry-after": "60" }, text: async () => "{}" };
      return { ok: true, status: 202, text: async () => JSON.stringify({ receiptId: "receipt-env", batchId: batch.batchId, digest: batch.digest, recordCount: batch.recordCount }) };
    }
  });
  assert.equal((await adapter.deliver(batch)).acknowledged, true);
  assert.deepEqual(delays, [175]);
});

test("production preflight rejects runtime-invalid endpoints placeholders missing material and snapshot sources", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "audit-preflight-strict-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const checkpoint = path.join(directory, "state", "checkpoint.json");
  const alertJournal = path.join(directory, "alerts", "journal.json");
  fs.mkdirSync(path.dirname(checkpoint), { recursive: true });
  fs.mkdirSync(path.dirname(alertJournal), { recursive: true });
  const report = assessAuditDeliveryConfig({
    NODE_ENV: "production",
    SIEM_AUDIT_ENDPOINT: "https://",
    SIEM_AUDIT_SIGNING_SECRET: "replace-with-secret-manager-value-0000",
    SIEM_AUDIT_TLS_MODE: "mtls",
    SIEM_AUDIT_CLIENT_CERT_FILE: path.join(directory, "missing-cert.pem"),
    SIEM_AUDIT_CLIENT_KEY_FILE: path.join(directory, "missing-key.pem"),
    AUDIT_DELIVERY_CHECKPOINT_PATH: checkpoint,
    AUDIT_DELIVERY_SOURCE_CONTRACT: "snapshot-rehearsal-v1",
    AUDIT_DELIVERY_SERVICE_USER: "health-audit",
    AUDIT_DELIVERY_SERVICE_GROUP: "health-audit",
    PLATFORM_PILOT_CUTOVER_ALERT_JOURNAL_FILE: alertJournal
  }, { root: path.resolve(__dirname, ".."), checkFilesystem: true });
  const failed = new Set(report.checks.filter((item) => !item.passed).map((item) => item.id));
  assert.equal(report.ready, false);
  assert.equal(failed.has("audit-delivery:siem-url"), true);
  assert.equal(failed.has("audit-delivery:signing-secret"), true);
  assert.equal(failed.has("audit-delivery:mtls-material"), true);
  assert.equal(failed.has("audit-delivery:source-continuity"), true);
});

test("non-production WORM rehearsal passes the same filesystem-aware preflight", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "audit-worm-rehearsal-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const worm = path.join(directory, "worm");
  const checkpointDirectory = path.join(directory, "checkpoint");
  fs.mkdirSync(worm, { mode: 0o700 });
  fs.mkdirSync(checkpointDirectory, { mode: 0o700 });
  const report = assessAuditDeliveryConfig({
    NODE_ENV: "staging",
    AUDIT_WORM_DIRECTORY: worm,
    AUDIT_DELIVERY_CHECKPOINT_PATH: path.join(checkpointDirectory, "checkpoint.json"),
    AUDIT_DELIVERY_SOURCE_CONTRACT: "snapshot-rehearsal-v1",
    AUDIT_DELIVERY_SERVICE_USER: "health-audit",
    AUDIT_DELIVERY_SERVICE_GROUP: "health-audit"
  }, { root: path.resolve(__dirname, ".."), checkFilesystem: true });
  assert.equal(report.ready, true);
  assert.equal(report.productionReady, false);

  const env = {
    ...process.env,
    NODE_ENV: "staging",
    AUDIT_WORM_DIRECTORY: worm,
    AUDIT_DELIVERY_CHECKPOINT_PATH: path.join(checkpointDirectory, "checkpoint.json"),
    AUDIT_DELIVERY_SOURCE_CONTRACT: "snapshot-rehearsal-v1",
    AUDIT_DELIVERY_SERVICE_USER: "health-audit",
    AUDIT_DELIVERY_SERVICE_GROUP: "health-audit"
  };
  ["SIEM_AUDIT_ENDPOINT", "SIEM_AUDIT_SIGNING_SECRET", "SIEM_AUDIT_TLS_MODE", "SIEM_AUDIT_CA_FILE", "SIEM_AUDIT_CLIENT_CERT_FILE", "SIEM_AUDIT_CLIENT_KEY_FILE"].forEach((name) => delete env[name]);
  const cli = spawnSync(process.execPath, [path.resolve(__dirname, "../scripts/audit-delivery-preflight.js")], { encoding: "utf8", env });
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(JSON.parse(cli.stdout).ready, true);
});

test("TLS mode and configured material cannot drift between preflight and runtime", () => {
  const env = {
    NODE_ENV: "production",
    SIEM_AUDIT_ENDPOINT: "https://siem.example.gov.cn/audit",
    SIEM_AUDIT_SIGNING_SECRET: "a".repeat(32),
    SIEM_AUDIT_TLS_MODE: "system",
    SIEM_AUDIT_CA_FILE: path.resolve(os.tmpdir(), "stale-audit-ca.pem"),
    AUDIT_DELIVERY_CHECKPOINT_PATH: path.resolve(os.tmpdir(), "audit-checkpoint.json"),
    AUDIT_DELIVERY_SOURCE_CONTRACT: "snapshot-rehearsal-v1",
    AUDIT_DELIVERY_SERVICE_USER: "health-audit",
    AUDIT_DELIVERY_SERVICE_GROUP: "health-audit",
    PLATFORM_PILOT_CUTOVER_ALERT_JOURNAL_FILE: path.resolve(os.tmpdir(), "audit-alerts.json")
  };
  const report = assessAuditDeliveryConfig(env, { root: path.resolve(__dirname, "..") });
  assert.equal(report.checks.some((item) => item.id === "audit-delivery:tls-shape" && !item.passed), true);
  assert.throws(() => createSiemAuditAdapter({ env, fetchImpl: async () => { throw new Error("must not fetch"); } }), { code: "AUDIT_TLS_MODE_MATERIAL_CONFLICT" });

  const whitespaceEnv = { ...env, SIEM_AUDIT_CA_FILE: "  \t " };
  const whitespaceReport = assessAuditDeliveryConfig(whitespaceEnv, { root: path.resolve(__dirname, "..") });
  assert.equal(whitespaceReport.checks.some((item) => item.id === "audit-delivery:tls-shape" && item.passed), true);
  assert.doesNotThrow(() => createSiemAuditAdapter({ env: whitespaceEnv, fetchImpl: async () => { throw new Error("must not fetch"); } }));
});

test("WORM and checkpoint separation uses canonical paths", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "audit-canonical-boundary-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const worm = path.join(directory, "worm");
  const alias = path.join(directory, "worm-alias");
  fs.mkdirSync(worm, { mode: 0o700 });
  try {
    fs.symlinkSync(worm, alias, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (["EPERM", "EACCES"].includes(error.code)) return t.skip("filesystem cannot create a directory link");
    throw error;
  }
  const report = assessAuditDeliveryConfig({
    NODE_ENV: "staging",
    AUDIT_WORM_DIRECTORY: worm,
    AUDIT_DELIVERY_CHECKPOINT_PATH: path.join(alias, "checkpoint.json"),
    AUDIT_DELIVERY_SOURCE_CONTRACT: "snapshot-rehearsal-v1",
    AUDIT_DELIVERY_SERVICE_USER: "health-audit",
    AUDIT_DELIVERY_SERVICE_GROUP: "health-audit"
  }, { root: path.resolve(__dirname, "..") });
  assert.equal(report.checks.some((item) => item.id === "audit-delivery:worm-directory" && !item.passed), true);
});

test("production process identity binds the exact service UID and GID", () => {
  const report = assessAuditDeliveryConfig({
    NODE_ENV: "production",
    SIEM_AUDIT_ENDPOINT: "https://siem.example.gov.cn/audit",
    SIEM_AUDIT_SIGNING_SECRET: "a".repeat(32),
    SIEM_AUDIT_TLS_MODE: "system",
    AUDIT_DELIVERY_CHECKPOINT_PATH: path.resolve(os.tmpdir(), "audit-checkpoint.json"),
    AUDIT_DELIVERY_SOURCE_CONTRACT: "append-only-audit-source-v2",
    AUDIT_DELIVERY_SERVICE_USER: "health-audit",
    AUDIT_DELIVERY_SERVICE_GROUP: "health-audit",
    AUDIT_DELIVERY_SERVICE_UID: "1001",
    AUDIT_DELIVERY_SERVICE_GID: "1003",
    PLATFORM_PILOT_CUTOVER_ALERT_JOURNAL_FILE: path.resolve(os.tmpdir(), "audit-alerts.json")
  }, {
    root: path.resolve(__dirname, ".."),
    checkProcessIdentity: true,
    processIdentity: { username: "health-audit", uid: 1001, gid: 1002 },
    sourceContinuityImplemented: true
  });
  assert.equal(report.checks.some((item) => item.id === "audit-delivery:service-account" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "audit-delivery:process-identity" && !item.passed), true);
});

test("production worker cannot bypass the shared deployment assessment", async () => {
  await assert.rejects(runWorker({
    env: {
      NODE_ENV: "production",
      SIEM_AUDIT_ENDPOINT: "https://siem.example.gov.cn/audit",
      SIEM_AUDIT_SIGNING_SECRET: "a".repeat(32),
      SIEM_AUDIT_TLS_MODE: "system",
      AUDIT_DELIVERY_CHECKPOINT_PATH: path.resolve(os.tmpdir(), "audit-checkpoint.json"),
      AUDIT_DELIVERY_SOURCE_CONTRACT: "snapshot-rehearsal-v1",
      AUDIT_DELIVERY_SERVICE_USER: "health-audit",
      AUDIT_DELIVERY_SERVICE_GROUP: "health-audit",
      PLATFORM_PILOT_CUTOVER_ALERT_JOURNAL_FILE: path.resolve(os.tmpdir(), "audit-alerts.json")
    }
  }), { code: "AUDIT_DELIVERY_PREFLIGHT_FAILED" });

  await assert.rejects(runWorker({
    env: {
      NODE_ENV: " production ",
      AUDIT_WORM_DIRECTORY: path.resolve(os.tmpdir(), "audit-worm"),
      AUDIT_DELIVERY_CHECKPOINT_PATH: path.resolve(os.tmpdir(), "audit-checkpoint.json"),
      AUDIT_DELIVERY_SOURCE_CONTRACT: "snapshot-rehearsal-v1",
      AUDIT_DELIVERY_SERVICE_USER: "health-audit",
      AUDIT_DELIVERY_SERVICE_GROUP: "health-audit"
    }
  }), { code: "AUDIT_DELIVERY_PREFLIGHT_FAILED" });
});

test("CLI operational signal emitter is bounded metadata-only and excludes provider errors", () => {
  let output = "";
  const emitter = createOperationalSignalEmitter({ write(chunk) { output += chunk; } });
  emitter(auditWriteFailureSignal({ code: "AUDIT_WORM_UNAVAILABLE", message: "resident r-100 secret-provider-body" }));
  const event = JSON.parse(output);
  assert.equal(event.schemaVersion, "audit-delivery-operational-signal-v1");
  assert.equal(event.signal.metadataOnly, true);
  assert.equal(event.signal.errorCode, "AUDIT_WORM_UNAVAILABLE");
  assert.equal(output.includes("resident"), false);
  assert.equal(output.includes("secret-provider-body"), false);
  assert.equal(Buffer.byteLength(output) < 2048, true);
});

test("real worker CLI emits a metadata-only signal when production preflight fails", () => {
  const marker = "must-not-appear-in-worker-stderr";
  const result = spawnSync(process.execPath, [path.resolve(__dirname, "../scripts/audit-delivery-worker.js")], {
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "production",
      SIEM_AUDIT_ENDPOINT: "https://siem.example.gov.cn/audit",
      SIEM_AUDIT_SIGNING_SECRET: marker.repeat(3),
      SIEM_AUDIT_TLS_MODE: "system",
      AUDIT_DELIVERY_SOURCE_CONTRACT: "snapshot-rehearsal-v1"
    }
  });
  assert.equal(result.status, 1);
  const event = JSON.parse(result.stderr.trim().split(/\r?\n/).find((line) => line.startsWith("{")));
  assert.equal(event.schemaVersion, "audit-delivery-operational-signal-v1");
  assert.equal(event.signal.errorCode, "AUDIT_DELIVERY_PREFLIGHT_FAILED");
  assert.equal(event.signal.metadataOnly, true);
  assert.equal(result.stderr.includes(marker), false);
});

test("delivery lifecycle maps failure acknowledgement and recovery onto existing alert events", async () => {
  const events = [];
  const failed = await runAuditDeliveryCycle({
    adapter: { async deliver() { throw Object.assign(new Error("down"), { code: "TARGET_DOWN" }); } },
    records: RECORDS,
    lifecycle: async (type, context) => events.push({ type, errorCode: context.errorCode })
  });
  assert.equal(failed.incidentTransition, "opened");
  const recovered = await runAuditDeliveryCycle({
    adapter: { async deliver(batch) { return { receiptId: "receipt", batchId: batch.batchId, digest: batch.digest, recordCount: batch.recordCount }; } },
    records: RECORDS,
    previousIncidentOpen: true,
    lifecycle: async (type) => events.push({ type })
  });
  assert.equal(recovered.incidentTransition, "recovered");
  assert.deepEqual(events.map((item) => item.type), ["opened", "acknowledged", "recovered"]);
});

test("normal success has no orphan acknowledgement and WORM never maps into SIEM alert lifecycle", async () => {
  const events = [];
  const success = await runAuditDeliveryCycle({
    adapter: { async deliver(batch) { return { receiptId: "receipt", batchId: batch.batchId, digest: batch.digest, recordCount: batch.recordCount }; } },
    records: RECORDS,
    lifecycle: async (type) => events.push(type)
  });
  assert.equal(success.ok, true);
  assert.deepEqual(events, []);
  assert.equal(createPilotCutoverAuditLifecycleBridge({ adapterKind: "worm-filesystem", file: "must-not-be-used" }), null);
});

test("WORM delivery failures emit operational control signals without a cutover alert route", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "audit-worm-signal-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const sqliteFile = path.join(directory, "audit.sqlite");
  const checkpointFile = path.join(directory, "checkpoint.json");
  createAuditDatabase(sqliteFile);
  const signals = [];
  const adapter = {
    status: () => ({ type: "worm-filesystem" }),
    async deliver() { throw Object.assign(new Error("WORM unavailable"), { code: "AUDIT_WORM_UNAVAILABLE" }); }
  };
  const result = await runWorker({ sqliteFile, checkpointFile, adapter, env: {}, emitOperationalSignal: async (signal) => signals.push(signal) });
  assert.equal(result.ok, false);
  assert.equal(signals.length, 1);
  assert.equal(signals[0].id, "audit-write-failure");
});

test("worker checkpoint v2 prevents redelivery rollback corruption and concurrent ownership", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "audit-worker-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const sqliteFile = path.join(directory, "audit.sqlite");
  const checkpointFile = path.join(directory, "checkpoint.json");
  createAuditDatabase(sqliteFile);
  let deliveries = 0;
  const adapter = { async deliver(batch) { deliveries += 1; return { receiptId: `receipt-${deliveries}`, batchId: batch.batchId, digest: batch.digest, recordCount: batch.recordCount, acknowledgedAt: new Date().toISOString() }; } };
  await runWorker({ sqliteFile, checkpointFile, adapter, env: {} });
  const first = fs.readFileSync(checkpointFile);
  await runWorker({ sqliteFile, checkpointFile, adapter, env: {} });
  assert.equal(deliveries, 1);
  fs.writeFileSync(checkpointFile, first);
  assert.throws(() => readCheckpoint(checkpointFile), { code: "AUDIT_CHECKPOINT_ROLLBACK_DETECTED" });

  fs.rmSync(checkpointFile);
  fs.rmSync(`${checkpointFile}.head`);
  const release = acquireWorkerLock(checkpointFile);
  await assert.rejects(runWorker({ sqliteFile, checkpointFile, adapter, env: {} }), { code: "AUDIT_DELIVERY_WORKER_LOCKED" });
  release();
});

test("append-only worker advances checkpoint v3 by committed source cursor and binds each batch", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "audit-worker-v3-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const sqliteFile = path.join(directory, "audit.sqlite");
  const checkpointFile = path.join(directory, "checkpoint.json");
  createAppendOnlyAuditDatabase(sqliteFile);
  const batches = [];
  const adapter = {
    status: () => ({ type: "test-sink" }),
    async deliver(batch) {
      batches.push(batch);
      return {
        receiptId: `receipt-${batches.length}`,
        batchId: batch.batchId,
        digest: batch.digest,
        recordCount: batch.recordCount,
        acknowledgedAt: "2026-08-22T04:00:00.000Z"
      };
    }
  };
  const env = {
    AUDIT_DELIVERY_SOURCE_CONTRACT,
    AUDIT_DELIVERY_BATCH_SIZE: "1"
  };

  const first = await runWorker({ sqliteFile, checkpointFile, adapter, env });
  assert.equal(first.ok, true);
  assert.equal(first.delivered, 1);
  assert.equal(first.pendingBefore, 2);
  assert.equal(first.pendingAfter, 1);
  assert.equal(first.sourceCursor, 1);
  assert.equal(first.productionReady, false);
  const firstPayload = JSON.parse(batches[0].payload);
  assert.equal(firstPayload.schemaVersion, "audit-delivery-v2");
  assert.deepEqual(firstPayload.source, {
    contract: AUDIT_DELIVERY_SOURCE_CONTRACT,
    startCursor: 1,
    endCursor: 1,
    sourceHeadHash: batches[0].source.sourceHeadHash
  });
  assert.equal(JSON.stringify(firstPayload).includes("sensitive-actor-account"), false);
  assert.equal(JSON.stringify(firstPayload).includes("sensitive free text"), false);

  const firstCheckpoint = readCheckpoint(checkpointFile, { sourceContract: AUDIT_DELIVERY_SOURCE_CONTRACT });
  assert.equal(firstCheckpoint.schemaVersion, "audit-delivery-checkpoint-v3");
  assert.equal(firstCheckpoint.sourceCursor, 1);
  assert.match(firstCheckpoint.sourceHeadHash, /^[a-f0-9]{64}$/);
  assert.match(firstCheckpoint.targetDigest, /^[a-f0-9]{64}$/);
  assert.match(firstCheckpoint.lastReceiptDigest, /^[a-f0-9]{64}$/);

  const second = await runWorker({ sqliteFile, checkpointFile, adapter, env });
  assert.equal(second.sourceCursor, 2);
  assert.equal(second.pendingAfter, 0);
  await runWorker({ sqliteFile, checkpointFile, adapter, env });
  assert.equal(batches.length, 2, "an acknowledged cursor must not be redelivered");
});

test("append-only worker never promotes checkpoint v2 and never advances a failed cursor", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "audit-worker-v3-guard-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const sqliteFile = path.join(directory, "audit.sqlite");
  const checkpointFile = path.join(directory, "checkpoint.json");
  createAppendOnlyAuditDatabase(sqliteFile);

  await runWorker({
    sqliteFile,
    checkpointFile,
    adapter: { async deliver(batch) { return { receiptId: "v2", batchId: batch.batchId, digest: batch.digest, recordCount: batch.recordCount, acknowledgedAt: new Date().toISOString() }; } },
    env: {}
  });
  await assert.rejects(runWorker({
    sqliteFile,
    checkpointFile,
    adapter: { async deliver() { throw new Error("must not deliver"); } },
    env: { AUDIT_DELIVERY_SOURCE_CONTRACT }
  }), { code: "AUDIT_CHECKPOINT_MIGRATION_REQUIRED" });

  fs.rmSync(checkpointFile);
  fs.rmSync(`${checkpointFile}.head`);
  const failed = await runWorker({
    sqliteFile,
    checkpointFile,
    adapter: {
      status: () => ({ type: "test-sink" }),
      async deliver() { throw Object.assign(new Error("target unavailable"), { code: "TARGET_UNAVAILABLE" }); }
    },
    env: { AUDIT_DELIVERY_SOURCE_CONTRACT, AUDIT_DELIVERY_BATCH_SIZE: "1" }
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.sourceCursor, 0);
  const checkpoint = readCheckpoint(checkpointFile, { sourceContract: AUDIT_DELIVERY_SOURCE_CONTRACT });
  assert.equal(checkpoint.sourceCursor, 0);
  assert.equal(checkpoint.sourceHeadHash, "");
  assert.equal(checkpoint.incidentOpen, true);
});

test("checkpoint write failures emit a metadata-only operational control signal", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "audit-write-failure-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const sqliteFile = path.join(directory, "audit.sqlite");
  createAuditDatabase(sqliteFile);
  const checkpointFile = path.join(directory, "checkpoint.json");
  const signals = [];
  await assert.rejects(runWorker({
    sqliteFile,
    checkpointFile,
    adapter: { async deliver(batch) { return { receiptId: "receipt", batchId: batch.batchId, digest: batch.digest, recordCount: batch.recordCount, acknowledgedAt: new Date().toISOString() }; } },
    emitOperationalSignal: async (signal) => signals.push(signal),
    writeCheckpoint() { throw Object.assign(new Error("disk write failed with secret"), { code: "EIO" }); },
    env: {}
  }));
  assert.equal(signals.length, 1);
  assert.equal(signals[0].id, "audit-write-failure");
  assert.equal(signals[0].metadataOnly, true);
});

test("audit delivery systemd template uses a dedicated account and minimum writable paths", () => {
  const service = fs.readFileSync(path.resolve(__dirname, "../deploy/audit-delivery-worker.service.template"), "utf8");
  assert.match(service, /^User=\{\{AUDIT_DELIVERY_SERVICE_USER\}\}$/m);
  assert.match(service, /^Group=\{\{AUDIT_DELIVERY_SERVICE_GROUP\}\}$/m);
  assert.match(service, /^EnvironmentFile=\{\{ENV_FILE\}\}$/m);
  assert.match(service, /^ReadOnlyPaths=\{\{APP_DIR\}\}$/m);
  assert.match(service, /^ReadWritePaths=\{\{DATA_DIR\}\} \{\{AUDIT_CHECKPOINT_DIR\}\} \{\{AUDIT_WORM_DIRECTORY\}\} \{\{AUDIT_ALERT_JOURNAL_DIR\}\}$/m);
  assert.match(service, /^ExecStartPre=\{\{NODE_BIN\}\} \{\{APP_DIR\}\}\/scripts\/audit-delivery-preflight\.js$/m);
  assert.match(service, /^TimeoutStartSec=\d+s$/m);
  assert.match(service, /^UMask=0077$/m);
  assert.match(service, /^NoNewPrivileges=true$/m);
  assert.doesNotMatch(service, /SIEM_AUDIT_SIGNING_SECRET=/);
});
