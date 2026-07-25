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
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) }
  });
  return { response, body: await response.json() };
}

async function login(baseUrl, username) {
  const result = await requestJson(baseUrl, "/api/auth/login", "", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password: "123456" }) });
  assert.equal(result.response.status, 200);
  return result.body.token;
}

test("diagnostic OHIF links stay unavailable to citizens and browser-level studies", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "imaging-viewer-api-"));
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
  const institution = await login(baseUrl, "hospital");
  const commission = await login(baseUrl, "health");
  const citizenAttempt = await requestJson(baseUrl, "/api/imaging-cloud/studies/ics-ct-r1-20260521/viewer", citizen);
  assert.equal(citizenAttempt.response.status, 403);

  const clinicalViewer = await requestJson(baseUrl, "/api/imaging-cloud/studies/ics-ct-r1-20260521/viewer", institution);
  assert.equal(clinicalViewer.response.status, 200, JSON.stringify(clinicalViewer.body));
  assert.equal(clinicalViewer.body.viewer, "OHIF");

  const browserOnly = await requestJson(baseUrl, "/api/imaging-cloud/studies/ics-dr-r2-20260603/viewer", commission);
  assert.equal(browserOnly.response.status, 409);
  assert.match(browserOnly.body.message, /浏览级预览/);
});
