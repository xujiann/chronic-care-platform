function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizedText(value, maximumLength = 200) {
  return String(value || "").trim().slice(0, maximumLength);
}

const SENSITIVE_SESSION_USER_FIELDS = new Set([
  "password",
  "passwordHash",
  "phone",
  "idCard",
  "documentNo",
  "motherDocumentNo",
  "fatherDocumentNo",
  "certificateNo",
  "credentialNo",
  "personIndex",
  "identityIndex",
  "address"
]);

function sanitizeSessionUser(user) {
  const safeUser = clone(user || {});
  SENSITIVE_SESSION_USER_FIELDS.forEach((field) => delete safeUser[field]);
  return safeUser;
}

function normalizeSession(session) {
  const normalized = {
    sessionId: normalizedText(session?.sessionId, 128),
    user: sanitizeSessionUser(session?.user),
    issuedAt: normalizedText(session?.issuedAt, 64),
    expiresAt: normalizedText(session?.expiresAt, 64)
  };
  if (!normalized.sessionId || !normalized.user.id || !normalized.issuedAt || !normalized.expiresAt) {
    throw new Error("sessionId, user.id, issuedAt and expiresAt are required");
  }
  if (!Number.isFinite(Date.parse(normalized.issuedAt)) || !Number.isFinite(Date.parse(normalized.expiresAt))) {
    throw new Error("issuedAt and expiresAt must be valid dates");
  }
  normalized.issuedAt = new Date(normalized.issuedAt).toISOString();
  normalized.expiresAt = new Date(normalized.expiresAt).toISOString();
  return normalized;
}

function normalizedDate(value, name) {
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(String(value || ""));
  if (!Number.isFinite(timestamp)) throw new Error(`${name} must be a valid date`);
  return new Date(timestamp).toISOString();
}

function createSqliteSessionSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      session_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT '',
      user_payload TEXT NOT NULL,
      issued_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT NOT NULL DEFAULT '',
      revoke_reason TEXT NOT NULL DEFAULT '',
      revoked_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_active
      ON auth_sessions(user_id, revoked_at, expires_at);
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry
      ON auth_sessions(revoked_at, expires_at);
  `);
}

class MemorySessionStore {
  constructor(options = {}) {
    this.now = options.now || (() => new Date());
    this.sessions = new Map();
  }

  create(session) {
    const normalized = normalizeSession(session);
    this.sessions.set(normalized.sessionId, normalized);
    return clone(normalized);
  }

  get(sessionId) {
    const session = this.sessions.get(normalizedText(sessionId, 128));
    if (!session || Date.parse(session.expiresAt) <= this.now().getTime()) return null;
    return clone(session);
  }

  revoke(sessionId) {
    return this.sessions.delete(normalizedText(sessionId, 128)) ? 1 : 0;
  }

  revokeByUserIds(userIds = []) {
    const targets = new Set(userIds.map((item) => normalizedText(item, 128)).filter(Boolean));
    let revoked = 0;
    this.sessions.forEach((session, sessionId) => {
      if (targets.has(session.user?.id)) {
        this.sessions.delete(sessionId);
        revoked += 1;
      }
    });
    return revoked;
  }

  cleanup(options = {}) {
    const expiredBefore = normalizedDate(options.expiredBefore, "expiredBefore");
    const revokedBefore = normalizedDate(options.revokedBefore, "revokedBefore");
    let deletedExpired = 0;
    this.sessions.forEach((session, sessionId) => {
      if (session.expiresAt <= expiredBefore) {
        this.sessions.delete(sessionId);
        deletedExpired += 1;
      }
    });
    return {
      completedAt: this.now().toISOString(),
      expiredBefore,
      revokedBefore,
      deletedExpired,
      deletedRevoked: 0,
      deletedTotal: deletedExpired
    };
  }

  status() {
    const now = this.now().getTime();
    let active = 0;
    let expired = 0;
    this.sessions.forEach((session) => {
      if (Date.parse(session.expiresAt) > now) active += 1;
      else expired += 1;
    });
    return {
      mode: "memory",
      durable: false,
      crossProcess: false,
      active,
      revoked: 0,
      expired
    };
  }
}

class SqliteSessionStore {
  constructor(options = {}) {
    if (typeof options.openDatabase !== "function") throw new Error("openDatabase is required");
    this.openDatabase = options.openDatabase;
    this.now = options.now || (() => new Date());
  }

  withDatabase(callback) {
    const db = this.openDatabase();
    try {
      createSqliteSessionSchema(db);
      return callback(db);
    } finally {
      db.close();
    }
  }

  create(session) {
    const normalized = normalizeSession(session);
    this.withDatabase((db) => {
      db.prepare(`
        INSERT INTO auth_sessions (
          session_id, user_id, username, role, user_payload, issued_at, expires_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        normalized.sessionId,
        normalizedText(normalized.user.id, 128),
        normalizedText(normalized.user.username || normalized.user.name, 200),
        normalizedText(normalized.user.role, 100),
        JSON.stringify(normalized.user),
        normalized.issuedAt,
        normalized.expiresAt,
        this.now().toISOString()
      );
    });
    return clone(normalized);
  }

  get(sessionId) {
    const id = normalizedText(sessionId, 128);
    if (!id) return null;
    return this.withDatabase((db) => {
      const row = db.prepare(`
        SELECT session_id, user_payload, issued_at, expires_at
        FROM auth_sessions
        WHERE session_id = ? AND revoked_at = '' AND expires_at > ?
      `).get(id, this.now().toISOString());
      if (!row) return null;
      return {
        sessionId: row.session_id,
        user: JSON.parse(row.user_payload),
        issuedAt: row.issued_at,
        expiresAt: row.expires_at
      };
    });
  }

  revoke(sessionId, options = {}) {
    const id = normalizedText(sessionId, 128);
    if (!id) return 0;
    const revokedAt = this.now().toISOString();
    return this.withDatabase((db) => Number(db.prepare(`
      UPDATE auth_sessions
      SET revoked_at = ?, revoke_reason = ?, revoked_by = ?
      WHERE session_id = ? AND revoked_at = ''
    `).run(
      revokedAt,
      normalizedText(options.reason || "logout", 200),
      normalizedText(options.actor || "system", 200),
      id
    ).changes || 0));
  }

  revokeByUserIds(userIds = [], options = {}) {
    const ids = [...new Set(userIds.map((item) => normalizedText(item, 128)).filter(Boolean))];
    if (!ids.length) return 0;
    const revokedAt = this.now().toISOString();
    const placeholders = ids.map(() => "?").join(", ");
    return this.withDatabase((db) => Number(db.prepare(`
      UPDATE auth_sessions
      SET revoked_at = ?, revoke_reason = ?, revoked_by = ?
      WHERE user_id IN (${placeholders}) AND revoked_at = '' AND expires_at > ?
    `).run(
      revokedAt,
      normalizedText(options.reason || "account-disabled", 200),
      normalizedText(options.actor || "system", 200),
      ...ids,
      revokedAt
    ).changes || 0));
  }

  cleanup(options = {}) {
    const expiredBefore = normalizedDate(options.expiredBefore, "expiredBefore");
    const revokedBefore = normalizedDate(options.revokedBefore, "revokedBefore");
    return this.withDatabase((db) => {
      db.exec("BEGIN IMMEDIATE");
      try {
        const deletedRevoked = Number(db.prepare(`
          DELETE FROM auth_sessions
          WHERE revoked_at != '' AND revoked_at <= ?
        `).run(revokedBefore).changes || 0);
        const deletedExpired = Number(db.prepare(`
          DELETE FROM auth_sessions
          WHERE revoked_at = '' AND expires_at <= ?
        `).run(expiredBefore).changes || 0);
        db.exec("COMMIT");
        return {
          completedAt: this.now().toISOString(),
          expiredBefore,
          revokedBefore,
          deletedExpired,
          deletedRevoked,
          deletedTotal: deletedExpired + deletedRevoked
        };
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    });
  }

  status() {
    const now = this.now().toISOString();
    const counts = this.withDatabase((db) => db.prepare(`
      SELECT
        SUM(CASE WHEN revoked_at = '' AND expires_at > ? THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN revoked_at != '' THEN 1 ELSE 0 END) AS revoked,
        SUM(CASE WHEN revoked_at = '' AND expires_at <= ? THEN 1 ELSE 0 END) AS expired
      FROM auth_sessions
    `).get(now, now));
    return {
      mode: "sqlite",
      durable: true,
      crossProcess: true,
      active: Number(counts.active || 0),
      revoked: Number(counts.revoked || 0),
      expired: Number(counts.expired || 0)
    };
  }
}

