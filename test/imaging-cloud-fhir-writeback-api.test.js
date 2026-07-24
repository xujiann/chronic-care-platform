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
    headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }
  });
  return { response, body: await response.json() };
}

async function login(baseUrl, username) {
  const result = await requestJson(baseUrl, "/api/auth/login", "", { method: "POST", body: JSON.stringify({ username, password: "123456" }) });
  assert.equal(result.response.status, 200);
  return result.body.token;
}

test("FHIR report writeback retry is role-guarded and requires an established FHIR chain", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "imaging-fhir-retry-api-"));
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
  const pathName = "/api/imaging-cloud/studies/ics-ct-r1-20260521/fhir-writeback/retry";
  const denied = await requestJson(baseUrl, pathName, citizen, { method: "POST", body: JSON.stringify({}) });
  assert.equal(denied.response.status, 403);

  const missingPrerequisite = await requestJson(baseUrl, pathName, institution, { method: "POST", body: JSON.stringify({}) });
  assert.equal(missingPrerequisite.response.status, 409);
  assert.match(missingPrerequisite.body.message, /FHIR Patient/);
});
