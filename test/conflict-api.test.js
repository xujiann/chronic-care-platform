const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
let sqliteAvailable = true;
try {
  require("node:sqlite");
} catch {
  sqliteAvailable = false;
}

async function api(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const body = await response.json();
  return { response, body };
}

function authorized(token, options = {}) {
  return {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`
    }
  };
}

test("SQLite stale state writes return an API conflict contract", { skip: !sqliteAvailable }, async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "health-platform-conflict-api-"));
  fs.copyFileSync(path.join(ROOT, "data", "db.json"), path.join(dataDir, "db.json"));
  process.env.DATA_DIR = dataDir;
  process.env.STORAGE_ENGINE = "sqlite";

  const { server, startServer, stopServer } = require(path.join(ROOT, "server.js"));
  startServer(0);
  await once(server, "listening");
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(async () => {
    await stopServer();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const login = await api(baseUrl, "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "health", password: "123456" })
  });
  assert.equal(login.response.status, 200);
  const token = login.body.token;

  const firstRead = await api(baseUrl, "/api/state", authorized(token));
  const staleRead = await api(baseUrl, "/api/state", authorized(token));
  assert.equal(firstRead.response.status, 200);
  assert.equal(staleRead.response.status, 200);
  assert.equal(typeof firstRead.body.storageMeta.collectionVersions.residents, "number");

  firstRead.body.residents[0].address = "first-api-writer";
  const firstWrite = await api(baseUrl, "/api/state", authorized(token, {
    method: "PUT",
    body: JSON.stringify(firstRead.body)
  }));
  assert.equal(firstWrite.response.status, 200);

  staleRead.body.residents[0].address = "stale-api-writer";
  const staleWrite = await api(baseUrl, "/api/state", authorized(token, {
    method: "PUT",
    body: JSON.stringify(staleRead.body)
  }));
  assert.equal(staleWrite.response.status, 409);
  assert.equal(staleWrite.body.error, "Conflict");
  assert.equal(staleWrite.body.code, "STORAGE_CONFLICT");
  assert.equal(staleWrite.body.collection, "accounts");
  assert.equal(staleWrite.body.expectedVersion < staleWrite.body.currentVersion, true);

  const finalRead = await api(baseUrl, "/api/state", authorized(token));
  assert.equal(finalRead.body.residents[0].address, "first-api-writer");
});
