"use strict";

const { createHmac, timingSafeEqual } = require("node:crypto");

const COLLECTION_KEY = "auth-security-state-v1";
const DOCUMENT_VERSION = 1;
const DEFAULT_POSTGRES_SCHEMA = "health_platform";

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(parsed)));
}

function postgresSchemaIdentifier(value = DEFAULT_POSTGRES_SCHEMA) {
  const schema = String(value || "").trim();
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) {
    throw new Error("PostgreSQL auth security schema must be a lowercase SQL identifier");
  }
  return schema;
}

function emptyDocument() {
  return { version: DOCUMENT_VERSION, entries: {} };
}

function normalizeDocument(value) {
  const entries = value?.entries && typeof value.entries === "object" && !Array.isArray(value.entries)
    ? value.entries
    : {};
  return { version: DOCUMENT_VERSION, entries: { ...entries } };
}

function clone(value) {
  return structuredClone(value);
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function pruneExpired(document, nowMs) {
  let removed = 0;
  Object.entries(document.entries).forEach(([key, entry]) => {
    if (!entry || !Number.isFinite(Date.parse(entry.expiresAt)) || Date.parse(entry.expiresAt) <= nowMs) {
      delete document.entries[key];
      removed += 1;
    }
  });
  return removed;
}

class MemoryAtomicDocumentRepository {
  constructor() {
    this.document = emptyDocument();
  }

  async mutate(callback) {
    const document = normalizeDocument(clone(this.document));
    const result = callback(document);
    this.document = document;
    return result;
  }

  async read() {
    return normalizeDocument(clone(this.document));
  }

  status() {
    return { mode: "memory", durable: false, crossProcess: false, crossHost: false };
  }
}

class SqliteAtomicDocumentRepository {
  constructor(options = {}) {
    if (typeof options.openDatabase !== "function") throw new Error("openDatabase is required");
    this.openDatabase = options.openDatabase;
    this.busyTimeoutMs = boundedInteger(options.busyTimeoutMs, 5000, 100, 30000);
  }

  withDatabase(callback) {
    const db = this.openDatabase();
    try {
      db.exec(`PRAGMA busy_timeout = ${this.busyTimeoutMs}`);
      const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'state_collections'").get();
      if (!table) throw new Error("state_collections is unavailable; apply the registered SQLite migrations first");
      return callback(db);
    } finally {
      db.close();
    }
  }

  async mutate(callback) {
    return this.withDatabase((db) => {
      db.exec("BEGIN IMMEDIATE");
      try {
        const row = db.prepare("SELECT payload FROM state_collections WHERE key = ?").get(COLLECTION_KEY);
        const document = normalizeDocument(row ? JSON.parse(row.payload) : null);
        const result = callback(document);
        db.prepare(`
          INSERT INTO state_collections (key, payload, version, updated_at)
          VALUES (?, ?, 1, ?)
          ON CONFLICT (key) DO UPDATE SET
            payload = excluded.payload,
            version = state_collections.version + 1,
            updated_at = excluded.updated_at
        `).run(COLLECTION_KEY, JSON.stringify(document), new Date().toISOString());
        db.exec("COMMIT");
        return result;
      } catch (error) {
        if (db.isTransaction) db.exec("ROLLBACK");
        throw error;
      }
    });
  }

  async read() {
    return this.withDatabase((db) => {
      const row = db.prepare("SELECT payload FROM state_collections WHERE key = ?").get(COLLECTION_KEY);
      return normalizeDocument(row ? JSON.parse(row.payload) : null);
    });
  }

  status() {
    return { mode: "sqlite", durable: true, crossProcess: true, crossHost: false };
  }
}

class PostgresAtomicDocumentRepository {
  constructor(options = {}) {
    if (!options.pool) throw new Error("pool is required");
    this.pool = options.pool;
    this.schema = postgresSchemaIdentifier(options.schema);
    this.table = `${this.schema}.auth_security_state`;
    this.maxAttempts = boundedInteger(options.maxAttempts, 16, 1, 32);
    this.retryDelayMs = boundedInteger(options.retryDelayMs, 10, 0, 1000);
    this.maxRetryDelayMs = boundedInteger(options.maxRetryDelayMs, 250, 0, 5000);
    this.random = options.random || Math.random;
    this.delay = options.delay || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async mutate(callback) {
    let lastError;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");
        const selected = await client.query(
          `SELECT payload FROM ${this.table} WHERE state_key = $1 FOR UPDATE`,
          [COLLECTION_KEY]
        );
        const document = normalizeDocument(selected.rows?.[0]?.payload);
        const result = callback(document);
        await client.query(`
          INSERT INTO ${this.table} (state_key, payload, version, updated_at)
          VALUES ($1, $2::jsonb, 1, now())
          ON CONFLICT (state_key) DO UPDATE SET
            payload = EXCLUDED.payload,
            version = ${this.table}.version + 1,
            updated_at = now()
        `, [COLLECTION_KEY, JSON.stringify(document)]);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        lastError = error;
        try { await client.query("ROLLBACK"); } catch {}
        const retryable = new Set(["40001", "40P01"]).has(String(error?.code || ""));
        if (!retryable || attempt === this.maxAttempts) throw error;
      } finally {
        client.release();
      }
      const exponentialDelay = Math.min(
        this.maxRetryDelayMs,
        this.retryDelayMs * (2 ** Math.min(attempt - 1, 10))
      );
      const jitterMultiplier = 0.5 + Math.min(1, Math.max(0, Number(this.random())));
      await this.delay(Math.floor(exponentialDelay * jitterMultiplier));
    }
    throw lastError;
  }

  async read() {
    const result = await this.pool.query(`SELECT payload FROM ${this.table} WHERE state_key = $1`, [COLLECTION_KEY]);
    return normalizeDocument(result.rows?.[0]?.payload);
  }

  status() {
    return { mode: "postgres", durable: true, crossProcess: true, crossHost: true };
  }
}

