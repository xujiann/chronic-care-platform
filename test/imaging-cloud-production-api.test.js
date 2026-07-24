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

function digest(character) {
  return `sha256:${character.repeat(64)}`;
}

test("imaging production routes retain No-Go and validate structured site evidence", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "imaging-production-api-"));
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

  const commission = await login(baseUrl, "health");
  const institution = await login(baseUrl, "hospital");
  const independentCommission = await login(baseUrl, "city");
  const citizen = await login(baseUrl, "citizen");
  const initial = await requestJson(baseUrl, "/api/imaging-cloud/production-center", commission);
  assert.equal(initial.response.status, 200);
  assert.equal(initial.body.productionReady, false);
  assert.equal(initial.body.formalGoLiveState, "blocked-until-site-evidence-signed");

  const unsafeSynthetic = await requestJson(baseUrl, "/api/imaging-cloud/production/synthetic-checks/imaging-syn-services/actions", institution, {
    method: "POST",
    body: JSON.stringify({ confirmation: "CONFIRM SYNTHETIC IMAGING CHECK", dataClass: "real-patient-data", result: "passed", evidenceRef: "test/unsafe" })
  });
  assert.equal(unsafeSynthetic.response.status, 400);

  const receipt = await requestJson(baseUrl, "/api/imaging-cloud/production/receipts/object-storage-authorization-audit/submit", institution, {
    method: "POST",
    body: JSON.stringify({
      confirmation: "SUBMIT IMAGING SITE EVIDENCE",
      contractVersion: "1.0",
      evidenceRef: "site/object-storage/receipt",
      evidenceDigest: digest("a"),
      externalSigner: "试点医院安全负责人",
      externalOrganization: "试点医院",
      storageRegion: "liaoning-in-province",
      encryptionAtRest: "enabled",
      authorizationMode: "authenticated-and-authorized",
      auditRetentionDays: 180,
      terminalPolicy: "no-original-dicom-on-mobile"
    })
  });
  assert.equal(receipt.response.status, 200, JSON.stringify(receipt.body));
  assert.equal(receipt.body.item.status, "evidence-submitted");

  const verified = await requestJson(baseUrl, "/api/imaging-cloud/production/receipts/object-storage-authorization-audit/verify", independentCommission, {
    method: "POST",
    body: JSON.stringify({ confirmation: "VERIFY IMAGING SITE EVIDENCE", evidenceDigest: digest("a"), verificationRef: "site/object-storage/verify" })
  });
  assert.equal(verified.response.status, 200, JSON.stringify(verified.body));
  assert.equal(verified.body.item.status, "verified");

  const smoke = await requestJson(baseUrl, "/api/imaging-cloud/production/smoke", commission);
  assert.equal(smoke.response.status, 200);
  assert.equal(smoke.body.releaseDecision, "no-go");

  const governance = await requestJson(baseUrl, "/api/imaging-cloud/governance", commission);
  assert.equal(governance.response.status, 200);
  assert.equal(governance.body.recognitionCatalog.some((item) => item.id === "IMG-RC-CT-CHEST"), true);
  const catalogUpdate = await requestJson(baseUrl, "/api/imaging-cloud/governance/catalog/IMG-RC-CT-CHEST/actions", commission, {
    method: "POST",
    body: JSON.stringify({ status: "suspended", policyVersion: "2026.07", evidenceRef: "policy/recognition-catalog-review" })
  });
  assert.equal(catalogUpdate.response.status, 200, JSON.stringify(catalogUpdate.body));
  assert.equal(catalogUpdate.body.item.status, "suspended");
  const performance = await requestJson(baseUrl, "/api/imaging-cloud/studies/ics-ct-r1-20260521/performance", citizen, {
    method: "POST",
    body: JSON.stringify({ firstFrameMs: 900, seriesLoadMs: 3200, interactionMs: 100, networkClass: "5g", viewportClass: "mobile", patientName: "must-not-persist" })
  });
  assert.equal(performance.response.status, 201, JSON.stringify(performance.body));
  assert.equal(Object.hasOwn(performance.body.event, "patientName"), false);
});
