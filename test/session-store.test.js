const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { MemorySessionStore, SqliteSessionStore } = require("../session-store");

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
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
