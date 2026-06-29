const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildQualitySafetyInterfaceJointTestPack,
  renderMarkdown,
  signInterfaceRequest,
  validateQualitySafetyInterfaceMessage,
  writeOutput
} = require("../scripts/quality-safety-interface-joint-test");

const ROOT = path.resolve(__dirname, "..");

async function api(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const body = await response.json();
  return { response, body };
}

async function login(baseUrl, username, password = "123456") {
  return api(baseUrl, "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
}

function authorized(token, options = {}) {
  return {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`
    }
  };
}

test("quality safety joint-test pack validates samples signatures and negative cases", () => {
  const pack = buildQualitySafetyInterfaceJointTestPack();
  assert.equal(pack.ok, true);
  assert.equal(pack.summary.interfaces, 6);
  assert.equal(pack.summary.sampleAccepted, pack.summary.sampleRequests);
  assert.equal(pack.negativeCases.every((item) => !item.result.ok), true);
  assert.equal(pack.negativeCases.some((item) => item.result.errors.some((error) => error.code === "SIGNATURE_MISMATCH")), true);
  assert.equal(pack.fieldDictionaries.some((item) => item.interfaceId === "qs-critical-value-alert-v1" && item.fields.some((field) => field.field === "residentId")), true);

  const sample = pack.sampleRequests[0];
  const accepted = validateQualitySafetyInterfaceMessage({
    interfaceId: sample.interfaceId,
    method: sample.method,
    path: sample.path,
    headers: sample.headers,
    message: sample.message
  });
  assert.equal(accepted.ok, true);

  const disposition = pack.sampleRequests.find((item) => item.interfaceId === "qs-critical-value-disposition-v1");
  const concretePath = "/api/quality-safety/critical-values/cva-001/dispose";
  const concreteHeaders = {
    ...disposition.headers,
    "X-Signature": signInterfaceRequest({
      method: disposition.method,
      path: concretePath,
      timestamp: disposition.headers["X-Timestamp"],
      idempotencyKey: disposition.headers["X-Idempotency-Key"],
      body: disposition.message
    })
  };
  const concreteAccepted = validateQualitySafetyInterfaceMessage({
    interfaceId: disposition.interfaceId,
    method: disposition.method,
    path: concretePath,
    headers: concreteHeaders,
    message: disposition.message
  });
  assert.equal(concreteAccepted.ok, true);

  const invalid = validateQualitySafetyInterfaceMessage({
    interfaceId: sample.interfaceId,
    method: sample.method,
    path: sample.path,
    headers: { ...sample.headers, "X-Signature": "bad-signature" },
    message: sample.message
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.errors.some((item) => item.code === "SIGNATURE_MISMATCH"), true);

  const markdown = renderMarkdown(pack);
  assert.match(markdown, /Quality-safety institution joint-test pack/);
  assert.match(markdown, /HMAC-SHA256/);
});

test("quality safety joint-test pack writes release artifacts", (t) => {
  const outputDir = path.join(ROOT, "tmp", "quality-safety-interface-joint-test-pack-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const pack = buildQualitySafetyInterfaceJointTestPack();
  writeOutput(pack, {
    output: path.join("tmp", "quality-safety-interface-joint-test-pack-test", "pack.json"),
    markdown: path.join("tmp", "quality-safety-interface-joint-test-pack-test", "pack.md")
  });
  const json = JSON.parse(fs.readFileSync(path.join(outputDir, "pack.json"), "utf8"));
  const markdown = fs.readFileSync(path.join(outputDir, "pack.md"), "utf8");
  assert.equal(json.ok, true);
  assert.match(markdown, /Validation Cases/);
});

test("quality safety joint-test pack API exposes pack and audits message validation", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "quality-safety-joint-test-"));
  fs.copyFileSync(path.join(ROOT, "data", "db.json"), path.join(dataDir, "db.json"));
  process.env.DATA_DIR = dataDir;
  process.env.STORAGE_ENGINE = "json";
  const { server, startServer, stopServer } = require(path.join(ROOT, "server.js"));
  startServer(0);
  await once(server, "listening");
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(async () => {
    await stopServer();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const commissionLogin = await login(baseUrl, "health");
  assert.equal(commissionLogin.response.status, 200);
  const pack = await api(baseUrl, "/api/quality-safety/interface-joint-test-pack", authorized(commissionLogin.body.token));
  assert.equal(pack.response.status, 200);
  assert.equal(pack.body.ok, true);
  assert.equal(pack.body.sampleRequests.length >= 6, true);

  const request = pack.body.sampleRequests[0];
  const accepted = await api(baseUrl, "/api/quality-safety/interface-messages/validate", authorized(commissionLogin.body.token, {
    method: "POST",
    body: JSON.stringify({
      interfaceId: request.interfaceId,
      method: request.method,
      path: request.path,
      headers: request.headers,
      message: request.message
    })
  }));
  assert.equal(accepted.response.status, 200);
  assert.equal(accepted.body.ok, true);

  const rejected = await api(baseUrl, "/api/quality-safety/interface-messages/validate", authorized(commissionLogin.body.token, {
    method: "POST",
    body: JSON.stringify({
      interfaceId: request.interfaceId,
      method: request.method,
      path: request.path,
      headers: { ...request.headers, "X-Signature": "bad-signature" },
      message: request.message
    })
  }));
  assert.equal(rejected.response.status, 200);
  assert.equal(rejected.body.ok, false);
  assert.equal(rejected.body.errors.some((item) => item.code === "SIGNATURE_MISMATCH"), true);

  const institutionLogin = await login(baseUrl, "hospital");
  assert.equal(institutionLogin.response.status, 200);
  const institutionPack = await api(baseUrl, "/api/quality-safety/interface-joint-test-pack", authorized(institutionLogin.body.token));
  assert.equal(institutionPack.response.status, 200);

  const citizenLogin = await login(baseUrl, "citizen");
  assert.equal(citizenLogin.response.status, 200);
  const forbidden = await api(baseUrl, "/api/quality-safety/interface-joint-test-pack", authorized(citizenLogin.body.token));
  assert.equal(forbidden.response.status, 403);

  const audit = await api(baseUrl, "/api/audit/export?trail=securityEvents", authorized(commissionLogin.body.token));
  assert.equal(audit.response.status, 200);
  assert.equal(JSON.stringify(audit.body).includes("quality-safety interface message validation"), true);
});
