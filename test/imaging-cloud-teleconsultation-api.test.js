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

test("authorized institution can create a minimized imaging teleconsultation work order", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "imaging-teleconsultation-api-"));
  const dbPath = path.join(dataDir, "db.json");
  fs.copyFileSync(path.join(ROOT, "data", "db.json"), dbPath);
  const db = JSON.parse(fs.readFileSync(dbPath, "utf8"));
  db.personalRecords = [{ id: "imaging-consent-r1", residentId: "r1", category: "authorizations", name: "影像远程会诊授权", date: "2026-07-01" }, ...(db.personalRecords || [])];
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), "utf8");
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

  const institution = await login(baseUrl, "hospital");
  const pathName = "/api/imaging-cloud/studies/ics-ct-r1-20260521/teleconsultations";
  const created = await requestJson(baseUrl, pathName, institution, {
    method: "POST",
    body: JSON.stringify({ targetInstitution: "大连市中心医院", department: "放射科", clinicalQuestion: "请评估进一步影像检查建议" })
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.consultation.imageCloudStudyId, "ics-ct-r1-20260521");
  assert.equal(created.body.consultation.imageReference.rawDicomIncluded, false);
  assert.equal(created.body.consultation.materials.some((item) => /studyinstanceuid|dicomuid/i.test(item)), false);

  const duplicate = await requestJson(baseUrl, pathName, institution, { method: "POST", body: JSON.stringify({ targetInstitution: "大连市中心医院", department: "放射科", clinicalQuestion: "重复提交" }) });
  assert.equal(duplicate.response.status, 409);
});
