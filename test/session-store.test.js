const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { MemorySessionStore, PostgresSessionStore, SqliteSessionStore, postgresSessionSchema } = require("../session-store");

let DatabaseSync = null;
try {
  ({ DatabaseSync } = require("node:sqlite"));
} catch {
  // SQLite-backed tests are skipped on runtimes without node:sqlite.
}

const activeSession = {
  sessionId: "session-active",
  user: { id: "user-1", username: "city", name: "Platform Admin", role: "commission" },
  issuedAt: "2026-07-15T00:00:00.000Z",
  expiresAt: "2026-07-15T10:00:00.000Z"
};

function createPostgresPool(rows = new Map()) {
  const columns = ["session_id", "user_id", "username", "role", "user_payload", "issued_at", "expires_at", "revoked_at", "revoke_reason", "revoked_by", "created_at"];
  return {
    rows,
    async query(sql, params = []) {
      const normalized = String(sql).replace(/\s+/g, " ").trim();
      if (/information_schema\.columns/.test(normalized)) return { rows: columns.map((column_name) => ({ column_name })) };
      if (normalized === "SELECT 1 AS session_store_health") return { rows: [{ session_store_health: 1 }] };
      if (/^INSERT INTO health_platform\.auth_sessions/.test(normalized)) {
        rows.set(params[0], {
          session_id: params[0], user_id: params[1], username: params[2], role: params[3], user_payload: JSON.parse(params[4]),
          issued_at: params[5], expires_at: params[6], created_at: params[7], revoked_at: null, revoke_reason: "", revoked_by: ""
        });
        return { rowCount: 1, rows: [] };
      }
      if (/^SELECT session_id, user_payload, issued_at, expires_at/.test(normalized)) {
        const row = rows.get(params[0]);
        return { rows: row && !row.revoked_at && row.expires_at > params[1] ? [{ ...row }] : [] };
      }
      if (/^UPDATE health_platform\.auth_sessions/.test(normalized) && /session_id = \$4/.test(normalized)) {
        const row = rows.get(params[3]);
        if (!row || row.revoked_at) return { rowCount: 0, rows: [] };
        Object.assign(row, { revoked_at: params[0], revoke_reason: params[1], revoked_by: params[2] });
        return { rowCount: 1, rows: [] };
      }
      if (/^UPDATE health_platform\.auth_sessions/.test(normalized) && /user_id = ANY/.test(normalized)) {
        let rowCount = 0;
        rows.forEach((row) => {
          if (params[3].includes(row.user_id) && !row.revoked_at && row.expires_at > params[0]) {
            Object.assign(row, { revoked_at: params[0], revoke_reason: params[1], revoked_by: params[2] });
            rowCount += 1;
          }
        });
        return { rowCount, rows: [] };
      }
      if (/^WITH deleted AS/.test(normalized)) {
        let deletedExpired = 0;
        let deletedRevoked = 0;
        rows.forEach((row, id) => {
          if (row.revoked_at && row.revoked_at <= params[0]) {
            rows.delete(id);
            deletedRevoked += 1;
          } else if (!row.revoked_at && row.expires_at <= params[1]) {
            rows.delete(id);
            deletedExpired += 1;
          }
        });
        return { rows: [{ deleted_expired: deletedExpired, deleted_revoked: deletedRevoked }] };
      }
      if (/COUNT\(\*\) FILTER/.test(normalized)) {
        const now = params[0];
        let active = 0;
        let revoked = 0;
        let expired = 0;
        rows.forEach((row) => {
          if (row.revoked_at) revoked += 1;
          else if (row.expires_at > now) active += 1;
          else expired += 1;
        });
        return { rows: [{ active, revoked, expired }] };
      }
      throw new Error(`unexpected PostgreSQL session query: ${normalized}`);
    }
  };
}

test("memory session store preserves the development contract", () => {
  const store = new MemorySessionStore({ now: () => new Date("2026-07-15T01:00:00.000Z") });
  store.create(activeSession);

  assert.deepEqual(store.get(activeSession.sessionId), activeSession);
  assert.deepEqual(store.status(), {
    mode: "memory",
    durable: false,
    crossProcess: false,
    active: 1,
    revoked: 0,
    expired: 0
  });
  assert.equal(store.revokeByUserIds(["user-1"]), 1);
  assert.equal(store.get(activeSession.sessionId), null);
});

