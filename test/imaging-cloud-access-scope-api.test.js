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

test("imaging cloud applies institution scope and removes clinical identifiers from patient browsing", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "imaging-access-scope-"));
  fs.copyFileSync(path.join(ROOT, "data", "db.json"), path.join(dataDir, "db.json"));
  const seeded = JSON.parse(fs.readFileSync(path.join(dataDir, "db.json"), "utf8"));
  seeded.imageCloudStudies[0].viewerUrl = "https://outside.example/ohif/should-not-leak";
  fs.writeFileSync(path.join(dataDir, "db.json"), JSON.stringify(seeded, null, 2));
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
  const citizen = await login(baseUrl, "citizen");

  const institutionDashboard = await requestJson(baseUrl, "/api/imaging-cloud", institution);
  assert.equal(institutionDashboard.response.status, 200, JSON.stringify(institutionDashboard.body));
  assert.equal(institutionDashboard.body.studies.every((study) => study.institutionCode === "MR1"), true);
  assert.equal(institutionDashboard.body.studies.every((study) => !Object.hasOwn(study, "viewerUrl") && !Object.hasOwn(study, "accessUrl")), true);

  const crossInstitutionDashboard = await requestJson(baseUrl, "/api/imaging-cloud?institutionCode=MR3", institution);
  assert.equal(crossInstitutionDashboard.response.status, 200);
  assert.equal(crossInstitutionDashboard.body.studies.length, 0);

  const deniedShare = await requestJson(baseUrl, "/api/imaging-cloud/studies/ics-dr-r2-20260603/share", institution, {
    method: "POST",
    body: JSON.stringify({ validDays: 7 })
  });
  assert.equal(deniedShare.response.status, 403);

  const patientDashboard = await requestJson(baseUrl, "/api/imaging-cloud", citizen);
  assert.equal(patientDashboard.response.status, 200, JSON.stringify(patientDashboard.body));
  assert.equal(patientDashboard.body.gateways.length, 0);
  assert.equal(patientDashboard.body.studies.length > 0, true);
  assert.equal(patientDashboard.body.studies.every((study) => !Object.hasOwn(study, "mainIndex") && !Object.hasOwn(study, "studyInstanceUID") && !Object.hasOwn(study, "fhirPatientId")), true);
  assert.equal(patientDashboard.body.shares.every((share) => !Object.hasOwn(share, "token")), true);
  assert.equal(patientDashboard.body.emrCompatibility.diagnosticReports.length, 0);
  assert.equal(patientDashboard.body.emrCompatibility.personalRecords.length, 0);
});