class AuthSecurityStateStore {
  constructor(options = {}) {
    if (!options.repository) throw new Error("repository is required");
    this.repository = options.repository;
    this.now = options.now || (() => new Date());
    this.keySecret = String(options.keySecret || "");
    if (!this.keySecret) throw new Error("keySecret is required");
  }

  subjectHash(subject) {
    return createHmac("sha256", this.keySecret).update(String(subject || "").trim()).digest("hex");
  }

  key(kind, subject, purpose = "default") {
    return `${kind}:${createHmac("sha256", this.keySecret)
      .update(`${String(subject || "").trim()}\0${String(purpose || "default").trim()}`)
      .digest("hex")}`;
  }

  async issueVerificationCode(input = {}) {
    const codeDigest = String(input.codeDigest || "").trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(codeDigest)) throw new Error("codeDigest must be a SHA-256 or HMAC digest");
    const ttlMs = boundedInteger(input.ttlMs, 5 * 60 * 1000, 1000, 30 * 60 * 1000);
    const maxAttempts = boundedInteger(input.maxAttempts, 5, 1, 20);
    const now = this.now();
    const purpose = String(input.purpose || "default").trim();
    const key = this.key("otp", input.subject, purpose);
    return this.repository.mutate((document) => {
      pruneExpired(document, now.getTime());
      document.entries[key] = {
        kind: "otp",
        purpose,
        subjectHash: this.subjectHash(input.subject),
        codeDigest,
        remainingAttempts: maxAttempts,
        issuedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + ttlMs).toISOString()
      };
      return { issued: true, expiresAt: document.entries[key].expiresAt, remainingAttempts: maxAttempts };
    });
  }

  async verifyAndConsumeCode(input = {}) {
    const now = this.now();
    const purpose = String(input.purpose || "default").trim();
    const key = this.key("otp", input.subject, purpose);
    const candidateDigest = String(input.codeDigest || "").trim().toLowerCase();
    return this.repository.mutate((document) => {
      pruneExpired(document, now.getTime());
      const entry = document.entries[key];
      if (!entry || entry.kind !== "otp") return { verified: false, reason: "missing-or-expired", remainingAttempts: 0 };
      if (!safeEqual(entry.codeDigest, candidateDigest)) {
        entry.remainingAttempts = Math.max(0, Number(entry.remainingAttempts || 0) - 1);
        if (entry.remainingAttempts === 0) delete document.entries[key];
        return { verified: false, reason: "mismatch", remainingAttempts: entry.remainingAttempts };
      }
      delete document.entries[key];
      return { verified: true, reason: "consumed", remainingAttempts: 0 };
    });
  }

  async revokeVerificationCode(input = {}) {
    const key = this.key("otp", input.subject, input.purpose);
    return this.repository.mutate((document) => {
      const entry = document.entries[key];
      if (!entry || entry.kind !== "otp") return { revoked: false };
      delete document.entries[key];
      return { revoked: true };
    });
  }

  async consumeRateLimit(input = {}) {
    const now = this.now();
    const limit = boundedInteger(input.limit, 5, 1, 10000);
    const windowMs = boundedInteger(input.windowMs, 60 * 1000, 1000, 24 * 60 * 60 * 1000);
    const purpose = String(input.purpose || "default").trim();
    const key = this.key("rate", input.subject, purpose);
    return this.repository.mutate((document) => {
      pruneExpired(document, now.getTime());
      const entry = document.entries[key] || {
        kind: "rate",
        purpose,
        subjectHash: this.subjectHash(input.subject),
        count: 0,
        startedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + windowMs).toISOString()
      };
      entry.count = Number(entry.count || 0) + 1;
      document.entries[key] = entry;
      return {
        allowed: entry.count <= limit,
        count: entry.count,
        remaining: Math.max(0, limit - entry.count),
        retryAfterSeconds: Math.max(1, Math.ceil((Date.parse(entry.expiresAt) - now.getTime()) / 1000))
      };
    });
  }

  async getLoginLock(input = {}) {
    const now = this.now();
    const key = this.key("lock", input.subject, input.purpose);
    return this.repository.mutate((document) => {
      pruneExpired(document, now.getTime());
      const entry = document.entries[key];
      const lockedUntil = String(entry?.lockedUntil || "");
      return {
        locked: Boolean(lockedUntil && Date.parse(lockedUntil) > now.getTime()),
        failedAttempts: Number(entry?.failedAttempts || 0),
        retryAfterSeconds: lockedUntil ? Math.max(0, Math.ceil((Date.parse(lockedUntil) - now.getTime()) / 1000)) : 0
      };
    });
  }

  async recordLoginFailure(input = {}) {
    const now = this.now();
    const threshold = boundedInteger(input.threshold, 5, 1, 100);
    const failureTtlMs = boundedInteger(input.failureTtlMs, 15 * 60 * 1000, 1000, 24 * 60 * 60 * 1000);
    const lockoutMs = boundedInteger(input.lockoutMs, 15 * 60 * 1000, 1000, 24 * 60 * 60 * 1000);
    const purpose = String(input.purpose || "default").trim();
    const key = this.key("lock", input.subject, purpose);
    return this.repository.mutate((document) => {
      pruneExpired(document, now.getTime());
      const entry = document.entries[key] || {
        kind: "lock",
        purpose,
        subjectHash: this.subjectHash(input.subject),
        failedAttempts: 0,
        lockedUntil: ""
      };
      entry.failedAttempts = Number(entry.failedAttempts || 0) + 1;
      if (entry.failedAttempts >= threshold) entry.lockedUntil = new Date(now.getTime() + lockoutMs).toISOString();
      entry.expiresAt = new Date(now.getTime() + Math.max(failureTtlMs, lockoutMs)).toISOString();
      document.entries[key] = entry;
      return {
        locked: Boolean(entry.lockedUntil),
        failedAttempts: entry.failedAttempts,
        retryAfterSeconds: entry.lockedUntil ? Math.ceil((Date.parse(entry.lockedUntil) - now.getTime()) / 1000) : 0
      };
    });
  }

  async clearLoginFailures(input = {}) {
    const key = this.key("lock", input.subject, input.purpose);
    return this.repository.mutate((document) => ({ cleared: delete document.entries[key] }));
  }

  async revokeSubject(input = {}) {
    const subjectHash = this.subjectHash(input.subject);
    const purposes = Array.isArray(input.purposes) && input.purposes.length ? new Set(input.purposes.map(String)) : null;
    return this.repository.mutate((document) => {
      let revoked = 0;
      Object.entries(document.entries).forEach(([key, entry]) => {
        if (safeEqual(entry?.subjectHash, subjectHash) && (!purposes || purposes.has(String(entry?.purpose || "default")))) {
          delete document.entries[key];
          revoked += 1;
        }
      });
      return { revoked };
    });
  }

  async status() {
    const document = await this.repository.read();
    const nowMs = this.now().getTime();
    const active = Object.values(document.entries).filter((entry) => Date.parse(entry.expiresAt) > nowMs);
    return {
      profile: "repository-v1",
      ...this.repository.status(),
      activeEntries: active.length,
      kinds: Object.fromEntries(["otp", "rate", "lock"].map((kind) => [kind, active.filter((entry) => entry.kind === kind).length])),
      plaintextSubjectsPersisted: false,
      plaintextCodesPersisted: false
    };
  }
}