test("session stores minimize user snapshots independently of callers", () => {
  const store = new MemorySessionStore({ now: () => new Date("2026-07-15T01:00:00.000Z") });
  const session = store.create({
    ...activeSession,
    user: {
      ...activeSession.user,
      phone: "13800000000",
      idCard: "210200199001010000",
      personIndex: "sensitive-index",
      password: "must-not-persist",
      passwordHash: "must-not-persist"
    }
  });

  assert.equal(session.user.phone, undefined);
  assert.equal(session.user.idCard, undefined);
  assert.equal(session.user.personIndex, undefined);
  assert.equal(session.user.password, undefined);
  assert.equal(session.user.passwordHash, undefined);
});

test("memory session cleanup removes retained expiry rows and validates cutoffs", () => {
  const store = new MemorySessionStore({ now: () => new Date("2026-07-15T01:00:00.000Z") });
  store.create(activeSession);
  store.create({
    ...activeSession,
    sessionId: "session-expired-memory",
    expiresAt: "2026-07-15T00:30:00.000Z"
  });

  assert.deepEqual(store.cleanup({
    expiredBefore: "2026-07-15T00:45:00.000Z",
    revokedBefore: "2026-06-15T01:00:00.000Z"
  }), {
    completedAt: "2026-07-15T01:00:00.000Z",
    expiredBefore: "2026-07-15T00:45:00.000Z",
    revokedBefore: "2026-06-15T01:00:00.000Z",
    deletedExpired: 1,
    deletedRevoked: 0,
    deletedTotal: 1
  });
  assert.equal(store.get(activeSession.sessionId)?.sessionId, activeSession.sessionId);
  assert.equal(store.status().expired, 0);
  assert.throws(() => store.cleanup({ expiredBefore: "invalid", revokedBefore: new Date() }), /expiredBefore/);
});

test("PostgreSQL session store shares sessions and revocation across hosts", async () => {
  const pool = createPostgresPool();
  const now = () => new Date("2026-07-15T01:00:00.000Z");
  const nodeA = new PostgresSessionStore({ pool, now });
  const nodeB = new PostgresSessionStore({ pool, now });

  await nodeA.initialize();
  await nodeB.initialize();
  await nodeA.create(activeSession);
  assert.deepEqual(await nodeB.hydrate(activeSession.sessionId), activeSession);
  assert.deepEqual(nodeB.get(activeSession.sessionId), activeSession);
  assert.equal((await nodeB.refreshStatus()).active, 1);
  assert.equal(nodeB.status().crossHost, true);
  assert.equal(nodeB.status().centralized, true);
  assert.equal((await nodeB.health()).available, true);

  assert.equal(await nodeB.revoke(activeSession.sessionId, { reason: "cross-host-logout", actor: "node-b" }), 1);
  assert.equal(await nodeA.hydrate(activeSession.sessionId), null);
  assert.equal(nodeA.get(activeSession.sessionId), null);
  assert.equal(pool.rows.get(activeSession.sessionId).revoke_reason, "cross-host-logout");

  await nodeA.create({ ...activeSession, sessionId: "postgres-expired", expiresAt: "2026-07-15T00:30:00.000Z" });
  assert.deepEqual(await nodeA.cleanup({
    expiredBefore: "2026-07-15T00:45:00.000Z",
    revokedBefore: "2026-07-15T01:00:00.000Z"
  }), {
    completedAt: "2026-07-15T01:00:00.000Z",
    expiredBefore: "2026-07-15T00:45:00.000Z",
    revokedBefore: "2026-07-15T01:00:00.000Z",
    deletedExpired: 1,
    deletedRevoked: 1,
    deletedTotal: 2
  });
  assert.equal(pool.rows.size, 0);
});

test("PostgreSQL session store refuses startup when the central schema is incomplete", async () => {
  const store = new PostgresSessionStore({
    pool: {
      async query() {
        return { rows: [{ column_name: "session_id" }, { column_name: "user_id" }] };
      }
    }
  });

  await assert.rejects(
    () => store.initialize(),
    (error) => error.code === "POSTGRES_SESSION_SCHEMA_INVALID"
      && error.missingColumns.includes("user_payload")
      && error.missingColumns.includes("revoked_at")
  );
  assert.equal(store.status().available, false);
  assert.equal(store.status().errorCode, "POSTGRES_SESSION_SCHEMA_INVALID");
});

