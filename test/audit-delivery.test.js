"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { auditHashFor } = require("../src/identity-security/audit-chain");
const {
  assessAuditDeliveryConfig,
  buildAuditBatch,
  createSecureAuditTransport,
  createSiemAuditAdapter,
  createWormAuditAdapter,
  runAuditDeliveryCycle
} = require("../src/platform/operations/audit-delivery");
const { acquireWorkerLock, readCheckpoint, runWorker } = require("../scripts/audit-delivery-worker");

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
});

test("production preflight requires one external target dedicated identity and explicit TLS", () => {
  const ready = assessAuditDeliveryConfig({
    SIEM_AUDIT_ENDPOINT: "https://siem.example.gov.cn/audit",
    SIEM_AUDIT_SIGNING_SECRET: "a".repeat(32),
    SIEM_AUDIT_TLS_MODE: "mtls",
    SIEM_AUDIT_CLIENT_CERT_FILE: "C:\\secrets\\audit-client.pem",
    SIEM_AUDIT_CLIENT_KEY_FILE: "C:\\secrets\\audit-client.key",
    AUDIT_DELIVERY_CHECKPOINT_PATH: "C:\\health-data\\audit-state\\checkpoint.json",
    AUDIT_DELIVERY_SERVICE_USER: "health-audit",
    AUDIT_DELIVERY_SERVICE_GROUP: "health-audit"
  }, { root: path.resolve(__dirname, "..") });
  assert.equal(ready.ready, process.platform === "win32");
  assert.equal(ready.productionReady, false);
  const unsafe = assessAuditDeliveryConfig({ SIEM_AUDIT_ENDPOINT: "http://siem.invalid", AUDIT_WORM_DIRECTORY: "/tmp/worm", AUDIT_DELIVERY_SERVICE_USER: "root", NODE_TLS_REJECT_UNAUTHORIZED: "0" });
  assert.equal(unsafe.ready, false);
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
  assert.match(service, /^User=\{\{SERVICE_USER\}\}$/m);
  assert.match(service, /^Group=\{\{SERVICE_GROUP\}\}$/m);
  assert.match(service, /^EnvironmentFile=\{\{ENV_FILE\}\}$/m);
  assert.match(service, /^ReadOnlyPaths=\{\{APP_DIR\}\}$/m);
  assert.match(service, /^ReadWritePaths=\{\{DATA_DIR\}\} \{\{AUDIT_CHECKPOINT_DIR\}\} \{\{AUDIT_WORM_DIRECTORY\}\}$/m);
  assert.match(service, /^UMask=0077$/m);
  assert.match(service, /^NoNewPrivileges=true$/m);
  assert.doesNotMatch(service, /SIEM_AUDIT_SIGNING_SECRET=/);
});
