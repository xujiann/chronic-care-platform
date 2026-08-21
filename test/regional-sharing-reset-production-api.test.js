"use strict";

const assert = require("node:assert/strict");
const { createHmac, randomUUID } = require("node:crypto");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { SqliteSessionStore } = require("../session-store");

const ROOT = path.resolve(__dirname, "..");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "regional-sharing-reset-production-"));
const sessionSecret = "regional-sharing-production-reset-session-secret-2026";
fs.copyFileSync(path.join(ROOT, "data", "db.json"), path.join(dataDir, "db.json"));
Object.assign(process.env, {
  AUTH_BEARER_COMPATIBILITY: "enabled",
  DATA_DIR: dataDir,
  NODE_ENV: "production",
  SESSION_CLEANUP_INTERVAL_MS: "900000",
  SESSION_EXPIRED_RETENTION_DAYS: "7",
  SESSION_REVOKED_RETENTION_DAYS: "30",
  SESSION_SECRETS: sessionSecret,
  SESSION_STORE: "sqlite",
  SESSION_TOPOLOGY: "single-host",
  STORAGE_ENGINE: "sqlite"
});

const {
  openSqliteDatabase,
  readDatabase,
  server,
  startServer,
  stopServer,
  writeDatabase
} = require("../server");

const SERVER_MANAGED_REGIONAL_COLLECTIONS = [
  "regionalDataSharingScope",
  "regionalSharingPackages",
  "regionalSharingSnapshots",
  "regionalSharingAccessReviews"
];

function createProductionCommissionSession(user) {
  const sessionId = randomUUID();
  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const issuedPart = Buffer.from(issuedAt).toString("base64url");
  const expiresPart = Buffer.from(expiresAt).toString("base64url");
  const payload = `${sessionId}.${issuedPart}.${expiresPart}`;
  const signature = createHmac("sha256", sessionSecret).update(payload).digest("base64url");
  const token = `${payload}.${signature}`;
  const safeUser = { ...user };
  delete safeUser.password;
  delete safeUser.passwordHash;
  delete safeUser.phone;
  new SqliteSessionStore({ openDatabase: openSqliteDatabase }).create({
    sessionId,
    user: safeUser,
    issuedAt,
    expiresAt
  });
  return token;
}

test("production server composition rejects commission demo reset and preserves regional owner state", async (t) => {
  startServer(0);
  if (!server.listening) await once(server, "listening");
  t.after(async () => {
    await stopServer();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const state = readDatabase();
  const commission = state.authUsers.find((user) => user.role === "commission" && user.status !== "停用");
  assert.ok(commission);
  state.regionalSharingAccessReviews = [
    {
      id: "production-reset-preservation-sentinel",
      schemaVersion: "regional-sharing-access-receipt.v1",
      command: "regional-sharing-access-command.v1",
      packageId: "rsp-r2-diabetes",
      decision: "allowed",
      status: "completed",
      at: "2026-08-21T00:00:00.000Z"
    },
    ...(state.regionalSharingAccessReviews || [])
  ];
  writeDatabase(state);
  const before = readDatabase();
  const protectedBefore = Object.fromEntries(SERVER_MANAGED_REGIONAL_COLLECTIONS.map((collection) => [
    collection,
    structuredClone(before[collection])
  ]));
  const token = createProductionCommissionSession(commission);
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/reset`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` }
  });
  const body = await response.json();

  assert.equal(response.status, 403);
  assert.equal(body.code, "DEMO_RESET_DISABLED_IN_PRODUCTION");
  const after = readDatabase();
  for (const collection of SERVER_MANAGED_REGIONAL_COLLECTIONS) {
    assert.deepEqual(after[collection], protectedBefore[collection], collection);
  }
  assert.equal(after.regionalSharingAccessReviews[0].id, "production-reset-preservation-sentinel");
});
