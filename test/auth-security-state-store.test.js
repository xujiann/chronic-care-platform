"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");

const {
  AuthSecurityStateStore,
  COLLECTION_KEY,
  PostgresAtomicDocumentRepository,
  createAuthSecurityStateStore
} = require("../auth-security-state-store");

const codeDigest = (value) => createHash("sha256").update(value).digest("hex");

function sqliteHarness(t, now = () => new Date()) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "auth-state-"));
  const databaseFile = path.join(directory, "state.sqlite");
  const seed = new DatabaseSync(databaseFile);
  seed.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE state_collections (
      key TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1
    );
  `);
  seed.close();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const options = {
    mode: "sqlite",
    openDatabase: () => new DatabaseSync(databaseFile),
    keySecret: "test-only-key-secret-with-at-least-32-characters",
    now
  };
  return { databaseFile, options, store: createAuthSecurityStateStore(options) };
}

test("SQLite OTP state survives restart and is atomically consumed once without runtime DDL", async (t) => {
  const harness = sqliteHarness(t);
  const digest = codeDigest("one-time-code");
  await harness.store.issueVerificationCode({ subject: "13800000000", purpose: "resident-phone-code", codeDigest: digest });
  const restarted = createAuthSecurityStateStore(harness.options);
  const attempts = await Promise.all([
    restarted.verifyAndConsumeCode({ subject: "13800000000", purpose: "resident-phone-code", codeDigest: digest }),
    harness.store.verifyAndConsumeCode({ subject: "13800000000", purpose: "resident-phone-code", codeDigest: digest })
  ]);
  assert.equal(attempts.filter((item) => item.verified).length, 1);
  assert.equal(attempts.filter((item) => item.reason === "missing-or-expired").length, 1);
  const db = new DatabaseSync(harness.databaseFile, { readOnly: true });
  const payload = db.prepare("SELECT payload FROM state_collections WHERE key = ?").get(COLLECTION_KEY).payload;
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((row) => row.name);
  db.close();
  assert.deepEqual(tables, ["state_collections"]);
  assert.doesNotMatch(payload, /13800000000|one-time-code/);
});

test("shared SQLite rate limiting and failed-login locks are atomic across store instances", async (t) => {
  const harness = sqliteHarness(t);
  const other = createAuthSecurityStateStore(harness.options);
  const results = await Promise.all(Array.from({ length: 12 }, (_, index) => (
    (index % 2 ? harness.store : other).consumeRateLimit({ subject: "network-a", purpose: "login", limit: 5, windowMs: 60000 })
  )));
  assert.equal(results.filter((item) => item.allowed).length, 5);
  assert.equal(Math.max(...results.map((item) => item.count)), 12);
  await Promise.all(Array.from({ length: 4 }, (_, index) => (
    (index % 2 ? harness.store : other).recordLoginFailure({ subject: "account-a", purpose: "login", threshold: 4, lockoutMs: 120000 })
  )));
  assert.deepEqual(await harness.store.getLoginLock({ subject: "account-a", purpose: "login" }), {
    locked: true,
    failedAttempts: 4,
    retryAfterSeconds: 120
  });
});

test("OTP TTL, attempt exhaustion, clear and subject-wide revocation are enforced", async (t) => {
  let clock = Date.parse("2026-08-20T00:00:00.000Z");
  const harness = sqliteHarness(t, () => new Date(clock));
  const digest = codeDigest("expiring-code");
  await harness.store.issueVerificationCode({ subject: "account-b", purpose: "login", codeDigest: digest, ttlMs: 1000, maxAttempts: 2 });
  assert.equal((await harness.store.verifyAndConsumeCode({ subject: "account-b", purpose: "login", codeDigest: codeDigest("wrong") })).remainingAttempts, 1);
  assert.equal((await harness.store.verifyAndConsumeCode({ subject: "account-b", purpose: "login", codeDigest: codeDigest("wrong-again") })).remainingAttempts, 0);
  await harness.store.issueVerificationCode({ subject: "account-b", purpose: "otp-other", codeDigest: digest, ttlMs: 60000 });
  await harness.store.consumeRateLimit({ subject: "account-b", purpose: "rate-other", limit: 10, windowMs: 60000 });
  await harness.store.recordLoginFailure({ subject: "account-b", purpose: "lock-other", threshold: 3 });
  assert.equal((await harness.store.revokeSubject({ subject: "account-b" })).revoked, 3);
  assert.equal((await harness.store.status()).activeEntries, 0);
  clock += 61000;
  assert.equal((await harness.store.status()).activeEntries, 0);
});

test("production factory fails closed for memory and non-PostgreSQL multi-instance state", () => {
  const env = { NODE_ENV: "production", INSTANCE_COUNT: "2", SESSION_SECRET: "production-session-secret-with-at-least-32-characters" };
  assert.throws(() => createAuthSecurityStateStore({ mode: "memory", env }), /memory is forbidden/);
  assert.throws(() => createAuthSecurityStateStore({ mode: "sqlite", env, openDatabase() {} }), /multi-instance production requires/);
});

test("PostgreSQL repository retries serialization conflicts without losing an update", async () => {
  let state = null;
  let version = 0;
  let initialSelects = 0;
  let releaseInitialSelects;
  const barrier = new Promise((resolve) => { releaseInitialSelects = resolve; });
  const pool = {
    async connect() {
      let snapshotVersion = 0;
      let pending = null;
      return {
        async query(sql, params = []) {
          if (/^BEGIN/.test(sql)) { snapshotVersion = version; return { rows: [] }; }
          if (/SELECT payload/.test(sql)) {
            initialSelects += 1;
            if (initialSelects === 2) releaseInitialSelects();
            if (initialSelects <= 2) await barrier;
            return { rows: state ? [{ payload: structuredClone(state) }] : [] };
          }
          if (/INSERT INTO health_platform\.auth_security_state/.test(sql)) { pending = JSON.parse(params[1]); return { rows: [] }; }
          if (sql === "COMMIT") {
            if (snapshotVersion !== version) { const error = new Error("serialization conflict"); error.code = "40001"; throw error; }
            state = pending;
            version += 1;
          }
          return { rows: [] };
        },
        release() {}
      };
    }
  };
  const store = new AuthSecurityStateStore({
    repository: new PostgresAtomicDocumentRepository({ pool, retryDelayMs: 0 }),
    keySecret: "postgres-test-key-secret-with-at-least-32-characters"
  });
  const results = await Promise.all([
    store.consumeRateLimit({ subject: "first-writer", purpose: "login", limit: 5 }),
    store.consumeRateLimit({ subject: "first-writer", purpose: "login", limit: 5 })
  ]);
  assert.deepEqual(results.map((item) => item.count).sort((a, b) => a - b), [1, 2]);
  assert.equal(Object.values(state.entries)[0].count, 2);
});

test("PostgreSQL repository bounds retry attempts and validates schema identifiers", async () => {
  let connections = 0;
  const repository = new PostgresAtomicDocumentRepository({
    pool: {
      async connect() {
        connections += 1;
        return { async query(sql) { if (/SELECT payload/.test(sql)) { const error = new Error("deadlock"); error.code = "40P01"; throw error; } return { rows: [] }; }, release() {} };
      }
    },
    maxAttempts: 3,
    retryDelayMs: 0
  });
  await assert.rejects(() => repository.mutate(() => ({ ok: true })), (error) => error.code === "40P01");
  assert.equal(connections, 3);
  assert.throws(() => new PostgresAtomicDocumentRepository({ schema: "bad;drop", pool: {} }), /lowercase SQL identifier/);
});
