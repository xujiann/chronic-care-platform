const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

async function requestJson(baseUrl, pathname, token = "", options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  return { response, body: await response.json() };
}

async function login(baseUrl, username) {
  const result = await requestJson(baseUrl, "/api/auth/login", "", {
    method: "POST",
    body: JSON.stringify({ username, password: "123456" })
  });
  assert.equal(result.response.status, 200);
  return result.body.token;
}

test("citizen can revoke an active imaging share and the revoke remains auditable", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "imaging-share-api-"));
  fs.copyFileSync(path.join(ROOT, "data", "db.json"), path.join(dataDir, "db.json"));
  const previous = Object.fromEntries(["NODE_ENV", "DATA_DIR", "STORAGE_ENGINE", "SESSION_STORE"].map((key) => [key, process.env[key]]));
  Object.assign(process.env, { NODE_ENV: "test", DATA_DIR: dataDir, STORAGE_ENGINE: "json", SESSION_STORE: "memory" });
  const { server, startServer, stopServer } = require("../server");
  startServer(0);
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await stopServer();
    fs.rmSync(dataDir, { recursive: true, force: true });
    Object.entries(previous).forEach(([key, value]) => value === undefined ? delete process.env[key] : process.env[key] = value);
  });

  const citizen = await login(baseUrl, "citizen");
  const created = await requestJson(baseUrl, "/api/imaging-cloud/studies/ics-ct-r1-20260521/share", citizen, {
    method: "POST",
    body: JSON.stringify({ validDays: 7, channel: "二维码/短信链接" })
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const revoked = await requestJson(baseUrl, `/api/imaging-cloud/studies/ics-ct-r1-20260521/shares/${encodeURIComponent(created.body.id)}/revoke`, citizen, {
    method: "POST",
    body: JSON.stringify({ reason: "患者主动撤销" })
  });
  assert.equal(revoked.response.status, 200, JSON.stringify(revoked.body));
  assert.equal(revoked.body.share.status, "revoked");
  assert.equal(revoked.body.share.revokeReason, "患者主动撤销");
  assert.equal(Boolean(revoked.body.share.revokedAt), true);

  const repeated = await requestJson(baseUrl, `/api/imaging-cloud/studies/ics-ct-r1-20260521/shares/${encodeURIComponent(created.body.id)}/revoke`, citizen, {
    method: "POST",
    body: JSON.stringify({ reason: "重复撤销" })
  });
  assert.equal(repeated.response.status, 409);
});