function createAuthSecurityStateStore(options = {}) {
  const env = options.env || process.env;
  const production = String(env.NODE_ENV || "").trim().toLowerCase() === "production";
  const instanceCount = boundedInteger(env.INSTANCE_COUNT, 1, 1, 10000);
  const mode = String(options.mode || env.AUTH_SECURITY_STATE_STORE || (instanceCount > 1 ? "postgres" : "sqlite")).trim().toLowerCase();
  if (production && mode === "memory") throw new Error("AUTH_SECURITY_STATE_STORE=memory is forbidden in production");
  if (production && instanceCount > 1 && mode !== "postgres") throw new Error("multi-instance production requires AUTH_SECURITY_STATE_STORE=postgres");
  let repository;
  if (mode === "memory") repository = new MemoryAtomicDocumentRepository();
  else if (mode === "sqlite") repository = new SqliteAtomicDocumentRepository(options);
  else if (mode === "postgres") repository = new PostgresAtomicDocumentRepository(options);
  else throw new Error(`unsupported auth security state store: ${mode}`);
  const keySecret = String(options.keySecret || env.AUTH_SECURITY_STATE_KEY_SECRET || env.SESSION_SECRET || "");
  if (production && keySecret.length < 32) throw new Error("AUTH_SECURITY_STATE_KEY_SECRET must contain at least 32 characters in production");
  return new AuthSecurityStateStore({ repository, now: options.now, keySecret });
}

module.exports = {
  AuthSecurityStateStore,
  COLLECTION_KEY,
  MemoryAtomicDocumentRepository,
  PostgresAtomicDocumentRepository,
  SqliteAtomicDocumentRepository,
  createAuthSecurityStateStore,
  postgresSchemaIdentifier
};