class PostgresSessionStore {
  constructor(options = {}) {
    if (!options.pool && typeof options.PoolClass !== "function") throw new Error("pool or PoolClass is required");
    this.pool = options.pool || new options.PoolClass(options.poolConfig || {});
    this.ownsPool = !options.pool;
    this.now = options.now || (() => new Date());
    this.cache = new MemorySessionStore({ now: this.now });
    this.remoteStatus = {
      available: false,
      checkedAt: "",
      errorCode: "",
      active: 0,
      revoked: 0,
      expired: 0
    };
  }

  async query(sql, params) {
    try {
      const result = await this.pool.query(sql, params);
      this.remoteStatus.available = true;
      this.remoteStatus.checkedAt = this.now().toISOString();
      this.remoteStatus.errorCode = "";
      return result;
    } catch (error) {
      this.remoteStatus.available = false;
      this.remoteStatus.checkedAt = this.now().toISOString();
      this.remoteStatus.errorCode = "SESSION_STORE_UNAVAILABLE";
      throw error;
    }
  }

  async initialize() {
    const result = await this.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'health_platform' AND table_name = 'auth_sessions'
      ORDER BY ordinal_position
    `);
    const columns = new Set((result.rows || []).map((row) => String(row.column_name || "")));
    const required = ["session_id", "user_id", "username", "role", "user_payload", "issued_at", "expires_at", "revoked_at", "revoke_reason", "revoked_by", "created_at"];
    const missing = required.filter((column) => !columns.has(column));
    if (missing.length) {
      const error = new Error("PostgreSQL session schema is missing required columns");
      error.code = "POSTGRES_SESSION_SCHEMA_INVALID";
      error.missingColumns = missing;
      this.remoteStatus.available = false;
      this.remoteStatus.errorCode = error.code;
      throw error;
    }
    await this.refreshStatus();
    return this.status();
  }

  async create(session) {
    const normalized = normalizeSession(session);
    await this.query(`
      INSERT INTO health_platform.auth_sessions (
        session_id, user_id, username, role, user_payload, issued_at, expires_at, created_at
      ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz, $7::timestamptz, $8::timestamptz)
    `, [
      normalized.sessionId,
      normalizedText(normalized.user.id, 128),
      normalizedText(normalized.user.username || normalized.user.name, 200),
      normalizedText(normalized.user.role, 100),
      JSON.stringify(normalized.user),
      normalized.issuedAt,
      normalized.expiresAt,
      this.now().toISOString()
    ]);
    this.cache.create(normalized);
    return clone(normalized);
  }

  get(sessionId) {
    return this.cache.get(sessionId);
  }

  async hydrate(sessionId) {
    const id = normalizedText(sessionId, 128);
    if (!id) return null;
    const result = await this.query(`
      SELECT session_id, user_payload, issued_at, expires_at
      FROM health_platform.auth_sessions
      WHERE session_id = $1 AND revoked_at IS NULL AND expires_at > $2::timestamptz
    `, [id, this.now().toISOString()]);
    const row = result.rows?.[0];
    if (!row) {
      this.cache.revoke(id);
      return null;
    }
    const session = normalizeSession({
      sessionId: row.session_id,
      user: typeof row.user_payload === "string" ? JSON.parse(row.user_payload) : row.user_payload,
      issuedAt: row.issued_at,
      expiresAt: row.expires_at
    });
    this.cache.create(session);
    return clone(session);
  }

  async revoke(sessionId, options = {}) {
    const id = normalizedText(sessionId, 128);
    if (!id) return 0;
    const revokedAt = this.now().toISOString();
    const result = await this.query(`
      UPDATE health_platform.auth_sessions
      SET revoked_at = $1::timestamptz, revoke_reason = $2, revoked_by = $3
      WHERE session_id = $4 AND revoked_at IS NULL
    `, [
      revokedAt,
      normalizedText(options.reason || "logout", 200),
      normalizedText(options.actor || "system", 200),
      id
    ]);
    this.cache.revoke(id);
    return Number(result.rowCount || 0);
  }

  async revokeByUserIds(userIds = [], options = {}) {
    const ids = [...new Set(userIds.map((item) => normalizedText(item, 128)).filter(Boolean))];
    if (!ids.length) return 0;
    const revokedAt = this.now().toISOString();
    const result = await this.query(`
      UPDATE health_platform.auth_sessions
      SET revoked_at = $1::timestamptz, revoke_reason = $2, revoked_by = $3
      WHERE user_id = ANY($4::text[]) AND revoked_at IS NULL AND expires_at > $1::timestamptz
    `, [
      revokedAt,
      normalizedText(options.reason || "account-disabled", 200),
      normalizedText(options.actor || "system", 200),
      ids
    ]);
    this.cache.revokeByUserIds(ids);
    return Number(result.rowCount || 0);
  }

  async cleanup(options = {}) {
    const expiredBefore = normalizedDate(options.expiredBefore, "expiredBefore");
    const revokedBefore = normalizedDate(options.revokedBefore, "revokedBefore");
    const result = await this.query(`
      WITH deleted AS (
        DELETE FROM health_platform.auth_sessions
        WHERE (revoked_at IS NOT NULL AND revoked_at <= $1::timestamptz)
           OR (revoked_at IS NULL AND expires_at <= $2::timestamptz)
        RETURNING revoked_at
      )
      SELECT
        COUNT(*) FILTER (WHERE revoked_at IS NULL)::integer AS deleted_expired,
        COUNT(*) FILTER (WHERE revoked_at IS NOT NULL)::integer AS deleted_revoked
      FROM deleted
    `, [revokedBefore, expiredBefore]);
    const deletedExpired = Number(result.rows?.[0]?.deleted_expired || 0);
    const deletedRevoked = Number(result.rows?.[0]?.deleted_revoked || 0);
    this.cache.cleanup({ expiredBefore, revokedBefore });
    return {
      completedAt: this.now().toISOString(),
      expiredBefore,
      revokedBefore,
      deletedExpired,
      deletedRevoked,
      deletedTotal: deletedExpired + deletedRevoked
    };
  }

  async refreshStatus() {
    const now = this.now().toISOString();
    const result = await this.query(`
      SELECT
        COUNT(*) FILTER (WHERE revoked_at IS NULL AND expires_at > $1::timestamptz)::integer AS active,
        COUNT(*) FILTER (WHERE revoked_at IS NOT NULL)::integer AS revoked,
        COUNT(*) FILTER (WHERE revoked_at IS NULL AND expires_at <= $1::timestamptz)::integer AS expired
      FROM health_platform.auth_sessions
    `, [now]);
    this.remoteStatus = {
      available: true,
      checkedAt: this.now().toISOString(),
      errorCode: "",
      active: Number(result.rows?.[0]?.active || 0),
      revoked: Number(result.rows?.[0]?.revoked || 0),
      expired: Number(result.rows?.[0]?.expired || 0)
    };
    return this.status();
  }

  async health() {
    await this.query("SELECT 1 AS session_store_health");
    return this.status();
  }

  status() {
    return {
      mode: "postgres",
      durable: true,
      crossProcess: true,
      crossHost: true,
      centralized: true,
      cache: "request-hydrated-memory",
      ...this.remoteStatus
    };
  }

  async close() {
    if (this.ownsPool) await this.pool.end();
    this.remoteStatus.available = false;
    this.remoteStatus.checkedAt = this.now().toISOString();
  }
}

module.exports = {
  MemorySessionStore,
  PostgresSessionStore,
  SqliteSessionStore,
  createSqliteSessionSchema
};