test("PostgreSQL session store isolates an explicitly validated schema", async () => {
  const queries = [];
  const pool = {
    async query(sql, params = []) {
      queries.push({ sql: String(sql), params });
      if (/information_schema\.columns/.test(sql)) {
        return { rows: ["session_id", "user_id", "username", "role", "user_payload", "issued_at", "expires_at", "revoked_at", "revoke_reason", "revoked_by", "created_at"].map((column_name) => ({ column_name })) };
      }
      return { rows: [], rowCount: 0 };
    }
  };
  const store = new PostgresSessionStore({ pool, schema: "tenant_alpha" });
  await store.initialize();
  assert.deepEqual(queries[0].params, ["tenant_alpha"]);
  await store.hydrate("missing-session");
  assert.match(queries[1].sql, /FROM tenant_alpha\.auth_sessions/);
  assert.equal(postgresSessionSchema("tenant_alpha"), "tenant_alpha");
  assert.throws(() => postgresSessionSchema("tenant-alpha;drop schema public"), /lowercase SQL identifier/);
});

test("SQLite session stores share sessions and retain revocation audit evidence", { skip: !DatabaseSync }, () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "health-session-store-"));
  const databaseFile = path.join(dataDir, "sessions.sqlite");
  const now = () => new Date("2026-07-15T01:00:00.000Z");
  const openDatabase = () => new DatabaseSync(databaseFile);
  const writer = new SqliteSessionStore({ openDatabase, now });
  const reader = new SqliteSessionStore({ openDatabase, now });

  try {
    writer.create(activeSession);
    assert.deepEqual(reader.get(activeSession.sessionId), activeSession);
    assert.deepEqual(reader.status(), {
      mode: "sqlite",
      durable: true,
      crossProcess: true,
      active: 1,
      revoked: 0,
      expired: 0
    });

    const childSource = `
      const { DatabaseSync } = require("node:sqlite");
      const { SqliteSessionStore } = require(${JSON.stringify(path.resolve(__dirname, "..", "session-store.js"))});
      const store = new SqliteSessionStore({
        openDatabase: () => new DatabaseSync(process.env.SESSION_DATABASE_FILE),
        now: () => new Date("2026-07-15T01:00:00.000Z")
      });
      const session = store.get("session-active");
      const revoked = store.revokeByUserIds(["user-1"], {
        reason: "identity-directory-deactivation",
        actor: "security-admin"
      });
      process.stdout.write(JSON.stringify({ session, revoked }));
    `;
    const child = spawnSync(process.execPath, ["-e", childSource], {
      encoding: "utf8",
      env: { ...process.env, SESSION_DATABASE_FILE: databaseFile }
    });
    assert.equal(child.status, 0, child.stderr);
    const childResult = JSON.parse(child.stdout);
    assert.deepEqual(childResult.session, activeSession);
    assert.equal(childResult.revoked, 1);
    assert.equal(writer.get(activeSession.sessionId), null);

    const db = openDatabase();
    try {
      const row = db.prepare(`
        SELECT user_id, revoked_at, revoke_reason, revoked_by
        FROM auth_sessions
        WHERE session_id = ?
      `).get(activeSession.sessionId);
      assert.equal(row.user_id, "user-1");
      assert.equal(row.revoked_at, "2026-07-15T01:00:00.000Z");
      assert.equal(row.revoke_reason, "identity-directory-deactivation");
      assert.equal(row.revoked_by, "security-admin");
    } finally {
      db.close();
    }

    writer.create({
      ...activeSession,
      sessionId: "session-expired",
      expiresAt: "2026-07-15T00:30:00.000Z"
    });
    assert.equal(reader.get("session-expired"), null);
    assert.deepEqual(reader.status(), {
      mode: "sqlite",
      durable: true,
      crossProcess: true,
      active: 0,
      revoked: 1,
      expired: 1
    });
    assert.deepEqual(reader.cleanup({
      expiredBefore: "2026-07-15T00:45:00.000Z",
      revokedBefore: "2026-07-15T01:00:00.000Z"
    }), {
      completedAt: "2026-07-15T01:00:00.000Z",
      expiredBefore: "2026-07-15T00:45:00.000Z",
      revokedBefore: "2026-07-15T01:00:00.000Z",
      deletedExpired: 1,
      deletedRevoked: 1,
      deletedTotal: 2
    });
    assert.deepEqual(reader.status(), {
      mode: "sqlite",
      durable: true,
      crossProcess: true,
      active: 0,
      revoked: 0,
      expired: 0
    });
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
