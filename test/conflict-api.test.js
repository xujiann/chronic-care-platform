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
  assert.equal(staleWrite.body.collection, "residents");
  assert.equal(staleWrite.body.expectedVersion < staleWrite.body.currentVersion, true);

  const finalRead = await api(baseUrl, "/api/state", authorized(token));
  assert.equal(finalRead.body.residents[0].address, "first-api-writer");

  const collectionRead = await api(baseUrl, "/api/state", authorized(token));
  const residentsVersion = collectionRead.body.storageMeta.collectionVersions.residents;
  const personalRecordsVersion = collectionRead.body.storageMeta.collectionVersions.personalRecords;
  collectionRead.body.personalRecords[0].result = "collection-level-save";
  const collectionWrite = await api(baseUrl, "/api/state-collections/personalRecords", authorized(token, {
    method: "PUT",
    body: JSON.stringify({
      expectedVersion: personalRecordsVersion,
      value: collectionRead.body.personalRecords
    })
  }));
  assert.equal(collectionWrite.response.status, 200);
  assert.equal(collectionWrite.body.collection, "personalRecords");
  assert.equal(collectionWrite.body.version, personalRecordsVersion + 1);

  const afterCollectionWrite = await api(baseUrl, "/api/state", authorized(token));
  assert.equal(afterCollectionWrite.body.storageMeta.collectionVersions.residents, residentsVersion);
  assert.equal(afterCollectionWrite.body.personalRecords[0].result, "collection-level-save");

  const staleCollectionWrite = await api(baseUrl, "/api/state-collections/personalRecords", authorized(token, {
    method: "PUT",
    body: JSON.stringify({
      expectedVersion: personalRecordsVersion,
      value: afterCollectionWrite.body.personalRecords
    })
  }));
  assert.equal(staleCollectionWrite.response.status, 409);
  assert.equal(staleCollectionWrite.body.code, "STORAGE_CONFLICT");
  assert.equal(staleCollectionWrite.body.collection, "personalRecords");

  const residentPatchRead = await api(baseUrl, "/api/state", authorized(token));
  const residentPatchVersion = residentPatchRead.body.storageMeta.collectionVersions.residents;
  const residentPatch = await api(baseUrl, "/api/residents/r1", authorized(token, {
    method: "PATCH",
    body: JSON.stringify({
      expectedVersion: residentPatchVersion,
      address: "resident-patch-address",
      idCard: "tampered-id-card",
      phone: "tampered-phone"
    })
  }));
  assert.equal(residentPatch.response.status, 200);
  assert.equal(residentPatch.body.address, "resident-patch-address");
  assert.notEqual(residentPatch.body.idCard, "tampered-id-card");
  assert.notEqual(residentPatch.body.phone, "tampered-phone");

  const afterResidentPatch = await api(baseUrl, "/api/state", authorized(token));
  assert.equal(afterResidentPatch.body.storageMeta.collectionVersions.residents, residentPatchVersion + 1);
  const staleResidentPatch = await api(baseUrl, "/api/residents/r1", authorized(token, {
    method: "PATCH",
    body: JSON.stringify({
      expectedVersion: residentPatchVersion,
      address: "stale-resident-patch-address"
    })
  }));
  assert.equal(staleResidentPatch.response.status, 409);
  assert.equal(staleResidentPatch.body.collection, "residents");
});
